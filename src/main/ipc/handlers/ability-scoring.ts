import type { DBAdapter } from '../../db/interface'
import { getDatabase } from '../../db/connection'
import { SqliteAdapter } from '../../db/sqlite-adapter'
import type { ReportMutationPort } from '../../domain/report-command-coordinator'
import type { AcceptedCommandContext } from '../../application/command/command-types'
import {
  submitOfflineAbilityScores,
  type AbilityScoringMutationExecution
} from '../../application/services/ability-scoring-service'
import { getOfflineAbilityScores } from '../../application/query/ability-scoring-query-service'
import { resolveTrustedAuthSessionCaller } from '../../utils/auth-session'
import type {
  GetOfflineAbilityScoresParams,
  SubmitOfflineAbilityScoresParams
} from '../../../shared/types/ability-scoring'
import type { LegacyIpcHandlerRegistrar } from '../legacy-handler-collector'

export { submitOfflineAbilityScores } from '../../application/services/ability-scoring-service'
export { getOfflineAbilityScores } from '../../application/query/ability-scoring-query-service'

export interface AbilityScoringHandlerRegistrationOptions {
  readonly eventPort: Pick<ReportMutationPort, 'writeEvent'>
  readonly getDb?: () => DBAdapter
}

function defaultGetDb(): DBAdapter {
  return new SqliteAdapter(getDatabase())
}

function mutationExecution(
  eventPort: Pick<ReportMutationPort, 'writeEvent'>,
  context: AcceptedCommandContext | undefined
): AbilityScoringMutationExecution {
  if (!context) throw new Error('ability scoring mutation requires accepted command context')
  return { eventPort, context }
}

export function registerAbilityScoringHandlers(
  registrar: LegacyIpcHandlerRegistrar,
  options: AbilityScoringHandlerRegistrationOptions
): void {
  const getDb = options.getDb ?? defaultGetDb

  registrar.handle('assessment:submitOfflineAbilityScores', (
    event,
    params: SubmitOfflineAbilityScoresParams,
    context?: AcceptedCommandContext
  ) => {
    const db = getDb()
    const trusted = resolveTrustedAuthSessionCaller(db, event.sender.id, params)
    if (!trusted.ok) return { success: false as const, errorCode: 'FORBIDDEN' as const }
    return submitOfflineAbilityScores(
      db,
      trusted.params,
      mutationExecution(options.eventPort, context)
    )
  })

  registrar.handle('assessment:getOfflineAbilityScores', (
    event,
    params: GetOfflineAbilityScoresParams
  ) => {
    const db = getDb()
    const trusted = resolveTrustedAuthSessionCaller(db, event.sender.id, params)
    if (!trusted.ok) return { success: false as const, errorCode: 'FORBIDDEN' as const }
    return getOfflineAbilityScores(db, trusted.params)
  })
}
