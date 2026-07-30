import { v4 as uuidv4 } from 'uuid'
import type { DBAdapter } from '../../../db/interface'
import { writeEvent } from '../../../domain/event-writer'
import type {
  SubmitOfflineAbilityScoresParams
} from '../../../../shared/types/ability-scoring'
import type {
  SubmitOperationScoresParams
} from '../../../../shared/types/operation-scoring'
import type {
  SubmitJobSkillOfflineScoresParams
} from '../../../../shared/types/job-skill-scoring'
import type {
  RecordTeacherObservationParams
} from '../../../../shared/types/teacher-observation'
import type {
  AcceptedCommandContext,
  UserCommandRole
} from '../../command/command-types'
import {
  submitOfflineAbilityScores as executeSubmitOfflineAbilityScores
} from '../ability-scoring-service'
import {
  submitOperationScores as executeSubmitOperationScores
} from '../operation-scoring-service'
import {
  submitJobSkillOfflineScores as executeSubmitJobSkillOfflineScores
} from '../job-skill-scoring-service'
import {
  recordTeacherObservation as executeRecordTeacherObservation
} from '../observation-service'
import {
  maybeGenerateJobSkillResult as executeMaybeGenerateJobSkillResult
} from '../job-skill-result-service'
import {
  createJobSkillReportAutomation,
  maybeGenerateJobSkillReport as executeMaybeGenerateJobSkillReport,
  type JobSkillReportAutomation
} from '../job-skill-report-service'

export {
  getOfflineAbilityScores
} from '../../query/ability-scoring-query-service'
export {
  getOperationScores
} from '../../query/operation-scoring-query-service'
export {
  getJobSkillOfflineScores,
  getSessionScoringQuestions
} from '../../query/job-skill-scoring-query-service'
export {
  getTeacherObservations
} from '../../query/observation-query-service'
export { createJobSkillReportAutomation }
export type { JobSkillReportAutomation }

export function acceptedScoringTestContext(options: {
  commandType: 'assessment:submitOfflineAbilityScores'
    | 'assessment:submitOperationScores'
    | 'assessment:submitJobSkillOfflineScores'
    | 'assessment:recordTeacherObservation'
  callerUserId?: string
  callerRole?: string
  sessionId?: string
  correlationId?: string
}): AcceptedCommandContext {
  const commandId = uuidv4()
  return {
    envelope: {
      commandId,
      commandType: options.commandType,
      source: 'IPC',
      actor: {
        kind: 'USER',
        userId: options.callerUserId ?? 'scoring-test-user',
        role: (options.callerRole ?? 'TEACHER') as UserCommandRole,
        authSessionId: 'scoring-test-auth-session'
      },
      target: {
        aggregate_type: 'ASSESSMENT_SESSION',
        aggregate_id: options.sessionId ?? 'scoring-test-session',
        session_id: options.sessionId ?? 'scoring-test-session'
      },
      payload: {},
      requestHash: 'scoring-test-request-hash',
      createdAt: '2026-07-29T00:00:00.000Z',
      correlationId: options.correlationId ?? commandId
    },
    transport: {
      source: 'IPC',
      transportId: `scoring-test:${commandId}`
    }
  } as unknown as AcceptedCommandContext
}

function contextFor(
  commandType: Parameters<typeof acceptedScoringTestContext>[0]['commandType'],
  params: { callerUserId: string; callerRole: string; sessionId: string }
): AcceptedCommandContext {
  return acceptedScoringTestContext({ commandType, ...params })
}

export function submitOfflineAbilityScores(
  db: DBAdapter,
  params: SubmitOfflineAbilityScoresParams
) {
  return executeSubmitOfflineAbilityScores(db, params, {
    eventPort: { writeEvent },
    context: contextFor('assessment:submitOfflineAbilityScores', params)
  })
}

export function submitOperationScores(
  db: DBAdapter,
  params: SubmitOperationScoresParams
) {
  return executeSubmitOperationScores(db, params, {
    eventPort: { writeEvent },
    context: contextFor('assessment:submitOperationScores', params)
  })
}

export function submitJobSkillOfflineScores(
  db: DBAdapter,
  params: SubmitJobSkillOfflineScoresParams,
  automation?: JobSkillReportAutomation
) {
  return executeSubmitJobSkillOfflineScores(db, params, {
    eventPort: { writeEvent },
    context: contextFor('assessment:submitJobSkillOfflineScores', params),
    automation
  })
}

export function recordTeacherObservation(
  db: DBAdapter,
  params: RecordTeacherObservationParams,
  automation?: JobSkillReportAutomation
) {
  return executeRecordTeacherObservation(db, params, {
    eventPort: { writeEvent },
    context: contextFor('assessment:recordTeacherObservation', params),
    automation
  })
}

export function maybeGenerateJobSkillResult(
  db: DBAdapter,
  sessionId: string,
  callerUserId: string,
  automation: JobSkillReportAutomation
): void {
  executeMaybeGenerateJobSkillResult(db, sessionId, callerUserId, automation, {
    eventPort: { writeEvent },
    context: acceptedScoringTestContext({
      commandType: 'assessment:recordTeacherObservation',
      callerUserId,
      callerRole: 'TEACHER',
      sessionId
    })
  })
}

export function maybeGenerateJobSkillReport(
  db: DBAdapter,
  sessionId: string,
  callerUserId: string,
  automation: JobSkillReportAutomation
): void {
  executeMaybeGenerateJobSkillReport(
    db,
    sessionId,
    callerUserId,
    automation,
    acceptedScoringTestContext({
      commandType: 'assessment:recordTeacherObservation',
      callerUserId,
      callerRole: 'TEACHER',
      sessionId
    })
  )
}
