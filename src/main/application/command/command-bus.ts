import {
  assertNoTrustedEnvelopeOverrides,
  canonicalizeCommandRecord,
  createCommandEnvelopeFactory
} from './command-envelope'
import { CommandObservability } from './command-observability'
import { CommandRegistry } from './command-registry'
import {
  CommandPreflightError,
  type AcceptedCommandContext,
  type AnyMutationCommandDefinition,
  type CommandActor,
  type CommandDispatchOutcome,
  type CommandEnvelope,
  type CommandPreflightReason,
  type DispatchCommandRequest,
  type MutationCommandDefinition,
  type PublicCommandFailure
} from './command-types'

export interface CommandBusOptions {
  readonly registry: CommandRegistry
  readonly envelopeFactory?: ReturnType<typeof createCommandEnvelopeFactory>
  readonly observability?: CommandObservability
  readonly unknownCommandPublicErrorCode?: string
  readonly readinessGate?: () => boolean
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return value !== null && (typeof value === 'object' || typeof value === 'function') && typeof (value as PromiseLike<unknown>).then === 'function'
}

function assertActorPolicy(actor: CommandActor, definition: AnyMutationCommandDefinition): void {
  const policy = definition.metadata.actorPolicy
  if (policy.kind === 'ACTIVE_USER') {
    if (actor.kind !== 'USER' || !policy.roles.includes(actor.role)) throw new CommandPreflightError('INVALID_ACTOR')
    return
  }
  if (policy.kind === 'SYSTEM') {
    if (actor.kind !== 'SYSTEM' || !policy.phases.includes(actor.phase)) throw new CommandPreflightError('INVALID_ACTOR')
    return
  }
  if (actor.kind !== 'UNAUTHENTICATED') throw new CommandPreflightError('INVALID_ACTOR')
}

function acceptedContext(
  envelope: CommandEnvelope,
  transport: DispatchCommandRequest<unknown>['transport']
): AcceptedCommandContext {
  return Object.freeze({ envelope, transport: Object.freeze({ ...transport }) }) as AcceptedCommandContext
}

function publicFailure<ErrorCode extends string>(errorCode: ErrorCode): PublicCommandFailure<ErrorCode> {
  return Object.freeze({ success: false, errorCode })
}

function runPreflight<T>(operation: () => T, fallbackReason: CommandPreflightReason): T {
  try {
    return operation()
  } catch (error) {
    if (error instanceof CommandPreflightError) throw error
    throw new CommandPreflightError(fallbackReason)
  }
}

export class ActiveCommandKeyGuard {
  private readonly activeKeys = new Set<string>()

  acquire(key: string): boolean {
    if (!key.trim()) throw new Error('concurrency key must be non-empty')
    if (this.activeKeys.has(key)) return false
    this.activeKeys.add(key)
    return true
  }

  release(key: string): void {
    this.activeKeys.delete(key)
  }

  has(key: string): boolean {
    return this.activeKeys.has(key)
  }

  size(): number {
    return this.activeKeys.size
  }
}

export class CommandBus {
  private ready = false
  private readonly registry: CommandRegistry
  private readonly envelopeFactory: ReturnType<typeof createCommandEnvelopeFactory>
  private readonly observability: CommandObservability
  private readonly unknownCommandPublicErrorCode: string
  private readonly readinessGate: () => boolean
  readonly activeKeyGuard = new ActiveCommandKeyGuard()

  constructor(options: CommandBusOptions) {
    this.registry = options.registry
    this.envelopeFactory = options.envelopeFactory ?? createCommandEnvelopeFactory()
    this.observability = options.observability ?? new CommandObservability()
    this.unknownCommandPublicErrorCode = options.unknownCommandPublicErrorCode ?? 'SYSTEM_ERROR'
    this.readinessGate = options.readinessGate ?? (() => true)
  }

  open(): void {
    if (!this.registry.isSealed()) throw new Error('cannot open command boundary before registry is sealed')
    this.ready = true
  }

  close(): void {
    this.ready = false
  }

  isReady(): boolean {
    return this.ready
  }

  async dispatch<RawInput, Result, ErrorCode extends string>(
    request: DispatchCommandRequest<RawInput>
  ): Promise<CommandDispatchOutcome<Result, ErrorCode>> {
    const startedAt = this.observability.start()
    let acceptedBoundaryCrossed = false
    const registered = this.registry.get(request.commandType)
    if (!registered || registered.metadata.mode !== 'MUTATION') {
      return this.rejectUnknown<RawInput, Result, ErrorCode>(request, startedAt)
    }
    const definition = registered as unknown as MutationCommandDefinition<RawInput, unknown, Result, ErrorCode>

    try {
      if (!this.ready || !this.readinessGate()) throw new CommandPreflightError('BOUNDARY_NOT_READY')
      if (!definition.metadata.allowedSources.includes(request.transport.source)) throw new CommandPreflightError('SOURCE_NOT_ALLOWED')
      const input = runPreflight(() => {
        assertNoTrustedEnvelopeOverrides(request.rawInput)
        return definition.validateStructure(request.rawInput)
      }, 'INVALID_PAYLOAD')
      const actor = await definition.resolveActor(request.transport, input)
      assertActorPolicy(actor, definition as unknown as AnyMutationCommandDefinition)
      const target = canonicalizeCommandRecord(
        await definition.resolveTarget(request.transport, actor, input),
        '$.target'
      )
      const envelope = runPreflight(() => {
        const payload = definition.canonicalPayload(request.transport, actor, target, input)
        return this.envelopeFactory({
          commandType: definition.commandType,
          source: request.transport.source,
          actor,
          target,
          payload,
          parentCorrelationId: request.transport.parentCorrelationId
        })
      }, 'INVALID_PAYLOAD')
      const key = definition.concurrencyKey(envelope)
      const guarded = definition.metadata.concurrencyPolicy.kind === 'FAIL_FAST_ACTIVE_KEY'
      if (guarded && !this.activeKeyGuard.acquire(key)) throw new CommandPreflightError('ACTIVE_KEY_CONFLICT')
      acceptedBoundaryCrossed = true

      try {
        this.observability.accepted(envelope, key)
        try {
          const result = await definition.execute(acceptedContext(envelope, request.transport))
          this.observability.completed(envelope, startedAt)
          return Object.freeze({ status: 'COMPLETED', envelope, result })
        } catch (error) {
          const result = definition.mapUnexpectedExecutionError(error, envelope)
          this.observability.executionFailed(envelope, error, startedAt)
          return Object.freeze({ status: 'EXECUTION_FAILED', envelope, result })
        }
      } finally {
        if (guarded) this.activeKeyGuard.release(key)
      }
    } catch (error) {
      if (acceptedBoundaryCrossed) throw error
      const failure = this.preflightFailure(error)
      return this.reject(definition, request, failure.reason, failure.safeDetail, startedAt)
    }
  }

  dispatchSync<RawInput, Result, ErrorCode extends string>(
    request: DispatchCommandRequest<RawInput>
  ): CommandDispatchOutcome<Result, ErrorCode> {
    const startedAt = this.observability.start()
    let acceptedBoundaryCrossed = false
    const registered = this.registry.get(request.commandType)
    if (!registered || registered.metadata.mode !== 'MUTATION') {
      return this.rejectUnknown<RawInput, Result, ErrorCode>(request, startedAt)
    }
    const definition = registered as unknown as MutationCommandDefinition<RawInput, unknown, Result, ErrorCode>

    try {
      if (!this.ready || !this.readinessGate()) throw new CommandPreflightError('BOUNDARY_NOT_READY')
      if (definition.metadata.executionMode !== 'SYNC') throw new CommandPreflightError('INTERNAL_PREFLIGHT_FAILURE')
      if (!definition.metadata.allowedSources.includes(request.transport.source)) throw new CommandPreflightError('SOURCE_NOT_ALLOWED')
      const input = runPreflight(() => {
        assertNoTrustedEnvelopeOverrides(request.rawInput)
        return definition.validateStructure(request.rawInput)
      }, 'INVALID_PAYLOAD')
      const actorResult = definition.resolveActor(request.transport, input)
      if (isPromiseLike(actorResult)) throw new CommandPreflightError('INTERNAL_PREFLIGHT_FAILURE')
      const actor = actorResult
      assertActorPolicy(actor, definition as unknown as AnyMutationCommandDefinition)
      const targetResult = definition.resolveTarget(request.transport, actor, input)
      if (isPromiseLike(targetResult)) throw new CommandPreflightError('INTERNAL_PREFLIGHT_FAILURE')
      const target = canonicalizeCommandRecord(targetResult, '$.target')
      const envelope = runPreflight(() => {
        const payload = definition.canonicalPayload(request.transport, actor, target, input)
        return this.envelopeFactory({
          commandType: definition.commandType,
          source: request.transport.source,
          actor,
          target,
          payload,
          parentCorrelationId: request.transport.parentCorrelationId
        })
      }, 'INVALID_PAYLOAD')
      const key = definition.concurrencyKey(envelope)
      const guarded = definition.metadata.concurrencyPolicy.kind === 'FAIL_FAST_ACTIVE_KEY'
      if (guarded && !this.activeKeyGuard.acquire(key)) throw new CommandPreflightError('ACTIVE_KEY_CONFLICT')
      acceptedBoundaryCrossed = true

      try {
        this.observability.accepted(envelope, key)
        try {
          const result = definition.execute(acceptedContext(envelope, request.transport))
          if (isPromiseLike(result)) throw new Error('SYNC command returned a Promise')
          this.observability.completed(envelope, startedAt)
          return Object.freeze({ status: 'COMPLETED', envelope, result })
        } catch (error) {
          const result = definition.mapUnexpectedExecutionError(error, envelope)
          this.observability.executionFailed(envelope, error, startedAt)
          return Object.freeze({ status: 'EXECUTION_FAILED', envelope, result })
        }
      } finally {
        if (guarded) this.activeKeyGuard.release(key)
      }
    } catch (error) {
      if (acceptedBoundaryCrossed) throw error
      const failure = this.preflightFailure(error)
      return this.reject(definition, request, failure.reason, failure.safeDetail, startedAt)
    }
  }

  private preflightFailure(error: unknown): {
    reason: CommandPreflightReason
    safeDetail?: string
  } {
    if (error instanceof CommandPreflightError) {
      return { reason: error.reason, safeDetail: error.safeDetail }
    }
    return { reason: 'INTERNAL_PREFLIGHT_FAILURE' }
  }

  private reject<RawInput, Result, ErrorCode extends string>(
    definition: MutationCommandDefinition<RawInput, unknown, Result, ErrorCode>,
    request: DispatchCommandRequest<RawInput>,
    reason: CommandPreflightReason,
    safeDetail: string | undefined,
    startedAt: number
  ): CommandDispatchOutcome<Result, ErrorCode> {
    const errorCode = safeDetail === undefined
      ? definition.metadata.preflightErrorMap[reason]
      : definition.metadata.preflightErrorDetailMap?.[reason]?.[safeDetail]
        ?? definition.metadata.preflightErrorMap[reason]
    this.observability.rejected({
      commandType: request.commandType,
      source: request.transport.source,
      reason,
      publicErrorCode: errorCode,
      startedAt
    })
    return Object.freeze({ status: 'REJECTED', reason, publicError: publicFailure(errorCode) })
  }

  private rejectUnknown<RawInput, Result, ErrorCode extends string>(
    request: DispatchCommandRequest<RawInput>,
    startedAt: number
  ): CommandDispatchOutcome<Result, ErrorCode> {
    const errorCode = this.unknownCommandPublicErrorCode as ErrorCode
    this.observability.rejected({
      commandType: request.commandType,
      source: request.transport.source,
      reason: 'UNKNOWN_COMMAND',
      publicErrorCode: errorCode,
      startedAt
    })
    return Object.freeze({ status: 'REJECTED', reason: 'UNKNOWN_COMMAND', publicError: publicFailure(errorCode) })
  }
}
