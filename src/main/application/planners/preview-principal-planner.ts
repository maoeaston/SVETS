import { createHash } from 'node:crypto'
import type { DBAdapter } from '../../db/interface'
import type { CommandEnvelopeV2 } from '../command/command-types'
import {
  BATCH_CONTEXT_SCHEMA_VERSION,
  COMMAND_PLAN_SCHEMA_VERSION,
  createPlannerReadSnapshot,
  type CommandPlanV1,
  type EventIntentV1,
  type PlannerReadSnapshot
} from '../../domain/event-batch/command-plan'
import { canonicalJson, type CanonicalJsonValue } from '../../domain/event-batch/canonical-json'
import {
  listPrincipalBindings,
  PrincipalBindingService,
  type PrincipalBindingFact,
  type PrincipalRotationFact
} from '../../domain/authority/principal-binding-service'
import {
  PRINCIPAL_BINDING_EVENT_PAYLOAD_VERSION,
  PRINCIPAL_BINDING_RESULT_RECIPE_VERSIONS
} from '../../domain/projectors/principal-binding-projector'
import { PreviewContractError } from '../../domain/preview/preview-errors'
import { assertPreviewProjectionStatus } from '../../domain/projectors/preview-event-projection'

export const PREVIEW_PRINCIPAL_SNAPSHOT_VERSION = 'preview-principal-snapshot-v1'
export const PREVIEW_PRINCIPAL_PLAN_VERSIONS = Object.freeze({
  'preview:enrollPrincipal': 'preview.principal.enrollment.plan.v1',
  'preview:rotatePrincipal': 'preview.principal.rotation.plan.v1'
})

type PreviewPrincipalCommand = keyof typeof PREVIEW_PRINCIPAL_PLAN_VERSIONS

export interface PreviewPrincipalTrustContext {
  readonly service: PrincipalBindingService
  readonly resolveScope: (envelope: CommandEnvelopeV2) => Readonly<{
    target_installation_id: string
    organization_id: string
  }> | null
  /** Resolves the current sender-bound user to the trusted executor principal. */
  readonly resolveExecutorPrincipal: (
    envelope: CommandEnvelopeV2,
    scope: Readonly<{ target_installation_id: string; organization_id: string }>
  ) => string | null
}

export class PreviewPrincipalPlannerError extends Error {
  constructor(
    public readonly code: 'COMMAND_UNSUPPORTED' | 'INVALID_INPUT' | 'STATE_CONFLICT',
    message: string
  ) {
    super(`[preview-principal-planner] ${message}`)
    this.name = 'PreviewPrincipalPlannerError'
  }
}

function record(value: unknown, field: string): Record<string, CanonicalJsonValue> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PreviewPrincipalPlannerError('INVALID_INPUT', `${field} must be an object`)
  }
  return value as Record<string, CanonicalJsonValue>
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw new PreviewPrincipalPlannerError('INVALID_INPUT', `${field} must be a non-empty trimmed string`)
  }
  return value
}

function exactTimestamp(value: unknown, field: string): string {
  const timestamp = text(value, field)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(timestamp) || new Date(timestamp).toISOString() !== timestamp) {
    throw new PreviewPrincipalPlannerError('INVALID_INPUT', `${field} must be an exact UTC timestamp`)
  }
  return timestamp
}

function canonicalRecord(value: unknown): Record<string, CanonicalJsonValue> {
  return record(JSON.parse(canonicalJson(value)), 'snapshot')
}

function deterministicUuid(commandId: string, role: string): string {
  const bytes = createHash('sha256')
    .update('svets:preview-principal:v1\0', 'utf8')
    .update(commandId, 'utf8')
    .update('\0', 'utf8')
    .update(role, 'utf8')
    .digest()
    .subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function batchContext(
  envelope: CommandEnvelopeV2,
  planVersion: string,
  resultRecipeVersion: string
): {
  readonly schema_version: typeof BATCH_CONTEXT_SCHEMA_VERSION
  readonly plan_version: string
  readonly result_recipe_version: string
  readonly root_command_type: string
  readonly root_command_id: string
  readonly child_ordinal: 0
} {
  return {
    schema_version: BATCH_CONTEXT_SCHEMA_VERSION,
    plan_version: planVersion,
    result_recipe_version: resultRecipeVersion,
    root_command_type: envelope.commandType,
    root_command_id: envelope.commandId,
    child_ordinal: 0
  } as const
}

function nextSequence(db: DBAdapter, aggregateId: string): number {
  const row = db.prepare(
    `SELECT MAX(event_sequence) AS value
       FROM preview_event_projection
      WHERE aggregate_type = 'PRINCIPAL_BINDING' AND aggregate_id = ?`
  ).get(aggregateId) as { value: number | null } | undefined
  return (row?.value ?? 0) + 1
}

function previewErrorSnapshot(timestamp: string, errorCode: string): PlannerReadSnapshot<CanonicalJsonValue> {
  return createPlannerReadSnapshot(canonicalRecord({
    schema_version: PREVIEW_PRINCIPAL_SNAPSHOT_VERSION,
    kind: 'NO_OP',
    timestamp,
    no_op_result: { success: false, errorCode }
  }))
}

function signedPackage(value: CanonicalJsonValue | undefined, field: string): Record<string, CanonicalJsonValue> {
  return record(value, field)
}

export function loadPreviewPrincipalPlannerSnapshot(
  db: DBAdapter,
  envelope: CommandEnvelopeV2,
  options: Readonly<{ timestamp: string; appVersion: string }>,
  trust: PreviewPrincipalTrustContext | undefined
): PlannerReadSnapshot<CanonicalJsonValue> {
  const timestamp = exactTimestamp(options.timestamp, 'timestamp')
  if (!Object.prototype.hasOwnProperty.call(PREVIEW_PRINCIPAL_PLAN_VERSIONS, envelope.commandType)) {
    throw new PreviewPrincipalPlannerError('COMMAND_UNSUPPORTED', `unsupported ${envelope.commandType}`)
  }
  try {
    assertPreviewProjectionStatus(db)
  } catch (error) {
    if (error instanceof PreviewContractError) return previewErrorSnapshot(timestamp, error.code)
    throw error
  }
  if (!trust) return previewErrorSnapshot(timestamp, 'INSTALLATION_TRUST_UNAVAILABLE')
  const scope = trust.resolveScope(envelope)
  if (!scope) return previewErrorSnapshot(timestamp, 'INSTALLATION_TRUST_UNAVAILABLE')
  const executingPrincipalId = trust.resolveExecutorPrincipal(envelope, scope)
  if (!executingPrincipalId) return previewErrorSnapshot(timestamp, 'INSTALLATION_TRUST_UNAVAILABLE')
  const existing = listPrincipalBindings(db)
  try {
    if (envelope.commandType === 'preview:enrollPrincipal') {
      const envelopeValue = signedPackage(envelope.payload.enrollmentPackage, 'payload.enrollmentPackage')
      const verified = trust.service.verifyEnrollmentEnvelope(envelopeValue as never, {
        target_installation_id: scope.target_installation_id,
        organization_id: scope.organization_id,
        now: new Date(timestamp),
        existing,
        executing_principal_id: executingPrincipalId
      })
      return createPlannerReadSnapshot(canonicalRecord({
        schema_version: PREVIEW_PRINCIPAL_SNAPSHOT_VERSION,
        kind: 'ENROLLMENT',
        timestamp,
        app_version: options.appVersion,
        enrollment_id: verified.enrollment_id,
        next_sequence: nextSequence(db, verified.fact.mapping_id),
        fact: verified.fact
      }))
    }
    const envelopeValue = signedPackage(envelope.payload.rotationPackage, 'payload.rotationPackage')
    const verified = trust.service.verifyRotationEnvelope(envelopeValue as never, {
      target_installation_id: scope.target_installation_id,
      organization_id: scope.organization_id,
      now: new Date(timestamp),
      existing,
      executing_principal_id: executingPrincipalId
    })
    return createPlannerReadSnapshot(canonicalRecord({
      schema_version: PREVIEW_PRINCIPAL_SNAPSHOT_VERSION,
      kind: 'ROTATION',
      timestamp,
      app_version: options.appVersion,
      next_sequence: nextSequence(db, verified.fact.old_mapping_id),
      fact: verified.fact
    }))
  } catch (error) {
    if (error instanceof PreviewContractError) return previewErrorSnapshot(timestamp, error.code)
    throw new PreviewPrincipalPlannerError('STATE_CONFLICT', error instanceof Error ? error.message : String(error))
  }
}

function event(
  envelope: CommandEnvelopeV2,
  planVersion: string,
  resultRecipeVersion: string,
  eventType: 'PRINCIPAL_BINDING_ENROLLMENT' | 'PRINCIPAL_BINDING_ROTATION',
  aggregateId: string,
  eventSequence: number,
  timestamp: string,
  appVersion: string,
  payload: Record<string, CanonicalJsonValue>
): EventIntentV1 {
  return {
    eventId: deterministicUuid(envelope.commandId, eventType),
    aggregateType: 'PRINCIPAL_BINDING',
    aggregateId,
    eventType,
    eventSequence,
    actorId: envelope.actorId,
    timestamp,
    payload: {
      event_payload_version: PRINCIPAL_BINDING_EVENT_PAYLOAD_VERSION,
      batch_context: batchContext(envelope, planVersion, resultRecipeVersion),
      actor_role: envelope.actor.kind === 'USER' ? envelope.actor.role : 'SYSTEM',
      app_version: appVersion,
      correlation_id: envelope.correlationId,
      contract_version: 'PREVIEW_CONTRACT_V1',
      allowed_shell_kind: 'PREVIEW_SHELL',
      ...payload
    }
  }
}

export class PreviewPrincipalPlanner {
  plan(input: Readonly<{
    envelope: CommandEnvelopeV2
    snapshot: PlannerReadSnapshot<CanonicalJsonValue>
  }>): CommandPlanV1 {
    const command = input.envelope.commandType as PreviewPrincipalCommand
    const planVersion = PREVIEW_PRINCIPAL_PLAN_VERSIONS[command]
    const resultRecipeVersion = PRINCIPAL_BINDING_RESULT_RECIPE_VERSIONS[command]
    if (!planVersion || !resultRecipeVersion) throw new PreviewPrincipalPlannerError('COMMAND_UNSUPPORTED', `unsupported ${input.envelope.commandType}`)
    const value = record(input.snapshot.value, 'snapshot')
    if (value.schema_version !== PREVIEW_PRINCIPAL_SNAPSHOT_VERSION) throw new PreviewPrincipalPlannerError('INVALID_INPUT', 'snapshot version mismatch')
    const timestamp = exactTimestamp(value.timestamp, 'snapshot.timestamp')
    if (value.kind === 'NO_OP') {
      return {
        schemaVersion: COMMAND_PLAN_SCHEMA_VERSION,
        commandId: input.envelope.commandId,
        commandType: command,
        planVersion,
        resultRecipeVersion,
        events: [],
        operationalEffects: [],
        noOpResult: record(value.no_op_result, 'snapshot.no_op_result')
      }
    }
    const fact = record(value.fact, 'snapshot.fact')
    const appVersion = text(value.app_version, 'snapshot.app_version')
    const nextEventSequence = value.next_sequence
    if (!Number.isSafeInteger(nextEventSequence) || (nextEventSequence as number) < 1) {
      throw new PreviewPrincipalPlannerError('INVALID_INPUT', 'snapshot.next_sequence is invalid')
    }
    if (value.kind === 'ENROLLMENT') {
      const typed = fact as unknown as PrincipalBindingFact
      const payload: Record<string, CanonicalJsonValue> = {
        enrollment_id: text(value.enrollment_id, 'snapshot.enrollment_id'),
        ...typed
      } as unknown as Record<string, CanonicalJsonValue>
      return {
        schemaVersion: COMMAND_PLAN_SCHEMA_VERSION,
        commandId: input.envelope.commandId,
        commandType: command,
        planVersion,
        resultRecipeVersion,
        events: [event(
          input.envelope,
          planVersion,
          resultRecipeVersion,
          'PRINCIPAL_BINDING_ENROLLMENT',
          text(typed.mapping_id, 'fact.mapping_id'),
          nextEventSequence as number,
          timestamp,
          appVersion,
          payload
        )],
        operationalEffects: [],
        noOpResult: null
      }
    }
    if (value.kind !== 'ROTATION') throw new PreviewPrincipalPlannerError('INVALID_INPUT', 'snapshot kind is invalid')
    const typed = fact as unknown as PrincipalRotationFact
    const payload: Record<string, CanonicalJsonValue> = { ...typed } as unknown as Record<string, CanonicalJsonValue>
    return {
      schemaVersion: COMMAND_PLAN_SCHEMA_VERSION,
      commandId: input.envelope.commandId,
      commandType: command,
      planVersion,
      resultRecipeVersion,
      events: [event(
        input.envelope,
        planVersion,
        resultRecipeVersion,
        'PRINCIPAL_BINDING_ROTATION',
        text(typed.old_mapping_id, 'fact.old_mapping_id'),
        nextEventSequence as number,
        timestamp,
        appVersion,
        payload
      )],
      operationalEffects: [],
      noOpResult: null
    }
  }
}
