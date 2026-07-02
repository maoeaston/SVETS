// question_policy_json 的运行时结构校验。
// 纯函数，不依赖 DB / Electron，可独立单测。
// 对应 doc/xc-career-guide-json-field-schema-v1.0.0.md §5 + 附录 A 跨字段校验。

const MODULE_SCOPES = ['SINGLE_MODULE', 'CROSS_MODULE'] as const
const QUESTION_TYPES = ['TRUE_FALSE', 'SINGLE_CHOICE', 'DRAG', 'OFFLINE_OPERATION'] as const
const ABILITY_TAGS = [
  'FINE_MOTOR',
  'COGNITION',
  'RULE_EXECUTION',
  'EMOTION_REGULATION',
  'BASIC_SOCIAL',
  'SAFETY_OPERATION'
] as const
const SENSORY_FILTER_MODES = ['SOFT', 'STRICT'] as const
const FALLBACK_STRATEGIES = ['LOW_STIMULI_FIRST', 'SAME_TYPE_DIFFERENT_ASSET', 'BLOCK'] as const

export interface QuestionPolicyCtx {
  onlineQuestionCount: number
  offlineQuestionCount: number
}

export type QuestionPolicyValidationOk = { ok: true }
export type QuestionPolicyValidationErr = { ok: false; reason: string }
export type QuestionPolicyValidationResult =
  | QuestionPolicyValidationOk
  | QuestionPolicyValidationErr

function isNonNegInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0
}

/**
 * 校验 question_policy_json 的结构 + 跨字段一致性。
 * - module_scope / question_ratio 必填
 * - question_ratio 各题型 key 可选（缺失按 0）；sum(各值) 必须等于 online + offline
 * - required_modules / difficulty_distribution / sensory_filter_mode / fallback_strategy 可选
 *
 * ctx 提供表列 online/offline_question_count，用于跨字段 sum 校验（附录 A）。
 */
export function validateQuestionPolicy(
  input: unknown,
  ctx: QuestionPolicyCtx
): QuestionPolicyValidationResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, reason: 'question_policy must be an object' }
  }
  const obj = input as Record<string, unknown>

  // 1. module_scope
  if (!(MODULE_SCOPES as readonly string[]).includes(obj.module_scope as string)) {
    return {
      ok: false,
      reason: `module_scope must be one of ${MODULE_SCOPES.join(' / ')}`
    }
  }

  // 2. question_ratio（必填；各 key 可选，缺失按 0）
  const ratioRaw = obj.question_ratio
  if (typeof ratioRaw !== 'object' || ratioRaw === null || Array.isArray(ratioRaw)) {
    return { ok: false, reason: 'question_ratio must be an object' }
  }
  const ratio = ratioRaw as Record<string, unknown>
  let sum = 0
  for (const qt of QUESTION_TYPES) {
    const v = ratio[qt]
    if (v === undefined) continue // 缺失 key 按 0
    if (!isNonNegInt(v)) {
      return {
        ok: false,
        reason: `question_ratio.${qt} must be a non-negative integer, got ${JSON.stringify(v)}`
      }
    }
    sum += v
  }
  // 拒绝未知 key（防脏数据 / 拼写错误）
  for (const k of Object.keys(ratio)) {
    if (!(QUESTION_TYPES as readonly string[]).includes(k)) {
      return { ok: false, reason: `question_ratio has unknown question type key "${k}"` }
    }
  }

  // 6. 跨字段：sum(ratio) === online + offline
  const expected = ctx.onlineQuestionCount + ctx.offlineQuestionCount
  if (sum !== expected) {
    return {
      ok: false,
      reason: `question_ratio sum (${sum}) must equal online + offline (${expected})`
    }
  }

  // 3. required_modules（可选）
  if (obj.required_modules !== undefined) {
    const rm = obj.required_modules
    if (!Array.isArray(rm) || rm.length === 0) {
      return { ok: false, reason: 'required_modules must be a non-empty array' }
    }
    for (const m of rm) {
      if (typeof m !== 'string' || !(ABILITY_TAGS as readonly string[]).includes(m)) {
        return {
          ok: false,
          reason: `required_modules contains invalid ability tag: ${JSON.stringify(m)}`
        }
      }
    }
  }

  // 4. difficulty_distribution（可选；若存在，各值为数值且和约 1.0）
  if (obj.difficulty_distribution !== undefined) {
    const dd = obj.difficulty_distribution
    if (typeof dd !== 'object' || dd === null || Array.isArray(dd)) {
      return { ok: false, reason: 'difficulty_distribution must be an object' }
    }
    let ddSum = 0
    let hasKeys = false
    for (const [, v] of Object.entries(dd as Record<string, unknown>)) {
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        return { ok: false, reason: 'difficulty_distribution values must be finite numbers' }
      }
      ddSum += v
      hasKeys = true
    }
    if (hasKeys && Math.abs(ddSum - 1) > 0.001) {
      return {
        ok: false,
        reason: `difficulty_distribution sum (${ddSum}) must be ~1.0 (tolerance 0.001)`
      }
    }
  }

  // 5. sensory_filter_mode（可选）
  if (
    obj.sensory_filter_mode !== undefined &&
    !(SENSORY_FILTER_MODES as readonly string[]).includes(obj.sensory_filter_mode as string)
  ) {
    return {
      ok: false,
      reason: `sensory_filter_mode must be one of ${SENSORY_FILTER_MODES.join(' / ')}`
    }
  }

  // 5b. fallback_strategy（可选）
  if (
    obj.fallback_strategy !== undefined &&
    !(FALLBACK_STRATEGIES as readonly string[]).includes(obj.fallback_strategy as string)
  ) {
    return {
      ok: false,
      reason: `fallback_strategy must be one of ${FALLBACK_STRATEGIES.join(' / ')}`
    }
  }

  return { ok: true }
}
