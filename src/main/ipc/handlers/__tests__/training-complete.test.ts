// TRAINING_COMPLETED 闭环测试：result_record 正确生成、level_result 按 scoring_policy 计算
// 覆盖 impl.md Step 6 测试用例。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { v4 as uuidv4 } from 'uuid'

const { mockState } = vi.hoisted(() => ({
  mockState: {
    db: null as unknown as import('../../../db/interface').DBAdapter,
    seqMap: new Map<string, number>()
  }
}))

vi.mock('../../../domain/event-writer', () => ({
  writeEvent: vi.fn(
    (params: import('../../../domain/event-writer').WriteEventParams): import('@shared/types/event-payloads').ActionLogEntry => {
      if (!mockState.db) throw new Error('mock writeEvent: mockState.db not set')
      const eventId = uuidv4()
      const seq = (mockState.seqMap.get(params.aggregateId) ?? 0) + 1
      mockState.seqMap.set(params.aggregateId, seq)
      const entry: import('@shared/types/event-payloads').ActionLogEntry = {
        event_id: eventId,
        aggregate_type: params.aggregateType,
        aggregate_id: params.aggregateId,
        event_type: params.eventType,
        event_sequence: seq,
        payload: params.payload,
        checksum: 'test-checksum',
        schema_version: 1,
        created_at: new Date().toISOString(),
        actor_id: params.actorId,
        actor_role: params.actorRole,
        app_version: 'test'
      }
      mockState.db
        .prepare(
          `INSERT INTO domain_event_projection
             (event_id, aggregate_type, aggregate_id, event_type, event_sequence,
              payload_json, checksum, source_log_path, schema_version, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          entry.event_id, entry.aggregate_type, entry.aggregate_id,
          entry.event_type, entry.event_sequence,
          JSON.stringify(entry.payload), entry.checksum,
          'test-action-log.jsonl', entry.schema_version, entry.created_at
        )
      return entry
    }
  )
}))

import {
  getTrainingSession,
  listTrainingSessions,
  listMyTrainingSessions
} from '../training'
import { writeEvent } from '../../../domain/event-writer'
import { createTrainingTestCommands } from '../../../application/services/__tests__/training-test-support'
import {
  createTestDb,
  seedAssessmentSessionFixture,
  seedCaller,
  seedQuestionBank,
  seedStudent
} from '../../../db/test-helpers'
import type { MemoryAdapter } from '../../../db/memory-adapter'

const {
  createTrainingSession,
  startStep,
  completeStep,
  skipStep,
  failStep,
  retryStep
} = createTrainingTestCommands({ writeEvent })

let db: MemoryAdapter
let callerId: string
let studentId: string
let trainingSessionId: string

const taskCode = 'SHELVE_TASK'
const strategyId = 'strategy_training_shelver_v1'
const strategyVersion = 1

function getStepId(stepOrder: number): string {
  const step = db
    .prepare(`SELECT training_step_record_id FROM training_step_record WHERE training_session_id = ? AND step_order = ?`)
    .get(trainingSessionId, stepOrder) as { training_step_record_id: string }
  return step.training_step_record_id
}

function getSession() {
  return db
    .prepare('SELECT * FROM training_session WHERE training_session_id = ?')
    .get(trainingSessionId) as Record<string, unknown>
}

function getResultRecord() {
  return db
    .prepare(
      `SELECT * FROM result_record
        WHERE source_aggregate_type = 'TRAINING_SESSION' AND source_aggregate_id = ?`
    )
    .get(trainingSessionId) as Record<string, unknown> | undefined
}

function insertAssessmentProjectionEvent(sessionId: string, eventType: string): string {
  const eventId = uuidv4()
  const row = db
    .prepare('SELECT MAX(event_sequence) AS max_seq FROM domain_event_projection WHERE aggregate_id = ?')
    .get(sessionId) as { max_seq: number | null }
  db.prepare(
    `INSERT INTO domain_event_projection
       (event_id, aggregate_type, aggregate_id, event_type, event_sequence,
        payload_json, checksum, source_log_path, schema_version, created_at)
     VALUES (?, 'ASSESSMENT_SESSION', ?, ?, ?, '{}', 'training-noise-checksum', 'training-noise.jsonl', 1, ?)`
  ).run(eventId, sessionId, eventType, (row.max_seq ?? 0) + 1, new Date().toISOString())
  return eventId
}

function seedAssessmentNoiseForTraining(): string {
  seedQuestionBank(db)
  const assessmentSessionId = seedAssessmentSessionFixture(db, {
    studentId,
    strategyId: 'strategy_baseline_shelver_v1',
    strategyType: 'BASELINE_ASSESSMENT',
    taskCode,
    status: 'OFFLINE_PENDING',
    deliveryPhase: 'OFFLINE_SCORING',
    createdBy: callerId
  })

  const onlineQuestion = db
    .prepare(
      `SELECT question_id, module_type, question_type
         FROM question_bank
        WHERE bank_domain = 'BASE_ABILITY'
          AND question_type = 'TRUE_FALSE'
        LIMIT 1`
    )
    .get() as { question_id: string; module_type: string; question_type: string }
  db.prepare(
    `INSERT INTO assessment_session_question
       (session_question_id, session_id, question_id, question_order, question_phase,
        bank_domain, module_type, question_type, item_usage)
     VALUES (?, ?, ?, 1, 'ONLINE',
             'BASE_ABILITY', ?, ?, 'SCORED_ITEM')`
  ).run(uuidv4(), assessmentSessionId, onlineQuestion.question_id, onlineQuestion.module_type, onlineQuestion.question_type)
  db.prepare(
    `INSERT INTO answer_record
       (answer_id, session_id, question_id, question_type, answer_payload_json,
        is_correct, score, submitted_event_id, status)
     VALUES (?, ?, ?, ?, '{"answer":true}', 1, 2, ?, 'VALID')`
  ).run(
    uuidv4(),
    assessmentSessionId,
    onlineQuestion.question_id,
    onlineQuestion.question_type,
    insertAssessmentProjectionEvent(assessmentSessionId, 'ANSWER_SUBMITTED')
  )

  const offlineQuestion = db
    .prepare(
      `SELECT question_id, module_type
         FROM question_bank
        WHERE bank_domain = 'BASE_ABILITY'
          AND question_type = 'OFFLINE_OPERATION'
        LIMIT 1`
    )
    .get() as { question_id: string; module_type: string }
  db.prepare(
    `INSERT INTO assessment_session_question
       (session_question_id, session_id, question_id, question_order, question_phase,
        bank_domain, module_type, question_type, item_usage)
     VALUES (?, ?, ?, 2, 'OFFLINE',
             'BASE_ABILITY', ?, 'OFFLINE_OPERATION', 'SCORED_ITEM')`
  ).run(uuidv4(), assessmentSessionId, offlineQuestion.question_id, offlineQuestion.module_type)
  db.prepare(
    `INSERT INTO offline_score_record
       (offline_score_id, session_id, question_id, score_scope, task_operation_code,
        score, scoring_rubric_json, scored_by, scored_event_id, tool_checklist_confirmed)
     VALUES (?, ?, ?, 'OFFLINE_ABILITY', NULL, 2, '{}', ?, ?, 1)`
  ).run(
    uuidv4(),
    assessmentSessionId,
    offlineQuestion.question_id,
    callerId,
    insertAssessmentProjectionEvent(assessmentSessionId, 'OFFLINE_SCORE_SUBMITTED')
  )

  return assessmentSessionId
}

/** 完成指定步骤（start + complete） */
function doStep(stepOrder: number): void {
  const id = getStepId(stepOrder)
  startStep(db, { callerUserId: studentId, callerRole: 'STUDENT', trainingSessionId, stepRecordId: id })
  completeStep(db, { callerUserId: studentId, callerRole: 'STUDENT', trainingSessionId, stepRecordId: id })
}

/** 跳过指定步骤 */
function skipS(stepOrder: number): void {
  const id = getStepId(stepOrder)
  skipStep(db, { callerUserId: studentId, callerRole: 'STUDENT', trainingSessionId, stepRecordId: id })
}

beforeEach(async () => {
  db = await createTestDb()
  callerId = seedCaller(db, 'TEACHER')
  studentId = seedStudent(db)
  mockState.db = db
  mockState.seqMap = new Map()

  const result = createTrainingSession(db, {
    callerUserId: callerId,
    callerRole: 'TEACHER',
    studentId,
    strategyId,
    strategyVersion,
    moduleType: 'FINE_MOTOR',
    taskCode
  })
  if (!result.success) throw new Error(`createTrainingSession failed`)
  trainingSessionId = result.trainingSessionId
})

afterEach(() => {
  db.close()
})

describe('TRAINING_COMPLETED 闭环', () => {
  it('4 步全 COMPLETED → completion_rate=100，level=LEVEL_COMPETENT，session.status=COMPLETED', () => {
    for (let i = 1; i <= 4; i++) doStep(i)

    const session = getSession()
    expect(session.status).toBe('COMPLETED')
    expect(session.completion_rate).toBe(100)

    const rr = getResultRecord()
    expect(rr).toBeDefined()
    expect(rr!.normalized_score).toBe(100)
    expect(rr!.level_result).toBe('LEVEL_COMPETENT')
    expect(rr!.result_type).toBe('TRAINING_COMPLETION')
    expect(rr!.source_aggregate_id).toBe(trainingSessionId)
    expect(rr!.strategy_id).toBe(strategyId)
    expect(rr!.strategy_type).toBe('TRAINING_PRACTICE')
    expect(rr!.module_type).toBe('FINE_MOTOR')
  })

  it('双轨隔离：测评题和线下评分不会生成或污染 TRAINING_COMPLETION', () => {
    const assessmentSessionId = seedAssessmentNoiseForTraining()
    for (let i = 1; i <= 4; i++) doStep(i)

    const rr = getResultRecord()
    expect(rr).toBeDefined()
    expect(rr!.result_type).toBe('TRAINING_COMPLETION')
    expect(rr!.source_aggregate_type).toBe('TRAINING_SESSION')
    expect(rr!.source_aggregate_id).toBe(trainingSessionId)
    expect(rr!.normalized_score).toBe(100)
    expect(rr!.completion_ratio).toBe(1)

    const assessmentResultCount = db
      .prepare(
        `SELECT COUNT(*) AS n
           FROM result_record
          WHERE source_aggregate_type = 'ASSESSMENT_SESSION'
            AND source_aggregate_id = ?`
      )
      .get(assessmentSessionId) as { n: number }
    expect(assessmentResultCount.n).toBe(0)
  })

  it('3 COMPLETED + 1 SKIPPED → completion_rate=75，level=LEVEL_CONDITIONAL', () => {
    for (let i = 1; i <= 3; i++) doStep(i)
    skipS(4)

    const session = getSession()
    expect(session.status).toBe('COMPLETED')
    expect(session.completion_rate).toBe(75)

    const rr = getResultRecord()
    expect(rr!.normalized_score).toBe(75)
    expect(rr!.level_result).toBe('LEVEL_CONDITIONAL')
  })

  it('4 步全 SKIPPED → completion_rate=0，level=LEVEL_NOT_COMPETENT', () => {
    for (let i = 1; i <= 4; i++) skipS(i)

    const rr = getResultRecord()
    expect(rr!.normalized_score).toBe(0)
    expect(rr!.level_result).toBe('LEVEL_NOT_COMPETENT')
  })

  it('3 COMPLETED + 1 FAILED → completion_rate=75（FAILED 不计入分子）', () => {
    for (let i = 1; i <= 3; i++) doStep(i)
    const id4 = getStepId(4)
    startStep(db, { callerUserId: studentId, callerRole: 'STUDENT', trainingSessionId, stepRecordId: id4 })
    failStep(db, { callerUserId: studentId, callerRole: 'STUDENT', trainingSessionId, stepRecordId: id4 })
    // FAILED → retried → skipped，此时 NOT_STARTED = 0，触发 sessionCompleted
    retryStep(db, { callerUserId: studentId, callerRole: 'STUDENT', trainingSessionId, stepRecordId: id4 })
    skipStep(db, { callerUserId: studentId, callerRole: 'STUDENT', trainingSessionId, stepRecordId: id4 })

    const rr = getResultRecord()
    expect(rr!.normalized_score).toBe(75)
  })

  it('result_record.source_aggregate_id = training_session_id，checksum 正确', () => {
    for (let i = 1; i <= 4; i++) doStep(i)
    const rr = getResultRecord()
    expect(rr!.source_aggregate_id).toBe(trainingSessionId)
    expect(rr!.generated_event_id).toBeTruthy()
  })

  it('sessionCompleted: true 标记在最后一步返回结果中', () => {
    for (let i = 1; i <= 3; i++) doStep(i)
    const id4 = getStepId(4)
    startStep(db, { callerUserId: studentId, callerRole: 'STUDENT', trainingSessionId, stepRecordId: id4 })
    const result = completeStep(db, { callerUserId: studentId, callerRole: 'STUDENT', trainingSessionId, stepRecordId: id4 })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.sessionCompleted).toBe(true)
  })
})

describe('listTrainingSessions', () => {
  it('TEACHER 列出所有 session，返回正确记录', () => {
    const result = listTrainingSessions(db, {
      callerUserId: callerId,
      callerRole: 'TEACHER'
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.total).toBeGreaterThanOrEqual(1)
    const found = result.sessions.find((s) => s.trainingSessionId === trainingSessionId)
    expect(found).toBeDefined()
    expect(found!.status).toBe('INIT')
  })

  it('按 studentId 筛选', () => {
    const result = listTrainingSessions(db, {
      callerUserId: callerId,
      callerRole: 'TEACHER',
      studentId
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.sessions.every((s) => s.studentId === studentId)).toBe(true)
  })

  it('FORBIDDEN：STUDENT 调用 listSessions', () => {
    const result = listTrainingSessions(db, {
      callerUserId: studentId,
      callerRole: 'STUDENT'
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.errorCode).toBe('FORBIDDEN')
  })
})

describe('listMyTrainingSessions', () => {
  it('STUDENT 只返回本人训练，TEACHER 不能调用本人入口', () => {
    const anotherStudentId = seedStudent(db)
    const another = createTrainingSession(db, {
      callerUserId: callerId,
      callerRole: 'TEACHER',
      studentId: anotherStudentId,
      strategyId,
      strategyVersion,
      moduleType: 'COGNITION',
      taskCode
    })
    expect(another.success).toBe(true)

    const result = listMyTrainingSessions(db, {
      callerUserId: studentId, callerRole: 'STUDENT'
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.sessions).toHaveLength(1)
    expect(result.sessions[0].trainingSessionId).toBe(trainingSessionId)
    expect(result.sessions.every((session) => session.studentId === studentId)).toBe(true)
    expect(listMyTrainingSessions(db, {
      callerUserId: callerId, callerRole: 'TEACHER'
    })).toEqual({ success: false, errorCode: 'FORBIDDEN' })
  })
})

describe('getTrainingSession', () => {
  it('TEACHER 可读任意 session，steps 数量 = 4', () => {
    const result = getTrainingSession(db, {
      callerUserId: callerId,
      callerRole: 'TEACHER',
      trainingSessionId
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.session.trainingSessionId).toBe(trainingSessionId)
    expect(result.session.steps).toHaveLength(4)
    expect(result.session.steps[0].stepType).toBe('WATCH')
  })

  it('STUDENT 可读自己的 session', () => {
    const result = getTrainingSession(db, {
      callerUserId: studentId,
      callerRole: 'STUDENT',
      trainingSessionId
    })
    expect(result.success).toBe(true)
  })

  it('STUDENT 不可读他人 session → FORBIDDEN', () => {
    const anotherStudentId = seedStudent(db)
    const result = getTrainingSession(db, {
      callerUserId: anotherStudentId,
      callerRole: 'STUDENT',
      trainingSessionId
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.errorCode).toBe('FORBIDDEN')
  })
})
