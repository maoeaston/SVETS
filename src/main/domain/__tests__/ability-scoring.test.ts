import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import {
  calculateAbilityScore,
  readOfflineAbilityScoringCompletion
} from '../ability-scoring'
import {
  baseStrategyInput,
  createTestDb,
  seedAssessmentSessionFixture,
  seedCaller,
  seedStudent,
  setAssessmentSessionStateFixture
} from '../../db/test-helpers'
import type { DBAdapter } from '../../db/interface'
import type { MemoryAdapter } from '../../db/memory-adapter'
import type { StrategyInput } from '../../../shared/types/strategy'
import type { AbilityTag } from '../../../shared/types/json-schemas'

const MODULES: AbilityTag[] = [
  'FINE_MOTOR',
  'COGNITION',
  'RULE_EXECUTION',
  'EMOTION_REGULATION',
  'BASIC_SOCIAL',
  'SAFETY_OPERATION'
]

let db: MemoryAdapter
let teacherId: string
let studentId: string
let strategyId: string

function seedStrategy(db: DBAdapter, over: Partial<StrategyInput> = {}): string {
  const s = baseStrategyInput({
    strategyId: `ability-calc-${uuidv4().slice(0, 8)}`,
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

function insertEvent(sessionId: string, eventType: string): string {
  const eventId = uuidv4()
  const row = db
    .prepare('SELECT MAX(event_sequence) AS max_seq FROM domain_event_projection WHERE aggregate_id = ?')
    .get(sessionId) as { max_seq: number | null }
  db.prepare(
    `INSERT INTO domain_event_projection
       (event_id, aggregate_type, aggregate_id, event_type, event_sequence,
        payload_json, checksum, source_log_path, schema_version, created_at)
     VALUES (?, 'ASSESSMENT_SESSION', ?, ?, ?, '{}', 'c', 'l', 1, '2026-07-01T00:00:00.000Z')`
  ).run(eventId, sessionId, eventType, (row.max_seq ?? 0) + 1)
  return eventId
}

function seedBaseAbilitySession(): {
  sessionId: string
  onlineByModule: Record<AbilityTag, string[]>
  offlineQuestionIds: string[]
} {
  const sessionId = seedAssessmentSessionFixture(db, {
    studentId,
    strategyId,
    status: 'OFFLINE_PENDING',
    deliveryPhase: 'OFFLINE_SCORING',
    onlineQuestionCount: 42,
    offlineQuestionCount: 8,
    createdBy: teacherId
  })

  const onlineByModule = MODULES.reduce((acc, module) => {
    acc[module] = []
    return acc
  }, {} as Record<AbilityTag, string[]>)
  const offlineQuestionIds: string[] = []
  let order = 1

  for (const module of MODULES) {
    for (let i = 0; i < 7; i++) {
      const questionId = uuidv4()
      db.prepare(
        `INSERT INTO question_bank
           (question_id, job_code, bank_domain, module_type, question_type, item_usage,
            content_json, scoring_rule_json, status)
         VALUES (?, 'SUPERMARKET_SHELVER', 'BASE_ABILITY', ?, 'TRUE_FALSE', 'SCORED_ITEM',
                 '{"seed":true}', '{"seed":true}', 'ACTIVE')`
      ).run(questionId, module)
      db.prepare(
        `INSERT INTO assessment_session_question
           (session_question_id, session_id, question_id, question_order, question_phase,
            bank_domain, module_type, question_type, item_usage)
         VALUES (?, ?, ?, ?, 'ONLINE', 'BASE_ABILITY', ?, 'TRUE_FALSE', 'SCORED_ITEM')`
      ).run(uuidv4(), sessionId, questionId, order, module)
      onlineByModule[module].push(questionId)
      order += 1
    }
  }

  for (let i = 0; i < 8; i++) {
    const module = MODULES[i % MODULES.length]
    const questionId = uuidv4()
    db.prepare(
      `INSERT INTO question_bank
         (question_id, job_code, bank_domain, module_type, question_type, item_usage,
          content_json, scoring_rule_json, status)
       VALUES (?, 'SUPERMARKET_SHELVER', 'BASE_ABILITY', ?, 'OFFLINE_OPERATION', 'SCORED_ITEM',
               '{"seed":true}', '{"seed":true}', 'ACTIVE')`
    ).run(questionId, module)
    db.prepare(
      `INSERT INTO assessment_session_question
         (session_question_id, session_id, question_id, question_order, question_phase,
          bank_domain, module_type, question_type, item_usage)
       VALUES (?, ?, ?, ?, 'OFFLINE', 'BASE_ABILITY', ?, 'OFFLINE_OPERATION', 'SCORED_ITEM')`
    ).run(uuidv4(), sessionId, questionId, order, module)
    offlineQuestionIds.push(questionId)
    order += 1
  }

  setAssessmentSessionStateFixture(db, sessionId, 'OFFLINE_PENDING', 'OFFLINE_SCORING')
  return { sessionId, onlineByModule, offlineQuestionIds }
}

function answerQuestion(sessionId: string, questionId: string, score: 0 | 2): void {
  db.prepare(
    `INSERT INTO answer_record
       (answer_id, session_id, question_id, question_type, answer_payload_json,
        is_correct, score, submitted_event_id)
     VALUES (?, ?, ?, 'TRUE_FALSE', '{"answer":true}', ?, ?, ?)`
  ).run(uuidv4(), sessionId, questionId, score === 2 ? 1 : 0, score, insertEvent(sessionId, 'ANSWER_SUBMITTED'))
}

function scoreOfflineAbility(sessionId: string, questionId: string, score: 0 | 1 | 2): void {
  db.prepare(
    `INSERT INTO offline_score_record
       (offline_score_id, session_id, question_id, score_scope, task_operation_code,
        score, scoring_rubric_json, scored_by, scored_event_id, tool_checklist_confirmed)
     VALUES (?, ?, ?, 'OFFLINE_ABILITY', NULL, ?, '{"rubric":true}', ?, ?, 1)`
  ).run(uuidv4(), sessionId, questionId, score, teacherId, insertEvent(sessionId, 'OFFLINE_SCORE_SUBMITTED'))
}

function answerAllOnline(
  sessionId: string,
  onlineByModule: Record<AbilityTag, string[]>,
  scoreByQuestion: Partial<Record<string, 0 | 2>> = {}
): void {
  for (const questionIds of Object.values(onlineByModule)) {
    for (const questionId of questionIds) answerQuestion(sessionId, questionId, scoreByQuestion[questionId] ?? 2)
  }
}

function scoreAllOffline(sessionId: string, offlineQuestionIds: string[], score: 0 | 1 | 2 = 2): void {
  for (const questionId of offlineQuestionIds) scoreOfflineAbility(sessionId, questionId, score)
}

beforeAll(async () => {
  db = await createTestDb()
  db.exec('DROP TRIGGER IF EXISTS trg_assessment_session_no_delete')
})

afterAll(() => {
  db.close()
})

beforeEach(() => {
  db.exec('DELETE FROM offline_score_record')
  db.exec('DELETE FROM answer_record')
  db.exec('DELETE FROM assessment_session_question')
  db.exec('DELETE FROM assessment_session')
  db.exec('DELETE FROM business_session')
  db.exec('DELETE FROM domain_event_projection')
  db.exec('DELETE FROM question_bank')
  db.exec('DELETE FROM strategy_config')
  db.exec('DELETE FROM student_profile')
  db.exec('DELETE FROM user_account')

  teacherId = seedCaller(db, 'TEACHER')
  studentId = seedStudent(db)
  strategyId = seedStrategy(db)
})

describe('calculateAbilityScore', () => {
  it('只计 BASE_ABILITY 线上题和 OFFLINE_ABILITY 线下评分', () => {
    const { sessionId, onlineByModule, offlineQuestionIds } = seedBaseAbilitySession()
    answerAllOnline(sessionId, onlineByModule)
    scoreAllOffline(sessionId, offlineQuestionIds)

    db.prepare(
      `INSERT INTO offline_score_record
         (offline_score_id, session_id, question_id, score_scope, task_operation_code,
          score, scoring_rubric_json, scored_by, scored_event_id, tool_checklist_confirmed)
       VALUES (?, ?, NULL, 'TASK_OPERATION', 'IDENTIFY_BOX', 2, '{}', ?, ?, 1)`
    ).run(uuidv4(), sessionId, teacherId, insertEvent(sessionId, 'OFFLINE_SCORE_SUBMITTED'))
    db.prepare(
      `INSERT INTO offline_score_record
         (offline_score_id, session_id, question_id, score_scope, task_operation_code,
          score, scoring_rubric_json, scored_by, scored_event_id, tool_checklist_confirmed)
       VALUES (?, ?, ?, 'JOB_SKILL', NULL, 2, '{}', ?, ?, 1)`
    ).run(uuidv4(), sessionId, onlineByModule.FINE_MOTOR[0], teacherId, insertEvent(sessionId, 'OFFLINE_SCORE_SUBMITTED'))
    db.prepare(
      `INSERT INTO offline_score_record
         (offline_score_id, session_id, question_id, score_scope, task_operation_code,
          score, scoring_rubric_json, observation_payload_json, scored_by, scored_event_id)
       VALUES (?, ?, ?, 'TEACHER_OBSERVATION', NULL, NULL, NULL, '{"observed":true}', ?, ?)`
    ).run(uuidv4(), sessionId, onlineByModule.FINE_MOTOR[1], teacherId, insertEvent(sessionId, 'OFFLINE_SCORE_SUBMITTED'))

    const result = calculateAbilityScore(db, {
      sessionId,
      strategyId,
      strategyVersion: 1,
      safetyTriggered: false
    })

    expect(result.rawScore).toBe(100)
    expect(result.normalizedScore).toBe(100)
    expect(result.payload.online_raw_score).toBe(84)
    expect(result.payload.offline_raw_score).toBe(16)
    expect(result.payload.question_count).toBe(50)
    expect(result.payload.answered_count).toBe(50)
    expect(result.levelResult).toBe('LEVEL_COMPETENT')
  })

  it('模块兜底只看线上六模块，线下满分不抵消线上模块 6/14', () => {
    const { sessionId, onlineByModule, offlineQuestionIds } = seedBaseAbilitySession()
    const scoreByQuestion: Partial<Record<string, 0 | 2>> = {}
    for (const questionId of onlineByModule.COGNITION.slice(3)) scoreByQuestion[questionId] = 0
    answerAllOnline(sessionId, onlineByModule, scoreByQuestion)
    scoreAllOffline(sessionId, offlineQuestionIds)

    const result = calculateAbilityScore(db, {
      sessionId,
      strategyId,
      strategyVersion: 1,
      safetyTriggered: false
    })

    expect(result.rawScore).toBe(92)
    expect(result.normalizedScore).toBe(92)
    expect(result.levelResult).toBe('LEVEL_NOT_COMPETENT')
    expect(result.payload.module_veto_triggered_by).toBe('COGNITION')
    expect(result.payload.level_forced_by).toBe('MODULE_VETO')
  })

  it('未恢复情绪崩溃达到阈值时强制 LEVEL_NOT_COMPETENT', () => {
    const { sessionId, onlineByModule, offlineQuestionIds } = seedBaseAbilitySession()
    answerAllOnline(sessionId, onlineByModule)
    scoreAllOffline(sessionId, offlineQuestionIds)
    insertEvent(sessionId, 'EMOTION_INTERRUPTED')
    insertEvent(sessionId, 'EMOTION_INTERRUPTED')
    insertEvent(sessionId, 'EMOTION_INTERRUPTED')

    const result = calculateAbilityScore(db, {
      sessionId,
      strategyId,
      strategyVersion: 1,
      safetyTriggered: false
    })

    expect(result.levelResult).toBe('LEVEL_NOT_COMPETENT')
    expect(result.payload.level_forced_by).toBe('EMOTION_COLLAPSE')
    expect(result.payload.emotion_collapse_count).toBe(3)
  })

  it('安全红线优先级最高，但仍保留真实分数快照', () => {
    const { sessionId, onlineByModule, offlineQuestionIds } = seedBaseAbilitySession()
    answerAllOnline(sessionId, onlineByModule)
    scoreAllOffline(sessionId, offlineQuestionIds.slice(0, 1), 2)

    const result = calculateAbilityScore(db, {
      sessionId,
      strategyId,
      strategyVersion: 1,
      safetyTriggered: true
    })

    expect(result.levelResult).toBe('LEVEL_FAIL_BY_SAFETY')
    expect(result.rawScore).toBe(86)
    expect(result.payload.offline_raw_score).toBe(2)
    expect(result.payload.answered_count).toBe(43)
  })
})

describe('readOfflineAbilityScoringCompletion', () => {
  it('只统计有效 OFFLINE_ABILITY 评分完成度', () => {
    const { sessionId, offlineQuestionIds } = seedBaseAbilitySession()
    scoreOfflineAbility(sessionId, offlineQuestionIds[0], 2)
    db.prepare(
      `INSERT INTO offline_score_record
         (offline_score_id, session_id, question_id, score_scope, task_operation_code,
          score, scoring_rubric_json, scored_by, scored_event_id, tool_checklist_confirmed)
       VALUES (?, ?, NULL, 'TASK_OPERATION', 'IDENTIFY_BOX', 2, '{}', ?, ?, 1)`
    ).run(uuidv4(), sessionId, teacherId, insertEvent(sessionId, 'OFFLINE_SCORE_SUBMITTED'))

    expect(readOfflineAbilityScoringCompletion(db, sessionId)).toEqual({
      totalRequired: 8,
      totalScored: 1,
      isComplete: false
    })
  })
})
