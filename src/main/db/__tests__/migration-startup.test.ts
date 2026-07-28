import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { MemoryAdapter } from '../memory-adapter'
import { M4_SAFETY_REKEY_MIGRATION_ID } from '../migrations'
import { DatabaseStartupUpgradeError, orchestrateDatabaseStartupUpgrade } from '../migration-startup'
import { inspectM4SafetyRekeyStructure } from '../safety-rekey-migration'

const V016_SAFETY_OBJECTS_FIXTURE = readFileSync(
  resolve(process.cwd(), 'src/main/db/__tests__/fixtures/m4-v016-safety-objects.sql'),
  'utf8'
)

const CURRENT_M4_OBJECTS: ReadonlyArray<readonly ['index' | 'trigger', string]> = [
  ['trigger', 'trg_assessment_session_redline_incident_same_student_job_task_insert'],
  ['trigger', 'trg_assessment_session_redline_incident_same_student_job_task_update'],
  ['trigger', 'trg_training_session_redline_incident_same_student_job_task_insert'],
  ['trigger', 'trg_training_session_redline_incident_same_student_job_task_update'],
  ['trigger', 'trg_assessment_session_block_unresolved_safety_incident'],
  ['trigger', 'trg_training_session_block_unresolved_safety_incident'],
  ['trigger', 'trg_safety_incident_replacement_same_student_job_task_insert'],
  ['trigger', 'trg_safety_incident_replacement_same_student_job_task_update'],
  ['trigger', 'trg_safety_incident_bind_open_assessments'],
  ['trigger', 'trg_safety_incident_bind_open_trainings'],
  ['index', 'idx_assessment_session_student_job_task_status'],
  ['index', 'ux_assessment_one_open_session_per_student_job_task_strategy'],
  ['index', 'idx_training_session_student_job_task_status'],
  ['index', 'ux_training_one_open_session_per_student_job_task'],
  ['index', 'idx_safety_incident_student_job_task_status']
]

async function currentDatabase(): Promise<MemoryAdapter> {
  const db = await MemoryAdapter.create()
  db.exec(readFileSync(resolve(process.cwd(), 'src/main/db/schema.sql'), 'utf8'))
  return db
}

function installV016SafetyObjects(db: MemoryAdapter): void {
  for (const [type, name] of CURRENT_M4_OBJECTS) db.exec(`DROP ${type.toUpperCase()} ${name};`)
  db.exec(V016_SAFETY_OBJECTS_FIXTURE)
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

  it('fails closed before backup, DDL, or ledger write when legacy M4 objects already have a ledger', async () => {
    const db = await currentDatabase()
    installV016SafetyObjects(db)
    db.prepare(
      `INSERT INTO schema_migration (migration_id, schema_version, description, applied_at)
       VALUES (?, '0.1.17-multi-device-m4-safety-rekey', 'stale M4 ledger', '2026-07-27T00:00:00.000Z')`
    ).run(M4_SAFETY_REKEY_MIGRATION_ID)
    const ledgerBefore = db.prepare(
      'SELECT migration_id, schema_version, description, applied_at FROM schema_migration WHERE migration_id = ?'
    ).get(M4_SAFETY_REKEY_MIGRATION_ID)
    const calls: string[] = []

    expect(() => orchestrateDatabaseStartupUpgrade(db, {
      preReconcileF7: () => calls.push('reconcile-f7'),
      createVerifiedBackup: () => calls.push('backup'),
      runMigrations: () => {
        calls.push('ddl-or-ledger-write')
        return []
      }
    })).toThrow('M4 migration ledger conflicts with legacy safety structure')
    expect(calls).toEqual([])
    expect(inspectM4SafetyRekeyStructure(db)).toBe('LEGACY_V016')
    expect(db.prepare(
      'SELECT migration_id, schema_version, description, applied_at FROM schema_migration WHERE migration_id = ?'
    ).get(M4_SAFETY_REKEY_MIGRATION_ID)).toEqual(ledgerBefore)
    db.close()
  })

  it('stops before backup or DDL when M4 history contains an orphaned incident binding', async () => {
    const db = await currentDatabase()
    installV016SafetyObjects(db)
    db.exec(`
      PRAGMA foreign_keys = OFF;
      INSERT INTO safety_incident_binding
        (binding_id, incident_id, aggregate_type, aggregate_id, pre_status, post_status, halt_event_id)
      VALUES
        ('binding-m4-orphan', 'missing-incident', 'ASSESSMENT_SESSION', 'missing-session',
         'ACTIVE', 'REDLINE_HALTED', 'missing-event');
      PRAGMA foreign_keys = ON;
    `)
    const calls: string[] = []

    let failure: unknown
    try {
      orchestrateDatabaseStartupUpgrade(db, {
        preReconcileF7: () => calls.push('reconcile-f7'),
        createVerifiedBackup: () => calls.push('backup'),
        runMigrations: () => {
          calls.push('ddl-or-ledger-write')
          return []
        }
      })
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(DatabaseStartupUpgradeError)
    expect(failure).toMatchObject({
      code: 'M4_MIGRATION_FAILED',
      message: 'M4 database startup preparation failed safely',
      cause: expect.objectContaining({ code: 'M4_HISTORY_KEY_MISMATCH' })
    })
    expect(calls).toEqual([])
    expect(inspectM4SafetyRekeyStructure(db)).toBe('LEGACY_V016')
    expect(db.prepare('SELECT 1 AS present FROM schema_migration WHERE migration_id = ?').get(M4_SAFETY_REKEY_MIGRATION_ID))
      .toBeUndefined()
    db.close()
  })

  it('maps an M4 backup failure before migration to a stable startup error', async () => {
    const db = await currentDatabase()
    installV016SafetyObjects(db)
    const calls: string[] = []

    let failure: unknown
    try {
      orchestrateDatabaseStartupUpgrade(db, {
        preReconcileF7: () => calls.push('reconcile-f7'),
        createVerifiedBackup: () => {
          calls.push('backup')
          throw new Error('simulated backup failure')
        },
        runMigrations: () => {
          calls.push('ddl-or-ledger-write')
          return []
        }
      })
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(DatabaseStartupUpgradeError)
    expect(failure).toMatchObject({
      code: 'M4_MIGRATION_FAILED',
      message: 'M4 database startup preparation failed safely',
      cause: expect.objectContaining({ message: 'simulated backup failure' })
    })
    expect(calls).toEqual(['backup'])
    expect(inspectM4SafetyRekeyStructure(db)).toBe('LEGACY_V016')
    expect(db.prepare('SELECT 1 AS present FROM schema_migration WHERE migration_id = ?').get(M4_SAFETY_REKEY_MIGRATION_ID))
      .toBeUndefined()
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
