import { createHash } from 'crypto'
import type { DBAdapter } from '../../db/interface'
import type { CommandEnvelopeV2 } from '../command/command-types'
import { BATCH_CONTEXT_SCHEMA_VERSION, COMMAND_PLAN_SCHEMA_VERSION, createPlannerReadSnapshot, type CommandPlanV1, type EventIntentV1, type PlannerReadSnapshot } from '../../domain/event-batch/command-plan'
import { canonicalJson, type CanonicalJsonValue } from '../../domain/event-batch/canonical-json'
import { PREVIEW_CONTRACT_VERSION } from '../../../shared/types/preview-contract'
import { PreviewContractError } from '../../domain/preview/preview-errors'
import { assertCanonicalReferenceSet, parsePreviewCanonicalJson } from '../../domain/preview/preview-canonical'
import { assertPreviewProjectionStatus } from '../../domain/projectors/preview-event-projection'
import { PREVIEW_FEEDBACK_EVENT_PAYLOAD_VERSION, PREVIEW_FEEDBACK_RESULT_RECIPE_VERSIONS } from '../../domain/projectors/preview-feedback-projector'
import { FeedbackVault, type PreparedFeedbackCommit } from '../../domain/feedback-vault/feedback-vault'
import { FeedbackDeleteService } from '../../domain/feedback-vault/feedback-delete-service'
import { readVaultPurgeMarker } from '../../domain/feedback-vault/vault-journal'

export const PREVIEW_FEEDBACK_SNAPSHOT_VERSION = 'preview-feedback-plan-snapshot-v1'
export const PREVIEW_FEEDBACK_PLAN_VERSIONS = Object.freeze({
  'feedback:saveDraft': 'preview.feedback-draft-save.plan.v1',
  'feedback:submit': 'preview.feedback-submit.plan.v1',
  'feedback:reconcile': 'preview.feedback-reconcile.plan.v1',
  'feedback:delete': 'preview.feedback-delete.plan.v1',
  'feedback:purge': 'preview.feedback-purge.plan.v1',
  'feedback:repair': 'preview.feedback-repair.plan.v1',
  'feedback:export': 'preview.feedback-export.plan.v1'
})

export interface PreviewFeedbackTrustContext {
  readonly resolveScope: (envelope: CommandEnvelopeV2) => Readonly<{ installation_id: string; organization_id: string; job_code: string; task_code: string }> | null
  readonly assertCapability: (kind: 'REFERENCE_REPAIR' | 'TOMBSTONE' | 'PURGE' | 'IDENTITY_MAP_READ', envelope: CommandEnvelopeV2, payload: Readonly<Record<string, CanonicalJsonValue>>) => void
}

type FeedbackCommand = keyof typeof PREVIEW_FEEDBACK_PLAN_VERSIONS

function record(value: unknown, field: string): Record<string, CanonicalJsonValue> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${field} must be an object`)
  return value as Record<string, CanonicalJsonValue>
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) throw new Error(`${field} is invalid`)
  return value
}

function timestamp(value: unknown): string {
  const parsed = text(value, 'timestamp')
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(parsed) || new Date(parsed).toISOString() !== parsed) throw new Error('timestamp is invalid')
  return parsed
}

function uuid(commandId: string, eventType: string): string {
  const bytes = createHash('sha256').update('svets:preview-feedback:v1\0').update(commandId).update('\0').update(eventType).digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function context(envelope: CommandEnvelopeV2, planVersion: string, resultRecipeVersion: string) { return { schema_version: BATCH_CONTEXT_SCHEMA_VERSION, plan_version: planVersion, result_recipe_version: resultRecipeVersion, root_command_type: envelope.commandType, root_command_id: envelope.commandId, child_ordinal: 0 } as const }

function errorSnapshot(timestampValue: string, errorCode: string): PlannerReadSnapshot<CanonicalJsonValue> {
  return createPlannerReadSnapshot({ schema_version: PREVIEW_FEEDBACK_SNAPSHOT_VERSION, kind: 'NO_OP', timestamp: timestampValue, no_op_result: { success: false, errorCode } })
}

function commitRecord(commit: PreparedFeedbackCommit): Record<string, CanonicalJsonValue> {
  return JSON.parse(canonicalJson({ feedback_commit_id: commit.feedback_commit_id, feedback_id: commit.feedback_id, revision_no: commit.revision_no, proof_hash: commit.proof_hash, body_hash: commit.body_hash, proof: commit.proof } as unknown as CanonicalJsonValue)) as Record<string, CanonicalJsonValue>
}

function payloadRecord(envelope: CommandEnvelopeV2, planVersion: string, resultRecipeVersion: string, appVersion: string, facts: Record<string, CanonicalJsonValue>): Record<string, CanonicalJsonValue> {
  return { event_payload_version: PREVIEW_FEEDBACK_EVENT_PAYLOAD_VERSION, batch_context: context(envelope, planVersion, resultRecipeVersion), actor_role: envelope.actor.kind === 'USER' ? envelope.actor.role : 'SYSTEM', app_version: appVersion, correlation_id: envelope.correlationId, contract_version: PREVIEW_CONTRACT_VERSION, allowed_shell_kind: 'PREVIEW_SHELL', ...facts }
}

function extractField(envelope: CommandEnvelopeV2, field: string): Record<string, CanonicalJsonValue> { return record(envelope.payload[field], `payload.${field}`) }

function nextSequence(db: DBAdapter, feedbackId: string): number {
  const row = db.prepare("SELECT MAX(event_sequence) AS sequence FROM preview_event_projection WHERE aggregate_type = 'PREVIEW_FEEDBACK' AND aggregate_id = ?").get(feedbackId) as { sequence: number | null } | undefined
  return (row?.sequence ?? 0) + 1
}

function payloadSessionFacts(input: Record<string, CanonicalJsonValue>, commit: PreparedFeedbackCommit): Record<string, CanonicalJsonValue> {
  for (const field of ['session_id', 'organization_id', 'session_export_ref', 'subject_export_ref', 'body_hash']) if (typeof input[field] !== 'string') throw new PreviewContractError('PREVIEW_CANONICAL_INVALID', `${field} is required`)
  return { feedback_id: commit.feedback_id, revision_no: commit.revision_no, feedback_commit_id: commit.feedback_commit_id, proof_hash: commit.proof_hash, body_hash: commit.body_hash, session_id: input.session_id, organization_id: input.organization_id, session_export_ref: input.session_export_ref, subject_export_ref: input.subject_export_ref, vault_commit: commitRecord(commit), status_after: 'DRAFT' }
}

type PreviewFeedbackScope = Readonly<{
  installation_id: string
  organization_id: string
  job_code: string
  task_code: string
}>

function assertFeedbackSessionScope(
  db: DBAdapter,
  sessionId: string,
  organizationId: string,
  scope: PreviewFeedbackScope
): void {
  const row = db.prepare(
    `SELECT s.preview_session_id, s.assessment_session_id, s.job_code, s.task_code,
            s.source_ref_id, p.delivery_mode, p.references_json
       FROM preview_session_projection s
       JOIN preview_release_projection p ON p.source_ref_id = s.source_ref_id
      WHERE s.preview_session_id = ? OR s.assessment_session_id = ?
      LIMIT 1`
  ).get(sessionId, sessionId) as {
    preview_session_id?: string
    assessment_session_id?: string
    job_code?: string
    task_code?: string
    source_ref_id?: string
    delivery_mode?: string
    references_json?: string
  } | undefined
  if (!row || row.delivery_mode !== 'PREVIEW_ONLY' || !row.references_json) {
    throw new PreviewContractError('PREVIEW_SCOPE_INVALID', 'feedback session is not a preview session')
  }
  let references: unknown
  try {
    references = parsePreviewCanonicalJson(row.references_json)
    assertCanonicalReferenceSet(references as never)
  } catch (error) {
    throw new PreviewContractError('PREVIEW_SOURCE_AUTHORITY_MISSING', 'feedback source reference is invalid', undefined, error)
  }
  const source = (references as { source_ref?: { source_ref_id?: string; delivery_mode?: string; namespace?: string; scope?: PreviewFeedbackScope } }).source_ref
  if (!source) throw new PreviewContractError('PREVIEW_SOURCE_AUTHORITY_MISSING', 'feedback source reference is missing')
  if (
    source.source_ref_id !== row.source_ref_id
    || source.delivery_mode !== 'PREVIEW_ONLY'
    || source.namespace !== 'preview_publish_set'
    || source.scope?.installation_id !== scope.installation_id
    || source.scope?.organization_id !== organizationId
    || source.scope?.organization_id !== scope.organization_id
    || source.scope?.job_code !== scope.job_code
    || source.scope?.task_code !== scope.task_code
    || row.job_code !== scope.job_code
    || row.task_code !== scope.task_code
  ) {
    throw new PreviewContractError('PREVIEW_SCOPE_INVALID', 'feedback session/source scope does not match the trusted preview scope')
  }
}

function assertReferenceScopeFromRow(
  db: DBAdapter,
  row: Readonly<Record<string, unknown>>,
  scope: PreviewFeedbackScope
): void {
  if (typeof row.session_id !== 'string' || typeof row.organization_id !== 'string') {
    throw new PreviewContractError('FEEDBACK_RECONCILE_REQUIRED', 'feedback reference scope is incomplete')
  }
  assertFeedbackSessionScope(db, row.session_id, row.organization_id, scope)
}

function assertFeedbackInputScope(
  db: DBAdapter,
  input: Readonly<Record<string, CanonicalJsonValue>>,
  scope: PreviewFeedbackScope
): void {
  if (typeof input.session_id !== 'string' || typeof input.organization_id !== 'string') {
    throw new PreviewContractError('PREVIEW_SCOPE_INVALID', 'feedback session scope is required')
  }
  assertFeedbackSessionScope(db, input.session_id, input.organization_id, scope)
  if (typeof input.feedback_id !== 'string' || typeof input.revision_no !== 'number') return
  const row = db.prepare(
    `SELECT feedback_id, revision_no, session_id, organization_id
       FROM preview_feedback_reference_projection
      WHERE feedback_id = ? AND revision_no = ?
      ORDER BY created_at DESC LIMIT 1`
  ).get(input.feedback_id, input.revision_no) as Record<string, unknown> | undefined
  if (!row) return
  assertReferenceScopeFromRow(db, row, scope)
  if (row.session_id !== input.session_id || row.organization_id !== input.organization_id) {
    throw new PreviewContractError('PREVIEW_SCOPE_INVALID', 'feedback reference is bound to another session or organization')
  }
}

export function loadPreviewFeedbackPlannerSnapshot(db: DBAdapter, envelope: CommandEnvelopeV2, options: { timestamp: string; appVersion: string }, vault: FeedbackVault | undefined, trust: PreviewFeedbackTrustContext | undefined): PlannerReadSnapshot<CanonicalJsonValue> {
  const timestampValue = timestamp(options.timestamp)
  if (!Object.hasOwn(PREVIEW_FEEDBACK_PLAN_VERSIONS, envelope.commandType)) throw new Error(`unsupported feedback command ${envelope.commandType}`)
  try { assertPreviewProjectionStatus(db) } catch (error) { if (error instanceof PreviewContractError) return errorSnapshot(timestampValue, error.code); throw error }
  if (!vault || !trust) return errorSnapshot(timestampValue, 'FEEDBACK_RECONCILE_REQUIRED')
  const scope = trust.resolveScope(envelope)
  if (!scope) return errorSnapshot(timestampValue, 'FEEDBACK_CAPABILITY_INVALID')
  try {
    const command = envelope.commandType as FeedbackCommand
    let snapshot: Record<string, CanonicalJsonValue>
    const field = command === 'feedback:saveDraft' ? 'draft' : command === 'feedback:submit' ? 'submission' : command === 'feedback:delete' ? 'deletion' : command === 'feedback:reconcile' ? 'reconcile' : command === 'feedback:purge' ? 'purge' : command === 'feedback:repair' ? 'repair' : 'export'
    const input = extractField(envelope, field)
    if (command === 'feedback:saveDraft' || command === 'feedback:submit') {
      if (!vault) return errorSnapshot(timestampValue, 'FEEDBACK_RECONCILE_REQUIRED')
      assertFeedbackInputScope(db, input, scope)
      const commit = vault.reserveIntent({ feedback_id: typeof input.feedback_id === 'string' ? input.feedback_id : undefined, revision_no: Number(input.revision_no), operation: command === 'feedback:saveDraft' ? 'DRAFT_SAVE' : 'SUBMIT', body: input.body as never, session_export_ref: String(input.session_export_ref), subject_export_ref: String(input.subject_export_ref), organization_id: String(input.organization_id), installation_id: scope.installation_id, request_hash: envelope.requestHash, actor_auth_ref: envelope.authSessionId ?? envelope.actorId, issued_at: timestampValue, expires_at: String(input.expires_at) })
      const facts = payloadSessionFacts(input, commit)
      facts.status_after = command === 'feedback:saveDraft' ? 'DRAFT' : 'VAULT_PREPARED'
      facts.event_sequence = nextSequence(db, commit.feedback_id)
      snapshot = { schema_version: PREVIEW_FEEDBACK_SNAPSHOT_VERSION, kind: command === 'feedback:saveDraft' ? 'DRAFT' : 'SUBMIT', timestamp: timestampValue, app_version: options.appVersion, input, commit: commitRecord(commit), facts }
    } else if (command === 'feedback:delete') {
      trust.assertCapability('TOMBSTONE', envelope, input)
      assertFeedbackInputScope(db, input, scope)
      const deleteService = new FeedbackDeleteService(db, vault)
      const commit = deleteService.reserveDelete({ feedback_id: String(input.feedback_id), revision_no: Number(input.revision_no), session_export_ref: String(input.session_export_ref), subject_export_ref: String(input.subject_export_ref), organization_id: String(input.organization_id), installation_id: scope.installation_id, request_hash: envelope.requestHash, actor_auth_ref: envelope.authSessionId ?? envelope.actorId, issued_at: timestampValue, expires_at: String(input.expires_at), reason_code: String(input.reason_code) })
      deleteService.assertTombstoneDoesNotReuseSubmitCommit({
        feedback_id: commit.feedback_id,
        revision_no: commit.revision_no,
        feedback_commit_id: commit.feedback_commit_id
      })
      snapshot = { schema_version: PREVIEW_FEEDBACK_SNAPSHOT_VERSION, kind: 'DELETE', timestamp: timestampValue, app_version: options.appVersion, input, commit: commitRecord(commit), facts: { feedback_id: commit.feedback_id, revision_no: commit.revision_no, feedback_commit_id: commit.feedback_commit_id, proof_hash: commit.proof_hash, body_hash: commit.body_hash, session_id: input.session_id, organization_id: input.organization_id, reason_code: input.reason_code, status_after: 'RECONCILED_DELETED', tombstoned_by: envelope.actorId, tombstoned_at: timestampValue, audit_ref: `feedback-delete:${envelope.commandId}`, vault_commit: commitRecord(commit), event_sequence: nextSequence(db, commit.feedback_id) } }
    } else {
      if (command === 'feedback:repair') trust.assertCapability('REFERENCE_REPAIR', envelope, input)
      if (command === 'feedback:purge') trust.assertCapability('PURGE', envelope, input)
      if (command === 'feedback:reconcile') trust.assertCapability('REFERENCE_REPAIR', envelope, input)
      if (command === 'feedback:export') {
        const commitId = String(input.feedback_commit_id)
        const reference = db.prepare(
          `SELECT feedback_id, revision_no, feedback_commit_id, proof_hash, body_hash,
                  session_id, organization_id, session_export_ref, subject_export_ref, status
             FROM preview_feedback_reference_projection
            WHERE feedback_commit_id = ?
              AND status = 'RECONCILED_SUBMITTED'`
        ).get(commitId) as Record<string, unknown> | undefined
        if (!reference) throw new PreviewContractError('FEEDBACK_RECONCILE_REQUIRED', 'feedback export requires a reconciled submitted reference')
        assertReferenceScopeFromRow(db, reference, scope)
        const commit = vault.loadCommit(commitId)
        if (
          commit.proof_hash !== input.proof_hash
          || commit.proof_hash !== reference.proof_hash
          || commit.body_hash !== reference.body_hash
          || commit.state !== 'VAULT_COMMITTED'
          || commit.operation !== 'SUBMIT'
        ) throw new PreviewContractError('FEEDBACK_RECONCILE_REQUIRED', 'feedback export requires a matching reconciled submitted vault commit')
        snapshot = { schema_version: PREVIEW_FEEDBACK_SNAPSHOT_VERSION, kind: 'EXPORT', timestamp: timestampValue, app_version: options.appVersion, input, commit: commitRecord(commit), facts: { feedback_id: commit.feedback_id, feedback_commit_id: commit.feedback_commit_id, proof_hash: commit.proof_hash, revision_no: commit.revision_no, status_after: 'EXPORTED', vault_commit: commitRecord(commit), export_artifact: input.export_artifact, event_sequence: nextSequence(db, commit.feedback_id) } }
      } else {
        const feedbackId = text(input.feedback_id, 'feedback_id')
        const revisionNo = Number(input.revision_no)
        const row = db.prepare('SELECT feedback_id, revision_no, feedback_commit_id, proof_hash, body_hash, session_id, organization_id, session_export_ref, subject_export_ref, status FROM preview_feedback_reference_projection WHERE feedback_id = ? AND revision_no = ? ORDER BY created_at DESC LIMIT 1').get(feedbackId, revisionNo) as Record<string, unknown> | undefined
        if (!row) throw new PreviewContractError('FEEDBACK_RECONCILE_REQUIRED', 'feedback reference is missing')
        assertReferenceScopeFromRow(db, row, scope)
        const targetCommitId = String(input.target_commit_id ?? input.feedback_commit_id ?? row.feedback_commit_id)
        const targetProofHash = String(input.proof_hash ?? row.proof_hash)
        if (command === 'feedback:reconcile') {
          const commit = vault.loadCommit(String(row.feedback_commit_id))
          if (commit.proof_hash !== targetProofHash) throw new PreviewContractError('FEEDBACK_COMMIT_CONFLICT', 'reconcile proof does not match vault commit')
          snapshot = { schema_version: PREVIEW_FEEDBACK_SNAPSHOT_VERSION, kind: 'RECONCILE', timestamp: timestampValue, app_version: options.appVersion, input, facts: { feedback_id: feedbackId, revision_no: revisionNo, feedback_commit_id: String(row.feedback_commit_id), proof_hash: targetProofHash, body_hash: String(row.body_hash), session_id: String(row.session_id), organization_id: String(row.organization_id), session_export_ref: String(row.session_export_ref), subject_export_ref: String(row.subject_export_ref), status_after: 'RECONCILED_SUBMITTED', vault_commit: commitRecord(commit), event_sequence: nextSequence(db, feedbackId) } }
        } else {
          let alreadyPurged = false
          if (command === 'feedback:purge') {
            if (targetCommitId !== String(row.feedback_commit_id) || targetProofHash !== String(row.proof_hash)) {
              throw new PreviewContractError('FEEDBACK_COMMIT_CONFLICT', 'purge target must match the canonical feedback reference proof')
            }
            const purgeMarker = readVaultPurgeMarker(vault.capability, targetCommitId)
            if (purgeMarker) {
              if (purgeMarker.feedback_id !== feedbackId || purgeMarker.revision_no !== revisionNo || purgeMarker.proof_hash !== targetProofHash) {
                throw new PreviewContractError('FEEDBACK_COMMIT_CONFLICT', 'purge marker does not match the canonical feedback reference')
              }
              alreadyPurged = row.status === 'PURGED'
            } else {
              const targetCommit = vault.loadCommit(targetCommitId)
              if (targetCommit.feedback_id !== feedbackId || targetCommit.revision_no !== revisionNo || targetCommit.proof_hash !== targetProofHash) {
                throw new PreviewContractError('FEEDBACK_COMMIT_CONFLICT', 'purge target vault proof does not match the canonical feedback reference')
              }
            }
          }
          if (alreadyPurged) {
            snapshot = { schema_version: PREVIEW_FEEDBACK_SNAPSHOT_VERSION, kind: 'NO_OP', timestamp: timestampValue, no_op_result: { success: true, no_op: true, reason: 'ALREADY_PURGED', feedback_id: feedbackId, revision_no: revisionNo, feedback_commit_id: targetCommitId, status: 'PURGED' } }
          } else {
            const statusAfter = command === 'feedback:purge' ? 'PURGED' : 'RECONCILED_SUBMITTED'
            snapshot = { schema_version: PREVIEW_FEEDBACK_SNAPSHOT_VERSION, kind: command.replace('feedback:', '').toUpperCase(), timestamp: timestampValue, app_version: options.appVersion, input, facts: { feedback_id: feedbackId, revision_no: revisionNo, feedback_commit_id: String(row.feedback_commit_id), proof_hash: targetProofHash, target_commit_id: targetCommitId, status_after: statusAfter, capability_ref: String(input.capability_ref), event_sequence: nextSequence(db, feedbackId) } }
          }
        }
      }
    }
    return createPlannerReadSnapshot(JSON.parse(canonicalJson(snapshot as unknown as CanonicalJsonValue)) as CanonicalJsonValue)
  } catch (error) {
    if (error instanceof PreviewContractError) return errorSnapshot(timestampValue, error.code)
    throw error
  }
}

function makeEvent(envelope: CommandEnvelopeV2, eventType: string, aggregateId: string, sequence: number, planVersion: string, resultRecipeVersion: string, timestampValue: string, appVersion: string, facts: Record<string, CanonicalJsonValue>): EventIntentV1 {
  return { eventId: uuid(envelope.commandId, eventType), aggregateType: 'PREVIEW_FEEDBACK', aggregateId, eventType, eventSequence: sequence, actorId: envelope.actorId, timestamp: timestampValue, payload: payloadRecord(envelope, planVersion, resultRecipeVersion, appVersion, facts) as EventIntentV1['payload'] }
}

export class PreviewFeedbackPlanner {
  plan(input: { envelope: CommandEnvelopeV2; snapshot: PlannerReadSnapshot<CanonicalJsonValue> }): CommandPlanV1 {
    const command = input.envelope.commandType as FeedbackCommand
    const planVersion = PREVIEW_FEEDBACK_PLAN_VERSIONS[command]
    const resultRecipeVersion = PREVIEW_FEEDBACK_RESULT_RECIPE_VERSIONS[command]
    const snapshot = record(input.snapshot.value, 'snapshot')
    if (!planVersion || !resultRecipeVersion || snapshot.schema_version !== PREVIEW_FEEDBACK_SNAPSHOT_VERSION) throw new Error('preview feedback snapshot is invalid')
    if (snapshot.kind === 'NO_OP') return { schemaVersion: COMMAND_PLAN_SCHEMA_VERSION, commandId: input.envelope.commandId, commandType: command, planVersion, resultRecipeVersion, events: [], operationalEffects: [], noOpResult: record(snapshot.no_op_result, 'snapshot.no_op_result') }
    const facts = record(snapshot.facts, 'snapshot.facts')
    const feedbackId = text(facts.feedback_id, 'facts.feedback_id')
    const eventType: string = command === 'feedback:saveDraft' ? 'PREVIEW_FEEDBACK_DRAFT_SAVED' : command === 'feedback:submit' ? 'PREVIEW_FEEDBACK_REFERENCE_COMMITTED' : command === 'feedback:reconcile' ? 'PREVIEW_FEEDBACK_RECONCILED' : command === 'feedback:delete' ? 'PREVIEW_FEEDBACK_TOMBSTONE_COMMITTED' : command === 'feedback:purge' ? 'PREVIEW_FEEDBACK_PURGED' : command === 'feedback:repair' ? 'PREVIEW_FEEDBACK_REPAIRED' : 'PREVIEW_FEEDBACK_EXPORT_COMMITTED'
    const event = makeEvent(input.envelope, eventType, feedbackId, Number(facts.event_sequence ?? 1), planVersion, resultRecipeVersion, timestamp(snapshot.timestamp), text(snapshot.app_version, 'snapshot.app_version'), facts)
    const preApplyEffects = eventType === 'PREVIEW_FEEDBACK_DRAFT_SAVED' || eventType === 'PREVIEW_FEEDBACK_REFERENCE_COMMITTED' || eventType === 'PREVIEW_FEEDBACK_TOMBSTONE_COMMITTED'
      ? [{ sourceEventId: event.eventId, eventType, effectType: 'FEEDBACK_VAULT_COMMIT', effectVersion: 1 }]
      : eventType === 'PREVIEW_FEEDBACK_EXPORT_COMMITTED'
        ? [{ sourceEventId: event.eventId, eventType, effectType: 'FEEDBACK_VAULT_EXPORT', effectVersion: 1 }]
        : eventType === 'PREVIEW_FEEDBACK_PURGED'
          ? [{ sourceEventId: event.eventId, eventType, effectType: 'FEEDBACK_VAULT_PURGE', effectVersion: 1 }]
          : []
    return { schemaVersion: COMMAND_PLAN_SCHEMA_VERSION, commandId: input.envelope.commandId, commandType: command, planVersion, resultRecipeVersion, events: [event], operationalEffects: [], preApplyEffects, noOpResult: null }
  }
}
