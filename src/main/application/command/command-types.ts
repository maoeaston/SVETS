import type { CanonicalJsonValue } from '../../domain/report-canonical'

export type CommandSource = 'IPC' | 'INTERNAL'
export type CommandMode = 'READ' | 'MUTATION'
export type CommandExecutionMode = 'SYNC' | 'ASYNC'
export type UserCommandRole = 'STUDENT' | 'TEACHER' | 'ADMIN'

export type CommandActor =
  | Readonly<{
      kind: 'USER'
      userId: string
      role: UserCommandRole
      authSessionId: string
    }>
  | Readonly<{
      kind: 'SYSTEM'
      phase: string
    }>
  | Readonly<{
      kind: 'UNAUTHENTICATED'
    }>

export type CommandActorPolicy =
  | Readonly<{ kind: 'ACTIVE_USER'; roles: readonly UserCommandRole[] }>
  | Readonly<{ kind: 'SYSTEM'; phases: readonly string[] }>
  | Readonly<{ kind: 'BOOTSTRAP' }>

export type CommandTargetResolverKind =
  | 'EXISTING_AGGREGATE'
  | 'CREATE_FROM_VALIDATED_REFERENCES'
  | 'ACTOR_SCOPED'
  | 'STATIC_CONTEXT'

export type CommandRetryPolicy = 'NO_AUTO_RETRY' | 'REPLAY_SAFE' | 'MANUAL_REVIEW'

export interface DurableCommandContract {
  readonly requestHash: Readonly<{
    schemaVersion: 'command-request-hash-v1'
    secretFields: readonly string[]
    secretIdentityFields: readonly string[]
  }>
  readonly resultSchemaVersion: 'command-result-v1'
  readonly resultRecipeVersion: string
  readonly prePonrRetryPolicy: 'RETRYABLE_SYSTEM_FAILURE'
  readonly maxAttempts: 3
}

export type CommandConcurrencyPolicy =
  | Readonly<{
      kind: 'FAIL_FAST_ACTIVE_KEY'
      keyOwner: string
    }>
  | Readonly<{
      kind: 'EXISTING_SERIALIZER'
      serializerOwner: string
    }>
  | Readonly<{
      kind: 'NONE_READ_ONLY'
    }>

export const COMMAND_PREFLIGHT_REASONS = [
  'UNKNOWN_COMMAND',
  'BOUNDARY_NOT_READY',
  'SOURCE_NOT_ALLOWED',
  'INVALID_PAYLOAD',
  'INVALID_ACTOR',
  'TARGET_NOT_FOUND',
  'TARGET_MISMATCH',
  'ACTIVE_KEY_CONFLICT',
  'INTERNAL_PREFLIGHT_FAILURE'
] as const

export type CommandPreflightReason = (typeof COMMAND_PREFLIGHT_REASONS)[number]

export class CommandPreflightError extends Error {
  constructor(
    public readonly reason: CommandPreflightReason,
    public readonly safeDetail?: string
  ) {
    super(reason)
    this.name = 'CommandPreflightError'
  }
}

export interface CommandEnvelope {
  readonly commandId: string
  readonly commandType: string
  readonly source: CommandSource
  readonly actor: CommandActor
  readonly target: Readonly<Record<string, CanonicalJsonValue>>
  readonly payload: Readonly<Record<string, CanonicalJsonValue>>
  readonly requestHash: string
  readonly createdAt: string
  readonly correlationId: string
}

export interface CommandEnvelopeV2 extends CommandEnvelope {
  readonly envelopeVersion: 'v2'
  readonly clientInstanceId: string
  readonly idempotencyKey: string
  readonly eventBatchId: string
  readonly actorId: string
  readonly deviceId: string | null
  readonly authSessionId: string | null
  readonly leaseOwner: string
  readonly leaseGeneration: number
}

declare const acceptedCommandBrand: unique symbol

export interface AcceptedCommandContext {
  readonly envelope: CommandEnvelope
  readonly transport: CommandTransportContext
  readonly [acceptedCommandBrand]: true
}

export interface CommandTransportContext {
  readonly source: CommandSource
  readonly transportId: string
  readonly parentCorrelationId?: string
}

export interface CommandTargetResolverContract {
  readonly owner: string
  readonly kind: CommandTargetResolverKind
  readonly locatorFields: readonly string[]
  readonly authoritativeFields: readonly string[]
  readonly canonicalTargetFields: readonly string[]
  readonly clientHintFields: readonly string[]
  readonly notFoundMapping: string
  readonly mismatchMapping: string
  readonly testReferences: readonly string[]
}

export type PublicCommandFailure<ErrorCode extends string> = Readonly<{
  success: false
  errorCode: ErrorCode
}>

export type PreflightErrorMap<ErrorCode extends string> = Readonly<Record<CommandPreflightReason, ErrorCode>>

export type PreflightErrorDetailMap<ErrorCode extends string> = Readonly<
  Partial<Record<CommandPreflightReason, Readonly<Record<string, ErrorCode>>>>
>

export interface CommandDefinitionMetadata<ErrorCode extends string> {
  readonly mode: CommandMode
  readonly executionMode: CommandExecutionMode
  readonly allowedSources: readonly CommandSource[]
  readonly actorPolicy: CommandActorPolicy
  readonly targetResolver: CommandTargetResolverContract
  readonly payloadContract: string
  readonly sideEffects: readonly string[]
  readonly phase: string
  readonly transactionOwner: string
  readonly retryPolicy: CommandRetryPolicy
  readonly durableCommand?: DurableCommandContract
  readonly concurrencyPolicy: CommandConcurrencyPolicy
  readonly publicErrorCodes: readonly ErrorCode[]
  readonly preflightErrorMap: PreflightErrorMap<ErrorCode>
  readonly preflightErrorDetailMap?: PreflightErrorDetailMap<ErrorCode>
  readonly testReferences: readonly string[]
}

export interface MutationCommandDefinition<
  RawInput,
  ValidatedInput,
  Result,
  ErrorCode extends string
> {
  readonly commandType: string
  readonly metadata: CommandDefinitionMetadata<ErrorCode> & Readonly<{ mode: 'MUTATION' }>
  validateStructure(rawInput: RawInput): ValidatedInput
  resolveActor(context: CommandTransportContext, input: ValidatedInput): CommandActor | Promise<CommandActor>
  normalizeBusinessInput?(
    context: CommandTransportContext,
    actor: CommandActor,
    input: ValidatedInput
  ): Record<string, unknown>
  resolveTarget(
    context: CommandTransportContext,
    actor: CommandActor,
    input: ValidatedInput
  ): Record<string, unknown> | Promise<Record<string, unknown>>
  canonicalPayload(
    context: CommandTransportContext,
    actor: CommandActor,
    target: Readonly<Record<string, CanonicalJsonValue>>,
    input: ValidatedInput
  ): Record<string, unknown>
  concurrencyKey(envelope: CommandEnvelope): string
  execute(context: AcceptedCommandContext): Result | Promise<Result>
  mapUnexpectedExecutionError(error: unknown, envelope: CommandEnvelope): Result
}

export interface ReadCommandDefinition<ErrorCode extends string = string> {
  readonly commandType: string
  readonly metadata: CommandDefinitionMetadata<ErrorCode> & Readonly<{ mode: 'READ' }>
}

export type AnyMutationCommandDefinition = MutationCommandDefinition<unknown, unknown, unknown, string>
export type AnyCommandDefinition = AnyMutationCommandDefinition | ReadCommandDefinition

export type CommandDispatchOutcome<Result, ErrorCode extends string> =
  | Readonly<{
      status: 'COMPLETED'
      envelope: CommandEnvelope
      result: Result
    }>
  | Readonly<{
      status: 'EXECUTION_FAILED'
      envelope: CommandEnvelope
      result: Result
    }>
  | Readonly<{
      status: 'REJECTED'
      reason: CommandPreflightReason
      publicError: PublicCommandFailure<ErrorCode>
    }>

export interface DispatchCommandRequest<RawInput> {
  readonly commandType: string
  readonly rawInput: RawInput
  readonly transport: CommandTransportContext
}

export interface CommandTraceRecord {
  readonly phase: 'REJECTED' | 'ACCEPTED' | 'COMPLETED' | 'EXECUTION_FAILED'
  readonly commandType: string
  readonly source: CommandSource
  readonly commandId?: string
  readonly correlationId?: string
  readonly actorRef?: string
  readonly targetDigest?: string
  readonly requestHashPrefix?: string
  readonly concurrencyKeyDigest?: string
  readonly reason?: CommandPreflightReason
  readonly publicErrorCode?: string
  readonly durationMs?: number
  readonly errorName?: string
}

export interface CommandTraceSink {
  emit(record: CommandTraceRecord): void
}
