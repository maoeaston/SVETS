import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { contentPack, syncDatabase, verifyDatabase } from '../lib/database-content-pack.mjs'

let tempDir = null
let dbPath = null

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'xc-db-migration-ledger-test-'))
  dbPath = join(tempDir, 'data', 'xc-career-guide.db')
  expect(syncDatabase(dbPath).ok).toBe(true)
}, 90_000)

afterAll(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true })
  tempDir = null
  dbPath = null
})

describe('database content pack migration ledger', () => {
  it('detects every required migration ledger gap', () => {
    for (const migration of contentPack.requiredMigrationLedger) {
      execFileSync('sqlite3', [
        dbPath,
        `DELETE FROM schema_migration WHERE migration_id='${migration.migrationId}';`
      ])
      expect(() => verifyDatabase(dbPath)).toThrow(
        `缺少迁移记录 ${migration.migrationId}@${migration.schemaVersion}`
      )
      execFileSync('sqlite3', [
        dbPath,
        `INSERT INTO schema_migration (migration_id, schema_version, description)
         VALUES ('${migration.migrationId}', '${migration.schemaVersion}', 'test restore');`
      ])
    }
  }, 90_000)
})
