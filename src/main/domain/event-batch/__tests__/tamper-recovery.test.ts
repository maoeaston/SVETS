import { describe, expect, it } from 'vitest'
import { createCommandResultJson } from '../../../application/command/command-result'
import { DurableCommandStore } from '../../../application/command/durable-command-store'
import {
  createBatchCommittedRecord
} from '../batch-hash'
import type { CommandPlanV1 } from '../command-plan'
import { createEventBatchFaultInjectorForTests } from '../fault-injection'
import { DurableFileCapability } from '../file-capability'
import { loadVerifiedProjectionSources } from '../projection-source'
import { eventBatchRecordBytes } from '../record-types'
import { RuntimeCorruptionState } from '../runtime-corruption'
import { StartupRecovery } from '../startup-recovery'
import { FairWriterMutex } from '../writer-mutex'
import {
  acceptSyntheticCommand,
  coordinator,
  createSyntheticHarness,
  createSyntheticRegistry,
  rowCount,
  SYNTHETIC_RESULT_VERSION,
  syntheticPlanner,
  syntheticSnapshot
} from './coordinator-test-support'

function restartedRecovery(options: {
  harness: Awaited<ReturnType<typeof createSyntheticHarness>>
  corruption: RuntimeCorruptionState
}) {
  return new StartupRecovery({
    database: options.harness.database,
    commandStore: new DurableCommandStore(options.harness.database),
    registry: createSyntheticRegistry(),
    fileCapability: new DurableFileCapability(options.harness.root),
    corruptionState: options.corruption,
    workerId: 'worker-tamper-recovery',
    legacyAnchor: null,
    writerMutex: new FairWriterMutex(),
    now: options.harness.clock.now
  })
}

describe('M5B prepared fact tamper recovery', () => {
  it('fails closed when a durable PREPARE references a retired result recipe', async () => {
    const harness = await createSyntheticHarness()
    try {
      const command = acceptSyntheticCommand({ harness })
      const writerRegistry = createSyntheticRegistry({
        resultRecipeVersions: [SYNTHETIC_RESULT_VERSION, 'synthetic-result-v2']
      })
      await expect(coordinator({
        harness,
        registry: writerRegistry,
        faultInjector: createEventBatchFaultInjectorForTests({ failAt: 'AFTER_PREPARE_FSYNC' })
      }).execute({
        envelope: command.envelope,
        readSnapshot: () => syntheticSnapshot(),
        planner: syntheticPlanner({
          command,
          values: ['one'],
          resultRecipeVersion: 'synthetic-result-v2'
        })
      })).rejects.toThrow(/AFTER_PREPARE_FSYNC/)

      harness.clock.advance(31_000)
      const corruption = new RuntimeCorruptionState()
      await expect(restartedRecovery({ harness, corruption }).run()).rejects.toThrow(/unknown.*result/i)
      expect(corruption.snapshot()).toMatchObject({
        state: 'CORRUPTION_READ_ONLY',
        code: 'EVENT_BATCH_RECOVERY_CONFLICT'
      })
      expect(rowCount(harness.database, 'applied_event_batch')).toBe(0)
    } finally {
      harness.close()
    }
  })

  it('fails closed when a durable PREPARE references an unknown EVENT payload version', async () => {
    const harness = await createSyntheticHarness()
    try {
      const command = acceptSyntheticCommand({ harness })
      const writerRegistry = createSyntheticRegistry({ eventPayloadVersions: [1, 2] })
      await expect(coordinator({
        harness,
        registry: writerRegistry,
        faultInjector: createEventBatchFaultInjectorForTests({ failAt: 'AFTER_PREPARE_FSYNC' })
      }).execute({
        envelope: command.envelope,
        readSnapshot: () => syntheticSnapshot(),
        planner: syntheticPlanner({ command, values: ['one'], eventPayloadVersion: 2 })
      })).rejects.toThrow(/AFTER_PREPARE_FSYNC/)

      harness.clock.advance(31_000)
      const corruption = new RuntimeCorruptionState()
      await expect(restartedRecovery({ harness, corruption }).run()).rejects.toThrow(/unknown.*@2/i)
      expect(corruption.snapshot().state).toBe('CORRUPTION_READ_ONLY')
      expect(rowCount(harness.database, 'processed_event')).toBe(0)
    } finally {
      harness.close()
    }
  })

  it('rejects duplicate or conflicting complete COMMITTED records instead of guessing a tail repair', async () => {
    for (const variant of ['DUPLICATE', 'CONFLICT'] as const) {
      const harness = await createSyntheticHarness()
      try {
        const command = acceptSyntheticCommand({ harness })
        if (variant === 'DUPLICATE') {
          await coordinator({ harness }).execute({
            envelope: command.envelope,
            readSnapshot: () => syntheticSnapshot(),
            planner: syntheticPlanner({ command, values: ['one'] })
          })
        } else {
          await expect(coordinator({
            harness,
            faultInjector: createEventBatchFaultInjectorForTests({ failAt: 'AFTER_PREPARE_FSYNC' })
          }).execute({
            envelope: command.envelope,
            readSnapshot: () => syntheticSnapshot(),
            planner: syntheticPlanner({ command, values: ['one'] })
          })).rejects.toThrow(/AFTER_PREPARE_FSYNC/)
        }
        const source = loadVerifiedProjectionSources(harness.capability)[0]
        const committed = variant === 'DUPLICATE'
          ? source.committed!.record
          : createBatchCommittedRecord({
              batch_id: 'forged-batch',
              batch_sequence: source.prepared.batch_sequence,
              timestamp: harness.clock.iso()
            })
        const segment = harness.capability.openAppend(source.relativePath)
        harness.capability.appendExact(segment, eventBatchRecordBytes(committed))
        harness.capability.syncFile(segment)
        harness.capability.close(segment)

        harness.clock.advance(31_000)
        const corruption = new RuntimeCorruptionState()
        await expect(restartedRecovery({ harness, corruption }).run()).rejects.toThrow()
        expect(corruption.snapshot().state).toBe('CORRUPTION_READ_ONLY')
      } finally {
        harness.close()
      }
    }
  })

  it('fails closed when SQLite is CONFIRMED but the durable COMMITTED record is missing', async () => {
    const harness = await createSyntheticHarness()
    try {
      const command = acceptSyntheticCommand({ harness })
      await expect(coordinator({
        harness,
        faultInjector: createEventBatchFaultInjectorForTests({ failAt: 'AFTER_SQLITE_CONFIRM' })
      }).execute({
        envelope: command.envelope,
        readSnapshot: () => syntheticSnapshot(),
        planner: syntheticPlanner({ command, values: ['one'] })
      })).rejects.toThrow(/AFTER_SQLITE_CONFIRM/)

      const committedSource = loadVerifiedProjectionSources(harness.capability)[0]
      expect(committedSource.committed).not.toBeNull()
      expect(harness.database.prepare('SELECT batch_status FROM applied_event_batch').get())
        .toEqual({ batch_status: 'CONFIRMED' })
      expect(harness.capability.readStable('segment_index.json')).toBeNull()
      const cursorBefore = harness.database.prepare('SELECT * FROM projector_cursor').get()
      const commandBefore = harness.store.findByCommandId(command.row.commandId)

      const segment = harness.capability.openAppend(committedSource.relativePath)
      harness.capability.truncate(segment, committedSource.committed!.byteOffset)
      harness.capability.syncFile(segment)
      harness.capability.close(segment)
      const truncated = harness.capability.readStable(committedSource.relativePath)!
      expect(loadVerifiedProjectionSources(harness.capability)[0].committed).toBeNull()

      harness.clock.advance(31_000)
      const corruption = new RuntimeCorruptionState()
      await expect(restartedRecovery({ harness, corruption }).run())
        .rejects.toThrow(/CONFIRMED.*no durable COMMITTED/i)

      expect(corruption.snapshot()).toMatchObject({
        state: 'CORRUPTION_READ_ONLY',
        code: 'EVENT_BATCH_RECOVERY_CONFLICT'
      })
      expect(harness.capability.readStable(committedSource.relativePath)).toMatchObject({
        byteSize: truncated.byteSize,
        sha256: truncated.sha256
      })
      expect(harness.capability.readStable('segment_index.json')).toBeNull()
      expect(harness.database.prepare('SELECT * FROM projector_cursor').get()).toEqual(cursorBefore)
      expect(harness.store.findByCommandId(command.row.commandId)).toEqual(commandBefore)
      expect(rowCount(harness.database, 'applied_event_batch')).toBe(1)
      expect(rowCount(harness.database, 'synthetic_projection')).toBe(1)
      expect(rowCount(harness.database, 'synthetic_effect')).toBe(1)
    } finally {
      harness.close()
    }
  })

  it('detects projection/effect drift and a conflicting already-persisted public result', async () => {
    for (const variant of ['EFFECT', 'RESULT'] as const) {
      const harness = await createSyntheticHarness()
      try {
        const command = acceptSyntheticCommand({ harness })
        await coordinator({ harness }).execute({
          envelope: command.envelope,
          readSnapshot: () => syntheticSnapshot(),
          planner: syntheticPlanner({ command, values: ['one'] })
        })
        if (variant === 'EFFECT') {
          harness.database.prepare('DELETE FROM synthetic_effect').run()
        } else {
          harness.database.prepare(
            'UPDATE command_log SET result_json = ? WHERE command_id = ?'
          ).run(
            createCommandResultJson({ success: true, event_count: 999, values: [] }),
            command.row.commandId
          )
        }
        const corruption = new RuntimeCorruptionState()
        await expect(restartedRecovery({ harness, corruption }).run()).rejects.toThrow()
        expect(corruption.snapshot().state).toBe('CORRUPTION_READ_ONLY')
      } finally {
        harness.close()
      }
    }
  })

  it('rejects plan-only operational effect parameters before PREPARE and leaves runtime writable', async () => {
    const harness = await createSyntheticHarness()
    try {
      const command = acceptSyntheticCommand({ harness })
      const valid = syntheticPlanner({ command, values: ['one'] })
      await expect(coordinator({ harness }).execute({
        envelope: command.envelope,
        readSnapshot: () => syntheticSnapshot(),
        planner: {
          plan: async (input) => {
            const plan = await valid.plan(input)
            return {
              ...plan,
              operationalEffects: plan.operationalEffects.map((effect) => ({
                ...effect,
                secret_plan_only_parameter: 'must-not-survive'
              }))
            } as unknown as CommandPlanV1
          }
        }
      })).rejects.toThrow(/plan-only parameters/)
      expect(harness.corruption.snapshot().state).toBe('OPEN')
      expect(loadVerifiedProjectionSources(harness.capability)).toEqual([])
      expect(rowCount(harness.database, 'applied_event_batch')).toBe(0)
    } finally {
      harness.close()
    }
  })
})
