import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DBAdapter } from '../../../db/interface'
import type { MemoryAdapter } from '../../../db/memory-adapter'
import { createTestDb, seedBusinessSessionFixture, seedCaller, seedLocalRuntimeContextFixture, seedStudent } from '../../../db/test-helpers'
import type { PreviewSessionSnapshot } from '@shared/types/preview-contract'
import {
  previewSessionContentRoot,
  previewSessionRendererRoot,
  previewSessionScoringRoot,
  previewSessionSnapshotRoot
} from '../../preview/preview-session-snapshot'
import { projectPreviewSession, assertPreviewSessionProjected } from '../preview-session-projector'
import type { PreparedProjectorContext } from '../../event-batch/result-registry'
import { canonicalJson, type CanonicalJsonValue } from '../../event-batch/canonical-json'

const hash = 'd'.repeat(64)
const capturedAt = '2026-08-01T01:00:00.000Z'

function makeSnapshot(studentId: string): PreviewSessionSnapshot {
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
    student_id: studentId,
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
      allowed_actions: ['PREVIEW_PACK_PUBLISH'] as never,
      validity: {
        issued_at: '2026-08-01T00:00:00.000Z',
        effective_at: '2026-08-01T00:00:00.000Z',
        expires_at: '2026-08-15T00:00:00.000Z',
        revoked_at: null
      },
      key_id: 'key-1'
    },
    strategy_ref: { strategy_id: 'strategy_job_skill_shelver_v1', strategy_version: 1, policy_hash: hash, scoring_policy_hash: hash },
    assignment_id: 'assignment-1',
    grant_id: 'grant-1',
    device_id: 'device-1',
    question_snapshots: [question],
    content_root_hash: previewSessionContentRoot([question]),
    scoring_root_hash: previewSessionScoringRoot([question]),
    renderer_root_hash: previewSessionRendererRoot([question]),
    captured_at: capturedAt
  }
  return { ...withoutRoot, snapshot_root_hash: previewSessionSnapshotRoot(withoutRoot) }
}

function metadata(): Record<string, CanonicalJsonValue> {
  return {
    event_payload_version: 1,
    batch_context: {},
    actor_role: 'ADMIN',
    app_version: 'test',
    correlation_id: 'correlation-1',
    contract_version: 'PREVIEW_CONTRACT_V1',
    allowed_shell_kind: 'PREVIEW_SHELL'
  }
}

function context(db: DBAdapter, actorId: string, eventId: string, eventType: string, sequence: number, payload: Record<string, CanonicalJsonValue>): PreparedProjectorContext {
  return {
    database: db,
    command: {
      commandId: 'command-1',
      eventBatchId: 'batch-1',
      commandType: eventType === 'PREVIEW_SESSION_STARTED' ? 'preview:startSession' : 'preview:completeSession',
      actorId,
      deviceId: null,
      authSessionId: null,
      requestHash: hash,
      clientInstanceId: 'client-1',
      idempotencyKey: 'idempotency-1',
      createdAt: capturedAt
    },
    batch: { prepared: { batch_id: null, batch_hash: null } } as never,
    event: {
      record: {
        type: 'EVENT',
        batch_id: 'batch-1',
        event_id: eventId,
        aggregate_type: 'PREVIEW_SESSION',
        aggregate_id: 'preview-session-1',
        event_type: eventType,
        event_sequence: sequence,
        payload,
        checksum: hash,
        actor_id: actorId,
        timestamp: capturedAt
      },
      relativePath: 'event-batches/seg_000000000001.jsonl',
      segmentId: 'seg_000000000001',
      lineNumber: sequence + 1,
      byteOffset: 0,
      byteEnd: 0
    }
  }
}

function startPayload(snapshot: PreviewSessionSnapshot): Record<string, CanonicalJsonValue> {
  return { ...metadata(), snapshot } as unknown as Record<string, CanonicalJsonValue>
}

function completePayload(snapshot: PreviewSessionSnapshot): Record<string, CanonicalJsonValue> {
  return {
    ...metadata(),
    reason_code: 'NORMAL_COMPLETION',
    session_id: snapshot.session_id,
    snapshot_root_hash: snapshot.snapshot_root_hash,
    status_before: 'ACTIVE',
    status_after: 'COMPLETED'
  }
}

function seedPreviewFacts(db: DBAdapter): { studentId: string; adminId: string } {
  const studentId = seedStudent(db)
  const adminId = seedCaller(db, 'ADMIN')
  const runtime = seedLocalRuntimeContextFixture(db, { teacherUserId: adminId, deviceId: 'device-1' })
  seedBusinessSessionFixture(db, {
    businessSessionId: 'assessment-shell-1',
    sessionType: 'ASSESSMENT',
    studentId,
    jobCode: 'SUPERMARKET_SHELVER',
    taskCode: 'UNBOX_AND_SHELF',
    createdBy: adminId
  })
  db.prepare(
    `INSERT INTO delegated_access_grant (
       grant_id, business_session_id, teacher_auth_session_id, teacher_user_id,
       student_id, device_id, device_runtime_session_id, capabilities_json,
       identity_confirmation_method, status, granted_at, expires_at
     ) VALUES ('grant-1', 'assessment-shell-1', ?, ?, ?, ?, ?, '["ASSESSMENT_START"]', 'TEACHER_ATTESTATION', 'ACTIVE', ?, ?)`
  ).run(runtime.teacherAuthSessionId, adminId, studentId, runtime.deviceId, runtime.deviceRuntimeSessionId, capturedAt, '2026-08-15T00:00:00.000Z')
  db.prepare(
    `INSERT INTO business_session_assignment (
       assignment_id, business_session_id, student_id, device_id, grant_id,
       assigned_by, status, student_confirmed_at
     ) VALUES ('assignment-1', 'assessment-shell-1', ?, ?, 'grant-1', ?, 'ACTIVE', ?)`
  ).run(studentId, runtime.deviceId, adminId, capturedAt)
  db.prepare(
    `INSERT INTO preview_event_projection (
       event_id, contract_registry_id, aggregate_type, aggregate_id, event_type,
       event_sequence, payload_json, checksum, created_at
     ) VALUES ('release-event-1', 'PREVIEW_CONTRACT_V1', 'PREVIEW_RELEASE', 'release-1', 'PREVIEW_PACK_RELEASED', 1, '{}', ?, ?)`
  ).run(hash, capturedAt)
  const snapshot = makeSnapshot(studentId)
  const references = {
    source_ref: snapshot.source_ref,
    pack_ref: snapshot.pack_ref,
    strategy_ref: snapshot.strategy_ref,
    question_refs: snapshot.question_snapshots.map((question) => question.question_ref),
    asset_refs: snapshot.question_snapshots.flatMap((question) => question.asset_refs),
    renderer_refs: snapshot.question_snapshots.map((question) => question.renderer_ref),
    evidence_refs: snapshot.question_snapshots.flatMap((question) => question.evidence_refs),
    manifest_ref: snapshot.manifest_ref,
    approval_ref: snapshot.approval_ref
  }
  db.prepare(
    `INSERT INTO preview_release_projection (
       release_id, source_ref_id, delivery_mode, question_id, question_version,
       semantic_hash, pack_id, pack_version, pack_hash, strategy_id, strategy_version,
       policy_hash, approval_id, approval_hash, manifest_id, manifest_hash,
       references_json, status, effective_at, expires_at, created_event_id, audit_ref
     ) VALUES ('release-1', 'source-1', 'PREVIEW_ONLY', 'q-1', 1, ?, 'pack-1', '1', ?,
       'strategy_job_skill_shelver_v1', 1, ?, 'approval-1', ?, 'manifest-1', ?, ?, 'ACTIVE', ?, ?, 'release-event-1', 'audit-1')`
  ).run(hash, hash, hash, hash, hash, canonicalJson(references as never), capturedAt, '2026-08-15T00:00:00.000Z')
  return { studentId, adminId }
}

describe('preview session projector', () => {
  let db: MemoryAdapter

  beforeEach(async () => {
    db = await createTestDb()
  })

  afterEach(() => db.close?.())

  it('writes only preview projections and a valid identity shell', () => {
    const { studentId, adminId } = seedPreviewFacts(db)
    const snapshot = makeSnapshot(studentId)
    const start = context(db, adminId, 'preview-event-1', 'PREVIEW_SESSION_STARTED', 1, startPayload(snapshot))
    projectPreviewSession(start)
    assertPreviewSessionProjected(start)

    expect(db.prepare('SELECT session_contract_kind, business_session_id, status, created_event_id, last_applied_event_id, last_status_event_id, event_sequence_version FROM assessment_session WHERE session_id = ?').get(snapshot.assessment_session_id)).toMatchObject({
      session_contract_kind: 'PREVIEW_SHELL',
      business_session_id: snapshot.assessment_session_id,
      status: 'ACTIVE',
      created_event_id: null,
      last_applied_event_id: null,
      last_status_event_id: null,
      event_sequence_version: 0
    })
    expect(db.prepare('SELECT status, result_suppressed FROM preview_session_projection WHERE preview_session_id = ?').get(snapshot.session_id)).toEqual({ status: 'ACTIVE', result_suppressed: 1 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM domain_event_projection').get()).toEqual({ count: 0 })
    expect(db.prepare('PRAGMA foreign_key_check').all()).toHaveLength(0)

    const complete = context(db, adminId, 'preview-event-2', 'PREVIEW_SESSION_COMPLETED', 2, completePayload(snapshot))
    projectPreviewSession(complete)
    assertPreviewSessionProjected(complete)
    expect(db.prepare('SELECT status FROM assessment_session WHERE session_id = ?').get(snapshot.assessment_session_id)).toEqual({ status: 'COMPLETED' })
    expect(db.prepare('SELECT status FROM preview_session_projection WHERE preview_session_id = ?').get(snapshot.session_id)).toEqual({ status: 'COMPLETED' })
  })

  it('rejects an inactive assignment before leaving a preview event or shell', () => {
    const { studentId, adminId } = seedPreviewFacts(db)
    const snapshot = makeSnapshot(studentId)
    db.prepare("UPDATE business_session_assignment SET status = 'PENDING_CONFIRM' WHERE assignment_id = 'assignment-1'").run()
    const start = context(db, adminId, 'preview-event-1', 'PREVIEW_SESSION_STARTED', 1, startPayload(snapshot))
    expect(() => db.transaction(() => projectPreviewSession(start))()).toThrow(/PREVIEW_SCOPE_INVALID/)
    expect(db.prepare('SELECT COUNT(*) AS count FROM preview_event_projection WHERE aggregate_type = ?').get('PREVIEW_SESSION')).toEqual({ count: 0 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM assessment_session WHERE session_contract_kind = ?').get('PREVIEW_SHELL')).toEqual({ count: 0 })
  })

  it('rejects a release canonical reference drift before creating the shell', () => {
    const { studentId, adminId } = seedPreviewFacts(db)
    const snapshot = makeSnapshot(studentId)
    const references = JSON.parse(
      (db.prepare('SELECT references_json FROM preview_release_projection WHERE release_id = ?').get('release-1') as { references_json: string }).references_json
    ) as { source_ref: { authority_hash: string } }
    references.source_ref.authority_hash = 'e'.repeat(64)
    db.prepare('UPDATE preview_release_projection SET references_json = ? WHERE release_id = ?').run(canonicalJson(references as never), 'release-1')
    const start = context(db, adminId, 'preview-event-1', 'PREVIEW_SESSION_STARTED', 1, startPayload(snapshot))

    expect(() => db.transaction(() => projectPreviewSession(start))()).toThrow(/PREVIEW_SOURCE_AUTHORITY_MISSING/)
    expect(db.prepare('SELECT COUNT(*) AS count FROM preview_event_projection WHERE aggregate_type = ?').get('PREVIEW_SESSION')).toEqual({ count: 0 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM assessment_session WHERE session_contract_kind = ?').get('PREVIEW_SHELL')).toEqual({ count: 0 })
  })
})
