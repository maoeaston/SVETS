// 训练会话（training_session）handler 模块。
// 核心逻辑抽成纯函数，接收 DBAdapter；registerTrainingHandlers 是薄包装。
// 测试直接调纯函数 + 注入 MemoryAdapter（与 assessment.ts 同模式）。
//
// 事务边界：db.transaction(() => { writeEvent(...); applyTrainingEvent(...) })
// jsonl appendFileSync 不可回滚，由 reducer 幂等性 + 冷启动重放兜底。

import { ipcMain } from 'electron'
import type { DBAdapter } from '../../db/interface'
import { SqliteAdapter } from '../../db/sqlite-adapter'
import { getDatabase } from '../../db/connection'
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
import { applyTrainingEvent } from '../../domain/training-reducer'

// ---------------------------------------------------------------------------
// createTrainingSession — Step 4 实现
// ---------------------------------------------------------------------------
export function createTrainingSession(
  _db: DBAdapter,
  _params: CreateTrainingSessionParams
): CreateTrainingSessionResult {
  // TODO: Step 4 实现
  return { success: false, errorCode: 'TRAINING_SYSTEM_ERROR' }
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
