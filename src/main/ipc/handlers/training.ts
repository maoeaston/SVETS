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
import { assertCaller } from '../../utils/auth-context'
import { writeEvent } from '../../domain/event-writer'
import type {
  CreateTrainingSessionParams,
  CreateTrainingSessionResult,
  ListTrainingSessionsParams,
  ListTrainingSessionsResult,
  GetTrainingSessionParams,
  GetTrainingSessionResult,
  TrainingStepActionParams,
  TrainingStepActionResult
} from '@shared/types/training'
import type { TrainingStartedPayload } from '@shared/types/event-payloads'
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
// listTrainingSessions — Step 6 实现
// ---------------------------------------------------------------------------
export function listTrainingSessions(
  _db: DBAdapter,
  _params: ListTrainingSessionsParams
): ListTrainingSessionsResult {
  // TODO: Step 6 实现
  return { success: false, errorCode: 'TRAINING_SYSTEM_ERROR' }
}

// ---------------------------------------------------------------------------
// getTrainingSession — Step 6 实现
// ---------------------------------------------------------------------------
export function getTrainingSession(
  _db: DBAdapter,
  _params: GetTrainingSessionParams
): GetTrainingSessionResult {
  // TODO: Step 6 实现
  return { success: false, errorCode: 'TRAINING_SYSTEM_ERROR' }
}

// ---------------------------------------------------------------------------
// startStep / completeStep / skipStep / failStep / retryStep — Step 5 实现
// ---------------------------------------------------------------------------
export function startStep(
  _db: DBAdapter,
  _params: TrainingStepActionParams
): TrainingStepActionResult {
  return { success: false, errorCode: 'TRAINING_SYSTEM_ERROR' }
}

export function completeStep(
  _db: DBAdapter,
  _params: TrainingStepActionParams
): TrainingStepActionResult {
  return { success: false, errorCode: 'TRAINING_SYSTEM_ERROR' }
}

export function skipStep(
  _db: DBAdapter,
  _params: TrainingStepActionParams
): TrainingStepActionResult {
  return { success: false, errorCode: 'TRAINING_SYSTEM_ERROR' }
}

export function failStep(
  _db: DBAdapter,
  _params: TrainingStepActionParams
): TrainingStepActionResult {
  return { success: false, errorCode: 'TRAINING_SYSTEM_ERROR' }
}

export function retryStep(
  _db: DBAdapter,
  _params: TrainingStepActionParams
): TrainingStepActionResult {
  return { success: false, errorCode: 'TRAINING_SYSTEM_ERROR' }
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
