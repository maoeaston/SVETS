import { describe, expect, it } from 'vitest'
import type { SignedManifestVerifier } from '../signed-manifest-verifier'
import { createTestDb, seedCaller } from '../../../db/test-helpers'
import {
  assertNoPrincipalBindingOverlap,
  assertPrincipalMappingUsable,
  assertPrincipalResponsibilitySeparation,
  principalMappingHash,
  PrincipalBindingService,
  type PrincipalEnrollmentPackage,
  type PrincipalBindingFact,
  type PrincipalRotationFact
} from '../principal-binding-service'

const INSTALLATION_ID = 'principal-installation'
const ORGANIZATION_ID = 'principal-organization'
const MANIFEST_HASH = 'a'.repeat(64)

function fakeVerifier<T extends object>(payload: T): SignedManifestVerifier {
  return {
    verify: () => ({
      payload,
      payload_hash: 'b'.repeat(64),
      key_id: 'provisioning-key',
      fingerprint: 'fingerprint-1',
      algorithm: 'Ed25519'
    })
  } as unknown as SignedManifestVerifier
}

function baseFact(userId: string, mappingId = 'mapping-1'): PrincipalBindingFact {
  const base: Omit<PrincipalBindingFact, 'mapping_hash'> = {
    mapping_id: mappingId,
    target_installation_id: INSTALLATION_ID,
    organization_id: ORGANIZATION_ID,
    user_id: userId,
    principal_id: `principal-${mappingId}`,
    mapping_version: 1,
    source_manifest_id: 'manifest-1',
    source_manifest_hash: MANIFEST_HASH,
    effective_at: '2026-08-01T00:00:00.000Z',
    expires_at: '2026-12-31T00:00:00.000Z',
    signer_key_id: 'provisioning-key',
    signature: 'signed-fact',
    status_after: 'ACTIVE'
  }
  return { ...base, mapping_hash: principalMappingHash(base) }
}

function addPreviewEvent(db: Awaited<ReturnType<typeof createTestDb>>, eventId: string, type: string, sequence: number): void {
  db.prepare(
    `INSERT INTO preview_event_projection
       (event_id, contract_registry_id, aggregate_type, aggregate_id, event_type,
        event_sequence, payload_json, checksum, created_at)
     VALUES (?, 'PREVIEW_CONTRACT_V1', 'PRINCIPAL_BINDING', 'principal-aggregate', ?, ?, '{}', ?, ?)`
  ).run(eventId, type, sequence, 'b'.repeat(64), `2026-08-01T00:00:0${sequence}.000Z`)
}

describe('PrincipalBindingService', () => {
  it('enrollment 写入双向唯一映射，重复或时间重叠被拒绝', async () => {
    const db = await createTestDb()
    const userId = seedCaller(db, 'ADMIN')
    const service = new PrincipalBindingService({})
    const fact = baseFact(userId)
    addPreviewEvent(db, 'principal-event-1', 'PRINCIPAL_BINDING_ENROLLMENT', 1)
    service.projectEnrollment(db, fact, 'principal-event-1')
    expect(db.prepare('SELECT status, mapping_version FROM principal_binding_projection WHERE mapping_id = ?').get(fact.mapping_id)).toEqual({
      status: 'ACTIVE',
      mapping_version: 1
    })
    expect(() => service.projectEnrollment(db, fact, 'principal-event-1')).toThrowError(expect.objectContaining({ code: 'PREVIEW_IDEMPOTENCY_CONFLICT' }))

    const overlapping = { ...baseFact(userId, 'mapping-2'), mapping_hash: baseFact(userId, 'mapping-2').mapping_hash }
    expect(() => assertNoPrincipalBindingOverlap(overlapping, [
      {
        ...fact,
        revoked_at: null,
        status: 'ACTIVE',
        created_event_id: 'principal-event-1'
      }
    ])).toThrowError(expect.objectContaining({ code: 'PRINCIPAL_MAPPING_OVERLAP' }))
    db.close()
  })

  it('rotation 是独立替换事实，旧 mapping 保留历史但变为 SUPERSEDED', async () => {
    const db = await createTestDb()
    const oldUserId = seedCaller(db, 'ADMIN')
    const newUserId = seedCaller(db, 'ADMIN')
    const service = new PrincipalBindingService({})
    const old = baseFact(oldUserId)
    addPreviewEvent(db, 'principal-event-1', 'PRINCIPAL_BINDING_ENROLLMENT', 1)
    service.projectEnrollment(db, old, 'principal-event-1')
    const rotation: PrincipalRotationFact = {
      old_mapping_id: old.mapping_id,
      old_mapping_hash: old.mapping_hash,
      new_mapping_id: 'mapping-2',
      new_mapping_hash: 'c'.repeat(64),
      target_installation_id: INSTALLATION_ID,
      organization_id: ORGANIZATION_ID,
      old_user_id: old.user_id,
      old_principal_id: old.principal_id,
      new_user_id: newUserId,
      new_principal_id: 'principal-rotated',
      effective_at: old.effective_at,
      expires_at: old.expires_at,
      reason: 'key rotation',
      signer_key_id: 'provisioning-key',
      signature: 'rotation-signature',
      old_status_after: 'SUPERSEDED',
      new_status_after: 'ACTIVE'
    }
    addPreviewEvent(db, 'principal-event-2', 'PRINCIPAL_BINDING_ROTATION', 2)
    service.projectRotation(db, rotation, 'principal-event-2')
    expect(db.prepare('SELECT mapping_id, status FROM principal_binding_projection ORDER BY mapping_id').all()).toEqual([
      { mapping_id: 'mapping-1', status: 'SUPERSEDED' },
      { mapping_id: 'mapping-2', status: 'ACTIVE' }
    ])
    db.close()
  })

  it('revoked/expired mapping cannot be used as trusted principal', () => {
    expect(() => assertPrincipalMappingUsable({
      status: 'REVOKED',
      effective_at: '2026-01-01T00:00:00.000Z',
      expires_at: '2027-01-01T00:00:00.000Z'
    }, new Date('2026-08-01T00:00:00.000Z'))).toThrowError(expect.objectContaining({ code: 'PRINCIPAL_MAPPING_REVOKED' }))
    expect(() => assertPrincipalMappingUsable({
      status: 'ACTIVE',
      effective_at: '2025-01-01T00:00:00.000Z',
      expires_at: '2026-01-01T00:00:00.000Z'
    }, new Date('2026-08-01T00:00:00.000Z'))).toThrowError(expect.objectContaining({ code: 'PRINCIPAL_MAPPING_EXPIRED' }))
    expect(() => assertPrincipalMappingUsable({
      status: 'ACTIVE',
      effective_at: '2026-01-01T00:00:00.000Z',
      expires_at: '2027-01-01T00:00:00.000Z'
    }, new Date('2026-08-01T00:00:00.000Z'))).not.toThrow()
  })

  it('requires every release responsibility principal to be mutually disjoint', () => {
    const responsibilities = {
      signer_principal_id: 'responsibility-signer',
      approver_principal_id: 'responsibility-approver',
      executor_principal_id: 'responsibility-executor',
      content_principal_ids: ['responsibility-content'],
      safety_principal_ids: ['responsibility-safety'],
      code_principal_ids: ['responsibility-code'],
      gate_principal_ids: ['responsibility-gate'],
      future_release_executor_principal_ids: ['responsibility-future-executor']
    }
    expect(() => assertPrincipalResponsibilitySeparation(responsibilities)).not.toThrow()
    expect(() => assertPrincipalResponsibilitySeparation({
      ...responsibilities,
      signer_principal_id: responsibilities.approver_principal_id
    })).toThrowError(expect.objectContaining({ code: 'PREVIEW_PACK_RELEASE_SEPARATION_OF_DUTIES_FAILED' }))
    expect(() => assertPrincipalResponsibilitySeparation({
      ...responsibilities,
      content_principal_ids: [responsibilities.executor_principal_id]
    })).toThrowError(expect.objectContaining({ code: 'PREVIEW_PACK_RELEASE_SEPARATION_OF_DUTIES_FAILED' }))
    expect(() => assertPrincipalResponsibilitySeparation({
      ...responsibilities,
      content_principal_ids: undefined as never
    })).toThrowError(expect.objectContaining({ code: 'PREVIEW_PACK_RELEASE_SEPARATION_OF_DUTIES_FAILED' }))
    expect(() => assertPrincipalResponsibilitySeparation({
      ...responsibilities,
      unregistered_principal_ids: []
    } as never)).toThrowError(expect.objectContaining({ code: 'PREVIEW_PACK_RELEASE_SEPARATION_OF_DUTIES_FAILED' }))
  })

  it('rejects a sender-bound executor principal mismatch for enrollment and rotation', async () => {
    const db = await createTestDb()
    const oldUserId = seedCaller(db, 'ADMIN')
    const newUserId = seedCaller(db, 'ADMIN')
    const fact = baseFact(oldUserId)
    const enrollmentPayload: PrincipalEnrollmentPackage = {
      enrollment_id: 'enrollment-1',
      enrollment: fact,
      provisioning_context: 'INSTALLATION_ORGANIZATION_PROVISIONING',
      target_installation_id: INSTALLATION_ID,
      organization_id: ORGANIZATION_ID,
      signer_principal_id: 'signer-principal',
      approver_principal_id: 'approver-principal',
      executor_principal_id: 'executor-principal',
      future_release_executor_principal_ids: ['future-executor-principal']
    }
    const enrollment = {
      payload: enrollmentPayload,
      payload_hash: 'c'.repeat(64),
      key_id: 'provisioning-key',
      signature: 'signature',
      algorithm: 'Ed25519' as const
    }
    const enrollmentService = new PrincipalBindingService({
      verifier: fakeVerifier(enrollmentPayload),
      resolveUserAccount: () => ({ role: 'ADMIN', status: 'ACTIVE' })
    })
    expect(() => enrollmentService.verifyEnrollmentEnvelope(enrollment, {
      target_installation_id: INSTALLATION_ID,
      organization_id: ORGANIZATION_ID,
      existing: [],
      executing_principal_id: 'different-executor-principal'
    })).toThrowError(expect.objectContaining({ code: 'PRINCIPAL_ENROLLMENT_INVALID' }))

    const rotation: PrincipalRotationFact = {
      old_mapping_id: fact.mapping_id,
      old_mapping_hash: fact.mapping_hash,
      new_mapping_id: 'mapping-2',
      new_mapping_hash: 'd'.repeat(64),
      target_installation_id: INSTALLATION_ID,
      organization_id: ORGANIZATION_ID,
      old_user_id: oldUserId,
      old_principal_id: fact.principal_id,
      new_user_id: newUserId,
      new_principal_id: 'principal-rotated',
      effective_at: fact.effective_at,
      expires_at: fact.expires_at,
      reason: 'key rotation',
      signer_key_id: 'provisioning-key',
      signature: 'rotation-signature',
      old_status_after: 'SUPERSEDED',
      new_status_after: 'ACTIVE'
    }
    const rotationPayload = {
      ...rotation,
      provisioning_context: 'INSTALLATION_ORGANIZATION_PROVISIONING' as const,
      signer_principal_id: 'signer-principal',
      approver_principal_id: 'approver-principal',
      executor_principal_id: 'executor-principal'
    }
    const rotationEnvelope = {
      payload: rotationPayload,
      payload_hash: 'e'.repeat(64),
      key_id: 'provisioning-key',
      signature: 'signature',
      algorithm: 'Ed25519' as const
    }
    const rotationService = new PrincipalBindingService({
      verifier: fakeVerifier(rotationPayload),
      resolveUserAccount: () => ({ role: 'ADMIN', status: 'ACTIVE' })
    })
    expect(() => rotationService.verifyRotationEnvelope(rotationEnvelope, {
      target_installation_id: INSTALLATION_ID,
      organization_id: ORGANIZATION_ID,
      existing: [{
        ...fact,
        status: 'ACTIVE',
        revoked_at: null,
        created_event_id: 'event-1'
      }],
      executing_principal_id: 'different-executor-principal'
    })).toThrowError(expect.objectContaining({ code: 'PRINCIPAL_ROTATION_INVALID' }))
    db.close()
  })
})
