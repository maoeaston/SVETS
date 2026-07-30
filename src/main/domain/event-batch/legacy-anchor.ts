import { isAbsolute, posix } from 'path'
import type { LegacyLogInspection } from './legacy-reader'

export const LEGACY_ANCHOR_SCHEMA_VERSION = 'legacy-anchor-v1'

export interface LegacyAnchorV1 {
  schema_version: typeof LEGACY_ANCHOR_SCHEMA_VERSION
  relative_path: string
  byte_length: number
  sha256: string
  record_count: number
  last_event_id: string | null
  last_event_timestamp: string | null
  line_termination: 'EMPTY' | 'LF' | 'COMPLETE_EOF'
  sealed_at: string
}

export class LegacyAnchorError extends Error {
  constructor(message: string) {
    super(`[event-batch-legacy-anchor] ${message}`)
    this.name = 'LegacyAnchorError'
  }
}

const KEYS = Object.freeze([
  'byte_length',
  'last_event_id',
  'last_event_timestamp',
  'line_termination',
  'record_count',
  'relative_path',
  'schema_version',
  'sealed_at',
  'sha256'
])

function timestamp(value: unknown, label: string): string {
  if (
    typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || new Date(value).toISOString() !== value
  ) throw new LegacyAnchorError(`${label} must be an exact UTC timestamp`)
  return value
}

function nullableTimestamp(value: unknown, label: string): string | null {
  return value === null ? null : timestamp(value, label)
}

function nullableText(value: unknown, label: string): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || !value.length) throw new LegacyAnchorError(`${label} must be non-empty or null`)
  return value
}

export function validateLegacyAnchor(value: unknown): LegacyAnchorV1 {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new LegacyAnchorError('anchor must be an object')
  }
  const input = value as Record<string, unknown>
  const keys = Object.keys(input).sort()
  if (keys.length !== KEYS.length || keys.some((key, index) => key !== KEYS[index])) {
    throw new LegacyAnchorError('anchor field set mismatch')
  }
  if (input.schema_version !== LEGACY_ANCHOR_SCHEMA_VERSION) throw new LegacyAnchorError('schema_version mismatch')
  if (
    typeof input.relative_path !== 'string'
    || !input.relative_path
    || isAbsolute(input.relative_path)
    || /^[a-z]:/i.test(input.relative_path)
    || input.relative_path.includes('\\')
    || input.relative_path.includes('\u0000')
    || posix.normalize(input.relative_path) !== input.relative_path
    || input.relative_path === '.'
  ) throw new LegacyAnchorError('relative_path is invalid')
  if (!Number.isSafeInteger(input.byte_length) || (input.byte_length as number) < 0) {
    throw new LegacyAnchorError('byte_length is invalid')
  }
  if (!Number.isSafeInteger(input.record_count) || (input.record_count as number) < 0) {
    throw new LegacyAnchorError('record_count is invalid')
  }
  if (typeof input.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(input.sha256)) {
    throw new LegacyAnchorError('sha256 is invalid')
  }
  if (!['EMPTY', 'LF', 'COMPLETE_EOF'].includes(String(input.line_termination))) {
    throw new LegacyAnchorError('line_termination is invalid')
  }
  const lastEventId = nullableText(input.last_event_id, 'last_event_id')
  const lastEventTimestamp = nullableTimestamp(input.last_event_timestamp, 'last_event_timestamp')
  if (
    ((input.record_count as number) === 0 && (lastEventId !== null || lastEventTimestamp !== null))
    || ((input.record_count as number) > 0 && (lastEventId === null || lastEventTimestamp === null))
  ) {
    throw new LegacyAnchorError('last event fields do not match record_count')
  }
  return {
    schema_version: LEGACY_ANCHOR_SCHEMA_VERSION,
    relative_path: input.relative_path,
    byte_length: input.byte_length as number,
    sha256: input.sha256,
    record_count: input.record_count as number,
    last_event_id: lastEventId,
    last_event_timestamp: lastEventTimestamp,
    line_termination: input.line_termination as LegacyAnchorV1['line_termination'],
    sealed_at: timestamp(input.sealed_at, 'sealed_at')
  }
}

export function createLegacyAnchor(options: {
  inspection: LegacyLogInspection
  relativePath?: string
  sealedAt: string
}): LegacyAnchorV1 {
  const { inspection } = options
  if (inspection.state === 'RECOVERABLE_INCOMPLETE_TAIL') {
    throw new LegacyAnchorError('cannot seal a log with an incomplete tail')
  }
  const lineTermination = inspection.state === 'EMPTY'
    ? 'EMPTY'
    : inspection.state === 'VALID_LF_TERMINATED'
      ? 'LF'
      : 'COMPLETE_EOF'
  return validateLegacyAnchor({
    schema_version: LEGACY_ANCHOR_SCHEMA_VERSION,
    relative_path: options.relativePath ?? 'action_log.jsonl',
    byte_length: inspection.originalByteLength,
    sha256: inspection.originalSha256,
    record_count: inspection.events.length,
    last_event_id: inspection.lastEventId,
    last_event_timestamp: inspection.lastEventTimestamp,
    line_termination: lineTermination,
    sealed_at: options.sealedAt
  })
}
