import { describe, expect, it } from 'vitest'
import {
  CanonicalJsonError,
  canonicalJson,
  canonicalizeJson,
  sha256CanonicalJson
} from '../report-canonical'

describe('report canonical JSON', () => {
  it('sorts object keys recursively and keeps the fixed SHA-256 vector', () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}')
    expect(sha256CanonicalJson({ b: 2, a: 1 })).toBe(
      '43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777'
    )
  })

  it('preserves array order while sorting nested object keys', () => {
    expect(canonicalizeJson([{ b: 2, a: 1 }, { d: 4, c: 3 }])).toEqual([
      { a: 1, b: 2 },
      { c: 3, d: 4 }
    ])
    expect(sha256CanonicalJson(['first', 'second'])).not.toBe(
      sha256CanonicalJson(['second', 'first'])
    )
  })

  it.each([
    ['undefined', undefined],
    ['function', () => undefined],
    ['symbol', Symbol('x')],
    ['NaN', Number.NaN],
    ['infinity', Number.POSITIVE_INFINITY]
  ])('rejects %s because it is not canonical JSON', (_label, value) => {
    expect(() => canonicalJson(value)).toThrow(CanonicalJsonError)
  })

  it('rejects cyclic structures with their field path', () => {
    const value: { self?: unknown } = {}
    value.self = value
    expect(() => canonicalJson(value)).toThrow('$.self: cyclic reference is not allowed')
  })
})
