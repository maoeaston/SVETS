// assessment:startSession + listMySessions 集成测试：直接调纯函数，注入 MemoryAdapter。
// 覆盖 impl.md Step 9b 学生入口 + 第一题指针推进测试用例。
//
// [!] startSession 是 STUDENT 写路径（写 SESSION_FIRST_QUESTION_ACTIVATED 事件），
//     但 setupSession 调 createSession（TEACHER 写路径）已 mock event-writer，故沿用同 mock。
//
// [!] reducer 幂等性是核心：startSession 二次调用不写事件（断言 domain_event_projection 行数不变）；
//     ANSWER_SUBMITTED 之后 startSession 不覆盖 current_question_id（断言指针仍指向第二题）。
//
// [!] listMySessions 与 listSessions 共用 SessionListItem 行映射，仅 WHERE 不同。
//     专测聚焦"返回自己的 OPEN session + 不返回终态/他人"。

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { v4 as uuidv4 } from 'uuid'

const { mockState } = vi.hoisted(() => ({
  mockState: { db: null as unknown as import('../../../db/interface').DBAdapter }
}))

vi.mock('../../../domain/event-writer', () => ({
  writeEvent: vi.fn(
    (params: import('../../../domain/event-writer').WriteEventParams): import('@shared/types/event-payloads').ActionLogEntry => {
      if (!mockState.db) {
        throw new Error('mock writeEvent: mockState.db not set; call in beforeEach')
      }
      const eventId = uuidv4()
      const row = mockState.db
        .prepare(
          `SELECT MAX(event_sequence) AS max_seq
             FROM domain_event_projection
            WHERE aggregate_id = ?`
        )
        .get(params.aggregateId) as { max_seq: number | null }
      const eventSequence = (row.max_seq ?? 0) + 1
      const entry: import('@shared/types/event-payloads').ActionLogEntry = {
        event_id: eventId,
        aggregate_type: params.aggregateType,
        aggregate_id: params.aggregateId,
        event_type: params.eventType,
        event_sequence: eventSequence,
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
          entry.event_id,
          entry.aggregate_type,
          entry.aggregate_id,
          entry.event_type,
          entry.event_sequence,
          JSON.stringify(entry.payload),
          entry.checksum,
          'test-action-log.jsonl',
          entry.schema_version,
          entry.created_at
        )
      return entry
    }
  )
}))

import {
  createSession,
  submitAnswer,
  startSession,
  listMySessions,
  seedAssessmentErrorCodes
} from '../assessment'
import {
  createTestDb,
  seedCaller,
  seedStudent,
  seedQuestionBankDraft,
  baseStrategyInput,
  setAssessmentSessionStateFixture
} from '../../../db/test-helpers'
import type { MemoryAdapter } from '../../../db/memory-adapter'
import type { StrategyInput } from '../../../../shared/types/strategy'
import type {
  SessionQuestionView,
  StartSessionParams,
  ListMySessionsParams,
  AnswerPayloadDetail
} from '../../../../shared/types/assessment'

let db: MemoryAdapter
let callerId: string
let studentId: string
let strategyId: string

const taskCode = 'SHELVE_TASK'
const strategyVersion = 1

function seedStrategyRow(over: Partial<StrategyInput> = {}): void {
  const s = baseStrategyInput({
    strategyId: `test-strategy-${uuidv4().slice(0, 8)}`,
    ...over
  })
  strategyId = s.strategyId
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

interface SetupResult {
  sessionId: string
  questions: SessionQuestionView[]
}

type OnlineQuestionType = 'TRUE_FALSE' | 'SINGLE_CHOICE' | 'DRAG'

function seedContentJsonByType(questionType: OnlineQuestionType, content: Record<string, unknown>): void {
  db.prepare('UPDATE question_bank SET content_json = ? WHERE question_type = ?').run(
    JSON.stringify(content),
    questionType
  )
}

/** 跑一次 createSession 拿到 INIT + PREPARED + current_question_id=NULL 的 session。 */
function setupSession(
  student: string = studentId,
  task: string = taskCode,
  contentByType: Partial<Record<OnlineQuestionType, Record<string, unknown>>> = {}
): SetupResult {
  for (const [questionType, content] of Object.entries(contentByType)) {
    seedContentJsonByType(questionType as OnlineQuestionType, content)
  }
  // v0.1.12: 激活所有 DRAFT 题
  db.prepare("UPDATE question_bank SET status = 'ACTIVE' WHERE status = 'DRAFT'").run()
  const result = createSession(db, {
    callerUserId: callerId,
    callerRole: 'TEACHER',
    studentId: student,
    strategyId,
    strategyVersion,
    taskCode: task
  })
  if (!result.success) {
    throw new Error(`setupSession createSession failed: ${JSON.stringify(result)}`)
  }
  return { sessionId: result.sessionId, questions: result.questions }
}

function baseStartParams(sessionId: string, over: Partial<StartSessionParams> = {}): StartSessionParams {
  return {
    callerUserId: studentId,
    callerRole: 'STUDENT',
    sessionId,
    ...over
  }
}

function baseListMyParams(over: Partial<ListMySessionsParams> = {}): ListMySessionsParams {
  return {
    callerUserId: studentId,
    callerRole: 'STUDENT',
    ...over
  }
}

/** 直接 UPDATE assessment_session.status，用于测 startSession 的 status 映射。 */
function forceSessionStatus(sessionId: string, status: string): void {
  if (status === 'COMPLETED') {
    setAssessmentSessionStateFixture(db, sessionId, 'COMPLETED', 'FINALIZED')
    return
  }
  db.prepare('UPDATE assessment_session SET status = ? WHERE session_id = ?').run(status, sessionId)
}

function forceLegacyOnlineInProgress(sessionId: string, questionId?: string): string {
  const firstQuestionId = questionId ?? (db
    .prepare(
      `SELECT question_id FROM assessment_session_question
        WHERE session_id = ? AND question_phase = 'ONLINE'
        ORDER BY question_order LIMIT 1`
    )
    .get(sessionId) as { question_id: string }).question_id
  setAssessmentSessionStateFixture(db, sessionId, 'ACTIVE', 'ONLINE_IN_PROGRESS')
  db.prepare(
    `UPDATE assessment_session
       SET current_question_id = ?,
           started_at = COALESCE(started_at, '2026-07-01T00:00:00.000Z')
     WHERE session_id = ?`
  ).run(firstQuestionId, sessionId)
  return firstQuestionId
}

/** INSERT safety_incident(PENDING_DETAIL) 触发 schema trigger 批量熔断 → session 进 REDLINE_HALTED。
 *  复用 assessment-answer.test.ts haltSession 模式。 */
function haltSession(student: string): string {
  const incidentId = uuidv4()
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
        reason_code, triggered_by, context_phase, status, requires_review_before_next_session)
     VALUES (?, ?, 'SUPERMARKET_SHELVER', ?, ?, 'BLADE_TOWARD_SELF', ?, 'ONLINE_ASSESSMENT', 'PENDING_DETAIL', 1)`
  ).run(incidentId, student, taskCode, triggerEventId, callerId)
  return incidentId
}

beforeAll(async () => {
  db = await createTestDb()
  // 同 answer.test.ts：DROP no_delete 以允许 beforeEach 清表
  db.exec('DROP TRIGGER IF EXISTS trg_assessment_session_no_delete')
})

afterAll(() => {
  db.close()
})

beforeEach(() => {
  db.exec('DELETE FROM answer_record')
  db.exec('DELETE FROM assessment_session_question')
  db.exec('DELETE FROM assessment_sitting')
  db.exec('DELETE FROM safety_incident_binding')
  db.exec('DELETE FROM result_record')
  db.exec('DELETE FROM assessment_session')
  db.exec('DELETE FROM business_session')
  db.exec('DELETE FROM safety_incident')
  db.exec('DELETE FROM error_event_log')
  db.exec('DELETE FROM domain_event_projection')
  db.exec('DELETE FROM question_bank')
  db.exec('DELETE FROM strategy_config')
  db.exec('DELETE FROM student_profile')
  db.exec('DELETE FROM user_account')

  seedAssessmentErrorCodes(db)
  callerId = seedCaller(db, 'TEACHER')
  studentId = seedStudent(db)
  seedStrategyRow()
  seedQuestionBankDraft(db)
  mockState.db = db
})

// ---------- startSession 正常路径 ----------

describe('assessment:startSession M3 phase gate', () => {
  it('PREPARED 会话调用旧 startSession → ASSIGNMENT_REQUIRED，且不写事件、不改 phase', () => {
    const { sessionId } = setupSession()

    const before = db
      .prepare('SELECT current_question_id, delivery_phase FROM assessment_session WHERE session_id = ?')
      .get(sessionId) as { current_question_id: string | null; delivery_phase: string }
    expect(before.current_question_id).toBeNull()
    expect(before.delivery_phase).toBe('PREPARED')

    const result = startSession(db, baseStartParams(sessionId))

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.errorCode).toBe('ASSIGNMENT_REQUIRED')

    const after = db
      .prepare('SELECT current_question_id, delivery_phase FROM assessment_session WHERE session_id = ?')
      .get(sessionId) as { current_question_id: string | null; delivery_phase: string }
    expect(after.current_question_id).toBeNull()
    expect(after.delivery_phase).toBe('PREPARED')

    const eventCount = db
      .prepare(
        `SELECT COUNT(*) AS n FROM domain_event_projection
          WHERE aggregate_id = ? AND event_type = 'SESSION_FIRST_QUESTION_ACTIVATED'`
      )
      .get(sessionId) as { n: number }
    expect(eventCount.n).toBe(0)
  })

  it.each([
    ['ASSIGNED', 'STUDENT_CONFIRMATION_REQUIRED'],
    ['STUDENT_CONFIRMED', 'STUDENT_CONFIRMATION_REQUIRED']
  ] as const)('%s 会话调用旧 startSession → %s，且不写事件', (phase, errorCode) => {
    const { sessionId } = setupSession()
    setAssessmentSessionStateFixture(db, sessionId, 'INIT', phase)

    const result = startSession(db, baseStartParams(sessionId))

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.errorCode).toBe(errorCode)
    const after = db
      .prepare('SELECT current_question_id, delivery_phase FROM assessment_session WHERE session_id = ?')
      .get(sessionId) as { current_question_id: string | null; delivery_phase: string }
    expect(after.current_question_id).toBeNull()
    expect(after.delivery_phase).toBe(phase)
    const eventCount = db
      .prepare(
        `SELECT COUNT(*) AS n FROM domain_event_projection
          WHERE aggregate_id = ? AND event_type = 'SESSION_FIRST_QUESTION_ACTIVATED'`
      )
      .get(sessionId) as { n: number }
    expect(eventCount.n).toBe(0)
  })
})

// ---------- startSession 幂等 ----------

describe('assessment:startSession 幂等', () => {
  it('存量 ONLINE_IN_PROGRESS 会话重复调用 → 不写新事件，直接返回现有指针', () => {
    const { sessionId } = setupSession()
    const firstQuestionId = forceLegacyOnlineInProgress(sessionId)

    const eventCountBefore = db
      .prepare(
        `SELECT COUNT(*) AS n FROM domain_event_projection
          WHERE aggregate_id = ? AND event_type = 'SESSION_FIRST_QUESTION_ACTIVATED'`
      )
      .get(sessionId) as { n: number }
    expect(eventCountBefore.n).toBe(0)

    const result = startSession(db, baseStartParams(sessionId))
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.firstQuestionId).toBe(firstQuestionId)
    expect(result.firstQuestionOrder).toBe(1)

    const eventCountAfter = db
      .prepare(
        `SELECT COUNT(*) AS n FROM domain_event_projection
          WHERE aggregate_id = ? AND event_type = 'SESSION_FIRST_QUESTION_ACTIVATED'`
      )
      .get(sessionId) as { n: number }
    expect(eventCountAfter.n).toBe(0) // 没写新事件
  })

  it('ANSWER_SUBMITTED 已推进 current_question_id 后 startSession → 不覆盖，返回当前指针', () => {
    const { sessionId } = setupSession(studentId, taskCode, {
      TRUE_FALSE: { question_type: 'TRUE_FALSE', expected_answer: true }
    })

    // 1. 模拟 M2 存量进行中会话：已有首题指针
    const firstQuestionId = forceLegacyOnlineInProgress(sessionId)

    // 2. 第一题为 TRUE_FALSE + 提交答案 → reducer applyAnswerSubmitted 推进到第二题
    const answerResult = submitAnswer(db, {
      callerUserId: studentId,
      callerRole: 'STUDENT',
      sessionId,
      questionId: firstQuestionId,
      answerPayload: { question_type: 'TRUE_FALSE', selected: true } as AnswerPayloadDetail
    })
    expect(answerResult.success).toBe(true)

    // 3. current_question_id 现在应指向第二题（reducer applyAnswerSubmitted 推进）
    const afterAnswer = db
      .prepare('SELECT current_question_id FROM assessment_session WHERE session_id = ?')
      .get(sessionId) as { current_question_id: string | null }
    expect(afterAnswer.current_question_id).not.toBeNull()
    expect(afterAnswer.current_question_id).not.toBe(firstQuestionId)

    // 4. 再次 startSession → 幂等返回当前指针（第二题），不覆盖回第一题
    const result = startSession(db, baseStartParams(sessionId))
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.firstQuestionId).toBe(afterAnswer.current_question_id)
  })
})

// ---------- startSession 错误码 ----------

describe('assessment:startSession 错误码', () => {
  it('FORBIDDEN — TEACHER 调用', () => {
    const { sessionId } = setupSession()
    const result = startSession(db, baseStartParams(sessionId, {
      callerUserId: callerId,
      callerRole: 'TEACHER'
    }))
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.errorCode).toBe('FORBIDDEN')
  })

  it('NOT_FOUND — session 不存在', () => {
    const result = startSession(db, baseStartParams('nonexistent-session-id'))
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.errorCode).toBe('NOT_FOUND')
  })

  it('SESSION_PAUSED — status=EMOTION_INTERRUPTED', () => {
    const { sessionId } = setupSession()
    forceSessionStatus(sessionId, 'EMOTION_INTERRUPTED')
    const result = startSession(db, baseStartParams(sessionId))
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.errorCode).toBe('SESSION_PAUSED')
  })

  it('SESSION_HALTED — status=REDLINE_HALTED', () => {
    const { sessionId } = setupSession()
    // REDLINE_HALTED 必须经 safety_incident trigger 设置（直接 UPDATE 会被拦截）。
    // haltSession INSERT safety_incident → trigger 批量熔断 session。
    haltSession(studentId)
    const result = startSession(db, baseStartParams(sessionId))
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.errorCode).toBe('SESSION_HALTED')
  })

  it('SESSION_NOT_ACTIVE — status=COMPLETED', () => {
    const { sessionId } = setupSession()
    forceSessionStatus(sessionId, 'COMPLETED')
    const result = startSession(db, baseStartParams(sessionId))
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.errorCode).toBe('SESSION_NOT_ACTIVE')
  })

  it('FORBIDDEN — session 属于他人（session_id 有效但 student_id 不匹配）', () => {
    const otherStudent = seedStudent(db, { studentName: '其他学生' })
    const { sessionId } = setupSession(otherStudent)
    // caller 是 studentId（不是 otherStudent）→ session 不属于 caller
    const result = startSession(db, baseStartParams(sessionId))
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.errorCode).toBe('FORBIDDEN')
  })
})

// ---------- listMySessions ----------

describe('assessment:listMySessions', () => {
  it('返回自己的 OPEN session（不含终态）', () => {
    const { sessionId: sid1 } = setupSession()
    // 第二个 session 用不同 taskCode（schema ux 约束同 student+task+strategy_type 仅一个开放）
    const { sessionId: sid2 } = setupSession(studentId, 'OTHER_TASK')

    const result = listMySessions(db, baseListMyParams())
    expect(result.success).toBe(true)
    if (!result.success) return
    const ids = result.items.map((i) => i.sessionId)
    expect(ids).toContain(sid1)
    expect(ids).toContain(sid2)
  })

  it('未分配 session 的 assignmentId/assignmentStatus 为 null（LEFT JOIN 空安全）', () => {
    const { sessionId } = setupSession()

    const result = listMySessions(db, baseListMyParams())
    expect(result.success).toBe(true)
    if (!result.success) return
    const item = result.items.find((i) => i.sessionId === sessionId)
    expect(item).toBeDefined()
    expect(item?.assignmentId).toBeNull()
    expect(item?.assignmentStatus).toBeNull()
  })

  it('不返回终态 session（COMPLETED/ABORTED/REDLINE_HALTED）', () => {
    const { sessionId } = setupSession()
    // 强制改 COMPLETED
    forceSessionStatus(sessionId, 'COMPLETED')

    const result = listMySessions(db, baseListMyParams())
    expect(result.success).toBe(true)
    if (!result.success) return
    const ids = result.items.map((i) => i.sessionId)
    expect(ids).not.toContain(sessionId)
  })

  it('不返回他人 session', () => {
    const otherStudent = seedStudent(db, { studentName: '其他学生' })
    const { sessionId: otherSessionId } = setupSession(otherStudent)

    // caller=studentId 查自己，不应看到 otherStudent 的 session
    const result = listMySessions(db, baseListMyParams())
    expect(result.success).toBe(true)
    if (!result.success) return
    const ids = result.items.map((i) => i.sessionId)
    expect(ids).not.toContain(otherSessionId)
  })

  it('FORBIDDEN — TEACHER 调用', () => {
    const result = listMySessions(db, baseListMyParams({
      callerUserId: callerId,
      callerRole: 'TEACHER'
    }))
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.errorCode).toBe('FORBIDDEN')
  })
})
