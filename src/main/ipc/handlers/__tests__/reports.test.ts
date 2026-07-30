import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import {
  createTestDb,
  seedCaller,
  seedDisabledCaller,
  seedStudent
} from '../../../db/test-helpers'
import type { DBAdapter } from '../../../db/interface'
import type { MemoryAdapter } from '../../../db/memory-adapter'
import { createTestReportCommandCoordinator } from '../../../application/runtime/__tests__/test-helpers'
import { buildSafetyReport } from '../../../domain/report-builders'
import {
  generateReport,
  getReport,
  listReportGenerationCandidates,
  listReports,
  lockReport,
  confirmPlacementReview
} from '../../../application/services/__tests__/reports-test-support'

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
})

afterEach(() => {
  db.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function logPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'svets-reports-handler-'))
  dirs.push(dir)
  return join(dir, 'action_log.jsonl')
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
     VALUES (?, ?, ?, ?, ?, 'BLADE_TOWARD_SELF', '刀口朝向自己', ?, 'OFFLINE_SCORING', ?, 'PENDING_DETAIL')`
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

function seedSafetyReport(): { reportId: string; incidentId: string } {
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
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 'NORMAL', 'VALID', 'GENERATED')`
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
    built.reportBuilderVersion
  )
  return { reportId, incidentId }
}

describe('reports IPC pure handlers', () => {
  it('lists reports for active teachers only without leaking data to ADMIN', () => {
    const { reportId } = seedSafetyReport()

    expect(listReports(db, { callerUserId: adminId, callerRole: 'ADMIN' })).toEqual({
      success: false,
      errorCode: 'FORBIDDEN'
    })

    const result = listReports(db, { callerUserId: teacherId, callerRole: 'TEACHER', limit: 10 })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({
      reportId,
      reportScope: 'SAFETY',
      status: 'GENERATED',
      canExport: true
    })
  })

  it('returns validated presentation detail and never returns raw report content', () => {
    const { reportId } = seedSafetyReport()

    const result = getReport(db, { callerUserId: teacherId, callerRole: 'TEACHER', reportId })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.report).not.toHaveProperty('content')
    expect(result.report.presentation?.reportScope).toBe('SAFETY')
    expect(result.report.presentation?.sections.map((section) => section.sectionId)).toContain('safety_incident')
    expect(result.report.contractErrors).toEqual([])
  })

  it('returns REPAIR_REQUIRED detail for invalid content without exposing raw JSON', () => {
    const reportId = uuidv4()
    db.prepare(
      `INSERT INTO task_report
       (report_id, report_type, student_id, report_title, report_content_json, generated_event_id,
        generated_by, generated_at, contract_validation_status, status)
       VALUES (?, 'FULL_REPORT', ?, '坏报告', '{', ?, ?, ?, 'REPAIR_REQUIRED', 'GENERATED')`
    ).run(reportId, studentId, seedProjectionEvent(db, 'TASK_REPORT', reportId), teacherId, ISO)

    const result = getReport(db, { callerUserId: teacherId, callerRole: 'TEACHER', reportId })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.report.presentation).toBeNull()
    expect(result.report.lifecycle.contractValidationStatus).toBe('REPAIR_REQUIRED')
    expect(result.report).not.toHaveProperty('content')
  })

  it('validates generate discriminated union before querying source data', async () => {
    const result = await generateReport(db, {
      callerUserId: teacherId,
      callerRole: 'TEACHER',
      reportScope: 'JOB_SKILL',
      resultId: 'result-1',
      incidentId: 'incident-1'
    } as never, { coordinator: createTestReportCommandCoordinator({ db, actionLogPath: logPath() }) })

    expect(result).toEqual({ success: false, errorCode: 'VALIDATION_ERROR' })
  })

  it('lists safety generation candidates without auto-confirming facts', () => {
    const incidentId = uuidv4()
    const triggerEventId = seedProjectionEvent(db, 'SAFETY_INCIDENT', incidentId, 'SAFETY_INCIDENT_CREATED')
    db.prepare(
      `INSERT INTO safety_incident
       (incident_id, student_id, job_code, task_code, trigger_event_id, reason_code,
        description, triggered_by, context_phase, occurred_at, status)
       VALUES (?, ?, ?, ?, ?, 'BLADE_TOWARD_SELF', '待确认', ?, 'OFFLINE_SCORING', ?, 'PENDING_DETAIL')`
    ).run(incidentId, studentId, JOB_CODE, TASK_CODE, triggerEventId, teacherId, ISO)

    const result = listReportGenerationCandidates(db, { callerUserId: teacherId, callerRole: 'TEACHER' })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.items).toContainEqual({ kind: 'SAFETY_WAITING_CONFIRMATION', incidentId, studentId })
    expect(db.prepare('SELECT status FROM safety_incident WHERE incident_id = ?').get(incidentId))
      .toEqual({ status: 'PENDING_DETAIL' })
  })

  it('locks a valid report through schema-v2 lifecycle event', async () => {
    const { reportId } = seedSafetyReport()

    const result = await lockReport(db, {
      callerUserId: teacherId,
      callerRole: 'TEACHER',
      reportId,
      lockReason: '教师确认'
    }, { coordinator: createTestReportCommandCoordinator({ db, actionLogPath: logPath() }), now: () => ISO })

    expect(result).toEqual({ success: true, reportId, status: 'LOCKED' })
    expect(db.prepare('SELECT status FROM task_report WHERE report_id = ?').get(reportId))
      .toEqual({ status: 'LOCKED' })
    expect(db.prepare(
      `SELECT schema_version, applied_to_snapshot
         FROM domain_event_projection
        WHERE aggregate_id = ? AND event_type = 'REPORT_LOCKED'`
    ).get(reportId)).toEqual({ schema_version: 2, applied_to_snapshot: 1 })
  })

  it('rejects placement review when placement advice is disabled', async () => {
    const { reportId } = seedSafetyReport()

    await expect(confirmPlacementReview(db, {
      callerUserId: teacherId,
      callerRole: 'TEACHER',
      reportId
    }, { coordinator: createTestReportCommandCoordinator({ db, actionLogPath: logPath() }) })).resolves.toEqual({
      success: false,
      errorCode: 'REPORT_STATE_CONFLICT'
    })
  })

  it('rejects disabled teachers before report reads', () => {
    const disabledTeacherId = seedDisabledCaller(db, 'TEACHER')
    const { reportId } = seedSafetyReport()

    expect(getReport(db, { callerUserId: disabledTeacherId, callerRole: 'TEACHER', reportId })).toEqual({
      success: false,
      errorCode: 'FORBIDDEN'
    })
  })
})
