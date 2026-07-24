import { ipcMain } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import type { DBAdapter } from '../../db/interface'
import { SqliteAdapter } from '../../db/sqlite-adapter'
import { getDatabase } from '../../db/connection'
import { assertCaller } from '../../utils/auth-context'
import { resolveTrustedAuthSessionCaller } from '../../utils/auth-session'
import { writeEvent } from '../../domain/event-writer'
import {
  SAFETY_CONTEXT_PHASES,
  SAFETY_REASON_CODES
} from '../../../shared/types/safety'
import type {
  SafetyIncidentCreatedPayload,
  SafetyIncidentDetailConfirmedPayload,
  SafetyIncidentResolvedPayload,
  SafetyIncidentVoidedPayload,
  SafetyIncidentReplacedPayload
} from '../../../shared/types/event-payloads'
import type {
  ConfirmSafetyIncidentParams,
  ResolveSafetyIncidentParams,
  VoidSafetyIncidentParams,
  ReplaceSafetyIncidentParams,
  SafetyIncidentMutationResult,
  ListSafetyIncidentsParams,
  ListSafetyIncidentsResult,
  GetSafetyIncidentParams,
  GetSafetyIncidentResult,
  SafetyIncidentStatus,
  SafetyIncidentView
} from '../../../shared/types/safety-incident'

const reasonCodes = new Set(SAFETY_REASON_CODES.map((item) => item.value))
const contextPhases = new Set(SAFETY_CONTEXT_PHASES.map((item) => item.value))
const incidentStatuses = new Set<SafetyIncidentStatus>([
  'PENDING_DETAIL', 'CONFIRMED', 'RESOLVED', 'VOIDED'
])

type SafetyRow = {
  incident_id: string
  student_id: string
  job_code: string
  task_code: string
  status: string
  reason_code: string
  context_phase: string
  description: string | null
}

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

function defaultGetDb(): DBAdapter {
  return new SqliteAdapter(getDatabase())
}

function readIncident(db: DBAdapter, incidentId: string): SafetyRow | undefined {
  return db.prepare(
    `SELECT incident_id, student_id, job_code, task_code, status, reason_code, context_phase, description
       FROM safety_incident WHERE incident_id = ?`
  ).get(incidentId) as SafetyRow | undefined
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
  if (!isNonEmptyString(params.incidentId)) return { success: false, errorCode: 'NOT_FOUND' }
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

function requireRole(
  db: DBAdapter,
  userId: unknown,
  role: unknown,
  required: 'TEACHER' | 'ADMIN'
): string | null {
  const caller = assertCaller(db, userId, role)
  return caller.ok && caller.row.role === required ? caller.row.user_id : null
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function confirmSafetyIncident(
  db: DBAdapter,
  params: ConfirmSafetyIncidentParams
): SafetyIncidentMutationResult {
  const teacherId = requireRole(db, params.callerUserId, params.callerRole, 'TEACHER')
  if (!teacherId) return { success: false, errorCode: 'FORBIDDEN' }
  const incident = readIncident(db, params.incidentId)
  if (!incident) return { success: false, errorCode: 'NOT_FOUND' }
  if (incident.status !== 'PENDING_DETAIL') return { success: false, errorCode: 'INVALID_STATE' }
  if (!reasonCodes.has(params.reasonCode) || !contextPhases.has(params.contextPhase) || !isNonEmptyString(params.description)) {
    return { success: false, errorCode: 'VALIDATION_ERROR' }
  }
  const confirmedAt = new Date().toISOString()
  try {
    db.transaction(() => {
      const payload: SafetyIncidentDetailConfirmedPayload = {
        incident_id: incident.incident_id,
        confirmed_at: confirmedAt,
        confirmed_by: teacherId,
        reason_code: params.reasonCode,
        context_phase: params.contextPhase,
        full_description: params.description.trim()
      }
      writeEvent({
        aggregateType: 'SAFETY_INCIDENT', aggregateId: incident.incident_id,
        eventType: 'SAFETY_INCIDENT_DETAIL_CONFIRMED',
        payload: payload as unknown as Record<string, unknown>, actorId: teacherId, actorRole: 'TEACHER'
      })
      db.prepare(
        `UPDATE safety_incident
            SET reason_code = ?, context_phase = ?, description = ?, confirmed_by = ?,
                status = 'CONFIRMED', updated_at = datetime('now')
          WHERE incident_id = ?`
      ).run(params.reasonCode, params.contextPhase, params.description.trim(), teacherId, incident.incident_id)
    })()
  } catch {
    return { success: false, errorCode: 'SAFETY_SYSTEM_ERROR' }
  }
  return { success: true, incidentId: incident.incident_id }
}

export function resolveSafetyIncident(
  db: DBAdapter,
  params: ResolveSafetyIncidentParams
): SafetyIncidentMutationResult {
  const adminId = requireRole(db, params.callerUserId, params.callerRole, 'ADMIN')
  if (!adminId) return { success: false, errorCode: 'FORBIDDEN' }
  const incident = readIncident(db, params.incidentId)
  if (!incident) return { success: false, errorCode: 'NOT_FOUND' }
  if (incident.status !== 'CONFIRMED') return { success: false, errorCode: 'INVALID_STATE' }
  if (!isNonEmptyString(params.resolutionNotes)) return { success: false, errorCode: 'VALIDATION_ERROR' }
  const resolvedAt = new Date().toISOString()
  try {
    db.transaction(() => {
      const payload: SafetyIncidentResolvedPayload = {
        incident_id: incident.incident_id, resolved_at: resolvedAt, resolved_by: adminId,
        resolution_notes: params.resolutionNotes.trim(), follow_up_required: params.followUpRequired
      }
      writeEvent({
        aggregateType: 'SAFETY_INCIDENT', aggregateId: incident.incident_id,
        eventType: 'SAFETY_INCIDENT_RESOLVED',
        payload: payload as unknown as Record<string, unknown>, actorId: adminId, actorRole: 'ADMIN'
      })
      db.prepare(
        `UPDATE safety_incident
            SET status = 'RESOLVED', resolved_by = ?, resolved_at = ?,
                requires_review_before_next_session = 0, updated_at = datetime('now')
          WHERE incident_id = ?`
      ).run(adminId, resolvedAt, incident.incident_id)
    })()
  } catch {
    return { success: false, errorCode: 'SAFETY_SYSTEM_ERROR' }
  }
  return { success: true, incidentId: incident.incident_id }
}

function voidIncident(
  db: DBAdapter,
  params: { incident: SafetyRow; adminId: string; reason: SafetyIncidentVoidedPayload['void_reason']; notes?: string | null; replacementIncidentId?: string | null }
): void {
  const voidedAt = new Date().toISOString()
  const payload: SafetyIncidentVoidedPayload = {
    incident_id: params.incident.incident_id,
    voided_at: voidedAt,
    voided_by: params.adminId,
    void_reason: params.reason,
    void_notes: params.notes ?? null,
    replacement_incident_id: params.replacementIncidentId ?? null
  }
  writeEvent({
    aggregateType: 'SAFETY_INCIDENT', aggregateId: params.incident.incident_id,
    eventType: 'SAFETY_INCIDENT_VOIDED', payload: payload as unknown as Record<string, unknown>,
    actorId: params.adminId, actorRole: 'ADMIN'
  })
  db.prepare(
    `UPDATE safety_incident
        SET status = 'VOIDED', void_reason = ?, replacement_incident_id = ?,
            resolved_by = ?, resolved_at = ?, requires_review_before_next_session = 0,
            updated_at = datetime('now')
      WHERE incident_id = ?`
  ).run(params.reason, params.replacementIncidentId ?? null, params.adminId, voidedAt, params.incident.incident_id)
}

export function voidSafetyIncident(
  db: DBAdapter,
  params: VoidSafetyIncidentParams
): SafetyIncidentMutationResult {
  const adminId = requireRole(db, params.callerUserId, params.callerRole, 'ADMIN')
  if (!adminId) return { success: false, errorCode: 'FORBIDDEN' }
  const incident = readIncident(db, params.incidentId)
  if (!incident) return { success: false, errorCode: 'NOT_FOUND' }
  if (!['PENDING_DETAIL', 'CONFIRMED'].includes(incident.status)) return { success: false, errorCode: 'INVALID_STATE' }
  if (!['FALSE_TRIGGER', 'DUPLICATE_RECORD', 'NON_SAFETY_EVENT'].includes(params.voidReason)) {
    return { success: false, errorCode: 'VALIDATION_ERROR' }
  }
  let replacementIncidentId: string | null = null
  if (params.voidReason === 'DUPLICATE_RECORD') {
    if (!isNonEmptyString(params.replacementIncidentId) || params.replacementIncidentId === incident.incident_id) {
      return { success: false, errorCode: 'VALIDATION_ERROR' }
    }
    const replacement = readIncident(db, params.replacementIncidentId)
    if (!replacement || replacement.student_id !== incident.student_id || replacement.task_code !== incident.task_code) {
      return { success: false, errorCode: 'VALIDATION_ERROR' }
    }
    replacementIncidentId = replacement.incident_id
  } else if (params.replacementIncidentId) {
    return { success: false, errorCode: 'VALIDATION_ERROR' }
  }
  try {
    db.transaction(() => voidIncident(db, {
      incident, adminId, reason: params.voidReason, notes: params.voidNotes, replacementIncidentId
    }))()
  } catch {
    return { success: false, errorCode: 'SAFETY_SYSTEM_ERROR' }
  }
  return { success: true, incidentId: incident.incident_id }
}

export function replaceSafetyIncidentForFactualCorrection(
  db: DBAdapter,
  params: ReplaceSafetyIncidentParams
): SafetyIncidentMutationResult {
  const adminId = requireRole(db, params.callerUserId, params.callerRole, 'ADMIN')
  if (!adminId) return { success: false, errorCode: 'FORBIDDEN' }
  const incident = readIncident(db, params.incidentId)
  if (!incident) return { success: false, errorCode: 'NOT_FOUND' }
  if (incident.status !== 'CONFIRMED') return { success: false, errorCode: 'INVALID_STATE' }
  if (!reasonCodes.has(params.reasonCode) || !contextPhases.has(params.contextPhase) || !isNonEmptyString(params.description) || !isNonEmptyString(params.correctionReason)) {
    return { success: false, errorCode: 'VALIDATION_ERROR' }
  }
  const replacementId = uuidv4()
  const occurredAt = new Date().toISOString()
  try {
    db.transaction(() => {
      const createdPayload: SafetyIncidentCreatedPayload = {
        incident_id: replacementId, student_id: incident.student_id, job_code: incident.job_code,
        task_code: incident.task_code, reason_code: params.reasonCode, context_phase: params.contextPhase,
        occurred_at: occurredAt, reported_by: adminId, brief_description: params.description.trim()
      }
      const created = writeEvent({
        aggregateType: 'SAFETY_INCIDENT', aggregateId: replacementId,
        eventType: 'SAFETY_INCIDENT_CREATED', payload: createdPayload as unknown as Record<string, unknown>,
        actorId: adminId, actorRole: 'ADMIN'
      })
      db.prepare(
        `INSERT INTO safety_incident
           (incident_id, student_id, job_code, task_code, trigger_event_id, reason_code,
            description, triggered_by, context_phase, occurred_at, status, requires_review_before_next_session)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_DETAIL', 1)`
      ).run(replacementId, incident.student_id, incident.job_code, incident.task_code, created.event_id,
        params.reasonCode, params.description.trim(), adminId, params.contextPhase, occurredAt)
      const replacementPayload: SafetyIncidentReplacedPayload = {
        old_incident_id: incident.incident_id, new_incident_id: replacementId,
        replaced_at: occurredAt, replaced_by: adminId, correction_reason: params.correctionReason.trim()
      }
      writeEvent({
        aggregateType: 'SAFETY_INCIDENT', aggregateId: incident.incident_id,
        eventType: 'SAFETY_INCIDENT_REPLACED_FOR_FACTUAL_CORRECTION',
        payload: replacementPayload as unknown as Record<string, unknown>, actorId: adminId, actorRole: 'ADMIN'
      })
      voidIncident(db, {
        incident, adminId, reason: 'FACTUAL_CORRECTION', notes: params.correctionReason.trim(), replacementIncidentId: replacementId
      })
    })()
  } catch {
    return { success: false, errorCode: 'SAFETY_SYSTEM_ERROR' }
  }
  return { success: true, incidentId: replacementId }
}

export function registerSafetyHandlers(getDb: () => DBAdapter = defaultGetDb): void {
  function withTrusted<T extends { callerUserId: string; callerRole: string }, R>(
    event: Electron.IpcMainInvokeEvent,
    params: T,
    run: (db: DBAdapter, trusted: T) => R
  ): R | SafetyIncidentMutationResult {
    const db = getDb()
    const trusted = resolveTrustedAuthSessionCaller(db, event.sender.id, params)
    if (!trusted.ok) return { success: false, errorCode: 'FORBIDDEN' }
    return run(db, trusted.params)
  }
  ipcMain.handle('safety:confirm', (event, params: ConfirmSafetyIncidentParams) =>
    withTrusted(event, params, confirmSafetyIncident))
  ipcMain.handle('safety:resolve', (event, params: ResolveSafetyIncidentParams) =>
    withTrusted(event, params, resolveSafetyIncident))
  ipcMain.handle('safety:void', (event, params: VoidSafetyIncidentParams) =>
    withTrusted(event, params, voidSafetyIncident))
  ipcMain.handle('safety:replaceForFactualCorrection', (event, params: ReplaceSafetyIncidentParams) =>
    withTrusted(event, params, replaceSafetyIncidentForFactualCorrection))
  ipcMain.handle('safety:list', (event, params: ListSafetyIncidentsParams) =>
    withTrusted(event, params, listSafetyIncidents))
  ipcMain.handle('safety:get', (event, params: GetSafetyIncidentParams) =>
    withTrusted(event, params, getSafetyIncident))
}
