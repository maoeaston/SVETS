import { canonicalJson, type CanonicalJsonValue } from '../event-batch/canonical-json'
import type { PreparedProjectorContext } from '../event-batch/result-registry'
import { PreparedFactRegistry } from '../event-batch/result-registry'
import {
  PREVIEW_CONTRACT_MIGRATION_ID,
  PREVIEW_CONTRACT_VERSION
} from '../../../shared/types/preview-contract'
import {
  assertPreviewEventProjected,
  projectPreviewEvent,
  previewPayloadRecord
} from './preview-event-projection'
import {
  validatePreviewReleaseFact,
  validatePreviewRevokeFact,
  type PreviewReleaseFact,
  type PreviewRevokeFact
} from '../preview/preview-release-validator'
import { PreviewContractError } from '../preview/preview-errors'
import { PREVIEW_CONTRACT_REGISTRY, type PreviewEventOwnershipDescriptor } from '../preview/preview-contract-registry'

export const PREVIEW_RELEASE_PROJECTOR_NAME = 'preview-release-projector-v1'
export const PREVIEW_RELEASE_EVENT_PAYLOAD_VERSION = 1
export const PREVIEW_RELEASE_RESULT_RECIPE_VERSIONS = Object.freeze({
  'preview:releasePack': 'preview.preview-pack-release.result.v1',
  'preview:revokePack': 'preview.preview-pack-revoke.result.v1'
})

const METADATA_KEYS = ['actor_role', 'allowed_shell_kind', 'app_version', 'batch_context', 'contract_version', 'correlation_id', 'event_payload_version'] as const
const RELEASE_KEYS = [...METADATA_KEYS, 'approval_hash', 'approval_id', 'audit_ref', 'delivery_mode', 'effective_at', 'expires_at', 'manifest_hash', 'manifest_id', 'pack_hash', 'pack_id', 'pack_version', 'policy_hash', 'question_id', 'question_version', 'references', 'release_id', 'semantic_hash', 'source_ref_id', 'status_after', 'strategy_id', 'strategy_version'] as const
const REVOKE_KEYS = [...METADATA_KEYS, 'audit_ref', 'release_id', 'revoked_at', 'source_ref_id', 'status_after', 'status_before'] as const

type PreviewPayload = Readonly<Record<string, CanonicalJsonValue>>

function metadata(payload: PreviewPayload): void {
  if (payload.event_payload_version !== PREVIEW_RELEASE_EVENT_PAYLOAD_VERSION) throw new PreviewContractError('PREVIEW_CANONICAL_INVALID', 'preview release event payload version is invalid')
  if (payload.contract_version !== PREVIEW_CONTRACT_VERSION || payload.allowed_shell_kind !== 'PREVIEW_SHELL') throw new PreviewContractError('PREVIEW_EVENT_OWNERSHIP_CONFLICT', 'preview release event ownership is invalid')
  if (payload.actor_role !== 'ADMIN' && payload.actor_role !== 'SYSTEM') throw new PreviewContractError('PREVIEW_SCOPE_INVALID', 'preview release actor role is invalid')
  if (typeof payload.batch_context !== 'object' || payload.batch_context === null || Array.isArray(payload.batch_context)) throw new PreviewContractError('PREVIEW_CANONICAL_INVALID', 'batch_context is invalid')
}

function exactKeys(payload: PreviewPayload, expected: readonly string[]): void {
  const actual = Object.keys(payload).sort()
  const wanted = [...expected].sort()
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) throw new PreviewContractError('PREVIEW_UNKNOWN_FIELD', `preview release payload field set mismatch: ${actual.join(',')}`)
}

export function validatePreviewReleasePayload(payload: PreviewPayload): PreviewReleaseFact {
  metadata(payload)
  exactKeys(payload, RELEASE_KEYS)
  return validatePreviewReleaseFact({
    release_id: payload.release_id as string,
    source_ref_id: payload.source_ref_id as string,
    delivery_mode: payload.delivery_mode as 'PREVIEW_ONLY',
    question_id: payload.question_id as string,
    question_version: payload.question_version as number,
    semantic_hash: payload.semantic_hash as string,
    pack_id: payload.pack_id as string,
    pack_version: payload.pack_version as string,
    pack_hash: payload.pack_hash as string,
    strategy_id: payload.strategy_id as string,
    strategy_version: payload.strategy_version as number,
    policy_hash: payload.policy_hash as string,
    approval_id: payload.approval_id as string,
    approval_hash: payload.approval_hash as string,
    manifest_id: payload.manifest_id as string,
    manifest_hash: payload.manifest_hash as string,
    references: previewPayloadRecord(payload.references, 'references') as never,
    status_after: payload.status_after as 'ACTIVE',
    effective_at: payload.effective_at as string,
    expires_at: payload.expires_at as string,
    audit_ref: payload.audit_ref as string
  })
}

export function validatePreviewRevokePayload(payload: PreviewPayload): PreviewRevokeFact {
  metadata(payload)
  exactKeys(payload, REVOKE_KEYS)
  return validatePreviewRevokeFact({
    release_id: payload.release_id as string,
    source_ref_id: payload.source_ref_id as string,
    status_before: payload.status_before as PreviewRevokeFact['status_before'],
    status_after: payload.status_after as 'REVOKED',
    revoked_at: payload.revoked_at as string,
    audit_ref: payload.audit_ref as string
  })
}

function descriptor(eventType: 'PREVIEW_PACK_RELEASED' | 'PREVIEW_PACK_REVOKED'): PreviewEventOwnershipDescriptor {
  return {
    event_type: eventType,
    event_payload_version: PREVIEW_RELEASE_EVENT_PAYLOAD_VERSION,
    aggregate_type: 'PREVIEW_RELEASE',
    contract_version: PREVIEW_CONTRACT_VERSION,
    allowed_shell_kind: 'PREVIEW_SHELL',
    projector_name: PREVIEW_RELEASE_PROJECTOR_NAME,
    result_suppressed: true
  }
}

function result(commandType: string, batch: { events: readonly { record: { event_id: string; payload: PreviewPayload } }[] }): Readonly<Record<string, CanonicalJsonValue>> {
  const event = batch.events[0]?.record
  return {
    success: true,
    commandType,
    eventId: event?.event_id ?? '',
    releaseId: typeof event?.payload.release_id === 'string' ? event.payload.release_id : ''
  }
}

export function projectPreviewRelease(context: PreparedProjectorContext): void {
  projectPreviewEvent(context)
  const fact = validatePreviewReleasePayload(context.event.record.payload)
  const existing = context.database.prepare('SELECT release_id, source_ref_id, status, created_event_id FROM preview_release_projection WHERE release_id = ?').get(fact.release_id) as Record<string, unknown> | undefined
  if (existing) throw new PreviewContractError('PREVIEW_IDEMPOTENCY_CONFLICT', `preview release already exists: ${fact.release_id}`)
  context.database.prepare(
    `INSERT INTO preview_release_projection (
      release_id, source_ref_id, delivery_mode, question_id, question_version,
      semantic_hash, pack_id, pack_version, pack_hash, strategy_id, strategy_version,
      policy_hash, approval_id, approval_hash, manifest_id, manifest_hash,
      references_json, status, effective_at, expires_at, revoked_at, created_event_id, audit_ref
    ) VALUES (?, ?, 'PREVIEW_ONLY', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, NULL, ?, ?)`
  ).run(
    fact.release_id,
    fact.source_ref_id,
    fact.question_id,
    fact.question_version,
    fact.semantic_hash,
    fact.pack_id,
    fact.pack_version,
    fact.pack_hash,
    fact.strategy_id,
    fact.strategy_version,
    fact.policy_hash,
    fact.approval_id,
    fact.approval_hash,
    fact.manifest_id,
    fact.manifest_hash,
    canonicalJson(fact.references as never),
    fact.effective_at,
    fact.expires_at,
    context.event.record.event_id,
    fact.audit_ref
  )
}

export function projectPreviewReleaseRevocation(context: PreparedProjectorContext): void {
  projectPreviewEvent(context)
  const fact = validatePreviewRevokePayload(context.event.record.payload)
  const row = context.database.prepare('SELECT release_id, source_ref_id, status FROM preview_release_projection WHERE release_id = ?').get(fact.release_id) as { release_id: string; source_ref_id: string; status: string } | undefined
  if (!row || row.source_ref_id !== fact.source_ref_id || row.status !== fact.status_before) throw new PreviewContractError('PREVIEW_STATE_CONFLICT', 'preview release revoke target is not the frozen release')
  context.database.prepare(
    `UPDATE preview_release_projection SET status = 'REVOKED', revoked_at = ? WHERE release_id = ? AND status = ?`
  ).run(fact.revoked_at, fact.release_id, fact.status_before)
}

export function assertPreviewReleaseProjected(context: PreparedProjectorContext): void {
  assertPreviewEventProjected(context)
  const payload = context.event.record.payload
  if (context.event.record.event_type === 'PREVIEW_PACK_RELEASED') {
    const fact = validatePreviewReleasePayload(payload)
    const row = context.database.prepare('SELECT release_id, source_ref_id, status, created_event_id FROM preview_release_projection WHERE release_id = ?').get(fact.release_id) as Record<string, unknown> | undefined
    if (!row || row.release_id !== fact.release_id || row.source_ref_id !== fact.source_ref_id || row.status !== 'ACTIVE' || row.created_event_id !== context.event.record.event_id) throw new PreviewContractError('PREVIEW_EVENT_OWNERSHIP_CONFLICT', 'preview release projection does not match event')
    return
  }
  const fact = validatePreviewRevokePayload(payload)
  const row = context.database.prepare('SELECT source_ref_id, status, revoked_at FROM preview_release_projection WHERE release_id = ?').get(fact.release_id) as { source_ref_id: string; status: string; revoked_at: string | null } | undefined
  if (!row || row.source_ref_id !== fact.source_ref_id || row.status !== 'REVOKED' || row.revoked_at !== fact.revoked_at) throw new PreviewContractError('PREVIEW_EVENT_OWNERSHIP_CONFLICT', 'preview revoke projection does not match event')
}

export function registerPreviewReleasePreparedFacts(registry: PreparedFactRegistry): void {
  registry.registerEvent({
    eventType: 'PREVIEW_PACK_RELEASED',
    eventPayloadVersion: PREVIEW_RELEASE_EVENT_PAYLOAD_VERSION,
    ownership: { aggregateType: 'PREVIEW_RELEASE', contractVersion: PREVIEW_CONTRACT_VERSION, allowedShellKind: 'PREVIEW_SHELL' },
    projectorName: PREVIEW_RELEASE_PROJECTOR_NAME,
    project: projectPreviewRelease,
    validatePayload: validatePreviewReleasePayload,
    assertProjected: assertPreviewReleaseProjected,
    operationalEffects: []
  })
  registry.registerEvent({
    eventType: 'PREVIEW_PACK_REVOKED',
    eventPayloadVersion: PREVIEW_RELEASE_EVENT_PAYLOAD_VERSION,
    ownership: { aggregateType: 'PREVIEW_RELEASE', contractVersion: PREVIEW_CONTRACT_VERSION, allowedShellKind: 'PREVIEW_SHELL' },
    projectorName: PREVIEW_RELEASE_PROJECTOR_NAME,
    project: projectPreviewReleaseRevocation,
    validatePayload: validatePreviewRevokePayload,
    assertProjected: assertPreviewReleaseProjected,
    operationalEffects: []
  })
  registry.registerResult({ commandType: 'preview:releasePack', resultRecipeVersion: PREVIEW_RELEASE_RESULT_RECIPE_VERSIONS['preview:releasePack'], fromPrepared: ({ batch }) => result('preview:releasePack', batch) })
  registry.registerResult({ commandType: 'preview:revokePack', resultRecipeVersion: PREVIEW_RELEASE_RESULT_RECIPE_VERSIONS['preview:revokePack'], fromPrepared: ({ batch }) => result('preview:revokePack', batch) })
}

let registered = false
export function registerPreviewReleaseContract(): void {
  if (registered) return
  registered = true
  PREVIEW_CONTRACT_REGISTRY.registerEvent(descriptor('PREVIEW_PACK_RELEASED'))
  PREVIEW_CONTRACT_REGISTRY.registerEvent(descriptor('PREVIEW_PACK_REVOKED'))
  for (const commandType of ['preview:releasePack', 'preview:revokePack'] as const) {
    PREVIEW_CONTRACT_REGISTRY.registerCommand({
      command_type: commandType,
      contract_version: PREVIEW_CONTRACT_VERSION,
      allowed_roles: ['ADMIN'],
      event_types: [commandType === 'preview:releasePack' ? 'PREVIEW_PACK_RELEASED' : 'PREVIEW_PACK_REVOKED'],
      result_recipe_version: PREVIEW_RELEASE_RESULT_RECIPE_VERSIONS[commandType],
      recovery_registered: true
    })
  }
  PREVIEW_CONTRACT_REGISTRY.registerProjection({
    projection_name: 'preview_release_projection',
    canonical_owner: PREVIEW_RELEASE_PROJECTOR_NAME,
    contract_version: PREVIEW_CONTRACT_VERSION,
    migration_id: PREVIEW_CONTRACT_MIGRATION_ID
  })
}
