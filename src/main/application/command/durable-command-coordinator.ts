import { v4 as uuidv4 } from 'uuid'
import type { CanonicalJsonValue } from '../../domain/event-batch/canonical-json'
import {
  validateTransportMetadataV1,
  type TransportMetadataV1
} from '../../../shared/types/command-transport'
import {
  assertNoTrustedEnvelopeOverrides,
  buildCommandEnvelopeV2,
  canonicalizeCommandRecord
} from './command-envelope'
import { createCommandRequestHash } from './command-request-hash'
import { createCommandResultJson, parseCommandResultJson } from './command-result'
import { CommandRegistry } from './command-registry'
import {
  COMMAND_MAX_ATTEMPTS,
  DurableCommandStore,
  DurableCommandStoreError,
  type DurableCommandRow
} from './durable-command-store'
import {
  CommandPreflightError,
  type AnyMutationCommandDefinition,
  type CommandActor,
  type CommandEnvelopeV2,
  type CommandTransportContext,
  type DurableCommandContract,
  type MutationCommandDefinition
} from './command-types'

export class DurableCommandCoordinatorError extends Error {
  constructor(
    public readonly code:
      | 'UNKNOWN_COMMAND'
      | 'INVALID_TRANSPORT'
      | 'INVALID_PAYLOAD'
      | 'INVALID_ACTOR'
      | 'REGISTRY_INCOMPLETE'
      | 'IDEMPOTENCY_CONFLICT'
      | 'LEASE_ACTIVE'
      | 'LEASE_RACE'
      | 'ATTEMPT_LIMIT'
      | 'FENCED',
    message: string
  ) {
    super(`[durable-command] ${message}`)
    this.name = 'DurableCommandCoordinatorError'
  }
}

export interface DurableCommandAccepted<ValidatedInput> {
  readonly status: 'ACCEPTED'
  readonly row: DurableCommandRow
  readonly envelope: CommandEnvelopeV2
  readonly validatedInput: ValidatedInput
  readonly transportMetadata: Readonly<TransportMetadataV1>
}

export interface DurableCommandReplayed {
  readonly status: 'REPLAYED'
  readonly row: DurableCommandRow
  readonly publicResult: Readonly<Record<string, CanonicalJsonValue>>
}

export type DurableCommandAcceptance<ValidatedInput> =
  | DurableCommandAccepted<ValidatedInput>
  | DurableCommandReplayed

export interface DurableCommandCoordinatorDependencies {
  readonly registry: CommandRegistry
  readonly store: DurableCommandStore
  readonly workerId: string
  readonly uuid?: () => string
  readonly now?: () => Date
}

function actorIdentity(actor: CommandActor): { actorId: string; authSessionId: string | null } {
  if (actor.kind === 'USER') return { actorId: actor.userId, authSessionId: actor.authSessionId }
  if (actor.kind === 'SYSTEM') return { actorId: `SYSTEM:${actor.phase}`, authSessionId: null }
  return { actorId: 'UNAUTHENTICATED', authSessionId: null }
}

function assertActorPolicy(actor: CommandActor, definition: AnyMutationCommandDefinition): void {
  const policy = definition.metadata.actorPolicy
  if (policy.kind === 'ACTIVE_USER') {
    if (actor.kind !== 'USER' || !policy.roles.includes(actor.role)) {
      throw new DurableCommandCoordinatorError('INVALID_ACTOR', 'resolved actor does not satisfy ACTIVE_USER policy')
    }
    return
  }
  if (policy.kind === 'SYSTEM') {
    if (actor.kind !== 'SYSTEM' || !policy.phases.includes(actor.phase)) {
      throw new DurableCommandCoordinatorError('INVALID_ACTOR', 'resolved actor does not satisfy SYSTEM policy')
    }
    return
  }
  if (actor.kind !== 'UNAUTHENTICATED') {
    throw new DurableCommandCoordinatorError('INVALID_ACTOR', 'resolved actor does not satisfy BOOTSTRAP policy')
  }
}

function assertStableReplay(
  row: DurableCommandRow,
  expected: {
    commandType: string
    requestHash: string
    actorId: string
    deviceId: string | null
    authSessionId: string | null
  }
): void {
  if (
    row.commandType !== expected.commandType
    || row.requestHash !== expected.requestHash
    || row.actorId !== expected.actorId
    || row.deviceId !== expected.deviceId
    || row.authSessionId !== expected.authSessionId
  ) throw new DurableCommandCoordinatorError('IDEMPOTENCY_CONFLICT', 'idempotency key is bound to different stable fields')
}

function durableContract(definition: AnyMutationCommandDefinition): DurableCommandContract {
  const contract = definition.metadata.durableCommand
  if (!contract || !definition.normalizeBusinessInput) {
    throw new DurableCommandCoordinatorError('REGISTRY_INCOMPLETE', 'mutation lacks durable request/result contract')
  }
  return contract
}

function replay(row: DurableCommandRow): DurableCommandReplayed {
  if (row.status !== 'SUCCEEDED' || row.resultJson === null) {
    throw new DurableCommandCoordinatorError('LEASE_RACE', 'command is not replayable')
  }
  return Object.freeze({
    status: 'REPLAYED',
    row,
    publicResult: parseCommandResultJson(row.resultJson).public_result
  })
}

function replaySelfRevokedLogout(
  definition: MutationCommandDefinition<unknown, unknown, unknown, string>,
  request: { rawInput: unknown; transport: CommandTransportContext },
  input: unknown,
  row: DurableCommandRow
): DurableCommandReplayed | null {
  if (
    definition.commandType !== 'auth:logout'
    || row.commandType !== 'auth:logout'
    || row.status !== 'SUCCEEDED'
    || row.authSessionId === null
    || row.actorId === 'UNAUTHENTICATED'
  ) return null
  const contract = durableContract(definition as unknown as AnyMutationCommandDefinition)
  const requestHash = createCommandRequestHash({
    commandType: definition.commandType,
    normalizedBusinessInput: definition.normalizeBusinessInput!(
      request.transport,
      { kind: 'UNAUTHENTICATED' },
      input
    ),
    contract: contract.requestHash
  })
  if (row.requestHash !== requestHash) {
    throw new DurableCommandCoordinatorError('IDEMPOTENCY_CONFLICT', 'logout replay request hash changed')
  }
  return replay(row)
}

function nowIso(now: () => Date): string {
  const value = now().toISOString()
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new DurableCommandCoordinatorError('REGISTRY_INCOMPLETE', 'clock did not produce an exact UTC timestamp')
  }
  return value
}

export class DurableCommandCoordinator {
  private readonly registry: CommandRegistry
  private readonly store: DurableCommandStore
  private readonly workerId: string
  private readonly uuid: () => string
  private readonly now: () => Date

  constructor(dependencies: DurableCommandCoordinatorDependencies) {
    this.registry = dependencies.registry
    this.store = dependencies.store
    this.workerId = dependencies.workerId
    this.uuid = dependencies.uuid ?? uuidv4
    this.now = dependencies.now ?? (() => new Date())
    if (!this.workerId || this.workerId !== this.workerId.trim()) {
      throw new DurableCommandCoordinatorError('REGISTRY_INCOMPLETE', 'workerId is invalid')
    }
  }

  async accept<RawInput, ValidatedInput>(request: {
    commandType: string
    rawInput: RawInput
    transport: CommandTransportContext
    transportMetadata: unknown
  }): Promise<DurableCommandAcceptance<ValidatedInput>> {
    const registered = this.registry.get(request.commandType)
    if (!registered || registered.metadata.mode !== 'MUTATION') {
      throw new DurableCommandCoordinatorError('UNKNOWN_COMMAND', 'command is not a registered mutation')
    }
    const definition = registered as unknown as MutationCommandDefinition<RawInput, ValidatedInput, unknown, string>
    if (!definition.metadata.allowedSources.includes(request.transport.source)) {
      throw new DurableCommandCoordinatorError('INVALID_TRANSPORT', 'transport source is not allowed')
    }

    let metadata: Readonly<TransportMetadataV1>
    try {
      metadata = validateTransportMetadataV1(request.transportMetadata)
    } catch {
      throw new DurableCommandCoordinatorError('INVALID_TRANSPORT', 'transport metadata is invalid')
    }
    let input: ValidatedInput
    try {
      assertNoTrustedEnvelopeOverrides(request.rawInput)
      input = definition.validateStructure(request.rawInput)
    } catch (error) {
      if (error instanceof CommandPreflightError) throw error
      throw new DurableCommandCoordinatorError('INVALID_PAYLOAD', 'business structure is invalid')
    }

    // A logout revokes its own actor session inside the gate-only transaction.
    // The exact completed row may therefore replay without resolving that now
    // revoked actor; no other command receives this exception.
    const selfRevokedLogout = this.store.findByIdempotency(
      metadata.clientInstanceId,
      metadata.idempotencyKey
    )
    if (selfRevokedLogout) {
      const replayedLogout = replaySelfRevokedLogout(
        definition as unknown as MutationCommandDefinition<unknown, unknown, unknown, string>,
        request,
        input,
        selfRevokedLogout
      )
      if (replayedLogout) return replayedLogout as DurableCommandAcceptance<ValidatedInput>
    }

    let actor: CommandActor
    try {
      actor = await definition.resolveActor(request.transport, input)
      assertActorPolicy(actor, definition as unknown as AnyMutationCommandDefinition)
    } catch (error) {
      if (error instanceof CommandPreflightError) throw error
      if (error instanceof DurableCommandCoordinatorError) throw error
      throw new DurableCommandCoordinatorError('INVALID_ACTOR', 'actor validation failed')
    }
    const identity = actorIdentity(actor)
    const contract = durableContract(definition as unknown as AnyMutationCommandDefinition)

    let normalizedBusinessInput: Record<string, unknown>
    let requestHash: string
    try {
      normalizedBusinessInput = definition.normalizeBusinessInput!(request.transport, actor, input)
      requestHash = createCommandRequestHash({
        commandType: definition.commandType,
        normalizedBusinessInput,
        contract: contract.requestHash
      })
    } catch (error) {
      if (error instanceof CommandPreflightError) throw error
      throw new DurableCommandCoordinatorError('INVALID_PAYLOAD', 'normalized business input is invalid')
    }

    const stable = {
      commandType: definition.commandType,
      requestHash,
      actorId: identity.actorId,
      deviceId: metadata.deviceId,
      authSessionId: identity.authSessionId
    }
    let row = this.store.findByIdempotency(metadata.clientInstanceId, metadata.idempotencyKey)
    if (row) {
      assertStableReplay(row, stable)
      if (row.status === 'SUCCEEDED') return replay(row)
    }

    const observedAt = nowIso(this.now)
    if (row?.status === 'PROCESSING' && row.leaseExpiresAt !== null && row.leaseExpiresAt > observedAt) {
      throw new DurableCommandCoordinatorError('LEASE_ACTIVE', 'command has an unexpired lease')
    }
    if (row && row.attemptCount >= row.maxAttempts) {
      throw new DurableCommandCoordinatorError('ATTEMPT_LIMIT', 'command exhausted its pre-PONR attempts')
    }

    let target: Record<string, CanonicalJsonValue>
    let payload: Record<string, CanonicalJsonValue>
    try {
      target = canonicalizeCommandRecord(
        await definition.resolveTarget(request.transport, actor, input),
        '$.target'
      )
      payload = canonicalizeCommandRecord(
        definition.canonicalPayload(request.transport, actor, target, input),
        '$.payload'
      )
    } catch (error) {
      if (error instanceof CommandPreflightError) throw error
      throw new DurableCommandCoordinatorError('INVALID_PAYLOAD', 'target or payload resolution failed')
    }

    if (!row) {
      const registeredRow = this.store.registerOrLoad({
        commandId: this.uuid(),
        idempotencyKey: metadata.idempotencyKey,
        clientInstanceId: metadata.clientInstanceId,
        commandType: definition.commandType,
        actorId: identity.actorId,
        deviceId: metadata.deviceId,
        authSessionId: identity.authSessionId,
        requestHash,
        eventBatchId: this.uuid(),
        createdAt: observedAt,
        maxAttempts: COMMAND_MAX_ATTEMPTS
      })
      row = registeredRow.row
      assertStableReplay(row, stable)
      if (row.status === 'SUCCEEDED') return replay(row)
    }

    const claimed = this.store.acquireLease({
      commandId: row.commandId,
      seenGeneration: row.currentLeaseGeneration,
      workerId: this.workerId,
      now: observedAt,
      allowFailed: contract.prePonrRetryPolicy === 'RETRYABLE_SYSTEM_FAILURE'
    })
    if (!claimed) {
      const current = this.store.findByCommandId(row.commandId)
      if (current) {
        assertStableReplay(current, stable)
        if (current.status === 'SUCCEEDED') return replay(current)
      }
      throw new DurableCommandCoordinatorError('LEASE_RACE', 'lease was acquired or state changed concurrently')
    }

    const envelope = buildCommandEnvelopeV2({
      commandId: claimed.commandId,
      commandType: claimed.commandType,
      source: request.transport.source,
      actor,
      target,
      payload,
      requestHash: claimed.requestHash,
      createdAt: claimed.createdAt,
      clientInstanceId: claimed.clientInstanceId,
      idempotencyKey: claimed.idempotencyKey,
      eventBatchId: claimed.eventBatchId,
      actorId: claimed.actorId,
      deviceId: claimed.deviceId,
      authSessionId: claimed.authSessionId,
      leaseOwner: this.workerId,
      leaseGeneration: claimed.currentLeaseGeneration
    })
    return Object.freeze({
      status: 'ACCEPTED',
      row: claimed,
      envelope,
      validatedInput: input,
      transportMetadata: metadata
    })
  }

  assertCurrentLease(envelope: CommandEnvelopeV2): DurableCommandRow {
    try {
      return this.store.assertLease({
        commandId: envelope.commandId,
        leaseOwner: envelope.leaseOwner,
        generation: envelope.leaseGeneration,
        now: nowIso(this.now)
      })
    } catch (error) {
      if (error instanceof DurableCommandStoreError && error.code === 'FENCED') {
        throw new DurableCommandCoordinatorError('FENCED', 'accepted envelope was fenced')
      }
      throw error
    }
  }

  renew(envelope: CommandEnvelopeV2): DurableCommandRow {
    try {
      return this.store.renewLease({
        commandId: envelope.commandId,
        leaseOwner: envelope.leaseOwner,
        generation: envelope.leaseGeneration,
        now: nowIso(this.now)
      })
    } catch (error) {
      if (error instanceof DurableCommandStoreError && error.code === 'FENCED') {
        throw new DurableCommandCoordinatorError('FENCED', 'lease renewal was fenced')
      }
      throw error
    }
  }

  complete(
    envelope: CommandEnvelopeV2,
    publicResult: unknown
  ): { row: DurableCommandRow; publicResult: DurableCommandReplayed['publicResult'] } {
    const definition = this.registry.requireMutation(envelope.commandType)
    const contract = durableContract(definition)
    if (contract.resultSchemaVersion !== 'command-result-v1') {
      throw new DurableCommandCoordinatorError('REGISTRY_INCOMPLETE', 'result schema is unsupported')
    }
    const resultJson = createCommandResultJson(publicResult)
    try {
      const row = this.store.completeSucceeded({
        commandId: envelope.commandId,
        leaseOwner: envelope.leaseOwner,
        generation: envelope.leaseGeneration,
        resultJson,
        now: nowIso(this.now)
      })
      return { row, publicResult: parseCommandResultJson(resultJson).public_result }
    } catch (error) {
      if (error instanceof DurableCommandStoreError && error.code === 'FENCED') {
        throw new DurableCommandCoordinatorError('FENCED', 'result update was fenced')
      }
      throw error
    }
  }

  /** Complete a command inside the caller's already-open BEGIN IMMEDIATE transaction. */
  completeWithinTransaction(
    envelope: CommandEnvelopeV2,
    publicResult: unknown
  ): { row: DurableCommandRow; publicResult: DurableCommandReplayed['publicResult'] } {
    const definition = this.registry.requireMutation(envelope.commandType)
    const contract = durableContract(definition)
    if (contract.resultSchemaVersion !== 'command-result-v1') {
      throw new DurableCommandCoordinatorError('REGISTRY_INCOMPLETE', 'result schema is unsupported')
    }
    const resultJson = createCommandResultJson(publicResult)
    try {
      const row = this.store.completeSucceededWithinTransaction({
        commandId: envelope.commandId,
        leaseOwner: envelope.leaseOwner,
        generation: envelope.leaseGeneration,
        resultJson,
        now: nowIso(this.now)
      })
      return { row, publicResult: parseCommandResultJson(resultJson).public_result }
    } catch (error) {
      if (error instanceof DurableCommandStoreError && error.code === 'FENCED') {
        throw new DurableCommandCoordinatorError('FENCED', 'result update was fenced')
      }
      throw error
    }
  }

  failRetryableBeforePrepare(envelope: CommandEnvelopeV2, errorCode: string): DurableCommandRow {
    try {
      return this.store.markRetryablePrePonrFailure({
        commandId: envelope.commandId,
        leaseOwner: envelope.leaseOwner,
        generation: envelope.leaseGeneration,
        errorCode,
        now: nowIso(this.now),
        stage: 'PRE_PONR_NO_PREPARE'
      })
    } catch (error) {
      if (error instanceof DurableCommandStoreError && error.code === 'FENCED') {
        throw new DurableCommandCoordinatorError('FENCED', 'failure update was fenced')
      }
      throw error
    }
  }
}
