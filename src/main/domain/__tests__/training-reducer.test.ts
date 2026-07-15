// training-reducer 集成测试：直接应用训练事件，验证 M2 父会话投影与旧事件兼容。

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { applyTrainingEvent } from '../training-reducer'
import { createTestDb, seedCaller, seedStudent } from '../../db/test-helpers'
import type { MemoryAdapter } from '../../db/memory-adapter'
import type {
  ActionLogEntry,
  EventType,
  TrainingStartedPayload
} from '@shared/types/event-payloads'

let db: MemoryAdapter
let teacherId: string
let studentId: string

const strategyId = 'strategy_training_shelver_v1'
const strategyVersion = 1
const jobCode = 'SUPERMARKET_SHELVER'
const taskCode = 'SHELVE_TASK'

function makeEvent(
  eventType: EventType,
  aggregateId: string,
  payload: Record<string, unknown>,
  over: Partial<ActionLogEntry> = {}
): ActionLogEntry {
  return {
    event_id: uuidv4(),
    aggregate_type: 'TRAINING_SESSION',
    aggregate_id: aggregateId,
    event_type: eventType,
    event_sequence: over.event_sequence ?? 1,
    payload,
    checksum: 'test-checksum-' + eventType,
    schema_version: 1,
    created_at: over.created_at ?? '2026-07-01T00:00:00.000Z',
    actor_id: over.actor_id ?? teacherId,
    actor_role: over.actor_role ?? 'TEACHER',
    app_version: 'test',
    ...over
  }
}

function seedEvent(db: MemoryAdapter, event: ActionLogEntry): void {
  db.prepare(
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
    'test-action-log.jsonl',
    event.schema_version,
    event.created_at
  )
}

function makeTrainingStartedEvent(
  trainingSessionId: string,
  overrides: Partial<TrainingStartedPayload> = {}
): ActionLogEntry {
  const payload: TrainingStartedPayload = {
    training_session_id: trainingSessionId,
    business_session_id: trainingSessionId,
    student_id: studentId,
    strategy_id: strategyId,
    strategy_type: 'TRAINING_PRACTICE',
    strategy_version: strategyVersion,
    job_code: jobCode,
    task_code: taskCode,
    total_steps: 4,
    step_order: ['WATCH', 'LEARN', 'PRACTICE', 'DO'],
    module_type: 'FINE_MOTOR',
    ...overrides
  }
  return makeEvent('TRAINING_STARTED', trainingSessionId, payload as unknown as Record<string, unknown>)
}

beforeEach(async () => {
  db = await createTestDb()
  teacherId = seedCaller(db, 'TEACHER')
  studentId = seedStudent(db)
})

afterEach(() => {
  db.close()
})

describe('applyTrainingEvent — TRAINING_STARTED', () => {
  it('新事件创建 TRAINING 父会话、子会话 module_type 与四条 step', () => {
    const trainingSessionId = uuidv4()
    const businessSessionId = uuidv4()
    const event = makeTrainingStartedEvent(trainingSessionId, {
      business_session_id: businessSessionId,
      module_type: 'COGNITION'
    })
    seedEvent(db, event)

    applyTrainingEvent(db, event)

    const parent = db
      .prepare('SELECT session_type, student_id, job_code, task_code FROM business_session WHERE business_session_id = ?')
      .get(businessSessionId) as { session_type: string; student_id: string; job_code: string; task_code: string }
    expect(parent).toEqual({
      session_type: 'TRAINING',
      student_id: studentId,
      job_code: jobCode,
      task_code: taskCode
    })

    const session = db
      .prepare('SELECT business_session_id, module_type, status, total_step_count, completed_step_count FROM training_session WHERE training_session_id = ?')
      .get(trainingSessionId) as {
      business_session_id: string
      module_type: string
      status: string
      total_step_count: number
      completed_step_count: number
    }
    expect(session).toEqual({
      business_session_id: businessSessionId,
      module_type: 'COGNITION',
      status: 'INIT',
      total_step_count: 4,
      completed_step_count: 0
    })

    const steps = db
      .prepare('SELECT step_type, status, attempt_count FROM training_step_record WHERE training_session_id = ? ORDER BY step_order')
      .all(trainingSessionId) as Array<{ step_type: string; status: string; attempt_count: number }>
    expect(steps).toEqual([
      { step_type: 'WATCH', status: 'NOT_STARTED', attempt_count: 0 },
      { step_type: 'LEARN', status: 'NOT_STARTED', attempt_count: 0 },
      { step_type: 'PRACTICE', status: 'NOT_STARTED', attempt_count: 0 },
      { step_type: 'DO', status: 'NOT_STARTED', attempt_count: 0 }
    ])
  })

  it('旧事件缺少 business_session_id/module_type 时，用子 ID 派生父会话且 module_type 保持 NULL', () => {
    const trainingSessionId = uuidv4()
    const event = makeTrainingStartedEvent(trainingSessionId, {
      business_session_id: undefined,
      module_type: undefined
    })
    seedEvent(db, event)

    applyTrainingEvent(db, event)

    const session = db
      .prepare('SELECT business_session_id, module_type FROM training_session WHERE training_session_id = ?')
      .get(trainingSessionId) as { business_session_id: string; module_type: string | null }
    expect(session.business_session_id).toBe(trainingSessionId)
    expect(session.module_type).toBeNull()

    const parentCount = db
      .prepare('SELECT COUNT(*) AS c FROM business_session WHERE business_session_id = ?')
      .get(trainingSessionId) as { c: number }
    expect(parentCount.c).toBe(1)
  })

  it('重复应用同一事件不重复创建 session 或 step', () => {
    const trainingSessionId = uuidv4()
    const event = makeTrainingStartedEvent(trainingSessionId)
    seedEvent(db, event)

    applyTrainingEvent(db, event)
    applyTrainingEvent(db, event)

    const sessionCount = db
      .prepare('SELECT COUNT(*) AS c FROM training_session WHERE training_session_id = ?')
      .get(trainingSessionId) as { c: number }
    const stepCount = db
      .prepare('SELECT COUNT(*) AS c FROM training_step_record WHERE training_session_id = ?')
      .get(trainingSessionId) as { c: number }
    expect(sessionCount.c).toBe(1)
    expect(stepCount.c).toBe(4)
  })

  it('父记录四键冲突时 fail closed，不覆盖既有父记录', () => {
    const trainingSessionId = uuidv4()
    db.prepare(
      `INSERT INTO business_session
         (business_session_id, session_type, student_id, job_code, task_code, created_by)
       VALUES (?, 'ASSESSMENT', ?, ?, ?, ?)`
    ).run(trainingSessionId, studentId, jobCode, taskCode, teacherId)

    const event = makeTrainingStartedEvent(trainingSessionId)
    seedEvent(db, event)

    expect(() => applyTrainingEvent(db, event)).toThrow(/conflicts with training session facts/)

    const sessionCount = db
      .prepare('SELECT COUNT(*) AS c FROM training_session WHERE training_session_id = ?')
      .get(trainingSessionId) as { c: number }
    const stepCount = db
      .prepare('SELECT COUNT(*) AS c FROM training_step_record WHERE training_session_id = ?')
      .get(trainingSessionId) as { c: number }
    expect(sessionCount.c).toBe(0)
    expect(stepCount.c).toBe(0)
  })
})

describe('applyTrainingEvent — unknown event', () => {
  it('未知 training 事件不产生投影写入', () => {
    const trainingSessionId = uuidv4()
    const event = makeEvent('REPORT_GENERATED', trainingSessionId, { training_session_id: trainingSessionId })

    expect(() => applyTrainingEvent(db, event)).not.toThrow()

    const count = db.prepare('SELECT COUNT(*) AS c FROM training_session').get() as { c: number }
    expect(count.c).toBe(0)
  })
})
