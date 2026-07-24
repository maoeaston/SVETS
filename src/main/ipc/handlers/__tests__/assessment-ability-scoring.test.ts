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

import { createSession, seedAssessmentErrorCodes } from '../assessment'
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

function createOfflinePendingSession(): { sessionId: string; offlineQuestionIds: string[]; onlineQuestionId: string } {
  const result = createSession(db, {
    callerUserId: teacherId,
    callerRole: 'TEACHER',
    studentId,
    strategyId,
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
