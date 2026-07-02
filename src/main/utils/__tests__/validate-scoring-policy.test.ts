// validateScoringPolicy 单测：纯函数校验，无 DB 依赖。
// 覆盖 impl doc Step 1 测试矩阵 10 条 + v0.1.8 表列一致性。

import { describe, it, expect } from 'vitest'
import { validateScoringPolicy } from '../validate-scoring-policy'

// 默认 ctx：表列 competent=80 / conditional=60（与 schema seed 一致）
const ctxDefault = { strategyCompetentThreshold: 80, strategyConditionalThreshold: 60 }

// 标准合法 level_rules：[0,59]=NOT_COMPETENT, [60,79]=CONDITIONAL, [80,100]=COMPETENT
function basePolicy(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    score_values: [0, 1, 2],
    normalization: 'raw_score/max_score*100',
    safety_override_enabled: true,
    level_rules: [
      { min: 0, max: 59, level: 'LEVEL_NOT_COMPETENT' },
      { min: 60, max: 79, level: 'LEVEL_CONDITIONAL' },
      { min: 80, max: 100, level: 'LEVEL_COMPETENT' }
    ],
    ...over
  }
}

describe('validateScoringPolicy — 正常路径', () => {
  it('3 条 level_rules 覆盖 [0,100]，min 与 ctx 表列一致 → 通过', () => {
    const r = validateScoringPolicy(basePolicy(), ctxDefault)
    expect(r).toEqual({ ok: true })
  })

  it('level_rules 乱序传入 → 排序后覆盖仍通过', () => {
    const r = validateScoringPolicy(
      basePolicy({
        level_rules: [
          { min: 80, max: 100, level: 'LEVEL_COMPETENT' },
          { min: 0, max: 59, level: 'LEVEL_NOT_COMPETENT' },
          { min: 60, max: 79, level: 'LEVEL_CONDITIONAL' }
        ]
      }),
      ctxDefault
    )
    expect(r).toEqual({ ok: true })
  })

  it('level_rules 拆成更多段（CONDITIONAL 拆两段）→ 通过', () => {
    const r = validateScoringPolicy(
      basePolicy({
        level_rules: [
          { min: 0, max: 59, level: 'LEVEL_NOT_COMPETENT' },
          { min: 60, max: 69, level: 'LEVEL_CONDITIONAL' },
          { min: 70, max: 79, level: 'LEVEL_CONDITIONAL' },
          { min: 80, max: 100, level: 'LEVEL_COMPETENT' }
        ]
      }),
      ctxDefault
    )
    expect(r).toEqual({ ok: true })
  })
})

describe('validateScoringPolicy — 字段结构失败', () => {
  it('score_values=[0,1,1] → 失败', () => {
    const r = validateScoringPolicy(basePolicy({ score_values: [0, 1, 1] }), ctxDefault)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/score_values/)
  })

  it('normalization 错误 → 失败', () => {
    const r = validateScoringPolicy(
      basePolicy({ normalization: 'wrong/formula' }),
      ctxDefault
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/normalization/)
  })

  it('safety_override_enabled 非布尔 → 失败', () => {
    const r = validateScoringPolicy(
      basePolicy({ safety_override_enabled: 'yes' }),
      ctxDefault
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/safety_override_enabled/)
  })

  it('level_rules 空数组 → 失败', () => {
    const r = validateScoringPolicy(basePolicy({ level_rules: [] }), ctxDefault)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/level_rules/)
  })

  it('level_rules 缺失（seed 历史）→ 失败（覆盖验收 #40）', () => {
    const seedLike = {
      score_values: [0, 1, 2],
      normalization: 'raw_score/max_score*100',
      pass_threshold: 80, // v0.1.7 残留键，应被忽略
      improve_threshold: 60,
      safety_override_enabled: true
      // level_rules 缺失
    }
    const r = validateScoringPolicy(seedLike, ctxDefault)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/level_rules/)
  })
})

describe('validateScoringPolicy — 覆盖性失败', () => {
  it('level_rules 有盲区（[0,59]+[80,100] 缺中间）→ 失败', () => {
    const r = validateScoringPolicy(
      basePolicy({
        level_rules: [
          { min: 0, max: 59, level: 'LEVEL_NOT_COMPETENT' },
          { min: 80, max: 100, level: 'LEVEL_COMPETENT' }
        ]
      }),
      ctxDefault
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/gap|overlap/)
  })

  it('level_rules 重叠（[0,79]+[60,100]）→ 失败', () => {
    const r = validateScoringPolicy(
      basePolicy({
        level_rules: [
          { min: 0, max: 79, level: 'LEVEL_NOT_COMPETENT' },
          { min: 60, max: 100, level: 'LEVEL_COMPETENT' }
        ]
      }),
      ctxDefault
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/gap|overlap/)
  })

  it('level_rules 末条 max=99 → 失败（未到 100）', () => {
    const r = validateScoringPolicy(
      basePolicy({
        level_rules: [
          { min: 0, max: 59, level: 'LEVEL_NOT_COMPETENT' },
          { min: 60, max: 79, level: 'LEVEL_CONDITIONAL' },
          { min: 80, max: 99, level: 'LEVEL_COMPETENT' }
        ]
      }),
      ctxDefault
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/max=100/)
  })

  it('level_rules 首条 min!=0 → 失败', () => {
    const r = validateScoringPolicy(
      basePolicy({
        level_rules: [
          { min: 1, max: 59, level: 'LEVEL_NOT_COMPETENT' },
          { min: 60, max: 79, level: 'LEVEL_CONDITIONAL' },
          { min: 80, max: 100, level: 'LEVEL_COMPETENT' }
        ]
      }),
      ctxDefault
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/min=0/)
  })

  it('level 单项 min>max → 失败', () => {
    const r = validateScoringPolicy(
      basePolicy({
        level_rules: [
          { min: 0, max: -1, level: 'LEVEL_NOT_COMPETENT' },
          { min: 60, max: 79, level: 'LEVEL_CONDITIONAL' },
          { min: 80, max: 100, level: 'LEVEL_COMPETENT' }
        ]
      }),
      ctxDefault
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/min.*>/)
  })

  it('level 枚举非法（LEVEL_PASS 旧值）→ 失败', () => {
    const r = validateScoringPolicy(
      basePolicy({
        level_rules: [
          { min: 0, max: 59, level: 'LEVEL_FAIL' },
          { min: 60, max: 79, level: 'LEVEL_CONDITIONAL' },
          { min: 80, max: 100, level: 'LEVEL_COMPETENT' }
        ]
      }),
      ctxDefault
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/level/)
  })
})

describe('validateScoringPolicy — 表列一致性失败（v0.1.8 单源）', () => {
  it('LEVEL_COMPETENT 首条 min=85 vs ctx.strategyCompetentThreshold=80 → 失败', () => {
    const r = validateScoringPolicy(
      basePolicy({
        level_rules: [
          { min: 0, max: 59, level: 'LEVEL_NOT_COMPETENT' },
          { min: 60, max: 84, level: 'LEVEL_CONDITIONAL' },
          { min: 85, max: 100, level: 'LEVEL_COMPETENT' }
        ]
      }),
      ctxDefault // competent=80
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/LEVEL_COMPETENT/)
  })

  it('LEVEL_CONDITIONAL 首条 min=70 vs ctx.strategyConditionalThreshold=60 → 失败', () => {
    const r = validateScoringPolicy(
      basePolicy({
        level_rules: [
          { min: 0, max: 59, level: 'LEVEL_NOT_COMPETENT' },
          { min: 70, max: 79, level: 'LEVEL_CONDITIONAL' },
          { min: 80, max: 100, level: 'LEVEL_COMPETENT' }
        ]
        // 注意：[60,69] 段缺失会先在覆盖性校验失败，需先补一段 LEVEL_NOT_COMPETENT
      }),
      ctxDefault
    )
    expect(r.ok).toBe(false)
    // 覆盖性先 fail（[0,59]→[70,79] 缺 [60,69]）
    if (!r.ok) expect(r.reason).toMatch(/gap|overlap|LEVEL_CONDITIONAL/)
  })

  it('LEVEL_CONDITIONAL 首条 min 漂移但覆盖性完整 → 失败于一致性校验', () => {
    // 构造：覆盖性完整（无 gap），但 LEVEL_CONDITIONAL min 与 ctx 不一致
    // ctx = { competent: 80, conditional: 60 }
    // 传入 level_rules 用 conditional=65：[0,64]=NOT_COMPETENT, [65,79]=CONDITIONAL, [80,100]=COMPETENT
    // 覆盖性 OK（0→64→65→79→80→100 连续），但 65 != ctx 60 → 一致性 fail
    const r = validateScoringPolicy(
      basePolicy({
        level_rules: [
          { min: 0, max: 64, level: 'LEVEL_NOT_COMPETENT' },
          { min: 65, max: 79, level: 'LEVEL_CONDITIONAL' },
          { min: 80, max: 100, level: 'LEVEL_COMPETENT' }
        ]
      }),
      ctxDefault
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/LEVEL_CONDITIONAL/)
  })

  it('缺 LEVEL_COMPETENT 段 → 失败', () => {
    const r = validateScoringPolicy(
      basePolicy({
        level_rules: [
          { min: 0, max: 59, level: 'LEVEL_NOT_COMPETENT' },
          { min: 60, max: 100, level: 'LEVEL_CONDITIONAL' }
        ]
      }),
      ctxDefault
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/LEVEL_COMPETENT/)
  })
})

describe('validateScoringPolicy — 非对象输入', () => {
  it('输入非对象 → 失败', () => {
    expect(validateScoringPolicy('nope', ctxDefault).ok).toBe(false)
    expect(validateScoringPolicy(null, ctxDefault).ok).toBe(false)
    expect(validateScoringPolicy([], ctxDefault).ok).toBe(false)
  })
})
