import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CommandEnvelopeV2 } from '../../command/command-types'
import { applyPreviewContractMigration } from '../../../db/preview-contract-migration'
import { createTestDb } from '../../../db/test-helpers'
import { promotePreviewContractReady } from '../../../domain/preview/preview-promotion'
import { PrincipalBindingService, type PrincipalBindingFact } from '../../../domain/authority/principal-binding-service'
import {
  loadPreviewPrincipalPlannerSnapshot,
  type PreviewPrincipalTrustContext
} from '../preview-principal-planner'

const databases: Array<Awaited<ReturnType<typeof createTestDb>>> = []

function envelope(): CommandEnvelopeV2 {
  return {
    envelopeVersion: 'v2',
    commandId: 'command-principal-planner-1',
    commandType: 'preview:enrollPrincipal',
    source: 'IPC',
    actor: {
      kind: 'USER',
      userId: 'admin-user-1',
      role: 'ADMIN',
      authSessionId: 'auth-session-1'
    },
    actorId: 'admin-user-1',
    target: {},
    payload: {
      enrollmentPackage: {
        payload: {
          package_marker: 'signed-package'
        }
      }
    },
    requestHash: 'request-hash-1',
    createdAt: '2026-08-01T01:00:00.000Z',
    correlationId: 'correlation-1',
    clientInstanceId: 'client-instance-1',
    idempotencyKey: 'idempotency-1',
    eventBatchId: 'event-batch-1',
    deviceId: null,
    authSessionId: 'auth-session-1',
    leaseOwner: 'planner-test',
    leaseGeneration: 1
  } as CommandEnvelopeV2
}

function fact(): PrincipalBindingFact {
  return {
    mapping_id: 'mapping-planner-1',
    target_installation_id: 'installation-planner-1',
    organization_id: 'organization-planner-1',
    user_id: 'admin-user-1',
    principal_id: 'principal-planner-1',
    mapping_version: 1,
    mapping_hash: 'a'.repeat(64),
    source_manifest_id: 'manifest-planner-1',
    source_manifest_hash: 'b'.repeat(64),
    effective_at: '2026-08-01T00:00:00.000Z',
    expires_at: '2026-08-15T00:00:00.000Z',
    signer_key_id: 'key-planner-1',
    signature: 'signature-planner-1',
    status_after: 'ACTIVE'
  }
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

describe('preview principal planner trust binding', () => {
  it('passes the sender-bound executor principal into enrollment verification', async () => {
    const database = await createTestDb()
    databases.push(database)
    applyPreviewContractMigration(database, { fresh: true })
    promotePreviewContractReady(database, '2026-08-01T00:00:00.000Z')

    let observedExecutor: string | undefined
    const service = {
      verifyEnrollmentEnvelope: vi.fn((_value: unknown, context: { executing_principal_id?: string }) => {
        observedExecutor = context.executing_principal_id
        return { enrollment_id: 'enrollment-planner-1', fact: fact(), verified: {} }
      }),
      verifyRotationEnvelope: vi.fn()
    } as unknown as PrincipalBindingService
    const trust: PreviewPrincipalTrustContext = {
      service,
      resolveScope: () => ({
        target_installation_id: 'installation-planner-1',
        organization_id: 'organization-planner-1'
      }),
      resolveExecutorPrincipal: (currentEnvelope) => currentEnvelope.actorId === 'admin-user-1' ? 'principal-executor-1' : null
    }

    const snapshot = loadPreviewPrincipalPlannerSnapshot(
      database,
      envelope(),
      { timestamp: '2026-08-01T01:00:00.000Z', appVersion: 'test' },
      trust
    )

    expect(observedExecutor).toBe('principal-executor-1')
    expect(snapshot.value).toMatchObject({ kind: 'ENROLLMENT', enrollment_id: 'enrollment-planner-1' })
  })

  it('fails closed when the trusted executor principal cannot be resolved', async () => {
    const database = await createTestDb()
    databases.push(database)
    applyPreviewContractMigration(database, { fresh: true })
    promotePreviewContractReady(database, '2026-08-01T00:00:00.000Z')
    const service = {
      verifyEnrollmentEnvelope: vi.fn(),
      verifyRotationEnvelope: vi.fn()
    } as unknown as PrincipalBindingService
    const trust: PreviewPrincipalTrustContext = {
      service,
      resolveScope: () => ({
        target_installation_id: 'installation-planner-1',
        organization_id: 'organization-planner-1'
      }),
      resolveExecutorPrincipal: () => null
    }

    const snapshot = loadPreviewPrincipalPlannerSnapshot(
      database,
      envelope(),
      { timestamp: '2026-08-01T01:00:00.000Z', appVersion: 'test' },
      trust
    )

    expect(snapshot.value).toMatchObject({ kind: 'NO_OP', no_op_result: { errorCode: 'INSTALLATION_TRUST_UNAVAILABLE' } })
    expect(service.verifyEnrollmentEnvelope).not.toHaveBeenCalled()
  })
})
