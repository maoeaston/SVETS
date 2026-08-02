import { createHash, createPublicKey } from 'crypto'
import type { PreviewScope } from '@shared/types/preview-contract'
import { PREVIEW_CONTRACT_VERSION } from '../../../shared/types/preview-contract'
import { assertExactKeys, assertScope, assertText, assertTimestamp } from '../preview/preview-canonical'
import { PreviewContractError } from '../preview/preview-errors'
import {
  SignedManifestVerifier,
  type CompiledTrustAnchor,
  type SignedDocumentEnvelope
} from './signed-manifest-verifier'

export interface AuthorityRegistryPayload {
  registry_id: string
  registry_version: string
  contract_version: typeof PREVIEW_CONTRACT_VERSION
  target_installation_id: string
  organization_id: string
  allowed_signers: readonly string[]
  provisioning_signers: readonly string[]
  capability_types: readonly string[]
  scope: PreviewScope
  expires_at: string
  revoked_key_ids: readonly string[]
}

export interface AuthorityRegistrySnapshot extends AuthorityRegistryPayload {
  payload_hash: string
  signer_key_id: string
  signer_fingerprint: string
}

export function fingerprintPublicKey(publicKeyPem: string): string {
  try {
    const key = createPublicKey(publicKeyPem)
    const der = key.export({ type: 'spki', format: 'der' })
    return createHash('sha256').update(der).digest('hex')
  } catch (error) {
    throw new PreviewContractError('AUTHORITY_REGISTRY_INVALID', 'public key fingerprint cannot be computed', undefined, error)
  }
}

function validatePayload(payload: AuthorityRegistryPayload): AuthorityRegistryPayload {
  assertExactKeys(payload, [
    'allowed_signers',
    'capability_types',
    'contract_version',
    'expires_at',
    'organization_id',
    'provisioning_signers',
    'registry_id',
    'registry_version',
    'revoked_key_ids',
    'scope',
    'target_installation_id'
  ], 'authority_registry.payload')
  assertText(payload.registry_id, 'authority_registry.registry_id')
  assertText(payload.registry_version, 'authority_registry.registry_version')
  if (payload.contract_version !== PREVIEW_CONTRACT_VERSION) throw new PreviewContractError('AUTHORITY_REGISTRY_INVALID', 'contract version mismatch')
  assertText(payload.target_installation_id, 'authority_registry.target_installation_id')
  assertText(payload.organization_id, 'authority_registry.organization_id')
  assertScope(payload.scope)
  assertTimestamp(payload.expires_at, 'authority_registry.expires_at')
  for (const [field, values] of Object.entries({
    allowed_signers: payload.allowed_signers,
    provisioning_signers: payload.provisioning_signers,
    capability_types: payload.capability_types,
    revoked_key_ids: payload.revoked_key_ids
  })) {
    if (!Array.isArray(values) || values.some((value) => typeof value !== 'string' || value.trim() !== value || value.length === 0)) {
      throw new PreviewContractError('AUTHORITY_REGISTRY_INVALID', `${field} must be a string array`, field)
    }
  }
  return payload
}

export class AuthorityRegistry {
  readonly verifier: SignedManifestVerifier
  private snapshot: AuthorityRegistrySnapshot | null = null

  constructor(compiledAnchors: readonly CompiledTrustAnchor[]) {
    this.verifier = new SignedManifestVerifier(compiledAnchors)
  }

  load<T extends AuthorityRegistryPayload>(envelope: SignedDocumentEnvelope<T>): AuthorityRegistrySnapshot {
    const verified = this.verifier.verify(envelope, 'AUTHORITY_REGISTRY')
    const payload = validatePayload(verified.payload)
    if (Date.parse(payload.expires_at) <= Date.now()) throw new PreviewContractError('AUTHORITY_REGISTRY_INVALID', 'authority registry is expired')
    if (payload.scope.installation_id !== payload.target_installation_id || payload.scope.organization_id !== payload.organization_id) {
      throw new PreviewContractError('PREVIEW_SCOPE_INVALID', 'authority registry scope does not match target')
    }
    this.snapshot = Object.freeze({
      ...payload,
      payload_hash: verified.payload_hash,
      signer_key_id: verified.key_id,
      signer_fingerprint: verified.fingerprint
    })
    return this.snapshot
  }

  current(): AuthorityRegistrySnapshot {
    if (!this.snapshot) throw new PreviewContractError('AUTHORITY_REGISTRY_INVALID', 'authority registry has not been loaded')
    if (Date.parse(this.snapshot.expires_at) <= Date.now()) throw new PreviewContractError('AUTHORITY_REGISTRY_INVALID', 'authority registry is expired')
    return this.snapshot
  }

  assertCapability(capabilityType: string, scope: PreviewScope, signerKeyId?: string): void {
    const registry = this.current()
    if (!registry.capability_types.includes(capabilityType)) throw new PreviewContractError('PREVIEW_SCOPE_INVALID', `capability ${capabilityType} is not registered`)
    if (signerKeyId && registry.revoked_key_ids.includes(signerKeyId)) throw new PreviewContractError('AUTHORITY_REGISTRY_INVALID', `key ${signerKeyId} is revoked`)
    if (scope.installation_id !== registry.scope.installation_id || scope.organization_id !== registry.scope.organization_id) {
      throw new PreviewContractError('PREVIEW_SCOPE_INVALID', 'capability scope does not match registry')
    }
    const registryPermissions = new Set(registry.scope.permissions)
    if (scope.permissions.some((permission) => !registryPermissions.has(permission))) throw new PreviewContractError('PREVIEW_SCOPE_INVALID', 'capability permission exceeds registry scope')
  }

  assertSignerAllowed(keyId: string, kind: 'release' | 'provisioning'): void {
    const registry = this.current()
    const allowed = kind === 'release' ? registry.allowed_signers : registry.provisioning_signers
    if (!allowed.includes(keyId) || registry.revoked_key_ids.includes(keyId)) throw new PreviewContractError('AUTHORITY_REGISTRY_INVALID', `${kind} signer is not allowed`)
  }
}

export function createCompiledTrustAnchorSet(anchors: readonly CompiledTrustAnchor[]): readonly CompiledTrustAnchor[] {
  if (anchors.length === 0) throw new PreviewContractError('AUTHORITY_REGISTRY_INVALID', 'compiled trust anchor set is empty')
  return Object.freeze(anchors.map((anchor) => Object.freeze({
    ...anchor,
    allowed_scopes: Object.freeze([...anchor.allowed_scopes])
  })))
}
