import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { v4 as uuidv4 } from 'uuid'
import { buildCommandEnvelopeV2 } from '../../command/command-envelope'
import {
  COMMAND_MAX_ATTEMPTS,
  DurableCommandStore,
  type DurableCommandRow
} from '../../command/durable-command-store'
import type { CommandEnvelopeV2 } from '../../command/command-types'
import { createTestReportCommandCoordinator } from '../../runtime/__tests__/test-helpers'
import { EVENT_BATCH_SCHEMA_SQL } from '../../../db/event-batch-migration'
import type { DBAdapter } from '../../../db/interface'
import { MemoryAdapter } from '../../../db/memory-adapter'
import {
  createTestDb,
  seedAssessmentSessionFixture,
  seedBusinessSessionFixture,
  seedCaller,
  seedStudent
} from '../../../db/test-helpers'
import { EventBatchCoordinator } from '../../../domain/event-batch/batch-coordinator'
import type { EventBatchFaultInjector } from '../../../domain/event-batch/fault-injection'
import { DurableFileCapability } from '../../../domain/event-batch/file-capability'
import { RuntimeCorruptionState } from '../../../domain/event-batch/runtime-corruption'
import { FairWriterMutex } from '../../../domain/event-batch/writer-mutex'
import type { PreparedFactRegistry } from '../../../domain/event-batch/result-registry'
import { ReportService } from '../../../domain/report-service'
import { TaskClosureService } from '../../../domain/task-closure-service'
import { registerM5bReportAndClosurePreparedFacts } from '../../../domain/projectors/task-closure-projector'

export const REPORT_TEST_TIME = '2026-07-29T10:00:00.000Z'
export const REPORT_TEST_APP_VERSION = '1.0.0-alpha.1'
export const REPORT_TEST_JOB = 'SUPERMARKET_SHELVER'
export const REPORT_TEST_TASK = 'SHELVE_TASK'

function suffix(slot: number): string {
  if (!Number.isSafeInteger(slot) || slot < 1 || slot > 999_999_999_999) throw new Error('invalid report test slot')
  return String(slot).padStart(12, '0')
}

function testIds(slot: number) {
  return Object.freeze({
    commandId: `61000000-0000-4000-8000-${suffix(slot)}`,
    batchId: `62000000-0000-4000-8000-${suffix(slot)}`,
    clientId: `63000000-0000-4000-8000-${suffix(slot)}`,
    idempotencyKey: `64000000-0000-4000-8000-${suffix(slot)}`
  })
}

export interface ReportBatchHarness {
  readonly root: string
  readonly database: MemoryAdapter
  readonly store: DurableCommandStore
  readonly capability: DurableFileCapability
  readonly coordinator: EventBatchCoordinator
  close(): void
}

export async function createReportBatchHarness(options: Readonly<{
  faultInjector?: EventBatchFaultInjector
  root?: string
  registry?: PreparedFactRegistry
}> = {}): Promise<ReportBatchHarness> {
  const ownsRoot = options.root === undefined
  const root = options.root ?? mkdtempSync(join(tmpdir(), 'svets-m5b-report-'))
  const database = await createTestDb()
  database.exec(EVENT_BATCH_SCHEMA_SQL)
  const store = new DurableCommandStore(database)
  const capability = new DurableFileCapability(root)
  const registry = options.registry ?? registerM5bReportAndClosurePreparedFacts().seal()
  if (!registry.isSealed()) throw new Error('report batch harness requires a sealed prepared registry')
  const coordinator = new EventBatchCoordinator({
    database,
    commandStore: store,
    registry,
    fileCapability: capability,
    writerMutex: new FairWriterMutex(),
    corruptionState: new RuntimeCorruptionState(),
    workerId: 'report-worker',
    legacyAnchor: null,
    now: () => new Date(REPORT_TEST_TIME),
    faultInjector: options.faultInjector
  })
  return Object.freeze({
    root,
    database,
    store,
    capability,
    coordinator,
    close: () => {
      database.close()
      if (ownsRoot) rmSync(root, { recursive: true, force: true })
    }
  })
}

export interface AcceptedReportCommand {
  readonly row: DurableCommandRow
  readonly envelope: CommandEnvelopeV2
}

export function acceptReportCommand(options: Readonly<{
  harness: ReportBatchHarness
  slot: number
  commandType: string
  actorId: string
  target: Record<string, unknown>
  payload?: Record<string, unknown>
}>): AcceptedReportCommand {
  const ids = testIds(options.slot)
  const authSessionId = `report-auth-${options.actorId}`
  const registered = options.harness.store.registerOrLoad({
    commandId: ids.commandId,
    idempotencyKey: ids.idempotencyKey,
    clientInstanceId: ids.clientId,
    commandType: options.commandType,
    actorId: options.actorId,
    deviceId: 'report-device',
    authSessionId,
    requestHash: String(options.slot % 10).repeat(64),
    eventBatchId: ids.batchId,
    createdAt: REPORT_TEST_TIME,
    maxAttempts: COMMAND_MAX_ATTEMPTS
  }).row
  const row = options.harness.store.acquireLease({
    commandId: registered.commandId,
    seenGeneration: registered.currentLeaseGeneration,
    workerId: 'report-worker',
    now: REPORT_TEST_TIME,
    allowFailed: true
  })
  if (!row) throw new Error('report command lease was not acquired')
  const envelope = buildCommandEnvelopeV2({
    commandId: row.commandId,
    commandType: row.commandType,
    source: 'INTERNAL',
    actor: {
      kind: 'USER',
      userId: row.actorId,
      role: 'TEACHER',
      authSessionId
    },
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
    leaseOwner: 'report-worker',
    leaseGeneration: row.currentLeaseGeneration
  })
  return Object.freeze({ row, envelope })
}

function sourceEventId(db: DBAdapter, aggregateId: string): string {
  const eventId = uuidv4()
  db.prepare(
    `INSERT INTO domain_event_projection
       (event_id, aggregate_type, aggregate_id, event_type, event_sequence, payload_json,
        checksum, source_log_path, schema_version, created_at)
     VALUES (?, 'SYSTEM', ?, 'RESULT_CALCULATED', 1, '{}', 'checksum', 'fixture', 1, ?)`
  ).run(eventId, `${aggregateId}:${eventId}`, REPORT_TEST_TIME)
  return eventId
}

function seedTrainingSession(db: DBAdapter, teacherId: string, studentId: string): string {
  const trainingId = uuidv4()
  seedBusinessSessionFixture(db, {
    businessSessionId: trainingId,
    sessionType: 'TRAINING',
    studentId,
    jobCode: REPORT_TEST_JOB,
    taskCode: REPORT_TEST_TASK,
    createdBy: teacherId
  })
  db.prepare(
    `INSERT INTO training_session
       (training_session_id, business_session_id, student_id, job_code, task_code,
        strategy_id, strategy_type, strategy_version, status, total_step_count,
        completed_step_count, completion_rate, started_at, completed_at, created_by)
     VALUES (?, ?, ?, ?, ?, 'strategy_training_shelver_v1', 'TRAINING_PRACTICE', 1,
             'COMPLETED', 4, 4, 100, ?, ?, ?)`
  ).run(
    trainingId,
    trainingId,
    studentId,
    REPORT_TEST_JOB,
    REPORT_TEST_TASK,
    REPORT_TEST_TIME,
    REPORT_TEST_TIME,
    teacherId
  )
  return trainingId
}

export function seedBaseResultSet(
  db: DBAdapter,
  teacherId: string,
  studentId: string,
  scoreOffset = 0
): [string, string, string] {
  const assessmentId = seedAssessmentSessionFixture(db, {
    studentId,
    strategyId: 'strategy_baseline_shelver_v1',
    jobCode: REPORT_TEST_JOB,
    taskCode: REPORT_TEST_TASK,
    status: 'COMPLETED',
    createdBy: teacherId
  })
  db.prepare(
    'UPDATE assessment_session SET started_at = ?, completed_at = ? WHERE session_id = ?'
  ).run(REPORT_TEST_TIME, REPORT_TEST_TIME, assessmentId)
  const trainingId = seedTrainingSession(db, teacherId, studentId)
  const resultIds = [uuidv4(), uuidv4(), uuidv4()] as [string, string, string]
  const abilityScore = 60 + scoreOffset
  const operationScore = Math.max(0, 18 - scoreOffset)
  const insert = db.prepare(
    `INSERT INTO result_record
       (result_id, student_id, result_type, source_aggregate_type, source_aggregate_id,
        strategy_id, strategy_type, job_code, raw_score, max_score, normalized_score,
        completion_ratio, level_result, result_payload_json, generated_event_id, generated_at, is_current)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
  )
  insert.run(
    resultIds[0], studentId, 'ABILITY_SCORE', 'ASSESSMENT_SESSION', assessmentId,
    'strategy_baseline_shelver_v1', 'BASELINE_ASSESSMENT', REPORT_TEST_JOB,
    abilityScore, 100, abilityScore, 1, 'LEVEL_CONDITIONAL',
    JSON.stringify({
      result_type: 'ABILITY_SCORE',
      module_scores: [],
      online_raw_score: abilityScore,
      offline_raw_score: 0,
      question_count: 42,
      answered_count: 42,
      completion_ratio: 1,
      emotion_collapse_count: 0,
      module_veto_triggered_by: null,
      level_forced_by: null
    }),
    sourceEventId(db, assessmentId),
    REPORT_TEST_TIME
  )
  insert.run(
    resultIds[1], studentId, 'TRAINING_COMPLETION', 'TRAINING_SESSION', trainingId,
    'strategy_training_shelver_v1', 'TRAINING_PRACTICE', REPORT_TEST_JOB,
    null, null, 100, 1, 'LEVEL_COMPETENT', null,
    sourceEventId(db, trainingId), REPORT_TEST_TIME
  )
  insert.run(
    resultIds[2], studentId, 'OPERATION_PASS_RATE', 'ASSESSMENT_SESSION', assessmentId,
    'strategy_baseline_shelver_v1', 'BASELINE_ASSESSMENT', REPORT_TEST_JOB,
    operationScore, 18, Math.round((operationScore / 18) * 100), 1, 'LEVEL_COMPETENT',
    JSON.stringify({
      result_type: 'OPERATION_PASS_RATE',
      raw_score: operationScore,
      max_score: 18,
      total_items: 9,
      scored_at: REPORT_TEST_TIME,
      items: [
        'IDENTIFY_BOX',
        'CHECK_BOX_DAMAGE',
        'OPEN_PACKAGE_SAFELY',
        'TAKE_OUT_GOODS',
        'CHECK_GOODS_APPEARANCE',
        'IDENTIFY_SHELF_POSITION',
        'PLACE_BY_RULE',
        'TIDY_SHELF_FACE',
        'CONFIRM_COMPLETION'
      ].map((task_operation_code, index) => ({
        task_operation_code,
        score: index === 0 ? Math.max(0, operationScore - 16) : 2
      }))
    }),
    sourceEventId(db, assessmentId),
    REPORT_TEST_TIME
  )
  return resultIds
}

export interface SeededReportBusinessState {
  readonly teacherId: string
  readonly studentId: string
  readonly resultIds: [string, string, string]
  readonly closureId: string
  readonly reportId: string
}

export async function seedLegacyReportBusinessState(
  harness: ReportBatchHarness
): Promise<SeededReportBusinessState> {
  const db = harness.database
  const teacherId = seedCaller(db, 'TEACHER')
  const studentId = seedStudent(db)
  const resultIds = seedBaseResultSet(db, teacherId, studentId)
  const legacyCoordinator = createTestReportCommandCoordinator({
    db,
    actionLogPath: join(harness.root, 'legacy-action-log.jsonl')
  })
  const closure = await new TaskClosureService(db, legacyCoordinator).confirmBaseTaskClosure({
    callerUserId: teacherId,
    callerRole: 'TEACHER',
    resultIds,
    confirmedAt: REPORT_TEST_TIME,
    correlationId: 'legacy-closure-fixture'
  })
  const report = await new ReportService(db, legacyCoordinator).generateReport({
    callerUserId: teacherId,
    callerRole: 'TEACHER',
    reportScope: 'BASE_ABILITY',
    taskClosureId: closure.taskClosureId,
    generatedAt: REPORT_TEST_TIME,
    correlationId: 'legacy-report-fixture'
  })
  return Object.freeze({
    teacherId,
    studentId,
    resultIds,
    closureId: closure.taskClosureId,
    reportId: report.reportId
  })
}
