import { v4 as uuidv4 } from 'uuid'
import type { DBAdapter } from '../../../db/interface'
import { writeEvent } from '../../../domain/event-writer'
import type {
  AbortSessionParams,
  CalculateResultParams,
  CreateSessionParams,
  EmotionInterruptParams,
  EmotionResumeParams,
  PauseSittingParams,
  RecordEmotionCollapseParams,
  StartNextSittingParams,
  StartSessionParams,
  SubmitAnswerParams,
  TriggerRedlineParams
} from '../../../../shared/types/assessment'
import type {
  AcceptedCommandContext,
  CommandActor,
  UserCommandRole
} from '../../command/command-types'
import {
  abortSession as executeAbortSession,
  calculateResult as executeCalculateResult,
  createSession as executeCreateSession,
  emotionInterrupt as executeEmotionInterrupt,
  emotionResume as executeEmotionResume,
  pauseSitting as executePauseSitting,
  recordEmotionCollapse as executeRecordEmotionCollapse,
  startNextSitting as executeStartNextSitting,
  startSession as executeStartSession,
  submitAnswer as executeSubmitAnswer,
  triggerRedline as executeTriggerRedline,
  type AssessmentMutationExecution
} from '../assessment-service'

export {
  getSession,
  listMySessions,
  listSessions
} from '../../query/assessment-query-service'
export { seedAssessmentErrorCodes } from '../assessment-service'

export function acceptedAssessmentTestContext(options: {
  commandType: string
  correlationId?: string
  target?: Readonly<Record<string, string | number | boolean | null>>
  actor?: CommandActor
}): AcceptedCommandContext {
  const commandId = uuidv4()
  return {
    envelope: {
      commandId,
      commandType: options.commandType,
      source: 'IPC',
      actor: options.actor ?? {
        kind: 'USER',
        userId: 'assessment-test-user',
        role: 'TEACHER',
        authSessionId: 'assessment-test-auth-session'
      },
      target: options.target ?? { aggregate_type: 'ASSESSMENT_SESSION' },
      payload: {},
      requestHash: 'assessment-test-request-hash',
      createdAt: '2026-07-29T00:00:00.000Z',
      correlationId: options.correlationId ?? commandId
    },
    transport: {
      source: 'IPC',
      transportId: `assessment-test:${commandId}`
    }
  } as AcceptedCommandContext
}

function actorFor(params: { callerUserId: string; callerRole: string }): CommandActor {
  return {
    kind: 'USER',
    userId: params.callerUserId,
    role: params.callerRole as UserCommandRole,
    authSessionId: 'assessment-test-auth-session'
  }
}

function targetFor(
  db: DBAdapter,
  params: { sessionId?: string }
): Readonly<Record<string, string | number | boolean | null>> {
  if (!params.sessionId) return { aggregate_type: 'ASSESSMENT_SESSION' }
  const row = db.prepare(
    `SELECT student_id, job_code, task_code
       FROM assessment_session
      WHERE session_id = ?`
  ).get(params.sessionId) as {
    student_id: string
    job_code: string
    task_code: string
  } | undefined
  return {
    aggregate_type: 'ASSESSMENT_SESSION',
    aggregate_id: params.sessionId,
    session_id: params.sessionId,
    student_id: row?.student_id ?? 'assessment-test-student',
    job_code: row?.job_code ?? 'assessment-test-job',
    task_code: row?.task_code ?? 'assessment-test-task'
  }
}

function execution(
  db: DBAdapter,
  commandType: string,
  params: { callerUserId: string; callerRole: string; sessionId?: string },
  context?: AcceptedCommandContext
): AssessmentMutationExecution {
  return {
    eventPort: { writeEvent },
    context: context ?? acceptedAssessmentTestContext({
      commandType,
      actor: actorFor(params),
      target: targetFor(db, params)
    })
  }
}

export function createSession(db: DBAdapter, params: CreateSessionParams) {
  return executeCreateSession(db, params, execution(db, 'assessment:createSession', params))
}

export function submitAnswer(db: DBAdapter, params: SubmitAnswerParams) {
  return executeSubmitAnswer(db, params, execution(db, 'assessment:submitAnswer', params))
}

export function emotionInterrupt(db: DBAdapter, params: EmotionInterruptParams) {
  return executeEmotionInterrupt(db, params, execution(db, 'assessment:emotionInterrupt', params))
}

export function emotionResume(db: DBAdapter, params: EmotionResumeParams) {
  return executeEmotionResume(db, params, execution(db, 'assessment:emotionResume', params))
}

export function pauseSitting(db: DBAdapter, params: PauseSittingParams) {
  return executePauseSitting(db, params, execution(db, 'assessment:pauseSitting', params))
}

export function startNextSitting(db: DBAdapter, params: StartNextSittingParams) {
  return executeStartNextSitting(db, params, execution(db, 'assessment:startNextSitting', params))
}

export function recordEmotionCollapse(db: DBAdapter, params: RecordEmotionCollapseParams) {
  return executeRecordEmotionCollapse(
    db,
    params,
    execution(db, 'assessment:recordEmotionCollapse', params)
  )
}

export function abortSession(db: DBAdapter, params: AbortSessionParams) {
  return executeAbortSession(db, params, execution(db, 'assessment:abortSession', params))
}

export function triggerRedline(
  db: DBAdapter,
  params: TriggerRedlineParams,
  options: { readonly context?: AcceptedCommandContext } = {}
) {
  return executeTriggerRedline(
    db,
    params,
    execution(db, 'assessment:triggerRedline', params, options.context)
  )
}

export function calculateResult(db: DBAdapter, params: CalculateResultParams) {
  return executeCalculateResult(db, params, execution(db, 'assessment:calculateResult', params))
}

export function startSession(db: DBAdapter, params: StartSessionParams) {
  return executeStartSession(db, params, execution(db, 'assessment:startSession', params))
}
