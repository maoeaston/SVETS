import type { CanonicalJsonValue } from '../event-batch/canonical-json'
import type { PreparedProjectorContext, PreparedPreApplyEffectV1 } from '../event-batch/result-registry'
import { PreparedFactRegistry } from '../event-batch/result-registry'
import { PREVIEW_CONTRACT_MIGRATION_ID, PREVIEW_CONTRACT_VERSION } from '../../../shared/types/preview-contract'
import { PREVIEW_CONTRACT_REGISTRY, type PreviewEventOwnershipDescriptor } from '../preview/preview-contract-registry'
import { PreviewContractError } from '../preview/preview-errors'
import { projectPreviewEvent, assertPreviewEventProjected } from './preview-event-projection'
import type { FeedbackVault, PreparedFeedbackCommit } from '../feedback-vault/feedback-vault'
import type { AnonymousFeedbackExportV1 } from '../feedback-vault/feedback-export'
import { assertFeedbackProof, feedbackProofHash, type FeedbackCommitProofV1 } from '../feedback-vault/vault-proof'

export const PREVIEW_FEEDBACK_PROJECTOR_NAME = 'preview-feedback-projector-v1'
export const PREVIEW_FEEDBACK_EVENT_PAYLOAD_VERSION = 1
export const PREVIEW_FEEDBACK_RESULT_RECIPE_VERSIONS = Object.freeze({
  'feedback:saveDraft': 'preview.feedback-draft-save.result.v1',
  'feedback:submit': 'preview.feedback-submit.result.v1',
  'feedback:reconcile': 'preview.feedback-reconcile.result.v1',
  'feedback:delete': 'preview.feedback-delete.result.v1',
  'feedback:purge': 'preview.feedback-purge.result.v1',
  'feedback:repair': 'preview.feedback-repair.result.v1',
  'feedback:export': 'preview.feedback-export.result.v1'
})

type FeedbackEventType =
  | 'PREVIEW_FEEDBACK_DRAFT_SAVED'
  | 'PREVIEW_FEEDBACK_REFERENCE_COMMITTED'
  | 'PREVIEW_FEEDBACK_RECONCILED'
  | 'PREVIEW_FEEDBACK_TOMBSTONE_COMMITTED'
  | 'PREVIEW_FEEDBACK_PURGED'
  | 'PREVIEW_FEEDBACK_REPAIRED'
  | 'PREVIEW_FEEDBACK_EXPORT_COMMITTED'

const METADATA_KEYS = ['actor_role', 'allowed_shell_kind', 'app_version', 'batch_context', 'contract_version', 'correlation_id', 'event_payload_version'] as const
const BASE_KEYS = [...METADATA_KEYS, 'body_hash', 'feedback_commit_id', 'feedback_id', 'organization_id', 'proof_hash', 'revision_no', 'session_export_ref', 'session_id', 'status_after', 'subject_export_ref', 'vault_commit'] as const
const TOMBSTONE_KEYS = [...METADATA_KEYS, 'audit_ref', 'body_hash', 'feedback_commit_id', 'feedback_id', 'organization_id', 'proof_hash', 'reason_code', 'revision_no', 'session_id', 'status_after', 'tombstoned_at', 'tombstoned_by', 'vault_commit'] as const
const REPAIR_KEYS = [...METADATA_KEYS, 'capability_ref', 'feedback_commit_id', 'feedback_id', 'proof_hash', 'revision_no', 'status_after', 'target_commit_id'] as const
const PURGE_KEYS = [...METADATA_KEYS, 'capability_ref', 'feedback_commit_id', 'feedback_id', 'proof_hash', 'revision_no', 'status_after', 'target_commit_id'] as const
const EXPORT_KEYS = [...METADATA_KEYS, 'export_artifact', 'feedback_commit_id', 'feedback_id', 'proof_hash', 'revision_no', 'status_after', 'vault_commit'] as const

type Payload = Readonly<Record<string, CanonicalJsonValue>>

function exactKeys(payload: Payload, expected: readonly string[]): void {
  const actual = Object.keys(payload).sort()
  const wanted = [...expected].sort()
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) throw new PreviewContractError('PREVIEW_UNKNOWN_FIELD', 'feedback payload field set mismatch')
}

function text(value: CanonicalJsonValue | undefined, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) throw new PreviewContractError('PREVIEW_CANONICAL_INVALID', `${field} is invalid`, field)
  return value
}

function integer(value: CanonicalJsonValue | undefined, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new PreviewContractError('PREVIEW_CANONICAL_INVALID', `${field} is invalid`, field)
  return value as number
}

function record(value: CanonicalJsonValue | undefined, field: string): Record<string, CanonicalJsonValue> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new PreviewContractError('PREVIEW_CANONICAL_INVALID', `${field} is invalid`, field)
  return value as Record<string, CanonicalJsonValue>
}

function metadata(payload: Payload): void {
  if (payload.event_payload_version !== PREVIEW_FEEDBACK_EVENT_PAYLOAD_VERSION || payload.contract_version !== PREVIEW_CONTRACT_VERSION || payload.allowed_shell_kind !== 'PREVIEW_SHELL') throw new PreviewContractError('PREVIEW_EVENT_OWNERSHIP_CONFLICT', 'feedback event ownership metadata is invalid')
  if (payload.actor_role !== 'STUDENT' && payload.actor_role !== 'TEACHER' && payload.actor_role !== 'ADMIN' && payload.actor_role !== 'SYSTEM') throw new PreviewContractError('PREVIEW_SCOPE_INVALID', 'feedback event actor role is invalid')
  record(payload.batch_context, 'batch_context')
  text(payload.app_version, 'app_version')
  text(payload.correlation_id, 'correlation_id')
}

function proof(payload: Payload, field = 'vault_commit'): PreparedFeedbackCommit {
  const commit = record(payload[field], field)
  const commitProof = assertFeedbackProof(record(commit.proof, `${field}.proof`) as unknown as FeedbackCommitProofV1)
  const proofHash = text(commit.proof_hash, `${field}.proof_hash`)
  if (feedbackProofHash(commitProof) !== proofHash) throw new PreviewContractError('FEEDBACK_COMMIT_CONFLICT', 'feedback vault proof hash mismatch')
  return {
    feedback_commit_id: text(commit.feedback_commit_id, `${field}.feedback_commit_id`),
    feedback_id: text(commit.feedback_id, `${field}.feedback_id`),
    revision_no: integer(commit.revision_no, `${field}.revision_no`),
    operation: commitProof.operation,
    proof: commitProof,
    proof_hash: proofHash,
    body_hash: text(commit.body_hash, `${field}.body_hash`),
    state: 'VAULT_INTENT_PREPARED'
  }
}

export function validatePreviewFeedbackPayload(eventType: FeedbackEventType, payload: Payload): void {
  metadata(payload)
  if (eventType === 'PREVIEW_FEEDBACK_DRAFT_SAVED' || eventType === 'PREVIEW_FEEDBACK_REFERENCE_COMMITTED' || eventType === 'PREVIEW_FEEDBACK_RECONCILED') {
    exactKeys(payload, BASE_KEYS)
    for (const field of ['feedback_id', 'feedback_commit_id', 'organization_id', 'session_export_ref', 'subject_export_ref', 'session_id', 'body_hash', 'proof_hash']) text(payload[field], field)
    integer(payload.revision_no, 'revision_no')
    const status = eventType === 'PREVIEW_FEEDBACK_DRAFT_SAVED' ? 'DRAFT' : eventType === 'PREVIEW_FEEDBACK_REFERENCE_COMMITTED' ? 'VAULT_PREPARED' : 'RECONCILED_SUBMITTED'
    if (payload.status_after !== status) throw new PreviewContractError('FEEDBACK_STATE_CONFLICT', 'feedback status transition is invalid')
    proof(payload)
    return
  }
  if (eventType === 'PREVIEW_FEEDBACK_TOMBSTONE_COMMITTED') {
    exactKeys(payload, TOMBSTONE_KEYS)
    for (const field of ['feedback_id', 'feedback_commit_id', 'organization_id', 'session_id', 'body_hash', 'proof_hash', 'reason_code', 'tombstoned_by', 'tombstoned_at', 'audit_ref']) text(payload[field], field)
    integer(payload.revision_no, 'revision_no')
    if (payload.status_after !== 'RECONCILED_DELETED') throw new PreviewContractError('FEEDBACK_STATE_CONFLICT', 'tombstone status is invalid')
    proof(payload)
    return
  }
  if (eventType === 'PREVIEW_FEEDBACK_REPAIRED') {
    exactKeys(payload, REPAIR_KEYS)
    for (const field of ['feedback_id', 'feedback_commit_id', 'proof_hash', 'target_commit_id', 'capability_ref']) text(payload[field], field)
    integer(payload.revision_no, 'revision_no')
    if (payload.status_after !== 'RECONCILED_SUBMITTED' && payload.status_after !== 'RECONCILED_DELETED') throw new PreviewContractError('FEEDBACK_STATE_CONFLICT', 'repair status is invalid')
    return
  }
  if (eventType === 'PREVIEW_FEEDBACK_PURGED') {
    exactKeys(payload, PURGE_KEYS)
    for (const field of ['feedback_id', 'feedback_commit_id', 'proof_hash', 'target_commit_id', 'capability_ref']) text(payload[field], field)
    integer(payload.revision_no, 'revision_no')
    if (payload.status_after !== 'PURGED') throw new PreviewContractError('FEEDBACK_STATE_CONFLICT', 'purge status is invalid')
    return
  }
  exactKeys(payload, EXPORT_KEYS)
  for (const field of ['feedback_id', 'feedback_commit_id', 'proof_hash']) text(payload[field], field)
  integer(payload.revision_no, 'revision_no')
  if (payload.status_after !== 'EXPORTED') throw new PreviewContractError('FEEDBACK_STATE_CONFLICT', 'export status is invalid')
  record(payload.export_artifact, 'export_artifact')
  proof(payload)
}

function descriptor(eventType: FeedbackEventType): PreviewEventOwnershipDescriptor {
  return { event_type: eventType, event_payload_version: PREVIEW_FEEDBACK_EVENT_PAYLOAD_VERSION, aggregate_type: 'PREVIEW_FEEDBACK', contract_version: PREVIEW_CONTRACT_VERSION, allowed_shell_kind: 'PREVIEW_SHELL', projector_name: PREVIEW_FEEDBACK_PROJECTOR_NAME, result_suppressed: true }
}

function referenceFromPayload(context: PreparedProjectorContext, payload: Payload, status: string, eventId: string): void {
  const commit = proof(payload)
  context.database.prepare(
    `INSERT INTO preview_feedback_reference_projection (
      feedback_id, revision_no, feedback_commit_id, proof_hash, session_id,
      organization_id, status, body_hash, session_export_ref, subject_export_ref,
      created_event_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(payload.feedback_id, payload.revision_no, commit.feedback_commit_id, payload.proof_hash, payload.session_id, payload.organization_id, status, payload.body_hash, payload.session_export_ref, payload.subject_export_ref, eventId)
}

class FeedbackVaultCommitEffect implements PreparedPreApplyEffectV1 {
  readonly effectType = 'FEEDBACK_VAULT_COMMIT'
  readonly effectVersion = 1
  constructor(private readonly vault: FeedbackVault | undefined) {}
  ensurePrepared(context: PreparedProjectorContext): void {
    if (!this.vault) throw new PreviewContractError('FEEDBACK_RECONCILE_REQUIRED', 'feedback vault is unavailable')
    const commit = proof(context.event.record.payload)
    this.vault.commitPrepared(commit)
  }
  assertPrepared(context: PreparedProjectorContext): void {
    if (!this.vault) throw new PreviewContractError('FEEDBACK_RECONCILE_REQUIRED', 'feedback vault is unavailable')
    this.vault.assertPrepared(proof(context.event.record.payload))
  }
}

class FeedbackVaultExportEffect implements PreparedPreApplyEffectV1 {
  readonly effectType = 'FEEDBACK_VAULT_EXPORT'
  readonly effectVersion = 1
  constructor(private readonly vault: FeedbackVault | undefined) {}
  ensurePrepared(context: PreparedProjectorContext): void {
    if (!this.vault) throw new PreviewContractError('FEEDBACK_RECONCILE_REQUIRED', 'feedback vault is unavailable')
    const payload = context.event.record.payload
    const artifact = record(payload.export_artifact, 'export_artifact') as unknown as AnonymousFeedbackExportV1
    this.vault.publishExport(proof(payload), artifact)
  }
  assertPrepared(context: PreparedProjectorContext): void {
    if (!this.vault) throw new PreviewContractError('FEEDBACK_RECONCILE_REQUIRED', 'feedback vault is unavailable')
    const payload = context.event.record.payload
    const artifact = record(payload.export_artifact, 'export_artifact') as unknown as AnonymousFeedbackExportV1
    this.vault.publishExport(proof(payload), artifact)
  }
}

class FeedbackVaultPurgeEffect implements PreparedPreApplyEffectV1 {
  readonly effectType = 'FEEDBACK_VAULT_PURGE'
  readonly effectVersion = 1
  constructor(private readonly vault: FeedbackVault | undefined) {}
  ensurePrepared(context: PreparedProjectorContext): void {
    if (!this.vault) throw new PreviewContractError('FEEDBACK_RECONCILE_REQUIRED', 'feedback vault is unavailable')
    const payload = context.event.record.payload
    this.vault.purgeRevision({
      feedback_commit_id: text(payload.target_commit_id, 'target_commit_id'),
      feedback_id: text(payload.feedback_id, 'feedback_id'),
      revision_no: integer(payload.revision_no, 'revision_no'),
      proof_hash: text(payload.proof_hash, 'proof_hash'),
      purged_at: context.event.record.timestamp
    })
  }
  assertPrepared(context: PreparedProjectorContext): void {
    if (!this.vault) throw new PreviewContractError('FEEDBACK_RECONCILE_REQUIRED', 'feedback vault is unavailable')
    const commitId = text(context.event.record.payload.target_commit_id, 'target_commit_id')
    if (this.vault.commitIdState(commitId) !== 'VAULT_PURGED') throw new PreviewContractError('FEEDBACK_RECONCILE_REQUIRED', 'feedback purge did not reach the vault purge marker')
  }
}

export function projectPreviewFeedback(context: PreparedProjectorContext): void {
  try {
    projectPreviewEvent(context)
    const eventType = context.event.record.event_type as FeedbackEventType
    const payload = context.event.record.payload
    validatePreviewFeedbackPayload(eventType, payload)
    if (eventType === 'PREVIEW_FEEDBACK_DRAFT_SAVED') referenceFromPayload(context, payload, 'DRAFT', context.event.record.event_id)
    else if (eventType === 'PREVIEW_FEEDBACK_REFERENCE_COMMITTED') referenceFromPayload(context, payload, 'VAULT_PREPARED', context.event.record.event_id)
    else if (eventType === 'PREVIEW_FEEDBACK_RECONCILED') {
      context.database.prepare('UPDATE preview_feedback_reference_projection SET status = ?, created_event_id = ? WHERE feedback_id = ? AND revision_no = ? AND feedback_commit_id = ?').run('RECONCILED_SUBMITTED', context.event.record.event_id, payload.feedback_id, payload.revision_no, payload.feedback_commit_id)
    } else if (eventType === 'PREVIEW_FEEDBACK_TOMBSTONE_COMMITTED') {
      context.database.prepare('INSERT INTO preview_feedback_tombstone_projection (tombstone_id, feedback_id, revision_no, feedback_commit_id, proof_hash, reason_code, tombstoned_by, tombstoned_at, audit_ref, created_event_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(`${payload.feedback_id}:${payload.revision_no}:${payload.feedback_commit_id}`, payload.feedback_id, payload.revision_no, payload.feedback_commit_id, payload.proof_hash, payload.reason_code, payload.tombstoned_by, payload.tombstoned_at, payload.audit_ref, context.event.record.event_id)
      context.database.prepare("UPDATE preview_feedback_reference_projection SET status = ?, created_event_id = ? WHERE feedback_id = ? AND revision_no = ? AND status IN ('RECONCILED_SUBMITTED', 'RECONCILE_REQUIRED')").run('RECONCILED_DELETED', context.event.record.event_id, payload.feedback_id, payload.revision_no)
    } else if (eventType === 'PREVIEW_FEEDBACK_REPAIRED') {
      context.database.prepare('UPDATE preview_feedback_reference_projection SET status = ?, created_event_id = ? WHERE feedback_id = ? AND revision_no = ? AND feedback_commit_id = ?').run(payload.status_after, context.event.record.event_id, payload.feedback_id, payload.revision_no, payload.target_commit_id)
    } else if (eventType === 'PREVIEW_FEEDBACK_PURGED') {
      context.database.prepare('UPDATE preview_feedback_reference_projection SET status = ?, created_event_id = ? WHERE feedback_id = ? AND revision_no = ?').run('PURGED', context.event.record.event_id, payload.feedback_id, payload.revision_no)
    }
  } finally {
    // Projection writes remain inside the caller's M5B APPLY transaction.
  }
}

export function assertPreviewFeedbackProjected(context: PreparedProjectorContext): void {
  assertPreviewEventProjected(context)
  const eventType = context.event.record.event_type as FeedbackEventType
  const payload = context.event.record.payload
  validatePreviewFeedbackPayload(eventType, payload)
  if (eventType === 'PREVIEW_FEEDBACK_TOMBSTONE_COMMITTED') {
    const row = context.database.prepare('SELECT proof_hash, created_event_id FROM preview_feedback_tombstone_projection WHERE feedback_id = ? AND revision_no = ?').get(payload.feedback_id, payload.revision_no) as { proof_hash: string; created_event_id: string } | undefined
    const reference = context.database.prepare("SELECT status FROM preview_feedback_reference_projection WHERE feedback_id = ? AND revision_no = ? AND status = 'RECONCILED_DELETED'").get(payload.feedback_id, payload.revision_no) as { status: string } | undefined
    if (!row || row.proof_hash !== payload.proof_hash || row.created_event_id !== context.event.record.event_id || !reference) throw new PreviewContractError('FEEDBACK_RECONCILE_REQUIRED', 'feedback tombstone projection mismatch')
    return
  }
  if (eventType === 'PREVIEW_FEEDBACK_EXPORT_COMMITTED') {
    const commit = proof(payload)
    const row = context.database.prepare(
      'SELECT feedback_commit_id, proof_hash, body_hash, status FROM preview_feedback_reference_projection WHERE feedback_id = ? AND revision_no = ?'
    ).get(payload.feedback_id, payload.revision_no) as { feedback_commit_id: string; proof_hash: string; body_hash: string; status: string } | undefined
    if (!row || row.status !== 'RECONCILED_SUBMITTED' || row.feedback_commit_id !== payload.feedback_commit_id || row.proof_hash !== payload.proof_hash || row.body_hash !== commit.body_hash) {
      throw new PreviewContractError('FEEDBACK_RECONCILE_REQUIRED', 'feedback export reference projection mismatch')
    }
    return
  }
  const targetCommit = eventType === 'PREVIEW_FEEDBACK_REPAIRED' ? payload.target_commit_id : payload.feedback_commit_id
  const row = context.database.prepare('SELECT status, proof_hash, created_event_id FROM preview_feedback_reference_projection WHERE feedback_id = ? AND revision_no = ? AND feedback_commit_id = ?').get(payload.feedback_id, payload.revision_no, targetCommit) as { status: string; proof_hash: string; created_event_id: string } | undefined
  if (!row || row.status !== payload.status_after || row.proof_hash !== payload.proof_hash || row.created_event_id !== context.event.record.event_id) throw new PreviewContractError('FEEDBACK_RECONCILE_REQUIRED', 'feedback reference projection mismatch')
}

function effectFor(eventType: FeedbackEventType, vault: FeedbackVault | undefined): readonly PreparedPreApplyEffectV1[] {
  if (eventType === 'PREVIEW_FEEDBACK_DRAFT_SAVED' || eventType === 'PREVIEW_FEEDBACK_REFERENCE_COMMITTED' || eventType === 'PREVIEW_FEEDBACK_TOMBSTONE_COMMITTED') return [new FeedbackVaultCommitEffect(vault)]
  if (eventType === 'PREVIEW_FEEDBACK_EXPORT_COMMITTED') return [new FeedbackVaultExportEffect(vault)]
  if (eventType === 'PREVIEW_FEEDBACK_PURGED') return [new FeedbackVaultPurgeEffect(vault)]
  return []
}

export function registerPreviewFeedbackPreparedFacts(registry: PreparedFactRegistry, vault?: FeedbackVault): void {
  const events: readonly FeedbackEventType[] = ['PREVIEW_FEEDBACK_DRAFT_SAVED', 'PREVIEW_FEEDBACK_REFERENCE_COMMITTED', 'PREVIEW_FEEDBACK_RECONCILED', 'PREVIEW_FEEDBACK_TOMBSTONE_COMMITTED', 'PREVIEW_FEEDBACK_REPAIRED', 'PREVIEW_FEEDBACK_PURGED', 'PREVIEW_FEEDBACK_EXPORT_COMMITTED']
  for (const eventType of events) registry.registerEvent({ eventType, eventPayloadVersion: PREVIEW_FEEDBACK_EVENT_PAYLOAD_VERSION, ownership: { aggregateType: 'PREVIEW_FEEDBACK', contractVersion: PREVIEW_CONTRACT_VERSION, allowedShellKind: 'PREVIEW_SHELL' }, projectorName: PREVIEW_FEEDBACK_PROJECTOR_NAME, validatePayload: (payload) => validatePreviewFeedbackPayload(eventType, payload), project: projectPreviewFeedback, assertProjected: assertPreviewFeedbackProjected, operationalEffects: [], preApplyEffects: effectFor(eventType, vault) })
  for (const [commandType, resultRecipeVersion] of Object.entries(PREVIEW_FEEDBACK_RESULT_RECIPE_VERSIONS)) registry.registerResult({ commandType, resultRecipeVersion, fromPrepared: ({ batch }) => ({ success: true, commandType, eventId: batch.events[0]?.record.event_id ?? '' }) })
}

let registered = false
export function registerPreviewFeedbackContract(): void {
  if (registered) return
  registered = true
  const events: readonly FeedbackEventType[] = ['PREVIEW_FEEDBACK_DRAFT_SAVED', 'PREVIEW_FEEDBACK_REFERENCE_COMMITTED', 'PREVIEW_FEEDBACK_RECONCILED', 'PREVIEW_FEEDBACK_TOMBSTONE_COMMITTED', 'PREVIEW_FEEDBACK_REPAIRED', 'PREVIEW_FEEDBACK_PURGED', 'PREVIEW_FEEDBACK_EXPORT_COMMITTED']
  for (const eventType of events) PREVIEW_CONTRACT_REGISTRY.registerEvent(descriptor(eventType))
  const commandEvents: Readonly<Record<string, FeedbackEventType>> = { 'feedback:saveDraft': 'PREVIEW_FEEDBACK_DRAFT_SAVED', 'feedback:submit': 'PREVIEW_FEEDBACK_REFERENCE_COMMITTED', 'feedback:reconcile': 'PREVIEW_FEEDBACK_RECONCILED', 'feedback:delete': 'PREVIEW_FEEDBACK_TOMBSTONE_COMMITTED', 'feedback:purge': 'PREVIEW_FEEDBACK_PURGED', 'feedback:repair': 'PREVIEW_FEEDBACK_REPAIRED', 'feedback:export': 'PREVIEW_FEEDBACK_EXPORT_COMMITTED' }
  const commandRoles: Readonly<Record<string, readonly ('TEACHER' | 'ADMIN')[]>> = {
    'feedback:saveDraft': ['TEACHER', 'ADMIN'],
    'feedback:submit': ['TEACHER', 'ADMIN'],
    'feedback:export': ['TEACHER', 'ADMIN'],
    'feedback:reconcile': ['ADMIN'],
    'feedback:delete': ['ADMIN'],
    'feedback:purge': ['ADMIN'],
    'feedback:repair': ['ADMIN']
  }
  for (const [commandType, eventType] of Object.entries(commandEvents)) PREVIEW_CONTRACT_REGISTRY.registerCommand({ command_type: commandType, contract_version: PREVIEW_CONTRACT_VERSION, allowed_roles: commandRoles[commandType], event_types: [eventType], result_recipe_version: PREVIEW_FEEDBACK_RESULT_RECIPE_VERSIONS[commandType as keyof typeof PREVIEW_FEEDBACK_RESULT_RECIPE_VERSIONS], recovery_registered: true })
  PREVIEW_CONTRACT_REGISTRY.registerProjection({ projection_name: 'preview_feedback_reference_projection', canonical_owner: PREVIEW_FEEDBACK_PROJECTOR_NAME, contract_version: PREVIEW_CONTRACT_VERSION, migration_id: PREVIEW_CONTRACT_MIGRATION_ID })
  PREVIEW_CONTRACT_REGISTRY.registerProjection({ projection_name: 'preview_feedback_tombstone_projection', canonical_owner: PREVIEW_FEEDBACK_PROJECTOR_NAME, contract_version: PREVIEW_CONTRACT_VERSION, migration_id: PREVIEW_CONTRACT_MIGRATION_ID })
}
