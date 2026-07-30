import { createHash } from 'crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  confirmPlacementReview as legacyConfirmPlacementReview,
  confirmTaskClosure as legacyConfirmTaskClosure,
  generateReport as legacyGenerateReport,
  lockReport as legacyLockReport,
  replaceTaskClosure as legacyReplaceTaskClosure
} from '../../../application/services/__tests__/reports-test-support'
import { ReportPlanner, ReportPlannerError, loadReportPlannerSnapshot } from '../../../application/planners/report-planner'
import {
  REPORT_TEST_APP_VERSION,
  REPORT_TEST_JOB,
  REPORT_TEST_TASK,
  acceptReportCommand,
  createReportBatchHarness,
  seedBaseResultSet
} from '../../../application/planners/__tests__/report-test-support'
import {
  TaskClosurePlanner,
  loadTaskClosurePlannerSnapshot
} from '../../../application/planners/task-closure-planner'
import { createTestReportCommandCoordinator } from '../../../application/runtime/__tests__/test-helpers'
import { seedCaller, seedStudent } from '../../../db/test-helpers'
import {
  runCommandDifferential,
  type DifferentialFieldNormalizer,
  type DifferentialRunContext,
  type DifferentialSnapshot
} from '../../event-batch/__tests__/command-differential-harness'
import { canonicalJson, type CanonicalJsonValue } from '../../event-batch/canonical-json'

const deterministicUuid = vi.hoisted(() => {
  let cursor = 0
  return {
    reset: () => {
      cursor = 0
    },
    v4: () => {
      cursor += 1
      return `71000000-0000-4000-8000-${String(cursor).padStart(12, '0')}`
    }
  }
})

vi.mock('uuid', () => ({ v4: deterministicUuid.v4 }))

const TIME = '2026-07-29T10:00:00.000Z'
const ORACLE_PATHS = [
  'src/main/application/services/reports-service.ts',
  'src/main/domain/task-closure-service.ts',
  'src/main/domain/report-service.ts',
  'src/main/domain/report-reducer.ts',
  'src/main/domain/report-builders.ts',
  'src/main/domain/report-contract.ts'
] as const
const DIFFERENTIAL_IDS = Object.freeze({
  confirm: 'M5B-DIFF-REPORTS-CONFIRMTASKCLOSURE',
  replace: 'M5B-DIFF-REPORTS-REPLACETASKCLOSURE',
  generate: 'M5B-DIFF-REPORTS-GENERATE',
  placementReview: 'M5B-DIFF-REPORTS-CONFIRMPLACEMENTREVIEW',
  lock: 'M5B-DIFF-REPORTS-LOCK'
})

interface QueryDatabase {
  prepare(sql: string): {
    all(...params: unknown[]): unknown[]
  }
}

function canonical(value: unknown): CanonicalJsonValue {
  return JSON.parse(canonicalJson(value)) as CanonicalJsonValue
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('expected SQL row object')
  }
  return value as Record<string, unknown>
}

function json(value: unknown): CanonicalJsonValue {
  if (typeof value !== 'string') throw new Error('expected JSON TEXT column')
  return canonical(JSON.parse(value) as unknown)
}

function eventIds(database: QueryDatabase): Set<string> {
  return new Set(
    database.prepare('SELECT event_id FROM domain_event_projection').all().map((value) => {
      const eventId = record(value).event_id
      if (typeof eventId !== 'string') throw new Error('event_id is missing')
      return eventId
    })
  )
}

function taskClosureRows(database: QueryDatabase): readonly Readonly<Record<string, CanonicalJsonValue>>[] {
  return database.prepare(
    `SELECT task_closure_id, student_id, job_code, task_code, cycle_no, closure_revision,
            status, is_cycle_head, ability_result_id, training_completion_result_id,
            operation_pass_rate_result_id, replaces_task_closure_id,
            replacement_task_closure_id, correction_reason
       FROM task_closure
      ORDER BY closure_revision, task_closure_id`
  ).all().map((value) => canonical(record(value)) as Readonly<Record<string, CanonicalJsonValue>>)
}

function taskReportRows(database: QueryDatabase): readonly Readonly<Record<string, CanonicalJsonValue>>[] {
  return database.prepare(
    `SELECT report_id, student_id, report_type, source_aggregate_type, source_aggregate_id,
            source_result_ids_json, report_title, report_content_json, task_closure_id,
            lineage_key, source_set_hash, generation_key, content_hash, report_revision,
            report_schema_version, report_builder_version, generation_reason, status,
            placement_review_by, placement_review_at
       FROM task_report
      ORDER BY report_revision, report_id`
  ).all().map((value) => {
    const row = record(value)
    return canonical({
      report_id: row.report_id,
      student_id: row.student_id,
      report_type: row.report_type,
      source_aggregate_type: row.source_aggregate_type,
      source_aggregate_id: row.source_aggregate_id,
      source_result_ids: json(row.source_result_ids_json),
      report_title: row.report_title,
      report_content: json(row.report_content_json),
      task_closure_id: row.task_closure_id,
      lineage_key: row.lineage_key,
      source_set_hash: row.source_set_hash,
      generation_key: row.generation_key,
      content_hash: row.content_hash,
      report_revision: row.report_revision,
      report_schema_version: row.report_schema_version,
      report_builder_version: row.report_builder_version,
      generation_reason: row.generation_reason,
      status: row.status,
      placement_review_by: row.placement_review_by,
      placement_review_at: row.placement_review_at
    }) as Readonly<Record<string, CanonicalJsonValue>>
  })
}

const EVENT_BATCH_METADATA = new Set([
  'event_payload_version',
  'batch_context',
  'actor_role',
  'app_version',
  'correlation_id'
])

function eventSemantics(
  database: QueryDatabase,
  baselineEventIds: ReadonlySet<string>
): DifferentialSnapshot['events'] {
  return database.prepare(
    `SELECT event_id, event_type, payload_json
       FROM domain_event_projection
      ORDER BY rowid`
  ).all().flatMap((value) => {
    const row = record(value)
    if (typeof row.event_id !== 'string' || baselineEventIds.has(row.event_id)) return []
    if (typeof row.event_type !== 'string') throw new Error('event_type is missing')
    const payload = json(row.payload_json)
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      throw new Error('event payload must be an object')
    }
    return [{
      eventType: row.event_type,
      payload: canonical(Object.fromEntries(
        Object.entries(payload).filter(([field]) => !EVENT_BATCH_METADATA.has(field))
      ))
    }]
  })
}

function preStateFile(dataRoot: string): DifferentialSnapshot['files'] {
  const value = readFileSync(join(dataRoot, 'prestate.json'))
  return {
    'prestate.json': {
      sha256: createHash('sha256').update(value).digest('hex'),
      byteLength: value.length
    }
  }
}

function snapshot(
  database: QueryDatabase,
  context: DifferentialRunContext,
  publicResult: unknown,
  baselineEventIds: ReadonlySet<string>
): DifferentialSnapshot {
  return {
    publicResult: canonical(publicResult),
    businessTables: {
      task_closure: taskClosureRows(database),
      task_report: taskReportRows(database)
    },
    events: eventSemantics(database, baselineEventIds),
    files: preStateFile(context.dataRoot)
  }
}

function normalizer(path: string, rationale: string): DifferentialFieldNormalizer {
  return {
    path,
    rationale,
    normalize: () => '[implementation-derived-id]'
  }
}

const CONFIRM_NORMALIZERS = [
  normalizer('publicResult.taskClosure.taskClosureId', 'legacy and v2 derive the new closure ID differently'),
  normalizer('businessTables.task_closure.0.task_closure_id', 'legacy and v2 derive the new closure ID differently'),
  normalizer('events.0.payload.task_closure_id', 'the event carries the new implementation-derived closure ID')
] as const

const REPLACE_NORMALIZERS = [
  normalizer('publicResult.taskClosure.taskClosureId', 'legacy and v2 derive the replacement closure ID differently'),
  normalizer('businessTables.task_closure.0.replacement_task_closure_id', 'the old closure links to the implementation-derived replacement ID'),
  normalizer('businessTables.task_closure.1.task_closure_id', 'legacy and v2 derive the replacement closure ID differently'),
  normalizer('events.0.payload.new_task_closure_id', 'the event carries the implementation-derived replacement closure ID')
] as const

const GENERATE_NORMALIZERS = [
  normalizer('publicResult.reportId', 'legacy and v2 derive the generated report ID differently'),
  normalizer('businessTables.task_report.0.report_id', 'legacy and v2 derive the generated report ID differently'),
  normalizer('events.0.payload.report_id', 'the event carries the implementation-derived report ID')
] as const

function newPreStateRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'svets-m5b-report-differential-prestate-'))
  writeFileSync(join(root, 'prestate.json'), JSON.stringify({ schema_version: 1, created_at: TIME }))
  return root
}

async function createLegacyExecution(context: DifferentialRunContext) {
  const harness = await createReportBatchHarness({ root: context.dataRoot })
  return {
    harness,
    execution: {
      coordinator: createTestReportCommandCoordinator({
        db: harness.database,
        actionLogPath: join(context.dataRoot, 'legacy-action-log.jsonl')
      }),
      now: () => TIME
    }
  }
}

async function seedClosure(
  context: DifferentialRunContext,
  harness: Awaited<ReturnType<typeof createReportBatchHarness>>,
  execution: Awaited<ReturnType<typeof createLegacyExecution>>['execution']
) {
  const teacherId = seedCaller(harness.database, 'TEACHER')
  const studentId = seedStudent(harness.database)
  const resultIds = seedBaseResultSet(harness.database, teacherId, studentId)
  const result = await legacyConfirmTaskClosure(harness.database, {
    callerUserId: teacherId,
    callerRole: 'TEACHER',
    resultIds
  }, execution)
  if (!result.success) throw new Error(`legacy closure seed failed: ${result.errorCode}`)
  return { teacherId, studentId, resultIds, closureId: result.taskClosure.taskClosureId, context }
}

async function seedReport(
  context: DifferentialRunContext,
  harness: Awaited<ReturnType<typeof createReportBatchHarness>>,
  execution: Awaited<ReturnType<typeof createLegacyExecution>>['execution']
) {
  const seeded = await seedClosure(context, harness, execution)
  const result = await legacyGenerateReport(harness.database, {
    callerUserId: seeded.teacherId,
    callerRole: 'TEACHER',
    reportScope: 'BASE_ABILITY',
    taskClosureId: seeded.closureId
  }, execution)
  if (!result.success) throw new Error(`legacy report seed failed: ${result.errorCode}`)
  return { ...seeded, reportId: result.reportId }
}

async function runV2Confirm(
  harness: Awaited<ReturnType<typeof createReportBatchHarness>>,
  teacherId: string,
  studentId: string,
  resultIds: readonly string[],
  slot: number
) {
  const command = acceptReportCommand({
    harness,
    slot,
    commandType: 'reports:confirmTaskClosure',
    actorId: teacherId,
    target: {
      aggregate_type: 'TASK_CLOSURE',
      student_id: studentId,
      job_code: REPORT_TEST_JOB,
      task_code: REPORT_TEST_TASK,
      source_result_ids: resultIds
    }
  })
  return harness.coordinator.execute({
    envelope: command.envelope,
    readSnapshot: () => loadTaskClosurePlannerSnapshot(harness.database, command.envelope, {
      timestamp: TIME,
      appVersion: REPORT_TEST_APP_VERSION
    }),
    planner: new TaskClosurePlanner()
  })
}

async function runV2Generate(
  harness: Awaited<ReturnType<typeof createReportBatchHarness>>,
  teacherId: string,
  studentId: string,
  closureId: string,
  slot: number
) {
  const command = acceptReportCommand({
    harness,
    slot,
    commandType: 'reports:generate',
    actorId: teacherId,
    target: {
      aggregate_type: 'TASK_REPORT',
      report_scope: 'BASE_ABILITY',
      source_id: closureId,
      student_id: studentId,
      job_code: REPORT_TEST_JOB,
      task_code: REPORT_TEST_TASK
    }
  })
  return harness.coordinator.execute({
    envelope: command.envelope,
    readSnapshot: () => loadReportPlannerSnapshot(harness.database, command.envelope, {
      timestamp: TIME,
      appVersion: REPORT_TEST_APP_VERSION
    }),
    planner: new ReportPlanner()
  })
}

async function runV2Replace(
  harness: Awaited<ReturnType<typeof createReportBatchHarness>>,
  teacherId: string,
  studentId: string,
  closureId: string,
  resultIds: readonly string[],
  slot: number
) {
  const command = acceptReportCommand({
    harness,
    slot,
    commandType: 'reports:replaceTaskClosure',
    actorId: teacherId,
    target: {
      aggregate_type: 'TASK_CLOSURE',
      task_closure_id: closureId,
      student_id: studentId,
      job_code: REPORT_TEST_JOB,
      task_code: REPORT_TEST_TASK,
      source_result_ids: resultIds
    },
    payload: { correctionReason: 'Corrected source results' }
  })
  return harness.coordinator.execute({
    envelope: command.envelope,
    readSnapshot: () => loadTaskClosurePlannerSnapshot(harness.database, command.envelope, {
      timestamp: TIME,
      appVersion: REPORT_TEST_APP_VERSION
    }),
    planner: new TaskClosurePlanner()
  })
}

async function runV2Lifecycle(
  harness: Awaited<ReturnType<typeof createReportBatchHarness>>,
  commandType: 'reports:confirmPlacementReview' | 'reports:lock',
  teacherId: string,
  studentId: string,
  reportId: string,
  slot: number
) {
  const command = acceptReportCommand({
    harness,
    slot,
    commandType,
    actorId: teacherId,
    target: {
      aggregate_type: 'TASK_REPORT',
      report_id: reportId,
      student_id: studentId,
      job_code: REPORT_TEST_JOB,
      task_code: REPORT_TEST_TASK
    },
    ...(commandType === 'reports:lock' ? { payload: { lockReason: 'teacher-confirmed' } } : {})
  })
  try {
    return await harness.coordinator.execute({
      envelope: command.envelope,
      readSnapshot: () => loadReportPlannerSnapshot(harness.database, command.envelope, {
        timestamp: TIME,
        appVersion: REPORT_TEST_APP_VERSION
      }),
      planner: new ReportPlanner()
    })
  } catch (error) {
    if (error instanceof ReportPlannerError && error.code === 'REPORT_STATE_CONFLICT') {
      return { publicResult: { success: false, errorCode: 'REPORT_STATE_CONFLICT' } }
    }
    throw error
  }
}

async function runDifferential(
  testId: string,
  normalizers: readonly DifferentialFieldNormalizer[],
  runLegacy: (context: DifferentialRunContext) => Promise<DifferentialSnapshot>,
  runV2: (context: DifferentialRunContext) => Promise<DifferentialSnapshot>
) {
  const preStateRoot = newPreStateRoot()
  try {
    const result = await runCommandDifferential({
      testId,
      preStateRoot,
      timestamp: TIME,
      ids: ['65000000-0000-4000-8000-000000000001'],
      oraclePaths: ORACLE_PATHS,
      normalizers,
      runLegacy: async (context) => {
        deterministicUuid.reset()
        return runLegacy(context)
      },
      runV2: async (context) => {
        deterministicUuid.reset()
        return runV2(context)
      }
    })
    expect(result.oracle.paths).toEqual([...ORACLE_PATHS].sort())
  } finally {
    rmSync(preStateRoot, { recursive: true, force: true })
  }
}

describe('M5B report command differential semantics', () => {
  beforeAll(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(TIME))
  })

  afterAll(() => {
    vi.useRealTimers()
  })

  it(DIFFERENTIAL_IDS.confirm, async () => {
    await runDifferential(DIFFERENTIAL_IDS.confirm, CONFIRM_NORMALIZERS, async (context) => {
      const { harness, execution } = await createLegacyExecution(context)
      try {
        const teacherId = seedCaller(harness.database, 'TEACHER')
        const studentId = seedStudent(harness.database)
        const resultIds = seedBaseResultSet(harness.database, teacherId, studentId)
        const baseline = eventIds(harness.database)
        const result = await legacyConfirmTaskClosure(harness.database, {
          callerUserId: teacherId,
          callerRole: 'TEACHER',
          resultIds
        }, execution)
        return snapshot(harness.database, context, result, baseline)
      } finally {
        harness.close()
      }
    }, async (context) => {
      const harness = await createReportBatchHarness({ root: context.dataRoot })
      try {
        const teacherId = seedCaller(harness.database, 'TEACHER')
        const studentId = seedStudent(harness.database)
        const resultIds = seedBaseResultSet(harness.database, teacherId, studentId)
        const baseline = eventIds(harness.database)
        const result = await runV2Confirm(harness, teacherId, studentId, resultIds, 201)
        return snapshot(harness.database, context, result.publicResult, baseline)
      } finally {
        harness.close()
      }
    })
  })

  it(DIFFERENTIAL_IDS.replace, async () => {
    await runDifferential(DIFFERENTIAL_IDS.replace, REPLACE_NORMALIZERS, async (context) => {
      const { harness, execution } = await createLegacyExecution(context)
      try {
        const seeded = await seedReport(context, harness, execution)
        const replacementResultIds = seedBaseResultSet(
          harness.database,
          seeded.teacherId,
          seeded.studentId,
          1
        )
        const baseline = eventIds(harness.database)
        const result = await legacyReplaceTaskClosure(harness.database, {
          callerUserId: seeded.teacherId,
          callerRole: 'TEACHER',
          taskClosureId: seeded.closureId,
          resultIds: replacementResultIds,
          correctionReason: 'Corrected source results'
        }, execution)
        return snapshot(harness.database, context, result, baseline)
      } finally {
        harness.close()
      }
    }, async (context) => {
      const { harness, execution } = await createLegacyExecution(context)
      try {
        const seeded = await seedReport(context, harness, execution)
        const replacementResultIds = seedBaseResultSet(
          harness.database,
          seeded.teacherId,
          seeded.studentId,
          1
        )
        const baseline = eventIds(harness.database)
        const result = await runV2Replace(
          harness,
          seeded.teacherId,
          seeded.studentId,
          seeded.closureId,
          replacementResultIds,
          202
        )
        return snapshot(harness.database, context, result.publicResult, baseline)
      } finally {
        harness.close()
      }
    })
  })

  it(DIFFERENTIAL_IDS.generate, async () => {
    await runDifferential(DIFFERENTIAL_IDS.generate, GENERATE_NORMALIZERS, async (context) => {
      const { harness, execution } = await createLegacyExecution(context)
      try {
        const seeded = await seedClosure(context, harness, execution)
        const baseline = eventIds(harness.database)
        const result = await legacyGenerateReport(harness.database, {
          callerUserId: seeded.teacherId,
          callerRole: 'TEACHER',
          reportScope: 'BASE_ABILITY',
          taskClosureId: seeded.closureId
        }, execution)
        return snapshot(harness.database, context, result, baseline)
      } finally {
        harness.close()
      }
    }, async (context) => {
      const { harness, execution } = await createLegacyExecution(context)
      try {
        const seeded = await seedClosure(context, harness, execution)
        const baseline = eventIds(harness.database)
        const result = await runV2Generate(harness, seeded.teacherId, seeded.studentId, seeded.closureId, 203)
        return snapshot(harness.database, context, result.publicResult, baseline)
      } finally {
        harness.close()
      }
    })
  })

  it(DIFFERENTIAL_IDS.placementReview, async () => {
    await runDifferential(DIFFERENTIAL_IDS.placementReview, [], async (context) => {
      const { harness, execution } = await createLegacyExecution(context)
      try {
        const seeded = await seedReport(context, harness, execution)
        const baseline = eventIds(harness.database)
        const result = await legacyConfirmPlacementReview(harness.database, {
          callerUserId: seeded.teacherId,
          callerRole: 'TEACHER',
          reportId: seeded.reportId
        }, execution)
        return snapshot(harness.database, context, result, baseline)
      } finally {
        harness.close()
      }
    }, async (context) => {
      const { harness, execution } = await createLegacyExecution(context)
      try {
        const seeded = await seedReport(context, harness, execution)
        const baseline = eventIds(harness.database)
        const result = await runV2Lifecycle(
          harness,
          'reports:confirmPlacementReview',
          seeded.teacherId,
          seeded.studentId,
          seeded.reportId,
          204
        )
        return snapshot(harness.database, context, result.publicResult, baseline)
      } finally {
        harness.close()
      }
    })
  })

  it(DIFFERENTIAL_IDS.lock, async () => {
    await runDifferential(DIFFERENTIAL_IDS.lock, [], async (context) => {
      const { harness, execution } = await createLegacyExecution(context)
      try {
        const seeded = await seedReport(context, harness, execution)
        const baseline = eventIds(harness.database)
        const result = await legacyLockReport(harness.database, {
          callerUserId: seeded.teacherId,
          callerRole: 'TEACHER',
          reportId: seeded.reportId,
          lockReason: 'teacher-confirmed'
        }, execution)
        return snapshot(harness.database, context, result, baseline)
      } finally {
        harness.close()
      }
    }, async (context) => {
      const { harness, execution } = await createLegacyExecution(context)
      try {
        const seeded = await seedReport(context, harness, execution)
        const baseline = eventIds(harness.database)
        const result = await runV2Lifecycle(
          harness,
          'reports:lock',
          seeded.teacherId,
          seeded.studentId,
          seeded.reportId,
          205
        )
        return snapshot(harness.database, context, result.publicResult, baseline)
      } finally {
        harness.close()
      }
    })
  })
})
