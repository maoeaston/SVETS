import { parseReportContent, validateReportSourceResultIds } from '../domain/report-contract'
import { sha256CanonicalJson } from '../domain/report-canonical'
import type { DBAdapter } from './interface'

export const F7_SCHEMA_VERSION = '0.1.16-report-framework'
export const F7_REPORT_FRAMEWORK_MIGRATION_ID = '2026-07-24_f7_report_framework'

type LegacyReportRow = {
  report_id: string
  report_type: string
  student_id: string | null
  source_aggregate_type: string | null
  source_aggregate_id: string | null
  source_result_ids_json: string | null
  report_content_json: string
  generated_at: string
  status: string
}

type LegacyReportMetadata = {
  reportId: string
  lineageKey: string
  sourceSetHash: string
  generationKey: string
  contentHash: string
  reportRevision: number
  reportSchemaVersion: string
  contractValidationStatus: 'VALID' | 'REPAIR_REQUIRED'
}

export class ReportMigrationError extends Error {
  constructor(
    public readonly code:
      | 'F7_SCHEMA_DRIFT'
      | 'LEGACY_REPORT_JSON_INVALID'
      | 'LEGACY_REPORT_SOURCE_UNRESOLVABLE'
      | 'LEGACY_REPORT_LINEAGE_CONFLICT',
    message: string
  ) {
    super(message)
    this.name = 'ReportMigrationError'
  }
}

const F7_REPORT_COLUMNS = [
  'task_closure_id',
  'repair_of_report_id',
  'lineage_key',
  'source_set_hash',
  'generation_key',
  'content_hash',
  'report_revision',
  'report_schema_version',
  'report_builder_version',
  'generation_reason',
  'contract_validation_status',
  'last_applied_event_id'
] as const

const F7_TASK_CLOSURE_COLUMNS = [
  'task_closure_id',
  'student_id',
  'job_code',
  'task_code',
  'cycle_no',
  'closure_revision',
  'status',
  'is_cycle_head',
  'ability_result_id',
  'training_completion_result_id',
  'operation_pass_rate_result_id',
  'ability_source_aggregate_id',
  'training_source_aggregate_id',
  'operation_source_aggregate_id',
  'replaces_task_closure_id',
  'replacement_task_closure_id',
  'correction_reason',
  'confirmed_by',
  'confirmed_event_id',
  'confirmed_at',
  'last_applied_event_id'
] as const

const F7_TASK_CLOSURE_SQL = `
CREATE TABLE IF NOT EXISTS task_closure (
  task_closure_id                 TEXT PRIMARY KEY,
  student_id                      TEXT NOT NULL REFERENCES student_profile(student_id),
  job_code                        TEXT NOT NULL,
  task_code                       TEXT NOT NULL CHECK (length(trim(task_code)) > 0),
  cycle_no                        INTEGER NOT NULL CHECK (cycle_no >= 1),
  closure_revision                INTEGER NOT NULL CHECK (closure_revision >= 1),
  status                          TEXT NOT NULL CHECK (status IN ('CONFIRMED', 'SUPERSEDED')),
  is_cycle_head                   INTEGER NOT NULL CHECK (is_cycle_head IN (0, 1)),
  ability_result_id               TEXT NOT NULL REFERENCES result_record(result_id),
  training_completion_result_id   TEXT NOT NULL REFERENCES result_record(result_id),
  operation_pass_rate_result_id   TEXT NOT NULL REFERENCES result_record(result_id),
  ability_source_aggregate_id     TEXT NOT NULL,
  training_source_aggregate_id    TEXT NOT NULL,
  operation_source_aggregate_id   TEXT NOT NULL,
  replaces_task_closure_id        TEXT REFERENCES task_closure(task_closure_id),
  replacement_task_closure_id     TEXT REFERENCES task_closure(task_closure_id),
  correction_reason               TEXT,
  confirmed_by                    TEXT NOT NULL REFERENCES user_account(user_id),
  confirmed_event_id              TEXT NOT NULL UNIQUE REFERENCES domain_event_projection(event_id),
  confirmed_at                    TEXT NOT NULL,
  last_applied_event_id           TEXT REFERENCES domain_event_projection(event_id),
  created_at                      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (student_id, job_code, task_code, cycle_no, closure_revision),
  CHECK (replaces_task_closure_id IS NULL OR replaces_task_closure_id <> task_closure_id),
  CHECK (replacement_task_closure_id IS NULL OR replacement_task_closure_id <> task_closure_id),
  CHECK ((status = 'CONFIRMED' AND is_cycle_head = 1) OR (status = 'SUPERSEDED' AND is_cycle_head = 0))
);
`

const F7_TASK_CLOSURE_INDEX_SQL = [
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_task_closure_cycle_head
     ON task_closure(student_id, job_code, task_code, cycle_no) WHERE is_cycle_head = 1;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_task_closure_cycle_confirmed
     ON task_closure(student_id, job_code, task_code, cycle_no) WHERE status = 'CONFIRMED';`,
  `CREATE INDEX IF NOT EXISTS idx_task_closure_student_task
     ON task_closure(student_id, job_code, task_code, cycle_no DESC, closure_revision DESC);`
]

const F7_TASK_REPORT_INDEX_SQL = [
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_task_report_generation_key
     ON task_report(generation_key) WHERE generation_key IS NOT NULL;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_task_report_lineage_revision
     ON task_report(lineage_key, report_revision)
     WHERE lineage_key IS NOT NULL AND report_revision IS NOT NULL;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_task_report_active_lineage
     ON task_report(lineage_key)
     WHERE lineage_key IS NOT NULL AND status IN ('GENERATED', 'EXPORTED', 'LOCKED');`,
  `CREATE INDEX IF NOT EXISTS idx_task_report_lineage_revision
     ON task_report(lineage_key, report_revision DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_task_report_task_closure
     ON task_report(task_closure_id);`
]

const F7_TASK_CLOSURE_TRIGGER_SQL = `
CREATE TRIGGER IF NOT EXISTS trg_task_closure_insert_guard
BEFORE INSERT ON task_closure
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM result_record r
  JOIN assessment_session s ON s.session_id = r.source_aggregate_id
  WHERE r.result_id = NEW.ability_result_id
    AND r.result_type = 'ABILITY_SCORE'
    AND r.source_aggregate_type = 'ASSESSMENT_SESSION'
    AND r.student_id = NEW.student_id AND r.job_code = NEW.job_code
    AND s.task_code = NEW.task_code AND s.status <> 'REDLINE_HALTED'
    AND r.safety_overridden = 0 AND NEW.ability_source_aggregate_id = r.source_aggregate_id
) OR NOT EXISTS (
  SELECT 1 FROM result_record r
  JOIN training_session s ON s.training_session_id = r.source_aggregate_id
  WHERE r.result_id = NEW.training_completion_result_id
    AND r.result_type = 'TRAINING_COMPLETION'
    AND r.source_aggregate_type = 'TRAINING_SESSION'
    AND r.student_id = NEW.student_id AND r.job_code = NEW.job_code
    AND s.task_code = NEW.task_code AND s.status <> 'REDLINE_HALTED'
    AND r.safety_overridden = 0 AND NEW.training_source_aggregate_id = r.source_aggregate_id
) OR NOT EXISTS (
  SELECT 1 FROM result_record r
  JOIN assessment_session s ON s.session_id = r.source_aggregate_id
  WHERE r.result_id = NEW.operation_pass_rate_result_id
    AND r.result_type = 'OPERATION_PASS_RATE'
    AND r.source_aggregate_type = 'ASSESSMENT_SESSION'
    AND r.student_id = NEW.student_id AND r.job_code = NEW.job_code
    AND s.task_code = NEW.task_code AND s.status <> 'REDLINE_HALTED'
    AND r.safety_overridden = 0 AND NEW.operation_source_aggregate_id = r.source_aggregate_id
) OR (NEW.replaces_task_closure_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM task_closure old
  WHERE old.task_closure_id = NEW.replaces_task_closure_id
    AND old.student_id = NEW.student_id AND old.job_code = NEW.job_code AND old.task_code = NEW.task_code
    AND old.cycle_no = NEW.cycle_no
    AND ((old.status = 'CONFIRMED' AND old.is_cycle_head = 1)
         OR (old.status = 'SUPERSEDED' AND old.replacement_task_closure_id IS NULL))
))
BEGIN
  SELECT RAISE(ABORT, 'task_closure binding, source, or replacement head is invalid');
END;

CREATE TRIGGER IF NOT EXISTS trg_task_closure_bindings_immutable
BEFORE UPDATE OF student_id, job_code, task_code, cycle_no, closure_revision,
  ability_result_id, training_completion_result_id, operation_pass_rate_result_id,
  ability_source_aggregate_id, training_source_aggregate_id, operation_source_aggregate_id,
  replaces_task_closure_id, correction_reason, confirmed_by, confirmed_event_id, confirmed_at
ON task_closure
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'task_closure bindings and confirmation facts are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_task_closure_delete_guard
BEFORE DELETE ON task_closure
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'task_closure rows are append-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_task_closure_status_transition_guard
BEFORE UPDATE OF status, is_cycle_head ON task_closure
FOR EACH ROW
WHEN (OLD.status = 'CONFIRMED' AND NOT (NEW.status = 'SUPERSEDED' AND NEW.is_cycle_head = 0))
  OR (OLD.status = 'SUPERSEDED' AND (NEW.status <> 'SUPERSEDED' OR NEW.is_cycle_head <> 0))
BEGIN
  SELECT RAISE(ABORT, 'task_closure status can only transition CONFIRMED to SUPERSEDED');
END;

CREATE TRIGGER IF NOT EXISTS trg_task_closure_replacement_link_guard
BEFORE UPDATE OF replacement_task_closure_id ON task_closure
FOR EACH ROW
WHEN NEW.replacement_task_closure_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM task_closure replacement
  WHERE replacement.task_closure_id = NEW.replacement_task_closure_id
    AND replacement.replaces_task_closure_id = OLD.task_closure_id
    AND replacement.student_id = OLD.student_id AND replacement.job_code = OLD.job_code
    AND replacement.task_code = OLD.task_code AND replacement.cycle_no = OLD.cycle_no
    AND (
      (replacement.status = 'CONFIRMED' AND replacement.is_cycle_head = 1)
      OR (replacement.status = 'SUPERSEDED' AND replacement.is_cycle_head = 0)
    )
)
BEGIN
  SELECT RAISE(ABORT, 'task_closure replacement must point to the current replacement head');
END;
`

const F7_TASK_REPORT_TRIGGER_SQL = `
CREATE TRIGGER IF NOT EXISTS trg_task_report_safety_termination_insert_guard
BEFORE INSERT ON task_report
FOR EACH ROW
WHEN (
  (NEW.source_aggregate_type = 'SAFETY_INCIDENT' AND NEW.report_type <> 'SAFETY_TERMINATION_REPORT')
  OR (NEW.source_aggregate_type = 'ASSESSMENT_SESSION'
      AND EXISTS (SELECT 1 FROM assessment_session s WHERE s.session_id = NEW.source_aggregate_id AND s.status = 'REDLINE_HALTED')
      AND NEW.report_type <> 'SAFETY_TERMINATION_REPORT')
  OR (NEW.source_aggregate_type = 'TRAINING_SESSION'
      AND EXISTS (SELECT 1 FROM training_session t WHERE t.training_session_id = NEW.source_aggregate_id AND t.status = 'REDLINE_HALTED')
      AND NEW.report_type <> 'SAFETY_TERMINATION_REPORT')
)
BEGIN
  SELECT RAISE(ABORT, 'redline-halted source must generate SAFETY_TERMINATION_REPORT only');
END;

CREATE TRIGGER IF NOT EXISTS trg_task_report_safety_termination_update_guard
BEFORE UPDATE ON task_report
FOR EACH ROW
WHEN (
  (NEW.source_aggregate_type = 'SAFETY_INCIDENT' AND NEW.report_type <> 'SAFETY_TERMINATION_REPORT')
  OR (NEW.source_aggregate_type = 'ASSESSMENT_SESSION'
      AND EXISTS (SELECT 1 FROM assessment_session s WHERE s.session_id = NEW.source_aggregate_id AND s.status = 'REDLINE_HALTED')
      AND NEW.report_type <> 'SAFETY_TERMINATION_REPORT')
  OR (NEW.source_aggregate_type = 'TRAINING_SESSION'
      AND EXISTS (SELECT 1 FROM training_session t WHERE t.training_session_id = NEW.source_aggregate_id AND t.status = 'REDLINE_HALTED')
      AND NEW.report_type <> 'SAFETY_TERMINATION_REPORT')
)
BEGIN
  SELECT RAISE(ABORT, 'redline-halted source must generate SAFETY_TERMINATION_REPORT only');
END;

CREATE TRIGGER IF NOT EXISTS trg_task_report_snapshot_immutable
BEFORE UPDATE OF student_id, source_aggregate_type, source_aggregate_id, source_result_ids_json,
  report_title, report_content_json, generated_event_id, generated_by, generated_at,
  task_closure_id, repair_of_report_id, lineage_key, source_set_hash, generation_key,
  content_hash, report_revision, report_schema_version, report_builder_version, generation_reason
ON task_report
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'task_report snapshot facts are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_task_report_contract_valid_for_review_lock_export_insert
BEFORE INSERT ON task_report
FOR EACH ROW
WHEN (NEW.placement_review_by IS NOT NULL OR NEW.placement_review_at IS NOT NULL
      OR NEW.status IN ('LOCKED', 'EXPORTED'))
  AND NEW.contract_validation_status <> 'VALID'
BEGIN
  SELECT RAISE(ABORT, 'VALID report contract is required for review, lock, and export');
END;

CREATE TRIGGER IF NOT EXISTS trg_task_report_contract_valid_for_review_lock_export_update
BEFORE UPDATE ON task_report
FOR EACH ROW
WHEN (NEW.placement_review_by IS NOT NULL OR NEW.placement_review_at IS NOT NULL
      OR NEW.status IN ('LOCKED', 'EXPORTED'))
  AND NEW.contract_validation_status <> 'VALID'
BEGIN
  SELECT RAISE(ABORT, 'VALID report contract is required for review, lock, and export');
END;

CREATE TRIGGER IF NOT EXISTS trg_task_report_placement_review_export_insert_guard
BEFORE INSERT ON task_report
FOR EACH ROW
WHEN NEW.status = 'EXPORTED'
  AND json_extract(NEW.report_content_json, '$.placement_advice.enabled') = 1
  AND (NEW.placement_review_by IS NULL OR NEW.placement_review_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'placement review is required before exporting an enabled placement advice');
END;

CREATE TRIGGER IF NOT EXISTS trg_task_report_placement_review_export_update_guard
BEFORE UPDATE ON task_report
FOR EACH ROW
WHEN NEW.status = 'EXPORTED'
  AND json_extract(NEW.report_content_json, '$.placement_advice.enabled') = 1
  AND (NEW.placement_review_by IS NULL OR NEW.placement_review_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'placement review is required before exporting an enabled placement advice');
END;

CREATE TRIGGER IF NOT EXISTS trg_task_report_status_transition_guard
BEFORE UPDATE OF status ON task_report
FOR EACH ROW
WHEN (OLD.status = 'LOCKED' AND NEW.status NOT IN ('LOCKED', 'SUPERSEDED', 'ARCHIVED'))
  OR (OLD.status IN ('SUPERSEDED', 'ARCHIVED') AND NEW.status <> OLD.status)
  OR (OLD.status = 'GENERATED' AND NEW.status NOT IN ('GENERATED', 'EXPORTED', 'LOCKED', 'SUPERSEDED', 'ARCHIVED'))
  OR (OLD.status = 'EXPORTED' AND NEW.status NOT IN ('EXPORTED', 'LOCKED', 'SUPERSEDED', 'ARCHIVED'))
BEGIN
  SELECT RAISE(ABORT, 'task_report status transition is invalid');
END;
`

const F7_DOMAIN_EVENT_PROJECTION_SQL = `
CREATE TABLE domain_event_projection (
  event_id              TEXT PRIMARY KEY,
  aggregate_type        TEXT NOT NULL CHECK (aggregate_type IN (
                           'ASSESSMENT_SESSION', 'TRAINING_SESSION', 'STUDENT_PROFILE',
                           'STRATEGY_CONFIG', 'QUESTION_BANK', 'BUSINESS_SESSION',
                           'TASK_CLOSURE', 'TASK_REPORT', 'SAFETY_INCIDENT',
                           'ASSET_RESOURCE', 'SYSTEM'
                         )),
  aggregate_id          TEXT NOT NULL,
  event_type            TEXT NOT NULL,
  event_sequence        INTEGER NOT NULL CHECK (event_sequence >= 1),
  payload_json          TEXT NOT NULL,
  checksum              TEXT NOT NULL,
  source_log_path       TEXT NOT NULL,
  source_log_line_no    INTEGER CHECK (source_log_line_no IS NULL OR source_log_line_no >= 1),
  source_log_byte_offset INTEGER CHECK (source_log_byte_offset IS NULL OR source_log_byte_offset >= 0),
  schema_version        INTEGER NOT NULL DEFAULT 1 CHECK (schema_version >= 1),
  sitting_no            INTEGER CHECK (sitting_no IS NULL OR sitting_no >= 1),
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  applied_to_snapshot   INTEGER NOT NULL DEFAULT 0 CHECK (applied_to_snapshot IN (0, 1)),
  applied_at            TEXT,
  UNIQUE (aggregate_type, aggregate_id, event_sequence)
);
`

const F7_ERROR_EVENT_LOG_SQL = `
CREATE TABLE error_event_log (
  error_event_id          TEXT PRIMARY KEY,
  error_code              TEXT NOT NULL REFERENCES error_code_registry(error_code),
  severity                TEXT NOT NULL CHECK (severity IN ('INFO', 'WARN', 'ERROR', 'CRITICAL')),
  error_category          TEXT NOT NULL CHECK (error_category IN (
                            'IPC', 'DB', 'AOL', 'RECOVERY', 'ASSET',
                            'FSM', 'SCORING', 'REPORT', 'AUTH', 'SYSTEM'
                          )),
  related_aggregate_type  TEXT CHECK (related_aggregate_type IS NULL OR related_aggregate_type IN (
                            'ASSESSMENT_SESSION', 'TRAINING_SESSION', 'STUDENT_PROFILE',
                            'STRATEGY_CONFIG', 'QUESTION_BANK', 'TASK_CLOSURE', 'TASK_REPORT',
                            'SAFETY_INCIDENT', 'ASSET_RESOURCE', 'SYSTEM'
                          )),
  related_aggregate_id    TEXT,
  related_event_id        TEXT REFERENCES domain_event_projection(event_id),
  message                 TEXT NOT NULL,
  context_json            TEXT,
  stack_trace             TEXT,
  recovery_action         TEXT,
  recovery_status         TEXT NOT NULL DEFAULT 'UNRESOLVED' CHECK (recovery_status IN (
                            'UNRESOLVED', 'AUTO_RECOVERED', 'MANUAL_REVIEW_REQUIRED', 'RESOLVED', 'IGNORED'
                          )),
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at             TEXT
);
`

function normalizeSql(sql: string | null): string {
  return (sql ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
}

function tableExists(database: DBAdapter, tableName: string): boolean {
  return Boolean(
    database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName)
  )
}

function indexExists(database: DBAdapter, indexName: string): boolean {
  return Boolean(
    database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?").get(indexName)
  )
}

function triggerExists(database: DBAdapter, triggerName: string): boolean {
  return Boolean(
    database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = ?").get(triggerName)
  )
}

function columnNames(database: DBAdapter, tableName: string): Set<string> {
  const rows = database.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>
  return new Set(rows.map((row) => row.name))
}

function tableSql(database: DBAdapter, tableName: string): string {
  const row = database
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { sql: string } | undefined
  return row?.sql ?? ''
}

function addColumnIfMissing(database: DBAdapter, columnName: string, definition: string): void {
  if (!columnNames(database, 'task_report').has(columnName)) {
    database.exec(`ALTER TABLE task_report ADD COLUMN ${definition};`)
  }
}

function existingIndexSqlForTable(database: DBAdapter, tableName: string): string[] {
  return (database
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL ORDER BY name")
    .all(tableName) as Array<{ sql: string }>).map((row) => row.sql)
}

function replaceCreateTableName(sql: string, fromName: string, toName: string): string {
  const pattern = new RegExp(`CREATE\\s+TABLE\\s+${fromName}\\b`, 'i')
  const next = sql.replace(pattern, `CREATE TABLE ${toName}`)
  if (next === sql) throw new ReportMigrationError('F7_SCHEMA_DRIFT', `Cannot rebuild ${fromName}`)
  return next
}

function rebuildAggregateCheckTable(database: DBAdapter, tableName: 'domain_event_projection' | 'error_event_log', nextSql: string): void {
  const indexes = existingIndexSqlForTable(database, tableName)
  const columns = Array.from(columnNames(database, tableName))
  const beforeRows = database.prepare(`SELECT * FROM ${tableName} ORDER BY rowid`).all()
  const target = `${tableName}__f7_new`
  const old = `${tableName}__f7_old`
  const createNewSql = replaceCreateTableName(nextSql, tableName, target)
  const columnList = columns.join(', ')

  database.exec(`
ALTER TABLE ${tableName} RENAME TO ${old};
${createNewSql};
INSERT INTO ${target} (${columnList}) SELECT ${columnList} FROM ${old};
DROP TABLE ${old};
ALTER TABLE ${target} RENAME TO ${tableName};
`)
  for (const sql of indexes) database.exec(sql)

  const afterRows = database.prepare(`SELECT * FROM ${tableName} ORDER BY rowid`).all()
  if (JSON.stringify(beforeRows) !== JSON.stringify(afterRows)) {
    throw new ReportMigrationError('F7_SCHEMA_DRIFT', `${tableName} rebuild changed existing rows`)
  }
}

function dropLegacyReportTriggers(database: DBAdapter): void {
  const allowed = new Set([
    'trg_task_report_safety_termination_insert_guard',
    'trg_task_report_safety_termination_update_guard',
    'trg_task_report_placement_review_export_insert_guard',
    'trg_task_report_placement_review_export_update_guard',
    'trg_task_report_snapshot_immutable',
    'trg_task_report_contract_valid_for_review_lock_export_insert',
    'trg_task_report_contract_valid_for_review_lock_export_update',
    'trg_task_report_status_transition_guard'
  ])
  const triggers = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'task_report'")
    .all() as Array<{ name: string }>
  for (const trigger of triggers) {
    if (!allowed.has(trigger.name)) {
      throw new ReportMigrationError('F7_SCHEMA_DRIFT', `Unrecognized task_report trigger: ${trigger.name}`)
    }
    database.exec(`DROP TRIGGER ${trigger.name};`)
  }
}

function reportBusinessKey(database: DBAdapter, row: LegacyReportRow): {
  jobCode: string | null
  taskCode: string | null
} {
  if (!row.source_aggregate_type || !row.source_aggregate_id) {
    throw new ReportMigrationError('LEGACY_REPORT_SOURCE_UNRESOLVABLE', `Report ${row.report_id} has no source aggregate`)
  }
  if (row.source_aggregate_type === 'ASSESSMENT_SESSION') {
    const source = database
      .prepare('SELECT job_code, task_code FROM assessment_session WHERE session_id = ?')
      .get(row.source_aggregate_id) as { job_code: string; task_code: string } | undefined
    if (source) return { jobCode: source.job_code, taskCode: source.task_code }
  }
  if (row.source_aggregate_type === 'TRAINING_SESSION') {
    const source = database
      .prepare('SELECT job_code, task_code FROM training_session WHERE training_session_id = ?')
      .get(row.source_aggregate_id) as { job_code: string; task_code: string } | undefined
    if (source) return { jobCode: source.job_code, taskCode: source.task_code }
  }
  if (row.source_aggregate_type === 'SAFETY_INCIDENT') {
    const source = database
      .prepare('SELECT job_code, task_code FROM safety_incident WHERE incident_id = ?')
      .get(row.source_aggregate_id) as { job_code: string; task_code: string } | undefined
    if (source) return { jobCode: source.job_code, taskCode: source.task_code }
  }
  throw new ReportMigrationError(
    'LEGACY_REPORT_SOURCE_UNRESOLVABLE',
    `Report ${row.report_id} source ${row.source_aggregate_type}:${row.source_aggregate_id} cannot determine its task`
  )
}

function parseLegacySourceResultIds(raw: string | null): unknown {
  if (raw === null) return null
  try {
    return JSON.parse(raw)
  } catch {
    return { legacy_raw: raw }
  }
}

function computeLegacyMetadata(database: DBAdapter, rows: LegacyReportRow[]): LegacyReportMetadata[] {
  const groups = new Map<string, Array<LegacyReportRow & { content: unknown; sourceSet: unknown }>>()
  for (const row of rows) {
    let content: unknown
    try {
      content = JSON.parse(row.report_content_json)
    } catch {
      throw new ReportMigrationError('LEGACY_REPORT_JSON_INVALID', `Report ${row.report_id} has invalid report_content_json`)
    }
    const business = reportBusinessKey(database, row)
    const scope = typeof content === 'object' && content !== null && !Array.isArray(content)
      && typeof (content as Record<string, unknown>).report_scope === 'string'
      ? (content as Record<string, unknown>).report_scope
      : row.report_type === 'SAFETY_TERMINATION_REPORT' ? 'SAFETY' : 'LEGACY'
    const lineageKey = sha256CanonicalJson({
      scope,
      student_id: row.student_id,
      job_code: business.jobCode,
      task_code: business.taskCode,
      source_aggregate_type: row.source_aggregate_type,
      source_aggregate_id: row.source_aggregate_id
    })
    const group = groups.get(lineageKey) ?? []
    group.push({ ...row, content, sourceSet: parseLegacySourceResultIds(row.source_result_ids_json) })
    groups.set(lineageKey, group)
  }

  const metadata: LegacyReportMetadata[] = []
  for (const [lineageKey, group] of groups) {
    const active = group.filter((row) => ['GENERATED', 'EXPORTED', 'LOCKED'].includes(row.status))
    if (active.length > 1) {
      throw new ReportMigrationError(
        'LEGACY_REPORT_LINEAGE_CONFLICT',
        `Legacy report lineage has multiple active reports: ${active.map((row) => row.report_id).join(', ')}`
      )
    }
    group.sort((left, right) => left.generated_at.localeCompare(right.generated_at) || left.report_id.localeCompare(right.report_id))
    for (const [index, row] of group.entries()) {
      const content = parseReportContent(row.content)
      const source = content.valid ? validateReportSourceResultIds(content.value, row.sourceSet) : { valid: false as const }
      metadata.push({
        reportId: row.report_id,
        lineageKey,
        sourceSetHash: sha256CanonicalJson({ legacy_report_id: row.report_id, source_result_ids: row.sourceSet }),
        generationKey: sha256CanonicalJson({ legacy_report_id: row.report_id }),
        contentHash: sha256CanonicalJson(row.content),
        reportRevision: index + 1,
        reportSchemaVersion:
          typeof row.content === 'object' && row.content !== null && !Array.isArray(row.content)
            && typeof (row.content as Record<string, unknown>).report_schema_version === 'string'
            ? (row.content as Record<string, unknown>).report_schema_version as string
            : 'legacy-unknown',
        contractValidationStatus: content.valid && source.valid ? 'VALID' : 'REPAIR_REQUIRED'
      })
    }
  }
  return metadata
}

function backfillLegacyReports(database: DBAdapter): void {
  const rows = database.prepare(`
    SELECT report_id, report_type, student_id, source_aggregate_type, source_aggregate_id,
           source_result_ids_json, report_content_json, generated_at, status
      FROM task_report
     ORDER BY generated_at, report_id
  `).all() as LegacyReportRow[]
  const metadata = computeLegacyMetadata(database, rows)
  const update = database.prepare(`
    UPDATE task_report
       SET lineage_key = ?, source_set_hash = ?, generation_key = ?, content_hash = ?,
           report_revision = ?, report_schema_version = ?, report_builder_version = 'legacy-unknown',
           generation_reason = 'CONTRACT_REPAIR', contract_validation_status = ?
     WHERE report_id = ?
  `)
  for (const row of metadata) {
    update.run(
      row.lineageKey,
      row.sourceSetHash,
      row.generationKey,
      row.contentHash,
      row.reportRevision,
      row.reportSchemaVersion,
      row.contractValidationStatus,
      row.reportId
    )
  }
}

function hasAggregateType(database: DBAdapter, tableName: string): boolean {
  return normalizeSql(tableSql(database, tableName)).includes("'task_closure'")
}

export function isF7ReportFrameworkStructurallyApplied(database: DBAdapter): boolean {
  const reportColumns = tableExists(database, 'task_report') ? columnNames(database, 'task_report') : new Set<string>()
  const closureColumns = tableExists(database, 'task_closure') ? columnNames(database, 'task_closure') : new Set<string>()
  const taskReportSql = normalizeSql(tableSql(database, 'task_report'))
  const closureSql = normalizeSql(tableSql(database, 'task_closure'))
  return (
    hasAggregateType(database, 'domain_event_projection') &&
    hasAggregateType(database, 'error_event_log') &&
    F7_REPORT_COLUMNS.every((column) => reportColumns.has(column)) &&
    F7_TASK_CLOSURE_COLUMNS.every((column) => closureColumns.has(column)) &&
    taskReportSql.includes("contract_validation_status text not null default 'repair_required'") &&
    closureSql.includes("status text not null check (status in ('confirmed', 'superseded'))") &&
    [...F7_TASK_CLOSURE_INDEX_SQL, ...F7_TASK_REPORT_INDEX_SQL].every((sql) => {
      const match = sql.match(/INDEX IF NOT EXISTS ([a-z_]+)/i)
      return match ? indexExists(database, match[1]) : false
    }) &&
    [
      'trg_task_closure_insert_guard',
      'trg_task_closure_bindings_immutable',
      'trg_task_closure_delete_guard',
      'trg_task_closure_status_transition_guard',
      'trg_task_closure_replacement_link_guard',
      'trg_task_report_snapshot_immutable',
      'trg_task_report_contract_valid_for_review_lock_export_insert',
      'trg_task_report_contract_valid_for_review_lock_export_update',
      'trg_task_report_status_transition_guard'
    ].every((name) => triggerExists(database, name))
  )
}

function assertNoPartialF7Structure(database: DBAdapter): void {
  const anyReportColumn = tableExists(database, 'task_report')
    && F7_REPORT_COLUMNS.some((column) => columnNames(database, 'task_report').has(column))
  if ((tableExists(database, 'task_closure') || anyReportColumn || hasAggregateType(database, 'domain_event_projection'))
    && !isF7ReportFrameworkStructurallyApplied(database)) {
    throw new ReportMigrationError('F7_SCHEMA_DRIFT', 'Existing F7 report structure is partial or drifted')
  }
}

export function applyF7ReportFrameworkMigration(database: DBAdapter): void {
  if (isF7ReportFrameworkStructurallyApplied(database)) return
  assertNoPartialF7Structure(database)

  rebuildAggregateCheckTable(database, 'domain_event_projection', F7_DOMAIN_EVENT_PROJECTION_SQL)
  rebuildAggregateCheckTable(database, 'error_event_log', F7_ERROR_EVENT_LOG_SQL)
  database.exec(F7_TASK_CLOSURE_SQL)
  addColumnIfMissing(database, 'task_closure_id', 'task_closure_id TEXT REFERENCES task_closure(task_closure_id)')
  addColumnIfMissing(database, 'repair_of_report_id', 'repair_of_report_id TEXT REFERENCES task_report(report_id)')
  addColumnIfMissing(database, 'lineage_key', 'lineage_key TEXT')
  addColumnIfMissing(database, 'source_set_hash', 'source_set_hash TEXT')
  addColumnIfMissing(database, 'generation_key', 'generation_key TEXT')
  addColumnIfMissing(database, 'content_hash', 'content_hash TEXT')
  addColumnIfMissing(database, 'report_revision', 'report_revision INTEGER CHECK (report_revision IS NULL OR report_revision >= 1)')
  addColumnIfMissing(database, 'report_schema_version', 'report_schema_version TEXT')
  addColumnIfMissing(database, 'report_builder_version', 'report_builder_version TEXT')
  addColumnIfMissing(database, 'generation_reason', "generation_reason TEXT CHECK (generation_reason IS NULL OR generation_reason IN ('NORMAL', 'CONTRACT_REPAIR', 'FACTUAL_CORRECTION', 'DUPLICATE_MERGE'))")
  addColumnIfMissing(database, 'contract_validation_status', "contract_validation_status TEXT NOT NULL DEFAULT 'REPAIR_REQUIRED' CHECK (contract_validation_status IN ('VALID', 'REPAIR_REQUIRED'))")
  addColumnIfMissing(database, 'last_applied_event_id', 'last_applied_event_id TEXT REFERENCES domain_event_projection(event_id)')

  backfillLegacyReports(database)
  dropLegacyReportTriggers(database)
  for (const sql of F7_TASK_CLOSURE_INDEX_SQL) database.exec(sql)
  for (const sql of F7_TASK_REPORT_INDEX_SQL) database.exec(sql)
  database.exec(F7_TASK_CLOSURE_TRIGGER_SQL)
  database.exec(F7_TASK_REPORT_TRIGGER_SQL)
  database.exec(`
INSERT OR IGNORE INTO error_code_registry (
  error_code, error_category, severity, priority_level, title, default_message, default_recovery_hint, is_blocking
) VALUES
  (
    'STARTUP_RECOVERY_REQUIRED', 'RECOVERY', 'CRITICAL', 'P0', '数据库需要恢复',
    '旧事件日志或报告快照无法安全升级。', '保留当前文件并联系维护人员执行恢复。', 1
  ),
  (
    'REPORT_EXPORT_FAILED', 'REPORT', 'ERROR', 'P2', '报告导出失败',
    '报告 HTML 文件导出失败。', '保留报告快照，允许重新导出。', 0
  );`)

  if (!isF7ReportFrameworkStructurallyApplied(database)) {
    throw new ReportMigrationError('F7_SCHEMA_DRIFT', 'F7 migration did not produce the required structure')
  }
}
