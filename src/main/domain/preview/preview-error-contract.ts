import { PREVIEW_CONTRACT_REGISTRY } from './preview-contract-registry'
import { PREVIEW_ERROR_CODES } from './preview-errors'

let registered = false

export function registerPreviewErrorContract(): void {
  if (registered) return
  registered = true
  for (const code of PREVIEW_ERROR_CODES) {
    PREVIEW_CONTRACT_REGISTRY.registerError({
      code,
      public: true,
      retryable: code === 'PREVIEW_CONTRACT_MIGRATION_REQUIRED'
        || code === 'INSTALLATION_TRUST_UNAVAILABLE'
        || code === 'FEEDBACK_RECONCILE_REQUIRED',
      safe_context_keys: []
    })
  }
}
