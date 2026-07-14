import type { DBAdapter } from './interface'

export const CURRENT_SCHEMA_VERSION = '0.1.13-multi-device-m1-identity'
export const CURRENT_MIGRATION_ID = '2026-07-14_mvp_schema_v0_1_13_multi_device_m1_identity'

type MigrationOptions = {
  beforeMigrate?: (migrationIds: string[]) => void
}

type Migration = {
  id: string
  version: string
  description: string
  isStructurallyApplied: (database: DBAdapter) => boolean
  up: (database: DBAdapter) => void
}

const REQUIRED_V012_COLUMNS: Record<string, string[]> = {
  student_profile: ['student_id', 'student_name', 'status'],
  question_bank: ['question_id', 'bank_domain', 'item_usage', 'job_module_code'],
  assessment_session: ['session_id', 'strategy_type'],
  assessment_session_question: [
    'session_question_id',
    'bank_domain',
    'job_module_code',
    'item_usage',
    'question_phase'
  ],
  answer_record: ['answer_id', 'response_status'],
  offline_score_record: [
    'offline_score_id',
    'score_scope',
    'response_status',
    'observation_payload_json'
  ],
  result_record: ['result_id', 'result_type', 'strategy_type']
}

const M1_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS organization (
  organization_id  TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  type             TEXT NOT NULL DEFAULT 'SCHOOL'
                    CHECK (type IN ('SCHOOL', 'CENTER', 'DISTRICT')),
  status           TEXT NOT NULL DEFAULT 'ACTIVE'
                    CHECK (status IN ('ACTIVE', 'DISABLED', 'ARCHIVED')),
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS node (
  node_id          TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL REFERENCES organization(organization_id),
  node_name        TEXT NOT NULL,
  node_type        TEXT NOT NULL DEFAULT 'ELECTRON_KIOSK'
                    CHECK (node_type IN ('ELECTRON_KIOSK', 'STANDALONE_SERVER', 'CLOUD')),
  installed_at     TEXT NOT NULL DEFAULT (datetime('now')),
  app_version      TEXT,
  schema_version   TEXT,
  status           TEXT NOT NULL DEFAULT 'ACTIVE'
                    CHECK (status IN ('ACTIVE', 'DISABLED', 'DECOMMISSIONED')),
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS device (
  device_id          TEXT PRIMARY KEY,
  node_id            TEXT NOT NULL REFERENCES node(node_id),
  device_name        TEXT NOT NULL,
  device_role        TEXT NOT NULL
                      CHECK (device_role IN ('STUDENT_WORKSTATION', 'TEACHER_TABLET',
                                             'ADMIN_TERMINAL', 'HYBRID')),
  credential_hash    TEXT,
  trust_state        TEXT NOT NULL DEFAULT 'PENDING'
                      CHECK (trust_state IN ('PENDING', 'TRUSTED', 'REVOKED')),
  is_kiosk_enabled   INTEGER NOT NULL DEFAULT 0 CHECK (is_kiosk_enabled IN (0, 1)),
  allows_self_login  INTEGER NOT NULL DEFAULT 1 CHECK (allows_self_login IN (0, 1)),
  capabilities_json  TEXT CHECK (capabilities_json IS NULL OR json_valid(capabilities_json)),
  last_heartbeat_at  TEXT,
  status             TEXT NOT NULL DEFAULT 'ACTIVE'
                      CHECK (status IN ('ACTIVE', 'DISABLED', 'DECOMMISSIONED')),
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS device_runtime_session (
  device_runtime_session_id TEXT PRIMARY KEY,
  device_id                 TEXT NOT NULL REFERENCES device(device_id),
  started_at                TEXT NOT NULL DEFAULT (datetime('now')),
  last_heartbeat_at         TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at                  TEXT,
  end_reason                TEXT CHECK (end_reason IS NULL OR end_reason IN (
                              'HEARTBEAT_TIMEOUT', 'GRACEFUL_SHUTDOWN', 'ADMIN_TERMINATED', 'REPLACED')),
  client_version            TEXT,
  status                    TEXT NOT NULL DEFAULT 'ACTIVE'
                             CHECK (status IN ('ACTIVE', 'ENDED')),
  created_at                TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_device_one_active_runtime
  ON device_runtime_session(device_id) WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS auth_session (
  auth_session_id           TEXT PRIMARY KEY,
  user_id                   TEXT NOT NULL REFERENCES user_account(user_id),
  device_runtime_session_id TEXT REFERENCES device_runtime_session(device_runtime_session_id),
  auth_method               TEXT NOT NULL CHECK (auth_method IN (
                              'PASSWORD', 'DELEGATED', 'PIN', 'DEVICE_KEY')),
  granted_by                TEXT REFERENCES user_account(user_id),
  capabilities_json         TEXT NOT NULL DEFAULT '[]'
                             CHECK (json_valid(capabilities_json)),
  token_hash                TEXT NOT NULL UNIQUE,
  refresh_token_hash        TEXT UNIQUE,
  issued_at                 TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at                TEXT NOT NULL,
  last_activity_at          TEXT NOT NULL DEFAULT (datetime('now')),
  status                    TEXT NOT NULL DEFAULT 'ACTIVE'
                             CHECK (status IN ('ACTIVE', 'EXPIRED', 'REVOKED')),
  revoke_reason             TEXT,
  created_at                TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_auth_session_user_status
  ON auth_session(user_id, status);

CREATE INDEX IF NOT EXISTS idx_auth_session_token
  ON auth_session(token_hash);

CREATE UNIQUE INDEX IF NOT EXISTS ux_student_profile_user_id
  ON student_profile(user_id) WHERE user_id IS NOT NULL;
`

function tableExists(database: DBAdapter, tableName: string): boolean {
  const row = database
    .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { present: number } | undefined
  return row?.present === 1
}

function indexExists(database: DBAdapter, indexName: string): boolean {
  const row = database
    .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'index' AND name = ?")
    .get(indexName) as { present: number } | undefined
  return row?.present === 1
}

function columnNames(database: DBAdapter, tableName: string): Set<string> {
  if (!/^[a-z_]+$/.test(tableName)) throw new Error(`[DB] Invalid table identifier: ${tableName}`)
  const rows = database.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>
  return new Set(rows.map((row) => row.name))
}

function missingV012BaselineParts(database: DBAdapter): string[] {
  const missing: string[] = []
  for (const [tableName, requiredColumns] of Object.entries(REQUIRED_V012_COLUMNS)) {
    if (!tableExists(database, tableName)) {
      missing.push(`table:${tableName}`)
      continue
    }
    const columns = columnNames(database, tableName)
    for (const column of requiredColumns) {
      if (!columns.has(column)) missing.push(`column:${tableName}.${column}`)
    }
  }
  return missing
}

function isM1StructurallyApplied(database: DBAdapter): boolean {
  const profileColumns = tableExists(database, 'student_profile')
    ? columnNames(database, 'student_profile')
    : new Set<string>()
  const requiredTables = [
    'organization',
    'node',
    'device',
    'device_runtime_session',
    'auth_session'
  ]
  const requiredIndexes = [
    'ux_device_one_active_runtime',
    'idx_auth_session_user_status',
    'idx_auth_session_token',
    'ux_student_profile_user_id'
  ]
  return (
    profileColumns.has('user_id') &&
    requiredTables.every((tableName) => tableExists(database, tableName)) &&
    requiredIndexes.every((indexName) => indexExists(database, indexName))
  )
}

const migrations: Migration[] = [
  {
    id: CURRENT_MIGRATION_ID,
    version: CURRENT_SCHEMA_VERSION,
    description:
      'M1: identity+topology tables and student_profile.user_id; structure-verified migration',
    isStructurallyApplied: isM1StructurallyApplied,
    up: (database) => {
      if (!columnNames(database, 'student_profile').has('user_id')) {
        database.exec(
          'ALTER TABLE student_profile ADD COLUMN user_id TEXT REFERENCES user_account(user_id) ON DELETE SET NULL;'
        )
      }
      database.exec(M1_TABLE_SQL)
    }
  }
]

function ensureMigrationTable(database: DBAdapter): void {
  database.exec(`
CREATE TABLE IF NOT EXISTS schema_migration (
  migration_id       TEXT PRIMARY KEY,
  schema_version     TEXT NOT NULL,
  description        TEXT,
  applied_at         TEXT NOT NULL DEFAULT (datetime('now'))
);`)
}

function recordMigration(database: DBAdapter, migration: Migration): void {
  database
    .prepare(`
      INSERT INTO schema_migration (migration_id, schema_version, description, applied_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(migration_id) DO UPDATE SET
        schema_version = excluded.schema_version,
        description = excluded.description,
        applied_at = excluded.applied_at
    `)
    .run(migration.id, migration.version, migration.description)
}

export function isFreshDatabase(database: DBAdapter): boolean {
  return !tableExists(database, 'user_account')
}

export function runDatabaseMigrations(
  database: DBAdapter,
  options: MigrationOptions = {}
): string[] {
  if (isFreshDatabase(database)) return []

  const missingBaselineParts = missingV012BaselineParts(database)
  if (missingBaselineParts.length > 0) {
    throw new Error(
      `[DB] Unsupported pre-v0.1.12 database (${missingBaselineParts.join(', ')}). ` +
        'Close the app and run: npm run db:sync -- --reset'
    )
  }

  const pending = migrations.filter((migration) => !migration.isStructurallyApplied(database))
  if (pending.length > 0) options.beforeMigrate?.(pending.map((migration) => migration.id))

  const applied: string[] = []
  for (const migration of migrations) {
    if (migration.isStructurallyApplied(database)) {
      ensureMigrationTable(database)
      const recorded = database
        .prepare('SELECT 1 AS present FROM schema_migration WHERE migration_id = ?')
        .get(migration.id) as { present: number } | undefined
      if (!recorded) recordMigration(database, migration)
      continue
    }

    database.transaction(() => {
      ensureMigrationTable(database)
      migration.up(database)
      if (!migration.isStructurallyApplied(database)) {
        throw new Error(`[DB] Migration ${migration.id} did not produce the required structure`)
      }
      recordMigration(database, migration)
    })()
    applied.push(migration.id)
  }
  return applied
}

export function currentSchemaIssues(database: DBAdapter): string[] {
  if (isFreshDatabase(database)) return ['table:user_account']
  const issues = missingV012BaselineParts(database)
  if (!isM1StructurallyApplied(database)) issues.push('migration:multi-device-m1-identity')
  if (!tableExists(database, 'schema_migration')) {
    issues.push('table:schema_migration')
  } else {
    const row = database
      .prepare('SELECT 1 AS present FROM schema_migration WHERE migration_id = ?')
      .get(CURRENT_MIGRATION_ID) as { present: number } | undefined
    if (!row) issues.push(`migration-record:${CURRENT_MIGRATION_ID}`)
  }
  return issues
}

export function assertCurrentDatabaseSchema(database: DBAdapter): void {
  const issues = currentSchemaIssues(database)
  if (issues.length > 0) {
    throw new Error(`[DB] Schema verification failed: ${issues.join(', ')}`)
  }
}
