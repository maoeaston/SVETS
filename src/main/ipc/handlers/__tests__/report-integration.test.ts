import { mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { v4 as uuidv4 } from 'uuid'

const { mockState } = vi.hoisted(() => ({
  mockState: { db: null as unknown as import('../../../db/interface').DBAdapter }
}))

vi.mock('../../../domain/event-writer', () => ({
  writeEvent: vi.fn((params: import('../../../domain/event-writer').WriteEventParams) => {
    const existing = mockState.db.prepare(
      'SELECT MAX(event_sequence) AS max_seq FROM domain_event_projection WHERE aggregate_type = ? AND aggregate_id = ?'
    ).get(params.aggregateType, params.aggregateId) as { max_seq: number | null }
    const event = {
      event_id: uuidv4(),
      aggregate_type: params.aggregateType,
      aggregate_id: params.aggregateId,
      event_type: params.eventType,
      event_sequence: (existing.max_seq ?? 0) + 1,
      payload: params.payload,
      checksum: 'test',
      schema_version: params.schemaVersion ?? 1,
      created_at: '2026-07-26T00:00:00.000Z',
      actor_id: params.actorId,
      actor_role: params.actorRole,
      app_version: 'test'
    } as import('@shared/types/event-payloads').ActionLogEntry
    mockState.db.prepare(
      `INSERT INTO domain_event_projection
         (event_id, aggregate_type, aggregate_id, event_type, event_sequence,
          payload_json, checksum, source_log_path, schema_version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      event.event_id,
      event.aggregate_type,
      event.aggregate_id,
      event.event_type,
      event.event_sequence,
      JSON.stringify(event.payload),
      event.checksum,
      params.actionLogPath ?? 'test',
      event.schema_version,
      event.created_at
    )
    return event
  })
}))

import { createTestDb, seedCaller, seedStudent } from '../../../db/test-helpers'
import type { MemoryAdapter } from '../../../db/memory-adapter'
import { createTestReportCommandCoordinator } from '../../../application/runtime/__tests__/test-helpers'
import { recordReportGenerationError } from '../../../domain/report-errors'
import {
  confirmSafetyIncident,
  replaceSafetyIncidentForFactualCorrection,
  voidSafetyIncident,
  type SafetyReportAutomation
} from '../../../application/services/__tests__/safety-test-support'

const ISO = '2026-07-26T00:00:00.000Z'
const JOB_CODE = 'SUPERMARKET_SHELVER'
const TASK_CODE = 'SHELVE_TASK'

let db: MemoryAdapter
let teacherId: string
let adminId: string
let studentId: string

function actionLogPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'svets-report-integration-')), 'action_log.jsonl')
}

function seedProjectionEvent(aggregateType: string, aggregateId: string, eventType = 'SAFETY_INCIDENT_CREATED'): string {
  const eventId = uuidv4()
  db.prepare(
    `INSERT INTO domain_event_projection
       (event_id, aggregate_type, aggregate_id, event_type, event_sequence,
        payload_json, checksum, source_log_path, schema_version, created_at)
     VALUES (?, ?, ?, ?, 1, '{}', 'test', 'test', 1, ?)`
  ).run(eventId, aggregateType, aggregateId, eventType, ISO)
  return eventId
}

function seedIncident(status: 'PENDING_DETAIL' | 'CONFIRMED'): string {
  const incidentId = uuidv4()
  const triggerEventId = seedProjectionEvent('SAFETY_INCIDENT', incidentId)
  db.prepare(
    `INSERT INTO safety_incident
       (incident_id, student_id, job_code, task_code, trigger_event_id, reason_code,
        description, triggered_by, context_phase, occurred_at, status, confirmed_by)
     VALUES (?, ?, ?, ?, ?, 'BLADE_TOWARD_SELF', '安全事实', ?, 'OFFLINE_SCORING', ?, ?, ?)`
  ).run(
    incidentId,
    studentId,
    JOB_CODE,
    TASK_CODE,
    triggerEventId,
    teacherId,
    ISO,
    'PENDING_DETAIL',
    null
  )
  if (status === 'CONFIRMED') {
    db.prepare("UPDATE safety_incident SET status = 'CONFIRMED', confirmed_by = ? WHERE incident_id = ?")
      .run(teacherId, incidentId)
  }
  return incidentId
}

function seedActiveSafetyReport(incidentId: string): string {
  const reportId = uuidv4()
  const eventId = seedProjectionEvent('TASK_REPORT', reportId, 'REPORT_GENERATED')
  db.prepare(
    `INSERT INTO task_report
       (report_id, report_type, student_id, source_aggregate_type, source_aggregate_id,
        source_result_ids_json, report_title, report_content_json, generated_event_id,
        generated_by, generated_at, lineage_key, source_set_hash, generation_key, content_hash,
        report_revision, report_schema_version, report_builder_version, generation_reason,
        contract_validation_status, status)
     VALUES (?, 'SAFETY_TERMINATION_REPORT', ?, 'SAFETY_INCIDENT', ?, '[]',
             '安全终止报告', '{}', ?, ?, ?, ?, ?, ?, ?, 1,
             'safety-termination-report-v1.0', 'test', 'NORMAL', 'VALID', 'GENERATED')`
  ).run(
    reportId,
    studentId,
    incidentId,
    eventId,
    teacherId,
    ISO,
    uuidv4().replace(/-/g, '').padEnd(64, 'a'),
    uuidv4().replace(/-/g, '').padEnd(64, 'b'),
    uuidv4().replace(/-/g, '').padEnd(64, 'c'),
    uuidv4().replace(/-/g, '').padEnd(64, 'd')
  )
  return reportId
}

function coordinatorAutomation(): SafetyReportAutomation {
  const coordinator = createTestReportCommandCoordinator({ db, actionLogPath: actionLogPath() })
  return {
    generateSafetyReportFromIncident(): void {
      throw new Error('not used')
    },
    runSafetyMutation(key, buildIntent, mapResult) {
      return coordinator.runSingleEventCommandSync({
        key,
        areas: ['SAFETY_INCIDENT', 'TASK_REPORT'],
        buildIntent,
        mapResult: (event) => mapResult(event?.event_id ?? null)
      })
    }
  }
}

beforeEach(async () => {
  db = await createTestDb()
  mockState.db = db
  teacherId = seedCaller(db, 'TEACHER')
  adminId = seedCaller(db, 'ADMIN')
  studentId = seedStudent(db)
})

afterEach(() => {
  db.close()
  vi.restoreAllMocks()
})

describe('F7 Step 6 report integration', () => {
  it('keeps confirmed safety facts when automatic safety report generation fails', () => {
    const incidentId = seedIncident('PENDING_DETAIL')
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const automation: SafetyReportAutomation = {
      generateSafetyReportFromIncident(failedIncidentId): void {
        recordReportGenerationError(db, {
          relatedAggregateType: 'SAFETY_INCIDENT',
          relatedAggregateId: failedIncidentId,
          message: 'builder failed',
          context: { reportScope: 'SAFETY', source: failedIncidentId }
        })
        throw new Error('builder failed')
      },
      runSafetyMutation(): never {
        throw new Error('not used')
      }
    }

    expect(confirmSafetyIncident(db, {
      callerUserId: teacherId,
      callerRole: 'TEACHER',
      incidentId,
      reasonCode: 'THROWING_OBJECT',
      contextPhase: 'TRAINING_PRACTICE',
      description: '学生抛掷纸箱'
    }, automation)).toEqual({ success: true, incidentId })

    expect(db.prepare('SELECT status, reason_code FROM safety_incident WHERE incident_id = ?').get(incidentId))
      .toEqual({ status: 'CONFIRMED', reason_code: 'THROWING_OBJECT' })
    expect(db.prepare("SELECT COUNT(*) AS count FROM error_event_log WHERE error_code = 'REPORT_GENERATION_FAILED'").get())
      .toEqual({ count: 1 })
  })

  it('archives active safety reports through one schema-v2 void event', () => {
    const incidentId = seedIncident('CONFIRMED')
    const reportId = seedActiveSafetyReport(incidentId)

    expect(voidSafetyIncident(db, {
      callerUserId: adminId,
      callerRole: 'ADMIN',
      incidentId,
      voidReason: 'FALSE_TRIGGER',
      voidNotes: '误报'
    }, coordinatorAutomation())).toEqual({ success: true, incidentId })

    expect(db.prepare('SELECT status, void_reason FROM safety_incident WHERE incident_id = ?').get(incidentId))
      .toEqual({ status: 'VOIDED', void_reason: 'FALSE_TRIGGER' })
    expect(db.prepare('SELECT status FROM task_report WHERE report_id = ?').get(reportId))
      .toEqual({ status: 'ARCHIVED' })
    expect(db.prepare(
      `SELECT schema_version, applied_to_snapshot
         FROM domain_event_projection
        WHERE aggregate_type = 'SAFETY_INCIDENT'
          AND aggregate_id = ?
          AND event_type = 'SAFETY_INCIDENT_VOIDED'
        LIMIT 1`
    ).get(incidentId)).toEqual({ schema_version: 2, applied_to_snapshot: 1 })
  })

  it('uses the original teacher confirmation when an admin factually replaces a safety incident', () => {
    const incidentId = seedIncident('CONFIRMED')
    const reportId = seedActiveSafetyReport(incidentId)

    const replacement = replaceSafetyIncidentForFactualCorrection(db, {
      callerUserId: adminId,
      callerRole: 'ADMIN',
      incidentId,
      reasonCode: 'DANGEROUS_CLIMBING',
      contextPhase: 'TRAINING_DO',
      description: '管理员更正后的安全事实',
      correctionReason: '原始场景记录错误'
    }, coordinatorAutomation())

    expect(replacement.success).toBe(true)
    if (!replacement.success) return
    expect(db.prepare(
      'SELECT status, void_reason, replacement_incident_id FROM safety_incident WHERE incident_id = ?'
    ).get(incidentId)).toEqual({
      status: 'VOIDED',
      void_reason: 'FACTUAL_CORRECTION',
      replacement_incident_id: replacement.incidentId
    })
    expect(db.prepare(
      'SELECT status, confirmed_by, triggered_by FROM safety_incident WHERE incident_id = ?'
    ).get(replacement.incidentId)).toEqual({
      status: 'CONFIRMED',
      confirmed_by: teacherId,
      triggered_by: adminId
    })
    expect(db.prepare('SELECT status FROM task_report WHERE report_id = ?').get(reportId))
      .toEqual({ status: 'SUPERSEDED' })
    expect(db.prepare(
      `SELECT schema_version, applied_to_snapshot
         FROM domain_event_projection
        WHERE aggregate_type = 'SAFETY_INCIDENT'
          AND aggregate_id = ?
          AND event_type = 'SAFETY_INCIDENT_REPLACED_FOR_FACTUAL_CORRECTION'`
    ).get(incidentId)).toEqual({ schema_version: 2, applied_to_snapshot: 1 })
  })
})
