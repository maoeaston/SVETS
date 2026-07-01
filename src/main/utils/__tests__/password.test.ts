import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword } from '../password'

describe('hashPassword', () => {
  it('returns pbkdf2:sha512:... format', () => {
    const hash = hashPassword('secret')
    expect(hash).toMatch(/^pbkdf2:sha512:\d+:[0-9a-f]+:[0-9a-f]+$/)
  })

  it('produces different hashes for the same password (different salt)', () => {
    const h1 = hashPassword('secret')
    const h2 = hashPassword('secret')
    expect(h1).not.toBe(h2)
  })
})

describe('verifyPassword', () => {
  it('returns true for correct password', () => {
    const hash = hashPassword('correct')
    expect(verifyPassword('correct', hash)).toBe(true)
  })

  it('returns false for wrong password', () => {
    const hash = hashPassword('correct')
    expect(verifyPassword('wrong', hash)).toBe(false)
  })

  it('returns false for malformed stored string', () => {
    expect(verifyPassword('any', 'not-a-valid-hash')).toBe(false)
    expect(verifyPassword('any', '')).toBe(false)
    expect(verifyPassword('any', 'pbkdf2:sha512:abc:salt')).toBe(false) // only 4 parts
  })

  it('returns false when iterations is not a number', () => {
    expect(verifyPassword('any', 'pbkdf2:sha512:NaN:aabbcc:ddeeff')).toBe(false)
  })

  it('returns false when hash lengths differ (timingSafeEqual edge case)', () => {
    // Manually craft a stored value with a truncated hash
    const hash = hashPassword('test')
    const parts = hash.split(':')
    parts[4] = parts[4].slice(0, 10) // truncate hash
    expect(verifyPassword('test', parts.join(':'))).toBe(false)
  })
})
