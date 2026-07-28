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
import { ReportCommandCoordinator } from '../report-command-coordinator'
import { TaskClosureService } from '../task-closure-service'
import { buildBaseAbilityReport, buildJobSkillReport, buildSafetyReport } from '../report-builders'
import { parseReportContent } from '../report-contract'

const ISO = '2026-07-25T10:00:00.000Z'
const BEFORE = '2026-07-25T09:59:59.000Z'
const JOB_CODE = 'SUPERMARKET_SHELVER'
const TASK_CODE = 'SHELVE_TASK'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function logPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'svets-report-builders-'))
  dirs.push(dir)
  return join(dir, 'action_log.jsonl')
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

function seedConfirmedIncident(db: DBAdapter, teacherId: string, studentId: string): string {
  const incidentId = uuidv4()
  db.prepare(
    `INSERT INTO safety_incident
       (incident_id, student_id, job_code, task_code, trigger_event_id, reason_code,
        description, triggered_by, context_phase, occurred_at, status)
     VALUES (?, ?, ?, ?, ?, 'BLADE_TOWARD_SELF', '安全事实', ?, 'OFFLINE_SCORING', ?, 'PENDING_DETAIL')`
  ).run(incidentId, studentId, JOB_CODE, TASK_CODE, eventId(db, incidentId), teacherId, ISO)
  db.prepare("UPDATE safety_incident SET status = 'CONFIRMED', confirmed_by = ? WHERE incident_id = ?")
    .run(teacherId, incidentId)
  return incidentId
}

describe('report builders', () => {
  it('builds a valid BASE report from frozen task closure snapshots', async () => {
    const db = await createTestDb()
    try {
      const teacherId = seedCaller(db, 'TEACHER')
      const studentId = seedStudent(db)
      const resultIds = seedBaseResults(db, teacherId, studentId)
      const closure = await new TaskClosureService(db, new ReportCommandCoordinator({ db, actionLogPath: logPath() }))
        .confirmBaseTaskClosure({ callerUserId: teacherId, callerRole: 'TEACHER', resultIds, confirmedAt: ISO })

      const built = buildBaseAbilityReport(db, closure.taskClosureId, ISO)

      expect(parseReportContent(built.content).valid).toBe(true)
      expect(built.content.source_meta.task_result_snapshots.map((snapshot) => snapshot.result_type))
        .toEqual(['ABILITY_SCORE', 'TRAINING_COMPLETION', 'OPERATION_PASS_RATE'])
      expect(built.content.score_summary.ability_score.result_id).toBe(resultIds[0])
      expect(built.content.placement_advice.enabled).toBe(false)
    } finally {
      db.close()
    }
  })

  it('builds a valid JOB_SKILL report with required F7 sections', async () => {
    const db = await createTestDb()
    try {
      const teacherId = seedCaller(db, 'TEACHER')
      const studentId = seedStudent(db)
      const resultId = seedJobResult(db, teacherId, studentId)

      const built = buildJobSkillReport(db, resultId, ISO)

      expect(parseReportContent(built.content).valid).toBe(true)
      expect(built.content.online_knowledge_summary).toMatchObject({ raw_score: 0, max_score: 0 })
      expect(built.content.offline_performance_summary).toMatchObject({ completed_item_count: 0, total_item_count: 0 })
      expect(built.content.administration_summary.report_usage).toBe('MVP_DEMO_PROFILE_ONLY')
      expect(built.content.source_meta.result_snapshot.result_id).toBe(resultId)
    } finally {
      db.close()
    }
  })

  it('builds SAFETY report from bindings and excludes records at or after occurred_at', async () => {
    const db = await createTestDb()
    try {
      const teacherId = seedCaller(db, 'TEACHER')
      const studentId = seedStudent(db)
      const sessionId = seedAssessmentSessionFixture(db, {
        studentId,
        strategyId: 'strategy_baseline_shelver_v1',
        jobCode: JOB_CODE,
        taskCode: TASK_CODE,
        status: 'ACTIVE',
        createdBy: teacherId
      })
      const qid = uuidv4()
      db.prepare(
        `INSERT INTO question_bank
           (question_id, job_code, bank_domain, module_type, question_type, item_usage,
            content_json, scoring_rule_json, status)
         VALUES (?, ?, 'BASE_ABILITY', 'SAFETY_OPERATION', 'TRUE_FALSE', 'SCORED_ITEM', '{}', '{}', 'ACTIVE')`
      ).run(qid, JOB_CODE)
      db.prepare(
        `INSERT INTO assessment_session_question
           (session_id, question_id, question_order, question_phase, bank_domain, module_type,
            question_type, item_usage)
         VALUES (?, ?, 1, 'ONLINE', 'BASE_ABILITY', 'SAFETY_OPERATION', 'TRUE_FALSE', 'SCORED_ITEM')`
      ).run(sessionId, qid)
      db.prepare(
        `INSERT INTO answer_record
           (answer_id, session_id, question_id, question_type, answer_payload_json,
            is_correct, score, submitted_event_id, submitted_at, status)
         VALUES (?, ?, ?, 'TRUE_FALSE', '{}', 1, 2, ?, ?, 'VALID')`
      ).run(uuidv4(), sessionId, qid, eventId(db, sessionId), BEFORE)
      db.prepare(
        `INSERT INTO answer_record
           (answer_id, session_id, question_id, question_type, answer_payload_json,
            is_correct, score, submitted_event_id, submitted_at, status)
         VALUES (?, ?, ?, 'TRUE_FALSE', '{}', 1, 2, ?, ?, 'SUPERSEDED')`
      ).run(uuidv4(), sessionId, qid, eventId(db, sessionId), ISO)

      const incidentId = seedConfirmedIncident(db, teacherId, studentId)

      const built = buildSafetyReport(db, incidentId, ISO)

      expect(parseReportContent(built.content).valid).toBe(true)
      expect(built.content.source_scope).toBe('BASE_ABILITY')
      expect(built.content.pre_redline_records.answer_summary).toEqual({ ANSWERED: 1 })
      expect(built.content.binding_snapshots).toHaveLength(1)
    } finally {
      db.close()
    }
  })

  it('builds SAFETY report for bound training steps from their durable creation timestamps', async () => {
    const db = await createTestDb()
    try {
      const teacherId = seedCaller(db, 'TEACHER')
      const studentId = seedStudent(db)
      const trainingId = seedTraining(db, teacherId, studentId)
      const stepId = uuidv4()
      db.prepare(
        `INSERT INTO training_step_record
           (training_step_record_id, training_session_id, step_code, step_name, step_order, step_type,
            status, attempt_count, generated_event_id, created_at, updated_at)
         VALUES (?, ?, 'WATCH', '观看示范', 1, 'WATCH', 'COMPLETED', 1, ?, ?, ?)`
      ).run(stepId, trainingId, eventId(db, trainingId, BEFORE), BEFORE, BEFORE)

      const incidentId = seedConfirmedIncident(db, teacherId, studentId)
      db.prepare(
        `INSERT INTO safety_incident_binding
           (binding_id, incident_id, aggregate_type, aggregate_id, pre_status, post_status, halt_event_id)
         VALUES (?, ?, 'TRAINING_SESSION', ?, 'ACTIVE', 'REDLINE_HALTED', ?)`
      ).run(uuidv4(), incidentId, trainingId, eventId(db, incidentId))

      const built = buildSafetyReport(db, incidentId, ISO)

      expect(parseReportContent(built.content).valid).toBe(true)
      expect(built.content.source_scope).toBe('TRAINING')
      expect(built.content.pre_redline_records.training_step_summary).toEqual({ COMPLETED: 1 })
      expect(built.content.source_meta.binding_metadata[0]).toMatchObject({
        aggregate_type: 'TRAINING_SESSION',
        pre_redline_steps: [{ step_record_id: stepId, status: 'COMPLETED', occurred_at: BEFORE }]
      })
    } finally {
      db.close()
    }
  })
})
