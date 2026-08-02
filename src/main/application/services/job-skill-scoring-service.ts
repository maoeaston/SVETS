// JOB_SKILL 线下评分（Job Skill Offline Scoring）application service（T7）。
// 核心路径：TEACHER 对 OFFLINE_PENDING 的 JOB_SKILL_ASSESSMENT session 批量提交
// 6 道 OFFLINE_OPERATION 线下题的 0/1/2 分，写入 6 条 offline_score_record
// （score_scope=JOB_SKILL）。不生成 result_record（留给 T9）。
//
// submitJobSkillOfflineScores 接收 DBAdapter 与 accepted command execution。

import { v4 as uuidv4 } from 'uuid'
import type { DBAdapter } from '../../db/interface'
import { assertCaller } from '../../utils/auth-context'
import { applyAssessmentEvent } from '../../domain/assessment-reducer'
import type { ReportMutationPort } from '../../domain/report-command-coordinator'
import { assertF7WriteAllowed, ReportWriteBlockedError } from '../../domain/report-write-gate'
import type { AcceptedCommandContext } from '../command/command-types'
import type {
  SubmitJobSkillOfflineScoresParams,
  SubmitJobSkillOfflineScoresResult
} from '../../../shared/types/job-skill-scoring'
import type { OfflineScoreSubmittedPayload } from '@shared/types/event-payloads'
import {
  finalizeJobSkillResultCore,
  maybeGenerateJobSkillReportAfterResult,
  type JobSkillResultMutationExecution
} from './job-skill-result-service'
import type { JobSkillReportAutomation } from './job-skill-report-service'

type JsonObject = Record<string, unknown>
type ScoreAnchors = { '0': string; '1': string; '2': string }

export interface JobSkillScoringMutationExecution extends JobSkillResultMutationExecution {
  readonly eventPort: Pick<ReportMutationPort, 'writeEvent'>
  readonly context: AcceptedCommandContext
  readonly automation?: JobSkillReportAutomation
}

function correlationFor(execution: JobSkillScoringMutationExecution): string {
  if (execution.context.envelope.commandType !== 'assessment:submitJobSkillOfflineScores') {
    throw new Error('job-skill scoring requires accepted assessment:submitJobSkillOfflineScores context')
  }
  const correlationId = execution.context.envelope.correlationId
  if (!correlationId.trim()) throw new Error('job-skill scoring correlation is required')
  return correlationId
}

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
  const candidates = [rubric.anchors, scoring.anchors, scoring.score_anchors, scoring.score_labels]
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
      .map((criterion) => textAt(criterion[`description_${score}`]) ?? textAt(criterion[`score_${score}`]))
      .filter((description): description is string => Boolean(description))
      .join('；')
    const anchors = { '0': build(0), '1': build(1), '2': build(2) }
    if (anchors['0'] && anchors['1'] && anchors['2']) return anchors
  }
  return null
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
 *   → db.transaction { 6 × eventPort.writeEvent(OFFLINE_SCORE_SUBMITTED) + applyAssessmentEvent }
 */
export function submitJobSkillOfflineScores(
  db: DBAdapter,
  params: SubmitJobSkillOfflineScoresParams,
  execution: JobSkillScoringMutationExecution
): SubmitJobSkillOfflineScoresResult {
  const correlationId = correlationFor(execution)
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
      `SELECT session_id, status, student_id, job_code, task_code, strategy_type
         FROM assessment_session
        WHERE session_id = ?`
    )
    .get(params.sessionId) as
    | { session_id: string; status: string; student_id: string; job_code: string; task_code: string; strategy_type: string }
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

  // 4. 校验同 student/job/task 下无未解决安全事件（与 createSession/assessment.ts 同模式）
  const blocked = db
    .prepare(
      `SELECT 1 FROM safety_incident
        WHERE student_id = ? AND job_code = ? AND task_code = ?
          AND status IN ('PENDING_DETAIL', 'CONFIRMED')
          AND requires_review_before_next_session = 1
        LIMIT 1`
    )
    .get(session.student_id, session.job_code, session.task_code)
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

        const event = execution.eventPort.writeEvent({
          aggregateType: 'ASSESSMENT_SESSION',
          aggregateId: params.sessionId,
          eventType: 'OFFLINE_SCORE_SUBMITTED',
          payload: payload as unknown as Record<string, unknown>,
          actorId: params.callerUserId,
          actorRole: 'TEACHER',
          correlationId
        })

        applyAssessmentEvent(db, event)
        itemsScored += 1
      }

      finalized = finalizeJobSkillResultCore(
        db,
        params.sessionId,
        params.callerUserId,
        execution
      )
    })

    txn()

    // T10: 报告生成在评分/finalize 事务提交后执行，避免嵌套事务。
    if (finalized && execution.automation) {
      maybeGenerateJobSkillReportAfterResult(
        db,
        params.sessionId,
        params.callerUserId,
        execution.automation,
        execution
      )
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
