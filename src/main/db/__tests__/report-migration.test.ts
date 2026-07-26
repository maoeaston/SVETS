import { describe, expect, it } from 'vitest'
import { MemoryAdapter } from '../memory-adapter'
import {
  applyF7ReportFrameworkMigration,
  F7_REPORT_FRAMEWORK_MIGRATION_ID,
  isF7ReportFrameworkStructurallyApplied,
  ReportMigrationError
} from '../report-migration'

const LEGACY_SCHEMA = `
CREATE TABLE schema_migration (
  migration_id TEXT PRIMARY KEY, schema_version TEXT NOT NULL, description TEXT, applied_at TEXT
);
CREATE TABLE user_account (user_id TEXT PRIMARY KEY, username TEXT, password_hash TEXT, role TEXT, display_name TEXT, status TEXT);
CREATE TABLE student_profile (student_id TEXT PRIMARY KEY, student_name TEXT, status TEXT);
CREATE TABLE result_record (result_id TEXT PRIMARY KEY);
CREATE TABLE assessment_session (session_id TEXT PRIMARY KEY, job_code TEXT, task_code TEXT, status TEXT);
CREATE TABLE training_session (training_session_id TEXT PRIMARY KEY, job_code TEXT, task_code TEXT, status TEXT);
CREATE TABLE safety_incident (incident_id TEXT PRIMARY KEY, job_code TEXT, task_code TEXT);
CREATE TABLE domain_event_projection (
  event_id TEXT PRIMARY KEY,
  aggregate_type TEXT NOT NULL CHECK (aggregate_type IN ('ASSESSMENT_SESSION','TRAINING_SESSION','STUDENT_PROFILE','STRATEGY_CONFIG','QUESTION_BANK','BUSINESS_SESSION','TASK_REPORT','SAFETY_INCIDENT','ASSET_RESOURCE','SYSTEM')),
  aggregate_id TEXT NOT NULL, event_type TEXT NOT NULL, event_sequence INTEGER NOT NULL,
  payload_json TEXT NOT NULL, checksum TEXT NOT NULL, source_log_path TEXT NOT NULL,
  source_log_line_no INTEGER, source_log_byte_offset INTEGER, schema_version INTEGER NOT NULL DEFAULT 1,
  sitting_no INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  applied_to_snapshot INTEGER NOT NULL DEFAULT 0, applied_at TEXT,
  UNIQUE (aggregate_type, aggregate_id, event_sequence)
);
CREATE TABLE error_code_registry (
  error_code TEXT PRIMARY KEY, error_category TEXT, severity TEXT, priority_level TEXT,
  title TEXT, default_message TEXT, default_recovery_hint TEXT, is_blocking INTEGER,
  created_at TEXT, updated_at TEXT
);
CREATE TABLE error_event_log (
  error_event_id TEXT PRIMARY KEY, error_code TEXT NOT NULL REFERENCES error_code_registry(error_code),
  severity TEXT NOT NULL, error_category TEXT NOT NULL,
  related_aggregate_type TEXT CHECK (related_aggregate_type IS NULL OR related_aggregate_type IN ('ASSESSMENT_SESSION','TRAINING_SESSION','STUDENT_PROFILE','STRATEGY_CONFIG','QUESTION_BANK','TASK_REPORT','SAFETY_INCIDENT','ASSET_RESOURCE','SYSTEM')),
  related_aggregate_id TEXT, related_event_id TEXT REFERENCES domain_event_projection(event_id), message TEXT NOT NULL,
  context_json TEXT, stack_trace TEXT, recovery_action TEXT, recovery_status TEXT NOT NULL DEFAULT 'UNRESOLVED',
  created_at TEXT NOT NULL DEFAULT (datetime('now')), resolved_at TEXT
);
CREATE TABLE task_report (
  report_id TEXT PRIMARY KEY,
  report_type TEXT NOT NULL,
  student_id TEXT REFERENCES student_profile(student_id),
  source_aggregate_type TEXT,
  source_aggregate_id TEXT,
  source_result_ids_json TEXT,
  report_title TEXT NOT NULL,
  report_content_json TEXT NOT NULL,
  file_asset_id TEXT,
  file_path TEXT,
  file_hash TEXT,
  snapshot_id TEXT,
  generated_event_id TEXT NOT NULL REFERENCES domain_event_projection(event_id),
  generated_by TEXT NOT NULL REFERENCES user_account(user_id),
  generated_at TEXT NOT NULL,
  placement_review_by TEXT,
  placement_review_at TEXT,
  status TEXT NOT NULL DEFAULT 'GENERATED'
);
CREATE INDEX idx_task_report_student_type ON task_report(student_id, report_type, generated_at);
CREATE INDEX idx_task_report_source ON task_report(source_aggregate_type, source_aggregate_id);
`

async function createLegacyDatabase(): Promise<MemoryAdapter> {
  const db = await MemoryAdapter.create()
  db.exec(LEGACY_SCHEMA)
  db.exec(`
    INSERT INTO user_account VALUES ('teacher-migration', 'teacher-migration', 'hash', 'TEACHER', '教师', 'ACTIVE');
    INSERT INTO student_profile VALUES ('student-migration', '学生', 'ACTIVE');
    INSERT INTO safety_incident VALUES ('incident-migration', 'SUPERMARKET_SHELVER', 'UNBOX_AND_SHELF');
    INSERT INTO domain_event_projection
      (event_id, aggregate_type, aggregate_id, event_type, event_sequence, payload_json, checksum, source_log_path)
    VALUES ('event-migration', 'TASK_REPORT', 'report-migration', 'REPORT_GENERATED', 1, '{}', 'checksum', 'test-log');
  `)
  return db
}

function insertLegacyReport(db: MemoryAdapter, reportId: string, status = 'GENERATED', content = '{}'): void {
  db.prepare(`
    INSERT INTO task_report (
      report_id, report_type, student_id, source_aggregate_type, source_aggregate_id,
      source_result_ids_json, report_title, report_content_json,
      generated_event_id, generated_by, generated_at, status
    ) VALUES (?, 'SAFETY_TERMINATION_REPORT', 'student-migration', 'SAFETY_INCIDENT', 'incident-migration',
      '[]', '旧报告', ?, 'event-migration', 'teacher-migration', ?, ?)
  `).run(reportId, content, `2026-07-24T00:00:0${reportId.at(-1)}.000Z`, status)
}

describe('F7 report migration', () => {
  it('backfills legacy report lineage metadata without presenting an invalid snapshot as valid', async () => {
    const db = await createLegacyDatabase()
    insertLegacyReport(db, 'report-migration-1')

    db.transaction(() => applyF7ReportFrameworkMigration(db))()

    expect(isF7ReportFrameworkStructurallyApplied(db)).toBe(true)
    expect(db.prepare(`
      SELECT report_builder_version, report_revision, contract_validation_status,
             length(lineage_key) AS lineage_length, length(content_hash) AS content_length
        FROM task_report WHERE report_id = 'report-migration-1'
    `).get()).toMatchObject({
      report_builder_version: 'legacy-unknown',
      report_revision: 1,
      contract_validation_status: 'REPAIR_REQUIRED',
      lineage_length: 64,
      content_length: 64
    })
    expect(() => db.prepare("UPDATE task_report SET status = 'LOCKED' WHERE report_id = 'report-migration-1'").run())
      .toThrow('VALID report contract is required')
    expect(db.prepare("SELECT COUNT(*) AS count FROM schema_migration WHERE migration_id = ?").get(F7_REPORT_FRAMEWORK_MIGRATION_ID))
      .toMatchObject({ count: 0 })
    db.close()
  })

  it('fails closed and rolls back when a legacy lineage has multiple active reports', async () => {
    const db = await createLegacyDatabase()
    insertLegacyReport(db, 'report-migration-1')
    db.prepare(`
      INSERT INTO domain_event_projection
        (event_id, aggregate_type, aggregate_id, event_type, event_sequence, payload_json, checksum, source_log_path)
      VALUES ('event-migration-2', 'TASK_REPORT', 'report-migration-2', 'REPORT_GENERATED', 1, '{}', 'checksum', 'test-log')
    `).run()
    db.prepare("UPDATE task_report SET generated_event_id = 'event-migration-2' WHERE report_id = 'report-migration-1'").run()
    insertLegacyReport(db, 'report-migration-2')

    const apply = () => db.transaction(() => applyF7ReportFrameworkMigration(db))()
    expect(apply).toThrow(ReportMigrationError)
    expect(apply).toThrow('multiple active reports')
    expect(db.prepare("SELECT COUNT(*) AS count FROM pragma_table_info('task_report') WHERE name = 'lineage_key'").get())
      .toMatchObject({ count: 0 })
    db.close()
  })
})
