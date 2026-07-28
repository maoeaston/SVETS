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
  preflightM4SafetyRekeyHistory
} from '../safety-rekey-migration'

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

async function createV016Database(): Promise<MemoryAdapter> {
  const db = await MemoryAdapter.create()
  db.exec(readFileSync(resolve(process.cwd(), 'src/main/db/schema.sql'), 'utf8'))
  for (const [type, name] of CURRENT_M4_OBJECTS) db.exec(`DROP ${type.toUpperCase()} ${name};`)
  db.exec(V016_SAFETY_OBJECTS_FIXTURE)
  db.prepare('DELETE FROM schema_migration WHERE migration_id = ?').run(M4_SAFETY_REKEY_MIGRATION_ID)
  return db
}

function temporarilyRemoveLegacyM4Triggers(database: MemoryAdapter, names: readonly string[]): () => void {
  const triggers = names.map((name) => {
    const row = database.prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?").get(name) as
      | { sql: string | null }
      | undefined
    if (!row?.sql) throw new Error(`missing frozen legacy M4 trigger fixture: ${name}`)
    database.exec(`DROP TRIGGER ${name};`)
    return row.sql
  })
  return () => {
    for (const sql of triggers) database.exec(`${sql};`)
  }
}

function temporarilyRemoveTrigger(database: MemoryAdapter, name: string): () => void {
  const row = database.prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?").get(name) as
    | { sql: string | null }
    | undefined
  if (!row?.sql) throw new Error(`missing trigger fixture: ${name}`)
  database.exec(`DROP TRIGGER ${name};`)
  return () => database.exec(`${row.sql};`)
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

  it('rejects orphaned historical redline, binding, and replacement references before M4 DDL', async () => {
    const db = await createV016Database()
    const restoreLegacyTriggers = temporarilyRemoveLegacyM4Triggers(db, [
      'trg_assessment_session_redline_incident_same_student_task_insert',
      'trg_safety_incident_replacement_same_student_task_update'
    ])
    // Historical corruption may predate the direct-insert guard; restore every guard
    // before invoking M4 so the fixture keeps the frozen legacy structure.
    const restoreDirectRedlineGuard = temporarilyRemoveTrigger(db, 'trg_assessment_session_no_insert_redline_status')
    db.exec(`
      PRAGMA foreign_keys = OFF;
      INSERT INTO user_account (user_id, username, password_hash, role, display_name, status)
      VALUES ('admin-m4-orphan', 'admin-m4-orphan', 'hash', 'ADMIN', '管理员', 'ACTIVE');
      INSERT INTO student_profile (student_id, student_name, status)
      VALUES ('student-m4-orphan', '学生', 'ACTIVE');
      INSERT INTO business_session
        (business_session_id, session_type, student_id, job_code, task_code, created_by)
      VALUES
        ('business-m4-orphan', 'ASSESSMENT', 'student-m4-orphan', 'SUPERMARKET_SHELVER',
         'UNBOX_AND_SHELF', 'admin-m4-orphan');
      INSERT INTO domain_event_projection
        (event_id, aggregate_type, aggregate_id, event_type, event_sequence, payload_json, checksum, source_log_path)
      VALUES
        ('event-m4-orphan-incident', 'SAFETY_INCIDENT', 'incident-m4-orphan', 'SAFETY_INCIDENT_CREATED', 1, '{}', 'checksum', 'test-log'),
        ('event-m4-orphan-halt', 'ASSESSMENT_SESSION', 'session-m4-orphan', 'SESSION_HALTED', 1, '{}', 'checksum', 'test-log');
      INSERT INTO assessment_session
        (session_id, business_session_id, student_id, strategy_id, strategy_type, job_code, task_code, strategy_version,
         status, delivery_phase, online_question_count, offline_question_count, level_result, redline_incident_id, created_by)
      VALUES
        ('session-m4-orphan', 'business-m4-orphan', 'student-m4-orphan', 'strategy_baseline_shelver_v1', 'BASELINE_ASSESSMENT',
         'SUPERMARKET_SHELVER', 'UNBOX_AND_SHELF', 1, 'REDLINE_HALTED', 'PREPARED', 0, 0,
         'LEVEL_FAIL_BY_SAFETY', 'missing-redline-incident', 'admin-m4-orphan');
      INSERT INTO safety_incident
        (incident_id, student_id, job_code, task_code, trigger_event_id, reason_code, triggered_by, context_phase, status)
      VALUES
        ('incident-m4-orphan', 'student-m4-orphan', 'SUPERMARKET_SHELVER', 'UNBOX_AND_SHELF',
         'event-m4-orphan-incident', 'BLADE_TOWARD_SELF', 'admin-m4-orphan', 'OTHER',
         'PENDING_DETAIL');
      UPDATE safety_incident
      SET status = 'VOIDED', void_reason = 'DUPLICATE_RECORD', replacement_incident_id = 'missing-replacement-incident',
          resolved_by = 'admin-m4-orphan', resolved_at = '2026-07-27T00:00:00.000Z'
      WHERE incident_id = 'incident-m4-orphan';
      INSERT INTO safety_incident_binding
        (binding_id, incident_id, aggregate_type, aggregate_id, pre_status, post_status, halt_event_id)
      VALUES
        ('binding-m4-orphan', 'missing-binding-incident', 'ASSESSMENT_SESSION', 'session-m4-orphan',
         'ACTIVE', 'REDLINE_HALTED', 'event-m4-orphan-halt');
      PRAGMA foreign_keys = ON;
    `)
    restoreLegacyTriggers()
    restoreDirectRedlineGuard()

    expect(() => applyM4SafetyRekeyMigration(db)).toThrow(
      'redline-incident-orphan:1, binding-incident-orphan:1, replacement-incident-orphan:1'
    )
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
