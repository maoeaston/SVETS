// 训练事件 reducer — 将训练事件应用到 SQLite 投影表
// 每个 apply* 函数对应一个事件类型，由 handler 在事务内调用

import { v4 as uuidv4 } from 'uuid'
import type { DBAdapter } from '../db/interface'
import type {
  ActionLogEntry,
  TrainingStartedPayload,
  TrainingStepPayload,
  TrainingStepRetriedPayload,
  TrainingCompletedPayload
} from '@shared/types/event-payloads'

type BusinessSessionType = 'ASSESSMENT' | 'TRAINING' | 'LEARNING'

function ensureBusinessSession(
  db: DBAdapter,
  params: {
    businessSessionId: string
    sessionType: BusinessSessionType
    studentId: string
    jobCode: string
    taskCode: string
    createdBy: string
  }
): void {
  const existing = db
    .prepare('SELECT session_type, student_id, job_code, task_code FROM business_session WHERE business_session_id = ?')
    .get(params.businessSessionId) as
    | { session_type: string; student_id: string; job_code: string; task_code: string }
    | undefined
  if (existing) {
    if (
      existing.session_type !== params.sessionType ||
      existing.student_id !== params.studentId ||
      existing.job_code !== params.jobCode ||
      existing.task_code !== params.taskCode
    ) {
      throw new Error(`business_session ${params.businessSessionId} conflicts with training session facts`)
    }
    return
  }

  db.prepare(
    `INSERT INTO business_session
       (business_session_id, session_type, student_id, job_code, task_code, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    params.businessSessionId,
    params.sessionType,
    params.studentId,
    params.jobCode,
    params.taskCode,
    params.createdBy
  )
}

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
  const businessSessionId = p.business_session_id ?? p.training_session_id

  ensureBusinessSession(db, {
    businessSessionId,
    sessionType: 'TRAINING',
    studentId: p.student_id,
    jobCode: p.job_code,
    taskCode: p.task_code,
    createdBy: entry.actor_id
  })

  // 幂等：已存在则跳过；父记录已先修复/校验。
  const exists = db
    .prepare('SELECT 1 FROM training_session WHERE training_session_id = ?')
    .get(p.training_session_id)
  if (exists) return

  db.prepare(
    `INSERT INTO training_session (
       training_session_id, business_session_id, student_id, job_code, task_code,
       strategy_id, strategy_type, strategy_version,
       status, module_type, total_step_count, completed_step_count,
       created_by, updated_at, created_event_id, last_applied_event_id, last_status_event_id
     ) VALUES (?, ?, ?, ?, ?, ?, 'TRAINING_PRACTICE', ?, 'INIT', ?, 4, 0, ?, datetime('now'), ?, ?, ?)`
  ).run(
    p.training_session_id,
    businessSessionId,
    p.student_id,
    p.job_code,
    p.task_code,
    p.strategy_id,
    p.strategy_version,
    p.module_type ?? null,
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
function applyStepStarted(db: DBAdapter, entry: ActionLogEntry): void {
  const p = entry.payload as unknown as TrainingStepPayload

  // 幂等：已应用则跳过
  const step = db
    .prepare(
      `SELECT status, training_session_id FROM training_step_record WHERE training_step_record_id = ?`
    )
    .get(p.step_record_id) as { status: string; training_session_id: string } | undefined
  if (!step || step.status === 'IN_PROGRESS') return

  db.prepare(
    `UPDATE training_step_record
        SET status = 'IN_PROGRESS', started_at = ?, attempt_count = attempt_count + 1,
            last_applied_event_id = ?, updated_at = datetime('now')
      WHERE training_step_record_id = ?`
  ).run(p.started_at ?? entry.created_at, entry.event_id, p.step_record_id)

  // FSM：INIT → ACTIVE（第一个步骤开始时）
  const session = db
    .prepare(`SELECT status FROM training_session WHERE training_session_id = ?`)
    .get(p.training_session_id) as { status: string } | undefined
  if (session?.status === 'INIT') {
    db.prepare(
      `UPDATE training_session
          SET status = 'ACTIVE', started_at = ?, last_applied_event_id = ?, last_status_event_id = ?, updated_at = datetime('now')
        WHERE training_session_id = ?`
    ).run(entry.created_at, entry.event_id, entry.event_id, p.training_session_id)
  } else {
    db.prepare(
      `UPDATE training_session SET last_applied_event_id = ?, updated_at = datetime('now') WHERE training_session_id = ?`
    ).run(entry.event_id, p.training_session_id)
  }
}

function applyStepCompleted(db: DBAdapter, entry: ActionLogEntry): void {
  const p = entry.payload as unknown as TrainingStepPayload

  const step = db
    .prepare(`SELECT status FROM training_step_record WHERE training_step_record_id = ?`)
    .get(p.step_record_id) as { status: string } | undefined
  if (!step || step.status === 'COMPLETED') return

  db.prepare(
    `UPDATE training_step_record
        SET status = 'COMPLETED', completed_at = ?, last_applied_event_id = ?, updated_at = datetime('now')
      WHERE training_step_record_id = ?`
  ).run(p.completed_at ?? entry.created_at, entry.event_id, p.step_record_id)

  db.prepare(
    `UPDATE training_session
        SET completed_step_count = completed_step_count + 1, last_applied_event_id = ?, updated_at = datetime('now')
      WHERE training_session_id = ?`
  ).run(entry.event_id, p.training_session_id)
}

function applyStepSkipped(db: DBAdapter, entry: ActionLogEntry): void {
  const p = entry.payload as unknown as TrainingStepPayload

  const step = db
    .prepare(`SELECT status FROM training_step_record WHERE training_step_record_id = ?`)
    .get(p.step_record_id) as { status: string } | undefined
  if (!step || step.status === 'SKIPPED') return

  db.prepare(
    `UPDATE training_step_record
        SET status = 'SKIPPED', last_applied_event_id = ?, updated_at = datetime('now')
      WHERE training_step_record_id = ?`
  ).run(entry.event_id, p.step_record_id)

  db.prepare(
    `UPDATE training_session SET last_applied_event_id = ?, updated_at = datetime('now') WHERE training_session_id = ?`
  ).run(entry.event_id, p.training_session_id)
}

function applyStepFailed(db: DBAdapter, entry: ActionLogEntry): void {
  const p = entry.payload as unknown as TrainingStepPayload

  const step = db
    .prepare(`SELECT status FROM training_step_record WHERE training_step_record_id = ?`)
    .get(p.step_record_id) as { status: string } | undefined
  if (!step || step.status === 'FAILED') return

  db.prepare(
    `UPDATE training_step_record
        SET status = 'FAILED', last_applied_event_id = ?, updated_at = datetime('now')
      WHERE training_step_record_id = ?`
  ).run(entry.event_id, p.step_record_id)

  db.prepare(
    `UPDATE training_session SET last_applied_event_id = ?, updated_at = datetime('now') WHERE training_session_id = ?`
  ).run(entry.event_id, p.training_session_id)
}

function applyStepRetried(db: DBAdapter, entry: ActionLogEntry): void {
  const p = entry.payload as unknown as TrainingStepRetriedPayload

  const step = db
    .prepare(`SELECT status FROM training_step_record WHERE training_step_record_id = ?`)
    .get(p.step_record_id) as { status: string } | undefined
  if (!step || step.status === 'IN_PROGRESS') return

  db.prepare(
    `UPDATE training_step_record
        SET status = 'IN_PROGRESS', attempt_count = ?, last_applied_event_id = ?, updated_at = datetime('now')
      WHERE training_step_record_id = ?`
  ).run(p.attempt_count, entry.event_id, p.step_record_id)

  db.prepare(
    `UPDATE training_session SET last_applied_event_id = ?, updated_at = datetime('now') WHERE training_session_id = ?`
  ).run(entry.event_id, p.training_session_id)
}

// Step 6 实现
function applyTrainingCompleted(db: DBAdapter, entry: ActionLogEntry): void {
  const p = entry.payload as unknown as TrainingCompletedPayload

  // 幂等：终态已设置则跳过
  const session = db
    .prepare(`SELECT status FROM training_session WHERE training_session_id = ?`)
    .get(p.training_session_id) as { status: string } | undefined
  if (!session || session.status === 'COMPLETED') return

  db.prepare(
    `UPDATE training_session
        SET status = 'COMPLETED', completed_at = ?, completion_rate = ?,
            completed_step_count = ?, last_applied_event_id = ?, last_status_event_id = ?,
            updated_at = datetime('now')
      WHERE training_session_id = ?`
  ).run(
    p.completed_at,
    p.completion_rate,
    p.completed_steps,
    entry.event_id,
    entry.event_id,
    p.training_session_id
  )

  // 读 training_session 以获取 result_record 投影字段
  const ts = db
    .prepare(
      `SELECT student_id, job_code, task_code, strategy_id, strategy_type,
              strategy_version, module_type, created_by
         FROM training_session WHERE training_session_id = ?`
    )
    .get(p.training_session_id) as {
    student_id: string
    job_code: string
    task_code: string
    strategy_id: string
    strategy_type: string
    strategy_version: number
    module_type: string | null
    created_by: string
  } | undefined
  if (!ts) return

  // 从 strategy_config 读 level_rules（不硬编码阈值）
  const sc = db
    .prepare(
      `SELECT scoring_policy_json FROM strategy_config WHERE strategy_id = ? AND version = ?`
    )
    .get(ts.strategy_id, ts.strategy_version) as { scoring_policy_json: string } | undefined

  let levelResult = 'LEVEL_CONDITIONAL'
  if (sc) {
    try {
      const policy = JSON.parse(sc.scoring_policy_json) as {
        level_rules: Array<{ min: number; max: number; level: string }>
      }
      for (const rule of policy.level_rules) {
        if (p.completion_rate >= rule.min && p.completion_rate <= rule.max) {
          levelResult = rule.level
          break
        }
      }
    } catch {
      // 解析失败保持默认
    }
  }

  const resultId = uuidv4()
  db.prepare(
    `INSERT OR IGNORE INTO result_record (
       result_id, result_type, source_aggregate_type, source_aggregate_id,
       student_id, strategy_id, strategy_type, job_code, module_type,
       normalized_score, level_result, completion_ratio,
       generated_event_id, generated_at, safety_overridden
     ) VALUES (?, 'TRAINING_COMPLETION', 'TRAINING_SESSION', ?,
               ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
  ).run(
    resultId,
    p.training_session_id,
    ts.student_id,
    ts.strategy_id,
    ts.strategy_type,
    ts.job_code,
    ts.module_type,
    p.completion_rate,
    levelResult,
    p.completion_rate / 100,
    entry.event_id,
    p.completed_at
  )
}
