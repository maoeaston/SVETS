import type { DBAdapter } from '../../db/interface'
import { getDatabase } from '../../db/connection'
import { SqliteAdapter } from '../../db/sqlite-adapter'
import type { ReportMutationPort } from '../../domain/report-command-coordinator'
import type { AcceptedCommandContext } from '../../application/command/command-types'
import {
  abortSession,
  calculateResult,
  createSession,
  emotionInterrupt,
  emotionResume,
  pauseSitting,
  recordEmotionCollapse,
  startNextSitting,
  startSession,
  submitAnswer,
  triggerRedline,
  type AssessmentMutationExecution
} from '../../application/services/assessment-service'
import {
  getSession,
  listMySessions,
  listSessions
} from '../../application/query/assessment-query-service'
import { resolveTrustedAuthSessionCaller } from '../../utils/auth-session'
import type {
  AbortSessionParams,
  CalculateResultParams,
  CreateSessionParams,
  EmotionInterruptParams,
  EmotionResumeParams,
  GetSessionParams,
  ListMySessionsParams,
  ListSessionsParams,
  PauseSittingParams,
  RecordEmotionCollapseParams,
  StartNextSittingParams,
  StartSessionParams,
  SubmitAnswerParams,
  TriggerRedlineParams
} from '../../../shared/types/assessment'
import type { LegacyIpcHandlerRegistrar } from '../legacy-handler-collector'

export {
  abortSession,
  applyAssessmentEvent,
  calculateResult,
  createSession,
  emotionInterrupt,
  emotionResume,
  pauseSitting,
  recordEmotionCollapse,
  seedAssessmentErrorCodes,
  startNextSitting,
  startSession,
  submitAnswer,
  triggerRedline
} from '../../application/services/assessment-service'
export {
  getSession,
  listMySessions,
  listSessions
} from '../../application/query/assessment-query-service'

export interface AssessmentHandlerRegistrationOptions {
  readonly eventPort: Pick<ReportMutationPort, 'writeEvent'>
  readonly getDb?: () => DBAdapter
}

function defaultGetDb(): DBAdapter {
  return new SqliteAdapter(getDatabase())
}

function mutationExecution(
  eventPort: Pick<ReportMutationPort, 'writeEvent'>,
  context: AcceptedCommandContext | undefined
): AssessmentMutationExecution {
  if (!context) throw new Error('assessment mutation requires accepted command context')
  return { eventPort, context }
}

export function registerAssessmentHandlers(
  registrar: LegacyIpcHandlerRegistrar,
  options: AssessmentHandlerRegistrationOptions
): void {
  const getDb = options.getDb ?? defaultGetDb

  registrar.handle('assessment:createSession', (
    event,
    params: CreateSessionParams,
    context?: AcceptedCommandContext
  ) => {
    const db = getDb()
    const trusted = resolveTrustedAuthSessionCaller(db, event.sender.id, params)
    if (!trusted.ok) return { success: false as const, errorCode: 'FORBIDDEN' as const }
    return createSession(db, trusted.params, mutationExecution(options.eventPort, context))
  })

  registrar.handle('assessment:submitAnswer', (
    event,
    params: SubmitAnswerParams,
    context?: AcceptedCommandContext
  ) => {
    const db = getDb()
    const trusted = resolveTrustedAuthSessionCaller(db, event.sender.id, params)
    if (!trusted.ok) return { success: false as const, errorCode: 'FORBIDDEN' as const }
    return submitAnswer(db, trusted.params, mutationExecution(options.eventPort, context))
  })

  registrar.handle('assessment:emotionInterrupt', (
    event,
    params: EmotionInterruptParams,
    context?: AcceptedCommandContext
  ) => {
    const db = getDb()
    const trusted = resolveTrustedAuthSessionCaller(db, event.sender.id, params)
    if (!trusted.ok) return { success: false as const, errorCode: 'FORBIDDEN' as const }
    return emotionInterrupt(db, trusted.params, mutationExecution(options.eventPort, context))
  })

  registrar.handle('assessment:emotionResume', (
    event,
    params: EmotionResumeParams,
    context?: AcceptedCommandContext
  ) => {
    const db = getDb()
    const trusted = resolveTrustedAuthSessionCaller(db, event.sender.id, params)
    if (!trusted.ok) return { success: false as const, errorCode: 'FORBIDDEN' as const }
    return emotionResume(db, trusted.params, mutationExecution(options.eventPort, context))
  })

  registrar.handle('assessment:pauseSitting', (
    event,
    params: PauseSittingParams,
    context?: AcceptedCommandContext
  ) => {
    const db = getDb()
    const trusted = resolveTrustedAuthSessionCaller(db, event.sender.id, params)
    if (!trusted.ok) return { success: false as const, errorCode: 'FORBIDDEN' as const }
    return pauseSitting(db, trusted.params, mutationExecution(options.eventPort, context))
  })

  registrar.handle('assessment:startNextSitting', (
    event,
    params: StartNextSittingParams,
    context?: AcceptedCommandContext
  ) => {
    const db = getDb()
    const trusted = resolveTrustedAuthSessionCaller(db, event.sender.id, params)
    if (!trusted.ok) return { success: false as const, errorCode: 'FORBIDDEN' as const }
    return startNextSitting(db, trusted.params, mutationExecution(options.eventPort, context))
  })

  registrar.handle('assessment:recordEmotionCollapse', (
    event,
    params: RecordEmotionCollapseParams,
    context?: AcceptedCommandContext
  ) => {
    const db = getDb()
    const trusted = resolveTrustedAuthSessionCaller(db, event.sender.id, params)
    if (!trusted.ok) return { success: false as const, errorCode: 'FORBIDDEN' as const }
    return recordEmotionCollapse(db, trusted.params, mutationExecution(options.eventPort, context))
  })

  registrar.handle('assessment:abortSession', (
    event,
    params: AbortSessionParams,
    context?: AcceptedCommandContext
  ) => {
    const db = getDb()
    const trusted = resolveTrustedAuthSessionCaller(db, event.sender.id, params)
    if (!trusted.ok) return { success: false as const, errorCode: 'FORBIDDEN' as const }
    return abortSession(db, trusted.params, mutationExecution(options.eventPort, context))
  })

  registrar.handle('assessment:triggerRedline', (
    event,
    params: TriggerRedlineParams,
    context?: AcceptedCommandContext
  ) => {
    const db = getDb()
    const trusted = resolveTrustedAuthSessionCaller(db, event.sender.id, params)
    if (!trusted.ok) return { success: false as const, errorCode: 'FORBIDDEN' as const }
    return triggerRedline(db, trusted.params, mutationExecution(options.eventPort, context))
  })

  registrar.handle('assessment:calculateResult', (
    event,
    params: CalculateResultParams,
    context?: AcceptedCommandContext
  ) => {
    const db = getDb()
    const trusted = resolveTrustedAuthSessionCaller(db, event.sender.id, params)
    if (!trusted.ok) return { success: false as const, errorCode: 'FORBIDDEN' as const }
    return calculateResult(db, trusted.params, mutationExecution(options.eventPort, context))
  })

  registrar.handle('assessment:getSession', (event, params: GetSessionParams) => {
    const db = getDb()
    const trusted = resolveTrustedAuthSessionCaller(db, event.sender.id, params)
    if (!trusted.ok) return { success: false as const, errorCode: 'FORBIDDEN' as const }
    return getSession(db, trusted.params)
  })

  registrar.handle('assessment:listSessions', (event, params: ListSessionsParams) => {
    const db = getDb()
    const trusted = resolveTrustedAuthSessionCaller(db, event.sender.id, params)
    if (!trusted.ok) return { success: false as const, errorCode: 'FORBIDDEN' as const }
    return listSessions(db, trusted.params)
  })

  registrar.handle('assessment:startSession', (
    event,
    params: StartSessionParams,
    context?: AcceptedCommandContext
  ) => {
    const db = getDb()
    const trusted = resolveTrustedAuthSessionCaller(db, event.sender.id, params)
    if (!trusted.ok) return { success: false as const, errorCode: 'FORBIDDEN' as const }
    return startSession(db, trusted.params, mutationExecution(options.eventPort, context))
  })

  registrar.handle('assessment:listMySessions', (event, params: ListMySessionsParams) => {
    const db = getDb()
    const trusted = resolveTrustedAuthSessionCaller(db, event.sender.id, params)
    if (!trusted.ok) return { success: false as const, errorCode: 'FORBIDDEN' as const }
    return listMySessions(db, trusted.params)
  })
}
