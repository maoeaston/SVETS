import { createHash } from 'crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EVENT_BATCH_SCHEMA_SQL } from '../../../db/event-batch-migration'
import { MemoryAdapter } from '../../../db/memory-adapter'
import { createPreflightErrorMap } from '../public-error-contract'
import { CommandRegistry } from '../command-registry'
import {
  DurableCommandCoordinator
} from '../durable-command-coordinator'
import { DurableCommandStore } from '../durable-command-store'
import type {
  CommandActor,
  MutationCommandDefinition
} from '../command-types'

type TestError = 'SYSTEM_ERROR' | 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION_ERROR'
type TestInput = { value: string; username?: string; password?: string }

const CLIENT_ID = '30000000-0000-4000-8000-000000000001'
const KEY_1 = '40000000-0000-4000-8000-000000000001'
const KEY_2 = '40000000-0000-4000-8000-000000000002'
const IDS = [
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000002'
]

function metadata(idempotencyKey = KEY_1, deviceId = 'device-1') {
  return { schemaVersion: 1 as const, clientInstanceId: CLIENT_ID, idempotencyKey, deviceId }
}

function testDefinition(options: {
  commandType?: string
  actor: () => CommandActor
  targetCalls: { count: number }
  executeCalls: { count: number }
  secret?: boolean
  targetVersion: () => number
}): MutationCommandDefinition<TestInput, TestInput, { success: true }, TestError> {
  const commandType = options.commandType ?? 'test:mutate'
  return {
    commandType,
    metadata: {
      mode: 'MUTATION',
      executionMode: 'ASYNC',
      allowedSources: ['IPC'],
      actorPolicy: commandType === 'auth:login'
        ? { kind: 'BOOTSTRAP' }
        : { kind: 'ACTIVE_USER', roles: ['TEACHER'] },
      targetResolver: {
        owner: 'durable-command-coordinator.test',
        kind: 'STATIC_CONTEXT',
        locatorFields: [],
        authoritativeFields: ['test target'],
        canonicalTargetFields: ['aggregate_id', 'version'],
        clientHintFields: [],
        notFoundMapping: 'NOT_FOUND',
        mismatchMapping: 'VALIDATION_ERROR',
        testReferences: ['durable-command-coordinator.test.ts']
      },
      payloadContract: `${commandType}.test.v1`,
      sideEffects: ['TEST_EXECUTE_SPY'],
      phase: 'M5B_TEST_ONLY',
      transactionOwner: 'durable-command-coordinator.test',
      retryPolicy: 'NO_AUTO_RETRY',
      durableCommand: {
        requestHash: {
          schemaVersion: 'command-request-hash-v1',
          secretFields: options.secret ? ['password'] : [],
          secretIdentityFields: options.secret ? ['username'] : []
        },
        resultSchemaVersion: 'command-result-v1',
        resultRecipeVersion: `${commandType}.result.v1`,
        prePonrRetryPolicy: 'RETRYABLE_SYSTEM_FAILURE',
        maxAttempts: 3
      },
      concurrencyPolicy: { kind: 'FAIL_FAST_ACTIVE_KEY', keyOwner: 'test-target' },
      publicErrorCodes: ['SYSTEM_ERROR', 'FORBIDDEN', 'NOT_FOUND', 'VALIDATION_ERROR'],
      preflightErrorMap: createPreflightErrorMap<TestError>('SYSTEM_ERROR', {
        INVALID_ACTOR: 'FORBIDDEN',
        TARGET_NOT_FOUND: 'NOT_FOUND',
        TARGET_MISMATCH: 'VALIDATION_ERROR',
        INVALID_PAYLOAD: 'VALIDATION_ERROR'
      }),
      testReferences: ['durable-command-coordinator.test.ts']
    },
    validateStructure(rawInput) {
      if (!rawInput || typeof rawInput.value !== 'string' || !rawInput.value.length) throw new Error('invalid')
      if (options.secret && (typeof rawInput.username !== 'string' || typeof rawInput.password !== 'string')) {
        throw new Error('invalid secret input')
      }
      return { ...rawInput }
    },
    resolveActor: () => options.actor(),
    normalizeBusinessInput: (_transport, _actor, input) => options.secret
      ? { value: input.value, username: input.username!.trim(), password: input.password! }
      : { value: input.value },
    resolveTarget() {
      options.targetCalls.count += 1
      const version = options.targetVersion()
      if (version < 0) throw new Error('injected target failure')
      return { aggregate_id: 'aggregate-1', version }
    },
    canonicalPayload: (_transport, _actor, _target, input) => ({ ...input }),
    concurrencyKey: () => 'aggregate-1',
    execute() {
      options.executeCalls.count += 1
      return { success: true }
    },
    mapUnexpectedExecutionError: () => ({ success: true })
  }
}

describe('M5B durable command coordinator', () => {
  let database: MemoryAdapter
  let store: DurableCommandStore
  let actor: CommandActor
  let targetCalls: { count: number }
  let executeCalls: { count: number }
  let targetVersion: number
  let clock: number
  let ids: string[]
  let registry: CommandRegistry
  let coordinator: DurableCommandCoordinator

  beforeEach(async () => {
    database = await MemoryAdapter.create()
    database.exec(EVENT_BATCH_SCHEMA_SQL)
    store = new DurableCommandStore(database)
    actor = { kind: 'USER', userId: 'teacher-1', role: 'TEACHER', authSessionId: 'auth-1' }
    targetCalls = { count: 0 }
    executeCalls = { count: 0 }
    targetVersion = 1
    clock = Date.parse('2026-07-29T11:00:00.000Z')
    ids = [...IDS]
    registry = new CommandRegistry()
      .registerMutation(testDefinition({
        actor: () => actor,
        targetCalls,
        executeCalls,
        targetVersion: () => targetVersion
      }))
      .registerMutation(testDefinition({
        commandType: 'test:other',
        actor: () => actor,
        targetCalls,
        executeCalls,
        targetVersion: () => targetVersion
      }))
      .seal()
    coordinator = new DurableCommandCoordinator({
      registry,
      store,
      workerId: 'worker-a',
      uuid: () => ids.shift()!,
      now: () => new Date(clock)
    })
  })

  afterEach(() => database.close())

  it('returns immutable success:false replay without resolving a changed target or increasing attempts', async () => {
    const first = await coordinator.accept({
      commandType: 'test:mutate',
      rawInput: { value: 'same' },
      transport: { source: 'IPC', transportId: 'transport-1' },
      transportMetadata: metadata()
    })
    expect(first.status).toBe('ACCEPTED')
    if (first.status !== 'ACCEPTED') throw new Error('expected accepted command')
    expect(first.envelope).toMatchObject({
      envelopeVersion: 'v2',
      commandId: IDS[0],
      eventBatchId: IDS[1],
      correlationId: IDS[0],
      actorId: 'teacher-1',
      authSessionId: 'auth-1',
      leaseGeneration: 1
    })
    const completed = coordinator.complete(first.envelope, {
      success: false,
      errorCode: 'DETERMINISTIC_REJECTION'
    })
    expect(completed.row.status).toBe('SUCCEEDED')

    targetVersion = 99
    const replayed = await coordinator.accept({
      commandType: 'test:mutate',
      rawInput: { value: 'same' },
      transport: { source: 'IPC', transportId: 'transport-2' },
      transportMetadata: metadata()
    })
    expect(replayed).toMatchObject({
      status: 'REPLAYED',
      publicResult: { success: false, errorCode: 'DETERMINISTIC_REJECTION' },
      row: { attemptCount: 1 }
    })
    expect(targetCalls.count).toBe(1)
    expect(executeCalls.count).toBe(0)
  })

  it('treats a new key with the same payload as a new intent while preserving request_hash', async () => {
    const first = await coordinator.accept({
      commandType: 'test:mutate', rawInput: { value: 'same' },
      transport: { source: 'IPC', transportId: 'one' }, transportMetadata: metadata(KEY_1)
    })
    const second = await coordinator.accept({
      commandType: 'test:mutate', rawInput: { value: 'same' },
      transport: { source: 'IPC', transportId: 'two' }, transportMetadata: metadata(KEY_2)
    })
    expect(first.status).toBe('ACCEPTED')
    expect(second.status).toBe('ACCEPTED')
    if (first.status !== 'ACCEPTED' || second.status !== 'ACCEPTED') throw new Error('expected acceptance')
    expect(second.envelope.requestHash).toBe(first.envelope.requestHash)
    expect(second.envelope.commandId).not.toBe(first.envelope.commandId)
    expect(second.envelope.eventBatchId).not.toBe(first.envelope.eventBatchId)
    expect(targetCalls.count).toBe(2)
  })

  it('rejects same-key request, actor, session, device, and command drift before target resolution', async () => {
    await coordinator.accept({
      commandType: 'test:mutate', rawInput: { value: 'original' },
      transport: { source: 'IPC', transportId: 'one' }, transportMetadata: metadata()
    })
    expect(targetCalls.count).toBe(1)
    const conflict = async (overrides: Partial<{
      commandType: string
      rawInput: TestInput
      deviceId: string
    }> = {}) => coordinator.accept({
      commandType: overrides.commandType ?? 'test:mutate',
      rawInput: overrides.rawInput ?? { value: 'original' },
      transport: { source: 'IPC', transportId: 'replay' },
      transportMetadata: metadata(KEY_1, overrides.deviceId ?? 'device-1')
    })

    await expect(conflict({ rawInput: { value: 'changed' } })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
    actor = { kind: 'USER', userId: 'teacher-2', role: 'TEACHER', authSessionId: 'auth-1' }
    await expect(conflict()).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
    actor = { kind: 'USER', userId: 'teacher-1', role: 'TEACHER', authSessionId: 'auth-2' }
    await expect(conflict()).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
    actor = { kind: 'USER', userId: 'teacher-1', role: 'TEACHER', authSessionId: 'auth-1' }
    await expect(conflict({ deviceId: 'device-2' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
    await expect(conflict({ commandType: 'test:other' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
    expect(targetCalls.count).toBe(1)
  })

  it('atomically takes over an expired lease and fences the old envelope at every coordinator gate', async () => {
    const first = await coordinator.accept({
      commandType: 'test:mutate', rawInput: { value: 'takeover' },
      transport: { source: 'IPC', transportId: 'one' }, transportMetadata: metadata()
    })
    if (first.status !== 'ACCEPTED') throw new Error('expected first acceptance')
    await expect(coordinator.accept({
      commandType: 'test:mutate', rawInput: { value: 'takeover' },
      transport: { source: 'IPC', transportId: 'active' }, transportMetadata: metadata()
    })).rejects.toMatchObject({ code: 'LEASE_ACTIVE' })
    expect(targetCalls.count).toBe(1)

    clock += 31_000
    const secondCoordinator = new DurableCommandCoordinator({
      registry,
      store,
      workerId: 'worker-b',
      uuid: () => { throw new Error('takeover must not reserve new IDs') },
      now: () => new Date(clock)
    })
    const takeover = await secondCoordinator.accept({
      commandType: 'test:mutate', rawInput: { value: 'takeover' },
      transport: { source: 'IPC', transportId: 'takeover' }, transportMetadata: metadata()
    })
    if (takeover.status !== 'ACCEPTED') throw new Error('expected takeover')
    expect(takeover.envelope).toMatchObject({
      commandId: first.envelope.commandId,
      eventBatchId: first.envelope.eventBatchId,
      leaseOwner: 'worker-b',
      leaseGeneration: 2
    })
    expect(() => coordinator.assertCurrentLease(first.envelope)).toThrow(/fenced/)
    expect(() => coordinator.renew(first.envelope)).toThrow(/fenced/)
    expect(() => coordinator.complete(first.envelope, { success: true })).toThrow(/fenced/)
    expect(() => coordinator.failRetryableBeforePrepare(first.envelope, 'TRANSIENT_IO')).toThrow(/fenced/)
    expect(secondCoordinator.complete(takeover.envelope, { success: true }).row.status).toBe('SUCCEEDED')
  })

  it('keeps structural, actor, and target failures side-effect-free before durable acceptance', async () => {
    const countRows = () => (database.prepare('SELECT COUNT(*) AS count FROM command_log').get() as { count: number }).count
    await expect(coordinator.accept({
      commandType: 'test:mutate', rawInput: { value: 'x', idempotencyKey: KEY_1 } as never,
      transport: { source: 'IPC', transportId: 'invalid-payload' }, transportMetadata: metadata()
    })).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' })
    await expect(coordinator.accept({
      commandType: 'test:mutate', rawInput: { value: 'x' },
      transport: { source: 'IPC', transportId: 'invalid-transport' }, transportMetadata: { ...metadata(), extra: true }
    })).rejects.toMatchObject({ code: 'INVALID_TRANSPORT' })
    actor = { kind: 'USER', userId: 'student-1', role: 'STUDENT', authSessionId: 'auth-student' }
    await expect(coordinator.accept({
      commandType: 'test:mutate', rawInput: { value: 'x' },
      transport: { source: 'IPC', transportId: 'invalid-actor' }, transportMetadata: metadata()
    })).rejects.toMatchObject({ code: 'INVALID_ACTOR' })
    actor = { kind: 'USER', userId: 'teacher-1', role: 'TEACHER', authSessionId: 'auth-1' }
    targetVersion = -1
    await expect(coordinator.accept({
      commandType: 'test:mutate', rawInput: { value: 'x' },
      transport: { source: 'IPC', transportId: 'target-failure' }, transportMetadata: metadata()
    })).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' })
    expect(countRows()).toBe(0)
    expect(targetCalls.count).toBe(1)
    expect(executeCalls.count).toBe(0)
  })

  it('persists neither raw password nor low-cost password hash in command row/result', async () => {
    const secretRegistry = new CommandRegistry().registerMutation(testDefinition({
      commandType: 'auth:login',
      actor: () => ({ kind: 'UNAUTHENTICATED' }),
      targetCalls,
      executeCalls,
      secret: true,
      targetVersion: () => 1
    })).seal()
    const secretCoordinator = new DurableCommandCoordinator({
      registry: secretRegistry,
      store,
      workerId: 'worker-secret',
      uuid: () => ids.shift()!,
      now: () => new Date(clock)
    })
    const password = 'correct horse battery staple'
    const accepted = await secretCoordinator.accept({
      commandType: 'auth:login',
      rawInput: { value: 'login', username: ' alice ', password },
      transport: { source: 'IPC', transportId: 'login' },
      transportMetadata: metadata()
    })
    if (accepted.status !== 'ACCEPTED') throw new Error('expected secret acceptance')
    expect(() => secretCoordinator.complete(accepted.envelope, { success: true, password }))
      .toThrow(/sensitive field/)
    secretCoordinator.complete(accepted.envelope, { success: true, authSessionId: 'auth-new' })

    const persisted = JSON.stringify(database.prepare('SELECT * FROM command_log').all())
    expect(persisted).not.toContain(password)
    expect(persisted).not.toContain(createHash('sha256').update(password).digest('hex'))
    expect(persisted).not.toContain('"username":"alice"')
    expect(executeCalls.count).toBe(0)
  })
})
