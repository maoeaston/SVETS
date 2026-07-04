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

function validateSource(source: unknown): ContentJsonValidationResult {
  if (source == null) return { ok: true }
  if (!isRecord(source)) {
    return { ok: false, reason: 'source must be an object when provided' }
  }
  for (const key of ['import_batch_id', 'source_file', 'imported_at', 'imported_by']) {
    if (typeof source[key] !== 'string' || source[key].length === 0) {
      return { ok: false, reason: `source.${key} must be a non-empty string` }
    }
  }
  if (
    typeof source.source_row !== 'number' ||
    !Number.isInteger(source.source_row) ||
    source.source_row <= 0
  ) {
    return { ok: false, reason: 'source.source_row must be a positive integer' }
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

  const source = validateSource(input.source)
  if (!source.ok) return source

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
    const optionKeys = new Set<string>()
    for (let i = 0; i < input.options.length; i++) {
      const option = input.options[i]
      if (!isRecord(option)) {
        return { ok: false, reason: `options[${i}] must be an object` }
      }
      if (typeof option.key !== 'string' || option.key.length === 0) {
        return { ok: false, reason: `options[${i}].key must be a non-empty string` }
      }
      if (optionKeys.has(option.key)) {
        return { ok: false, reason: `options[${i}].key must be unique` }
      }
      optionKeys.add(option.key)
    }
    if (!optionKeys.has(input.expected_answer)) {
      return { ok: false, reason: 'expected_answer must match one of options[].key for SINGLE_CHOICE' }
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
    const itemIds = new Set<string>()
    for (let i = 0; i < input.drag_items.length; i++) {
      const item = input.drag_items[i]
      if (!isRecord(item)) {
        return { ok: false, reason: `drag_items[${i}] must be an object` }
      }
      if (typeof item.item_id !== 'string' || item.item_id.length === 0) {
        return { ok: false, reason: `drag_items[${i}].item_id must be a non-empty string` }
      }
      if (itemIds.has(item.item_id)) {
        return { ok: false, reason: `drag_items[${i}].item_id must be unique` }
      }
      itemIds.add(item.item_id)
    }
    for (let i = 0; i < input.drop_zones.length; i++) {
      const zone = input.drop_zones[i]
      if (!isRecord(zone)) {
        return { ok: false, reason: `drop_zones[${i}] must be an object` }
      }
      if (!Array.isArray(zone.accepts) || zone.accepts.length === 0) {
        return { ok: false, reason: `drop_zones[${i}].accepts must be a non-empty array` }
      }
      for (let j = 0; j < zone.accepts.length; j++) {
        const acceptedItemId = zone.accepts[j]
        if (typeof acceptedItemId !== 'string' || !itemIds.has(acceptedItemId)) {
          return { ok: false, reason: `drop_zones[${i}].accepts[${j}] must reference drag_items[].item_id` }
        }
      }
    }
    return { ok: true }
  }

  if (typeof input.offline_tool_brief !== 'string' || !Array.isArray(input.rubric_criteria)) {
    return { ok: false, reason: 'offline_tool_brief and rubric_criteria are required for OFFLINE_OPERATION' }
  }
  if (input.rubric_criteria.length === 0) {
    return { ok: false, reason: 'rubric_criteria must be a non-empty array for OFFLINE_OPERATION' }
  }
  const criterionIds = new Set<string>()
  for (let i = 0; i < input.rubric_criteria.length; i++) {
    const criterion = input.rubric_criteria[i]
    if (!isRecord(criterion)) {
      return { ok: false, reason: `rubric_criteria[${i}] must be an object` }
    }
    if (typeof criterion.criterion_id !== 'string' || criterion.criterion_id.length === 0) {
      return { ok: false, reason: `rubric_criteria[${i}].criterion_id must be a non-empty string` }
    }
    if (criterionIds.has(criterion.criterion_id)) {
      return { ok: false, reason: `rubric_criteria[${i}].criterion_id must be unique` }
    }
    criterionIds.add(criterion.criterion_id)
  }
  return { ok: true }
}
