import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import {
  seedAuthErrorCodes,
  loginWithPassword,
  getCurrentSession,
  logoutCurrentSession,
  listAccounts,
  createTeacherAccount,
  setTeacherAccountStatus
} from '../auth'
import { resolveTrustedStudentCaller, seedStudentErrorCodes } from '../student'
import { resolveTrustedStrategyCaller } from '../strategy'
import { createTestDb } from '../../../db/test-helpers'
import { hashPassword } from '../../../utils/password'
import {
  bindAuthSessionToSender,
  clearAuthSessionBinding,
  issuePasswordAuthSession,
  resolveTrustedAuthSessionCaller
} from '../../../utils/auth-session'
import type { MemoryAdapter } from '../../../db/memory-adapter'
import type { AuthRole } from '../../../../shared/types/auth'

let db: MemoryAdapter

const SENDER_ID = 9001

function seedUser(role: AuthRole, status: 'ACTIVE' | 'DISABLED' = 'ACTIVE') {
  const userId = uuidv4()
  const username = `${role.toLowerCase()}_${userId.slice(0, 8)}`
  const password = 'pwd-123456'
  db.prepare(
    `INSERT INTO user_account
       (user_id, username, password_hash, role, display_name, status)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(userId, username, hashPassword(password), role, `${role} 用户`, status)
  return { userId, username, password, displayName: `${role} 用户` }
}

beforeAll(async () => {
  db = await createTestDb()
})

afterAll(() => {
  db.close()
})

beforeEach(() => {
  clearAuthSessionBinding(SENDER_ID)
  db.exec('DELETE FROM error_event_log')
  db.exec('DELETE FROM auth_session')
  db.exec('DELETE FROM student_profile')
  db.exec('DELETE FROM user_account')
  seedAuthErrorCodes(db)
  seedStudentErrorCodes(db)
})

describe('auth password session', () => {
  it('登录成功：返回公开会话信息，并创建 PASSWORD auth_session', () => {
    const teacher = seedUser('TEACHER')

    const result = loginWithPassword(db, {
      username: teacher.username,
      password: teacher.password
    })

    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.response.userId).toBe(teacher.userId)
    expect(result.response.role).toBe('TEACHER')
    expect(result.response.authSessionId).toBeTruthy()

    const row = db
      .prepare(
        `SELECT auth_method, status, user_id, capabilities_json
         FROM auth_session
         WHERE auth_session_id = ?`
      )
      .get(result.response.authSessionId) as {
      auth_method: string
      status: string
      user_id: string
      capabilities_json: string
    }

    expect(row.auth_method).toBe('PASSWORD')
    expect(row.status).toBe('ACTIVE')
    expect(row.user_id).toBe(teacher.userId)
    expect(JSON.parse(row.capabilities_json)).toContain('TEACHER_WORKSPACE')
  })

  it('密码错误 → INVALID_CREDENTIALS', () => {
    const teacher = seedUser('TEACHER')
    const result = loginWithPassword(db, {
      username: teacher.username,
      password: 'wrong-password'
    })

    expect(result).toEqual({
      success: false,
      response: { success: false, errorCode: 'INVALID_CREDENTIALS' }
    })
  })

  it('停用账号 → ACCOUNT_DISABLED', () => {
    const teacher = seedUser('TEACHER', 'DISABLED')
    const result = loginWithPassword(db, {
      username: teacher.username,
      password: teacher.password
    })

    expect(result).toEqual({
      success: false,
      response: { success: false, errorCode: 'ACCOUNT_DISABLED' }
    })
  })
})

describe('auth current session / logout', () => {
  it('已绑定会话可恢复；退出后撤销并清除绑定', () => {
    const admin = seedUser('ADMIN')
    const login = loginWithPassword(db, {
      username: admin.username,
      password: admin.password
    })
    if (!login.success) throw new Error('expected login success')

    bindAuthSessionToSender(SENDER_ID, login.rawToken)

    const restored = getCurrentSession(db, SENDER_ID)
    expect(restored.success).toBe(true)
    if (!restored.success) return
    expect(restored.role).toBe('ADMIN')
    expect(restored.userId).toBe(admin.userId)

    expect(logoutCurrentSession(db, SENDER_ID)).toEqual({ success: true })

    const revoked = db
      .prepare('SELECT status, revoke_reason FROM auth_session WHERE auth_session_id = ?')
      .get(restored.authSessionId) as { status: string; revoke_reason: string | null }
    expect(revoked.status).toBe('REVOKED')
    expect(revoked.revoke_reason).toBe('USER_LOGOUT')

    expect(getCurrentSession(db, SENDER_ID)).toEqual({
      success: false,
      errorCode: 'AUTH_REQUIRED'
    })
  })

  it('过期会话恢复失败，并被标记为 EXPIRED', () => {
    const teacher = seedUser('TEACHER')
    const issued = issuePasswordAuthSession(db, {
      userId: teacher.userId,
      role: 'TEACHER',
      displayName: teacher.displayName
    })
    db.prepare(`UPDATE auth_session SET expires_at = datetime('now', '-1 minute') WHERE auth_session_id = ?`).run(
      issued.snapshot.authSessionId
    )
    bindAuthSessionToSender(SENDER_ID, issued.rawToken)

    expect(getCurrentSession(db, SENDER_ID)).toEqual({
      success: false,
      errorCode: 'SESSION_EXPIRED'
    })

    const row = db
      .prepare('SELECT status FROM auth_session WHERE auth_session_id = ?')
      .get(issued.snapshot.authSessionId) as { status: string }
    expect(row.status).toBe('EXPIRED')
  })

  it('账号停用后，会话恢复失败并撤销', () => {
    const teacher = seedUser('TEACHER')
    const issued = issuePasswordAuthSession(db, {
      userId: teacher.userId,
      role: 'TEACHER',
      displayName: teacher.displayName
    })
    bindAuthSessionToSender(SENDER_ID, issued.rawToken)
    db.prepare(`UPDATE user_account SET status = 'DISABLED' WHERE user_id = ?`).run(teacher.userId)

    expect(getCurrentSession(db, SENDER_ID)).toEqual({
      success: false,
      errorCode: 'ACCOUNT_DISABLED'
    })

    const row = db
      .prepare('SELECT status, revoke_reason FROM auth_session WHERE auth_session_id = ?')
      .get(issued.snapshot.authSessionId) as { status: string; revoke_reason: string | null }
    expect(row.status).toBe('REVOKED')
    expect(row.revoke_reason).toBe('ACCOUNT_DISABLED')
  })
})

describe('auth:listAccounts', () => {
  it('ADMIN 可读取不含密码或会话令牌的账号摘要', () => {
    const admin = seedUser('ADMIN')
    const teacher = seedUser('TEACHER')
    const result = listAccounts(db, { callerUserId: admin.userId, callerRole: 'ADMIN' })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.accounts.map((account) => account.userId)).toEqual(
      expect.arrayContaining([admin.userId, teacher.userId])
    )
    expect(result.accounts[0]).not.toHaveProperty('passwordHash')
    expect(result.accounts[0]).not.toHaveProperty('tokenHash')
  })

  it.each(['TEACHER', 'STUDENT'] as const)('%s 不能读取账号列表', (role) => {
    const caller = seedUser(role)
    expect(listAccounts(db, { callerUserId: caller.userId, callerRole: role })).toEqual({
      success: false,
      errorCode: 'FORBIDDEN'
    })
  })

  it('绑定教师会话时，伪造 ADMIN 身份仍被拒绝', () => {
    const teacher = seedUser('TEACHER')
    const issued = issuePasswordAuthSession(db, {
      userId: teacher.userId,
      role: 'TEACHER',
      displayName: teacher.displayName
    })
    bindAuthSessionToSender(SENDER_ID, issued.rawToken)

    const trusted = resolveTrustedAuthSessionCaller(db, SENDER_ID, {
      callerUserId: 'forged-admin-id',
      callerRole: 'ADMIN'
    })
    expect(trusted.ok).toBe(true)
    if (!trusted.ok) return
    expect(listAccounts(db, trusted.params)).toEqual({ success: false, errorCode: 'FORBIDDEN' })
  })
})

describe('auth:createTeacherAccount', () => {
  it('ADMIN 创建 ACTIVE TEACHER 账号，返回值不含密码哈希', () => {
    const admin = seedUser('ADMIN')
    const result = createTeacherAccount(db, {
      callerUserId: admin.userId,
      callerRole: 'ADMIN',
      username: 'new_teacher',
      password: 'initial-password',
      displayName: '新教师'
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.account).toMatchObject({
      username: 'new_teacher',
      role: 'TEACHER',
      displayName: '新教师',
      status: 'ACTIVE'
    })
    expect(result.account).not.toHaveProperty('passwordHash')
    const row = db
      .prepare('SELECT role, status, password_hash FROM user_account WHERE user_id = ?')
      .get(result.account.userId) as { role: string; status: string; password_hash: string }
    expect(row.role).toBe('TEACHER')
    expect(row.status).toBe('ACTIVE')
    expect(row.password_hash).not.toBe('initial-password')
  })

  it('重复用户名 → USERNAME_TAKEN', () => {
    const admin = seedUser('ADMIN')
    seedUser('TEACHER')
    const existing = db.prepare("SELECT username FROM user_account WHERE role = 'TEACHER'").get() as { username: string }
    expect(
      createTeacherAccount(db, {
        callerUserId: admin.userId,
        callerRole: 'ADMIN',
        username: existing.username,
        password: 'initial-password',
        displayName: '重复教师'
      })
    ).toEqual({ success: false, errorCode: 'USERNAME_TAKEN' })
  })

  it.each(['TEACHER', 'STUDENT'] as const)('%s 不能创建教师账号', (role) => {
    const caller = seedUser(role)
    expect(
      createTeacherAccount(db, {
        callerUserId: caller.userId,
        callerRole: role,
        username: 'new_teacher',
        password: 'initial-password',
        displayName: '新教师'
      })
    ).toEqual({ success: false, errorCode: 'FORBIDDEN' })
  })
})

describe('auth:setTeacherAccountStatus', () => {
  it('停用教师会立即撤销有效会话；重新启用不恢复旧会话', () => {
    const admin = seedUser('ADMIN')
    const teacher = seedUser('TEACHER')
    const issued = issuePasswordAuthSession(db, {
      userId: teacher.userId,
      role: 'TEACHER',
      displayName: teacher.displayName
    })
    bindAuthSessionToSender(SENDER_ID, issued.rawToken)

    const disabled = setTeacherAccountStatus(db, {
      callerUserId: admin.userId,
      callerRole: 'ADMIN',
      teacherUserId: teacher.userId,
      status: 'DISABLED'
    })
    expect(disabled).toMatchObject({
      success: true,
      revokedSessionCount: 1,
      account: { status: 'DISABLED' }
    })
    const revoked = db
      .prepare('SELECT status, revoke_reason FROM auth_session WHERE auth_session_id = ?')
      .get(issued.snapshot.authSessionId) as { status: string; revoke_reason: string }
    expect(revoked).toEqual({ status: 'REVOKED', revoke_reason: 'ACCOUNT_DISABLED_BY_ADMIN' })

    const enabled = setTeacherAccountStatus(db, {
      callerUserId: admin.userId,
      callerRole: 'ADMIN',
      teacherUserId: teacher.userId,
      status: 'ACTIVE'
    })
    expect(enabled).toMatchObject({ success: true, revokedSessionCount: 0, account: { status: 'ACTIVE' } })
    expect(getCurrentSession(db, SENDER_ID)).toEqual({ success: false, errorCode: 'SESSION_REVOKED' })
  })

  it.each(['TEACHER', 'STUDENT'] as const)('%s 不能改变教师账号状态', (role) => {
    const caller = seedUser(role)
    const teacher = seedUser('TEACHER')
    expect(
      setTeacherAccountStatus(db, {
        callerUserId: caller.userId,
        callerRole: role,
        teacherUserId: teacher.userId,
        status: 'DISABLED'
      })
    ).toEqual({ success: false, errorCode: 'FORBIDDEN' })
  })

  it('非教师账号不能由教师维护接口修改', () => {
    const admin = seedUser('ADMIN')
    const student = seedUser('STUDENT')
    expect(
      setTeacherAccountStatus(db, {
        callerUserId: admin.userId,
        callerRole: 'ADMIN',
        teacherUserId: student.userId,
        status: 'DISABLED'
      })
    ).toEqual({ success: false, errorCode: 'NOT_FOUND' })
  })
})

describe('admin account management trusted caller', () => {
  it('绑定教师会话时，伪造 ADMIN 身份不能创建或停用教师账号', () => {
    const teacher = seedUser('TEACHER')
    const targetTeacher = seedUser('TEACHER')
    const issued = issuePasswordAuthSession(db, {
      userId: teacher.userId,
      role: 'TEACHER',
      displayName: teacher.displayName
    })
    bindAuthSessionToSender(SENDER_ID, issued.rawToken)

    const trusted = resolveTrustedAuthSessionCaller(db, SENDER_ID, {
      callerUserId: 'forged-admin-id',
      callerRole: 'ADMIN'
    })
    expect(trusted.ok).toBe(true)
    if (!trusted.ok) return

    expect(
      createTeacherAccount(db, {
        ...trusted.params,
        username: 'forged_teacher',
        password: 'initial-password',
        displayName: '伪造教师'
      })
    ).toEqual({ success: false, errorCode: 'FORBIDDEN' })
    expect(
      setTeacherAccountStatus(db, {
        ...trusted.params,
        teacherUserId: targetTeacher.userId,
        status: 'DISABLED'
      })
    ).toEqual({ success: false, errorCode: 'FORBIDDEN' })
  })
})

describe('student wrapper trusted caller', () => {
  it('忽略前端伪造的 callerUserId/callerRole，改用绑定教师会话', () => {
    const teacher = seedUser('TEACHER')
    const issued = issuePasswordAuthSession(db, {
      userId: teacher.userId,
      role: 'TEACHER',
      displayName: teacher.displayName
    })
    bindAuthSessionToSender(SENDER_ID, issued.rawToken)

    const resolved = resolveTrustedStudentCaller(db, SENDER_ID, {
      callerUserId: 'forged-admin-id',
      callerRole: 'ADMIN',
      studentId: 'student-1'
    })

    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.params.callerUserId).toBe(teacher.userId)
    expect(resolved.params.callerRole).toBe('TEACHER')
  })

  it('绑定学生会话时，student:* 管理调用被拒绝', () => {
    const student = seedUser('STUDENT')
    const issued = issuePasswordAuthSession(db, {
      userId: student.userId,
      role: 'STUDENT',
      displayName: student.displayName
    })
    bindAuthSessionToSender(SENDER_ID, issued.rawToken)

    expect(
      resolveTrustedStudentCaller(db, SENDER_ID, {
        callerUserId: student.userId,
        callerRole: 'ADMIN',
        studentId: 'student-1'
      })
    ).toEqual({
      ok: false,
      errorCode: 'FORBIDDEN'
    })
  })
})

describe('strategy wrapper trusted caller', () => {
  it('忽略前端伪造的 callerUserId/callerRole，改用绑定教师会话', () => {
    const teacher = seedUser('TEACHER')
    const issued = issuePasswordAuthSession(db, {
      userId: teacher.userId,
      role: 'TEACHER',
      displayName: teacher.displayName
    })
    bindAuthSessionToSender(SENDER_ID, issued.rawToken)

    const resolved = resolveTrustedStrategyCaller(db, SENDER_ID, {
      callerUserId: 'forged-admin-id',
      callerRole: 'ADMIN',
      strategyId: 'strategy-1'
    })

    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.params.callerUserId).toBe(teacher.userId)
    expect(resolved.params.callerRole).toBe('TEACHER')
  })
})

describe('assessment / training / assignment wrapper trusted caller', () => {
  it('忽略伪造管理员身份，改用绑定学生会话', () => {
    const student = seedUser('STUDENT')
    const issued = issuePasswordAuthSession(db, {
      userId: student.userId,
      role: 'STUDENT',
      displayName: student.displayName
    })
    bindAuthSessionToSender(SENDER_ID, issued.rawToken)

    const resolved = resolveTrustedAuthSessionCaller(db, SENDER_ID, {
      callerUserId: 'forged-admin-id',
      callerRole: 'ADMIN',
      sessionId: 'session-1'
    })

    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.params.callerUserId).toBe(student.userId)
    expect(resolved.params.callerRole).toBe('STUDENT')
  })
})
