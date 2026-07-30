// 训练会话（training_session）application service。
// mutation 只通过 composition root 注入的 legacy event port 写事件，
// 并要求 Command Bus 已接受的执行上下文提供 correlation。
//
// 事务边界：db.transaction(() => { writeEvent(...); applyTrainingEvent(...) })
// jsonl appendFileSync 不可回滚，由 reducer 幂等性 + 冷启动重放兜底。

import { v4 as uuidv4 } from 'uuid'
import type { DBAdapter } from '../../db/interface'
import { assertCaller, assertStudent } from '../../utils/auth-context'
import type { ReportMutationPort } from '../../domain/report-command-coordinator'
import type { AcceptedCommandContext } from '../command/command-types'
import type {
  CreateTrainingSessionParams,
  CreateTrainingSessionResult,
  TrainingStepActionParams,
  TrainingStepActionResult
} from '@shared/types/training'
import type {
  TrainingStartedPayload,
  TrainingCompletedPayload
} from '@shared/types/event-payloads'
import { applyTrainingEvent } from '../../domain/training-reducer'

export interface TrainingMutationExecution {
  readonly eventPort: Pick<ReportMutationPort, 'writeEvent'>
  readonly context: AcceptedCommandContext
}

const TRAINING_MUTATION_COMMANDS = new Set([
  'training:createSession',
  'training:startStep',
  'training:completeStep',
  'training:skipStep',
  'training:failStep',
  'training:retryStep'
])

export const TRAINING_HALT_CHILD_CAPABILITY = Object.freeze({
  owner: 'training-service.haltTrainingSessionSteps',
  parentCommandTypes: Object.freeze(['assessment:triggerRedline'] as const),
  phase: 'RUNTIME_ACCEPTED_CHILD',
  targetFields: Object.freeze(['student_id', 'job_code', 'task_code'] as const),
  correlationPolicy: 'INHERIT_PARENT' as const
})

function correlationFor(
  execution: TrainingMutationExecution,
  expectedCommandType: string
): string {
  const { envelope } = execution.context
  if (!TRAINING_MUTATION_COMMANDS.has(expectedCommandType) || envelope.commandType !== expectedCommandType) {
    throw new Error(`training mutation requires accepted ${expectedCommandType} context`)
  }
  if (!envelope.correlationId.trim()) throw new Error('training mutation correlation must be non-empty')
  return envelope.correlationId
}

// 开放训练会话状态（与 schema partial unique index WHERE 子句一致）
const OPEN_TRAINING_STATUSES = [
  'INIT',
  'ACTIVE',
  'EMOTION_INTERRUPTED',
  'SUSPENDED_REVIEW_REQUIRED'
] as const

// ---------------------------------------------------------------------------
// createTrainingSession — Step 4
// ---------------------------------------------------------------------------

interface StrategyRow {
  strategy_type: string
  job_code: string
  version: number
}

export function createTrainingSession(
  db: DBAdapter,
  params: CreateTrainingSessionParams,
  execution: TrainingMutationExecution
): CreateTrainingSessionResult {
  const correlationId = correlationFor(execution, 'training:createSession')
  // 1. 身份校验（TEACHER）
  const caller = assertCaller(db, params.callerUserId, params.callerRole)
  if (!caller.ok) return { success: false, errorCode: 'FORBIDDEN' }

  // 2. 参数基础校验
  if (typeof params.studentId !== 'string' || params.studentId.length === 0) {
    return { success: false, errorCode: 'NOT_FOUND' }
  }
  if (typeof params.strategyId !== 'string' || params.strategyId.length === 0) {
    return { success: false, errorCode: 'NOT_FOUND' }
  }
  if (
    typeof params.strategyVersion !== 'number' ||
    !Number.isInteger(params.strategyVersion) ||
    params.strategyVersion < 1
  ) {
    return { success: false, errorCode: 'NOT_FOUND' }
  }
  if (typeof params.taskCode !== 'string' || params.taskCode.trim().length === 0) {
    return { success: false, errorCode: 'VALIDATION_ERROR' }
  }
  if (typeof params.moduleType !== 'string' || params.moduleType.length === 0) {
    return { success: false, errorCode: 'VALIDATION_ERROR' }
  }

  // 3. 读 strategy_config + 校验 strategy_type = TRAINING_PRACTICE
  const strategy = db
    .prepare(
      `SELECT strategy_type, job_code, version
         FROM strategy_config
        WHERE strategy_id = ? AND version = ?`
    )
    .get(params.strategyId, params.strategyVersion) as StrategyRow | undefined
  if (!strategy) return { success: false, errorCode: 'NOT_FOUND' }
  if (strategy.strategy_type !== 'TRAINING_PRACTICE') {
    return { success: false, errorCode: 'VALIDATION_ERROR' }
  }

  // 4. 校验 student 存在且 ACTIVE（student_profile + user_account 双 ACTIVE）
  const student = db
    .prepare(
      `SELECT s.student_id
         FROM student_profile s
         JOIN user_account u ON u.user_id = s.student_id
        WHERE s.student_id = ? AND s.status = 'ACTIVE' AND u.status = 'ACTIVE'`
    )
    .get(params.studentId) as { student_id: string } | undefined
  if (!student) return { success: false, errorCode: 'NOT_FOUND' }

  // 5. 校验同 student/job/task 下无开放 training_session（DUPLICATE_TRAINING_SESSION）
  const placeholders = OPEN_TRAINING_STATUSES.map(() => '?').join(', ')
  const openSession = db
    .prepare(
      `SELECT 1 FROM training_session
        WHERE student_id = ? AND job_code = ? AND task_code = ?
          AND status IN (${placeholders})
        LIMIT 1`
    )
    .get(params.studentId, strategy.job_code, params.taskCode, ...OPEN_TRAINING_STATUSES) as { 1: number } | undefined
  if (openSession) return { success: false, errorCode: 'DUPLICATE_TRAINING_SESSION' }

  // 6. 校验同 student/job/task 下无未解决安全事件
  const blocked = db
    .prepare(
      `SELECT 1 FROM safety_incident
        WHERE student_id = ? AND job_code = ? AND task_code = ?
          AND requires_review_before_next_session = 1
          AND status IN ('PENDING_DETAIL', 'CONFIRMED')
        LIMIT 1`
    )
    .get(params.studentId, strategy.job_code, params.taskCode) as { 1: number } | undefined
  if (blocked) return { success: false, errorCode: 'BLOCKED_BY_SAFETY_INCIDENT' }

  // 7. 写事件 + reducer（事务内）
  const trainingSessionId = uuidv4()
  const businessSessionId = trainingSessionId
  const payload: TrainingStartedPayload = {
    training_session_id: trainingSessionId,
    business_session_id: businessSessionId,
    student_id: params.studentId,
    strategy_id: params.strategyId,
    strategy_type: 'TRAINING_PRACTICE',
    strategy_version: params.strategyVersion,
    job_code: strategy.job_code,
    task_code: params.taskCode,
    total_steps: 4,
    step_order: ['WATCH', 'LEARN', 'PRACTICE', 'DO'],
    module_type: params.moduleType
  }

  try {
    const tx = db.transaction(() => {
      const entry = execution.eventPort.writeEvent({
        aggregateType: 'TRAINING_SESSION',
        aggregateId: trainingSessionId,
        eventType: 'TRAINING_STARTED',
        payload: payload as unknown as Record<string, unknown>,
        actorId: caller.row.user_id,
        actorRole: 'TEACHER',
        correlationId
      })
      applyTrainingEvent(db, entry)
    })
    tx()
  } catch (err) {
    console.error('[training:createSession]', err)
    return { success: false, errorCode: 'TRAINING_SYSTEM_ERROR' }
  }

  return { success: true, trainingSessionId, businessSessionId, status: 'INIT' }
}

// ---------------------------------------------------------------------------
// finalizeTrainingSession — 内部：所有步骤处理完毕时调用（Step 6）
// ---------------------------------------------------------------------------

function finalizeTrainingSession(
  db: DBAdapter,
  trainingSessionId: string,
  execution: TrainingMutationExecution,
  correlationId: string
): void {
  const ts = db
    .prepare(
      `SELECT total_step_count, student_id, created_by FROM training_session WHERE training_session_id = ?`
    )
    .get(trainingSessionId) as {
    total_step_count: number
    student_id: string
    created_by: string
  } | undefined
  if (!ts) return

  const counts = db
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completed_steps,
         SUM(CASE WHEN status = 'SKIPPED'   THEN 1 ELSE 0 END) as skipped_steps,
         SUM(CASE WHEN status = 'FAILED'    THEN 1 ELSE 0 END) as failed_steps
       FROM training_step_record
      WHERE training_session_id = ?`
    )
    .get(trainingSessionId) as {
    completed_steps: number
    skipped_steps: number
    failed_steps: number
  }

  const totalSteps = ts.total_step_count
  const completedSteps = counts.completed_steps ?? 0
  const completionRate = totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0

  const payload: TrainingCompletedPayload = {
    training_session_id: trainingSessionId,
    completed_at: new Date().toISOString(),
    total_steps: totalSteps,
    completed_steps: completedSteps,
    skipped_steps: counts.skipped_steps ?? 0,
    failed_steps: counts.failed_steps ?? 0,
    completion_rate: completionRate
  }

  const tx = db.transaction(() => {
    const entry = execution.eventPort.writeEvent({
      aggregateType: 'TRAINING_SESSION',
      aggregateId: trainingSessionId,
      eventType: 'TRAINING_COMPLETED',
      payload: payload as unknown as Record<string, unknown>,
      actorId: ts.created_by,
      actorRole: 'SYSTEM',
      correlationId
    })
    applyTrainingEvent(db, entry)
  })
  tx()
}

// ---------------------------------------------------------------------------
// 内部辅助：步骤操作前置校验
// ---------------------------------------------------------------------------

interface SessionRow {
  training_session_id: string
  student_id: string
  status: string
}

interface StepRow {
  training_step_record_id: string
  training_session_id: string
  step_type: string
  step_order: number
  status: string
  attempt_count: number
}

interface StepContext {
  session: SessionRow
  step: StepRow
}

function loadStepContext(
  db: DBAdapter,
  params: TrainingStepActionParams
): { ok: true; ctx: StepContext } | { ok: false; errorCode: import('@shared/types/training').TrainingErrorCode } {
  // 1. STUDENT 身份校验
  const caller = assertStudent(db, params.callerUserId, params.callerRole)
  if (!caller.ok) return { ok: false, errorCode: 'FORBIDDEN' }

  // 2. 读 training_session
  const session = db
    .prepare(
      `SELECT training_session_id, student_id, status
         FROM training_session
        WHERE training_session_id = ?`
    )
    .get(params.trainingSessionId) as SessionRow | undefined
  if (!session) return { ok: false, errorCode: 'NOT_FOUND' }

  // 只有 session 属于该 student 才可操作
  if (session.student_id !== caller.row.user_id) return { ok: false, errorCode: 'FORBIDDEN' }

  // 终态拒绝
  if (session.status === 'REDLINE_HALTED') return { ok: false, errorCode: 'SESSION_HALTED' }
  if (session.status === 'COMPLETED' || session.status === 'ABORTED') {
    return { ok: false, errorCode: 'SESSION_NOT_ACTIVE' }
  }

  // 3. 读 training_step_record
  const step = db
    .prepare(
      `SELECT training_step_record_id, training_session_id, step_type, step_order, status, attempt_count
         FROM training_step_record
        WHERE training_step_record_id = ? AND training_session_id = ?`
    )
    .get(params.stepRecordId, params.trainingSessionId) as StepRow | undefined
  if (!step) return { ok: false, errorCode: 'STEP_NOT_FOUND' }

  return { ok: true, ctx: { session, step } }
}

/** 检查前序步骤是否已经开始（status != NOT_STARTED） */
function checkPrerequisite(
  db: DBAdapter,
  trainingSessionId: string,
  stepOrder: number
): boolean {
  const notStarted = db
    .prepare(
      `SELECT COUNT(*) as cnt FROM training_step_record
        WHERE training_session_id = ? AND step_order < ? AND status = 'NOT_STARTED'`
    )
    .get(trainingSessionId, stepOrder) as { cnt: number }
  return notStarted.cnt === 0
}

/** 检查是否所有步骤均已处理（无 NOT_STARTED 剩余） */
function checkSessionCompletion(db: DBAdapter, trainingSessionId: string): boolean {
  const remaining = db
    .prepare(
      `SELECT COUNT(*) as cnt FROM training_step_record
        WHERE training_session_id = ? AND status = 'NOT_STARTED'`
    )
    .get(trainingSessionId) as { cnt: number }
  return remaining.cnt === 0
}

// ---------------------------------------------------------------------------
// startStep / completeStep / skipStep / failStep / retryStep — Step 5
// ---------------------------------------------------------------------------

export function startStep(
  db: DBAdapter,
  params: TrainingStepActionParams,
  execution: TrainingMutationExecution
): TrainingStepActionResult {
  const correlationId = correlationFor(execution, 'training:startStep')
  const check = loadStepContext(db, params)
  if (!check.ok) return { success: false, errorCode: check.errorCode }
  const { session, step } = check.ctx

  if (step.status !== 'NOT_STARTED') return { success: false, errorCode: 'STEP_INVALID_TRANSITION' }
  if (!checkPrerequisite(db, session.training_session_id, step.step_order)) {
    return { success: false, errorCode: 'STEP_PREREQUISITE_NOT_MET' }
  }

  try {
    const tx = db.transaction(() => {
      const entry = execution.eventPort.writeEvent({
        aggregateType: 'TRAINING_SESSION',
        aggregateId: session.training_session_id,
        eventType: 'TRAINING_STEP_STARTED',
        payload: {
          training_session_id: session.training_session_id,
          step_record_id: step.training_step_record_id,
          step_type: step.step_type,
          step_order: step.step_order,
          started_at: new Date().toISOString()
        },
        actorId: params.callerUserId,
        actorRole: 'STUDENT',
        correlationId
      })
      applyTrainingEvent(db, entry)
    })
    tx()
  } catch (err) {
    console.error('[training:startStep]', err)
    return { success: false, errorCode: 'TRAINING_SYSTEM_ERROR' }
  }

  return { success: true, stepRecordId: step.training_step_record_id, newStatus: 'IN_PROGRESS' }
}

export function completeStep(
  db: DBAdapter,
  params: TrainingStepActionParams,
  execution: TrainingMutationExecution
): TrainingStepActionResult {
  const correlationId = correlationFor(execution, 'training:completeStep')
  const check = loadStepContext(db, params)
  if (!check.ok) return { success: false, errorCode: check.errorCode }
  const { session, step } = check.ctx

  if (step.status !== 'IN_PROGRESS') return { success: false, errorCode: 'STEP_INVALID_TRANSITION' }
  if (!checkPrerequisite(db, session.training_session_id, step.step_order)) {
    return { success: false, errorCode: 'STEP_PREREQUISITE_NOT_MET' }
  }

  try {
    const tx = db.transaction(() => {
      const entry = execution.eventPort.writeEvent({
        aggregateType: 'TRAINING_SESSION',
        aggregateId: session.training_session_id,
        eventType: 'TRAINING_STEP_COMPLETED',
        payload: {
          training_session_id: session.training_session_id,
          step_record_id: step.training_step_record_id,
          step_type: step.step_type,
          step_order: step.step_order,
          completed_at: new Date().toISOString()
        },
        actorId: params.callerUserId,
        actorRole: 'STUDENT',
        correlationId
      })
      applyTrainingEvent(db, entry)
    })
    tx()
  } catch (err) {
    console.error('[training:completeStep]', err)
    return { success: false, errorCode: 'TRAINING_SYSTEM_ERROR' }
  }

  const sessionCompleted = checkSessionCompletion(db, session.training_session_id)
  if (sessionCompleted) {
    finalizeTrainingSession(db, session.training_session_id, execution, correlationId)
  }
  return { success: true, stepRecordId: step.training_step_record_id, newStatus: 'COMPLETED', sessionCompleted }
}

export function skipStep(
  db: DBAdapter,
  params: TrainingStepActionParams,
  execution: TrainingMutationExecution
): TrainingStepActionResult {
  const correlationId = correlationFor(execution, 'training:skipStep')
  const check = loadStepContext(db, params)
  if (!check.ok) return { success: false, errorCode: check.errorCode }
  const { session, step } = check.ctx

  if (step.status !== 'NOT_STARTED' && step.status !== 'IN_PROGRESS') {
    return { success: false, errorCode: 'STEP_INVALID_TRANSITION' }
  }

  try {
    const tx = db.transaction(() => {
      const entry = execution.eventPort.writeEvent({
        aggregateType: 'TRAINING_SESSION',
        aggregateId: session.training_session_id,
        eventType: 'TRAINING_STEP_SKIPPED',
        payload: {
          training_session_id: session.training_session_id,
          step_record_id: step.training_step_record_id,
          step_type: step.step_type,
          step_order: step.step_order,
          skipped_at: new Date().toISOString()
        },
        actorId: params.callerUserId,
        actorRole: 'STUDENT',
        correlationId
      })
      applyTrainingEvent(db, entry)
    })
    tx()
  } catch (err) {
    console.error('[training:skipStep]', err)
    return { success: false, errorCode: 'TRAINING_SYSTEM_ERROR' }
  }

  const sessionCompleted = checkSessionCompletion(db, session.training_session_id)
  if (sessionCompleted) {
    finalizeTrainingSession(db, session.training_session_id, execution, correlationId)
  }
  return { success: true, stepRecordId: step.training_step_record_id, newStatus: 'SKIPPED', sessionCompleted }
}

export function failStep(
  db: DBAdapter,
  params: TrainingStepActionParams,
  execution: TrainingMutationExecution
): TrainingStepActionResult {
  const correlationId = correlationFor(execution, 'training:failStep')
  const check = loadStepContext(db, params)
  if (!check.ok) return { success: false, errorCode: check.errorCode }
  const { session, step } = check.ctx

  if (step.status !== 'IN_PROGRESS') return { success: false, errorCode: 'STEP_INVALID_TRANSITION' }

  try {
    const tx = db.transaction(() => {
      const entry = execution.eventPort.writeEvent({
        aggregateType: 'TRAINING_SESSION',
        aggregateId: session.training_session_id,
        eventType: 'TRAINING_STEP_FAILED',
        payload: {
          training_session_id: session.training_session_id,
          step_record_id: step.training_step_record_id,
          step_type: step.step_type,
          step_order: step.step_order,
          failed_at: new Date().toISOString()
        },
        actorId: params.callerUserId,
        actorRole: 'STUDENT',
        correlationId
      })
      applyTrainingEvent(db, entry)
    })
    tx()
  } catch (err) {
    console.error('[training:failStep]', err)
    return { success: false, errorCode: 'TRAINING_SYSTEM_ERROR' }
  }

  const sessionCompleted = checkSessionCompletion(db, session.training_session_id)
  if (sessionCompleted) {
    finalizeTrainingSession(db, session.training_session_id, execution, correlationId)
  }
  return { success: true, stepRecordId: step.training_step_record_id, newStatus: 'FAILED', sessionCompleted }
}

export function retryStep(
  db: DBAdapter,
  params: TrainingStepActionParams,
  execution: TrainingMutationExecution
): TrainingStepActionResult {
  const correlationId = correlationFor(execution, 'training:retryStep')
  const check = loadStepContext(db, params)
  if (!check.ok) return { success: false, errorCode: check.errorCode }
  const { session, step } = check.ctx

  if (step.status !== 'FAILED') return { success: false, errorCode: 'STEP_INVALID_TRANSITION' }

  const newAttemptCount = step.attempt_count + 1

  try {
    const tx = db.transaction(() => {
      const entry = execution.eventPort.writeEvent({
        aggregateType: 'TRAINING_SESSION',
        aggregateId: session.training_session_id,
        eventType: 'TRAINING_STEP_RETRIED',
        payload: {
          training_session_id: session.training_session_id,
          step_record_id: step.training_step_record_id,
          step_type: step.step_type,
          step_order: step.step_order,
          attempt_count: newAttemptCount,
          retried_at: new Date().toISOString()
        },
        actorId: params.callerUserId,
        actorRole: 'STUDENT',
        correlationId
      })
      applyTrainingEvent(db, entry)
    })
    tx()
  } catch (err) {
    console.error('[training:retryStep]', err)
    return { success: false, errorCode: 'TRAINING_SYSTEM_ERROR' }
  }

  return { success: true, stepRecordId: step.training_step_record_id, newStatus: 'IN_PROGRESS' }
}

// ---------------------------------------------------------------------------
// haltTrainingSessionSteps — 安全红线 accepted child capability。
// 由 assessment:triggerRedline 事务提交后调用（在事务外，schema trigger 已 HALT session）。
// ---------------------------------------------------------------------------
export function haltTrainingSessionSteps(
  db: DBAdapter,
  context: AcceptedCommandContext
): void {
  if (!TRAINING_HALT_CHILD_CAPABILITY.parentCommandTypes.some(
    (commandType) => commandType === context.envelope.commandType
  )) {
    throw new Error('training halt requires accepted assessment:triggerRedline parent')
  }
  if (!context.envelope.correlationId.trim()) {
    throw new Error('training halt child correlation must be non-empty')
  }
  const studentId = context.envelope.target.student_id
  const jobCode = context.envelope.target.job_code
  const taskCode = context.envelope.target.task_code
  if (
    typeof studentId !== 'string' || !studentId.trim()
    || typeof jobCode !== 'string' || !jobCode.trim()
    || typeof taskCode !== 'string' || !taskCode.trim()
  ) {
    throw new Error('training halt requires authoritative student/job/task target')
  }
  const haltedSessions = db
    .prepare(
      `SELECT training_session_id FROM training_session
        WHERE student_id = ? AND job_code = ? AND task_code = ? AND status = 'REDLINE_HALTED'`
    )
    .all(studentId, jobCode, taskCode) as Array<{ training_session_id: string }>

  for (const { training_session_id } of haltedSessions) {
    db.prepare(
      `UPDATE training_step_record SET status = 'FAILED', updated_at = datetime('now')
        WHERE training_session_id = ? AND status = 'IN_PROGRESS'`
    ).run(training_session_id)
  }
}

// 导出 applyTrainingEvent 供测试复用
export { applyTrainingEvent }
