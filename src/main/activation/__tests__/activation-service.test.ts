import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ActivationRequiredError,
  ActivationService,
  normalizeActivationServerUrl,
  type ActivationFetch
} from '../activation-service'

const roots: string[] = []
const installationId = '11111111-1111-4111-8111-111111111111'
const now = new Date('2026-08-02T00:00:00.000Z')

function root(): string {
  const value = mkdtempSync(join(tmpdir(), 'svets-activation-'))
  roots.push(value)
  return value
}

function response(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 400, text: async () => JSON.stringify(body) }
}

function service(fetch: ActivationFetch, storageRoot = root()): ActivationService {
  return new ActivationService({
    storageRoot,
    initialServerUrl: 'http://127.0.0.1:4318',
    appVersion: '1.0.0-preview.1',
    questionBankVersion: '2026.08.01.2',
    packaged: false,
    fetch,
    now: () => now,
    createInstallationId: () => installationId,
    requestTimeoutMs: 50
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true })
})

describe('ActivationService', () => {
  it('activates without persisting the license key or exposing the token', async () => {
    const fetch = vi.fn<ActivationFetch>(async (_url, init) => {
      expect(JSON.parse(init.body)).toMatchObject({ licenseKey: 'SCHOOL-DEMO', installationId })
      return response({
        status: 'ACTIVE',
        installationId,
        token: 'opaque-token-with-enough-length',
        organizationName: '示范学校',
        validUntil: '2026-09-02T00:00:00.000Z'
      })
    })
    const storageRoot = root()
    const activation = service(fetch, storageRoot)
    await activation.initialize()

    const result = await activation.activate(' SCHOOL-DEMO ')

    expect(result).toEqual({
      success: true,
      snapshot: expect.objectContaining({ activated: true, status: 'ACTIVE', organizationName: '示范学校' })
    })
    expect(result.snapshot).not.toHaveProperty('token')
    const stored = readFileSync(join(storageRoot, 'activation-state.json'), 'utf8')
    expect(stored).not.toContain('SCHOOL-DEMO')
    expect(stored).toContain('opaque-token-with-enough-length')
    await expect(activation.assertBusinessAccess()).resolves.toBeUndefined()
  })

  it('uses an unexpired server-confirmed cache when validation is unavailable', async () => {
    const storageRoot = root()
    const activateFetch = vi.fn<ActivationFetch>(async () => response({
      status: 'ACTIVE',
      installationId,
      token: 'opaque-token-with-enough-length',
      organizationName: '示范学校',
      validUntil: '2026-09-02T00:00:00.000Z'
    }))
    const first = service(activateFetch, storageRoot)
    await first.initialize()
    await first.activate('SCHOOL-DEMO')

    const offline = service(vi.fn<ActivationFetch>(async () => { throw new Error('offline') }), storageRoot)
    await offline.initialize()

    expect(await offline.getStatus()).toMatchObject({ activated: true, status: 'ACTIVE_CACHED' })
    await expect(offline.assertBusinessAccess()).resolves.toBeUndefined()
  })

  it('clears old authorization when the server address changes', async () => {
    const activation = service(vi.fn<ActivationFetch>(async () => response({
      status: 'ACTIVE',
      installationId,
      token: 'opaque-token-with-enough-length',
      organizationName: '示范学校',
      validUntil: '2026-09-02T00:00:00.000Z'
    })))
    await activation.initialize()
    await activation.activate('SCHOOL-DEMO')

    const changed = await activation.configureServer('http://localhost:5000/')

    expect(changed).toEqual({
      success: true,
      snapshot: expect.objectContaining({ activated: false, status: 'NOT_ACTIVATED', serverUrl: 'http://localhost:5000' })
    })
    await expect(activation.assertBusinessAccess()).rejects.toBeInstanceOf(ActivationRequiredError)
  })

  it('does not let a malformed server response replace a valid cache', async () => {
    const fetch = vi.fn<ActivationFetch>()
      .mockResolvedValueOnce(response({
        status: 'ACTIVE',
        installationId,
        token: 'opaque-token-with-enough-length',
        organizationName: '示范学校',
        validUntil: '2026-09-02T00:00:00.000Z'
      }))
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => 'not-json' })
    const activation = service(fetch)
    await activation.initialize()
    await activation.activate('SCHOOL-DEMO')

    const result = await activation.validate()

    expect(result).toEqual({
      success: true,
      snapshot: expect.objectContaining({ activated: true, status: 'ACTIVE_CACHED' })
    })
  })

  it('serializes configure and activation so a late request uses the newest server', async () => {
    const urls: string[] = []
    const fetch = vi.fn<ActivationFetch>(async (url) => {
      urls.push(url)
      return response({
        status: 'ACTIVE',
        installationId,
        token: 'opaque-token-with-enough-length',
        organizationName: '示范学校',
        validUntil: '2026-09-02T00:00:00.000Z'
      })
    })
    const activation = service(fetch)
    await activation.initialize()

    const configuring = activation.configureServer('http://localhost:5001')
    const activating = activation.activate('SCHOOL-DEMO')
    await Promise.all([configuring, activating])

    expect(urls).toEqual(['http://localhost:5001/v1/activations'])
  })

  it('fails closed for a damaged state file', async () => {
    const storageRoot = root()
    writeFileSync(join(storageRoot, 'activation-state.json'), '{broken', { mode: 0o600 })
    const activation = service(vi.fn<ActivationFetch>(), storageRoot)

    await activation.initialize()

    expect(await activation.getStatus()).toMatchObject({ activated: false, status: 'STORAGE_ERROR' })
    await expect(activation.assertBusinessAccess()).rejects.toBeInstanceOf(ActivationRequiredError)
  })

  it('requires HTTPS when packaged and allows only loopback HTTP in development', () => {
    expect(normalizeActivationServerUrl('https://license.example.com/', true)).toBe('https://license.example.com')
    expect(() => normalizeActivationServerUrl('http://license.example.com', true)).toThrow('INVALID_SERVER_URL')
    expect(() => normalizeActivationServerUrl('http://192.168.1.10:4318', false)).toThrow('INVALID_SERVER_URL')
    expect(normalizeActivationServerUrl('http://127.0.0.1:4318/', false)).toBe('http://127.0.0.1:4318')
  })
})
