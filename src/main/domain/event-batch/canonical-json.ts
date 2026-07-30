import { createHash } from 'crypto'
import { TextDecoder } from 'util'

export type CanonicalJsonPrimitive = null | boolean | number | string
export type CanonicalJsonValue =
  | CanonicalJsonPrimitive
  | CanonicalJsonValue[]
  | { [key: string]: CanonicalJsonValue }

export class CanonicalJsonError extends Error {
  constructor(message: string, public readonly path = '$') {
    super(`[canonical-json] ${message} at ${path}`)
    this.name = 'CanonicalJsonError'
  }
}

const MAX_DEPTH = 256

function childPath(parent: string, key: string | number): string {
  return typeof key === 'number' ? `${parent}[${key}]` : `${parent}.${key}`
}

function serialize(value: unknown, path: string, ancestors: WeakSet<object>, depth: number): string {
  if (depth > MAX_DEPTH) throw new CanonicalJsonError(`maximum depth ${MAX_DEPTH} exceeded`, path)
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new CanonicalJsonError('non-finite number is forbidden', path)
    return JSON.stringify(value)
  }
  if (typeof value !== 'object') {
    throw new CanonicalJsonError(`${typeof value} is not a JSON value`, path)
  }
  if (ancestors.has(value)) throw new CanonicalJsonError('cyclic value is forbidden', path)
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      const keys = Object.keys(value)
      if (keys.length !== value.length || keys.some((key, index) => key !== String(index))) {
        throw new CanonicalJsonError('sparse or decorated array is forbidden', path)
      }
      return `[${value.map((entry, index) => serialize(entry, childPath(path, index), ancestors, depth + 1)).join(',')}]`
    }

    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new CanonicalJsonError('only plain JSON objects are accepted', path)
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new CanonicalJsonError('symbol keys are forbidden', path)
    }
    const descriptors = Object.getOwnPropertyDescriptors(value)
    const keys = Object.keys(value).sort()
    if (Object.getOwnPropertyNames(value).length !== keys.length) {
      throw new CanonicalJsonError('non-enumerable fields are forbidden', path)
    }
    for (const key of keys) {
      const descriptor = descriptors[key]
      if (!descriptor || !descriptor.enumerable || descriptor.get || descriptor.set) {
        throw new CanonicalJsonError('accessor or non-enumerable fields are forbidden', childPath(path, key))
      }
    }
    const encoded = keys.map((key) => {
      const entry = serialize((value as Record<string, unknown>)[key], childPath(path, key), ancestors, depth + 1)
      return `${JSON.stringify(key)}:${entry}`
    })
    return `{${encoded.join(',')}}`
  } finally {
    ancestors.delete(value)
  }
}

export function canonicalJson(value: unknown): string {
  return serialize(value, '$', new WeakSet(), 0)
}

export function canonicalJsonBytes(value: unknown, trailingLf = false): Buffer {
  return Buffer.from(`${canonicalJson(value)}${trailingLf ? '\n' : ''}`, 'utf8')
}

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export function sha256CanonicalJson(value: unknown): string {
  return sha256Hex(canonicalJsonBytes(value))
}

export function parseCanonicalJson(text: string): CanonicalJsonValue {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new CanonicalJsonError(`invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  const encoded = canonicalJson(parsed)
  if (encoded !== text) throw new CanonicalJsonError('input is not canonical JSON')
  return parsed as CanonicalJsonValue
}

export function parseCanonicalJsonLine(bytes: Uint8Array): CanonicalJsonValue {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new CanonicalJsonError('record is not valid UTF-8')
  }
  if (!text.endsWith('\n') || text.length === 1 || text.slice(0, -1).includes('\n')) {
    throw new CanonicalJsonError('record must contain exactly one JSON value followed by LF')
  }
  return parseCanonicalJson(text.slice(0, -1))
}
