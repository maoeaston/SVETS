// TC-N01~N12: JOB_SKILL_ASSESSMENT session 固定组卷集成测试。
// 验证 createSession FIXED_SET 路径：固定题集插入 assessment_session_question、
// bank_domain/job_module_code/item_usage/phase 正确、观察项不进 online count、
// 非 ACTIVE 题拒绝创建 session。

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { v4 as uuidv4 } from 'uuid'

const { mockState } = vi.hoisted(() => ({
  mockState: { db: null as unknown as import('../../../db/interface').DBAdapter }
}))

vi.mock('../../../domain/event-writer', () => ({
  writeEvent: vi.fn(
    (params: import('../../../domain/event-writer').WriteEventParams): import('@shared/types/event-payloads').ActionLogEntry => {
      if (!mockState.db) throw new Error('mock writeEvent: mockState.db not set')
      const eventId = uuidv4()
      const row = mockState.db
        .prepare('SELECT MAX(event_sequence) AS max_seq FROM domain_event_projection WHERE aggregate_id = ?')
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
          entry.event_id, entry.aggregate_type, entry.aggregate_id,
          entry.event_type, entry.event_sequence, JSON.stringify(entry.payload),
          entry.checksum, 'test.jsonl', entry.schema_version, entry.created_at
        )
      return entry
    }
  )
}))

import { createSession, startSession, seedAssessmentErrorCodes } from '../assessment'
import { createTestDb, seedCaller, seedStudent } from '../../../db/test-helpers'
import type { MemoryAdapter } from '../../../db/memory-adapter'
import type { CreateSessionParams } from '../../../../shared/types/assessment'

// ─── JOB_SKILL 测试专用 helpers ───────────────────────────────────────────────

/** 6 模块代码 */
const JOB_MODULES = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'] as const
const JOB_ONLINE_TYPES = ['TRUE_FALSE', 'SINGLE_CHOICE', 'DRAG'] as const

/**
 * seed JOB_SPECIFIC 题库：每模块 1 TF + 1 SC + 1 DG（online）+ 1 OFFLINE_OPERATION，
 * 额外 2 道 OBSERVATION_ONLY 题（M1, M5 各一）。
 * 返回 { scoredIds, obsIds, onlineIds, offlineIds }。
 */
function seedJobSkillBank(db: MemoryAdapter): {
  scoredIds: string[]
  obsIds: string[]
  onlineIds: string[]
  offlineIds: string[]
} {
  const onlineIds: string[] = []
  const offlineIds: string[] = []
  const obsIds: string[] = []

  const onlineStmt = db.prepare(
    `INSERT INTO question_bank
       (question_id, job_code, bank_domain, job_module_code, question_type, item_usage,
        content_json, scoring_rule_json, status)
     VALUES (?, 'SUPERMARKET_SHELVER', 'JOB_SPECIFIC', ?, ?, 'SCORED_ITEM',
             '{"seed":true}', '{"seed":true}', 'ACTIVE')`
  )
  const offlineStmt = db.prepare(
    `INSERT INTO question_bank
       (question_id, job_code, bank_domain, job_module_code, question_type, item_usage,
        content_json, scoring_rule_json, status)
     VALUES (?, 'SUPERMARKET_SHELVER', 'JOB_SPECIFIC', ?, 'OFFLINE_OPERATION', 'SCORED_ITEM',
             '{"seed":true}', '{"seed":true}', 'ACTIVE')`
  )
  const obsStmt = db.prepare(
    `INSERT INTO question_bank
       (question_id, job_code, bank_domain, job_module_code, question_type, item_usage,
        content_json, scoring_rule_json, status)
     VALUES (?, 'SUPERMARKET_SHELVER', 'JOB_SPECIFIC', ?, 'TRUE_FALSE', 'OBSERVATION_ONLY',
             '{"seed":true}', '{"seed":true}', 'ACTIVE')`
  )

  for (const mod of JOB_MODULES) {
    for (const qtype of JOB_ONLINE_TYPES) {
      const id = `${mod}_${qtype.slice(0, 2)}_${uuidv4().slice(0, 6)}`
      onlineStmt.run(id, mod, qtype)
      onlineIds.push(id)
    }
    const offId = `${mod}_OP_${uuidv4().slice(0, 6)}`
    offlineStmt.run(offId, mod)
    offlineIds.push(offId)
  }
  // 2 観察項（M1, M5）
  for (const mod of ['M1', 'M5'] as const) {
    const id = `${mod}_OB_${uuidv4().slice(0, 6)}`
    obsStmt.run(id, mod)
    obsIds.push(id)
  }

  return { scoredIds: [...onlineIds, ...offlineIds], obsIds, onlineIds, offlineIds }
}

/** seed JOB_SKILL_ASSESSMENT strategy + 返回 { strategyId, scoredIds, obsIds, onlineIds, offlineIds } */
function seedJobSkillStrategy(
  db: MemoryAdapter,
  bankIds: { scoredIds: string[]; obsIds: string[]; onlineIds: string[]; offlineIds: string[] }
): string {
  const strategyId = `strategy_job_skill_test_${uuidv4().slice(0, 6)}`
  const policy = {
    schema_version: 'question-policy-v1.2',
    bank_domain: 'JOB_SPECIFIC',
    selection_mode: 'FIXED_SET',
    job_module_quotas: Object.fromEntries(JOB_MODULES.map((m) => [m, { online: 3, offline: 1 }])),
    fixed_scored_question_ids: bankIds.scoredIds,
    embedded_observation_question_ids: bankIds.obsIds,
    fallback_strategy: 'BLOCK'
  }
  db.prepare(
    `INSERT INTO strategy_config
       (strategy_id, strategy_type, job_code, strategy_name,
        online_question_count, offline_question_count, max_score,
        competent_threshold, conditional_threshold, module_veto_threshold,
        emotion_collapse_threshold, question_policy_json, scoring_policy_json,
        supports_redline_halt, allows_emotion_interrupt, requires_offline_scoring,
        version, is_active)
     VALUES (?, 'JOB_SKILL_ASSESSMENT', 'SUPERMARKET_SHELVER', 'JOB_SKILL 测试策略',
             18, 6, 48, 40, 24, 0.5, 3, ?,
             '{"schema_version":"scoring-policy-v1.1","online_score_values":[0,2],"offline_score_values":[0,1,2],"normalization":"raw_score/max_score*100","safety_override_enabled":true,"placement_advice_enabled":false}',
             1, 1, 1, 1, 1)`
  ).run(strategyId, JSON.stringify(policy))
  return strategyId
}

// ─── テスト本体 ────────────────────────────────────────────────────────────────

let db: MemoryAdapter
let callerId: string
let studentId: string
let strategyId: string
let bankIds: { scoredIds: string[]; obsIds: string[]; onlineIds: string[]; offlineIds: string[] }
const JOB_TASK_CODE = 'JOB_SKILL_DEMO_M1M6'

function baseParams(over: Partial<CreateSessionParams> = {}): CreateSessionParams {
  return {
    callerUserId: callerId,
    callerRole: 'TEACHER',
    studentId,
    strategyId,
    strategyVersion: 1,
    taskCode: JOB_TASK_CODE,
    ...over
  }
}

function startJobSkillSession(sessionId: string): void {
  const result = startSession(db, {
    callerUserId: studentId,
    callerRole: 'STUDENT',
    sessionId
  })
  if (!result.success) {
    throw new Error(`startJobSkillSession failed: ${JSON.stringify(result)}`)
  }
}

beforeAll(async () => {
  db = await createTestDb()
  db.exec('DROP TRIGGER IF EXISTS trg_assessment_session_no_delete')
})

afterAll(() => {
  db.close()
})

beforeEach(() => {
  db.exec('DELETE FROM assessment_session_question')
  db.exec('DELETE FROM answer_record')
  db.exec('DELETE FROM result_record')          // result_record.redline_incident_id → safety_incident
  db.exec('DELETE FROM safety_incident_binding')
  db.exec('DELETE FROM assessment_session')     // assessment_session.redline_incident_id → safety_incident
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
  bankIds = seedJobSkillBank(db)
  strategyId = seedJobSkillStrategy(db, bankIds)
  mockState.db = db
})

describe('TC-N: JOB_SKILL_ASSESSMENT session 固定组卷', () => {
  // TC-N01: 创建成功，返回18道ONLINE题
  it('TC-N01 JOB_SKILL_ASSESSMENT 能创建 session，返回18道ONLINE题', () => {
    const result = createSession(db, baseParams())
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.sessionId).toMatch(/^[0-9a-f-]{36}$/)
    expect(result.questions).toHaveLength(18)
    expect(result.questions.every((q) => q.questionPhase === 'ONLINE')).toBe(true)
  })

  // TC-N02: assessment_session 字段正确
  it('TC-N02 assessment_session strategy_type=JOB_SKILL_ASSESSMENT，counts正确', () => {
    const result = createSession(db, baseParams())
    expect(result.success).toBe(true)
    if (!result.success) return
    startJobSkillSession(result.sessionId)
    const sess = db
      .prepare('SELECT strategy_type, online_question_count, offline_question_count, status FROM assessment_session WHERE session_id = ?')
      .get(result.sessionId) as { strategy_type: string; online_question_count: number; offline_question_count: number; status: string } | undefined
    expect(sess).toBeDefined()
    expect(sess!.strategy_type).toBe('JOB_SKILL_ASSESSMENT')
    expect(sess!.online_question_count).toBe(18)
    expect(sess!.offline_question_count).toBe(6)
    expect(sess!.status).toBe('ACTIVE')
  })

  // TC-N03: 每模块3线上1线下
  it('TC-N03 每模块3道ONLINE + 1道OFFLINE，job_module_code分布M1-M6', () => {
    const result = createSession(db, baseParams())
    expect(result.success).toBe(true)
    if (!result.success) return
    const rows = db
      .prepare(
        `SELECT job_module_code, question_phase, COUNT(*) AS cnt
           FROM assessment_session_question
          WHERE session_id = ? AND item_usage = 'SCORED_ITEM'
          GROUP BY job_module_code, question_phase`
      )
      .all(result.sessionId) as { job_module_code: string; question_phase: string; cnt: number }[]

    const byModule = new Map<string, { online: number; offline: number }>()
    for (const r of rows) {
      if (!byModule.has(r.job_module_code)) byModule.set(r.job_module_code, { online: 0, offline: 0 })
      if (r.question_phase === 'ONLINE') byModule.get(r.job_module_code)!.online = r.cnt
      else if (r.question_phase === 'OFFLINE') byModule.get(r.job_module_code)!.offline = r.cnt
    }
    for (const mod of JOB_MODULES) {
      expect(byModule.has(mod)).toBe(true)
      expect(byModule.get(mod)!.online).toBe(3)
      expect(byModule.get(mod)!.offline).toBe(1)
    }
  })

  // TC-N04: 观察项不超3项（实测=2）
  it('TC-N04 OBSERVATION phase 题数 ≤3（本用例=2）', () => {
    const result = createSession(db, baseParams())
    expect(result.success).toBe(true)
    if (!result.success) return
    const obsCnt = db
      .prepare("SELECT COUNT(*) AS cnt FROM assessment_session_question WHERE session_id = ? AND question_phase = 'OBSERVATION'")
      .get(result.sessionId) as { cnt: number }
    expect(obsCnt.cnt).toBeLessThanOrEqual(3)
    expect(obsCnt.cnt).toBe(2)
  })

  // TC-N05: 支持暂停恢复（smoke test）
  it('TC-N05 JOB_SKILL session 支持情绪中断后恢复', async () => {
    const { emotionInterrupt, emotionResume } = await import('../assessment')
    const result = createSession(db, baseParams())
    expect(result.success).toBe(true)
    if (!result.success) return
    const sid = result.sessionId
    startJobSkillSession(sid)

    const intResult = emotionInterrupt(db, {
      callerUserId: studentId,
      callerRole: 'STUDENT',
      sessionId: sid,
      currentQuestionOrder: 1,
      reason: 'tired'
    })
    expect(intResult.success).toBe(true)
    const statusAfterInt = db
      .prepare('SELECT status FROM assessment_session WHERE session_id = ?')
      .get(sid) as { status: string }
    expect(statusAfterInt.status).toBe('EMOTION_INTERRUPTED')

    const resResult = emotionResume(db, {
      callerUserId: callerId,
      callerRole: 'TEACHER',
      sessionId: sid,
      resumeFromQuestionOrder: 1
    })
    expect(resResult.success).toBe(true)
    const statusAfterRes = db
      .prepare('SELECT status FROM assessment_session WHERE session_id = ?')
      .get(sid) as { status: string }
    expect(statusAfterRes.status).toBe('ACTIVE')
  })

  // TC-N06: assessment_session_question 字段正确
  it('TC-N06 session_question 保存 bank_domain=JOB_SPECIFIC, job_module_code, item_usage, phase', () => {
    const result = createSession(db, baseParams())
    expect(result.success).toBe(true)
    if (!result.success) return
    const rows = db
      .prepare('SELECT bank_domain, job_module_code, item_usage, question_phase FROM assessment_session_question WHERE session_id = ?')
      .all(result.sessionId) as { bank_domain: string; job_module_code: string | null; item_usage: string; question_phase: string }[]

    expect(rows.length).toBe(26) // 18 online + 6 offline + 2 obs
    for (const r of rows) {
      expect(r.bank_domain).toBe('JOB_SPECIFIC')
      expect(r.job_module_code).not.toBeNull()
      expect(['M1', 'M2', 'M3', 'M4', 'M5', 'M6']).toContain(r.job_module_code)
      if (r.item_usage === 'SCORED_ITEM') {
        expect(['ONLINE', 'OFFLINE']).toContain(r.question_phase)
      } else {
        expect(r.item_usage).toBe('OBSERVATION_ONLY')
        expect(r.question_phase).toBe('OBSERVATION')
      }
    }
  })

  // TC-N07: OBSERVATION 题不生成 answer_record
  it('TC-N07 OBSERVATION phase 题不生成 answer_record（item_usage=OBSERVATION_ONLY）', () => {
    const result = createSession(db, baseParams())
    expect(result.success).toBe(true)
    if (!result.success) return
    const obsSqIds = db
      .prepare("SELECT question_id FROM assessment_session_question WHERE session_id = ? AND question_phase = 'OBSERVATION'")
      .all(result.sessionId) as { question_id: string }[]
    expect(obsSqIds.length).toBe(2)
    for (const row of obsSqIds) {
      const ar = db
        .prepare('SELECT answer_id FROM answer_record WHERE session_id = ? AND question_id = ?')
        .get(result.sessionId, row.question_id)
      expect(ar).toBeUndefined()
    }
  })

  // TC-N08: 安全红线中断 JOB_SKILL session
  it('TC-N08 安全红线触发后 JOB_SKILL session 进入 REDLINE_HALTED', async () => {
    const { triggerRedline } = await import('../assessment')
    const result = createSession(db, baseParams())
    expect(result.success).toBe(true)
    if (!result.success) return
    startJobSkillSession(result.sessionId)
    const redResult = triggerRedline(db, {
      callerUserId: callerId,
      callerRole: 'TEACHER',
      sessionId: result.sessionId,
      reasonCode: 'BLADE_TOWARD_SELF',
      contextPhase: 'ONLINE_ASSESSMENT'
    })
    expect(redResult.success).toBe(true)
    const sess = db
      .prepare('SELECT status FROM assessment_session WHERE session_id = ?')
      .get(result.sessionId) as { status: string }
    expect(sess.status).toBe('REDLINE_HALTED')
  })

  // TC-N09: 任一固定题非 ACTIVE 则创建失败
  it('TC-N09 fixed_scored_question_ids 中有 DRAFT 题 → QUESTION_BANK_INSUFFICIENT', () => {
    db.prepare("UPDATE question_bank SET status = 'DRAFT' WHERE question_id = ?").run(bankIds.onlineIds[0])
    const result = createSession(db, baseParams())
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.errorCode).toBe('QUESTION_BANK_INSUFFICIENT')
  })

  // TC-N10: 创建失败后无 session 行
  it('TC-N10 创建失败后 assessment_session 无行创建', () => {
    db.prepare("UPDATE question_bank SET status = 'DRAFT' WHERE question_id = ?").run(bankIds.onlineIds[0])
    createSession(db, baseParams())
    const cnt = db.prepare('SELECT COUNT(*) AS cnt FROM assessment_session').get() as { cnt: number }
    expect(cnt.cnt).toBe(0)
  })

  // TC-N11: task_code 存储正确
  it('TC-N11 assessment_session.task_code 保存传入的 taskCode', () => {
    const result = createSession(db, baseParams())
    expect(result.success).toBe(true)
    if (!result.success) return
    const sess = db
      .prepare('SELECT task_code FROM assessment_session WHERE session_id = ?')
      .get(result.sessionId) as { task_code: string }
    expect(sess.task_code).toBe(JOB_TASK_CODE)
  })

  // TC-N12: online/offline_question_count 正确
  it('TC-N12 online_question_count=18 / offline_question_count=6', () => {
    const result = createSession(db, baseParams())
    expect(result.success).toBe(true)
    if (!result.success) return
    const sess = db
      .prepare('SELECT online_question_count, offline_question_count FROM assessment_session WHERE session_id = ?')
      .get(result.sessionId) as { online_question_count: number; offline_question_count: number }
    expect(sess.online_question_count).toBe(18)
    expect(sess.offline_question_count).toBe(6)
  })
})
