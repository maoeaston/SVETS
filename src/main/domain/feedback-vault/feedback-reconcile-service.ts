import type { DBAdapter } from '../../db/interface'
import { PreviewContractError } from '../preview/preview-errors'
import { feedbackProofHash } from './vault-proof'
import type { FeedbackVault, PreparedFeedbackCommit } from './feedback-vault'

export type FeedbackBridgeState = 'VAULT_INTENT_PREPARED' | 'VAULT_COMMITTED' | 'DB_REFERENCE_COMMITTED' | 'RECONCILED_SUBMITTED' | 'EXPORTED' | 'PURGED' | 'RECONCILE_REQUIRED'

export interface FeedbackReferenceInput {
  feedback_id: string
  revision_no: number
  session_id: string
  organization_id: string
  session_export_ref: string
  subject_export_ref: string
  body_hash: string
  commit: PreparedFeedbackCommit
}

export class FeedbackReconcileService {
  constructor(private readonly database: DBAdapter, private readonly vault: FeedbackVault) {}

  inspect(commitId: string): FeedbackBridgeState {
    const reference = this.database.prepare('SELECT status FROM preview_feedback_reference_projection WHERE feedback_commit_id = ?').get(commitId) as { status: string } | undefined
    if (!reference) return this.vaultState(commitId) === 'VAULT_COMMITTED' ? 'RECONCILE_REQUIRED' : this.vaultState(commitId)
    if (reference.status === 'RECONCILED_SUBMITTED') return 'RECONCILED_SUBMITTED'
    if (reference.status === 'PURGED') return this.vault.commitIdState(commitId) === 'VAULT_PURGED' ? 'PURGED' : 'RECONCILE_REQUIRED'
    return reference.status as FeedbackBridgeState
  }

  assertVaultProof(commit: PreparedFeedbackCommit): void {
    if (feedbackProofHash(commit.proof) !== commit.proof_hash) throw new PreviewContractError('FEEDBACK_COMMIT_CONFLICT', 'feedback proof is not stable')
    this.vault.assertPrepared(commit)
  }

  assertReferenceMatches(input: FeedbackReferenceInput): void {
    this.assertVaultProof(input.commit)
    const row = this.database.prepare('SELECT feedback_id, revision_no, feedback_commit_id, proof_hash, body_hash, session_id, organization_id, session_export_ref, subject_export_ref FROM preview_feedback_reference_projection WHERE feedback_id = ? AND revision_no = ? AND feedback_commit_id = ?').get(input.feedback_id, input.revision_no, input.commit.feedback_commit_id) as Record<string, unknown> | undefined
    if (!row) throw new PreviewContractError('FEEDBACK_RECONCILE_REQUIRED', 'DB feedback reference is missing')
    for (const [field, expected] of Object.entries({ feedback_id: input.feedback_id, revision_no: input.revision_no, feedback_commit_id: input.commit.feedback_commit_id, proof_hash: input.commit.proof_hash, body_hash: input.body_hash, session_id: input.session_id, organization_id: input.organization_id, session_export_ref: input.session_export_ref, subject_export_ref: input.subject_export_ref })) if (row[field] !== expected) throw new PreviewContractError('FEEDBACK_COMMIT_CONFLICT', `DB feedback reference mismatch at ${field}`)
  }

  reconcileReference(input: FeedbackReferenceInput): void {
    this.assertVaultProof(input.commit)
    const existing = this.database.prepare('SELECT feedback_id, revision_no, feedback_commit_id, proof_hash, status FROM preview_feedback_reference_projection WHERE feedback_id = ? AND revision_no = ?').get(input.feedback_id, input.revision_no) as { feedback_id: string; revision_no: number; feedback_commit_id: string; proof_hash: string; status: string } | undefined
    if (!existing) throw new PreviewContractError('FEEDBACK_RECONCILE_REQUIRED', 'cannot reconcile without a DB reference')
    if (existing.feedback_commit_id !== input.commit.feedback_commit_id || existing.proof_hash !== input.commit.proof_hash) throw new PreviewContractError('FEEDBACK_COMMIT_CONFLICT', 'reconcile proof does not match DB reference')
    if (existing.status === 'RECONCILED_SUBMITTED') return
    if (existing.status !== 'VAULT_PREPARED' && existing.status !== 'RECONCILE_REQUIRED') throw new PreviewContractError('FEEDBACK_STATE_CONFLICT', `cannot reconcile status ${existing.status}`)
    this.database.prepare('UPDATE preview_feedback_reference_projection SET status = ? WHERE feedback_id = ? AND revision_no = ? AND feedback_commit_id = ?').run('RECONCILED_SUBMITTED', input.feedback_id, input.revision_no, input.commit.feedback_commit_id)
  }

  private vaultState(commitId: string): FeedbackBridgeState {
    const commit = this.vault.commitIdState(commitId)
    if (commit === 'VAULT_COMMITTED') return 'VAULT_COMMITTED'
    if (commit === 'VAULT_PURGED') return 'PURGED'
    return 'RECONCILE_REQUIRED'
  }
}

export function proofFromReference(row: { proof_hash: string }): string {
  return row.proof_hash
}
