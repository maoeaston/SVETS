import type { ActionLogEntry } from '@shared/types/event-payloads'
import type { DBAdapter } from '../../db/interface'
import {
  DurableCommandStore,
  type DurableCommandRow
} from '../../application/command/durable-command-store'
import { reconcileActionLogEventGroup } from '../recovery'
import { sha256Hex } from './canonical-json'
import { DurableFileCapability } from './file-capability'
import {
  inspectLegacyLogBytes,
  type LegacyLogInspection
} from './legacy-reader'
import {
  validateLegacyAnchor,
  type LegacyAnchorV1
} from './legacy-anchor'
import {
  applyPreparedBatch,
  loadVerifiedProjectionSources,
  type PreparedBatchSource
} from './projection-source'
import { PreparedFactRegistry } from './result-registry'
import {
  buildSegmentIndex,
  loadSegmentSources
} from './segment-index'
import { RuntimeCorruptionState } from './runtime-corruption'
import {
  FairWriterMutex,
  processWideEventBatchWriterMutex
} from './writer-mutex'

export interface MixedReplayInfrastructureFixture {
  /** Stable identifier included in evidence; the fixture itself is not event-sourced. */
  readonly fixtureId: string
  apply(database: DBAdapter): void
  assertApplied(database: DBAdapter): void
}

export interface MixedDomainReplayDependencies {
  readonly database: DBAdapter
  readonly commandStore: DurableCommandStore
  readonly registry: PreparedFactRegistry
  readonly fileCapability: DurableFileCapability
  readonly legacyAnchor: LegacyAnchorV1
  readonly infrastructureFixture: MixedReplayInfrastructureFixture | null
  readonly corruptionState: RuntimeCorruptionState
  readonly writerMutex?: FairWriterMutex
  readonly now?: () => Date
}

export interface MixedDomainReplayResult {
  readonly fixtureId: string
  readonly legacyEventCount: number
  readonly legacyGroupCount: number
  readonly v2BatchCount: number
  readonly v2EventCount: number
  readonly applicationOrder: readonly ['INFRASTRUCTURE_FIXTURE', 'LEGACY', 'V2']
  /** client/key, lease, attempt and complete results still require the paired SQLite backup. */
  readonly commandHistoryRecovered: false
}

export class MixedDomainReplayError extends Error {
  constructor(
    public readonly code:
      | 'INFRASTRUCTURE_FIXTURE_REQUIRED'
      | 'REBUILD_TARGET_NOT_EMPTY'
      | 'LEGACY_ANCHOR_CONFLICT'
      | 'LEGACY_BYTES_CHANGED'
      | 'LEGACY_PROJECTION_CONFLICT'
      | 'V2_BATCH_NOT_COMMITTED'
      | 'COMMAND_FIXTURE_CONFLICT'
      | 'V2_CONFIRM_CONFLICT',
    message: string
  ) {
    super(`[event-batch-mixed-replay] ${message}`)
    this.name = 'MixedDomainReplayError'
  }
}

function exactTimestamp(clock: () => Date): string {
  const value = clock().toISOString()
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || new Date(value).toISOString() !== value) {
    throw new MixedDomainReplayError('COMMAND_FIXTURE_CONFLICT', 'clock did not return an exact UTC timestamp')
  }
  return value
}

function fixtureId(value: string): string {
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(value)) {
    throw new MixedDomainReplayError('INFRASTRUCTURE_FIXTURE_REQUIRED', 'infrastructure fixture ID is invalid')
  }
  return value
}

function expectedLineTermination(inspection: LegacyLogInspection): LegacyAnchorV1['line_termination'] {
  if (inspection.state === 'EMPTY') return 'EMPTY'
  if (inspection.state === 'VALID_LF_TERMINATED') return 'LF'
  if (inspection.state === 'VALID_COMPLETE_EOF') return 'COMPLETE_EOF'
  throw new MixedDomainReplayError('LEGACY_ANCHOR_CONFLICT', 'legacy source still contains an incomplete tail')
}

function verifyLegacyAnchor(anchorValue: LegacyAnchorV1, inspection: LegacyLogInspection): LegacyAnchorV1 {
  const anchor = validateLegacyAnchor(anchorValue)
  if (
    inspection.originalByteLength !== anchor.byte_length
    || inspection.originalSha256 !== anchor.sha256
    || inspection.events.length !== anchor.record_count
    || inspection.lastEventId !== anchor.last_event_id
    || inspection.lastEventTimestamp !== anchor.last_event_timestamp
    || expectedLineTermination(inspection) !== anchor.line_termination
  ) {
    throw new MixedDomainReplayError('LEGACY_ANCHOR_CONFLICT', 'legacy bytes do not match their sealed anchor')
  }
  return anchor
}

function count(database: DBAdapter, table: string): number {
  const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count?: unknown } | undefined
  if (!row || !Number.isSafeInteger(row.count) || (row.count as number) < 0) {
    throw new MixedDomainReplayError('REBUILD_TARGET_NOT_EMPTY', `${table} count is invalid`)
  }
  return row.count as number
}

function assertRebuildTargetEmpty(database: DBAdapter): void {
  for (const table of ['domain_event_projection', 'applied_event_batch', 'processed_event', 'projector_cursor']) {
    if (count(database, table) !== 0) {
      throw new MixedDomainReplayError('REBUILD_TARGET_NOT_EMPTY', `${table} must be empty before mixed rebuild`)
    }
  }
}

function eventsForGroup(
  inspection: LegacyLogInspection,
  eventIds: readonly string[]
): ActionLogEntry[] {
  const byId = new Map(inspection.events.map((event) => [event.event_id, event]))
  return eventIds.map((eventId) => {
    const event = byId.get(eventId)
    if (!event) throw new MixedDomainReplayError('LEGACY_ANCHOR_CONFLICT', `legacy group references missing EVENT ${eventId}`)
    return event
  })
}

function assertLegacyProjection(database: DBAdapter, event: ActionLogEntry, relativePath: string): void {
  const row = database.prepare(
    `SELECT event_id, aggregate_type, aggregate_id, event_type, event_sequence,
            payload_json, checksum, source_log_path, schema_version, created_at
       FROM domain_event_projection
      WHERE event_id = ?`
  ).get(event.event_id) as Record<string, unknown> | undefined
  if (
    !row
    || row.event_id !== event.event_id
    || row.aggregate_type !== event.aggregate_type
    || row.aggregate_id !== event.aggregate_id
    || row.event_type !== event.event_type
    || row.event_sequence !== event.event_sequence
    || row.payload_json !== JSON.stringify(event.payload)
    || row.checksum !== event.checksum
    || row.source_log_path !== relativePath
    || row.schema_version !== event.schema_version
    || row.created_at !== event.created_at
  ) {
    throw new MixedDomainReplayError('LEGACY_PROJECTION_CONFLICT', `legacy EVENT ${event.event_id} projection conflicts`)
  }
}

function commandForRebuild(store: DurableCommandStore, source: PreparedBatchSource): DurableCommandRow {
  const command = store.findByCommandId(source.prepared.command_id)
  if (
    !command
    || command.eventBatchId !== source.prepared.batch_id
    || command.requestHash !== source.prepared.request_hash
    || command.currentLeaseGeneration < source.prepared.prepared_lease_generation
  ) {
    throw new MixedDomainReplayError(
      'COMMAND_FIXTURE_CONFLICT',
      `fixture command ${source.prepared.command_id} does not match prepared facts`
    )
  }
  return command
}

function assertCommandUnchanged(
  store: DurableCommandStore,
  expected: DurableCommandRow,
  source: PreparedBatchSource
): void {
  const current = commandForRebuild(store, source)
  if (
    current.commandType !== expected.commandType
    || current.actorId !== expected.actorId
    || current.deviceId !== expected.deviceId
    || current.authSessionId !== expected.authSessionId
    || current.clientInstanceId !== expected.clientInstanceId
    || current.idempotencyKey !== expected.idempotencyKey
    || current.createdAt !== expected.createdAt
  ) throw new MixedDomainReplayError('COMMAND_FIXTURE_CONFLICT', `fixture command ${expected.commandId} changed during rebuild`)
}

function confirmRebuiltBatch(database: DBAdapter, source: PreparedBatchSource): void {
  if (!source.committed) {
    throw new MixedDomainReplayError('V2_BATCH_NOT_COMMITTED', `batch ${source.prepared.batch_id} has no COMMITTED record`)
  }
  const committedAt = source.committed.record.timestamp
  database.immediateTransaction(() => {
    const before = database.prepare(
      'SELECT batch_status, batch_hash FROM applied_event_batch WHERE batch_id = ?'
    ).get(source.prepared.batch_id) as Record<string, unknown> | undefined
    if (!before || before.batch_status !== 'APPLIED' || before.batch_hash !== source.prepared.batch_hash) {
      throw new MixedDomainReplayError('V2_CONFIRM_CONFLICT', `batch ${source.prepared.batch_id} is not exactly APPLIED`)
    }
    database.prepare(
      `UPDATE applied_event_batch
          SET batch_status = 'CONFIRMED', confirmed_at = ?
        WHERE batch_id = ? AND batch_status = 'APPLIED' AND batch_hash = ?`
    ).run(committedAt, source.prepared.batch_id, source.prepared.batch_hash)
    const after = database.prepare(
      'SELECT batch_status, confirmed_at FROM applied_event_batch WHERE batch_id = ?'
    ).get(source.prepared.batch_id) as Record<string, unknown> | undefined
    if (!after || after.batch_status !== 'CONFIRMED' || after.confirmed_at !== committedAt) {
      throw new MixedDomainReplayError('V2_CONFIRM_CONFLICT', `batch ${source.prepared.batch_id} confirmation was not exact`)
    }
  })()
}

export class MixedDomainReplay {
  private readonly database: DBAdapter
  private readonly store: DurableCommandStore
  private readonly registry: PreparedFactRegistry
  private readonly capability: DurableFileCapability
  private readonly anchor: LegacyAnchorV1
  private readonly fixture: MixedReplayInfrastructureFixture | null
  private readonly corruption: RuntimeCorruptionState
  private readonly mutex: FairWriterMutex
  private readonly clock: () => Date

  constructor(dependencies: MixedDomainReplayDependencies) {
    this.database = dependencies.database
    this.store = dependencies.commandStore
    this.registry = dependencies.registry
    this.capability = dependencies.fileCapability
    this.anchor = dependencies.legacyAnchor
    this.fixture = dependencies.infrastructureFixture
    this.corruption = dependencies.corruptionState
    this.mutex = dependencies.writerMutex ?? processWideEventBatchWriterMutex
    this.clock = dependencies.now ?? (() => new Date())
    if (!this.registry.isSealed()) {
      throw new MixedDomainReplayError('COMMAND_FIXTURE_CONFLICT', 'prepared registry must be sealed')
    }
  }

  async run(): Promise<MixedDomainReplayResult> {
    if (!this.fixture) {
      throw new MixedDomainReplayError(
        'INFRASTRUCTURE_FIXTURE_REQUIRED',
        'mixed rebuild requires an explicit user/student/strategy/question/auth infrastructure fixture'
      )
    }
    const fixture = this.fixture
    const stableFixtureId = fixtureId(fixture.fixtureId)
    return this.mutex.withLock(`mixed-rebuild:${stableFixtureId}`, async () => {
      this.corruption.assertWritable()
      try {
        assertRebuildTargetEmpty(this.database)
        const anchor = validateLegacyAnchor(this.anchor)
        const legacySnapshot = this.capability.readStable(anchor.relative_path)
        if (!legacySnapshot) {
          throw new MixedDomainReplayError('LEGACY_ANCHOR_CONFLICT', 'sealed legacy source is missing')
        }
        const inspection = inspectLegacyLogBytes(legacySnapshot.bytes)
        verifyLegacyAnchor(anchor, inspection)

        const v2Sources = loadVerifiedProjectionSources(this.capability)
        buildSegmentIndex({ sources: loadSegmentSources(this.capability), legacyAnchor: anchor })
        if (v2Sources.some((source) => !source.committed)) {
          throw new MixedDomainReplayError('V2_BATCH_NOT_COMMITTED', 'mixed domain rebuild only accepts committed v2 history')
        }
        const allEventIds = new Set(inspection.events.map((event) => event.event_id))
        for (const source of v2Sources) {
          for (const event of source.events) {
            if (allEventIds.has(event.record.event_id)) {
              throw new MixedDomainReplayError('LEGACY_PROJECTION_CONFLICT', `EVENT ${event.record.event_id} exists in both generations`)
            }
            allEventIds.add(event.record.event_id)
          }
        }

        fixture.apply(this.database)
        fixture.assertApplied(this.database)
        assertRebuildTargetEmpty(this.database)

        for (const group of inspection.groups) {
          reconcileActionLogEventGroup(
            this.database,
            eventsForGroup(inspection, group.eventIds),
            anchor.relative_path
          )
        }
        for (const event of inspection.events) {
          assertLegacyProjection(this.database, event, anchor.relative_path)
        }
        const legacyAfter = this.capability.readStable(anchor.relative_path)
        if (
          !legacyAfter
          || legacyAfter.identity.device !== legacySnapshot.identity.device
          || legacyAfter.identity.inode !== legacySnapshot.identity.inode
          || legacyAfter.byteSize !== legacySnapshot.byteSize
          || legacyAfter.sha256 !== legacySnapshot.sha256
          || sha256Hex(legacyAfter.bytes) !== anchor.sha256
        ) throw new MixedDomainReplayError('LEGACY_BYTES_CHANGED', 'legacy source changed during replay')

        for (const source of v2Sources) {
          const command = commandForRebuild(this.store, source)
          this.registry.validatePrepared(command, source)
          applyPreparedBatch({
            database: this.database,
            command,
            source,
            registry: this.registry,
            appliedAt: source.committed!.record.timestamp,
            assertAuthorityInTransaction: () => assertCommandUnchanged(this.store, command, source)
          })
          confirmRebuiltBatch(this.database, source)
        }

        return Object.freeze({
          fixtureId: stableFixtureId,
          legacyEventCount: inspection.events.length,
          legacyGroupCount: inspection.groups.length,
          v2BatchCount: v2Sources.length,
          v2EventCount: v2Sources.reduce((sum, source) => sum + source.events.length, 0),
          applicationOrder: Object.freeze(['INFRASTRUCTURE_FIXTURE', 'LEGACY', 'V2'] as const),
          commandHistoryRecovered: false as const
        })
      } catch (error) {
        this.corruption.transition({
          code: 'EVENT_BATCH_MIXED_REPLAY_CONFLICT',
          evidence: error instanceof Error ? `${error.name}:${error.message}` : String(error),
          detectedAt: exactTimestamp(this.clock)
        })
        throw error
      }
    })
  }
}
