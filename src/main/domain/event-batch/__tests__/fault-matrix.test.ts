import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { DurableCommandStore } from '../../../application/command/durable-command-store'
import {
  createEventBatchFaultInjectorForTests,
  EVENT_BATCH_FAULT_POINTS,
  type EventBatchFaultPoint
} from '../fault-injection'
import { DurableFileCapability } from '../file-capability'
import { loadVerifiedProjectionSources } from '../projection-source'
import { RuntimeCorruptionState } from '../runtime-corruption'
import { readSegmentIndexFile } from '../segment-index'
import { StartupRecovery } from '../startup-recovery'
import { FairWriterMutex } from '../writer-mutex'
import {
  acceptSyntheticCommand,
  coordinator,
  createSyntheticHarness,
  createSyntheticRegistry,
  rowCount,
  syntheticPlanner,
  syntheticSnapshot
} from './coordinator-test-support'

interface CrashCase {
  point: EventBatchFaultPoint
  ponr: boolean
  event_index: number | null
  expected_before_recovery: string
  allowed_recovery_action: string
  expected_total_planner_calls: number
}

const fixture = JSON.parse(readFileSync(
  resolve(process.cwd(), 'scripts/fixtures/m5b-crash-matrix-v1.json'),
  'utf8'
)) as { schema_version: string; cases: CrashCase[] }

function assertBeforeRecoveryState(
  harness: Awaited<ReturnType<typeof createSyntheticHarness>>,
  commandId: string,
  expected: string
): void {
  const sources = loadVerifiedProjectionSources(harness.capability)
  const batchCount = rowCount(harness.database, 'applied_event_batch')
  const projectionCount = rowCount(harness.database, 'domain_event_projection')
  const command = harness.store.findByCommandId(commandId)!
  const index = readSegmentIndexFile(harness.capability)
  if (expected === 'NO_PREPARE') {
    expect(sources).toEqual([])
    expect(batchCount).toBe(0)
  } else if (expected === 'PREPARED_ONLY' || expected === 'PREPARED_WITH_ZERO_PARTIAL_PROJECTION') {
    expect(sources).toHaveLength(1)
    expect(sources[0].committed).toBeNull()
    expect(batchCount).toBe(0)
    expect(projectionCount).toBe(0)
  } else if (expected === 'SQLITE_APPLIED') {
    expect(sources).toHaveLength(1)
    expect(sources[0].committed).toBeNull()
    expect(harness.database.prepare('SELECT batch_status FROM applied_event_batch').get())
      .toEqual({ batch_status: 'APPLIED' })
  } else if (expected === 'DURABLE_COMMITTED_SQLITE_APPLIED') {
    expect(sources[0].committed).not.toBeNull()
    expect(harness.database.prepare('SELECT batch_status FROM applied_event_batch').get())
      .toEqual({ batch_status: 'APPLIED' })
  } else if (expected === 'SQLITE_CONFIRMED') {
    expect(sources[0].committed).not.toBeNull()
    expect(harness.database.prepare('SELECT batch_status FROM applied_event_batch').get())
      .toEqual({ batch_status: 'CONFIRMED' })
    expect(index).toBeNull()
  } else if (expected === 'INDEX_CURRENT') {
    expect(sources[0].committed).not.toBeNull()
    expect(index?.index.last_batch_hash).toBe(sources[0].prepared.batch_hash)
    expect(command).toMatchObject({ status: 'PROCESSING', resultJson: null })
  } else if (expected === 'RESULT_DURABLE') {
    expect(index?.index.last_batch_hash).toBe(sources[0].prepared.batch_hash)
    expect(command).toMatchObject({ status: 'SUCCEEDED' })
    expect(command.resultJson).not.toBeNull()
  } else {
    throw new Error(`unrecognized crash fixture state ${expected}`)
  }
}

function assertRecoveryAction(
  result: Awaited<ReturnType<StartupRecovery['run']>>,
  action: string
): void {
  const counters = {
    appliedBatches: result.appliedBatches,
    appendedCommitted: result.appendedCommitted,
    confirmedBatches: result.confirmedBatches,
    recoveredResults: result.recoveredResults,
    resetPrePonrCommands: result.resetPrePonrCommands
  }
  const expected = {
    RESET_THEN_EXPLICIT_REPLAN: [0, 0, 0, 0, 1],
    APPLY_CONFIRM_INDEX_RESULT_FROM_PREPARED: [1, 1, 1, 1, 0],
    CONFIRM_INDEX_RESULT_FROM_PREPARED: [0, 1, 1, 1, 0],
    SQLITE_CONFIRM_INDEX_RESULT_FROM_PREPARED: [0, 0, 1, 1, 0],
    INDEX_RESULT_FROM_PREPARED: [0, 0, 0, 1, 0],
    RESULT_FROM_PREPARED: [0, 0, 0, 1, 0],
    VERIFY_ONLY: [0, 0, 0, 0, 0]
  }[action]
  if (!expected) throw new Error(`unrecognized recovery action ${action}`)
  expect(Object.values(counters)).toEqual(expected)
}

describe('M5B crash and recovery matrix', () => {
  it('enumerates every stable coordinator fault point exactly once', () => {
    expect(fixture.schema_version).toBe('m5b-crash-matrix-v1')
    expect(fixture.cases.map((entry) => entry.point)).toEqual(EVENT_BATCH_FAULT_POINTS)
    expect(new Set(fixture.cases.map((entry) => entry.allowed_recovery_action)).size).toBeGreaterThan(1)
  })

  for (const crash of fixture.cases) {
    it(`${crash.point}: converges to one reserved batch/result with the declared planner count`, async () => {
      const harness = await createSyntheticHarness()
      try {
        const original = acceptSyntheticCommand({ harness, workerId: 'worker-crash' })
        const originalPlanner = syntheticPlanner({ command: original, values: ['one', 'two', 'three'] })
        const injector = createEventBatchFaultInjectorForTests({
          failAt: crash.point,
          ...(crash.event_index === null ? {} : { eventIndex: crash.event_index })
        })
        await expect(coordinator({ harness, workerId: 'worker-crash', faultInjector: injector }).execute({
          envelope: original.envelope,
          readSnapshot: () => syntheticSnapshot(),
          planner: originalPlanner
        })).rejects.toThrow(crash.point)
        expect(originalPlanner.calls.count).toBe(1)
        expect(harness.corruption.snapshot().state).toBe('OPEN')
        assertBeforeRecoveryState(harness, original.row.commandId, crash.expected_before_recovery)

        if (crash.point === 'APPLY_EVENT') {
          expect(rowCount(harness.database, 'applied_event_batch')).toBe(0)
          expect(rowCount(harness.database, 'processed_event')).toBe(0)
          expect(rowCount(harness.database, 'domain_event_projection')).toBe(0)
          expect(rowCount(harness.database, 'synthetic_projection')).toBe(0)
          expect(rowCount(harness.database, 'synthetic_effect')).toBe(0)
        }

        harness.clock.advance(31_000)
        const restarted = new StartupRecovery({
          database: harness.database,
          commandStore: new DurableCommandStore(harness.database),
          registry: createSyntheticRegistry(),
          fileCapability: new DurableFileCapability(harness.root),
          corruptionState: new RuntimeCorruptionState(),
          workerId: 'worker-recovery',
          legacyAnchor: null,
          writerMutex: new FairWriterMutex(),
          now: harness.clock.now
        })
        const recoveryResult = await restarted.run()
        expect(recoveryResult.plannerCalls).toBe(0)
        assertRecoveryAction(recoveryResult, crash.allowed_recovery_action)

        let retryPlannerCalls = 0
        if (!crash.ponr) {
          expect(harness.store.findByCommandId(original.row.commandId)?.status).toBe('PENDING')
          const retried = acceptSyntheticCommand({ harness, workerId: 'worker-retry' })
          const retryPlanner = syntheticPlanner({ command: retried, values: ['one', 'two', 'three'] })
          await coordinator({ harness, workerId: 'worker-retry' }).execute({
            envelope: retried.envelope,
            readSnapshot: () => syntheticSnapshot(),
            planner: retryPlanner
          })
          retryPlannerCalls = retryPlanner.calls.count
        }

        expect(originalPlanner.calls.count + retryPlannerCalls).toBe(crash.expected_total_planner_calls)
        expect(harness.store.findByCommandId(original.row.commandId)).toMatchObject({
          commandId: original.row.commandId,
          eventBatchId: original.row.eventBatchId,
          status: 'SUCCEEDED',
          attemptCount: crash.ponr ? 1 : 2
        })
        const sources = loadVerifiedProjectionSources(harness.capability)
        expect(sources).toHaveLength(1)
        expect(sources[0]).toMatchObject({
          prepared: { batch_id: original.row.eventBatchId, event_count: 3 }
        })
        expect(sources[0].committed).not.toBeNull()
        expect(rowCount(harness.database, 'applied_event_batch')).toBe(1)
        expect(rowCount(harness.database, 'processed_event')).toBe(3)
        expect(rowCount(harness.database, 'synthetic_projection')).toBe(3)
        expect(rowCount(harness.database, 'synthetic_effect')).toBe(3)
        const segment = harness.capability.readStable(sources[0].relativePath)!.bytes.toString('utf8')
        expect(segment.match(/"type":"BATCH_PREPARED"/g)).toHaveLength(1)
        expect(segment.match(/"type":"BATCH_COMMITTED"/g)).toHaveLength(1)
      } finally {
        harness.close()
      }
    })
  }

  const recoveryFaults = [
    'BEFORE_APPLY',
    'APPLY_EVENT',
    'AFTER_APPLY_COMMIT',
    'BEFORE_CONFIRM',
    'AFTER_COMMITTED_FSYNC',
    'AFTER_SQLITE_CONFIRM',
    'BEFORE_INDEX',
    'AFTER_INDEX',
    'BEFORE_RESULT',
    'AFTER_RESULT'
  ] as const

  for (const point of recoveryFaults) {
    it(`recovery ${point}: a second fresh composition converges without planner or duplicate facts`, async () => {
      const harness = await createSyntheticHarness()
      try {
        const command = acceptSyntheticCommand({ harness, workerId: 'worker-crash' })
        const planner = syntheticPlanner({ command, values: ['one', 'two', 'three'] })
        await expect(coordinator({
          harness,
          workerId: 'worker-crash',
          faultInjector: createEventBatchFaultInjectorForTests({ failAt: 'AFTER_PREPARE_FSYNC' })
        }).execute({
          envelope: command.envelope,
          readSnapshot: () => syntheticSnapshot(),
          planner
        })).rejects.toThrow(/AFTER_PREPARE_FSYNC/)

        harness.clock.advance(31_000)
        const corruption = new RuntimeCorruptionState()
        const firstRecovery = new StartupRecovery({
          database: harness.database,
          commandStore: new DurableCommandStore(harness.database),
          registry: createSyntheticRegistry(),
          fileCapability: new DurableFileCapability(harness.root),
          corruptionState: corruption,
          workerId: 'worker-recovery-one',
          legacyAnchor: null,
          writerMutex: new FairWriterMutex(),
          now: harness.clock.now,
          faultInjector: createEventBatchFaultInjectorForTests({
            failAt: point,
            ...(point === 'APPLY_EVENT' ? { eventIndex: 1 } : {})
          })
        })
        await expect(firstRecovery.run()).rejects.toThrow(point)
        expect(corruption.snapshot().state).toBe('OPEN')
        if (point === 'APPLY_EVENT') {
          expect(rowCount(harness.database, 'applied_event_batch')).toBe(0)
          expect(rowCount(harness.database, 'synthetic_projection')).toBe(0)
        }

        harness.clock.advance(31_000)
        const secondRecovery = new StartupRecovery({
          database: harness.database,
          commandStore: new DurableCommandStore(harness.database),
          registry: createSyntheticRegistry(),
          fileCapability: new DurableFileCapability(harness.root),
          corruptionState: corruption,
          workerId: 'worker-recovery-two',
          legacyAnchor: null,
          writerMutex: new FairWriterMutex(),
          now: harness.clock.now
        })
        expect((await secondRecovery.run()).plannerCalls).toBe(0)
        expect(planner.calls.count).toBe(1)
        expect(harness.store.findByCommandId(command.row.commandId)).toMatchObject({
          status: 'SUCCEEDED',
          attemptCount: 1,
          eventBatchId: command.row.eventBatchId
        })
        const sources = loadVerifiedProjectionSources(harness.capability)
        expect(sources).toHaveLength(1)
        expect(sources[0].committed).not.toBeNull()
        expect(rowCount(harness.database, 'applied_event_batch')).toBe(1)
        expect(rowCount(harness.database, 'synthetic_projection')).toBe(3)
        const segment = harness.capability.readStable(sources[0].relativePath)!.bytes.toString('utf8')
        expect(segment.match(/"type":"BATCH_COMMITTED"/g)).toHaveLength(1)
      } finally {
        harness.close()
      }
    })
  }
})
