// T9: JOB_SKILL_SCORE 自动生成。
// 在 submitJobSkillOfflineScores / recordTeacherObservation 成功后被调用。
// 所有线下计分题评分完成 + 所有观察项录入完成后，自动写 JOB_SKILL_SCORE result_record
// 并发出 SESSION_COMPLETED 事件（OFFLINE_PENDING → COMPLETED）。
//
// 纯函数：调用方负责捕获异常（不影响已提交的评分/观察录入）。

import { v4 as uuidv4 } from 'uuid'
import type { DBAdapter } from '../../db/interface'
import { writeEvent } from '../../domain/event-writer'
import { applyAssessmentEvent } from '../../domain/assessment-reducer'
import type {
  ResultCalculatedPayload,
  SessionCompletedPayload
} from '@shared/types/event-payloads'
import { maybeGenerateJobSkillReport, type JobSkillReportAutomation } from './job-skill-report'
import type {
  JobSkillResultPayload,
  JobModuleProfile,
  TeacherObservationSummary,
  SafetySummary,
  SafetyIncidentRef,
  TrainingFocusItem
} from '@shared/types/json-schemas'
import type { TeacherObservationPayload } from '@shared/types/json-schemas'

const JOB_MODULE_CODES = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'] as const
type JobModuleCodeLocal = (typeof JOB_MODULE_CODES)[number]

/**
 * 检查是否所有线下计分题已评分且所有观察项已录入；若是，生成 JOB_SKILL_SCORE 结果。
 *
 * 幂等：result_type='JOB_SKILL_SCORE' 已存在则直接返回。
 * 非 JOB_SKILL_ASSESSMENT / 终态 session 直接返回（不抛错）。
 * 本函数不开事务：调用方必须把它放在已有提交事务内，或改用 maybeGenerateJobSkillResult wrapper。
 */
export function finalizeJobSkillResultCore(
  db: DBAdapter,
  sessionId: string,
  callerUserId: string
): boolean {
  // 1. 读 session
  const session = db
    .prepare(
      `SELECT session_id, status, delivery_phase, strategy_type, student_id, job_code,
              task_code, strategy_id, strategy_version
         FROM assessment_session WHERE session_id = ?`
    )
    .get(sessionId) as
    | {
        session_id: string; status: string; delivery_phase: string | null; strategy_type: string
        student_id: string; job_code: string; task_code: string
        strategy_id: string; strategy_version: number
      }
    | undefined

  if (!session) return false
  if (session.strategy_type !== 'JOB_SKILL_ASSESSMENT') return false

  // 2. 终态 → 返回（REDLINE_HALTED 由 persistRedlineResult 处理）
  if (['COMPLETED', 'ABORTED', 'REDLINE_HALTED'].includes(session.status)) return false
  if (session.delivery_phase !== 'READY_TO_FINALIZE') return false

  // 3. 幂等：JOB_SKILL_SCORE 已存在
  const existing = db
    .prepare(
      `SELECT 1 FROM result_record
        WHERE source_aggregate_id = ? AND result_type = 'JOB_SKILL_SCORE' AND is_current = 1`
    )
    .get(sessionId)
  if (existing) return false

  // 4. 完成度检查：线下计分题
  const offlineCounts = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM assessment_session_question
           WHERE session_id = ?
             AND bank_domain = 'JOB_SPECIFIC'
             AND question_phase = 'OFFLINE'
             AND item_usage = 'SCORED_ITEM') AS total,
         (SELECT COUNT(*)
            FROM offline_score_record os
            JOIN assessment_session_question sq
              ON sq.session_id = os.session_id
             AND sq.question_id = os.question_id
           WHERE os.session_id = ?
             AND os.score_scope = 'JOB_SKILL'
             AND os.status = 'VALID'
             AND sq.bank_domain = 'JOB_SPECIFIC'
             AND sq.question_phase = 'OFFLINE'
             AND sq.item_usage = 'SCORED_ITEM') AS done`
    )
    .get(sessionId, sessionId) as { total: number; done: number }

  if (offlineCounts.done < offlineCounts.total) return false

  // 完成度检查：观察项
  const obsCounts = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM assessment_session_question
           WHERE session_id = ?
             AND bank_domain = 'JOB_SPECIFIC'
             AND question_phase = 'OBSERVATION') AS total,
         (SELECT COUNT(*)
            FROM offline_score_record os
            JOIN assessment_session_question sq
              ON sq.session_id = os.session_id
             AND sq.question_id = os.question_id
           WHERE os.session_id = ?
             AND os.score_scope = 'TEACHER_OBSERVATION'
             AND os.status = 'VALID'
             AND sq.bank_domain = 'JOB_SPECIFIC'
             AND sq.question_phase = 'OBSERVATION') AS done`
    )
    .get(sessionId, sessionId) as { total: number; done: number }

  if (obsCounts.done < obsCounts.total) return false

  // 5. 读 strategy_config（阈值 + training_focus_threshold）
  const strategy = db
    .prepare(
      `SELECT competent_threshold, conditional_threshold,
              CAST(JSON_EXTRACT(scoring_policy_json, '$.training_focus_threshold') AS REAL) AS training_focus_threshold
         FROM strategy_config
        WHERE strategy_id = ? AND version = ?`
    )
    .get(session.strategy_id, session.strategy_version) as
    | { competent_threshold: number; conditional_threshold: number; training_focus_threshold: number | null }
    | undefined

  if (!strategy) {
    throw new Error(
      `maybeGenerateJobSkillResult: strategy_config not found (${session.strategy_id} v${session.strategy_version})`
    )
  }
  const focusThreshold = strategy.training_focus_threshold ?? 0.6

  // 6. 每模块线上/线下分数
  const onlineByModule = db
    .prepare(
      `SELECT sq.job_module_code,
              SUM(COALESCE(ar.score, 0)) AS raw,
              COUNT(sq.question_id) * 2   AS max_score
         FROM assessment_session_question sq
         LEFT JOIN answer_record ar
           ON ar.session_id = sq.session_id
          AND ar.question_id = sq.question_id
          AND ar.status = 'VALID'
        WHERE sq.session_id = ? AND sq.question_phase = 'ONLINE'
          AND sq.bank_domain = 'JOB_SPECIFIC'
        GROUP BY sq.job_module_code`
    )
    .all(sessionId) as { job_module_code: string; raw: number; max_score: number }[]

  const offlineByModule = db
    .prepare(
      `SELECT sq.job_module_code,
              COALESCE(SUM(os.score), 0) AS raw,
              COUNT(sq.question_id) * 2   AS max_score
         FROM assessment_session_question sq
         LEFT JOIN offline_score_record os
           ON os.session_id = sq.session_id
          AND os.question_id = sq.question_id
          AND os.score_scope = 'JOB_SKILL'
          AND os.status = 'VALID'
        WHERE sq.session_id = ? AND sq.question_phase = 'OFFLINE' AND sq.item_usage = 'SCORED_ITEM'
          AND sq.bank_domain = 'JOB_SPECIFIC'
        GROUP BY sq.job_module_code`
    )
    .all(sessionId) as { job_module_code: string; raw: number; max_score: number }[]

  const onlineMap = new Map(onlineByModule.map((r) => [r.job_module_code, r]))
  const offlineMap = new Map(offlineByModule.map((r) => [r.job_module_code, r]))

  const moduleProfiles: Record<string, JobModuleProfile> = {}
  let totalOnlineRaw = 0, totalOnlineMax = 0, totalOfflineRaw = 0, totalOfflineMax = 0

  for (const mod of JOB_MODULE_CODES) {
    const on = onlineMap.get(mod) ?? { raw: 0, max_score: 6 }   // 3题×2分
    const off = offlineMap.get(mod) ?? { raw: 0, max_score: 2 } // 1题×2分
    const scoreRate = (on.max_score + off.max_score) > 0
      ? (on.raw + off.raw) / (on.max_score + off.max_score)
      : 0
    moduleProfiles[mod] = {
      online_raw: on.raw, online_max: on.max_score,
      offline_raw: off.raw, offline_max: off.max_score,
      score_rate: scoreRate, response_status_summary: {}
    }
    totalOnlineRaw += on.raw; totalOnlineMax += on.max_score
    totalOfflineRaw += off.raw; totalOfflineMax += off.max_score
  }

  const rawScore = totalOnlineRaw + totalOfflineRaw
  const maxScore = 48
  const normalizedScore = Math.min(100, (rawScore / maxScore) * 100)

  // completion_ratio：(线上已答题数 + 线下已评分题数) / 24
  const answeredOnline = db
    .prepare(
      `SELECT COUNT(*) AS n FROM answer_record ar
         JOIN assessment_session_question sq
           ON sq.session_id = ar.session_id AND sq.question_id = ar.question_id
        WHERE ar.session_id = ?
          AND ar.status = 'VALID'
          AND sq.bank_domain = 'JOB_SPECIFIC'
          AND sq.question_phase = 'ONLINE'`
    )
    .get(sessionId) as { n: number }
  const actualCompletionRatio = Math.min(1, (answeredOnline.n + offlineCounts.done) / 24)
  const obsRatio = obsCounts.total > 0 ? obsCounts.done / obsCounts.total : 1

  // 7. 教师观察记录
  const obsRows = db
    .prepare(
      `SELECT os.question_id, os.observation_payload_json
         FROM offline_score_record os
         JOIN assessment_session_question sq
           ON sq.session_id = os.session_id
          AND sq.question_id = os.question_id
        WHERE os.session_id = ?
          AND os.score_scope = 'TEACHER_OBSERVATION'
          AND os.status = 'VALID'
          AND sq.bank_domain = 'JOB_SPECIFIC'
          AND sq.question_phase = 'OBSERVATION'`
    )
    .all(sessionId) as { question_id: string; observation_payload_json: string }[]

  const teacherObservations: TeacherObservationSummary[] = obsRows.map((r) => {
    let parsed: Partial<TeacherObservationPayload> = {}
    try { parsed = JSON.parse(r.observation_payload_json) } catch { /* ignore */ }
    return {
      question_id: r.question_id,
      observation_code: parsed.observation_code ?? '',
      observed: parsed.observed ?? false,
      behavior_codes: parsed.behavior_codes ?? []
    }
  })

  // 8. 安全事件摘要
  const safetyRows = db
    .prepare(
      `SELECT si.incident_id, si.reason_code, si.occurred_at
         FROM safety_incident si
         JOIN assessment_session s
           ON s.student_id = si.student_id
          AND s.job_code = si.job_code
          AND s.task_code = si.task_code
        WHERE s.session_id = ? AND si.status NOT IN ('VOIDED')`
    )
    .all(sessionId) as { incident_id: string; reason_code: string; occurred_at: string }[]

  const safetySummary: SafetySummary = {
    safety_incidents: safetyRows.map((r): SafetyIncidentRef => ({
      incident_id: r.incident_id, reason_code: r.reason_code, occurred_at: r.occurred_at
    })),
    safety_overridden: false
  }

  // 9. 训练推荐（得分率 < focusThreshold 的模块）
  const recommendedTrainingFocus: TrainingFocusItem[] = []
  for (const mod of JOB_MODULE_CODES) {
    const profile = moduleProfiles[mod]
    if (profile.score_rate < focusThreshold) {
      recommendedTrainingFocus.push({
        job_module_code: mod as JobModuleCodeLocal,
        reason: `模块 ${mod} 得分率 ${(profile.score_rate * 100).toFixed(0)}%，低于推荐阈值 ${(focusThreshold * 100).toFixed(0)}%`,
        linked_task_code: mod === 'M2' ? 'SHELVE_TASK' : null,
        recommendation_text: mod === 'M2' ? '建议完成"拆箱与上架"基础训练' : `建议加强 ${mod} 模块相关技能练习`
      })
    }
  }

  // 10. 等级判定（纯阈值，不使用模块兜底/情绪兜底——JOB_SKILL 专用逻辑）
  let levelResult: string
  if (safetyRows.length > 0) {
    levelResult = 'LEVEL_FAIL_BY_SAFETY'
  } else if (normalizedScore >= strategy.competent_threshold) {
    levelResult = 'LEVEL_COMPETENT'
  } else if (normalizedScore >= strategy.conditional_threshold) {
    levelResult = 'LEVEL_CONDITIONAL'
  } else {
    levelResult = 'LEVEL_NOT_COMPETENT'
  }

  // 11. 构建 JobSkillResultPayload
  const resultPayload: JobSkillResultPayload = {
    result_schema_version: 'job-skill-result-v1.0',
    overall: {
      raw_score: rawScore,
      max_score: 48,
      normalized_score: normalizedScore,
      completion_ratio: actualCompletionRatio
    },
    score_tracks: {
      online_knowledge: {
        raw_score: totalOnlineRaw,
        max_score: 36,
        normalized_score: totalOnlineMax > 0 ? (totalOnlineRaw / totalOnlineMax) * 100 : 0
      },
      offline_performance: {
        raw_score: totalOfflineRaw,
        max_score: 12,
        normalized_score: totalOfflineMax > 0 ? (totalOfflineRaw / totalOfflineMax) * 100 : 0
      }
    },
    job_module_profiles: moduleProfiles as Record<JobModuleCodeLocal, JobModuleProfile>,
    observation_completion_ratio: obsRatio,
    support_summary: {
      prompt_level_distribution: {},
      accommodations_used: [],
      instruction_replay_count: 0
    },
    teacher_observations: teacherObservations,
    safety_summary: safetySummary,
    validity_limitations: [],
    recommended_training_focus: recommendedTrainingFocus
  }

  // 12. RESULT_CALCULATED + SESSION_COMPLETED
  const resultId = uuidv4()
  const calculatedAt = new Date().toISOString()

  const resultEventPayload: ResultCalculatedPayload = {
    result_id: resultId,
    result_type: 'JOB_SKILL_SCORE',
    source_type: 'ASSESSMENT_SESSION',
    source_id: sessionId,
    student_id: session.student_id,
    strategy_id: session.strategy_id,
    strategy_type: 'JOB_SKILL_ASSESSMENT',
    job_code: session.job_code,
    task_code: session.task_code,
    module_type: null,
    raw_score: rawScore,
    max_score: maxScore,
    normalized_score: normalizedScore,
    level_result: levelResult,
    calculated_at: calculatedAt,
    calculated_by: callerUserId,
    completion_ratio: actualCompletionRatio,
    breakdown: resultPayload
  }
  const resultEvent = writeEvent({
    aggregateType: 'ASSESSMENT_SESSION',
    aggregateId: sessionId,
    eventType: 'RESULT_CALCULATED',
    payload: resultEventPayload as unknown as Record<string, unknown>,
    actorId: callerUserId,
    actorRole: 'TEACHER'
  })
  applyAssessmentEvent(db, resultEvent)

  const completedPayload: SessionCompletedPayload = {
    session_id: sessionId,
    completed_at: calculatedAt,
    total_online_answered: answeredOnline.n,
    total_offline_scored: offlineCounts.done,
    has_pending_offline: false
  }
  const completedEvent = writeEvent({
    aggregateType: 'ASSESSMENT_SESSION',
    aggregateId: sessionId,
    eventType: 'SESSION_COMPLETED',
    payload: completedPayload as unknown as Record<string, unknown>,
    actorId: callerUserId,
    actorRole: 'TEACHER'
  })
  applyAssessmentEvent(db, completedEvent)

  return true
}

export function maybeGenerateJobSkillReportAfterResult(
  db: DBAdapter,
  sessionId: string,
  callerUserId: string,
  automation?: JobSkillReportAutomation
): void {
  try {
    maybeGenerateJobSkillReport(db, sessionId, callerUserId, automation)
  } catch (reportErr) {
    console.error('[maybeGenerateJobSkillResult] report generation error:', reportErr)
  }
}

/**
 * 独立重试 wrapper：用于恢复旧 READY_TO_FINALIZE 卡点，或外部显式重试。
 * 评分/观察 handler 的正常路径应在自身事务内调用 finalizeJobSkillResultCore。
 */
export function maybeGenerateJobSkillResult(
  db: DBAdapter,
  sessionId: string,
  callerUserId: string,
  automation?: JobSkillReportAutomation
): void {
  let generated = false
  const txn = db.transaction(() => {
    generated = finalizeJobSkillResultCore(db, sessionId, callerUserId)
  })
  txn()
  if (generated) {
    maybeGenerateJobSkillReportAfterResult(db, sessionId, callerUserId, automation)
  }
}
