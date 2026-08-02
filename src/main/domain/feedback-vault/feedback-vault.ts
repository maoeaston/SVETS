import { createOpaqueFeedbackId, assertOpaqueFeedbackId } from './feedback-id'
import { commitJournalPath, ensureFeedbackVaultLayout, exportArtifactPath, FEEDBACK_VAULT_PATHS, revisionBodyPath, stagedBodyPath } from './vault-layout'
import type { DurableFileCapability } from '../event-batch/file-capability'
import { sha256Hex, type CanonicalJsonValue } from '../event-batch/canonical-json'
import { PreviewContractError } from '../preview/preview-errors'
import { serializeFeedbackBody, type FeedbackBodyV1 } from './feedback-serializer'
import { assertFeedbackProof, assertFeedbackProofActive, feedbackProofHash, type FeedbackCommitProofV1 } from './vault-proof'
import { createVaultJournal, createVaultPurgeMarker, listVaultJournal, listVaultPurgeMarkers, readVaultJournal, readVaultPurgeMarker, replaceVaultJournal, type VaultJournalEntry, type VaultJournalState, type VaultPurgeMarker } from './vault-journal'
import { readVaultManifest, writeVaultManifest, type VaultManifestEntry } from './vault-manifest'
import { buildAnonymousFeedbackExport, type AnonymousFeedbackExportV1 } from './feedback-export'
import { removeVaultFile } from './vault-file-removal'

export interface ReserveFeedbackIntentInput {
  feedback_id?: string
  revision_no: number
  operation: 'DRAFT_SAVE' | 'SUBMIT' | 'DELETE' | 'EXPORT'
  body?: FeedbackBodyV1
  session_export_ref: string
  subject_export_ref: string
  organization_id: string
  installation_id: string
  request_hash: string
  actor_auth_ref: string
  issued_at: string
  expires_at: string
  feedback_commit_id?: string
}

export interface PreparedFeedbackCommit {
  feedback_commit_id: string
  feedback_id: string
  revision_no: number
  operation: ReserveFeedbackIntentInput['operation']
  proof: FeedbackCommitProofV1
  proof_hash: string
  body_hash: string
  state: VaultJournalState
}

export interface PurgedFeedbackRevision {
  feedback_commit_id: string
  feedback_id: string
  revision_no: number
  state: 'VAULT_PURGED'
}

function manifestEntries(capability: DurableFileCapability): VaultManifestEntry[] {
  return [...(readVaultManifest(capability)?.entries ?? [])]
}

function updateManifest(capability: DurableFileCapability, commit: PreparedFeedbackCommit, state: VaultJournalState, updatedAt: string): void {
  const entries = manifestEntries(capability)
  const next: VaultManifestEntry = { feedback_commit_id: commit.feedback_commit_id, feedback_id: commit.feedback_id, revision_no: commit.revision_no, operation: commit.operation, state, proof_hash: commit.proof_hash, body_hash: commit.body_hash }
  const index = entries.findIndex((entry) => entry.feedback_commit_id === commit.feedback_commit_id)
  if (index >= 0) entries[index] = next
  else entries.push(next)
  writeVaultManifest(capability, entries, updatedAt)
}

function bodyHash(input: ReserveFeedbackIntentInput): string {
  if (!input.body) return sha256Hex('')
  return serializeFeedbackBody(input.body).body_hash
}

function assertFrozenCommitMatches(commit: PreparedFeedbackCommit, proof: FeedbackCommitProofV1): void {
  const expectedHash = feedbackProofHash(proof)
  if (
    commit.feedback_commit_id !== proof.feedback_commit_id
    || commit.feedback_id !== proof.feedback_id
    || commit.revision_no !== proof.revision_no
    || commit.operation !== proof.operation
    || commit.proof_hash !== expectedHash
    || commit.body_hash !== proof.body_hash
  ) throw new PreviewContractError('FEEDBACK_COMMIT_CONFLICT', 'frozen feedback commit tuple does not match its proof')
}

export class FeedbackVault {
  constructor(readonly capability: DurableFileCapability) {
    ensureFeedbackVaultLayout(capability)
    if (!readVaultManifest(capability)) writeVaultManifest(capability, [], new Date(0).toISOString())
  }

  reserveIntent(input: ReserveFeedbackIntentInput): PreparedFeedbackCommit {
    if (!Number.isSafeInteger(input.revision_no) || input.revision_no < 1) throw new PreviewContractError('PREVIEW_CANONICAL_INVALID', 'feedback revision_no is invalid')
    const feedbackId = assertOpaqueFeedbackId(input.feedback_id ?? createOpaqueFeedbackId(), 'feedback_id')
    if (input.body && (input.body.feedback_id !== feedbackId || input.body.revision_no !== input.revision_no || input.body.session_export_ref !== input.session_export_ref || input.body.subject_export_ref !== input.subject_export_ref)) {
      throw new PreviewContractError('FEEDBACK_COMMIT_CONFLICT', 'feedback body identity does not match the frozen commit tuple')
    }
    const journals = listVaultJournal(this.capability)
    const existingTuple = journals.find((entry) => entry.feedback_id === feedbackId && entry.revision_no === input.revision_no && entry.operation === input.operation)
    if (existingTuple) {
      const existing = this.fromJournal(existingTuple)
      if (existing.proof.request_hash !== input.request_hash || existing.proof_hash !== feedbackProofHash({ ...existing.proof })) throw new PreviewContractError('FEEDBACK_REVISION_CONFLICT', 'feedback revision already belongs to a different request')
      return existing
    }
    const purgedTuple = listVaultPurgeMarkers(this.capability).find((marker) => marker.feedback_id === feedbackId && marker.revision_no === input.revision_no && marker.operation === input.operation)
    if (purgedTuple) throw new PreviewContractError('FEEDBACK_STATE_CONFLICT', 'feedback revision has already been purged')
    const commitId = input.feedback_commit_id ?? createOpaqueFeedbackId()
    assertOpaqueFeedbackId(commitId, 'feedback_commit_id')
    const manifestRoot = readVaultManifest(this.capability)?.root_hash ?? sha256Hex('')
    const proof: FeedbackCommitProofV1 = assertFeedbackProof({
      contract_version: 'PREVIEW_CONTRACT_V1', feedback_commit_id: commitId, operation: input.operation, feedback_id: feedbackId, revision_no: input.revision_no, previous_proof_hash: null, body_hash: bodyHash(input), session_export_ref: input.session_export_ref, subject_export_ref: input.subject_export_ref, organization_id: input.organization_id, installation_id: input.installation_id, request_hash: input.request_hash, actor_auth_ref: input.actor_auth_ref, issued_at: input.issued_at, expires_at: input.expires_at, vault_manifest_root_hash: manifestRoot
    })
    const proofHash = feedbackProofHash(proof)
    const entry: VaultJournalEntry = { feedback_commit_id: commitId, feedback_id: feedbackId, revision_no: input.revision_no, operation: input.operation, state: 'VAULT_INTENT_PREPARED', proof: proof as unknown as Record<string, CanonicalJsonValue>, body_relative_path: input.body ? stagedBodyPath(commitId) : null, created_at: input.issued_at, updated_at: input.issued_at }
    try {
      createVaultJournal(this.capability, entry)
    } catch (error) {
      throw new PreviewContractError('FEEDBACK_COMMIT_ID_COLLISION', 'feedback commit id already exists', undefined, error)
    }
    if (input.body) {
      const serialized = serializeFeedbackBody(input.body)
      const handle = this.capability.createExclusive(stagedBodyPath(commitId), Buffer.from(serialized.canonical_json, 'utf8'))
      this.capability.close(handle)
    }
    updateManifest(this.capability, { feedback_commit_id: commitId, feedback_id: feedbackId, revision_no: input.revision_no, operation: input.operation, proof, proof_hash: proofHash, body_hash: proof.body_hash, state: 'VAULT_INTENT_PREPARED' }, 'VAULT_INTENT_PREPARED', input.issued_at)
    return { feedback_commit_id: commitId, feedback_id: feedbackId, revision_no: input.revision_no, operation: input.operation, proof, proof_hash: proofHash, body_hash: proof.body_hash, state: 'VAULT_INTENT_PREPARED' }
  }

  commitPrepared(commit: PreparedFeedbackCommit): PreparedFeedbackCommit {
    if (readVaultPurgeMarker(this.capability, commit.feedback_commit_id)) throw new PreviewContractError('FEEDBACK_STATE_CONFLICT', 'feedback commit has already been purged')
    const entry = readVaultJournal(this.capability, commit.feedback_commit_id)
    if (!entry) throw new PreviewContractError('FEEDBACK_RECONCILE_REQUIRED', 'frozen feedback commit journal is missing')
    const proof = assertFeedbackProof(entry.proof as unknown as FeedbackCommitProofV1)
    assertFrozenCommitMatches(commit, proof)
    if (entry.state === 'VAULT_COMMITTED' || entry.state === 'VAULT_TOMBSTONED' || entry.state === 'VAULT_EXPORTED') return this.fromJournal(entry)
    if (entry.body_relative_path) {
      const target = revisionBodyPath(proof.feedback_id, proof.revision_no, proof.feedback_commit_id)
      if (!this.capability.readStable(target)) {
        const body = this.capability.readStable(entry.body_relative_path)
        if (!body || body.sha256 !== proof.body_hash) throw new PreviewContractError('FEEDBACK_RECONCILE_REQUIRED', 'staged feedback body is missing or changed')
        this.capability.moveNoClobber(entry.body_relative_path, target)
      }
      const published = this.capability.readStable(target)
      if (!published || published.sha256 !== proof.body_hash) throw new PreviewContractError('FEEDBACK_RECONCILE_REQUIRED', 'published feedback body is missing or changed')
      const nextState: VaultJournalState = proof.operation === 'DELETE' ? 'VAULT_TOMBSTONED' : 'VAULT_COMMITTED'
      const next: VaultJournalEntry = { ...entry, state: nextState, body_relative_path: target, updated_at: proof.issued_at }
      replaceVaultJournal(this.capability, next)
      const updated = this.fromJournal(next)
      updateManifest(this.capability, updated, nextState, next.updated_at)
      return updated
    }
    const nextState: VaultJournalState = proof.operation === 'DELETE' ? 'VAULT_TOMBSTONED' : 'VAULT_COMMITTED'
    const next: VaultJournalEntry = { ...entry, state: nextState, updated_at: proof.issued_at }
    replaceVaultJournal(this.capability, next)
    const updated = this.fromJournal(next)
    updateManifest(this.capability, updated, nextState, next.updated_at)
    return updated
  }

  assertPrepared(commit: PreparedFeedbackCommit): void {
    const entry = readVaultJournal(this.capability, commit.feedback_commit_id)
    if (!entry) throw new PreviewContractError('FEEDBACK_RECONCILE_REQUIRED', 'frozen feedback proof cannot be verified')
    const proof = assertFeedbackProof(entry.proof as unknown as FeedbackCommitProofV1)
    assertFrozenCommitMatches(commit, proof)
    if (entry.body_relative_path) {
      const body = this.capability.readStable(entry.body_relative_path)
      if (!body || body.sha256 !== commit.body_hash) throw new PreviewContractError('FEEDBACK_RECONCILE_REQUIRED', 'frozen feedback body cannot be verified')
    }
  }

  commitIdState(commitId: string): VaultJournalState | null {
    return readVaultJournal(this.capability, commitId)?.state ?? (readVaultPurgeMarker(this.capability, commitId) ? 'VAULT_PURGED' : null)
  }

  loadCommit(commitId: string): PreparedFeedbackCommit {
    const entry = readVaultJournal(this.capability, commitId)
    if (!entry) throw new PreviewContractError('FEEDBACK_RECONCILE_REQUIRED', `feedback commit ${commitId} is missing`)
    return this.fromJournal(entry)
  }

  publishExport(commit: PreparedFeedbackCommit, artifact: AnonymousFeedbackExportV1): Readonly<{ export_hash: string; state: 'VAULT_EXPORTED' }> {
    const entry = readVaultJournal(this.capability, commit.feedback_commit_id)
    if (!entry) throw new PreviewContractError('FEEDBACK_RECONCILE_REQUIRED', 'export commit journal is missing')
    const proof = assertFeedbackProof(entry.proof as unknown as FeedbackCommitProofV1)
    assertFrozenCommitMatches(commit, proof)
    if (commit.operation !== 'SUBMIT' || artifact.feedback_ref !== commit.feedback_id || artifact.revision_no !== commit.revision_no || artifact.session_export_ref !== commit.proof.session_export_ref || artifact.subject_export_ref !== commit.proof.subject_export_ref || artifact.body_hash !== commit.body_hash) {
      throw new PreviewContractError('FEEDBACK_COMMIT_CONFLICT', 'anonymous export does not match the frozen feedback commit')
    }
    const built = buildAnonymousFeedbackExport(artifact)
    const path = exportArtifactPath(artifact.export_ref)
    const existing = this.capability.readStable(path)
    if (existing && existing.sha256 !== built.export_hash) throw new PreviewContractError('FEEDBACK_COMMIT_CONFLICT', 'export artifact ref is already bound to another hash')
    if (entry.state === 'VAULT_EXPORTED') {
      if (!existing) throw new PreviewContractError('FEEDBACK_RECONCILE_REQUIRED', 'export journal is committed but its artifact is missing')
      return { export_hash: built.export_hash, state: 'VAULT_EXPORTED' }
    }
    if (entry.state !== 'VAULT_COMMITTED') throw new PreviewContractError('FEEDBACK_STATE_CONFLICT', `feedback export cannot start from ${entry.state}`)
    assertFeedbackProofActive(proof)
    if (!existing) {
      const handle = this.capability.createExclusive(`${path}.stage`, Buffer.from(built.json, 'utf8'))
      this.capability.close(handle)
      this.capability.atomicReplace(`${path}.stage`, path)
    }
    const next: VaultJournalEntry = { ...entry, state: 'VAULT_EXPORTED', updated_at: entry.updated_at }
    replaceVaultJournal(this.capability, next)
    updateManifest(this.capability, this.fromJournal(next), 'VAULT_EXPORTED', next.updated_at)
    return { export_hash: built.export_hash, state: 'VAULT_EXPORTED' }
  }

  purgeRevision(input: Readonly<{
    feedback_commit_id: string
    feedback_id: string
    revision_no: number
    proof_hash: string
    purged_at?: string
  }>): PurgedFeedbackRevision {
    const targetMarker = readVaultPurgeMarker(this.capability, input.feedback_commit_id)
    const targetEntry = readVaultJournal(this.capability, input.feedback_commit_id)
    if (!targetMarker && !targetEntry) throw new PreviewContractError('FEEDBACK_RECONCILE_REQUIRED', 'purge target commit is missing')
    if (targetMarker) {
      if (targetMarker.feedback_id !== input.feedback_id || targetMarker.revision_no !== input.revision_no || targetMarker.proof_hash !== input.proof_hash) {
        throw new PreviewContractError('FEEDBACK_COMMIT_CONFLICT', 'purge target does not match its frozen proof')
      }
    } else {
      const proof = assertFeedbackProof(targetEntry!.proof as unknown as FeedbackCommitProofV1)
      if (proof.feedback_id !== input.feedback_id || proof.revision_no !== input.revision_no || feedbackProofHash(proof) !== input.proof_hash) {
        throw new PreviewContractError('FEEDBACK_COMMIT_CONFLICT', 'purge target does not match its frozen proof')
      }
    }

    const entries = listVaultJournal(this.capability).filter((entry) => entry.feedback_id === input.feedback_id && entry.revision_no === input.revision_no)
    const markers = listVaultPurgeMarkers(this.capability).filter((marker) => marker.feedback_id === input.feedback_id && marker.revision_no === input.revision_no)
    const purgeMarkers = new Map<string, VaultPurgeMarker>()
    for (const marker of markers) purgeMarkers.set(marker.feedback_commit_id, marker)
    for (const entry of entries) {
      const proof = assertFeedbackProof(entry.proof as unknown as FeedbackCommitProofV1)
      purgeMarkers.set(entry.feedback_commit_id, createVaultPurgeMarker(this.capability, {
        marker_version: 'preview-feedback-vault-purge-v1',
        feedback_commit_id: entry.feedback_commit_id,
        feedback_id: entry.feedback_id,
        revision_no: entry.revision_no,
        operation: entry.operation,
        proof_hash: feedbackProofHash(proof),
        body_hash: proof.body_hash,
        purged_at: input.purged_at ?? proof.issued_at
      }))
    }

    for (const marker of purgeMarkers.values()) {
      removeVaultFile(this.capability, stagedBodyPath(marker.feedback_commit_id))
      removeVaultFile(this.capability, revisionBodyPath(marker.feedback_id, marker.revision_no, marker.feedback_commit_id))
      removeVaultFile(this.capability, commitJournalPath(marker.feedback_commit_id))
    }
    for (const path of this.capability.listRegularFiles(FEEDBACK_VAULT_PATHS.export)) {
      const artifact = this.capability.readStable(path)
      if (!artifact) continue
      try {
        const value = JSON.parse(artifact.bytes.toString('utf8')) as { feedback_ref?: string; revision_no?: number }
        if (value.feedback_ref === input.feedback_id && value.revision_no === input.revision_no) removeVaultFile(this.capability, path, artifact.identity)
      } catch {
        // Anonymous export files are independently validated; leave malformed unrelated files for repair.
      }
    }

    const manifest = manifestEntries(this.capability)
    const purgedIds = new Set(purgeMarkers.keys())
    const retained = manifest.filter((entry) => !purgedIds.has(entry.feedback_commit_id))
    const purgedEntries = [...purgeMarkers.values()].map((marker) => ({
      feedback_commit_id: marker.feedback_commit_id,
      feedback_id: marker.feedback_id,
      revision_no: marker.revision_no,
      operation: marker.operation,
      state: 'VAULT_PURGED',
      proof_hash: marker.proof_hash,
      body_hash: marker.body_hash
    }))
    writeVaultManifest(this.capability, [...retained, ...purgedEntries], input.purged_at ?? new Date().toISOString())
    return { feedback_commit_id: input.feedback_commit_id, feedback_id: input.feedback_id, revision_no: input.revision_no, state: 'VAULT_PURGED' }
  }

  private fromJournal(entry: VaultJournalEntry): PreparedFeedbackCommit {
    const proof = assertFeedbackProof(entry.proof as unknown as FeedbackCommitProofV1)
    return { feedback_commit_id: entry.feedback_commit_id, feedback_id: entry.feedback_id, revision_no: entry.revision_no, operation: entry.operation as ReserveFeedbackIntentInput['operation'], proof, proof_hash: feedbackProofHash(proof), body_hash: proof.body_hash, state: entry.state }
  }
}
