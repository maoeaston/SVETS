import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  contentPack,
  syncDatabase
} from '../lib/database-content-pack.mjs'
import { verifyPreviewContractParity } from '../lib/preview-contract-parity.mjs'

let tempDir = null
let dbPath = null

function sqlite(sql, target = dbPath) {
  execFileSync('sqlite3', [target, sql], { stdio: 'ignore' })
}

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'svets-preview-parity-'))
  dbPath = join(tempDir, 'data', 'xc-career-guide.db')
  expect(syncDatabase(dbPath).ok).toBe(true)
}, 90_000)

afterAll(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true })
  tempDir = null
  dbPath = null
})

describe.sequential('PREVIEW_CONTRACT_V1 Step 0 parity gate', () => {
  it('passes current content/M5B parity while keeping the preview contract fail-closed', async () => {
    const result = await verifyPreviewContractParity({ dbPath, includeIsolatedM5b: true })
    expect(result).toMatchObject({
      status: 'PASS',
      code: null,
      preview_contract: 'NOT_READY',
      preview_contract_code: 'PREVIEW_CONTRACT_NOT_READY',
      content_verifier: { status: 'PASS' },
      m5b: { ok: true, structure: 'CURRENT' },
      isolated_verifier: { status: 'PASS', schemaVersion: '0.1.18-event-batch-v2.2' }
    })
    expect(result.ledger_digest.content_pack).toBe(result.ledger_digest.target)
    expect(result.ledger_digest.m5b).toBe(result.ledger_digest.m5b_target)
    expect(result.object_digest.m5b).toBe(result.object_digest.target)
    expect(result.unmet).toContain('PREVIEW_CONTRACT_NOT_READY')
  }, 90_000)

  it('reports an old content-pack fixture as PARITY_REQUIRED', async () => {
    const oldPack = {
      ...contentPack,
      schemaVersion: '0.1.17-multi-device-m4-safety-rekey',
      migrationId: '2026-07-27_mvp_schema_v0_1_17_multi_device_m4_safety_rekey',
      requiredMigrationLedger: contentPack.requiredMigrationLedger.slice(0, -1)
    }
    const result = await verifyPreviewContractParity({
      dbPath,
      contentPack: oldPack,
      includeIsolatedM5b: false
    })
    expect(result.status).toBe('BLOCKED')
    expect(result.code).toBe('PARITY_REQUIRED')
    expect(result.content_pack.issues).toEqual(expect.arrayContaining([
      'schema-version:0.1.17-multi-device-m4-safety-rekey',
      'migration-id:2026-07-27_mvp_schema_v0_1_17_multi_device_m4_safety_rekey'
    ]))
    expect(result.preview_contract).toBe('NOT_READY')
  })

  it('distinguishes a partial migration ledger from a valid target', async () => {
    sqlite("DELETE FROM schema_migration WHERE migration_id='2026-07-29_mvp_schema_v0_1_18_event_batch_v2_2';")
    const result = await verifyPreviewContractParity({ dbPath, includeIsolatedM5b: false })
    expect(result.status).toBe('FAIL')
    expect(result.code).toBe('M5B_LEDGER_DRIFT')
    sqlite("INSERT INTO schema_migration (migration_id, schema_version, description) VALUES ('2026-07-29_mvp_schema_v0_1_18_event_batch_v2_2', '0.1.18-event-batch-v2.2', 'test restore');")
  }, 30_000)

  it('distinguishes an unknown ledger entry from the target ledger', async () => {
    sqlite("INSERT INTO schema_migration (migration_id, schema_version, description) VALUES ('future_preview_migration', '0.1.19-job-skill-preview-contract-v1', 'fixture');")
    const result = await verifyPreviewContractParity({ dbPath, includeIsolatedM5b: false })
    expect(result.status).toBe('FAIL')
    expect(result.code).toBe('M5B_LEDGER_DRIFT')
    sqlite("DELETE FROM schema_migration WHERE migration_id='future_preview_migration';")
  })

  it('distinguishes partial M5B objects from ledger drift', async () => {
    sqlite('DROP INDEX idx_processed_event_batch;')
    const result = await verifyPreviewContractParity({ dbPath, includeIsolatedM5b: false })
    expect(result.status).toBe('FAIL')
    expect(result.code).toBe('M5B_SCHEMA_DRIFT')
    sqlite('CREATE INDEX idx_processed_event_batch ON processed_event(batch_id);')
  })

  it('uses a fresh explicit fixture and never falls back to a default database', async () => {
    const freshDir = mkdtempSync(join(tmpdir(), 'svets-preview-parity-fresh-'))
    const freshDbPath = join(freshDir, 'fresh.db')
    try {
      sqlite('PRAGMA user_version=0;', freshDbPath)
      const result = await verifyPreviewContractParity({ dbPath: freshDbPath, includeIsolatedM5b: false })
      expect(result.status).toBe('FAIL')
      expect(result.code).toBe('M5B_SCHEMA_DRIFT')
      await expect(verifyPreviewContractParity({ includeIsolatedM5b: false })).rejects.toThrow(
        'an explicit absolute --db path is required'
      )
    } finally {
      rmSync(freshDir, { recursive: true, force: true })
    }
  })
})
