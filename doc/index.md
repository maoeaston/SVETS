# SVETS 文档索引

给**新会话 agent** 的最小导航入口。回答 3 个问题：
1. 现在该先读什么
2. 某类任务对应哪份文档
3. 什么时候需要继续下钻

使用原则：先读"当前任务必需"的最小集合。会话恢复优先看 `.continue-here.md` 和会话模板。需要改实现时再下钻 feature 文档；需要核对数据结构时再下钻 schema 系列。

---

## 1. 目录结构概览

```
doc/
├── index.md              ← 本文件
├── 会话启动.md            ← 编码会话开场检查清单
├── 会话结束.md            ← 编码会话收尾交接清单
├── specs/                ← 活跃工程规范（高频引用）
├── features/             ← 功能 Mini-PRD + 实现文档
├── reference/            ← 原始素材（agents 不主动读）
└── archive/              ← 已归档（历史参考，不作为当前入口）
```

---

## 2. specs/ — 活跃工程规范

### 2.1 当前已实现基线

以下文件对应**当前代码真实状态**：`schema.sql v0.1.10-scoring-closure` + `PRD v1.0.6`（见 AGENTS.md 工程基线）。

| 文件 | 用途 | 何时读 |
|------|------|--------|
| `specs/PRD_v1.0.6.md` | MVP 产品说明、功能范围、结果模型、验收基线 | 判断功能边界、确认验收口径 |
| `specs/xc-career-guide-json-field-schema-v1.0.0.md` | 所有 JSON TEXT 字段结构规范 | 写或校验 `content_json`、`scoring_policy_json` 等 |
| `specs/xc-career-guide-event-payload-schema-v1.0.0.md` | 事件载荷与 JSONL 信封规范 | 涉及 `action_log.jsonl`、事件写入、回放 |
| `specs/题库分层架构说明.md` | 四层题库（MASTER/变式/泛化/结业）设计与 `question_role` 字段规划（Post-MVP 参考，MVP 不落地） | 题库新增、组卷策略、结业逻辑设计 |
| `specs/《分数解释手册》v1.0+《施测者操作手册》v1.md` | 评分等级解释与施测操作规程（专业岗位题库来源材料） | 评分展示、报告输出、施测流程核对 |

**数据库 schema 基线在代码库中：**
- `src/main/db/schema.sql` — 当前权威 schema，改表结构、触发器、状态机时必读

### 2.2 方案 B 多设备架构设计（未实现，演进方向）

| 文件 | 用途 | 何时读 |
|------|------|--------|
| `specs/architecture-review-plan-b-multi-device.md` | 方案 B 第一版架构草案（v1.0，已被 v1.1 取代） | 仅追溯历史决策 |
| `specs/architecture-review-plan-b-multi-device-v1.1.md` | **方案 B 修订稿（v1.1，当前活跃）**：关闭 18 条交叉审查意见，含完整 Schema 草案、一致性协议、安全方案、REST API 合同、状态分离模型 | 多设备架构实施、认证/设备/授权设计、JSONL 一致性、HTTPS 配对 |

> v1.1 是架构设计文档，不是已批准的编码基线。实施前需逐阶段确认。

### 2.3 专业岗位测评 / 题库治理 PRD 链（尚未实现，下一阶段目标基线）

以下三份文件是**差异修订版**体例：每份只写相对上一版的增量，未提及的章节自动沿用上一版（`PRD v1.0.6` 是链的起点）。**当前代码尚未实现这条链的任何一条**——阅读时不要误当作已落地的现状。三份必须按顺序整体读完，后一份不重复前一份已定的合同。

| 文件 | 相对上一版的核心增量 | 目标 schema |
|------|------|------|
| `specs/MVP_PRD_v1.0.7-question-contract-closure.md` | 题库数据合同收口：`SOFTWARE_TASK`、`item_usage`、interaction/presentation 两层模型、`scoring_rule_json` v1.1、`response_status`、支持等级、素材冻结、`report_content_json` v1.1 | v0.1.11（未生成） |
| `specs/MVP_PRD_v1.0.8-job-bank-governance-closure.md` | 专业岗位题库（M1-M6）治理：`bank_domain` 域隔离、`job_module_code`、`TEACHER_OBSERVATION`、`VIDEO_SCENE`、施测变体合同（`content_json.administration`）、旧库重导规则 | 并入 v0.1.12（v0.1.11 未单独生成） |
| `specs/MVP_PRD_v1.0.9-job-skill-assessment-mvp-closure.md` | 专业岗位示范测评运行时：`JOB_SKILL_ASSESSMENT` 策略、固定 18+6 题（+0-3 观察项）示范卷、`JOB_SKILL_SCORE`、M1-M6 模块画像、专业岗位报告、与"拆箱与上架"训练的推荐衔接 | v0.1.12（当前目标基线，未生成） |

> M1-M6 题库口径在讨论过程中出现过一次真实的版本误判（曾把 549 题初始池当成最终口径），完整经过和数据事实见 `doc/archive/M1-M6题库软件化审查报告-v2-db298口径-通向v1.0.8.md`；旧误判稿保留在同目录 `...-v1-已废弃-549题误判终稿.md` 仅作教训记录。启动这条 PRD 链的编码前必读该 v2 报告。

---

## 3. 编码会话阅读顺序

### 最小顺序

1. `AGENTS.md`
2. `.continue-here.md`
3. `doc/会话启动.md`
4. 当前任务对应的 `doc/features/*-prd.md`
5. 当前任务对应的 `doc/features/*-impl.md`
6. 如涉及结构约束，再补读：
   - `src/main/db/schema.sql`
   - `doc/specs/xc-career-guide-json-field-schema-v1.0.0.md`
   - `doc/specs/xc-career-guide-event-payload-schema-v1.0.0.md`
7. 如涉及产品范围或验收口径，再补读：
   - `doc/specs/PRD_v1.0.6.md`

### 什么时候停在最小集合

- 只是继续上个会话的单一步骤
- `.continue-here.md` 已明确下一步唯一原子动作
- 当前只改某个已拆好的 feature 步骤

### 什么时候必须继续下钻

| 任务类型 | 必读文档 |
|----------|----------|
| 改状态机、红线、事件顺序 | `schema.sql` + `event-payload-schema` |
| 写或校验 JSON 字段 | `json-field-schema` |
| 改功能边界、结果口径、验收标准 | 主 PRD |
| 改题库、组卷逻辑（现有基础能力题库） | `specs/题库分层架构说明.md` |
| 启动专业岗位测评 / M1-M6 题库相关新功能 | §2.2 PRD 链（v1.0.7 → v1.0.8 → v1.0.9，按顺序整体读完）+ §2.3 实施文档链 + `doc/reference/` 中 M1-M6 298 条导出 |
| 实现某具体功能 | 对应 `features/*-prd.md` + `*-impl.md` |

### 2.4 专业岗位技术实施文档（doc/specs/impl/）

**与 §2.2 PRD 链的关系：** PRD 是"要做什么"的产品合同，impl/ 是"怎么做"的技术方案。impl/ 基于三份 PRD 增量（v1.0.7 + v1.0.8 + v1.0.9）产出，将分散的技术决策收拢为 8 份可执行文档。

| 序号 | 文档 | 内容 | 何时读 |
|---|---|---|---|
| 00 | `impl/00-implementation-overview.md` | 一句话目标、统一范围边界、BASE_ABILITY vs JOB_SPECIFIC 架构对比、与 v0.1.10 兼容性、文档依赖关系 | 启动实施前的总览入口 |
| 01 | `impl/01-schema-v0.1.12-design.md` + `.sql` | schema v0.1.12 完整设计文档 + 可执行 SQL（合并 v1.0.7/v1.0.8/v1.0.9 全部 schema 要求） | 建库、改表结构、写触发器 |
| 02 | `impl/02-json-contracts-and-types.md` | 完整 TypeScript 类型定义（可合并进 json-schemas.ts）+ validateQuestionContract() 规则逻辑 | 写或校验 JSON 字段、实现 validator |
| 03 | `impl/03-job-skill-demo-paper-spec.md` | 固定 18+6 示范卷具体题目 ID 清单（从 298 条中选出）+ 素材需求 + rubric 三档锚点 | 固定卷题目确认、素材制作、答案审核 |
| 04 | `impl/04-question-bank-import-cleaning-spec.md` | 298 条从旧库到新库的完整清洗规则 + dry-run 报告格式 + 导入执行顺序 | 实现导入脚本、数据清洗 |
| 05 | `impl/05-state-machine-and-events.md` | assessment_session 三阶段状态机（ONLINE/OFFLINE/OBSERVATION）+ 新增事件 payload 定义 | 状态流转、事件写入、reducer |
| 06 | `impl/06-acceptance-test-plan.md` | 120 条验收用例（按功能域分组，三段式：输入/步骤/预期） | 写测试用例、执行验收 |
| 07 | `impl/07-implementation-task-book.md` | 12 个任务（T1-T12）的拆解：文件范围、具体步骤、自查方式、依赖关系 | 分配编码任务、任务进度跟踪 |

**阅读顺序：** 启动实施 → 00 总览 → 按任务书 07 的顺序读对应文档（T1 读 02，T2 读 01，T4 读 04，等等）。

---

## 4. features/ — 功能文档速查

### 活跃业务功能

| 功能 | PRD | 实现文档 |
|------|-----|---------|
| 按角色登录 | `login-by-role-prd.md` | `login-by-role-impl.md` |
| 学生档案管理 | `student-profile-prd.md` | `student-profile-impl.md` |
| 策略配置管理 | `strategy-config-prd.md` | `strategy-config-impl.md` |
| 题库与资源 | `question-bank-resources-prd.md` | `question-bank-resources-impl.md` |
| 测评流程 | `assessment-prd.md` | `assessment-impl.md` |

### 图片资产文档（仍活跃）

- `question-bank-image-plan.md` — 图片资产总方案
- `question-bank-image-batch-pilot-acceptance.md` — 试跑验收标准
- `question-bank-image-asset-linking-draft.md` — 图片接入应用草案
- `question-bank-image-asset-resource-seed-draft.md` — asset_resource seed 模板
- `question-bank-image-integration-checklist.md` — 编码 agent 执行清单
- `question-bank-image-continue-here-template.md` — 图片会话交接模板
- `question-bank-source-csv-template.md` — 题库导入 CSV 模板
- `question-bank-launch-gate.md` — 上线门禁检查

> JSON/TSV/SQL 工作数据文件已移至 `features/archive/`，不作为 agent 主动阅读入口。

---

## 5. reference/ — 原始素材

agents 不需要主动读，仅在需要核对源数据时查阅：

- `通用基础能力评估题库.xlsx` — Q_BASE_* 题旧版来源
- `通用基础能力正式测评候选题库_v0.2-软件优先版.xlsx` — 基础能力题库现行候选池（PRD v1.0.7 题库基线，96 条软件优先候选题）
- `专业岗位能力测评题库2026.7.3_终稿.pdf` — **[!] 文件名含"终稿"但实为 M1-M6 初始题目池（实测 549 题/项），仅作追溯查漏，不是最终口径，不要据此判断题量或答案**
- `专业岗位能力测评题库-M1-M6-数据库导出-298条.csv` / `.json` — **M1-M6 题库真正的最终口径**（从 `question_bank` 实测导出的 298 条），专业岗位题库改造与 PRD v1.0.8/v1.0.9 均以此为准；已知数据缺陷（答案键存疑、rubric 缺三档锚点、`ability_tags` 非法值等）见 `doc/archive/M1-M6题库软件化审查报告-v2-db298口径-通向v1.0.8.md`
- `超市素材需求清单更新版.md` — 图片资产需求
- `chatgpt建议.md` — 题库分层设计输入建议（已被 `specs/题库分层架构说明.md` 吸收）
- `chatgpt建议 (2).md` / `chatgpt建议 (3).md` — 线下工具包方案外部审阅意见（已被 `offline-toolkit-procurement-spec.md` v2.1 吸收）
- `question-bank-viewer.html` — 394题（BASE_ABILITY 96 + JOB_SPECIFIC 298）全量题库可视化浏览器（含选项、评分规则、媒体需求标记）
- `offline-toolkit-procurement-spec.md` — **线下评测工具包采购规格书 v2.1**：25件商品 + 14件日期属性矩阵 + 6场景包 + 开箱验收清单（模拟工作日：2026-09-10）
- 其余 PDF — 背景研究文献，不影响编码实现

---

## 6. 快速决策表

| 当前情况 | 先读这里 |
|----------|----------|
| 继续编码会话 | `会话启动.md` → `.continue-here.md` → feature impl |
| 新功能开发 | `AGENTS.md` → 主 PRD → `/vibe-feature` |
| 改数据库/状态机 | `src/main/db/schema.sql` |
| 改事件写入/回放 | `specs/xc-career-guide-event-payload-schema-v1.0.0.md` |
| 改 JSON 字段 | `specs/xc-career-guide-json-field-schema-v1.0.0.md` |
| 题库/组卷相关（现有基础能力题库） | `specs/题库分层架构说明.md` |
| 功能范围判断 | `specs/PRD_v1.0.6.md` |
| **多设备架构设计（方案 B）** | **`specs/architecture-review-plan-b-multi-device-v1.1.md`** |
| **专业岗位测评实施（v0.1.10 → v0.1.12）** | **§2.4 实施文档（impl/）：00 总览 → 07 任务书 → 按任务顺序读对应文档** |
| 专业岗位 PRD 理解（要做什么） | §2.2 PRD 链（v1.0.7→v1.0.8→v1.0.9，按顺序整体读完） |
| 298 条题库数据核对 | `doc/reference/` M1-M6 298 条导出 + `doc/archive/` 审查报告 v2 |
