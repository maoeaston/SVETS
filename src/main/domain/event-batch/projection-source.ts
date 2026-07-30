import type { DBAdapter } from '../../db/interface'
import type { DurableCommandRow } from '../../application/command/durable-command-store'
import {
  canonicalJson,
  type CanonicalJsonValue
} from './canonical-json'
import {
  validateCommittedForBatch,
  validatePreparedBatch
} from './batch-hash'
import type { EventBatchFaultInjector } from './fault-injection'
import { DurableFileCapability } from './file-capability'
import {
  buildSegmentIndex,
  loadSegmentSources,
  type SegmentFileSource
} from './segment-index'
import {
  parseEventBatchRecordLine,
  type BatchCommittedRecord,
  type BatchPreparedRecord,
  type EventRecord
} from './record-types'
import {
  segmentRelativePath
} from './segment-store'
import type { PreparedFactRegistry } from './result-registry'

export interface VerifiedEventSource {
  readonly record: EventRecord
  readonly relativePath: string
  readonly segmentId: string
  readonly lineNumber: number
  readonly byteOffset: number
  readonly byteEnd: number
}

export interface VerifiedCommittedSource {
  readonly record: BatchCommittedRecord
  readonly lineNumber: number
  readonly byteOffset: number
  readonly byteEnd: number
}

export interface PreparedBatchSource {
  readonly prepared: BatchPreparedRecord
  readonly events: readonly VerifiedEventSource[]
  readonly committed: VerifiedCommittedSource | null
  readonly relativePath: string
  readonly segmentId: string
  readonly preparedLineNumber: number
  readonly offsetStart: number
  readonly offsetEnd: number
}

export class ProjectionSourceError extends Error {
  constructor(
    public readonly code:
      | 'SOURCE_BYTES_INVALID'
      | 'SOURCE_PATH_INVALID'
      | 'BATCH_CONFLICT'
      | 'PROJECTION_CONFLICT'
      | 'CURSOR_CONFLICT'
      | 'AUTHORITY_REJECTED',
    message: string
  ) {
    super(`[event-batch-projection-source] ${message}`)
    this.name = 'ProjectionSourceError'
  }
}

interface SourceLine {
  readonly lineNumber: number
  readonly offsetStart: number
  readonly offsetEnd: number
  readonly bytes: Buffer
}

function splitLines(bytes: Uint8Array, segmentId: string): SourceLine[] {
  const source = Buffer.from(bytes)
  if (source.length > 0 && source.at(-1) !== 0x0a) {
    throw new ProjectionSourceError('SOURCE_BYTES_INVALID', `${segmentId} does not end with LF`)
  }
  const lines: SourceLine[] = []
  let offset = 0
  while (offset < source.length) {
    const lf = source.indexOf(0x0a, offset)
    if (lf < 0) throw new ProjectionSourceError('SOURCE_BYTES_INVALID', `${segmentId} contains an incomplete line`)
    lines.push(Object.freeze({
      lineNumber: lines.length + 1,
      offsetStart: offset,
      offsetEnd: lf + 1,
      bytes: source.subarray(offset, lf + 1)
    }))
    offset = lf + 1
  }
  return lines
}

function parseSegmentBatches(source: SegmentFileSource): PreparedBatchSource[] {
  const relativePath = segmentRelativePath(source.segmentId)
  const lines = splitLines(source.bytes, source.segmentId)
  const batches: PreparedBatchSource[] = []
  let cursor = 0
  while (cursor < lines.length) {
    const preparedLine = lines[cursor]
    const preparedRecord = parseEventBatchRecordLine(preparedLine.bytes)
    if (preparedRecord.type !== 'BATCH_PREPARED') {
      throw new ProjectionSourceError('SOURCE_BYTES_INVALID', `${source.segmentId} line ${preparedLine.lineNumber} is not BATCH_PREPARED`)
    }
    const prepared = preparedRecord
    cursor += 1
    const events: VerifiedEventSource[] = []
    for (let index = 0; index < prepared.event_count; index += 1) {
      const line = lines[cursor]
      if (!line) throw new ProjectionSourceError('SOURCE_BYTES_INVALID', `${prepared.batch_id} is missing EVENT records`)
      const record = parseEventBatchRecordLine(line.bytes)
      if (record.type !== 'EVENT') {
        throw new ProjectionSourceError('SOURCE_BYTES_INVALID', `${prepared.batch_id} contains a non-EVENT record`)
      }
      events.push(Object.freeze({
        record,
        relativePath,
        segmentId: source.segmentId,
        lineNumber: line.lineNumber,
        byteOffset: line.offsetStart,
        byteEnd: line.offsetEnd
      }))
      cursor += 1
    }
    validatePreparedBatch(prepared, events.map((event) => event.record))
    let committed: VerifiedCommittedSource | null = null
    const possibleCommitted = lines[cursor]
    if (possibleCommitted) {
      const record = parseEventBatchRecordLine(possibleCommitted.bytes)
      if (record.type === 'BATCH_COMMITTED') {
        validateCommittedForBatch(prepared, record)
        committed = Object.freeze({
          record,
          lineNumber: possibleCommitted.lineNumber,
          byteOffset: possibleCommitted.offsetStart,
          byteEnd: possibleCommitted.offsetEnd
        })
        cursor += 1
      }
    }
    batches.push(Object.freeze({
      prepared,
      events: Object.freeze(events),
      committed,
      relativePath,
      segmentId: source.segmentId,
      preparedLineNumber: preparedLine.lineNumber,
      offsetStart: preparedLine.offsetStart,
      offsetEnd: events.at(-1)!.byteEnd
    }))
  }
  return batches
}

export function readVerifiedProjectionSources(
  sources: readonly SegmentFileSource[]
): readonly PreparedBatchSource[] {
  buildSegmentIndex({ sources, legacyAnchor: null })
  const batches = sources.flatMap(parseSegmentBatches)
  return Object.freeze(batches)
}

export function loadVerifiedProjectionSources(
  capability: DurableFileCapability
): readonly PreparedBatchSource[] {
  return readVerifiedProjectionSources(loadSegmentSources(capability))
}

function objectRow(value: unknown, label: string): Record<string, unknown> | null {
  if (value === undefined) return null
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProjectionSourceError('PROJECTION_CONFLICT', `${label} query returned a non-object`)
  }
  return value as Record<string, unknown>
}

function exactStoredTimestamp(value: unknown, label: string): string {
  if (
    typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || new Date(value).toISOString() !== value
  ) throw new ProjectionSourceError('PROJECTION_CONFLICT', `${label} is not an exact UTC timestamp`)
  return value
}

function exactRowFields(
  row: Record<string, unknown>,
  expected: Readonly<Record<string, unknown>>,
  label: string
): void {
  for (const [key, value] of Object.entries(expected)) {
    if (row[key] !== value) {
      throw new ProjectionSourceError('PROJECTION_CONFLICT', `${label}.${key} conflicts with prepared source`)
    }
  }
}

function assertAppliedRow(
  database: DBAdapter,
  source: PreparedBatchSource
): Record<string, unknown> | null {
  const row = objectRow(database.prepare(
    'SELECT * FROM applied_event_batch WHERE batch_id = ?'
  ).get(source.prepared.batch_id), 'applied_event_batch')
  if (!row) return null
  exactRowFields(row, {
    batch_id: source.prepared.batch_id,
    batch_sequence: source.prepared.batch_sequence,
    segment_id: source.segmentId,
    command_id: source.prepared.command_id,
    event_count: source.prepared.event_count,
    previous_batch_hash: source.prepared.previous_batch_hash,
    events_hash: source.prepared.events_hash,
    batch_hash: source.prepared.batch_hash,
    prepared_lease_generation: source.prepared.prepared_lease_generation,
    worker_id: source.prepared.worker_id,
    jsonl_offset_start: source.offsetStart,
    jsonl_offset_end: source.offsetEnd
  }, `applied_event_batch ${source.prepared.batch_id}`)
  if (row.batch_status !== 'APPLIED' && row.batch_status !== 'CONFIRMED') {
    throw new ProjectionSourceError('BATCH_CONFLICT', `batch ${source.prepared.batch_id} has invalid status`)
  }
  exactStoredTimestamp(row.applied_at, `applied_event_batch ${source.prepared.batch_id}.applied_at`)
  if (row.batch_status === 'APPLIED' && row.confirmed_at !== null) {
    throw new ProjectionSourceError('BATCH_CONFLICT', `batch ${source.prepared.batch_id} is APPLIED with confirmed_at`)
  }
  if (row.batch_status === 'CONFIRMED') {
    exactStoredTimestamp(row.confirmed_at, `applied_event_batch ${source.prepared.batch_id}.confirmed_at`)
  }
  return row
}

function schemaVersion(event: VerifiedEventSource): number {
  const value = event.record.payload.event_payload_version
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new ProjectionSourceError('PROJECTION_CONFLICT', `EVENT ${event.record.event_id} payload version is invalid`)
  }
  return value as number
}

function sittingNumber(payload: Readonly<Record<string, CanonicalJsonValue>>): number | null {
  const value = payload.sitting_no
  if (value === undefined) return null
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new ProjectionSourceError('PROJECTION_CONFLICT', 'EVENT payload sitting_no is invalid')
  }
  return value as number
}

function assertExistingEventRows(
  database: DBAdapter,
  source: PreparedBatchSource,
  event: VerifiedEventSource
): boolean {
  const processed = objectRow(database.prepare(
    'SELECT * FROM processed_event WHERE event_id = ?'
  ).get(event.record.event_id), 'processed_event')
  const projection = objectRow(database.prepare(
    'SELECT * FROM domain_event_projection WHERE event_id = ?'
  ).get(event.record.event_id), 'domain_event_projection')
  if ((processed === null) !== (projection === null)) {
    throw new ProjectionSourceError('PROJECTION_CONFLICT', `EVENT ${event.record.event_id} exists in only one projection table`)
  }
  if (!processed || !projection) return false
  exactRowFields(processed, {
    event_id: event.record.event_id,
    batch_id: source.prepared.batch_id,
    event_type: event.record.event_type,
    aggregate_type: event.record.aggregate_type,
    aggregate_id: event.record.aggregate_id
  }, `processed_event ${event.record.event_id}`)
  exactStoredTimestamp(processed.processed_at, `processed_event ${event.record.event_id}.processed_at`)
  exactRowFields(projection, {
    event_id: event.record.event_id,
    aggregate_type: event.record.aggregate_type,
    aggregate_id: event.record.aggregate_id,
    event_type: event.record.event_type,
    event_sequence: event.record.event_sequence,
    payload_json: canonicalJson(event.record.payload),
    checksum: event.record.checksum,
    source_log_path: source.relativePath,
    source_log_line_no: event.lineNumber,
    source_log_byte_offset: event.byteOffset,
    schema_version: schemaVersion(event),
    sitting_no: sittingNumber(event.record.payload),
    created_at: event.record.timestamp
  }, `domain_event_projection ${event.record.event_id}`)
  return true
}

/** Must be called inside a transaction or an otherwise exclusive read phase. */
export function assertPreparedProjectionInCurrentTransaction(options: {
  database: DBAdapter
  command: DurableCommandRow
  source: PreparedBatchSource
  registry: PreparedFactRegistry
}): void {
  const batch = assertAppliedRow(options.database, options.source)
  if (!batch) throw new ProjectionSourceError('BATCH_CONFLICT', `batch ${options.source.prepared.batch_id} is not applied`)
  options.registry.validatePrepared(options.command, options.source)
  for (const event of options.source.events) {
    if (!assertExistingEventRows(options.database, options.source, event)) {
      throw new ProjectionSourceError('PROJECTION_CONFLICT', `applied batch is missing EVENT ${event.record.event_id}`)
    }
    options.registry.assertEventApplied({
      ...options.registry.projectorContext({
        database: options.database,
        command: options.command,
        batch: options.source,
        event
      })
    })
  }
}

/** Must be called inside the caller's single BEGIN IMMEDIATE APPLY transaction. */
export function writeProjectionSourceInCurrentTransaction(options: {
  database: DBAdapter
  source: PreparedBatchSource
  event: VerifiedEventSource
  processedAt: string
  allowExisting: boolean
}): 'INSERTED' | 'EXISTING' {
  if (options.event.relativePath !== segmentRelativePath(options.event.segmentId)) {
    throw new ProjectionSourceError('SOURCE_PATH_INVALID', 'EVENT source path is not canonical and relative')
  }
  const batch = assertAppliedRow(options.database, options.source)
  if (!batch || batch.segment_id !== options.event.segmentId) {
    throw new ProjectionSourceError('BATCH_CONFLICT', 'processed EVENT batch does not map to its source segment')
  }
  const existing = assertExistingEventRows(options.database, options.source, options.event)
  if (existing) {
    if (!options.allowExisting) {
      throw new ProjectionSourceError('PROJECTION_CONFLICT', `EVENT ${options.event.record.event_id} was already processed`)
    }
    return 'EXISTING'
  }
  const event = options.event.record
  options.database.prepare(
    `INSERT INTO processed_event (
       event_id, batch_id, event_type, aggregate_type, aggregate_id, processed_at
     ) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    event.event_id,
    options.source.prepared.batch_id,
    event.event_type,
    event.aggregate_type,
    event.aggregate_id,
    options.processedAt
  )
  options.database.prepare(
    `INSERT INTO domain_event_projection (
       event_id, aggregate_type, aggregate_id, event_type, event_sequence,
       payload_json, checksum, source_log_path, source_log_line_no,
       source_log_byte_offset, schema_version, sitting_no, created_at,
       applied_to_snapshot, applied_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)`
  ).run(
    event.event_id,
    event.aggregate_type,
    event.aggregate_id,
    event.event_type,
    event.event_sequence,
    canonicalJson(event.payload),
    event.checksum,
    options.source.relativePath,
    options.event.lineNumber,
    options.event.byteOffset,
    schemaVersion(options.event),
    sittingNumber(event.payload),
    event.timestamp
  )
  return 'INSERTED'
}

function insertAppliedBatch(options: {
  database: DBAdapter
  source: PreparedBatchSource
  appliedAt: string
}): void {
  const prepared = options.source.prepared
  options.database.prepare(
    `INSERT INTO applied_event_batch (
       batch_id, batch_sequence, segment_id, command_id,
       event_count,
       previous_batch_hash, events_hash, batch_hash,
       prepared_lease_generation, worker_id,
       jsonl_offset_start, jsonl_offset_end,
       batch_status, applied_at, confirmed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'APPLIED', ?, NULL)`
  ).run(
    prepared.batch_id,
    prepared.batch_sequence,
    prepared.segment_id,
    prepared.command_id,
    prepared.event_count,
    prepared.previous_batch_hash,
    prepared.events_hash,
    prepared.batch_hash,
    prepared.prepared_lease_generation,
    prepared.worker_id,
    options.source.offsetStart,
    options.source.offsetEnd,
    options.appliedAt
  )
}

function advanceCursor(
  database: DBAdapter,
  projectorName: string,
  source: PreparedBatchSource,
  updatedAt: string
): void {
  const existing = objectRow(database.prepare(
    'SELECT * FROM projector_cursor WHERE projector_name = ?'
  ).get(projectorName), 'projector_cursor')
  if (!existing) {
    if (source.prepared.batch_sequence !== 1) {
      throw new ProjectionSourceError('CURSOR_CONFLICT', `${projectorName} has no cursor before batch ${source.prepared.batch_sequence}`)
    }
    database.prepare(
      `INSERT INTO projector_cursor (
         projector_name, last_batch_id, last_batch_sequence, updated_at
       ) VALUES (?, ?, ?, ?)`
    ).run(projectorName, source.prepared.batch_id, source.prepared.batch_sequence, updatedAt)
    return
  }
  if (
    existing.last_batch_sequence !== source.prepared.batch_sequence - 1
    || typeof existing.last_batch_id !== 'string'
  ) {
    throw new ProjectionSourceError('CURSOR_CONFLICT', `${projectorName} cursor is not immediately before the batch`)
  }
  database.prepare(
    `UPDATE projector_cursor
        SET last_batch_id = ?, last_batch_sequence = ?, updated_at = ?
      WHERE projector_name = ? AND last_batch_id = ? AND last_batch_sequence = ?`
  ).run(
    source.prepared.batch_id,
    source.prepared.batch_sequence,
    updatedAt,
    projectorName,
    existing.last_batch_id,
    existing.last_batch_sequence
  )
  const updated = objectRow(database.prepare(
    'SELECT * FROM projector_cursor WHERE projector_name = ?'
  ).get(projectorName), 'projector_cursor')
  if (
    !updated
    || updated.last_batch_id !== source.prepared.batch_id
    || updated.last_batch_sequence !== source.prepared.batch_sequence
  ) throw new ProjectionSourceError('CURSOR_CONFLICT', `${projectorName} cursor update was fenced`)
}

export function applyPreparedBatch(options: {
  database: DBAdapter
  command: DurableCommandRow
  source: PreparedBatchSource
  registry: PreparedFactRegistry
  appliedAt: string
  assertAuthorityInTransaction(): void
  faultInjector?: EventBatchFaultInjector
  allowExisting?: boolean
}): Readonly<{ status: 'APPLIED' | 'ALREADY_APPLIED'; eventCount: number }> {
  options.registry.validatePrepared(options.command, options.source)
  return options.database.immediateTransaction(() => {
    try {
      options.assertAuthorityInTransaction()
    } catch (error) {
      throw new ProjectionSourceError('AUTHORITY_REJECTED', error instanceof Error ? error.message : String(error))
    }
    const existingBatch = assertAppliedRow(options.database, options.source)
    if (existingBatch) {
      if (!options.allowExisting) {
        throw new ProjectionSourceError('BATCH_CONFLICT', `batch ${options.source.prepared.batch_id} is already applied`)
      }
      assertPreparedProjectionInCurrentTransaction({
        database: options.database,
        command: options.command,
        source: options.source,
        registry: options.registry
      })
      return Object.freeze({ status: 'ALREADY_APPLIED' as const, eventCount: options.source.events.length })
    }

    insertAppliedBatch({ database: options.database, source: options.source, appliedAt: options.appliedAt })
    for (const [eventIndex, event] of options.source.events.entries()) {
      options.faultInjector?.hit('APPLY_EVENT', {
        commandId: options.command.commandId,
        batchId: options.source.prepared.batch_id,
        eventIndex
      })
      writeProjectionSourceInCurrentTransaction({
        database: options.database,
        source: options.source,
        event,
        processedAt: options.appliedAt,
        allowExisting: false
      })
      const projectorContext = options.registry.projectorContext({
        database: options.database,
        command: options.command,
        batch: options.source,
        event
      })
      options.registry.applyEvent(projectorContext)
      options.registry.assertEventApplied(projectorContext)
    }
    for (const projectorName of options.registry.projectorNames()) {
      advanceCursor(options.database, projectorName, options.source, options.appliedAt)
    }
    return Object.freeze({ status: 'APPLIED' as const, eventCount: options.source.events.length })
  })()
}
