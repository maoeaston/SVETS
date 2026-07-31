import { createHash } from 'crypto'
import { TextDecoder } from 'util'
import type { ActionLogEntry } from '@shared/types/event-payloads'
import { sha256Hex } from './canonical-json'
import { DurableFileCapability, type FileDurabilityHooks } from './file-capability'

export type LegacyLogState =
  | 'EMPTY'
  | 'VALID_LF_TERMINATED'
  | 'VALID_COMPLETE_EOF'
  | 'RECOVERABLE_INCOMPLETE_TAIL'

export type LegacyEventGroupKind = 'SINGLE' | 'F7_FACTUAL_CORRECTION'

export interface LegacyEventLine {
  lineNumber: number
  offsetStart: number
  offsetEnd: number
  terminatedByLf: boolean
  event: ActionLogEntry
}

export interface LegacyEventGroup {
  kind: LegacyEventGroupKind
  eventIds: string[]
  offsetStart: number
  offsetEnd: number
}

export interface LegacyLogInspection {
  state: LegacyLogState
  originalByteLength: number
  originalSha256: string
  verifiedByteLength: number
  verifiedSha256: string
  tailOffset: number | null
  tailSha256: string | null
  tailBytes: Buffer | null
  events: ActionLogEntry[]
  lines: LegacyEventLine[]
  groups: LegacyEventGroup[]
  lastEventId: string | null
  lastEventTimestamp: string | null
}

export class LegacyLogError extends Error {
  constructor(
    public readonly code:
      | 'LEGACY_MALFORMED'
      | 'LEGACY_CHECKSUM_MISMATCH'
      | 'LEGACY_SEQUENCE_CONFLICT'
      | 'LEGACY_UNSUPPORTED_EVENT'
      | 'LEGACY_GROUP_CONFLICT'
      | 'LEGACY_SOURCE_CHANGED'
      | 'LEGACY_TAIL_NOT_RECOVERABLE',
    message: string,
    public readonly lineNumber: number | null = null
  ) {
    super(`[event-batch-legacy] ${message}`)
    this.name = 'LegacyLogError'
  }
}

const AGGREGATE_TYPES = new Set([
  'ASSESSMENT_SESSION',
  'TRAINING_SESSION',
  'BUSINESS_SESSION',
  'STUDENT_PROFILE',
  'STRATEGY_CONFIG',
  'QUESTION_BANK',
  'TASK_CLOSURE',
  'TASK_REPORT',
  'SAFETY_INCIDENT',
  'ASSET_RESOURCE',
  'SYSTEM'
])

const ACTOR_ROLES = new Set(['STUDENT', 'TEACHER', 'ADMIN', 'SYSTEM'])

const EVENT_TYPES = new Set([
  'SESSION_STARTED',
  'SESSION_FIRST_QUESTION_ACTIVATED',
  'ANSWER_SUBMITTED',
  'EMOTION_INTERRUPTED',
  'EMOTION_RESUMED',
  'SITTING_STARTED',
  'SITTING_ENDED',
  'EMOTION_COLLAPSE_RECORDED',
  'EMOTION_COLLAPSE_THRESHOLD_REACHED',
  'OFFLINE_SCORE_SUBMITTED',
  'TEACHER_OBSERVATION_RECORDED',
  'REDLINE_TRIGGERED',
  'SESSION_COMPLETED',
  'SESSION_ABORTED',
  'TRAINING_STARTED',
  'TRAINING_STEP_STARTED',
  'TRAINING_STEP_COMPLETED',
  'TRAINING_STEP_SKIPPED',
  'TRAINING_STEP_FAILED',
  'TRAINING_STEP_RETRIED',
  'TRAINING_ABORTED',
  'TRAINING_COMPLETED',
  'RESULT_CALCULATED',
  'TASK_CLOSURE_CONFIRMED',
  'TASK_CLOSURE_REPLACED',
  'REPORT_GENERATED',
  'REPORT_EXPORTED',
  'REPORT_LOCKED',
  'PLACEMENT_REVIEW_CONFIRMED',
  'QUESTION_SUPERSEDED',
  'SAFETY_INCIDENT_CREATED',
  'SAFETY_INCIDENT_DETAIL_CONFIRMED',
  'SAFETY_INCIDENT_RESOLVED',
  'SAFETY_INCIDENT_VOIDED',
  'SAFETY_INCIDENT_REPLACED_FOR_FACTUAL_CORRECTION',
  'SNAPSHOT_COMMITTED',
  'RECOVERY_REPLAYED',
  'RECOVERY_LOG_TRUNCATED',
  'ASSIGNMENT_CREATED',
  'ASSIGNMENT_STUDENT_CONFIRMED',
  'ASSIGNMENT_ASSESSMENT_STARTED',
  'GRANT_REBOUND',
  'ASSIGNMENT_RELEASED'
])

const REQUIRED_KEYS = [
  'actor_id',
  'actor_role',
  'aggregate_id',
  'aggregate_type',
  'app_version',
  'checksum',
  'created_at',
  'event_id',
  'event_sequence',
  'event_type',
  'payload',
  'schema_version'
]

class IncompleteJsonPrefix extends Error {}
class InvalidJsonPrefix extends Error {}

class JsonPrefixParser {
  private position = 0

  constructor(private readonly source: string) {}

  classify(): 'COMPLETE' | 'INCOMPLETE' | 'INVALID' {
    try {
      this.space()
      this.value()
      this.space()
      if (this.position !== this.source.length) throw new InvalidJsonPrefix()
      return 'COMPLETE'
    } catch (error) {
      if (error instanceof IncompleteJsonPrefix) return 'INCOMPLETE'
      return 'INVALID'
    }
  }

  private current(): string | undefined {
    return this.source[this.position]
  }

  private take(): string {
    const value = this.current()
    if (value === undefined) throw new IncompleteJsonPrefix()
    this.position += 1
    return value
  }

  private space(): void {
    while (/[ \t\r\n]/.test(this.current() ?? '')) this.position += 1
  }

  private value(): void {
    const current = this.current()
    if (current === undefined) throw new IncompleteJsonPrefix()
    if (current === '"') return this.string()
    if (current === '{') return this.object()
    if (current === '[') return this.array()
    if (current === 't') return this.literal('true')
    if (current === 'f') return this.literal('false')
    if (current === 'n') return this.literal('null')
    if (current === '-' || /\d/.test(current)) return this.number()
    throw new InvalidJsonPrefix()
  }

  private literal(expected: string): void {
    for (const character of expected) {
      if (this.current() === undefined) throw new IncompleteJsonPrefix()
      if (this.take() !== character) throw new InvalidJsonPrefix()
    }
  }

  private string(): void {
    if (this.take() !== '"') throw new InvalidJsonPrefix()
    while (true) {
      const character = this.take()
      if (character === '"') return
      if (character.charCodeAt(0) < 0x20) throw new InvalidJsonPrefix()
      if (character !== '\\') continue
      const escape = this.take()
      if ('"\\/bfnrt'.includes(escape)) continue
      if (escape !== 'u') throw new InvalidJsonPrefix()
      for (let index = 0; index < 4; index += 1) {
        const hex = this.take()
        if (!/[0-9a-f]/i.test(hex)) throw new InvalidJsonPrefix()
      }
    }
  }

  private number(): void {
    if (this.current() === '-') this.position += 1
    if (this.current() === undefined) throw new IncompleteJsonPrefix()
    if (this.current() === '0') {
      this.position += 1
      if (/\d/.test(this.current() ?? '')) throw new InvalidJsonPrefix()
    } else {
      if (!/[1-9]/.test(this.current() ?? '')) throw new InvalidJsonPrefix()
      while (/\d/.test(this.current() ?? '')) this.position += 1
    }
    if (this.current() === '.') {
      this.position += 1
      if (this.current() === undefined) throw new IncompleteJsonPrefix()
      if (!/\d/.test(this.current() ?? '')) throw new InvalidJsonPrefix()
      while (/\d/.test(this.current() ?? '')) this.position += 1
    }
    if (this.current() === 'e' || this.current() === 'E') {
      this.position += 1
      if (this.current() === '+' || this.current() === '-') this.position += 1
      if (this.current() === undefined) throw new IncompleteJsonPrefix()
      if (!/\d/.test(this.current() ?? '')) throw new InvalidJsonPrefix()
      while (/\d/.test(this.current() ?? '')) this.position += 1
    }
  }

  private object(): void {
    this.take()
    this.space()
    if (this.current() === undefined) throw new IncompleteJsonPrefix()
    if (this.current() === '}') {
      this.position += 1
      return
    }
    while (true) {
      if (this.current() === undefined) throw new IncompleteJsonPrefix()
      if (this.current() !== '"') throw new InvalidJsonPrefix()
      this.string()
      this.space()
      if (this.current() === undefined) throw new IncompleteJsonPrefix()
      if (this.take() !== ':') throw new InvalidJsonPrefix()
      this.space()
      this.value()
      this.space()
      if (this.current() === undefined) throw new IncompleteJsonPrefix()
      const separator = this.take()
      if (separator === '}') return
      if (separator !== ',') throw new InvalidJsonPrefix()
      this.space()
    }
  }

  private array(): void {
    this.take()
    this.space()
    if (this.current() === undefined) throw new IncompleteJsonPrefix()
    if (this.current() === ']') {
      this.position += 1
      return
    }
    while (true) {
      this.value()
      this.space()
      if (this.current() === undefined) throw new IncompleteJsonPrefix()
      const separator = this.take()
      if (separator === ']') return
      if (separator !== ',') throw new InvalidJsonPrefix()
      this.space()
    }
  }
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

function decodeProvableUtf8Prefix(bytes: Buffer): { text: string; incompleteCodePoint: boolean } | null {
  try {
    return { text: decodeUtf8(bytes), incompleteCodePoint: false }
  } catch {
    const maximumTail = Math.min(3, bytes.length)
    for (let tailLength = 1; tailLength <= maximumTail; tailLength += 1) {
      const prefix = bytes.subarray(0, bytes.length - tailLength)
      const tail = bytes.subarray(bytes.length - tailLength)
      const lead = tail[0]
      const expected = lead >= 0xc2 && lead <= 0xdf ? 2 : lead >= 0xe0 && lead <= 0xef ? 3 : lead >= 0xf0 && lead <= 0xf4 ? 4 : 0
      if (!expected || tail.length >= expected || [...tail.subarray(1)].some((byte) => byte < 0x80 || byte > 0xbf)) continue
      const second = tail[1]
      if (
        second !== undefined
        && ((lead === 0xe0 && second < 0xa0)
          || (lead === 0xed && second > 0x9f)
          || (lead === 0xf0 && second < 0x90)
          || (lead === 0xf4 && second > 0x8f))
      ) continue
      try {
        return { text: decodeUtf8(prefix), incompleteCodePoint: true }
      } catch {
        // Try a longer terminal prefix; any earlier UTF-8 error remains non-recoverable.
      }
    }
    return null
  }
}

function endsInsideUnescapedJsonString(text: string): boolean {
  let insideString = false
  let escaped = false
  for (const character of text) {
    if (!insideString) {
      if (character === '"') insideString = true
      continue
    }
    if (escaped) {
      escaped = false
      continue
    }
    if (character === '\\') {
      escaped = true
      continue
    }
    if (character === '"') insideString = false
  }
  return insideString && !escaped
}

export function isProvablyIncompleteJsonTail(bytes: Buffer): boolean {
  const decoded = decodeProvableUtf8Prefix(bytes)
  if (!decoded) return false
  if (decoded.incompleteCodePoint && !endsInsideUnescapedJsonString(decoded.text)) return false
  const classification = new JsonPrefixParser(decoded.text).classify()
  return classification === 'INCOMPLETE'
}

function jsonRecord(value: unknown, lineNumber: number): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new LegacyLogError('LEGACY_MALFORMED', `line ${lineNumber} is not an event object`, lineNumber)
  }
  return value as Record<string, unknown>
}

function nonEmptyString(value: unknown, key: string, lineNumber: number): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new LegacyLogError('LEGACY_MALFORMED', `line ${lineNumber} has invalid ${key}`, lineNumber)
  }
  return value
}

function validateLegacyEvent(value: unknown, lineNumber: number): ActionLogEntry {
  const input = jsonRecord(value, lineNumber)
  const expectedKeys = input.correlation_id === undefined
    ? REQUIRED_KEYS
    : [...REQUIRED_KEYS, 'correlation_id'].sort()
  const actualKeys = Object.keys(input).sort()
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    throw new LegacyLogError('LEGACY_MALFORMED', `line ${lineNumber} has an unsupported field set`, lineNumber)
  }
  nonEmptyString(input.event_id, 'event_id', lineNumber)
  const aggregateType = nonEmptyString(input.aggregate_type, 'aggregate_type', lineNumber)
  const eventType = nonEmptyString(input.event_type, 'event_type', lineNumber)
  const actorRole = nonEmptyString(input.actor_role, 'actor_role', lineNumber)
  if (!AGGREGATE_TYPES.has(aggregateType)) {
    throw new LegacyLogError('LEGACY_UNSUPPORTED_EVENT', `line ${lineNumber} has unsupported aggregate_type ${aggregateType}`, lineNumber)
  }
  if (!EVENT_TYPES.has(eventType)) {
    throw new LegacyLogError('LEGACY_UNSUPPORTED_EVENT', `line ${lineNumber} has unsupported event_type ${eventType}`, lineNumber)
  }
  if (!ACTOR_ROLES.has(actorRole)) {
    throw new LegacyLogError('LEGACY_UNSUPPORTED_EVENT', `line ${lineNumber} has unsupported actor_role ${actorRole}`, lineNumber)
  }
  if (!Number.isSafeInteger(input.event_sequence) || (input.event_sequence as number) < 1) {
    throw new LegacyLogError('LEGACY_SEQUENCE_CONFLICT', `line ${lineNumber} has invalid event_sequence`, lineNumber)
  }
  if (input.schema_version !== 1 && input.schema_version !== 2) {
    throw new LegacyLogError('LEGACY_UNSUPPORTED_EVENT', `line ${lineNumber} has unsupported schema_version`, lineNumber)
  }
  const payload = jsonRecord(input.payload, lineNumber)
  const checksum = nonEmptyString(input.checksum, 'checksum', lineNumber)
  const expectedChecksum = createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex')
  if (checksum !== expectedChecksum) {
    throw new LegacyLogError('LEGACY_CHECKSUM_MISMATCH', `line ${lineNumber} checksum mismatch`, lineNumber)
  }
  const createdAt = nonEmptyString(input.created_at, 'created_at', lineNumber)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(createdAt) || new Date(createdAt).toISOString() !== createdAt) {
    throw new LegacyLogError('LEGACY_MALFORMED', `line ${lineNumber} has invalid created_at`, lineNumber)
  }
  if (input.correlation_id !== undefined) nonEmptyString(input.correlation_id, 'correlation_id', lineNumber)
  nonEmptyString(input.aggregate_id, 'aggregate_id', lineNumber)
  nonEmptyString(input.actor_id, 'actor_id', lineNumber)
  nonEmptyString(input.app_version, 'app_version', lineNumber)
  return input as unknown as ActionLogEntry
}

function payloadText(event: ActionLogEntry, key: string): string | null {
  const value = event.payload[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function isCorrectionStart(event: ActionLogEntry): boolean {
  return event.schema_version === 1
    && event.event_type === 'SAFETY_INCIDENT_CREATED'
    && event.actor_role === 'ADMIN'
    && payloadText(event, 'incident_id') === event.aggregate_id
    && payloadText(event, 'brief_description') !== null
    && payloadText(event, 'reported_by') === event.actor_id
}

function isCorrectionTriplet(events: ActionLogEntry[], index: number): boolean {
  const created = events[index]
  const replaced = events[index + 1]
  const voided = events[index + 2]
  if (!created || !replaced || !voided || !isCorrectionStart(created)) return false
  const oldId = payloadText(replaced, 'old_incident_id')
  const newId = payloadText(replaced, 'new_incident_id')
  return replaced.schema_version === 1
    && voided.schema_version === 1
    && replaced.event_type === 'SAFETY_INCIDENT_REPLACED_FOR_FACTUAL_CORRECTION'
    && voided.event_type === 'SAFETY_INCIDENT_VOIDED'
    && oldId !== null
    && newId === created.aggregate_id
    && replaced.aggregate_id === oldId
    && payloadText(voided, 'incident_id') === oldId
    && voided.aggregate_id === oldId
    && payloadText(voided, 'replacement_incident_id') === newId
    && payloadText(voided, 'void_reason') === 'FACTUAL_CORRECTION'
}

function groupLegacyEvents(events: ActionLogEntry[], lines: LegacyEventLine[]): LegacyEventGroup[] {
  const groups: LegacyEventGroup[] = []
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]
    if (isCorrectionStart(event)) {
      if (!isCorrectionTriplet(events, index)) {
        throw new LegacyLogError('LEGACY_GROUP_CONFLICT', `event ${event.event_id} starts an incomplete factual-correction group`, lines[index].lineNumber)
      }
      groups.push({
        kind: 'F7_FACTUAL_CORRECTION',
        eventIds: events.slice(index, index + 3).map((entry) => entry.event_id),
        offsetStart: lines[index].offsetStart,
        offsetEnd: lines[index + 2].offsetEnd
      })
      index += 2
      continue
    }
    if (
      event.schema_version === 1
      && (
        event.event_type === 'SAFETY_INCIDENT_REPLACED_FOR_FACTUAL_CORRECTION'
        || (event.event_type === 'SAFETY_INCIDENT_VOIDED' && payloadText(event, 'void_reason') === 'FACTUAL_CORRECTION')
      )
    ) {
      throw new LegacyLogError('LEGACY_GROUP_CONFLICT', `event ${event.event_id} is an orphaned factual-correction member`, lines[index].lineNumber)
    }
    groups.push({
      kind: 'SINGLE',
      eventIds: [event.event_id],
      offsetStart: lines[index].offsetStart,
      offsetEnd: lines[index].offsetEnd
    })
  }
  return groups
}

export function inspectLegacyLogBytes(inputBytes: Uint8Array): LegacyLogInspection {
  const bytes = Buffer.from(inputBytes)
  const originalSha256 = sha256Hex(bytes)
  if (bytes.length === 0) {
    return {
      state: 'EMPTY',
      originalByteLength: 0,
      originalSha256,
      verifiedByteLength: 0,
      verifiedSha256: originalSha256,
      tailOffset: null,
      tailSha256: null,
      tailBytes: null,
      events: [],
      lines: [],
      groups: [],
      lastEventId: null,
      lastEventTimestamp: null
    }
  }

  const events: ActionLogEntry[] = []
  const lines: LegacyEventLine[] = []
  const eventIds = new Set<string>()
  const nextSequence = new Map<string, number>()
  let offset = 0
  let lineNumber = 1
  let tailBytes: Buffer | null = null

  while (offset < bytes.length) {
    const lf = bytes.indexOf(0x0a, offset)
    const terminatedByLf = lf >= 0
    const offsetEnd = terminatedByLf ? lf + 1 : bytes.length
    const lineBytes = bytes.subarray(offset, terminatedByLf ? lf : bytes.length)
    if (lineBytes.length === 0) {
      throw new LegacyLogError('LEGACY_MALFORMED', `line ${lineNumber} is empty`, lineNumber)
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(decodeUtf8(lineBytes))
    } catch {
      if (!terminatedByLf && offsetEnd === bytes.length && isProvablyIncompleteJsonTail(lineBytes)) {
        tailBytes = Buffer.from(bytes.subarray(offset))
        break
      }
      throw new LegacyLogError('LEGACY_MALFORMED', `line ${lineNumber} is not complete supported JSON`, lineNumber)
    }
    const event = validateLegacyEvent(parsed, lineNumber)
    if (eventIds.has(event.event_id)) {
      throw new LegacyLogError('LEGACY_SEQUENCE_CONFLICT', `line ${lineNumber} duplicates event_id ${event.event_id}`, lineNumber)
    }
    eventIds.add(event.event_id)
    const aggregateKey = event.aggregate_id
    const expected = nextSequence.get(aggregateKey) ?? 1
    if (event.event_sequence !== expected) {
      throw new LegacyLogError(
        'LEGACY_SEQUENCE_CONFLICT',
        `line ${lineNumber} expected event_sequence ${expected} for ${event.aggregate_id}, got ${event.event_sequence}`,
        lineNumber
      )
    }
    nextSequence.set(aggregateKey, expected + 1)
    events.push(event)
    lines.push({ lineNumber, offsetStart: offset, offsetEnd, terminatedByLf, event })
    offset = offsetEnd
    lineNumber += 1
  }

  const verifiedByteLength = tailBytes ? offset : bytes.length
  const groups = groupLegacyEvents(events, lines)
  const last = events.at(-1)
  const state: LegacyLogState = tailBytes
    ? 'RECOVERABLE_INCOMPLETE_TAIL'
    : bytes.at(-1) === 0x0a
      ? 'VALID_LF_TERMINATED'
      : 'VALID_COMPLETE_EOF'
  return {
    state,
    originalByteLength: bytes.length,
    originalSha256,
    verifiedByteLength,
    verifiedSha256: sha256Hex(bytes.subarray(0, verifiedByteLength)),
    tailOffset: tailBytes ? verifiedByteLength : null,
    tailSha256: tailBytes ? sha256Hex(tailBytes) : null,
    tailBytes,
    events,
    lines,
    groups,
    lastEventId: last?.event_id ?? null,
    lastEventTimestamp: last?.created_at ?? null
  }
}

export function inspectLegacyLogFile(dataRoot: string, relativePath = 'action_log.jsonl'): LegacyLogInspection {
  const capability = new DurableFileCapability(dataRoot)
  const snapshot = capability.readStable(relativePath)
  if (!snapshot) throw new LegacyLogError('LEGACY_SOURCE_CHANGED', `legacy source ${relativePath} does not exist`)
  return inspectLegacyLogBytes(snapshot.bytes)
}

export function archiveAndTruncateLegacyTail(options: {
  dataRoot: string
  logRelativePath?: string
  archiveRelativeDirectory: string
  repairId: string
  inspection: LegacyLogInspection
  hooks?: FileDurabilityHooks
}): { archiveRelativePath: string; truncatedTo: number } {
  const logRelativePath = options.logRelativePath ?? 'action_log.jsonl'
  if (options.inspection.state !== 'RECOVERABLE_INCOMPLETE_TAIL' || !options.inspection.tailBytes) {
    throw new LegacyLogError('LEGACY_TAIL_NOT_RECOVERABLE', 'legacy inspection has no provably incomplete tail')
  }
  if (!/^[a-z0-9-]{1,64}$/.test(options.repairId)) {
    throw new LegacyLogError('LEGACY_TAIL_NOT_RECOVERABLE', 'repairId must be a lowercase owned token')
  }
  const capability = new DurableFileCapability(options.dataRoot, options.hooks)
  const current = capability.readStable(logRelativePath)
  if (
    !current
    || current.byteSize !== options.inspection.originalByteLength
    || current.sha256 !== options.inspection.originalSha256
  ) {
    throw new LegacyLogError('LEGACY_SOURCE_CHANGED', 'legacy source changed after read-only inspection')
  }
  capability.ensureDirectory(options.archiveRelativeDirectory)
  const archiveRelativePath = `${options.archiveRelativeDirectory}/action-log.incomplete-tail.${options.repairId}.bin`
  const archive = capability.createExclusive(archiveRelativePath, options.inspection.tailBytes)
  capability.close(archive)

  const log = capability.openAppend(logRelativePath)
  try {
    const opened = capability.assertHandleIdentity(log)
    if (
      opened.dev !== current.identity.device
      || opened.ino !== current.identity.inode
      || opened.size !== current.byteSize
      || capability.hashHandle(log) !== current.sha256
    ) {
      throw new LegacyLogError('LEGACY_SOURCE_CHANGED', 'legacy source changed before truncate')
    }
    capability.truncate(log, options.inspection.verifiedByteLength)
    capability.syncFile(log)
  } finally {
    capability.close(log)
  }
  const parent = logRelativePath.includes('/') ? logRelativePath.slice(0, logRelativePath.lastIndexOf('/')) : '.'
  capability.syncDirectory(parent)
  const repaired = capability.readStable(logRelativePath)
  if (
    !repaired
    || repaired.identity.device !== current.identity.device
    || repaired.identity.inode !== current.identity.inode
    || repaired.byteSize !== options.inspection.verifiedByteLength
    || repaired.sha256 !== options.inspection.verifiedSha256
  ) {
    throw new LegacyLogError('LEGACY_SOURCE_CHANGED', 'legacy source did not truncate to the verified boundary')
  }
  return { archiveRelativePath, truncatedTo: options.inspection.verifiedByteLength }
}
