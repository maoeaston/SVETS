// 等级判定服务（纯函数）。
// 实现 PRD §7.3 等级判定优先级：红线 > 模块兜底/情绪兜底 > 分数阈值。
// 5.4 阶段 moduleScores 仅含线上 6 模块分（线下未评分）。
// 判定顺序严格按 impl.md Step 4，不可颠倒。
// 确定性：相同输入产生相同输出（多模块兜底命中取枚举顺序第一个）。

import type { AbilityTag } from '../../shared/types/json-schemas'

export interface ModuleScoreInput {
  module: AbilityTag
  raw: number
  max: number
}

export interface JudgeLevelInput {
  moduleScores: ModuleScoreInput[]
  emotionCollapseCount: number
  emotionCollapseThreshold: number
  moduleVetoThreshold: number       // strategy_config.module_veto_threshold (0.5)
  competentThreshold: number        // 80
  conditionalThreshold: number      // 60
  safetyTriggered: boolean
}

export interface JudgeLevelOutput {
  levelResult: 'LEVEL_COMPETENT' | 'LEVEL_CONDITIONAL' | 'LEVEL_NOT_COMPETENT' | 'LEVEL_FAIL_BY_SAFETY'
  levelForcedBy: 'MODULE_VETO' | 'EMOTION_COLLAPSE' | null
  moduleVetoTriggeredBy: AbilityTag | null
  normalizedScore: number           // sum(raw) / sum(max) * 100
}

// AbilityTag 枚举顺序（json-schemas.ts 定义）。
// 多模块兜底命中时按此顺序取第一个，保证确定性。
const ABILITY_TAG_ORDER: AbilityTag[] = [
  'FINE_MOTOR',
  'COGNITION',
  'RULE_EXECUTION',
  'EMOTION_REGULATION',
  'BASIC_SOCIAL',
  'SAFETY_OPERATION'
]

export function judgeLevel(input: JudgeLevelInput): JudgeLevelOutput {
  const totalRaw = input.moduleScores.reduce((s, m) => s + m.raw, 0)
  const totalMax = input.moduleScores.reduce((s, m) => s + m.max, 0)
  const normalizedScore = totalMax > 0 ? (totalRaw / totalMax) * 100 : 0

  // 1. 红线优先（levelForcedBy=null，红线覆盖不属兜底）
  if (input.safetyTriggered) {
    return {
      levelResult: 'LEVEL_FAIL_BY_SAFETY',
      levelForcedBy: null,
      moduleVetoTriggeredBy: null,
      normalizedScore
    }
  }

  // 2. 模块兜底：raw/max < moduleVetoThreshold（严格小于，边界 == 不触发）
  let moduleVetoTriggeredBy: AbilityTag | null = null
  for (const tag of ABILITY_TAG_ORDER) {
    const score = input.moduleScores.find(s => s.module === tag)
    if (score && score.max > 0 && score.raw / score.max < input.moduleVetoThreshold) {
      moduleVetoTriggeredBy = tag
      break
    }
  }
  if (moduleVetoTriggeredBy) {
    return {
      levelResult: 'LEVEL_NOT_COMPETENT',
      levelForcedBy: 'MODULE_VETO',
      moduleVetoTriggeredBy,
      normalizedScore
    }
  }

  // 3. 情绪兜底：collapseCount >= threshold（等号触发）
  if (input.emotionCollapseCount >= input.emotionCollapseThreshold) {
    return {
      levelResult: 'LEVEL_NOT_COMPETENT',
      levelForcedBy: 'EMOTION_COLLAPSE',
      moduleVetoTriggeredBy: null,
      normalizedScore
    }
  }

  // 4-6. 分数阈值
  let levelResult: 'LEVEL_COMPETENT' | 'LEVEL_CONDITIONAL' | 'LEVEL_NOT_COMPETENT'
  if (normalizedScore >= input.competentThreshold) {
    levelResult = 'LEVEL_COMPETENT'
  } else if (normalizedScore >= input.conditionalThreshold) {
    levelResult = 'LEVEL_CONDITIONAL'
  } else {
    levelResult = 'LEVEL_NOT_COMPETENT'
  }
  return {
    levelResult,
    levelForcedBy: null,
    moduleVetoTriggeredBy: null,
    normalizedScore
  }
}
