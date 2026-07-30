import { describe, expect, it } from 'vitest'
import { createCommandResultJson } from '../../../application/command/command-result'
import {
  confirmAppliedBatchFenced,
  EventBatchCoordinatorError
} from '../batch-coordinator'
import { createEventBatchFaultInjectorForTests } from '../fault-injection'
import {
  applyPreparedBatch,
  loadVerifiedProjectionSources
} from '../projection-source'
import { readSegmentIndexFile } from '../segment-index'
import { SEGMENT_MAX_BYTES } from '../segment-store'
import { FairWriterMutex } from '../writer-mutex'
import {
  acceptSyntheticCommand,
  coordinator,
  createSyntheticHarness,
  rowCount,
  syntheticPlanner,
  syntheticSnapshot
} from './coordinator-test-support'

describe('M5B writer fairness and generation fencing', () => {
  it('grants current-process writers in FIFO order and rejects reentrancy/double release', async () => {
    const mutex = new FairWriterMutex()
    const first = await mutex.acquire('owner-a')
    const order: string[] = []
    const secondPromise = mutex.acquire('owner-b').then((lease) => {
      order.push('owner-b')
      return lease
    })
    const thirdPromise = mutex.acquire('owner-c').then((lease) => {
      order.push('owner-c')
      return lease
    })
    expect(mutex.snapshot()).toEqual({
      activeOwner: 'owner-a',
      activeTicket: 1,
      queuedOwners: ['owner-b', 'owner-c'],
      queuedTickets: [2, 3]
    })
    expect(() => mutex.acquire('owner-a')).toThrow(/reentrant/)

    first.release()
    const second = await secondPromise
    expect(order).toEqual(['owner-b'])
    second.release()
    const third = await thirdPromise
    expect(order).toEqual(['owner-b', 'owner-c'])
    third.release()
    expect(() => third.release()).toThrow(/more than once/)
    expect(mutex.snapshot().activeOwner).toBeNull()
  })

  it('fences a pre-PONR old envelope before it can write a segment or projection', async () => {
    const harness = await createSyntheticHarness()
    try {
      const old = acceptSyntheticCommand({ harness, workerId: 'worker-old' })
      harness.clock.advance(31_000)
      const current = harness.store.acquireLease({
        commandId: old.row.commandId,
        seenGeneration: old.row.currentLeaseGeneration,
        workerId: 'worker-new',
        now: harness.clock.iso(),
        allowFailed: true
      })!
      expect(current).toMatchObject({ currentLeaseGeneration: 2, attemptCount: 2 })

      await expect(coordinator({ harness, workerId: 'worker-old' }).execute({
        envelope: old.envelope,
        readSnapshot: () => syntheticSnapshot(),
        planner: syntheticPlanner({ command: old, values: ['forbidden'] })
      })).rejects.toBeInstanceOf(EventBatchCoordinatorError)
      expect(harness.capability.listRegularFiles('event-log/segments')).toEqual([])
      expect(rowCount(harness.database, 'applied_event_batch')).toBe(0)
    } finally {
      harness.close()
    }
  })

  it('fences a lease taken over while the async planner is pending before first-segment creation', async () => {
    const harness = await createSyntheticHarness()
    try {
      const old = acceptSyntheticCommand({ harness, workerId: 'worker-old' })
      const planned = syntheticPlanner({ command: old, values: ['forbidden'] })
      const planner = {
        plan: async (input: Parameters<typeof planned.plan>[0]) => {
          harness.clock.advance(31_000)
          const current = harness.store.acquireLease({
            commandId: old.row.commandId,
            seenGeneration: old.row.currentLeaseGeneration,
            workerId: 'worker-new',
            now: harness.clock.iso(),
            allowFailed: true
          })!
          expect(current).toMatchObject({ currentLeaseGeneration: 2, attemptCount: 2 })
          return planned.plan(input)
        }
      }

      await expect(coordinator({ harness, workerId: 'worker-old' }).execute({
        envelope: old.envelope,
        readSnapshot: () => syntheticSnapshot(),
        planner
      })).rejects.toMatchObject({ code: 'FENCED' })

      expect(harness.capability.listRegularFiles('event-log/segments')).toEqual([])
      expect(rowCount(harness.database, 'applied_event_batch')).toBe(0)
      expect(rowCount(harness.database, 'domain_event_projection')).toBe(0)
    } finally {
      harness.close()
    }
  })

  it('fences a lease taken over while the async planner is pending before threshold rotation', async () => {
    const harness = await createSyntheticHarness()
    try {
      const largeValue = 'a'.repeat(3 * 1024 * 1024)
      const first = acceptSyntheticCommand({ harness, slot: 1 })
      await coordinator({ harness }).execute({
        envelope: first.envelope,
        readSnapshot: () => syntheticSnapshot(),
        planner: syntheticPlanner({ command: first, slot: 1, values: [largeValue] })
      })
      const segmentPath = harness.capability.listRegularFiles('event-log/segments')[0]
      const segmentBefore = harness.capability.readStable(segmentPath)!
      const indexBefore = harness.capability.readStable('segment_index.json')!
      expect(segmentBefore.byteSize).toBeGreaterThan(SEGMENT_MAX_BYTES / 2)

      const old = acceptSyntheticCommand({ harness, slot: 2, workerId: 'worker-old' })
      const planned = syntheticPlanner({
        command: old,
        slot: 2,
        values: ['b'.repeat(3 * 1024 * 1024)]
      })
      const planner = {
        plan: async (input: Parameters<typeof planned.plan>[0]) => {
          harness.clock.advance(31_000)
          const current = harness.store.acquireLease({
            commandId: old.row.commandId,
            seenGeneration: old.row.currentLeaseGeneration,
            workerId: 'worker-new',
            now: harness.clock.iso(),
            allowFailed: true
          })!
          expect(current).toMatchObject({ currentLeaseGeneration: 2, attemptCount: 2 })
          return planned.plan(input)
        }
      }

      await expect(coordinator({ harness, workerId: 'worker-old' }).execute({
        envelope: old.envelope,
        readSnapshot: () => syntheticSnapshot(),
        planner
      })).rejects.toMatchObject({ code: 'FENCED' })

      expect(harness.capability.listRegularFiles('event-log/segments')).toEqual([segmentPath])
      expect(harness.capability.readStable(segmentPath)).toMatchObject({
        byteSize: segmentBefore.byteSize,
        sha256: segmentBefore.sha256
      })
      expect(harness.capability.readStable('segment_index.json')).toMatchObject({
        byteSize: indexBefore.byteSize,
        sha256: indexBefore.sha256
      })
      expect(rowCount(harness.database, 'applied_event_batch')).toBe(1)
      expect(rowCount(harness.database, 'domain_event_projection')).toBe(1)
    } finally {
      harness.close()
    }
  })

  it('takes over a prepared batch without a new business attempt and rejects old APPLY/CONFIRM/index/result writes', async () => {
    const harness = await createSyntheticHarness()
    try {
      const old = acceptSyntheticCommand({ harness, workerId: 'worker-old' })
      await expect(coordinator({
        harness,
        workerId: 'worker-old',
        faultInjector: createEventBatchFaultInjectorForTests({ failAt: 'AFTER_APPLY_COMMIT' })
      }).execute({
        envelope: old.envelope,
        readSnapshot: () => syntheticSnapshot(),
        planner: syntheticPlanner({ command: old, values: ['one'] })
      })).rejects.toThrow(/AFTER_APPLY_COMMIT/)
      const source = loadVerifiedProjectionSources(harness.capability)[0]
      expect(source.committed).toBeNull()
      expect(readSegmentIndexFile(harness.capability)).toBeNull()
      expect(harness.database.prepare('SELECT batch_status FROM applied_event_batch').get())
        .toEqual({ batch_status: 'APPLIED' })

      harness.clock.advance(31_000)
      const current = harness.store.takeoverPreparedLease({
        commandId: old.row.commandId,
        batchId: old.row.eventBatchId,
        requestHash: old.row.requestHash,
        preparedLeaseGeneration: source.prepared.prepared_lease_generation,
        seenGeneration: old.row.currentLeaseGeneration,
        workerId: 'worker-new',
        now: harness.clock.iso()
      })!
      expect(current).toMatchObject({ currentLeaseGeneration: 2, attemptCount: 1 })

      expect(() => applyPreparedBatch({
        database: harness.database,
        command: old.row,
        source,
        registry: harness.registry,
        appliedAt: harness.clock.iso(),
        allowExisting: true,
        assertAuthorityInTransaction: () => {
          harness.store.assertLease({
            commandId: old.row.commandId,
            leaseOwner: 'worker-old',
            generation: 1,
            now: harness.clock.iso()
          })
        }
      })).toThrow(/authority|fenced|no longer current/i)
      expect(() => confirmAppliedBatchFenced({
        database: harness.database,
        commandStore: harness.store,
        lease: { commandId: old.row.commandId, leaseOwner: 'worker-old', generation: 1 },
        source,
        confirmedAt: harness.clock.iso()
      })).toThrow(/fenced/)
      expect(() => harness.store.completeSucceeded({
        commandId: old.row.commandId,
        leaseOwner: 'worker-old',
        generation: 1,
        resultJson: createCommandResultJson({ success: true }),
        now: harness.clock.iso()
      })).toThrow(/fenced/)
      await expect(coordinator({ harness, workerId: 'worker-old' }).execute({
        envelope: old.envelope,
        readSnapshot: () => syntheticSnapshot(),
        planner: syntheticPlanner({ command: old, values: ['replacement'] })
      })).rejects.toBeInstanceOf(EventBatchCoordinatorError)

      expect(loadVerifiedProjectionSources(harness.capability)).toHaveLength(1)
      expect(readSegmentIndexFile(harness.capability)).toBeNull()
      expect(rowCount(harness.database, 'applied_event_batch')).toBe(1)
      expect(harness.database.prepare('SELECT batch_status FROM applied_event_batch').get())
        .toEqual({ batch_status: 'APPLIED' })
      expect(harness.store.findByCommandId(old.row.commandId)).toMatchObject({
        leaseOwner: 'worker-new',
        currentLeaseGeneration: 2,
        attemptCount: 1,
        status: 'PROCESSING'
      })
    } finally {
      harness.close()
    }
  })
})
