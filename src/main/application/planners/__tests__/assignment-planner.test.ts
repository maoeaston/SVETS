import { afterEach, describe, expect, it } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { createEventBatchFaultInjectorForTests } from '../../../domain/event-batch/fault-injection'
import { RuntimeCorruptionState } from '../../../domain/event-batch/runtime-corruption'
import { StartupRecovery } from '../../../domain/event-batch/startup-recovery'
import { FairWriterMutex } from '../../../domain/event-batch/writer-mutex'
import { registerAssignmentPreparedFacts } from '../../../domain/projectors/assignment-projector'
import {
  seedAssessmentSessionFixture,
  seedCaller,
  seedStudent
} from '../../../db/test-helpers'
import {
  AssignmentPlanner,
  ASSIGNMENT_PLAN_VERSIONS,
  ASSIGNMENT_RESULT_RECIPE_VERSIONS,
  ASSIGNMENT_RUNTIME_EFFECT,
  loadAssignmentPlannerSnapshot
} from '../assignment-planner'
import {
  ASSIGNMENT_TEST_APP_VERSION,
  ASSIGNMENT_TEST_TIME,
  acceptAssignmentCommand,
  createAssignmentBatchHarness,
  type AssignmentBatchHarness
} from './assignment-test-support'

const harnesses: AssignmentBatchHarness[] = []

afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.close()
})

function count(harness: AssignmentBatchHarness, table: string): number {
  return (harness.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count
}

function assignmentTarget(
  sessionId: string,
  studentId: string,
  assignmentId?: string
): Record<string, unknown> {
  return assignmentId
    ? {
      aggregate_type: 'BUSINESS_SESSION_ASSIGNMENT',
      assignment_id: assignmentId,
      business_session_id: sessionId,
      student_id: studentId,
      job_code: 'SUPERMARKET_SHELVER',
      task_code: 'M5B11_ASSIGNMENT'
    }
    : {
      aggregate_type: 'BUSINESS_SESSION',
      business_session_id: sessionId,
      student_id: studentId,
      job_code: 'SUPERMARKET_SHELVER',
      task_code: 'M5B11_ASSIGNMENT'
    }
}

function seedPreparedAssignment(harness: AssignmentBatchHarness, teacherId: string, studentId: string): {
  sessionId: string
  firstQuestionId: string
} {
  const sessionId = seedAssessmentSessionFixture(harness.database, {
    studentId,
    strategyId: 'strategy_baseline_shelver_v1',
    strategyType: 'BASELINE_ASSESSMENT',
    jobCode: 'SUPERMARKET_SHELVER',
    taskCode: 'M5B11_ASSIGNMENT',
    status: 'INIT',
    deliveryPhase: 'PREPARED',
    onlineQuestionCount: 1,
    offlineQuestionCount: 0,
    createdBy: teacherId
  })
  const firstQuestionId = uuidv4()
  harness.database.prepare(
    `INSERT INTO question_bank
       (question_id, job_code, bank_domain, module_type, question_type, item_usage,
        content_json, scoring_rule_json, status)
     VALUES (?, 'SUPERMARKET_SHELVER', 'BASE_ABILITY', 'COGNITION', 'TRUE_FALSE', 'SCORED_ITEM', ?, ?, 'ACTIVE')`
  ).run(firstQuestionId, '{"expected_answer":true}', '{"correct_answer":true}')
  harness.database.prepare(
    `INSERT INTO assessment_session_question
       (session_question_id, session_id, question_id, question_order, question_phase,
        bank_domain, module_type, question_type, item_usage)
     VALUES (?, ?, ?, 1, 'ONLINE', 'BASE_ABILITY', 'COGNITION', 'TRUE_FALSE', 'SCORED_ITEM')`
  ).run(uuidv4(), sessionId, firstQuestionId)
  return { sessionId, firstQuestionId }
}

async function execute(
  harness: AssignmentBatchHarness,
  command: ReturnType<typeof acceptAssignmentCommand>
) {
  return harness.coordinator.execute({
    envelope: command.envelope,
    readSnapshot: () => loadAssignmentPlannerSnapshot(harness.database, command.envelope, {
      timestamp: ASSIGNMENT_TEST_TIME,
      appVersion: ASSIGNMENT_TEST_APP_VERSION
    }),
    planner: new AssignmentPlanner()
  })
}

function recoverAssignment(harness: AssignmentBatchHarness) {
  return new StartupRecovery({
    database: harness.database,
    commandStore: harness.store,
    registry: registerAssignmentPreparedFacts().seal(),
    fileCapability: harness.capability,
    corruptionState: new RuntimeCorruptionState(),
    workerId: 'assignment-recovery-worker',
    legacyAnchor: null,
    writerMutex: new FairWriterMutex(),
    now: () => new Date('2026-07-30T11:00:31.000Z')
  })
}

describe('M5B-11 assignment planner', () => {
  it('在克隆库上规划 create，源数据库不产生运行时、grant 或 assignment 写入', async () => {
    const harness = await createAssignmentBatchHarness()
    harnesses.push(harness)
    const teacherId = seedCaller(harness.database, 'TEACHER')
    const studentId = seedStudent(harness.database)
    const fixture = seedPreparedAssignment(harness, teacherId, studentId)
    const command = acceptAssignmentCommand({
      harness, slot: 1, commandType: 'assignment:create',
      actor: { userId: teacherId, role: 'TEACHER' },
      target: assignmentTarget(fixture.sessionId, studentId),
      payload: { businessSessionId: fixture.sessionId, confirmationMethod: 'TEACHER_ATTESTATION' }
    })

    const snapshot = await loadAssignmentPlannerSnapshot(harness.database, command.envelope, {
      timestamp: ASSIGNMENT_TEST_TIME,
      appVersion: ASSIGNMENT_TEST_APP_VERSION
    })
    const plan = new AssignmentPlanner().plan({ envelope: command.envelope, snapshot })

    expect(plan).toMatchObject({
      commandType: 'assignment:create',
      planVersion: ASSIGNMENT_PLAN_VERSIONS['assignment:create'],
      resultRecipeVersion: ASSIGNMENT_RESULT_RECIPE_VERSIONS['assignment:create']
    })
    expect(plan.events).toHaveLength(1)
    expect(plan.events[0]?.eventType).toBe('ASSIGNMENT_CREATED')
    expect(plan.operationalEffects).toEqual([expect.objectContaining({
      effectType: ASSIGNMENT_RUNTIME_EFFECT.effectType,
      effectVersion: ASSIGNMENT_RUNTIME_EFFECT.effectVersion
    })])
    expect(plan.events[0]?.payload.runtime_context_v2).toMatchObject({
      schema_version: 'local-runtime-context-plan-v2'
    })
    expect(count(harness, 'organization')).toBe(0)
    expect(count(harness, 'auth_session')).toBe(0)
    expect(count(harness, 'delegated_access_grant')).toBe(0)
    expect(count(harness, 'business_session_assignment')).toBe(0)
  })

  it('create -> confirm -> start 由三个 prepared batch 推进到 ONLINE_IN_PROGRESS', async () => {
    const harness = await createAssignmentBatchHarness()
    harnesses.push(harness)
    const teacherId = seedCaller(harness.database, 'TEACHER')
    const studentId = seedStudent(harness.database)
    const fixture = seedPreparedAssignment(harness, teacherId, studentId)
    const created = await execute(harness, acceptAssignmentCommand({
      harness, slot: 2, commandType: 'assignment:create',
      actor: { userId: teacherId, role: 'TEACHER' },
      target: assignmentTarget(fixture.sessionId, studentId),
      payload: { businessSessionId: fixture.sessionId, confirmationMethod: 'TEACHER_ATTESTATION' }
    }))
    expect(created.publicResult).toMatchObject({ success: true, deliveryPhase: 'ASSIGNED' })
    const assignmentId = String(created.publicResult.assignmentId)
    expect(count(harness, 'organization')).toBe(1)
    expect(count(harness, 'device_runtime_session')).toBe(1)
    expect(count(harness, 'auth_session')).toBe(1)

    const confirmed = await execute(harness, acceptAssignmentCommand({
      harness, slot: 3, commandType: 'assignment:confirmStudent',
      actor: { userId: teacherId, role: 'TEACHER' },
      target: assignmentTarget(fixture.sessionId, studentId, assignmentId),
      payload: { assignmentId, confirmationMethod: 'TEACHER_ATTESTATION', confirmationEvidence: { attestedBy: teacherId } }
    }))
    expect(confirmed.publicResult).toMatchObject({ success: true, assignmentStatus: 'ACTIVE' })

    const started = await execute(harness, acceptAssignmentCommand({
      harness, slot: 4, commandType: 'assignment:startAssessment',
      actor: { userId: studentId, role: 'STUDENT' },
      target: assignmentTarget(fixture.sessionId, studentId, assignmentId),
      payload: { assignmentId }
    }))
    expect(started.publicResult).toEqual({
      success: true,
      sessionId: fixture.sessionId,
      assignmentId,
      deliveryPhase: 'ONLINE_IN_PROGRESS',
      firstQuestionId: fixture.firstQuestionId,
      firstQuestionOrder: 1
    })
    expect(harness.database.prepare(
      'SELECT delivery_phase, current_question_id FROM assessment_session WHERE session_id = ?'
    ).get(fixture.sessionId)).toEqual({
      delivery_phase: 'ONLINE_IN_PROGRESS', current_question_id: fixture.firstQuestionId
    })
  })

  it('rebind 和 release 均从已冻结事件恢复 public result 与 assignment 版本', async () => {
    const harness = await createAssignmentBatchHarness()
    harnesses.push(harness)
    const teacherId = seedCaller(harness.database, 'TEACHER')
    const studentId = seedStudent(harness.database)
    const fixture = seedPreparedAssignment(harness, teacherId, studentId)
    const created = await execute(harness, acceptAssignmentCommand({
      harness, slot: 5, commandType: 'assignment:create', actor: { userId: teacherId, role: 'TEACHER' },
      target: assignmentTarget(fixture.sessionId, studentId),
      payload: { businessSessionId: fixture.sessionId, confirmationMethod: 'TEACHER_ATTESTATION' }
    }))
    const assignmentId = String(created.publicResult.assignmentId)
    const rebound = await execute(harness, acceptAssignmentCommand({
      harness, slot: 6, commandType: 'assignment:rebind', actor: { userId: teacherId, role: 'TEACHER' },
      target: assignmentTarget(fixture.sessionId, studentId, assignmentId),
      payload: { assignmentId, confirmationMethod: 'TEACHER_ATTESTATION', requireReconfirmation: true }
    }))
    expect(rebound.publicResult).toMatchObject({ success: true, assignmentId, version: 2, assignmentStatus: 'PENDING_CONFIRM' })
    const released = await execute(harness, acceptAssignmentCommand({
      harness, slot: 7, commandType: 'assignment:release', actor: { userId: teacherId, role: 'TEACHER' },
      target: assignmentTarget(fixture.sessionId, studentId, assignmentId),
      payload: { assignmentId, releaseReason: 'TEACHER_RELEASED' }
    }))
    expect(released.publicResult).toMatchObject({ success: true, assignmentId, assignmentStatus: 'RELEASED', grantStatus: 'RELEASED' })
  })

  it('运行时事实的同 ID 身份冲突会回滚 assignment 投影，且不会被 UPSERT 覆盖', async () => {
    const harness = await createAssignmentBatchHarness()
    harnesses.push(harness)
    const teacherId = seedCaller(harness.database, 'TEACHER')
    const studentId = seedStudent(harness.database)
    const fixture = seedPreparedAssignment(harness, teacherId, studentId)
    const command = acceptAssignmentCommand({
      harness, slot: 8, commandType: 'assignment:create', actor: { userId: teacherId, role: 'TEACHER' },
      target: assignmentTarget(fixture.sessionId, studentId),
      payload: { businessSessionId: fixture.sessionId, confirmationMethod: 'TEACHER_ATTESTATION' }
    })
    const snapshot = await loadAssignmentPlannerSnapshot(harness.database, command.envelope, {
      timestamp: ASSIGNMENT_TEST_TIME, appVersion: ASSIGNMENT_TEST_APP_VERSION
    })
    const plan = new AssignmentPlanner().plan({ envelope: command.envelope, snapshot })
    const runtime = plan.events[0]?.payload.runtime_context_v2 as { organization: { organization_id: string } }
    harness.database.prepare('INSERT INTO organization (organization_id, name) VALUES (?, ?)').run(
      runtime.organization.organization_id, 'conflicting organization'
    )

    await expect(harness.coordinator.execute({
      envelope: command.envelope,
      readSnapshot: () => Promise.resolve(snapshot),
      planner: new AssignmentPlanner()
    })).rejects.toThrow(/identity conflict/)
    expect(count(harness, 'business_session_assignment')).toBe(0)
    expect(harness.database.prepare('SELECT name FROM organization WHERE organization_id = ?').get(
      runtime.organization.organization_id
    )).toEqual({ name: 'conflicting organization' })
  })

  it('APPLY_EVENT 故障将运行时基础设施、grant 和 assignment 一并回滚', async () => {
    const harness = await createAssignmentBatchHarness({
      faultInjector: createEventBatchFaultInjectorForTests({ failAt: 'APPLY_EVENT', eventIndex: 0 })
    })
    harnesses.push(harness)
    const teacherId = seedCaller(harness.database, 'TEACHER')
    const studentId = seedStudent(harness.database)
    const fixture = seedPreparedAssignment(harness, teacherId, studentId)
    const command = acceptAssignmentCommand({
      harness, slot: 9, commandType: 'assignment:create', actor: { userId: teacherId, role: 'TEACHER' },
      target: assignmentTarget(fixture.sessionId, studentId),
      payload: { businessSessionId: fixture.sessionId, confirmationMethod: 'TEACHER_ATTESTATION' }
    })
    await expect(execute(harness, command)).rejects.toThrow(/APPLY_EVENT/)
    expect(count(harness, 'organization')).toBe(0)
    expect(count(harness, 'device_runtime_session')).toBe(0)
    expect(count(harness, 'auth_session')).toBe(0)
    expect(count(harness, 'delegated_access_grant')).toBe(0)
    expect(count(harness, 'business_session_assignment')).toBe(0)
  })

  it('准备事实已落盘后发生故障，启动恢复仅应用冻结的运行时与 assignment 事实', async () => {
    const harness = await createAssignmentBatchHarness({
      faultInjector: createEventBatchFaultInjectorForTests({ failAt: 'AFTER_PREPARE_FSYNC' })
    })
    harnesses.push(harness)
    const teacherId = seedCaller(harness.database, 'TEACHER')
    const studentId = seedStudent(harness.database)
    const fixture = seedPreparedAssignment(harness, teacherId, studentId)
    const command = acceptAssignmentCommand({
      harness, slot: 10, commandType: 'assignment:create', actor: { userId: teacherId, role: 'TEACHER' },
      target: assignmentTarget(fixture.sessionId, studentId),
      payload: { businessSessionId: fixture.sessionId, confirmationMethod: 'TEACHER_ATTESTATION' }
    })

    await expect(execute(harness, command)).rejects.toThrow(/AFTER_PREPARE_FSYNC/)
    expect(count(harness, 'organization')).toBe(0)
    expect(count(harness, 'delegated_access_grant')).toBe(0)
    expect(count(harness, 'business_session_assignment')).toBe(0)

    await expect(recoverAssignment(harness).run()).resolves.toMatchObject({
      appliedBatches: 1,
      appendedCommitted: 1,
      confirmedBatches: 1,
      recoveredResults: 1,
      plannerCalls: 0
    })
    expect(count(harness, 'organization')).toBe(1)
    expect(count(harness, 'node')).toBe(1)
    expect(count(harness, 'device')).toBe(1)
    expect(count(harness, 'device_runtime_session')).toBe(1)
    expect(count(harness, 'auth_session')).toBe(1)
    expect(count(harness, 'delegated_access_grant')).toBe(1)
    expect(count(harness, 'business_session_assignment')).toBe(1)
  })
})
