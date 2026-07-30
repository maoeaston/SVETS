import { describe, expect, it } from 'vitest'
import { createEventBatchFaultInjectorForTests } from '../../event-batch/fault-injection'
import { loadVerifiedProjectionSources } from '../../event-batch/projection-source'
import { ReportPlanner, loadReportPlannerSnapshot } from '../../../application/planners/report-planner'
import {
  REPORT_TEST_APP_VERSION,
  REPORT_TEST_JOB,
  REPORT_TEST_TASK,
  acceptReportCommand,
  createReportBatchHarness,
  seedBaseResultSet,
  seedLegacyReportBusinessState
} from '../../../application/planners/__tests__/report-test-support'
import {
  TaskClosurePlanner,
  loadTaskClosurePlannerSnapshot
} from '../../../application/planners/task-closure-planner'
import { seedCaller, seedStudent } from '../../../db/test-helpers'

const TIME = '2026-07-29T10:00:00.000Z'

function count(database: { prepare(sql: string): { get(...values: unknown[]): unknown } }, table: string): number {
  const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }
  return row.count
}

async function confirmClosure(options: Readonly<{
  harness: Awaited<ReturnType<typeof createReportBatchHarness>>
  slot: number
  teacherId: string
  studentId: string
  resultIds: readonly string[]
}>) {
  const command = acceptReportCommand({
    harness: options.harness,
    slot: options.slot,
    commandType: 'reports:confirmTaskClosure',
    actorId: options.teacherId,
    target: {
      aggregate_type: 'TASK_CLOSURE',
      student_id: options.studentId,
      job_code: REPORT_TEST_JOB,
      task_code: REPORT_TEST_TASK,
      source_result_ids: options.resultIds
    }
  })
  return options.harness.coordinator.execute({
    envelope: command.envelope,
    readSnapshot: () => loadTaskClosurePlannerSnapshot(options.harness.database, command.envelope, {
      timestamp: TIME,
      appVersion: REPORT_TEST_APP_VERSION
    }),
    planner: new TaskClosurePlanner()
  })
}

async function prepareReportGeneration(options: Readonly<{
  harness: Awaited<ReturnType<typeof createReportBatchHarness>>
  slot: number
  teacherId: string
  studentId: string
  closureId: string
}>) {
  const command = acceptReportCommand({
    harness: options.harness,
    slot: options.slot,
    commandType: 'reports:generate',
    actorId: options.teacherId,
    target: {
      aggregate_type: 'TASK_REPORT',
      report_scope: 'BASE_ABILITY',
      source_id: options.closureId,
      student_id: options.studentId,
      job_code: REPORT_TEST_JOB,
      task_code: REPORT_TEST_TASK
    }
  })
  return { command }
}

async function generateReport(options: Readonly<{
  harness: Awaited<ReturnType<typeof createReportBatchHarness>>
  slot: number
  teacherId: string
  studentId: string
  closureId: string
}>) {
  const prepared = await prepareReportGeneration(options)
  return options.harness.coordinator.execute({
    envelope: prepared.command.envelope,
    readSnapshot: () => loadReportPlannerSnapshot(options.harness.database, prepared.command.envelope, {
      timestamp: TIME,
      appVersion: REPORT_TEST_APP_VERSION
    }),
    planner: new ReportPlanner()
  })
}

describe('M5B report and closure projectors', () => {
  it('applies closure then report generation from prepared facts and returns the frozen public recipes', async () => {
    const harness = await createReportBatchHarness()
    try {
      const teacherId = seedCaller(harness.database, 'TEACHER')
      const studentId = seedStudent(harness.database)
      const resultIds = seedBaseResultSet(harness.database, teacherId, studentId)
      const closure = await confirmClosure({ harness, slot: 1, teacherId, studentId, resultIds })

      expect(closure.publicResult).toMatchObject({
        success: true,
        taskClosure: { studentId, jobCode: REPORT_TEST_JOB, taskCode: REPORT_TEST_TASK, resultIds }
      })
      const closureId = (closure.publicResult as { taskClosure: { taskClosureId: string } }).taskClosure.taskClosureId
      expect(count(harness.database, 'task_closure')).toBe(1)
      expect(count(harness.database, 'applied_event_batch')).toBe(1)

      const report = await generateReport({ harness, slot: 2, teacherId, studentId, closureId })
      expect(report.publicResult).toMatchObject({ success: true, generated: true })
      expect(count(harness.database, 'task_report')).toBe(1)
      expect(count(harness.database, 'applied_event_batch')).toBe(2)
      expect(loadVerifiedProjectionSources(harness.capability)).toHaveLength(2)
      const persisted = harness.store.findByCommandId(report.command.commandId)
      expect(persisted).toMatchObject({ status: 'SUCCEEDED' })
    } finally {
      harness.close()
    }
  })

  it('treats a matching report generation as a zero-event no-op without claiming its reserved batch', async () => {
    const harness = await createReportBatchHarness()
    try {
      const teacherId = seedCaller(harness.database, 'TEACHER')
      const studentId = seedStudent(harness.database)
      const resultIds = seedBaseResultSet(harness.database, teacherId, studentId)
      const closure = await confirmClosure({ harness, slot: 10, teacherId, studentId, resultIds })
      const closureId = (closure.publicResult as { taskClosure: { taskClosureId: string } }).taskClosure.taskClosureId
      await generateReport({ harness, slot: 11, teacherId, studentId, closureId })
      const noOp = await generateReport({ harness, slot: 12, teacherId, studentId, closureId })

      expect(noOp).toMatchObject({ status: 'COMPLETED', batch: null, publicResult: { success: true, generated: false } })
      expect(count(harness.database, 'applied_event_batch')).toBe(2)
      expect(count(harness.database, 'task_report')).toBe(1)
      expect(loadVerifiedProjectionSources(harness.capability)).toHaveLength(2)
    } finally {
      harness.close()
    }
  })

  it('replaces a closure from prepared facts and archives its active report in the same batch', async () => {
    const harness = await createReportBatchHarness()
    try {
      const teacherId = seedCaller(harness.database, 'TEACHER')
      const studentId = seedStudent(harness.database)
      const originalResultIds = seedBaseResultSet(harness.database, teacherId, studentId)
      const original = await confirmClosure({
        harness,
        slot: 15,
        teacherId,
        studentId,
        resultIds: originalResultIds
      })
      const originalClosureId = (original.publicResult as {
        taskClosure: { taskClosureId: string }
      }).taskClosure.taskClosureId
      await generateReport({
        harness,
        slot: 16,
        teacherId,
        studentId,
        closureId: originalClosureId
      })
      const replacementResultIds = seedBaseResultSet(harness.database, teacherId, studentId, 1)
      const command = acceptReportCommand({
        harness,
        slot: 17,
        commandType: 'reports:replaceTaskClosure',
        actorId: teacherId,
        target: {
          aggregate_type: 'TASK_CLOSURE',
          task_closure_id: originalClosureId,
          student_id: studentId,
          job_code: REPORT_TEST_JOB,
          task_code: REPORT_TEST_TASK,
          source_result_ids: replacementResultIds
        },
        payload: { correctionReason: 'Corrected source results' }
      })
      const replacement = await harness.coordinator.execute({
        envelope: command.envelope,
        readSnapshot: () => loadTaskClosurePlannerSnapshot(harness.database, command.envelope, {
          timestamp: TIME,
          appVersion: REPORT_TEST_APP_VERSION
        }),
        planner: new TaskClosurePlanner()
      })
      const replacementClosureId = (replacement.publicResult as {
        taskClosure: { taskClosureId: string }
      }).taskClosure.taskClosureId

      expect(replacement.publicResult).toMatchObject({
        success: true,
        taskClosure: {
          taskClosureId: replacementClosureId,
          closureRevision: 2,
          status: 'CONFIRMED',
          resultIds: replacementResultIds
        }
      })
      expect(harness.database.prepare(
        'SELECT status, is_cycle_head, replacement_task_closure_id FROM task_closure WHERE task_closure_id = ?'
      ).get(originalClosureId)).toEqual({
        status: 'SUPERSEDED',
        is_cycle_head: 0,
        replacement_task_closure_id: replacementClosureId
      })
      expect(harness.database.prepare(
        'SELECT status, replaces_task_closure_id FROM task_closure WHERE task_closure_id = ?'
      ).get(replacementClosureId)).toEqual({
        status: 'CONFIRMED',
        replaces_task_closure_id: originalClosureId
      })
      expect(harness.database.prepare(
        'SELECT status FROM task_report WHERE task_closure_id = ?'
      ).get(originalClosureId)).toEqual({ status: 'ARCHIVED' })
      expect(count(harness.database, 'applied_event_batch')).toBe(3)
    } finally {
      harness.close()
    }
  })

  it('uses prepared report facts when report inputs drift after PREPARE', async () => {
    let driftSource: (() => void) | null = null
    const harness = await createReportBatchHarness({
      faultInjector: createEventBatchFaultInjectorForTests({
        failAt: null,
        onHit: (point) => {
          if (point === 'AFTER_PREPARE_FSYNC') driftSource?.()
        }
      })
    })
    try {
      const teacherId = seedCaller(harness.database, 'TEACHER')
      const studentId = seedStudent(harness.database)
      const resultIds = seedBaseResultSet(harness.database, teacherId, studentId)
      const closure = await confirmClosure({ harness, slot: 20, teacherId, studentId, resultIds })
      const closureId = (closure.publicResult as { taskClosure: { taskClosureId: string } }).taskClosure.taskClosureId
      const prepared = await prepareReportGeneration({ harness, slot: 21, teacherId, studentId, closureId })
      const snapshot = loadReportPlannerSnapshot(harness.database, prepared.command.envelope, {
        timestamp: TIME,
        appVersion: REPORT_TEST_APP_VERSION
      }).value as { report_facts: { report_content: unknown; content_hash: string } }
      const frozenContent = structuredClone(snapshot.report_facts.report_content)
      const frozenHash = snapshot.report_facts.content_hash

      driftSource = () => {
        harness.database.prepare(
          'UPDATE result_record SET normalized_score = 0, raw_score = 0 WHERE result_id = ?'
        ).run(resultIds[0])
      }
      const result = await harness.coordinator.execute({
        envelope: prepared.command.envelope,
        readSnapshot: () => loadReportPlannerSnapshot(harness.database, prepared.command.envelope, {
          timestamp: TIME,
          appVersion: REPORT_TEST_APP_VERSION
        }),
        planner: new ReportPlanner()
      })
      const reportId = (result.publicResult as { reportId: string }).reportId
      const row = harness.database.prepare(
        'SELECT report_content_json, content_hash FROM task_report WHERE report_id = ?'
      ).get(reportId) as { report_content_json: string; content_hash: string }

      expect(JSON.parse(row.report_content_json)).toEqual(frozenContent)
      expect(row.content_hash).toBe(frozenHash)
    } finally {
      harness.close()
    }
  })

  it('projects placement review and lock from lifecycle payloads while preserving legacy report content', async () => {
    const harness = await createReportBatchHarness()
    try {
      const seeded = await seedLegacyReportBusinessState(harness)
      const reviewCommand = acceptReportCommand({
        harness,
        slot: 30,
        commandType: 'reports:confirmPlacementReview',
        actorId: seeded.teacherId,
        target: {
          aggregate_type: 'TASK_REPORT', report_id: seeded.reportId, student_id: seeded.studentId,
          job_code: REPORT_TEST_JOB, task_code: REPORT_TEST_TASK
        }
      })
      expect(() => loadReportPlannerSnapshot(harness.database, reviewCommand.envelope, {
        timestamp: TIME,
        appVersion: REPORT_TEST_APP_VERSION
      })).toThrow(/placement advice is not enabled/)

      const lockCommand = acceptReportCommand({
        harness,
        slot: 31,
        commandType: 'reports:lock',
        actorId: seeded.teacherId,
        target: {
          aggregate_type: 'TASK_REPORT', report_id: seeded.reportId, student_id: seeded.studentId,
          job_code: REPORT_TEST_JOB, task_code: REPORT_TEST_TASK
        },
        payload: { lockReason: 'teacher-confirmed' }
      })
      const lock = await harness.coordinator.execute({
        envelope: lockCommand.envelope,
        readSnapshot: () => loadReportPlannerSnapshot(harness.database, lockCommand.envelope, { timestamp: TIME, appVersion: REPORT_TEST_APP_VERSION }),
        planner: new ReportPlanner()
      })
      expect(lock.publicResult).toEqual({ success: true, reportId: seeded.reportId, status: 'LOCKED' })
      expect(harness.database.prepare('SELECT status FROM task_report WHERE report_id = ?').get(seeded.reportId)).toEqual({ status: 'LOCKED' })
    } finally {
      harness.close()
    }
  })

  it('leaves report and closure projections untouched when APPLY fails before the transaction', async () => {
    const harness = await createReportBatchHarness({
      faultInjector: createEventBatchFaultInjectorForTests({ failAt: 'BEFORE_APPLY' })
    })
    try {
      const teacherId = seedCaller(harness.database, 'TEACHER')
      const studentId = seedStudent(harness.database)
      const resultIds = seedBaseResultSet(harness.database, teacherId, studentId)
      const baselineEvents = count(harness.database, 'domain_event_projection')
      await expect(confirmClosure({ harness, slot: 40, teacherId, studentId, resultIds })).rejects.toThrow(/BEFORE_APPLY/)

      expect(count(harness.database, 'task_closure')).toBe(0)
      expect(count(harness.database, 'task_report')).toBe(0)
      expect(count(harness.database, 'domain_event_projection')).toBe(baselineEvents)
      expect(loadVerifiedProjectionSources(harness.capability)).toHaveLength(1)
    } finally {
      harness.close()
    }
  })

  it('rereads each closure snapshot after an earlier accepted command changes the head', async () => {
    const harness = await createReportBatchHarness()
    try {
      const teacherId = seedCaller(harness.database, 'TEACHER')
      const studentId = seedStudent(harness.database)
      const firstResultIds = seedBaseResultSet(harness.database, teacherId, studentId)
      const secondResultIds = seedBaseResultSet(harness.database, teacherId, studentId, 1)
      const first = acceptReportCommand({
        harness,
        slot: 50,
        commandType: 'reports:confirmTaskClosure',
        actorId: teacherId,
        target: {
          aggregate_type: 'TASK_CLOSURE',
          student_id: studentId,
          job_code: REPORT_TEST_JOB,
          task_code: REPORT_TEST_TASK,
          source_result_ids: firstResultIds
        }
      })
      const second = acceptReportCommand({
        harness,
        slot: 51,
        commandType: 'reports:confirmTaskClosure',
        actorId: teacherId,
        target: {
          aggregate_type: 'TASK_CLOSURE',
          student_id: studentId,
          job_code: REPORT_TEST_JOB,
          task_code: REPORT_TEST_TASK,
          source_result_ids: secondResultIds
        }
      })

      await harness.coordinator.execute({
        envelope: first.envelope,
        readSnapshot: () => loadTaskClosurePlannerSnapshot(harness.database, first.envelope, {
          timestamp: TIME,
          appVersion: REPORT_TEST_APP_VERSION
        }),
        planner: new TaskClosurePlanner()
      })
      let observedActiveClosures = -1
      await harness.coordinator.execute({
        envelope: second.envelope,
        readSnapshot: () => {
          observedActiveClosures = count(harness.database, 'task_closure')
          return loadTaskClosurePlannerSnapshot(harness.database, second.envelope, {
            timestamp: TIME,
            appVersion: REPORT_TEST_APP_VERSION
          })
        },
        planner: new TaskClosurePlanner()
      })

      expect(observedActiveClosures).toBe(1)
      expect(harness.database.prepare(
        `SELECT status, is_cycle_head FROM task_closure
          WHERE student_id = ? ORDER BY cycle_no`
      ).all(studentId)).toEqual([
        { status: 'SUPERSEDED', is_cycle_head: 0 },
        { status: 'CONFIRMED', is_cycle_head: 1 }
      ])
      expect(count(harness.database, 'applied_event_batch')).toBe(2)
    } finally {
      harness.close()
    }
  })
})
