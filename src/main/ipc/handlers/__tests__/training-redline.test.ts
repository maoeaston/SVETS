// 安全红线应用层级联测试：IN_PROGRESS 步骤归档为 FAILED
// 覆盖 impl.md Step 7 测试用例。

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

import { writeEvent } from '../../../domain/event-writer'
import { haltTrainingSessionSteps as executeTrainingHalt } from '../../../application/services/training-service'
import {
  acceptedTestContext,
  createTrainingTestCommands
} from '../../../application/services/__tests__/training-test-support'
import { createTestDb, seedCaller, seedStudent } from '../../../db/test-helpers'
import type { MemoryAdapter } from '../../../db/memory-adapter'

const { createTrainingSession, startStep } = createTrainingTestCommands({ writeEvent })

let db: MemoryAdapter
let callerId: string
let studentId: string
let trainingSessionId: string

const taskCode = 'SHELVE_TASK'
const jobCode = 'SUPERMARKET_SHELVER'
const strategyId = 'strategy_training_shelver_v1'
const strategyVersion = 1

function haltTrainingSessionSteps(
  targetDb: MemoryAdapter,
  targetStudentId: string,
  targetJobCode: string,
  targetTaskCode: string
): void {
  executeTrainingHalt(targetDb, acceptedTestContext({
    commandType: 'assessment:triggerRedline',
    correlationId: `training-redline:${targetStudentId}:${targetJobCode}:${targetTaskCode}`,
    target: {
      aggregate_type: 'ASSESSMENT_SESSION',
      student_id: targetStudentId,
      job_code: targetJobCode,
      task_code: targetTaskCode
    }
  }))
}

function seedTrainingStrategyForJob(jobCode: string): string {
  const strategyIdForJob = `strategy_training_${jobCode.toLowerCase()}_v1`
  db.prepare(
    `INSERT INTO strategy_config
       (strategy_id, strategy_type, job_code, strategy_name,
        online_question_count, offline_question_count, max_score,
        competent_threshold, conditional_threshold, module_veto_threshold,
        emotion_collapse_threshold, question_policy_json, scoring_policy_json,
        supports_redline_halt, allows_emotion_interrupt, requires_offline_scoring,
        version, is_active)
     SELECT ?, strategy_type, ?, strategy_name,
            online_question_count, offline_question_count, max_score,
            competent_threshold, conditional_threshold, module_veto_threshold,
            emotion_collapse_threshold, question_policy_json, scoring_policy_json,
            supports_redline_halt, allows_emotion_interrupt, requires_offline_scoring,
            version, is_active
       FROM strategy_config
      WHERE strategy_id = ? AND version = ?`
  ).run(strategyIdForJob, jobCode, strategyId, strategyVersion)
  return strategyIdForJob
}

function getStepId(stepOrder: number): string {
  const step = db
    .prepare(`SELECT training_step_record_id FROM training_step_record WHERE training_session_id = ? AND step_order = ?`)
    .get(trainingSessionId, stepOrder) as { training_step_record_id: string }
  return step.training_step_record_id
}

function getStep(stepOrder: number) {
  return db
    .prepare(`SELECT * FROM training_step_record WHERE training_session_id = ? AND step_order = ?`)
    .get(trainingSessionId, stepOrder) as Record<string, unknown>
}

function getSession() {
  return db
    .prepare('SELECT * FROM training_session WHERE training_session_id = ?')
    .get(trainingSessionId) as Record<string, unknown>
}

/** 直接 REDLINE_HALT training_session（模拟 schema trigger 效果） */
function haltSessionDirectly(targetSessionId = trainingSessionId, targetJobCode = jobCode): void {
  // 先插一条 domain_event_projection 占位（schema trigger FK 检查会用到）
  const fakeEventId = uuidv4()
  db.prepare(
    `INSERT INTO domain_event_projection
       (event_id, aggregate_type, aggregate_id, event_type, event_sequence,
        payload_json, checksum, source_log_path, schema_version, created_at)
     VALUES (?, 'TRAINING_SESSION', ?, 'REDLINE_TRIGGERED', 99, '{}', 'x', 'test.jsonl', 1, datetime('now'))`
  ).run(fakeEventId, targetSessionId)

  // 插 safety_incident + 触发 schema trigger 批量熔断
  const triggerEventId = uuidv4()
  db.prepare(
    `INSERT INTO domain_event_projection
       (event_id, aggregate_type, aggregate_id, event_type, event_sequence,
        payload_json, checksum, source_log_path, schema_version, created_at)
     VALUES (?, 'SAFETY_INCIDENT', ?, 'SAFETY_INCIDENT_CREATED', 1, '{}', 'x', 'test.jsonl', 1, datetime('now'))`
  ).run(triggerEventId, uuidv4())

  const incidentId = uuidv4()
  db.prepare(
    `INSERT INTO safety_incident
       (incident_id, student_id, job_code, task_code, trigger_event_id,
        reason_code, triggered_by, context_phase, status,
        requires_review_before_next_session)
       VALUES (?, ?, ?, ?, ?,
             'OTHER_SAFETY_RISK', ?, 'OTHER', 'PENDING_DETAIL', 1)`
  ).run(incidentId, studentId, targetJobCode, taskCode, triggerEventId, callerId)
  // schema trigger trg_safety_incident_batch_halt_sessions 会自动将 INIT/ACTIVE session 置 REDLINE_HALTED
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

describe('haltTrainingSessionSteps', () => {
  it('IN_PROGRESS 步骤在红线后变为 FAILED', () => {
    // 开始 step 1（IN_PROGRESS）
    const step1Id = getStepId(1)
    startStep(db, { callerUserId: studentId, callerRole: 'STUDENT', trainingSessionId, stepRecordId: step1Id })
    expect(getStep(1).status).toBe('IN_PROGRESS')

    // 模拟红线：schema trigger 将 session 置 REDLINE_HALTED
    haltSessionDirectly()
    expect(getSession().status).toBe('REDLINE_HALTED')

    // 调用应用层级联
    haltTrainingSessionSteps(db, studentId, jobCode, taskCode)

    expect(getStep(1).status).toBe('FAILED')
  })

  it('NOT_STARTED 步骤不受影响', () => {
    // step 1 IN_PROGRESS，step 2 NOT_STARTED
    const step1Id = getStepId(1)
    startStep(db, { callerUserId: studentId, callerRole: 'STUDENT', trainingSessionId, stepRecordId: step1Id })

    haltSessionDirectly()
    haltTrainingSessionSteps(db, studentId, jobCode, taskCode)

    // step 2 仍然 NOT_STARTED
    expect(getStep(2).status).toBe('NOT_STARTED')
  })

  it('红线后再调用 startStep → SESSION_HALTED', () => {
    haltSessionDirectly()
    haltTrainingSessionSteps(db, studentId, jobCode, taskCode)

    const step1Id = getStepId(1)
    const result = startStep(db, {
      callerUserId: studentId,
      callerRole: 'STUDENT',
      trainingSessionId,
      stepRecordId: step1Id
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.errorCode).toBe('SESSION_HALTED')
  })

  it('M4：其他 job 的已 halt 训练步骤不被当前红线级联归档', () => {
    const otherStrategyId = seedTrainingStrategyForJob('WAREHOUSE_PICKER')
    const otherSession = createTrainingSession(db, {
      callerUserId: callerId,
      callerRole: 'TEACHER',
      studentId,
      strategyId: otherStrategyId,
      strategyVersion,
      moduleType: 'FINE_MOTOR',
      taskCode
    })
    expect(otherSession.success).toBe(true)
    if (!otherSession.success) return

    const otherStepId = db
      .prepare('SELECT training_step_record_id FROM training_step_record WHERE training_session_id = ? AND step_order = 1')
      .get(otherSession.trainingSessionId) as { training_step_record_id: string }
    startStep(db, {
      callerUserId: studentId,
      callerRole: 'STUDENT',
      trainingSessionId: otherSession.trainingSessionId,
      stepRecordId: otherStepId.training_step_record_id
    })
    haltSessionDirectly(otherSession.trainingSessionId, 'WAREHOUSE_PICKER')

    haltTrainingSessionSteps(db, studentId, jobCode, taskCode)

    const otherStep = db
      .prepare('SELECT status FROM training_step_record WHERE training_step_record_id = ?')
      .get(otherStepId.training_step_record_id) as { status: string }
    expect(otherStep.status).toBe('IN_PROGRESS')
  })
})
