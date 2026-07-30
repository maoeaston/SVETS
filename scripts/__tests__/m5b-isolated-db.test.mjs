import { existsSync, readFileSync, rmSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'

import { createM5bTempPaths } from '../lib/m5b-isolated-paths.mjs'
import {
  isolatedEvidenceExists,
  M5bIsolatedDatabaseError,
  runM5bIsolatedDatabaseVerification
} from '../lib/m5b-isolated-db.mjs'

const preservedRoots = []

afterEach(() => {
  while (preservedRoots.length > 0) rmSync(preservedRoots.pop(), { recursive: true, force: true })
})

describe('M5B isolated schema verification', () => {
  it('migrates exact M4, verifies/restore-tests the pair, and removes only its successful temp root', async () => {
    const result = await runM5bIsolatedDatabaseVerification()
    expect(result).toMatchObject({
      ok: true,
      stage: 'schema',
      migration: { source: 'EXACT_M4', applied: true },
      schemaVersion: '0.1.18-event-batch-v2.2',
      targetTableCount: 4,
      namedIndexCount: 3,
      backup: { manifestStage: 'M5B_SCHEMA' },
      cleaned: true
    })
    expect(result.queryPlanIndexes).toHaveLength(3)
    expect(existsSync(result.paths.runRoot)).toBe(false)
  })

  it('uses a unique direct /tmp child for every run', async () => {
    const first = await runM5bIsolatedDatabaseVerification()
    const second = await runM5bIsolatedDatabaseVerification()
    expect(first.paths.runRoot).not.toBe(second.paths.runRoot)
    expect(first.paths.runRoot).toMatch(/^\/tmp\/svets-m5b-/)
    expect(second.paths.runRoot).toMatch(/^\/tmp\/svets-m5b-/)
  })

  it('verifies storage capabilities, legal legacy preservation, segment rotation, and atomic index publication', async () => {
    const result = await runM5bIsolatedDatabaseVerification({ stage: 'storage' })
    expect(result).toMatchObject({
      ok: true,
      stage: 'storage',
      storage: {
        capability: {
          supported: true,
          exclusiveCreate: true,
          sameFileIdentity: true,
          fileSync: true,
          directoryBarrier: true,
          hardLinkNoClobber: true,
          atomicReplace: true
        },
        legacy: {
          state: 'VALID_LF_TERMINATED',
          preserved: true
        },
        segment: {
          sealedSegmentId: 'seg_000000000001',
          activeSegmentId: 'seg_000000000002',
          confirmedBatchCount: 1
        },
        index: {
          status: 'CURRENT',
          segmentCount: 2,
          lastGlobalBatchSequence: 1
        }
      },
      cleaned: true
    })
    expect(result.storage.legacy.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(result.storage.segment.fileSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(result.storage.index.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(existsSync(result.paths.runRoot)).toBe(false)
  })

  it('persists a fenced command retry/result without raw or low-cost secret material', async () => {
    const result = await runM5bIsolatedDatabaseVerification({ stage: 'command' })
    expect(result).toMatchObject({
      ok: true,
      stage: 'command',
      command: {
        status: 'SUCCEEDED',
        leaseGeneration: 2,
        attemptCount: 2,
        resultSchemaVersion: 'command-result-v1',
        rawSecretAbsent: true,
        lowCostSecretHashAbsent: true,
        persisted: true
      },
      storage: {
        capability: { supported: true },
        index: { status: 'CURRENT' }
      },
      cleaned: true
    })
    expect(existsSync(result.paths.runRoot)).toBe(false)
  })

  it('runs gate-only DML and its fenced canonical result in one isolated IMMEDIATE transaction', async () => {
    const result = await runM5bIsolatedDatabaseVerification({ stage: 'gate-only' })
    expect(result).toMatchObject({
      ok: true,
      stage: 'gate-only',
      gate: {
        status: 'SUCCEEDED',
        replayed: true,
        probeCommitted: true,
        batchCount: 0,
        persisted: true
      },
      cleaned: true
    })
    expect(existsSync(result.paths.runRoot)).toBe(false)
  })

  it('runs the coordinator and a post-PONR restart against an explicit isolated root', async () => {
    const result = await runM5bIsolatedDatabaseVerification({ stage: 'coordinator' })
    expect(result).toMatchObject({
      ok: true,
      stage: 'coordinator',
      coordinator: {
        batchCount: 2,
        eventCount: 3,
        confirmedCount: 2,
        plannerCallsBeforePonr: 2,
        recoveryPlannerCalls: 0,
        recoveredAttemptCount: 1,
        relativeSources: true,
        persisted: true
      },
      storage: {
        capability: { supported: true },
        index: { status: 'CURRENT' }
      },
      cleaned: true
    })
    expect(existsSync(result.paths.runRoot)).toBe(false)
  })

  it('publishes and rebuilds a frozen report artifact without overwriting an external target', async () => {
    const result = await runM5bIsolatedDatabaseVerification({ stage: 'artifact' })
    expect(result).toMatchObject({
      ok: true,
      stage: 'artifact',
      artifact: {
        probeClean: true,
        published: true,
        rebuilt: true,
        externalTargetPreserved: true
      },
      storage: {
        capability: { supported: true },
        index: { status: 'CURRENT' }
      },
      cleaned: true
    })
    expect(existsSync(result.paths.runRoot)).toBe(false)
  })

  it('runs one redline event through native M4 safety triggers and persists its prepared projection', async () => {
    const result = await runM5bIsolatedDatabaseVerification({ stage: 'safety' })
    expect(result).toMatchObject({
      ok: true,
      stage: 'safety',
      safety: {
        eventCount: 1,
        bindingCount: 2,
        plannerCalls: 1,
        persisted: true
      },
      storage: {
        capability: { supported: true },
        index: { status: 'CURRENT' }
      },
      cleaned: true
    })
    expect(result.safety.incidentId).toMatch(/^[0-9a-f-]{36}$/)
    expect(existsSync(result.paths.runRoot)).toBe(false)
  })

  it('runs the complete production cutover harness across isolated M4 databases', async () => {
    const result = await runM5bIsolatedDatabaseVerification({ stage: 'cutover' })
    expect(result).toMatchObject({
      ok: true,
      stage: 'cutover',
      components: {
        command: { command: { persisted: true } },
        'gate-only': { gate: { persisted: true, batchCount: 0 } },
        coordinator: { coordinator: { persisted: true, confirmedCount: 2 } },
        artifact: { artifact: { published: true, rebuilt: true } },
        safety: { safety: { persisted: true, eventCount: 1 } },
        storage: { storage: { index: { status: 'CURRENT' } } },
        schema: { migration: { source: 'EXACT_M4', applied: true } }
      },
      cleaned: true
    })
  }, 20_000)

  it('rejects an unknown stage before creating or opening paths', async () => {
    let pathsCreated = false
    await expect(runM5bIsolatedDatabaseVerification({
      stage: 'native',
      pathsFactory: () => {
        pathsCreated = true
        return createM5bTempPaths()
      }
    })).rejects.toThrow(/unsupported stage native/)
    expect(pathsCreated).toBe(false)
  })

  it('preserves isolated evidence when migration fails after the paired backup', async () => {
    let paths = null
    await expect(runM5bIsolatedDatabaseVerification({
      pathsFactory: () => {
        paths = createM5bTempPaths()
        return paths
      },
      migrate: (database, dependencies) => {
        dependencies.createVerifiedBackupBeforeDdl()
        throw new Error('injected post-backup migration failure')
      }
    })).rejects.toSatisfy((error) => {
      expect(error).toBeInstanceOf(M5bIsolatedDatabaseError)
      expect(error.message).toContain('injected post-backup migration failure')
      expect(isolatedEvidenceExists(error)).toBe(true)
      return true
    })
    preservedRoots.push(paths.runRoot)
    expect(existsSync(paths.dbPath)).toBe(true)
    expect(existsSync(paths.legacyLogPath)).toBe(true)
    expect(existsSync(`${paths.dataRoot}/backups/pre-migration.m5b.schema/manifest.json`)).toBe(true)
  })

  it('contains no default runtime database resolver or connection import', () => {
    const source = [
      readFileSync('scripts/lib/m5b-isolated-db.mjs', 'utf8'),
      readFileSync('scripts/verify-m5b-isolated-db.mjs', 'utf8')
    ].join('\n')
    const forbiddenResolver = ['resolve', 'Default', 'Db', 'Path'].join('')
    const forbiddenModule = ['src', 'main', 'db', 'connection'].join('/')
    expect(source).not.toContain(forbiddenResolver)
    expect(source).not.toContain(forbiddenModule)
    expect(source).not.toContain('homedir')
  })
})
