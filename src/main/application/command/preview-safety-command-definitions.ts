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
import { PREVIEW_SAFETY_RESULT_RECIPE_VERSION } from '../../domain/projectors/preview-safety-projector'

export const PREVIEW_SAFETY_COMMAND_TYPES = Object.freeze(['preview:triggerSafety'] as const)

type Input = Readonly<{ candidate: Readonly<Record<string, CanonicalJsonValue>> }>
const ERRORS = [
  'PREVIEW_CONTRACT_MIGRATION_REQUIRED',
  'PREVIEW_SESSION_CONTRACT_INVALID',
  'PREVIEW_SCOPE_INVALID',
  'PREVIEW_STATE_CONFLICT',
  'PREVIEW_IDEMPOTENCY_CONFLICT',
  'PREVIEW_EVENT_OWNERSHIP_CONFLICT',
  'FORBIDDEN',
  'VALIDATION_ERROR',
  'SYSTEM_ERROR'
] as const satisfies readonly PublicCommandErrorCode[]
type ErrorCode = (typeof ERRORS)[number]

function metadata(): CommandDefinitionMetadata<ErrorCode> & Readonly<{ mode: 'MUTATION' }> {
  return {
    mode: 'MUTATION', executionMode: 'ASYNC', allowedSources: ['INTERNAL'],
    actorPolicy: { kind: 'SYSTEM', phases: ['PREVIEW_SAFETY_RUNTIME'] },
    targetResolver: {
      owner: 'preview:triggerSafety', kind: 'EXISTING_AGGREGATE',
      locatorFields: ['preview_session_id'], authoritativeFields: ['preview session projection', 'frozen snapshot root'],
      canonicalTargetFields: ['aggregate_type', 'preview_session_id'], clientHintFields: [],
      notFoundMapping: 'PREVIEW_SESSION_CONTRACT_INVALID', mismatchMapping: 'PREVIEW_SCOPE_INVALID',
      testReferences: ['src/main/application/planners/__tests__/preview-safety-planner.test.ts']
    },
    payloadContract: 'preview.safety-trigger.v1', sideEffects: ['PREVIEW_SAFETY_EVENT', 'PREVIEW_SAFETY_PROJECTION', 'PREVIEW_SESSION_SHELL'],
    phase: 'PREVIEW_SAFETY', transactionOwner: 'preview-safety-projector', retryPolicy: 'REPLAY_SAFE',
    durableCommand: {
      requestHash: { schemaVersion: 'command-request-hash-v1', secretFields: [], secretIdentityFields: [] },
      resultSchemaVersion: 'command-result-v1', resultRecipeVersion: PREVIEW_SAFETY_RESULT_RECIPE_VERSION,
      prePonrRetryPolicy: 'RETRYABLE_SYSTEM_FAILURE', maxAttempts: 3
    },
    concurrencyPolicy: { kind: 'FAIL_FAST_ACTIVE_KEY', keyOwner: 'preview-safety:preview:triggerSafety' },
    publicErrorCodes: ERRORS,
    preflightErrorMap: createPreflightErrorMap('PREVIEW_CONTRACT_MIGRATION_REQUIRED', {
      SOURCE_NOT_ALLOWED: 'FORBIDDEN', INVALID_PAYLOAD: 'PREVIEW_SESSION_CONTRACT_INVALID', INVALID_ACTOR: 'FORBIDDEN',
      TARGET_NOT_FOUND: 'PREVIEW_SESSION_CONTRACT_INVALID', TARGET_MISMATCH: 'PREVIEW_SCOPE_INVALID'
    }),
    testReferences: ['src/main/domain/projectors/preview-safety-projector.ts']
  }
}

function object(value: unknown, field: string): Record<string, CanonicalJsonValue> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new CommandPreflightError('INVALID_PAYLOAD', field)
  return value as Record<string, CanonicalJsonValue>
}

export function createPreviewSafetyCommandDefinitions(): readonly MutationCommandDefinition<unknown, Input, Readonly<Record<string, CanonicalJsonValue>>, ErrorCode>[] {
  return Object.freeze([{
    commandType: 'preview:triggerSafety',
    metadata: metadata(),
    validateStructure(rawInput) {
      const candidate = canonicalizeCommandRecord(rawInput, '$.input')
      if (Object.keys(candidate).length !== 1 || !Object.hasOwn(candidate, 'safety')) throw new CommandPreflightError('INVALID_PAYLOAD', 'safety')
      const safety = object(candidate.safety, '$.input.safety')
      if (typeof safety.session_id !== 'string' || typeof safety.reason_code !== 'string') throw new CommandPreflightError('INVALID_PAYLOAD', 'safety.session_id/reason_code')
      return Object.freeze({ candidate: Object.freeze({ safety }) })
    },
    resolveActor(): CommandActor {
      return { kind: 'SYSTEM', phase: 'PREVIEW_SAFETY_RUNTIME' }
    },
    normalizeBusinessInput(_context, _actor, input) {
      return { safety: input.candidate.safety }
    },
    resolveTarget(_context, _actor, input) {
      const safety = object(input.candidate.safety, 'input.safety')
      return { aggregate_type: 'PREVIEW_SESSION', preview_session_id: safety.session_id }
    },
    canonicalPayload(_context, _actor, _target, input) {
      return { safety: input.candidate.safety }
    },
    concurrencyKey(envelope: CommandEnvelope) {
      return `PREVIEW_SAFETY:${String(envelope.target.preview_session_id)}`
    },
    execute() {
      return { success: false, errorCode: 'SYSTEM_ERROR' }
    },
    mapUnexpectedExecutionError() {
      return { success: false, errorCode: 'SYSTEM_ERROR' }
    }
  }])
}
