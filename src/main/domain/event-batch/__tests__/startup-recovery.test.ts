import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { DurableCommandStore } from '../../../application/command/durable-command-store'
import { createEventBatchFaultInjectorForTests } from '../fault-injection'
import { DurableFileCapability } from '../file-capability'
import { loadVerifiedProjectionSources } from '../projection-source'
import { RuntimeCorruptionState } from '../runtime-corruption'
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

function recovery(
  harness: Awaited<ReturnType<typeof createSyntheticHarness>>,
  workerId = 'worker-recovery',
  faultInjector?: ReturnType<typeof createEventBatchFaultInjectorForTests>
) {
  return new StartupRecovery({
    database: harness.database,
    commandStore: new DurableCommandStore(harness.database),
    registry: createSyntheticRegistry(),
    fileCapability: new DurableFileCapability(harness.root),
    corruptionState: new RuntimeCorruptionState(),
    workerId,
    legacyAnchor: null,
    writerMutex: new FairWriterMutex(),
    now: harness.clock.now,
    faultInjector
  })
}

describe('M5B four-phase startup recovery', () => {
  it('recovers the original batch after durable PREPARE without invoking a planner and stays idempotent', async () => {
    const harness = await createSyntheticHarness()
    try {
      const command = acceptSyntheticCommand({ harness })
      const planner = syntheticPlanner({ command, values: ['one', 'two'] })
      await expect(coordinator({
        harness,
        faultInjector: createEventBatchFaultInjectorForTests({ failAt: 'AFTER_PREPARE_FSYNC' })
      }).execute({
        envelope: command.envelope,
        readSnapshot: () => syntheticSnapshot(),
        planner
      })).rejects.toThrow(/AFTER_PREPARE_FSYNC/)
      const prepared = loadVerifiedProjectionSources(harness.capability)
      expect(prepared).toHaveLength(1)
      expect(prepared[0].committed).toBeNull()
      expect(rowCount(harness.database, 'applied_event_batch')).toBe(0)

      harness.clock.advance(31_000)
      const first = await recovery(harness).run()
      expect(first).toMatchObject({
        appliedBatches: 1,
        appendedCommitted: 1,
        confirmedBatches: 1,
        recoveredResults: 1,
        plannerCalls: 0
      })
      expect(planner.calls.count).toBe(1)
      expect(loadVerifiedProjectionSources(harness.capability)).toHaveLength(1)
      expect(loadVerifiedProjectionSources(harness.capability)[0].committed).not.toBeNull()
      expect(rowCount(harness.database, 'applied_event_batch')).toBe(1)
      expect(rowCount(harness.database, 'synthetic_projection')).toBe(2)
      expect(harness.store.findByCommandId(command.envelope.commandId)).toMatchObject({
        status: 'SUCCEEDED',
        attemptCount: 1,
        currentLeaseGeneration: 2
      })

      const second = await recovery(harness, 'worker-recovery-second').run()
      expect(second).toMatchObject({
        appliedBatches: 0,
        appendedCommitted: 0,
        confirmedBatches: 0,
        recoveredResults: 0,
        plannerCalls: 0
      })
      expect(rowCount(harness.database, 'applied_event_batch')).toBe(1)
      expect(planner.calls.count).toBe(1)
      expect(readFileSync(resolve(process.cwd(), 'src/main/domain/event-batch/batch-coordinator.ts'), 'utf8'))
        .toMatch(
          /segmentStore\.current\.appendPrepared\(prepared, events\)\s+ponr = true[\s\S]*?plan = null\s+\}\)\(\)\s+this\.fault\?\.hit\('AFTER_PREPARE_FSYNC'/
        )
    } finally {
      harness.close()
    }
  })

  it('resets an expired pre-PONR command only after proving no complete PREPARE exists', async () => {
    const harness = await createSyntheticHarness()
    try {
      const command = acceptSyntheticCommand({ harness })
      await expect(coordinator({
        harness,
        faultInjector: createEventBatchFaultInjectorForTests({ failAt: 'BEFORE_PREPARE' })
      }).execute({
        envelope: command.envelope,
        readSnapshot: () => syntheticSnapshot(),
        planner: syntheticPlanner({ command, values: ['one'] })
      })).rejects.toThrow(/BEFORE_PREPARE/)
      expect(loadVerifiedProjectionSources(harness.capability)).toEqual([])

      harness.clock.advance(31_000)
      expect(await recovery(harness).run()).toMatchObject({
        resetPrePonrCommands: 1,
        plannerCalls: 0
      })
      expect(harness.store.findByCommandId(command.envelope.commandId)).toMatchObject({
        status: 'PENDING',
        attemptCount: 1,
        leaseOwner: null
      })
      expect(rowCount(harness.database, 'applied_event_batch')).toBe(0)
    } finally {
      harness.close()
    }
  })

  it('accepts an already durable matching COMMITTED exactly once and only fills later phases', async () => {
    const harness = await createSyntheticHarness()
    try {
      const command = acceptSyntheticCommand({ harness })
      await expect(coordinator({
        harness,
        faultInjector: createEventBatchFaultInjectorForTests({ failAt: 'AFTER_COMMITTED_FSYNC' })
      }).execute({
        envelope: command.envelope,
        readSnapshot: () => syntheticSnapshot(),
        planner: syntheticPlanner({ command, values: ['one'] })
      })).rejects.toThrow(/AFTER_COMMITTED_FSYNC/)
      const sourceBefore = loadVerifiedProjectionSources(harness.capability)[0]
      expect(sourceBefore.committed).not.toBeNull()

      harness.clock.advance(31_000)
      await expect(recovery(
        harness,
        'worker-confirm-crash',
        createEventBatchFaultInjectorForTests({ failAt: 'BEFORE_CONFIRM' })
      ).run()).rejects.toThrow(/BEFORE_CONFIRM/)
      harness.clock.advance(31_000)
      expect(await recovery(harness).run()).toMatchObject({
        appendedCommitted: 0,
        confirmedBatches: 1,
        recoveredResults: 1
      })
      const segment = harness.capability.readStable(sourceBefore.relativePath)!.bytes.toString('utf8')
      expect(segment.match(/"type":"BATCH_COMMITTED"/g)).toHaveLength(1)
      expect(harness.database.prepare('SELECT batch_status FROM applied_event_batch').get())
        .toEqual({ batch_status: 'CONFIRMED' })
    } finally {
      harness.close()
    }
  })

  it('does not append COMMITTED when its recovery lease is taken over immediately before the file write', async () => {
    const harness = await createSyntheticHarness()
    try {
      const command = acceptSyntheticCommand({ harness, workerId: 'worker-old' })
      await expect(coordinator({
        harness,
        workerId: 'worker-old',
        faultInjector: createEventBatchFaultInjectorForTests({ failAt: 'AFTER_APPLY_COMMIT' })
      }).execute({
        envelope: command.envelope,
        readSnapshot: () => syntheticSnapshot(),
        planner: syntheticPlanner({ command, values: ['one'] })
      })).rejects.toThrow(/AFTER_APPLY_COMMIT/)
      const source = loadVerifiedProjectionSources(harness.capability)[0]
      const segmentBefore = harness.capability.readStable(source.relativePath)!
      expect(source.committed).toBeNull()
      expect(harness.database.prepare('SELECT batch_status FROM applied_event_batch').get())
        .toEqual({ batch_status: 'APPLIED' })

      harness.clock.advance(31_000)
      let takeoverCount = 0
      const injector = createEventBatchFaultInjectorForTests({
        failAt: null,
        onHit: (point) => {
          if (point !== 'BEFORE_CONFIRM' || takeoverCount > 0) return
          const recoveryLease = harness.store.findByCommandId(command.row.commandId)!
          expect(recoveryLease).toMatchObject({
            leaseOwner: 'worker-recovery-old',
            currentLeaseGeneration: 2,
            attemptCount: 1
          })
          harness.clock.advance(31_000)
          const takenOver = harness.store.takeoverPreparedLease({
            commandId: command.row.commandId,
            batchId: command.row.eventBatchId,
            requestHash: command.row.requestHash,
            preparedLeaseGeneration: source.prepared.prepared_lease_generation,
            seenGeneration: recoveryLease.currentLeaseGeneration,
            workerId: 'worker-recovery-new',
            now: harness.clock.iso()
          })!
          takeoverCount += 1
          expect(takenOver).toMatchObject({
            currentLeaseGeneration: 3,
            attemptCount: 1
          })
        }
      })

      await expect(recovery(harness, 'worker-recovery-old', injector).run())
        .rejects.toMatchObject({ code: 'RECOVERY_BUSY' })

      expect(takeoverCount).toBe(1)
      expect(harness.capability.readStable(source.relativePath)).toMatchObject({
        byteSize: segmentBefore.byteSize,
        sha256: segmentBefore.sha256
      })
      expect(loadVerifiedProjectionSources(harness.capability)[0].committed).toBeNull()
      expect(harness.capability.readStable('segment_index.json')).toBeNull()
      expect(harness.database.prepare('SELECT batch_status FROM applied_event_batch').get())
        .toEqual({ batch_status: 'APPLIED' })
      expect(harness.store.findByCommandId(command.row.commandId)).toMatchObject({
        status: 'PROCESSING',
        resultJson: null,
        leaseOwner: 'worker-recovery-new',
        currentLeaseGeneration: 3,
        attemptCount: 1
      })
    } finally {
      harness.close()
    }
  })

  it('reuses an exact durable tail archive and truncates only the incomplete active bytes', async () => {
    const harness = await createSyntheticHarness()
    try {
      const command = acceptSyntheticCommand({ harness })
      await coordinator({ harness }).execute({
        envelope: command.envelope,
        readSnapshot: () => syntheticSnapshot(),
        planner: syntheticPlanner({ command, values: ['one'] })
      })
      const source = loadVerifiedProjectionSources(harness.capability)[0]
      const before = harness.capability.readStable(source.relativePath)!
      const incomplete = Buffer.from('{"type":"BATCH_PREPARED"', 'utf8')
      const segment = harness.capability.openAppend(source.relativePath)
      harness.capability.appendExact(segment, incomplete)
      harness.capability.syncFile(segment)
      harness.capability.close(segment)

      const damaged = harness.capability.readStable(source.relativePath)!
      const operationId = createHash('sha256')
        .update([
          source.segmentId,
          damaged.sha256,
          before.byteSize,
          createHash('sha256').update(incomplete).digest('hex')
        ].join('\u0000'), 'utf8')
        .digest('hex')
        .slice(0, 32)
      harness.capability.ensureDirectory('event-log/recovery-evidence')
      const archive = harness.capability.createExclusive(
        `event-log/recovery-evidence/active-tail-${operationId}.bin`,
        incomplete
      )
      harness.capability.close(archive)

      expect(await recovery(harness, 'worker-tail-repair').run()).toMatchObject({ repairedTailBytes: incomplete.length })
      const after = harness.capability.readStable(source.relativePath)!
      expect(after.byteSize).toBe(before.byteSize)
      expect(after.sha256).toBe(before.sha256)
      expect(harness.capability.listRegularFiles('event-log/recovery-evidence')).toEqual([
        `event-log/recovery-evidence/active-tail-${operationId}.bin`
      ])
    } finally {
      harness.close()
    }
  })
})
