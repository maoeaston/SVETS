import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import type {
  PreviewApproval,
  PreviewCanonicalReferenceSet
} from '@shared/types/preview-contract'
import { bindAuthSessionToSender, clearAuthSessionBinding, issuePasswordAuthSession } from '../../../utils/auth-session'
import { createTestDb, seedCaller } from '../../../db/test-helpers'
import type { MemoryAdapter } from '../../../db/memory-adapter'
import { applyPreviewContractMigration } from '../../../db/preview-contract-migration'
import { createEventBatchFaultInjectorForTests, type EventBatchFaultInjector, type EventBatchFaultPoint } from '../fault-injection'
import { DurableFileCapability } from '../file-capability'
import { EventBatchCoordinator } from '../batch-coordinator'
import { PreparedFactRegistry } from '../result-registry'
import { RuntimeCorruptionState } from '../runtime-corruption'
import { FairWriterMutex } from '../writer-mutex'
import { StartupRecovery } from '../startup-recovery'
import { canonicalReferenceSetDigest } from '../../../domain/preview/preview-canonical'
import { promotePreviewContractReady } from '../../../domain/preview/preview-promotion'
import {
  validatePreviewReleasePackage,
  type PreviewReleasePackage,
  type PreviewReleaseScope
} from '../../../domain/preview/preview-release-validator'
import { registerPreviewReleasePreparedFacts, validatePreviewReleasePayload } from '../../../domain/projectors/preview-release-projector'
import { CommandRegistry } from '../../../application/command/command-registry'
import { createPreviewReleaseCommandDefinitions } from '../../../application/command/preview-release-command-definitions'
import { DurableCommandCoordinator } from '../../../application/command/durable-command-coordinator'
import { DurableCommandStore } from '../../../application/command/durable-command-store'
import { M5bDomainExecutor } from '../../../application/runtime/m5b-domain-executor'
import type { PreviewReleaseTrustContext } from '../../../application/planners/preview-release-planner'

const TIME = '2026-08-01T06:00:00.000Z'
const EXPIRES_AT = '2026-08-15T00:00:00.000Z'
const HASH = 'f'.repeat(64)
const SENDER_ID = 4301

function references(suffix: string): PreviewCanonicalReferenceSet {
  return {
    source_ref: {
      source_ref_id: `source-release-${suffix}`,
      namespace: 'preview_publish_set',
      delivery_mode: 'PREVIEW_ONLY',
      authority_id: `authority-release-${suffix}`,
      authority_hash: HASH,
      scope: {
        organization_id: 'org-release-1',
        installation_id: 'installation-release-1',
        job_code: 'SUPERMARKET_SHELVER',
        task_code: 'UNBOX_AND_SHELF',
        permissions: ['PREVIEW_PACK_PUBLISH']
      },
      validity: {
        issued_at: '2026-08-01T00:00:00.000Z',
        effective_at: '2026-08-01T00:00:00.000Z',
        expires_at: EXPIRES_AT,
        revoked_at: null
      }
    },
    pack_ref: { pack_id: `pack-release-${suffix}`, pack_version: '1', pack_hash: HASH },
    strategy_ref: {
      strategy_id: 'strategy_job_skill_shelver_v1',
      strategy_version: 1,
      policy_hash: HASH,
      scoring_policy_hash: HASH
    },
    question_refs: [{ question_id: `question-release-${suffix}`, question_version: 1, semantic_hash: HASH }],
    asset_refs: [],
    renderer_refs: [{ renderer_id: `renderer-release-${suffix}`, renderer_version: '1', renderer_hash: HASH }],
    evidence_refs: [],
    manifest_ref: {
      manifest_id: `manifest-release-${suffix}`,
      manifest_version: '1',
      manifest_hash: HASH,
      signer_principal_id: `signer-release-${suffix}`,
      key_id: `release-key-${suffix}`
    },
    approval_ref: {
      approval_id: `approval-release-${suffix}`,
      approval_version: '1',
      approval_hash: HASH,
      signer_principal_id: `approver-release-${suffix}`,
      scope: 'JOB_SKILL_PREVIEW_ONLY',
      allowed_actions: ['PREVIEW_PACK_PUBLISH'],
      validity: {
        issued_at: '2026-08-01T00:00:00.000Z',
        effective_at: '2026-08-01T00:00:00.000Z',
        expires_at: EXPIRES_AT,
        revoked_at: null
      },
      key_id: `approval-key-${suffix}`
    }
  }
}

function releasePackage(suffix: string): PreviewReleasePackage {
  const refs = references(suffix)
  const approval: PreviewApproval = {
    approval_ref: refs.approval_ref,
    contract_version: 'PREVIEW_CONTRACT_V1',
    manifest_ref: refs.manifest_ref,
    pack_ref: refs.pack_ref,
    strategy_ref: refs.strategy_ref,
    question_refs: refs.question_refs,
    asset_refs: refs.asset_refs,
    renderer_refs: refs.renderer_refs,
    evidence_refs: refs.evidence_refs,
    approver_principal_id: `approver-release-${suffix}`,
    authority_registry_id: `authority-registry-release-${suffix}`,
    canonical_payload_hash: canonicalReferenceSetDigest(refs),
    signature: `approval-signature-${suffix}`
  }
  return {
    fact: {
      release_id: `release-${suffix}`,
      source_ref_id: refs.source_ref.source_ref_id,
      delivery_mode: 'PREVIEW_ONLY',
      question_id: refs.question_refs[0].question_id,
      question_version: 1,
      semantic_hash: HASH,
      pack_id: refs.pack_ref.pack_id,
      pack_version: '1',
      pack_hash: HASH,
      strategy_id: refs.strategy_ref.strategy_id,
      strategy_version: 1,
      policy_hash: HASH,
      approval_id: refs.approval_ref.approval_id,
      approval_hash: HASH,
      manifest_id: refs.manifest_ref.manifest_id,
      manifest_hash: HASH,
      references: refs,
      status_after: 'ACTIVE',
      effective_at: refs.source_ref.validity.effective_at,
      expires_at: refs.source_ref.validity.expires_at,
      audit_ref: `audit-release-${suffix}`
    },
    approval,
    responsibilities: {
      signer_principal_id: `signer-release-${suffix}`,
      approver_principal_id: `approver-release-${suffix}`,
      executor_principal_id: `executor-release-${suffix}`,
      content_principal_ids: [`content-release-${suffix}`],
      safety_principal_ids: [`safety-release-${suffix}`],
      code_principal_ids: [`code-release-${suffix}`],
      gate_principal_ids: [`gate-release-${suffix}`],
      future_release_executor_principal_ids: [`future-executor-release-${suffix}`]
    },
    executor_mapping_id: `mapping-release-${suffix}`,
    executor_mapping_hash: HASH,
    signer_key_id: refs.manifest_ref.key_id,
    signature: `release-signature-${suffix}`
  }
}

function releaseScope(): PreviewReleaseScope {
  return {
    installation_id: 'installation-release-1',
    organization_id: 'org-release-1',
    job_code: 'SUPERMARKET_SHELVER',
    task_code: 'UNBOX_AND_SHELF',
    permissions: ['PREVIEW_PACK_PUBLISH']
  }
}

function trustContext(): PreviewReleaseTrustContext {
  return {
    resolveScope: () => releaseScope(),
    verifyReleasePackage: (value, scope) => validatePreviewReleasePackage(value, scope),
    verifyRevokePackage: () => {
      throw new Error('revoke package is not part of this release fixture')
    }
  }
}

type ReleaseFixture = {
  db: MemoryAdapter
  root: string
  store: DurableCommandStore
  capability: DurableFileCapability
  preparedRegistry: PreparedFactRegistry
  commandRegistry: CommandRegistry
  corruption: RuntimeCorruptionState
  trust: PreviewReleaseTrustContext
  now: () => Date
  advance: (milliseconds: number) => void
  adminId: string
}

async function fixture(): Promise<ReleaseFixture> {
  const db = await createTestDb()
  applyPreviewContractMigration(db, { fresh: true })
  promotePreviewContractReady(db, TIME)
  const adminId = seedCaller(db, 'ADMIN')
  const session = issuePasswordAuthSession(db, {
    userId: adminId,
    role: 'ADMIN',
    displayName: 'Release Admin'
  })
  bindAuthSessionToSender(SENDER_ID, session.rawToken)

  const preparedRegistry = new PreparedFactRegistry()
  registerPreviewReleasePreparedFacts(preparedRegistry)
  preparedRegistry.seal()
  const commandRegistry = new CommandRegistry()
  for (const definition of createPreviewReleaseCommandDefinitions({
    db,
    eventForTransport: () => ({ sender: { id: SENDER_ID } }) as never
  })) commandRegistry.registerMutation(definition)
  commandRegistry.seal()
  const root = mkdtempSync(join(tmpdir(), 'svets-preview-release-batch-'))
  const store = new DurableCommandStore(db)
  const capability = new DurableFileCapability(root)
  const corruption = new RuntimeCorruptionState()
  let nowMillis = Date.parse(TIME)
  return {
    db,
    root,
    store,
    capability,
    preparedRegistry,
    commandRegistry,
    corruption,
    trust: trustContext(),
    now: () => new Date(nowMillis),
    advance: (milliseconds) => { nowMillis += milliseconds },
    adminId
  }
}

function createExecutor(fixtureValue: ReleaseFixture, faultInjector?: EventBatchFaultInjector): M5bDomainExecutor {
  const coordinator = new EventBatchCoordinator({
    database: fixtureValue.db,
    commandStore: fixtureValue.store,
    registry: fixtureValue.preparedRegistry,
    fileCapability: fixtureValue.capability,
    writerMutex: new FairWriterMutex(),
    corruptionState: fixtureValue.corruption,
    workerId: 'preview-release-batch-worker',
    legacyAnchor: null,
    now: fixtureValue.now,
    faultInjector
  })
  return new M5bDomainExecutor({
    database: fixtureValue.db,
    durableCoordinator: new DurableCommandCoordinator({
      registry: fixtureValue.commandRegistry,
      store: fixtureValue.store,
      workerId: 'preview-release-batch-worker',
      now: fixtureValue.now
    }),
    batchCoordinator: coordinator,
    previewReleaseTrustContext: fixtureValue.trust
  })
}

type ReleaseAcceptance = Awaited<ReturnType<M5bDomainExecutor['accept']>>

async function acceptRelease(
  fixtureValue: ReleaseFixture,
  packageValue: PreviewReleasePackage,
  metadata: Readonly<{
    clientInstanceId: string
    idempotencyKey: string
  }> = { clientInstanceId: uuidv4(), idempotencyKey: uuidv4() }
): Promise<{
  executor: M5bDomainExecutor
  accepted: ReleaseAcceptance
  metadata: typeof metadata
}> {
  const executor = createExecutor(fixtureValue)
  const accepted = await executor.accept({
    commandType: 'preview:releasePack',
    rawInput: { releasePackage: packageValue },
    transport: { source: 'IPC', transportId: `release-transport-${uuidv4()}` },
    transportMetadata: {
      schemaVersion: 1,
      clientInstanceId: metadata.clientInstanceId,
      idempotencyKey: metadata.idempotencyKey,
      deviceId: null
    }
  })
  return { executor, accepted, metadata }
}

function recovery(fixtureValue: ReleaseFixture): StartupRecovery {
  return new StartupRecovery({
    database: fixtureValue.db,
    commandStore: fixtureValue.store,
    registry: fixtureValue.preparedRegistry,
    fileCapability: fixtureValue.capability,
    corruptionState: fixtureValue.corruption,
    workerId: 'preview-release-recovery-worker',
    legacyAnchor: null,
    writerMutex: new FairWriterMutex(),
    now: fixtureValue.now
  })
}

const fixtures: ReleaseFixture[] = []

afterEach(() => {
  for (const current of fixtures.splice(0)) {
    clearAuthSessionBinding(SENDER_ID)
    current.db.close()
    rmSync(current.root, { recursive: true, force: true })
  }
})

describe('preview release M5B batch contract', () => {
  it('applies one frozen release only to preview projections and replays idempotently', async () => {
    const current = await fixture()
    fixtures.push(current)
    const packageValue = releasePackage('one')
    const first = await acceptRelease(current, packageValue)
    if (first.accepted.status !== 'ACCEPTED') throw new Error('initial release command unexpectedly replayed')
    const completed = await first.executor.execute({ accepted: first.accepted, senderId: 0 })

    expect(completed.publicResult).toMatchObject({
      success: true,
      commandType: 'preview:releasePack',
      releaseId: 'release-one'
    })
    expect(current.db.prepare('SELECT status, source_ref_id FROM preview_release_projection WHERE release_id = ?').get('release-one')).toEqual({
      status: 'ACTIVE',
      source_ref_id: 'source-release-one'
    })
    expect(current.db.prepare('SELECT event_type, aggregate_type FROM preview_event_projection WHERE aggregate_id = ?').get('release-one')).toEqual({
      event_type: 'PREVIEW_PACK_RELEASED',
      aggregate_type: 'PREVIEW_RELEASE'
    })
    const eventRow = current.db.prepare('SELECT payload_json FROM preview_event_projection WHERE aggregate_id = ?').get('release-one') as { payload_json: string }
    const payload = JSON.parse(eventRow.payload_json) as Record<string, unknown>
    expect(() => validatePreviewReleasePayload({ ...payload, question_version: '1' } as never)).toThrowError(expect.objectContaining({ code: 'PREVIEW_CANONICAL_INVALID' }))
    expect(() => validatePreviewReleasePayload({ ...payload, pack_id: 42 } as never)).toThrowError(expect.objectContaining({ code: 'PREVIEW_CANONICAL_INVALID' }))
    expect(() => validatePreviewReleasePackage({
      ...packageValue,
      responsibilities: { ...packageValue.responsibilities, content_principal_ids: undefined }
    } as never, releaseScope())).toThrowError(expect.objectContaining({ code: 'PREVIEW_PACK_RELEASE_SEPARATION_OF_DUTIES_FAILED' }))
    expect(current.db.prepare('SELECT COUNT(*) AS count FROM domain_event_projection').get()).toEqual({ count: 0 })
    expect(current.db.prepare('SELECT COUNT(*) AS count FROM result_record').get()).toEqual({ count: 0 })

    const replayed = await acceptRelease(current, packageValue, first.metadata)
    expect(replayed.accepted).toMatchObject({ status: 'REPLAYED' })
    await expect(acceptRelease(current, releasePackage('two'), first.metadata)).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT'
    })
    expect(current.db.prepare('SELECT COUNT(*) AS count FROM preview_release_projection').get()).toEqual({ count: 1 })
  })

  it.each([
    'AFTER_PREPARE_FSYNC',
    'BEFORE_APPLY',
    'AFTER_APPLY_COMMIT',
    'BEFORE_CONFIRM'
  ] as const)('recovers %s from frozen release facts with plannerCalls=0', async (faultPoint: EventBatchFaultPoint) => {
    const current = await fixture()
    fixtures.push(current)
    const accepted = await acceptRelease(current, releasePackage(faultPoint.toLowerCase()))
    if (accepted.accepted.status !== 'ACCEPTED') throw new Error('initial release command unexpectedly replayed')
    const faultExecutor = createExecutor(current, createEventBatchFaultInjectorForTests({ failAt: faultPoint }))

    await expect(faultExecutor.execute({ accepted: accepted.accepted, senderId: 0 })).rejects.toThrow(faultPoint)
    expect(current.db.prepare('SELECT status FROM command_log WHERE command_id = ?').get(accepted.accepted.envelope.commandId)).toEqual({ status: 'PROCESSING' })

    current.advance(31_000)
    const recovered = await recovery(current).run()
    expect(recovered.plannerCalls).toBe(0)
    expect(recovered.recoveredResults).toBe(1)
    expect(recovered.appliedBatches).toBe(['AFTER_PREPARE_FSYNC', 'BEFORE_APPLY'].includes(faultPoint) ? 1 : 0)
    expect(current.db.prepare('SELECT status FROM preview_release_projection WHERE release_id = ?').get(`release-${faultPoint.toLowerCase()}`)).toEqual({ status: 'ACTIVE' })
    expect(current.db.prepare('SELECT status FROM command_log WHERE command_id = ?').get(accepted.accepted.envelope.commandId)).toEqual({ status: 'SUCCEEDED' })
    expect(current.db.prepare('SELECT COUNT(*) AS count FROM domain_event_projection').get()).toEqual({ count: 0 })
  })

  it('fails before PREPARE without leaving a release projection or a legacy event', async () => {
    const current = await fixture()
    fixtures.push(current)
    const accepted = await acceptRelease(current, releasePackage('before-prepare'))
    if (accepted.accepted.status !== 'ACCEPTED') throw new Error('initial release command unexpectedly replayed')
    const faultExecutor = createExecutor(current, createEventBatchFaultInjectorForTests({ failAt: 'BEFORE_PREPARE' }))

    await expect(faultExecutor.execute({ accepted: accepted.accepted, senderId: 0 })).rejects.toThrow('BEFORE_PREPARE')
    expect(current.db.prepare('SELECT status FROM command_log WHERE command_id = ?').get(accepted.accepted.envelope.commandId)).toEqual({ status: 'PROCESSING' })
    expect(current.db.prepare('SELECT COUNT(*) AS count FROM preview_release_projection').get()).toEqual({ count: 0 })
    expect(current.db.prepare('SELECT COUNT(*) AS count FROM domain_event_projection').get()).toEqual({ count: 0 })
  })
})
