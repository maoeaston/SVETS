// scoring_policy_json 的运行时结构校验。
// 纯函数，不依赖 DB / Electron，可独立单测。
// 对应 doc/xc-career-guide-json-field-schema-v1.0.0.md §6 + 附录 A。
//
// v0.1.8 语义变化：competent_threshold / conditional_threshold /
// module_veto_threshold / emotion_collapse_threshold 已提升为
// strategy_config 表级字段，scoring_policy_json 不再承载这四个键。
// 阈值的「表列 ↔ JSON」一致性改为单向：表列为权威源，JSON 中 level_rules
// 的 LEVEL_COMPETENT / LEVEL_CONDITIONAL 首条 min 必须等于表列阈值。

const LEVEL_VALUES = ['LEVEL_COMPETENT', 'LEVEL_CONDITIONAL', 'LEVEL_NOT_COMPETENT'] as const

export interface ScoringPolicyCtx {
  strategyCompetentThreshold: number
  strategyConditionalThreshold: number
}

export type ScoringPolicyValidationOk = { ok: true }
export type ScoringPolicyValidationErr = { ok: false; reason: string }
export type ScoringPolicyValidationResult =
  | ScoringPolicyValidationOk
  | ScoringPolicyValidationErr

interface LevelRuleShape {
  min: number
  max: number
  level: string
}

/**
 * 校验 scoring_policy_json 的结构 + level_rules 覆盖性 + 表列一致性。
 *
 * - score_values 严格 [0,1,2]
 * - normalization === 'raw_score/max_score*100'
 * - safety_override_enabled 布尔
 * - level_rules 非空，每条 min<=max、level 枚举合法
 * - 覆盖性：按 min 排序后连续覆盖 [0,100] 无盲区无重叠
 * - 表列一致性：LEVEL_COMPETENT 首条 min === ctx.strategyCompetentThreshold；
 *   LEVEL_CONDITIONAL 首条 min === ctx.strategyConditionalThreshold
 */
export function validateScoringPolicy(
  input: unknown,
  ctx: ScoringPolicyCtx
): ScoringPolicyValidationResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, reason: 'scoring_policy must be an object' }
  }
  const obj = input as Record<string, unknown>

  // 1. score_values === [0, 1, 2]
  const sv = obj.score_values
  if (
    !Array.isArray(sv) ||
    sv.length !== 3 ||
    sv[0] !== 0 ||
    sv[1] !== 1 ||
    sv[2] !== 2
  ) {
    return { ok: false, reason: 'score_values must be exactly [0, 1, 2]' }
  }

  // 2. normalization
  if (obj.normalization !== 'raw_score/max_score*100') {
    return {
      ok: false,
      reason: `normalization must be 'raw_score/max_score*100', got ${JSON.stringify(obj.normalization)}`
    }
  }

  // 3. safety_override_enabled
  if (typeof obj.safety_override_enabled !== 'boolean') {
    return { ok: false, reason: 'safety_override_enabled must be boolean' }
  }

  // 4. level_rules 非空数组
  const lrRaw = obj.level_rules
  if (!Array.isArray(lrRaw) || lrRaw.length === 0) {
    return { ok: false, reason: 'level_rules must be a non-empty array' }
  }

  // 4b. 每条结构
  const rules: LevelRuleShape[] = []
  for (let i = 0; i < lrRaw.length; i++) {
    const r = lrRaw[i]
    if (typeof r !== 'object' || r === null || Array.isArray(r)) {
      return { ok: false, reason: `level_rules[${i}] must be an object` }
    }
    const rr = r as Record<string, unknown>
    if (
      typeof rr.min !== 'number' ||
      typeof rr.max !== 'number' ||
      typeof rr.level !== 'string'
    ) {
      return {
        ok: false,
        reason: `level_rules[${i}] must have numeric min/max and string level`
      }
    }
    if (!Number.isFinite(rr.min) || !Number.isFinite(rr.max)) {
      return { ok: false, reason: `level_rules[${i}] min/max must be finite` }
    }
    if (rr.min > rr.max) {
      return {
        ok: false,
        reason: `level_rules[${i}] min (${rr.min}) > max (${rr.max})`
      }
    }
    if (!(LEVEL_VALUES as readonly string[]).includes(rr.level)) {
      return {
        ok: false,
        reason: `level_rules[${i}].level must be one of ${LEVEL_VALUES.join(' / ')}, got ${rr.level}`
      }
    }
    rules.push({ min: rr.min, max: rr.max, level: rr.level })
  }

  // 5. 覆盖性：按 min 排序后连续覆盖 [0,100]
  const sorted = [...rules].sort((a, b) => a.min - b.min)
  if (sorted[0].min !== 0) {
    return {
      ok: false,
      reason: `level_rules must start at min=0, got min=${sorted[0].min}`
    }
  }
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]
    const curr = sorted[i]
    if (curr.min !== prev.max + 1) {
      return {
        ok: false,
        reason: `level_rules has gap/overlap between [${prev.min},${prev.max}] and [${curr.min},${curr.max}]`
      }
    }
  }
  const last = sorted[sorted.length - 1]
  if (last.max !== 100) {
    return {
      ok: false,
      reason: `level_rules must end at max=100, got max=${last.max}`
    }
  }

  // 6. 表列一致性（v0.1.8 单源）
  // LEVEL_COMPETENT 首条（按 min 排序后第一个 LEVEL_COMPETENT）min 必须等于表列 competent_threshold
  const competentRule = sorted.find((r) => r.level === 'LEVEL_COMPETENT')
  if (!competentRule) {
    return { ok: false, reason: 'level_rules missing LEVEL_COMPETENT entry' }
  }
  if (competentRule.min !== ctx.strategyCompetentThreshold) {
    return {
      ok: false,
      reason: `LEVEL_COMPETENT min (${competentRule.min}) must equal strategy_config.competent_threshold (${ctx.strategyCompetentThreshold})`
    }
  }
  const conditionalRule = sorted.find((r) => r.level === 'LEVEL_CONDITIONAL')
  if (!conditionalRule) {
    return { ok: false, reason: 'level_rules missing LEVEL_CONDITIONAL entry' }
  }
  if (conditionalRule.min !== ctx.strategyConditionalThreshold) {
    return {
      ok: false,
      reason: `LEVEL_CONDITIONAL min (${conditionalRule.min}) must equal strategy_config.conditional_threshold (${ctx.strategyConditionalThreshold})`
    }
  }

  return { ok: true }
}
