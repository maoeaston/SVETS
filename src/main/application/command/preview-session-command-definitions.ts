import type { CanonicalJsonValue } from '../../domain/event-batch/canonical-json'
import { canonicalizeCommandRecord } from './command-envelope'
import { createPreflightErrorMap, type PublicCommandErrorCode } from './public-error-contract'
import {
  type CommandActor,
  type CommandDefinitionMetadata,
  type CommandEnvelope,
  type MutationCommandDefinition,
  CommandPreflightError
} from './command-types'
import { PREVIEW_SESSION_RESULT_RECIPE_VERSIONS } from '../../domain/projectors/preview-session-projector'

export const PREVIEW_SESSION_COMMAND_TYPES = Object.freeze([
  'preview:startSession',
  'preview:completeSession',
  'preview:abortSession',
  'preview:technicalInterruption'
] as const)

type CommandType = (typeof PREVIEW_SESSION_COMMAND_TYPES)[number]
type Candidate = Readonly<Record<string, CanonicalJsonValue>>
type Input = Readonly<{ candidate: Candidate; field: 'snapshot' | 'status' }>

const ERRORS = [
  'PREVIEW_CONTRACT_MIGRATION_REQUIRED',
  'PREVIEW_SESSION_CONTRACT_INVALID',
  'PREVIEW_SCOPE_INVALID',
  'PREVIEW_SOURCE_AUTHORITY_MISSING',
  'PREVIEW_STATE_CONFLICT',
  'PREVIEW_IDEMPOTENCY_CONFLICT',
  'PREVIEW_EVENT_OWNERSHIP_CONFLICT',
  'PREVIEW_RESULT_SUPPRESSED',
  'FORBIDDEN',
  'VALIDATION_ERROR',
  'SYSTEM_ERROR'
] as const satisfies readonly PublicCommandErrorCode[]
type ErrorCode = (typeof ERRORS)[number]

function metadata(commandType: CommandType): CommandDefinitionMetadata<ErrorCode> & Readonly<{ mode: 'MUTATION' }> {
  return {
    mode: 'MUTATION',
    executionMode: 'ASYNC',
    allowedSources: ['INTERNAL'],
    actorPolicy: { kind: 'SYSTEM', phases: ['PREVIEW_SESSION_RUNTIME'] },
    targetResolver: {
      owner: commandType,
      kind: 'EXISTING_AGGREGATE',
      locatorFields: ['preview_session_id', 'assessment_session_id'],
      authoritativeFields: ['preview session projection', 'frozen session snapshot'],
      canonicalTargetFields: ['aggregate_type', 'preview_session_id'],
      clientHintFields: [],
      notFoundMapping: 'PREVIEW_SESSION_CONTRACT_INVALID',
      mismatchMapping: 'PREVIEW_SCOPE_INVALID',
      testReferences: ['src/main/application/planners/__tests__/preview-session-planner.test.ts']
    },
    payloadContract: `preview.session.${commandType.replace('preview:', '').replace(/[A-Z]/g, (value) => '-' + value.toLowerCase())}.v1`,
    sideEffects: ['PREVIEW_SESSION_EVENT', 'PREVIEW_SESSION_PROJECTION', 'PREVIEW_SESSION_SHELL'],
    phase: 'PREVIEW_SESSION',
    transactionOwner: 'preview-session-projector',
    retryPolicy: 'REPLAY_SAFE',
    durableCommand: {
      requestHash: { schemaVersion: 'command-request-hash-v1', secretFields: [], secretIdentityFields: [] },
      resultSchemaVersion: 'command-result-v1',
      resultRecipeVersion: PREVIEW_SESSION_RESULT_RECIPE_VERSIONS[commandType],
      prePonrRetryPolicy: 'RETRYABLE_SYSTEM_FAILURE',
      maxAttempts: 3
    },
    concurrencyPolicy: { kind: 'FAIL_FAST_ACTIVE_KEY', keyOwner: `preview-session:${commandType}` },
    publicErrorCodes: ERRORS,
    preflightErrorMap: createPreflightErrorMap('PREVIEW_CONTRACT_MIGRATION_REQUIRED', {
      SOURCE_NOT_ALLOWED: 'FORBIDDEN',
      INVALID_PAYLOAD: 'PREVIEW_SESSION_CONTRACT_INVALID',
      INVALID_ACTOR: 'FORBIDDEN',
      TARGET_NOT_FOUND: 'PREVIEW_SESSION_CONTRACT_INVALID',
      TARGET_MISMATCH: 'PREVIEW_SCOPE_INVALID'
    }),
    testReferences: ['src/main/domain/preview/__tests__/preview-session-replay.test.ts']
  }
}

function object(value: unknown, field: string): Record<string, CanonicalJsonValue> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new CommandPreflightError('INVALID_PAYLOAD', field)
  return value as Record<string, CanonicalJsonValue>
}

function definition(commandType: CommandType): MutationCommandDefinition<unknown, Input, Readonly<Record<string, CanonicalJsonValue>>, ErrorCode> {
  const start = commandType === 'preview:startSession'
  const field = start ? 'snapshot' : 'status'
  return {
    commandType,
    metadata: metadata(commandType),
    validateStructure(rawInput) {
      const candidate = canonicalizeCommandRecord(rawInput, '$.input')
      if (Object.keys(candidate).length !== 1 || !Object.hasOwn(candidate, field)) throw new CommandPreflightError('INVALID_PAYLOAD', field)
      const value = object(candidate[field], `$.input.${field}`)
      if (start && typeof value.session_id !== 'string') throw new CommandPreflightError('INVALID_PAYLOAD', `${field}.session_id`)
      if (!start && (typeof value.session_id !== 'string' || typeof value.reason_code !== 'string')) throw new CommandPreflightError('INVALID_PAYLOAD', `${field}.session_id/reason_code`)
      return Object.freeze({ candidate: Object.freeze({ [field]: value }), field })
    },
    resolveActor(): CommandActor {
      return { kind: 'SYSTEM', phase: 'PREVIEW_SESSION_RUNTIME' }
    },
    normalizeBusinessInput(_context, _actor, input) {
      return { [input.field]: input.candidate[input.field] }
    },
    resolveTarget(_context, _actor, input) {
      const value = object(input.candidate[input.field], `input.${input.field}`)
      return { aggregate_type: 'PREVIEW_SESSION', preview_session_id: value.session_id }
    },
    canonicalPayload(_context, _actor, _target, input) {
      return { [input.field]: input.candidate[input.field] }
    },
    concurrencyKey(envelope: CommandEnvelope) {
      return `PREVIEW_SESSION:${String(envelope.target.preview_session_id)}`
    },
    execute() {
      return { success: false, errorCode: 'SYSTEM_ERROR' }
    },
    mapUnexpectedExecutionError() {
      return { success: false, errorCode: 'SYSTEM_ERROR' }
    }
  }
}

export function createPreviewSessionCommandDefinitions(): readonly MutationCommandDefinition<unknown, Input, Readonly<Record<string, CanonicalJsonValue>>, ErrorCode>[] {
  return Object.freeze(PREVIEW_SESSION_COMMAND_TYPES.map(definition))
}
