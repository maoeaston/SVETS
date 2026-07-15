// assessment:getSession + listSessions 集成测试：直接调纯函数，注入 MemoryAdapter。
// 覆盖 impl.md Step 9a 读路径测试用例。
//
// [!] getSession / listSessions 是纯读，不写事件，但 setupSession 调 createSession
// + startSession 会写事件，故仍 vi.mock event-writer（与 assessment-answer.test.ts 同模式，MAX+1 sequence）。
//
// [!] 脱敏验证：currentQuestion 必须不含 expected_answer / is_correct / variants[*].expected_answer。
// 这是 Step 9a 的安全契约，专测用 expect(...).toBeUndefined() 断言"字段不存在"。
//
// [!] seedSession 直接 INSERT assessment_session（绕过 createSession 组卷流程），
// 用于测终态 / INIT / 特定 status。schema ux_assessment_one_open_session_per_student_task_strategy
// 仅约束开放态，故同学生可同时有 1 ACTIVE + 多个 COMPLETED/ABORTED。

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

import { createSession, startSession, getSession, listSessions, seedAssessmentErrorCodes } from '../assessment'
import {
  createTestDb,
  seedCaller,
  seedStudent,
  seedQuestionBankDraft,
  baseStrategyInput,
  seedAssessmentSessionFixture,
  type AssessmentFixtureStatus
} from '../../../db/test-helpers'
import type { MemoryAdapter } from '../../../db/memory-adapter'
import type { StrategyInput } from '../../../../shared/types/strategy'
import type {
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

type OnlineQuestionType = 'TRUE_FALSE' | 'SINGLE_CHOICE' | 'DRAG'
type QuestionContentFixture = Record<string, unknown> | string

function seedContentJsonByType(questionType: OnlineQuestionType, content: QuestionContentFixture): void {
  db.prepare('UPDATE question_bank SET content_json = ? WHERE question_type = ?').run(
    typeof content === 'string' ? content : JSON.stringify(content),
    questionType
  )
}

interface SetupResult {
  sessionId: string
  questions: SessionQuestionView[]
}

function setupSession(
  student: string = studentId,
  contentByType: Partial<Record<OnlineQuestionType, QuestionContentFixture>> = {}
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

function pickQuestion(
  qs: SessionQuestionView[],
  type: 'TRUE_FALSE' | 'SINGLE_CHOICE' | 'DRAG'
): SessionQuestionView {
  const q = qs.find((x) => x.questionType === type)
  if (!q) throw new Error(`no ONLINE question of type ${type} in session`)
  return q
}

/**
 * UPDATE assessment_session.current_question_id。
 * 部分 getSession 测试需要指定题型，故显式 SET 以验证 currentQuestion 解析路径。
 */
function setCurrentQuestion(sessionId: string, questionId: string | null): void {
  db.prepare('UPDATE assessment_session SET current_question_id = ? WHERE session_id = ?').run(
    questionId,
    sessionId
  )
}

/**
 * 直接 INSERT assessment_session（绕过 createSession 组卷流程）。
 * 默认 BASELINE_ASSESSMENT / SUPERMARKET_SHELVER / SHELVE_TASK / studentId。
 * 终态（COMPLETED / ABORTED）不进 ux 开放态索引，故同学生可并存多个。
 */
function seedSessionDirect(over: {
  studentId?: string
  status?: AssessmentFixtureStatus
  currentQuestionId?: string | null
  onlineQuestionCount?: number
  offlineQuestionCount?: number
  strategyType?: string
}): string {
  const stud = over.studentId ?? studentId
  const strategyType = over.strategyType ?? 'BASELINE_ASSESSMENT'
  return seedAssessmentSessionFixture(db, {
    studentId: stud,
    strategyId,
    strategyType,
    jobCode: 'SUPERMARKET_SHELVER',
    taskCode,
    strategyVersion,
    status: over.status ?? 'COMPLETED',
    onlineQuestionCount: over.onlineQuestionCount,
    offlineQuestionCount: over.offlineQuestionCount,
    currentQuestionId: over.currentQuestionId,
    createdBy: callerId
  })
}

/**
 * INSERT 一条 safety_incident(PENDING_DETAIL) 触发批量熔断：
 * 同 student+task 开放态 assessment_session → REDLINE_HALTED + redline_incident_id。
 */
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
  // 同 assessment-answer.test.ts / assessment-redline.test.ts：DROP no_delete 以允许
  // beforeEach 清表（生产 schema 不受影响；测试需要清表隔离每个 it）。
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

// 将对象强转为 Record 以便断言"字段不存在"（脱敏验证专用）。
function asRecord(obj: unknown): Record<string, unknown> {
  return obj as Record<string, unknown>
}

// ============================================================================
// getSession
// ============================================================================

describe('assessment:getSession 脱敏与字段映射', () => {
  it('TRUE_FALSE + variants → success，currentQuestion 无 expected_answer，variants[*] 也无 expected_answer', () => {
    const { sessionId, questions } = setupSession(studentId, {
      TRUE_FALSE: {
        question_type: 'TRUE_FALSE',
        prompt: '图中同学的理货方式是否正确？',
        assessment_point: '货架正面朝外识别',
        ability_tags: ['COGNITION'],
        expected_answer: true,
        variants: [
          {
            variant_id: 'v_correct',
            media_asset_id: 'asset_img_correct_v001',
            media_brief: '正面朝外',
            expected_answer: true
          },
          {
            variant_id: 'v_wrong',
            media_asset_id: 'asset_img_wrong_v001',
            media_brief: '歪斜',
            expected_answer: false
          }
        ]
      }
    })
    const q = pickQuestion(questions, 'TRUE_FALSE')
    setCurrentQuestion(sessionId, q.questionId)

    const result = getSession(db, {
      callerUserId: studentId,
      callerRole: 'STUDENT',
      sessionId
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.session.sessionId).toBe(sessionId)
    expect(result.session.status).toBe('ACTIVE')
    expect(result.currentQuestion).not.toBeNull()

    const cq = result.currentQuestion!
    expect(cq.questionId).toBe(q.questionId)
    expect(cq.questionType).toBe('TRUE_FALSE')
    expect(cq.moduleType).toBe(q.moduleType)
    expect(cq.questionOrder).toBe(q.questionOrder)
    expect(cq.questionPhase).toBe('ONLINE')
    expect(cq.prompt).toBe('图中同学的理货方式是否正确？')
    expect(cq.assessmentPoint).toBe('货架正面朝外识别')

    // [!] 脱敏：currentQuestion 顶层无 expected_answer
    expect(asRecord(cq).expected_answer).toBeUndefined()

    // variants 存在且每条都有 variantId/mediaAssetId/mediaBrief
    expect(cq.variants).toHaveLength(2)
    expect(cq.variants![0]).toEqual({
      variantId: 'v_correct',
      mediaAssetId: 'asset_img_correct_v001',
      mediaBrief: '正面朝外'
    })
    // [!] 脱敏：variants[*] 无 expected_answer
    expect(asRecord(cq.variants![0]).expected_answer).toBeUndefined()
    expect(asRecord(cq.variants![1]).expected_answer).toBeUndefined()
  })

  it('SINGLE_CHOICE → options[*] 含 key/text，无 is_correct', () => {
    const { sessionId, questions } = setupSession(studentId, {
      SINGLE_CHOICE: {
        question_type: 'SINGLE_CHOICE',
        prompt: '以下哪种做法正确？',
        assessment_point: '上架流程',
        options: [
          { key: 'A', text: '轻拿轻放', is_correct: false },
          { key: 'B', text: '抛掷商品', is_correct: true },
          { key: 'C', text: '踩踏货架', is_correct: false }
        ],
        expected_answer: 'B'
      }
    })
    const q = pickQuestion(questions, 'SINGLE_CHOICE')
    setCurrentQuestion(sessionId, q.questionId)

    const result = getSession(db, {
      callerUserId: studentId,
      callerRole: 'STUDENT',
      sessionId
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    const cq = result.currentQuestion!
    expect(cq.options).toHaveLength(3)
    expect(cq.options![0]).toEqual({ key: 'A', text: '轻拿轻放', imageAssetId: null })
    expect(cq.options![1]).toEqual({ key: 'B', text: '抛掷商品', imageAssetId: null })
    // [!] 脱敏：options[*] 无 is_correct / expected_answer
    expect(asRecord(cq.options![0]).is_correct).toBeUndefined()
    expect(asRecord(cq.options![1]).is_correct).toBeUndefined()
    expect(asRecord(cq).expected_answer).toBeUndefined()
  })

  it('DRAG → dragItems / dropZones / scoringMode 正确映射', () => {
    const { sessionId, questions } = setupSession(studentId, {
      DRAG: {
        question_type: 'DRAG',
        prompt: '将商品拖到正确货架区',
        assessment_point: '商品分类',
        drag_items: [
          { item_id: 'd1', label: '苹果' },
          { item_id: 'd2', label: '面包' }
        ],
        drop_zones: [
          { zone_id: 'z1', label: '生鲜区', accepts: ['d1'] },
          { zone_id: 'z2', label: '主食区', accepts: ['d2'] }
        ],
        scoring_mode: 'PARTIAL_CREDIT'
      }
    })
    const q = pickQuestion(questions, 'DRAG')
    setCurrentQuestion(sessionId, q.questionId)

    const result = getSession(db, {
      callerUserId: studentId,
      callerRole: 'STUDENT',
      sessionId
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    const cq = result.currentQuestion!
    expect(cq.dragItems).toEqual([
      { itemId: 'd1', label: '苹果', imageAssetId: null },
      { itemId: 'd2', label: '面包', imageAssetId: null }
    ])
    expect(cq.dropZones).toEqual([
      { zoneId: 'z1', label: '生鲜区' },
      { zoneId: 'z2', label: '主食区' }
    ])
    expect(cq.scoringMode).toBe('PARTIAL_CREDIT')
    // [!] dropZones 不含 accepts（脱敏：accepts 暴露答案映射）
    expect(asRecord(cq.dropZones![0]).accepts).toBeUndefined()
  })

  it('TRUE_FALSE 无 variants 字段 → currentQuestion.variants = undefined（不抛错）', () => {
    const { sessionId, questions } = setupSession(studentId, {
      TRUE_FALSE: {
        question_type: 'TRUE_FALSE',
        prompt: '简单判断',
        assessment_point: '基础认知',
        expected_answer: false
      }
    })
    const q = pickQuestion(questions, 'TRUE_FALSE')
    setCurrentQuestion(sessionId, q.questionId)

    const result = getSession(db, {
      callerUserId: studentId,
      callerRole: 'STUDENT',
      sessionId
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    const cq = result.currentQuestion!
    expect(cq.questionType).toBe('TRUE_FALSE')
    expect(cq.variants).toBeUndefined()
    expect(asRecord(cq).expected_answer).toBeUndefined()
  })
})

describe('assessment:getSession 权限与边界', () => {
  it('STUDENT 读他人 session → FORBIDDEN', () => {
    const other = seedStudent(db, { studentName: '他人' })
    const { sessionId } = setupSession(other)

    const result = getSession(db, {
      callerUserId: studentId,
      callerRole: 'STUDENT',
      sessionId
    })

    expect(result).toEqual({ success: false, errorCode: 'FORBIDDEN' })
  })

  it('STUDENT session 不存在 → NOT_FOUND', () => {
    const result = getSession(db, {
      callerUserId: studentId,
      callerRole: 'STUDENT',
      sessionId: uuidv4()
    })

    expect(result).toEqual({ success: false, errorCode: 'NOT_FOUND' })
  })

  it('TEACHER 读任意学生 session → success（跨学生可读）', () => {
    const other = seedStudent(db, { studentName: '学生乙' })
    const { sessionId } = setupSession(other)

    const result = getSession(db, {
      callerUserId: callerId,
      callerRole: 'TEACHER',
      sessionId
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.session.studentId).toBe(other)
  })

  it('未登录 callerUserId（不存在）→ FORBIDDEN', () => {
    const { sessionId } = setupSession()

    const result = getSession(db, {
      callerUserId: uuidv4(),
      callerRole: 'TEACHER',
      sessionId
    })

    expect(result).toEqual({ success: false, errorCode: 'FORBIDDEN' })
  })

  it('INIT 态（current_question_id = NULL）→ success + currentQuestion = null', () => {
    const sid = seedSessionDirect({ status: 'INIT', currentQuestionId: null })

    const result = getSession(db, {
      callerUserId: callerId,
      callerRole: 'TEACHER',
      sessionId: sid
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.session.status).toBe('INIT')
    expect(result.session.currentQuestionId).toBeNull()
    expect(result.currentQuestion).toBeNull()
  })

  it('REDLINE_HALTED 终态且 current_question_id 非空 → 仍 success + currentQuestion 非空（不做 status 拦截）', () => {
    const { sessionId, questions } = setupSession(studentId, {
      TRUE_FALSE: {
        question_type: 'TRUE_FALSE',
        prompt: 'X',
        assessment_point: 'Y',
        expected_answer: true
      },
      SINGLE_CHOICE: {
        question_type: 'SINGLE_CHOICE',
        prompt: 'X',
        assessment_point: 'Y',
        options: [{ key: 'A', text: 'A', is_correct: true }],
        expected_answer: 'A'
      },
      DRAG: {
        question_type: 'DRAG',
        prompt: 'X',
        assessment_point: 'Y',
        drag_items: [{ item_id: 'd1', label: 'A' }],
        drop_zones: [{ zone_id: 'z1', label: 'A', accepts: ['d1'] }],
        scoring_mode: 'ALL_OR_NOTHING'
      }
    })
    const q = questions[0]
    setCurrentQuestion(sessionId, q.questionId)
    // 触发批量熔断：active session → REDLINE_HALTED + redline_incident_id（schema trigger）
    haltSession(studentId)

    const result = getSession(db, {
      callerUserId: callerId,
      callerRole: 'TEACHER',
      sessionId
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.session.status).toBe('REDLINE_HALTED')
    expect(result.session.redlineIncidentId).not.toBeNull()
    // [!] currentQuestionId 仍指向某题（schema trigger 不清空），currentQuestion 应可解析
    expect(result.currentQuestion).not.toBeNull()
    expect(result.currentQuestion!.questionId).toBe(q.questionId)
  })

  it('content_json 损坏（JSON.parse 失败）→ success + currentQuestion = null（不抛错）', () => {
    const { sessionId, questions } = setupSession(studentId, {
      TRUE_FALSE: '{not valid json',
      SINGLE_CHOICE: '{not valid json',
      DRAG: '{not valid json'
    })
    const q = questions[0]
    setCurrentQuestion(sessionId, q.questionId)

    const result = getSession(db, {
      callerUserId: studentId,
      callerRole: 'STUDENT',
      sessionId
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.currentQuestion).toBeNull()
  })
})

// ============================================================================
// listSessions
// ============================================================================

describe('assessment:listSessions', () => {
  it('TEACHER 调 → 返回多学生非终态 session，不含 COMPLETED / ABORTED', () => {
    const s1 = setupSession() // ACTIVE studentId
    const other = seedStudent(db, { studentName: '学生乙' })
    const s2 = setupSession(other) // ACTIVE other
    // 终态 session 不应出现
    const completedSid = seedSessionDirect({ status: 'COMPLETED' })
    const abortedSid = seedSessionDirect({ status: 'ABORTED' })

    const result = listSessions(db, {
      callerUserId: callerId,
      callerRole: 'TEACHER'
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    const ids = result.items.map((i) => i.sessionId)
    expect(ids).toContain(s1.sessionId)
    expect(ids).toContain(s2.sessionId)
    expect(ids).not.toContain(completedSid)
    expect(ids).not.toContain(abortedSid)
    // 全部是非终态开放态
    const openStatuses = [
      'INIT',
      'ACTIVE',
      'EMOTION_INTERRUPTED',
      'SUSPENDED_REVIEW_REQUIRED',
      'OFFLINE_PENDING'
    ]
    expect(result.items.every((i) => openStatuses.includes(i.status))).toBe(true)
    // 字段映射：studentName JOIN 成功
    const item1 = result.items.find((i) => i.sessionId === s1.sessionId)!
    expect(item1.studentName).toBe('测试学生')
    expect(item1.studentId).toBe(studentId)
    expect(item1.onlineCompletedCount).toBe(0)
    expect(typeof item1.createdAt).toBe('string')
  })

  it('TEACHER + studentId 筛选 → 仅该学生非终态', () => {
    const s1 = setupSession() // studentId ACTIVE
    const other = seedStudent(db, { studentName: '学生乙' })
    const s2 = setupSession(other) // other ACTIVE

    const result = listSessions(db, {
      callerUserId: callerId,
      callerRole: 'TEACHER',
      studentId
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    const ids = result.items.map((i) => i.sessionId)
    expect(ids).toContain(s1.sessionId)
    expect(ids).not.toContain(s2.sessionId)
    expect(result.items.every((i) => i.studentId === studentId)).toBe(true)
  })

  it('STUDENT 调 → FORBIDDEN', () => {
    const result = listSessions(db, {
      callerUserId: studentId,
      callerRole: 'STUDENT'
    })

    expect(result).toEqual({ success: false, errorCode: 'FORBIDDEN' })
  })

  it('同学生混合状态（ACTIVE + COMPLETED + ABORTED）→ 仅 ACTIVE 返回', () => {
    const { sessionId: activeSid } = setupSession() // studentId ACTIVE
    const completedSid = seedSessionDirect({ status: 'COMPLETED' }) // 同 studentId
    const abortedSid = seedSessionDirect({ status: 'ABORTED' }) // 同 studentId

    const result = listSessions(db, {
      callerUserId: callerId,
      callerRole: 'TEACHER',
      studentId
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.items).toHaveLength(1)
    expect(result.items[0].sessionId).toBe(activeSid)
    expect(result.items[0].sessionId).not.toBe(completedSid)
    expect(result.items[0].sessionId).not.toBe(abortedSid)
  })
})
