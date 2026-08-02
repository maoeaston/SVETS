import { createHash } from 'crypto'
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
import { PREVIEW_CONTRACT_VERSION } from '../../../shared/types/preview-contract'
import { PreviewContractError } from '../../domain/preview/preview-errors'
import {
  validatePreviewReleasePackage,
  validatePreviewRevokePackage,
  type PreviewReleasePackage,
  type PreviewRevokePackage,
  type PreviewReleaseScope
} from '../../domain/preview/preview-release-validator'
import { assertPreviewProjectionStatus } from '../../domain/projectors/preview-event-projection'
import { PREVIEW_RELEASE_EVENT_PAYLOAD_VERSION, PREVIEW_RELEASE_RESULT_RECIPE_VERSIONS } from '../../domain/projectors/preview-release-projector'

export const PREVIEW_RELEASE_SNAPSHOT_VERSION = 'preview-release-snapshot-v1'
export const PREVIEW_RELEASE_PLAN_VERSIONS = Object.freeze({
  'preview:releasePack': 'preview.preview-pack-release.plan.v1',
  'preview:revokePack': 'preview.preview-pack-revoke.plan.v1'
})

export interface PreviewReleaseTrustContext {
  readonly resolveScope: (envelope: CommandEnvelopeV2) => PreviewReleaseScope | null
  readonly verifyReleasePackage: (value: PreviewReleasePackage, scope: PreviewReleaseScope) => PreviewReleasePackage
  readonly verifyRevokePackage: (value: PreviewRevokePackage, scope: PreviewReleaseScope) => PreviewRevokePackage
}

export class PreviewReleasePlannerError extends Error {
  constructor(public readonly code: 'COMMAND_UNSUPPORTED' | 'INVALID_INPUT' | 'STATE_CONFLICT', message: string) {
    super(`[preview-release-planner] ${message}`)
    this.name = 'PreviewReleasePlannerError'
  }
}

type ReleaseCommand = keyof typeof PREVIEW_RELEASE_PLAN_VERSIONS

function record(value: unknown, field: string): Record<string, CanonicalJsonValue> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new PreviewReleasePlannerError('INVALID_INPUT', `${field} must be an object`)
  return value as Record<string, CanonicalJsonValue>
}

function canonicalRecord(value: unknown, field: string): Record<string, CanonicalJsonValue> {
  return record(JSON.parse(canonicalJson(value as CanonicalJsonValue)), field)
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) throw new PreviewReleasePlannerError('INVALID_INPUT', `${field} is invalid`)
  return value
}

function timestamp(value: unknown): string {
  const valueText = text(value, 'timestamp')
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(valueText) || new Date(valueText).toISOString() !== valueText) throw new PreviewReleasePlannerError('INVALID_INPUT', 'timestamp is invalid')
  return valueText
}

function deterministicUuid(commandId: string, role: string): string {
  const bytes = createHash('sha256').update('svets:preview-release:v1\0').update(commandId).update('\0').update(role).digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function batchContext(envelope: CommandEnvelopeV2, planVersion: string, resultRecipeVersion: string) {
  return {
    schema_version: BATCH_CONTEXT_SCHEMA_VERSION,
    plan_version: planVersion,
    result_recipe_version: resultRecipeVersion,
    root_command_type: envelope.commandType,
    root_command_id: envelope.commandId,
    child_ordinal: 0
  } as const
}

function errorSnapshot(timestampValue: string, errorCode: string): PlannerReadSnapshot<CanonicalJsonValue> {
  return createPlannerReadSnapshot({
    schema_version: PREVIEW_RELEASE_SNAPSHOT_VERSION,
    kind: 'NO_OP',
    timestamp: timestampValue,
    no_op_result: { success: false, errorCode }
  })
}

function packageValue(envelope: CommandEnvelopeV2, field: 'releasePackage' | 'revokePackage'): Record<string, CanonicalJsonValue> {
  const value = envelope.payload[field]
  return record(value, `payload.${field}`)
}

export function loadPreviewReleasePlannerSnapshot(
  db: DBAdapter,
  envelope: CommandEnvelopeV2,
  options: Readonly<{ timestamp: string; appVersion: string }>,
  trust: PreviewReleaseTrustContext | undefined
): PlannerReadSnapshot<CanonicalJsonValue> {
  const timestampValue = timestamp(options.timestamp)
  if (!Object.hasOwn(PREVIEW_RELEASE_PLAN_VERSIONS, envelope.commandType)) throw new PreviewReleasePlannerError('COMMAND_UNSUPPORTED', envelope.commandType)
  try {
    assertPreviewProjectionStatus(db)
  } catch (error) {
    if (error instanceof PreviewContractError) return errorSnapshot(timestampValue, error.code)
    throw error
  }
  if (!trust) return errorSnapshot(timestampValue, 'INSTALLATION_TRUST_UNAVAILABLE')
  const scope = trust.resolveScope(envelope)
  if (!scope) return errorSnapshot(timestampValue, 'INSTALLATION_TRUST_UNAVAILABLE')
  try {
    if (envelope.commandType === 'preview:releasePack') {
      const verified = trust.verifyReleasePackage(packageValue(envelope, 'releasePackage') as unknown as PreviewReleasePackage, scope)
      const validated = validatePreviewReleasePackage(verified, scope)
      const fact = validated.fact
      const existing = db.prepare('SELECT release_id, source_ref_id FROM preview_release_projection WHERE release_id = ? OR source_ref_id = ?').get(fact.release_id, fact.source_ref_id) as Record<string, unknown> | undefined
      if (existing) return errorSnapshot(timestampValue, 'PREVIEW_IDEMPOTENCY_CONFLICT')
      return createPlannerReadSnapshot(canonicalRecord({ schema_version: PREVIEW_RELEASE_SNAPSHOT_VERSION, kind: 'RELEASE', timestamp: timestampValue, app_version: options.appVersion, fact }, 'release snapshot'))
    }
    const verified = trust.verifyRevokePackage(packageValue(envelope, 'revokePackage') as unknown as PreviewRevokePackage, scope)
    const validated = validatePreviewRevokePackage(verified)
    const fact = validated.fact
    const row = db.prepare('SELECT source_ref_id, status FROM preview_release_projection WHERE release_id = ?').get(fact.release_id) as { source_ref_id: string; status: string } | undefined
    if (!row || row.source_ref_id !== fact.source_ref_id || row.status !== fact.status_before) return errorSnapshot(timestampValue, 'PREVIEW_STATE_CONFLICT')
    return createPlannerReadSnapshot(canonicalRecord({ schema_version: PREVIEW_RELEASE_SNAPSHOT_VERSION, kind: 'REVOKE', timestamp: timestampValue, app_version: options.appVersion, fact }, 'revoke snapshot'))
  } catch (error) {
    if (error instanceof PreviewContractError) return errorSnapshot(timestampValue, error.code)
    throw new PreviewReleasePlannerError('STATE_CONFLICT', error instanceof Error ? error.message : String(error))
  }
}

function eventPayload(envelope: CommandEnvelopeV2, planVersion: string, resultRecipeVersion: string, appVersion: string, fact: Record<string, CanonicalJsonValue>): Record<string, CanonicalJsonValue> {
  return {
    event_payload_version: PREVIEW_RELEASE_EVENT_PAYLOAD_VERSION,
    batch_context: batchContext(envelope, planVersion, resultRecipeVersion),
    actor_role: envelope.actor.kind === 'USER' ? envelope.actor.role : 'SYSTEM',
    app_version: appVersion,
    correlation_id: envelope.correlationId,
    contract_version: PREVIEW_CONTRACT_VERSION,
    allowed_shell_kind: 'PREVIEW_SHELL',
    ...fact
  }
}

function makeEvent(envelope: CommandEnvelopeV2, eventType: 'PREVIEW_PACK_RELEASED' | 'PREVIEW_PACK_REVOKED', aggregateId: string, planVersion: string, resultRecipeVersion: string, timestampValue: string, appVersion: string, fact: Record<string, CanonicalJsonValue>): EventIntentV1 {
  return {
    eventId: deterministicUuid(envelope.commandId, eventType),
    aggregateType: 'PREVIEW_RELEASE',
    aggregateId,
    eventType,
    eventSequence: 1,
    actorId: envelope.actorId,
    timestamp: timestampValue,
    payload: eventPayload(envelope, planVersion, resultRecipeVersion, appVersion, fact) as EventIntentV1['payload']
  }
}

export class PreviewReleasePlanner {
  plan(input: { envelope: CommandEnvelopeV2; snapshot: PlannerReadSnapshot<CanonicalJsonValue> }): CommandPlanV1 {
    const command = input.envelope.commandType as ReleaseCommand
    const planVersion = PREVIEW_RELEASE_PLAN_VERSIONS[command]
    const resultRecipeVersion = PREVIEW_RELEASE_RESULT_RECIPE_VERSIONS[command]
    if (!planVersion || !resultRecipeVersion) throw new PreviewReleasePlannerError('COMMAND_UNSUPPORTED', input.envelope.commandType)
    const snapshot = record(input.snapshot.value, 'snapshot')
    if (snapshot.schema_version !== PREVIEW_RELEASE_SNAPSHOT_VERSION) throw new PreviewReleasePlannerError('INVALID_INPUT', 'snapshot version mismatch')
    const timestampValue = timestamp(snapshot.timestamp)
    if (snapshot.kind === 'NO_OP') return { schemaVersion: COMMAND_PLAN_SCHEMA_VERSION, commandId: input.envelope.commandId, commandType: command, planVersion, resultRecipeVersion, events: [], operationalEffects: [], noOpResult: record(snapshot.no_op_result, 'snapshot.no_op_result') }
    const fact = record(snapshot.fact, 'snapshot.fact')
    const appVersion = text(snapshot.app_version, 'snapshot.app_version')
    const eventType = snapshot.kind === 'RELEASE' ? 'PREVIEW_PACK_RELEASED' : snapshot.kind === 'REVOKE' ? 'PREVIEW_PACK_REVOKED' : null
    if (!eventType) throw new PreviewReleasePlannerError('INVALID_INPUT', 'snapshot kind is invalid')
    const aggregateId = text(fact.release_id, 'fact.release_id')
    const event = makeEvent(input.envelope, eventType, aggregateId, planVersion, resultRecipeVersion, timestampValue, appVersion, fact)
    return { schemaVersion: COMMAND_PLAN_SCHEMA_VERSION, commandId: input.envelope.commandId, commandType: command, planVersion, resultRecipeVersion, events: [event], operationalEffects: [], noOpResult: null }
  }
}
