import { afterEach, describe, expect, it } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { seedAssessmentSessionFixture, seedCaller, seedStudent } from '../../../db/test-helpers'
import { TASK_OPERATION_CODES } from '../../../../shared/types/operation-scoring'
import { createEventBatchFaultInjectorForTests } from '../../../domain/event-batch/fault-injection'
import {
  SCORING_PLAN_VERSIONS,
  SCORING_RESULT_RECIPE_VERSIONS,
  ScoringPlanner,
  ScoringPlannerError,
  loadScoringPlannerSnapshot
} from '../scoring-planner'
import {
  SCORING_TEST_APP_VERSION,
  SCORING_TEST_TIME,
  acceptScoringCommand,
  createScoringBatchHarness,
  type ScoringBatchHarness
} from './scoring-test-support'

const harnesses: ScoringBatchHarness[] = []

afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.close()
})

function count(harness: ScoringBatchHarness, sql: string, ...params: unknown[]): number {
  return (harness.database.prepare(sql).get(...params) as { count: number }).count
}

function seedReadyAbilitySession(harness: ScoringBatchHarness, teacherId: string, studentId: string) {
  const questionId = `m5b10-ability-offline-${uuidv4()}`
  harness.database.prepare(
    `INSERT INTO question_bank
       (question_id, job_code, bank_domain, module_type, question_type, item_usage,
        content_json, scoring_rule_json, status)
     VALUES (?, 'SUPERMARKET_SHELVER', 'BASE_ABILITY', 'COGNITION', 'OFFLINE_OPERATION', 'SCORED_ITEM',
             '{"seed":true}', '{"rubric":"m5b10"}', 'ACTIVE')`
  ).run(questionId)
  const sessionId = seedAssessmentSessionFixture(harness.database, {
    studentId,
    strategyId: 'strategy_baseline_shelver_v1',
    strategyType: 'BASELINE_ASSESSMENT',
    jobCode: 'SUPERMARKET_SHELVER',
    taskCode: 'M5B10_ABILITY',
    strategyVersion: 1,
    status: 'OFFLINE_PENDING',
    deliveryPhase: 'ONLINE_COMPLETED',
    createdBy: teacherId
  })
  const eventId = uuidv4()
  harness.database.prepare(
    `INSERT INTO domain_event_projection
       (event_id, aggregate_type, aggregate_id, event_type, event_sequence, payload_json,
        checksum, source_log_path, schema_version, created_at)
     VALUES (?, 'ASSESSMENT_SESSION', ?, 'SEED', 1, '{}', 'seed', 'seed.jsonl', 1, ?)`
  ).run(eventId, sessionId, SCORING_TEST_TIME)
  harness.database.prepare(
    `INSERT INTO assessment_session_question
       (session_question_id, session_id, question_id, question_order, question_phase,
        bank_domain, module_type, question_type, item_usage, generated_event_id)
     VALUES (?, ?, ?, 1, 'OFFLINE', 'BASE_ABILITY', 'COGNITION', 'OFFLINE_OPERATION', 'SCORED_ITEM', ?)`
  ).run(uuidv4(), sessionId, questionId, eventId)
  return { sessionId, questionId }
}

function seedJobSkillFixture(
  harness: ScoringBatchHarness,
  teacherId: string,
  studentId: string,
  options: Readonly<{ seedOfflineScores?: boolean; observationCount?: number }> = {}
) {
  const modules = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'] as const
  const offlineIds: string[] = []
  const observationIds: string[] = []
  const insertQuestion = harness.database.prepare(
    `INSERT INTO question_bank
       (question_id, job_code, bank_domain, job_module_code, question_type, item_usage,
        content_json, scoring_rule_json, status)
     VALUES (?, 'SUPERMARKET_SHELVER', 'JOB_SPECIFIC', ?, ?, ?, ?, '{"seed":true}', 'ACTIVE')`
  )
  for (const module of modules) {
    const id = `m5b10-${module}-offline-${uuidv4()}`
    insertQuestion.run(id, module, 'OFFLINE_OPERATION', 'SCORED_ITEM', '{"rubric":{"anchors":{"0":"none","1":"partial","2":"complete"}}}')
    offlineIds.push(id)
  }
  for (const module of ['M1', 'M5'] as const) {
    const id = `m5b10-${module}-observation-${uuidv4()}`
    insertQuestion.run(id, module, 'TRUE_FALSE', 'OBSERVATION_ONLY', '{"administration":{"observation_dimensions":["FOCUS"]}}')
    observationIds.push(id)
  }
  const strategyId = `m5b10-job-strategy-${uuidv4()}`
  harness.database.prepare(
    `INSERT INTO strategy_config
       (strategy_id, strategy_type, job_code, strategy_name, online_question_count, offline_question_count,
        max_score, competent_threshold, conditional_threshold, module_veto_threshold, emotion_collapse_threshold,
        question_policy_json, scoring_policy_json, supports_redline_halt, allows_emotion_interrupt,
        requires_offline_scoring, version, is_active)
     VALUES (?, 'JOB_SKILL_ASSESSMENT', 'SUPERMARKET_SHELVER', 'M5B10 Job Skill', 18, 6,
             48, 80, 60, 0.5, 3, ?, ?, 1, 1, 1, 2, 1)`
  ).run(
    strategyId,
    JSON.stringify({
      schema_version: 'question-policy-v1.2', bank_domain: 'JOB_SPECIFIC', selection_mode: 'FIXED_SET',
      job_module_quotas: Object.fromEntries(modules.map((module) => [module, { online: 3, offline: 1 }])),
      fixed_scored_question_ids: offlineIds,
      embedded_observation_question_ids: observationIds,
      fallback_strategy: 'BLOCK'
    }),
    '{"schema_version":"scoring-policy-v1.2","training_focus_threshold":0.6}'
  )
  const sessionId = seedAssessmentSessionFixture(harness.database, {
    studentId,
    strategyId,
    strategyType: 'JOB_SKILL_ASSESSMENT',
    jobCode: 'SUPERMARKET_SHELVER',
    taskCode: 'M5B10_JOB_SKILL',
    strategyVersion: 2,
    status: 'OFFLINE_PENDING',
    deliveryPhase: 'READY_TO_FINALIZE',
    onlineQuestionCount: 18,
    offlineQuestionCount: 6,
    createdBy: teacherId
  })
  const insertSessionQuestion = harness.database.prepare(
    `INSERT INTO assessment_session_question
       (session_question_id, session_id, question_id, question_order, question_phase,
        bank_domain, module_type, question_type, item_usage, job_module_code, generated_event_id)
     VALUES (?, ?, ?, ?, ?, 'JOB_SPECIFIC', NULL, ?, ?, ?, ?)`
  )
  let sequence = 1
  const insertSeedEvent = harness.database.prepare(
    `INSERT INTO domain_event_projection
       (event_id, aggregate_type, aggregate_id, event_type, event_sequence, payload_json,
        checksum, source_log_path, schema_version, created_at)
     VALUES (?, 'ASSESSMENT_SESSION', ?, 'SEED', ?, '{}', 'seed', 'seed.jsonl', 1, ?)`
  )
  const seedEvent = () => {
    const id = uuidv4()
    insertSeedEvent.run(id, sessionId, sequence, SCORING_TEST_TIME)
    sequence += 1
    return id
  }
  offlineIds.forEach((questionId, index) => {
    insertSessionQuestion.run(uuidv4(), sessionId, questionId, index + 1, 'OFFLINE', 'OFFLINE_OPERATION', 'SCORED_ITEM', modules[index], seedEvent())
  })
  observationIds.forEach((questionId, index) => {
    insertSessionQuestion.run(uuidv4(), sessionId, questionId, offlineIds.length + index + 1, 'OBSERVATION', 'TRUE_FALSE', 'OBSERVATION_ONLY', index === 0 ? 'M1' : 'M5', seedEvent())
  })
  if (options.seedOfflineScores) {
    const insertScore = harness.database.prepare(
      `INSERT INTO offline_score_record
         (offline_score_id, session_id, question_id, score_scope, task_operation_code, response_status,
          score, scoring_rubric_json, scored_by, scored_event_id, scored_at, tool_checklist_confirmed, revision_no, status)
       VALUES (?, ?, ?, 'JOB_SKILL', NULL, 'ANSWERED', 2, '{"seed":true}', ?, ?, ?, 1, 1, 'VALID')`
    )
    offlineIds.forEach((questionId) => {
      insertScore.run(uuidv4(), sessionId, questionId, teacherId, seedEvent(), SCORING_TEST_TIME)
    })
  }
  const insertObservation = harness.database.prepare(
    `INSERT INTO offline_score_record
       (offline_score_id, session_id, question_id, score_scope, task_operation_code, response_status,
        score, observation_payload_json, scored_by, scored_event_id, scored_at, tool_checklist_confirmed, revision_no, status)
     VALUES (?, ?, ?, 'TEACHER_OBSERVATION', NULL, 'ANSWERED', NULL, ?, ?, ?, ?, 0, 1, 'VALID')`
  )
  observationIds.slice(0, options.observationCount ?? 0).forEach((questionId, index) => {
    insertObservation.run(
      uuidv4(),
      sessionId,
      questionId,
      JSON.stringify({ schema_version: 'teacher-observation-v1.0', observation_code: `SEED_${index + 1}`, observed: true, behavior_codes: [], prompt_level: 'P1', accommodations_used: [], observation_note: 'seed', recorded_by: teacherId, recorded_at: SCORING_TEST_TIME }),
      teacherId,
      seedEvent(),
      SCORING_TEST_TIME
    )
  })
  return { sessionId, offlineQuestionIds: offlineIds, observationIds }
}

describe('M5B-10 scoring planner', () => {
  it('returns the legacy validation error as a no-op without touching the source database', async () => {
    const harness = await createScoringBatchHarness()
    harnesses.push(harness)
    const teacherId = seedCaller(harness.database, 'TEACHER')
    const studentId = seedStudent(harness.database)
    const sessionId = seedAssessmentSessionFixture(harness.database, {
      studentId,
      strategyId: 'strategy_baseline_shelver_v1',
      strategyType: 'BASELINE_ASSESSMENT',
      jobCode: 'SUPERMARKET_SHELVER',
      taskCode: 'M5B10_OPERATION_INVALID',
      strategyVersion: 1,
      status: 'OFFLINE_PENDING',
      createdBy: teacherId
    })
    const command = acceptScoringCommand({
      harness,
      slot: 9,
      commandType: 'assessment:submitOperationScores',
      actor: { userId: teacherId, role: 'TEACHER' },
      target: { aggregate_type: 'ASSESSMENT_SESSION', session_id: sessionId },
      payload: { toolChecklistConfirmed: false, scores: [] }
    })
    const snapshot = await loadScoringPlannerSnapshot(harness.database, command.envelope, {
      timestamp: SCORING_TEST_TIME,
      appVersion: SCORING_TEST_APP_VERSION
    })
    const plan = new ScoringPlanner().plan({ envelope: command.envelope, snapshot })

    expect(plan.events).toEqual([])
    expect(plan.noOpResult).toEqual({ success: false, errorCode: 'TOOL_CHECKLIST_NOT_CONFIRMED' })
    expect(count(harness, 'SELECT COUNT(*) AS count FROM offline_score_record WHERE session_id = ?', sessionId)).toBe(0)
    expect(count(harness, 'SELECT COUNT(*) AS count FROM result_record WHERE source_aggregate_id = ?', sessionId)).toBe(0)
  })

  it('prepares and projects an OFFLINE_ABILITY score without a result event', async () => {
    const harness = await createScoringBatchHarness()
    harnesses.push(harness)
    const teacherId = seedCaller(harness.database, 'TEACHER')
    const studentId = seedStudent(harness.database)
    const fixture = seedReadyAbilitySession(harness, teacherId, studentId)
    const command = acceptScoringCommand({
      harness,
      slot: 6,
      commandType: 'assessment:submitOfflineAbilityScores',
      actor: { userId: teacherId, role: 'TEACHER' },
      target: { aggregate_type: 'ASSESSMENT_SESSION', session_id: fixture.sessionId },
      payload: {
        scores: [{ questionId: fixture.questionId, score: 2, scoringRubricJson: '{"rubric":"m5b10"}' }]
      }
    })
    const result = await harness.coordinator.execute({
      envelope: command.envelope,
      readSnapshot: () => loadScoringPlannerSnapshot(harness.database, command.envelope, {
        timestamp: SCORING_TEST_TIME,
        appVersion: SCORING_TEST_APP_VERSION
      }),
      planner: new ScoringPlanner()
    })

    expect(result.publicResult).toMatchObject({ success: true, itemsScored: 1, isComplete: true })
    expect(result.batch?.events.map((event) => event.record.event_type)).toEqual(['OFFLINE_SCORE_SUBMITTED'])
    expect(count(harness, "SELECT COUNT(*) AS count FROM offline_score_record WHERE session_id = ? AND score_scope = 'OFFLINE_ABILITY'", fixture.sessionId)).toBe(1)
    expect(count(harness, 'SELECT COUNT(*) AS count FROM result_record WHERE source_aggregate_id = ?', fixture.sessionId)).toBe(0)
  })

  it('prepares deterministic operation score and result facts without mutating the source database', async () => {
    const harness = await createScoringBatchHarness()
    harnesses.push(harness)
    const teacherId = seedCaller(harness.database, 'TEACHER')
    const studentId = seedStudent(harness.database)
    const sessionId = seedAssessmentSessionFixture(harness.database, {
      studentId,
      strategyId: 'strategy_baseline_shelver_v1',
      strategyType: 'BASELINE_ASSESSMENT',
      jobCode: 'SUPERMARKET_SHELVER',
      taskCode: 'M5B10_OPERATION',
      strategyVersion: 1,
      status: 'OFFLINE_PENDING',
      createdBy: teacherId
    })
    const command = acceptScoringCommand({
      harness,
      slot: 1,
      commandType: 'assessment:submitOperationScores',
      actor: { userId: teacherId, role: 'TEACHER' },
      target: { aggregate_type: 'ASSESSMENT_SESSION', session_id: sessionId },
      payload: {
        toolChecklistConfirmed: true,
        scores: TASK_OPERATION_CODES.map((taskOperationCode) => ({ taskOperationCode, score: 2 }))
      }
    })

    const snapshot = await loadScoringPlannerSnapshot(harness.database, command.envelope, {
      timestamp: SCORING_TEST_TIME,
      appVersion: SCORING_TEST_APP_VERSION
    })
    expect(count(harness, 'SELECT COUNT(*) AS count FROM offline_score_record WHERE session_id = ?', sessionId)).toBe(0)
    expect(count(harness, 'SELECT COUNT(*) AS count FROM result_record WHERE source_aggregate_id = ?', sessionId)).toBe(0)

    const plan = new ScoringPlanner().plan({ envelope: command.envelope, snapshot })
    expect(plan).toMatchObject({
      commandType: 'assessment:submitOperationScores',
      planVersion: SCORING_PLAN_VERSIONS['assessment:submitOperationScores'],
      resultRecipeVersion: SCORING_RESULT_RECIPE_VERSIONS['assessment:submitOperationScores']
    })
    expect(plan.events.map((event) => event.eventType)).toEqual([
      ...Array.from({ length: 9 }, () => 'OFFLINE_SCORE_SUBMITTED'),
      'RESULT_CALCULATED'
    ])
    expect(plan.events.map((event) => event.payload.batch_context.child_ordinal)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9
    ])
    expect(plan.events.at(-1)?.payload.root_result).toMatchObject({
      success: true,
      normalizedScore: 100,
      levelResult: 'LEVEL_COMPETENT'
    })
  })

  it('projects the prepared 9+1 operation batch as one atomic public result', async () => {
    const harness = await createScoringBatchHarness()
    harnesses.push(harness)
    const teacherId = seedCaller(harness.database, 'TEACHER')
    const studentId = seedStudent(harness.database)
    const sessionId = seedAssessmentSessionFixture(harness.database, {
      studentId,
      strategyId: 'strategy_baseline_shelver_v1',
      strategyType: 'BASELINE_ASSESSMENT',
      jobCode: 'SUPERMARKET_SHELVER',
      taskCode: 'M5B10_OPERATION_APPLY',
      strategyVersion: 1,
      status: 'OFFLINE_PENDING',
      createdBy: teacherId
    })
    const command = acceptScoringCommand({
      harness,
      slot: 2,
      commandType: 'assessment:submitOperationScores',
      actor: { userId: teacherId, role: 'TEACHER' },
      target: { aggregate_type: 'ASSESSMENT_SESSION', session_id: sessionId },
      payload: {
        toolChecklistConfirmed: true,
        scores: TASK_OPERATION_CODES.map((taskOperationCode) => ({ taskOperationCode, score: 2 }))
      }
    })
    const result = await harness.coordinator.execute({
      envelope: command.envelope,
      readSnapshot: () => loadScoringPlannerSnapshot(harness.database, command.envelope, {
        timestamp: SCORING_TEST_TIME,
        appVersion: SCORING_TEST_APP_VERSION
      }),
      planner: new ScoringPlanner()
    })

    expect(result.publicResult).toMatchObject({ success: true, normalizedScore: 100, levelResult: 'LEVEL_COMPETENT' })
    expect(result.batch?.events).toHaveLength(10)
    expect(count(harness, "SELECT COUNT(*) AS count FROM offline_score_record WHERE session_id = ? AND score_scope = 'TASK_OPERATION'", sessionId)).toBe(9)
    expect(count(harness, "SELECT COUNT(*) AS count FROM result_record WHERE source_aggregate_id = ? AND result_type = 'OPERATION_PASS_RATE'", sessionId)).toBe(1)
  })

  it('prepares observation, JOB_SKILL result, completion, and report in one root batch', async () => {
    const harness = await createScoringBatchHarness()
    harnesses.push(harness)
    const teacherId = seedCaller(harness.database, 'TEACHER')
    const studentId = seedStudent(harness.database)
    const fixture = seedJobSkillFixture(harness, teacherId, studentId, {
      seedOfflineScores: true,
      observationCount: 1
    })
    const command = acceptScoringCommand({
      harness,
      slot: 4,
      commandType: 'assessment:recordTeacherObservation',
      actor: { userId: teacherId, role: 'TEACHER' },
      target: { aggregate_type: 'ASSESSMENT_SESSION', session_id: fixture.sessionId },
      payload: {
        questionId: fixture.observationIds[1]!,
        observationPayload: {
          schema_version: 'teacher-observation-v1.0', observation_code: 'FINAL', observed: true,
          behavior_codes: ['FOCUS'], prompt_level: 'P1', accommodations_used: [],
          observation_note: 'final observation', recorded_by: teacherId, recorded_at: SCORING_TEST_TIME
        }
      }
    })
    const snapshot = await loadScoringPlannerSnapshot(harness.database, command.envelope, {
      timestamp: SCORING_TEST_TIME,
      appVersion: SCORING_TEST_APP_VERSION
    })
    const plan = new ScoringPlanner().plan({ envelope: command.envelope, snapshot })
    expect(plan.events.map((event) => event.eventType)).toEqual([
      'TEACHER_OBSERVATION_RECORDED', 'RESULT_CALCULATED', 'SESSION_COMPLETED', 'REPORT_GENERATED'
    ])
    expect(plan.events.map((event) => event.payload.batch_context.child_ordinal)).toEqual([0, 1, 2, 3])

    const result = await harness.coordinator.execute({
      envelope: command.envelope,
      readSnapshot: () => loadScoringPlannerSnapshot(harness.database, command.envelope, {
        timestamp: SCORING_TEST_TIME,
        appVersion: SCORING_TEST_APP_VERSION
      }),
      planner: new ScoringPlanner()
    })
    expect(result.publicResult).toMatchObject({ success: true })
    expect(result.batch?.events).toHaveLength(4)
    expect(count(harness, "SELECT COUNT(*) AS count FROM result_record WHERE source_aggregate_id = ? AND result_type = 'JOB_SKILL_SCORE'", fixture.sessionId)).toBe(1)
    expect(count(harness, "SELECT COUNT(*) AS count FROM task_report WHERE source_aggregate_id = ? AND source_aggregate_type = 'ASSESSMENT_SESSION'", fixture.sessionId)).toBe(1)
    expect(harness.database.prepare('SELECT status FROM assessment_session WHERE session_id = ?').get(fixture.sessionId)).toMatchObject({ status: 'COMPLETED' })
  })

  it('keeps a JOB_SKILL score-only submission as one six-event batch before finalization', async () => {
    const harness = await createScoringBatchHarness()
    harnesses.push(harness)
    const teacherId = seedCaller(harness.database, 'TEACHER')
    const studentId = seedStudent(harness.database)
    const fixture = seedJobSkillFixture(harness, teacherId, studentId)
    const command = acceptScoringCommand({
      harness,
      slot: 7,
      commandType: 'assessment:submitJobSkillOfflineScores',
      actor: { userId: teacherId, role: 'TEACHER' },
      target: { aggregate_type: 'ASSESSMENT_SESSION', session_id: fixture.sessionId },
      payload: {
        scores: fixture.offlineQuestionIds.map((questionId) => ({
          questionId,
          score: 2,
          anchorVersion: `${questionId}@1`,
          selectedAnchor: 'complete'
        }))
      }
    })
    const result = await harness.coordinator.execute({
      envelope: command.envelope,
      readSnapshot: () => loadScoringPlannerSnapshot(harness.database, command.envelope, {
        timestamp: SCORING_TEST_TIME,
        appVersion: SCORING_TEST_APP_VERSION
      }),
      planner: new ScoringPlanner()
    })

    expect(result.publicResult).toMatchObject({ success: true, itemsScored: 6 })
    expect(result.batch?.events.map((event) => event.record.event_type)).toEqual(Array(6).fill('OFFLINE_SCORE_SUBMITTED'))
    expect(count(harness, "SELECT COUNT(*) AS count FROM offline_score_record WHERE session_id = ? AND score_scope = 'JOB_SKILL'", fixture.sessionId)).toBe(6)
    expect(count(harness, 'SELECT COUNT(*) AS count FROM result_record WHERE source_aggregate_id = ?', fixture.sessionId)).toBe(0)
  })

  it('flattens JOB_SKILL score, result, completion, and report into one root batch when observations are ready', async () => {
    const harness = await createScoringBatchHarness()
    harnesses.push(harness)
    const teacherId = seedCaller(harness.database, 'TEACHER')
    const studentId = seedStudent(harness.database)
    const fixture = seedJobSkillFixture(harness, teacherId, studentId, { observationCount: 2 })
    const command = acceptScoringCommand({
      harness,
      slot: 8,
      commandType: 'assessment:submitJobSkillOfflineScores',
      actor: { userId: teacherId, role: 'TEACHER' },
      target: { aggregate_type: 'ASSESSMENT_SESSION', session_id: fixture.sessionId },
      payload: {
        scores: fixture.offlineQuestionIds.map((questionId) => ({
          questionId,
          score: 2,
          anchorVersion: `${questionId}@1`,
          selectedAnchor: 'complete'
        }))
      }
    })
    const result = await harness.coordinator.execute({
      envelope: command.envelope,
      readSnapshot: () => loadScoringPlannerSnapshot(harness.database, command.envelope, {
        timestamp: SCORING_TEST_TIME,
        appVersion: SCORING_TEST_APP_VERSION
      }),
      planner: new ScoringPlanner()
    })

    expect(result.batch?.events.map((event) => event.record.event_type)).toEqual([
      ...Array(6).fill('OFFLINE_SCORE_SUBMITTED'),
      'RESULT_CALCULATED',
      'SESSION_COMPLETED',
      'REPORT_GENERATED'
    ])
    expect(count(harness, "SELECT COUNT(*) AS count FROM result_record WHERE source_aggregate_id = ? AND result_type = 'JOB_SKILL_SCORE'", fixture.sessionId)).toBe(1)
    expect(count(harness, 'SELECT COUNT(*) AS count FROM task_report WHERE source_aggregate_id = ?', fixture.sessionId)).toBe(1)
    expect(harness.database.prepare('SELECT status FROM assessment_session WHERE session_id = ?').get(fixture.sessionId)).toMatchObject({ status: 'COMPLETED' })
  })

  it('rolls back all 9+1 operation projections when APPLY fails at a child event', async () => {
    const harness = await createScoringBatchHarness({
      faultInjector: createEventBatchFaultInjectorForTests({ failAt: 'APPLY_EVENT', eventIndex: 5 })
    })
    harnesses.push(harness)
    const teacherId = seedCaller(harness.database, 'TEACHER')
    const studentId = seedStudent(harness.database)
    const sessionId = seedAssessmentSessionFixture(harness.database, {
      studentId,
      strategyId: 'strategy_baseline_shelver_v1',
      strategyType: 'BASELINE_ASSESSMENT',
      jobCode: 'SUPERMARKET_SHELVER',
      taskCode: 'M5B10_OPERATION_FAULT',
      strategyVersion: 1,
      status: 'OFFLINE_PENDING',
      createdBy: teacherId
    })
    const command = acceptScoringCommand({
      harness,
      slot: 5,
      commandType: 'assessment:submitOperationScores',
      actor: { userId: teacherId, role: 'TEACHER' },
      target: { aggregate_type: 'ASSESSMENT_SESSION', session_id: sessionId },
      payload: { toolChecklistConfirmed: true, scores: TASK_OPERATION_CODES.map((taskOperationCode) => ({ taskOperationCode, score: 2 })) }
    })
    await expect(harness.coordinator.execute({
      envelope: command.envelope,
      readSnapshot: () => loadScoringPlannerSnapshot(harness.database, command.envelope, {
        timestamp: SCORING_TEST_TIME,
        appVersion: SCORING_TEST_APP_VERSION
      }),
      planner: new ScoringPlanner()
    })).rejects.toThrow(/APPLY_EVENT/)
    expect(count(harness, 'SELECT COUNT(*) AS count FROM offline_score_record WHERE session_id = ?', sessionId)).toBe(0)
    expect(count(harness, 'SELECT COUNT(*) AS count FROM result_record WHERE source_aggregate_id = ?', sessionId)).toBe(0)
  })

  it('rejects scoring planning when a production-shaped database has no explicit test clone capability', async () => {
    const harness = await createScoringBatchHarness()
    harnesses.push(harness)
    const teacherId = seedCaller(harness.database, 'TEACHER')
    const command = acceptScoringCommand({
      harness,
      slot: 3,
      commandType: 'assessment:submitOperationScores',
      actor: { userId: teacherId, role: 'TEACHER' },
      target: { aggregate_type: 'ASSESSMENT_SESSION', session_id: 'missing-session' },
      payload: { toolChecklistConfirmed: true, scores: [] }
    })
    const withoutClone = {
      prepare: harness.database.prepare.bind(harness.database),
      transaction: harness.database.transaction.bind(harness.database),
      immediateTransaction: harness.database.immediateTransaction.bind(harness.database),
      exec: harness.database.exec.bind(harness.database)
    }
    await expect(loadScoringPlannerSnapshot(withoutClone, command.envelope, {
      timestamp: SCORING_TEST_TIME,
      appVersion: SCORING_TEST_APP_VERSION
    })).rejects.toMatchObject({ code: 'PLANNING_ADAPTER_REQUIRED' } satisfies Partial<ScoringPlannerError>)
  })
})
