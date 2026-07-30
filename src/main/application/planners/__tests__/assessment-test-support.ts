import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { CommandEnvelopeV2 } from '../../command/command-types'
import { buildCommandEnvelopeV2 } from '../../command/command-envelope'
import {
  COMMAND_MAX_ATTEMPTS,
  DurableCommandStore,
  type DurableCommandRow
} from '../../command/durable-command-store'
import { EVENT_BATCH_SCHEMA_SQL } from '../../../db/event-batch-migration'
import { MemoryAdapter } from '../../../db/memory-adapter'
import { createTestDb } from '../../../db/test-helpers'
import { EventBatchCoordinator } from '../../../domain/event-batch/batch-coordinator'
import type { CanonicalJsonValue } from '../../../domain/event-batch/canonical-json'
import type { EventBatchFaultInjector } from '../../../domain/event-batch/fault-injection'
import { DurableFileCapability } from '../../../domain/event-batch/file-capability'
import type { PreparedProjectorContext } from '../../../domain/event-batch/result-registry'
import { RuntimeCorruptionState } from '../../../domain/event-batch/runtime-corruption'
import { FairWriterMutex } from '../../../domain/event-batch/writer-mutex'
import {
  readAssessmentSessionQuestionSnapshots,
  registerAssessmentPreparedFacts,
  type AssessmentPreparedProjectorDependencies
} from '../../../domain/projectors/assessment-projector'

export const ASSESSMENT_TEST_TIME = '2026-07-29T10:00:00.000Z'
export const ASSESSMENT_TEST_APP_VERSION = '1.0.0-alpha.1'

function text(value: CanonicalJsonValue | undefined, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) throw new Error(`${field} must be a non-empty trimmed string`)
  return value
}

/**
 * Test-only historical projection gate. Normal live inserts still require an
 * ACTIVE question_bank row; a prepared v2 event may instead present its exact
 * frozen question facts through generated_event_id.
 */
export function installAssessmentPreparedQuestionSnapshotGateForTests(database: PreparedProjectorContext['database']): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS event_batch_prepared_assessment_question_fact (
      event_id TEXT NOT NULL,
      session_question_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      question_id TEXT NOT NULL,
      question_order INTEGER NOT NULL,
      question_phase TEXT NOT NULL,
      bank_domain TEXT NOT NULL,
      module_type TEXT,
      question_type TEXT NOT NULL,
      item_usage TEXT NOT NULL,
      job_module_code TEXT,
      PRIMARY KEY (event_id, question_id),
      UNIQUE (event_id, session_question_id),
      UNIQUE (event_id, question_order)
    );
    DROP TRIGGER IF EXISTS trg_assessment_session_question_insert_validation;
    CREATE TRIGGER trg_assessment_session_question_insert_validation
    BEFORE INSERT ON assessment_session_question
    FOR EACH ROW
    WHEN NOT EXISTS (
      SELECT 1 FROM question_bank qb
      WHERE qb.question_id = NEW.question_id
        AND qb.status = 'ACTIVE'
        AND qb.bank_domain = NEW.bank_domain
        AND qb.question_type = NEW.question_type
        AND qb.item_usage = NEW.item_usage
        AND (
          (NEW.bank_domain = 'BASE_ABILITY' AND qb.module_type = NEW.module_type AND NEW.job_module_code IS NULL)
          OR
          (NEW.bank_domain = 'JOB_SPECIFIC' AND qb.job_module_code = NEW.job_module_code AND NEW.module_type IS NULL)
        )
    )
    AND NOT EXISTS (
      SELECT 1 FROM event_batch_prepared_assessment_question_fact fact
      WHERE fact.event_id = NEW.generated_event_id
        AND fact.session_question_id = NEW.session_question_id
        AND fact.session_id = NEW.session_id
        AND fact.question_id = NEW.question_id
        AND fact.question_order = NEW.question_order
        AND fact.question_phase = NEW.question_phase
        AND fact.bank_domain = NEW.bank_domain
        AND fact.module_type IS NEW.module_type
        AND fact.question_type = NEW.question_type
        AND fact.item_usage = NEW.item_usage
        AND fact.job_module_code IS NEW.job_module_code
    )
    BEGIN
      SELECT RAISE(ABORT, 'assessment_session_question INSERT: question must be ACTIVE with matching domain/module/type/usage or have exact prepared facts');
    END;
  `)
}

function ensurePreparedBusinessSession(
  database: PreparedProjectorContext['database'],
  payload: Readonly<Record<string, CanonicalJsonValue>>,
  event: PreparedProjectorContext['event']['record']
): void {
  const businessSessionId = text(payload.business_session_id, 'business_session_id')
  const existing = database.prepare(
    'SELECT session_type, student_id, job_code, task_code FROM business_session WHERE business_session_id = ?'
  ).get(businessSessionId) as { session_type: string; student_id: string; job_code: string; task_code: string } | undefined
  if (existing) {
    if (
      existing.session_type !== 'ASSESSMENT'
      || existing.student_id !== payload.student_id
      || existing.job_code !== payload.job_code
      || existing.task_code !== payload.task_code
    ) throw new Error(`business_session ${businessSessionId} conflicts with prepared assessment facts`)
    return
  }
  database.prepare(
    `INSERT INTO business_session
       (business_session_id, session_type, student_id, job_code, task_code, created_by)
     VALUES (?, 'ASSESSMENT', ?, ?, ?, ?)`
  ).run(businessSessionId, payload.student_id, payload.job_code, payload.task_code, event.actor_id)
}

function projectPreparedSessionStarted(context: PreparedProjectorContext): void {
  const payload = context.event.record.payload
  const sessionId = text(payload.session_id, 'session_id')
  const existing = context.database.prepare('SELECT session_id FROM assessment_session WHERE session_id = ?').get(sessionId)
  if (existing) return
  if (text(payload.created_by, 'created_by') !== context.event.record.actor_id) {
    throw new Error('SESSION_STARTED created_by conflicts with event actor')
  }
  const questions = readAssessmentSessionQuestionSnapshots(payload)
  ensurePreparedBusinessSession(context.database, payload, context.event.record)
  context.database.prepare(
    `INSERT INTO assessment_session
       (session_id, business_session_id, student_id, strategy_id, strategy_type, job_code, task_code,
        strategy_version, status, delivery_phase, online_question_count, offline_question_count,
        observation_template_id, created_by, started_at,
        created_event_id, last_applied_event_id, last_status_event_id, event_sequence_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'INIT', ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`
  ).run(
    sessionId,
    payload.business_session_id,
    payload.student_id,
    payload.strategy_id,
    payload.strategy_type,
    payload.job_code,
    payload.task_code,
    payload.strategy_version,
    payload.initial_delivery_phase ?? 'PREPARED',
    payload.online_question_count,
    payload.offline_question_count,
    payload.observation_template_id ?? null,
    context.event.record.actor_id,
    context.event.record.event_id,
    context.event.record.event_id,
    context.event.record.event_id,
    context.event.record.event_sequence
  )
  const insertPreparedFact = context.database.prepare(
    `INSERT INTO event_batch_prepared_assessment_question_fact
       (event_id, session_question_id, session_id, question_id, question_order, question_phase,
        bank_domain, module_type, question_type, item_usage, job_module_code)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const insertSessionQuestion = context.database.prepare(
    `INSERT INTO assessment_session_question
       (session_question_id, session_id, question_id, question_order, question_phase,
        bank_domain, module_type, question_type, item_usage, job_module_code, generated_event_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  for (const question of questions) {
    insertPreparedFact.run(
      context.event.record.event_id,
      question.sessionQuestionId,
      sessionId,
      question.questionId,
      question.questionOrder,
      question.questionPhase,
      question.bankDomain,
      question.moduleType,
      question.questionType,
      question.itemUsage,
      question.jobModuleCode
    )
    insertSessionQuestion.run(
      question.sessionQuestionId,
      sessionId,
      question.questionId,
      question.questionOrder,
      question.questionPhase,
      question.bankDomain,
      question.moduleType,
      question.questionType,
      question.itemUsage,
      question.jobModuleCode,
      context.event.record.event_id
    )
  }
}

export const ASSESSMENT_PREPARED_PROJECTOR_DEPENDENCIES_FOR_TESTS: AssessmentPreparedProjectorDependencies = Object.freeze({
  projectSessionStarted: projectPreparedSessionStarted
})

function suffix(slot: number): string {
  if (!Number.isSafeInteger(slot) || slot < 1 || slot > 999_999_999_999) throw new Error('invalid assessment test slot')
  return String(slot).padStart(12, '0')
}

function ids(slot: number) {
  return {
    commandId: `81000000-0000-4000-8000-${suffix(slot)}`,
    batchId: `82000000-0000-4000-8000-${suffix(slot)}`,
    clientId: `83000000-0000-4000-8000-${suffix(slot)}`,
    idempotencyKey: `84000000-0000-4000-8000-${suffix(slot)}`
  }
}

export interface AssessmentBatchHarness {
  readonly root: string
  readonly database: MemoryAdapter
  readonly store: DurableCommandStore
  readonly capability: DurableFileCapability
  readonly coordinator: EventBatchCoordinator
  close(): void
}

export async function createAssessmentBatchHarness(options: Readonly<{
  faultInjector?: EventBatchFaultInjector
  root?: string
}> = {}): Promise<AssessmentBatchHarness> {
  const ownsRoot = options.root === undefined
  const root = options.root ?? mkdtempSync(join(tmpdir(), 'svets-m5b-assessment-'))
  const database = await createTestDb()
  database.exec(EVENT_BATCH_SCHEMA_SQL)
  installAssessmentPreparedQuestionSnapshotGateForTests(database)
  const store = new DurableCommandStore(database)
  const capability = new DurableFileCapability(root)
  const coordinator = new EventBatchCoordinator({
    database,
    commandStore: store,
    registry: registerAssessmentPreparedFacts(undefined, ASSESSMENT_PREPARED_PROJECTOR_DEPENDENCIES_FOR_TESTS).seal(),
    fileCapability: capability,
    writerMutex: new FairWriterMutex(),
    corruptionState: new RuntimeCorruptionState(),
    workerId: 'assessment-worker',
    legacyAnchor: null,
    now: () => new Date(ASSESSMENT_TEST_TIME),
    faultInjector: options.faultInjector
  })
  return {
    root,
    database,
    store,
    capability,
    coordinator,
    close: () => {
      database.close()
      if (ownsRoot) rmSync(root, { recursive: true, force: true })
    }
  }
}

export function acceptAssessmentCommand(options: Readonly<{
  harness: AssessmentBatchHarness
  slot: number
  commandType: string
  actor: Readonly<{ userId: string; role: 'TEACHER' | 'STUDENT' | 'ADMIN' }>
  target: Record<string, unknown>
  payload?: Record<string, unknown>
}>): Readonly<{ row: DurableCommandRow; envelope: CommandEnvelopeV2 }> {
  const stableIds = ids(options.slot)
  const registered = options.harness.store.registerOrLoad({
    commandId: stableIds.commandId,
    idempotencyKey: stableIds.idempotencyKey,
    clientInstanceId: stableIds.clientId,
    commandType: options.commandType,
    actorId: options.actor.userId,
    deviceId: 'assessment-device',
    authSessionId: `assessment-auth-${options.actor.userId}`,
    requestHash: String(options.slot % 10).repeat(64),
    eventBatchId: stableIds.batchId,
    createdAt: ASSESSMENT_TEST_TIME,
    maxAttempts: COMMAND_MAX_ATTEMPTS
  }).row
  const row = options.harness.store.acquireLease({
    commandId: registered.commandId,
    seenGeneration: registered.currentLeaseGeneration,
    workerId: 'assessment-worker',
    now: ASSESSMENT_TEST_TIME,
    allowFailed: true
  })
  if (!row) throw new Error('assessment command lease was not acquired')
  return {
    row,
    envelope: buildCommandEnvelopeV2({
      commandId: row.commandId,
      commandType: row.commandType,
      source: 'INTERNAL',
      actor: { kind: 'USER', userId: row.actorId, role: options.actor.role, authSessionId: row.authSessionId! },
      target: options.target,
      payload: options.payload ?? {},
      requestHash: row.requestHash,
      createdAt: row.createdAt,
      clientInstanceId: row.clientInstanceId,
      idempotencyKey: row.idempotencyKey,
      eventBatchId: row.eventBatchId,
      actorId: row.actorId,
      deviceId: row.deviceId,
      authSessionId: row.authSessionId,
      leaseOwner: 'assessment-worker',
      leaseGeneration: row.currentLeaseGeneration
    })
  }
}
