import type { DBAdapter } from '../../db/interface'
import type {
  CurrentSessionResult,
  ListAccountsParams,
  ListAccountsResult
} from '../../../shared/types/auth'
import {
  getCurrentSession,
  listAccounts
} from '../services/auth-service'

export function getCurrentSessionQuery(db: DBAdapter, senderId: number): CurrentSessionResult {
  return getCurrentSession(db, senderId)
}

export function listAccountsQuery(db: DBAdapter, params: ListAccountsParams): ListAccountsResult {
  return listAccounts(db, params)
}
