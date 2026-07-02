// validateQuestionPolicy 单测：纯函数校验，无 DB 依赖。
// 覆盖 impl doc Step 1 测试矩阵 9 条。

import { describe, it, expect } from 'vitest'
import { validateQuestionPolicy } from '../validate-question-policy'

const ctx50 = { onlineQuestionCount: 42, offlineQuestionCount: 8 }

function basePolicy(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    module_scope: 'CROSS_MODULE',
    question_ratio: { TRUE_FALSE: 14, SINGLE_CHOICE: 14, DRAG: 14, OFFLINE_OPERATION: 8 },
    ...over
  }
}

describe('validateQuestionPolicy — 正常路径', () => {
  it('完整 4 题型 ratio，sum=50 与 ctx 匹配 → 通过', () => {
    const r = validateQuestionPolicy(basePolicy(), ctx50)
    expect(r).toEqual({ ok: true })
  })

  it('缺失部分题型 key（只填 TRUE_FALSE:50）→ 缺失按 0，sum=50 通过', () => {
    const r = validateQuestionPolicy(
      basePolicy({ question_ratio: { TRUE_FALSE: 50 } }),
      ctx50
    )
    expect(r).toEqual({ ok: true })
  })

  it('difficulty_distribution 缺失 → 通过', () => {
    const r = validateQuestionPolicy(basePolicy(), ctx50)
    expect(r).toEqual({ ok: true })
  })

  it('difficulty_distribution 和=0.9995 → 通过（容差内，非边界）', () => {
    // 注：避开 0.5+0.499=0.999 这类 FP 边界值——IEEE 754 下实际为
    // 0.99899999...，diff 0.001000...1 严格 > 0.001 会误判。
    const r = validateQuestionPolicy(
      basePolicy({ difficulty_distribution: { EASY: 0.5, HARD: 0.4995 } }),
      ctx50
    )
    expect(r).toEqual({ ok: true })
  })

  it('sensory_filter_mode / fallback_strategy 两字段都缺失 → 通过', () => {
    const r = validateQuestionPolicy(basePolicy(), ctx50)
    expect(r).toEqual({ ok: true })
  })
})

describe('validateQuestionPolicy — 失败路径', () => {
  it('ratio sum 不足（49 != 50）→ 失败', () => {
    const r = validateQuestionPolicy(
      basePolicy({ question_ratio: { TRUE_FALSE: 13, SINGLE_CHOICE: 14, DRAG: 14, OFFLINE_OPERATION: 8 } }),
      ctx50
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/question_ratio sum/)
  })

  it('module_scope 非法 → 失败', () => {
    const r = validateQuestionPolicy(basePolicy({ module_scope: 'WRONG' }), ctx50)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/module_scope/)
  })

  it('required_modules 含非 AbilityTag → 失败', () => {
    const r = validateQuestionPolicy(
      basePolicy({ required_modules: ['FINE_MOTOR', 'NOT_A_TAG'] }),
      ctx50
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/required_modules/)
  })

  it('difficulty_distribution 和=0.95 → 失败（超出容差）', () => {
    const r = validateQuestionPolicy(
      basePolicy({ difficulty_distribution: { EASY: 0.6, HARD: 0.35 } }),
      ctx50
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/difficulty_distribution sum/)
  })

  it('sensory_filter_mode 枚举非法 → 失败', () => {
    const r = validateQuestionPolicy(
      basePolicy({ sensory_filter_mode: 'LAX' }),
      ctx50
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/sensory_filter_mode/)
  })

  it('fallback_strategy 枚举非法 → 失败', () => {
    const r = validateQuestionPolicy(
      basePolicy({ fallback_strategy: 'PANIC' }),
      ctx50
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/fallback_strategy/)
  })

  it('question_ratio 含未知题型 key → 失败（防脏数据）', () => {
    const r = validateQuestionPolicy(
      basePolicy({ question_ratio: { TRUE_FALSE: 14, SINGLE_CHOICE: 14, DRAG: 14, OFFLINE_OPERATION: 8, ESSAY: 4 } }),
      ctx50
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/unknown question type/)
  })

  it('question_ratio 负值 → 失败', () => {
    const r = validateQuestionPolicy(
      basePolicy({ question_ratio: { TRUE_FALSE: -1, SINGLE_CHOICE: 15, DRAG: 14, OFFLINE_OPERATION: 22 } }),
      ctx50
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/non-negative integer/)
  })

  it('required_modules 空数组 → 失败', () => {
    const r = validateQuestionPolicy(
      basePolicy({ required_modules: [] }),
      ctx50
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/required_modules/)
  })

  it('输入非对象 → 失败', () => {
    expect(validateQuestionPolicy('not an object', ctx50).ok).toBe(false)
    expect(validateQuestionPolicy(null, ctx50).ok).toBe(false)
    expect(validateQuestionPolicy([], ctx50).ok).toBe(false)
  })
})
