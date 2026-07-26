import { createHash } from 'crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import {
  createTestDb,
  seedCaller,
  seedStudent
} from '../../../db/test-helpers'
import type { DBAdapter } from '../../../db/interface'
import type { MemoryAdapter } from '../../../db/memory-adapter'
import { buildSafetyReport } from '../../../domain/report-builders'
import { exportReport } from '../reports'

const ISO = '2026-07-26T00:00:00.000Z'
const JOB_CODE = 'SUPERMARKET_SHELVER'
const TASK_CODE = 'SHELVE_TASK'

let db: MemoryAdapter
let teacherId: string
let adminId: string
let studentId: string
const dirs: string[] = []

beforeEach(async () => {
  db = await createTestDb()
  teacherId = seedCaller(db, 'TEACHER')
  adminId = seedCaller(db, 'ADMIN')
  studentId = seedStudent(db)
  db.prepare('UPDATE student_profile SET student_name = ? WHERE student_id = ?')
    .run('<script>王小明</script>', studentId)
})

afterEach(() => {
  db.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

function logPath(): string {
  return join(tempDir('svets-report-export-log-'), 'action_log.jsonl')
}

function seedProjectionEvent(db: DBAdapter, aggregateType: string, aggregateId: string, eventType = 'REPORT_GENERATED'): string {
  const eventId = uuidv4()
  db.prepare(
    `INSERT INTO domain_event_projection
       (event_id, aggregate_type, aggregate_id, event_type, event_sequence,
        payload_json, checksum, source_log_path, schema_version, created_at)
     VALUES (?, ?, ?, ?, 1, '{}', 'test', 'test', 2, ?)`
  ).run(eventId, aggregateType, aggregateId, eventType, ISO)
  return eventId
}

function seedConfirmedSafetyIncident(): string {
  const incidentId = uuidv4()
  const triggerEventId = seedProjectionEvent(db, 'SAFETY_INCIDENT', incidentId, 'SAFETY_INCIDENT_CREATED')
  db.prepare(
    `INSERT INTO safety_incident
       (incident_id, student_id, job_code, task_code, trigger_event_id, reason_code,
        description, triggered_by, context_phase, occurred_at, status)
     VALUES (?, ?, ?, ?, ?, 'BLADE_TOWARD_SELF', '不应进入导出的安全描述', ?, 'OFFLINE_SCORING', ?, 'PENDING_DETAIL')`
  ).run(incidentId, studentId, JOB_CODE, TASK_CODE, triggerEventId, teacherId, ISO)
  db.prepare(
    `UPDATE safety_incident
        SET status = 'CONFIRMED',
            confirmed_by = ?,
            updated_at = ?
      WHERE incident_id = ?`
  ).run(teacherId, ISO, incidentId)
  return incidentId
}

function seedSafetyReport(status: 'GENERATED' | 'LOCKED' = 'GENERATED'): string {
  const incidentId = seedConfirmedSafetyIncident()
  const built = buildSafetyReport(db, incidentId, ISO)
  const reportId = uuidv4()
  const eventId = seedProjectionEvent(db, 'TASK_REPORT', reportId, 'REPORT_GENERATED')
  db.prepare(
    `INSERT INTO task_report
       (report_id, report_type, student_id, source_aggregate_type, source_aggregate_id,
        source_result_ids_json, report_title, report_content_json, generated_event_id,
        generated_by, generated_at, lineage_key, source_set_hash, generation_key, content_hash,
        report_revision, report_schema_version, report_builder_version, generation_reason,
        contract_validation_status, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 'NORMAL', 'VALID', ?)`
  ).run(
    reportId,
    built.reportType,
    studentId,
    built.sourceAggregateType,
    built.sourceAggregateId,
    JSON.stringify(built.resultIds),
    built.reportTitle,
    JSON.stringify(built.content),
    eventId,
    teacherId,
    ISO,
    built.lineageKey,
    built.sourceSetHash,
    `${reportId.replace(/-/g, '')}${'a'.repeat(32)}`.slice(0, 64),
    built.contentHash,
    built.reportSchemaVersion,
    built.reportBuilderVersion,
    status
  )
  return reportId
}

function fileHash(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

describe('reports export handler', () => {
  it('exports anonymized self-contained HTML and records event, asset, and report file metadata', async () => {
    const reportId = seedSafetyReport()
    const output = join(tempDir('svets-report-export-out-'), 'report.html')

    const result = await exportReport(db, {
      callerUserId: teacherId,
      callerRole: 'TEACHER',
      reportId
    }, {
      actionLogPath: logPath(),
      now: () => ISO,
      showSaveDialog: () => ({ canceled: false, filePath: output })
    })

    expect(result.success).toBe(true)
    if (!result.success || result.canceled) return
    expect(existsSync(output)).toBe(true)
    expect(result.fileHash).toBe(fileHash(output))
    const html = readFileSync(output, 'utf8')
    expect(html).toContain('学生-')
    expect(html).not.toContain('王小明')
    expect(html).not.toContain('不应进入导出的安全描述')
    expect(html).not.toContain('<script')
    expect(html).toContain("default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'")

    expect(db.prepare('SELECT status, file_asset_id, file_path, file_hash FROM task_report WHERE report_id = ?').get(reportId))
      .toEqual({ status: 'EXPORTED', file_asset_id: result.fileAssetId, file_path: output, file_hash: result.fileHash })
    expect(db.prepare('SELECT asset_role, mime_type, file_hash FROM asset_resource WHERE asset_id = ?').get(result.fileAssetId))
      .toEqual({ asset_role: 'REPORT_FILE', mime_type: 'text/html', file_hash: result.fileHash })
    expect(db.prepare(
      `SELECT schema_version, applied_to_snapshot
         FROM domain_event_projection
        WHERE aggregate_id = ? AND event_type = 'REPORT_EXPORTED'`
    ).get(reportId)).toEqual({ schema_version: 2, applied_to_snapshot: 1 })
  })

  it('treats save dialog cancel as a non-mutating success', async () => {
    const reportId = seedSafetyReport()

    const result = await exportReport(db, {
      callerUserId: teacherId,
      callerRole: 'TEACHER',
      reportId
    }, {
      actionLogPath: logPath(),
      now: () => ISO,
      showSaveDialog: () => ({ canceled: true })
    })

    expect(result).toEqual({ success: true, canceled: true })
    expect(db.prepare(
      "SELECT COUNT(*) AS count FROM domain_event_projection WHERE aggregate_id = ? AND event_type = 'REPORT_EXPORTED'"
    ).get(reportId)).toEqual({ count: 0 })
    expect(db.prepare('SELECT status, file_asset_id FROM task_report WHERE report_id = ?').get(reportId))
      .toEqual({ status: 'GENERATED', file_asset_id: null })
  })

  it('keeps LOCKED reports locked after export', async () => {
    const reportId = seedSafetyReport('LOCKED')
    const output = join(tempDir('svets-report-export-locked-'), 'locked.html')

    const result = await exportReport(db, {
      callerUserId: teacherId,
      callerRole: 'TEACHER',
      reportId
    }, {
      actionLogPath: logPath(),
      now: () => ISO,
      showSaveDialog: () => ({ canceled: false, filePath: output })
    })

    expect(result.success).toBe(true)
    if (!result.success || result.canceled) return
    expect(result.status).toBe('LOCKED')
    expect(db.prepare('SELECT status FROM task_report WHERE report_id = ?').get(reportId)).toEqual({ status: 'LOCKED' })
  })

  it('rejects ADMIN and records export failure for real write/rename failures', async () => {
    const reportId = seedSafetyReport()
    await expect(exportReport(db, {
      callerUserId: adminId,
      callerRole: 'ADMIN',
      reportId
    }, { actionLogPath: logPath() })).resolves.toEqual({ success: false, errorCode: 'FORBIDDEN' })

    const targetDirectory = tempDir('svets-report-export-fail-')
    const failed = await exportReport(db, {
      callerUserId: teacherId,
      callerRole: 'TEACHER',
      reportId
    }, {
      actionLogPath: logPath(),
      now: () => ISO,
      showSaveDialog: () => ({ canceled: false, filePath: targetDirectory })
    })

    expect(failed).toEqual({ success: false, errorCode: 'REPORT_EXPORT_FAILED' })
    expect(db.prepare("SELECT COUNT(*) AS count FROM error_event_log WHERE error_code = 'REPORT_EXPORT_FAILED'").get())
      .toEqual({ count: 1 })
    expect(db.prepare('SELECT status, file_asset_id FROM task_report WHERE report_id = ?').get(reportId))
      .toEqual({ status: 'GENERATED', file_asset_id: null })
  })
})
