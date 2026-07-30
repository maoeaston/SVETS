import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { v4 as uuidv4 } from 'uuid'

const electronState = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, rawInput?: unknown) => Promise<unknown>>()
}))
const eventState = vi.hoisted(() => ({
  db: null as unknown as import('../../../db/interface').DBAdapter,
  calls: [] as Array<{
    aggregateId: string
    eventType: string
    correlationId?: string
  }>,
  failAfterProjectionFor: null as string | null
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle(channel: string, handler: (event: unknown, rawInput?: unknown) => Promise<unknown>) {
      if (electronState.handlers.has(channel)) throw new Error(`duplicate IPC handler: ${channel}`)
      electronState.handlers.set(channel, handler)
    },
    removeHandler(channel: string) {
      electronState.handlers.delete(channel)
    }
  },
  dialog: {
    showSaveDialog: vi.fn(),
    showErrorBox: vi.fn()
  }
}))

vi.mock('../../../domain/event-writer', () => ({
  writeEvent: vi.fn(
    (params: import('../../../domain/event-writer').WriteEventParams): import('@shared/types/event-payloads').ActionLogEntry => {
      const db = eventState.db
      if (!db) throw new Error('training bus event DB is not initialized')
      const eventId = uuidv4()
      const sequence = ((db.prepare(
        `SELECT MAX(event_sequence) AS max_sequence
           FROM domain_event_projection
          WHERE aggregate_type = ? AND aggregate_id = ?`
      ).get(params.aggregateType, params.aggregateId) as { max_sequence: number | null }).max_sequence ?? 0) + 1
      const entry: import('@shared/types/event-payloads').ActionLogEntry = {
        event_id: eventId,
        aggregate_type: params.aggregateType,
        aggregate_id: params.aggregateId,
        event_type: params.eventType,
        event_sequence: sequence,
        payload: params.payload,
        checksum: `test-checksum-${eventId}`,
        schema_version: params.schemaVersion ?? 1,
        created_at: new Date().toISOString(),
        actor_id: params.actorId,
        actor_role: params.actorRole,
        app_version: 'test',
        ...(params.correlationId ? { correlation_id: params.correlationId } : {})
      }
      eventState.calls.push({
        aggregateId: params.aggregateId,
        eventType: params.eventType,
        correlationId: params.correlationId
      })
      db.prepare(
        `INSERT INTO domain_event_projection
           (event_id, aggregate_type, aggregate_id, event_type, event_sequence,
            payload_json, checksum, source_log_path, schema_version, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        entry.event_id,
        entry.aggregate_type,
        entry.aggregate_id,
        entry.event_type,
        entry.event_sequence,
        JSON.stringify(entry.payload),
        entry.checksum,
        'training-command-bus.test.jsonl',
        entry.schema_version,
        entry.created_at
      )
      if (eventState.failAfterProjectionFor === params.eventType) {
        throw new Error(`injected projection failure after ${params.eventType}`)
      }
      return entry
    }
  )
}))

import type { IpcMainInvokeEvent } from 'electron'
import { writeEvent } from '../../../domain/event-writer'
import type { MemoryAdapter } from '../../../db/memory-adapter'
import {
  createTestDb,
  seedAssessmentSessionFixture,
  seedCaller,
  seedStudent
} from '../../../db/test-helpers'
import type { ReportMutationPort } from '../../../domain/report-command-coordinator'
import {
  createApplicationRuntime,
  type ApplicationRuntime,
  type RuntimeScheduler
} from '../../runtime/application-runtime'
import {
  clearAuthSessionBinding,
  issuePasswordAuthSession,
  replaceSenderAuthSession
} from '../../../utils/auth-session'
import {
  registerCentralIpcHandlers,
  type CentralIpcBoundary
} from '../../../ipc/handler-registry'
import {
  haltTrainingSessionSteps,
  TRAINING_HALT_CHILD_CAPABILITY
} from '../training-service'
import { acceptedTestContext } from './training-test-support'

const TRAINING_MUTATIONS = [
  'training:createSession',
  'training:startStep',
  'training:completeStep',
  'training:skipStep',
  'training:failStep',
  'training:retryStep'
] as const

class InertScheduler implements RuntimeScheduler {
  setInterval(): object {
    return {}
  }

  clearInterval(): void {}
}

function recordingMutationPort(): ReportMutationPort {
  return Object.freeze({
    writeEvent,
    recoverPending() {}
  })
}

const databases: MemoryAdapter[] = []
const runtimes: ApplicationRuntime[] = []
const senderIds = new Set<number>()

async function createRuntime(): Promise<{
  db: MemoryAdapter
  runtime: ApplicationRuntime
  boundary: CentralIpcBoundary
}> {
  const db = await createTestDb()
  databases.push(db)
  eventState.db = db
  const runtime = createApplicationRuntime({
    db,
    dataRoot: `/tmp/svets-m5a6-training-${uuidv4()}`,
    dependencies: {
      prepareDirectory: () => undefined,
      createLegacyMutationPort: recordingMutationPort,
      scheduler: new InertScheduler()
    }
  })
  runtimes.push(runtime)
  const boundary = registerCentralIpcHandlers(runtime)
  runtime.markBoundaryReady()
  return { db, runtime, boundary }
}

function event(senderId: number): IpcMainInvokeEvent {
  senderIds.add(senderId)
  return {
    sender: {
      id: senderId,
      once: vi.fn()
    }
  } as unknown as IpcMainInvokeEvent
}

function bindUser(
  db: MemoryAdapter,
  runtime: ApplicationRuntime,
  senderId: number,
  userId: string,
  role: 'STUDENT' | 'TEACHER'
): void {
  const issued = issuePasswordAuthSession(db, { userId, role, displayName: role })
  replaceSenderAuthSession(db, senderId, issued.rawToken, runtime.bindingOwnerId)
  senderIds.add(senderId)
}

function requireHandler(channel: string) {
  const handler = electronState.handlers.get(channel)
  if (!handler) throw new Error(`missing test IPC handler: ${channel}`)
  return handler
}

async function createTraining(
  senderId: number,
  teacherId: string,
  studentId: string,
  taskCode = 'SHELVE_TASK'
): Promise<string> {
  const result = await requireHandler('training:createSession')(event(senderId), {
    callerUserId: teacherId,
    callerRole: 'TEACHER',
    studentId,
    strategyId: 'strategy_training_shelver_v1',
    strategyVersion: 1,
    moduleType: 'FINE_MOTOR',
    taskCode
  }) as { success: boolean; trainingSessionId?: string }
  if (!result.success || !result.trainingSessionId) {
    throw new Error(`training create failed: ${JSON.stringify(result)}`)
  }
  return result.trainingSessionId
}

function stepId(db: MemoryAdapter, trainingSessionId: string, order: number): string {
  return (db.prepare(
    `SELECT training_step_record_id
       FROM training_step_record
      WHERE training_session_id = ? AND step_order = ?`
  ).get(trainingSessionId, order) as { training_step_record_id: string }).training_step_record_id
}

beforeEach(() => {
  electronState.handlers.clear()
  eventState.calls = []
  eventState.failAfterProjectionFor = null
})

afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.dispose()
  for (const senderId of senderIds) clearAuthSessionBinding(senderId)
  senderIds.clear()
  for (const db of databases.splice(0)) db.close()
  electronState.handlers.clear()
  eventState.calls = []
  eventState.failAfterProjectionFor = null
})

describe('M5A-6 training commands through CommandBus', () => {
  it('registers six mutations and three reads with application ownership metadata', async () => {
    const { boundary } = await createRuntime()
    const definitions = TRAINING_MUTATIONS.map((channel) => boundary.registry.requireMutation(channel))
    expect(definitions).toHaveLength(6)
    expect(definitions.every((definition) =>
      definition.metadata.transactionOwner.startsWith('training-service.')
      && definition.metadata.retryPolicy === 'NO_AUTO_RETRY'
      && definition.metadata.concurrencyPolicy.kind === 'FAIL_FAST_ACTIVE_KEY'
      && definition.metadata.sideEffects.includes('LEGACY_EVENT_PORT_WRITE')
      && !definition.metadata.sideEffects.includes('LEGACY_HANDLER_MUTATION')
      && definition.metadata.testReferences.includes(
        'src/main/application/services/__tests__/training-command-bus.test.ts'
      )
    )).toBe(true)
    for (const channel of ['training:getSession', 'training:listMySessions', 'training:listSessions']) {
      expect(boundary.registry.get(channel)?.metadata).toMatchObject({
        mode: 'READ',
        sideEffects: [],
        transactionOwner: 'NONE_READ_ONLY'
      })
    }
  })

  it('runs all six mutations, keeps reads write-free and shares correlation across finalization', async () => {
    const { db, runtime } = await createRuntime()
    const teacherId = seedCaller(db, 'TEACHER')
    const studentId = seedStudent(db)
    const teacherSender = 6301
    const studentSender = 6302
    bindUser(db, runtime, teacherSender, teacherId, 'TEACHER')
    bindUser(db, runtime, studentSender, studentId, 'STUDENT')
    const trainingSessionId = await createTraining(teacherSender, teacherId, studentId)

    const invokeStep = (channel: string, order: number) => requireHandler(channel)(event(studentSender), {
      callerUserId: studentId,
      callerRole: 'STUDENT',
      trainingSessionId,
      stepRecordId: stepId(db, trainingSessionId, order)
    })
    expect(await invokeStep('training:startStep', 1)).toMatchObject({ success: true, newStatus: 'IN_PROGRESS' })
    expect(await invokeStep('training:completeStep', 1)).toMatchObject({ success: true, newStatus: 'COMPLETED' })
    expect(await invokeStep('training:skipStep', 2)).toMatchObject({ success: true, newStatus: 'SKIPPED' })
    expect(await invokeStep('training:startStep', 3)).toMatchObject({ success: true, newStatus: 'IN_PROGRESS' })
    expect(await invokeStep('training:failStep', 3)).toMatchObject({ success: true, newStatus: 'FAILED' })
    expect(await invokeStep('training:retryStep', 3)).toMatchObject({ success: true, newStatus: 'IN_PROGRESS' })
    expect(await invokeStep('training:skipStep', 3)).toMatchObject({ success: true, newStatus: 'SKIPPED' })
    expect(eventState.calls.every((call) => typeof call.correlationId === 'string' && call.correlationId.length > 0))
      .toBe(true)

    eventState.calls = []
    expect(await invokeStep('training:skipStep', 4)).toMatchObject({
      success: true,
      newStatus: 'SKIPPED',
      sessionCompleted: true
    })
    expect(eventState.calls.map((call) => call.eventType)).toEqual([
      'TRAINING_STEP_SKIPPED',
      'TRAINING_COMPLETED'
    ])
    expect(new Set(eventState.calls.map((call) => call.correlationId)).size).toBe(1)
    expect((db.prepare('SELECT status FROM training_session WHERE training_session_id = ?')
      .get(trainingSessionId) as { status: string }).status).toBe('COMPLETED')

    eventState.calls = []
    expect(await requireHandler('training:listSessions')(event(teacherSender), {
      callerUserId: teacherId,
      callerRole: 'TEACHER'
    })).toMatchObject({ success: true, total: 1 })
    expect(await requireHandler('training:listMySessions')(event(studentSender), {
      callerUserId: studentId,
      callerRole: 'STUDENT'
    })).toMatchObject({ success: true, total: 1 })
    expect(await requireHandler('training:getSession')(event(studentSender), {
      callerUserId: studentId,
      callerRole: 'STUDENT',
      trainingSessionId
    })).toMatchObject({ success: true, session: { trainingSessionId } })
    expect(eventState.calls).toEqual([])
  })

  it('rolls back SQLite projection when the injected event port fails after its insert', async () => {
    const { db, runtime } = await createRuntime()
    const teacherId = seedCaller(db, 'TEACHER')
    const studentId = seedStudent(db)
    const senderId = 6303
    bindUser(db, runtime, senderId, teacherId, 'TEACHER')
    eventState.failAfterProjectionFor = 'TRAINING_STARTED'
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(await requireHandler('training:createSession')(event(senderId), {
      callerUserId: teacherId,
      callerRole: 'TEACHER',
      studentId,
      strategyId: 'strategy_training_shelver_v1',
      strategyVersion: 1,
      moduleType: 'FINE_MOTOR',
      taskCode: 'ROLLBACK_TASK'
    })).toEqual({ success: false, errorCode: 'TRAINING_SYSTEM_ERROR' })
    expect((db.prepare("SELECT COUNT(*) AS count FROM domain_event_projection WHERE event_type = 'TRAINING_STARTED'")
      .get() as { count: number }).count).toBe(0)
    expect((db.prepare("SELECT COUNT(*) AS count FROM training_session WHERE task_code = 'ROLLBACK_TASK'")
      .get() as { count: number }).count).toBe(0)
    expect(eventState.calls).toHaveLength(1)
    expect(eventState.calls[0].correlationId).toMatch(/^[0-9a-f-]{36}$/)
    expect(consoleError).toHaveBeenCalledOnce()
    consoleError.mockRestore()
  })

  it('runs training halt only from the accepted redline parent and preserves the M4 key', async () => {
    const { db, runtime, boundary } = await createRuntime()
    const teacherId = seedCaller(db, 'TEACHER')
    const studentId = seedStudent(db)
    const teacherSender = 6304
    const studentSender = 6305
    bindUser(db, runtime, teacherSender, teacherId, 'TEACHER')
    bindUser(db, runtime, studentSender, studentId, 'STUDENT')
    const trainingSessionId = await createTraining(teacherSender, teacherId, studentId)
    const firstStepId = stepId(db, trainingSessionId, 1)
    expect(await requireHandler('training:startStep')(event(studentSender), {
      callerUserId: studentId,
      callerRole: 'STUDENT',
      trainingSessionId,
      stepRecordId: firstStepId
    })).toMatchObject({ success: true })

    const assessmentSessionId = seedAssessmentSessionFixture(db, {
      studentId,
      strategyId: 'strategy_baseline_shelver_v1',
      strategyType: 'BASELINE_ASSESSMENT',
      jobCode: 'SUPERMARKET_SHELVER',
      taskCode: 'SHELVE_TASK',
      status: 'ACTIVE',
      createdBy: teacherId
    })
    expect(await requireHandler('assessment:triggerRedline')(event(teacherSender), {
      callerUserId: teacherId,
      callerRole: 'TEACHER',
      sessionId: assessmentSessionId,
      reasonCode: 'BLADE_TOWARD_SELF',
      contextPhase: 'ONLINE_ASSESSMENT'
    })).toMatchObject({ success: true, sessionId: assessmentSessionId })
    expect((db.prepare('SELECT status FROM training_session WHERE training_session_id = ?')
      .get(trainingSessionId) as { status: string }).status).toBe('REDLINE_HALTED')
    expect((db.prepare('SELECT status FROM training_step_record WHERE training_step_record_id = ?')
      .get(firstStepId) as { status: string }).status).toBe('FAILED')
    expect(boundary.registry.requireMutation('assessment:triggerRedline').metadata.sideEffects)
      .toContain('TRAINING_HALT_ACCEPTED_CHILD')
    expect(TRAINING_HALT_CHILD_CAPABILITY).toMatchObject({
      owner: 'training-service.haltTrainingSessionSteps',
      phase: 'RUNTIME_ACCEPTED_CHILD',
      correlationPolicy: 'INHERIT_PARENT',
      targetFields: ['student_id', 'job_code', 'task_code']
    })

    expect(() => haltTrainingSessionSteps(db, acceptedTestContext({
      commandType: 'training:startStep',
      target: {
        aggregate_type: 'TRAINING_SESSION',
        student_id: studentId,
        job_code: 'SUPERMARKET_SHELVER',
        task_code: 'SHELVE_TASK'
      }
    }))).toThrow('accepted assessment:triggerRedline parent')
  })
})
