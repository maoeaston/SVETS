import type { DBAdapter } from './interface'

export const M1_SCHEMA_VERSION = '0.1.13-multi-device-m1-identity'
export const M1_MIGRATION_ID = '2026-07-14_mvp_schema_v0_1_13_multi_device_m1_identity'
export const M2_SCHEMA_VERSION = '0.1.14-multi-device-m2-session-foundation'
export const M2_MIGRATION_ID = '2026-07-15_mvp_schema_v0_1_14_multi_device_m2_session_foundation'
export const CURRENT_SCHEMA_VERSION = '0.1.15-multi-device-m3-grant-assignment'
export const CURRENT_MIGRATION_ID = '2026-07-15_mvp_schema_v0_1_15_multi_device_m3_grant_assignment'

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
  rebuildsReferencedTables?: boolean
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

function triggerSqlByName(sql: string): Map<string, string> {
  const matches = Array.from(
    sql.matchAll(/CREATE\s+TRIGGER\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_]+)\b/gi)
  )
  return new Map(
    matches.map((match, index) => {
      const next = matches[index + 1]
      return [match[1], sql.slice(match.index, next?.index ?? sql.length).trim()] as const
    })
  )
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

const M2_TRIGGER_SQL_BY_NAME = triggerSqlByName(M2_TRIGGER_SQL)

function triggerMatches(database: DBAdapter, triggerName: string): boolean {
  const expected = M2_TRIGGER_SQL_BY_NAME.get(triggerName)
  if (!expected) return false
  return normalizeSql(sqliteObjectSql(database, 'trigger', triggerName)) === normalizeSql(expected)
}

function sqlMatches(
  database: DBAdapter,
  type: 'index' | 'table' | 'trigger',
  name: string,
  expectedSql: string
): boolean {
  return normalizeSql(sqliteObjectSql(database, type, name)) === normalizeSql(expectedSql)
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
    !triggerExists(database, 'trg_learning_business_session_consistency_insert')
  )
}

const M3_DELIVERY_PHASE_COLUMN_SQL = `delivery_phase TEXT CHECK (delivery_phase IS NULL OR delivery_phase IN (
  'PREPARED',
  'ASSIGNED',
  'STUDENT_CONFIRMED',
  'ONLINE_IN_PROGRESS',
  'ONLINE_COMPLETED',
  'OFFLINE_SCORING',
  'OBSERVATION',
  'READY_TO_FINALIZE',
  'FINALIZED'
))`

const M3_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS delegated_access_grant (
  grant_id                  TEXT PRIMARY KEY,
  business_session_id       TEXT NOT NULL REFERENCES business_session(business_session_id),
  teacher_auth_session_id   TEXT NOT NULL REFERENCES auth_session(auth_session_id),
  teacher_user_id           TEXT NOT NULL REFERENCES user_account(user_id),
  student_id                TEXT NOT NULL REFERENCES student_profile(student_id),
  device_id                 TEXT NOT NULL REFERENCES device(device_id),
  device_runtime_session_id TEXT NOT NULL REFERENCES device_runtime_session(device_runtime_session_id),
  capabilities_json         TEXT NOT NULL CHECK (json_valid(capabilities_json)),
  identity_confirmation_method TEXT CHECK (identity_confirmation_method IS NULL OR
                               identity_confirmation_method IN ('PIN','TEACHER_ATTESTATION','PHOTO_MATCH','NONE_REQUIRED')),
  confirmed_by              TEXT REFERENCES user_account(user_id),
  confirmation_evidence     TEXT CHECK (confirmation_evidence IS NULL OR json_valid(confirmation_evidence)),
  student_pin_verified      INTEGER NOT NULL DEFAULT 0 CHECK (student_pin_verified IN (0, 1)),
  teacher_attested          INTEGER NOT NULL DEFAULT 0 CHECK (teacher_attested IN (0, 1)),
  confirmed_at              TEXT,
  status                    TEXT NOT NULL DEFAULT 'ACTIVE'
                             CHECK (status IN ('ACTIVE','RELEASED','EXPIRED','REVOKED')),
  replaces_grant_id         TEXT REFERENCES delegated_access_grant(grant_id),
  granted_at                TEXT NOT NULL DEFAULT (datetime('now')),
  released_at               TEXT,
  release_reason            TEXT,
  expires_at                TEXT NOT NULL,
  created_at                TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (replaces_grant_id IS NULL OR replaces_grant_id <> grant_id)
);

CREATE TABLE IF NOT EXISTS business_session_assignment (
  assignment_id             TEXT PRIMARY KEY,
  business_session_id       TEXT NOT NULL REFERENCES business_session(business_session_id),
  student_id                TEXT NOT NULL REFERENCES student_profile(student_id),
  device_id                 TEXT NOT NULL REFERENCES device(device_id),
  grant_id                  TEXT NOT NULL REFERENCES delegated_access_grant(grant_id),
  assigned_by               TEXT NOT NULL REFERENCES user_account(user_id),
  assigned_at               TEXT NOT NULL DEFAULT (datetime('now')),
  student_confirmed_at      TEXT,
  released_at               TEXT,
  release_reason            TEXT CHECK (release_reason IS NULL OR release_reason IN (
                               'COMPLETED','TEACHER_RELEASED','DEVICE_OFFLINE','REPLACED','ADMIN_REVOKED')),
  replaces_assignment_id    TEXT REFERENCES business_session_assignment(assignment_id),
  version                   INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  status                    TEXT NOT NULL DEFAULT 'PENDING_CONFIRM'
                             CHECK (status IN ('PENDING_CONFIRM','ACTIVE','RELEASED','VOID')),
  created_at                TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                TEXT NOT NULL DEFAULT (datetime('now'))
);
`

const M3_INDEX_SQL = [
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_grant_one_active_per_business_session
  ON delegated_access_grant(business_session_id) WHERE status = 'ACTIVE';`,
  `CREATE INDEX IF NOT EXISTS idx_grant_student_device_status
  ON delegated_access_grant(student_id, device_id, status);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_assignment_one_active_per_grant
  ON business_session_assignment(grant_id) WHERE status IN ('PENDING_CONFIRM','ACTIVE');`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_assignment_one_active_per_session
  ON business_session_assignment(business_session_id) WHERE status IN ('PENDING_CONFIRM','ACTIVE');`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_assignment_one_active_per_device
  ON business_session_assignment(device_id) WHERE status IN ('PENDING_CONFIRM','ACTIVE');`
]

const M3_INDEX_SQL_BY_NAME = new Map(
  M3_INDEX_SQL.map((sql) => {
    const match = sql.match(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_]+)\b/i)
    if (!match) throw new Error('[DB] Invalid M3 index SQL')
    return [match[1], sql] as const
  })
)

const M3_TRIGGER_SQL = `
CREATE TRIGGER IF NOT EXISTS trg_assessment_delivery_phase_forward_only
BEFORE UPDATE OF delivery_phase ON assessment_session
FOR EACH ROW
WHEN OLD.delivery_phase IS NOT NULL AND NEW.delivery_phase IS NOT NULL
  AND OLD.delivery_phase <> NEW.delivery_phase
BEGIN
  SELECT CASE
    WHEN OLD.delivery_phase = 'FINALIZED' THEN
      RAISE(ABORT, 'delivery_phase FINALIZED is terminal')
    WHEN OLD.delivery_phase = 'READY_TO_FINALIZE' AND NEW.delivery_phase <> 'FINALIZED' THEN
      RAISE(ABORT, 'READY_TO_FINALIZE can only advance to FINALIZED')
    WHEN OLD.delivery_phase = 'OBSERVATION' AND NEW.delivery_phase <> 'READY_TO_FINALIZE' THEN
      RAISE(ABORT, 'OBSERVATION can only advance to READY_TO_FINALIZE')
    WHEN OLD.delivery_phase = 'OFFLINE_SCORING'
      AND NEW.delivery_phase NOT IN ('OBSERVATION','READY_TO_FINALIZE') THEN
      RAISE(ABORT, 'OFFLINE_SCORING can only advance to OBSERVATION or READY_TO_FINALIZE')
    WHEN OLD.delivery_phase = 'ONLINE_COMPLETED' AND NEW.delivery_phase <> 'OFFLINE_SCORING' THEN
      RAISE(ABORT, 'ONLINE_COMPLETED can only advance to OFFLINE_SCORING')
    WHEN OLD.delivery_phase = 'ONLINE_IN_PROGRESS' AND NEW.delivery_phase <> 'ONLINE_COMPLETED' THEN
      RAISE(ABORT, 'ONLINE_IN_PROGRESS can only advance to ONLINE_COMPLETED')
    WHEN OLD.delivery_phase = 'STUDENT_CONFIRMED' AND NEW.delivery_phase <> 'ONLINE_IN_PROGRESS' THEN
      RAISE(ABORT, 'STUDENT_CONFIRMED can only advance to ONLINE_IN_PROGRESS')
    WHEN OLD.delivery_phase = 'ASSIGNED' AND NEW.delivery_phase <> 'STUDENT_CONFIRMED' THEN
      RAISE(ABORT, 'ASSIGNED can only advance to STUDENT_CONFIRMED')
    WHEN OLD.delivery_phase = 'PREPARED' AND NEW.delivery_phase <> 'ASSIGNED' THEN
      RAISE(ABORT, 'PREPARED can only advance to ASSIGNED')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_grant_self_consistency_insert
BEFORE INSERT ON delegated_access_grant
FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM business_session bs WHERE bs.business_session_id=NEW.business_session_id AND bs.student_id=NEW.student_id)
  OR NOT EXISTS (SELECT 1 FROM device_runtime_session drs WHERE drs.device_runtime_session_id=NEW.device_runtime_session_id AND drs.device_id=NEW.device_id)
  OR NOT EXISTS (SELECT 1 FROM auth_session au WHERE au.auth_session_id=NEW.teacher_auth_session_id AND au.user_id=NEW.teacher_user_id AND au.status='ACTIVE' AND au.expires_at > datetime('now'))
BEGIN SELECT RAISE(ABORT, 'grant self-consistency: student/business_session, device/runtime, teacher/auth must match and auth ACTIVE unexpired'); END;

CREATE TRIGGER IF NOT EXISTS trg_grant_self_consistency_update
BEFORE UPDATE OF business_session_id, student_id, device_id, device_runtime_session_id, teacher_auth_session_id, teacher_user_id ON delegated_access_grant
FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM business_session bs WHERE bs.business_session_id=NEW.business_session_id AND bs.student_id=NEW.student_id)
  OR NOT EXISTS (SELECT 1 FROM device_runtime_session drs WHERE drs.device_runtime_session_id=NEW.device_runtime_session_id AND drs.device_id=NEW.device_id)
  OR NOT EXISTS (SELECT 1 FROM auth_session au WHERE au.auth_session_id=NEW.teacher_auth_session_id AND au.user_id=NEW.teacher_user_id AND au.status='ACTIVE' AND au.expires_at > datetime('now'))
BEGIN SELECT RAISE(ABORT, 'grant self-consistency violation on update'); END;

CREATE TRIGGER IF NOT EXISTS trg_assignment_grant_consistency_insert
BEFORE INSERT ON business_session_assignment
FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM delegated_access_grant g WHERE g.grant_id=NEW.grant_id
    AND g.student_id=NEW.student_id AND g.device_id=NEW.device_id AND g.business_session_id=NEW.business_session_id)
  OR NOT (NEW.assigned_by=(SELECT teacher_user_id FROM delegated_access_grant WHERE grant_id=NEW.grant_id)
    OR EXISTS (SELECT 1 FROM user_account u WHERE u.user_id=NEW.assigned_by AND u.role='ADMIN' AND u.status='ACTIVE'))
BEGIN SELECT RAISE(ABORT, 'assignment must match grant (student/device/business_session) and assigned_by must be grant teacher or ACTIVE ADMIN'); END;

CREATE TRIGGER IF NOT EXISTS trg_assignment_grant_consistency_update
BEFORE UPDATE OF grant_id, student_id, device_id, business_session_id, assigned_by ON business_session_assignment
FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM delegated_access_grant g WHERE g.grant_id=NEW.grant_id
    AND g.student_id=NEW.student_id AND g.device_id=NEW.device_id AND g.business_session_id=NEW.business_session_id)
  OR NOT (NEW.assigned_by=(SELECT teacher_user_id FROM delegated_access_grant WHERE grant_id=NEW.grant_id)
    OR EXISTS (SELECT 1 FROM user_account u WHERE u.user_id=NEW.assigned_by AND u.role='ADMIN' AND u.status='ACTIVE'))
BEGIN SELECT RAISE(ABORT, 'assignment-grant consistency violation on update'); END;

CREATE TRIGGER IF NOT EXISTS trg_assignment_active_requires_active_grant_insert
BEFORE INSERT ON business_session_assignment
FOR EACH ROW
WHEN NEW.status IN ('PENDING_CONFIRM','ACTIVE')
  AND NOT EXISTS (SELECT 1 FROM delegated_access_grant g WHERE g.grant_id=NEW.grant_id AND g.status='ACTIVE')
BEGIN SELECT RAISE(ABORT, 'active assignment must reference an ACTIVE grant'); END;

CREATE TRIGGER IF NOT EXISTS trg_assignment_active_requires_active_grant_update
BEFORE UPDATE OF status, grant_id ON business_session_assignment
FOR EACH ROW
WHEN NEW.status IN ('PENDING_CONFIRM','ACTIVE')
  AND NOT EXISTS (SELECT 1 FROM delegated_access_grant g WHERE g.grant_id=NEW.grant_id AND g.status='ACTIVE')
BEGIN SELECT RAISE(ABORT, 'active assignment must reference an ACTIVE grant'); END;
`

const M3_TRIGGERS = [
  'trg_assessment_delivery_phase_forward_only',
  'trg_grant_self_consistency_insert',
  'trg_grant_self_consistency_update',
  'trg_assignment_grant_consistency_insert',
  'trg_assignment_grant_consistency_update',
  'trg_assignment_active_requires_active_grant_insert',
  'trg_assignment_active_requires_active_grant_update'
]

const M3_TRIGGER_SQL_BY_NAME = triggerSqlByName(M3_TRIGGER_SQL)

const FUTURE_MULTI_DEVICE_TABLES = [
  'learning_session',
  'learning_progress',
  'command_log',
  'applied_event_batch',
  'processed_event',
  'projector_cursor',
  'backup_manifest',
  'session_invalidation_record',
  'correction_record',
  'offline_score_draft',
  'pairing_challenge'
]

function m3TriggerMatches(database: DBAdapter, triggerName: string): boolean {
  const expected = M3_TRIGGER_SQL_BY_NAME.get(triggerName)
  return Boolean(expected) && sqlMatches(database, 'trigger', triggerName, expected!)
}

function assessmentDeliveryPhaseAllowsM3(database: DBAdapter): boolean {
  const tableSql = normalizeSql(sqliteObjectSql(database, 'table', 'assessment_session'))
  return [
    'prepared',
    'assigned',
    'student_confirmed',
    'online_in_progress',
    'online_completed',
    'offline_scoring',
    'observation',
    'ready_to_finalize',
    'finalized'
  ].every((phase) => tableSql.includes(`'${phase}'`))
}

function domainEventProjectionAllowsBusinessSession(database: DBAdapter): boolean {
  const tableSql = normalizeSql(sqliteObjectSql(database, 'table', 'domain_event_projection'))
  return tableSql.includes('business_session') || !/\bcheck\s*\(/i.test(tableSql)
}

function isM3StructurallyApplied(database: DBAdapter): boolean {
  if (!isM2StructurallyApplied(database)) return false
  return (
    assessmentDeliveryPhaseAllowsM3(database) &&
    domainEventProjectionAllowsBusinessSession(database) &&
    tableExists(database, 'delegated_access_grant') &&
    tableExists(database, 'business_session_assignment') &&
    foreignKeyMatches(database, 'delegated_access_grant', 'business_session_id', 'business_session', 'business_session_id') &&
    foreignKeyMatches(database, 'delegated_access_grant', 'teacher_auth_session_id', 'auth_session', 'auth_session_id') &&
    foreignKeyMatches(database, 'delegated_access_grant', 'device_runtime_session_id', 'device_runtime_session', 'device_runtime_session_id') &&
    foreignKeyMatches(database, 'business_session_assignment', 'business_session_id', 'business_session', 'business_session_id') &&
    foreignKeyMatches(database, 'business_session_assignment', 'grant_id', 'delegated_access_grant', 'grant_id') &&
    Array.from(M3_INDEX_SQL_BY_NAME.entries()).every(([indexName, sql]) =>
      sqlMatches(database, 'index', indexName, sql)
    ) &&
    M3_TRIGGERS.every((triggerName) => m3TriggerMatches(database, triggerName)) &&
    FUTURE_MULTI_DEVICE_TABLES.every((tableName) => !tableExists(database, tableName))
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

function assertNoM3DriftBeforeApply(database: DBAdapter): void {
  for (const triggerName of M3_TRIGGERS) {
    if (triggerExists(database, triggerName) && !m3TriggerMatches(database, triggerName)) {
      throw new Error(`[DB] Existing M3 trigger drift: ${triggerName}`)
    }
  }

  for (const [indexName, sql] of M3_INDEX_SQL_BY_NAME.entries()) {
    if (indexExists(database, indexName) && !sqlMatches(database, 'index', indexName, sql)) {
      throw new Error(`[DB] Existing M3 index drift: ${indexName}`)
    }
  }

  if (
    (tableExists(database, 'delegated_access_grant') ||
      tableExists(database, 'business_session_assignment')) &&
    !isM3StructurallyApplied(database)
  ) {
    throw new Error('[DB] Existing partial M3 grant/assignment structure is not trusted')
  }
}

function existingAssessmentIndexSql(database: DBAdapter): string[] {
  const rows = database
    .prepare(`
      SELECT sql
        FROM sqlite_master
       WHERE type = 'index'
         AND tbl_name = 'assessment_session'
         AND sql IS NOT NULL
       ORDER BY name
    `)
    .all() as Array<{ sql: string }>
  return rows.map((row) => row.sql)
}

function assertNoUnknownAssessmentTriggers(database: DBAdapter): void {
  const allowed = new Set(M2_TRIGGERS.filter((triggerName) => triggerName.includes('assessment_')))
  const rows = database
    .prepare(`
      SELECT name
        FROM sqlite_master
       WHERE type = 'trigger'
         AND tbl_name = 'assessment_session'
       ORDER BY name
    `)
    .all() as Array<{ name: string }>
  const unknown = rows.map((row) => row.name).filter((name) => !allowed.has(name))
  if (unknown.length > 0) {
    throw new Error(`[DB] Unexpected assessment_session triggers before M3 rebuild: ${unknown.join(', ')}`)
  }
}

function selectSnapshotRows(database: DBAdapter, tableName: string, preferredColumns: string[]): unknown[] {
  const columns = columnNames(database, tableName)
  const selected = preferredColumns.filter((column) => columns.has(column))
  const orderBy = selected.includes('session_id')
    ? 'session_id'
    : selected.includes('event_id')
      ? 'event_id'
      : selected[0]
  return database
    .prepare(`SELECT ${selected.join(', ')} FROM ${tableName} ORDER BY ${orderBy}`)
    .all()
}

function replaceCreateTableName(sql: string, fromName: string, toName: string): string {
  return sql.replace(
    new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${fromName}\\b`, 'i'),
    `CREATE TABLE ${toName}`
  )
}

function rebuildAssessmentSessionForM3(database: DBAdapter): void {
  assertNoUnknownAssessmentTriggers(database)
  const originalSql = sqliteObjectSql(database, 'table', 'assessment_session')
  if (!originalSql) throw new Error('[DB] assessment_session table is missing before M3 rebuild')

  const nextSql = originalSql.replace(
    /delivery_phase\s+TEXT\s+CHECK\s*\(\s*delivery_phase\s+IS\s+NULL\s+OR\s+delivery_phase\s+IN\s*\([\s\S]*?\)\s*\)/i,
    M3_DELIVERY_PHASE_COLUMN_SQL
  )
  if (nextSql === originalSql || !normalizeSql(nextSql).includes("'student_confirmed'")) {
    throw new Error('[DB] Unable to expand assessment_session.delivery_phase CHECK for M3')
  }

  const beforeCount = database
    .prepare('SELECT COUNT(*) AS count FROM assessment_session')
    .get() as { count: number }
  const beforeRows = selectSnapshotRows(database, 'assessment_session', [
    'session_id',
    'business_session_id',
    'student_id',
    'strategy_type',
    'job_code',
    'task_code',
    'status',
    'delivery_phase',
    'current_question_id',
    'event_sequence_version'
  ])
  const indexes = existingAssessmentIndexSql(database)
  const columns = Array.from(columnNames(database, 'assessment_session'))
  const columnList = columns.join(', ')
  const createNewSql = replaceCreateTableName(nextSql, 'assessment_session', 'assessment_session__m3_new')

  database.exec(`
DROP TRIGGER trg_assessment_delivery_phase_insert_prepared;
DROP TRIGGER trg_assessment_delivery_phase_frozen_on_abnormal;
DROP TRIGGER trg_assessment_finalized_completed_consistency_insert;
DROP TRIGGER trg_assessment_finalized_completed_consistency_update;
DROP TRIGGER trg_assessment_business_session_consistency_insert;
DROP TRIGGER trg_assessment_business_session_consistency_update;
ALTER TABLE assessment_session RENAME TO assessment_session__m3_old;
${createNewSql};
INSERT INTO assessment_session__m3_new (${columnList})
SELECT ${columnList} FROM assessment_session__m3_old;
DROP TABLE assessment_session__m3_old;
ALTER TABLE assessment_session__m3_new RENAME TO assessment_session;
`)

  for (const indexSql of indexes) database.exec(indexSql)
  for (const triggerName of M2_TRIGGERS.filter((name) => name.includes('assessment_'))) {
    const triggerSql = M2_TRIGGER_SQL_BY_NAME.get(triggerName)
    if (!triggerSql) throw new Error(`[DB] Missing M2 trigger SQL for ${triggerName}`)
    database.exec(triggerSql)
  }

  const afterCount = database
    .prepare('SELECT COUNT(*) AS count FROM assessment_session')
    .get() as { count: number }
  const afterRows = selectSnapshotRows(database, 'assessment_session', [
    'session_id',
    'business_session_id',
    'student_id',
    'strategy_type',
    'job_code',
    'task_code',
    'status',
    'delivery_phase',
    'current_question_id',
    'event_sequence_version'
  ])
  if (afterCount.count !== beforeCount.count || JSON.stringify(afterRows) !== JSON.stringify(beforeRows)) {
    throw new Error('[DB] M3 assessment_session rebuild changed row identity or key fields')
  }
}

function rebuildDomainEventProjectionForM3(database: DBAdapter): void {
  const originalSql = sqliteObjectSql(database, 'table', 'domain_event_projection')
  if (!originalSql || domainEventProjectionAllowsBusinessSession(database)) return

  const nextSql = originalSql.replace(
    /aggregate_type\s+TEXT\s+NOT\s+NULL\s+CHECK\s*\(\s*aggregate_type\s+IN\s*\([\s\S]*?\)\s*\)/i,
    `aggregate_type TEXT NOT NULL CHECK (aggregate_type IN (
      'ASSESSMENT_SESSION',
      'TRAINING_SESSION',
      'STUDENT_PROFILE',
      'STRATEGY_CONFIG',
      'QUESTION_BANK',
      'BUSINESS_SESSION',
      'TASK_REPORT',
      'SAFETY_INCIDENT',
      'ASSET_RESOURCE',
      'SYSTEM'
    ))`
  )
  if (nextSql === originalSql || !normalizeSql(nextSql).includes("'business_session'")) {
    throw new Error('[DB] Unable to expand domain_event_projection.aggregate_type CHECK for M3')
  }

  const indexes = database
    .prepare(`
      SELECT sql
        FROM sqlite_master
       WHERE type = 'index'
         AND tbl_name = 'domain_event_projection'
         AND sql IS NOT NULL
       ORDER BY name
    `)
    .all() as Array<{ sql: string }>
  const beforeRows = selectSnapshotRows(database, 'domain_event_projection', [
    'event_id',
    'aggregate_type',
    'aggregate_id',
    'event_type',
    'event_sequence'
  ])
  const columns = Array.from(columnNames(database, 'domain_event_projection'))
  const columnList = columns.join(', ')
  const createNewSql = replaceCreateTableName(
    nextSql,
    'domain_event_projection',
    'domain_event_projection__m3_new'
  )

  database.exec(`
ALTER TABLE domain_event_projection RENAME TO domain_event_projection__m3_old;
${createNewSql};
INSERT INTO domain_event_projection__m3_new (${columnList})
SELECT ${columnList} FROM domain_event_projection__m3_old;
DROP TABLE domain_event_projection__m3_old;
ALTER TABLE domain_event_projection__m3_new RENAME TO domain_event_projection;
`)
  for (const row of indexes) database.exec(row.sql)

  const afterRows = selectSnapshotRows(database, 'domain_event_projection', [
    'event_id',
    'aggregate_type',
    'aggregate_id',
    'event_type',
    'event_sequence'
  ])
  if (JSON.stringify(afterRows) !== JSON.stringify(beforeRows)) {
    throw new Error('[DB] M3 domain_event_projection rebuild changed event identity or sequence fields')
  }
}

function applyM3Migration(database: DBAdapter): void {
  if (!isM2StructurallyApplied(database)) {
    throw new Error('[DB] M3 migration requires a complete M2 schema')
  }
  assertNoM3DriftBeforeApply(database)
  if (!assessmentDeliveryPhaseAllowsM3(database)) rebuildAssessmentSessionForM3(database)
  rebuildDomainEventProjectionForM3(database)
  database.exec(M3_TABLE_SQL)
  for (const indexSql of M3_INDEX_SQL) database.exec(indexSql)
  database.exec(M3_TRIGGER_SQL)
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
    id: M2_MIGRATION_ID,
    version: M2_SCHEMA_VERSION,
    description:
      'M2: business_session foundation, assessment delivery phase, parent-child consistency triggers',
    isStructurallyApplied: isM2StructurallyApplied,
    up: applyM2Migration
  },
  {
    id: CURRENT_MIGRATION_ID,
    version: CURRENT_SCHEMA_VERSION,
    description:
      'M3: grant assignment tables and delivery phase forward-only guards',
    isStructurallyApplied: isM3StructurallyApplied,
    up: applyM3Migration,
    rebuildsReferencedTables: true
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

    if (migration.rebuildsReferencedTables) {
      database.exec('PRAGMA foreign_keys = OFF;')
      try {
        database.exec('BEGIN;')
        ensureMigrationTable(database)
        migration.up(database)
        if (!migration.isStructurallyApplied(database)) {
          throw new Error(`[DB] Migration ${migration.id} did not produce the required structure`)
        }
        assertDatabaseIntegrity(database, migration.id)
        recordMigration(database, migration)
        database.exec('COMMIT;')
      } catch (error) {
        try {
          database.exec('ROLLBACK;')
        } catch {
          // Preserve the original migration failure.
        }
        throw error
      } finally {
        database.exec('PRAGMA foreign_keys = ON;')
      }
    } else {
      database.transaction(() => {
        ensureMigrationTable(database)
        migration.up(database)
        if (!migration.isStructurallyApplied(database)) {
          throw new Error(`[DB] Migration ${migration.id} did not produce the required structure`)
        }
        assertDatabaseIntegrity(database, migration.id)
        recordMigration(database, migration)
      })()
    }
    applied.push(migration.id)
  }
  return applied
}

export function currentSchemaIssues(database: DBAdapter): string[] {
  if (isFreshDatabase(database)) return ['table:user_account']
  const issues = missingV012BaselineParts(database)
  if (!isM1StructurallyApplied(database)) issues.push('migration:multi-device-m1-identity')
  if (!isM2StructurallyApplied(database)) issues.push('migration:multi-device-m2-session-foundation')
  if (!isM3StructurallyApplied(database)) issues.push('migration:multi-device-m3-grant-assignment')
  if (!tableExists(database, 'schema_migration')) {
    issues.push('table:schema_migration')
  } else {
    const m1Row = database
      .prepare('SELECT 1 AS present FROM schema_migration WHERE migration_id = ?')
      .get(M1_MIGRATION_ID) as { present: number } | undefined
    if (!m1Row) issues.push(`migration-record:${M1_MIGRATION_ID}`)
    const m2Row = database
      .prepare('SELECT 1 AS present FROM schema_migration WHERE migration_id = ?')
      .get(M2_MIGRATION_ID) as { present: number } | undefined
    if (!m2Row) issues.push(`migration-record:${M2_MIGRATION_ID}`)
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
