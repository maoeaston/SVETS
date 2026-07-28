import { describe, expect, it } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { createTestDb, seedAssessmentSessionFixture, seedBusinessSessionFixture, seedCaller, seedStudent } from '../../db/test-helpers'
import { sha256CanonicalJson } from '../report-canonical'
import { parseF7EventPayload } from '../report-contract'
import { applyReportEvent, ReportReducerError } from '../report-reducer'
import type { MemoryAdapter } from '../../db/memory-adapter'
import type { ActionLogEntry, EventType } from '@shared/types/event-payloads'

const ISO = '2026-07-25T10:00:00.000Z'
const JOB_CODE = 'SUPERMARKET_SHELVER'
const TASK_CODE = 'SHELVE_TASK'
const HASH = 'a'.repeat(64)

function makeEvent(
  eventType: EventType,
  aggregateType: ActionLogEntry['aggregate_type'],
  aggregateId: string,
  payload: Record<string, unknown>,
  actorId: string,
  actorRole: ActionLogEntry['actor_role'] = 'TEACHER',
  eventSequence = 1
): ActionLogEntry {
  return {
    event_id: uuidv4(),
    aggregate_type: aggregateType,
    aggregate_id: aggregateId,
    event_type: eventType,
    event_sequence: eventSequence,
    payload,
    checksum: `checksum-${eventType}`,
    schema_version: 2,
    created_at: ISO,
    actor_id: actorId,
    actor_role: actorRole,
    app_version: 'test'
  }
}

function seedEventProjection(db: MemoryAdapter, event: ActionLogEntry): void {
  db.prepare(
    `INSERT INTO domain_event_projection
       (event_id, aggregate_type, aggregate_id, event_type, event_sequence,
        payload_json, checksum, source_log_path, schema_version, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'test-action-log.jsonl', ?, ?)`
  ).run(
    event.event_id,
    event.aggregate_type,
    event.aggregate_id,
    event.event_type,
    event.event_sequence,
    JSON.stringify(event.payload),
    event.checksum,
    event.schema_version,
    event.created_at
  )
}

function seedGeneratedEvent(db: MemoryAdapter, aggregateId: string): string {
  const eventId = uuidv4()
  db.prepare(
    `INSERT INTO domain_event_projection
       (event_id, aggregate_type, aggregate_id, event_type, event_sequence,
        payload_json, checksum, source_log_path, schema_version, created_at)
     VALUES (?, 'SYSTEM', ?, 'RESULT_CALCULATED', 1, '{}', 'checksum', 'test', 1, ?)`
  ).run(eventId, `${aggregateId}:${eventId}`, ISO)
  return eventId
}

function seedBaseSources(db: MemoryAdapter, teacherId: string, studentId: string): {
  abilityResultId: string
  trainingResultId: string
  operationResultId: string
  assessmentId: string
  trainingId: string
} {
  const assessmentId = seedAssessmentSessionFixture(db, {
    studentId,
    strategyId: 'strategy_baseline_shelver_v1',
    jobCode: JOB_CODE,
    taskCode: TASK_CODE,
    status: 'COMPLETED',
    createdBy: teacherId
  })
  const trainingId = uuidv4()
  seedBusinessSessionFixture(db, {
    businessSessionId: trainingId,
    sessionType: 'TRAINING',
    studentId,
    jobCode: JOB_CODE,
    taskCode: TASK_CODE,
    createdBy: teacherId
  })
  db.prepare(
    `INSERT INTO training_session
       (training_session_id, business_session_id, student_id, job_code, task_code,
        strategy_id, strategy_type, strategy_version, status, total_step_count, completed_step_count, created_by)
     VALUES (?, ?, ?, ?, ?, 'strategy_training_shelver_v1', 'TRAINING_PRACTICE', 1, 'COMPLETED', 1, 1, ?)`
  ).run(trainingId, trainingId, studentId, JOB_CODE, TASK_CODE, teacherId)

  const abilityResultId = uuidv4()
  const trainingResultId = uuidv4()
  const operationResultId = uuidv4()
  const insertResult = db.prepare(
    `INSERT INTO result_record
       (result_id, student_id, result_type, source_aggregate_type, source_aggregate_id,
        strategy_id, strategy_type, job_code, raw_score, max_score, normalized_score,
        completion_ratio, level_result, generated_event_id, generated_at, is_current)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
  )
  insertResult.run(
    abilityResultId, studentId, 'ABILITY_SCORE', 'ASSESSMENT_SESSION', assessmentId,
    'strategy_baseline_shelver_v1', 'BASELINE_ASSESSMENT', JOB_CODE, 12, 20, 60, 1,
    'LEVEL_CONDITIONAL', seedGeneratedEvent(db, assessmentId), ISO
  )
  insertResult.run(
    trainingResultId, studentId, 'TRAINING_COMPLETION', 'TRAINING_SESSION', trainingId,
    'strategy_training_shelver_v1', 'TRAINING_PRACTICE', JOB_CODE, null, null, 100, 1,
    'LEVEL_COMPETENT', seedGeneratedEvent(db, trainingId), ISO
  )
  insertResult.run(
    operationResultId, studentId, 'OPERATION_PASS_RATE', 'ASSESSMENT_SESSION', assessmentId,
    'strategy_baseline_shelver_v1', 'BASELINE_ASSESSMENT', JOB_CODE, 18, 18, 100, 1,
    'LEVEL_COMPETENT', seedGeneratedEvent(db, assessmentId), ISO
  )
  return { abilityResultId, trainingResultId, operationResultId, assessmentId, trainingId }
}

function closureSnapshots(source: ReturnType<typeof seedBaseSources>) {
  return [
    {
      result_id: source.abilityResultId, result_type: 'ABILITY_SCORE',
      source_aggregate_type: 'ASSESSMENT_SESSION', source_aggregate_id: source.assessmentId,
      generated_at: ISO, strategy_id: 'strategy_baseline_shelver_v1', strategy_type: 'BASELINE_ASSESSMENT',
      raw_score: 12, max_score: 20, normalized_score: 60, completion_ratio: 1,
      level_result: 'LEVEL_CONDITIONAL', safety_overridden: false, redline_incident_id: null,
      source_started_at: ISO, source_completed_at: ISO,
      details: {
        result_type: 'ABILITY_SCORE', module_scores: [], online_raw_score: 8, offline_raw_score: 4,
        question_count: 10, answered_count: 10, completion_ratio: 1, emotion_collapse_count: 0,
        module_veto_triggered_by: null, level_forced_by: null
      }
    },
    {
      result_id: source.trainingResultId, result_type: 'TRAINING_COMPLETION',
      source_aggregate_type: 'TRAINING_SESSION', source_aggregate_id: source.trainingId,
      generated_at: ISO, strategy_id: 'strategy_training_shelver_v1', strategy_type: 'TRAINING_PRACTICE',
      raw_score: null, max_score: null, normalized_score: 100, completion_ratio: 1,
      level_result: 'LEVEL_COMPETENT', safety_overridden: false, redline_incident_id: null,
      source_started_at: ISO, source_completed_at: ISO,
      details: { total_steps: 1, completed_steps: 1, skipped_steps: 0, failed_steps: 0, completion_rate: 100, completed_at: ISO }
    },
    {
      result_id: source.operationResultId, result_type: 'OPERATION_PASS_RATE',
      source_aggregate_type: 'ASSESSMENT_SESSION', source_aggregate_id: source.assessmentId,
      generated_at: ISO, strategy_id: 'strategy_baseline_shelver_v1', strategy_type: 'BASELINE_ASSESSMENT',
      raw_score: 18, max_score: 18, normalized_score: 100, completion_ratio: 1,
      level_result: 'LEVEL_COMPETENT', safety_overridden: false, redline_incident_id: null,
      source_started_at: ISO, source_completed_at: ISO,
      details: {
        result_type: 'OPERATION_PASS_RATE', raw_score: 18, max_score: 18, total_items: 9, scored_at: ISO,
        items: ['IDENTIFY_BOX', 'CHECK_BOX_DAMAGE', 'OPEN_PACKAGE_SAFELY', 'TAKE_OUT_GOODS', 'CHECK_GOODS_APPEARANCE', 'IDENTIFY_SHELF_POSITION', 'PLACE_BY_RULE', 'TIDY_SHELF_FACE', 'CONFIRM_COMPLETION']
          .map((task_operation_code) => ({ task_operation_code, score: 2 }))
      }
    }
  ]
}

function closurePayload(
  closureId: string,
  studentId: string,
  source: ReturnType<typeof seedBaseSources>,
  teacherId: string,
  options: { cycleNo?: number; supersededClosureIds?: string[]; supersededReportIds?: string[] } = {}
): Record<string, unknown> {
  const snapshots = closureSnapshots(source)
  return {
    task_closure_id: closureId,
    student_id: studentId,
    job_code: JOB_CODE,
    task_code: TASK_CODE,
    cycle_no: options.cycleNo ?? 1,
    closure_revision: 1,
    status: 'CONFIRMED',
    is_cycle_head: true,
    source_result_ids: snapshots.map((snapshot) => snapshot.result_id),
    task_result_snapshots: snapshots,
    confirmed_by: teacherId,
    confirmed_at: ISO,
    superseded_task_closure_ids: options.supersededClosureIds ?? [],
    superseded_report_ids: options.supersededReportIds ?? []
  }
}

function seedLockedReport(db: MemoryAdapter, reportId: string, closureId: string, studentId: string, teacherId: string): void {
  const generatedEventId = seedGeneratedEvent(db, reportId)
  db.prepare(
    `INSERT INTO task_report
       (report_id, report_type, student_id, report_title, report_content_json, generated_event_id,
        generated_by, generated_at, task_closure_id, lineage_key, source_set_hash, generation_key,
        content_hash, report_revision, report_schema_version, report_builder_version, generation_reason,
        contract_validation_status, status)
     VALUES (?, 'FULL_REPORT', ?, '旧报告', '{}', ?, ?, ?, ?, ?, ?, ?, ?, 1, 'task-report-v1.1', 'test', 'NORMAL', 'VALID', 'LOCKED')`
  ).run(reportId, studentId, generatedEventId, teacherId, ISO, closureId, HASH, HASH, uuidv4().replace(/-/g, '').padEnd(64, 'b'), HASH)
}

function seedConfirmedSafetyIncident(db: MemoryAdapter, teacherId: string, studentId: string): string {
  const incidentId = uuidv4()
  const triggerId = seedGeneratedEvent(db, incidentId)
  db.prepare(
    `INSERT INTO safety_incident
       (incident_id, student_id, job_code, task_code, trigger_event_id, reason_code,
        description, triggered_by, context_phase, occurred_at, status)
     VALUES (?, ?, ?, ?, ?, 'BLADE_TOWARD_SELF', '安全事实', ?, 'OFFLINE_SCORING', ?, 'PENDING_DETAIL')`
  ).run(incidentId, studentId, JOB_CODE, TASK_CODE, triggerId, teacherId, ISO)
  db.prepare("UPDATE safety_incident SET status = 'CONFIRMED', confirmed_by = ? WHERE incident_id = ?")
    .run(teacherId, incidentId)
  return incidentId
}

function safetyContent(incidentId: string, studentId: string, teacherId: string): Record<string, unknown> {
  return {
    report_schema_version: 'safety-termination-report-v1.0',
    report_scope: 'SAFETY',
    source_scope: 'NO_BOUND_SESSION',
    report_type: 'SAFETY_TERMINATION_REPORT',
    generated_at: ISO,
    incident_snapshot: {
      incident_id: incidentId, student_id: studentId, job_code: JOB_CODE, task_code: TASK_CODE,
      status_at_generation: 'CONFIRMED', reason_code: 'BLADE_TOWARD_SELF', context_phase: 'OFFLINE_SCORING',
      description: '安全事实', occurred_at: ISO, triggered_by: teacherId, confirmed_by: teacherId, confirmed_at: ISO
    },
    binding_snapshots: [],
    pre_redline_records: { result_ids: [], answer_summary: {}, offline_score_summary: {}, training_step_summary: {} },
    safety_summary: { level_result: 'LEVEL_FAIL_BY_SAFETY', ordinary_report_blocked: true },
    validity_limitations: [],
    correction_lineage: { root_incident_id: incidentId, replaces_incident_id: null, supersedes_report_id: null },
    source_meta: { metadata_availability: 'NO_BOUND_SESSION', binding_metadata: [] },
    placement_advice: { enabled: false, recommendation: null, reason_disabled: 'SAFETY_TERMINATION' }
  }
}

describe('applyReportEvent', () => {
  it('projects closure confirmation/replacement idempotently and retires locked reports', async () => {
    const db = await createTestDb()
    try {
      const teacherId = seedCaller(db, 'TEACHER')
      const studentId = seedStudent(db)
      const source = seedBaseSources(db, teacherId, studentId)
      const firstClosureId = uuidv4()
      const first = makeEvent('TASK_CLOSURE_CONFIRMED', 'TASK_CLOSURE', firstClosureId, closurePayload(firstClosureId, studentId, source, teacherId), teacherId)
      expect(parseF7EventPayload('TASK_CLOSURE_CONFIRMED', {
        ...closurePayload(uuidv4(), studentId, source, teacherId), status: 'SUPERSEDED', is_cycle_head: false
      }).valid).toBe(false)
      seedEventProjection(db, first)
      applyReportEvent(db, first)
      applyReportEvent(db, first)

      const reportId = uuidv4()
      seedLockedReport(db, reportId, firstClosureId, studentId, teacherId)
      const replacementId = uuidv4()
      const replacement = makeEvent('TASK_CLOSURE_REPLACED', 'TASK_CLOSURE', replacementId, {
        old_task_closure_id: firstClosureId,
        new_task_closure_id: replacementId,
        student_id: studentId,
        job_code: JOB_CODE,
        task_code: TASK_CODE,
        cycle_no: 1,
        closure_revision: 2,
        status: 'CONFIRMED',
        is_cycle_head: true,
        correction_reason: '来源记录修正',
        source_result_ids: closureSnapshots(source).map((snapshot) => snapshot.result_id),
        task_result_snapshots: closureSnapshots(source),
        reused_result_ids: [source.abilityResultId, source.trainingResultId, source.operationResultId],
        new_result_ids: [],
        replaced_by: teacherId,
        replaced_at: ISO,
        archived_report_ids: [reportId]
      }, teacherId)
      expect(parseF7EventPayload('TASK_CLOSURE_REPLACED', {
        ...replacement.payload, status: 'CONFIRMED', is_cycle_head: false
      }).valid).toBe(false)
      seedEventProjection(db, replacement)
      applyReportEvent(db, replacement)
      applyReportEvent(db, replacement)

      expect(db.prepare('SELECT status, is_cycle_head, replacement_task_closure_id FROM task_closure WHERE task_closure_id = ?').get(firstClosureId))
        .toEqual({ status: 'SUPERSEDED', is_cycle_head: 0, replacement_task_closure_id: replacementId })
      expect(db.prepare('SELECT status, is_cycle_head FROM task_closure WHERE task_closure_id = ?').get(replacementId))
        .toEqual({ status: 'CONFIRMED', is_cycle_head: 1 })
      expect(db.prepare('SELECT status FROM task_report WHERE report_id = ?').get(reportId)).toEqual({ status: 'ARCHIVED' })
    } finally {
      db.close()
    }
  })

  it('replays generated, locked, and exported report snapshots without duplicate assets', async () => {
    const db = await createTestDb()
    try {
      const teacherId = seedCaller(db, 'TEACHER')
      const studentId = seedStudent(db)
      const incidentId = seedConfirmedSafetyIncident(db, teacherId, studentId)
      const reportId = uuidv4()
      const content = safetyContent(incidentId, studentId, teacherId)
      const generated = makeEvent('REPORT_GENERATED', 'TASK_REPORT', reportId, {
        report_id: reportId, student_id: studentId, job_code: JOB_CODE, task_code: TASK_CODE,
        report_type: 'SAFETY_TERMINATION_REPORT', report_scope: 'SAFETY',
        source_aggregate_type: 'SAFETY_INCIDENT', source_aggregate_id: incidentId,
        result_ids: [], incident_ids: [incidentId], report_title: '安全中止报告', report_content: content,
        generated_at: ISO, generated_by: teacherId, report_revision: 1,
        report_schema_version: 'safety-termination-report-v1.0', report_builder_version: 'f7-test',
        lineage_key: HASH, source_set_hash: HASH, content_hash: sha256CanonicalJson(content),
        generation_key: 'b'.repeat(64), generation_reason: 'NORMAL', task_closure_id: null,
        repair_of_report_id: null, superseded_report_ids: []
      }, teacherId)
      seedEventProjection(db, generated)
      applyReportEvent(db, generated)

      const locked = makeEvent('REPORT_LOCKED', 'TASK_REPORT', reportId, {
        report_id: reportId, locked_by: teacherId, locked_at: ISO, lock_reason: null,
        content_hash: sha256CanonicalJson(content), status_before: 'GENERATED', status_after: 'LOCKED'
      }, teacherId, 'TEACHER', 2)
      seedEventProjection(db, locked)
      applyReportEvent(db, locked)

      const assetId = uuidv4()
      const exported = makeEvent('REPORT_EXPORTED', 'TASK_REPORT', reportId, {
        report_id: reportId, export_format: 'HTML', export_path: '/tmp/report.html', exported_at: ISO,
        exported_by: teacherId, file_asset_id: assetId, file_hash: 'c'.repeat(64), file_size_bytes: 42,
        mime_type: 'text/html', content_hash: sha256CanonicalJson(content), status_before: 'LOCKED', status_after: 'LOCKED'
      }, teacherId, 'TEACHER', 3)
      seedEventProjection(db, exported)
      applyReportEvent(db, exported)
      applyReportEvent(db, exported)

      expect(db.prepare('SELECT status, file_asset_id, file_hash FROM task_report WHERE report_id = ?').get(reportId))
        .toEqual({ status: 'LOCKED', file_asset_id: assetId, file_hash: 'c'.repeat(64) })
      expect(db.prepare('SELECT asset_type, asset_role, mime_type FROM asset_resource WHERE asset_id = ?').get(assetId))
        .toEqual({ asset_type: 'OTHER', asset_role: 'REPORT_FILE', mime_type: 'text/html' })
      expect(db.prepare('SELECT COUNT(*) AS count FROM asset_resource WHERE asset_id = ?').get(assetId)).toEqual({ count: 1 })
    } finally {
      db.close()
    }
  })

  it('applies the single-event safety factual correction and rejects malformed F7 events', async () => {
    const db = await createTestDb()
    try {
      const teacherId = seedCaller(db, 'TEACHER')
      const adminId = seedCaller(db, 'ADMIN')
      const studentId = seedStudent(db)
      const oldIncidentId = seedConfirmedSafetyIncident(db, teacherId, studentId)
      const newIncidentId = uuidv4()
      const correction = makeEvent('SAFETY_INCIDENT_REPLACED_FOR_FACTUAL_CORRECTION', 'SAFETY_INCIDENT', oldIncidentId, {
        root_incident_id: oldIncidentId, old_incident_id: oldIncidentId, new_incident_id: newIncidentId,
        student_id: studentId, job_code: JOB_CODE, task_code: TASK_CODE,
        reason_code: 'BLADE_TOWARD_SELF', context_phase: 'OFFLINE_SCORING', full_description: '修正后的安全事实',
        occurred_at: ISO, triggered_by: teacherId, confirmed_by: teacherId, confirmed_at: ISO,
        old_status: 'CONFIRMED', old_status_after: 'VOIDED', void_reason: 'FACTUAL_CORRECTION',
        correction_reason: '地点记录错误', replaced_by: adminId, replaced_at: ISO, superseded_report_ids: []
      }, adminId, 'ADMIN')
      seedEventProjection(db, correction)
      applyReportEvent(db, correction)
      applyReportEvent(db, correction)

      expect(db.prepare('SELECT status, void_reason, replacement_incident_id FROM safety_incident WHERE incident_id = ?').get(oldIncidentId))
        .toEqual({ status: 'VOIDED', void_reason: 'FACTUAL_CORRECTION', replacement_incident_id: newIncidentId })
      expect(db.prepare('SELECT status, confirmed_by FROM safety_incident WHERE incident_id = ?').get(newIncidentId))
        .toEqual({ status: 'CONFIRMED', confirmed_by: teacherId })

      const invalid = makeEvent('REPORT_LOCKED', 'TASK_REPORT', 'report-missing', { report_id: 'report-missing' }, teacherId)
      expect(() => applyReportEvent(db, invalid)).toThrow(ReportReducerError)
    } finally {
      db.close()
    }
  })

  it('rejects a factual-correction payload whose job differs from the original incident', async () => {
    const db = await createTestDb()
    try {
      const teacherId = seedCaller(db, 'TEACHER')
      const adminId = seedCaller(db, 'ADMIN')
      const studentId = seedStudent(db)
      const oldIncidentId = seedConfirmedSafetyIncident(db, teacherId, studentId)
      const newIncidentId = uuidv4()
      const correction = makeEvent('SAFETY_INCIDENT_REPLACED_FOR_FACTUAL_CORRECTION', 'SAFETY_INCIDENT', oldIncidentId, {
        root_incident_id: oldIncidentId, old_incident_id: oldIncidentId, new_incident_id: newIncidentId,
        student_id: studentId, job_code: 'WAREHOUSE_PICKER', task_code: TASK_CODE,
        reason_code: 'BLADE_TOWARD_SELF', context_phase: 'OFFLINE_SCORING', full_description: '跨岗位篡改',
        occurred_at: ISO, triggered_by: teacherId, confirmed_by: teacherId, confirmed_at: ISO,
        old_status: 'CONFIRMED', old_status_after: 'VOIDED', void_reason: 'FACTUAL_CORRECTION',
        correction_reason: '不应通过', replaced_by: adminId, replaced_at: ISO, superseded_report_ids: []
      }, adminId, 'ADMIN')

      expect(() => applyReportEvent(db, correction)).toThrow(ReportReducerError)
      expect(db.prepare('SELECT status, replacement_incident_id FROM safety_incident WHERE incident_id = ?').get(oldIncidentId))
        .toEqual({ status: 'CONFIRMED', replacement_incident_id: null })
      expect(db.prepare('SELECT 1 FROM safety_incident WHERE incident_id = ?').get(newIncidentId)).toBeUndefined()
    } finally {
      db.close()
    }
  })
})
