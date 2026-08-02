import {
  COMMAND_PREFLIGHT_REASONS,
  type CommandActorPolicy,
  type PreflightErrorMap,
  type ReadCommandDefinition
} from '../command/command-types'

export interface FeedbackReadPolicy {
  readonly channel: string
  readonly actors: readonly ('TEACHER' | 'ADMIN')[]
  readonly failureCode: string
  readonly definition: ReadCommandDefinition<string>
}

function preflightMap(code: string): PreflightErrorMap<string> {
  return Object.freeze(Object.fromEntries(
    COMMAND_PREFLIGHT_REASONS.map((reason) => [reason, code])
  ) as Record<(typeof COMMAND_PREFLIGHT_REASONS)[number], string>)
}

function read(channel: string, failureCode: string): FeedbackReadPolicy {
  const actors = ['TEACHER', 'ADMIN'] as const
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
          locatorFields: ['feedback_id', 'revision_no'],
          authoritativeFields: ['sender-bound auth_session', 'trusted organization scope', 'active principal installation scope'],
          canonicalTargetFields: ['feedback_reference_scope'],
          clientHintFields: ['callerUserId', 'callerRole'],
          notFoundMapping: failureCode,
          mismatchMapping: 'FORBIDDEN',
          testReferences: ['src/main/ipc/handlers/__tests__/feedback.test.ts']
        },
        payloadContract: `feedback.query.${channel.replace(':', '.')}.v1`,
        sideEffects: [],
        phase: 'QUERY_ONLY',
        transactionOwner: 'NONE_READ_ONLY',
        retryPolicy: 'REPLAY_SAFE',
        concurrencyPolicy: { kind: 'NONE_READ_ONLY' },
        publicErrorCodes: [failureCode, 'FORBIDDEN'],
        preflightErrorMap: preflightMap(failureCode),
        testReferences: [
          'src/main/ipc/handlers/__tests__/feedback.test.ts',
          'src/main/ipc/__tests__/handler-registry.test.ts'
        ]
      }
    }
  }
}

const READ_POLICIES: readonly FeedbackReadPolicy[] = [
  read('feedback:list', 'FEEDBACK_RECONCILE_REQUIRED'),
  read('feedback:get', 'FEEDBACK_RECONCILE_REQUIRED')
]

const policiesByChannel = new Map(READ_POLICIES.map((policy) => [policy.channel, policy]))
if (policiesByChannel.size !== READ_POLICIES.length) throw new Error('duplicate feedback read channel')

export const FEEDBACK_READ_DEFINITIONS = Object.freeze(
  READ_POLICIES.map((policy) => policy.definition)
)

export function requireFeedbackReadPolicy(channel: string): FeedbackReadPolicy {
  const policy = policiesByChannel.get(channel)
  if (!policy) throw new Error(`unknown feedback read channel: ${channel}`)
  return policy
}
