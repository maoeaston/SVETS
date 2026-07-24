import { createHash, randomBytes } from 'crypto'
import { v4 as uuidv4 } from 'uuid'
import type { DBAdapter } from '../db/interface'
import type { AuthRole, AuthSessionSnapshot, CurrentSessionResult } from '../../shared/types/auth'

interface SessionRow {
  auth_session_id: string
  user_id: string
  role: string
  display_name: string
  account_status: string
  session_status: string
  expires_at: string
  is_expired: number
}

const boundAuthTokens = new Map<number, string>()

type AuthSessionCallerParams = {
  callerUserId: unknown
  callerRole: unknown
}

function hashToken(rawToken: string): string {
  return createHash('sha256').update(`auth-session:${rawToken}`, 'utf8').digest('hex')
}

function capabilitiesForRole(role: AuthRole): string[] {
  switch (role) {
    case 'ADMIN':
      return ['ADMIN_ACCOUNT_MANAGEMENT', 'ADMIN_STRATEGY_MANAGEMENT', 'TEACHER_WORKSPACE']
    case 'TEACHER':
      return ['TEACHER_WORKSPACE', 'STUDENT_PROFILE_MANAGEMENT']
    case 'STUDENT':
      return ['STUDENT_SELF_SERVICE']
  }
}

function readSessionRowByToken(db: DBAdapter, rawToken: string): SessionRow | undefined {
  return db
    .prepare(
      `SELECT
         s.auth_session_id,
         s.user_id,
         ua.role,
         ua.display_name,
         ua.status AS account_status,
         s.status AS session_status,
         s.expires_at,
         CASE WHEN s.expires_at <= datetime('now') THEN 1 ELSE 0 END AS is_expired
       FROM auth_session s
       JOIN user_account ua ON ua.user_id = s.user_id
       WHERE s.token_hash = ?`
    )
    .get(hashToken(rawToken)) as SessionRow | undefined
}

function toSnapshot(row: SessionRow): AuthSessionSnapshot {
  return {
    success: true,
    authSessionId: row.auth_session_id,
    userId: row.user_id,
    role: row.role as AuthRole,
    displayName: row.display_name,
    expiresAt: row.expires_at
  }
}

function markSessionExpired(db: DBAdapter, authSessionId: string): void {
  db.prepare(
    `UPDATE auth_session
        SET status = 'EXPIRED',
            updated_at = datetime('now')
      WHERE auth_session_id = ?
        AND status = 'ACTIVE'`
  ).run(authSessionId)
}

export function revokeAuthSessionByToken(
  db: DBAdapter,
  rawToken: string,
  reason: string
): void {
  db.prepare(
    `UPDATE auth_session
        SET status = 'REVOKED',
            revoke_reason = ?,
            updated_at = datetime('now')
      WHERE token_hash = ?
        AND status = 'ACTIVE'`
  ).run(reason, hashToken(rawToken))
}

export function issuePasswordAuthSession(
  db: DBAdapter,
  params: { userId: string; role: AuthRole; displayName: string }
): { snapshot: AuthSessionSnapshot; rawToken: string } {
  const authSessionId = uuidv4()
  const rawToken = randomBytes(32).toString('hex')

  db.prepare(
    `INSERT INTO auth_session
       (auth_session_id, user_id, auth_method, capabilities_json,
        token_hash, expires_at, status)
     VALUES (?, ?, 'PASSWORD', ?, ?, datetime('now', '+8 hours'), 'ACTIVE')`
  ).run(
    authSessionId,
    params.userId,
    JSON.stringify(capabilitiesForRole(params.role)),
    hashToken(rawToken)
  )

  const expiresRow = db
    .prepare('SELECT expires_at FROM auth_session WHERE auth_session_id = ?')
    .get(authSessionId) as { expires_at: string }

  return {
    rawToken,
    snapshot: {
      success: true,
      authSessionId,
      userId: params.userId,
      role: params.role,
      displayName: params.displayName,
      expiresAt: expiresRow.expires_at
    }
  }
}

export function bindAuthSessionToSender(senderId: number, rawToken: string): void {
  boundAuthTokens.set(senderId, rawToken)
}

export function clearAuthSessionBinding(senderId: number): void {
  boundAuthTokens.delete(senderId)
}

export function replaceSenderAuthSession(
  db: DBAdapter,
  senderId: number,
  rawToken: string
): void {
  const previousToken = boundAuthTokens.get(senderId)
  if (previousToken) {
    revokeAuthSessionByToken(db, previousToken, 'REPLACED_BY_LOGIN')
  }
  boundAuthTokens.set(senderId, rawToken)
}

export function resolveAuthSessionByToken(
  db: DBAdapter,
  rawToken: string
): CurrentSessionResult {
  const row = readSessionRowByToken(db, rawToken)
  if (!row) {
    return { success: false, errorCode: 'AUTH_REQUIRED' }
  }

  if (row.session_status === 'REVOKED') {
    return { success: false, errorCode: 'SESSION_REVOKED' }
  }

  if (row.session_status === 'EXPIRED' || row.is_expired === 1) {
    markSessionExpired(db, row.auth_session_id)
    return { success: false, errorCode: 'SESSION_EXPIRED' }
  }

  if (row.account_status !== 'ACTIVE') {
    revokeAuthSessionByToken(db, rawToken, 'ACCOUNT_DISABLED')
    return { success: false, errorCode: 'ACCOUNT_DISABLED' }
  }

  db.prepare(
    `UPDATE auth_session
        SET last_activity_at = datetime('now'),
            updated_at = datetime('now')
      WHERE auth_session_id = ?`
  ).run(row.auth_session_id)

  return toSnapshot(row)
}

export function resolveBoundAuthSession(
  db: DBAdapter,
  senderId: number
): CurrentSessionResult {
  const rawToken = boundAuthTokens.get(senderId)
  if (!rawToken) {
    return { success: false, errorCode: 'AUTH_REQUIRED' }
  }

  const resolved = resolveAuthSessionByToken(db, rawToken)
  if (!resolved.success) {
    boundAuthTokens.delete(senderId)
  }
  return resolved
}

/**
 * IPC 包装层专用：调用方上传的 caller 身份不可信，必须以 sender 绑定的
 * auth_session 覆盖。具体操作允许哪些角色，继续由各 handler 纯函数判定。
 */
export function resolveTrustedAuthSessionCaller<T extends AuthSessionCallerParams>(
  db: DBAdapter,
  senderId: number,
  params: T
): { ok: true; params: T } | { ok: false; errorCode: 'FORBIDDEN' } {
  const session = resolveBoundAuthSession(db, senderId)
  if (!session.success) {
    return { ok: false, errorCode: 'FORBIDDEN' }
  }

  return {
    ok: true,
    params: {
      ...params,
      callerUserId: session.userId,
      callerRole: session.role
    } as T
  }
}

export function revokeBoundAuthSession(
  db: DBAdapter,
  senderId: number,
  reason: string
): void {
  const rawToken = boundAuthTokens.get(senderId)
  boundAuthTokens.delete(senderId)
  if (rawToken) {
    revokeAuthSessionByToken(db, rawToken, reason)
  }
}
