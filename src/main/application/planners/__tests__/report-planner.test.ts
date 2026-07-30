import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createPlannerReadSnapshot } from '../../../domain/event-batch/command-plan'
import type { CanonicalJsonValue } from '../../../domain/event-batch/canonical-json'
import { REPORT_TEST_APP_VERSION } from './report-test-support'
import {
  REPORT_GENERATION_SNAPSHOT_VERSION,
  planReportGenerationFragment,
  type ReportGenerationSnapshotV1
} from '../report-plan-fragment'
import {
  REPORT_LIFECYCLE_SNAPSHOT_VERSION,
  REPORT_PLAN_VERSIONS,
  REPORT_RESULT_RECIPE_VERSIONS,
  ReportPlanner
} from '../report-planner'
import {
  TASK_CLOSURE_PLAN_VERSIONS,
  TASK_CLOSURE_RESULT_RECIPE_VERSIONS,
  TASK_CLOSURE_SNAPSHOT_VERSION,
  TaskClosurePlanner
} from '../task-closure-planner'
import { buildCommandEnvelopeV2 } from '../../command/command-envelope'

const TIME = '2026-07-29T10:00:00.000Z'
const TEACHER = 'teacher-1'
const GOLDEN = JSON.parse(readFileSync(
  resolve(process.cwd(), 'scripts/fixtures/m5b-report-plans-v1.json'),
  'utf8'
)) as {
  schema_version: string
  commands: Array<Record<string, unknown>>
  required_batch_context_keys: string[]
}

function envelope(commandType: string, commandId: string, target: Record<string, unknown>) {
  return buildCommandEnvelopeV2({
    commandId,
    commandType,
    source: 'INTERNAL',
    actor: { kind: 'USER', userId: TEACHER, role: 'TEACHER', authSessionId: 'report-auth-teacher-1' },
    target,
    payload: {},
    requestHash: 'a'.repeat(64),
    createdAt: TIME,
    clientInstanceId: '63000000-0000-4000-8000-000000000001',
    idempotencyKey: '64000000-0000-4000-8000-000000000001',
    eventBatchId: '62000000-0000-4000-8000-000000000001',
    actorId: TEACHER,
    deviceId: 'device-1',
    authSessionId: 'report-auth-teacher-1',
    leaseOwner: 'report-worker',
    leaseGeneration: 1
  })
}

function generationSnapshot(): ReportGenerationSnapshotV1 {
  return {
    schema_version: REPORT_GENERATION_SNAPSHOT_VERSION,
    timestamp: TIME,
    app_version: REPORT_TEST_APP_VERSION,
    correlation_id: 'correlation-1',
    actor_role: 'TEACHER',
    existing_report_id: null,
    report_facts: {
      student_id: 'student-1',
      job_code: 'SUPERMARKET_SHELVER',
      task_code: 'SHELVE_TASK',
      report_type: 'BASE_ABILITY_TASK_REPORT',
      report_scope: 'BASE_ABILITY',
      source_aggregate_type: 'TASK_CLOSURE',
      source_aggregate_id: 'closure-1',
      result_ids: ['result-ability', 'result-training', 'result-operation'],
      incident_ids: [],
      report_title: 'Task report',
      report_content: { schema_version: 'report-content-v1' },
      generated_at: TIME,
      report_revision: 1,
      report_schema_version: 'report-content-v1',
      report_builder_version: 'report-builder-v1',
      lineage_key: 'lineage-1',
      source_set_hash: 'b'.repeat(64),
      content_hash: 'c'.repeat(64),
      generation_key: 'd'.repeat(64),
      generation_reason: 'NORMAL',
      task_closure_id: 'closure-1',
      repair_of_report_id: null,
      superseded_report_ids: []
    }
  }
}

describe('M5B report and closure planners', () => {
  it('matches the frozen five-command plan and result recipe manifest', () => {
    const observed = [
      ['reports:confirmTaskClosure', TASK_CLOSURE_PLAN_VERSIONS['reports:confirmTaskClosure'], TASK_CLOSURE_RESULT_RECIPE_VERSIONS['reports:confirmTaskClosure'], 'TASK_CLOSURE_CONFIRMED', ['success', 'taskClosure']],
      ['reports:replaceTaskClosure', TASK_CLOSURE_PLAN_VERSIONS['reports:replaceTaskClosure'], TASK_CLOSURE_RESULT_RECIPE_VERSIONS['reports:replaceTaskClosure'], 'TASK_CLOSURE_REPLACED', ['success', 'taskClosure']],
      ['reports:generate', REPORT_PLAN_VERSIONS['reports:generate'], REPORT_RESULT_RECIPE_VERSIONS['reports:generate'], 'REPORT_GENERATED', ['generated', 'reportId', 'success']],
      ['reports:confirmPlacementReview', REPORT_PLAN_VERSIONS['reports:confirmPlacementReview'], REPORT_RESULT_RECIPE_VERSIONS['reports:confirmPlacementReview'], 'PLACEMENT_REVIEW_CONFIRMED', ['reportId', 'status', 'success']],
      ['reports:lock', REPORT_PLAN_VERSIONS['reports:lock'], REPORT_RESULT_RECIPE_VERSIONS['reports:lock'], 'REPORT_LOCKED', ['reportId', 'status', 'success']]
    ].map(([command_type, plan_version, result_recipe_version, event_type, result_keys]) => ({
      command_type,
      plan_version,
      result_recipe_version,
      event_type,
      event_count: 1,
      no_op_event_count: 0,
      result_keys
    }))
    expect(GOLDEN.schema_version).toBe('m5b-report-plans-v1')
    expect(observed).toEqual(GOLDEN.commands)
  })

  it('freezes a complete generated-report payload and result recipe before APPLY', () => {
    const command = envelope('reports:generate', '61000000-0000-4000-8000-000000000001', {
      aggregate_type: 'TASK_REPORT',
      report_scope: 'BASE_ABILITY',
      source_id: 'closure-1',
      student_id: 'student-1',
      job_code: 'SUPERMARKET_SHELVER',
      task_code: 'SHELVE_TASK'
    })
    const plan = new ReportPlanner().plan({
      envelope: command,
      snapshot: createPlannerReadSnapshot(generationSnapshot())
    })

    expect(plan).toMatchObject({
      commandType: 'reports:generate',
      planVersion: REPORT_PLAN_VERSIONS['reports:generate'],
      resultRecipeVersion: REPORT_RESULT_RECIPE_VERSIONS['reports:generate'],
      noOpResult: null
    })
    expect(plan.events).toHaveLength(1)
    expect(plan.events[0]).toMatchObject({
      aggregateType: 'TASK_REPORT',
      eventType: 'REPORT_GENERATED',
      eventSequence: 1,
      timestamp: TIME,
      payload: {
        event_payload_version: 2,
        batch_context: {
          root_command_type: 'reports:generate',
          root_command_id: command.commandId,
          child_ordinal: 0,
          plan_version: REPORT_PLAN_VERSIONS['reports:generate'],
          result_recipe_version: REPORT_RESULT_RECIPE_VERSIONS['reports:generate']
        },
        source_set_hash: 'b'.repeat(64),
        content_hash: 'c'.repeat(64),
        report_builder_version: 'report-builder-v1'
      }
    })
    expect(Object.keys(plan.events[0].payload.batch_context as Record<string, unknown>).sort())
      .toEqual([...GOLDEN.required_batch_context_keys].sort())
  })

  it('keeps an existing generation as a zero-event no-op with no batch recipe ambiguity', () => {
    const command = envelope('reports:generate', '61000000-0000-4000-8000-000000000002', {
      aggregate_type: 'TASK_REPORT',
      report_scope: 'BASE_ABILITY',
      source_id: 'closure-1',
      student_id: 'student-1',
      job_code: 'SUPERMARKET_SHELVER',
      task_code: 'SHELVE_TASK'
    })
    const snapshot = { ...generationSnapshot(), existing_report_id: 'report-existing' }
    const plan = new ReportPlanner().plan({ envelope: command, snapshot: createPlannerReadSnapshot(snapshot) })

    expect(plan.events).toEqual([])
    expect(plan.noOpResult).toEqual({ success: true, reportId: 'report-existing', generated: false })
    expect(plan.resultRecipeVersion).toBe(REPORT_RESULT_RECIPE_VERSIONS['reports:generate'])
  })

  it('plans both lifecycle command payloads from their prepared snapshots', () => {
    const cases = [
      {
        commandType: 'reports:confirmPlacementReview',
        eventType: 'PLACEMENT_REVIEW_CONFIRMED',
        snapshot: {
          schema_version: REPORT_LIFECYCLE_SNAPSHOT_VERSION,
          kind: 'PLACEMENT_REVIEW',
          timestamp: TIME,
          app_version: REPORT_TEST_APP_VERSION,
          correlation_id: 'correlation-2',
          actor_role: 'TEACHER',
          report_id: 'report-1',
          event_sequence: 3,
          no_op_result: null,
          event_facts: { reviewed_at: TIME, placement_advice_hash: 'e'.repeat(64), result_status: 'GENERATED' }
        }
      },
      {
        commandType: 'reports:lock',
        eventType: 'REPORT_LOCKED',
        snapshot: {
          schema_version: REPORT_LIFECYCLE_SNAPSHOT_VERSION,
          kind: 'LOCK',
          timestamp: TIME,
          app_version: REPORT_TEST_APP_VERSION,
          correlation_id: 'correlation-3',
          actor_role: 'TEACHER',
          report_id: 'report-1',
          event_sequence: 4,
          no_op_result: null,
          event_facts: {
            locked_at: TIME,
            lock_reason: null,
            content_hash: 'f'.repeat(64),
            status_before: 'GENERATED',
            status_after: 'LOCKED'
          }
        }
      }
    ] as const
    for (const [index, item] of cases.entries()) {
      const command = envelope(item.commandType, `61000000-0000-4000-8000-00000000000${index + 3}`, {
        aggregate_type: 'TASK_REPORT', report_id: 'report-1', student_id: 'student-1'
      })
      const plan = new ReportPlanner().plan({
        envelope: command,
        snapshot: createPlannerReadSnapshot(item.snapshot as unknown as CanonicalJsonValue)
      })
      expect(plan).toMatchObject({
        commandType: item.commandType,
        planVersion: REPORT_PLAN_VERSIONS[item.commandType],
        resultRecipeVersion: REPORT_RESULT_RECIPE_VERSIONS[item.commandType],
        noOpResult: null
      })
      expect(plan.events).toHaveLength(1)
      expect(plan.events[0]).toMatchObject({ eventType: item.eventType, aggregateId: 'report-1', eventSequence: item.snapshot.event_sequence })
    }
  })

  it('plans both closure command payloads with stable root identity and frozen source snapshots', () => {
    const binding = {
      student_id: 'student-1',
      job_code: 'SUPERMARKET_SHELVER',
      task_code: 'SHELVE_TASK',
      source_result_ids: ['result-ability', 'result-training', 'result-operation'],
      task_result_snapshots: [
        { source_aggregate_id: 'assessment-1' },
        { source_aggregate_id: 'training-1' },
        { source_aggregate_id: 'assessment-1' }
      ]
    }
    const cases = [
      {
        commandType: 'reports:confirmTaskClosure',
        eventType: 'TASK_CLOSURE_CONFIRMED',
        eventFacts: {
          cycle_no: 1, closure_revision: 1, status: 'CONFIRMED', is_cycle_head: true,
          superseded_task_closure_ids: [], superseded_report_ids: []
        }
      },
      {
        commandType: 'reports:replaceTaskClosure',
        eventType: 'TASK_CLOSURE_REPLACED',
        eventFacts: {
          old_task_closure_id: 'closure-old', cycle_no: 1, closure_revision: 2, status: 'CONFIRMED',
          is_cycle_head: true, correction_reason: 'corrected result', reused_result_ids: ['result-ability'],
          new_result_ids: ['result-training', 'result-operation'], archived_report_ids: []
        }
      }
    ] as const
    for (const [index, item] of cases.entries()) {
      const command = envelope(item.commandType, `61000000-0000-4000-8000-00000000001${index + 1}`, {
        aggregate_type: 'TASK_CLOSURE', student_id: 'student-1', job_code: 'SUPERMARKET_SHELVER',
        task_code: 'SHELVE_TASK', source_result_ids: binding.source_result_ids,
        ...(item.commandType === 'reports:replaceTaskClosure' ? { task_closure_id: 'closure-old' } : {})
      })
      const snapshot = {
        schema_version: TASK_CLOSURE_SNAPSHOT_VERSION,
        kind: item.commandType === 'reports:confirmTaskClosure' ? 'CONFIRM' : 'REPLACE',
        timestamp: TIME,
        app_version: REPORT_TEST_APP_VERSION,
        correlation_id: `correlation-closure-${index}`,
        actor_role: 'TEACHER',
        binding,
        no_op_result: null,
        event_facts: item.eventFacts
      }
      const plan = new TaskClosurePlanner().plan({
        envelope: command,
        snapshot: createPlannerReadSnapshot(snapshot as unknown as CanonicalJsonValue)
      })
      expect(plan).toMatchObject({
        commandType: item.commandType,
        planVersion: TASK_CLOSURE_PLAN_VERSIONS[item.commandType],
        resultRecipeVersion: TASK_CLOSURE_RESULT_RECIPE_VERSIONS[item.commandType],
        noOpResult: null
      })
      expect(plan.events).toHaveLength(1)
      expect(plan.events[0]).toMatchObject({
        eventType: item.eventType,
        eventSequence: 1,
        payload: {
          batch_context: { root_command_type: item.commandType, root_command_id: command.commandId, child_ordinal: 0 },
          source_result_ids: binding.source_result_ids,
          task_result_snapshots: binding.task_result_snapshots
        }
      })
    }
  })

  it('makes a child report fragment independent of claim, batch, or coordinator ownership', () => {
    const command = envelope('assessment:submitOperationScores', '61000000-0000-4000-8000-000000000021', {})
    const fragment = planReportGenerationFragment(generationSnapshot(), {
      envelope: command,
      planVersion: 'm5b.assessment.operation.plan.v1',
      resultRecipeVersion: 'm5b.assessment.operation.result.v1',
      childOrdinal: 2
    })

    expect(fragment.events).toHaveLength(1)
    expect(fragment.events[0].payload).toMatchObject({
      batch_context: {
        root_command_type: 'assessment:submitOperationScores',
        root_command_id: command.commandId,
        child_ordinal: 2
      }
    })
    expect(fragment.reportResult).toEqual({ success: true, reportId: fragment.events[0].aggregateId, generated: true })
  })
})
