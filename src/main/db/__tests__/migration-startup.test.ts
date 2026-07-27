import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { MemoryAdapter } from '../memory-adapter'
import { M4_SAFETY_REKEY_MIGRATION_ID } from '../migrations'
import { orchestrateDatabaseStartupUpgrade } from '../migration-startup'
import { inspectM4SafetyRekeyStructure, m4SafetyRekeyObjectSql } from '../safety-rekey-migration'

async function currentDatabase(): Promise<MemoryAdapter> {
  const db = await MemoryAdapter.create()
  db.exec(readFileSync(resolve(process.cwd(), 'src/main/db/schema.sql'), 'utf8'))
  return db
}

function installV016SafetyObjects(db: MemoryAdapter): void {
  for (const sql of m4SafetyRekeyObjectSql('CURRENT_M4')) {
    const match = sql.match(/CREATE (TRIGGER|(?:UNIQUE )?INDEX) ([a-z_]+)/i)
    if (!match) throw new Error(`unparseable M4 object SQL: ${sql}`)
    db.exec(`DROP ${match[1].includes('INDEX') ? 'INDEX' : 'TRIGGER'} ${match[2]};`)
  }
  for (const sql of m4SafetyRekeyObjectSql('LEGACY_V016')) db.exec(`${sql};`)
  db.prepare('DELETE FROM schema_migration WHERE migration_id = ?').run(M4_SAFETY_REKEY_MIGRATION_ID)
}

describe('F7 to M4 startup orchestration', () => {
  it('preflights, backs up, and explicitly migrates a complete F7/v0.1.16 database', async () => {
    const db = await currentDatabase()
    installV016SafetyObjects(db)
    const calls: string[] = []

    const migrated = orchestrateDatabaseStartupUpgrade(db, {
      preReconcileF7: () => calls.push('reconcile-f7'),
      createVerifiedBackup: (stage, migrationId) => calls.push(`backup:${stage}:${migrationId}`)
    })

    expect(migrated).toEqual([M4_SAFETY_REKEY_MIGRATION_ID])
    expect(calls).toEqual([`backup:M4:${M4_SAFETY_REKEY_MIGRATION_ID}`])
    expect(inspectM4SafetyRekeyStructure(db)).toBe('CURRENT_M4')
    expect(db.prepare('SELECT 1 AS present FROM schema_migration WHERE migration_id = ?').get(M4_SAFETY_REKEY_MIGRATION_ID))
      .toMatchObject({ present: 1 })
    db.close()
  })

  it('only reconciles the ledger when the M4 structure is already current', async () => {
    const db = await currentDatabase()
    db.prepare('DELETE FROM schema_migration WHERE migration_id = ?').run(M4_SAFETY_REKEY_MIGRATION_ID)
    const calls: string[] = []

    expect(orchestrateDatabaseStartupUpgrade(db, {
      preReconcileF7: () => calls.push('reconcile-f7'),
      createVerifiedBackup: (stage) => calls.push(`backup:${stage}`)
    })).toEqual([])
    expect(calls).toEqual([])
    expect(db.prepare('SELECT 1 AS present FROM schema_migration WHERE migration_id = ?').get(M4_SAFETY_REKEY_MIGRATION_ID))
      .toMatchObject({ present: 1 })
    db.close()
  })

  it('stops on M4 drift before reconciliation or a new backup', async () => {
    const db = await currentDatabase()
    db.exec('DROP INDEX idx_safety_incident_student_job_task_status;')
    const calls: string[] = []

    expect(() => orchestrateDatabaseStartupUpgrade(db, {
      preReconcileF7: () => calls.push('reconcile-f7'),
      createVerifiedBackup: (stage) => calls.push(`backup:${stage}`)
    })).toThrow('M4 database safety structure is partial or drifted')
    expect(calls).toEqual([])
    db.close()
  })

  it('does nothing for a fresh database before the full current schema is loaded', async () => {
    const db = await MemoryAdapter.create()
    const calls: string[] = []
    expect(orchestrateDatabaseStartupUpgrade(db, {
      preReconcileF7: () => calls.push('reconcile-f7'),
      createVerifiedBackup: (stage) => calls.push(`backup:${stage}`)
    })).toEqual([])
    expect(calls).toEqual([])
    db.close()
  })
})
