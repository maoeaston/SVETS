# 炫灿-职途向导系统 MVP 产品需求文档｜题库数据合同收口差异版

版本：PRD v1.0.7-question-contract-closure  
当前工程基线：`schema.sql v0.1.10-scoring-closure`  
目标工程基线：`schema.sql v0.1.11-question-contract-closure`（待 Codex 按本文实现）  
上一版 PRD：`PRD v1.0.6-scoring-closure`  
继承基线：`PRD v1.0.5-base-ability-rebalance` 全文 + `PRD v1.0.6-scoring-closure` 全部替换与增补  
题库基线：`通用基础能力正式测评候选题库 v0.2-软件优先版`  
产品阶段：MVP  
最后更新：2026-07-07

> **编写体例说明**：本文不是重新叙述整份 PRD，而是可直接交给 Codex 执行的差异修订版。凡本文未出现的章节，先沿用 PRD v1.0.6；v1.0.6 未覆盖的章节继续沿用 PRD v1.0.5。本文出现“全文替换”的章节覆盖旧版本对应章节；出现“新增”的内容按指定编号插入。

---

## 0. 定稿说明

### 0.1 本版定位

PRD v1.0.6 已完成线上二值评分、线下双轨评分、坐次机制、题目冻结、完成率和安置复核收口，但现有题库数据合同仍以 `TRUE_FALSE / SINGLE_CHOICE / DRAG / OFFLINE_OPERATION` 四类传统题型为中心，无法稳定承载 v0.2 软件优先候选题库中的多选、轨迹控制、多点触控、音频多步执行、计时任务、分支沟通、系统派生观察和 NR/ST 等需求。

本版只处理“题库能否被当前系统稳定执行、记录、评分和报告”的合同问题，不扩展完整题库后台、完整试卷系统、公共模拟卷、自定义试卷、PDF 报告渲染、AI 自动出题或统计分析平台。

### 0.2 新题库事实口径

1. 候选池共 96 个条目：87 个纯软件条目、1 个软件嵌入日志观察项、8 个必要实物条目。
2. 其中 1 个“跨任务系统派生观察项”不是独立计分题，不得进入 42+8 题量、不得单独生成 0/2 分。
3. 因此当前候选池的计分候选上限为 95 个，正式 MVP 仍从中选出 42 个线上计分题和 8 个线下计分题。
4. 候选题当前状态为内容效度复核/试测，不等于已经验证的标准化量表。
5. 试测阶段允许生成模块画像和行为证据报告，但默认关闭就业安置方向输出。

### 0.3 v1.0.7 新增决策条目（承接 v1.0.6 第 29～40 条）

41. **题型模型采用“两层分类”**：数据库级 `question_type` 表示存储与评分大类；`content_json.interaction.interaction_type` 表示具体渲染和答题行为。不得继续用 `question_type` 穷举所有交互控件。
42. **新增 `SOFTWARE_TASK`**：在现有四类 `question_type` 基础上增加一个通用软件行为任务大类，承载多选、轨迹、计时、序列、分支和复杂模拟。
43. **新增 `item_usage`**：`question_bank.item_usage` 至少区分 `SCORED_ITEM / OBSERVATION_ONLY`。观察项不进入组卷、计分和完成率分母。
44. **交互类型必须显式声明**：每道题必须在 `content_json` 声明 `interaction_type`；未实现的交互类型不得转 `ACTIVE`，不得通过降级成单选题凑题量。
45. **呈现方式必须结构化**：`presentation_type`、标准施测指令、素材绑定和界面配置进入 `content_json.presentation`，不新增 schema 列。
46. **支持等级与合理便利分离**：P0/P1/P2/P3 表示提示等级；AAC、触控笔、助听或视觉辅具等记录为 accommodations，不得自动等同扣分。
47. **NR/ST 不得伪装成 0 分**：题目不适用、安全停止、技术中断、P3 直接协助完成时，题目记录 `response_status` 且 `score = NULL`；若最终形成未完成测评，则按 v1.0.6 中途终止规则生成过程分，但不得输出安置建议。
48. **线上最终分仍为 0/2**：复杂软件任务可以记录部分完成、错误类型和过程指标，但正式线上成绩仍只输出 0 或 2；不得重新引入线上 1 分。
49. **正确答案单一事实源**：正确答案、阈值、必要事件和判分逻辑统一写入 `scoring_rule_json`；`content_json` 不再重复保存 `expected_answer`。
50. **证据类型和效度边界必须入库**：软件行为、情境判断、直接动作、自我报告、嵌入观察必须分开解释，报告不得把软件触控表现外推为真实动作能力。
51. **行为日志分层**：评分可复现所需的最终答案、聚合指标和支持信息进入 `answer_record.answer_payload_json`；高频原始 pointer move、逐帧触控和原始音频不进入 `domain_event_projection`，列为 Post-MVP 分析数据。
52. **素材不可原地覆盖**：题目冻结后，其引用的素材内容也必须可复现。已被 ACTIVE 或历史题目引用的 asset 不得用同一 `asset_id` 覆盖文件；素材修改必须创建新 asset ID 和新题目版本。
53. **组卷策略不再固定 14/14/14**：`question_policy_json` 只固定每模块 7 道线上题和线下总数 8，不再强制判断、单选、拖拽各 14 道。
54. **试测策略关闭安置建议**：候选题未完成内容效度复核、可用性测试和小样本试测前，`placement_advice_enabled = false`。
55. **报告增加证据和施测条件区块**：报告必须展示证据类型、支持等级、合理便利、NR/ST、技术中断、效度边界和行为观察，不能只展示模块分数。
56. **ACTIVE 门禁增加实现状态**：题目只有在内容、评分、素材、专业确认和 `interaction_type` renderer 均通过时才可转 ACTIVE。

### 0.4 本轮 Codex 交付边界

本轮必须完成：

- PRD 和 JSON 数据合同更新。
- `schema.sql v0.1.11-question-contract-closure` 全量初始化基线。
- TypeScript 类型与运行时 validator。
- 题库导入 dry-run 和审核门禁。
- 新题库字段映射。
- 最小交互 renderer 注册表和 ACTIVE 可用性检查。
- 行为日志、评分和报告 JSON 合同。

本轮不做：

- 完整题库管理后台。
- 可视化题目编辑器或分支流程设计器。
- 正式试卷表、自定义组卷和固定结业卷后台。
- 原始触控轨迹分析平台。
- 语音 NLP 自动评分。
- 摄像头、眼动、姿态识别。
- ORM、CSV 解析库、Markdown 报告渲染库。

---

## 2.4 题量规格口径（全文替换）

基础能力评估采用：

- 线上固定 42 道计分题，6 个模块每模块 7 道，每题自动判分 `0 / 2`，线上小计 84 分。
- 线下固定 8 道计分题，每题教师评分 `0 / 1 / 2`，线下小计 16 分。
- 总计 50 道计分题，满分 100。
- `OBSERVATION_ONLY` 条目不计入 42+8，不进入 `completion_ratio` 分母，不产生独立题目分数。
- 线上允许的数据库级题型为 `TRUE_FALSE / SINGLE_CHOICE / DRAG / SOFTWARE_TASK`。
- 线下题型为 `OFFLINE_OPERATION`。
- 题型数量不按 14/14/14 固定分配；组卷仅固定模块配额、线上/线下总量、可用状态和策略版本。
- 每个模块 7 道线上题的交互类型应具备合理多样性，但 MVP 不设置数据库级硬配额。
- 任何未实现 renderer 的 `interaction_type` 不得计入 ACTIVE 可组卷题量。
- 模块级一票否决继续只按线上模块得分率计算，分母恒为 14。

历史口径废止：

- 废止“线上题仅由判断、单选、拖拽组成”的表述。
- 废止 `question_policy_json.question_ratio = 14/14/14/8` 的种子策略。
- 保留线上 0/2、线下 0/1/2、42+8、满分 100 的 v1.0.6 规则。

---

## 5.3 题库与资源（全文替换）

### 5.3.1 数据库级 question_type

MVP 支持五类 `question_type`：

| question_type | 用途 | 评分方式 |
|---|---|---|
| `TRUE_FALSE` | 二元判断 | 自动 0/2 |
| `SINGLE_CHOICE` | 单一答案选择 | 自动 0/2 |
| `DRAG` | 简单拖拽匹配、分类和排序 | 自动 0/2 |
| `SOFTWARE_TASK` | 多选、轨迹、计时、序列、分支和复杂软件模拟 | 自动 0/2 |
| `OFFLINE_OPERATION` | 必要实物操作或教师现场观察 | 教师 0/1/2 |

`question_type` 不承担具体界面组件选择。具体交互由 `content_json.interaction.interaction_type` 决定。

### 5.3.2 item_usage

`question_bank.item_usage` 为 schema 表字段，MVP 只允许：

- `SCORED_ITEM`：可进入 42+8 组卷、产生答题或线下评分记录。
- `OBSERVATION_ONLY`：从其他任务事件派生观察指标，不进入组卷、分数、题量和完成率。

Post-MVP 可扩展 `TRAINING_ONLY / FINAL_EXAM_ONLY / PRACTICE_VARIANT`，本轮不得预先实现完整用途体系。

### 5.3.3 interaction_type

`interaction_type` 进入 `question_bank.content_json`，不新增 schema 列。

MVP 数据合同枚举：

| interaction_type | 适用题型 | answer_shape | 自动评分 |
|---|---|---|---|
| `BINARY_SELECT` | TRUE_FALSE | `{ selected: boolean }` | 精确匹配 |
| `SINGLE_SELECT` | SINGLE_CHOICE | `{ selected_option_id: string }` | 精确匹配 |
| `MULTI_SELECT` | SOFTWARE_TASK | `{ selected_option_ids: string[] }` | 集合匹配/阈值 |
| `DRAG_DROP` | DRAG | `{ placements: [{ item_id, zone_id }] }` | 映射匹配 |
| `ORDERING` | DRAG | `{ ordered_item_ids: string[] }` | 顺序匹配 |
| `GESTURE_TASK` | SOFTWARE_TASK | `{ outcome, metrics }` | 指标阈值 |
| `TIMED_TASK` | SOFTWARE_TASK | `{ actions, metrics, final_state }` | 时间/事件阈值 |
| `TASK_SEQUENCE` | SOFTWARE_TASK | `{ completed_steps, step_order, metrics }` | 必要步骤和顺序 |
| `BRANCHING_TASK` | SOFTWARE_TASK | `{ path, messages, final_state }` | 必要节点/事件/终态 |
| `OFFLINE_RUBRIC` | OFFLINE_OPERATION | 不写 answer_record；教师评分 | 不自动评分 |
| `SYSTEM_DERIVED_OBSERVATION` | OBSERVATION_ONLY | 从事件派生 | 不计分 |

`GESTURE_TASK` 的 subtype 至少允许：

- `TRACE_PATH`
- `PRECISION_PLACEMENT`
- `CONTINUOUS_SLIDE`
- `MULTI_TOUCH_HOLD_DRAG`

`BRANCHING_TASK` 的 subtype 至少允许：

- `CLARIFICATION_REQUEST`
- `HELP_REQUEST`
- `STATUS_REPORT`
- `BREAK_NOTIFICATION`
- `SAFETY_RESPONSE`
- `FUNCTIONAL_COMMUNICATION`

`TIMED_TASK` 的 subtype 至少允许：

- `DELAYED_RESPONSE`
- `WAIT_AND_ACT`
- `SUSTAINED_ACTIVITY`
- `STOP_SIGNAL`

未列入的 subtype 可以在 `content_json` validator 中按 interaction_type 分支扩展，但不得使用任意字符串绕过校验。

### 5.3.4 presentation_type

`presentation_type` 进入 `content_json.presentation`，不新增 schema 列。

MVP 枚举：

- `TEXT_ONLY`
- `IMAGE_CARD`
- `AUDIO_PROMPT`
- `IMAGE_AUDIO`
- `INTERACTIVE_SCENE`
- `OFFLINE_MATERIAL`
- `SYSTEM_OBSERVATION`

`presentation_type` 只描述刺激呈现方式，不决定评分。

### 5.3.5 content_json 推荐合同

所有题目必须包含：

```json
{
  "schema_version": "question-content-v1.1",
  "question_type": "SOFTWARE_TASK",
  "sub_module": "不清楚时澄清",
  "target_construct": "在指令信息不完整时暂停执行并请求澄清",
  "presentation": {
    "presentation_type": "INTERACTIVE_SCENE",
    "prompt": "指令不清楚时，请用你能用的方式问清楚。",
    "standard_instruction": "请先听指令，再决定怎么做。",
    "instruction_repeat_limit": 1,
    "assets": [
      {
        "asset_key": "scene_background",
        "asset_id": "AST_BASE_RULE_009_SCENE_01_V1",
        "role": "SCENE_IMAGE",
        "required": true,
        "alt_text": "工作台与两个可能的放置区域"
      }
    ]
  },
  "interaction": {
    "interaction_type": "BRANCHING_TASK",
    "interaction_subtype": "CLARIFICATION_REQUEST",
    "config": {}
  },
  "expected_evidence": {
    "primary_evidence_type": "SOFTWARE_BEHAVIOR",
    "secondary_evidence_types": [],
    "observable_indicators": [
      "识别指令信息不完整",
      "未直接错误执行",
      "发出与缺失信息相关的澄清请求"
    ],
    "validity_boundary": "选择消息卡降低自主语言生成要求，报告须注明实际沟通方式。"
  },
  "support_policy": {
    "allowed_prompt_levels": ["P0", "P1"],
    "max_prompt_level_for_valid_score": "P1",
    "allowed_accommodations": [
      "AAC",
      "TOUCH_PEN",
      "VISUAL_AID",
      "HEARING_AID",
      "NON_KEY_FONT_SIZE_ADJUSTMENT",
      "NON_KEY_VOLUME_ADJUSTMENT"
    ],
    "prohibited_support": [
      "KEY_ANSWER_HINT",
      "DIRECT_ACTION_COMPLETION",
      "HAND_OVER_HAND_ASSISTANCE"
    ]
  },
  "termination_policy": {
    "allow_pause_on_distress": true,
    "technical_failure_is_not_zero": true,
    "safety_stop_codes": []
  },
  "log_metrics": [
    "first_action_latency_ms",
    "wrong_execution_count",
    "clarification_requested",
    "message_action_id",
    "completion_time_ms"
  ],
  "variant_group_id": null,
  "professional_review": {
    "required": false,
    "review_type": null,
    "status": "NOT_REQUIRED",
    "reviewed_by": null,
    "reviewed_at": null
  },
  "source": {
    "import_batch_id": "BATCH_202607_V02",
    "source_file": "通用基础能力正式测评候选题库_v0.2.csv",
    "source_sheet": "正式测评候选题库",
    "source_row": 47,
    "origin_refs": ["RULE-R122", "RULE-R125"],
    "transformation": "模糊指令角色任务数字化",
    "candidate_status": "PENDING_CONTENT_VALIDATION",
    "imported_at": "2026-07-07T00:00:00Z",
    "imported_by": "ADMIN_ID"
  },
  "note": null
}
```

#### 必填字段

- `schema_version`
- `question_type`
- `sub_module`
- `target_construct`
- `presentation.presentation_type`
- `presentation.prompt`
- `presentation.standard_instruction`
- `interaction.interaction_type`
- `interaction.config`
- `expected_evidence.primary_evidence_type`
- `expected_evidence.observable_indicators`
- `expected_evidence.validity_boundary`
- `support_policy.allowed_prompt_levels`
- `support_policy.allowed_accommodations`
- `termination_policy`
- `source`

#### 条件必填字段

- 有素材时：`presentation.assets`
- `SOFTWARE_TASK`：`log_metrics`
- 安全、PPE、授权工具和应急流程题：`professional_review.required = true`
- 平行题/档位题：`variant_group_id`
- `OFFLINE_OPERATION`：`offline_tool_brief`、标准材料规格、终止条件
- `OBSERVATION_ONLY`：`interaction_type = SYSTEM_DERIVED_OBSERVATION`

#### MVP 不新增的字段

- `parent_item_id`
- `scoring_rule_id`
- 公共 rubric 表外键
- 试卷 ID
- 题目编辑历史表

上述内容进入 Post-MVP 正式试卷或题库运营模型。

### 5.3.6 字段落点总表

| 字段/概念 | MVP 落点 | 说明 |
|---|---|---|
| `question_id` | `question_bank` 表字段 | 唯一题目 ID；content_json 不重复 |
| `parent_item_id` | Post-MVP | testlet/复合题再引入 |
| `item_usage` | `question_bank` 表字段 | 组卷与计分必须 SQL 可过滤 |
| `module` | `question_bank.module_type` | 保持现有表字段 |
| `sub_module` | `content_json` | 不作为高频 SQL 过滤条件 |
| `target_construct` | `content_json` | 题目效度合同 |
| `question_type` | `question_bank` + content_json discriminator | 两者必须一致 |
| `interaction_type` | `content_json` | renderer 和 answer shape |
| `presentation_type` | `content_json` | 呈现方式 |
| `correct_answer` / `expected_answer` | `scoring_rule_json` | 唯一事实源 |
| `scoring_rule_id` | Post-MVP | MVP 使用内嵌 JSON |
| `scoring_rule_json` | 现有表字段 | 判分合同 |
| `support_level_allowed` | `content_json.support_policy.allowed_prompt_levels` | 不新增表字段 |
| accommodations | `content_json.support_policy` + answer payload | 允许项和实际使用分开 |
| assets | 主素材列 + `content_json.presentation.assets` | 不存本地绝对路径 |
| `log_metrics` | `content_json` | 声明允许/要求记录的指标 |
| `difficulty` | `question_bank.difficulty_level` | 不在 JSON 重复 |
| `safety_critical` | 继续使用 `safety_sensitive` | 不新增同义字段 |
| `sensory_tags` | `question_bank.sensory_tags_json` | 继续使用现有列 |
| evidence type | `content_json.expected_evidence` | 报告按证据类型分组 |
| validity boundary | `content_json.expected_evidence` | 报告必须显示 |
| source | `content_json.source` | 保留源文件、行号、原始引用和调整方式 |
| professional review | `content_json.professional_review` | ACTIVE 门禁校验 |

### 5.3.7 scoring_rule_json（全文新增）

正确答案和判分条件统一进入 `scoring_rule_json`。

MVP `scoring_type`：

- `EXACT_MATCH`
- `SET_MATCH`
- `MAPPING_MATCH`
- `ORDER_MATCH`
- `METRIC_THRESHOLD`
- `EVENT_RULE`
- `OFFLINE_RUBRIC`
- `NO_SCORE`

线上规则必须包含：

```json
{
  "schema_version": "scoring-rule-v1.1",
  "scoring_type": "METRIC_THRESHOLD",
  "scoring_mode": "AUTOMATIC",
  "criteria_logic": "ALL",
  "criteria": [
    { "metric": "correct_count", "operator": "GTE", "value": 10 },
    { "metric": "random_touch_count", "operator": "LTE", "value": 1 }
  ],
  "pass_score": 2,
  "fail_score": 0,
  "scoring_engine_version": "1.0.0"
}
```

约束：

1. 线上 `pass_score` 固定 2，`fail_score` 固定 0。
2. 禁止 `partial_score = 1`。
3. 禁止在 JSON 中存储或执行任意 JavaScript 表达式。
4. `operator` 只能来自 validator 白名单：`EQ / NE / GT / GTE / LT / LTE / IN / NOT_IN`。
5. 集合题、映射题、顺序题必须保存正式 expected answer。
6. `NO_SCORE` 仅允许 `item_usage = OBSERVATION_ONLY`。
7. `OFFLINE_RUBRIC` 保留 0/1/2 三档描述。
8. 评分器必须把 `scoring_engine_version` 写入答题和结果快照。

### 5.3.8 素材资产结构与命名规范（全文新增）

#### 资源职责

- `asset_resource`：物理文件完整性、URI、hash、大小、尺寸、时长和状态。
- `question_bank.media_asset_id`：题目的主刺激或预览素材，只允许一个。
- `content_json.presentation.assets[]`：选项图、拖拽子素材、场景图、语音指令等多素材绑定。
- `tool_asset_ids_json`：只用于线下教具清单、材料模板或说明 PDF，不承载线上选项图片。

#### assets[] 最小字段

- `asset_key`：题内稳定键。
- `asset_id`：指向 `asset_resource.asset_id`。
- `role`：语义角色。
- `required`：资源缺失时是否阻断题目。
- `alt_text`：无障碍和审核说明。
- `sort_order`：需要稳定顺序时填写。

MVP role 枚举：

- `SCENE_IMAGE`
- `PRIMARY_STIMULUS`
- `OPTION_IMAGE`
- `DRAG_ITEM_IMAGE`
- `DROP_ZONE_IMAGE`
- `BACKGROUND_IMAGE`
- `VOICE_PROMPT`
- `INSTRUCTION_AUDIO`
- `OFFLINE_TOOL_GUIDE`
- `REFERENCE_TEMPLATE`

#### asset_id 命名

```text
AST_{DOMAIN}_{MODULE}_{ITEM_NO}_{ROLE}_{SEQ}_V{N}
```

示例：

```text
AST_BASE_COG_013_SCENE_01_V1
AST_BASE_COG_013_OPTION_01_V1
AST_BASE_RULE_009_VOICE_01_V1
AST_BASE_FM_004_TOOL_GUIDE_01_V1
```

文件名建议：

```text
ast-base-cog-013-option-01-v1.webp
ast-base-rule-009-voice-01-v1.ogg
```

强制规则：

1. renderer 统一通过 `app://asset/<asset_id>` 读取。
2. 题目 JSON 不得保存绝对路径或 `AIimages/` 工作目录路径。
3. 已被 ACTIVE 或历史题目引用的素材不得覆盖同一 asset ID 的文件内容。
4. 图片重绘、裁切、文字修改、答案语义变化均创建新 asset ID。
5. 题目改用新 asset 时，按题目作废重建机制创建新 question ID。
6. ACTIVE 门禁扫描 content_json 中全部 asset_id，验证存在、状态 ACTIVE、hash 一致。
7. 生图提示词、模型参数和制作过程可保存在素材制作清单中；本轮不新增资产生成历史表。

---

## 5.3.9 新题库 CSV 字段映射（新增，覆盖旧映射表）

| 源字段 | 入库目标 |
|---|---|
| 题目ID | `question_bank.question_id` |
| 模块 | `question_bank.module_type` |
| 子维度 | `content_json.sub_module` |
| 呈现方式 | `content_json.presentation.presentation_type` |
| 交互类型 | `content_json.interaction.interaction_type/subtype` |
| 数字化等级 | `source.digitalization_level` |
| 预期难度 | `question_bank.difficulty_level` |
| 目标构念 | `content_json.target_construct` |
| 测评任务 | `presentation.prompt` 与 interaction config |
| 软件界面/标准材料 | assets / offline material config |
| 标准施测指令 | `presentation.standard_instruction` |
| 达标行为/正确反应 | `expected_evidence.observable_indicators` + scoring rule |
| 核心评分点 | `scoring_rule_json.criteria` |
| 允许的标准支持 | `content_json.support_policy` |
| 终止/安全条件 | `content_json.termination_policy` |
| 系统记录指标 | `content_json.log_metrics` |
| 证据类型 | `expected_evidence.primary/secondary_evidence_types` |
| 效度边界 | `expected_evidence.validity_boundary` |
| 来源追溯 | `content_json.source.origin_refs` |
| 调整方式 | `content_json.source.transformation` |
| 需专业确认 | `content_json.professional_review` |
| 候选状态 | `content_json.source.candidate_status`；question_bank 仍为 DRAFT |
| 备注 | `content_json.note` |

导入特殊规则：

- 跨任务系统观察项导入为 `item_usage = OBSERVATION_ONLY`、`scoring_type = NO_SCORE`。
- 无法识别 interaction_type 的行导入失败或保持 DRAFT，不得猜测映射。
- 需专业确认且未确认的题保持 DRAFT。
- 素材缺失、判分规则不完整、renderer 未实现的题保持 DRAFT。
- 导入脚本不得自动生成缺失题目、答案或素材。

---

## 5.4 测评功能（增补）

### 5.4.1 response_status

`answer_record` 和 `offline_score_record` 必须支持以下题目级响应状态：

- `ANSWERED`：已形成有效答案或教师评分。
- `NOT_APPLICABLE`：因运动、视觉、听觉或沟通条件，该题不适用/未施测。
- `STOPPED_SAFETY`：题目执行中因疼痛、疲劳或具体安全风险停止。
- `TECHNICAL_INTERRUPTION`：设备、素材或输入故障导致无法完成。
- `ASSISTED_NOT_SCORED`：P3 直接答案提示、代操作或手把手协助后完成，仅保留过程记录。

规则：

1. `ANSWERED` 时线上 score 只能为 0/2，线下 score 只能为 0/1/2。
2. 其他状态下 `score = NULL`、`is_correct = NULL`。
3. `STOPPED_SAFETY` 不自动等于 `safety_incident`；只有实际出现安全红线行为时才进入安全事件流程。
4. `TECHNICAL_INTERRUPTION` 不得记 0 分。
5. 存在预先批准的同构替代题时，替代必须在 session 组卷时完成；同一 session 内不临场换题。
6. session 最终存在未评分项目时，`completion_ratio < 1`，报告不得输出就业安置方向。

### 5.4.2 支持等级

提示等级：

| 等级 | 定义 | 计分规则 |
|---|---|---|
| P0 | 标准指令，无额外提示 | 可自动评分 |
| P1 | 按规则完整重复一次，或非答案性澄清 | 题目允许时可评分 |
| P2 | 提供过程性提示，但不直接给答案 | 由题目规则决定，默认教师复核 |
| P3 | 直接答案提示、代操作或手把手协助 | `ASSISTED_NOT_SCORED` |

合理便利 accommodations 单独记录，包括但不限于：

- AAC
- TOUCH_PEN
- VISUAL_AID
- HEARING_AID
- DAILY_ASSISTIVE_DEVICE
- NON_KEY_FONT_SIZE_ADJUSTMENT
- NON_KEY_VOLUME_ADJUSTMENT
- APPROVED_REST_BREAK

合理便利本身不自动扣分。只有当便利改变目标构念或违反题目 `support_policy` 时，才影响有效性。

### 5.4.3 题目提交和自动评分

1. renderer 根据 `question_type + interaction_type` 选择组件。
2. renderer 只提交结构化 response 和 metrics，不自行决定等级。
3. 主进程 validator 校验 answer shape。
4. 主进程评分器根据冻结的 `scoring_rule_json` 产生 0/2 或不计分状态。
5. 写入 `action_log.jsonl` 后投影到 `answer_record`。
6. `answer_payload_json.scoring_snapshot` 必须保存评分器版本、通过结果和失败条件，保证历史复核。

---

## 5.8 任务报告（增补）

### 5.8.1 report_content_json v1.1

`task_report.report_content_json` 必须符合以下顶层结构：

```json
{
  "report_schema_version": "task-report-v1.1",
  "assessment_meta": {},
  "score_summary": {},
  "module_profiles": [],
  "evidence_summary": {},
  "support_summary": {},
  "administration_status": {},
  "behavior_observations": [],
  "validity_limitations": [],
  "safety_summary": {},
  "placement_advice": {}
}
```

#### assessment_meta

至少包含：

- session_id
- strategy_id / strategy_version
- question bank import batch
- scoring engine version
- content/scoring/report schema version
- sitting count 和每坐次时间
- completion_ratio
- 题目档位/variant 说明

#### score_summary

至少包含：

- raw_score
- max_score
- normalized_score
- level_result
- module_veto_triggered
- emotion_collapse_triggered
- safety_overridden

#### module_profiles

每模块至少包含：

- online_raw_score / 14
- online_score_rate
- 线下题表现摘要（只展示，不参与模块否决）
- response_status 分布
- 主要观察指标

#### evidence_summary

按以下证据类型分组：

- `SOFTWARE_BEHAVIOR`
- `SITUATIONAL_JUDGMENT`
- `DIRECT_PERFORMANCE`
- `SELF_REPORT`
- `SELF_REPORT_PLUS_BEHAVIOR`
- `EMBEDDED_OBSERVATION`

不得把不同证据类型合并成同义能力结论。

#### support_summary

至少包含：

- P0/P1/P2/P3 使用次数
- accommodations_used
- 指令重播次数
- 有效性受影响的题目

#### administration_status

至少包含：

- NOT_APPLICABLE 项目
- STOPPED_SAFETY 项目
- TECHNICAL_INTERRUPTION 项目
- ASSISTED_NOT_SCORED 项目
- 未完成项目
- 资源或设备异常

#### behavior_observations

只展示有解释价值的聚合指标，不展示原始 pointer trace。至少可承载：

- 自我纠正
- 求助/澄清/报告
- 休息请求
- 恢复与交接
- 持续参与
- 错误类型

#### validity_limitations

必须从题目 `expected_evidence.validity_boundary` 聚合生成，包括但不限于：

- 触控表现不等于真实手部力量或阻力控制。
- 图片判断不等于真实岗位操作达标。
- AAC 消息卡降低自主语言生成要求。
- 音频任务同时受听觉和语言理解影响。

#### placement_advice

试测策略默认：

```json
{
  "enabled": false,
  "reason_disabled": "PILOT_QUESTION_BANK_NOT_VALIDATED",
  "recommendation": null,
  "reviewed_by": null,
  "reviewed_at": null
}
```

完成内容效度复核、可用性测试和小样本试测后，必须通过新增 strategy version 启用，不得修改历史策略。

### 5.8.2 报告解释约束

1. 软件精细动作只能解释为触控、视觉动作整合和界面操作表现。
2. 安全选择或流程题只能解释为风险识别和流程判断证据。
3. 直接动作表现必须来自 OFFLINE_OPERATION。
4. OBSERVATION_ONLY 不进入总分。
5. 反应时间、速度、帮助次数和休息请求不得单独解释为能力高低。
6. NR/ST 不显示为答错。

---

## 7.2 统一百分制模型（增补）

### 7.2.2 题目级不计分状态与结果投影

1. item-level `score = NULL` 不等于 0 分。
2. 若 session 最终因 NR/ST/技术中断存在未完成项目，结果投影仍保持 `max_score = 100`，未形成有效分数的项目在过程分计算中按 0 占位，但必须同时：
   - `completion_ratio < 1`；
   - 标记 `incomplete_reason`；
   - 不进入安置方向；
   - 不进入完整测评趋势比较。
3. 报告必须显示“过程分”而非“完整能力结论”。
4. OBSERVATION_ONLY 不在分母 50 内。
5. 线上部分完成指标只用于判断 pass/fail 和行为分析，不产生 1 分。

---

## 7.6 策略配置版本锁定（增补）

### 7.6.1 question_policy_json v1.1

废止固定题型数量：

```json
{
  "question_ratio": {
    "TRUE_FALSE": 14,
    "SINGLE_CHOICE": 14,
    "DRAG": 14,
    "OFFLINE_OPERATION": 8
  }
}
```

改为：

```json
{
  "schema_version": "question-policy-v1.1",
  "module_scope": "CROSS_MODULE",
  "online_quota_by_module": {
    "FINE_MOTOR": 7,
    "COGNITION": 7,
    "RULE_EXECUTION": 7,
    "EMOTION_REGULATION": 7,
    "BASIC_SOCIAL": 7,
    "SAFETY_OPERATION": 7
  },
  "offline_total": 8,
  "eligible_item_usage": ["SCORED_ITEM"],
  "allowed_question_types": [
    "TRUE_FALSE",
    "SINGLE_CHOICE",
    "DRAG",
    "SOFTWARE_TASK",
    "OFFLINE_OPERATION"
  ],
  "unsupported_interaction_policy": "BLOCK",
  "sensory_filter_mode": "SOFT",
  "fallback_strategy": "BLOCK"
}
```

renderer 支持情况来自应用内 interaction registry，不写入策略版本。组卷门禁必须同时检查题目 interaction_type 是否已注册和启用。

### 7.6.2 scoring_policy_json v1.1

基础能力测评策略：

```json
{
  "schema_version": "scoring-policy-v1.1",
  "online_score_values": [0, 2],
  "offline_score_values": [0, 1, 2],
  "normalization": "raw_score/max_score*100",
  "safety_override_enabled": true,
  "placement_advice_enabled": false,
  "pilot_mode": true
}
```

规则：

- `competent_threshold / conditional_threshold / module_veto_threshold / emotion_collapse_threshold` 继续以 `strategy_config` 表字段为唯一事实源。
- `scoring_policy_json.level_rules` 自本版起废止，避免与表字段重复。
- 训练策略的 scoring policy 可维持独立结构，不强制套用基础能力测评字段。

---

## 8.7 领域事件类型（增补）

新增或标准化以下事件：

- `QUESTION_PRESENTED`
- `QUESTION_RESPONSE_SUBMITTED`
- `QUESTION_RESPONSE_NOT_SCORED`
- `QUESTION_SUPPORT_RECORDED`
- `OBSERVATION_METRIC_DERIVED`
- `QUESTION_ASSET_VALIDATION_FAILED`

### 8.7.1 QUESTION_RESPONSE_SUBMITTED payload 最小合同

```json
{
  "schema_version": "question-response-event-v1.1",
  "session_id": "AS_001",
  "session_question_id": "SQ_001",
  "question_id": "GA-RULE-009",
  "question_type": "SOFTWARE_TASK",
  "interaction_type": "BRANCHING_TASK",
  "response_status": "ANSWERED",
  "response": {},
  "metrics": {},
  "support": {
    "prompt_level": "P1",
    "accommodations_used": ["AAC"],
    "instruction_replay_count": 1
  },
  "timing": {
    "presented_at": "...",
    "first_action_at": "...",
    "submitted_at": "...",
    "first_action_latency_ms": 3000,
    "total_duration_ms": 15000
  },
  "scoring_snapshot": {
    "scoring_engine_version": "1.0.0",
    "passed": true,
    "score": 2,
    "failed_criteria": []
  }
}
```

### 8.7.2 QUESTION_RESPONSE_NOT_SCORED payload

必须包含：

- response_status
- reason_code
- teacher_confirmed_by（需要教师判断时）
- support
- timing
- completed_steps / retained_metrics
- 是否触发 session 暂停或终止

### 8.7.3 行为事件边界

以下内容不得逐条写入 `domain_event_projection`：

- 每个 pointer move
- 每个轨迹采样点
- 每帧多点触控状态
- hover 数据
- 原始音频和语音识别中间结果

MVP 只在 answer payload 保存评分所需的聚合指标和必要轨迹摘要。高频原始数据列入 Post-MVP 分析数据方案。

---

## 11.12 schema.sql v0.1.11-question-contract-closure（新增）

Codex 必须基于 v0.1.10 生成新的全量初始化 schema，不做原地 migration。

### 11.12.1 question_bank

必须修改：

1. `status DEFAULT 'DRAFT'`，修复当前默认 ACTIVE 与导入规则冲突。
2. `question_type` CHECK 增加 `SOFTWARE_TASK`。
3. 新增：

```sql
item_usage TEXT NOT NULL DEFAULT 'SCORED_ITEM'
CHECK (item_usage IN ('SCORED_ITEM', 'OBSERVATION_ONLY'))
```

4. 冻结字段增加：
   - `job_code`
   - `item_usage`
   - `safety_sensitive`
   - `sensory_tags_json`
   - `media_asset_id`
   - `tool_asset_ids_json`
5. 题目一旦被 `assessment_session_question` 或有效答题/评分引用，上述字段、module、question_type、difficulty、content_json、scoring_rule_json 均不得原地修改。
6. `superseded_by_question_id IS NOT NULL` 时旧题必须为 ARCHIVED，作废重建必须同一事务完成。

### 11.12.2 assessment_session_question

必须修改：

- question_type CHECK 增加 SOFTWARE_TASK。
- INSERT 时校验 question_bank：
  - status = ACTIVE
  - item_usage = SCORED_ITEM
  - job_code 与 session 一致
  - module_type / question_type 与 question_bank 一致
  - OFFLINE_OPERATION 只能 phase=OFFLINE
  - 其他 question_type 只能 phase=ONLINE
- OBSERVATION_ONLY 不得进入该表。

### 11.12.3 answer_record

必须修改：

- question_type CHECK 增加 SOFTWARE_TASK。
- 新增 `response_status`。
- `score` 改为可空。
- CHECK：
  - ANSWERED → score IN (0,2)，is_correct IN (0,1)
  - 非 ANSWERED → score IS NULL，is_correct IS NULL
- schema trigger 或复合校验：`session_id + question_id` 必须存在于 assessment_session_question 且 phase=ONLINE，question_type 一致。

### 11.12.4 offline_score_record

必须修改：

- 新增与 answer_record 相同的 `response_status`。
- score 改为可空。
- ANSWERED → score IN (0,1,2)。
- 非 ANSWERED → score IS NULL。
- OFFLINE_ABILITY 的 question_id 必须属于该 session、phase=OFFLINE、question_type=OFFLINE_OPERATION、item_usage=SCORED_ITEM。
- TASK_OPERATION 继续按 task_operation_code 分流。

### 11.12.5 asset_resource

不新增完整素材版本表，但必须增加业务约束：

- 已被 ACTIVE 题目或历史 session 引用的 asset，其 `file_hash / local_path / app_uri` 不得原地修改为另一文件。
- 素材修订创建新 asset_id。
- schema 注释和文档 URI 统一为 `app://asset/<asset_id>`。

如 SQLite trigger 无法可靠扫描 content_json 内嵌 asset ID，则至少：

- 对 `question_bank.media_asset_id` 实施 schema trigger；
- 对 content_json 内嵌 asset 由 validator + 审核门禁 + 资源替换领域服务保证；
- 不得声称数据库已对内嵌 JSON 引用实现完整外键。

### 11.12.6 result_record / task_report

不新增报告 section 表。

- `result_payload_json` 使用 `result-payload-v1.1` 合同。
- `report_content_json` 使用 `task-report-v1.1` 合同。
- ABILITY_SCORE 必须写 completion_ratio。
- 试测策略 placement_advice_enabled=false 时，不允许生成安置建议内容。

---

## 16.6 行为日志最小字段集（新增）

### 16.6.1 通用字段

进入 `answer_record.answer_payload_json`：

- schema_version
- session_question_id
- question_id
- question_type
- interaction_type / subtype
- response_status
- attempt_no / revision_no
- presented_at
- first_action_at
- submitted_at
- first_action_latency_ms
- total_duration_ms
- prompt_level
- accommodations_used
- instruction_replay_count
- input_method
- response
- metrics
- scoring_snapshot

### 16.6.2 点击/选择题

最小字段：

- selected_option_ids
- selection_sequence
- deselected_option_ids
- change_count
- premature_action_count
- first_selection_latency_ms

### 16.6.3 拖拽/排序题

最小字段：

- placements / ordered_item_ids
- item_id / zone_id
- attempt_count
- drop_accepted
- start_x / start_y / end_x / end_y（0～1 归一化）
- wrong_zone_count
- correction_count
- unplaced_item_ids
- total_duration_ms

MVP 不要求保存每个 pointer move。

### 16.6.4 GESTURE_TASK

按 subtype 保存评分所需聚合：

- average_deviation
- max_deviation
- boundary_cross_count
- lift_count
- fixed_touch_break_count
- successful_target_count
- retry_count
- input_method

### 16.6.5 TIMED_TASK

- planned_duration_ms
- active_duration_ms
- idle_duration_ms
- completed_count
- correct_count
- error_count
- rest_requested
- premature_action_count
- early_exit

### 16.6.6 TASK_SEQUENCE / BRANCHING_TASK

- completed_steps
- step_order
- omitted_steps
- wrong_order_count
- path `{node_id, action_id, offset_ms}[]`
- message_action_ids
- recipient_id
- final_state
- help_requested / clarification_requested / status_reported

### 16.6.7 不得直接等同成绩的指标

除非具体 scoring_rule 明确把该指标定义为目标构念和通过阈值，否则下列指标只能作为行为证据：

- 反应时间和总用时
- 拖拽速度和轨迹长度
- 修改次数、重试次数、自我纠正
- 指令重播次数
- 求助、澄清、休息请求次数
- 情绪恢复时间
- 沟通方式
- AAC、触控笔或其他合理便利使用
- 惯用手
- 空闲时长
- 行为外显程度

禁止用“速度慢”“请求休息”“使用 AAC”“没有眼神接触”等单一指标直接判低分。

---

## 17.9 v1.0.7 题库数据合同专项验收（新增）

### schema 与题库

1. 新导入 question_bank 默认 DRAFT。
2. question_type 可写 SOFTWARE_TASK，其他非法值失败。
3. item_usage 只允许 SCORED_ITEM / OBSERVATION_ONLY。
4. OBSERVATION_ONLY 不得写入 assessment_session_question。
5. OBSERVATION_ONLY 不得生成独立 answer_record、offline_score_record 或分数。
6. 96 个源条目 dry-run 必须识别 87 纯软件、1 嵌入观察、8 必要实物；不得把观察项算入 42+8。
7. 已选入 session 的题目修改语义字段应失败。
8. 已引用主素材不得覆盖为不同 hash 的文件。

### interaction 与 validator

9. 每道 ACTIVE 题必须有合法 presentation_type 和 interaction_type。
10. question_type 与 content_json.question_type 不一致时不得转 ACTIVE。
11. interaction_type 与 answer shape 不匹配时提交失败。
12. 未在 renderer registry 注册的 interaction_type 不得转 ACTIVE。
13. MULTI_SELECT 能保存多个 option ID 并按集合规则判分。
14. ORDERING 能保存稳定顺序并按 order rule 判分。
15. GESTURE/TIMED/BRANCHING 至少各有一条合法和非法 fixture 测试。
16. 线上所有评分路径只产生 0 或 2，不产生 1。

### support 与 response status

17. prompt_level 与 accommodations 分开记录。
18. 使用 AAC、触控笔或日常辅具不自动扣分。
19. NOT_APPLICABLE / STOPPED_SAFETY / TECHNICAL_INTERRUPTION / ASSISTED_NOT_SCORED 时 score 必须为 NULL。
20. 技术故障不得记 0 分。
21. P3 直接协助完成必须为 ASSISTED_NOT_SCORED。
22. response_status 非 ANSWERED 时 completion_ratio 和报告状态正确。

### 行为日志与评分

23. answer_payload 包含 scoring_engine_version 和 failed_criteria。
24. 评分器可仅依据冻结题目、scoring_rule_json 和 answer_payload 复算原分数。
25. 未在 content_json.log_metrics 声明的非通用指标不得随意写入报告结论。
26. pointer move 不逐条进入 domain_event_projection。
27. 反应时间、帮助次数和休息请求不直接等同成绩。

### 素材

28. 所有必需 asset_id 存在、ACTIVE、hash 正确后题目才可转 ACTIVE。
29. renderer 统一通过 app://asset/<asset_id> 加载。
30. 题目 JSON 不得包含本地绝对路径。
31. 修改图片内容需创建新 asset_id；修改题目引用需创建新 question_id。

### 报告

32. report_content_json 符合 task-report-v1.1。
33. 报告按 evidence type 分组。
34. 报告展示支持等级、合理便利和 response status。
35. OBSERVATION_ONLY 出现在行为观察区，不进入总分。
36. validity_boundary 能进入报告限制说明。
37. pilot_mode=true 时 placement_advice.enabled=false。
38. completion_ratio<1 时不输出安置方向。

### 组卷门禁

39. 6 大模块每模块至少 7 道 ACTIVE、SCORED_ITEM、renderer 已实现的线上题。
40. 至少 8 道 ACTIVE、SCORED_ITEM 的 OFFLINE_OPERATION。
41. 题量不足时继续返回 QUESTION_BANK_INSUFFICIENT，不静默降低模块或交互要求。
42. 组卷不得固定要求判断、单选、拖拽各 14 道。

---

## 18. 版本规划（增补）

### 18.1 MVP v1.0.7-question-contract-closure

- 增加 SOFTWARE_TASK。
- 增加 item_usage。
- 建立 interaction/presentation/support/evidence/log/scoring JSON 合同。
- 支持 NR/ST/技术中断/协助不计分。
- 建立素材版本和命名规则。
- 建立 answer payload、result payload、report content 合同。
- 将候选题库试测模式与正式安置建议解耦。

### 18.2 Post-MVP

- 正式 assessment_paper / assessment_paper_question。
- 训练题、正式计分题、固定结业题分库或用途扩展。
- 题库管理和可视化审核后台。
- question_asset_binding 表。
- 素材生成历史和提示词版本表。
- 原始轨迹分析表或 JSONL。
- 热点区域编辑器。
- 语音语义判分。
- 常模、IRT、信效度分析和题目参数。

---

## 19. 关键工程约束清单（增补第 37～56 条）

37. 不得把复杂软件任务全部伪装为 SINGLE_CHOICE 或 DRAG。
38. 不得为每种界面控件扩展一个数据库 question_type；具体交互进入 interaction_type。
39. 不得让 OBSERVATION_ONLY 进入 42+8、分数或完成率分母。
40. 不得让未实现 renderer 的题转 ACTIVE。
41. 不得在 content_json 和 scoring_rule_json 同时维护正确答案。
42. 不得让线上部分完成产生 1 分。
43. 不得把 NR、ST 或设备故障写成错误 0 分。
44. 不得把 P3 直接协助后的完成写成独立完成。
45. 不得把 accommodations 等同提示或自动扣分。
46. 不得用反应时间、速度、帮助请求或休息请求单独判定能力等级。
47. 不得把情境判断证据解释为真实岗位实操已经达标。
48. 不得把触控精细动作解释为真实握力、阻力控制或纸笔书写能力。
49. 不得把高频 pointer move 写入领域事件投影。
50. 不得在题目 JSON 保存绝对本地路径。
51. 不得覆盖已引用 asset_id 的文件内容。
52. 不得继续使用 question_ratio 14/14/14/8 固定题型结构。
53. 不得在 pilot_mode 下输出就业安置方向。
54. 不得让 report_content_json 缺少 schema_version、证据类型和效度限制。
55. 不得声称内嵌 JSON asset_id 已由 SQLite 外键完整保护；必须由 validator 和门禁校验。
56. 不得为了满足上线题量自动生成、猜测或伪造缺失答案、素材和专业确认结论。

---

## 20. Codex 最小执行顺序

1. **更新 PRD 与共享枚举**  
   建立 question_type、item_usage、interaction_type、presentation_type、response_status、prompt_level、evidence_type 的唯一枚举源。

2. **生成 schema v0.1.11 全量基线**  
   修改默认 DRAFT、SOFTWARE_TASK、item_usage、response_status、nullable score 和跨表触发器；运行 SQLite 初始化与 foreign_key_check。

3. **重写 JSON TypeScript 类型和 validator**  
   增加 ContentJsonSoftwareTask、ScoringRuleJson v1.1、AnswerPayloadJson、ResultPayloadJson、ReportContentJson；删除线上 partial credit 和 content_json.expected_answer。

4. **实现题库 v0.2 dry-run importer**  
   输出字段映射、interaction 分布、观察项识别、专业确认缺口、资源缺口、renderer 缺口和 ACTIVE 阻断原因。

5. **建立 interaction renderer registry**  
   先实现或确认 BINARY_SELECT、SINGLE_SELECT、MULTI_SELECT、DRAG_DROP、ORDERING、GESTURE_TASK、TIMED_TASK、TASK_SEQUENCE、BRANCHING_TASK；未实现 subtype 保持 DRAFT。

6. **接通评分、support 和 response status**  
   主进程统一评分；保存 scoring snapshot；实现 P0-P3、accommodations、NR/ST 和技术中断。

7. **接通报告与上线门禁**  
   输出 task-report-v1.1；试测模式关闭安置建议；验证每模块 7 个可执行 ACTIVE 线上题和 8 个线下题后再开放真实测评入口。

---

## 附录 A：TypeScript 最小类型目标

```ts
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

export type PresentationType =
  | 'TEXT_ONLY'
  | 'IMAGE_CARD'
  | 'AUDIO_PROMPT'
  | 'IMAGE_AUDIO'
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
```

`ContentJson` 必须增加 `ContentJsonSoftwareTask`；`ScoringRuleJson` 必须增加 SET_MATCH、MAPPING_MATCH、ORDER_MATCH、METRIC_THRESHOLD、EVENT_RULE、NO_SCORE；`ScoringRuleDrag` 不再使用名不副实的 `DRAG_PARTIAL`。

---

## 附录 B：本轮明确不做

- 不新增 ORM。
- 不新增 CSV 解析库。
- 不新增 Markdown 报告渲染库。
- 不重构 action_log、safety_incident、训练状态机和报告快照总架构。
- 不实现完整题库后台。
- 不实现正式试卷表。
- 不实现自动生题、生图或自动补答案。
- 不实现原始高频行为分析数据库。
- 不实现热点编辑器、摄像头或语音 NLP。
