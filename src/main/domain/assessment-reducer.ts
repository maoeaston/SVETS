// 测评事件投影 reducer（事件溯源架构 Step 5）。
//
// 职责：把 ActionLogEntry 应用到 assessment_session 等业务投影表。
//       writeEvent() 写 JSONL + domain_event_projection 后调本函数更新业务投影。
//
// 幂等硬约束（AGENTS.md「事件写入协议」+ impl.md Step 5）：
//   同一事件 apply 两次，第二次必须 no-op。这保证：
//   - handler 正常路径重复调用安全
//   - 冷启动重放（jsonl → 逐事件 apply）最终一致
//   - 孤儿事件（jsonl 有、projection 回滚后空）重放恢复正确
//
// 幂等实现策略：
//   - INSERT 类（SESSION_STARTED/ANSWER_SUBMITTED/RESULT_CALCULATED）：先 SELECT 目标行 PK，
//     存在则 return。自然幂等。
//   - UPDATE 类（EMOTION_*/SESSION_COMPLETED/SESSION_ABORTED/REDLINE_TRIGGERED）：
//     先 SELECT assessment_session.last_status_event_id；若 == event.event_id 则 return
//     （此事件已应用）。单调重放下此 guard 充分。
//
// 事务边界（impl.md「事件写入事务边界」决策）：
//   本函数不开启事务。调用方（handler）用 db.transaction(() => { writeEvent(...); applyAssessmentEvent(...) })
//   包裹。better-sqlite3 singleton connection 下 writeEvent 的 domain_event_projection INSERT
//   与本函数的投影 UPDATE/INSERT 自动加入调用者事务，原子回滚。jsonl fs 写入不在事务内
//   （不可回滚），孤儿事件由本函数幂等性 + 冷启动重放兜底。

import { v4 as uuidv4 } from 'uuid'
import type { DBAdapter } from '../db/interface'
import type {
  ActionLogEntry,
  SessionStartedPayload,
  AnswerSubmittedPayload,
  EmotionInterruptedPayload,
  EmotionResumedPayload,
  SessionCompletedPayload,
  SessionAbortedPayload,
  RedlineTriggeredPayload,
  ResultCalculatedPayload
} from '@shared/types/event-payloads'

/**
 * 测评事件投影入口。按 event_type switch 分发到具体 apply* 函数。
 * 未知 event_type 静默 no-op（向前兼容 schema_version 升级后的新事件回放旧二进制）。
 */
export function applyAssessmentEvent(db: DBAdapter, event: ActionLogEntry): void {
  switch (event.event_type) {
    case 'SESSION_STARTED':
      applySessionStarted(db, event)
      break
    case 'ANSWER_SUBMITTED':
      applyAnswerSubmitted(db, event)
      break
    case 'EMOTION_INTERRUPTED':
      applyEmotionInterrupted(db, event)
      break
    case 'EMOTION_RESUMED':
      applyEmotionResumed(db, event)
      break
    case 'EMOTION_COLLAPSE_THRESHOLD_REACHED':
      // 崩溃累计计数来源于 EMOTION_INTERRUPTED 事件流（事件溯源查询，
      // 非冗余计数器字段）。本事件仅标记阈值达成事实，投影层无额外动作。
      break
    case 'SESSION_COMPLETED':
      applySessionCompleted(db, event)
      break
    case 'SESSION_ABORTED':
      applySessionAborted(db, event)
      break
    case 'REDLINE_TRIGGERED':
      applyRedlineTriggered(db, event)
      break
    case 'RESULT_CALCULATED':
      applyResultCalculated(db, event)
      break
    default:
      // 未知 event_type：no-op，向前兼容
      break
  }
}

// SESSION_STARTED → 创建 session + 50 行 assessment_session_question
// 幂等：assessment_session 行存在则整体 skip。
// 设计决策：reducer 是投影唯一写入者（handler Step 6b 调 writeEvent + 本函数，
//   不另 INSERT）。status=ACTIVE（无独立 SESSION_ACTIVATED 事件，INIT→ACTIVE 的
//   非 EVENT UPDATE 会让冷启动重放无法重建 ACTIVE，故 SESSION_STARTED 直达 ACTIVE）。
function applySessionStarted(db: DBAdapter, event: ActionLogEntry): void {
  const p = event.payload as unknown as SessionStartedPayload
  const existing = db
    .prepare('SELECT session_id FROM assessment_session WHERE session_id = ?')
    .get(p.session_id)
  if (existing) return

  db.prepare(
    `INSERT INTO assessment_session
       (session_id, student_id, strategy_id, strategy_type, job_code, task_code, strategy_version,
        status, online_question_count, offline_question_count,
        created_by, started_at,
        created_event_id, last_applied_event_id, last_status_event_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    p.session_id,
    p.student_id,
    p.strategy_id,
    p.strategy_type,
    p.job_code,
    p.task_code,
    p.strategy_version,
    p.online_question_count,
    p.offline_question_count,
    event.actor_id,
    event.created_at,
    event.event_id,
    event.event_id,
    event.event_id
  )

  // assessment_session_question 行：前 online_question_count 项为 ONLINE，其余 OFFLINE。
  // question_order 全局 1..N（与 paper-generator 约定一致：ONLINE 先、OFFLINE 后）。
  // module_type / question_type 从 question_bank 查（payload 不携带，FK + CHECK 要求一致）。
  const insertQ = db.prepare(
    `INSERT INTO assessment_session_question
       (session_question_id, session_id, question_id, question_order, question_phase,
        module_type, question_type, generated_event_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const lookupQ = db.prepare(
    'SELECT module_type, question_type FROM question_bank WHERE question_id = ?'
  )
  for (let i = 0; i < p.question_ids.length; i++) {
    const questionId = p.question_ids[i]
    const qb = lookupQ.get(questionId) as
      | { module_type: string; question_type: string }
      | undefined
    if (!qb) {
      // question_bank 缺行 → FK 必然失败；显式抛错便于定位（冷启动重放时题库应已就位）
      throw new Error(
        `applySessionStarted: question_id ${questionId} not found in question_bank (FK violation)`
      )
    }
    const phase = i < p.online_question_count ? 'ONLINE' : 'OFFLINE'
    insertQ.run(
      uuidv4(),
      p.session_id,
      questionId,
      i + 1,
      phase,
      qb.module_type,
      qb.question_type,
      event.event_id
    )
  }
}

// ANSWER_SUBMITTED → INSERT answer_record + session 计数前移
// 幂等：answer_record.answer_id 存在则 skip（计数不翻倍）。
function applyAnswerSubmitted(db: DBAdapter, event: ActionLogEntry): void {
  const p = event.payload as unknown as AnswerSubmittedPayload
  const existing = db
    .prepare('SELECT answer_id FROM answer_record WHERE answer_id = ?')
    .get(p.answer_id)
  if (existing) return

  // session 不存在 → 事件无法投影（SESSION_STARTED 缺失，正常重放不应出现），静默跳过
  const sess = db
    .prepare('SELECT session_id FROM assessment_session WHERE session_id = ?')
    .get(p.session_id)
  if (!sess) return

  db.prepare(
    `INSERT INTO answer_record
       (answer_id, session_id, question_id, question_type,
        answer_payload_json, is_correct, score,
        submitted_event_id, submitted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    p.answer_id,
    p.session_id,
    p.question_id,
    p.question_type,
    JSON.stringify(p.answer_payload),
    p.is_correct ? 1 : 0,
    p.score,
    event.event_id,
    p.submitted_at
  )

  // current_question_id = 最低 question_order 的未答 ONLINE 题（线性推进语义）。
  // 全部答完则不变（保持指向最后一题）。
  const next = db
    .prepare(
      `SELECT sq.question_id
       FROM assessment_session_question sq
       WHERE sq.session_id = ?
         AND sq.question_phase = 'ONLINE'
         AND NOT EXISTS (
           SELECT 1 FROM answer_record ar
           WHERE ar.session_id = sq.session_id
             AND ar.question_id = sq.question_id
             AND ar.status = 'VALID'
         )
       ORDER BY sq.question_order
       LIMIT 1`
    )
    .get(p.session_id) as { question_id: string } | undefined

  if (next) {
    db.prepare(
      `UPDATE assessment_session
       SET online_completed_count = online_completed_count + 1,
           current_question_id = ?,
           last_applied_event_id = ?
       WHERE session_id = ?`
    ).run(next.question_id, event.event_id, p.session_id)
  } else {
    db.prepare(
      `UPDATE assessment_session
       SET online_completed_count = online_completed_count + 1,
           last_applied_event_id = ?
       WHERE session_id = ?`
    ).run(event.event_id, p.session_id)
  }
}

// EMOTION_INTERRUPTED → status=EMOTION_INTERRUPTED + pause 计数
// 幂等：last_status_event_id == event_id 则 skip。
function applyEmotionInterrupted(db: DBAdapter, event: ActionLogEntry): void {
  const p = event.payload as unknown as EmotionInterruptedPayload
  const row = db
    .prepare('SELECT last_status_event_id FROM assessment_session WHERE session_id = ?')
    .get(p.session_id) as { last_status_event_id: string | null } | undefined
  if (!row) return
  if (row.last_status_event_id === event.event_id) return

  db.prepare(
    `UPDATE assessment_session
     SET status = 'EMOTION_INTERRUPTED',
         pause_count = pause_count + 1,
         pause_started_at = ?,
         last_interruption_reason = 'EMOTION',
         last_status_event_id = ?,
         last_applied_event_id = ?
     WHERE session_id = ?`
  ).run(p.interrupted_at, event.event_id, event.event_id, p.session_id)
}

// EMOTION_RESUMED → status=ACTIVE
// 幂等：last_status_event_id == event_id 则 skip。
function applyEmotionResumed(db: DBAdapter, event: ActionLogEntry): void {
  const p = event.payload as unknown as EmotionResumedPayload
  const row = db
    .prepare('SELECT last_status_event_id FROM assessment_session WHERE session_id = ?')
    .get(p.session_id) as { last_status_event_id: string | null } | undefined
  if (!row) return
  if (row.last_status_event_id === event.event_id) return

  db.prepare(
    `UPDATE assessment_session
     SET status = 'ACTIVE',
         pause_started_at = NULL,
         last_status_event_id = ?,
         last_applied_event_id = ?
     WHERE session_id = ?`
  ).run(event.event_id, event.event_id, p.session_id)
}

// SESSION_COMPLETED → status=COMPLETED
// 幂等：last_status_event_id == event_id 则 skip。
function applySessionCompleted(db: DBAdapter, event: ActionLogEntry): void {
  const p = event.payload as unknown as SessionCompletedPayload
  const row = db
    .prepare('SELECT last_status_event_id FROM assessment_session WHERE session_id = ?')
    .get(p.session_id) as { last_status_event_id: string | null } | undefined
  if (!row) return
  if (row.last_status_event_id === event.event_id) return

  db.prepare(
    `UPDATE assessment_session
     SET status = 'COMPLETED',
         completed_at = ?,
         last_status_event_id = ?,
         last_applied_event_id = ?
     WHERE session_id = ?`
  ).run(p.completed_at, event.event_id, event.event_id, p.session_id)
}

// SESSION_ABORTED → status=ABORTED
// 幂等：last_status_event_id == event_id 则 skip。
function applySessionAborted(db: DBAdapter, event: ActionLogEntry): void {
  const p = event.payload as unknown as SessionAbortedPayload
  const row = db
    .prepare('SELECT last_status_event_id FROM assessment_session WHERE session_id = ?')
    .get(p.session_id) as { last_status_event_id: string | null } | undefined
  if (!row) return
  if (row.last_status_event_id === event.event_id) return

  db.prepare(
    `UPDATE assessment_session
     SET status = 'ABORTED',
         completed_at = ?,
         last_status_event_id = ?,
         last_applied_event_id = ?
     WHERE session_id = ?`
  ).run(p.aborted_at, event.event_id, event.event_id, p.session_id)
}

// REDLINE_TRIGGERED → status=REDLINE_HALTED + level_result=LEVEL_FAIL_BY_SAFETY + redline_incident_id
// 正常流程下 safety_incident INSERT 的 schema trigger 已批量熔断 session（reducer 仅记事件指针）；
// 冷启动重放下 trigger 未跑，reducer 兜底完整熔断。两种路径都写 redline_incident_id。
// 幂等：last_status_event_id == event_id 则 skip。
// FK 约束：redline_incident_id 要求 safety_incident 存在且同 student+task
// （trg_assessment_session_redline_incident_same_student_task_update 校验）。
function applyRedlineTriggered(db: DBAdapter, event: ActionLogEntry): void {
  const p = event.payload as unknown as RedlineTriggeredPayload
  const row = db
    .prepare('SELECT last_status_event_id, status FROM assessment_session WHERE session_id = ?')
    .get(p.session_id) as
    | { last_status_event_id: string | null; status: string }
    | undefined
  if (!row) return
  if (row.last_status_event_id === event.event_id) return

  if (row.status === 'REDLINE_HALTED') {
    // trigger 已熔断：只补 redline_incident_id（COALESCE 防覆盖已填值）+ 事件指针
    db.prepare(
      `UPDATE assessment_session
       SET redline_incident_id = COALESCE(redline_incident_id, ?),
           level_result = COALESCE(level_result, 'LEVEL_FAIL_BY_SAFETY'),
           last_status_event_id = ?,
           last_applied_event_id = ?
       WHERE session_id = ?`
    ).run(p.incident_id, event.event_id, event.event_id, p.session_id)
  } else {
    // 冷启动重放：trigger 未跑，reducer 完整熔断（需 safety_incident 行已存在以满足 FK + trigger）
    db.prepare(
      `UPDATE assessment_session
       SET status = 'REDLINE_HALTED',
           level_result = 'LEVEL_FAIL_BY_SAFETY',
           redline_incident_id = ?,
           last_status_event_id = ?,
           last_applied_event_id = ?
       WHERE session_id = ?`
    ).run(p.incident_id, event.event_id, event.event_id, p.session_id)
  }
}

// RESULT_CALCULATED → INSERT result_record
// 幂等：result_record.result_id 存在则 skip。
// safety_overridden / redline_incident_id：level_result=LEVEL_FAIL_BY_SAFETY 时从 session
//   读 redline_incident_id（result_record CHECK 要求三字段一致）。
function applyResultCalculated(db: DBAdapter, event: ActionLogEntry): void {
  const p = event.payload as unknown as ResultCalculatedPayload
  const existing = db
    .prepare('SELECT result_id FROM result_record WHERE result_id = ?')
    .get(p.result_id)
  if (existing) return

  const isFailBySafety = p.level_result === 'LEVEL_FAIL_BY_SAFETY'
  let redlineIncidentId: string | null = null
  if (isFailBySafety && p.source_type === 'ASSESSMENT_SESSION') {
    const sess = db
      .prepare('SELECT redline_incident_id FROM assessment_session WHERE session_id = ?')
      .get(p.source_id) as { redline_incident_id: string | null } | undefined
    redlineIncidentId = sess?.redline_incident_id ?? null
  }

  db.prepare(
    `INSERT INTO result_record
       (result_id, student_id, result_type, source_aggregate_type, source_aggregate_id,
        job_code, raw_score, max_score, normalized_score, level_result,
        safety_overridden, redline_incident_id,
        generated_event_id, generated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    p.result_id,
    p.student_id,
    p.result_type,
    p.source_type,
    p.source_id,
    p.job_code,
    p.raw_score ?? null,
    p.max_score ?? null,
    p.normalized_score,
    p.level_result,
    isFailBySafety ? 1 : 0,
    redlineIncidentId,
    event.event_id,
    p.calculated_at
  )
}
