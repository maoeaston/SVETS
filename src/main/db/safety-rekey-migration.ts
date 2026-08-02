import type { DBAdapter } from './interface'
import {
  F7_REPORT_FRAMEWORK_MIGRATION_ID,
  isF7ReportFrameworkStructurallyApplied
} from './report-migration'

export const M4_SCHEMA_VERSION = '0.1.17-multi-device-m4-safety-rekey'
export const M4_SAFETY_REKEY_MIGRATION_ID =
  '2026-07-27_mvp_schema_v0_1_17_multi_device_m4_safety_rekey'

export type M4StructureState = 'LEGACY_V016' | 'CURRENT_M4' | 'PARTIAL_OR_DRIFTED'

export class M4SafetyRekeyMigrationError extends Error {
  constructor(
    public readonly code: 'M4_SCHEMA_DRIFT' | 'M4_HISTORY_KEY_MISMATCH' | 'M4_F7_REQUIRED',
    message: string,
    public readonly issues: string[] = []
  ) {
    super(message)
    this.name = 'M4SafetyRekeyMigrationError'
  }
}

const OPEN_ASSESSMENT = "('INIT', 'ACTIVE', 'EMOTION_INTERRUPTED', 'SUSPENDED_REVIEW_REQUIRED', 'OFFLINE_PENDING')"
const OPEN_TRAINING = "('INIT', 'ACTIVE', 'EMOTION_INTERRUPTED', 'SUSPENDED_REVIEW_REQUIRED')"

const LEGACY_INDEX_SQL = [
  'CREATE INDEX idx_assessment_session_student_task_status ON assessment_session(student_id, task_code, status)',
  `CREATE UNIQUE INDEX ux_assessment_one_open_session_per_student_task_strategy ON assessment_session(student_id, task_code, strategy_type) WHERE status IN ${OPEN_ASSESSMENT}`,
  'CREATE INDEX idx_training_session_student_task_status ON training_session(student_id, task_code, status)',
  `CREATE UNIQUE INDEX ux_training_one_open_session_per_student_task ON training_session(student_id, task_code) WHERE status IN ${OPEN_TRAINING}`,
  'CREATE INDEX idx_safety_incident_student_task_status ON safety_incident(student_id, task_code, status, requires_review_before_next_session)'
] as const

const CURRENT_INDEX_SQL = [
  'CREATE INDEX idx_assessment_session_student_job_task_status ON assessment_session(student_id, job_code, task_code, status)',
  `CREATE UNIQUE INDEX ux_assessment_one_open_session_per_student_job_task_strategy ON assessment_session(student_id, job_code, task_code, strategy_type) WHERE status IN ${OPEN_ASSESSMENT}`,
  'CREATE INDEX idx_training_session_student_job_task_status ON training_session(student_id, job_code, task_code, status)',
  `CREATE UNIQUE INDEX ux_training_one_open_session_per_student_job_task ON training_session(student_id, job_code, task_code) WHERE status IN ${OPEN_TRAINING}`,
  'CREATE INDEX idx_safety_incident_student_job_task_status ON safety_incident(student_id, job_code, task_code, status, requires_review_before_next_session)'
] as const

function redlineTrigger(table: 'assessment_session' | 'training_session', operation: 'INSERT' | 'UPDATE', keyed: boolean, formalOnly = false): string {
  const aggregate = table === 'assessment_session' ? 'assessment_session' : 'training_session'
  const suffix = keyed ? 'same_student_job_task' : 'same_student_task'
  const jobPredicate = keyed ? '\n         AND si.job_code = NEW.job_code' : ''
  const message = keyed ? 'same student_id, job_code and task_code' : 'same student_id and task_code'
  const shellPredicate = formalOnly && table === 'assessment_session'
    ? "\n     AND NEW.session_contract_kind = 'FORMAL_SHELL'"
    : ''
  return `CREATE TRIGGER trg_${aggregate}_redline_incident_${suffix}_${operation.toLowerCase()}
BEFORE ${operation} ON ${table}
FOR EACH ROW
WHEN NEW.status = 'REDLINE_HALTED'
     ${shellPredicate}
     AND NOT EXISTS (
       SELECT 1 FROM safety_incident si
       WHERE si.incident_id = NEW.redline_incident_id
         AND si.student_id = NEW.student_id${jobPredicate}
         AND si.task_code = NEW.task_code
     )
BEGIN
  SELECT RAISE(ABORT, '${aggregate} redline_incident_id must belong to ${message}');
END`
}

function unresolvedTrigger(table: 'assessment_session' | 'training_session', keyed: boolean, formalOnly = false): string {
  const aggregate = table === 'assessment_session' ? 'assessment_session' : 'training_session'
  const jobPredicate = keyed ? '\n    AND si.job_code = NEW.job_code' : ''
  const shellPredicate = formalOnly && table === 'assessment_session'
    ? "NEW.session_contract_kind = 'FORMAL_SHELL' AND "
    : ''
  return `CREATE TRIGGER trg_${aggregate}_block_unresolved_safety_incident
BEFORE INSERT ON ${table}
FOR EACH ROW
WHEN ${shellPredicate}EXISTS (
  SELECT 1 FROM safety_incident si
  WHERE si.student_id = NEW.student_id${jobPredicate}
    AND si.task_code = NEW.task_code
    AND si.requires_review_before_next_session = 1
    AND si.status IN ('PENDING_DETAIL', 'CONFIRMED')
)
BEGIN
  SELECT RAISE(ABORT, 'unresolved safety incident blocks new ${aggregate}');
END`
}

function replacementTrigger(operation: 'INSERT' | 'UPDATE', keyed: boolean): string {
  const suffix = keyed ? 'same_student_job_task' : 'same_student_task'
  const jobPredicate = keyed ? ' AND r.job_code = NEW.job_code' : ''
  const message = keyed ? 'same student_id + job_code + task_code' : 'same student_id + task_code'
  return `CREATE TRIGGER trg_safety_incident_replacement_${suffix}_${operation.toLowerCase()}
BEFORE ${operation} ON safety_incident
FOR EACH ROW
WHEN NEW.replacement_incident_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM safety_incident r
       WHERE r.incident_id = NEW.replacement_incident_id
         AND r.student_id = NEW.student_id${jobPredicate} AND r.task_code = NEW.task_code
     )
BEGIN
  SELECT RAISE(ABORT, 'replacement safety_incident must have ${message}');
END`
}

function bindOpenTrigger(table: 'assessment_session' | 'training_session', keyed: boolean, formalOnly = false): string {
  const isAssessment = table === 'assessment_session'
  const aggregateType = isAssessment ? 'ASSESSMENT_SESSION' : 'TRAINING_SESSION'
  const idColumn = isAssessment ? 'session_id' : 'training_session_id'
  const alias = isAssessment ? 's' : 't'
  const open = isAssessment ? OPEN_ASSESSMENT : OPEN_TRAINING
  const assignment = isAssessment
    ? `      level_result = 'LEVEL_FAIL_BY_SAFETY',
      report_type = 'SAFETY_TERMINATION_REPORT',`
    : ''
  const jobPredicate = keyed ? ` AND ${alias}.job_code = NEW.job_code` : ''
  const selectShellPredicate = formalOnly && isAssessment
    ? ` AND ${alias}.session_contract_kind = 'FORMAL_SHELL'`
    : ''
  const updateShellPredicate = formalOnly && isAssessment
    ? " AND session_contract_kind = 'FORMAL_SHELL'"
    : ''
  return `CREATE TRIGGER trg_safety_incident_bind_open_${isAssessment ? 'assessments' : 'trainings'}
AFTER INSERT ON safety_incident
FOR EACH ROW
WHEN NEW.status IN ('PENDING_DETAIL', 'CONFIRMED')
BEGIN
  INSERT OR IGNORE INTO safety_incident_binding (
    binding_id, incident_id, aggregate_type, aggregate_id,
    pre_status, post_status, halt_event_id, created_at
  )
  SELECT
    NEW.incident_id || ':${aggregateType}:' || ${alias}.${idColumn},
    NEW.incident_id, '${aggregateType}', ${alias}.${idColumn},
    ${alias}.status, 'REDLINE_HALTED', NEW.trigger_event_id, datetime('now')
  FROM ${table} ${alias}
  WHERE ${alias}.student_id = NEW.student_id${jobPredicate} AND ${alias}.task_code = NEW.task_code${selectShellPredicate}
    AND ${alias}.status IN ${open};

  UPDATE ${table}
  SET status = 'REDLINE_HALTED',
      redline_incident_id = NEW.incident_id,
${assignment}
      completed_at = COALESCE(completed_at, datetime('now')),
      updated_at = datetime('now'),
      last_status_event_id = NEW.trigger_event_id,
      last_applied_event_id = NEW.trigger_event_id
  WHERE student_id = NEW.student_id${keyed ? ' AND job_code = NEW.job_code' : ''} AND task_code = NEW.task_code${updateShellPredicate}
    AND status IN ${open};
END`
}

const LEGACY_TRIGGER_SQL = [
  redlineTrigger('assessment_session', 'INSERT', false),
  redlineTrigger('assessment_session', 'UPDATE', false),
  redlineTrigger('training_session', 'INSERT', false),
  redlineTrigger('training_session', 'UPDATE', false),
  unresolvedTrigger('assessment_session', false),
  unresolvedTrigger('training_session', false),
  replacementTrigger('INSERT', false),
  replacementTrigger('UPDATE', false),
  bindOpenTrigger('assessment_session', false),
  bindOpenTrigger('training_session', false)
] as const

const CURRENT_TRIGGER_SQL = [
  redlineTrigger('assessment_session', 'INSERT', true),
  redlineTrigger('assessment_session', 'UPDATE', true),
  redlineTrigger('training_session', 'INSERT', true),
  redlineTrigger('training_session', 'UPDATE', true),
  unresolvedTrigger('assessment_session', true),
  unresolvedTrigger('training_session', true),
  replacementTrigger('INSERT', true),
  replacementTrigger('UPDATE', true),
  bindOpenTrigger('assessment_session', true),
  bindOpenTrigger('training_session', true)
] as const

// PREVIEW_CONTRACT_V1 keeps the historical M4 trigger names but narrows the
// assessment side to FORMAL_SHELL. The legacy form remains valid for a
// pre-preview database; the preview-aware form is the current fresh schema.
const CURRENT_PREVIEW_AWARE_TRIGGER_SQL = [
  redlineTrigger('assessment_session', 'INSERT', true, true),
  redlineTrigger('assessment_session', 'UPDATE', true, true),
  redlineTrigger('training_session', 'INSERT', true),
  redlineTrigger('training_session', 'UPDATE', true),
  unresolvedTrigger('assessment_session', true, true),
  unresolvedTrigger('training_session', true),
  replacementTrigger('INSERT', true),
  replacementTrigger('UPDATE', true),
  bindOpenTrigger('assessment_session', true, true),
  bindOpenTrigger('training_session', true)
] as const

/** Frozen DDL contracts, shared by migration tests without exposing a down-migration. */
export function m4SafetyRekeyObjectSql(state: 'LEGACY_V016' | 'CURRENT_M4'): readonly string[] {
  return state === 'LEGACY_V016'
    ? [...LEGACY_TRIGGER_SQL, ...LEGACY_INDEX_SQL]
    : [...CURRENT_TRIGGER_SQL, ...CURRENT_INDEX_SQL]
}

/** Object SQL contract used by the additive PREVIEW_CONTRACT_V1 schema. */
export function m4SafetyRekeyPreviewAwareObjectSql(): readonly string[] {
  return [...CURRENT_PREVIEW_AWARE_TRIGGER_SQL, ...CURRENT_INDEX_SQL]
}

function normalizeSql(sql: string | null | undefined): string {
  return (sql ?? '')
    .replace(/\bIF\s+NOT\s+EXISTS\b/gi, '')
    .replace(/;\s*$/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([(),])\s*/g, '$1')
    .trim()
    .toLowerCase()
}

function objectName(sql: string): string {
  const match = sql.match(/(?:TRIGGER|INDEX(?:\s+IF\s+NOT\s+EXISTS)?)\s+([a-z_]+)/i)
  if (!match) throw new Error(`[DB] M4 object SQL has no name: ${sql.slice(0, 60)}`)
  return match[1]
}

function sqliteObjectSql(database: DBAdapter, type: 'index' | 'trigger', name: string): string | null {
  const row = database.prepare('SELECT sql FROM sqlite_master WHERE type = ? AND name = ?').get(type, name) as
    | { sql: string | null }
    | undefined
  return row?.sql ?? null
}

function objectMatches(database: DBAdapter, type: 'index' | 'trigger', sql: string): boolean {
  return normalizeSql(sqliteObjectSql(database, type, objectName(sql))) === normalizeSql(sql)
}

const LEGACY_RENAMED_OBJECTS = [
  'trg_assessment_session_redline_incident_same_student_task_insert',
  'trg_assessment_session_redline_incident_same_student_task_update',
  'trg_training_session_redline_incident_same_student_task_insert',
  'trg_training_session_redline_incident_same_student_task_update',
  'trg_safety_incident_replacement_same_student_task_insert',
  'trg_safety_incident_replacement_same_student_task_update',
  ...LEGACY_INDEX_SQL.map(objectName)
]

const CURRENT_RENAMED_OBJECTS = [
  'trg_assessment_session_redline_incident_same_student_job_task_insert',
  'trg_assessment_session_redline_incident_same_student_job_task_update',
  'trg_training_session_redline_incident_same_student_job_task_insert',
  'trg_training_session_redline_incident_same_student_job_task_update',
  'trg_safety_incident_replacement_same_student_job_task_insert',
  'trg_safety_incident_replacement_same_student_job_task_update',
  ...CURRENT_INDEX_SQL.map(objectName)
]

function allMatch(database: DBAdapter, triggerSql: readonly string[], indexSql: readonly string[]): boolean {
  return triggerSql.every((sql) => objectMatches(database, 'trigger', sql))
    && indexSql.every((sql) => objectMatches(database, 'index', sql))
}

function anyObjectExists(database: DBAdapter, names: readonly string[]): boolean {
  return names.some((name) => sqliteObjectSql(database, name.startsWith('trg_') ? 'trigger' : 'index', name) !== null)
}

export function inspectM4SafetyRekeyStructure(database: DBAdapter): M4StructureState {
  const legacy = allMatch(database, LEGACY_TRIGGER_SQL, LEGACY_INDEX_SQL)
    && !anyObjectExists(database, CURRENT_RENAMED_OBJECTS)
  if (legacy) return 'LEGACY_V016'
  const current = (
    allMatch(database, CURRENT_TRIGGER_SQL, CURRENT_INDEX_SQL)
    || allMatch(database, CURRENT_PREVIEW_AWARE_TRIGGER_SQL, CURRENT_INDEX_SQL)
  )
    && !anyObjectExists(database, LEGACY_RENAMED_OBJECTS)
  if (current) return 'CURRENT_M4'
  return 'PARTIAL_OR_DRIFTED'
}

/** Stable, non-sensitive diagnostic for migration tests and startup orchestration. */
export function m4SafetyRekeyStructureIssues(database: DBAdapter): string[] {
  const legacyIssues = [
    ...LEGACY_TRIGGER_SQL.filter((sql) => !objectMatches(database, 'trigger', sql)).map((sql) => `legacy-trigger:${objectName(sql)}`),
    ...LEGACY_INDEX_SQL.filter((sql) => !objectMatches(database, 'index', sql)).map((sql) => `legacy-index:${objectName(sql)}`)
  ]
  const currentIssues = [
    ...CURRENT_TRIGGER_SQL.filter((sql) => !objectMatches(database, 'trigger', sql)).map((sql) => `current-trigger:${objectName(sql)}`),
    ...CURRENT_INDEX_SQL.filter((sql) => !objectMatches(database, 'index', sql)).map((sql) => `current-index:${objectName(sql)}`)
  ]
  return [...legacyIssues, ...currentIssues]
}

function count(database: DBAdapter, sql: string): number {
  return ((database.prepare(sql).get() as { count?: number } | undefined)?.count ?? 0) as number
}

export function preflightM4SafetyRekeyHistory(database: DBAdapter): void {
  if (!isF7ReportFrameworkStructurallyApplied(database)) {
    throw new M4SafetyRekeyMigrationError('M4_F7_REQUIRED', 'M4 requires complete F7 structure before history preflight')
  }
  const f7Ledger = database.prepare('SELECT 1 AS present FROM schema_migration WHERE migration_id = ?')
    .get(F7_REPORT_FRAMEWORK_MIGRATION_ID) as { present: number } | undefined
  if (!f7Ledger) {
    throw new M4SafetyRekeyMigrationError('M4_F7_REQUIRED', 'M4 requires F7 migration ledger before history preflight')
  }

  const issues: string[] = []
  const emptyJob = [
    ['incident', 'safety_incident'], ['assessment', 'assessment_session'], ['training', 'training_session']
  ] as const
  for (const [label, table] of emptyJob) {
    const found = count(database, `SELECT COUNT(*) AS count FROM ${table} WHERE job_code IS NULL OR length(trim(job_code)) = 0`)
    if (found) issues.push(`empty-job:${label}:${found}`)
  }
  const strategyMismatch = count(database, `
    SELECT COUNT(*) AS count FROM (
      SELECT session_id AS id FROM assessment_session s WHERE NOT EXISTS (
        SELECT 1 FROM strategy_config sc WHERE sc.strategy_id = s.strategy_id AND sc.strategy_type = s.strategy_type AND sc.job_code = s.job_code AND sc.version = s.strategy_version
      )
      UNION ALL
      SELECT training_session_id AS id FROM training_session s WHERE NOT EXISTS (
        SELECT 1 FROM strategy_config sc WHERE sc.strategy_id = s.strategy_id AND sc.strategy_type = s.strategy_type AND sc.job_code = s.job_code AND sc.version = s.strategy_version
      )
    )`)
  if (strategyMismatch) issues.push(`strategy-key-mismatch:${strategyMismatch}`)
  const redlineOrphan = count(database, `
    SELECT COUNT(*) AS count FROM (
      SELECT s.session_id AS id FROM assessment_session s
      WHERE s.status = 'REDLINE_HALTED' AND NOT EXISTS (
        SELECT 1 FROM safety_incident si WHERE si.incident_id = s.redline_incident_id
      )
      UNION ALL
      SELECT s.training_session_id AS id FROM training_session s
      WHERE s.status = 'REDLINE_HALTED' AND NOT EXISTS (
        SELECT 1 FROM safety_incident si WHERE si.incident_id = s.redline_incident_id
      )
    )`)
  if (redlineOrphan) issues.push(`redline-incident-orphan:${redlineOrphan}`)
  const redlineMismatch = count(database, `
    SELECT COUNT(*) AS count FROM (
      SELECT s.session_id AS id FROM assessment_session s JOIN safety_incident si ON si.incident_id = s.redline_incident_id
       WHERE s.status = 'REDLINE_HALTED' AND (si.student_id <> s.student_id OR si.job_code <> s.job_code OR si.task_code <> s.task_code)
      UNION ALL
      SELECT s.training_session_id AS id FROM training_session s JOIN safety_incident si ON si.incident_id = s.redline_incident_id
       WHERE s.status = 'REDLINE_HALTED' AND (si.student_id <> s.student_id OR si.job_code <> s.job_code OR si.task_code <> s.task_code)
    )`)
  if (redlineMismatch) issues.push(`redline-key-mismatch:${redlineMismatch}`)
  const bindingOrphan = count(database, `
    SELECT COUNT(*) AS count FROM safety_incident_binding b
    WHERE NOT EXISTS (
      SELECT 1 FROM safety_incident si WHERE si.incident_id = b.incident_id
    )`)
  if (bindingOrphan) issues.push(`binding-incident-orphan:${bindingOrphan}`)
  const bindingMismatch = count(database, `
    SELECT COUNT(*) AS count FROM safety_incident_binding b
    JOIN safety_incident si ON si.incident_id = b.incident_id
    WHERE (b.aggregate_type = 'ASSESSMENT_SESSION' AND NOT EXISTS (
      SELECT 1 FROM assessment_session s WHERE s.session_id = b.aggregate_id AND s.student_id = si.student_id AND s.job_code = si.job_code AND s.task_code = si.task_code
    )) OR (b.aggregate_type = 'TRAINING_SESSION' AND NOT EXISTS (
      SELECT 1 FROM training_session t WHERE t.training_session_id = b.aggregate_id AND t.student_id = si.student_id AND t.job_code = si.job_code AND t.task_code = si.task_code
    ))`)
  if (bindingMismatch) issues.push(`binding-key-mismatch:${bindingMismatch}`)
  const replacementOrphan = count(database, `
    SELECT COUNT(*) AS count FROM safety_incident s
    WHERE s.replacement_incident_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM safety_incident r WHERE r.incident_id = s.replacement_incident_id
    )`)
  if (replacementOrphan) issues.push(`replacement-incident-orphan:${replacementOrphan}`)
  const replacementMismatch = count(database, `
    SELECT COUNT(*) AS count FROM safety_incident s JOIN safety_incident r ON r.incident_id = s.replacement_incident_id
    WHERE s.replacement_incident_id IS NOT NULL AND (s.student_id <> r.student_id OR s.job_code <> r.job_code OR s.task_code <> r.task_code)`)
  if (replacementMismatch) issues.push(`replacement-key-mismatch:${replacementMismatch}`)
  if (issues.length > 0) {
    throw new M4SafetyRekeyMigrationError(
      'M4_HISTORY_KEY_MISMATCH',
      `[DB] M4 history preflight failed: ${issues.join(', ')}`,
      issues
    )
  }
}

export function applyM4SafetyRekeyMigration(database: DBAdapter): void {
  const state = inspectM4SafetyRekeyStructure(database)
  if (state === 'CURRENT_M4') return
  if (state !== 'LEGACY_V016') {
    throw new M4SafetyRekeyMigrationError('M4_SCHEMA_DRIFT', 'M4 requires an exact v0.1.16 safety structure')
  }
  preflightM4SafetyRekeyHistory(database)
  for (const sql of m4SafetyRekeyObjectSql('LEGACY_V016')) {
    database.exec(`DROP ${sql.startsWith('CREATE TRIGGER') ? 'TRIGGER' : 'INDEX'} ${objectName(sql)};`)
  }
  for (const sql of m4SafetyRekeyObjectSql('CURRENT_M4')) database.exec(`${sql};`)
  if (inspectM4SafetyRekeyStructure(database) !== 'CURRENT_M4') {
    throw new M4SafetyRekeyMigrationError('M4_SCHEMA_DRIFT', 'M4 migration did not produce the required safety structure')
  }
}
