import { v4 as uuidv4 } from 'uuid'
import type { DBAdapter } from '../../../db/interface'
import type { ReportMutationPort } from '../../../domain/report-command-coordinator'
import type {
  CreateTrainingSessionParams,
  TrainingStepActionParams
} from '@shared/types/training'
import type { AcceptedCommandContext, CommandActor } from '../../command/command-types'
import {
  completeStep as executeCompleteStep,
  createTrainingSession as executeCreateTrainingSession,
  failStep as executeFailStep,
  retryStep as executeRetryStep,
  skipStep as executeSkipStep,
  startStep as executeStartStep,
  type TrainingMutationExecution
} from '../training-service'

type EventPort = Pick<ReportMutationPort, 'writeEvent'>

export function acceptedTestContext(options: {
  commandType: string
  correlationId?: string
  target?: Readonly<Record<string, string | number | boolean | null>>
  actor?: CommandActor
}): AcceptedCommandContext {
  const commandId = uuidv4()
  const correlationId = options.correlationId ?? commandId
  return {
    envelope: {
      commandId,
      commandType: options.commandType,
      source: 'IPC',
      actor: options.actor ?? {
        kind: 'USER',
        userId: 'training-test-user',
        role: 'STUDENT',
        authSessionId: 'training-test-auth-session'
      },
      target: options.target ?? { aggregate_type: 'TRAINING_SESSION' },
      payload: {},
      requestHash: 'training-test-request-hash',
      createdAt: '2026-07-29T00:00:00.000Z',
      correlationId
    },
    transport: {
      source: 'IPC',
      transportId: `training-test:${commandId}`
    }
  } as AcceptedCommandContext
}

function execution(eventPort: EventPort, commandType: string): TrainingMutationExecution {
  return {
    eventPort,
    context: acceptedTestContext({ commandType })
  }
}

export function createTrainingTestCommands(eventPort: EventPort) {
  return Object.freeze({
    createTrainingSession(db: DBAdapter, params: CreateTrainingSessionParams) {
      return executeCreateTrainingSession(db, params, execution(eventPort, 'training:createSession'))
    },
    startStep(db: DBAdapter, params: TrainingStepActionParams) {
      return executeStartStep(db, params, execution(eventPort, 'training:startStep'))
    },
    completeStep(db: DBAdapter, params: TrainingStepActionParams) {
      return executeCompleteStep(db, params, execution(eventPort, 'training:completeStep'))
    },
    skipStep(db: DBAdapter, params: TrainingStepActionParams) {
      return executeSkipStep(db, params, execution(eventPort, 'training:skipStep'))
    },
    failStep(db: DBAdapter, params: TrainingStepActionParams) {
      return executeFailStep(db, params, execution(eventPort, 'training:failStep'))
    },
    retryStep(db: DBAdapter, params: TrainingStepActionParams) {
      return executeRetryStep(db, params, execution(eventPort, 'training:retryStep'))
    }
  })
}
