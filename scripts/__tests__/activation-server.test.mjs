import { afterEach, describe, expect, it } from 'vitest'
import { listenActivationServer } from '../lib/activation-server.mjs'

const servers = []

async function start(overrides = {}) {
  const instance = await listenActivationServer({
    licenseKey: 'SCHOOL-DEMO',
    organizationName: '示范学校',
    deviceLimit: 1,
    validDays: 30,
    now: () => new Date('2026-08-02T00:00:00.000Z'),
    ...overrides
  })
  servers.push(instance)
  return instance
}

async function post(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  return { status: response.status, body: await response.json() }
}

afterEach(async () => {
  while (servers.length > 0) await servers.pop().close()
})

describe('reference activation server', () => {
  it('activates idempotently and validates the opaque token', async () => {
    const instance = await start()
    const input = { licenseKey: 'SCHOOL-DEMO', installationId: 'install-a', appVersion: 'preview.1' }

    const first = await post(`${instance.url}/v1/activations`, input)
    const second = await post(`${instance.url}/v1/activations`, input)
    const validation = await post(`${instance.url}/v1/activations/validate`, {
      token: first.body.token,
      installationId: 'install-a',
      appVersion: 'preview.1'
    })

    expect(first.status).toBe(200)
    expect(first.body).toMatchObject({ status: 'ACTIVE', organizationName: '示范学校' })
    expect(second.body.token).toBe(first.body.token)
    expect(validation.body).toMatchObject({ status: 'ACTIVE', installationId: 'install-a' })
    expect(instance.getDeviceCount()).toBe(1)
  })

  it('rejects an invalid key and enforces the device limit', async () => {
    const instance = await start()
    const invalid = await post(`${instance.url}/v1/activations`, {
      licenseKey: 'WRONG', installationId: 'install-a', appVersion: 'preview.1'
    })
    await post(`${instance.url}/v1/activations`, {
      licenseKey: 'SCHOOL-DEMO', installationId: 'install-a', appVersion: 'preview.1'
    })
    const limited = await post(`${instance.url}/v1/activations`, {
      licenseKey: 'SCHOOL-DEMO', installationId: 'install-b', appVersion: 'preview.1'
    })

    expect(invalid).toMatchObject({ status: 403, body: { status: 'INVALID_LICENSE' } })
    expect(limited).toMatchObject({ status: 409, body: { status: 'DEVICE_LIMIT' } })
  })

  it('reports an expired license without allocating a device', async () => {
    const instance = await start({ licenseExpiresAt: '2026-08-01T00:00:00.000Z' })
    const result = await post(`${instance.url}/v1/activations`, {
      licenseKey: 'SCHOOL-DEMO', installationId: 'install-a', appVersion: 'preview.1'
    })

    expect(result).toMatchObject({ status: 403, body: { status: 'EXPIRED' } })
    expect(instance.getDeviceCount()).toBe(0)
  })
})
