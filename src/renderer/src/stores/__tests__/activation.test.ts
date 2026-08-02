import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcApi } from '@shared/types/ipc-api'
import type { ActivationSnapshot } from '@shared/types/activation'
import { useActivationStore } from '../activation'

const inactive: ActivationSnapshot = {
  activated: false,
  status: 'NOT_ACTIVATED',
  serverUrl: 'http://127.0.0.1:4318',
  organizationName: null,
  validUntil: null,
  lastVerifiedAt: null,
  appVersion: '1.0.0-preview.1',
  questionBankVersion: '2026.08.01.2'
}

const activationApi = {
  getStatus: vi.fn(),
  configureServer: vi.fn(),
  activate: vi.fn(),
  validate: vi.fn()
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  vi.stubGlobal('window', { api: { activation: activationApi } as Partial<IpcApi> })
})

describe('activation store', () => {
  it('restores the main-process activation snapshot', async () => {
    activationApi.getStatus.mockResolvedValue(inactive)
    const store = useActivationStore()

    await store.refresh()

    expect(store.initialized).toBe(true)
    expect(store.activated).toBe(false)
    expect(store.snapshot).toEqual(inactive)
  })

  it('updates the local snapshot after a successful activation', async () => {
    const active = {
      ...inactive,
      activated: true,
      status: 'ACTIVE' as const,
      organizationName: '示范学校',
      validUntil: '2026-09-02T00:00:00.000Z'
    }
    activationApi.activate.mockResolvedValue({ success: true, snapshot: active })
    const store = useActivationStore()

    const result = await store.activate('SCHOOL-DEMO')

    expect(result.success).toBe(true)
    expect(store.activated).toBe(true)
    expect(store.snapshot?.organizationName).toBe('示范学校')
  })

  it('fails closed when the status endpoint is unavailable', async () => {
    activationApi.getStatus.mockRejectedValue(new Error('offline'))
    const store = useActivationStore()

    await store.refresh()

    expect(store.initialized).toBe(true)
    expect(store.transportError).toBe(true)
    expect(store.activated).toBe(false)
  })
})
