# 炫灿-职途向导系统 JSON 字段规范

版本：v1.0.0  
工程基线：`schema.sql v0.1.8-base-ability-rebalance`，`PRD v1.0.5`  
文档状态：草案（首期落地实施前置文档）  
最后更新：2026-07-01  

> 2026-07-01 修订：`scoring_policy_json` 内部键 `pass_threshold / improve_threshold` 随 schema v0.1.8 表字段一并更名为 `competent_threshold / conditional_threshold`；`module_veto_threshold / emotion_collapse_threshold` 提升为 `strategy_config` 表级字段后从 JSON 移除；`level_rules.level` 枚举切换为 `LEVEL_COMPETENT / LEVEL_CONDITIONAL / LEVEL_NOT_COMPETENT`。

---

## 0. 约定

1. 所有 JSON 字段在 SQLite 中以 `TEXT` 存储，格式化 / 校验由主进程（Electron main process）负责。
2. 字段标记 `required` 表示插入或更新时必须存在且非 null；`optional` 表示可省略或为 null。
3. 所有 `asset_id` 引用必须存在于 `asset_resource` 表；不存在的 ID 不得写入。
4. 所有枚举值采用全大写下划线形式，与 schema.sql CHECK 约束保持一致。
5. 本文档中的 TypeScript interface 仅用于可读性说明，不作为运行时类型定义；实际类型定义应在 `src/shared/types/` 目录下独立维护。

---

## 1. `question_bank.content_json`

题目内容的主体 JSON，结构因 `question_type` 不同而分叉。

### 1.1 公共字段（所有题型均有）

```typescript
interface ContentJsonBase {
  // required
  prompt: string;                    // 题干文字，不超过 80 字
  assessment_point: string;          // 考察点描述，例如 "安全操作认知"
  ability_tags: AbilityTag[];        // 至少一个能力维度标签

  // optional
  media_brief?: string;              // 素材内容说明（给审核者看，不展示给学生）
  note?: string;                     // 备注（CSV 导入时来自备注列）
  source?: ContentSource;            // 导入溯源信息
  variants?: ContentVariant[] | null; // 正确版/错误版素材变体（判断题专用，见 1.2）
}

type AbilityTag =
  | 'FINE_MOTOR'
  | 'COGNITION'
  | 'RULE_EXECUTION'
  | 'EMOTION_REGULATION'
  | 'BASIC_SOCIAL'
  | 'SAFETY_OPERATION';

interface ContentSource {
  import_batch_id: string;           // 导入批次 ID，格式建议 batch_YYYYMMDD_NNN
  source_file: string;               // 源文件名
  source_row: number;                // 源文件行号（1-based）
  imported_at: string;               // ISO 8601 UTC
  imported_by: string;               // user_account.user_id
}
```

### 1.2 `TRUE_FALSE` 判断题

```typescript
interface ContentJsonTrueFalse extends ContentJsonBase {
  question_type: 'TRUE_FALSE';
  expected_answer: boolean;          // true = 正确，false = 错误；审核后必填
  // variants 用于尚未绑定素材和答案的蓝本题
  // 正式发布前必须选择以下方式之一：
  //   a) 将蓝本拆成两道正式题（expected_answer 分别为 true / false）
  //   b) 在 variants 中登记变体，出题时由策略选择
  variants?: TrueFalseVariant[] | null;
}

interface TrueFalseVariant {
  variant_id: string;
  media_asset_id: string | null;     // asset_resource.asset_id
  media_brief: string;
  expected_answer: boolean;
}
```

**示例：**
```json
{
  "question_type": "TRUE_FALSE",
  "prompt": "图中同学的开箱方式是安全的吗？",
  "expected_answer": true,
  "assessment_point": "安全操作认知",
  "ability_tags": ["SAFETY_OPERATION"],
  "media_brief": "视频：正确双手托举姿势，刀刃朝外",
  "source": {
    "import_batch_id": "batch_20260630_001",
    "source_file": "通用基础能力评估题库2026.6.30.csv",
    "source_row": 12,
    "imported_at": "2026-06-30T08:00:00Z",
    "imported_by": "admin_001"
  }
}
```

### 1.3 `SINGLE_CHOICE` 单选题

```typescript
interface ContentJsonSingleChoice extends ContentJsonBase {
  question_type: 'SINGLE_CHOICE';
  options: ChoiceOption[];           // 2–4 个选项；审核后必填
  expected_answer: string;           // 正确选项的 key；审核后必填
}

interface ChoiceOption {
  key: string;                       // 'A' | 'B' | 'C' | 'D'
  text: string;                      // 选项文字，不超过 40 字
  image_asset_id?: string | null;    // 若选项有配图
}
```

**示例：**
```json
{
  "question_type": "SINGLE_CHOICE",
  "prompt": "发现纸箱破损，应该怎么做？",
  "options": [
    { "key": "A", "text": "继续打开纸箱上架" },
    { "key": "B", "text": "告诉老师并放到一旁" },
    { "key": "C", "text": "用胶带粘好继续使用" }
  ],
  "expected_answer": "B",
  "assessment_point": "异常处理规则",
  "ability_tags": ["RULE_EXECUTION"],
  "source": { "import_batch_id": "batch_20260630_001", "source_file": "通用基础能力评估题库2026.6.30.csv", "source_row": 35, "imported_at": "2026-06-30T08:00:00Z", "imported_by": "admin_001" }
}
```

### 1.4 `DRAG` 拖拽题

```typescript
interface ContentJsonDrag extends ContentJsonBase {
  question_type: 'DRAG';
  drag_items: DragItem[];            // 可拖动的元素列表
  drop_zones: DropZone[];            // 放置区列表
  // scoring_mode 决定评分基准（见 scoring_rule_json §2.3）
  scoring_mode: 'ALL_OR_NOTHING' | 'PARTIAL_CREDIT';
}

interface DragItem {
  item_id: string;
  label: string;
  image_asset_id?: string | null;
}

interface DropZone {
  zone_id: string;
  label: string;
  accepts: string[];                 // 正确应放入此区的 item_id 列表
}
```

**示例：**
```json
{
  "question_type": "DRAG",
  "prompt": "请把商品拖到正确的货架区域",
  "drag_items": [
    { "item_id": "d1", "label": "牛奶", "image_asset_id": "asset_milk_img_001" },
    { "item_id": "d2", "label": "薯片", "image_asset_id": "asset_chips_img_001" }
  ],
  "drop_zones": [
    { "zone_id": "z1", "label": "乳制品区", "accepts": ["d1"] },
    { "zone_id": "z2", "label": "休闲零食区", "accepts": ["d2"] }
  ],
  "scoring_mode": "PARTIAL_CREDIT",
  "assessment_point": "货架分类认知",
  "ability_tags": ["COGNITION", "FINE_MOTOR"],
  "source": { "import_batch_id": "batch_20260630_001", "source_file": "通用基础能力评估题库2026.6.30.csv", "source_row": 67, "imported_at": "2026-06-30T08:00:00Z", "imported_by": "admin_001" }
}
```

### 1.5 `OFFLINE_OPERATION` 线下实操题

```typescript
interface ContentJsonOfflineOperation extends ContentJsonBase {
  question_type: 'OFFLINE_OPERATION';
  offline_tool_brief: string;        // 教具清单说明，给教师准备道具用
  rubric_criteria: RubricCriterion[]; // 评分维度（对应 scoring_rule_json 中的 criteria）
}

interface RubricCriterion {
  criterion_id: string;              // 唯一 ID，在 scoring_rule_json 中引用
  description: string;               // 评分标准描述
}
```

**示例：**
```json
{
  "question_type": "OFFLINE_OPERATION",
  "prompt": "请完成纸箱开箱并将商品摆放到货架",
  "offline_tool_brief": "模拟开箱刀（安全款）、货架道具、5件商品模型",
  "rubric_criteria": [
    { "criterion_id": "r1", "description": "安全握持开箱工具，刀刃朝外" },
    { "criterion_id": "r2", "description": "按正确方向拆开纸箱顶部" },
    { "criterion_id": "r3", "description": "商品摆放整齐，正面朝外" }
  ],
  "assessment_point": "实操综合能力",
  "ability_tags": ["FINE_MOTOR", "RULE_EXECUTION", "SAFETY_OPERATION"],
  "source": { "import_batch_id": "batch_20260630_001", "source_file": "通用基础能力评估题库2026.6.30.csv", "source_row": 112, "imported_at": "2026-06-30T08:00:00Z", "imported_by": "admin_001" }
}
```

---

## 2. `question_bank.scoring_rule_json`

定义该题的计分规则。schema 中 `answer_record.score` 与 `offline_score_record.score` 均限制在 `{0, 1, 2}`。

### 2.1 `TRUE_FALSE` / `SINGLE_CHOICE`

```typescript
interface ScoringRuleExactMatch {
  scoring_type: 'EXACT_MATCH';
  max_score: 2;                      // 必须为 2
  correct_score: 2;
  incorrect_score: 0;
}
```

**示例：**
```json
{ "scoring_type": "EXACT_MATCH", "max_score": 2, "correct_score": 2, "incorrect_score": 0 }
```

### 2.2 `DRAG`（部分得分）

```typescript
interface ScoringRuleDrag {
  scoring_type: 'DRAG_PARTIAL';
  max_score: 2;
  // 所有 item 均正确 → 2；超过 half 正确 → 1；其余 → 0
  all_correct_score: 2;
  partial_correct_score: 1;          // 多于 half 正确
  incorrect_score: 0;
}
```

**示例：**
```json
{ "scoring_type": "DRAG_PARTIAL", "max_score": 2, "all_correct_score": 2, "partial_correct_score": 1, "incorrect_score": 0 }
```

若 `content_json.scoring_mode = 'ALL_OR_NOTHING'`，则 `partial_correct_score` 设为 0。

### 2.3 `OFFLINE_OPERATION`

线下实操题由教师按 0/1/2 直接打分，`scoring_rule_json` 描述每个评分等级的含义，供教师界面展示。

```typescript
interface ScoringRuleOffline {
  scoring_type: 'OFFLINE_RUBRIC';
  max_score: 2;
  criteria: OfflineCriterionRule[];
  score_labels: {                    // 教师界面展示的等级说明
    '0': string;                     // 例如 "不达标"
    '1': string;                     // 例如 "需辅助/需改进"
    '2': string;                     // 例如 "独立完成/达标"
  };
}

interface OfflineCriterionRule {
  criterion_id: string;              // 与 content_json.rubric_criteria 对应
  description_0: string;             // 0 分时的行为描述
  description_1: string;             // 1 分时的行为描述
  description_2: string;             // 2 分时的行为描述
}
```

**示例：**
```json
{
  "scoring_type": "OFFLINE_RUBRIC",
  "max_score": 2,
  "criteria": [
    {
      "criterion_id": "r1",
      "description_0": "未握持工具或握持方向危险",
      "description_1": "握持方向基本正确但需提示",
      "description_2": "独立完成安全握持"
    },
    {
      "criterion_id": "r2",
      "description_0": "无法打开或方向错误",
      "description_1": "需辅助完成拆箱",
      "description_2": "独立按正确方向拆箱"
    },
    {
      "criterion_id": "r3",
      "description_0": "商品摆放混乱或朝向错误",
      "description_1": "大部分正确但仍需调整",
      "description_2": "全部整齐且正面朝外"
    }
  ],
  "score_labels": {
    "0": "不达标",
    "1": "需改进/需辅助",
    "2": "达标"
  }
}
```

---

## 3. `question_bank.tool_asset_ids_json`

JSON 数组，存储线下实操题所需教具资源的 `asset_id` 列表。

```typescript
type ToolAssetIdsJson = string[];    // asset_resource.asset_id[]
```

**示例：**
```json
["asset_checklist_unbox_v1", "asset_pdf_safety_tool_guide_v1"]
```

规则：
- 仅用于 `OFFLINE_OPERATION` 题型；其他题型应为 `null`。
- 所有 ID 必须存在于 `asset_resource` 且 `status = 'ACTIVE'`。

---

## 4. `question_bank.sensory_tags_json`

描述该题包含的感官刺激属性，用于感官画像过滤。

```typescript
interface SensoryTagsJson {
  noise_level?: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  light_intensity?: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  crowd_density?: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  tactile_sensitivity?: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  has_low_stimuli_variant: boolean;  // 是否有低刺激替代版本
  avoid_tags?: string[];             // 应与 sensory_profile_json.avoid_tags 匹配的标签
}
```

**示例：**
```json
{
  "noise_level": "HIGH",
  "light_intensity": "LOW",
  "crowd_density": "MEDIUM",
  "tactile_sensitivity": null,
  "has_low_stimuli_variant": true,
  "avoid_tags": ["NOISY_SUPERMARKET"]
}
```

---

## 5. `strategy_config.question_policy_json`

组卷策略，控制如何从 `question_bank` 中抽取题目。

```typescript
interface QuestionPolicyJson {
  // required
  module_scope: 'SINGLE_MODULE' | 'CROSS_MODULE';

  // 各题型题目数量（与 strategy_config 中的 online/offline count 之和一致）
  question_ratio: {
    TRUE_FALSE?: number;
    SINGLE_CHOICE?: number;
    DRAG?: number;
    OFFLINE_OPERATION?: number;
  };

  // optional
  required_modules?: AbilityTag[];   // CROSS_MODULE 时指定必须覆盖的模块
  difficulty_distribution?: {        // key 是 difficulty_level 数值字符串
    [level: string]: number;         // 占比，所有值之和应为 1.0
  };
  sensory_filter_mode?: 'SOFT' | 'STRICT'; // SOFT=优先排除，STRICT=强制排除
  fallback_strategy?: 'LOW_STIMULI_FIRST' | 'SAME_TYPE_DIFFERENT_ASSET' | 'BLOCK';
}
```

**示例（BASELINE_ASSESSMENT 基础能力评估，v1.0.5 42+8 口径）：**
```json
{
  "module_scope": "CROSS_MODULE",
  "question_ratio": {
    "TRUE_FALSE": 14,
    "SINGLE_CHOICE": 14,
    "DRAG": 14,
    "OFFLINE_OPERATION": 8
  },
  "required_modules": [
    "FINE_MOTOR", "COGNITION", "RULE_EXECUTION",
    "EMOTION_REGULATION", "BASIC_SOCIAL", "SAFETY_OPERATION"
  ],
  "difficulty_distribution": {
    "1": 0.3,
    "3": 0.5,
    "5": 0.2
  },
  "sensory_filter_mode": "SOFT",
  "fallback_strategy": "LOW_STIMULI_FIRST"
}
```

> v1.0.5 起 BASELINE_ASSESSMENT 与 MOCK_EXAM 共用同一套基础能力评估口径（线上 42 = 6 模块 × 每模块 7，线下 8，满分 100），详见 PRD §2.4。每模块 7 题由组卷算法按 `required_modules` 与 `online_question_count = 42` 强制保证，无需在 JSON 内单独声明。

**示例（MOCK_EXAM 标准化模拟卷，同口径）：**
```json
{
  "module_scope": "CROSS_MODULE",
  "question_ratio": {
    "TRUE_FALSE": 14,
    "SINGLE_CHOICE": 14,
    "DRAG": 14,
    "OFFLINE_OPERATION": 8
  },
  "required_modules": [
    "FINE_MOTOR", "COGNITION", "RULE_EXECUTION",
    "EMOTION_REGULATION", "BASIC_SOCIAL", "SAFETY_OPERATION"
  ],
  "sensory_filter_mode": "SOFT",
  "fallback_strategy": "LOW_STIMULI_FIRST"
}
```

---

## 6. `strategy_config.scoring_policy_json`

评分策略，控制分数计算、等级判定和安全覆盖规则。

```typescript
interface ScoringPolicyJson {
  // required
  score_values: [0, 1, 2];           // 固定值，对应 schema CHECK
  normalization: 'raw_score/max_score*100'; // 固定公式

  safety_override_enabled: boolean;  // 安全红线覆盖是否启用

  level_rules: LevelRule[];          // 等级判定规则，从高到低排列
}

interface LevelRule {
  min: number;                       // 含
  max: number;                       // 含（最高 100）
  level: 'LEVEL_COMPETENT' | 'LEVEL_CONDITIONAL' | 'LEVEL_NOT_COMPETENT';
}
```

> v0.1.8 起，下列阈值提升为 `strategy_config` 表级字段，**不再承载于本 JSON**：
> - `competent_threshold`（对应 `LEVEL_COMPETENT` 阈值，默认 80）
> - `conditional_threshold`（对应 `LEVEL_CONDITIONAL` 阈值，默认 60）
> - `module_veto_threshold`（模块否决阈值，默认 0.5，任一模块得分率低于此值强制 `LEVEL_NOT_COMPETENT`）
> - `emotion_collapse_threshold`（情绪崩溃兜底次数，默认 3）
>
> `level_rules` 中的 `min/max` 必须与 `competent_threshold / conditional_threshold` 表字段一致，应用层校验时需交叉比对。

**示例：**
```json
{
  "score_values": [0, 1, 2],
  "normalization": "raw_score/max_score*100",
  "safety_override_enabled": true,
  "level_rules": [
    { "min": 80, "max": 100, "level": "LEVEL_COMPETENT" },
    { "min": 60, "max": 79,  "level": "LEVEL_CONDITIONAL" },
    { "min": 0,  "max": 59,  "level": "LEVEL_NOT_COMPETENT" }
  ]
}
```

> 注意：`LEVEL_FAIL_BY_SAFETY` 不通过 `level_rules` 判定，由主进程在安全红线触发时强制写入，优先级高于一切分数与兜底判定。`LEVEL_NOT_COMPETENT` 可由分数阈值、模块兜底或情绪崩溃兜底三条路径得出。

---

## 7. `training_session.strategy_snapshot_json`

策略快照，保存创建 training_session 时 strategy_config 的完整语义字段副本。MVP 阶段该字段 `nullable`，但推荐填写以增强历史可复现性。

```typescript
interface StrategySnapshotJson {
  strategy_id: string;
  strategy_type: 'TRAINING_PRACTICE';
  job_code: string;
  strategy_name: string;
  version: number;
  online_question_count: number;
  offline_question_count: number;
  max_score: number;
  competent_threshold: number;
  conditional_threshold: number;
  module_veto_threshold: number;
  emotion_collapse_threshold: number;
  question_policy_json: QuestionPolicyJson;
  scoring_policy_json: ScoringPolicyJson;
  supports_redline_halt: boolean;
  allows_emotion_interrupt: boolean;
  requires_offline_scoring: boolean;
  snapshot_taken_at: string;         // ISO 8601 UTC
}
```

---

## 8. `student_profile.sensory_profile_json`

记录学生的感官敏感信息，影响题目筛选和资源选择。

```typescript
interface SensoryProfileJson {
  noise_sensitivity?: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  light_sensitivity?: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  tactile_sensitivity?: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  crowd_density_sensitivity?: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  avoid_tags?: string[];             // 需要回避的场景标签，与 question_bank.sensory_tags_json 匹配
  notes?: string;                    // 教师补充说明
}
```

**示例：**
```json
{
  "noise_sensitivity": "HIGH",
  "light_sensitivity": "LOW",
  "tactile_sensitivity": "MEDIUM",
  "crowd_density_sensitivity": "HIGH",
  "avoid_tags": ["NOISY_SUPERMARKET", "BRIGHT_FLASH"],
  "notes": "对嘈杂环境非常敏感，建议使用静音版视频素材"
}
```

---

## 9. `error_event_log.context_json`

错误事件的上下文信息，结构宽松，用于调试和恢复。

```typescript
interface ErrorContextJson {
  // optional — 视错误类型填写相关字段
  session_id?: string;
  student_id?: string;
  question_id?: string;
  asset_id?: string;
  event_id?: string;
  file_path?: string;
  expected_hash?: string;
  actual_hash?: string;
  file_size_bytes?: number;
  ipc_channel?: string;
  timeout_ms?: number;
  retry_count?: number;
  extra?: Record<string, unknown>;   // 其他调试信息
}
```

**示例（ASSET_HASH_MISMATCH）：**
```json
{
  "asset_id": "asset_video_unbox_step1",
  "file_path": "assets/video/unbox_step1.mp4",
  "expected_hash": "sha256:abc123...",
  "actual_hash": "sha256:def456...",
  "file_size_bytes": 3145728
}
```

---

## 10. `result_record.result_payload_json`

结果的补充分项数据（可选），用于报告中展示分维度结果。

```typescript
// ABILITY_SCORE 时
interface AbilityScorePayload {
  result_type: 'ABILITY_SCORE';
  module_scores?: ModuleScore[];     // 按模块拆分得分
  online_raw_score: number;
  offline_raw_score: number;
  question_count: number;
  answered_count: number;
  // v1.0.5 / PRD §5.4 第 9 步：以下字段必须随结果持久化，不得只存最终等级
  emotion_collapse_count: number;    // 本会话累计情绪崩溃次数（0 表示未触发兜底）
  module_veto_triggered_by?: AbilityTag | null; // 触发模块否决的模块（null 表示未触发）
  level_forced_by?: 'MODULE_VETO' | 'EMOTION_COLLAPSE' | null; // 等级是否被兜底强制（null 表示纯分数判定）
}

interface ModuleScore {
  module_type: AbilityTag;
  raw_score: number;
  max_score: number;
  normalized_score: number;
}

// TRAINING_COMPLETION 时
interface TrainingCompletionPayload {
  result_type: 'TRAINING_COMPLETION';
  step_summary: StepSummary[];
}

interface StepSummary {
  step_type: 'WATCH' | 'LEARN' | 'PRACTICE' | 'DO';
  status: 'COMPLETED' | 'SKIPPED' | 'FAILED' | 'IN_PROGRESS' | 'NOT_STARTED';
  attempt_count: number;
}

// OPERATION_PASS_RATE 时
interface OperationPassRatePayload {
  result_type: 'OPERATION_PASS_RATE';
  criterion_scores: CriterionScore[];
}

interface CriterionScore {
  question_id: string;
  criterion_id: string;
  score: 0 | 1 | 2;
}
```

---

## 11. `task_report.report_content_json`

报告快照内容，生成时固化，不得事后修改。

```typescript
interface ReportContentJson {
  report_type: 'FULL_REPORT' | 'SAFETY_TERMINATION_REPORT';
  report_version: string;            // 例如 "1.0.4"
  schema_version: string;            // 例如 "0.1.7-consistency-guard"
  generated_at: string;              // ISO 8601 UTC

  student: {
    student_id: string;
    student_name: string;            // 可为简称（脱敏）
    gender?: string | null;
  };

  task: {
    job_code: string;
    task_code: string;
    strategy_id: string;
    strategy_version: number;
  };

  results: {
    ability_score?: ResultSnapshot | null;
    training_completion?: ResultSnapshot | null;
    operation_pass_rate?: ResultSnapshot | null;
  };

  safety_incidents?: SafetyIncidentSnapshot[];

  recommendation: string;            // 系统建议结论，按 PRD §7.4 规则生成

  teacher_notes?: string | null;     // 教师备注（可选导出）

  // FULL_REPORT 专用
  answer_summary?: AnswerSummary | null;
  training_summary?: TrainingSummary | null;
}

interface ResultSnapshot {
  result_id: string;
  raw_score: number | null;
  max_score: number | null;
  normalized_score: number;
  level_result: string;
  safety_overridden: boolean;
}

interface SafetyIncidentSnapshot {
  incident_id: string;
  reason_code: string;
  context_phase: string;
  occurred_at: string;
  status: string;
}

interface AnswerSummary {
  total_questions: number;
  correct_count: number;
  total_online_score: number;
  total_offline_score: number;
}

interface TrainingSummary {
  total_steps: number;
  completed_steps: number;
  skipped_steps: number;
  failed_steps: number;
  completion_rate: number;
}
```

---

## 附录 A：字段合规检查清单

在主进程写入任何 JSON 字段前，必须验证：

| 字段 | 必须验证项 |
|---|---|
| `content_json` | `question_type` 与 `question_bank.question_type` 一致；`expected_answer` 在审核完成后非空 |
| `scoring_rule_json` | `max_score` 为 2；`scoring_type` 与 `question_type` 匹配 |
| `question_policy_json` | 各 `question_ratio` 之和等于 `online_question_count + offline_question_count` |
| `scoring_policy_json` | `level_rules` 的 `min/max` 与表字段 `competent_threshold / conditional_threshold` 一致；`level` 枚举仅含 `LEVEL_COMPETENT / LEVEL_CONDITIONAL / LEVEL_NOT_COMPETENT`；覆盖 [0, 100] 无盲区无重叠 |
| `sensory_profile_json` | 枚举值在允许范围内 |
| `report_content_json` | 生成时 `result_record.is_current = 1` 的结果已全部载入；`safety_overridden` 状态已同步 |

---

*本文档配套文件：`doc/xc-career-guide-event-payload-schema-v1.0.0.md`*
