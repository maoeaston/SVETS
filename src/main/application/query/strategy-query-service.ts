import type { DBAdapter } from '../../db/interface'
import type {
  GetStrategyResult,
  ListStrategyVersionsResult,
  StrategyListParams,
  StrategyListResult
} from '../../../shared/types/strategy'
import {
  getStrategy,
  listStrategies,
  listVersions
} from '../services/strategy-service'

export function getStrategyQuery(
  db: DBAdapter,
  params: { callerUserId: string; callerRole: string; strategyId: string; version: number }
): GetStrategyResult {
  return getStrategy(db, params)
}

export function listStrategiesQuery(db: DBAdapter, params: StrategyListParams): StrategyListResult {
  return listStrategies(db, params)
}

export function listStrategyVersionsQuery(
  db: DBAdapter,
  params: { callerUserId: string; callerRole: string; strategyId: string }
): ListStrategyVersionsResult {
  return listVersions(db, params)
}
