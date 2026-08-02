import type { IpcMainInvokeEvent } from 'electron'
import type { DBAdapter } from '../../db/interface'
import type { CanonicalJsonValue } from '../../domain/event-batch/canonical-json'
import { canonicalizeCommandRecord } from './command-envelope'
import { createPreflightErrorMap, type PublicCommandErrorCode } from './public-error-contract'
import { CommandPreflightError, type CommandActor, type CommandDefinitionMetadata, type CommandEnvelope, type CommandTransportContext, type MutationCommandDefinition } from './command-types'
import { resolveTrustedCallerSnapshot } from '../../utils/auth-session'
import { PREVIEW_FEEDBACK_RESULT_RECIPE_VERSIONS } from '../../domain/projectors/preview-feedback-projector'

export const PREVIEW_FEEDBACK_COMMAND_TYPES = Object.freeze(['feedback:saveDraft', 'feedback:submit', 'feedback:reconcile', 'feedback:delete', 'feedback:purge', 'feedback:repair', 'feedback:export'] as const)

export interface PreviewFeedbackCommandDefinitionDependencies { readonly db: DBAdapter; readonly eventForTransport: (transportId: string) => IpcMainInvokeEvent }
type CommandType = (typeof PREVIEW_FEEDBACK_COMMAND_TYPES)[number]
type InputField = 'draft' | 'submission' | 'reconcile' | 'deletion' | 'purge' | 'repair' | 'export'
interface Input { readonly candidate: Readonly<Record<string, CanonicalJsonValue>>; readonly field: InputField }
const ERRORS = ['PREVIEW_CONTRACT_MIGRATION_REQUIRED', 'FEEDBACK_COMMIT_ID_COLLISION', 'FEEDBACK_COMMIT_CONFLICT', 'FEEDBACK_REVISION_CONFLICT', 'FEEDBACK_STATE_CONFLICT', 'FEEDBACK_CAPABILITY_INVALID', 'FEEDBACK_RECONCILE_REQUIRED', 'FEEDBACK_PRIVACY_VIOLATION', 'PREVIEW_SCOPE_INVALID', 'FORBIDDEN', 'VALIDATION_ERROR', 'SYSTEM_ERROR'] as const satisfies readonly PublicCommandErrorCode[]
type ErrorCode = (typeof ERRORS)[number]

function field(commandType: CommandType): InputField { return commandType === 'feedback:saveDraft' ? 'draft' : commandType === 'feedback:submit' ? 'submission' : commandType === 'feedback:reconcile' ? 'reconcile' : commandType === 'feedback:delete' ? 'deletion' : commandType === 'feedback:purge' ? 'purge' : commandType === 'feedback:repair' ? 'repair' : 'export' }
function roles(commandType: CommandType): readonly ('TEACHER' | 'ADMIN')[] { return commandType === 'feedback:saveDraft' || commandType === 'feedback:submit' || commandType === 'feedback:export' ? ['TEACHER', 'ADMIN'] : ['ADMIN'] }
function requiresCapability(commandType: CommandType): boolean { return commandType === 'feedback:reconcile' || commandType === 'feedback:delete' || commandType === 'feedback:purge' || commandType === 'feedback:repair' }
function metadata(commandType: CommandType): CommandDefinitionMetadata<ErrorCode> & Readonly<{ mode: 'MUTATION' }> {
  const inputField = field(commandType)
  const hasBody = commandType === 'feedback:saveDraft' || commandType === 'feedback:submit'
  return {
    mode: 'MUTATION',
    executionMode: 'ASYNC',
    allowedSources: ['IPC'],
    actorPolicy: { kind: 'ACTIVE_USER', roles: roles(commandType) },
    targetResolver: { owner: commandType, kind: 'CREATE_FROM_VALIDATED_REFERENCES', locatorFields: ['feedback_id', 'revision_no'], authoritativeFields: ['sender-bound auth_session', 'vault proof', ...(requiresCapability(commandType) ? ['signed feedback capability'] : [])], canonicalTargetFields: ['aggregate_type', 'feedback_id', 'revision_no'], clientHintFields: [], notFoundMapping: 'FEEDBACK_RECONCILE_REQUIRED', mismatchMapping: 'PREVIEW_SCOPE_INVALID', testReferences: ['src/main/application/command/__tests__/preview-feedback-command.test.ts'] },
    payloadContract: `preview.${commandType.replace(':', '.')}.v1`,
    sideEffects: ['PREVIEW_FEEDBACK_EVENT', 'PREVIEW_FEEDBACK_REFERENCE_OR_VAULT'],
    phase: 'PREVIEW_FEEDBACK',
    transactionOwner: 'preview-feedback-projector',
    retryPolicy: 'REPLAY_SAFE',
    durableCommand: {
      requestHash: {
        schemaVersion: 'command-request-hash-v1',
        secretFields: hasBody ? [`${inputField}.body`] : [],
        secretIdentityFields: hasBody ? [`${inputField}.feedback_id`] : []
      },
      resultSchemaVersion: 'command-result-v1',
      resultRecipeVersion: PREVIEW_FEEDBACK_RESULT_RECIPE_VERSIONS[commandType],
      prePonrRetryPolicy: 'RETRYABLE_SYSTEM_FAILURE',
      maxAttempts: 3
    },
    concurrencyPolicy: { kind: 'FAIL_FAST_ACTIVE_KEY', keyOwner: commandType },
    publicErrorCodes: ERRORS,
    preflightErrorMap: createPreflightErrorMap('PREVIEW_CONTRACT_MIGRATION_REQUIRED', { INVALID_PAYLOAD: 'VALIDATION_ERROR', INVALID_ACTOR: 'FORBIDDEN', TARGET_MISMATCH: 'PREVIEW_SCOPE_INVALID', TARGET_NOT_FOUND: 'FEEDBACK_RECONCILE_REQUIRED' }),
    testReferences: ['src/main/application/command/__tests__/preview-feedback-command.test.ts']
  }
}
function definition(commandType: CommandType, dependencies: PreviewFeedbackCommandDefinitionDependencies): MutationCommandDefinition<unknown, Input, Readonly<Record<string, CanonicalJsonValue>>, ErrorCode> { const inputField = field(commandType); return { commandType, metadata: metadata(commandType), validateStructure(rawInput) { const candidate = canonicalizeCommandRecord(rawInput, '$.input'); const keys = Object.keys(candidate); if (keys.length !== 1 || keys[0] !== inputField) throw new CommandPreflightError('INVALID_PAYLOAD', inputField); if (typeof candidate[inputField] !== 'object' || candidate[inputField] === null || Array.isArray(candidate[inputField])) throw new CommandPreflightError('INVALID_PAYLOAD', inputField); return Object.freeze({ candidate: Object.freeze(candidate), field: inputField }) }, resolveActor(context: CommandTransportContext) { const caller = resolveTrustedCallerSnapshot(dependencies.db, dependencies.eventForTransport(context.transportId).sender.id); if (!caller.success || !roles(commandType).includes(caller.role as never)) throw new CommandPreflightError('INVALID_ACTOR'); return { kind: 'USER', userId: caller.userId, role: caller.role, authSessionId: caller.authSessionId } as CommandActor }, normalizeBusinessInput(_context, actor, input) { if (actor.kind !== 'USER') throw new CommandPreflightError('INVALID_ACTOR'); return { [inputField]: input.candidate[inputField] } }, resolveTarget(_context, _actor, input) { const value = input.candidate[inputField] as Record<string, unknown>; const feedbackId = value.feedback_id; const revisionNo = value.revision_no; if (typeof feedbackId !== 'string' || typeof revisionNo !== 'number') throw new CommandPreflightError('INVALID_PAYLOAD', 'feedback target'); return { aggregate_type: 'PREVIEW_FEEDBACK', feedback_id: feedbackId, revision_no: revisionNo } }, canonicalPayload(_context, _actor, _target, input) { return { [inputField]: input.candidate[inputField] } }, concurrencyKey(envelope: CommandEnvelope) { return `PREVIEW_FEEDBACK:${String(envelope.target.feedback_id)}:${String(envelope.target.revision_no)}` }, execute() { return { success: false, errorCode: 'PREVIEW_CONTRACT_MIGRATION_REQUIRED' } }, mapUnexpectedExecutionError() { return { success: false, errorCode: 'PREVIEW_CONTRACT_MIGRATION_REQUIRED' } } } }
export function createPreviewFeedbackCommandDefinitions(dependencies: PreviewFeedbackCommandDefinitionDependencies): readonly MutationCommandDefinition<unknown, Input, Readonly<Record<string, CanonicalJsonValue>>, ErrorCode>[] { return Object.freeze(PREVIEW_FEEDBACK_COMMAND_TYPES.map((commandType) => definition(commandType, dependencies))) }
