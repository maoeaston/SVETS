import { ipcMain } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import { getDatabase } from '../../db/connection'
import { verifyPassword } from '../../utils/password'

type UserRow = {
  user_id: string
  password_hash: string
  role: string
  display_name: string
  status: string
}

// 确保 AUTH 审计错误码存在（INSERT OR IGNORE，不修改 schema.sql）
function seedAuthErrorCodes(): void {
  const db = getDatabase()
  db.prepare(`
    INSERT OR IGNORE INTO error_code_registry
      (error_code, error_category, severity, priority_level, title, default_message, is_blocking)
    VALUES ('AUTH_LOGIN_SUCCESS', 'AUTH', 'INFO', 'P3', '登录成功', '用户登录成功。', 0)
  `).run()
  db.prepare(`
    INSERT OR IGNORE INTO error_code_registry
      (error_code, error_category, severity, priority_level, title, default_message, is_blocking)
    VALUES ('AUTH_LOGIN_FAILED', 'AUTH', 'WARN', 'P3', '登录失败', '用户名或密码错误，或账号已停用。', 0)
  `).run()
}

function logAuth(code: string, message: string): void {
  try {
    const db = getDatabase()
    db.prepare(`
      INSERT INTO error_event_log
        (error_event_id, error_code, severity, error_category, message, created_at)
      VALUES (
        ?,
        ?,
        (SELECT severity FROM error_code_registry WHERE error_code = ?),
        'AUTH',
        ?,
        datetime('now')
      )
    `).run(uuidv4(), code, code, message)
  } catch (err) {
    // 审计写入失败不影响登录流程
    console.error('[Auth] Failed to write audit log:', err)
  }
}

export function registerAuthHandlers(): void {
  seedAuthErrorCodes()

  ipcMain.handle(
    'auth:login',
    (_event, params: { username: string; password: string }) => {
      const db = getDatabase()

      const row = db
        .prepare(
          `SELECT user_id, password_hash, role, display_name, status
           FROM user_account
           WHERE username = ?`
        )
        .get(params.username) as UserRow | undefined

      // 账号不存在或密码错误：统一返回同一错误，不泄露哪个字段错
      if (!row || !verifyPassword(params.password, row.password_hash)) {
        logAuth('AUTH_LOGIN_FAILED', `Login failed for username: ${params.username}`)
        return { success: false as const, errorCode: 'INVALID_CREDENTIALS' as const }
      }

      if (row.status !== 'ACTIVE') {
        logAuth(
          'AUTH_LOGIN_FAILED',
          `Login rejected: account ${row.user_id} status=${row.status}`
        )
        return { success: false as const, errorCode: 'ACCOUNT_DISABLED' as const }
      }

      logAuth('AUTH_LOGIN_SUCCESS', `User ${row.user_id} (${row.role}) logged in`)

      return {
        success: true as const,
        userId: row.user_id,
        role: row.role as 'STUDENT' | 'TEACHER' | 'ADMIN',
        displayName: row.display_name
      }
    }
  )
}
