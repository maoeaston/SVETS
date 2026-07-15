import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ensureLocalRuntimeContext } from '../local-runtime-context'
import {
  createTestDb,
  seedCaller,
  seedDisabledCaller,
  seedLocalRuntimeContextFixture,
  seedStudent
} from '../../db/test-helpers'
import type { MemoryAdapter } from '../../db/memory-adapter'

let db: MemoryAdapter

function countRows(tableName: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS c FROM ${tableName}`).get() as { c: number }
  return row.c
}

beforeEach(async () => {
  db = await createTestDb()
})

afterEach(() => {
  db.close()
})

describe('ensureLocalRuntimeContext', () => {
  it('空拓扑首次调用创建 organization/node/device/runtime/auth 完整 FK 链', () => {
    const teacherId = seedCaller(db, 'TEACHER')

    const context = ensureLocalRuntimeContext(db, teacherId)

    expect(context.organizationId).toBeTruthy()
    expect(context.nodeId).toBeTruthy()
    expect(context.deviceId).toBeTruthy()
    expect(context.deviceRuntimeSessionId).toBeTruthy()
    expect(context.teacherAuthSessionId).toBeTruthy()

    const row = db
      .prepare(
        `SELECT
           o.organization_id,
           n.node_id,
           d.device_id,
           d.device_role,
           d.trust_state,
           drs.device_runtime_session_id,
           drs.status AS runtime_status,
           a.auth_session_id,
           a.user_id,
           a.auth_method,
           a.status AS auth_status,
           a.token_hash,
           a.refresh_token_hash
         FROM organization o
         JOIN node n ON n.organization_id = o.organization_id
         JOIN device d ON d.node_id = n.node_id
         JOIN device_runtime_session drs ON drs.device_id = d.device_id
         JOIN auth_session a ON a.device_runtime_session_id = drs.device_runtime_session_id
         WHERE a.auth_session_id = ?`
      )
      .get(context.teacherAuthSessionId) as {
      organization_id: string
      node_id: string
      device_id: string
      device_role: string
      trust_state: string
      device_runtime_session_id: string
      runtime_status: string
      auth_session_id: string
      user_id: string
      auth_method: string
      auth_status: string
      token_hash: string
      refresh_token_hash: string
    }

    expect(row).toMatchObject({
      organization_id: context.organizationId,
      node_id: context.nodeId,
      device_id: context.deviceId,
      device_role: 'HYBRID',
      trust_state: 'TRUSTED',
      device_runtime_session_id: context.deviceRuntimeSessionId,
      runtime_status: 'ACTIVE',
      auth_session_id: context.teacherAuthSessionId,
      user_id: teacherId,
      auth_method: 'DEVICE_KEY',
      auth_status: 'ACTIVE'
    })
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })

  it('重复调用复用同一个 ACTIVE runtime 与未过期 auth_session', () => {
    const teacherId = seedCaller(db, 'TEACHER')

    const first = ensureLocalRuntimeContext(db, teacherId)
    const second = ensureLocalRuntimeContext(db, teacherId)

    expect(second).toEqual(first)
    expect(countRows('organization')).toBe(1)
    expect(countRows('node')).toBe(1)
    expect(countRows('device')).toBe(1)
    expect(countRows('device_runtime_session')).toBe(1)
    expect(countRows('auth_session')).toBe(1)
  })

  it('复用已有 ACTIVE 本地 runtime 和教师 ACTIVE 未过期 auth_session', () => {
    const teacherId = seedCaller(db, 'TEACHER')
    const fixture = seedLocalRuntimeContextFixture(db, { teacherUserId: teacherId })

    const context = ensureLocalRuntimeContext(db, teacherId)

    expect(context).toEqual(fixture)
    expect(countRows('device_runtime_session')).toBe(1)
    expect(countRows('auth_session')).toBe(1)
  })

  it('已有 auth_session 过期时复用 runtime 并创建新的 DEVICE_KEY auth_session', () => {
    const teacherId = seedCaller(db, 'TEACHER')
    const fixture = seedLocalRuntimeContextFixture(db, {
      teacherUserId: teacherId,
      teacherAuthSessionId: 'expired_auth_fixture',
      authExpiresAt: 'past'
    })

    const context = ensureLocalRuntimeContext(db, teacherId)

    expect(context.organizationId).toBe(fixture.organizationId)
    expect(context.nodeId).toBe(fixture.nodeId)
    expect(context.deviceId).toBe(fixture.deviceId)
    expect(context.deviceRuntimeSessionId).toBe(fixture.deviceRuntimeSessionId)
    expect(context.teacherAuthSessionId).not.toBe('expired_auth_fixture')
    expect(countRows('device_runtime_session')).toBe(1)
    expect(countRows('auth_session')).toBe(2)
  })

  it('不生成固定 org_default、固定 device_id 或明文 token_hash', () => {
    const teacherId = seedCaller(db, 'TEACHER')

    const context = ensureLocalRuntimeContext(db, teacherId)
    const auth = db
      .prepare(
        `SELECT token_hash, refresh_token_hash
         FROM auth_session
         WHERE auth_session_id = ?`
      )
      .get(context.teacherAuthSessionId) as { token_hash: string; refresh_token_hash: string }

    expect(context.organizationId).not.toBe('org_default')
    expect(context.deviceId).not.toBe('device_default')
    expect(context.deviceRuntimeSessionId).not.toBe('runtime_default')
    expect(auth.token_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(auth.refresh_token_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(auth.token_hash).not.toContain(context.teacherAuthSessionId)
  })

  it('ACTIVE ADMIN 可创建本地 runtime context', () => {
    const adminId = seedCaller(db, 'ADMIN')

    const context = ensureLocalRuntimeContext(db, adminId)

    const auth = db
      .prepare('SELECT user_id, status FROM auth_session WHERE auth_session_id = ?')
      .get(context.teacherAuthSessionId) as { user_id: string; status: string }
    expect(auth).toEqual({ user_id: adminId, status: 'ACTIVE' })
  })

  it('teacher 非 ACTIVE 时拒绝且不创建拓扑', () => {
    const disabledTeacherId = seedDisabledCaller(db, 'TEACHER')

    expect(() => ensureLocalRuntimeContext(db, disabledTeacherId)).toThrow(/ACTIVE TEACHER or ADMIN/)
    expect(countRows('organization')).toBe(0)
    expect(countRows('device_runtime_session')).toBe(0)
    expect(countRows('auth_session')).toBe(0)
  })

  it('非 TEACHER/ADMIN 账号拒绝且不创建拓扑', () => {
    const studentId = seedStudent(db)

    expect(() => ensureLocalRuntimeContext(db, studentId)).toThrow(/ACTIVE TEACHER or ADMIN/)
    expect(countRows('organization')).toBe(0)
    expect(countRows('device_runtime_session')).toBe(0)
    expect(countRows('auth_session')).toBe(0)
  })
})
