// strategy:createVersion 集成测试：直接调 createVersion 纯函数，注入 MemoryAdapter。
// 覆盖 PRD 验收 #1-15, #23-24, #32-37, #40。

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createVersion, seedStrategyErrorCodes } from '../strategy'
import {
  createTestDb,
  seedCaller,
  baseStrategyInput
} from '../../../db/test-helpers'
import type { MemoryAdapter } from '../../../db/memory-adapter'
import type {
  CreateStrategyVersionParams,
  StrategyInput,
  StrategyType
} from '../../../../shared/types/strategy'

let db: MemoryAdapter
let callerId: string

function baseParams(over: Partial<CreateStrategyVersionParams> = {}): CreateStrategyVersionParams {
  return {
    callerUserId: callerId,
    callerRole: 'ADMIN',
    strategy: baseStrategyInput(),
    ...over
  }
}

/** 直接 INSERT 一条 strategy_config（绕过 handler），用于「新增版本」分支的前置数据。 */
function seedStrategyRow(s: StrategyInput): void {
  db.prepare(
    `INSERT INTO strategy_config
       (strategy_id, strategy_type, job_code, strategy_name,
        online_question_count, offline_question_count, max_score,
        competent_threshold, conditional_threshold,
        module_veto_threshold, emotion_collapse_threshold,
        question_policy_json, scoring_policy_json,
        supports_redline_halt, allows_emotion_interrupt, requires_offline_scoring,
        version, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    s.strategyId,
    s.strategyType,
    s.jobCode,
    s.strategyName,
    s.onlineQuestionCount,
    s.offlineQuestionCount,
    s.maxScore,
    s.competentThreshold,
    s.conditionalThreshold,
    s.moduleVetoThreshold,
    s.emotionCollapseThreshold,
    JSON.stringify(s.questionPolicy),
    JSON.stringify(s.scoringPolicy),
    s.supportsRedlineHalt ? 1 : 0,
    s.allowsEmotionInterrupt ? 1 : 0,
    s.requiresOfflineScoring ? 1 : 0,
    s.version,
    s.isActive ? 1 : 0
  )
}

beforeAll(async () => {
  db = await createTestDb()
})

afterAll(() => {
  db.close()
})

beforeEach(() => {
  // FK-safe 清表顺序：sessions → strategy_config → student_profile → user_account
  db.exec('DELETE FROM assessment_session')
  db.exec('DELETE FROM training_session')
  db.exec('DELETE FROM error_event_log')
  db.exec('DELETE FROM strategy_config')
  db.exec('DELETE FROM student_profile')
  db.exec('DELETE FROM user_account')
  seedStrategyErrorCodes(db)
  callerId = seedCaller(db, 'ADMIN')
})

describe('createVersion — 正常路径', () => {
  it('新建族 v1 成功（#1）：strategy_config 1 行，version=1', () => {
    const r = createVersion(db, baseParams())
    expect(r).toEqual({ success: true })
    const c = db.prepare('SELECT COUNT(*) AS c FROM strategy_config').get() as { c: number }
    expect(c.c).toBe(1)
    const row = db
      .prepare('SELECT version, strategy_type, job_code, is_active FROM strategy_config')
      .get() as { version: number; strategy_type: string; job_code: string; is_active: number }
    expect(row.version).toBe(1)
    expect(row.strategy_type).toBe('BASELINE_ASSESSMENT')
    expect(row.job_code).toBe('SUPERMARKET_SHELVER')
    expect(row.is_active).toBe(1)
  })

  it('新增版本 v2 成功（#13）：同 strategy_id，version=2', () => {
    const sid = `fam-${Math.random().toString(36).slice(2, 8)}`
    seedStrategyRow(baseStrategyInput({ strategyId: sid, version: 1 }))
    const r = createVersion(
      db,
      baseParams({ strategy: baseStrategyInput({ strategyId: sid, version: 2 }) })
    )
    expect(r).toEqual({ success: true })
    const versions = db
      .prepare('SELECT version FROM strategy_config WHERE strategy_id = ? ORDER BY version')
      .all(sid) as { version: number }[]
    expect(versions.map((v) => v.version)).toEqual([1, 2])
  })

  it('跳号 v1→v3 成功（#34）：允许跳过 v2 直达 v3', () => {
    const sid = `fam-${Math.random().toString(36).slice(2, 8)}`
    seedStrategyRow(baseStrategyInput({ strategyId: sid, version: 1 }))
    const r = createVersion(
      db,
      baseParams({ strategy: baseStrategyInput({ strategyId: sid, version: 3 }) })
    )
    expect(r).toEqual({ success: true })
    const maxV = db
      .prepare('SELECT MAX(version) AS m FROM strategy_config WHERE strategy_id = ?')
      .get(sid) as { m: number }
    expect(maxV.m).toBe(3)
  })

  it('TRAINING_PRACTICE 策略族也能新建', () => {
    const r = createVersion(
      db,
      baseParams({
        strategy: baseStrategyInput({
          strategyType: 'TRAINING_PRACTICE',
          jobCode: 'SUPERMARKET_SHELVER_TRAIN'
        })
      })
    )
    expect(r).toEqual({ success: true })
  })
})

describe('createVersion — 审计', () => {
  it('新建族成功后写 1 条 INFO 审计（#24）：code=STRATEGY_CONFIG_CREATED, aggregate_id=sid:1', () => {
    const s = baseStrategyInput()
    const r = createVersion(db, baseParams({ strategy: s }))
    expect(r).toEqual({ success: true })
    const row = db
      .prepare(
        `SELECT error_code, severity, error_category, related_aggregate_type, related_aggregate_id, recovery_status
         FROM error_event_log WHERE related_aggregate_id = ?`
      )
      .get(`${s.strategyId}:1`) as {
      error_code: string
      severity: string
      error_category: string
      related_aggregate_type: string
      related_aggregate_id: string
      recovery_status: string
    }
    expect(row.error_code).toBe('STRATEGY_CONFIG_CREATED')
    expect(row.severity).toBe('INFO')
    expect(row.error_category).toBe('SYSTEM')
    expect(row.related_aggregate_type).toBe('STRATEGY_CONFIG')
    expect(row.recovery_status).toBe('IGNORED')
  })

  it('新增版本成功后写 STRATEGY_CONFIG_VERSION_ADDED', () => {
    const sid = `fam-${Math.random().toString(36).slice(2, 8)}`
    seedStrategyRow(baseStrategyInput({ strategyId: sid, version: 1 }))
    createVersion(db, baseParams({ strategy: baseStrategyInput({ strategyId: sid, version: 2 }) }))
    const code = db
      .prepare(
        `SELECT error_code FROM error_event_log WHERE related_aggregate_id = ?`
      )
      .get(`${sid}:2`) as { error_code: string }
    expect(code.error_code).toBe('STRATEGY_CONFIG_VERSION_ADDED')
  })
})

describe('createVersion — 权限失败', () => {
  it('TEACHER 调用 → FORBIDDEN（#10）', () => {
    const teacher = seedCaller(db, 'TEACHER')
    const r = createVersion(
      db,
      baseParams({ callerUserId: teacher, callerRole: 'TEACHER' })
    )
    expect(r).toEqual({ success: false, errorCode: 'FORBIDDEN' })
    const c = db.prepare('SELECT COUNT(*) AS c FROM strategy_config').get() as { c: number }
    expect(c.c).toBe(0)
  })

  it('STUDENT callerRole → FORBIDDEN（#11）', () => {
    const r = createVersion(db, baseParams({ callerRole: 'STUDENT' }))
    expect(r).toEqual({ success: false, errorCode: 'FORBIDDEN' })
  })

  it('伪造 callerRole=ADMIN 但实际是 TEACHER → FORBIDDEN（#23）', () => {
    const teacher = seedCaller(db, 'TEACHER')
    const r = createVersion(
      db,
      baseParams({ callerUserId: teacher, callerRole: 'ADMIN' })
    )
    expect(r).toEqual({ success: false, errorCode: 'FORBIDDEN' })
  })

  it('caller 不存在 → FORBIDDEN', () => {
    const r = createVersion(
      db,
      baseParams({ callerUserId: 'nonexistent-uuid', callerRole: 'ADMIN' })
    )
    expect(r).toEqual({ success: false, errorCode: 'FORBIDDEN' })
  })
})

describe('createVersion — 字段校验失败', () => {
  it('competent <= conditional → VALIDATION_ERROR（#4）', () => {
    const r = createVersion(
      db,
      baseParams({
        strategy: baseStrategyInput({ competentThreshold: 60, conditionalThreshold: 60 })
      })
    )
    expect(r).toEqual({ success: false, errorCode: 'VALIDATION_ERROR' })
  })

  it('competent > 100 → VALIDATION_ERROR（#5）', () => {
    const r = createVersion(
      db,
      baseParams({ strategy: baseStrategyInput({ competentThreshold: 101 }) })
    )
    expect(r).toEqual({ success: false, errorCode: 'VALIDATION_ERROR' })
  })

  it('version=2 但族不存在 → 视为新增版本 → NOT_FOUND（非 VALIDATION_ERROR）', () => {
    const r = createVersion(
      db,
      baseParams({ strategy: baseStrategyInput({ version: 2 }) })
    )
    expect(r).toEqual({ success: false, errorCode: 'NOT_FOUND' })
  })

  it('moduleVetoThreshold > 1 → VALIDATION_ERROR', () => {
    const r = createVersion(
      db,
      baseParams({ strategy: baseStrategyInput({ moduleVetoThreshold: 1.5 }) })
    )
    expect(r).toEqual({ success: false, errorCode: 'VALIDATION_ERROR' })
  })

  it('moduleVetoThreshold < 0 → VALIDATION_ERROR', () => {
    const r = createVersion(
      db,
      baseParams({ strategy: baseStrategyInput({ moduleVetoThreshold: -0.1 }) })
    )
    expect(r).toEqual({ success: false, errorCode: 'VALIDATION_ERROR' })
  })

  it('emotionCollapseThreshold < 1 → VALIDATION_ERROR', () => {
    const r = createVersion(
      db,
      baseParams({ strategy: baseStrategyInput({ emotionCollapseThreshold: 0 }) })
    )
    expect(r).toEqual({ success: false, errorCode: 'VALIDATION_ERROR' })
  })

  it('maxScore <= 0 → VALIDATION_ERROR', () => {
    const r = createVersion(
      db,
      baseParams({ strategy: baseStrategyInput({ maxScore: 0 }) })
    )
    expect(r).toEqual({ success: false, errorCode: 'VALIDATION_ERROR' })
  })

  it('strategyId 空 → VALIDATION_ERROR', () => {
    const r = createVersion(
      db,
      baseParams({ strategy: baseStrategyInput({ strategyId: '' }) })
    )
    expect(r).toEqual({ success: false, errorCode: 'VALIDATION_ERROR' })
  })

  it('strategyType 非法 → VALIDATION_ERROR', () => {
    const r = createVersion(
      db,
      baseParams({
        strategy: baseStrategyInput({ strategyType: 'WRONG' as StrategyType })
      })
    )
    expect(r).toEqual({ success: false, errorCode: 'VALIDATION_ERROR' })
  })
})

describe('createVersion — JSON 校验失败', () => {
  it('question_ratio sum 与 online+offline 不匹配 → INVALID_QUESTION_POLICY（#6）', () => {
    const r = createVersion(
      db,
      baseParams({
        strategy: baseStrategyInput({
          questionPolicy: {
            module_scope: 'CROSS_MODULE',
            question_ratio: { TRUE_FALSE: 10, SINGLE_CHOICE: 10, DRAG: 10, OFFLINE_OPERATION: 8 }
          }
        })
      })
    )
    expect(r).toEqual({ success: false, errorCode: 'INVALID_QUESTION_POLICY' })
  })

  it('question_ratio 含未知题型 → INVALID_QUESTION_POLICY（#7）', () => {
    const r = createVersion(
      db,
      baseParams({
        strategy: baseStrategyInput({
          questionPolicy: {
            module_scope: 'CROSS_MODULE',
            question_ratio: {
              TRUE_FALSE: 14,
              SINGLE_CHOICE: 14,
              DRAG: 14,
              OFFLINE_OPERATION: 8,
              ESSAY: 4
            }
          } as never
        })
      })
    )
    expect(r).toEqual({ success: false, errorCode: 'INVALID_QUESTION_POLICY' })
  })

  it('scoring level_rules 有盲区 → INVALID_SCORING_POLICY（#8）', () => {
    const r = createVersion(
      db,
      baseParams({
        strategy: baseStrategyInput({
          scoringPolicy: {
            score_values: [0, 1, 2],
            normalization: 'raw_score/max_score*100',
            safety_override_enabled: true,
            level_rules: [
              { min: 0, max: 59, level: 'LEVEL_NOT_COMPETENT' },
              { min: 80, max: 100, level: 'LEVEL_COMPETENT' }
            ]
          }
        })
      })
    )
    expect(r).toEqual({ success: false, errorCode: 'INVALID_SCORING_POLICY' })
  })

  it('score_values 非 [0,1,2] → INVALID_SCORING_POLICY（#9）', () => {
    const r = createVersion(
      db,
      baseParams({
        strategy: baseStrategyInput({
          scoringPolicy: {
            score_values: [0, 1, 3],
            normalization: 'raw_score/max_score*100',
            safety_override_enabled: true,
            level_rules: [
              { min: 0, max: 59, level: 'LEVEL_NOT_COMPETENT' },
              { min: 60, max: 79, level: 'LEVEL_CONDITIONAL' },
              { min: 80, max: 100, level: 'LEVEL_COMPETENT' }
            ]
          } as never
        })
      })
    )
    expect(r).toEqual({ success: false, errorCode: 'INVALID_SCORING_POLICY' })
  })

  it('level_rules LEVEL_COMPETENT min 与表列 competentThreshold 漂移 → INVALID_SCORING_POLICY（#36/#37）', () => {
    // 表列 competentThreshold=80，但 level_rules LEVEL_COMPETENT min=85
    const r = createVersion(
      db,
      baseParams({
        strategy: baseStrategyInput({
          competentThreshold: 80,
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
      })
    )
    expect(r).toEqual({ success: false, errorCode: 'INVALID_SCORING_POLICY' })
  })

  it('scoring_policy 缺 level_rules（seed 历史 v0.1.7）→ INVALID_SCORING_POLICY（#40）', () => {
    const r = createVersion(
      db,
      baseParams({
        strategy: baseStrategyInput({
          scoringPolicy: {
            score_values: [0, 1, 2],
            normalization: 'raw_score/max_score*100',
            safety_override_enabled: true
            // level_rules 缺失
          } as never
        })
      })
    )
    expect(r).toEqual({ success: false, errorCode: 'INVALID_SCORING_POLICY' })
  })
})

describe('createVersion — 族冲突', () => {
  it('新建族 v1 但 (type,job) 已存在 → DUPLICATE_JOB_STRATEGY（#32）', () => {
    // 先建一个 BASELINE_ASSESSMENT / SUPERMARKET_SHELVER 族
    const r1 = createVersion(
      db,
      baseParams({
        strategy: baseStrategyInput({ strategyId: 'fam-a', version: 1 })
      })
    )
    expect(r1).toEqual({ success: true })
    // 再用不同 strategyId、相同 (type,job) 建族 → 撞 UNIQUE(type,job,version)
    const r2 = createVersion(
      db,
      baseParams({
        strategy: baseStrategyInput({ strategyId: 'fam-b', version: 1 })
      })
    )
    expect(r2).toEqual({ success: false, errorCode: 'DUPLICATE_JOB_STRATEGY' })
  })

  it('新增版本时 strategyType 与族不一致 → STRATEGY_TYPE_MISMATCH（#14）', () => {
    const sid = `fam-${Math.random().toString(36).slice(2, 8)}`
    seedStrategyRow(
      baseStrategyInput({
        strategyId: sid,
        version: 1,
        strategyType: 'BASELINE_ASSESSMENT'
      })
    )
    const r = createVersion(
      db,
      baseParams({
        strategy: baseStrategyInput({
          strategyId: sid,
          version: 2,
          strategyType: 'MOCK_EXAM'
        })
      })
    )
    expect(r).toEqual({ success: false, errorCode: 'STRATEGY_TYPE_MISMATCH' })
  })

  it('新增版本时 jobCode 与族不一致 → JOB_CODE_MISMATCH', () => {
    const sid = `fam-${Math.random().toString(36).slice(2, 8)}`
    seedStrategyRow(
      baseStrategyInput({ strategyId: sid, version: 1, jobCode: 'JOB_A' })
    )
    const r = createVersion(
      db,
      baseParams({
        strategy: baseStrategyInput({ strategyId: sid, version: 2, jobCode: 'JOB_B' })
      })
    )
    expect(r).toEqual({ success: false, errorCode: 'JOB_CODE_MISMATCH' })
  })

  it('新增版本时 version <= max(existing) → DUPLICATE_VERSION（#15）', () => {
    const sid = `fam-${Math.random().toString(36).slice(2, 8)}`
    seedStrategyRow(baseStrategyInput({ strategyId: sid, version: 1 }))
    seedStrategyRow(baseStrategyInput({ strategyId: sid, version: 2 }))
    const r = createVersion(
      db,
      baseParams({ strategy: baseStrategyInput({ strategyId: sid, version: 2 }) })
    )
    expect(r).toEqual({ success: false, errorCode: 'DUPLICATE_VERSION' })
  })
})

describe('createVersion — DB 约束兜底（catch 分支正确性）', () => {
  it('同 strategy_id 不同 job_code 建族 → PK 冲突 → DUPLICATE_STRATEGY_ID（#2）', () => {
    // 第一条：sid=X, job=JOB_A, version=1 成功
    createVersion(
      db,
      baseParams({
        strategy: baseStrategyInput({ strategyId: 'dup-sid', jobCode: 'JOB_A', version: 1 })
      })
    )
    // 第二条：同 sid=X，不同 job=JOB_B（绕过 (type,job) 前置检查），version=1 → PK 冲突
    const r = createVersion(
      db,
      baseParams({
        strategy: baseStrategyInput({ strategyId: 'dup-sid', jobCode: 'JOB_B', version: 1 })
      })
    )
    expect(r).toEqual({ success: false, errorCode: 'DUPLICATE_STRATEGY_ID' })
  })
})

describe('createVersion — 事务回滚 + SYSTEM_ERROR 审计', () => {
  it('INSERT 抛异常 → SYSTEM_ERROR + ERROR 审计（recovery_status=UNRESOLVED）', () => {
    const originalPrepare = db.prepare.bind(db)
    ;(db as { prepare: (sql: string) => unknown }).prepare = (sql: string) => {
      if (sql.includes('INSERT INTO strategy_config')) {
        throw new Error('simulated insert failure')
      }
      return originalPrepare(sql)
    }
    try {
      const r = createVersion(db, baseParams())
      expect(r).toEqual({ success: false, errorCode: 'SYSTEM_ERROR' })
      const audit = db
        .prepare(
          `SELECT severity, recovery_status, context_json
           FROM error_event_log WHERE error_code = 'STRATEGY_CONFIG_SYSTEM_ERROR'`
        )
        .get() as { severity: string; recovery_status: string; context_json: string }
      expect(audit.severity).toBe('ERROR')
      expect(audit.recovery_status).toBe('UNRESOLVED')
      expect(JSON.parse(audit.context_json).error).toContain('simulated insert failure')
    } finally {
      ;(db as { prepare: (sql: string) => unknown }).prepare = originalPrepare
    }
  })
})
