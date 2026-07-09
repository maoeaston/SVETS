// JOB_SKILL 线下评分（Job Skill Offline Scoring）IPC handler 模块（T7）。
// 核心路径：TEACHER 对 OFFLINE_PENDING 的 JOB_SKILL_ASSESSMENT session 批量提交
// 6 道 OFFLINE_OPERATION 线下题的 0/1/2 分，写入 6 条 offline_score_record
// （score_scope=JOB_SKILL）。不生成 result_record（留给 T9）。
//
// 纯函数模式（与 operation-scoring.ts 同）：submitJobSkillOfflineScores /
// getJobSkillOfflineScores 接收 DBAdapter，registerJobSkillScoringHandlers
// 是薄包装，测试直接调纯函数 + MemoryAdapter。

import { ipcMain } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import type { DBAdapter } from '../../db/interface'
import { SqliteAdapter } from '../../db/sqlite-adapter'
import { getDatabase } from '../../db/connection'
import { assertCaller } from '../../utils/auth-context'
import { writeEvent } from '../../domain/event-writer'
import { applyAssessmentEvent } from '../../domain/assessment-reducer'
import type {
  SubmitJobSkillOfflineScoresParams,
  SubmitJobSkillOfflineScoresResult,
  GetJobSkillOfflineScoresParams,
  GetJobSkillOfflineScoresResult,
  GetSessionScoringQuestionsParams,
  GetSessionScoringQuestionsResult,
  JobSkillOfflineScoreView,
  SessionScoringQuestion
} from '../../../shared/types/job-skill-scoring'
import type { OfflineScoreSubmittedPayload } from '@shared/types/event-payloads'
import { maybeGenerateJobSkillResult } from './job-skill-result'

// ---------------------------------------------------------------------------
// submitJobSkillOfflineScores — 核心纯函数
// ---------------------------------------------------------------------------

/**
 * TEACHER 批量提交 6 道 JOB_SKILL 线下题评分。
 *
 * 校验链：
 *   assertCaller(TEACHER) → sessionId 非空 → session 存在
 *   → strategy_type = JOB_SKILL_ASSESSMENT → status = OFFLINE_PENDING
 *   → 无未解决安全事件 → 读该 session 的 6 道 OFFLINE/SCORED_ITEM 题
 *   → scores 长度 = 6，每项 questionId ∈ 合法集合、score ∈ {0,1,2}，无重复
 *   → 无已有 VALID JOB_SKILL 记录（幂等防护）
 *   → db.transaction { 6 × writeEvent(OFFLINE_SCORE_SUBMITTED) + applyAssessmentEvent }
 */
export function submitJobSkillOfflineScores(
  db: DBAdapter,
  params: SubmitJobSkillOfflineScoresParams
): SubmitJobSkillOfflineScoresResult {
  // 1. 身份校验（TEACHER）
  const caller = assertCaller(db, params.callerUserId, params.callerRole)
  if (!caller.ok) {
    return { success: false, errorCode: 'FORBIDDEN' }
  }

  // 2. sessionId 非空
  if (typeof params.sessionId !== 'string' || params.sessionId.length === 0) {
    return { success: false, errorCode: 'NOT_FOUND' }
  }

  // 3. 读 session，校验 strategy_type + OFFLINE_PENDING
  const session = db
    .prepare(
      `SELECT session_id, status, student_id, task_code, strategy_type
         FROM assessment_session
        WHERE session_id = ?`
    )
    .get(params.sessionId) as
    | { session_id: string; status: string; student_id: string; task_code: string; strategy_type: string }
    | undefined

  if (!session) {
    return { success: false, errorCode: 'NOT_FOUND' }
  }
  if (session.strategy_type !== 'JOB_SKILL_ASSESSMENT') {
    return { success: false, errorCode: 'VALIDATION_ERROR' }
  }
  if (session.status !== 'OFFLINE_PENDING') {
    return { success: false, errorCode: 'SESSION_NOT_OFFLINE_PENDING' }
  }

  // 4. 校验无未解决安全事件（与 createSession/assessment.ts 同模式；注意列名是
  //    requires_review_before_next_session，非 operation-scoring.ts 中误写的 requires_review）
  const blocked = db
    .prepare(
      `SELECT 1 FROM safety_incident
        WHERE student_id = ? AND task_code = ?
          AND status IN ('PENDING_DETAIL', 'CONFIRMED')
          AND requires_review_before_next_session = 1
        LIMIT 1`
    )
    .get(session.student_id, session.task_code)
  if (blocked) {
    return { success: false, errorCode: 'BLOCKED_BY_SAFETY_INCIDENT' }
  }

  // 5. 读该 session 合法的 6 道 OFFLINE + SCORED_ITEM 题
  const offlineQuestions = db
    .prepare(
      `SELECT question_id FROM assessment_session_question
        WHERE session_id = ? AND question_phase = 'OFFLINE' AND item_usage = 'SCORED_ITEM'`
    )
    .all(params.sessionId) as { question_id: string }[]
  const validQuestionIds = new Set(offlineQuestions.map((r) => r.question_id))

  // 6. 校验 scores 数组
  if (!Array.isArray(params.scores) || params.scores.length !== offlineQuestions.length) {
    return { success: false, errorCode: 'VALIDATION_ERROR' }
  }
  const seenIds = new Set<string>()
  for (const item of params.scores) {
    if (!validQuestionIds.has(item.questionId)) {
      return { success: false, errorCode: 'VALIDATION_ERROR' }
    }
    if (![0, 1, 2].includes(item.score)) {
      return { success: false, errorCode: 'VALIDATION_ERROR' }
    }
    if (seenIds.has(item.questionId)) {
      return { success: false, errorCode: 'VALIDATION_ERROR' }
    }
    seenIds.add(item.questionId)
  }

  // 7. 幂等防护：已有 VALID + JOB_SKILL 记录
  const alreadyScored = db
    .prepare(
      `SELECT 1 FROM offline_score_record
        WHERE session_id = ? AND score_scope = 'JOB_SKILL' AND status = 'VALID'
        LIMIT 1`
    )
    .get(params.sessionId)
  if (alreadyScored) {
    return { success: false, errorCode: 'ALREADY_SCORED' }
  }

  // 8. 事务：N × OFFLINE_SCORE_SUBMITTED
  try {
    let itemsScored = 0

    const txn = db.transaction(() => {
      const scoredAt = new Date().toISOString()

      for (const item of params.scores) {
        const question = db
          .prepare('SELECT scoring_rule_json FROM question_bank WHERE question_id = ?')
          .get(item.questionId) as { scoring_rule_json: string } | undefined
        const scoringRubricJson = question?.scoring_rule_json ?? '{}'

        const offlineScoreId = uuidv4()

        const payload: OfflineScoreSubmittedPayload = {
          session_id: params.sessionId,
          offline_score_id: offlineScoreId,
          question_id: item.questionId,
          score_scope: 'JOB_SKILL',
          task_operation_code: null,
          criterion_scores: [{ criterion_id: item.questionId, score: item.score }],
          total_score: item.score,
          scored_by: params.callerUserId,
          scored_at: scoredAt,
          scoring_rubric_json: scoringRubricJson,
          observation_note: item.observationNote ?? null,
          tool_checklist_confirmed: true
        }

        const event = writeEvent({
          aggregateType: 'ASSESSMENT_SESSION',
          aggregateId: params.sessionId,
          eventType: 'OFFLINE_SCORE_SUBMITTED',
          payload: payload as unknown as Record<string, unknown>,
          actorId: params.callerUserId,
          actorRole: 'TEACHER'
        })

        applyAssessmentEvent(db, event)
        itemsScored += 1
      }
    })

    txn()

    // T9: 自动触发结果生成（若所有线下+观察项均已完成）
    try {
      maybeGenerateJobSkillResult(db, params.sessionId, params.callerUserId)
    } catch (genErr) {
      console.error('[submitJobSkillOfflineScores] result generation error:', genErr)
    }

    return { success: true, itemsScored }
  } catch (err) {
    console.error('[submitJobSkillOfflineScores] error:', err)
    return { success: false, errorCode: 'ASSESSMENT_SYSTEM_ERROR' }
  }
}

// ---------------------------------------------------------------------------
// getJobSkillOfflineScores — 纯读函数
// ---------------------------------------------------------------------------

/**
 * 读取 session 的 JOB_SKILL 线下评分记录（TEACHER/ADMIN 可调用）。
 */
export function getJobSkillOfflineScores(
  db: DBAdapter,
  params: GetJobSkillOfflineScoresParams
): GetJobSkillOfflineScoresResult {
  const caller = assertCaller(db, params.callerUserId, params.callerRole)
  if (!caller.ok) {
    return { success: false, errorCode: 'FORBIDDEN' }
  }

  if (typeof params.sessionId !== 'string' || params.sessionId.length === 0) {
    return { success: false, errorCode: 'NOT_FOUND' }
  }

  const sessionExists = db
    .prepare('SELECT 1 FROM assessment_session WHERE session_id = ?')
    .get(params.sessionId)
  if (!sessionExists) {
    return { success: false, errorCode: 'NOT_FOUND' }
  }

  const rows = db
    .prepare(
      `SELECT question_id, score, observation_note, scored_at
         FROM offline_score_record
        WHERE session_id = ? AND score_scope = 'JOB_SKILL' AND status = 'VALID'
        ORDER BY rowid`
    )
    .all(params.sessionId) as {
    question_id: string
    score: 0 | 1 | 2
    observation_note: string | null
    scored_at: string
  }[]

  const items: JobSkillOfflineScoreView[] = rows.map((r) => ({
    questionId: r.question_id,
    score: r.score,
    observationNote: r.observation_note,
    scoredAt: r.scored_at
  }))

  return { success: true, items }
}

// ---------------------------------------------------------------------------
// getSessionScoringQuestions — 纯读：返回 session 的线下/观察题 ID + 模块信息
// ---------------------------------------------------------------------------

/**
 * 供前端 JobSkillScoringView / TeacherObservationView 使用，
 * 在评分/录入前查询该 session 的题目 ID 和所属模块。
 */
export function getSessionScoringQuestions(
  db: DBAdapter,
  params: GetSessionScoringQuestionsParams
): GetSessionScoringQuestionsResult {
  const caller = assertCaller(db, params.callerUserId, params.callerRole)
  if (!caller.ok) {
    return { success: false, errorCode: 'FORBIDDEN' }
  }

  if (typeof params.sessionId !== 'string' || params.sessionId.length === 0) {
    return { success: false, errorCode: 'NOT_FOUND' }
  }

  const sessionExists = db
    .prepare('SELECT 1 FROM assessment_session WHERE session_id = ?')
    .get(params.sessionId)
  if (!sessionExists) {
    return { success: false, errorCode: 'NOT_FOUND' }
  }

  const offlineRows = db
    .prepare(
      `SELECT question_id, job_module_code FROM assessment_session_question
        WHERE session_id = ? AND question_phase = 'OFFLINE' AND item_usage = 'SCORED_ITEM'
        ORDER BY question_order`
    )
    .all(params.sessionId) as { question_id: string; job_module_code: string }[]

  const obsRows = db
    .prepare(
      `SELECT question_id, job_module_code FROM assessment_session_question
        WHERE session_id = ? AND question_phase = 'OBSERVATION'
        ORDER BY question_order`
    )
    .all(params.sessionId) as { question_id: string; job_module_code: string }[]

  const offlineQuestions: SessionScoringQuestion[] = offlineRows.map((r) => ({
    questionId: r.question_id,
    jobModuleCode: r.job_module_code
  }))
  const observationQuestions: SessionScoringQuestion[] = obsRows.map((r) => ({
    questionId: r.question_id,
    jobModuleCode: r.job_module_code
  }))

  return { success: true, offlineQuestions, observationQuestions }
}

// ---------------------------------------------------------------------------
// registerJobSkillScoringHandlers — IPC 注册（薄包装）
// ---------------------------------------------------------------------------

function defaultGetDb(): DBAdapter {
  return new SqliteAdapter(getDatabase())
}

export function registerJobSkillScoringHandlers(getDb: () => DBAdapter = defaultGetDb): void {
  ipcMain.handle('assessment:submitJobSkillOfflineScores', (_event, params: unknown) => {
    return submitJobSkillOfflineScores(getDb(), params as SubmitJobSkillOfflineScoresParams)
  })

  ipcMain.handle('assessment:getJobSkillOfflineScores', (_event, params: unknown) => {
    return getJobSkillOfflineScores(getDb(), params as GetJobSkillOfflineScoresParams)
  })

  ipcMain.handle('assessment:getSessionScoringQuestions', (_event, params: unknown) => {
    return getSessionScoringQuestions(getDb(), params as GetSessionScoringQuestionsParams)
  })
}
