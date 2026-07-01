#!/usr/bin/env node
/**
 * WSL/Linux 版开发种子脚本（与 seed-dev-accounts.ts 并存）。
 *
 * 用 sqlite3 CLI 子进程插入（正确处理 WAL + 与运行中 Electron 并发读），
 * 用 node:crypto 计算 pbkdf2 哈希（避免 better-sqlite3 在 Node ABI 与
 * Electron ABI 之间的冲突）。
 *
 * Windows 用户继续用 seed-dev-accounts.ts（其路径假设 Windows userData）。
 *
 * 用法：
 *   node scripts/seed-dev-accounts.mjs
 *
 * 前置：
 *   - 已安装 sqlite3 CLI（apt install sqlite3 / pacman -S sqlite）
 *   - DB 已被 Electron 初始化（至少跑过一次 npm run dev）。
 *     若 DB 不存在或无 user_account 表，脚本会报错并提示。
 */
import { randomBytes, pbkdf2Sync, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

// [!] 哈希参数必须与 src/main/utils/password.ts 保持一致（手动同步）。
// 若 password.ts 改了迭代次数或 digest，此处也要改。
const ITERATIONS = 100_000
const KEY_LEN = 64
const DIGEST = 'sha512'

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  const hash = pbkdf2Sync(password, salt, ITERATIONS, KEY_LEN, DIGEST).toString('hex')
  return `pbkdf2:${DIGEST}:${ITERATIONS}:${salt}:${hash}`
}

// 从 package.json 读 appName，构造 Linux Electron userData 路径
// Electron on Linux: ~/.config/<appName>/data/<appName>.db
const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf-8'))
const appName = pkg.name
const dbPath = join(homedir(), '.config', appName, 'data', `${appName}.db`)

if (!existsSync(dbPath)) {
  console.error(`[seed] DB 文件不存在：${dbPath}`)
  console.error('[seed] 请先运行 npm run dev 一次让 Electron 初始化 DB，再跑此脚本。')
  process.exit(1)
}

const accounts = [
  { username: 'admin',   password: 'Admin@123',   role: 'ADMIN',   displayName: '系统管理员' },
  { username: 'teacher', password: 'Teacher@123', role: 'TEACHER', displayName: '测试教师' },
  { username: 'student', password: 'Student@123', role: 'STUDENT', displayName: '测试学生' }
]

function sqlStr(s) {
  // SQL 字符串字面量转义：单引号 → ''
  return `'${String(s).replace(/'/g, "''")}'`
}

// 生成 SQL（INSERT OR IGNORE 幂等——已存在的 username 跳过）
const sql =
  accounts
    .map((acc) => {
      const userId = randomUUID()
      const hash = hashPassword(acc.password)
      return `INSERT OR IGNORE INTO user_account (user_id, username, password_hash, role, display_name, status) VALUES (${sqlStr(userId)}, ${sqlStr(acc.username)}, ${sqlStr(hash)}, ${sqlStr(acc.role)}, ${sqlStr(acc.displayName)}, 'ACTIVE');`
    })
    .join('\n') + '\n'

// 用 sqlite3 CLI 执行（正确处理 WAL；与运行中的 Electron 共存）
try {
  execFileSync('sqlite3', [dbPath], {
    input: sql,
    stdio: ['pipe', 'inherit', 'inherit']
  })
} catch (err) {
  if (err.code === 'ENOENT') {
    console.error('[seed] 未找到 sqlite3 CLI。请先安装：apt install sqlite3 / pacman -S sqlite')
  } else {
    console.error('[seed] sqlite3 执行失败：', err.message)
    console.error('[seed] 若提示 "no such table"，请确认已跑过 npm run dev 初始化 DB schema。')
  }
  process.exit(1)
}

// 验证
const verify = execFileSync('sqlite3', [
  dbPath,
  'SELECT username, role, status FROM user_account ORDER BY role;'
], { encoding: 'utf-8' })

console.log('[seed] 当前账号（DB: ' + dbPath + '）：')
console.log(verify.trimEnd())
console.log('[seed] 完成。')
