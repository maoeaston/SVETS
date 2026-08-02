import {
  generateKeyPairSync,
  sign
} from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  BootstrapTrustChain,
  type BootstrapReplayStore,
  createSqliteBootstrapReplayStore,
  createSqliteBootstrapTrustChain,
  type InstallationIdentityCertificatePayload,
  type InstallationProofOfPossession,
} from '../bootstrap-trust-chain'
import { createTestDb } from '../../../db/test-helpers'
import type { PrincipalEnrollmentPackage } from '../principal-binding-service'
import {
  fingerprintPublicKey,
  type AuthorityRegistryPayload
} from '../authority-registry'
import {
  canonicalPreviewBytes,
  hashPreviewDocument
} from '../../preview/preview-canonical'
import type { CompiledTrustAnchor, SignedDocumentEnvelope } from '../signed-manifest-verifier'
import {
  principalMappingHash,
  type PrincipalBindingFact
} from '../principal-binding-service'
import { PreviewContractError } from '../../preview/preview-errors'

const NOW = new Date('2026-08-01T00:00:00.000Z')
const INSTALLATION_ID = 'installation-test-1'
const ORGANIZATION_ID = 'organization-test-1'
const SIGNER_KEY_ID = 'compiled-provisioning-anchor'

function generatedKeyPair() {
  return generateKeyPairSync('ed25519')
}

function signEnvelope<T extends object>(
  payload: T,
  keyId: string,
  privateKey: ReturnType<typeof generatedKeyPair>['privateKey']
): SignedDocumentEnvelope<T> {
  const signature = sign(null, canonicalPreviewBytes(payload as never), privateKey).toString('base64')
  return {
    payload,
    payload_hash: hashPreviewDocument(payload),
    key_id: keyId,
    signature,
    algorithm: 'Ed25519'
  }
}

function buildFixture() {
  const anchorKeys = generatedKeyPair()
  const installationKeys = generatedKeyPair()
  const anchorPem = anchorKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const installationPem = installationKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const anchor: CompiledTrustAnchor = {
    key_id: SIGNER_KEY_ID,
    public_key_pem: anchorPem,
    fingerprint: fingerprintPublicKey(anchorPem),
    allowed_scopes: ['INSTALLATION_IDENTITY', 'AUTHORITY_REGISTRY', 'PRINCIPAL_ENROLLMENT', 'PRINCIPAL_ROTATION']
  }
  const certificatePayload: InstallationIdentityCertificatePayload = {
    certificate_id: 'certificate-test-1',
    certificate_version: 'INSTALLATION_IDENTITY_V1',
    installation_id: INSTALLATION_ID,
    organization_id: ORGANIZATION_ID,
    public_key_pem: installationPem,
    issued_at: '2026-07-01T00:00:00.000Z',
    expires_at: '2027-07-01T00:00:00.000Z',
    contract_version: 'PREVIEW_CONTRACT_V1'
  }
  const authorityPayload: AuthorityRegistryPayload = {
    registry_id: 'authority-test-1',
    registry_version: '1',
    contract_version: 'PREVIEW_CONTRACT_V1',
    target_installation_id: INSTALLATION_ID,
    organization_id: ORGANIZATION_ID,
    allowed_signers: [SIGNER_KEY_ID],
    provisioning_signers: [SIGNER_KEY_ID],
    capability_types: ['PRINCIPAL_ENROLLMENT', 'PRINCIPAL_ROTATION'],
    scope: {
      installation_id: INSTALLATION_ID,
      organization_id: ORGANIZATION_ID,
      job_code: 'SUPERMARKET_SHELVER',
      task_code: 'UNBOX_AND_SHELVE',
      permissions: ['PRINCIPAL_ENROLLMENT', 'PRINCIPAL_ROTATION']
    },
    expires_at: '2027-01-01T00:00:00.000Z',
    revoked_key_ids: []
  }
  const baseFact: Omit<PrincipalBindingFact, 'mapping_hash'> = {
    mapping_id: 'mapping-test-1',
    target_installation_id: INSTALLATION_ID,
    organization_id: ORGANIZATION_ID,
    user_id: 'user-test-1',
    principal_id: 'principal-test-1',
    mapping_version: 1,
    source_manifest_id: 'manifest-test-1',
    source_manifest_hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    effective_at: '2026-08-01T00:00:00.000Z',
    expires_at: '2026-12-31T00:00:00.000Z',
    signer_key_id: SIGNER_KEY_ID,
    signature: 'inner-fact-signature',
    status_after: 'ACTIVE'
  }
  const fact: PrincipalBindingFact = {
    ...baseFact,
    mapping_hash: principalMappingHash(baseFact)
  }
  const packagePayload: PrincipalEnrollmentPackage = {
    enrollment_id: 'enrollment-test-1',
    enrollment: fact,
    provisioning_context: 'INSTALLATION_ORGANIZATION_PROVISIONING',
    target_installation_id: INSTALLATION_ID,
    organization_id: ORGANIZATION_ID,
    signer_principal_id: 'principal-signer',
    approver_principal_id: 'principal-approver',
    executor_principal_id: 'principal-enrollment-executor',
    future_release_executor_principal_ids: ['principal-release-executor']
  }
  const proofPayload = {
    challenge_id: 'challenge-test-1',
    certificate_id: certificatePayload.certificate_id,
    installation_id: INSTALLATION_ID,
    nonce: 'nonce-test-1',
    issued_at: '2026-08-01T00:00:00.000Z',
    expires_at: '2026-08-01T00:10:00.000Z'
  }
  const proof: InstallationProofOfPossession = {
    ...proofPayload,
    algorithm: 'Ed25519',
    signature: sign(null, canonicalPreviewBytes(proofPayload), installationKeys.privateKey).toString('base64')
  }
  return {
    anchor,
    anchorKeys,
    certificate: signEnvelope(certificatePayload, SIGNER_KEY_ID, anchorKeys.privateKey),
    proof,
    authority: signEnvelope(authorityPayload, SIGNER_KEY_ID, anchorKeys.privateKey),
    enrollment: signEnvelope(packagePayload, SIGNER_KEY_ID, anchorKeys.privateKey)
  }
}

function memoryReplayStore(): BootstrapReplayStore {
  const records = new Map<string, string>()
  return {
    reserve(input) {
      const existing = records.get(input.enrollment_id)
      if (existing !== undefined) {
        if (existing !== input.enrollment_package_hash) {
          throw new PreviewContractError('PREVIEW_IDEMPOTENCY_CONFLICT', 'enrollment package hash changed')
        }
        return 'REPLAY'
      }
      records.set(input.enrollment_id, input.enrollment_package_hash)
      return 'NEW'
    }
  }
}

function chain(
  fixture = buildFixture(),
  options: Readonly<{
    replayStore?: BootstrapReplayStore
    resolveUserAccount?: (userId: string) => { role: 'STUDENT' | 'TEACHER' | 'ADMIN'; status: 'ACTIVE' | 'DISABLED' | 'ARCHIVED' } | null
  }> = {}
): BootstrapTrustChain {
  return new BootstrapTrustChain([fixture.anchor], {
    now: () => NOW,
    replayStore: options.replayStore ?? memoryReplayStore(),
    resolveUserAccount: options.resolveUserAccount ?? (() => ({ role: 'ADMIN', status: 'ACTIVE' }))
  })
}

describe('BootstrapTrustChain', () => {
  it('按固定顺序验证证书、PoP、authority registry 和 enrollment package', () => {
    const fixture = buildFixture()
    const result = chain(fixture).bootstrap({
      installation_identity: fixture.certificate,
      proof_of_possession: fixture.proof,
      authority_registry: fixture.authority,
      enrollment_package: fixture.enrollment
    })
    expect(result.enrollment.mapping_id).toBe('mapping-test-1')
    expect(result.certificate.payload.installation_id).toBe(INSTALLATION_ID)
  })

  it('证书、PoP nonce、authority 和 enrollment 缺失均 fail-closed', () => {
    const fixture = buildFixture()
    const invalidCertificate = { ...fixture.certificate, payload_hash: 'b'.repeat(64) }
    expect(() => chain(fixture).bootstrap({
      installation_identity: invalidCertificate,
      proof_of_possession: fixture.proof,
      authority_registry: fixture.authority,
      enrollment_package: fixture.enrollment
    })).toThrowError(expect.objectContaining({ code: 'INSTALLATION_IDENTITY_INVALID' }))

    const trust = chain(fixture)
    const input = {
      installation_identity: fixture.certificate,
      proof_of_possession: fixture.proof,
      authority_registry: fixture.authority,
      enrollment_package: fixture.enrollment
    }
    trust.bootstrap(input)
    expect(trust.bootstrap(input).enrollment_id).toBe('enrollment-test-1')

    const missingEnrollment = buildFixture()
    expect(() => chain(missingEnrollment).bootstrap({
      installation_identity: missingEnrollment.certificate,
      proof_of_possession: missingEnrollment.proof,
      authority_registry: missingEnrollment.authority
    })).toThrowError(expect.objectContaining({ code: 'PRINCIPAL_ENROLLMENT_REQUIRED' }))
  })

  it('组织或 executor/SOD 被篡改时不创建任何映射事实', () => {
    const fixture = buildFixture()
    const wrongAuthorityPayload = {
      ...fixture.authority.payload,
      organization_id: 'organization-other'
    }
    const wrongAuthority = signEnvelope(wrongAuthorityPayload, SIGNER_KEY_ID, fixture.anchorKeys.privateKey)
    expect(() => chain(fixture).bootstrap({
      installation_identity: fixture.certificate,
      proof_of_possession: fixture.proof,
      authority_registry: wrongAuthority,
      enrollment_package: fixture.enrollment
    })).toThrowError(PreviewContractError)

    const sodPayload = {
      ...fixture.enrollment.payload,
      executor_principal_id: fixture.enrollment.payload.approver_principal_id
    }
    const sodPackage = signEnvelope(sodPayload, SIGNER_KEY_ID, fixture.anchorKeys.privateKey)
    expect(() => chain(fixture).bootstrap({
      installation_identity: fixture.certificate,
      proof_of_possession: fixture.proof,
      authority_registry: fixture.authority,
      enrollment_package: sodPackage
    })).toThrowError(expect.objectContaining({ code: 'PRINCIPAL_SEPARATION_OF_DUTIES_FAILED' }))
  })

  it('目标用户不是 ACTIVE ADMIN 时拒绝 enrollment', () => {
    const fixture = buildFixture()
    expect(() => chain(fixture, {
      resolveUserAccount: () => ({ role: 'TEACHER', status: 'ACTIVE' })
    }).bootstrap({
      installation_identity: fixture.certificate,
      proof_of_possession: fixture.proof,
      authority_registry: fixture.authority,
      enrollment_package: fixture.enrollment
    })).toThrowError(expect.objectContaining({ code: 'PRINCIPAL_ENROLLMENT_INVALID' }))
  })

  it('持久 replay marker 跨 BootstrapTrustChain 实例拒绝 nonce 重放而允许同包幂等返回', async () => {
    const fixture = buildFixture()
    const database = await createTestDb()
    try {
      const replayStore = createSqliteBootstrapReplayStore(database)
      const input = {
        installation_identity: fixture.certificate,
        proof_of_possession: fixture.proof,
        authority_registry: fixture.authority,
        enrollment_package: fixture.enrollment
      }
      expect(chain(fixture, { replayStore }).bootstrap(input).enrollment_id).toBe('enrollment-test-1')
      expect(chain(fixture, { replayStore }).bootstrap(input).enrollment_id).toBe('enrollment-test-1')
      expect(database.prepare('SELECT COUNT(*) AS count FROM preview_bootstrap_replay_projection').get()).toEqual({ count: 1 })
    } finally {
      database.close()
    }
  })

  it('bootstrap 使用隔离数据库中的当前账号状态验证目标 ACTIVE ADMIN', async () => {
    const fixture = buildFixture()
    const database = await createTestDb()
    try {
      database.prepare(
        `INSERT INTO user_account
           (user_id, username, password_hash, role, display_name, status)
         VALUES ('user-test-1', 'bootstrap_admin', 'test-hash', 'ADMIN', 'Bootstrap Admin', 'ACTIVE')`
      ).run()
      const trust = createSqliteBootstrapTrustChain([fixture.anchor], database, { now: () => NOW })
      expect(trust.bootstrap({
        installation_identity: fixture.certificate,
        proof_of_possession: fixture.proof,
        authority_registry: fixture.authority,
        enrollment_package: fixture.enrollment
      }).enrollment.user_id).toBe('user-test-1')

      database.prepare("UPDATE user_account SET status = 'DISABLED' WHERE user_id = 'user-test-1'").run()
      expect(() => createSqliteBootstrapTrustChain([fixture.anchor], database, { now: () => NOW }).bootstrap({
        installation_identity: fixture.certificate,
        proof_of_possession: fixture.proof,
        authority_registry: fixture.authority,
        enrollment_package: fixture.enrollment
      })).toThrowError(expect.objectContaining({ code: 'PRINCIPAL_ENROLLMENT_INVALID' }))
    } finally {
      database.close()
    }
  })

  it('持久 replay marker 拒绝同一 PoP nonce 绑定到另一 enrollment 或篡改包', async () => {
    const fixture = buildFixture()
    const database = await createTestDb()
    try {
      const replayStore = createSqliteBootstrapReplayStore(database)
      const input = {
        installation_identity: fixture.certificate,
        proof_of_possession: fixture.proof,
        authority_registry: fixture.authority,
        enrollment_package: fixture.enrollment
      }
      chain(fixture, { replayStore }).bootstrap(input)

      const otherEnrollmentPayload = {
        ...fixture.enrollment.payload,
        enrollment_id: 'enrollment-test-2'
      }
      const otherEnrollment = signEnvelope(otherEnrollmentPayload, SIGNER_KEY_ID, fixture.anchorKeys.privateKey)
      expect(() => chain(fixture, { replayStore }).bootstrap({
        ...input,
        enrollment_package: otherEnrollment
      })).toThrowError(expect.objectContaining({ code: 'PREVIEW_IDEMPOTENCY_CONFLICT' }))

      const changedPackagePayload = {
        ...fixture.enrollment.payload,
        approver_principal_id: 'principal-approver-2'
      }
      const changedPackage = signEnvelope(changedPackagePayload, SIGNER_KEY_ID, fixture.anchorKeys.privateKey)
      expect(() => chain(fixture, { replayStore }).bootstrap({
        ...input,
        enrollment_package: changedPackage
      })).toThrowError(expect.objectContaining({ code: 'PREVIEW_IDEMPOTENCY_CONFLICT' }))
    } finally {
      database.close()
    }
  })

  it('replay store 在安装范围内拒绝跨 certificate/challenge 重用 nonce', async () => {
    const database = await createTestDb()
    try {
      const replayStore = createSqliteBootstrapReplayStore(database)
      const base = {
        replay_key: 'a'.repeat(64),
        target_installation_id: INSTALLATION_ID,
        certificate_id: 'certificate-test-1',
        challenge_id: 'challenge-test-1',
        nonce_hash: 'b'.repeat(64),
        enrollment_id: 'enrollment-test-1',
        enrollment_package_hash: 'c'.repeat(64),
        mapping_id: 'mapping-test-1',
        accepted_at: NOW.toISOString()
      }
      expect(replayStore.reserve(base)).toBe('NEW')
      expect(() => replayStore.reserve({
        ...base,
        replay_key: 'd'.repeat(64),
        certificate_id: 'certificate-test-2',
        challenge_id: 'challenge-test-2',
        enrollment_id: 'enrollment-test-2',
        enrollment_package_hash: 'e'.repeat(64)
      })).toThrowError(expect.objectContaining({ code: 'PREVIEW_IDEMPOTENCY_CONFLICT' }))
    } finally {
      database.close()
    }
  })
})
