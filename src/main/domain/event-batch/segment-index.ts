import {
  canonicalJson,
  canonicalJsonBytes,
  parseCanonicalJsonLine,
  sha256Hex
} from './canonical-json'
import {
  GENESIS_BATCH_HASH,
  validateCommittedForBatch,
  validatePreparedBatch
} from './batch-hash'
import {
  parseEventBatchRecordLine,
  type BatchPreparedRecord,
  type EventRecord
} from './record-types'
import {
  DurableFileCapability,
  type FileIdentity,
  type StableFileSnapshot
} from './file-capability'
import { validateLegacyAnchor, type LegacyAnchorV1 } from './legacy-anchor'
import {
  SEGMENT_DIRECTORY,
  segmentIdForOrdinal,
  segmentOrdinalFromId,
  segmentRelativePath
} from './segment-store'

export const SEGMENT_INDEX_SCHEMA_VERSION = 'segment-index-v1'
export const SEGMENT_INDEX_PATH = 'segment_index.json'

export type SegmentIndexState = 'ACTIVE' | 'SEALED'

export interface SegmentIndexEntryV1 {
  segment_id: string
  file_path: string
  state: SegmentIndexState
  first_batch_sequence: number | null
  last_batch_sequence: number | null
  first_batch_hash: string | null
  last_batch_hash: string | null
  first_events_hash: string | null
  last_events_hash: string | null
  previous_segment_hash: string
  segment_file_hash: string
  byte_size: number
  batch_count: number
  confirmed_batch_count: number
  has_uncommitted_tail: boolean
}

export interface SegmentIndexV1 {
  schema_version: typeof SEGMENT_INDEX_SCHEMA_VERSION
  legacy_anchor: LegacyAnchorV1 | null
  active_segment_id: string | null
  last_global_batch_sequence: number
  last_confirmed_batch_sequence: number
  last_batch_hash: string
  segments: SegmentIndexEntryV1[]
}

export interface SegmentFileSource {
  segmentId: string
  bytes: Uint8Array
}

export type SegmentIndexReconcileStatus = 'CURRENT' | 'REBUILT_MISSING' | 'REBUILT_LAGGING'

export interface SegmentIndexReconcileResult {
  status: SegmentIndexReconcileStatus
  index: SegmentIndexV1
}

export class SegmentIndexError extends Error {
  constructor(
    public readonly code:
      | 'INDEX_SCHEMA_INVALID'
      | 'SEGMENT_BYTES_INVALID'
      | 'INDEX_CONFLICT'
      | 'INDEX_WRITE_CONFLICT',
    message: string,
    public readonly segmentId: string | null = null
  ) {
    super(`[event-batch-index] ${message}`)
    this.name = 'SegmentIndexError'
  }
}

const INDEX_KEYS = Object.freeze([
  'active_segment_id',
  'last_batch_hash',
  'last_confirmed_batch_sequence',
  'last_global_batch_sequence',
  'legacy_anchor',
  'schema_version',
  'segments'
])

const SEGMENT_KEYS = Object.freeze([
  'batch_count',
  'byte_size',
  'confirmed_batch_count',
  'file_path',
  'first_batch_hash',
  'first_batch_sequence',
  'first_events_hash',
  'has_uncommitted_tail',
  'last_batch_hash',
  'last_batch_sequence',
  'last_events_hash',
  'previous_segment_hash',
  'segment_file_hash',
  'segment_id',
  'state'
])

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SegmentIndexError('INDEX_SCHEMA_INVALID', `${label} must be an object`)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new SegmentIndexError('INDEX_SCHEMA_INVALID', `${label} must be a plain object`)
  }
  return value as Record<string, unknown>
}

function exactKeys(input: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(input).sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new SegmentIndexError('INDEX_SCHEMA_INVALID', `${label} field set mismatch`)
  }
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new SegmentIndexError('INDEX_SCHEMA_INVALID', `${label} must be a non-negative safe integer`)
  }
  return value as number
}

function nullablePositiveInteger(value: unknown, label: string): number | null {
  if (value === null) return null
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new SegmentIndexError('INDEX_SCHEMA_INVALID', `${label} must be a positive safe integer or null`)
  }
  return value as number
}

function hash(value: unknown, label: string, allowGenesis = false): string {
  if (allowGenesis && value === GENESIS_BATCH_HASH) return value
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new SegmentIndexError('INDEX_SCHEMA_INVALID', `${label} must be a lowercase SHA-256 digest`)
  }
  return value
}

function nullableHash(value: unknown, label: string): string | null {
  return value === null ? null : hash(value, label)
}

function parseSegmentEntry(value: unknown, index: number): SegmentIndexEntryV1 {
  const input = object(value, `segments[${index}]`)
  exactKeys(input, SEGMENT_KEYS, `segments[${index}]`)
  if (typeof input.segment_id !== 'string') {
    throw new SegmentIndexError('INDEX_SCHEMA_INVALID', `segments[${index}].segment_id is invalid`)
  }
  segmentOrdinalFromId(input.segment_id)
  if (input.file_path !== segmentRelativePath(input.segment_id)) {
    throw new SegmentIndexError('INDEX_SCHEMA_INVALID', `segments[${index}].file_path does not match segment_id`)
  }
  if (input.state !== 'ACTIVE' && input.state !== 'SEALED') {
    throw new SegmentIndexError('INDEX_SCHEMA_INVALID', `segments[${index}].state is invalid`)
  }
  if (typeof input.has_uncommitted_tail !== 'boolean') {
    throw new SegmentIndexError('INDEX_SCHEMA_INVALID', `segments[${index}].has_uncommitted_tail is invalid`)
  }
  const parsed: SegmentIndexEntryV1 = {
    segment_id: input.segment_id,
    file_path: input.file_path,
    state: input.state,
    first_batch_sequence: nullablePositiveInteger(input.first_batch_sequence, `segments[${index}].first_batch_sequence`),
    last_batch_sequence: nullablePositiveInteger(input.last_batch_sequence, `segments[${index}].last_batch_sequence`),
    first_batch_hash: nullableHash(input.first_batch_hash, `segments[${index}].first_batch_hash`),
    last_batch_hash: nullableHash(input.last_batch_hash, `segments[${index}].last_batch_hash`),
    first_events_hash: nullableHash(input.first_events_hash, `segments[${index}].first_events_hash`),
    last_events_hash: nullableHash(input.last_events_hash, `segments[${index}].last_events_hash`),
    previous_segment_hash: hash(input.previous_segment_hash, `segments[${index}].previous_segment_hash`, true),
    segment_file_hash: hash(input.segment_file_hash, `segments[${index}].segment_file_hash`),
    byte_size: nonNegativeInteger(input.byte_size, `segments[${index}].byte_size`),
    batch_count: nonNegativeInteger(input.batch_count, `segments[${index}].batch_count`),
    confirmed_batch_count: nonNegativeInteger(input.confirmed_batch_count, `segments[${index}].confirmed_batch_count`),
    has_uncommitted_tail: input.has_uncommitted_tail
  }
  const boundaryValues = [
    parsed.first_batch_sequence,
    parsed.last_batch_sequence,
    parsed.first_batch_hash,
    parsed.last_batch_hash,
    parsed.first_events_hash,
    parsed.last_events_hash
  ]
  if (parsed.batch_count === 0) {
    if (boundaryValues.some((entry) => entry !== null) || parsed.confirmed_batch_count !== 0 || parsed.has_uncommitted_tail) {
      throw new SegmentIndexError('INDEX_SCHEMA_INVALID', `segments[${index}] empty metadata is inconsistent`)
    }
  } else {
    if (boundaryValues.some((entry) => entry === null)) {
      throw new SegmentIndexError('INDEX_SCHEMA_INVALID', `segments[${index}] batch boundaries are incomplete`)
    }
    if (parsed.last_batch_sequence! - parsed.first_batch_sequence! + 1 !== parsed.batch_count) {
      throw new SegmentIndexError('INDEX_SCHEMA_INVALID', `segments[${index}] sequence range does not match batch_count`)
    }
    const expectedConfirmed = parsed.batch_count - (parsed.has_uncommitted_tail ? 1 : 0)
    if (parsed.confirmed_batch_count !== expectedConfirmed) {
      throw new SegmentIndexError('INDEX_SCHEMA_INVALID', `segments[${index}] confirmed count is inconsistent`)
    }
  }
  if (parsed.state === 'SEALED' && parsed.has_uncommitted_tail) {
    throw new SegmentIndexError('INDEX_SCHEMA_INVALID', `segments[${index}] sealed segment has an uncommitted tail`)
  }
  return parsed
}

export function validateSegmentIndex(value: unknown): SegmentIndexV1 {
  const input = object(value, 'segment index')
  exactKeys(input, INDEX_KEYS, 'segment index')
  if (input.schema_version !== SEGMENT_INDEX_SCHEMA_VERSION) {
    throw new SegmentIndexError('INDEX_SCHEMA_INVALID', 'schema_version mismatch')
  }
  if (!Array.isArray(input.segments)) {
    throw new SegmentIndexError('INDEX_SCHEMA_INVALID', 'segments must be an array')
  }
  const legacyAnchor = input.legacy_anchor === null ? null : validateLegacyAnchor(input.legacy_anchor)
  const segments = input.segments.map((entry, index) => parseSegmentEntry(entry, index))
  const activeSegmentId = input.active_segment_id
  if (activeSegmentId !== null && typeof activeSegmentId !== 'string') {
    throw new SegmentIndexError('INDEX_SCHEMA_INVALID', 'active_segment_id must be a segment ID or null')
  }
  const lastGlobalBatchSequence = nonNegativeInteger(input.last_global_batch_sequence, 'last_global_batch_sequence')
  const lastConfirmedBatchSequence = nonNegativeInteger(input.last_confirmed_batch_sequence, 'last_confirmed_batch_sequence')
  const lastBatchHash = hash(input.last_batch_hash, 'last_batch_hash', true)

  let expectedSequence = 1
  let expectedPreviousHash = GENESIS_BATCH_HASH
  for (const [index, segment] of segments.entries()) {
    if (segment.segment_id !== segmentIdForOrdinal(index + 1)) {
      throw new SegmentIndexError('INDEX_SCHEMA_INVALID', 'segment IDs must be contiguous from ordinal 1')
    }
    const expectedState: SegmentIndexState = index === segments.length - 1 ? 'ACTIVE' : 'SEALED'
    if (segment.state !== expectedState) {
      throw new SegmentIndexError('INDEX_SCHEMA_INVALID', `${segment.segment_id} must be ${expectedState}`)
    }
    if (segment.previous_segment_hash !== expectedPreviousHash) {
      throw new SegmentIndexError('INDEX_SCHEMA_INVALID', `${segment.segment_id} previous segment hash is discontinuous`)
    }
    if (segment.batch_count === 0) {
      if (index !== segments.length - 1) {
        throw new SegmentIndexError('INDEX_SCHEMA_INVALID', 'only the active final segment may be empty')
      }
      continue
    }
    if (segment.first_batch_sequence !== expectedSequence) {
      throw new SegmentIndexError('INDEX_SCHEMA_INVALID', `${segment.segment_id} sequence range is discontinuous`)
    }
    expectedSequence = segment.last_batch_sequence! + 1
    expectedPreviousHash = segment.last_batch_hash!
  }

  const expectedActive = segments.length === 0 ? null : segments.at(-1)!.segment_id
  if (activeSegmentId !== expectedActive) {
    throw new SegmentIndexError('INDEX_SCHEMA_INVALID', 'active_segment_id does not identify the final active segment')
  }
  const expectedLastSequence = expectedSequence - 1
  if (lastGlobalBatchSequence !== expectedLastSequence || lastBatchHash !== expectedPreviousHash) {
    throw new SegmentIndexError('INDEX_SCHEMA_INVALID', 'global sequence/hash head does not match segment boundaries')
  }
  const hasPending = segments.at(-1)?.has_uncommitted_tail ?? false
  const expectedConfirmedSequence = expectedLastSequence - (hasPending ? 1 : 0)
  if (lastConfirmedBatchSequence !== expectedConfirmedSequence) {
    throw new SegmentIndexError('INDEX_SCHEMA_INVALID', 'last_confirmed_batch_sequence is inconsistent')
  }

  return {
    schema_version: SEGMENT_INDEX_SCHEMA_VERSION,
    legacy_anchor: legacyAnchor,
    active_segment_id: activeSegmentId,
    last_global_batch_sequence: lastGlobalBatchSequence,
    last_confirmed_batch_sequence: lastConfirmedBatchSequence,
    last_batch_hash: lastBatchHash,
    segments
  }
}

function splitCanonicalLines(bytes: Buffer, segmentId: string): Buffer[] {
  if (bytes.length === 0) return []
  if (bytes.at(-1) !== 0x0a) {
    throw new SegmentIndexError('SEGMENT_BYTES_INVALID', 'segment does not end with LF', segmentId)
  }
  const lines: Buffer[] = []
  let offset = 0
  while (offset < bytes.length) {
    const lf = bytes.indexOf(0x0a, offset)
    if (lf < 0) throw new SegmentIndexError('SEGMENT_BYTES_INVALID', 'segment has an incomplete record', segmentId)
    lines.push(bytes.subarray(offset, lf + 1))
    offset = lf + 1
  }
  return lines
}

export function buildSegmentIndex(options: {
  sources: readonly SegmentFileSource[]
  legacyAnchor: LegacyAnchorV1 | null
}): SegmentIndexV1 {
  const legacyAnchor = options.legacyAnchor === null ? null : validateLegacyAnchor(options.legacyAnchor)
  const segments: SegmentIndexEntryV1[] = []
  const batchIds = new Set<string>()
  const eventIds = new Set<string>()
  const lastSequenceByAggregate = new Map<string, number>()
  let nextBatchSequence = 1
  let previousBatchHash = GENESIS_BATCH_HASH
  let lastConfirmedBatchSequence = 0

  for (const [sourceIndex, source] of options.sources.entries()) {
    const expectedSegmentId = segmentIdForOrdinal(sourceIndex + 1)
    if (source.segmentId !== expectedSegmentId) {
      throw new SegmentIndexError('SEGMENT_BYTES_INVALID', `expected ${expectedSegmentId}, got ${source.segmentId}`, source.segmentId)
    }
    const bytes = Buffer.from(source.bytes)
    const lines = splitCanonicalLines(bytes, source.segmentId)
    const segmentChainStart = previousBatchHash
    let cursor = 0
    let firstBatchSequence: number | null = null
    let lastBatchSequence: number | null = null
    let firstBatchHash: string | null = null
    let lastBatchHash: string | null = null
    let firstEventsHash: string | null = null
    let lastEventsHash: string | null = null
    let batchCount = 0
    let confirmedBatchCount = 0
    let hasUncommittedTail = false

    while (cursor < lines.length) {
      const record = parseEventBatchRecordLine(lines[cursor])
      if (record.type !== 'BATCH_PREPARED') {
        throw new SegmentIndexError('SEGMENT_BYTES_INVALID', `record ${cursor + 1} is not BATCH_PREPARED`, source.segmentId)
      }
      const prepared: BatchPreparedRecord = record
      if (prepared.segment_id !== source.segmentId) {
        throw new SegmentIndexError('SEGMENT_BYTES_INVALID', 'prepared segment_id does not match its file', source.segmentId)
      }
      if (prepared.batch_sequence !== nextBatchSequence) {
        throw new SegmentIndexError('SEGMENT_BYTES_INVALID', `expected batch sequence ${nextBatchSequence}`, source.segmentId)
      }
      if (prepared.previous_batch_hash !== previousBatchHash) {
        throw new SegmentIndexError('SEGMENT_BYTES_INVALID', 'batch hash chain is discontinuous', source.segmentId)
      }
      if (batchIds.has(prepared.batch_id)) {
        throw new SegmentIndexError('SEGMENT_BYTES_INVALID', `duplicate batch ID ${prepared.batch_id}`, source.segmentId)
      }
      batchIds.add(prepared.batch_id)
      cursor += 1

      const events: EventRecord[] = []
      for (let eventIndex = 0; eventIndex < prepared.event_count; eventIndex += 1) {
        if (cursor >= lines.length) {
          throw new SegmentIndexError('SEGMENT_BYTES_INVALID', 'prepared batch is missing EVENT records', source.segmentId)
        }
        const event = parseEventBatchRecordLine(lines[cursor])
        if (event.type !== 'EVENT') {
          throw new SegmentIndexError('SEGMENT_BYTES_INVALID', 'prepared batch contains a non-EVENT record', source.segmentId)
        }
        events.push(event)
        cursor += 1
      }
      validatePreparedBatch(prepared, events)
      for (const event of events) {
        if (eventIds.has(event.event_id)) {
          throw new SegmentIndexError('SEGMENT_BYTES_INVALID', `duplicate event ID ${event.event_id}`, source.segmentId)
        }
        eventIds.add(event.event_id)
        const aggregateKey = `${event.aggregate_type}\u0000${event.aggregate_id}`
        const previousSequence = lastSequenceByAggregate.get(aggregateKey)
        if (previousSequence !== undefined && event.event_sequence !== previousSequence + 1) {
          throw new SegmentIndexError('SEGMENT_BYTES_INVALID', `aggregate sequence conflict for ${event.aggregate_type}:${event.aggregate_id}`, source.segmentId)
        }
        lastSequenceByAggregate.set(aggregateKey, event.event_sequence)
      }

      batchCount += 1
      firstBatchSequence ??= prepared.batch_sequence
      firstBatchHash ??= prepared.batch_hash
      firstEventsHash ??= prepared.events_hash
      lastBatchSequence = prepared.batch_sequence
      lastBatchHash = prepared.batch_hash
      lastEventsHash = prepared.events_hash
      nextBatchSequence += 1
      previousBatchHash = prepared.batch_hash

      if (cursor < lines.length) {
        const committed = parseEventBatchRecordLine(lines[cursor])
        if (committed.type !== 'BATCH_COMMITTED') {
          throw new SegmentIndexError('SEGMENT_BYTES_INVALID', 'batch is followed by neither matching COMMITTED nor EOF', source.segmentId)
        }
        validateCommittedForBatch(prepared, committed)
        cursor += 1
        confirmedBatchCount += 1
        lastConfirmedBatchSequence = prepared.batch_sequence
      } else {
        hasUncommittedTail = true
        if (sourceIndex !== options.sources.length - 1) {
          throw new SegmentIndexError('SEGMENT_BYTES_INVALID', 'a sealed segment has an uncommitted batch', source.segmentId)
        }
      }
    }

    if (lines.length === 0 && sourceIndex !== options.sources.length - 1) {
      throw new SegmentIndexError('SEGMENT_BYTES_INVALID', 'only the active final segment may be empty', source.segmentId)
    }
    const state: SegmentIndexState = sourceIndex === options.sources.length - 1 ? 'ACTIVE' : 'SEALED'
    segments.push({
      segment_id: source.segmentId,
      file_path: segmentRelativePath(source.segmentId),
      state,
      first_batch_sequence: firstBatchSequence,
      last_batch_sequence: lastBatchSequence,
      first_batch_hash: firstBatchHash,
      last_batch_hash: lastBatchHash,
      first_events_hash: firstEventsHash,
      last_events_hash: lastEventsHash,
      previous_segment_hash: segmentChainStart,
      segment_file_hash: sha256Hex(bytes),
      byte_size: bytes.length,
      batch_count: batchCount,
      confirmed_batch_count: confirmedBatchCount,
      has_uncommitted_tail: hasUncommittedTail
    })
  }

  return validateSegmentIndex({
    schema_version: SEGMENT_INDEX_SCHEMA_VERSION,
    legacy_anchor: legacyAnchor,
    active_segment_id: segments.at(-1)?.segment_id ?? null,
    last_global_batch_sequence: nextBatchSequence - 1,
    last_confirmed_batch_sequence: lastConfirmedBatchSequence,
    last_batch_hash: previousBatchHash,
    segments
  })
}

export function segmentIndexBytes(index: SegmentIndexV1): Buffer {
  return canonicalJsonBytes(validateSegmentIndex(index), true)
}

export function segmentIndexSha256(index: SegmentIndexV1): string {
  return sha256Hex(segmentIndexBytes(index))
}

export function parseSegmentIndexBytes(bytes: Uint8Array): SegmentIndexV1 {
  return validateSegmentIndex(parseCanonicalJsonLine(bytes))
}

export function loadSegmentSources(capability: DurableFileCapability): SegmentFileSource[] {
  return capability.listRegularFiles(SEGMENT_DIRECTORY).map((relativePath) => {
    const expectedPrefix = `${SEGMENT_DIRECTORY}/`
    if (!relativePath.startsWith(expectedPrefix) || !relativePath.endsWith('.jsonl')) {
      throw new SegmentIndexError('SEGMENT_BYTES_INVALID', `unexpected object in segment directory: ${relativePath}`)
    }
    const segmentId = relativePath.slice(expectedPrefix.length, -'.jsonl'.length)
    segmentOrdinalFromId(segmentId)
    if (relativePath !== segmentRelativePath(segmentId)) {
      throw new SegmentIndexError('SEGMENT_BYTES_INVALID', `non-canonical segment path ${relativePath}`, segmentId)
    }
    const snapshot = capability.readStable(relativePath)
    if (!snapshot) throw new SegmentIndexError('SEGMENT_BYTES_INVALID', `segment disappeared while rebuilding: ${relativePath}`, segmentId)
    return { segmentId, bytes: snapshot.bytes }
  })
}

export function rebuildSegmentIndexFromDisk(
  capability: DurableFileCapability,
  legacyAnchor: LegacyAnchorV1 | null
): SegmentIndexV1 {
  return buildSegmentIndex({ sources: loadSegmentSources(capability), legacyAnchor })
}

function sameIndex(left: SegmentIndexV1, right: SegmentIndexV1): boolean {
  return canonicalJson(left) === canonicalJson(right)
}

function conflict(message: string): never {
  throw new SegmentIndexError('INDEX_CONFLICT', message)
}

export function reconcileSegmentIndex(options: {
  existing: unknown | null
  sources: readonly SegmentFileSource[]
  legacyAnchor: LegacyAnchorV1 | null
}): SegmentIndexReconcileResult {
  const rebuilt = buildSegmentIndex({ sources: options.sources, legacyAnchor: options.legacyAnchor })
  if (options.existing === null) return { status: 'REBUILT_MISSING', index: rebuilt }
  const existing = validateSegmentIndex(options.existing)
  if (sameIndex(existing, rebuilt)) return { status: 'CURRENT', index: rebuilt }
  if (canonicalJson(existing.legacy_anchor) !== canonicalJson(rebuilt.legacy_anchor)) {
    return conflict('legacy anchor conflicts with verified legacy bytes')
  }
  if (existing.segments.length > options.sources.length) {
    return conflict('index names segment files that are missing from disk')
  }

  const prefixSources: SegmentFileSource[] = []
  for (const [index, existingSegment] of existing.segments.entries()) {
    const source = options.sources[index]
    if (!source || source.segmentId !== existingSegment.segment_id) {
      return conflict('index segment order conflicts with disk')
    }
    const bytes = Buffer.from(source.bytes)
    if (bytes.length < existingSegment.byte_size) {
      return conflict(`${source.segmentId} is shorter than the indexed boundary`)
    }
    if (existingSegment.state === 'SEALED' && bytes.length !== existingSegment.byte_size) {
      return conflict(`${source.segmentId} changed after it was sealed`)
    }
    const prefix = bytes.subarray(0, existingSegment.byte_size)
    if (sha256Hex(prefix) !== existingSegment.segment_file_hash) {
      return conflict(`${source.segmentId} indexed prefix hash conflicts with disk`)
    }
    prefixSources.push({ segmentId: source.segmentId, bytes: prefix })
  }
  const rebuiltPrefix = buildSegmentIndex({ sources: prefixSources, legacyAnchor: options.legacyAnchor })
  if (!sameIndex(existing, rebuiltPrefix)) {
    return conflict('index metadata is not the exact verified disk prefix')
  }
  return { status: 'REBUILT_LAGGING', index: rebuilt }
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.device === right.device && left.inode === right.inode
}

export function readSegmentIndexFile(capability: DurableFileCapability): {
  index: SegmentIndexV1
  snapshot: StableFileSnapshot
} | null {
  const snapshot = capability.readStable(SEGMENT_INDEX_PATH)
  if (!snapshot) return null
  return { index: parseSegmentIndexBytes(snapshot.bytes), snapshot }
}

export function writeSegmentIndexAtomic(options: {
  capability: DurableFileCapability
  index: SegmentIndexV1
  expectedSha256: string | null
  operationId: string
}): StableFileSnapshot {
  if (!/^[a-z0-9-]{1,64}$/.test(options.operationId)) {
    throw new SegmentIndexError('INDEX_WRITE_CONFLICT', 'operationId must be a lowercase owned token')
  }
  if (options.expectedSha256 !== null && !/^[0-9a-f]{64}$/.test(options.expectedSha256)) {
    throw new SegmentIndexError('INDEX_WRITE_CONFLICT', 'expectedSha256 is invalid')
  }
  const bytes = segmentIndexBytes(options.index)
  const expectedNewHash = sha256Hex(bytes)
  const initial = options.capability.readStable(SEGMENT_INDEX_PATH)
  if (
    (options.expectedSha256 === null && initial !== null)
    || (options.expectedSha256 !== null && initial?.sha256 !== options.expectedSha256)
  ) {
    throw new SegmentIndexError('INDEX_WRITE_CONFLICT', 'segment index changed before update')
  }
  if (initial) parseSegmentIndexBytes(initial.bytes)

  const tempPath = `.segment-index-${options.operationId}.tmp`
  const handle = options.capability.createExclusive(tempPath, bytes)
  options.capability.close(handle)

  const beforePublish = options.capability.readStable(SEGMENT_INDEX_PATH)
  if (
    (initial === null && beforePublish !== null)
    || (initial !== null && (
      beforePublish === null
      || beforePublish.sha256 !== initial.sha256
      || !sameIdentity(beforePublish.identity, initial.identity)
    ))
  ) {
    throw new SegmentIndexError('INDEX_WRITE_CONFLICT', 'segment index changed during update')
  }
  if (initial === null) {
    options.capability.publishNoClobber(tempPath, SEGMENT_INDEX_PATH)
  } else {
    options.capability.atomicReplace(tempPath, SEGMENT_INDEX_PATH, initial.identity)
  }
  const published = options.capability.readStable(SEGMENT_INDEX_PATH)
  if (!published || published.sha256 !== expectedNewHash) {
    throw new SegmentIndexError('INDEX_WRITE_CONFLICT', 'published segment index bytes do not match the requested index')
  }
  parseSegmentIndexBytes(published.bytes)
  return published
}
