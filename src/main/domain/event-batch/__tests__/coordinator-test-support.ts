import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { buildCommandEnvelopeV2 } from '../../../application/command/command-envelope'
import type { CommandEnvelopeV2 } from '../../../application/command/command-types'
import {
  COMMAND_MAX_ATTEMPTS,
  DurableCommandStore,
  type DurableCommandRow
} from '../../../application/command/durable-command-store'
import { EVENT_BATCH_SCHEMA_SQL } from '../../../db/event-batch-migration'
import type { DBAdapter } from '../../../db/interface'
import { MemoryAdapter } from '../../../db/memory-adapter'
import {
  EventBatchCoordinator,
  type EventBatchPlannerPort
} from '../batch-coordinator'
import {
  BATCH_CONTEXT_SCHEMA_VERSION,
  COMMAND_PLAN_SCHEMA_VERSION,
  createPlannerReadSnapshot,
  type CommandPlanV1,
  type EventIntentV1,
  type PlannerReadSnapshot
} from '../command-plan'
import type { CanonicalJsonValue } from '../canonical-json'
import { DurableFileCapability } from '../file-capability'
import type { EventBatchFaultInjector } from '../fault-injection'
import { PreparedFactRegistry } from '../result-registry'
import { RuntimeCorruptionState } from '../runtime-corruption'
import { FairWriterMutex } from '../writer-mutex'

export const SYNTHETIC_COMMAND_TYPE = 'synthetic:mutate'
export const SYNTHETIC_EVENT_TYPE = 'SYNTHETIC_CHANGED'
export const SYNTHETIC_PROJECTOR = 'synthetic-projector-v1'
export const SYNTHETIC_PLAN_VERSION = 'synthetic-plan-v1'
export const SYNTHETIC_RESULT_VERSION = 'synthetic-result-v1'
export const SYNTHETIC_TIME = '2026-07-29T10:00:00.000Z'

const SYNTHETIC_SCHEMA_SQL = `
CREATE TABLE domain_event_projection (
  event_id TEXT PRIMARY KEY,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_sequence INTEGER NOT NULL CHECK (event_sequence >= 1),
  payload_json TEXT NOT NULL,
  checksum TEXT NOT NULL,
  source_log_path TEXT NOT NULL,
  source_log_line_no INTEGER CHECK (source_log_line_no IS NULL OR source_log_line_no >= 1),
  source_log_byte_offset INTEGER CHECK (source_log_byte_offset IS NULL OR source_log_byte_offset >= 0),
  schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
  sitting_no INTEGER,
  created_at TEXT NOT NULL,
  applied_to_snapshot INTEGER NOT NULL DEFAULT 0 CHECK (applied_to_snapshot IN (0, 1)),
  applied_at TEXT,
  UNIQUE (aggregate_type, aggregate_id, event_sequence)
);
CREATE TABLE synthetic_projection (
  event_id TEXT PRIMARY KEY,
  aggregate_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  value TEXT NOT NULL
);
CREATE TABLE synthetic_effect (
  event_id TEXT PRIMARY KEY,
  effect_value TEXT NOT NULL
);
CREATE TABLE synthetic_infrastructure (
  fixture_id TEXT PRIMARY KEY,
  applied_order INTEGER NOT NULL
);`

function suffix(slot: number): string {
  if (!Number.isSafeInteger(slot) || slot < 1 || slot > 999_999_999_999) throw new Error('invalid synthetic slot')
  return String(slot).padStart(12, '0')
}

export function syntheticIds(slot = 1) {
  const tail = suffix(slot)
  return Object.freeze({
    commandId: `10000000-0000-4000-8000-${tail}`,
    batchId: `20000000-0000-4000-8000-${tail}`,
    clientId: `30000000-0000-4000-8000-${tail}`,
    idempotencyKey: `40000000-0000-4000-8000-${tail}`,
    eventId: (ordinal: number) => `50000000-0000-4000-8000-${suffix(slot * 1000 + ordinal)}`
  })
}

export class TestClock {
  private milliseconds: number

  constructor(value = SYNTHETIC_TIME) {
    this.milliseconds = new Date(value).getTime()
  }

  now = (): Date => new Date(this.milliseconds)

  iso(): string {
    return this.now().toISOString()
  }

  advance(milliseconds: number): void {
    this.milliseconds += milliseconds
  }
}

function requireSyntheticPayload(payload: Readonly<Record<string, CanonicalJsonValue>>): void {
  if (
    typeof payload.value !== 'string'
    || typeof payload.effect_value !== 'string'
    || !Number.isSafeInteger(payload.event_payload_version)
    || (payload.event_payload_version as number) < 1
  ) throw new Error('synthetic payload is invalid')
}

export function createSyntheticRegistry(options: {
  eventPayloadVersions?: readonly number[]
  resultRecipeVersions?: readonly string[]
} = {}): PreparedFactRegistry {
  const registry = new PreparedFactRegistry()
  for (const eventPayloadVersion of options.eventPayloadVersions ?? [1]) {
    registry.registerEvent({
      eventType: SYNTHETIC_EVENT_TYPE,
      eventPayloadVersion,
      projectorName: SYNTHETIC_PROJECTOR,
      validatePayload: (payload) => {
        requireSyntheticPayload(payload)
        if (payload.event_payload_version !== eventPayloadVersion) throw new Error('synthetic payload version conflicts')
      },
      project: ({ database, event }) => {
        const payload = event.record.payload
        database.prepare(
          `INSERT INTO synthetic_projection (event_id, aggregate_id, ordinal, value)
           VALUES (?, ?, ?, ?)`
        ).run(
          event.record.event_id,
          event.record.aggregate_id,
          event.record.event_sequence,
          payload.value
        )
      },
      assertProjected: ({ database, event }) => {
        const row = database.prepare(
          'SELECT * FROM synthetic_projection WHERE event_id = ?'
        ).get(event.record.event_id) as Record<string, unknown> | undefined
        if (
          !row
          || row.aggregate_id !== event.record.aggregate_id
          || row.ordinal !== event.record.event_sequence
          || row.value !== event.record.payload.value
        ) throw new Error(`synthetic projection conflicts for ${event.record.event_id}`)
      },
      operationalEffects: [{
        effectType: 'SYNTHETIC_EFFECT',
        effectVersion: 1,
        apply: ({ database, event }) => {
          database.prepare(
            'INSERT INTO synthetic_effect (event_id, effect_value) VALUES (?, ?)'
          ).run(event.record.event_id, event.record.payload.effect_value)
        },
        assertApplied: ({ database, event }) => {
          const row = database.prepare(
            'SELECT effect_value FROM synthetic_effect WHERE event_id = ?'
          ).get(event.record.event_id) as Record<string, unknown> | undefined
          if (!row || row.effect_value !== event.record.payload.effect_value) {
            throw new Error(`synthetic effect conflicts for ${event.record.event_id}`)
          }
        }
      }]
    })
  }
  for (const resultRecipeVersion of options.resultRecipeVersions ?? [SYNTHETIC_RESULT_VERSION]) {
    registry.registerResult({
      commandType: SYNTHETIC_COMMAND_TYPE,
      resultRecipeVersion,
      fromPrepared: ({ batch }) => ({
        success: true,
        event_count: batch.events.length,
        values: batch.events.map((event) => event.record.payload.value as string)
      })
    })
  }
  return registry.seal()
}

export interface SyntheticHarness {
  readonly root: string
  readonly database: MemoryAdapter
  readonly store: DurableCommandStore
  readonly capability: DurableFileCapability
  readonly registry: PreparedFactRegistry
  readonly mutex: FairWriterMutex
  readonly corruption: RuntimeCorruptionState
  readonly clock: TestClock
  close(): void
}

export async function createSyntheticDatabase(): Promise<MemoryAdapter> {
  const database = await MemoryAdapter.create()
  database.exec('PRAGMA foreign_keys = ON;')
  database.exec(EVENT_BATCH_SCHEMA_SQL)
  database.exec(SYNTHETIC_SCHEMA_SQL)
  return database
}

export async function createSyntheticHarness(): Promise<SyntheticHarness> {
  const root = mkdtempSync(join(tmpdir(), 'svets-m5b-coordinator-'))
  const database = await createSyntheticDatabase()
  const harness: SyntheticHarness = {
    root,
    database,
    store: new DurableCommandStore(database),
    capability: new DurableFileCapability(root),
    registry: createSyntheticRegistry(),
    mutex: new FairWriterMutex(),
    corruption: new RuntimeCorruptionState(),
    clock: new TestClock(),
    close: () => {
      database.close()
      rmSync(root, { recursive: true, force: true })
    }
  }
  return Object.freeze(harness)
}

export interface AcceptedSyntheticCommand {
  readonly row: DurableCommandRow
  readonly envelope: CommandEnvelopeV2
}

export function acceptSyntheticCommand(options: {
  harness: SyntheticHarness
  slot?: number
  workerId?: string
  commandType?: string
}): AcceptedSyntheticCommand {
  const slot = options.slot ?? 1
  const workerId = options.workerId ?? 'worker-a'
  const commandType = options.commandType ?? SYNTHETIC_COMMAND_TYPE
  const ids = syntheticIds(slot)
  const registered = options.harness.store.registerOrLoad({
    commandId: ids.commandId,
    idempotencyKey: ids.idempotencyKey,
    clientInstanceId: ids.clientId,
    commandType,
    actorId: 'teacher-1',
    deviceId: 'device-1',
    authSessionId: 'auth-session-1',
    requestHash: String(slot % 10).repeat(64),
    eventBatchId: ids.batchId,
    createdAt: options.harness.clock.iso(),
    maxAttempts: COMMAND_MAX_ATTEMPTS
  }).row
  const row = options.harness.store.acquireLease({
    commandId: registered.commandId,
    seenGeneration: registered.currentLeaseGeneration,
    workerId,
    now: options.harness.clock.iso(),
    allowFailed: true
  })
  if (!row) throw new Error('synthetic command lease was not acquired')
  const envelope = buildCommandEnvelopeV2({
    commandId: row.commandId,
    commandType: row.commandType,
    source: 'INTERNAL',
    actor: {
      kind: 'USER',
      userId: row.actorId,
      role: 'ADMIN',
      authSessionId: row.authSessionId!
    },
    target: { aggregate_id: `aggregate-${slot}` },
    payload: { requested_values: [] },
    requestHash: row.requestHash,
    createdAt: row.createdAt,
    clientInstanceId: row.clientInstanceId,
    idempotencyKey: row.idempotencyKey,
    eventBatchId: row.eventBatchId,
    actorId: row.actorId,
    deviceId: row.deviceId,
    authSessionId: row.authSessionId,
    leaseOwner: workerId,
    leaseGeneration: row.currentLeaseGeneration
  })
  return Object.freeze({ row, envelope })
}

export interface SyntheticPlanner extends EventBatchPlannerPort<Readonly<{ seed: string }>> {
  readonly calls: { count: number }
}

export function syntheticPlanner(options: {
  command: AcceptedSyntheticCommand
  slot?: number
  values: readonly string[]
  noOpResult?: Readonly<Record<string, CanonicalJsonValue>>
  eventPayloadVersion?: number
  resultRecipeVersion?: string
}): SyntheticPlanner {
  const slot = options.slot ?? 1
  const ids = syntheticIds(slot)
  const calls = { count: 0 }
  return {
    calls,
    plan: ({ envelope }) => {
      calls.count += 1
      const events = options.values.map((value, index): EventIntentV1 => ({
        eventId: ids.eventId(index + 1),
        aggregateType: 'SYSTEM',
        aggregateId: `aggregate-${slot}`,
        eventType: SYNTHETIC_EVENT_TYPE,
        eventSequence: index + 1,
        payload: {
          event_payload_version: options.eventPayloadVersion ?? 1,
          batch_context: {
            schema_version: BATCH_CONTEXT_SCHEMA_VERSION,
            plan_version: SYNTHETIC_PLAN_VERSION,
            result_recipe_version: options.resultRecipeVersion ?? SYNTHETIC_RESULT_VERSION,
            root_command_type: envelope.commandType,
            root_command_id: envelope.commandId,
            child_ordinal: index
          },
          value,
          effect_value: `effect:${value}`
        },
        actorId: envelope.actorId,
        timestamp: SYNTHETIC_TIME
      }))
      return {
        schemaVersion: COMMAND_PLAN_SCHEMA_VERSION,
        commandId: envelope.commandId,
        commandType: envelope.commandType,
        planVersion: SYNTHETIC_PLAN_VERSION,
        resultRecipeVersion: options.resultRecipeVersion ?? SYNTHETIC_RESULT_VERSION,
        events,
        operationalEffects: events.map((event) => ({
          sourceEventId: event.eventId,
          eventType: event.eventType,
          effectType: 'SYNTHETIC_EFFECT',
          effectVersion: 1
        })),
        noOpResult: events.length === 0 ? options.noOpResult ?? { success: true, no_op: true } : null
      } satisfies CommandPlanV1
    }
  }
}

export function syntheticSnapshot(): PlannerReadSnapshot<Readonly<{ seed: string }>> {
  return createPlannerReadSnapshot({ seed: 'stable' })
}

export function coordinator(options: {
  harness: SyntheticHarness
  workerId?: string
  faultInjector?: EventBatchFaultInjector
  registry?: PreparedFactRegistry
}): EventBatchCoordinator {
  return new EventBatchCoordinator({
    database: options.harness.database,
    commandStore: options.harness.store,
    registry: options.registry ?? options.harness.registry,
    fileCapability: options.harness.capability,
    writerMutex: options.harness.mutex,
    corruptionState: options.harness.corruption,
    workerId: options.workerId ?? 'worker-a',
    legacyAnchor: null,
    now: options.harness.clock.now,
    faultInjector: options.faultInjector
  })
}

export function rowCount(database: DBAdapter, table: string): number {
  return (database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count
}
