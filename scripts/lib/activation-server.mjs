import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'

const MAX_BODY_BYTES = 16 * 1024

function json(response, statusCode, body) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  })
  response.end(JSON.stringify(body))
}

function equalSecret(left, right) {
  const leftBytes = Buffer.from(String(left), 'utf8')
  const rightBytes = Buffer.from(String(right), 'utf8')
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
}

async function readJson(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('BODY_TOO_LARGE')
    chunks.push(chunk)
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('INVALID_BODY')
  return parsed
}

function nonEmptyString(value, maxLength = 512) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength
}

export function createActivationServer(options) {
  if (!nonEmptyString(options.licenseKey)) throw new Error('licenseKey is required')
  if (!nonEmptyString(options.organizationName)) throw new Error('organizationName is required')
  if (!Number.isSafeInteger(options.deviceLimit) || options.deviceLimit < 1) throw new Error('deviceLimit must be positive')
  if (!Number.isSafeInteger(options.validDays) || options.validDays < 1) throw new Error('validDays must be positive')

  const now = options.now ?? (() => new Date())
  const devices = new Map()
  const tokens = new Map()
  const licenseExpiresAt = options.licenseExpiresAt ?? null

  function activePayload(installationId, token, validUntil) {
    return {
      status: 'ACTIVE',
      installationId,
      token,
      organizationName: options.organizationName,
      validUntil
    }
  }

  async function handleActivation(request, response) {
    const body = await readJson(request)
    if (!nonEmptyString(body.licenseKey) || !nonEmptyString(body.installationId, 128) || !nonEmptyString(body.appVersion, 128)) {
      return json(response, 400, { status: 'INVALID_LICENSE', installationId: body.installationId ?? null })
    }
    if (licenseExpiresAt && Date.parse(licenseExpiresAt) <= now().getTime()) {
      return json(response, 403, { status: 'EXPIRED', installationId: body.installationId })
    }
    if (!equalSecret(body.licenseKey, options.licenseKey)) {
      return json(response, 403, { status: 'INVALID_LICENSE', installationId: body.installationId })
    }
    const existing = devices.get(body.installationId)
    if (existing) return json(response, 200, activePayload(body.installationId, existing.token, existing.validUntil))
    if (devices.size >= options.deviceLimit) {
      return json(response, 409, { status: 'DEVICE_LIMIT', installationId: body.installationId })
    }
    const token = randomBytes(32).toString('hex')
    const validUntil = new Date(now().getTime() + options.validDays * 86_400_000).toISOString()
    const record = { installationId: body.installationId, token, validUntil }
    devices.set(body.installationId, record)
    tokens.set(token, record)
    return json(response, 200, activePayload(body.installationId, token, validUntil))
  }

  async function handleValidation(request, response) {
    const body = await readJson(request)
    if (!nonEmptyString(body.token, 4096) || !nonEmptyString(body.installationId, 128) || !nonEmptyString(body.appVersion, 128)) {
      return json(response, 403, { status: 'INVALID_LICENSE', installationId: body.installationId ?? null })
    }
    const record = tokens.get(body.token)
    if (!record || record.installationId !== body.installationId) {
      return json(response, 403, { status: 'INVALID_LICENSE', installationId: body.installationId })
    }
    if (Date.parse(record.validUntil) <= now().getTime()) {
      return json(response, 403, { status: 'EXPIRED', installationId: body.installationId })
    }
    return json(response, 200, {
      status: 'ACTIVE',
      installationId: body.installationId,
      organizationName: options.organizationName,
      validUntil: record.validUntil
    })
  }

  const server = createServer(async (request, response) => {
    try {
      if (request.method === 'GET' && request.url === '/health') {
        return json(response, 200, { status: 'ok' })
      }
      if (request.method === 'POST' && request.url === '/v1/activations') {
        return await handleActivation(request, response)
      }
      if (request.method === 'POST' && request.url === '/v1/activations/validate') {
        return await handleValidation(request, response)
      }
      return json(response, 404, { error: 'NOT_FOUND' })
    } catch {
      return json(response, 400, { error: 'INVALID_REQUEST' })
    }
  })

  return {
    server,
    getDeviceCount: () => devices.size
  }
}

export async function listenActivationServer(options) {
  const instance = createActivationServer(options)
  await new Promise((resolve, reject) => {
    instance.server.once('error', reject)
    instance.server.listen(options.port ?? 0, options.host ?? '127.0.0.1', () => {
      instance.server.off('error', reject)
      resolve()
    })
  })
  const address = instance.server.address()
  if (!address || typeof address === 'string') throw new Error('activation server address unavailable')
  return {
    ...instance,
    url: `http://${address.address.includes(':') ? `[${address.address}]` : address.address}:${address.port}`,
    close: () => new Promise((resolve, reject) => instance.server.close((error) => error ? reject(error) : resolve()))
  }
}
