// 对应 doc/xc-career-guide-json-field-schema-v1.0.0.md
// 运行时校验由主进程负责；此文件仅提供类型声明。

export type AbilityTag =
  | 'FINE_MOTOR'
  | 'COGNITION'
  | 'RULE_EXECUTION'
  | 'EMOTION_REGULATION'
  | 'BASIC_SOCIAL'
  | 'SAFETY_OPERATION'

// ═══════════════════════════════════════════════════════
// v1.0.7 新增枚举
// ═══════════════════════════════════════════════════════

export type QuestionType =
  | 'TRUE_FALSE'
  | 'SINGLE_CHOICE'
  | 'DRAG'
  | 'SOFTWARE_TASK'
  | 'OFFLINE_OPERATION'

export type ItemUsage = 'SCORED_ITEM' | 'OBSERVATION_ONLY'

export type InteractionType =
  | 'BINARY_SELECT'
  | 'SINGLE_SELECT'
  | 'MULTI_SELECT'
  | 'DRAG_DROP'
  | 'ORDERING'
  | 'GESTURE_TASK'
  | 'TIMED_TASK'
  | 'TASK_SEQUENCE'
  | 'BRANCHING_TASK'
  | 'OFFLINE_RUBRIC'
  | 'SYSTEM_DERIVED_OBSERVATION'
  | 'TEACHER_OBSERVATION'

export type PresentationType =
  | 'TEXT_ONLY'
  | 'IMAGE_CARD'
  | 'AUDIO_PROMPT'
  | 'IMAGE_AUDIO'
  | 'VIDEO_SCENE'
  | 'INTERACTIVE_SCENE'
  | 'OFFLINE_MATERIAL'
  | 'SYSTEM_OBSERVATION'

export type ResponseStatus =
  | 'ANSWERED'
  | 'NOT_APPLICABLE'
  | 'STOPPED_SAFETY'
  | 'TECHNICAL_INTERRUPTION'
  | 'ASSISTED_NOT_SCORED'

export type PromptLevel = 'P0' | 'P1' | 'P2' | 'P3'

export type EvidenceType =
  | 'SOFTWARE_BEHAVIOR'
  | 'SITUATIONAL_JUDGMENT'
  | 'DIRECT_PERFORMANCE'
  | 'SELF_REPORT'
  | 'SELF_REPORT_PLUS_BEHAVIOR'
  | 'EMBEDDED_OBSERVATION'

// ═══════════════════════════════════════════════════════
// v1.0.8 新增枚举
// ═══════════════════════════════════════════════════════

export type BankDomain = 'BASE_ABILITY' | 'JOB_SPECIFIC'

export type JobModuleCode = 'M1' | 'M2' | 'M3' | 'M4' | 'M5' | 'M6'

export type AdministrationVariantType =
  | 'STANDARD'
  | 'INTERRUPTION'
  | 'DISTRACTION'
  | 'PLANTED_ERROR'
  | 'TIME_LIMITED'
  | 'VIGILANCE'
  | 'ROLE_PLAY'

export type VariantRole =
  | 'STORE_CONTEXT'
  | 'OFFICE_CONTEXT'
  | 'SCAFFOLDED'
  | 'UNSCAFFOLDED'
  | 'QUIET_VERSION'
  | 'DISTRACTION_VERSION'

export type OptionSemanticTag = 'UNSURE'

// ═══════════════════════════════════════════════════════
// v1.0.9 新增枚举
// ═══════════════════════════════════════════════════════

export type StrategyType =
  | 'BASELINE_ASSESSMENT'
  | 'MOCK_EXAM'
  | 'TRAINING_PRACTICE'
  | 'JOB_SKILL_ASSESSMENT'

export type ResultType =
  | 'ABILITY_SCORE'
  | 'TRAINING_COMPLETION'
  | 'OPERATION_PASS_RATE'
  | 'JOB_SKILL_SCORE'

export type QuestionPhase = 'ONLINE' | 'OFFLINE' | 'OBSERVATION'

export type AnswerKeyStatus =
  | 'NOT_REQUIRED'
  | 'PENDING'
  | 'VERIFIED'
  | 'CORRECTED'
  | 'REJECTED'

export type PostDisclosureStatus = 'NOT_REQUIRED' | 'PENDING' | 'COMPLETED'

export interface ContentSource {
  import_batch_id: string
  source_file: string
  source_sheet?: string
  source_row: number
  imported_at: string
  imported_by: string
  origin_refs?: string[]
  transformation?: string
  candidate_status?: string
  digitalization_level?: string
  legacy_job_code?: string
  legacy_question_id?: string
  source_ref_549?: string
}

// ═══════════════════════════════════════════════════════
// content_json 结构化块（+v1.0.7）
// ═══════════════════════════════════════════════════════

export type AssetRole =
  | 'SCENE_IMAGE'
  | 'PRIMARY_STIMULUS'
  | 'OPTION_IMAGE'
  | 'DRAG_ITEM_IMAGE'
  | 'DROP_ZONE_IMAGE'
  | 'BACKGROUND_IMAGE'
  | 'VOICE_PROMPT'
  | 'INSTRUCTION_AUDIO'
  | 'OFFLINE_TOOL_GUIDE'
  | 'REFERENCE_TEMPLATE'
  | 'SCENE_VIDEO'
  | 'ROLE_PLAY_SCRIPT'
  | 'SEALED_ADMIN_CONFIG'

export interface PresentationAsset {
  asset_key: string
  asset_id: string
  role: AssetRole
  required: boolean
  alt_text: string
  sort_order?: number
}

export interface ContentPresentation {
  presentation_type: PresentationType
  prompt: string
  standard_instruction: string
  instruction_repeat_limit?: number
  assets?: PresentationAsset[]
}

export interface ContentInteraction {
  interaction_type: InteractionType
  interaction_subtype?: string
  config: Record<string, unknown>
}

export interface ExpectedEvidence {
  primary_evidence_type: EvidenceType
  secondary_evidence_types?: EvidenceType[]
  observable_indicators: string[]
  validity_boundary: string
}

export interface SupportPolicy {
  allowed_prompt_levels: PromptLevel[]
  max_prompt_level_for_valid_score?: PromptLevel
  allowed_accommodations: string[]
  prohibited_support?: string[]
}

export interface TerminationPolicy {
  allow_pause_on_distress: boolean
  technical_failure_is_not_zero: boolean
  safety_stop_codes?: string[]
}

export interface ProfessionalReview {
  required: boolean
  review_type: string | null
  status: 'NOT_REQUIRED' | 'PENDING' | 'APPROVED' | 'REJECTED'
  reviewed_by: string | null
  reviewed_at: string | null
}

export interface AdministrationConfig {
  variant_type: AdministrationVariantType
  standard_instruction: string | null
  instruction_repeat_limit: number | null
  requires_two_examiners: boolean
  parameters: Record<string, number | string | boolean> | null
  observation_dimensions: string[]
  script_asset_id: string | null
  sealed_config_asset_id: string | null
}

export interface ContentJsonReview {
  answer_key_status: AnswerKeyStatus
  answer_key_reviewed_by: string | null
  answer_key_reviewed_at: string | null
  answer_key_review_note: string | null
}

// question_bank.content_json —— 按 question_type 分叉
export type ContentJson =
  | ContentJsonTrueFalse
  | ContentJsonSingleChoice
  | ContentJsonDrag
  | ContentJsonSoftwareTask
  | ContentJsonOfflineOperation

interface ContentJsonBase {
  schema_version?: 'question-content-v1.2'
  question_type?: QuestionType
  prompt: string
  assessment_point: string
  /** BASE_ABILITY 域至少 1 个；JOB_SPECIFIC 域允许空数组 */
  ability_tags: AbilityTag[]
  media_brief?: string
  note?: string
  source?: ContentSource
  sub_module?: string
  target_construct?: string
  presentation?: ContentPresentation
  interaction?: ContentInteraction
  expected_evidence?: ExpectedEvidence
  support_policy?: SupportPolicy
  termination_policy?: TerminationPolicy
  log_metrics?: string[]
  variant_group_id?: string | null
  variant_role?: VariantRole
  professional_review?: ProfessionalReview
  administration?: AdministrationConfig
  review?: ContentJsonReview
  variants?: ContentVariant[] | null
}

export interface ContentJsonTrueFalse extends ContentJsonBase {
  question_type: 'TRUE_FALSE'
  // expected_answer 已迁入 scoring_rule_json（v1.0.9 决策49）
  variants?: TrueFalseVariant[] | null
}

export interface ContentVariant {
  variant_id: string
  media_asset_id: string | null
  media_brief: string
}

export interface TrueFalseVariant extends ContentVariant {
  expected_answer: boolean
}

export interface ChoiceOption {
  key: string
  text: string
  image_asset_id?: string | null
  semantic_tag?: OptionSemanticTag
}

export interface ContentJsonSingleChoice extends ContentJsonBase {
  question_type: 'SINGLE_CHOICE'
  options: ChoiceOption[]
  // expected_answer 已迁入 scoring_rule_json（v1.0.9 决策49）
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
  // scoring_mode 废止（v1.0.7）— 判分逻辑由 scoring_rule_json 承载
}

export interface RubricCriterion {
  criterion_id: string
  description: string
}

export interface OfflineSetupReference {
  setup_id: string
  item_ids: string[]
  asset_ids: string[]
}

export interface ContentJsonOfflineOperation extends ContentJsonBase {
  question_type: 'OFFLINE_OPERATION'
  offline_tool_brief: string
  rubric_criteria: RubricCriterion[]
  offline_setup?: OfflineSetupReference
}

export interface ContentJsonSoftwareTask extends ContentJsonBase {
  question_type: 'SOFTWARE_TASK'
  options?: ChoiceOption[]
}

// question_bank.scoring_rule_json
export type ScoringRuleJson =
  | ScoringRuleExactMatch
  | ScoringRuleSetMatch
  | ScoringRuleMappingMatch
  | ScoringRuleOrderMatch
  | ScoringRuleMetricThreshold
  | ScoringRuleEventRule
  | ScoringRuleOffline
  | ScoringRuleNoScore

export interface ScoringRuleExactMatch {
  schema_version: 'scoring-rule-v1.1'
  scoring_type: 'EXACT_MATCH'
  scoring_mode: 'AUTOMATIC'
  expected_answer: boolean | string
  pass_score: 2
  fail_score: 0
  scoring_engine_version: string
}

/** @deprecated v1.0.8 废止，迁移为 ORDER_MATCH 或 MAPPING_MATCH */
export interface ScoringRuleDrag {
  scoring_type: 'DRAG_PARTIAL'
  max_score: 2
  all_correct_score: 2
  partial_correct_score: 0
  incorrect_score: 0
}

export interface ScoringRuleSetMatch {
  schema_version: 'scoring-rule-v1.1'
  scoring_type: 'SET_MATCH'
  scoring_mode: 'AUTOMATIC'
  criteria_logic: 'ALL' | 'ANY'
  expected_set: string[]
  pass_score: 2
  fail_score: 0
  scoring_engine_version: string
}

export interface ScoringRuleMappingMatch {
  schema_version: 'scoring-rule-v1.1'
  scoring_type: 'MAPPING_MATCH'
  scoring_mode: 'AUTOMATIC'
  expected_mapping: Array<{ item_id: string; zone_id: string }>
  pass_score: 2
  fail_score: 0
  scoring_engine_version: string
}

export interface ScoringRuleOrderMatch {
  schema_version: 'scoring-rule-v1.1'
  scoring_type: 'ORDER_MATCH'
  scoring_mode: 'AUTOMATIC'
  expected_order: string[]
  pass_score: 2
  fail_score: 0
  scoring_engine_version: string
}

export type CriterionOperator = 'EQ' | 'NE' | 'GT' | 'GTE' | 'LT' | 'LTE' | 'IN' | 'NOT_IN'

export interface ScoringCriterion {
  metric: string
  operator: CriterionOperator
  value: number | string | (number | string)[]
}

export interface ScoringRuleMetricThreshold {
  schema_version: 'scoring-rule-v1.1'
  scoring_type: 'METRIC_THRESHOLD'
  scoring_mode: 'AUTOMATIC'
  criteria_logic: 'ALL' | 'ANY'
  criteria: ScoringCriterion[]
  pass_score: 2
  fail_score: 0
  scoring_engine_version: string
}

export interface ScoringRuleEventRule {
  schema_version: 'scoring-rule-v1.1'
  scoring_type: 'EVENT_RULE'
  scoring_mode: 'AUTOMATIC'
  required_events: string[]
  required_order?: boolean
  required_final_state?: string
  pass_score: 2
  fail_score: 0
  scoring_engine_version: string
}

export interface ScoringRuleNoScore {
  schema_version: 'scoring-rule-v1.1'
  scoring_type: 'NO_SCORE'
  scoring_mode: 'NONE'
  scoring_engine_version: string
}

export interface OfflineCriterionRule {
  criterion_id: string
  description_0: string
  description_1: string
  description_2: string
}

export interface ScoringRuleOffline {
  schema_version: 'scoring-rule-v1.1'
  scoring_type: 'OFFLINE_RUBRIC'
  scoring_mode: 'TEACHER'
  max_score: 2
  criteria: OfflineCriterionRule[]
  score_labels: { '0': string; '1': string; '2': string }
  scoring_engine_version: string
}

// ═══════════════════════════════════════════════════════
// strategy_config.question_policy_json
// ═══════════════════════════════════════════════════════

/**
 * @deprecated v1.0.9 — 旧结构仅保留供 paper-generator.ts 向后兼容。
 * 新代码使用 QuestionPolicyBaseAbility | QuestionPolicyJobSkillFixedSet。
 */
export interface QuestionPolicyJson {
  module_scope: 'SINGLE_MODULE' | 'CROSS_MODULE'
  question_ratio: Partial<Record<'TRUE_FALSE' | 'SINGLE_CHOICE' | 'DRAG' | 'SOFTWARE_TASK' | 'OFFLINE_OPERATION', number>>
  required_modules?: AbilityTag[]
  difficulty_distribution?: Record<string, number>
  sensory_filter_mode?: 'SOFT' | 'STRICT'
  fallback_strategy?: 'LOW_STIMULI_FIRST' | 'SAME_TYPE_DIFFERENT_ASSET' | 'BLOCK'
}

/** 基础能力策略（v1.2）— 随机组卷 */
export interface QuestionPolicyBaseAbility {
  schema_version: 'question-policy-v1.2'
  module_scope: 'CROSS_MODULE'
  eligible_bank_domains: ['BASE_ABILITY']
  selection_mode?: undefined
  online_quota_by_module: Partial<Record<AbilityTag, number>>
  offline_total: number
  eligible_item_usage: ['SCORED_ITEM']
  allowed_question_types: QuestionType[]
  unsupported_interaction_policy: 'BLOCK'
  sensory_filter_mode: 'SOFT' | 'STRICT'
  fallback_strategy: 'BLOCK' | 'LOW_STIMULI_FIRST' | 'SAME_TYPE_DIFFERENT_ASSET'
}

export interface JobModuleQuota {
  online: number
  offline: number
}

/** 专业岗位策略（v1.2）— 固定示范卷 */
export interface QuestionPolicyJobSkillFixedSet {
  schema_version: 'question-policy-v1.2'
  bank_domain: 'JOB_SPECIFIC'
  selection_mode: 'FIXED_SET'
  job_module_quotas: Record<JobModuleCode, JobModuleQuota>
  fixed_scored_question_ids: string[]
  embedded_observation_question_ids: string[]
  fallback_strategy: 'BLOCK'
}

export interface LevelRule {
  min: number
  max: number
  level: 'LEVEL_COMPETENT' | 'LEVEL_CONDITIONAL' | 'LEVEL_NOT_COMPETENT'
}

// ═══════════════════════════════════════════════════════
// strategy_config.scoring_policy_json
// ═══════════════════════════════════════════════════════

/** 基础能力评分策略（v1.1） */
export interface ScoringPolicyBaseAbility {
  schema_version: 'scoring-policy-v1.1'
  online_score_values: [0, 2]
  offline_score_values: [0, 1, 2]
  normalization: 'raw_score/max_score*100'
  safety_override_enabled: boolean
  placement_advice_enabled: boolean
  pilot_mode?: boolean
  /** @deprecated v1.0.8 — 阈值由 strategy_config 表级字段承担，JSON 中保留向后兼容 */
  level_rules?: LevelRule[]
  /** @deprecated */
  score_values?: [0, 1, 2]
}

/** 专业岗位评分策略（v1.2） */
export interface ScoringPolicyJobSkill {
  schema_version: 'scoring-policy-v1.2'
  assessment_scope: 'JOB_SKILL'
  online_score_values: [0, 2]
  offline_score_values: [0, 1, 2]
  normalization: 'raw_score/max_score*100'
  module_veto_mode: 'DISABLED_RECORD_ONLY'
  training_focus_threshold: number
  safety_override_enabled: boolean
  placement_advice_enabled: false
}

export type ScoringPolicyJson = ScoringPolicyBaseAbility | ScoringPolicyJobSkill

// student_profile.sensory_profile_json
export interface SensoryProfileJson {
  noise_sensitivity?: 'LOW' | 'MEDIUM' | 'HIGH' | null
  light_sensitivity?: 'LOW' | 'MEDIUM' | 'HIGH' | null
  tactile_sensitivity?: 'LOW' | 'MEDIUM' | 'HIGH' | null
  crowd_density_sensitivity?: 'LOW' | 'MEDIUM' | 'HIGH' | null
  avoid_tags?: string[]
  notes?: string
}

// ═══════════════════════════════════════════════════════
// question_bank.sensory_tags_json / tool_asset_ids_json（无变更）
// ═══════════════════════════════════════════════════════

export interface SensoryTagsJson {
  noise_level?: 'LOW' | 'MEDIUM' | 'HIGH' | null
  light_intensity?: 'LOW' | 'MEDIUM' | 'HIGH' | null
  crowd_density?: 'LOW' | 'MEDIUM' | 'HIGH' | null
  tactile_sensitivity?: 'LOW' | 'MEDIUM' | 'HIGH' | null
  has_low_stimuli_variant: boolean
  avoid_tags?: string[]
}

export type ToolAssetIdsJson = string[]

// ═══════════════════════════════════════════════════════
// TeacherObservationPayload（+v1.0.9）
// ═══════════════════════════════════════════════════════

export interface TeacherObservationPayload {
  schema_version: 'teacher-observation-v1.0'
  observation_code: string
  observed: boolean
  behavior_codes: string[]
  prompt_level: PromptLevel | null
  accommodations_used: string[]
  observation_note: string | null
  post_disclosure_status?: PostDisclosureStatus
  recorded_by: string
  recorded_at: string
}

// ═══════════════════════════════════════════════════════
// result_record.result_payload_json
// ═══════════════════════════════════════════════════════

export interface ModuleScore {
  module_type: AbilityTag
  raw_score: number
  max_score: number
  normalized_score: number
}

export interface AbilityScorePayload {
  result_type: 'ABILITY_SCORE'
  module_scores?: ModuleScore[]
  online_raw_score: number
  offline_raw_score: number
  question_count: number
  answered_count: number
  completion_ratio?: number
  emotion_collapse_count: number
  module_veto_triggered_by?: AbilityTag | null
  level_forced_by?: 'MODULE_VETO' | 'EMOTION_COLLAPSE' | null
}

export interface JobModuleProfile {
  online_raw: number
  online_max: number
  offline_raw: number
  offline_max: number
  score_rate: number
  response_status_summary: Partial<Record<ResponseStatus, number>>
}

export interface TrainingFocusItem {
  job_module_code: JobModuleCode
  reason: string
  linked_task_code: string | null
  recommendation_text: string
}

export interface SupportSummary {
  prompt_level_distribution: Partial<Record<PromptLevel, number>>
  accommodations_used: string[]
  instruction_replay_count: number
}

export interface TeacherObservationSummary {
  question_id: string
  observation_code: string
  observed: boolean
  behavior_codes: string[]
}

export interface SafetyIncidentRef {
  incident_id: string
  reason_code: string
  occurred_at: string
}

export interface SafetySummary {
  safety_incidents: SafetyIncidentRef[]
  safety_overridden: boolean
}

export interface JobSkillResultPayload {
  result_schema_version: 'job-skill-result-v1.0'
  overall: {
    raw_score: number
    max_score: 48
    normalized_score: number
    completion_ratio: number
  }
  score_tracks: {
    online_knowledge: { raw_score: number; max_score: 36; normalized_score: number }
    offline_performance: { raw_score: number; max_score: 12; normalized_score: number }
  }
  job_module_profiles: Record<JobModuleCode, JobModuleProfile>
  observation_completion_ratio: number
  support_summary: SupportSummary
  teacher_observations: TeacherObservationSummary[]
  safety_summary: SafetySummary
  validity_limitations: string[]
  recommended_training_focus: TrainingFocusItem[]
}

export type ResultPayloadJson =
  | AbilityScorePayload
  | JobSkillResultPayload

// ═══════════════════════════════════════════════════════
// report_content_json
// ═══════════════════════════════════════════════════════

export interface ReportContentBaseAbility {
  report_schema_version: 'task-report-v1.1'
  report_scope?: 'BASE_ABILITY'
  report_type: 'FULL_REPORT' | 'SAFETY_TERMINATION_REPORT'
  generated_at: string
  [key: string]: unknown
}

export interface JobSkillAssessmentMeta {
  session_id: string
  strategy_id: string
  strategy_version: number
  scoring_engine_version: string
  content_schema_version: string
  scoring_schema_version: string
  report_schema_version: string
  job_code: string
  sitting_count: number
  completion_ratio: number
  observation_completion_ratio: number
}

export interface JobSkillOverallSummary {
  raw_score: number
  max_score: 48
  normalized_score: number
  level_result: string
  safety_overridden: boolean
  emotion_collapse_triggered: boolean
}

export interface JobModuleReportProfile {
  job_module_code: JobModuleCode
  module_name: string
  online_raw_score: number
  online_max_score: number
  offline_raw_score: number
  offline_max_score: number
  score_rate: number
  response_status_distribution: Partial<Record<ResponseStatus, number>>
  key_observations: string[]
}

export interface ReportSupportSummary {
  prompt_level_distribution: Partial<Record<PromptLevel, number>>
  accommodations_used: string[]
  instruction_replay_count: number
}

export interface TeacherObservationReport {
  question_id: string
  observation_code: string
  observed: boolean
  behavior_codes: string[]
  prompt_level: PromptLevel | null
  observation_note: string | null
}

export interface RecommendedTask {
  job_module_code: JobModuleCode
  task_code: string | null
  recommendation_text: string
  has_existing_training: boolean
}

export interface ReportContentJobSkill {
  report_schema_version: 'job-skill-report-v1.0'
  report_scope: 'JOB_SKILL'
  assessment_meta: JobSkillAssessmentMeta
  overall_summary: JobSkillOverallSummary
  job_module_profiles: JobModuleReportProfile[]
  support_summary: ReportSupportSummary
  teacher_observations: TeacherObservationReport[]
  safety_summary: SafetySummary
  validity_limitations: string[]
  recommended_training_focus: TrainingFocusItem[]
  recommended_training_tasks: RecommendedTask[]
  placement_advice: { enabled: false; reason_disabled: string }
}

export type ReportContentJson = ReportContentBaseAbility | ReportContentJobSkill

// ═══════════════════════════════════════════════════════
// answer_record.answer_payload_json
// ═══════════════════════════════════════════════════════

export interface ScoringSnapshot {
  scoring_engine_version: string
  passed: boolean | null
  score: 0 | 2 | null
  failed_criteria: string[]
}

export interface AnswerPayloadJson {
  schema_version: 'answer-payload-v1.1'
  session_question_id: string
  question_id: string
  question_type: QuestionType
  interaction_type: InteractionType
  interaction_subtype?: string
  response_status: ResponseStatus
  attempt_no: number
  revision_no?: number
  presented_at: string
  first_action_at: string | null
  submitted_at: string
  first_action_latency_ms: number | null
  total_duration_ms: number
  prompt_level: PromptLevel
  accommodations_used: string[]
  instruction_replay_count: number
  input_method?: string
  response: Record<string, unknown>
  metrics: Record<string, unknown>
  scoring_snapshot: ScoringSnapshot
}

// ═══════════════════════════════════════════════════════
// training_session.strategy_snapshot_json
// ═══════════════════════════════════════════════════════

export interface StrategySnapshotJson {
  strategy_id: string
  strategy_type: StrategyType
  job_code: string
  strategy_name: string
  version: number
  online_question_count: number
  offline_question_count: number
  max_score: number
  competent_threshold: number
  conditional_threshold: number
  module_veto_threshold: number
  emotion_collapse_threshold: number
  question_policy_json: QuestionPolicyJson
  scoring_policy_json: ScoringPolicyJson
  supports_redline_halt: boolean
  allows_emotion_interrupt: boolean
  requires_offline_scoring: boolean
  snapshot_taken_at: string
}

// ═══════════════════════════════════════════════════════
// error_event_log.context_json
// ═══════════════════════════════════════════════════════

export interface ErrorContextJson {
  session_id?: string
  student_id?: string
  question_id?: string
  asset_id?: string
  event_id?: string
  file_path?: string
  expected_hash?: string
  actual_hash?: string
  file_size_bytes?: number
  ipc_channel?: string
  timeout_ms?: number
  retry_count?: number
  extra?: Record<string, unknown>
}

// ═══════════════════════════════════════════════════════
// validateQuestionContract() 签名（实现在 T3）
// ═══════════════════════════════════════════════════════

export interface ValidateQuestionContractInput {
  questionRow: {
    question_id: string
    question_type: QuestionType
    bank_domain: BankDomain
    module_type: AbilityTag | null
    job_module_code: JobModuleCode | null
    item_usage: ItemUsage
    status: string
    safety_sensitive: boolean
    job_code: string
    difficulty_level: number
    media_asset_id: string | null
    tool_asset_ids_json?: string[] | null
  }
  contentJson: ContentJson
  scoringRuleJson: ScoringRuleJson
  assetRegistry: {
    exists(id: string): boolean
    isActive(id: string): boolean
    hashMatch(id: string): boolean
  }
  rendererRegistry: {
    isRegistered(type: InteractionType): boolean
    isEnabled(type: InteractionType): boolean
  }
  strategyType?: StrategyType
}

export interface ValidationError {
  code: string
  field: string
  message: string
}

export interface ValidationWarning {
  code: string
  field: string
  message: string
}

export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
  warnings: ValidationWarning[]
}

/** 实现在 src/main/domain/validators/question-validator.ts（T3） */
export type ValidateQuestionContractFn = (input: ValidateQuestionContractInput) => ValidationResult
