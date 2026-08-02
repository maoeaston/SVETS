import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { DBAdapter } from '../../../db/interface'
import { DurableFileCapability } from '../../event-batch/file-capability'
import { FeedbackDeleteService } from '../feedback-delete-service'
import { FeedbackVault } from '../feedback-vault'
import { FeedbackReconcileService } from '../feedback-reconcile-service'
import { commitJournalPath, exportArtifactPath, purgeMarkerPath, revisionBodyPath } from '../vault-layout'
import { readVaultPurgeMarker } from '../vault-journal'

const feedbackId = '11111111-1111-4111-8111-111111111111'
const submitCommitId = '22222222-2222-4222-8222-222222222222'
const hash = 'a'.repeat(64)
const roots: string[] = []

function feedbackBody() {
  return {
    feedback_id: feedbackId,
    revision_no: 1,
    session_export_ref: 'session-export-1',
    subject_export_ref: 'subject-export-1',
    body: { rating: 2 }
  } as const
}

function reserveInput(operation: 'SUBMIT' | 'DELETE', requestHash: string) {
  return {
    feedback_id: feedbackId,
    revision_no: 1,
    operation,
    body: operation === 'SUBMIT' ? feedbackBody() : undefined,
    session_export_ref: 'session-export-1',
    subject_export_ref: 'subject-export-1',
    organization_id: 'org-1',
    installation_id: 'install-1',
    request_hash: requestHash,
    actor_auth_ref: 'auth-1',
    issued_at: '2026-08-01T04:00:00.000Z',
    expires_at: '2026-08-15T04:00:00.000Z',
    feedback_commit_id: operation === 'SUBMIT' ? submitCommitId : undefined
  }
}

function deleteDatabase(submitCommit: string, status = 'RECONCILED_SUBMITTED'): DBAdapter {
  return {
    prepare() {
      return {
        get: () => ({
          feedback_id: feedbackId,
          revision_no: 1,
          status,
          feedback_commit_id: submitCommit
        }),
        all: () => [],
        run: () => undefined
      }
    },
    transaction: (callback) => callback,
    immediateTransaction: (callback) => callback,
    exec: () => undefined
  }
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true })
})

describe('preview feedback vault contract', () => {
  it('freezes submit proof/body, rejects tuple tampering, and allocates a distinct delete commit', () => {
    const root = mkdtempSync(join(tmpdir(), 'svets-feedback-vault-'))
    roots.push(root)
    const vault = new FeedbackVault(new DurableFileCapability(root))
    const submit = vault.reserveIntent(reserveInput('SUBMIT', hash))
    const committed = vault.commitPrepared(submit)

    expect(committed.state).toBe('VAULT_COMMITTED')
    expect(() => vault.assertPrepared({ ...committed, body_hash: 'b'.repeat(64) }))
      .toThrowError(expect.objectContaining({ code: 'FEEDBACK_COMMIT_CONFLICT' }))

    const deleteService = new FeedbackDeleteService(deleteDatabase(submit.feedback_commit_id), vault)
    const deletion = deleteService.reserveDelete({
      feedback_id: feedbackId,
      revision_no: 1,
      session_export_ref: 'session-export-1',
      subject_export_ref: 'subject-export-1',
      organization_id: 'org-1',
      installation_id: 'install-1',
      request_hash: 'c'.repeat(64),
      actor_auth_ref: 'auth-1',
      issued_at: '2026-08-01T04:00:01.000Z',
      expires_at: '2026-08-15T04:00:01.000Z',
      reason_code: 'TEST_DELETE'
    })
    deleteService.assertTombstoneDoesNotReuseSubmitCommit({
      feedback_id: deletion.feedback_id,
      revision_no: deletion.revision_no,
      feedback_commit_id: deletion.feedback_commit_id
    })
    expect(deletion.feedback_commit_id).not.toBe(submit.feedback_commit_id)
    expect(deletion.operation).toBe('DELETE')
  })

  it('publishes only an anonymous export matching the frozen submit proof', () => {
    const root = mkdtempSync(join(tmpdir(), 'svets-feedback-export-'))
    roots.push(root)
    const vault = new FeedbackVault(new DurableFileCapability(root))
    const submit = vault.commitPrepared(vault.reserveIntent(reserveInput('SUBMIT', hash)))
    const artifact = {
      export_format: 'preview-feedback-export-v1' as const,
      export_ref: 'export-1',
      feedback_ref: feedbackId,
      revision_no: 1,
      session_export_ref: 'session-export-1',
      subject_export_ref: 'subject-export-1',
      body_hash: submit.body_hash,
      submitted_at: '2026-08-01T04:00:00.000Z',
      status: 'SUBMITTED' as const
    }

    expect(vault.publishExport(submit, artifact).state).toBe('VAULT_EXPORTED')
    expect(() => vault.publishExport(submit, { ...artifact, body_hash: 'd'.repeat(64) }))
      .toThrowError(expect.objectContaining({ code: 'FEEDBACK_COMMIT_CONFLICT' }))
  })

  it('rejects export before commit and after the proof validity window', () => {
    const root = mkdtempSync(join(tmpdir(), 'svets-feedback-export-state-'))
    roots.push(root)
    const vault = new FeedbackVault(new DurableFileCapability(root))
    const intent = vault.reserveIntent(reserveInput('SUBMIT', hash))
    const artifact = {
      export_format: 'preview-feedback-export-v1' as const,
      export_ref: 'export-state-1',
      feedback_ref: feedbackId,
      revision_no: 1,
      session_export_ref: 'session-export-1',
      subject_export_ref: 'subject-export-1',
      body_hash: intent.body_hash,
      submitted_at: '2026-08-01T04:00:00.000Z',
      status: 'SUBMITTED' as const
    }
    expect(() => vault.publishExport(intent, artifact)).toThrowError(expect.objectContaining({ code: 'FEEDBACK_STATE_CONFLICT' }))

    const expired = vault.commitPrepared(vault.reserveIntent({
      ...reserveInput('SUBMIT', 'b'.repeat(64)),
      revision_no: 2,
      feedback_id: '33333333-3333-4333-8333-333333333333',
      body: {
        ...feedbackBody(),
        feedback_id: '33333333-3333-4333-8333-333333333333',
        revision_no: 2
      },
      issued_at: '2020-01-01T00:00:00.000Z',
      expires_at: '2020-01-02T00:00:00.000Z',
      feedback_commit_id: '44444444-4444-4444-8444-444444444444'
    }))
    expect(() => vault.publishExport(expired, { ...artifact, export_ref: 'export-state-2', feedback_ref: expired.feedback_id, revision_no: 2, body_hash: expired.body_hash }))
      .toThrowError(expect.objectContaining({ code: 'FEEDBACK_COMMIT_CONFLICT' }))
  })

  it('purges revision bodies, journals and exports behind an idempotent vault marker', () => {
    const root = mkdtempSync(join(tmpdir(), 'svets-feedback-purge-'))
    roots.push(root)
    const vault = new FeedbackVault(new DurableFileCapability(root))
    const commit = vault.commitPrepared(vault.reserveIntent(reserveInput('SUBMIT', hash)))
    const artifact = {
      export_format: 'preview-feedback-export-v1' as const,
      export_ref: 'export-purge-1',
      feedback_ref: feedbackId,
      revision_no: 1,
      session_export_ref: 'session-export-1',
      subject_export_ref: 'subject-export-1',
      body_hash: commit.body_hash,
      submitted_at: '2026-08-01T04:00:00.000Z',
      status: 'SUBMITTED' as const
    }
    vault.publishExport(commit, artifact)
    const capability = vault.capability
    const purged = vault.purgeRevision({
      feedback_commit_id: commit.feedback_commit_id,
      feedback_id: commit.feedback_id,
      revision_no: commit.revision_no,
      proof_hash: commit.proof_hash,
      purged_at: '2026-08-01T04:01:00.000Z'
    })

    expect(purged.state).toBe('VAULT_PURGED')
    expect(capability.readStable(commitJournalPath(commit.feedback_commit_id))).toBeNull()
    expect(capability.readStable(revisionBodyPath(commit.feedback_id, commit.revision_no, commit.feedback_commit_id))).toBeNull()
    expect(capability.readStable(exportArtifactPath(artifact.export_ref))).toBeNull()
    expect(readVaultPurgeMarker(capability, commit.feedback_commit_id)).toMatchObject({
      feedback_commit_id: commit.feedback_commit_id,
      proof_hash: commit.proof_hash,
      body_hash: commit.body_hash
    })
    expect(capability.readStable(purgeMarkerPath(commit.feedback_commit_id))).not.toBeNull()
    expect(vault.commitIdState(commit.feedback_commit_id)).toBe('VAULT_PURGED')
    expect(new FeedbackReconcileService(deleteDatabase(commit.feedback_commit_id, 'PURGED'), vault).inspect(commit.feedback_commit_id)).toBe('PURGED')
    expect(vault.purgeRevision({
      feedback_commit_id: commit.feedback_commit_id,
      feedback_id: commit.feedback_id,
      revision_no: commit.revision_no,
      proof_hash: commit.proof_hash,
      purged_at: '2026-08-01T04:01:00.000Z'
    }).state).toBe('VAULT_PURGED')
    expect(() => vault.reserveIntent(reserveInput('SUBMIT', 'c'.repeat(64)))).toThrowError(expect.objectContaining({ code: 'FEEDBACK_STATE_CONFLICT' }))
  })

  it('reopens committed/exported state and purge markers from the same userData root', () => {
    const root = mkdtempSync(join(tmpdir(), 'svets-feedback-vault-restart-'))
    roots.push(root)
    const firstVault = new FeedbackVault(new DurableFileCapability(root))
    const commit = firstVault.commitPrepared(firstVault.reserveIntent(reserveInput('SUBMIT', hash)))
    const artifact = {
      export_format: 'preview-feedback-export-v1' as const,
      export_ref: 'export-restart-1',
      feedback_ref: feedbackId,
      revision_no: 1,
      session_export_ref: 'session-export-1',
      subject_export_ref: 'subject-export-1',
      body_hash: commit.body_hash,
      submitted_at: '2026-08-01T04:00:00.000Z',
      status: 'SUBMITTED' as const
    }
    firstVault.publishExport(commit, artifact)

    const reopenedVault = new FeedbackVault(new DurableFileCapability(root))
    expect(reopenedVault.commitIdState(commit.feedback_commit_id)).toBe('VAULT_EXPORTED')
    expect(reopenedVault.loadCommit(commit.feedback_commit_id)).toMatchObject({
      feedback_commit_id: commit.feedback_commit_id,
      state: 'VAULT_EXPORTED'
    })

    reopenedVault.purgeRevision({
      feedback_commit_id: commit.feedback_commit_id,
      feedback_id: commit.feedback_id,
      revision_no: commit.revision_no,
      proof_hash: commit.proof_hash,
      purged_at: '2026-08-01T04:02:00.000Z'
    })

    const reopenedAfterPurge = new FeedbackVault(new DurableFileCapability(root))
    expect(reopenedAfterPurge.commitIdState(commit.feedback_commit_id)).toBe('VAULT_PURGED')
    expect(() => reopenedAfterPurge.loadCommit(commit.feedback_commit_id)).toThrowError(expect.objectContaining({
      code: 'FEEDBACK_RECONCILE_REQUIRED'
    }))
  })
})
