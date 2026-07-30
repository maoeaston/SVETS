import { describe, expect, it } from 'vitest'
import type { ActionLogEntry } from '@shared/types/event-payloads'
import type { DBAdapter } from '../../../db/interface'
import { createTestDb } from '../../../db/test-helpers'
import { createEventBatchFaultInjectorForTests } from '../../event-batch/fault-injection'
import { loadVerifiedProjectionSources } from '../../event-batch/projection-source'
import { RuntimeCorruptionState } from '../../event-batch/runtime-corruption'
import { StartupRecovery } from '../../event-batch/startup-recovery'
import { FairWriterMutex } from '../../event-batch/writer-mutex'
import {
  baseStrategyInput,
  seedCaller,
  seedQuestionBank,
  seedQuestionBankDraft,
  seedStudent
} from '../../../db/test-helpers'
import type { StrategyInput } from '../../../../shared/types/strategy'
import {
  ASSESSMENT_TEST_APP_VERSION,
  ASSESSMENT_TEST_TIME,
  ASSESSMENT_PREPARED_PROJECTOR_DEPENDENCIES_FOR_TESTS,
  acceptAssessmentCommand,
  createAssessmentBatchHarness
} from '../../../application/planners/__tests__/assessment-test-support'
import {
  AssessmentPlanner,
  loadAssessmentPlannerSnapshot
} from '../../../application/planners/assessment-planner'
import {
  abortSession as legacyAbortSession,
  calculateResult as legacyCalculateResult,
  createSession as legacyCreateSession,
  emotionInterrupt as legacyEmotionInterrupt,
  emotionResume as legacyEmotionResume,
  pauseSitting as legacyPauseSitting,
  recordEmotionCollapse as legacyRecordEmotionCollapse,
  startNextSitting as legacyStartNextSitting,
  startSession as legacyStartSession,
  submitAnswer as legacySubmitAnswer,
  seedAssessmentErrorCodes,
  type AssessmentMutationExecution
} from '../../../application/services/assessment-service'
import { registerAssessmentPreparedFacts } from '../assessment-projector'
import { DurableCommandStore } from '../../../application/command/durable-command-store'

function seedStrategy(db: Parameters<typeof seedCaller>[0], over: Partial<StrategyInput> = {}): string {
  db.prepare(
    `DELETE FROM strategy_config
      WHERE strategy_type = 'BASELINE_ASSESSMENT' AND job_code = 'SUPERMARKET_SHELVER' AND version = 1`
  ).run()
  const strategy = baseStrategyInput(over)
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
    strategy.supportsRedlineHalt ? 1 : 0,
    strategy.allowsEmotionInterrupt ? 1 : 0, strategy.requiresOfflineScoring ? 1 : 0,
    strategy.version, strategy.isActive ? 1 : 0
  )
  return strategy.strategyId
}

async function execute(options: Parameters<typeof acceptAssessmentCommand>[0]) {
  const command = acceptAssessmentCommand(options)
  return options.harness.coordinator.execute({
    envelope: command.envelope,
    readSnapshot: () => loadAssessmentPlannerSnapshot(options.harness.database, command.envelope, {
      timestamp: ASSESSMENT_TEST_TIME,
      appVersion: ASSESSMENT_TEST_APP_VERSION
    }),
    planner: new AssessmentPlanner()
  })
}

function recoverAssessment(harness: Awaited<ReturnType<typeof createAssessmentBatchHarness>>) {
  return new StartupRecovery({
    database: harness.database,
    commandStore: new DurableCommandStore(harness.database),
    registry: registerAssessmentPreparedFacts(undefined, ASSESSMENT_PREPARED_PROJECTOR_DEPENDENCIES_FOR_TESTS).seal(),
    fileCapability: harness.capability,
    corruptionState: new RuntimeCorruptionState(),
    workerId: 'assessment-recovery-worker',
    legacyAnchor: null,
    writerMutex: new FairWriterMutex(),
    now: () => new Date('2026-07-29T10:00:31.000Z')
  })
}

function target(sessionId: string) {
  return { aggregate_type: 'ASSESSMENT_SESSION', session_id: sessionId }
}

function legacyExecution(db: DBAdapter, commandType: string, _actorId: string, _role: 'TEACHER' | 'STUDENT'): AssessmentMutationExecution {
  void _actorId
  void _role
  return {
    eventPort: {
      writeEvent: (params) => {
        const sequence = (db.prepare(
          `SELECT COALESCE(MAX(event_sequence), 0) + 1 AS value
             FROM domain_event_projection WHERE aggregate_id = ?`
        ).get(params.aggregateId) as { value: number }).value
        const event: ActionLogEntry = {
          event_id: `legacy-assessment-${params.aggregateId}-${sequence}`,
          aggregate_type: params.aggregateType,
          aggregate_id: params.aggregateId,
          event_type: params.eventType,
          event_sequence: sequence,
          payload: params.payload as ActionLogEntry['payload'],
          checksum: `legacy-assessment-checksum-${sequence}`,
          schema_version: 1,
          created_at: ASSESSMENT_TEST_TIME,
          actor_id: params.actorId,
          actor_role: params.actorRole,
          app_version: 'test',
          correlation_id: params.correlationId
        }
        db.prepare(
          `INSERT INTO domain_event_projection (
             event_id, aggregate_type, aggregate_id, event_type, event_sequence,
             payload_json, checksum, source_log_path, schema_version, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 'legacy-assessment.jsonl', ?, ?)`
        ).run(
          event.event_id, event.aggregate_type, event.aggregate_id, event.event_type, event.event_sequence,
          JSON.stringify(event.payload), event.checksum, event.schema_version, event.created_at
        )
        return event
      }
    },
    context: {
      envelope: { commandType, correlationId: `legacy-${commandType}` }
    } as never
  }
}

function publicSemantics(value: unknown): Record<string, unknown> {
  const result = value as Record<string, unknown>
  return {
    success: result.success,
    errorCode: result.errorCode ?? null,
    questions: Array.isArray(result.questions) ? result.questions.map((question) => {
      const row = question as Record<string, unknown>
      return { questionOrder: row.questionOrder, questionPhase: row.questionPhase, moduleType: row.moduleType, questionType: row.questionType }
    }) : null,
    isCorrect: result.isCorrect ?? null,
    score: result.score ?? null,
    sittingNo: result.sittingNo ?? null,
    thresholdReached: result.thresholdReached ?? null,
    firstQuestionOrder: result.firstQuestionOrder ?? null,
    levelResult: result.levelResult ?? null,
    normalizedScore: result.normalizedScore ?? null
  }
}

function assessmentSemantics(db: DBAdapter, sessionId: string): Record<string, unknown> {
  const session = db.prepare(
    `SELECT status, delivery_phase, online_completed_count, pause_count, last_interruption_reason, level_result
       FROM assessment_session WHERE session_id = ?`
  ).get(sessionId)
  const results = db.prepare(
    `SELECT result_type, level_result, normalized_score, safety_overridden
       FROM result_record WHERE source_aggregate_id = ? ORDER BY result_type`
  ).all(sessionId)
  const eventTypes = db.prepare(
    `SELECT event_type FROM domain_event_projection
      WHERE aggregate_type = 'ASSESSMENT_SESSION' AND aggregate_id = ? ORDER BY event_sequence`
  ).all(sessionId)
  return { session, results, eventTypes }
}

function seedSafetyHalt(db: DBAdapter, studentId: string, teacherId: string): void {
  db.prepare(
    `INSERT INTO domain_event_projection (
       event_id, aggregate_type, aggregate_id, event_type, event_sequence,
       payload_json, checksum, source_log_path, schema_version, created_at
     ) VALUES ('differential-safety-event', 'SAFETY_INCIDENT', 'differential-safety-incident',
       'SAFETY_INCIDENT_CREATED', 1, '{}', 'test', 'test.jsonl', 1, ?)`
  ).run(ASSESSMENT_TEST_TIME)
  db.prepare(
    `INSERT INTO safety_incident (
       incident_id, student_id, job_code, task_code, trigger_event_id, reason_code,
       triggered_by, context_phase, status, requires_review_before_next_session
     ) VALUES ('differential-safety-incident', ?, 'SUPERMARKET_SHELVER', 'SHELVE_TASK',
       'differential-safety-event', 'BLADE_TOWARD_SELF', ?, 'ONLINE_ASSESSMENT', 'PENDING_DETAIL', 1)`
  ).run(studentId, teacherId)
}

function promoteToLegacyStartable(db: Parameters<typeof seedCaller>[0], sessionId: string): void {
  for (const phase of ['ASSIGNED', 'STUDENT_CONFIRMED', 'ONLINE_IN_PROGRESS']) {
    db.prepare('UPDATE assessment_session SET delivery_phase = ? WHERE session_id = ?').run(phase, sessionId)
  }
}

describe('M5B-9 assessment prepared projector', () => {
  it('applies creation, start, answer, emotion, sitting, collapse and abort batches with frozen event sequences', async () => {
    const harness = await createAssessmentBatchHarness()
    try {
      const teacherId = seedCaller(harness.database, 'TEACHER')
      const studentId = seedStudent(harness.database)
      const strategyId = seedStrategy(harness.database)
      seedQuestionBankDraft(harness.database)
      harness.database.prepare(
        `UPDATE question_bank SET content_json = '{"question_type":"TRUE_FALSE","expected_answer":true}'
          WHERE question_type = 'TRUE_FALSE'`
      ).run()
      harness.database.prepare("UPDATE question_bank SET status = 'ACTIVE' WHERE status = 'DRAFT'").run()
      const created = await execute({
        harness, slot: 10, commandType: 'assessment:createSession', actor: { userId: teacherId, role: 'TEACHER' },
        target: { aggregate_type: 'ASSESSMENT_SESSION', student_id: studentId, strategy_id: strategyId, strategy_version: 1, task_code: 'SHELVE_TASK' }
      })
      const sessionId = (created.publicResult as { sessionId: string }).sessionId
      expect(created.publicResult).toMatchObject({ success: true, sessionId })
      expect(harness.database.prepare('SELECT status, delivery_phase FROM assessment_session WHERE session_id = ?').get(sessionId))
        .toEqual({ status: 'INIT', delivery_phase: 'PREPARED' })

      promoteToLegacyStartable(harness.database, sessionId)
      const started = await execute({ harness, slot: 11, commandType: 'assessment:startSession', actor: { userId: studentId, role: 'STUDENT' }, target: target(sessionId) })
      expect(started.publicResult).toMatchObject({ success: true, firstQuestionId: expect.any(String), firstQuestionOrder: 1 })
      expect(started.batch?.events.map((event) => event.record.event_type)).toEqual(['SITTING_STARTED', 'SESSION_FIRST_QUESTION_ACTIVATED'])
      const firstQuestionId = (started.publicResult as { firstQuestionId: string }).firstQuestionId
      harness.database.prepare('DELETE FROM assessment_sitting WHERE session_id = ?').run(sessionId)
      const resumedStart = await execute({ harness, slot: 111, commandType: 'assessment:startSession', actor: { userId: studentId, role: 'STUDENT' }, target: target(sessionId) })
      expect(resumedStart.publicResult).toEqual({ success: true, firstQuestionId, firstQuestionOrder: 1 })
      expect(resumedStart.batch?.events.map((event) => event.record.event_type)).toEqual(['SITTING_STARTED'])
      const answered = await execute({
        harness, slot: 12, commandType: 'assessment:submitAnswer', actor: { userId: studentId, role: 'STUDENT' },
        target: { ...target(sessionId), question_id: firstQuestionId },
        payload: { answer: { question_type: 'TRUE_FALSE', selected: true } }
      })
      expect(answered.publicResult).toEqual({ success: true, answerId: expect.any(String), isCorrect: true, score: 2 })

      await execute({ harness, slot: 13, commandType: 'assessment:emotionInterrupt', actor: { userId: studentId, role: 'STUDENT' }, target: target(sessionId), payload: { currentQuestionOrder: 2 } })
      await execute({ harness, slot: 14, commandType: 'assessment:emotionResume', actor: { userId: teacherId, role: 'TEACHER' }, target: target(sessionId), payload: { resumeFromQuestionOrder: 2 } })
      const paused = await execute({ harness, slot: 15, commandType: 'assessment:pauseSitting', actor: { userId: teacherId, role: 'TEACHER' }, target: target(sessionId), payload: { currentQuestionOrder: 2 } })
      expect(paused.publicResult).toEqual({ success: true, sittingNo: 1 })
      const next = await execute({ harness, slot: 16, commandType: 'assessment:startNextSitting', actor: { userId: teacherId, role: 'TEACHER' }, target: target(sessionId) })
      expect(next.publicResult).toEqual({ success: true, sittingNo: 2 })
      await execute({ harness, slot: 17, commandType: 'assessment:emotionInterrupt', actor: { userId: studentId, role: 'STUDENT' }, target: target(sessionId) })
      const collapse = await execute({ harness, slot: 18, commandType: 'assessment:recordEmotionCollapse', actor: { userId: teacherId, role: 'TEACHER' }, target: target(sessionId) })
      expect(collapse.publicResult).toEqual({ success: true, sittingNo: 2, thresholdReached: false })
      expect(collapse.batch?.events.map((event) => event.record.event_type)).toEqual(['SITTING_ENDED', 'EMOTION_COLLAPSE_RECORDED'])
      const resumedSitting = await execute({ harness, slot: 19, commandType: 'assessment:startNextSitting', actor: { userId: teacherId, role: 'TEACHER' }, target: target(sessionId) })
      expect(resumedSitting.publicResult).toEqual({ success: true, sittingNo: 3 })
      const aborted = await execute({ harness, slot: 20, commandType: 'assessment:abortSession', actor: { userId: teacherId, role: 'TEACHER' }, target: target(sessionId), payload: { reason: 'teacher-stop' } })
      expect(aborted.publicResult).toEqual({ success: true })
      expect(aborted.batch?.events.map((event) => event.record.event_type)).toEqual(['SESSION_ABORTED'])
      expect(harness.database.prepare('SELECT status FROM assessment_session WHERE session_id = ?').get(sessionId)).toEqual({ status: 'ABORTED' })
      expect(loadVerifiedProjectionSources(harness.capability)).toHaveLength(12)
    } finally {
      harness.close()
    }
  })

  it('leaves business projection untouched when a create batch fails before APPLY', async () => {
    const harness = await createAssessmentBatchHarness({
      faultInjector: createEventBatchFaultInjectorForTests({ failAt: 'BEFORE_APPLY' })
    })
    try {
      const teacherId = seedCaller(harness.database, 'TEACHER')
      const studentId = seedStudent(harness.database)
      const strategyId = seedStrategy(harness.database)
      seedQuestionBank(harness.database)
      await expect(execute({
        harness, slot: 30, commandType: 'assessment:createSession', actor: { userId: teacherId, role: 'TEACHER' },
        target: { aggregate_type: 'ASSESSMENT_SESSION', student_id: studentId, strategy_id: strategyId, strategy_version: 1, task_code: 'SHELVE_TASK' }
      })).rejects.toThrow(/BEFORE_APPLY/)
      expect(harness.database.prepare('SELECT COUNT(*) AS count FROM assessment_session').get()).toEqual({ count: 0 })
      expect(harness.database.prepare('SELECT COUNT(*) AS count FROM domain_event_projection').get()).toEqual({ count: 0 })
    } finally {
      harness.close()
    }
  })

  it('recovers SESSION_STARTED from frozen PREPARE question facts after a live question is disabled', async () => {
    const state: { harness?: Awaited<ReturnType<typeof createAssessmentBatchHarness>> } = {}
    let frozenQuestions: Array<Record<string, unknown>> = []
    let disabledQuestionId = ''
    const faultInjector = createEventBatchFaultInjectorForTests({
      failAt: 'AFTER_PREPARE_FSYNC',
      onHit: (point, context) => {
        const harness = state.harness
        if (point !== 'AFTER_PREPARE_FSYNC' || !harness) return
        const source = loadVerifiedProjectionSources(harness.capability)
          .find((candidate) => candidate.prepared.batch_id === context.batchId)
        const payload = source?.events.find((event) => event.record.event_type === 'SESSION_STARTED')?.record.payload
        if (!payload || !Array.isArray(payload.session_questions) || payload.session_questions.length === 0) {
          throw new Error('prepared SESSION_STARTED lacks frozen question facts')
        }
        frozenQuestions = structuredClone(payload.session_questions) as Array<Record<string, unknown>>
        const first = frozenQuestions[0]
        if (!first || typeof first.question_id !== 'string') throw new Error('prepared frozen question id is invalid')
        disabledQuestionId = first.question_id
        harness.database.prepare("UPDATE question_bank SET status = 'DISABLED' WHERE question_id = ?").run(disabledQuestionId)
      }
    })
    const harness = await createAssessmentBatchHarness({ faultInjector })
    state.harness = harness
    try {
      const teacherId = seedCaller(harness.database, 'TEACHER')
      const studentId = seedStudent(harness.database)
      const strategyId = seedStrategy(harness.database)
      seedQuestionBank(harness.database)
      await expect(execute({
        harness,
        slot: 31,
        commandType: 'assessment:createSession',
        actor: { userId: teacherId, role: 'TEACHER' },
        target: {
          aggregate_type: 'ASSESSMENT_SESSION',
          student_id: studentId,
          strategy_id: strategyId,
          strategy_version: 1,
          task_code: 'SHELVE_TASK'
        }
      })).rejects.toThrow(/AFTER_PREPARE_FSYNC/)
      expect(disabledQuestionId).toMatch(/^[0-9a-f-]{36}$/)
      expect(harness.database.prepare('SELECT status FROM question_bank WHERE question_id = ?').get(disabledQuestionId))
        .toEqual({ status: 'DISABLED' })
      expect(harness.database.prepare('SELECT COUNT(*) AS count FROM assessment_session').get()).toEqual({ count: 0 })

      const recovery = await recoverAssessment(harness).run()
      expect(recovery).toMatchObject({
        appliedBatches: 1,
        appendedCommitted: 1,
        confirmedBatches: 1,
        recoveredResults: 1,
        plannerCalls: 0
      })
      const source = loadVerifiedProjectionSources(harness.capability)
      const payload = source[0]?.events.find((event) => event.record.event_type === 'SESSION_STARTED')?.record.payload
      expect(payload?.session_questions).toEqual(frozenQuestions)
      const sessionId = payload?.session_id
      if (typeof sessionId !== 'string') throw new Error('recovered SESSION_STARTED session id is invalid')
      expect(harness.database.prepare(
        `SELECT session_question_id, question_id, question_order, question_phase, bank_domain,
                module_type, question_type, item_usage, job_module_code
           FROM assessment_session_question WHERE session_id = ? ORDER BY question_order`
      ).all(sessionId)).toEqual(frozenQuestions)
      expect(harness.database.prepare('SELECT status FROM question_bank WHERE question_id = ?').get(disabledQuestionId))
        .toEqual({ status: 'DISABLED' })
    } finally {
      harness.close()
    }
  })

  it('rejects a SESSION_STARTED prepared fact without a complete question snapshot', () => {
    expect(() => registerAssessmentPreparedFacts(undefined, ASSESSMENT_PREPARED_PROJECTOR_DEPENDENCIES_FOR_TESTS).eventRegistration({
      record: {
        event_id: 'assessment-bad-session',
        event_type: 'SESSION_STARTED',
        payload: {
          event_payload_version: 2,
          batch_context: {
            schema_version: 'batch-context-v1',
            plan_version: 'test.plan.v1',
            result_recipe_version: 'test.result.v1',
            root_command_type: 'assessment:createSession',
            root_command_id: 'command',
            child_ordinal: 0
          },
          actor_role: 'TEACHER',
          app_version: 'test',
          correlation_id: 'correlation',
          session_id: 'session',
          business_session_id: 'business-session',
          student_id: 'student',
          strategy_id: 'strategy',
          strategy_version: 1,
          strategy_type: 'BASELINE_ASSESSMENT',
          job_code: 'SUPERMARKET_SHELVER',
          task_code: 'SHELVE_TASK',
          created_by: 'teacher',
          online_question_count: 1,
          offline_question_count: 0,
          question_ids: ['question'],
          session_questions: [{
            session_question_id: 'session-question',
            question_id: 'question',
            question_order: 1,
            question_phase: 'ONLINE',
            bank_domain: 'BASE_ABILITY',
            module_type: 'FINE_MOTOR',
            question_type: 'TRUE_FALSE',
            job_module_code: null
          }],
          online_questions: [{
            question_id: 'question',
            question_order: 1,
            module_type: 'FINE_MOTOR',
            question_type: 'TRUE_FALSE'
          }]
        }
      }
    } as never)).toThrow(/item_usage/)
  })

  it('calculates a safety-overridden result from a frozen REDLINE_HALTED session', async () => {
    const harness = await createAssessmentBatchHarness()
    try {
      const teacherId = seedCaller(harness.database, 'TEACHER')
      const studentId = seedStudent(harness.database)
      const strategyId = seedStrategy(harness.database)
      seedQuestionBank(harness.database)
      const created = await execute({
        harness, slot: 40, commandType: 'assessment:createSession', actor: { userId: teacherId, role: 'TEACHER' },
        target: { aggregate_type: 'ASSESSMENT_SESSION', student_id: studentId, strategy_id: strategyId, strategy_version: 1, task_code: 'SHELVE_TASK' }
      })
      const sessionId = (created.publicResult as { sessionId: string }).sessionId
      harness.database.prepare(
        `INSERT INTO domain_event_projection (
           event_id, aggregate_type, aggregate_id, event_type, event_sequence,
           payload_json, checksum, source_log_path, schema_version, created_at
         ) VALUES ('assessment-test-safety-event', 'SAFETY_INCIDENT', 'assessment-test-safety-incident',
           'SAFETY_INCIDENT_CREATED', 1, '{}', 'test', 'test.jsonl', 1, ?)`
      ).run(ASSESSMENT_TEST_TIME)
      harness.database.prepare(
        `INSERT INTO safety_incident (
           incident_id, student_id, job_code, task_code, trigger_event_id, reason_code,
           triggered_by, context_phase, status, requires_review_before_next_session
         ) VALUES ('assessment-test-safety-incident', ?, 'SUPERMARKET_SHELVER', 'SHELVE_TASK',
           'assessment-test-safety-event', 'BLADE_TOWARD_SELF', ?, 'ONLINE_ASSESSMENT', 'PENDING_DETAIL', 1)`
      ).run(studentId, teacherId)
      expect(harness.database.prepare('SELECT status, redline_incident_id FROM assessment_session WHERE session_id = ?').get(sessionId))
        .toEqual({ status: 'REDLINE_HALTED', redline_incident_id: 'assessment-test-safety-incident' })
      const result = await execute({
        harness, slot: 41, commandType: 'assessment:calculateResult', actor: { userId: teacherId, role: 'TEACHER' }, target: target(sessionId)
      })
      expect(result.publicResult).toMatchObject({ success: true, resultId: expect.any(String), levelResult: 'LEVEL_FAIL_BY_SAFETY' })
      expect(result.batch?.events.map((event) => event.record.event_type)).toEqual(['RESULT_CALCULATED'])
      expect(harness.database.prepare(
        `SELECT level_result, safety_overridden, redline_incident_id FROM result_record
          WHERE source_aggregate_id = ? AND result_type = 'ABILITY_SCORE'`
      ).get(sessionId)).toEqual({
        level_result: 'LEVEL_FAIL_BY_SAFETY', safety_overridden: 1, redline_incident_id: 'assessment-test-safety-incident'
      })
    } finally {
      harness.close()
    }
  })

  it('matches legacy public semantics, projection state and event ordering across all ten assessment differentials', async () => {
    const harness = await createAssessmentBatchHarness()
    const legacyDb = await createTestDb()
    try {
      const teacherId = '31111111-1111-4111-8111-111111111111'
      const studentId = '32222222-2222-4222-8222-222222222222'
      for (const db of [harness.database, legacyDb]) {
        db.prepare(`INSERT INTO user_account (user_id, username, password_hash, role, display_name, status) VALUES (?, ?, 'x', 'TEACHER', 'Teacher', 'ACTIVE')`).run(teacherId, `teacher-${db === legacyDb ? 'legacy' : 'v2'}`)
        db.prepare(`INSERT INTO user_account (user_id, username, password_hash, role, display_name, status) VALUES (?, ?, 'x', 'STUDENT', 'Student', 'ACTIVE')`).run(studentId, `student-${db === legacyDb ? 'legacy' : 'v2'}`)
        db.prepare(`INSERT INTO student_profile (student_id, student_name, status) VALUES (?, 'Student', 'ACTIVE')`).run(studentId)
        seedAssessmentErrorCodes(db)
        seedStrategy(db)
        seedQuestionBankDraft(db)
        db.prepare(`UPDATE question_bank SET content_json = '{"question_type":"TRUE_FALSE","expected_answer":true}' WHERE question_type = 'TRUE_FALSE'`).run()
        db.prepare("UPDATE question_bank SET status = 'ACTIVE' WHERE status = 'DRAFT'").run()
      }
      const strategyId = (harness.database.prepare(`SELECT strategy_id FROM strategy_config WHERE strategy_type = 'BASELINE_ASSESSMENT'`).get() as { strategy_id: string }).strategy_id
      const legacyStrategyId = (legacyDb.prepare(`SELECT strategy_id FROM strategy_config WHERE strategy_type = 'BASELINE_ASSESSMENT'`).get() as { strategy_id: string }).strategy_id
      const legacyCreate = legacyCreateSession(legacyDb, {
        callerUserId: teacherId, callerRole: 'TEACHER', studentId, strategyId: legacyStrategyId, strategyVersion: 1, taskCode: 'SHELVE_TASK'
      }, legacyExecution(legacyDb, 'assessment:createSession', teacherId, 'TEACHER'))
      const v2Create = await execute({
        harness, slot: 60, commandType: 'assessment:createSession', actor: { userId: teacherId, role: 'TEACHER' },
        target: { aggregate_type: 'ASSESSMENT_SESSION', student_id: studentId, strategy_id: strategyId, strategy_version: 1, task_code: 'SHELVE_TASK' }
      })
      if (!legacyCreate.success || !v2Create.publicResult.success) throw new Error('differential create failed')
      const legacySessionId = legacyCreate.sessionId
      const v2SessionId = (v2Create.publicResult as { sessionId: string }).sessionId
      expect(publicSemantics(legacyCreate)).toEqual(publicSemantics(v2Create.publicResult))
      expect(assessmentSemantics(legacyDb, legacySessionId)).toEqual(assessmentSemantics(harness.database, v2SessionId))
      for (const dbSession of [[legacyDb, legacySessionId], [harness.database, v2SessionId]] as const) promoteToLegacyStartable(dbSession[0], dbSession[1])

      const legacyStart = legacyStartSession(legacyDb, { callerUserId: studentId, callerRole: 'STUDENT', sessionId: legacySessionId }, legacyExecution(legacyDb, 'assessment:startSession', studentId, 'STUDENT'))
      const v2Start = await execute({ harness, slot: 61, commandType: 'assessment:startSession', actor: { userId: studentId, role: 'STUDENT' }, target: target(v2SessionId) })
      if (!legacyStart.success || !v2Start.publicResult.success) throw new Error('differential start failed')
      expect(publicSemantics(legacyStart)).toEqual(publicSemantics(v2Start.publicResult))

      const legacyAnswer = legacySubmitAnswer(legacyDb, { callerUserId: studentId, callerRole: 'STUDENT', sessionId: legacySessionId, questionId: legacyStart.firstQuestionId, answerPayload: { question_type: 'TRUE_FALSE', selected: true } }, legacyExecution(legacyDb, 'assessment:submitAnswer', studentId, 'STUDENT'))
      const v2Answer = await execute({ harness, slot: 62, commandType: 'assessment:submitAnswer', actor: { userId: studentId, role: 'STUDENT' }, target: { ...target(v2SessionId), question_id: (v2Start.publicResult as { firstQuestionId: string }).firstQuestionId }, payload: { answer: { question_type: 'TRUE_FALSE', selected: true } } })
      expect(publicSemantics(legacyAnswer)).toEqual(publicSemantics(v2Answer.publicResult))

      const legacyInterrupt = legacyEmotionInterrupt(legacyDb, { callerUserId: studentId, callerRole: 'STUDENT', sessionId: legacySessionId, currentQuestionOrder: 2 }, legacyExecution(legacyDb, 'assessment:emotionInterrupt', studentId, 'STUDENT'))
      const v2Interrupt = await execute({ harness, slot: 63, commandType: 'assessment:emotionInterrupt', actor: { userId: studentId, role: 'STUDENT' }, target: target(v2SessionId), payload: { currentQuestionOrder: 2 } })
      expect(publicSemantics(legacyInterrupt)).toEqual(publicSemantics(v2Interrupt.publicResult))
      const legacyResume = legacyEmotionResume(legacyDb, { callerUserId: teacherId, callerRole: 'TEACHER', sessionId: legacySessionId, resumeFromQuestionOrder: 2 }, legacyExecution(legacyDb, 'assessment:emotionResume', teacherId, 'TEACHER'))
      const v2Resume = await execute({ harness, slot: 64, commandType: 'assessment:emotionResume', actor: { userId: teacherId, role: 'TEACHER' }, target: target(v2SessionId), payload: { resumeFromQuestionOrder: 2 } })
      expect(publicSemantics(legacyResume)).toEqual(publicSemantics(v2Resume.publicResult))
      const legacyPause = legacyPauseSitting(legacyDb, { callerUserId: teacherId, callerRole: 'TEACHER', sessionId: legacySessionId, currentQuestionOrder: 2 }, legacyExecution(legacyDb, 'assessment:pauseSitting', teacherId, 'TEACHER'))
      const v2Pause = await execute({ harness, slot: 65, commandType: 'assessment:pauseSitting', actor: { userId: teacherId, role: 'TEACHER' }, target: target(v2SessionId), payload: { currentQuestionOrder: 2 } })
      expect(publicSemantics(legacyPause)).toEqual(publicSemantics(v2Pause.publicResult))
      const legacyNext = legacyStartNextSitting(legacyDb, { callerUserId: teacherId, callerRole: 'TEACHER', sessionId: legacySessionId }, legacyExecution(legacyDb, 'assessment:startNextSitting', teacherId, 'TEACHER'))
      const v2Next = await execute({ harness, slot: 66, commandType: 'assessment:startNextSitting', actor: { userId: teacherId, role: 'TEACHER' }, target: target(v2SessionId) })
      expect(publicSemantics(legacyNext)).toEqual(publicSemantics(v2Next.publicResult))
      const legacySecondInterrupt = legacyEmotionInterrupt(legacyDb, { callerUserId: studentId, callerRole: 'STUDENT', sessionId: legacySessionId }, legacyExecution(legacyDb, 'assessment:emotionInterrupt', studentId, 'STUDENT'))
      const v2SecondInterrupt = await execute({ harness, slot: 67, commandType: 'assessment:emotionInterrupt', actor: { userId: studentId, role: 'STUDENT' }, target: target(v2SessionId) })
      expect(publicSemantics(legacySecondInterrupt)).toEqual(publicSemantics(v2SecondInterrupt.publicResult))
      const legacyCollapse = legacyRecordEmotionCollapse(legacyDb, { callerUserId: teacherId, callerRole: 'TEACHER', sessionId: legacySessionId }, legacyExecution(legacyDb, 'assessment:recordEmotionCollapse', teacherId, 'TEACHER'))
      const v2Collapse = await execute({ harness, slot: 68, commandType: 'assessment:recordEmotionCollapse', actor: { userId: teacherId, role: 'TEACHER' }, target: target(v2SessionId) })
      expect(publicSemantics(legacyCollapse)).toEqual(publicSemantics(v2Collapse.publicResult))
      const legacyNextAfterCollapse = legacyStartNextSitting(legacyDb, { callerUserId: teacherId, callerRole: 'TEACHER', sessionId: legacySessionId }, legacyExecution(legacyDb, 'assessment:startNextSitting', teacherId, 'TEACHER'))
      const v2NextAfterCollapse = await execute({ harness, slot: 69, commandType: 'assessment:startNextSitting', actor: { userId: teacherId, role: 'TEACHER' }, target: target(v2SessionId) })
      expect(publicSemantics(legacyNextAfterCollapse)).toEqual(publicSemantics(v2NextAfterCollapse.publicResult))
      const legacyAbort = legacyAbortSession(legacyDb, { callerUserId: teacherId, callerRole: 'TEACHER', sessionId: legacySessionId, reason: 'teacher-stop' }, legacyExecution(legacyDb, 'assessment:abortSession', teacherId, 'TEACHER'))
      const v2Abort = await execute({ harness, slot: 70, commandType: 'assessment:abortSession', actor: { userId: teacherId, role: 'TEACHER' }, target: target(v2SessionId), payload: { reason: 'teacher-stop' } })
      expect(publicSemantics(legacyAbort)).toEqual(publicSemantics(v2Abort.publicResult))
      expect(assessmentSemantics(legacyDb, legacySessionId)).toEqual(assessmentSemantics(harness.database, v2SessionId))

      const legacySecond = legacyCreateSession(legacyDb, { callerUserId: teacherId, callerRole: 'TEACHER', studentId, strategyId: legacyStrategyId, strategyVersion: 1, taskCode: 'SHELVE_TASK' }, legacyExecution(legacyDb, 'assessment:createSession', teacherId, 'TEACHER'))
      const v2Second = await execute({ harness, slot: 71, commandType: 'assessment:createSession', actor: { userId: teacherId, role: 'TEACHER' }, target: { aggregate_type: 'ASSESSMENT_SESSION', student_id: studentId, strategy_id: strategyId, strategy_version: 1, task_code: 'SHELVE_TASK' } })
      if (!legacySecond.success || !v2Second.publicResult.success) throw new Error('differential result session creation failed')
      seedSafetyHalt(legacyDb, studentId, teacherId)
      seedSafetyHalt(harness.database, studentId, teacherId)
      const legacyResult = legacyCalculateResult(legacyDb, { callerUserId: teacherId, callerRole: 'TEACHER', sessionId: legacySecond.sessionId }, legacyExecution(legacyDb, 'assessment:calculateResult', teacherId, 'TEACHER'))
      const v2Result = await execute({ harness, slot: 72, commandType: 'assessment:calculateResult', actor: { userId: teacherId, role: 'TEACHER' }, target: target((v2Second.publicResult as { sessionId: string }).sessionId) })
      expect(publicSemantics(legacyResult)).toEqual(publicSemantics(v2Result.publicResult))
      expect(assessmentSemantics(legacyDb, legacySecond.sessionId)).toEqual(assessmentSemantics(harness.database, (v2Second.publicResult as { sessionId: string }).sessionId))
    } finally {
      legacyDb.close()
      harness.close()
    }
  })

  it('rejects a prepared answer fact whose event payload has a mismatched field type', async () => {
    expect(() => registerAssessmentPreparedFacts(undefined, ASSESSMENT_PREPARED_PROJECTOR_DEPENDENCIES_FOR_TESTS).eventRegistration({
      record: {
        event_id: 'assessment-bad-answer', event_type: 'ANSWER_SUBMITTED',
        payload: {
          event_payload_version: 2,
          batch_context: {
            schema_version: 'batch-context-v1', plan_version: 'test.plan.v1', result_recipe_version: 'test.result.v1',
            root_command_type: 'assessment:submitAnswer', root_command_id: 'command', child_ordinal: 0
          },
          actor_role: 'STUDENT', app_version: 'test', correlation_id: 'correlation',
          session_id: 'session', answer_id: 'answer', question_id: 'question', question_type: 'TRUE_FALSE',
          answer_payload: { question_type: 'TRUE_FALSE', selected: true }, is_correct: true, score: 2,
          question_order: 'one', submitted_at: ASSESSMENT_TEST_TIME
        }
      }
    } as never)).toThrow(/question_order/)
  })
})
