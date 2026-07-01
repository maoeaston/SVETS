// student:create 集成测试：直接调 createStudent 纯函数，注入 MemoryAdapter。
// 完全不触碰 ipcMain / Electron / better-sqlite3 原生模块。

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createStudent, seedStudentErrorCodes } from '../student'
import { createTestDb, seedCaller } from '../../../db/test-helpers'
import { verifyPassword } from '../../../utils/password'
import type { MemoryAdapter } from '../../../db/memory-adapter'
import type { CreateStudentParams } from '../../../../shared/types/student'

let db: MemoryAdapter
let callerId: string

function baseParams(over: Partial<CreateStudentParams> = {}): CreateStudentParams {
  return {
    callerUserId: callerId,
    callerRole: 'TEACHER',
    username: `student_${Math.random().toString(36).slice(2, 10)}`,
    password: 'initial-pwd-123',
    studentName: '张三',
    ...over
  }
}

beforeAll(async () => {
  db = await createTestDb()
})

afterAll(() => {
  db.close()
})

beforeEach(() => {
  // 每个测试清空 user_account / student_profile / error_event_log，
  // 重新 seed 一个 caller，保证用例独立。
  db.exec('DELETE FROM error_event_log')
  db.exec('DELETE FROM student_profile')
  db.exec('DELETE FROM user_account')
  seedStudentErrorCodes(db)
  callerId = seedCaller(db, 'TEACHER')
})

describe('student:create — 正常路径', () => {
  it('创建成功：返回 studentId，user_account + student_profile 各 1 条', () => {
    const params = baseParams({ username: 'zhang_san_unique', studentName: '张三' })
    const r = createStudent(db, params)
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.studentId).toBeTruthy()

    const ua = db
      .prepare('SELECT user_id, username, role, display_name, status FROM user_account WHERE user_id = ?')
      .get(r.studentId) as { user_id: string; username: string; role: string; display_name: string; status: string }
    expect(ua.username).toBe('zhang_san_unique')
    expect(ua.role).toBe('STUDENT')
    expect(ua.display_name).toBe('张三')
    expect(ua.status).toBe('ACTIVE')

    const sp = db
      .prepare('SELECT student_id, student_name, status FROM student_profile WHERE student_id = ?')
      .get(r.studentId) as { student_id: string; student_name: string; status: string }
    expect(sp.student_name).toBe('张三')
    expect(sp.status).toBe('ACTIVE')
  })

  it('同 UUID 复用：user_account.user_id === student_profile.student_id', () => {
    const r = createStudent(db, baseParams())
    if (!r.success) throw new Error('expected success')
    const uaCount = db
      .prepare('SELECT COUNT(*) AS c FROM user_account WHERE user_id = ?')
      .get(r.studentId) as { c: number }
    const spCount = db
      .prepare('SELECT COUNT(*) AS c FROM student_profile WHERE student_id = ?')
      .get(r.studentId) as { c: number }
    expect(uaCount.c).toBe(1)
    expect(spCount.c).toBe(1)
  })

  it('密码以哈希存储：verifyPassword(initialPwd, hash) === true', () => {
    const r = createStudent(db, baseParams({ password: 'plain-pwd' }))
    if (!r.success) throw new Error('expected success')
    const row = db
      .prepare('SELECT password_hash FROM user_account WHERE user_id = ?')
      .get(r.studentId) as { password_hash: string }
    expect(verifyPassword('plain-pwd', row.password_hash)).toBe(true)
    expect(verifyPassword('wrong-pwd', row.password_hash)).toBe(false)
  })

  it('完整字段（含 gender / birthDate / guardianContact / sensoryProfile）落库正确', () => {
    const r = createStudent(
      db,
      baseParams({
        username: 'full_fields_user',
        gender: 'MALE',
        birthDate: '2000-01-01',
        guardianContact: '13800000000',
        sensoryProfile: {
          noise_sensitivity: 'HIGH',
          light_sensitivity: 'LOW',
          tactile_sensitivity: null,
          crowd_density_sensitivity: 'MEDIUM',
          avoid_tags: ['NOISY'],
          notes: 'test note'
        }
      })
    )
    expect(r.success).toBe(true)
    if (!r.success) return
    const row = db
      .prepare(
        'SELECT gender, birth_date, guardian_contact, sensory_profile_json FROM student_profile WHERE student_id = ?'
      )
      .get(r.studentId) as {
      gender: string
      birth_date: string
      guardian_contact: string
      sensory_profile_json: string
    }
    expect(row.gender).toBe('MALE')
    expect(row.birth_date).toBe('2000-01-01')
    expect(row.guardian_contact).toBe('13800000000')
    expect(JSON.parse(row.sensory_profile_json)).toMatchObject({
      noise_sensitivity: 'HIGH',
      avoid_tags: ['NOISY']
    })
  })

  it('sensoryProfile = null → sensory_profile_json IS NULL', () => {
    const r = createStudent(db, baseParams({ sensoryProfile: null }))
    expect(r.success).toBe(true)
    if (!r.success) return
    const row = db
      .prepare('SELECT sensory_profile_json FROM student_profile WHERE student_id = ?')
      .get(r.studentId) as { sensory_profile_json: string | null }
    expect(row.sensory_profile_json).toBeNull()
  })
})

describe('student:create — 审计', () => {
  it('成功后写 1 条 INFO 审计：error_category=SYSTEM, related_aggregate_type=STUDENT_PROFILE, related_aggregate_id=studentId', () => {
    const r = createStudent(db, baseParams({ username: 'audited_user' }))
    if (!r.success) throw new Error('expected success')
    const row = db
      .prepare(
        `SELECT error_code, severity, error_category, related_aggregate_type, related_aggregate_id, context_json, recovery_status
         FROM error_event_log WHERE related_aggregate_id = ?`
      )
      .get(r.studentId) as {
      error_code: string
      severity: string
      error_category: string
      related_aggregate_type: string
      related_aggregate_id: string
      context_json: string
      recovery_status: string
    }
    expect(row.error_code).toBe('STUDENT_PROFILE_CREATED')
    expect(row.severity).toBe('INFO')
    expect(row.error_category).toBe('SYSTEM')
    expect(row.related_aggregate_type).toBe('STUDENT_PROFILE')
    expect(row.related_aggregate_id).toBe(r.studentId)
    expect(row.recovery_status).toBe('IGNORED')
    expect(JSON.parse(row.context_json)).toMatchObject({
      callerUserId: callerId,
      username: 'audited_user'
    })
  })
})

describe('student:create — 失败路径', () => {
  it('callerRole=STUDENT → FORBIDDEN（不写任何数据）', () => {
    const r = createStudent(db, baseParams({ callerRole: 'STUDENT' }))
    expect(r).toEqual({ success: false, errorCode: 'FORBIDDEN' })
    const c = db.prepare('SELECT COUNT(*) AS c FROM student_profile').get() as { c: number }
    expect(c.c).toBe(0)
  })

  it('caller 不存在 → FORBIDDEN', () => {
    const r = createStudent(db, baseParams({ callerUserId: 'nonexistent-uuid' }))
    expect(r).toEqual({ success: false, errorCode: 'FORBIDDEN' })
  })

  it('caller 存在但 role 不符（callerRole=ADMIN 而 user 是 TEACHER）→ FORBIDDEN', () => {
    const r = createStudent(db, baseParams({ callerRole: 'ADMIN' }))
    expect(r).toEqual({ success: false, errorCode: 'FORBIDDEN' })
  })

  it('caller 存在但 DISABLED → FORBIDDEN', () => {
    const disabled = seedCaller(db, 'TEACHER') // ACTIVE
    // 直接 UPDATE 改 DISABLED
    db.prepare(`UPDATE user_account SET status='DISABLED' WHERE user_id = ?`).run(disabled)
    const r = createStudent(db, baseParams({ callerUserId: disabled }))
    expect(r).toEqual({ success: false, errorCode: 'FORBIDDEN' })
  })

  it('username 缺失 → VALIDATION_ERROR', () => {
    const r = createStudent(db, baseParams({ username: '' }))
    expect(r).toEqual({ success: false, errorCode: 'VALIDATION_ERROR' })
  })

  it('password 缺失 → VALIDATION_ERROR', () => {
    const r = createStudent(db, baseParams({ password: '' }))
    expect(r).toEqual({ success: false, errorCode: 'VALIDATION_ERROR' })
  })

  it('studentName 缺失 → VALIDATION_ERROR', () => {
    const r = createStudent(db, baseParams({ studentName: '' }))
    expect(r).toEqual({ success: false, errorCode: 'VALIDATION_ERROR' })
  })

  it('birthDate 未来 → VALIDATION_ERROR', () => {
    const future = new Date()
    future.setFullYear(future.getFullYear() + 1)
    const r = createStudent(db, baseParams({ birthDate: future.toISOString().slice(0, 10) }))
    expect(r).toEqual({ success: false, errorCode: 'VALIDATION_ERROR' })
  })

  it('sensoryProfile 枚举越界 → INVALID_SENSORY_PROFILE', () => {
    const r = createStudent(
      db,
      baseParams({
        sensoryProfile: {
          noise_sensitivity: 'EXTREME',
          light_sensitivity: null,
          tactile_sensitivity: null,
          crowd_density_sensitivity: null,
          avoid_tags: [],
          notes: ''
        } as never
      })
    )
    expect(r).toEqual({ success: false, errorCode: 'INVALID_SENSORY_PROFILE' })
  })

  it('username 重复 → USERNAME_TAKEN（user_account 计数不变）', () => {
    const first = createStudent(db, baseParams({ username: 'dup_user' }))
    expect(first.success).toBe(true)
    const beforeCount = db.prepare('SELECT COUNT(*) AS c FROM user_account').get() as { c: number }
    const second = createStudent(
      db,
      baseParams({ username: 'dup_user', studentName: '李四' })
    )
    expect(second).toEqual({ success: false, errorCode: 'USERNAME_TAKEN' })
    const afterCount = db.prepare('SELECT COUNT(*) AS c FROM user_account').get() as { c: number }
    expect(afterCount.c).toBe(beforeCount.c)
  })
})

describe('student:create — 事务回滚', () => {
  it('student_profile INSERT 抛错 → user_account 计数 0（回滚成功）', () => {
    const originalPrepare = db.prepare.bind(db)
    ;(db as { prepare: (sql: string) => unknown }).prepare = (sql: string) => {
      // assertCaller 的 SELECT 放行；user_account INSERT 放行；
      // 命中 student_profile INSERT 时模拟失败。
      if (sql.includes('INSERT INTO student_profile')) {
        throw new Error('simulated failure for rollback test')
      }
      return originalPrepare(sql)
    }

    try {
      const r = createStudent(db, baseParams({ username: 'rollback_test' }))
      expect(r).toEqual({ success: false, errorCode: 'SYSTEM_ERROR' })
      const uaCount = db
        .prepare('SELECT COUNT(*) AS c FROM user_account WHERE username = ?')
        .get('rollback_test') as { c: number }
      expect(uaCount.c).toBe(0) // 回滚成功：连 user_account 都没留下
    } finally {
      ;(db as { prepare: (sql: string) => unknown }).prepare = originalPrepare
    }
  })

  it('SYSTEM_ERROR 路径写 ERROR 审计（recovery_status=UNRESOLVED）', () => {
    const originalPrepare = db.prepare.bind(db)
    ;(db as { prepare: (sql: string) => unknown }).prepare = (sql: string) => {
      if (sql.includes('INSERT INTO student_profile')) {
        throw new Error('simulated failure for audit test')
      }
      return originalPrepare(sql)
    }

    try {
      const r = createStudent(db, baseParams({ username: 'audit_on_error' }))
      expect(r.success).toBe(false)
      const auditRow = db
        .prepare(
          `SELECT severity, error_category, recovery_status, context_json
           FROM error_event_log WHERE error_code = 'STUDENT_PROFILE_SYSTEM_ERROR'`
        )
        .get() as { severity: string; error_category: string; recovery_status: string; context_json: string }
      expect(auditRow.severity).toBe('ERROR')
      expect(auditRow.error_category).toBe('SYSTEM')
      expect(auditRow.recovery_status).toBe('UNRESOLVED')
      expect(JSON.parse(auditRow.context_json).error).toContain('simulated failure')
    } finally {
      ;(db as { prepare: (sql: string) => unknown }).prepare = originalPrepare
    }
  })
})
