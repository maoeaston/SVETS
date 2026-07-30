import type { ApplicationRuntime } from '../application/runtime/application-runtime'
import { registerCentralIpcHandlers } from './handler-registry'

/** The sole production entry point for the complete 74-channel IPC boundary. */
export function registerIpcHandlers(runtime: ApplicationRuntime): void {
  registerCentralIpcHandlers(runtime)
}
