import {
  canonicalJson,
  canonicalJsonBytes,
  parseCanonicalJsonLine,
  sha256CanonicalJson,
  type CanonicalJsonValue
} from './canonical-json'

export const EVENT_BATCH_RECORD_TYPES = Object.freeze([
  'BATCH_PREPARED',
  'EVENT',
  'BATCH_COMMITTED'
] as const)

export type EventBatchRecordType = (typeof EVENT_BATCH_RECORD_TYPES)[number]

export interface BatchPreparedRecord {
  type: 'BATCH_PREPARED'
  batch_id: string
  batch_sequence: number
  segment_id: string
  command_id: string
  request_hash: string
  prepared_lease_generation: number
  worker_id: string
  event_count: number
  previous_batch_hash: string
  events_hash: string
  batch_hash: string
  timestamp: string
}

export interface EventRecord {
  type: 'EVENT'
  batch_id: string
  event_id: string
  aggregate_type: string
  aggregate_id: string
  event_type: string
  event_sequence: number
  payload: { [key: string]: CanonicalJsonValue }
  checksum: string
  actor_id: string
  timestamp: string
}

export interface BatchCommittedRecord {
  type: 'BATCH_COMMITTED'
  batch_id: string
  batch_sequence: number
  timestamp: string
}

export type EventBatchRecord = BatchPreparedRecord | EventRecord | BatchCommittedRecord

export class EventBatchRecordError extends Error {
  constructor(message: string, public readonly field = '$') {
    super(`[event-batch-record] ${message} at ${field}`)
    this.name = 'EventBatchRecordError'
  }
}

const PREPARED_KEYS = Object.freeze([
  'batch_hash',
  'batch_id',
  'batch_sequence',
  'command_id',
  'event_count',
  'events_hash',
  'prepared_lease_generation',
  'previous_batch_hash',
  'request_hash',
  'segment_id',
  'timestamp',
  'type',
  'worker_id'
])

const EVENT_KEYS = Object.freeze([
  'actor_id',
  'aggregate_id',
  'aggregate_type',
  'batch_id',
  'checksum',
  'event_id',
  'event_sequence',
  'event_type',
  'payload',
  'timestamp',
  'type'
])

const COMMITTED_KEYS = Object.freeze([
  'batch_id',
  'batch_sequence',
  'timestamp',
  'type'
])

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new EventBatchRecordError('record must be a JSON object')
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new EventBatchRecordError('record must be a plain JSON object')
  }
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(value).sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    const expectedSet = new Set(expected)
    const actualSet = new Set(actual)
    const missing = expected.filter((key) => !actualSet.has(key))
    const unknown = actual.filter((key) => !expectedSet.has(key))
    throw new EventBatchRecordError(`field set mismatch; missing=${missing.join(',') || 'none'}; unknown=${unknown.join(',') || 'none'}`)
  }
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value !== value.trim()) {
    throw new EventBatchRecordError('must be a non-empty string without edge whitespace', field)
  }
  return value
}

function positiveInteger(value: unknown, field: string, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    throw new EventBatchRecordError(`must be an integer in [1, ${maximum}]`, field)
  }
  return value as number
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new EventBatchRecordError('must be a non-negative safe integer', field)
  }
  return value as number
}

function hash(value: unknown, field: string, allowGenesis = false): string {
  if (allowGenesis && value === 'GENESIS') return value
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new EventBatchRecordError('must be a 64-character lowercase SHA-256 hex digest', field)
  }
  return value
}

function timestamp(value: unknown, field: string): string {
  const parsed = text(value, field)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(parsed) || new Date(parsed).toISOString() !== parsed) {
    throw new EventBatchRecordError('must be an exact UTC ISO-8601 millisecond timestamp', field)
  }
  return parsed
}

function identifier(value: unknown, field: string): string {
  const parsed = text(value, field)
  if (Buffer.byteLength(parsed, 'utf8') > 512) throw new EventBatchRecordError('identifier exceeds 512 UTF-8 bytes', field)
  return parsed
}

export function validateBatchPreparedRecord(value: unknown): BatchPreparedRecord {
  const input = record(value)
  exactKeys(input, PREPARED_KEYS)
  if (input.type !== 'BATCH_PREPARED') throw new EventBatchRecordError('must equal BATCH_PREPARED', 'type')
  const segmentId = identifier(input.segment_id, 'segment_id')
  if (!/^seg_\d{12}$/.test(segmentId)) throw new EventBatchRecordError('must match seg_ plus 12 digits', 'segment_id')
  return {
    type: 'BATCH_PREPARED',
    batch_id: identifier(input.batch_id, 'batch_id'),
    batch_sequence: positiveInteger(input.batch_sequence, 'batch_sequence'),
    segment_id: segmentId,
    command_id: identifier(input.command_id, 'command_id'),
    request_hash: hash(input.request_hash, 'request_hash'),
    prepared_lease_generation: nonNegativeInteger(input.prepared_lease_generation, 'prepared_lease_generation'),
    worker_id: identifier(input.worker_id, 'worker_id'),
    event_count: positiveInteger(input.event_count, 'event_count', 1000),
    previous_batch_hash: hash(input.previous_batch_hash, 'previous_batch_hash', true),
    events_hash: hash(input.events_hash, 'events_hash'),
    batch_hash: hash(input.batch_hash, 'batch_hash'),
    timestamp: timestamp(input.timestamp, 'timestamp')
  }
}

export function validateEventRecord(value: unknown): EventRecord {
  const input = record(value)
  exactKeys(input, EVENT_KEYS)
  if (input.type !== 'EVENT') throw new EventBatchRecordError('must equal EVENT', 'type')
  const payload = record(input.payload)
  canonicalJson(payload)
  const checksum = hash(input.checksum, 'checksum')
  const expectedChecksum = sha256CanonicalJson(payload)
  if (checksum !== expectedChecksum) throw new EventBatchRecordError('payload checksum mismatch', 'checksum')
  const aggregateType = identifier(input.aggregate_type, 'aggregate_type')
  const eventType = identifier(input.event_type, 'event_type')
  if (!/^[A-Z][A-Z0-9_]*$/.test(aggregateType)) throw new EventBatchRecordError('must be an uppercase protocol token', 'aggregate_type')
  if (!/^[A-Z][A-Z0-9_]*$/.test(eventType)) throw new EventBatchRecordError('must be an uppercase protocol token', 'event_type')
  return {
    type: 'EVENT',
    batch_id: identifier(input.batch_id, 'batch_id'),
    event_id: identifier(input.event_id, 'event_id'),
    aggregate_type: aggregateType,
    aggregate_id: identifier(input.aggregate_id, 'aggregate_id'),
    event_type: eventType,
    event_sequence: positiveInteger(input.event_sequence, 'event_sequence'),
    payload: payload as { [key: string]: CanonicalJsonValue },
    checksum,
    actor_id: identifier(input.actor_id, 'actor_id'),
    timestamp: timestamp(input.timestamp, 'timestamp')
  }
}

export function validateBatchCommittedRecord(value: unknown): BatchCommittedRecord {
  const input = record(value)
  exactKeys(input, COMMITTED_KEYS)
  if (input.type !== 'BATCH_COMMITTED') throw new EventBatchRecordError('must equal BATCH_COMMITTED', 'type')
  return {
    type: 'BATCH_COMMITTED',
    batch_id: identifier(input.batch_id, 'batch_id'),
    batch_sequence: positiveInteger(input.batch_sequence, 'batch_sequence'),
    timestamp: timestamp(input.timestamp, 'timestamp')
  }
}

export function validateEventBatchRecord(value: unknown): EventBatchRecord {
  const input = record(value)
  if (input.type === 'BATCH_PREPARED') return validateBatchPreparedRecord(input)
  if (input.type === 'EVENT') return validateEventRecord(input)
  if (input.type === 'BATCH_COMMITTED') return validateBatchCommittedRecord(input)
  throw new EventBatchRecordError('unknown permanent record type', 'type')
}

export function eventBatchRecordBytes(recordValue: EventBatchRecord): Buffer {
  return canonicalJsonBytes(validateEventBatchRecord(recordValue), true)
}

export function parseEventBatchRecordLine(bytes: Uint8Array): EventBatchRecord {
  return validateEventBatchRecord(parseCanonicalJsonLine(bytes))
}
