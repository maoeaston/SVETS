import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { v4 as uuidv4 } from 'uuid'

import type { MemoryAdapter } from '../../../db/memory-adapter'
import { seedCaller, seedStudent, setAssessmentSessionStateFixture } from '../../../db/test-helpers'
import { loadSafetyPlannerSnapshot, SafetyPlanner } from '../../../application/planners/safety-planner'
import { createEventBatchFaultInjectorForTests } from '../../event-batch/fault-injection'
import { StartupRecovery } from '../../event-batch/startup-recovery'
import {
  acceptSafetyCommand,
  createSafetyBatchHarness,
  SAFETY_TEST_APP_VERSION,
  SAFETY_TEST_TIME,
  type SafetyBatchHarness
} from '../../../application/planners/__tests__/safety-test-support'

const JOB = 'SUPERMARKET_SHELVER'
const TASK = 'SHELVE_TASK'

function seedStrategy(db: MemoryAdapter): string {
  void db
  return 'strategy_baseline_shelver_v1'
}

function seedRedlineTargets(db: MemoryAdapter, teacherId: string, studentId: string, strategyId: string) {
  const assessmentId = uuidv4()
  const trainingId = uuidv4()
  const stepId = uuidv4()
  db.prepare(
    `INSERT INTO business_session (business_session_id, session_type, student_id, job_code, task_code, created_by)
     VALUES (?, 'ASSESSMENT', ?, ?, ?, ?)`
  ).run(assessmentId, studentId, JOB, TASK, teacherId)
  db.prepare(
    `INSERT INTO assessment_session (
       session_id, business_session_id, student_id, strategy_id, strategy_type, job_code, task_code,
       strategy_version, status, delivery_phase, online_question_count, offline_question_count, created_by
     ) VALUES (?, ?, ?, ?, 'BASELINE_ASSESSMENT', ?, ?, 1, 'INIT', 'PREPARED', 42, 8, ?)`
  ).run(assessmentId, assessmentId, studentId, strategyId, JOB, TASK, teacherId)
  setAssessmentSessionStateFixture(db, assessmentId, 'ACTIVE', 'ONLINE_IN_PROGRESS')
  db.prepare(
    `INSERT INTO business_session (business_session_id, session_type, student_id, job_code, task_code, created_by)
     VALUES (?, 'TRAINING', ?, ?, ?, ?)`
  ).run(trainingId, studentId, JOB, TASK, teacherId)
  db.prepare(
    `INSERT INTO training_session (
       training_session_id, business_session_id, student_id, job_code, task_code, strategy_id,
       strategy_type, strategy_version, status, total_step_count, completed_step_count, created_by
     ) VALUES (?, ?, ?, ?, ?, ?, 'TRAINING_PRACTICE', 1, 'ACTIVE', 1, 0, ?)`
  ).run(trainingId, trainingId, studentId, JOB, TASK, 'strategy_training_shelver_v1', teacherId)
  db.prepare(
    `INSERT INTO training_step_record (
       training_step_record_id, training_session_id, step_code, step_name, step_order, step_type, status, attempt_count
     ) VALUES (?, ?, 'DO', '上架', 1, 'DO', 'IN_PROGRESS', 1)`
  ).run(stepId, trainingId)
  return { assessmentId, trainingId, stepId }
}

describe('M5B-12 safety prepared projector', () => {
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

  it('lets native M4 triggers halt the exact triple, then applies frozen safety results and training steps', async () => {
    const target = seedRedlineTargets(db, teacherId, studentId, strategyId)
    const accepted = acceptSafetyCommand({
      harness, slot: 11, commandType: 'assessment:triggerRedline', actor: { userId: teacherId, role: 'TEACHER' },
      target: { session_id: target.assessmentId, student_id: studentId, job_code: JOB, task_code: TASK },
      payload: { reasonCode: 'BLADE_TOWARD_SELF', contextPhase: 'ONLINE_ASSESSMENT' }
    })
    const result = await harness.coordinator.execute({
      envelope: accepted.envelope,
      readSnapshot: () => loadSafetyPlannerSnapshot(db, accepted.envelope, { timestamp: SAFETY_TEST_TIME, appVersion: SAFETY_TEST_APP_VERSION }),
      planner: new SafetyPlanner()
    })

    expect(result.publicResult).toMatchObject({ success: true, sessionId: target.assessmentId })
    expect(result.batch?.events.map((event) => event.record.event_type)).toEqual(['SAFETY_INCIDENT_CREATED'])
    const incidentId = result.publicResult.incidentId as string
    expect(db.prepare('SELECT status, redline_incident_id FROM assessment_session WHERE session_id = ?').get(target.assessmentId))
      .toEqual({ status: 'REDLINE_HALTED', redline_incident_id: incidentId })
    expect(db.prepare('SELECT status, redline_incident_id FROM training_session WHERE training_session_id = ?').get(target.trainingId))
      .toEqual({ status: 'REDLINE_HALTED', redline_incident_id: incidentId })
    expect(db.prepare('SELECT status FROM training_step_record WHERE training_step_record_id = ?').get(target.stepId))
      .toEqual({ status: 'FAILED' })
    expect(db.prepare(
      `SELECT safety_overridden, level_result, redline_incident_id, is_current
         FROM result_record WHERE source_aggregate_id = ? AND result_type = 'ABILITY_SCORE'`
    ).get(target.assessmentId)).toEqual({
      safety_overridden: 1, level_result: 'LEVEL_FAIL_BY_SAFETY', redline_incident_id: incidentId, is_current: 1
    })
    expect(db.prepare('SELECT COUNT(*) AS count FROM safety_incident_binding WHERE incident_id = ?').get(incidentId))
      .toEqual({ count: 2 })
  })

  it('projects lifecycle confirmation and resolution from frozen before/after facts without creating a redline event', async () => {
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
      harness, slot: 12, commandType: 'safety:confirm', actor: { userId: teacherId, role: 'TEACHER' },
      target: { incident_id: incidentId, student_id: studentId, job_code: JOB, task_code: TASK },
      payload: { reasonCode: 'THROWING_OBJECT', contextPhase: 'TRAINING_PRACTICE', description: '学生抛掷纸箱' }
    })
    const result = await harness.coordinator.execute({
      envelope: accepted.envelope,
      readSnapshot: () => loadSafetyPlannerSnapshot(db, accepted.envelope, { timestamp: SAFETY_TEST_TIME, appVersion: SAFETY_TEST_APP_VERSION }),
      planner: new SafetyPlanner()
    })
    expect(result.batch?.events.map((event) => event.record.event_type)).toEqual(['SAFETY_INCIDENT_DETAIL_CONFIRMED'])
    expect(db.prepare('SELECT status, reason_code, description FROM safety_incident WHERE incident_id = ?').get(incidentId))
      .toEqual({ status: 'CONFIRMED', reason_code: 'THROWING_OBJECT', description: '学生抛掷纸箱' })

    const resolve = acceptSafetyCommand({
      harness, slot: 14, commandType: 'safety:resolve', actor: { userId: adminId, role: 'ADMIN' },
      target: { incident_id: incidentId, student_id: studentId, job_code: JOB, task_code: TASK },
      payload: { resolutionNotes: '已完成安全复盘', followUpRequired: false }
    })
    const resolved = await harness.coordinator.execute({
      envelope: resolve.envelope,
      readSnapshot: () => loadSafetyPlannerSnapshot(db, resolve.envelope, { timestamp: SAFETY_TEST_TIME, appVersion: SAFETY_TEST_APP_VERSION }),
      planner: new SafetyPlanner()
    })
    expect(resolved.batch?.events.map((event) => event.record.event_type)).toEqual(['SAFETY_INCIDENT_RESOLVED'])
    expect(db.prepare('SELECT status, resolved_by, requires_review_before_next_session FROM safety_incident WHERE incident_id = ?').get(incidentId))
      .toEqual({ status: 'RESOLVED', resolved_by: adminId, requires_review_before_next_session: 0 })
  })

  it('projects admin void and factual-correction replacement with their frozen aggregate links', async () => {
    const pendingId = uuidv4()
    const pendingEventId = uuidv4()
    db.prepare(
      `INSERT INTO domain_event_projection (
         event_id, aggregate_type, aggregate_id, event_type, event_sequence, payload_json, checksum, source_log_path, schema_version, created_at
       ) VALUES (?, 'SAFETY_INCIDENT', ?, 'SAFETY_INCIDENT_CREATED', 1, '{}', 'seed', 'seed', 1, ?)`
    ).run(pendingEventId, pendingId, SAFETY_TEST_TIME)
    db.prepare(
      `INSERT INTO safety_incident (
         incident_id, student_id, job_code, task_code, trigger_event_id, reason_code, triggered_by,
         context_phase, status, requires_review_before_next_session
       ) VALUES (?, ?, ?, ?, ?, 'BLADE_TOWARD_SELF', ?, 'ONLINE_ASSESSMENT', 'PENDING_DETAIL', 1)`
    ).run(pendingId, studentId, JOB, TASK, pendingEventId, teacherId)
    const voided = acceptSafetyCommand({
      harness, slot: 15, commandType: 'safety:void', actor: { userId: adminId, role: 'ADMIN' },
      target: { incident_id: pendingId, student_id: studentId, job_code: JOB, task_code: TASK },
      payload: { voidReason: 'FALSE_TRIGGER', voidNotes: '复核后确认不是安全事件' }
    })
    const voidResult = await harness.coordinator.execute({
      envelope: voided.envelope,
      readSnapshot: () => loadSafetyPlannerSnapshot(db, voided.envelope, { timestamp: SAFETY_TEST_TIME, appVersion: SAFETY_TEST_APP_VERSION }),
      planner: new SafetyPlanner()
    })
    expect(voidResult.batch?.events.map((event) => event.record.event_type)).toEqual(['SAFETY_INCIDENT_VOIDED'])
    expect(db.prepare('SELECT status, void_reason, resolved_by FROM safety_incident WHERE incident_id = ?').get(pendingId))
      .toEqual({ status: 'VOIDED', void_reason: 'FALSE_TRIGGER', resolved_by: adminId })

    const confirmedId = uuidv4()
    const confirmedEventId = uuidv4()
    db.prepare(
      `INSERT INTO domain_event_projection (
         event_id, aggregate_type, aggregate_id, event_type, event_sequence, payload_json, checksum, source_log_path, schema_version, created_at
       ) VALUES (?, 'SAFETY_INCIDENT', ?, 'SAFETY_INCIDENT_CREATED', 1, '{}', 'seed', 'seed', 1, ?)`
    ).run(confirmedEventId, confirmedId, SAFETY_TEST_TIME)
    db.prepare(
      `INSERT INTO safety_incident (
         incident_id, student_id, job_code, task_code, trigger_event_id, reason_code, triggered_by,
         context_phase, status, requires_review_before_next_session
       ) VALUES (?, ?, ?, ?, ?, 'BLADE_TOWARD_SELF', ?, 'ONLINE_ASSESSMENT', 'PENDING_DETAIL', 1)`
    ).run(confirmedId, studentId, JOB, TASK, confirmedEventId, teacherId)
    db.prepare(
      "UPDATE safety_incident SET status = 'CONFIRMED', confirmed_by = ? WHERE incident_id = ?"
    ).run(teacherId, confirmedId)
    const replaced = acceptSafetyCommand({
      harness, slot: 16, commandType: 'safety:replaceForFactualCorrection', actor: { userId: adminId, role: 'ADMIN' },
      target: { incident_id: confirmedId, student_id: studentId, job_code: JOB, task_code: TASK },
      payload: {
        reasonCode: 'THROWING_OBJECT', contextPhase: 'TRAINING_PRACTICE', description: '更正后的事实说明', correctionReason: '监控复核'
      }
    })
    const replacement = await harness.coordinator.execute({
      envelope: replaced.envelope,
      readSnapshot: () => loadSafetyPlannerSnapshot(db, replaced.envelope, { timestamp: SAFETY_TEST_TIME, appVersion: SAFETY_TEST_APP_VERSION }),
      planner: new SafetyPlanner()
    })
    expect(replacement.batch?.events.map((event) => event.record.event_type)).toEqual([
      'SAFETY_INCIDENT_CREATED', 'SAFETY_INCIDENT_REPLACED_FOR_FACTUAL_CORRECTION', 'SAFETY_INCIDENT_VOIDED'
    ])
    const replacementId = replacement.publicResult.incidentId as string
    expect(db.prepare('SELECT status, replacement_incident_id FROM safety_incident WHERE incident_id = ?').get(confirmedId))
      .toEqual({ status: 'VOIDED', replacement_incident_id: replacementId })
    expect(db.prepare('SELECT status, reason_code, description FROM safety_incident WHERE incident_id = ?').get(replacementId))
      .toEqual({ status: 'PENDING_DETAIL', reason_code: 'THROWING_OBJECT', description: '更正后的事实说明' })
  })

  it('recovers a prepared redline without rerunning the planner after the durability point', async () => {
    harness.close()
    const fault = createEventBatchFaultInjectorForTests({ failAt: 'AFTER_PREPARE_FSYNC' })
    harness = await createSafetyBatchHarness({ faultInjector: fault })
    db = harness.database
    teacherId = seedCaller(db, 'TEACHER')
    studentId = seedStudent(db)
    strategyId = seedStrategy(db)
    const target = seedRedlineTargets(db, teacherId, studentId, strategyId)
    const accepted = acceptSafetyCommand({
      harness, slot: 13, commandType: 'assessment:triggerRedline', actor: { userId: teacherId, role: 'TEACHER' },
      target: { session_id: target.assessmentId, student_id: studentId, job_code: JOB, task_code: TASK }, payload: {}
    })
    let plannerCalls = 0
    await expect(harness.coordinator.execute({
      envelope: accepted.envelope,
      readSnapshot: () => {
        plannerCalls += 1
        return loadSafetyPlannerSnapshot(db, accepted.envelope, { timestamp: SAFETY_TEST_TIME, appVersion: SAFETY_TEST_APP_VERSION })
      },
      planner: new SafetyPlanner()
    })).rejects.toThrow('AFTER_PREPARE_FSYNC')
    expect(plannerCalls).toBe(1)

    const recovery = await new StartupRecovery({
      database: db,
      commandStore: harness.store,
      registry: harness.registry,
      fileCapability: harness.capability,
      corruptionState: harness.corruptionState,
      writerMutex: harness.writerMutex,
      workerId: 'safety-worker',
      legacyAnchor: null,
      now: () => new Date(SAFETY_TEST_TIME)
    }).run()

    expect(recovery).toMatchObject({ appliedBatches: 1, plannerCalls: 0 })
    expect(plannerCalls).toBe(1)
    expect(harness.store.findByCommandId(accepted.row.commandId)).toMatchObject({ status: 'SUCCEEDED' })
    expect(db.prepare('SELECT status FROM assessment_session WHERE session_id = ?').get(target.assessmentId))
      .toEqual({ status: 'REDLINE_HALTED' })
  })
})
