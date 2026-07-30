import { describe, expect, it } from 'vitest'
import { eventBatchRecordBytes } from '../record-types'
import {
  assertPreparedProjectionInCurrentTransaction,
  loadVerifiedProjectionSources,
  writeProjectionSourceInCurrentTransaction
} from '../projection-source'
import {
  acceptSyntheticCommand,
  coordinator,
  createSyntheticHarness,
  syntheticPlanner,
  syntheticSnapshot
} from './coordinator-test-support'

describe('M5B verified projection source', () => {
  it('persists canonical relative segment path and exact EVENT line/byte origins', async () => {
    const harness = await createSyntheticHarness()
    try {
      const command = acceptSyntheticCommand({ harness })
      await coordinator({ harness }).execute({
        envelope: command.envelope,
        readSnapshot: () => syntheticSnapshot(),
        planner: syntheticPlanner({ command, values: ['one', 'two'] })
      })
      const source = loadVerifiedProjectionSources(harness.capability)[0]
      const segment = harness.capability.readStable(source.relativePath)!

      expect(source.relativePath).toBe('event-log/segments/seg_000000000001.jsonl')
      expect(source.relativePath.startsWith('/')).toBe(false)
      expect(source.events.map((event) => event.lineNumber)).toEqual([2, 3])
      for (const event of source.events) {
        expect(segment.bytes.subarray(event.byteOffset, event.byteEnd))
          .toEqual(eventBatchRecordBytes(event.record))
        expect(harness.database.prepare(
          'SELECT source_log_path, source_log_line_no, source_log_byte_offset, schema_version FROM domain_event_projection WHERE event_id = ?'
        ).get(event.record.event_id)).toEqual({
          source_log_path: source.relativePath,
          source_log_line_no: event.lineNumber,
          source_log_byte_offset: event.byteOffset,
          schema_version: 1
        })
      }
      expect(harness.database.prepare(
        'SELECT segment_id, event_count FROM applied_event_batch WHERE batch_id = ?'
      ).get(source.prepared.batch_id)).toEqual({ segment_id: source.segmentId, event_count: 2 })
    } finally {
      harness.close()
    }
  })

  it('fails closed on an absolute source path or processed/projection/batch reconciliation drift', async () => {
    const harness = await createSyntheticHarness()
    try {
      const command = acceptSyntheticCommand({ harness })
      await coordinator({ harness }).execute({
        envelope: command.envelope,
        readSnapshot: () => syntheticSnapshot(),
        planner: syntheticPlanner({ command, values: ['one'] })
      })
      const source = loadVerifiedProjectionSources(harness.capability)[0]
      const event = source.events[0]
      expect(() => writeProjectionSourceInCurrentTransaction({
        database: harness.database,
        source,
        event: Object.freeze({ ...event, relativePath: '/tmp/forged-segment.jsonl' }),
        processedAt: harness.clock.iso(),
        allowExisting: true
      })).toThrow(/canonical and relative/)

      harness.database.prepare(
        'UPDATE processed_event SET aggregate_id = ? WHERE event_id = ?'
      ).run('forged-aggregate', event.record.event_id)
      expect(() => assertPreparedProjectionInCurrentTransaction({
        database: harness.database,
        command: harness.store.findByCommandId(command.envelope.commandId)!,
        source,
        registry: harness.registry
      })).toThrow(/processed_event.*conflicts/)

      harness.database.prepare(
        'UPDATE processed_event SET aggregate_id = ? WHERE event_id = ?'
      ).run(event.record.aggregate_id, event.record.event_id)
      harness.database.prepare(
        'UPDATE applied_event_batch SET segment_id = ? WHERE batch_id = ?'
      ).run('seg_000000000999', source.prepared.batch_id)
      expect(() => assertPreparedProjectionInCurrentTransaction({
        database: harness.database,
        command: harness.store.findByCommandId(command.envelope.commandId)!,
        source,
        registry: harness.registry
      })).toThrow(/segment_id.*conflicts/)
    } finally {
      harness.close()
    }
  })
})
