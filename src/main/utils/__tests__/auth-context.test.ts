import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { assertCaller, assertStudent, assertSessionOwner } from '../auth-context'
import { createTestDb, seedCaller, seedDisabledCaller, seedStudent } from '../../db/test-helpers'
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

// assertSessionOwner 测试专用：seed 最小 strategy_config + assessment_session。
// 不导出；impl.md 未要求 seedAssessmentSession 全局 helper，此局部 helper 保持 test-helpers 范围最小。
function seedSessionForOwnerTest(db: MemoryAdapter, studentId: string): string {
  const strategyId = `owner-test-${uuidv4().slice(0, 8)}`
  // 随机 jobCode 避开 strategy_config UNIQUE(strategy_type, job_code, version)；
  // 多个 it 各自 seed session 时 jobCode 唯一即不冲突。
  const jobCode = `test-job-${uuidv4().slice(0, 8)}`
  db.prepare(
    `INSERT INTO strategy_config
       (strategy_id, strategy_type, job_code, strategy_name,
        online_question_count, offline_question_count, max_score,
        question_policy_json, scoring_policy_json)
     VALUES (?, 'BASELINE_ASSESSMENT', ?, 'owner test',
             42, 8, 100, '{"seed":true}', '{"seed":true}')`
  ).run(strategyId, jobCode)
  const sessionId = uuidv4()
  db.prepare(
    `INSERT INTO assessment_session
       (session_id, student_id, strategy_id, strategy_type, job_code, task_code,
        strategy_version, status, online_question_count, offline_question_count, created_by)
     VALUES (?, ?, ?, 'BASELINE_ASSESSMENT', ?, 'test-task',
        1, 'ACTIVE', 42, 8, ?)`
  ).run(sessionId, studentId, strategyId, jobCode, studentId)
  return sessionId
}

describe('assertStudent', () => {
  it('STUDENT 合法（ACTIVE + 角色匹配）→ ok', () => {
    const id = seedStudent(db)
    const r = assertStudent(db, id, 'STUDENT')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.row.role).toBe('STUDENT')
      expect(r.row.status).toBe('ACTIVE')
    }
  })

  it('callerRole = TEACHER 传给 student 通道 → FORBIDDEN', () => {
    const id = seedCaller(db, 'TEACHER')
    expect(assertStudent(db, id, 'TEACHER')).toEqual({ ok: false, errorCode: 'FORBIDDEN' })
  })

  it('账号 status=DISABLED → FORBIDDEN', () => {
    const id = seedStudent(db, { userStatus: 'DISABLED' })
    expect(assertStudent(db, id, 'STUDENT')).toEqual({ ok: false, errorCode: 'FORBIDDEN' })
  })
})

describe('assertSessionOwner', () => {
  it('本人 session → ok', () => {
    const studentId = seedStudent(db)
    const sessionId = seedSessionForOwnerTest(db, studentId)
    const r = assertSessionOwner(db, studentId, sessionId)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.sessionRow.student_id).toBe(studentId)
    }
  })

  it('他人 session → FORBIDDEN', () => {
    const owner = seedStudent(db)
    const sessionId = seedSessionForOwnerTest(db, owner)
    const other = seedStudent(db)
    expect(assertSessionOwner(db, other, sessionId)).toEqual({ ok: false, errorCode: 'FORBIDDEN' })
  })

  it('不存在 session → NOT_FOUND', () => {
    const studentId = seedStudent(db)
    expect(assertSessionOwner(db, studentId, 'nonexistent-session')).toEqual({
      ok: false,
      errorCode: 'NOT_FOUND'
    })
  })
})
