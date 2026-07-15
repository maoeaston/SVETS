import type { DBAdapter } from './interface'

export const M1_SCHEMA_VERSION = '0.1.13-multi-device-m1-identity'
export const M1_MIGRATION_ID = '2026-07-14_mvp_schema_v0_1_13_multi_device_m1_identity'
export const CURRENT_SCHEMA_VERSION = '0.1.14-multi-device-m2-session-foundation'
export const CURRENT_MIGRATION_ID = '2026-07-15_mvp_schema_v0_1_14_multi_device_m2_session_foundation'

type MigrationOptions = {
  beforeMigrate?: (migrationIds: string[]) => void
  throughMigrationId?: string
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

function triggerExists(database: DBAdapter, triggerName: string): boolean {
  const row = database
    .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'trigger' AND name = ?")
    .get(triggerName) as { present: number } | undefined
  return row?.present === 1
}

function sqliteObjectSql(
  database: DBAdapter,
  type: 'index' | 'table' | 'trigger',
  name: string
): string | null {
  const row = database
    .prepare('SELECT sql FROM sqlite_master WHERE type = ? AND name = ?')
    .get(type, name) as { sql: string | null } | undefined
  return row?.sql ?? null
}

function normalizeSql(sql: string | null | undefined): string {
  return (sql ?? '')
    .replace(/\bIF\s+NOT\s+EXISTS\b/gi, '')
    .replace(/;\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
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

const M2_TRIGGER_SQL = `
CREATE TRIGGER IF NOT EXISTS trg_assessment_delivery_phase_insert_prepared
BEFORE INSERT ON assessment_session
FOR EACH ROW WHEN NEW.delivery_phase IS NOT NULL AND NEW.delivery_phase <> 'PREPARED'
BEGIN SELECT RAISE(ABORT, 'new assessment_session delivery_phase must start at PREPARED'); END;

CREATE TRIGGER IF NOT EXISTS trg_assessment_delivery_phase_frozen_on_abnormal
BEFORE UPDATE OF delivery_phase ON assessment_session
FOR EACH ROW
WHEN OLD.status IN ('REDLINE_HALTED','ABORTED')
  AND ((OLD.delivery_phase IS NULL) <> (NEW.delivery_phase IS NULL) OR OLD.delivery_phase <> NEW.delivery_phase)
BEGIN SELECT RAISE(ABORT, 'delivery_phase of REDLINE_HALTED/ABORTED session is frozen'); END;

CREATE TRIGGER IF NOT EXISTS trg_assessment_finalized_completed_consistency_insert
BEFORE INSERT ON assessment_session
FOR EACH ROW
WHEN (NEW.delivery_phase='FINALIZED' AND NEW.status<>'COMPLETED')
  OR (NEW.status='COMPLETED' AND (NEW.delivery_phase IS NULL OR NEW.delivery_phase<>'FINALIZED'))
BEGIN SELECT RAISE(ABORT, 'FINALIZED must correspond to COMPLETED and vice versa'); END;

CREATE TRIGGER IF NOT EXISTS trg_assessment_finalized_completed_consistency_update
BEFORE UPDATE OF delivery_phase, status ON assessment_session
FOR EACH ROW
WHEN (NEW.delivery_phase='FINALIZED' AND NEW.status<>'COMPLETED')
  OR (NEW.status='COMPLETED' AND (NEW.delivery_phase IS NULL OR NEW.delivery_phase<>'FINALIZED'))
BEGIN SELECT RAISE(ABORT, 'FINALIZED must correspond to COMPLETED and vice versa'); END;

CREATE TRIGGER IF NOT EXISTS trg_assessment_business_session_consistency_insert
BEFORE INSERT ON assessment_session
FOR EACH ROW
WHEN NEW.business_session_id IS NULL
  OR NOT EXISTS (SELECT 1 FROM business_session bs WHERE bs.business_session_id=NEW.business_session_id
    AND bs.session_type='ASSESSMENT' AND bs.student_id=NEW.student_id AND bs.job_code=NEW.job_code AND bs.task_code=NEW.task_code)
BEGIN SELECT RAISE(ABORT, 'assessment_session requires business_session_id matching ASSESSMENT type, student_id, job_code, task_code'); END;

CREATE TRIGGER IF NOT EXISTS trg_assessment_business_session_consistency_update
BEFORE UPDATE OF business_session_id, student_id, job_code, task_code ON assessment_session
FOR EACH ROW
WHEN NEW.business_session_id IS NULL
  OR NOT EXISTS (SELECT 1 FROM business_session bs WHERE bs.business_session_id=NEW.business_session_id
    AND bs.session_type='ASSESSMENT' AND bs.student_id=NEW.student_id AND bs.job_code=NEW.job_code AND bs.task_code=NEW.task_code)
BEGIN SELECT RAISE(ABORT, 'assessment_session requires business_session_id matching ASSESSMENT type, student_id, job_code, task_code'); END;

CREATE TRIGGER IF NOT EXISTS trg_training_business_session_consistency_insert
BEFORE INSERT ON training_session
FOR EACH ROW
WHEN NEW.business_session_id IS NULL
  OR NOT EXISTS (SELECT 1 FROM business_session bs WHERE bs.business_session_id=NEW.business_session_id
    AND bs.session_type='TRAINING' AND bs.student_id=NEW.student_id AND bs.job_code=NEW.job_code AND bs.task_code=NEW.task_code)
BEGIN SELECT RAISE(ABORT, 'training_session requires business_session_id matching TRAINING type, student_id, job_code, task_code'); END;

CREATE TRIGGER IF NOT EXISTS trg_training_business_session_consistency_update
BEFORE UPDATE OF business_session_id, student_id, job_code, task_code ON training_session
FOR EACH ROW
WHEN NEW.business_session_id IS NULL
  OR NOT EXISTS (SELECT 1 FROM business_session bs WHERE bs.business_session_id=NEW.business_session_id
    AND bs.session_type='TRAINING' AND bs.student_id=NEW.student_id AND bs.job_code=NEW.job_code AND bs.task_code=NEW.task_code)
BEGIN SELECT RAISE(ABORT, 'training_session requires business_session_id matching TRAINING type, student_id, job_code, task_code'); END;

CREATE TRIGGER IF NOT EXISTS trg_business_session_key_immutable
BEFORE UPDATE OF session_type, student_id, job_code, task_code ON business_session
FOR EACH ROW
WHEN OLD.session_type<>NEW.session_type OR OLD.student_id<>NEW.student_id
  OR OLD.job_code<>NEW.job_code OR OLD.task_code<>NEW.task_code
BEGIN SELECT RAISE(ABORT, 'business_session key fields (session_type/student_id/job_code/task_code) are immutable'); END;
`

const M2_TRIGGERS = [
  'trg_assessment_delivery_phase_insert_prepared',
  'trg_assessment_delivery_phase_frozen_on_abnormal',
  'trg_assessment_finalized_completed_consistency_insert',
  'trg_assessment_finalized_completed_consistency_update',
  'trg_assessment_business_session_consistency_insert',
  'trg_assessment_business_session_consistency_update',
  'trg_training_business_session_consistency_insert',
  'trg_training_business_session_consistency_update',
  'trg_business_session_key_immutable'
]

const M2_TRIGGER_SQL_BY_NAME = new Map(
  Array.from(
    M2_TRIGGER_SQL.matchAll(
      /CREATE\s+TRIGGER\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_]+)\b[\s\S]*?END;/gi
    )
  ).map((match) => [match[1], match[0]] as const)
)

function triggerMatches(database: DBAdapter, triggerName: string): boolean {
  const expected = M2_TRIGGER_SQL_BY_NAME.get(triggerName)
  if (!expected) return false
  return normalizeSql(sqliteObjectSql(database, 'trigger', triggerName)) === normalizeSql(expected)
}

function indexMatches(
  database: DBAdapter,
  tableName: string,
  indexName: string,
  expectedColumns: string[],
  expectedUnique: boolean
): boolean {
  if (!/^[a-z_]+$/.test(tableName)) throw new Error(`[DB] Invalid table identifier: ${tableName}`)
  const indexRows = database.prepare(`PRAGMA index_list(${tableName})`).all() as Array<{
    name: string
    unique: number
  }>
  const indexRow = indexRows.find((row) => row.name === indexName)
  if (!indexRow || Boolean(indexRow.unique) !== expectedUnique) return false

  const columns = database.prepare(`PRAGMA index_info(${indexName})`).all() as Array<{
    seqno: number
    name: string
  }>
  const actualColumns = columns
    .sort((left, right) => left.seqno - right.seqno)
    .map((row) => row.name)
  return (
    actualColumns.length === expectedColumns.length &&
    actualColumns.every((column, index) => column === expectedColumns[index])
  )
}

function foreignKeyMatches(
  database: DBAdapter,
  tableName: string,
  fromColumn: string,
  toTable: string,
  toColumn: string
): boolean {
  if (!/^[a-z_]+$/.test(tableName)) throw new Error(`[DB] Invalid table identifier: ${tableName}`)
  const rows = database.prepare(`PRAGMA foreign_key_list(${tableName})`).all() as Array<{
    table: string
    from: string
    to: string
  }>
  return rows.some(
    (row) => row.from === fromColumn && row.table === toTable && row.to === toColumn
  )
}

function addColumnIfMissing(database: DBAdapter, tableName: string, columnName: string, ddl: string): void {
  if (!columnNames(database, tableName).has(columnName)) database.exec(ddl)
}

function isM2StructurallyApplied(database: DBAdapter): boolean {
  if (!isM1StructurallyApplied(database)) return false
  const assessmentColumns = tableExists(database, 'assessment_session')
    ? columnNames(database, 'assessment_session')
    : new Set<string>()
  const trainingColumns = tableExists(database, 'training_session')
    ? columnNames(database, 'training_session')
    : new Set<string>()
  return (
    tableExists(database, 'business_session') &&
    assessmentColumns.has('business_session_id') &&
    assessmentColumns.has('delivery_phase') &&
    assessmentColumns.has('event_sequence_version') &&
    assessmentColumns.has('observation_template_id') &&
    trainingColumns.has('business_session_id') &&
    foreignKeyMatches(database, 'business_session', 'student_id', 'student_profile', 'student_id') &&
    foreignKeyMatches(database, 'business_session', 'created_by', 'user_account', 'user_id') &&
    foreignKeyMatches(database, 'assessment_session', 'business_session_id', 'business_session', 'business_session_id') &&
    foreignKeyMatches(database, 'training_session', 'business_session_id', 'business_session', 'business_session_id') &&
    indexMatches(database, 'business_session', 'idx_business_session_student', ['student_id', 'session_type'], false) &&
    indexMatches(database, 'business_session', 'idx_business_session_student_job_task', ['student_id', 'job_code', 'task_code'], false) &&
    indexMatches(database, 'assessment_session', 'ux_assessment_business_session', ['business_session_id'], true) &&
    indexMatches(database, 'training_session', 'ux_training_business_session', ['business_session_id'], true) &&
    indexMatches(database, 'assessment_session', 'idx_assessment_session_delivery_phase', ['delivery_phase'], false) &&
    M2_TRIGGERS.every((triggerName) => triggerMatches(database, triggerName)) &&
    !triggerExists(database, 'trg_assessment_delivery_phase_forward_only') &&
    !triggerExists(database, 'trg_learning_business_session_consistency_insert')
  )
}

function assertDatabaseIntegrity(database: DBAdapter, migrationId: string): void {
  const foreignKeyIssues = database.prepare('PRAGMA foreign_key_check').all()
  if (foreignKeyIssues.length > 0) {
    throw new Error(`[DB] Migration ${migrationId} failed foreign_key_check`)
  }

  const integrityRows = database.prepare('PRAGMA integrity_check').all() as Array<Record<string, string>>
  const integrityMessages = integrityRows
    .map((row) => String(Object.values(row)[0] ?? ''))
    .filter((message) => message !== 'ok')
  if (integrityMessages.length > 0) {
    throw new Error(`[DB] Migration ${migrationId} failed integrity_check: ${integrityMessages.join('; ')}`)
  }
}

function applyM2Migration(database: DBAdapter): void {
  database.exec(`
CREATE TABLE IF NOT EXISTS business_session (
  business_session_id TEXT PRIMARY KEY,
  session_type        TEXT NOT NULL CHECK (session_type IN ('ASSESSMENT','TRAINING','LEARNING')),
  student_id          TEXT NOT NULL REFERENCES student_profile(student_id),
  job_code            TEXT NOT NULL,
  task_code           TEXT NOT NULL CHECK (length(trim(task_code)) > 0),
  created_by          TEXT NOT NULL REFERENCES user_account(user_id),
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_business_session_student
  ON business_session(student_id, session_type);
CREATE INDEX IF NOT EXISTS idx_business_session_student_job_task
  ON business_session(student_id, job_code, task_code);
`)

  addColumnIfMissing(database, 'assessment_session', 'business_session_id',
    'ALTER TABLE assessment_session ADD COLUMN business_session_id TEXT REFERENCES business_session(business_session_id);')
  addColumnIfMissing(database, 'assessment_session', 'delivery_phase',
    `ALTER TABLE assessment_session ADD COLUMN delivery_phase TEXT CHECK (delivery_phase IS NULL OR delivery_phase IN ('PREPARED','ONLINE_IN_PROGRESS','ONLINE_COMPLETED','OFFLINE_SCORING','OBSERVATION','READY_TO_FINALIZE','FINALIZED'));`)
  addColumnIfMissing(database, 'assessment_session', 'observation_template_id',
    'ALTER TABLE assessment_session ADD COLUMN observation_template_id TEXT;')
  addColumnIfMissing(database, 'assessment_session', 'event_sequence_version',
    'ALTER TABLE assessment_session ADD COLUMN event_sequence_version INTEGER NOT NULL DEFAULT 0 CHECK (event_sequence_version >= 0);')
  addColumnIfMissing(database, 'training_session', 'business_session_id',
    'ALTER TABLE training_session ADD COLUMN business_session_id TEXT REFERENCES business_session(business_session_id);')

  database.exec(`
INSERT INTO business_session (business_session_id, session_type, student_id, job_code, task_code, created_by, created_at, updated_at)
SELECT a.session_id, 'ASSESSMENT', a.student_id, a.job_code, a.task_code, a.created_by, COALESCE(a.updated_at, datetime('now')), COALESCE(a.updated_at, datetime('now'))
  FROM assessment_session a
 WHERE NOT EXISTS (SELECT 1 FROM business_session bs WHERE bs.business_session_id = a.session_id);

INSERT INTO business_session (business_session_id, session_type, student_id, job_code, task_code, created_by, created_at, updated_at)
SELECT t.training_session_id, 'TRAINING', t.student_id, t.job_code, t.task_code, t.created_by, COALESCE(t.updated_at, datetime('now')), COALESCE(t.updated_at, datetime('now'))
  FROM training_session t
 WHERE NOT EXISTS (SELECT 1 FROM business_session bs WHERE bs.business_session_id = t.training_session_id);

UPDATE assessment_session
   SET business_session_id = session_id
 WHERE business_session_id IS NULL;

UPDATE training_session
   SET business_session_id = training_session_id
 WHERE business_session_id IS NULL;

UPDATE assessment_session
   SET delivery_phase = 'FINALIZED'
 WHERE status = 'COMPLETED' AND delivery_phase IS NULL;
UPDATE assessment_session
   SET delivery_phase = 'OFFLINE_SCORING'
 WHERE status = 'OFFLINE_PENDING' AND delivery_phase IS NULL;
UPDATE assessment_session
   SET delivery_phase = 'ONLINE_IN_PROGRESS'
 WHERE status IN ('ACTIVE','EMOTION_INTERRUPTED','SUSPENDED_REVIEW_REQUIRED')
   AND delivery_phase IS NULL
   AND (current_question_id IS NOT NULL OR EXISTS (
     SELECT 1 FROM answer_record ar
      WHERE ar.session_id = assessment_session.session_id
        AND ar.status = 'VALID'
   ));
UPDATE assessment_session
   SET delivery_phase = 'PREPARED'
 WHERE status IN ('INIT','ACTIVE','EMOTION_INTERRUPTED','SUSPENDED_REVIEW_REQUIRED')
   AND delivery_phase IS NULL;

UPDATE assessment_session
   SET event_sequence_version = COALESCE((
     SELECT MAX(dep.event_sequence)
       FROM domain_event_projection dep
      WHERE dep.aggregate_type = 'ASSESSMENT_SESSION'
        AND dep.aggregate_id = assessment_session.session_id
   ), 0)
 WHERE event_sequence_version = 0;

UPDATE assessment_session
   SET observation_template_id = strategy_id || '@' || strategy_version
 WHERE observation_template_id IS NULL
   AND EXISTS (
     SELECT 1 FROM assessment_session_question sq
      WHERE sq.session_id = assessment_session.session_id
        AND sq.question_phase = 'OBSERVATION'
   );

CREATE UNIQUE INDEX IF NOT EXISTS ux_assessment_business_session
  ON assessment_session(business_session_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_training_business_session
  ON training_session(business_session_id);
CREATE INDEX IF NOT EXISTS idx_assessment_session_delivery_phase
  ON assessment_session(delivery_phase);
`)

  const badParent = database.prepare(`
    SELECT COUNT(*) AS count
      FROM assessment_session a
      LEFT JOIN business_session bs ON bs.business_session_id = a.business_session_id
     WHERE bs.business_session_id IS NULL
        OR bs.session_type <> 'ASSESSMENT'
        OR bs.student_id <> a.student_id
        OR bs.job_code <> a.job_code
        OR bs.task_code <> a.task_code
  `).get() as { count: number }
  const badTrainingParent = database.prepare(`
    SELECT COUNT(*) AS count
      FROM training_session t
      LEFT JOIN business_session bs ON bs.business_session_id = t.business_session_id
     WHERE bs.business_session_id IS NULL
        OR bs.session_type <> 'TRAINING'
        OR bs.student_id <> t.student_id
        OR bs.job_code <> t.job_code
        OR bs.task_code <> t.task_code
  `).get() as { count: number }
  const badCompleted = database.prepare(`
    SELECT COUNT(*) AS count
      FROM assessment_session
     WHERE status = 'COMPLETED' AND delivery_phase <> 'FINALIZED'
  `).get() as { count: number }
  if (badParent.count > 0 || badTrainingParent.count > 0 || badCompleted.count > 0) {
    throw new Error('[DB] M2 migration produced invalid business session or delivery phase backfill')
  }

  database.exec(M2_TRIGGER_SQL)
}

const migrations: Migration[] = [
  {
    id: M1_MIGRATION_ID,
    version: M1_SCHEMA_VERSION,
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
  },
  {
    id: CURRENT_MIGRATION_ID,
    version: CURRENT_SCHEMA_VERSION,
    description:
      'M2: business_session foundation, assessment delivery phase, parent-child consistency triggers',
    isStructurallyApplied: isM2StructurallyApplied,
    up: applyM2Migration
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

  const targetIndex = options.throughMigrationId
    ? migrations.findIndex((migration) => migration.id === options.throughMigrationId)
    : migrations.length - 1
  if (targetIndex < 0) {
    throw new Error(`[DB] Unknown migration target: ${options.throughMigrationId}`)
  }
  const targetMigrations = migrations.slice(0, targetIndex + 1)
  const pending = targetMigrations.filter((migration) => !migration.isStructurallyApplied(database))
  if (pending.length > 0) options.beforeMigrate?.(pending.map((migration) => migration.id))

  const applied: string[] = []
  for (const migration of targetMigrations) {
    if (migration.isStructurallyApplied(database)) {
      ensureMigrationTable(database)
      const recorded = database
        .prepare('SELECT 1 AS present FROM schema_migration WHERE migration_id = ?')
        .get(migration.id) as { present: number } | undefined
      if (!recorded) {
        assertDatabaseIntegrity(database, migration.id)
        recordMigration(database, migration)
      }
      continue
    }

    database.transaction(() => {
      ensureMigrationTable(database)
      migration.up(database)
      if (!migration.isStructurallyApplied(database)) {
        throw new Error(`[DB] Migration ${migration.id} did not produce the required structure`)
      }
      assertDatabaseIntegrity(database, migration.id)
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
  if (!isM2StructurallyApplied(database)) issues.push('migration:multi-device-m2-session-foundation')
  if (!tableExists(database, 'schema_migration')) {
    issues.push('table:schema_migration')
  } else {
    const m1Row = database
      .prepare('SELECT 1 AS present FROM schema_migration WHERE migration_id = ?')
      .get(M1_MIGRATION_ID) as { present: number } | undefined
    if (!m1Row) issues.push(`migration-record:${M1_MIGRATION_ID}`)
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
