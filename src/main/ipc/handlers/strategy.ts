import {
  createVersion,
  setActive,
  updateStrategy
} from '../../application/services/strategy-service'
import {
  getStrategyQuery,
  listStrategiesQuery,
  listStrategyVersionsQuery
} from '../../application/query/strategy-query-service'
import { getDatabase } from '../../db/connection'
import type { DBAdapter } from '../../db/interface'
import { SqliteAdapter } from '../../db/sqlite-adapter'
import { resolveBoundAuthSessionSnapshot } from '../../utils/auth-session'
import type { AuthRole } from '../../../shared/types/auth'
import type {
  CreateStrategyVersionParams,
  SetStrategyActiveParams,
  StrategyListParams,
  UpdateStrategyParams
} from '../../../shared/types/strategy'
import type { LegacyIpcHandlerRegistrar } from '../legacy-handler-collector'

export {
  createVersion,
  getStrategy,
  listStrategies,
  listVersions,
  seedStrategyErrorCodes,
  setActive,
  updateStrategy
} from '../../application/services/strategy-service'

type StrategyCallerParams = {
  callerUserId: string
  callerRole: string
}

export function resolveTrustedStrategyCaller<T extends StrategyCallerParams>(
  db: DBAdapter,
  senderId: number,
  params: T
): { ok: true; params: T } | { ok: false; errorCode: 'FORBIDDEN' } {
  const session = resolveBoundAuthSessionSnapshot(db, senderId)
  if (!session.success || (session.role !== 'TEACHER' && session.role !== 'ADMIN')) {
    return { ok: false, errorCode: 'FORBIDDEN' }
  }
  return {
    ok: true,
    params: {
      ...params,
      callerUserId: session.userId,
      callerRole: session.role as AuthRole
    }
  }
}

function defaultGetDb(): DBAdapter {
  return new SqliteAdapter(getDatabase())
}

export function registerStrategyHandlers(
  registrar: LegacyIpcHandlerRegistrar,
  getDb: () => DBAdapter = defaultGetDb
): void {
  registrar.handle('strategy:list', (event, params: StrategyListParams) => {
    const db = getDb()
    const trusted = resolveTrustedStrategyCaller(db, event.sender.id, params)
    if (!trusted.ok) return { success: false as const, errorCode: 'FORBIDDEN' as const }
    return listStrategiesQuery(db, trusted.params)
  })
  registrar.handle(
    'strategy:get',
    (event, params: { callerUserId: string; callerRole: string; strategyId: string; version: number }) => {
      const db = getDb()
      const trusted = resolveTrustedStrategyCaller(db, event.sender.id, params)
      if (!trusted.ok) return { success: false as const, errorCode: 'FORBIDDEN' as const }
      return getStrategyQuery(db, trusted.params)
    }
  )
  registrar.handle(
    'strategy:listVersions',
    (event, params: { callerUserId: string; callerRole: string; strategyId: string }) => {
      const db = getDb()
      const trusted = resolveTrustedStrategyCaller(db, event.sender.id, params)
      if (!trusted.ok) return { success: false as const, errorCode: 'FORBIDDEN' as const }
      return listStrategyVersionsQuery(db, trusted.params)
    }
  )
  registrar.handle('strategy:createVersion', (event, params: CreateStrategyVersionParams) => {
    const db = getDb()
    const trusted = resolveTrustedStrategyCaller(db, event.sender.id, params)
    if (!trusted.ok) return { success: false as const, errorCode: 'FORBIDDEN' as const }
    return createVersion(db, trusted.params)
  })
  registrar.handle('strategy:update', (event, params: UpdateStrategyParams) => {
    const db = getDb()
    const trusted = resolveTrustedStrategyCaller(db, event.sender.id, params)
    if (!trusted.ok) return { success: false as const, errorCode: 'FORBIDDEN' as const }
    return updateStrategy(db, trusted.params)
  })
  registrar.handle('strategy:setActive', (event, params: SetStrategyActiveParams) => {
    const db = getDb()
    const trusted = resolveTrustedStrategyCaller(db, event.sender.id, params)
    if (!trusted.ok) return { success: false as const, errorCode: 'FORBIDDEN' as const }
    return setActive(db, trusted.params)
  })
}
