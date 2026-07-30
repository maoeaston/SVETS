import { createHash } from 'crypto'
import type { DBAdapter } from '../../db/interface'
import {
  DurableCommandStore,
  DurableCommandStoreError,
  type DurableCommandRow
} from '../../application/command/durable-command-store'
import {
  createCommandResultJson
} from '../../application/command/command-result'
import {
  createBatchCommittedRecord,
  validateCommittedForBatch,
  validatePreparedBatch
} from './batch-hash'
import {
  confirmAppliedBatchFenced,
  reconcileAndPersistSegmentIndex
} from './batch-coordinator'
import {
  eventBatchRecordBytes,
  parseEventBatchRecordLine,
  type BatchPreparedRecord,
  type EventRecord
} from './record-types'
import {
  InjectedEventBatchFault,
  type EventBatchFaultInjector
} from './fault-injection'
import {
  DurableFileCapability,
  type StableFileSnapshot
} from './file-capability'
import type { LegacyAnchorV1 } from './legacy-anchor'
import {
  applyPreparedBatch,
  assertPreparedProjectionInCurrentTransaction,
  loadVerifiedProjectionSources,
  type PreparedBatchSource
} from './projection-source'
import { PreparedFactRegistry } from './result-registry'
import {
  buildSegmentIndex,
  loadSegmentSources
} from './segment-index'
import {
  SEGMENT_DIRECTORY,
  segmentOrdinalFromId,
  segmentRelativePath
} from './segment-store'
import { RuntimeCorruptionState } from './runtime-corruption'
import {
  FairWriterMutex,
  processWideEventBatchWriterMutex
} from './writer-mutex'

export class StartupRecoveryError extends Error {
  constructor(
    public readonly code:
      | 'ACTIVE_TAIL_CORRUPT'
      | 'RECOVERY_BUSY'
      | 'COMMAND_MISSING'
      | 'COMMAND_STATE_CONFLICT'
      | 'BATCH_STATE_CONFLICT'
      | 'CURSOR_CONFLICT'
      | 'RESULT_CONFLICT',
    message: string
  ) {
    super(`[event-batch-startup-recovery] ${message}`)
    this.name = 'StartupRecoveryError'
  }
}

export interface StartupRecoveryDependencies {
  readonly database: DBAdapter
  readonly commandStore: DurableCommandStore
  readonly registry: PreparedFactRegistry
  readonly fileCapability: DurableFileCapability
  readonly corruptionState: RuntimeCorruptionState
  readonly workerId: string
  readonly legacyAnchor: LegacyAnchorV1 | null
  readonly writerMutex?: FairWriterMutex
  readonly now?: () => Date
  readonly faultInjector?: EventBatchFaultInjector
}

export interface StartupRecoveryResult {
  readonly repairedTailBytes: number
  readonly appliedBatches: number
  readonly appendedCommitted: number
  readonly confirmedBatches: number
  readonly recoveredResults: number
  readonly resetPrePonrCommands: number
  readonly plannerCalls: 0
}

interface TailInspection {
  readonly truncateOffset: number | null
  readonly tailBytes: Buffer | null
}

function nowIso(clock: () => Date): string {
  const value = clock().toISOString()
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new StartupRecoveryError('BATCH_STATE_CONFLICT', 'clock did not return an exact UTC timestamp')
  }
  return value
}

function operationToken(...parts: readonly (string | number)[]): string {
  return createHash('sha256').update(parts.join('\u0000'), 'utf8').digest('hex').slice(0, 32)
}

function canonicalSegmentFiles(capability: DurableFileCapability): string[] {
  return capability.listRegularFiles(SEGMENT_DIRECTORY).map((path, index) => {
    const segmentId = path.slice(`${SEGMENT_DIRECTORY}/`.length, -'.jsonl'.length)
    if (path !== segmentRelativePath(segmentId) || segmentOrdinalFromId(segmentId) !== index + 1) {
      throw new StartupRecoveryError('ACTIVE_TAIL_CORRUPT', `non-canonical segment path ${path}`)
    }
    return path
  })
}

function inspectActiveTail(snapshot: StableFileSnapshot, segmentId: string): TailInspection {
  const bytes = snapshot.bytes
  let offset = 0
  let mode: 'PREPARED' | 'EVENTS' | 'COMMITTED' = 'PREPARED'
  let batchStart = 0
  let prepared: BatchPreparedRecord | null = null
  let events: EventRecord[] = []

  while (offset < bytes.length) {
    const lf = bytes.indexOf(0x0a, offset)
    if (lf < 0) {
      const truncateOffset = mode === 'EVENTS' ? batchStart : offset
      return {
        truncateOffset,
        tailBytes: Buffer.from(bytes.subarray(truncateOffset))
      }
    }
    const lineEnd = lf + 1
    let record
    try {
      record = parseEventBatchRecordLine(bytes.subarray(offset, lineEnd))
    } catch (error) {
      throw new StartupRecoveryError(
        'ACTIVE_TAIL_CORRUPT',
        `${segmentId} has a complete malformed record at byte ${offset}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
    if (mode === 'PREPARED') {
      if (record.type !== 'BATCH_PREPARED' || record.segment_id !== segmentId) {
        throw new StartupRecoveryError('ACTIVE_TAIL_CORRUPT', `${segmentId} expected BATCH_PREPARED at byte ${offset}`)
      }
      batchStart = offset
      prepared = record
      events = []
      mode = 'EVENTS'
    } else if (mode === 'EVENTS') {
      if (record.type !== 'EVENT') {
        throw new StartupRecoveryError('ACTIVE_TAIL_CORRUPT', `${prepared!.batch_id} expected EVENT at byte ${offset}`)
      }
      events.push(record)
      if (events.length === prepared!.event_count) {
        try {
          validatePreparedBatch(prepared!, events)
        } catch (error) {
          throw new StartupRecoveryError(
            'ACTIVE_TAIL_CORRUPT',
            `${prepared!.batch_id} prepared facts conflict: ${error instanceof Error ? error.message : String(error)}`
          )
        }
        mode = 'COMMITTED'
      }
    } else {
      if (record.type !== 'BATCH_COMMITTED') {
        throw new StartupRecoveryError('ACTIVE_TAIL_CORRUPT', `${prepared!.batch_id} is followed by a non-COMMITTED record`)
      }
      try {
        validateCommittedForBatch(prepared!, record)
      } catch (error) {
        throw new StartupRecoveryError(
          'ACTIVE_TAIL_CORRUPT',
          `${prepared!.batch_id} COMMITTED conflicts: ${error instanceof Error ? error.message : String(error)}`
        )
      }
      prepared = null
      events = []
      mode = 'PREPARED'
    }
    offset = lineEnd
  }

  if (mode === 'EVENTS') {
    return { truncateOffset: batchStart, tailBytes: Buffer.from(bytes.subarray(batchStart)) }
  }
  return { truncateOffset: null, tailBytes: null }
}

function repairActiveTail(options: {
  capability: DurableFileCapability
  legacyAnchor: LegacyAnchorV1 | null
}): number {
  const paths = canonicalSegmentFiles(options.capability)
  if (paths.length === 0) return 0
  const activePath = paths.at(-1)!
  const segmentId = activePath.slice(`${SEGMENT_DIRECTORY}/`.length, -'.jsonl'.length)
  const snapshot = options.capability.readStable(activePath)
  if (!snapshot) throw new StartupRecoveryError('ACTIVE_TAIL_CORRUPT', 'active segment disappeared')
  const inspection = inspectActiveTail(snapshot, segmentId)
  if (inspection.truncateOffset === null || !inspection.tailBytes) {
    buildSegmentIndex({ sources: loadSegmentSources(options.capability), legacyAnchor: options.legacyAnchor })
    return 0
  }

  options.capability.ensureDirectory('event-log/recovery-evidence')
  const archiveId = operationToken(
    segmentId,
    snapshot.sha256,
    inspection.truncateOffset,
    createHash('sha256').update(inspection.tailBytes).digest('hex')
  )
  const archivePath = `event-log/recovery-evidence/active-tail-${archiveId}.bin`
  const existingArchive = options.capability.readStable(archivePath)
  if (existingArchive) {
    if (!existingArchive.bytes.equals(inspection.tailBytes)) {
      throw new StartupRecoveryError('ACTIVE_TAIL_CORRUPT', 'existing tail archive conflicts with the exact recoverable bytes')
    }
  } else {
    const archive = options.capability.createExclusive(archivePath, inspection.tailBytes)
    options.capability.close(archive)
  }

  const handle = options.capability.openAppend(activePath)
  try {
    const state = options.capability.assertHandleIdentity(handle)
    if (state.size !== snapshot.byteSize || options.capability.hashHandle(handle) !== snapshot.sha256) {
      throw new StartupRecoveryError('ACTIVE_TAIL_CORRUPT', 'active segment changed before tail repair')
    }
    options.capability.truncate(handle, inspection.truncateOffset)
    options.capability.syncFile(handle)
  } finally {
    options.capability.close(handle)
  }
  options.capability.syncDirectory(SEGMENT_DIRECTORY)
  buildSegmentIndex({ sources: loadSegmentSources(options.capability), legacyAnchor: options.legacyAnchor })
  return inspection.tailBytes.length
}

function appendCommittedExactlyOnce(options: {
  capability: DurableFileCapability
  source: PreparedBatchSource
  timestamp: string
}): PreparedBatchSource {
  const sources = loadVerifiedProjectionSources(options.capability)
  const current = sources.find((entry) => entry.prepared.batch_id === options.source.prepared.batch_id)
  if (!current) throw new StartupRecoveryError('BATCH_STATE_CONFLICT', 'prepared batch disappeared before COMMITTED')
  if (current.committed) return current
  if (sources.at(-1)?.prepared.batch_id !== current.prepared.batch_id) {
    throw new StartupRecoveryError('BATCH_STATE_CONFLICT', 'uncommitted batch is not the active tail')
  }
  const snapshot = options.capability.readStable(current.relativePath)
  if (!snapshot || snapshot.byteSize !== current.offsetEnd) {
    throw new StartupRecoveryError('BATCH_STATE_CONFLICT', 'active segment has bytes after the prepared EVENT range')
  }
  const committed = createBatchCommittedRecord({
    batch_id: current.prepared.batch_id,
    batch_sequence: current.prepared.batch_sequence,
    timestamp: options.timestamp
  })
  const handle = options.capability.openAppend(current.relativePath)
  try {
    if (options.capability.hashHandle(handle) !== snapshot.sha256) {
      throw new StartupRecoveryError('BATCH_STATE_CONFLICT', 'active segment changed before COMMITTED append')
    }
    options.capability.appendExact(handle, eventBatchRecordBytes(committed))
    options.capability.syncFile(handle)
  } finally {
    options.capability.close(handle)
  }
  const reloaded = loadVerifiedProjectionSources(options.capability)
    .find((entry) => entry.prepared.batch_id === current.prepared.batch_id)
  if (!reloaded?.committed) throw new StartupRecoveryError('BATCH_STATE_CONFLICT', 'COMMITTED append did not become durable')
  return reloaded
}

function appendCommittedFenced(options: {
  database: DBAdapter
  store: DurableCommandStore
  command: DurableCommandRow
  capability: DurableFileCapability
  source: PreparedBatchSource
  timestamp: string
}): PreparedBatchSource {
  try {
    return options.database.immediateTransaction(() => {
      options.store.assertLease({
        commandId: options.command.commandId,
        leaseOwner: options.command.leaseOwner!,
        generation: options.command.currentLeaseGeneration,
        now: options.timestamp
      })
      return appendCommittedExactlyOnce({
        capability: options.capability,
        source: options.source,
        timestamp: options.timestamp
      })
    })()
  } catch (error) {
    if (error instanceof DurableCommandStoreError && error.code === 'FENCED') {
      throw new StartupRecoveryError('RECOVERY_BUSY', 'recovery lease was fenced before COMMITTED append')
    }
    throw error
  }
}

function commandForSource(store: DurableCommandStore, source: PreparedBatchSource): DurableCommandRow {
  const row = store.findByCommandId(source.prepared.command_id)
  if (!row) throw new StartupRecoveryError('COMMAND_MISSING', `command ${source.prepared.command_id} is missing`)
  if (
    row.eventBatchId !== source.prepared.batch_id
    || row.requestHash !== source.prepared.request_hash
    || source.prepared.prepared_lease_generation > row.currentLeaseGeneration
  ) throw new StartupRecoveryError('COMMAND_STATE_CONFLICT', `command ${row.commandId} conflicts with prepared facts`)
  return row
}

function ensurePreparedPreApplyEffects(options: {
  database: DBAdapter
  registry: PreparedFactRegistry
  command: DurableCommandRow
  source: PreparedBatchSource
}): void {
  for (const event of options.source.events) {
    options.registry.ensurePreApplyEffects(options.registry.projectorContext({
      database: options.database,
      command: options.command,
      batch: options.source,
      event
    }))
  }
}

function recoveryLease(options: {
  store: DurableCommandStore
  source: PreparedBatchSource
  workerId: string
  now: string
}): DurableCommandRow {
  const row = commandForSource(options.store, options.source)
  if (row.status === 'SUCCEEDED') return row
  if (row.status !== 'PROCESSING' || row.leaseExpiresAt === null) {
    throw new StartupRecoveryError('COMMAND_STATE_CONFLICT', `prepared command ${row.commandId} is ${row.status}`)
  }
  if (row.leaseOwner === options.workerId && row.leaseExpiresAt > options.now) return row
  if (row.leaseExpiresAt > options.now) {
    throw new StartupRecoveryError('RECOVERY_BUSY', `command ${row.commandId} has an active lease`)
  }
  const claimed = options.store.takeoverPreparedLease({
    commandId: row.commandId,
    batchId: row.eventBatchId,
    requestHash: row.requestHash,
    preparedLeaseGeneration: options.source.prepared.prepared_lease_generation,
    seenGeneration: row.currentLeaseGeneration,
    workerId: options.workerId,
    now: options.now
  })
  if (!claimed) throw new StartupRecoveryError('RECOVERY_BUSY', `command ${row.commandId} recovery lease raced`)
  if (claimed.attemptCount !== row.attemptCount) {
    throw new StartupRecoveryError('COMMAND_STATE_CONFLICT', 'post-PONR takeover increased the business attempt count')
  }
  return claimed
}

function appliedRows(database: DBAdapter): Array<Record<string, unknown>> {
  return database.prepare(
    'SELECT * FROM applied_event_batch ORDER BY batch_sequence'
  ).all() as Array<Record<string, unknown>>
}

function appliedRow(database: DBAdapter, batchId: string): Record<string, unknown> | null {
  const row = database.prepare(
    'SELECT * FROM applied_event_batch WHERE batch_id = ?'
  ).get(batchId) as Record<string, unknown> | undefined
  return row ?? null
}

function assertConfirmed(database: DBAdapter, source: PreparedBatchSource): void {
  const row = appliedRow(database, source.prepared.batch_id)
  if (!row || row.batch_status !== 'CONFIRMED' || row.batch_hash !== source.prepared.batch_hash) {
    throw new StartupRecoveryError('BATCH_STATE_CONFLICT', `batch ${source.prepared.batch_id} is not exactly CONFIRMED`)
  }
}

function reconcileCursors(options: {
  database: DBAdapter
  registry: PreparedFactRegistry
  commandStore: DurableCommandStore
  sources: readonly PreparedBatchSource[]
  updatedAt: string
}): void {
  const confirmed = options.sources.filter((source) => {
    const row = appliedRow(options.database, source.prepared.batch_id)
    return row?.batch_status === 'CONFIRMED'
  })
  if (confirmed.length === 0) return
  const latest = confirmed.at(-1)!
  options.database.immediateTransaction(() => {
    for (const source of confirmed) {
      const command = commandForSource(options.commandStore, source)
      assertPreparedProjectionInCurrentTransaction({
        database: options.database,
        command,
        source,
        registry: options.registry
      })
    }
    for (const projectorName of options.registry.projectorNames()) {
      const cursor = options.database.prepare(
        'SELECT * FROM projector_cursor WHERE projector_name = ?'
      ).get(projectorName) as Record<string, unknown> | undefined
      if (!cursor) {
        options.database.prepare(
          `INSERT INTO projector_cursor (
             projector_name, last_batch_id, last_batch_sequence, updated_at
           ) VALUES (?, ?, ?, ?)`
        ).run(projectorName, latest.prepared.batch_id, latest.prepared.batch_sequence, options.updatedAt)
        continue
      }
      const sequence = cursor.last_batch_sequence
      if (!Number.isSafeInteger(sequence) || (sequence as number) < 1 || (sequence as number) > latest.prepared.batch_sequence) {
        throw new StartupRecoveryError('CURSOR_CONFLICT', `${projectorName} cursor is ahead of verified history`)
      }
      const sourceAtCursor = confirmed.find((source) => source.prepared.batch_sequence === sequence)
      if (!sourceAtCursor || sourceAtCursor.prepared.batch_id !== cursor.last_batch_id) {
        throw new StartupRecoveryError('CURSOR_CONFLICT', `${projectorName} cursor ID conflicts with verified sequence`)
      }
      if (sequence === latest.prepared.batch_sequence) continue
      options.database.prepare(
        `UPDATE projector_cursor
            SET last_batch_id = ?, last_batch_sequence = ?, updated_at = ?
          WHERE projector_name = ? AND last_batch_id = ? AND last_batch_sequence = ?`
      ).run(
        latest.prepared.batch_id,
        latest.prepared.batch_sequence,
        options.updatedAt,
        projectorName,
        cursor.last_batch_id,
        sequence
      )
      const updated = options.database.prepare(
        'SELECT last_batch_id, last_batch_sequence FROM projector_cursor WHERE projector_name = ?'
      ).get(projectorName) as Record<string, unknown> | undefined
      if (
        !updated
        || updated.last_batch_id !== latest.prepared.batch_id
        || updated.last_batch_sequence !== latest.prepared.batch_sequence
      ) {
        throw new StartupRecoveryError('CURSOR_CONFLICT', `${projectorName} cursor reconciliation was fenced`)
      }
    }
  })()
}

export class StartupRecovery {
  private readonly database: DBAdapter
  private readonly store: DurableCommandStore
  private readonly registry: PreparedFactRegistry
  private readonly capability: DurableFileCapability
  private readonly corruption: RuntimeCorruptionState
  private readonly workerId: string
  private readonly legacyAnchor: LegacyAnchorV1 | null
  private readonly mutex: FairWriterMutex
  private readonly clock: () => Date
  private readonly fault?: EventBatchFaultInjector

  constructor(dependencies: StartupRecoveryDependencies) {
    this.database = dependencies.database
    this.store = dependencies.commandStore
    this.registry = dependencies.registry
    this.capability = dependencies.fileCapability
    this.corruption = dependencies.corruptionState
    this.workerId = dependencies.workerId
    this.legacyAnchor = dependencies.legacyAnchor
    this.mutex = dependencies.writerMutex ?? processWideEventBatchWriterMutex
    this.clock = dependencies.now ?? (() => new Date())
    this.fault = dependencies.faultInjector
    if (!this.registry.isSealed()) throw new StartupRecoveryError('COMMAND_STATE_CONFLICT', 'prepared registry must be sealed')
  }

  async run(): Promise<StartupRecoveryResult> {
    return this.mutex.withLock(`recovery:${this.workerId}`, async () => {
      this.corruption.assertWritable()
      let repairedTailBytes = 0
      let appliedBatches = 0
      let appendedCommitted = 0
      let confirmedBatches = 0
      let recoveredResults = 0
      let resetPrePonrCommands = 0
      try {
        repairedTailBytes = this.database.immediateTransaction(() => repairActiveTail({
          capability: this.capability,
          legacyAnchor: this.legacyAnchor
        }))()

        let sources = loadVerifiedProjectionSources(this.capability)
        const sourceByBatch = new Map(sources.map((source) => [source.prepared.batch_id, source]))
        for (const row of appliedRows(this.database)) {
          const batchId = String(row.batch_id ?? '')
          const source = sourceByBatch.get(batchId)
          if (!source) throw new StartupRecoveryError('BATCH_STATE_CONFLICT', `SQLite batch ${batchId} has no prepared source`)
          if (row.batch_status !== 'APPLIED' && row.batch_status !== 'CONFIRMED') {
            throw new StartupRecoveryError('BATCH_STATE_CONFLICT', `batch ${batchId} has invalid SQLite status`)
          }
          if (row.batch_status === 'CONFIRMED' && !source.committed) {
            throw new StartupRecoveryError(
              'BATCH_STATE_CONFLICT',
              `CONFIRMED batch ${batchId} has no durable COMMITTED record`
            )
          }
          const command = recoveryLease({
            store: this.store,
            source,
            workerId: this.workerId,
            now: nowIso(this.clock)
          })
          if (command.status === 'SUCCEEDED' && row.batch_status !== 'CONFIRMED') {
            throw new StartupRecoveryError('COMMAND_STATE_CONFLICT', 'SUCCEEDED command owns a non-confirmed batch')
          }
          ensurePreparedPreApplyEffects({
            database: this.database,
            registry: this.registry,
            command,
            source
          })
          if (row.batch_status === 'APPLIED') {
            applyPreparedBatch({
              database: this.database,
              command,
              source,
              registry: this.registry,
              appliedAt: String(row.applied_at),
              assertAuthorityInTransaction: () => {
                this.store.assertLease({
                  commandId: command.commandId,
                  leaseOwner: command.leaseOwner!,
                  generation: command.currentLeaseGeneration,
                  now: nowIso(this.clock)
                })
              },
              allowExisting: true
            })
            let confirmedSource = source
            this.fault?.hit('BEFORE_CONFIRM', { commandId: command.commandId, batchId })
            if (!source.committed) {
              confirmedSource = appendCommittedFenced({
                database: this.database,
                store: this.store,
                command,
                capability: this.capability,
                source,
                timestamp: nowIso(this.clock)
              })
              appendedCommitted += 1
              this.fault?.hit('AFTER_COMMITTED_FSYNC', { commandId: command.commandId, batchId })
            }
            confirmAppliedBatchFenced({
              database: this.database,
              commandStore: this.store,
              lease: {
                commandId: command.commandId,
                leaseOwner: command.leaseOwner!,
                generation: command.currentLeaseGeneration
              },
              source: confirmedSource,
              confirmedAt: nowIso(this.clock)
            })
            confirmedBatches += 1
            this.fault?.hit('AFTER_SQLITE_CONFIRM', { commandId: command.commandId, batchId })
          }
        }

        sources = loadVerifiedProjectionSources(this.capability)
        for (const source of sources) {
          const existing = appliedRow(this.database, source.prepared.batch_id)
          if (existing) continue
          if (source.committed) {
            throw new StartupRecoveryError('BATCH_STATE_CONFLICT', `COMMITTED batch ${source.prepared.batch_id} is missing SQLite APPLY`)
          }
          const command = recoveryLease({
            store: this.store,
            source,
            workerId: this.workerId,
            now: nowIso(this.clock)
          })
          ensurePreparedPreApplyEffects({
            database: this.database,
            registry: this.registry,
            command,
            source
          })
          this.fault?.hit('BEFORE_APPLY', { commandId: command.commandId, batchId: source.prepared.batch_id })
          applyPreparedBatch({
            database: this.database,
            command,
            source,
            registry: this.registry,
            appliedAt: nowIso(this.clock),
            assertAuthorityInTransaction: () => {
              this.store.assertLease({
                commandId: command.commandId,
                leaseOwner: command.leaseOwner!,
                generation: command.currentLeaseGeneration,
                now: nowIso(this.clock)
              })
            },
            faultInjector: this.fault
          })
          appliedBatches += 1
          this.fault?.hit('AFTER_APPLY_COMMIT', { commandId: command.commandId, batchId: source.prepared.batch_id })
          this.fault?.hit('BEFORE_CONFIRM', { commandId: command.commandId, batchId: source.prepared.batch_id })
          const confirmedSource = appendCommittedFenced({
            database: this.database,
            store: this.store,
            command,
            capability: this.capability,
            source,
            timestamp: nowIso(this.clock)
          })
          appendedCommitted += 1
          this.fault?.hit('AFTER_COMMITTED_FSYNC', {
            commandId: command.commandId,
            batchId: source.prepared.batch_id
          })
          confirmAppliedBatchFenced({
            database: this.database,
            commandStore: this.store,
            lease: {
              commandId: command.commandId,
              leaseOwner: command.leaseOwner!,
              generation: command.currentLeaseGeneration
            },
            source: confirmedSource,
            confirmedAt: nowIso(this.clock)
          })
          confirmedBatches += 1
          this.fault?.hit('AFTER_SQLITE_CONFIRM', {
            commandId: command.commandId,
            batchId: source.prepared.batch_id
          })
        }

        sources = loadVerifiedProjectionSources(this.capability)
        this.fault?.hit('BEFORE_INDEX', { commandId: 'RECOVERY', batchId: 'RECOVERY' })
        this.database.immediateTransaction(() => reconcileAndPersistSegmentIndex({
          capability: this.capability,
          legacyAnchor: this.legacyAnchor,
          operationId: `recovery-${operationToken(this.workerId, sources.length, 'index')}`
        }))()
        this.fault?.hit('AFTER_INDEX', { commandId: 'RECOVERY', batchId: 'RECOVERY' })
        reconcileCursors({
          database: this.database,
          registry: this.registry,
          commandStore: this.store,
          sources,
          updatedAt: nowIso(this.clock)
        })

        for (const source of sources) {
          if (!source.committed) continue
          assertConfirmed(this.database, source)
          let command = commandForSource(this.store, source)
          const expectedResult = createCommandResultJson(this.registry.resultFromPrepared(command, source))
          if (command.status === 'SUCCEEDED') {
            if (command.resultJson !== expectedResult) {
              throw new StartupRecoveryError('RESULT_CONFLICT', `command ${command.commandId} result conflicts with prepared facts`)
            }
            continue
          }
          command = recoveryLease({
            store: this.store,
            source,
            workerId: this.workerId,
            now: nowIso(this.clock)
          })
          this.fault?.hit('BEFORE_RESULT', { commandId: command.commandId, batchId: source.prepared.batch_id })
          this.store.completeSucceeded({
            commandId: command.commandId,
            leaseOwner: command.leaseOwner!,
            generation: command.currentLeaseGeneration,
            resultJson: expectedResult,
            now: nowIso(this.clock)
          })
          recoveredResults += 1
          this.fault?.hit('AFTER_RESULT', { commandId: command.commandId, batchId: source.prepared.batch_id })
        }

        const preparedCommandIds = new Set(sources.map((source) => source.prepared.command_id))
        for (const command of this.store.listProcessing()) {
          if (preparedCommandIds.has(command.commandId)) continue
          if (command.leaseExpiresAt !== null && command.leaseExpiresAt <= nowIso(this.clock)) {
            const reset = this.store.resetExpiredPrePonrForRecovery({
              commandId: command.commandId,
              seenGeneration: command.currentLeaseGeneration,
              now: nowIso(this.clock),
              stage: 'RECOVERY_VERIFIED_NO_PREPARE'
            })
            if (reset) resetPrePonrCommands += 1
          }
        }

        return Object.freeze({
          repairedTailBytes,
          appliedBatches,
          appendedCommitted,
          confirmedBatches,
          recoveredResults,
          resetPrePonrCommands,
          plannerCalls: 0 as const
        })
      } catch (error) {
        if (!(error instanceof InjectedEventBatchFault) && !(error instanceof StartupRecoveryError && error.code === 'RECOVERY_BUSY')) {
          this.corruption.transition({
            code: 'EVENT_BATCH_RECOVERY_CONFLICT',
            evidence: error instanceof Error ? `${error.name}:${error.message}` : String(error),
            detectedAt: nowIso(this.clock)
          })
        }
        throw error
      }
    })
  }
}
