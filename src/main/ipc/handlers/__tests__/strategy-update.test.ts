// strategy:update 集成测试：直接调 updateStrategy 纯函数，注入 MemoryAdapter。
// 覆盖 PRD 验收 #16-19, #36-37（level_rules 与表列漂移）+ 触发器兜底。

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { updateStrategy, createVersion, seedStrategyErrorCodes } from '../strategy'
import { createTestDb, seedCaller, baseStrategyInput, seedStrategyReference } from '../../../db/test-helpers'
import type { MemoryAdapter } from '../../../db/memory-adapter'
import type { UpdateStrategyParams } from '../../../../shared/types/strategy'

let db: MemoryAdapter
let callerId: string

/** 前置建一个 v1 策略（通过 handler 走完整校验），返回其 (strategyId, version)。 */
function seedExistingStrategy(): { strategyId: string; version: number } {
  const input = baseStrategyInput({ version: 1 })
  const r = createVersion(db, {
    callerUserId: callerId,
    callerRole: 'ADMIN',
    strategy: input
  })
  if (!r.success) throw new Error(`seedExistingStrategy failed: ${JSON.stringify(r)}`)
  return { strategyId: input.strategyId, version: 1 }
}

function baseParams(
  target: { strategyId: string; version: number },
  patch: UpdateStrategyParams['patch']
): UpdateStrategyParams {
  return {
    callerUserId: callerId,
    callerRole: 'ADMIN',
    strategyId: target.strategyId,
    version: target.version,
    patch
  }
}

beforeAll(async () => {
  db = await createTestDb()
  // 测试需 DELETE assessment_session/training_session 清理引用数据；生产层
  // trg_*_session_no_delete 是事件溯源安全网（禁止直接 DELETE session），与 handler
  // 测试无关，此处 DROP 以放行 beforeEach 清表。
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
  callerId = seedCaller(db, 'ADMIN')
})

describe('updateStrategy — 正常路径', () => {
  it('改题量（#16）：onlineQuestionCount 42→50，需同时改 question_ratio 保持 sum 一致', () => {
    const target = seedExistingStrategy()
    const r = updateStrategy(
      db,
      baseParams(target, {
        onlineQuestionCount: 50,
        questionPolicy: {
          module_scope: 'CROSS_MODULE',
          question_ratio: { TRUE_FALSE: 16, SINGLE_CHOICE: 18, DRAG: 16, OFFLINE_OPERATION: 8 }
        }
      })
    )
    expect(r).toEqual({ success: true })
    const row = db
      .prepare('SELECT online_question_count FROM strategy_config WHERE strategy_id = ? AND version = ?')
      .get(target.strategyId, target.version) as { online_question_count: number }
    expect(row.online_question_count).toBe(50)
  })

  it('改阈值（#16b）：competentThreshold 80→85，需同时改 level_rules LEVEL_COMPETENT min=85', () => {
    const target = seedExistingStrategy()
    const r = updateStrategy(
      db,
      baseParams(target, {
        competentThreshold: 85,
        scoringPolicy: {
          score_values: [0, 1, 2],
          normalization: 'raw_score/max_score*100',
          safety_override_enabled: true,
          level_rules: [
            { min: 0, max: 59, level: 'LEVEL_NOT_COMPETENT' },
            { min: 60, max: 84, level: 'LEVEL_CONDITIONAL' },
            { min: 85, max: 100, level: 'LEVEL_COMPETENT' }
          ]
        }
      })
    )
    expect(r).toEqual({ success: true })
    const row = db
      .prepare('SELECT competent_threshold FROM strategy_config WHERE strategy_id = ? AND version = ?')
      .get(target.strategyId, target.version) as { competent_threshold: number }
    expect(row.competent_threshold).toBe(85)
  })

  it('改开关（#16d）：supportsRedlineHalt true→false', () => {
    const target = seedExistingStrategy()
    const r = updateStrategy(db, baseParams(target, { supportsRedlineHalt: false }))
    expect(r).toEqual({ success: true })
    const row = db
      .prepare('SELECT supports_redline_halt FROM strategy_config WHERE strategy_id = ? AND version = ?')
      .get(target.strategyId, target.version) as { supports_redline_halt: number }
    expect(row.supports_redline_halt).toBe(0)
  })

  it('改 moduleVetoThreshold / emotionCollapseThreshold', () => {
    const target = seedExistingStrategy()
    const r = updateStrategy(
      db,
      baseParams(target, { moduleVetoThreshold: 0.6, emotionCollapseThreshold: 5 })
    )
    expect(r).toEqual({ success: true })
    const row = db
      .prepare(
        'SELECT module_veto_threshold, emotion_collapse_threshold FROM strategy_config WHERE strategy_id = ? AND version = ?'
      )
      .get(target.strategyId, target.version) as { module_veto_threshold: number; emotion_collapse_threshold: number }
    expect(row.module_veto_threshold).toBe(0.6)
    expect(row.emotion_collapse_threshold).toBe(5)
  })

  it('成功后写 INFO 审计（code=STRATEGY_CONFIG_UPDATED, fields 记录）', () => {
    const target = seedExistingStrategy()
    updateStrategy(db, baseParams(target, { strategyName: '改名后' }))
    const row = db
      .prepare(
        `SELECT error_code, severity, recovery_status, context_json
         FROM error_event_log WHERE related_aggregate_id = ? AND error_code = 'STRATEGY_CONFIG_UPDATED'`
      )
      .get(`${target.strategyId}:${target.version}`) as {
      error_code: string
      severity: string
      recovery_status: string
      context_json: string
    }
    expect(row.error_code).toBe('STRATEGY_CONFIG_UPDATED')
    expect(row.severity).toBe('INFO')
    expect(row.recovery_status).toBe('IGNORED')
    expect(JSON.parse(row.context_json).fields).toEqual(['strategyName'])
  })
})

describe('updateStrategy — level_rules 与表列漂移防护', () => {
  it('只改 competentThreshold 不改 level_rules → INVALID_SCORING_POLICY（#36/#37）', () => {
    // 原 competentThreshold=80，level_rules LEVEL_COMPETENT min=80 一致
    // 只把表列改 85，level_rules 还停留在 80 → 漂移 → 校验失败
    const target = seedExistingStrategy()
    const r = updateStrategy(db, baseParams(target, { competentThreshold: 85 }))
    expect(r).toEqual({ success: false, errorCode: 'INVALID_SCORING_POLICY' })
    // 确认表列未变（校验失败不写）
    const row = db
      .prepare('SELECT competent_threshold FROM strategy_config WHERE strategy_id = ? AND version = ?')
      .get(target.strategyId, target.version) as { competent_threshold: number }
    expect(row.competent_threshold).toBe(80)
  })

  it('只改 scoringPolicy 的 level_rules 不改表列 → INVALID_SCORING_POLICY', () => {
    // 原 level_rules LEVEL_COMPETENT min=80 与表列 80 一致
    // 只改 level_rules LEVEL_COMPETENT min=85（不表列）→ 漂移 → 校验失败
    const target = seedExistingStrategy()
    const r = updateStrategy(
      db,
      baseParams(target, {
        scoringPolicy: {
          score_values: [0, 1, 2],
          normalization: 'raw_score/max_score*100',
          safety_override_enabled: true,
          level_rules: [
            { min: 0, max: 59, level: 'LEVEL_NOT_COMPETENT' },
            { min: 60, max: 84, level: 'LEVEL_CONDITIONAL' },
            { min: 85, max: 100, level: 'LEVEL_COMPETENT' }
          ]
        }
      })
    )
    expect(r).toEqual({ success: false, errorCode: 'INVALID_SCORING_POLICY' })
  })
})

describe('updateStrategy — REFERENCED_IMMUTABLE（#17）', () => {
  it('已被 assessment_session 引用 + 语义字段 patch → REFERENCED_IMMUTABLE + ERROR 审计', () => {
    const target = seedExistingStrategy()
    seedStrategyReference(db, target.strategyId, target.version, 'assessment')
    const r = updateStrategy(db, baseParams(target, { strategyName: '试图改已引用版本' }))
    expect(r).toEqual({ success: false, errorCode: 'REFERENCED_IMMUTABLE' })
    const audit = db
      .prepare(
        `SELECT error_code, severity, recovery_status, related_aggregate_id, context_json
         FROM error_event_log WHERE error_code = 'STRATEGY_CONFIG_REFERENCED_IMMUTABLE_ATTEMPT'`
      )
      .get() as {
      error_code: string
      severity: string
      recovery_status: string
      related_aggregate_id: string
      context_json: string
    }
    expect(audit.severity).toBe('ERROR')
    expect(audit.recovery_status).toBe('UNRESOLVED')
    expect(audit.related_aggregate_id).toBe(`${target.strategyId}:${target.version}`)
    expect(JSON.parse(audit.context_json).fields).toEqual(['strategyName'])
  })

  it('已被 training_session 引用 + 语义字段 patch → REFERENCED_IMMUTABLE', () => {
    // training_session.strategy_type 强制 TRAINING_PRACTICE，故用 TRAINING_PRACTICE 策略
    const input = baseStrategyInput({
      strategyType: 'TRAINING_PRACTICE',
      jobCode: 'SUPERMARKET_SHELVER_TRAIN',
      version: 1
    })
    const createR = createVersion(db, { callerUserId: callerId, callerRole: 'ADMIN', strategy: input })
    if (!createR.success) throw new Error('seed train strategy failed')
    seedStrategyReference(db, input.strategyId, 1, 'training')
    const r = updateStrategy(db, {
      callerUserId: callerId,
      callerRole: 'ADMIN',
      strategyId: input.strategyId,
      version: 1,
      patch: { strategyName: '改已引用训练策略' }
    })
    expect(r).toEqual({ success: false, errorCode: 'REFERENCED_IMMUTABLE' })
  })
})

describe('updateStrategy — 边界', () => {
  it('白名单外字段静默忽略（#18）：strategyId/version/strategyType 不在白名单', () => {
    const target = seedExistingStrategy()
    // 模拟客户端传非白名单字段（as 强转绕过 TS excess property check）
    const patch = {
      strategyName: '合法改名',
      strategyId: '试图改sid',
      version: 999
    } as UpdateStrategyParams['patch']
    const r = updateStrategy(db, baseParams(target, patch))
    expect(r).toEqual({ success: true })
    // strategyId/version 未变
    const row = db
      .prepare('SELECT strategy_id, version, strategy_name FROM strategy_config WHERE strategy_id = ?')
      .get(target.strategyId) as { strategy_id: string; version: number; strategy_name: string }
    expect(row.strategy_id).toBe(target.strategyId)
    expect(row.version).toBe(1)
    expect(row.strategy_name).toBe('合法改名')
  })

  it('空 patch → success，不写审计（#19）', () => {
    const target = seedExistingStrategy()
    const r = updateStrategy(db, baseParams(target, {}))
    expect(r).toEqual({ success: true })
    const c = db
      .prepare('SELECT COUNT(*) AS c FROM error_event_log WHERE error_code = ?')
      .get('STRATEGY_CONFIG_UPDATED') as { c: number }
    expect(c.c).toBe(0)
  })

  it('目标不存在 → NOT_FOUND', () => {
    const r = updateStrategy(
      db,
      baseParams({ strategyId: 'nonexistent', version: 1 }, { strategyName: 'x' })
    )
    expect(r).toEqual({ success: false, errorCode: 'NOT_FOUND' })
  })

  it('TEACHER 调用 → FORBIDDEN', () => {
    const teacher = seedCaller(db, 'TEACHER')
    const target = seedExistingStrategy()
    const r = updateStrategy(db, {
      callerUserId: teacher,
      callerRole: 'TEACHER',
      strategyId: target.strategyId,
      version: target.version,
      patch: { strategyName: 'x' }
    })
    expect(r).toEqual({ success: false, errorCode: 'FORBIDDEN' })
  })
})
