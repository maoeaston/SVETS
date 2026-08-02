import type { DBAdapter } from '../../db/interface'
import type {
  PrincipalBindingEnrollmentPayload,
  PrincipalBindingRotationPayload
} from '../../../shared/types/event-payloads'
import {
  assertHash,
  assertExactKeys,
  assertText,
  assertTimestamp,
  hashPreviewDocument
} from '../preview/preview-canonical'
import { PreviewContractError } from '../preview/preview-errors'
import {
  AuthorityRegistry,
  type AuthorityRegistrySnapshot
} from './authority-registry'
import {
  SignedManifestVerifier,
  type SignedDocumentEnvelope,
  type VerifiedSignedDocument
} from './signed-manifest-verifier'

export type PrincipalBindingStatus = 'ACTIVE' | 'REVOKED' | 'SUPERSEDED'

export interface PrincipalBindingFact {
  mapping_id: string
  target_installation_id: string
  organization_id: string
  user_id: string
  principal_id: string
  mapping_version: number
  mapping_hash: string
  source_manifest_id: string
  source_manifest_hash: string
  effective_at: string
  expires_at: string
  signer_key_id: string
  signature: string
  status_after: 'ACTIVE'
}

export interface PrincipalRotationFact {
  old_mapping_id: string
  old_mapping_hash: string
  new_mapping_id: string
  new_mapping_hash: string
  target_installation_id: string
  organization_id: string
  old_user_id: string
  old_principal_id: string
  new_user_id: string
  new_principal_id: string
  effective_at: string
  expires_at: string
  reason: string
  signer_key_id: string
  signature: string
  old_status_after: 'SUPERSEDED' | 'REVOKED'
  new_status_after: 'ACTIVE'
}

export interface PrincipalBindingRow extends PrincipalBindingFact {
  revoked_at: string | null
  status: PrincipalBindingStatus
  created_event_id: string
}

export interface PrincipalResponsibilitySet {
  signer_principal_id: string
  approver_principal_id: string
  executor_principal_id: string
  content_principal_ids: readonly string[]
  safety_principal_ids: readonly string[]
  code_principal_ids: readonly string[]
  gate_principal_ids: readonly string[]
  future_release_executor_principal_ids: readonly string[]
}

export interface PrincipalBindingValidationContext {
  readonly target_installation_id: string
  readonly organization_id: string
  readonly now?: Date
  readonly existing?: readonly PrincipalBindingRow[]
  readonly authorityRegistry?: AuthorityRegistrySnapshot
  /** Present only when a sender-bound command is performing the verification. */
  readonly executing_principal_id?: string
}

export interface PrincipalUserAccountSnapshot {
  readonly role: 'STUDENT' | 'TEACHER' | 'ADMIN'
  readonly status: 'ACTIVE' | 'DISABLED' | 'ARCHIVED'
}

export type PrincipalUserAccountResolver = (userId: string) => PrincipalUserAccountSnapshot | null | undefined

export function createSqlitePrincipalUserAccountResolver(database: DBAdapter): PrincipalUserAccountResolver {
  return (userId) => {
    const row = database.prepare(
      'SELECT role, status FROM user_account WHERE user_id = ?'
    ).get(userId) as { role?: unknown; status?: unknown } | undefined
    if (!row) return null
    if (
      (row.role !== 'STUDENT' && row.role !== 'TEACHER' && row.role !== 'ADMIN')
      || (row.status !== 'ACTIVE' && row.status !== 'DISABLED' && row.status !== 'ARCHIVED')
    ) return null
    return {
      role: row.role,
      status: row.status
    }
  }
}

export interface PrincipalEnrollmentPackage {
  enrollment_id: string
  enrollment: PrincipalBindingFact
  provisioning_context: 'INSTALLATION_ORGANIZATION_PROVISIONING'
  target_installation_id: string
  organization_id: string
  signer_principal_id: string
  approver_principal_id: string
  executor_principal_id: string
  future_release_executor_principal_ids: readonly string[]
}

export type PrincipalEnrollmentEnvelope = SignedDocumentEnvelope<PrincipalEnrollmentPackage>

export interface PrincipalRotationEnvelopePayload extends PrincipalRotationFact {
  provisioning_context: 'INSTALLATION_ORGANIZATION_PROVISIONING'
  target_installation_id: string
  organization_id: string
  signer_principal_id: string
  approver_principal_id: string
  executor_principal_id: string
}

export type PrincipalRotationEnvelope = SignedDocumentEnvelope<PrincipalRotationEnvelopePayload>

function requireToken(value: unknown, field: string): string {
  return assertText(value, field)
}

function assertValidity(effectiveAt: string, expiresAt: string): void {
  assertTimestamp(effectiveAt, 'effective_at')
  assertTimestamp(expiresAt, 'expires_at')
  if (Date.parse(effectiveAt) >= Date.parse(expiresAt)) {
    throw new PreviewContractError('PREVIEW_VALIDITY_INVALID', 'effective_at must precede expires_at')
  }
}

function assertScopeMatch(
  installationId: string,
  organizationId: string,
  context: Pick<PrincipalBindingValidationContext, 'target_installation_id' | 'organization_id'>
): void {
  if (
    installationId !== context.target_installation_id
    || organizationId !== context.organization_id
  ) throw new PreviewContractError('PREVIEW_SCOPE_INVALID', 'principal binding scope does not match installation and organization')
}

function assertAuthorityScope(
  context: PrincipalBindingValidationContext,
  registry: AuthorityRegistrySnapshot | undefined
): void {
  if (!registry) return
  if (
    registry.target_installation_id !== context.target_installation_id
    || registry.organization_id !== context.organization_id
  ) throw new PreviewContractError('PREVIEW_SCOPE_INVALID', 'principal binding scope does not match authority registry')
}

function mappingHashInput(fact: Omit<PrincipalBindingFact, 'mapping_hash' | 'signer_key_id' | 'signature' | 'status_after'>): Record<string, unknown> {
  return {
    effective_at: fact.effective_at,
    expires_at: fact.expires_at,
    mapping_id: fact.mapping_id,
    mapping_version: fact.mapping_version,
    organization_id: fact.organization_id,
    principal_id: fact.principal_id,
    source_manifest_hash: fact.source_manifest_hash,
    source_manifest_id: fact.source_manifest_id,
    target_installation_id: fact.target_installation_id,
    user_id: fact.user_id
  }
}

export function principalMappingHash(
  fact: Omit<PrincipalBindingFact, 'mapping_hash' | 'signer_key_id' | 'signature' | 'status_after'>
): string {
  return hashPreviewDocument(mappingHashInput(fact))
}

function assertPrincipalHash(fact: PrincipalBindingFact): void {
  assertHash(fact.mapping_hash, 'mapping_hash')
  const expected = principalMappingHash({
    mapping_id: fact.mapping_id,
    target_installation_id: fact.target_installation_id,
    organization_id: fact.organization_id,
    user_id: fact.user_id,
    principal_id: fact.principal_id,
    mapping_version: fact.mapping_version,
    source_manifest_id: fact.source_manifest_id,
    source_manifest_hash: fact.source_manifest_hash,
    effective_at: fact.effective_at,
    expires_at: fact.expires_at
  })
  if (fact.mapping_hash !== expected) throw new PreviewContractError('PREVIEW_HASH_INVALID', 'principal mapping hash mismatch', 'mapping_hash')
}

export function assertPrincipalResponsibilitySeparation(
  responsibilities: PrincipalResponsibilitySet,
  errorCode: 'PREVIEW_PACK_RELEASE_SEPARATION_OF_DUTIES_FAILED' | 'PRINCIPAL_SEPARATION_OF_DUTIES_FAILED' = 'PREVIEW_PACK_RELEASE_SEPARATION_OF_DUTIES_FAILED'
): void {
  const expectedKeys = [
    'approver_principal_id',
    'code_principal_ids',
    'content_principal_ids',
    'executor_principal_id',
    'future_release_executor_principal_ids',
    'gate_principal_ids',
    'safety_principal_ids',
    'signer_principal_id'
  ]
  const actualKeys = Object.keys(responsibilities).sort()
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    throw new PreviewContractError(errorCode, 'responsibility field set is not canonical')
  }
  const signer = requireToken(responsibilities.signer_principal_id, 'responsibility.signer_principal_id')
  const approver = requireToken(responsibilities.approver_principal_id, 'responsibility.approver_principal_id')
  const executor = requireToken(responsibilities.executor_principal_id, 'responsibility.executor_principal_id')
  const principalList = (value: unknown, field: string): readonly unknown[] => {
    if (!Array.isArray(value)) throw new PreviewContractError(errorCode, `${field} must be an explicit principal list`)
    return value
  }
  const protectedIds = [
    ...principalList(responsibilities.content_principal_ids, 'responsibility.content_principal_ids'),
    ...principalList(responsibilities.safety_principal_ids, 'responsibility.safety_principal_ids'),
    ...principalList(responsibilities.code_principal_ids, 'responsibility.code_principal_ids'),
    ...principalList(responsibilities.gate_principal_ids, 'responsibility.gate_principal_ids'),
    ...principalList(responsibilities.future_release_executor_principal_ids, 'responsibility.future_release_executor_principal_ids')
  ].map((value, index) => requireToken(value, `responsibility.protected[${index}]`))
  const allIds = [signer, approver, executor, ...protectedIds]
  if (new Set(allIds).size !== allIds.length) {
    throw new PreviewContractError(errorCode, 'responsibility principals must be mutually disjoint')
  }
}

export function validatePrincipalEnrollmentFact(
  value: PrincipalBindingFact,
  context: PrincipalBindingValidationContext
): PrincipalBindingFact {
  const fact = value
  assertExactKeys(fact, [
    'effective_at',
    'expires_at',
    'mapping_hash',
    'mapping_id',
    'mapping_version',
    'organization_id',
    'principal_id',
    'signer_key_id',
    'signature',
    'source_manifest_hash',
    'source_manifest_id',
    'status_after',
    'target_installation_id',
    'user_id'
  ], 'principal_enrollment')
  for (const [field, fieldValue] of Object.entries(fact)) {
    if (field === 'mapping_version' || field === 'status_after') continue
    requireToken(fieldValue, field)
  }
  if (!Number.isSafeInteger(fact.mapping_version) || fact.mapping_version < 1) {
    throw new PreviewContractError('PRINCIPAL_ENROLLMENT_INVALID', 'mapping_version must be positive', 'mapping_version')
  }
  if (fact.status_after !== 'ACTIVE') throw new PreviewContractError('PRINCIPAL_ENROLLMENT_INVALID', 'enrollment status must be ACTIVE', 'status_after')
  assertHash(fact.source_manifest_hash, 'source_manifest_hash')
  assertValidity(fact.effective_at, fact.expires_at)
  assertPrincipalHash(fact)
  assertScopeMatch(fact.target_installation_id, fact.organization_id, context)
  assertAuthorityScope(context, context.authorityRegistry)
  return Object.freeze({ ...fact })
}

export function validatePrincipalRotationFact(
  value: PrincipalRotationFact,
  context: PrincipalBindingValidationContext
): PrincipalRotationFact {
  const fact = value
  assertExactKeys(fact, [
    'effective_at',
    'expires_at',
    'new_mapping_hash',
    'new_mapping_id',
    'new_principal_id',
    'new_status_after',
    'new_user_id',
    'old_mapping_hash',
    'old_mapping_id',
    'old_principal_id',
    'old_status_after',
    'old_user_id',
    'organization_id',
    'reason',
    'signer_key_id',
    'signature',
    'target_installation_id'
  ], 'principal_rotation')
  for (const [field, fieldValue] of Object.entries(fact)) {
    if (field === 'old_status_after' || field === 'new_status_after') continue
    requireToken(fieldValue, field)
  }
  assertHash(fact.old_mapping_hash, 'old_mapping_hash')
  assertHash(fact.new_mapping_hash, 'new_mapping_hash')
  assertValidity(fact.effective_at, fact.expires_at)
  if (fact.old_mapping_id === fact.new_mapping_id || fact.old_mapping_hash === fact.new_mapping_hash) {
    throw new PreviewContractError('PRINCIPAL_ROTATION_INVALID', 'rotation must replace a distinct mapping')
  }
  if (fact.old_status_after !== 'SUPERSEDED' && fact.old_status_after !== 'REVOKED') {
    throw new PreviewContractError('PRINCIPAL_ROTATION_INVALID', 'old mapping terminal status is invalid')
  }
  if (fact.new_status_after !== 'ACTIVE') throw new PreviewContractError('PRINCIPAL_ROTATION_INVALID', 'new mapping status must be ACTIVE')
  assertScopeMatch(fact.target_installation_id, fact.organization_id, context)
  assertAuthorityScope(context, context.authorityRegistry)
  return Object.freeze({ ...fact })
}

function overlaps(left: { effective_at: string; expires_at: string }, right: { effective_at: string; expires_at: string }): boolean {
  return Date.parse(left.effective_at) < Date.parse(right.expires_at)
    && Date.parse(right.effective_at) < Date.parse(left.expires_at)
}

export function assertNoPrincipalBindingOverlap(
  candidate: Pick<PrincipalBindingFact, 'target_installation_id' | 'organization_id' | 'user_id' | 'principal_id' | 'effective_at' | 'expires_at'>,
  existing: readonly PrincipalBindingRow[],
  ignoreMappingId?: string
): void {
  const conflict = existing.find((row) =>
    row.mapping_id !== ignoreMappingId
    && row.status === 'ACTIVE'
    && row.target_installation_id === candidate.target_installation_id
    && row.organization_id === candidate.organization_id
    && (row.user_id === candidate.user_id || row.principal_id === candidate.principal_id)
    && overlaps(row, candidate)
  )
  if (conflict) throw new PreviewContractError('PRINCIPAL_MAPPING_OVERLAP', `principal binding overlaps ${conflict.mapping_id}`)
}

export function assertPrincipalMappingUsable(
  row: Pick<PrincipalBindingRow, 'status' | 'effective_at' | 'expires_at'>,
  now = new Date()
): void {
  if (row.status !== 'ACTIVE') throw new PreviewContractError('PRINCIPAL_MAPPING_REVOKED', 'principal mapping is not active')
  if (now.getTime() < Date.parse(row.effective_at) || now.getTime() >= Date.parse(row.expires_at)) {
    throw new PreviewContractError('PRINCIPAL_MAPPING_EXPIRED', 'principal mapping is outside its validity window')
  }
}

function rowFromDb(row: Record<string, unknown>): PrincipalBindingRow {
  return {
    mapping_id: String(row.mapping_id),
    target_installation_id: String(row.target_installation_id),
    organization_id: String(row.organization_id),
    user_id: String(row.user_id),
    principal_id: String(row.principal_id),
    mapping_version: Number(row.mapping_version),
    mapping_hash: String(row.mapping_hash),
    source_manifest_id: String(row.source_manifest_id),
    source_manifest_hash: String(row.source_manifest_hash),
    effective_at: String(row.effective_at),
    expires_at: String(row.expires_at),
    signer_key_id: String(row.signer_key_id),
    signature: String(row.signature),
    status_after: 'ACTIVE',
    revoked_at: row.revoked_at === null ? null : String(row.revoked_at),
    status: row.status as PrincipalBindingStatus,
    created_event_id: String(row.created_event_id)
  }
}

export function listPrincipalBindings(db: DBAdapter): readonly PrincipalBindingRow[] {
  return Object.freeze((db.prepare(
    `SELECT mapping_id, target_installation_id, organization_id, user_id, principal_id,
            mapping_version, mapping_hash, source_manifest_id, source_manifest_hash,
            effective_at, expires_at, revoked_at, status, signer_key_id, signature, created_event_id
       FROM principal_binding_projection
      ORDER BY target_installation_id, organization_id, mapping_version, mapping_id`
  ).all() as Record<string, unknown>[]).map(rowFromDb))
}

function assertRegistrySigner(
  registry: AuthorityRegistry | undefined,
  keyId: string
): void {
  registry?.assertSignerAllowed(keyId, 'provisioning')
}

function assertExecutingPrincipal(
  expectedPrincipalId: string | undefined,
  packagePrincipalId: string,
  errorCode: 'PRINCIPAL_ENROLLMENT_INVALID' | 'PRINCIPAL_ROTATION_INVALID'
): void {
  if (expectedPrincipalId !== undefined && expectedPrincipalId !== packagePrincipalId) {
    throw new PreviewContractError(errorCode, 'signed executor principal does not match the sender-bound principal', 'executor_principal_id')
  }
}

export class PrincipalBindingService {
  constructor(
    private readonly options: {
      verifier?: SignedManifestVerifier
      authorityRegistry?: AuthorityRegistry
      now?: () => Date
      resolveUserAccount?: PrincipalUserAccountResolver
    }
  ) {}

  private assertActiveAdmin(userId: string, resolver = this.options.resolveUserAccount): void {
    const account = resolver?.(userId)
    if (!account || account.role !== 'ADMIN' || account.status !== 'ACTIVE') {
      throw new PreviewContractError('PRINCIPAL_ENROLLMENT_INVALID', 'principal enrollment target must be an ACTIVE ADMIN', 'user_id')
    }
  }

  verifyEnrollmentEnvelope(
    envelope: PrincipalEnrollmentEnvelope,
    context: PrincipalBindingValidationContext
  ): Readonly<{ enrollment_id: string; fact: PrincipalBindingFact; verified: VerifiedSignedDocument<PrincipalEnrollmentPackage> }> {
    if (!this.options.verifier) throw new PreviewContractError('INSTALLATION_TRUST_UNAVAILABLE', 'principal verifier is unavailable')
    let verified: VerifiedSignedDocument<PrincipalEnrollmentPackage>
    try {
      verified = this.options.verifier.verify(envelope, 'PRINCIPAL_ENROLLMENT')
    } catch (error) {
      if (error instanceof PreviewContractError) throw error
      throw new PreviewContractError('PRINCIPAL_ENROLLMENT_INVALID', 'enrollment signature verification failed', undefined, error)
    }
    const packagePayload = envelope.payload
    assertExactKeys(packagePayload, [
      'approver_principal_id',
      'enrollment',
      'enrollment_id',
      'executor_principal_id',
      'future_release_executor_principal_ids',
      'organization_id',
      'provisioning_context',
      'signer_principal_id',
      'target_installation_id'
    ], 'principal_enrollment_package')
    if (
      packagePayload.provisioning_context !== 'INSTALLATION_ORGANIZATION_PROVISIONING'
      || packagePayload.target_installation_id !== context.target_installation_id
      || packagePayload.organization_id !== context.organization_id
    ) throw new PreviewContractError('PRINCIPAL_ENROLLMENT_INVALID', 'enrollment is outside provisioning scope')
    const enrollmentId = requireToken(packagePayload.enrollment_id, 'enrollment_id')
    assertExecutingPrincipal(context.executing_principal_id, packagePayload.executor_principal_id, 'PRINCIPAL_ENROLLMENT_INVALID')
    const fact = validatePrincipalEnrollmentFact(packagePayload.enrollment, context)
    this.assertActiveAdmin(fact.user_id)
    if (fact.signer_key_id !== verified.key_id) {
      throw new PreviewContractError('PRINCIPAL_ENROLLMENT_INVALID', 'enrollment signer binding does not match envelope')
    }
    assertRegistrySigner(this.options.authorityRegistry, verified.key_id)
    assertPrincipalResponsibilitySeparation({
      signer_principal_id: packagePayload.signer_principal_id,
      approver_principal_id: packagePayload.approver_principal_id,
      executor_principal_id: packagePayload.executor_principal_id,
      content_principal_ids: [],
      safety_principal_ids: [],
      code_principal_ids: [],
      gate_principal_ids: [],
      future_release_executor_principal_ids: packagePayload.future_release_executor_principal_ids
    }, 'PRINCIPAL_SEPARATION_OF_DUTIES_FAILED')
    assertNoPrincipalBindingOverlap(fact, context.existing ?? [])
    return Object.freeze({ enrollment_id: enrollmentId, fact, verified })
  }

  verifyRotationEnvelope(
    envelope: PrincipalRotationEnvelope,
    context: PrincipalBindingValidationContext
  ): Readonly<{ fact: PrincipalRotationFact; verified: VerifiedSignedDocument<PrincipalRotationEnvelopePayload> }> {
    if (!this.options.verifier) throw new PreviewContractError('INSTALLATION_TRUST_UNAVAILABLE', 'principal verifier is unavailable')
    let verified: VerifiedSignedDocument<PrincipalRotationEnvelopePayload>
    try {
      verified = this.options.verifier.verify(envelope, 'PRINCIPAL_ROTATION')
    } catch (error) {
      if (error instanceof PreviewContractError) throw error
      throw new PreviewContractError('PRINCIPAL_ROTATION_INVALID', 'rotation signature verification failed', undefined, error)
    }
    const payload = envelope.payload
    assertExactKeys(payload, [
      'approver_principal_id',
      'effective_at',
      'executor_principal_id',
      'expires_at',
      'new_mapping_hash',
      'new_mapping_id',
      'new_principal_id',
      'new_status_after',
      'new_user_id',
      'old_mapping_hash',
      'old_mapping_id',
      'old_principal_id',
      'old_status_after',
      'old_user_id',
      'organization_id',
      'provisioning_context',
      'reason',
      'signer_key_id',
      'signer_principal_id',
      'signature',
      'target_installation_id'
    ], 'principal_rotation_package')
    if (
      payload.provisioning_context !== 'INSTALLATION_ORGANIZATION_PROVISIONING'
      || payload.target_installation_id !== context.target_installation_id
      || payload.organization_id !== context.organization_id
    ) throw new PreviewContractError('PRINCIPAL_ROTATION_INVALID', 'rotation is outside provisioning scope')
    assertExecutingPrincipal(context.executing_principal_id, payload.executor_principal_id, 'PRINCIPAL_ROTATION_INVALID')
    const fact = validatePrincipalRotationFact(payload, context)
    this.assertActiveAdmin(fact.new_user_id)
    if (fact.signer_key_id !== verified.key_id) {
      throw new PreviewContractError('PRINCIPAL_ROTATION_INVALID', 'rotation signer binding does not match envelope')
    }
    assertRegistrySigner(this.options.authorityRegistry, verified.key_id)
    assertPrincipalResponsibilitySeparation({
      signer_principal_id: payload.signer_principal_id,
      approver_principal_id: payload.approver_principal_id,
      executor_principal_id: payload.executor_principal_id,
      content_principal_ids: [],
      safety_principal_ids: [],
      code_principal_ids: [],
      gate_principal_ids: [],
      future_release_executor_principal_ids: []
    }, 'PRINCIPAL_SEPARATION_OF_DUTIES_FAILED')
    const old = (context.existing ?? []).find((row) => row.mapping_id === fact.old_mapping_id)
    if (!old || old.status !== 'ACTIVE') throw new PreviewContractError('PRINCIPAL_MAPPING_REVOKED', 'rotation old mapping is not active')
    if (old.mapping_hash !== fact.old_mapping_hash) throw new PreviewContractError('PREVIEW_HASH_INVALID', 'rotation old mapping hash mismatch')
    if (
      old.target_installation_id !== fact.target_installation_id
      || old.organization_id !== fact.organization_id
      || old.user_id !== fact.old_user_id
      || old.principal_id !== fact.old_principal_id
    ) throw new PreviewContractError('PREVIEW_SCOPE_INVALID', 'rotation old mapping identity mismatch')
    if (fact.effective_at < old.effective_at || fact.expires_at > old.expires_at) {
      throw new PreviewContractError('PRINCIPAL_ROTATION_INVALID', 'rotation validity must fit the established binding window')
    }
    const newMapping = context.existing?.find((row) => row.mapping_id === fact.new_mapping_id)
    if (newMapping) throw new PreviewContractError('PREVIEW_IDEMPOTENCY_CONFLICT', 'rotation new mapping already exists')
    assertNoPrincipalBindingOverlap({
      target_installation_id: fact.target_installation_id,
      organization_id: fact.organization_id,
      user_id: fact.new_user_id,
      principal_id: fact.new_principal_id,
      effective_at: fact.effective_at,
      expires_at: fact.expires_at
    }, (context.existing ?? []).filter((row) => row.mapping_id !== fact.old_mapping_id))
    return Object.freeze({ fact, verified })
  }

  projectEnrollment(db: DBAdapter, fact: PrincipalBindingFact, eventId: string): void {
    const current = listPrincipalBindings(db)
    const context = {
      target_installation_id: fact.target_installation_id,
      organization_id: fact.organization_id,
      now: this.options.now?.(),
      existing: current
    }
    validatePrincipalEnrollmentFact(fact, context)
    this.assertActiveAdmin(fact.user_id, this.options.resolveUserAccount ?? createSqlitePrincipalUserAccountResolver(db))
    if (current.some((row) => row.mapping_id === fact.mapping_id)) {
      throw new PreviewContractError('PREVIEW_IDEMPOTENCY_CONFLICT', 'principal mapping already exists')
    }
    assertNoPrincipalBindingOverlap(fact, current)
    db.prepare(
      `INSERT INTO principal_binding_projection
       (mapping_id, target_installation_id, organization_id, user_id, principal_id,
        mapping_version, mapping_hash, source_manifest_id, source_manifest_hash,
        effective_at, expires_at, status, signer_key_id, signature, created_event_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`
    ).run(
      fact.mapping_id,
      fact.target_installation_id,
      fact.organization_id,
      fact.user_id,
      fact.principal_id,
      fact.mapping_version,
      fact.mapping_hash,
      fact.source_manifest_id,
      fact.source_manifest_hash,
      fact.effective_at,
      fact.expires_at,
      fact.signer_key_id,
      fact.signature,
      eventId
    )
  }

  projectRotation(db: DBAdapter, fact: PrincipalRotationFact, eventId: string): void {
    const current = listPrincipalBindings(db)
    const context = {
      target_installation_id: fact.target_installation_id,
      organization_id: fact.organization_id,
      now: this.options.now?.(),
      existing: current
    }
    validatePrincipalRotationFact(fact, context)
    this.assertActiveAdmin(fact.new_user_id, this.options.resolveUserAccount ?? createSqlitePrincipalUserAccountResolver(db))
    const old = current.find((row) => row.mapping_id === fact.old_mapping_id)
    if (!old) throw new PreviewContractError('PRINCIPAL_MAPPING_REVOKED', 'rotation old mapping is missing')
    if (
      old.mapping_hash !== fact.old_mapping_hash
      || old.target_installation_id !== fact.target_installation_id
      || old.organization_id !== fact.organization_id
      || old.user_id !== fact.old_user_id
      || old.principal_id !== fact.old_principal_id
    ) throw new PreviewContractError('PREVIEW_SCOPE_INVALID', 'rotation old mapping identity mismatch')
    if (fact.effective_at < old.effective_at || fact.expires_at > old.expires_at) {
      throw new PreviewContractError('PRINCIPAL_ROTATION_INVALID', 'rotation validity must fit the established binding window')
    }
    if (current.some((row) => row.mapping_id === fact.new_mapping_id)) {
      throw new PreviewContractError('PREVIEW_IDEMPOTENCY_CONFLICT', 'rotation new mapping already exists')
    }
    assertNoPrincipalBindingOverlap({
      target_installation_id: fact.target_installation_id,
      organization_id: fact.organization_id,
      user_id: fact.new_user_id,
      principal_id: fact.new_principal_id,
      effective_at: fact.effective_at,
      expires_at: fact.expires_at
    }, current.filter((row) => row.mapping_id !== fact.old_mapping_id))
    db.prepare(
      `UPDATE principal_binding_projection
          SET status = ?, revoked_at = CASE WHEN ? = 'REVOKED' THEN ? ELSE revoked_at END
        WHERE mapping_id = ? AND status = 'ACTIVE'`
    ).run(fact.old_status_after, fact.old_status_after, fact.effective_at, fact.old_mapping_id)
    db.prepare(
      `INSERT INTO principal_binding_projection
       (mapping_id, target_installation_id, organization_id, user_id, principal_id,
        mapping_version, mapping_hash, source_manifest_id, source_manifest_hash,
        effective_at, expires_at, status, signer_key_id, signature, created_event_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`
    ).run(
      fact.new_mapping_id,
      fact.target_installation_id,
      fact.organization_id,
      fact.new_user_id,
      fact.new_principal_id,
      old.mapping_version + 1,
      fact.new_mapping_hash,
      old.source_manifest_id,
      old.source_manifest_hash,
      fact.effective_at,
      fact.expires_at,
      fact.signer_key_id,
      fact.signature,
      eventId
    )
  }
}

export function principalEnrollmentFactFromEvent(
  payload: PrincipalBindingEnrollmentPayload
): PrincipalBindingFact {
  return {
    mapping_id: payload.mapping_id,
    target_installation_id: payload.target_installation_id,
    organization_id: payload.organization_id,
    user_id: payload.user_id,
    principal_id: payload.principal_id,
    mapping_version: payload.mapping_version,
    mapping_hash: payload.mapping_hash,
    source_manifest_id: payload.source_manifest_id,
    source_manifest_hash: payload.source_manifest_hash,
    effective_at: payload.effective_at,
    expires_at: payload.expires_at,
    signer_key_id: payload.signer_key_id,
    signature: payload.signature,
    status_after: payload.status_after
  }
}

export function principalRotationFactFromEvent(
  payload: PrincipalBindingRotationPayload
): PrincipalRotationFact {
  return {
    old_mapping_id: payload.old_mapping_id,
    old_mapping_hash: payload.old_mapping_hash,
    new_mapping_id: payload.new_mapping_id,
    new_mapping_hash: payload.new_mapping_hash,
    target_installation_id: payload.target_installation_id,
    organization_id: payload.organization_id,
    old_user_id: payload.old_user_id,
    old_principal_id: payload.old_principal_id,
    new_user_id: payload.new_user_id,
    new_principal_id: payload.new_principal_id,
    effective_at: payload.effective_at,
    expires_at: payload.expires_at,
    reason: payload.reason,
    signer_key_id: payload.signer_key_id,
    signature: payload.signature,
    old_status_after: payload.old_status_after,
    new_status_after: payload.new_status_after
  }
}
