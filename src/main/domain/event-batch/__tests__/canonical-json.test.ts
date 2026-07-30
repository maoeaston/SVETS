import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import {
  canonicalJson,
  canonicalJsonBytes,
  CanonicalJsonError,
  parseCanonicalJson,
  parseCanonicalJsonLine,
  sha256CanonicalJson
} from '../canonical-json'

const golden = JSON.parse(readFileSync(
  resolve(process.cwd(), 'scripts/fixtures/m5b-event-batch-golden-v1.json'),
  'utf8'
))

describe('M5B canonical JSON', () => {
  it('matches the frozen recursive key-order and UTF-8 vector', () => {
    expect(canonicalJson(golden.canonical.input)).toBe(golden.canonical.json)
    expect(canonicalJsonBytes(golden.canonical.input).toString('hex')).toBe(golden.canonical.utf8_hex)
    expect(canonicalJson({ m: { x: -0, y: 'line\n' }, a: '雪', z: [3, { a: null, b: true }] }))
      .toBe(golden.canonical.json)
  })

  it('preserves array order and emits exactly one optional LF', () => {
    expect(canonicalJson([3, 2, 1])).toBe('[3,2,1]')
    expect(canonicalJsonBytes({ b: 2, a: 1 }, true).toString('utf8')).toBe('{"a":1,"b":2}\n')
    expect(canonicalJsonBytes({ b: 2, a: 1 }, false).toString('utf8')).toBe('{"a":1,"b":2}')
  })

  it('rejects every non-JSON scalar/container instead of inheriting JSON.stringify coercion', () => {
    const sparse = new Array(1)
    const decorated = [1] as unknown[] & { extra?: number }
    decorated.extra = 2
    const hidden = { visible: true }
    Object.defineProperty(hidden, 'hidden', { value: true, enumerable: false })
    const accessor = Object.defineProperty({}, 'value', { enumerable: true, get: () => 1 })
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic

    for (const value of [
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      1n,
      Symbol('x'),
      () => undefined,
      new Date('2026-07-29T00:00:00.000Z'),
      new Map(),
      sparse,
      decorated,
      hidden,
      accessor,
      cyclic
    ]) {
      expect(() => canonicalJson(value)).toThrow(CanonicalJsonError)
    }
  })

  it('rejects excessive depth with a stable path-aware error', () => {
    let value: unknown = null
    for (let index = 0; index < 258; index += 1) value = { nested: value }
    expect(() => canonicalJson(value)).toThrow(/maximum depth 256 exceeded/)
  })

  it('accepts only byte-exact canonical JSON and LF-framed records', () => {
    expect(parseCanonicalJson(golden.canonical.json)).toEqual(golden.canonical.input)
    expect(parseCanonicalJsonLine(Buffer.from(`${golden.canonical.json}\n`, 'utf8'))).toEqual(golden.canonical.input)
    for (const text of [
      ` ${golden.canonical.json}`,
      '{"z":1,"a":2}',
      '{"a":1,"a":1}',
      '{"a": 1}'
    ]) {
      expect(() => parseCanonicalJson(text)).toThrow(/not canonical/)
    }
    for (const bytes of [
      Buffer.from(golden.canonical.json, 'utf8'),
      Buffer.from(`${golden.canonical.json}\r\n`, 'utf8'),
      Buffer.from(`${golden.canonical.json}\n{}\n`, 'utf8'),
      Buffer.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0xff, 0x7d, 0x0a])
    ]) {
      expect(() => parseCanonicalJsonLine(bytes)).toThrow(CanonicalJsonError)
    }
  })

  it('hashes canonical payload bytes independently of source key order', () => {
    expect(sha256CanonicalJson({ score: 2, response: { selected: 'B', correct: true }, answer_id: 'answer-1' }))
      .toBe(golden.batch.payload_checksums?.[0] ?? golden.batch.events[0].checksum)
    expect(sha256CanonicalJson({ answer_id: 'answer-1', response: { correct: true, selected: 'B' }, score: 2 }))
      .toBe(golden.batch.events[0].checksum)
  })
})
