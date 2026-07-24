import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { basename, dirname, join } from 'path'
import type { ActionLogEntry } from '@shared/types/event-payloads'
import type { DBAdapter } from '../db/interface'
import { applyAssessmentEvent } from './assessment-reducer'
import { applyAssignmentEvent } from './assignment-reducer'
import { applyTrainingEvent } from './training-reducer'

export type RecoveryLogErrorCode =
  | 'LOG_MALFORMED'
  | 'CHECKSUM_MISMATCH'
  | 'EVENT_SEQUENCE_INVALID'

export type RecoveryReplayErrorCode = 'UNSUPPORTED_EVENT' | 'UNRECOVERABLE_EVENT'

export class RecoveryLogError extends Error {
  constructor(
    public readonly code: RecoveryLogErrorCode,
    public readonly lineNumber: number,
    message: string
  ) {
    super(message)
    this.name = 'RecoveryLogError'
  }
}

export class RecoveryReplayError extends Error {
  constructor(
    public readonly code: RecoveryReplayErrorCode,
    public readonly eventId: string,
    message: string
  ) {
    super(message)
    this.name = 'RecoveryReplayError'
  }
}

export interface ReadActionLogOptions {
  logPath: string
  archiveDir?: string
}

export interface ReadActionLogResult {
  events: ActionLogEntry[]
  truncatedTail: boolean
  archivedTailPath: string | null
}

export interface ReconcileActionLogOptions extends ReadActionLogOptions {}

export interface ReconcileActionLogResult extends ReadActionLogResult {
  replayedEventCount: number
  skippedEventCount: number
}

export interface RecoverySnapshotOptions {
  lastAppliedEvent: ActionLogEntry
  sqliteFileHash: string
  actionLogPath: string
  archivedLogPath: string | null
  schemaVersion: string
  appVersion: string
}

const assessmentEventTypes = new Set<ActionLogEntry['event_type']>([
  'SESSION_STARTED',
  'SESSION_FIRST_QUESTION_ACTIVATED',
  'ASSIGNMENT_ASSESSMENT_STARTED',
  'ANSWER_SUBMITTED',
  'EMOTION_INTERRUPTED',
  'EMOTION_RESUMED',
  'SITTING_STARTED',
  'SITTING_ENDED',
  'EMOTION_COLLAPSE_RECORDED',
  'EMOTION_COLLAPSE_THRESHOLD_REACHED',
  'SESSION_COMPLETED',
  'SESSION_ABORTED',
  'REDLINE_TRIGGERED',
  'RESULT_CALCULATED',
  'OFFLINE_SCORE_SUBMITTED',
  'TEACHER_OBSERVATION_RECORDED'
])

const trainingEventTypes = new Set<ActionLogEntry['event_type']>([
  'TRAINING_STARTED',
  'TRAINING_STEP_STARTED',
  'TRAINING_STEP_COMPLETED',
  'TRAINING_STEP_SKIPPED',
  'TRAINING_STEP_FAILED',
  'TRAINING_STEP_RETRIED',
  'TRAINING_COMPLETED'
])

const assignmentEventTypes = new Set<ActionLogEntry['event_type']>([
  'ASSIGNMENT_CREATED',
  'ASSIGNMENT_STUDENT_CONFIRMED',
  'GRANT_REBOUND',
  'ASSIGNMENT_RELEASED'
])

const projectionOnlySystemEventTypes = new Set<ActionLogEntry['event_type']>([
  'SNAPSHOT_COMMITTED',
  'RECOVERY_REPLAYED',
  'RECOVERY_LOG_TRUNCATED'
])

function requireNonEmptyString(
  value: unknown,
  field: string,
  event: ActionLogEntry
): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new RecoveryReplayError(
      'UNRECOVERABLE_EVENT',
      event.event_id,
      `${event.event_type} (${event.event_id}) is missing recoverable ${field}`
    )
  }
  return value
}

function requireStringArray(value: unknown, field: string, event: ActionLogEntry): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw new RecoveryReplayError(
      'UNRECOVERABLE_EVENT',
      event.event_id,
      `${event.event_type} (${event.event_id}) has invalid ${field}`
    )
  }
  return value
}

function checksumFor(payload: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseActionLogEntry(value: unknown, lineNumber: number): ActionLogEntry {
  if (!isRecord(value) || !isRecord(value.payload)) {
    throw new RecoveryLogError('LOG_MALFORMED', lineNumber, `action log line ${lineNumber} is not an event object`)
  }
  const requiredStrings = [
    'event_id',
    'aggregate_type',
    'aggregate_id',
    'event_type',
    'checksum',
    'created_at',
    'actor_id',
    'actor_role',
    'app_version'
  ]
  for (const key of requiredStrings) {
    if (typeof value[key] !== 'string' || value[key].length === 0) {
      throw new RecoveryLogError('LOG_MALFORMED', lineNumber, `action log line ${lineNumber} has invalid ${key}`)
    }
  }
  if (!Number.isInteger(value.event_sequence) || (value.event_sequence as number) < 1) {
    throw new RecoveryLogError('EVENT_SEQUENCE_INVALID', lineNumber, `action log line ${lineNumber} has invalid event_sequence`)
  }
  if (!Number.isInteger(value.schema_version) || (value.schema_version as number) < 1) {
    throw new RecoveryLogError('LOG_MALFORMED', lineNumber, `action log line ${lineNumber} has invalid schema_version`)
  }
  if (checksumFor(value.payload) !== value.checksum) {
    throw new RecoveryLogError('CHECKSUM_MISMATCH', lineNumber, `action log line ${lineNumber} checksum mismatch`)
  }

  return value as unknown as ActionLogEntry
}

function archiveTail(logPath: string, archiveDir: string | undefined, tail: string): string {
  const targetDir = archiveDir ?? dirname(logPath)
  mkdirSync(targetDir, { recursive: true })
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const archivePath = join(targetDir, `${basename(logPath)}.corrupt-tail.${timestamp}.jsonl`)
  writeFileSync(archivePath, tail, 'utf8')
  return archivePath
}

/**
 * 读取并验证 action_log.jsonl。只允许恢复最后一条损坏的 JSON 行；任意其他
 * 格式、checksum 或聚合内序号错误都会失败关闭，调用方不得继续开放业务 IPC。
 */
export function readActionLog(options: ReadActionLogOptions): ReadActionLogResult {
  if (!existsSync(options.logPath)) {
    return { events: [], truncatedTail: false, archivedTailPath: null }
  }

  const raw = readFileSync(options.logPath, 'utf8')
  const lines = raw.split('\n')
  const nonEmptyIndexes = lines
    .map((line, index) => (line.trim().length > 0 ? index : -1))
    .filter((index) => index >= 0)
  const lastNonEmptyIndex = nonEmptyIndexes.at(-1)
  const events: ActionLogEntry[] = []
  const nextSequenceByAggregate = new Map<string, number>()

  for (const index of nonEmptyIndexes) {
    const lineNumber = index + 1
    let parsed: unknown
    try {
      parsed = JSON.parse(lines[index])
    } catch {
      if (index === lastNonEmptyIndex) {
        const archivedTailPath = archiveTail(options.logPath, options.archiveDir, lines.slice(index).join('\n'))
        const validPrefix = lines.slice(0, index).filter((line) => line.trim().length > 0).join('\n')
        writeFileSync(options.logPath, validPrefix.length > 0 ? `${validPrefix}\n` : '', 'utf8')
        return { events, truncatedTail: true, archivedTailPath }
      }
      throw new RecoveryLogError('LOG_MALFORMED', lineNumber, `action log line ${lineNumber} is invalid JSON`)
    }

    const entry = parseActionLogEntry(parsed, lineNumber)
    const aggregateKey = `${entry.aggregate_type}:${entry.aggregate_id}`
    const expectedSequence = nextSequenceByAggregate.get(aggregateKey) ?? 1
    if (entry.event_sequence !== expectedSequence) {
      throw new RecoveryLogError(
        'EVENT_SEQUENCE_INVALID',
        lineNumber,
        `action log line ${lineNumber} expected event_sequence ${expectedSequence} for ${entry.aggregate_id}`
      )
    }
    nextSequenceByAggregate.set(aggregateKey, expectedSequence + 1)
    events.push(entry)
  }

  return { events, truncatedTail: false, archivedTailPath: null }
}

function insertEventProjection(db: DBAdapter, event: ActionLogEntry, sourceLogPath: string): void {
  db.prepare(
    `INSERT INTO domain_event_projection (
       event_id, aggregate_type, aggregate_id,
       event_type, event_sequence, payload_json,
       checksum, source_log_path, schema_version, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    event.event_id,
    event.aggregate_type,
    event.aggregate_id,
    event.event_type,
    event.event_sequence,
    JSON.stringify(event.payload),
    event.checksum,
    sourceLogPath,
    event.schema_version,
    event.created_at
  )
}

function applyRecoveredEvent(db: DBAdapter, event: ActionLogEntry): void {
  if (assessmentEventTypes.has(event.event_type)) {
    applyAssessmentEvent(db, event)
    return
  }
  if (trainingEventTypes.has(event.event_type)) {
    applyTrainingEvent(db, event)
    return
  }
  if (assignmentEventTypes.has(event.event_type)) {
    applyAssignmentEvent(db, event)
    return
  }
  if (event.event_type === 'SAFETY_INCIDENT_CREATED') {
    applySafetyIncidentCreated(db, event)
    return
  }
  if (event.event_type === 'SAFETY_INCIDENT_DETAIL_CONFIRMED') {
    applySafetyIncidentDetailConfirmed(db, event)
    return
  }
  if (event.event_type === 'SAFETY_INCIDENT_RESOLVED') {
    applySafetyIncidentResolved(db, event)
    return
  }
  if (event.event_type === 'SAFETY_INCIDENT_VOIDED') {
    applySafetyIncidentVoided(db, event)
    return
  }
  if (event.event_type === 'SAFETY_INCIDENT_REPLACED_FOR_FACTUAL_CORRECTION') {
    return
  }
  if (event.event_type === 'REPORT_GENERATED') {
    applyReportGenerated(db, event)
    return
  }
  if (event.aggregate_type === 'SYSTEM' && projectionOnlySystemEventTypes.has(event.event_type)) {
    return
  }
  throw new RecoveryReplayError(
    'UNSUPPORTED_EVENT',
    event.event_id,
    `cannot safely replay ${event.event_type} (${event.event_id}) without a dedicated recovery reducer`
  )
}

function applySafetyIncidentCreated(db: DBAdapter, event: ActionLogEntry): void {
  const payload = event.payload
  const incidentId = requireNonEmptyString(payload.incident_id, 'incident_id', event)
  if (event.aggregate_type !== 'SAFETY_INCIDENT' || event.aggregate_id !== incidentId) {
    throw new RecoveryReplayError(
      'UNRECOVERABLE_EVENT',
      event.event_id,
      `SAFETY_INCIDENT_CREATED (${event.event_id}) aggregate does not match incident_id`
    )
  }
  const existing = db.prepare('SELECT trigger_event_id FROM safety_incident WHERE incident_id = ?').get(incidentId) as
    | { trigger_event_id: string }
    | undefined
  if (existing) {
    if (existing.trigger_event_id !== event.event_id) {
      throw new RecoveryReplayError(
        'UNRECOVERABLE_EVENT',
        event.event_id,
        `SAFETY_INCIDENT_CREATED (${event.event_id}) conflicts with existing incident ${incidentId}`
      )
    }
    return
  }

  db.prepare(
    `INSERT INTO safety_incident
       (incident_id, student_id, job_code, task_code, trigger_event_id,
        reason_code, description, triggered_by, context_phase, occurred_at,
        status, requires_review_before_next_session)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_DETAIL', 1)`
  ).run(
    incidentId,
    requireNonEmptyString(payload.student_id, 'student_id', event),
    requireNonEmptyString(payload.job_code, 'job_code', event),
    requireNonEmptyString(payload.task_code, 'task_code', event),
    event.event_id,
    requireNonEmptyString(payload.reason_code, 'reason_code', event),
    typeof payload.brief_description === 'string' ? payload.brief_description : null,
    requireNonEmptyString(payload.reported_by, 'reported_by', event),
    requireNonEmptyString(payload.context_phase, 'context_phase', event),
    requireNonEmptyString(payload.occurred_at, 'occurred_at', event)
  )
}

function applyReportGenerated(db: DBAdapter, event: ActionLogEntry): void {
  const payload = event.payload
  const reportId = requireNonEmptyString(payload.report_id, 'report_id', event)
  if (event.aggregate_type !== 'TASK_REPORT' || event.aggregate_id !== reportId) {
    throw new RecoveryReplayError(
      'UNRECOVERABLE_EVENT',
      event.event_id,
      `REPORT_GENERATED (${event.event_id}) aggregate does not match report_id`
    )
  }
  const existing = db.prepare('SELECT generated_event_id FROM task_report WHERE report_id = ?').get(reportId) as
    | { generated_event_id: string }
    | undefined
  if (existing) {
    if (existing.generated_event_id !== event.event_id) {
      throw new RecoveryReplayError(
        'UNRECOVERABLE_EVENT',
        event.event_id,
        `REPORT_GENERATED (${event.event_id}) conflicts with existing report ${reportId}`
      )
    }
    return
  }
  if (!isRecord(payload.report_content)) {
    throw new RecoveryReplayError(
      'UNRECOVERABLE_EVENT',
      event.event_id,
      `REPORT_GENERATED (${event.event_id}) is missing recoverable report_content`
    )
  }
  const sourceAggregateType = requireNonEmptyString(payload.source_aggregate_type, 'source_aggregate_type', event)
  if (!['ASSESSMENT_SESSION', 'TRAINING_SESSION', 'SAFETY_INCIDENT', 'SYSTEM'].includes(sourceAggregateType)) {
    throw new RecoveryReplayError(
      'UNRECOVERABLE_EVENT',
      event.event_id,
      `REPORT_GENERATED (${event.event_id}) has invalid source_aggregate_type`
    )
  }

  db.prepare(
    `INSERT INTO task_report
       (report_id, report_type, student_id, source_aggregate_type, source_aggregate_id,
        source_result_ids_json, report_title, report_content_json,
        generated_event_id, generated_by, generated_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'GENERATED')`
  ).run(
    reportId,
    requireNonEmptyString(payload.report_type, 'report_type', event),
    requireNonEmptyString(payload.student_id, 'student_id', event),
    sourceAggregateType,
    requireNonEmptyString(payload.source_aggregate_id, 'source_aggregate_id', event),
    JSON.stringify(requireStringArray(payload.result_ids, 'result_ids', event)),
    requireNonEmptyString(payload.report_title, 'report_title', event),
    JSON.stringify(payload.report_content),
    event.event_id,
    requireNonEmptyString(payload.generated_by, 'generated_by', event),
    requireNonEmptyString(payload.generated_at, 'generated_at', event)
  )
}

function applySafetyIncidentDetailConfirmed(db: DBAdapter, event: ActionLogEntry): void {
  const payload = event.payload
  const incidentId = requireNonEmptyString(payload.incident_id, 'incident_id', event)
  const row = db.prepare('SELECT status FROM safety_incident WHERE incident_id = ?').get(incidentId) as
    | { status: string }
    | undefined
  if (!row) {
    throw new RecoveryReplayError('UNRECOVERABLE_EVENT', event.event_id, `confirmed safety incident ${incidentId} is missing`)
  }
  if (row.status === 'CONFIRMED') return
  if (row.status !== 'PENDING_DETAIL') {
    throw new RecoveryReplayError('UNRECOVERABLE_EVENT', event.event_id, `cannot confirm safety incident ${incidentId} from ${row.status}`)
  }
  db.prepare(
    `UPDATE safety_incident
        SET reason_code = ?, context_phase = ?, description = ?, confirmed_by = ?, status = 'CONFIRMED', updated_at = datetime('now')
      WHERE incident_id = ?`
  ).run(
    requireNonEmptyString(payload.reason_code, 'reason_code', event),
    requireNonEmptyString(payload.context_phase, 'context_phase', event),
    requireNonEmptyString(payload.full_description, 'full_description', event),
    requireNonEmptyString(payload.confirmed_by, 'confirmed_by', event),
    incidentId
  )
}

function applySafetyIncidentResolved(db: DBAdapter, event: ActionLogEntry): void {
  const payload = event.payload
  const incidentId = requireNonEmptyString(payload.incident_id, 'incident_id', event)
  const row = db.prepare('SELECT status FROM safety_incident WHERE incident_id = ?').get(incidentId) as
    | { status: string }
    | undefined
  if (!row) {
    throw new RecoveryReplayError('UNRECOVERABLE_EVENT', event.event_id, `resolved safety incident ${incidentId} is missing`)
  }
  if (row.status === 'RESOLVED') return
  if (row.status !== 'CONFIRMED') {
    throw new RecoveryReplayError('UNRECOVERABLE_EVENT', event.event_id, `cannot resolve safety incident ${incidentId} from ${row.status}`)
  }
  db.prepare(
    `UPDATE safety_incident
        SET status = 'RESOLVED', resolved_by = ?, resolved_at = ?, requires_review_before_next_session = 0, updated_at = datetime('now')
      WHERE incident_id = ?`
  ).run(
    requireNonEmptyString(payload.resolved_by, 'resolved_by', event),
    requireNonEmptyString(payload.resolved_at, 'resolved_at', event),
    incidentId
  )
}

function applySafetyIncidentVoided(db: DBAdapter, event: ActionLogEntry): void {
  const payload = event.payload
  const incidentId = requireNonEmptyString(payload.incident_id, 'incident_id', event)
  const row = db.prepare('SELECT status FROM safety_incident WHERE incident_id = ?').get(incidentId) as
    | { status: string }
    | undefined
  if (!row) {
    throw new RecoveryReplayError('UNRECOVERABLE_EVENT', event.event_id, `voided safety incident ${incidentId} is missing`)
  }
  if (row.status === 'VOIDED') return
  if (!['PENDING_DETAIL', 'CONFIRMED'].includes(row.status)) {
    throw new RecoveryReplayError('UNRECOVERABLE_EVENT', event.event_id, `cannot void safety incident ${incidentId} from ${row.status}`)
  }
  db.prepare(
    `UPDATE safety_incident
        SET status = 'VOIDED', void_reason = ?, replacement_incident_id = ?,
            resolved_by = ?, resolved_at = ?, requires_review_before_next_session = 0, updated_at = datetime('now')
      WHERE incident_id = ?`
  ).run(
    requireNonEmptyString(payload.void_reason, 'void_reason', event),
    typeof payload.replacement_incident_id === 'string' ? payload.replacement_incident_id : null,
    requireNonEmptyString(payload.voided_by, 'voided_by', event),
    requireNonEmptyString(payload.voided_at, 'voided_at', event),
    incidentId
  )
}

/**
 * 使 JSONL 事实来源与 SQLite 查询投影重新一致。每个缺失事件都在一个独立事务中
 * 补写原始投影并执行对应 reducer；不支持的事件会失败关闭，绝不推测其业务状态。
 */
export function reconcileActionLog(
  db: DBAdapter,
  options: ReconcileActionLogOptions
): ReconcileActionLogResult {
  const log = readActionLog(options)
  let replayedEventCount = 0
  let skippedEventCount = 0

  for (const event of log.events) {
    const projected = db
      .prepare('SELECT 1 FROM domain_event_projection WHERE event_id = ?')
      .get(event.event_id)
    if (projected) {
      skippedEventCount += 1
      continue
    }

    db.transaction(() => {
      insertEventProjection(db, event, options.logPath)
      applyRecoveredEvent(db, event)
    })()
    replayedEventCount += 1
  }

  return { ...log, replayedEventCount, skippedEventCount }
}

/** 写入恢复完成后的 SQLite 快照元数据。调用方须先持久化 lastAppliedEvent。 */
export function writeRecoverySnapshot(db: DBAdapter, options: RecoverySnapshotOptions): string {
  const snapshotSequence = (
    db.prepare('SELECT COALESCE(MAX(snapshot_sequence), 0) + 1 AS next_sequence FROM snapshot_meta').get() as {
      next_sequence: number
    }
  ).next_sequence
  const snapshotId = `snapshot:${options.lastAppliedEvent.event_id}`
  db.prepare(
    `INSERT INTO snapshot_meta
       (snapshot_id, snapshot_sequence, last_applied_event_id, last_applied_sequence,
        sqlite_file_hash, action_log_path, archived_log_path,
        schema_version, app_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    snapshotId,
    snapshotSequence,
    options.lastAppliedEvent.event_id,
    options.lastAppliedEvent.event_sequence,
    options.sqliteFileHash,
    options.actionLogPath,
    options.archivedLogPath,
    options.schemaVersion,
    options.appVersion
  )
  return snapshotId
}
