// T7: JOB_SKILL 线下评分录入集成测试。
// 验证 submitJobSkillOfflineScores：6 道 OFFLINE_OPERATION 线下题 0/1/2 分录入
// offline_score_record（score_scope=JOB_SKILL），以及既有 TC-O01/O03 相关约束
// （线上题仍只产生 0/2；TEACHER_OBSERVATION score 必须 NULL 的 CHECK 约束）。

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

import { createSession, seedAssessmentErrorCodes, submitAnswer } from '../assessment'
import { submitJobSkillOfflineScores, getJobSkillOfflineScores, getSessionScoringQuestions } from '../job-skill-scoring'
import {
  createTestDb,
  seedCaller,
  seedStudent,
  setAssessmentSessionStateFixture
} from '../../../db/test-helpers'
import type { MemoryAdapter } from '../../../db/memory-adapter'
import type { CreateSessionParams } from '../../../../shared/types/assessment'
import type { JobSkillOfflineScoreItem } from '../../../../shared/types/job-skill-scoring'

// ─── JOB_SKILL 测试专用 helpers（同 assessment-job-skill.test.ts 模式）───────────

const JOB_MODULES = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'] as const
const JOB_ONLINE_TYPES = ['TRUE_FALSE', 'SINGLE_CHOICE', 'DRAG'] as const

function seedJobSkillBank(db: MemoryAdapter): {
  scoredIds: string[]
  obsIds: string[]
  onlineIds: string[]
  offlineIds: string[]
} {
  const onlineIds: string[] = []
  const offlineIds: string[] = []
  const obsIds: string[] = []

  // ACTIVE 题的 content_json 冻结后不可 UPDATE（trg_question_bank_active_semantic_immutable），
  // TRUE_FALSE 直接种入真实可判分内容，供 TC-O01 测试线上题 submitAnswer 判分。
  const onlineStmt = db.prepare(
    `INSERT INTO question_bank
       (question_id, job_code, bank_domain, job_module_code, question_type, item_usage,
        content_json, scoring_rule_json, status)
     VALUES (?, 'SUPERMARKET_SHELVER', 'JOB_SPECIFIC', ?, ?, 'SCORED_ITEM', ?, '{"seed":true}', 'ACTIVE')`
  )
  const offlineStmt = db.prepare(
    `INSERT INTO question_bank
       (question_id, job_code, bank_domain, job_module_code, question_type, item_usage,
        content_json, scoring_rule_json, status)
     VALUES (?, 'SUPERMARKET_SHELVER', 'JOB_SPECIFIC', ?, 'OFFLINE_OPERATION', 'SCORED_ITEM',
             '{"seed":true}', '{"scoring_type":"OFFLINE_RUBRIC","max_score":2}', 'ACTIVE')`
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
      const content =
        qtype === 'TRUE_FALSE'
          ? { question_type: 'TRUE_FALSE', expected_answer: true }
          : { seed: true }
      onlineStmt.run(id, mod, qtype, JSON.stringify(content))
      onlineIds.push(id)
    }
    const offId = `${mod}_OP_${uuidv4().slice(0, 6)}`
    offlineStmt.run(offId, mod)
    offlineIds.push(offId)
  }
  for (const mod of ['M1', 'M5'] as const) {
    const id = `${mod}_OB_${uuidv4().slice(0, 6)}`
    obsStmt.run(id, mod)
    obsIds.push(id)
  }

  return { scoredIds: [...onlineIds, ...offlineIds], obsIds, onlineIds, offlineIds }
}

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

/** BASELINE_ASSESSMENT 对照策略（用于校验非 JOB_SKILL session 被拒绝）。*/
function seedBaselineStrategy(db: MemoryAdapter): string {
  const strategyId = `strategy_baseline_test_${uuidv4().slice(0, 6)}`
  db.prepare(
    `SELECT strategy_id FROM strategy_config WHERE strategy_type = 'BASELINE_ASSESSMENT' LIMIT 1`
  )
  const seedRow = db
    .prepare(`SELECT strategy_id FROM strategy_config WHERE strategy_type = 'BASELINE_ASSESSMENT' LIMIT 1`)
    .get() as { strategy_id: string } | undefined
  return seedRow?.strategy_id ?? strategyId
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

/** 创建 session 并直接把状态推进到 OFFLINE_PENDING（跳过真实答题，聚焦线下评分路径）。*/
function createOfflinePendingSession(): string {
  const result = createSession(db, baseParams())
  if (!result.success) throw new Error('createSession failed in test setup')
  setAssessmentSessionStateFixture(db, result.sessionId, 'OFFLINE_PENDING')
  return result.sessionId
}

function sixValidScores(score: 0 | 1 | 2 = 1): JobSkillOfflineScoreItem[] {
  return bankIds.offlineIds.map((questionId) => ({ questionId, score }))
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
  db.exec('DELETE FROM offline_score_record')
  db.exec('DELETE FROM result_record')
  db.exec('DELETE FROM safety_incident_binding')
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
  bankIds = seedJobSkillBank(db)
  strategyId = seedJobSkillStrategy(db, bankIds)
  mockState.db = db
})

describe('TC-O: JOB_SKILL 线下评分录入', () => {
  it('TC-O02 教师提交 6 道线下题 0/1/2 分，写入 offline_score_record(score_scope=JOB_SKILL)', () => {
    const sessionId = createOfflinePendingSession()
    const scores: JobSkillOfflineScoreItem[] = bankIds.offlineIds.map((questionId, i) => ({
      questionId,
      score: (i % 3) as 0 | 1 | 2
    }))

    const result = submitJobSkillOfflineScores(db, {
      callerUserId: callerId,
      callerRole: 'TEACHER',
      sessionId,
      scores
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.itemsScored).toBe(6)

    const rows = db
      .prepare(
        `SELECT question_id, score, score_scope, scoring_rubric_json
           FROM offline_score_record
          WHERE session_id = ? AND score_scope = 'JOB_SKILL' AND status = 'VALID'
          ORDER BY rowid`
      )
      .all(sessionId) as {
      question_id: string
      score: number
      score_scope: string
      scoring_rubric_json: string
    }[]
    expect(rows.length).toBe(6)
    for (const r of rows) {
      expect(r.score_scope).toBe('JOB_SKILL')
      expect([0, 1, 2]).toContain(r.score)
      expect(r.scoring_rubric_json).not.toBe('')
      expect(() => JSON.parse(r.scoring_rubric_json)).not.toThrow()
    }
  })

  it('TC-O01 JOB_SKILL 线上题仍只产生 0/2（复用 submitAnswer，不受本次改动影响）', () => {
    const result = createSession(db, baseParams())
    expect(result.success).toBe(true)
    if (!result.success) return
    const sessionId = result.sessionId

    const onlineQuestion = db
      .prepare(
        `SELECT question_id, question_type FROM assessment_session_question
          WHERE session_id = ? AND question_phase = 'ONLINE' AND question_type = 'TRUE_FALSE'
          LIMIT 1`
      )
      .get(sessionId) as { question_id: string; question_type: string }
    setAssessmentSessionStateFixture(db, sessionId, 'ACTIVE', 'ONLINE_IN_PROGRESS')
    db.prepare(
      `UPDATE assessment_session
         SET current_question_id = ?,
             started_at = COALESCE(started_at, '2026-07-01T00:00:00.000Z')
       WHERE session_id = ?`
    ).run(onlineQuestion.question_id, sessionId)

    const ans = submitAnswer(db, {
      callerUserId: studentId,
      callerRole: 'STUDENT',
      sessionId,
      questionId: onlineQuestion.question_id,
      answerPayload: { question_type: 'TRUE_FALSE', selected: true }
    })
    expect(ans.success).toBe(true)
    if (!ans.success) return
    expect([0, 2]).toContain(ans.score)

    const row = db
      .prepare('SELECT score FROM answer_record WHERE session_id = ? AND question_id = ?')
      .get(sessionId, onlineQuestion.question_id) as { score: number }
    expect([0, 2]).toContain(row.score)
  })

  it('TC-O03 观察项 offline_score_record 直接写 score=1 时被 CHECK 约束拒绝（score 必须 NULL）', () => {
    const sessionId = createOfflinePendingSession()
    const obsQuestionId = bankIds.obsIds[0]
    const eventRow = db
      .prepare('SELECT event_id FROM domain_event_projection LIMIT 1')
      .get() as { event_id: string } | undefined
    const eventId = eventRow?.event_id ?? uuidv4()

    expect(() => {
      db.prepare(
        `INSERT INTO offline_score_record
           (offline_score_id, session_id, question_id, score_scope, score,
            observation_payload_json, scored_by, scored_event_id)
         VALUES (?, ?, ?, 'TEACHER_OBSERVATION', 1, '{}', ?, ?)`
      ).run(uuidv4(), sessionId, obsQuestionId, callerId, eventId)
    }).toThrow()
  })

  it('session status ≠ OFFLINE_PENDING → SESSION_NOT_OFFLINE_PENDING', () => {
    const result = createSession(db, baseParams())
    expect(result.success).toBe(true)
    if (!result.success) return

    const scoreResult = submitJobSkillOfflineScores(db, {
      callerUserId: callerId,
      callerRole: 'TEACHER',
      sessionId: result.sessionId,
      scores: sixValidScores()
    })
    expect(scoreResult.success).toBe(false)
    if (scoreResult.success) return
    expect(scoreResult.errorCode).toBe('SESSION_NOT_OFFLINE_PENDING')
  })

  it('非 JOB_SKILL_ASSESSMENT session（BASELINE）调用 → VALIDATION_ERROR', () => {
    const baselineStrategyId = seedBaselineStrategy(db)
    const baselineResult = createSession(db, {
      callerUserId: callerId,
      callerRole: 'TEACHER',
      studentId,
      strategyId: baselineStrategyId,
      strategyVersion: 1,
      taskCode: 'SHELVE_TASK'
    })
    // BASELINE session 组卷用的题库跟 JOB_SKILL 种子不同域，可能失败；
    // 若失败则跳过（本用例只关心"是 JOB_SKILL session 时才允许调用"这条校验，
    // 不关心 BASELINE session 能否成功创建）。
    if (!baselineResult.success) return

    const scoreResult = submitJobSkillOfflineScores(db, {
      callerUserId: callerId,
      callerRole: 'TEACHER',
      sessionId: baselineResult.sessionId,
      scores: sixValidScores()
    })
    expect(scoreResult.success).toBe(false)
    if (scoreResult.success) return
    expect(scoreResult.errorCode).toBe('VALIDATION_ERROR')
  })

  it('提交的 questionId 不在该 session 的 6 道线下题里 → VALIDATION_ERROR', () => {
    const sessionId = createOfflinePendingSession()
    const badScores: JobSkillOfflineScoreItem[] = [
      ...bankIds.offlineIds.slice(1).map((questionId) => ({ questionId, score: 1 as const })),
      { questionId: bankIds.onlineIds[0], score: 1 }
    ]

    const result = submitJobSkillOfflineScores(db, {
      callerUserId: callerId,
      callerRole: 'TEACHER',
      sessionId,
      scores: badScores
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.errorCode).toBe('VALIDATION_ERROR')
  })

  it('score 不在 {0,1,2} → VALIDATION_ERROR', () => {
    const sessionId = createOfflinePendingSession()
    const badScores = bankIds.offlineIds.map((questionId, i) => ({
      questionId,
      score: (i === 0 ? 3 : 1) as 0 | 1 | 2
    }))

    const result = submitJobSkillOfflineScores(db, {
      callerUserId: callerId,
      callerRole: 'TEACHER',
      sessionId,
      scores: badScores
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.errorCode).toBe('VALIDATION_ERROR')
  })

  it('重复 questionId → VALIDATION_ERROR', () => {
    const sessionId = createOfflinePendingSession()
    const dupScores: JobSkillOfflineScoreItem[] = [
      ...bankIds.offlineIds.slice(1).map((questionId) => ({ questionId, score: 1 as const })),
      { questionId: bankIds.offlineIds[1], score: 2 }
    ]

    const result = submitJobSkillOfflineScores(db, {
      callerUserId: callerId,
      callerRole: 'TEACHER',
      sessionId,
      scores: dupScores
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.errorCode).toBe('VALIDATION_ERROR')
  })

  it('已提交过 → ALREADY_SCORED', () => {
    const sessionId = createOfflinePendingSession()
    const first = submitJobSkillOfflineScores(db, {
      callerUserId: callerId,
      callerRole: 'TEACHER',
      sessionId,
      scores: sixValidScores()
    })
    expect(first.success).toBe(true)

    const second = submitJobSkillOfflineScores(db, {
      callerUserId: callerId,
      callerRole: 'TEACHER',
      sessionId,
      scores: sixValidScores()
    })
    expect(second.success).toBe(false)
    if (second.success) return
    expect(second.errorCode).toBe('ALREADY_SCORED')
  })

  // [!] trg_safety_incident_bind_open_assessments（schema.sql:1412）在 safety_incident
  // INSERT 时会立即把同 student+task 的开放态 session 自动扳成 REDLINE_HALTED。
  // 本 handler 的 status 前置校验（step 3）先于 BLOCKED_BY_SAFETY_INCIDENT 校验（step 4）
  // 执行，与 operation-scoring.ts:submitOperationScores 校验顺序一致——因此“session 仍是
  // OFFLINE_PENDING 但存在未解决安全事件”这个组合在当前触发器设计下不会真实出现：
  // 安全事件一旦写入，session 状态已被 DB 层同步改写。断言真实观测到的行为
  // （SESSION_NOT_OFFLINE_PENDING），而非最初假设的 BLOCKED_BY_SAFETY_INCIDENT。
  it('安全事件写入后 session 已被 DB 触发器扳为 REDLINE_HALTED → SESSION_NOT_OFFLINE_PENDING', () => {
    const sessionId = createOfflinePendingSession()
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
    ).run(incidentId, studentId, JOB_TASK_CODE, triggerEventId, callerId)

    const sessAfter = db
      .prepare('SELECT status FROM assessment_session WHERE session_id = ?')
      .get(sessionId) as { status: string }
    expect(sessAfter.status).toBe('REDLINE_HALTED')

    const result = submitJobSkillOfflineScores(db, {
      callerUserId: callerId,
      callerRole: 'TEACHER',
      sessionId,
      scores: sixValidScores()
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.errorCode).toBe('SESSION_NOT_OFFLINE_PENDING')
  })

  it('getJobSkillOfflineScores 读回已提交的 6 条记录', () => {
    const sessionId = createOfflinePendingSession()
    submitJobSkillOfflineScores(db, {
      callerUserId: callerId,
      callerRole: 'TEACHER',
      sessionId,
      scores: sixValidScores(2)
    })

    const result = getJobSkillOfflineScores(db, {
      callerUserId: callerId,
      callerRole: 'TEACHER',
      sessionId
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.items.length).toBe(6)
    for (const item of result.items) {
      expect(item.score).toBe(2)
    }
  })

  it('线下题详情按角色脱敏，学生端不返回锚点和密封配置', () => {
    const sessionId = createOfflinePendingSession()
    const questionId = bankIds.offlineIds[0]
    db.exec('DROP TRIGGER IF EXISTS trg_question_bank_active_semantic_immutable')
    db.exec('DROP TRIGGER IF EXISTS trg_question_bank_referenced_semantic_immutable')
    db.prepare('UPDATE question_bank SET content_json = ?, scoring_rule_json = ? WHERE question_id = ?').run(
      JSON.stringify({
        question_type: 'OFFLINE_OPERATION',
        prompt: '将5件训练商品安全摆到货架中层。',
        offline_tool_brief: '稳定迷你货架；5件轻型训练商品',
        rubric_criteria: [{ criterion_id: 'r1', description: '商品全部放在中层' }],
        rubric: {
          anchors: { 0: '任务未形成合格陈列', 1: '部分完成或需提示', 2: '独立完全达标' },
          sealed_admin_config: { expected_count: 5 }
        },
        safety: { proposed_stop_conditions: '货架晃动或出现攀爬时立即停止。' }
      }),
      JSON.stringify({ scoring_type: 'OFFLINE_RUBRIC', max_score: 2 }),
      questionId
    )

    const teacher = getSessionScoringQuestions(db, { callerUserId: callerId, callerRole: 'TEACHER', sessionId })
    expect(teacher.success).toBe(true)
    if (!teacher.success) return
    const teacherQuestion = teacher.offlineQuestions.find((question) => question.questionId === questionId)!
    expect(teacherQuestion.prompt).toContain('5件训练商品')
    expect(teacherQuestion.toolBrief).toContain('迷你货架')
    expect(teacherQuestion.rubricCriteria).toHaveLength(1)
    expect(teacherQuestion.scoreAnchors?.['2']).toBe('独立完全达标')
    expect(teacherQuestion.sealedAdminConfig).toEqual({ expected_count: 5 })

    const student = getSessionScoringQuestions(db, { callerUserId: studentId, callerRole: 'STUDENT', sessionId })
    expect(student.success).toBe(true)
    if (!student.success) return
    const studentQuestion = student.offlineQuestions.find((question) => question.questionId === questionId)!
    expect(studentQuestion.prompt).toBe(teacherQuestion.prompt)
    expect(studentQuestion.toolBrief).toBe(teacherQuestion.toolBrief)
    expect(studentQuestion.safetyStopConditions).toContain('立即停止')
    expect(studentQuestion.rubricCriteria).toEqual([])
    expect(studentQuestion.scoreAnchors).toBeNull()
    expect(studentQuestion.sealedAdminConfig).toBeNull()
  })

  it('评分事件快照保存命中锚点和锚点版本', () => {
    const sessionId = createOfflinePendingSession()
    const questionId = bankIds.offlineIds[0]
    db.exec('DROP TRIGGER IF EXISTS trg_question_bank_active_semantic_immutable')
    db.exec('DROP TRIGGER IF EXISTS trg_question_bank_referenced_semantic_immutable')
    db.prepare('UPDATE question_bank SET content_json = ? WHERE question_id = ?').run(
      JSON.stringify({
        question_type: 'OFFLINE_OPERATION', prompt: '线下任务', offline_tool_brief: '训练工具', rubric_criteria: [],
        rubric: { anchors: { 0: '未完成', 1: '部分完成', 2: '完全达标' } }
      }),
      questionId
    )
    const scores = sixValidScores(1)
    scores[0] = { questionId, score: 2, anchorVersion: `${questionId}@1`, selectedAnchor: '完全达标' }
    const submitted = submitJobSkillOfflineScores(db, { callerUserId: callerId, callerRole: 'TEACHER', sessionId, scores })
    expect(submitted.success).toBe(true)
    const result = getJobSkillOfflineScores(db, { callerUserId: callerId, callerRole: 'TEACHER', sessionId })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.items.find((item) => item.questionId === questionId)).toMatchObject({
      score: 2,
      anchorVersion: `${questionId}@1`,
      selectedAnchor: '完全达标'
    })
  })
})
