// assessment:submitAnswer 集成测试：直接调 submitAnswer 纯函数，注入 MemoryAdapter。
// 覆盖 impl.md Step 7 答题路径测试用例（情绪中断/崩溃在 assessment-emotion.test.ts）。
//
// [!] writeEvent mock：与 assessment-create.test.ts 同模式（vi.mock + vi.hoisted），
// 但 event_sequence 改为 MAX+1（create.test.ts 硬编码 1，submitAnswer 对已有
// SESSION_STARTED 的 aggregate 写第二事件会重复 sequence）。此处镜像真实
// writeEvent 的 nextSequence 逻辑，保证 ANSWER_SUBMITTED 事件 sequence 递增。
//
// [!] content_json：seedQuestionBank 用 '{"seed":true}' 占位，submitAnswer 计分
// 依赖 content_json 的 expected_answer / options / drop_zones 字段（doc §1）。
// schema v0.1.10 起，题目进入 assessment_session_question 后语义字段冻结。
// 需要真实 content_json 的测试通过 setupSession({ contentByType }) 在组卷前写入。

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
      // 镜像真实 writeEvent：aggregate 内 event_sequence = MAX+1（非硬编码 1）
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

import { createSession, submitAnswer, seedAssessmentErrorCodes } from '../assessment'
import {
  createTestDb,
  seedCaller,
  seedStudent,
  seedQuestionBankDraft,
  baseStrategyInput
} from '../../../db/test-helpers'
import type { MemoryAdapter } from '../../../db/memory-adapter'
import type { StrategyInput } from '../../../../shared/types/strategy'
import type {
  SubmitAnswerParams,
  SessionQuestionView,
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

/** UPDATE 指定题目的 content_json（覆盖 seed 占位 '{"seed":true}'）。 */
function seedContentJson(questionId: string, content: Record<string, unknown>): void {
  const contentJson = JSON.stringify(content)
  const row = db
    .prepare('SELECT content_json FROM question_bank WHERE question_id = ?')
    .get(questionId) as { content_json: string } | undefined
  if (row?.content_json === contentJson) return
  db.prepare('UPDATE question_bank SET content_json = ? WHERE question_id = ?').run(contentJson, questionId)
}

interface SetupResult {
  sessionId: string
  questions: SessionQuestionView[]
}

type OnlineType = 'TRUE_FALSE' | 'SINGLE_CHOICE' | 'DRAG'

/** 跑一次 createSession 拿到可答 session + ONLINE 题列表（已含 42 ONLINE + 8 OFFLINE）。 */
function setupSession(options: {
  student?: string
  contentByType?: Partial<Record<OnlineType, Record<string, unknown>>>
} = {}): SetupResult {
  if (options.contentByType) {
    for (const [type, content] of Object.entries(options.contentByType)) {
      db.prepare('UPDATE question_bank SET content_json = ? WHERE question_type = ? AND status = ?').run(
        JSON.stringify(content),
        type,
        'DRAFT'
      )
    }
  }
  // v0.1.12: session_question_insert_validation 要求题目为 ACTIVE，激活全部 DRAFT 题
  db.prepare("UPDATE question_bank SET status = 'ACTIVE' WHERE status = 'DRAFT'").run()
  const result = createSession(db, {
    callerUserId: callerId,
    callerRole: 'TEACHER',
    studentId: options.student ?? studentId,
    strategyId,
    strategyVersion,
    taskCode
  })
  if (!result.success) {
    throw new Error(`setupSession createSession failed: ${JSON.stringify(result)}`)
  }
  return { sessionId: result.sessionId, questions: result.questions }
}

/** 从题列表取指定类型的第一道 ONLINE 题。 */
function pickQuestion(qs: SessionQuestionView[], type: 'TRUE_FALSE' | 'SINGLE_CHOICE' | 'DRAG'): SessionQuestionView {
  const q = qs.find((x) => x.questionType === type)
  if (!q) throw new Error(`no ONLINE question of type ${type} in session`)
  return q
}

/** 取一道 OFFLINE 题（测 QUESTION_NOT_IN_SESSION 的 phase 校验）。 */
function pickOfflineQuestionId(sessionId: string): string {
  const row = db
    .prepare(
      `SELECT question_id FROM assessment_session_question
        WHERE session_id = ? AND question_phase = 'OFFLINE' LIMIT 1`
    )
    .get(sessionId) as { question_id: string } | undefined
  if (!row) throw new Error('no OFFLINE question in session')
  return row.question_id
}

/** INSERT 一条 safety_incident(PENDING_DETAIL)，触发批量熔断 → 同 student+task 开放 session 进 REDLINE_HALTED。 */
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

function baseAnswerParams(
  sessionId: string,
  questionId: string,
  answerPayload: AnswerPayloadDetail,
  over: Partial<SubmitAnswerParams> = {}
): SubmitAnswerParams {
  return {
    callerUserId: studentId,
    callerRole: 'STUDENT',
    sessionId,
    questionId,
    answerPayload,
    ...over
  }
}

// content_json 模板（覆盖 doc §1 各题型必需字段）
const TF_CONTENT = { question_type: 'TRUE_FALSE', expected_answer: true } as const
const SC_CONTENT = {
  question_type: 'SINGLE_CHOICE',
  options: [
    { key: 'A', text: '选项甲' },
    { key: 'B', text: '选项乙' },
    { key: 'C', text: '选项丙' }
  ],
  expected_answer: 'B'
} as const
// 线上 DRAG 按 PRD v1.0.6 收口为二值判分；scoring_mode 仅保留展示/兼容语义。
const DRAG_PARTIAL_CONTENT = {
  question_type: 'DRAG',
  drag_items: [
    { item_id: 'd1', label: '一' },
    { item_id: 'd2', label: '二' },
    { item_id: 'd3', label: '三' }
  ],
  drop_zones: [
    { zone_id: 'z1', label: '区一', accepts: ['d1'] },
    { zone_id: 'z2', label: '区二', accepts: ['d2'] },
    { zone_id: 'z3', label: '区三', accepts: ['d3'] }
  ],
  scoring_mode: 'PARTIAL_CREDIT'
} as const
const DRAG_ALL_OR_NOTHING_CONTENT = { ...DRAG_PARTIAL_CONTENT, scoring_mode: 'ALL_OR_NOTHING' } as const

beforeAll(async () => {
  db = await createTestDb()
  // 同 create.test.ts：DROP no_delete 以允许 beforeEach 清表（生产 schema 不受影响）
  db.exec('DROP TRIGGER IF EXISTS trg_assessment_session_no_delete')
})

afterAll(() => {
  db.close()
})

beforeEach(() => {
  // FK-safe 清表顺序：子表先于父表；answer_record/session_question 须先于 session（RESTRICT）
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

// ---------- 正常路径 + 落库 ----------

describe('assessment:submitAnswer 正常路径', () => {
  it('TRUE_FALSE 答对 → score=2 + answer_record + 事件 + 计数前移', () => {
    const { sessionId, questions } = setupSession({ contentByType: { TRUE_FALSE: TF_CONTENT } })
    const q = pickQuestion(questions, 'TRUE_FALSE')
    seedContentJson(q.questionId, TF_CONTENT)

    const result = submitAnswer(
      db,
      baseAnswerParams(sessionId, q.questionId, { question_type: 'TRUE_FALSE', selected: true })
    )

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.isCorrect).toBe(true)
    expect(result.score).toBe(2)

    // answer_record 行
    const ar = db
      .prepare('SELECT * FROM answer_record WHERE session_id = ? AND question_id = ?')
      .get(sessionId, q.questionId) as
      | {
          is_correct: number
          score: number
          status: string
          answer_payload_json: string
          submitted_event_id: string
        }
      | undefined
    expect(ar).toBeDefined()
    expect(ar!.is_correct).toBe(1)
    expect(ar!.score).toBe(2)
    expect(ar!.status).toBe('VALID')
    expect(JSON.parse(ar!.answer_payload_json)).toEqual({
      question_type: 'TRUE_FALSE',
      selected: true
    })

    // ANSWER_SUBMITTED 事件落 domain_event_projection，event_sequence 递增（SESSION_STARTED=1 → ANSWER=2）
    const evt = db
      .prepare(
        `SELECT event_sequence FROM domain_event_projection
          WHERE aggregate_id = ? AND event_type = 'ANSWER_SUBMITTED'`
      )
      .get(sessionId) as { event_sequence: number } | undefined
    expect(evt).toBeDefined()
    expect(evt!.event_sequence).toBe(2)

    // session 计数前移（reducer applyAnswerSubmitted）
    const sess = db
      .prepare('SELECT online_completed_count, current_question_id FROM assessment_session WHERE session_id = ?')
      .get(sessionId) as { online_completed_count: number; current_question_id: string | null }
    expect(sess.online_completed_count).toBe(1)
  })

  it('TRUE_FALSE 答错 → score=0 + is_correct=false', () => {
    const { sessionId, questions } = setupSession({ contentByType: { TRUE_FALSE: TF_CONTENT } })
    const q = pickQuestion(questions, 'TRUE_FALSE')
    seedContentJson(q.questionId, TF_CONTENT)

    const result = submitAnswer(
      db,
      baseAnswerParams(sessionId, q.questionId, { question_type: 'TRUE_FALSE', selected: false })
    )
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.isCorrect).toBe(false)
    expect(result.score).toBe(0)
  })

  it('SINGLE_CHOICE 选对 → score=2', () => {
    const { sessionId, questions } = setupSession({ contentByType: { SINGLE_CHOICE: SC_CONTENT } })
    const q = pickQuestion(questions, 'SINGLE_CHOICE')
    seedContentJson(q.questionId, SC_CONTENT)

    const result = submitAnswer(
      db,
      baseAnswerParams(sessionId, q.questionId, { question_type: 'SINGLE_CHOICE', selected: 'B' })
    )
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.isCorrect).toBe(true)
    expect(result.score).toBe(2)
  })

  it('SINGLE_CHOICE 选错 → score=0', () => {
    const { sessionId, questions } = setupSession({ contentByType: { SINGLE_CHOICE: SC_CONTENT } })
    const q = pickQuestion(questions, 'SINGLE_CHOICE')
    seedContentJson(q.questionId, SC_CONTENT)

    const result = submitAnswer(
      db,
      baseAnswerParams(sessionId, q.questionId, { question_type: 'SINGLE_CHOICE', selected: 'A' })
    )
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.isCorrect).toBe(false)
    expect(result.score).toBe(0)
  })
})

// ---------- DRAG 部分得分 ----------

describe('assessment:submitAnswer DRAG 部分得分', () => {
  it('全部正确 → score=2', () => {
    const { sessionId, questions } = setupSession({ contentByType: { DRAG: DRAG_PARTIAL_CONTENT } })
    const q = pickQuestion(questions, 'DRAG')
    seedContentJson(q.questionId, DRAG_PARTIAL_CONTENT)

    const result = submitAnswer(
      db,
      baseAnswerParams(sessionId, q.questionId, {
        question_type: 'DRAG',
        placements: [
          { item_id: 'd1', zone_id: 'z1' },
          { item_id: 'd2', zone_id: 'z2' },
          { item_id: 'd3', zone_id: 'z3' }
        ]
      })
    )
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.score).toBe(2)
    expect(result.isCorrect).toBe(true)
  })

  it('线上 DRAG 2/3 正确仍按二值判分 → score=0 + is_correct=false', () => {
    const { sessionId, questions } = setupSession({ contentByType: { DRAG: DRAG_PARTIAL_CONTENT } })
    const q = pickQuestion(questions, 'DRAG')
    seedContentJson(q.questionId, DRAG_PARTIAL_CONTENT)

    const result = submitAnswer(
      db,
      baseAnswerParams(sessionId, q.questionId, {
        question_type: 'DRAG',
        placements: [
          { item_id: 'd1', zone_id: 'z1' },
          { item_id: 'd2', zone_id: 'z2' },
          { item_id: 'd3', zone_id: 'z1' } // 错：d3 应去 z3
        ]
      })
    )
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.score).toBe(0)
    expect(result.isCorrect).toBe(false)
  })

  it('PARTIAL_CREDIT 1/3 正确（不多于半数）→ score=0', () => {
    const { sessionId, questions } = setupSession({ contentByType: { DRAG: DRAG_PARTIAL_CONTENT } })
    const q = pickQuestion(questions, 'DRAG')
    seedContentJson(q.questionId, DRAG_PARTIAL_CONTENT)

    const result = submitAnswer(
      db,
      baseAnswerParams(sessionId, q.questionId, {
        question_type: 'DRAG',
        placements: [
          { item_id: 'd1', zone_id: 'z1' },
          { item_id: 'd2', zone_id: 'z3' },
          { item_id: 'd3', zone_id: 'z2' }
        ]
      })
    )
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.score).toBe(0)
    expect(result.isCorrect).toBe(false)
  })

  it('ALL_OR_NOTHING 2/3 正确仍 → score=0（不给部分分）', () => {
    const { sessionId, questions } = setupSession({ contentByType: { DRAG: DRAG_ALL_OR_NOTHING_CONTENT } })
    const q = pickQuestion(questions, 'DRAG')
    seedContentJson(q.questionId, DRAG_ALL_OR_NOTHING_CONTENT)

    const result = submitAnswer(
      db,
      baseAnswerParams(sessionId, q.questionId, {
        question_type: 'DRAG',
        placements: [
          { item_id: 'd1', zone_id: 'z1' },
          { item_id: 'd2', zone_id: 'z2' },
          { item_id: 'd3', zone_id: 'z1' }
        ]
      })
    )
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.score).toBe(0)
    expect(result.isCorrect).toBe(false)
  })
})

// ---------- 身份校验 ----------

describe('assessment:submitAnswer 身份校验', () => {
  it('TEACHER 调用 → FORBIDDEN（仅 STUDENT 可答题）', () => {
    const { sessionId, questions } = setupSession({ contentByType: { TRUE_FALSE: TF_CONTENT } })
    const q = questions[0]

    const result = submitAnswer(
      db,
      baseAnswerParams(sessionId, q.questionId, { question_type: q.questionType, selected: true } as AnswerPayloadDetail, {
        callerRole: 'TEACHER'
      })
    )
    expect(result).toEqual({ success: false, errorCode: 'FORBIDDEN' })
  })

  it('DISABLED STUDENT → FORBIDDEN', () => {
    const { sessionId, questions } = setupSession({ contentByType: { TRUE_FALSE: TF_CONTENT } })
    const q = questions[0]
    db.prepare('UPDATE user_account SET status = ? WHERE user_id = ?').run('DISABLED', studentId)

    const result = submitAnswer(
      db,
      baseAnswerParams(sessionId, q.questionId, { question_type: q.questionType, selected: true } as AnswerPayloadDetail)
    )
    expect(result).toEqual({ success: false, errorCode: 'FORBIDDEN' })
  })

  it('答他人 session → FORBIDDEN', () => {
    const otherStudent = seedStudent(db, { studentName: '其他学生' })
    const { sessionId, questions } = setupSession({ student: otherStudent })
    const q = questions[0]

    // studentId（本人）答 otherStudent 的 session
    const result = submitAnswer(
      db,
      baseAnswerParams(sessionId, q.questionId, { question_type: q.questionType, selected: true } as AnswerPayloadDetail)
    )
    expect(result).toEqual({ success: false, errorCode: 'FORBIDDEN' })
  })

  it('session 不存在 → NOT_FOUND', () => {
    const result = submitAnswer(
      db,
      baseAnswerParams(uuidv4(), 'any-question', { question_type: 'TRUE_FALSE', selected: true })
    )
    expect(result).toEqual({ success: false, errorCode: 'NOT_FOUND' })
  })
})

// ---------- 状态校验 ----------

describe('assessment:submitAnswer 状态校验', () => {
  it('EMOTION_INTERRUPTED → SESSION_PAUSED', () => {
    const { sessionId, questions } = setupSession({ contentByType: { TRUE_FALSE: TF_CONTENT } })
    const q = questions[0]
    db.prepare('UPDATE assessment_session SET status = ? WHERE session_id = ?').run(
      'EMOTION_INTERRUPTED',
      sessionId
    )

    const result = submitAnswer(
      db,
      baseAnswerParams(sessionId, q.questionId, { question_type: q.questionType, selected: true } as AnswerPayloadDetail)
    )
    expect(result).toEqual({ success: false, errorCode: 'SESSION_PAUSED' })
  })

  it('COMPLETED → SESSION_NOT_ACTIVE', () => {
    const { sessionId, questions } = setupSession({ contentByType: { TRUE_FALSE: TF_CONTENT } })
    const q = questions[0]
    db.prepare('UPDATE assessment_session SET status = ? WHERE session_id = ?').run('COMPLETED', sessionId)

    const result = submitAnswer(
      db,
      baseAnswerParams(sessionId, q.questionId, { question_type: q.questionType, selected: true } as AnswerPayloadDetail)
    )
    expect(result).toEqual({ success: false, errorCode: 'SESSION_NOT_ACTIVE' })
  })

  it('REDLINE_HALTED → SESSION_HALTED（经 safety_incident 批量熔断构造）', () => {
    const { sessionId, questions } = setupSession({ contentByType: { TRUE_FALSE: TF_CONTENT } })
    const q = questions[0]
    haltSession(studentId)

    // 验证前置：safety_incident INSERT 触发器确实把 session 熔断到 REDLINE_HALTED
    const sess = db
      .prepare('SELECT status FROM assessment_session WHERE session_id = ?')
      .get(sessionId) as { status: string }
    expect(sess.status).toBe('REDLINE_HALTED')

    const result = submitAnswer(
      db,
      baseAnswerParams(sessionId, q.questionId, { question_type: q.questionType, selected: true } as AnswerPayloadDetail)
    )
    expect(result).toEqual({ success: false, errorCode: 'SESSION_HALTED' })
  })
})

// ---------- question 校验 ----------

describe('assessment:submitAnswer question 校验', () => {
  it('questionId 不在本 session → QUESTION_NOT_IN_SESSION', () => {
    const { sessionId } = setupSession()
    const result = submitAnswer(
      db,
      baseAnswerParams(sessionId, uuidv4(), { question_type: 'TRUE_FALSE', selected: true })
    )
    expect(result).toEqual({ success: false, errorCode: 'QUESTION_NOT_IN_SESSION' })
  })

  it('答 OFFLINE 题 → QUESTION_NOT_IN_SESSION（仅 ONLINE 可答）', () => {
    const { sessionId } = setupSession()
    const offlineId = pickOfflineQuestionId(sessionId)

    const result = submitAnswer(
      db,
      baseAnswerParams(sessionId, offlineId, { question_type: 'TRUE_FALSE', selected: true })
    )
    expect(result).toEqual({ success: false, errorCode: 'QUESTION_NOT_IN_SESSION' })
  })

  it('questionId 空字符串 → VALIDATION_ERROR', () => {
    const { sessionId } = setupSession()
    const result = submitAnswer(
      db,
      baseAnswerParams(sessionId, '', { question_type: 'TRUE_FALSE', selected: true })
    )
    expect(result).toEqual({ success: false, errorCode: 'VALIDATION_ERROR' })
  })
})

// ---------- 重复答题 ----------

describe('assessment:submitAnswer 重复答题', () => {
  it('已存在 VALID answer_record → ALREADY_ANSWERED', () => {
    const { sessionId, questions } = setupSession({ contentByType: { TRUE_FALSE: TF_CONTENT } })
    const q = pickQuestion(questions, 'TRUE_FALSE')
    seedContentJson(q.questionId, TF_CONTENT)

    const first = submitAnswer(
      db,
      baseAnswerParams(sessionId, q.questionId, { question_type: 'TRUE_FALSE', selected: true })
    )
    expect(first.success).toBe(true)

    const second = submitAnswer(
      db,
      baseAnswerParams(sessionId, q.questionId, { question_type: 'TRUE_FALSE', selected: false })
    )
    expect(second).toEqual({ success: false, errorCode: 'ALREADY_ANSWERED' })
  })
})

// ---------- answerPayload 结构校验 ----------

describe('assessment:submitAnswer answerPayload 结构校验', () => {
  it('payload.question_type 与 session 题型不一致 → VALIDATION_ERROR', () => {
    const { sessionId, questions } = setupSession({ contentByType: { TRUE_FALSE: TF_CONTENT } })
    const q = pickQuestion(questions, 'TRUE_FALSE')
    seedContentJson(q.questionId, TF_CONTENT)

    const result = submitAnswer(
      db,
      baseAnswerParams(sessionId, q.questionId, { question_type: 'SINGLE_CHOICE', selected: 'A' })
    )
    expect(result).toEqual({ success: false, errorCode: 'VALIDATION_ERROR' })
  })

  it('TRUE_FALSE selected 非 boolean → VALIDATION_ERROR', () => {
    const { sessionId, questions } = setupSession({ contentByType: { TRUE_FALSE: TF_CONTENT } })
    const q = pickQuestion(questions, 'TRUE_FALSE')
    seedContentJson(q.questionId, TF_CONTENT)

    const result = submitAnswer(
      db,
      // 故意构造非法结构（绕过 TS，模拟 IPC 恶意输入）
      baseAnswerParams(sessionId, q.questionId, {
        question_type: 'TRUE_FALSE',
        selected: 'yes'
      } as unknown as AnswerPayloadDetail)
    )
    expect(result).toEqual({ success: false, errorCode: 'VALIDATION_ERROR' })
  })

  it('SINGLE_CHOICE selected 不在 options.key → VALIDATION_ERROR', () => {
    const { sessionId, questions } = setupSession({ contentByType: { SINGLE_CHOICE: SC_CONTENT } })
    const q = pickQuestion(questions, 'SINGLE_CHOICE')
    seedContentJson(q.questionId, SC_CONTENT)

    const result = submitAnswer(
      db,
      baseAnswerParams(sessionId, q.questionId, { question_type: 'SINGLE_CHOICE', selected: 'Z' })
    )
    expect(result).toEqual({ success: false, errorCode: 'VALIDATION_ERROR' })
  })

  it('DRAG placements 数量与 drag_items 不符 → VALIDATION_ERROR', () => {
    const { sessionId, questions } = setupSession({ contentByType: { DRAG: DRAG_PARTIAL_CONTENT } })
    const q = pickQuestion(questions, 'DRAG')
    seedContentJson(q.questionId, DRAG_PARTIAL_CONTENT)

    const result = submitAnswer(
      db,
      baseAnswerParams(sessionId, q.questionId, {
        question_type: 'DRAG',
        placements: [
          { item_id: 'd1', zone_id: 'z1' },
          { item_id: 'd2', zone_id: 'z2' }
          // 缺 d3
        ]
      })
    )
    expect(result).toEqual({ success: false, errorCode: 'VALIDATION_ERROR' })
  })

  it('DRAG placements 含未知 zone_id → VALIDATION_ERROR', () => {
    const { sessionId, questions } = setupSession({ contentByType: { DRAG: DRAG_PARTIAL_CONTENT } })
    const q = pickQuestion(questions, 'DRAG')
    seedContentJson(q.questionId, DRAG_PARTIAL_CONTENT)

    const result = submitAnswer(
      db,
      baseAnswerParams(sessionId, q.questionId, {
        question_type: 'DRAG',
        placements: [
          { item_id: 'd1', zone_id: 'z9' },
          { item_id: 'd2', zone_id: 'z2' },
          { item_id: 'd3', zone_id: 'z3' }
        ]
      })
    )
    expect(result).toEqual({ success: false, errorCode: 'VALIDATION_ERROR' })
  })
})

// ---------- content_json 缺字段 ----------

describe('assessment:submitAnswer content_json 缺校验数据', () => {
  it('content_json 仍是 seed 占位（无 expected_answer）→ VALIDATION_ERROR', () => {
    const { sessionId, questions } = setupSession()
    const q = pickQuestion(questions, 'TRUE_FALSE')
    // 不调 seedContentJson，保持 '{"seed":true}'

    const result = submitAnswer(
      db,
      baseAnswerParams(sessionId, q.questionId, { question_type: 'TRUE_FALSE', selected: true })
    )
    expect(result).toEqual({ success: false, errorCode: 'VALIDATION_ERROR' })
  })

  it('TRUE_FALSE variants 脏数据（variant.expected_answer 非 boolean）→ VALIDATION_ERROR', () => {
    const dirtyTfContent = {
      question_type: 'TRUE_FALSE',
      expected_answer: true,
      variants: [
        {
          variant_id: 'bad_variant',
          media_asset_id: 'asset_img_jdg_ms02_facing_correct_v001',
          media_brief: '坏变体',
          expected_answer: 'true'
        }
      ]
    }
    const { sessionId, questions } = setupSession({ contentByType: { TRUE_FALSE: dirtyTfContent } })
    const q = pickQuestion(questions, 'TRUE_FALSE')
    seedContentJson(q.questionId, dirtyTfContent)

    const result = submitAnswer(
      db,
      baseAnswerParams(sessionId, q.questionId, { question_type: 'TRUE_FALSE', selected: true })
    )
    expect(result).toEqual({ success: false, errorCode: 'VALIDATION_ERROR' })
  })
})
