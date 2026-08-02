import {
  canonicalJson,
  parseCanonicalJson,
  sha256CanonicalJson,
  sha256Hex,
  type CanonicalJsonValue
} from '../event-batch/canonical-json'
import type {
  PreviewApproval,
  PreviewApprovalRef,
  PreviewAssetRef,
  PreviewCanonicalReferenceSet,
  PreviewEvidenceRef,
  PreviewManifestRef,
  PreviewPackRef,
  PreviewQuestionRef,
  PreviewRendererRef,
  PreviewScope,
  PreviewSourceRef,
  PreviewStrategyRef,
  PreviewValidityWindow
} from '@shared/types/preview-contract'
import { PreviewContractError } from './preview-errors'

const SHA256 = /^[0-9a-f]{64}$/
const TOKEN = /^[A-Za-z][A-Za-z0-9_.:-]{0,255}$/
const UTC_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

function fail(code: ConstructorParameters<typeof PreviewContractError>[0], message: string, field?: string): never {
  throw new PreviewContractError(code, message, field)
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('PREVIEW_CANONICAL_INVALID', 'expected a plain object', field)
  }
  return value as Record<string, unknown>
}

export function assertExactKeys(value: unknown, expected: readonly string[], field = '$'): void {
  const input = object(value, field)
  const actual = Object.keys(input).sort()
  const wanted = [...expected].sort()
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    const expectedSet = new Set(wanted)
    const actualSet = new Set(actual)
    const missing = wanted.filter((key) => !actualSet.has(key))
    const unknown = actual.filter((key) => !expectedSet.has(key))
    if (unknown.length > 0) fail('PREVIEW_UNKNOWN_FIELD', `unknown fields: ${unknown.join(',')}`, field)
    fail('PREVIEW_CANONICAL_INVALID', `missing fields: ${missing.join(',')}`, field)
  }
}

function assertRequiredKeys(value: unknown, required: readonly string[], optional: readonly string[], field: string): void {
  const input = object(value, field)
  const allowed = new Set([...required, ...optional])
  const actual = Object.keys(input)
  const unknown = actual.filter((key) => !allowed.has(key))
  if (unknown.length > 0) fail('PREVIEW_UNKNOWN_FIELD', `unknown fields: ${unknown.join(',')}`, field)
  const missing = required.filter((key) => !Object.prototype.hasOwnProperty.call(input, key))
  if (missing.length > 0) fail('PREVIEW_CANONICAL_INVALID', `missing fields: ${missing.join(',')}`, field)
}

export function assertText(value: unknown, field: string, maxBytes = 512): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim() || Buffer.byteLength(value, 'utf8') > maxBytes) {
    return fail('PREVIEW_CANONICAL_INVALID', 'must be a non-empty trimmed string', field)
  }
  return value
}

export function assertToken(value: unknown, field: string): string {
  const text = assertText(value, field)
  if (!TOKEN.test(text)) return fail('PREVIEW_CANONICAL_INVALID', 'must be a protocol token', field)
  return text
}

export function assertHash(value: unknown, field: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) return fail('PREVIEW_HASH_INVALID', 'must be a lowercase SHA-256 hex digest', field)
  return value
}

export function assertTimestamp(value: unknown, field: string): string {
  const text = assertText(value, field, 32)
  if (!UTC_MS.test(text) || new Date(text).toISOString() !== text) {
    return fail('PREVIEW_VALIDITY_INVALID', 'must be an exact UTC millisecond timestamp', field)
  }
  return text
}

export function assertScope(scope: PreviewScope): PreviewScope {
  assertExactKeys(scope, ['installation_id', 'job_code', 'organization_id', 'permissions', 'task_code'], 'scope')
  assertText(scope.installation_id, 'scope.installation_id')
  assertText(scope.organization_id, 'scope.organization_id')
  assertToken(scope.job_code, 'scope.job_code')
  assertToken(scope.task_code, 'scope.task_code')
  if (!Array.isArray(scope.permissions) || scope.permissions.length === 0) {
    fail('PREVIEW_SCOPE_INVALID', 'permissions must be a non-empty array', 'scope.permissions')
  }
  const permissions = scope.permissions.map((permission, index) => assertToken(permission, `scope.permissions[${index}]`))
  if (new Set(permissions).size !== permissions.length) fail('PREVIEW_SCOPE_INVALID', 'permissions must be unique', 'scope.permissions')
  return Object.freeze({
    installation_id: scope.installation_id,
    organization_id: scope.organization_id,
    job_code: scope.job_code,
    task_code: scope.task_code,
    permissions: Object.freeze([...permissions].sort())
  })
}

export function assertValidityWindow(window: PreviewValidityWindow, options: { maxDays?: number } = {}): PreviewValidityWindow {
  assertRequiredKeys(window, ['effective_at', 'expires_at', 'issued_at'], ['revoked_at'], 'validity')
  const issuedAt = assertTimestamp(window.issued_at, 'validity.issued_at')
  const effectiveAt = assertTimestamp(window.effective_at, 'validity.effective_at')
  const expiresAt = assertTimestamp(window.expires_at, 'validity.expires_at')
  const issued = Date.parse(issuedAt)
  const effective = Date.parse(effectiveAt)
  const expires = Date.parse(expiresAt)
  if (!(issued <= effective && effective < expires)) fail('PREVIEW_VALIDITY_INVALID', 'issued <= effective < expires is required', 'validity')
  if (options.maxDays !== undefined && expires - effective > options.maxDays * 86_400_000) {
    fail('PREVIEW_VALIDITY_INVALID', `validity may not exceed ${options.maxDays} days`, 'validity.expires_at')
  }
  const revokedAt = window.revoked_at === undefined || window.revoked_at === null
    ? null
    : assertTimestamp(window.revoked_at, 'validity.revoked_at')
  if (revokedAt !== null && Date.parse(revokedAt) < effective) {
    fail('PREVIEW_VALIDITY_INVALID', 'revoked_at may not precede effective_at', 'validity.revoked_at')
  }
  return Object.freeze({
    issued_at: issuedAt,
    effective_at: effectiveAt,
    expires_at: expiresAt,
    revoked_at: revokedAt
  })
}

export function canonicalPreviewJson(value: CanonicalJsonValue): string {
  try {
    return canonicalJson(value)
  } catch (error) {
    throw new PreviewContractError('PREVIEW_CANONICAL_INVALID', error instanceof Error ? error.message : String(error), undefined, error)
  }
}

export function canonicalPreviewBytes(value: CanonicalJsonValue): Buffer {
  return Buffer.from(canonicalPreviewJson(value), 'utf8')
}

export function hashPreviewDocument(value: unknown): string {
  return sha256CanonicalJson(value)
}

export function hashPreviewBytes(value: Uint8Array | string): string {
  return sha256Hex(value)
}

export function parsePreviewCanonicalJson(text: string): CanonicalJsonValue {
  try {
    return parseCanonicalJson(text)
  } catch (error) {
    throw new PreviewContractError('PREVIEW_CANONICAL_INVALID', error instanceof Error ? error.message : String(error), undefined, error)
  }
}

function assertQuestionRef(ref: PreviewQuestionRef, field: string): void {
  assertExactKeys(ref, ['question_id', 'question_version', 'semantic_hash'], field)
  assertToken(ref.question_id, `${field}.question_id`)
  if (!Number.isSafeInteger(ref.question_version) || ref.question_version < 1) fail('PREVIEW_CANONICAL_INVALID', 'question_version must be positive', `${field}.question_version`)
  assertHash(ref.semantic_hash, `${field}.semantic_hash`)
}

function assertPackRef(ref: PreviewPackRef, field: string): void {
  assertExactKeys(ref, ['pack_hash', 'pack_id', 'pack_version'], field)
  assertToken(ref.pack_id, `${field}.pack_id`)
  assertText(ref.pack_version, `${field}.pack_version`)
  assertHash(ref.pack_hash, `${field}.pack_hash`)
}

function assertStrategyRef(ref: PreviewStrategyRef, field: string): void {
  assertExactKeys(ref, ['policy_hash', 'scoring_policy_hash', 'strategy_id', 'strategy_version'], field)
  assertToken(ref.strategy_id, `${field}.strategy_id`)
  if (!Number.isSafeInteger(ref.strategy_version) || ref.strategy_version < 1) fail('PREVIEW_CANONICAL_INVALID', 'strategy_version must be positive', `${field}.strategy_version`)
  assertHash(ref.policy_hash, `${field}.policy_hash`)
  assertHash(ref.scoring_policy_hash, `${field}.scoring_policy_hash`)
}

function assertEvidenceRef(ref: PreviewEvidenceRef, field: string): void {
  assertExactKeys(ref, ['evidence_hash', 'evidence_id', 'evidence_version'], field)
  assertToken(ref.evidence_id, `${field}.evidence_id`)
  assertText(ref.evidence_version, `${field}.evidence_version`)
  assertHash(ref.evidence_hash, `${field}.evidence_hash`)
}

function assertAssetRef(ref: PreviewAssetRef, field: string): void {
  assertExactKeys(ref, ['asset_id', 'asset_version', 'file_hash', 'rights_hash'], field)
  assertToken(ref.asset_id, `${field}.asset_id`)
  if (!Number.isSafeInteger(ref.asset_version) || ref.asset_version < 1) fail('PREVIEW_CANONICAL_INVALID', 'asset_version must be positive', `${field}.asset_version`)
  assertHash(ref.file_hash, `${field}.file_hash`)
  assertHash(ref.rights_hash, `${field}.rights_hash`)
}

function assertRendererRef(ref: PreviewRendererRef, field: string): void {
  assertExactKeys(ref, ['renderer_hash', 'renderer_id', 'renderer_version'], field)
  assertToken(ref.renderer_id, `${field}.renderer_id`)
  assertText(ref.renderer_version, `${field}.renderer_version`)
  assertHash(ref.renderer_hash, `${field}.renderer_hash`)
}

function assertManifestRef(ref: PreviewManifestRef, field: string): void {
  assertExactKeys(ref, ['key_id', 'manifest_hash', 'manifest_id', 'manifest_version', 'signer_principal_id'], field)
  assertToken(ref.manifest_id, `${field}.manifest_id`)
  assertText(ref.manifest_version, `${field}.manifest_version`)
  assertHash(ref.manifest_hash, `${field}.manifest_hash`)
  assertToken(ref.signer_principal_id, `${field}.signer_principal_id`)
  assertToken(ref.key_id, `${field}.key_id`)
}

function assertApprovalRef(ref: PreviewApprovalRef, field: string): void {
  assertExactKeys(ref, ['allowed_actions', 'approval_hash', 'approval_id', 'approval_version', 'key_id', 'scope', 'signer_principal_id', 'validity'], field)
  assertToken(ref.approval_id, `${field}.approval_id`)
  assertText(ref.approval_version, `${field}.approval_version`)
  assertHash(ref.approval_hash, `${field}.approval_hash`)
  assertToken(ref.signer_principal_id, `${field}.signer_principal_id`)
  assertToken(ref.key_id, `${field}.key_id`)
  if (ref.scope !== 'JOB_SKILL_PREVIEW_ONLY') fail('PREVIEW_SCOPE_INVALID', 'approval scope is not preview-only', `${field}.scope`)
  if (!Array.isArray(ref.allowed_actions) || ref.allowed_actions.length === 0) fail('PREVIEW_APPROVAL_INVALID', 'allowed_actions must be non-empty', `${field}.allowed_actions`)
  assertValidityWindow(ref.validity, { maxDays: 30 })
}

export function assertCanonicalReferenceSet(refs: PreviewCanonicalReferenceSet): void {
  assertExactKeys(refs, ['approval_ref', 'asset_refs', 'evidence_refs', 'manifest_ref', 'pack_ref', 'question_refs', 'renderer_refs', 'source_ref', 'strategy_ref'])
  assertSourceRef(refs.source_ref, 'source_ref')
  assertPackRef(refs.pack_ref, 'pack_ref')
  assertStrategyRef(refs.strategy_ref, 'strategy_ref')
  assertManifestRef(refs.manifest_ref, 'manifest_ref')
  assertApprovalRef(refs.approval_ref, 'approval_ref')
  if (!Array.isArray(refs.question_refs) || refs.question_refs.length === 0) fail('PREVIEW_CANONICAL_INVALID', 'question_refs must be non-empty', 'question_refs')
  refs.question_refs.forEach((ref, index) => assertQuestionRef(ref, `question_refs[${index}]`))
  if (new Set(refs.question_refs.map((ref) => `${ref.question_id}:${ref.question_version}`)).size !== refs.question_refs.length) {
    fail('PREVIEW_CANONICAL_INVALID', 'question_refs must be unique', 'question_refs')
  }
  if (!Array.isArray(refs.asset_refs)) fail('PREVIEW_CANONICAL_INVALID', 'asset_refs must be an array', 'asset_refs')
  if (!Array.isArray(refs.renderer_refs)) fail('PREVIEW_CANONICAL_INVALID', 'renderer_refs must be an array', 'renderer_refs')
  if (!Array.isArray(refs.evidence_refs)) fail('PREVIEW_CANONICAL_INVALID', 'evidence_refs must be an array', 'evidence_refs')
  refs.asset_refs.forEach((ref, index) => assertAssetRef(ref, `asset_refs[${index}]`))
  refs.renderer_refs.forEach((ref, index) => assertRendererRef(ref, `renderer_refs[${index}]`))
  refs.evidence_refs.forEach((ref, index) => assertEvidenceRef(ref, `evidence_refs[${index}]`))
}

function assertSourceRef(ref: PreviewSourceRef, field: string): void {
  assertExactKeys(ref, ['authority_hash', 'authority_id', 'delivery_mode', 'namespace', 'scope', 'source_ref_id', 'validity'], field)
  assertToken(ref.source_ref_id, `${field}.source_ref_id`)
  assertToken(ref.authority_id, `${field}.authority_id`)
  assertHash(ref.authority_hash, `${field}.authority_hash`)
  if (ref.namespace === 'preview_publish_set' && ref.delivery_mode !== 'PREVIEW_ONLY') fail('PREVIEW_SCOPE_INVALID', 'preview namespace requires PREVIEW_ONLY', field)
  if (ref.namespace === 'official_publish_set' && ref.delivery_mode !== 'FORMAL_DEMO') fail('PREVIEW_SCOPE_INVALID', 'official namespace requires FORMAL_DEMO', field)
  assertScope(ref.scope)
  assertValidityWindow(ref.validity)
}

export function canonicalReferenceSetDigest(refs: PreviewCanonicalReferenceSet): string {
  assertCanonicalReferenceSet(refs)
  return hashPreviewDocument({
    approval_ref: refs.approval_ref,
    asset_refs: [...refs.asset_refs].sort((a, b) => `${a.asset_id}:${a.asset_version}`.localeCompare(`${b.asset_id}:${b.asset_version}`)),
    evidence_refs: [...refs.evidence_refs].sort((a, b) => a.evidence_id.localeCompare(b.evidence_id)),
    manifest_ref: refs.manifest_ref,
    pack_ref: refs.pack_ref,
    question_refs: [...refs.question_refs].sort((a, b) => `${a.question_id}:${a.question_version}`.localeCompare(`${b.question_id}:${b.question_version}`)),
    renderer_refs: [...refs.renderer_refs].sort((a, b) => `${a.renderer_id}:${a.renderer_version}`.localeCompare(`${b.renderer_id}:${b.renderer_version}`)),
    source_ref: refs.source_ref,
    strategy_ref: refs.strategy_ref
  })
}

export function assertApprovalMatchesReferences(approval: PreviewApproval, refs: PreviewCanonicalReferenceSet): void {
  assertExactKeys(approval, ['approval_ref', 'asset_refs', 'authority_registry_id', 'canonical_payload_hash', 'contract_version', 'evidence_refs', 'manifest_ref', 'pack_ref', 'question_refs', 'renderer_refs', 'signature', 'strategy_ref', 'approver_principal_id'])
  if (approval.contract_version !== 'PREVIEW_CONTRACT_V1') fail('PREVIEW_APPROVAL_INVALID', 'contract version mismatch', 'contract_version')
  if (approval.approval_ref.approval_id !== refs.approval_ref.approval_id || approval.approval_ref.approval_hash !== refs.approval_ref.approval_hash) {
    fail('PREVIEW_APPROVAL_HASH_CONFLICT', 'approval reference does not match canonical refs', 'approval_ref')
  }
  if (approval.pack_ref.pack_hash !== refs.pack_ref.pack_hash || approval.strategy_ref.policy_hash !== refs.strategy_ref.policy_hash) {
    fail('PREVIEW_APPROVAL_HASH_CONFLICT', 'approval source hashes do not match canonical refs')
  }
  const digest = canonicalReferenceSetDigest(refs)
  if (approval.canonical_payload_hash !== digest) fail('PREVIEW_APPROVAL_HASH_CONFLICT', 'approval canonical payload hash mismatch', 'canonical_payload_hash')
}
