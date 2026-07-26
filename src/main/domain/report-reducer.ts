import type { DBAdapter } from '../db/interface'
import { sha256CanonicalJson } from './report-canonical'
import { parseF7EventPayload, parseReportContent } from './report-contract'
import {
  isAllowedReportExportTransition,
  isAllowedTaskClosureConfirmedState,
  isAllowedTaskClosureReplacementState
} from './report-lifecycle'
import type {
  ActionLogEntry,
  EventType,
  F7EventPayload,
  ReportExportedV2Payload,
  ReportGeneratedV2Payload,
  ReportLockedV2Payload,
  SafetyIncidentReplacedForFactualCorrectionV2Payload,
  SafetyIncidentVoidedV2Payload,
  TaskClosureConfirmedPayload,
  TaskClosureReplacedPayload
} from '@shared/types/event-payloads'

export type F7ReportEventType = Extract<EventType,
  | 'TASK_CLOSURE_CONFIRMED'
  | 'TASK_CLOSURE_REPLACED'
  | 'REPORT_GENERATED'
  | 'PLACEMENT_REVIEW_CONFIRMED'
  | 'REPORT_LOCKED'
  | 'REPORT_EXPORTED'
  | 'SAFETY_INCIDENT_VOIDED'
  | 'SAFETY_INCIDENT_REPLACED_FOR_FACTUAL_CORRECTION'
>

const F7_REPORT_EVENT_TYPES = new Set<F7ReportEventType>([
  'TASK_CLOSURE_CONFIRMED',
  'TASK_CLOSURE_REPLACED',
  'REPORT_GENERATED',
  'PLACEMENT_REVIEW_CONFIRMED',
  'REPORT_LOCKED',
  'REPORT_EXPORTED',
  'SAFETY_INCIDENT_VOIDED',
  'SAFETY_INCIDENT_REPLACED_FOR_FACTUAL_CORRECTION'
])

type ReportStatus = 'GENERATED' | 'EXPORTED' | 'LOCKED' | 'SUPERSEDED' | 'ARCHIVED' | 'FAILED'

type ReportRow = {
  report_id: string
  status: ReportStatus
  contract_validation_status: 'VALID' | 'REPAIR_REQUIRED'
  content_hash: string | null
  report_content_json: string
  generated_event_id: string
  placement_review_by: string | null
  placement_review_at: string | null
  last_applied_event_id: string | null
}

type ClosureRow = {
  task_closure_id: string
  student_id: string
  job_code: string
  task_code: string
  cycle_no: number
  closure_revision: number
  status: 'CONFIRMED' | 'SUPERSEDED'
  is_cycle_head: number
  confirmed_event_id: string
  replacement_task_closure_id: string | null
}

type SafetyIncidentRow = {
  incident_id: string
  student_id: string
  job_code: string
  task_code: string
  status: 'PENDING_DETAIL' | 'CONFIRMED' | 'RESOLVED' | 'VOIDED'
  void_reason: string | null
  replacement_incident_id: string | null
  trigger_event_id: string
}

export class ReportReducerError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_F7_EVENT'
      | 'AGGREGATE_MISMATCH'
      | 'ACTOR_MISMATCH'
      | 'PROJECTION_CONFLICT'
      | 'STATE_CONFLICT',
    message: string
  ) {
    super(message)
    this.name = 'ReportReducerError'
  }
}

export function isF7ReportEvent(event: Pick<ActionLogEntry, 'schema_version' | 'event_type'>): event is Pick<ActionLogEntry, 'schema_version' | 'event_type'> & { event_type: F7ReportEventType } {
  return event.schema_version === 2 && F7_REPORT_EVENT_TYPES.has(event.event_type as F7ReportEventType)
}

/**
 * Apply an F7 event to task_closure/task_report/safety projections.
 * Callers must keep this and markReportEventApplied in the same SQLite transaction.
 */
export function applyReportEvent(db: DBAdapter, event: ActionLogEntry): void {
  if (!isF7ReportEvent(event)) {
    throw new ReportReducerError('INVALID_F7_EVENT', `Event ${event.event_id} is not an F7 report event`)
  }

  const parsed = parseF7EventPayload(event.event_type, event.payload)
  if (!parsed.valid) {
    const fields = parsed.errors.map((error) => error.path).join(', ')
    throw new ReportReducerError('INVALID_F7_EVENT', `Invalid ${event.event_type} payload for ${event.event_id}: ${fields}`)
  }

  switch (event.event_type) {
    case 'TASK_CLOSURE_CONFIRMED':
      applyTaskClosureConfirmed(db, event, parsed.value as TaskClosureConfirmedPayload)
      return
    case 'TASK_CLOSURE_REPLACED':
      applyTaskClosureReplaced(db, event, parsed.value as TaskClosureReplacedPayload)
      return
    case 'REPORT_GENERATED':
      applyReportGenerated(db, event, parsed.value as ReportGeneratedV2Payload)
      return
    case 'PLACEMENT_REVIEW_CONFIRMED':
      applyPlacementReview(db, event, parsed.value as Extract<F7EventPayload, { placement_advice_hash: string }>)
      return
    case 'REPORT_LOCKED':
      applyReportLocked(db, event, parsed.value as ReportLockedV2Payload)
      return
    case 'REPORT_EXPORTED':
      applyReportExported(db, event, parsed.value as ReportExportedV2Payload)
      return
    case 'SAFETY_INCIDENT_VOIDED':
      applySafetyIncidentVoided(db, event, parsed.value as SafetyIncidentVoidedV2Payload)
      return
    case 'SAFETY_INCIDENT_REPLACED_FOR_FACTUAL_CORRECTION':
      applySafetyIncidentFactualCorrection(db, event, parsed.value as SafetyIncidentReplacedForFactualCorrectionV2Payload)
      return
  }
}

export function markReportEventApplied(db: DBAdapter, event: ActionLogEntry): void {
  db.prepare(
    `UPDATE domain_event_projection
        SET applied_to_snapshot = 1,
            applied_at = COALESCE(applied_at, ?)
      WHERE event_id = ? AND schema_version = 2`
  ).run(event.created_at, event.event_id)
}

function assertAggregate(
  event: ActionLogEntry,
  aggregateType: ActionLogEntry['aggregate_type'],
  aggregateId: string
): void {
  if (event.aggregate_type !== aggregateType || event.aggregate_id !== aggregateId) {
    throw new ReportReducerError(
      'AGGREGATE_MISMATCH',
      `${event.event_type} (${event.event_id}) aggregate does not match its payload`
    )
  }
}

function assertActor(event: ActionLogEntry, actorId: string, roles: readonly ActionLogEntry['actor_role'][]): void {
  if (event.actor_id !== actorId || !roles.includes(event.actor_role)) {
    throw new ReportReducerError(
      'ACTOR_MISMATCH',
      `${event.event_type} (${event.event_id}) actor does not match the payload authority`
    )
  }
}

function requireClosure(db: DBAdapter, closureId: string, event: ActionLogEntry): ClosureRow {
  const row = db.prepare('SELECT * FROM task_closure WHERE task_closure_id = ?').get(closureId) as ClosureRow | undefined
  if (!row) {
    throw new ReportReducerError('STATE_CONFLICT', `${event.event_type} (${event.event_id}) references missing closure ${closureId}`)
  }
  return row
}

function requireReport(db: DBAdapter, reportId: string, event: ActionLogEntry): ReportRow {
  const row = db.prepare('SELECT * FROM task_report WHERE report_id = ?').get(reportId) as ReportRow | undefined
  if (!row) {
    throw new ReportReducerError('STATE_CONFLICT', `${event.event_type} (${event.event_id}) references missing report ${reportId}`)
  }
  return row
}

function requireSafetyIncident(db: DBAdapter, incidentId: string, event: ActionLogEntry): SafetyIncidentRow {
  const row = db.prepare('SELECT * FROM safety_incident WHERE incident_id = ?').get(incidentId) as SafetyIncidentRow | undefined
  if (!row) {
    throw new ReportReducerError('STATE_CONFLICT', `${event.event_type} (${event.event_id}) references missing incident ${incidentId}`)
  }
  return row
}

function assertReportContractAndHash(report: ReportRow, contentHash: string, event: ActionLogEntry): void {
  if (report.contract_validation_status !== 'VALID' || report.content_hash !== contentHash) {
    throw new ReportReducerError('STATE_CONFLICT', `${event.event_type} (${event.event_id}) report contract or content hash changed`)
  }
}

function assertActiveReport(report: ReportRow, event: ActionLogEntry): void {
  if (!['GENERATED', 'EXPORTED', 'LOCKED'].includes(report.status)) {
    throw new ReportReducerError('STATE_CONFLICT', `${event.event_type} (${event.event_id}) requires an active report`)
  }
}

function assertReportStatus(report: ReportRow, expected: ReportStatus, event: ActionLogEntry): void {
  if (report.status !== expected) {
    throw new ReportReducerError(
      'STATE_CONFLICT',
      `${event.event_type} (${event.event_id}) expected ${expected} but report is ${report.status}`
    )
  }
}

function assertPlacementReview(report: ReportRow, event: ActionLogEntry): void {
  const parsed = parseStoredReportContent(report, event)
  if (!parsed.valid) {
    throw new ReportReducerError('STATE_CONFLICT', `${event.event_type} (${event.event_id}) report content is no longer valid`)
  }
  if (parsed.value.placement_advice.enabled && (!report.placement_review_by || !report.placement_review_at)) {
    throw new ReportReducerError('STATE_CONFLICT', `${event.event_type} (${event.event_id}) requires placement review`)
  }
}

function parseStoredReportContent(report: ReportRow, event: ActionLogEntry) {
  try {
    return parseReportContent(JSON.parse(report.report_content_json) as unknown)
  } catch {
    throw new ReportReducerError('STATE_CONFLICT', `${event.event_type} (${event.event_id}) report content is not JSON`)
  }
}

function setReportsStatus(
  db: DBAdapter,
  reportIds: string[],
  status: 'SUPERSEDED' | 'ARCHIVED',
  event: ActionLogEntry
): void {
  for (const reportId of reportIds) {
    const report = requireReport(db, reportId, event)
    if (report.status === status) continue
    if (!['GENERATED', 'EXPORTED', 'LOCKED'].includes(report.status)) {
      throw new ReportReducerError('STATE_CONFLICT', `${event.event_type} (${event.event_id}) cannot ${status.toLowerCase()} report ${reportId}`)
    }
    db.prepare(
      'UPDATE task_report SET status = ?, last_applied_event_id = ? WHERE report_id = ?'
    ).run(status, event.event_id, reportId)
  }
}

function supersedeClosures(db: DBAdapter, closureIds: string[], event: ActionLogEntry): void {
  for (const closureId of closureIds) {
    const closure = requireClosure(db, closureId, event)
    if (closure.status === 'SUPERSEDED') continue
    if (closure.status !== 'CONFIRMED' || closure.is_cycle_head !== 1) {
      throw new ReportReducerError('STATE_CONFLICT', `${event.event_type} (${event.event_id}) cannot supersede closure ${closureId}`)
    }
    db.prepare(
      `UPDATE task_closure
          SET status = 'SUPERSEDED', is_cycle_head = 0, last_applied_event_id = ?, updated_at = datetime('now')
        WHERE task_closure_id = ?`
    ).run(event.event_id, closureId)
  }
}

function insertClosure(
  db: DBAdapter,
  event: ActionLogEntry,
  payload: TaskClosureConfirmedPayload | TaskClosureReplacedPayload,
  params: { closureId: string; replacesClosureId: string | null; confirmedBy: string; confirmedAt: string; correctionReason: string | null }
): void {
  const snapshots = payload.task_result_snapshots
  db.prepare(
    `INSERT INTO task_closure (
       task_closure_id, student_id, job_code, task_code, cycle_no, closure_revision, status, is_cycle_head,
       ability_result_id, training_completion_result_id, operation_pass_rate_result_id,
       ability_source_aggregate_id, training_source_aggregate_id, operation_source_aggregate_id,
       replaces_task_closure_id, correction_reason, confirmed_by, confirmed_event_id, confirmed_at, last_applied_event_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    params.closureId,
    payload.student_id,
    payload.job_code,
    payload.task_code,
    payload.cycle_no,
    payload.closure_revision,
    payload.status,
    payload.is_cycle_head ? 1 : 0,
    payload.source_result_ids[0],
    payload.source_result_ids[1],
    payload.source_result_ids[2],
    snapshots[0].source_aggregate_id,
    snapshots[1].source_aggregate_id,
    snapshots[2].source_aggregate_id,
    params.replacesClosureId,
    params.correctionReason,
    params.confirmedBy,
    event.event_id,
    params.confirmedAt,
    event.event_id
  )
}

function assertClosureFacts(
  closure: ClosureRow,
  payload: Pick<TaskClosureConfirmedPayload | TaskClosureReplacedPayload, 'student_id' | 'job_code' | 'task_code' | 'cycle_no' | 'closure_revision'>,
  event: ActionLogEntry
): void {
  if (
    closure.student_id !== payload.student_id
    || closure.job_code !== payload.job_code
    || closure.task_code !== payload.task_code
    || closure.cycle_no !== payload.cycle_no
    || closure.closure_revision !== payload.closure_revision
  ) {
    throw new ReportReducerError('PROJECTION_CONFLICT', `${event.event_type} (${event.event_id}) conflicts with an existing closure`)
  }
}

function applyTaskClosureConfirmed(db: DBAdapter, event: ActionLogEntry, payload: TaskClosureConfirmedPayload): void {
  assertAggregate(event, 'TASK_CLOSURE', payload.task_closure_id)
  assertActor(event, payload.confirmed_by, ['TEACHER'])
  if (!isAllowedTaskClosureConfirmedState(payload.status, payload.is_cycle_head)) {
    throw new ReportReducerError('INVALID_F7_EVENT', 'TASK_CLOSURE_CONFIRMED must create the active closure head')
  }

  const existing = db.prepare('SELECT * FROM task_closure WHERE task_closure_id = ?').get(payload.task_closure_id) as ClosureRow | undefined
  if (existing) {
    if (existing.confirmed_event_id !== event.event_id) {
      throw new ReportReducerError('PROJECTION_CONFLICT', `TASK_CLOSURE_CONFIRMED conflicts with ${payload.task_closure_id}`)
    }
    assertClosureFacts(existing, payload, event)
  } else {
    // The partial head index requires old heads to leave before the new head is inserted.
    supersedeClosures(db, payload.superseded_task_closure_ids, event)
    insertClosure(db, event, payload, {
      closureId: payload.task_closure_id,
      replacesClosureId: null,
      confirmedBy: payload.confirmed_by,
      confirmedAt: payload.confirmed_at,
      correctionReason: null
    })
  }
  setReportsStatus(db, payload.superseded_report_ids, 'SUPERSEDED', event)
}

function applyTaskClosureReplaced(db: DBAdapter, event: ActionLogEntry, payload: TaskClosureReplacedPayload): void {
  assertAggregate(event, 'TASK_CLOSURE', payload.new_task_closure_id)
  assertActor(event, payload.replaced_by, ['TEACHER'])
  if (!isAllowedTaskClosureReplacementState(payload.status, payload.is_cycle_head)) {
    throw new ReportReducerError('INVALID_F7_EVENT', 'TASK_CLOSURE_REPLACED status and head flag disagree')
  }

  const oldClosure = requireClosure(db, payload.old_task_closure_id, event)
  if (
    oldClosure.student_id !== payload.student_id
    || oldClosure.job_code !== payload.job_code
    || oldClosure.task_code !== payload.task_code
    || oldClosure.cycle_no !== payload.cycle_no
  ) {
    throw new ReportReducerError('STATE_CONFLICT', `TASK_CLOSURE_REPLACED (${event.event_id}) old closure business key changed`)
  }
  if (payload.closure_revision !== oldClosure.closure_revision + 1) {
    throw new ReportReducerError('STATE_CONFLICT', `TASK_CLOSURE_REPLACED (${event.event_id}) must increment the direct revision by one`)
  }

  const existing = db.prepare('SELECT * FROM task_closure WHERE task_closure_id = ?').get(payload.new_task_closure_id) as ClosureRow | undefined
  if (existing) {
    if (existing.confirmed_event_id !== event.event_id) {
      throw new ReportReducerError('PROJECTION_CONFLICT', `TASK_CLOSURE_REPLACED conflicts with ${payload.new_task_closure_id}`)
    }
    assertClosureFacts(existing, payload, event)
  } else {
    if (payload.status === 'CONFIRMED') {
      if (oldClosure.status !== 'CONFIRMED' || oldClosure.is_cycle_head !== 1) {
        throw new ReportReducerError('STATE_CONFLICT', `TASK_CLOSURE_REPLACED (${event.event_id}) requires the current closure head`)
      }
      db.prepare(
        `UPDATE task_closure
            SET status = 'SUPERSEDED', is_cycle_head = 0, last_applied_event_id = ?, updated_at = datetime('now')
          WHERE task_closure_id = ?`
      ).run(event.event_id, payload.old_task_closure_id)
    } else if (oldClosure.status !== 'SUPERSEDED' || oldClosure.is_cycle_head !== 0) {
      throw new ReportReducerError('STATE_CONFLICT', `TASK_CLOSURE_REPLACED (${event.event_id}) historical replacement requires a superseded closure`)
    }

    insertClosure(db, event, payload, {
      closureId: payload.new_task_closure_id,
      replacesClosureId: payload.old_task_closure_id,
      confirmedBy: payload.replaced_by,
      confirmedAt: payload.replaced_at,
      correctionReason: payload.correction_reason
    })
    db.prepare(
      'UPDATE task_closure SET replacement_task_closure_id = ?, last_applied_event_id = ?, updated_at = datetime(\'now\') WHERE task_closure_id = ?'
    ).run(payload.new_task_closure_id, event.event_id, payload.old_task_closure_id)
  }
  setReportsStatus(db, payload.archived_report_ids, 'ARCHIVED', event)
}

function applyReportGenerated(db: DBAdapter, event: ActionLogEntry, payload: ReportGeneratedV2Payload): void {
  assertAggregate(event, 'TASK_REPORT', payload.report_id)
  assertActor(event, payload.generated_by, ['TEACHER', 'SYSTEM'])
  const existing = db.prepare('SELECT * FROM task_report WHERE report_id = ?').get(payload.report_id) as ReportRow | undefined
  if (existing) {
    if (existing.generated_event_id !== event.event_id) {
      throw new ReportReducerError('PROJECTION_CONFLICT', `REPORT_GENERATED conflicts with ${payload.report_id}`)
    }
  } else {
    // The lineage partial index permits at most one active snapshot, so retire it first.
    setReportsStatus(db, payload.superseded_report_ids, 'SUPERSEDED', event)
    db.prepare(
      `INSERT INTO task_report (
         report_id, report_type, student_id, source_aggregate_type, source_aggregate_id,
         source_result_ids_json, report_title, report_content_json, generated_event_id, generated_by, generated_at,
         task_closure_id, repair_of_report_id, lineage_key, source_set_hash, generation_key, content_hash,
         report_revision, report_schema_version, report_builder_version, generation_reason,
         contract_validation_status, last_applied_event_id, status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'VALID', ?, 'GENERATED')`
    ).run(
      payload.report_id,
      payload.report_type,
      payload.student_id,
      payload.source_aggregate_type,
      payload.source_aggregate_id,
      JSON.stringify(payload.result_ids),
      payload.report_title,
      JSON.stringify(payload.report_content),
      event.event_id,
      payload.generated_by,
      payload.generated_at,
      payload.task_closure_id,
      payload.repair_of_report_id,
      payload.lineage_key,
      payload.source_set_hash,
      payload.generation_key,
      payload.content_hash,
      payload.report_revision,
      payload.report_schema_version,
      payload.report_builder_version,
      payload.generation_reason,
      event.event_id
    )
  }
  setReportsStatus(db, payload.superseded_report_ids, 'SUPERSEDED', event)
}

function applyPlacementReview(
  db: DBAdapter,
  event: ActionLogEntry,
  payload: Extract<F7EventPayload, { placement_advice_hash: string }>
): void {
  assertAggregate(event, 'TASK_REPORT', payload.report_id)
  assertActor(event, payload.reviewed_by, ['TEACHER'])
  const report = requireReport(db, payload.report_id, event)
  if (report.placement_review_by !== null || report.placement_review_at !== null) {
    if (report.placement_review_by === payload.reviewed_by && report.placement_review_at === payload.reviewed_at) return
    throw new ReportReducerError('STATE_CONFLICT', `PLACEMENT_REVIEW_CONFIRMED (${event.event_id}) conflicts with an existing review`)
  }
  assertActiveReport(report, event)
  if (report.contract_validation_status !== 'VALID') {
    throw new ReportReducerError('STATE_CONFLICT', `PLACEMENT_REVIEW_CONFIRMED (${event.event_id}) requires a valid contract`)
  }
  const parsed = parseStoredReportContent(report, event)
  if (!parsed.valid || sha256CanonicalJson(parsed.value.placement_advice) !== payload.placement_advice_hash) {
    throw new ReportReducerError('STATE_CONFLICT', `PLACEMENT_REVIEW_CONFIRMED (${event.event_id}) placement advice hash mismatch`)
  }
  db.prepare(
    `UPDATE task_report
        SET placement_review_by = ?, placement_review_at = ?, last_applied_event_id = ?
      WHERE report_id = ?`
  ).run(payload.reviewed_by, payload.reviewed_at, event.event_id, payload.report_id)
}

function applyReportLocked(db: DBAdapter, event: ActionLogEntry, payload: ReportLockedV2Payload): void {
  assertAggregate(event, 'TASK_REPORT', payload.report_id)
  assertActor(event, payload.locked_by, ['TEACHER'])
  const report = requireReport(db, payload.report_id, event)
  if (report.last_applied_event_id === event.event_id) return
  assertReportStatus(report, payload.status_before, event)
  assertReportContractAndHash(report, payload.content_hash, event)
  assertPlacementReview(report, event)
  db.prepare(
    `UPDATE task_report
        SET status = 'LOCKED', last_applied_event_id = ?
      WHERE report_id = ?`
  ).run(event.event_id, payload.report_id)
}

function applyReportExported(db: DBAdapter, event: ActionLogEntry, payload: ReportExportedV2Payload): void {
  assertAggregate(event, 'TASK_REPORT', payload.report_id)
  assertActor(event, payload.exported_by, ['TEACHER'])
  if (!isAllowedReportExportTransition(payload.status_before, payload.status_after)) {
    throw new ReportReducerError('INVALID_F7_EVENT', 'REPORT_EXPORTED has an invalid report status transition')
  }
  const report = requireReport(db, payload.report_id, event)
  if (report.last_applied_event_id === event.event_id) return
  assertReportStatus(report, payload.status_before, event)
  assertReportContractAndHash(report, payload.content_hash, event)
  assertPlacementReview(report, event)

  const asset = db.prepare('SELECT asset_type, asset_role, app_uri, local_path, mime_type, file_hash, file_size_bytes FROM asset_resource WHERE asset_id = ?')
    .get(payload.file_asset_id) as {
      asset_type: string
      asset_role: string | null
      app_uri: string
      local_path: string
      mime_type: string | null
      file_hash: string
      file_size_bytes: number
    } | undefined
  if (asset) {
    if (
      asset.asset_type !== 'OTHER' || asset.asset_role !== 'REPORT_FILE'
      || asset.app_uri !== `app://asset/${payload.file_asset_id}` || asset.local_path !== payload.export_path
      || asset.mime_type !== payload.mime_type || asset.file_hash !== payload.file_hash
      || asset.file_size_bytes !== payload.file_size_bytes
    ) {
      throw new ReportReducerError('PROJECTION_CONFLICT', `REPORT_EXPORTED (${event.event_id}) asset facts conflict`)
    }
  } else {
    db.prepare(
      `INSERT INTO asset_resource
         (asset_id, asset_type, asset_role, app_uri, local_path, mime_type, file_hash, file_size_bytes, status, last_verified_at)
       VALUES (?, 'OTHER', 'REPORT_FILE', ?, ?, ?, ?, ?, 'ACTIVE', ?)`
    ).run(
      payload.file_asset_id,
      `app://asset/${payload.file_asset_id}`,
      payload.export_path,
      payload.mime_type,
      payload.file_hash,
      payload.file_size_bytes,
      payload.exported_at
    )
  }
  db.prepare(
    `UPDATE task_report
        SET file_asset_id = ?, file_path = ?, file_hash = ?, status = ?, last_applied_event_id = ?
      WHERE report_id = ?`
  ).run(
    payload.file_asset_id,
    payload.export_path,
    payload.file_hash,
    payload.status_after,
    event.event_id,
    payload.report_id
  )
}

function applySafetyIncidentVoided(db: DBAdapter, event: ActionLogEntry, payload: SafetyIncidentVoidedV2Payload): void {
  assertAggregate(event, 'SAFETY_INCIDENT', payload.incident_id)
  assertActor(event, payload.voided_by, ['ADMIN'])
  const incident = requireSafetyIncident(db, payload.incident_id, event)
  if (incident.status === 'VOIDED') {
    if (incident.void_reason !== payload.void_reason || incident.replacement_incident_id !== payload.replacement_incident_id) {
      throw new ReportReducerError('PROJECTION_CONFLICT', `SAFETY_INCIDENT_VOIDED (${event.event_id}) conflicts with the existing incident`)
    }
  } else {
    if (!['PENDING_DETAIL', 'CONFIRMED'].includes(incident.status)) {
      throw new ReportReducerError('STATE_CONFLICT', `SAFETY_INCIDENT_VOIDED (${event.event_id}) cannot void ${incident.status}`)
    }
    db.prepare(
      `UPDATE safety_incident
          SET status = 'VOIDED', void_reason = ?, replacement_incident_id = ?,
              resolved_by = ?, resolved_at = ?, requires_review_before_next_session = 0, updated_at = datetime('now')
        WHERE incident_id = ?`
    ).run(
      payload.void_reason,
      payload.replacement_incident_id,
      payload.voided_by,
      payload.voided_at,
      payload.incident_id
    )
  }
  setReportsStatus(db, payload.archived_report_ids, 'ARCHIVED', event)
  setReportsStatus(db, payload.superseded_report_ids, 'SUPERSEDED', event)
}

function applySafetyIncidentFactualCorrection(
  db: DBAdapter,
  event: ActionLogEntry,
  payload: SafetyIncidentReplacedForFactualCorrectionV2Payload
): void {
  assertAggregate(event, 'SAFETY_INCIDENT', payload.old_incident_id)
  assertActor(event, payload.replaced_by, ['ADMIN'])
  const oldIncident = requireSafetyIncident(db, payload.old_incident_id, event)
  if (
    oldIncident.student_id !== payload.student_id
    || oldIncident.job_code !== payload.job_code
    || oldIncident.task_code !== payload.task_code
  ) {
    throw new ReportReducerError('STATE_CONFLICT', `Factual correction (${event.event_id}) old incident business key changed`)
  }
  const newIncident = db.prepare('SELECT * FROM safety_incident WHERE incident_id = ?').get(payload.new_incident_id) as SafetyIncidentRow | undefined

  if (oldIncident.status === 'VOIDED') {
    if (
      oldIncident.void_reason !== 'FACTUAL_CORRECTION'
      || oldIncident.replacement_incident_id !== payload.new_incident_id
      || !newIncident
      || newIncident.trigger_event_id !== event.event_id
    ) {
      throw new ReportReducerError('PROJECTION_CONFLICT', `Factual correction (${event.event_id}) conflicts with existing safety facts`)
    }
  } else {
    if (oldIncident.status !== 'CONFIRMED' || payload.old_status !== 'CONFIRMED') {
      throw new ReportReducerError('STATE_CONFLICT', `Factual correction (${event.event_id}) only permits CONFIRMED incidents`)
    }
    if (newIncident) {
      throw new ReportReducerError('PROJECTION_CONFLICT', `Factual correction (${event.event_id}) replacement incident already exists`)
    }
    // Insert first: its trigger preserves the safety-first redline halt before fact confirmation.
    db.prepare(
      `INSERT INTO safety_incident
         (incident_id, student_id, job_code, task_code, trigger_event_id, reason_code, description,
          triggered_by, context_phase, occurred_at, status, requires_review_before_next_session)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_DETAIL', 1)`
    ).run(
      payload.new_incident_id,
      payload.student_id,
      payload.job_code,
      payload.task_code,
      event.event_id,
      payload.reason_code,
      payload.full_description,
      payload.triggered_by,
      payload.context_phase,
      payload.occurred_at
    )
    db.prepare(
      `UPDATE safety_incident
          SET status = 'CONFIRMED', confirmed_by = ?, updated_at = datetime('now')
        WHERE incident_id = ?`
    ).run(payload.confirmed_by, payload.new_incident_id)
    db.prepare(
      `UPDATE safety_incident
          SET status = 'VOIDED', void_reason = 'FACTUAL_CORRECTION', replacement_incident_id = ?,
              resolved_by = ?, resolved_at = ?, requires_review_before_next_session = 0, updated_at = datetime('now')
        WHERE incident_id = ?`
    ).run(payload.new_incident_id, payload.replaced_by, payload.replaced_at, payload.old_incident_id)
  }
  setReportsStatus(db, payload.superseded_report_ids, 'SUPERSEDED', event)
}
