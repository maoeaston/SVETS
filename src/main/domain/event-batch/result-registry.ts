import type { DBAdapter } from '../../db/interface'
import type { DurableCommandRow } from '../../application/command/durable-command-store'
import {
  canonicalJson,
  type CanonicalJsonValue
} from './canonical-json'
import {
  validateEventPayloadMetadata,
  type OperationalEffectDescriptorV1
} from './command-plan'
import type {
  PreparedBatchSource,
  VerifiedEventSource
} from './projection-source'

export interface StablePreparedCommandFacts {
  readonly commandId: string
  readonly eventBatchId: string
  readonly commandType: string
  readonly actorId: string
  readonly deviceId: string | null
  readonly authSessionId: string | null
  readonly requestHash: string
  readonly clientInstanceId: string
  readonly idempotencyKey: string
  readonly createdAt: string
}

export interface PreparedProjectorContext {
  readonly database: DBAdapter
  readonly command: StablePreparedCommandFacts
  readonly batch: PreparedBatchSource
  readonly event: VerifiedEventSource
}

export interface PreparedOperationalEffectV1 {
  readonly effectType: string
  readonly effectVersion: number
  apply(context: PreparedProjectorContext): void
  assertApplied(context: PreparedProjectorContext): void
}

export interface PreparedEventRegistrationV1 {
  readonly eventType: string
  readonly eventPayloadVersion: number
  readonly projectorName: string
  validatePayload(payload: Readonly<Record<string, CanonicalJsonValue>>): void
  project(context: PreparedProjectorContext): void
  assertProjected(context: PreparedProjectorContext): void
  readonly operationalEffects: readonly PreparedOperationalEffectV1[]
}

export interface PreparedResultRecipeV1 {
  readonly commandType: string
  readonly resultRecipeVersion: string
  fromPrepared(input: Readonly<{
    command: StablePreparedCommandFacts
    batch: PreparedBatchSource
  }>): Readonly<Record<string, CanonicalJsonValue>>
}

export class PreparedFactRegistryError extends Error {
  constructor(
    public readonly code:
      | 'REGISTRY_SEALED'
      | 'DUPLICATE_REGISTRATION'
      | 'UNKNOWN_EVENT_VERSION'
      | 'UNKNOWN_RESULT_RECIPE'
      | 'PREPARED_CONTEXT_CONFLICT'
      | 'PAYLOAD_INVALID'
      | 'RESULT_INVALID'
      | 'EFFECT_VIEW_CONFLICT',
    message: string
  ) {
    super(`[event-batch-prepared-registry] ${message}`)
    this.name = 'PreparedFactRegistryError'
  }
}

function text(value: string, field: string, token = false): string {
  if (
    typeof value !== 'string'
    || !value.length
    || value !== value.trim()
    || Buffer.byteLength(value, 'utf8') > 512
    || (token && !/^[A-Z][A-Z0-9_]*$/.test(value))
  ) throw new PreparedFactRegistryError('PAYLOAD_INVALID', `${field} is invalid`)
  return value
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new PreparedFactRegistryError('PAYLOAD_INVALID', `${field} is invalid`)
  }
  return value
}

function eventKey(eventType: string, payloadVersion: number): string {
  return `${eventType}\u0000${payloadVersion}`
}

function resultKey(commandType: string, recipeVersion: string): string {
  return `${commandType}\u0000${recipeVersion}`
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

function exactDescriptorSet(values: readonly OperationalEffectDescriptorV1[]): string[] {
  return values.map((entry) => canonicalJson({
    effectType: entry.effectType,
    effectVersion: entry.effectVersion,
    eventType: entry.eventType,
    sourceEventId: entry.sourceEventId
  })).sort()
}

function stableCommandFacts(command: DurableCommandRow): StablePreparedCommandFacts {
  return Object.freeze({
    commandId: command.commandId,
    eventBatchId: command.eventBatchId,
    commandType: command.commandType,
    actorId: command.actorId,
    deviceId: command.deviceId,
    authSessionId: command.authSessionId,
    requestHash: command.requestHash,
    clientInstanceId: command.clientInstanceId,
    idempotencyKey: command.idempotencyKey,
    createdAt: command.createdAt
  })
}

export class PreparedFactRegistry {
  private readonly events = new Map<string, PreparedEventRegistrationV1>()
  private readonly results = new Map<string, PreparedResultRecipeV1>()
  private sealed = false

  registerEvent(registration: PreparedEventRegistrationV1): this {
    if (this.sealed) throw new PreparedFactRegistryError('REGISTRY_SEALED', 'registry is sealed')
    const eventType = text(registration.eventType, 'eventType', true)
    const eventPayloadVersion = positiveInteger(registration.eventPayloadVersion, 'eventPayloadVersion')
    text(registration.projectorName, 'projectorName')
    if (
      typeof registration.validatePayload !== 'function'
      || typeof registration.project !== 'function'
      || typeof registration.assertProjected !== 'function'
    ) {
      throw new PreparedFactRegistryError('PAYLOAD_INVALID', 'event registration handlers are required')
    }
    if (!Array.isArray(registration.operationalEffects)) {
      throw new PreparedFactRegistryError('PAYLOAD_INVALID', 'operationalEffects must be an array')
    }
    const effectKeys = new Set<string>()
    for (const effect of registration.operationalEffects) {
      const effectType = text(effect.effectType, 'effectType', true)
      const effectVersion = positiveInteger(effect.effectVersion, 'effectVersion')
      if (typeof effect.apply !== 'function' || typeof effect.assertApplied !== 'function') {
        throw new PreparedFactRegistryError('PAYLOAD_INVALID', 'operational effect apply/assert handlers are required')
      }
      const key = `${effectType}\u0000${effectVersion}`
      if (effectKeys.has(key)) {
        throw new PreparedFactRegistryError('DUPLICATE_REGISTRATION', `duplicate operational effect ${key}`)
      }
      effectKeys.add(key)
    }
    const key = eventKey(eventType, eventPayloadVersion)
    if (this.events.has(key)) {
      throw new PreparedFactRegistryError('DUPLICATE_REGISTRATION', `duplicate EVENT registration ${key}`)
    }
    const operationalEffects = Object.freeze(registration.operationalEffects.map((effect) => Object.freeze({
      effectType: effect.effectType,
      effectVersion: effect.effectVersion,
      apply: effect.apply,
      assertApplied: effect.assertApplied
    })))
    this.events.set(key, Object.freeze({
      eventType,
      eventPayloadVersion,
      projectorName: registration.projectorName,
      validatePayload: registration.validatePayload,
      project: registration.project,
      assertProjected: registration.assertProjected,
      operationalEffects
    }))
    return this
  }

  registerResult(registration: PreparedResultRecipeV1): this {
    if (this.sealed) throw new PreparedFactRegistryError('REGISTRY_SEALED', 'registry is sealed')
    const commandType = text(registration.commandType, 'commandType')
    const recipeVersion = text(registration.resultRecipeVersion, 'resultRecipeVersion')
    if (typeof registration.fromPrepared !== 'function') {
      throw new PreparedFactRegistryError('RESULT_INVALID', 'result recipe handler is required')
    }
    const key = resultKey(commandType, recipeVersion)
    if (this.results.has(key)) {
      throw new PreparedFactRegistryError('DUPLICATE_REGISTRATION', `duplicate result recipe ${key}`)
    }
    this.results.set(key, Object.freeze({
      commandType,
      resultRecipeVersion: recipeVersion,
      fromPrepared: registration.fromPrepared
    }))
    return this
  }

  seal(): this {
    if (this.events.size === 0 || this.results.size === 0) {
      throw new PreparedFactRegistryError('PAYLOAD_INVALID', 'event and result registrations are required')
    }
    this.sealed = true
    return this
  }

  isSealed(): boolean {
    return this.sealed
  }

  projectorNames(): readonly string[] {
    return Object.freeze([...new Set([...this.events.values()].map((entry) => entry.projectorName))].sort())
  }

  eventRegistration(event: VerifiedEventSource): PreparedEventRegistrationV1 {
    const metadata = validateEventPayloadMetadata(event.record.payload, `EVENT ${event.record.event_id}.payload`)
    const registration = this.events.get(eventKey(event.record.event_type, metadata.eventPayloadVersion))
    if (!registration) {
      throw new PreparedFactRegistryError(
        'UNKNOWN_EVENT_VERSION',
        `unknown ${event.record.event_type}@${metadata.eventPayloadVersion}`
      )
    }
    try {
      registration.validatePayload(event.record.payload)
    } catch (error) {
      throw new PreparedFactRegistryError(
        'PAYLOAD_INVALID',
        `${event.record.event_type}@${metadata.eventPayloadVersion}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
    return registration
  }

  validatePrepared(command: DurableCommandRow, batch: PreparedBatchSource): Readonly<{
    planVersion: string
    resultRecipeVersion: string
  }> {
    if (
      batch.prepared.command_id !== command.commandId
      || batch.prepared.batch_id !== command.eventBatchId
      || batch.prepared.request_hash !== command.requestHash
      || batch.prepared.prepared_lease_generation > command.currentLeaseGeneration
    ) {
      throw new PreparedFactRegistryError('PREPARED_CONTEXT_CONFLICT', 'prepared command/batch/request/generation conflicts with command row')
    }
    let planVersion: string | null = null
    let resultRecipeVersion: string | null = null
    for (const event of batch.events) {
      if (event.record.actor_id !== command.actorId) {
        throw new PreparedFactRegistryError('PREPARED_CONTEXT_CONFLICT', `EVENT ${event.record.event_id} actor conflicts with command row`)
      }
      const metadata = validateEventPayloadMetadata(event.record.payload, `EVENT ${event.record.event_id}.payload`)
      const context = metadata.batchContext
      if (context.root_command_id !== command.commandId || context.root_command_type !== command.commandType) {
        throw new PreparedFactRegistryError('PREPARED_CONTEXT_CONFLICT', `EVENT ${event.record.event_id} root command context conflicts`)
      }
      planVersion ??= context.plan_version
      resultRecipeVersion ??= context.result_recipe_version
      if (planVersion !== context.plan_version || resultRecipeVersion !== context.result_recipe_version) {
        throw new PreparedFactRegistryError('PREPARED_CONTEXT_CONFLICT', 'EVENT batch contexts disagree within one batch')
      }
      this.eventRegistration(event)
    }
    if (planVersion === null || resultRecipeVersion === null) {
      throw new PreparedFactRegistryError('PREPARED_CONTEXT_CONFLICT', 'prepared batch has no EVENT context')
    }
    if (!this.results.has(resultKey(command.commandType, resultRecipeVersion))) {
      throw new PreparedFactRegistryError(
        'UNKNOWN_RESULT_RECIPE',
        `unknown ${command.commandType}@${resultRecipeVersion}`
      )
    }
    return Object.freeze({ planVersion, resultRecipeVersion })
  }

  derivedOperationalEffects(batch: PreparedBatchSource): readonly OperationalEffectDescriptorV1[] {
    const descriptors = batch.events.flatMap((event) => {
      const registration = this.eventRegistration(event)
      return registration.operationalEffects.map((effect) => Object.freeze({
        sourceEventId: event.record.event_id,
        eventType: event.record.event_type,
        effectType: effect.effectType,
        effectVersion: effect.effectVersion
      }))
    })
    return Object.freeze(descriptors)
  }

  assertOperationalEffectView(
    planned: readonly OperationalEffectDescriptorV1[],
    batch: PreparedBatchSource
  ): void {
    const actual = exactDescriptorSet(planned)
    const expected = exactDescriptorSet(this.derivedOperationalEffects(batch))
    if (actual.length !== expected.length || actual.some((entry, index) => entry !== expected[index])) {
      throw new PreparedFactRegistryError('EFFECT_VIEW_CONFLICT', 'plan operational effect view is not prepared-EVENT-derived')
    }
  }

  applyEvent(context: PreparedProjectorContext): void {
    const registration = this.eventRegistration(context.event)
    registration.project(context)
    for (const effect of registration.operationalEffects) effect.apply(context)
  }

  projectorContext(input: Readonly<{
    database: DBAdapter
    command: DurableCommandRow
    batch: PreparedBatchSource
    event: VerifiedEventSource
  }>): PreparedProjectorContext {
    return Object.freeze({
      database: input.database,
      command: stableCommandFacts(input.command),
      batch: input.batch,
      event: input.event
    })
  }

  assertEventApplied(context: PreparedProjectorContext): void {
    const registration = this.eventRegistration(context.event)
    registration.assertProjected(context)
    for (const effect of registration.operationalEffects) effect.assertApplied(context)
  }

  resultFromPrepared(
    command: DurableCommandRow,
    batch: PreparedBatchSource
  ): Readonly<Record<string, CanonicalJsonValue>> {
    const { resultRecipeVersion } = this.validatePrepared(command, batch)
    const recipe = this.results.get(resultKey(command.commandType, resultRecipeVersion))!
    let result: Readonly<Record<string, CanonicalJsonValue>>
    try {
      result = recipe.fromPrepared(Object.freeze({ command: stableCommandFacts(command), batch }))
      const encoded = canonicalJson(result)
      result = JSON.parse(encoded) as Record<string, CanonicalJsonValue>
    } catch (error) {
      throw new PreparedFactRegistryError('RESULT_INVALID', error instanceof Error ? error.message : String(error))
    }
    if (typeof result !== 'object' || result === null || Array.isArray(result) || typeof result.success !== 'boolean') {
      throw new PreparedFactRegistryError('RESULT_INVALID', 'prepared result must be an object with boolean success')
    }
    return deepFreeze(result)
  }

  retainedRecipeVersions(commandType: string): readonly string[] {
    return Object.freeze([...this.results.values()]
      .filter((entry) => entry.commandType === commandType)
      .map((entry) => entry.resultRecipeVersion)
      .sort())
  }
}
