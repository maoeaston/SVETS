import { beforeEach, describe, expect, it } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { CommandRegistry } from '../command-registry'
import {
  DurableCommandCoordinator,
  type DurableCommandAccepted
} from '../durable-command-coordinator'
import { DurableCommandStore } from '../durable-command-store'
import { GateOnlyExecutor } from '../gate-only-executor'
import {
  applyGateOnlyCommand,
  applyGateOnlyPostCommitBinding
} from '../gate-only-command-apply'
import { createM5AMutationDefinitions } from '../m5a-command-definitions'
import { EVENT_BATCH_SCHEMA_SQL } from '../../../db/event-batch-migration'
import { MemoryAdapter } from '../../../db/memory-adapter'
import { baseStrategyInput, createTestDb } from '../../../db/test-helpers'
import { hashPassword } from '../../../utils/password'
import {
  bindAuthSessionToSender,
  clearAuthSessionBinding,
  issuePasswordAuthSession,
  revokeAuthSessionById,
  resolveBoundAuthSessionSnapshot
} from '../../../utils/auth-session'
import {
  createTeacherAccount,
  executeLoginCommand,
  executeLogoutCommand,
  seedAuthErrorCodes,
  setTeacherAccountStatus
} from '../../services/auth-service'
import { archiveStudent, createStudent, seedStudentErrorCodes, updateStudent } from '../../services/student-service'
import { createVersion, seedStrategyErrorCodes, setActive, updateStrategy } from '../../services/strategy-service'
import type { CommandActor } from '../command-types'

const SENDER_ID = 7701
const CLOCK = new Date('2026-07-29T14:00:00.000Z')

function metadata(clientInstanceId: string, idempotencyKey = uuidv4()) {
  return { schemaVersion: 1 as const, clientInstanceId, idempotencyKey, deviceId: 'gate-test-device' }
}

async function createHarness(senderId = SENDER_ID) {
  const database = await createTestDb()
  database.exec(EVENT_BATCH_SCHEMA_SQL)
  seedAuthErrorCodes(database)
  seedStudentErrorCodes(database)
  seedStrategyErrorCodes(database)

  const registry = new CommandRegistry()
  const event = { sender: { id: senderId } } as never
  for (const definition of createM5AMutationDefinitions({
    db: database,
    eventForTransport: () => event,
    handlerForChannel: () => () => {
      throw new Error('M5B-7 gate tests must not invoke the legacy handler')
    }
  })) registry.registerMutation(definition)
  registry.seal()

  const store = new DurableCommandStore(database)
  const coordinator = new DurableCommandCoordinator({
    registry,
    store,
    workerId: 'm5b-gate-test-worker',
    now: () => CLOCK
  })
  return {
    database,
    store,
    coordinator,
    executor: new GateOnlyExecutor({ database, coordinator })
  }
}

function seedAdmin(database: MemoryAdapter, senderId = SENDER_ID) {
  const userId = uuidv4()
  const username = `gate_admin_${userId.slice(0, 8)}`
  const password = 'gate-login-secret'
  database.prepare(
    `INSERT INTO user_account (user_id, username, password_hash, role, display_name, status)
     VALUES (?, ?, ?, 'ADMIN', 'Gate 管理员', 'ACTIVE')`
  ).run(userId, username, hashPassword(password))
  const issued = issuePasswordAuthSession(database, { userId, role: 'ADMIN', displayName: 'Gate 管理员' })
  bindAuthSessionToSender(senderId, issued.rawToken)
  return { userId, username, password }
}

function postCommit(
  commandType: string,
  publicResult: Record<string, unknown>,
  actor: CommandActor,
  senderId = SENDER_ID
): void {
  applyGateOnlyPostCommitBinding({
    commandType,
    publicResult: publicResult as never,
    actor,
    senderId,
    bindingOwnerId: 'm5b-gate-test'
  })
}

describe('M5B-7 gate-only executor', () => {
  beforeEach(() => clearAuthSessionBinding(SENDER_ID))

  it('runs all ten commands in the common fenced IMMEDIATE executor without a domain batch', async () => {
    const { database, store, coordinator, executor } = await createHarness()
    const admin = seedAdmin(database)
    const clientInstanceId = uuidv4()

    const execute = async (commandType: string, rawInput: unknown) => {
      const accepted = await coordinator.accept({
        commandType,
        rawInput,
        transport: { source: 'IPC', transportId: `gate-${commandType}` },
        transportMetadata: metadata(clientInstanceId)
      })
      expect(accepted.status).toBe('ACCEPTED')
      if (accepted.status !== 'ACCEPTED') throw new Error(`unexpected replay for ${commandType}`)
      const completed = executor.execute(accepted, ({ envelope }) => applyGateOnlyCommand(database, envelope, {
        senderId: SENDER_ID
      }))
      postCommit(commandType, completed.publicResult as Record<string, unknown>, accepted.envelope.actor)
      return { accepted, completed }
    }

    const login = await execute('auth:login', { username: admin.username, password: admin.password })
    expect(login.completed.publicResult).toMatchObject({ success: true, userId: admin.userId, role: 'ADMIN' })
    expect(resolveBoundAuthSessionSnapshot(database, SENDER_ID)).toMatchObject({ success: true, userId: admin.userId })

    const teacher = await execute('auth:createTeacherAccount', {
      username: 'm5b_gate_teacher', password: 'teacher-password', displayName: 'M5B Gate 教师'
    })
    expect(teacher.completed.publicResult).toMatchObject({ success: true })
    const teacherId = (teacher.completed.publicResult.account as { userId: string }).userId

    await execute('auth:setTeacherAccountStatus', { teacherUserId: teacherId, status: 'DISABLED' })
    expect(database.prepare('SELECT status FROM user_account WHERE user_id = ?').get(teacherId)).toMatchObject({ status: 'DISABLED' })

    const createdStudent = await execute('student:create', {
      username: 'm5b_gate_student', password: 'student-password', studentName: 'M5B 学生'
    })
    const studentId = (createdStudent.completed.publicResult as { studentId: string }).studentId
    await execute('student:update', { studentId, patch: { studentName: 'M5B 学生更新' } })
    await execute('student:archive', { studentId })
    expect(database.prepare('SELECT status, student_name FROM student_profile WHERE student_id = ?').get(studentId))
      .toMatchObject({ status: 'ARCHIVED', student_name: 'M5B 学生更新' })

    const strategy = baseStrategyInput({
      strategyId: 'm5b-gate-strategy', jobCode: 'M5B_GATE_JOB', strategyName: 'M5B Gate 策略'
    })
    await execute('strategy:createVersion', { strategy })
    await execute('strategy:update', {
      strategyId: strategy.strategyId, version: strategy.version, patch: { strategyName: 'M5B Gate 策略更新' }
    })
    await execute('strategy:setActive', {
      strategyId: strategy.strategyId, version: strategy.version, isActive: false
    })
    expect(database.prepare('SELECT strategy_name, is_active FROM strategy_config WHERE strategy_id = ?').get(strategy.strategyId))
      .toMatchObject({ strategy_name: 'M5B Gate 策略更新', is_active: 0 })

    const logoutMetadata = metadata(clientInstanceId)
    const logout = await coordinator.accept({
      commandType: 'auth:logout', rawInput: {},
      transport: { source: 'IPC', transportId: 'gate-logout' }, transportMetadata: logoutMetadata
    })
    expect(logout.status).toBe('ACCEPTED')
    if (logout.status !== 'ACCEPTED') throw new Error('logout must be accepted')
    const loggedOut = executor.execute(logout, ({ envelope }) => applyGateOnlyCommand(database, envelope, {
      senderId: SENDER_ID
    }))
    postCommit('auth:logout', loggedOut.publicResult as Record<string, unknown>, logout.envelope.actor)
    expect(resolveBoundAuthSessionSnapshot(database, SENDER_ID)).toEqual({ success: false, errorCode: 'AUTH_REQUIRED' })

    const logoutReplay = await coordinator.accept({
      commandType: 'auth:logout', rawInput: {},
      transport: { source: 'IPC', transportId: 'gate-logout-replay' }, transportMetadata: logoutMetadata
    })
    expect(logoutReplay).toMatchObject({ status: 'REPLAYED', publicResult: { success: true } })

    await expect(coordinator.accept({
      commandType: 'auth:login', rawInput: { username: admin.username, password: admin.password },
      transport: { source: 'IPC', transportId: 'cross-command-replay' }, transportMetadata: logoutMetadata
    })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })

    expect(database.prepare('SELECT COUNT(*) AS count FROM applied_event_batch').get()).toMatchObject({ count: 0 })
    expect(database.prepare('SELECT COUNT(*) AS count FROM processed_event').get()).toMatchObject({ count: 0 })
    expect(store.listProcessing()).toEqual([])
    expect(database.prepare('SELECT COUNT(*) AS count FROM command_log WHERE status = \'SUCCEEDED\'').get())
      .toMatchObject({ count: 10 })
    database.close()
  })

  it('persists secret-free login replay and restores its auth_session_id binding after a local restart', async () => {
    const { database, coordinator, executor } = await createHarness()
    const admin = seedAdmin(database)
    const clientInstanceId = uuidv4()
    const loginMetadata = metadata(clientInstanceId)
    const accepted = await coordinator.accept({
      commandType: 'auth:login', rawInput: { username: admin.username, password: admin.password },
      transport: { source: 'IPC', transportId: 'login-initial' }, transportMetadata: loginMetadata
    })
    if (accepted.status !== 'ACCEPTED') throw new Error('login must be accepted')
    const completed = executor.execute(accepted, ({ envelope }) => applyGateOnlyCommand(database, envelope, {
      senderId: SENDER_ID
    }))
    postCommit('auth:login', completed.publicResult as Record<string, unknown>, accepted.envelope.actor)

    const stored = database.prepare('SELECT request_hash, result_json FROM command_log WHERE command_id = ?')
      .get(accepted.envelope.commandId) as { request_hash: string; result_json: string }
    expect(JSON.stringify(stored)).not.toContain(admin.password)
    expect(JSON.stringify(stored)).not.toContain('token')

    clearAuthSessionBinding(SENDER_ID)
    const replay = await coordinator.accept({
      commandType: 'auth:login', rawInput: { username: admin.username, password: admin.password },
      transport: { source: 'IPC', transportId: 'login-replay' }, transportMetadata: loginMetadata
    })
    expect(replay.status).toBe('REPLAYED')
    if (replay.status !== 'REPLAYED') throw new Error('login must replay')
    postCommit('auth:login', replay.publicResult as Record<string, unknown>, { kind: 'UNAUTHENTICATED' })
    expect(resolveBoundAuthSessionSnapshot(database, SENDER_ID)).toMatchObject({ success: true, userId: admin.userId })
    database.close()
  })

  it('persists disabled-login rejection and fails closed after its persistent session is revoked', async () => {
    const { database, store, coordinator, executor } = await createHarness()
    const admin = seedAdmin(database)
    const clientInstanceId = uuidv4()
    database.prepare("UPDATE user_account SET status = 'DISABLED' WHERE user_id = ?").run(admin.userId)

    const disabledMetadata = metadata(clientInstanceId)
    const disabledLogin = await coordinator.accept({
      commandType: 'auth:login', rawInput: { username: admin.username, password: admin.password },
      transport: { source: 'IPC', transportId: 'disabled-login' }, transportMetadata: disabledMetadata
    })
    if (disabledLogin.status !== 'ACCEPTED') throw new Error('disabled login must be accepted for durable completion')
    const disabledResult = executor.execute(disabledLogin, ({ envelope }) => applyGateOnlyCommand(database, envelope, {
      senderId: SENDER_ID
    }))
    expect(disabledResult.publicResult).toEqual({ success: false, errorCode: 'ACCOUNT_DISABLED' })
    expect(store.findByCommandId(disabledLogin.envelope.commandId)).toMatchObject({ status: 'SUCCEEDED' })

    const disabledReplay = await coordinator.accept({
      commandType: 'auth:login', rawInput: { username: admin.username, password: admin.password },
      transport: { source: 'IPC', transportId: 'disabled-login-replay' }, transportMetadata: disabledMetadata
    })
    expect(disabledReplay).toMatchObject({
      status: 'REPLAYED', publicResult: { success: false, errorCode: 'ACCOUNT_DISABLED' }
    })

    database.prepare("UPDATE user_account SET status = 'ACTIVE' WHERE user_id = ?").run(admin.userId)
    const activeLogin = await coordinator.accept({
      commandType: 'auth:login', rawInput: { username: admin.username, password: admin.password },
      transport: { source: 'IPC', transportId: 'active-login' }, transportMetadata: metadata(clientInstanceId)
    })
    if (activeLogin.status !== 'ACCEPTED') throw new Error('active login must be accepted')
    const activeResult = executor.execute(activeLogin, ({ envelope }) => applyGateOnlyCommand(database, envelope, {
      senderId: SENDER_ID
    }))
    postCommit('auth:login', activeResult.publicResult as Record<string, unknown>, activeLogin.envelope.actor)
    const authSessionId = (activeResult.publicResult as { authSessionId: string }).authSessionId
    revokeAuthSessionById(database, authSessionId, 'TEST_REVOKED')

    await expect(coordinator.accept({
      commandType: 'auth:createTeacherAccount',
      rawInput: { username: 'must_not_create', password: 'teacher-password', displayName: '禁止创建' },
      transport: { source: 'IPC', transportId: 'revoked-actor' }, transportMetadata: metadata(clientInstanceId)
    })).rejects.toMatchObject({ code: 'INVALID_ACTOR' })
    expect(database.prepare("SELECT COUNT(*) AS count FROM user_account WHERE username = 'must_not_create'").get())
      .toMatchObject({ count: 0 })
    database.close()
  })

  it('matches the frozen legacy service oracle across all ten gate-only command paths', async () => {
    const legacySenderId = SENDER_ID + 1
    const gateSenderId = SENDER_ID + 2
    const legacy = await createTestDb()
    const gate = await createHarness(gateSenderId)
    legacy.exec('PRAGMA foreign_keys = ON;')
    for (const database of [legacy, gate.database]) {
      seedAuthErrorCodes(database)
      seedStudentErrorCodes(database)
      seedStrategyErrorCodes(database)
    }
    const legacyAdmin = seedAdmin(legacy, legacySenderId)
    const gateAdmin = seedAdmin(gate.database, gateSenderId)
    // Both databases deliberately use the same account identity; generated
    // teacher/student/session IDs are normalized below as infrastructure IDs.
    gate.database.prepare('DELETE FROM auth_session').run()
    gate.database.prepare('DELETE FROM user_account WHERE user_id = ?').run(gateAdmin.userId)
    gate.database.prepare(
      `INSERT INTO user_account (user_id, username, password_hash, role, display_name, status)
       VALUES (?, ?, ?, 'ADMIN', 'Gate 管理员', 'ACTIVE')`
    ).run(legacyAdmin.userId, legacyAdmin.username, hashPassword(legacyAdmin.password))
    const gateBootstrap = issuePasswordAuthSession(gate.database, {
      userId: legacyAdmin.userId, role: 'ADMIN', displayName: 'Gate 管理员'
    })
    bindAuthSessionToSender(gateSenderId, gateBootstrap.rawToken)

    const clientInstanceId = uuidv4()
    const gateResults: object[] = []
    const runGate = async (commandType: string, rawInput: unknown) => {
      const accepted = await gate.coordinator.accept({
        commandType,
        rawInput,
        transport: { source: 'IPC', transportId: `differential-${commandType}` },
        transportMetadata: metadata(clientInstanceId)
      })
      if (accepted.status !== 'ACCEPTED') throw new Error(`unexpected differential replay: ${commandType}`)
      const completed = gate.executor.execute(accepted, ({ envelope }) => applyGateOnlyCommand(gate.database, envelope, {
        senderId: gateSenderId
      }))
      postCommit(commandType, completed.publicResult as Record<string, unknown>, accepted.envelope.actor, gateSenderId)
      gateResults.push(completed.publicResult)
      return completed.publicResult as Record<string, unknown>
    }

    const legacyResults: object[] = []
    const legacyLogin = executeLoginCommand(legacy, {
      username: legacyAdmin.username, password: legacyAdmin.password
    }, { senderId: legacySenderId })
    legacyResults.push(legacyLogin)
    await runGate('auth:login', { username: legacyAdmin.username, password: legacyAdmin.password })

    const legacyTeacher = createTeacherAccount(legacy, {
      callerUserId: legacyAdmin.userId, callerRole: 'ADMIN',
      username: 'diff_teacher', password: 'teacher-password', displayName: '差分教师'
    })
    legacyResults.push(legacyTeacher)
    const gateTeacher = await runGate('auth:createTeacherAccount', {
      username: 'diff_teacher', password: 'teacher-password', displayName: '差分教师'
    })
    if (!legacyTeacher.success || !gateTeacher.success) throw new Error('teacher creation must succeed')

    legacyResults.push(setTeacherAccountStatus(legacy, {
      callerUserId: legacyAdmin.userId, callerRole: 'ADMIN', teacherUserId: legacyTeacher.account.userId, status: 'DISABLED'
    }))
    await runGate('auth:setTeacherAccountStatus', { teacherUserId: (gateTeacher.account as { userId: string }).userId, status: 'DISABLED' })

    const studentInput = { username: 'diff_student', password: 'student-password', studentName: '差分学生' }
    const legacyStudent = createStudent(legacy, { callerUserId: legacyAdmin.userId, callerRole: 'ADMIN', ...studentInput })
    legacyResults.push(legacyStudent)
    const gateStudent = await runGate('student:create', studentInput)
    if (!legacyStudent.success || !gateStudent.success) throw new Error('student creation must succeed')

    legacyResults.push(updateStudent(legacy, {
      callerUserId: legacyAdmin.userId, callerRole: 'ADMIN', studentId: legacyStudent.studentId, patch: { studentName: '差分学生更新' }
    }))
    await runGate('student:update', { studentId: gateStudent.studentId as string, patch: { studentName: '差分学生更新' } })
    legacyResults.push(archiveStudent(legacy, {
      callerUserId: legacyAdmin.userId, callerRole: 'ADMIN', studentId: legacyStudent.studentId
    }))
    await runGate('student:archive', { studentId: gateStudent.studentId as string })

    const strategy = baseStrategyInput({ strategyId: 'differential-gate-strategy', jobCode: 'DIFFERENTIAL_GATE_JOB' })
    legacyResults.push(createVersion(legacy, { callerUserId: legacyAdmin.userId, callerRole: 'ADMIN', strategy }))
    await runGate('strategy:createVersion', { strategy })
    legacyResults.push(updateStrategy(legacy, {
      callerUserId: legacyAdmin.userId, callerRole: 'ADMIN', strategyId: strategy.strategyId, version: strategy.version,
      patch: { strategyName: '差分策略更新' }
    }))
    await runGate('strategy:update', {
      strategyId: strategy.strategyId, version: strategy.version, patch: { strategyName: '差分策略更新' }
    })
    legacyResults.push(setActive(legacy, {
      callerUserId: legacyAdmin.userId, callerRole: 'ADMIN', strategyId: strategy.strategyId, version: strategy.version, isActive: false
    }))
    await runGate('strategy:setActive', { strategyId: strategy.strategyId, version: strategy.version, isActive: false })

    legacyResults.push(executeLogoutCommand(legacy, legacySenderId))
    await runGate('auth:logout', {})

    const normalizeResult = (value: object) => {
      const normalized = JSON.parse(JSON.stringify(value)) as Record<string, unknown>
      delete normalized.studentId
      delete normalized.authSessionId
      delete normalized.expiresAt
      if (normalized.account && typeof normalized.account === 'object') {
        delete (normalized.account as Record<string, unknown>).userId
        delete (normalized.account as Record<string, unknown>).createdAt
        delete (normalized.account as Record<string, unknown>).updatedAt
      }
      return normalized
    }
    expect(gateResults.map(normalizeResult)).toEqual(legacyResults.map(normalizeResult))

    const projection = (database: MemoryAdapter) => ({
      accounts: database.prepare('SELECT username, role, display_name, status FROM user_account ORDER BY username').all(),
      students: database.prepare('SELECT student_name, status FROM student_profile ORDER BY student_name').all(),
      strategies: database.prepare('SELECT strategy_id, version, strategy_name, is_active FROM strategy_config ORDER BY strategy_id, version').all(),
      sessions: database.prepare(
        'SELECT user_id, status, revoke_reason, COUNT(*) AS count FROM auth_session GROUP BY user_id, status, revoke_reason ORDER BY user_id, status'
      ).all(),
      audits: database.prepare('SELECT error_code, severity, COUNT(*) AS count FROM error_event_log GROUP BY error_code, severity ORDER BY error_code').all()
    })
    expect(projection(gate.database)).toEqual(projection(legacy))
    expect(gate.database.prepare('SELECT COUNT(*) AS count FROM applied_event_batch').get()).toMatchObject({ count: 0 })
    expect(gate.store.listProcessing()).toEqual([])

    clearAuthSessionBinding(legacySenderId)
    clearAuthSessionBinding(gateSenderId)
    legacy.close()
    gate.database.close()
  })

  it('rolls back gate DML and leaves no canonical result when the IMMEDIATE transaction fails', async () => {
    const { database, store, coordinator, executor } = await createHarness()
    const admin = seedAdmin(database)
    database.exec('CREATE TABLE gate_rollback_probe (id TEXT PRIMARY KEY);')
    const accepted = await coordinator.accept({
      commandType: 'auth:login', rawInput: { username: admin.username, password: admin.password },
      transport: { source: 'IPC', transportId: 'rollback' }, transportMetadata: metadata(uuidv4())
    })
    if (accepted.status !== 'ACCEPTED') throw new Error('login must be accepted')
    expect(() => executor.execute(accepted as DurableCommandAccepted<unknown>, () => {
      database.prepare("INSERT INTO gate_rollback_probe (id) VALUES ('rolled-back')").run()
      throw new Error('injected gate failure')
    })).toThrow('injected gate failure')
    expect(database.prepare('SELECT COUNT(*) AS count FROM gate_rollback_probe').get()).toMatchObject({ count: 0 })
    expect(store.findByCommandId(accepted.envelope.commandId)).toMatchObject({ status: 'PROCESSING', resultJson: null })
    database.close()
  })
})
