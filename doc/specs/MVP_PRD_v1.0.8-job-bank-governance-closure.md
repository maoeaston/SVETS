# 炫灿-职途向导系统 MVP 产品需求文档｜专业岗位题库治理收口差异版

版本：PRD v1.0.8-job-bank-governance-closure
当前工程基线：`schema.sql v0.1.10-scoring-closure`
目标工程基线：`schema.sql v0.1.11-question-contract-closure`（合并 PRD v1.0.7 全部 schema 要求与本版增量，一次性生成全量基线；本版不另出 v0.1.12）
上一版 PRD：`PRD v1.0.7-question-contract-closure`
继承基线：`PRD v1.0.5` 全文 + `PRD v1.0.6` 全部替换与增补 + `PRD v1.0.7` 全部替换与增补
题库基线：通用基础能力正式测评候选题库 v0.2-软件优先版（96 条）+ 专业岗位能力题库 M1-M6 数据库导出（298 条，最终口径）
产品阶段：MVP
最后更新：2026-07-07

> **编写体例说明**：本文是可直接交给 Codex 执行的差异修订版。凡本文未出现的章节，先沿用 PRD v1.0.7；v1.0.7 未覆盖的沿用 v1.0.6；再往前沿用 v1.0.5。本文"全文替换"章节覆盖旧版对应章节；"增补"内容按指定编号插入。v1.0.7 已定的题库合同（SOFTWARE_TASK、item_usage、interaction/presentation 两层模型、scoring_rule_json v1.1、response_status、支持等级、行为日志、素材冻结、report_content_json v1.1、42+8、线上 0/2、线下 0/1/2、坐次机制、题目冻结、NR/ST）全部继续有效，本文只做治理增量。

---

## 0. 定稿说明

### 0.1 本版定位

PRD v1.0.7 完成了基础能力题库的数据合同收口，但 M1-M6 专业岗位题库 298 条真实数据库数据（见审查报告 `doc/archive/M1-M6题库软件化审查报告-v2-db298口径-通向v1.0.8.md`）暴露出四类 v1.0.7 未覆盖的治理缺口：

1. 基础能力题库与专业岗位题库在同一张 `question_bank` 表内**无域隔离**，存在专业岗位题被抽进基础能力测评卷的现实风险。
2. M1-M6 被机械映射为六大基础能力 `module_type`（如库房盘点→EMOTION_REGULATION、商品识别→BASIC_SOCIAL），**模块语义错误**。
3. 线下人工嵌入观察、标准化施测变体（中断/干扰/预埋差错/限时/警觉/角色扮演）与视频呈现**没有合法数据合同**。
4. 旧数据存在系统性质量缺陷（评分规则命名不一致、rubric 无三档锚点、ability_tags 非法值、note 误用、答案键存疑、素材零绑定、295 条错误 ACTIVE）。

本版只做"专业岗位题库治理合同收口"：建立域隔离、岗位模块字段、观察通道、施测变体合同、视频呈现合同和旧库重导规则。**不提前并入完整专业岗位测评系统**——不做专业岗位组卷策略、五类岗位分数、支架分差解释、安置矩阵、题库后台。

### 0.2 M1-M6 数据库事实口径

以下为 2026-07-07 对现库导出（`doc/reference/专业岗位能力测评题库-M1-M6-数据库导出-298条.json`）的实测事实，本版全部规则以此为准：

1. M1-M6 共 **298 条**（M1:48 / M2:41 / M3:58 / M4:48 / M5:55 / M6:48），为最终题库口径；549 题 PDF 仅为初始题目池，只作追溯与查漏，不得覆盖 298 条口径。
2. 题型分布：单选 96、判断 68、拖拽 34、线下实操 97、嵌入观察 3。
3. 现库状态：295 条 ACTIVE、3 条 DRAFT（嵌入观察）；`media_asset_id` 绑定数为 **0/298**；68 条判断题 media_brief 均为视频描述。
4. 已知数据缺陷：`ability_tags` 含非法值 `"0"`（96 条）/`"1"`（25 条）；`note` 被误用存储 "ACTIVE"；scoring_type 使用 `RUBRIC_BASED`（100 条）与 `DRAG_PARTIAL`（34 条）；线下 rubric 仅有"未能完成/部分完成/完全达标"通用模板；`M1_TF_015` 答案键存疑（正向组孤例 false）；单选正确答案 C 位仅 7/96。
5. 特殊设计均已存在于 298 条中：支架版拖拽 6、中断版 4、干扰版 1、预埋差错 3、限时 2、警觉衰减盘 1、角色扮演 5、文职平行版 6、嵌入观察 3。
6. 旧 job_code 为 `supermarket_stocking`，与现行正式值 `SUPERMARKET_SHELVER` 不一致。

### 0.3 v1.0.8 新增决策条目（承接 v1.0.7 第 41～56 条）

57. **新增数据库级 `bank_domain`**：`question_bank.bank_domain ∈ {BASE_ABILITY, JOB_SPECIFIC}`。域隔离必须由该字段承担，**不得**用题目 ID 前缀、job_code、question_role、allowed_roles、module_type 或命名约定替代。
58. **新增 `job_module_code`**：JOB_SPECIFIC 题必填 M1-M6，且 `module_type` 必须为空；BASE_ABILITY 题 `module_type` 必填且 `job_module_code` 必须为空。岗位模块不得再伪装为基础能力模块。
59. **新增 `TEACHER_OBSERVATION` 交互类型**：承载线下人工嵌入观察（教师现场编码），与 `SYSTEM_DERIVED_OBSERVATION`（软件事件派生）严格区分。两者均限 `item_usage = OBSERVATION_ONLY`、`scoring_type = NO_SCORE`、`score = NULL`。
60. **新增 `VIDEO_SCENE` 呈现方式与 `SCENE_VIDEO` 素材角色**：数据合同必须支持视频；素材可分批制作，缺素材保持 DRAFT。视频→图片降级只能逐题经专业审核执行并在 `source.transformation` 记录 `VIDEO_TO_IMAGE_CARD`，不得为凑 ACTIVE 题量批量降级。
61. **新增 `content_json.administration` 施测变体合同**：STANDARD / INTERRUPTION / DISTRACTION / PLANTED_ERROR / TIME_LIMITED / VIGILANCE / ROLE_PLAY。变体观察结果进入线下评分记录结构化 payload 或事件 payload，**不得直接计入题目 0/1/2 得分**。
62. **评分规则命名统一**：`RUBRIC_BASED` 迁移为 `OFFLINE_RUBRIC`；`DRAG_PARTIAL` 废止，按题拆分迁移为 `ORDER_MATCH` / `MAPPING_MATCH`。线上成绩继续只有 0/2；部分完成只进 `answer_payload_json.metrics`。
63. **线下 rubric 三档行为锚点必填**：每道 OFFLINE_OPERATION 逐题提供可现场观察复核的 0/1/2 行为锚点，禁止通用模板；角色扮演旧 1/2/2 五分式规则转三档锚点，内容 [需专业确认]。
64. **支持等级映射定稿**：旧手册 L1→P1、L2→P2、L3→P3（ASSISTED_NOT_SCORED）；"L3 后得分上限 3 分"废止；不得重新引入 5 分制。
65. **"不清楚"选项是有效作答**：option 打 `semantic_tag: "UNSURE"`；记录为 `response_status = ANSWERED`、`score = 0`、`metrics.unsure_selected = true`；报告表述为"主动表达不确定，需进一步确认"，不得表述为答错，不得记 NOT_APPLICABLE。
66. **ACTIVE 即冻结**：题目转 ACTIVE 或被 session/answer 引用后，语义字段（含 bank_domain、module_type、job_module_code、question_type、item_usage、content_json、scoring_rule_json、difficulty_level、safety_sensitive、sensory_tags_json、素材绑定）冻结；仅允许 ACTIVE→DISABLED/ARCHIVED；修订走"新 question_id + 旧题 ARCHIVED + superseded_by_question_id 追溯"。
67. **job_code 统一**：旧值 `supermarket_stocking` 全部迁移为 `SUPERMARKET_SHELVER`，旧值仅保留在 `content_json.source.legacy_job_code`；新库不得两值并存。
68. **JOB_SPECIFIC 结果边界**：本版只建立题库治理与数据合同；JOB_SPECIFIC 题重导后默认 DRAFT，不进入 BASELINE_ASSESSMENT 组卷，不生成 ABILITY_SCORE，不进入 42+8 与 completion_ratio，不复用基础能力等级与安置映射；完整岗位测评策略进入 Post-MVP。
69. **平行/配对关系用 `variant_group_id` + `variant_role` 表达**：支架版配对、门店/文职平行版均使用该机制；本轮**不新增** `question_role` 与 `parent_question_id` 数据库字段（列入 Post-MVP）。

### 0.4 本轮 Codex 交付边界

本轮必须完成（在 v1.0.7 §0.4 交付清单之上追加）：

- `bank_domain` / `job_module_code` schema 字段、域约束与组卷隔离过滤。
- `TEACHER_OBSERVATION` 交互与线下观察记录通道。
- `VIDEO_SCENE` 呈现与 `SCENE_VIDEO` 素材合同。
- `content_json.administration` 施测变体合同、类型定义、validator、导入与存储。
- 评分规则命名迁移（OFFLINE_RUBRIC / ORDER_MATCH / MAPPING_MATCH）与三档锚点校验。
- L→P 支持等级映射、UNSURE 选项合同。
- M1-M6 298 条旧库重导规则、数据清洗与 dry-run 报告。
- 题库隔离单元测试与本版新增验收标准。

本轮不做（见附录 B）：完整专业岗位组卷与评分策略、五类岗位分数、支架/门店-文职分差自动解释、安置矩阵、警觉衰减曲线、双报告模板、549 题变式导入、question_role / parent_question_id、题库与试卷后台、专业岗位施测 UI、ORM、CSV 解析库、Markdown 报告渲染库。

---

## 2.4 题量规格口径（增补）

v1.0.7 §2.4 全部规则不变，追加：

- 42+8、满分 100、模块配额、线上 0/2、线下 0/1/2 仅适用于 `bank_domain = 'BASE_ABILITY'`。
- `JOB_SPECIFIC` 题目不进入 42+8 题量统计、不进入 `completion_ratio` 分母、不参与模块一票否决、不生成 ABILITY_SCORE。
- 基础能力组卷 SQL 必须显式过滤 `bank_domain = 'BASE_ABILITY'`；组卷结果中 JOB_SPECIFIC 命中数必须为 0。

---

## 5.3.2 item_usage（增补）

v1.0.7 §5.3.2 不变，追加：

- `OBSERVATION_ONLY` 允许两种交互：`SYSTEM_DERIVED_OBSERVATION`（从软件任务事件派生指标）与 `TEACHER_OBSERVATION`（线下嵌入观察，教师现场编码）。
- 现库 3 条嵌入观察项（`M1_OB_048`、`M5_OP_048`、`M5_OP_055`）为 TEACHER_OBSERVATION 通道的迁移示例：重导时必须从 OFFLINE_OPERATION 修正为 `item_usage = OBSERVATION_ONLY` + `interaction_type = TEACHER_OBSERVATION` + `scoring_type = NO_SCORE`，其现存"RUBRIC_BASED max_score=2"评分规则作废。

## 5.3.3 interaction_type（增补）

v1.0.7 §5.3.3 枚举表追加一行：

| interaction_type | 适用题型 | answer_shape | 自动评分 |
|---|---|---|---|
| `TEACHER_OBSERVATION` | OBSERVATION_ONLY | 不写 answer_record；教师观察编码进线下观察记录 | 不计分 |

强制合同：

```text
item_usage        = OBSERVATION_ONLY
interaction_type  = TEACHER_OBSERVATION
scoring_type      = NO_SCORE
score             = NULL
```

TEACHER_OBSERVATION 项：不进入正式计分题量、不进入 42+8、不进入能力总分、不进入 completion_ratio、不生成普通自动评分、不进入 `assessment_session_question`；只进入行为观察记录与报告描述区。

与 `SYSTEM_DERIVED_OBSERVATION` 的区分：后者的指标来源是软件任务事件派生，无教师现场编码；前者的指标来源是教师按题目定义的编码维度现场记录。validator 不得允许两者互换。

## 5.3.4 presentation_type（全文替换）

`presentation_type` 进入 `content_json.presentation`，不新增 schema 列。

MVP 枚举：

- `TEXT_ONLY`
- `IMAGE_CARD`
- `AUDIO_PROMPT`
- `IMAGE_AUDIO`
- `VIDEO_SCENE`
- `INTERACTIVE_SCENE`
- `OFFLINE_MATERIAL`
- `SYSTEM_OBSERVATION`

`presentation_type` 只描述刺激呈现方式，不决定评分。

`VIDEO_SCENE` 规则：

1. 数据合同必须支持视频；实际视频素材可分批制作。
2. `VIDEO_SCENE` 题必须在 `presentation.assets` 绑定至少一个 `role = 'SCENE_VIDEO'` 且 `required = true` 的资产；缺少有效 SCENE_VIDEO（或经审核的图片替代素材）时题目保持 DRAFT。
3. 视频→图片降级只能**逐题**在专业审核后执行：`presentation_type` 改为 `IMAGE_CARD`，并在 `source.transformation` 记录 `VIDEO_TO_IMAGE_CARD` 及效度影响说明。
4. 不得仅为凑足 ACTIVE 题量批量将视频任务改成图片（工程约束第 61 条）。
5. M1-M6 的 68 条视频判断题默认目标形态为 `VIDEO_SCENE`。

## 5.3.5 content_json 合同（增补，schema_version 升至 question-content-v1.2）

在 v1.0.7 §5.3.5 合同基础上：

1. `schema_version` 升级为 `"question-content-v1.2"`。v1.1 结构是 v1.2 的真子集：v1.2 新增字段均为可选或条件必填，基础能力题不受影响。
2. 顶层新增可选块 `administration`（施测变体合同，见 §5.3.11）。缺省视为 `variant_type = "STANDARD"`。
3. 顶层新增可选字段 `variant_role`（与 `variant_group_id` 配对使用，见 §5.3.12）。
4. 选项类交互的 option 对象新增可选字段 `semantic_tag`，MVP 允许值：`"UNSURE"`（见 §5.4.4）。
5. `source` 新增可选字段：
   - `legacy_job_code`：旧库 job_code 原值（如 `supermarket_stocking`）。
   - `legacy_question_id`：旧库题目 ID（如 `M1_SC_001`），重导重命名时必填。
   - `source_ref_549`：549 题初始池原题号，仅作追溯。
6. 条件必填追加：
   - `bank_domain = 'JOB_SPECIFIC'`：`source.legacy_job_code`（迁移题）、`job_construct` 语义由 `target_construct` 承载（旧 ability_tags 非法值 `"0"`/`"1"` 必须在导入时修复为合法能力标签或置空，不得原样入库）。
   - `administration.variant_type ≠ 'STANDARD'`：`administration` 全块必填。
   - 平行/配对题：`variant_group_id` + `variant_role` 同时必填。
   - `presentation_type = 'VIDEO_SCENE'`：assets 含 `SCENE_VIDEO`。
7. `note` 字段只允许人类可读备注，**禁止存储状态值**（ACTIVE/DRAFT 等）；validator 检测到状态值时输出数据质量告警。

## 5.3.7 scoring_rule_json（增补）

v1.0.7 §5.3.7 不变，追加：

1. **命名迁移**：`RUBRIC_BASED` 不得进入新库，统一迁移为 `OFFLINE_RUBRIC`；`DRAG_PARTIAL` 废止，排序题迁移为 `ORDER_MATCH`、分类题迁移为 `MAPPING_MATCH`。
2. **OFFLINE_RUBRIC 三档行为锚点必填**：每个 criterion 必须提供逐题撰写、可现场观察复核的 `description_0` / `description_1` / `description_2`。validator 拒绝以下通用模板（含语义等价变体）："未完成 / 未能完成"、"部分完成"、"完全达标 / 完成"。
3. 角色扮演题旧有"话术 1 分 / 找人 2 分 / 交接 2 分"五分式规则必须转换为 0/1/2 三档行为锚点，转换结果标记 [需专业确认]，不得由系统自行推断。
4. **UNSURE 判分**：含 UNSURE 选项的题仍用 `EXACT_MATCH`；选中 UNSURE 不属于正确答案 → `score = 0`，但记录语义见 §5.4.4。
5. 线上题最终成绩继续只有 0/2；部分完成、错误类型等只进入 `answer_payload_json.metrics`。

## 5.3.8 素材资产结构与命名规范（增补）

v1.0.7 §5.3.8 不变，追加：

1. role 枚举新增：
   - `SCENE_VIDEO`：视频场景刺激（VIDEO_SCENE 题必备）。
   - `ROLE_PLAY_SCRIPT`：角色扮演标准台词脚本（对接手册附录 D）。
   - `SEALED_ADMIN_CONFIG`：密封施测配置（如预埋差错位置页，对接手册附录 B），仅记录员开启；渲染端与教师端默认不可见，访问控制由应用层保证。
2. `asset_id` 命名域新增 `JOB`：

```text
AST_JOB_{MODULE}_{ITEM_NO}_{ROLE}_{SEQ}_V{N}
示例：AST_JOB_M1_015_SCENE_VIDEO_01_V1
      AST_JOB_M5_054_ROLE_PLAY_SCRIPT_01_V1
      AST_JOB_M4_035_SEALED_ADMIN_CONFIG_01_V1
```

3. `asset_resource` 现有时长/尺寸/hash 字段直接承载视频文件；视频同样受"已引用不得覆盖、修订创建新 asset_id"约束。

## 5.3.10 专业岗位题库治理：bank_domain 与 job_module_code（全文新增）

### 5.3.10.1 bank_domain

`question_bank` 新增数据库级字段：

```sql
bank_domain TEXT NOT NULL
CHECK (bank_domain IN (
  'BASE_ABILITY',
  'JOB_SPECIFIC'
))
```

语义：

- `BASE_ABILITY`：基础能力评估题库（Q_BASE_* 与 v0.2 候选题库）。
- `JOB_SPECIFIC`：专业岗位能力题库（含 M1-M6 全部 298 条）。

强制规则：

1. 域隔离必须由 `bank_domain` 承担，**不得**用题目 ID 前缀、job_code、question_role、allowed_roles、module_type 或命名约定替代（工程约束第 57 条）。
2. 基础能力组卷 SQL 必须显式包含 `bank_domain = 'BASE_ABILITY'` 过滤条件。
3. `bank_domain` 属冻结字段（第 66 条决策）。

### 5.3.10.2 job_module_code

`question_bank` 新增字段：

```sql
job_module_code TEXT
CHECK (
  job_module_code IS NULL
  OR job_module_code IN ('M1', 'M2', 'M3', 'M4', 'M5', 'M6')
)
```

域约束（schema CHECK 强制）：

| bank_domain | module_type | job_module_code |
|---|---|---|
| BASE_ABILITY | 必填（六大能力枚举） | 必须为 NULL |
| JOB_SPECIFIC | 必须为 NULL | 必填（M1-M6） |

M1-M6 现库的机械映射（M1→RULE_EXECUTION、M2→FINE_MOTOR、M3→COGNITION、M4→EMOTION_REGULATION、M5→SAFETY_OPERATION、M6→BASIC_SOCIAL）在重导时**全部作废**：`module_type` 置 NULL，岗位模块写入 `job_module_code`。

岗位题涉及的精细动作、认知、安全、社交等复合能力可进入 `content_json` 的能力标签（`ability_tags` / `target_construct`），但不得再把岗位模块伪装为基础能力主模块。报告中不得出现"库房收纳和盘点 = 情绪调节"、"商品识别与分类 = 基础社交"等错误解释。

### 5.3.10.3 job_code 统一

- 旧 M1-M6 数据的 `supermarket_stocking` 必须统一迁移为现行正式值 `SUPERMARKET_SHELVER`。
- 旧值只保存在 `content_json.source.legacy_job_code`。
- 新库不得让两个 job_code 并存；导入 validator 拒绝 `supermarket_stocking` 作为正式 job_code 写入。

### 5.3.10.4 JOB_SPECIFIC 结果边界

```text
BASE_ABILITY
→ 现行基础能力评估策略
→ 42+8
→ ABILITY_SCORE
→ 六大基础能力 module_profiles

JOB_SPECIFIC
→ 本版只建立题库治理与数据合同
→ 重导后默认 DRAFT
→ 不进入 BASELINE_ASSESSMENT 组卷
→ 不生成现有 ABILITY_SCORE
→ 不复用基础能力等级判定与安置映射
→ 完整岗位测评策略进入 Post-MVP
```

JOB_SPECIFIC 题在 MVP 阶段即使转 ACTIVE（通过全部门禁），也仅表示"题目内容可用"，不改变上述边界。

### 5.3.10.5 M1-M6 旧库重导规则

1. 重导后 298 条全部默认 DRAFT，**不得沿用旧 ACTIVE 状态**（现库 295 条 ACTIVE 视为 v0.1.10 历史遗留错误状态）。
2. 逐题通过答案键审核（`answer_key_verified`）、素材审核、rubric 三档锚点审核后方可进入 ACTIVE 门禁流程。
3. 安全题（safety_sensitive 26 条）、角色扮演题（5 条）、嵌入观察题（3 条）必须通过专业审核（`professional_review`）。
4. 无素材、无三档 rubric、答案存疑（含 `M1_TF_015`）、交互未实现的题不得转 ACTIVE。
5. 数据清洗强制项：
   - `ability_tags` 含 `"0"` 或 `"1"` → 导入失败（修复后重试）。
   - `note` 存储状态值 → 数据质量告警并清洗。
   - `RUBRIC_BASED` / `DRAG_PARTIAL` → 按 §5.3.7 迁移，原值不得入库。
   - 3 条嵌入观察 → 按 §5.3.2 修正为 OBSERVATION_ONLY + TEACHER_OBSERVATION + NO_SCORE。
   - `supermarket_stocking` → `SUPERMARKET_SHELVER` + `source.legacy_job_code`。
6. 导入 dry-run 必须输出：
   - 模块×题型对账矩阵（必须与 §0.2 实测一致：96/68/34/97/3）。
   - 单选与判断题答案位置/方向分布（含 C 位偏置统计）。
   - 素材缺口清单（media_brief 有值但无资产逐条列出）。
   - 非法字段清洗报告（ability_tags、note、命名迁移、job_code）。
   - rubric 三档锚点缺口清单。
   - 每题 ACTIVE 阻断原因码。

### 5.3.11 施测变体合同 content_json.administration（全文新增）

用于承载标准化施测条件，**不新增 question_type**。

```json
{
  "administration": {
    "variant_type": "INTERRUPTION",
    "standard_instruction": "不好意思打断一下——你昨天晚饭吃了什么？",
    "instruction_repeat_limit": 0,
    "requires_two_examiners": true,
    "parameters": {
      "interrupt_at_progress": 0.5,
      "max_wait_seconds": 20
    },
    "observation_dimensions": [
      "RESUME_WITHOUT_REDO",
      "PARTIAL_REDO",
      "FULL_REDO",
      "NEEDS_PROMPT_TO_RESUME"
    ],
    "script_asset_id": null,
    "sealed_config_asset_id": null
  }
}
```

`variant_type` 枚举（MVP）：

- `STANDARD`：标准施测（缺省）。
- `INTERRUPTION`：中断版（中断时点、标准中断语、恢复编码）。
- `DISTRACTION`：干扰版（环境音资产、音量参数、隔日平行要求）。
- `PLANTED_ERROR`：预埋差错版（`sealed_config_asset_id` 指向密封差错页；检出/检出未报告/未检出编码）。
- `TIME_LIMITED`：限时版（时限、可视沙漏规则、到时即停不预警）。
- `VIGILANCE`：警觉衰减版（隐性问题总数、衰减点编码）。
- `ROLE_PLAY`：角色扮演（`script_asset_id` 指向标准台词脚本；`requires_two_examiners = true`）。

字段规则：

1. `variant_type = 'STANDARD'` 时其余字段必须为空/缺省；`administration.standard_instruction` 仅承载**变体专用逐字脚本**（如标准中断语、模糊指令台词），不替代也不重复 `presentation.standard_instruction`。
2. `observation_dimensions` 是题目声明的编码维度白名单；未声明的维度不得写入观察结果。
3. 施测变体的实际观察结果进入 `offline_score_record.observation_payload_json`（见 §11.12.8）或对应事件 payload，**不得直接混入题目 0/1/2 得分**。
4. 中断后的恢复方式、预埋差错检出、是否报告、是否需提示等属于观察指标，不得直接等同成绩（沿用 v1.0.7 §16.6.7 与工程约束第 46 条精神）。
5. INTERRUPTION / DISTRACTION / PLANTED_ERROR / VIGILANCE / ROLE_PLAY 仅允许用于 OFFLINE_OPERATION 或 OBSERVATION_ONLY 条目；TIME_LIMITED 可用于线上 SOFTWARE_TASK（此时时限由 scoring_rule 显式定义为目标构念）。

本轮交付：数据合同、类型定义、validator、导入与存储。**不要求完整专业岗位施测 UI**。

### 5.3.12 平行/配对关系 variant_group_id + variant_role（全文新增）

沿用 v1.0.7 已有的 `variant_group_id`，新增 `content_json.variant_role`，表达同组平行题的角色：

```json
{
  "variant_group_id": "VG_JOB_M4_STORE_OFFICE_001",
  "variant_role": "STORE_CONTEXT"
}
```

MVP `variant_role` 允许值：

- `STORE_CONTEXT` / `OFFICE_CONTEXT`：门店版 / 文职平行版（M4_OP_028-042 ↔ M4_OP_043-048 [需确认逐题配对表]）。
- `SCAFFOLDED` / `UNSCAFFOLDED`：支架版 / 无支架版拖拽配对。现库 6 条"支架版首步已固定/无支架版"合并题是否拆分为两题配对 [需确认]；若拆分，支架版通过 `interaction.config.prefilled_placements` 锁定首步。
- `QUIET_VERSION` / `DISTRACTION_VERSION`：安静版 / 干扰版配对（M1_OP_045）。

规则：

1. 同组题必须同 bank_domain、同 job_module_code、同目标构念。
2. 分差计算（支架分差、门店-文职分差、干扰分差）属 Post-MVP 专业岗位报告；MVP 只保证配对关系可查询。
3. 本轮不新增 `parent_question_id`；变式母题指针列入 Post-MVP（见 §18）。

---

## 5.4.2 支持等级（增补：L→P 映射）

v1.0.7 §5.4.2 的 P0-P3 定义与 accommodations 规则不变，追加旧手册等级统一映射：

| 旧等级（手册 v1.0） | 新等级 | 默认处理 |
|---|---|---|
| 无提示 | P0 | 正常计分 |
| L1 一般提醒、完整重复标准指令 | P1 | 题目允许时可计分 |
| L2 定向提示、过程性线索 | P2 | 教师复核并标注支持依赖 |
| L3 示范、指出关键步骤、代操作或手把手协助 | P3 | `ASSISTED_NOT_SCORED`，score = NULL |

- 旧规则"L3 后得分上限为 3 分"**废止**。
- 不得重新引入 5 分制。
- M1-M6 重导时，题目 `support_policy.allowed_prompt_levels` 按映射后的 P 级填写。

## 5.4.4 "不清楚"选项（全文新增）

"不清楚 / 不确定，需要查询"是**有效作答**，不是 NR，也不是技术中断。

合同：

1. option 对象标记：

```json
{ "key": "C", "text": "不确定，需要查询", "semantic_tag": "UNSURE" }
```

2. 答题记录：

```text
response_status = ANSWERED
score = 0
answer_payload_json.metrics.unsure_selected = true
```

3. 禁止保存为 `NOT_APPLICABLE` 或其他非 ANSWERED 状态。
4. 报告表述为"主动表达不确定 / 需要进一步确认"，可作为元认知观察证据；不得简单统一表述为"答错"。
5. `unsure_selected` 属行为证据指标，不得单独解释为能力高低（沿用 v1.0.7 §16.6.7）。

---

## 5.8.2 报告解释约束（增补）

v1.0.7 §5.8.2 六条不变，追加：

7. JOB_SPECIFIC 条目在 MVP 报告中只能出现在行为观察与描述区，不进入 ABILITY_SCORE、module_profiles 与等级判定。
8. 岗位模块（M1-M6）不得以基础能力模块名称解释；禁止"库房收纳=情绪调节"、"商品识别=基础社交"类表述。
9. TEACHER_OBSERVATION 编码只描述反应类型（如"扶起清理/口头提醒/注视无动作/未注意"），"无反应"不得写成能力缺陷。
10. UNSURE 选择按 §5.4.4 表述，不显示为答错。
11. 施测变体观察编码（恢复方式、检出-报告、衰减点）只能转译为支持需求描述，不得下能力结论。

---

## 7.6.1 question_policy_json（全文替换，v1.2）

在 v1.0.7 question-policy-v1.1 基础上新增 `eligible_bank_domains`：

```json
{
  "schema_version": "question-policy-v1.2",
  "module_scope": "CROSS_MODULE",
  "eligible_bank_domains": ["BASE_ABILITY"],
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

规则：

1. 基础能力评估策略的 `eligible_bank_domains` 固定为 `["BASE_ABILITY"]`。
2. 组卷器必须把 `bank_domain` 过滤写入候选题 SQL，不得依赖后置内存过滤。
3. 缺省值：历史策略无该字段时按 `["BASE_ABILITY"]` 解释（向后兼容）。
4. MVP 不定义 `["JOB_SPECIFIC"]` 组卷策略；专业岗位组卷进入 Post-MVP。

---

## 8.7 领域事件类型（增补）

v1.0.7 §8.7 事件不变，新增：

- `TEACHER_OBSERVATION_RECORDED`

### 8.7.4 TEACHER_OBSERVATION_RECORDED payload 最小合同

```json
{
  "schema_version": "teacher-observation-event-v1.0",
  "session_id": "AS_001",
  "question_id": "JOB_M1_OB_048",
  "bank_domain": "JOB_SPECIFIC",
  "interaction_type": "TEACHER_OBSERVATION",
  "observation_codes": ["口头提醒主试"],
  "observation_dimensions_version": "question-content-v1.2",
  "administration_variant": "STANDARD",
  "recorded_by": "USER_ID",
  "recorded_at": "...",
  "post_disclosure_done": true,
  "note": null
}
```

规则：

1. `observation_codes` 必须属于题目 `administration.observation_dimensions` 或 rubric 声明的编码维度白名单。
2. 事件不产生分数、不写 answer_record、不影响 completion_ratio。
3. 嵌入观察的"事后告知已执行"（`post_disclosure_done`）必填；为 false 时报告必须提示施测规程未闭环。
4. 施测变体（中断/干扰/预埋等）附着在计分实操题上的观察编码，随线下评分事件写入 `offline_score_record.observation_payload_json`，不单发本事件。

---

## 11.12 schema.sql v0.1.11（增补，与 v1.0.7 §11.12 合并生成同一全量基线）

### 11.12.7 question_bank（在 v1.0.7 §11.12.1 基础上追加）

1. 新增列：

```sql
bank_domain      TEXT NOT NULL
                  CHECK (bank_domain IN ('BASE_ABILITY', 'JOB_SPECIFIC')),
job_module_code  TEXT
                  CHECK (job_module_code IS NULL
                         OR job_module_code IN ('M1','M2','M3','M4','M5','M6'))
```

2. `module_type` 由 NOT NULL 改为可空，并新增域配对 CHECK：

```sql
CHECK (
  (bank_domain = 'BASE_ABILITY' AND module_type IS NOT NULL AND job_module_code IS NULL)
  OR
  (bank_domain = 'JOB_SPECIFIC' AND module_type IS NULL AND job_module_code IS NOT NULL)
)
```

3. 冻结字段清单（v1.0.7 §11.12.1 第 4 条）追加：`bank_domain`、`job_module_code`。
4. 冻结时点采用"ACTIVE 即冻结"：`status = 'ACTIVE'` 或已被 session/answer/offline 记录引用，两个条件任一成立即冻结全部语义字段；仅允许 `ACTIVE → DISABLED / ARCHIVED` 状态迁移；触发器在 DB 层强制。
5. 索引调整：`idx_question_bank_job_module_type_status` 扩展或新增 `(bank_domain, job_code, module_type, question_type, status)` 与 `(bank_domain, job_code, job_module_code, status)`。

### 11.12.8 assessment_session_question / answer_record / offline_score_record（追加）

1. `assessment_session_question` INSERT 校验（v1.0.7 §11.12.2 清单）追加：`question_bank.bank_domain = 'BASE_ABILITY'`。JOB_SPECIFIC 与 OBSERVATION_ONLY 均不得进入该表。
2. `offline_score_record` 新增列：

```sql
observation_payload_json TEXT
```

   - 承载施测变体观察编码（恢复方式、检出-报告、衰减点、限时是否到时即停等）与其他结构化过程观察。
   - 编码值必须属于题目 `administration.observation_dimensions` 白名单（应用层 validator 校验）。
   - 观察编码不参与 score 计算；score 仍只由 rubric 三档判定产生。
3. TEACHER_OBSERVATION 观察记录通道：`offline_score_record.score_scope` 增加 `'TEACHER_OBSERVATION'`：
   - `question_id` 必填且必须指向 `item_usage = 'OBSERVATION_ONLY'` 且 `interaction_type = 'TEACHER_OBSERVATION'` 的题。
   - `score` 必须为 NULL（该 scope 豁免 0/1/2 CHECK）。
   - `observation_payload_json` 必填。
   - 豁免"question_id 必须属于该 session 组卷"校验（观察项不进组卷），但 `session_id` 必须存在且处于开放态。
   - 不进入 `completion_ratio`、不进入任何分数聚合。
4. `answer_record`：UNSURE 选择按普通 ANSWERED 记录（score=0），无 schema 变更；`unsure_selected` 进入 answer_payload metrics。

### 11.12.9 数据迁移与重导（追加）

1. v0.1.11 为全量初始化基线，不做原地 migration；现库数据按 §5.3.10.5 重导规则清洗后导入。
2. 域回填：`Q_BASE_*` 与 v0.2 候选题 → `BASE_ABILITY`；`M1_*–M6_*` → `JOB_SPECIFIC`。
3. 295 条旧 ACTIVE 的 M1-M6 数据重导后一律 DRAFT。
4. 若现库 295 条 ACTIVE 已被历史 session 引用 [需确认]，question_bank 不物理清空，改为旧题全部 ARCHIVED + 新 question_id 重建，经 `superseded_by_question_id` 追溯。

---

## 16.6 行为日志最小字段集（增补）

1. §16.6.2 点击/选择题最小字段追加：`unsure_selected`（布尔，选中 semantic_tag=UNSURE 选项时为 true）。
2. 新增 §16.6.8 线下观察编码（进入 `offline_score_record.observation_payload_json`）：
   - `administration_variant`
   - `observation_codes[]`（白名单内）
   - `interruption_recovery_code`（A 接续不重做 / B 部分重做 / C 完全重做 / D 需提示）
   - `planted_error_outcome`（检出并指出 / 检出未报告 / 未检出）
   - `vigilance_decline_point`（件数）
   - `time_limit_expired`（布尔）
   - `prompt_level` / `accommodations_used`
   - `examiner_ids[]`（requires_two_examiners 时长度 ≥ 2）
3. §16.6.7 "不得直接等同成绩的指标"清单追加：`unsure_selected`、`interruption_recovery_code`、`planted_error_outcome`、`vigilance_decline_point`。

---

## 17.10 v1.0.8 题库治理专项验收（新增）

### 域隔离

1. BASE_ABILITY 组卷命中 JOB_SPECIFIC 题目数为 0。
2. JOB_SPECIFIC 题不能生成现有 ABILITY_SCORE。
3. JOB_SPECIFIC 题必须有 job_module_code。
4. JOB_SPECIFIC 题的 module_type 必须为空。
5. BASE_ABILITY 题必须有 module_type。
6. BASE_ABILITY 题的 job_module_code 必须为空。

### 观察通道

7. OBSERVATION_ONLY 必须 NO_SCORE。
8. TEACHER_OBSERVATION 不生成 answer score；写入 offline_score_record 时 score 必须为 NULL。
9. 观察项不进入 completion_ratio。
10. 3 条嵌入观察（M1_OB_048、M5_OP_048、M5_OP_055）重导后必须识别为 OBSERVATION_ONLY + TEACHER_OBSERVATION。

### 呈现与素材

11. VIDEO_SCENE 缺少有效 SCENE_VIDEO（或经审核的图片替代素材）时不得 ACTIVE。
12. 图片降级题必须有 `source.transformation = VIDEO_TO_IMAGE_CARD` 留痕。

### 评分规则

13. RUBRIC_BASED 不得进入新库。
14. DRAG_PARTIAL 不得进入新库。
15. OFFLINE_RUBRIC 缺少逐题三档行为锚点（或使用通用模板）时不得 ACTIVE。
16. 线上所有评分路径仍只产生 0 或 2。

### 数据质量与重导

17. M1_TF_015 在 answer_key_verified 未通过时不得 ACTIVE。
18. ability_tags 包含 `"0"` 或 `"1"` 时导入失败。
19. note 存储 ACTIVE/DRAFT 等状态值时输出数据质量告警。
20. `supermarket_stocking` 不得作为正式 job_code 写入新题；迁移题的 `source.legacy_job_code` 保留原值。
21. M1-M6 298 条 dry-run 模块×题型矩阵与 §0.2 实测一致（96 单选 / 68 判断 / 34 拖拽 / 97 实操 / 3 观察）。
22. dry-run 输出答案位置分布、素材缺口与非法字段清洗报告。
23. 295 条旧 ACTIVE 数据重导后不得继续保持 ACTIVE。

### 冻结与施测变体

24. ACTIVE 题修改语义字段（含 bank_domain / job_module_code）必须失败。
25. 施测变体的 observation_dimensions 能写入和读取（offline_score_record.observation_payload_json），但不直接改变题目 0/1/2 得分。
26. "不清楚"选项保存为 ANSWERED + score 0 + unsure_selected，不保存为 NOT_APPLICABLE。

### 回归

27. 现有基础能力题库、坐次、评分、报告和安全事件回归测试继续通过。

---

## 18. 版本规划（增补）

### 18.1 MVP v1.0.8-job-bank-governance-closure

- bank_domain 域隔离 + job_module_code 岗位模块字段。
- TEACHER_OBSERVATION 线下观察通道。
- VIDEO_SCENE 视频呈现合同。
- content_json.administration 施测变体合同（数据合同/类型/validator/导入存储）。
- 评分规则命名统一与三档锚点门禁。
- L→P 支持等级映射、UNSURE 选项合同。
- M1-M6 298 条重导规则与数据清洗。

### 18.2 Post-MVP（在 v1.0.7 §18.2 之上追加）

- 专业岗位 M1-M6 正式组卷与评分策略。
- 五类专业岗位结果（操作分/知识分/支架指数/注意执行/社交元认知编码）。
- 支架前后分差自动解释、门店—文职分差自动解释、干扰分差解释。
- 专业岗位安置矩阵与双轨解释（ASD/ADHD）。
- 警觉衰减曲线分析。
- 对外报告与内部专业报告双模板。
- 549 题初始池训练变式（TRAINING_VARIANT / GENERALIZATION）正式导入。
- `question_role`、`parent_question_id` 数据库字段与四层题库分层。
- 视频素材批量制作流水线与视频高级行为分析。

---

## 19. 关键工程约束清单（增补第 57～70 条）

57. 不得用题目 ID 前缀、job_code、question_role、allowed_roles、module_type 或命名约定替代 bank_domain 实现域隔离。
58. 不得让 JOB_SPECIFIC 题进入基础能力组卷、42+8、ABILITY_SCORE 或 completion_ratio。
59. 不得把岗位模块伪装或解释为基础能力模块。
60. 不得混用 TEACHER_OBSERVATION 与 SYSTEM_DERIVED_OBSERVATION。
61. 不得为凑足 ACTIVE 题量批量将视频任务降级为图片；降级必须逐题专业审核并留痕。
62. 不得让 RUBRIC_BASED 或 DRAG_PARTIAL 进入新库。
63. 不得用通用模板（未完成/部分完成/完全达标）代替逐题三档行为锚点。
64. 不得恢复"L3 后限分"规则或任何 5 分制计分。
65. 不得把"不清楚"选择保存为 NOT_APPLICABLE 或在报告中表述为答错。
66. 不得原地修改 ACTIVE 或已被引用题目的语义字段（含 bank_domain、job_module_code）。
67. 不得让 supermarket_stocking 作为正式 job_code 写入新库。
68. 不得把施测变体观察编码（恢复方式、检出-报告、衰减点）直接计入 0/1/2 得分。
69. 不得在 MVP 实现 question_role、parent_question_id、五类岗位分数、分差自动解释或安置矩阵。
70. 不得让 OBSERVATION_ONLY 条目生成 answer_record 分数或线下 0/1/2 评分。

---

## 20. Codex 最小执行顺序（全文替换）

1. **更新 PRD 与共享枚举**
   在 v1.0.7 枚举源之上增加：BankDomain、JobModuleCode、TEACHER_OBSERVATION、VIDEO_SCENE、AdministrationVariantType、VariantRole、UNSURE semantic_tag。

2. **生成 schema v0.1.11 全量基线**
   合并 v1.0.7 §11.12 与本版 §11.12.7-11.12.9：bank_domain、job_module_code、module_type 域配对 CHECK、ACTIVE 即冻结触发器、offline_score_record.observation_payload_json 与 TEACHER_OBSERVATION scope、assessment_session_question 域校验；运行 SQLite 初始化与 foreign_key_check。

3. **重写 JSON TypeScript 类型和 validator**
   question-content-v1.2（administration、variant_role、semantic_tag、legacy 字段）；OFFLINE_RUBRIC 三档锚点校验（拒绝通用模板）；ORDER_MATCH/MAPPING_MATCH 迁移；question-policy-v1.2（eligible_bank_domains）；TEACHER_OBSERVATION 事件 payload 类型。

4. **实现题库重导 importer 与 dry-run**
   基础能力 v0.2（96 条）+ Q_BASE 存量 + M1-M6 298 条三路输入；执行 §5.3.10.5 清洗规则；输出对账矩阵、答案分布、素材缺口、非法字段清洗、rubric 缺口和 ACTIVE 阻断原因报告。

5. **组卷器域隔离**
   paper generator / question selector 加入 `bank_domain = 'BASE_ABILITY'` SQL 过滤与 eligible_bank_domains 策略读取；补题库隔离单元测试（验收 1-6）。

6. **接通观察通道与施测变体存储**
   TEACHER_OBSERVATION_RECORDED 事件、offline_score_record 新 scope 与 observation_payload_json 写入路径、observation_dimensions 白名单校验。

7. **门禁、报告与回归**
   ACTIVE 审核门禁追加视频/rubric/答案键/专业审核检查；报告解释约束 7-11 落地；跑通 §17.10 全部 27 条验收与既有回归。

---

## 附录 A：TypeScript 类型增量（在 v1.0.7 附录 A 之上追加）

```ts
export type BankDomain = 'BASE_ABILITY' | 'JOB_SPECIFIC'

export type JobModuleCode = 'M1' | 'M2' | 'M3' | 'M4' | 'M5' | 'M6'

// InteractionType 增加：
//   | 'TEACHER_OBSERVATION'

// PresentationType 增加：
//   | 'VIDEO_SCENE'

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

export type OptionSemanticTag = 'UNSURE'
```

`ScoringRuleJson`：删除 `RUBRIC_BASED` 与 `DRAG_PARTIAL` 兼容分支；`OFFLINE_RUBRIC` 的 criterion 必须含 `description_0 / description_1 / description_2`。
素材 role 枚举增加：`SCENE_VIDEO`、`ROLE_PLAY_SCRIPT`、`SEALED_ADMIN_CONFIG`。
事件类型增加：`TEACHER_OBSERVATION_RECORDED`。

---

## 附录 B：本轮明确不做

1. `question_role` 数据库字段。
2. `parent_question_id` 数据库字段。
3. 549 题训练变式正式导入。
4. 完整专业岗位组卷系统。
5. 专业岗位五类分数。
6. 支架前后分差自动解释。
7. 门店—文职分差自动解释。
8. 专业岗位安置矩阵。
9. 警觉衰减曲线。
10. 对外报告与内部专业报告双模板。
11. 完整题库管理后台。
12. 试卷管理后台。
13. 完整专业岗位施测 UI。
14. ORM。
15. CSV 解析库。
16. Markdown 报告渲染库。

---

## 附录 C：[需确认] 集中清单

1. **M1_TF_015 答案键**：正向组孤例 expected=false，需内容负责人裁决改键或废弃；裁决前保持 DRAFT。
2. **角色扮演 rubric 三档锚点文本**：旧 1/2/2 五分式规则的 0/1/2 转换结果需专业确认（决策条目 63）。
3. **支架版配对拆分口径**：现库 6 条"支架版/无支架版"合并题是拆为两题（variant_group_id + SCAFFOLDED/UNSCAFFOLDED 配对，题量 298→304）还是保持单题两态；手册第Ⅲ类支架分差要求两次施测，倾向拆分，需内容侧确认。
4. **门店版↔文职版逐题配对表**：M4_OP_043-048 与对应门店版题目的 variant_group_id 映射需内容侧给出。
5. **295 条旧 ACTIVE 是否已被历史 session 引用**：决定 question_bank 物理清空重导还是 ARCHIVED+重建（§11.12.9 第 4 条）。
6. **Q_BASE 存量 253 条的重导范围**：随 v0.1.11 全量基线一并清洗重导（bank_domain 回填、答案键/素材状态审计）还是仅回填域字段。
7. **手册附录 A-G 交付情况**：逐题指导语卡（附录 C）、密封差错页（附录 B）、角色扮演台词（附录 D）、环境音频（附录 G）是 offline 字段与 SEALED_ADMIN_CONFIG / ROLE_PLAY_SCRIPT 资产的内容来源，需确认是否已交付。
8. **M5 安全实物未通过与红线机制的衔接**：手册"安全实物未通过→暂缓所有安置"属 Post-MVP 专业岗位策略，但 MVP 报告中 JOB_SPECIFIC 安全题观察描述的措辞边界需专业确认。
9. **549 初始池疑错题的剔除确认**：549 版疑似答案错误题（如 M3-90/96）是否为 298 精炼时有意剔除，影响后续变式扩充时对 549 池的信任度。
10. **JOB_SPECIFIC 题目新 ID 命名规则**：重导时保留 `M1_SC_001` 旧 ID 还是改用 `JOB_SUPERMARKET_M1_...` 新规则（旧 ID 存 `source.legacy_question_id`），需在 importer 实现前定稿。

---

## 附录 D：需要同步修改的工程工件清单

1. `src/main/db/schema.sql`（v0.1.11 全量基线）
2. `src/shared/types/json-schemas.ts`（附录 A 类型增量）
3. content JSON validator（question-content-v1.2、administration、UNSURE、note 状态值告警）
4. scoring rule validator（OFFLINE_RUBRIC 三档锚点、命名迁移拦截）
5. question importer / dry-run（三路输入、清洗规则、报告输出）
6. paper generator / question selector（bank_domain 过滤、eligible_bank_domains）
7. answer/offline payload 类型（unsure_selected、observation_payload_json）
8. ACTIVE 审核门禁（视频素材、rubric 锚点、答案键、专业审核、renderer）
9. 题目冻结 trigger（ACTIVE 即冻结、新增冻结字段）
10. 题库隔离单元测试（验收 1-6、27）
11. 报告 schema validator（解释约束 7-11、TEACHER_OBSERVATION 编码呈现）
