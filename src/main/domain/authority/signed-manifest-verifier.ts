import {
  createPublicKey,
  verify as verifySignature,
  type KeyObject
} from 'crypto'
import {
  assertExactKeys,
  assertHash,
  assertText,
  canonicalPreviewBytes,
  hashPreviewDocument
} from '../preview/preview-canonical'
import { PreviewContractError } from '../preview/preview-errors'

export interface SignedDocumentEnvelope<T extends object> {
  payload: T
  payload_hash: string
  key_id: string
  signature: string
  algorithm: 'Ed25519'
}

export interface CompiledTrustAnchor {
  key_id: string
  public_key_pem: string
  fingerprint: string
  allowed_scopes: readonly string[]
}

export interface VerifiedSignedDocument<T extends object> {
  payload: T
  payload_hash: string
  key_id: string
  fingerprint: string
  algorithm: 'Ed25519'
}

function decodeSignature(value: string): Buffer {
  if (/^[0-9a-f]{128}$/i.test(value)) return Buffer.from(value, 'hex')
  try {
    return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  } catch (error) {
    throw new PreviewContractError('PREVIEW_APPROVAL_INVALID', 'signature encoding is invalid', 'signature', error)
  }
}

function keyObject(anchor: CompiledTrustAnchor): KeyObject {
  try {
    const key = createPublicKey(anchor.public_key_pem)
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('public key is not Ed25519')
    return key
  } catch (error) {
    throw new PreviewContractError('AUTHORITY_REGISTRY_INVALID', `trust anchor ${anchor.key_id} is invalid`, 'public_key_pem', error)
  }
}

export class SignedManifestVerifier {
  private readonly anchors: ReadonlyMap<string, CompiledTrustAnchor>
  private readonly keys = new Map<string, KeyObject>()

  constructor(anchors: readonly CompiledTrustAnchor[]) {
    if (anchors.length === 0) throw new PreviewContractError('AUTHORITY_REGISTRY_INVALID', 'compiled trust anchor set is empty')
    const map = new Map<string, CompiledTrustAnchor>()
    for (const anchor of anchors) {
      assertText(anchor.key_id, 'trust_anchor.key_id')
      assertText(anchor.fingerprint, 'trust_anchor.fingerprint')
      if (map.has(anchor.key_id)) throw new PreviewContractError('AUTHORITY_REGISTRY_INVALID', `duplicate trust anchor ${anchor.key_id}`)
      map.set(anchor.key_id, Object.freeze({
        key_id: anchor.key_id,
        public_key_pem: anchor.public_key_pem,
        fingerprint: anchor.fingerprint,
        allowed_scopes: Object.freeze([...anchor.allowed_scopes])
      }))
    }
    this.anchors = map
  }

  verify<T extends object>(envelope: SignedDocumentEnvelope<T>, requiredScope?: string): VerifiedSignedDocument<T> {
    assertExactKeys(envelope, ['algorithm', 'key_id', 'payload', 'payload_hash', 'signature'], 'signed_document')
    if (envelope.algorithm !== 'Ed25519') throw new PreviewContractError('PREVIEW_APPROVAL_INVALID', 'only Ed25519 is accepted', 'algorithm')
    const keyId = assertText(envelope.key_id, 'signed_document.key_id')
    const anchor = this.anchors.get(keyId)
    if (!anchor) throw new PreviewContractError('AUTHORITY_REGISTRY_INVALID', `unknown trust anchor ${keyId}`, 'key_id')
    if (requiredScope && !anchor.allowed_scopes.includes(requiredScope)) {
      throw new PreviewContractError('PREVIEW_SCOPE_INVALID', `trust anchor ${keyId} is not allowed for ${requiredScope}`)
    }
    const payloadHash = assertHash(envelope.payload_hash, 'signed_document.payload_hash')
    const actualHash = hashPreviewDocument(envelope.payload as never)
    if (payloadHash !== actualHash) throw new PreviewContractError('PREVIEW_HASH_INVALID', 'signed payload hash mismatch', 'payload_hash')
    const signature = decodeSignature(assertText(envelope.signature, 'signed_document.signature'))
    let valid = false
    try {
      const key = this.keys.get(keyId) ?? keyObject(anchor)
      this.keys.set(keyId, key)
      valid = verifySignature(null, canonicalPreviewBytes(envelope.payload as never), key, signature)
    } catch (error) {
      throw new PreviewContractError('PREVIEW_APPROVAL_INVALID', 'signature verification failed', 'signature', error)
    }
    if (!valid) throw new PreviewContractError('PREVIEW_APPROVAL_INVALID', 'signature is not valid', 'signature')
    return Object.freeze({
      payload: envelope.payload,
      payload_hash: payloadHash,
      key_id: keyId,
      fingerprint: anchor.fingerprint,
      algorithm: 'Ed25519'
    })
  }
}
