import { v4 as uuidv4 } from 'uuid'
import {
  CanonicalJsonError,
  canonicalizeJson,
  sha256CanonicalJson,
  type CanonicalJsonValue
} from '../../domain/report-canonical'
import type {
  CommandActor,
  CommandEnvelope,
  CommandEnvelopeV2,
  CommandSource
} from './command-types'

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const RFC3339_MILLISECONDS_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

const TRUSTED_ENVELOPE_FIELDS = new Set([
  'actor',
  'auth_session_id',
  'authSessionId',
  'command_id',
  'command_type',
  'commandId',
  'commandType',
  'correlation_id',
  'correlationId',
  'created_at',
  'createdAt',
  'client_instance_id',
  'clientInstanceId',
  'device_id',
  'deviceId',
  'event_batch_id',
  'eventBatchId',
  'idempotency_key',
  'idempotencyKey',
  'lease_generation',
  'leaseGeneration',
  'request_hash',
  'requestHash',
  'source',
  'target',
  'transport_metadata',
  'transportMetadata',
  'worker_id',
  'workerId'
])

const TRUSTED_ACTOR_PAYLOAD_FIELDS = new Set(['actor', 'callerRole', 'callerUserId'])

export interface CommandEnvelopeFactoryDependencies {
  readonly uuid?: () => string
  readonly now?: () => Date
}

export interface BuildCommandEnvelopeParams {
  readonly commandType: string
  readonly source: CommandSource
  readonly actor: CommandActor
  readonly target: Record<string, unknown>
  readonly payload: Record<string, unknown>
  readonly parentCorrelationId?: string
}

export interface BuildCommandEnvelopeV2Params extends BuildCommandEnvelopeParams {
  readonly commandId: string
  readonly requestHash: string
  readonly createdAt: string
  readonly clientInstanceId: string
  readonly idempotencyKey: string
  readonly eventBatchId: string
  readonly actorId: string
  readonly deviceId: string | null
  readonly authSessionId: string | null
  readonly leaseOwner: string
  readonly leaseGeneration: number
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export function canonicalizeCommandRecord(value: unknown, path: string): Record<string, CanonicalJsonValue> {
  const canonical = canonicalizeJson(value)
  if (canonical === null || typeof canonical !== 'object' || Array.isArray(canonical)) {
    throw new CanonicalJsonError(path, 'value must be a plain object')
  }
  return canonical
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

function assertNonEmpty(value: string, field: string): void {
  if (!value.trim()) throw new Error(`${field} must be non-empty`)
}

function assertUuidV4(value: string, field: string): void {
  if (!UUID_V4_PATTERN.test(value)) throw new Error(`${field} must be a UUID v4`)
}

function freezeActor(actor: CommandActor): CommandActor {
  if (actor.kind === 'USER') {
    assertNonEmpty(actor.userId, 'actor.userId')
    assertNonEmpty(actor.authSessionId, 'actor.authSessionId')
    if (!['STUDENT', 'TEACHER', 'ADMIN'].includes(actor.role)) throw new Error('actor.role is invalid')
  } else if (actor.kind === 'SYSTEM') {
    assertNonEmpty(actor.phase, 'actor.phase')
  } else if (actor.kind !== 'UNAUTHENTICATED') {
    throw new Error('actor.kind is invalid')
  }
  return deepFreeze({ ...actor })
}

function assertPayloadHasNoActorClaims(payload: Record<string, CanonicalJsonValue>): void {
  for (const field of TRUSTED_ACTOR_PAYLOAD_FIELDS) {
    if (Object.hasOwn(payload, field)) throw new Error(`canonical payload cannot contain trusted actor field ${field}`)
  }
}

export function assertNoTrustedEnvelopeOverrides(rawInput: unknown): void {
  if (!isPlainRecord(rawInput)) return
  for (const field of TRUSTED_ENVELOPE_FIELDS) {
    if (Object.hasOwn(rawInput, field)) throw new Error(`renderer input cannot override trusted envelope field ${field}`)
  }
}

export function createCommandEnvelopeFactory(dependencies: CommandEnvelopeFactoryDependencies = {}) {
  const generateUuid = dependencies.uuid ?? uuidv4
  const now = dependencies.now ?? (() => new Date())

  return (params: BuildCommandEnvelopeParams): CommandEnvelope => {
    assertNonEmpty(params.commandType, 'commandType')
    if (/\s/.test(params.commandType)) throw new Error('commandType cannot contain whitespace')
    if (params.source !== 'IPC' && params.source !== 'INTERNAL') throw new Error('source is invalid')
    if (params.parentCorrelationId && params.source !== 'INTERNAL') {
      throw new Error('only INTERNAL child commands may inherit correlationId')
    }

    const commandId = generateUuid()
    assertUuidV4(commandId, 'commandId')
    const correlationId = params.parentCorrelationId ?? commandId
    assertUuidV4(correlationId, 'correlationId')

    const createdAt = now().toISOString()
    if (!RFC3339_MILLISECONDS_PATTERN.test(createdAt)) throw new Error('createdAt must be UTC RFC3339 with milliseconds')

    const target = canonicalizeCommandRecord(params.target, '$.target')
    const payload = canonicalizeCommandRecord(params.payload, '$.payload')
    assertPayloadHasNoActorClaims(payload)
    const requestHash = sha256CanonicalJson({
      command_type: params.commandType,
      target,
      payload
    })

    return deepFreeze({
      commandId,
      commandType: params.commandType,
      source: params.source,
      actor: freezeActor(params.actor),
      target,
      payload,
      requestHash,
      createdAt,
      correlationId
    })
  }
}

export const buildCommandEnvelope = createCommandEnvelopeFactory()

export function buildCommandEnvelopeV2(params: BuildCommandEnvelopeV2Params): CommandEnvelopeV2 {
  assertNonEmpty(params.commandType, 'commandType')
  if (/\s/.test(params.commandType)) throw new Error('commandType cannot contain whitespace')
  if (params.source !== 'IPC' && params.source !== 'INTERNAL') throw new Error('source is invalid')
  if (params.parentCorrelationId !== undefined) throw new Error('root durable command cannot inherit correlationId')
  for (const [field, value] of [
    ['commandId', params.commandId],
    ['clientInstanceId', params.clientInstanceId],
    ['idempotencyKey', params.idempotencyKey],
    ['eventBatchId', params.eventBatchId]
  ] as const) assertUuidV4(value, field)
  assertNonEmpty(params.actorId, 'actorId')
  assertNonEmpty(params.leaseOwner, 'leaseOwner')
  if (!Number.isSafeInteger(params.leaseGeneration) || params.leaseGeneration < 1) {
    throw new Error('leaseGeneration must be a positive safe integer')
  }
  if (!/^[0-9a-f]{64}$/.test(params.requestHash)) throw new Error('requestHash must be lowercase SHA-256')
  if (!RFC3339_MILLISECONDS_PATTERN.test(params.createdAt) || new Date(params.createdAt).toISOString() !== params.createdAt) {
    throw new Error('createdAt must be UTC RFC3339 with milliseconds')
  }
  if (params.deviceId !== null) assertNonEmpty(params.deviceId, 'deviceId')
  if (params.authSessionId !== null) assertNonEmpty(params.authSessionId, 'authSessionId')

  const actor = freezeActor(params.actor)
  const expectedActorId = actor.kind === 'USER'
    ? actor.userId
    : actor.kind === 'SYSTEM'
      ? `SYSTEM:${actor.phase}`
      : 'UNAUTHENTICATED'
  const expectedAuthSessionId = actor.kind === 'USER' ? actor.authSessionId : null
  if (params.actorId !== expectedActorId || params.authSessionId !== expectedAuthSessionId) {
    throw new Error('durable actor identity does not match the resolved actor')
  }

  const target = canonicalizeCommandRecord(params.target, '$.target')
  const payload = canonicalizeCommandRecord(params.payload, '$.payload')
  assertPayloadHasNoActorClaims(payload)
  return deepFreeze({
    envelopeVersion: 'v2',
    commandId: params.commandId,
    commandType: params.commandType,
    source: params.source,
    actor,
    target,
    payload,
    requestHash: params.requestHash,
    createdAt: params.createdAt,
    correlationId: params.commandId,
    clientInstanceId: params.clientInstanceId,
    idempotencyKey: params.idempotencyKey,
    eventBatchId: params.eventBatchId,
    actorId: params.actorId,
    deviceId: params.deviceId,
    authSessionId: params.authSessionId,
    leaseOwner: params.leaseOwner,
    leaseGeneration: params.leaseGeneration
  })
}
