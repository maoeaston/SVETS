// JOB_SKILL 专业岗位报告 application service。
//
// F7 Step 5 起，报告内容和 task_report 投影由统一 builder/service/reducer 链负责。
// 该文件保留旧同步入口，供 maybeGenerateJobSkillResultAfterResult 调用；不再自行拼接宽松 JSON
// 或直接 INSERT task_report。

import type { DBAdapter } from '../../db/interface'
import type { ReportCommandCoordinator } from '../../domain/report-command-coordinator'
import { ReportService } from '../../domain/report-service'
import type { AcceptedCommandContext } from '../command/command-types'

const JOB_SKILL_AUTOMATION_PARENTS = new Set([
  'assessment:submitJobSkillOfflineScores',
  'assessment:recordTeacherObservation'
])

function assertAcceptedParent(context: AcceptedCommandContext): void {
  if (!JOB_SKILL_AUTOMATION_PARENTS.has(context.envelope.commandType)) {
    throw new Error(`job-skill report automation rejected parent ${context.envelope.commandType}`)
  }
  if (!context.envelope.correlationId.trim()) {
    throw new Error('job-skill report automation correlation is required')
  }
}

export interface JobSkillReportAutomation {
  readonly coordinator: ReportCommandCoordinator
  generateJobSkillReportFromResult(
    resultId: string,
    callerUserId: string,
    context: AcceptedCommandContext
  ): void
}

export function createJobSkillReportAutomation(
  db: DBAdapter,
  coordinator: ReportCommandCoordinator
): JobSkillReportAutomation {
  const service = new ReportService(db, coordinator)
  return {
    coordinator,
    generateJobSkillReportFromResult(
      resultId: string,
      callerUserId: string,
      context: AcceptedCommandContext
    ): void {
      assertAcceptedParent(context)
      service.generateJobSkillReportFromResultSync(
        resultId,
        callerUserId,
        'SYSTEM',
        context.envelope.correlationId
      )
    }
  }
}

/**
 * 在 JOB_SKILL session 完成且 JOB_SKILL_SCORE 当前结果存在时，生成合同有效的 task_report。
 *
 * 幂等：相同 generation_key 且现有内容通过当前 validator 时返回旧报告，不增加事件。
 * 兼容：非 JOB_SKILL、非 COMPLETED、无 result 均保持旧行为——静默 no-op。
 */
export function maybeGenerateJobSkillReport(
  db: DBAdapter,
  sessionId: string,
  callerUserId: string,
  automation: JobSkillReportAutomation,
  context: AcceptedCommandContext
): void {
  assertAcceptedParent(context)
  const session = db
    .prepare(
      `SELECT session_id, status, strategy_type
         FROM assessment_session
        WHERE session_id = ?`
    )
    .get(sessionId) as { session_id: string; status: string; strategy_type: string } | undefined

  if (!session) return
  if (session.strategy_type !== 'JOB_SKILL_ASSESSMENT') return
  if (session.status !== 'COMPLETED') return

  const result = db
    .prepare(
      `SELECT result_id
         FROM result_record
        WHERE source_aggregate_type = 'ASSESSMENT_SESSION'
          AND source_aggregate_id = ?
          AND result_type = 'JOB_SKILL_SCORE'
          AND is_current = 1
        ORDER BY generated_at DESC, result_id DESC
        LIMIT 1`
    )
    .get(sessionId) as { result_id: string } | undefined

  if (!result) return

  automation.generateJobSkillReportFromResult(result.result_id, callerUserId, context)
}
