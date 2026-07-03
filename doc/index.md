# SVETS 文档索引

## 1. 这份文档解决什么问题

这是一份给**新会话 agent** 的最小入口索引，目标不是罗列全部历史材料，而是回答 3 个问题：

1. 现在该先读什么。
2. 某类任务对应哪份文档。
3. 什么时候需要继续下钻到 schema、PRD 或 feature 文档。

使用原则：

- 先读“当前任务必需”的最小集合，不要一上来扩读全部大文档。
- 会话恢复优先看启动 / 结束类文档和 `.continue-here.md`。
- 需要改实现时，再下钻到 feature PRD / impl。
- 需要核对数据结构、事件、JSON 字段时，再下钻到 schema 系列文档。

---

## 2. `doc/` 根目录文档分组

### 2.1 会话恢复与交接

- `doc/会话启动.md`：编码会话开场检查清单，告诉 agent 先读什么、看什么 Git 现场、输出什么启动摘要。
- `doc/会话结束.md`：编码会话收尾交接清单，要求更新 `.continue-here.md`、确认当前 Vibe 步骤，并留下可恢复的下一步。
- `doc/生图启动.md`：生图会话开场清单，重点确认图片资产基线、批量计划和资源接入位点。
- `doc/生图结束.md`：生图会话收尾清单，重点记录标准资产、废弃资产、接入草案和下一步。

适用任务：

- 继续上一个编码会话
- 继续图片资产规划或出图会话
- 需要先恢复现场，而不是直接开工

### 2.2 产品与流程基线

- `doc/炫灿-职途向导系统_MVP_PRD_v1.0.5.md`：MVP 产品总说明，定义功能范围、角色、流程、结果模型和验收基线。
- `doc/Vibe Coding.md`：解释本项目采用的 `PRD → 实现文档 → 分步实现 → 验收` 工作流思路。

适用任务：

- 新功能范围判断
- 验收口径不清
- 需要确认某能力是否属于 MVP

### 2.3 数据与约束基线

- `doc/xc-career-guide-mvp-schema-v0.1.7-consistency-guard.sql`：数据库 schema 基线和触发器约束入口，适合核对表、字段、状态机、资源接入位点。
- `doc/xc-career-guide-json-field-schema-v1.0.0.md`：所有 JSON TEXT 字段的结构规范，写 `content_json`、`scoring_policy_json` 等前必须读。
- `doc/xc-career-guide-event-payload-schema-v1.0.0.md`：事件载荷和 JSONL 信封规范，涉及 `action_log.jsonl`、事件写入、回放时必须读。

适用任务：

- 改 SQLite 表、触发器、字段约束
- 写事件、reducer、投影
- 写或校验 JSON 字段
- 核对资产引用是否合法

### 2.4 规划与补充资料

- `doc/MVP 后续全量功能演进备忘录.md`：Post-MVP 路线和未来阶段备忘，不是当前实现入口，只在讨论后续规划时读。
- `doc/通用基础能力评估题库.xlsx`：题库源数据，涉及题库内容、题量、出图素材来源时再读。
- `doc/写好 CLAUDE.md 的 8 条经验.md`：通用提示词 / 上下文工程经验，不是 SVETS 业务实现入口。

适用任务：

- 讨论长期路线
- 题库来源核对
- 优化 agent 工作方式

---

## 3. 编码会话阅读顺序

### 3.1 最小顺序

1. `AGENTS.md`
2. `.continue-here.md`
3. `doc/会话启动.md`
4. 当前任务对应的 `doc/features/*-prd.md`
5. 当前任务对应的 `doc/features/*-impl.md`
6. 如涉及结构约束，再补读：
   - `doc/xc-career-guide-mvp-schema-*.sql`
   - `doc/xc-career-guide-json-field-schema-v1.0.0.md`
   - `doc/xc-career-guide-event-payload-schema-v1.0.0.md`
7. 如涉及产品范围或验收口径，再补读：
   - `doc/炫灿-职途向导系统_MVP_PRD_v1.0.5.md`

### 3.2 什么时候停在最小集合

以下情况通常不需要先读大 PRD / 全量 schema：

- 只是继续上个会话的单一步骤实现
- `.continue-here.md` 已明确下一步唯一原子动作
- 当前只改某个已拆好的 feature 步骤

### 3.3 什么时候必须继续下钻

- 改状态机、红线、事件顺序：读 schema + event payload
- 改 JSON 字段：读 JSON field schema
- 改功能边界、结果口径、验收标准：读主 PRD
- 改 feature 实现：先读对应 feature PRD 和 impl，不要只看代码猜

---

## 4. 生图会话阅读顺序

### 4.1 最小顺序

1. `AGENTS.md`
2. `.continue-here.md`（如果本轮和编码接入有关）
3. `doc/生图启动.md`
4. `doc/features/question-bank-image-plan.md`
5. `doc/features/question-bank-image-batch-plan-v001.json`
6. 如果当前是试跑阶段，再读：
   - `doc/features/question-bank-image-batch-pilot-v001.json`
   - `doc/features/question-bank-image-batch-pilot-acceptance.md`
7. 如果当前要准备接入应用，再读：
   - `doc/features/question-bank-image-asset-linking-draft.md`
   - `doc/features/question-bank-image-asset-resource-seed-draft.md`
   - `doc/features/question-bank-image-asset-seed-input.tsv`
   - `doc/features/question-bank-image-continue-here-template.md`
   - `doc/xc-career-guide-mvp-schema-*.sql`

### 4.2 生图任务的文档分工

- 图片怎么规划：看 `question-bank-image-plan.md`
- 图片怎么批量提交：看 `question-bank-image-batch-plan-v001.json`
- 小批次试跑怎么验收：看 `question-bank-image-batch-pilot-acceptance.md`
- 图片最终如何挂到应用：看 `question-bank-image-asset-linking-draft.md`
- 图片如何登记 `asset_resource`：看 `question-bank-image-asset-resource-seed-draft.md`
- 编码 agent 直接可用的 seed 输入表：看 `question-bank-image-asset-seed-input.tsv`
- 生图状态如何安全写入 `.continue-here.md`：看 `question-bank-image-continue-here-template.md`

### 4.3 生图会话常见误区

- 只出图，不写标准命名和接入草案。
- 直接在题目里写磁盘路径，而不是走 `asset_resource` + `asset_id`。
- 没确认当前是“方案规划”“试跑”还是“正式批量”。

---

## 5. `schema` / `PRD` / `feature` 文档入口

### 5.1 先看 schema 的任务

进入条件：

- 你要改表结构、触发器、状态迁移、资源挂接位点
- 你要确认某字段是不是数据库层强制约束
- 你要确认红线、终态、策略锁定是否由 DB 层保护

入口文档：

- `doc/xc-career-guide-mvp-schema-v0.1.7-consistency-guard.sql`
- 必要时再结合 `AGENTS.md` 的架构原则一起看

### 5.2 先看主 PRD 的任务

进入条件：

- 你要确认功能是否属于 MVP
- 你要核对结果展示口径
- 你要确认角色、流程、验收要求、范围边界

入口文档：

- `doc/炫灿-职途向导系统_MVP_PRD_v1.0.5.md`

### 5.3 先看 feature 文档的任务

进入条件：

- 你要实现或续做某个具体功能
- 你要确认该功能已经拆到哪一步
- 你要知道这次该改哪些文件、跑哪些测试

入口规则：

- 先读 `doc/features/*-prd.md`：确认功能目标、范围、角色、边界
- 再读 `doc/features/*-impl.md`：确认实现步骤、风险点、验证方式

---

## 6. `doc/features/` 现有文档速查

### 6.1 已有业务功能文档

- `doc/features/login-by-role-prd.md`：登录功能的 Mini-PRD，定义用户名密码登录和按角色跳转。
- `doc/features/login-by-role-impl.md`：登录功能的实现拆解，适合继续 IPC、Pinia、路由守卫链路。
- `doc/features/student-profile-prd.md`：学生档案管理的 Mini-PRD，定义教师建档、编辑、归档和学生账号开通。
- `doc/features/student-profile-impl.md`：学生档案管理的实现步骤，适合继续教师端档案闭环。
- `doc/features/strategy-config-prd.md`：`strategy_config` 管理功能的 Mini-PRD，定义策略创建、版本化、启停和约束。
- `doc/features/strategy-config-impl.md`：`strategy_config` 的实现步骤，适合继续管理员端策略维护闭环。
- `doc/features/assessment-prd.md`：测评功能的 Mini-PRD，定义线上 `42` 题答题闭环、红线和等级判定服务。
- `doc/features/assessment-impl.md`：测评功能实现拆解，适合继续事件写入、组卷、答题和投影链路。

### 6.2 图片资产相关文档

- `doc/features/question-bank-image-plan.md`：题库图片资产总方案，决定“哪些图要做、按什么资产体系做”。
- `doc/features/question-bank-image-batch-plan-v001.json`：全量批量出图计划，适合正式批量生成时使用。
- `doc/features/question-bank-image-batch-pilot-v001.json`：首批试跑任务清单，适合验证风格和可用性。
- `doc/features/question-bank-image-batch-pilot-acceptance.md`：试跑验收标准，判断是否可以扩批。
- `doc/features/question-bank-image-asset-linking-draft.md`：标准图片接入应用的草案表，连接图片文件、`asset_resource` 和题目字段。
- `doc/features/question-bank-image-asset-resource-seed-draft.md`：图片登记到 `asset_resource` 的 seed 模板，供编码会话直接落库或生成 seed。
- `doc/features/question-bank-image-asset-seed-input.tsv`：编码会话可直接消费的图片资产输入表，包含 `asset_id / app_uri / attach_field / current_status` 等列。
- `doc/features/question-bank-image-continue-here-template.md`：图片会话交接模板，解决并行编码时如何补充图片状态而不污染 `.continue-here.md` 主状态。
- `doc/features/question-bank-image-integration-checklist.md`：编码 agent 的执行清单，把 `TSV → asset_resource → question_bank / content_json` 压成可顺序执行的步骤。

---

## 7. 快速决策表：我现在该读哪类文档

- 继续编码会话：`会话启动.md` → 当前 feature PRD / impl
- 继续生图会话：`生图启动.md` → 图片 plan / batch / acceptance
- 改数据库或状态机：schema SQL
- 改事件写入或回放：event payload schema
- 改 JSON 字段：JSON field schema
- 判断需求是否属于 MVP：主 PRD
- 讨论未来版本：MVP 后续全量功能演进备忘录

---

## 8. 最小阅读原则

如果只允许读 `3` 份文档，优先顺序如下：

### 编码会话

1. `AGENTS.md`
2. `.continue-here.md`
3. 当前任务对应的 `doc/features/*-impl.md`

### 生图会话

1. `AGENTS.md`
2. `doc/生图启动.md`
3. `doc/features/question-bank-image-plan.md`

只有当当前任务已经触碰 schema、事件、JSON 约束或 MVP 边界时，才继续下钻到主 PRD 和规范文档。
