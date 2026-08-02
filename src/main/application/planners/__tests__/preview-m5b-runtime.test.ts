import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import type {
  PreviewCanonicalReferenceSet,
  PreviewPublishBinding,
  PreviewSessionSnapshot,
  PreviewSessionQuestionSnapshot
} from '@shared/types/preview-contract'
import { canonicalJson } from '../../../domain/event-batch/canonical-json'
import { createEventBatchFaultInjectorForTests } from '../../../domain/event-batch/fault-injection'
import { DurableFileCapability } from '../../../domain/event-batch/file-capability'
import { EventBatchCoordinator } from '../../../domain/event-batch/batch-coordinator'
import { PreparedFactRegistry } from '../../../domain/event-batch/result-registry'
import { RuntimeCorruptionState } from '../../../domain/event-batch/runtime-corruption'
import { FairWriterMutex } from '../../../domain/event-batch/writer-mutex'
import { StartupRecovery } from '../../../domain/event-batch/startup-recovery'
import { CommandRegistry } from '../../command/command-registry'
import { DurableCommandCoordinator } from '../../command/durable-command-coordinator'
import { DurableCommandStore } from '../../command/durable-command-store'
import { createPreviewSafetyCommandDefinitions } from '../../command/preview-safety-command-definitions'
import { createPreviewSessionCommandDefinitions } from '../../command/preview-session-command-definitions'
import { M5bDomainExecutor } from '../../runtime/m5b-domain-executor'
import { createTestDb, seedBusinessSessionFixture, seedCaller, seedLocalRuntimeContextFixture, seedStudent } from '../../../db/test-helpers'
import type { MemoryAdapter } from '../../../db/memory-adapter'
import type { DBAdapter } from '../../../db/interface'
import { applyPreviewContractMigration } from '../../../db/preview-contract-migration'
import { promotePreviewContractReady } from '../../../domain/preview/preview-promotion'
import {
  buildPreviewSessionSnapshot,
  previewSessionContentRoot,
  previewSessionRendererRoot,
  previewSessionScoringRoot
} from '../../../domain/preview/preview-session-snapshot'
import { registerPreviewSafetyPreparedFacts } from '../../../domain/projectors/preview-safety-projector'
import { registerPreviewSessionPreparedFacts } from '../../../domain/projectors/preview-session-projector'
import type { EventBatchFaultInjector } from '../../../domain/event-batch/fault-injection'

const HASH = 'e'.repeat(64)
const CAPTURED_AT = '2026-08-01T01:00:00.000Z'
const EXPIRES_AT = '2026-08-15T00:00:00.000Z'

type PreviewRuntimeFixture = {
  db: MemoryAdapter
  root: string
  snapshot: PreviewSessionSnapshot
  preparedRegistry: PreparedFactRegistry
  commandRegistry: CommandRegistry
  store: DurableCommandStore
  capability: DurableFileCapability
  corruption: RuntimeCorruptionState
  now: () => Date
  advance: (milliseconds: number) => void
}

function refs(): PreviewCanonicalReferenceSet {
  return {
    source_ref: {
      source_ref_id: 'source-m5b-1',
      namespace: 'preview_publish_set',
      delivery_mode: 'PREVIEW_ONLY',
      authority_id: 'authority-m5b-1',
      authority_hash: HASH,
      scope: {
        organization_id: 'org-m5b-1',
        installation_id: 'installation-m5b-1',
        job_code: 'SUPERMARKET_SHELVER',
        task_code: 'UNBOX_AND_SHELF',
        permissions: ['PREVIEW_SESSION_START']
      },
      validity: {
        issued_at: '2026-08-01T00:00:00.000Z',
        effective_at: '2026-08-01T00:00:00.000Z',
        expires_at: EXPIRES_AT,
        revoked_at: null
      }
    },
    pack_ref: { pack_id: 'pack-m5b-1', pack_version: '1', pack_hash: HASH },
    strategy_ref: { strategy_id: 'strategy_job_skill_shelver_v1', strategy_version: 1, policy_hash: HASH, scoring_policy_hash: HASH },
    question_refs: [{ question_id: 'q-m5b-1', question_version: 1, semantic_hash: HASH }],
    asset_refs: [],
    renderer_refs: [{ renderer_id: 'renderer-m5b-1', renderer_version: '1', renderer_hash: HASH }],
    evidence_refs: [],
    manifest_ref: { manifest_id: 'manifest-m5b-1', manifest_version: '1', manifest_hash: HASH, signer_principal_id: 'signer-m5b-1', key_id: 'key-m5b-1' },
    approval_ref: {
      approval_id: 'approval-m5b-1',
      approval_version: '1',
      approval_hash: HASH,
      signer_principal_id: 'approver-m5b-1',
      scope: 'JOB_SKILL_PREVIEW_ONLY',
      allowed_actions: ['PREVIEW_PACK_PUBLISH'],
      validity: {
        issued_at: '2026-08-01T00:00:00.000Z',
        effective_at: '2026-08-01T00:00:00.000Z',
        expires_at: EXPIRES_AT,
        revoked_at: null
      },
      key_id: 'key-m5b-1'
    }
  }
}

function question(referenceSet: PreviewCanonicalReferenceSet): PreviewSessionQuestionSnapshot {
  return {
    question_ref: referenceSet.question_refs[0],
    question_order: 1,
    question_phase: 'ONLINE',
    content_json: { prompt: 'place the carton' },
    content_hash: HASH,
    scoring_rule_json: { score: 1 },
    scoring_hash: HASH,
    asset_refs: [],
    renderer_ref: referenceSet.renderer_refs[0],
    evidence_refs: [],
    safety_ref: 'safety-m5b-1'
  }
}

function binding(referenceSet: PreviewCanonicalReferenceSet, adminId: string): PreviewPublishBinding & { canonical_references: PreviewCanonicalReferenceSet } {
  return {
    source_ref: referenceSet.source_ref,
    delivery_mode: 'PREVIEW_ONLY',
    question_ref: referenceSet.question_refs[0],
    pack_ref: referenceSet.pack_ref,
    strategy_ref: referenceSet.strategy_ref,
    manifest_ref: referenceSet.manifest_ref,
    approval_ref: referenceSet.approval_ref,
    asset_refs: referenceSet.asset_refs,
    renderer_refs: referenceSet.renderer_refs,
    evidence_refs: referenceSet.evidence_refs,
    status: 'ACTIVE',
    validity: referenceSet.source_ref.validity,
    audit_ref: {
      audit_id: 'audit-m5b-1',
      event_id: 'release-event-m5b-1',
      aggregate_id: 'release-m5b-1',
      aggregate_sequence: 1,
      request_hash: HASH,
      actor_user_id: adminId,
      executor_principal_id: 'executor-m5b-1',
      recorded_at: CAPTURED_AT
    },
    canonical_references: referenceSet
  }
}

function seedRelease(db: DBAdapter, snapshot: PreviewSessionSnapshot, adminId: string): void {
  const referenceSet: PreviewCanonicalReferenceSet = {
    source_ref: snapshot.source_ref,
    pack_ref: snapshot.pack_ref,
    strategy_ref: snapshot.strategy_ref,
    question_refs: snapshot.question_snapshots.map((entry) => entry.question_ref),
    asset_refs: snapshot.question_snapshots.flatMap((entry) => entry.asset_refs),
    renderer_refs: snapshot.question_snapshots.map((entry) => entry.renderer_ref),
    evidence_refs: snapshot.question_snapshots.flatMap((entry) => entry.evidence_refs),
    manifest_ref: snapshot.manifest_ref,
    approval_ref: snapshot.approval_ref
  }
  db.prepare(
    `INSERT INTO preview_event_projection (
       event_id, contract_registry_id, aggregate_type, aggregate_id, event_type,
       event_sequence, payload_json, checksum, created_at
     ) VALUES ('release-event-m5b-1', 'PREVIEW_CONTRACT_V1', 'PREVIEW_RELEASE', 'release-m5b-1', 'PREVIEW_PACK_RELEASED', 1, '{}', ?, ?)`
  ).run(HASH, CAPTURED_AT)
  db.prepare(
    `INSERT INTO preview_release_projection (
       release_id, source_ref_id, delivery_mode, question_id, question_version,
       semantic_hash, pack_id, pack_version, pack_hash, strategy_id, strategy_version,
       policy_hash, approval_id, approval_hash, manifest_id, manifest_hash,
       references_json, status, effective_at, expires_at, created_event_id, audit_ref
     ) VALUES ('release-m5b-1', ?, 'PREVIEW_ONLY', ?, 1, ?, ?, '1', ?, ?, 1,
       ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, 'release-event-m5b-1', ?)`
  ).run(
    snapshot.source_ref.source_ref_id,
    snapshot.question_snapshots[0].question_ref.question_id,
    HASH,
    snapshot.pack_ref.pack_id,
    HASH,
    snapshot.strategy_ref.strategy_id,
    HASH,
    snapshot.approval_ref.approval_id,
    HASH,
    snapshot.manifest_ref.manifest_id,
    HASH,
    canonicalJson(referenceSet as never),
    snapshot.source_ref.validity.effective_at,
    snapshot.source_ref.validity.expires_at,
    `audit:${adminId}`
  )
}

function createExecutor(fixture: PreviewRuntimeFixture, faultInjector?: EventBatchFaultInjector): M5bDomainExecutor {
  const coordinator = new EventBatchCoordinator({
    database: fixture.db,
    commandStore: fixture.store,
    registry: fixture.preparedRegistry,
    fileCapability: fixture.capability,
    writerMutex: new FairWriterMutex(),
    corruptionState: fixture.corruption,
    workerId: 'preview-m5b-worker',
    legacyAnchor: null,
    now: fixture.now,
    faultInjector
  })
  return new M5bDomainExecutor({
    database: fixture.db,
    durableCoordinator: new DurableCommandCoordinator({
      registry: fixture.commandRegistry,
      store: fixture.store,
      workerId: 'preview-m5b-worker',
      now: fixture.now
    }),
    batchCoordinator: coordinator
  })
}

async function acceptInternal(
  executor: M5bDomainExecutor,
  commandType: string,
  input: Record<string, unknown>
): Promise<Extract<Awaited<ReturnType<M5bDomainExecutor['acceptInternal']>>, { status: 'ACCEPTED' }>> {
  const accepted = await executor.acceptInternal({
    commandType,
    rawInput: input,
    transportId: `preview-runtime:${commandType}:${uuidv4()}`,
    transportMetadata: {
      schemaVersion: 1,
      clientInstanceId: uuidv4(),
      idempotencyKey: uuidv4(),
      deviceId: null
    }
  })
  if (accepted.status !== 'ACCEPTED') throw new Error('preview runtime command unexpectedly replayed')
  return accepted as Extract<typeof accepted, { status: 'ACCEPTED' }>
}

async function fixture(): Promise<PreviewRuntimeFixture> {
  const db = await createTestDb()
  applyPreviewContractMigration(db, { fresh: true })
  promotePreviewContractReady(db, CAPTURED_AT)
  const studentId = seedStudent(db)
  const adminId = seedCaller(db, 'ADMIN')
  const runtime = seedLocalRuntimeContextFixture(db, { teacherUserId: adminId, deviceId: 'device-m5b-1' })
  seedBusinessSessionFixture(db, {
    businessSessionId: 'assessment-shell-m5b-1',
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
     ) VALUES ('grant-m5b-1', 'assessment-shell-m5b-1', ?, ?, ?, ?, ?, '[]', 'TEACHER_ATTESTATION', 'ACTIVE', ?, ?)`
  ).run(runtime.teacherAuthSessionId, adminId, studentId, runtime.deviceId, runtime.deviceRuntimeSessionId, CAPTURED_AT, EXPIRES_AT)
  db.prepare(
    `INSERT INTO business_session_assignment (
       assignment_id, business_session_id, student_id, device_id, grant_id,
       assigned_by, status, student_confirmed_at
     ) VALUES ('assignment-m5b-1', 'assessment-shell-m5b-1', ?, ?, 'grant-m5b-1', ?, 'ACTIVE', ?)`
  ).run(studentId, runtime.deviceId, adminId, CAPTURED_AT)

  const referenceSet = refs()
  const snapshot = buildPreviewSessionSnapshot({
    session_id: 'preview-session-m5b-1',
    assessment_session_id: 'assessment-shell-m5b-1',
    student_id: studentId,
    job_code: 'SUPERMARKET_SHELVER',
    task_code: 'UNBOX_AND_SHELF',
    assignment_id: 'assignment-m5b-1',
    grant_id: 'grant-m5b-1',
    device_id: 'device-m5b-1',
    binding: binding(referenceSet, adminId),
    question_snapshots: [question(referenceSet)],
    captured_at: CAPTURED_AT
  })
  seedRelease(db, snapshot, adminId)

  const preparedRegistry = new PreparedFactRegistry()
  registerPreviewSessionPreparedFacts(preparedRegistry)
  registerPreviewSafetyPreparedFacts(preparedRegistry)
  preparedRegistry.seal()
  const commandRegistry = new CommandRegistry()
  for (const definition of createPreviewSessionCommandDefinitions()) commandRegistry.registerMutation(definition)
  for (const definition of createPreviewSafetyCommandDefinitions()) commandRegistry.registerMutation(definition)
  commandRegistry.seal()
  const root = mkdtempSync(join(tmpdir(), 'svets-preview-m5b-runtime-'))
  const capability = new DurableFileCapability(root)
  const store = new DurableCommandStore(db)
  const corruption = new RuntimeCorruptionState()
  let nowMillis = Date.parse(CAPTURED_AT)
  return {
    db,
    root,
    snapshot,
    preparedRegistry,
    commandRegistry,
    store,
    capability,
    corruption,
    now: () => new Date(nowMillis),
    advance: (milliseconds) => { nowMillis += milliseconds }
  }
}

const fixtures: PreviewRuntimeFixture[] = []

afterEach(() => {
  for (const current of fixtures.splice(0)) {
    current.db.close()
    rmSync(current.root, { recursive: true, force: true })
  }
})

describe('preview session and safety M5B runtime', () => {
  it('executes internal start and safety commands into preview projections only', async () => {
    const current = await fixture()
    fixtures.push(current)
    const executor = createExecutor(current)
    const start = await acceptInternal(executor, 'preview:startSession', { snapshot: current.snapshot })
    await executor.execute({ accepted: start, senderId: 0 })
    const safety = await acceptInternal(executor, 'preview:triggerSafety', {
      safety: { session_id: current.snapshot.session_id, reason_code: 'UNSAFE_PLACEMENT' }
    })
    await executor.execute({ accepted: safety, senderId: 0 })

    expect(current.db.prepare('SELECT status FROM preview_session_projection WHERE preview_session_id = ?').get(current.snapshot.session_id)).toEqual({ status: 'REDLINE_HALTED' })
    expect(current.db.prepare('SELECT status FROM preview_safety_incident_projection WHERE preview_session_id = ?').get(current.snapshot.session_id)).toEqual({ status: 'OPEN' })
    expect(current.db.prepare('SELECT status, session_contract_kind, preview_redline_ref FROM assessment_session WHERE session_id = ?').get(current.snapshot.assessment_session_id)).toMatchObject({ status: 'REDLINE_HALTED', session_contract_kind: 'PREVIEW_SHELL' })
    expect(current.db.prepare('SELECT COUNT(*) AS count FROM domain_event_projection').get()).toEqual({ count: 0 })
    expect(current.db.prepare('SELECT COUNT(*) AS count FROM result_record').get()).toEqual({ count: 0 })
    expect(current.db.prepare('SELECT COUNT(*) AS count FROM task_report').get()).toEqual({ count: 0 })
  })

  it('recovers a prepared preview completion with plannerCalls=0', async () => {
    const current = await fixture()
    fixtures.push(current)
    const startExecutor = createExecutor(current)
    const start = await acceptInternal(startExecutor, 'preview:startSession', { snapshot: current.snapshot })
    await startExecutor.execute({ accepted: start, senderId: 0 })

    const fault = createEventBatchFaultInjectorForTests({ failAt: 'AFTER_PREPARE_FSYNC' })
    const faultExecutor = createExecutor(current, fault)
    const complete = await acceptInternal(faultExecutor, 'preview:completeSession', {
      status: { session_id: current.snapshot.session_id, reason_code: 'NORMAL_COMPLETION' }
    })
    await expect(faultExecutor.execute({ accepted: complete, senderId: 0 })).rejects.toThrow(/AFTER_PREPARE_FSYNC/)
    expect(current.db.prepare('SELECT status FROM command_log WHERE command_id = ?').get(complete.envelope.commandId)).toEqual({ status: 'PROCESSING' })
    expect(current.db.prepare('SELECT status FROM preview_session_projection WHERE preview_session_id = ?').get(current.snapshot.session_id)).toEqual({ status: 'ACTIVE' })

    current.advance(31_000)
    const recovery = new StartupRecovery({
      database: current.db,
      commandStore: current.store,
      registry: current.preparedRegistry,
      fileCapability: current.capability,
      corruptionState: current.corruption,
      workerId: 'preview-m5b-recovery-worker',
      legacyAnchor: null,
      writerMutex: new FairWriterMutex(),
      now: current.now
    })
    const recovered = await recovery.run()
    expect(recovered).toMatchObject({ plannerCalls: 0, appliedBatches: 1, recoveredResults: 1 })
    expect(current.db.prepare('SELECT status FROM preview_session_projection WHERE preview_session_id = ?').get(current.snapshot.session_id)).toEqual({ status: 'COMPLETED' })
    expect(current.db.prepare('SELECT status, session_contract_kind FROM assessment_session WHERE session_id = ?').get(current.snapshot.assessment_session_id)).toEqual({ status: 'COMPLETED', session_contract_kind: 'PREVIEW_SHELL' })
    expect(current.db.prepare('SELECT COUNT(*) AS count FROM domain_event_projection').get()).toEqual({ count: 0 })
    expect(current.db.prepare('SELECT COUNT(*) AS count FROM result_record').get()).toEqual({ count: 0 })
  })

  it('keeps all three preview roots bound to the persisted snapshot fixture', async () => {
    const current = await fixture()
    fixtures.push(current)
    const row = current.db.prepare('SELECT snapshot_json, content_root_hash, scoring_root_hash, renderer_root_hash FROM preview_session_projection WHERE preview_session_id = ?').get(current.snapshot.session_id)
    expect(row).toBeUndefined()
    expect(current.snapshot.content_root_hash).toBe(previewSessionContentRoot(current.snapshot.question_snapshots))
    expect(current.snapshot.scoring_root_hash).toBe(previewSessionScoringRoot(current.snapshot.question_snapshots))
    expect(current.snapshot.renderer_root_hash).toBe(previewSessionRendererRoot(current.snapshot.question_snapshots))
  })

  it('rejects mutation of frozen preview session identity and snapshot fields', async () => {
    const current = await fixture()
    fixtures.push(current)
    const executor = createExecutor(current)
    const start = await acceptInternal(executor, 'preview:startSession', { snapshot: current.snapshot })
    await executor.execute({ accepted: start, senderId: 0 })

    const attempts: Array<[string, unknown]> = [
      ['preview_session_id', 'preview-session-drift'],
      ['contract_registry_id', 'registry-drift'],
      ['contract_version', 'INVALID_CONTRACT'],
      ['delivery_mode', 'FORMAL_ONLY'],
      ['pack_id', 'pack-drift'],
      ['pack_version', '2'],
      ['pack_hash', 'd'.repeat(64)],
      ['source_ref_id', 'source-drift'],
      ['strategy_id', 'strategy-drift'],
      ['strategy_version', 2],
      ['snapshot_json', canonicalJson({ drifted: true })],
      ['content_root_hash', 'd'.repeat(64)],
      ['scoring_root_hash', 'd'.repeat(64)],
      ['renderer_root_hash', 'd'.repeat(64)],
      ['snapshot_root_hash', 'd'.repeat(64)],
      ['assignment_id', 'assignment-drift'],
      ['grant_id', 'grant-drift'],
      ['created_at', '2026-08-01T02:00:00.000Z']
    ]

    for (const [column, value] of attempts) {
      expect(() => current.db.prepare(`UPDATE preview_session_projection SET ${column} = ? WHERE preview_session_id = ?`).run(value, current.snapshot.session_id)).toThrow(/preview session frozen snapshot is immutable/)
    }
  })
})
