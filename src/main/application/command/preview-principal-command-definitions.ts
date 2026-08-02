import type { IpcMainInvokeEvent } from 'electron'
import type { DBAdapter } from '../../db/interface'
import type { CanonicalJsonValue } from '../../domain/event-batch/canonical-json'
import { canonicalizeCommandRecord } from './command-envelope'
import {
  createPreflightErrorMap,
  type PublicCommandErrorCode
} from './public-error-contract'
import {
  CommandPreflightError,
  type CommandActor,
  type CommandDefinitionMetadata,
  type CommandEnvelope,
  type CommandTransportContext,
  type MutationCommandDefinition
} from './command-types'
import { resolveTrustedCallerSnapshot } from '../../utils/auth-session'
import {
  PRINCIPAL_BINDING_RESULT_RECIPE_VERSIONS
} from '../../domain/projectors/principal-binding-projector'

export const PREVIEW_PRINCIPAL_COMMAND_TYPES = Object.freeze([
  'preview:enrollPrincipal',
  'preview:rotatePrincipal'
] as const)

export interface PreviewPrincipalCommandDefinitionDependencies {
  readonly db: DBAdapter
  readonly eventForTransport: (transportId: string) => IpcMainInvokeEvent
}

interface PreviewPrincipalInput {
  readonly candidate: Readonly<Record<string, CanonicalJsonValue>>
  readonly packageField: 'enrollmentPackage' | 'rotationPackage'
}

const PREVIEW_PRINCIPAL_ERRORS = [
  'PREVIEW_CONTRACT_MIGRATION_REQUIRED',
  'INSTALLATION_TRUST_UNAVAILABLE',
  'INSTALLATION_IDENTITY_INVALID',
  'AUTHORITY_REGISTRY_INVALID',
  'PRINCIPAL_ENROLLMENT_REQUIRED',
  'PRINCIPAL_ENROLLMENT_INVALID',
  'PRINCIPAL_ROTATION_INVALID',
  'PRINCIPAL_MAPPING_OVERLAP',
  'PREVIEW_IDEMPOTENCY_CONFLICT',
  'PREVIEW_SCOPE_INVALID',
  'PRINCIPAL_SEPARATION_OF_DUTIES_FAILED',
  'FORBIDDEN',
  'VALIDATION_ERROR',
  'SYSTEM_ERROR'
] as const satisfies readonly PublicCommandErrorCode[]

type PreviewPrincipalErrorCode = (typeof PREVIEW_PRINCIPAL_ERRORS)[number]

function packageField(commandType: string): 'enrollmentPackage' | 'rotationPackage' {
  return commandType === 'preview:enrollPrincipal' ? 'enrollmentPackage' : 'rotationPackage'
}

function targetFromPackage(input: PreviewPrincipalInput): Record<string, unknown> {
  const packageValue = input.candidate[input.packageField]
  if (typeof packageValue !== 'object' || packageValue === null || Array.isArray(packageValue)) {
    throw new CommandPreflightError('INVALID_PAYLOAD', input.packageField)
  }
  const payload = (packageValue as Record<string, unknown>).payload
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new CommandPreflightError('INVALID_PAYLOAD', `${input.packageField}.payload`)
  }
  const signedPayload = payload as Record<string, unknown>
  const binding = input.packageField === 'enrollmentPackage'
    ? signedPayload.enrollment
    : signedPayload
  if (typeof binding !== 'object' || binding === null || Array.isArray(binding)) {
    throw new CommandPreflightError('INVALID_PAYLOAD', `${input.packageField}.payload.binding`)
  }
  const bindingRecord = binding as Record<string, unknown>
  const installationId = input.packageField === 'enrollmentPackage'
    ? signedPayload.target_installation_id
    : signedPayload.target_installation_id
  const organizationId = input.packageField === 'enrollmentPackage'
    ? signedPayload.organization_id
    : signedPayload.organization_id
  if (typeof installationId !== 'string' || typeof organizationId !== 'string') {
    throw new CommandPreflightError('INVALID_PAYLOAD', `${input.packageField}.payload.scope`)
  }
  const mappingId = input.packageField === 'enrollmentPackage'
    ? bindingRecord.mapping_id
    : bindingRecord.old_mapping_id
  if (typeof mappingId !== 'string' || !mappingId.trim()) throw new CommandPreflightError('INVALID_PAYLOAD', 'mapping_id')
  return {
    aggregate_type: 'PRINCIPAL_BINDING',
    target_installation_id: installationId,
    organization_id: organizationId,
    mapping_id: mappingId
  }
}

function metadata(
  commandType: string,
  testReferences: readonly string[]
): CommandDefinitionMetadata<PreviewPrincipalErrorCode> & Readonly<{ mode: 'MUTATION' }> {
  const defaultError = 'PREVIEW_CONTRACT_MIGRATION_REQUIRED' as const
  return {
    mode: 'MUTATION',
    executionMode: 'ASYNC',
    allowedSources: ['IPC'],
    actorPolicy: { kind: 'ACTIVE_USER', roles: ['ADMIN'] },
    targetResolver: {
      owner: commandType,
      kind: 'CREATE_FROM_VALIDATED_REFERENCES',
      locatorFields: ['signed package'],
      authoritativeFields: ['sender-bound auth_session', 'signed provisioning package', 'bootstrap trust scope'],
      canonicalTargetFields: ['aggregate_type', 'target_installation_id', 'organization_id', 'mapping_id'],
      clientHintFields: [],
      notFoundMapping: defaultError,
      mismatchMapping: 'PREVIEW_SCOPE_INVALID',
      testReferences
    },
    payloadContract: `preview.principal.${commandType === 'preview:enrollPrincipal' ? 'enrollment' : 'rotation'}.v1`,
    sideEffects: ['PREVIEW_PRINCIPAL_BINDING_EVENT', 'PREVIEW_PRINCIPAL_BINDING_PROJECTION'],
    phase: 'PREVIEW_PRINCIPAL_PROVISIONING',
    transactionOwner: 'preview-principal-binding-service',
    retryPolicy: 'REPLAY_SAFE',
    durableCommand: {
      requestHash: {
        schemaVersion: 'command-request-hash-v1',
        secretFields: [],
        secretIdentityFields: []
      },
      resultSchemaVersion: 'command-result-v1',
      resultRecipeVersion: PRINCIPAL_BINDING_RESULT_RECIPE_VERSIONS[commandType as keyof typeof PRINCIPAL_BINDING_RESULT_RECIPE_VERSIONS],
      prePonrRetryPolicy: 'RETRYABLE_SYSTEM_FAILURE',
      maxAttempts: 3
    },
    concurrencyPolicy: { kind: 'FAIL_FAST_ACTIVE_KEY', keyOwner: `preview-principal:${commandType}` },
    publicErrorCodes: PREVIEW_PRINCIPAL_ERRORS,
    preflightErrorMap: createPreflightErrorMap(defaultError, {
      INVALID_PAYLOAD: 'VALIDATION_ERROR',
      INVALID_ACTOR: 'FORBIDDEN',
      TARGET_MISMATCH: 'PREVIEW_SCOPE_INVALID',
      TARGET_NOT_FOUND: 'PREVIEW_CONTRACT_MIGRATION_REQUIRED'
    }),
    testReferences
  }
}

function definition(
  commandType: 'preview:enrollPrincipal' | 'preview:rotatePrincipal',
  dependencies: PreviewPrincipalCommandDefinitionDependencies
): MutationCommandDefinition<unknown, PreviewPrincipalInput, Readonly<Record<string, CanonicalJsonValue>>, PreviewPrincipalErrorCode> {
  const field = packageField(commandType)
  const testReferences = [
    'src/main/application/command/__tests__/preview-principal-command.test.ts',
    'src/main/domain/event-batch/__tests__/preview-principal-recovery.test.ts'
  ] as const
  return {
    commandType,
    metadata: metadata(commandType, testReferences),
    validateStructure(rawInput) {
      const candidate = canonicalizeCommandRecord(rawInput, '$.input')
      const keys = Object.keys(candidate)
      if (keys.length !== 1 || keys[0] !== field) throw new CommandPreflightError('INVALID_PAYLOAD', field)
      const packageValue = candidate[field]
      if (typeof packageValue !== 'object' || packageValue === null || Array.isArray(packageValue)) {
        throw new CommandPreflightError('INVALID_PAYLOAD', field)
      }
      return Object.freeze({ candidate: Object.freeze(candidate), packageField: field })
    },
    resolveActor(context: CommandTransportContext): CommandActor {
      const event = dependencies.eventForTransport(context.transportId)
      const caller = resolveTrustedCallerSnapshot(dependencies.db, event.sender.id)
      if (!caller.success || caller.role !== 'ADMIN') throw new CommandPreflightError('INVALID_ACTOR')
      return {
        kind: 'USER',
        userId: caller.userId,
        role: caller.role,
        authSessionId: caller.authSessionId
      }
    },
    normalizeBusinessInput(context, actor, input) {
      if (context.source !== 'IPC' || actor.kind === 'UNAUTHENTICATED') {
        throw new CommandPreflightError('INVALID_ACTOR')
      }
      return { [field]: input.candidate[field] }
    },
    resolveTarget(_context, _actor, input) {
      return targetFromPackage(input)
    },
    canonicalPayload(_context, _actor, _target, input) {
      return { [field]: input.candidate[field] }
    },
    concurrencyKey(envelope: CommandEnvelope): string {
      return `PREVIEW_PRINCIPAL:${String(envelope.target.target_installation_id)}:${String(envelope.target.organization_id)}:${String(envelope.target.mapping_id)}`
    },
    execute() {
      return { success: false, errorCode: 'PREVIEW_CONTRACT_MIGRATION_REQUIRED' } as never
    },
    mapUnexpectedExecutionError() {
      return { success: false, errorCode: 'PREVIEW_CONTRACT_MIGRATION_REQUIRED' }
    }
  }
}

export function createPreviewPrincipalCommandDefinitions(
  dependencies: PreviewPrincipalCommandDefinitionDependencies
): readonly MutationCommandDefinition<unknown, PreviewPrincipalInput, Readonly<Record<string, CanonicalJsonValue>>, PreviewPrincipalErrorCode>[] {
  return Object.freeze([
    definition('preview:enrollPrincipal', dependencies),
    definition('preview:rotatePrincipal', dependencies)
  ])
}
