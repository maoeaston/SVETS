import { v4 as uuidv4 } from 'uuid'
import type { DBAdapter } from '../../db/interface'
import { assertCaller } from '../../utils/auth-context'
import { hashPassword, verifyPassword } from '../../utils/password'
import {
  runGateOnlyTransaction,
  type GateOnlyTransactionOptions
} from './gate-only-transaction'
import {
  clearAuthSessionBinding,
  issuePasswordAuthSession,
  replaceSenderAuthSession,
  resolveBoundAuthSessionSnapshot,
  revokeAuthSessionById,
  revokeBoundAuthSession,
  revokeAuthSessionByToken
} from '../../utils/auth-session'
import type {
  AuthRole,
  CurrentSessionResult,
  AccountSummary,
  CreateTeacherAccountParams,
  CreateTeacherAccountResult,
  SetTeacherAccountStatusParams,
  SetTeacherAccountStatusResult,
  ListAccountsParams,
  ListAccountsResult,
  LoginParams,
  LoginResult,
  LogoutResult
} from '../../../shared/types/auth'

type UserRow = {
  user_id: string
  password_hash: string
  role: string
  display_name: string
  status: string
}

type AccountRow = {
  user_id: string
  username: string
  role: string
  display_name: string
  status: string
  created_at: string
  updated_at: string
}

type InternalLoginResult =
  | { success: true; response: LoginResult & { success: true }; rawToken: string }
  | { success: false; response: Exclude<LoginResult, { success: true }> }

export function seedAuthErrorCodes(db: DBAdapter): void {
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO error_code_registry
       (error_code, error_category, severity, priority_level, title, default_message, is_blocking)
     VALUES (?, 'AUTH', ?, ?, ?, ?, 0)`
  )
  const codes: Array<[string, 'INFO' | 'WARN', 'P3', string, string]> = [
    ['AUTH_LOGIN_SUCCESS', 'INFO', 'P3', '登录成功', '用户登录成功。'],
    ['AUTH_LOGIN_FAILED', 'WARN', 'P3', '登录失败', '用户名或密码错误，或账号已停用。'],
    ['AUTH_LOGOUT_SUCCESS', 'INFO', 'P3', '退出成功', '用户会话已撤销。'],
    ['AUTH_TEACHER_ACCOUNT_CREATED', 'INFO', 'P3', '教师账号创建', '管理员创建教师账号。'],
    ['AUTH_TEACHER_ACCOUNT_CREATE_FAILED', 'WARN', 'P3', '教师账号创建失败', '管理员创建教师账号失败。'],
    ['AUTH_TEACHER_ACCOUNT_DISABLED', 'INFO', 'P3', '教师账号停用', '管理员停用教师账号。'],
    ['AUTH_TEACHER_ACCOUNT_ENABLED', 'INFO', 'P3', '教师账号启用', '管理员重新启用教师账号。']
  ]
  for (const code of codes) {
    stmt.run(...code)
  }
}

function logAuth(db: DBAdapter, code: string, message: string): void {
  try {
    db.prepare(
      `INSERT INTO error_event_log
         (error_event_id, error_code, severity, error_category, message, created_at)
       VALUES (
         ?,
         ?,
         COALESCE((SELECT severity FROM error_code_registry WHERE error_code = ?), 'INFO'),
         'AUTH',
         ?,
         datetime('now')
       )`
    ).run(uuidv4(), code, code, message)
  } catch (err) {
    console.error('[Auth] Failed to write audit log:', err)
  }
}

function normalizeRole(role: string): AuthRole | null {
  if (role === 'STUDENT' || role === 'TEACHER' || role === 'ADMIN') {
    return role
  }
  return null
}

function mapAccountSummary(row: AccountRow): AccountSummary {
  return {
    userId: row.user_id,
    username: row.username,
    role: row.role as AuthRole,
    displayName: row.display_name,
    status: row.status as AccountSummary['status'],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function loginWithPassword(db: DBAdapter, params: LoginParams): InternalLoginResult {
  const row = db
    .prepare(
      `SELECT user_id, password_hash, role, display_name, status
       FROM user_account
       WHERE username = ?`
    )
    .get(params.username) as UserRow | undefined

  if (!row || !verifyPassword(params.password, row.password_hash)) {
    logAuth(db, 'AUTH_LOGIN_FAILED', `Login failed for username: ${params.username}`)
    return {
      success: false,
      response: { success: false, errorCode: 'INVALID_CREDENTIALS' }
    }
  }

  if (row.status !== 'ACTIVE') {
    logAuth(db, 'AUTH_LOGIN_FAILED', `Login rejected: account ${row.user_id} status=${row.status}`)
    return {
      success: false,
      response: { success: false, errorCode: 'ACCOUNT_DISABLED' }
    }
  }

  const role = normalizeRole(row.role)
  if (!role) {
    logAuth(db, 'AUTH_LOGIN_FAILED', `Login rejected: account ${row.user_id} invalid role=${row.role}`)
    return {
      success: false,
      response: { success: false, errorCode: 'SYSTEM_ERROR' }
    }
  }

  const issued = issuePasswordAuthSession(db, {
    userId: row.user_id,
    role,
    displayName: row.display_name
  })

  logAuth(db, 'AUTH_LOGIN_SUCCESS', `User ${row.user_id} (${row.role}) logged in`)
  return {
    success: true,
    rawToken: issued.rawToken,
    response: issued.snapshot
  }
}

export function getCurrentSession(db: DBAdapter, senderId: number): CurrentSessionResult {
  return resolveBoundAuthSessionSnapshot(db, senderId)
}

export function logoutCurrentSession(db: DBAdapter, senderId: number): LogoutResult {
  revokeBoundAuthSession(db, senderId, 'USER_LOGOUT')
  logAuth(db, 'AUTH_LOGOUT_SUCCESS', `Sender ${senderId} logged out`)
  return { success: true }
}

/**
 * 管理员账号维护的只读入口。严禁返回 password_hash、会话 token 或 capabilities。
 */
export function listAccounts(db: DBAdapter, params: ListAccountsParams): ListAccountsResult {
  const caller = assertCaller(db, params.callerUserId, params.callerRole)
  if (!caller.ok || caller.row.role !== 'ADMIN') {
    return { success: false, errorCode: 'FORBIDDEN' }
  }

  const rows = db
    .prepare(
      `SELECT user_id, username, role, display_name, status, created_at, updated_at
       FROM user_account
       ORDER BY created_at DESC, user_id ASC`
    )
    .all() as AccountRow[]

  return { success: true, accounts: rows.map(mapAccountSummary) }
}

export function createTeacherAccount(
  db: DBAdapter,
  params: CreateTeacherAccountParams
): CreateTeacherAccountResult {
  const caller = assertCaller(db, params.callerUserId, params.callerRole)
  if (!caller.ok || caller.row.role !== 'ADMIN') {
    return { success: false, errorCode: 'FORBIDDEN' }
  }

  const username = typeof params.username === 'string' ? params.username.trim() : ''
  const displayName = typeof params.displayName === 'string' ? params.displayName.trim() : ''
  if (username.length === 0 || displayName.length === 0 || typeof params.password !== 'string' || params.password.length === 0) {
    return { success: false, errorCode: 'VALIDATION_ERROR' }
  }

  const account: AccountSummary = {
    userId: uuidv4(),
    username,
    role: 'TEACHER',
    displayName,
    status: 'ACTIVE',
    createdAt: '',
    updatedAt: ''
  }

  try {
    db.prepare(
      `INSERT INTO user_account
         (user_id, username, password_hash, role, display_name, status)
       VALUES (?, ?, ?, 'TEACHER', ?, 'ACTIVE')`
    ).run(account.userId, account.username, hashPassword(params.password), account.displayName)

    const timestamps = db
      .prepare('SELECT created_at, updated_at FROM user_account WHERE user_id = ?')
      .get(account.userId) as { created_at: string; updated_at: string }
    account.createdAt = timestamps.created_at
    account.updatedAt = timestamps.updated_at
    logAuth(db, 'AUTH_TEACHER_ACCOUNT_CREATED', `Admin ${caller.row.user_id} created teacher ${account.userId}`)
    return { success: true, account }
  } catch (err) {
    if (String(err).includes('user_account.username')) {
      return { success: false, errorCode: 'USERNAME_TAKEN' }
    }
    logAuth(db, 'AUTH_TEACHER_ACCOUNT_CREATE_FAILED', `Teacher account creation failed: ${String(err)}`)
    return { success: false, errorCode: 'SYSTEM_ERROR' }
  }
}

export function setTeacherAccountStatus(
  db: DBAdapter,
  params: SetTeacherAccountStatusParams,
  transactionOptions?: GateOnlyTransactionOptions
): SetTeacherAccountStatusResult {
  const caller = assertCaller(db, params.callerUserId, params.callerRole)
  if (!caller.ok || caller.row.role !== 'ADMIN') {
    return { success: false, errorCode: 'FORBIDDEN' }
  }
  if (typeof params.teacherUserId !== 'string' || params.teacherUserId.length === 0) {
    return { success: false, errorCode: 'VALIDATION_ERROR' }
  }
  if (params.status !== 'ACTIVE' && params.status !== 'DISABLED') {
    return { success: false, errorCode: 'VALIDATION_ERROR' }
  }

  const target = db
    .prepare(
      `SELECT user_id, username, role, display_name, status, created_at, updated_at
       FROM user_account
       WHERE user_id = ? AND role = 'TEACHER'`
    )
    .get(params.teacherUserId) as AccountRow | undefined
  if (!target) {
    return { success: false, errorCode: 'NOT_FOUND' }
  }

  let revokedSessionCount = 0
  try {
    runGateOnlyTransaction(db, transactionOptions, () => {
      db.prepare(
        `UPDATE user_account
         SET status = ?, updated_at = datetime('now')
         WHERE user_id = ?`
      ).run(params.status, params.teacherUserId)

      if (params.status === 'DISABLED') {
        const active = db
          .prepare("SELECT COUNT(*) AS count FROM auth_session WHERE user_id = ? AND status = 'ACTIVE'")
          .get(params.teacherUserId) as { count: number }
        revokedSessionCount = active.count
        db.prepare(
          `UPDATE auth_session
           SET status = 'REVOKED', revoke_reason = 'ACCOUNT_DISABLED_BY_ADMIN', updated_at = datetime('now')
           WHERE user_id = ? AND status = 'ACTIVE'`
        ).run(params.teacherUserId)
      }
    })

    const updated = db
      .prepare(
        `SELECT user_id, username, role, display_name, status, created_at, updated_at
         FROM user_account WHERE user_id = ?`
      )
      .get(params.teacherUserId) as AccountRow
    logAuth(
      db,
      params.status === 'DISABLED' ? 'AUTH_TEACHER_ACCOUNT_DISABLED' : 'AUTH_TEACHER_ACCOUNT_ENABLED',
      `Admin ${caller.row.user_id} set teacher ${params.teacherUserId} status=${params.status}`
    )
    return { success: true, account: mapAccountSummary(updated), revokedSessionCount }
  } catch (err) {
    console.error('[Auth] Teacher account status update failed:', err)
    return { success: false, errorCode: 'SYSTEM_ERROR' }
  }
}

/** M5B-7 gate-only path: the accepted actor session is revoked inside the outer IMMEDIATE transaction. */
export function logoutAuthSessionById(db: DBAdapter, authSessionId: string): LogoutResult {
  revokeAuthSessionById(db, authSessionId, 'USER_LOGOUT')
  logAuth(db, 'AUTH_LOGOUT_SUCCESS', `Auth session ${authSessionId} logged out`)
  return { success: true }
}

export interface AuthLoginCommandContext {
  senderId: number
  bindingOwnerId?: string
  trackSender?: (senderId: number, subscribeDestroyed: (release: () => void) => void) => void
  subscribeDestroyed?: (release: () => void) => void
}

export function executeLoginCommand(
  db: DBAdapter,
  params: LoginParams,
  context: AuthLoginCommandContext
): LoginResult {
  try {
    const result = loginWithPassword(db, params)
    if (!result.success) return result.response

    try {
      replaceSenderAuthSession(db, context.senderId, result.rawToken, context.bindingOwnerId ?? null)
      if (context.trackSender && context.subscribeDestroyed) {
        context.trackSender(context.senderId, context.subscribeDestroyed)
      }
    } catch (err) {
      clearAuthSessionBinding(context.senderId)
      revokeAuthSessionByToken(db, result.rawToken, 'BINDING_FAILED')
      console.error('[Auth] Failed to bind sender session:', err)
      return { success: false as const, errorCode: 'SYSTEM_ERROR' as const }
    }

    return result.response
  } catch (err) {
    console.error('[Auth] Login handler failed:', err)
    return { success: false as const, errorCode: 'SYSTEM_ERROR' as const }
  }
}

export function executeLogoutCommand(db: DBAdapter, senderId: number): LogoutResult {
  try {
    return logoutCurrentSession(db, senderId)
  } catch (err) {
    console.error('[Auth] Logout failed:', err)
    return { success: false, errorCode: 'SYSTEM_ERROR' }
  }
}
