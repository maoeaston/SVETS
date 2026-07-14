import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ITERATIONS = 100_000
const KEY_LEN = 64
const DIGEST = 'sha512'

export function loadDevAccounts(projectRoot) {
  return JSON.parse(
    readFileSync(join(projectRoot, 'src', 'shared', 'config', 'dev-accounts.json'), 'utf8')
  )
}

export function hashDevPassword(password) {
  const salt = randomBytes(16).toString('hex')
  const hash = pbkdf2Sync(password, salt, ITERATIONS, KEY_LEN, DIGEST).toString('hex')
  return `pbkdf2:${DIGEST}:${ITERATIONS}:${salt}:${hash}`
}

export function verifyDevPassword(password, stored) {
  const parts = String(stored).split(':')
  if (parts.length !== 5 || parts[0] !== 'pbkdf2') return false
  const [, digest, iterText, salt, expected] = parts
  const iterations = Number.parseInt(iterText, 10)
  if (!Number.isInteger(iterations) || iterations <= 0) return false
  try {
    const actual = pbkdf2Sync(password, salt, iterations, KEY_LEN, digest)
    const expectedBuffer = Buffer.from(expected, 'hex')
    return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer)
  } catch {
    return false
  }
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

export function buildDevAccountSeedSql(accounts) {
  const accountStatements = accounts.map((account) => `
INSERT INTO user_account (user_id, username, password_hash, role, display_name, status)
VALUES (
  ${sqlString(account.userId)},
  ${sqlString(account.username)},
  ${sqlString(hashDevPassword(account.password))},
  ${sqlString(account.role)},
  ${sqlString(account.displayName)},
  'ACTIVE'
)
ON CONFLICT(username) DO UPDATE SET
  password_hash = excluded.password_hash,
  role = excluded.role,
  display_name = excluded.display_name,
  status = 'ACTIVE',
  updated_at = datetime('now');`)

  return `${accountStatements.join('\n')}

INSERT INTO student_profile (student_id, student_name, user_id, status)
SELECT 'seed-student-001', '测试学生', user_id, 'ACTIVE'
FROM user_account
WHERE username = 'student'
ON CONFLICT(student_id) DO UPDATE SET
  student_name = excluded.student_name,
  user_id = excluded.user_id,
  status = 'ACTIVE',
  updated_at = datetime('now');`
}
