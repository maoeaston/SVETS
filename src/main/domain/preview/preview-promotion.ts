import type { DBAdapter } from '../../db/interface'
import { promotePreviewContractReadyWithProvider } from '../../db/preview-contract-migration'
import { previewContractReadiness } from './preview-ready-gate'

/**
 * The only promotion entry point. Readiness is recalculated from the current
 * in-process contract registry immediately before the DB status transition.
 */
export function promotePreviewContractReady(database: DBAdapter, installedAt: string): void {
  promotePreviewContractReadyWithProvider(database, () => previewContractReadiness('READY'), installedAt)
}
