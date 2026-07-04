# 5.3 题库与资源 Mini-PRD

**工程基线**：schema v0.1.10-scoring-closure | PRD v1.0.6
**前置依赖**：5.1 学生档案（已交付）、5.2 strategy_config（已交付）
**后续依赖方**：5.4 测评功能真实端到端验收、线下实操评分、报告
**当前目标**：把 `通用基础能力评估题库.xlsx` 与题库图片资产推进到可被组卷服务安全读取的 `question_bank` / `asset_resource` 数据基线。

---

## 功能名称

5.3 题库与资源 —— 基础能力题库导入、图片资源登记、题目审核门禁。

---

## 解决的问题

1. **测评功能缺少真实题库**：5.4 测评组卷已经读取 `question_bank`，但当前端到端验证仍依赖 mock 题库；真实测评需要每模块至少 7 道 `ACTIVE` 线上题和至少 8 道 `ACTIVE` 线下实操题。
2. **题库源文件需要可追溯入库**：PRD 要求题库源统一为 `通用基础能力评估题库.xlsx` 导出的 CSV，导入后默认 `DRAFT`，并在 `content_json.source` 写入批次、源文件、源行号、导入人和导入时间。
3. **图片资源与题目引用需要闭环**：图片素材已经有部分 seed 脚本和 DRAFT 拖拽题，但资源 URI 口径、题目 JSON 引用、资源状态、文件 hash 校验需要成为统一验收口径。
4. **上线门禁缺失**：题目不能因为“已导入”就参与组卷；必须经过内容、答案、rubric、素材、感官标签、安全标记审核后才能从 `DRAFT` 转为 `ACTIVE`。

---

## 用户角色

| 角色 | 职责 |
|---|---|
| **ADMIN** | 执行题库导入 / seed、登记资源、运行审核门禁检查、将合格题转为 `ACTIVE` |
| **TEACHER** | 参与内容审核，确认题干、答案、rubric 和线下教具说明是否适合课堂使用 |
| **SYSTEM** | 校验 CSV / JSON / asset 引用 / ACTIVE 题量门禁，阻止不合格题进入组卷 |
| **STUDENT** | 不直接参与题库维护；在测评中消费已审核题目 |

---

## 核心使用场景

### 场景 A：导入题库源表为 DRAFT

1. ADMIN 将 `doc/通用基础能力评估题库.xlsx` 导出为受控 CSV，或通过脚本读取源表并按同一字段映射处理。
2. 导入脚本按 PRD §5.3.1 映射模块、题型、难度、题干、考察点、能力标签、素材说明、计分规则和备注。
3. 每道题生成稳定 `question_id`，例如 `Q_BASE_FINE_MOTOR_TF_001`。
4. 每道题写入 `question_bank`，默认 `status='DRAFT'`。
5. `content_json.source` 写入 `import_batch_id`、`source_file`、`source_row`、`imported_at`、`imported_by`。
6. 导入过程输出批次摘要：导入总数、按模块 / 题型统计、失败行、待人工审核原因。

### 场景 B：登记图片与教具资源

1. ADMIN 使用 `doc/features/question-bank-image-asset-seed-input.tsv` 或后续同类输入登记图片资源。
2. 系统校验每个 `local_path` 文件存在，计算 `SHA-256`、文件大小、宽高和 MIME 类型。
3. 合格资源 upsert 到 `asset_resource`，`status` 默认为 `ACTIVE`。
4. 题目只保存 `asset_id`：主图走 `question_bank.media_asset_id`，判断题变体走 `content_json.variants[].media_asset_id`，拖拽子素材走 `content_json.drag_items[].image_asset_id`。
5. 渲染层通过 `app://asset/<asset_id>` 访问资源，不直接暴露本地绝对路径。

### 场景 C：审核 DRAFT 题并转为 ACTIVE

1. ADMIN 运行题库审核检查，逐题验证 `content_json`、`scoring_rule_json`、题型一致性、素材引用和 rubric。
2. 线上题必须可自动二值判分：正确得 2 分，错误得 0 分。
3. 线上题 rubric 若含“经提示 / 犹豫 / 提示后”等过程观察描述，不得转 `ACTIVE`，必须改写为自动判分标准或改为 `OFFLINE_OPERATION`。
4. 判断题必须补齐 `expected_answer`，或明确 `variants[]` 中每个变体的 `expected_answer` 和素材。
5. 资源引用必须存在于 `asset_resource` 且 `status='ACTIVE'`。
6. 合格题才能转 `ACTIVE`；不合格题保留 `DRAFT` 并输出原因。

### 场景 D：组卷上线门禁

1. ADMIN 运行上线门禁检查。
2. 系统统计 `job_code='SUPERMARKET_SHELVER'` 的 `ACTIVE` 题量。
3. 6 大模块每模块 `ACTIVE` 线上题必须 ≥ 7，道题类型可被现有 `strategy_config.question_policy_json` 组出 42 道线上题。
4. 全库 `ACTIVE` 线下实操题必须 ≥ 8，且有主归属模块标注。
5. 不满足门禁时，5.4 测评入口应继续返回 `QUESTION_BANK_INSUFFICIENT`，不得静默降级。

---

## 功能范围

### 本次做

1. **题库导入规格与脚本入口**
   - 从题库源表生成 `question_bank` DRAFT 数据。
   - 支持 dry-run，输出 SQL 或直接写入指定 SQLite DB。
   - 生成批次摘要，保留失败行原因。

2. **JSON 与 scoring 运行时校验**
   - 复用并补强 `validateContentJson()`。
   - 新增或复用 `scoring_rule_json` 校验，确保线上题 `max_score=2`、二值判分。
   - 校验 `content_json.question_type === question_bank.question_type`。

3. **资源接入一致性**
   - 统一当前代码口径：渲染层使用 `app://asset/<asset_id>`。
   - [!] 现有文档 / TSV 中的 `app://assets/question-media/...` 与代码实现不一致；本功能需要决定是迁移 seed 数据到 `app://asset/<asset_id>`，还是扩展协议兼容旧 URI。推荐迁移数据和文档到 `app://asset/<asset_id>`，避免双协议长期并存。
   - 将 `AIimages/` 作为本地素材工作目录，不纳入 Git；可提交的是 `doc/` 中的源文档、TSV、PDF、xlsx、导入说明和 seed 输入。

4. **审核门禁**
   - 提供脚本或主进程服务函数，检查 DRAFT 题是否可转 `ACTIVE`。
   - 检查内容：题干、能力标签、题型、难度、答案、rubric、资源、感官标签、安全敏感标记。
   - 提供批量报告，不自动把不合格题转 `ACTIVE`。

5. **最小题库可组卷基线**
   - 至少让 `strategy_baseline_shelver_v1` 能组出线上 42 题 + 线下 8 题。
   - 若源题库数量或素材不足，必须在 PRD / 实现文档中列明缺口，不伪造题量。

### 本次不做

| 不做项 | 原因 | 后续承接 |
|---|---|---|
| 完整题库管理后台 | MVP 当前缺口是导入与门禁，不是运营后台 | Post-MVP 题库浏览 / 审核界面 |
| 公共模拟卷 / 自定义试卷库 | 当前 schema 未提供正式试卷表 | schema v0.2.0-question-paper |
| 自动从 PDF / Word 抽题 | 题库源已指定为 xlsx / CSV | 如需支持，另开导入工具 |
| 自动生成缺失题目或素材 | 会污染题库事实来源 | 生图会话 / 内容审核会话 |
| 安全红线逻辑变更 | `SAFETY_OPERATION` 题答错不等于红线 | 红线仍由 safety_incident 流程处理 |
| 线下实操评分 UI | 5.3 只准备 `OFFLINE_OPERATION` 题库 | 线下实操评分功能 |

---

## 边界条件和异常处理

| 场景 | 处理 |
|---|---|
| 源文件缺列或列名变化 | dry-run 失败，列出缺失列，不写 DB |
| 模块标题无法映射 | 该行失败并保留源行号 |
| 题型无法映射 | 该行失败并保留源行号 |
| 难度无法映射 | 该行失败并保留源行号 |
| `content_json.question_type` 与列字段不一致 | 拒绝写入 |
| `content_json` 不符合 JSON 字段规范 | 拒绝写入或保持 `DRAFT` 并输出原因 |
| `scoring_rule_json` 缺失或不合法 | 不得转 `ACTIVE` |
| 判断题没有 `expected_answer` | 不得转 `ACTIVE` |
| 单选题选项少于 2 个或答案不在选项内 | 不得转 `ACTIVE` |
| 拖拽题缺 `drag_items` / `drop_zones` / `accepts` | 不得转 `ACTIVE` |
| 线下题缺 `offline_tool_brief` / `rubric_criteria` | 不得转 `ACTIVE` |
| JSON 中引用的 `asset_id` 不存在 | 不得转 `ACTIVE` |
| 引用资源 `status <> ACTIVE` | 不得转 `ACTIVE` |
| 文件 hash 与登记值不一致 | 标记资源 `CORRUPTED` 或报告失败，不参与组卷 |
| v001 历史总览图仍 `ACTIVE` 但无引用 | 应转 `DEPRECATED` 或明确保留理由 |
| 题目已被 `answer_record` 或 `assessment_session_question` 引用后尝试改语义字段 | schema trigger 拦截；必须新建题目并 `superseded_by_question_id` 追溯 |
| ACTIVE 题量不足 | 门禁失败；测评仍返回 `QUESTION_BANK_INSUFFICIENT` |

---

## 与现有功能的接口关系

| 现有功能 | 接口 | 方向 |
|---|---|---|
| **strategy_config（5.2）** | 按 `question_policy_json` 检查 ACTIVE 题量是否满足组卷 | 读 |
| **assessment（5.4）** | `assessment:createSession` 读取 `question_bank WHERE status='ACTIVE'` | 被读 |
| **asset_resource** | 题目素材引用必须存在且 `status='ACTIVE'` | 写 + 读 |
| **app asset protocol** | `src/main/protocol/app-asset.ts` 已实现 `app://asset/<asset_id>` | 对齐 URI 口径 |
| **JSON 字段规范** | `doc/xc-career-guide-json-field-schema-v1.0.0.md` + `src/shared/types/json-schemas.ts` | 遵循 / 补强 |
| **content_json 校验器** | `src/main/utils/validate-content-json.ts` | 复用 / 扩展 |
| **题库图片 seed** | `scripts/seed-question-bank-image-assets.mjs`、`scripts/seed-question-bank-image-drag-questions.mjs` | 复用 / 整合 |

---

## 成功验收标准

### 导入验收

1. 支持从题库源表生成 `question_bank` DRAFT 数据。
2. 每道导入题都有稳定 `question_id`，不使用随机 UUID 作为主要识别来源。
3. 每道导入题都有 `content_json.source`，包含 `import_batch_id`、`source_file`、`source_row`、`imported_at`、`imported_by`。
4. 导入后默认 `status='DRAFT'`。
5. 导入摘要能按模块、题型、状态统计题量。

### JSON / scoring 验收

6. `content_json.question_type` 必须与 `question_bank.question_type` 一致。
7. 6 大模块映射正确。
8. 4 类题型映射正确。
9. 难度映射为 `1 / 3 / 5` 或 schema 允许的 `1..5` 数值。
10. 线上题 `scoring_rule_json` 必须符合二值判分：正确 2 分，错误 0 分。
11. `OFFLINE_OPERATION` 题保留 `0 / 1 / 2` 三档 rubric。

### 资源验收

12. 所有写入题目 JSON 的 `asset_id` 必须存在于 `asset_resource`。
13. 可参与组卷的题目所需资源必须 `status='ACTIVE'`。
14. 渲染层可用 `app://asset/<asset_id>` 加载至少一张已登记图片。
15. `AIimages/` 不进入 Git；源文档和 seed 输入保留在 `doc/`。

### 审核与门禁验收

16. 未补齐答案的判断题不得转 `ACTIVE`。
17. 未补齐 `scoring_rule_json` 的题目不得转 `ACTIVE`。
18. 未绑定必需素材资源的题目不得转 `ACTIVE`。
19. 资源 hash 校验失败的题目不得转 `ACTIVE`。
20. 安全操作题答错只按评分规则记分，不自动创建 `safety_incident`。
21. MVP 上线门禁：6 大模块每模块 `ACTIVE` 线上题 ≥ 7 道。
22. MVP 上线门禁：全库 `ACTIVE` 线下实操题 ≥ 8 道，且有主归属模块标注。
23. 门禁不足时，5.4 测评入口不得开放真实组卷，应继续走 `QUESTION_BANK_INSUFFICIENT`。

### 回归验收

24. 现有 `paper-generator` 单测仍通过。
25. 现有 `assessment:createSession` 题库不足分支仍通过。
26. 现有 `app-asset` 协议单测仍通过。

---

## 方案比较

| 方案 | 内容 | 优点 | 缺点 | 结论 |
|---|---|---|---|---|
| A. 脚本优先的 5.3 最小闭环 | 导入脚本 + 校验器 + 门禁脚本 + 资源 URI 口径统一 | 最快补齐 5.4 端到端依赖，改动集中，适合 MVP | 暂无可视化审核后台 | 推荐 |
| B. 管理后台优先 | 做题库浏览、审核、编辑页面 | 运营体验更完整 | 范围大，容易越过 MVP，且仍要先写导入与校验 | 不推荐本轮 |
| C. 只修图片资源链路 | 只处理 `asset_resource` 和图片显示 | 小步快 | 不能解决真实题库不足，5.4 仍无法端到端 | 仅作为 A 的子步骤 |

---

## 风险点（[!] 高风险项）

1. **[!] 文档 / 实现 URI 口径不一致**：图片文档和 TSV 使用 `app://assets/question-media/...`，当前代码实际实现和渲染层使用 `app://asset/<asset_id>`。实现前必须统一，否则 DB 中的 `app_uri` 字段会误导后续接入。
2. **[!] 题库 ACTIVE 门禁影响 5.4 入口**：一旦将题转为 `ACTIVE`，测评组卷会真实消费这些题。校验不足会直接污染学生答题体验。
3. **[!] 题目冻结触发器已生效**：被 session 或 answer 引用的题目不能原地改语义字段；导入脚本必须避免覆盖历史事实。
4. **[!] 线上 rubric 二值化**：源题库若含过程观察描述，不能简单照抄为线上自动判分规则。
5. **[!] 图片资源不进 Git**：`AIimages/` 是本地工作目录，若验收依赖真实图片文件，必须说明运行环境需要已有本地素材或提供可复建流程。

---

## Reviewer 自审记录

由于当前多代理工具要求“用户明确授权子代理”后才能 spawn，本轮未启动 Reviewer subagent。主代理按 `/vibe-feature` 审查点自审：

1. **与 PRD v1.0.6 范围一致**：本 PRD 只覆盖 5.3 题库与资源，不引入完整试卷系统、题库管理后台或报告。
2. **边界条件覆盖**：空数据、字段映射失败、资源缺失、hash 失败、ACTIVE 题量不足、冻结题修改均有处理。
3. **安全规则一致**：`SAFETY_OPERATION` 题答错不自动触发红线，安全红线仍走 `safety_incident`。
4. **结果体系不受影响**：不修改 `result_record`、`level_result` 或评分等级枚举。
5. **高风险项已标注**：URI 口径、ACTIVE 门禁、题目冻结、rubric 二值化、图片不进 Git 均标为 [!]。
