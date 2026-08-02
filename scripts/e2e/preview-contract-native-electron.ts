import { createHash } from 'node:crypto'
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import Database from 'better-sqlite3'

import type { DBAdapter } from '../../src/main/db/interface'
import {
  assertExactEventBatchStructure,
  inspectEventBatchStructure
} from '../../src/main/db/event-batch-migration'
import {
  applyPreviewContractMigration,
  assertPreviewContractStructure,
  previewContractIntegrityIssues,
  previewContractMigrationState,
  PREVIEW_CONTRACT_INDEX_NAMES,
  PREVIEW_CONTRACT_TABLE_NAMES,
  PREVIEW_CONTRACT_TRIGGER_NAMES,
  PREVIEW_CONTRACT_SCHEMA_VERSION,
  promotePreviewContractReadyWithProvider
} from '../../src/main/db/preview-contract-migration'
import { PREVIEW_CONTRACT_MIGRATION_ID } from '../../src/shared/types/preview-contract'
import { previewContractReadiness } from '../../src/main/domain/preview/preview-ready-gate'

const root = mkdtempSync(join(tmpdir(), 'svets-preview-contract-native-'))
const dbPath = join(root, 'xc-career-guide.db')
const previewBackupPath = join(root, 'pre-preview-contract.db')
const previewBackupActionLogPath = join(root, 'pre-preview-contract.action_log.jsonl')
const actionLogPath = join(root, 'action_log.jsonl')
const rollbackPath = join(root, 'rollback-probe.db')

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function asAdapter(database: Database.Database): DBAdapter {
  return {
    prepare: database.prepare.bind(database),
    exec: database.exec.bind(database),
    transaction: (fn) => database.transaction(fn),
    immediateTransaction: (fn) => {
      const transaction = database.transaction(fn)
      return () => transaction.immediate()
    }
  } as unknown as DBAdapter
}

function schemaForNativeFixture(): string {
  const schema = readFileSync(resolve(process.cwd(), 'src/main/db/schema.sql'), 'utf8')
  assert(schema.includes('preview_contract_registry'), 'current schema is missing preview contract objects')
  assert(schema.includes('session_contract_kind'), 'current schema is missing preview session columns')
  return schema
}

function assertIntegrity(database: Database.Database, label: string): void {
  const integrity = database.prepare('PRAGMA integrity_check').pluck().get()
  assert(integrity === 'ok', `${label} integrity_check=${String(integrity)}`)
  const foreignKeys = database.prepare('PRAGMA foreign_key_check').all()
  assert(foreignKeys.length === 0, `${label} foreign_key_check=${foreignKeys.length}`)
}

function assertFileIntegrity(path: string, label: string): void {
  const database = new Database(path, { readonly: true })
  try {
    assertIntegrity(database, label)
  } finally {
    database.close()
  }
}

function assertPreviewState(database: Database.Database, expected: 'ABSENT' | 'CURRENT'): void {
  const adapter = asAdapter(database)
  assert(previewContractMigrationState(adapter) === expected, `unexpected preview migration state: ${previewContractMigrationState(adapter)}`)
  if (expected === 'CURRENT') {
    assertPreviewContractStructure(adapter)
    assert(previewContractIntegrityIssues(adapter).length === 0, 'preview contract integrity issues remain')
  }
}

function dropPreviewObjects(database: Database.Database): void {
  database.exec(`
    ${PREVIEW_CONTRACT_TRIGGER_NAMES.map((name) => `DROP TRIGGER IF EXISTS ${name};`).join('\n    ')}
    ${PREVIEW_CONTRACT_INDEX_NAMES.map((name) => `DROP INDEX IF EXISTS ${name};`).join('\n    ')}
    ${[...PREVIEW_CONTRACT_TABLE_NAMES].reverse().map((name) => `DROP TABLE IF EXISTS ${name};`).join('\n    ')}
    DELETE FROM schema_migration WHERE migration_id = '${PREVIEW_CONTRACT_MIGRATION_ID}';
  `)
}

type SqliteMasterObject = { name: string; sql: string }

const LEGACY_ASSESSMENT_SESSION_ID = 'native-legacy-assessment'
const LEGACY_BUSINESS_SESSION_ID = 'native-legacy-business-session'
const LEGACY_STUDENT_ID = 'native-legacy-student'
const LEGACY_USER_ID = 'native-legacy-teacher'
const LEGACY_STRATEGY_ID = 'native-legacy-strategy'

function quoteIdentifier(value: string): string {
  assert(/^[a-z_][a-z0-9_]*$/i.test(value), `unexpected SQLite identifier ${value}`)
  return `"${value}"`
}

function seedLegacyAssessment(database: Database.Database): void {
  database.exec(`
    INSERT INTO user_account (user_id, username, password_hash, role, display_name, status)
    VALUES ('${LEGACY_USER_ID}', 'native-legacy-teacher', 'native-hash', 'TEACHER', 'Native Legacy Teacher', 'ACTIVE');
    INSERT INTO student_profile (student_id, student_name, status)
    VALUES ('${LEGACY_STUDENT_ID}', 'Native Legacy Student', 'ACTIVE');
    INSERT INTO strategy_config (
      strategy_id, strategy_type, job_code, strategy_name,
      online_question_count, offline_question_count, max_score,
      question_policy_json, scoring_policy_json, version, is_active
    ) VALUES (
      '${LEGACY_STRATEGY_ID}', 'BASELINE_ASSESSMENT', 'SUPERMARKET_STOCKER',
      'Native Legacy Strategy', 1, 0, 1, '{}', '{}', 1, 1
    );
    INSERT INTO business_session (
      business_session_id, session_type, student_id, job_code, task_code, created_by
    ) VALUES (
      '${LEGACY_BUSINESS_SESSION_ID}', 'ASSESSMENT', '${LEGACY_STUDENT_ID}',
      'SUPERMARKET_STOCKER', 'UNBOX_AND_SHELF', '${LEGACY_USER_ID}'
    );
    INSERT INTO assessment_session (
      session_id, business_session_id, student_id, strategy_id, strategy_type,
      job_code, task_code, strategy_version, status, delivery_phase,
      online_question_count, offline_question_count, created_by
    ) VALUES (
      '${LEGACY_ASSESSMENT_SESSION_ID}', '${LEGACY_BUSINESS_SESSION_ID}', '${LEGACY_STUDENT_ID}',
      '${LEGACY_STRATEGY_ID}', 'BASELINE_ASSESSMENT', 'SUPERMARKET_STOCKER',
      'UNBOX_AND_SHELF', 1, 'INIT', 'PREPARED', 1, 0, '${LEGACY_USER_ID}'
    );
  `)
}

function buildLegacyAssessmentSessionSql(currentSql: string): string {
  let legacySql = currentSql
    .replace(
      /\s+session_contract_kind\s+TEXT\s+NOT NULL\s+DEFAULT\s+'FORMAL_SHELL'\s+CHECK\s*\(session_contract_kind\s+IN\s*\('FORMAL_SHELL',\s*'PREVIEW_SHELL'\)\),/i,
      ''
    )
    .replace(
      /\s+preview_contract_version\s+TEXT\s+CHECK\s*\(preview_contract_version\s+IS\s+NULL\s+OR\s+preview_contract_version\s*=\s*'PREVIEW_CONTRACT_V1'\),/i,
      ''
    )
    .replace(/\s+preview_redline_ref\s+TEXT,/i, '')
    .replace(
      /\n\s*CHECK\s*\(\s*status\s*<>\s*'REDLINE_HALTED'[\s\S]*?\n\s*\),\s*\n\s*CHECK\s*\(\s*session_contract_kind\s*=\s*'FORMAL_SHELL'[\s\S]*?\n\s*\),/i,
      `
  CHECK (
    status <> 'REDLINE_HALTED'
    OR (
      COALESCE(level_result, '') = 'LEVEL_FAIL_BY_SAFETY'
      AND redline_incident_id IS NOT NULL
      AND length(trim(redline_incident_id)) > 0
    )
  ),`
    )

  assert(!/session_contract_kind|preview_contract_version|preview_redline_ref/i.test(legacySql), 'legacy assessment fixture still contains preview columns')
  assert(/^CREATE TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+"?assessment_session"?\s*\(/i.test(legacySql), 'legacy assessment fixture table name was not recognized')
  return legacySql
}

function downgradeAssessmentSessionToLegacy(database: Database.Database): void {
  seedLegacyAssessment(database)
  const current = database.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'assessment_session'"
  ).get() as { sql?: string } | undefined
  assert(current?.sql, 'current assessment_session DDL is missing')
  const legacySql = buildLegacyAssessmentSessionSql(current.sql)
  const indexes = database.prepare(
    "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'assessment_session' AND sql IS NOT NULL ORDER BY name"
  ).all() as SqliteMasterObject[]
  const triggers = database.prepare(
    "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND sql IS NOT NULL AND lower(sql) LIKE '%assessment_session%' ORDER BY name"
  ).all() as SqliteMasterObject[]
  const legacyTriggers = triggers.filter(({ sql }) => !/session_contract_kind|preview_contract_version|preview_redline_ref|preview_session/i.test(sql))
  assert(legacyTriggers.some(({ name }) => name === 'trg_assessment_session_no_delete'), 'legacy assessment trigger fixture is incomplete')

  database.pragma('foreign_keys = OFF')
  try {
    const legacyColumns = (database.prepare('PRAGMA table_info(assessment_session)').all() as Array<{ name: string }>)
      .map(({ name }) => name)
      .filter((name) => !['session_contract_kind', 'preview_contract_version', 'preview_redline_ref'].includes(name))
      .map(quoteIdentifier)
    assert(legacyColumns.length > 0, 'legacy assessment fixture has no columns')
    database.exec(`
      CREATE TABLE assessment_session__legacy_data AS
      SELECT ${legacyColumns.join(', ')} FROM assessment_session;
      ${triggers.map(({ name }) => `DROP TRIGGER IF EXISTS ${quoteIdentifier(name)};`).join('\n      ')}
      DROP TABLE assessment_session;
      ${legacySql};
      INSERT INTO assessment_session (${legacyColumns.join(', ')})
      SELECT ${legacyColumns.join(', ')} FROM assessment_session__legacy_data;
      DROP TABLE assessment_session__legacy_data;
    `)
    for (const { sql } of indexes) database.exec(sql)
    for (const { sql } of legacyTriggers) database.exec(sql)
  } finally {
    database.pragma('foreign_keys = ON')
  }

  const legacyColumns = new Set((database.prepare('PRAGMA table_info(assessment_session)').all() as Array<{ name: string }>).map(({ name }) => name))
  assert(!legacyColumns.has('session_contract_kind'), 'legacy assessment fixture unexpectedly has session_contract_kind')
  assert(database.prepare('SELECT 1 FROM assessment_session WHERE session_id = ?').get(LEGACY_ASSESSMENT_SESSION_ID), 'legacy assessment row was not preserved')
}

function assertLegacyAssessmentRow(database: Database.Database, label: string): void {
  const row = database.prepare(
    'SELECT session_id, business_session_id, student_id, job_code, task_code, status FROM assessment_session WHERE session_id = ?'
  ).get(LEGACY_ASSESSMENT_SESSION_ID) as {
    session_id?: string
    business_session_id?: string
    student_id?: string
    job_code?: string
    task_code?: string
    status?: string
  } | undefined
  assert(row?.session_id === LEGACY_ASSESSMENT_SESSION_ID, `${label} legacy assessment row missing`)
  assert(row.business_session_id === LEGACY_BUSINESS_SESSION_ID, `${label} business_session_id drifted`)
  assert(row.student_id === LEGACY_STUDENT_ID, `${label} student_id drifted`)
  assert(row.job_code === 'SUPERMARKET_STOCKER', `${label} job_code drifted`)
  assert(row.task_code === 'UNBOX_AND_SHELF', `${label} task_code drifted`)
  assert(row.status === 'INIT', `${label} status drifted`)
}

function assertMigratedFormalAssessment(database: Database.Database, label: string): void {
  const row = database.prepare(
    'SELECT session_contract_kind, preview_contract_version, preview_redline_ref FROM assessment_session WHERE session_id = ?'
  ).get(LEGACY_ASSESSMENT_SESSION_ID) as {
    session_contract_kind?: string
    preview_contract_version?: string | null
    preview_redline_ref?: string | null
  } | undefined
  assert(row?.session_contract_kind === 'FORMAL_SHELL', `${label} session contract kind drifted`)
  assert(row.preview_contract_version == null, `${label} formal preview contract version was backfilled`)
  assert(row.preview_redline_ref == null, `${label} formal preview redline was backfilled`)
}

function assertPreviewRegistryStatus(database: Database.Database, status: 'INSTALLING' | 'READY'): void {
  const row = database.prepare(
    'SELECT status, schema_version, migration_id FROM preview_contract_registry WHERE registry_id = ?'
  ).get('PREVIEW_CONTRACT_V1') as { status?: string; schema_version?: string; migration_id?: string } | undefined
  assert(row?.status === status, `preview registry status is ${row?.status ?? 'missing'}, expected ${status}`)
  assert(row.schema_version === PREVIEW_CONTRACT_SCHEMA_VERSION, 'preview registry schema version drifted')
  assert(row.migration_id === PREVIEW_CONTRACT_MIGRATION_ID, 'preview registry migration id drifted')
}

function verifyNativeRollback(): void {
  copyFileSync(previewBackupPath, rollbackPath)
  const database = new Database(rollbackPath)
  try {
    database.pragma('foreign_keys = ON')
    const base = asAdapter(database)
    let injected = false
    const failingAdapter: DBAdapter = {
      ...base,
      exec(sql: string) {
        if (!injected && sql.includes('CREATE TABLE IF NOT EXISTS preview_contract_registry')) {
          injected = true
          base.exec(sql)
          throw new Error('injected native preview DDL failure')
        }
        base.exec(sql)
      }
    }

    let failed = false
    try {
      applyPreviewContractMigration(failingAdapter, {
        createVerifiedBackupBeforeDdl: () => undefined
      })
    } catch {
      failed = true
    }
    assert(failed && injected, 'native preview migration failure injection did not fire')
    assertExactEventBatchStructure(failingAdapter)
    assertPreviewState(database, 'ABSENT')
    assertLegacyAssessmentRow(database, 'native rollback probe')
    assertIntegrity(database, 'native rollback probe')
  } finally {
    database.close()
  }
}

try {
  const schema = schemaForNativeFixture()
  const database = new Database(dbPath)
  try {
    database.pragma('journal_mode = DELETE')
    database.pragma('foreign_keys = ON')
    database.exec(schema)
    dropPreviewObjects(database)
    downgradeAssessmentSessionToLegacy(database)
    writeFileSync(actionLogPath, '{"event":"preview-native-migration"}\n', 'utf8')

    const adapter = asAdapter(database)
    assert(inspectEventBatchStructure(adapter) === 'CURRENT', 'native predecessor is not exact M5B')
    assertExactEventBatchStructure(adapter)
    assertPreviewState(database, 'ABSENT')

    const beforeHash = sha256(dbPath)
    copyFileSync(dbPath, previewBackupPath)
    copyFileSync(actionLogPath, previewBackupActionLogPath)
    assert(sha256(previewBackupPath) === beforeHash, 'preview backup hash mismatch before DDL')
    assert(sha256(previewBackupActionLogPath) === sha256(actionLogPath), 'preview action-log backup hash mismatch')
    assertFileIntegrity(previewBackupPath, 'preview backup')

    let backupCallbackCalled = false
    const result = applyPreviewContractMigration(adapter, {
      createVerifiedBackupBeforeDdl: () => {
        backupCallbackCalled = true
        assert(sha256(previewBackupPath) === beforeHash, 'verified preview backup changed before DDL')
        assert(sha256(previewBackupActionLogPath) === sha256(actionLogPath), 'verified preview action-log backup changed before DDL')
      }
    })
    assert(result.source === 'EXACT_M5B' && result.applied, `unexpected preview migration result ${JSON.stringify(result)}`)
    assert(backupCallbackCalled, 'preview migration did not require a verified backup callback')
    assertPreviewState(database, 'CURRENT')
    assertPreviewRegistryStatus(database, 'INSTALLING')
    assertMigratedFormalAssessment(database, 'native preview migration')
    assert(new Set(database.prepare('PRAGMA table_info(assessment_session)').all().map((row) => (row as { name: string }).name)).has('session_contract_kind'), 'native preview migration lost session contract columns')

    promotePreviewContractReadyWithProvider(
      adapter,
      () => previewContractReadiness('READY'),
      '2026-08-02T00:00:00.000Z'
    )
    assertPreviewRegistryStatus(database, 'READY')
    assertIntegrity(database, 'native preview target')
  } finally {
    database.close()
  }

  verifyNativeRollback()

  const reopened = new Database(dbPath, { readonly: true })
  try {
    const adapter = asAdapter(reopened)
    assertExactEventBatchStructure(adapter)
    assertPreviewState(reopened, 'CURRENT')
    assertPreviewRegistryStatus(reopened, 'READY')
    assertMigratedFormalAssessment(reopened, 'reopened native preview target')
    assertIntegrity(reopened, 'reopened native preview target')
  } finally {
    reopened.close()
  }

  console.log('[db:preview:native:verify] PASS m5b-historical-assessment-preview=READY rollback=verified backup=verified')
} finally {
  rmSync(root, { recursive: true, force: true })
}
