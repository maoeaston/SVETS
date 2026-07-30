import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { CommandEnvelopeV2 } from '../../command/command-types'
import { buildCommandEnvelopeV2 } from '../../command/command-envelope'
import {
  COMMAND_MAX_ATTEMPTS,
  DurableCommandStore,
  type DurableCommandRow
} from '../../command/durable-command-store'
import { EVENT_BATCH_SCHEMA_SQL } from '../../../db/event-batch-migration'
import { MemoryAdapter } from '../../../db/memory-adapter'
import { createTestDb } from '../../../db/test-helpers'
import { EventBatchCoordinator } from '../../../domain/event-batch/batch-coordinator'
import type { EventBatchFaultInjector } from '../../../domain/event-batch/fault-injection'
import { DurableFileCapability } from '../../../domain/event-batch/file-capability'
import { RuntimeCorruptionState } from '../../../domain/event-batch/runtime-corruption'
import { FairWriterMutex } from '../../../domain/event-batch/writer-mutex'
import { registerTrainingPreparedFacts } from '../../../domain/projectors/training-projector'

export const TRAINING_TEST_TIME = '2026-07-29T10:00:00.000Z'
export const TRAINING_TEST_APP_VERSION = '1.0.0-alpha.1'

function suffix(slot: number): string {
  if (!Number.isSafeInteger(slot) || slot < 1 || slot > 999_999_999_999) throw new Error('invalid training test slot')
  return String(slot).padStart(12, '0')
}

function ids(slot: number) {
  return {
    commandId: `71000000-0000-4000-8000-${suffix(slot)}`,
    batchId: `72000000-0000-4000-8000-${suffix(slot)}`,
    clientId: `73000000-0000-4000-8000-${suffix(slot)}`,
    idempotencyKey: `74000000-0000-4000-8000-${suffix(slot)}`
  }
}

export interface TrainingBatchHarness {
  readonly root: string
  readonly database: MemoryAdapter
  readonly store: DurableCommandStore
  readonly capability: DurableFileCapability
  readonly coordinator: EventBatchCoordinator
  close(): void
}

export async function createTrainingBatchHarness(options: Readonly<{
  faultInjector?: EventBatchFaultInjector
  root?: string
}> = {}): Promise<TrainingBatchHarness> {
  const ownsRoot = options.root === undefined
  const root = options.root ?? mkdtempSync(join(tmpdir(), 'svets-m5b-training-'))
  const database = await createTestDb()
  database.exec(EVENT_BATCH_SCHEMA_SQL)
  const store = new DurableCommandStore(database)
  const capability = new DurableFileCapability(root)
  const coordinator = new EventBatchCoordinator({
    database,
    commandStore: store,
    registry: registerTrainingPreparedFacts().seal(),
    fileCapability: capability,
    writerMutex: new FairWriterMutex(),
    corruptionState: new RuntimeCorruptionState(),
    workerId: 'training-worker',
    legacyAnchor: null,
    now: () => new Date(TRAINING_TEST_TIME),
    faultInjector: options.faultInjector
  })
  return {
    root,
    database,
    store,
    capability,
    coordinator,
    close: () => {
      database.close()
      if (ownsRoot) rmSync(root, { recursive: true, force: true })
    }
  }
}

export function acceptTrainingCommand(options: Readonly<{
  harness: TrainingBatchHarness
  slot: number
  commandType: string
  actor: Readonly<{ userId: string; role: 'TEACHER' | 'STUDENT' }>
  target: Record<string, unknown>
  payload?: Record<string, unknown>
}>): Readonly<{ row: DurableCommandRow; envelope: CommandEnvelopeV2 }> {
  const stableIds = ids(options.slot)
  const registered = options.harness.store.registerOrLoad({
    commandId: stableIds.commandId,
    idempotencyKey: stableIds.idempotencyKey,
    clientInstanceId: stableIds.clientId,
    commandType: options.commandType,
    actorId: options.actor.userId,
    deviceId: 'training-device',
    authSessionId: `training-auth-${options.actor.userId}`,
    requestHash: String(options.slot % 10).repeat(64),
    eventBatchId: stableIds.batchId,
    createdAt: TRAINING_TEST_TIME,
    maxAttempts: COMMAND_MAX_ATTEMPTS
  }).row
  const row = options.harness.store.acquireLease({
    commandId: registered.commandId,
    seenGeneration: registered.currentLeaseGeneration,
    workerId: 'training-worker',
    now: TRAINING_TEST_TIME,
    allowFailed: true
  })
  if (!row) throw new Error('training command lease was not acquired')
  return {
    row,
    envelope: buildCommandEnvelopeV2({
      commandId: row.commandId,
      commandType: row.commandType,
      source: 'INTERNAL',
      actor: { kind: 'USER', userId: row.actorId, role: options.actor.role, authSessionId: row.authSessionId! },
      target: options.target,
      payload: options.payload ?? {},
      requestHash: row.requestHash,
      createdAt: row.createdAt,
      clientInstanceId: row.clientInstanceId,
      idempotencyKey: row.idempotencyKey,
      eventBatchId: row.eventBatchId,
      actorId: row.actorId,
      deviceId: row.deviceId,
      authSessionId: row.authSessionId,
      leaseOwner: 'training-worker',
      leaseGeneration: row.currentLeaseGeneration
    })
  }
}
