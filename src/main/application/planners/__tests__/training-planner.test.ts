import { describe, expect, it } from 'vitest'
import { buildCommandEnvelopeV2 } from '../../command/command-envelope'
import { createPlannerReadSnapshot } from '../../../domain/event-batch/command-plan'
import {
  TRAINING_PLAN_VERSIONS,
  TRAINING_RESULT_RECIPE_VERSIONS,
  TRAINING_SNAPSHOT_VERSION,
  TrainingPlanner
} from '../training-planner'

const TIME = '2026-07-29T10:00:00.000Z'

function envelope(commandType: string) {
  return buildCommandEnvelopeV2({
    commandId: '71000000-0000-4000-8000-000000000001', commandType, source: 'INTERNAL',
    actor: { kind: 'USER', userId: 'student-1', role: 'STUDENT', authSessionId: 'auth-1' },
    target: {}, payload: {}, requestHash: 'a'.repeat(64), createdAt: TIME,
    clientInstanceId: '73000000-0000-4000-8000-000000000001', idempotencyKey: '74000000-0000-4000-8000-000000000001',
    eventBatchId: '72000000-0000-4000-8000-000000000001', actorId: 'student-1', deviceId: 'device-1', authSessionId: 'auth-1', leaseOwner: 'worker', leaseGeneration: 1
  })
}

describe('M5B-8 training planner', () => {
  it('freezes a create-session event with four deterministic step IDs', () => {
    const command = envelope('training:createSession')
    const plan = new TrainingPlanner().plan({
      envelope: command,
      snapshot: createPlannerReadSnapshot({
        schema_version: TRAINING_SNAPSHOT_VERSION, kind: 'CREATE', timestamp: TIME, app_version: 'test', actor_role: 'TEACHER',
        student_id: 'student-1', job_code: 'SUPERMARKET_SHELVER', task_code: 'SHELVE_TASK',
        strategy_id: 'strategy_training_shelver_v1', strategy_version: 1, module_type: 'FINE_MOTOR'
      })
    })
    expect(plan).toMatchObject({
      planVersion: TRAINING_PLAN_VERSIONS['training:createSession'],
      resultRecipeVersion: TRAINING_RESULT_RECIPE_VERSIONS['training:createSession'],
      events: [{ eventType: 'TRAINING_STARTED', eventSequence: 1 }]
    })
    const payload = plan.events[0].payload as unknown as {
      step_records: Array<{ step_record_id: string; step_order: number }>
    }
    expect(payload.step_records.map((step) => step.step_order)).toEqual([1, 2, 3, 4])
    expect(new Set(payload.step_records.map((step) => step.step_record_id)).size).toBe(4)
  })

  it('keeps a terminal step completion in one ordered root plan', () => {
    const command = envelope('training:completeStep')
    const plan = new TrainingPlanner().plan({
      envelope: command,
      snapshot: createPlannerReadSnapshot({
        schema_version: TRAINING_SNAPSHOT_VERSION, kind: 'STEP', timestamp: TIME, app_version: 'test', actor_role: 'STUDENT',
        session: {
          training_session_id: 'training-1', student_id: 'student-1', job_code: 'SUPERMARKET_SHELVER', task_code: 'SHELVE_TASK',
          strategy_id: 'strategy_training_shelver_v1', strategy_version: 1, module_type: 'FINE_MOTOR',
          status_before: 'ACTIVE', status_after: 'ACTIVE', total_steps: 4, completed_steps: 4,
          completion_rate: 100, next_event_sequence: 8
        },
        step: {
          step_record_id: 'step-4', step_type: 'DO', step_order: 4, status_before: 'IN_PROGRESS', status_after: 'COMPLETED',
          attempt_count_before: 1, attempt_count_after: 1, session_completed: true, skipped_steps: 0, failed_steps: 0,
          result_id: 'result-1', level_result: 'LEVEL_COMPETENT'
        }
      })
    })
    expect(plan.events.map((event) => [event.eventType, event.eventSequence])).toEqual([
      ['TRAINING_STEP_COMPLETED', 8], ['TRAINING_COMPLETED', 9]
    ])
    expect(plan.events[1].payload.batch_context).toMatchObject({ root_command_id: command.commandId, child_ordinal: 1 })
  })

  it('uses deterministic zero-event public results for rejected snapshots', () => {
    const plan = new TrainingPlanner().plan({
      envelope: envelope('training:retryStep'),
      snapshot: createPlannerReadSnapshot({
        schema_version: TRAINING_SNAPSHOT_VERSION, kind: 'NO_OP', timestamp: TIME,
        no_op_result: { success: false, errorCode: 'STEP_INVALID_TRANSITION' }
      })
    })
    expect(plan).toMatchObject({ events: [], noOpResult: { success: false, errorCode: 'STEP_INVALID_TRANSITION' } })
  })
})
