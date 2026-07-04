export type ScoringRuleValidationOk = { ok: true }
export type ScoringRuleValidationErr = { ok: false; reason: string }
export type ScoringRuleValidationResult = ScoringRuleValidationOk | ScoringRuleValidationErr

export type ScoringRuleQuestionType =
  | 'TRUE_FALSE'
  | 'SINGLE_CHOICE'
  | 'DRAG'
  | 'OFFLINE_OPERATION'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function validateScoringRuleJson(
  input: unknown,
  questionType: ScoringRuleQuestionType
): ScoringRuleValidationResult {
  if (!isRecord(input)) {
    return { ok: false, reason: 'scoring_rule_json must be an object' }
  }

  if (questionType === 'TRUE_FALSE' || questionType === 'SINGLE_CHOICE') {
    if (input.scoring_type !== 'EXACT_MATCH') {
      return { ok: false, reason: 'scoring_type must be EXACT_MATCH' }
    }
    if (input.max_score !== 2) {
      return { ok: false, reason: 'max_score must be 2 for EXACT_MATCH' }
    }
    if (input.correct_score !== 2) {
      return { ok: false, reason: 'correct_score must be 2 for EXACT_MATCH' }
    }
    if (input.incorrect_score !== 0) {
      return { ok: false, reason: 'incorrect_score must be 0 for EXACT_MATCH' }
    }
    return { ok: true }
  }

  if (questionType === 'DRAG') {
    if (input.scoring_type !== 'DRAG_PARTIAL') {
      return { ok: false, reason: 'scoring_type must be DRAG_PARTIAL' }
    }
    if (input.max_score !== 2) {
      return { ok: false, reason: 'max_score must be 2 for DRAG_PARTIAL' }
    }
    if (input.all_correct_score !== 2) {
      return { ok: false, reason: 'all_correct_score must be 2 for DRAG_PARTIAL' }
    }
    if (input.partial_correct_score !== 0) {
      return { ok: false, reason: 'partial_correct_score must be 0 for DRAG_PARTIAL' }
    }
    if (input.incorrect_score !== 0) {
      return { ok: false, reason: 'incorrect_score must be 0 for DRAG_PARTIAL' }
    }
    return { ok: true }
  }

  if (questionType === 'OFFLINE_OPERATION') {
    if (input.scoring_type !== 'OFFLINE_RUBRIC') {
      return { ok: false, reason: 'scoring_type must be OFFLINE_RUBRIC' }
    }
    if (input.max_score !== 2) {
      return { ok: false, reason: 'max_score must be 2 for OFFLINE_RUBRIC' }
    }
    if (!isRecord(input.score_labels)) {
      return { ok: false, reason: 'score_labels must be an object for OFFLINE_RUBRIC' }
    }
    for (const label of ['0', '1', '2']) {
      if (typeof input.score_labels[label] !== 'string' || input.score_labels[label].length === 0) {
        return { ok: false, reason: `score_labels.${label} must be a non-empty string` }
      }
    }
    if (!Array.isArray(input.criteria) || input.criteria.length === 0) {
      return { ok: false, reason: 'criteria must be a non-empty array for OFFLINE_RUBRIC' }
    }
    const criterionIds = new Set<string>()
    for (let i = 0; i < input.criteria.length; i++) {
      const criterion = input.criteria[i]
      if (!isRecord(criterion)) {
        return { ok: false, reason: `criteria[${i}] must be an object` }
      }
      if (typeof criterion.criterion_id !== 'string' || criterion.criterion_id.length === 0) {
        return { ok: false, reason: `criteria[${i}].criterion_id must be a non-empty string` }
      }
      if (criterionIds.has(criterion.criterion_id)) {
        return { ok: false, reason: `criteria[${i}].criterion_id must be unique` }
      }
      criterionIds.add(criterion.criterion_id)
    }
    return { ok: true }
  }

  return { ok: false, reason: `unsupported question_type: ${questionType}` }
}
