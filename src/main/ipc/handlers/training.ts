// 训练会话（training_session）handler 模块。
// 核心逻辑抽成纯函数，接收 DBAdapter；registerTrainingHandlers 是薄包装。
// 测试直接调纯函数 + 注入 MemoryAdapter（与 assessment.ts 同模式）。
//
// 事务边界：db.transaction(() => { writeEvent(...); applyTrainingEvent(...) })
// jsonl appendFileSync 不可回滚，由 reducer 幂等性 + 冷启动重放兜底。

import { ipcMain } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import type { DBAdapter } from '../../db/interface'
import { SqliteAdapter } from '../../db/sqlite-adapter'
import { getDatabase } from '../../db/connection'
import { assertCaller, assertStudent } from '../../utils/auth-context'
import { writeEvent } from '../../domain/event-writer'
import type {
  CreateTrainingSessionParams,
  CreateTrainingSessionResult,
  ListTrainingSessionsParams,
  ListTrainingSessionsResult,
  ListTrainingSessionsSuccess,
  TrainingSessionListItem,
  GetTrainingSessionParams,
  GetTrainingSessionResult,
  GetTrainingSessionSuccess,
  TrainingSessionDetail,
  TrainingStepView,
  TrainingStepActionParams,
  TrainingStepActionResult,
  TrainingSessionStatus,
  TrainingStepStatus,
  TrainingStepType
} from '@shared/types/training'
import type {
  TrainingStartedPayload,
  TrainingCompletedPayload
} from '@shared/types/event-payloads'
import { applyTrainingEvent } from '../../domain/training-reducer'

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
  params: CreateTrainingSessionParams
): CreateTrainingSessionResult {
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

  // 5. 校验无开放 training_session（DUPLICATE_TRAINING_SESSION）
  const placeholders = OPEN_TRAINING_STATUSES.map(() => '?').join(', ')
  const openSession = db
    .prepare(
      `SELECT 1 FROM training_session
        WHERE student_id = ? AND task_code = ?
          AND status IN (${placeholders})
        LIMIT 1`
    )
    .get(params.studentId, params.taskCode, ...OPEN_TRAINING_STATUSES) as { 1: number } | undefined
  if (openSession) return { success: false, errorCode: 'DUPLICATE_TRAINING_SESSION' }

  // 6. 校验无未解决安全事件
  const blocked = db
    .prepare(
      `SELECT 1 FROM safety_incident
        WHERE student_id = ? AND task_code = ?
          AND requires_review_before_next_session = 1
          AND status IN ('PENDING_DETAIL', 'CONFIRMED')
        LIMIT 1`
    )
    .get(params.studentId, params.taskCode) as { 1: number } | undefined
  if (blocked) return { success: false, errorCode: 'BLOCKED_BY_SAFETY_INCIDENT' }

  // 7. 写事件 + reducer（事务内）
  const trainingSessionId = uuidv4()
  const payload: TrainingStartedPayload = {
    training_session_id: trainingSessionId,
    student_id: params.studentId,
    strategy_id: params.strategyId,
    strategy_type: 'TRAINING_PRACTICE',
    strategy_version: params.strategyVersion,
    job_code: strategy.job_code,
    task_code: params.taskCode,
    total_steps: 4,
    step_order: ['WATCH', 'LEARN', 'PRACTICE', 'DO']
  }

  try {
    const tx = db.transaction(() => {
      const entry = writeEvent({
        aggregateType: 'TRAINING_SESSION',
        aggregateId: trainingSessionId,
        eventType: 'TRAINING_STARTED',
        payload: payload as unknown as Record<string, unknown>,
        actorId: caller.row.user_id,
        actorRole: 'TEACHER'
      })
      applyTrainingEvent(db, entry)
    })
    tx()
  } catch (err) {
    console.error('[training:createSession]', err)
    return { success: false, errorCode: 'TRAINING_SYSTEM_ERROR' }
  }

  // 8. 更新 module_type（reducer INSERT 后补填，不含于事件 payload 以保简洁）
  db.prepare(
    `UPDATE training_session SET module_type = ?, updated_at = datetime('now')
      WHERE training_session_id = ?`
  ).run(params.moduleType, trainingSessionId)

  return { success: true, trainingSessionId, status: 'INIT' }
}

// ---------------------------------------------------------------------------
// finalizeTrainingSession — 内部：所有步骤处理完毕时调用（Step 6）
// ---------------------------------------------------------------------------

function finalizeTrainingSession(db: DBAdapter, trainingSessionId: string): void {
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
    const entry = writeEvent({
      aggregateType: 'TRAINING_SESSION',
      aggregateId: trainingSessionId,
      eventType: 'TRAINING_COMPLETED',
      payload: payload as unknown as Record<string, unknown>,
      actorId: ts.created_by,
      actorRole: 'SYSTEM'
    })
    applyTrainingEvent(db, entry)
  })
  tx()
}

// ---------------------------------------------------------------------------
// listTrainingSessions — Step 6
// ---------------------------------------------------------------------------

interface TrainingSessionListRow {
  training_session_id: string
  student_id: string
  module_type: string | null
  status: string
  total_step_count: number
  completed_step_count: number
  completion_rate: number | null
  created_by: string
  started_at: string | null
  completed_at: string | null
}

export function listTrainingSessions(
  db: DBAdapter,
  params: ListTrainingSessionsParams
): ListTrainingSessionsResult {
  const caller = assertCaller(db, params.callerUserId, params.callerRole)
  if (!caller.ok) return { success: false, errorCode: 'FORBIDDEN' }

  const limit = typeof params.limit === 'number' ? params.limit : 50
  const offset = typeof params.offset === 'number' ? params.offset : 0

  const rows = db
    .prepare(
      `SELECT ts.training_session_id, ts.student_id, ts.module_type, ts.status,
              ts.total_step_count, ts.completed_step_count, ts.completion_rate,
              ts.created_by, ts.started_at, ts.completed_at
         FROM training_session ts
        WHERE (ts.student_id = ? OR ? IS NULL)
          AND (ts.status = ? OR ? IS NULL)
        ORDER BY ts.updated_at DESC
        LIMIT ? OFFSET ?`
    )
    .all(
      params.studentId ?? null,
      params.studentId ?? null,
      params.status ?? null,
      params.status ?? null,
      limit,
      offset
    ) as TrainingSessionListRow[]

  const countRow = db
    .prepare(
      `SELECT COUNT(*) as total FROM training_session
        WHERE (student_id = ? OR ? IS NULL) AND (status = ? OR ? IS NULL)`
    )
    .get(
      params.studentId ?? null,
      params.studentId ?? null,
      params.status ?? null,
      params.status ?? null
    ) as { total: number }

  const sessions: TrainingSessionListItem[] = rows.map((r) => ({
    trainingSessionId: r.training_session_id,
    studentId: r.student_id,
    moduleType: r.module_type,
    status: r.status as TrainingSessionStatus,
    totalStepCount: r.total_step_count,
    completedStepCount: r.completed_step_count,
    completionRate: r.completion_rate,
    createdBy: r.created_by,
    startedAt: r.started_at,
    completedAt: r.completed_at
  }))

  const success: ListTrainingSessionsSuccess = { success: true, sessions, total: countRow.total }
  return success
}

// ---------------------------------------------------------------------------
// getTrainingSession — Step 6
// ---------------------------------------------------------------------------

interface TrainingStepRow {
  training_step_record_id: string
  step_code: string
  step_name: string
  step_order: number
  step_type: string
  status: string
  attempt_count: number
  started_at: string | null
  completed_at: string | null
}

export function getTrainingSession(
  db: DBAdapter,
  params: GetTrainingSessionParams
): GetTrainingSessionResult {
  if (typeof params.trainingSessionId !== 'string' || params.trainingSessionId.length === 0) {
    return { success: false, errorCode: 'NOT_FOUND' }
  }

  // TEACHER/ADMIN 或 STUDENT（只能读自己的）
  const isTeacher = params.callerRole === 'TEACHER' || params.callerRole === 'ADMIN'
  const isStudent = params.callerRole === 'STUDENT'
  if (!isTeacher && !isStudent) return { success: false, errorCode: 'FORBIDDEN' }

  // 验证 caller 账号存在且 ACTIVE
  const callerRow = db
    .prepare(`SELECT user_id, role, status FROM user_account WHERE user_id = ? AND status = 'ACTIVE'`)
    .get(params.callerUserId) as { user_id: string; role: string; status: string } | undefined
  if (!callerRow || callerRow.role !== params.callerRole) {
    return { success: false, errorCode: 'FORBIDDEN' }
  }

  const session = db
    .prepare(
      `SELECT training_session_id, student_id, strategy_id, strategy_version,
              module_type, status, total_step_count, completed_step_count,
              completion_rate, created_by, started_at, completed_at
         FROM training_session WHERE training_session_id = ?`
    )
    .get(params.trainingSessionId) as (TrainingSessionListRow & {
    strategy_id: string
    strategy_version: number
  }) | undefined
  if (!session) return { success: false, errorCode: 'NOT_FOUND' }

  // STUDENT 只能读自己的
  if (isStudent && session.student_id !== params.callerUserId) {
    return { success: false, errorCode: 'FORBIDDEN' }
  }

  const stepRows = db
    .prepare(
      `SELECT training_step_record_id, step_code, step_name, step_order, step_type,
              status, attempt_count, started_at, completed_at
         FROM training_step_record
        WHERE training_session_id = ?
        ORDER BY step_order ASC`
    )
    .all(params.trainingSessionId) as TrainingStepRow[]

  const steps: TrainingStepView[] = stepRows.map((s) => ({
    stepRecordId: s.training_step_record_id,
    stepCode: s.step_code,
    stepName: s.step_name,
    stepOrder: s.step_order,
    stepType: s.step_type as TrainingStepType,
    status: s.status as TrainingStepStatus,
    attemptCount: s.attempt_count,
    startedAt: s.started_at,
    completedAt: s.completed_at
  }))

  const detail: TrainingSessionDetail = {
    trainingSessionId: session.training_session_id,
    studentId: session.student_id,
    strategyId: session.strategy_id,
    strategyVersion: session.strategy_version,
    moduleType: session.module_type,
    status: session.status as TrainingSessionStatus,
    totalStepCount: session.total_step_count,
    completedStepCount: session.completed_step_count,
    completionRate: session.completion_rate,
    steps,
    createdBy: session.created_by,
    startedAt: session.started_at,
    completedAt: session.completed_at
  }

  const success: GetTrainingSessionSuccess = { success: true, session: detail }
  return success
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
  params: TrainingStepActionParams
): TrainingStepActionResult {
  const check = loadStepContext(db, params)
  if (!check.ok) return { success: false, errorCode: check.errorCode }
  const { session, step } = check.ctx

  if (step.status !== 'NOT_STARTED') return { success: false, errorCode: 'STEP_INVALID_TRANSITION' }
  if (!checkPrerequisite(db, session.training_session_id, step.step_order)) {
    return { success: false, errorCode: 'STEP_PREREQUISITE_NOT_MET' }
  }

  try {
    const tx = db.transaction(() => {
      const entry = writeEvent({
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
        actorRole: 'STUDENT'
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
  params: TrainingStepActionParams
): TrainingStepActionResult {
  const check = loadStepContext(db, params)
  if (!check.ok) return { success: false, errorCode: check.errorCode }
  const { session, step } = check.ctx

  if (step.status !== 'IN_PROGRESS') return { success: false, errorCode: 'STEP_INVALID_TRANSITION' }
  if (!checkPrerequisite(db, session.training_session_id, step.step_order)) {
    return { success: false, errorCode: 'STEP_PREREQUISITE_NOT_MET' }
  }

  try {
    const tx = db.transaction(() => {
      const entry = writeEvent({
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
        actorRole: 'STUDENT'
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
    finalizeTrainingSession(db, session.training_session_id)
  }
  return { success: true, stepRecordId: step.training_step_record_id, newStatus: 'COMPLETED', sessionCompleted }
}

export function skipStep(
  db: DBAdapter,
  params: TrainingStepActionParams
): TrainingStepActionResult {
  const check = loadStepContext(db, params)
  if (!check.ok) return { success: false, errorCode: check.errorCode }
  const { session, step } = check.ctx

  if (step.status !== 'NOT_STARTED' && step.status !== 'IN_PROGRESS') {
    return { success: false, errorCode: 'STEP_INVALID_TRANSITION' }
  }

  try {
    const tx = db.transaction(() => {
      const entry = writeEvent({
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
        actorRole: 'STUDENT'
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
    finalizeTrainingSession(db, session.training_session_id)
  }
  return { success: true, stepRecordId: step.training_step_record_id, newStatus: 'SKIPPED', sessionCompleted }
}

export function failStep(
  db: DBAdapter,
  params: TrainingStepActionParams
): TrainingStepActionResult {
  const check = loadStepContext(db, params)
  if (!check.ok) return { success: false, errorCode: check.errorCode }
  const { session, step } = check.ctx

  if (step.status !== 'IN_PROGRESS') return { success: false, errorCode: 'STEP_INVALID_TRANSITION' }

  try {
    const tx = db.transaction(() => {
      const entry = writeEvent({
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
        actorRole: 'STUDENT'
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
    finalizeTrainingSession(db, session.training_session_id)
  }
  return { success: true, stepRecordId: step.training_step_record_id, newStatus: 'FAILED', sessionCompleted }
}

export function retryStep(
  db: DBAdapter,
  params: TrainingStepActionParams
): TrainingStepActionResult {
  const check = loadStepContext(db, params)
  if (!check.ok) return { success: false, errorCode: check.errorCode }
  const { session, step } = check.ctx

  if (step.status !== 'FAILED') return { success: false, errorCode: 'STEP_INVALID_TRANSITION' }

  const newAttemptCount = step.attempt_count + 1

  try {
    const tx = db.transaction(() => {
      const entry = writeEvent({
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
        actorRole: 'STUDENT'
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
// haltTrainingSessionSteps — Step 7 实现（供 assessment:triggerRedline 调用）
// ---------------------------------------------------------------------------
export function haltTrainingSessionSteps(
  _db: DBAdapter,
  _studentId: string,
  _taskCode: string
): void {
  // TODO: Step 7 实现
}

// ---------------------------------------------------------------------------
// IPC 注册
// ---------------------------------------------------------------------------
export function registerTrainingHandlers(): void {
  const getDb = (): DBAdapter => new SqliteAdapter(getDatabase())

  ipcMain.handle('training:createSession', (_event, params: unknown) =>
    createTrainingSession(getDb(), params as CreateTrainingSessionParams)
  )
  ipcMain.handle('training:listSessions', (_event, params: unknown) =>
    listTrainingSessions(getDb(), params as ListTrainingSessionsParams)
  )
  ipcMain.handle('training:getSession', (_event, params: unknown) =>
    getTrainingSession(getDb(), params as GetTrainingSessionParams)
  )
  ipcMain.handle('training:startStep', (_event, params: unknown) =>
    startStep(getDb(), params as TrainingStepActionParams)
  )
  ipcMain.handle('training:completeStep', (_event, params: unknown) =>
    completeStep(getDb(), params as TrainingStepActionParams)
  )
  ipcMain.handle('training:skipStep', (_event, params: unknown) =>
    skipStep(getDb(), params as TrainingStepActionParams)
  )
  ipcMain.handle('training:failStep', (_event, params: unknown) =>
    failStep(getDb(), params as TrainingStepActionParams)
  )
  ipcMain.handle('training:retryStep', (_event, params: unknown) =>
    retryStep(getDb(), params as TrainingStepActionParams)
  )
}

// 导出 applyTrainingEvent 供测试复用
export { applyTrainingEvent }
