import { ipcMain } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import type { DBAdapter } from '../../db/interface'
import { SqliteAdapter } from '../../db/sqlite-adapter'
import { getDatabase } from '../../db/connection'
import { assertCaller } from '../../utils/auth-context'
import { resolveTrustedAuthSessionCaller } from '../../utils/auth-session'
import { writeEvent } from '../../domain/event-writer'
import { getActionLogPath } from '../../domain/action-log-path'
import { ReportCommandCoordinator, type F7EventIntent, type ReportCommandKey } from '../../domain/report-command-coordinator'
import { ReportService } from '../../domain/report-service'
import {
  SAFETY_CONTEXT_PHASES,
  SAFETY_REASON_CODES
} from '../../../shared/types/safety'
import type {
  SafetyIncidentCreatedPayload,
  SafetyIncidentDetailConfirmedPayload,
  SafetyIncidentReplacedPayload,
  SafetyIncidentResolvedPayload,
  SafetyIncidentVoidedPayload,
  SafetyIncidentReplacedForFactualCorrectionV2Payload,
  SafetyIncidentVoidedV2Payload
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
  triggered_by: string
  occurred_at: string
  confirmed_by: string | null
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

export interface SafetyReportAutomation {
  generateSafetyReportFromIncident(incidentId: string, callerUserId: string): void
  runSafetyMutation<T>(
    key: ReportCommandKey,
    buildIntent: () => F7EventIntent | null,
    mapResult: (eventId: string | null) => T
  ): T
}

export function createSafetyReportAutomation(db: DBAdapter): SafetyReportAutomation {
  const coordinator = new ReportCommandCoordinator({ db, actionLogPath: getActionLogPath() })
  const service = new ReportService(db, coordinator)
  return {
    generateSafetyReportFromIncident(incidentId: string, callerUserId: string): void {
      service.generateSafetyReportFromIncidentSync(incidentId, callerUserId, 'SYSTEM')
    },
    runSafetyMutation<T>(
      key: ReportCommandKey,
      buildIntent: () => F7EventIntent | null,
      mapResult: (eventId: string | null) => T
    ): T {
      return coordinator.runSingleEventCommandSync({
        key,
        areas: ['SAFETY_INCIDENT', 'TASK_REPORT'],
        buildIntent,
        mapResult: (event) => mapResult(event?.event_id ?? null)
      })
    }
  }
}

function readIncident(db: DBAdapter, incidentId: string): SafetyRow | undefined {
  return db.prepare(
    `SELECT incident_id, student_id, job_code, task_code, status, reason_code, context_phase, description,
            triggered_by, occurred_at, confirmed_by
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
  params: ConfirmSafetyIncidentParams,
  automation?: SafetyReportAutomation
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
  tryGenerateSafetyReport(automation, incident.incident_id, teacherId)
  return { success: true, incidentId: incident.incident_id }
}

export function resolveSafetyIncident(
  db: DBAdapter,
  params: ResolveSafetyIncidentParams,
  automation?: SafetyReportAutomation
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
  tryGenerateSafetyReport(automation, incident.incident_id, adminId)
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
  params: VoidSafetyIncidentParams,
  automation?: SafetyReportAutomation
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
    if (
      !replacement
      || replacement.student_id !== incident.student_id
      || replacement.job_code !== incident.job_code
      || replacement.task_code !== incident.task_code
    ) {
      return { success: false, errorCode: 'VALIDATION_ERROR' }
    }
    replacementIncidentId = replacement.incident_id
  } else if (params.replacementIncidentId) {
    return { success: false, errorCode: 'VALIDATION_ERROR' }
  }
  if (automation) {
    const voidedAt = new Date().toISOString()
    const activeReportIds = activeSafetyReportIds(db, incident.incident_id)
    const payload: SafetyIncidentVoidedV2Payload = {
      incident_id: incident.incident_id,
      voided_at: voidedAt,
      voided_by: adminId,
      void_reason: params.voidReason,
      void_notes: params.voidNotes ?? null,
      replacement_incident_id: replacementIncidentId,
      archived_report_ids: params.voidReason === 'DUPLICATE_RECORD' ? [] : activeReportIds,
      superseded_report_ids: params.voidReason === 'DUPLICATE_RECORD' ? activeReportIds : [],
      primary_incident_id: params.voidReason === 'DUPLICATE_RECORD' ? replacementIncidentId : null
    }
    try {
      return automation.runSafetyMutation(
        safetyCommandKey(incident),
        () => ({
          aggregateType: 'SAFETY_INCIDENT',
          aggregateId: incident.incident_id,
          eventType: 'SAFETY_INCIDENT_VOIDED',
          payload: payload as unknown as Record<string, unknown>,
          actorId: adminId,
          actorRole: 'ADMIN'
        }),
        () => ({ success: true, incidentId: incident.incident_id })
      )
    } catch (error) {
      console.error('[Safety] void failed:', error)
      return { success: false, errorCode: 'SAFETY_SYSTEM_ERROR' }
    }
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
  params: ReplaceSafetyIncidentParams,
  automation?: SafetyReportAutomation
): SafetyIncidentMutationResult {
  const adminId = requireRole(db, params.callerUserId, params.callerRole, 'ADMIN')
  if (!adminId) return { success: false, errorCode: 'FORBIDDEN' }
  const incident = readIncident(db, params.incidentId)
  if (!incident) return { success: false, errorCode: 'NOT_FOUND' }
  if (incident.status !== 'CONFIRMED') return { success: false, errorCode: 'INVALID_STATE' }
  const confirmedBy = incident.confirmed_by
  if (!confirmedBy) return { success: false, errorCode: 'SAFETY_SYSTEM_ERROR' }
  if (!reasonCodes.has(params.reasonCode) || !contextPhases.has(params.contextPhase) || !isNonEmptyString(params.description) || !isNonEmptyString(params.correctionReason)) {
    return { success: false, errorCode: 'VALIDATION_ERROR' }
  }
  const replacementId = uuidv4()
  const occurredAt = new Date().toISOString()
  if (automation) {
    const payload: SafetyIncidentReplacedForFactualCorrectionV2Payload = {
      root_incident_id: rootSafetyIncidentId(db, incident),
      old_incident_id: incident.incident_id,
      new_incident_id: replacementId,
      student_id: incident.student_id,
      job_code: incident.job_code,
      task_code: incident.task_code,
      reason_code: params.reasonCode,
      context_phase: params.contextPhase,
      full_description: params.description.trim(),
      occurred_at: occurredAt,
      triggered_by: adminId,
      // Factual correction is performed by an ADMIN, but a CONFIRMED incident
      // must retain the TEACHER who originally confirmed the safety facts.
      confirmed_by: confirmedBy,
      confirmed_at: occurredAt,
      old_status: 'CONFIRMED',
      old_status_after: 'VOIDED',
      void_reason: 'FACTUAL_CORRECTION',
      correction_reason: params.correctionReason.trim(),
      replaced_by: adminId,
      replaced_at: occurredAt,
      superseded_report_ids: activeSafetyReportIds(db, incident.incident_id)
    }
    try {
      return automation.runSafetyMutation(
        safetyCommandKey(incident),
        () => ({
          aggregateType: 'SAFETY_INCIDENT',
          aggregateId: incident.incident_id,
          eventType: 'SAFETY_INCIDENT_REPLACED_FOR_FACTUAL_CORRECTION',
          payload: payload as unknown as Record<string, unknown>,
          actorId: adminId,
          actorRole: 'ADMIN'
        }),
        () => ({ success: true, incidentId: replacementId })
      )
    } catch (error) {
      console.error('[Safety] factual correction failed:', error)
      return { success: false, errorCode: 'SAFETY_SYSTEM_ERROR' }
    }
  }
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

function tryGenerateSafetyReport(
  automation: SafetyReportAutomation | undefined,
  incidentId: string,
  callerUserId: string
): void {
  if (!automation) return
  try {
    automation.generateSafetyReportFromIncident(incidentId, callerUserId)
  } catch (error) {
    console.error('[Safety] report generation failed:', error)
  }
}

function activeSafetyReportIds(db: DBAdapter, incidentId: string): string[] {
  const rows = db.prepare(
    `SELECT report_id
       FROM task_report
      WHERE source_aggregate_type = 'SAFETY_INCIDENT'
        AND source_aggregate_id = ?
        AND status IN ('GENERATED', 'EXPORTED', 'LOCKED')
      ORDER BY report_revision ASC, report_id ASC`
  ).all(incidentId) as Array<{ report_id: string }>
  return rows.map((row) => row.report_id)
}

function rootSafetyIncidentId(_db: DBAdapter, incident: SafetyRow): string {
  return incident.incident_id
}

function safetyCommandKey(incident: SafetyRow): ReportCommandKey {
  return {
    studentId: incident.student_id,
    jobCode: incident.job_code,
    taskCode: incident.task_code,
    scope: 'SAFETY'
  }
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
    withTrusted(event, params, (db, trusted) => confirmSafetyIncident(db, trusted, createSafetyReportAutomation(db))))
  ipcMain.handle('safety:resolve', (event, params: ResolveSafetyIncidentParams) =>
    withTrusted(event, params, (db, trusted) => resolveSafetyIncident(db, trusted, createSafetyReportAutomation(db))))
  ipcMain.handle('safety:void', (event, params: VoidSafetyIncidentParams) =>
    withTrusted(event, params, (db, trusted) => voidSafetyIncident(db, trusted, createSafetyReportAutomation(db))))
  ipcMain.handle('safety:replaceForFactualCorrection', (event, params: ReplaceSafetyIncidentParams) =>
    withTrusted(event, params, (db, trusted) => replaceSafetyIncidentForFactualCorrection(db, trusted, createSafetyReportAutomation(db))))
  ipcMain.handle('safety:list', (event, params: ListSafetyIncidentsParams) =>
    withTrusted(event, params, listSafetyIncidents))
  ipcMain.handle('safety:get', (event, params: GetSafetyIncidentParams) =>
    withTrusted(event, params, getSafetyIncident))
}
