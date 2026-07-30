import type { DBAdapter } from '../../db/interface'
import { getDatabase } from '../../db/connection'
import { SqliteAdapter } from '../../db/sqlite-adapter'
import type { ReportMutationPort } from '../../domain/report-command-coordinator'
import type { AcceptedCommandContext } from '../../application/command/command-types'
import {
  submitJobSkillOfflineScores,
  type JobSkillScoringMutationExecution
} from '../../application/services/job-skill-scoring-service'
import type { JobSkillReportAutomation } from '../../application/services/job-skill-report-service'
import {
  getJobSkillOfflineScores,
  getSessionScoringQuestions
} from '../../application/query/job-skill-scoring-query-service'
import { resolveTrustedAuthSessionCaller } from '../../utils/auth-session'
import type {
  GetJobSkillOfflineScoresParams,
  GetSessionScoringQuestionsParams,
  SubmitJobSkillOfflineScoresParams
} from '../../../shared/types/job-skill-scoring'
import type { LegacyIpcHandlerRegistrar } from '../legacy-handler-collector'

export { submitJobSkillOfflineScores } from '../../application/services/job-skill-scoring-service'
export {
  getJobSkillOfflineScores,
  getSessionScoringQuestions
} from '../../application/query/job-skill-scoring-query-service'

export interface JobSkillScoringHandlerRegistrationOptions {
  readonly eventPort: Pick<ReportMutationPort, 'writeEvent'>
  readonly automation: JobSkillReportAutomation
  readonly getDb?: () => DBAdapter
}

function defaultGetDb(): DBAdapter {
  return new SqliteAdapter(getDatabase())
}

function mutationExecution(
  options: JobSkillScoringHandlerRegistrationOptions,
  context: AcceptedCommandContext | undefined
): JobSkillScoringMutationExecution {
  if (!context) throw new Error('job-skill scoring mutation requires accepted command context')
  return { eventPort: options.eventPort, automation: options.automation, context }
}

export function registerJobSkillScoringHandlers(
  registrar: LegacyIpcHandlerRegistrar,
  options: JobSkillScoringHandlerRegistrationOptions
): void {
  const getDb = options.getDb ?? defaultGetDb

  registrar.handle('assessment:submitJobSkillOfflineScores', (
    event,
    params: SubmitJobSkillOfflineScoresParams,
    context?: AcceptedCommandContext
  ) => {
    const db = getDb()
    const trusted = resolveTrustedAuthSessionCaller(db, event.sender.id, params)
    if (!trusted.ok) return { success: false as const, errorCode: 'FORBIDDEN' as const }
    return submitJobSkillOfflineScores(db, trusted.params, mutationExecution(options, context))
  })

  registrar.handle('assessment:getJobSkillOfflineScores', (
    event,
    params: GetJobSkillOfflineScoresParams
  ) => {
    const db = getDb()
    const trusted = resolveTrustedAuthSessionCaller(db, event.sender.id, params)
    if (!trusted.ok) return { success: false as const, errorCode: 'FORBIDDEN' as const }
    return getJobSkillOfflineScores(db, trusted.params)
  })

  registrar.handle('assessment:getSessionScoringQuestions', (
    event,
    params: GetSessionScoringQuestionsParams
  ) => {
    const db = getDb()
    const trusted = resolveTrustedAuthSessionCaller(db, event.sender.id, params)
    if (!trusted.ok) return { success: false as const, errorCode: 'FORBIDDEN' as const }
    return getSessionScoringQuestions(db, trusted.params)
  })
}
