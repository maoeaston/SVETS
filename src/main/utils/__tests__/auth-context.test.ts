import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { assertCaller } from '../auth-context'
import { createTestDb, seedCaller, seedDisabledCaller } from '../../db/test-helpers'
import type { MemoryAdapter } from '../../db/memory-adapter'

let db: MemoryAdapter

beforeAll(async () => {
  db = await createTestDb()
})

afterAll(() => {
  db.close()
})

describe('assertCaller', () => {
  it('TEACHER 合法（ACTIVE + 角色匹配）→ ok', () => {
    const id = seedCaller(db, 'TEACHER')
    const r = assertCaller(db, id, 'TEACHER')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.row.role).toBe('TEACHER')
      expect(r.row.status).toBe('ACTIVE')
    }
  })

  it('ADMIN 合法 → ok', () => {
    const id = seedCaller(db, 'ADMIN')
    expect(assertCaller(db, id, 'ADMIN').ok).toBe(true)
  })

  it('callerRole = STUDENT → FORBIDDEN', () => {
    const id = seedCaller(db, 'TEACHER')
    expect(assertCaller(db, id, 'STUDENT')).toEqual({ ok: false, errorCode: 'FORBIDDEN' })
  })

  it('callerRole 缺失 → FORBIDDEN', () => {
    const id = seedCaller(db, 'TEACHER')
    expect(assertCaller(db, id, undefined)).toEqual({ ok: false, errorCode: 'FORBIDDEN' })
  })

  it('callerRole 非法值 → FORBIDDEN', () => {
    const id = seedCaller(db, 'TEACHER')
    expect(assertCaller(db, id, 'SUPERUSER')).toEqual({ ok: false, errorCode: 'FORBIDDEN' })
  })

  it('callerUserId 非字符串 → FORBIDDEN', () => {
    expect(assertCaller(db, 123, 'TEACHER')).toEqual({ ok: false, errorCode: 'FORBIDDEN' })
    expect(assertCaller(db, null, 'TEACHER')).toEqual({ ok: false, errorCode: 'FORBIDDEN' })
  })

  it('callerUserId 空字符串 → FORBIDDEN', () => {
    expect(assertCaller(db, '', 'TEACHER')).toEqual({ ok: false, errorCode: 'FORBIDDEN' })
  })

  it('caller 不存在 → FORBIDDEN', () => {
    expect(assertCaller(db, 'nonexistent-uuid', 'TEACHER')).toEqual({
      ok: false,
      errorCode: 'FORBIDDEN'
    })
  })

  it('caller 存在但 status=DISABLED → FORBIDDEN', () => {
    const id = seedDisabledCaller(db, 'TEACHER')
    expect(assertCaller(db, id, 'TEACHER')).toEqual({ ok: false, errorCode: 'FORBIDDEN' })
  })

  it('caller 存在 ACTIVE 但 role 与传入不符（TEACHER 传 ADMIN）→ FORBIDDEN', () => {
    const teacherId = seedCaller(db, 'TEACHER')
    expect(assertCaller(db, teacherId, 'ADMIN')).toEqual({
      ok: false,
      errorCode: 'FORBIDDEN'
    })
  })
})
