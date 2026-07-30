// 实操评分 handler 集成测试：覆盖 TASK_OPERATION 批次原子性与 M2 阶段投影。

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

import {
  submitOperationScores,
  getOperationScores
} from '../../../application/services/__tests__/scoring-test-support'
import {
  baseStrategyInput,
  createTestDb,
  seedAssessmentSessionFixture,
  seedCaller,
  seedStudent
} from '../../../db/test-helpers'
import { TASK_OPERATION_CODES } from '../../../../shared/types/operation-scoring'
import type { MemoryAdapter } from '../../../db/memory-adapter'
import type { DBAdapter } from '../../../db/interface'
import type { StrategyInput } from '../../../../shared/types/strategy'
import type { ScoreItem } from '../../../../shared/types/operation-scoring'

let db: MemoryAdapter
let teacherId: string
let studentId: string
let strategyId: string
let consoleErrorSpy: ReturnType<typeof vi.spyOn>

function seedStrategyConfig(db: DBAdapter, over: Partial<StrategyInput> = {}): string {
  const s = baseStrategyInput({
    strategyId: `operation-scoring-${uuidv4().slice(0, 8)}`,
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

function createOfflinePendingSession(over: { strategyId?: string; jobCode?: string } = {}): string {
  return seedAssessmentSessionFixture(db, {
    studentId,
    strategyId: over.strategyId ?? strategyId,
    strategyType: 'BASELINE_ASSESSMENT',
    jobCode: over.jobCode ?? 'SUPERMARKET_SHELVER',
    taskCode: 'SHELVE_TASK',
    strategyVersion: 1,
    status: 'OFFLINE_PENDING',
    onlineQuestionCount: 42,
    offlineQuestionCount: 8,
    createdBy: teacherId
  })
}

function validScores(score: 0 | 1 | 2 = 2): ScoreItem[] {
  return TASK_OPERATION_CODES.map((taskOperationCode) => ({
    taskOperationCode,
    score,
    observationNote: `note-${taskOperationCode}`
  }))
}

function countRows(sql: string, ...params: unknown[]): number {
  const row = db.prepare(sql).get(...params) as { n: number }
  return row.n
}

function insertDomainEvent(sessionId: string, eventType: string): string {
  const eventId = uuidv4()
  const row = db
    .prepare('SELECT MAX(event_sequence) AS max_seq FROM domain_event_projection WHERE aggregate_id = ?')
    .get(sessionId) as { max_seq: number | null }
  db.prepare(
    `INSERT INTO domain_event_projection
       (event_id, aggregate_type, aggregate_id, event_type, event_sequence,
        payload_json, checksum, source_log_path, schema_version, created_at)
     VALUES (?, 'ASSESSMENT_SESSION', ?, ?, ?, '{}', 'mixed-track-checksum', 'mixed-track.jsonl', 1, ?)`
  ).run(eventId, sessionId, eventType, (row.max_seq ?? 0) + 1, new Date().toISOString())
  return eventId
}

function seedNonOperationOfflineScores(sessionId: string): void {
  const abilityQuestionId = `operation-base-noise-${uuidv4()}`
  db.prepare(
    `INSERT INTO question_bank
       (question_id, job_code, bank_domain, module_type, question_type,
        item_usage, content_json, scoring_rule_json, status)
     VALUES (?, 'SUPERMARKET_SHELVER', 'BASE_ABILITY', 'FINE_MOTOR', 'OFFLINE_OPERATION',
             'SCORED_ITEM', '{"seed":true}', '{"seed":true}', 'ACTIVE')`
  ).run(abilityQuestionId)
  db.prepare(
    `INSERT INTO offline_score_record
       (offline_score_id, session_id, question_id, score_scope, task_operation_code,
        score, scoring_rubric_json, scored_by, scored_event_id, tool_checklist_confirmed)
     VALUES (?, ?, ?, 'OFFLINE_ABILITY', NULL, 2, '{}', ?, ?, 1)`
  ).run(uuidv4(), sessionId, abilityQuestionId, teacherId, insertDomainEvent(sessionId, 'OFFLINE_SCORE_SUBMITTED'))

  const jobQuestionId = `operation-job-noise-${uuidv4()}`
  db.prepare(
    `INSERT INTO question_bank
       (question_id, job_code, bank_domain, job_module_code, question_type,
        item_usage, content_json, scoring_rule_json, status)
     VALUES (?, 'SUPERMARKET_SHELVER', 'JOB_SPECIFIC', 'M1', 'OFFLINE_OPERATION',
             'SCORED_ITEM', '{"seed":true}', '{"seed":true}', 'ACTIVE')`
  ).run(jobQuestionId)
  db.prepare(
    `INSERT INTO offline_score_record
       (offline_score_id, session_id, question_id, score_scope, task_operation_code,
        score, scoring_rubric_json, scored_by, scored_event_id, tool_checklist_confirmed)
     VALUES (?, ?, ?, 'JOB_SKILL', NULL, 2, '{}', ?, ?, 1)`
  ).run(uuidv4(), sessionId, jobQuestionId, teacherId, insertDomainEvent(sessionId, 'OFFLINE_SCORE_SUBMITTED'))

  const observationQuestionId = `operation-observation-noise-${uuidv4()}`
  db.prepare(
    `INSERT INTO question_bank
       (question_id, job_code, bank_domain, job_module_code, question_type,
        item_usage, content_json, scoring_rule_json, status)
     VALUES (?, 'SUPERMARKET_SHELVER', 'JOB_SPECIFIC', 'M2', 'TRUE_FALSE',
             'OBSERVATION_ONLY', '{"seed":true}', '{"seed":true}', 'ACTIVE')`
  ).run(observationQuestionId)
  db.prepare(
    `INSERT INTO offline_score_record
       (offline_score_id, session_id, question_id, score_scope, task_operation_code,
        score, observation_payload_json, scored_by, scored_event_id, tool_checklist_confirmed)
     VALUES (?, ?, ?, 'TEACHER_OBSERVATION', NULL,
             NULL, '{"observed":true}', ?, ?, 0)`
  ).run(uuidv4(), sessionId, observationQuestionId, teacherId, insertDomainEvent(sessionId, 'TEACHER_OBSERVATION_RECORDED'))
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
  db.exec('DELETE FROM assessment_session_question')
  db.exec('DELETE FROM safety_incident_binding')
  db.exec('DELETE FROM assessment_session')
  db.exec('DELETE FROM business_session')
  db.exec('DELETE FROM safety_incident')
  db.exec('DELETE FROM error_event_log')
  db.exec('DELETE FROM domain_event_projection')
  db.exec('DELETE FROM strategy_config')
  db.exec('DELETE FROM student_profile')
  db.exec('DELETE FROM user_account')

  teacherId = seedCaller(db, 'TEACHER')
  studentId = seedStudent(db)
  strategyId = seedStrategyConfig(db)
  mockState.db = db
  mockState.callCount = 0
  mockState.failOnCall = null
  consoleErrorSpy?.mockRestore()
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('submitOperationScores — TASK_OPERATION M2 阶段与原子性', () => {
  it('成功批次写 9 条 TASK_OPERATION + OPERATION_PASS_RATE，阶段保持 OFFLINE_SCORING，不产生 SESSION_COMPLETED', () => {
    const sessionId = createOfflinePendingSession()

    const result = submitOperationScores(db, {
      callerUserId: teacherId,
      callerRole: 'TEACHER',
      sessionId,
      toolChecklistConfirmed: true,
      scores: validScores(2)
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.normalizedScore).toBe(100)
    expect(result.levelResult).toBe('LEVEL_COMPETENT')

    const session = db
      .prepare(
        `SELECT status, delivery_phase, event_sequence_version
           FROM assessment_session
          WHERE session_id = ?`
      )
      .get(sessionId) as { status: string; delivery_phase: string; event_sequence_version: number }
    expect(session.status).toBe('OFFLINE_PENDING')
    expect(session.delivery_phase).toBe('OFFLINE_SCORING')
    expect(session.event_sequence_version).toBe(10)

    expect(countRows(
      `SELECT COUNT(*) AS n FROM offline_score_record
        WHERE session_id = ? AND score_scope = 'TASK_OPERATION' AND status = 'VALID'`,
      sessionId
    )).toBe(9)
    expect(countRows(
      `SELECT COUNT(*) AS n FROM result_record
        WHERE source_aggregate_id = ? AND result_type = 'OPERATION_PASS_RATE' AND is_current = 1`,
      sessionId
    )).toBe(1)
    const resultRow = db
      .prepare(
        `SELECT strategy_id, strategy_type, module_type
           FROM result_record
          WHERE source_aggregate_id = ? AND result_type = 'OPERATION_PASS_RATE' AND is_current = 1`
      )
      .get(sessionId) as { strategy_id: string | null; strategy_type: string | null; module_type: string | null }
    expect(resultRow).toMatchObject({
      strategy_id: strategyId,
      strategy_type: 'BASELINE_ASSESSMENT',
      module_type: null
    })
    expect(countRows(
      `SELECT COUNT(*) AS n FROM domain_event_projection
        WHERE aggregate_id = ? AND event_type = 'SESSION_COMPLETED'`,
      sessionId
    )).toBe(0)

    const readResult = getOperationScores(db, {
      callerUserId: teacherId,
      callerRole: 'TEACHER',
      sessionId
    })
    expect(readResult.success).toBe(true)
    if (!readResult.success) return
    expect(readResult.items).toHaveLength(9)
    expect(readResult.normalizedScore).toBe(100)
  })

  it('M4：其他 job 的安全事件不阻断 session 所属 job 的实操评分', () => {
    const otherJobCode = 'WAREHOUSE_PICKER'
    const otherStrategyId = seedStrategyConfig(db, { jobCode: otherJobCode })
    const sessionId = createOfflinePendingSession({ strategyId: otherStrategyId, jobCode: otherJobCode })
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
       VALUES (?, ?, 'SUPERMARKET_SHELVER', 'SHELVE_TASK', ?,
               'OTHER_SAFETY_RISK', ?, 'OTHER', 'PENDING_DETAIL', 1)`
    ).run(incidentId, studentId, triggerEventId, teacherId)

    expect(submitOperationScores(db, {
      callerUserId: teacherId,
      callerRole: 'TEACHER',
      sessionId,
      toolChecklistConfirmed: true,
      scores: validScores()
    }).success).toBe(true)
  })

  it('双轨隔离：非 TASK_OPERATION 线下记录不进入实操通过率', () => {
    const sessionId = createOfflinePendingSession()
    seedNonOperationOfflineScores(sessionId)

    const result = submitOperationScores(db, {
      callerUserId: teacherId,
      callerRole: 'TEACHER',
      sessionId,
      toolChecklistConfirmed: true,
      scores: validScores(1)
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.normalizedScore).toBe(50)

    const row = db
      .prepare(
        `SELECT raw_score, max_score, normalized_score, result_payload_json
           FROM result_record
          WHERE source_aggregate_id = ?
            AND result_type = 'OPERATION_PASS_RATE'
            AND is_current = 1`
      )
      .get(sessionId) as {
        raw_score: number
        max_score: number
        normalized_score: number
        result_payload_json: string
      } | undefined
    expect(row).toMatchObject({
      raw_score: 9,
      max_score: 18,
      normalized_score: 50
    })
    const payload = JSON.parse(row!.result_payload_json) as {
      result_type: string
      items: unknown[]
      raw_score: number
      max_score: number
      total_items: number
    }
    expect(payload).toMatchObject({
      result_type: 'OPERATION_PASS_RATE',
      raw_score: 9,
      max_score: 18,
      total_items: 9
    })
    expect(payload.items).toHaveLength(9)
    expect(countRows(
      `SELECT COUNT(*) AS n
         FROM offline_score_record
        WHERE session_id = ?
          AND score_scope IN ('OFFLINE_ABILITY', 'JOB_SKILL', 'TEACHER_OBSERVATION')`,
      sessionId
    )).toBe(3)
    expect(countRows(
      `SELECT COUNT(*) AS n
         FROM result_record
        WHERE source_aggregate_id = ?
          AND result_type IN ('ABILITY_SCORE', 'JOB_SKILL_SCORE', 'TRAINING_COMPLETION')`,
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

  it.each(TASK_OPERATION_CODES.map((_, index) => index + 1))(
    '第 %i 条 OFFLINE_SCORE_SUBMITTED 写入失败时整批回滚',
    (failOnCall) => {
      const sessionId = createOfflinePendingSession()
      mockState.failOnCall = failOnCall

      const result = submitOperationScores(db, {
        callerUserId: teacherId,
        callerRole: 'TEACHER',
        sessionId,
        toolChecklistConfirmed: true,
        scores: validScores(1)
      })

      expect(result).toEqual({ success: false, errorCode: 'ASSESSMENT_SYSTEM_ERROR' })
      expect(countRows('SELECT COUNT(*) AS n FROM offline_score_record WHERE session_id = ?', sessionId)).toBe(0)
      expect(countRows('SELECT COUNT(*) AS n FROM result_record WHERE source_aggregate_id = ?', sessionId)).toBe(0)
      expect(countRows('SELECT COUNT(*) AS n FROM domain_event_projection WHERE aggregate_id = ?', sessionId)).toBe(0)

      const session = db
        .prepare('SELECT status, delivery_phase, event_sequence_version FROM assessment_session WHERE session_id = ?')
        .get(sessionId) as { status: string; delivery_phase: string; event_sequence_version: number }
      expect(session.status).toBe('OFFLINE_PENDING')
      expect(session.delivery_phase).toBe('OFFLINE_SCORING')
      expect(session.event_sequence_version).toBe(0)
    }
  )
})
