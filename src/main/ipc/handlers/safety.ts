import type { DBAdapter } from '../../db/interface'
import { getDatabase } from '../../db/connection'
import { SqliteAdapter } from '../../db/sqlite-adapter'
import type { ReportMutationPort } from '../../domain/report-command-coordinator'
import type { ApplicationRuntime } from '../../application/runtime/application-runtime'
import type { AcceptedCommandContext } from '../../application/command/command-types'
import {
  confirmSafetyIncident,
  createSafetyReportAutomation,
  replaceSafetyIncidentForFactualCorrection,
  resolveSafetyIncident,
  voidSafetyIncident,
  type SafetyMutationExecution
} from '../../application/services/safety-service'
import {
  getSafetyIncident,
  listSafetyIncidents
} from '../../application/query/safety-query-service'
import { resolveTrustedAuthSessionCaller } from '../../utils/auth-session'
import type {
  ConfirmSafetyIncidentParams,
  GetSafetyIncidentParams,
  ListSafetyIncidentsParams,
  ReplaceSafetyIncidentParams,
  ResolveSafetyIncidentParams,
  SafetyIncidentMutationResult,
  VoidSafetyIncidentParams
} from '../../../shared/types/safety-incident'
import type { LegacyIpcHandlerRegistrar } from '../legacy-handler-collector'

export {
  confirmSafetyIncident,
  createSafetyReportAutomation,
  replaceSafetyIncidentForFactualCorrection,
  resolveSafetyIncident,
  voidSafetyIncident
} from '../../application/services/safety-service'
export type {
  SafetyMutationExecution,
  SafetyReportAutomation
} from '../../application/services/safety-service'
export {
  getSafetyIncident,
  listSafetyIncidents
} from '../../application/query/safety-query-service'

export interface SafetyHandlerRegistrationOptions {
  readonly coordinator: ApplicationRuntime['reportCoordinator']
  readonly eventPort: Pick<ReportMutationPort, 'writeEvent'>
  readonly getDb?: () => DBAdapter
}

function defaultGetDb(): DBAdapter {
  return new SqliteAdapter(getDatabase())
}

function mutationExecution(
  eventPort: Pick<ReportMutationPort, 'writeEvent'>,
  context: AcceptedCommandContext | undefined,
  automation: SafetyMutationExecution['automation']
): SafetyMutationExecution {
  if (!context) throw new Error('safety mutation requires accepted command context')
  return { eventPort, context, automation }
}

export function registerSafetyHandlers(
  registrar: LegacyIpcHandlerRegistrar,
  options: SafetyHandlerRegistrationOptions
): void {
  const getDb = options.getDb ?? defaultGetDb
  const automation = createSafetyReportAutomation(getDb(), options.coordinator)

  function withTrusted<T extends { callerUserId: string; callerRole: string }, R>(
    event: Electron.IpcMainInvokeEvent,
    params: T,
    run: (db: DBAdapter, trusted: T) => R
  ): R | SafetyIncidentMutationResult {
    const db = getDb()
    const trusted = resolveTrustedAuthSessionCaller(db, event.sender.id, params)
    if (!trusted.ok) return { success: false, errorCode: 'FORBIDDEN' }
    return run(db, trusted.params)
  }

  registrar.handle('safety:confirm', (
    event,
    params: ConfirmSafetyIncidentParams,
    context?: AcceptedCommandContext
  ) => withTrusted(event, params, (db, trusted) => confirmSafetyIncident(
    db,
    trusted,
    mutationExecution(options.eventPort, context, automation)
  )))

  registrar.handle('safety:resolve', (
    event,
    params: ResolveSafetyIncidentParams,
    context?: AcceptedCommandContext
  ) => withTrusted(event, params, (db, trusted) => resolveSafetyIncident(
    db,
    trusted,
    mutationExecution(options.eventPort, context, automation)
  )))

  registrar.handle('safety:void', (
    event,
    params: VoidSafetyIncidentParams,
    context?: AcceptedCommandContext
  ) => withTrusted(event, params, (db, trusted) => voidSafetyIncident(
    db,
    trusted,
    mutationExecution(options.eventPort, context, automation)
  )))

  registrar.handle('safety:replaceForFactualCorrection', (
    event,
    params: ReplaceSafetyIncidentParams,
    context?: AcceptedCommandContext
  ) => withTrusted(event, params, (db, trusted) => replaceSafetyIncidentForFactualCorrection(
    db,
    trusted,
    mutationExecution(options.eventPort, context, automation)
  )))

  registrar.handle('safety:list', (event, params: ListSafetyIncidentsParams) =>
    withTrusted(event, params, listSafetyIncidents))
  registrar.handle('safety:get', (event, params: GetSafetyIncidentParams) =>
    withTrusted(event, params, getSafetyIncident))
}
