import type { CanonicalJsonValue } from '../event-batch/canonical-json'
import type { PreparedBatchSource } from '../event-batch/projection-source'
import {
  PreparedFactRegistry,
  type PreparedProjectorContext
} from '../event-batch/result-registry'
import {
  SAFETY_EVENT_PAYLOAD_VERSION,
  SAFETY_RESULT_RECIPE_VERSIONS
} from '../../application/planners/safety-planner'

export const SAFETY_PROJECTOR_NAME = 'm5b-safety-prepared-projector-v1'

type SafetyEventType =
  | 'SAFETY_INCIDENT_CREATED'
  | 'SAFETY_INCIDENT_DETAIL_CONFIRMED'
  | 'SAFETY_INCIDENT_RESOLVED'
  | 'SAFETY_INCIDENT_VOIDED'
  | 'SAFETY_INCIDENT_REPLACED_FOR_FACTUAL_CORRECTION'

const EVENT_TYPES: readonly SafetyEventType[] = [
  'SAFETY_INCIDENT_CREATED',
  'SAFETY_INCIDENT_DETAIL_CONFIRMED',
  'SAFETY_INCIDENT_RESOLVED',
  'SAFETY_INCIDENT_VOIDED',
  'SAFETY_INCIDENT_REPLACED_FOR_FACTUAL_CORRECTION'
]

const OPEN_STATUSES = new Set(['INIT', 'ACTIVE', 'EMOTION_INTERRUPTED', 'SUSPENDED_REVIEW_REQUIRED', 'OFFLINE_PENDING'])
const REASON_CODES = new Set([
  'BLADE_TOWARD_SELF', 'BLADE_TOWARD_OTHERS', 'DANGEROUS_CLIMBING',
  'THROWING_OBJECT', 'AGGRESSIVE_BEHAVIOR', 'OTHER_SAFETY_RISK'
])
const CONTEXT_PHASES = new Set([
  'ONLINE_ASSESSMENT', 'TRAINING_WATCH', 'TRAINING_LEARN', 'TRAINING_PRACTICE',
  'TRAINING_DO', 'OFFLINE_SCORING', 'TOOL_PREPARATION', 'BREAK_OR_TRANSITION', 'OTHER'
])

function record(value: CanonicalJsonValue | undefined, field: string): Readonly<Record<string, CanonicalJsonValue>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${field} must be an object`)
  return value
}

function records(value: CanonicalJsonValue | undefined, field: string): readonly Readonly<Record<string, CanonicalJsonValue>>[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'object' || entry === null || Array.isArray(entry))) {
    throw new Error(`${field} must be an array of objects`)
  }
  return value as readonly Readonly<Record<string, CanonicalJsonValue>>[]
}

function texts(value: CanonicalJsonValue | undefined, field: string): readonly string[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`)
  const output = value.map((entry, index) => text(entry, `${field}[${index}]`))
  if (new Set(output).size !== output.length) throw new Error(`${field} must not contain duplicates`)
  return output
}

function text(value: CanonicalJsonValue | undefined, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) throw new Error(`${field} is invalid`)
  return value
}

function nullableText(value: CanonicalJsonValue | undefined, field: string): string | null {
  if (value === null) return null
  return text(value, field)
}

function number(value: CanonicalJsonValue | undefined, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${field} is invalid`)
  return value
}

function exactTimestamp(value: CanonicalJsonValue | undefined, field: string): string {
  const timestamp = text(value, field)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(timestamp) || new Date(timestamp).toISOString() !== timestamp) {
    throw new Error(`${field} must be an exact UTC timestamp`)
  }
  return timestamp
}

function exactKeys(payload: Readonly<Record<string, CanonicalJsonValue>>, expected: readonly string[]): void {
  const actual = Object.keys(payload).sort()
  const sorted = [...expected].sort()
  if (actual.length !== sorted.length || actual.some((key, index) => key !== sorted[index])) {
    throw new Error(`payload field set mismatch: ${actual.join(',')}`)
  }
}

function validateMetadata(payload: Readonly<Record<string, CanonicalJsonValue>>): void {
  if (payload.event_payload_version !== SAFETY_EVENT_PAYLOAD_VERSION) throw new Error('event_payload_version is invalid')
  if (payload.actor_role !== 'TEACHER' && payload.actor_role !== 'ADMIN') throw new Error('actor_role is invalid')
  text(payload.app_version, 'app_version')
  text(payload.correlation_id, 'correlation_id')
  const context = record(payload.batch_context, 'batch_context')
  if (context.schema_version !== 'batch-context-v1') throw new Error('batch_context.schema_version is invalid')
  for (const field of ['plan_version', 'result_recipe_version', 'root_command_type', 'root_command_id']) {
    text(context[field], `batch_context.${field}`)
  }
  if (!Number.isSafeInteger(context.child_ordinal) || (context.child_ordinal as number) < 0) {
    throw new Error('batch_context.child_ordinal is invalid')
  }
}

function validateCreated(payload: Readonly<Record<string, CanonicalJsonValue>>): void {
  const expected = [
    'app_version', 'batch_context', 'context_phase', 'correlation_id', 'description', 'event_payload_version',
    'incident_id', 'job_code', 'occurred_at', 'projection_kind', 'reason_code', 'redline_projection',
    'reported_by', 'student_id', 'task_code', 'actor_role'
  ]
  if (payload.root_result !== undefined) expected.push('root_result')
  exactKeys(payload, expected)
  validateMetadata(payload)
  for (const field of ['incident_id', 'student_id', 'job_code', 'task_code', 'reported_by']) text(payload[field], field)
  exactTimestamp(payload.occurred_at, 'occurred_at')
  if (!REASON_CODES.has(text(payload.reason_code, 'reason_code'))) throw new Error('reason_code is invalid')
  if (!CONTEXT_PHASES.has(text(payload.context_phase, 'context_phase'))) throw new Error('context_phase is invalid')
  nullableText(payload.description, 'description')
  if (payload.projection_kind === 'LIFECYCLE') {
    if (payload.redline_projection !== null) throw new Error('lifecycle incident cannot carry redline facts')
  } else if (payload.projection_kind === 'REDLINE') {
    validateRedlineFacts(record(payload.redline_projection, 'redline_projection'))
    if (payload.root_result === undefined) throw new Error('redline root_result is required')
  } else {
    throw new Error('projection_kind is invalid')
  }
  if (payload.root_result !== undefined) {
    const root = record(payload.root_result, 'root_result')
    if (root.success !== true) throw new Error('created root_result is invalid')
  }
}

function validateBinding(entry: Readonly<Record<string, CanonicalJsonValue>>, field: string): void {
  exactKeys(entry, ['aggregate_id', 'pre_status'])
  text(entry.aggregate_id, `${field}.aggregate_id`)
  if (!OPEN_STATUSES.has(text(entry.pre_status, `${field}.pre_status`))) throw new Error(`${field}.pre_status is invalid`)
}

function validateRedlineFacts(facts: Readonly<Record<string, CanonicalJsonValue>>): void {
  exactKeys(facts, ['assessment_bindings', 'assessment_results', 'training_bindings', 'training_in_progress_step_ids'])
  const assessments = records(facts.assessment_bindings, 'assessment_bindings')
  const trainings = records(facts.training_bindings, 'training_bindings')
  const results = records(facts.assessment_results, 'assessment_results')
  if (assessments.length === 0 || results.length !== assessments.length) throw new Error('redline assessment facts are incomplete')
  for (const [index, entry] of assessments.entries()) validateBinding(entry, `assessment_bindings[${index}]`)
  for (const [index, entry] of trainings.entries()) validateBinding(entry, `training_bindings[${index}]`)
  const assessmentIds = assessments.map((entry) => text(entry.aggregate_id, 'assessment binding id'))
  if (new Set(assessmentIds).size !== assessmentIds.length) throw new Error('assessment bindings are duplicated')
  for (const [index, result] of results.entries()) {
    exactKeys(result, [
      'breakdown', 'completion_ratio', 'job_code', 'max_score', 'normalized_score', 'raw_score',
      'replaces_current_result_ids', 'result_id', 'session_id', 'strategy_id', 'strategy_type', 'student_id'
    ])
    if (text(result.session_id, `assessment_results[${index}].session_id`) !== assessmentIds[index]) {
      throw new Error('assessment result order must match bindings')
    }
    for (const field of ['result_id', 'student_id', 'strategy_id', 'job_code']) text(result[field], `assessment_results[${index}].${field}`)
    if (!['BASELINE_ASSESSMENT', 'MOCK_EXAM', 'JOB_SKILL_ASSESSMENT'].includes(text(result.strategy_type, 'strategy_type'))) {
      throw new Error('assessment result strategy_type is invalid')
    }
    for (const field of ['raw_score', 'max_score', 'normalized_score']) number(result[field], `assessment_results[${index}].${field}`)
    const ratio = result.completion_ratio
    if (ratio !== null && (number(ratio, `assessment_results[${index}].completion_ratio`) < 0 || number(ratio, `assessment_results[${index}].completion_ratio`) > 1)) {
      throw new Error('assessment completion_ratio is invalid')
    }
    record(result.breakdown, `assessment_results[${index}].breakdown`)
    texts(result.replaces_current_result_ids, `assessment_results[${index}].replaces_current_result_ids`)
  }
  texts(facts.training_in_progress_step_ids, 'training_in_progress_step_ids')
}

function validateConfirmed(payload: Readonly<Record<string, CanonicalJsonValue>>): void {
  exactKeys(payload, [
    'actor_role', 'app_version', 'batch_context', 'confirmed_at', 'confirmed_by', 'context_phase',
    'correlation_id', 'event_payload_version', 'full_description', 'incident_id', 'reason_code',
    'root_result', 'status_after', 'status_before'
  ])
  validateMetadata(payload)
  for (const field of ['incident_id', 'confirmed_by', 'full_description']) text(payload[field], field)
  exactTimestamp(payload.confirmed_at, 'confirmed_at')
  if (payload.status_before !== 'PENDING_DETAIL' || payload.status_after !== 'CONFIRMED') throw new Error('confirm status facts are invalid')
  if (!REASON_CODES.has(text(payload.reason_code, 'reason_code')) || !CONTEXT_PHASES.has(text(payload.context_phase, 'context_phase'))) throw new Error('confirm facts are invalid')
}

function validateResolved(payload: Readonly<Record<string, CanonicalJsonValue>>): void {
  exactKeys(payload, [
    'actor_role', 'app_version', 'batch_context', 'correlation_id', 'event_payload_version', 'follow_up_required',
    'incident_id', 'resolution_notes', 'resolved_at', 'resolved_by', 'root_result', 'status_after', 'status_before'
  ])
  validateMetadata(payload)
  for (const field of ['incident_id', 'resolution_notes', 'resolved_by']) text(payload[field], field)
  exactTimestamp(payload.resolved_at, 'resolved_at')
  if (typeof payload.follow_up_required !== 'boolean' || payload.status_before !== 'CONFIRMED' || payload.status_after !== 'RESOLVED') {
    throw new Error('resolve facts are invalid')
  }
}

function validateVoided(payload: Readonly<Record<string, CanonicalJsonValue>>): void {
  exactKeys(payload, [
    'actor_role', 'app_version', 'batch_context', 'correlation_id', 'event_payload_version', 'incident_id',
    'replacement_incident_id', 'root_result', 'status_after', 'status_before', 'void_notes', 'void_reason',
    'voided_at', 'voided_by'
  ])
  validateMetadata(payload)
  for (const field of ['incident_id', 'voided_by']) text(payload[field], field)
  exactTimestamp(payload.voided_at, 'voided_at')
  if (!['PENDING_DETAIL', 'CONFIRMED'].includes(text(payload.status_before, 'status_before')) || payload.status_after !== 'VOIDED') {
    throw new Error('void status facts are invalid')
  }
  const reason = text(payload.void_reason, 'void_reason')
  if (!['FALSE_TRIGGER', 'DUPLICATE_RECORD', 'NON_SAFETY_EVENT', 'FACTUAL_CORRECTION'].includes(reason)) throw new Error('void_reason is invalid')
  const replacement = nullableText(payload.replacement_incident_id, 'replacement_incident_id')
  if ((reason === 'DUPLICATE_RECORD' || reason === 'FACTUAL_CORRECTION') !== Boolean(replacement)) throw new Error('void replacement facts are invalid')
  nullableText(payload.void_notes, 'void_notes')
}

function validateReplaced(payload: Readonly<Record<string, CanonicalJsonValue>>): void {
  exactKeys(payload, [
    'actor_role', 'app_version', 'batch_context', 'correlation_id', 'correction_reason', 'event_payload_version',
    'new_incident_id', 'old_incident_id', 'replaced_at', 'replaced_by', 'status_after', 'status_before'
  ])
  validateMetadata(payload)
  for (const field of ['old_incident_id', 'new_incident_id', 'replaced_by', 'correction_reason']) text(payload[field], field)
  exactTimestamp(payload.replaced_at, 'replaced_at')
  if (payload.status_before !== 'CONFIRMED' || payload.status_after !== 'CONFIRMED') throw new Error('replacement status facts are invalid')
}

function validatePayload(eventType: SafetyEventType, payload: Readonly<Record<string, CanonicalJsonValue>>): void {
  if (eventType === 'SAFETY_INCIDENT_CREATED') return validateCreated(payload)
  if (eventType === 'SAFETY_INCIDENT_DETAIL_CONFIRMED') return validateConfirmed(payload)
  if (eventType === 'SAFETY_INCIDENT_RESOLVED') return validateResolved(payload)
  if (eventType === 'SAFETY_INCIDENT_VOIDED') return validateVoided(payload)
  return validateReplaced(payload)
}

function markApplied(context: PreparedProjectorContext): void {
  const updated = context.database.prepare(
    `UPDATE domain_event_projection SET applied_to_snapshot = 1, applied_at = ?
      WHERE event_id = ? AND applied_to_snapshot = 0`
  ).run(context.event.record.timestamp, context.event.record.event_id)
  void updated
  const row = context.database.prepare(
    'SELECT applied_to_snapshot, applied_at FROM domain_event_projection WHERE event_id = ?'
  ).get(context.event.record.event_id) as { applied_to_snapshot: number; applied_at: string | null } | undefined
  if (!row || row.applied_to_snapshot !== 1 || row.applied_at !== context.event.record.timestamp) throw new Error('safety event mark is missing')
}

function assertIncident(context: PreparedProjectorContext, incidentId: string, expectedStatus: string): Record<string, unknown> {
  const row = context.database.prepare(
    'SELECT incident_id, student_id, job_code, task_code, status, trigger_event_id FROM safety_incident WHERE incident_id = ?'
  ).get(incidentId) as Record<string, unknown> | undefined
  if (!row || row.status !== expectedStatus) throw new Error(`safety incident ${incidentId} is not ${expectedStatus}`)
  return row
}

function assertBindings(
  context: PreparedProjectorContext,
  incidentId: string,
  aggregateType: 'ASSESSMENT_SESSION' | 'TRAINING_SESSION',
  expected: readonly Readonly<Record<string, CanonicalJsonValue>>[]
): void {
  const actual = context.database.prepare(
    `SELECT aggregate_id, pre_status, post_status FROM safety_incident_binding
      WHERE incident_id = ? AND aggregate_type = ? ORDER BY aggregate_id`
  ).all(incidentId, aggregateType) as Array<{ aggregate_id: string; pre_status: string; post_status: string }>
  const expectedSorted = [...expected].map((entry) => ({
    aggregate_id: text(entry.aggregate_id, 'binding.aggregate_id'), pre_status: text(entry.pre_status, 'binding.pre_status')
  })).sort((left, right) => left.aggregate_id.localeCompare(right.aggregate_id))
  if (actual.length !== expectedSorted.length || actual.some((entry, index) => (
    entry.aggregate_id !== expectedSorted[index].aggregate_id || entry.pre_status !== expectedSorted[index].pre_status || entry.post_status !== 'REDLINE_HALTED'
  ))) throw new Error(`${aggregateType} bindings do not match prepared M4 facts`)
  const table = aggregateType === 'ASSESSMENT_SESSION' ? 'assessment_session' : 'training_session'
  const id = aggregateType === 'ASSESSMENT_SESSION' ? 'session_id' : 'training_session_id'
  for (const binding of expectedSorted) {
    const row = context.database.prepare(
      `SELECT status, redline_incident_id FROM ${table} WHERE ${id} = ?`
    ).get(binding.aggregate_id) as { status: string; redline_incident_id: string | null } | undefined
    if (!row || row.status !== 'REDLINE_HALTED' || row.redline_incident_id !== incidentId) {
      throw new Error(`${aggregateType} native redline projection is missing`)
    }
  }
}

function projectRedlineResults(context: PreparedProjectorContext, incidentId: string, facts: Readonly<Record<string, CanonicalJsonValue>>): void {
  const results = records(facts.assessment_results, 'assessment_results')
  for (const result of results) {
    const sessionId = text(result.session_id, 'result.session_id')
    const current = context.database.prepare(
      `SELECT result_id FROM result_record WHERE result_type = 'ABILITY_SCORE'
        AND source_aggregate_type = 'ASSESSMENT_SESSION' AND source_aggregate_id = ? AND is_current = 1
        ORDER BY result_id`
    ).all(sessionId) as Array<{ result_id: string }>
    const expectedCurrent = texts(result.replaces_current_result_ids, 'result.replaces_current_result_ids')
    if (current.length !== expectedCurrent.length || current.some((entry, index) => entry.result_id !== expectedCurrent[index])) {
      throw new Error('prepared safety result replacement set conflicts with current projection')
    }
    for (const resultId of expectedCurrent) {
      context.database.prepare('UPDATE result_record SET is_current = 0 WHERE result_id = ? AND is_current = 1').run(resultId)
    }
    context.database.prepare(
      `INSERT INTO result_record (
         result_id, student_id, result_type, source_aggregate_type, source_aggregate_id,
         strategy_id, strategy_type, job_code, raw_score, max_score, normalized_score,
         completion_ratio, level_result, safety_overridden, redline_incident_id,
         result_payload_json, generated_event_id, generated_at, is_current
       ) VALUES (?, ?, 'ABILITY_SCORE', 'ASSESSMENT_SESSION', ?, ?, ?, ?, ?, ?, ?, ?,
                 'LEVEL_FAIL_BY_SAFETY', 1, ?, ?, ?, ?, 1)`
    ).run(
      text(result.result_id, 'result.result_id'), text(result.student_id, 'result.student_id'), sessionId,
      text(result.strategy_id, 'result.strategy_id'), text(result.strategy_type, 'result.strategy_type'), text(result.job_code, 'result.job_code'),
      number(result.raw_score, 'result.raw_score'), number(result.max_score, 'result.max_score'), number(result.normalized_score, 'result.normalized_score'),
      result.completion_ratio === null ? null : number(result.completion_ratio, 'result.completion_ratio'), incidentId,
      JSON.stringify(record(result.breakdown, 'result.breakdown')), context.event.record.event_id, context.event.record.timestamp
    )
  }
}

function projectRedlineTrainingSteps(context: PreparedProjectorContext, facts: Readonly<Record<string, CanonicalJsonValue>>): void {
  for (const stepId of texts(facts.training_in_progress_step_ids, 'training_in_progress_step_ids')) {
    const row = context.database.prepare(
      'SELECT status FROM training_step_record WHERE training_step_record_id = ?'
    ).get(stepId) as { status: string } | undefined
    if (!row || row.status !== 'IN_PROGRESS') throw new Error('prepared training-step safety fact conflicts with projection')
    context.database.prepare(
      `UPDATE training_step_record SET status = 'FAILED', updated_at = ? WHERE training_step_record_id = ? AND status = 'IN_PROGRESS'`
    ).run(context.event.record.timestamp, stepId)
  }
}

function projectCreated(context: PreparedProjectorContext): void {
  const p = context.event.record.payload
  const incidentId = text(p.incident_id, 'incident_id')
  const existing = context.database.prepare('SELECT incident_id FROM safety_incident WHERE incident_id = ?').get(incidentId)
  if (existing) throw new Error('prepared safety incident already exists')
  context.database.prepare(
    `INSERT INTO safety_incident (
       incident_id, student_id, job_code, task_code, trigger_event_id, reason_code, description,
       triggered_by, context_phase, occurred_at, status, requires_review_before_next_session
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_DETAIL', 1)`
  ).run(
    incidentId, text(p.student_id, 'student_id'), text(p.job_code, 'job_code'), text(p.task_code, 'task_code'),
    context.event.record.event_id, text(p.reason_code, 'reason_code'), nullableText(p.description, 'description'),
    text(p.reported_by, 'reported_by'), text(p.context_phase, 'context_phase'), exactTimestamp(p.occurred_at, 'occurred_at')
  )
  if (p.projection_kind === 'REDLINE') {
    const facts = record(p.redline_projection, 'redline_projection')
    assertBindings(context, incidentId, 'ASSESSMENT_SESSION', records(facts.assessment_bindings, 'assessment_bindings'))
    assertBindings(context, incidentId, 'TRAINING_SESSION', records(facts.training_bindings, 'training_bindings'))
    projectRedlineResults(context, incidentId, facts)
    projectRedlineTrainingSteps(context, facts)
  }
  markApplied(context)
}

function projectConfirmed(context: PreparedProjectorContext): void {
  const p = context.event.record.payload
  const incidentId = text(p.incident_id, 'incident_id')
  assertIncident(context, incidentId, text(p.status_before, 'status_before'))
  context.database.prepare(
    `UPDATE safety_incident SET status = 'CONFIRMED', confirmed_by = ?, reason_code = ?, context_phase = ?,
       description = ?, updated_at = ? WHERE incident_id = ? AND status = 'PENDING_DETAIL'`
  ).run(text(p.confirmed_by, 'confirmed_by'), text(p.reason_code, 'reason_code'), text(p.context_phase, 'context_phase'),
    text(p.full_description, 'full_description'), exactTimestamp(p.confirmed_at, 'confirmed_at'), incidentId)
  assertIncident(context, incidentId, 'CONFIRMED')
  markApplied(context)
}

function projectResolved(context: PreparedProjectorContext): void {
  const p = context.event.record.payload
  const incidentId = text(p.incident_id, 'incident_id')
  assertIncident(context, incidentId, text(p.status_before, 'status_before'))
  context.database.prepare(
    `UPDATE safety_incident SET status = 'RESOLVED', resolved_by = ?, resolved_at = ?,
       requires_review_before_next_session = 0, updated_at = ?
      WHERE incident_id = ? AND status = 'CONFIRMED'`
  ).run(text(p.resolved_by, 'resolved_by'), exactTimestamp(p.resolved_at, 'resolved_at'), context.event.record.timestamp, incidentId)
  assertIncident(context, incidentId, 'RESOLVED')
  markApplied(context)
}

function projectVoided(context: PreparedProjectorContext): void {
  const p = context.event.record.payload
  const incidentId = text(p.incident_id, 'incident_id')
  assertIncident(context, incidentId, text(p.status_before, 'status_before'))
  context.database.prepare(
    `UPDATE safety_incident SET status = 'VOIDED', void_reason = ?, replacement_incident_id = ?,
       resolved_by = ?, resolved_at = ?, requires_review_before_next_session = 0, updated_at = ?
      WHERE incident_id = ? AND status = ?`
  ).run(text(p.void_reason, 'void_reason'), nullableText(p.replacement_incident_id, 'replacement_incident_id'),
    text(p.voided_by, 'voided_by'), exactTimestamp(p.voided_at, 'voided_at'), context.event.record.timestamp,
    incidentId, text(p.status_before, 'status_before'))
  assertIncident(context, incidentId, 'VOIDED')
  markApplied(context)
}

function projectReplaced(context: PreparedProjectorContext): void {
  const p = context.event.record.payload
  const oldId = text(p.old_incident_id, 'old_incident_id')
  const newId = text(p.new_incident_id, 'new_incident_id')
  const oldIncident = assertIncident(context, oldId, 'CONFIRMED')
  const newIncident = assertIncident(context, newId, 'PENDING_DETAIL')
  if (
    oldIncident.student_id !== newIncident.student_id
    || oldIncident.job_code !== newIncident.job_code
    || oldIncident.task_code !== newIncident.task_code
  ) throw new Error('prepared factual correction crosses the safety aggregate key')
  markApplied(context)
}

function project(context: PreparedProjectorContext): void {
  switch (context.event.record.event_type as SafetyEventType) {
    case 'SAFETY_INCIDENT_CREATED': return projectCreated(context)
    case 'SAFETY_INCIDENT_DETAIL_CONFIRMED': return projectConfirmed(context)
    case 'SAFETY_INCIDENT_RESOLVED': return projectResolved(context)
    case 'SAFETY_INCIDENT_VOIDED': return projectVoided(context)
    case 'SAFETY_INCIDENT_REPLACED_FOR_FACTUAL_CORRECTION': return projectReplaced(context)
  }
}

function assertProjected(context: PreparedProjectorContext): void {
  const p = context.event.record.payload
  const eventType = context.event.record.event_type as SafetyEventType
  if (eventType === 'SAFETY_INCIDENT_CREATED') {
    const incident = assertIncident(context, text(p.incident_id, 'incident_id'), 'PENDING_DETAIL')
    if (incident.trigger_event_id !== context.event.record.event_id) throw new Error('created incident has wrong trigger event')
    if (p.projection_kind === 'REDLINE') {
      const facts = record(p.redline_projection, 'redline_projection')
      assertBindings(context, text(p.incident_id, 'incident_id'), 'ASSESSMENT_SESSION', records(facts.assessment_bindings, 'assessment_bindings'))
      assertBindings(context, text(p.incident_id, 'incident_id'), 'TRAINING_SESSION', records(facts.training_bindings, 'training_bindings'))
      for (const result of records(facts.assessment_results, 'assessment_results')) {
        const row = context.database.prepare(
          `SELECT safety_overridden, redline_incident_id, level_result, is_current FROM result_record WHERE result_id = ?`
        ).get(text(result.result_id, 'result_id')) as Record<string, unknown> | undefined
        if (!row || row.safety_overridden !== 1 || row.redline_incident_id !== p.incident_id || row.level_result !== 'LEVEL_FAIL_BY_SAFETY' || row.is_current !== 1) {
          throw new Error('prepared safety result is missing')
        }
      }
      for (const stepId of texts(facts.training_in_progress_step_ids, 'training_in_progress_step_ids')) {
        const row = context.database.prepare('SELECT status FROM training_step_record WHERE training_step_record_id = ?').get(stepId) as { status: string } | undefined
        if (!row || row.status !== 'FAILED') throw new Error('prepared safety training step is missing')
      }
    }
  } else if (eventType === 'SAFETY_INCIDENT_DETAIL_CONFIRMED') {
    assertIncident(context, text(p.incident_id, 'incident_id'), 'CONFIRMED')
  } else if (eventType === 'SAFETY_INCIDENT_RESOLVED') {
    assertIncident(context, text(p.incident_id, 'incident_id'), 'RESOLVED')
  } else if (eventType === 'SAFETY_INCIDENT_VOIDED') {
    assertIncident(context, text(p.incident_id, 'incident_id'), 'VOIDED')
  } else {
    assertIncident(context, text(p.old_incident_id, 'old_incident_id'), 'CONFIRMED')
    assertIncident(context, text(p.new_incident_id, 'new_incident_id'), 'PENDING_DETAIL')
  }
  const mark = context.database.prepare(
    'SELECT applied_to_snapshot, applied_at FROM domain_event_projection WHERE event_id = ?'
  ).get(context.event.record.event_id) as { applied_to_snapshot: number; applied_at: string | null } | undefined
  if (!mark || mark.applied_to_snapshot !== 1 || mark.applied_at !== context.event.record.timestamp) throw new Error('safety event was not marked applied')
}

function rootResult(batch: PreparedBatchSource): Readonly<Record<string, CanonicalJsonValue>> {
  const values = batch.events
    .map((event) => event.record.payload.root_result)
    .filter((value): value is CanonicalJsonValue => value !== undefined)
  if (values.length !== 1) throw new Error('prepared safety batch must have exactly one root_result')
  const result = record(values[0], 'root_result')
  if (result.success !== true) throw new Error('prepared safety root_result is invalid')
  return result
}

export function registerSafetyPreparedFacts(registry = new PreparedFactRegistry()): PreparedFactRegistry {
  for (const eventType of EVENT_TYPES) {
    registry.registerEvent({
      eventType,
      eventPayloadVersion: SAFETY_EVENT_PAYLOAD_VERSION,
      projectorName: SAFETY_PROJECTOR_NAME,
      validatePayload: (payload) => validatePayload(eventType, payload),
      project,
      assertProjected,
      operationalEffects: []
    })
  }
  for (const [commandType, resultRecipeVersion] of Object.entries(SAFETY_RESULT_RECIPE_VERSIONS)) {
    registry.registerResult({
      commandType,
      resultRecipeVersion,
      fromPrepared: ({ batch }) => rootResult(batch)
    })
  }
  return registry
}
