import type { PreviewScope } from '../../../shared/types/preview-contract'
import { assertScope, assertTimestamp } from '../preview/preview-canonical'
import { PreviewContractError } from '../preview/preview-errors'
import { SignedManifestVerifier, type SignedDocumentEnvelope } from '../authority/signed-manifest-verifier'

export type FeedbackCapabilityKind = 'REFERENCE_REPAIR' | 'TOMBSTONE' | 'PURGE' | 'IDENTITY_MAP_READ'

export interface FeedbackCapabilityPayload {
  capability_id: string
  capability_type: FeedbackCapabilityKind
  feedback_id: string
  target_commit_id: string
  proof_hash: string
  scope: PreviewScope
  issued_at: string
  expires_at: string
  signer_principal_id: string
  approver_principal_id: string
  executor_principal_id: string
}

export type FeedbackCapabilityEnvelope = SignedDocumentEnvelope<FeedbackCapabilityPayload>

export function verifyFeedbackCapability(
  envelope: FeedbackCapabilityEnvelope,
  options: { verifier: SignedManifestVerifier; expectedType: FeedbackCapabilityKind; scope: PreviewScope; now?: Date }
): FeedbackCapabilityPayload {
  const verified = options.verifier.verify(envelope, 'FEEDBACK_CAPABILITY')
  const payload = verified.payload
  if (payload.capability_type !== options.expectedType) throw new PreviewContractError('FEEDBACK_CAPABILITY_INVALID', 'feedback capability type mismatch')
  const scope = assertScope(payload.scope)
  if (scope.installation_id !== options.scope.installation_id || scope.organization_id !== options.scope.organization_id || scope.job_code !== options.scope.job_code || scope.task_code !== options.scope.task_code) throw new PreviewContractError('FEEDBACK_CAPABILITY_INVALID', 'feedback capability scope mismatch')
  assertTimestamp(payload.issued_at, 'issued_at')
  assertTimestamp(payload.expires_at, 'expires_at')
  const now = options.now ?? new Date()
  if (now.getTime() < Date.parse(payload.issued_at) || now.getTime() >= Date.parse(payload.expires_at)) throw new PreviewContractError('FEEDBACK_CAPABILITY_INVALID', 'feedback capability is expired or not yet effective')
  if (
    !payload.signer_principal_id
    || !payload.approver_principal_id
    || !payload.executor_principal_id
    || payload.signer_principal_id === payload.approver_principal_id
    || payload.executor_principal_id === payload.signer_principal_id
    || payload.executor_principal_id === payload.approver_principal_id
  ) throw new PreviewContractError('FEEDBACK_CAPABILITY_INVALID', 'feedback capability violates separation of duties')
  return Object.freeze({ ...payload, scope })
}
