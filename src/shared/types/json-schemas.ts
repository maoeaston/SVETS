// 对应 doc/xc-career-guide-json-field-schema-v1.0.0.md
// 运行时校验由主进程负责；此文件仅提供类型声明。

export type AbilityTag =
  | 'FINE_MOTOR'
  | 'COGNITION'
  | 'RULE_EXECUTION'
  | 'EMOTION_REGULATION'
  | 'BASIC_SOCIAL'
  | 'SAFETY_OPERATION'

export interface ContentSource {
  import_batch_id: string
  source_file: string
  source_row: number
  imported_at: string
  imported_by: string
}

// question_bank.content_json —— 按 question_type 分叉
export type ContentJson =
  | ContentJsonTrueFalse
  | ContentJsonSingleChoice
  | ContentJsonDrag
  | ContentJsonOfflineOperation

interface ContentJsonBase {
  prompt: string
  assessment_point: string
  ability_tags: AbilityTag[]
  media_brief?: string
  note?: string
  source?: ContentSource
}

export interface ContentJsonTrueFalse extends ContentJsonBase {
  question_type: 'TRUE_FALSE'
  expected_answer: boolean
}

export interface ChoiceOption {
  key: string
  text: string
  image_asset_id?: string | null
}

export interface ContentJsonSingleChoice extends ContentJsonBase {
  question_type: 'SINGLE_CHOICE'
  options: ChoiceOption[]
  expected_answer: string
}

export interface DragItem {
  item_id: string
  label: string
  image_asset_id?: string | null
}

export interface DropZone {
  zone_id: string
  label: string
  accepts: string[]
}

export interface ContentJsonDrag extends ContentJsonBase {
  question_type: 'DRAG'
  drag_items: DragItem[]
  drop_zones: DropZone[]
  scoring_mode: 'ALL_OR_NOTHING' | 'PARTIAL_CREDIT'
}

export interface RubricCriterion {
  criterion_id: string
  description: string
}

export interface ContentJsonOfflineOperation extends ContentJsonBase {
  question_type: 'OFFLINE_OPERATION'
  offline_tool_brief: string
  rubric_criteria: RubricCriterion[]
}

// question_bank.scoring_rule_json
export type ScoringRuleJson =
  | ScoringRuleExactMatch
  | ScoringRuleDrag
  | ScoringRuleOffline

export interface ScoringRuleExactMatch {
  scoring_type: 'EXACT_MATCH'
  max_score: 2
  correct_score: 2
  incorrect_score: 0
}

export interface ScoringRuleDrag {
  scoring_type: 'DRAG_PARTIAL'
  max_score: 2
  all_correct_score: 2
  partial_correct_score: 1 | 0
  incorrect_score: 0
}

export interface OfflineCriterionRule {
  criterion_id: string
  description_0: string
  description_1: string
  description_2: string
}

export interface ScoringRuleOffline {
  scoring_type: 'OFFLINE_RUBRIC'
  max_score: 2
  criteria: OfflineCriterionRule[]
  score_labels: { '0': string; '1': string; '2': string }
}

// strategy_config.question_policy_json
export interface QuestionPolicyJson {
  module_scope: 'SINGLE_MODULE' | 'CROSS_MODULE'
  question_ratio: Partial<Record<'TRUE_FALSE' | 'SINGLE_CHOICE' | 'DRAG' | 'OFFLINE_OPERATION', number>>
  required_modules?: AbilityTag[]
  difficulty_distribution?: Record<string, number>
  sensory_filter_mode?: 'SOFT' | 'STRICT'
  fallback_strategy?: 'LOW_STIMULI_FIRST' | 'SAME_TYPE_DIFFERENT_ASSET' | 'BLOCK'
}

export interface LevelRule {
  min: number
  max: number
  level: 'LEVEL_PASS' | 'LEVEL_IMPROVE' | 'LEVEL_FAIL'
}

// strategy_config.scoring_policy_json
export interface ScoringPolicyJson {
  score_values: [0, 1, 2]
  normalization: 'raw_score/max_score*100'
  pass_threshold: number
  improve_threshold: number
  safety_override_enabled: boolean
  level_rules: LevelRule[]
}

// student_profile.sensory_profile_json
export interface SensoryProfileJson {
  noise_sensitivity?: 'LOW' | 'MEDIUM' | 'HIGH' | null
  light_sensitivity?: 'LOW' | 'MEDIUM' | 'HIGH' | null
  tactile_sensitivity?: 'LOW' | 'MEDIUM' | 'HIGH' | null
  crowd_density_sensitivity?: 'LOW' | 'MEDIUM' | 'HIGH' | null
  avoid_tags?: string[]
  notes?: string
}
