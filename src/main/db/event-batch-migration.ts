import { createHash } from 'crypto'
import type { DBAdapter } from './interface'
import {
  assertCurrentDatabaseSchema,
  CURRENT_MIGRATION_ID,
  CURRENT_SCHEMA_VERSION,
  F4_SITTING_MIGRATION_ID,
  F6_SCORE_SCOPE_REQUIRED_MIGRATION_ID,
  F7_REPORT_FRAMEWORK_MIGRATION_ID,
  F7_SCHEMA_VERSION,
  isFreshDatabase,
  M1_MIGRATION_ID,
  M1_SCHEMA_VERSION,
  M2_MIGRATION_ID,
  M2_SCHEMA_VERSION,
  M4_SAFETY_REKEY_MIGRATION_ID,
  M4_SCHEMA_VERSION,
  PHASE4_ASSET_ROLE_MIGRATION_ID
} from './migrations'

export const EVENT_BATCH_SCHEMA_VERSION = '0.1.18-event-batch-v2.2'
export const EVENT_BATCH_MIGRATION_ID =
  '2026-07-29_mvp_schema_v0_1_18_event_batch_v2_2'
export const EVENT_BATCH_MIGRATION_DESCRIPTION =
  'M5B: durable command ledger and event batch apply cursors'

export type EventBatchStructureState = 'ABSENT' | 'CURRENT' | 'PARTIAL_OR_DRIFTED'
export type EventBatchMigrationSource = 'FRESH' | 'EXACT_M4' | 'ALREADY_TARGET'

export class EventBatchMigrationError extends Error {
  constructor(
    public readonly code:
      | 'M5B_SCHEMA_DRIFT'
      | 'M5B_SOURCE_UNSUPPORTED'
      | 'M5B_BACKUP_REQUIRED'
      | 'M5B_LEDGER_DRIFT'
      | 'M5B_INTEGRITY_FAILED',
    message: string,
    public readonly issues: string[] = []
  ) {
    super(message)
    this.name = 'EventBatchMigrationError'
  }
}

const TABLE_SQL = Object.freeze({
  command_log: `
CREATE TABLE IF NOT EXISTS command_log (
  command_id          TEXT PRIMARY KEY,
  idempotency_key     TEXT NOT NULL,
  client_instance_id  TEXT NOT NULL,
  command_type        TEXT NOT NULL,
  actor_id            TEXT NOT NULL,
  device_id           TEXT,
  auth_session_id     TEXT,
  request_hash        TEXT NOT NULL,
  event_batch_id      TEXT,
  status              TEXT NOT NULL DEFAULT 'PENDING'
                       CHECK (status IN ('PENDING','PROCESSING','SUCCEEDED','FAILED')),
  result_json         TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  error_code          TEXT,
  error_message       TEXT,
  lease_owner         TEXT,
  current_lease_generation INTEGER NOT NULL DEFAULT 0,
  lease_expires_at    TEXT,
  worker_id           TEXT,
  attempt_count       INTEGER NOT NULL DEFAULT 0,
  last_attempt_at     TEXT,
  max_attempts        INTEGER NOT NULL DEFAULT 3,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at        TEXT,
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
)`,
  applied_event_batch: `
CREATE TABLE IF NOT EXISTS applied_event_batch (
  batch_id            TEXT PRIMARY KEY,
  batch_sequence      INTEGER NOT NULL UNIQUE,
  segment_id          TEXT NOT NULL,
  command_id          TEXT,
  event_count         INTEGER NOT NULL CHECK (event_count >= 1),
  previous_batch_hash TEXT NOT NULL,
  events_hash         TEXT NOT NULL,
  batch_hash          TEXT NOT NULL,
  prepared_lease_generation INTEGER NOT NULL DEFAULT 0,
  worker_id           TEXT,
  jsonl_offset_start  INTEGER NOT NULL,
  jsonl_offset_end    INTEGER NOT NULL,
  batch_status        TEXT NOT NULL DEFAULT 'APPLIED'
                       CHECK (batch_status IN ('APPLIED','CONFIRMED')),
  applied_at          TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at        TEXT
)`,
  processed_event: `
CREATE TABLE IF NOT EXISTS processed_event (
  event_id            TEXT PRIMARY KEY,
  batch_id            TEXT NOT NULL REFERENCES applied_event_batch(batch_id),
  event_type          TEXT NOT NULL,
  aggregate_type      TEXT NOT NULL,
  aggregate_id        TEXT NOT NULL,
  processed_at        TEXT NOT NULL DEFAULT (datetime('now'))
)`,
  projector_cursor: `
CREATE TABLE IF NOT EXISTS projector_cursor (
  projector_name      TEXT PRIMARY KEY,
  last_batch_id       TEXT NOT NULL,
  last_batch_sequence INTEGER NOT NULL,
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
)`
})

const INDEX_SQL = Object.freeze({
  ux_command_idempotency: `
CREATE UNIQUE INDEX IF NOT EXISTS ux_command_idempotency
  ON command_log(client_instance_id, idempotency_key)`,
  idx_applied_event_batch_segment: `
CREATE INDEX IF NOT EXISTS idx_applied_event_batch_segment
  ON applied_event_batch(segment_id, batch_sequence)`,
  idx_processed_event_batch: `
CREATE INDEX IF NOT EXISTS idx_processed_event_batch ON processed_event(batch_id)`
})

export const EVENT_BATCH_SCHEMA_SQL = `${Object.values(TABLE_SQL).join(';\n')};\n${Object.values(INDEX_SQL).join(';\n')};`

type ColumnContract = readonly [
  name: string,
  type: string,
  notNull: 0 | 1,
  defaultValue: string | null,
  primaryKey: 0 | 1
]

const COLUMN_CONTRACTS: Readonly<Record<keyof typeof TABLE_SQL, readonly ColumnContract[]>> = Object.freeze({
  command_log: [
    ['command_id', 'TEXT', 0, null, 1],
    ['idempotency_key', 'TEXT', 1, null, 0],
    ['client_instance_id', 'TEXT', 1, null, 0],
    ['command_type', 'TEXT', 1, null, 0],
    ['actor_id', 'TEXT', 1, null, 0],
    ['device_id', 'TEXT', 0, null, 0],
    ['auth_session_id', 'TEXT', 0, null, 0],
    ['request_hash', 'TEXT', 1, null, 0],
    ['event_batch_id', 'TEXT', 0, null, 0],
    ['status', 'TEXT', 1, "'PENDING'", 0],
    ['result_json', 'TEXT', 0, null, 0],
    ['error_code', 'TEXT', 0, null, 0],
    ['error_message', 'TEXT', 0, null, 0],
    ['lease_owner', 'TEXT', 0, null, 0],
    ['current_lease_generation', 'INTEGER', 1, '0', 0],
    ['lease_expires_at', 'TEXT', 0, null, 0],
    ['worker_id', 'TEXT', 0, null, 0],
    ['attempt_count', 'INTEGER', 1, '0', 0],
    ['last_attempt_at', 'TEXT', 0, null, 0],
    ['max_attempts', 'INTEGER', 1, '3', 0],
    ['created_at', 'TEXT', 1, "datetime('now')", 0],
    ['completed_at', 'TEXT', 0, null, 0],
    ['updated_at', 'TEXT', 1, "datetime('now')", 0]
  ],
  applied_event_batch: [
    ['batch_id', 'TEXT', 0, null, 1],
    ['batch_sequence', 'INTEGER', 1, null, 0],
    ['segment_id', 'TEXT', 1, null, 0],
    ['command_id', 'TEXT', 0, null, 0],
    ['event_count', 'INTEGER', 1, null, 0],
    ['previous_batch_hash', 'TEXT', 1, null, 0],
    ['events_hash', 'TEXT', 1, null, 0],
    ['batch_hash', 'TEXT', 1, null, 0],
    ['prepared_lease_generation', 'INTEGER', 1, '0', 0],
    ['worker_id', 'TEXT', 0, null, 0],
    ['jsonl_offset_start', 'INTEGER', 1, null, 0],
    ['jsonl_offset_end', 'INTEGER', 1, null, 0],
    ['batch_status', 'TEXT', 1, "'APPLIED'", 0],
    ['applied_at', 'TEXT', 1, "datetime('now')", 0],
    ['confirmed_at', 'TEXT', 0, null, 0]
  ],
  processed_event: [
    ['event_id', 'TEXT', 0, null, 1],
    ['batch_id', 'TEXT', 1, null, 0],
    ['event_type', 'TEXT', 1, null, 0],
    ['aggregate_type', 'TEXT', 1, null, 0],
    ['aggregate_id', 'TEXT', 1, null, 0],
    ['processed_at', 'TEXT', 1, "datetime('now')", 0]
  ],
  projector_cursor: [
    ['projector_name', 'TEXT', 0, null, 1],
    ['last_batch_id', 'TEXT', 1, null, 0],
    ['last_batch_sequence', 'INTEGER', 1, null, 0],
    ['updated_at', 'TEXT', 1, "datetime('now')", 0]
  ]
})

const INDEX_COLUMNS = Object.freeze({
  ux_command_idempotency: ['client_instance_id', 'idempotency_key'],
  idx_applied_event_batch_segment: ['segment_id', 'batch_sequence'],
  idx_processed_event_batch: ['batch_id']
})

const BASELINE_LEDGER = Object.freeze(new Map<string, string>([
  [M1_MIGRATION_ID, M1_SCHEMA_VERSION],
  [M2_MIGRATION_ID, M2_SCHEMA_VERSION],
  [CURRENT_MIGRATION_ID, CURRENT_SCHEMA_VERSION],
  [PHASE4_ASSET_ROLE_MIGRATION_ID, CURRENT_SCHEMA_VERSION],
  [F4_SITTING_MIGRATION_ID, CURRENT_SCHEMA_VERSION],
  [F6_SCORE_SCOPE_REQUIRED_MIGRATION_ID, CURRENT_SCHEMA_VERSION],
  [F7_REPORT_FRAMEWORK_MIGRATION_ID, F7_SCHEMA_VERSION],
  [M4_SAFETY_REKEY_MIGRATION_ID, M4_SCHEMA_VERSION]
]))
const M4_OBJECT_NAMESET_SHA256 = 'ec6a6f1e32bf240b8768aafdbf173f58fec3cbd2cb01f15c5f89ef1c2bc88913'

function normalizeSql(sql: string | null): string {
  return (sql ?? '')
    .replace(/\bIF\s+NOT\s+EXISTS\b/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([(),;])\s*/g, '$1')
    .replace(/;$/, '')
    .trim()
    .toUpperCase()
}

function normalizeDefault(value: unknown): string | null {
  if (value === null || value === undefined) return null
  let normalized = String(value).replace(/\s+/g, '').toLowerCase()
  while (normalized.startsWith('(') && normalized.endsWith(')')) {
    normalized = normalized.slice(1, -1)
  }
  return normalized
}

function objectSql(database: DBAdapter, type: 'table' | 'index', name: string): string | null {
  const row = database
    .prepare('SELECT sql FROM sqlite_master WHERE type = ? AND name = ?')
    .get(type, name) as { sql?: string | null } | undefined
  return row?.sql ?? null
}

function objectNames(database: DBAdapter): Array<{ type: string; name: string }> {
  return database
    .prepare("SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name")
    .all() as Array<{ type: string; name: string }>
}

function columnIssues(database: DBAdapter, table: keyof typeof TABLE_SQL): string[] {
  const actual = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string
    type: string
    notnull: number
    dflt_value: unknown
    pk: number
  }>
  const expected = COLUMN_CONTRACTS[table]
  if (actual.length !== expected.length) return [`columns:${table}:count:${actual.length}`]
  const issues: string[] = []
  expected.forEach(([name, type, notNull, defaultValue, primaryKey], index) => {
    const found = actual[index]
    if (
      found.name !== name
      || found.type.toUpperCase() !== type
      || found.notnull !== notNull
      || normalizeDefault(found.dflt_value) !== normalizeDefault(defaultValue)
      || found.pk !== primaryKey
    ) {
      issues.push(`column:${table}:${name}`)
    }
  })
  return issues
}

function indexIssues(database: DBAdapter, index: keyof typeof INDEX_SQL): string[] {
  const sql = objectSql(database, 'index', index)
  const issues: string[] = []
  if (normalizeSql(sql) !== normalizeSql(INDEX_SQL[index])) issues.push(`sql:index:${index}`)
  const columns = (database.prepare(`PRAGMA index_info(${index})`).all() as Array<{ name: string }>)
    .map((row) => row.name)
  if (JSON.stringify(columns) !== JSON.stringify(INDEX_COLUMNS[index])) issues.push(`columns:index:${index}`)
  if (index === 'ux_command_idempotency') {
    const row = (database.prepare('PRAGMA index_list(command_log)').all() as Array<{ name: string; unique: number }>)
      .find((entry) => entry.name === index)
    if (row?.unique !== 1) issues.push(`unique:index:${index}`)
  }
  return issues
}

function uniqueBatchSequenceIssue(database: DBAdapter): string[] {
  const indexes = database.prepare('PRAGMA index_list(applied_event_batch)').all() as Array<{
    name: string
    unique: number
  }>
  const found = indexes.some((index) => {
    if (index.unique !== 1) return false
    const columns = (database.prepare(`PRAGMA index_info(${index.name})`).all() as Array<{ name: string }>)
      .map((row) => row.name)
    return columns.length === 1 && columns[0] === 'batch_sequence'
  })
  return found ? [] : ['unique:applied_event_batch:batch_sequence']
}

function foreignKeyIssues(database: DBAdapter): string[] {
  const rows = database.prepare('PRAGMA foreign_key_list(processed_event)').all() as Array<{
    table: string
    from: string
    to: string
    on_update: string
    on_delete: string
    match: string
  }>
  if (
    rows.length === 1
    && rows[0].table === 'applied_event_batch'
    && rows[0].from === 'batch_id'
    && rows[0].to === 'batch_id'
    && rows[0].on_update === 'NO ACTION'
    && rows[0].on_delete === 'NO ACTION'
    && rows[0].match === 'NONE'
  ) return []
  return ['foreign-key:processed_event:batch_id']
}

/** Stable structural diagnostics; the ledger is deliberately checked separately. */
export function eventBatchStructureIssues(database: DBAdapter): string[] {
  const issues: string[] = []
  for (const [table, sql] of Object.entries(TABLE_SQL) as Array<[keyof typeof TABLE_SQL, string]>) {
    if (normalizeSql(objectSql(database, 'table', table)) !== normalizeSql(sql)) {
      issues.push(`sql:table:${table}`)
      continue
    }
    issues.push(...columnIssues(database, table))
  }
  for (const index of Object.keys(INDEX_SQL) as Array<keyof typeof INDEX_SQL>) {
    issues.push(...indexIssues(database, index))
  }
  if (!issues.some((issue) => issue.startsWith('sql:table:applied_event_batch'))) {
    issues.push(...uniqueBatchSequenceIssue(database))
  }
  if (!issues.some((issue) => issue.startsWith('sql:table:processed_event'))) {
    issues.push(...foreignKeyIssues(database))
  }
  return issues
}

export function inspectEventBatchStructure(database: DBAdapter): EventBatchStructureState {
  const names = new Set(objectNames(database).map((entry) => `${entry.type}:${entry.name}`))
  const expectedNames = [
    ...Object.keys(TABLE_SQL).map((name) => `table:${name}`),
    ...Object.keys(INDEX_SQL).map((name) => `index:${name}`)
  ]
  const present = expectedNames.filter((name) => names.has(name)).length
  if (present === 0) return 'ABSENT'
  return eventBatchStructureIssues(database).length === 0 ? 'CURRENT' : 'PARTIAL_OR_DRIFTED'
}

function migrationRows(database: DBAdapter): Array<{ migration_id: string; schema_version: string }> {
  if (!objectSql(database, 'table', 'schema_migration')) return []
  return database
    .prepare('SELECT migration_id, schema_version FROM schema_migration ORDER BY migration_id')
    .all() as Array<{ migration_id: string; schema_version: string }>
}

function assertExactM4Ledger(database: DBAdapter): void {
  const rows = migrationRows(database)
  const issues: string[] = []
  if (rows.length !== BASELINE_LEDGER.size) issues.push(`ledger-count:${rows.length}`)
  const actual = new Map(rows.map((row) => [row.migration_id, row.schema_version]))
  for (const [id, version] of BASELINE_LEDGER) {
    if (actual.get(id) !== version) issues.push(`ledger:${id}`)
  }
  for (const id of actual.keys()) {
    if (!BASELINE_LEDGER.has(id)) issues.push(`unknown-ledger:${id}`)
  }
  if (issues.length > 0) {
    throw new EventBatchMigrationError(
      'M5B_LEDGER_DRIFT',
      `[DB] M5B requires the exact v0.1.17 migration ledger: ${issues.join(', ')}`,
      issues
    )
  }
}

function assertTargetLedger(database: DBAdapter): void {
  const rows = migrationRows(database)
  const eventBatchRows = rows.filter((row) => row.migration_id === EVENT_BATCH_MIGRATION_ID)
  const issues: string[] = []
  if (eventBatchRows.length !== 1 || eventBatchRows[0]?.schema_version !== EVENT_BATCH_SCHEMA_VERSION) {
    issues.push(`ledger:${EVENT_BATCH_MIGRATION_ID}`)
  }
  const nonTarget = rows.filter((row) => row.migration_id !== EVENT_BATCH_MIGRATION_ID)
  const freshTarget = nonTarget.length === 0
  const historicalTarget = nonTarget.length === BASELINE_LEDGER.size
    && nonTarget.every((row) => BASELINE_LEDGER.get(row.migration_id) === row.schema_version)
  if (!freshTarget && !historicalTarget) issues.push('ledger:source-history')
  if (issues.length > 0) {
    throw new EventBatchMigrationError(
      'M5B_LEDGER_DRIFT',
      `[DB] M5B target migration ledger drifted: ${issues.join(', ')}`,
      issues
    )
  }
}

function isTrulyFresh(database: DBAdapter): boolean {
  return isFreshDatabase(database) && objectNames(database).length === 0
}

function assertExactM4ObjectInventory(database: DBAdapter): void {
  const digest = createHash('sha256')
    .update(objectNames(database).map((entry) => `${entry.type}:${entry.name}`).join('\n'))
    .digest('hex')
  if (digest !== M4_OBJECT_NAMESET_SHA256) {
    throw new EventBatchMigrationError(
      'M5B_SOURCE_UNSUPPORTED',
      `[DB] M5B requires the exact v0.1.17 object inventory: got ${digest}`,
      [`object-inventory:${digest}`]
    )
  }
}

export function preflightEventBatchMigration(database: DBAdapter): EventBatchMigrationSource {
  const structure = inspectEventBatchStructure(database)
  if (structure === 'PARTIAL_OR_DRIFTED') {
    const issues = eventBatchStructureIssues(database)
    throw new EventBatchMigrationError(
      'M5B_SCHEMA_DRIFT',
      `[DB] M5B event-batch objects are partial or drifted: ${issues.join(', ')}`,
      issues
    )
  }
  if (structure === 'CURRENT') {
    assertTargetLedger(database)
    return 'ALREADY_TARGET'
  }
  if (isTrulyFresh(database)) return 'FRESH'
  try {
    assertCurrentDatabaseSchema(database)
  } catch (error) {
    throw new EventBatchMigrationError(
      'M5B_SOURCE_UNSUPPORTED',
      `[DB] M5B requires an empty database or exact v0.1.17 source: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  assertExactM4Ledger(database)
  assertExactM4ObjectInventory(database)
  return 'EXACT_M4'
}

function ensureMigrationTable(database: DBAdapter): void {
  database.exec(`
CREATE TABLE IF NOT EXISTS schema_migration (
  migration_id       TEXT PRIMARY KEY,
  schema_version     TEXT NOT NULL,
  description        TEXT,
  applied_at         TEXT NOT NULL DEFAULT (datetime('now'))
)`)
}

function assertDatabaseIntegrity(database: DBAdapter): void {
  const foreignKeys = database.prepare('PRAGMA foreign_key_check').all()
  const integrityRows = database.prepare('PRAGMA integrity_check').all() as Array<Record<string, unknown>>
  const integrity = integrityRows.map((row) => String(Object.values(row)[0]))
  if (foreignKeys.length > 0 || integrity.length !== 1 || integrity[0] !== 'ok') {
    const issues = [
      ...(foreignKeys.length > 0 ? [`foreign-key-check:${foreignKeys.length}`] : []),
      ...(integrity.length !== 1 || integrity[0] !== 'ok' ? [`integrity-check:${integrity.join('|')}`] : [])
    ]
    throw new EventBatchMigrationError(
      'M5B_INTEGRITY_FAILED',
      `[DB] M5B event-batch integrity check failed: ${issues.join(', ')}`,
      issues
    )
  }
}

export function assertExactEventBatchStructure(database: DBAdapter): void {
  const issues = eventBatchStructureIssues(database)
  if (issues.length > 0) {
    throw new EventBatchMigrationError(
      'M5B_SCHEMA_DRIFT',
      `[DB] M5B event-batch structure mismatch: ${issues.join(', ')}`,
      issues
    )
  }
  assertTargetLedger(database)
  assertDatabaseIntegrity(database)
}

export function applyEventBatchMigration(
  database: DBAdapter,
  dependencies: { createVerifiedBackupBeforeDdl?: () => void } = {}
): { source: EventBatchMigrationSource; applied: boolean } {
  const source = preflightEventBatchMigration(database)
  if (source === 'ALREADY_TARGET') {
    assertExactEventBatchStructure(database)
    return { source, applied: false }
  }
  if (source === 'EXACT_M4') {
    if (!dependencies.createVerifiedBackupBeforeDdl) {
      throw new EventBatchMigrationError(
        'M5B_BACKUP_REQUIRED',
        '[DB] M5B historical migration requires a verified paired backup before DDL'
      )
    }
    dependencies.createVerifiedBackupBeforeDdl()
    if (preflightEventBatchMigration(database) !== 'EXACT_M4') {
      throw new EventBatchMigrationError(
        'M5B_SCHEMA_DRIFT',
        '[DB] M5B source changed while the pre-DDL backup was being created'
      )
    }
  }

  database.immediateTransaction(() => {
    ensureMigrationTable(database)
    database.exec(EVENT_BATCH_SCHEMA_SQL)
    const structureIssues = eventBatchStructureIssues(database)
    if (structureIssues.length > 0) {
      throw new EventBatchMigrationError(
        'M5B_SCHEMA_DRIFT',
        `[DB] M5B DDL did not produce the exact target: ${structureIssues.join(', ')}`,
        structureIssues
      )
    }
    database.prepare(`
      INSERT INTO schema_migration (migration_id, schema_version, description, applied_at)
      VALUES (?, ?, ?, datetime('now'))
    `).run(EVENT_BATCH_MIGRATION_ID, EVENT_BATCH_SCHEMA_VERSION, EVENT_BATCH_MIGRATION_DESCRIPTION)
    assertDatabaseIntegrity(database)
  })()

  assertExactEventBatchStructure(database)
  return { source, applied: true }
}
