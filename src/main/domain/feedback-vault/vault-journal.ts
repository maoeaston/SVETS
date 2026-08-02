import type { DurableFileCapability } from '../event-batch/file-capability'
import { canonicalJson, type CanonicalJsonValue } from '../event-batch/canonical-json'
import { PreviewContractError } from '../preview/preview-errors'
import { commitJournalPath, FEEDBACK_VAULT_PATHS, purgeMarkerPath } from './vault-layout'

export type VaultJournalState = 'VAULT_INTENT_PREPARED' | 'VAULT_COMMITTED' | 'VAULT_TOMBSTONED' | 'VAULT_EXPORTED' | 'VAULT_PURGED'

export interface VaultPurgeMarker {
  marker_version: 'preview-feedback-vault-purge-v1'
  feedback_commit_id: string
  feedback_id: string
  revision_no: number
  operation: string
  proof_hash: string
  body_hash: string
  purged_at: string
}

export interface VaultJournalEntry {
  feedback_commit_id: string
  feedback_id: string
  revision_no: number
  operation: string
  state: VaultJournalState
  proof: Readonly<Record<string, CanonicalJsonValue>>
  body_relative_path: string | null
  created_at: string
  updated_at: string
}

export function readVaultJournal(capability: DurableFileCapability, commitId: string): VaultJournalEntry | null {
  const snapshot = capability.readStable(commitJournalPath(commitId))
  if (!snapshot) return null
  try {
    return JSON.parse(snapshot.bytes.toString('utf8')) as VaultJournalEntry
  } catch (error) {
    throw new PreviewContractError('FEEDBACK_RECONCILE_REQUIRED', `vault journal ${commitId} is invalid`, undefined, error)
  }
}

export function listVaultJournal(capability: DurableFileCapability): readonly VaultJournalEntry[] {
  return Object.freeze(capability.listRegularFiles(FEEDBACK_VAULT_PATHS.journal).filter((path) => path.startsWith(`${FEEDBACK_VAULT_PATHS.journal}/commit-`) && path.endsWith('.json')).map((path) => {
    const commitId = path.slice(`${FEEDBACK_VAULT_PATHS.journal}/commit-`.length, -'.json'.length)
    const entry = readVaultJournal(capability, commitId)
    if (!entry) throw new PreviewContractError('FEEDBACK_RECONCILE_REQUIRED', `vault journal ${commitId} disappeared`)
    return entry
  }))
}

function parsePurgeMarker(bytes: Buffer, commitId: string): VaultPurgeMarker {
  try {
    const marker = JSON.parse(bytes.toString('utf8')) as VaultPurgeMarker
    if (
      marker.marker_version !== 'preview-feedback-vault-purge-v1'
      || marker.feedback_commit_id !== commitId
      || typeof marker.feedback_id !== 'string'
      || !Number.isSafeInteger(marker.revision_no)
      || marker.revision_no < 1
      || typeof marker.operation !== 'string'
      || !/^[0-9a-f]{64}$/.test(marker.proof_hash)
      || !/^[0-9a-f]{64}$/.test(marker.body_hash)
      || typeof marker.purged_at !== 'string'
    ) throw new Error('invalid purge marker')
    return Object.freeze(marker)
  } catch (error) {
    throw new PreviewContractError('FEEDBACK_RECONCILE_REQUIRED', `vault purge marker ${commitId} is invalid`, undefined, error)
  }
}

export function readVaultPurgeMarker(capability: DurableFileCapability, commitId: string): VaultPurgeMarker | null {
  const snapshot = capability.readStable(purgeMarkerPath(commitId))
  return snapshot ? parsePurgeMarker(snapshot.bytes, commitId) : null
}

export function listVaultPurgeMarkers(capability: DurableFileCapability): readonly VaultPurgeMarker[] {
  return Object.freeze(capability.listRegularFiles(FEEDBACK_VAULT_PATHS.journal)
    .filter((path) => path.startsWith(`${FEEDBACK_VAULT_PATHS.journal}/purged-`) && path.endsWith('.json'))
    .map((path) => readVaultPurgeMarker(capability, path.slice(`${FEEDBACK_VAULT_PATHS.journal}/purged-`.length, -'.json'.length))!)
  )
}

export function createVaultPurgeMarker(capability: DurableFileCapability, marker: VaultPurgeMarker): VaultPurgeMarker {
  const existing = readVaultPurgeMarker(capability, marker.feedback_commit_id)
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(marker)) throw new PreviewContractError('FEEDBACK_COMMIT_CONFLICT', 'purge marker conflicts with the frozen commit')
    return existing
  }
  const handle = capability.createExclusive(purgeMarkerPath(marker.feedback_commit_id), Buffer.from(canonicalJson(marker as unknown as CanonicalJsonValue), 'utf8'))
  capability.close(handle)
  return Object.freeze(marker)
}

export function createVaultJournal(capability: DurableFileCapability, entry: VaultJournalEntry): void {
  const handle = capability.createExclusive(commitJournalPath(entry.feedback_commit_id), Buffer.from(canonicalJson(entry as unknown as CanonicalJsonValue), 'utf8'))
  capability.close(handle)
}

export function replaceVaultJournal(capability: DurableFileCapability, entry: VaultJournalEntry): void {
  const temp = `${commitJournalPath(entry.feedback_commit_id)}.tmp-${entry.updated_at.replace(/[^0-9]/g, '')}`
  const handle = capability.createExclusive(temp, Buffer.from(canonicalJson(entry as unknown as CanonicalJsonValue), 'utf8'))
  capability.close(handle)
  const existing = capability.readStable(commitJournalPath(entry.feedback_commit_id))
  if (!existing) throw new PreviewContractError('FEEDBACK_RECONCILE_REQUIRED', 'vault journal disappeared before state transition')
  capability.atomicReplace(temp, commitJournalPath(entry.feedback_commit_id), existing.identity)
}
