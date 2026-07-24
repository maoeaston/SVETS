import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { createTestDb, seedCaller, seedStudent } from '../../../db/test-helpers'
import type { MemoryAdapter } from '../../../db/memory-adapter'
import { getException, getWorkspaceOverview, listExceptions } from '../foundation'

let db: MemoryAdapter
let teacherId: string
let adminId: string
let studentId: string

function seedException(params: {
  errorCode: string
  category: string
  aggregateType?: string
  context?: Record<string, unknown>
  stackTrace?: string
}): string {
  const errorEventId = uuidv4()
  db.prepare(
    `INSERT INTO error_event_log
       (error_event_id, error_code, severity, error_category, related_aggregate_type,
        related_aggregate_id, message, context_json, stack_trace, recovery_status, created_at)
     SELECT ?, r.error_code, r.severity, ?, ?, ?, ?, ?, ?, 'UNRESOLVED', datetime('now')
       FROM error_code_registry r WHERE r.error_code = ?`
  ).run(
    errorEventId,
    params.category,
    params.aggregateType ?? null,
    params.aggregateType ? uuidv4() : null,
    `事件 ${params.errorCode}`,
    params.context ? JSON.stringify(params.context) : null,
    params.stackTrace ?? null,
    params.errorCode
  )
  return errorEventId
}

beforeEach(async () => {
  db = await createTestDb()
  teacherId = seedCaller(db, 'TEACHER')
  adminId = seedCaller(db, 'ADMIN')
  studentId = seedStudent(db)
})

afterEach(() => db.close())

describe('F5 exception center', () => {
  it('教师只看到教学相关异常，管理员看到系统级异常', () => {
    const teachingId = seedException({
      errorCode: 'FSM_INVALID_TRANSITION',
      category: 'FSM',
      aggregateType: 'ASSESSMENT_SESSION'
    })
    const systemId = seedException({
      errorCode: 'RECOVERY_LOG_TRUNCATED',
      category: 'RECOVERY',
      context: { archivedPath: '/private/path' },
      stackTrace: 'private stack'
    })

    const teacher = listExceptions(db, { callerUserId: teacherId, callerRole: 'TEACHER' })
    expect(teacher.success).toBe(true)
    if (!teacher.success) return
    expect(teacher.items.map((item) => item.errorEventId)).toContain(teachingId)
    expect(teacher.items.map((item) => item.errorEventId)).not.toContain(systemId)

    const admin = listExceptions(db, { callerUserId: adminId, callerRole: 'ADMIN' })
    expect(admin.success).toBe(true)
    if (!admin.success) return
    expect(admin.items.map((item) => item.errorEventId)).toEqual(expect.arrayContaining([teachingId, systemId]))
    expect(admin.priorityCounts.P1).toBeGreaterThanOrEqual(1)
    expect(admin.priorityCounts.P3).toBeGreaterThanOrEqual(1)
  })

  it('详情对教师隐藏技术上下文，对管理员保留', () => {
    const id = seedException({
      errorCode: 'FSM_INVALID_TRANSITION',
      category: 'FSM',
      aggregateType: 'TRAINING_SESSION',
      context: { expected: 'ACTIVE', actual: 'COMPLETED' },
      stackTrace: 'stack'
    })
    const teacher = getException(db, {
      callerUserId: teacherId, callerRole: 'TEACHER', errorEventId: id
    })
    expect(teacher.success).toBe(true)
    if (teacher.success) {
      expect(teacher.exception.context).toBeNull()
      expect(teacher.exception.stackTrace).toBeNull()
    }
    const admin = getException(db, {
      callerUserId: adminId, callerRole: 'ADMIN', errorEventId: id
    })
    expect(admin.success).toBe(true)
    if (admin.success) {
      expect(admin.exception.context).toEqual({ expected: 'ACTIVE', actual: 'COMPLETED' })
      expect(admin.exception.stackTrace).toBe('stack')
    }
  })

  it('学生被主进程拒绝，非法筛选失败关闭', () => {
    expect(listExceptions(db, {
      callerUserId: studentId, callerRole: 'STUDENT'
    })).toEqual({ success: false, errorCode: 'FORBIDDEN' })
    expect(listExceptions(db, {
      callerUserId: adminId,
      callerRole: 'ADMIN',
      priorityLevel: 'P9' as 'P0'
    })).toEqual({ success: false, errorCode: 'VALIDATION_ERROR' })
  })
})

describe('F5 workspace overview', () => {
  it('教师和管理员获得角色化只读汇总，学生不能调用', () => {
    seedException({ errorCode: 'FSM_INVALID_TRANSITION', category: 'FSM' })
    const teacher = getWorkspaceOverview(db, {
      callerUserId: teacherId, callerRole: 'TEACHER'
    })
    expect(teacher.success).toBe(true)
    if (teacher.success) {
      expect(teacher.overview.role).toBe('TEACHER')
      expect(teacher.overview.activeStudentCount).toBe(1)
    }
    const admin = getWorkspaceOverview(db, {
      callerUserId: adminId, callerRole: 'ADMIN'
    })
    expect(admin.success).toBe(true)
    if (admin.success) {
      expect(admin.overview.role).toBe('ADMIN')
      expect(admin.overview.teacherAccountCount).toBe(1)
      expect(admin.overview.activeStrategyCount).toBeGreaterThan(0)
    }
    expect(getWorkspaceOverview(db, {
      callerUserId: studentId, callerRole: 'STUDENT'
    })).toEqual({ success: false, errorCode: 'FORBIDDEN' })
  })
})
