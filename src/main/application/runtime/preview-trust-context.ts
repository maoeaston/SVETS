import { PrincipalBindingService } from '../../domain/authority/principal-binding-service'
import { PreviewContractError } from '../../domain/preview/preview-errors'
import type { PreviewFeedbackTrustContext } from '../planners/preview-feedback-planner'
import type { PreviewPrincipalTrustContext } from '../planners/preview-principal-planner'
import type { PreviewReleaseTrustContext } from '../planners/preview-release-planner'

export interface PreviewRuntimeTrustContexts {
  readonly principal: PreviewPrincipalTrustContext
  readonly release: PreviewReleaseTrustContext
  readonly feedback: PreviewFeedbackTrustContext
}

function unavailable(): never {
  throw new PreviewContractError(
    'INSTALLATION_TRUST_UNAVAILABLE',
    'signed preview trust materials are not installed in this runtime'
  )
}

/**
 * Production startup has no safe default identity or signing authority. Until
 * a verified bootstrap bundle is installed, every preview write remains closed.
 */
export function createFailClosedPreviewTrustContexts(): PreviewRuntimeTrustContexts {
  return Object.freeze({
    principal: Object.freeze({
      service: new PrincipalBindingService({}),
      resolveScope: () => null,
      resolveExecutorPrincipal: () => null
    }),
    release: Object.freeze({
      resolveScope: () => null,
      verifyReleasePackage: () => unavailable(),
      verifyRevokePackage: () => unavailable()
    }),
    feedback: Object.freeze({
      resolveScope: () => null,
      assertCapability: () => unavailable()
    })
  })
}
