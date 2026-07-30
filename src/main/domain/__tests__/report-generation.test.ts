import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import {
  createTestDb,
  seedAssessmentSessionFixture,
  seedBusinessSessionFixture,
  seedCaller,
  seedStudent
} from '../../db/test-helpers'
import type { DBAdapter } from '../../db/interface'
import { createTestReportCommandCoordinator } from '../../application/runtime/__tests__/test-helpers'
import { TaskClosureService } from '../task-closure-service'
import { buildJobSkillReport } from '../report-builders'
import { ReportService, ReportServiceError } from '../report-service'

const ISO = '2026-07-25T10:00:00.000Z'
const CORRELATION_ID = 'report-generation-test-correlation'
const JOB_CODE = 'SUPERMARKET_SHELVER'
const TASK_CODE = 'SHELVE_TASK'
const HASH = 'a'.repeat(64)

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function logPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'svets-report-generation-'))
  dirs.push(dir)
  return join(dir, 'action_log.jsonl')
}

function service(db: DBAdapter): ReportService {
  return new ReportService(db, createTestReportCommandCoordinator({ db, actionLogPath: logPath() }))
}

function eventId(db: DBAdapter, aggregateId: string, createdAt = ISO): string {
  const id = uuidv4()
  db.prepare(
    `INSERT INTO domain_event_projection
       (event_id, aggregate_type, aggregate_id, event_type, event_sequence, payload_json,
        checksum, source_log_path, schema_version, created_at)
     VALUES (?, 'SYSTEM', ?, 'RESULT_CALCULATED', 1, '{}', 'checksum', 'test', 1, ?)`
  ).run(id, `${aggregateId}:${id}`, createdAt)
  return id
}

function seedTraining(db: DBAdapter, teacherId: string, studentId: string): string {
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
        strategy_id, strategy_type, strategy_version, status, total_step_count,
        completed_step_count, completion_rate, started_at, completed_at, created_by)
     VALUES (?, ?, ?, ?, ?, 'strategy_training_shelver_v1', 'TRAINING_PRACTICE', 1,
             'COMPLETED', 4, 4, 100, ?, ?, ?)`
  ).run(trainingId, trainingId, studentId, JOB_CODE, TASK_CODE, ISO, ISO, teacherId)
  return trainingId
}

function seedBaseResults(db: DBAdapter, teacherId: string, studentId: string): [string, string, string] {
  const assessmentId = seedAssessmentSessionFixture(db, {
    studentId,
    strategyId: 'strategy_baseline_shelver_v1',
    jobCode: JOB_CODE,
    taskCode: TASK_CODE,
    status: 'COMPLETED',
    createdBy: teacherId
  })
  db.prepare('UPDATE assessment_session SET started_at = ?, completed_at = ? WHERE session_id = ?').run(ISO, ISO, assessmentId)
  const trainingId = seedTraining(db, teacherId, studentId)
  const abilityResultId = uuidv4()
  const trainingResultId = uuidv4()
  const operationResultId = uuidv4()
  const insert = db.prepare(
    `INSERT INTO result_record
       (result_id, student_id, result_type, source_aggregate_type, source_aggregate_id,
        strategy_id, strategy_type, job_code, raw_score, max_score, normalized_score,
        completion_ratio, level_result, result_payload_json, generated_event_id, generated_at, is_current)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
  )
  insert.run(
    abilityResultId, studentId, 'ABILITY_SCORE', 'ASSESSMENT_SESSION', assessmentId,
    'strategy_baseline_shelver_v1', 'BASELINE_ASSESSMENT', JOB_CODE, 60, 100, 60, 1, 'LEVEL_CONDITIONAL',
    JSON.stringify({
      result_type: 'ABILITY_SCORE',
      module_scores: [],
      online_raw_score: 60,
      offline_raw_score: 0,
      question_count: 42,
      answered_count: 42,
      completion_ratio: 1,
      emotion_collapse_count: 0,
      module_veto_triggered_by: null,
      level_forced_by: null
    }),
    eventId(db, assessmentId),
    ISO
  )
  insert.run(
    trainingResultId, studentId, 'TRAINING_COMPLETION', 'TRAINING_SESSION', trainingId,
    'strategy_training_shelver_v1', 'TRAINING_PRACTICE', JOB_CODE, null, null, 100, 1, 'LEVEL_COMPETENT',
    null, eventId(db, trainingId), ISO
  )
  insert.run(
    operationResultId, studentId, 'OPERATION_PASS_RATE', 'ASSESSMENT_SESSION', assessmentId,
    'strategy_baseline_shelver_v1', 'BASELINE_ASSESSMENT', JOB_CODE, 18, 18, 100, 1, 'LEVEL_COMPETENT',
    JSON.stringify({
      result_type: 'OPERATION_PASS_RATE',
      raw_score: 18,
      max_score: 18,
      total_items: 9,
      scored_at: ISO,
      items: [
        'IDENTIFY_BOX',
        'CHECK_BOX_DAMAGE',
        'OPEN_PACKAGE_SAFELY',
        'TAKE_OUT_GOODS',
        'CHECK_GOODS_APPEARANCE',
        'IDENTIFY_SHELF_POSITION',
        'PLACE_BY_RULE',
        'TIDY_SHELF_FACE',
        'CONFIRM_COMPLETION'
      ].map((task_operation_code) => ({ task_operation_code, score: 2 }))
    }),
    eventId(db, assessmentId),
    ISO
  )
  return [abilityResultId, trainingResultId, operationResultId]
}

function jobPayload() {
  const profile = { online_raw: 2, online_max: 6, offline_raw: 2, offline_max: 2, score_rate: 0.5 }
  return {
    result_schema_version: 'job-skill-result-v1.0',
    overall: { raw_score: 24, max_score: 48, normalized_score: 50, completion_ratio: 1 },
    job_module_profiles: { M1: profile, M2: profile, M3: profile, M4: profile, M5: profile, M6: profile },
    observation_completion_ratio: 1,
    support_summary: { prompt_level_distribution: {}, accommodations_used: [], instruction_replay_count: 0 },
    safety_summary: { safety_incidents: [], safety_overridden: false },
    validity_limitations: [],
    recommended_training_focus: [
      { job_module_code: 'M2', linked_task_code: TASK_CODE, recommendation_text: '继续拆箱补货训练' }
    ],
    teacher_observations: []
  }
}

function seedJobResult(db: DBAdapter, teacherId: string, studentId: string): string {
  const sessionId = seedAssessmentSessionFixture(db, {
    studentId,
    strategyId: 'strategy_job_skill_shelver_v1',
    strategyType: 'JOB_SKILL_ASSESSMENT',
    jobCode: JOB_CODE,
    taskCode: 'JOB_SKILL_DEMO_M1M6',
    status: 'COMPLETED',
    onlineQuestionCount: 0,
    offlineQuestionCount: 0,
    createdBy: teacherId
  })
  db.prepare('UPDATE assessment_session SET started_at = ?, completed_at = ? WHERE session_id = ?').run(ISO, ISO, sessionId)
  const resultId = uuidv4()
  db.prepare(
    `INSERT INTO result_record
       (result_id, student_id, result_type, source_aggregate_type, source_aggregate_id,
        strategy_id, strategy_type, job_code, raw_score, max_score, normalized_score,
        completion_ratio, level_result, result_payload_json, generated_event_id, generated_at, is_current)
     VALUES (?, ?, 'JOB_SKILL_SCORE', 'ASSESSMENT_SESSION', ?, 'strategy_job_skill_shelver_v1',
             'JOB_SKILL_ASSESSMENT', ?, 24, 48, 50, 1, 'LEVEL_NOT_COMPETENT', ?, ?, ?, 1)`
  ).run(resultId, studentId, sessionId, JOB_CODE, JSON.stringify(jobPayload()), eventId(db, sessionId), ISO)
  return resultId
}

function countRows(db: DBAdapter, sql: string): number {
  return (db.prepare(sql).get() as { count: number }).count
}

describe('ReportService generation', () => {
  it('generates BASE report idempotently from task_closure_id', async () => {
    const db = await createTestDb()
    try {
      const teacherId = seedCaller(db, 'TEACHER')
      const studentId = seedStudent(db)
      const closure = await new TaskClosureService(db, createTestReportCommandCoordinator({ db, actionLogPath: logPath() }))
        .confirmBaseTaskClosure({ callerUserId: teacherId, callerRole: 'TEACHER', resultIds: seedBaseResults(db, teacherId, studentId), confirmedAt: ISO, correlationId: CORRELATION_ID })
      const svc = service(db)

      const first = await svc.generateReport({ callerUserId: teacherId, callerRole: 'TEACHER', reportScope: 'BASE_ABILITY', taskClosureId: closure.taskClosureId, generatedAt: ISO, correlationId: CORRELATION_ID })
      const second = await svc.generateReport({ callerUserId: teacherId, callerRole: 'TEACHER', reportScope: 'BASE_ABILITY', taskClosureId: closure.taskClosureId, generatedAt: '2026-07-25T10:01:00.000Z', correlationId: CORRELATION_ID })

      expect(first.generated).toBe(true)
      expect(second).toEqual({ reportId: first.reportId, generated: false, eventId: null })
      expect(countRows(db, "SELECT COUNT(*) AS count FROM domain_event_projection WHERE event_type = 'REPORT_GENERATED'")).toBe(1)
    } finally {
      db.close()
    }
  })

  it('repairs invalid legacy JOB report as revision 2 and supersedes old active row', async () => {
    const db = await createTestDb()
    try {
      const teacherId = seedCaller(db, 'TEACHER')
      const studentId = seedStudent(db)
      const resultId = seedJobResult(db, teacherId, studentId)
      const built = buildJobSkillReport(db, resultId, ISO)
      const legacyId = uuidv4()
      db.prepare(
        `INSERT INTO task_report
           (report_id, report_type, student_id, source_aggregate_type, source_aggregate_id,
            source_result_ids_json, report_title, report_content_json, generated_event_id,
            generated_by, generated_at, lineage_key, source_set_hash, generation_key, content_hash,
            report_revision, report_schema_version, report_builder_version, generation_reason,
            contract_validation_status, status)
         VALUES (?, 'FULL_REPORT', ?, 'ASSESSMENT_SESSION', ?, ?, '旧 JOB 报告', '{}', ?,
                 ?, ?, ?, ?, ?, ?, 1, 'legacy-unknown', 'legacy-unknown', 'NORMAL',
                 'REPAIR_REQUIRED', 'GENERATED')`
      ).run(
        legacyId,
        studentId,
        built.sourceAggregateId,
        JSON.stringify([resultId]),
        eventId(db, legacyId),
        teacherId,
        ISO,
        built.lineageKey,
        HASH,
        'b'.repeat(64),
        HASH
      )

      const generated = await service(db).generateReport({ callerUserId: teacherId, callerRole: 'TEACHER', reportScope: 'JOB_SKILL', resultId, generatedAt: ISO, correlationId: CORRELATION_ID })
      const row = db.prepare('SELECT report_revision, generation_reason, repair_of_report_id FROM task_report WHERE report_id = ?').get(generated.reportId) as {
        report_revision: number
        generation_reason: string
        repair_of_report_id: string
      }
      const old = db.prepare('SELECT status FROM task_report WHERE report_id = ?').get(legacyId) as { status: string }

      expect(row).toEqual({ report_revision: 2, generation_reason: 'CONTRACT_REPAIR', repair_of_report_id: legacyId })
      expect(old.status).toBe('SUPERSEDED')
    } finally {
      db.close()
    }
  })

  it('records generation failure to exception center without creating a FAILED report', async () => {
    const db = await createTestDb()
    try {
      const teacherId = seedCaller(db, 'TEACHER')
      const studentId = seedStudent(db)
      const incidentId = uuidv4()
      db.prepare(
        `INSERT INTO safety_incident
           (incident_id, student_id, job_code, task_code, trigger_event_id, reason_code,
            description, triggered_by, context_phase, occurred_at, status)
         VALUES (?, ?, ?, ?, ?, 'BLADE_TOWARD_SELF', '待确认', ?, 'OFFLINE_SCORING', ?, 'PENDING_DETAIL')`
      ).run(incidentId, studentId, JOB_CODE, TASK_CODE, eventId(db, incidentId), teacherId, ISO)

      await expect(service(db).generateReport({ callerUserId: teacherId, callerRole: 'TEACHER', reportScope: 'SAFETY', incidentId, generatedAt: ISO, correlationId: CORRELATION_ID }))
        .rejects.toBeInstanceOf(ReportServiceError)
      expect(countRows(db, "SELECT COUNT(*) AS count FROM error_event_log WHERE error_code = 'REPORT_GENERATION_FAILED'")).toBe(1)
      expect(countRows(db, "SELECT COUNT(*) AS count FROM task_report WHERE status = 'FAILED'")).toBe(0)
    } finally {
      db.close()
    }
  })
})
