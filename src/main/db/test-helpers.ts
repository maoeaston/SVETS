// 测试专用 DB helper。仅被 *.test.ts 导入；生产代码不引用，故不进入 Electron 打包。
// createTestDb 用 MemoryAdapter（sql.js / WASM SQLite）+ 加载 schema 源文件，
// 供 handler 集成测试。完全不触碰 better-sqlite3 原生模块，规避 Node/Electron ABI 不匹配。

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { v4 as uuidv4 } from 'uuid'
import { hashPassword } from '../utils/password'
import { MemoryAdapter } from './memory-adapter'
import type { DBAdapter } from './interface'

// schema 文件名含版本号；升级 schema 时同步更新此路径。
const SCHEMA_PATH = resolve(
  process.cwd(),
  'doc/xc-career-guide-mvp-schema-v0.1.7-consistency-guard.sql'
)

/**
 * 创建内存 SQLite（sql.js）并加载完整 schema。
 * sql.js 需先异步加载 WASM，故为 async 工厂；测试在 beforeAll 内 await 调用。
 */
export async function createTestDb(): Promise<MemoryAdapter> {
  const db = await MemoryAdapter.create()
  db.exec(readFileSync(SCHEMA_PATH, 'utf-8'))
  return db
}

/**
 * 插入一个 ACTIVE 的 TEACHER（默认）或 ADMIN 账号，返回 userId 供测试调用 handler。
 */
export function seedCaller(db: DBAdapter, role: 'TEACHER' | 'ADMIN' = 'TEACHER'): string {
  const userId = uuidv4()
  db.prepare(
    `INSERT INTO user_account (user_id, username, password_hash, role, display_name, status)
     VALUES (?, ?, ?, ?, ?, 'ACTIVE')`
  ).run(userId, `caller_${role.toLowerCase()}_${userId.slice(0, 8)}`, hashPassword('x'), role, '测试调用者')
  return userId
}

/**
 * 插入一个 DISABLED 账号（用于测试 caller 状态非 ACTIVE 的拒绝路径）。
 */
export function seedDisabledCaller(db: DBAdapter, role: 'TEACHER' | 'ADMIN' = 'TEACHER'): string {
  const userId = uuidv4()
  db.prepare(
    `INSERT INTO user_account (user_id, username, password_hash, role, display_name, status)
     VALUES (?, ?, ?, ?, ?, 'DISABLED')`
  ).run(userId, `disabled_${role.toLowerCase()}_${userId.slice(0, 8)}`, hashPassword('x'), role, '停用调用者')
  return userId
}
