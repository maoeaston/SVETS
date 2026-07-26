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
import { assertCaller, assertSessionOwner, assertStudent } from '../../utils/auth-context'
import { writeEvent } from '../../domain/event-writer'
import { applyAssessmentEvent } from '../../domain/assessment-reducer'
import { assertF7WriteAllowed, ReportWriteBlockedError } from '../../domain/report-write-gate'
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
import {
  finalizeJobSkillResultCore,
  maybeGenerateJobSkillReportAfterResult
} from './job-skill-result'
import { createJobSkillReportAutomation, type JobSkillReportAutomation } from './job-skill-report'

type JsonObject = Record<string, unknown>
type ScoreAnchors = { '0': string; '1': string; '2': string }

function parseObject(value: string): JsonObject {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as JsonObject : {}
  } catch {
    return {}
  }
}

function objectAt(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}
}

function textAt(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function parseScoreAnchors(content: JsonObject, scoring: JsonObject): ScoreAnchors | null {
  const rubric = objectAt(content.rubric)
  const candidates = [rubric.anchors, scoring.anchors, scoring.score_anchors]
  for (const candidate of candidates) {
    const record = objectAt(candidate)
    const zero = textAt(record['0'])
    const one = textAt(record['1'])
    const two = textAt(record['2'])
    if (zero && one && two) return { '0': zero, '1': one, '2': two }
  }

  const scoringCriteria = Array.isArray(scoring.criteria) ? scoring.criteria : []
  if (scoringCriteria.length > 0) {
    const build = (score: 0 | 1 | 2): string => scoringCriteria
      .map((raw) => objectAt(raw))
      .map((criterion) => textAt(criterion[`description_${score}`]))
      .filter((description): description is string => Boolean(description))
      .join('；')
    const anchors = { '0': build(0), '1': build(1), '2': build(2) }
    if (anchors['0'] && anchors['1'] && anchors['2']) return anchors
  }
  return null
}

function buildScoringQuestion(
  row: {
    question_id: string
    job_module_code: string
    question_type: string
    version: number
    content_json: string
    scoring_rule_json: string
  },
  includeTeacherFields: boolean
): SessionScoringQuestion {
  const content = parseObject(row.content_json)
  const scoring = parseObject(row.scoring_rule_json)
  const tools = objectAt(content.tools)
  const rubric = objectAt(content.rubric)
  const safety = objectAt(content.safety)
  const rawCriteria = Array.isArray(content.rubric_criteria)
    ? content.rubric_criteria
    : Array.isArray(rubric.criteria) ? rubric.criteria : []
  const scoreAnchors = parseScoreAnchors(content, scoring)

  return {
    questionId: row.question_id,
    jobModuleCode: row.job_module_code,
    questionVersion: row.version,
    questionType: row.question_type,
    prompt: textAt(content.prompt) ?? '',
    toolBrief: textAt(content.offline_tool_brief) ?? textAt(tools.brief),
    rubricCriteria: includeTeacherFields
      ? rawCriteria.map((raw) => objectAt(raw)).map((criterion) => ({
          criterionId: textAt(criterion.criterion_id) ?? '',
          description: textAt(criterion.description) ?? ''
        })).filter((criterion) => criterion.description.length > 0)
      : [],
    scoreAnchors: includeTeacherFields ? scoreAnchors : null,
    safetyStopConditions: textAt(safety.proposed_stop_conditions)
      ?? textAt(content.safety_stop_conditions)
      ?? textAt(objectAt(content.termination_policy).safety_stop_description),
    anchorVersion: `${row.question_id}@${row.version}`,
    sealedAdminConfig: includeTeacherFields
      ? objectAt(rubric.sealed_admin_config ?? content.sealed_admin_config)
      : null
  }
}

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
  params: SubmitJobSkillOfflineScoresParams,
  automation?: JobSkillReportAutomation
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
        WHERE session_id = ?
          AND bank_domain = 'JOB_SPECIFIC'
          AND question_phase = 'OFFLINE'
          AND item_usage = 'SCORED_ITEM'`
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
    const question = db
      .prepare('SELECT content_json, scoring_rule_json, version FROM question_bank WHERE question_id = ?')
      .get(item.questionId) as { content_json: string; scoring_rule_json: string; version: number } | undefined
    if (!question) return { success: false, errorCode: 'VALIDATION_ERROR' }
    const anchorVersion = `${item.questionId}@${question.version}`
    if (item.anchorVersion && item.anchorVersion !== anchorVersion) {
      return { success: false, errorCode: 'VALIDATION_ERROR' }
    }
    const expectedAnchor = parseScoreAnchors(
      parseObject(question.content_json),
      parseObject(question.scoring_rule_json)
    )?.[String(item.score) as '0' | '1' | '2'] ?? null
    if (expectedAnchor && item.selectedAnchor !== expectedAnchor) {
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

  // 8. 事务：N × OFFLINE_SCORE_SUBMITTED + 可选 JOB_SKILL finalization
  try {
    assertF7WriteAllowed('RESULT')
    let itemsScored = 0
    let finalized = false

    const txn = db.transaction(() => {
      const scoredAt = new Date().toISOString()

      for (const item of params.scores) {
        const question = db
          .prepare('SELECT content_json, scoring_rule_json, version FROM question_bank WHERE question_id = ?')
          .get(item.questionId) as { content_json: string; scoring_rule_json: string; version: number } | undefined
        const anchorVersion = `${item.questionId}@${question?.version ?? 1}`
        const content = parseObject(question?.content_json ?? '{}')
        const scoring = parseObject(question?.scoring_rule_json ?? '{}')
        const expectedAnchor = parseScoreAnchors(content, scoring)?.[String(item.score) as '0' | '1' | '2'] ?? null
        const scoringRubricJson = JSON.stringify({
          ...scoring,
          selected_score: item.score,
          selected_anchor: item.selectedAnchor ?? expectedAnchor,
          anchor_version: item.anchorVersion ?? anchorVersion
        })

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

      finalized = finalizeJobSkillResultCore(db, params.sessionId, params.callerUserId)
    })

    txn()

    // T10: 报告生成在评分/finalize 事务提交后执行，避免嵌套事务。
    if (finalized) {
      maybeGenerateJobSkillReportAfterResult(db, params.sessionId, params.callerUserId, automation)
    }

    return { success: true, itemsScored }
  } catch (err) {
    if (err instanceof ReportWriteBlockedError) {
      return { success: false, errorCode: 'ASSESSMENT_SYSTEM_ERROR' }
    }
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
      `SELECT question_id, score, scoring_rubric_json, observation_note, scored_at
         FROM offline_score_record
        WHERE session_id = ? AND score_scope = 'JOB_SKILL' AND status = 'VALID'
        ORDER BY rowid`
    )
    .all(params.sessionId) as {
    question_id: string
    score: 0 | 1 | 2
    scoring_rubric_json: string | null
    observation_note: string | null
    scored_at: string
  }[]

  const items: JobSkillOfflineScoreView[] = rows.map((r) => {
    const rubric = parseObject(r.scoring_rubric_json ?? '{}')
    return {
      questionId: r.question_id,
      score: r.score,
      anchorVersion: textAt(rubric.anchor_version),
      selectedAnchor: textAt(rubric.selected_anchor),
      observationNote: r.observation_note,
      scoredAt: r.scored_at
    }
  })

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
  let includeTeacherFields = false
  if (params.callerRole === 'STUDENT') {
    const student = assertStudent(db, params.callerUserId, params.callerRole)
    if (!student.ok) return { success: false, errorCode: 'FORBIDDEN' }
    const owner = assertSessionOwner(db, student.row.user_id, params.sessionId)
    if (!owner.ok) return { success: false, errorCode: owner.errorCode }
  } else {
    const caller = assertCaller(db, params.callerUserId, params.callerRole)
    if (!caller.ok) return { success: false, errorCode: 'FORBIDDEN' }
    includeTeacherFields = true
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
      `SELECT sq.question_id, sq.job_module_code, sq.question_type,
              qb.version, qb.content_json, qb.scoring_rule_json
         FROM assessment_session_question sq
         JOIN question_bank qb ON qb.question_id = sq.question_id
        WHERE sq.session_id = ? AND sq.question_phase = 'OFFLINE' AND sq.item_usage = 'SCORED_ITEM'
        ORDER BY question_order`
    )
    .all(params.sessionId) as Array<{ question_id: string; job_module_code: string; question_type: string; version: number; content_json: string; scoring_rule_json: string }>

  const obsRows = db
    .prepare(
      `SELECT sq.question_id, sq.job_module_code, sq.question_type,
              qb.version, qb.content_json, qb.scoring_rule_json
         FROM assessment_session_question sq
         JOIN question_bank qb ON qb.question_id = sq.question_id
        WHERE sq.session_id = ? AND sq.question_phase = 'OBSERVATION'
        ORDER BY question_order`
    )
    .all(params.sessionId) as Array<{ question_id: string; job_module_code: string; question_type: string; version: number; content_json: string; scoring_rule_json: string }>

  const offlineQuestions = offlineRows.map((row) => buildScoringQuestion(row, includeTeacherFields))
  const observationQuestions = obsRows.map((row) => buildScoringQuestion(row, includeTeacherFields))

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
    const db = getDb()
    return submitJobSkillOfflineScores(db, params as SubmitJobSkillOfflineScoresParams, createJobSkillReportAutomation(db))
  })

  ipcMain.handle('assessment:getJobSkillOfflineScores', (_event, params: unknown) => {
    return getJobSkillOfflineScores(getDb(), params as GetJobSkillOfflineScoresParams)
  })

  ipcMain.handle('assessment:getSessionScoringQuestions', (_event, params: unknown) => {
    return getSessionScoringQuestions(getDb(), params as GetSessionScoringQuestionsParams)
  })
}
