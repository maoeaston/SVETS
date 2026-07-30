import type { DBAdapter } from '../../db/interface'
import { getDatabase } from '../../db/connection'
import { SqliteAdapter } from '../../db/sqlite-adapter'
import type { ReportMutationPort } from '../../domain/report-command-coordinator'
import type { AcceptedCommandContext } from '../../application/command/command-types'
import {
  submitOperationScores,
  type OperationScoringMutationExecution
} from '../../application/services/operation-scoring-service'
import { getOperationScores } from '../../application/query/operation-scoring-query-service'
import { resolveTrustedAuthSessionCaller } from '../../utils/auth-session'
import type {
  GetOperationScoresParams,
  SubmitOperationScoresParams
} from '../../../shared/types/operation-scoring'
import type { LegacyIpcHandlerRegistrar } from '../legacy-handler-collector'

export { submitOperationScores } from '../../application/services/operation-scoring-service'
export { getOperationScores } from '../../application/query/operation-scoring-query-service'

export interface OperationScoringHandlerRegistrationOptions {
  readonly eventPort: Pick<ReportMutationPort, 'writeEvent'>
  readonly getDb?: () => DBAdapter
}

function defaultGetDb(): DBAdapter {
  return new SqliteAdapter(getDatabase())
}

function mutationExecution(
  eventPort: Pick<ReportMutationPort, 'writeEvent'>,
  context: AcceptedCommandContext | undefined
): OperationScoringMutationExecution {
  if (!context) throw new Error('operation scoring mutation requires accepted command context')
  return { eventPort, context }
}

export function registerOperationScoringHandlers(
  registrar: LegacyIpcHandlerRegistrar,
  options: OperationScoringHandlerRegistrationOptions
): void {
  const getDb = options.getDb ?? defaultGetDb

  registrar.handle('assessment:submitOperationScores', (
    event,
    params: SubmitOperationScoresParams,
    context?: AcceptedCommandContext
  ) => {
    const db = getDb()
    const trusted = resolveTrustedAuthSessionCaller(db, event.sender.id, params)
    if (!trusted.ok) return { success: false as const, errorCode: 'FORBIDDEN' as const }
    return submitOperationScores(
      db,
      trusted.params,
      mutationExecution(options.eventPort, context)
    )
  })

  registrar.handle('assessment:getOperationScores', (
    event,
    params: GetOperationScoresParams
  ) => {
    const db = getDb()
    const trusted = resolveTrustedAuthSessionCaller(db, event.sender.id, params)
    if (!trusted.ok) return { success: false as const, errorCode: 'FORBIDDEN' as const }
    return getOperationScores(db, trusted.params)
  })
}
