import type { DBAdapter } from '../../db/interface'
import { getDatabase } from '../../db/connection'
import { SqliteAdapter } from '../../db/sqlite-adapter'
import {
  createTeacherAccount,
  executeLoginCommand,
  executeLogoutCommand,
  setTeacherAccountStatus
} from '../../application/services/auth-service'
import {
  getCurrentSessionQuery,
  listAccountsQuery
} from '../../application/query/auth-query-service'
import { resolveTrustedAuthSessionCaller } from '../../utils/auth-session'
import type {
  CreateTeacherAccountParams,
  ListAccountsParams,
  LoginParams,
  SetTeacherAccountStatusParams
} from '../../../shared/types/auth'
import type { LegacyIpcHandlerRegistrar } from '../legacy-handler-collector'

export {
  createTeacherAccount,
  getCurrentSession,
  listAccounts,
  loginWithPassword,
  logoutCurrentSession,
  seedAuthErrorCodes,
  setTeacherAccountStatus
} from '../../application/services/auth-service'

function defaultGetDb(): DBAdapter {
  return new SqliteAdapter(getDatabase())
}

export interface AuthHandlerRegistrationOptions {
  getDb?: () => DBAdapter
  bindingOwnerId?: string
  trackSender?: (senderId: number, subscribeDestroyed: (release: () => void) => void) => void
}

export function registerAuthHandlers(
  registrar: LegacyIpcHandlerRegistrar,
  options: AuthHandlerRegistrationOptions = {}
): void {
  const getDb = options.getDb ?? defaultGetDb

  registrar.handle('auth:login', (event, params: LoginParams) => executeLoginCommand(getDb(), params, {
    senderId: event.sender.id,
    bindingOwnerId: options.bindingOwnerId,
    trackSender: options.trackSender,
    subscribeDestroyed: (release) => event.sender.once('destroyed', release)
  }))

  registrar.handle('auth:getCurrentSession', (event) => {
    try {
      return getCurrentSessionQuery(getDb(), event.sender.id)
    } catch (err) {
      console.error('[Auth] Restore session failed:', err)
      return { success: false as const, errorCode: 'SYSTEM_ERROR' as const }
    }
  })

  registrar.handle('auth:logout', (event) => executeLogoutCommand(getDb(), event.sender.id))

  registrar.handle('auth:listAccounts', (event, params: ListAccountsParams) => {
    const db = getDb()
    const trusted = resolveTrustedAuthSessionCaller(db, event.sender.id, params)
    if (!trusted.ok) return { success: false as const, errorCode: 'FORBIDDEN' as const }
    return listAccountsQuery(db, trusted.params)
  })

  registrar.handle('auth:createTeacherAccount', (event, params: CreateTeacherAccountParams) => {
    const db = getDb()
    const trusted = resolveTrustedAuthSessionCaller(db, event.sender.id, params)
    if (!trusted.ok) return { success: false as const, errorCode: 'FORBIDDEN' as const }
    return createTeacherAccount(db, trusted.params)
  })

  registrar.handle('auth:setTeacherAccountStatus', (event, params: SetTeacherAccountStatusParams) => {
    const db = getDb()
    const trusted = resolveTrustedAuthSessionCaller(db, event.sender.id, params)
    if (!trusted.ok) return { success: false as const, errorCode: 'FORBIDDEN' as const }
    return setTeacherAccountStatus(db, trusted.params)
  })
}
