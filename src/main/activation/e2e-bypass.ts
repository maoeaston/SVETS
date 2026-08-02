import type { ActivationOperationResult, ActivationSnapshot } from '../../shared/types/activation'
import type { ActivationServicePort } from './activation-service'

/** Explicit test-only bypass for legacy Electron flows that do not exercise activation itself. */
export function createE2eActivationBypass(options: {
  appVersion: string
  questionBankVersion: string
}): ActivationServicePort {
  let serverUrl = 'e2e://activation-bypass'
  const snapshot = (): ActivationSnapshot => ({
    activated: true,
    status: 'ACTIVE',
    serverUrl,
    organizationName: 'E2E 隔离环境',
    validUntil: '2999-12-31T23:59:59.999Z',
    lastVerifiedAt: new Date().toISOString(),
    appVersion: options.appVersion,
    questionBankVersion: options.questionBankVersion
  })
  const success = (): ActivationOperationResult => ({ success: true, snapshot: snapshot() })
  return {
    initialize: async () => undefined,
    getStatus: async () => snapshot(),
    configureServer: async (value) => {
      serverUrl = value || serverUrl
      return success()
    },
    activate: async () => success(),
    validate: async () => success(),
    assertBusinessAccess: async () => undefined
  }
}
