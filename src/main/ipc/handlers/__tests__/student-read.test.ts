// student:get + student:list 集成测试：直接调纯函数，注入 MemoryAdapter。

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createStudent, getStudent, listStudents, seedStudentErrorCodes } from '../student'
import { createTestDb, seedCaller } from '../../../db/test-helpers'
import type { MemoryAdapter } from '../../../db/memory-adapter'
import type {
  CreateStudentParams,
  StudentListParams,
  StudentGender
} from '../../../../shared/types/student'

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

// --- get ---

describe('student:get', () => {
  it('存在 → 返回完整 detail，sensoryProfile 解析为对象', () => {
    const id = mkStudent({
      studentName: '李四',
      username: 'lisi',
      gender: 'FEMALE',
      birthDate: '1999-05-05',
      guardianContact: '13900000000',
      sensoryProfile: {
        noise_sensitivity: 'HIGH',
        light_sensitivity: null,
        tactile_sensitivity: null,
        crowd_density_sensitivity: null,
        avoid_tags: ['NOISY'],
        notes: 'x'
      }
    })
    const r = getStudent(db, { callerUserId: callerId, callerRole: 'TEACHER', studentId: id })
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.student.studentId).toBe(id)
    expect(r.student.studentName).toBe('李四')
    expect(r.student.gender).toBe('FEMALE')
    expect(r.student.birthDate).toBe('1999-05-05')
    expect(r.student.guardianContact).toBe('13900000000')
    expect(r.student.username).toBe('lisi')
    expect(r.student.sensoryProfile).toMatchObject({
      noise_sensitivity: 'HIGH',
      avoid_tags: ['NOISY']
    })
  })

  it('sensoryProfile=null → 返回 sensoryProfile: null', () => {
    const id = mkStudent({ studentName: '无画像', username: 'nosp' })
    const r = getStudent(db, { callerUserId: callerId, callerRole: 'TEACHER', studentId: id })
    if (!r.success) throw new Error('expected success')
    expect(r.student.sensoryProfile).toBeNull()
  })

  it('不存在 → NOT_FOUND', () => {
    const r = getStudent(db, {
      callerUserId: callerId,
      callerRole: 'TEACHER',
      studentId: 'nonexistent-uuid'
    })
    expect(r).toEqual({ success: false, errorCode: 'NOT_FOUND' })
  })

  it('studentId 非字符串 → NOT_FOUND（防御）', () => {
    const r = getStudent(db, {
      callerUserId: callerId,
      callerRole: 'TEACHER',
      studentId: 123 as unknown as string
    })
    expect(r).toEqual({ success: false, errorCode: 'NOT_FOUND' })
  })

  it('ARCHIVED 档案仍能查到（get 不过滤 status）', () => {
    const id = mkStudent({ studentName: '已归档', username: 'archived_user' })
    db.prepare(`UPDATE student_profile SET status='ARCHIVED' WHERE student_id = ?`).run(id)
    const r = getStudent(db, { callerUserId: callerId, callerRole: 'TEACHER', studentId: id })
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.student.status).toBe('ARCHIVED')
  })

  it('STUDENT caller → FORBIDDEN', () => {
    const id = mkStudent({ studentName: 'x', username: 'x1' })
    const r = getStudent(db, { callerUserId: callerId, callerRole: 'STUDENT', studentId: id })
    expect(r).toEqual({ success: false, errorCode: 'FORBIDDEN' })
  })

  it('caller 不存在 → FORBIDDEN', () => {
    const r = getStudent(db, {
      callerUserId: 'nonexistent',
      callerRole: 'TEACHER',
      studentId: 'any'
    })
    expect(r).toEqual({ success: false, errorCode: 'FORBIDDEN' })
  })
})

// --- list ---

describe('student:list', () => {
  it('空库 → items=[]，page=1', () => {
    const r = listStudents(db, { callerUserId: callerId, callerRole: 'TEACHER' })
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.items).toEqual([])
    expect(r.page).toBe(1)
  })

  it('插入 3 条 → 返回 3 条，按 created_at DESC', () => {
    // 串行插入并人工制造时间差（SQLite datetime('now') 精度为秒，连续 INSERT 可能同秒）。
    // 用 UPDATE 显式设置 created_at 保证顺序可断言。
    const id1 = mkStudent({ studentName: '第一个', username: 'a1' })
    const id2 = mkStudent({ studentName: '第二个', username: 'a2' })
    const id3 = mkStudent({ studentName: '第三个', username: 'a3' })
    db.prepare(`UPDATE student_profile SET created_at = '2026-01-01 10:00:00' WHERE student_id = ?`).run(id1)
    db.prepare(`UPDATE student_profile SET created_at = '2026-01-02 10:00:00' WHERE student_id = ?`).run(id2)
    db.prepare(`UPDATE student_profile SET created_at = '2026-01-03 10:00:00' WHERE student_id = ?`).run(id3)

    const r = listStudents(db, { callerUserId: callerId, callerRole: 'TEACHER' })
    if (!r.success) throw new Error('expected success')
    expect(r.items.map((s) => s.studentName)).toEqual(['第三个', '第二个', '第一个'])
  })

  it('search 命中 → 只返回匹配', () => {
    mkStudent({ studentName: '张三', username: 'z1' })
    mkStudent({ studentName: '李四', username: 'l1' })
    mkStudent({ studentName: '张小明', username: 'z2' })
    const r = listStudents(db, {
      callerUserId: callerId,
      callerRole: 'TEACHER',
      search: '张'
    })
    if (!r.success) throw new Error('expected success')
    expect(r.items).toHaveLength(2)
    expect(r.items.every((s) => s.studentName.includes('张'))).toBe(true)
  })

  it('includeArchived=false（默认）→ 不含 ARCHIVED', () => {
    const activeId = mkStudent({ studentName: '活动', username: 'act' })
    const archivedId = mkStudent({ studentName: '已归档', username: 'arc' })
    db.prepare(`UPDATE student_profile SET status='ARCHIVED' WHERE student_id = ?`).run(archivedId)

    const r = listStudents(db, { callerUserId: callerId, callerRole: 'TEACHER' })
    if (!r.success) throw new Error('expected success')
    const ids = r.items.map((s) => s.studentId)
    expect(ids).toContain(activeId)
    expect(ids).not.toContain(archivedId)
  })

  it('includeArchived=true → 含 ARCHIVED', () => {
    const activeId = mkStudent({ studentName: '活动', username: 'act2' })
    const archivedId = mkStudent({ studentName: '已归档', username: 'arc2' })
    db.prepare(`UPDATE student_profile SET status='ARCHIVED' WHERE student_id = ?`).run(archivedId)

    const r = listStudents(db, {
      callerUserId: callerId,
      callerRole: 'TEACHER',
      includeArchived: true
    })
    if (!r.success) throw new Error('expected success')
    const ids = r.items.map((s) => s.studentId)
    expect(ids).toContain(activeId)
    expect(ids).toContain(archivedId)
    expect(r.items.find((s) => s.studentId === archivedId)?.status).toBe('ARCHIVED')
  })

  it('分页：插入 25 条，page=1 → 20 条；page=2 → 5 条', () => {
    for (let i = 0; i < 25; i++) {
      const id = mkStudent({ studentName: `学生${i}`, username: `p_${i}` })
      // 显式设置不同 created_at 保证排序稳定
      db.prepare(`UPDATE student_profile SET created_at = datetime('2026-01-01', '+${i} seconds') WHERE student_id = ?`).run(id)
    }
    const r1 = listStudents(db, { callerUserId: callerId, callerRole: 'TEACHER', page: 1 })
    const r2 = listStudents(db, { callerUserId: callerId, callerRole: 'TEACHER', page: 2 })
    if (!r1.success || !r2.success) throw new Error('expected success')
    expect(r1.items).toHaveLength(20)
    expect(r2.items).toHaveLength(5)
  })

  it('page 超出范围 → items=[]（不报错）', () => {
    mkStudent({ studentName: '唯一', username: 'only' })
    const r = listStudents(db, { callerUserId: callerId, callerRole: 'TEACHER', page: 999 })
    if (!r.success) throw new Error('expected success')
    expect(r.items).toEqual([])
    expect(r.page).toBe(999)
  })

  it('page=0 / page=-1 → 当作 page=1', () => {
    mkStudent({ studentName: '边界', username: 'edge' })
    const r0 = listStudents(db, { callerUserId: callerId, callerRole: 'TEACHER', page: 0 })
    const rNeg = listStudents(db, { callerUserId: callerId, callerRole: 'TEACHER', page: -1 })
    if (!r0.success || !rNeg.success) throw new Error('expected success')
    expect(r0.page).toBe(1)
    expect(rNeg.page).toBe(1)
    expect(r0.items).toHaveLength(1)
    expect(rNeg.items).toHaveLength(1)
  })

  it('page 未传 → 默认 page=1', () => {
    const params: StudentListParams = { callerUserId: callerId, callerRole: 'TEACHER' }
    const r = listStudents(db, params)
    if (!r.success) throw new Error('expected success')
    expect(r.page).toBe(1)
  })

  it('page 非整数（2.7）→ 向下取整为 2', () => {
    for (let i = 0; i < 25; i++) {
      const id = mkStudent({ studentName: `分页${i}`, username: `pg_${i}` })
      db.prepare(`UPDATE student_profile SET created_at = datetime('2026-01-01', '+${i} seconds') WHERE student_id = ?`).run(id)
    }
    const r = listStudents(db, { callerUserId: callerId, callerRole: 'TEACHER', page: 2.7 })
    if (!r.success) throw new Error('expected success')
    expect(r.page).toBe(2)
    expect(r.items).toHaveLength(5)
  })

  it('STUDENT caller → FORBIDDEN', () => {
    const r = listStudents(db, { callerUserId: callerId, callerRole: 'STUDENT' })
    expect(r).toEqual({ success: false, errorCode: 'FORBIDDEN' })
  })

  it('返回字段映射正确（StudentSummary 形状）', () => {
    const id = mkStudent({
      studentName: '字段检查',
      username: 'field_check',
      gender: 'OTHER' as StudentGender
    })
    const r = listStudents(db, { callerUserId: callerId, callerRole: 'TEACHER' })
    if (!r.success) throw new Error('expected success')
    const item = r.items.find((s) => s.studentId === id)!
    expect(item).toMatchObject({
      studentId: id,
      studentName: '字段检查',
      status: 'ACTIVE',
      gender: 'OTHER'
    })
    expect(typeof item.createdAt).toBe('string')
    expect(typeof item.updatedAt).toBe('string')
    // StudentSummary 不应暴露敏感字段（birthDate / guardianContact / username / sensoryProfile）
    const itemAsAny = item as unknown as Record<string, unknown>
    expect(itemAsAny.birthDate).toBeUndefined()
    expect(itemAsAny.username).toBeUndefined()
  })
})
