import type { CommandEnvelopeV2 } from '../../application/command/command-types'
import {
  canonicalJson,
  type CanonicalJsonValue
} from './canonical-json'
import { MAX_BATCH_EVENT_COUNT } from './batch-hash'

export const COMMAND_PLAN_SCHEMA_VERSION = 'command-plan-v1'
export const BATCH_CONTEXT_SCHEMA_VERSION = 'batch-context-v1'

export interface BatchContextV1 {
  readonly [key: string]: CanonicalJsonValue
  readonly schema_version: typeof BATCH_CONTEXT_SCHEMA_VERSION
  readonly plan_version: string
  readonly result_recipe_version: string
  readonly root_command_type: string
  readonly root_command_id: string
  readonly child_ordinal: number
}

export interface EventIntentV1 {
  readonly eventId: string
  readonly aggregateType: string
  readonly aggregateId: string
  readonly eventType: string
  readonly eventSequence: number
  readonly payload: Readonly<{
    event_payload_version: number
    batch_context: BatchContextV1
    [key: string]: CanonicalJsonValue
  }>
  readonly actorId: string
  readonly timestamp: string
}

export interface OperationalEffectDescriptorV1 {
  readonly sourceEventId: string
  readonly eventType: string
  readonly effectType: string
  readonly effectVersion: number
}

export interface CommandPlanV1 {
  readonly schemaVersion: typeof COMMAND_PLAN_SCHEMA_VERSION
  readonly commandId: string
  readonly commandType: string
  readonly planVersion: string
  readonly resultRecipeVersion: string
  readonly events: readonly EventIntentV1[]
  readonly operationalEffects: readonly OperationalEffectDescriptorV1[]
  /**
   * Effects that must run after PREPARE fsync but before SQLite APPLY. They are
   * derived from frozen EVENT facts and therefore remain safe to repeat during
   * startup recovery. This is intentionally distinct from transaction-bound
   * operationalEffects.
   */
  readonly preApplyEffects?: readonly OperationalEffectDescriptorV1[]
  readonly noOpResult: Readonly<Record<string, CanonicalJsonValue>> | null
}

const plannerSnapshotBrand: unique symbol = Symbol('event-batch-planner-snapshot')

export interface PlannerReadSnapshot<T extends CanonicalJsonValue> {
  readonly value: Readonly<T>
  readonly [plannerSnapshotBrand]: true
}

export interface CommandPlannerV1<TSnapshot extends CanonicalJsonValue> {
  plan(input: Readonly<{
    envelope: CommandEnvelopeV2
    snapshot: PlannerReadSnapshot<TSnapshot>
  }>): CommandPlanV1 | Promise<CommandPlanV1>
}

export class CommandPlanError extends Error {
  constructor(message: string, public readonly field = '$') {
    super(`[event-batch-command-plan] ${message} at ${field}`)
    this.name = 'CommandPlanError'
  }
}

const BATCH_CONTEXT_KEYS = Object.freeze([
  'child_ordinal',
  'plan_version',
  'result_recipe_version',
  'root_command_id',
  'root_command_type',
  'schema_version'
])

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

function canonicalClone<T extends CanonicalJsonValue>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T
}

function text(value: unknown, field: string, token = false): string {
  if (
    typeof value !== 'string'
    || !value.length
    || value !== value.trim()
    || Buffer.byteLength(value, 'utf8') > 512
    || (token && !/^[A-Z][A-Z0-9_]*$/.test(value))
  ) throw new CommandPlanError('value is invalid', field)
  return value
}

function exactTimestamp(value: unknown, field: string): string {
  const parsed = text(value, field)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(parsed) || new Date(parsed).toISOString() !== parsed) {
    throw new CommandPlanError('timestamp must be exact UTC milliseconds', field)
  }
  return parsed
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new CommandPlanError('value must be a positive safe integer', field)
  }
  return value as number
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new CommandPlanError('value must be a non-negative safe integer', field)
  }
  return value as number
}

function batchContext(value: unknown, field: string): BatchContextV1 {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CommandPlanError('batch_context must be an object', field)
  }
  const input = value as Record<string, unknown>
  const keys = Object.keys(input).sort()
  if (keys.length !== BATCH_CONTEXT_KEYS.length || keys.some((key, index) => key !== BATCH_CONTEXT_KEYS[index])) {
    throw new CommandPlanError('batch_context field set mismatch', field)
  }
  if (input.schema_version !== BATCH_CONTEXT_SCHEMA_VERSION) {
    throw new CommandPlanError('batch_context schema mismatch', `${field}.schema_version`)
  }
  return {
    schema_version: BATCH_CONTEXT_SCHEMA_VERSION,
    plan_version: text(input.plan_version, `${field}.plan_version`),
    result_recipe_version: text(input.result_recipe_version, `${field}.result_recipe_version`),
    root_command_type: text(input.root_command_type, `${field}.root_command_type`),
    root_command_id: text(input.root_command_id, `${field}.root_command_id`),
    child_ordinal: nonNegativeInteger(input.child_ordinal, `${field}.child_ordinal`)
  }
}

export function validateEventPayloadMetadata(
  payload: Readonly<Record<string, CanonicalJsonValue>>,
  field = '$.payload'
): Readonly<{ eventPayloadVersion: number; batchContext: BatchContextV1 }> {
  const eventPayloadVersion = positiveInteger(payload.event_payload_version, `${field}.event_payload_version`)
  const context = batchContext(payload.batch_context, `${field}.batch_context`)
  return deepFreeze({ eventPayloadVersion, batchContext: context })
}

function eventIntent(value: unknown, index: number): EventIntentV1 {
  const field = `$.events[${index}]`
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CommandPlanError('event intent must be an object', field)
  }
  const input = value as Record<string, unknown>
  const payloadValue = canonicalClone(input.payload as CanonicalJsonValue)
  if (typeof payloadValue !== 'object' || payloadValue === null || Array.isArray(payloadValue)) {
    throw new CommandPlanError('payload must be an object', `${field}.payload`)
  }
  const payload = payloadValue as Record<string, CanonicalJsonValue>
  const metadata = validateEventPayloadMetadata(payload, `${field}.payload`)
  const eventPayloadVersion = metadata.eventPayloadVersion
  const context = metadata.batchContext
  payload.event_payload_version = eventPayloadVersion
  payload.batch_context = context as unknown as CanonicalJsonValue
  return {
    eventId: text(input.eventId, `${field}.eventId`),
    aggregateType: text(input.aggregateType, `${field}.aggregateType`, true),
    aggregateId: text(input.aggregateId, `${field}.aggregateId`),
    eventType: text(input.eventType, `${field}.eventType`, true),
    eventSequence: positiveInteger(input.eventSequence, `${field}.eventSequence`),
    payload: payload as EventIntentV1['payload'],
    actorId: text(input.actorId, `${field}.actorId`),
    timestamp: exactTimestamp(input.timestamp, `${field}.timestamp`)
  }
}

function operationalEffect(
  value: unknown,
  index: number,
  collection = 'operationalEffects'
): OperationalEffectDescriptorV1 {
  const field = `$.${collection}[${index}]`
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CommandPlanError('operational effect must be an object', field)
  }
  const input = value as Record<string, unknown>
  const keys = Object.keys(input).sort()
  const expected = ['effectType', 'effectVersion', 'eventType', 'sourceEventId']
  if (keys.length !== expected.length || keys.some((key, keyIndex) => key !== expected[keyIndex])) {
    throw new CommandPlanError('operational effect contains plan-only parameters', field)
  }
  return {
    sourceEventId: text(input.sourceEventId, `${field}.sourceEventId`),
    eventType: text(input.eventType, `${field}.eventType`, true),
    effectType: text(input.effectType, `${field}.effectType`, true),
    effectVersion: positiveInteger(input.effectVersion, `${field}.effectVersion`)
  }
}

export function createPlannerReadSnapshot<T extends CanonicalJsonValue>(value: T): PlannerReadSnapshot<T> {
  return deepFreeze({
    value: canonicalClone(value),
    [plannerSnapshotBrand]: true as const
  })
}

export function freezeCommandPlan(value: CommandPlanV1, envelope: CommandEnvelopeV2): CommandPlanV1 {
  if (value.schemaVersion !== COMMAND_PLAN_SCHEMA_VERSION) throw new CommandPlanError('schemaVersion mismatch')
  const commandId = text(value.commandId, '$.commandId')
  const commandType = text(value.commandType, '$.commandType')
  const planVersion = text(value.planVersion, '$.planVersion')
  const resultRecipeVersion = text(value.resultRecipeVersion, '$.resultRecipeVersion')
  if (commandId !== envelope.commandId || commandType !== envelope.commandType) {
    throw new CommandPlanError('plan command identity does not match accepted envelope')
  }
  if (!Array.isArray(value.events) || value.events.length > MAX_BATCH_EVENT_COUNT) {
    throw new CommandPlanError(`events must contain at most ${MAX_BATCH_EVENT_COUNT} entries`, '$.events')
  }
  if (!Array.isArray(value.operationalEffects)) {
    throw new CommandPlanError('operationalEffects must be an array', '$.operationalEffects')
  }
  if (value.preApplyEffects !== undefined && !Array.isArray(value.preApplyEffects)) {
    throw new CommandPlanError('preApplyEffects must be an array', '$.preApplyEffects')
  }
  const events = value.events.map(eventIntent)
  const eventIds = new Set(events.map((event) => event.eventId))
  if (eventIds.size !== events.length) throw new CommandPlanError('event IDs must be unique', '$.events')
  for (const [index, event] of events.entries()) {
    const context = event.payload.batch_context
    if (
      context.root_command_id !== commandId
      || context.root_command_type !== commandType
      || context.plan_version !== planVersion
      || context.result_recipe_version !== resultRecipeVersion
    ) throw new CommandPlanError('EVENT batch_context conflicts with root plan', `$.events[${index}].payload.batch_context`)
    if (event.actorId !== envelope.actorId) {
      throw new CommandPlanError('EVENT actor does not match durable command actor', `$.events[${index}].actorId`)
    }
  }
  const effects = value.operationalEffects.map((effect, index) => operationalEffect(effect, index))
  const preApplyEffects = (value.preApplyEffects ?? []).map((effect, index) =>
    operationalEffect(effect, index, 'preApplyEffects')
  )
  const validateEffects = (
    candidates: readonly OperationalEffectDescriptorV1[],
    collection: 'operationalEffects' | 'preApplyEffects'
  ) => {
    const effectKeys = new Set<string>()
    for (const [index, effect] of candidates.entries()) {
      const event = events.find((candidate) => candidate.eventId === effect.sourceEventId)
      if (!event || event.eventType !== effect.eventType) {
        throw new CommandPlanError('operational effect is not derived from a planned EVENT', `$.${collection}[${index}]`)
      }
      const key = `${effect.sourceEventId}\u0000${effect.effectType}\u0000${effect.effectVersion}`
      if (effectKeys.has(key)) {
        throw new CommandPlanError('operational effect descriptor is duplicated', `$.${collection}[${index}]`)
      }
      effectKeys.add(key)
    }
  }
  validateEffects(effects, 'operationalEffects')
  validateEffects(preApplyEffects, 'preApplyEffects')
  let noOpResult: Readonly<Record<string, CanonicalJsonValue>> | null = null
  if (events.length === 0) {
    if (effects.length !== 0 || preApplyEffects.length !== 0) throw new CommandPlanError('no-op plan cannot have operational effects')
    const cloned = canonicalClone(value.noOpResult as CanonicalJsonValue)
    if (typeof cloned !== 'object' || cloned === null || Array.isArray(cloned) || typeof cloned.success !== 'boolean') {
      throw new CommandPlanError('no-op plan requires an object result with boolean success', '$.noOpResult')
    }
    noOpResult = cloned as Record<string, CanonicalJsonValue>
  } else if (value.noOpResult !== null) {
    throw new CommandPlanError('event plan cannot contain a plan-only result', '$.noOpResult')
  }
  return deepFreeze({
    schemaVersion: COMMAND_PLAN_SCHEMA_VERSION,
    commandId,
    commandType,
    planVersion,
    resultRecipeVersion,
    events,
    operationalEffects: effects,
    preApplyEffects,
    noOpResult
  })
}
