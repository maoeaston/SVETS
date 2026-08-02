import {
  createPublicKey,
  verify as verifySignature,
  type KeyObject
} from 'node:crypto'
import {
  PREVIEW_CONTRACT_VERSION,
  type PreviewContractVersion
} from '../../../shared/types/preview-contract'
import {
  assertExactKeys,
  assertText,
  assertTimestamp,
  canonicalPreviewBytes,
  hashPreviewDocument
} from '../preview/preview-canonical'
import { PreviewContractError } from '../preview/preview-errors'
import type { DBAdapter } from '../../db/interface'
import {
  AuthorityRegistry,
  createCompiledTrustAnchorSet,
  type AuthorityRegistryPayload,
  type AuthorityRegistrySnapshot
} from './authority-registry'
import {
  PrincipalBindingService,
  createSqlitePrincipalUserAccountResolver,
  type PrincipalEnrollmentEnvelope,
  type PrincipalEnrollmentPackage,
  type PrincipalBindingFact,
  type PrincipalUserAccountResolver
} from './principal-binding-service'
import {
  SignedManifestVerifier,
  type CompiledTrustAnchor,
  type SignedDocumentEnvelope,
  type VerifiedSignedDocument
} from './signed-manifest-verifier'

export interface InstallationIdentityCertificatePayload {
  certificate_id: string
  certificate_version: 'INSTALLATION_IDENTITY_V1'
  installation_id: string
  organization_id: string
  public_key_pem: string
  issued_at: string
  expires_at: string
  contract_version: PreviewContractVersion
}

export type InstallationIdentityCertificate = SignedDocumentEnvelope<InstallationIdentityCertificatePayload>

export interface InstallationProofOfPossessionPayload {
  challenge_id: string
  certificate_id: string
  installation_id: string
  nonce: string
  issued_at: string
  expires_at: string
}

export interface InstallationProofOfPossession extends InstallationProofOfPossessionPayload {
  algorithm: 'Ed25519'
  signature: string
}

export interface BootstrapTrustChainInput {
  installation_identity: InstallationIdentityCertificate
  proof_of_possession: InstallationProofOfPossession
  authority_registry: SignedDocumentEnvelope<AuthorityRegistryPayload>
  enrollment_package?: PrincipalEnrollmentEnvelope
}

export interface BootstrapReplayReservationInput {
  readonly replay_key: string
  readonly target_installation_id: string
  readonly certificate_id: string
  readonly challenge_id: string
  readonly nonce_hash: string
  readonly enrollment_id: string
  readonly enrollment_package_hash: string
  readonly mapping_id: string
  readonly accepted_at: string
}

export interface BootstrapReplayStore {
  reserve(input: BootstrapReplayReservationInput): 'NEW' | 'REPLAY'
}

export interface SqliteBootstrapTrustChainOptions {
  readonly now?: () => Date
  readonly replayStore?: BootstrapReplayStore
}

export interface BootstrapTrustSnapshot {
  readonly certificate: VerifiedSignedDocument<InstallationIdentityCertificatePayload>
  readonly proof_of_possession: Readonly<{ challenge_id: string; nonce: string }>
  readonly authority_registry: AuthorityRegistrySnapshot
  readonly enrollment_id: string
  readonly enrollment: PrincipalBindingFact
  readonly anchor_fingerprints: readonly string[]
}

export function createSqliteBootstrapReplayStore(database: DBAdapter): BootstrapReplayStore {
  return {
    reserve(input) {
      const reserve = database.immediateTransaction(() => {
        const existingProof = database.prepare(
          `SELECT certificate_id, challenge_id, enrollment_id, enrollment_package_hash
             FROM preview_bootstrap_replay_projection
            WHERE target_installation_id = ?
              AND nonce_hash = ?`
        ).get(
          input.target_installation_id,
          input.nonce_hash
        ) as {
          certificate_id?: string
          challenge_id?: string
          enrollment_id?: string
          enrollment_package_hash?: string
        } | undefined
        if (existingProof) {
          if (
            existingProof.certificate_id !== input.certificate_id
            || existingProof.challenge_id !== input.challenge_id
            || existingProof.enrollment_id !== input.enrollment_id
            || existingProof.enrollment_package_hash !== input.enrollment_package_hash
          ) {
            throw new PreviewContractError('PREVIEW_IDEMPOTENCY_CONFLICT', 'proof-of-possession nonce is already bound to another proof or enrollment')
          }
          return 'REPLAY' as const
        }

        const existingEnrollment = database.prepare(
          `SELECT enrollment_package_hash
             FROM preview_bootstrap_replay_projection
            WHERE target_installation_id = ? AND enrollment_id = ?`
        ).get(input.target_installation_id, input.enrollment_id) as {
          enrollment_package_hash?: string
        } | undefined
        if (existingEnrollment) {
          if (existingEnrollment.enrollment_package_hash !== input.enrollment_package_hash) {
            throw new PreviewContractError('PREVIEW_IDEMPOTENCY_CONFLICT', 'enrollment_id is already bound to a different package')
          }
          return 'REPLAY' as const
        }

        database.prepare(
          `INSERT INTO preview_bootstrap_replay_projection
             (replay_key, target_installation_id, certificate_id, challenge_id,
              nonce_hash, enrollment_id, enrollment_package_hash, mapping_id, accepted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          input.replay_key,
          input.target_installation_id,
          input.certificate_id,
          input.challenge_id,
          input.nonce_hash,
          input.enrollment_id,
          input.enrollment_package_hash,
          input.mapping_id,
          input.accepted_at
        )
        return 'NEW' as const
      })
      return reserve()
    }
  }
}

export function createSqliteBootstrapTrustChain(
  compiledAnchors: readonly CompiledTrustAnchor[],
  database: DBAdapter,
  options: SqliteBootstrapTrustChainOptions = {}
): BootstrapTrustChain {
  return new BootstrapTrustChain(compiledAnchors, {
    now: options.now,
    replayStore: options.replayStore ?? createSqliteBootstrapReplayStore(database),
    resolveUserAccount: createSqlitePrincipalUserAccountResolver(database)
  })
}

function decodeSignature(value: string): Buffer {
  if (/^[0-9a-f]{128}$/i.test(value)) return Buffer.from(value, 'hex')
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const decoded = Buffer.from(normalized, 'base64')
  if (decoded.length !== 64) throw new Error('Ed25519 signature must be 64 bytes')
  return decoded
}

function publicKey(value: string, field: string): KeyObject {
  try {
    const key = createPublicKey(value)
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('public key is not Ed25519')
    return key
  } catch (error) {
    throw new PreviewContractError('INSTALLATION_IDENTITY_INVALID', 'installation public key is invalid', field, error)
  }
}

function validWindow(issuedAt: string, expiresAt: string, now: Date, field: string): void {
  assertTimestamp(issuedAt, `${field}.issued_at`)
  assertTimestamp(expiresAt, `${field}.expires_at`)
  if (Date.parse(issuedAt) >= Date.parse(expiresAt)) {
    throw new PreviewContractError('INSTALLATION_IDENTITY_INVALID', 'issued_at must precede expires_at', field)
  }
  if (Date.parse(expiresAt) <= now.getTime()) {
    throw new PreviewContractError('INSTALLATION_IDENTITY_INVALID', 'signed identity proof is expired', field)
  }
}

function validateCertificatePayload(
  payload: InstallationIdentityCertificatePayload,
  now: Date
): InstallationIdentityCertificatePayload {
  assertExactKeys(payload, [
    'certificate_id',
    'certificate_version',
    'contract_version',
    'expires_at',
    'installation_id',
    'issued_at',
    'organization_id',
    'public_key_pem'
  ], 'installation_identity.payload')
  assertText(payload.certificate_id, 'installation_identity.certificate_id')
  assertText(payload.installation_id, 'installation_identity.installation_id')
  assertText(payload.organization_id, 'installation_identity.organization_id')
  if (
    typeof payload.public_key_pem !== 'string'
    || payload.public_key_pem.trim().length === 0
    || Buffer.byteLength(payload.public_key_pem, 'utf8') > 16_384
  ) throw new PreviewContractError('INSTALLATION_IDENTITY_INVALID', 'installation public key is invalid', 'installation_identity.public_key_pem')
  if (payload.certificate_version !== 'INSTALLATION_IDENTITY_V1') {
    throw new PreviewContractError('INSTALLATION_IDENTITY_INVALID', 'installation certificate version is unsupported')
  }
  if (payload.contract_version !== PREVIEW_CONTRACT_VERSION) {
    throw new PreviewContractError('INSTALLATION_IDENTITY_INVALID', 'installation certificate contract version is unsupported')
  }
  validWindow(payload.issued_at, payload.expires_at, now, 'installation_identity')
  publicKey(payload.public_key_pem, 'installation_identity.public_key_pem')
  return Object.freeze({ ...payload })
}

function validateProofPayload(
  proof: InstallationProofOfPossession,
  certificate: InstallationIdentityCertificatePayload,
  now: Date
): void {
  assertExactKeys(proof, [
    'algorithm',
    'certificate_id',
    'challenge_id',
    'expires_at',
    'installation_id',
    'issued_at',
    'nonce',
    'signature'
  ], 'installation_identity.proof')
  if (proof.algorithm !== 'Ed25519') throw new PreviewContractError('INSTALLATION_IDENTITY_INVALID', 'proof algorithm is unsupported')
  assertText(proof.challenge_id, 'installation_identity.proof.challenge_id')
  assertText(proof.certificate_id, 'installation_identity.proof.certificate_id')
  assertText(proof.installation_id, 'installation_identity.proof.installation_id')
  assertText(proof.nonce, 'installation_identity.proof.nonce', 256)
  assertText(proof.signature, 'installation_identity.proof.signature', 256)
  validWindow(proof.issued_at, proof.expires_at, now, 'installation_identity.proof')
  if (
    proof.certificate_id !== certificate.certificate_id
    || proof.installation_id !== certificate.installation_id
  ) throw new PreviewContractError('INSTALLATION_IDENTITY_INVALID', 'proof does not bind to the installation certificate')
}

function verifyProof(
  proof: InstallationProofOfPossession,
  certificate: InstallationIdentityCertificatePayload
): void {
  let signature: Buffer
  try {
    signature = decodeSignature(proof.signature)
  } catch (error) {
    throw new PreviewContractError('INSTALLATION_IDENTITY_INVALID', 'proof signature encoding is invalid', 'signature', error)
  }
  const key = publicKey(certificate.public_key_pem, 'installation_identity.public_key_pem')
  let valid = false
  try {
    const payload: InstallationProofOfPossessionPayload = {
      challenge_id: proof.challenge_id,
      certificate_id: proof.certificate_id,
      installation_id: proof.installation_id,
      nonce: proof.nonce,
      issued_at: proof.issued_at,
      expires_at: proof.expires_at
    }
    valid = verifySignature(null, canonicalPreviewBytes(payload as never), key, signature)
  } catch (error) {
    throw new PreviewContractError('INSTALLATION_IDENTITY_INVALID', 'proof signature verification failed', 'signature', error)
  }
  if (!valid) throw new PreviewContractError('INSTALLATION_IDENTITY_INVALID', 'proof signature is not valid', 'signature')
}

export class BootstrapTrustChain {
  private readonly anchors: readonly CompiledTrustAnchor[]
  private readonly verifier: SignedManifestVerifier
  private readonly replayStore: BootstrapReplayStore
  private readonly resolveUserAccount: PrincipalUserAccountResolver

  constructor(
    compiledAnchors: readonly CompiledTrustAnchor[],
    private readonly options: {
      now?: () => Date
      replayStore: BootstrapReplayStore
      resolveUserAccount: PrincipalUserAccountResolver
    }
  ) {
    this.replayStore = options.replayStore
    this.resolveUserAccount = options.resolveUserAccount
    try {
      this.anchors = createCompiledTrustAnchorSet(compiledAnchors)
      this.verifier = new SignedManifestVerifier(this.anchors)
    } catch (error) {
      if (error instanceof PreviewContractError && error.code === 'AUTHORITY_REGISTRY_INVALID') {
        throw new PreviewContractError('INSTALLATION_TRUST_UNAVAILABLE', 'compiled trust-anchor set is unavailable', undefined, error)
      }
      throw error
    }
  }

  bootstrap(input: BootstrapTrustChainInput): BootstrapTrustSnapshot {
    const now = this.options.now?.() ?? new Date()
    if (Number.isNaN(now.getTime())) throw new PreviewContractError('INSTALLATION_TRUST_UNAVAILABLE', 'bootstrap clock is invalid')

    let verifiedCertificate: VerifiedSignedDocument<InstallationIdentityCertificatePayload>
    try {
      verifiedCertificate = this.verifier.verify(input.installation_identity, 'INSTALLATION_IDENTITY')
      validateCertificatePayload(verifiedCertificate.payload, now)
    } catch (error) {
      if (error instanceof PreviewContractError && error.code === 'INSTALLATION_IDENTITY_INVALID') throw error
      throw new PreviewContractError('INSTALLATION_IDENTITY_INVALID', 'installation identity certificate is invalid', undefined, error)
    }
    const certificate = verifiedCertificate.payload

    validateProofPayload(input.proof_of_possession, certificate, now)
    verifyProof(input.proof_of_possession, certificate)

    if (!input.authority_registry) {
      throw new PreviewContractError('AUTHORITY_REGISTRY_INVALID', 'signed authority registry is required')
    }
    const authority = new AuthorityRegistry(this.anchors)
    let authoritySnapshot: AuthorityRegistrySnapshot
    try {
      authoritySnapshot = authority.load(input.authority_registry)
    } catch (error) {
      if (error instanceof PreviewContractError) throw error
      throw new PreviewContractError('AUTHORITY_REGISTRY_INVALID', 'signed authority registry is invalid', undefined, error)
    }
    if (
      authoritySnapshot.target_installation_id !== certificate.installation_id
      || authoritySnapshot.organization_id !== certificate.organization_id
    ) throw new PreviewContractError('PREVIEW_SCOPE_INVALID', 'authority registry is bound to another installation')

    if (!input.enrollment_package) {
      throw new PreviewContractError('PRINCIPAL_ENROLLMENT_REQUIRED', 'signed principal enrollment package is required')
    }
    const service = new PrincipalBindingService({
      verifier: this.verifier,
      authorityRegistry: authority,
      now: this.options.now,
      resolveUserAccount: this.resolveUserAccount
    })
    let enrollment: Readonly<{
      enrollment_id: string
      fact: PrincipalBindingFact
    }>
    try {
      const verifiedEnrollment = service.verifyEnrollmentEnvelope(input.enrollment_package, {
        target_installation_id: certificate.installation_id,
        organization_id: certificate.organization_id,
        now,
        authorityRegistry: authoritySnapshot
      })
      enrollment = {
        enrollment_id: verifiedEnrollment.enrollment_id,
        fact: verifiedEnrollment.fact
      }
    } catch (error) {
      if (error instanceof PreviewContractError) {
        if (error.code === 'PRINCIPAL_SEPARATION_OF_DUTIES_FAILED') throw error
        throw new PreviewContractError('PRINCIPAL_ENROLLMENT_INVALID', error.message, error.field, error)
      }
      throw new PreviewContractError('PRINCIPAL_ENROLLMENT_INVALID', 'signed enrollment package is invalid', undefined, error)
    }

    const enrollmentPackage = input.enrollment_package
    const enrollmentPackageHash = hashPreviewDocument(enrollmentPackage.payload)
    const replayKey = hashPreviewDocument({
      certificate_id: certificate.certificate_id,
      challenge_id: input.proof_of_possession.challenge_id,
      installation_id: certificate.installation_id,
      nonce: input.proof_of_possession.nonce
    })
    try {
      this.replayStore.reserve({
        replay_key: replayKey,
        target_installation_id: certificate.installation_id,
        certificate_id: certificate.certificate_id,
        challenge_id: input.proof_of_possession.challenge_id,
        nonce_hash: hashPreviewDocument({ nonce: input.proof_of_possession.nonce }),
        enrollment_id: enrollment.enrollment_id,
        enrollment_package_hash: enrollmentPackageHash,
        mapping_id: enrollment.fact.mapping_id,
        accepted_at: now.toISOString()
      })
    } catch (error) {
      if (error instanceof PreviewContractError) throw error
      throw new PreviewContractError('INSTALLATION_TRUST_UNAVAILABLE', 'bootstrap replay store is unavailable', undefined, error)
    }

    return Object.freeze({
      certificate: verifiedCertificate,
      proof_of_possession: Object.freeze({
        challenge_id: input.proof_of_possession.challenge_id,
        nonce: input.proof_of_possession.nonce
      }),
      authority_registry: authoritySnapshot,
      enrollment_id: enrollment.enrollment_id,
      enrollment: enrollment.fact,
      anchor_fingerprints: Object.freeze(this.anchors.map((anchor) => anchor.fingerprint).sort())
    })
  }
}

export function principalEnrollmentPackage(
  value: PrincipalEnrollmentPackage
): PrincipalEnrollmentPackage {
  return Object.freeze({
    ...value,
    enrollment: Object.freeze({ ...value.enrollment }),
    future_release_executor_principal_ids: Object.freeze([...value.future_release_executor_principal_ids])
  })
}
