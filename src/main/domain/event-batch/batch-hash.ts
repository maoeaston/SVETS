import {
  canonicalJsonBytes,
  sha256CanonicalJson,
  sha256Hex,
  type CanonicalJsonValue
} from './canonical-json'
import {
  eventBatchRecordBytes,
  validateBatchCommittedRecord,
  validateBatchPreparedRecord,
  validateEventRecord,
  type BatchCommittedRecord,
  type BatchPreparedRecord,
  type EventRecord
} from './record-types'

export const MAX_BATCH_EVENT_COUNT = 1000
export const MAX_BATCH_EVENT_BYTES = 8 * 1024 * 1024
export const GENESIS_BATCH_HASH = 'GENESIS'

export class EventBatchHashError extends Error {
  constructor(message: string) {
    super(`[event-batch-hash] ${message}`)
    this.name = 'EventBatchHashError'
  }
}

export type EventRecordInput = Omit<EventRecord, 'type' | 'checksum' | 'payload'> & {
  payload: { [key: string]: CanonicalJsonValue }
}

export type BatchPreparedInput = Omit<
  BatchPreparedRecord,
  'type' | 'event_count' | 'events_hash' | 'batch_hash'
>

export function createEventRecord(input: EventRecordInput): EventRecord {
  return validateEventRecord({
    type: 'EVENT',
    ...input,
    checksum: sha256CanonicalJson(input.payload)
  })
}

export function eventRecordBytes(events: readonly EventRecord[]): Buffer {
  if (events.length < 1 || events.length > MAX_BATCH_EVENT_COUNT) {
    throw new EventBatchHashError(`event count must be in [1, ${MAX_BATCH_EVENT_COUNT}]`)
  }
  const bytes = Buffer.concat(events.map((event) => eventBatchRecordBytes(validateEventRecord(event))))
  if (bytes.length > MAX_BATCH_EVENT_BYTES) {
    throw new EventBatchHashError(`canonical EVENT bytes exceed ${MAX_BATCH_EVENT_BYTES}`)
  }
  return bytes
}

export function calculateEventsHash(events: readonly EventRecord[]): string {
  return sha256Hex(eventRecordBytes(events))
}

export function calculateBatchHash(previousBatchHash: string, eventsHash: string): string {
  if (previousBatchHash !== GENESIS_BATCH_HASH && !/^[0-9a-f]{64}$/.test(previousBatchHash)) {
    throw new EventBatchHashError('previous batch hash must be GENESIS or lowercase SHA-256 hex')
  }
  if (!/^[0-9a-f]{64}$/.test(eventsHash)) {
    throw new EventBatchHashError('events hash must be lowercase SHA-256 hex')
  }
  return sha256Hex(Buffer.concat([
    Buffer.from(previousBatchHash, 'utf8'),
    Buffer.from(eventsHash, 'utf8')
  ]))
}

function assertEventIdentityAndSequence(prepared: BatchPreparedRecord, events: readonly EventRecord[]): void {
  const eventIds = new Set<string>()
  const lastSequenceByAggregate = new Map<string, number>()
  for (const [index, rawEvent] of events.entries()) {
    const event = validateEventRecord(rawEvent)
    if (event.batch_id !== prepared.batch_id) {
      throw new EventBatchHashError(`event ${index} batch_id does not match prepared batch`)
    }
    if (eventIds.has(event.event_id)) throw new EventBatchHashError(`duplicate event_id ${event.event_id}`)
    eventIds.add(event.event_id)
    const aggregateKey = `${event.aggregate_type}\u0000${event.aggregate_id}`
    const previous = lastSequenceByAggregate.get(aggregateKey)
    if (previous !== undefined && event.event_sequence !== previous + 1) {
      throw new EventBatchHashError(`event_sequence is not contiguous for ${event.aggregate_type}:${event.aggregate_id}`)
    }
    lastSequenceByAggregate.set(aggregateKey, event.event_sequence)
  }
}

export function createBatchPreparedRecord(
  input: BatchPreparedInput,
  events: readonly EventRecord[]
): BatchPreparedRecord {
  const eventsHash = calculateEventsHash(events)
  const prepared = validateBatchPreparedRecord({
    type: 'BATCH_PREPARED',
    ...input,
    event_count: events.length,
    events_hash: eventsHash,
    batch_hash: calculateBatchHash(input.previous_batch_hash, eventsHash)
  })
  assertEventIdentityAndSequence(prepared, events)
  return prepared
}

export function validatePreparedBatch(
  preparedValue: BatchPreparedRecord,
  eventValues: readonly EventRecord[]
): { prepared: BatchPreparedRecord; events: EventRecord[]; eventBytes: Buffer; preparedBytes: Buffer } {
  const prepared = validateBatchPreparedRecord(preparedValue)
  const events = eventValues.map((event) => validateEventRecord(event))
  if (prepared.event_count !== events.length) {
    throw new EventBatchHashError(`prepared event_count ${prepared.event_count} does not match ${events.length} EVENT records`)
  }
  assertEventIdentityAndSequence(prepared, events)
  const eventBytes = eventRecordBytes(events)
  const eventsHash = sha256Hex(eventBytes)
  if (prepared.events_hash !== eventsHash) throw new EventBatchHashError('prepared events_hash mismatch')
  const batchHash = calculateBatchHash(prepared.previous_batch_hash, eventsHash)
  if (prepared.batch_hash !== batchHash) throw new EventBatchHashError('prepared batch_hash mismatch')
  return {
    prepared,
    events,
    eventBytes,
    preparedBytes: Buffer.concat([eventBatchRecordBytes(prepared), eventBytes])
  }
}

export function createBatchCommittedRecord(input: Omit<BatchCommittedRecord, 'type'>): BatchCommittedRecord {
  return validateBatchCommittedRecord({ type: 'BATCH_COMMITTED', ...input })
}

export function validateCommittedForBatch(
  preparedValue: BatchPreparedRecord,
  committedValue: BatchCommittedRecord
): BatchCommittedRecord {
  const prepared = validateBatchPreparedRecord(preparedValue)
  const committed = validateBatchCommittedRecord(committedValue)
  if (committed.batch_id !== prepared.batch_id || committed.batch_sequence !== prepared.batch_sequence) {
    throw new EventBatchHashError('BATCH_COMMITTED does not identify its prepared batch')
  }
  return committed
}

export function canonicalPayloadBytes(payload: { [key: string]: CanonicalJsonValue }): Buffer {
  return canonicalJsonBytes(payload)
}
