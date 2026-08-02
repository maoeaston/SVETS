import { beforeEach, describe, expect, it, vi } from 'vitest'

const electronState = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle(channel: string, handler: (...args: unknown[]) => unknown) {
      electronState.handlers.set(channel, handler)
    },
    removeHandler(channel: string) {
      electronState.handlers.delete(channel)
    }
  }
}))

import type { ApplicationRuntime } from '../../application/runtime/application-runtime'
import type { ActivationServicePort } from '../../activation/activation-service'
import type { ActivationOperationResult, ActivationSnapshot } from '../../../shared/types/activation'
import { ACTIVATION_IPC_CHANNELS, registerActivationIpcHandlers } from '../activation'

function runtime() {
  const disposers: Array<() => void> = []
  return {
    runtime: {
      registerBoundaryDisposer: (dispose: () => void) => { disposers.push(dispose) }
    } as unknown as ApplicationRuntime,
    disposers
  }
}

function service(): ActivationServicePort {
  const snapshot: ActivationSnapshot = {
    activated: false,
    status: 'NOT_ACTIVATED',
    serverUrl: '',
    organizationName: null,
    validUntil: null,
    lastVerifiedAt: null,
    appVersion: 'preview.1',
    questionBankVersion: 'pack.1'
  }
  const failure = (errorCode: 'INVALID_SERVER_URL' | 'INVALID_LICENSE_KEY' | 'ACTIVATION_REQUIRED'): ActivationOperationResult => ({
    success: false,
    errorCode,
    snapshot
  })
  return {
    initialize: vi.fn(async () => undefined),
    getStatus: vi.fn(async () => snapshot),
    configureServer: vi.fn(async () => failure('INVALID_SERVER_URL')),
    activate: vi.fn(async () => failure('INVALID_LICENSE_KEY')),
    validate: vi.fn(async () => failure('ACTIVATION_REQUIRED')),
    assertBusinessAccess: vi.fn(async () => { throw new Error('ACTIVATION_REQUIRED') })
  }
}

beforeEach(() => electronState.handlers.clear())

describe('activation IPC boundary', () => {
  it('registers only the four public activation channels and disposes them together', async () => {
    const holder = runtime()
    const activation = service()
    const boundary = registerActivationIpcHandlers(holder.runtime, activation)

    expect([...electronState.handlers.keys()].sort()).toEqual([...ACTIVATION_IPC_CHANNELS].sort())
    await electronState.handlers.get('activation:configureServer')?.({}, { serverUrl: 'https://license.example.com' })
    await electronState.handlers.get('activation:activate')?.({}, { licenseKey: 'DEMO' })
    expect(activation.configureServer).toHaveBeenCalledWith('https://license.example.com')
    expect(activation.activate).toHaveBeenCalledWith('DEMO')

    boundary.dispose()
    expect(electronState.handlers.size).toBe(0)
  })

  it('turns malformed renderer input into empty strings for service-side validation', async () => {
    const holder = runtime()
    const activation = service()
    registerActivationIpcHandlers(holder.runtime, activation)

    await electronState.handlers.get('activation:configureServer')?.({}, { serverUrl: 42 })
    await electronState.handlers.get('activation:activate')?.({}, null)

    expect(activation.configureServer).toHaveBeenCalledWith('')
    expect(activation.activate).toHaveBeenCalledWith('')
  })
})
