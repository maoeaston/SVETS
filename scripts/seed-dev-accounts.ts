/**
 * 开发环境种子账号脚本。
 * 在本地开发或首次初始化时运行，插入 ADMIN / TEACHER / STUDENT 测试账号。
 *
 * 用法（Electron 启动后 userData 目录已创建）：
 *   npx ts-node --require tsconfig-paths/register scripts/seed-dev-accounts.ts
 *
 * 注意：此脚本直接操作 SQLite，绕过 Electron IPC，仅限开发/测试使用。
 *       生产环境账号由管理员通过管理界面创建。
 */
import Database from 'better-sqlite3'
import { join } from 'path'
import { homedir } from 'os'
import { v4 as uuidv4 } from 'uuid'
import { hashPassword } from '../src/main/utils/password'

// Windows Electron userData 默认路径
// 如在 macOS 或 Linux 开发，请调整 userData 路径
const dataDir = join(homedir(), 'AppData', 'Roaming', 'xc-career-guide', 'data')

const db = new Database(join(dataDir, 'xc-career-guide.db'))

const accounts = [
  { username: 'admin',   password: 'Admin@123',   role: 'ADMIN',   displayName: '系统管理员' },
  { username: 'teacher', password: 'Teacher@123', role: 'TEACHER', displayName: '测试教师' },
  { username: 'student', password: 'Student@123', role: 'STUDENT', displayName: '测试学生' }
]

const stmt = db.prepare(`
  INSERT OR IGNORE INTO user_account
    (user_id, username, password_hash, role, display_name, status)
  VALUES (?, ?, ?, ?, ?, 'ACTIVE')
`)

for (const acc of accounts) {
  const result = stmt.run(
    uuidv4(),
    acc.username,
    hashPassword(acc.password),
    acc.role,
    acc.displayName
  )
  if (result.changes > 0) {
    console.log(`[seed] 已插入 ${acc.role}: ${acc.username} / ${acc.password}`)
  } else {
    console.log(`[seed] 已存在，跳过: ${acc.username}`)
  }
}

db.close()
console.log('[seed] 完成。')
