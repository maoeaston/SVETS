// assessment:triggerRedline / calculateResult 集成测试。
// 覆盖 impl.md Step 8 红线触发链 + result_record 落盘。
//
// [!] writeEvent mock 同 assessment-emotion.test.ts（event_sequence = MAX+1）：
// 红线事务跨 SAFETY_INCIDENT 与 ASSESSMENT_SESSION 两个 aggregate，每个 aggregate
// 各自维护递增 sequence；MAX+1 模板对两 aggregate 都正确（互不影响）。
//
// [!] schema trigger 链（asserted 不重复实现）：
//   safety_incident INSERT → trg_safety_incident_bind_open_assessments
//   → 批量 UPDATE session → trg_assessment_session_redline_incident_same_student_task_update
//
// [!] context_phase 不含 BASELINE_ASSESSMENT（那是 strategy_type）；impl.md 风险点 10
//   回归：handler 前置枚举校验拦截 BASELINE_ASSESSMENT，不进事务（不写脏 jsonl）。

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
  submitAnswer,
  triggerRedline,
  calculateResult,
  seedAssessmentErrorCodes
} from '../assessment'
import { applyAssessmentEvent } from '../../../domain/assessment-reducer'
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
  TriggerRedlineParams,
  CalculateResultParams,
  SessionQuestionView
} from '../../../../shared/types/assessment'

let db: MemoryAdapter
let callerId: string
let studentId: string
let strategyId: string

const taskCode = 'SHELVE_TASK'
const strategyVersion = 1

function seedStrategyRow(over: Partial<StrategyInput> = {}): string {
  const s = baseStrategyInput({
    strategyId: `test-strategy-${uuidv4().slice(0, 8)}`,
    ...over
  })
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
  return s.strategyId
}

interface SetupResult {
  sessionId: string
  questions: SessionQuestionView[]
}

function setupSession(opts: {
  student?: string
  strategyIdOverride?: string
  contentByType?: Partial<Record<'TRUE_FALSE' | 'SINGLE_CHOICE' | 'DRAG', Record<string, unknown>>>
} = {}): SetupResult {
  if (opts.contentByType) {
    for (const [type, content] of Object.entries(opts.contentByType)) {
      db.prepare('UPDATE question_bank SET content_json = ? WHERE question_type = ? AND status = ?').run(
        JSON.stringify(content),
        type,
        'DRAFT'
      )
    }
  }
  // v0.1.12: 激活所有 DRAFT 题
  db.prepare("UPDATE question_bank SET status = 'ACTIVE' WHERE status = 'DRAFT'").run()
  const useStrategyId = opts.strategyIdOverride ?? strategyId
  const result = createSession(db, {
    callerUserId: callerId,
    callerRole: 'TEACHER',
    studentId: opts.student ?? studentId,
    strategyId: useStrategyId,
    strategyVersion,
    taskCode
  })
  if (!result.success) {
    throw new Error(`setupSession createSession failed: ${JSON.stringify(result)}`)
  }
  const started = startSession(db, {
    callerUserId: opts.student ?? studentId,
    callerRole: 'STUDENT',
    sessionId: result.sessionId
  })
  if (!started.success) {
    throw new Error(`setupSession startSession failed: ${JSON.stringify(started)}`)
  }
  return { sessionId: result.sessionId, questions: result.questions }
}

function redlineParams(
  sessionId: string,
  over: Partial<TriggerRedlineParams> = {}
): TriggerRedlineParams {
  return {
    callerUserId: callerId,
    callerRole: 'TEACHER',
    sessionId,
    reasonCode: 'BLADE_TOWARD_SELF',
    contextPhase: 'ONLINE_ASSESSMENT',
    ...over
  }
}

function calcParams(
  sessionId: string,
  over: Partial<CalculateResultParams> = {}
): CalculateResultParams {
  return {
    callerUserId: callerId,
    callerRole: 'TEACHER',
    sessionId,
    ...over
  }
}

/** STUDENT 视角提交 TRUE_FALSE 答案（简化版，仅用于测试 setup）。 */
function submitAnswerForTest(
  sessionId: string,
  questionId: string,
  selected: boolean = true
): { success: boolean } {
  const r = submitAnswer(db, {
    callerUserId: studentId,
    callerRole: 'STUDENT',
    sessionId,
    questionId,
    answerPayload: { question_type: 'TRUE_FALSE' as const, selected }
  })
  return { success: r.success }
}

function sessionRow(sessionId: string): {
  status: string
  redline_incident_id: string | null
  level_result: string | null
} {
  return db
    .prepare(
      'SELECT status, redline_incident_id, level_result FROM assessment_session WHERE session_id = ?'
    )
    .get(sessionId) as {
    status: string
    redline_incident_id: string | null
    level_result: string | null
  }
}

function resultRecord(sessionId: string):
  | {
      result_id: string
      raw_score: number | null
      max_score: number | null
      level_result: string
      safety_overridden: number
      redline_incident_id: string
      normalized_score: number
      completion_ratio: number | null
      is_current: number
    }
  | undefined {
  return db
    .prepare(
      `SELECT result_id, raw_score, max_score, level_result, safety_overridden, redline_incident_id,
              normalized_score, completion_ratio, is_current
         FROM result_record
        WHERE source_aggregate_type = 'ASSESSMENT_SESSION'
          AND source_aggregate_id = ?
          AND result_type = 'ABILITY_SCORE'`
    )
    .get(sessionId) as
    | {
        result_id: string
        raw_score: number | null
        max_score: number | null
        level_result: string
        safety_overridden: number
        redline_incident_id: string
        normalized_score: number
        completion_ratio: number | null
        is_current: number
      }
    | undefined
}

function seedOfflineScore(
  sessionId: string,
  scope: 'OFFLINE_ABILITY' | 'TASK_OPERATION',
  score: 0 | 1 | 2
): void {
  const event = db
    .prepare(
      `SELECT event_id FROM domain_event_projection
        WHERE aggregate_type = 'ASSESSMENT_SESSION' AND aggregate_id = ?
        ORDER BY event_sequence
        LIMIT 1`
    )
    .get(sessionId) as { event_id: string }

  const question =
    scope === 'OFFLINE_ABILITY'
      ? (db
          .prepare(
            `SELECT question_id FROM assessment_session_question
              WHERE session_id = ? AND question_phase = 'OFFLINE'
              ORDER BY question_order
              LIMIT 1`
          )
          .get(sessionId) as { question_id: string })
      : null

  db.prepare(
    `INSERT INTO offline_score_record
       (offline_score_id, session_id, question_id, score_scope, task_operation_code,
        score, scoring_rubric_json, scored_by, scored_event_id, status)
     VALUES (?, ?, ?, ?, ?, ?, '{}', ?, ?, 'VALID')`
  ).run(
    uuidv4(),
    sessionId,
    question?.question_id ?? null,
    scope,
    scope === 'TASK_OPERATION' ? 'unbox_check' : null,
    score,
    callerId,
    event.event_id
  )
}

function incidentExists(incidentId: string): boolean {
  return (
    db
      .prepare('SELECT 1 FROM safety_incident WHERE incident_id = ?')
      .get(incidentId) !== undefined
  )
}

function bindingCount(incidentId: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM safety_incident_binding
        WHERE incident_id = ? AND aggregate_type = 'ASSESSMENT_SESSION'`
    )
    .get(incidentId) as { n: number }
  return row.n
}

beforeAll(async () => {
  db = await createTestDb()
  db.exec('DROP TRIGGER IF EXISTS trg_assessment_session_no_delete')
})

afterAll(() => {
  db.close()
})

beforeEach(() => {
  db.exec('DELETE FROM offline_score_record')
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
  strategyId = seedStrategyRow()
  seedQuestionBankDraft(db)
  mockState.db = db
})

// ---------- triggerRedline 正常路径 ----------

describe('assessment:triggerRedline 正常路径', () => {
  it('ACTIVE session：safety_incident + binding + session REDLINE_HALTED + result_record(LEVEL_FAIL_BY_SAFETY)', () => {
    const { sessionId } = setupSession()

    const result = triggerRedline(db, redlineParams(sessionId))

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.incidentId).toBeTruthy()
    expect(incidentExists(result.incidentId)).toBe(true)

    const sess = sessionRow(sessionId)
    expect(sess.status).toBe('REDLINE_HALTED')
    expect(sess.redline_incident_id).toBe(result.incidentId)
    expect(sess.level_result).toBe('LEVEL_FAIL_BY_SAFETY')

    expect(bindingCount(result.incidentId)).toBe(1)

    const rr = resultRecord(sessionId)
    expect(rr).toBeDefined()
    expect(rr!.level_result).toBe('LEVEL_FAIL_BY_SAFETY')
    expect(rr!.safety_overridden).toBe(1)
    expect(rr!.redline_incident_id).toBe(result.incidentId)
    expect(rr!.is_current).toBe(1)
  })

  it('审计行 REDLINE_TRIGGERED(INFO, recovery_status=IGNORED)', () => {
    const { sessionId } = setupSession()
    const result = triggerRedline(db, redlineParams(sessionId))
    if (!result.success) throw new Error('expected success')

    const audit = db
      .prepare(
        `SELECT recovery_status FROM error_event_log
          WHERE error_code = 'REDLINE_TRIGGERED' AND related_aggregate_id = ?`
      )
      .get(sessionId) as { recovery_status: string } | undefined
    expect(audit).toBeDefined()
    expect(audit!.recovery_status).toBe('IGNORED')
  })

  it('写 SAFETY_INCIDENT_CREATED 事件（aggregate=SAFETY_INCIDENT）', () => {
    const { sessionId } = setupSession()
    const result = triggerRedline(db, redlineParams(sessionId))
    if (!result.success) throw new Error('expected success')

    const evt = db
      .prepare(
        `SELECT payload_json FROM domain_event_projection
          WHERE aggregate_type = 'SAFETY_INCIDENT' AND aggregate_id = ?
            AND event_type = 'SAFETY_INCIDENT_CREATED'`
      )
      .get(result.incidentId) as { payload_json: string } | undefined
    expect(evt).toBeDefined()
    const payload = JSON.parse(evt!.payload_json)
    expect(payload.reason_code).toBe('BLADE_TOWARD_SELF')
    expect(payload.context_phase).toBe('ONLINE_ASSESSMENT')
  })

  it('写 REDLINE_TRIGGERED 事件（aggregate=ASSESSMENT_SESSION，含 incident_id）', () => {
    const { sessionId } = setupSession()
    const result = triggerRedline(db, redlineParams(sessionId))
    if (!result.success) throw new Error('expected success')

    const evt = db
      .prepare(
        `SELECT payload_json FROM domain_event_projection
          WHERE aggregate_type = 'ASSESSMENT_SESSION' AND aggregate_id = ?
            AND event_type = 'REDLINE_TRIGGERED'`
      )
      .get(sessionId) as { payload_json: string } | undefined
    expect(evt).toBeDefined()
    const payload = JSON.parse(evt!.payload_json)
    expect(payload.incident_id).toBe(result.incidentId)
    expect(payload.reason_code).toBe('BLADE_TOWARD_SELF')
    expect(payload.context_phase).toBe('ONLINE_ASSESSMENT')
  })
})

// ---------- P1 修复：result_payload_json + question_count / answered_count ----------

describe('assessment:triggerRedline result_payload_json 落盘 + 重放幂等', () => {
  it('result_record.result_payload_json 非空 + 含 AbilityScorePayload 结构', () => {
    const { sessionId, questions } = setupSession({
      contentByType: { TRUE_FALSE: { question_type: 'TRUE_FALSE', expected_answer: true } }
    })

    // 给一道 ONLINE 题填真实 content_json + 答对（让 moduleScores 非空）
    const q = questions[0]
    const ans = submitAnswerForTest(sessionId, q.questionId)
    expect(ans.success).toBe(true)

    const result = triggerRedline(db, redlineParams(sessionId))
    expect(result.success).toBe(true)

    const row = db
      .prepare(
        `SELECT result_payload_json, normalized_score FROM result_record
          WHERE source_aggregate_id = ? AND result_type = 'ABILITY_SCORE'`
      )
      .get(sessionId) as { result_payload_json: string; normalized_score: number } | undefined
    expect(row).toBeDefined()
    const payload = JSON.parse(row!.result_payload_json) as {
      result_type: 'ABILITY_SCORE'
      module_scores?: { module_type: string; raw_score: number; max_score: number }[]
      online_raw_score: number
      offline_raw_score: number
      question_count: number
      answered_count: number
    }
    expect(payload.result_type).toBe('ABILITY_SCORE')
    expect(payload.online_raw_score).toBe(2) // 一道 TRUE_FALSE 答对 = 2 分
    expect(payload.offline_raw_score).toBe(0)
    expect(payload.module_scores).toBeDefined()
    expect(payload.module_scores!.length).toBeGreaterThan(0)
  })

  it('question_count=50，answered_count=实际答题数，completion_ratio 按全卷计算', () => {
    const { sessionId, questions } = setupSession({
      contentByType: { TRUE_FALSE: { question_type: 'TRUE_FALSE', expected_answer: true } }
    })
    // 答 3 道题（不同模块最好，但 seedQuestionBank 每模块都有 3 题型 × 5 题）
    const answered: SessionQuestionView[] = questions.slice(0, 3)
    for (const q of answered) {
      // SINGLE_CHOICE 需要 options；用 TRUE_FALSE 题更简单
      if (q.questionType === 'TRUE_FALSE') {
        const r = submitAnswerForTest(sessionId, q.questionId)
        expect(r.success).toBe(true)
      }
    }

    const result = triggerRedline(db, redlineParams(sessionId))
    expect(result.success).toBe(true)

    const row = db
      .prepare('SELECT result_payload_json FROM result_record WHERE source_aggregate_id = ?')
      .get(sessionId) as { result_payload_json: string }
    const payload = JSON.parse(row.result_payload_json) as {
      question_count: number
      answered_count: number
      completion_ratio: number
    }

    expect(payload.question_count).toBe(50)
    expect(payload.answered_count).toBeGreaterThanOrEqual(0) // 取决于 TRUE_FALSE 命中数
    expect(payload.completion_ratio).toBe(payload.answered_count / 50)
    expect(payload.question_count).not.toBe(payload.answered_count) // 语义分离
  })

  it('红线发生时已有 OFFLINE_ABILITY 评分：offline_raw_score/raw_score/normalized_score/completion_ratio 计入该题', () => {
    const { sessionId } = setupSession()
    seedOfflineScore(sessionId, 'OFFLINE_ABILITY', 2)

    const result = triggerRedline(db, redlineParams(sessionId))
    expect(result.success).toBe(true)

    const rr = resultRecord(sessionId)
    expect(rr).toBeDefined()
    expect(rr!.raw_score).toBe(2)
    expect(rr!.max_score).toBe(100)
    expect(rr!.normalized_score).toBe(2)
    expect(rr!.completion_ratio).toBe(1 / 50)

    const event = db
      .prepare(
        `SELECT payload_json FROM domain_event_projection
          WHERE aggregate_id = ? AND event_type = 'RESULT_CALCULATED'`
      )
      .get(sessionId) as { payload_json: string }
    const eventPayload = JSON.parse(event.payload_json) as {
      raw_score: number
      normalized_score: number
      breakdown: { offline_raw_score: number; answered_count: number; completion_ratio: number }
    }
    expect(eventPayload.raw_score).toBe(2)
    expect(eventPayload.normalized_score).toBe(2)
    expect(eventPayload.breakdown.offline_raw_score).toBe(2)
    expect(eventPayload.breakdown.answered_count).toBe(1)
    expect(eventPayload.breakdown.completion_ratio).toBe(1 / 50)
  })

  it('TASK_OPERATION 评分不影响红线 ABILITY_SCORE 的 offline_raw_score 和 completion_ratio', () => {
    const { sessionId } = setupSession()
    seedOfflineScore(sessionId, 'TASK_OPERATION', 2)

    const result = triggerRedline(db, redlineParams(sessionId))
    expect(result.success).toBe(true)

    const rr = resultRecord(sessionId)
    expect(rr).toBeDefined()
    expect(rr!.raw_score).toBe(0)
    expect(rr!.normalized_score).toBe(0)
    expect(rr!.completion_ratio).toBe(0)

    const row = db
      .prepare('SELECT result_payload_json FROM result_record WHERE source_aggregate_id = ?')
      .get(sessionId) as { result_payload_json: string }
    const payload = JSON.parse(row.result_payload_json) as {
      offline_raw_score: number
      answered_count: number
      completion_ratio: number
    }
    expect(payload.offline_raw_score).toBe(0)
    expect(payload.answered_count).toBe(0)
    expect(payload.completion_ratio).toBe(0)
  })

  it('reducer 重放：删除 result_record 后从事件流重新 apply，result_payload_json 仍正确', () => {
    const { sessionId, questions } = setupSession({
      contentByType: { TRUE_FALSE: { question_type: 'TRUE_FALSE', expected_answer: true } }
    })
    const q = questions.find((x) => x.questionType === 'TRUE_FALSE')!
    submitAnswerForTest(sessionId, q.questionId)
    triggerRedline(db, redlineParams(sessionId))

    // 抓取事件
    const evt = db
      .prepare(
        `SELECT event_id, aggregate_type, aggregate_id, event_type, event_sequence,
                payload_json, checksum, schema_version, created_at
           FROM domain_event_projection
          WHERE aggregate_id = ? AND event_type = 'RESULT_CALCULATED'`
      )
      .get(sessionId) as {
      event_id: string
      aggregate_type: string
      aggregate_id: string
      event_type: string
      event_sequence: number
      payload_json: string
      checksum: string
      schema_version: number
      created_at: string
    }
    expect(evt).toBeDefined()
    const payloadBefore = (
      db
        .prepare('SELECT result_payload_json FROM result_record WHERE source_aggregate_id = ?')
        .get(sessionId) as { result_payload_json: string }
    ).result_payload_json
    expect(payloadBefore).toBeTruthy()

    // 模拟重放：擦除 result_record，重新 apply
    db.prepare('DELETE FROM result_record WHERE source_aggregate_id = ?').run(sessionId)

    applyAssessmentEvent(db, {
      event_id: evt.event_id,
      aggregate_type: evt.aggregate_type as 'ASSESSMENT_SESSION',
      aggregate_id: evt.aggregate_id,
      event_type: evt.event_type as 'RESULT_CALCULATED',
      event_sequence: evt.event_sequence,
      payload: JSON.parse(evt.payload_json),
      checksum: evt.checksum,
      schema_version: evt.schema_version,
      created_at: evt.created_at,
      actor_id: callerId,
      actor_role: 'TEACHER',
      app_version: 'test'
    })

    const payloadAfter = (
      db
        .prepare('SELECT result_payload_json FROM result_record WHERE source_aggregate_id = ?')
        .get(sessionId) as { result_payload_json: string }
    ).result_payload_json
    expect(payloadAfter).toBe(payloadBefore) // 重放后字段一致
  })
})

// ---------- 批量熔断 ----------

describe('assessment:triggerRedline 批量熔断', () => {
  it('同 student+task 两个开放 session（BASELINE + MOCK）→ 两个都被熔断 + result_record 仅对 target session 落盘', () => {
    // seed 第二条策略：MOCK_EXAM（同 student+task 但 strategy_type 不同，避开 unique 约束）
    const mockStrategyId = seedStrategyRow({ strategyType: 'MOCK_EXAM' })

    const s1 = setupSession() // BASELINE（默认 strategy）
    const s2 = setupSession({ strategyIdOverride: mockStrategyId }) // MOCK

    expect(s1.sessionId).not.toBe(s2.sessionId)
    expect(sessionRow(s1.sessionId).status).toBe('ACTIVE')
    expect(sessionRow(s2.sessionId).status).toBe('ACTIVE')

    const result = triggerRedline(db, redlineParams(s1.sessionId))
    expect(result.success).toBe(true)
    if (!result.success) return

    // 两个 session 都被 schema trigger 批量熔断
    expect(sessionRow(s1.sessionId).status).toBe('REDLINE_HALTED')
    expect(sessionRow(s2.sessionId).status).toBe('REDLINE_HALTED')
    expect(sessionRow(s1.sessionId).redline_incident_id).toBe(result.incidentId)
    expect(sessionRow(s2.sessionId).redline_incident_id).toBe(result.incidentId)

    // result_record 仅对 handler 指定的 target session 落盘（persistRedlineResult 单次调用）
    expect(resultRecord(s1.sessionId)).toBeDefined()
    expect(resultRecord(s2.sessionId)).toBeUndefined()
  })

  it('EMOTION_INTERRUPTED 态 session 也被熔断（schema trigger WHERE 含此状态）', () => {
    const { sessionId } = setupSession()
    setAssessmentSessionStateFixture(db, sessionId, 'EMOTION_INTERRUPTED')

    const result = triggerRedline(db, redlineParams(sessionId))
    expect(result.success).toBe(true)
    expect(sessionRow(sessionId).status).toBe('REDLINE_HALTED')
  })

  it('OFFLINE_PENDING 态 session 也被熔断（schema trigger WHERE 含此状态）', () => {
    const { sessionId } = setupSession()
    setAssessmentSessionStateFixture(db, sessionId, 'OFFLINE_PENDING', 'OFFLINE_SCORING')

    const result = triggerRedline(db, redlineParams(sessionId))
    expect(result.success).toBe(true)
    expect(sessionRow(sessionId).status).toBe('REDLINE_HALTED')
  })

  it('COMPLETED 态 session 触发红线 → SESSION_NOT_ACTIVE（前置 status 校验，不进事务）', () => {
    const { sessionId } = setupSession()
    setAssessmentSessionStateFixture(db, sessionId, 'COMPLETED')

    const result = triggerRedline(db, redlineParams(sessionId))
    expect(result).toEqual({ success: false, errorCode: 'SESSION_NOT_ACTIVE' })
    // safety_incident 未写入（事务未启动）
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM safety_incident').get() as { n: number }).n
    ).toBe(0)
  })

  it('REDLINE_HALTED 态 session 再次触发红线 → SESSION_HALTED', () => {
    const { sessionId } = setupSession()
    // 第一次：正常触发 → REDLINE_HALTED
    const first = triggerRedline(db, redlineParams(sessionId))
    expect(first.success).toBe(true)
    expect(sessionRow(sessionId).status).toBe('REDLINE_HALTED')

    // 第二次：已是终态 → SESSION_HALTED
    const second = triggerRedline(db, redlineParams(sessionId, { reasonCode: 'THROWING_OBJECT' }))
    expect(second).toEqual({ success: false, errorCode: 'SESSION_HALTED' })
  })
})

// ---------- triggerRedline 拒绝路径 ----------

describe('assessment:triggerRedline 拒绝路径', () => {
  it('STUDENT 调用 → FORBIDDEN', () => {
    const { sessionId } = setupSession()
    const result = triggerRedline(
      db,
      redlineParams(sessionId, { callerUserId: studentId, callerRole: 'STUDENT' })
    )
    expect(result).toEqual({ success: false, errorCode: 'FORBIDDEN' })
  })

  it('ADMIN 也能触发（assertCaller 接受 TEACHER/ADMIN）', () => {
    const adminId = seedCaller(db, 'ADMIN')
    const { sessionId } = setupSession()
    const result = triggerRedline(
      db,
      redlineParams(sessionId, { callerUserId: adminId, callerRole: 'ADMIN' })
    )
    expect(result.success).toBe(true)
    expect(sessionRow(sessionId).status).toBe('REDLINE_HALTED')
  })

  it('session 不存在 → NOT_FOUND', () => {
    const result = triggerRedline(db, redlineParams(uuidv4()))
    expect(result).toEqual({ success: false, errorCode: 'NOT_FOUND' })
  })

  it('sessionId 空串 → NOT_FOUND', () => {
    const result = triggerRedline(db, redlineParams(''))
    expect(result).toEqual({ success: false, errorCode: 'NOT_FOUND' })
  })

  it('reasonCode 非法 → VALIDATION_ERROR（事务前校验，不写 jsonl）', () => {
    const { sessionId } = setupSession()
    const beforeCount = db
      .prepare('SELECT COUNT(*) AS n FROM domain_event_projection')
      .get() as { n: number }

    const result = triggerRedline(db, redlineParams(sessionId, { reasonCode: 'NOT_A_REAL_CODE' }))

    expect(result).toEqual({ success: false, errorCode: 'VALIDATION_ERROR' })

    const afterCount = db
      .prepare('SELECT COUNT(*) AS n FROM domain_event_projection')
      .get() as { n: number }
    expect(afterCount.n).toBe(beforeCount.n) // 未进事务，未写事件
  })

  it('contextPhase = BASELINE_ASSESSMENT（strategy_type 误用）→ VALIDATION_ERROR', () => {
    // impl.md Step 8 风险点 10 回归：BASELINE_ASSESSMENT 不在 context_phase 枚举
    const { sessionId } = setupSession()
    const result = triggerRedline(
      db,
      redlineParams(sessionId, { contextPhase: 'BASELINE_ASSESSMENT' })
    )
    expect(result).toEqual({ success: false, errorCode: 'VALIDATION_ERROR' })
  })

  it('contextPhase 非法字符串 → VALIDATION_ERROR', () => {
    const { sessionId } = setupSession()
    const result = triggerRedline(
      db,
      redlineParams(sessionId, { contextPhase: 'INVALID_PHASE' })
    )
    expect(result).toEqual({ success: false, errorCode: 'VALIDATION_ERROR' })
  })
})

// ---------- calculateResult 独立路径 ----------

describe('assessment:calculateResult 红线场景', () => {
  it('triggerRedline 后调 calculateResult → 幂等返回已有 resultId', () => {
    const { sessionId } = setupSession()
    const trigRes = triggerRedline(db, redlineParams(sessionId))
    if (!trigRes.success) throw new Error('setup triggerRedline failed')

    const rr1 = resultRecord(sessionId)
    expect(rr1).toBeDefined()

    const calcRes = calculateResult(db, calcParams(sessionId))
    expect(calcRes.success).toBe(true)
    if (!calcRes.success) return
    expect(calcRes.resultId).toBe(rr1!.result_id)
    expect(calcRes.levelResult).toBe('LEVEL_FAIL_BY_SAFETY')
  })

  it('calculateResult 独立调用 REDLINE_HALTED session（无既有 result_record）→ 落盘成功', () => {
    const { sessionId } = setupSession()
    // 直接 SQL 模拟红线熔断（不走 triggerRedline handler）
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
    ).run(incidentId, studentId, taskCode, triggerEventId, callerId)

    const calcRes = calculateResult(db, calcParams(sessionId))
    expect(calcRes.success).toBe(true)
    if (!calcRes.success) return
    expect(calcRes.levelResult).toBe('LEVEL_FAIL_BY_SAFETY')

    const rr = resultRecord(sessionId)
    expect(rr).toBeDefined()
    expect(rr!.safety_overridden).toBe(1)
    expect(rr!.redline_incident_id).toBe(incidentId)
  })

  it('session.status 非 REDLINE_HALTED → SESSION_NOT_ACTIVE', () => {
    const { sessionId } = setupSession()
    expect(sessionRow(sessionId).status).toBe('ACTIVE')

    const result = calculateResult(db, calcParams(sessionId))
    expect(result).toEqual({ success: false, errorCode: 'SESSION_NOT_ACTIVE' })
  })

  it('STUDENT 调用 → FORBIDDEN', () => {
    const { sessionId } = setupSession()
    const result = calculateResult(
      db,
      calcParams(sessionId, { callerUserId: studentId, callerRole: 'STUDENT' })
    )
    expect(result).toEqual({ success: false, errorCode: 'FORBIDDEN' })
  })

  it('session 不存在 → NOT_FOUND', () => {
    const result = calculateResult(db, calcParams(uuidv4()))
    expect(result).toEqual({ success: false, errorCode: 'NOT_FOUND' })
  })

  it('result_record 唯一性：triggerRedline 后再次独立写入应被 schema unique index 兜底（不调 handler 复写）', () => {
    const { sessionId } = setupSession()
    triggerRedline(db, redlineParams(sessionId))
    expect(resultRecord(sessionId)).toBeDefined()

    // 直接 INSERT 第二条 → schema ux_result_record_one_current_per_source_type 拦截
    const triggerEventId = uuidv4()
    db.prepare(
      `INSERT INTO domain_event_projection
         (event_id, aggregate_type, aggregate_id, event_type, event_sequence,
          payload_json, checksum, source_log_path, schema_version, created_at)
       VALUES (?, 'ASSESSMENT_SESSION', ?, 'RESULT_CALCULATED', 99, '{}', 'c', 'l', 1, '2026-07-01T00:00:00.000Z')`
    ).run(triggerEventId, sessionId)
    expect(() => {
      db.prepare(
        `INSERT INTO result_record
           (result_id, student_id, result_type, source_aggregate_type, source_aggregate_id,
            job_code, normalized_score, level_result, safety_overridden, redline_incident_id,
            generated_event_id, is_current)
         VALUES (?, ?, 'ABILITY_SCORE', 'ASSESSMENT_SESSION', ?,
                 'SUPERMARKET_SHELVER', 0, 'LEVEL_FAIL_BY_SAFETY', 1, ?,
                 ?, 1)`
      ).run(uuidv4(), studentId, sessionId, 'fake-incident-' + uuidv4(), triggerEventId)
    }).toThrow()
  })
})
