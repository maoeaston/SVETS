import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { MemoryAdapter } from '../memory-adapter'
import { assertCurrentDatabaseSchema, M4_SAFETY_REKEY_MIGRATION_ID } from '../migrations'
import { inspectM4SafetyRekeyStructure } from '../safety-rekey-migration'

describe('M4 safety re-key fresh schema', () => {
  it('loads the current 15-object safety structure and M4 ledger in one fresh schema transaction', async () => {
    const db = await MemoryAdapter.create()
    db.exec(readFileSync(resolve(process.cwd(), 'src/main/db/schema.sql'), 'utf8'))

    expect(inspectM4SafetyRekeyStructure(db)).toBe('CURRENT_M4')
    expect(db.prepare('SELECT schema_version FROM schema_migration WHERE migration_id = ?').get(M4_SAFETY_REKEY_MIGRATION_ID))
      .toMatchObject({ schema_version: '0.1.17-multi-device-m4-safety-rekey' })
    expect(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name LIKE '%same_student_task%' OR name LIKE '%student_task_status'").get())
      .toMatchObject({ count: 0 })
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    assertCurrentDatabaseSchema(db)
    db.close()
  })
})
