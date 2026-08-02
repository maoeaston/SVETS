import { createHash } from 'crypto'

import type { DBAdapter } from '../../db/interface'
import type { CommandEnvelopeV2 } from '../command/command-types'
import {
  BATCH_CONTEXT_SCHEMA_VERSION,
  COMMAND_PLAN_SCHEMA_VERSION,
  createPlannerReadSnapshot,
  type CommandPlanV1,
  type EventIntentV1,
  type PlannerReadSnapshot
} from '../../domain/event-batch/command-plan'
import { canonicalJson, type CanonicalJsonValue } from '../../domain/event-batch/canonical-json'
import { calculateAbilityScore } from '../../domain/ability-scoring'
import {
  SAFETY_CONTEXT_PHASES,
  SAFETY_REASON_CODES
} from '../../../shared/types/safety'
import { isPreviewAssessmentSession } from '../../domain/preview/preview-session-guard'

export const SAFETY_EVENT_PAYLOAD_VERSION = 2 as const
export const SAFETY_SNAPSHOT_VERSION = 'm5b-safety-snapshot-v1'

export const SAFETY_PLAN_VERSIONS = Object.freeze({
  'safety:confirm': 'm5b.safety.confirm.plan.v1',
  'safety:resolve': 'm5b.safety.resolve.plan.v1',
  'safety:void': 'm5b.safety.void.plan.v1',
  'safety:replaceForFactualCorrection': 'm5b.safety.replace.plan.v1',
  'assessment:triggerRedline': 'm5b.safety.trigger-redline.plan.v1'
} as const)

export const SAFETY_RESULT_RECIPE_VERSIONS = Object.freeze({
  'safety:confirm': 'm5b.safety.confirm.result.v1',
  'safety:resolve': 'm5b.safety.resolve.result.v1',
  'safety:void': 'm5b.safety.void.result.v1',
  'safety:replaceForFactualCorrection': 'm5b.safety.replace.result.v1',
  'assessment:triggerRedline': 'm5b.safety.trigger-redline.result.v1'
} as const)

type SafetyCommand = keyof typeof SAFETY_PLAN_VERSIONS
type OpenStatus = 'INIT' | 'ACTIVE' | 'EMOTION_INTERRUPTED' | 'SUSPENDED_REVIEW_REQUIRED' | 'OFFLINE_PENDING'
const OPEN_ASSESSMENT_STATUSES: readonly OpenStatus[] = ['INIT', 'ACTIVE', 'EMOTION_INTERRUPTED', 'SUSPENDED_REVIEW_REQUIRED', 'OFFLINE_PENDING']
const OPEN_TRAINING_STATUSES: readonly Exclude<OpenStatus, 'OFFLINE_PENDING'>[] = ['INIT', 'ACTIVE', 'EMOTION_INTERRUPTED', 'SUSPENDED_REVIEW_REQUIRED']
const reasonCodes = new Set<string>(SAFETY_REASON_CODES.map((entry) => entry.value))
const contextPhases = new Set<string>(SAFETY_CONTEXT_PHASES.map((entry) => entry.value))

export class SafetyPlannerError extends Error {
  constructor(
    public readonly code: 'COMMAND_UNSUPPORTED' | 'INVALID_INPUT' | 'STATE_CONFLICT',
    message: string
  ) {
    super(`[m5b-safety-planner] ${message}`)
    this.name = 'SafetyPlannerError'
  }
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw new SafetyPlannerError('INVALID_INPUT', `${field} must be a non-empty trimmed string`)
  }
  return value
}

function exactTimestamp(value: unknown, field: string): string {
  const timestamp = text(value, field)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(timestamp) || new Date(timestamp).toISOString() !== timestamp) {
    throw new SafetyPlannerError('INVALID_INPUT', `${field} must be an exact UTC timestamp`)
  }
  return timestamp
}

function record(value: unknown, field: string): Record<string, CanonicalJsonValue> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SafetyPlannerError('INVALID_INPUT', `${field} must be an object`)
  }
  return value as Record<string, CanonicalJsonValue>
}

function canonicalRecord(value: unknown, field: string): Record<string, CanonicalJsonValue> {
  try {
    return record(JSON.parse(canonicalJson(value)), field)
  } catch (error) {
    throw new SafetyPlannerError('INVALID_INPUT', `${field} is not canonical JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function deterministicUuid(commandId: string, ordinal: number, role: string): string {
  const bytes = createHash('sha256')
    .update('svets:event-batch:v1\0', 'utf8')
    .update(commandId, 'utf8')
    .update('\0', 'utf8')
    .update(String(ordinal), 'utf8')
    .update('\0', 'utf8')
    .update(role, 'utf8')
    .digest()
    .subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function noOpSnapshot(timestamp: string, errorCode: string): PlannerReadSnapshot<CanonicalJsonValue> {
  return createPlannerReadSnapshot(canonicalRecord({
    schema_version: SAFETY_SNAPSHOT_VERSION,
    kind: 'NO_OP',
    timestamp,
    no_op_result: { success: false, errorCode }
  }, 'safety_snapshot'))
}

function actorRole(envelope: CommandEnvelopeV2): 'TEACHER' | 'ADMIN' | null {
  if (envelope.actor.kind !== 'USER' || envelope.actor.userId !== envelope.actorId) return null
  return envelope.actor.role === 'TEACHER' || envelope.actor.role === 'ADMIN' ? envelope.actor.role : null
}

function isActiveUser(db: DBAdapter, userId: string, role: 'TEACHER' | 'ADMIN'): boolean {
  return Boolean(db.prepare(
    "SELECT 1 FROM user_account WHERE user_id = ? AND role = ? AND status = 'ACTIVE'"
  ).get(userId, role))
}

function nextSequence(db: DBAdapter, aggregateId: string): number {
  const row = db.prepare(
    `SELECT MAX(event_sequence) AS value FROM domain_event_projection
      WHERE aggregate_type = 'SAFETY_INCIDENT' AND aggregate_id = ?`
  ).get(aggregateId) as { value: number | null } | undefined
  return (row?.value ?? 0) + 1
}

function nullableText(value: CanonicalJsonValue | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function payloadText(payload: Record<string, CanonicalJsonValue>, field: string): string | null {
  return nullableText(payload[field])
}

function publicNoOp(db: DBAdapter, envelope: CommandEnvelopeV2, timestamp: string): PlannerReadSnapshot<CanonicalJsonValue> | null {
  const role = actorRole(envelope)
  if (!role || !isActiveUser(db, envelope.actorId, role)) return noOpSnapshot(timestamp, 'FORBIDDEN')
  const needsTeacher = envelope.commandType === 'safety:confirm'
  if ((needsTeacher && role !== 'TEACHER') || (!needsTeacher && envelope.commandType !== 'assessment:triggerRedline' && role !== 'ADMIN')) {
    return noOpSnapshot(timestamp, 'FORBIDDEN')
  }
  return null
}

function readIncident(db: DBAdapter, incidentId: string): Record<string, unknown> | undefined {
  return db.prepare(
    `SELECT incident_id, student_id, job_code, task_code, status, reason_code, context_phase,
            description, triggered_by, confirmed_by, occurred_at
       FROM safety_incident WHERE incident_id = ?`
  ).get(incidentId) as Record<string, unknown> | undefined
}

function readLifecycleSnapshot(
  db: DBAdapter,
  envelope: CommandEnvelopeV2,
  timestamp: string,
  appVersion: string
): PlannerReadSnapshot<CanonicalJsonValue> {
  const rejected = publicNoOp(db, envelope, timestamp)
  if (rejected) return rejected
  const payload = record(envelope.payload, 'payload')
  const incidentId = text(envelope.target.incident_id ?? envelope.target.safety_incident_id, 'target.incident_id')
  const incident = readIncident(db, incidentId)
  if (!incident) return noOpSnapshot(timestamp, 'NOT_FOUND')
  if (
    envelope.target.student_id !== incident.student_id
    || envelope.target.job_code !== incident.job_code
    || envelope.target.task_code !== incident.task_code
  ) throw new SafetyPlannerError('STATE_CONFLICT', 'accepted incident target no longer matches authoritative incident facts')

  const command = envelope.commandType as Exclude<SafetyCommand, 'assessment:triggerRedline'>
  const base = {
    schema_version: SAFETY_SNAPSHOT_VERSION,
    kind: 'EVENTS',
    timestamp,
    app_version: appVersion,
    actor_role: actorRole(envelope)!,
    incident
  }
  if (command === 'safety:confirm') {
    if (incident.status !== 'PENDING_DETAIL') return noOpSnapshot(timestamp, 'INVALID_STATE')
    const reasonCode = payloadText(payload, 'reasonCode')
    const contextPhase = payloadText(payload, 'contextPhase')
    const description = payloadText(payload, 'description')
    if (!reasonCode || !contextPhase || !description || !reasonCodes.has(reasonCode) || !contextPhases.has(contextPhase)) {
      return noOpSnapshot(timestamp, 'VALIDATION_ERROR')
    }
    return createPlannerReadSnapshot(canonicalRecord({
      ...base,
      events: [{ event_type: 'SAFETY_INCIDENT_DETAIL_CONFIRMED', aggregate_id: incidentId, event_sequence: nextSequence(db, incidentId), payload: {
        incident_id: incidentId, confirmed_at: timestamp, confirmed_by: envelope.actorId,
        reason_code: reasonCode, context_phase: contextPhase, full_description: description,
        status_before: 'PENDING_DETAIL', status_after: 'CONFIRMED', root_result: { success: true, incidentId }
      } }]
    }, 'safety_confirm_snapshot'))
  }
  if (command === 'safety:resolve') {
    if (incident.status !== 'CONFIRMED') return noOpSnapshot(timestamp, 'INVALID_STATE')
    const notes = payloadText(payload, 'resolutionNotes')
    if (!notes || typeof payload.followUpRequired !== 'boolean') return noOpSnapshot(timestamp, 'VALIDATION_ERROR')
    return createPlannerReadSnapshot(canonicalRecord({
      ...base,
      events: [{ event_type: 'SAFETY_INCIDENT_RESOLVED', aggregate_id: incidentId, event_sequence: nextSequence(db, incidentId), payload: {
        incident_id: incidentId, resolved_at: timestamp, resolved_by: envelope.actorId,
        resolution_notes: notes, follow_up_required: payload.followUpRequired,
        status_before: 'CONFIRMED', status_after: 'RESOLVED', root_result: { success: true, incidentId }
      } }]
    }, 'safety_resolve_snapshot'))
  }
  if (command === 'safety:void') {
    if (incident.status !== 'PENDING_DETAIL' && incident.status !== 'CONFIRMED') return noOpSnapshot(timestamp, 'INVALID_STATE')
    const reason = payloadText(payload, 'voidReason')
    const notes = nullableText(payload.voidNotes)
    if (!reason || !['FALSE_TRIGGER', 'DUPLICATE_RECORD', 'NON_SAFETY_EVENT'].includes(reason)) return noOpSnapshot(timestamp, 'VALIDATION_ERROR')
    let replacementId: string | null = null
    if (reason === 'DUPLICATE_RECORD') {
      replacementId = payloadText(payload, 'replacementIncidentId')
      const replacement = replacementId ? readIncident(db, replacementId) : undefined
      if (!replacement || replacement.student_id !== incident.student_id || replacement.job_code !== incident.job_code || replacement.task_code !== incident.task_code) {
        return noOpSnapshot(timestamp, 'VALIDATION_ERROR')
      }
    }
    return createPlannerReadSnapshot(canonicalRecord({
      ...base,
      events: [{ event_type: 'SAFETY_INCIDENT_VOIDED', aggregate_id: incidentId, event_sequence: nextSequence(db, incidentId), payload: {
        incident_id: incidentId, voided_at: timestamp, voided_by: envelope.actorId, void_reason: reason,
        void_notes: notes, replacement_incident_id: replacementId,
        status_before: incident.status, status_after: 'VOIDED', root_result: { success: true, incidentId }
      } }]
    }, 'safety_void_snapshot'))
  }

  if (incident.status !== 'CONFIRMED') return noOpSnapshot(timestamp, 'INVALID_STATE')
  const reasonCode = payloadText(payload, 'reasonCode')
  const contextPhase = payloadText(payload, 'contextPhase')
  const description = payloadText(payload, 'description')
  const correctionReason = payloadText(payload, 'correctionReason')
  if (!reasonCode || !contextPhase || !description || !correctionReason || !reasonCodes.has(reasonCode) || !contextPhases.has(contextPhase)) {
    return noOpSnapshot(timestamp, 'VALIDATION_ERROR')
  }
  const replacementId = deterministicUuid(envelope.commandId, 0, 'replacement-safety-incident')
  const oldSequence = nextSequence(db, incidentId)
  return createPlannerReadSnapshot(canonicalRecord({
    ...base,
    events: [
      { event_type: 'SAFETY_INCIDENT_CREATED', aggregate_id: replacementId, event_sequence: 1, payload: {
        incident_id: replacementId, student_id: incident.student_id, job_code: incident.job_code, task_code: incident.task_code,
        reason_code: reasonCode, context_phase: contextPhase, occurred_at: timestamp, reported_by: envelope.actorId,
        description, projection_kind: 'LIFECYCLE', redline_projection: null
      } },
      { event_type: 'SAFETY_INCIDENT_REPLACED_FOR_FACTUAL_CORRECTION', aggregate_id: incidentId, event_sequence: oldSequence, payload: {
        old_incident_id: incidentId, new_incident_id: replacementId, replaced_at: timestamp, replaced_by: envelope.actorId,
        correction_reason: correctionReason, status_before: 'CONFIRMED', status_after: 'CONFIRMED'
      } },
      { event_type: 'SAFETY_INCIDENT_VOIDED', aggregate_id: incidentId, event_sequence: oldSequence + 1, payload: {
        incident_id: incidentId, voided_at: timestamp, voided_by: envelope.actorId, void_reason: 'FACTUAL_CORRECTION',
        void_notes: correctionReason, replacement_incident_id: replacementId,
        status_before: 'CONFIRMED', status_after: 'VOIDED', root_result: { success: true, incidentId: replacementId }
      } }
    ]
  }, 'safety_replace_snapshot'))
}

function readRedlineSnapshot(
  db: DBAdapter,
  envelope: CommandEnvelopeV2,
  timestamp: string,
  appVersion: string
): PlannerReadSnapshot<CanonicalJsonValue> {
  const rejected = publicNoOp(db, envelope, timestamp)
  if (rejected) return rejected
  const payload = record(envelope.payload, 'payload')
  const sessionId = text(envelope.target.session_id ?? envelope.target.assessment_session_id, 'target.session_id')
  const session = db.prepare(
    `SELECT session_id, student_id, job_code, task_code, strategy_id, strategy_type, strategy_version, status
       FROM assessment_session WHERE session_id = ?`
  ).get(sessionId) as Record<string, unknown> | undefined
  if (!session) return noOpSnapshot(timestamp, 'NOT_FOUND')
  if (isPreviewAssessmentSession(db, sessionId)) return noOpSnapshot(timestamp, 'PREVIEW_RESULT_SUPPRESSED')
  if (!OPEN_ASSESSMENT_STATUSES.includes(session.status as OpenStatus)) {
    return noOpSnapshot(timestamp, session.status === 'REDLINE_HALTED' ? 'SESSION_HALTED' : 'SESSION_NOT_ACTIVE')
  }
  if (envelope.target.student_id !== session.student_id || envelope.target.job_code !== session.job_code || envelope.target.task_code !== session.task_code) {
    throw new SafetyPlannerError('STATE_CONFLICT', 'accepted redline target no longer matches authoritative session facts')
  }
  const reasonCode = payloadText(payload, 'reasonCode') ?? 'OTHER_SAFETY_RISK'
  const contextPhase = payloadText(payload, 'contextPhase') ?? 'OTHER'
  if (!reasonCodes.has(reasonCode) || !contextPhases.has(contextPhase)) return noOpSnapshot(timestamp, 'VALIDATION_ERROR')
  const assessmentBindings = db.prepare(
    `SELECT session_id AS aggregate_id, status AS pre_status, student_id, strategy_id, strategy_type, strategy_version, job_code
       FROM assessment_session
      WHERE student_id = ? AND job_code = ? AND task_code = ?
        AND status IN (${OPEN_ASSESSMENT_STATUSES.map(() => '?').join(', ')})
      ORDER BY session_id`
  ).all(session.student_id, session.job_code, session.task_code, ...OPEN_ASSESSMENT_STATUSES) as Array<Record<string, unknown>>
  const trainingBindings = db.prepare(
    `SELECT training_session_id AS aggregate_id, status AS pre_status
       FROM training_session
      WHERE student_id = ? AND job_code = ? AND task_code = ?
        AND status IN (${OPEN_TRAINING_STATUSES.map(() => '?').join(', ')})
      ORDER BY training_session_id`
  ).all(session.student_id, session.job_code, session.task_code, ...OPEN_TRAINING_STATUSES) as Array<Record<string, unknown>>
  const incidentId = deterministicUuid(envelope.commandId, 0, 'safety-incident')
  const assessmentResults = assessmentBindings.map((binding, ordinal) => {
    const calculated = calculateAbilityScore(db, {
      sessionId: String(binding.aggregate_id), strategyId: String(binding.strategy_id),
      strategyVersion: Number(binding.strategy_version), safetyTriggered: true
    })
    const current = db.prepare(
      `SELECT result_id FROM result_record
        WHERE result_type = 'ABILITY_SCORE' AND source_aggregate_type = 'ASSESSMENT_SESSION'
          AND source_aggregate_id = ? AND is_current = 1 ORDER BY result_id`
    ).all(binding.aggregate_id) as Array<{ result_id: string }>
    return {
      session_id: binding.aggregate_id,
      result_id: deterministicUuid(envelope.commandId, ordinal + 1, 'safety-ability-result'),
      replaces_current_result_ids: current.map((entry) => entry.result_id),
      student_id: binding.student_id,
      strategy_id: binding.strategy_id,
      strategy_type: binding.strategy_type,
      job_code: binding.job_code,
      raw_score: calculated.rawScore,
      max_score: calculated.maxScore,
      normalized_score: calculated.normalizedScore,
      completion_ratio: calculated.completionRatio,
      breakdown: calculated.payload
    }
  })
  const trainingSteps = trainingBindings.flatMap((binding) => (
    db.prepare(
      "SELECT training_step_record_id FROM training_step_record WHERE training_session_id = ? AND status = 'IN_PROGRESS' ORDER BY training_step_record_id"
    ).all(binding.aggregate_id) as Array<{ training_step_record_id: string }>
  )).map((row) => row.training_step_record_id)
  return createPlannerReadSnapshot(canonicalRecord({
    schema_version: SAFETY_SNAPSHOT_VERSION,
    kind: 'EVENTS', timestamp, app_version: appVersion, actor_role: actorRole(envelope)!,
    events: [{ event_type: 'SAFETY_INCIDENT_CREATED', aggregate_id: incidentId, event_sequence: 1, payload: {
      incident_id: incidentId, student_id: session.student_id, job_code: session.job_code, task_code: session.task_code,
      reason_code: reasonCode, context_phase: contextPhase, occurred_at: timestamp, reported_by: envelope.actorId,
      description: null, projection_kind: 'REDLINE',
      redline_projection: {
        assessment_bindings: assessmentBindings.map((binding) => ({ aggregate_id: binding.aggregate_id, pre_status: binding.pre_status })),
        training_bindings: trainingBindings.map((binding) => ({ aggregate_id: binding.aggregate_id, pre_status: binding.pre_status })),
        assessment_results: assessmentResults,
        training_in_progress_step_ids: trainingSteps
      },
      root_result: { success: true, incidentId, sessionId }
    } }]
  }, 'safety_redline_snapshot'))
}

export function loadSafetyPlannerSnapshot(
  db: DBAdapter,
  envelope: CommandEnvelopeV2,
  options: Readonly<{ timestamp: string; appVersion: string }>
): PlannerReadSnapshot<CanonicalJsonValue> {
  const timestamp = exactTimestamp(options.timestamp, 'timestamp')
  text(options.appVersion, 'appVersion')
  text(envelope.correlationId, 'correlationId')
  if (!Object.prototype.hasOwnProperty.call(SAFETY_PLAN_VERSIONS, envelope.commandType)) {
    throw new SafetyPlannerError('COMMAND_UNSUPPORTED', `unsupported ${envelope.commandType}`)
  }
  return envelope.commandType === 'assessment:triggerRedline'
    ? readRedlineSnapshot(db, envelope, timestamp, options.appVersion)
    : readLifecycleSnapshot(db, envelope, timestamp, options.appVersion)
}

function context(envelope: CommandEnvelopeV2, planVersion: string, resultRecipeVersion: string, ordinal: number) {
  return {
    schema_version: BATCH_CONTEXT_SCHEMA_VERSION,
    plan_version: planVersion,
    result_recipe_version: resultRecipeVersion,
    root_command_type: envelope.commandType,
    root_command_id: envelope.commandId,
    child_ordinal: ordinal
  } as const
}

function intent(
  envelope: CommandEnvelopeV2,
  planVersion: string,
  resultRecipeVersion: string,
  ordinal: number,
  facts: Readonly<Record<string, CanonicalJsonValue>>,
  timestamp: string,
  appVersion: string
): EventIntentV1 {
  const eventType = text(facts.event_type, 'event.event_type')
  const aggregateId = text(facts.aggregate_id, 'event.aggregate_id')
  const eventSequence = facts.event_sequence
  if (typeof eventSequence !== 'number' || !Number.isSafeInteger(eventSequence) || eventSequence < 1) {
    throw new SafetyPlannerError('INVALID_INPUT', 'event.event_sequence is invalid')
  }
  const payload = record(facts.payload, 'event.payload')
  const role = actorRole(envelope)
  if (!role) throw new SafetyPlannerError('INVALID_INPUT', 'safety planner requires an accepted teacher or admin')
  return {
    eventId: deterministicUuid(envelope.commandId, ordinal, `${eventType.toLowerCase()}-event`),
    aggregateType: 'SAFETY_INCIDENT',
    aggregateId,
    eventType,
    eventSequence,
    actorId: envelope.actorId,
    timestamp,
    payload: canonicalRecord({
      event_payload_version: SAFETY_EVENT_PAYLOAD_VERSION,
      batch_context: context(envelope, planVersion, resultRecipeVersion, ordinal),
      actor_role: role,
      app_version: appVersion,
      correlation_id: envelope.correlationId,
      ...payload
    }, `events[${ordinal}].payload`) as unknown as EventIntentV1['payload']
  }
}

export class SafetyPlanner {
  plan(input: Readonly<{ envelope: CommandEnvelopeV2; snapshot: PlannerReadSnapshot<CanonicalJsonValue> }>): CommandPlanV1 {
    const command = input.envelope.commandType as SafetyCommand
    const planVersion = SAFETY_PLAN_VERSIONS[command]
    const resultRecipeVersion = SAFETY_RESULT_RECIPE_VERSIONS[command]
    if (!planVersion || !resultRecipeVersion) throw new SafetyPlannerError('COMMAND_UNSUPPORTED', `unsupported ${input.envelope.commandType}`)
    const value = record(input.snapshot.value, 'snapshot')
    if (value.schema_version !== SAFETY_SNAPSHOT_VERSION) throw new SafetyPlannerError('INVALID_INPUT', 'snapshot version mismatch')
    const timestamp = exactTimestamp(value.timestamp, 'snapshot.timestamp')
    if (value.kind === 'NO_OP') {
      return { schemaVersion: COMMAND_PLAN_SCHEMA_VERSION, commandId: input.envelope.commandId, commandType: command,
        planVersion, resultRecipeVersion, events: [], operationalEffects: [], noOpResult: record(value.no_op_result, 'snapshot.no_op_result') }
    }
    if (value.kind !== 'EVENTS' || !Array.isArray(value.events)) throw new SafetyPlannerError('INVALID_INPUT', 'snapshot kind is invalid')
    const appVersion = text(value.app_version, 'snapshot.app_version')
    return {
      schemaVersion: COMMAND_PLAN_SCHEMA_VERSION,
      commandId: input.envelope.commandId,
      commandType: command,
      planVersion,
      resultRecipeVersion,
      events: value.events.map((entry, ordinal) => intent(input.envelope, planVersion, resultRecipeVersion, ordinal, record(entry, `events[${ordinal}]`), timestamp, appVersion)),
      operationalEffects: [],
      noOpResult: null
    }
  }
}
