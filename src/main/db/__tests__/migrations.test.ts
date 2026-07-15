import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { MemoryAdapter } from '../memory-adapter'
import {
  CURRENT_MIGRATION_ID,
  CURRENT_SCHEMA_VERSION,
  M1_MIGRATION_ID,
  M1_SCHEMA_VERSION,
  assertCurrentDatabaseSchema,
  runDatabaseMigrations
} from '../migrations'

function expectDatabaseIntegrity(db: MemoryAdapter): void {
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  const integrityRows = db.prepare('PRAGMA integrity_check').all() as Array<Record<string, string>>
  expect(integrityRows.map((row) => Object.values(row)[0])).toEqual(['ok'])
}

const V012_MINIMAL_SCHEMA = `
PRAGMA foreign_keys = ON;
CREATE TABLE schema_migration (
  migration_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  description TEXT,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE user_account (
  user_id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL
);
CREATE TABLE student_profile (
  student_id TEXT PRIMARY KEY,
  student_name TEXT NOT NULL,
  status TEXT NOT NULL
);
CREATE TABLE question_bank (
  question_id TEXT PRIMARY KEY,
  bank_domain TEXT NOT NULL,
  item_usage TEXT NOT NULL,
  job_module_code TEXT
);
CREATE TABLE assessment_session (
  session_id TEXT PRIMARY KEY,
  strategy_type TEXT NOT NULL
);
CREATE TABLE assessment_session_question (
  session_question_id TEXT PRIMARY KEY,
  bank_domain TEXT NOT NULL,
  job_module_code TEXT,
  item_usage TEXT NOT NULL,
  question_phase TEXT NOT NULL
);
CREATE TABLE answer_record (
  answer_id TEXT PRIMARY KEY,
  response_status TEXT
);
CREATE TABLE offline_score_record (
  offline_score_id TEXT PRIMARY KEY,
  score_scope TEXT NOT NULL,
  response_status TEXT,
  observation_payload_json TEXT
);
CREATE TABLE result_record (
  result_id TEXT PRIMARY KEY,
  result_type TEXT NOT NULL,
  strategy_type TEXT NOT NULL
);
`

const V012_M2_COMPAT_SCHEMA = `
PRAGMA foreign_keys = ON;
CREATE TABLE schema_migration (
  migration_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  description TEXT,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE user_account (
  user_id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL
);
CREATE TABLE student_profile (
  student_id TEXT PRIMARY KEY,
  student_name TEXT NOT NULL,
  status TEXT NOT NULL
);
CREATE TABLE question_bank (
  question_id TEXT PRIMARY KEY,
  job_code TEXT NOT NULL,
  bank_domain TEXT NOT NULL,
  item_usage TEXT NOT NULL,
  job_module_code TEXT
);
CREATE TABLE domain_event_projection (
  event_id TEXT PRIMARY KEY,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_sequence INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  checksum TEXT NOT NULL,
  source_log_path TEXT NOT NULL
);
CREATE TABLE assessment_session (
  session_id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  strategy_id TEXT NOT NULL,
  strategy_type TEXT NOT NULL,
  job_code TEXT NOT NULL,
  task_code TEXT NOT NULL,
  strategy_version INTEGER NOT NULL,
  status TEXT NOT NULL,
  current_question_id TEXT,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE assessment_session_question (
  session_question_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  question_id TEXT,
  bank_domain TEXT NOT NULL,
  job_module_code TEXT,
  item_usage TEXT NOT NULL,
  question_phase TEXT NOT NULL
);
CREATE TABLE answer_record (
  answer_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  response_status TEXT,
  status TEXT NOT NULL DEFAULT 'VALID'
);
CREATE TABLE offline_score_record (
  offline_score_id TEXT PRIMARY KEY,
  session_id TEXT,
  question_id TEXT,
  score_scope TEXT NOT NULL,
  response_status TEXT,
  observation_payload_json TEXT
);
CREATE TABLE result_record (
  result_id TEXT PRIMARY KEY,
  result_type TEXT NOT NULL,
  strategy_type TEXT NOT NULL
);
CREATE TABLE training_session (
  training_session_id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  job_code TEXT NOT NULL,
  task_code TEXT NOT NULL,
  strategy_type TEXT NOT NULL DEFAULT 'TRAINING_PRACTICE',
  strategy_version INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`

describe('database migrations', () => {
  it('repairs a falsely recorded M1 migration and preserves v0.1.12 rows', async () => {
    const db = await MemoryAdapter.create()
    db.exec(V012_MINIMAL_SCHEMA)
    db.exec(`
      INSERT INTO user_account VALUES ('u1', 'student-old', 'hash', 'STUDENT', '旧学生', 'ACTIVE');
      INSERT INTO student_profile VALUES ('s1', '旧学生', 'ACTIVE');
      INSERT INTO schema_migration (migration_id, schema_version)
      VALUES ('${M1_MIGRATION_ID}', '${M1_SCHEMA_VERSION}');
    `)
    let backupCalls = 0

    const applied = runDatabaseMigrations(db, {
      throughMigrationId: M1_MIGRATION_ID,
      beforeMigrate: () => {
        backupCalls += 1
      }
    })

    expect(applied).toEqual([M1_MIGRATION_ID])
    expect(backupCalls).toBe(1)
    expect(db.prepare('SELECT student_name FROM student_profile WHERE student_id = ?').get('s1'))
      .toMatchObject({ student_name: '旧学生' })
    expect(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='device'").get())
      .toMatchObject({ count: 1 })
    expect(db.prepare("SELECT COUNT(*) AS count FROM pragma_table_info('student_profile') WHERE name='user_id'").get())
      .toMatchObject({ count: 1 })
    expect(runDatabaseMigrations(db, { throughMigrationId: M1_MIGRATION_ID })).toEqual([])
    db.close()
  })

  it('migrates v0.1.12-shaped data through M1 and M2 with backfill, triggers, and integrity gates', async () => {
    const db = await MemoryAdapter.create()
    db.exec(V012_M2_COMPAT_SCHEMA)
    db.exec(`
      INSERT INTO user_account VALUES ('u1', 'teacher', 'hash', 'TEACHER', '教师', 'ACTIVE');
      INSERT INTO student_profile VALUES ('s1', '学生', 'ACTIVE');
      INSERT INTO assessment_session
        (session_id, student_id, strategy_id, strategy_type, job_code, task_code, strategy_version, status, current_question_id, created_by)
      VALUES
        ('a-init', 's1', 'strategy-base', 'BASELINE_ASSESSMENT', 'SUPERMARKET_STOCKER', 'UNBOX_AND_SHELF', 1, 'INIT', NULL, 'u1'),
        ('a-active', 's1', 'strategy-job', 'JOB_SKILL_ASSESSMENT', 'SUPERMARKET_STOCKER', 'UNBOX_AND_SHELF', 2, 'ACTIVE', 'q1', 'u1'),
        ('a-pending', 's1', 'strategy-job', 'JOB_SKILL_ASSESSMENT', 'SUPERMARKET_STOCKER', 'UNBOX_AND_SHELF', 2, 'OFFLINE_PENDING', NULL, 'u1'),
        ('a-done', 's1', 'strategy-base', 'BASELINE_ASSESSMENT', 'SUPERMARKET_STOCKER', 'UNBOX_AND_SHELF', 1, 'COMPLETED', NULL, 'u1'),
        ('a-aborted', 's1', 'strategy-base', 'BASELINE_ASSESSMENT', 'SUPERMARKET_STOCKER', 'UNBOX_AND_SHELF', 1, 'ABORTED', NULL, 'u1');
      INSERT INTO training_session
        (training_session_id, student_id, job_code, task_code, strategy_version, status, created_by)
      VALUES ('t-active', 's1', 'SUPERMARKET_STOCKER', 'UNBOX_AND_SHELF', 1, 'ACTIVE', 'u1');
      INSERT INTO assessment_session_question
        (session_question_id, session_id, question_id, bank_domain, job_module_code, item_usage, question_phase)
      VALUES ('sq-observe', 'a-active', 'q1', 'JOB_SPECIFIC', 'M1', 'OBSERVATION_ONLY', 'OBSERVATION');
      INSERT INTO answer_record (answer_id, session_id, response_status, status)
      VALUES ('ans-active', 'a-active', 'ANSWERED', 'VALID');
      INSERT INTO domain_event_projection
        (event_id, aggregate_type, aggregate_id, event_type, event_sequence, payload_json, checksum, source_log_path)
      VALUES
        ('ev-a-active-1', 'ASSESSMENT_SESSION', 'a-active', 'SESSION_STARTED', 1, '{}', 'c1', 'log'),
        ('ev-a-active-3', 'ASSESSMENT_SESSION', 'a-active', 'ANSWER_SUBMITTED', 3, '{}', 'c3', 'log');
    `)
    const backupBatches: string[][] = []

    const applied = runDatabaseMigrations(db, {
      beforeMigrate: (migrationIds) => backupBatches.push(migrationIds)
    })

    expect(applied).toEqual([M1_MIGRATION_ID, CURRENT_MIGRATION_ID])
    expect(backupBatches).toEqual([[M1_MIGRATION_ID, CURRENT_MIGRATION_ID]])
    expect(db.prepare('SELECT COUNT(*) AS count FROM assessment_session').get()).toMatchObject({ count: 5 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM training_session').get()).toMatchObject({ count: 1 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM business_session').get()).toMatchObject({ count: 6 })
    expect(db.prepare('SELECT delivery_phase FROM assessment_session WHERE session_id = ?').get('a-init'))
      .toMatchObject({ delivery_phase: 'PREPARED' })
    expect(db.prepare('SELECT delivery_phase, event_sequence_version, observation_template_id FROM assessment_session WHERE session_id = ?').get('a-active'))
      .toMatchObject({
        delivery_phase: 'ONLINE_IN_PROGRESS',
        event_sequence_version: 3,
        observation_template_id: 'strategy-job@2'
      })
    expect(db.prepare('SELECT delivery_phase FROM assessment_session WHERE session_id = ?').get('a-pending'))
      .toMatchObject({ delivery_phase: 'OFFLINE_SCORING' })
    expect(db.prepare('SELECT delivery_phase FROM assessment_session WHERE session_id = ?').get('a-done'))
      .toMatchObject({ delivery_phase: 'FINALIZED' })
    expect(db.prepare('SELECT delivery_phase FROM assessment_session WHERE session_id = ?').get('a-aborted'))
      .toMatchObject({ delivery_phase: null })
    expect(
      db.prepare(`
        SELECT COUNT(*) AS count
          FROM assessment_session a
          JOIN business_session bs ON bs.business_session_id = a.business_session_id
         WHERE bs.session_type = 'ASSESSMENT'
           AND bs.student_id = a.student_id
           AND bs.job_code = a.job_code
           AND bs.task_code = a.task_code
      `).get()
    ).toMatchObject({ count: 5 })

    db.prepare(`
      INSERT INTO business_session
        (business_session_id, session_type, student_id, job_code, task_code, created_by)
      VALUES ('bs-invalid-phase', 'ASSESSMENT', 's1', 'SUPERMARKET_STOCKER', 'UNBOX_AND_SHELF', 'u1')
    `).run()
    expect(() => db.prepare(`
      INSERT INTO assessment_session
        (session_id, business_session_id, student_id, strategy_id, strategy_type, job_code, task_code, strategy_version, status, delivery_phase, created_by)
      VALUES ('a-invalid-phase', 'bs-invalid-phase', 's1', 'strategy-base', 'BASELINE_ASSESSMENT', 'SUPERMARKET_STOCKER', 'UNBOX_AND_SHELF', 1, 'ACTIVE', 'ONLINE_IN_PROGRESS', 'u1')
    `).run()).toThrow('delivery_phase must start at PREPARED')
    expect(() => db.prepare(`
      INSERT INTO assessment_session
        (session_id, business_session_id, student_id, strategy_id, strategy_type, job_code, task_code, strategy_version, status, delivery_phase, created_by)
      VALUES ('a-completed-null', 'bs-invalid-phase', 's1', 'strategy-base', 'BASELINE_ASSESSMENT', 'SUPERMARKET_STOCKER', 'UNBOX_AND_SHELF', 1, 'COMPLETED', NULL, 'u1')
    `).run()).toThrow('FINALIZED must correspond to COMPLETED')
    expect(() => db.prepare("UPDATE assessment_session SET delivery_phase = 'PREPARED' WHERE session_id = 'a-aborted'").run())
      .toThrow('delivery_phase of REDLINE_HALTED/ABORTED session is frozen')
    expect(() => db.prepare("UPDATE business_session SET task_code = 'OTHER_TASK' WHERE business_session_id = 'a-init'").run())
      .toThrow('business_session key fields')
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='trigger' AND name IN ('trg_assessment_delivery_phase_forward_only', 'trg_learning_business_session_consistency_insert')").get()
    ).toMatchObject({ count: 0 })
    expectDatabaseIntegrity(db)
    assertCurrentDatabaseSchema(db)
    expect(runDatabaseMigrations(db)).toEqual([])
    db.close()
  })

  it('rejects same-name M2 trigger or index drift instead of trusting object names', async () => {
    const db = await MemoryAdapter.create()
    const schema = readFileSync(resolve(process.cwd(), 'src/main/db/schema.sql'), 'utf8')
    db.exec(schema)
    db.exec(`
      DROP TRIGGER trg_assessment_business_session_consistency_insert;
      CREATE TRIGGER trg_assessment_business_session_consistency_insert
      BEFORE INSERT ON assessment_session
      BEGIN SELECT 1; END;
    `)

    expect(() => assertCurrentDatabaseSchema(db)).toThrow('migration:multi-device-m2-session-foundation')
    expect(() => runDatabaseMigrations(db)).toThrow('did not produce the required structure')
    db.close()

    const indexDb = await MemoryAdapter.create()
    indexDb.exec(schema)
    indexDb.exec(`
      DROP INDEX idx_assessment_session_delivery_phase;
      CREATE INDEX idx_assessment_session_delivery_phase ON assessment_session(status);
    `)

    expect(() => assertCurrentDatabaseSchema(indexDb)).toThrow('migration:multi-device-m2-session-foundation')
    expect(() => runDatabaseMigrations(indexDb)).toThrow('did not produce the required structure')
    indexDb.close()
  })

  it('does not write missing M2 ledger records when integrity checks fail', async () => {
    const db = await MemoryAdapter.create()
    const schema = readFileSync(resolve(process.cwd(), 'src/main/db/schema.sql'), 'utf8')
    db.exec(schema)
    db.exec(`
      PRAGMA foreign_keys = OFF;
      INSERT INTO business_session
        (business_session_id, session_type, student_id, job_code, task_code, created_by)
      VALUES ('bad-parent', 'ASSESSMENT', 'missing-student', 'SUPERMARKET_STOCKER', 'UNBOX_AND_SHELF', 'missing-user');
      DELETE FROM schema_migration WHERE migration_id = '${CURRENT_MIGRATION_ID}';
      PRAGMA foreign_keys = ON;
    `)

    expect(() => runDatabaseMigrations(db)).toThrow('foreign_key_check')
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM schema_migration WHERE migration_id = ?').get(CURRENT_MIGRATION_ID)
    ).toMatchObject({ count: 0 })
    db.close()
  })

  it('rejects unsupported pre-v0.1.12 structures without recording M1', async () => {
    const db = await MemoryAdapter.create()
    db.exec(`
      CREATE TABLE user_account (user_id TEXT PRIMARY KEY);
      CREATE TABLE student_profile (student_id TEXT PRIMARY KEY);
    `)

    expect(() => runDatabaseMigrations(db)).toThrow('Unsupported pre-v0.1.12 database')
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='schema_migration'").get()
    ).toMatchObject({ count: 0 })
    db.close()
  })

  it('full schema records the current baseline only after loading successfully', async () => {
    const db = await MemoryAdapter.create()
    const schema = readFileSync(resolve(process.cwd(), 'src/main/db/schema.sql'), 'utf8')
    db.exec(schema)

    expect(
      db.prepare('SELECT schema_version FROM schema_migration WHERE migration_id = ?').get(CURRENT_MIGRATION_ID)
    ).toMatchObject({ schema_version: CURRENT_SCHEMA_VERSION })
    expect(
      db.prepare('SELECT schema_version FROM schema_migration WHERE migration_id = ?').get(M1_MIGRATION_ID)
    ).toMatchObject({ schema_version: M1_SCHEMA_VERSION })
    expectDatabaseIntegrity(db)
    assertCurrentDatabaseSchema(db)
    db.close()
  })
})
