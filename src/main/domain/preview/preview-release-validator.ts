import {
  assertApprovalMatchesReferences,
  assertCanonicalReferenceSet,
  assertHash,
  assertScope,
  assertText,
  assertTimestamp,
  hashPreviewDocument
} from './preview-canonical'
import { PreviewContractError } from './preview-errors'
import type {
  PreviewApproval,
  PreviewCanonicalReferenceSet,
  PreviewLifecycleStatus,
  PreviewScope
} from '../../../shared/types/preview-contract'
import {
  assertPrincipalResponsibilitySeparation,
  type PrincipalResponsibilitySet
} from '../authority/principal-binding-service'

export interface PreviewReleaseFact {
  release_id: string
  source_ref_id: string
  delivery_mode: 'PREVIEW_ONLY'
  question_id: string
  question_version: number
  semantic_hash: string
  pack_id: string
  pack_version: string
  pack_hash: string
  strategy_id: string
  strategy_version: number
  policy_hash: string
  approval_id: string
  approval_hash: string
  manifest_id: string
  manifest_hash: string
  references: PreviewCanonicalReferenceSet
  status_after: 'ACTIVE'
  effective_at: string
  expires_at: string
  audit_ref: string
}

export interface PreviewRevokeFact {
  release_id: string
  source_ref_id: string
  status_before: PreviewLifecycleStatus
  status_after: 'REVOKED'
  revoked_at: string
  audit_ref: string
}

export interface PreviewReleasePackage {
  fact: PreviewReleaseFact
  approval: PreviewApproval
  responsibilities: PrincipalResponsibilitySet
  executor_mapping_id: string
  executor_mapping_hash: string
  signer_key_id: string
  signature: string
}

export interface PreviewRevokePackage {
  fact: PreviewRevokeFact
  release_hash: string
  signer_key_id: string
  signature: string
}

export interface PreviewReleaseScope extends PreviewScope {
  release_id?: string
}

function exactRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PreviewContractError('PREVIEW_CANONICAL_INVALID', `${field} must be an object`, field)
  }
  return value as Record<string, unknown>
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new PreviewContractError('PREVIEW_CANONICAL_INVALID', `${field} must be positive`, field)
  return value as number
}

function assertFactReferences(fact: PreviewReleaseFact): void {
  assertCanonicalReferenceSet(fact.references)
  const refs = fact.references
  if (
    refs.source_ref.source_ref_id !== fact.source_ref_id
    || refs.source_ref.delivery_mode !== 'PREVIEW_ONLY'
    || refs.source_ref.namespace !== 'preview_publish_set'
    || refs.question_refs.length !== 1
    || refs.question_refs[0].question_id !== fact.question_id
    || refs.question_refs[0].question_version !== fact.question_version
    || refs.question_refs[0].semantic_hash !== fact.semantic_hash
    || refs.pack_ref.pack_id !== fact.pack_id
    || refs.pack_ref.pack_version !== fact.pack_version
    || refs.pack_ref.pack_hash !== fact.pack_hash
    || refs.strategy_ref.strategy_id !== fact.strategy_id
    || refs.strategy_ref.strategy_version !== fact.strategy_version
    || refs.strategy_ref.policy_hash !== fact.policy_hash
    || refs.approval_ref.approval_id !== fact.approval_id
    || refs.approval_ref.approval_hash !== fact.approval_hash
    || refs.manifest_ref.manifest_id !== fact.manifest_id
    || refs.manifest_ref.manifest_hash !== fact.manifest_hash
  ) throw new PreviewContractError('PREVIEW_APPROVAL_HASH_CONFLICT', 'release fact does not match canonical references')
}

export function validatePreviewReleaseFact(value: PreviewReleaseFact, scope?: PreviewReleaseScope): PreviewReleaseFact {
  const fact = value
  const keys = Object.keys(fact).sort()
  const expected = ['approval_hash', 'approval_id', 'audit_ref', 'delivery_mode', 'effective_at', 'expires_at', 'manifest_hash', 'manifest_id', 'pack_hash', 'pack_id', 'pack_version', 'policy_hash', 'question_id', 'question_version', 'references', 'release_id', 'semantic_hash', 'source_ref_id', 'status_after', 'strategy_id', 'strategy_version'].sort()
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) throw new PreviewContractError('PREVIEW_UNKNOWN_FIELD', 'release fact field set mismatch')
  for (const field of ['release_id', 'source_ref_id', 'question_id', 'pack_id', 'pack_version', 'strategy_id', 'approval_id', 'manifest_id', 'audit_ref']) assertText(fact[field as keyof PreviewReleaseFact], field)
  if (fact.delivery_mode !== 'PREVIEW_ONLY' || fact.status_after !== 'ACTIVE') throw new PreviewContractError('PREVIEW_SCOPE_INVALID', 'release must activate PREVIEW_ONLY delivery')
  positiveInteger(fact.question_version, 'question_version')
  positiveInteger(fact.strategy_version, 'strategy_version')
  for (const field of ['semantic_hash', 'pack_hash', 'policy_hash', 'approval_hash', 'manifest_hash']) assertHash(fact[field as keyof PreviewReleaseFact], field)
  assertTimestamp(fact.effective_at, 'effective_at')
  assertTimestamp(fact.expires_at, 'expires_at')
  if (Date.parse(fact.effective_at) >= Date.parse(fact.expires_at)) throw new PreviewContractError('PREVIEW_VALIDITY_INVALID', 'release validity window is invalid')
  assertFactReferences(fact)
  if (scope) {
    const referenceScope = assertScope(fact.references.source_ref.scope)
    if (
      referenceScope.installation_id !== scope.installation_id
      || referenceScope.organization_id !== scope.organization_id
      || referenceScope.job_code !== scope.job_code
      || referenceScope.task_code !== scope.task_code
    ) throw new PreviewContractError('PREVIEW_SCOPE_INVALID', 'release scope does not match trusted target')
  }
  return Object.freeze({ ...fact, references: fact.references })
}

export function validatePreviewRevokeFact(value: PreviewRevokeFact): PreviewRevokeFact {
  const keys = Object.keys(value).sort()
  const expected = ['audit_ref', 'release_id', 'revoked_at', 'source_ref_id', 'status_after', 'status_before'].sort()
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) throw new PreviewContractError('PREVIEW_UNKNOWN_FIELD', 'revoke fact field set mismatch')
  assertText(value.release_id, 'release_id')
  assertText(value.source_ref_id, 'source_ref_id')
  assertText(value.audit_ref, 'audit_ref')
  assertTimestamp(value.revoked_at, 'revoked_at')
  if (value.status_after !== 'REVOKED' || !['DRAFT', 'ACTIVE', 'SUPERSEDED'].includes(value.status_before)) throw new PreviewContractError('PREVIEW_STATE_CONFLICT', 'release revoke status transition is invalid')
  return Object.freeze({ ...value })
}

export function validatePreviewReleasePackage(value: PreviewReleasePackage, scope?: PreviewReleaseScope): PreviewReleasePackage {
  const packageValue = exactRecord(value, 'release_package') as unknown as PreviewReleasePackage
  const expected = ['approval', 'executor_mapping_hash', 'executor_mapping_id', 'fact', 'responsibilities', 'signature', 'signer_key_id'].sort()
  const keys = Object.keys(packageValue).sort()
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) throw new PreviewContractError('PREVIEW_UNKNOWN_FIELD', 'release package field set mismatch')
  const fact = validatePreviewReleaseFact(packageValue.fact, scope)
  assertApprovalMatchesReferences(packageValue.approval, packageValue.fact.references)
  assertText(packageValue.executor_mapping_id, 'executor_mapping_id')
  assertHash(packageValue.executor_mapping_hash, 'executor_mapping_hash')
  assertText(packageValue.signer_key_id, 'signer_key_id')
  assertText(packageValue.signature, 'signature')
  const responsibility = packageValue.responsibilities
  if (!responsibility || typeof responsibility !== 'object') throw new PreviewContractError('PREVIEW_PACK_RELEASE_SEPARATION_OF_DUTIES_FAILED', 'release responsibilities are missing')
  assertPrincipalResponsibilitySeparation(responsibility, 'PREVIEW_PACK_RELEASE_SEPARATION_OF_DUTIES_FAILED')
  return Object.freeze({ ...packageValue, fact })
}

export function validatePreviewRevokePackage(value: PreviewRevokePackage): PreviewRevokePackage {
  const packageValue = exactRecord(value, 'revoke_package') as unknown as PreviewRevokePackage
  const expected = ['fact', 'release_hash', 'signature', 'signer_key_id'].sort()
  const keys = Object.keys(packageValue).sort()
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) throw new PreviewContractError('PREVIEW_UNKNOWN_FIELD', 'revoke package field set mismatch')
  const fact = validatePreviewRevokeFact(packageValue.fact)
  assertHash(packageValue.release_hash, 'release_hash')
  assertText(packageValue.signer_key_id, 'signer_key_id')
  assertText(packageValue.signature, 'signature')
  return Object.freeze({ ...packageValue, fact })
}

export function releaseBindingHash(fact: PreviewReleaseFact): string {
  validatePreviewReleaseFact(fact)
  return hashPreviewDocument({
    approval_hash: fact.approval_hash,
    manifest_hash: fact.manifest_hash,
    pack_hash: fact.pack_hash,
    policy_hash: fact.policy_hash,
    question_id: fact.question_id,
    question_version: fact.question_version,
    semantic_hash: fact.semantic_hash,
    source_ref_id: fact.source_ref_id,
    strategy_id: fact.strategy_id,
    strategy_version: fact.strategy_version
  })
}
