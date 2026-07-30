// Safety incident lifecycle application service.

import { v4 as uuidv4 } from 'uuid'
import type { DBAdapter } from '../../db/interface'
import { assertCaller } from '../../utils/auth-context'
import type {
  F7EventIntent,
  ReportCommandCoordinator,
  ReportCommandKey,
  ReportMutationPort
} from '../../domain/report-command-coordinator'
import { ReportService } from '../../domain/report-service'
import type { AcceptedCommandContext } from '../command/command-types'
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
  SafetyIncidentMutationResult
} from '../../../shared/types/safety-incident'

const reasonCodes = new Set(SAFETY_REASON_CODES.map((item) => item.value))
const contextPhases = new Set(SAFETY_CONTEXT_PHASES.map((item) => item.value))

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

export interface SafetyReportAutomation {
  readonly coordinator?: ReportCommandCoordinator
  generateSafetyReportFromIncident(
    incidentId: string,
    callerUserId: string,
    correlationId: string
  ): void
  runSafetyMutation<T>(
    key: ReportCommandKey,
    buildIntent: () => F7EventIntent | null,
    mapResult: (eventId: string | null) => T
  ): T
}

export function createSafetyReportAutomation(
  db: DBAdapter,
  coordinator: ReportCommandCoordinator
): SafetyReportAutomation {
  const service = new ReportService(db, coordinator)
  return {
    coordinator,
    generateSafetyReportFromIncident(
      incidentId: string,
      callerUserId: string,
      correlationId: string
    ): void {
      service.generateSafetyReportFromIncidentSync(
        incidentId,
        callerUserId,
        'SYSTEM',
        correlationId
      )
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

export interface SafetyMutationExecution {
  readonly eventPort: Pick<ReportMutationPort, 'writeEvent'>
  readonly context: AcceptedCommandContext
  readonly automation?: SafetyReportAutomation
}

const SAFETY_MUTATION_COMMANDS = new Set([
  'safety:confirm',
  'safety:resolve',
  'safety:void',
  'safety:replaceForFactualCorrection'
])

function correlationFor(
  execution: SafetyMutationExecution,
  expectedCommandType: string,
  params: { callerUserId: string; callerRole: string }
): string {
  const { envelope } = execution.context
  if (!SAFETY_MUTATION_COMMANDS.has(expectedCommandType) || envelope.commandType !== expectedCommandType) {
    throw new Error(`safety mutation requires accepted ${expectedCommandType} context`)
  }
  if (!envelope.correlationId.trim()) throw new Error('safety mutation correlation must be non-empty')
  const actor = envelope.actor
  if (
    actor.kind !== 'USER'
    || actor.userId !== params.callerUserId
    || actor.role !== params.callerRole
  ) {
    throw new Error('safety mutation actor must match accepted context')
  }
  return envelope.correlationId
}

function assertAcceptedTarget(execution: SafetyMutationExecution, incident: SafetyRow): void {
  const target = execution.context.envelope.target
  const expected = {
    incident_id: incident.incident_id,
    student_id: incident.student_id,
    job_code: incident.job_code,
    task_code: incident.task_code
  }
  for (const [field, value] of Object.entries(expected)) {
    if (target[field] !== value) throw new Error(`safety mutation target mismatch: ${field}`)
  }
}

function readIncident(db: DBAdapter, incidentId: string): SafetyRow | undefined {
  return db.prepare(
    `SELECT incident_id, student_id, job_code, task_code, status, reason_code, context_phase, description,
            triggered_by, occurred_at, confirmed_by
       FROM safety_incident WHERE incident_id = ?`
  ).get(incidentId) as SafetyRow | undefined
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
  execution: SafetyMutationExecution
): SafetyIncidentMutationResult {
  const correlationId = correlationFor(execution, 'safety:confirm', params)
  const teacherId = requireRole(db, params.callerUserId, params.callerRole, 'TEACHER')
  if (!teacherId) return { success: false, errorCode: 'FORBIDDEN' }
  const incident = readIncident(db, params.incidentId)
  if (!incident) return { success: false, errorCode: 'NOT_FOUND' }
  assertAcceptedTarget(execution, incident)
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
      execution.eventPort.writeEvent({
        aggregateType: 'SAFETY_INCIDENT', aggregateId: incident.incident_id,
        eventType: 'SAFETY_INCIDENT_DETAIL_CONFIRMED',
        payload: payload as unknown as Record<string, unknown>, actorId: teacherId, actorRole: 'TEACHER',
        correlationId
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
  tryGenerateSafetyReport(execution.automation, incident.incident_id, teacherId, correlationId)
  return { success: true, incidentId: incident.incident_id }
}

export function resolveSafetyIncident(
  db: DBAdapter,
  params: ResolveSafetyIncidentParams,
  execution: SafetyMutationExecution
): SafetyIncidentMutationResult {
  const correlationId = correlationFor(execution, 'safety:resolve', params)
  const adminId = requireRole(db, params.callerUserId, params.callerRole, 'ADMIN')
  if (!adminId) return { success: false, errorCode: 'FORBIDDEN' }
  const incident = readIncident(db, params.incidentId)
  if (!incident) return { success: false, errorCode: 'NOT_FOUND' }
  assertAcceptedTarget(execution, incident)
  if (incident.status !== 'CONFIRMED') return { success: false, errorCode: 'INVALID_STATE' }
  if (!isNonEmptyString(params.resolutionNotes)) return { success: false, errorCode: 'VALIDATION_ERROR' }
  const resolvedAt = new Date().toISOString()
  try {
    db.transaction(() => {
      const payload: SafetyIncidentResolvedPayload = {
        incident_id: incident.incident_id, resolved_at: resolvedAt, resolved_by: adminId,
        resolution_notes: params.resolutionNotes.trim(), follow_up_required: params.followUpRequired
      }
      execution.eventPort.writeEvent({
        aggregateType: 'SAFETY_INCIDENT', aggregateId: incident.incident_id,
        eventType: 'SAFETY_INCIDENT_RESOLVED',
        payload: payload as unknown as Record<string, unknown>, actorId: adminId, actorRole: 'ADMIN',
        correlationId
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
  tryGenerateSafetyReport(execution.automation, incident.incident_id, adminId, correlationId)
  return { success: true, incidentId: incident.incident_id }
}

function voidIncident(
  db: DBAdapter,
  params: { incident: SafetyRow; adminId: string; reason: SafetyIncidentVoidedPayload['void_reason']; notes?: string | null; replacementIncidentId?: string | null },
  execution: SafetyMutationExecution,
  correlationId: string
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
  execution.eventPort.writeEvent({
    aggregateType: 'SAFETY_INCIDENT', aggregateId: params.incident.incident_id,
    eventType: 'SAFETY_INCIDENT_VOIDED', payload: payload as unknown as Record<string, unknown>,
    actorId: params.adminId, actorRole: 'ADMIN', correlationId
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
  execution: SafetyMutationExecution
): SafetyIncidentMutationResult {
  const correlationId = correlationFor(execution, 'safety:void', params)
  const adminId = requireRole(db, params.callerUserId, params.callerRole, 'ADMIN')
  if (!adminId) return { success: false, errorCode: 'FORBIDDEN' }
  const incident = readIncident(db, params.incidentId)
  if (!incident) return { success: false, errorCode: 'NOT_FOUND' }
  assertAcceptedTarget(execution, incident)
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
  if (execution.automation) {
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
      return execution.automation.runSafetyMutation(
        safetyCommandKey(incident),
        () => ({
          aggregateType: 'SAFETY_INCIDENT',
          aggregateId: incident.incident_id,
          eventType: 'SAFETY_INCIDENT_VOIDED',
          payload: payload as unknown as Record<string, unknown>,
          actorId: adminId,
          actorRole: 'ADMIN',
          correlationId
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
    }, execution, correlationId))()
  } catch {
    return { success: false, errorCode: 'SAFETY_SYSTEM_ERROR' }
  }
  return { success: true, incidentId: incident.incident_id }
}

export function replaceSafetyIncidentForFactualCorrection(
  db: DBAdapter,
  params: ReplaceSafetyIncidentParams,
  execution: SafetyMutationExecution
): SafetyIncidentMutationResult {
  const correlationId = correlationFor(execution, 'safety:replaceForFactualCorrection', params)
  const adminId = requireRole(db, params.callerUserId, params.callerRole, 'ADMIN')
  if (!adminId) return { success: false, errorCode: 'FORBIDDEN' }
  const incident = readIncident(db, params.incidentId)
  if (!incident) return { success: false, errorCode: 'NOT_FOUND' }
  assertAcceptedTarget(execution, incident)
  if (incident.status !== 'CONFIRMED') return { success: false, errorCode: 'INVALID_STATE' }
  const confirmedBy = incident.confirmed_by
  if (!confirmedBy) return { success: false, errorCode: 'SAFETY_SYSTEM_ERROR' }
  if (!reasonCodes.has(params.reasonCode) || !contextPhases.has(params.contextPhase) || !isNonEmptyString(params.description) || !isNonEmptyString(params.correctionReason)) {
    return { success: false, errorCode: 'VALIDATION_ERROR' }
  }
  const replacementId = uuidv4()
  const occurredAt = new Date().toISOString()
  if (execution.automation) {
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
      return execution.automation.runSafetyMutation(
        safetyCommandKey(incident),
        () => ({
          aggregateType: 'SAFETY_INCIDENT',
          aggregateId: incident.incident_id,
          eventType: 'SAFETY_INCIDENT_REPLACED_FOR_FACTUAL_CORRECTION',
          payload: payload as unknown as Record<string, unknown>,
          actorId: adminId,
          actorRole: 'ADMIN',
          correlationId
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
      const created = execution.eventPort.writeEvent({
        aggregateType: 'SAFETY_INCIDENT', aggregateId: replacementId,
        eventType: 'SAFETY_INCIDENT_CREATED', payload: createdPayload as unknown as Record<string, unknown>,
        actorId: adminId, actorRole: 'ADMIN', correlationId
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
      execution.eventPort.writeEvent({
        aggregateType: 'SAFETY_INCIDENT', aggregateId: incident.incident_id,
        eventType: 'SAFETY_INCIDENT_REPLACED_FOR_FACTUAL_CORRECTION',
        payload: replacementPayload as unknown as Record<string, unknown>, actorId: adminId, actorRole: 'ADMIN',
        correlationId
      })
      voidIncident(db, {
        incident, adminId, reason: 'FACTUAL_CORRECTION', notes: params.correctionReason.trim(), replacementIncidentId: replacementId
      }, execution, correlationId)
    })()
  } catch {
    return { success: false, errorCode: 'SAFETY_SYSTEM_ERROR' }
  }
  return { success: true, incidentId: replacementId }
}

function tryGenerateSafetyReport(
  automation: SafetyReportAutomation | undefined,
  incidentId: string,
  callerUserId: string,
  correlationId: string
): void {
  if (!automation) return
  try {
    automation.generateSafetyReportFromIncident(incidentId, callerUserId, correlationId)
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
