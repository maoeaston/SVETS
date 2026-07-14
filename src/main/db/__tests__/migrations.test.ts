import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { MemoryAdapter } from '../memory-adapter'
import {
  CURRENT_MIGRATION_ID,
  assertCurrentDatabaseSchema,
  runDatabaseMigrations
} from '../migrations'

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

describe('database migrations', () => {
  it('repairs a falsely recorded M1 migration and preserves v0.1.12 rows', async () => {
    const db = await MemoryAdapter.create()
    db.exec(V012_MINIMAL_SCHEMA)
    db.exec(`
      INSERT INTO user_account VALUES ('u1', 'student-old', 'hash', 'STUDENT', '旧学生', 'ACTIVE');
      INSERT INTO student_profile VALUES ('s1', '旧学生', 'ACTIVE');
      INSERT INTO schema_migration (migration_id, schema_version)
      VALUES ('${CURRENT_MIGRATION_ID}', '0.1.13-multi-device-m1-identity');
    `)
    let backupCalls = 0

    const applied = runDatabaseMigrations(db, {
      beforeMigrate: () => {
        backupCalls += 1
      }
    })

    expect(applied).toEqual([CURRENT_MIGRATION_ID])
    expect(backupCalls).toBe(1)
    expect(db.prepare('SELECT student_name FROM student_profile WHERE student_id = ?').get('s1'))
      .toMatchObject({ student_name: '旧学生' })
    expect(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='device'").get())
      .toMatchObject({ count: 1 })
    expect(db.prepare("SELECT COUNT(*) AS count FROM pragma_table_info('student_profile') WHERE name='user_id'").get())
      .toMatchObject({ count: 1 })
    assertCurrentDatabaseSchema(db)

    expect(runDatabaseMigrations(db)).toEqual([])
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
    ).toMatchObject({ schema_version: '0.1.13-multi-device-m1-identity' })
    assertCurrentDatabaseSchema(db)
    db.close()
  })
})
