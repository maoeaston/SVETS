import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { MemoryAdapter } from '../memory-adapter'
import {
  CURRENT_MIGRATION_ID,
  CURRENT_SCHEMA_VERSION,
  F4_SITTING_MIGRATION_ID,
  F6_SCORE_SCOPE_REQUIRED_MIGRATION_ID,
  F7_REPORT_FRAMEWORK_MIGRATION_ID,
  M1_MIGRATION_ID,
  M1_SCHEMA_VERSION,
  M2_MIGRATION_ID,
  M2_SCHEMA_VERSION,
  M4_SAFETY_REKEY_MIGRATION_ID,
  assertCurrentDatabaseSchema,
  assertPreF7DatabaseSchema,
  runDatabaseMigrations
} from '../migrations'
import { inspectM4SafetyRekeyStructure, m4SafetyRekeyObjectSql } from '../safety-rekey-migration'

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

function downgradeFreshSchemaToV016(db: MemoryAdapter): void {
  for (const sql of m4SafetyRekeyObjectSql('CURRENT_M4')) {
    const [, type, name] = sql.match(/CREATE (TRIGGER|(?:UNIQUE )?INDEX) ([a-z_]+)/i) ?? []
    db.exec(`DROP ${type.includes('INDEX') ? 'INDEX' : 'TRIGGER'} ${name};`)
  }
  for (const sql of m4SafetyRekeyObjectSql('LEGACY_V016')) db.exec(`${sql};`)
  db.prepare('DELETE FROM schema_migration WHERE migration_id = ?').run(M4_SAFETY_REKEY_MIGRATION_ID)
}

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

async function createMigratedM2Database(): Promise<MemoryAdapter> {
  const db = await MemoryAdapter.create()
  db.exec(V012_M2_COMPAT_SCHEMA)
  db.exec(`
    INSERT INTO user_account VALUES ('u1', 'teacher', 'hash', 'TEACHER', '教师', 'ACTIVE');
    INSERT INTO student_profile VALUES ('s1', '学生', 'ACTIVE');
    INSERT INTO assessment_session
      (session_id, student_id, strategy_id, strategy_type, job_code, task_code, strategy_version, status, current_question_id, created_by)
    VALUES ('a-m2', 's1', 'strategy-base', 'BASELINE_ASSESSMENT', 'SUPERMARKET_STOCKER', 'UNBOX_AND_SHELF', 1, 'INIT', NULL, 'u1');
    INSERT INTO training_session
      (training_session_id, student_id, job_code, task_code, strategy_version, status, created_by)
    VALUES ('t-m2', 's1', 'SUPERMARKET_STOCKER', 'UNBOX_AND_SHELF', 1, 'ACTIVE', 'u1');
  `)
  expect(runDatabaseMigrations(db, { throughMigrationId: M2_MIGRATION_ID }))
    .toEqual([M1_MIGRATION_ID, M2_MIGRATION_ID])
  return db
}

function schemaWithLegacyScoreScopeDefault(): string {
  const schema = readFileSync(resolve(process.cwd(), 'src/main/db/schema.sql'), 'utf8')
  const legacy = schema.replace(
    'score_scope               TEXT NOT NULL CHECK (score_scope IN (',
    "score_scope               TEXT NOT NULL DEFAULT 'OFFLINE_ABILITY' CHECK (score_scope IN ("
  )
  if (legacy === schema) {
    throw new Error('test fixture failed to add legacy score_scope default')
  }
  return legacy
}

function scoreScopeDefault(db: MemoryAdapter): string | null | undefined {
  const column = (db.prepare('PRAGMA table_info(offline_score_record)').all() as Array<{
    name: string
    dflt_value: string | null
  }>).find((row) => row.name === 'score_scope')
  return column?.dflt_value
}

describe('database migrations', () => {
  it('keeps the no-argument migration cap at F6 while an explicit M4 target is registered after F7', async () => {
    const db = await MemoryAdapter.create()
    db.exec(readFileSync(resolve(process.cwd(), 'src/main/db/schema.sql'), 'utf8'))
    downgradeFreshSchemaToV016(db)
    expect(inspectM4SafetyRekeyStructure(db)).toBe('LEGACY_V016')

    expect(runDatabaseMigrations(db)).toEqual([])
    expect(inspectM4SafetyRekeyStructure(db)).toBe('LEGACY_V016')
    expect(runDatabaseMigrations(db, { throughMigrationId: M4_SAFETY_REKEY_MIGRATION_ID }))
      .toEqual([M4_SAFETY_REKEY_MIGRATION_ID])
    expect(db.prepare('SELECT migration_id FROM schema_migration WHERE migration_id = ?').get(F7_REPORT_FRAMEWORK_MIGRATION_ID))
      .toMatchObject({ migration_id: F7_REPORT_FRAMEWORK_MIGRATION_ID })
    db.close()
  })
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

  it('migrates v0.1.12-shaped data through M1, M2, and M3 with backfill, triggers, and integrity gates', async () => {
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

    expect(applied).toEqual([M1_MIGRATION_ID, M2_MIGRATION_ID, CURRENT_MIGRATION_ID, F4_SITTING_MIGRATION_ID])
    expect(backupBatches).toEqual([[M1_MIGRATION_ID, M2_MIGRATION_ID, CURRENT_MIGRATION_ID, F4_SITTING_MIGRATION_ID]])
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
    ).toMatchObject({ count: 1 })
    expect(() => db.prepare("UPDATE assessment_session SET delivery_phase = 'ONLINE_IN_PROGRESS' WHERE session_id = 'a-init'").run())
      .toThrow('PREPARED can only advance to ASSIGNED')
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name IN ('delegated_access_grant', 'business_session_assignment')").get()
    ).toMatchObject({ count: 2 })
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name IN ('learning_session', 'command_log', 'offline_score_draft')").get()
    ).toMatchObject({ count: 0 })
    expectDatabaseIntegrity(db)
    assertPreF7DatabaseSchema(db)
    expect(runDatabaseMigrations(db)).toEqual([])
    db.close()
  })

  it('upgrades a complete v0.1.14 M2 database to M3 without changing existing session identity fields', async () => {
    const db = await createMigratedM2Database()
    const beforeAssessment = db
      .prepare(`
        SELECT session_id, business_session_id, student_id, job_code, task_code, status, delivery_phase
          FROM assessment_session
         ORDER BY session_id
      `)
      .all()
    const beforeTraining = db
      .prepare(`
        SELECT training_session_id, business_session_id, student_id, job_code, task_code, status
          FROM training_session
         ORDER BY training_session_id
      `)
      .all()
    const backupBatches: string[][] = []

    expect(runDatabaseMigrations(db, {
      beforeMigrate: (migrationIds) => backupBatches.push(migrationIds)
    })).toEqual([CURRENT_MIGRATION_ID, F4_SITTING_MIGRATION_ID])

    expect(backupBatches).toEqual([[CURRENT_MIGRATION_ID, F4_SITTING_MIGRATION_ID]])
    expect(db.prepare(`
      SELECT session_id, business_session_id, student_id, job_code, task_code, status, delivery_phase
        FROM assessment_session
       ORDER BY session_id
    `).all()).toEqual(beforeAssessment)
    expect(db.prepare(`
      SELECT training_session_id, business_session_id, student_id, job_code, task_code, status
        FROM training_session
       ORDER BY training_session_id
    `).all()).toEqual(beforeTraining)
    expect(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name IN ('delegated_access_grant', 'business_session_assignment')").get())
      .toMatchObject({ count: 2 })
    expect(() => db.prepare("UPDATE assessment_session SET delivery_phase = 'ONLINE_IN_PROGRESS' WHERE session_id = 'a-m2'").run())
      .toThrow('PREPARED can only advance to ASSIGNED')
    expectDatabaseIntegrity(db)
    assertPreF7DatabaseSchema(db)
    db.close()
  })

  it('preserves baseline assessment_session triggers across the M3 table rebuild', async () => {
    const db = await createMigratedM2Database()
    // 真实旧库的 assessment_session 上挂着基线 schema.sql 触发器（redline/safety/no_delete 等），
    // 这些不在 M2 白名单里。M3 为扩 delivery_phase CHECK 重建整表时必须原样保留它们。
    db.exec(`
      CREATE TRIGGER trg_assessment_session_no_delete
      BEFORE DELETE ON assessment_session
      FOR EACH ROW
      BEGIN
        SELECT RAISE(ABORT, 'assessment_session cannot be deleted');
      END;
      CREATE TRIGGER trg_assessment_session_no_terminal_status_change
      BEFORE UPDATE OF status ON assessment_session
      FOR EACH ROW
      WHEN OLD.status IN ('COMPLETED', 'REDLINE_HALTED', 'ABORTED')
           AND NEW.status <> OLD.status
      BEGIN
        SELECT RAISE(ABORT, 'assessment_session terminal status cannot be changed');
      END;
    `)

    expect(runDatabaseMigrations(db)).toEqual([CURRENT_MIGRATION_ID, F4_SITTING_MIGRATION_ID])

    expect(
      db.prepare(`
        SELECT COUNT(*) AS count FROM sqlite_master
         WHERE type = 'trigger'
           AND name IN ('trg_assessment_session_no_delete', 'trg_assessment_session_no_terminal_status_change')
      `).get()
    ).toMatchObject({ count: 2 })
    // 恢复后的触发器仍生效：删除被拒。
    expect(() => db.prepare("DELETE FROM assessment_session WHERE session_id = 'a-m2'").run())
      .toThrow('assessment_session cannot be deleted')
    expectDatabaseIntegrity(db)
    assertPreF7DatabaseSchema(db)
    db.close()
  })

  it('removes the legacy offline_score_record.score_scope default while preserving score rows', async () => {
    const db = await MemoryAdapter.create()
    db.exec(schemaWithLegacyScoreScopeDefault())
    expect(scoreScopeDefault(db)).toBe("'OFFLINE_ABILITY'")
    db.exec(`
      INSERT INTO user_account
        (user_id, username, password_hash, role, display_name, status)
      VALUES ('u-f6', 'teacher-f6', 'hash', 'TEACHER', '教师F6', 'ACTIVE');
      INSERT INTO student_profile (student_id, student_name, status)
      VALUES ('s-f6', '学生F6', 'ACTIVE');
      INSERT INTO question_bank
        (question_id, job_code, bank_domain, module_type, question_type,
         item_usage, difficulty_level, content_json, scoring_rule_json, status)
      VALUES ('q-f6', 'SUPERMARKET_SHELVER', 'BASE_ABILITY', 'FINE_MOTOR',
              'OFFLINE_OPERATION', 'SCORED_ITEM', 1, '{}', '{}', 'ACTIVE');
      INSERT INTO business_session
        (business_session_id, session_type, student_id, job_code, task_code, created_by)
      VALUES ('bs-f6', 'ASSESSMENT', 's-f6', 'SUPERMARKET_SHELVER', 'UNBOX_AND_SHELF', 'u-f6');
      INSERT INTO assessment_session
        (session_id, business_session_id, student_id, strategy_id, strategy_type,
         job_code, task_code, strategy_version, status, delivery_phase,
         online_question_count, offline_question_count, created_by)
      VALUES ('a-f6', 'bs-f6', 's-f6', 'strategy_baseline_shelver_v1',
              'BASELINE_ASSESSMENT', 'SUPERMARKET_SHELVER', 'UNBOX_AND_SHELF',
              1, 'OFFLINE_PENDING', 'PREPARED', 42, 8, 'u-f6');
      INSERT INTO domain_event_projection
        (event_id, aggregate_type, aggregate_id, event_type, event_sequence,
         payload_json, checksum, source_log_path)
      VALUES ('ev-f6', 'ASSESSMENT_SESSION', 'a-f6', 'OFFLINE_SCORE_SUBMITTED',
              1, '{}', 'c-f6', 'log');
      INSERT INTO offline_score_record
        (offline_score_id, session_id, question_id, score_scope, score,
         scoring_rubric_json, scored_by, scored_event_id)
      VALUES ('os-f6', 'a-f6', 'q-f6', 'OFFLINE_ABILITY', 2, '{}', 'u-f6', 'ev-f6');
    `)
    const before = db
      .prepare(
        `SELECT offline_score_id, session_id, question_id, score_scope, score,
                scoring_rubric_json, scored_by, scored_event_id
           FROM offline_score_record
          WHERE offline_score_id = 'os-f6'`
      )
      .get()

    expect(runDatabaseMigrations(db)).toEqual([F6_SCORE_SCOPE_REQUIRED_MIGRATION_ID])

    expect(scoreScopeDefault(db)).toBeNull()
    expect(
      db.prepare(
        `SELECT offline_score_id, session_id, question_id, score_scope, score,
                scoring_rubric_json, scored_by, scored_event_id
           FROM offline_score_record
          WHERE offline_score_id = 'os-f6'`
      ).get()
    ).toEqual(before)
    expect(
      db.prepare(`
        SELECT COUNT(*) AS count
          FROM sqlite_master
         WHERE type = 'index'
           AND name IN (
             'idx_offline_score_session_question',
             'ux_offline_score_one_valid_score',
             'ux_offline_score_one_valid_task_operation'
           )
      `).get()
    ).toMatchObject({ count: 3 })
    expect(() => {
      db.prepare(
        `INSERT INTO offline_score_record
           (offline_score_id, session_id, question_id, score, scoring_rubric_json,
            scored_by, scored_event_id)
         VALUES ('os-f6-missing-scope', 'a-f6', 'q-f6', 2, '{}', 'u-f6', 'ev-f6')`
      ).run()
    }).toThrow()
    expectDatabaseIntegrity(db)
    assertCurrentDatabaseSchema(db)
    db.close()
  })

  it('keeps external triggers whose body references assessment_session pointing at the rebuilt table', async () => {
    const db = await createMigratedM2Database()
    // 真实旧库里有定义在别的表、但 body 引用 assessment_session 的触发器
    // （如 trg_safety_incident_bind_open_assessments）。M3 重建整表时用 ALTER TABLE
    // RENAME；默认 legacy_alter_table=OFF 会把这类外部触发器 body 里的表名一起改写成
    // 临时旧表名，旧表 DROP 后触发器悬空、后续写入报 "no such table"。
    db.exec(`
      CREATE TABLE probe_source (probe_id TEXT PRIMARY KEY, student_id TEXT NOT NULL);
      CREATE TABLE probe_hit (probe_id TEXT PRIMARY KEY);
      CREATE TRIGGER trg_probe_touch_assessment
      AFTER INSERT ON probe_source
      FOR EACH ROW
      BEGIN
        INSERT INTO probe_hit (probe_id)
        SELECT NEW.probe_id FROM assessment_session s WHERE s.student_id = NEW.student_id LIMIT 1;
      END;
    `)

    expect(runDatabaseMigrations(db)).toEqual([CURRENT_MIGRATION_ID, F4_SITTING_MIGRATION_ID])

    // 触发器 body 仍应引用真实表名，不带临时后缀。
    const triggerSql = db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'trg_probe_touch_assessment'")
      .get() as { sql: string } | undefined
    expect(triggerSql?.sql).toContain('FROM assessment_session s')
    expect(triggerSql?.sql).not.toContain('__m3_')
    // 外部触发器仍能对重建后的表正常执行，不再报 no such table。
    expect(() => db.prepare("INSERT INTO probe_source (probe_id, student_id) VALUES ('p1', 's1')").run()).not.toThrow()
    expect(db.prepare("SELECT COUNT(*) AS count FROM probe_hit WHERE probe_id = 'p1'").get())
      .toMatchObject({ count: 1 })
    expectDatabaseIntegrity(db)
    assertPreF7DatabaseSchema(db)
    db.close()
  })

  it('records a missing M3 ledger row only when the full M3 structure is already present and valid', async () => {
    const db = await MemoryAdapter.create()
    const schema = readFileSync(resolve(process.cwd(), 'src/main/db/schema.sql'), 'utf8')
    db.exec(schema)
    db.prepare('DELETE FROM schema_migration WHERE migration_id = ?').run(CURRENT_MIGRATION_ID)

    expect(runDatabaseMigrations(db)).toEqual([])
    expect(
      db.prepare('SELECT schema_version FROM schema_migration WHERE migration_id = ?').get(CURRENT_MIGRATION_ID)
    ).toMatchObject({ schema_version: CURRENT_SCHEMA_VERSION })
    db.close()
  })

  it('rejects partial or drifted M3 objects without recording the M3 migration', async () => {
    const db = await createMigratedM2Database()
    db.exec(`
      CREATE TRIGGER trg_assessment_delivery_phase_forward_only
      BEFORE UPDATE OF delivery_phase ON assessment_session
      BEGIN SELECT 1; END;
    `)

    expect(() => runDatabaseMigrations(db)).toThrow('Existing M3 trigger drift')
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM schema_migration WHERE migration_id = ?').get(CURRENT_MIGRATION_ID)
    ).toMatchObject({ count: 0 })
    expect(() => db.prepare("UPDATE assessment_session SET delivery_phase = 'ONLINE_IN_PROGRESS' WHERE session_id = 'a-m2'").run())
      .not.toThrow()
    db.close()

    const partialDb = await createMigratedM2Database()
    partialDb.exec('CREATE TABLE delegated_access_grant (grant_id TEXT PRIMARY KEY);')
    expect(() => runDatabaseMigrations(partialDb)).toThrow('partial M3')
    expect(
      partialDb.prepare('SELECT COUNT(*) AS count FROM schema_migration WHERE migration_id = ?').get(CURRENT_MIGRATION_ID)
    ).toMatchObject({ count: 0 })
    partialDb.close()
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
    expect(
      db.prepare('SELECT schema_version FROM schema_migration WHERE migration_id = ?').get(M2_MIGRATION_ID)
    ).toMatchObject({ schema_version: M2_SCHEMA_VERSION })
    expect(
      db.prepare('SELECT schema_version FROM schema_migration WHERE migration_id = ?').get(F4_SITTING_MIGRATION_ID)
    ).toMatchObject({ schema_version: CURRENT_SCHEMA_VERSION })
    expectDatabaseIntegrity(db)
    assertCurrentDatabaseSchema(db)
    db.close()
  })
})
