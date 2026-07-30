import type { CanonicalJsonValue } from '../event-batch/canonical-json'
import type { PreparedBatchSource, VerifiedEventSource } from '../event-batch/projection-source'
import {
  PreparedFactRegistry,
  type PreparedProjectorContext
} from '../event-batch/result-registry'
import {
  TRAINING_EVENT_PAYLOAD_VERSION,
  TRAINING_RESULT_RECIPE_VERSIONS
} from '../../application/planners/training-planner'

export const TRAINING_PROJECTOR_NAME = 'm5b-training-projector-v1'

const METADATA_KEYS = ['actor_role', 'app_version', 'batch_context', 'correlation_id', 'event_payload_version'] as const
const STARTED_KEYS = [...METADATA_KEYS, 'business_session_id', 'created_by', 'job_code', 'module_type', 'step_records', 'strategy_id', 'strategy_type', 'strategy_version', 'student_id', 'task_code', 'total_steps', 'training_session_id'] as const
const STEP_KEYS = [...METADATA_KEYS, 'attempt_count_after', 'attempt_count_before', 'occurred_at', 'session_completed', 'session_status_after', 'session_status_before', 'status_after', 'status_before', 'step_order', 'step_record_id', 'step_type', 'training_session_id'] as const
const COMPLETED_KEYS = [...METADATA_KEYS, 'completed_at', 'completed_steps', 'completion_ratio', 'completion_rate', 'failed_steps', 'job_code', 'level_result', 'module_type', 'result_id', 'skipped_steps', 'strategy_id', 'strategy_version', 'student_id', 'total_steps', 'training_session_id'] as const
type StepEvent = 'TRAINING_STEP_STARTED' | 'TRAINING_STEP_COMPLETED' | 'TRAINING_STEP_SKIPPED' | 'TRAINING_STEP_FAILED' | 'TRAINING_STEP_RETRIED'

function exactKeys(payload: Readonly<Record<string, CanonicalJsonValue>>, expected: readonly string[]): void {
  const actual = Object.keys(payload).sort()
  const sorted = [...expected].sort()
  if (actual.length !== sorted.length || actual.some((key, index) => key !== sorted[index])) {
    throw new Error(`payload field set mismatch: ${actual.join(',')}`)
  }
}

function text(value: CanonicalJsonValue | undefined, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) throw new Error(`${field} is invalid`)
  return value
}

function integer(value: CanonicalJsonValue | undefined, field: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) throw new Error(`${field} is invalid`)
  return value as number
}

function number(value: CanonicalJsonValue | undefined, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${field} is invalid`)
  return value
}

function bool(value: CanonicalJsonValue | undefined, field: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${field} is invalid`)
  return value
}

function records(value: CanonicalJsonValue | undefined, field: string): readonly Readonly<Record<string, CanonicalJsonValue>>[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'object' || item === null || Array.isArray(item))) {
    throw new Error(`${field} is invalid`)
  }
  return value as readonly Readonly<Record<string, CanonicalJsonValue>>[]
}

function validateMetadata(payload: Readonly<Record<string, CanonicalJsonValue>>, role: 'TEACHER' | 'STUDENT'): void {
  if (payload.event_payload_version !== TRAINING_EVENT_PAYLOAD_VERSION) throw new Error('event_payload_version is invalid')
  if (payload.actor_role !== role) throw new Error('actor_role is invalid')
  text(payload.app_version, 'app_version')
  text(payload.correlation_id, 'correlation_id')
}

function validateStarted(payload: Readonly<Record<string, CanonicalJsonValue>>): void {
  exactKeys(payload, STARTED_KEYS)
  validateMetadata(payload, 'TEACHER')
  for (const field of ['training_session_id', 'business_session_id', 'created_by', 'student_id', 'strategy_id', 'job_code', 'task_code', 'module_type']) text(payload[field], field)
  if (payload.strategy_type !== 'TRAINING_PRACTICE') throw new Error('strategy_type is invalid')
  if (integer(payload.strategy_version, 'strategy_version', 1) < 1 || integer(payload.total_steps, 'total_steps', 1) !== 4) throw new Error('training size is invalid')
  const steps = records(payload.step_records, 'step_records')
  if (steps.length !== 4) throw new Error('step_records must contain four entries')
  const orders = new Set<number>()
  for (const step of steps) {
    text(step.step_record_id, 'step_records.step_record_id')
    text(step.step_code, 'step_records.step_code')
    text(step.step_name, 'step_records.step_name')
    text(step.step_type, 'step_records.step_type')
    orders.add(integer(step.step_order, 'step_records.step_order', 1))
  }
  if (orders.size !== 4 || ![1, 2, 3, 4].every((order) => orders.has(order))) throw new Error('step_records order is invalid')
}

function validateStep(eventType: StepEvent, payload: Readonly<Record<string, CanonicalJsonValue>>): void {
  exactKeys(payload, STEP_KEYS)
  validateMetadata(payload, 'STUDENT')
  for (const field of ['training_session_id', 'step_record_id', 'step_type', 'status_before', 'status_after', 'session_status_before', 'session_status_after', 'occurred_at']) text(payload[field], field)
  integer(payload.step_order, 'step_order', 1)
  const before = integer(payload.attempt_count_before, 'attempt_count_before')
  const after = integer(payload.attempt_count_after, 'attempt_count_after')
  const statusBefore = text(payload.status_before, 'status_before')
  const statusAfter = text(payload.status_after, 'status_after')
  const completed = bool(payload.session_completed, 'session_completed')
  const sessionStatusBefore = text(payload.session_status_before, 'session_status_before')
  const sessionStatusAfter = text(payload.session_status_after, 'session_status_after')
  const expected = eventType === 'TRAINING_STEP_STARTED'
    ? { before: ['NOT_STARTED'], after: 'IN_PROGRESS', attemptDelta: 1, mayComplete: false }
    : eventType === 'TRAINING_STEP_COMPLETED'
      ? { before: ['IN_PROGRESS'], after: 'COMPLETED', attemptDelta: 0, mayComplete: true }
      : eventType === 'TRAINING_STEP_SKIPPED'
        ? { before: ['NOT_STARTED', 'IN_PROGRESS'], after: 'SKIPPED', attemptDelta: 0, mayComplete: true }
        : eventType === 'TRAINING_STEP_FAILED'
          ? { before: ['IN_PROGRESS'], after: 'FAILED', attemptDelta: 0, mayComplete: true }
          : { before: ['FAILED'], after: 'IN_PROGRESS', attemptDelta: 1, mayComplete: false }
  if (!expected.before.includes(statusBefore) || statusAfter !== expected.after || after !== before + expected.attemptDelta) {
    throw new Error(`invalid ${eventType} transition`)
  }
  if (completed && !expected.mayComplete) throw new Error(`${eventType} cannot complete the session`)
  const expectedSessionStatus = eventType === 'TRAINING_STEP_STARTED' && sessionStatusBefore === 'INIT'
    ? 'ACTIVE'
    : sessionStatusBefore
  if (sessionStatusAfter !== expectedSessionStatus) throw new Error(`invalid ${eventType} session transition`)
}

function validateCompleted(payload: Readonly<Record<string, CanonicalJsonValue>>): void {
  exactKeys(payload, COMPLETED_KEYS)
  validateMetadata(payload, 'STUDENT')
  for (const field of ['training_session_id', 'completed_at', 'result_id', 'level_result', 'student_id', 'strategy_id', 'job_code']) text(payload[field], field)
  integer(payload.total_steps, 'total_steps', 1)
  integer(payload.completed_steps, 'completed_steps')
  integer(payload.skipped_steps, 'skipped_steps')
  integer(payload.failed_steps, 'failed_steps')
  const rate = number(payload.completion_rate, 'completion_rate')
  const ratio = number(payload.completion_ratio, 'completion_ratio')
  if (rate < 0 || rate > 100 || ratio < 0 || ratio > 1 || Math.abs(rate / 100 - ratio) > Number.EPSILON) throw new Error('completion facts are invalid')
  integer(payload.strategy_version, 'strategy_version', 1)
  if (payload.module_type !== null) text(payload.module_type, 'module_type')
  const total = integer(payload.total_steps, 'total_steps', 1)
  const completed = integer(payload.completed_steps, 'completed_steps')
  const skipped = integer(payload.skipped_steps, 'skipped_steps')
  const failed = integer(payload.failed_steps, 'failed_steps')
  if (completed + skipped + failed !== total || Math.abs(rate - (completed / total) * 100) > Number.EPSILON) {
    throw new Error('completion counts are invalid')
  }
}

function markApplied(context: PreparedProjectorContext): void {
  const before = context.database.prepare(
    'SELECT applied_to_snapshot FROM domain_event_projection WHERE event_id = ?'
  ).get(context.event.record.event_id) as { applied_to_snapshot: number } | undefined
  if (!before || before.applied_to_snapshot !== 0) {
    throw new Error(`training EVENT ${context.event.record.event_id} was not available for projection`)
  }
  context.database.prepare(
    `UPDATE domain_event_projection SET applied_to_snapshot = 1, applied_at = ?
      WHERE event_id = ? AND applied_to_snapshot = 0`
  ).run(context.event.record.timestamp, context.event.record.event_id)
}

function projectStarted(context: PreparedProjectorContext): void {
  const p = context.event.record.payload
  const existing = context.database.prepare(
    'SELECT training_session_id FROM training_session WHERE training_session_id = ?'
  ).get(text(p.training_session_id, 'training_session_id'))
  if (existing) throw new Error('training session already exists during prepared projection')
  context.database.prepare(
    `INSERT INTO business_session (business_session_id, session_type, student_id, job_code, task_code, created_by)
     VALUES (?, 'TRAINING', ?, ?, ?, ?)`
  ).run(text(p.business_session_id, 'business_session_id'), text(p.student_id, 'student_id'), text(p.job_code, 'job_code'), text(p.task_code, 'task_code'), text(p.created_by, 'created_by'))
  context.database.prepare(
    `INSERT INTO training_session (
       training_session_id, business_session_id, student_id, job_code, task_code,
       strategy_id, strategy_type, strategy_version, status, module_type,
       total_step_count, completed_step_count, created_by, updated_at,
       created_event_id, last_applied_event_id, last_status_event_id
     ) VALUES (?, ?, ?, ?, ?, ?, 'TRAINING_PRACTICE', ?, 'INIT', ?, ?, 0, ?, ?, ?, ?, ?)`
  ).run(
    text(p.training_session_id, 'training_session_id'), text(p.business_session_id, 'business_session_id'),
    text(p.student_id, 'student_id'), text(p.job_code, 'job_code'), text(p.task_code, 'task_code'),
    text(p.strategy_id, 'strategy_id'), integer(p.strategy_version, 'strategy_version', 1), text(p.module_type, 'module_type'),
    integer(p.total_steps, 'total_steps', 1), text(p.created_by, 'created_by'), context.event.record.timestamp,
    context.event.record.event_id, context.event.record.event_id, context.event.record.event_id
  )
  const insert = context.database.prepare(
    `INSERT INTO training_step_record (
       training_step_record_id, training_session_id, step_code, step_name, step_order, step_type,
       status, attempt_count, generated_event_id, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, 'NOT_STARTED', 0, ?, ?, ?)`
  )
  for (const step of records(p.step_records, 'step_records')) {
    insert.run(text(step.step_record_id, 'step_record_id'), text(p.training_session_id, 'training_session_id'),
      text(step.step_code, 'step_code'), text(step.step_name, 'step_name'), integer(step.step_order, 'step_order', 1),
      text(step.step_type, 'step_type'), context.event.record.event_id, context.event.record.timestamp, context.event.record.timestamp)
  }
  markApplied(context)
}

function projectStep(context: PreparedProjectorContext): void {
  const p = context.event.record.payload
  const stepId = text(p.step_record_id, 'step_record_id')
  const sessionId = text(p.training_session_id, 'training_session_id')
  const step = context.database.prepare(
    'SELECT status, attempt_count FROM training_step_record WHERE training_step_record_id = ? AND training_session_id = ?'
  ).get(stepId, sessionId) as { status: string; attempt_count: number } | undefined
  const session = context.database.prepare(
    'SELECT status FROM training_session WHERE training_session_id = ?'
  ).get(sessionId) as { status: string } | undefined
  if (!step || !session || step.status !== p.status_before || step.attempt_count !== p.attempt_count_before || session.status !== p.session_status_before) {
    throw new Error('prepared training before-state conflicts with projection')
  }
  const type = context.event.record.event_type
  const timestampField = type === 'TRAINING_STEP_STARTED' ? 'started_at'
    : type === 'TRAINING_STEP_COMPLETED' ? 'completed_at' : null
  if (timestampField) {
    context.database.prepare(
      `UPDATE training_step_record SET status = ?, attempt_count = ?, ${timestampField} = ?, last_applied_event_id = ?, updated_at = ?
        WHERE training_step_record_id = ?`
    ).run(text(p.status_after, 'status_after'), integer(p.attempt_count_after, 'attempt_count_after'), text(p.occurred_at, 'occurred_at'), context.event.record.event_id, context.event.record.timestamp, stepId)
  } else {
    context.database.prepare(
      `UPDATE training_step_record SET status = ?, attempt_count = ?, last_applied_event_id = ?, updated_at = ?
        WHERE training_step_record_id = ?`
    ).run(text(p.status_after, 'status_after'), integer(p.attempt_count_after, 'attempt_count_after'), context.event.record.event_id, context.event.record.timestamp, stepId)
  }
  const completedIncrement = type === 'TRAINING_STEP_COMPLETED' ? 1 : 0
  context.database.prepare(
    `UPDATE training_session SET status = ?, completed_step_count = completed_step_count + ?,
       started_at = CASE WHEN status = 'INIT' AND ? = 'ACTIVE' THEN ? ELSE started_at END,
       last_applied_event_id = ?, last_status_event_id = CASE WHEN status <> ? THEN ? ELSE last_status_event_id END,
       updated_at = ? WHERE training_session_id = ?`
  ).run(text(p.session_status_after, 'session_status_after'), completedIncrement,
    text(p.session_status_after, 'session_status_after'), context.event.record.timestamp,
    context.event.record.event_id, text(p.session_status_after, 'session_status_after'), context.event.record.event_id,
    context.event.record.timestamp, sessionId)
  markApplied(context)
}

function projectCompleted(context: PreparedProjectorContext): void {
  const p = context.event.record.payload
  const sessionId = text(p.training_session_id, 'training_session_id')
  const session = context.database.prepare(
    'SELECT status, completed_step_count FROM training_session WHERE training_session_id = ?'
  ).get(sessionId) as { status: string; completed_step_count: number } | undefined
  if (!session || session.status === 'COMPLETED' || session.completed_step_count !== integer(p.completed_steps, 'completed_steps')) {
    throw new Error('prepared completion facts conflict with projection')
  }
  context.database.prepare(
    `UPDATE training_session SET status = 'COMPLETED', completed_at = ?, completion_rate = ?,
       completed_step_count = ?, last_applied_event_id = ?, last_status_event_id = ?, updated_at = ?
      WHERE training_session_id = ?`
  ).run(text(p.completed_at, 'completed_at'), number(p.completion_rate, 'completion_rate'), integer(p.completed_steps, 'completed_steps'),
    context.event.record.event_id, context.event.record.event_id, context.event.record.timestamp, sessionId)
  context.database.prepare(
    `INSERT INTO result_record (
       result_id, result_type, source_aggregate_type, source_aggregate_id, student_id,
       strategy_id, strategy_type, job_code, module_type, normalized_score, level_result,
       completion_ratio, generated_event_id, generated_at, safety_overridden
     ) VALUES (?, 'TRAINING_COMPLETION', 'TRAINING_SESSION', ?, ?, ?, 'TRAINING_PRACTICE', ?, ?, ?, ?, ?, ?, ?, 0)`
  ).run(text(p.result_id, 'result_id'), sessionId, text(p.student_id, 'student_id'), text(p.strategy_id, 'strategy_id'),
    text(p.job_code, 'job_code'), p.module_type, number(p.completion_rate, 'completion_rate'), text(p.level_result, 'level_result'),
    number(p.completion_ratio, 'completion_ratio'), context.event.record.event_id, text(p.completed_at, 'completed_at'))
  markApplied(context)
}

function assertMarked(context: PreparedProjectorContext): void {
  const row = context.database.prepare('SELECT applied_to_snapshot, applied_at FROM domain_event_projection WHERE event_id = ?')
    .get(context.event.record.event_id) as { applied_to_snapshot: number; applied_at: string | null } | undefined
  if (!row || row.applied_to_snapshot !== 1 || row.applied_at !== context.event.record.timestamp) throw new Error('training event was not marked applied')
}

function assertProjected(context: PreparedProjectorContext): void {
  const p = context.event.record.payload
  if (context.event.record.event_type === 'TRAINING_STARTED') {
    const row = context.database.prepare('SELECT status, created_event_id FROM training_session WHERE training_session_id = ?')
      .get(text(p.training_session_id, 'training_session_id')) as { status: string; created_event_id: string } | undefined
    if (!row || row.status !== 'INIT' || row.created_event_id !== context.event.record.event_id) throw new Error('training start projection conflicts')
  } else if (context.event.record.event_type === 'TRAINING_COMPLETED') {
    const row = context.database.prepare('SELECT status, completion_rate, last_status_event_id FROM training_session WHERE training_session_id = ?')
      .get(text(p.training_session_id, 'training_session_id')) as { status: string; completion_rate: number; last_status_event_id: string } | undefined
    if (!row || row.status !== 'COMPLETED' || row.completion_rate !== p.completion_rate || row.last_status_event_id !== context.event.record.event_id) throw new Error('training completion projection conflicts')
  } else {
    const row = context.database.prepare('SELECT status, attempt_count, last_applied_event_id FROM training_step_record WHERE training_step_record_id = ?')
      .get(text(p.step_record_id, 'step_record_id')) as { status: string; attempt_count: number; last_applied_event_id: string } | undefined
    if (!row || row.status !== p.status_after || row.attempt_count !== p.attempt_count_after || row.last_applied_event_id !== context.event.record.event_id) throw new Error('training step projection conflicts')
  }
  assertMarked(context)
}

function oneEvent(batch: PreparedBatchSource, eventType: string): VerifiedEventSource {
  const matches = batch.events.filter((event) => event.record.event_type === eventType)
  if (matches.length !== 1) throw new Error(`prepared result requires exactly one ${eventType}`)
  return matches[0]
}

function publicStepResult(batch: PreparedBatchSource, eventType: StepEvent, includeCompletion: boolean) {
  const payload = oneEvent(batch, eventType).record.payload
  const result: Record<string, CanonicalJsonValue> = {
    success: true,
    stepRecordId: text(payload.step_record_id, 'step_record_id'),
    newStatus: text(payload.status_after, 'status_after')
  }
  const completionEvents = batch.events.filter((event) => event.record.event_type === 'TRAINING_COMPLETED')
  const isCompleted = bool(payload.session_completed, 'session_completed')
  const permittedTypes = new Set([eventType, 'TRAINING_COMPLETED'])
  if (batch.events.some((event) => !permittedTypes.has(event.record.event_type))) {
    throw new Error(`${eventType} batch has unexpected EVENTs`)
  }
  if (includeCompletion) {
    const stepIndex = batch.events.findIndex((event) => event.record.event_type === eventType)
    if (isCompleted !== (completionEvents.length === 1) || (isCompleted && batch.events[stepIndex + 1] !== completionEvents[0])) {
      throw new Error('training completion EVENT disagrees with the terminal step fact')
    }
    result.sessionCompleted = isCompleted
  } else if (completionEvents.length !== 0) {
    throw new Error(`${eventType} batch cannot contain TRAINING_COMPLETED`)
  }
  return result
}

export function registerTrainingPreparedFacts(registry = new PreparedFactRegistry()): PreparedFactRegistry {
  registry.registerEvent({ eventType: 'TRAINING_STARTED', eventPayloadVersion: TRAINING_EVENT_PAYLOAD_VERSION, projectorName: TRAINING_PROJECTOR_NAME, validatePayload: validateStarted, project: projectStarted, assertProjected, operationalEffects: [] })
  const stepEvents: readonly StepEvent[] = ['TRAINING_STEP_STARTED', 'TRAINING_STEP_COMPLETED', 'TRAINING_STEP_SKIPPED', 'TRAINING_STEP_FAILED', 'TRAINING_STEP_RETRIED']
  for (const eventType of stepEvents) {
    registry.registerEvent({ eventType, eventPayloadVersion: TRAINING_EVENT_PAYLOAD_VERSION, projectorName: TRAINING_PROJECTOR_NAME, validatePayload: (payload) => validateStep(eventType, payload), project: projectStep, assertProjected, operationalEffects: [] })
  }
  registry.registerEvent({ eventType: 'TRAINING_COMPLETED', eventPayloadVersion: TRAINING_EVENT_PAYLOAD_VERSION, projectorName: TRAINING_PROJECTOR_NAME, validatePayload: validateCompleted, project: projectCompleted, assertProjected, operationalEffects: [] })
  registry.registerResult({ commandType: 'training:createSession', resultRecipeVersion: TRAINING_RESULT_RECIPE_VERSIONS['training:createSession'], fromPrepared: ({ batch }) => {
    if (batch.events.length !== 1 || batch.events[0].record.event_type !== 'TRAINING_STARTED') throw new Error('create-session batch has unexpected EVENTs')
    const p = oneEvent(batch, 'TRAINING_STARTED').record.payload
    return { success: true, trainingSessionId: text(p.training_session_id, 'training_session_id'), businessSessionId: text(p.business_session_id, 'business_session_id'), status: 'INIT' }
  } })
  registry.registerResult({ commandType: 'training:startStep', resultRecipeVersion: TRAINING_RESULT_RECIPE_VERSIONS['training:startStep'], fromPrepared: ({ batch }) => publicStepResult(batch, 'TRAINING_STEP_STARTED', false) })
  registry.registerResult({ commandType: 'training:completeStep', resultRecipeVersion: TRAINING_RESULT_RECIPE_VERSIONS['training:completeStep'], fromPrepared: ({ batch }) => publicStepResult(batch, 'TRAINING_STEP_COMPLETED', true) })
  registry.registerResult({ commandType: 'training:skipStep', resultRecipeVersion: TRAINING_RESULT_RECIPE_VERSIONS['training:skipStep'], fromPrepared: ({ batch }) => publicStepResult(batch, 'TRAINING_STEP_SKIPPED', true) })
  registry.registerResult({ commandType: 'training:failStep', resultRecipeVersion: TRAINING_RESULT_RECIPE_VERSIONS['training:failStep'], fromPrepared: ({ batch }) => publicStepResult(batch, 'TRAINING_STEP_FAILED', true) })
  registry.registerResult({ commandType: 'training:retryStep', resultRecipeVersion: TRAINING_RESULT_RECIPE_VERSIONS['training:retryStep'], fromPrepared: ({ batch }) => publicStepResult(batch, 'TRAINING_STEP_RETRIED', false) })
  return registry
}
