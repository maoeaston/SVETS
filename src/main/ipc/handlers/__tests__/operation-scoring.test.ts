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

import { submitOperationScores, getOperationScores } from '../operation-scoring'
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

function createOfflinePendingSession(): string {
  return seedAssessmentSessionFixture(db, {
    studentId,
    strategyId,
    strategyType: 'BASELINE_ASSESSMENT',
    jobCode: 'SUPERMARKET_SHELVER',
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
