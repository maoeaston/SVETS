// JOB_SKILL 专业岗位报告兼容 wrapper。
//
// F7 Step 5 起，报告内容和 task_report 投影由统一 builder/service/reducer 链负责。
// 该文件保留旧同步入口，供 maybeGenerateJobSkillResultAfterResult 调用；不再自行拼接宽松 JSON
// 或直接 INSERT task_report。

import type { DBAdapter } from '../../db/interface'
import { getActionLogPath } from '../../domain/action-log-path'
import { ReportCommandCoordinator } from '../../domain/report-command-coordinator'
import { buildJobSkillReport } from '../../domain/report-builders'
import { ReportService, writeBuiltReportSynchronously } from '../../domain/report-service'

export interface JobSkillReportAutomation {
  generateJobSkillReportFromResult(resultId: string, callerUserId: string): void
}

export function createJobSkillReportAutomation(db: DBAdapter): JobSkillReportAutomation {
  const service = new ReportService(db, new ReportCommandCoordinator({ db, actionLogPath: getActionLogPath() }))
  return {
    generateJobSkillReportFromResult(resultId: string, callerUserId: string): void {
      service.generateJobSkillReportFromResultSync(resultId, callerUserId, 'SYSTEM')
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
  automation?: JobSkillReportAutomation
): void {
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

  if (automation) {
    automation.generateJobSkillReportFromResult(result.result_id, callerUserId)
    return
  }

  const generatedAt = new Date().toISOString()
  const built = buildJobSkillReport(db, result.result_id, generatedAt)
  writeBuiltReportSynchronously(db, built, callerUserId, 'TEACHER')
}
