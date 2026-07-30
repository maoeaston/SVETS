import {
  canonicalJson,
  parseCanonicalJson,
  type CanonicalJsonValue
} from '../../domain/event-batch/canonical-json'

export const COMMAND_RESULT_SCHEMA_VERSION = 'command-result-v1'

export interface CommandResultEnvelopeV1 {
  readonly schema_version: typeof COMMAND_RESULT_SCHEMA_VERSION
  readonly public_result: Readonly<Record<string, CanonicalJsonValue>>
}

export class CommandResultError extends Error {
  constructor(message: string) {
    super(`[command-result] ${message}`)
    this.name = 'CommandResultError'
  }
}

const RESULT_KEYS = Object.freeze(['public_result', 'schema_version'])
const SENSITIVE_RESULT_KEY_MARKERS = Object.freeze([
  'credential',
  'password',
  'secret',
  'token'
])

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

function isSensitiveResultKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '')
  return SENSITIVE_RESULT_KEY_MARKERS.some((marker) => normalized.includes(marker))
}

function publicResult(value: unknown): Readonly<Record<string, CanonicalJsonValue>> {
  const normalized = JSON.parse(canonicalJson(value)) as CanonicalJsonValue
  if (typeof normalized !== 'object' || normalized === null || Array.isArray(normalized)) {
    throw new CommandResultError('public_result must be an object')
  }
  const result = normalized as Record<string, CanonicalJsonValue>
  if (typeof result.success !== 'boolean') {
    throw new CommandResultError('public_result.success must be boolean')
  }
  const inspect = (current: CanonicalJsonValue, path: string): void => {
    if (current === null || typeof current !== 'object') return
    if (Array.isArray(current)) {
      current.forEach((entry, index) => inspect(entry, `${path}[${index}]`))
      return
    }
    for (const [key, entry] of Object.entries(current)) {
      if (isSensitiveResultKey(key)) {
        throw new CommandResultError(`sensitive field ${path}.${key} is forbidden`)
      }
      inspect(entry, `${path}.${key}`)
    }
  }
  inspect(result, '$.public_result')
  return deepFreeze(result)
}

export function createCommandResultJson(value: unknown): string {
  return canonicalJson({
    schema_version: COMMAND_RESULT_SCHEMA_VERSION,
    public_result: publicResult(value)
  })
}

export function parseCommandResultJson(value: string): CommandResultEnvelopeV1 {
  if (typeof value !== 'string' || !value.length || value.endsWith('\n')) {
    throw new CommandResultError('result_json must be non-empty canonical JSON without LF')
  }
  const parsed = parseCanonicalJson(value)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new CommandResultError('result envelope must be an object')
  }
  const keys = Object.keys(parsed).sort()
  if (keys.length !== RESULT_KEYS.length || keys.some((key, index) => key !== RESULT_KEYS[index])) {
    throw new CommandResultError('result envelope field set mismatch')
  }
  if (parsed.schema_version !== COMMAND_RESULT_SCHEMA_VERSION) {
    throw new CommandResultError('result schema version mismatch')
  }
  return Object.freeze({
    schema_version: COMMAND_RESULT_SCHEMA_VERSION,
    public_result: publicResult(parsed.public_result)
  })
}
