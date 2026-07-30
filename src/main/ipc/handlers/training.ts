import type { DBAdapter } from '../../db/interface'
import { getDatabase } from '../../db/connection'
import { SqliteAdapter } from '../../db/sqlite-adapter'
import type { ReportMutationPort } from '../../domain/report-command-coordinator'
import type { AcceptedCommandContext } from '../../application/command/command-types'
import {
  completeStep,
  createTrainingSession,
  failStep,
  retryStep,
  skipStep,
  startStep,
  type TrainingMutationExecution
} from '../../application/services/training-service'
import {
  getTrainingSession,
  listMyTrainingSessions,
  listTrainingSessions
} from '../../application/query/training-query-service'
import { resolveTrustedAuthSessionCaller } from '../../utils/auth-session'
import type {
  CreateTrainingSessionParams,
  GetTrainingSessionParams,
  ListMyTrainingSessionsParams,
  ListTrainingSessionsParams,
  TrainingStepActionParams
} from '@shared/types/training'
import type { LegacyIpcHandlerRegistrar } from '../legacy-handler-collector'

export {
  applyTrainingEvent,
  completeStep,
  createTrainingSession,
  failStep,
  haltTrainingSessionSteps,
  retryStep,
  skipStep,
  startStep
} from '../../application/services/training-service'
export {
  getTrainingSession,
  listMyTrainingSessions,
  listTrainingSessions
} from '../../application/query/training-query-service'

export interface TrainingHandlerRegistrationOptions {
  readonly eventPort: Pick<ReportMutationPort, 'writeEvent'>
  readonly getDb?: () => DBAdapter
}

function defaultGetDb(): DBAdapter {
  return new SqliteAdapter(getDatabase())
}

function mutationExecution(
  eventPort: Pick<ReportMutationPort, 'writeEvent'>,
  context: AcceptedCommandContext | undefined
): TrainingMutationExecution {
  if (!context) throw new Error('training mutation requires accepted command context')
  return { eventPort, context }
}

export function registerTrainingHandlers(
  registrar: LegacyIpcHandlerRegistrar,
  options: TrainingHandlerRegistrationOptions
): void {
  const getDb = options.getDb ?? defaultGetDb

  registrar.handle('training:createSession', (
    event,
    params: CreateTrainingSessionParams,
    context?: AcceptedCommandContext
  ) => {
    const db = getDb()
    const trusted = resolveTrustedAuthSessionCaller(db, event.sender.id, params)
    if (!trusted.ok) return { success: false as const, errorCode: 'FORBIDDEN' as const }
    return createTrainingSession(db, trusted.params, mutationExecution(options.eventPort, context))
  })
  registrar.handle('training:listSessions', (event, params: ListTrainingSessionsParams) => {
    const db = getDb()
    const trusted = resolveTrustedAuthSessionCaller(db, event.sender.id, params)
    if (!trusted.ok) return { success: false as const, errorCode: 'FORBIDDEN' as const }
    return listTrainingSessions(db, trusted.params)
  })
  registrar.handle('training:listMySessions', (event, params: ListMyTrainingSessionsParams) => {
    const db = getDb()
    const trusted = resolveTrustedAuthSessionCaller(db, event.sender.id, params)
    if (!trusted.ok) return { success: false as const, errorCode: 'FORBIDDEN' as const }
    return listMyTrainingSessions(db, trusted.params)
  })
  registrar.handle('training:getSession', (event, params: GetTrainingSessionParams) => {
    const db = getDb()
    const trusted = resolveTrustedAuthSessionCaller(db, event.sender.id, params)
    if (!trusted.ok) return { success: false as const, errorCode: 'FORBIDDEN' as const }
    return getTrainingSession(db, trusted.params)
  })

  const registerStep = (
    channel: 'training:startStep' | 'training:completeStep' | 'training:skipStep' | 'training:failStep' | 'training:retryStep',
    operation: typeof startStep
  ): void => {
    registrar.handle(channel, (
      event,
      params: TrainingStepActionParams,
      context?: AcceptedCommandContext
    ) => {
      const db = getDb()
      const trusted = resolveTrustedAuthSessionCaller(db, event.sender.id, params)
      if (!trusted.ok) return { success: false as const, errorCode: 'FORBIDDEN' as const }
      return operation(db, trusted.params, mutationExecution(options.eventPort, context))
    })
  }
  registerStep('training:startStep', startStep)
  registerStep('training:completeStep', completeStep)
  registerStep('training:skipStep', skipStep)
  registerStep('training:failStep', failStep)
  registerStep('training:retryStep', retryStep)
}
