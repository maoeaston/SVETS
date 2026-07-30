import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { readFileSync } from 'fs'

const electronState = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, rawInput?: unknown) => Promise<unknown>>(),
  failOnChannel: null as string | null
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle(channel: string, handler: (event: unknown, rawInput?: unknown) => Promise<unknown>) {
      if (electronState.failOnChannel === channel) throw new Error(`injected registration failure: ${channel}`)
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
import type { MemoryAdapter } from '../../db/memory-adapter'
import { createTestDb, seedCaller, seedStudent } from '../../db/test-helpers'
import {
  createApplicationRuntime,
  type ApplicationRuntime,
  type RuntimeScheduler
} from '../../application/runtime/application-runtime'
import type { ReportMutationPort } from '../../domain/report-command-coordinator'
import {
  clearAuthSessionBinding,
  issuePasswordAuthSession,
  replaceSenderAuthSession
} from '../../utils/auth-session'
import { registerCentralIpcHandlers } from '../handler-registry'

class InertScheduler implements RuntimeScheduler {
  setInterval(): object {
    return {}
  }

  clearInterval(): void {}
}

const inertReportPort = (): ReportMutationPort => Object.freeze({
  writeEvent() {
    throw new Error('inert report port')
  },
  recoverPending() {}
})

const databases: MemoryAdapter[] = []
const runtimes: ApplicationRuntime[] = []
const senderIds = new Set<number>()

async function createRuntime(): Promise<{ db: MemoryAdapter; runtime: ApplicationRuntime }> {
  const db = await createTestDb()
  databases.push(db)
  const runtime = createApplicationRuntime({
    db,
    dataRoot: `/tmp/svets-m5a-handler-registry-${uuidv4()}`,
    dependencies: {
      prepareDirectory: () => undefined,
      createLegacyMutationPort: inertReportPort,
      scheduler: new InertScheduler()
    }
  })
  runtimes.push(runtime)
  return { db, runtime }
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
  role: 'STUDENT' | 'TEACHER' | 'ADMIN'
): string {
  const userId = role === 'STUDENT' ? seedStudent(db) : seedCaller(db, role)
  const issued = issuePasswordAuthSession(db, {
    userId,
    role,
    displayName: `${role} user`
  })
  replaceSenderAuthSession(db, senderId, issued.rawToken, runtime.bindingOwnerId)
  senderIds.add(senderId)
  return userId
}

function requireHandler(channel: string) {
  const handler = electronState.handlers.get(channel)
  if (!handler) throw new Error(`missing test IPC handler: ${channel}`)
  return handler
}

beforeEach(() => {
  electronState.handlers.clear()
  electronState.failOnChannel = null
})

afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.dispose()
  for (const senderId of senderIds) clearAuthSessionBinding(senderId)
  senderIds.clear()
  for (const db of databases.splice(0)) db.close()
  electronState.handlers.clear()
  electronState.failOnChannel = null
})

describe('M5A central IPC registry', () => {
  it('installs the exact 74/28/46 set through one sealed registry', async () => {
    const { runtime } = await createRuntime()
    const boundary = registerCentralIpcHandlers(runtime)

    expect(boundary.channels).toHaveLength(74)
    expect(new Set(boundary.channels).size).toBe(74)
    expect(electronState.handlers.size).toBe(74)
    expect(boundary.registry.list().filter((item) => item.metadata.mode === 'READ')).toHaveLength(28)
    expect(boundary.registry.list().filter((item) => item.metadata.mode === 'MUTATION')).toHaveLength(46)
    expect(boundary.registry.isSealed()).toBe(true)
    expect(boundary.commandBus.isReady()).toBe(true)

    const mutationDefinitions = boundary.registry.list().filter((item) => item.metadata.mode === 'MUTATION')
    expect(new Set(mutationDefinitions.map((item) => item.metadata.preflightErrorMap.ACTIVE_KEY_CONFLICT)))
      .toEqual(new Set([
        'SYSTEM_ERROR',
        'ASSESSMENT_SYSTEM_ERROR',
        'TRAINING_SYSTEM_ERROR',
        'ASSIGNMENT_SYSTEM_ERROR',
        'SAFETY_SYSTEM_ERROR',
        'REPORT_SYSTEM_ERROR'
      ]))
    expect(mutationDefinitions.every((item) => item.metadata.targetResolver.authoritativeFields.length > 0)).toBe(true)
    expect(new Set(mutationDefinitions.map((item) => item.metadata.targetResolver.owner)).size).toBe(46)
    expect(mutationDefinitions.every((item) => item.metadata.targetResolver.owner === item.commandType)).toBe(true)
    expect(mutationDefinitions.every((item) =>
      item.metadata.targetResolver.canonicalTargetFields.length > 0
      && item.metadata.targetResolver.testReferences.length > 0
      && item.metadata.testReferences.length > 0
    )).toBe(true)

    const mutationByType = new Map(mutationDefinitions.map((item) => [item.commandType, item]))
    expect(mutationByType.get('training:startStep')?.metadata.preflightErrorDetailMap)
      .toMatchObject({ TARGET_MISMATCH: { training_step_record: 'STEP_NOT_FOUND' } })
    expect(mutationByType.get('strategy:createVersion')?.metadata.preflightErrorDetailMap)
      .toMatchObject({
        TARGET_MISMATCH: {
          'strategy.strategyType': 'STRATEGY_TYPE_MISMATCH',
          'strategy.jobCode': 'JOB_CODE_MISMATCH'
        }
      })
    expect(mutationByType.get('reports:replaceTaskClosure')?.metadata.preflightErrorDetailMap)
      .toMatchObject({
        TARGET_MISMATCH: {
          resultIds: 'TASK_CLOSURE_INVALID',
          taskClosureId: 'TASK_CLOSURE_INVALID'
        }
      })
    expect(mutationByType.get('assignment:confirmStudent')?.metadata.preflightErrorDetailMap)
      .toMatchObject({
        INVALID_PAYLOAD: { confirmationMethod: 'UNSUPPORTED_CONFIRMATION_METHOD' }
      })

    const preloadSource = readFileSync(
      new URL('../../../preload/index.ts', import.meta.url),
      'utf8'
    )
    const preloadChannels = [...preloadSource.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)]
      .map((match) => match[1])
      .sort()
    expect(preloadChannels).toEqual([...boundary.channels].sort())

    runtime.dispose()
    expect(electronState.handlers.size).toBe(0)
    expect(boundary.commandBus.isReady()).toBe(false)
  })

  it('keeps mutation closed before runtime ready and performs no business write', async () => {
    const { db, runtime } = await createRuntime()
    registerCentralIpcHandlers(runtime)
    const senderId = 4101
    const adminId = bindUser(db, runtime, senderId, 'ADMIN')
    const before = {
      users: (db.prepare('SELECT COUNT(*) AS count FROM user_account').get() as { count: number }).count,
      sessions: (db.prepare('SELECT COUNT(*) AS count FROM auth_session').get() as { count: number }).count,
      lastActivity: (db.prepare(
        'SELECT last_activity_at FROM auth_session WHERE user_id = ?'
      ).get(adminId) as { last_activity_at: string }).last_activity_at
    }

    const result = await requireHandler('student:create')(event(senderId), {
      callerUserId: adminId,
      callerRole: 'ADMIN',
      username: 'not-created',
      password: 'secret',
      studentName: 'not created'
    })

    expect(result).toEqual({ success: false, errorCode: 'SYSTEM_ERROR' })
    expect((db.prepare('SELECT COUNT(*) AS count FROM user_account').get() as { count: number }).count)
      .toBe(before.users)
    expect((db.prepare('SELECT COUNT(*) AS count FROM auth_session').get() as { count: number }).count)
      .toBe(before.sessions)
    expect((db.prepare(
      'SELECT last_activity_at FROM auth_session WHERE user_id = ?'
    ).get(adminId) as { last_activity_at: string }).last_activity_at).toBe(before.lastActivity)
  })

  it('routes READ through a pure session snapshot without heartbeat', async () => {
    const { db, runtime } = await createRuntime()
    registerCentralIpcHandlers(runtime)
    runtime.markBoundaryReady()
    const senderId = 4102
    const teacherId = bindUser(db, runtime, senderId, 'TEACHER')
    db.prepare(
      "UPDATE auth_session SET last_activity_at = '2000-01-01 00:00:00' WHERE user_id = ?"
    ).run(teacherId)

    const result = await requireHandler('student:list')(event(senderId), {
      callerUserId: teacherId,
      callerRole: 'TEACHER'
    })

    expect(result).toMatchObject({ success: true, items: [] })
    expect((db.prepare(
      'SELECT last_activity_at FROM auth_session WHERE user_id = ?'
    ).get(teacherId) as { last_activity_at: string }).last_activity_at)
      .toBe('2000-01-01 00:00:00')
  })

  it('rejects caller mismatch and missing target before heartbeat', async () => {
    const { db, runtime } = await createRuntime()
    registerCentralIpcHandlers(runtime)
    runtime.markBoundaryReady()
    const senderId = 4103
    const adminId = bindUser(db, runtime, senderId, 'ADMIN')
    db.prepare(
      "UPDATE auth_session SET last_activity_at = '2000-01-01 00:00:00' WHERE user_id = ?"
    ).run(adminId)

    const mismatch = await requireHandler('student:update')(event(senderId), {
      callerUserId: 'forged-user',
      callerRole: 'ADMIN',
      studentId: 'missing-student',
      patch: { studentName: 'x' }
    })
    expect(mismatch).toEqual({ success: false, errorCode: 'FORBIDDEN' })

    const missing = await requireHandler('student:update')(event(senderId), {
      callerUserId: adminId,
      callerRole: 'ADMIN',
      studentId: 'missing-student',
      patch: { studentName: 'x' }
    })
    expect(missing).toEqual({ success: false, errorCode: 'NOT_FOUND' })
    expect((db.prepare(
      'SELECT last_activity_at FROM auth_session WHERE user_id = ?'
    ).get(adminId) as { last_activity_at: string }).last_activity_at)
      .toBe('2000-01-01 00:00:00')
  })

  it('heartbeats only after acceptance and invokes the existing business function', async () => {
    const { db, runtime } = await createRuntime()
    registerCentralIpcHandlers(runtime)
    runtime.markBoundaryReady()
    const senderId = 4104
    const adminId = bindUser(db, runtime, senderId, 'ADMIN')
    const teacherId = seedCaller(db, 'TEACHER')
    db.prepare(
      "UPDATE auth_session SET last_activity_at = '2000-01-01 00:00:00' WHERE user_id = ?"
    ).run(adminId)

    const result = await requireHandler('auth:setTeacherAccountStatus')(event(senderId), {
      callerUserId: adminId,
      callerRole: 'ADMIN',
      teacherUserId: teacherId,
      status: 'DISABLED'
    })

    expect(result).toMatchObject({ success: true, revokedSessionCount: 0 })
    expect((db.prepare('SELECT status FROM user_account WHERE user_id = ?').get(teacherId) as { status: string }).status)
      .toBe('DISABLED')
    expect((db.prepare(
      'SELECT last_activity_at FROM auth_session WHERE user_id = ?'
    ).get(adminId) as { last_activity_at: string }).last_activity_at)
      .not.toBe('2000-01-01 00:00:00')
  })

  it('rolls back every installed handler if central registration fails', async () => {
    const { runtime } = await createRuntime()
    electronState.failOnChannel = 'auth:login'

    expect(() => registerCentralIpcHandlers(runtime)).toThrow('injected registration failure')
    expect(electronState.handlers.size).toBe(0)
  })
})
