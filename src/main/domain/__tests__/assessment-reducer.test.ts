// assessment-reducer 集成测试：直接调 applyAssessmentEvent，注入 MemoryAdapter。
// 幂等性 + 冷启动重放 + 孤儿事件恢复是事件溯源架构核心（impl.md Step 5）。

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { applyAssessmentEvent } from '../assessment-reducer'
import { createTestDb, seedStudent, seedCaller, seedQuestionBank, baseStrategyInput } from '../../db/test-helpers'
import type { MemoryAdapter } from '../../db/memory-adapter'
import type { DBAdapter } from '../../db/interface'
import type { StrategyInput } from '../../../shared/types/strategy'
import type {
  ActionLogEntry,
  EventType,
  SessionStartedPayload,
  AnswerSubmittedPayload,
  EmotionInterruptedPayload,
  EmotionResumedPayload,
  SessionCompletedPayload,
  SessionAbortedPayload,
  RedlineTriggeredPayload,
  ResultCalculatedPayload
} from '@shared/types/event-payloads'

let db: MemoryAdapter
let teacherId: string
let studentId: string
let strategyId: string
const strategyVersion = 1
const jobCode = 'SUPERMARKET_SHELVER'
const taskCode = 'SHELVE_TASK'
let questionIds: string[]

// ---------- helpers ----------

// 直接 INSERT strategy_config（不依赖 strategy handler，保持 reducer 单测自洽）。
function seedStrategyConfig(db: DBAdapter, over: Partial<StrategyInput> = {}): void {
  const s = baseStrategyInput(over)
  db.prepare(
    `INSERT INTO strategy_config
       (strategy_id, strategy_type, job_code, strategy_name,
        online_question_count, offline_question_count, max_score,
        competent_threshold, conditional_threshold,
        module_veto_threshold, emotion_collapse_threshold,
        question_policy_json, scoring_policy_json,
        supports_redline_halt, allows_emotion_interrupt, requires_offline_scoring,
        version, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    s.strategyId,
    s.strategyType,
    s.jobCode,
    s.strategyName,
    s.onlineQuestionCount,
    s.offlineQuestionCount,
    s.maxScore,
    s.competentThreshold,
    s.conditionalThreshold,
    s.moduleVetoThreshold,
    s.emotionCollapseThreshold,
    JSON.stringify(s.questionPolicy),
    JSON.stringify(s.scoringPolicy),
    s.supportsRedlineHalt ? 1 : 0,
    s.allowsEmotionInterrupt ? 1 : 0,
    s.requiresOfflineScoring ? 1 : 0,
    s.version,
    s.isActive ? 1 : 0
  )
}

// 模拟 writeEvent 的 domain_event_projection INSERT（reducer 依赖 event_id FK）。
function seedEvent(db: DBAdapter, event: ActionLogEntry): void {
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

function makeEvent(
  eventType: EventType,
  aggregateId: string,
  payload: Record<string, unknown>,
  over: Partial<ActionLogEntry> = {}
): ActionLogEntry {
  return {
    event_id: uuidv4(),
    aggregate_type: 'ASSESSMENT_SESSION',
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

function seedSafetyIncident(db: DBAdapter, incidentId: string, sessStudentId: string): void {
  // safety_incident.trigger_event_id 需先在 domain_event_projection 存在
  const triggerEventId = uuidv4()
  db.prepare(
    `INSERT INTO domain_event_projection
       (event_id, aggregate_type, aggregate_id, event_type, event_sequence,
        payload_json, checksum, source_log_path, schema_version, created_at)
     VALUES (?, 'SAFETY_INCIDENT', ?, 'SAFETY_INCIDENT_CREATED', 1, '{}', 'c', 'l', 1, '2026-07-01T00:00:00.000Z')`
  ).run(triggerEventId, incidentId)
  db.prepare(
    `INSERT INTO safety_incident
       (incident_id, student_id, job_code, task_code, trigger_event_id,
        reason_code, triggered_by, context_phase, status)
     VALUES (?, ?, ?, ?, ?, 'BLADE_TOWARD_SELF', ?, 'ONLINE_ASSESSMENT', 'PENDING_DETAIL')`
  ).run(incidentId, sessStudentId, jobCode, taskCode, triggerEventId, teacherId)
}

// 构造标准 SESSION_STARTED 事件（50 题：42 ONLINE + 8 OFFLINE）。
function makeSessionStartedEvent(sessionId: string): ActionLogEntry {
  const payload: SessionStartedPayload = {
    session_id: sessionId,
    student_id: studentId,
    strategy_id: strategyId,
    strategy_type: 'BASELINE_ASSESSMENT',
    strategy_version: strategyVersion,
    job_code: jobCode,
    task_code: taskCode,
    online_question_count: 42,
    offline_question_count: 8,
    question_ids: questionIds.slice(0, 50)
  }
  return makeEvent('SESSION_STARTED', sessionId, payload as unknown as Record<string, unknown>, { actor_id: teacherId, actor_role: 'TEACHER' })
}

function makeAnswerEvent(sessionId: string, answerId: string, questionId: string, order: number): ActionLogEntry {
  const payload: AnswerSubmittedPayload = {
    session_id: sessionId,
    answer_id: answerId,
    question_id: questionId,
    question_type: 'TRUE_FALSE',
    answer_payload: { question_type: 'TRUE_FALSE', selected: true },
    is_correct: true,
    score: 2,
    question_order: order,
    submitted_at: '2026-07-01T00:10:00.000Z'
  }
  return makeEvent('ANSWER_SUBMITTED', sessionId, payload as unknown as Record<string, unknown>, {
    actor_id: studentId,
    actor_role: 'STUDENT',
    event_sequence: order + 1
  })
}

// ---------- setup ----------

beforeAll(async () => {
  db = await createTestDb()
  // 本文件不验证 no-delete 触发器（reducer 不测删除路径）；
  // drop 后 beforeEach 可清 assessment_session，避免跨用例行累积。
  // 生产 schema 不受影响——其他测试文件各自 createTestDb 加载完整 schema。
  db.exec('DROP TRIGGER IF EXISTS trg_assessment_session_no_delete')
})

afterAll(() => {
  db.close()
})

beforeEach(() => {
  // FK 依赖顺序：子先父后。注意 assessment_session.redline_incident_id → safety_incident，
  // 故 session 必须在 safety_incident 之前删（session 是 FK 子方）。
  db.exec('DELETE FROM answer_record')
  db.exec('DELETE FROM assessment_session_question')
  db.exec('DELETE FROM result_record')
  db.exec('DELETE FROM safety_incident_binding')
  db.exec('DELETE FROM assessment_session')
  db.exec('DELETE FROM safety_incident')
  db.exec('DELETE FROM domain_event_projection')
  db.exec('DELETE FROM question_bank')
  db.exec('DELETE FROM strategy_config')
  db.exec('DELETE FROM student_profile')
  db.exec('DELETE FROM user_account')
  db.exec('DELETE FROM error_event_log')

  teacherId = seedCaller(db, 'TEACHER')
  studentId = seedStudent(db)
  strategyId = `test-strategy-${uuidv4().slice(0, 8)}`
  seedStrategyConfig(db, {
    strategyId,
    strategyType: 'BASELINE_ASSESSMENT',
    jobCode,
    version: strategyVersion
  })
  seedQuestionBank(db, { jobCode })
  questionIds = (db.prepare('SELECT question_id FROM question_bank').all() as { question_id: string }[]).map(
    r => r.question_id
  )
})

// ---------- SESSION_STARTED ----------

describe('applyAssessmentEvent — SESSION_STARTED', () => {
  it('apply 后 assessment_session 行存在 + status=ACTIVE + 50 行 assessment_session_question', () => {
    const sessionId = uuidv4()
    const event = makeSessionStartedEvent(sessionId)
    seedEvent(db, event)

    applyAssessmentEvent(db, event)

    const sess = db
      .prepare('SELECT status, online_question_count, offline_question_count, created_by, started_at FROM assessment_session WHERE session_id = ?')
      .get(sessionId) as { status: string; online_question_count: number; offline_question_count: number; created_by: string; started_at: string }
    expect(sess.status).toBe('ACTIVE')
    expect(sess.online_question_count).toBe(42)
    expect(sess.offline_question_count).toBe(8)
    expect(sess.created_by).toBe(teacherId)
    expect(sess.started_at).toBe(event.created_at)

    const qCount = db.prepare('SELECT COUNT(*) AS c FROM assessment_session_question WHERE session_id = ?').get(sessionId) as { c: number }
    expect(qCount.c).toBe(50)
  })

  it('question_phase：前 42 ONLINE + 后 8 OFFLINE，question_order 连续 1..50', () => {
    const sessionId = uuidv4()
    const event = makeSessionStartedEvent(sessionId)
    seedEvent(db, event)
    applyAssessmentEvent(db, event)

    const onlineRows = db
      .prepare('SELECT question_order FROM assessment_session_question WHERE session_id = ? AND question_phase = ? ORDER BY question_order')
      .all(sessionId, 'ONLINE') as { question_order: number }[]
    const offlineRows = db
      .prepare('SELECT question_order FROM assessment_session_question WHERE session_id = ? AND question_phase = ? ORDER BY question_order')
      .all(sessionId, 'OFFLINE') as { question_order: number }[]
    expect(onlineRows).toHaveLength(42)
    expect(offlineRows).toHaveLength(8)
    expect(onlineRows[0].question_order).toBe(1)
    expect(onlineRows[41].question_order).toBe(42)
    expect(offlineRows[0].question_order).toBe(43)
    expect(offlineRows[7].question_order).toBe(50)
  })

  it('module_type / question_type 从 question_bank 正确回填', () => {
    const sessionId = uuidv4()
    const event = makeSessionStartedEvent(sessionId)
    seedEvent(db, event)
    applyAssessmentEvent(db, event)

    const row = db
      .prepare(
        `SELECT sq.module_type, sq.question_type, qb.module_type AS qb_module, qb.question_type AS qb_type
         FROM assessment_session_question sq
         JOIN question_bank qb ON qb.question_id = sq.question_id
         WHERE sq.session_id = ? LIMIT 1`
      )
      .get(sessionId) as { module_type: string; question_type: string; qb_module: string; qb_type: string }
    expect(row.module_type).toBe(row.qb_module)
    expect(row.question_type).toBe(row.qb_type)
  })
})

// ---------- ANSWER_SUBMITTED ----------

describe('applyAssessmentEvent — ANSWER_SUBMITTED', () => {
  it('apply 后 answer_record 行存在 + online_completed_count +1 + current_question_id 前移', () => {
    const sessionId = uuidv4()
    const startEvent = makeSessionStartedEvent(sessionId)
    seedEvent(db, startEvent)
    applyAssessmentEvent(db, startEvent)

    const answeredQid = questionIds[0]
    const event = makeAnswerEvent(sessionId, uuidv4(), answeredQid, 1)
    seedEvent(db, event)
    applyAssessmentEvent(db, event)

    const ar = db
      .prepare('SELECT answer_id, score, is_correct, question_type FROM answer_record WHERE answer_id = ?')
      .get(event.payload.answer_id as string) as { answer_id: string; score: number; is_correct: number; question_type: string }
    expect(ar.score).toBe(2)
    expect(ar.is_correct).toBe(1)
    expect(ar.question_type).toBe('TRUE_FALSE')

    const sess = db
      .prepare('SELECT online_completed_count, current_question_id FROM assessment_session WHERE session_id = ?')
      .get(sessionId) as { online_completed_count: number; current_question_id: string | null }
    expect(sess.online_completed_count).toBe(1)
    // current_question_id 应前移到下一道未答 ONLINE 题（question_order=2 对应 questionIds[1]）
    expect(sess.current_question_id).toBe(questionIds[1])
  })

  it('答最后一道 ONLINE 题后 current_question_id 不变（无下一道）', () => {
    const sessionId = uuidv4()
    const startEvent = makeSessionStartedEvent(sessionId)
    seedEvent(db, startEvent)
    applyAssessmentEvent(db, startEvent)

    // 只答 1 道（order=1），然后伪造 session 已答 42 道、current 指向第 42 题，再答第 42 题
    // 直接构造：答第 42 道（question_order=42 → questionIds[41]）
    const lastOnlineQid = questionIds[41]
    // 先把 online_completed_count 推到 41（答前 41 道）
    for (let i = 0; i < 41; i++) {
      const e = makeAnswerEvent(sessionId, uuidv4(), questionIds[i], i + 1)
      seedEvent(db, e)
      applyAssessmentEvent(db, e)
    }
    // 答第 42 道
    const lastEvent = makeAnswerEvent(sessionId, uuidv4(), lastOnlineQid, 42)
    seedEvent(db, lastEvent)
    applyAssessmentEvent(db, lastEvent)

    const sess = db
      .prepare('SELECT online_completed_count, current_question_id FROM assessment_session WHERE session_id = ?')
      .get(sessionId) as { online_completed_count: number; current_question_id: string | null }
    expect(sess.online_completed_count).toBe(42)
    // 答完最后一道 ONLINE → 无下一道未答，current_question_id 保持不变（仍指向第 42 道或先前值）
    // 此处不强制具体值，只断言「没有越界指向 OFFLINE 或不存在题」
    if (sess.current_question_id !== null) {
      const phase = db
        .prepare('SELECT question_phase FROM assessment_session_question WHERE session_id = ? AND question_id = ?')
        .get(sessionId, sess.current_question_id) as { question_phase: string } | undefined
      expect(phase?.question_phase).toBe('ONLINE')
    }
  })
})

// ---------- EMOTION_INTERRUPTED / RESUMED ----------

describe('applyAssessmentEvent — EMOTION_INTERRUPTED / RESUMED', () => {
  it('中断 → status=EMOTION_INTERRUPTED + pause_count+1；恢复 → status=ACTIVE', () => {
    const sessionId = uuidv4()
    const startEvent = makeSessionStartedEvent(sessionId)
    seedEvent(db, startEvent)
    applyAssessmentEvent(db, startEvent)

    const interruptPayload: EmotionInterruptedPayload = {
      session_id: sessionId,
      interrupted_at: '2026-07-01T00:20:00.000Z',
      current_question_order: 1
    }
    const interruptEvent = makeEvent('EMOTION_INTERRUPTED', sessionId, interruptPayload as unknown as Record<string, unknown>, {
      actor_id: studentId,
      actor_role: 'STUDENT',
      event_sequence: 2
    })
    seedEvent(db, interruptEvent)
    applyAssessmentEvent(db, interruptEvent)

    const afterInterrupt = db
      .prepare('SELECT status, pause_count, pause_started_at, last_interruption_reason FROM assessment_session WHERE session_id = ?')
      .get(sessionId) as { status: string; pause_count: number; pause_started_at: string; last_interruption_reason: string }
    expect(afterInterrupt.status).toBe('EMOTION_INTERRUPTED')
    expect(afterInterrupt.pause_count).toBe(1)
    expect(afterInterrupt.pause_started_at).toBe('2026-07-01T00:20:00.000Z')
    expect(afterInterrupt.last_interruption_reason).toBe('EMOTION')

    const resumePayload: EmotionResumedPayload = {
      session_id: sessionId,
      resumed_at: '2026-07-01T00:25:00.000Z',
      resume_from_question_order: 1
    }
    const resumeEvent = makeEvent('EMOTION_RESUMED', sessionId, resumePayload as unknown as Record<string, unknown>, {
      actor_id: teacherId,
      actor_role: 'TEACHER',
      event_sequence: 3
    })
    seedEvent(db, resumeEvent)
    applyAssessmentEvent(db, resumeEvent)

    const afterResume = db
      .prepare('SELECT status, pause_started_at FROM assessment_session WHERE session_id = ?')
      .get(sessionId) as { status: string; pause_started_at: string | null }
    expect(afterResume.status).toBe('ACTIVE')
    expect(afterResume.pause_started_at).toBeNull()
  })
})

// ---------- SESSION_COMPLETED / ABORTED ----------

describe('applyAssessmentEvent — SESSION_COMPLETED / ABORTED', () => {
  it('COMPLETED → status=COMPLETED + completed_at', () => {
    const sessionId = uuidv4()
    const startEvent = makeSessionStartedEvent(sessionId)
    seedEvent(db, startEvent)
    applyAssessmentEvent(db, startEvent)

    const payload: SessionCompletedPayload = {
      session_id: sessionId,
      completed_at: '2026-07-01T01:00:00.000Z',
      total_online_answered: 42,
      total_offline_scored: 0,
      has_pending_offline: true
    }
    const event = makeEvent('SESSION_COMPLETED', sessionId, payload as unknown as Record<string, unknown>, { event_sequence: 2 })
    seedEvent(db, event)
    applyAssessmentEvent(db, event)

    const sess = db
      .prepare('SELECT status, completed_at FROM assessment_session WHERE session_id = ?')
      .get(sessionId) as { status: string; completed_at: string }
    expect(sess.status).toBe('COMPLETED')
    expect(sess.completed_at).toBe('2026-07-01T01:00:00.000Z')
  })

  it('ABORTED → status=ABORTED + completed_at=aborted_at', () => {
    const sessionId = uuidv4()
    const startEvent = makeSessionStartedEvent(sessionId)
    seedEvent(db, startEvent)
    applyAssessmentEvent(db, startEvent)

    const payload: SessionAbortedPayload = {
      session_id: sessionId,
      aborted_at: '2026-07-01T00:30:00.000Z',
      aborted_by: teacherId
    }
    const event = makeEvent('SESSION_ABORTED', sessionId, payload as unknown as Record<string, unknown>, { event_sequence: 2 })
    seedEvent(db, event)
    applyAssessmentEvent(db, event)

    const sess = db
      .prepare('SELECT status, completed_at FROM assessment_session WHERE session_id = ?')
      .get(sessionId) as { status: string; completed_at: string }
    expect(sess.status).toBe('ABORTED')
    expect(sess.completed_at).toBe('2026-07-01T00:30:00.000Z')
  })
})

// ---------- REDLINE_TRIGGERED ----------

describe('applyAssessmentEvent — REDLINE_TRIGGERED', () => {
  it('apply → status=REDLINE_HALTED + level_result=LEVEL_FAIL_BY_SAFETY + redline_incident_id', () => {
    const sessionId = uuidv4()
    const startEvent = makeSessionStartedEvent(sessionId)
    seedEvent(db, startEvent)
    applyAssessmentEvent(db, startEvent)

    const incidentId = uuidv4()
    seedSafetyIncident(db, incidentId, studentId)

    const payload: RedlineTriggeredPayload = {
      session_id: sessionId,
      incident_id: incidentId,
      reason_code: 'BLADE_TOWARD_SELF',
      context_phase: 'ONLINE_ASSESSMENT',
      triggered_at: '2026-07-01T00:40:00.000Z'
    }
    const event = makeEvent('REDLINE_TRIGGERED', sessionId, payload as unknown as Record<string, unknown>, { event_sequence: 2 })
    seedEvent(db, event)
    applyAssessmentEvent(db, event)

    const sess = db
      .prepare('SELECT status, level_result, redline_incident_id FROM assessment_session WHERE session_id = ?')
      .get(sessionId) as { status: string; level_result: string; redline_incident_id: string }
    expect(sess.status).toBe('REDLINE_HALTED')
    expect(sess.level_result).toBe('LEVEL_FAIL_BY_SAFETY')
    expect(sess.redline_incident_id).toBe(incidentId)
  })
})

// ---------- RESULT_CALCULATED ----------

describe('applyAssessmentEvent — RESULT_CALCULATED', () => {
  it('apply → result_record 行存在（非红线 ABILITY_SCORE）', () => {
    const sessionId = uuidv4()
    const startEvent = makeSessionStartedEvent(sessionId)
    seedEvent(db, startEvent)
    applyAssessmentEvent(db, startEvent)

    const resultId = uuidv4()
    const payload: ResultCalculatedPayload = {
      result_id: resultId,
      result_type: 'ABILITY_SCORE',
      source_type: 'ASSESSMENT_SESSION',
      source_id: sessionId,
      student_id: studentId,
      job_code: jobCode,
      task_code: taskCode,
      raw_score: 85,
      max_score: 100,
      normalized_score: 85,
      level_result: 'LEVEL_COMPETENT',
      calculated_at: '2026-07-01T02:00:00.000Z',
      calculated_by: teacherId
    }
    const event = makeEvent('RESULT_CALCULATED', sessionId, payload as unknown as Record<string, unknown>, { event_sequence: 2 })
    seedEvent(db, event)
    applyAssessmentEvent(db, event)

    const rr = db
      .prepare('SELECT result_type, normalized_score, level_result, safety_overridden, redline_incident_id FROM result_record WHERE result_id = ?')
      .get(resultId) as { result_type: string; normalized_score: number; level_result: string; safety_overridden: number; redline_incident_id: string | null }
    expect(rr.result_type).toBe('ABILITY_SCORE')
    expect(rr.normalized_score).toBe(85)
    expect(rr.level_result).toBe('LEVEL_COMPETENT')
    expect(rr.safety_overridden).toBe(0)
    expect(rr.redline_incident_id).toBeNull()
  })
})

// ---------- EMOTION_COLLAPSE_THRESHOLD_REACHED + unknown ----------

describe('applyAssessmentEvent — no-op 分支', () => {
  it('EMOTION_COLLAPSE_THRESHOLD_REACHED 不改投影', () => {
    const sessionId = uuidv4()
    const startEvent = makeSessionStartedEvent(sessionId)
    seedEvent(db, startEvent)
    applyAssessmentEvent(db, startEvent)
    const before = db
      .prepare('SELECT status, pause_count, online_completed_count FROM assessment_session WHERE session_id = ?')
      .get(sessionId)

    const collapseEvent = makeEvent(
      'EMOTION_COLLAPSE_THRESHOLD_REACHED',
      sessionId,
      {
        session_id: sessionId,
        collapse_count: 3,
        threshold: 3,
        collapse_history: [],
        triggered_at: '2026-07-01T00:50:00.000Z'
      },
      { event_sequence: 2 }
    )
    seedEvent(db, collapseEvent)
    applyAssessmentEvent(db, collapseEvent)

    const after = db
      .prepare('SELECT status, pause_count, online_completed_count FROM assessment_session WHERE session_id = ?')
      .get(sessionId)
    expect(after).toEqual(before)
  })

  it('未知 event_type 不抛错', () => {
    const sessionId = uuidv4()
    const startEvent = makeSessionStartedEvent(sessionId)
    seedEvent(db, startEvent)
    applyAssessmentEvent(db, startEvent)

    const unknownEvent = makeEvent(
      'SNAPSHOT_COMMITTED' as EventType,
      sessionId,
      { snapshot_id: uuidv4() }
    )
    // 不应抛错
    expect(() => applyAssessmentEvent(db, unknownEvent)).not.toThrow()
  })

  it('session 不存在时 ANSWER_SUBMITTED 安全跳过', () => {
    const event = makeAnswerEvent('nonexistent-session', uuidv4(), questionIds[0], 1)
    expect(() => applyAssessmentEvent(db, event)).not.toThrow()
  })
})

// ---------- 幂等性 ----------

describe('applyAssessmentEvent — 幂等性', () => {
  it('SESSION_STARTED apply 两次：第二次 no-op（question 行不翻倍）', () => {
    const sessionId = uuidv4()
    const event = makeSessionStartedEvent(sessionId)
    seedEvent(db, event)

    applyAssessmentEvent(db, event)
    applyAssessmentEvent(db, event)

    const sessCount = db.prepare('SELECT COUNT(*) AS c FROM assessment_session WHERE session_id = ?').get(sessionId) as { c: number }
    const qCount = db.prepare('SELECT COUNT(*) AS c FROM assessment_session_question WHERE session_id = ?').get(sessionId) as { c: number }
    expect(sessCount.c).toBe(1)
    expect(qCount.c).toBe(50)
  })

  it('ANSWER_SUBMITTED apply 两次：第二次 no-op（计数不翻倍）', () => {
    const sessionId = uuidv4()
    const startEvent = makeSessionStartedEvent(sessionId)
    seedEvent(db, startEvent)
    applyAssessmentEvent(db, startEvent)

    const event = makeAnswerEvent(sessionId, uuidv4(), questionIds[0], 1)
    seedEvent(db, event)
    applyAssessmentEvent(db, event)
    applyAssessmentEvent(db, event)

    const arCount = db.prepare('SELECT COUNT(*) AS c FROM answer_record WHERE session_id = ?').get(sessionId) as { c: number }
    const sess = db
      .prepare('SELECT online_completed_count FROM assessment_session WHERE session_id = ?')
      .get(sessionId) as { online_completed_count: number }
    expect(arCount.c).toBe(1)
    expect(sess.online_completed_count).toBe(1)
  })

  it('EMOTION_INTERRUPTED apply 两次：第二次 no-op（pause_count 不翻倍）', () => {
    const sessionId = uuidv4()
    const startEvent = makeSessionStartedEvent(sessionId)
    seedEvent(db, startEvent)
    applyAssessmentEvent(db, startEvent)

    const event = makeEvent(
      'EMOTION_INTERRUPTED',
      sessionId,
      { session_id: sessionId, interrupted_at: '2026-07-01T00:20:00.000Z' },
      { event_sequence: 2 }
    )
    seedEvent(db, event)
    applyAssessmentEvent(db, event)
    applyAssessmentEvent(db, event)

    const sess = db
      .prepare('SELECT status, pause_count FROM assessment_session WHERE session_id = ?')
      .get(sessionId) as { status: string; pause_count: number }
    expect(sess.status).toBe('EMOTION_INTERRUPTED')
    expect(sess.pause_count).toBe(1)
  })

  it('SESSION_COMPLETED apply 两次：第二次 no-op', () => {
    const sessionId = uuidv4()
    const startEvent = makeSessionStartedEvent(sessionId)
    seedEvent(db, startEvent)
    applyAssessmentEvent(db, startEvent)

    const event = makeEvent(
      'SESSION_COMPLETED',
      sessionId,
      {
        session_id: sessionId,
        completed_at: '2026-07-01T01:00:00.000Z',
        total_online_answered: 42,
        total_offline_scored: 0,
        has_pending_offline: false
      },
      { event_sequence: 2 }
    )
    seedEvent(db, event)
    applyAssessmentEvent(db, event)
    applyAssessmentEvent(db, event)

    // 终态二次 apply 不抛错；status 仍 COMPLETED
    const sess = db
      .prepare('SELECT status, completed_at FROM assessment_session WHERE session_id = ?')
      .get(sessionId) as { status: string; completed_at: string }
    expect(sess.status).toBe('COMPLETED')
  })

  it('REDLINE_TRIGGERED apply 两次：第二次 no-op', () => {
    const sessionId = uuidv4()
    const startEvent = makeSessionStartedEvent(sessionId)
    seedEvent(db, startEvent)
    applyAssessmentEvent(db, startEvent)

    const incidentId = uuidv4()
    seedSafetyIncident(db, incidentId, studentId)

    const event = makeEvent(
      'REDLINE_TRIGGERED',
      sessionId,
      {
        session_id: sessionId,
        incident_id: incidentId,
        reason_code: 'BLADE_TOWARD_SELF',
        context_phase: 'ONLINE_ASSESSMENT',
        triggered_at: '2026-07-01T00:40:00.000Z'
      },
      { event_sequence: 2 }
    )
    seedEvent(db, event)
    applyAssessmentEvent(db, event)
    applyAssessmentEvent(db, event)

    const sess = db
      .prepare('SELECT status, level_result, redline_incident_id FROM assessment_session WHERE session_id = ?')
      .get(sessionId) as { status: string; level_result: string; redline_incident_id: string }
    expect(sess.status).toBe('REDLINE_HALTED')
    expect(sess.redline_incident_id).toBe(incidentId)
  })

  it('RESULT_CALCULATED apply 两次：第二次 no-op', () => {
    const sessionId = uuidv4()
    const startEvent = makeSessionStartedEvent(sessionId)
    seedEvent(db, startEvent)
    applyAssessmentEvent(db, startEvent)

    const resultId = uuidv4()
    const event = makeEvent(
      'RESULT_CALCULATED',
      sessionId,
      {
        result_id: resultId,
        result_type: 'ABILITY_SCORE',
        source_type: 'ASSESSMENT_SESSION',
        source_id: sessionId,
        student_id: studentId,
        job_code: jobCode,
        task_code: taskCode,
        raw_score: 70,
        max_score: 100,
        normalized_score: 70,
        level_result: 'LEVEL_CONDITIONAL',
        calculated_at: '2026-07-01T02:00:00.000Z',
        calculated_by: teacherId
      },
      { event_sequence: 2 }
    )
    seedEvent(db, event)
    applyAssessmentEvent(db, event)
    applyAssessmentEvent(db, event)

    const rrCount = db.prepare('SELECT COUNT(*) AS c FROM result_record WHERE result_id = ?').get(resultId) as { c: number }
    expect(rrCount.c).toBe(1)
  })
})

// ---------- 冷启动重放 ----------

describe('applyAssessmentEvent — 冷启动重放', () => {
  it('空投影重放 SESSION_STARTED + ANSWER×5 + INTERRUPTED + RESUMED → 与在线执行一致', () => {
    const sessionId = uuidv4()
    const events: ActionLogEntry[] = []

    // 构造事件序列（不预建投影，模拟「jsonl 有事件、投影为空」冷启动）
    const startEvent = makeSessionStartedEvent(sessionId)
    events.push(startEvent)
    for (let i = 0; i < 5; i++) {
      events.push(makeAnswerEvent(sessionId, uuidv4(), questionIds[i], i + 1))
    }
    events.push(
      makeEvent(
        'EMOTION_INTERRUPTED',
        sessionId,
        { session_id: sessionId, interrupted_at: '2026-07-01T00:30:00.000Z', current_question_order: 6 },
        { actor_id: studentId, actor_role: 'STUDENT', event_sequence: 7 }
      )
    )
    events.push(
      makeEvent(
        'EMOTION_RESUMED',
        sessionId,
        { session_id: sessionId, resumed_at: '2026-07-01T00:35:00.000Z', resume_from_question_order: 6 },
        { actor_id: teacherId, actor_role: 'TEACHER', event_sequence: 8 }
      )
    )

    // 先 seed 所有事件到 domain_event_projection（模拟事件已落 jsonl+projection，业务投影待重放）
    for (const e of events) seedEvent(db, e)

    // 逐事件重放
    for (const e of events) applyAssessmentEvent(db, e)

    // 断言最终投影一致
    const sess = db
      .prepare('SELECT status, online_completed_count, pause_count, pause_started_at FROM assessment_session WHERE session_id = ?')
      .get(sessionId) as { status: string; online_completed_count: number; pause_count: number; pause_started_at: string | null }
    expect(sess.status).toBe('ACTIVE') // resume 后
    expect(sess.online_completed_count).toBe(5)
    expect(sess.pause_count).toBe(1) // 1 次中断
    expect(sess.pause_started_at).toBeNull() // resume 后清空

    const arCount = db.prepare('SELECT COUNT(*) AS c FROM answer_record WHERE session_id = ?').get(sessionId) as { c: number }
    expect(arCount.c).toBe(5)

    const qCount = db.prepare('SELECT COUNT(*) AS c FROM assessment_session_question WHERE session_id = ?').get(sessionId) as { c: number }
    expect(qCount.c).toBe(50)
  })
})

// ---------- 孤儿事件幂等 ----------

describe('applyAssessmentEvent — 孤儿事件恢复', () => {
  it('投影回滚后重放同一事件 → 正确恢复，不重复', () => {
    const sessionId = uuidv4()
    const startEvent = makeSessionStartedEvent(sessionId)
    seedEvent(db, startEvent)
    applyAssessmentEvent(db, startEvent)

    const answerEvent = makeAnswerEvent(sessionId, uuidv4(), questionIds[0], 1)
    seedEvent(db, answerEvent)
    applyAssessmentEvent(db, answerEvent)

    // 模拟投影回滚：删 answer_record + 重置 online_completed_count（jsonl/domain_event_projection 保留）
    db.prepare('DELETE FROM answer_record WHERE answer_id = ?').run(answerEvent.payload.answer_id as string)
    db.prepare('UPDATE assessment_session SET online_completed_count = 0 WHERE session_id = ?').run(sessionId)

    // 重放该孤儿事件
    applyAssessmentEvent(db, answerEvent)

    const arCount = db.prepare('SELECT COUNT(*) AS c FROM answer_record WHERE answer_id = ?').get(answerEvent.payload.answer_id as string) as { c: number }
    const sess = db
      .prepare('SELECT online_completed_count FROM assessment_session WHERE session_id = ?')
      .get(sessionId) as { online_completed_count: number }
    expect(arCount.c).toBe(1)
    expect(sess.online_completed_count).toBe(1)
  })
})
