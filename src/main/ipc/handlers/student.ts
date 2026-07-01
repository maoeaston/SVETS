// 学生档案 handler 模块。
// 核心逻辑（createStudent / 后续 update / get / list / archive）抽成纯函数，
// 接收 DBAdapter；registerStudentHandlers 是薄包装，调 ipcMain.handle 时
// 把 getDb() 的结果传给纯函数。测试直接调纯函数 + 注入 MemoryAdapter。

import { ipcMain } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import type { DBAdapter } from '../../db/interface'
import { SqliteAdapter } from '../../db/sqlite-adapter'
import { getDatabase } from '../../db/connection'
import { hashPassword } from '../../utils/password'
import { validateSensoryProfile } from '../../utils/validate-sensory-profile'
import { assertCaller } from '../../utils/auth-context'
import type {
  CreateStudentParams,
  CreateStudentResult
} from '../../../shared/types/student'

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Seed 学生档案相关错误码（INSERT OR IGNORE，幂等）。
 * error_category 必须 'SYSTEM'（schema CHECK 枚举不含 'STUDENT_PROFILE'）。
 * exported 供测试 seed 后再调纯函数；registerStudentHandlers 也会调一次。
 */
export function seedStudentErrorCodes(db: DBAdapter): void {
  const codes: Array<[string, 'INFO' | 'ERROR', 'P1' | 'P3', string, string, 0 | 1]> = [
    ['STUDENT_PROFILE_CREATED', 'INFO', 'P3', '学生档案创建', '教师创建学生档案', 0],
    ['STUDENT_PROFILE_UPDATED', 'INFO', 'P3', '学生档案修改', '教师修改学生档案', 0],
    ['STUDENT_PROFILE_ARCHIVED', 'INFO', 'P3', '学生档案归档', '教师归档学生档案', 0],
    ['STUDENT_PROFILE_SYSTEM_ERROR', 'ERROR', 'P1', '学生档案系统异常', '学生档案操作异常', 1]
  ]
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO error_code_registry
       (error_code, error_category, severity, priority_level, title, default_message, is_blocking)
     VALUES (?, 'SYSTEM', ?, ?, ?, ?, ?)`
  )
  for (const c of codes) stmt.run(...c)
}

/**
 * 写审计日志到 error_event_log。
 * [!] 占位符顺序：error_code, severity 分别对应 code, severity（曾误传 code 给 severity，
 * 触发 CHECK 约束导致审计 ABORT，handler 必走 catch 返回 SYSTEM_ERROR）。
 *
 * recovery_status 语义：
 * - INFO 审计行用 'IGNORED'（schema 枚举「无需处理」，非异常，不污染 ERROR 异常查询）
 * - ERROR 异常行用 'UNRESOLVED'（默认值，等运维处理）
 */
function logStudentEvent(
  db: DBAdapter,
  code: string,
  severity: 'INFO' | 'ERROR',
  studentId: string,
  callerUserId: string,
  context: Record<string, unknown>
): void {
  db.prepare(
    `INSERT INTO error_event_log
       (error_event_id, error_code, severity, error_category,
        related_aggregate_type, related_aggregate_id, message, context_json, recovery_status, created_at)
     VALUES (?, ?, ?, 'SYSTEM', 'STUDENT_PROFILE', ?, ?, ?, ?, datetime('now'))`
  ).run(
    uuidv4(),
    code,
    severity,
    studentId,
    `${code} student=${studentId} by=${callerUserId}`,
    JSON.stringify({ callerUserId, ...context }),
    severity === 'INFO' ? 'IGNORED' : 'UNRESOLVED'
  )
}

/**
 * student:create 核心纯函数。事务双写 user_account(STUDENT) + student_profile，
 * 任一失败整体回滚。成功后写 INFO 审计；UNIQUE 冲突转 USERNAME_TAKEN；
 * 其它异常写 ERROR 审计并返回 SYSTEM_ERROR。
 *
 * 同 UUID 复用：user_account.user_id === student_profile.student_id（应用层关联，schema 无 FK）。
 */
export function createStudent(db: DBAdapter, params: CreateStudentParams): CreateStudentResult {
  const caller = assertCaller(db, params.callerUserId, params.callerRole)
  if (!caller.ok) {
    return { success: false, errorCode: 'FORBIDDEN' }
  }

  if (!params.username || !params.password || !params.studentName) {
    return { success: false, errorCode: 'VALIDATION_ERROR' }
  }
  if (params.birthDate && params.birthDate > todayISO()) {
    return { success: false, errorCode: 'VALIDATION_ERROR' }
  }
  const sp = validateSensoryProfile(params.sensoryProfile)
  if (!sp.ok) {
    return { success: false, errorCode: 'INVALID_SENSORY_PROFILE' }
  }

  const studentId = uuidv4()
  const sensoryJson = params.sensoryProfile ? JSON.stringify(params.sensoryProfile) : null

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO user_account (user_id, username, password_hash, role, display_name, status)
       VALUES (?, ?, ?, 'STUDENT', ?, 'ACTIVE')`
    ).run(studentId, params.username, hashPassword(params.password), params.studentName)
    db.prepare(
      `INSERT INTO student_profile (student_id, student_name, gender, birth_date, guardian_contact, sensory_profile_json, status)
       VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')`
    ).run(
      studentId,
      params.studentName,
      params.gender ?? null,
      params.birthDate ?? null,
      params.guardianContact ?? null,
      sensoryJson
    )
  })

  try {
    tx()
  } catch (err) {
    if (String(err).includes('UNIQUE')) {
      return { success: false, errorCode: 'USERNAME_TAKEN' }
    }
    logStudentEvent(db, 'STUDENT_PROFILE_SYSTEM_ERROR', 'ERROR', studentId, caller.row.user_id, {
      error: String(err)
    })
    return { success: false, errorCode: 'SYSTEM_ERROR' }
  }
  logStudentEvent(db, 'STUDENT_PROFILE_CREATED', 'INFO', studentId, caller.row.user_id, {
    username: params.username
  })
  return { success: true, studentId }
}

// 生产默认 getDb：用 SqliteAdapter 包装 better-sqlite3 singleton。
// Adapter 是无状态薄包装，不缓存（每次 IPC 新建一个，开销可忽略）。
function defaultGetDb(): DBAdapter {
  return new SqliteAdapter(getDatabase())
}

export function registerStudentHandlers(getDb: () => DBAdapter = defaultGetDb): void {
  seedStudentErrorCodes(getDb())

  ipcMain.handle('student:create', (_e, params: CreateStudentParams) => {
    return createStudent(getDb(), params)
  })
}
