import { createHash } from 'crypto'

export type CanonicalJsonPrimitive = string | number | boolean | null
export type CanonicalJsonValue =
  | CanonicalJsonPrimitive
  | CanonicalJsonValue[]
  | { [key: string]: CanonicalJsonValue }

export class CanonicalJsonError extends Error {
  constructor(
    public readonly path: string,
    message: string
  ) {
    super(`${path}: ${message}`)
    this.name = 'CanonicalJsonError'
  }
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function canonicalizeInternal(value: unknown, path: string, ancestors: Set<object>): CanonicalJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new CanonicalJsonError(path, 'number must be finite')
    return value
  }

  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new CanonicalJsonError(path, 'cyclic reference is not allowed')
    ancestors.add(value)
    try {
      return value.map((item, index) => canonicalizeInternal(item, `${path}[${index}]`, ancestors))
    } finally {
      ancestors.delete(value)
    }
  }

  if (typeof value === 'object') {
    if (!isPlainObject(value)) throw new CanonicalJsonError(path, 'value must be a plain object')
    if (ancestors.has(value)) throw new CanonicalJsonError(path, 'cyclic reference is not allowed')
    ancestors.add(value)
    try {
      const normalized: { [key: string]: CanonicalJsonValue } = {}
      for (const key of Object.keys(value).sort()) {
        normalized[key] = canonicalizeInternal(value[key], `${path}.${key}`, ancestors)
      }
      return normalized
    } finally {
      ancestors.delete(value)
    }
  }

  throw new CanonicalJsonError(path, `${typeof value} is not valid JSON`)
}

export function canonicalizeJson(value: unknown): CanonicalJsonValue {
  return canonicalizeInternal(value, '$', new Set<object>())
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalizeJson(value))
}

export function sha256CanonicalJson(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')
}
