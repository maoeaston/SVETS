import {
  COMMAND_PREFLIGHT_REASONS,
  type CommandActorPolicy,
  type PreflightErrorMap,
  type ReadCommandDefinition,
  type UserCommandRole
} from '../command/command-types'

export type PreviewReadActorPolicy = readonly UserCommandRole[]

export interface PreviewReadPolicy {
  readonly channel: string
  readonly actors: PreviewReadActorPolicy
  readonly failureCode: string
  readonly definition: ReadCommandDefinition<string>
}

function preflightMap(code: string): PreflightErrorMap<string> {
  return Object.freeze(Object.fromEntries(
    COMMAND_PREFLIGHT_REASONS.map((reason) => [reason, code])
  ) as Record<(typeof COMMAND_PREFLIGHT_REASONS)[number], string>)
}

function read(channel: string, actors: PreviewReadActorPolicy, failureCode: string): PreviewReadPolicy {
  const actorPolicy: CommandActorPolicy = { kind: 'ACTIVE_USER', roles: actors }
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
        actorPolicy,
        targetResolver: {
          owner: `query:${channel}`,
          kind: 'ACTOR_SCOPED',
          locatorFields: ['session_id', 'release_id', 'feedback_id'],
          authoritativeFields: ['sender-bound auth_session', 'trusted organization scope', 'active principal installation scope', 'trusted student device/session scope'],
          canonicalTargetFields: ['preview_contract_scope'],
          clientHintFields: ['callerUserId', 'callerRole'],
          notFoundMapping: failureCode,
          mismatchMapping: 'FORBIDDEN',
          testReferences: ['src/main/ipc/handlers/__tests__/preview.test.ts']
        },
        payloadContract: `preview.query.${channel.replace(':', '.')}.v1`,
        sideEffects: [],
        phase: 'QUERY_ONLY',
        transactionOwner: 'NONE_READ_ONLY',
        retryPolicy: 'REPLAY_SAFE',
        concurrencyPolicy: { kind: 'NONE_READ_ONLY' },
        publicErrorCodes: [failureCode, 'FORBIDDEN'],
        preflightErrorMap: preflightMap(failureCode),
        testReferences: [
          'src/main/ipc/handlers/__tests__/preview.test.ts',
          'src/main/ipc/__tests__/handler-registry.test.ts'
        ]
      }
    }
  }
}

const TEACHER_ADMIN = ['TEACHER', 'ADMIN'] as const
const ALL_USERS = ['STUDENT', 'TEACHER', 'ADMIN'] as const

const READ_POLICIES: readonly PreviewReadPolicy[] = [
  read('preview:listSources', TEACHER_ADMIN, 'PREVIEW_SOURCE_AUTHORITY_MISSING'),
  read('preview:getRelease', TEACHER_ADMIN, 'PREVIEW_SOURCE_AUTHORITY_MISSING'),
  read('preview:getSession', ALL_USERS, 'PREVIEW_SESSION_CONTRACT_INVALID'),
  read('preview:listSessionQuestions', ALL_USERS, 'PREVIEW_SESSION_CONTRACT_INVALID')
]

const policiesByChannel = new Map(READ_POLICIES.map((policy) => [policy.channel, policy]))
if (policiesByChannel.size !== READ_POLICIES.length) throw new Error('duplicate preview read channel')

export const PREVIEW_READ_CHANNELS = Object.freeze(
  READ_POLICIES.map((policy) => policy.channel).sort()
)

export const PREVIEW_READ_DEFINITIONS = Object.freeze(
  READ_POLICIES.map((policy) => policy.definition)
)

export function requirePreviewReadPolicy(channel: string): PreviewReadPolicy {
  const policy = policiesByChannel.get(channel)
  if (!policy) throw new Error(`unknown preview read channel: ${channel}`)
  return policy
}
