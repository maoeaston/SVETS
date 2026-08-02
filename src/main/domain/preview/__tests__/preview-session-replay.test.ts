import { describe, expect, it } from 'vitest'
import type { PreviewSessionSnapshot } from '@shared/types/preview-contract'
import {
  previewSessionContentRoot,
  previewSessionRendererRoot,
  previewSessionScoringRoot,
  previewSessionSnapshotRoot
} from '../preview-session-snapshot'
import { replayPreviewSession } from '../preview-session-replay'

const hash = 'b'.repeat(64)

function makeSnapshot(): PreviewSessionSnapshot {
  const question = {
    question_ref: { question_id: 'q-1', question_version: 1, semantic_hash: hash },
    question_order: 1,
    question_phase: 'ONLINE' as const,
    content_json: { prompt: 'demo' },
    content_hash: hash,
    scoring_rule_json: { score: 1 },
    scoring_hash: hash,
    asset_refs: [],
    renderer_ref: { renderer_id: 'renderer-1', renderer_version: '1', renderer_hash: hash },
    evidence_refs: [],
    safety_ref: 'safety-1'
  }
  const withoutRoot = {
    snapshot_schema_version: 'preview-contract-v1' as const,
    contract_version: 'PREVIEW_CONTRACT_V1' as const,
    delivery_mode: 'PREVIEW_ONLY' as const,
    session_id: 'preview-session-1',
    assessment_session_id: 'assessment-shell-1',
    student_id: 'student-1',
    job_code: 'SUPERMARKET_SHELVER',
    task_code: 'UNBOX_AND_SHELF',
    pack_ref: { pack_id: 'pack-1', pack_version: '1', pack_hash: hash },
    source_ref: {
      source_ref_id: 'source-1',
      namespace: 'preview_publish_set' as const,
      delivery_mode: 'PREVIEW_ONLY' as const,
      authority_id: 'authority-1',
      authority_hash: hash,
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
    manifest_ref: { manifest_id: 'manifest-1', manifest_version: '1', manifest_hash: hash, signer_principal_id: 'signer-1', key_id: 'key-1' },
    approval_ref: {
      approval_id: 'approval-1',
      approval_version: '1',
      approval_hash: hash,
      signer_principal_id: 'approver-1',
      scope: 'JOB_SKILL_PREVIEW_ONLY' as const,
      allowed_actions: ['PREVIEW_SESSION_START'] as never,
      validity: {
        issued_at: '2026-08-01T00:00:00.000Z',
        effective_at: '2026-08-01T00:00:00.000Z',
        expires_at: '2026-08-15T00:00:00.000Z',
        revoked_at: null
      },
      key_id: 'key-1'
    },
    strategy_ref: { strategy_id: 'strategy-1', strategy_version: 1, policy_hash: hash, scoring_policy_hash: hash },
    assignment_id: 'assignment-1',
    grant_id: 'grant-1',
    device_id: 'device-1',
    question_snapshots: [question],
    content_root_hash: previewSessionContentRoot([question]),
    scoring_root_hash: previewSessionScoringRoot([question]),
    renderer_root_hash: previewSessionRendererRoot([question]),
    captured_at: '2026-08-01T01:00:00.000Z'
  }
  return { ...withoutRoot, snapshot_root_hash: previewSessionSnapshotRoot(withoutRoot) }
}

function metadata(): Record<string, unknown> {
  return {
    event_payload_version: 1,
    batch_context: {},
    actor_role: 'SYSTEM',
    app_version: 'test',
    correlation_id: 'correlation-1',
    contract_version: 'PREVIEW_CONTRACT_V1',
    allowed_shell_kind: 'PREVIEW_SHELL'
  }
}

function statusPayload(snapshot: PreviewSessionSnapshot, before: 'ACTIVE' | 'COMPLETED', after: 'COMPLETED' | 'ABORTED' | 'TECHNICAL_INTERRUPTED'): Record<string, unknown> {
  return {
    ...metadata(),
    reason_code: 'TEST',
    session_id: snapshot.session_id,
    snapshot_root_hash: snapshot.snapshot_root_hash,
    status_before: before,
    status_after: after
  }
}

describe('preview session replay', () => {
  it('replays start and completion from frozen facts without consulting current state', () => {
    const snapshot = makeSnapshot()
    const state = replayPreviewSession([
      { event_id: 'event-2', event_type: 'PREVIEW_SESSION_COMPLETED', event_sequence: 2, payload: statusPayload(snapshot, 'ACTIVE', 'COMPLETED') },
      { event_id: 'event-1', event_type: 'PREVIEW_SESSION_STARTED', event_sequence: 1, payload: { ...metadata(), snapshot } }
    ])
    expect(state).toMatchObject({ status: 'COMPLETED', last_event_id: 'event-2', event_sequence: 2 })
  })

  it('rejects snapshot-root drift and events after a terminal state', () => {
    const snapshot = makeSnapshot()
    expect(() => replayPreviewSession([
      { event_id: 'event-1', event_type: 'PREVIEW_SESSION_STARTED', event_sequence: 1, payload: { ...metadata(), snapshot } },
      { event_id: 'event-2', event_type: 'PREVIEW_SESSION_COMPLETED', event_sequence: 2, payload: { ...statusPayload(snapshot, 'ACTIVE', 'COMPLETED'), snapshot_root_hash: 'c'.repeat(64) } }
    ])).toThrow(/PREVIEW_STATE_CONFLICT/)
    expect(() => replayPreviewSession([
      { event_id: 'event-1', event_type: 'PREVIEW_SESSION_STARTED', event_sequence: 1, payload: { ...metadata(), snapshot } },
      { event_id: 'event-2', event_type: 'PREVIEW_SESSION_COMPLETED', event_sequence: 2, payload: statusPayload(snapshot, 'ACTIVE', 'COMPLETED') },
      { event_id: 'event-3', event_type: 'PREVIEW_SESSION_ABORTED', event_sequence: 3, payload: statusPayload(snapshot, 'COMPLETED', 'ABORTED') }
    ])).toThrow(/PREVIEW_STATE_CONFLICT/)
  })
})
