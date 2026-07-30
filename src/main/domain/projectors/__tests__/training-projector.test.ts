import { describe, expect, it } from 'vitest'
import { createEventBatchFaultInjectorForTests } from '../../event-batch/fault-injection'
import { loadVerifiedProjectionSources } from '../../event-batch/projection-source'
import { registerTrainingPreparedFacts } from '../training-projector'
import type { DBAdapter } from '../../../db/interface'
import type { ReportMutationPort } from '../../../domain/report-command-coordinator'
import type { ActionLogEntry } from '@shared/types/event-payloads'
import { createTrainingTestCommands } from '../../../application/services/__tests__/training-test-support'
import {
  loadTrainingPlannerSnapshot,
  TrainingPlanner
} from '../../../application/planners/training-planner'
import {
  TRAINING_TEST_APP_VERSION,
  acceptTrainingCommand,
  createTrainingBatchHarness
} from '../../../application/planners/__tests__/training-test-support'
import { createTestDb, seedCaller, seedStudent } from '../../../db/test-helpers'

const TIME = '2026-07-29T10:00:00.000Z'

function count(db: { prepare(sql: string): { get(...values: unknown[]): unknown } }, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count
}

async function createTraining(harness: Awaited<ReturnType<typeof createTrainingBatchHarness>>, slot: number, teacherId: string, studentId: string) {
  const command = acceptTrainingCommand({
    harness, slot, commandType: 'training:createSession', actor: { userId: teacherId, role: 'TEACHER' },
    target: {
      aggregate_type: 'TRAINING_SESSION', student_id: studentId, job_code: 'SUPERMARKET_SHELVER', task_code: 'SHELVE_TASK',
      strategy_id: 'strategy_training_shelver_v1', strategy_version: 1, strategy_type: 'TRAINING_PRACTICE'
    }, payload: { moduleType: 'FINE_MOTOR' }
  })
  return harness.coordinator.execute({
    envelope: command.envelope,
    readSnapshot: () => loadTrainingPlannerSnapshot(harness.database, command.envelope, { timestamp: TIME, appVersion: TRAINING_TEST_APP_VERSION }),
    planner: new TrainingPlanner()
  })
}

async function executeStep(options: Readonly<{
  harness: Awaited<ReturnType<typeof createTrainingBatchHarness>>
  slot: number
  commandType: 'training:startStep' | 'training:completeStep' | 'training:skipStep' | 'training:failStep' | 'training:retryStep'
  studentId: string
  trainingSessionId: string
  stepRecordId: string
}>) {
  const command = acceptTrainingCommand({
    harness: options.harness, slot: options.slot, commandType: options.commandType,
    actor: { userId: options.studentId, role: 'STUDENT' },
    target: { aggregate_type: 'TRAINING_SESSION', training_session_id: options.trainingSessionId, step_record_id: options.stepRecordId }
  })
  return options.harness.coordinator.execute({
    envelope: command.envelope,
    readSnapshot: () => loadTrainingPlannerSnapshot(options.harness.database, command.envelope, { timestamp: TIME, appVersion: TRAINING_TEST_APP_VERSION }),
    planner: new TrainingPlanner()
  })
}

function stepId(db: { prepare(sql: string): { get(...values: unknown[]): unknown } }, trainingSessionId: string, order: number): string {
  return (db.prepare('SELECT training_step_record_id FROM training_step_record WHERE training_session_id = ? AND step_order = ?')
    .get(trainingSessionId, order) as { training_step_record_id: string }).training_step_record_id
}

const DIFFERENTIAL_IDS = Object.freeze({
  create: 'M5B-DIFF-TRAINING-CREATESESSION',
  start: 'M5B-DIFF-TRAINING-STARTSTEP',
  complete: 'M5B-DIFF-TRAINING-COMPLETESTEP',
  skip: 'M5B-DIFF-TRAINING-SKIPSTEP',
  fail: 'M5B-DIFF-TRAINING-FAILSTEP',
  retry: 'M5B-DIFF-TRAINING-RETRYSTEP'
})

function seedDifferentialActors(db: DBAdapter): Readonly<{ teacherId: string; studentId: string }> {
  const teacherId = '11111111-1111-4111-8111-111111111111'
  const studentId = '22222222-2222-4222-8222-222222222222'
  db.prepare(
    `INSERT INTO user_account (user_id, username, password_hash, role, display_name, status)
     VALUES (?, 'training-diff-teacher', 'training-diff-password', 'TEACHER', 'Training Diff Teacher', 'ACTIVE')`
  ).run(teacherId)
  db.prepare(
    `INSERT INTO user_account (user_id, username, password_hash, role, display_name, status)
     VALUES (?, 'training-diff-student', 'training-diff-password', 'STUDENT', 'Training Diff Student', 'ACTIVE')`
  ).run(studentId)
  db.prepare(
    `INSERT INTO student_profile (student_id, student_name, status)
     VALUES (?, 'Training Diff Student', 'ACTIVE')`
  ).run(studentId)
  return { teacherId, studentId }
}

function legacyTrainingEventPort(db: DBAdapter): Pick<ReportMutationPort, 'writeEvent'> {
  let sequence = 0
  const writeEvent: ReportMutationPort['writeEvent'] = (params) => {
    sequence += 1
    const event: ActionLogEntry = {
      event_id: `legacy-training-event-${sequence}`,
      aggregate_type: params.aggregateType,
      aggregate_id: params.aggregateId,
      event_type: params.eventType,
      event_sequence: sequence,
      payload: params.payload as ActionLogEntry['payload'],
      checksum: `legacy-training-checksum-${sequence}`,
      schema_version: params.schemaVersion ?? 1,
      created_at: TIME,
      actor_id: params.actorId,
      actor_role: params.actorRole,
      app_version: 'test',
      ...(params.correlationId ? { correlation_id: params.correlationId } : {})
    }
    db.prepare(
      `INSERT INTO domain_event_projection (
         event_id, aggregate_type, aggregate_id, event_type, event_sequence,
         payload_json, checksum, source_log_path, schema_version, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'training-differential.jsonl', ?, ?)`
    ).run(
      event.event_id, event.aggregate_type, event.aggregate_id, event.event_type, event.event_sequence,
      JSON.stringify(event.payload), event.checksum, event.schema_version, event.created_at
    )
    return event
  }
  return { writeEvent }
}

function publicSemantics(value: unknown): Record<string, unknown> {
  const result = value as Record<string, unknown>
  return {
    success: result.success,
    errorCode: result.errorCode ?? null,
    status: result.status ?? null,
    newStatus: result.newStatus ?? null,
    sessionCompleted: result.sessionCompleted ?? null
  }
}

function trainingSemantics(db: DBAdapter, trainingSessionId: string): Readonly<Record<string, unknown>> {
  const session = db.prepare(
    `SELECT status, job_code, task_code, strategy_type, strategy_version, module_type,
            total_step_count, completed_step_count, completion_rate
       FROM training_session WHERE training_session_id = ?`
  ).get(trainingSessionId)
  const steps = db.prepare(
    `SELECT step_order, step_type, step_code, status, attempt_count
       FROM training_step_record WHERE training_session_id = ? ORDER BY step_order`
  ).all(trainingSessionId)
  const results = db.prepare(
    `SELECT result_type, strategy_type, job_code, module_type, normalized_score,
            level_result, completion_ratio, safety_overridden
       FROM result_record WHERE source_aggregate_type = 'TRAINING_SESSION'
         AND source_aggregate_id = ? ORDER BY result_type`
  ).all(trainingSessionId)
  const eventTypes = db.prepare(
    `SELECT event_type FROM domain_event_projection
       WHERE aggregate_type = 'TRAINING_SESSION' AND aggregate_id = ? ORDER BY event_sequence`
  ).all(trainingSessionId)
  return { session, steps, results, eventTypes }
}

describe('M5B-8 training prepared projector', () => {
  it('applies all six command paths and appends terminal completion within the last root batch', async () => {
    const harness = await createTrainingBatchHarness()
    try {
      const teacherId = seedCaller(harness.database, 'TEACHER')
      const studentId = seedStudent(harness.database)
      const created = await createTraining(harness, 1, teacherId, studentId)
      const trainingSessionId = (created.publicResult as { trainingSessionId: string }).trainingSessionId
      expect(created.publicResult).toMatchObject({ success: true, trainingSessionId, status: 'INIT' })
      expect(count(harness.database, 'training_step_record')).toBe(4)

      const first = stepId(harness.database, trainingSessionId, 1)
      const second = stepId(harness.database, trainingSessionId, 2)
      const third = stepId(harness.database, trainingSessionId, 3)
      const fourth = stepId(harness.database, trainingSessionId, 4)
      await executeStep({ harness, slot: 2, commandType: 'training:startStep', studentId, trainingSessionId, stepRecordId: first })
      await executeStep({ harness, slot: 3, commandType: 'training:completeStep', studentId, trainingSessionId, stepRecordId: first })
      await executeStep({ harness, slot: 4, commandType: 'training:skipStep', studentId, trainingSessionId, stepRecordId: second })
      await executeStep({ harness, slot: 5, commandType: 'training:startStep', studentId, trainingSessionId, stepRecordId: third })
      await executeStep({ harness, slot: 6, commandType: 'training:failStep', studentId, trainingSessionId, stepRecordId: third })
      await executeStep({ harness, slot: 7, commandType: 'training:retryStep', studentId, trainingSessionId, stepRecordId: third })
      await executeStep({ harness, slot: 8, commandType: 'training:skipStep', studentId, trainingSessionId, stepRecordId: third })
      const terminal = await executeStep({ harness, slot: 9, commandType: 'training:skipStep', studentId, trainingSessionId, stepRecordId: fourth })

      expect(terminal.publicResult).toEqual({ success: true, stepRecordId: fourth, newStatus: 'SKIPPED', sessionCompleted: true })
      expect(harness.database.prepare('SELECT status, completed_step_count, completion_rate FROM training_session WHERE training_session_id = ?')
        .get(trainingSessionId)).toEqual({ status: 'COMPLETED', completed_step_count: 1, completion_rate: 25 })
      expect(count(harness.database, 'result_record')).toBe(1)
      expect(terminal.batch?.events.map((event) => event.record.event_type)).toEqual(['TRAINING_STEP_SKIPPED', 'TRAINING_COMPLETED'])
      expect(count(harness.database, 'applied_event_batch')).toBe(9)
      expect(loadVerifiedProjectionSources(harness.capability)).toHaveLength(9)
    } finally {
      harness.close()
    }
  })

  it('leaves the projection untouched when failure occurs before APPLY', async () => {
    const harness = await createTrainingBatchHarness({
      faultInjector: createEventBatchFaultInjectorForTests({ failAt: 'BEFORE_APPLY' })
    })
    try {
      const teacherId = seedCaller(harness.database, 'TEACHER')
      const studentId = seedStudent(harness.database)
      await expect(createTraining(harness, 20, teacherId, studentId)).rejects.toThrow(/BEFORE_APPLY/)
      expect(count(harness.database, 'training_session')).toBe(0)
      expect(count(harness.database, 'training_step_record')).toBe(0)
      expect(count(harness.database, 'domain_event_projection')).toBe(0)
    } finally {
      harness.close()
    }
  })

  it('rolls back both events when the terminal completion fragment fails during APPLY', async () => {
    const harness = await createTrainingBatchHarness({
      faultInjector: createEventBatchFaultInjectorForTests({ failAt: 'APPLY_EVENT', eventIndex: 1 })
    })
    try {
      const teacherId = seedCaller(harness.database, 'TEACHER')
      const studentId = seedStudent(harness.database)
      const created = await createTraining(harness, 21, teacherId, studentId)
      const trainingSessionId = (created.publicResult as { trainingSessionId: string }).trainingSessionId
      const first = stepId(harness.database, trainingSessionId, 1)
      await executeStep({ harness, slot: 22, commandType: 'training:startStep', studentId, trainingSessionId, stepRecordId: first })
      await executeStep({ harness, slot: 23, commandType: 'training:completeStep', studentId, trainingSessionId, stepRecordId: first })
      await executeStep({ harness, slot: 24, commandType: 'training:skipStep', studentId, trainingSessionId, stepRecordId: stepId(harness.database, trainingSessionId, 2) })
      await executeStep({ harness, slot: 25, commandType: 'training:skipStep', studentId, trainingSessionId, stepRecordId: stepId(harness.database, trainingSessionId, 3) })
      const fourth = stepId(harness.database, trainingSessionId, 4)
      await expect(executeStep({ harness, slot: 26, commandType: 'training:skipStep', studentId, trainingSessionId, stepRecordId: fourth }))
        .rejects.toThrow(/APPLY_EVENT at event 1/)
      expect(harness.database.prepare('SELECT status, completed_step_count FROM training_session WHERE training_session_id = ?')
        .get(trainingSessionId)).toEqual({ status: 'ACTIVE', completed_step_count: 1 })
      expect(harness.database.prepare('SELECT status FROM training_step_record WHERE training_step_record_id = ?')
        .get(fourth)).toEqual({ status: 'NOT_STARTED' })
      expect(count(harness.database, 'result_record')).toBe(0)
      expect(count(harness.database, 'applied_event_batch')).toBe(5)
      expect(harness.database.prepare("SELECT COUNT(*) AS count FROM applied_event_batch WHERE batch_status = 'CONFIRMED'")
        .get()).toEqual({ count: 5 })
    } finally {
      harness.close()
    }
  })

  it('rejects a prepared step fact whose event type and status transition disagree', async () => {
    const harness = await createTrainingBatchHarness()
    try {
      const teacherId = seedCaller(harness.database, 'TEACHER')
      const studentId = seedStudent(harness.database)
      const created = await createTraining(harness, 30, teacherId, studentId)
      const trainingSessionId = (created.publicResult as { trainingSessionId: string }).trainingSessionId
      const command = acceptTrainingCommand({
        harness, slot: 31, commandType: 'training:startStep', actor: { userId: studentId, role: 'STUDENT' },
        target: { aggregate_type: 'TRAINING_SESSION', training_session_id: trainingSessionId, step_record_id: stepId(harness.database, trainingSessionId, 1) }
      })
      const plan = new TrainingPlanner().plan({
        envelope: command.envelope,
        snapshot: loadTrainingPlannerSnapshot(harness.database, command.envelope, { timestamp: TIME, appVersion: TRAINING_TEST_APP_VERSION })
      })
      const intent = plan.events[0]!
      expect(() => registerTrainingPreparedFacts().eventRegistration({
        record: {
          event_id: intent.eventId,
          event_type: intent.eventType,
          payload: { ...intent.payload, status_after: 'COMPLETED' }
        }
      } as never)).toThrow(/invalid TRAINING_STEP_STARTED transition/)
    } finally {
      harness.close()
    }
  })

  it('matches legacy public semantics and snapshots across all six registered training differentials', async () => {
    const harness = await createTrainingBatchHarness()
    const legacyDb = await createTestDb()
    try {
      const v2Actors = seedDifferentialActors(harness.database)
      const legacyActors = seedDifferentialActors(legacyDb)
      expect(legacyActors).toEqual(v2Actors)
      const legacy = createTrainingTestCommands(legacyTrainingEventPort(legacyDb))
      const legacyCreated = legacy.createTrainingSession(legacyDb, {
        callerUserId: legacyActors.teacherId, callerRole: 'TEACHER', studentId: legacyActors.studentId,
        strategyId: 'strategy_training_shelver_v1', strategyVersion: 1, moduleType: 'FINE_MOTOR', taskCode: 'SHELVE_TASK'
      })
      const v2Created = await createTraining(harness, 40, v2Actors.teacherId, v2Actors.studentId)
      if (!legacyCreated.success || !v2Created.publicResult.success) throw new Error('differential training session creation failed')
      const legacySessionId = legacyCreated.trainingSessionId
      const v2SessionId = (v2Created.publicResult as { trainingSessionId: string }).trainingSessionId
      expect(publicSemantics(legacyCreated)).toEqual(publicSemantics(v2Created.publicResult))
      expect(trainingSemantics(legacyDb, legacySessionId)).toEqual(trainingSemantics(harness.database, v2SessionId))

      const trace = [
        { id: DIFFERENTIAL_IDS.start, commandType: 'training:startStep' as const, order: 1 },
        { id: DIFFERENTIAL_IDS.complete, commandType: 'training:completeStep' as const, order: 1 },
        { id: DIFFERENTIAL_IDS.skip, commandType: 'training:skipStep' as const, order: 2 },
        { id: DIFFERENTIAL_IDS.start, commandType: 'training:startStep' as const, order: 3 },
        { id: DIFFERENTIAL_IDS.fail, commandType: 'training:failStep' as const, order: 3 },
        { id: DIFFERENTIAL_IDS.retry, commandType: 'training:retryStep' as const, order: 3 },
        { id: DIFFERENTIAL_IDS.skip, commandType: 'training:skipStep' as const, order: 3 },
        { id: DIFFERENTIAL_IDS.skip, commandType: 'training:skipStep' as const, order: 4 }
      ]
      const legacyStepCommands = {
        'training:startStep': legacy.startStep,
        'training:completeStep': legacy.completeStep,
        'training:skipStep': legacy.skipStep,
        'training:failStep': legacy.failStep,
        'training:retryStep': legacy.retryStep
      }
      const seenIds = new Set<string>([DIFFERENTIAL_IDS.create])
      for (const [index, item] of trace.entries()) {
        const legacyResult = legacyStepCommands[item.commandType](legacyDb, {
          callerUserId: legacyActors.studentId, callerRole: 'STUDENT', trainingSessionId: legacySessionId,
          stepRecordId: stepId(legacyDb, legacySessionId, item.order)
        })
        const v2Result = await executeStep({
          harness, slot: 41 + index, commandType: item.commandType, studentId: v2Actors.studentId,
          trainingSessionId: v2SessionId, stepRecordId: stepId(harness.database, v2SessionId, item.order)
        })
        seenIds.add(item.id)
        expect(publicSemantics(legacyResult), item.id).toEqual(publicSemantics(v2Result.publicResult))
        expect(trainingSemantics(legacyDb, legacySessionId), item.id)
          .toEqual(trainingSemantics(harness.database, v2SessionId))
      }
      expect([...seenIds].sort()).toEqual(Object.values(DIFFERENTIAL_IDS).sort())
    } finally {
      legacyDb.close()
      harness.close()
    }
  })
})
