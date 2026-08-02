import type { ApplicationRuntime } from '../application/runtime/application-runtime'
import type { ActivationServicePort } from '../activation/activation-service'
import { registerActivationIpcHandlers } from './activation'
import { registerCentralIpcHandlers } from './handler-registry'
import { registerQuestionBankCatalogIpcHandlers } from './question-bank-catalog'

/** The sole production entry point for activation and the complete business IPC boundary. */
export function registerIpcHandlers(
  runtime: ApplicationRuntime,
  activation: ActivationServicePort
): void {
  const activationBoundary = registerActivationIpcHandlers(runtime, activation)
  const catalogBoundary = registerQuestionBankCatalogIpcHandlers(runtime, activation)
  try {
    registerCentralIpcHandlers(runtime, activation)
  } catch (error) {
    catalogBoundary.dispose()
    activationBoundary.dispose()
    throw error
  }
}
