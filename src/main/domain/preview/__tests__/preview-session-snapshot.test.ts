import { describe, expect, it } from 'vitest'
import type {
  PreviewCanonicalReferenceSet,
  PreviewPublishBinding,
  PreviewSessionQuestionSnapshot
} from '@shared/types/preview-contract'
import {
  assertPreviewSessionSnapshot,
  buildPreviewSessionSnapshot,
  previewSessionContentRoot,
  previewSessionRendererRoot,
  previewSessionScoringRoot,
  previewSessionSnapshotRoot
} from '../preview-session-snapshot'

const hash = 'a'.repeat(64)
const validity = {
  issued_at: '2026-08-01T00:00:00.000Z',
  effective_at: '2026-08-01T00:00:00.000Z',
  expires_at: '2026-08-15T00:00:00.000Z',
  revoked_at: null
} as const

function references(): PreviewCanonicalReferenceSet {
  return {
    source_ref: {
      source_ref_id: 'preview-source-1',
      namespace: 'preview_publish_set',
      delivery_mode: 'PREVIEW_ONLY',
      authority_id: 'preview-authority-1',
      authority_hash: hash,
      scope: {
        organization_id: 'org-1',
        installation_id: 'install-1',
        job_code: 'SUPERMARKET_SHELVER',
        task_code: 'UNBOX_AND_SHELF',
        permissions: ['PREVIEW_PACK_PUBLISH']
      },
      validity
    },
    pack_ref: { pack_id: 'pack-1', pack_version: '1', pack_hash: hash },
    strategy_ref: { strategy_id: 'strategy-1', strategy_version: 1, policy_hash: hash, scoring_policy_hash: hash },
    question_refs: [{ question_id: 'q-1', question_version: 1, semantic_hash: hash }],
    asset_refs: [{ asset_id: 'asset-1', asset_version: 1, file_hash: hash, rights_hash: hash }],
    renderer_refs: [{ renderer_id: 'renderer-1', renderer_version: '1', renderer_hash: hash }],
    evidence_refs: [{ evidence_id: 'evidence-1', evidence_version: '1', evidence_hash: hash }],
    manifest_ref: { manifest_id: 'manifest-1', manifest_version: '1', manifest_hash: hash, signer_principal_id: 'principal-signer', key_id: 'anchor-1' },
    approval_ref: {
      approval_id: 'approval-1',
      approval_version: '1',
      approval_hash: hash,
      signer_principal_id: 'principal-approver',
      scope: 'JOB_SKILL_PREVIEW_ONLY',
      allowed_actions: ['PREVIEW_PACK_PUBLISH'],
      validity,
      key_id: 'anchor-1'
    }
  }
}

function question(over: Partial<PreviewSessionQuestionSnapshot> = {}): PreviewSessionQuestionSnapshot {
  return {
    question_ref: references().question_refs[0],
    question_order: 1,
    question_phase: 'ONLINE',
    content_json: { prompt: 'place the carton' },
    content_hash: hash,
    scoring_rule_json: { score: 1 },
    scoring_hash: hash,
    asset_refs: references().asset_refs,
    renderer_ref: references().renderer_refs[0],
    evidence_refs: references().evidence_refs,
    safety_ref: 'safety-rule-1',
    ...over
  }
}

function binding(over: Partial<PreviewPublishBinding> = {}): PreviewPublishBinding & { canonical_references: PreviewCanonicalReferenceSet } {
  const refs = references()
  return {
    source_ref: refs.source_ref,
    delivery_mode: 'PREVIEW_ONLY',
    question_ref: refs.question_refs[0],
    pack_ref: refs.pack_ref,
    strategy_ref: refs.strategy_ref,
    manifest_ref: refs.manifest_ref,
    approval_ref: refs.approval_ref,
    asset_refs: refs.asset_refs,
    renderer_refs: refs.renderer_refs,
    evidence_refs: refs.evidence_refs,
    status: 'ACTIVE',
    validity,
    audit_ref: {
      audit_id: 'audit-1',
      event_id: 'event-1',
      aggregate_id: 'release-1',
      aggregate_sequence: 1,
      request_hash: hash,
      actor_user_id: 'admin-1',
      executor_principal_id: 'principal-executor',
      recorded_at: validity.effective_at
    },
    canonical_references: refs,
    ...over
  }
}

function snapshot() {
  return buildPreviewSessionSnapshot({
    session_id: 'preview-session-1',
    assessment_session_id: 'assessment-shell-1',
    student_id: 'student-1',
    job_code: 'SUPERMARKET_SHELVER',
    task_code: 'UNBOX_AND_SHELF',
    assignment_id: 'assignment-1',
    grant_id: 'grant-1',
    device_id: 'device-1',
    binding: binding(),
    question_snapshots: [question()],
    captured_at: '2026-08-01T01:00:00.000Z'
  })
}

describe('preview session snapshot contract', () => {
  it('freezes scope, reference membership and all three question roots', () => {
    const value = snapshot()
    expect(assertPreviewSessionSnapshot(value)).toMatchObject({
      delivery_mode: 'PREVIEW_ONLY',
      source_ref: { namespace: 'preview_publish_set' },
      question_snapshots: [{ question_ref: { question_id: 'q-1' } }]
    })
    expect(value.content_root_hash).toBe(previewSessionContentRoot(value.question_snapshots))
    expect(value.scoring_root_hash).toBe(previewSessionScoringRoot(value.question_snapshots))
    expect(value.renderer_root_hash).toBe(previewSessionRendererRoot(value.question_snapshots))
    const withoutRoot = { ...value, snapshot_root_hash: undefined }
    delete (withoutRoot as Record<string, unknown>).snapshot_root_hash
    expect(value.snapshot_root_hash).toBe(previewSessionSnapshotRoot(withoutRoot as never))
  })

  it('rejects a session business scope that differs from the signed source scope', () => {
    expect(() => buildPreviewSessionSnapshot({
      session_id: 'preview-session-1',
      assessment_session_id: 'assessment-shell-1',
      student_id: 'student-1',
      job_code: 'OTHER_JOB',
      task_code: 'UNBOX_AND_SHELF',
      assignment_id: 'assignment-1',
      grant_id: 'grant-1',
      device_id: 'device-1',
      binding: binding(),
      question_snapshots: [question()],
      captured_at: '2026-08-01T01:00:00.000Z'
    })).toThrow(/PREVIEW_SCOPE_INVALID/)
  })

  it('rejects a question reference that is outside the frozen release set', () => {
    expect(() => buildPreviewSessionSnapshot({
      session_id: 'preview-session-1',
      assessment_session_id: 'assessment-shell-1',
      student_id: 'student-1',
      job_code: 'SUPERMARKET_SHELVER',
      task_code: 'UNBOX_AND_SHELF',
      assignment_id: 'assignment-1',
      grant_id: 'grant-1',
      device_id: 'device-1',
      binding: binding(),
      question_snapshots: [question({ question_ref: { question_id: 'q-2', question_version: 1, semantic_hash: hash } })],
      captured_at: '2026-08-01T01:00:00.000Z'
    })).toThrow(/PREVIEW_APPROVAL_HASH_CONFLICT/)
  })
})
