import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { IpcApi } from '@shared/types/ipc-api'
import { useRuntimeHealthStore } from '../runtime-health'

const getHealth = vi.fn()

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  vi.stubGlobal('window', { api: { runtime: { getHealth } } as Partial<IpcApi> })
})

describe('runtime health store', () => {
  it('records a read-only corruption state returned by the main process', async () => {
    getHealth.mockResolvedValue({
      schemaVersion: 'runtime-health-v1',
      state: 'CORRUPTION_READ_ONLY',
      blockingCode: 'STARTUP_RECOVERY_FAILED',
      evidenceDigest: 'digest',
      detectedAt: '2026-07-30T00:00:00.000Z',
      legacyRecordCount: 3
    })

    const store = useRuntimeHealthStore()
    await store.refresh()

    expect(store.loading).toBe(false)
    expect(store.unavailable).toBe(false)
    expect(store.isReadOnly).toBe(true)
    expect(store.snapshot?.blockingCode).toBe('STARTUP_RECOVERY_FAILED')
  })

  it('keeps the current state and marks the endpoint unavailable when the health query fails', async () => {
    getHealth.mockRejectedValue(new Error('unavailable'))

    const store = useRuntimeHealthStore()
    await store.refresh()

    expect(store.loading).toBe(false)
    expect(store.unavailable).toBe(true)
    expect(store.snapshot).toBeNull()
  })
})
