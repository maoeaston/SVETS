# 5.3 题库与资源 实现文档

对应 Mini-PRD：`doc/features/question-bank-resources-prd.md`
工程基线：schema v0.1.10-scoring-closure | PRD v1.0.6
分支：`feat/question-bank-resources`
高风险：[!] 题库 `ACTIVE` 门禁会直接影响 5.4 真实组卷；图片 URI 口径需先统一。

---

## 实现目标（一句话）

交付脚本优先的 5.3 最小闭环：统一图片资源访问口径、补齐题库 JSON / scoring 校验、将题库源 CSV 导入为 `DRAFT`、通过审核门禁把合格题转为 `ACTIVE`，让 5.4 能用真实 `question_bank` 完成端到端组卷。

---

## 前置条件

- `question_bank`、`asset_resource` 表和题目冻结触发器已存在于 `src/main/db/schema.sql`。
- `assessment:createSession` 已读取 `question_bank WHERE status='ACTIVE'`，题库不足时返回 `QUESTION_BANK_INSUFFICIENT`。
- `src/main/protocol/app-asset.ts` 已实现 `app://asset/<asset_id>`，渲染层 `AssessmentView.vue` 也按该 URI 读取图片。
- `scripts/seed-question-bank-image-assets.mjs` 和 `scripts/seed-question-bank-image-drag-questions.mjs` 已存在，但当前 TSV / 文档仍含旧口径 `app://assets/question-media/...`。
- `AIimages/` 已写入 `.gitignore`，本轮不得把图片二进制纳入 Git。
- 项目禁止引入 CSV 解析库；题库源 CSV 解析使用小型手写解析器。

---

## 实现边界

### 本次做

- 统一题库图片 seed 的 `app_uri` 为 `app://asset/<asset_id>`。
- 建立 `scoring_rule_json` 校验器，并增强 `content_json` 校验。
- 建立题库源 CSV 到 `question_bank DRAFT` 的导入脚本。
- 建立审核门禁脚本：校验 DRAFT 题能否转 `ACTIVE`，并提供批量激活能力。
- 建立上线门禁脚本：验证 6 大模块每模块 `ACTIVE` 线上题 ≥ 7，全库 `ACTIVE` 线下实操题 ≥ 8。
- 保持测评入口在题库不足时继续返回 `QUESTION_BANK_INSUFFICIENT`。

### 本次不做

- 不做题库管理后台。
- 不做公共模拟卷 / 自定义试卷库。
- 不自动生成缺失题目或图片。
- 不修改安全红线事件流。
- 不实现线下实操评分 UI。

---

## 实现步骤（每步对应一个 commit）

### Step 1：统一图片资源 URI 口径

**改动文件：**
- `doc/features/question-bank-image-asset-seed-input.tsv`：把 `app_uri` 全部改为 `app://asset/<asset_id>`。
- `scripts/lib/question-bank-image-asset-seed.mjs`：校验 `app_uri === app://asset/${asset_id}`。
- `scripts/__tests__/seed-question-bank-image-assets.test.mjs`：更新示例 URI，并新增旧 URI 拒绝用例。
- `doc/features/question-bank-image-asset-resource-seed-draft.md`：把“渲染层访问 URI”说明改为 `app://asset/<asset_id>`。
- `doc/features/question-bank-image-asset-linking-draft.md`：同步 URI 说明和当前状态。
- `doc/features/question-bank-image-integration-checklist.md`：同步验收项，不再说主进程缺少协议实现。

**核心逻辑：**

当前代码的真实协议是：

```text
app://asset/<asset_id>
```

本步骤不扩展 `app://assets/question-media/...` 兼容层，直接迁移 seed 输入和文档。`asset_resource.app_uri` 保留为稳定展示 URI，但它必须与 `asset_id` 一一对应，避免同一资源存在两套访问口径。

`validateAssetSeedRows()` 新增规则：

```javascript
const expectedAppUri = `app://asset/${assetId}`
if (row.app_uri !== expectedAppUri) {
  throw new Error(`[asset-seed] ${assetId} app_uri must be ${expectedAppUri}`)
}
```

**测试用例：**
- 单元测试：`app://asset/asset_img_demo` 通过。
- 单元测试：`app://assets/question-media/demo.png` 失败，错误信息包含 `app_uri must be app://asset/`。
- 回归测试：DRG-OBJ02 总览图仍必须是 `placeholder_only`。
- 手工检查：`rg -n "app://assets/question-media" doc/features scripts` 只允许历史说明保留在“旧口径说明”段，不能出现在 seed 输入或测试数据中。

**验证命令：**

```bash
npm run test -- scripts/__tests__/seed-question-bank-image-assets.test.mjs src/main/protocol/__tests__/app-asset.test.ts
rg -n "app://assets/question-media" doc/features scripts
```

**commit message 建议：**

```text
fix(question-bank): 统一图片资源 app_uri 口径
```

---

### Step 2：补齐题库 JSON 与 scoring 校验器

**改动文件：**
- `src/main/utils/validate-scoring-rule-json.ts`：新建 `validateScoringRuleJson(input, questionType)`。
- `src/main/utils/__tests__/validate-scoring-rule-json.test.ts`：新增单元测试。
- `src/main/utils/validate-content-json.ts`：增强 `source`、`SINGLE_CHOICE`、`DRAG`、`OFFLINE_OPERATION` 深度校验。
- `src/main/utils/__tests__/validate-content-json.test.ts`：扩展覆盖。
- `src/shared/types/json-schemas.ts`：确认类型与校验器一致；若发现 `ScoringRuleDrag.partial_correct_score` 与 PRD v1.0.6 二值化不一致，只允许改为 `0`。

**核心逻辑：**

`validateScoringRuleJson()` 是纯函数，无 DB 依赖：

```typescript
export type ScoringRuleValidationResult =
  | { ok: true }
  | { ok: false; reason: string }

export function validateScoringRuleJson(
  input: unknown,
  questionType: 'TRUE_FALSE' | 'SINGLE_CHOICE' | 'DRAG' | 'OFFLINE_OPERATION'
): ScoringRuleValidationResult
```

规则：
- `TRUE_FALSE` / `SINGLE_CHOICE`：`scoring_type='EXACT_MATCH'`，`max_score=2`，`correct_score=2`，`incorrect_score=0`。
- `DRAG`：`scoring_type='DRAG_PARTIAL'`，`max_score=2`，`all_correct_score=2`，`partial_correct_score=0`，`incorrect_score=0`。
- `OFFLINE_OPERATION`：`scoring_type='OFFLINE_RUBRIC'`，`max_score=2`，`score_labels` 必须包含 `'0' / '1' / '2'`，`criteria` 非空且 `criterion_id` 不重复。

`validateContentJson()` 增强规则：
- `source` 若存在，必须包含 `import_batch_id`、`source_file`、`source_row`、`imported_at`、`imported_by`。
- `SINGLE_CHOICE.expected_answer` 必须命中 `options[].key`，`options[].key` 不重复。
- `DRAG.drag_items[].item_id` 不重复；`drop_zones[].accepts[]` 必须引用存在的 `item_id`。
- `OFFLINE_OPERATION.rubric_criteria[].criterion_id` 不重复。
- 所有 JSON 中的 `question_type` 继续必须合法；跨字段“与 `question_bank.question_type` 一致”在 Step 4 的门禁函数中校验。

**测试用例：**
- `EXACT_MATCH` 合法通过；`correct_score=1` 失败。
- `DRAG_PARTIAL.partial_correct_score=1` 失败（PRD v1.0.6 要求线上二值化）。
- `OFFLINE_RUBRIC` 三档 label + criteria 合法通过。
- `OFFLINE_RUBRIC.criteria=[]` 失败。
- `SINGLE_CHOICE.expected_answer='D'` 但无 D 选项失败。
- `DRAG.drop_zones[].accepts` 引用不存在 item 失败。
- `source.source_row=0` 失败。

**验证命令：**

```bash
npm run test -- src/main/utils/__tests__/validate-content-json.test.ts src/main/utils/__tests__/validate-scoring-rule-json.test.ts
npm run typecheck
```

**commit message 建议：**

```text
feat(question-bank): 补齐题目内容与计分规则校验
```

---

### Step 3：实现题库源 CSV 到 DRAFT 的导入脚本

**改动文件：**
- `scripts/lib/question-bank-source-seed.mjs`：新建 CSV 解析、字段映射、题目行构造、SQL 生成函数。
- `scripts/seed-question-bank-source.mjs`：新建 CLI 脚本。
- `scripts/__tests__/seed-question-bank-source.test.mjs`：新增脚本库单元测试。
- `doc/features/question-bank-source-csv-template.md`：新建 CSV 列模板和导出要求。

**核心逻辑：**

输入 CSV 列名使用 PRD §5.3.1 口径：

```text
模块标题,题型标题,考察点,题目,素材内容描述,能力维度标签,考察难度,计分规则,备注
```

导入脚本用法：

```bash
node scripts/seed-question-bank-source.mjs --csv /abs/path/question-bank.csv --dry-run
node scripts/seed-question-bank-source.mjs --csv /abs/path/question-bank.csv --out /tmp/question_bank.sql
node scripts/seed-question-bank-source.mjs --csv /abs/path/question-bank.csv --db /abs/path/xc-career-guide.db
```

`scripts/lib/question-bank-source-seed.mjs` 导出：

```javascript
export function parseCsv(text)
export function mapSourceRow(row, ctx)
export function buildQuestionBankDraftUpsertSql(rows)
export function summarizeQuestionRows(rows)
```

映射规则：
- 模块标题：
  - `精细动作能力` → `FINE_MOTOR`
  - `认知理解能力` → `COGNITION`
  - `规则执行能力` → `RULE_EXECUTION`
  - `情绪调节能力` → `EMOTION_REGULATION`
  - `基础社交能力` → `BASIC_SOCIAL`
  - `安全操作能力` → `SAFETY_OPERATION`
- 题型标题：
  - `判断题` → `TRUE_FALSE`
  - `单项选择题` → `SINGLE_CHOICE`
  - `拖拽题` → `DRAG`
  - `实物操作题` / `实操题` → `OFFLINE_OPERATION`
- 难度：
  - `低级` → `1`
  - `中级` → `3`
  - `高级` → `5`

`question_id` 生成：

```text
Q_BASE_<MODULE>_<TYPE_ABBR>_<NNN>
```

其中 `TYPE_ABBR` 为 `TF / SC / DRAG / OFFLINE`，`NNN` 是同模块同题型内递增序号。导入脚本必须按源行顺序稳定生成；同一 CSV 多次 dry-run 输出一致。

导入默认：
- `job_code='SUPERMARKET_SHELVER'`
- `status='DRAFT'`
- `version=1`
- `media_asset_id=NULL`
- `tool_asset_ids_json=NULL`
- `sensory_tags_json=NULL`

线上题若无法从源 CSV 可靠抽取答案，仍可写入 `DRAFT`，但 `content_json` 必须保留 `source`，审核门禁会阻止其转 `ACTIVE`。

**测试用例：**
- 手写 CSV 解析支持逗号、双引号和换行字段。
- 模块 / 题型 / 难度正常映射。
- 未知模块失败，错误包含源行号。
- 未知题型失败，错误包含源行号。
- 重复运行同一 CSV，生成的 `question_id` 序列一致。
- 生成 SQL 包含 `INSERT INTO question_bank`、`ON CONFLICT(question_id) DO UPDATE`，并写入 `status='DRAFT'`。
- 导入摘要按模块和题型统计。

**验证命令：**

```bash
npm run test -- scripts/__tests__/seed-question-bank-source.test.mjs
node scripts/seed-question-bank-source.mjs --csv /tmp/question-bank-sample.csv --dry-run
```

**commit message 建议：**

```text
feat(question-bank): 添加题库源表 DRAFT 导入脚本
```

---

### Step 4：实现题库审核门禁与批量激活脚本

**改动文件：**
- `scripts/lib/question-bank-review-gate.mjs`：新建审核门禁纯函数和 SQL 构造。
- `scripts/review-question-bank.mjs`：新建 CLI 脚本。
- `scripts/__tests__/question-bank-review-gate.test.mjs`：新增单元测试。
- `doc/features/question-bank-review-checklist.md`：新建人工审核清单。

**核心逻辑：**

脚本用法：

```bash
node scripts/review-question-bank.mjs --db /abs/path/xc-career-guide.db --report /tmp/question-bank-review.json
node scripts/review-question-bank.mjs --db /abs/path/xc-career-guide.db --activate --batch batch_20260704_001
```

审核门禁检查项：
- `content_json` 可解析。
- `content_json.question_type === question_bank.question_type`。
- `scoring_rule_json` 可解析且符合 Step 2 规则。
- `content_json.source` 存在且完整。
- `ability_tags` 至少一个，且包含 `question_bank.module_type` 或明确由 `module_type` 作为主归属。
- `TRUE_FALSE.expected_answer` 必须为 boolean；若有 `variants`，每个 variant 都有 `media_asset_id` 和 `expected_answer`。
- `SINGLE_CHOICE.options` 至少 2 个且答案命中选项。
- `DRAG.drag_items` / `drop_zones` 结构完整。
- `OFFLINE_OPERATION.offline_tool_brief` / `rubric_criteria` 完整。
- `question_bank.media_asset_id`、`variants[].media_asset_id`、`options[].image_asset_id`、`drag_items[].image_asset_id` 所有引用都能在 `asset_resource` 找到且 `status='ACTIVE'`。
- 线上题 rubric 文本不得包含 `经提示`、`犹豫`、`提示后`。

批量激活规则：
- 默认只输出报告，不修改 DB。
- 传 `--activate` 时只把全部检查通过的 `DRAFT` 题转为 `ACTIVE`。
- 已被引用的题目不更新语义字段；本脚本只允许改 `status` 和 `updated_at`。
- `--batch` 可限制只处理 `content_json.source.import_batch_id` 匹配的题目。

报告格式：

```json
{
  "checked": 50,
  "eligible": 42,
  "blocked": 8,
  "items": [
    {
      "question_id": "Q_BASE_FINE_MOTOR_TF_001",
      "status": "BLOCKED",
      "reasons": ["TRUE_FALSE expected_answer missing"]
    }
  ]
}
```

**测试用例：**
- 合格 TRUE_FALSE 题通过。
- `content_json.question_type` 与行字段不一致失败。
- `scoring_rule_json.partial_correct_score=1` 的 DRAG 失败。
- JSON 中引用不存在 asset 失败。
- 引用 `DEPRECATED` asset 失败。
- 线上 rubric 含 `经提示` 失败。
- `--activate` 只生成合格题的 `UPDATE question_bank SET status='ACTIVE'` SQL。

**验证命令：**

```bash
npm run test -- scripts/__tests__/question-bank-review-gate.test.mjs
node scripts/review-question-bank.mjs --db /tmp/xc-career-guide.db --report /tmp/question-bank-review.json
```

**commit message 建议：**

```text
feat(question-bank): 添加题库审核门禁脚本
```

---

### Step 5：实现组卷上线门禁脚本

**改动文件：**
- `scripts/lib/question-bank-launch-gate.mjs`：新建 ACTIVE 题量门禁统计函数。
- `scripts/check-question-bank-launch-gate.mjs`：新建 CLI 脚本。
- `scripts/__tests__/question-bank-launch-gate.test.mjs`：新增单元测试。
- `doc/features/question-bank-launch-gate.md`：新建上线门禁说明。

**核心逻辑：**

脚本用法：

```bash
node scripts/check-question-bank-launch-gate.mjs --db /abs/path/xc-career-guide.db
node scripts/check-question-bank-launch-gate.mjs --db /abs/path/xc-career-guide.db --job SUPERMARKET_SHELVER
```

门禁条件：
- 对 `TRUE_FALSE / SINGLE_CHOICE / DRAG` 视为线上题。
- 每个 `module_type` 的 `ACTIVE` 线上题数 ≥ 7。
- `OFFLINE_OPERATION` 的 `ACTIVE` 题数 ≥ 8。
- `OFFLINE_OPERATION.content_json.ability_tags` 非空。
- 输出按模块、题型、状态统计。
- 任一条件失败时进程退出码为 `1`，成功为 `0`。

**测试用例：**
- 6 模块每模块 7 道线上题 + 8 道线下题 → 通过。
- `FINE_MOTOR` 只有 6 道线上题 → 失败，报告指出该模块缺 1 道。
- 线下题只有 7 道 → 失败。
- 线下题 `ability_tags=[]` → 失败。
- `DRAFT` 题不计入门禁。

**验证命令：**

```bash
npm run test -- scripts/__tests__/question-bank-launch-gate.test.mjs
node scripts/check-question-bank-launch-gate.mjs --db /tmp/xc-career-guide.db
```

**commit message 建议：**

```text
feat(question-bank): 添加 ACTIVE 题量上线门禁
```

---

### Step 6：端到端验收与交接收口

**改动文件：**
- `doc/features/question-bank-resources-prd.md`：若实现中发现 PRD 边界需要澄清，只做最小补充。
- `doc/features/question-bank-resources-impl.md`：勾选已完成步骤或补充实际验证命令。
- `.continue-here.md`：更新当前状态和下一步。

**核心逻辑：**

本步骤不新增业务能力，只做验收收口：

1. 运行全部新增脚本单测。
2. 运行已有相关回归。
3. 用小样本 CSV dry-run 生成 DRAFT SQL。
4. 在临时 DB 或开发 DB 上执行：资源 seed → 题库源导入 → 审核报告 → 组卷门禁。
5. 确认真实题库不足时，5.4 仍返回 `QUESTION_BANK_INSUFFICIENT`。

**验证命令：**

```bash
npm run test -- \
  scripts/__tests__/seed-question-bank-image-assets.test.mjs \
  scripts/__tests__/seed-question-bank-source.test.mjs \
  scripts/__tests__/question-bank-review-gate.test.mjs \
  scripts/__tests__/question-bank-launch-gate.test.mjs \
  src/main/utils/__tests__/validate-content-json.test.ts \
  src/main/utils/__tests__/validate-scoring-rule-json.test.ts \
  src/main/protocol/__tests__/app-asset.test.ts \
  src/main/domain/__tests__/paper-generator.test.ts \
  src/main/ipc/handlers/__tests__/assessment-create.test.ts
npm run typecheck
npm run lint
npm run build
```

**手工验收点：**
- `AIimages/` 不出现在 `git status --short`。
- `doc/features/question-bank-image-asset-seed-input.tsv` 中所有 `app_uri` 均为 `app://asset/<asset_id>`。
- 资源 seed 后，`scripts/smoke-test-app-protocol.mjs` 能读取至少一张图片。
- 审核门禁报告中，不合格 DRAFT 题明确列出原因。
- 上线门禁失败时输出缺口，不静默通过。

**commit message 建议：**

```text
chore(question-bank): 收口题库与资源验收交接
```

---

## 回归验收清单

- [ ] `npm run test -- scripts/__tests__/seed-question-bank-image-assets.test.mjs`
- [ ] `npm run test -- scripts/__tests__/seed-question-bank-source.test.mjs`
- [ ] `npm run test -- scripts/__tests__/question-bank-review-gate.test.mjs`
- [ ] `npm run test -- scripts/__tests__/question-bank-launch-gate.test.mjs`
- [ ] `npm run test -- src/main/utils/__tests__/validate-content-json.test.ts src/main/utils/__tests__/validate-scoring-rule-json.test.ts`
- [ ] `npm run test -- src/main/protocol/__tests__/app-asset.test.ts`
- [ ] `npm run test -- src/main/domain/__tests__/paper-generator.test.ts`
- [ ] `npm run test -- src/main/ipc/handlers/__tests__/assessment-create.test.ts`
- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm run build`
- [ ] 手工冒烟：资源 seed → 题库 DRAFT 导入 → 审核门禁 → 上线门禁。

---

## 项目约束检查（Writer 自检）

- [x] 事件写入顺序：本功能不新增业务事件，不写 `action_log.jsonl`。
- [x] 新 EventType：本功能不新增 EventType。
- [x] 新 IPC 通道：本功能采用脚本优先，不新增 IPC 通道。
- [x] 无硬编码题量 / 阈值：上线门禁的 `7` 与 `8` 来自 PRD v1.0.6 的 5.3 验收；后续若策略变化，需在实现中优先读取 `strategy_config.question_policy_json` 做二次校验。
- [x] FSM 状态迁移：本功能不改 `assessment_session.status`。
- [x] 安全红线逻辑：不改 `safety_incident`；`SAFETY_OPERATION` 题答错仍只按评分规则记分。
- [x] JSON 字段写入前校验：Step 2 + Step 4 覆盖 `content_json` / `scoring_rule_json`。
- [x] ORM / CSV 库：不引入 ORM，不引入 CSV 解析库。
- [x] 题目冻结：脚本不得更新已引用题目的语义字段；若需要修订，必须新建题目并写 `superseded_by_question_id`。

---

## Reviewer 自审记录

当前多代理工具要求用户明确授权后才能启动 subagent，本轮未启动 Reviewer subagent。主代理按 `/vibe-impl` 审查点自审：

1. **步骤依赖**：URI 口径统一在 Step 1，校验器在 Step 2，导入在 Step 3，审核门禁在 Step 4，上线门禁在 Step 5，验收在 Step 6，顺序可执行。
2. **测试盲区**：每个脚本库都有单元测试；DB 写入路径通过 CLI dry-run + 临时 DB 手工验收覆盖。
3. **项目约束**：不新增 ORM / CSV 库 / IPC / EventType；`AIimages/` 不进 Git；JSON 写入前有校验。
4. **步骤粒度**：每步 3 到 6 个文件；Step 1 文档同步文件较多，但属于同一 URI 口径修正，建议单独提交。
5. **高风险项**：`ACTIVE` 门禁、URI 口径、题目冻结、rubric 二值化均在步骤中有显式处理。
