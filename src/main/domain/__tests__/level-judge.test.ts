import { describe, it, expect } from 'vitest'
import { judgeLevel } from '../level-judge'
import type { JudgeLevelInput, ModuleScoreInput } from '../level-judge'
import type { AbilityTag } from '../../../shared/types/json-schemas'

const MODULES: AbilityTag[] = [
  'FINE_MOTOR',
  'COGNITION',
  'RULE_EXECUTION',
  'EMOTION_REGULATION',
  'BASIC_SOCIAL',
  'SAFETY_OPERATION'
]

// 构造 6 模块分数，默认每模块 raw=10/max=10（满分，normalized=100）。
function makeModuleScores(raws: Partial<Record<AbilityTag, number>> = {}): ModuleScoreInput[] {
  return MODULES.map(m => ({ module: m, raw: raws[m] ?? 10, max: 10 }))
}

function baseInput(over: Partial<JudgeLevelInput> = {}): JudgeLevelInput {
  return {
    moduleScores: makeModuleScores(),
    emotionCollapseCount: 0,
    emotionCollapseThreshold: 3,
    moduleVetoThreshold: 0.5,
    competentThreshold: 80,
    conditionalThreshold: 60,
    safetyTriggered: false,
    ...over
  }
}

describe('judgeLevel', () => {
  // §17.6.1 case 1: 总分 85 但 COGNITION 0.4 < 0.5 → MODULE_VETO
  it('总分 85 + COGNITION 得分率 0.4 < 0.5 → LEVEL_NOT_COMPETENT + MODULE_VETO + COGNITION', () => {
    // sum=51/60=85%；COGNITION raw=4 → 0.4 触发 veto
    const moduleScores = makeModuleScores({
      COGNITION: 4,
      EMOTION_REGULATION: 9,
      BASIC_SOCIAL: 9,
      SAFETY_OPERATION: 9
    })
    const r = judgeLevel(baseInput({ moduleScores }))
    expect(r.levelResult).toBe('LEVEL_NOT_COMPETENT')
    expect(r.levelForcedBy).toBe('MODULE_VETO')
    expect(r.moduleVetoTriggeredBy).toBe('COGNITION')
    expect(r.normalizedScore).toBeCloseTo(85, 5)
  })

  // §17.6.1 case 2: 总分 85 无兜底 → LEVEL_COMPETENT
  it('总分 85 无兜底 → LEVEL_COMPETENT', () => {
    const moduleScores = makeModuleScores({
      FINE_MOTOR: 9,
      COGNITION: 9,
      RULE_EXECUTION: 9,
      EMOTION_REGULATION: 8,
      BASIC_SOCIAL: 8,
      SAFETY_OPERATION: 8
    })
    const r = judgeLevel(baseInput({ moduleScores }))
    expect(r.levelResult).toBe('LEVEL_COMPETENT')
    expect(r.levelForcedBy).toBe(null)
    expect(r.normalizedScore).toBeCloseTo(85, 5)
  })

  // §17.6.1 case 3: 总分 70 → LEVEL_CONDITIONAL
  it('总分 70 无兜底 → LEVEL_CONDITIONAL', () => {
    const moduleScores = makeModuleScores({
      FINE_MOTOR: 7,
      COGNITION: 7,
      RULE_EXECUTION: 7,
      EMOTION_REGULATION: 7,
      BASIC_SOCIAL: 7,
      SAFETY_OPERATION: 7
    })
    const r = judgeLevel(baseInput({ moduleScores }))
    expect(r.levelResult).toBe('LEVEL_CONDITIONAL')
    expect(r.levelForcedBy).toBe(null)
    expect(r.normalizedScore).toBeCloseTo(70, 5)
  })

  // §17.6.1 case 4: 总分 50 → LEVEL_NOT_COMPETENT（无兜底）
  it('总分 50 无兜底 → LEVEL_NOT_COMPETENT（levelForcedBy=null）', () => {
    const moduleScores = makeModuleScores({
      FINE_MOTOR: 5,
      COGNITION: 5,
      RULE_EXECUTION: 5,
      EMOTION_REGULATION: 5,
      BASIC_SOCIAL: 5,
      SAFETY_OPERATION: 5
    })
    const r = judgeLevel(baseInput({ moduleScores }))
    expect(r.levelResult).toBe('LEVEL_NOT_COMPETENT')
    expect(r.levelForcedBy).toBe(null)
    expect(r.normalizedScore).toBeCloseTo(50, 5)
  })

  // §17.6.1 case 5: collapseCount >= threshold → EMOTION_COLLAPSE
  it('collapseCount=3 >= threshold=3 → LEVEL_NOT_COMPETENT + EMOTION_COLLAPSE', () => {
    const r = judgeLevel(baseInput({ emotionCollapseCount: 3 }))
    expect(r.levelResult).toBe('LEVEL_NOT_COMPETENT')
    expect(r.levelForcedBy).toBe('EMOTION_COLLAPSE')
  })

  // §17.6.1 case 6: collapseCount=1 < threshold=3 → 不触发兜底，按分数
  it('collapseCount=1 < threshold=3 → 不触发情绪兜底，按分数判定（满分 → COMPETENT）', () => {
    const r = judgeLevel(baseInput({ emotionCollapseCount: 1 }))
    expect(r.levelResult).toBe('LEVEL_COMPETENT')
    expect(r.levelForcedBy).toBe(null)
  })

  // §17.6.1 case 7: safetyTriggered 优先于模块兜底
  it('safetyTriggered=true + 模块兜底也触发 → LEVEL_FAIL_BY_SAFETY（优先级最高）', () => {
    const moduleScores = makeModuleScores({ COGNITION: 3 }) // COGNITION 0.3 < 0.5 触发 veto
    const r = judgeLevel(baseInput({ moduleScores, safetyTriggered: true }))
    expect(r.levelResult).toBe('LEVEL_FAIL_BY_SAFETY')
    expect(r.levelForcedBy).toBe(null)
    expect(r.moduleVetoTriggeredBy).toBe(null)
  })

  // §17.6.1 case 8: 多模块兜底命中取枚举顺序第一个
  it('FINE_MOTOR + COGNITION 同时 < 0.5 → moduleVetoTriggeredBy 取 FINE_MOTOR（枚举第一）', () => {
    const moduleScores = makeModuleScores({
      FINE_MOTOR: 4, // 0.4 < 0.5
      COGNITION: 3 // 0.3 < 0.5
    })
    const r = judgeLevel(baseInput({ moduleScores }))
    expect(r.levelResult).toBe('LEVEL_NOT_COMPETENT')
    expect(r.levelForcedBy).toBe('MODULE_VETO')
    expect(r.moduleVetoTriggeredBy).toBe('FINE_MOTOR')
  })

  // §17.6.1 case 9: 正常路径，collapseCount=0，总分 80 → COMPETENT
  it('collapseCount=0 + 模块正常 + 总分 80 → LEVEL_COMPETENT（levelForcedBy=null）', () => {
    const moduleScores = makeModuleScores({
      FINE_MOTOR: 8,
      COGNITION: 8,
      RULE_EXECUTION: 8,
      EMOTION_REGULATION: 8,
      BASIC_SOCIAL: 8,
      SAFETY_OPERATION: 8
    })
    const r = judgeLevel(baseInput({ moduleScores, emotionCollapseCount: 0 }))
    expect(r.levelResult).toBe('LEVEL_COMPETENT')
    expect(r.levelForcedBy).toBe(null)
    expect(r.normalizedScore).toBeCloseTo(80, 5)
  })
})
