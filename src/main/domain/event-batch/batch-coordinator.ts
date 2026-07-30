import type { DBAdapter } from '../../db/interface'
import { PRE_PONR_EXECUTION_ERROR_CODE } from '../../application/command/durable-command-coordinator'
import type { CommandEnvelopeV2 } from '../../application/command/command-types'
import {
  DurableCommandStore,
  DurableCommandStoreError,
  type DurableCommandRow
} from '../../application/command/durable-command-store'
import {
  createCommandResultJson,
  parseCommandResultJson
} from '../../application/command/command-result'
import {
  createBatchCommittedRecord,
  createBatchPreparedRecord,
  createEventRecord,
  validatePreparedBatch,
  type EventRecordInput
} from './batch-hash'
import {
  freezeCommandPlan,
  type CommandPlanV1,
  type PlannerReadSnapshot
} from './command-plan'
import type { CanonicalJsonValue } from './canonical-json'
import {
  InjectedEventBatchFault,
  type EventBatchFaultInjector
} from './fault-injection'
import { DurableFileCapability } from './file-capability'
import type { LegacyAnchorV1 } from './legacy-anchor'
import {
  applyPreparedBatch,
  loadVerifiedProjectionSources,
  ProjectionSourceError,
  type PreparedBatchSource,
  type VerifiedEventSource
} from './projection-source'
import {
  PreparedFactRegistry,
  PreparedFactRegistryError
} from './result-registry'
import {
  loadSegmentSources,
  readSegmentIndexFile,
  reconcileSegmentIndex,
  writeSegmentIndexAtomic,
  type SegmentIndexEntryV1,
  type SegmentIndexV1
} from './segment-index'
import {
  SegmentStore,
  shouldRotateBeforePrepare,
  segmentIdForOrdinal,
  segmentOrdinalFromId,
  segmentRelativePath,
  type SegmentFilePort
} from './segment-store'
import {
  RuntimeCorruptionState
} from './runtime-corruption'
import {
  FairWriterMutex,
  processWideEventBatchWriterMutex
} from './writer-mutex'

export interface EventBatchPlannerPort<TSnapshot extends CanonicalJsonValue> {
  plan(input: Readonly<{
    envelope: CommandEnvelopeV2
    snapshot: PlannerReadSnapshot<TSnapshot>
  }>): CommandPlanV1 | Promise<CommandPlanV1>
}

/**
 * Reads the authoritative planner facts after the coordinator owns its writer
 * mutex and has revalidated the durable lease. Passing an already-read
 * snapshot here would permit stale facts to cross the PREPARE boundary.
 */
export type EventBatchSnapshotLoader<TSnapshot extends CanonicalJsonValue> = () =>
  | PlannerReadSnapshot<TSnapshot>
  | Promise<PlannerReadSnapshot<TSnapshot>>

export interface EventBatchCoordinatorDependencies {
  readonly database: DBAdapter
  readonly commandStore: DurableCommandStore
  readonly registry: PreparedFactRegistry
  readonly fileCapability: DurableFileCapability
  readonly writerMutex?: FairWriterMutex
  readonly corruptionState: RuntimeCorruptionState
  readonly workerId: string
  readonly legacyAnchor: LegacyAnchorV1 | null
  readonly now?: () => Date
  readonly segmentFiles?: SegmentFilePort
  readonly faultInjector?: EventBatchFaultInjector
}

export type EventBatchExecutionResult = Readonly<{
  status: 'COMPLETED'
  command: DurableCommandRow
  batch: PreparedBatchSource | null
  publicResult: Readonly<Record<string, CanonicalJsonValue>>
}>

export class EventBatchCoordinatorError extends Error {
  constructor(
    public readonly code:
      | 'COMMAND_NOT_CURRENT'
      | 'PLAN_INVALID'
      | 'SEGMENT_NOT_READY'
      | 'PREPARED_SOURCE_MISSING'
      | 'BATCH_CONFIRM_CONFLICT'
      | 'INDEX_CONFLICT'
      | 'FENCED',
    message: string
  ) {
    super(`[event-batch-coordinator] ${message}`)
    this.name = 'EventBatchCoordinatorError'
  }
}

function exactTimestamp(value: string, field: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || new Date(value).toISOString() !== value) {
    throw new EventBatchCoordinatorError('PLAN_INVALID', `${field} is not an exact UTC timestamp`)
  }
  return value
}

function nowIso(clock: () => Date): string {
  return exactTimestamp(clock().toISOString(), 'clock')
}

function assertEnvelopeRow(envelope: CommandEnvelopeV2, row: DurableCommandRow): void {
  if (
    row.commandId !== envelope.commandId
    || row.eventBatchId !== envelope.eventBatchId
    || row.commandType !== envelope.commandType
    || row.requestHash !== envelope.requestHash
    || row.clientInstanceId !== envelope.clientInstanceId
    || row.idempotencyKey !== envelope.idempotencyKey
    || row.actorId !== envelope.actorId
    || row.deviceId !== envelope.deviceId
    || row.authSessionId !== envelope.authSessionId
    || row.leaseOwner !== envelope.leaseOwner
    || row.currentLeaseGeneration !== envelope.leaseGeneration
  ) throw new EventBatchCoordinatorError('COMMAND_NOT_CURRENT', 'accepted envelope does not match its durable command row')
}

function eventsFromPlan(plan: CommandPlanV1, envelope: CommandEnvelopeV2) {
  return plan.events.map((intent) => createEventRecord({
    batch_id: envelope.eventBatchId,
    event_id: intent.eventId,
    aggregate_type: intent.aggregateType,
    aggregate_id: intent.aggregateId,
    event_type: intent.eventType,
    event_sequence: intent.eventSequence,
    payload: intent.payload,
    actor_id: intent.actorId,
    timestamp: intent.timestamp
  } satisfies EventRecordInput))
}

function inMemoryPreparedSource(
  prepared: ReturnType<typeof createBatchPreparedRecord>,
  events: ReturnType<typeof createEventRecord>[],
  relativePath: string
): PreparedBatchSource {
  const eventSources: VerifiedEventSource[] = events.map((record, index) => Object.freeze({
    record,
    relativePath,
    segmentId: prepared.segment_id,
    lineNumber: index + 2,
    byteOffset: 0,
    byteEnd: 0
  }))
  return Object.freeze({
    prepared,
    events: Object.freeze(eventSources),
    committed: null,
    relativePath,
    segmentId: prepared.segment_id,
    preparedLineNumber: 1,
    offsetStart: 0,
    offsetEnd: 0
  })
}

type ActiveSegmentDecision = Readonly<
  | { action: 'CREATE_FIRST'; segmentId: string }
  | { action: 'OPEN_CURRENT'; segmentId: string; active: SegmentIndexEntryV1 }
  | { action: 'ROTATE'; segmentId: string; active: SegmentIndexEntryV1 }
>

function decideActiveSegment(options: {
  index: SegmentIndexV1
  candidatePreparedBytes: number
}): ActiveSegmentDecision {
  const active = options.index.segments.at(-1)
  if (!active) {
    return Object.freeze({ action: 'CREATE_FIRST', segmentId: 'seg_000000000001' })
  }
  if (active.has_uncommitted_tail) {
    throw new EventBatchCoordinatorError('SEGMENT_NOT_READY', 'active segment has a prepared batch requiring recovery')
  }
  if (shouldRotateBeforePrepare({
    currentBytes: active.byte_size,
    confirmedBatchCount: active.confirmed_batch_count,
    preparedBatchBytes: options.candidatePreparedBytes
  })) {
    const segmentId = segmentIdForOrdinal(segmentOrdinalFromId(active.segment_id) + 1)
    return Object.freeze({ action: 'ROTATE', segmentId, active })
  }
  return Object.freeze({ action: 'OPEN_CURRENT', segmentId: active.segment_id, active })
}

function openDecidedSegment(options: {
  files: SegmentFilePort
  index: SegmentIndexV1
  decision: ActiveSegmentDecision
  now: string
}): SegmentStore {
  if (options.decision.action === 'CREATE_FIRST') {
    return SegmentStore.create(options.files, {
      segmentOrdinal: 1,
      nextBatchSequence: 1,
      previousBatchHash: 'GENESIS'
    })
  }
  const active = options.decision.active
  const store = SegmentStore.open(options.files, {
    segmentOrdinal: segmentOrdinalFromId(active.segment_id),
    expectedByteSize: active.byte_size,
    expectedFileHash: active.segment_file_hash,
    confirmedBatchCount: active.confirmed_batch_count,
    nextBatchSequence: options.index.last_global_batch_sequence + 1,
    previousBatchHash: options.index.last_batch_hash
  })
  if (options.decision.action === 'ROTATE') {
    store.seal(options.now)
    return SegmentStore.create(options.files, {
      segmentOrdinal: segmentOrdinalFromId(active.segment_id) + 1,
      nextBatchSequence: options.index.last_global_batch_sequence + 1,
      previousBatchHash: options.index.last_batch_hash
    })
  }
  return store
}

export function reconcileAndPersistSegmentIndex(options: {
  capability: DurableFileCapability
  legacyAnchor: LegacyAnchorV1 | null
  operationId: string
}): Readonly<{ status: 'CURRENT' | 'PERSISTED'; index: SegmentIndexV1; sha256: string }> {
  const existing = readSegmentIndexFile(options.capability)
  const reconciliation = reconcileSegmentIndex({
    existing: existing?.index ?? null,
    sources: loadSegmentSources(options.capability),
    legacyAnchor: options.legacyAnchor
  })
  if (reconciliation.status === 'CURRENT') {
    if (!existing) throw new EventBatchCoordinatorError('INDEX_CONFLICT', 'CURRENT index has no persisted file')
    return Object.freeze({ status: 'CURRENT', index: reconciliation.index, sha256: existing.snapshot.sha256 })
  }
  const published = writeSegmentIndexAtomic({
    capability: options.capability,
    index: reconciliation.index,
    expectedSha256: existing?.snapshot.sha256 ?? null,
    operationId: options.operationId
  })
  return Object.freeze({ status: 'PERSISTED', index: reconciliation.index, sha256: published.sha256 })
}

export function confirmAppliedBatchFenced(options: {
  database: DBAdapter
  commandStore: DurableCommandStore
  lease: Readonly<{ commandId: string; leaseOwner: string; generation: number }>
  expectedEnvelope?: CommandEnvelopeV2
  source: PreparedBatchSource
  confirmedAt: string
}): DurableCommandRow {
  return options.database.immediateTransaction(() => {
    let command: DurableCommandRow
    try {
      command = options.commandStore.assertLease({
        commandId: options.lease.commandId,
        leaseOwner: options.lease.leaseOwner,
        generation: options.lease.generation,
        now: options.confirmedAt
      })
    } catch (error) {
      if (error instanceof DurableCommandStoreError && error.code === 'FENCED') {
        throw new EventBatchCoordinatorError('FENCED', 'batch confirmation lease was fenced')
      }
      throw error
    }
    if (options.expectedEnvelope) assertEnvelopeRow(options.expectedEnvelope, command)
    const row = options.database.prepare(
      'SELECT * FROM applied_event_batch WHERE batch_id = ?'
    ).get(options.source.prepared.batch_id) as Record<string, unknown> | undefined
    if (!row || row.command_id !== command.commandId || row.batch_hash !== options.source.prepared.batch_hash) {
      throw new EventBatchCoordinatorError('BATCH_CONFIRM_CONFLICT', 'applied batch identity is missing or conflicting')
    }
    if (row.batch_status === 'CONFIRMED') return command
    if (row.batch_status !== 'APPLIED') {
      throw new EventBatchCoordinatorError('BATCH_CONFIRM_CONFLICT', 'applied batch status is invalid')
    }
    options.database.prepare(
      `UPDATE applied_event_batch
          SET batch_status = 'CONFIRMED', confirmed_at = ?
        WHERE batch_id = ? AND batch_status = 'APPLIED' AND batch_hash = ?`
    ).run(options.confirmedAt, options.source.prepared.batch_id, options.source.prepared.batch_hash)
    const confirmed = options.database.prepare(
      'SELECT batch_status, confirmed_at FROM applied_event_batch WHERE batch_id = ?'
    ).get(options.source.prepared.batch_id) as Record<string, unknown> | undefined
    if (!confirmed || confirmed.batch_status !== 'CONFIRMED' || confirmed.confirmed_at !== options.confirmedAt) {
      throw new EventBatchCoordinatorError('BATCH_CONFIRM_CONFLICT', 'batch confirmation update did not affect the exact row')
    }
    return command
  })()
}

function isProtocolCorruption(error: unknown): boolean {
  return error instanceof PreparedFactRegistryError
    || (error instanceof ProjectionSourceError && error.code !== 'AUTHORITY_REJECTED')
    || (error instanceof EventBatchCoordinatorError
      && ['BATCH_CONFIRM_CONFLICT', 'INDEX_CONFLICT', 'PREPARED_SOURCE_MISSING'].includes(error.code))
}

export class EventBatchCoordinator {
  private readonly database: DBAdapter
  private readonly commandStore: DurableCommandStore
  private readonly registry: PreparedFactRegistry
  private readonly capability: DurableFileCapability
  private readonly mutex: FairWriterMutex
  private readonly corruption: RuntimeCorruptionState
  private readonly workerId: string
  private readonly legacyAnchor: LegacyAnchorV1 | null
  private readonly clock: () => Date
  private readonly files: SegmentFilePort
  private readonly fault?: EventBatchFaultInjector

  constructor(dependencies: EventBatchCoordinatorDependencies) {
    this.database = dependencies.database
    this.commandStore = dependencies.commandStore
    this.registry = dependencies.registry
    this.capability = dependencies.fileCapability
    this.mutex = dependencies.writerMutex ?? processWideEventBatchWriterMutex
    this.corruption = dependencies.corruptionState
    this.workerId = dependencies.workerId
    this.legacyAnchor = dependencies.legacyAnchor
    this.clock = dependencies.now ?? (() => new Date())
    this.files = dependencies.segmentFiles ?? dependencies.fileCapability
    this.fault = dependencies.faultInjector
    if (!this.registry.isSealed()) throw new EventBatchCoordinatorError('PLAN_INVALID', 'prepared fact registry must be sealed')
    if (!this.workerId || this.workerId !== this.workerId.trim()) {
      throw new EventBatchCoordinatorError('PLAN_INVALID', 'workerId is invalid')
    }
  }

  async execute<TSnapshot extends CanonicalJsonValue>(options: {
    envelope: CommandEnvelopeV2
    readSnapshot: EventBatchSnapshotLoader<TSnapshot>
    planner: EventBatchPlannerPort<TSnapshot>
  }): Promise<EventBatchExecutionResult> {
    const owner = `batch:${options.envelope.commandId}:${options.envelope.leaseGeneration}`
    return this.mutex.withLock(owner, async () => {
      this.corruption.assertWritable()
      if (options.envelope.leaseOwner !== this.workerId) {
        throw new EventBatchCoordinatorError('COMMAND_NOT_CURRENT', 'coordinator worker does not own the accepted lease')
      }
      const segmentStore = { current: null as SegmentStore | null }
      let ponr = false
      let prepareWriteAttempted = false
      try {
        const leaseNow = nowIso(this.clock)
        const command = this.commandStore.assertLease({
          commandId: options.envelope.commandId,
          leaseOwner: options.envelope.leaseOwner,
          generation: options.envelope.leaseGeneration,
          now: leaseNow
        })
        assertEnvelopeRow(options.envelope, command)
        const snapshot = await options.readSnapshot()
        let plan: CommandPlanV1 | null = freezeCommandPlan(
          await options.planner.plan(Object.freeze({ envelope: options.envelope, snapshot })),
          options.envelope
        )
        this.fault?.hit('AFTER_PLAN', { commandId: command.commandId, batchId: command.eventBatchId })

        if (plan.events.length === 0) {
          this.fault?.hit('BEFORE_RESULT', { commandId: command.commandId, batchId: command.eventBatchId })
          const resultJson = createCommandResultJson(plan.noOpResult)
          const completed = this.commandStore.completeSucceeded({
            commandId: command.commandId,
            leaseOwner: options.envelope.leaseOwner,
            generation: options.envelope.leaseGeneration,
            resultJson,
            now: nowIso(this.clock)
          })
          this.fault?.hit('AFTER_RESULT', { commandId: command.commandId, batchId: command.eventBatchId })
          return Object.freeze({
            status: 'COMPLETED',
            command: completed,
            batch: null,
            publicResult: parseCommandResultJson(resultJson).public_result
          })
        }

        const sources = loadSegmentSources(this.capability)
        const existingIndex = readSegmentIndexFile(this.capability)
        const index = reconcileSegmentIndex({
          existing: existingIndex?.index ?? null,
          sources,
          legacyAnchor: this.legacyAnchor
        }).index
        const events = eventsFromPlan(plan, options.envelope)
        const candidateSegmentId = index.active_segment_id ?? 'seg_000000000001'
        const candidatePrepared = createBatchPreparedRecord({
          batch_id: command.eventBatchId,
          batch_sequence: index.last_global_batch_sequence + 1,
          segment_id: candidateSegmentId,
          command_id: command.commandId,
          request_hash: command.requestHash,
          prepared_lease_generation: options.envelope.leaseGeneration,
          worker_id: this.workerId,
          previous_batch_hash: index.last_batch_hash,
          timestamp: nowIso(this.clock)
        }, events)
        const candidateBytes = validatePreparedBatch(candidatePrepared, events).preparedBytes.length
        const decision = decideActiveSegment({
          index,
          candidatePreparedBytes: candidateBytes
        })
        const prepared = decision.segmentId === candidateSegmentId
          ? candidatePrepared
          : createBatchPreparedRecord({
              ...candidatePrepared,
              segment_id: decision.segmentId
            }, events)
        const plannedSource = inMemoryPreparedSource(prepared, events, segmentRelativePath(prepared.segment_id))
        this.registry.validatePrepared(command, plannedSource)
        this.registry.assertOperationalEffectView(plan.operationalEffects, plannedSource)
        this.registry.assertPreApplyEffectView(plan.preApplyEffects ?? [], plannedSource)
        this.database.immediateTransaction(() => {
          const current = this.commandStore.assertLease({
            commandId: command.commandId,
            leaseOwner: options.envelope.leaseOwner,
            generation: options.envelope.leaseGeneration,
            now: nowIso(this.clock)
          })
          assertEnvelopeRow(options.envelope, current)
          this.fault?.hit('BEFORE_PREPARE', { commandId: command.commandId, batchId: command.eventBatchId })
          segmentStore.current = openDecidedSegment({
            files: this.files,
            index,
            decision,
            now: nowIso(this.clock)
          })
          // A write or fsync error cannot prove that no complete PREPARE reached disk.
          // Preserve PROCESSING so startup recovery can inspect durable facts.
          prepareWriteAttempted = true
          segmentStore.current.appendPrepared(prepared, events)
          ponr = true
          // Nothing after the durability point may depend on planner-owned memory.
          // Recovery must be able to rebuild every remaining action from prepared facts.
          plan = null
        })()
        this.fault?.hit('AFTER_PREPARE_FSYNC', { commandId: command.commandId, batchId: command.eventBatchId })

        const durableSource = loadVerifiedProjectionSources(this.capability)
          .find((source) => source.prepared.batch_id === command.eventBatchId)
        if (!durableSource) throw new EventBatchCoordinatorError('PREPARED_SOURCE_MISSING', 'fsynced prepared batch could not be reloaded')
        this.registry.validatePrepared(command, durableSource)
        for (const event of durableSource.events) {
          this.registry.ensurePreApplyEffects(this.registry.projectorContext({
            database: this.database,
            command,
            batch: durableSource,
            event
          }))
        }
        this.fault?.hit('BEFORE_APPLY', { commandId: command.commandId, batchId: command.eventBatchId })
        applyPreparedBatch({
          database: this.database,
          command,
          source: durableSource,
          registry: this.registry,
          appliedAt: nowIso(this.clock),
          assertAuthorityInTransaction: () => {
            const current = this.commandStore.assertLease({
              commandId: command.commandId,
              leaseOwner: options.envelope.leaseOwner,
              generation: options.envelope.leaseGeneration,
              now: nowIso(this.clock)
            })
            assertEnvelopeRow(options.envelope, current)
          },
          faultInjector: this.fault
        })
        this.fault?.hit('AFTER_APPLY_COMMIT', { commandId: command.commandId, batchId: command.eventBatchId })

        this.database.immediateTransaction(() => {
          const current = this.commandStore.assertLease({
            commandId: command.commandId,
            leaseOwner: options.envelope.leaseOwner,
            generation: options.envelope.leaseGeneration,
            now: nowIso(this.clock)
          })
          assertEnvelopeRow(options.envelope, current)
          this.fault?.hit('BEFORE_CONFIRM', { commandId: command.commandId, batchId: command.eventBatchId })
          segmentStore.current!.appendCommitted(createBatchCommittedRecord({
            batch_id: durableSource.prepared.batch_id,
            batch_sequence: durableSource.prepared.batch_sequence,
            timestamp: nowIso(this.clock)
          }))
        })()
        this.fault?.hit('AFTER_COMMITTED_FSYNC', { commandId: command.commandId, batchId: command.eventBatchId })
        confirmAppliedBatchFenced({
          database: this.database,
          commandStore: this.commandStore,
          lease: {
            commandId: options.envelope.commandId,
            leaseOwner: options.envelope.leaseOwner,
            generation: options.envelope.leaseGeneration
          },
          expectedEnvelope: options.envelope,
          source: durableSource,
          confirmedAt: nowIso(this.clock)
        })
        this.fault?.hit('AFTER_SQLITE_CONFIRM', { commandId: command.commandId, batchId: command.eventBatchId })

        this.database.immediateTransaction(() => {
          const current = this.commandStore.assertLease({
            commandId: command.commandId,
            leaseOwner: options.envelope.leaseOwner,
            generation: options.envelope.leaseGeneration,
            now: nowIso(this.clock)
          })
          assertEnvelopeRow(options.envelope, current)
          this.fault?.hit('BEFORE_INDEX', { commandId: command.commandId, batchId: command.eventBatchId })
          reconcileAndPersistSegmentIndex({
            capability: this.capability,
            legacyAnchor: this.legacyAnchor,
            operationId: `batch-${command.commandId}-${options.envelope.leaseGeneration}`
          })
        })()
        this.fault?.hit('AFTER_INDEX', { commandId: command.commandId, batchId: command.eventBatchId })

        const confirmedSource = loadVerifiedProjectionSources(this.capability)
          .find((source) => source.prepared.batch_id === command.eventBatchId)
        if (!confirmedSource || !confirmedSource.committed) {
          throw new EventBatchCoordinatorError('PREPARED_SOURCE_MISSING', 'confirmed batch could not be reloaded')
        }
        const publicResult = this.registry.resultFromPrepared(command, confirmedSource)
        const resultJson = createCommandResultJson(publicResult)
        this.fault?.hit('BEFORE_RESULT', { commandId: command.commandId, batchId: command.eventBatchId })
        const completed = this.commandStore.completeSucceeded({
          commandId: command.commandId,
          leaseOwner: options.envelope.leaseOwner,
          generation: options.envelope.leaseGeneration,
          resultJson,
          now: nowIso(this.clock)
        })
        this.fault?.hit('AFTER_RESULT', { commandId: command.commandId, batchId: command.eventBatchId })
        return Object.freeze({
          status: 'COMPLETED',
          command: completed,
          batch: confirmedSource,
          publicResult: parseCommandResultJson(resultJson).public_result
        })
      } catch (error) {
        if (!ponr && !prepareWriteAttempted && !(error instanceof InjectedEventBatchFault)) {
          try {
            this.commandStore.markRetryablePrePonrFailure({
              commandId: options.envelope.commandId,
              leaseOwner: options.envelope.leaseOwner,
              generation: options.envelope.leaseGeneration,
              errorCode: PRE_PONR_EXECUTION_ERROR_CODE,
              now: nowIso(this.clock),
              stage: 'PRE_PONR_NO_PREPARE'
            })
          } catch (failure) {
            if (!(failure instanceof DurableCommandStoreError && failure.code === 'FENCED')) throw failure
          }
        }
        if (ponr && !(error instanceof InjectedEventBatchFault) && isProtocolCorruption(error)) {
          this.corruption.transition({
            code: 'EVENT_BATCH_PROTOCOL_CONFLICT',
            evidence: error instanceof Error ? `${error.name}:${error.message}` : String(error),
            detectedAt: nowIso(this.clock)
          })
        }
        if (error instanceof DurableCommandStoreError && error.code === 'FENCED') {
          throw new EventBatchCoordinatorError('FENCED', 'command lease was fenced')
        }
        throw error
      } finally {
        segmentStore.current?.close()
      }
    })
  }
}
