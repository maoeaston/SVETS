import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import type { MemoryAdapter } from '../../../db/memory-adapter'
import {
  createTestDb,
  seedAssessmentSessionFixture,
  seedCaller,
  seedStudent
} from '../../../db/test-helpers'
import {
  clearAuthSessionBinding,
  hasAuthSessionBinding,
  issuePasswordAuthSession,
  replaceSenderAuthSession
} from '../../../utils/auth-session'
import { CommandBus } from '../command-bus'
import {
  M5A_MUTATION_CHANNELS,
  createM5AMutationDefinitions
} from '../m5a-command-definitions'
import { CommandRegistry } from '../command-registry'

interface HandlerCall {
  channel: string
  params: Record<string, unknown>
}

let db: MemoryAdapter
const senderIds = new Set<number>()

function fakeEvent(senderId: number): IpcMainInvokeEvent {
  senderIds.add(senderId)
  return { sender: { id: senderId, once: vi.fn() } } as unknown as IpcMainInvokeEvent
}

function bindUser(
  senderId: number,
  role: 'STUDENT' | 'TEACHER' | 'ADMIN',
  userId?: string
): string {
  const resolvedUserId = userId ?? (role === 'STUDENT' ? seedStudent(db) : seedCaller(db, role))
  const issued = issuePasswordAuthSession(db, { userId: resolvedUserId, role, displayName: role })
  replaceSenderAuthSession(db, senderId, issued.rawToken)
  senderIds.add(senderId)
  return resolvedUserId
}

function snapshotState(): string {
  return JSON.stringify({
    auth: db.prepare(
      `SELECT auth_session_id, user_id, status, last_activity_at, updated_at
         FROM auth_session ORDER BY auth_session_id`
    ).all(),
    errors: db.prepare(
      'SELECT error_event_id, error_code, recovery_status FROM error_event_log ORDER BY error_event_id'
    ).all(),
    students: db.prepare(
      'SELECT student_id, student_name, status, updated_at FROM student_profile ORDER BY student_id'
    ).all(),
    trainingSessions: db.prepare(
      'SELECT training_session_id, student_id, status, updated_at FROM training_session ORDER BY training_session_id'
    ).all(),
    businessSessions: db.prepare(
      'SELECT business_session_id, student_id, job_code, task_code, updated_at FROM business_session ORDER BY business_session_id'
    ).all(),
    trainingSteps: db.prepare(
      'SELECT training_step_record_id, training_session_id, status, updated_at FROM training_step_record ORDER BY training_step_record_id'
    ).all(),
    projections: db.prepare(
      'SELECT event_id, aggregate_id, event_type FROM domain_event_projection ORDER BY event_id'
    ).all()
  })
}

function createHarness(options: {
  ready?: boolean
  handler?: (channel: string, params: Record<string, unknown>) => unknown | Promise<unknown>
} = {}) {
  let ready = options.ready ?? true
  const events = new Map<string, IpcMainInvokeEvent>()
  const calls: HandlerCall[] = []
  const definitions = createM5AMutationDefinitions({
    db,
    eventForTransport(transportId) {
      const event = events.get(transportId)
      if (!event) throw new Error('missing transport event')
      return event
    },
    handlerForChannel(channel) {
      return (_event, params) => {
        const normalized = params as Record<string, unknown>
        calls.push({ channel, params: normalized })
        return options.handler?.(channel, normalized) ?? { success: true }
      }
    }
  })
  const registry = new CommandRegistry()
  for (const definition of definitions) registry.registerMutation(definition)
  registry.seal(M5A_MUTATION_CHANNELS)
  const bus = new CommandBus({ registry, readinessGate: () => ready })
  bus.open()
  return {
    bus,
    calls,
    setReady(value: boolean) {
      ready = value
    },
    setEvent(transportId: string, event: IpcMainInvokeEvent) {
      events.set(transportId, event)
    }
  }
}

beforeEach(async () => {
  db = await createTestDb()
})

afterEach(() => {
  for (const senderId of senderIds) clearAuthSessionBinding(senderId)
  senderIds.clear()
  db.close()
})

describe('M5A IPC preflight has zero side effects', () => {
  it('rejects not-ready, invalid actor, caller mismatch and missing target without state drift', async () => {
    const senderId = 5101
    const event = fakeEvent(senderId)
    const harness = createHarness({ ready: false })
    harness.setEvent('transport', event)
    const baseRequest = {
      commandType: 'student:update',
      rawInput: {
        callerUserId: 'candidate',
        callerRole: 'ADMIN',
        studentId: 'missing-student',
        patch: { studentName: 'unchanged' }
      },
      transport: { source: 'IPC' as const, transportId: 'transport' }
    }

    const beforeNotReady = snapshotState()
    const notReady = await harness.bus.dispatch(baseRequest)
    expect(notReady).toMatchObject({ status: 'REJECTED', reason: 'BOUNDARY_NOT_READY' })
    expect(snapshotState()).toBe(beforeNotReady)

    harness.setReady(true)
    const beforeActor = snapshotState()
    const invalidActor = await harness.bus.dispatch(baseRequest)
    expect(invalidActor).toMatchObject({ status: 'REJECTED', reason: 'INVALID_ACTOR' })
    expect(snapshotState()).toBe(beforeActor)

    const adminId = bindUser(senderId, 'ADMIN')
    db.prepare(
      "UPDATE auth_session SET last_activity_at = '2000-01-01 00:00:00' WHERE user_id = ?"
    ).run(adminId)
    const stable = snapshotState()
    const mismatch = await harness.bus.dispatch({
      ...baseRequest,
      rawInput: { ...baseRequest.rawInput, callerUserId: 'forged-user' }
    })
    expect(mismatch).toMatchObject({ status: 'REJECTED', reason: 'TARGET_MISMATCH' })
    expect(snapshotState()).toBe(stable)
    expect(hasAuthSessionBinding(senderId)).toBe(true)

    const missing = await harness.bus.dispatch({
      ...baseRequest,
      rawInput: { ...baseRequest.rawInput, callerUserId: adminId }
    })
    expect(missing).toMatchObject({ status: 'REJECTED', reason: 'TARGET_NOT_FOUND' })
    expect(snapshotState()).toBe(stable)
    expect(harness.calls).toHaveLength(0)
    expect(harness.bus.activeKeyGuard.size()).toBe(0)
  })

  it('derives the assessment triple from DB and rejects a forged job hint before acceptance', async () => {
    const senderId = 5102
    const studentId = seedStudent(db)
    const teacherId = seedCaller(db, 'TEACHER')
    const sessionId = seedAssessmentSessionFixture(db, {
      studentId,
      strategyId: 'strategy_baseline_shelver_v1',
      jobCode: 'SUPERMARKET_SHELVER',
      taskCode: 'SHELVE_TASK',
      createdBy: teacherId
    })
    bindUser(senderId, 'STUDENT', studentId)
    db.prepare(
      "UPDATE auth_session SET last_activity_at = '2000-01-01 00:00:00' WHERE user_id = ?"
    ).run(studentId)
    const harness = createHarness()
    harness.setEvent('student-transport', fakeEvent(senderId))
    const before = snapshotState()

    const result = await harness.bus.dispatch({
      commandType: 'assessment:emotionInterrupt',
      rawInput: {
        callerUserId: studentId,
        callerRole: 'STUDENT',
        sessionId,
        jobCode: 'FORGED_JOB'
      },
      transport: { source: 'IPC', transportId: 'student-transport' }
    })

    expect(result).toMatchObject({ status: 'REJECTED', reason: 'TARGET_MISMATCH' })
    expect(snapshotState()).toBe(before)
    expect(harness.calls).toHaveLength(0)
  })

  it('issues heartbeat and trusted params only after the authoritative target is accepted', async () => {
    const senderId = 5103
    const adminId = bindUser(senderId, 'ADMIN')
    const studentId = seedStudent(db)
    db.prepare(
      "UPDATE auth_session SET last_activity_at = '2000-01-01 00:00:00' WHERE user_id = ?"
    ).run(adminId)
    const harness = createHarness()
    harness.setEvent('accepted-transport', fakeEvent(senderId))

    const result = await harness.bus.dispatch({
      commandType: 'student:update',
      rawInput: {
        callerUserId: adminId,
        callerRole: 'ADMIN',
        studentId,
        patch: { studentName: 'accepted-name' }
      },
      transport: { source: 'IPC', transportId: 'accepted-transport' }
    })

    expect(result.status).toBe('COMPLETED')
    expect(harness.calls).toEqual([{
      channel: 'student:update',
      params: {
        patch: { studentName: 'accepted-name' },
        studentId,
        callerUserId: adminId,
        callerRole: 'ADMIN'
      }
    }])
    expect((db.prepare(
      'SELECT last_activity_at FROM auth_session WHERE user_id = ?'
    ).get(adminId) as { last_activity_at: string }).last_activity_at)
      .not.toBe('2000-01-01 00:00:00')
  })

  it('preserves strategy family mismatch and missing-family public errors before acceptance', async () => {
    const senderId = 5104
    const adminId = bindUser(senderId, 'ADMIN')
    const harness = createHarness()
    harness.setEvent('strategy-transport', fakeEvent(senderId))
    db.prepare(
      "UPDATE auth_session SET last_activity_at = '2000-01-01 00:00:00' WHERE user_id = ?"
    ).run(adminId)
    const family = db.prepare(
      `SELECT strategy_id, strategy_type, job_code
         FROM strategy_config
        WHERE strategy_id = 'strategy_baseline_shelver_v1' AND version = 1`
    ).get() as { strategy_id: string; strategy_type: string; job_code: string }
    const stable = snapshotState()
    const transport = { source: 'IPC' as const, transportId: 'strategy-transport' }

    const wrongType = await harness.bus.dispatch({
      commandType: 'strategy:createVersion',
      rawInput: {
        callerUserId: adminId,
        callerRole: 'ADMIN',
        strategy: {
          strategyId: family.strategy_id,
          version: 2,
          strategyType: 'TRAINING_PRACTICE',
          jobCode: family.job_code
        }
      },
      transport
    })
    expect(wrongType).toMatchObject({
      status: 'REJECTED',
      reason: 'TARGET_MISMATCH',
      publicError: { errorCode: 'STRATEGY_TYPE_MISMATCH' }
    })

    const wrongJob = await harness.bus.dispatch({
      commandType: 'strategy:createVersion',
      rawInput: {
        callerUserId: adminId,
        callerRole: 'ADMIN',
        strategy: {
          strategyId: family.strategy_id,
          version: 2,
          strategyType: family.strategy_type,
          jobCode: 'FORGED_JOB'
        }
      },
      transport
    })
    expect(wrongJob).toMatchObject({
      status: 'REJECTED',
      reason: 'TARGET_MISMATCH',
      publicError: { errorCode: 'JOB_CODE_MISMATCH' }
    })

    const missingFamily = await harness.bus.dispatch({
      commandType: 'strategy:createVersion',
      rawInput: {
        callerUserId: adminId,
        callerRole: 'ADMIN',
        strategy: {
          strategyId: 'missing-strategy-family',
          version: 2,
          strategyType: family.strategy_type,
          jobCode: family.job_code
        }
      },
      transport
    })
    expect(missingFamily).toMatchObject({
      status: 'REJECTED',
      reason: 'TARGET_NOT_FOUND',
      publicError: { errorCode: 'NOT_FOUND' }
    })
    expect(snapshotState()).toBe(stable)
    expect(harness.calls).toHaveLength(0)
  })

  it('preserves training session, step and owner errors in resolver order', async () => {
    const senderId = 5105
    const studentId = bindUser(senderId, 'STUDENT')
    const teacherId = seedCaller(db, 'TEACHER')
    const trainingSessionId = 'm5a-training-session'
    const stepRecordId = 'm5a-training-step'
    db.prepare(
      `INSERT INTO business_session
         (business_session_id, session_type, student_id, job_code, task_code, created_by)
       VALUES (?, 'TRAINING', ?, 'SUPERMARKET_SHELVER', 'SHELVE_TASK', ?)`
    ).run(trainingSessionId, studentId, teacherId)
    db.prepare(
      `INSERT INTO training_session
         (training_session_id, business_session_id, student_id, job_code, task_code, strategy_id,
          strategy_type, strategy_version, status, module_type, total_step_count, created_by)
       VALUES (?, ?, ?, 'SUPERMARKET_SHELVER', 'SHELVE_TASK', 'strategy_training_shelver_v1',
               'TRAINING_PRACTICE', 1, 'ACTIVE', 'FINE_MOTOR', 1, ?)`
    ).run(trainingSessionId, trainingSessionId, studentId, teacherId)
    db.prepare(
      `INSERT INTO training_step_record
         (training_step_record_id, training_session_id, step_code, step_name,
          step_order, step_type, status)
       VALUES (?, ?, 'WATCH', '观看', 1, 'WATCH', 'NOT_STARTED')`
    ).run(stepRecordId, trainingSessionId)
    const harness = createHarness()
    harness.setEvent('training-transport', fakeEvent(senderId))
    const otherSenderId = 5106
    const otherStudentId = bindUser(otherSenderId, 'STUDENT')
    harness.setEvent('other-training-transport', fakeEvent(otherSenderId))
    const transport = { source: 'IPC' as const, transportId: 'training-transport' }
    const stable = snapshotState()

    const missingSession = await harness.bus.dispatch({
      commandType: 'training:startStep',
      rawInput: {
        callerUserId: studentId,
        callerRole: 'STUDENT',
        trainingSessionId: 'missing-training-session',
        stepRecordId: ''
      },
      transport
    })
    expect(missingSession).toMatchObject({
      status: 'REJECTED',
      reason: 'TARGET_NOT_FOUND',
      publicError: { errorCode: 'NOT_FOUND' }
    })

    const missingStep = await harness.bus.dispatch({
      commandType: 'training:startStep',
      rawInput: {
        callerUserId: studentId,
        callerRole: 'STUDENT',
        trainingSessionId,
        stepRecordId: 'missing-training-step'
      },
      transport
    })
    expect(missingStep).toMatchObject({
      status: 'REJECTED',
      reason: 'TARGET_MISMATCH',
      publicError: { errorCode: 'STEP_NOT_FOUND' }
    })

    const wrongOwner = await harness.bus.dispatch({
      commandType: 'training:startStep',
      rawInput: {
        callerUserId: otherStudentId,
        callerRole: 'STUDENT',
        trainingSessionId,
        stepRecordId
      },
      transport: { source: 'IPC', transportId: 'other-training-transport' }
    })
    expect(wrongOwner).toMatchObject({
      status: 'REJECTED',
      reason: 'TARGET_MISMATCH',
      publicError: { errorCode: 'FORBIDDEN' }
    })
    expect(snapshotState()).toBe(stable)
    expect(harness.calls).toHaveLength(0)
  })

  it('maps a same-key race to typed failure without invoking the handler twice', async () => {
    const senderId = 5107
    const adminId = bindUser(senderId, 'ADMIN')
    const studentId = seedStudent(db)
    let release!: () => void
    const held = new Promise<void>((resolve) => { release = resolve })
    const harness = createHarness({
      handler(channel) {
        return channel === 'student:update' ? held.then(() => ({ success: true })) : { success: true }
      }
    })
    harness.setEvent('race-a', fakeEvent(senderId))
    harness.setEvent('race-b', fakeEvent(senderId))
    const rawInput = {
      callerUserId: adminId,
      callerRole: 'ADMIN',
      studentId,
      patch: { studentName: 'race' }
    }

    const first = harness.bus.dispatch({
      commandType: 'student:update',
      rawInput,
      transport: { source: 'IPC', transportId: 'race-a' }
    })
    await vi.waitFor(() => expect(harness.calls).toHaveLength(1))
    const second = await harness.bus.dispatch({
      commandType: 'student:update',
      rawInput,
      transport: { source: 'IPC', transportId: 'race-b' }
    })

    expect(second).toEqual({
      status: 'REJECTED',
      reason: 'ACTIVE_KEY_CONFLICT',
      publicError: { success: false, errorCode: 'SYSTEM_ERROR' }
    })
    expect(harness.calls).toHaveLength(1)
    release()
    expect((await first).status).toBe('COMPLETED')
    expect(harness.bus.activeKeyGuard.size()).toBe(0)
  })
})
