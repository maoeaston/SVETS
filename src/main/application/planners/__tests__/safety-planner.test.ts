import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { v4 as uuidv4 } from 'uuid'

import type { MemoryAdapter } from '../../../db/memory-adapter'
import { baseStrategyInput, seedCaller, seedStudent, setAssessmentSessionStateFixture } from '../../../db/test-helpers'
import {
  loadSafetyPlannerSnapshot,
  SafetyPlanner
} from '../safety-planner'
import {
  acceptSafetyCommand,
  createSafetyBatchHarness,
  SAFETY_TEST_APP_VERSION,
  SAFETY_TEST_TIME,
  type SafetyBatchHarness
} from './safety-test-support'

const JOB = 'SUPERMARKET_SHELVER'
const TASK = 'SHELVE_TASK'

function seedStrategy(db: MemoryAdapter, strategyType: 'BASELINE_ASSESSMENT' | 'MOCK_EXAM' = 'BASELINE_ASSESSMENT', jobCode = JOB): string {
  if (strategyType === 'BASELINE_ASSESSMENT' && jobCode === JOB) return 'strategy_baseline_shelver_v1'
  if (strategyType === 'MOCK_EXAM' && jobCode === JOB) return 'strategy_mock_shelver_v1'
  const strategy = baseStrategyInput({ strategyType, jobCode })
  db.prepare(
    `INSERT INTO strategy_config (
       strategy_id, strategy_type, job_code, strategy_name, online_question_count, offline_question_count,
       max_score, competent_threshold, conditional_threshold, module_veto_threshold, emotion_collapse_threshold,
       question_policy_json, scoring_policy_json, supports_redline_halt, allows_emotion_interrupt,
       requires_offline_scoring, version, is_active
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    strategy.strategyId, strategy.strategyType, strategy.jobCode, strategy.strategyName,
    strategy.onlineQuestionCount, strategy.offlineQuestionCount, strategy.maxScore,
    strategy.competentThreshold, strategy.conditionalThreshold, strategy.moduleVetoThreshold,
    strategy.emotionCollapseThreshold, JSON.stringify(strategy.questionPolicy), JSON.stringify(strategy.scoringPolicy),
    strategy.supportsRedlineHalt ? 1 : 0, strategy.allowsEmotionInterrupt ? 1 : 0,
    strategy.requiresOfflineScoring ? 1 : 0, strategy.version, strategy.isActive ? 1 : 0
  )
  return strategy.strategyId
}

function seedAssessmentSession(db: MemoryAdapter, options: Readonly<{
  teacherId: string
  studentId: string
  strategyId: string
  strategyType?: 'BASELINE_ASSESSMENT' | 'MOCK_EXAM'
  jobCode?: string
  taskCode?: string
}>): string {
  const sessionId = uuidv4()
  const jobCode = options.jobCode ?? JOB
  const taskCode = options.taskCode ?? TASK
  db.prepare(
    `INSERT INTO business_session (business_session_id, session_type, student_id, job_code, task_code, created_by)
     VALUES (?, 'ASSESSMENT', ?, ?, ?, ?)`
  ).run(sessionId, options.studentId, jobCode, taskCode, options.teacherId)
  db.prepare(
    `INSERT INTO assessment_session (
       session_id, business_session_id, student_id, strategy_id, strategy_type, job_code, task_code,
       strategy_version, status, delivery_phase, online_question_count, offline_question_count, created_by
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'INIT', 'PREPARED', 42, 8, ?)`
  ).run(sessionId, sessionId, options.studentId, options.strategyId, options.strategyType ?? 'BASELINE_ASSESSMENT', jobCode, taskCode, options.teacherId)
  setAssessmentSessionStateFixture(db, sessionId, 'ACTIVE', 'ONLINE_IN_PROGRESS')
  return sessionId
}

function seedTrainingSession(db: MemoryAdapter, options: Readonly<{ teacherId: string; studentId: string; strategyId: string }>): string {
  const sessionId = uuidv4()
  const stepId = uuidv4()
  db.prepare(
    `INSERT INTO business_session (business_session_id, session_type, student_id, job_code, task_code, created_by)
     VALUES (?, 'TRAINING', ?, ?, ?, ?)`
  ).run(sessionId, options.studentId, JOB, TASK, options.teacherId)
  db.prepare(
    `INSERT INTO training_session (
       training_session_id, business_session_id, student_id, job_code, task_code, strategy_id,
       strategy_type, strategy_version, status, total_step_count, completed_step_count, created_by
     ) VALUES (?, ?, ?, ?, ?, ?, 'TRAINING_PRACTICE', 1, 'ACTIVE', 1, 0, ?)`
  ).run(sessionId, sessionId, options.studentId, JOB, TASK, 'strategy_training_shelver_v1', options.teacherId)
  db.prepare(
    `INSERT INTO training_step_record (
       training_step_record_id, training_session_id, step_code, step_name, step_order, step_type, status, attempt_count
     ) VALUES (?, ?, 'DO', '上架', 1, 'DO', 'IN_PROGRESS', 1)`
  ).run(stepId, sessionId)
  return sessionId
}

describe('M5B-12 safety planner', () => {
  let harness: SafetyBatchHarness
  let db: MemoryAdapter
  let teacherId: string
  let adminId: string
  let studentId: string
  let strategyId: string

  beforeEach(async () => {
    harness = await createSafetyBatchHarness()
    db = harness.database
    teacherId = seedCaller(db, 'TEACHER')
    adminId = seedCaller(db, 'ADMIN')
    studentId = seedStudent(db)
    strategyId = seedStrategy(db)
  })

  afterEach(() => harness.close())

  it('freezes one redline safety event plus all M4-dependent result and step facts', () => {
    const targetSessionId = seedAssessmentSession(db, { teacherId, studentId, strategyId })
    const mockStrategyId = seedStrategy(db, 'MOCK_EXAM')
    const siblingSessionId = seedAssessmentSession(db, {
      teacherId, studentId, strategyId: mockStrategyId, strategyType: 'MOCK_EXAM'
    })
    const trainingSessionId = seedTrainingSession(db, { teacherId, studentId, strategyId })
    const accepted = acceptSafetyCommand({
      harness, slot: 1, commandType: 'assessment:triggerRedline', actor: { userId: teacherId, role: 'TEACHER' },
      target: { session_id: targetSessionId, student_id: studentId, job_code: JOB, task_code: TASK },
      payload: { reasonCode: 'BLADE_TOWARD_SELF', contextPhase: 'ONLINE_ASSESSMENT' }
    })

    const snapshot = loadSafetyPlannerSnapshot(db, accepted.envelope, { timestamp: SAFETY_TEST_TIME, appVersion: SAFETY_TEST_APP_VERSION })
    const plan = new SafetyPlanner().plan({ envelope: accepted.envelope, snapshot })

    expect(plan.events).toHaveLength(1)
    expect(plan.events[0].eventType).toBe('SAFETY_INCIDENT_CREATED')
    expect(plan.events.map((event) => event.eventType)).not.toContain('REDLINE_TRIGGERED')
    expect(plan.events[0].payload).toMatchObject({
      projection_kind: 'REDLINE',
      root_result: { success: true, sessionId: targetSessionId }
    })
    const redlineProjection = plan.events[0].payload.redline_projection as unknown as {
      assessment_bindings: Array<{ aggregate_id: string }>
      training_bindings: Array<{ aggregate_id: string }>
    }
    expect(redlineProjection.assessment_bindings).toEqual(expect.arrayContaining([
      expect.objectContaining({ aggregate_id: targetSessionId }),
      expect.objectContaining({ aggregate_id: siblingSessionId })
    ]))
    expect(redlineProjection.training_bindings).toEqual([{ aggregate_id: trainingSessionId, pre_status: 'ACTIVE' }])
  })

  it('returns no event for the same redline key after an incident has already halted the session', () => {
    const sessionId = seedAssessmentSession(db, { teacherId, studentId, strategyId })
    db.prepare("UPDATE assessment_session SET status = 'ABORTED' WHERE session_id = ?").run(sessionId)
    const accepted = acceptSafetyCommand({
      harness, slot: 2, commandType: 'assessment:triggerRedline', actor: { userId: adminId, role: 'ADMIN' },
      target: { session_id: sessionId, student_id: studentId, job_code: JOB, task_code: TASK }, payload: {}
    })
    const snapshot = loadSafetyPlannerSnapshot(db, accepted.envelope, { timestamp: SAFETY_TEST_TIME, appVersion: SAFETY_TEST_APP_VERSION })
    const plan = new SafetyPlanner().plan({ envelope: accepted.envelope, snapshot })
    expect(plan.events).toEqual([])
    expect(plan.noOpResult).toEqual({ success: false, errorCode: 'SESSION_NOT_ACTIVE' })
  })

  it('freezes lifecycle confirm from the authoritative incident triple and rejects a mismatched target', () => {
    const incidentId = uuidv4()
    const triggerEventId = uuidv4()
    db.prepare(
      `INSERT INTO domain_event_projection (
         event_id, aggregate_type, aggregate_id, event_type, event_sequence, payload_json, checksum, source_log_path, schema_version, created_at
       ) VALUES (?, 'SAFETY_INCIDENT', ?, 'SAFETY_INCIDENT_CREATED', 1, '{}', 'seed', 'seed', 1, ?)`
    ).run(triggerEventId, incidentId, SAFETY_TEST_TIME)
    db.prepare(
      `INSERT INTO safety_incident (
         incident_id, student_id, job_code, task_code, trigger_event_id, reason_code, triggered_by,
         context_phase, status, requires_review_before_next_session
       ) VALUES (?, ?, ?, ?, ?, 'BLADE_TOWARD_SELF', ?, 'ONLINE_ASSESSMENT', 'PENDING_DETAIL', 1)`
    ).run(incidentId, studentId, JOB, TASK, triggerEventId, teacherId)
    const accepted = acceptSafetyCommand({
      harness, slot: 3, commandType: 'safety:confirm', actor: { userId: teacherId, role: 'TEACHER' },
      target: { incident_id: incidentId, student_id: studentId, job_code: JOB, task_code: TASK },
      payload: { reasonCode: 'THROWING_OBJECT', contextPhase: 'TRAINING_PRACTICE', description: '学生抛掷纸箱' }
    })
    const plan = new SafetyPlanner().plan({
      envelope: accepted.envelope,
      snapshot: loadSafetyPlannerSnapshot(db, accepted.envelope, { timestamp: SAFETY_TEST_TIME, appVersion: SAFETY_TEST_APP_VERSION })
    })
    expect(plan.events).toHaveLength(1)
    expect(plan.events[0].payload).toMatchObject({ status_before: 'PENDING_DETAIL', status_after: 'CONFIRMED' })
  })
})
