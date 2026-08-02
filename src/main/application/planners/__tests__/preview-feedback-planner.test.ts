import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildCommandEnvelopeV2 } from '../../command/command-envelope'
import { createTestDb, seedAssessmentSessionFixture, seedCaller, seedStudent } from '../../../db/test-helpers'
import { canonicalJson } from '../../../domain/event-batch/canonical-json'
import { promotePreviewContractReady } from '../../../domain/preview/preview-promotion'
import { FeedbackVault } from '../../../domain/feedback-vault/feedback-vault'
import { DurableFileCapability } from '../../../domain/event-batch/file-capability'
import { PreviewContractError } from '../../../domain/preview/preview-errors'
import {
  loadPreviewFeedbackPlannerSnapshot,
  PreviewFeedbackPlanner,
  type PreviewFeedbackTrustContext
} from '../preview-feedback-planner'

const TIME = '2026-08-01T05:00:00.000Z'
const HASH = 'b'.repeat(64)
const dbs: Array<{ close: () => void }> = []
const roots: string[] = []

function envelope() {
  return buildCommandEnvelopeV2({
    commandId: '71000000-0000-4000-8000-000000000001',
    commandType: 'feedback:delete',
    source: 'INTERNAL',
    actor: { kind: 'USER', userId: 'admin-1', role: 'ADMIN', authSessionId: 'auth-1' },
    target: { aggregate_type: 'PREVIEW_FEEDBACK', feedback_id: 'feedback-1', revision_no: 1 },
    payload: {
      deletion: {
        feedback_id: 'feedback-1',
        revision_no: 1,
        session_id: 'preview-session-1',
        organization_id: 'org-1'
      }
    },
    requestHash: 'a'.repeat(64),
    createdAt: TIME,
    clientInstanceId: '72000000-0000-4000-8000-000000000001',
    idempotencyKey: '73000000-0000-4000-8000-000000000001',
    eventBatchId: '74000000-0000-4000-8000-000000000001',
    actorId: 'admin-1',
    deviceId: null,
    authSessionId: 'auth-1',
    leaseOwner: 'worker',
    leaseGeneration: 1
  })
}

function purgeEnvelope(feedbackId: string, commitId: string, proofHash: string) {
  return buildCommandEnvelopeV2({
    commandId: '71000000-0000-4000-8000-000000000002',
    commandType: 'feedback:purge',
    source: 'INTERNAL',
    actor: { kind: 'USER', userId: 'admin-1', role: 'ADMIN', authSessionId: 'auth-1' },
    target: { aggregate_type: 'PREVIEW_FEEDBACK', feedback_id: feedbackId, revision_no: 1 },
    payload: {
      purge: {
        feedback_id: feedbackId,
        revision_no: 1,
        session_id: 'preview-session-purge-1',
        organization_id: 'org-1',
        target_commit_id: commitId,
        proof_hash: proofHash,
        capability_ref: 'capability-purge-1'
      }
    },
    requestHash: HASH,
    createdAt: TIME,
    clientInstanceId: '72000000-0000-4000-8000-000000000001',
    idempotencyKey: '73000000-0000-4000-8000-000000000002',
    eventBatchId: '74000000-0000-4000-8000-000000000002',
    actorId: 'admin-1',
    deviceId: null,
    authSessionId: 'auth-1',
    leaseOwner: 'worker',
    leaseGeneration: 1
  })
}

function references() {
  return {
    source_ref: {
      source_ref_id: 'source-purge-1',
      namespace: 'preview_publish_set' as const,
      delivery_mode: 'PREVIEW_ONLY' as const,
      authority_id: 'authority-purge-1',
      authority_hash: HASH,
      scope: {
        organization_id: 'org-1',
        installation_id: 'install-1',
        job_code: 'SUPERMARKET_SHELVER',
        task_code: 'UNBOX_AND_SHELF',
        permissions: ['PREVIEW_SESSION_START']
      },
      validity: {
        issued_at: '2026-08-01T00:00:00.000Z',
        effective_at: '2026-08-01T00:00:00.000Z',
        expires_at: '2026-08-15T00:00:00.000Z',
        revoked_at: null
      }
    },
    pack_ref: { pack_id: 'pack-purge-1', pack_version: '1', pack_hash: HASH },
    strategy_ref: { strategy_id: 'strategy_job_skill_shelver_v1', strategy_version: 1, policy_hash: HASH, scoring_policy_hash: HASH },
    question_refs: [{ question_id: 'q-purge-1', question_version: 1, semantic_hash: HASH }],
    asset_refs: [],
    renderer_refs: [{ renderer_id: 'renderer-purge-1', renderer_version: '1', renderer_hash: HASH }],
    evidence_refs: [],
    manifest_ref: { manifest_id: 'manifest-purge-1', manifest_version: '1', manifest_hash: HASH, signer_principal_id: 'signer-purge-1', key_id: 'key-purge-1' },
    approval_ref: {
      approval_id: 'approval-purge-1',
      approval_version: '1',
      approval_hash: HASH,
      signer_principal_id: 'approver-purge-1',
      scope: 'JOB_SKILL_PREVIEW_ONLY' as const,
      allowed_actions: ['PREVIEW_PACK_PUBLISH'],
      validity: {
        issued_at: '2026-08-01T00:00:00.000Z',
        effective_at: '2026-08-01T00:00:00.000Z',
        expires_at: '2026-08-15T00:00:00.000Z',
        revoked_at: null
      },
      key_id: 'key-purge-1'
    }
  }
}

afterEach(() => {
  while (dbs.length > 0) dbs.pop()!.close()
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true })
})

describe('preview feedback planner trust boundary', () => {
  it('requires a verified TOMBSTONE capability even for an ADMIN actor', async () => {
    const db = await createTestDb()
    dbs.push(db)
    promotePreviewContractReady(db, TIME)
    const root = mkdtempSync(join(tmpdir(), 'svets-preview-feedback-planner-'))
    roots.push(root)
    const vault = new FeedbackVault(new DurableFileCapability(root))
    const assertCapability = vi.fn(() => {
      throw new PreviewContractError('FEEDBACK_CAPABILITY_INVALID', 'capability is missing')
    })
    const trust: PreviewFeedbackTrustContext = {
      resolveScope: () => ({
        installation_id: 'install-1',
        organization_id: 'org-1',
        job_code: 'SUPERMARKET_SHELVER',
        task_code: 'UNBOX_AND_SHELF'
      }),
      assertCapability
    }

    const snapshot = loadPreviewFeedbackPlannerSnapshot(db, envelope(), { timestamp: TIME, appVersion: 'test' }, vault, trust)

    expect(snapshot.value).toMatchObject({
      kind: 'NO_OP',
      no_op_result: { success: false, errorCode: 'FEEDBACK_CAPABILITY_INVALID' }
    })
    expect(assertCapability).toHaveBeenCalledWith('TOMBSTONE', expect.anything(), expect.anything())
  })

  it('replans an already purged revision from its durable marker without loading deleted journal data', async () => {
    const db = await createTestDb()
    dbs.push(db)
    promotePreviewContractReady(db, TIME)
    const adminId = seedCaller(db, 'ADMIN')
    const studentId = seedStudent(db)
    seedAssessmentSessionFixture(db, {
      sessionId: 'assessment-shell-purge-1',
      studentId,
      strategyId: 'strategy_job_skill_shelver_v1',
      strategyType: 'JOB_SKILL_ASSESSMENT',
      jobCode: 'SUPERMARKET_SHELVER',
      taskCode: 'UNBOX_AND_SHELF',
      status: 'INIT',
      createdBy: adminId
    })
    db.prepare("UPDATE assessment_session SET session_contract_kind = 'PREVIEW_SHELL', preview_contract_version = 'PREVIEW_CONTRACT_V1' WHERE session_id = 'assessment-shell-purge-1'").run()
    const canonicalReferences = references()
    db.prepare(
      `INSERT INTO preview_event_projection (
         event_id, contract_registry_id, aggregate_type, aggregate_id, event_type,
         event_sequence, payload_json, checksum, created_at
       ) VALUES ('release-event-purge-1', 'PREVIEW_CONTRACT_V1', 'PREVIEW_RELEASE', 'release-purge-1', 'PREVIEW_PACK_RELEASED', 1, '{}', ?, ?)`
    ).run(HASH, TIME)
    db.prepare(
      `INSERT INTO preview_release_projection (
         release_id, source_ref_id, delivery_mode, question_id, question_version,
         semantic_hash, pack_id, pack_version, pack_hash, strategy_id, strategy_version,
         policy_hash, approval_id, approval_hash, manifest_id, manifest_hash,
         references_json, status, effective_at, expires_at, created_event_id, audit_ref
       ) VALUES ('release-purge-1', ?, 'PREVIEW_ONLY', ?, 1, ?, ?, '1', ?, ?, 1,
         ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, 'release-event-purge-1', 'audit-purge-1')`
    ).run(
      canonicalReferences.source_ref.source_ref_id,
      canonicalReferences.question_refs[0].question_id,
      HASH,
      canonicalReferences.pack_ref.pack_id,
      HASH,
      canonicalReferences.strategy_ref.strategy_id,
      HASH,
      canonicalReferences.approval_ref.approval_id,
      HASH,
      canonicalReferences.manifest_ref.manifest_id,
      HASH,
      canonicalJson(canonicalReferences as never),
      '2026-08-01T00:00:00.000Z',
      '2026-08-15T00:00:00.000Z'
    )
    db.prepare(
      `INSERT INTO preview_session_projection (
         preview_session_id, assessment_session_id, contract_registry_id, contract_version,
         delivery_mode, student_id, job_code, task_code, pack_id, pack_version, pack_hash,
         source_ref_id, strategy_id, strategy_version, snapshot_json, content_root_hash,
         scoring_root_hash, renderer_root_hash, snapshot_root_hash, assignment_id, grant_id,
         status, result_suppressed, created_event_id
       ) VALUES (?, ?, 'PREVIEW_CONTRACT_V1', 'PREVIEW_CONTRACT_V1', 'PREVIEW_ONLY', ?, ?, ?, ?, '1', ?,
         ?, ?, 1, '{}', ?, ?, ?, ?, 'assignment-purge-1', 'grant-purge-1', 'PREPARED', 1, ?)`
    ).run(
      'preview-session-purge-1',
      'assessment-shell-purge-1',
      studentId,
      'SUPERMARKET_SHELVER',
      'UNBOX_AND_SHELF',
      canonicalReferences.pack_ref.pack_id,
      HASH,
      canonicalReferences.source_ref.source_ref_id,
      canonicalReferences.strategy_ref.strategy_id,
      HASH,
      HASH,
      HASH,
      HASH,
      'release-event-purge-1'
    )
    const root = mkdtempSync(join(tmpdir(), 'svets-preview-feedback-purge-plan-'))
    roots.push(root)
    const vault = new FeedbackVault(new DurableFileCapability(root))
    const feedbackId = '81111111-1111-4111-8111-111111111111'
    const commit = vault.commitPrepared(vault.reserveIntent({
      feedback_id: feedbackId,
      revision_no: 1,
      operation: 'SUBMIT',
      session_export_ref: 'session-export-purge-1',
      subject_export_ref: 'subject-export-purge-1',
      organization_id: 'org-1',
      installation_id: 'install-1',
      request_hash: HASH,
      actor_auth_ref: 'auth-1',
      issued_at: '2026-08-01T04:00:00.000Z',
      expires_at: '2026-08-15T04:00:00.000Z',
      feedback_commit_id: '82222222-2222-4222-8222-222222222222'
    }))
    db.prepare(
      `INSERT INTO preview_feedback_reference_projection (
         feedback_id, revision_no, feedback_commit_id, proof_hash, session_id,
         organization_id, status, body_hash, session_export_ref, subject_export_ref,
         created_event_id
       ) VALUES (?, 1, ?, ?, ?, 'org-1', 'RECONCILED_SUBMITTED', ?, 'session-export-purge-1', 'subject-export-purge-1', ?)`
    ).run(feedbackId, commit.feedback_commit_id, commit.proof_hash, 'preview-session-purge-1', commit.body_hash, 'release-event-purge-1')

    const loadCommit = vi.spyOn(vault, 'loadCommit')
    const trust: PreviewFeedbackTrustContext = {
      resolveScope: () => ({ installation_id: 'install-1', organization_id: 'org-1', job_code: 'SUPERMARKET_SHELVER', task_code: 'UNBOX_AND_SHELF' }),
      assertCapability: vi.fn()
    }
    const initialSnapshot = loadPreviewFeedbackPlannerSnapshot(db, purgeEnvelope(feedbackId, commit.feedback_commit_id, commit.proof_hash), { timestamp: TIME, appVersion: 'test' }, vault, trust)
    expect(initialSnapshot.value).toMatchObject({ kind: 'PURGE', facts: { status_after: 'PURGED', target_commit_id: commit.feedback_commit_id, proof_hash: commit.proof_hash } })
    expect(loadCommit).toHaveBeenCalledTimes(1)
    expect(new PreviewFeedbackPlanner().plan({ envelope: purgeEnvelope(feedbackId, commit.feedback_commit_id, commit.proof_hash), snapshot: initialSnapshot })).toMatchObject({ events: [expect.anything()], noOpResult: null })

    vault.purgeRevision({ feedback_commit_id: commit.feedback_commit_id, feedback_id: feedbackId, revision_no: 1, proof_hash: commit.proof_hash, purged_at: '2026-08-01T04:01:00.000Z' })
    loadCommit.mockClear()
    const staleReferenceSnapshot = loadPreviewFeedbackPlannerSnapshot(db, purgeEnvelope(feedbackId, commit.feedback_commit_id, commit.proof_hash), { timestamp: TIME, appVersion: 'test' }, vault, trust)
    expect(staleReferenceSnapshot.value).toMatchObject({ kind: 'PURGE', facts: { status_after: 'PURGED' } })
    expect(loadCommit).not.toHaveBeenCalled()
    db.prepare("UPDATE preview_feedback_reference_projection SET status = 'PURGED' WHERE feedback_commit_id = ?").run(commit.feedback_commit_id)

    const snapshot = loadPreviewFeedbackPlannerSnapshot(db, purgeEnvelope(feedbackId, commit.feedback_commit_id, commit.proof_hash), { timestamp: TIME, appVersion: 'test' }, vault, trust)
    expect(snapshot.value).toMatchObject({ kind: 'NO_OP', no_op_result: { success: true, reason: 'ALREADY_PURGED', status: 'PURGED', feedback_commit_id: commit.feedback_commit_id } })
    expect(loadCommit).not.toHaveBeenCalled()
    const plan = new PreviewFeedbackPlanner().plan({ envelope: purgeEnvelope(feedbackId, commit.feedback_commit_id, commit.proof_hash), snapshot })
    expect(plan).toMatchObject({ events: [], noOpResult: { success: true, reason: 'ALREADY_PURGED' } })
  })
})
