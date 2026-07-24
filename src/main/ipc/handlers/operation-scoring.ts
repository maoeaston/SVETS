// 实操评分（Operation Scoring）IPC handler 模块。
// 核心路径：TEACHER 对 OFFLINE_PENDING 的 assessment_session 批量提交 9 项实操评分，
// 写入 9 条 offline_score_record + 1 条 OPERATION_PASS_RATE result_record。
//
// 纯函数模式（与 assessment.ts 同）：submitOperationScores / getOperationScores 接收 DBAdapter，
// registerOperationScoringHandlers 是薄包装，测试直接调纯函数 + MemoryAdapter。

import { ipcMain } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import type { DBAdapter } from '../../db/interface'
import { SqliteAdapter } from '../../db/sqlite-adapter'
import { getDatabase } from '../../db/connection'
import { assertCaller } from '../../utils/auth-context'
import { writeEvent } from '../../domain/event-writer'
import { applyAssessmentEvent } from '../../domain/assessment-reducer'
import {
  TASK_OPERATION_CODES,
  OPERATION_RUBRICS
} from '../../../shared/types/operation-scoring'
import type {
  TaskOperationCode,
  SubmitOperationScoresParams,
  SubmitOperationScoresResult,
  GetOperationScoresParams,
  GetOperationScoresResult,
  OperationScoreItem,
  OperationPassRatePayload
} from '../../../shared/types/operation-scoring'
import type {
  OfflineScoreSubmittedPayload,
  ResultCalculatedPayload
} from '@shared/types/event-payloads'

// ---------------------------------------------------------------------------
// submitOperationScores — 核心纯函数
// ---------------------------------------------------------------------------

/**
 * TEACHER 批量提交 9 项实操评分。
 *
 * 校验链：
 *   assertCaller(TEACHER) → sessionId 非空 → session 存在 + OFFLINE_PENDING
 *   → 无未解决安全事件 → toolChecklistConfirmed = true
 *   → scores 长度 = 9，每项 code ∈ TASK_OPERATION_CODES，score ∈ {0,1,2}，无重复 code
 *   → 无已有 VALID TASK_OPERATION 记录（幂等防护）
 *   → 读 strategy_config 获取阈值
 *   → db.transaction { 9 × writeEvent(OFFLINE_SCORE_SUBMITTED) + applyAssessmentEvent
 *                      + writeEvent(RESULT_CALCULATED) + applyAssessmentEvent }
 */
export function submitOperationScores(
  db: DBAdapter,
  params: SubmitOperationScoresParams
): SubmitOperationScoresResult {
  // 1. 身份校验（TEACHER）
  const caller = assertCaller(db, params.callerUserId, params.callerRole)
  if (!caller.ok) {
    return { success: false, errorCode: 'FORBIDDEN' }
  }

  // 2. sessionId 非空
  if (typeof params.sessionId !== 'string' || params.sessionId.length === 0) {
    return { success: false, errorCode: 'NOT_FOUND' }
  }

  // 3. 读 session，校验 OFFLINE_PENDING
  const session = db
    .prepare(
      `SELECT session_id, status, student_id, job_code, task_code,
              strategy_id, strategy_type, strategy_version
         FROM assessment_session
        WHERE session_id = ?`
    )
    .get(params.sessionId) as
    | {
        session_id: string
        status: string
        student_id: string
        job_code: string
        task_code: string
        strategy_id: string
        strategy_type: ResultCalculatedPayload['strategy_type']
        strategy_version: number
      }
    | undefined

  if (!session) {
    return { success: false, errorCode: 'NOT_FOUND' }
  }
  if (session.status !== 'OFFLINE_PENDING') {
    return { success: false, errorCode: 'SESSION_NOT_OFFLINE_PENDING' }
  }

  // 4. 校验无未解决安全事件（与 createSession 同模式）
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

  // 5. 校验 toolChecklistConfirmed
  if (!params.toolChecklistConfirmed) {
    return { success: false, errorCode: 'TOOL_CHECKLIST_NOT_CONFIRMED' }
  }

  // 6–8. 校验 scores 数组
  if (!Array.isArray(params.scores) || params.scores.length !== 9) {
    return { success: false, errorCode: 'VALIDATION_ERROR' }
  }
  const validCodes = new Set<string>(TASK_OPERATION_CODES)
  const seenCodes = new Set<string>()
  for (const item of params.scores) {
    if (!validCodes.has(item.taskOperationCode)) {
      return { success: false, errorCode: 'VALIDATION_ERROR' }
    }
    if (![0, 1, 2].includes(item.score)) {
      return { success: false, errorCode: 'VALIDATION_ERROR' }
    }
    if (seenCodes.has(item.taskOperationCode)) {
      return { success: false, errorCode: 'VALIDATION_ERROR' }
    }
    seenCodes.add(item.taskOperationCode)
  }

  // 9. 幂等防护：已有 VALID + TASK_OPERATION 记录
  const alreadyScored = db
    .prepare(
      `SELECT 1 FROM offline_score_record
        WHERE session_id = ? AND score_scope = 'TASK_OPERATION' AND status = 'VALID'
        LIMIT 1`
    )
    .get(params.sessionId)
  if (alreadyScored) {
    return { success: false, errorCode: 'ALREADY_SCORED' }
  }

  // 10. 读 strategy_config 获取阈值
  const strategy = db
    .prepare(
      `SELECT competent_threshold, conditional_threshold
         FROM strategy_config
        WHERE strategy_id = ? AND version = ?`
    )
    .get(session.strategy_id, session.strategy_version) as
    | { competent_threshold: number; conditional_threshold: number }
    | undefined

  if (!strategy) {
    return { success: false, errorCode: 'ASSESSMENT_SYSTEM_ERROR' }
  }

  // 11. 事务：9 × OFFLINE_SCORE_SUBMITTED + 1 × RESULT_CALCULATED
  try {
    let resultId = ''
    let normalizedScore = 0
    let levelResult = ''

    const txn = db.transaction(() => {
      const scoredAt = new Date().toISOString()
      const scoresInOrder = TASK_OPERATION_CODES.map((code) => {
        const found = params.scores.find((s) => s.taskOperationCode === code)!
        return found
      })

      // 9 条 OFFLINE_SCORE_SUBMITTED
      for (const item of scoresInOrder) {
        const rubric = OPERATION_RUBRICS.find((r) => r.code === item.taskOperationCode)!
        const offlineScoreId = uuidv4()

        const payload: OfflineScoreSubmittedPayload = {
          session_id: params.sessionId,
          offline_score_id: offlineScoreId,
          question_id: null,
          score_scope: 'TASK_OPERATION',
          task_operation_code: item.taskOperationCode,
          criterion_scores: [
            { criterion_id: item.taskOperationCode, score: item.score }
          ],
          total_score: item.score,
          scored_by: params.callerUserId,
          scored_at: scoredAt,
          scoring_rubric_json: JSON.stringify(rubric),
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
      }

      // 计算 OPERATION_PASS_RATE
      const rawScore = scoresInOrder.reduce((sum, s) => sum + s.score, 0)
      const maxScore = 18
      normalizedScore = Math.round((rawScore / maxScore) * 100)

      // 等级判定（直接 if-else，不复用 judgeLevel，理由见 impl.md Step 3 决策说明）
      if (normalizedScore >= strategy.competent_threshold) {
        levelResult = 'LEVEL_COMPETENT'
      } else if (normalizedScore >= strategy.conditional_threshold) {
        levelResult = 'LEVEL_CONDITIONAL'
      } else {
        levelResult = 'LEVEL_NOT_COMPETENT'
      }

      const breakdown: OperationPassRatePayload = {
        result_type: 'OPERATION_PASS_RATE',
        items: scoresInOrder.map((s) => ({
          task_operation_code: s.taskOperationCode as TaskOperationCode,
          score: s.score
        })),
        raw_score: rawScore,
        max_score: 18,
        total_items: 9
      }

      resultId = uuidv4()
      const resultPayload: ResultCalculatedPayload = {
        result_id: resultId,
        result_type: 'OPERATION_PASS_RATE',
        source_type: 'ASSESSMENT_SESSION',
        source_id: params.sessionId,
        student_id: session.student_id,
        strategy_id: session.strategy_id,
        strategy_type: session.strategy_type,
        job_code: session.job_code,
        task_code: session.task_code,
        module_type: null,
        raw_score: rawScore,
        max_score: maxScore,
        normalized_score: normalizedScore,
        level_result: levelResult,
        calculated_at: new Date().toISOString(),
        calculated_by: params.callerUserId,
        completion_ratio: 1.0,
        breakdown
      }

      const resultEvent = writeEvent({
        aggregateType: 'ASSESSMENT_SESSION',
        aggregateId: params.sessionId,
        eventType: 'RESULT_CALCULATED',
        payload: resultPayload as unknown as Record<string, unknown>,
        actorId: params.callerUserId,
        actorRole: 'TEACHER'
      })

      applyAssessmentEvent(db, resultEvent)
    })

    txn()

    return {
      success: true,
      resultId,
      normalizedScore,
      levelResult
    }
  } catch (err) {
    console.error('[submitOperationScores] error:', err)
    return { success: false, errorCode: 'ASSESSMENT_SYSTEM_ERROR' }
  }
}

// ---------------------------------------------------------------------------
// getOperationScores — 纯读函数
// ---------------------------------------------------------------------------

/**
 * 读取 session 的实操评分记录（TEACHER/ADMIN 可调用）。
 * 若已完成评分，同时返回 result_record 摘要。
 */
export function getOperationScores(
  db: DBAdapter,
  params: GetOperationScoresParams
): GetOperationScoresResult {
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
      `SELECT task_operation_code, score, observation_note, scored_at
         FROM offline_score_record
        WHERE session_id = ? AND score_scope = 'TASK_OPERATION' AND status = 'VALID'
        ORDER BY rowid`
    )
    .all(params.sessionId) as {
    task_operation_code: string
    score: 0 | 1 | 2
    observation_note: string | null
    scored_at: string
  }[]

  const items: OperationScoreItem[] = rows.map((r) => ({
    taskOperationCode: r.task_operation_code as TaskOperationCode,
    score: r.score,
    observationNote: r.observation_note,
    scoredAt: r.scored_at
  }))

  const result = db
    .prepare(
      `SELECT result_id, normalized_score, level_result
         FROM result_record
        WHERE source_aggregate_id = ? AND result_type = 'OPERATION_PASS_RATE' AND is_current = 1
        LIMIT 1`
    )
    .get(params.sessionId) as
    | { result_id: string; normalized_score: number; level_result: string }
    | undefined

  return {
    success: true,
    items,
    resultId: result?.result_id,
    normalizedScore: result?.normalized_score,
    levelResult: result?.level_result
  }
}

// ---------------------------------------------------------------------------
// registerOperationScoringHandlers — IPC 注册（薄包装）
// ---------------------------------------------------------------------------

function defaultGetDb(): DBAdapter {
  return new SqliteAdapter(getDatabase())
}

export function registerOperationScoringHandlers(getDb: () => DBAdapter = defaultGetDb): void {
  ipcMain.handle('assessment:submitOperationScores', (_event, params: unknown) => {
    return submitOperationScores(getDb(), params as SubmitOperationScoresParams)
  })

  ipcMain.handle('assessment:getOperationScores', (_event, params: unknown) => {
    return getOperationScores(getDb(), params as GetOperationScoresParams)
  })
}
