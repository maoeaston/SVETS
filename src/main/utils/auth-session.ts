import { createHash, randomBytes } from 'crypto'
import { v4 as uuidv4 } from 'uuid'
import type { DBAdapter } from '../db/interface'
import type { AcceptedCommandContext } from '../application/command/command-types'
import {
  assertInternalMutationCapability,
  type InternalMutationCapability
} from '../application/runtime/internal-mutation-capability'
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

interface MaintenanceSessionRow extends SessionRow {
  token_hash: string
}

interface BoundAuthToken {
  rawToken?: string
  authSessionId?: string
  ownerId: string | null
}

const boundAuthTokens = new Map<number, BoundAuthToken>()

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

function readSessionRowById(db: DBAdapter, authSessionId: string): SessionRow | undefined {
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
       WHERE s.auth_session_id = ?`
    )
    .get(authSessionId) as SessionRow | undefined
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
  persistSessionRevocation(db, { tokenHash: hashToken(rawToken) }, reason)
}

export function revokeAuthSessionById(
  db: DBAdapter,
  authSessionId: string,
  reason: string
): void {
  persistSessionRevocation(db, { authSessionId }, reason)
}

function persistSessionRevocation(
  db: DBAdapter,
  selector: { tokenHash?: string; authSessionId?: string },
  reason: string
): void {
  db.prepare(
    `UPDATE auth_session
        SET status = 'REVOKED',
            revoke_reason = ?,
            updated_at = datetime('now')
      WHERE ((? IS NOT NULL AND token_hash = ?)
          OR (? IS NOT NULL AND auth_session_id = ?))
        AND status = 'ACTIVE'`
  ).run(
    reason,
    selector.tokenHash ?? null,
    selector.tokenHash ?? null,
    selector.authSessionId ?? null,
    selector.authSessionId ?? null
  )
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
  boundAuthTokens.set(senderId, { rawToken, ownerId: null })
}

/**
 * M5B gate-only path stores the durable auth_session_id instead of a raw
 * credential. The legacy token binding remains until M5B-14 composition cutover.
 */
export function bindPersistentAuthSessionToSender(
  senderId: number,
  authSessionId: string,
  ownerId: string | null = null
): void {
  boundAuthTokens.set(senderId, { authSessionId, ownerId })
}

export function persistentAuthSessionIdForSender(senderId: number): string | null {
  return boundAuthTokens.get(senderId)?.authSessionId ?? null
}

/** Returns only the durable session identifier for the current binding, never a raw token. */
export function boundAuthSessionIdForSender(db: DBAdapter, senderId: number): string | null {
  const snapshot = resolveBoundAuthSessionSnapshot(db, senderId)
  return snapshot.success ? snapshot.authSessionId : null
}

export function clearPersistentAuthSessionBindingIfMatches(senderId: number, authSessionId: string): void {
  const binding = boundAuthTokens.get(senderId)
  if (binding?.authSessionId === authSessionId) boundAuthTokens.delete(senderId)
}

export function clearAuthSessionBinding(senderId: number): void {
  boundAuthTokens.delete(senderId)
}

export function hasAuthSessionBinding(senderId: number): boolean {
  return boundAuthTokens.has(senderId)
}

export function clearAuthSessionBindingForOwner(senderId: number, ownerId: string): void {
  if (boundAuthTokens.get(senderId)?.ownerId === ownerId) boundAuthTokens.delete(senderId)
}

export function clearAuthSessionBindingsByOwner(ownerId: string): number {
  let cleared = 0
  for (const [senderId, binding] of boundAuthTokens) {
    if (binding.ownerId !== ownerId) continue
    boundAuthTokens.delete(senderId)
    cleared += 1
  }
  return cleared
}

export function replaceSenderAuthSession(
  db: DBAdapter,
  senderId: number,
  rawToken: string,
  ownerId: string | null = null
): void {
  const previous = boundAuthTokens.get(senderId)
  if (previous) {
    if (previous.authSessionId) revokeAuthSessionById(db, previous.authSessionId, 'REPLACED_BY_LOGIN')
    else if (previous.rawToken) revokeAuthSessionByToken(db, previous.rawToken, 'REPLACED_BY_LOGIN')
  }
  boundAuthTokens.set(senderId, { rawToken, ownerId })
}

/** Pure snapshot: it never updates session state, heartbeat, or sender binding. */
export function resolveAuthSessionSnapshotByToken(
  db: DBAdapter,
  rawToken: string
): CurrentSessionResult {
  const row = readSessionRowByToken(db, rawToken)
  if (!row) return { success: false, errorCode: 'AUTH_REQUIRED' }
  if (row.session_status === 'REVOKED') return { success: false, errorCode: 'SESSION_REVOKED' }
  if (row.session_status === 'EXPIRED' || row.is_expired === 1) {
    return { success: false, errorCode: 'SESSION_EXPIRED' }
  }
  if (row.account_status !== 'ACTIVE') return { success: false, errorCode: 'ACCOUNT_DISABLED' }
  return toSnapshot(row)
}

/** Pure ID-based snapshot used by M5B gate-only post-commit binding. */
export function resolveAuthSessionSnapshotById(
  db: DBAdapter,
  authSessionId: string
): CurrentSessionResult {
  const row = readSessionRowById(db, authSessionId)
  if (!row) return { success: false, errorCode: 'AUTH_REQUIRED' }
  if (row.session_status === 'REVOKED') return { success: false, errorCode: 'SESSION_REVOKED' }
  if (row.session_status === 'EXPIRED' || row.is_expired === 1) {
    return { success: false, errorCode: 'SESSION_EXPIRED' }
  }
  if (row.account_status !== 'ACTIVE') return { success: false, errorCode: 'ACCOUNT_DISABLED' }
  return toSnapshot(row)
}

/** Pure bound snapshot: failed reads deliberately preserve the in-memory binding. */
export function resolveBoundAuthSessionSnapshot(
  db: DBAdapter,
  senderId: number
): CurrentSessionResult {
  const binding = boundAuthTokens.get(senderId)
  if (!binding) return { success: false, errorCode: 'AUTH_REQUIRED' }
  if (binding.authSessionId) return resolveAuthSessionSnapshotById(db, binding.authSessionId)
  if (!binding.rawToken) return { success: false, errorCode: 'AUTH_REQUIRED' }
  return resolveAuthSessionSnapshotByToken(db, binding.rawToken)
}

/** Heartbeat is only available to code already holding an accepted command context. */
export function heartbeatAcceptedAuthSession(
  db: DBAdapter,
  context: AcceptedCommandContext
): void {
  const actor = context.envelope.actor
  if (actor.kind !== 'USER') throw new Error('accepted auth heartbeat requires a USER actor')
  persistAuthSessionHeartbeat(db, actor.authSessionId, actor.userId)
}

function persistAuthSessionHeartbeat(
  db: DBAdapter,
  authSessionId: string,
  userId: string
): void {
  db.prepare(
    `UPDATE auth_session
        SET last_activity_at = datetime('now'),
            updated_at = datetime('now')
      WHERE auth_session_id = ?
        AND user_id = ?
        AND status = 'ACTIVE'`
  ).run(authSessionId, userId)
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

  persistAuthSessionHeartbeat(db, row.auth_session_id, row.user_id)

  return toSnapshot(row)
}

function resolveAuthSessionByIdAndHeartbeat(
  db: DBAdapter,
  authSessionId: string
): CurrentSessionResult {
  const row = readSessionRowById(db, authSessionId)
  if (!row) return { success: false, errorCode: 'AUTH_REQUIRED' }
  if (row.session_status === 'REVOKED') return { success: false, errorCode: 'SESSION_REVOKED' }
  if (row.session_status === 'EXPIRED' || row.is_expired === 1) {
    markSessionExpired(db, row.auth_session_id)
    return { success: false, errorCode: 'SESSION_EXPIRED' }
  }
  if (row.account_status !== 'ACTIVE') {
    revokeAuthSessionById(db, authSessionId, 'ACCOUNT_DISABLED')
    return { success: false, errorCode: 'ACCOUNT_DISABLED' }
  }
  persistAuthSessionHeartbeat(db, row.auth_session_id, row.user_id)
  return toSnapshot(row)
}

export function resolveBoundAuthSession(
  db: DBAdapter,
  senderId: number
): CurrentSessionResult {
  const binding = boundAuthTokens.get(senderId)
  if (!binding) {
    return { success: false, errorCode: 'AUTH_REQUIRED' }
  }

  const resolved = binding.authSessionId
    ? resolveAuthSessionByIdAndHeartbeat(db, binding.authSessionId)
    : binding.rawToken
      ? resolveAuthSessionByToken(db, binding.rawToken)
      : { success: false as const, errorCode: 'AUTH_REQUIRED' as const }
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
  const session = resolveBoundAuthSessionSnapshot(db, senderId)
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
  const binding = boundAuthTokens.get(senderId)
  boundAuthTokens.delete(senderId)
  if (binding) {
    if (binding.authSessionId) revokeAuthSessionById(db, binding.authSessionId, reason)
    else if (binding.rawToken) revokeAuthSessionByToken(db, binding.rawToken, reason)
  }
}

export interface AuthSessionSweepResult {
  readonly expiredSessionCount: number
  readonly revokedSessionCount: number
  readonly clearedBindingCount: number
}

/** SYSTEM-owned maintenance. DB persistence completes before any binding is cleared. */
export function sweepInvalidAuthSessions(
  db: DBAdapter,
  capability: InternalMutationCapability,
  options: { bindingOwnerId?: string } = {}
): AuthSessionSweepResult {
  assertInternalMutationCapability(capability, 'RUNTIME_MAINTENANCE')

  const persisted = db.transaction(() => {
    const rows = db.prepare(
      `SELECT
         s.auth_session_id,
         s.user_id,
         s.token_hash,
         ua.role,
         ua.display_name,
         ua.status AS account_status,
         s.status AS session_status,
         s.expires_at,
         CASE WHEN s.expires_at <= datetime('now') THEN 1 ELSE 0 END AS is_expired
       FROM auth_session s
       JOIN user_account ua ON ua.user_id = s.user_id`
    ).all() as MaintenanceSessionRow[]

    let expiredSessionCount = 0
    let revokedSessionCount = 0
    const invalidTokenHashes = new Set<string>()
    const invalidAuthSessionIds = new Set<string>()
    for (const row of rows) {
      if (row.session_status === 'ACTIVE' && row.is_expired === 1) {
        markSessionExpired(db, row.auth_session_id)
        expiredSessionCount += 1
        invalidTokenHashes.add(row.token_hash)
        invalidAuthSessionIds.add(row.auth_session_id)
        continue
      }
      if (row.session_status === 'ACTIVE' && row.account_status !== 'ACTIVE') {
        persistSessionRevocation(db, { authSessionId: row.auth_session_id }, 'ACCOUNT_DISABLED')
        revokedSessionCount += 1
        invalidTokenHashes.add(row.token_hash)
        invalidAuthSessionIds.add(row.auth_session_id)
        continue
      }
      if (row.session_status === 'EXPIRED' || row.session_status === 'REVOKED') {
        invalidTokenHashes.add(row.token_hash)
        invalidAuthSessionIds.add(row.auth_session_id)
      }
    }
    return { expiredSessionCount, revokedSessionCount, invalidTokenHashes, invalidAuthSessionIds }
  })()

  let clearedBindingCount = 0
  for (const [senderId, binding] of boundAuthTokens) {
    if (options.bindingOwnerId !== undefined && binding.ownerId !== options.bindingOwnerId) continue
    const invalid = binding.authSessionId
      ? persisted.invalidAuthSessionIds.has(binding.authSessionId)
      : binding.rawToken !== undefined && persisted.invalidTokenHashes.has(hashToken(binding.rawToken))
    if (!invalid) continue
    boundAuthTokens.delete(senderId)
    clearedBindingCount += 1
  }

  return {
    expiredSessionCount: persisted.expiredSessionCount,
    revokedSessionCount: persisted.revokedSessionCount,
    clearedBindingCount
  }
}
