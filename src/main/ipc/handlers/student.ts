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
  CreateStudentResult,
  StudentListParams,
  StudentListResult,
  GetStudentResult,
  StudentSummary,
  StudentDetail,
  StudentGender,
  StudentStatus,
  SensoryProfileJson
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

// --- 读路径：get + list ---

interface StudentRow {
  student_id: string
  student_name: string
  gender: string | null
  birth_date: string | null
  guardian_contact: string | null
  sensory_profile_json: string | null
  status: string
  created_at: string
  updated_at: string
  username: string
}

function mapSummary(row: StudentRow): StudentSummary {
  return {
    studentId: row.student_id,
    studentName: row.student_name,
    status: row.status as StudentStatus,
    gender: row.gender as StudentGender | null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

/**
 * student:get 核心纯函数。JOIN user_account 取 username；sensory_profile_json
 * 非空时 JSON.parse。**不过滤 status**——ARCHIVED 仍可查到（教师需查看历史档案）。
 */
export function getStudent(
  db: DBAdapter,
  params: { callerUserId: unknown; callerRole: unknown; studentId: unknown }
): GetStudentResult {
  const caller = assertCaller(db, params.callerUserId, params.callerRole)
  if (!caller.ok) {
    return { success: false, errorCode: 'FORBIDDEN' }
  }
  if (typeof params.studentId !== 'string' || params.studentId.length === 0) {
    return { success: false, errorCode: 'NOT_FOUND' }
  }
  const row = db
    .prepare(
      `SELECT sp.student_id, sp.student_name, sp.gender, sp.birth_date, sp.guardian_contact,
              sp.sensory_profile_json, sp.status, sp.created_at, sp.updated_at, ua.username
         FROM student_profile sp
         JOIN user_account ua ON ua.user_id = sp.student_id
        WHERE sp.student_id = ?`
    )
    .get(params.studentId) as StudentRow | undefined
  if (!row) {
    return { success: false, errorCode: 'NOT_FOUND' }
  }
  let sensoryProfile: SensoryProfileJson | null = null
  if (row.sensory_profile_json) {
    try {
      sensoryProfile = JSON.parse(row.sensory_profile_json) as SensoryProfileJson
    } catch {
      // 数据已落库但 JSON 解析失败——理论不应发生（写入前 stringify）。
      // 不抛错，按 null 返回；上层可观察 sensoryProfile=null 判断「无感官画像」。
      sensoryProfile = null
    }
  }
  const detail: StudentDetail = {
    ...mapSummary(row),
    birthDate: row.birth_date,
    guardianContact: row.guardian_contact,
    sensoryProfile,
    username: row.username
  }
  return { success: true, student: detail }
}

/**
 * student:list 核心纯函数。
 * - 默认只列 ACTIVE；includeArchived=true 加上 ARCHIVED（INACTIVE 不出现，PRD：保留不用）
 * - 按 created_at DESC；每页 20 条
 * - page 防御：非有限数 → 1；< 1 → 1；非整数 → 向下取整
 * - search 在 student_name 上做 LIKE %kw%（不转义 % / _，MVP 接受）
 */
export function listStudents(db: DBAdapter, params: StudentListParams): StudentListResult {
  const caller = assertCaller(db, params.callerUserId, params.callerRole)
  if (!caller.ok) {
    return { success: false, errorCode: 'FORBIDDEN' }
  }

  const statuses = params.includeArchived ? ['ACTIVE', 'ARCHIVED'] : ['ACTIVE']
  const placeholders = statuses.map(() => '?').join(',')

  const rawPage =
    typeof params.page === 'number' && Number.isFinite(params.page) ? params.page : 1
  const safePage = Math.max(1, Math.floor(rawPage))
  const offset = (safePage - 1) * 20

  const orderBy = 'ORDER BY sp.created_at DESC LIMIT 20 OFFSET ?'
  let rows: StudentRow[]
  if (typeof params.search === 'string' && params.search.length > 0) {
    rows = db
      .prepare(
        `SELECT sp.student_id, sp.student_name, sp.gender, sp.birth_date, sp.guardian_contact,
                sp.sensory_profile_json, sp.status, sp.created_at, sp.updated_at, ua.username
           FROM student_profile sp
           JOIN user_account ua ON ua.user_id = sp.student_id
          WHERE sp.status IN (${placeholders}) AND sp.student_name LIKE ?
          ${orderBy}`
      )
      .all(...statuses, `%${params.search}%`, offset) as StudentRow[]
  } else {
    rows = db
      .prepare(
        `SELECT sp.student_id, sp.student_name, sp.gender, sp.birth_date, sp.guardian_contact,
                sp.sensory_profile_json, sp.status, sp.created_at, sp.updated_at, ua.username
           FROM student_profile sp
           JOIN user_account ua ON ua.user_id = sp.student_id
          WHERE sp.status IN (${placeholders})
          ${orderBy}`
      )
      .all(...statuses, offset) as StudentRow[]
  }

  return { success: true, items: rows.map(mapSummary), page: safePage }
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
  ipcMain.handle(
    'student:get',
    (_e, params: { callerUserId: string; callerRole: string; studentId: string }) => {
      return getStudent(getDb(), params)
    }
  )
  ipcMain.handle('student:list', (_e, params: StudentListParams) => {
    return listStudents(getDb(), params)
  })
}
