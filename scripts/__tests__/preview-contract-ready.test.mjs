import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { syncDatabase } from '../lib/database-content-pack.mjs'
import { verifyPreviewContractReady } from '../lib/preview-contract-ready.mjs'
import { previewContractReadiness } from '../../src/main/domain/preview/preview-ready-gate.ts'

let tempDir
let dbPath

function sqlite(sql) {
  execFileSync('sqlite3', [dbPath, sql], { stdio: 'ignore' })
}

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'svets-preview-ready-'))
  dbPath = join(tempDir, 'data', 'xc-career-guide.db')
  expect(syncDatabase(dbPath).ok).toBe(true)
})

afterAll(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true })
  tempDir = null
  dbPath = null
})

describe.sequential('PREVIEW_CONTRACT_V1 READY verifier', () => {
  it('keeps an isolated migrated database NOT_READY while registry is INSTALLING', async () => {
    const result = await verifyPreviewContractReady({ dbPath })
    expect(result).toMatchObject({
      status: 'FAIL',
      code: 'PREVIEW_CONTRACT_NOT_READY',
      preview_contract: 'NOT_READY',
      migration_state: 'CURRENT',
      parity: { status: 'PASS', code: null },
      ipc_counts: { channels: 17, reads: 6, mutations: 11 }
    })
    expect(result.unmet).toContain('registry:status:INSTALLING')
  }, 15000)

  it('passes only after isolated registry status and all five digests are promoted', async () => {
    const readiness = previewContractReadiness('READY')
    sqlite([
      'UPDATE preview_contract_registry',
      "SET status = 'READY',",
      "event_registry_digest = '" + readiness.event_registry_digest + "',",
      "projection_digest = '" + readiness.projection_digest + "',",
      "query_digest = '" + readiness.query_digest + "',",
      "recovery_digest = '" + readiness.recovery_digest + "',",
      "error_map_digest = '" + readiness.error_map_digest + "',",
      "installed_at = '2026-08-01T03:00:00.000Z';"
    ].join('\n'))

    const result = await verifyPreviewContractReady({ dbPath })
    expect(result).toMatchObject({
      status: 'PASS',
      code: null,
      preview_contract: 'READY',
      unmet: [],
      parity: { status: 'PASS', code: null },
      ipc_source_digest: '20a90b64c6833bf2a320ff8b6bf44b62e951e04311cfe3d5c5edf5713f549a36'
    })

    sqlite("UPDATE preview_contract_registry SET query_digest = '" + 'c'.repeat(64) + "';")
    const tampered = await verifyPreviewContractReady({ dbPath })
    expect(tampered.status).toBe('FAIL')
    expect(tampered.unmet).toContain('registry:query_digest')
  }, 15000)

  it('requires an explicit absolute database path', async () => {
    await expect(verifyPreviewContractReady({ dbPath: undefined })).rejects.toThrow(
      'an explicit absolute --db path is required'
    )
  })
})
