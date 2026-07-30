import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EVENT_BATCH_SCHEMA_SQL } from '../../../db/event-batch-migration'
import { MemoryAdapter } from '../../../db/memory-adapter'
import { createCommandResultJson } from '../command-result'
import {
  COMMAND_LEASE_DURATION_MS,
  COMMAND_LEASE_RENEW_INTERVAL_MS,
  DurableCommandStore,
  DurableCommandStoreError
} from '../durable-command-store'

const COMMAND_ID = '10000000-0000-4000-8000-000000000001'
const OTHER_COMMAND_ID = '10000000-0000-4000-8000-000000000002'
const BATCH_ID = '20000000-0000-4000-8000-000000000001'
const OTHER_BATCH_ID = '20000000-0000-4000-8000-000000000002'
const CLIENT_ID = '30000000-0000-4000-8000-000000000001'
const KEY = '40000000-0000-4000-8000-000000000001'
const CREATED_AT = '2026-07-29T10:00:00.000Z'

function registration(overrides: Record<string, unknown> = {}) {
  return {
    commandId: COMMAND_ID,
    idempotencyKey: KEY,
    clientInstanceId: CLIENT_ID,
    commandType: 'test:mutate',
    actorId: 'teacher-1',
    deviceId: 'device-1',
    authSessionId: 'auth-session-1',
    requestHash: 'a'.repeat(64),
    eventBatchId: BATCH_ID,
    createdAt: CREATED_AT,
    maxAttempts: 3 as const,
    ...overrides
  }
}

describe('M5B durable command store', () => {
  let database: MemoryAdapter
  let store: DurableCommandStore

  beforeEach(async () => {
    database = await MemoryAdapter.create()
    database.exec(EVENT_BATCH_SCHEMA_SQL)
    store = new DurableCommandStore(database)
  })

  afterEach(() => database.close())

  it('registers one reserved command/batch identity and reloads the unique key without replacement', () => {
    const first = store.registerOrLoad(registration())
    expect(first.inserted).toBe(true)
    expect(first.row).toMatchObject({
      commandId: COMMAND_ID,
      eventBatchId: BATCH_ID,
      status: 'PENDING',
      currentLeaseGeneration: 0,
      attemptCount: 0,
      maxAttempts: 3
    })

    const duplicate = store.registerOrLoad(registration({
      commandId: OTHER_COMMAND_ID,
      eventBatchId: OTHER_BATCH_ID,
      requestHash: 'b'.repeat(64)
    }))
    expect(duplicate.inserted).toBe(false)
    expect(duplicate.row.commandId).toBe(COMMAND_ID)
    expect(duplicate.row.eventBatchId).toBe(BATCH_ID)
    expect(duplicate.row.requestHash).toBe('a'.repeat(64))
    expect(database.prepare('SELECT COUNT(*) AS count FROM command_log').get()).toEqual({ count: 1 })
  })

  it('acquires and renews the 30s lease atomically with a 10s renewal contract', () => {
    store.registerOrLoad(registration())
    const claimed = store.acquireLease({
      commandId: COMMAND_ID,
      seenGeneration: 0,
      workerId: 'worker-a',
      now: CREATED_AT,
      allowFailed: true
    })!
    expect(COMMAND_LEASE_DURATION_MS).toBe(30_000)
    expect(COMMAND_LEASE_RENEW_INTERVAL_MS).toBe(10_000)
    expect(claimed).toMatchObject({
      status: 'PROCESSING',
      leaseOwner: 'worker-a',
      currentLeaseGeneration: 1,
      leaseExpiresAt: '2026-07-29T10:00:30.000Z',
      attemptCount: 1
    })
    expect(store.acquireLease({
      commandId: COMMAND_ID,
      seenGeneration: 0,
      workerId: 'worker-b',
      now: '2026-07-29T10:00:01.000Z',
      allowFailed: true
    })).toBeNull()

    const renewed = store.renewLease({
      commandId: COMMAND_ID,
      leaseOwner: 'worker-a',
      generation: 1,
      now: '2026-07-29T10:00:10.000Z'
    })
    expect(renewed.leaseExpiresAt).toBe('2026-07-29T10:00:40.000Z')
    expect(renewed.currentLeaseGeneration).toBe(1)
    expect(renewed.attemptCount).toBe(1)
  })

  it('takes over only an expired generation and fences every old-owner write method', () => {
    store.registerOrLoad(registration())
    store.acquireLease({
      commandId: COMMAND_ID,
      seenGeneration: 0,
      workerId: 'worker-a',
      now: CREATED_AT,
      allowFailed: true
    })
    const takeover = store.acquireLease({
      commandId: COMMAND_ID,
      seenGeneration: 1,
      workerId: 'worker-b',
      now: '2026-07-29T10:00:31.000Z',
      allowFailed: true
    })!
    expect(takeover).toMatchObject({
      leaseOwner: 'worker-b',
      currentLeaseGeneration: 2,
      attemptCount: 2
    })

    const oldLease = {
      commandId: COMMAND_ID,
      leaseOwner: 'worker-a',
      generation: 1,
      now: '2026-07-29T10:00:32.000Z'
    }
    expect(() => store.assertLease(oldLease)).toThrowError(DurableCommandStoreError)
    expect(() => store.renewLease(oldLease)).toThrow(/fenced/)
    expect(() => store.completeSucceeded({
      ...oldLease,
      resultJson: createCommandResultJson({ success: true })
    })).toThrow(/fenced/)
    expect(() => store.markRetryablePrePonrFailure({
      ...oldLease,
      errorCode: 'TRANSIENT_IO',
      stage: 'PRE_PONR_NO_PREPARE'
    })).toThrow(/fenced/)
    expect(store.findByCommandId(COMMAND_ID)).toMatchObject({
      leaseOwner: 'worker-b',
      currentLeaseGeneration: 2,
      status: 'PROCESSING'
    })
  })

  it('caps retryable pre-PONR system attempts at three without creating a replacement row', () => {
    store.registerOrLoad(registration())
    let generation = 0
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const now = `2026-07-29T10:00:0${attempt}.000Z`
      const claimed = store.acquireLease({
        commandId: COMMAND_ID,
        seenGeneration: generation,
        workerId: `worker-${attempt}`,
        now,
        allowFailed: true
      })!
      generation = claimed.currentLeaseGeneration
      expect(claimed.attemptCount).toBe(attempt)
      const failed = store.markRetryablePrePonrFailure({
        commandId: COMMAND_ID,
        leaseOwner: `worker-${attempt}`,
        generation,
        errorCode: 'TRANSIENT_IO',
        now,
        stage: 'PRE_PONR_NO_PREPARE'
      })
      expect(failed.status).toBe('FAILED')
      expect(failed.errorMessage).toBeNull()
    }
    expect(store.acquireLease({
      commandId: COMMAND_ID,
      seenGeneration: 3,
      workerId: 'worker-4',
      now: '2026-07-29T10:00:04.000Z',
      allowFailed: true
    })).toBeNull()
    expect(database.prepare('SELECT COUNT(*) AS count FROM command_log').get()).toEqual({ count: 1 })
  })

  it('stores canonical success:false as immutable SUCCEEDED and rejects invalid or stale results', () => {
    store.registerOrLoad(registration())
    const claimed = store.acquireLease({
      commandId: COMMAND_ID,
      seenGeneration: 0,
      workerId: 'worker-a',
      now: CREATED_AT,
      allowFailed: true
    })!
    const resultJson = createCommandResultJson({ success: false, errorCode: 'BUSINESS_REJECTED' })
    const completed = store.completeSucceeded({
      commandId: COMMAND_ID,
      leaseOwner: 'worker-a',
      generation: claimed.currentLeaseGeneration,
      resultJson,
      now: '2026-07-29T10:00:01.000Z'
    })
    expect(completed).toMatchObject({ status: 'SUCCEEDED', resultJson, attemptCount: 1 })
    expect(() => store.completeSucceeded({
      commandId: COMMAND_ID,
      leaseOwner: 'worker-a',
      generation: claimed.currentLeaseGeneration,
      resultJson: createCommandResultJson({ success: true }),
      now: '2026-07-29T10:00:02.000Z'
    })).toThrow(/immutable/)
    expect(store.findByCommandId(COMMAND_ID)?.resultJson).toBe(resultJson)
    expect(() => store.completeSucceeded({
      commandId: COMMAND_ID,
      leaseOwner: 'worker-a',
      generation: claimed.currentLeaseGeneration,
      resultJson: '{"public_result":true}',
      now: '2026-07-29T10:00:02.000Z'
    })).toThrow(/result/)
  })
})
