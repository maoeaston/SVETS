import { randomBytes, pbkdf2Sync, timingSafeEqual } from 'crypto'

const ITERATIONS = 100_000
const KEY_LEN = 64
const DIGEST = 'sha512'

/**
 * 对明文密码生成 pbkdf2 哈希字符串。
 * 格式：pbkdf2:sha512:<iterations>:<salt_hex>:<hash_hex>
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = pbkdf2Sync(password, salt, ITERATIONS, KEY_LEN, DIGEST).toString('hex')
  return `pbkdf2:${DIGEST}:${ITERATIONS}:${salt}:${hash}`
}

/**
 * 校验明文密码是否与存储的哈希匹配。
 * 使用 timingSafeEqual 防止时序攻击。
 */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(':')
  if (parts.length !== 5 || parts[0] !== 'pbkdf2') return false

  const [, digest, iterStr, salt, expectedHash] = parts
  const iters = parseInt(iterStr, 10)
  if (isNaN(iters) || iters <= 0) return false

  const actual = pbkdf2Sync(password, salt, iters, KEY_LEN, digest).toString('hex')

  // timingSafeEqual 要求两个 Buffer 等长，长度不同时抛出 → catch 返回 false
  try {
    return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expectedHash, 'hex'))
  } catch {
    return false
  }
}
