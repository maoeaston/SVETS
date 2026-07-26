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

const ISO = '2026-07-25T10:00:00.000Z'
const JOB_CODE = 'SUPERMARKET_SHELVER'
const TASK_CODE = 'SHELVE_TASK'
const HASH = 'a'.repeat(64)

const dirs: string[] = []

function createLogPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'svets-task-closure-test-'))
  dirs.push(dir)
  return join(dir, 'action_log.jsonl')
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function service(db: DBAdapter): TaskClosureService {
  return new TaskClosureService(db, new ReportCommandCoordinator({ db, actionLogPath: createLogPath() }))
}

function eventId(db: DBAdapter, aggregateId: string): string {
  const id = uuidv4()
  db.prepare(
    `INSERT INTO domain_event_projection
       (event_id, aggregate_type, aggregate_id, event_type, event_sequence, payload_json,
        checksum, source_log_path, schema_version, created_at)
     VALUES (?, 'SYSTEM', ?, 'RESULT_CALCULATED', 1, '{}', 'checksum', 'test', 1, ?)`
  ).run(id, `${aggregateId}:${id}`, ISO)
  return id
}

function seedTrainingSession(db: DBAdapter, teacherId: string, studentId: string): string {
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

interface BaseResultSet {
  abilityResultId: string
  trainingResultId: string
  operationResultId: string
  assessmentId: string
  trainingId: string
}

function seedBaseResults(
  db: DBAdapter,
  teacherId: string,
  studentId: string,
  over: { assessmentId?: string; abilityScore?: number; operationScore?: number } = {}
): BaseResultSet {
  const assessmentId = over.assessmentId ?? seedAssessmentSessionFixture(db, {
    studentId,
    strategyId: 'strategy_baseline_shelver_v1',
    jobCode: JOB_CODE,
    taskCode: TASK_CODE,
    status: 'COMPLETED',
    createdBy: teacherId
  })
  db.prepare('UPDATE assessment_session SET started_at = ?, completed_at = ? WHERE session_id = ?')
    .run(ISO, ISO, assessmentId)
  const trainingId = seedTrainingSession(db, teacherId, studentId)
  const abilityResultId = uuidv4()
  const trainingResultId = uuidv4()
  const operationResultId = uuidv4()
  const abilityScore = over.abilityScore ?? 60
  const operationScore = over.operationScore ?? 18
  const insert = db.prepare(
    `INSERT INTO result_record
       (result_id, student_id, result_type, source_aggregate_type, source_aggregate_id,
        strategy_id, strategy_type, job_code, raw_score, max_score, normalized_score,
        completion_ratio, level_result, result_payload_json, generated_event_id, generated_at, is_current)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
  )
  insert.run(
    abilityResultId,
    studentId,
    'ABILITY_SCORE',
    'ASSESSMENT_SESSION',
    assessmentId,
    'strategy_baseline_shelver_v1',
    'BASELINE_ASSESSMENT',
    JOB_CODE,
    abilityScore,
    100,
    abilityScore,
    1,
    'LEVEL_CONDITIONAL',
    JSON.stringify({
      result_type: 'ABILITY_SCORE',
      module_scores: [],
      online_raw_score: abilityScore,
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
    trainingResultId,
    studentId,
    'TRAINING_COMPLETION',
    'TRAINING_SESSION',
    trainingId,
    'strategy_training_shelver_v1',
    'TRAINING_PRACTICE',
    JOB_CODE,
    null,
    null,
    100,
    1,
    'LEVEL_COMPETENT',
    null,
    eventId(db, trainingId),
    ISO
  )
  insert.run(
    operationResultId,
    studentId,
    'OPERATION_PASS_RATE',
    'ASSESSMENT_SESSION',
    assessmentId,
    'strategy_baseline_shelver_v1',
    'BASELINE_ASSESSMENT',
    JOB_CODE,
    operationScore,
    18,
    Math.round((operationScore / 18) * 100),
    1,
    'LEVEL_COMPETENT',
    JSON.stringify({
      result_type: 'OPERATION_PASS_RATE',
      raw_score: operationScore,
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
      ].map((task_operation_code, index) => ({ task_operation_code, score: index === 0 ? operationScore - 16 : 2 }))
    }),
    eventId(db, assessmentId),
    ISO
  )
  return { abilityResultId, trainingResultId, operationResultId, assessmentId, trainingId }
}

function resultIds(set: BaseResultSet): [string, string, string] {
  return [set.abilityResultId, set.trainingResultId, set.operationResultId]
}

function countEvents(db: DBAdapter, eventType: string): number {
  const row = db.prepare('SELECT COUNT(*) AS count FROM domain_event_projection WHERE event_type = ?').get(eventType) as { count: number }
  return row.count
}

function closureRow(db: DBAdapter, closureId: string) {
  return db.prepare(
    `SELECT task_closure_id, status, is_cycle_head, cycle_no, closure_revision,
            ability_result_id, training_completion_result_id, operation_pass_rate_result_id,
            replacement_task_closure_id
       FROM task_closure WHERE task_closure_id = ?`
  ).get(closureId) as Record<string, unknown>
}

function seedLockedReport(db: DBAdapter, closureId: string, studentId: string, teacherId: string): string {
  const reportId = uuidv4()
  db.prepare(
    `INSERT INTO task_report
       (report_id, report_type, student_id, report_title, report_content_json, generated_event_id,
        generated_by, generated_at, task_closure_id, lineage_key, source_set_hash, generation_key,
        content_hash, report_revision, report_schema_version, report_builder_version, generation_reason,
        contract_validation_status, status)
     VALUES (?, 'FULL_REPORT', ?, '旧报告', '{}', ?, ?, ?, ?, ?, ?, ?, ?, 1,
             'task-report-v1.1', 'test', 'NORMAL', 'VALID', 'LOCKED')`
  ).run(reportId, studentId, eventId(db, reportId), teacherId, ISO, closureId, HASH, HASH, HASH, HASH)
  return reportId
}

describe('TaskClosureService', () => {
  it('confirms a BASE closure once and returns the current fingerprint on retry', async () => {
    const db = await createTestDb()
    try {
      const teacherId = seedCaller(db, 'TEACHER')
      const studentId = seedStudent(db)
      const set = seedBaseResults(db, teacherId, studentId)
      const svc = service(db)

      const first = await svc.confirmBaseTaskClosure({ callerUserId: teacherId, callerRole: 'TEACHER', resultIds: resultIds(set), confirmedAt: ISO })
      const second = await svc.confirmBaseTaskClosure({ callerUserId: teacherId, callerRole: 'TEACHER', resultIds: resultIds(set), confirmedAt: ISO })

      expect(first.created).toBe(true)
      expect(second).toEqual({ taskClosureId: first.taskClosureId, created: false, eventId: null })
      expect(countEvents(db, 'TASK_CLOSURE_CONFIRMED')).toBe(1)
      expect(closureRow(db, first.taskClosureId)).toMatchObject({
        status: 'CONFIRMED',
        is_cycle_head: 1,
        cycle_no: 1,
        closure_revision: 1,
        ability_result_id: set.abilityResultId,
        training_completion_result_id: set.trainingResultId,
        operation_pass_rate_result_id: set.operationResultId
      })
    } finally {
      db.close()
    }
  })

  it('rejects normal confirmation when a result was used by historical closure', async () => {
    const db = await createTestDb()
    try {
      const teacherId = seedCaller(db, 'TEACHER')
      const studentId = seedStudent(db)
      const set = seedBaseResults(db, teacherId, studentId)
      const svc = service(db)
      await svc.confirmBaseTaskClosure({ callerUserId: teacherId, callerRole: 'TEACHER', resultIds: resultIds(set), confirmedAt: ISO })

      const next = seedBaseResults(db, teacherId, studentId, { operationScore: 17 })
      await expect(svc.confirmBaseTaskClosure({
        callerUserId: teacherId,
        callerRole: 'TEACHER',
        resultIds: [set.abilityResultId, next.trainingResultId, next.operationResultId],
        confirmedAt: ISO
      })).rejects.toMatchObject({ code: 'RESULT_ALREADY_USED' })
      expect(countEvents(db, 'TASK_CLOSURE_CONFIRMED')).toBe(1)
    } finally {
      db.close()
    }
  })

  it('supersedes previous active closure and active reports when confirming a new cycle', async () => {
    const db = await createTestDb()
    try {
      const teacherId = seedCaller(db, 'TEACHER')
      const studentId = seedStudent(db)
      const svc = service(db)
      const firstSet = seedBaseResults(db, teacherId, studentId)
      const first = await svc.confirmBaseTaskClosure({ callerUserId: teacherId, callerRole: 'TEACHER', resultIds: resultIds(firstSet), confirmedAt: ISO })
      const reportId = seedLockedReport(db, first.taskClosureId, studentId, teacherId)
      const secondSet = seedBaseResults(db, teacherId, studentId, { abilityScore: 70 })

      const second = await svc.confirmBaseTaskClosure({ callerUserId: teacherId, callerRole: 'TEACHER', resultIds: resultIds(secondSet), confirmedAt: ISO })

      expect(closureRow(db, first.taskClosureId)).toMatchObject({ status: 'SUPERSEDED', is_cycle_head: 0 })
      expect(closureRow(db, second.taskClosureId)).toMatchObject({ status: 'CONFIRMED', is_cycle_head: 1, cycle_no: 2 })
      expect(db.prepare('SELECT status FROM task_report WHERE report_id = ?').get(reportId)).toEqual({ status: 'SUPERSEDED' })
    } finally {
      db.close()
    }
  })

  it('replaces the current head, allows direct old result reuse, and archives old reports idempotently', async () => {
    const db = await createTestDb()
    try {
      const teacherId = seedCaller(db, 'TEACHER')
      const studentId = seedStudent(db)
      const svc = service(db)
      const firstSet = seedBaseResults(db, teacherId, studentId)
      const first = await svc.confirmBaseTaskClosure({ callerUserId: teacherId, callerRole: 'TEACHER', resultIds: resultIds(firstSet), confirmedAt: ISO })
      const reportId = seedLockedReport(db, first.taskClosureId, studentId, teacherId)
      const correctedSet = seedBaseResults(db, teacherId, studentId, { operationScore: 17 })

      const replacement = await svc.replaceBaseTaskClosure({
        callerUserId: teacherId,
        callerRole: 'TEACHER',
        oldTaskClosureId: first.taskClosureId,
        resultIds: [firstSet.abilityResultId, firstSet.trainingResultId, correctedSet.operationResultId],
        correctionReason: '修正线下操作评分来源',
        replacedAt: ISO
      })
      const retry = await svc.replaceBaseTaskClosure({
        callerUserId: teacherId,
        callerRole: 'TEACHER',
        oldTaskClosureId: first.taskClosureId,
        resultIds: [firstSet.abilityResultId, firstSet.trainingResultId, correctedSet.operationResultId],
        correctionReason: '修正线下操作评分来源',
        replacedAt: ISO
      })

      expect(retry).toEqual({ taskClosureId: replacement.taskClosureId, created: false, eventId: null })
      expect(countEvents(db, 'TASK_CLOSURE_REPLACED')).toBe(1)
      expect(closureRow(db, first.taskClosureId)).toMatchObject({
        status: 'SUPERSEDED',
        is_cycle_head: 0,
        replacement_task_closure_id: replacement.taskClosureId
      })
      expect(closureRow(db, replacement.taskClosureId)).toMatchObject({
        status: 'CONFIRMED',
        is_cycle_head: 1,
        closure_revision: 2,
        operation_pass_rate_result_id: correctedSet.operationResultId
      })
      expect(db.prepare('SELECT status FROM task_report WHERE report_id = ?').get(reportId)).toEqual({ status: 'ARCHIVED' })
    } finally {
      db.close()
    }
  })

  it('returns the old closure without event when replacement does not change bindings', async () => {
    const db = await createTestDb()
    try {
      const teacherId = seedCaller(db, 'TEACHER')
      const studentId = seedStudent(db)
      const svc = service(db)
      const set = seedBaseResults(db, teacherId, studentId)
      const first = await svc.confirmBaseTaskClosure({ callerUserId: teacherId, callerRole: 'TEACHER', resultIds: resultIds(set), confirmedAt: ISO })

      const unchanged = await svc.replaceBaseTaskClosure({
        callerUserId: teacherId,
        callerRole: 'TEACHER',
        oldTaskClosureId: first.taskClosureId,
        resultIds: resultIds(set),
        correctionReason: '重复提交',
        replacedAt: ISO
      })

      expect(unchanged).toEqual({ taskClosureId: first.taskClosureId, created: false, eventId: null })
      expect(countEvents(db, 'TASK_CLOSURE_REPLACED')).toBe(0)
    } finally {
      db.close()
    }
  })

  it('keeps historical cycle replacement superseded and blocks cross-history result reuse', async () => {
    const db = await createTestDb()
    try {
      const teacherId = seedCaller(db, 'TEACHER')
      const studentId = seedStudent(db)
      const svc = service(db)
      const firstSet = seedBaseResults(db, teacherId, studentId)
      const first = await svc.confirmBaseTaskClosure({ callerUserId: teacherId, callerRole: 'TEACHER', resultIds: resultIds(firstSet), confirmedAt: ISO })
      const secondSet = seedBaseResults(db, teacherId, studentId, { abilityScore: 70 })
      await svc.confirmBaseTaskClosure({ callerUserId: teacherId, callerRole: 'TEACHER', resultIds: resultIds(secondSet), confirmedAt: ISO })
      const correction = seedBaseResults(db, teacherId, studentId, { operationScore: 17 })

      await expect(svc.replaceBaseTaskClosure({
        callerUserId: teacherId,
        callerRole: 'TEACHER',
        oldTaskClosureId: first.taskClosureId,
        resultIds: [firstSet.abilityResultId, secondSet.trainingResultId, correction.operationResultId],
        correctionReason: '跨历史复用',
        replacedAt: ISO
      })).rejects.toMatchObject({ code: 'INVALID_REPLACEMENT' })

      const historical = await svc.replaceBaseTaskClosure({
        callerUserId: teacherId,
        callerRole: 'TEACHER',
        oldTaskClosureId: first.taskClosureId,
        resultIds: [firstSet.abilityResultId, firstSet.trainingResultId, correction.operationResultId],
        correctionReason: '补正历史轮次',
        replacedAt: ISO
      })

      expect(closureRow(db, historical.taskClosureId)).toMatchObject({ status: 'SUPERSEDED', is_cycle_head: 0, cycle_no: 1 })
    } finally {
      db.close()
    }
  })

  it('requires an active teacher', async () => {
    const db = await createTestDb()
    try {
      const teacherId = seedCaller(db, 'TEACHER')
      const adminId = seedCaller(db, 'ADMIN')
      const studentId = seedStudent(db)
      const set = seedBaseResults(db, teacherId, studentId)
      await expect(service(db).confirmBaseTaskClosure({
        callerUserId: adminId,
        callerRole: 'TEACHER',
        resultIds: resultIds(set),
        confirmedAt: ISO
      })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    } finally {
      db.close()
    }
  })
})
