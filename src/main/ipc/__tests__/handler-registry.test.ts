import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { readFileSync } from 'fs'

const electronState = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, rawInput?: unknown, transportMetadata?: unknown) => Promise<unknown>>(),
  failOnChannel: null as string | null,
  showSaveDialog: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle(channel: string, handler: (event: unknown, rawInput?: unknown, transportMetadata?: unknown) => Promise<unknown>) {
      if (electronState.failOnChannel === channel) throw new Error(`injected registration failure: ${channel}`)
      if (electronState.handlers.has(channel)) throw new Error(`duplicate IPC handler: ${channel}`)
      electronState.handlers.set(channel, handler)
    },
    removeHandler(channel: string) {
      electronState.handlers.delete(channel)
    }
  },
  dialog: {
    showSaveDialog: electronState.showSaveDialog,
    showErrorBox: vi.fn()
  }
}))

import type { IpcMainInvokeEvent } from 'electron'
import type { MemoryAdapter } from '../../db/memory-adapter'
import { createTestDb, seedCaller, seedStudent } from '../../db/test-helpers'
import { applyEventBatchMigration } from '../../db/event-batch-migration'
import {
  createApplicationRuntime,
  startApplicationRuntime,
  type ApplicationRuntime,
  type RuntimeScheduler
} from '../../application/runtime/application-runtime'
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
      scheduler: new InertScheduler()
    }
  })
  runtimes.push(runtime)
  return { db, runtime }
}

async function createM5bRuntime(): Promise<{ db: MemoryAdapter; runtime: ApplicationRuntime }> {
  const db = await createTestDb()
  databases.push(db)
  applyEventBatchMigration(db, { createVerifiedBackupBeforeDdl: () => undefined })
  const runtime = await startApplicationRuntime({
    runtime: {
      db,
      dataRoot: `/tmp/svets-m5b-handler-registry-${uuidv4()}`,
      dependencies: { scheduler: new InertScheduler() }
    },
    registerBoundary: registerCentralIpcHandlers
  })
  runtimes.push(runtime)
  return { db, runtime }
}

function mutationMetadata() {
  return {
    schemaVersion: 1 as const,
    clientInstanceId: uuidv4(),
    idempotencyKey: uuidv4(),
    deviceId: null
  }
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

function seedReportForExportDialog(db: MemoryAdapter, teacherId: string): string {
  const reportId = uuidv4()
  const eventId = uuidv4()
  const timestamp = '2026-07-30T00:00:00.000Z'
  db.prepare(
    `INSERT INTO domain_event_projection
       (event_id, aggregate_type, aggregate_id, event_type, event_sequence,
        payload_json, checksum, source_log_path, schema_version, created_at)
     VALUES (?, 'TASK_REPORT', ?, 'REPORT_GENERATED', 1, '{}', 'seed', 'seed', 2, ?)`
  ).run(eventId, reportId, timestamp)
  db.prepare(
    `INSERT INTO task_report
       (report_id, report_type, report_title, report_content_json, generated_event_id,
        generated_by, generated_at, contract_validation_status, status)
     VALUES (?, 'FULL_REPORT', 'Dialog failure report', '{}', ?, ?, ?, 'VALID', 'GENERATED')`
  ).run(reportId, eventId, teacherId, timestamp)
  return reportId
}

beforeEach(() => {
  electronState.handlers.clear()
  electronState.failOnChannel = null
  electronState.showSaveDialog.mockReset()
})

afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.dispose()
  for (const senderId of senderIds) clearAuthSessionBinding(senderId)
  senderIds.clear()
  for (const db of databases.splice(0)) db.close()
  electronState.handlers.clear()
  electronState.failOnChannel = null
  electronState.showSaveDialog.mockReset()
})

describe('M5B central IPC registry', () => {
  it('installs the exact 75/29/46 set through one sealed registry', async () => {
    const { runtime } = await createRuntime()
    const boundary = registerCentralIpcHandlers(runtime)

    expect(boundary.channels).toHaveLength(75)
    expect(new Set(boundary.channels).size).toBe(75)
    expect(electronState.handlers.size).toBe(75)
    expect(boundary.registry.list().filter((item) => item.metadata.mode === 'READ')).toHaveLength(29)
    expect(boundary.registry.list().filter((item) => item.metadata.mode === 'MUTATION')).toHaveLength(46)
    expect(boundary.registry.isSealed()).toBe(true)

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

  it('keeps malformed direct mutation transport out of the durable executor', async () => {
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
    expect(mismatch).toEqual({ success: false, errorCode: 'SYSTEM_ERROR' })

    const missing = await requireHandler('student:update')(event(senderId), {
      callerUserId: adminId,
      callerRole: 'ADMIN',
      studentId: 'missing-student',
      patch: { studentName: 'x' }
    })
    expect(missing).toEqual({ success: false, errorCode: 'SYSTEM_ERROR' })
    expect((db.prepare(
      'SELECT last_activity_at FROM auth_session WHERE user_id = ?'
    ).get(adminId) as { last_activity_at: string }).last_activity_at)
      .toBe('2000-01-01 00:00:00')
  })

  it('opens the migrated runtime and durably applies a gate-only mutation through IPC', async () => {
    const { db, runtime } = await createM5bRuntime()
    const senderId = 4104
    const adminId = bindUser(db, runtime, senderId, 'ADMIN')

    expect(runtime.health()).toMatchObject({ state: 'OPEN', legacyRecordCount: 0 })
    const result = await requireHandler('student:create')(event(senderId), {
      callerUserId: adminId,
      callerRole: 'ADMIN',
      username: 'durable-student',
      password: 'durable-password',
      studentName: 'Durable Student'
    }, mutationMetadata())

    expect(result).toMatchObject({ success: true })
    expect((db.prepare("SELECT COUNT(*) AS count FROM command_log WHERE command_type = 'student:create' AND status = 'SUCCEEDED'").get() as { count: number }).count)
      .toBe(1)
    expect((db.prepare("SELECT COUNT(*) AS count FROM student_profile WHERE student_name = 'Durable Student'").get() as { count: number }).count)
      .toBe(1)
  })

  it('marks a gate-only command as FAILED when its transaction throws after acceptance', async () => {
    const { db, runtime } = await createM5bRuntime()
    const senderId = 4106
    const adminId = bindUser(db, runtime, senderId, 'ADMIN')
    const originalImmediate = db.immediateTransaction.bind(db)
    let injected = false
    db.immediateTransaction = (<T>(callback: () => T): (() => T) => () => {
      const processingCount = (db.prepare(
        "SELECT COUNT(*) AS count FROM command_log WHERE status = 'PROCESSING'"
      ).get() as { count: number }).count
      if (!injected && processingCount === 1) {
        injected = true
        throw new Error('injected gate-only transaction failure')
      }
      return originalImmediate(callback)()
    }) as typeof db.immediateTransaction

    const result = await requireHandler('student:create')(event(senderId), {
      callerUserId: adminId,
      callerRole: 'ADMIN',
      username: 'failed-gate-student',
      password: 'durable-password',
      studentName: 'Failed Gate Student'
    }, mutationMetadata())

    expect(injected).toBe(true)
    expect(result).toEqual({ success: false, errorCode: 'SYSTEM_ERROR' })
    expect(db.prepare(
      "SELECT status, error_code, result_json FROM command_log WHERE command_type = 'student:create'"
    ).get()).toEqual({
      status: 'FAILED',
      error_code: 'PRE_PONR_EXECUTION_FAILURE',
      result_json: null
    })
    expect((db.prepare("SELECT COUNT(*) AS count FROM student_profile WHERE student_name = 'Failed Gate Student'").get() as { count: number }).count)
      .toBe(0)
  })

  it('marks an accepted report export as FAILED when the save dialog throws before PREPARE', async () => {
    const { db, runtime } = await createM5bRuntime()
    const senderId = 4105
    const teacherId = bindUser(db, runtime, senderId, 'TEACHER')
    const reportId = seedReportForExportDialog(db, teacherId)
    electronState.showSaveDialog.mockRejectedValueOnce(new Error('injected save dialog failure'))

    const result = await requireHandler('reports:export')(event(senderId), {
      callerUserId: teacherId,
      callerRole: 'TEACHER',
      reportId
    }, mutationMetadata())

    expect(result).toEqual({ success: false, errorCode: 'REPORT_SYSTEM_ERROR' })
    expect(db.prepare(
      "SELECT status, error_code, result_json FROM command_log WHERE command_type = 'reports:export'"
    ).get()).toEqual({
      status: 'FAILED',
      error_code: 'PRE_PONR_EXECUTION_FAILURE',
      result_json: null
    })
    expect((db.prepare('SELECT COUNT(*) AS count FROM applied_event_batch').get() as { count: number }).count)
      .toBe(0)
  })

  it('returns a stable system failure when direct test transport omits preload metadata', async () => {
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

    expect(result).toEqual({ success: false, errorCode: 'SYSTEM_ERROR' })
    expect((db.prepare('SELECT status FROM user_account WHERE user_id = ?').get(teacherId) as { status: string }).status)
      .toBe('ACTIVE')
    expect((db.prepare(
      'SELECT last_activity_at FROM auth_session WHERE user_id = ?'
    ).get(adminId) as { last_activity_at: string }).last_activity_at)
      .toBe('2000-01-01 00:00:00')
  })

  it('rolls back every installed handler if central registration fails', async () => {
    const { runtime } = await createRuntime()
    electronState.failOnChannel = 'auth:login'

    expect(() => registerCentralIpcHandlers(runtime)).toThrow('injected registration failure')
    expect(electronState.handlers.size).toBe(0)
  })
})
