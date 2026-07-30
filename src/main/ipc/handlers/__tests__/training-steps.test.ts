// training 步骤生命周期测试：start/complete/skip/fail/retry
// 覆盖 impl.md Step 5 测试用例。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { v4 as uuidv4 } from 'uuid'

const { mockState } = vi.hoisted(() => ({
  mockState: {
    db: null as unknown as import('../../../db/interface').DBAdapter,
    seqMap: new Map<string, number>()  // aggregateId → next event_sequence
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
import { createTrainingTestCommands } from '../../../application/services/__tests__/training-test-support'
import { createTestDb, seedCaller, seedStudent } from '../../../db/test-helpers'
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

function getStep(stepOrder: number) {
  return db
    .prepare(
      `SELECT * FROM training_step_record
        WHERE training_session_id = ? AND step_order = ?`
    )
    .get(trainingSessionId, stepOrder) as Record<string, unknown>
}

function getSession() {
  return db
    .prepare('SELECT * FROM training_session WHERE training_session_id = ?')
    .get(trainingSessionId) as Record<string, unknown>
}

function getStepId(stepOrder: number): string {
  return (getStep(stepOrder).training_step_record_id as string)
}

beforeEach(async () => {
  db = await createTestDb()
  callerId = seedCaller(db, 'TEACHER')
  studentId = seedStudent(db)
  mockState.db = db
  mockState.seqMap = new Map()

  // 教师创建一个 training session
  const result = createTrainingSession(db, {
    callerUserId: callerId,
    callerRole: 'TEACHER',
    studentId,
    strategyId,
    strategyVersion,
    moduleType: 'FINE_MOTOR',
    taskCode
  })
  if (!result.success) throw new Error(`createTrainingSession failed: ${JSON.stringify(result)}`)
  trainingSessionId = result.trainingSessionId
})

afterEach(() => {
  db.close()
})

describe('startStep', () => {
  it('正常路径：NOT_STARTED → IN_PROGRESS', () => {
    const stepId = getStepId(1)
    const result = startStep(db, {
      callerUserId: studentId,
      callerRole: 'STUDENT',
      trainingSessionId,
      stepRecordId: stepId
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.newStatus).toBe('IN_PROGRESS')
    expect(getStep(1).status).toBe('IN_PROGRESS')
  })

  it('第一个步骤 startStep 触发 session INIT→ACTIVE', () => {
    expect(getSession().status).toBe('INIT')
    const stepId = getStepId(1)
    startStep(db, {
      callerUserId: studentId,
      callerRole: 'STUDENT',
      trainingSessionId,
      stepRecordId: stepId
    })
    expect(getSession().status).toBe('ACTIVE')
  })

  it('前序步骤未开始时 startStep → STEP_PREREQUISITE_NOT_MET', () => {
    // 直接跳到 step 2，step 1 还是 NOT_STARTED
    const step2Id = getStepId(2)
    const result = startStep(db, {
      callerUserId: studentId,
      callerRole: 'STUDENT',
      trainingSessionId,
      stepRecordId: step2Id
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.errorCode).toBe('STEP_PREREQUISITE_NOT_MET')
  })

  it('非 STUDENT 调用 → FORBIDDEN', () => {
    const stepId = getStepId(1)
    const result = startStep(db, {
      callerUserId: callerId,
      callerRole: 'TEACHER',
      trainingSessionId,
      stepRecordId: stepId
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.errorCode).toBe('FORBIDDEN')
  })

  it('步骤已是 IN_PROGRESS → STEP_INVALID_TRANSITION', () => {
    const stepId = getStepId(1)
    startStep(db, { callerUserId: studentId, callerRole: 'STUDENT', trainingSessionId, stepRecordId: stepId })
    const result = startStep(db, { callerUserId: studentId, callerRole: 'STUDENT', trainingSessionId, stepRecordId: stepId })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.errorCode).toBe('STEP_INVALID_TRANSITION')
  })
})

describe('completeStep', () => {
  it('正常路径：IN_PROGRESS → COMPLETED，session.completed_step_count +1', () => {
    const stepId = getStepId(1)
    startStep(db, { callerUserId: studentId, callerRole: 'STUDENT', trainingSessionId, stepRecordId: stepId })
    const result = completeStep(db, { callerUserId: studentId, callerRole: 'STUDENT', trainingSessionId, stepRecordId: stepId })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.newStatus).toBe('COMPLETED')
    expect(getStep(1).status).toBe('COMPLETED')
    expect(getSession().completed_step_count).toBe(1)
  })

  it('NOT_STARTED 直接 completeStep → STEP_INVALID_TRANSITION', () => {
    const stepId = getStepId(1)
    const result = completeStep(db, { callerUserId: studentId, callerRole: 'STUDENT', trainingSessionId, stepRecordId: stepId })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.errorCode).toBe('STEP_INVALID_TRANSITION')
  })
})

describe('skipStep', () => {
  it('NOT_STARTED → SKIPPED，不增加 completed_step_count', () => {
    const stepId = getStepId(1)
    const result = skipStep(db, { callerUserId: studentId, callerRole: 'STUDENT', trainingSessionId, stepRecordId: stepId })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.newStatus).toBe('SKIPPED')
    expect(getStep(1).status).toBe('SKIPPED')
    expect(getSession().completed_step_count).toBe(0)
  })

  it('IN_PROGRESS → SKIPPED', () => {
    const stepId = getStepId(1)
    startStep(db, { callerUserId: studentId, callerRole: 'STUDENT', trainingSessionId, stepRecordId: stepId })
    const result = skipStep(db, { callerUserId: studentId, callerRole: 'STUDENT', trainingSessionId, stepRecordId: stepId })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.newStatus).toBe('SKIPPED')
  })

  it('COMPLETED 步骤不能 skip → STEP_INVALID_TRANSITION', () => {
    const stepId = getStepId(1)
    startStep(db, { callerUserId: studentId, callerRole: 'STUDENT', trainingSessionId, stepRecordId: stepId })
    completeStep(db, { callerUserId: studentId, callerRole: 'STUDENT', trainingSessionId, stepRecordId: stepId })
    const result = skipStep(db, { callerUserId: studentId, callerRole: 'STUDENT', trainingSessionId, stepRecordId: stepId })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.errorCode).toBe('STEP_INVALID_TRANSITION')
  })
})

describe('failStep', () => {
  it('IN_PROGRESS → FAILED', () => {
    const stepId = getStepId(1)
    startStep(db, { callerUserId: studentId, callerRole: 'STUDENT', trainingSessionId, stepRecordId: stepId })
    const result = failStep(db, { callerUserId: studentId, callerRole: 'STUDENT', trainingSessionId, stepRecordId: stepId })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.newStatus).toBe('FAILED')
    expect(getStep(1).status).toBe('FAILED')
  })

  it('NOT_STARTED 直接 failStep → STEP_INVALID_TRANSITION', () => {
    const stepId = getStepId(1)
    const result = failStep(db, { callerUserId: studentId, callerRole: 'STUDENT', trainingSessionId, stepRecordId: stepId })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.errorCode).toBe('STEP_INVALID_TRANSITION')
  })
})

describe('retryStep', () => {
  it('FAILED → IN_PROGRESS，attempt_count + 1，TRAINING_STEP_RETRIED 事件存在', () => {
    const stepId = getStepId(1)
    startStep(db, { callerUserId: studentId, callerRole: 'STUDENT', trainingSessionId, stepRecordId: stepId })
    failStep(db, { callerUserId: studentId, callerRole: 'STUDENT', trainingSessionId, stepRecordId: stepId })

    const beforeAttempt = getStep(1).attempt_count as number
    const result = retryStep(db, { callerUserId: studentId, callerRole: 'STUDENT', trainingSessionId, stepRecordId: stepId })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.newStatus).toBe('IN_PROGRESS')
    expect(getStep(1).status).toBe('IN_PROGRESS')
    expect(getStep(1).attempt_count).toBe(beforeAttempt + 1)

    const evt = db
      .prepare(
        `SELECT * FROM domain_event_projection
          WHERE aggregate_id = ? AND event_type = 'TRAINING_STEP_RETRIED'`
      )
      .get(trainingSessionId) as Record<string, unknown> | undefined
    expect(evt).toBeDefined()
  })

  it('三次 retry，attempt_count 递增正确', () => {
    const stepId = getStepId(1)
    startStep(db, { callerUserId: studentId, callerRole: 'STUDENT', trainingSessionId, stepRecordId: stepId })

    for (let i = 0; i < 3; i++) {
      failStep(db, { callerUserId: studentId, callerRole: 'STUDENT', trainingSessionId, stepRecordId: stepId })
      retryStep(db, { callerUserId: studentId, callerRole: 'STUDENT', trainingSessionId, stepRecordId: stepId })
    }
    expect(getStep(1).attempt_count).toBe(4) // 1 start + 3 retry = attempt_count 4
  })

  it('非 FAILED 步骤 retryStep → STEP_INVALID_TRANSITION', () => {
    const stepId = getStepId(1)
    startStep(db, { callerUserId: studentId, callerRole: 'STUDENT', trainingSessionId, stepRecordId: stepId })
    const result = retryStep(db, { callerUserId: studentId, callerRole: 'STUDENT', trainingSessionId, stepRecordId: stepId })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.errorCode).toBe('STEP_INVALID_TRANSITION')
  })
})

describe('sessionCompleted flag', () => {
  it('最后一步 completeStep 后 sessionCompleted = true', () => {
    // 先完成 step 1-3，最后完成 step 4
    for (let order = 1; order <= 3; order++) {
      const id = getStepId(order)
      startStep(db, { callerUserId: studentId, callerRole: 'STUDENT', trainingSessionId, stepRecordId: id })
      completeStep(db, { callerUserId: studentId, callerRole: 'STUDENT', trainingSessionId, stepRecordId: id })
    }
    const step4Id = getStepId(4)
    startStep(db, { callerUserId: studentId, callerRole: 'STUDENT', trainingSessionId, stepRecordId: step4Id })
    const result = completeStep(db, { callerUserId: studentId, callerRole: 'STUDENT', trainingSessionId, stepRecordId: step4Id })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.sessionCompleted).toBe(true)
  })

  it('skip 最后一步后 sessionCompleted = true', () => {
    for (let order = 1; order <= 3; order++) {
      const id = getStepId(order)
      startStep(db, { callerUserId: studentId, callerRole: 'STUDENT', trainingSessionId, stepRecordId: id })
      completeStep(db, { callerUserId: studentId, callerRole: 'STUDENT', trainingSessionId, stepRecordId: id })
    }
    const step4Id = getStepId(4)
    const result = skipStep(db, { callerUserId: studentId, callerRole: 'STUDENT', trainingSessionId, stepRecordId: step4Id })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.sessionCompleted).toBe(true)
  })
})
