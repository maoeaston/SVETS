/**
 * Shared data contracts for PREVIEW_CONTRACT_V1.
 *
 * These types intentionally contain references and frozen facts only. They
 * are not an authorization source by themselves; authority and principal
 * modules must validate their signatures and scope before use.
 */

export const PREVIEW_CONTRACT_VERSION = 'PREVIEW_CONTRACT_V1' as const
export const PREVIEW_CONTRACT_SCHEMA_VERSION = 'preview-contract-v1' as const
export const PREVIEW_CONTRACT_MIGRATION_ID = '2026-08-01_job_skill_preview_contract_v1' as const

export type PreviewContractVersion = typeof PREVIEW_CONTRACT_VERSION
export type PreviewDeliveryMode = 'FORMAL_DEMO' | 'PREVIEW_ONLY'
export type PreviewSourceNamespace = 'official_publish_set' | 'preview_publish_set'
export type PreviewLifecycleStatus = 'DRAFT' | 'ACTIVE' | 'REVOKED' | 'SUPERSEDED' | 'DISABLED' | 'ARCHIVED'
export type PreviewReadinessStatus = 'INSTALLING' | 'READY' | 'DISABLED'
export type PreviewSessionStatus =
  | 'PREPARED'
  | 'ACTIVE'
  | 'COMPLETED'
  | 'ABORTED'
  | 'TECHNICAL_INTERRUPTED'
  | 'REDLINE_HALTED'

export interface PreviewScope {
  organization_id: string
  installation_id: string
  job_code: string
  task_code: string
  permissions: readonly string[]
}

export interface PreviewValidityWindow {
  issued_at: string
  effective_at: string
  expires_at: string
  revoked_at?: string | null
}

export interface PreviewQuestionRef {
  question_id: string
  question_version: number
  semantic_hash: string
}

export interface PreviewAssetRef {
  asset_id: string
  asset_version: number
  file_hash: string
  rights_hash: string
}

export interface PreviewRendererRef {
  renderer_id: string
  renderer_version: string
  renderer_hash: string
}

export interface PreviewStrategyRef {
  strategy_id: string
  strategy_version: number
  policy_hash: string
  scoring_policy_hash: string
}

export interface PreviewPackRef {
  pack_id: string
  pack_version: string
  pack_hash: string
}

export interface PreviewEvidenceRef {
  evidence_id: string
  evidence_version: string
  evidence_hash: string
}

export interface PreviewSourceRef {
  source_ref_id: string
  namespace: PreviewSourceNamespace
  delivery_mode: PreviewDeliveryMode
  authority_id: string
  authority_hash: string
  scope: PreviewScope
  validity: PreviewValidityWindow
}

export interface PreviewManifestRef {
  manifest_id: string
  manifest_version: string
  manifest_hash: string
  signer_principal_id: string
  key_id: string
}

export interface PreviewApprovalRef {
  approval_id: string
  approval_version: string
  approval_hash: string
  signer_principal_id: string
  scope: 'JOB_SKILL_PREVIEW_ONLY'
  allowed_actions: readonly ('PREVIEW_DRAFT_TO_ACTIVE' | 'PREVIEW_SOURCE_BIND' | 'PREVIEW_PACK_PUBLISH')[]
  validity: PreviewValidityWindow
  key_id: string
}

export interface PreviewCanonicalReferenceSet {
  source_ref: PreviewSourceRef
  pack_ref: PreviewPackRef
  strategy_ref: PreviewStrategyRef
  question_refs: readonly PreviewQuestionRef[]
  asset_refs: readonly PreviewAssetRef[]
  renderer_refs: readonly PreviewRendererRef[]
  evidence_refs: readonly PreviewEvidenceRef[]
  manifest_ref: PreviewManifestRef
  approval_ref: PreviewApprovalRef
}

export interface PreviewResponsibilityManifest {
  manifest_ref: PreviewManifestRef
  contract_version: PreviewContractVersion
  delivery_mode: 'PREVIEW_ONLY'
  job_code: string
  task_code: string
  pack_ref: PreviewPackRef
  strategy_ref: PreviewStrategyRef
  question_refs: readonly PreviewQuestionRef[]
  asset_refs: readonly PreviewAssetRef[]
  renderer_refs: readonly PreviewRendererRef[]
  evidence_refs: readonly PreviewEvidenceRef[]
  principal_ids: Readonly<{
    trust_root: string
    content: string
    safety: string
    renderer: string
    code: string
    gate: string
    approver: string
    executor: string
  }>
  executor_mapping_id: string
  executor_mapping_hash: string
  scope: PreviewScope
  validity: PreviewValidityWindow
  canonical_payload_hash: string
  signature: string
}

export interface PreviewApproval {
  approval_ref: PreviewApprovalRef
  contract_version: PreviewContractVersion
  manifest_ref: PreviewManifestRef
  pack_ref: PreviewPackRef
  strategy_ref: PreviewStrategyRef
  question_refs: readonly PreviewQuestionRef[]
  asset_refs: readonly PreviewAssetRef[]
  renderer_refs: readonly PreviewRendererRef[]
  evidence_refs: readonly PreviewEvidenceRef[]
  approver_principal_id: string
  authority_registry_id: string
  canonical_payload_hash: string
  signature: string
}

export interface PreviewAuditReference {
  audit_id: string
  event_id: string
  aggregate_id: string
  aggregate_sequence: number
  request_hash: string
  actor_user_id: string
  executor_principal_id: string
  recorded_at: string
}

export interface PreviewPublishBinding {
  source_ref: PreviewSourceRef
  delivery_mode: PreviewDeliveryMode
  question_ref: PreviewQuestionRef
  pack_ref: PreviewPackRef
  strategy_ref: PreviewStrategyRef
  manifest_ref: PreviewManifestRef
  approval_ref: PreviewApprovalRef
  asset_refs: readonly PreviewAssetRef[]
  renderer_refs: readonly PreviewRendererRef[]
  evidence_refs: readonly PreviewEvidenceRef[]
  status: PreviewLifecycleStatus
  validity: PreviewValidityWindow
  audit_ref: PreviewAuditReference
}

export interface PreviewSessionQuestionSnapshot {
  question_ref: PreviewQuestionRef
  question_order: number
  question_phase: 'ONLINE' | 'OFFLINE' | 'OBSERVATION'
  content_json: unknown
  content_hash: string
  scoring_rule_json: unknown
  scoring_hash: string
  asset_refs: readonly PreviewAssetRef[]
  renderer_ref: PreviewRendererRef
  evidence_refs: readonly PreviewEvidenceRef[]
  safety_ref: string
}

export interface PreviewSessionSnapshot {
  snapshot_schema_version: typeof PREVIEW_CONTRACT_SCHEMA_VERSION
  contract_version: PreviewContractVersion
  delivery_mode: 'PREVIEW_ONLY'
  session_id: string
  assessment_session_id: string
  student_id: string
  job_code: string
  task_code: string
  pack_ref: PreviewPackRef
  source_ref: PreviewSourceRef
  manifest_ref: PreviewManifestRef
  approval_ref: PreviewApprovalRef
  strategy_ref: PreviewStrategyRef
  assignment_id: string
  grant_id: string
  device_id: string
  question_snapshots: readonly PreviewSessionQuestionSnapshot[]
  content_root_hash: string
  scoring_root_hash: string
  renderer_root_hash: string
  snapshot_root_hash: string
  captured_at: string
}

export interface PreviewContractReadiness {
  registry_id: 'PREVIEW_CONTRACT_V1'
  contract_version: PreviewContractVersion
  status: PreviewReadinessStatus
  schema_version: string
  migration_id: string
  event_registry_digest: string
  projection_digest: string
  query_digest: string
  recovery_digest: string
  error_map_digest: string
  installed_at: string | null
}

export interface LegacySessionInterpretation {
  payload_version: 1 | 2
  delivery_mode: 'FORMAL_DEMO'
  contract_version: null
  reason: 'LEGACY_FORMAL_SESSION'
}
