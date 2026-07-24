// T10: JOB_SKILL 专业岗位报告自动生成。
// 在 maybeGenerateJobSkillResult 成功后（session=COMPLETED）自动调用。
// 从 result_record 读取 JobSkillResultPayload，构建 ReportContentJobSkill，
// 写入 REPORT_GENERATED 事件 + task_report 行（幂等）。
//
// 纯函数：调用方负责 try-catch，避免影响已写入的 result_record / SESSION_COMPLETED。

import { v4 as uuidv4 } from 'uuid'
import type { DBAdapter } from '../../db/interface'
import { writeEvent } from '../../domain/event-writer'
import type { ReportGeneratedPayload } from '@shared/types/event-payloads'
import type {
  JobSkillResultPayload,
  ReportContentJobSkill,
  JobSkillAssessmentMeta,
  JobSkillOverallSummary,
  JobModuleReportProfile,
  TeacherObservationReport,
  RecommendedTask,
  TeacherObservationPayload
} from '@shared/types/json-schemas'

const JOB_MODULE_CODES = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'] as const
type JMC = (typeof JOB_MODULE_CODES)[number]

const MODULE_NAMES: Record<JMC, string> = {
  M1: '货架整理与价签核对',
  M2: '拆箱补货与先进先出',
  M3: '临期破损商品分拣',
  M4: '库房收纳与简易盘点',
  M5: '突发情况应对',
  M6: '商品识别与分类'
}

/**
 * 在 JOB_SKILL session 完成（COMPLETED）且结果已存在时，生成 task_report。
 *
 * 幂等：同一 source_aggregate_id 的 FULL_REPORT 已存在则直接返回。
 * 不走 assessment-reducer（TASK_REPORT aggregate 与 ASSESSMENT_SESSION 无关联）。
 */
export function maybeGenerateJobSkillReport(
  db: DBAdapter,
  sessionId: string,
  callerUserId: string
): void {
  // 1. 读 session：JOB_SKILL_ASSESSMENT + COMPLETED 才继续
  const session = db
    .prepare(
      `SELECT session_id, status, strategy_type, student_id, job_code, task_code,
              strategy_id, strategy_version
         FROM assessment_session WHERE session_id = ?`
    )
    .get(sessionId) as
    | {
        session_id: string; status: string; strategy_type: string
        student_id: string; job_code: string; task_code: string
        strategy_id: string; strategy_version: number
      }
    | undefined

  if (!session) return
  if (session.strategy_type !== 'JOB_SKILL_ASSESSMENT') return
  if (session.status !== 'COMPLETED') return

  // 2. 幂等：task_report 已存在
  const existing = db
    .prepare(
      `SELECT 1 FROM task_report
        WHERE source_aggregate_type = 'ASSESSMENT_SESSION'
          AND source_aggregate_id = ?
          AND report_type = 'FULL_REPORT'
        LIMIT 1`
    )
    .get(sessionId)
  if (existing) return

  // 3. 读 result_record (JOB_SKILL_SCORE, is_current=1)
  const result = db
    .prepare(
      `SELECT result_id, result_payload_json, level_result, normalized_score, raw_score,
              completion_ratio
         FROM result_record
        WHERE source_aggregate_type = 'ASSESSMENT_SESSION'
          AND source_aggregate_id = ?
          AND result_type = 'JOB_SKILL_SCORE'
          AND is_current = 1`
    )
    .get(sessionId) as
    | {
        result_id: string; result_payload_json: string; level_result: string
        normalized_score: number; raw_score: number; completion_ratio: number | null
      }
    | undefined

  if (!result) return // 结果尚未生成（正常不会走到这里）

  const resultPayload = JSON.parse(result.result_payload_json) as JobSkillResultPayload

  // 4–9: 构建 report_content_json（见下方各步骤）
  const reportId = uuidv4()
  const generatedAt = new Date().toISOString()
  const reportContent = buildReportContent(db, sessionId, session, result, resultPayload)

  // 10. 事务：writeEvent(REPORT_GENERATED) + INSERT task_report
  const txn = db.transaction(() => {
    const reportEventPayload: ReportGeneratedPayload = {
      report_id: reportId,
      student_id: session.student_id,
      job_code: session.job_code,
      task_code: session.task_code,
      report_type: 'FULL_REPORT',
      source_aggregate_type: 'ASSESSMENT_SESSION',
      source_aggregate_id: sessionId,
      result_ids: [result.result_id],
      report_title: `${session.job_code}专业岗位测评报告`,
      report_content: reportContent as unknown as Record<string, unknown>,
      generated_at: generatedAt,
      generated_by: callerUserId
    }
    const reportEvent = writeEvent({
      aggregateType: 'TASK_REPORT',
      aggregateId: reportId,
      eventType: 'REPORT_GENERATED',
      payload: reportEventPayload as unknown as Record<string, unknown>,
      actorId: callerUserId,
      actorRole: 'TEACHER'
    })
    db.prepare(
      `INSERT INTO task_report
         (report_id, report_type, student_id, source_aggregate_type, source_aggregate_id,
          source_result_ids_json, report_title, report_content_json,
          generated_event_id, generated_by, generated_at, status)
       VALUES (?, 'FULL_REPORT', ?, 'ASSESSMENT_SESSION', ?, ?, ?, ?, ?, ?, ?, 'GENERATED')`
    ).run(
      reportId, session.student_id, sessionId,
      JSON.stringify([result.result_id]),
      reportEventPayload.report_title,
      JSON.stringify(reportContent),
      reportEvent.event_id, callerUserId, generatedAt
    )
  })
  txn()
}

// ──────────────────────────────────────────────────────────────────────────────
// buildReportContent — 从 result_payload + DB 补查构建完整报告 JSON
// ──────────────────────────────────────────────────────────────────────────────

type SessionForReport = {
  strategy_id: string; strategy_version: number; job_code: string
  student_id: string; task_code: string
}

type ResultForReport = {
  result_id: string; level_result: string; normalized_score: number
  raw_score: number; completion_ratio: number | null
}

function buildReportContent(
  db: DBAdapter,
  sessionId: string,
  session: SessionForReport,
  result: ResultForReport,
  resultPayload: JobSkillResultPayload
): ReportContentJobSkill {
  // 4. assessment_meta
  const assessmentMeta: JobSkillAssessmentMeta = {
    session_id: sessionId,
    strategy_id: session.strategy_id,
    strategy_version: session.strategy_version,
    scoring_engine_version: '1.0.0',
    content_schema_version: 'v0.1.12',
    scoring_schema_version: 'job-skill-result-v1.0',
    report_schema_version: 'job-skill-report-v1.0',
    job_code: session.job_code,
    sitting_count: 2,
    completion_ratio: resultPayload.overall.completion_ratio,
    observation_completion_ratio: resultPayload.observation_completion_ratio
  }

  // 5. overall_summary
  const safetyOverridden = resultPayload.safety_summary.safety_incidents.length > 0
  const overallSummary: JobSkillOverallSummary = {
    raw_score: resultPayload.overall.raw_score,
    max_score: 48,
    normalized_score: resultPayload.overall.normalized_score,
    level_result: result.level_result,
    safety_overridden: safetyOverridden,
    emotion_collapse_triggered: false
  }

  // 6. job_module_profiles（将 JobModuleProfile.online_raw 映射为 JobModuleReportProfile.online_raw_score）
  const jobModuleProfiles: JobModuleReportProfile[] = JOB_MODULE_CODES.map((mod) => {
    const p = resultPayload.job_module_profiles[mod as JMC]
    return {
      job_module_code: mod as JMC,
      module_name: MODULE_NAMES[mod as JMC],
      online_raw_score: p?.online_raw ?? 0,
      online_max_score: p?.online_max ?? 6,
      offline_raw_score: p?.offline_raw ?? 0,
      offline_max_score: p?.offline_max ?? 2,
      score_rate: p?.score_rate ?? 0,
      response_status_distribution: {},
      key_observations: []
    }
  })

  // 7. teacher_observations（增强版：含 prompt_level / observation_note）
  const obsRows = db
    .prepare(
      `SELECT question_id, observation_payload_json
         FROM offline_score_record
        WHERE session_id = ? AND score_scope = 'TEACHER_OBSERVATION' AND status = 'VALID'`
    )
    .all(sessionId) as { question_id: string; observation_payload_json: string }[]

  const teacherObservations: TeacherObservationReport[] = obsRows.map((r) => {
    let parsed: Partial<TeacherObservationPayload> = {}
    try { parsed = JSON.parse(r.observation_payload_json) } catch { /* ignore */ }
    return {
      question_id: r.question_id,
      observation_code: parsed.observation_code ?? '',
      observed: parsed.observed ?? false,
      behavior_codes: parsed.behavior_codes ?? [],
      prompt_level: parsed.prompt_level ?? null,
      observation_note: parsed.observation_note ?? null
    }
  })

  // 8. recommended_training_tasks（从 result_payload 的 recommended_training_focus 派生）
  const recommendedTrainingTasks: RecommendedTask[] =
    resultPayload.recommended_training_focus.map((item) => ({
      job_module_code: item.job_module_code,
      task_code: item.linked_task_code,
      recommendation_text: item.recommendation_text,
      has_existing_training: item.linked_task_code !== null
    }))

  // 9. 合并最终结构
  return {
    report_schema_version: 'job-skill-report-v1.0',
    report_scope: 'JOB_SKILL',
    assessment_meta: assessmentMeta,
    overall_summary: overallSummary,
    job_module_profiles: jobModuleProfiles,
    support_summary: {
      prompt_level_distribution: resultPayload.support_summary.prompt_level_distribution,
      accommodations_used: resultPayload.support_summary.accommodations_used,
      instruction_replay_count: resultPayload.support_summary.instruction_replay_count
    },
    teacher_observations: teacherObservations,
    safety_summary: resultPayload.safety_summary,
    validity_limitations: resultPayload.validity_limitations,
    recommended_training_focus: resultPayload.recommended_training_focus,
    recommended_training_tasks: recommendedTrainingTasks,
    placement_advice: { enabled: false, reason_disabled: 'MVP_DEMO_PROFILE_ONLY' }
  }
}
