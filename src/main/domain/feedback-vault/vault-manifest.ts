import type { DurableFileCapability } from '../event-batch/file-capability'
import { canonicalJson, type CanonicalJsonValue } from '../event-batch/canonical-json'
import { PreviewContractError } from '../preview/preview-errors'
import { FEEDBACK_VAULT_FORMAT_VERSION, FEEDBACK_VAULT_PATHS } from './vault-layout'

export interface VaultManifestEntry {
  feedback_commit_id: string
  feedback_id: string
  revision_no: number
  operation: string
  state: string
  proof_hash: string
  body_hash: string
}

export interface VaultManifestV1 {
  format_version: typeof FEEDBACK_VAULT_FORMAT_VERSION
  updated_at: string
  entries: readonly VaultManifestEntry[]
  root_hash: string
}

function rootHash(formatVersion: string, entries: readonly VaultManifestEntry[]): string {
  const { sha256CanonicalJson } = requireCanonical()
  return sha256CanonicalJson({ format_version: formatVersion, entries: [...entries].sort((a, b) => a.feedback_commit_id.localeCompare(b.feedback_commit_id)) } as never)
}

function requireCanonical(): typeof import('../event-batch/canonical-json') {
  // Static module loading is required for main-process local modules. Keeping
  // this helper synchronous makes the manifest code easy to use in tests.
  return canonicalModule
}

import * as canonicalModule from '../event-batch/canonical-json'

export function readVaultManifest(capability: DurableFileCapability): VaultManifestV1 | null {
  const snapshot = capability.readStable(FEEDBACK_VAULT_PATHS.manifest)
  if (!snapshot) return null
  try {
    const value = JSON.parse(snapshot.bytes.toString('utf8')) as VaultManifestV1
    if (value.format_version !== FEEDBACK_VAULT_FORMAT_VERSION || !Array.isArray(value.entries) || typeof value.root_hash !== 'string' || rootHash(value.format_version, value.entries) !== value.root_hash) throw new Error('manifest root hash mismatch')
    return value
  } catch (error) {
    throw new PreviewContractError('FEEDBACK_RECONCILE_REQUIRED', 'feedback vault manifest is corrupt', undefined, error)
  }
}

export function writeVaultManifest(capability: DurableFileCapability, entries: readonly VaultManifestEntry[], updatedAt: string): VaultManifestV1 {
  const manifest: VaultManifestV1 = { format_version: FEEDBACK_VAULT_FORMAT_VERSION, updated_at: updatedAt, entries: Object.freeze([...entries].sort((a, b) => a.feedback_commit_id.localeCompare(b.feedback_commit_id))), root_hash: rootHash(FEEDBACK_VAULT_FORMAT_VERSION, entries) }
  const temp = `${FEEDBACK_VAULT_PATHS.manifest}.tmp-${manifest.root_hash.slice(0, 16)}`
  const handle = capability.createExclusive(temp, Buffer.from(canonicalJson(manifest as unknown as CanonicalJsonValue), 'utf8'))
  capability.close(handle)
  const existing = capability.readStable(FEEDBACK_VAULT_PATHS.manifest)
  capability.atomicReplace(temp, FEEDBACK_VAULT_PATHS.manifest, existing?.identity)
  return Object.freeze(manifest)
}
