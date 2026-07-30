import type { DBAdapter } from '../../db/interface'
import { getDatabase } from '../../db/connection'
import { SqliteAdapter } from '../../db/sqlite-adapter'
import type { ReportMutationPort } from '../../domain/report-command-coordinator'
import type { AcceptedCommandContext } from '../../application/command/command-types'
import {
  recordTeacherObservation,
  type ObservationMutationExecution
} from '../../application/services/observation-service'
import type { JobSkillReportAutomation } from '../../application/services/job-skill-report-service'
import { getTeacherObservations } from '../../application/query/observation-query-service'
import { resolveTrustedAuthSessionCaller } from '../../utils/auth-session'
import type {
  GetTeacherObservationsParams,
  RecordTeacherObservationParams
} from '@shared/types/teacher-observation'
import type { LegacyIpcHandlerRegistrar } from '../legacy-handler-collector'

export { recordTeacherObservation } from '../../application/services/observation-service'
export { getTeacherObservations } from '../../application/query/observation-query-service'

export interface ObservationHandlerRegistrationOptions {
  readonly eventPort: Pick<ReportMutationPort, 'writeEvent'>
  readonly automation: JobSkillReportAutomation
  readonly getDb?: () => DBAdapter
}

function defaultGetDb(): DBAdapter {
  return new SqliteAdapter(getDatabase())
}

function mutationExecution(
  options: ObservationHandlerRegistrationOptions,
  context: AcceptedCommandContext | undefined
): ObservationMutationExecution {
  if (!context) throw new Error('observation mutation requires accepted command context')
  return { eventPort: options.eventPort, automation: options.automation, context }
}

export function registerObservationHandlers(
  registrar: LegacyIpcHandlerRegistrar,
  options: ObservationHandlerRegistrationOptions
): void {
  const getDb = options.getDb ?? defaultGetDb

  registrar.handle('assessment:recordTeacherObservation', (
    event,
    params: RecordTeacherObservationParams,
    context?: AcceptedCommandContext
  ) => {
    const db = getDb()
    const trusted = resolveTrustedAuthSessionCaller(db, event.sender.id, params)
    if (!trusted.ok) return { success: false as const, errorCode: 'FORBIDDEN' as const }
    return recordTeacherObservation(db, trusted.params, mutationExecution(options, context))
  })

  registrar.handle('assessment:getTeacherObservations', (
    event,
    params: GetTeacherObservationsParams
  ) => {
    const db = getDb()
    const trusted = resolveTrustedAuthSessionCaller(db, event.sender.id, params)
    if (!trusted.ok) return { success: false as const, errorCode: 'FORBIDDEN' as const }
    return getTeacherObservations(db, trusted.params)
  })
}
