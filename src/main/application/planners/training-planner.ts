import { createHash } from 'crypto'
import type { DBAdapter } from '../../db/interface'
import type { CommandEnvelopeV2 } from '../command/command-types'
import {
  COMMAND_PLAN_SCHEMA_VERSION,
  BATCH_CONTEXT_SCHEMA_VERSION,
  createPlannerReadSnapshot,
  type CommandPlanV1,
  type EventIntentV1,
  type PlannerReadSnapshot
} from '../../domain/event-batch/command-plan'
import { canonicalJson, type CanonicalJsonValue } from '../../domain/event-batch/canonical-json'

export const TRAINING_EVENT_PAYLOAD_VERSION = 2 as const
export const TRAINING_SNAPSHOT_VERSION = 'm5b-training-snapshot-v1'

export const TRAINING_PLAN_VERSIONS = Object.freeze({
  'training:createSession': 'm5b.training.create-session.plan.v1',
  'training:startStep': 'm5b.training.start-step.plan.v1',
  'training:completeStep': 'm5b.training.complete-step.plan.v1',
  'training:skipStep': 'm5b.training.skip-step.plan.v1',
  'training:failStep': 'm5b.training.fail-step.plan.v1',
  'training:retryStep': 'm5b.training.retry-step.plan.v1'
} as const)

export const TRAINING_RESULT_RECIPE_VERSIONS = Object.freeze({
  'training:createSession': 'm5b.training.create-session.result.v1',
  'training:startStep': 'm5b.training.start-step.result.v1',
  'training:completeStep': 'm5b.training.complete-step.result.v1',
  'training:skipStep': 'm5b.training.skip-step.result.v1',
  'training:failStep': 'm5b.training.fail-step.result.v1',
  'training:retryStep': 'm5b.training.retry-step.result.v1'
} as const)

type TrainingCommand = keyof typeof TRAINING_PLAN_VERSIONS
type StepEvent = 'TRAINING_STEP_STARTED' | 'TRAINING_STEP_COMPLETED' | 'TRAINING_STEP_SKIPPED' | 'TRAINING_STEP_FAILED' | 'TRAINING_STEP_RETRIED'

const STEP_DEFINITIONS = Object.freeze([
  { step_order: 1, step_type: 'WATCH', step_code: 'WATCH_VIDEO', step_name: '观看示范视频' },
  { step_order: 2, step_type: 'LEARN', step_code: 'LEARN_MATERIAL', step_name: '学习操作要领' },
  { step_order: 3, step_type: 'PRACTICE', step_code: 'PRACTICE_TASK', step_name: '练习任务操作' },
  { step_order: 4, step_type: 'DO', step_code: 'DO_REAL_TASK', step_name: '独立完成任务' }
] as const)

export class TrainingPlannerError extends Error {
  constructor(
    public readonly code: 'COMMAND_UNSUPPORTED' | 'INVALID_INPUT' | 'STATE_CONFLICT',
    message: string
  ) {
    super(`[m5b-training-planner] ${message}`)
    this.name = 'TrainingPlannerError'
  }
}

function exactTimestamp(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || new Date(value).toISOString() !== value) {
    throw new TrainingPlannerError('INVALID_INPUT', `${field} must be an exact UTC timestamp`)
  }
  return value
}

function text(value: CanonicalJsonValue | undefined, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw new TrainingPlannerError('INVALID_INPUT', `${field} must be a non-empty trimmed string`)
  }
  return value
}

function integer(value: CanonicalJsonValue | undefined, field: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new TrainingPlannerError('INVALID_INPUT', `${field} must be an integer >= ${minimum}`)
  }
  return value as number
}

function number(value: CanonicalJsonValue | undefined, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TrainingPlannerError('INVALID_INPUT', `${field} must be finite`)
  }
  return value
}

function bool(value: CanonicalJsonValue | undefined, field: string): boolean {
  if (typeof value !== 'boolean') throw new TrainingPlannerError('INVALID_INPUT', `${field} must be boolean`)
  return value
}

function record(value: CanonicalJsonValue | undefined, field: string): Readonly<Record<string, CanonicalJsonValue>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TrainingPlannerError('INVALID_INPUT', `${field} must be an object`)
  }
  return value
}

function canonicalRecord(value: unknown): Record<string, CanonicalJsonValue> {
  const cloned = JSON.parse(canonicalJson(value)) as CanonicalJsonValue
  if (typeof cloned !== 'object' || cloned === null || Array.isArray(cloned)) {
    throw new TrainingPlannerError('INVALID_INPUT', 'snapshot must be an object')
  }
  return cloned
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

function batchContext(envelope: CommandEnvelopeV2, planVersion: string, resultRecipeVersion: string, childOrdinal: number) {
  return {
    schema_version: BATCH_CONTEXT_SCHEMA_VERSION,
    plan_version: planVersion,
    result_recipe_version: resultRecipeVersion,
    root_command_type: envelope.commandType,
    root_command_id: envelope.commandId,
    child_ordinal: childOrdinal
  } as const
}

function event(
  envelope: CommandEnvelopeV2,
  planVersion: string,
  resultRecipeVersion: string,
  ordinal: number,
  eventType: string,
  eventSequence: number,
  aggregateId: string,
  timestamp: string,
  payload: Record<string, CanonicalJsonValue>
): EventIntentV1 {
  return {
    eventId: deterministicUuid(envelope.commandId, ordinal, `${eventType.toLowerCase()}-event`),
    aggregateType: 'TRAINING_SESSION',
    aggregateId,
    eventType,
    eventSequence,
    actorId: envelope.actorId,
    timestamp,
    payload: {
      event_payload_version: TRAINING_EVENT_PAYLOAD_VERSION,
      batch_context: batchContext(envelope, planVersion, resultRecipeVersion, ordinal),
      ...payload
    }
  }
}

function noOpSnapshot(timestamp: string, errorCode: string): Record<string, CanonicalJsonValue> {
  return {
    schema_version: TRAINING_SNAPSHOT_VERSION,
    kind: 'NO_OP',
    timestamp,
    no_op_result: { success: false, errorCode }
  }
}

function readLevel(db: DBAdapter, strategyId: string, strategyVersion: number, completionRate: number): string {
  const row = db.prepare(
    'SELECT scoring_policy_json FROM strategy_config WHERE strategy_id = ? AND version = ?'
  ).get(strategyId, strategyVersion) as { scoring_policy_json: string } | undefined
  if (!row) throw new TrainingPlannerError('STATE_CONFLICT', 'strategy snapshot disappeared')
  try {
    const rules = (JSON.parse(row.scoring_policy_json) as { level_rules?: unknown }).level_rules
    if (Array.isArray(rules)) {
      for (const rule of rules) {
        if (typeof rule === 'object' && rule !== null
          && typeof (rule as Record<string, unknown>).min === 'number'
          && typeof (rule as Record<string, unknown>).max === 'number'
          && typeof (rule as Record<string, unknown>).level === 'string'
          && completionRate >= (rule as Record<string, number>).min
          && completionRate <= (rule as Record<string, number>).max) return (rule as Record<string, string>).level
      }
    }
  } catch {
    // Legacy behavior uses the conditional level when policy parsing is unavailable.
  }
  return 'LEVEL_CONDITIONAL'
}

export function loadTrainingPlannerSnapshot(
  db: DBAdapter,
  envelope: CommandEnvelopeV2,
  options: Readonly<{ timestamp: string; appVersion: string }>
): PlannerReadSnapshot<CanonicalJsonValue> {
  const timestamp = exactTimestamp(options.timestamp, 'timestamp')
  if (!Object.prototype.hasOwnProperty.call(TRAINING_PLAN_VERSIONS, envelope.commandType)) {
    throw new TrainingPlannerError('COMMAND_UNSUPPORTED', `unsupported ${envelope.commandType}`)
  }
  if (envelope.commandType === 'training:createSession') {
    const target = envelope.target
    const moduleType = text(envelope.payload.moduleType, 'payload.moduleType')
    const studentId = text(target.student_id, 'target.student_id')
    const jobCode = text(target.job_code, 'target.job_code')
    const taskCode = text(target.task_code, 'target.task_code')
    const strategyId = text(target.strategy_id, 'target.strategy_id')
    const strategyVersion = integer(target.strategy_version, 'target.strategy_version', 1)
    const strategyType = text(target.strategy_type, 'target.strategy_type')
    if (strategyType !== 'TRAINING_PRACTICE') throw new TrainingPlannerError('STATE_CONFLICT', 'strategy type changed')
    const blocked = db.prepare(
      `SELECT 1 FROM safety_incident
        WHERE student_id = ? AND job_code = ? AND task_code = ?
          AND requires_review_before_next_session = 1
          AND status IN ('PENDING_DETAIL', 'CONFIRMED') LIMIT 1`
    ).get(studentId, jobCode, taskCode)
    if (blocked) return createPlannerReadSnapshot(noOpSnapshot(timestamp, 'BLOCKED_BY_SAFETY_INCIDENT'))
    const open = db.prepare(
      `SELECT 1 FROM training_session
        WHERE student_id = ? AND job_code = ? AND task_code = ?
          AND status IN ('INIT', 'ACTIVE', 'EMOTION_INTERRUPTED', 'SUSPENDED_REVIEW_REQUIRED') LIMIT 1`
    ).get(studentId, jobCode, taskCode)
    if (open) return createPlannerReadSnapshot(noOpSnapshot(timestamp, 'DUPLICATE_TRAINING_SESSION'))
    return createPlannerReadSnapshot(canonicalRecord({
      schema_version: TRAINING_SNAPSHOT_VERSION,
      kind: 'CREATE', timestamp, app_version: options.appVersion, actor_role: 'TEACHER',
      student_id: studentId, job_code: jobCode, task_code: taskCode,
      strategy_id: strategyId, strategy_version: strategyVersion, module_type: moduleType
    }))
  }

  const sessionId = text(envelope.target.training_session_id, 'target.training_session_id')
  const stepId = text(envelope.target.step_record_id, 'target.step_record_id')
  const session = db.prepare(
    `SELECT training_session_id, student_id, job_code, task_code, strategy_id, strategy_version,
            module_type, status, total_step_count, completed_step_count
       FROM training_session WHERE training_session_id = ?`
  ).get(sessionId) as Record<string, unknown> | undefined
  const step = db.prepare(
    `SELECT training_step_record_id, training_session_id, step_type, step_order, status, attempt_count
       FROM training_step_record WHERE training_step_record_id = ? AND training_session_id = ?`
  ).get(stepId, sessionId) as Record<string, unknown> | undefined
  if (!session || !step || envelope.actor.kind !== 'USER' || envelope.actor.userId !== session.student_id) {
    return createPlannerReadSnapshot(noOpSnapshot(timestamp, !session ? 'NOT_FOUND' : !step ? 'STEP_NOT_FOUND' : 'FORBIDDEN'))
  }
  if (session.status === 'REDLINE_HALTED') return createPlannerReadSnapshot(noOpSnapshot(timestamp, 'SESSION_HALTED'))
  if (session.status === 'COMPLETED' || session.status === 'ABORTED') return createPlannerReadSnapshot(noOpSnapshot(timestamp, 'SESSION_NOT_ACTIVE'))
  const status = String(step.status)
  const command = envelope.commandType as TrainingCommand
  const expected = command === 'training:startStep' ? ['NOT_STARTED']
    : command === 'training:completeStep' || command === 'training:failStep' ? ['IN_PROGRESS']
      : command === 'training:skipStep' ? ['NOT_STARTED', 'IN_PROGRESS'] : ['FAILED']
  if (!expected.includes(status)) return createPlannerReadSnapshot(noOpSnapshot(timestamp, 'STEP_INVALID_TRANSITION'))
  if (command === 'training:startStep' || command === 'training:completeStep') {
    const prior = db.prepare(
      `SELECT COUNT(*) AS count FROM training_step_record
        WHERE training_session_id = ? AND step_order < ? AND status = 'NOT_STARTED'`
    ).get(sessionId, step.step_order) as { count: number }
    if (prior.count > 0) return createPlannerReadSnapshot(noOpSnapshot(timestamp, 'STEP_PREREQUISITE_NOT_MET'))
  }
  const statusAfter = command === 'training:startStep' || command === 'training:retryStep' ? 'IN_PROGRESS'
    : command === 'training:completeStep' ? 'COMPLETED'
      : command === 'training:skipStep' ? 'SKIPPED' : 'FAILED'
  const attemptAfter = command === 'training:startStep' || command === 'training:retryStep'
    ? Number(step.attempt_count) + 1 : Number(step.attempt_count)
  const remaining = db.prepare(
    `SELECT COUNT(*) AS count FROM training_step_record
      WHERE training_session_id = ? AND training_step_record_id <> ? AND status = 'NOT_STARTED'`
  ).get(sessionId, stepId) as { count: number }
  const terminalCounts = db.prepare(
    `SELECT
       SUM(CASE WHEN status = 'SKIPPED' THEN 1 ELSE 0 END) AS skipped_steps,
       SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) AS failed_steps
     FROM training_step_record
     WHERE training_session_id = ? AND training_step_record_id <> ?`
  ).get(sessionId, stepId) as { skipped_steps: number | null; failed_steps: number | null }
  const sessionCompleted = ['COMPLETED', 'SKIPPED', 'FAILED'].includes(statusAfter) && remaining.count === 0
  const completedSteps = Number(session.completed_step_count) + (statusAfter === 'COMPLETED' ? 1 : 0)
  const totalSteps = Number(session.total_step_count)
  const completionRate = totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0
  const stepSessionStatusAfter = command === 'training:startStep' && session.status === 'INIT'
    ? 'ACTIVE'
    : session.status
  const next = db.prepare(
    `SELECT MAX(event_sequence) AS value FROM domain_event_projection
      WHERE aggregate_type = 'TRAINING_SESSION' AND aggregate_id = ?`
  ).get(sessionId) as { value: number | null }
  return createPlannerReadSnapshot(canonicalRecord({
    schema_version: TRAINING_SNAPSHOT_VERSION,
    kind: 'STEP', timestamp, app_version: options.appVersion, actor_role: 'STUDENT',
    session: {
      training_session_id: sessionId, student_id: session.student_id, job_code: session.job_code,
      task_code: session.task_code, strategy_id: session.strategy_id, strategy_version: session.strategy_version,
      module_type: session.module_type, status_before: session.status,
      status_after: stepSessionStatusAfter,
      total_steps: totalSteps, completed_steps: completedSteps, completion_rate: completionRate,
      next_event_sequence: (next.value ?? 0) + 1
    },
    step: {
      step_record_id: stepId, step_type: step.step_type, step_order: step.step_order,
      status_before: status, status_after: statusAfter,
      attempt_count_before: step.attempt_count, attempt_count_after: attemptAfter,
      session_completed: sessionCompleted,
      skipped_steps: (terminalCounts.skipped_steps ?? 0) + (statusAfter === 'SKIPPED' ? 1 : 0),
      failed_steps: (terminalCounts.failed_steps ?? 0) + (statusAfter === 'FAILED' ? 1 : 0),
      result_id: sessionCompleted ? deterministicUuid(envelope.commandId, 1, 'training-completion-result') : null,
      level_result: sessionCompleted ? readLevel(db, String(session.strategy_id), Number(session.strategy_version), completionRate) : null
    }
  }))
}

export class TrainingPlanner {
  plan(input: Readonly<{ envelope: CommandEnvelopeV2; snapshot: PlannerReadSnapshot<CanonicalJsonValue> }>): CommandPlanV1 {
    const command = input.envelope.commandType as TrainingCommand
    const planVersion = TRAINING_PLAN_VERSIONS[command]
    const resultRecipeVersion = TRAINING_RESULT_RECIPE_VERSIONS[command]
    if (!planVersion || !resultRecipeVersion) throw new TrainingPlannerError('COMMAND_UNSUPPORTED', `unsupported ${input.envelope.commandType}`)
    const value = record(input.snapshot.value as unknown as CanonicalJsonValue, 'snapshot')
    if (value.schema_version !== TRAINING_SNAPSHOT_VERSION) throw new TrainingPlannerError('INVALID_INPUT', 'snapshot version mismatch')
    const timestamp = exactTimestamp(value.timestamp, 'snapshot.timestamp')
    const noOp = value.no_op_result
    if (noOp !== undefined) {
      return { schemaVersion: COMMAND_PLAN_SCHEMA_VERSION, commandId: input.envelope.commandId, commandType: command,
        planVersion, resultRecipeVersion, events: [], operationalEffects: [], noOpResult: record(noOp as unknown as CanonicalJsonValue, 'no_op_result') }
    }
    if (value.kind === 'CREATE') {
      const sessionId = deterministicUuid(input.envelope.commandId, 0, 'training-session')
      const steps = STEP_DEFINITIONS.map((definition, index) => ({
        ...definition,
        step_record_id: deterministicUuid(input.envelope.commandId, index + 1, `training-step-${definition.step_type.toLowerCase()}`)
      }))
      const payload = {
        actor_role: 'TEACHER', app_version: text(value.app_version, 'app_version'), correlation_id: input.envelope.correlationId,
        training_session_id: sessionId, business_session_id: sessionId,
        student_id: text(value.student_id, 'student_id'), strategy_id: text(value.strategy_id, 'strategy_id'),
        strategy_type: 'TRAINING_PRACTICE', strategy_version: integer(value.strategy_version, 'strategy_version', 1),
        job_code: text(value.job_code, 'job_code'), task_code: text(value.task_code, 'task_code'),
        module_type: text(value.module_type, 'module_type'), total_steps: 4, created_by: input.envelope.actorId,
        step_records: steps
      } as unknown as Record<string, CanonicalJsonValue>
      return { schemaVersion: COMMAND_PLAN_SCHEMA_VERSION, commandId: input.envelope.commandId, commandType: command,
        planVersion, resultRecipeVersion, events: [event(input.envelope, planVersion, resultRecipeVersion, 0, 'TRAINING_STARTED', 1, sessionId, timestamp, payload)],
        operationalEffects: [], noOpResult: null }
    }
    if (value.kind !== 'STEP') throw new TrainingPlannerError('INVALID_INPUT', 'snapshot kind is invalid')
    const session = record(value.session, 'session')
    const step = record(value.step, 'step')
    const eventType: StepEvent = command === 'training:startStep' ? 'TRAINING_STEP_STARTED'
      : command === 'training:completeStep' ? 'TRAINING_STEP_COMPLETED'
        : command === 'training:skipStep' ? 'TRAINING_STEP_SKIPPED'
          : command === 'training:failStep' ? 'TRAINING_STEP_FAILED' : 'TRAINING_STEP_RETRIED'
    const sessionId = text(session.training_session_id, 'session.training_session_id')
    const sequence = integer(session.next_event_sequence, 'session.next_event_sequence', 1)
    const stepPayload = {
      actor_role: 'STUDENT', app_version: text(value.app_version, 'app_version'), correlation_id: input.envelope.correlationId,
      training_session_id: sessionId, step_record_id: text(step.step_record_id, 'step.step_record_id'),
      step_type: text(step.step_type, 'step.step_type'), step_order: integer(step.step_order, 'step.step_order', 1),
      status_before: text(step.status_before, 'step.status_before'), status_after: text(step.status_after, 'step.status_after'),
      attempt_count_before: integer(step.attempt_count_before, 'step.attempt_count_before'),
      attempt_count_after: integer(step.attempt_count_after, 'step.attempt_count_after'),
      session_status_before: text(session.status_before, 'session.status_before'),
      session_status_after: text(session.status_after, 'session.status_after'),
      session_completed: bool(step.session_completed, 'step.session_completed'), occurred_at: timestamp
    } as Record<string, CanonicalJsonValue>
    const events: EventIntentV1[] = [event(input.envelope, planVersion, resultRecipeVersion, 0, eventType, sequence, sessionId, timestamp, stepPayload)]
    if (bool(step.session_completed, 'step.session_completed')) {
      const completedPayload = {
        actor_role: 'STUDENT', app_version: text(value.app_version, 'app_version'), correlation_id: input.envelope.correlationId,
        training_session_id: sessionId, completed_at: timestamp,
        total_steps: integer(session.total_steps, 'session.total_steps', 1),
        completed_steps: integer(session.completed_steps, 'session.completed_steps'),
        skipped_steps: integer(step.skipped_steps, 'step.skipped_steps'), failed_steps: integer(step.failed_steps, 'step.failed_steps'),
        completion_rate: number(session.completion_rate, 'session.completion_rate'),
        result_id: text(step.result_id, 'step.result_id'), level_result: text(step.level_result, 'step.level_result'),
        completion_ratio: number(session.completion_rate, 'session.completion_rate') / 100,
        student_id: text(session.student_id, 'session.student_id'), strategy_id: text(session.strategy_id, 'session.strategy_id'),
        strategy_version: integer(session.strategy_version, 'session.strategy_version', 1),
        job_code: text(session.job_code, 'session.job_code'), module_type: session.module_type ?? null
      } as Record<string, CanonicalJsonValue>
      events.push(event(input.envelope, planVersion, resultRecipeVersion, 1, 'TRAINING_COMPLETED', sequence + 1, sessionId, timestamp, completedPayload))
    }
    return { schemaVersion: COMMAND_PLAN_SCHEMA_VERSION, commandId: input.envelope.commandId, commandType: command,
      planVersion, resultRecipeVersion, events, operationalEffects: [], noOpResult: null }
  }
}
