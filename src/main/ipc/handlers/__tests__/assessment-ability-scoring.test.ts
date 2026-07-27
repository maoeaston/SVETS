// F6-3: BASE_ABILITY 线下评分提交/读取入口测试。
// 覆盖 OFFLINE_ABILITY scope、部分补交、重复提交拒绝和事务回滚。

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { v4 as uuidv4 } from 'uuid'

const { mockState } = vi.hoisted(() => ({
  mockState: {
    db: null as unknown as import('../../../db/interface').DBAdapter,
    callCount: 0,
    failOnCall: null as number | null
  }
}))

vi.mock('../../../domain/event-writer', () => ({
  writeEvent: vi.fn(
    (params: import('../../../domain/event-writer').WriteEventParams): import('@shared/types/event-payloads').ActionLogEntry => {
      if (!mockState.db) throw new Error('mock writeEvent: mockState.db not set')
      mockState.callCount += 1
      if (mockState.failOnCall === mockState.callCount) {
        throw new Error(`mock writeEvent failure at call ${mockState.callCount}`)
      }

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
          entry.event_id,
          entry.aggregate_type,
          entry.aggregate_id,
          entry.event_type,
          entry.event_sequence,
          JSON.stringify(entry.payload),
          entry.checksum,
          'test.jsonl',
          entry.schema_version,
          entry.created_at
        )
      return entry
    }
  )
}))

import { calculateResult, createSession, seedAssessmentErrorCodes } from '../assessment'
import {
  getOfflineAbilityScores,
  submitOfflineAbilityScores
} from '../ability-scoring'
import {
  baseStrategyInput,
  createTestDb,
  seedAssessmentSessionFixture,
  seedCaller,
  seedQuestionBank,
  seedStudent,
  setAssessmentSessionStateFixture
} from '../../../db/test-helpers'
import type { MemoryAdapter } from '../../../db/memory-adapter'
import type { DBAdapter } from '../../../db/interface'
import type { StrategyInput } from '../../../../shared/types/strategy'
import type { AbilityOfflineScoreItem } from '../../../../shared/types/ability-scoring'

let db: MemoryAdapter
let teacherId: string
let adminId: string
let studentId: string
let strategyId: string
let consoleErrorSpy: ReturnType<typeof vi.spyOn>

const taskCode = 'SHELVE_TASK'

function seedStrategyConfig(db: DBAdapter, over: Partial<StrategyInput> = {}): string {
  const s = baseStrategyInput({
    strategyId: `ability-scoring-${uuidv4().slice(0, 8)}`,
    strategyType: 'BASELINE_ASSESSMENT',
    jobCode: 'SUPERMARKET_SHELVER',
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

function createOfflinePendingSession(strategyIdForSession = strategyId): { sessionId: string; offlineQuestionIds: string[]; onlineQuestionId: string } {
  const result = createSession(db, {
    callerUserId: teacherId,
    callerRole: 'TEACHER',
    studentId,
    strategyId: strategyIdForSession,
    strategyVersion: 1,
    taskCode
  })
  if (!result.success) throw new Error(`createSession failed: ${JSON.stringify(result)}`)
  setAssessmentSessionStateFixture(db, result.sessionId, 'OFFLINE_PENDING', 'ONLINE_COMPLETED')

  const offlineQuestionIds = (
    db
      .prepare(
        `SELECT question_id
           FROM assessment_session_question
          WHERE session_id = ?
            AND bank_domain = 'BASE_ABILITY'
            AND question_phase = 'OFFLINE'
            AND item_usage = 'SCORED_ITEM'
          ORDER BY question_order`
      )
      .all(result.sessionId) as Array<{ question_id: string }>
  ).map((row) => row.question_id)

  const onlineQuestion = db
    .prepare(
      `SELECT question_id
         FROM assessment_session_question
        WHERE session_id = ?
          AND question_phase = 'ONLINE'
        ORDER BY question_order
        LIMIT 1`
    )
    .get(result.sessionId) as { question_id: string }

  return {
    sessionId: result.sessionId,
    offlineQuestionIds,
    onlineQuestionId: onlineQuestion.question_id
  }
}

function validScores(questionIds: string[], score: 0 | 1 | 2 = 2): AbilityOfflineScoreItem[] {
  return questionIds.map((questionId, index) => ({
    questionId,
    score,
    scoringRubricJson: JSON.stringify({
      rubric_id: `base-offline-${index + 1}`,
      max_score: 2
    }),
    observationNote: `note-${index + 1}`,
    toolChecklistConfirmed: index % 2 === 0
  }))
}

function countRows(sql: string, ...params: unknown[]): number {
  const row = db.prepare(sql).get(...params) as { n: number }
  return row.n
}

function insertDomainEvent(eventType: string, aggregateId: string): string {
  const eventId = uuidv4()
  const row = db
    .prepare('SELECT MAX(event_sequence) AS max_seq FROM domain_event_projection WHERE aggregate_id = ?')
    .get(aggregateId) as { max_seq: number | null }
  const eventSequence = (row.max_seq ?? 0) + 1
  db.prepare(
    `INSERT INTO domain_event_projection
       (event_id, aggregate_type, aggregate_id, event_type, event_sequence,
        payload_json, checksum, source_log_path, schema_version, created_at)
     VALUES (?, 'ASSESSMENT_SESSION', ?, ?, ?, '{}', 'c', 'l', 1, '2026-07-01T00:00:00.000Z')`
  ).run(eventId, aggregateId, eventType, eventSequence)
  return eventId
}

function seedValidOnlineAnswers(sessionId: string): void {
  const rows = db
    .prepare(
      `SELECT question_id, question_type
         FROM assessment_session_question
        WHERE session_id = ?
          AND bank_domain = 'BASE_ABILITY'
          AND question_phase = 'ONLINE'
        ORDER BY question_order`
    )
    .all(sessionId) as Array<{ question_id: string; question_type: string }>

  for (const row of rows) {
    db.prepare(
      `INSERT INTO answer_record
         (answer_id, session_id, question_id, question_type, answer_payload_json,
          is_correct, score, submitted_event_id)
       VALUES (?, ?, ?, ?, '{"answer":true}', 1, 2, ?)`
    ).run(uuidv4(), sessionId, row.question_id, row.question_type, insertDomainEvent('ANSWER_SUBMITTED', sessionId))
  }
}

function seedJobSkillAndOperationNoise(sessionId: string): void {
  const onlineJobQuestionId = `job-online-noise-${uuidv4()}`
  db.prepare(
    `INSERT INTO question_bank
       (question_id, job_code, bank_domain, job_module_code, question_type,
        item_usage, content_json, scoring_rule_json, status)
     VALUES (?, 'SUPERMARKET_SHELVER', 'JOB_SPECIFIC', 'M1', 'TRUE_FALSE',
             'SCORED_ITEM', '{"seed":true}', '{"seed":true}', 'ACTIVE')`
  ).run(onlineJobQuestionId)
  db.prepare(
    `INSERT INTO assessment_session_question
       (session_question_id, session_id, question_id, question_order, question_phase,
        bank_domain, module_type, job_module_code, question_type, item_usage)
     VALUES (?, ?, ?, 1001, 'ONLINE',
             'JOB_SPECIFIC', NULL, 'M1', 'TRUE_FALSE', 'SCORED_ITEM')`
  ).run(uuidv4(), sessionId, onlineJobQuestionId)
  db.prepare(
    `INSERT INTO answer_record
       (answer_id, session_id, question_id, question_type, answer_payload_json,
        is_correct, score, submitted_event_id, status)
     VALUES (?, ?, ?, 'TRUE_FALSE', '{"answer":true}', 1, 2, ?, 'VALID')`
  ).run(uuidv4(), sessionId, onlineJobQuestionId, insertDomainEvent('ANSWER_SUBMITTED', sessionId))

  const offlineJobQuestionId = `job-offline-noise-${uuidv4()}`
  db.prepare(
    `INSERT INTO question_bank
       (question_id, job_code, bank_domain, job_module_code, question_type,
        item_usage, content_json, scoring_rule_json, status)
     VALUES (?, 'SUPERMARKET_SHELVER', 'JOB_SPECIFIC', 'M2', 'OFFLINE_OPERATION',
             'SCORED_ITEM', '{"seed":true}', '{"seed":true}', 'ACTIVE')`
  ).run(offlineJobQuestionId)
  db.prepare(
    `INSERT INTO assessment_session_question
       (session_question_id, session_id, question_id, question_order, question_phase,
        bank_domain, module_type, job_module_code, question_type, item_usage)
     VALUES (?, ?, ?, 1002, 'OFFLINE',
             'JOB_SPECIFIC', NULL, 'M2', 'OFFLINE_OPERATION', 'SCORED_ITEM')`
  ).run(uuidv4(), sessionId, offlineJobQuestionId)
  db.prepare(
    `INSERT INTO offline_score_record
       (offline_score_id, session_id, question_id, score_scope, task_operation_code,
        score, scoring_rubric_json, scored_by, scored_event_id, tool_checklist_confirmed)
     VALUES (?, ?, ?, 'JOB_SKILL', NULL, 2, '{}', ?, ?, 1)`
  ).run(uuidv4(), sessionId, offlineJobQuestionId, teacherId, insertDomainEvent('OFFLINE_SCORE_SUBMITTED', sessionId))

  const observationQuestionId = `job-observation-noise-${uuidv4()}`
  db.prepare(
    `INSERT INTO question_bank
       (question_id, job_code, bank_domain, job_module_code, question_type,
        item_usage, content_json, scoring_rule_json, status)
     VALUES (?, 'SUPERMARKET_SHELVER', 'JOB_SPECIFIC', 'M3', 'TRUE_FALSE',
             'OBSERVATION_ONLY', '{"seed":true}', '{"seed":true}', 'ACTIVE')`
  ).run(observationQuestionId)
  db.prepare(
    `INSERT INTO assessment_session_question
       (session_question_id, session_id, question_id, question_order, question_phase,
        bank_domain, module_type, job_module_code, question_type, item_usage)
     VALUES (?, ?, ?, 1003, 'OBSERVATION',
             'JOB_SPECIFIC', NULL, 'M3', 'TRUE_FALSE', 'OBSERVATION_ONLY')`
  ).run(uuidv4(), sessionId, observationQuestionId)
  db.prepare(
    `INSERT INTO offline_score_record
       (offline_score_id, session_id, question_id, score_scope, task_operation_code,
        score, observation_payload_json, scored_by, scored_event_id, tool_checklist_confirmed)
     VALUES (?, ?, ?, 'TEACHER_OBSERVATION', NULL,
             NULL, '{"observed":true}', ?, ?, 0)`
  ).run(uuidv4(), sessionId, observationQuestionId, teacherId, insertDomainEvent('TEACHER_OBSERVATION_RECORDED', sessionId))

  db.prepare(
    `INSERT INTO offline_score_record
       (offline_score_id, session_id, question_id, score_scope, task_operation_code,
        score, scoring_rubric_json, scored_by, scored_event_id, tool_checklist_confirmed)
     VALUES (?, ?, NULL, 'TASK_OPERATION', 'IDENTIFY_BOX', 2, '{}', ?, ?, 1)`
  ).run(uuidv4(), sessionId, teacherId, insertDomainEvent('OFFLINE_SCORE_SUBMITTED', sessionId))
}

beforeAll(async () => {
  db = await createTestDb()
  db.exec('DROP TRIGGER IF EXISTS trg_assessment_session_no_delete')
})

afterAll(() => {
  consoleErrorSpy?.mockRestore()
  db.close()
})

beforeEach(() => {
  db.exec('DELETE FROM offline_score_record')
  db.exec('DELETE FROM result_record')
  db.exec('DELETE FROM answer_record')
  db.exec('DELETE FROM assessment_session_question')
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
  teacherId = seedCaller(db, 'TEACHER')
  adminId = seedCaller(db, 'ADMIN')
  studentId = seedStudent(db)
  strategyId = seedStrategyConfig(db)
  seedQuestionBank(db)
  mockState.db = db
  mockState.callCount = 0
  mockState.failOnCall = null
  consoleErrorSpy?.mockRestore()
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('assessment:submitOfflineAbilityScores', () => {
  it('教师提交 8 道 BASE_ABILITY 线下题，写入显式 OFFLINE_ABILITY 且不生成结果', () => {
    const { sessionId, offlineQuestionIds } = createOfflinePendingSession()

    const result = submitOfflineAbilityScores(db, {
      callerUserId: teacherId,
      callerRole: 'TEACHER',
      sessionId,
      scores: validScores(offlineQuestionIds, 2)
    })

    expect(result).toMatchObject({
      success: true,
      itemsScored: 8,
      totalScored: 8,
      totalRequired: 8,
      isComplete: true
    })

    const rows = db
      .prepare(
        `SELECT question_id, score_scope, score, scoring_rubric_json, tool_checklist_confirmed
           FROM offline_score_record
          WHERE session_id = ?
          ORDER BY rowid`
      )
      .all(sessionId) as Array<{
        question_id: string
        score_scope: string
        score: number
        scoring_rubric_json: string
        tool_checklist_confirmed: number
      }>
    expect(rows).toHaveLength(8)
    expect(rows.every((row) => row.score_scope === 'OFFLINE_ABILITY')).toBe(true)
    expect(rows.every((row) => offlineQuestionIds.includes(row.question_id))).toBe(true)
    expect(rows.every((row) => row.score === 2)).toBe(true)
    expect(JSON.parse(rows[0].scoring_rubric_json)).toMatchObject({ max_score: 2 })
    expect(rows.some((row) => row.tool_checklist_confirmed === 1)).toBe(true)

    const eventPayloads = db
      .prepare(
        `SELECT payload_json
           FROM domain_event_projection
          WHERE aggregate_id = ?
            AND event_type = 'OFFLINE_SCORE_SUBMITTED'
          ORDER BY event_sequence`
      )
      .all(sessionId) as Array<{ payload_json: string }>
    expect(eventPayloads).toHaveLength(8)
    expect(eventPayloads.every((row) => JSON.parse(row.payload_json).score_scope === 'OFFLINE_ABILITY')).toBe(true)

    const session = db
      .prepare('SELECT status, delivery_phase FROM assessment_session WHERE session_id = ?')
      .get(sessionId) as { status: string; delivery_phase: string }
    expect(session.status).toBe('OFFLINE_PENDING')
    expect(session.delivery_phase).toBe('OFFLINE_SCORING')
    expect(countRows(
      `SELECT COUNT(*) AS n
         FROM result_record
        WHERE source_aggregate_id = ?
          AND result_type = 'ABILITY_SCORE'`,
      sessionId
    )).toBe(0)
    expect(countRows(
      `SELECT COUNT(*) AS n
         FROM domain_event_projection
        WHERE aggregate_id = ?
          AND event_type = 'SESSION_COMPLETED'`,
      sessionId
    )).toBe(0)
  })

  it('M4：其他 job 的安全事件不阻断 session 所属 job 的评分', () => {
    const otherJobCode = 'WAREHOUSE_PICKER'
    const otherStrategyId = seedStrategyConfig(db, { jobCode: otherJobCode })
    seedQuestionBank(db, { jobCode: otherJobCode })
    const { sessionId, offlineQuestionIds } = createOfflinePendingSession(otherStrategyId)
    const incidentId = uuidv4()
    const triggerEventId = uuidv4()
    db.prepare(
      `INSERT INTO domain_event_projection
         (event_id, aggregate_type, aggregate_id, event_type, event_sequence,
          payload_json, checksum, source_log_path, schema_version, created_at)
       VALUES (?, 'SAFETY_INCIDENT', ?, 'SAFETY_INCIDENT_CREATED', 1, '{}', 'c', 'l', 1, datetime('now'))`
    ).run(triggerEventId, incidentId)
    db.prepare(
      `INSERT INTO safety_incident
         (incident_id, student_id, job_code, task_code, trigger_event_id,
          reason_code, triggered_by, context_phase, status, requires_review_before_next_session)
       VALUES (?, ?, 'SUPERMARKET_SHELVER', ?, ?,
               'OTHER_SAFETY_RISK', ?, 'OTHER', 'PENDING_DETAIL', 1)`
    ).run(incidentId, studentId, taskCode, triggerEventId, teacherId)

    expect(submitOfflineAbilityScores(db, {
      callerUserId: teacherId,
      callerRole: 'TEACHER',
      sessionId,
      scores: validScores([offlineQuestionIds[0]])
    }).success).toBe(true)
  })

  it('允许部分补交，重复提交同一题返回 ALREADY_SCORED', () => {
    const { sessionId, offlineQuestionIds } = createOfflinePendingSession()
    const first = submitOfflineAbilityScores(db, {
      callerUserId: adminId,
      callerRole: 'ADMIN',
      sessionId,
      scores: validScores(offlineQuestionIds.slice(0, 3), 1)
    })
    expect(first).toMatchObject({
      success: true,
      itemsScored: 3,
      totalScored: 3,
      totalRequired: 8,
      isComplete: false
    })

    const repeated = submitOfflineAbilityScores(db, {
      callerUserId: adminId,
      callerRole: 'ADMIN',
      sessionId,
      scores: validScores([offlineQuestionIds[0]], 2)
    })
    expect(repeated).toEqual({ success: false, errorCode: 'ALREADY_SCORED' })

    const second = submitOfflineAbilityScores(db, {
      callerUserId: teacherId,
      callerRole: 'TEACHER',
      sessionId,
      scores: validScores(offlineQuestionIds.slice(3), 2)
    })
    expect(second).toMatchObject({
      success: true,
      itemsScored: 5,
      totalScored: 8,
      totalRequired: 8,
      isComplete: true
    })
  })

  it('拒绝学生、非 OFFLINE_PENDING 会话和非线下基础能力题', () => {
    const { sessionId, offlineQuestionIds, onlineQuestionId } = createOfflinePendingSession()

    expect(submitOfflineAbilityScores(db, {
      callerUserId: studentId,
      callerRole: 'STUDENT',
      sessionId,
      scores: validScores([offlineQuestionIds[0]])
    })).toEqual({ success: false, errorCode: 'FORBIDDEN' })

    const activeSession = createSession(db, {
      callerUserId: teacherId,
      callerRole: 'TEACHER',
      studentId,
      strategyId,
      strategyVersion: 1,
      taskCode: `${taskCode}_ACTIVE`
    })
    expect(activeSession.success).toBe(true)
    if (!activeSession.success) return
    setAssessmentSessionStateFixture(db, activeSession.sessionId, 'ACTIVE', 'ONLINE_IN_PROGRESS')
    expect(submitOfflineAbilityScores(db, {
      callerUserId: teacherId,
      callerRole: 'TEACHER',
      sessionId: activeSession.sessionId,
      scores: validScores([offlineQuestionIds[0]])
    })).toEqual({ success: false, errorCode: 'SESSION_NOT_OFFLINE_PENDING' })

    expect(submitOfflineAbilityScores(db, {
      callerUserId: teacherId,
      callerRole: 'TEACHER',
      sessionId,
      scores: validScores([onlineQuestionId])
    })).toEqual({ success: false, errorCode: 'VALIDATION_ERROR' })
  })

  it('评分 JSON 非法、重复 questionId 或非 BASELINE/MOCK session 时返回 VALIDATION_ERROR', () => {
    const { sessionId, offlineQuestionIds } = createOfflinePendingSession()

    expect(submitOfflineAbilityScores(db, {
      callerUserId: teacherId,
      callerRole: 'TEACHER',
      sessionId,
      scores: [{ ...validScores([offlineQuestionIds[0]])[0], scoringRubricJson: '{bad' }]
    })).toEqual({ success: false, errorCode: 'VALIDATION_ERROR' })

    expect(submitOfflineAbilityScores(db, {
      callerUserId: teacherId,
      callerRole: 'TEACHER',
      sessionId,
      scores: validScores([offlineQuestionIds[0], offlineQuestionIds[0]])
    })).toEqual({ success: false, errorCode: 'VALIDATION_ERROR' })

    const jobStrategyId = seedStrategyConfig(db, {
      strategyId: `job-strategy-${uuidv4().slice(0, 8)}`,
      strategyType: 'JOB_SKILL_ASSESSMENT'
    })
    const jobSessionId = seedAssessmentSessionFixture(db, {
      studentId,
      strategyId: jobStrategyId,
      strategyType: 'JOB_SKILL_ASSESSMENT',
      taskCode: 'JOB_SKILL_DEMO_M1M6',
      status: 'OFFLINE_PENDING',
      deliveryPhase: 'ONLINE_COMPLETED',
      onlineQuestionCount: 18,
      offlineQuestionCount: 6,
      createdBy: teacherId
    })
    expect(submitOfflineAbilityScores(db, {
      callerUserId: teacherId,
      callerRole: 'TEACHER',
      sessionId: jobSessionId,
      scores: validScores([offlineQuestionIds[0]])
    })).toEqual({ success: false, errorCode: 'VALIDATION_ERROR' })
  })

  it('任一评分事件写入失败时，整批 OFFLINE_ABILITY 和事件投影回滚', () => {
    const { sessionId, offlineQuestionIds } = createOfflinePendingSession()
    mockState.callCount = 0
    mockState.failOnCall = 2

    const result = submitOfflineAbilityScores(db, {
      callerUserId: teacherId,
      callerRole: 'TEACHER',
      sessionId,
      scores: validScores(offlineQuestionIds, 1)
    })

    expect(result).toEqual({ success: false, errorCode: 'ASSESSMENT_SYSTEM_ERROR' })
    expect(countRows(
      `SELECT COUNT(*) AS n
         FROM offline_score_record
        WHERE session_id = ?
          AND score_scope = 'OFFLINE_ABILITY'`,
      sessionId
    )).toBe(0)
    expect(countRows(
      `SELECT COUNT(*) AS n
         FROM domain_event_projection
        WHERE aggregate_id = ?
          AND event_type = 'OFFLINE_SCORE_SUBMITTED'`,
      sessionId
    )).toBe(0)
    const session = db
      .prepare(
        `SELECT status, delivery_phase, event_sequence_version
           FROM assessment_session
          WHERE session_id = ?`
      )
      .get(sessionId) as { status: string; delivery_phase: string; event_sequence_version: number }
    expect(session.status).toBe('OFFLINE_PENDING')
    expect(session.delivery_phase).toBe('ONLINE_COMPLETED')
    expect(session.event_sequence_version).toBe(1)
  })
})

describe('assessment:calculateResult 基础能力正常结算', () => {
  it('42 道线上题 + 8 道 OFFLINE_ABILITY 全量完成后生成 ABILITY_SCORE 并完成 session，重复调用幂等', () => {
    const { sessionId, offlineQuestionIds } = createOfflinePendingSession()
    seedValidOnlineAnswers(sessionId)
    const submitted = submitOfflineAbilityScores(db, {
      callerUserId: teacherId,
      callerRole: 'TEACHER',
      sessionId,
      scores: validScores(offlineQuestionIds, 2)
    })
    expect(submitted.success).toBe(true)
    seedJobSkillAndOperationNoise(sessionId)

    const result = calculateResult(db, {
      callerUserId: teacherId,
      callerRole: 'TEACHER',
      sessionId
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.levelResult).toBe('LEVEL_COMPETENT')
    expect(result.normalizedScore).toBe(100)

    const rr = db
      .prepare(
        `SELECT result_id, result_type, strategy_type, raw_score, max_score,
                normalized_score, completion_ratio, result_payload_json
           FROM result_record
          WHERE source_aggregate_id = ?
            AND result_type = 'ABILITY_SCORE'
            AND is_current = 1`
      )
      .get(sessionId) as {
        result_id: string
        result_type: string
        strategy_type: string
        raw_score: number
        max_score: number
        normalized_score: number
        completion_ratio: number
        result_payload_json: string
      } | undefined
    expect(rr).toBeDefined()
    expect(rr!.result_id).toBe(result.resultId)
    expect(rr).toMatchObject({
      result_type: 'ABILITY_SCORE',
      strategy_type: 'BASELINE_ASSESSMENT',
      raw_score: 100,
      max_score: 100,
      normalized_score: 100,
      completion_ratio: 1
    })
    const payload = JSON.parse(rr!.result_payload_json) as {
      online_raw_score: number
      offline_raw_score: number
      question_count: number
      answered_count: number
      completion_ratio: number
      module_scores: unknown[]
    }
    expect(payload).toMatchObject({
      online_raw_score: 84,
      offline_raw_score: 16,
      question_count: 50,
      answered_count: 50,
      completion_ratio: 1
    })
    expect(payload.module_scores).toHaveLength(6)
    expect(countRows(
      `SELECT COUNT(*) AS n
         FROM offline_score_record
        WHERE session_id = ?
          AND score_scope IN ('JOB_SKILL', 'TASK_OPERATION', 'TEACHER_OBSERVATION')`,
      sessionId
    )).toBe(3)

    const session = db
      .prepare('SELECT status, delivery_phase FROM assessment_session WHERE session_id = ?')
      .get(sessionId) as { status: string; delivery_phase: string }
    expect(session).toEqual({ status: 'COMPLETED', delivery_phase: 'FINALIZED' })

    const eventTypes = (
      db
        .prepare(
          `SELECT event_type
             FROM domain_event_projection
            WHERE aggregate_id = ?
              AND event_type IN ('RESULT_CALCULATED', 'SESSION_COMPLETED')
            ORDER BY event_sequence`
        )
        .all(sessionId) as Array<{ event_type: string }>
    ).map((row) => row.event_type)
    expect(eventTypes).toEqual(['RESULT_CALCULATED', 'SESSION_COMPLETED'])

    const repeated = calculateResult(db, {
      callerUserId: adminId,
      callerRole: 'ADMIN',
      sessionId
    })
    expect(repeated).toEqual({
      success: true,
      resultId: result.resultId,
      levelResult: 'LEVEL_COMPETENT',
      normalizedScore: 100
    })
    expect(countRows(
      `SELECT COUNT(*) AS n
         FROM result_record
        WHERE source_aggregate_id = ?
          AND result_type = 'ABILITY_SCORE'
          AND is_current = 1`,
      sessionId
    )).toBe(1)
    expect(countRows(
      `SELECT COUNT(*) AS n
         FROM domain_event_projection
        WHERE aggregate_id = ?
          AND event_type = 'SESSION_COMPLETED'`,
      sessionId
    )).toBe(1)
  })

  it('只有 TASK_OPERATION 评分且 OFFLINE_ABILITY 未完成时，不生成 ABILITY_SCORE', () => {
    const { sessionId } = createOfflinePendingSession()
    seedValidOnlineAnswers(sessionId)
    const taskEventId = insertDomainEvent('OFFLINE_SCORE_SUBMITTED', sessionId)
    db.prepare(
      `INSERT INTO offline_score_record
         (offline_score_id, session_id, question_id, score_scope, task_operation_code,
          score, scoring_rubric_json, scored_by, scored_event_id, tool_checklist_confirmed)
       VALUES (?, ?, NULL, 'TASK_OPERATION', 'IDENTIFY_BOX', 2, '{}', ?, ?, 1)`
    ).run(uuidv4(), sessionId, teacherId, taskEventId)

    const result = calculateResult(db, {
      callerUserId: teacherId,
      callerRole: 'TEACHER',
      sessionId
    })

    expect(result).toEqual({ success: false, errorCode: 'SESSION_NOT_ACTIVE' })
    expect(countRows(
      `SELECT COUNT(*) AS n
         FROM result_record
        WHERE source_aggregate_id = ?
          AND result_type = 'ABILITY_SCORE'`,
      sessionId
    )).toBe(0)
  })
})

describe('assessment:getOfflineAbilityScores', () => {
  it('只读取 OFFLINE_ABILITY，不混入 TASK_OPERATION 或 JOB_SKILL', () => {
    const { sessionId, offlineQuestionIds, onlineQuestionId } = createOfflinePendingSession()
    const submitted = submitOfflineAbilityScores(db, {
      callerUserId: teacherId,
      callerRole: 'TEACHER',
      sessionId,
      scores: validScores(offlineQuestionIds.slice(0, 1), 2)
    })
    expect(submitted.success).toBe(true)

    const taskEventId = insertDomainEvent('OFFLINE_SCORE_SUBMITTED', sessionId)
    db.prepare(
      `INSERT INTO offline_score_record
         (offline_score_id, session_id, question_id, score_scope, task_operation_code,
          score, scoring_rubric_json, scored_by, scored_event_id, tool_checklist_confirmed)
       VALUES (?, ?, NULL, 'TASK_OPERATION', 'IDENTIFY_BOX', 2, '{}', ?, ?, 1)`
    ).run(uuidv4(), sessionId, teacherId, taskEventId)

    const jobEventId = insertDomainEvent('OFFLINE_SCORE_SUBMITTED', sessionId)
    db.prepare(
      `INSERT INTO offline_score_record
         (offline_score_id, session_id, question_id, score_scope, task_operation_code,
          score, scoring_rubric_json, scored_by, scored_event_id, tool_checklist_confirmed)
       VALUES (?, ?, ?, 'JOB_SKILL', NULL, 1, '{}', ?, ?, 1)`
    ).run(uuidv4(), sessionId, onlineQuestionId, teacherId, jobEventId)

    const result = getOfflineAbilityScores(db, {
      callerUserId: teacherId,
      callerRole: 'TEACHER',
      sessionId
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({
      questionId: offlineQuestionIds[0],
      score: 2,
      toolChecklistConfirmed: true
    })
    expect(result.totalRequired).toBe(8)
    expect(result.totalScored).toBe(1)
    expect(result.isComplete).toBe(false)
  })

  it('不存在 session 返回 NOT_FOUND，学生读取返回 FORBIDDEN', () => {
    expect(getOfflineAbilityScores(db, {
      callerUserId: teacherId,
      callerRole: 'TEACHER',
      sessionId: 'missing'
    })).toEqual({ success: false, errorCode: 'NOT_FOUND' })

    const { sessionId } = createOfflinePendingSession()
    expect(getOfflineAbilityScores(db, {
      callerUserId: studentId,
      callerRole: 'STUDENT',
      sessionId
    })).toEqual({ success: false, errorCode: 'FORBIDDEN' })
  })
})
