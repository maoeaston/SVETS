// 训练事件 reducer — 将训练事件应用到 SQLite 投影表
// 每个 apply* 函数对应一个事件类型，由 handler 在事务内调用

import type { DBAdapter } from '../db/interface'
import type { ActionLogEntry } from '@shared/types/event-payloads'

export function applyTrainingEvent(db: DBAdapter, entry: ActionLogEntry): void {
  switch (entry.event_type) {
    case 'TRAINING_STARTED':
      return applyTrainingStarted(db, entry)
    case 'TRAINING_STEP_STARTED':
      return applyStepStarted(db, entry)
    case 'TRAINING_STEP_COMPLETED':
      return applyStepCompleted(db, entry)
    case 'TRAINING_STEP_SKIPPED':
      return applyStepSkipped(db, entry)
    case 'TRAINING_STEP_FAILED':
      return applyStepFailed(db, entry)
    case 'TRAINING_STEP_RETRIED':
      return applyStepRetried(db, entry)
    case 'TRAINING_COMPLETED':
      return applyTrainingCompleted(db, entry)
    default:
      break
  }
}

// Step 4 实现
function applyTrainingStarted(_db: DBAdapter, _entry: ActionLogEntry): void {
  // TODO
}

// Step 5 实现
function applyStepStarted(_db: DBAdapter, _entry: ActionLogEntry): void {
  // TODO
}

function applyStepCompleted(_db: DBAdapter, _entry: ActionLogEntry): void {
  // TODO
}

function applyStepSkipped(_db: DBAdapter, _entry: ActionLogEntry): void {
  // TODO
}

function applyStepFailed(_db: DBAdapter, _entry: ActionLogEntry): void {
  // TODO
}

function applyStepRetried(_db: DBAdapter, _entry: ActionLogEntry): void {
  // TODO
}

// Step 6 实现
function applyTrainingCompleted(_db: DBAdapter, _entry: ActionLogEntry): void {
  // TODO
}
