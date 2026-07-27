import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { MemoryAdapter } from '../memory-adapter'
import type { DBAdapter, DBStatement } from '../interface'
import { M4_SAFETY_REKEY_MIGRATION_ID, runDatabaseMigrations } from '../migrations'
import {
  applyM4SafetyRekeyMigration,
  inspectM4SafetyRekeyStructure,
  M4SafetyRekeyMigrationError,
  m4SafetyRekeyObjectSql,
  preflightM4SafetyRekeyHistory
} from '../safety-rekey-migration'

async function createV016Database(): Promise<MemoryAdapter> {
  const db = await MemoryAdapter.create()
  db.exec(readFileSync(resolve(process.cwd(), 'src/main/db/schema.sql'), 'utf8'))
  for (const sql of m4SafetyRekeyObjectSql('CURRENT_M4')) {
    const [, type, name] = sql.match(/CREATE (TRIGGER|(?:UNIQUE )?INDEX) ([a-z_]+)/i) ?? []
    db.exec(`DROP ${type.includes('INDEX') ? 'INDEX' : 'TRIGGER'} ${name};`)
  }
  for (const sql of m4SafetyRekeyObjectSql('LEGACY_V016')) db.exec(`${sql};`)
  db.prepare('DELETE FROM schema_migration WHERE migration_id = ?').run(M4_SAFETY_REKEY_MIGRATION_ID)
  return db
}

class FailingExecAdapter implements DBAdapter {
  private execCount = 0

  constructor(private readonly database: MemoryAdapter, private readonly failAtExec: number) {}

  prepare(sql: string): DBStatement {
    return this.database.prepare(sql)
  }

  transaction<T>(fn: () => T): () => T {
    return this.database.transaction(fn)
  }

  exec(sql: string): void {
    this.execCount += 1
    if (this.execCount === this.failAtExec) throw new Error('injected M4 DDL failure')
    this.database.exec(sql)
  }
}

describe('M4 safety re-key migration kernel', () => {
  it('recognizes the frozen v0.1.16 structure and replaces all 15 objects', async () => {
    const db = await createV016Database()
    expect(inspectM4SafetyRekeyStructure(db)).toBe('LEGACY_V016')

    applyM4SafetyRekeyMigration(db)

    expect(inspectM4SafetyRekeyStructure(db)).toBe('CURRENT_M4')
    expect(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'index' AND name LIKE '%student_task_status'").get())
      .toMatchObject({ count: 0 })
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect((db.prepare('PRAGMA integrity_check').all() as Array<Record<string, string>>)
      .map((row) => Object.values(row)[0])).toEqual(['ok'])
    db.close()
  })

  it('fails closed on a changed legacy trigger body before applying DDL', async () => {
    const db = await createV016Database()
    db.exec('DROP TRIGGER trg_assessment_session_block_unresolved_safety_incident;')
    db.exec(`
      CREATE TRIGGER trg_assessment_session_block_unresolved_safety_incident
      BEFORE INSERT ON assessment_session
      FOR EACH ROW WHEN 0
      BEGIN SELECT RAISE(ABORT, 'drift'); END;
    `)

    expect(() => applyM4SafetyRekeyMigration(db)).toThrow(M4SafetyRekeyMigrationError)
    expect(inspectM4SafetyRekeyStructure(db)).toBe('PARTIAL_OR_DRIFTED')
    expect(db.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'index' AND name = 'ux_assessment_one_open_session_per_student_task_strategy'").get())
      .toMatchObject({ present: 1 })
    db.close()
  })

  it('requires F7 before accepting direct M4 preflight calls', async () => {
    const db = await MemoryAdapter.create()
    db.exec('CREATE TABLE schema_migration (migration_id TEXT PRIMARY KEY);')
    expect(() => preflightM4SafetyRekeyHistory(db)).toThrow('M4 requires complete F7 structure')
    db.close()
  })

  it('rejects historical blank job facts before replacing any legacy object', async () => {
    const db = await createV016Database()
    db.exec(`
      INSERT INTO user_account (user_id, username, password_hash, role, display_name, status)
      VALUES ('teacher-m4', 'teacher-m4', 'hash', 'TEACHER', '教师', 'ACTIVE');
      INSERT INTO student_profile (student_id, student_name, status)
      VALUES ('student-m4', '学生', 'ACTIVE');
      INSERT INTO domain_event_projection
        (event_id, aggregate_type, aggregate_id, event_type, event_sequence, payload_json, checksum, source_log_path)
      VALUES ('event-m4', 'SAFETY_INCIDENT', 'incident-m4', 'SAFETY_INCIDENT_CREATED', 1, '{}', 'checksum', 'test-log');
      INSERT INTO safety_incident
        (incident_id, student_id, job_code, task_code, trigger_event_id, reason_code, triggered_by, context_phase, status)
      VALUES ('incident-m4', 'student-m4', ' ', 'UNBOX_AND_SHELF', 'event-m4', 'BLADE_TOWARD_SELF', 'teacher-m4', 'OTHER', 'PENDING_DETAIL');
    `)

    expect(() => applyM4SafetyRekeyMigration(db)).toThrow('empty-job:incident:1')
    expect(inspectM4SafetyRekeyStructure(db)).toBe('LEGACY_V016')
    db.close()
  })

  it('records ledger only when the M4 structure is already complete', async () => {
    const db = await createV016Database()
    applyM4SafetyRekeyMigration(db)
    db.prepare('DELETE FROM schema_migration WHERE migration_id = ?').run(M4_SAFETY_REKEY_MIGRATION_ID)

    expect(runDatabaseMigrations(db, { throughMigrationId: M4_SAFETY_REKEY_MIGRATION_ID }))
      .toEqual([])
    expect(inspectM4SafetyRekeyStructure(db)).toBe('CURRENT_M4')
    expect(db.prepare('SELECT 1 AS present FROM schema_migration WHERE migration_id = ?').get(M4_SAFETY_REKEY_MIGRATION_ID))
      .toMatchObject({ present: 1 })
    db.close()
  })

  it('rolls back every injected M4 DDL failure without recording the ledger', async () => {
    // exec #1 creates/verifies schema_migration; #2–#31 are the 15 DROP + 15 CREATE operations.
    for (const failAtExec of Array.from({ length: 30 }, (_, index) => index + 2)) {
      const db = await createV016Database()
      const failing = new FailingExecAdapter(db, failAtExec)

      expect(() => runDatabaseMigrations(failing, { throughMigrationId: M4_SAFETY_REKEY_MIGRATION_ID }))
        .toThrow('injected M4 DDL failure')
      expect(inspectM4SafetyRekeyStructure(db)).toBe('LEGACY_V016')
      expect(db.prepare('SELECT 1 AS present FROM schema_migration WHERE migration_id = ?').get(M4_SAFETY_REKEY_MIGRATION_ID))
        .toBeUndefined()
      db.close()
    }
  })
})
