// T8: TEACHER_OBSERVATION 运行时集成测试。
// 验证 recordTeacherObservation：写入 offline_score_record(score_scope=TEACHER_OBSERVATION,
// score=NULL, observation_payload_json 有值)，以及 TEACHER_OBSERVATION_RECORDED 事件写入。
// 覆盖 TC-I02（score=NULL 写入）、TC-I05（事件写入 domain_event_projection）。

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

import { createSession, seedAssessmentErrorCodes } from '../assessment'
import { recordTeacherObservation, getTeacherObservations } from '../observation'
import { createTestDb, seedCaller, seedStudent } from '../../../db/test-helpers'
import type { MemoryAdapter } from '../../../db/memory-adapter'
import type { CreateSessionParams } from '../../../../shared/types/assessment'
import type { TeacherObservationPayload } from '../../../../shared/types/json-schemas'

// ─── helpers ─────────────────────────────────────────────────────────────────

const JOB_MODULES = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'] as const
const JOB_ONLINE_TYPES = ['TRUE_FALSE', 'SINGLE_CHOICE', 'DRAG'] as const

function seedJobSkillBank(db: MemoryAdapter): { onlineIds: string[]; offlineIds: string[]; obsIds: string[] } {
  const onlineIds: string[] = []
  const offlineIds: string[] = []
  const obsIds: string[] = []

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
  // 观察项：content_json 包含 observation_dimensions 白名单
  const obsStmt = db.prepare(
    `INSERT INTO question_bank
       (question_id, job_code, bank_domain, job_module_code, question_type, item_usage,
        content_json, scoring_rule_json, status)
     VALUES (?, 'SUPERMARKET_SHELVER', 'JOB_SPECIFIC', ?, 'TRUE_FALSE', 'OBSERVATION_ONLY',
             ?, '{"seed":true}', 'ACTIVE')`
  )

  for (const mod of JOB_MODULES) {
    for (const qtype of JOB_ONLINE_TYPES) {
      const id = `${mod}_${qtype.slice(0, 2)}_${uuidv4().slice(0, 6)}`
      const content =
        qtype === 'TRUE_FALSE' ? { question_type: 'TRUE_FALSE', expected_answer: true } : { seed: true }
      onlineStmt.run(id, mod, qtype, JSON.stringify(content))
      onlineIds.push(id)
    }
    const offId = `${mod}_OP_${uuidv4().slice(0, 6)}`
    offlineStmt.run(offId, mod)
    offlineIds.push(offId)
  }
  for (const mod of ['M1', 'M5'] as const) {
    const id = `${mod}_OB_${uuidv4().slice(0, 6)}`
    const obsContent = JSON.stringify({
      seed: true,
      administration: { observation_dimensions: ['SAFETY_AWARENESS', 'TOOL_USE'] }
    })
    obsStmt.run(id, mod, obsContent)
    obsIds.push(id)
  }

  return { onlineIds, offlineIds, obsIds }
}

function seedJobSkillStrategy(
  db: MemoryAdapter,
  ids: { onlineIds: string[]; offlineIds: string[]; obsIds: string[] }
): string {
  const strategyId = `strategy_obs_test_${uuidv4().slice(0, 6)}`
  const scoredIds = [...ids.onlineIds, ...ids.offlineIds]
  const policy = {
    schema_version: 'question-policy-v1.2',
    bank_domain: 'JOB_SPECIFIC',
    selection_mode: 'FIXED_SET',
    job_module_quotas: Object.fromEntries(JOB_MODULES.map((m) => [m, { online: 3, offline: 1 }])),
    fixed_scored_question_ids: scoredIds,
    embedded_observation_question_ids: ids.obsIds,
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
     VALUES (?, 'JOB_SKILL_ASSESSMENT', 'SUPERMARKET_SHELVER', 'OBS 测试策略',
             18, 6, 48, 40, 24, 0.5, 3, ?,
             '{"schema_version":"scoring-policy-v1.1","online_score_values":[0,2],"offline_score_values":[0,1,2],"normalization":"raw_score/max_score*100","safety_override_enabled":true,"placement_advice_enabled":false}',
             1, 1, 1, 1, 1)`
  ).run(strategyId, JSON.stringify(policy))
  return strategyId
}

function makeObsPayload(overrides: Partial<TeacherObservationPayload> = {}): TeacherObservationPayload {
  return {
    schema_version: 'teacher-observation-v1.0',
    observation_code: 'OBS_SAFETY',
    observed: true,
    behavior_codes: ['SAFETY_AWARENESS'],
    prompt_level: null,
    accommodations_used: [],
    observation_note: null,
    recorded_by: 'test-teacher',
    recorded_at: '2024-01-01T00:00:00.000Z',
    ...overrides
  }
}

// ─── 全局状态 ──────────────────────────────────────────────────────────────────

let db: MemoryAdapter
let callerId: string
let studentId: string
let strategyId: string
let bankIds: { onlineIds: string[]; offlineIds: string[]; obsIds: string[] }
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

/** 创建 JOB_SKILL session（ACTIVE 状态，可录入观察）。*/
function createActiveSession(): string {
  const result = createSession(db, baseParams())
  if (!result.success) throw new Error('createSession failed in test setup')
  return result.sessionId
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

// ─── 测试用例 ──────────────────────────────────────────────────────────────────

describe('TC-I: TEACHER_OBSERVATION 录入', () => {
  it('TC-I02 录入观察记录写 offline_score_record(score=NULL, score_scope=TEACHER_OBSERVATION)', () => {
    const sessionId = createActiveSession()
    const questionId = bankIds.obsIds[0]

    const result = recordTeacherObservation(db, {
      callerUserId: callerId,
      callerRole: 'TEACHER',
      sessionId,
      questionId,
      observationPayload: makeObsPayload()
    })
    expect(result.success).toBe(true)
    if (!result.success) return

    const row = db
      .prepare(
        `SELECT score, score_scope, observation_payload_json
           FROM offline_score_record
          WHERE offline_score_id = ?`
      )
      .get(result.offlineScoreId) as {
        score: number | null
        score_scope: string
        observation_payload_json: string
      } | undefined

    expect(row).toBeDefined()
    expect(row!.score).toBeNull()                               // TC-I02: score=NULL
    expect(row!.score_scope).toBe('TEACHER_OBSERVATION')
    expect(JSON.parse(row!.observation_payload_json)).toMatchObject({
      schema_version: 'teacher-observation-v1.0',
      observed: true
    })
  })

  it('TC-I05 录入后 domain_event_projection 有 TEACHER_OBSERVATION_RECORDED 事件', () => {
    const sessionId = createActiveSession()
    const questionId = bankIds.obsIds[0]

    const result = recordTeacherObservation(db, {
      callerUserId: callerId,
      callerRole: 'TEACHER',
      sessionId,
      questionId,
      observationPayload: makeObsPayload({ observation_code: 'OBS_TOOL', behavior_codes: ['TOOL_USE'] })
    })
    expect(result.success).toBe(true)

    const eventRow = db
      .prepare(
        `SELECT event_type, payload_json
           FROM domain_event_projection
          WHERE aggregate_id = ? AND event_type = 'TEACHER_OBSERVATION_RECORDED'
          ORDER BY event_sequence DESC LIMIT 1`
      )
      .get(sessionId) as { event_type: string; payload_json: string } | undefined

    expect(eventRow).toBeDefined()
    expect(eventRow!.event_type).toBe('TEACHER_OBSERVATION_RECORDED')
    const payload = JSON.parse(eventRow!.payload_json)
    expect(payload.observation_payload.observation_code).toBe('OBS_TOOL')
    expect(payload.observation_payload.behavior_codes).toContain('TOOL_USE')
  })

  it('STUDENT 身份被拒绝（FORBIDDEN）', () => {
    const sessionId = createActiveSession()
    const result = recordTeacherObservation(db, {
      callerUserId: studentId,
      callerRole: 'STUDENT',
      sessionId,
      questionId: bankIds.obsIds[0],
      observationPayload: makeObsPayload()
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.errorCode).toBe('FORBIDDEN')
  })

  it('session 不存在返回 NOT_FOUND', () => {
    const result = recordTeacherObservation(db, {
      callerUserId: callerId,
      callerRole: 'TEACHER',
      sessionId: 'nonexistent-session',
      questionId: bankIds.obsIds[0],
      observationPayload: makeObsPayload()
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.errorCode).toBe('NOT_FOUND')
  })

  it('非 JOB_SKILL_ASSESSMENT session 返回 SESSION_WRONG_STRATEGY', () => {
    // 需要一个真实的 BASELINE_ASSESSMENT 策略 + session，才能绕过 schema 触发器校验
    const baselineStrategyId = `strategy_baseline_${uuidv4().slice(0, 6)}`
    db.prepare(
      `INSERT INTO strategy_config
         (strategy_id, strategy_type, job_code, strategy_name,
          online_question_count, offline_question_count, max_score,
          competent_threshold, conditional_threshold, module_veto_threshold,
          emotion_collapse_threshold, question_policy_json, scoring_policy_json,
          supports_redline_halt, allows_emotion_interrupt, requires_offline_scoring,
          version, is_active)
       VALUES (?, 'BASELINE_ASSESSMENT', 'SUPERMARKET_SHELVER', 'Baseline 测试',
               10, 0, 20, 60, 40, 0.5, 3,
               '{"schema_version":"question-policy-v1.0","bank_domain":"GENERAL","question_ratio":{"TRUE_FALSE":5,"SINGLE_CHOICE":5}}',
               '{"schema_version":"scoring-policy-v1.0","level_rules":[{"level":"LEVEL_COMPETENT","min":60},{"level":"LEVEL_CONDITIONAL","min":40},{"level":"LEVEL_NOT_COMPETENT","min":0}],"score_values":{"TRUE_FALSE":2,"SINGLE_CHOICE":2},"safety_override_enabled":true,"placement_advice_enabled":true}',
               0, 1, 0, 1, 1)`
    ).run(baselineStrategyId)

    const fakeSessionId = uuidv4()
    db.prepare(
      `INSERT INTO assessment_session
         (session_id, student_id, strategy_id, strategy_version, strategy_type,
          job_code, task_code, status, online_question_count, offline_question_count, created_by)
       VALUES (?, ?, ?, 1, 'BASELINE_ASSESSMENT', 'SUPERMARKET_SHELVER', 'SHELVE_TASK', 'ACTIVE', 0, 0, ?)`
    ).run(fakeSessionId, studentId, baselineStrategyId, callerId)

    const result = recordTeacherObservation(db, {
      callerUserId: callerId,
      callerRole: 'TEACHER',
      sessionId: fakeSessionId,
      questionId: bankIds.obsIds[0],
      observationPayload: makeObsPayload()
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.errorCode).toBe('SESSION_WRONG_STRATEGY')
  })

  it('终态 session 返回 SESSION_TERMINATED', () => {
    const sessionId = createActiveSession()
    db.prepare(`UPDATE assessment_session SET status = 'COMPLETED' WHERE session_id = ?`).run(sessionId)

    const result = recordTeacherObservation(db, {
      callerUserId: callerId,
      callerRole: 'TEACHER',
      sessionId,
      questionId: bankIds.obsIds[0],
      observationPayload: makeObsPayload()
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.errorCode).toBe('SESSION_TERMINATED')
  })

  it('非 OBSERVATION 题返回 QUESTION_NOT_OBSERVATION', () => {
    const sessionId = createActiveSession()
    const result = recordTeacherObservation(db, {
      callerUserId: callerId,
      callerRole: 'TEACHER',
      sessionId,
      questionId: bankIds.onlineIds[0],  // 线上题，非 OBSERVATION phase
      observationPayload: makeObsPayload()
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.errorCode).toBe('QUESTION_NOT_OBSERVATION')
  })

  it('behavior_codes 超出 observation_dimensions 白名单返回 INVALID_BEHAVIOR_CODE', () => {
    const sessionId = createActiveSession()
    const result = recordTeacherObservation(db, {
      callerUserId: callerId,
      callerRole: 'TEACHER',
      sessionId,
      questionId: bankIds.obsIds[0],
      observationPayload: makeObsPayload({ behavior_codes: ['INVALID_CODE_XYZ'] })
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.errorCode).toBe('INVALID_BEHAVIOR_CODE')
  })

  it('重复录入同一观察题返回 ALREADY_RECORDED', () => {
    const sessionId = createActiveSession()
    const questionId = bankIds.obsIds[0]
    const params = {
      callerUserId: callerId,
      callerRole: 'TEACHER',
      sessionId,
      questionId,
      observationPayload: makeObsPayload()
    }
    const first = recordTeacherObservation(db, params)
    expect(first.success).toBe(true)

    const second = recordTeacherObservation(db, params)
    expect(second.success).toBe(false)
    if (second.success) return
    expect(second.errorCode).toBe('ALREADY_RECORDED')
  })

  it('getTeacherObservations 返回 session 已录入的观察记录', () => {
    const sessionId = createActiveSession()
    recordTeacherObservation(db, {
      callerUserId: callerId, callerRole: 'TEACHER',
      sessionId, questionId: bankIds.obsIds[0],
      observationPayload: makeObsPayload()
    })
    recordTeacherObservation(db, {
      callerUserId: callerId, callerRole: 'TEACHER',
      sessionId, questionId: bankIds.obsIds[1],
      observationPayload: makeObsPayload({ observation_code: 'OBS_M5' })
    })

    const result = getTeacherObservations(db, {
      callerUserId: callerId, callerRole: 'TEACHER', sessionId
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.records).toHaveLength(2)
    expect(result.records[1].observationPayload.observation_code).toBe('OBS_M5')
  })
})
