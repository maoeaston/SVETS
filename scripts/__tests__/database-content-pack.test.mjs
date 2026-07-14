import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { syncDatabase, verifyDatabase } from '../lib/database-content-pack.mjs'

let tempDir = null

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true })
  tempDir = null
})

describe('database content pack', () => {
  it('syncs idempotently, detects drift, and creates a pre-reset backup', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'xc-db-sync-test-'))
    const dbPath = join(tempDir, 'data', 'xc-career-guide.db')

    const first = syncDatabase(dbPath)
    expect(first.ok).toBe(true)
    expect(first.counts).toMatchObject({ BASE_ABILITY: 96, JOB_SPECIFIC: 298 })

    const second = syncDatabase(dbPath)
    expect(second.packHash).toBe(first.packHash)
    expect(verifyDatabase(dbPath).ok).toBe(true)

    execFileSync('sqlite3', [dbPath, 'DROP INDEX idx_auth_session_token;'])
    expect(() => verifyDatabase(dbPath)).toThrow('缺少 schema 对象 index:idx_auth_session_token')
    expect(syncDatabase(dbPath).ok).toBe(true)

    execFileSync('sqlite3', [dbPath, "UPDATE question_bank SET scoring_rule_json='{}' WHERE question_id='GA-FM-001';"])
    expect(() => verifyDatabase(dbPath)).toThrow('题库语义哈希与内容包不一致')

    const rebuilt = syncDatabase(dbPath, { reset: true })
    expect(rebuilt.ok).toBe(true)
    expect(rebuilt.backupPath).not.toBeNull()
    expect(existsSync(rebuilt.backupPath)).toBe(true)
  }, 30_000)
})
