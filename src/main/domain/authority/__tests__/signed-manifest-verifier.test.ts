import { generateKeyPairSync, sign } from 'crypto'
import { describe, expect, it } from 'vitest'
import { fingerprintPublicKey, AuthorityRegistry } from '../authority-registry'
import { canonicalPreviewBytes, hashPreviewDocument } from '../../preview/preview-canonical'
import { SignedManifestVerifier, type CompiledTrustAnchor } from '../signed-manifest-verifier'

function signedPayload() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const anchor: CompiledTrustAnchor = {
    key_id: 'anchor-1',
    public_key_pem: publicKeyPem,
    fingerprint: fingerprintPublicKey(publicKeyPem),
    allowed_scopes: ['AUTHORITY_REGISTRY', 'PREVIEW_MANIFEST']
  }
  const payload = {
    registry_id: 'registry-1',
    registry_version: '1',
    contract_version: 'PREVIEW_CONTRACT_V1' as const,
    target_installation_id: 'install-1',
    organization_id: 'org-1',
    allowed_signers: ['release-key-1'],
    provisioning_signers: ['provision-key-1'],
    capability_types: ['PREVIEW_PACK_RELEASE'],
    scope: {
      installation_id: 'install-1',
      organization_id: 'org-1',
      job_code: 'SUPERMARKET_SHELVLER',
      task_code: 'UNBOX_AND_SHELF',
      permissions: ['PREVIEW_PACK_RELEASE']
    },
    expires_at: '2026-08-30T00:00:00.000Z',
    revoked_key_ids: [] as string[]
  }
  const payloadHash = hashPreviewDocument(payload)
  const signature = sign(null, canonicalPreviewBytes(payload), privateKey).toString('base64')
  return {
    anchor,
    payload,
    envelope: { payload, payload_hash: payloadHash, key_id: 'anchor-1', signature, algorithm: 'Ed25519' as const }
  }
}

describe('signed PREVIEW_CONTRACT_V1 authority', () => {
  it('verifies an Ed25519 envelope against compiled anchors', () => {
    const fixture = signedPayload()
    const registry = new AuthorityRegistry([fixture.anchor])
    expect(registry.load(fixture.envelope)).toMatchObject({
      registry_id: 'registry-1',
      signer_key_id: 'anchor-1'
    })
    expect(() => registry.assertCapability('PREVIEW_PACK_RELEASE', fixture.payload.scope)).not.toThrow()
  })

  it('rejects payload hash and signature drift', () => {
    const fixture = signedPayload()
    const verifier = new SignedManifestVerifier([fixture.anchor])
    expect(() => verifier.verify({ ...fixture.envelope, payload_hash: 'b'.repeat(64) })).toThrow(/hash mismatch/)
    expect(() => verifier.verify({ ...fixture.envelope, signature: '00'.repeat(64) })).toThrow(/signature/)
  })

  it('does not accept an anchor scope that is not compiled', () => {
    const fixture = signedPayload()
    const verifier = new SignedManifestVerifier([fixture.anchor])
    expect(() => verifier.verify(fixture.envelope, 'UNDECLARED_SCOPE')).toThrow(/not allowed/)
  })
})
