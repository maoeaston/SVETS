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
  // v1.2 判别：question-policy-v1.2（QuestionPolicyBaseAbility）走结构化校验；
  // 旧 QuestionPolicyJson（question_ratio）走下方兼容分支，调用点行为不变。
  if (
    typeof input === 'object' && input !== null && !Array.isArray(input) &&
    (input as Record<string, unknown>).schema_version === 'question-policy-v1.2'
  ) {
    return validateQuestionPolicyBaseAbility(input, ctx)
  }
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

/** v1.2 允许的题型（含 SOFTWARE_TASK，旧 QUESTION_TYPES 不含）。 */
const QUESTION_TYPES_V12 = [
  'TRUE_FALSE',
  'SINGLE_CHOICE',
  'DRAG',
  'SOFTWARE_TASK',
  'OFFLINE_OPERATION'
] as const

/**
 * 校验 question-policy-v1.2（QuestionPolicyBaseAbility）。
 * v1.2 不使用 question_ratio；组卷按 online_quota_by_module 每模块固定配额。
 * 与 strategy_config.online/offline_question_count 做跨字段一致性校验。
 */
function validateQuestionPolicyBaseAbility(
  input: unknown,
  ctx: QuestionPolicyCtx
): QuestionPolicyValidationResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, reason: 'question_policy (v1.2) must be an object' }
  }
  const obj = input as Record<string, unknown>

  if (obj.schema_version !== 'question-policy-v1.2') {
    return { ok: false, reason: 'schema_version must be "question-policy-v1.2"' }
  }
  if (obj.module_scope !== 'CROSS_MODULE') {
    return { ok: false, reason: 'module_scope must be "CROSS_MODULE" for v1.2' }
  }

  // eligible_bank_domains 必须恰好 ['BASE_ABILITY']（PRD §7.6.1 规则 1）
  const ebd = obj.eligible_bank_domains
  if (!Array.isArray(ebd) || ebd.length !== 1 || ebd[0] !== 'BASE_ABILITY') {
    return { ok: false, reason: 'eligible_bank_domains must be ["BASE_ABILITY"]' }
  }
  // eligible_item_usage 必须恰好 ['SCORED_ITEM']（观察项不进入 42+8）
  const eiu = obj.eligible_item_usage
  if (!Array.isArray(eiu) || eiu.length !== 1 || eiu[0] !== 'SCORED_ITEM') {
    return { ok: false, reason: 'eligible_item_usage must be ["SCORED_ITEM"]' }
  }

  // online_quota_by_module：每个值为非负整数，key 必须是合法 AbilityTag
  const qbm = obj.online_quota_by_module
  if (typeof qbm !== 'object' || qbm === null || Array.isArray(qbm)) {
    return { ok: false, reason: 'online_quota_by_module must be an object' }
  }
  let onlineSum = 0
  for (const [k, v] of Object.entries(qbm as Record<string, unknown>)) {
    if (!(ABILITY_TAGS as readonly string[]).includes(k)) {
      return { ok: false, reason: `online_quota_by_module has unknown ability tag: ${k}` }
    }
    if (!isNonNegInt(v)) {
      return { ok: false, reason: `online_quota_by_module.${k} must be a non-negative integer` }
    }
    onlineSum += v as number
  }
  if (onlineSum !== ctx.onlineQuestionCount) {
    return {
      ok: false,
      reason: `online_quota_by_module sum (${onlineSum}) must equal online_question_count (${ctx.onlineQuestionCount})`
    }
  }

  // offline_total：非负整数，等于表列 offline_question_count
  if (!isNonNegInt(obj.offline_total)) {
    return { ok: false, reason: 'offline_total must be a non-negative integer' }
  }
  if (obj.offline_total !== ctx.offlineQuestionCount) {
    return {
      ok: false,
      reason: `offline_total (${obj.offline_total}) must equal offline_question_count (${ctx.offlineQuestionCount})`
    }
  }

  // allowed_question_types：非空，每项合法（v1.2 含 SOFTWARE_TASK）
  const aqt = obj.allowed_question_types
  if (!Array.isArray(aqt) || aqt.length === 0) {
    return { ok: false, reason: 'allowed_question_types must be a non-empty array' }
  }
  for (const t of aqt) {
    if (typeof t !== 'string' || !(QUESTION_TYPES_V12 as readonly string[]).includes(t)) {
      return { ok: false, reason: `allowed_question_types has invalid type: ${JSON.stringify(t)}` }
    }
  }

  if (obj.unsupported_interaction_policy !== 'BLOCK') {
    return { ok: false, reason: 'unsupported_interaction_policy must be "BLOCK"' }
  }
  if (!(SENSORY_FILTER_MODES as readonly string[]).includes(obj.sensory_filter_mode as string)) {
    return {
      ok: false,
      reason: `sensory_filter_mode must be one of ${SENSORY_FILTER_MODES.join(' / ')}`
    }
  }
  if (!(FALLBACK_STRATEGIES as readonly string[]).includes(obj.fallback_strategy as string)) {
    return {
      ok: false,
      reason: `fallback_strategy must be one of ${FALLBACK_STRATEGIES.join(' / ')}`
    }
  }
  return { ok: true }
}
