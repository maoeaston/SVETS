# 02 — JSON 数据合同与类型定义

版本：实现文档 v1.0  
目标 schema：v0.1.12-job-skill-assessment-mvp-closure  
目标类型基线：json-schemas.ts question-content-v1.2 / scoring-rule-v1.1 / scoring-policy-v1.2  
最后更新：2026-07-07

---

## 0. 现状 → 目标差异总览

| # | 现状 (json-schemas.ts 165行) | 目标变更 |
|---|---|---|
| 1 | `ContentJson` 仅四分支 | +`ContentJsonSoftwareTask` +观察项分支；删除 `expected_answer`（迁入 scoring_rule_json） |
| 2 | `ability_tags: AbilityTag[]` 隐含必填 | BASE_ABILITY ≥1；JOB_SPECIFIC 允许 `[]`；拦截 `"0"`/`"1"` |
| 3 | `ScoringRuleDrag.scoring_type: 'DRAG_PARTIAL'` | 删除；+ORDER_MATCH/MAPPING_MATCH/SET_MATCH/METRIC_THRESHOLD/EVENT_RULE/NO_SCORE |
| 4 | `ScoringPolicyJson.level_rules` | 废止（阈值由表字段承担）；替换为 v1.1（BASE）与 v1.2（JOB_SKILL） |
| 5 | `QuestionPolicyJson.question_ratio` 14/14/14/8 | 废止；替换为 v1.1 online_quota_by_module / v1.2 FIXED_SET 联合类型 |
| 6 | 无新增枚举 | +23 个新枚举/接口（见 §1） |
| 7 | `ContentSource` 五字段 | 扩展至 13 字段 |
| 8 | 无运行时 validator 导出 | 新增 `validateQuestionContract()` |

---

## 1. 枚举类型（schema_version: 1.0.0 → 1.2.0）

以下枚举为全系统唯一事实源，所有 JSON 校验、事件 payload 和 UI 必须引用。

```typescript
// ═══════════════════════════════════════════════════════
// 基础枚举（v1.0.0 已有，保持不变）
// ═══════════════════════════════════════════════════════

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
  | 'SOFTWARE_TASK'        // +v1.0.7
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
  | 'TEACHER_OBSERVATION'    // +v1.0.8

export type PresentationType =
  | 'TEXT_ONLY'
  | 'IMAGE_CARD'
  | 'AUDIO_PROMPT'
  | 'IMAGE_AUDIO'
  | 'VIDEO_SCENE'            // +v1.0.8
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
  | 'JOB_SKILL_ASSESSMENT'   // +v1.0.9

export type ResultType =
  | 'ABILITY_SCORE'
  | 'TRAINING_COMPLETION'
  | 'OPERATION_PASS_RATE'
  | 'JOB_SKILL_SCORE'        // +v1.0.9

export type QuestionPhase = 'ONLINE' | 'OFFLINE' | 'OBSERVATION'  // +OBSERVATION v1.0.9

export type AnswerKeyStatus =
  | 'NOT_REQUIRED'
  | 'PENDING'
  | 'VERIFIED'
  | 'CORRECTED'
  | 'REJECTED'

export type PostDisclosureStatus = 'NOT_REQUIRED' | 'PENDING' | 'COMPLETED'
```

---

## 2. content_json 类型定义（schema_version: question-content-v1.2）

### 2.1 ContentSource（扩展）

```diff
 export interface ContentSource {
   import_batch_id: string
   source_file: string
+  source_sheet?: string              // +v1.0.7：工作表名
   source_row: number
   imported_at: string
   imported_by: string
+  origin_refs?: string[]             // +v1.0.7：原始题号引用
+  transformation?: string            // +v1.0.7：调整方式（如 VIDEO_TO_IMAGE_CARD）
+  candidate_status?: string          // +v1.0.7：候选状态
+  digitalization_level?: string      // +v1.0.7：数字化等级
+  legacy_job_code?: string           // +v1.0.8：旧 job_code 原值
+  legacy_question_id?: string        // +v1.0.8：旧题目 ID
+  source_ref_549?: string            // +v1.0.8：549 池原题号追溯
 }
```

完整定义：

```typescript
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
```

### 2.2 Presentation 块（+v1.0.7）

```typescript
export interface PresentationAsset {
  asset_key: string                    // 题内稳定键
  asset_id: string                     // → asset_resource.asset_id
  role: AssetRole
  required: boolean
  alt_text: string
  sort_order?: number
}

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
  | 'SCENE_VIDEO'              // +v1.0.8
  | 'ROLE_PLAY_SCRIPT'         // +v1.0.8
  | 'SEALED_ADMIN_CONFIG'      // +v1.0.8
export interface ContentPresentation {
  presentation_type: PresentationType
  prompt: string
  standard_instruction: string
  instruction_repeat_limit?: number
  assets?: PresentationAsset[]
}
```

### 2.3 Interaction 块（+v1.0.7）

```typescript
export interface ContentInteraction {
  interaction_type: InteractionType
  interaction_subtype?: string         // GESTURE/BRANCHING/TIMED subtype
  config: Record<string, unknown>      // 交互配置（prefilled_placements 等）
}
```

### 2.4 Expected Evidence 块（+v1.0.7）

```typescript
export interface ExpectedEvidence {
  primary_evidence_type: EvidenceType
  secondary_evidence_types?: EvidenceType[]
  observable_indicators: string[]
  validity_boundary: string
}
```

### 2.5 Support Policy 块（+v1.0.7）

```typescript
export interface SupportPolicy {
  allowed_prompt_levels: PromptLevel[]
  max_prompt_level_for_valid_score?: PromptLevel
  allowed_accommodations: string[]
  prohibited_support?: string[]
}
```

### 2.6 Termination Policy 块（+v1.0.7）

```typescript
export interface TerminationPolicy {
  allow_pause_on_distress: boolean
  technical_failure_is_not_zero: boolean
  safety_stop_codes?: string[]
}
```

### 2.7 Professional Review 块（+v1.0.7）

```typescript
export interface ProfessionalReview {
  required: boolean
  review_type: string | null
  status: 'NOT_REQUIRED' | 'PENDING' | 'APPROVED' | 'REJECTED'
  reviewed_by: string | null
  reviewed_at: string | null
}
```

### 2.8 Administration 块（+v1.0.8）

```typescript
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
```

### 2.9 Answer Key Review 块（+v1.0.9）

```typescript
export interface ContentJsonReview {
  answer_key_status: AnswerKeyStatus
  answer_key_reviewed_by: string | null
  answer_key_reviewed_at: string | null
  answer_key_review_note: string | null
}
```

### 2.10 ChoiceOption 扩展（+v1.0.8 semantic_tag）

```diff
 export interface ChoiceOption {
   key: string
   text: string
   image_asset_id?: string | null
+  semantic_tag?: OptionSemanticTag    // +v1.0.8：'UNSURE' 等语义标记
 }
```

### 2.11 ContentJsonBase（v1.2 完整结构）

```diff
 interface ContentJsonBase {
+  schema_version: 'question-content-v1.2'   // 必填
+  question_type: QuestionType                // 必填（须与表字段一致）
   prompt: string
   assessment_point: string
   ability_tags: AbilityTag[]
   media_brief?: string
   note?: string
   source?: ContentSource
-  variants?: ContentVariant[] | null
+  // v1.2 结构化块
+  sub_module?: string
+  target_construct?: string                  // 题目直接测量构念
+  presentation: ContentPresentation          // 必填
+  interaction: ContentInteraction            // 必填
+  expected_evidence: ExpectedEvidence        // 必填
+  support_policy: SupportPolicy              // 必填
+  termination_policy: TerminationPolicy      // 必填
+  log_metrics?: string[]                     // SOFTWARE_TASK 条件必填
+  variant_group_id?: string | null
+  variant_role?: VariantRole                 // +v1.0.8
+  professional_review?: ProfessionalReview
+  administration?: AdministrationConfig      // +v1.0.8（缺省=STANDARD）
+  review?: ContentJsonReview                 // +v1.0.9
 }
```
### 2.12 各 question_type 的 content_json 完整字段表

#### TRUE_FALSE

```typescript
export interface ContentJsonTrueFalse extends ContentJsonBase {
  question_type: 'TRUE_FALSE'
  // v1.2: expected_answer 已迁入 scoring_rule_json（决策 49）
  // 保留 variants 结构供蓝本题使用
  variants?: TrueFalseVariant[] | null
}
```

**[!] 重大变更**：`expected_answer` 从 content_json 删除。正确答案唯一事实源为 `scoring_rule_json`。现有 json-schemas.ts 中 `ContentJsonTrueFalse.expected_answer: boolean` 和 `ContentJsonSingleChoice.expected_answer: string` 须移除。

#### SINGLE_CHOICE

```typescript
export interface ContentJsonSingleChoice extends ContentJsonBase {
  question_type: 'SINGLE_CHOICE'
  options: ChoiceOption[]              // 2-4 个选项
  // expected_answer 已迁入 scoring_rule_json
}
```

#### DRAG

```typescript
export interface ContentJsonDrag extends ContentJsonBase {
  question_type: 'DRAG'
  drag_items: DragItem[]
  drop_zones: DropZone[]
  // scoring_mode 废止（由 scoring_rule_json 判定方式覆盖）
}
```

**[!] 变更**：`scoring_mode: 'ALL_OR_NOTHING' | 'PARTIAL_CREDIT'` 从 content_json 删除。判分逻辑统一由 scoring_rule_json 承载。

#### SOFTWARE_TASK（+v1.0.7）

```typescript
export interface ContentJsonSoftwareTask extends ContentJsonBase {
  question_type: 'SOFTWARE_TASK'
  // interaction.interaction_type 决定具体控件：
  //   MULTI_SELECT / GESTURE_TASK / TIMED_TASK / TASK_SEQUENCE / BRANCHING_TASK
  // interaction.config 承载交互专属配置
  options?: ChoiceOption[]             // MULTI_SELECT 时使用
}
```

#### OFFLINE_OPERATION

```typescript
export interface ContentJsonOfflineOperation extends ContentJsonBase {
  question_type: 'OFFLINE_OPERATION'
  offline_tool_brief: string
  rubric_criteria: RubricCriterion[]
}
```

#### OBSERVATION_ONLY（虚拟分支，不作为独立 question_type）

观察项的 `question_type` 仍为 `OFFLINE_OPERATION`（DB 级），但：
- `item_usage = 'OBSERVATION_ONLY'`
- `interaction_type = 'TEACHER_OBSERVATION' | 'SYSTEM_DERIVED_OBSERVATION'`
- `scoring_type = 'NO_SCORE'`

### 2.13 ContentJson 联合类型（目标）

```typescript
export type ContentJson =
  | ContentJsonTrueFalse
  | ContentJsonSingleChoice
  | ContentJsonDrag
  | ContentJsonSoftwareTask       // +v1.0.7
  | ContentJsonOfflineOperation
```

---

## 3. scoring_rule_json 类型定义（schema_version: scoring-rule-v1.1）

### 3.1 各 question_type 的 scoring_rule_json 完整字段表

#### EXACT_MATCH（TRUE_FALSE / SINGLE_CHOICE）

```typescript
export interface ScoringRuleExactMatch {
  schema_version: 'scoring-rule-v1.1'
  scoring_type: 'EXACT_MATCH'
  scoring_mode: 'AUTOMATIC'
  expected_answer: boolean | string    // TRUE_FALSE→boolean; SINGLE_CHOICE→option key
  pass_score: 2
  fail_score: 0
  scoring_engine_version: string
}
```

**[!] 变更**：正确答案从 content_json 迁入此处。`max_score / correct_score / incorrect_score` 重构为 `pass_score / fail_score`。

#### SET_MATCH（MULTI_SELECT，+v1.0.7）

```typescript
export interface ScoringRuleSetMatch {
  schema_version: 'scoring-rule-v1.1'
  scoring_type: 'SET_MATCH'
  scoring_mode: 'AUTOMATIC'
  criteria_logic: 'ALL' | 'ANY'
  expected_set: string[]               // 正确选项 ID 集合
  pass_score: 2
  fail_score: 0
  scoring_engine_version: string
}
```
#### MAPPING_MATCH（DRAG_DROP 分类，+v1.0.7，替代旧 DRAG_PARTIAL）

```typescript
export interface ScoringRuleMappingMatch {
  schema_version: 'scoring-rule-v1.1'
  scoring_type: 'MAPPING_MATCH'
  scoring_mode: 'AUTOMATIC'
  expected_mapping: Array<{ item_id: string; zone_id: string }>
  pass_score: 2
  fail_score: 0
  scoring_engine_version: string
}
```

#### ORDER_MATCH（ORDERING 排序，+v1.0.7，替代旧 DRAG_PARTIAL）

```typescript
export interface ScoringRuleOrderMatch {
  schema_version: 'scoring-rule-v1.1'
  scoring_type: 'ORDER_MATCH'
  scoring_mode: 'AUTOMATIC'
  expected_order: string[]             // 正确顺序的 item_id 数组
  pass_score: 2
  fail_score: 0
  scoring_engine_version: string
}
```

#### METRIC_THRESHOLD（GESTURE/TIMED/BRANCHING 指标阈值，+v1.0.7）

```typescript
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
```

#### EVENT_RULE（TASK_SEQUENCE/BRANCHING 必要步骤，+v1.0.7）

```typescript
export interface ScoringRuleEventRule {
  schema_version: 'scoring-rule-v1.1'
  scoring_type: 'EVENT_RULE'
  scoring_mode: 'AUTOMATIC'
  required_events: string[]            // 必须触发的事件/节点 ID
  required_order?: boolean             // 是否要求顺序
  required_final_state?: string        // 终态要求
  pass_score: 2
  fail_score: 0
  scoring_engine_version: string
}
```

#### OFFLINE_RUBRIC（线下教师评分，保留结构，+三档锚点必填）

```typescript
export interface OfflineCriterionRule {
  criterion_id: string
  description_0: string                // 0 分行为锚点（禁止通用模板）
  description_1: string                // 1 分行为锚点
  description_2: string                // 2 分行为锚点
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
```

**[!] v1.0.8 强制**：validator 必须拒绝 `description_0/1/2` 使用通用模板（"未完成"/"部分完成"/"完全达标"及语义等价变体）。

#### NO_SCORE（OBSERVATION_ONLY，+v1.0.7）

```typescript
export interface ScoringRuleNoScore {
  schema_version: 'scoring-rule-v1.1'
  scoring_type: 'NO_SCORE'
  scoring_mode: 'NONE'
  scoring_engine_version: string
}
```

### 3.2 ScoringRuleJson 联合类型（目标）

```typescript
export type ScoringRuleJson =
  | ScoringRuleExactMatch
  | ScoringRuleSetMatch          // +v1.0.7
  | ScoringRuleMappingMatch      // +v1.0.7（替代 DRAG_PARTIAL）
  | ScoringRuleOrderMatch        // +v1.0.7（替代 DRAG_PARTIAL）
  | ScoringRuleMetricThreshold   // +v1.0.7
  | ScoringRuleEventRule         // +v1.0.7
  | ScoringRuleOffline
  | ScoringRuleNoScore           // +v1.0.7
```

**已删除**：
- `ScoringRuleDrag`（`scoring_type: 'DRAG_PARTIAL'`）— v1.0.8 废止
- `RUBRIC_BASED` — v1.0.8 废止，迁移为 `OFFLINE_RUBRIC`

### 3.3 scoring_type 与 question_type/interaction_type 对应关系

| question_type | interaction_type | 合法 scoring_type |
|---|---|---|
| TRUE_FALSE | BINARY_SELECT | EXACT_MATCH |
| SINGLE_CHOICE | SINGLE_SELECT | EXACT_MATCH |
| DRAG | DRAG_DROP | MAPPING_MATCH |
| DRAG | ORDERING | ORDER_MATCH |
| SOFTWARE_TASK | MULTI_SELECT | SET_MATCH |
| SOFTWARE_TASK | GESTURE_TASK | METRIC_THRESHOLD |
| SOFTWARE_TASK | TIMED_TASK | METRIC_THRESHOLD / EVENT_RULE |
| SOFTWARE_TASK | TASK_SEQUENCE | EVENT_RULE / METRIC_THRESHOLD |
| SOFTWARE_TASK | BRANCHING_TASK | EVENT_RULE / METRIC_THRESHOLD |
| OFFLINE_OPERATION | OFFLINE_RUBRIC | OFFLINE_RUBRIC |
| (any) | TEACHER_OBSERVATION | NO_SCORE |
| (any) | SYSTEM_DERIVED_OBSERVATION | NO_SCORE |

---
## 4. question_policy_json（schema_version: question-policy-v1.2）

### 4.1 基础能力策略（selection_mode 缺省/随机，v1.0.8）

```typescript
export interface QuestionPolicyBaseAbility {
  schema_version: 'question-policy-v1.2'
  module_scope: 'CROSS_MODULE'
  eligible_bank_domains: ['BASE_ABILITY']     // +v1.0.8
  selection_mode?: undefined                  // 缺省为随机组卷
  online_quota_by_module: Record<AbilityTag, number>  // 每模块 7
  offline_total: number                       // 8
  eligible_item_usage: ['SCORED_ITEM']
  allowed_question_types: QuestionType[]
  unsupported_interaction_policy: 'BLOCK'
  sensory_filter_mode: 'SOFT' | 'STRICT'
  fallback_strategy: 'BLOCK' | 'LOW_STIMULI_FIRST' | 'SAME_TYPE_DIFFERENT_ASSET'
}
```

```diff
- // v1.0.0 旧结构（已废止）
- export interface QuestionPolicyJson {
-   module_scope: 'SINGLE_MODULE' | 'CROSS_MODULE'
-   question_ratio: { TRUE_FALSE?: number; SINGLE_CHOICE?: number; DRAG?: number; OFFLINE_OPERATION?: number }
-   required_modules?: AbilityTag[]
-   difficulty_distribution?: Record<string, number>
-   sensory_filter_mode?: 'SOFT' | 'STRICT'
-   fallback_strategy?: 'LOW_STIMULI_FIRST' | 'SAME_TYPE_DIFFERENT_ASSET' | 'BLOCK'
- }
```

### 4.2 专业岗位策略（FIXED_SET，+v1.0.9）

```typescript
export interface JobModuleQuota { online: number; offline: number }

export interface QuestionPolicyJobSkillFixedSet {
  schema_version: 'question-policy-v1.2'
  bank_domain: 'JOB_SPECIFIC'
  selection_mode: 'FIXED_SET'
  job_module_quotas: Record<JobModuleCode, JobModuleQuota>
  fixed_scored_question_ids: string[]           // 24 个计分题 ID
  embedded_observation_question_ids: string[]   // 0-3 个观察项 ID
  fallback_strategy: 'BLOCK'
}
```

### 4.3 QuestionPolicyJson 联合类型

```typescript
export type QuestionPolicyJson =
  | QuestionPolicyBaseAbility
  | QuestionPolicyJobSkillFixedSet
```

---

## 5. scoring_policy_json（schema_version: scoring-policy-v1.1/v1.2）

### 5.1 基础能力策略（v1.1，+v1.0.7）

```typescript
export interface ScoringPolicyBaseAbility {
  schema_version: 'scoring-policy-v1.1'
  online_score_values: [0, 2]
  offline_score_values: [0, 1, 2]
  normalization: 'raw_score/max_score*100'
  safety_override_enabled: boolean
  placement_advice_enabled: boolean
  pilot_mode?: boolean
}
```

```diff
- // v1.0.0 旧结构（已废止）
- export interface ScoringPolicyJson {
-   score_values: [0, 1, 2]
-   normalization: 'raw_score/max_score*100'
-   safety_override_enabled: boolean
-   level_rules: LevelRule[]                // 废止 — 阈值由 strategy_config 表字段承担
- }
```

### 5.2 专业岗位策略（v1.2，+v1.0.9）

```typescript
export interface ScoringPolicyJobSkill {
  schema_version: 'scoring-policy-v1.2'
  assessment_scope: 'JOB_SKILL'
  online_score_values: [0, 2]
  offline_score_values: [0, 1, 2]
  normalization: 'raw_score/max_score*100'
  module_veto_mode: 'DISABLED_RECORD_ONLY'
  training_focus_threshold: number           // 如 0.6
  safety_override_enabled: boolean
  placement_advice_enabled: false
}
```

### 5.3 ScoringPolicyJson 联合类型

```typescript
export type ScoringPolicyJson =
  | ScoringPolicyBaseAbility
  | ScoringPolicyJobSkill
```

---
## 6. result_payload_json 类型定义

### 6.1 AbilityScorePayload（现有，微调）

```typescript
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

export interface ModuleScore {
  module_type: AbilityTag
  raw_score: number
  max_score: number
  normalized_score: number
}
```

### 6.2 JobSkillResultPayload（+v1.0.9，job-skill-result-v1.0）

```typescript
export interface JobSkillResultPayload {
  result_schema_version: 'job-skill-result-v1.0'
  overall: {
    raw_score: number           // 0-48
    max_score: 48
    normalized_score: number    // raw/48*100
    completion_ratio: number    // 计分题完成率（分母24）
  }
  score_tracks: {
    online_knowledge: { raw_score: number; max_score: 36; normalized_score: number }
    offline_performance: { raw_score: number; max_score: 12; normalized_score: number }
  }
  job_module_profiles: Record<JobModuleCode, JobModuleProfile>
  observation_completion_ratio: number   // 观察完成率（单独）
  support_summary: SupportSummary
  teacher_observations: TeacherObservationSummary[]
  safety_summary: SafetySummary
  validity_limitations: string[]
  recommended_training_focus: TrainingFocusItem[]
}

export interface JobModuleProfile {
  online_raw: number
  online_max: number             // 6（3题×2分）
  offline_raw: number
  offline_max: number            // 2（1题×2分）
  score_rate: number             // (online_raw + offline_raw) / (online_max + offline_max)
  response_status_summary: Record<ResponseStatus, number>
}

export interface TrainingFocusItem {
  job_module_code: JobModuleCode
  reason: string
  linked_task_code: string | null   // 只有 M2 有值（拆箱与上架）
  recommendation_text: string
}

export interface SupportSummary {
  prompt_level_distribution: Record<PromptLevel, number>
  accommodations_used: string[]
  instruction_replay_count: number
}

export interface TeacherObservationSummary {
  question_id: string
  observation_code: string
  observed: boolean
  behavior_codes: string[]
}

export interface SafetySummary {
  safety_incidents: SafetyIncidentRef[]
  safety_overridden: boolean
}

export interface SafetyIncidentRef {
  incident_id: string
  reason_code: string
  occurred_at: string
}
```

### 6.3 ResultPayloadJson 联合类型

```typescript
export type ResultPayloadJson =
  | AbilityScorePayload
  | TrainingCompletionPayload       // 现有
  | OperationPassRatePayload        // 现有
  | JobSkillResultPayload           // +v1.0.9
```

---

## 7. report_content_json 类型定义

### 7.1 基础能力报告（task-report-v1.1，现有+增强）

```typescript
export interface ReportContentBaseAbility {
  report_schema_version: 'task-report-v1.1'
  report_scope?: 'BASE_ABILITY'        // 缺省 = BASE_ABILITY
  report_type: 'FULL_REPORT' | 'SAFETY_TERMINATION_REPORT'
  generated_at: string
  // ... 现有结构保持（student/task/results/safety_incidents 等）
  evidence_summary?: Record<EvidenceType, unknown>    // +v1.0.7
  support_summary?: ReportSupportSummary              // +v1.0.7
  administration_status?: ReportAdministrationStatus  // +v1.0.7
  behavior_observations?: unknown[]                   // +v1.0.7
  validity_limitations?: string[]                     // +v1.0.7
  placement_advice?: PlacementAdvice
}
```

### 7.2 专业岗位报告（job-skill-report-v1.0，+v1.0.9）

```typescript
export interface ReportContentJobSkill {
  report_schema_version: 'job-skill-report-v1.0'
  report_scope: 'JOB_SKILL'
  assessment_meta: JobSkillAssessmentMeta
  overall_summary: JobSkillOverallSummary
  job_module_profiles: JobModuleReportProfile[]
  online_knowledge_summary: OnlineKnowledgeSummary
  offline_performance_summary: OfflinePerformanceSummary
  support_summary: ReportSupportSummary
  teacher_observations: TeacherObservationReport[]
  administration_summary: AdministrationSummaryReport
  safety_summary: SafetySummary
  validity_limitations: string[]
  recommended_training_focus: TrainingFocusItem[]
  recommended_training_tasks: RecommendedTask[]
  placement_advice: { enabled: false; reason_disabled: string }
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
  response_status_distribution: Record<ResponseStatus, number>
  key_observations: string[]
}

export interface RecommendedTask {
  job_module_code: JobModuleCode
  task_code: string | null
  recommendation_text: string
  has_existing_training: boolean
}

export interface TeacherObservationReport {
  question_id: string
  observation_code: string
  observed: boolean
  behavior_codes: string[]
  prompt_level: PromptLevel | null
  observation_note: string | null
}
```

### 7.3 ReportContentJson 联合类型

```typescript
export type ReportContentJson =
  | ReportContentBaseAbility
  | ReportContentJobSkill          // +v1.0.9
```

---

## 8. TeacherObservationPayload（+v1.0.9）

```typescript
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
  recorded_at: string                  // ISO 8601
}
```

---

## 9. answer_payload_json 合同（answer_record.answer_payload_json）

```typescript
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
  // timing
  presented_at: string
  first_action_at: string | null
  submitted_at: string
  first_action_latency_ms: number | null
  total_duration_ms: number
  // support
  prompt_level: PromptLevel
  accommodations_used: string[]
  instruction_replay_count: number
  input_method?: string
  // answer data
  response: Record<string, unknown>    // 按 interaction_type 的 answer_shape
  metrics: Record<string, unknown>     // 行为指标
  // scoring
  scoring_snapshot: ScoringSnapshot
}

export interface ScoringSnapshot {
  scoring_engine_version: string
  passed: boolean | null               // null = 未评分
  score: 0 | 2 | null
  failed_criteria: string[]
}
```

---
## 10. validateQuestionContract() 完整验证规则逻辑

此函数为统一跨层 validator（导入、审核门禁、session 创建三处复用），签名如下：

```typescript
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
  }
  contentJson: ContentJson
  scoringRuleJson: ScoringRuleJson
  assetRegistry: { exists(id: string): boolean; isActive(id: string): boolean; hashMatch(id: string): boolean }
  rendererRegistry: { isRegistered(type: InteractionType): boolean; isEnabled(type: InteractionType): boolean }
  // 可选：组卷入口调用时传入
  strategyType?: StrategyType
}

export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
  warnings: ValidationWarning[]
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
```

### 10.1 规则清单与判断表达式

```typescript
function validateQuestionContract(input: ValidateQuestionContractInput): ValidationResult {
  const errors: ValidationError[] = []
  const warnings: ValidationWarning[] = []
  const { questionRow: q, contentJson: c, scoringRuleJson: s, assetRegistry, rendererRegistry, strategyType } = input

  // ══════════════════════════════════════════════
  // 规则 1: bank_domain 与 module_type/job_module_code 域配对
  // ══════════════════════════════════════════════
  if (q.bank_domain === 'BASE_ABILITY') {
    if (q.module_type === null)
      errors.push({ code: 'DOMAIN_PAIR_001', field: 'module_type', message: 'BASE_ABILITY 题必须有 module_type' })
    if (q.job_module_code !== null)
      errors.push({ code: 'DOMAIN_PAIR_002', field: 'job_module_code', message: 'BASE_ABILITY 题的 job_module_code 必须为 NULL' })
  }
  if (q.bank_domain === 'JOB_SPECIFIC') {
    if (q.module_type !== null)
      errors.push({ code: 'DOMAIN_PAIR_003', field: 'module_type', message: 'JOB_SPECIFIC 题的 module_type 必须为 NULL' })
    if (q.job_module_code === null)
      errors.push({ code: 'DOMAIN_PAIR_004', field: 'job_module_code', message: 'JOB_SPECIFIC 题必须有 job_module_code' })
  }

  // ══════════════════════════════════════════════
  // 规则 2: strategy_type 与 bank_domain 绑定
  // ══════════════════════════════════════════════
  if (strategyType) {
    if (strategyType === 'BASELINE_ASSESSMENT' || strategyType === 'MOCK_EXAM') {
      if (q.bank_domain !== 'BASE_ABILITY')
        errors.push({ code: 'STRATEGY_DOMAIN_001', field: 'bank_domain',
          message: `${strategyType} 只能选择 BASE_ABILITY 题` })
    }
    if (strategyType === 'JOB_SKILL_ASSESSMENT') {
      if (q.bank_domain !== 'JOB_SPECIFIC')
        errors.push({ code: 'STRATEGY_DOMAIN_002', field: 'bank_domain',
          message: 'JOB_SKILL_ASSESSMENT 只能选择 JOB_SPECIFIC 题' })
    }
  }

  // ══════════════════════════════════════════════
  // 规则 3: item_usage 与 interaction_type
  // ══════════════════════════════════════════════
  const interactionType = c.interaction?.interaction_type
  if (q.item_usage === 'OBSERVATION_ONLY') {
    if (interactionType !== 'TEACHER_OBSERVATION' && interactionType !== 'SYSTEM_DERIVED_OBSERVATION')
      errors.push({ code: 'USAGE_INTERACTION_001', field: 'interaction_type',
        message: 'OBSERVATION_ONLY 的 interaction_type 必须为 TEACHER_OBSERVATION 或 SYSTEM_DERIVED_OBSERVATION' })
  }
  if (interactionType === 'TEACHER_OBSERVATION' || interactionType === 'SYSTEM_DERIVED_OBSERVATION') {
    if (q.item_usage !== 'OBSERVATION_ONLY')
      errors.push({ code: 'USAGE_INTERACTION_002', field: 'item_usage',
        message: 'TEACHER_OBSERVATION/SYSTEM_DERIVED_OBSERVATION 的 item_usage 必须为 OBSERVATION_ONLY' })
  }

  // ══════════════════════════════════════════════
  // 规则 4: item_usage 与 scoring_type
  // ══════════════════════════════════════════════
  if (q.item_usage === 'OBSERVATION_ONLY' && s.scoring_type !== 'NO_SCORE')
    errors.push({ code: 'USAGE_SCORING_001', field: 'scoring_type',
      message: 'OBSERVATION_ONLY 的 scoring_type 必须为 NO_SCORE' })
  if (s.scoring_type === 'NO_SCORE' && q.item_usage !== 'OBSERVATION_ONLY')
    errors.push({ code: 'USAGE_SCORING_002', field: 'item_usage',
      message: 'NO_SCORE 的 item_usage 必须为 OBSERVATION_ONLY' })
  // ══════════════════════════════════════════════
  // 规则 5: question_type 与 content_json.question_type 一致
  // ══════════════════════════════════════════════
  if (c.question_type !== q.question_type)
    errors.push({ code: 'TYPE_MATCH_001', field: 'content_json.question_type',
      message: `content_json.question_type(${c.question_type}) 与 question_bank.question_type(${q.question_type}) 不一致` })

  // ══════════════════════════════════════════════
  // 规则 6: question_phase 与题型关系（组卷/session 入口调用）
  // ══════════════════════════════════════════════
  // 此规则由 session question 创建时校验，见 assessment_session_question 触发器
  // OFFLINE_OPERATION → phase=OFFLINE; OBSERVATION_ONLY → phase=OBSERVATION; 其余 → phase=ONLINE

  // ══════════════════════════════════════════════
  // 规则 7: presentation_type 与资产 role
  // ══════════════════════════════════════════════
  const presType = c.presentation?.presentation_type
  if (presType === 'VIDEO_SCENE') {
    const hasSceneVideo = c.presentation?.assets?.some(
      a => a.role === 'SCENE_VIDEO' && a.required === true
    )
    if (!hasSceneVideo)
      errors.push({ code: 'ASSET_ROLE_001', field: 'presentation.assets',
        message: 'VIDEO_SCENE 必须绑定至少一个 required=true 的 SCENE_VIDEO 资产' })
  }

  // ══════════════════════════════════════════════
  // 规则 8: VIDEO_TO_IMAGE_CARD 降级必须有审核
  // ══════════════════════════════════════════════
  if (c.source?.transformation === 'VIDEO_TO_IMAGE_CARD') {
    if (!c.professional_review || c.professional_review.status !== 'APPROVED')
      errors.push({ code: 'DEGRADE_001', field: 'professional_review',
        message: 'VIDEO_TO_IMAGE_CARD 降级必须经专业审核 APPROVED' })
  }

  // ══════════════════════════════════════════════
  // 规则 9: answer_key_status（自动评分题须 VERIFIED/CORRECTED）
  // ══════════════════════════════════════════════
  const autoScoredTypes: QuestionType[] = ['TRUE_FALSE', 'SINGLE_CHOICE', 'DRAG', 'SOFTWARE_TASK']
  if (autoScoredTypes.includes(q.question_type)) {
    const keyStatus = c.review?.answer_key_status
    if (keyStatus !== 'VERIFIED' && keyStatus !== 'CORRECTED')
      errors.push({ code: 'ANSWER_KEY_001', field: 'review.answer_key_status',
        message: `自动评分题(${q.question_type})答案键状态必须为 VERIFIED 或 CORRECTED，当前: ${keyStatus}` })
  }

  // ══════════════════════════════════════════════
  // 规则 10: OFFLINE_RUBRIC 三档行为锚点校验
  // ══════════════════════════════════════════════
  if (s.scoring_type === 'OFFLINE_RUBRIC') {
    const GENERIC_TEMPLATES = [
      '未完成', '未能完成', '部分完成', '完全达标', '达标', '完成'
    ]
    for (const criterion of (s as ScoringRuleOffline).criteria) {
      for (const field of ['description_0', 'description_1', 'description_2'] as const) {
        const text = criterion[field]?.trim()
        if (!text)
          errors.push({ code: 'RUBRIC_001', field: `scoring_rule_json.criteria.${criterion.criterion_id}.${field}`,
            message: '三档行为锚点不得为空' })
        else if (GENERIC_TEMPLATES.some(t => text === t))
          errors.push({ code: 'RUBRIC_002', field: `scoring_rule_json.criteria.${criterion.criterion_id}.${field}`,
            message: `禁止使用通用模板锚点: "${text}"` })
      }
    }
  }

  // ══════════════════════════════════════════════
  // 规则 11: professional_review（安全/角色扮演/嵌入观察题）
  // ══════════════════════════════════════════════
  const needsProfReview = q.safety_sensitive
    || interactionType === 'TEACHER_OBSERVATION'
    || c.administration?.variant_type === 'ROLE_PLAY'
  if (needsProfReview) {
    if (!c.professional_review || !c.professional_review.required)
      warnings.push({ code: 'PROF_REVIEW_001', field: 'professional_review',
        message: '安全/角色扮演/嵌入观察题建议标记 professional_review.required=true' })
    if (c.professional_review?.required && c.professional_review.status !== 'APPROVED')
      errors.push({ code: 'PROF_REVIEW_002', field: 'professional_review.status',
        message: '需专业审核的题目必须为 APPROVED 才可 ACTIVE' })
  }

  // ══════════════════════════════════════════════
  // 规则 12: renderer registry 已注册且启用
  // ══════════════════════════════════════════════
  if (interactionType && interactionType !== 'OFFLINE_RUBRIC'
      && interactionType !== 'TEACHER_OBSERVATION'
      && interactionType !== 'SYSTEM_DERIVED_OBSERVATION') {
    if (!rendererRegistry.isRegistered(interactionType))
      errors.push({ code: 'RENDERER_001', field: 'interaction_type',
        message: `interaction_type "${interactionType}" 未在 renderer registry 注册` })
    else if (!rendererRegistry.isEnabled(interactionType))
      errors.push({ code: 'RENDERER_002', field: 'interaction_type',
        message: `interaction_type "${interactionType}" 在 renderer registry 中未启用` })
  }
  // ══════════════════════════════════════════════
  // 规则 13: required assets 存在、ACTIVE、hash 一致
  // ══════════════════════════════════════════════
  const requiredAssets = (c.presentation?.assets ?? []).filter(a => a.required)
  for (const asset of requiredAssets) {
    if (!assetRegistry.exists(asset.asset_id))
      errors.push({ code: 'ASSET_001', field: `presentation.assets[${asset.asset_key}]`,
        message: `asset_id "${asset.asset_id}" 不存在` })
    else if (!assetRegistry.isActive(asset.asset_id))
      errors.push({ code: 'ASSET_002', field: `presentation.assets[${asset.asset_key}]`,
        message: `asset_id "${asset.asset_id}" 状态非 ACTIVE` })
    else if (!assetRegistry.hashMatch(asset.asset_id))
      errors.push({ code: 'ASSET_003', field: `presentation.assets[${asset.asset_key}]`,
        message: `asset_id "${asset.asset_id}" hash 不一致` })
  }
  // media_asset_id（主素材）
  if (q.media_asset_id) {
    if (!assetRegistry.exists(q.media_asset_id))
      errors.push({ code: 'ASSET_004', field: 'media_asset_id',
        message: `media_asset_id "${q.media_asset_id}" 不存在` })
    else if (!assetRegistry.isActive(q.media_asset_id))
      errors.push({ code: 'ASSET_005', field: 'media_asset_id',
        message: `media_asset_id "${q.media_asset_id}" 状态非 ACTIVE` })
  }

  // ══════════════════════════════════════════════
  // 规则 14: ability_tags 合法性
  // ══════════════════════════════════════════════
  const VALID_TAGS: AbilityTag[] = ['FINE_MOTOR','COGNITION','RULE_EXECUTION','EMOTION_REGULATION','BASIC_SOCIAL','SAFETY_OPERATION']
  const tags = c.ability_tags ?? []
  for (const tag of tags) {
    if (!VALID_TAGS.includes(tag as AbilityTag))
      errors.push({ code: 'TAGS_001', field: 'ability_tags',
        message: `非法 ability_tag: "${tag}"` })
  }
  if (q.bank_domain === 'BASE_ABILITY' && tags.length === 0)
    errors.push({ code: 'TAGS_002', field: 'ability_tags',
      message: 'BASE_ABILITY 题的 ability_tags 至少需要 1 个值' })
  // JOB_SPECIFIC 允许空数组，但不允许非法值（上面循环已拦截）

  // ══════════════════════════════════════════════
  // 规则 15: 固定示范卷校验（全部 ACTIVE + 以上全部）
  // ══════════════════════════════════════════════
  if (q.status !== 'ACTIVE')
    errors.push({ code: 'STATUS_001', field: 'status',
      message: `题目状态必须为 ACTIVE，当前: ${q.status}` })

  // ══════════════════════════════════════════════
  // 补充规则: scoring_type 与 question_type 对应
  // ══════════════════════════════════════════════
  const VALID_SCORING_MAP: Record<string, string[]> = {
    'TRUE_FALSE':       ['EXACT_MATCH'],
    'SINGLE_CHOICE':    ['EXACT_MATCH'],
    'DRAG':             ['MAPPING_MATCH', 'ORDER_MATCH'],
    'SOFTWARE_TASK':    ['SET_MATCH', 'METRIC_THRESHOLD', 'EVENT_RULE'],
    'OFFLINE_OPERATION':['OFFLINE_RUBRIC'],
  }
  if (q.item_usage === 'SCORED_ITEM') {
    const allowed = VALID_SCORING_MAP[q.question_type] ?? []
    if (!allowed.includes(s.scoring_type))
      errors.push({ code: 'SCORING_TYPE_001', field: 'scoring_rule_json.scoring_type',
        message: `question_type "${q.question_type}" 不允许 scoring_type "${s.scoring_type}"，允许: ${allowed.join('/')}` })
  }

  // ══════════════════════════════════════════════
  // 补充规则: note 不得存储状态值
  // ══════════════════════════════════════════════
  const STATUS_PATTERNS = /^(ACTIVE|DRAFT|ARCHIVED|DISABLED)$/i
  if (c.note && STATUS_PATTERNS.test(c.note.trim()))
    warnings.push({ code: 'NOTE_001', field: 'note',
      message: `note 字段疑似存储状态值: "${c.note}"` })

  // ══════════════════════════════════════════════
  // 补充规则: RUBRIC_BASED / DRAG_PARTIAL 禁止入库
  // ══════════════════════════════════════════════
  if ((s as any).scoring_type === 'RUBRIC_BASED')
    errors.push({ code: 'LEGACY_001', field: 'scoring_type',
      message: 'RUBRIC_BASED 已废止，须迁移为 OFFLINE_RUBRIC' })
  if ((s as any).scoring_type === 'DRAG_PARTIAL')
    errors.push({ code: 'LEGACY_002', field: 'scoring_type',
      message: 'DRAG_PARTIAL 已废止，须迁移为 ORDER_MATCH 或 MAPPING_MATCH' })

  // ══════════════════════════════════════════════
  // 补充规则: 线上 pass_score 固定 2, fail_score 固定 0
  // ══════════════════════════════════════════════
  if (s.scoring_type !== 'OFFLINE_RUBRIC' && s.scoring_type !== 'NO_SCORE') {
    if ((s as any).pass_score !== 2)
      errors.push({ code: 'SCORE_VALUE_001', field: 'pass_score', message: '线上 pass_score 必须为 2' })
    if ((s as any).fail_score !== 0)
      errors.push({ code: 'SCORE_VALUE_002', field: 'fail_score', message: '线上 fail_score 必须为 0' })
  }

  return { valid: errors.length === 0, errors, warnings }
}
```

---
## 11. 附录 A：question_bank.sensory_tags_json / tool_asset_ids_json（无变更）

这两个 JSON 列在 v1.0.7-v1.0.9 中无结构变更，保持 v1.0.0 定义：

```typescript
// question_bank.sensory_tags_json（无变更）
export interface SensoryTagsJson {
  noise_level?: 'LOW' | 'MEDIUM' | 'HIGH' | null
  light_intensity?: 'LOW' | 'MEDIUM' | 'HIGH' | null
  crowd_density?: 'LOW' | 'MEDIUM' | 'HIGH' | null
  tactile_sensitivity?: 'LOW' | 'MEDIUM' | 'HIGH' | null
  has_low_stimuli_variant: boolean
  avoid_tags?: string[]
}

// question_bank.tool_asset_ids_json（无变更）
export type ToolAssetIdsJson = string[]   // asset_resource.asset_id[]
```

---

## 12. 附录 B：student_profile.sensory_profile_json（无变更）

```typescript
export interface SensoryProfileJson {
  noise_sensitivity?: 'LOW' | 'MEDIUM' | 'HIGH' | null
  light_sensitivity?: 'LOW' | 'MEDIUM' | 'HIGH' | null
  tactile_sensitivity?: 'LOW' | 'MEDIUM' | 'HIGH' | null
  crowd_density_sensitivity?: 'LOW' | 'MEDIUM' | 'HIGH' | null
  avoid_tags?: string[]
  notes?: string
}
```

---

## 13. 附录 C：training_session.strategy_snapshot_json（无变更）

```typescript
export interface StrategySnapshotJson {
  strategy_id: string
  strategy_type: StrategyType           // 枚举扩展自动覆盖
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
```

---

## 14. 附录 D：error_event_log.context_json（无变更）

```typescript
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
```

---

## 15. 附录 E：冲突与遗漏标注

| # | 问题 | 来源 | 说明 |
|---|---|---|---|
| [!] 1 | `expected_answer` 存废过渡 | v1.0.7 决策 49 vs 现有代码 | v1.0.7 明确"正确答案唯一事实源迁入 scoring_rule_json"，但现有 json-schemas.ts 仍保留 `expected_answer`。**迁移时必须同时更新导入器和所有消费路径**，不得只删类型不改逻辑。 |
| [!] 2 | `scoring_mode` 存废 | v1.0.0 ContentJsonDrag vs v1.0.7 | 旧 `ContentJsonDrag.scoring_mode` 在 v1.0.7 后由 scoring_rule_json 的 MAPPING_MATCH/ORDER_MATCH 承载。需确认现有前端是否依赖此字段做 UI 分支。 |
| [!] 3 | `LevelRule[]` 废止但现有代码依赖 | v1.0.7 §7.6.2 | `scoring_policy_json.level_rules` 废止，但现有评分器可能读取该字段做等级判定。需确认 reducer / result-generator 是否已改用表字段。 |
| [!] 4 | `question_ratio` 废止 | v1.0.7 §7.6.1 | 旧组卷逻辑依赖 `question_ratio`，升级后需改写为 `online_quota_by_module` 路径。 |
| [!] 5 | OBSERVATION_ONLY 是否可进 assessment_session_question | v1.0.7 vs v1.0.9 | v1.0.7 §11.12.2 说"OBSERVATION_ONLY 不得进入该表"；v1.0.9 §11.13.3 明确废止该约束，改为以 OBSERVATION phase 进入。**以 v1.0.9 为准**。 |
| [!] 6 | `post_disclosure_done` vs `post_disclosure_status` | v1.0.8 §8.7.4 vs v1.0.9 决策 81 | v1.0.8 原为必填布尔；v1.0.9 改为可选三值枚举，且不作门禁。 |
| [!] 7 | 基础能力 `ScoringRuleExactMatch` 结构重构 | v1.0.0 vs v1.0.7 | 旧结构 `{ max_score, correct_score, incorrect_score }` 需重构为 `{ pass_score, fail_score, expected_answer, scoring_engine_version }`。需评估是否存在已持久化的旧格式数据需要兼容读取。 |

---

## 16. 附录 F：实施优先级

1. **Phase 1（类型声明）**：新增所有枚举和接口到 `json-schemas.ts`，删除已废止分支。
2. **Phase 2（validator）**：实现 `validateQuestionContract()`，在主进程 `src/main/domain/` 下。
3. **Phase 3（scoring_rule 迁移）**：`expected_answer` 从 content_json 迁出；`DRAG_PARTIAL` → ORDER_MATCH/MAPPING_MATCH；`RUBRIC_BASED` → OFFLINE_RUBRIC。
4. **Phase 4（question_policy / scoring_policy）**：废止旧结构，实现联合类型分支。
5. **Phase 5（新增合同）**：JobSkillResultPayload, JobSkillReportContent, TeacherObservationPayload, AnswerPayloadJson。
6. **Phase 6（schema v0.1.12）**：全量 SQL 生成，含所有新字段/CHECK/触发器。

---

*配套文件：*
- `src/shared/types/json-schemas.ts`（实现目标）
- `src/main/domain/validators/question-contract-validator.ts`（validateQuestionContract 实现位置）
- `doc/specs/xc-career-guide-json-field-schema-v1.0.0.md`（原始 v1.0.0 规范，作为历史参照保留）
