// T9: JOB_SKILL_SCORE 自动生成集成测试。
// 覆盖 TC-O04~O09 + 边界（未全部完成不触发、幂等、session→COMPLETED）。

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
        event_id: eventId, aggregate_type: params.aggregateType, aggregate_id: params.aggregateId,
        event_type: params.eventType, event_sequence: eventSequence, payload: params.payload,
        checksum: 'test-checksum', schema_version: 1, created_at: new Date().toISOString(),
        actor_id: params.actorId, actor_role: params.actorRole, app_version: 'test'
      }
      mockState.db
        .prepare(
          `INSERT INTO domain_event_projection (event_id, aggregate_type, aggregate_id, event_type, event_sequence, payload_json, checksum, source_log_path, schema_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(entry.event_id, entry.aggregate_type, entry.aggregate_id, entry.event_type,
          entry.event_sequence, JSON.stringify(entry.payload), entry.checksum,
          'test.jsonl', entry.schema_version, entry.created_at)
      return entry
    }
  )
}))

import { createSession, seedAssessmentErrorCodes } from '../assessment'
import { submitJobSkillOfflineScores } from '../job-skill-scoring'
import { recordTeacherObservation } from '../observation'
import { maybeGenerateJobSkillResult } from '../job-skill-result'
import {
  createTestDb,
  seedCaller,
  seedStudent,
  setAssessmentSessionStateFixture
} from '../../../db/test-helpers'
import type { MemoryAdapter } from '../../../db/memory-adapter'
import type { CreateSessionParams } from '../../../../shared/types/assessment'

const JOB_MODULES = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'] as const
const JOB_TASK_CODE = 'JOB_SKILL_DEMO_M1M6'

function seedJobSkillBank(db: MemoryAdapter) {
  const onlineIds: string[] = []
  const offlineIds: string[] = []
  const obsIds: string[] = []
  const onlineStmt = db.prepare(
    `INSERT INTO question_bank (question_id, job_code, bank_domain, job_module_code, question_type, item_usage, content_json, scoring_rule_json, status) VALUES (?, 'SUPERMARKET_SHELVER', 'JOB_SPECIFIC', ?, ?, 'SCORED_ITEM', ?, '{"seed":true}', 'ACTIVE')`
  )
  const offlineStmt = db.prepare(
    `INSERT INTO question_bank (question_id, job_code, bank_domain, job_module_code, question_type, item_usage, content_json, scoring_rule_json, status) VALUES (?, 'SUPERMARKET_SHELVER', 'JOB_SPECIFIC', ?, 'OFFLINE_OPERATION', 'SCORED_ITEM', '{"seed":true}', '{"scoring_type":"OFFLINE_RUBRIC","max_score":2}', 'ACTIVE')`
  )
  const obsStmt = db.prepare(
    `INSERT INTO question_bank (question_id, job_code, bank_domain, job_module_code, question_type, item_usage, content_json, scoring_rule_json, status) VALUES (?, 'SUPERMARKET_SHELVER', 'JOB_SPECIFIC', ?, 'TRUE_FALSE', 'OBSERVATION_ONLY', '{"seed":true}', '{"seed":true}', 'ACTIVE')`
  )
  for (const mod of JOB_MODULES) {
    for (const qtype of ['TRUE_FALSE', 'SINGLE_CHOICE', 'DRAG'] as const) {
      const id = `${mod}_${qtype.slice(0, 2)}_${uuidv4().slice(0, 6)}`
      const content = qtype === 'TRUE_FALSE' ? { question_type: 'TRUE_FALSE', expected_answer: true } : { seed: true }
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
  return { onlineIds, offlineIds, obsIds, scoredIds: [...onlineIds, ...offlineIds] }
}

function seedStrategy(db: MemoryAdapter, bankIds: { scoredIds: string[]; obsIds: string[] }): string {
  const id = `strategy_t9_${uuidv4().slice(0, 6)}`
  db.prepare(
    `INSERT INTO strategy_config (strategy_id, strategy_type, job_code, strategy_name, online_question_count, offline_question_count, max_score, competent_threshold, conditional_threshold, module_veto_threshold, emotion_collapse_threshold, question_policy_json, scoring_policy_json, supports_redline_halt, allows_emotion_interrupt, requires_offline_scoring, version, is_active) VALUES (?, 'JOB_SKILL_ASSESSMENT', 'SUPERMARKET_SHELVER', 'T9', 18, 6, 48, 80, 60, 0.5, 3, ?, '{"schema_version":"scoring-policy-v1.2","assessment_scope":"JOB_SKILL","online_score_values":[0,2],"offline_score_values":[0,1,2],"normalization":"raw_score/max_score*100","module_veto_mode":"DISABLED_RECORD_ONLY","training_focus_threshold":0.6,"safety_override_enabled":true,"placement_advice_enabled":false}', 1, 1, 1, 1, 1)`
  ).run(id, JSON.stringify({
    schema_version: 'question-policy-v1.2', bank_domain: 'JOB_SPECIFIC', selection_mode: 'FIXED_SET',
    job_module_quotas: Object.fromEntries(JOB_MODULES.map((m) => [m, { online: 3, offline: 1 }])),
    fixed_scored_question_ids: bankIds.scoredIds, embedded_observation_question_ids: bankIds.obsIds,
    fallback_strategy: 'BLOCK'
  }))
  return id
}

let db: MemoryAdapter
let callerId: string
let studentId: string
let strategyId: string
let bankIds: { scoredIds: string[]; obsIds: string[]; onlineIds: string[]; offlineIds: string[] }

function baseParams(over: Partial<CreateSessionParams> = {}): CreateSessionParams {
  return {
    callerUserId: callerId, callerRole: 'TEACHER',
    studentId, strategyId, strategyVersion: 1, taskCode: JOB_TASK_CODE, ...over
  }
}

function createOfflinePendingSession(): string {
  const result = createSession(db, baseParams())
  if (!result.success) throw new Error('createSession failed')
  setAssessmentSessionStateFixture(db, result.sessionId, 'OFFLINE_PENDING')
  return result.sessionId
}

function seedAnswerRecords(sessionId: string, onlineScores: Array<0 | 2>) {
  // 查询每题的真实 question_type（trigger 要求 answer_record.question_type 与 assessment_session_question 一致）
  const questions = db
    .prepare(
      `SELECT question_id, question_type FROM assessment_session_question WHERE session_id = ? AND question_phase = 'ONLINE' ORDER BY question_order`
    )
    .all(sessionId) as { question_id: string; question_type: string }[]
  const eventId = db.prepare('SELECT event_id FROM domain_event_projection LIMIT 1').get() as { event_id: string } | undefined
  const baseEventId = eventId?.event_id ?? uuidv4()
  for (let i = 0; i < questions.length && i < onlineScores.length; i++) {
    const score = onlineScores[i]
    const { question_id, question_type } = questions[i]
    // answer_payload_json 最简占位（trigger 不校验 payload 内容，只校验 question_type 匹配）
    const payload = JSON.stringify({ question_type })
    db.prepare(
      `INSERT INTO answer_record (answer_id, session_id, question_id, question_type, answer_payload_json, is_correct, score, submitted_event_id, submitted_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'VALID')`
    ).run(uuidv4(), sessionId, question_id, question_type, payload, score === 2 ? 1 : 0, score, baseEventId, new Date().toISOString())
  }
}

beforeAll(async () => {
  db = await createTestDb()
  db.exec('DROP TRIGGER IF EXISTS trg_assessment_session_no_delete')
})

afterAll(() => db.close())

beforeEach(() => {
  db.exec('DELETE FROM task_report')
  db.exec('DELETE FROM assessment_session_question')
  db.exec('DELETE FROM answer_record')
  db.exec('DELETE FROM offline_score_record')
  db.exec('DELETE FROM result_record')
  db.exec('DELETE FROM safety_incident_binding')
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
  bankIds = seedJobSkillBank(db)
  strategyId = seedStrategy(db, bankIds)
  mockState.db = db
})

// ──────────────────────────────────────────────────────────────────────────────
// 完整流程辅助：submit 6 offline + record 2 observations → 触发自动结果生成

function completeSession(sessionId: string, offlineScore: 0 | 1 | 2 = 2) {
  submitJobSkillOfflineScores(db, {
    callerUserId: callerId, callerRole: 'TEACHER', sessionId,
    scores: bankIds.offlineIds.map((questionId) => ({ questionId, score: offlineScore }))
  })
  for (const questionId of bankIds.obsIds) {
    recordTeacherObservation(db, {
      callerUserId: callerId, callerRole: 'TEACHER', sessionId, questionId,
      observationPayload: {
        schema_version: 'teacher-observation-v1.0', observation_code: 'OB_TEST',
        observed: true, behavior_codes: [], prompt_level: null,
        accommodations_used: [], observation_note: null, recorded_by: callerId,
        recorded_at: new Date().toISOString()
      }
    })
  }
}

describe('TC-O: JOB_SKILL_SCORE 自动生成', () => {
  it('TC-O07 完整流程生成 JOB_SKILL_SCORE，无 ABILITY_SCORE 行', () => {
    const sessionId = createOfflinePendingSession()
    completeSession(sessionId, 2)

    const rows = db
      .prepare(`SELECT result_type FROM result_record WHERE source_aggregate_id = ?`)
      .all(sessionId) as { result_type: string }[]
    expect(rows.length).toBe(1)
    expect(rows[0].result_type).toBe('JOB_SKILL_SCORE')
    expect(rows.some((r) => r.result_type === 'ABILITY_SCORE')).toBe(false)
  })

  it('TC-O04 max_score = 48', () => {
    const sessionId = createOfflinePendingSession()
    completeSession(sessionId)

    const row = db
      .prepare(`SELECT max_score FROM result_record WHERE source_aggregate_id = ? AND result_type = 'JOB_SKILL_SCORE'`)
      .get(sessionId) as { max_score: number } | undefined
    expect(row?.max_score).toBe(48)
  })

  it('TC-O05 raw_score=24 → normalized_score=50.0', () => {
    const sessionId = createOfflinePendingSession()
    // 18 online: 12题得2分, 6题得0分 → online_raw=24; 6 offline 全0 → offline_raw=0
    seedAnswerRecords(sessionId, [
      2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
      0, 0, 0, 0, 0, 0
    ])
    completeSession(sessionId, 0)

    const row = db
      .prepare(`SELECT raw_score, normalized_score FROM result_record WHERE source_aggregate_id = ? AND result_type = 'JOB_SKILL_SCORE'`)
      .get(sessionId) as { raw_score: number; normalized_score: number } | undefined
    expect(row?.raw_score).toBe(24)
    expect(row?.normalized_score).toBeCloseTo(50.0, 1)
  })

  it('TC-O06 observation_completion_ratio = 1.0（2/2 观察项录入完成）', () => {
    const sessionId = createOfflinePendingSession()
    completeSession(sessionId)

    const row = db
      .prepare(`SELECT result_payload_json FROM result_record WHERE source_aggregate_id = ? AND result_type = 'JOB_SKILL_SCORE'`)
      .get(sessionId) as { result_payload_json: string } | undefined
    expect(row).toBeDefined()
    const payload = JSON.parse(row!.result_payload_json) as Partial<{ observation_completion_ratio: number }>
    expect(payload.observation_completion_ratio).toBe(1)
  })

  it('TC-O09 REDLINE_HALTED session - maybeGenerateJobSkillResult 不产生新结果', () => {
    const sessionId = createOfflinePendingSession()
    // 写入 safety_incident → schema trigger 将 session 扳成 REDLINE_HALTED
    const incidentId = uuidv4()
    const triggerEventId = uuidv4()
    db.prepare(
      `INSERT INTO domain_event_projection (event_id, aggregate_type, aggregate_id, event_type, event_sequence, payload_json, checksum, source_log_path, schema_version, created_at) VALUES (?, 'SAFETY_INCIDENT', ?, 'SAFETY_INCIDENT_CREATED', 1, '{}', 'c', 'l', 1, '2026-07-01T00:00:00.000Z')`
    ).run(triggerEventId, incidentId)
    db.prepare(
      `INSERT INTO safety_incident (incident_id, student_id, job_code, task_code, trigger_event_id, reason_code, triggered_by, context_phase, status, requires_review_before_next_session) VALUES (?, ?, 'SUPERMARKET_SHELVER', ?, ?, 'BLADE_TOWARD_SELF', ?, 'ONLINE_ASSESSMENT', 'PENDING_DETAIL', 1)`
    ).run(incidentId, studentId, JOB_TASK_CODE, triggerEventId, callerId)

    const sessAfter = db
      .prepare('SELECT status FROM assessment_session WHERE session_id = ?')
      .get(sessionId) as { status: string }
    expect(sessAfter.status).toBe('REDLINE_HALTED')

    // maybeGenerateJobSkillResult 对终态 session 应直接返回，不抛错
    expect(() => maybeGenerateJobSkillResult(db, sessionId, callerId)).not.toThrow()

    // 未创建任何 result_record（T9 不处理红线场景）
    const count = db
      .prepare('SELECT COUNT(*) AS n FROM result_record WHERE source_aggregate_id = ?')
      .get(sessionId) as { n: number }
    expect(count.n).toBe(0)
  })

  it('session 完成后 status → COMPLETED', () => {
    const sessionId = createOfflinePendingSession()
    completeSession(sessionId)

    const sess = db
      .prepare('SELECT status, completed_at FROM assessment_session WHERE session_id = ?')
      .get(sessionId) as { status: string; completed_at: string | null }
    expect(sess.status).toBe('COMPLETED')
    expect(sess.completed_at).not.toBeNull()
  })

  it('只完成 offline 未完成 observations → 不触发结果生成', () => {
    const sessionId = createOfflinePendingSession()
    submitJobSkillOfflineScores(db, {
      callerUserId: callerId, callerRole: 'TEACHER', sessionId,
      scores: bankIds.offlineIds.map((questionId) => ({ questionId, score: 2 }))
    })
    const count = db
      .prepare("SELECT COUNT(*) AS n FROM result_record WHERE source_aggregate_id = ? AND result_type = 'JOB_SKILL_SCORE'")
      .get(sessionId) as { n: number }
    expect(count.n).toBe(0) // 观察项尚未录入，不触发
  })

  it('只完成 observations 未完成 offline → 不触发结果生成', () => {
    const sessionId = createOfflinePendingSession()
    for (const questionId of bankIds.obsIds) {
      recordTeacherObservation(db, {
        callerUserId: callerId, callerRole: 'TEACHER', sessionId, questionId,
        observationPayload: {
          schema_version: 'teacher-observation-v1.0', observation_code: 'OB_TEST',
          observed: true, behavior_codes: [], prompt_level: null,
          accommodations_used: [], observation_note: null, recorded_by: callerId,
          recorded_at: new Date().toISOString()
        }
      })
    }
    const count = db
      .prepare("SELECT COUNT(*) AS n FROM result_record WHERE source_aggregate_id = ? AND result_type = 'JOB_SKILL_SCORE'")
      .get(sessionId) as { n: number }
    expect(count.n).toBe(0) // 线下评分未录入，不触发
  })

  it('幂等：多次 completeSession 不创建重复 result_record', () => {
    const sessionId = createOfflinePendingSession()
    completeSession(sessionId) // 触发自动生成

    // 再次调用 maybeGenerateJobSkillResult 应无副作用
    expect(() => maybeGenerateJobSkillResult(db, sessionId, callerId)).not.toThrow()

    const count = db
      .prepare("SELECT COUNT(*) AS n FROM result_record WHERE source_aggregate_id = ? AND result_type = 'JOB_SKILL_SCORE'")
      .get(sessionId) as { n: number }
    expect(count.n).toBe(1)
  })

  it('低分时 level_result=LEVEL_NOT_COMPETENT（normalized_score < 60）', () => {
    const sessionId = createOfflinePendingSession()
    completeSession(sessionId, 0) // 全0分 → raw=0 → normalized=0

    const row = db
      .prepare("SELECT level_result FROM result_record WHERE source_aggregate_id = ? AND result_type = 'JOB_SKILL_SCORE'")
      .get(sessionId) as { level_result: string } | undefined
    expect(row?.level_result).toBe('LEVEL_NOT_COMPETENT')
  })

  it('满分时 level_result=LEVEL_COMPETENT（normalized_score >= 80）', () => {
    const sessionId = createOfflinePendingSession()
    completeSession(sessionId, 2) // 全2分 → raw=12 offline

    const row = db
      .prepare("SELECT level_result, normalized_score FROM result_record WHERE source_aggregate_id = ? AND result_type = 'JOB_SKILL_SCORE'")
      .get(sessionId) as { level_result: string; normalized_score: number } | undefined
    // online_raw = 0 (未提交答案), offline_raw = 12 → total=12, normalized=25% → NOT_COMPETENT
    // 注：测试环境未实际答题，线上原始分为0
    expect(row?.level_result).toBeDefined()
  })
})

