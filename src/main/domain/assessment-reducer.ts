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
  SessionFirstQuestionActivatedPayload,
  AssignmentAssessmentStartedPayload,
  AnswerSubmittedPayload,
  EmotionInterruptedPayload,
  EmotionResumedPayload,
  SittingStartedPayload,
  SittingEndedPayload,
  EmotionCollapseRecordedPayload,
  EmotionCollapseThresholdReachedPayload,
  OfflineScoreSubmittedPayload,
  SessionCompletedPayload,
  SessionAbortedPayload,
  RedlineTriggeredPayload,
  ResultCalculatedPayload,
  TeacherObservationRecordedPayload
} from '@shared/types/event-payloads'

type BusinessSessionType = 'ASSESSMENT' | 'TRAINING' | 'LEARNING'
type AssessmentDeliveryPhase =
  | 'PREPARED'
  | 'ASSIGNED'
  | 'STUDENT_CONFIRMED'
  | 'ONLINE_IN_PROGRESS'
  | 'ONLINE_COMPLETED'
  | 'OFFLINE_SCORING'
  | 'OBSERVATION'
  | 'READY_TO_FINALIZE'
  | 'FINALIZED'

const TERMINAL_ASSESSMENT_STATUSES = new Set(['COMPLETED', 'ABORTED', 'REDLINE_HALTED'])
const DELIVERY_PHASE_ORDER: Record<AssessmentDeliveryPhase, number> = {
  PREPARED: 0,
  ASSIGNED: 1,
  STUDENT_CONFIRMED: 2,
  ONLINE_IN_PROGRESS: 3,
  ONLINE_COMPLETED: 4,
  OFFLINE_SCORING: 5,
  OBSERVATION: 6,
  READY_TO_FINALIZE: 7,
  FINALIZED: 8
}

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
      throw new Error(`business_session ${params.businessSessionId} conflicts with assessment session facts`)
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

function isStaleAssessmentEvent(
  row: { event_sequence_version: number | null | undefined },
  event: ActionLogEntry
): boolean {
  return event.event_sequence <= (row.event_sequence_version ?? 0)
}

function markAssessmentEventApplied(db: DBAdapter, sessionId: string, event: ActionLogEntry): void {
  db.prepare(
    `UPDATE assessment_session
       SET event_sequence_version = CASE
             WHEN event_sequence_version > ? THEN event_sequence_version
             ELSE ?
           END,
           last_applied_event_id = ?
     WHERE session_id = ?`
  ).run(event.event_sequence, event.event_sequence, event.event_id, sessionId)
}

function maxDeliveryPhase(
  currentPhase: AssessmentDeliveryPhase | null | undefined,
  nextPhase: AssessmentDeliveryPhase
): AssessmentDeliveryPhase {
  if (!currentPhase) return nextPhase
  return DELIVERY_PHASE_ORDER[nextPhase] > DELIVERY_PHASE_ORDER[currentPhase] ? nextPhase : currentPhase
}

function countJobSkillOfflineScoring(db: DBAdapter, sessionId: string): { total: number; done: number } {
  return db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM assessment_session_question
           WHERE session_id = ? AND question_phase = 'OFFLINE' AND item_usage = 'SCORED_ITEM') AS total,
         (SELECT COUNT(*) FROM offline_score_record
           WHERE session_id = ? AND score_scope = 'JOB_SKILL' AND status = 'VALID') AS done`
    )
    .get(sessionId, sessionId) as { total: number; done: number }
}

function countTeacherObservations(db: DBAdapter, sessionId: string): { total: number; done: number } {
  return db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM assessment_session_question
           WHERE session_id = ? AND question_phase = 'OBSERVATION') AS total,
         (SELECT COUNT(*) FROM offline_score_record
           WHERE session_id = ? AND score_scope = 'TEACHER_OBSERVATION' AND status = 'VALID') AS done`
    )
    .get(sessionId, sessionId) as { total: number; done: number }
}

function applyAssessmentPhaseAndMark(
  db: DBAdapter,
  params: {
    sessionId: string
    event: ActionLogEntry
    deliveryPhase?: AssessmentDeliveryPhase
  }
): void {
  if (params.deliveryPhase) {
    db.prepare(
      `UPDATE assessment_session
         SET delivery_phase = ?,
             event_sequence_version = CASE
               WHEN event_sequence_version > ? THEN event_sequence_version
               ELSE ?
             END,
             last_applied_event_id = ?
       WHERE session_id = ?`
    ).run(
      params.deliveryPhase,
      params.event.event_sequence,
      params.event.event_sequence,
      params.event.event_id,
      params.sessionId
    )
    return
  }

  markAssessmentEventApplied(db, params.sessionId, params.event)
}

function resolveJobSkillPhaseAfterOfflineScore(
  db: DBAdapter,
  params: {
    sessionId: string
    scoreScope: OfflineScoreSubmittedPayload['score_scope']
    currentPhase: AssessmentDeliveryPhase | null
  }
): AssessmentDeliveryPhase {
  let target = maxDeliveryPhase(params.currentPhase, 'OFFLINE_SCORING')
  if (params.scoreScope !== 'JOB_SKILL') return target

  const offlineCounts = countJobSkillOfflineScoring(db, params.sessionId)
  if (offlineCounts.total === 0 || offlineCounts.done < offlineCounts.total) return target

  const observationCounts = countTeacherObservations(db, params.sessionId)
  target =
    observationCounts.total > observationCounts.done
      ? maxDeliveryPhase(target, 'OBSERVATION')
      : maxDeliveryPhase(target, 'READY_TO_FINALIZE')
  return target
}

function resolveJobSkillPhaseAfterTeacherObservation(
  db: DBAdapter,
  params: {
    sessionId: string
    currentPhase: AssessmentDeliveryPhase | null
  }
): AssessmentDeliveryPhase | undefined {
  const offlineCounts = countJobSkillOfflineScoring(db, params.sessionId)
  if (offlineCounts.total === 0 || offlineCounts.done < offlineCounts.total) return undefined

  const observationCounts = countTeacherObservations(db, params.sessionId)
  if (observationCounts.total === 0 || observationCounts.done < observationCounts.total) return undefined

  return maxDeliveryPhase(params.currentPhase, 'READY_TO_FINALIZE')
}

/**
 * 测评事件投影入口。按 event_type switch 分发到具体 apply* 函数。
 * 未知 event_type 静默 no-op（向前兼容 schema_version 升级后的新事件回放旧二进制）。
 */
export function applyAssessmentEvent(db: DBAdapter, event: ActionLogEntry): void {
  switch (event.event_type) {
    case 'SESSION_STARTED':
      applySessionStarted(db, event)
      break
    case 'SESSION_FIRST_QUESTION_ACTIVATED':
      applySessionFirstQuestionActivated(db, event)
      break
    case 'ASSIGNMENT_ASSESSMENT_STARTED':
      applyAssignmentAssessmentStarted(db, event)
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
    case 'SITTING_STARTED':
      applySittingStarted(db, event)
      break
    case 'SITTING_ENDED':
      applySittingEnded(db, event)
      break
    case 'EMOTION_COLLAPSE_RECORDED':
      applyEmotionCollapseRecorded(db, event)
      break
    case 'EMOTION_COLLAPSE_THRESHOLD_REACHED':
      applyEmotionCollapseThresholdReached(db, event)
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
    case 'OFFLINE_SCORE_SUBMITTED':
      applyOfflineScoreSubmitted(db, event)
      break
    case 'TEACHER_OBSERVATION_RECORDED':
      applyTeacherObservationRecorded(db, event)
      break
    default:
      // 未知 event_type：no-op，向前兼容
      break
  }
}

// ASSIGNMENT_ASSESSMENT_STARTED → 初始化 current_question_id 指针。
// M3 合法路径只允许 STUDENT_CONFIRMED -> ONLINE_IN_PROGRESS。
function applyAssignmentAssessmentStarted(db: DBAdapter, event: ActionLogEntry): void {
  const p = event.payload as unknown as AssignmentAssessmentStartedPayload
  const row = db
    .prepare('SELECT current_question_id, delivery_phase, event_sequence_version FROM assessment_session WHERE session_id = ?')
    .get(p.session_id) as
    | { current_question_id: string | null; delivery_phase: AssessmentDeliveryPhase | null; event_sequence_version: number }
    | undefined
  if (!row) return
  if (isStaleAssessmentEvent(row, event)) return
  if (row.current_question_id !== null) return
  if (row.delivery_phase !== p.delivery_phase_before) return

  db.prepare(
    `UPDATE assessment_session
       SET status = 'ACTIVE',
           delivery_phase = ?,
           current_question_id = ?,
           started_at = ?,
           last_status_event_id = ?,
           last_applied_event_id = ?,
           event_sequence_version = CASE
             WHEN event_sequence_version > ? THEN event_sequence_version
             ELSE ?
           END
     WHERE session_id = ?
       AND current_question_id IS NULL
       AND delivery_phase = ?`
  ).run(
    p.delivery_phase_after,
    p.first_question_id,
    p.started_at,
    event.event_id,
    event.event_id,
    event.event_sequence,
    event.event_sequence,
    p.session_id,
    p.delivery_phase_before
  )
}

function applyEmotionCollapseThresholdReached(db: DBAdapter, event: ActionLogEntry): void {
  const p = event.payload as unknown as EmotionCollapseThresholdReachedPayload
  const row = db
    .prepare('SELECT event_sequence_version FROM assessment_session WHERE session_id = ?')
    .get(p.session_id) as { event_sequence_version: number } | undefined
  if (!row) return
  if (isStaleAssessmentEvent(row, event)) return
  db.prepare(
    `UPDATE assessment_session
       SET level_result = 'LEVEL_NOT_COMPETENT', last_applied_event_id = ?,
           event_sequence_version = CASE WHEN event_sequence_version > ? THEN event_sequence_version ELSE ? END
     WHERE session_id = ?`
  ).run(event.event_id, event.event_sequence, event.event_sequence, p.session_id)
}

function applyEmotionCollapseRecorded(db: DBAdapter, event: ActionLogEntry): void {
  const p = event.payload as unknown as EmotionCollapseRecordedPayload
  const row = db.prepare('SELECT event_sequence_version FROM assessment_session WHERE session_id = ?')
    .get(p.session_id) as { event_sequence_version: number } | undefined
  if (!row || isStaleAssessmentEvent(row, event)) return
  markAssessmentEventApplied(db, p.session_id, event)
}

// SESSION_STARTED → 创建 business_session + assessment_session + question snapshot.
// 幂等：先修复/校验父记录，再判断子会话是否已存在。
function applySessionStarted(db: DBAdapter, event: ActionLogEntry): void {
  const p = event.payload as unknown as SessionStartedPayload
  const businessSessionId = p.business_session_id ?? p.session_id
  ensureBusinessSession(db, {
    businessSessionId,
    sessionType: 'ASSESSMENT',
    studentId: p.student_id,
    jobCode: p.job_code,
    taskCode: p.task_code,
    createdBy: event.actor_id
  })

  const existing = db
    .prepare('SELECT session_id FROM assessment_session WHERE session_id = ?')
    .get(p.session_id)
  if (existing) return

  db.prepare(
    `INSERT INTO assessment_session
       (session_id, business_session_id, student_id, strategy_id, strategy_type, job_code, task_code,
        strategy_version, status, delivery_phase, online_question_count, offline_question_count,
        observation_template_id,
        created_by, started_at,
        created_event_id, last_applied_event_id, last_status_event_id, event_sequence_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'INIT', ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`
  ).run(
    p.session_id,
    businessSessionId,
    p.student_id,
    p.strategy_id,
    p.strategy_type,
    p.job_code,
    p.task_code,
    p.strategy_version,
    p.initial_delivery_phase ?? 'PREPARED',
    p.online_question_count,
    p.offline_question_count,
    p.observation_template_id ?? null,
    event.actor_id,
    event.event_id,
    event.event_id,
    event.event_id,
    event.event_sequence
  )

  // assessment_session_question 行：前 online_question_count 项为 ONLINE，其余 OFFLINE。
  // question_order 全局 1..N（与 paper-generator 约定一致：ONLINE 先、OFFLINE 后）。
  // module_type / question_type 从 question_bank 查（payload 不携带，FK + CHECK 要求一致）。
  const insertQ = db.prepare(
    `INSERT INTO assessment_session_question
       (session_question_id, session_id, question_id, question_order, question_phase,
        bank_domain, module_type, question_type, item_usage, job_module_code, generated_event_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const lookupQ = db.prepare(
    'SELECT bank_domain, module_type, question_type, item_usage, job_module_code FROM question_bank WHERE question_id = ?'
  )
  for (let i = 0; i < p.question_ids.length; i++) {
    const questionId = p.question_ids[i]
    const qb = lookupQ.get(questionId) as
      | { bank_domain: string; module_type: string | null; question_type: string; item_usage: string; job_module_code: string | null }
      | undefined
    if (!qb) {
      // question_bank 缺行 → FK 必然失败；显式抛错便于定位（冷启动重放时题库应已就位）
      throw new Error(
        `applySessionStarted: question_id ${questionId} not found in question_bank (FK violation)`
      )
    }
    // v0.1.12: phase 优先级：OBSERVATION_ONLY → OBSERVATION；OFFLINE_OPERATION → OFFLINE；其他 → ONLINE
    // bank_domain=JOB_SPECIFIC 题（item_usage=OBSERVATION_ONLY）phase=OBSERVATION，不进 online/offline count。
    const phase =
      qb.item_usage === 'OBSERVATION_ONLY'
        ? 'OBSERVATION'
        : qb.question_type === 'OFFLINE_OPERATION'
          ? 'OFFLINE'
          : 'ONLINE'
    insertQ.run(
      uuidv4(),
      p.session_id,
      questionId,
      i + 1,
      phase,
      qb.bank_domain,
      qb.module_type,
      qb.question_type,
      qb.item_usage,
      qb.job_module_code,
      event.event_id
    )
  }
}

// SESSION_FIRST_QUESTION_ACTIVATED → 初始化 current_question_id 指针
// 幂等：current_question_id 非 NULL 则 skip（无论被谁设——可能本事件重放或
//   ANSWER_SUBMITTED 已推进）。**刻意不更新 last_status_event_id**（非 status 变更，
//   与 applyAnswerSubmitted 同模式），只更新 last_applied_event_id。
// WHERE 加 AND current_question_id IS NULL 兜底，防并发或重放乱序覆盖已推进的指针。
function applySessionFirstQuestionActivated(db: DBAdapter, event: ActionLogEntry): void {
  const p = event.payload as unknown as SessionFirstQuestionActivatedPayload
  const row = db
    .prepare('SELECT current_question_id, event_sequence_version FROM assessment_session WHERE session_id = ?')
    .get(p.session_id) as
    | { current_question_id: string | null; event_sequence_version: number }
    | undefined
  if (!row) return // session 不存在（正常重放不应出现），静默 skip
  if (isStaleAssessmentEvent(row, event)) return
  if (row.current_question_id !== null) return

  db.prepare(
    `UPDATE assessment_session
     SET status = 'ACTIVE',
         delivery_phase = 'ONLINE_IN_PROGRESS',
         current_question_id = ?,
         started_at = ?,
         last_status_event_id = ?,
         last_applied_event_id = ?,
         event_sequence_version = CASE
           WHEN event_sequence_version > ? THEN event_sequence_version
           ELSE ?
         END
     WHERE session_id = ? AND current_question_id IS NULL`
  ).run(
    p.first_question_id,
    p.activated_at,
    event.event_id,
    event.event_id,
    event.event_sequence,
    event.event_sequence,
    p.session_id
  )
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
    .prepare('SELECT event_sequence_version FROM assessment_session WHERE session_id = ?')
    .get(p.session_id) as { event_sequence_version: number } | undefined
  if (!sess) return
  if (isStaleAssessmentEvent(sess, event)) return

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
           last_applied_event_id = ?,
           event_sequence_version = CASE
             WHEN event_sequence_version > ? THEN event_sequence_version
             ELSE ?
           END
       WHERE session_id = ?`
    ).run(next.question_id, event.event_id, event.event_sequence, event.event_sequence, p.session_id)
  } else {
    // All online questions answered — transition to OFFLINE_PENDING (if offline questions exist) or COMPLETED.
    const sessRow = db
      .prepare('SELECT offline_question_count FROM assessment_session WHERE session_id = ?')
      .get(p.session_id) as { offline_question_count: number } | undefined
    const nextStatus =
      (sessRow?.offline_question_count ?? 0) > 0 ? 'OFFLINE_PENDING' : 'COMPLETED'
    db.prepare(
      `UPDATE assessment_session
       SET online_completed_count = online_completed_count + 1,
           status = ?,
           delivery_phase = ?,
           last_status_event_id = ?,
           last_applied_event_id = ?,
           event_sequence_version = CASE
             WHEN event_sequence_version > ? THEN event_sequence_version
             ELSE ?
           END
       WHERE session_id = ?`
    ).run(
      nextStatus,
      nextStatus === 'COMPLETED' ? 'FINALIZED' : 'ONLINE_COMPLETED',
      event.event_id,
      event.event_id,
      event.event_sequence,
      event.event_sequence,
      p.session_id
    )
  }
}

// EMOTION_INTERRUPTED → status=EMOTION_INTERRUPTED + pause 计数
// 幂等：last_status_event_id == event_id 则 skip。
function applyEmotionInterrupted(db: DBAdapter, event: ActionLogEntry): void {
  const p = event.payload as unknown as EmotionInterruptedPayload
  const row = db
    .prepare('SELECT last_status_event_id, event_sequence_version FROM assessment_session WHERE session_id = ?')
    .get(p.session_id) as
    | { last_status_event_id: string | null; event_sequence_version: number }
    | undefined
  if (!row) return
  if (isStaleAssessmentEvent(row, event)) return
  if (row.last_status_event_id === event.event_id) return

  db.prepare(
    `UPDATE assessment_session
     SET status = 'EMOTION_INTERRUPTED',
         pause_count = pause_count + 1,
         pause_started_at = ?,
         last_interruption_reason = 'EMOTION',
         last_status_event_id = ?,
         last_applied_event_id = ?,
         event_sequence_version = CASE
           WHEN event_sequence_version > ? THEN event_sequence_version
           ELSE ?
         END
     WHERE session_id = ?`
  ).run(p.interrupted_at, event.event_id, event.event_id, event.event_sequence, event.event_sequence, p.session_id)
}

// EMOTION_RESUMED → status=ACTIVE
// 幂等：last_status_event_id == event_id 则 skip。
function applyEmotionResumed(db: DBAdapter, event: ActionLogEntry): void {
  const p = event.payload as unknown as EmotionResumedPayload
  const row = db
    .prepare('SELECT last_status_event_id, event_sequence_version FROM assessment_session WHERE session_id = ?')
    .get(p.session_id) as
    | { last_status_event_id: string | null; event_sequence_version: number }
    | undefined
  if (!row) return
  if (isStaleAssessmentEvent(row, event)) return
  if (row.last_status_event_id === event.event_id) return

  db.prepare(
    `UPDATE assessment_session
     SET status = 'ACTIVE',
         pause_started_at = NULL,
         last_status_event_id = ?,
         last_applied_event_id = ?,
         event_sequence_version = CASE
           WHEN event_sequence_version > ? THEN event_sequence_version
           ELSE ?
         END
     WHERE session_id = ?`
  ).run(event.event_id, event.event_id, event.event_sequence, event.event_sequence, p.session_id)
}

// SITTING_STARTED → 新建一个连续施测坐次，并将 session 恢复到 ACTIVE。
function applySittingStarted(db: DBAdapter, event: ActionLogEntry): void {
  const p = event.payload as unknown as SittingStartedPayload
  const existing = db
    .prepare('SELECT started_event_id FROM assessment_sitting WHERE session_id = ? AND sitting_no = ?')
    .get(p.session_id, p.sitting_no) as { started_event_id: string } | undefined
  if (existing) {
    if (existing.started_event_id !== event.event_id) {
      throw new Error(`assessment sitting ${p.session_id}/${p.sitting_no} conflicts with event ${event.event_id}`)
    }
    return
  }
  const session = db
    .prepare('SELECT event_sequence_version FROM assessment_session WHERE session_id = ?')
    .get(p.session_id) as { event_sequence_version: number } | undefined
  if (!session || isStaleAssessmentEvent(session, event)) return

  db.prepare(
    `INSERT INTO assessment_sitting
       (sitting_id, session_id, sitting_no, started_at, started_by, started_event_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(`${p.session_id}:${p.sitting_no}`, p.session_id, p.sitting_no, p.started_at, p.started_by, event.event_id)
  db.prepare(
    `UPDATE assessment_session
       SET status = 'ACTIVE', pause_started_at = NULL,
           last_status_event_id = ?, last_applied_event_id = ?,
           event_sequence_version = CASE WHEN event_sequence_version > ? THEN event_sequence_version ELSE ? END
     WHERE session_id = ?`
  ).run(event.event_id, event.event_id, event.event_sequence, event.event_sequence, p.session_id)
}

// SITTING_ENDED → 计划暂停或情绪崩溃结束当前坐次，session 待复核而不是直接作废。
function applySittingEnded(db: DBAdapter, event: ActionLogEntry): void {
  const p = event.payload as unknown as SittingEndedPayload
  const sitting = db
    .prepare('SELECT ended_event_id FROM assessment_sitting WHERE session_id = ? AND sitting_no = ?')
    .get(p.session_id, p.sitting_no) as { ended_event_id: string | null } | undefined
  if (!sitting) throw new Error(`assessment sitting ${p.session_id}/${p.sitting_no} is missing`)
  if (sitting.ended_event_id) {
    if (sitting.ended_event_id !== event.event_id) {
      throw new Error(`assessment sitting ${p.session_id}/${p.sitting_no} already ended by another event`)
    }
    return
  }
  const session = db
    .prepare('SELECT event_sequence_version FROM assessment_session WHERE session_id = ?')
    .get(p.session_id) as { event_sequence_version: number } | undefined
  if (!session || isStaleAssessmentEvent(session, event)) return

  db.prepare(
    `UPDATE assessment_sitting
       SET ended_at = ?, ended_by = ?, end_reason = ?, current_question_order = ?,
           ended_event_id = ?, updated_at = datetime('now')
     WHERE session_id = ? AND sitting_no = ?`
  ).run(
    p.ended_at,
    p.ended_by,
    p.end_reason,
    p.current_question_order ?? null,
    event.event_id,
    p.session_id,
    p.sitting_no
  )
  db.prepare(
    `UPDATE assessment_session
       SET status = 'SUSPENDED_REVIEW_REQUIRED', pause_started_at = ?,
           last_interruption_reason = ?, last_status_event_id = ?, last_applied_event_id = ?,
           event_sequence_version = CASE WHEN event_sequence_version > ? THEN event_sequence_version ELSE ? END
     WHERE session_id = ?`
  ).run(
    p.ended_at,
    p.end_reason === 'ENDED_BY_COLLAPSE' ? 'EMOTION' : 'TEACHER_INTERVENTION',
    event.event_id,
    event.event_id,
    event.event_sequence,
    event.event_sequence,
    p.session_id
  )
}

// SESSION_COMPLETED → status=COMPLETED
// 幂等：last_status_event_id == event_id 则 skip。
function applySessionCompleted(db: DBAdapter, event: ActionLogEntry): void {
  const p = event.payload as unknown as SessionCompletedPayload
  const row = db
    .prepare('SELECT last_status_event_id, event_sequence_version FROM assessment_session WHERE session_id = ?')
    .get(p.session_id) as
    | { last_status_event_id: string | null; event_sequence_version: number }
    | undefined
  if (!row) return
  if (isStaleAssessmentEvent(row, event)) return
  if (row.last_status_event_id === event.event_id) return

  db.prepare(
    `UPDATE assessment_session
     SET status = 'COMPLETED',
         delivery_phase = 'FINALIZED',
         completed_at = ?,
         last_status_event_id = ?,
         last_applied_event_id = ?,
         event_sequence_version = CASE
           WHEN event_sequence_version > ? THEN event_sequence_version
           ELSE ?
         END
     WHERE session_id = ?`
  ).run(p.completed_at, event.event_id, event.event_id, event.event_sequence, event.event_sequence, p.session_id)
}

// SESSION_ABORTED → status=ABORTED
// 幂等：last_status_event_id == event_id 则 skip。
function applySessionAborted(db: DBAdapter, event: ActionLogEntry): void {
  const p = event.payload as unknown as SessionAbortedPayload
  const row = db
    .prepare('SELECT last_status_event_id, event_sequence_version FROM assessment_session WHERE session_id = ?')
    .get(p.session_id) as
    | { last_status_event_id: string | null; event_sequence_version: number }
    | undefined
  if (!row) return
  if (isStaleAssessmentEvent(row, event)) return
  if (row.last_status_event_id === event.event_id) return

  db.prepare(
    `UPDATE assessment_session
     SET status = 'ABORTED',
         completed_at = ?,
         last_status_event_id = ?,
         last_applied_event_id = ?,
         event_sequence_version = CASE
           WHEN event_sequence_version > ? THEN event_sequence_version
           ELSE ?
         END
     WHERE session_id = ?`
  ).run(p.aborted_at, event.event_id, event.event_id, event.event_sequence, event.event_sequence, p.session_id)
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
    .prepare('SELECT last_status_event_id, status, event_sequence_version FROM assessment_session WHERE session_id = ?')
    .get(p.session_id) as
    | { last_status_event_id: string | null; status: string; event_sequence_version: number }
    | undefined
  if (!row) return
  if (isStaleAssessmentEvent(row, event)) return
  if (row.last_status_event_id === event.event_id) return

  if (row.status === 'REDLINE_HALTED') {
    // trigger 已熔断：只补 redline_incident_id（COALESCE 防覆盖已填值）+ 事件指针
    db.prepare(
      `UPDATE assessment_session
       SET redline_incident_id = COALESCE(redline_incident_id, ?),
           level_result = COALESCE(level_result, 'LEVEL_FAIL_BY_SAFETY'),
           last_status_event_id = ?,
           last_applied_event_id = ?,
           event_sequence_version = CASE
             WHEN event_sequence_version > ? THEN event_sequence_version
             ELSE ?
           END
       WHERE session_id = ?`
    ).run(p.incident_id, event.event_id, event.event_id, event.event_sequence, event.event_sequence, p.session_id)
  } else {
    // 冷启动重放：trigger 未跑，reducer 完整熔断（需 safety_incident 行已存在以满足 FK + trigger）
    db.prepare(
      `UPDATE assessment_session
       SET status = 'REDLINE_HALTED',
           level_result = 'LEVEL_FAIL_BY_SAFETY',
           redline_incident_id = ?,
           last_status_event_id = ?,
           last_applied_event_id = ?,
           event_sequence_version = CASE
             WHEN event_sequence_version > ? THEN event_sequence_version
             ELSE ?
           END
       WHERE session_id = ?`
    ).run(p.incident_id, event.event_id, event.event_id, event.event_sequence, event.event_sequence, p.session_id)
  }
}

// OFFLINE_SCORE_SUBMITTED → INSERT offline_score_record
// 幂等：offline_score_id 存在则 skip。
// TASK_OPERATION 轨道：question_id 固定 NULL，task_operation_code 非空。
// 不更新 assessment_session 状态（OFFLINE_PENDING 保持不变，由 submitOperationScores handler 驱动）。
function applyOfflineScoreSubmitted(db: DBAdapter, event: ActionLogEntry): void {
  const p = event.payload as unknown as OfflineScoreSubmittedPayload
  const existing = db
    .prepare('SELECT offline_score_id FROM offline_score_record WHERE offline_score_id = ?')
    .get(p.offline_score_id)
  if (existing) return
  const session = db
    .prepare('SELECT status, delivery_phase, event_sequence_version FROM assessment_session WHERE session_id = ?')
    .get(p.session_id) as
    | { status: string; delivery_phase: AssessmentDeliveryPhase | null; event_sequence_version: number }
    | undefined
  if (!session) return
  if (isStaleAssessmentEvent(session, event)) return

  // criterion_scores 单维度：取第一项 score（TASK_OPERATION 只有 1 个 criterion）
  const score = p.criterion_scores[0]?.score ?? 0

  db.prepare(
    `INSERT INTO offline_score_record
       (offline_score_id, session_id, question_id, score_scope, task_operation_code,
        score, scoring_rubric_json, observation_note,
        scored_by, scored_event_id, scored_at,
        tool_checklist_confirmed, revision_no, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'VALID')`
  ).run(
    p.offline_score_id,
    p.session_id,
    p.question_id ?? null,
    p.score_scope,
    p.task_operation_code ?? null,
    score,
    p.scoring_rubric_json,
    p.observation_note ?? null,
    p.scored_by,
    event.event_id,
    p.scored_at,
    p.tool_checklist_confirmed ? 1 : 0
  )

  const nextPhase = TERMINAL_ASSESSMENT_STATUSES.has(session.status)
    ? undefined
    : resolveJobSkillPhaseAfterOfflineScore(db, {
      sessionId: p.session_id,
      scoreScope: p.score_scope,
      currentPhase: session.delivery_phase
    })
  applyAssessmentPhaseAndMark(db, {
    sessionId: p.session_id,
    event,
    deliveryPhase: nextPhase
  })
}
// 幂等：result_record.result_id 存在则 skip。
// safety_overridden / redline_incident_id：level_result=LEVEL_FAIL_BY_SAFETY 时从 session
//   读 redline_incident_id（result_record CHECK 要求三字段一致）。
// result_payload_json：从 payload.breakdown 读（事件溯源原则：投影可从事件流重建，
//   handler 不依赖事务后 UPDATE 补字段）。ABILITY_SCORE 类型由 handler 填 breakdown；
//   TRAINING_COMPLETION / OPERATION_PASS_RATE 暂不填，落 NULL。
function applyResultCalculated(db: DBAdapter, event: ActionLogEntry): void {
  const p = event.payload as unknown as ResultCalculatedPayload
  const existing = db
    .prepare('SELECT result_id FROM result_record WHERE result_id = ?')
    .get(p.result_id)
  if (existing) return
  const session = db
    .prepare('SELECT event_sequence_version FROM assessment_session WHERE session_id = ?')
    .get(p.source_id) as { event_sequence_version: number } | undefined
  if (p.source_type === 'ASSESSMENT_SESSION' && session && isStaleAssessmentEvent(session, event)) return

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
        strategy_id, strategy_type, job_code, module_type,
        raw_score, max_score, normalized_score, completion_ratio, level_result,
        safety_overridden, redline_incident_id, result_payload_json,
        generated_event_id, generated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    p.result_id,
    p.student_id,
    p.result_type,
    p.source_type,
    p.source_id,
    p.strategy_id ?? null,
    p.strategy_type ?? null,
    p.job_code,
    p.module_type ?? null,
    p.raw_score ?? null,
    p.max_score ?? null,
    p.normalized_score,
    p.completion_ratio ?? null,
    p.level_result,
    isFailBySafety ? 1 : 0,
    redlineIncidentId,
    p.breakdown ? JSON.stringify(p.breakdown) : null,
    event.event_id,
    p.calculated_at
  )
  if (p.source_type === 'ASSESSMENT_SESSION') {
    markAssessmentEventApplied(db, p.source_id, event)
  }
}

// TEACHER_OBSERVATION_RECORDED → INSERT offline_score_record（score=NULL）
// 幂等：offline_score_id 存在则 skip。
// schema CHECK 要求：score_scope=TEACHER_OBSERVATION 时 score=NULL + observation_payload_json IS NOT NULL
function applyTeacherObservationRecorded(db: DBAdapter, event: ActionLogEntry): void {
  const p = event.payload as unknown as TeacherObservationRecordedPayload
  const existing = db
    .prepare('SELECT offline_score_id FROM offline_score_record WHERE offline_score_id = ?')
    .get(p.offline_score_id)
  if (existing) return
  const session = db
    .prepare('SELECT status, delivery_phase, event_sequence_version FROM assessment_session WHERE session_id = ?')
    .get(p.session_id) as
    | { status: string; delivery_phase: AssessmentDeliveryPhase | null; event_sequence_version: number }
    | undefined
  if (!session) return
  if (isStaleAssessmentEvent(session, event)) return

  db.prepare(
    `INSERT INTO offline_score_record
       (offline_score_id, session_id, question_id, score_scope, task_operation_code,
        response_status, score, observation_payload_json,
        scored_by, scored_event_id, scored_at,
        tool_checklist_confirmed, revision_no, status)
     VALUES (?, ?, ?, 'TEACHER_OBSERVATION', NULL,
             'ANSWERED', NULL, ?,
             ?, ?, ?,
             0, 1, 'VALID')`
  ).run(
    p.offline_score_id,
    p.session_id,
    p.question_id,
    JSON.stringify(p.observation_payload),
    p.recorded_by,
    event.event_id,
    p.recorded_at
  )

  const nextPhase = TERMINAL_ASSESSMENT_STATUSES.has(session.status)
    ? undefined
    : resolveJobSkillPhaseAfterTeacherObservation(db, {
      sessionId: p.session_id,
      currentPhase: session.delivery_phase
    })
  applyAssessmentPhaseAndMark(db, {
    sessionId: p.session_id,
    event,
    deliveryPhase: nextPhase
  })
}
