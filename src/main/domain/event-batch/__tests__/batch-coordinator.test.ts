import { describe, expect, it } from 'vitest'
import { PRE_PONR_EXECUTION_ERROR_CODE } from '../../../application/command/durable-command-coordinator'
import { parseCommandResultJson } from '../../../application/command/command-result'
import { loadVerifiedProjectionSources } from '../projection-source'
import { readSegmentIndexFile } from '../segment-index'
import {
  acceptSyntheticCommand,
  coordinator,
  createSyntheticHarness,
  rowCount,
  syntheticPlanner,
  syntheticSnapshot
} from './coordinator-test-support'

describe('M5B generic event-batch coordinator', () => {
  it('executes one root as one 1..N batch and derives effects/result only from durable EVENT facts', async () => {
    const harness = await createSyntheticHarness()
    try {
      const command = acceptSyntheticCommand({ harness })
      const planner = syntheticPlanner({ command, values: ['one', 'two', 'three'] })
      const result = await coordinator({ harness }).execute({
        envelope: command.envelope,
        readSnapshot: () => syntheticSnapshot(),
        planner
      })

      expect(planner.calls.count).toBe(1)
      expect(result.status).toBe('COMPLETED')
      expect(result.publicResult).toEqual({ success: true, event_count: 3, values: ['one', 'two', 'three'] })
      expect(result.batch?.committed).not.toBeNull()
      expect(rowCount(harness.database, 'applied_event_batch')).toBe(1)
      expect(rowCount(harness.database, 'processed_event')).toBe(3)
      expect(rowCount(harness.database, 'domain_event_projection')).toBe(3)
      expect(rowCount(harness.database, 'synthetic_projection')).toBe(3)
      expect(rowCount(harness.database, 'synthetic_effect')).toBe(3)
      expect(harness.database.prepare('SELECT * FROM applied_event_batch').get()).toMatchObject({
        batch_id: command.envelope.eventBatchId,
        batch_sequence: 1,
        batch_status: 'CONFIRMED'
      })
      expect(harness.database.prepare('SELECT * FROM projector_cursor').get()).toMatchObject({
        last_batch_id: command.envelope.eventBatchId,
        last_batch_sequence: 1
      })
      expect(readSegmentIndexFile(harness.capability)?.index).toMatchObject({
        last_global_batch_sequence: 1,
        last_confirmed_batch_sequence: 1
      })
      const persisted = harness.store.findByCommandId(command.envelope.commandId)!
      expect(persisted.status).toBe('SUCCEEDED')
      const rebuiltResult = harness.registry.resultFromPrepared(persisted, result.batch!)
      expect(Object.isFrozen(rebuiltResult)).toBe(true)
      expect(Object.isFrozen(rebuiltResult.values)).toBe(true)
      expect(parseCommandResultJson(persisted.resultJson!)).toEqual({
        schema_version: 'command-result-v1',
        public_result: result.publicResult
      })
    } finally {
      harness.close()
    }
  })

  it('completes a synthetic no-op with its reserved batch unused and no DB/file domain writes', async () => {
    const harness = await createSyntheticHarness()
    try {
      const command = acceptSyntheticCommand({ harness, slot: 2 })
      const planner = syntheticPlanner({
        command,
        slot: 2,
        values: [],
        noOpResult: { success: true, no_op: true, reason: 'UNCHANGED' }
      })
      const result = await coordinator({ harness }).execute({
        envelope: command.envelope,
        readSnapshot: () => syntheticSnapshot(),
        planner
      })

      expect(result).toMatchObject({
        status: 'COMPLETED',
        batch: null,
        publicResult: { success: true, no_op: true, reason: 'UNCHANGED' }
      })
      expect(harness.store.findByCommandId(command.envelope.commandId)).toMatchObject({
        eventBatchId: command.envelope.eventBatchId,
        status: 'SUCCEEDED'
      })
      expect(rowCount(harness.database, 'applied_event_batch')).toBe(0)
      expect(rowCount(harness.database, 'domain_event_projection')).toBe(0)
      expect(loadVerifiedProjectionSources(harness.capability)).toEqual([])
      expect(harness.capability.listRegularFiles('event-log/segments')).toEqual([])
    } finally {
      harness.close()
    }
  })

  it('marks a caught planner failure as FAILED before PREPARE without writing a batch', async () => {
    const harness = await createSyntheticHarness()
    try {
      const command = acceptSyntheticCommand({ harness, slot: 3 })
      await expect(coordinator({ harness }).execute({
        envelope: command.envelope,
        readSnapshot: () => syntheticSnapshot(),
        planner: {
          plan() {
            throw new Error('injected planner failure')
          }
        }
      })).rejects.toThrow('injected planner failure')

      expect(harness.store.findByCommandId(command.envelope.commandId)).toMatchObject({
        status: 'FAILED',
        errorCode: PRE_PONR_EXECUTION_ERROR_CODE,
        resultJson: null,
        leaseOwner: null
      })
      expect(rowCount(harness.database, 'applied_event_batch')).toBe(0)
      expect(loadVerifiedProjectionSources(harness.capability)).toEqual([])
    } finally {
      harness.close()
    }
  })

  it('leaves an uncertain PREPARE write PROCESSING for recovery when its file sync fails', async () => {
    let syncCalls = 0
    const harness = await createSyntheticHarness({
      fileDurabilityHooks: {
        syncFile: () => {
          syncCalls += 1
          if (syncCalls === 2) throw new Error('injected PREPARE sync failure')
        },
        syncDirectory: () => undefined
      }
    })
    try {
      const command = acceptSyntheticCommand({ harness, slot: 4 })
      await expect(coordinator({ harness }).execute({
        envelope: command.envelope,
        readSnapshot: () => syntheticSnapshot(),
        planner: syntheticPlanner({ command, slot: 4, values: ['sync-uncertain'] })
      })).rejects.toThrow(/file sync failed/)

      expect(harness.store.findByCommandId(command.envelope.commandId)).toMatchObject({
        status: 'PROCESSING',
        errorCode: null,
        resultJson: null
      })
      expect(loadVerifiedProjectionSources(harness.capability)).toHaveLength(1)
    } finally {
      harness.close()
    }
  })

  it('loads planner facts only after owning the writer mutex', async () => {
    const harness = await createSyntheticHarness()
    try {
      const command = acceptSyntheticCommand({ harness, slot: 3 })
      const blocker = await harness.mutex.acquire('snapshot-test-blocker')
      let readCount = 0
      const execution = coordinator({ harness }).execute({
        envelope: command.envelope,
        readSnapshot: () => {
          readCount += 1
          return syntheticSnapshot()
        },
        planner: syntheticPlanner({ command, slot: 3, values: ['locked-read'] })
      })

      await Promise.resolve()
      expect(readCount).toBe(0)
      blocker.release()

      await expect(execution).resolves.toMatchObject({
        status: 'COMPLETED',
        publicResult: { success: true, values: ['locked-read'] }
      })
      expect(readCount).toBe(1)
    } finally {
      harness.close()
    }
  })

  it('keeps global sequence/hash and projector cursor monotonic across distinct root commands', async () => {
    const harness = await createSyntheticHarness()
    try {
      for (const slot of [1, 2]) {
        const command = acceptSyntheticCommand({ harness, slot })
        await coordinator({ harness }).execute({
          envelope: command.envelope,
          readSnapshot: () => syntheticSnapshot(),
          planner: syntheticPlanner({ command, slot, values: [`value-${slot}`] })
        })
      }
      const sources = loadVerifiedProjectionSources(harness.capability)
      expect(sources.map((source) => source.prepared.batch_sequence)).toEqual([1, 2])
      expect(sources[1].prepared.previous_batch_hash).toBe(sources[0].prepared.batch_hash)
      expect(rowCount(harness.database, 'applied_event_batch')).toBe(2)
      expect(harness.database.prepare('SELECT * FROM projector_cursor').get()).toMatchObject({
        last_batch_id: sources[1].prepared.batch_id,
        last_batch_sequence: 2
      })
    } finally {
      harness.close()
    }
  })
})
