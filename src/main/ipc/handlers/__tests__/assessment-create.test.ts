// assessment:createSession 集成测试：直接调 createSession 纯函数，注入 MemoryAdapter。
// 覆盖 impl.md Step 6b 测试用例。
//
// [!] writeEvent mock：writeEvent 内部调 getDatabase()（better-sqlite3 singleton）+
// app.getPath('userData')（Electron context），在 vitest + MemoryAdapter 环境下不可用。
// assessment 是首个写领域事件的 handler，用 vi.mock 替换 event-writer：mock 内构造
// ActionLogEntry + INSERT domain_event_projection（reducer 的 FK 依赖 event_id 存在）+
// 不写 jsonl（测试不验证 fs 副作用，event-writer 自身的测试覆盖那部分）。

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { v4 as uuidv4 } from 'uuid'

// vi.hoisted 提升 mockState 到顶部，使 vi.mock 工厂能引用。
// mockState.db 在 beforeEach 注入当前测试 db。
const { mockState } = vi.hoisted(() => ({
  mockState: { db: null as unknown as import('../../../db/interface').DBAdapter }
}))

vi.mock('../../../domain/event-writer', () => ({
  writeEvent: vi.fn(
    // 类型从 event-writer 导入（type-only import 不受 vi.mock 影响）。
    (params: import('../../../domain/event-writer').WriteEventParams): import('@shared/types/event-payloads').ActionLogEntry => {
      if (!mockState.db) {
        throw new Error('mock writeEvent: mockState.db not set; call in beforeEach')
      }
      const eventId = uuidv4()
      const entry: import('@shared/types/event-payloads').ActionLogEntry = {
        event_id: eventId,
        aggregate_type: params.aggregateType,
        aggregate_id: params.aggregateId,
        event_type: params.eventType,
        // createSession 每个 aggregate 只写一个事件，event_sequence=1 总是正确。
        event_sequence: 1,
        payload: params.payload,
        checksum: 'test-checksum',
        schema_version: 1,
        created_at: new Date().toISOString(),
        actor_id: params.actorId,
        actor_role: params.actorRole,
        app_version: 'test'
      }
      // 模拟 writeEvent 的 domain_event_projection INSERT（reducer INSERT 依赖 FK）。
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

import { createSession, seedAssessmentErrorCodes } from '../assessment'
import {
  createTestDb,
  seedCaller,
  seedStudent,
  seedQuestionBank,
  baseStrategyInput
} from '../../../db/test-helpers'
import type { MemoryAdapter } from '../../../db/memory-adapter'
import type { StrategyInput } from '../../../../shared/types/strategy'
import type { CreateSessionParams } from '../../../../shared/types/assessment'

let db: MemoryAdapter
let callerId: string
let studentId: string
let strategyId: string

const taskCode = 'SHELVE_TASK'
const strategyVersion = 1

/** 直接 INSERT 一条 strategy_config（绕过 handler），供 createSession 前置读取。 */
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

/** 直接 INSERT 一条 PENDING_DETAIL + requires_review 的 safety_incident（绕过 handler）。 */
function seedBlockingSafetyIncident(student: string, jobCode = 'SUPERMARKET_SHELVER'): string {
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
       VALUES (?, ?, ?, ?, ?, 'BLADE_TOWARD_SELF', ?, 'ONLINE_ASSESSMENT', 'PENDING_DETAIL', 1)`
  ).run(incidentId, student, jobCode, taskCode, triggerEventId, callerId)
  return incidentId
}

function baseParams(over: Partial<CreateSessionParams> = {}): CreateSessionParams {
  return {
    callerUserId: callerId,
    callerRole: 'TEACHER',
    studentId,
    strategyId,
    strategyVersion,
    taskCode,
    ...over
  }
}

beforeAll(async () => {
  db = await createTestDb()
  // 本文件不验证 no-delete 触发器（createSession 不测删除路径）；
  // drop 后 beforeEach 可清 assessment_session，避免跨用例行累积。
  // 生产 schema 不受影响——其他测试文件各自 createTestDb 加载完整 schema。
  db.exec('DROP TRIGGER IF EXISTS trg_assessment_session_no_delete')
})

afterAll(() => {
  db.close()
})

beforeEach(() => {
  // FK-safe 清表顺序：业务表 → events → 配置/档案 → 账号
  db.exec('DELETE FROM assessment_session_question')
  db.exec('DELETE FROM assessment_session')
  db.exec('DELETE FROM business_session')
  db.exec('DELETE FROM safety_incident_binding')
  db.exec('DELETE FROM safety_incident')
  db.exec('DELETE FROM answer_record')
  db.exec('DELETE FROM result_record')
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
  seedQuestionBank(db)
  mockState.db = db
})

// ---------- 正常路径 ----------

describe('assessment:createSession 正常路径', () => {
  it('返回 sessionId + 42 ONLINE 题 + 落 assessment_session(50 question)', () => {
    const result = createSession(db, baseParams())

    expect(result.success).toBe(true)
    if (!result.success) return // 类型收窄
    const { sessionId, questions } = result

    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/)
    // 仅返回 ONLINE 题（42 道）；OFFLINE 由线下评分流程处理
    expect(questions).toHaveLength(42)
    expect(questions.every((q) => q.questionPhase === 'ONLINE')).toBe(true)
    // question_order 连续 1..42
    const orders = questions.map((q) => q.questionOrder).sort((a, b) => a - b)
    expect(orders[0]).toBe(1)
    expect(orders[orders.length - 1]).toBe(42)

    expect(result.businessSessionId).toBe(sessionId)

    // assessment_session 行：status=INIT + PREPARED（startSession 再推进 ACTIVE）
    const sess = db
      .prepare('SELECT * FROM assessment_session WHERE session_id = ?')
      .get(sessionId) as
      | {
          business_session_id: string
          status: string
          delivery_phase: string
          event_sequence_version: number
          online_question_count: number
          offline_question_count: number
          strategy_type: string
          job_code: string
          task_code: string
          created_event_id: string
          started_at: string | null
        }
      | undefined
    expect(sess).toBeDefined()
    expect(sess!.business_session_id).toBe(sessionId)
    expect(sess!.status).toBe('INIT')
    expect(sess!.delivery_phase).toBe('PREPARED')
    expect(sess!.event_sequence_version).toBe(1)
    expect(sess!.online_question_count).toBe(42)
    expect(sess!.offline_question_count).toBe(8)
    expect(sess!.strategy_type).toBe('BASELINE_ASSESSMENT')
    expect(sess!.job_code).toBe('SUPERMARKET_SHELVER')
    expect(sess!.task_code).toBe(taskCode)
    expect(sess!.created_event_id).not.toBeNull()
    expect(sess!.started_at).toBeNull()

    const parent = db
      .prepare('SELECT session_type, student_id, job_code, task_code FROM business_session WHERE business_session_id = ?')
      .get(sessionId) as
      | { session_type: string; student_id: string; job_code: string; task_code: string }
      | undefined
    expect(parent).toEqual({
      session_type: 'ASSESSMENT',
      student_id: studentId,
      job_code: 'SUPERMARKET_SHELVER',
      task_code: taskCode
    })

    // 50 行 assessment_session_question（42 ONLINE + 8 OFFLINE）
    const sqCount = db
      .prepare(
        `SELECT
           SUM(CASE WHEN question_phase = 'ONLINE' THEN 1 ELSE 0 END) AS online,
           SUM(CASE WHEN question_phase = 'OFFLINE' THEN 1 ELSE 0 END) AS offline,
           COUNT(*) AS total
         FROM assessment_session_question WHERE session_id = ?`
      )
      .get(sessionId) as { online: number; offline: number; total: number }
    expect(sqCount.online).toBe(42)
    expect(sqCount.offline).toBe(8)
    expect(sqCount.total).toBe(50)

    // SESSION_STARTED 事件落 domain_event_projection（mock writeEvent 写入）
    const evt = db
      .prepare(
        `SELECT * FROM domain_event_projection
          WHERE aggregate_id = ? AND event_type = 'SESSION_STARTED'`
      )
      .get(sessionId) as { event_type: string } | undefined
    expect(evt).toBeDefined()
    expect(evt!.event_type).toBe('SESSION_STARTED')

    // SESSION_CREATED 审计行（INFO，recovery_status=IGNORED）
    const audit = db
      .prepare(
        `SELECT * FROM error_event_log
          WHERE error_code = 'SESSION_CREATED' AND related_aggregate_id = ?`
      )
      .get(sessionId) as { recovery_status: string } | undefined
    expect(audit).toBeDefined()
    expect(audit!.recovery_status).toBe('IGNORED')
  })

  it('MOCK_EXAM 策略也走正常路径', () => {
    // 先清掉 BASELINE strategy_config，再插 MOCK_EXAM
    db.exec('DELETE FROM strategy_config')
    seedStrategyRow({ strategyType: 'MOCK_EXAM' })

    const result = createSession(db, baseParams())
    expect(result.success).toBe(true)
  })
})

describe('assessment:createSession M4 job 作用域', () => {
  const otherJobCode = 'WAREHOUSE_PICKER'

  it('同 student/task 的不同 job 可并存；同 job 的重复开放仍拒绝', () => {
    const firstStrategyId = strategyId
    seedStrategyRow({ jobCode: otherJobCode })
    const otherStrategyId = strategyId
    seedQuestionBank(db, { jobCode: otherJobCode })

    expect(createSession(db, baseParams({ strategyId: firstStrategyId })).success).toBe(true)
    expect(createSession(db, baseParams({ strategyId: otherStrategyId })).success).toBe(true)

    expect(createSession(db, baseParams({ strategyId: otherStrategyId }))).toEqual({
      success: false,
      errorCode: 'SESSION_ALREADY_OPEN'
    })
  })

  it('其他 job 的安全事件不阻断当前 strategy job', () => {
    seedBlockingSafetyIncident(studentId)
    seedStrategyRow({ jobCode: otherJobCode })
    const otherStrategyId = strategyId
    seedQuestionBank(db, { jobCode: otherJobCode })

    expect(createSession(db, baseParams({ strategyId: otherStrategyId })).success).toBe(true)
  })
})

// ---------- 身份校验 ----------

describe('assessment:createSession 身份校验', () => {
  it('STUDENT 调用 → FORBIDDEN', () => {
    const result = createSession(db, baseParams({ callerRole: 'STUDENT' }))
    expect(result).toEqual({ success: false, errorCode: 'FORBIDDEN' })
  })

  it('DISABLED TEACHER 调用 → FORBIDDEN', () => {
    const disabled = seedCaller(db, 'TEACHER') // 先拿到 ACTIVE callerId（beforeEach 已给）
    // 用 disabled 账号
    db.prepare('UPDATE user_account SET status = ? WHERE user_id = ?').run('DISABLED', disabled)
    const result = createSession(db, baseParams({ callerUserId: disabled }))
    expect(result).toEqual({ success: false, errorCode: 'FORBIDDEN' })
  })
})

// ---------- 参数 / 策略校验 ----------

describe('assessment:createSession 参数与策略校验', () => {
  it('studentId 不存在 → NOT_FOUND', () => {
    const result = createSession(db, baseParams({ studentId: uuidv4() }))
    expect(result).toEqual({ success: false, errorCode: 'NOT_FOUND' })
  })

  it('strategyId 不存在 → NOT_FOUND', () => {
    const result = createSession(db, baseParams({ strategyId: 'nonexistent-strategy' }))
    expect(result).toEqual({ success: false, errorCode: 'NOT_FOUND' })
  })

  it('strategyVersion 不存在 → NOT_FOUND', () => {
    const result = createSession(db, baseParams({ strategyVersion: 999 }))
    expect(result).toEqual({ success: false, errorCode: 'NOT_FOUND' })
  })

  it('strategy_type=TRAINING_PRACTICE → VALIDATION_ERROR', () => {
    db.exec('DELETE FROM strategy_config')
    seedStrategyRow({ strategyType: 'TRAINING_PRACTICE' })
    const result = createSession(db, baseParams())
    expect(result).toEqual({ success: false, errorCode: 'VALIDATION_ERROR' })
  })

  it('taskCode 空字符串 → VALIDATION_ERROR', () => {
    const result = createSession(db, baseParams({ taskCode: '   ' }))
    expect(result).toEqual({ success: false, errorCode: 'VALIDATION_ERROR' })
  })
})

// ---------- 业务规则校验 ----------

describe('assessment:createSession 业务规则校验', () => {
  it('重复开放 session（同 student+task+strategy_type）→ SESSION_ALREADY_OPEN', () => {
    // 第一次创建成功
    const first = createSession(db, baseParams())
    expect(first.success).toBe(true)

    // 第二次（同 student+task+strategy_type）→ SESSION_ALREADY_OPEN
    // 用新 strategyId 但同 strategy_type（BASELINE_ASSESSMENT）也命中
    const result = createSession(db, baseParams())
    expect(result).toEqual({ success: false, errorCode: 'SESSION_ALREADY_OPEN' })
  })

  it('同 student 不同 task 不冲突（不同 task 可并行）', () => {
    const first = createSession(db, baseParams({ taskCode: 'TASK_A' }))
    expect(first.success).toBe(true)
    const second = createSession(db, baseParams({ taskCode: 'TASK_B' }))
    expect(second.success).toBe(true)
  })

  it('未解决安全事件（PENDING_DETAIL + requires_review=1）→ BLOCKED_BY_SAFETY_INCIDENT', () => {
    seedBlockingSafetyIncident(studentId)
    const result = createSession(db, baseParams())
    expect(result).toEqual({ success: false, errorCode: 'BLOCKED_BY_SAFETY_INCIDENT' })

    // 无 session 行被创建（handler 前置 SELECT 拦截，未进事务）
    const sessCount = db
      .prepare('SELECT COUNT(*) AS n FROM assessment_session')
      .get() as { n: number }
    expect(sessCount.n).toBe(0)
  })

  // [!] "已解决 safety_incident 不阻断" 边界测试推迟到 Step 8 红线 handler：
  // schema safety_incident FSM（PENDING_DETAIL → CONFIRMED → RESOLVED）+ 终态字段约束
  // （resolved_by active ADMIN + resolved_at）由 Step 8 完整实现，本步不构造非法跳转。

  it('题库为空 → QUESTION_BANK_INSUFFICIENT（写审计 + 不创建 session）', () => {
    db.exec("DELETE FROM question_bank WHERE job_code = 'SUPERMARKET_SHELVER'")

    const result = createSession(db, baseParams())
    expect(result).toEqual({ success: false, errorCode: 'QUESTION_BANK_INSUFFICIENT' })

    // 无 session 行
    const sessCount = db
      .prepare('SELECT COUNT(*) AS n FROM assessment_session')
      .get() as { n: number }
    expect(sessCount.n).toBe(0)

    // QUESTION_BANK_INSUFFICIENT 审计行（ERROR，recovery_status=UNRESOLVED）
    const audit = db
      .prepare(
        `SELECT * FROM error_event_log WHERE error_code = 'QUESTION_BANK_INSUFFICIENT'`
      )
      .get() as { recovery_status: string } | undefined
    expect(audit).toBeDefined()
    expect(audit!.recovery_status).toBe('UNRESOLVED')
  })

  it('题库不足（某模块题数 < quota）→ QUESTION_BANK_INSUFFICIENT', () => {
    // 删掉 FINE_MOTOR 的 TRUE_FALSE 题（42/6=7 道/模块，TF 占 7*14/42≈2-3 道）
    // baseStrategyInput ratio 14:14:14 → 每模块 7 题按 ratio 分：TF=2/3, SC=2/3, DRAG=2/3
    // 删掉 FINE_MOTOR 所有 TF（剩 0 < 需求 2-3）→ QUESTION_BANK_INSUFFICIENT
    db.exec(
      "DELETE FROM question_bank WHERE module_type = 'FINE_MOTOR' AND question_type = 'TRUE_FALSE'"
    )
    const result = createSession(db, baseParams())
    expect(result).toEqual({ success: false, errorCode: 'QUESTION_BANK_INSUFFICIENT' })
  })
})
