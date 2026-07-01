// sensory_profile_json 的运行时结构校验。
// 纯函数，不依赖 DB / Electron，可独立单测。
// 对应 doc/xc-career-guide-json-field-schema-v1.0.0.md §8。

const SENSITIVITY_LEVELS = ['LOW', 'MEDIUM', 'HIGH'] as const
const SENSITIVITY_KEYS = [
  'noise_sensitivity',
  'light_sensitivity',
  'tactile_sensitivity',
  'crowd_density_sensitivity'
] as const

export type SensoryValidationOk = { ok: true }
export type SensoryValidationErr = { ok: false; reason: string }
export type SensoryValidationResult = SensoryValidationOk | SensoryValidationErr

/**
 * 校验 sensory_profile_json 的结构。
 * - null / undefined：视为「未填写」，通过（DB 存 null）
 * - 对象：4 个敏感度字段可选，但若存在须为 LOW/MEDIUM/HIGH 或 null；
 *   avoid_tags 须为 string[] 或缺省；notes 须为 string 或缺省。
 */
export function validateSensoryProfile(input: unknown): SensoryValidationResult {
  if (input == null) return { ok: true }

  if (typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, reason: 'sensory_profile must be an object or null' }
  }

  const obj = input as Record<string, unknown>

  for (const key of SENSITIVITY_KEYS) {
    const v = obj[key]
    if (v != null && !(SENSITIVITY_LEVELS as readonly string[]).includes(v as string)) {
      return { ok: false, reason: `${key} must be one of LOW/MEDIUM/HIGH or null` }
    }
  }

  const avoidTags = obj.avoid_tags
  if (avoidTags != null) {
    if (!Array.isArray(avoidTags) || avoidTags.some((t) => typeof t !== 'string')) {
      return { ok: false, reason: 'avoid_tags must be an array of strings' }
    }
  }

  const notes = obj.notes
  if (notes != null && typeof notes !== 'string') {
    return { ok: false, reason: 'notes must be a string' }
  }

  return { ok: true }
}
