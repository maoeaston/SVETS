import type { DBAdapter } from '../../db/interface'
import { assertCaller } from '../../utils/auth-context'
import type {
  GetSafetyIncidentParams,
  GetSafetyIncidentResult,
  ListSafetyIncidentsParams,
  ListSafetyIncidentsResult,
  SafetyIncidentStatus,
  SafetyIncidentView
} from '../../../shared/types/safety-incident'

const incidentStatuses = new Set<SafetyIncidentStatus>([
  'PENDING_DETAIL', 'CONFIRMED', 'RESOLVED', 'VOIDED'
])

type SafetyViewRow = {
  incident_id: string
  student_id: string
  student_name: string
  job_code: string
  task_code: string
  status: string
  reason_code: string
  context_phase: string
  description: string | null
  occurred_at: string
  triggered_by: string
  triggered_by_name: string
  confirmed_by: string | null
  confirmed_by_name: string | null
  resolved_by: string | null
  resolved_by_name: string | null
  resolved_at: string | null
  void_reason: string | null
  replacement_incident_id: string | null
  requires_review_before_next_session: number
  binding_count: number
  created_at: string
  updated_at: string
}

function safetyViewSelect(): string {
  return `SELECT si.incident_id, si.student_id, sp.student_name, si.job_code, si.task_code,
                 si.status, si.reason_code, si.context_phase, si.description, si.occurred_at,
                 si.triggered_by, trigger_user.display_name AS triggered_by_name,
                 si.confirmed_by, confirm_user.display_name AS confirmed_by_name,
                 si.resolved_by, resolve_user.display_name AS resolved_by_name,
                 si.resolved_at, si.void_reason, si.replacement_incident_id,
                 si.requires_review_before_next_session,
                 (SELECT COUNT(*) FROM safety_incident_binding sib WHERE sib.incident_id = si.incident_id) AS binding_count,
                 si.created_at, si.updated_at
            FROM safety_incident si
            JOIN student_profile sp ON sp.student_id = si.student_id
            JOIN user_account trigger_user ON trigger_user.user_id = si.triggered_by
       LEFT JOIN user_account confirm_user ON confirm_user.user_id = si.confirmed_by
       LEFT JOIN user_account resolve_user ON resolve_user.user_id = si.resolved_by`
}

function mapSafetyView(row: SafetyViewRow): SafetyIncidentView {
  return {
    incidentId: row.incident_id,
    studentId: row.student_id,
    studentName: row.student_name,
    jobCode: row.job_code,
    taskCode: row.task_code,
    status: row.status as SafetyIncidentStatus,
    reasonCode: row.reason_code as SafetyIncidentView['reasonCode'],
    contextPhase: row.context_phase as SafetyIncidentView['contextPhase'],
    description: row.description,
    occurredAt: row.occurred_at,
    triggeredBy: row.triggered_by,
    triggeredByName: row.triggered_by_name,
    confirmedBy: row.confirmed_by,
    confirmedByName: row.confirmed_by_name,
    resolvedBy: row.resolved_by,
    resolvedByName: row.resolved_by_name,
    resolvedAt: row.resolved_at,
    voidReason: row.void_reason as SafetyIncidentView['voidReason'],
    replacementIncidentId: row.replacement_incident_id,
    requiresReviewBeforeNextSession: row.requires_review_before_next_session === 1,
    bindingCount: row.binding_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function requireReadRole(db: DBAdapter, userId: unknown, role: unknown): boolean {
  const caller = assertCaller(db, userId, role)
  return caller.ok && (caller.row.role === 'TEACHER' || caller.row.role === 'ADMIN')
}

export function listSafetyIncidents(
  db: DBAdapter,
  params: ListSafetyIncidentsParams
): ListSafetyIncidentsResult {
  if (!requireReadRole(db, params.callerUserId, params.callerRole)) {
    return { success: false, errorCode: 'FORBIDDEN' }
  }
  if (params.status && !incidentStatuses.has(params.status)) {
    return { success: false, errorCode: 'VALIDATION_ERROR' }
  }
  const limit = Number.isInteger(params.limit) && (params.limit ?? 0) > 0
    ? Math.min(params.limit as number, 100)
    : 50
  const offset = Number.isInteger(params.offset) && (params.offset ?? -1) >= 0
    ? params.offset as number
    : 0
  try {
    const rows = db.prepare(
      `${safetyViewSelect()}
       WHERE (si.status = ? OR ? IS NULL)
       ORDER BY CASE si.status WHEN 'PENDING_DETAIL' THEN 0 WHEN 'CONFIRMED' THEN 1 ELSE 2 END,
                si.occurred_at DESC, si.incident_id ASC
       LIMIT ? OFFSET ?`
    ).all(params.status ?? null, params.status ?? null, limit, offset) as SafetyViewRow[]
    const countRow = db.prepare(
      'SELECT COUNT(*) AS total FROM safety_incident WHERE (status = ? OR ? IS NULL)'
    ).get(params.status ?? null, params.status ?? null) as { total: number }
    return { success: true, items: rows.map(mapSafetyView), total: countRow.total }
  } catch (error) {
    console.error('[Safety] list failed:', error)
    return { success: false, errorCode: 'SAFETY_SYSTEM_ERROR' }
  }
}

export function getSafetyIncident(
  db: DBAdapter,
  params: GetSafetyIncidentParams
): GetSafetyIncidentResult {
  if (!requireReadRole(db, params.callerUserId, params.callerRole)) {
    return { success: false, errorCode: 'FORBIDDEN' }
  }
  if (typeof params.incidentId !== 'string' || !params.incidentId.trim()) {
    return { success: false, errorCode: 'NOT_FOUND' }
  }
  try {
    const row = db.prepare(
      `${safetyViewSelect()} WHERE si.incident_id = ?`
    ).get(params.incidentId) as SafetyViewRow | undefined
    return row
      ? { success: true, incident: mapSafetyView(row) }
      : { success: false, errorCode: 'NOT_FOUND' }
  } catch (error) {
    console.error('[Safety] get failed:', error)
    return { success: false, errorCode: 'SAFETY_SYSTEM_ERROR' }
  }
}
