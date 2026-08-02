import type { IpcMainInvokeEvent } from 'electron'
import type { DBAdapter } from '../../db/interface'
import type { CanonicalJsonValue } from '../../domain/event-batch/canonical-json'
import { canonicalizeCommandRecord } from './command-envelope'
import { createPreflightErrorMap, type PublicCommandErrorCode } from './public-error-contract'
import { CommandPreflightError, type CommandActor, type CommandDefinitionMetadata, type CommandEnvelope, type CommandTransportContext, type MutationCommandDefinition } from './command-types'
import { resolveTrustedCallerSnapshot } from '../../utils/auth-session'
import { PREVIEW_RELEASE_RESULT_RECIPE_VERSIONS } from '../../domain/projectors/preview-release-projector'

export const PREVIEW_RELEASE_COMMAND_TYPES = Object.freeze(['preview:releasePack', 'preview:revokePack'] as const)

export interface PreviewReleaseCommandDefinitionDependencies {
  readonly db: DBAdapter
  readonly eventForTransport: (transportId: string) => IpcMainInvokeEvent
}

type CommandType = (typeof PREVIEW_RELEASE_COMMAND_TYPES)[number]
type PackageField = 'releasePackage' | 'revokePackage'
interface PreviewReleaseInput { readonly candidate: Readonly<Record<string, CanonicalJsonValue>>; readonly packageField: PackageField }

const ERRORS = [
  'PREVIEW_CONTRACT_MIGRATION_REQUIRED', 'INSTALLATION_TRUST_UNAVAILABLE', 'PREVIEW_CANONICAL_INVALID',
  'PREVIEW_UNKNOWN_FIELD', 'PREVIEW_HASH_INVALID', 'PREVIEW_SCOPE_INVALID', 'PREVIEW_VALIDITY_INVALID',
  'PREVIEW_APPROVAL_INVALID', 'PREVIEW_APPROVAL_HASH_CONFLICT', 'PREVIEW_IDEMPOTENCY_CONFLICT',
  'PREVIEW_STATE_CONFLICT', 'PREVIEW_PACK_RELEASE_SEPARATION_OF_DUTIES_FAILED', 'FORBIDDEN', 'VALIDATION_ERROR', 'SYSTEM_ERROR'
] as const satisfies readonly PublicCommandErrorCode[]
type ErrorCode = (typeof ERRORS)[number]

function field(commandType: string): PackageField { return commandType === 'preview:releasePack' ? 'releasePackage' : 'revokePackage' }

function metadata(commandType: CommandType): CommandDefinitionMetadata<ErrorCode> & Readonly<{ mode: 'MUTATION' }> {
  return {
    mode: 'MUTATION', executionMode: 'ASYNC', allowedSources: ['IPC'], actorPolicy: { kind: 'ACTIVE_USER', roles: ['ADMIN'] },
    targetResolver: { owner: commandType, kind: 'CREATE_FROM_VALIDATED_REFERENCES', locatorFields: ['signed package'], authoritativeFields: ['sender-bound auth_session', 'signed release package'], canonicalTargetFields: ['aggregate_type', 'release_id', 'source_ref_id'], clientHintFields: [], notFoundMapping: 'PREVIEW_STATE_CONFLICT', mismatchMapping: 'PREVIEW_SCOPE_INVALID', testReferences: ['src/main/application/command/__tests__/preview-release-command.test.ts'] },
    payloadContract: commandType === 'preview:releasePack' ? 'preview.release-pack.v1' : 'preview.revoke-pack.v1',
    sideEffects: ['PREVIEW_RELEASE_EVENT', 'PREVIEW_RELEASE_PROJECTION'], phase: 'PREVIEW_RELEASE', transactionOwner: 'preview-release-projector', retryPolicy: 'REPLAY_SAFE',
    durableCommand: { requestHash: { schemaVersion: 'command-request-hash-v1', secretFields: [], secretIdentityFields: [] }, resultSchemaVersion: 'command-result-v1', resultRecipeVersion: PREVIEW_RELEASE_RESULT_RECIPE_VERSIONS[commandType], prePonrRetryPolicy: 'RETRYABLE_SYSTEM_FAILURE', maxAttempts: 3 },
    concurrencyPolicy: { kind: 'FAIL_FAST_ACTIVE_KEY', keyOwner: `preview-release:${commandType}` }, publicErrorCodes: ERRORS,
    preflightErrorMap: createPreflightErrorMap('PREVIEW_CONTRACT_MIGRATION_REQUIRED', { INVALID_PAYLOAD: 'VALIDATION_ERROR', INVALID_ACTOR: 'FORBIDDEN', TARGET_MISMATCH: 'PREVIEW_SCOPE_INVALID', TARGET_NOT_FOUND: 'PREVIEW_STATE_CONFLICT' }),
    testReferences: ['src/main/application/command/__tests__/preview-release-command.test.ts']
  }
}

function target(input: PreviewReleaseInput): Record<string, unknown> {
  const packageValue = input.candidate[input.packageField]
  if (typeof packageValue !== 'object' || packageValue === null || Array.isArray(packageValue)) throw new CommandPreflightError('INVALID_PAYLOAD', input.packageField)
  const fact = (packageValue as Record<string, unknown>).fact
  if (typeof fact !== 'object' || fact === null || Array.isArray(fact)) throw new CommandPreflightError('INVALID_PAYLOAD', `${input.packageField}.fact`)
  const record = fact as Record<string, unknown>
  if (typeof record.release_id !== 'string' || typeof record.source_ref_id !== 'string') throw new CommandPreflightError('INVALID_PAYLOAD', `${input.packageField}.fact.scope`)
  return { aggregate_type: 'PREVIEW_RELEASE', release_id: record.release_id, source_ref_id: record.source_ref_id }
}

function definition(commandType: CommandType, dependencies: PreviewReleaseCommandDefinitionDependencies): MutationCommandDefinition<unknown, PreviewReleaseInput, Readonly<Record<string, CanonicalJsonValue>>, ErrorCode> {
  const packageField = field(commandType)
  return {
    commandType, metadata: metadata(commandType),
    validateStructure(rawInput) {
      const candidate = canonicalizeCommandRecord(rawInput, '$.input')
      const keys = Object.keys(candidate)
      if (keys.length !== 1 || keys[0] !== packageField) throw new CommandPreflightError('INVALID_PAYLOAD', packageField)
      if (typeof candidate[packageField] !== 'object' || candidate[packageField] === null || Array.isArray(candidate[packageField])) throw new CommandPreflightError('INVALID_PAYLOAD', packageField)
      return Object.freeze({ candidate: Object.freeze(candidate), packageField })
    },
    resolveActor(context: CommandTransportContext): CommandActor {
      const caller = resolveTrustedCallerSnapshot(dependencies.db, dependencies.eventForTransport(context.transportId).sender.id)
      if (!caller.success || caller.role !== 'ADMIN') throw new CommandPreflightError('INVALID_ACTOR')
      return { kind: 'USER', userId: caller.userId, role: caller.role, authSessionId: caller.authSessionId }
    },
    normalizeBusinessInput(_context, actor, input) { if (actor.kind !== 'USER') throw new CommandPreflightError('INVALID_ACTOR'); return { [packageField]: input.candidate[packageField] } },
    resolveTarget(_context, _actor, input) { return target(input) },
    canonicalPayload(_context, _actor, _target, input) { return { [packageField]: input.candidate[packageField] } },
    concurrencyKey(envelope: CommandEnvelope) { return `PREVIEW_RELEASE:${String(envelope.target.release_id)}` },
    execute() { return { success: false, errorCode: 'PREVIEW_CONTRACT_MIGRATION_REQUIRED' } },
    mapUnexpectedExecutionError() { return { success: false, errorCode: 'PREVIEW_CONTRACT_MIGRATION_REQUIRED' } }
  }
}

export function createPreviewReleaseCommandDefinitions(dependencies: PreviewReleaseCommandDefinitionDependencies): readonly MutationCommandDefinition<unknown, PreviewReleaseInput, Readonly<Record<string, CanonicalJsonValue>>, ErrorCode>[] {
  return Object.freeze(PREVIEW_RELEASE_COMMAND_TYPES.map((commandType) => definition(commandType, dependencies)))
}
