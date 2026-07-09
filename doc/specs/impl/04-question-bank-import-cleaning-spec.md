# 题库导入清洗规格

版本：import-cleaning-spec v1.0  
日期：2026-07-07  
依据：PRD v1.0.8 §5.3.10.5 / 审查报告 v2 全部缺陷 / PRD v1.0.9 §5.3.15-§5.3.16  
数据源：298 条 JSON 导出（`doc/reference/...298条.json`）  
前置文档：`01-schema-v0.1.12-design.md`（字段定义）、`02-json-contracts-and-types.md`（类型合同）、`03-job-skill-demo-paper-spec.md`（固定题集）

---

## 1. 总体原则

1. 298 条全部重导为 DRAFT（现库 295 条 ACTIVE 状态不合法，违反 v1.0.7 全部门禁）
2. 重导是一次性脚本，不引入 CSV 解析库（AGENTS.md 约束）
3. 源为 JSON 数组（已有 `...298条.json`），每条直接映射一行 question_bank
4. 目标 schema 为 v0.1.12，字段定义按 `01-schema-v0.1.12-design.md`
5. dry-run 模式先输出报告、不写库；全绿后执行写入
6. 基础能力 Q_BASE 253 条同步重导（本文档只定义 M1-M6 规则；Q_BASE 沿用相同框架加基础能力特定规则）

---

## 2. 字段映射表（旧 → 新）

| # | 旧字段 / 位置 | 新字段 | 转换规则 |
|---|---|---|---|
| 1 | question_id | question_id | 保留原 ID（M1_SC_001 等），观察项建议重命名 [需人工确认] |
| 2 | job_code: "supermarket_stocking" | job_code | 改为 `SUPERMARKET_SHELVER`（v1.0.8 §5.3.10.5 统一大写枚举） |
| 3 | — | bank_domain | 固定 `JOB_SPECIFIC`（全部 298 条） |
| 4 | module_type | module_type | 设为 NULL（JOB_SPECIFIC 不使用基础能力模块） |
| 5 | module_type（旧值） | job_module_code | 映射：RULE_EXECUTION→M1, FINE_MOTOR→M2, COGNITION→M3, EMOTION_REGULATION→M4, SAFETY_OPERATION→M5, BASIC_SOCIAL→M6 |
| 6 | question_type | question_type | 保留（SINGLE_CHOICE/TRUE_FALSE/DRAG/OFFLINE_OPERATION） |
| 7 | — | item_usage | 3 条观察项→`OBSERVATION_ONLY`；其余→`SCORED_ITEM` |
| 8 | difficulty_level | difficulty_level | 保留 |
| 9 | content_json | content_json | 完整重构为 v1.2 合同（见 §3） |
| 10 | scoring_rule_json | scoring_rule_json | 重写类型名 + 结构升级（见 §4） |
| 11 | media_asset_id | — | 原值全 NULL，不保留；素材关系进 content_json.presentation.assets |
| 12 | tool_asset_ids_json | — | 原值全 NULL |
| 13 | safety_sensitive | safety_sensitive | 保留 |
| 14 | sensory_tags_json | sensory_tags_json | 保留（NULL 全部 298 条） |
| 15 | status: ACTIVE/DRAFT | status | 全部强制 `DRAFT` |
| 16 | version: 1 | version | 重置为 1 |
| 17 | superseded_by_question_id | superseded_by_question_id | 保留 NULL |

---

## 3. content_json 重构规则

旧 content_json 是扁平结构（question_type + prompt + options/items/zones + expected_answer 等）。新 content_json 须重构为 question-content-v1.2 分层结构。

### 3.1 通用字段处理

| 旧字段 | 处理 | 新位置 |
|---|---|---|
| question_type | 保留 | 顶层 `question_type` |
| prompt | 保留 | 顶层 `prompt` |
| assessment_point | 迁入 | `target_construct`（旧 assessment_point 值直接作为构念描述） |
| ability_tags: ["0"] / ["1"] | **清洗** | 见 §3.2 |
| media_brief | 迁入 | `presentation.media_brief`（仅描述性文本保留） |
| note（含"ACTIVE"等） | **清洗** | 有效注释→`source.note`；"ACTIVE"等状态值丢弃 |
| source.import_batch_id | 保留 | `source.import_batch_id` |
| source.source_file | 保留 | `source.source_file` |
| source.source_ref | 拆分 | `source.origin_refs`（原题号）+ `source.source_ref`（其余注释） |
| expected_answer | **删除** | 迁入 scoring_rule_json（v1.0.7 决策 49） |

### 3.2 ability_tags 清洗

| 旧值 | 条数 | 处理 |
|---|---|---|
| `["0"]` | 96 | 清洗为 `[]`（JOB_SPECIFIC 允许空数组） |
| `["1"]` | 25 | 清洗为 `[]` |
| 合法能力值（如 `["RULE_EXECUTION","FINE_MOTOR"]`） | 177 | 保留为辅助标签（JOB_SPECIFIC 允许合法值作辅助） |

### 3.3 按题型重构

**SINGLE_CHOICE（96 条）：**
```
旧: { question_type, prompt, options[{key,text}], expected_answer, ... }
新: {
  schema_version: "question-content-v1.2",
  question_type: "SINGLE_CHOICE",
  prompt,
  target_construct: <从 assessment_point 映射>,
  ability_tags: <清洗后>,
  interaction: { type: "SINGLE_SELECT", config: { options: [...] } },
  presentation: { type: <TEXT_ONLY|IMAGE_CARD>, media_brief, assets: [] },
  expected_evidence: { type: "SOFTWARE_BEHAVIOR"|"SITUATIONAL_JUDGMENT" },
  support_policy: { max_prompt_level: "P1", accommodations_allowed: [...] },
  log_metrics: ["first_selection_latency_ms", "change_count"],
  review: { answer_key_status: "PENDING", ... },
  source: { ... }
}
```
- `expected_answer` 不再出现在 content_json（迁入 scoring_rule_json.correct_answer）

**TRUE_FALSE（68 条）：**
```
旧: { question_type, prompt, expected_answer: true/false, ... }
新: {
  ...,
  question_type: "TRUE_FALSE",
  interaction: { type: "BINARY_SELECT", config: {} },
  presentation: { type: "IMAGE_CARD", media_brief, assets: [], transformation: "VIDEO_TO_IMAGE_CARD" },
  ...
}
```
- 全部 68 条 media_brief 为"视频：..."，presentation.type 改为 IMAGE_CARD + `source.transformation = "VIDEO_TO_IMAGE_CARD"`
- `expected_answer` 迁入 scoring_rule_json

**DRAG — 排序题（约 28 条，zones 为"第N步"）：**
```
新: {
  ...,
  question_type: "DRAG",
  interaction: { type: "ORDERING", config: { items: [...], correct_order: [...] } },
  ...
}
```
- scoring_type 改为 `ORDER_MATCH`
- `correct_order` 从 zones.accepts 推导

**DRAG — 分类题（约 6 条，zones 为品类/区域名）：**
```
新: {
  ...,
  question_type: "DRAG",
  interaction: { type: "DRAG_DROP", config: { items: [...], zones: [...], correct_mapping: {...} } },
  ...
}
```
- scoring_type 改为 `MAPPING_MATCH`

**OFFLINE_OPERATION（97 条实操 + 3 条观察）：**
```
新: {
  ...,
  question_type: "OFFLINE_OPERATION",
  interaction: { type: <"OFFLINE_RUBRIC"|"TEACHER_OBSERVATION"> },
  presentation: { type: "OFFLINE_MATERIALS" },
  offline_tool_brief: <保留>,
  rubric_criteria: <保留结构，需补三档锚点>,
  administration: { variant_type: "NONE"|"PLANTED_ERROR"|"INTERRUPT"|... },
  termination_policy: { ... },
  ...
}
```

### 3.4 新增必填块（全题型通用）

```ts
// review 块 — 所有题初始化为 PENDING
review: {
  answer_key_status: "PENDING",  // 自动评分题；观察项 = "NOT_REQUIRED"
  answer_key_reviewed_by: null,
  answer_key_reviewed_at: null,
  answer_key_review_note: null
}

// source 块 — 保留导入溯源
source: {
  import_batch_id: "batch_reimport_v012",
  source_file: "298条.json",
  source_ref: <原 source_ref 中非题号部分>,
  origin_refs: [<"原题81" → "549:81">],
  source_ref_549: <提取"原题N"中的N>,
  transformation: null | "VIDEO_TO_IMAGE_CARD",
  legacy_job_code: "supermarket_stocking",
  legacy_question_id: <原 question_id（若重命名时保留）>
}
```

---

## 4. scoring_rule_json 重构规则

| 旧 scoring_type | 条数 | 新 scoring_type | 变更 |
|---|---|---|---|
| EXACT_MATCH | 164 | EXACT_MATCH | 结构不变；新增 `correct_answer` 字段（从 content_json.expected_answer 迁入） |
| DRAG_PARTIAL | 34 | ORDER_MATCH（排序）/ MAPPING_MATCH（分类） | 按 zones 语义判断：zones 为"第N步" → ORDER_MATCH；否则 → MAPPING_MATCH |
| RUBRIC_BASED | 100 | OFFLINE_RUBRIC（97 实操）/ NO_SCORE（3 观察） | 实操保留 max_score=2 + criteria 结构；观察改为 NO_SCORE |

### 4.1 EXACT_MATCH 升级

```json
// 旧
{ "scoring_type": "EXACT_MATCH", "max_score": 2, "correct_score": 2, "incorrect_score": 0 }

// 新（SC）
{ "scoring_type": "EXACT_MATCH", "max_score": 2, "correct_score": 2, "incorrect_score": 0,
  "correct_answer": "A" }

// 新（TF）
{ "scoring_type": "EXACT_MATCH", "max_score": 2, "correct_score": 2, "incorrect_score": 0,
  "correct_answer": true }
```

### 4.2 DRAG_PARTIAL → ORDER_MATCH / MAPPING_MATCH

```json
// 旧
{ "scoring_type": "DRAG_PARTIAL", "max_score": 2, "all_correct_score": 2, "partial_correct_score": 0, "incorrect_score": 0 }

// 新 ORDER_MATCH（排序题）
{ "scoring_type": "ORDER_MATCH", "max_score": 2,
  "correct_order": ["i1","i2","i3","i4"],
  "all_correct_score": 2, "partial_credit": false }

// 新 MAPPING_MATCH（分类题）
{ "scoring_type": "MAPPING_MATCH", "max_score": 2,
  "correct_mapping": { "i1": "z1", "i2": "z2", ... },
  "all_correct_score": 2, "partial_credit": false }
```

注：`partial_correct_score=0` 在旧库中名不副实（实际无部分得分），新结构改为 `partial_credit: false` 明确表达。

### 4.3 RUBRIC_BASED → OFFLINE_RUBRIC / NO_SCORE

```json
// 旧（实操）
{ "scoring_type": "RUBRIC_BASED", "max_score": 2, "score_0_description": "...", "score_1_description": "...", "score_2_description": "..." }

// 新（实操）
{ "scoring_type": "OFFLINE_RUBRIC", "max_score": 2,
  "criteria": [
    { "criterion_id": "r1", "description": "...",
      "score_0": "...", "score_1": "...", "score_2": "..." }
  ] }

// 新（观察）
{ "scoring_type": "NO_SCORE" }
```

---

## 5. 强制清洗规则（逐条覆盖审查报告 v2 全部缺陷）

### 5.1 来自 §5.3.10.5 的强制清洗项

| # | 规则 | 影响条数 | 处理 |
|---|---|---|---|
| C1 | job_code: supermarket_stocking → SUPERMARKET_SHELVER | 298 | 全量替换 |
| C2 | ability_tags ["0"]/["1"] → [] | 121 | 非法值清零 |
| C3 | note 存储 "ACTIVE" 状态值 → 丢弃 | ~96 | 正则匹配 `^ACTIVE$` 丢弃；其余有效注释保留 |
| C4 | module_type 机械映射 → module_type=NULL, job_module_code=M1-M6 | 298 | 按映射表转换 |
| C5 | expected_answer 从 content_json 删除 → 迁入 scoring_rule_json | 164+34 | SC/TF/DG |
| C6 | scoring_type RUBRIC_BASED → OFFLINE_RUBRIC 或 NO_SCORE | 100 | 按 item_usage 分流 |
| C7 | scoring_type DRAG_PARTIAL → ORDER_MATCH / MAPPING_MATCH | 34 | 按 zones 语义 |
| C8 | status 全部 → DRAFT | 298 | 无条件 |
| C9 | media_brief 残缺文本（如"，摆放规范R1"）→ 保留但标记 | ~30 | 前导逗号去除 |
| C10 | 68 道 TF presentation → IMAGE_CARD + transformation 留痕 | 68 | 降级标记 |

### 5.2 来自审查报告 v2 的已知缺陷清洗

| # | 缺陷描述 | 条数 | 清洗规则 |
|---|---|---|---|
| D1 | 3 条观察 scoring max_score=2 与"不计分"文本矛盾 | 3 | scoring_type→NO_SCORE，item_usage→OBSERVATION_ONLY |
| D2 | rubric 无三档行为锚点（通用模板） | 97 | 标记 `rubric_anchor_status = PENDING`；不阻塞 DRAFT 导入 |
| D3 | SC 正确项 C 位仅 7/96（位置偏置） | 96 | dry-run 报告输出位置分布统计；不自动修改 |
| D4 | M1_TF_015 疑似键错（正向组孤例 false） | 1 | answer_key_status=PENDING + 标记"正向组孤例" |
| D5 | 200/298 有 media_brief 但 0 绑定素材 | 200 | 保留 media_brief 文本→presentation.media_brief；asset_status=MISSING |
| D6 | 支架版6条需拆分为两题 variant_group_id 配对 | 6 | 本轮不拆（Post-MVP），标记 variant_role=SCAFFOLD_PAIR |
| D7 | 中断/干扰/预埋/限时 变体信息在 note/source_ref | 10 | 解析→ administration.variant_type |
| D8 | 角色扮演 rubric 内嵌 1/2/2 三步制与 0/1/2 冲突 | 5 | 标记 scoring_conversion_pending=true |
| D9 | 文职平行版 6 条需 variant_group_id 配对 | 6 | 标记 variant_group_id（M4_OP_N ↔ M4_OP_N+15 配对） |
| D10 | source_ref "原题N" 未结构化 | ~200 | 正则提取 → source.source_ref_549 |

### 5.3 清洗判定逻辑伪代码

```python
def is_ordering_drag(content_json):
    """排序题：zones 标签含"第N步"或全为序号"""
    zones = content_json.get('drop_zones', [])
    return any('第' in z['label'] and '步' in z['label'] for z in zones)

def extract_549_ref(source_ref: str) -> str | None:
    """从 source_ref 提取原题号"""
    import re
    m = re.search(r'原题\s*(\d+)', source_ref)
    return m.group(1) if m else None

def determine_variant_type(note: str, source_ref: str) -> str:
    if '中断' in note: return 'INTERRUPT'
    if '干扰' in note or '背景音' in note: return 'DISTRACTION'
    if '预埋' in note or '差错' in note: return 'PLANTED_ERROR'
    if '限时' in note: return 'TIME_LIMITED'
    if '警觉' in note or '衰减' in note: return 'VIGILANCE'
    if '角色扮演' in note or '角色' in source_ref: return 'ROLE_PLAY'
    return 'NONE'

def determine_observation(qid: str, content_json: dict) -> bool:
    return '_OB_' in qid or '嵌入式观察' in content_json.get('prompt', '')
```

---

## 6. dry-run 报告输出格式

dry-run 模式运行完整清洗流程但不写库，输出以下报告：

### 6.1 对账矩阵

```
模块×题型矩阵（须与审查报告 §0 一致）：
         SC   TF   DG   OP   OB   合计
M1       14   12    6   15    1    48
M2       12   10    4   15    0    41
M3       24   12    6   16    0    58
M4       12   10    5   21    0    48
M5       20   12    6   15    2    55
M6       14   12    7   15    0    48
合计     96   68   34   97    3   298
```

不一致时报错并输出差异行。

### 6.2 数据质量报告

```yaml
- ability_tags_cleaned: 121  # "0"/"1" → []
- note_status_cleaned: 96   # "ACTIVE" 从 note 丢弃
- media_brief_prefix_fixed: 30  # 前导逗号去除
- scoring_type_migrated:
    DRAG_PARTIAL_to_ORDER_MATCH: 28
    DRAG_PARTIAL_to_MAPPING_MATCH: 6
    RUBRIC_BASED_to_OFFLINE_RUBRIC: 97
    RUBRIC_BASED_to_NO_SCORE: 3
- answer_key_suspicious: ["M1_TF_015"]
- observation_items_identified: ["M1_OB_048", "M5_OP_048", "M5_OP_055"]
- variant_types_detected:
    INTERRUPT: 4
    DISTRACTION: 1
    PLANTED_ERROR: 3
    TIME_LIMITED: 1
    VIGILANCE: 1
    ROLE_PLAY: 5
    SCAFFOLD_PAIR: 6
    CLERICAL_PARALLEL: 6
```

### 6.3 素材缺口清单

```
media_brief 有值但无素材绑定：200/298
其中固定示范卷 24 题素材状态：
  TEXT_ONLY (无需素材): 8
  IMAGE_CARD (需制作): 10
  未决: 6
```

### 6.4 SC 答案位置分布

```
正确答案分布: A=32 (33%), B=57 (59%), C=7 (7%)
[WARNING] C 位严重偏低，建议后续版本调整
```

### 6.5 Rubric 锚点缺口

```
需三档锚点但当前仅通用模板: 97/97 (100%)
状态: 全部标记 rubric_anchor_status=PENDING
固定示范卷 6 题锚点: 见 03-job-skill-demo-paper-spec.md §7
```

### 6.6 域隔离验证

```
bank_domain=JOB_SPECIFIC 且 module_type IS NOT NULL: 0 (PASS)
bank_domain=JOB_SPECIFIC 且 job_module_code IS NULL: 0 (PASS)
基础能力组卷模拟命中 M1-M6 题: 0 (PASS)
```

---

## 7. 导入执行顺序

1. **备份**：导出现有 question_bank 全量 + action_log.jsonl 备份
2. **清库判断**：确认 295 条 ACTIVE 是否被 assessment_session 引用
   - 无引用 → 物理 DELETE question_bank WHERE bank_domain='JOB_SPECIFIC'
   - 有引用 → UPDATE status='ARCHIVED' + 新 ID 重建（不物理删除）
3. **dry-run**：运行导入脚本 `--dry-run`，生成 §6 报告
4. **人工确认**：核对对账矩阵、素材缺口、答案键标记
5. **正式导入**：运行导入脚本（无 dry-run 标志），298 条全 DRAFT 写入
6. **写事件**：每条写入对应 `QUESTION_IMPORTED` 事件到 action_log.jsonl
7. **验证**：运行隔离验证（§6.6）+ 固定示范卷前置校验（03 文档 §9）

---

## 8. 错误码与阻断规则

导入脚本遇以下情况必须终止（不允许跳过继续）：

| 错误码 | 条件 | 处理 |
|---|---|---|
| IMP_E001 | question_id 重复 | 终止 |
| IMP_E002 | question_type 不在合法枚举 | 终止 |
| IMP_E003 | job_module_code 映射失败（旧 module_type 无对应） | 终止 |
| IMP_E004 | content_json 解析失败 | 终止 |
| IMP_E005 | scoring_rule_json 解析失败 | 终止 |
| IMP_E006 | 对账矩阵不匹配 | 终止 |

以下为警告（记录但不阻断）：

| 警告码 | 条件 |
|---|---|
| IMP_W001 | ability_tags 含非法值（已自动清洗） |
| IMP_W002 | note 含状态值（已丢弃） |
| IMP_W003 | media_brief 有值但无素材 |
| IMP_W004 | rubric 缺三档锚点（DRAFT 允许，ACTIVE 不允许） |
| IMP_W005 | SC 位置分布偏斜 |

---

## 9. DRAFT → ACTIVE 门禁（导入后逐题放行）

导入后题目全为 DRAFT。转 ACTIVE 须逐题满足：

1. answer_key_status = VERIFIED 或 CORRECTED（自动评分题）
2. rubric 三档锚点完整（线下题）
3. 所有 required 素材 ACTIVE + hash 一致
4. renderer registry 已注册
5. 专业审查通过（safety_sensitive / 角色扮演 / 嵌入观察）
6. bank_domain / job_module_code / question_type 域配对 CHECK 通过
7. validateQuestionContract() 15 条规则全通过

禁止批量 UPDATE status='ACTIVE' 脚本。

---

## 10. [!] 发现与冲突标记

1. **[!] 对账矩阵中 OB 归类**：审查报告 v2 §0 将 OB 计数为 M1:1 / M5:2，但实际数据中 M5_OP_048 和 M5_OP_055 的 question_type 仍为 OFFLINE_OPERATION（而非单独的类型）。重导时应根据 item_usage=OBSERVATION_ONLY 标记来区分，对账报告仍按 question_type 物理统计（97 OP + 3 OB 被识别为 OP 中的子集）。
2. **[!] variant_group_id 配对表尚未定稿**：支架版 6 条和文职平行版 6 条的具体配对关系需要手册 v1.0 确认。本文档给出推荐映射但标记 [需人工确认]。
3. **[!] 观察项 ID 命名决策**：PRD v1.0.9 §5.3.13 使用 M5_OP_048/M5_OP_055 原 ID，但命名规范建议 _OB_ 前缀。如改名则需同步修改 question_policy_json 种子。
