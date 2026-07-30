export const TRANSPORT_METADATA_SCHEMA_VERSION = 1 as const

export interface TransportMetadataV1 {
  readonly schemaVersion: typeof TRANSPORT_METADATA_SCHEMA_VERSION
  readonly clientInstanceId: string
  readonly idempotencyKey: string
  readonly deviceId: string | null
}

export class TransportMetadataError extends Error {
  constructor(message: string) {
    super(`[command-transport] ${message}`)
    this.name = 'TransportMetadataError'
  }
}

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TRANSPORT_KEYS = Object.freeze([
  'clientInstanceId',
  'deviceId',
  'idempotencyKey',
  'schemaVersion'
])

function identifier(value: unknown, field: string, uuid = false): string {
  if (
    typeof value !== 'string'
    || !value.length
    || value !== value.trim()
    || new TextEncoder().encode(value).length > 512
    || (uuid && !UUID_V4_PATTERN.test(value))
  ) {
    throw new TransportMetadataError(`${field} is invalid`)
  }
  return value
}

export function validateTransportMetadataV1(value: unknown): Readonly<TransportMetadataV1> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TransportMetadataError('metadata must be a plain object')
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TransportMetadataError('metadata must be a plain object')
  }
  const input = value as Record<string, unknown>
  const keys = Object.keys(input).sort()
  if (keys.length !== TRANSPORT_KEYS.length || keys.some((key, index) => key !== TRANSPORT_KEYS[index])) {
    throw new TransportMetadataError('metadata field set mismatch')
  }
  if (input.schemaVersion !== TRANSPORT_METADATA_SCHEMA_VERSION) {
    throw new TransportMetadataError('schemaVersion mismatch')
  }
  const deviceId = input.deviceId === null ? null : identifier(input.deviceId, 'deviceId')
  return Object.freeze({
    schemaVersion: TRANSPORT_METADATA_SCHEMA_VERSION,
    clientInstanceId: identifier(input.clientInstanceId, 'clientInstanceId', true),
    idempotencyKey: identifier(input.idempotencyKey, 'idempotencyKey', true),
    deviceId
  })
}
