import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import type { DBAdapter } from '../../src/main/db/interface'
import {
  M4_SAFETY_REKEY_MIGRATION_ID,
  assertCurrentDatabaseSchema
} from '../../src/main/db/migrations'
import { createVerifiedMigrationBackup } from '../../src/main/db/migration-backup'
import { orchestrateDatabaseStartupUpgrade } from '../../src/main/db/migration-startup'
import { inspectM4SafetyRekeyStructure } from '../../src/main/db/safety-rekey-migration'

const PROJECT_ROOT = resolve(process.cwd())
const SCHEMA = readFileSync(resolve(PROJECT_ROOT, 'src/main/db/schema.sql'), 'utf8')
const V016_SAFETY_OBJECTS = readFileSync(
  resolve(PROJECT_ROOT, 'src/main/db/__tests__/fixtures/m4-v016-safety-objects.sql'),
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

type NativeDatabase = InstanceType<typeof Database>

function asAdapter(database: NativeDatabase): DBAdapter {
  return database as unknown as DBAdapter
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`
}

function canonicalBusinessHash(database: NativeDatabase): string {
  const tables = database.prepare(`
    SELECT name
      FROM sqlite_master
     WHERE type = 'table'
       AND name NOT LIKE 'sqlite_%'
       AND name <> 'schema_migration'
     ORDER BY name
  `).all() as Array<{ name: string }>
  const hash = createHash('sha256')

  for (const { name } of tables) {
    const columns = database.prepare(`PRAGMA table_info(${quoteIdentifier(name)})`).all() as Array<{ name: string }>
    const orderBy = columns.map((column) => quoteIdentifier(column.name)).join(', ')
    const rows = database.prepare(`SELECT * FROM ${quoteIdentifier(name)} ORDER BY ${orderBy}`).all()
    hash.update(JSON.stringify({ name, rows }))
    hash.update('\n')
  }
  return hash.digest('hex')
}

function integrityCheck(database: NativeDatabase): void {
  const foreignKeys = database.prepare('PRAGMA foreign_key_check').all()
  if (foreignKeys.length !== 0) throw new Error(`foreign_key_check failed: ${JSON.stringify(foreignKeys)}`)
  const rows = database.prepare('PRAGMA integrity_check').all() as Array<Record<string, string>>
  if (rows.map((row) => Object.values(row)[0]).join(',') !== 'ok') {
    throw new Error(`integrity_check failed: ${JSON.stringify(rows)}`)
  }
}

function createDatabase(path: string): NativeDatabase {
  mkdirSync(dirname(path), { recursive: true })
  const database = new Database(path)
  database.pragma('journal_mode = DELETE')
  database.pragma('foreign_keys = ON')
  return database
}

function installLegacyV016SafetyObjects(database: NativeDatabase): void {
  for (const [type, name] of CURRENT_M4_OBJECTS) database.exec(`DROP ${type.toUpperCase()} ${quoteIdentifier(name)};`)
  database.exec(V016_SAFETY_OBJECTS)
  database.prepare('DELETE FROM schema_migration WHERE migration_id = ?').run(M4_SAFETY_REKEY_MIGRATION_ID)
}

function seedHistoricalBusinessRows(database: NativeDatabase): void {
  database.exec(`
    INSERT INTO user_account (user_id, username, password_hash, role, display_name, status)
    VALUES ('native-teacher', 'native-teacher', 'hash', 'TEACHER', 'Native Teacher', 'ACTIVE');
    INSERT INTO student_profile (student_id, student_name, status)
    VALUES ('native-student', 'Native Student', 'ACTIVE');
    INSERT INTO business_session (business_session_id, session_type, student_id, job_code, task_code, created_by)
    VALUES
      ('native-business-assessment', 'ASSESSMENT', 'native-student', 'SUPERMARKET_SHELVER', 'UNBOX_AND_SHELF', 'native-teacher'),
      ('native-business-training', 'TRAINING', 'native-student', 'SUPERMARKET_SHELVER', 'UNBOX_AND_SHELF', 'native-teacher');
    INSERT INTO assessment_session
      (session_id, business_session_id, student_id, strategy_id, strategy_type, job_code, task_code, strategy_version,
       status, delivery_phase, online_question_count, offline_question_count, created_by)
    VALUES
      ('native-assessment', 'native-business-assessment', 'native-student', 'strategy_baseline_shelver_v1',
       'BASELINE_ASSESSMENT', 'SUPERMARKET_SHELVER', 'UNBOX_AND_SHELF', 1, 'ACTIVE', 'PREPARED', 0, 0,
       'native-teacher');
    INSERT INTO training_session
      (training_session_id, business_session_id, student_id, job_code, task_code, strategy_id, strategy_type,
       strategy_version, status, total_step_count, created_by)
    VALUES
      ('native-training', 'native-business-training', 'native-student', 'SUPERMARKET_SHELVER', 'UNBOX_AND_SHELF',
       'strategy_training_shelver_v1', 'TRAINING_PRACTICE', 1, 'ACTIVE', 0, 'native-teacher');
    INSERT INTO domain_event_projection
      (event_id, aggregate_type, aggregate_id, event_type, event_sequence, payload_json, checksum, source_log_path)
    VALUES
      ('native-event-incident', 'SAFETY_INCIDENT', 'native-incident', 'SAFETY_INCIDENT_CREATED', 1, '{}', 'checksum-incident', 'native-action-log'),
      ('native-event-result', 'SYSTEM', 'native-result', 'RESULT_GENERATED', 1, '{}', 'checksum-result', 'native-action-log'),
      ('native-event-report', 'TASK_REPORT', 'native-report', 'REPORT_GENERATED', 1, '{}', 'checksum-report', 'native-action-log');
    INSERT INTO safety_incident
      (incident_id, student_id, job_code, task_code, trigger_event_id, reason_code, triggered_by, context_phase, status)
    VALUES
      ('native-incident', 'native-student', 'SUPERMARKET_SHELVER', 'UNBOX_AND_SHELF', 'native-event-incident',
       'BLADE_TOWARD_SELF', 'native-teacher', 'OTHER', 'PENDING_DETAIL');
    INSERT INTO result_record
      (result_id, student_id, result_type, source_aggregate_type, source_aggregate_id, strategy_id, strategy_type,
       job_code, normalized_score, level_result, safety_overridden, redline_incident_id, generated_event_id)
    VALUES
      ('native-result', 'native-student', 'ABILITY_SCORE', 'ASSESSMENT_SESSION', 'native-assessment',
       'strategy_baseline_shelver_v1', 'BASELINE_ASSESSMENT', 'SUPERMARKET_SHELVER', 0, 'LEVEL_FAIL_BY_SAFETY',
       1, 'native-incident', 'native-event-result');
    INSERT INTO task_report
      (report_id, report_type, student_id, source_aggregate_type, source_aggregate_id, report_title,
       report_content_json, generated_event_id, generated_by, generated_at, status)
    VALUES
      ('native-report', 'SAFETY_TERMINATION_REPORT', 'native-student', 'SAFETY_INCIDENT', 'native-incident',
       'Native safety report', '{"source":"native-m4"}', 'native-event-report', 'native-teacher',
       '2026-07-28T00:00:00.000Z', 'GENERATED');
  `)
}

function createLegacyDatabase(path: string): NativeDatabase {
  const database = createDatabase(path)
  database.exec(SCHEMA)
  installLegacyV016SafetyObjects(database)
  seedHistoricalBusinessRows(database)
  integrityCheck(database)
  return database
}

function assertPlanUsesIndex(database: NativeDatabase, sql: string, indexName: string): void {
  const plan = database.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as Array<{ detail: string }>
  if (!plan.some((row) => row.detail.includes(indexName))) {
    throw new Error(`query plan did not use ${indexName}: ${JSON.stringify(plan)}`)
  }
}

function assertCurrentSchema(database: NativeDatabase): void {
  if (inspectM4SafetyRekeyStructure(asAdapter(database)) !== 'CURRENT_M4') {
    throw new Error('M4 migration did not produce current three-key safety objects')
  }
  assertCurrentDatabaseSchema(asAdapter(database))
  integrityCheck(database)
}

function executeFreshScenario(root: string): void {
  const dbPath = join(root, 'fresh', 'xc-career-guide.db')
  const database = createDatabase(dbPath)
  try {
    database.exec(SCHEMA)
    assertCurrentSchema(database)
  } finally {
    database.close()
  }
}

function executeUpgradeAndBackupScenario(root: string): void {
  const dataDir = join(root, 'upgrade')
  const dbPath = join(dataDir, 'xc-career-guide.db')
  const actionLogPath = join(dataDir, 'action_log.jsonl')
  const database = createLegacyDatabase(dbPath)
  writeFileSync(actionLogPath, '{"event":"native-m4-history"}\n', 'utf8')
  const beforeBusinessHash = canonicalBusinessHash(database)
  const beforeActionLogHash = sha256File(actionLogPath)
  let backupDir = ''
  let backupManifestPath = ''

  try {
    const migrated = orchestrateDatabaseStartupUpgrade(asAdapter(database), {
      preReconcileF7: () => {
        throw new Error('F7 reconciliation must not run when F7 is already complete')
      },
      createVerifiedBackup: (stage, migrationId) => {
        if (stage !== 'M4' || migrationId !== M4_SAFETY_REKEY_MIGRATION_ID) {
          throw new Error(`unexpected backup stage: ${stage}:${migrationId}`)
        }
        const backup = createVerifiedMigrationBackup({
          source: {
            checkpointFull: () => database.pragma('wal_checkpoint(FULL)'),
            vacuumInto: (path) => database.exec(`VACUUM INTO '${path.replace(/'/g, "''")}'`),
            verifyBackup: (path) => {
              const backupDatabase = new Database(path, { readonly: true })
              try {
                integrityCheck(backupDatabase)
              } finally {
                backupDatabase.close()
              }
            }
          },
          dataDir,
          actionLogPath,
          stage,
          migrationId,
          now: new Date('2026-07-28T00:00:00.000Z')
        })
        backupDir = backup.backupDir
        backupManifestPath = backup.manifestPath
      }
    })

    if (migrated.length !== 1 || migrated[0] !== M4_SAFETY_REKEY_MIGRATION_ID) {
      throw new Error(`unexpected migration result: ${JSON.stringify(migrated)}`)
    }
    assertCurrentSchema(database)
    if (canonicalBusinessHash(database) !== beforeBusinessHash) {
      throw new Error('M4 migration changed canonical business rows')
    }
    if (sha256File(actionLogPath) !== beforeActionLogHash) {
      throw new Error('M4 migration changed source action-log bytes')
    }

    assertPlanUsesIndex(
      database,
      "SELECT session_id FROM assessment_session WHERE student_id = 'native-student' AND job_code = 'SUPERMARKET_SHELVER' AND task_code = 'UNBOX_AND_SHELF' AND status = 'REDLINE_HALTED'",
      'idx_assessment_session_student_job_task_status'
    )
    assertPlanUsesIndex(
      database,
      "SELECT training_session_id FROM training_session WHERE student_id = 'native-student' AND job_code = 'SUPERMARKET_SHELVER' AND task_code = 'UNBOX_AND_SHELF' AND status = 'REDLINE_HALTED'",
      'idx_training_session_student_job_task_status'
    )
    assertPlanUsesIndex(
      database,
      "SELECT incident_id FROM safety_incident WHERE student_id = 'native-student' AND job_code = 'SUPERMARKET_SHELVER' AND task_code = 'UNBOX_AND_SHELF' AND status = 'PENDING_DETAIL' AND requires_review_before_next_session = 1",
      'idx_safety_incident_student_job_task_status'
    )

    const manifest = JSON.parse(readFileSync(backupManifestPath, 'utf8')) as {
      stage: string
      migration_id: string
      database: { sha256: string }
      action_log: { status: string; sha256: string | null }
    }
    if (manifest.stage !== 'M4' || manifest.migration_id !== M4_SAFETY_REKEY_MIGRATION_ID) {
      throw new Error(`unexpected backup manifest: ${JSON.stringify(manifest)}`)
    }
    const backupDatabasePath = join(backupDir, 'xc-career-guide.db')
    const backupActionLogPath = join(backupDir, 'action_log.jsonl')
    if (sha256File(backupDatabasePath) !== manifest.database.sha256 ||
      manifest.action_log.status !== 'PRESENT' ||
      sha256File(backupActionLogPath) !== manifest.action_log.sha256) {
      throw new Error('paired M4 backup manifest hash mismatch')
    }

    const restoreDir = join(root, 'isolated-restore')
    const restoreDatabasePath = join(restoreDir, basename(backupDatabasePath))
    const restoreActionLogPath = join(restoreDir, basename(backupActionLogPath))
    mkdirSync(restoreDir, { recursive: true })
    copyFileSync(backupDatabasePath, restoreDatabasePath)
    copyFileSync(backupActionLogPath, restoreActionLogPath)
    const restored = new Database(restoreDatabasePath, { readonly: true })
    try {
      integrityCheck(restored)
      if (inspectM4SafetyRekeyStructure(asAdapter(restored)) !== 'LEGACY_V016') {
        throw new Error('isolated M4 companion backup did not retain the pre-migration v0.1.16 structure')
      }
    } finally {
      restored.close()
    }
    if (sha256File(restoreActionLogPath) !== beforeActionLogHash) {
      throw new Error('isolated restore action log does not match source history')
    }
  } finally {
    database.close()
  }
}

function executePreflightFailureScenario(root: string): void {
  const dataDir = join(root, 'preflight-failure')
  const dbPath = join(dataDir, 'xc-career-guide.db')
  const actionLogPath = join(dataDir, 'action_log.jsonl')
  const database = createLegacyDatabase(dbPath)
  writeFileSync(actionLogPath, '{"event":"must-not-change"}\n', 'utf8')
  database.prepare("UPDATE safety_incident SET job_code = ' ' WHERE incident_id = 'native-incident'").run()
  database.close()

  const sourceHashBefore = sha256File(dbPath)
  const actionLogHashBefore = sha256File(actionLogPath)
  const reopened = createDatabase(dbPath)
  let backupCalls = 0
  let migrationCalls = 0
  try {
    let failed = false
    try {
      orchestrateDatabaseStartupUpgrade(asAdapter(reopened), {
        preReconcileF7: () => {
          throw new Error('F7 reconciliation must not run in M4 preflight failure scenario')
        },
        createVerifiedBackup: () => {
          backupCalls += 1
        },
        runMigrations: () => {
          migrationCalls += 1
          return []
        }
      })
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('M4 database startup preparation failed safely')) throw error
      failed = true
    }
    if (!failed || backupCalls !== 0 || migrationCalls !== 0) {
      throw new Error(`preflight failure reached backup or migration: ${JSON.stringify({ failed, backupCalls, migrationCalls })}`)
    }
  } finally {
    reopened.close()
  }

  if (sha256File(dbPath) !== sourceHashBefore || sha256File(actionLogPath) !== actionLogHashBefore) {
    throw new Error('preflight failure changed source DB or action-log bytes')
  }
}

function main(): void {
  const root = mkdtempSync(join(tmpdir(), 'svets-m4-native-electron-'))
  try {
    executeFreshScenario(root)
    executeUpgradeAndBackupScenario(root)
    executePreflightFailureScenario(root)
    const runtimeDatabase = new Database(':memory:')
    const sqliteVersion = runtimeDatabase.prepare('SELECT sqlite_version() AS version').get()
    runtimeDatabase.close()
    console.log(JSON.stringify({
      status: 'PASS',
      runtime: {
        electron: process.versions.electron,
        nodeModuleAbi: process.versions.modules,
        sqlite: sqliteVersion
      },
      temporaryPathType: 'mkdtemp(/tmp/svets-m4-native-electron-*)',
      checks: [
        'fresh schema with current M4 objects and ledger',
        'v0.1.16 to M4 actual migration with business/action-log hash preservation',
        'foreign_key_check, integrity_check, and three EXPLAIN QUERY PLAN index assertions',
        'M4 paired backup manifest/hash and isolated restore',
        'preflight failure preserves source DB/action-log and reaches neither backup nor migration'
      ]
    }))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

main()
