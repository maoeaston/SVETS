import {
  COMMAND_PREFLIGHT_REASONS,
  type CommandActorPolicy,
  type PreflightErrorMap,
  type ReadCommandDefinition,
  type UserCommandRole
} from '../command/command-types'

export type M5AReadActorPolicy = readonly UserCommandRole[] | 'OPTIONAL_SESSION'

export interface M5AReadPolicy {
  readonly channel: string
  readonly actors: M5AReadActorPolicy
  readonly failureCode: string
  readonly definition: ReadCommandDefinition<string>
}

function preflightMap(code: string): PreflightErrorMap<string> {
  return Object.freeze(Object.fromEntries(
    COMMAND_PREFLIGHT_REASONS.map((reason) => [reason, code])
  ) as Record<(typeof COMMAND_PREFLIGHT_REASONS)[number], string>)
}

function actorPolicy(actors: M5AReadActorPolicy): CommandActorPolicy {
  return actors === 'OPTIONAL_SESSION'
    ? { kind: 'BOOTSTRAP' }
    : { kind: 'ACTIVE_USER', roles: actors }
}

function read(
  channel: string,
  actors: M5AReadActorPolicy,
  failureCode: string
): M5AReadPolicy {
  const publicErrorCodes = failureCode === 'FORBIDDEN'
    ? ['FORBIDDEN']
    : [failureCode, 'FORBIDDEN']
  return {
    channel,
    actors,
    failureCode,
    definition: {
      commandType: channel,
      metadata: {
        mode: 'READ',
        executionMode: 'ASYNC',
        allowedSources: ['IPC'],
        actorPolicy: actorPolicy(actors),
        targetResolver: {
          owner: `query:${channel}`,
          kind: actors === 'OPTIONAL_SESSION' ? 'STATIC_CONTEXT' : 'ACTOR_SCOPED',
          locatorFields: [],
          authoritativeFields: actors === 'OPTIONAL_SESSION'
            ? ['query registry static context']
            : ['auth_session.auth_session_id', 'auth_session.user_id'],
          canonicalTargetFields: ['query_scope'],
          clientHintFields: ['callerUserId', 'callerRole'],
          notFoundMapping: failureCode,
          mismatchMapping: 'FORBIDDEN',
          testReferences: ['src/main/ipc/__tests__/handler-registry.test.ts']
        },
        payloadContract: `m5a.query.${channel}.v1`,
        sideEffects: [],
        phase: 'QUERY_ONLY',
        transactionOwner: 'NONE_READ_ONLY',
        retryPolicy: 'REPLAY_SAFE',
        concurrencyPolicy: { kind: 'NONE_READ_ONLY' },
        publicErrorCodes,
        preflightErrorMap: preflightMap(failureCode),
        testReferences: [
          'src/main/ipc/__tests__/handler-registry.test.ts',
          'src/main/application/command/__tests__/preflight-no-side-effect.test.ts'
        ]
      }
    }
  }
}

const ALL_USERS = ['STUDENT', 'TEACHER', 'ADMIN'] as const
const TEACHER_ADMIN = ['TEACHER', 'ADMIN'] as const
const STUDENT = ['STUDENT'] as const
const TEACHER = ['TEACHER'] as const
const ADMIN = ['ADMIN'] as const

const READ_POLICIES: readonly M5AReadPolicy[] = [
  read('assessment:getJobSkillOfflineScores', TEACHER_ADMIN, 'ASSESSMENT_SYSTEM_ERROR'),
  read('assessment:getOfflineAbilityScores', TEACHER_ADMIN, 'ASSESSMENT_SYSTEM_ERROR'),
  read('assessment:getOperationScores', TEACHER_ADMIN, 'ASSESSMENT_SYSTEM_ERROR'),
  read('assessment:getSession', ALL_USERS, 'ASSESSMENT_SYSTEM_ERROR'),
  read('assessment:getSessionScoringQuestions', ALL_USERS, 'ASSESSMENT_SYSTEM_ERROR'),
  read('assessment:getTeacherObservations', TEACHER_ADMIN, 'ASSESSMENT_SYSTEM_ERROR'),
  read('assessment:listMySessions', STUDENT, 'ASSESSMENT_SYSTEM_ERROR'),
  read('assessment:listSessions', TEACHER_ADMIN, 'ASSESSMENT_SYSTEM_ERROR'),
  read('auth:getCurrentSession', 'OPTIONAL_SESSION', 'SYSTEM_ERROR'),
  read('auth:listAccounts', ADMIN, 'FORBIDDEN'),
  read('foundation:getException', TEACHER_ADMIN, 'FOUNDATION_SYSTEM_ERROR'),
  read('foundation:getOverview', TEACHER_ADMIN, 'FOUNDATION_SYSTEM_ERROR'),
  read('foundation:listExceptions', TEACHER_ADMIN, 'FOUNDATION_SYSTEM_ERROR'),
  read('reports:get', TEACHER, 'REPORT_SYSTEM_ERROR'),
  read('reports:list', TEACHER, 'REPORT_SYSTEM_ERROR'),
  read('reports:listGenerationCandidates', TEACHER, 'REPORT_SYSTEM_ERROR'),
  read('results:getCurrent', ALL_USERS, 'RESULTS_SYSTEM_ERROR'),
  read('results:listCurrentByStudent', ALL_USERS, 'RESULTS_SYSTEM_ERROR'),
  read('safety:get', TEACHER_ADMIN, 'SAFETY_SYSTEM_ERROR'),
  read('safety:list', TEACHER_ADMIN, 'SAFETY_SYSTEM_ERROR'),
  read('strategy:get', TEACHER_ADMIN, 'SYSTEM_ERROR'),
  read('strategy:list', TEACHER_ADMIN, 'SYSTEM_ERROR'),
  read('strategy:listVersions', TEACHER_ADMIN, 'SYSTEM_ERROR'),
  read('student:get', TEACHER_ADMIN, 'SYSTEM_ERROR'),
  read('student:list', TEACHER_ADMIN, 'SYSTEM_ERROR'),
  read('training:getSession', ALL_USERS, 'TRAINING_SYSTEM_ERROR'),
  read('training:listMySessions', STUDENT, 'TRAINING_SYSTEM_ERROR'),
  read('training:listSessions', TEACHER_ADMIN, 'TRAINING_SYSTEM_ERROR')
]

const policiesByChannel = new Map(READ_POLICIES.map((policy) => [policy.channel, policy]))
if (policiesByChannel.size !== READ_POLICIES.length) throw new Error('duplicate M5A read channel')
if (READ_POLICIES.length !== 28) {
  throw new Error(`expected 28 M5A read channels, received ${READ_POLICIES.length}`)
}

export const M5A_READ_CHANNELS = Object.freeze(
  READ_POLICIES.map((policy) => policy.channel).sort()
)

export const M5A_READ_DEFINITIONS = Object.freeze(
  READ_POLICIES.map((policy) => policy.definition)
)

export function requireM5AReadPolicy(channel: string): M5AReadPolicy {
  const policy = policiesByChannel.get(channel)
  if (!policy) throw new Error(`unknown M5A read channel: ${channel}`)
  return policy
}
