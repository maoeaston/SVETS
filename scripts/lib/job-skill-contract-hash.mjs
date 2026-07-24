import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const excludedSemanticKeys = new Set([
  'activation_authority',
  'answer_key_review_note',
  'answer_key_reviewed_at',
  'answer_key_reviewed_by',
  'answer_key_status',
  'asset_id',
  'asset_ids',
  'assets',
  'candidate_record_hash',
  'file_hash',
  'generated_at',
  'local_path',
  'media_asset_id',
  'media_brief',
  'offline_setup',
  'offline_tool_brief',
  'prompt_text',
  'provenance',
  'qa_record_paths',
  'reference_asset_ids',
  'review',
  'review_result_refs',
  'runtime_path',
  'source',
  'source_path',
  'tool_asset_ids',
  'tool_asset_ids_json'
])

export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
  }
  return value
}

export function hashText(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

export function hashRecord(value) {
  return hashText(JSON.stringify(canonical(value)))
}

export function hashFile(path) {
  return hashText(readFileSync(path))
}

function stripDeliveryMetadata(value) {
  if (Array.isArray(value)) return value.map(stripDeliveryMetadata)
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !excludedSemanticKeys.has(key) && !key.endsWith('_asset_id') && !key.endsWith('_asset_ids'))
    .map(([key, child]) => [key, stripDeliveryMetadata(child)]))
}

export function semanticProjection(value) {
  return canonical(stripDeliveryMetadata(value))
}

export function semanticHash(value) {
  return hashRecord(semanticProjection(value))
}

export function effectiveAnswer(proposedQuestion) {
  const scoringAnswer = proposedQuestion?.scoring_rule?.correct_answer
  const contentAnswer = proposedQuestion?.content?.expected_answer
  if (scoringAnswer !== undefined && contentAnswer !== undefined && scoringAnswer !== contentAnswer) {
    throw new Error('scoring_rule.correct_answer conflicts with content.expected_answer')
  }
  return scoringAnswer ?? contentAnswer ?? null
}

export function questionSemanticProjection(proposedQuestion) {
  const content = proposedQuestion?.content ?? {}
  return canonical({
    question_type: content.question_type ?? null,
    prompt: content.prompt ?? null,
    options: content.options ?? null,
    drag_items: content.drag_items ?? null,
    drop_zones: content.drop_zones ?? null,
    effective_answer: effectiveAnswer(proposedQuestion),
    rubric_criteria: content.rubric_criteria ?? null,
    scoring_rule: proposedQuestion?.scoring_rule ?? null,
    safety_sensitive: proposedQuestion?.safety_sensitive ?? false,
    safety_stop_conditions: proposedQuestion?.safety_stop_conditions ?? null
  })
}

export function questionSemanticHash(proposedQuestion) {
  return hashRecord(questionSemanticProjection(proposedQuestion))
}

export const semanticHashContract = {
  algorithm: 'SHA-256(JSON.stringify(recursively-key-sorted semantic projection))',
  excludes: [...excludedSemanticKeys].sort(),
  suffix_excludes: ['*_asset_id', '*_asset_ids']
}

export const questionSemanticHashContract = {
  algorithm: 'SHA-256(JSON.stringify(recursively-key-sorted explicit question semantic projection))',
  includes: [
    'question_type',
    'prompt',
    'options',
    'drag_items',
    'drop_zones',
    'effective_answer',
    'rubric_criteria',
    'scoring_rule',
    'safety_sensitive',
    'safety_stop_conditions'
  ],
  delivery_fields_excluded_by_construction: true
}
