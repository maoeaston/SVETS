import type { BusinessAccessGate } from '../ipc/handler-registry'

export const TEST_BUSINESS_ACCESS_GATE: BusinessAccessGate = Object.freeze({
  assertBusinessAccess: async () => undefined
})
