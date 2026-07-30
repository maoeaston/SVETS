import { pbkdf2Sync } from 'crypto'
import {
  canonicalJson,
  canonicalJsonBytes,
  sha256Hex,
  type CanonicalJsonValue
} from '../../domain/event-batch/canonical-json'

export const COMMAND_REQUEST_HASH_SCHEMA_VERSION = 'command-request-hash-v1'
export const SECRET_FINGERPRINT_SCHEMA_VERSION = 'secret-fingerprint-v1'
export const SECRET_FINGERPRINT_PROTOCOL_LABEL = 'svets-command-secret-v1'
export const SECRET_PBKDF2_ITERATIONS = 100_000
export const SECRET_PBKDF2_BYTES = 64

export interface CommandRequestHashContract {
  readonly schemaVersion: typeof COMMAND_REQUEST_HASH_SCHEMA_VERSION
  readonly secretFields: readonly string[]
  readonly secretIdentityFields: readonly string[]
}

export class CommandRequestHashError extends Error {
  constructor(message: string, public readonly field = '$') {
    super(`[command-request-hash] ${message} at ${field}`)
    this.name = 'CommandRequestHashError'
  }
}

type CanonicalRecord = Record<string, CanonicalJsonValue>

function commandType(value: string): string {
  if (!value || value !== value.trim() || /\s/.test(value) || value.length > 256) {
    throw new CommandRequestHashError('command type is invalid', '$.command_type')
  }
  return value
}

function fieldPath(value: string): string[] {
  if (!value || value !== value.trim()) throw new CommandRequestHashError('field path is invalid')
  const parts = value.split('.')
  if (parts.some((part) => !/^[A-Za-z][A-Za-z0-9_]*$/.test(part))) {
    throw new CommandRequestHashError('field path is invalid', value)
  }
  return parts
}

function exactUniquePaths(values: readonly string[], label: string): string[] {
  if (!Array.isArray(values)) throw new CommandRequestHashError(`${label} must be an array`)
  const paths = values.map((value) => {
    if (typeof value !== 'string') throw new CommandRequestHashError(`${label} contains a non-string path`)
    fieldPath(value)
    return value
  })
  if (new Set(paths).size !== paths.length) throw new CommandRequestHashError(`${label} contains duplicates`)
  return paths
}

function getAtPath(record: CanonicalRecord, path: string): CanonicalJsonValue {
  let current: CanonicalJsonValue = record
  for (const part of fieldPath(path)) {
    if (typeof current !== 'object' || current === null || Array.isArray(current) || !Object.hasOwn(current, part)) {
      throw new CommandRequestHashError('declared field is missing', path)
    }
    current = current[part]
  }
  return current
}

function setAtPath(record: CanonicalRecord, path: string, replacement: CanonicalJsonValue): void {
  const parts = fieldPath(path)
  let current: CanonicalRecord = record
  for (const part of parts.slice(0, -1)) {
    const child = current[part]
    if (typeof child !== 'object' || child === null || Array.isArray(child)) {
      throw new CommandRequestHashError('declared field parent is not an object', path)
    }
    current = child
  }
  current[parts.at(-1)!] = replacement
}

function canonicalRecord(value: unknown): CanonicalRecord {
  const encoded = canonicalJson(value)
  const parsed = JSON.parse(encoded) as CanonicalJsonValue
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new CommandRequestHashError('normalized business input must be an object')
  }
  return parsed
}

function secretDomainSalt(command: string, identity: CanonicalRecord): Buffer {
  return Buffer.from(
    `${SECRET_FINGERPRINT_PROTOCOL_LABEL}\u0000${command}\u0000${canonicalJson(identity)}`,
    'utf8'
  )
}

export function createCommandRequestHash(options: {
  commandType: string
  normalizedBusinessInput: unknown
  contract: CommandRequestHashContract
}): string {
  const normalizedCommandType = commandType(options.commandType)
  if (options.contract.schemaVersion !== COMMAND_REQUEST_HASH_SCHEMA_VERSION) {
    throw new CommandRequestHashError('request hash schema version mismatch')
  }
  const secretFields = exactUniquePaths(options.contract.secretFields, 'secretFields')
  const identityFields = exactUniquePaths(options.contract.secretIdentityFields, 'secretIdentityFields')
  if (secretFields.length === 0 && identityFields.length !== 0) {
    throw new CommandRequestHashError('secretIdentityFields require at least one secret field')
  }
  if (secretFields.length > 0 && identityFields.length === 0) {
    throw new CommandRequestHashError('secret commands require stable non-secret identity fields')
  }
  if (secretFields.some((path) => identityFields.includes(path))) {
    throw new CommandRequestHashError('secret and identity fields must not overlap')
  }

  const input = canonicalRecord(options.normalizedBusinessInput)
  const identity = Object.fromEntries(
    identityFields.map((path) => [path, getAtPath(input, path)])
  ) as CanonicalRecord
  const salt = secretDomainSalt(normalizedCommandType, identity)

  for (const path of secretFields) {
    const secret = getAtPath(input, path)
    if (typeof secret !== 'string' || secret.length === 0) {
      throw new CommandRequestHashError('secret field must be a non-empty string', path)
    }
    const digestHex = pbkdf2Sync(
      Buffer.from(secret, 'utf8'),
      salt,
      SECRET_PBKDF2_ITERATIONS,
      SECRET_PBKDF2_BYTES,
      'sha512'
    ).toString('hex')
    setAtPath(input, path, {
      algorithm: 'PBKDF2-SHA512',
      derived_key_bytes: SECRET_PBKDF2_BYTES,
      digest_hex: digestHex,
      iterations: SECRET_PBKDF2_ITERATIONS,
      schema_version: SECRET_FINGERPRINT_SCHEMA_VERSION
    })
  }

  return sha256Hex(canonicalJsonBytes({
    command_type: normalizedCommandType,
    normalized_business_input: input
  }))
}
