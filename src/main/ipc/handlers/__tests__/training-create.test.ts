// training:createSession 集成测试：直接调 createTrainingSession 纯函数，注入 MemoryAdapter。
// 覆盖 impl.md Step 4 测试用例。
//
// writeEvent mock 与 assessment-create.test.ts 同模式：
// mock 内构造 ActionLogEntry + INSERT domain_event_projection（reducer FK 依赖）。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { v4 as uuidv4 } from 'uuid'

const { mockState } = vi.hoisted(() => ({
  mockState: { db: null as unknown as import('../../../db/interface').DBAdapter }
}))

vi.mock('../../../domain/event-writer', () => ({
  writeEvent: vi.fn(
    (params: import('../../../domain/event-writer').WriteEventParams): import('@shared/types/event-payloads').ActionLogEntry => {
      if (!mockState.db) throw new Error('mock writeEvent: mockState.db not set')
      const eventId = uuidv4()
      const entry: import('@shared/types/event-payloads').ActionLogEntry = {
        event_id: eventId,
        aggregate_type: params.aggregateType,
        aggregate_id: params.aggregateId,
        event_type: params.eventType,
        event_sequence: 1,
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
import { createTrainingTestCommands } from '../../../application/services/__tests__/training-test-support'
import { createTestDb, seedCaller, seedStudent } from '../../../db/test-helpers'
import type { MemoryAdapter } from '../../../db/memory-adapter'

const { createTrainingSession } = createTrainingTestCommands({ writeEvent })

let db: MemoryAdapter
let callerId: string
let studentId: string

const taskCode = 'SHELVE_TASK'
const strategyId = 'strategy_training_shelver_v1'
const strategyVersion = 1

function seedTrainingStrategyForJob(jobCode: string): string {
  const otherStrategyId = `strategy_training_${jobCode.toLowerCase()}_v1`
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
  ).run(otherStrategyId, jobCode, strategyId, strategyVersion)
  return otherStrategyId
}

/** 验证 training_session 状态 */
function getSession(trainingSessionId: string) {
  return db
    .prepare('SELECT * FROM training_session WHERE training_session_id = ?')
    .get(trainingSessionId) as Record<string, unknown> | undefined
}

/** 验证 training_step_record 数量 */
function getSteps(trainingSessionId: string) {
  return db
    .prepare(
      'SELECT * FROM training_step_record WHERE training_session_id = ? ORDER BY step_order ASC'
    )
    .all(trainingSessionId) as Record<string, unknown>[]
}

// 每个测试用新的内存 DB（training_session 有 DELETE 触发器，不能 cleanup 复用）
beforeEach(async () => {
  db = await createTestDb()
  callerId = seedCaller(db, 'TEACHER')
  studentId = seedStudent(db)
  mockState.db = db
})

afterEach(() => {
  db.close()
})

describe('createTrainingSession', () => {
  it('正常路径：TEACHER 创建成功，training_session status=INIT，4 个 step 全为 NOT_STARTED', async () => {
    const result = createTrainingSession(db, {
      callerUserId: callerId,
      callerRole: 'TEACHER',
      studentId,
      strategyId,
      strategyVersion,
      moduleType: 'FINE_MOTOR',
      taskCode
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.status).toBe('INIT')
    expect(result.businessSessionId).toBe(result.trainingSessionId)

    const session = getSession(result.trainingSessionId)
    expect(session).toBeDefined()
    expect(session!.business_session_id).toBe(result.trainingSessionId)
    expect(session!.status).toBe('INIT')
    expect(session!.total_step_count).toBe(4)
    expect(session!.completed_step_count).toBe(0)
    expect(session!.module_type).toBe('FINE_MOTOR')

    const parent = db
      .prepare('SELECT session_type, student_id, job_code, task_code FROM business_session WHERE business_session_id = ?')
      .get(result.trainingSessionId) as
      | { session_type: string; student_id: string; job_code: string; task_code: string }
      | undefined
    expect(parent).toEqual({
      session_type: 'TRAINING',
      student_id: studentId,
      job_code: 'SUPERMARKET_SHELVER',
      task_code: taskCode
    })

    const steps = getSteps(result.trainingSessionId)
    expect(steps).toHaveLength(4)
    const stepTypes = steps.map((s) => s.step_type)
    expect(stepTypes).toEqual(['WATCH', 'LEARN', 'PRACTICE', 'DO'])
    for (const step of steps) {
      expect(step.status).toBe('NOT_STARTED')
      expect(step.attempt_count).toBe(0)
    }
  })

  it('domain_event_projection 有 TRAINING_STARTED 记录', () => {
    const result = createTrainingSession(db, {
      callerUserId: callerId,
      callerRole: 'TEACHER',
      studentId,
      strategyId,
      strategyVersion,
      moduleType: 'COGNITION',
      taskCode
    })
    expect(result.success).toBe(true)
    if (!result.success) return

    const evt = db
      .prepare(
        `SELECT * FROM domain_event_projection
          WHERE aggregate_id = ? AND event_type = 'TRAINING_STARTED'`
      )
      .get(result.trainingSessionId) as Record<string, unknown> | undefined
    expect(evt).toBeDefined()
    expect(evt!.checksum).toBe('test-checksum')
    const payload = JSON.parse(evt!.payload_json as string) as {
      business_session_id: string
      module_type: string
    }
    expect(payload.business_session_id).toBe(result.trainingSessionId)
    expect(payload.module_type).toBe('COGNITION')
  })

  it('VALIDATION_ERROR：strategy_type 非 TRAINING_PRACTICE', () => {
    // 用 assessment 策略（BASELINE_ASSESSMENT）尝试创建训练
    const assessmentStrategyId = 'strategy_baseline_shelver_v1'
    const result = createTrainingSession(db, {
      callerUserId: callerId,
      callerRole: 'TEACHER',
      studentId,
      strategyId: assessmentStrategyId,
      strategyVersion,
      moduleType: 'FINE_MOTOR',
      taskCode
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.errorCode).toBe('VALIDATION_ERROR')
  })

  it('NOT_FOUND：strategyId 不存在', () => {
    const result = createTrainingSession(db, {
      callerUserId: callerId,
      callerRole: 'TEACHER',
      studentId,
      strategyId: 'nonexistent_strategy',
      strategyVersion,
      moduleType: 'FINE_MOTOR',
      taskCode
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.errorCode).toBe('NOT_FOUND')
  })

  it('NOT_FOUND：studentId 不存在', () => {
    const result = createTrainingSession(db, {
      callerUserId: callerId,
      callerRole: 'TEACHER',
      studentId: uuidv4(),
      strategyId,
      strategyVersion,
      moduleType: 'FINE_MOTOR',
      taskCode
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.errorCode).toBe('NOT_FOUND')
  })

  it('DUPLICATE_TRAINING_SESSION：同学生同任务已有开放 session', () => {
    // 先建一个 INIT 状态的 session
    const first = createTrainingSession(db, {
      callerUserId: callerId,
      callerRole: 'TEACHER',
      studentId,
      strategyId,
      strategyVersion,
      moduleType: 'FINE_MOTOR',
      taskCode
    })
    expect(first.success).toBe(true)

    // 再建同学生同任务
    const second = createTrainingSession(db, {
      callerUserId: callerId,
      callerRole: 'TEACHER',
      studentId,
      strategyId,
      strategyVersion,
      moduleType: 'FINE_MOTOR',
      taskCode
    })
    expect(second.success).toBe(false)
    if (second.success) return
    expect(second.errorCode).toBe('DUPLICATE_TRAINING_SESSION')
  })

  it('M4：同 student/task 的不同 job 可并存，其他 job 的安全事件不阻断当前 strategy job', () => {
    const otherStrategyId = seedTrainingStrategyForJob('WAREHOUSE_PICKER')

    expect(createTrainingSession(db, {
      callerUserId: callerId,
      callerRole: 'TEACHER',
      studentId,
      strategyId,
      strategyVersion,
      moduleType: 'FINE_MOTOR',
      taskCode
    }).success).toBe(true)

    const triggerEventId = uuidv4()
    db.prepare(
      `INSERT INTO domain_event_projection
         (event_id, aggregate_type, aggregate_id, event_type, event_sequence,
          payload_json, checksum, source_log_path, schema_version, created_at)
       VALUES (?, 'SAFETY_INCIDENT', ?, 'REDLINE_TRIGGERED', 1, '{}', 'x', 'test.jsonl', 1, datetime('now'))`
    ).run(triggerEventId, uuidv4())
    db.prepare(
      `INSERT INTO safety_incident
         (incident_id, student_id, job_code, task_code, trigger_event_id,
          reason_code, context_phase, triggered_by,
          status, requires_review_before_next_session)
       VALUES (?, ?, 'SUPERMARKET_SHELVER', ?, ?,
          'OTHER_SAFETY_RISK', 'OTHER', ?, 'PENDING_DETAIL', 1)`
    ).run(uuidv4(), studentId, taskCode, triggerEventId, callerId)

    expect(createTrainingSession(db, {
      callerUserId: callerId,
      callerRole: 'TEACHER',
      studentId,
      strategyId: otherStrategyId,
      strategyVersion,
      moduleType: 'FINE_MOTOR',
      taskCode
    }).success).toBe(true)
  })

  it('BLOCKED_BY_SAFETY_INCIDENT：有未解决安全事件', () => {
    // 先插 domain_event_projection 占位行（trigger_event_id FK 必须存在）
    const triggerEventId = uuidv4()
    db.prepare(
      `INSERT INTO domain_event_projection
         (event_id, aggregate_type, aggregate_id, event_type, event_sequence,
          payload_json, checksum, source_log_path, schema_version, created_at)
       VALUES (?, 'SAFETY_INCIDENT', ?, 'REDLINE_TRIGGERED', 1, '{}', 'x', 'test.jsonl', 1, datetime('now'))`
    ).run(triggerEventId, uuidv4())

    db.prepare(
      `INSERT INTO safety_incident
         (incident_id, student_id, job_code, task_code, trigger_event_id,
          reason_code, context_phase, triggered_by,
          status, requires_review_before_next_session)
       VALUES (?, ?, 'SUPERMARKET_SHELVER', ?, ?,
          'OTHER_SAFETY_RISK', 'OTHER', ?,
          'PENDING_DETAIL', 1)`
    ).run(uuidv4(), studentId, taskCode, triggerEventId, callerId)

    const result = createTrainingSession(db, {
      callerUserId: callerId,
      callerRole: 'TEACHER',
      studentId,
      strategyId,
      strategyVersion,
      moduleType: 'FINE_MOTOR',
      taskCode
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.errorCode).toBe('BLOCKED_BY_SAFETY_INCIDENT')
  })

  it('FORBIDDEN：STUDENT 角色无法创建', () => {
    const result = createTrainingSession(db, {
      callerUserId: studentId,
      callerRole: 'STUDENT',
      studentId,
      strategyId,
      strategyVersion,
      moduleType: 'FINE_MOTOR',
      taskCode
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.errorCode).toBe('FORBIDDEN')
  })

  it('VALIDATION_ERROR：taskCode 为空字符串', () => {
    const result = createTrainingSession(db, {
      callerUserId: callerId,
      callerRole: 'TEACHER',
      studentId,
      strategyId,
      strategyVersion,
      moduleType: 'FINE_MOTOR',
      taskCode: '   '
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.errorCode).toBe('VALIDATION_ERROR')
  })
})
