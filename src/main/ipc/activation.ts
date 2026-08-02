import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { ApplicationRuntime } from '../application/runtime/application-runtime'
import type { ActivationServicePort } from '../activation/activation-service'

export const ACTIVATION_IPC_CHANNELS = [
  'activation:getStatus',
  'activation:configureServer',
  'activation:activate',
  'activation:validate'
] as const

export interface ActivationIpcBoundary {
  readonly channels: readonly string[]
  dispose(): void
}

function stringField(input: unknown, field: string): string {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return ''
  const value = (input as Record<string, unknown>)[field]
  return typeof value === 'string' ? value : ''
}

export function registerActivationIpcHandlers(
  runtime: ApplicationRuntime,
  activation: ActivationServicePort
): ActivationIpcBoundary {
  const installed: string[] = []
  let disposed = false
  const dispose = (): void => {
    if (disposed) return
    disposed = true
    for (const channel of [...installed].reverse()) ipcMain.removeHandler(channel)
    installed.length = 0
  }

  try {
    ipcMain.handle('activation:getStatus', () => activation.getStatus())
    installed.push('activation:getStatus')
    ipcMain.handle('activation:configureServer', (_event: IpcMainInvokeEvent, input: unknown) =>
      activation.configureServer(stringField(input, 'serverUrl')))
    installed.push('activation:configureServer')
    ipcMain.handle('activation:activate', (_event: IpcMainInvokeEvent, input: unknown) =>
      activation.activate(stringField(input, 'licenseKey')))
    installed.push('activation:activate')
    ipcMain.handle('activation:validate', () => activation.validate())
    installed.push('activation:validate')
    runtime.registerBoundaryDisposer(dispose)
  } catch (error) {
    dispose()
    throw error
  }

  return Object.freeze({ channels: Object.freeze([...installed]), dispose })
}
