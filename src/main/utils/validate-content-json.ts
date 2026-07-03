import type { AbilityTag } from '../../shared/types/json-schemas'

const ABILITY_TAGS = [
  'FINE_MOTOR',
  'COGNITION',
  'RULE_EXECUTION',
  'EMOTION_REGULATION',
  'BASIC_SOCIAL',
  'SAFETY_OPERATION'
] as const satisfies readonly AbilityTag[]

const QUESTION_TYPES = ['TRUE_FALSE', 'SINGLE_CHOICE', 'DRAG', 'OFFLINE_OPERATION'] as const

export type ContentJsonValidationOk = { ok: true }
export type ContentJsonValidationErr = { ok: false; reason: string }
export type ContentJsonValidationResult = ContentJsonValidationOk | ContentJsonValidationErr
export interface ContentJsonValidationOptions {
  allowMissingBaseFields?: boolean
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function validateBaseFields(
  obj: Record<string, unknown>,
  opts: ContentJsonValidationOptions
): ContentJsonValidationResult {
  if (opts.allowMissingBaseFields) {
    if (obj.prompt != null && (typeof obj.prompt !== 'string' || obj.prompt.length === 0)) {
      return { ok: false, reason: 'prompt must be a non-empty string when provided' }
    }
    if (
      obj.assessment_point != null &&
      (typeof obj.assessment_point !== 'string' || obj.assessment_point.length === 0)
    ) {
      return { ok: false, reason: 'assessment_point must be a non-empty string when provided' }
    }
    if (obj.ability_tags != null) {
      if (!Array.isArray(obj.ability_tags) || obj.ability_tags.length === 0) {
        return { ok: false, reason: 'ability_tags must be a non-empty array when provided' }
      }
      if (
        !obj.ability_tags.every(
          (tag) => typeof tag === 'string' && (ABILITY_TAGS as readonly string[]).includes(tag)
        )
      ) {
        return { ok: false, reason: 'ability_tags contains invalid AbilityTag' }
      }
    }
  } else {
    if (typeof obj.prompt !== 'string' || obj.prompt.length === 0) {
      return { ok: false, reason: 'prompt must be a non-empty string' }
    }
    if (typeof obj.assessment_point !== 'string' || obj.assessment_point.length === 0) {
      return { ok: false, reason: 'assessment_point must be a non-empty string' }
    }
    if (!Array.isArray(obj.ability_tags) || obj.ability_tags.length === 0) {
      return { ok: false, reason: 'ability_tags must be a non-empty array' }
    }
    if (
      !obj.ability_tags.every(
        (tag) => typeof tag === 'string' && (ABILITY_TAGS as readonly string[]).includes(tag)
      )
    ) {
      return { ok: false, reason: 'ability_tags contains invalid AbilityTag' }
    }
  }
  if (obj.media_brief != null && typeof obj.media_brief !== 'string') {
    return { ok: false, reason: 'media_brief must be a string when provided' }
  }
  if (obj.note != null && typeof obj.note !== 'string') {
    return { ok: false, reason: 'note must be a string when provided' }
  }
  return { ok: true }
}

function validateTrueFalseVariants(variants: unknown): ContentJsonValidationResult {
  if (variants == null) return { ok: true }
  if (!Array.isArray(variants)) {
    return { ok: false, reason: 'variants must be an array or null' }
  }

  for (let i = 0; i < variants.length; i++) {
    const item = variants[i]
    if (!isRecord(item)) {
      return { ok: false, reason: `variants[${i}] must be an object` }
    }
    if (typeof item.variant_id !== 'string' || item.variant_id.length === 0) {
      return { ok: false, reason: `variants[${i}].variant_id must be a non-empty string` }
    }
    if (item.media_asset_id !== null && typeof item.media_asset_id !== 'string') {
      return { ok: false, reason: `variants[${i}].media_asset_id must be string or null` }
    }
    if (typeof item.media_brief !== 'string' || item.media_brief.length === 0) {
      return { ok: false, reason: `variants[${i}].media_brief must be a non-empty string` }
    }
    if (typeof item.expected_answer !== 'boolean') {
      return { ok: false, reason: `variants[${i}].expected_answer must be boolean` }
    }
  }
  return { ok: true }
}

export function validateContentJson(
  input: unknown,
  opts: ContentJsonValidationOptions = {}
): ContentJsonValidationResult {
  if (!isRecord(input)) {
    return { ok: false, reason: 'content_json must be an object' }
  }

  const base = validateBaseFields(input, opts)
  if (!base.ok) return base

  if (
    typeof input.question_type !== 'string' ||
    !(QUESTION_TYPES as readonly string[]).includes(input.question_type)
  ) {
    return { ok: false, reason: 'question_type must be a valid enum value' }
  }

  if (input.question_type === 'TRUE_FALSE') {
    if (typeof input.expected_answer !== 'boolean') {
      return { ok: false, reason: 'expected_answer must be boolean for TRUE_FALSE' }
    }
    return validateTrueFalseVariants(input.variants)
  }

  if (input.question_type === 'SINGLE_CHOICE') {
    if (!Array.isArray(input.options) || input.options.length < 2) {
      return { ok: false, reason: 'options must be an array with at least 2 items' }
    }
    if (typeof input.expected_answer !== 'string' || input.expected_answer.length === 0) {
      return { ok: false, reason: 'expected_answer must be a non-empty string for SINGLE_CHOICE' }
    }
    return { ok: true }
  }

  if (input.question_type === 'DRAG') {
    if (!Array.isArray(input.drag_items) || !Array.isArray(input.drop_zones)) {
      return { ok: false, reason: 'drag_items and drop_zones must be arrays for DRAG' }
    }
    if (input.scoring_mode !== 'ALL_OR_NOTHING' && input.scoring_mode !== 'PARTIAL_CREDIT') {
      return { ok: false, reason: 'scoring_mode must be ALL_OR_NOTHING or PARTIAL_CREDIT' }
    }
    return { ok: true }
  }

  if (typeof input.offline_tool_brief !== 'string' || !Array.isArray(input.rubric_criteria)) {
    return { ok: false, reason: 'offline_tool_brief and rubric_criteria are required for OFFLINE_OPERATION' }
  }
  return { ok: true }
}
