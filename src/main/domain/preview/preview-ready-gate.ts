import { registerPrincipalBindingContract } from '../projectors/principal-binding-projector'
import { registerPreviewFeedbackContract } from '../projectors/preview-feedback-projector'
import { registerPreviewReleaseContract } from '../projectors/preview-release-projector'
import { registerPreviewSafetyContract } from '../projectors/preview-safety-projector'
import { registerPreviewSessionContract } from '../projectors/preview-session-projector'
import { registerPreviewErrorContract } from './preview-error-contract'
import { PREVIEW_CONTRACT_REGISTRY } from './preview-contract-registry'
import { PREVIEW_QUERY_NAMES, registerPreviewQueryContract } from './preview-query-contract'
import type { PreviewContractReadiness, PreviewReadinessStatus } from '../../../shared/types/preview-contract'
import { PREVIEW_ERROR_CODES } from './preview-errors'

export const PREVIEW_EVENT_TYPES = Object.freeze([
  'PRINCIPAL_BINDING_ENROLLMENT',
  'PRINCIPAL_BINDING_ROTATION',
  'PREVIEW_PACK_RELEASED',
  'PREVIEW_PACK_REVOKED',
  'PREVIEW_SESSION_STARTED',
  'PREVIEW_SESSION_COMPLETED',
  'PREVIEW_SESSION_ABORTED',
  'PREVIEW_SESSION_TECHNICAL_INTERRUPTION',
  'PREVIEW_SAFETY_INCIDENT_CREATED',
  'PREVIEW_FEEDBACK_DRAFT_SAVED',
  'PREVIEW_FEEDBACK_REFERENCE_COMMITTED',
  'PREVIEW_FEEDBACK_RECONCILED',
  'PREVIEW_FEEDBACK_TOMBSTONE_COMMITTED',
  'PREVIEW_FEEDBACK_PURGED',
  'PREVIEW_FEEDBACK_REPAIRED',
  'PREVIEW_FEEDBACK_EXPORT_COMMITTED'
] as const)

export const PREVIEW_COMMAND_TYPES = Object.freeze([
  'preview:enrollPrincipal',
  'preview:rotatePrincipal',
  'preview:releasePack',
  'preview:revokePack',
  'preview:startSession',
  'preview:completeSession',
  'preview:abortSession',
  'preview:technicalInterruption',
  'preview:triggerSafety',
  'feedback:saveDraft',
  'feedback:submit',
  'feedback:reconcile',
  'feedback:delete',
  'feedback:purge',
  'feedback:repair',
  'feedback:export'
] as const)

export const PREVIEW_PROJECTION_NAMES = Object.freeze([
  'principal_binding_projection',
  'preview_feedback_reference_projection',
  'preview_feedback_tombstone_projection',
  'preview_release_projection',
  'preview_safety_incident_projection',
  'preview_session_projection',
  'preview_session_question_projection'
] as const)

export function registerAllPreviewContracts(): void {
  registerPrincipalBindingContract()
  registerPreviewReleaseContract()
  registerPreviewSessionContract()
  registerPreviewSafetyContract()
  registerPreviewFeedbackContract()
  registerPreviewErrorContract()
  registerPreviewQueryContract()
}

export function previewContractReadiness(status: PreviewReadinessStatus = 'INSTALLING'): PreviewContractReadiness {
  registerAllPreviewContracts()
  PREVIEW_CONTRACT_REGISTRY.assertComplete({
    event_types: PREVIEW_EVENT_TYPES,
    command_types: PREVIEW_COMMAND_TYPES,
    projection_names: PREVIEW_PROJECTION_NAMES,
    query_names: PREVIEW_QUERY_NAMES,
    error_codes: PREVIEW_ERROR_CODES
  })
  return PREVIEW_CONTRACT_REGISTRY.readiness(status)
}
