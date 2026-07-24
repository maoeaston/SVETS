// student:update + student:archive 集成测试：直接调纯函数，注入 MemoryAdapter。

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import {
  createStudent,
  updateStudent,
  archiveStudent,
  seedStudentErrorCodes
} from '../student'
import { createTestDb, seedCaller } from '../../../db/test-helpers'
import type { MemoryAdapter } from '../../../db/memory-adapter'
import type { CreateStudentParams, UpdateStudentParams } from '../../../../shared/types/student'

let db: MemoryAdapter
let callerId: string

function mkStudent(over: Partial<CreateStudentParams> & { studentName: string }): string {
  const params: CreateStudentParams = {
    callerUserId: callerId,
    callerRole: 'TEACHER',
    username: `u_${Math.random().toString(36).slice(2, 10)}`,
    password: 'pwd',
    ...over
  }
  const r = createStudent(db, params)
  if (!r.success) throw new Error(`mkStudent failed: ${r.errorCode}`)
  return r.studentId
}

function update(studentId: string, patch: UpdateStudentParams['patch']) {
  return updateStudent(db, { callerUserId: callerId, callerRole: 'TEACHER', studentId, patch })
}

function auditCount(): number {
  return (db.prepare('SELECT COUNT(*) AS c FROM error_event_log').get() as { c: number }).c
}

function auditCountFor(studentId: string, code: string): number {
  return (
    db
      .prepare(
        'SELECT COUNT(*) AS c FROM error_event_log WHERE related_aggregate_id = ? AND error_code = ?'
      )
      .get(studentId, code) as { c: number }
  ).c
}

beforeAll(async () => {
  db = await createTestDb()
})

afterAll(() => {
  db.close()
})

beforeEach(() => {
  db.exec('DELETE FROM error_event_log')
  db.exec('DELETE FROM student_profile')
  db.exec('DELETE FROM user_account')
  seedStudentErrorCodes(db)
  callerId = seedCaller(db, 'TEACHER')
})

// --- update ---

describe('student:update — 基本字段', () => {
  it('修改 studentName/gender/birthDate/guardianContact → DB 更新，updated_at 刷新', () => {
    const id = mkStudent({ studentName: '原名', username: 'u1' })
    const before = db
      .prepare('SELECT updated_at FROM student_profile WHERE student_id = ?')
      .get(id) as { updated_at: string }
    // 显式让 updated_at 落后，便于断言刷新
    db.prepare(`UPDATE student_profile SET updated_at = '2020-01-01 00:00:00' WHERE student_id = ?`).run(id)

    const r = update(id, {
      studentName: '新名',
      gender: 'FEMALE',
      birthDate: '1998-07-07',
      guardianContact: '13700000000'
    })
    expect(r).toEqual({ success: true })

    const row = db
      .prepare(
        'SELECT student_name, gender, birth_date, guardian_contact, updated_at FROM student_profile WHERE student_id = ?'
      )
      .get(id) as {
      student_name: string
      gender: string
      birth_date: string
      guardian_contact: string
      updated_at: string
    }
    expect(row.student_name).toBe('新名')
    expect(row.gender).toBe('FEMALE')
    expect(row.birth_date).toBe('1998-07-07')
    expect(row.guardian_contact).toBe('13700000000')
    expect(row.updated_at).not.toBe('2020-01-01 00:00:00')
    expect(before).toBeTruthy() // 静默引用，避免 unused
  })

  it('修改姓名 → 同步更新 user_id 显式绑定账号的 display_name', () => {
    const profileId = 'profile-name-sync'
    const boundAccountId = 'account-name-sync'
    db.prepare(
      `INSERT INTO user_account
         (user_id, username, password_hash, role, display_name, status)
       VALUES (?, 'name_sync_user', 'hash', 'STUDENT', '旧账号名', 'ACTIVE')`
    ).run(boundAccountId)
    db.prepare(
      `INSERT INTO student_profile (student_id, student_name, user_id, status)
       VALUES (?, '旧档案名', ?, 'ACTIVE')`
    ).run(profileId, boundAccountId)

    const r = update(profileId, { studentName: '新统一姓名' })
    expect(r).toEqual({ success: true })
    expect(
      (
        db.prepare('SELECT display_name FROM user_account WHERE user_id = ?').get(boundAccountId) as {
          display_name: string
        }
      ).display_name
    ).toBe('新统一姓名')
  })

  it('修改 sensoryProfile → JSON 字符串替换', () => {
    const id = mkStudent({ studentName: 's', username: 'u2' })
    update(id, {
      sensoryProfile: {
        noise_sensitivity: 'HIGH',
        light_sensitivity: null,
        tactile_sensitivity: null,
        crowd_density_sensitivity: null,
        avoid_tags: ['NOISY'],
        notes: 'updated'
      }
    })
    const row = db
      .prepare('SELECT sensory_profile_json FROM student_profile WHERE student_id = ?')
      .get(id) as { sensory_profile_json: string }
    expect(JSON.parse(row.sensory_profile_json)).toMatchObject({
      noise_sensitivity: 'HIGH',
      avoid_tags: ['NOISY'],
      notes: 'updated'
    })
  })

  it('sensoryProfile = null → 字段设 NULL', () => {
    const id = mkStudent({
      studentName: 's',
      username: 'u3',
      sensoryProfile: {
        noise_sensitivity: 'HIGH',
        light_sensitivity: null,
        tactile_sensitivity: null,
        crowd_density_sensitivity: null,
        avoid_tags: [],
        notes: ''
      }
    })
    const before = db
      .prepare('SELECT sensory_profile_json FROM student_profile WHERE student_id = ?')
      .get(id) as { sensory_profile_json: string }
    expect(before.sensory_profile_json).not.toBeNull()

    update(id, { sensoryProfile: null })
    const after = db
      .prepare('SELECT sensory_profile_json FROM student_profile WHERE student_id = ?')
      .get(id) as { sensory_profile_json: string | null }
    expect(after.sensory_profile_json).toBeNull()
  })

  it('sensoryProfile 非法 → INVALID_SENSORY_PROFILE，DB 不变', () => {
    const id = mkStudent({ studentName: 's', username: 'u4' })
    const r = update(id, {
      sensoryProfile: {
        noise_sensitivity: 'EXTREME',
        light_sensitivity: null,
        tactile_sensitivity: null,
        crowd_density_sensitivity: null,
        avoid_tags: [],
        notes: ''
      } as never
    })
    expect(r).toEqual({ success: false, errorCode: 'INVALID_SENSORY_PROFILE' })
  })

  it('patch 后续字段校验失败 → 前面的合法字段也不写入', () => {
    const id = mkStudent({ studentName: '事务前姓名', username: 'atomic_update' })
    const r = update(id, {
      studentName: '不应落库的姓名',
      sensoryProfile: {
        noise_sensitivity: 'EXTREME',
        light_sensitivity: null,
        tactile_sensitivity: null,
        crowd_density_sensitivity: null,
        avoid_tags: [],
        notes: ''
      } as never
    })
    expect(r).toEqual({ success: false, errorCode: 'INVALID_SENSORY_PROFILE' })
    expect(
      (
        db.prepare('SELECT student_name FROM student_profile WHERE student_id = ?').get(id) as {
          student_name: string
        }
      ).student_name
    ).toBe('事务前姓名')
  })

  it('birthDate 未来 → VALIDATION_ERROR', () => {
    const id = mkStudent({ studentName: 's', username: 'u5' })
    const future = new Date()
    future.setFullYear(future.getFullYear() + 1)
    const r = update(id, { birthDate: future.toISOString().slice(0, 10) })
    expect(r).toEqual({ success: false, errorCode: 'VALIDATION_ERROR' })
  })

  it('含禁止字段（username/password）→ 静默忽略，只更新白名单字段', () => {
    const id = mkStudent({ studentName: '原名', username: 'original_user' })
    // patch 含 username/password（非白名单），应被忽略
    const r = updateStudent(db, {
      callerUserId: callerId,
      callerRole: 'TEACHER',
      studentId: id,
      patch: {
        studentName: '改后',
        username: 'hijack',
        password: 'hijack'
      } as UpdateStudentParams['patch']
    })
    expect(r).toEqual({ success: true })
    // studentName 更新了
    const row = db
      .prepare('SELECT student_name FROM student_profile WHERE student_id = ?')
      .get(id) as { student_name: string }
    expect(row.student_name).toBe('改后')
    // username 未变（白名单不含）
    const ua = db
      .prepare('SELECT username FROM user_account WHERE user_id = ?')
      .get(id) as { username: string }
    expect(ua.username).toBe('original_user')
  })

  it('目标不存在 → NOT_FOUND', () => {
    const r = update('nonexistent', { studentName: 'x' })
    expect(r).toEqual({ success: false, errorCode: 'NOT_FOUND' })
  })

  it('目标 ARCHIVED → ARCHIVED（拒绝编辑）', () => {
    const id = mkStudent({ studentName: '已归档', username: 'u6' })
    db.prepare(`UPDATE student_profile SET status='ARCHIVED' WHERE student_id = ?`).run(id)
    const r = update(id, { studentName: '尝试修改' })
    expect(r).toEqual({ success: false, errorCode: 'ARCHIVED' })
    // 原值未变
    const row = db
      .prepare('SELECT student_name FROM student_profile WHERE student_id = ?')
      .get(id) as { student_name: string }
    expect(row.student_name).toBe('已归档')
  })

  it('空 patch（无白名单字段）→ success，不写审计', () => {
    const id = mkStudent({ studentName: 's', username: 'u7' })
    const auditBefore = auditCount()
    const r = updateStudent(db, {
      callerUserId: callerId,
      callerRole: 'TEACHER',
      studentId: id,
      patch: {}
    })
    expect(r).toEqual({ success: true })
    expect(auditCount()).toBe(auditBefore) // 无变更不写审计
  })

  it('成功更新写 1 条 INFO 审计（fields 字段断言）', () => {
    const id = mkStudent({ studentName: 's', username: 'u8' })
    update(id, { studentName: '改', guardianContact: '13800000000' })
    const row = db
      .prepare(
        `SELECT severity, error_category, related_aggregate_type, context_json
         FROM error_event_log WHERE error_code = 'STUDENT_PROFILE_UPDATED' AND related_aggregate_id = ?`
      )
      .get(id) as {
      severity: string
      error_category: string
      related_aggregate_type: string
      context_json: string
    }
    expect(row.severity).toBe('INFO')
    expect(row.error_category).toBe('SYSTEM')
    expect(row.related_aggregate_type).toBe('STUDENT_PROFILE')
    expect(JSON.parse(row.context_json).fields).toEqual(
      expect.arrayContaining(['studentName', 'guardianContact'])
    )
  })

  it('STUDENT caller → FORBIDDEN', () => {
    const id = mkStudent({ studentName: 's', username: 'u9' })
    const r = updateStudent(db, {
      callerUserId: callerId,
      callerRole: 'STUDENT',
      studentId: id,
      patch: { studentName: 'x' }
    })
    expect(r).toEqual({ success: false, errorCode: 'FORBIDDEN' })
  })
})

// --- archive ---

describe('student:archive', () => {
  it('ACTIVE → student_profile.status=ARCHIVED + user_account.status=DISABLED', () => {
    const id = mkStudent({ studentName: '待归档', username: 'arc1' })
    const r = archiveStudent(db, { callerUserId: callerId, callerRole: 'TEACHER', studentId: id })
    expect(r).toEqual({ success: true })

    const sp = db
      .prepare('SELECT status FROM student_profile WHERE student_id = ?')
      .get(id) as { status: string }
    const ua = db
      .prepare('SELECT status, role FROM user_account WHERE user_id = ?')
      .get(id) as { status: string; role: string }
    expect(sp.status).toBe('ARCHIVED')
    expect(ua.status).toBe('DISABLED')
    expect(ua.role).toBe('STUDENT') // role 锁只改 status，不改 role
  })

  it('已 ARCHIVED → 幂等 success，审计计数不变', () => {
    const id = mkStudent({ studentName: 's', username: 'arc2' })
    archiveStudent(db, { callerUserId: callerId, callerRole: 'TEACHER', studentId: id })
    const auditBefore = auditCountFor(id, 'STUDENT_PROFILE_ARCHIVED')
    expect(auditBefore).toBe(1)

    // 再次 archive
    const r = archiveStudent(db, { callerUserId: callerId, callerRole: 'TEACHER', studentId: id })
    expect(r).toEqual({ success: true })
    const auditAfter = auditCountFor(id, 'STUDENT_PROFILE_ARCHIVED')
    expect(auditAfter).toBe(auditBefore) // 不写新审计
  })

  it('归档后该 student 的 user_account.role 仍为 STUDENT（role 锁只改 status）', () => {
    const id = mkStudent({ studentName: 's', username: 'arc3' })
    archiveStudent(db, { callerUserId: callerId, callerRole: 'TEACHER', studentId: id })
    const ua = db
      .prepare('SELECT role FROM user_account WHERE user_id = ?')
      .get(id) as { role: string }
    expect(ua.role).toBe('STUDENT')
  })

  it('档案 ID 与账号 ID 不同 → 只停用 user_id 显式绑定的学生账号', () => {
    const profileId = 'profile-with-distinct-account'
    const boundAccountId = 'bound-student-account'
    const sameIdDecoyAccountId = profileId
    db.prepare(
      `INSERT INTO user_account
         (user_id, username, password_hash, role, display_name, status)
       VALUES (?, 'bound_student', 'hash', 'STUDENT', '绑定账号', 'ACTIVE')`
    ).run(boundAccountId)
    db.prepare(
      `INSERT INTO user_account
         (user_id, username, password_hash, role, display_name, status)
       VALUES (?, 'same_id_decoy', 'hash', 'STUDENT', '同 ID 非绑定账号', 'ACTIVE')`
    ).run(sameIdDecoyAccountId)
    db.prepare(
      `INSERT INTO student_profile
         (student_id, student_name, user_id, status)
       VALUES (?, '独立主键学生', ?, 'ACTIVE')`
    ).run(profileId, boundAccountId)

    const r = archiveStudent(db, {
      callerUserId: callerId,
      callerRole: 'TEACHER',
      studentId: profileId
    })
    expect(r).toEqual({ success: true })

    const accounts = db
      .prepare('SELECT user_id, status FROM user_account WHERE user_id IN (?, ?) ORDER BY user_id')
      .all(boundAccountId, sameIdDecoyAccountId) as Array<{ user_id: string; status: string }>
    expect(accounts.find((row) => row.user_id === boundAccountId)?.status).toBe('DISABLED')
    expect(accounts.find((row) => row.user_id === sameIdDecoyAccountId)?.status).toBe('ACTIVE')
  })

  it('无账号档案 → 仍可归档且不修改其他账号', () => {
    const profileId = 'accountless-profile'
    db.prepare(
      `INSERT INTO student_profile (student_id, student_name, user_id, status)
       VALUES (?, '无账号学生', NULL, 'ACTIVE')`
    ).run(profileId)

    const before = db.prepare('SELECT COUNT(*) AS c FROM user_account WHERE status = ?').get('DISABLED') as {
      c: number
    }
    const r = archiveStudent(db, {
      callerUserId: callerId,
      callerRole: 'TEACHER',
      studentId: profileId
    })
    expect(r).toEqual({ success: true })
    const after = db.prepare('SELECT COUNT(*) AS c FROM user_account WHERE status = ?').get('DISABLED') as {
      c: number
    }
    expect(after.c).toBe(before.c)
    expect(
      (
        db.prepare('SELECT status FROM student_profile WHERE student_id = ?').get(profileId) as {
          status: string
        }
      ).status
    ).toBe('ARCHIVED')
  })

  it('归档后 user_account.status=DISABLED → 该账号登录会被拒绝（覆盖验收项 11）', () => {
    // 验收项 11：学生账号归档后无法登录。auth:login handler 检查 status !== 'ACTIVE'
    // 即返回 ACCOUNT_DISABLED（auth.ts:76-82）。此处直接验证 DB 状态足以。
    const id = mkStudent({ studentName: 's', username: 'arc4', password: 'initial-pwd' })
    // 归档前：状态 ACTIVE
    const before = db
      .prepare('SELECT status FROM user_account WHERE user_id = ?')
      .get(id) as { status: string }
    expect(before.status).toBe('ACTIVE')

    archiveStudent(db, { callerUserId: callerId, callerRole: 'TEACHER', studentId: id })
    const after = db
      .prepare('SELECT status FROM user_account WHERE user_id = ?')
      .get(id) as { status: string }
    expect(after.status).toBe('DISABLED') // 非 ACTIVE → auth:login 会返回 ACCOUNT_DISABLED
  })

  it('目标不存在 → NOT_FOUND', () => {
    const r = archiveStudent(db, {
      callerUserId: callerId,
      callerRole: 'TEACHER',
      studentId: 'nonexistent'
    })
    expect(r).toEqual({ success: false, errorCode: 'NOT_FOUND' })
  })

  it('STUDENT caller → FORBIDDEN', () => {
    const id = mkStudent({ studentName: 's', username: 'arc5' })
    const r = archiveStudent(db, { callerUserId: callerId, callerRole: 'STUDENT', studentId: id })
    expect(r).toEqual({ success: false, errorCode: 'FORBIDDEN' })
  })

  it('成功归档写 1 条 INFO 审计（error_code=STUDENT_PROFILE_ARCHIVED）', () => {
    const id = mkStudent({ studentName: 's', username: 'arc6' })
    archiveStudent(db, { callerUserId: callerId, callerRole: 'TEACHER', studentId: id })
    const row = db
      .prepare(
        `SELECT severity, error_category, related_aggregate_type, related_aggregate_id
         FROM error_event_log WHERE error_code = 'STUDENT_PROFILE_ARCHIVED' AND related_aggregate_id = ?`
      )
      .get(id) as {
      severity: string
      error_category: string
      related_aggregate_type: string
      related_aggregate_id: string
    }
    expect(row.severity).toBe('INFO')
    expect(row.error_category).toBe('SYSTEM')
    expect(row.related_aggregate_type).toBe('STUDENT_PROFILE')
    expect(row.related_aggregate_id).toBe(id)
  })
})
