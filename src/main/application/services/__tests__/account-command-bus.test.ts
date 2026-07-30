import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { v4 as uuidv4 } from 'uuid'

const electronState = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, rawInput?: unknown) => Promise<unknown>>()
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

import type { IpcMainInvokeEvent } from 'electron'
import type { MemoryAdapter } from '../../../db/memory-adapter'
import {
  baseStrategyInput,
  createTestDb,
  seedCaller
} from '../../../db/test-helpers'
import {
  createApplicationRuntime,
  type ApplicationRuntime,
  type RuntimeScheduler
} from '../../runtime/application-runtime'
import {
  clearAuthSessionBinding,
  hasAuthSessionBinding,
  issuePasswordAuthSession,
  replaceSenderAuthSession
} from '../../../utils/auth-session'
import { registerCentralIpcHandlers } from '../../../ipc/handler-registry'
import type { CentralIpcBoundary } from '../../../ipc/handler-registry'

const M5A5_MUTATIONS = [
  'auth:createTeacherAccount',
  'auth:login',
  'auth:logout',
  'auth:setTeacherAccountStatus',
  'student:archive',
  'student:create',
  'student:update',
  'strategy:createVersion',
  'strategy:setActive',
  'strategy:update'
] as const

class InertScheduler implements RuntimeScheduler {
  setInterval(): object {
    return {}
  }

  clearInterval(): void {}
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
  const runtime = createApplicationRuntime({
    db,
    dataRoot: `/tmp/svets-m5a5-account-${uuidv4()}`,
    dependencies: {
      prepareDirectory: () => undefined,
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
  role: 'TEACHER' | 'ADMIN'
): string {
  const userId = seedCaller(db, role)
  const issued = issuePasswordAuthSession(db, { userId, role, displayName: role })
  replaceSenderAuthSession(db, senderId, issued.rawToken, runtime.bindingOwnerId)
  senderIds.add(senderId)
  return userId
}

function requireHandler(channel: string) {
  const handler = electronState.handlers.get(channel)
  if (!handler) throw new Error(`missing test IPC handler: ${channel}`)
  return (event: unknown, rawInput?: unknown) => (handler as unknown as (
    event: unknown,
    input?: unknown,
    transportMetadata?: unknown
  ) => Promise<unknown>)(event, rawInput, {
    schemaVersion: 1,
    clientInstanceId: uuidv4(),
    idempotencyKey: uuidv4(),
    deviceId: null
  })
}

beforeEach(() => {
  electronState.handlers.clear()
})

afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.dispose()
  for (const senderId of senderIds) clearAuthSessionBinding(senderId)
  senderIds.clear()
  for (const db of databases.splice(0)) db.close()
  electronState.handlers.clear()
})

describe('M5A-5 account commands through CommandBus', () => {
  it('freezes all ten registry rows to application service ownership', async () => {
    const { runtime, boundary } = await createRuntime()
    const definitions = M5A5_MUTATIONS.map((channel) => boundary.registry.requireMutation(channel))
    expect(definitions).toHaveLength(10)
    expect(definitions.every((definition) =>
      definition.metadata.transactionOwner.includes('-service.')
      && definition.metadata.retryPolicy === 'NO_AUTO_RETRY'
      && definition.metadata.concurrencyPolicy.kind === 'FAIL_FAST_ACTIVE_KEY'
      && definition.metadata.testReferences.includes(
        'src/main/application/services/__tests__/account-command-bus.test.ts'
      )
    )).toBe(true)
    expect(definitions.every((definition) =>
      !definition.metadata.sideEffects.includes('LEGACY_HANDLER_MUTATION')
    )).toBe(true)
    expect(runtime.isBoundaryReady()).toBe(true)
  })

  it('runs auth, student and strategy mutations through the accepted application routes', async () => {
    const { db, runtime } = await createRuntime()
    const senderId = 6201
    const adminId = bindUser(db, runtime, senderId, 'ADMIN')
    db.prepare(
      "UPDATE auth_session SET last_activity_at = '2000-01-01 00:00:00' WHERE user_id = ?"
    ).run(adminId)
    const ipcEvent = event(senderId)

    const teacher = await requireHandler('auth:createTeacherAccount')(ipcEvent, {
      callerUserId: adminId,
      callerRole: 'ADMIN',
      username: 'm5a5_teacher',
      password: 'teacher-password',
      displayName: 'M5A5 教师'
    }) as { success: true; account: { userId: string } }
    expect(teacher.success).toBe(true)
    expect(await requireHandler('auth:setTeacherAccountStatus')(ipcEvent, {
      callerUserId: adminId,
      callerRole: 'ADMIN',
      teacherUserId: teacher.account.userId,
      status: 'DISABLED'
    })).toMatchObject({ success: true })

    const createdStudent = await requireHandler('student:create')(ipcEvent, {
      callerUserId: adminId,
      callerRole: 'ADMIN',
      username: 'm5a5_student',
      password: 'student-password',
      studentName: '迁移学生'
    }) as { success: true; studentId: string }
    expect(createdStudent.success).toBe(true)
    expect(await requireHandler('student:update')(ipcEvent, {
      callerUserId: adminId,
      callerRole: 'ADMIN',
      studentId: createdStudent.studentId,
      patch: { studentName: '迁移学生（更新）' }
    })).toEqual({ success: true })
    expect(await requireHandler('student:archive')(ipcEvent, {
      callerUserId: adminId,
      callerRole: 'ADMIN',
      studentId: createdStudent.studentId
    })).toEqual({ success: true })

    const strategy = baseStrategyInput({
      strategyId: 'm5a5_strategy_family',
      jobCode: 'M5A5_TEST_JOB',
      strategyName: 'M5A5 策略'
    })
    expect(await requireHandler('strategy:createVersion')(ipcEvent, {
      callerUserId: adminId,
      callerRole: 'ADMIN',
      strategy
    })).toEqual({ success: true })
    expect(await requireHandler('strategy:update')(ipcEvent, {
      callerUserId: adminId,
      callerRole: 'ADMIN',
      strategyId: strategy.strategyId,
      version: strategy.version,
      patch: { strategyName: 'M5A5 策略（更新）' }
    })).toEqual({ success: true })
    expect(await requireHandler('strategy:setActive')(ipcEvent, {
      callerUserId: adminId,
      callerRole: 'ADMIN',
      strategyId: strategy.strategyId,
      version: strategy.version,
      isActive: false
    })).toEqual({ success: true })

    expect((db.prepare('SELECT status FROM user_account WHERE user_id = ?').get(teacher.account.userId) as { status: string }).status)
      .toBe('DISABLED')
    expect((db.prepare('SELECT status FROM student_profile WHERE student_id = ?').get(createdStudent.studentId) as { status: string }).status)
      .toBe('ARCHIVED')
    expect((db.prepare('SELECT strategy_name, is_active FROM strategy_config WHERE strategy_id = ? AND version = ?')
      .get(strategy.strategyId, strategy.version) as { strategy_name: string; is_active: number }))
      .toEqual({ strategy_name: 'M5A5 策略（更新）', is_active: 0 })
    expect((db.prepare('SELECT last_activity_at FROM auth_session WHERE user_id = ?').get(adminId) as { last_activity_at: string }).last_activity_at)
      .not.toBe('2000-01-01 00:00:00')

    const auditCodes = (db.prepare('SELECT error_code FROM error_event_log').all() as Array<{ error_code: string }>)
      .map((row) => row.error_code)
    expect(auditCodes).toEqual(expect.arrayContaining([
      'AUTH_TEACHER_ACCOUNT_CREATED',
      'AUTH_TEACHER_ACCOUNT_DISABLED',
      'STUDENT_PROFILE_CREATED',
      'STUDENT_PROFILE_UPDATED',
      'STUDENT_PROFILE_ARCHIVED',
      'STRATEGY_CONFIG_CREATED',
      'STRATEGY_CONFIG_UPDATED',
      'STRATEGY_CONFIG_ACTIVE_TOGGLED'
    ]))
  })

  it('keeps login failure audit, sender binding and logout revocation semantics', async () => {
    const { db } = await createRuntime()
    const userId = seedCaller(db, 'TEACHER')
    const account = db.prepare('SELECT username FROM user_account WHERE user_id = ?')
      .get(userId) as { username: string }
    const senderId = 6202
    const ipcEvent = event(senderId)

    expect(await requireHandler('auth:login')(ipcEvent, {
      username: account.username,
      password: 'wrong-password'
    })).toEqual({ success: false, errorCode: 'INVALID_CREDENTIALS' })
    expect(hasAuthSessionBinding(senderId)).toBe(false)
    expect((db.prepare("SELECT COUNT(*) AS count FROM error_event_log WHERE error_code = 'AUTH_LOGIN_FAILED'").get() as { count: number }).count)
      .toBe(1)

    expect(await requireHandler('auth:login')(ipcEvent, {
      username: account.username,
      password: 'x'
    })).toMatchObject({ success: true, userId, role: 'TEACHER' })
    expect(hasAuthSessionBinding(senderId)).toBe(true)

    expect(await requireHandler('auth:logout')(ipcEvent)).toEqual({ success: true })
    expect(hasAuthSessionBinding(senderId)).toBe(false)
    expect((db.prepare("SELECT COUNT(*) AS count FROM error_event_log WHERE error_code = 'AUTH_LOGOUT_SUCCESS'").get() as { count: number }).count)
      .toBe(1)
  })

  it('rejects role, caller and target failures before account DML or heartbeat', async () => {
    const { db, runtime } = await createRuntime()
    const teacherSender = 6203
    const teacherId = bindUser(db, runtime, teacherSender, 'TEACHER')
    db.prepare(
      "UPDATE auth_session SET last_activity_at = '2000-01-01 00:00:00' WHERE user_id = ?"
    ).run(teacherId)
    const beforeAudits = (db.prepare('SELECT COUNT(*) AS count FROM error_event_log').get() as { count: number }).count

    expect(await requireHandler('strategy:setActive')(event(teacherSender), {
      callerUserId: teacherId,
      callerRole: 'TEACHER',
      strategyId: 'strategy_baseline_shelver_v1',
      version: 1,
      isActive: false
    })).toEqual({ success: false, errorCode: 'FORBIDDEN' })
    expect((db.prepare('SELECT last_activity_at FROM auth_session WHERE user_id = ?').get(teacherId) as { last_activity_at: string }).last_activity_at)
      .toBe('2000-01-01 00:00:00')

    const adminSender = 6204
    const adminId = bindUser(db, runtime, adminSender, 'ADMIN')
    db.prepare(
      "UPDATE auth_session SET last_activity_at = '2000-01-01 00:00:00' WHERE user_id = ?"
    ).run(adminId)
    expect(await requireHandler('student:update')(event(adminSender), {
      callerUserId: 'forged-admin',
      callerRole: 'ADMIN',
      studentId: 'missing-student',
      patch: { studentName: 'not written' }
    })).toEqual({ success: false, errorCode: 'FORBIDDEN' })
    expect(await requireHandler('student:update')(event(adminSender), {
      callerUserId: adminId,
      callerRole: 'ADMIN',
      studentId: 'missing-student',
      patch: { studentName: 'not written' }
    })).toEqual({ success: false, errorCode: 'NOT_FOUND' })
    expect((db.prepare('SELECT last_activity_at FROM auth_session WHERE user_id = ?').get(adminId) as { last_activity_at: string }).last_activity_at)
      .toBe('2000-01-01 00:00:00')
    expect((db.prepare('SELECT COUNT(*) AS count FROM error_event_log').get() as { count: number }).count)
      .toBe(beforeAudits)
  })
})
