import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { MemoryAdapter } from '../memory-adapter'
import {
  F7_REPORT_FRAMEWORK_MIGRATION_ID,
  isF7ReportFrameworkStructurallyApplied
} from '../report-migration'

async function createFreshDatabase(): Promise<MemoryAdapter> {
  const db = await MemoryAdapter.create()
  db.exec(readFileSync(resolve(process.cwd(), 'src/main/db/schema.sql'), 'utf8'))
  return db
}

function insertReportDependencies(db: MemoryAdapter): void {
  db.exec(`
    INSERT INTO user_account (user_id, username, password_hash, role, display_name, status)
    VALUES ('teacher-f7', 'teacher-f7', 'hash', 'TEACHER', '教师', 'ACTIVE');
    INSERT INTO student_profile (student_id, student_name, status)
    VALUES ('student-f7', '学生', 'ACTIVE');
    INSERT INTO domain_event_projection
      (event_id, aggregate_type, aggregate_id, event_type, event_sequence, payload_json, checksum, source_log_path)
    VALUES ('event-report-f7', 'TASK_REPORT', 'report-f7', 'REPORT_GENERATED', 1, '{}', 'checksum', 'test-log');
  `)
}

describe('F7 report framework fresh schema', () => {
  it('creates the closure/report structures and records the F7 baseline', async () => {
    const db = await createFreshDatabase()

    expect(isF7ReportFrameworkStructurallyApplied(db)).toBe(true)
    expect(
      db.prepare("SELECT schema_version FROM schema_migration WHERE migration_id = ?").get(F7_REPORT_FRAMEWORK_MIGRATION_ID)
    ).toMatchObject({ schema_version: '0.1.16-report-framework' })
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM pragma_table_info('task_report') WHERE name IN ('lineage_key', 'content_hash', 'contract_validation_status')").get()
    ).toMatchObject({ count: 3 })
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name = 'trg_task_closure_bindings_immutable'").get()
    ).toMatchObject({ count: 1 })
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    db.close()
  })

  it('blocks repair-required reports from being locked, freezes content, and permits lifecycle retirement of a locked snapshot', async () => {
    const db = await createFreshDatabase()
    insertReportDependencies(db)
    db.prepare(`
      INSERT INTO task_report
        (report_id, report_type, student_id, report_title, report_content_json,
         generated_event_id, generated_by, generated_at, status)
      VALUES (?, 'FULL_REPORT', ?, '待修复报告', '{}', ?, ?, '2026-07-24T00:00:00.000Z', 'GENERATED')
    `).run('report-f7', 'student-f7', 'event-report-f7', 'teacher-f7')

    expect(() => db.prepare("UPDATE task_report SET status = 'LOCKED' WHERE report_id = 'report-f7'").run())
      .toThrow('VALID report contract is required')
    expect(() => db.prepare("UPDATE task_report SET report_content_json = '{\"changed\":true}' WHERE report_id = 'report-f7'").run())
      .toThrow('task_report snapshot facts are immutable')
    db.prepare("UPDATE task_report SET contract_validation_status = 'VALID' WHERE report_id = 'report-f7'").run()
    db.prepare("UPDATE task_report SET status = 'LOCKED' WHERE report_id = 'report-f7'").run()
    expect(() => db.prepare("UPDATE task_report SET status = 'SUPERSEDED' WHERE report_id = 'report-f7'").run()).not.toThrow()
    db.close()
  })

  it('rejects a task closure whose three result bindings cannot be verified', async () => {
    const db = await createFreshDatabase()
    insertReportDependencies(db)
    db.prepare(`
      INSERT INTO domain_event_projection
        (event_id, aggregate_type, aggregate_id, event_type, event_sequence, payload_json, checksum, source_log_path)
      VALUES (?, 'TASK_CLOSURE', 'closure-f7', 'TASK_CLOSURE_CONFIRMED', 1, '{}', 'checksum', 'test-log')
    `).run('event-closure-f7')

    expect(() => db.prepare(`
      INSERT INTO task_closure (
        task_closure_id, student_id, job_code, task_code, cycle_no, closure_revision, status, is_cycle_head,
        ability_result_id, training_completion_result_id, operation_pass_rate_result_id,
        ability_source_aggregate_id, training_source_aggregate_id, operation_source_aggregate_id,
        confirmed_by, confirmed_event_id, confirmed_at
      ) VALUES (
        'closure-f7', 'student-f7', 'SUPERMARKET_SHELVER', 'UNBOX_AND_SHELF', 1, 1, 'CONFIRMED', 1,
        'missing-ability', 'missing-training', 'missing-operation',
        'assessment-1', 'training-1', 'assessment-1', 'teacher-f7', 'event-closure-f7', '2026-07-24T00:00:00.000Z'
      )
    `).run()).toThrow('task_closure binding')
    db.close()
  })
})
