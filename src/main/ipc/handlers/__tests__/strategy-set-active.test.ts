// strategy:setActive 集成测试。
// 覆盖 PRD 验收 #20-22（停用/启用，含已引用版本）+ 审计 + 权限。

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { setActive, createVersion, seedStrategyErrorCodes } from '../strategy'
import { createTestDb, seedCaller, baseStrategyInput, seedStrategyReference } from '../../../db/test-helpers'
import type { MemoryAdapter } from '../../../db/memory-adapter'

let db: MemoryAdapter
let adminId: string

function seedExistingStrategy(): { strategyId: string; version: number } {
  const input = baseStrategyInput({ version: 1 })
  const r = createVersion(db, { callerUserId: adminId, callerRole: 'ADMIN', strategy: input })
  if (!r.success) throw new Error(`seedExistingStrategy failed: ${JSON.stringify(r)}`)
  return { strategyId: input.strategyId, version: 1 }
}

beforeAll(async () => {
  db = await createTestDb()
  // 见 strategy-update.test.ts 同理：DROP session 安全网触发器以放行 beforeEach 清表。
  db.exec('DROP TRIGGER IF EXISTS trg_assessment_session_no_delete')
  db.exec('DROP TRIGGER IF EXISTS trg_training_session_no_delete')
})

afterAll(() => {
  db.close()
})

beforeEach(() => {
  db.exec('DELETE FROM assessment_session')
  db.exec('DELETE FROM training_session')
  db.exec('DELETE FROM error_event_log')
  db.exec('DELETE FROM strategy_config')
  db.exec('DELETE FROM student_profile')
  db.exec('DELETE FROM user_account')
  seedStrategyErrorCodes(db)
  adminId = seedCaller(db, 'ADMIN')
})

describe('setActive — 正常路径', () => {
  it('停用未引用版本（#20）', () => {
    const target = seedExistingStrategy()
    const r = setActive(db, {
      callerUserId: adminId,
      callerRole: 'ADMIN',
      strategyId: target.strategyId,
      version: target.version,
      isActive: false
    })
    expect(r).toEqual({ success: true })
    const row = db
      .prepare('SELECT is_active FROM strategy_config WHERE strategy_id = ? AND version = ?')
      .get(target.strategyId, target.version) as { is_active: number }
    expect(row.is_active).toBe(0)
  })

  it('停用已引用版本 → 允许（#21）：触发器白名单显式放行 is_active', () => {
    const target = seedExistingStrategy()
    seedStrategyReference(db, target.strategyId, target.version, 'assessment')
    const r = setActive(db, {
      callerUserId: adminId,
      callerRole: 'ADMIN',
      strategyId: target.strategyId,
      version: target.version,
      isActive: false
    })
    expect(r).toEqual({ success: true })
    const row = db
      .prepare('SELECT is_active FROM strategy_config WHERE strategy_id = ? AND version = ?')
      .get(target.strategyId, target.version) as { is_active: number }
    expect(row.is_active).toBe(0)
  })

  it('启用已停用版本（#22）', () => {
    const target = seedExistingStrategy()
    // 先停用
    setActive(db, {
      callerUserId: adminId,
      callerRole: 'ADMIN',
      strategyId: target.strategyId,
      version: target.version,
      isActive: false
    })
    // 再启用
    const r = setActive(db, {
      callerUserId: adminId,
      callerRole: 'ADMIN',
      strategyId: target.strategyId,
      version: target.version,
      isActive: true
    })
    expect(r).toEqual({ success: true })
    const row = db
      .prepare('SELECT is_active FROM strategy_config WHERE strategy_id = ? AND version = ?')
      .get(target.strategyId, target.version) as { is_active: number }
    expect(row.is_active).toBe(1)
  })

  it('成功后写 INFO 审计（code=STRATEGY_CONFIG_ACTIVE_TOGGLED）（#24）', () => {
    const target = seedExistingStrategy()
    setActive(db, {
      callerUserId: adminId,
      callerRole: 'ADMIN',
      strategyId: target.strategyId,
      version: target.version,
      isActive: false
    })
    const row = db
      .prepare(
        `SELECT error_code, severity, recovery_status, context_json
         FROM error_event_log WHERE related_aggregate_id = ? AND error_code = 'STRATEGY_CONFIG_ACTIVE_TOGGLED'`
      )
      .get(`${target.strategyId}:${target.version}`) as {
      error_code: string
      severity: string
      recovery_status: string
      context_json: string
    }
    expect(row.error_code).toBe('STRATEGY_CONFIG_ACTIVE_TOGGLED')
    expect(row.severity).toBe('INFO')
    expect(row.recovery_status).toBe('IGNORED')
    expect(JSON.parse(row.context_json).isActive).toBe(false)
  })
})

describe('setActive — 失败路径', () => {
  it('目标不存在 → NOT_FOUND', () => {
    const r = setActive(db, {
      callerUserId: adminId,
      callerRole: 'ADMIN',
      strategyId: 'nonexistent',
      version: 1,
      isActive: false
    })
    expect(r).toEqual({ success: false, errorCode: 'NOT_FOUND' })
  })

  it('isActive 非布尔 → VALIDATION_ERROR', () => {
    const target = seedExistingStrategy()
    const r = setActive(db, {
      callerUserId: adminId,
      callerRole: 'ADMIN',
      strategyId: target.strategyId,
      version: target.version,
      isActive: 'yes' as unknown as boolean
    })
    expect(r).toEqual({ success: false, errorCode: 'VALIDATION_ERROR' })
  })

  it('TEACHER 调用 → FORBIDDEN', () => {
    const teacher = seedCaller(db, 'TEACHER')
    const target = seedExistingStrategy()
    const r = setActive(db, {
      callerUserId: teacher,
      callerRole: 'TEACHER',
      strategyId: target.strategyId,
      version: target.version,
      isActive: false
    })
    expect(r).toEqual({ success: false, errorCode: 'FORBIDDEN' })
  })
})
