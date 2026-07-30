import type { DBAdapter } from '../../db/interface'

export type GateOnlyTransactionScope = 'OWNED' | 'EXTERNAL_IMMEDIATE'

export interface GateOnlyTransactionOptions {
  readonly transactionScope?: GateOnlyTransactionScope
}

/**
 * M5B-7 gate-only execution owns the outer BEGIN IMMEDIATE boundary. Legacy
 * services retain their existing transaction ownership unless explicitly run
 * from that executor.
 */
export function runGateOnlyTransaction<T>(
  database: DBAdapter,
  options: GateOnlyTransactionOptions | undefined,
  operation: () => T
): T {
  if (options?.transactionScope === 'EXTERNAL_IMMEDIATE') return operation()
  return database.transaction(operation)()
}
