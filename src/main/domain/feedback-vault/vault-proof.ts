import { hashPreviewDocument } from '../preview/preview-canonical'
import { assertTimestamp } from '../preview/preview-canonical'
import { PreviewContractError } from '../preview/preview-errors'

export interface FeedbackCommitProofV1 {
  contract_version: 'PREVIEW_CONTRACT_V1'
  feedback_commit_id: string
  operation: 'DRAFT_SAVE' | 'SUBMIT' | 'DELETE' | 'EXPORT'
  feedback_id: string
  revision_no: number
  previous_proof_hash: string | null
  body_hash: string
  session_export_ref: string
  subject_export_ref: string
  organization_id: string
  installation_id: string
  request_hash: string
  actor_auth_ref: string
  issued_at: string
  expires_at: string
  vault_manifest_root_hash: string
}

export function feedbackProofHash(proof: FeedbackCommitProofV1): string {
  return hashPreviewDocument(proof)
}

export function assertFeedbackProof(proof: FeedbackCommitProofV1): FeedbackCommitProofV1 {
  if (proof.contract_version !== 'PREVIEW_CONTRACT_V1' || !proof.feedback_commit_id || !proof.feedback_id || !proof.organization_id || !proof.installation_id || !proof.request_hash || !proof.actor_auth_ref || !proof.vault_manifest_root_hash) throw new PreviewContractError('FEEDBACK_COMMIT_CONFLICT', 'feedback proof is incomplete')
  if (!Number.isSafeInteger(proof.revision_no) || proof.revision_no < 1) throw new PreviewContractError('FEEDBACK_COMMIT_CONFLICT', 'feedback proof revision is invalid')
  if (!['DRAFT_SAVE', 'SUBMIT', 'DELETE', 'EXPORT'].includes(proof.operation)) throw new PreviewContractError('FEEDBACK_COMMIT_CONFLICT', 'feedback proof operation is invalid')
  try {
    assertTimestamp(proof.issued_at, 'proof.issued_at')
    assertTimestamp(proof.expires_at, 'proof.expires_at')
  } catch (error) {
    throw new PreviewContractError('FEEDBACK_COMMIT_CONFLICT', 'feedback proof time window is invalid', undefined, error)
  }
  if (Date.parse(proof.issued_at) >= Date.parse(proof.expires_at)) throw new PreviewContractError('FEEDBACK_COMMIT_CONFLICT', 'feedback proof expiry must follow issuance')
  return Object.freeze({ ...proof })
}

export function assertFeedbackProofActive(proof: FeedbackCommitProofV1, now = new Date()): FeedbackCommitProofV1 {
  const verified = assertFeedbackProof(proof)
  const nowMillis = now.getTime()
  if (!Number.isFinite(nowMillis) || nowMillis < Date.parse(verified.issued_at) || nowMillis >= Date.parse(verified.expires_at)) {
    throw new PreviewContractError('FEEDBACK_COMMIT_CONFLICT', 'feedback proof is outside its validity window')
  }
  return verified
}
