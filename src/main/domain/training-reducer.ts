// 训练事件 reducer — 将训练事件应用到 SQLite 投影表
// 每个 apply* 函数对应一个事件类型，由 handler 在事务内调用

import { v4 as uuidv4 } from 'uuid'
import type { DBAdapter } from '../db/interface'
import type {
  ActionLogEntry,
  TrainingStartedPayload
} from '@shared/types/event-payloads'

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

// MVP 固定四步定义（顺序不可变）
const TRAINING_STEPS = [
  { step_order: 1, step_type: 'WATCH',    step_code: 'WATCH_VIDEO',    step_name: '观看示范视频' },
  { step_order: 2, step_type: 'LEARN',    step_code: 'LEARN_MATERIAL', step_name: '学习操作要领' },
  { step_order: 3, step_type: 'PRACTICE', step_code: 'PRACTICE_TASK',  step_name: '练习任务操作' },
  { step_order: 4, step_type: 'DO',       step_code: 'DO_REAL_TASK',   step_name: '独立完成任务' },
] as const

function applyTrainingStarted(db: DBAdapter, entry: ActionLogEntry): void {
  const p = entry.payload as unknown as TrainingStartedPayload

  // 幂等：已存在则跳过
  const exists = db
    .prepare('SELECT 1 FROM training_session WHERE training_session_id = ?')
    .get(p.training_session_id)
  if (exists) return

  db.prepare(
    `INSERT INTO training_session (
       training_session_id, student_id, job_code, task_code,
       strategy_id, strategy_type, strategy_version,
       status, total_step_count, completed_step_count,
       created_by, updated_at, created_event_id, last_applied_event_id, last_status_event_id
     ) VALUES (?, ?, ?, ?, ?, 'TRAINING_PRACTICE', ?, 'INIT', 4, 0, ?, datetime('now'), ?, ?, ?)`
  ).run(
    p.training_session_id,
    p.student_id,
    p.job_code,
    p.task_code,
    p.strategy_id,
    p.strategy_version,
    entry.actor_id,
    entry.event_id,
    entry.event_id,
    entry.event_id
  )

  const stepStmt = db.prepare(
    `INSERT INTO training_step_record (
       training_step_record_id, training_session_id,
       step_code, step_name, step_order, step_type,
       status, attempt_count, generated_event_id, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, 'NOT_STARTED', 0, ?, datetime('now'), datetime('now'))`
  )
  for (const s of TRAINING_STEPS) {
    stepStmt.run(uuidv4(), p.training_session_id, s.step_code, s.step_name, s.step_order, s.step_type, entry.event_id)
  }
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
