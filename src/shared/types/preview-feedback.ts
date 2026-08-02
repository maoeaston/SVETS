/** Shared non-sensitive feedback reference contracts. */

export type FeedbackOperation =
  | 'DRAFT_SAVE'
  | 'SUBMIT'
  | 'RECONCILE'
  | 'DELETE'
  | 'PURGE'
  | 'REPAIR'
  | 'EXPORT'

export type FeedbackReferenceStatus =
  | 'DRAFT'
  | 'VAULT_PREPARED'
  | 'RECONCILE_REQUIRED'
  | 'RECONCILED_SUBMITTED'
  | 'RECONCILED_DELETED'
  | 'PURGED'
  | 'TOMBSTONED'

export type FeedbackCapabilityKind =
  | 'REFERENCE_REPAIR'
  | 'TOMBSTONE'
  | 'PURGE'
  | 'IDENTITY_MAP_READ'

export interface FeedbackCommitProof {
  feedback_commit_id: string
  feedback_id: string
  revision_no: number
  operation: FeedbackOperation
  previous_revision_hash: string | null
  body_hash: string
  request_hash: string
  session_export_ref: string
  subject_export_ref: string
  contract_version: 'PREVIEW_CONTRACT_V1'
  actor_auth_ref: string
  scope_hash: string
  vault_manifest_root_hash: string
  proof_hash: string
}

export interface FeedbackReference {
  feedback_id: string
  revision_no: number
  feedback_commit_id: string
  proof_hash: string
  session_id: string
  session_export_ref: string
  subject_export_ref: string
  organization_id: string
  status: FeedbackReferenceStatus
  body_hash: string
  submitted_at: string | null
  reconciled_at: string | null
}

export interface FeedbackTombstone {
  feedback_id: string
  revision_no: number
  feedback_commit_id: string
  proof_hash: string
  reason_code: string
  tombstoned_by: string
  tombstoned_at: string
  audit_ref: string
}

export interface FeedbackReconcileState {
  feedback_commit_id: string
  feedback_id: string
  revision_no: number
  state: 'ORPHAN_REFERENCE' | 'ORPHAN_VAULT_COMMIT' | 'RECONCILE_REQUIRED' | 'RECONCILED'
  expected_proof_hash: string
  observed_proof_hash: string | null
  last_checked_at: string
}

export interface FeedbackCapability {
  capability_id: string
  kind: FeedbackCapabilityKind
  organization_id: string
  feedback_id: string | null
  target_commit_id: string | null
  scope_hash: string
  issued_at: string
  expires_at: string
  signer_principal_id: string
  executor_principal_id: string
  signature: string
}

export interface FeedbackExportReference {
  feedback_id: string
  revision_no: number
  export_id: string
  session_export_ref: string
  subject_export_ref: string
  artifact_hash: string
  exported_at: string
  status: 'COMMITTED'
}
