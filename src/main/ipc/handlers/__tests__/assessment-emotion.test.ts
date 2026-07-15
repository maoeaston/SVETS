// assessment:emotionInterrupt / emotionResume / abortSession 集成测试。
// 覆盖 impl.md Step 7 情绪中断/崩溃路径。
//
// [!] writeEvent mock 同 assessment-answer.test.ts（event_sequence = MAX+1）：
// 多事件同 aggregate（SESSION_STARTED → EMOTION_INTERRUPTED ×N → EMOTION_RESUMED →
// SESSION_ABORTED）必须递增 sequence，不能硬编码 1。
//
// [!] 崩溃计数语义（impl.md Step 7 决策）：collapse_count = 事件溯源查询
//   count(EMOTION_INTERRUPTED) - count(EMOTION_RESUMED)
// 非 session.pause_count 字段。"I R I R I abort" 用例（pause_count=3 而 collapse=1）
// 非破坏性地证明此语义：若 abort 误用 pause_count(3) 会触发 collapse，实际 collapse(1) 不触发。

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
  startSession,
  emotionInterrupt,
  emotionResume,
  abortSession,
  submitAnswer,
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
  EmotionInterruptParams,
  EmotionResumeParams,
  AbortSessionParams,
  SessionQuestionView
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

function setupSession(
  student: string = studentId,
  contentByType: Partial<Record<OnlineQuestionType, Record<string, unknown>>> = {}
): SetupResult {
  for (const [questionType, content] of Object.entries(contentByType)) {
    seedContentJsonByType(questionType as OnlineQuestionType, content)
  }
  // v0.1.12: 激活所有 DRAFT 题，满足 session_question_insert_validation
  db.prepare("UPDATE question_bank SET status = 'ACTIVE' WHERE status = 'DRAFT'").run()
  const result = createSession(db, {
    callerUserId: callerId,
    callerRole: 'TEACHER',
    studentId: student,
    strategyId,
    strategyVersion,
    taskCode
  })
  if (!result.success) {
    throw new Error(`setupSession createSession failed: ${JSON.stringify(result)}`)
  }
  const started = startSession(db, {
    callerUserId: student,
    callerRole: 'STUDENT',
    sessionId: result.sessionId
  })
  if (!started.success) {
    throw new Error(`setupSession startSession failed: ${JSON.stringify(started)}`)
  }
  return { sessionId: result.sessionId, questions: result.questions }
}

/** INSERT safety_incident 触发批量熔断 → session 进 REDLINE_HALTED（同 answer.test.ts）。 */
function haltSession(student: string): void {
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
}

function interruptParams(sessionId: string, over: Partial<EmotionInterruptParams> = {}): EmotionInterruptParams {
  return { callerUserId: studentId, callerRole: 'STUDENT', sessionId, ...over }
}
function resumeParams(sessionId: string, over: Partial<EmotionResumeParams> = {}): EmotionResumeParams {
  return { callerUserId: callerId, callerRole: 'TEACHER', sessionId, ...over }
}
function abortParamsSession(sessionId: string, over: Partial<AbortSessionParams> = {}): AbortSessionParams {
  return { callerUserId: callerId, callerRole: 'TEACHER', sessionId, ...over }
}

/** 计 event_type 在某 aggregate 上的命中数。 */
function countEvents(sessionId: string, eventType: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM domain_event_projection
        WHERE aggregate_id = ? AND event_type = ?`
    )
    .get(sessionId, eventType) as { n: number }
  return row.n
}

function sessionStatus(sessionId: string): { status: string; pause_count: number } {
  return db
    .prepare('SELECT status, pause_count FROM assessment_session WHERE session_id = ?')
    .get(sessionId) as { status: string; pause_count: number }
}

beforeAll(async () => {
  db = await createTestDb()
  db.exec('DROP TRIGGER IF EXISTS trg_assessment_session_no_delete')
})

afterAll(() => {
  db.close()
})

beforeEach(() => {
  db.exec('DELETE FROM answer_record')
  db.exec('DELETE FROM assessment_session_question')
  db.exec('DELETE FROM safety_incident_binding')
  db.exec('DELETE FROM result_record')
  db.exec('DELETE FROM assessment_session')
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

// ---------- emotionInterrupt ----------

describe('assessment:emotionInterrupt 正常路径', () => {
  it('ACTIVE → EMOTION_INTERRUPTED：写事件 + pause_count+1', () => {
    const { sessionId } = setupSession()

    const result = emotionInterrupt(db, interruptParams(sessionId))

    expect(result).toEqual({ success: true })
    expect(sessionStatus(sessionId).status).toBe('EMOTION_INTERRUPTED')
    expect(sessionStatus(sessionId).pause_count).toBe(1)
    expect(countEvents(sessionId, 'EMOTION_INTERRUPTED')).toBe(1)
  })

  it('从 EMOTION_INTERRUPTED 可再次中断（escalating collapse）→ pause_count 累加', () => {
    const { sessionId } = setupSession()

    emotionInterrupt(db, interruptParams(sessionId))
    const second = emotionInterrupt(db, interruptParams(sessionId))

    expect(second).toEqual({ success: true })
    expect(sessionStatus(sessionId).pause_count).toBe(2)
    expect(countEvents(sessionId, 'EMOTION_INTERRUPTED')).toBe(2)
  })
})

describe('assessment:emotionInterrupt 拒绝路径', () => {
  it('TEACHER 调用 → FORBIDDEN', () => {
    const { sessionId } = setupSession()
    const result = emotionInterrupt(db, interruptParams(sessionId, { callerRole: 'TEACHER' }))
    expect(result).toEqual({ success: false, errorCode: 'FORBIDDEN' })
  })

  it('答他人 session → FORBIDDEN', () => {
    const other = seedStudent(db, { studentName: '他人' })
    const { sessionId } = setupSession(other)
    const result = emotionInterrupt(db, interruptParams(sessionId))
    expect(result).toEqual({ success: false, errorCode: 'FORBIDDEN' })
  })

  it('session 不存在 → NOT_FOUND', () => {
    const result = emotionInterrupt(db, interruptParams(uuidv4()))
    expect(result).toEqual({ success: false, errorCode: 'NOT_FOUND' })
  })

  it('COMPLETED → SESSION_NOT_ACTIVE', () => {
    const { sessionId } = setupSession()
    setAssessmentSessionStateFixture(db, sessionId, 'COMPLETED')
    const result = emotionInterrupt(db, interruptParams(sessionId))
    expect(result).toEqual({ success: false, errorCode: 'SESSION_NOT_ACTIVE' })
  })

  it('REDLINE_HALTED → SESSION_HALTED', () => {
    const { sessionId } = setupSession()
    haltSession(studentId)
    expect(sessionStatus(sessionId).status).toBe('REDLINE_HALTED')
    const result = emotionInterrupt(db, interruptParams(sessionId))
    expect(result).toEqual({ success: false, errorCode: 'SESSION_HALTED' })
  })
})

// ---------- emotionResume ----------

describe('assessment:emotionResume 正常路径', () => {
  it('EMOTION_INTERRUPTED → ACTIVE：写事件 + 清 pause_started_at', () => {
    const { sessionId } = setupSession()
    emotionInterrupt(db, interruptParams(sessionId))
    expect(sessionStatus(sessionId).status).toBe('EMOTION_INTERRUPTED')

    const result = emotionResume(db, resumeParams(sessionId))

    expect(result).toEqual({ success: true })
    expect(sessionStatus(sessionId).status).toBe('ACTIVE')
    expect(countEvents(sessionId, 'EMOTION_RESUMED')).toBe(1)
  })

  it('中断→恢复后可继续答题（integration）', () => {
    const { sessionId, questions } = setupSession(studentId, {
      TRUE_FALSE: { question_type: 'TRUE_FALSE', expected_answer: true }
    })
    const q = questions[0]

    emotionInterrupt(db, interruptParams(sessionId))
    expect(sessionStatus(sessionId).status).toBe('EMOTION_INTERRUPTED')

    // 中断态答题 → SESSION_PAUSED
    const blocked = submitAnswer(db, {
      callerUserId: studentId,
      callerRole: 'STUDENT',
      sessionId,
      questionId: q.questionId,
      answerPayload: { question_type: 'TRUE_FALSE', selected: true }
    })
    expect(blocked).toEqual({ success: false, errorCode: 'SESSION_PAUSED' })

    // 恢复后答题 → 成功
    emotionResume(db, resumeParams(sessionId))
    const ok = submitAnswer(db, {
      callerUserId: studentId,
      callerRole: 'STUDENT',
      sessionId,
      questionId: q.questionId,
      answerPayload: { question_type: 'TRUE_FALSE', selected: true }
    })
    expect(ok.success).toBe(true)
  })
})

describe('assessment:emotionResume 拒绝路径', () => {
  it('STUDENT 调用 → FORBIDDEN', () => {
    const { sessionId } = setupSession()
    emotionInterrupt(db, interruptParams(sessionId))
    const result = emotionResume(
      db,
      resumeParams(sessionId, { callerUserId: studentId, callerRole: 'STUDENT' })
    )
    expect(result).toEqual({ success: false, errorCode: 'FORBIDDEN' })
  })

  it('session 不存在 → NOT_FOUND', () => {
    const result = emotionResume(db, resumeParams(uuidv4()))
    expect(result).toEqual({ success: false, errorCode: 'NOT_FOUND' })
  })

  it('ACTIVE 态恢复（非 EMOTION_INTERRUPTED）→ SESSION_NOT_ACTIVE', () => {
    const { sessionId } = setupSession()
    const result = emotionResume(db, resumeParams(sessionId))
    expect(result).toEqual({ success: false, errorCode: 'SESSION_NOT_ACTIVE' })
  })
})

// ---------- abortSession ----------

describe('assessment:abortSession 正常路径（collapse 未达阈值）', () => {
  it('无中断直接 abort：SESSION_ABORTED + 无崩溃事件 + 审计', () => {
    const { sessionId } = setupSession()

    const result = abortSession(db, abortParamsSession(sessionId))

    expect(result).toEqual({ success: true })
    expect(sessionStatus(sessionId).status).toBe('ABORTED')
    expect(countEvents(sessionId, 'SESSION_ABORTED')).toBe(1)
    expect(countEvents(sessionId, 'EMOTION_COLLAPSE_THRESHOLD_REACHED')).toBe(0)

    // 审计行（INFO，recovery_status=IGNORED）
    const audit = db
      .prepare(
        `SELECT recovery_status FROM error_event_log
          WHERE error_code = 'SESSION_ABORTED' AND related_aggregate_id = ?`
      )
      .get(sessionId) as { recovery_status: string } | undefined
    expect(audit).toBeDefined()
    expect(audit!.recovery_status).toBe('IGNORED')
  })
})

describe('assessment:abortSession 崩溃兜底', () => {
  it('3 次未恢复中断 + abort(threshold=3) → EMOTION_COLLAPSE_THRESHOLD_REACHED + SESSION_ABORTED', () => {
    const { sessionId } = setupSession()
    emotionInterrupt(db, interruptParams(sessionId))
    emotionInterrupt(db, interruptParams(sessionId))
    emotionInterrupt(db, interruptParams(sessionId))
    expect(sessionStatus(sessionId).pause_count).toBe(3)

    const result = abortSession(db, abortParamsSession(sessionId))

    expect(result).toEqual({ success: true })
    expect(sessionStatus(sessionId).status).toBe('ABORTED')
    expect(countEvents(sessionId, 'EMOTION_COLLAPSE_THRESHOLD_REACHED')).toBe(1)
    expect(countEvents(sessionId, 'SESSION_ABORTED')).toBe(1)

    // 崩溃事件 payload：collapse_count=3, threshold=3, collapse_history 长度=3
    const evt = db
      .prepare(
        `SELECT payload_json FROM domain_event_projection
          WHERE aggregate_id = ? AND event_type = 'EMOTION_COLLAPSE_THRESHOLD_REACHED'`
      )
      .get(sessionId) as { payload_json: string }
    const payload = JSON.parse(evt.payload_json) as {
      collapse_count: number
      threshold: number
      collapse_history: unknown[]
    }
    expect(payload.collapse_count).toBe(3)
    expect(payload.threshold).toBe(3)
    expect(payload.collapse_history).toHaveLength(3)
  })

  it('collapse_count=2 < threshold=3 → 无崩溃事件（边界：2 不触发）', () => {
    const { sessionId } = setupSession()
    emotionInterrupt(db, interruptParams(sessionId))
    emotionInterrupt(db, interruptParams(sessionId))

    abortSession(db, abortParamsSession(sessionId))

    expect(countEvents(sessionId, 'EMOTION_COLLAPSE_THRESHOLD_REACHED')).toBe(0)
    expect(countEvents(sessionId, 'SESSION_ABORTED')).toBe(1)
  })

  it('中断→恢复→中断→恢复→中断 + abort → collapse_count=1 不触发（证明计数=interrupted-resumed 非 pause_count）', () => {
    const { sessionId } = setupSession()
    // I R I R I → interrupted=3, resumed=2, collapse=1；pause_count=3
    emotionInterrupt(db, interruptParams(sessionId))
    emotionResume(db, resumeParams(sessionId))
    emotionInterrupt(db, interruptParams(sessionId))
    emotionResume(db, resumeParams(sessionId))
    emotionInterrupt(db, interruptParams(sessionId))
    expect(sessionStatus(sessionId).pause_count).toBe(3)

    abortSession(db, abortParamsSession(sessionId))

    // 若误用 pause_count(3) 会触发崩溃事件；实际 collapse(1) 不触发
    expect(countEvents(sessionId, 'EMOTION_COLLAPSE_THRESHOLD_REACHED')).toBe(0)
    expect(countEvents(sessionId, 'SESSION_ABORTED')).toBe(1)
  })
})

describe('assessment:abortSession 拒绝路径', () => {
  it('STUDENT 调用 → FORBIDDEN', () => {
    const { sessionId } = setupSession()
    const result = abortSession(
      db,
      abortParamsSession(sessionId, { callerUserId: studentId, callerRole: 'STUDENT' })
    )
    expect(result).toEqual({ success: false, errorCode: 'FORBIDDEN' })
  })

  it('session 不存在 → NOT_FOUND', () => {
    const result = abortSession(db, abortParamsSession(uuidv4()))
    expect(result).toEqual({ success: false, errorCode: 'NOT_FOUND' })
  })

  it('COMPLETED → SESSION_NOT_ACTIVE', () => {
    const { sessionId } = setupSession()
    setAssessmentSessionStateFixture(db, sessionId, 'COMPLETED')
    const result = abortSession(db, abortParamsSession(sessionId))
    expect(result).toEqual({ success: false, errorCode: 'SESSION_NOT_ACTIVE' })
  })

  it('REDLINE_HALTED → SESSION_HALTED', () => {
    const { sessionId } = setupSession()
    haltSession(studentId)
    const result = abortSession(db, abortParamsSession(sessionId))
    expect(result).toEqual({ success: false, errorCode: 'SESSION_HALTED' })
  })
})
