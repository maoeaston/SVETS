import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import {
  calculateBatchHash,
  calculateEventsHash,
  createBatchCommittedRecord,
  createBatchPreparedRecord,
  createEventRecord,
  eventRecordBytes,
  MAX_BATCH_EVENT_BYTES,
  MAX_BATCH_EVENT_COUNT,
  validateCommittedForBatch,
  validatePreparedBatch
} from '../batch-hash'
import { canonicalJsonBytes, sha256Hex } from '../canonical-json'
import {
  eventBatchRecordBytes,
  parseEventBatchRecordLine,
  validateEventBatchRecord,
  validateEventRecord,
  type BatchPreparedRecord,
  type EventRecord
} from '../record-types'

const golden = JSON.parse(readFileSync(
  resolve(process.cwd(), 'scripts/fixtures/m5b-event-batch-golden-v1.json'),
  'utf8'
))

function events(): EventRecord[] {
  return structuredClone(golden.batch.events)
}

function prepared(): BatchPreparedRecord {
  return structuredClone(golden.batch.prepared)
}

describe('M5B event record and batch hashes', () => {
  it('matches the frozen EVENT checksum, LF, events_hash, and GENESIS batch_hash vectors', () => {
    const eventValues = events()
    expect(eventValues.map((event) => eventBatchRecordBytes(event).toString('utf8'))).toEqual(golden.batch.event_lines)
    expect(eventRecordBytes(eventValues).at(-1)).toBe(0x0a)
    expect(calculateEventsHash(eventValues)).toBe(golden.batch.events_hash)
    expect(calculateBatchHash('GENESIS', golden.batch.events_hash)).toBe(golden.batch.batch_hash)
    const verified = validatePreparedBatch(prepared(), eventValues)
    expect(verified.preparedBytes.toString('utf8')).toBe(`${golden.batch.prepared_line}${golden.batch.event_lines.join('')}`)
    expect(sha256Hex(verified.preparedBytes)).toBe(golden.batch.prepared_batch_bytes_sha256)
    expect(sha256Hex(Buffer.concat([
      verified.preparedBytes,
      Buffer.from(golden.batch.committed_line, 'utf8')
    ]))).toBe(golden.batch.complete_batch_bytes_sha256)
  })

  it('constructs the same records from unordered inputs', () => {
    const eventValues = events().map((event) => createEventRecord({
      batch_id: event.batch_id,
      event_id: event.event_id,
      aggregate_type: event.aggregate_type,
      aggregate_id: event.aggregate_id,
      event_type: event.event_type,
      event_sequence: event.event_sequence,
      payload: event.payload,
      actor_id: event.actor_id,
      timestamp: event.timestamp
    }))
    expect(eventValues).toEqual(events())
    expect(createBatchPreparedRecord({
      batch_id: 'batch-0001',
      batch_sequence: 1,
      segment_id: 'seg_000000000001',
      command_id: 'command-0001',
      request_hash: '1'.repeat(64),
      prepared_lease_generation: 1,
      worker_id: 'worker-0001',
      previous_batch_hash: 'GENESIS',
      timestamp: '2026-07-29T08:00:00.000Z'
    }, eventValues)).toEqual(prepared())
    expect(createBatchCommittedRecord({
      batch_id: 'batch-0001', batch_sequence: 1, timestamp: '2026-07-29T08:00:00.200Z'
    })).toEqual(golden.batch.committed)
  })

  it('rejects unknown fields, unknown record types, noncanonical lines, and checksum tamper', () => {
    expect(() => validateEventBatchRecord({ ...events()[0], sidecar_intent: {} })).toThrow(/field set mismatch/)
    expect(() => validateEventBatchRecord({ type: 'SIDE_EFFECT', value: 1 })).toThrow(/unknown permanent record type/)
    expect(() => parseEventBatchRecordLine(Buffer.from(`${JSON.stringify(events()[0])}\n`, 'utf8'))).toThrow(/not canonical/)
    expect(() => validateEventRecord({ ...events()[0], checksum: '0'.repeat(64) })).toThrow(/checksum mismatch/)
    expect(() => validateEventRecord({ ...events()[0], payload: { changed: true } })).toThrow(/checksum mismatch/)
  })

  it('detects every EVENT top-level field tamper through shape, checksum, or prepared hash verification', () => {
    const original = events()
    const alternatives: Record<string, unknown> = {
      type: 'UNKNOWN',
      batch_id: 'batch-other',
      event_id: 'event-other',
      aggregate_type: 'TRAINING_SESSION',
      aggregate_id: 'session-other',
      event_type: 'SESSION_COMPLETED',
      event_sequence: 7,
      payload: { answer_id: 'tampered' },
      checksum: '0'.repeat(64),
      actor_id: 'actor-other',
      timestamp: '2026-07-29T08:00:00.999Z'
    }
    for (const [field, replacement] of Object.entries(alternatives)) {
      const tampered = structuredClone(original)
      tampered[0] = { ...tampered[0], [field]: replacement }
      expect(() => validatePreparedBatch(prepared(), tampered)).toThrow()
    }
  })

  it('detects prepared hash/count/identity tamper and mismatched COMMITTED records', () => {
    for (const change of [
      { event_count: 1 },
      { events_hash: '0'.repeat(64) },
      { batch_hash: '0'.repeat(64) },
      { previous_batch_hash: '0'.repeat(64) },
      { batch_id: 'batch-other' }
    ]) {
      expect(() => validatePreparedBatch({ ...prepared(), ...change }, events())).toThrow()
    }
    expect(() => validateCommittedForBatch(prepared(), { ...golden.batch.committed, batch_sequence: 2 })).toThrow(/does not identify/)
    expect(() => validateCommittedForBatch(prepared(), { ...golden.batch.committed, batch_id: 'batch-other' })).toThrow(/does not identify/)
  })

  it('requires unique event IDs and contiguous per-aggregate sequences', () => {
    const duplicate = events()
    duplicate[1].event_id = duplicate[0].event_id
    expect(() => createBatchPreparedRecord({
      ...prepared(),
      previous_batch_hash: 'GENESIS'
    } as never, duplicate)).toThrow(/duplicate event_id/)

    const gap = events()
    gap[1].event_sequence = 8
    expect(() => validatePreparedBatch(prepared(), gap)).toThrow(/not contiguous/)
  })

  it('enforces 1..1000 events and the 8 MiB canonical EVENT limit before PREPARE', () => {
    expect(() => eventRecordBytes([])).toThrow(/event count/)
    const event = events()[0]
    expect(() => eventRecordBytes(Array.from({ length: MAX_BATCH_EVENT_COUNT + 1 }, () => event))).toThrow(/event count/)

    const oversized = createEventRecord({
      ...event,
      event_id: 'event-oversized',
      payload: { bytes: 'x'.repeat(MAX_BATCH_EVENT_BYTES) }
    })
    expect(() => eventRecordBytes([oversized])).toThrow(/exceed/)
  })

  it('uses lowercase hex and concatenates hash strings as UTF-8, not decoded digest bytes', () => {
    const expected = sha256Hex(Buffer.from(`GENESIS${golden.batch.events_hash}`, 'utf8'))
    expect(calculateBatchHash('GENESIS', golden.batch.events_hash)).toBe(expected)
    expect(expected).toMatch(/^[0-9a-f]{64}$/)
    expect(() => calculateBatchHash('genesis', golden.batch.events_hash)).toThrow()
    expect(() => calculateBatchHash('GENESIS', golden.batch.events_hash.toUpperCase())).toThrow()
    expect(canonicalJsonBytes(events()[0].payload).length).toBeGreaterThan(0)
  })
})
