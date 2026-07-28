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
│   └── archive/          ← 题库视觉资产历史资料（只读，不作为执行入口）
├── assets/               ← 视觉资产 Manifest、Prompt 模板、参考资产和 QA 记录
├── reference/            ← 原始素材（agents 不主动读）
└── archive/              ← 已归档（历史参考，不作为当前入口）
```

---

## 2. specs/ — 活跃工程规范

### 2.1 当前已实现基线

当前工程基线以 **AGENTS.md + `src/main/db/schema.sql`** 为准（现为 `schema.sql v0.1.17-multi-device-m4-safety-rekey`，M4 Step 2A 已 `PASS / CLOSED`；MVP 功能基线 `PRD v1.0.9`）。以下文件是跨版本稳定的规范类文档：

| 文件 | 用途 | 何时读 |
|------|------|--------|
| `specs/MVP_PRD_v1.0.9-authoritative.md` | **当前唯一产品合同**：完整 MVP 范围、结果模型、题库/素材/运行时合同与验收标准 | 判断功能边界、确认验收口径 |
| `specs/xc-career-guide-json-field-schema-v1.0.0.md` | JSON TEXT 历史可读规范；当前类型以 `src/shared/types/json-schemas.ts` 为准 | 追溯字段设计、写 validator |
| `specs/xc-career-guide-event-payload-schema-v1.0.0.md` | 事件载荷历史可读规范；当前类型以 `src/shared/types/event-payloads.ts` 为准 | 追溯事件设计、核对 JSONL 信封 |
| `specs/题库分层架构说明.md` | 四层题库（MASTER/变式/泛化/结业）设计与 `question_role` 字段规划（Post-MVP 参考，MVP 不落地） | 题库新增、组卷策略、结业逻辑设计 |
| `specs/《分数解释手册》v1.0+《施测者操作手册》v1.md` | 评分等级解释与施测操作规程（专业岗位题库来源材料） | 评分展示、报告输出、施测流程核对 |

**数据库 schema 基线在代码库中：**
- `src/main/db/schema.sql` — 当前权威 schema，改表结构、触发器、状态机时必读

### 2.1.1 全量产品演进草案

以下文件承接 MVP 冻结后的产品演进，目前均为 **DRAFT**，尚未替代 MVP PRD v1.0.9：

| 文件 | 用途 | 何时读 |
|---|---|---|
| `specs/FULL_PRODUCT_PRD_v2.0-draft.md` | 单岗位完整产品 1.0 草案，包含正式试卷、完整课程、真实多设备、AI 自动评分和 AI 岗位推荐 | 评审 Post-MVP 产品范围、AI 边界和 1.0 验收 |
| `features/mvp-pilot-freeze-plan.md` | 当前 MVP Pilot 的冻结范围、已知偏差、收口任务和发布闸门 | 停止 MVP 扩功能、准备冻结 tag |
| `features/multi-device-m4-m5-prd.md` | M4 Safety Re-key 与 M5 Command Bus / 事件恢复 / Local Server / Teacher Web 的分段推进合同 | M4/M5 评审、拆实现任务书 |

### 2.2 方案 B 多设备架构（v2.2 唯一权威基线，M1/M2/M3 已落地）

| 文件 | 用途 | 何时读 |
|------|------|--------|
| `specs/architecture-plan-b-multi-device-v2.2-authoritative-baseline.md` | **v2.2 唯一权威实施基线**：完整 DDL、delivery_phase 状态机、命令熔断、安全聚合键、发布模型、离线评分草稿、资产授权、回滚 | 多设备架构实施、认证/设备/授权设计、JSONL 一致性、状态机与触发器 |
| `specs/architecture-plan-b-multi-device-v2.2-coverage-matrix.md` | 36 设计域覆盖矩阵 + 机械提取的 DDL 清单 + 13 问题 / 10 硬化项收口状态 | 核对某设计域是否收口、DDL 差异清单 |
| `specs/architecture-plan-b-multi-device-v2.2-validation-report.md` | 真实 SQLite 执行验证记录（迁移、触发器行为、哈希、DDL diff、禁用/必需词检查） | 复核验证口径、重跑验证 |
| `features/multi-device-v2.2-migration-prd.md` | v2.2 拆分为 M1-M7 里程碑的迁移 PRD（**M1 身份拓扑、M2 Business Session Foundation 与 M3 Grant/Assignment 已实施**，M4-M7 待推进） | 推进多设备实施、确认里程碑边界 |

> v1.1 / v1.2 / v2.0 / v2.0.1 / v2.1 已全部标记 SUPERSEDED，仅作历史决策追溯，不再作为实施依据。

### 2.3 当前产品合同与历史版本

`specs/MVP_PRD_v1.0.9-authoritative.md` 已将 v1.0.5 完整正文与 v1.0.6～v1.0.9 的有效替换、增补和废止规则物化为一份可独立阅读的权威 PRD。新功能、验收和新会话只读该文件，不再顺序拼接历史差异版。

| 文件 | 状态 | 用途 |
|------|------|------|
| `specs/MVP_PRD_v1.0.9-authoritative.md` | **AUTHORITATIVE** | 当前完整产品合同 |
| `archive/prd-history/PRD_v1.0.6.md` | SUPERSEDED | 评分收口历史来源 |
| `archive/prd-history/MVP_PRD_v1.0.7-question-contract-closure.md` | SUPERSEDED | 题库数据合同历史来源 |
| `archive/prd-history/MVP_PRD_v1.0.8-job-bank-governance-closure.md` | SUPERSEDED | 专业岗位题库治理历史来源 |
| `archive/prd-history/MVP_PRD_v1.0.9-job-skill-assessment-mvp-closure.md` | SUPERSEDED | 专业岗位运行时差异来源 |

> schema v0.1.12 已实现 v1.0.7～v1.0.9 的合同，当前 schema v0.1.15 在其上增加多设备 M1 身份拓扑、M2 Business Session Foundation 与 M3 Grant/Assignment。历史差异版中的“待实现”“目标基线”只代表当时状态。

### 2.4 专业岗位技术实施记录（doc/specs/impl/）

**与 §2.3 权威 PRD 的关系：** 当前 PRD 是“要做什么”的产品合同；`impl/` 是 schema v0.1.12 落地时的技术实施记录。其“待实现”状态快照已经过期，只在追溯具体设计与验收来源时下钻。

| 序号 | 文档 | 内容 | 何时读 |
|---|---|---|---|
| 00 | `impl/00-implementation-overview.md` | 一句话目标、统一范围边界、BASE_ABILITY vs JOB_SPECIFIC 架构对比、与 v0.1.10 兼容性、文档依赖关系 | 启动实施前的总览入口 |
| 01 | `impl/01-schema-v0.1.12-design.md` + `.sql` | schema v0.1.12 完整设计文档 + 可执行 SQL（合并 v1.0.7/v1.0.8/v1.0.9 全部 schema 要求） | 建库、改表结构、写触发器 |
| 02 | `impl/02-json-contracts-and-types.md` | 完整 TypeScript 类型定义（可合并进 json-schemas.ts）+ validateQuestionContract() 规则逻辑 | 写或校验 JSON 字段、实现 validator |
| 03 | `impl/03-job-skill-demo-paper-spec.md` | 历史固定 18+6 选卷设计，仅用于追溯；当前题目与素材合同见 `features/job-skill-shelver-current-contracts.md` | 追溯旧题选择依据，不作为素材制作输入 |
| 04 | `impl/04-question-bank-import-cleaning-spec.md` | 298 条从旧库到新库的完整清洗规则 + dry-run 报告格式 + 导入执行顺序 | 实现导入脚本、数据清洗 |
| 05 | `impl/05-state-machine-and-events.md` | assessment_session 三阶段状态机（ONLINE/OFFLINE/OBSERVATION）+ 新增事件 payload 定义 | 状态流转、事件写入、reducer |
| 06 | `impl/06-acceptance-test-plan.md` | 120 条验收用例（按功能域分组，三段式：输入/步骤/预期） | 写测试用例、执行验收 |
| 07 | `impl/07-implementation-task-book.md` | 12 个任务（T1-T12）的拆解：文件范围、具体步骤、自查方式、依赖关系 | 分配编码任务、任务进度跟踪 |

**阅读顺序：** 当前维护先读权威 PRD + 当前代码；只有追溯 v0.1.12 实施细节时，再读 00 总览和对应 impl 文档。

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
   - `doc/specs/MVP_PRD_v1.0.9-authoritative.md`

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
| 专业岗位测评 / M1-M6 题库相关功能 | §2.3 权威 PRD + 当前 feature 文档；追溯旧实现时再读 §2.4 impl 记录 |
| 实现某具体功能 | 对应 `features/*-prd.md` + `*-impl.md` |

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
| 训练流程 | `training-prd.md` | `training-impl.md` |
| 实操评分 | `operation-scoring-prd.md` | `operation-scoring-impl.md` |
| 报告页面框架 | `report-page-framework-prd.md` | `report-page-framework-impl.md`（`CONDITIONAL_PASS`） |
| DRAG 拖拽渲染 | `drag-render-prd.md` | `drag-render-impl.md` |

### 数据库运维

- `features/local-database-sync-sop.md` — A/B/C 三台 WSL 开发机轮流开发时的 `db:sync` / `db:verify` / 备份与重建流程
- `features/multi-device-v2.2-migration-prd.md` — v0.1.13 M1、v0.1.14 M2、v0.1.15 M3 结构迁移与后续 M4-M7 里程碑
- `features/multi-device-m4-m5-prd.md` — M4 三元安全聚合键与 M5A-M5D 架构换轨草案

### 产品演进与收口

- `features/pilot-r0-foundation-development-plan-2026-07-22.md` — **当前基础功能开发顺序与验收入口**：题库保持 DRAFT 时先推进学生、权限、保存恢复、安全、评分和报告底座；记录哪些题库/素材工作可后置、哪些底座不可后置
- `features/full-product-1.0-planning-review-2026-07-18.md` — **当前规划审查入口**：记录 R0 / Full Product / M4 / M5 的 REJECT 结论、源码证据、必改清单与下一步唯一原子动作；仅为审查快照，不替代产品合同
- `features/mvp-pilot-freeze-plan.md` — 当前 MVP Pilot 冻结、偏差和发布检查表
- `features/base-ability-current-contracts.md` — **当前 BASE_ABILITY 96 题与 42+8 门禁导航入口**，明确候选池、DRAFT/NO_SCORE 阻断、renderer/线下教具和历史文件边界
- `features/base-ability-42plus8-activation-gate-v1.json` — 基础能力 42+8 机器门禁；供给够 42+8，但 DRAFT/NO_SCORE/素材/试测未闭合时保持关闭
- `features/job-skill-shelver-current-contracts.md` — **当前 JOB_SKILL 298 题与 270 项素材合同导航入口**，明确日常只读入口、历史审核链边界和禁止动作
- `features/job-skill-shelver-runtime-authority-v1.json` — 298 道当前版本 DRAFT 题的机器权威；不得由此直接激活
- `features/job-skill-shelver-phase4-activation-gate-v1.json` — 当前激活门禁；Pilot 未过且 270 项资产未批准时保持关闭
- `features/job-skill-shelver-question-delivery-lock-v1.json` — 181 道需要视频、答案图、脚本、音频或线下工具支撑的交付锁
- `features/job-skill-shelver-pilot-current-question-authority.md` — Pilot 24 题 strategy v3 历史门禁入口；不再作为 298 题素材生产唯一入口
- `features/job-skill-shelver-pilot-revision-candidates-v3.json` — Pilot strategy v3 的24题机器候选合同，用于 Pilot 门禁追溯
- `features/job-skill-shelver-pilot-activation-manifest-v3.json` — Pilot strategy v3 的 fail-closed activation manifest，记录复审、素材和真实 Electron 见证阻断
- `features/job-skill-shelver-pilot-review-result-v1.schema.json` — 内容审核结果 JSON 的可复用机器合同
- `features/job-skill-shelver-pilot-safety-technical-review-result-v1.schema.json` — 安全与技术审核结果 JSON 合同
- `features/job-skill-shelver-298-question-content-review-packet-remaining-274-v1.md` — 陈晓青审核298题来源池剩余274题的 Markdown 填写包；只用于全量内容审核，不是当前 Pilot 激活合同
- `features/job-skill-shelver-298-review-revision-handoff.md` — 下一会话接收陈晓青与赫东全量审核结果、固化JSON并生成版本化修订题的执行入口
- `features/job-skill-shelver-298-semantic-change-rereview-merged-gate-2026-07-20.json` — 232道语义变化候选复审合并门禁；21题两方均通过、211题退回复修，全部不得直接激活
- `features/job-skill-shelver-298-semantic-change-rereview-ledger-2026-07-20.md` — 陈晓青与赫东232题复审结果接收、hash 校验和汇总留档
- `features/job-skill-shelver-298-*` 其他大量 JSON/HTML/MD — 审核链、复审链和生成器输入；日常素材生产不读，只有重建 298 权威或复盘审核时下钻
- `features/archive/job-skill-shelver-pilot-r0-v1-v2/README.md` — strategy v1/v2 候选、审核包、审核结果和旧 manifest 的只读审计目录；不得作为当前生产输入
- `specs/FULL_PRODUCT_PRD_v2.0-draft.md` — 全量产品 1.0 草案；AI 自动评分与 AI 岗位推荐属于 1.0 必选能力

### 视觉资产文档（仍活跃）

- `reference/visual-asset-master-plan.md` — 唯一视觉风格与范围规划基线
- `assets/asset-manifest.json` + `assets/asset-manifest.schema.json` — 270 项资产机器合同；`question_ids` 为来源题号，`current_question_ids` 为当前运行时题号
- `assets/offline-toolkit-manifest-v1.json` — 100 道线下实操题的材料布置、复位和资产依赖合同
- `question-bank-image-integration-checklist.md` — Manifest 生产、审核、入库执行清单
- `visual-asset-video-production-sop.md` — Seedance 视频四段式输入、场景锚图、抽选和验收 SOP
- `visual-asset-prompt-compilation-session-guide.md` — 新会话分批完成逐资产 Prompt 编译与独立复核的启动模板
- `question-bank-source-csv-template.md` — 题库导入 CSV 模板
- `question-bank-launch-gate.md` — 上线门禁检查

> 图片资产的早期方案、试跑、TSV/SQL seed 和批次 JSON 已按用途整理到 `features/archive/`，逐文件处置和删除候选见 `features/archive/README.md`。这些资料只作历史追溯，任何新生产或入库不得从 archive 读取。

---

## 5. reference/ — 原始素材

agents 不需要主动读，仅在需要核对源数据时查阅：

- `通用基础能力正式测评候选题库_v0.2-软件优先版.xlsx` — 基础能力题库现行候选池（PRD v1.0.7 题库基线，96 条软件优先候选题）
- `专业岗位能力测评题库2026.7.3_终稿.pdf` — **[!] 文件名含"终稿"但实为 M1-M6 初始题目池（实测 549 题/项），仅作追溯查漏，不是最终口径，不要据此判断题量或答案**
- `专业岗位能力测评题库-M1-M6-数据库导出-298条.json` — M1-M6原始来源口径，用于追溯298条导出记录，不是当前题目或素材生产合同。当前入口见 `features/job-skill-shelver-current-contracts.md`。
- `chatgpt建议298题作为核心测评母题.md` — 早期"298 题作为核心母题"建议备忘，仅作历史决策追溯
- `question-bank-viewer.html` — 顶部展示当前 Pilot strategy v3 的24题权威候选，下方保留394题原始来源视图；被替代旧题显示历史标记。
- `offline-toolkit-procurement-spec.md` — **线下评测工具包采购规格书 v2.1**：25件商品 + 14件日期属性矩阵 + 6场景包 + 开箱验收清单（模拟工作日：2026-09-10）
- `visual-asset-master-plan.md` — 视觉资产总规划
- `xuancanlogo.png` — 品牌 logo 素材（未接入应用）
- `特殊青少年职业教育数字化转型_综合论证报告.pdf` / `社区生活技能评估 (CSA) - 中文本土化电子版.pdf` — 背景研究文献，不影响编码实现

---

## 6. 快速决策表

| 当前情况 | 先读这里 |
|----------|----------|
| 继续编码会话 | `会话启动.md` → `.continue-here.md` → feature impl |
| 新功能开发 | `AGENTS.md` → 主 PRD → `/vibe-feature` |
| 改数据库/状态机 | `src/main/db/schema.sql` |
| A/B/C 开发机同步本地数据库 | `features/local-database-sync-sop.md` |
| 改事件写入/回放 | `specs/xc-career-guide-event-payload-schema-v1.0.0.md` |
| 改 JSON 字段 | `specs/xc-career-guide-json-field-schema-v1.0.0.md` |
| 题库/组卷相关（现有基础能力题库） | `features/base-ability-current-contracts.md` → `specs/题库分层架构说明.md` |
| 功能范围判断 | `specs/MVP_PRD_v1.0.9-authoritative.md` |
| 全量产品 1.0 与 AI 范围评审 | `specs/FULL_PRODUCT_PRD_v2.0-draft.md` |
| MVP Pilot 收口 | `features/mvp-pilot-freeze-plan.md` |
| 多设备 M4/M5 推进 | `features/multi-device-m4-m5-prd.md` → `specs/architecture-plan-b-multi-device-v2.2-authoritative-baseline.md` |
| **多设备架构设计（方案 B）** | **`specs/architecture-plan-b-multi-device-v2.2-authoritative-baseline.md`**（M1 落地进度见 `features/multi-device-v2.2-migration-prd.md`） |
| **专业岗位测评维护** | **`specs/MVP_PRD_v1.0.9-authoritative.md` + 当前 feature 文档；§2.4 impl 仅作 v0.1.12 实施追溯** |
| **视觉资产 Prompt 编译** | `features/job-skill-shelver-current-contracts.md` → `assets/asset-manifest.json` → `features/visual-asset-prompt-compilation-session-guide.md` |
| **Seedance 视频生产** | `features/job-skill-shelver-current-contracts.md` → `features/visual-asset-video-production-sop.md` → `assets/asset-manifest.json` |
| **视觉资产审核/入库** | `features/job-skill-shelver-current-contracts.md` → `assets/asset-manifest.json` → `features/question-bank-image-integration-checklist.md` |
| 专业岗位 PRD 理解（要做什么） | `specs/MVP_PRD_v1.0.9-authoritative.md` |
| 298 条题库数据核对 | `doc/reference/` M1-M6 298 条导出 + `doc/archive/` 审查报告 v2 |

---

## 7. 自动维护的文件清单

<!-- AUTO-GENERATED:DOC-INVENTORY:START -->
> 此区块由 `npm run docs:index:update` 生成，只表示文件存在，不代表权威性或阅读优先级。不要手工编辑。

### 7.1 根目录会话文档

| 文件 | 标题 |
|---|---|
| [会话启动.md](会话启动.md) | 会话启动：恢复现场（SVETS 项目专用） |
| [会话结束.md](会话结束.md) | 会话结束：最小可恢复交接（SVETS 项目专用） |

### 7.2 Specs 文件

| 文件 | 标题 |
|---|---|
| [specs/FULL_PRODUCT_PRD_v2.0-draft.md](specs/FULL_PRODUCT_PRD_v2.0-draft.md) | 炫灿-职途向导系统全量产品 PRD｜v2.0 草案 |
| [specs/MVP_PRD_v1.0.9-authoritative.md](specs/MVP_PRD_v1.0.9-authoritative.md) | 炫灿-职途向导系统 MVP 产品需求文档｜v1.0.9 权威合并版 |
| [specs/architecture-plan-b-multi-device-v2.0-authoritative-baseline.md](specs/architecture-plan-b-multi-device-v2.0-authoritative-baseline.md) | 方案 B 多设备架构 v2.0 — 权威实施基线（已废止） |
| [specs/architecture-plan-b-multi-device-v2.0.1-schema-alignment.md](specs/architecture-plan-b-multi-device-v2.0.1-schema-alignment.md) | 方案 B 架构 v2.0.1 — Schema 对齐硬化修订 |
| [specs/architecture-plan-b-multi-device-v2.1-authoritative-baseline.md](specs/architecture-plan-b-multi-device-v2.1-authoritative-baseline.md) | 方案 B 多设备架构 v2.1 — 唯一权威实施基线（已废止） |
| [specs/architecture-plan-b-multi-device-v2.1-coverage-matrix.md](specs/architecture-plan-b-multi-device-v2.1-coverage-matrix.md) | 方案 B 多设备架构 v2.1 — 覆盖矩阵 |
| [specs/architecture-plan-b-multi-device-v2.1-validation-report.md](specs/architecture-plan-b-multi-device-v2.1-validation-report.md) | 方案 B 多设备架构 v2.1 — 验证报告 |
| [specs/architecture-plan-b-multi-device-v2.2-authoritative-baseline.md](specs/architecture-plan-b-multi-device-v2.2-authoritative-baseline.md) | 方案 B 多设备架构 v2.2 — 唯一权威实施基线 |
| [specs/architecture-plan-b-multi-device-v2.2-coverage-matrix.md](specs/architecture-plan-b-multi-device-v2.2-coverage-matrix.md) | 方案 B 多设备架构 v2.2 — 覆盖矩阵 |
| [specs/architecture-plan-b-multi-device-v2.2-validation-report.md](specs/architecture-plan-b-multi-device-v2.2-validation-report.md) | 方案 B 多设备架构 v2.2 — 验证报告 |
| [specs/architecture-review-plan-b-multi-device-v1.1.md](specs/architecture-review-plan-b-multi-device-v1.1.md) | 方案 B 架构审查报告 v1.1：Electron 内嵌本地服务 + 教师平板浏览器 + 学生触摸一体机 |
| [specs/architecture-review-plan-b-multi-device-v1.2-consistency-closure.md](specs/architecture-review-plan-b-multi-device-v1.2-consistency-closure.md) | 方案 B 架构一致性闭环修订稿 v1.2 |
| [specs/impl/00-START-HERE.md](specs/impl/00-START-HERE.md) | 实施启动检查清单 |
| [specs/impl/00-implementation-overview.md](specs/impl/00-implementation-overview.md) | 实现总览：从 schema v0.1.10 到 v0.1.12 |
| [specs/impl/01-schema-v0.1.12-design.md](specs/impl/01-schema-v0.1.12-design.md) | schema v0.1.12-job-skill-assessment-mvp-closure 设计文档 |
| [specs/impl/02-json-contracts-and-types.md](specs/impl/02-json-contracts-and-types.md) | 02 — JSON 数据合同与类型定义 |
| [specs/impl/03-job-skill-demo-paper-spec.md](specs/impl/03-job-skill-demo-paper-spec.md) | 专业岗位固定示范卷规格 |
| [specs/impl/04-question-bank-import-cleaning-spec.md](specs/impl/04-question-bank-import-cleaning-spec.md) | 题库导入清洗规格 |
| [specs/impl/05-state-machine-and-events.md](specs/impl/05-state-machine-and-events.md) | 05 状态机与事件规范 |
| [specs/impl/06-acceptance-test-plan.md](specs/impl/06-acceptance-test-plan.md) | 验收测试方案 |
| [specs/impl/07-implementation-task-book.md](specs/impl/07-implementation-task-book.md) | 实施任务书 |
| [specs/impl/AGENT-PROMPT-T1.md](specs/impl/AGENT-PROMPT-T1.md) | 编码任务 T1：共享类型升级 |
| [specs/impl/NEW-SESSION-PROMPT.md](specs/impl/NEW-SESSION-PROMPT.md) | 新会话启动 Prompt（当前模板） |
| [specs/project-invariants.md](specs/project-invariants.md) | Project Invariants |
| [specs/xc-career-guide-event-payload-schema-v1.0.0.md](specs/xc-career-guide-event-payload-schema-v1.0.0.md) | 炫灿-职途向导系统 事件载荷规范 |
| [specs/xc-career-guide-json-field-schema-v1.0.0.md](specs/xc-career-guide-json-field-schema-v1.0.0.md) | 炫灿-职途向导系统 JSON 字段规范 |
| [specs/《分数解释手册》v1.0+《施测者操作手册》v1.md](specs/《分数解释手册》v1.0+《施测者操作手册》v1.md) | 交付文件一：《分数解释手册》v1.0 |
| [specs/题库分层架构说明.md](specs/题库分层架构说明.md) | 题库分层架构说明 |

### 7.3 Feature PRD 与实现配对

| 功能前缀 | PRD | 实现文档 |
|---|---|---|
| `assessment` | [features/assessment-prd.md](features/assessment-prd.md) | [features/assessment-impl.md](features/assessment-impl.md) |
| `base-ability-42plus8-pilot-readiness` | [features/base-ability-42plus8-pilot-readiness-prd.md](features/base-ability-42plus8-pilot-readiness-prd.md) | [features/base-ability-42plus8-pilot-readiness-impl.md](features/base-ability-42plus8-pilot-readiness-impl.md) |
| `data-persistence-recovery` | [features/data-persistence-recovery-prd.md](features/data-persistence-recovery-prd.md) | [features/data-persistence-recovery-impl.md](features/data-persistence-recovery-impl.md) |
| `drag-render` | [features/drag-render-prd.md](features/drag-render-prd.md) | [features/drag-render-impl.md](features/drag-render-impl.md) |
| `event-batch-v2.2-runtime` | [features/event-batch-v2.2-runtime-prd.md](features/event-batch-v2.2-runtime-prd.md) | 缺失 |
| `foundation-pages-exception-center` | [features/foundation-pages-exception-center-prd.md](features/foundation-pages-exception-center-prd.md) | [features/foundation-pages-exception-center-impl.md](features/foundation-pages-exception-center-impl.md) |
| `login-by-role` | [features/login-by-role-prd.md](features/login-by-role-prd.md) | [features/login-by-role-impl.md](features/login-by-role-impl.md) |
| `multi-device-m4-m5` | [features/multi-device-m4-m5-prd.md](features/multi-device-m4-m5-prd.md) | [features/multi-device-m4-m5-impl.md](features/multi-device-m4-m5-impl.md) |
| `multi-device-m4-safety-rekey` | [features/multi-device-m4-safety-rekey-prd.md](features/multi-device-m4-safety-rekey-prd.md) | [features/multi-device-m4-safety-rekey-impl.md](features/multi-device-m4-safety-rekey-impl.md) |
| `multi-device-v2.2-migration` | [features/multi-device-v2.2-migration-prd.md](features/multi-device-v2.2-migration-prd.md) | [features/multi-device-v2.2-migration-impl.md](features/multi-device-v2.2-migration-impl.md) |
| `operation-scoring` | [features/operation-scoring-prd.md](features/operation-scoring-prd.md) | [features/operation-scoring-impl.md](features/operation-scoring-impl.md) |
| `pause-recovery-safety` | [features/pause-recovery-safety-prd.md](features/pause-recovery-safety-prd.md) | [features/pause-recovery-safety-impl.md](features/pause-recovery-safety-impl.md) |
| `question-bank-resources` | [features/question-bank-resources-prd.md](features/question-bank-resources-prd.md) | [features/question-bank-resources-impl.md](features/question-bank-resources-impl.md) |
| `report-page-framework` | [features/report-page-framework-prd.md](features/report-page-framework-prd.md) | [features/report-page-framework-impl.md](features/report-page-framework-impl.md) |
| `scoring-framework-dual-track` | [features/scoring-framework-dual-track-prd.md](features/scoring-framework-dual-track-prd.md) | [features/scoring-framework-dual-track-impl.md](features/scoring-framework-dual-track-impl.md) |
| `strategy-config` | [features/strategy-config-prd.md](features/strategy-config-prd.md) | [features/strategy-config-impl.md](features/strategy-config-impl.md) |
| `student-profile` | [features/student-profile-prd.md](features/student-profile-prd.md) | [features/student-profile-impl.md](features/student-profile-impl.md) |
| `training` | [features/training-prd.md](features/training-prd.md) | [features/training-impl.md](features/training-impl.md) |

### 7.4 Feature 独立文档

| 文件 | 标题 |
|---|---|
| [features/base-ability-42plus8-evaluation-memo.md](features/base-ability-42plus8-evaluation-memo.md) | 基础能力测评 42+8 方案评估备忘录 |
| [features/base-ability-current-contracts.md](features/base-ability-current-contracts.md) | 基础能力题库与 42+8 当前合同入口 |
| [features/full-product-1.0-planning-review-2026-07-18.md](features/full-product-1.0-planning-review-2026-07-18.md) | SVETS MVP Pilot 收口与全量产品 1.0 规划审查报告 |
| [features/job-skill-shelver-298-content-review-result-2026-07-19.md](features/job-skill-shelver-298-content-review-result-2026-07-19.md) | 超市理货员 298 题来源池内容全量审核包（剩余 274 题） |
| [features/job-skill-shelver-298-question-content-review-packet-remaining-274-v1.md](features/job-skill-shelver-298-question-content-review-packet-remaining-274-v1.md) | 超市理货员 298 题来源池内容全量审核包（剩余 274 题） |
| [features/job-skill-shelver-298-question-revision-ledger-2026-07-19.md](features/job-skill-shelver-298-question-revision-ledger-2026-07-19.md) | 超市理货员剩余274题审核合并与修订台账 |
| [features/job-skill-shelver-298-rejected-replacement-candidates-v2.md](features/job-skill-shelver-298-rejected-replacement-candidates-v2.md) | 11道淘汰题的V2替代候选 |
| [features/job-skill-shelver-298-rejected-replacement-review-ledger-v1.md](features/job-skill-shelver-298-rejected-replacement-review-ledger-v1.md) | 11道V2替代候选双轨审核接收台账 |
| [features/job-skill-shelver-298-rejected-replacement-targeted-candidates-v3.md](features/job-skill-shelver-298-rejected-replacement-targeted-candidates-v3.md) | 9道退回题的V3定点修订候选 |
| [features/job-skill-shelver-298-rejected-replacement-targeted-candidates-v4.md](features/job-skill-shelver-298-rejected-replacement-targeted-candidates-v4.md) | 6 道内容退回题的 V4 定点修订候选 |
| [features/job-skill-shelver-298-rejected-replacement-targeted-v3-rereview-ledger-v1.md](features/job-skill-shelver-298-rejected-replacement-targeted-v3-rereview-ledger-v1.md) | 9道V3定点复审结果接收台账 |
| [features/job-skill-shelver-298-rejected-replacement-targeted-v4-rereview-ledger-v1.md](features/job-skill-shelver-298-rejected-replacement-targeted-v4-rereview-ledger-v1.md) | 6 道 V4 内容定点复审结果接收台账 |
| [features/job-skill-shelver-298-review-conflict-resolution-m5-dg-035-2026-07-20.md](features/job-skill-shelver-298-review-conflict-resolution-m5-dg-035-2026-07-20.md) | M5_DG_035 审核意见冲突人工裁决 |
| [features/job-skill-shelver-298-review-revision-handoff.md](features/job-skill-shelver-298-review-revision-handoff.md) | 超市理货员298题 V4 复审结果接收交接 |
| [features/job-skill-shelver-298-safety-technical-review-result-2026-07-19.md](features/job-skill-shelver-298-safety-technical-review-result-2026-07-19.md) | 超市理货员 274 题安全与技术审核结论 |
| [features/job-skill-shelver-298-semantic-change-content-rereview-packet-chen-xiaoqing-v1.md](features/job-skill-shelver-298-semantic-change-content-rereview-packet-chen-xiaoqing-v1.md) | 232道语义变化候选内容复审包（陈晓青） |
| [features/job-skill-shelver-298-semantic-change-content-rereview-result-chen-xiaoqing-2026-07-20.md](features/job-skill-shelver-298-semantic-change-content-rereview-result-chen-xiaoqing-2026-07-20.md) | 232道语义变化候选内容复审包（陈晓青） |
| [features/job-skill-shelver-298-semantic-change-rereview-ledger-2026-07-20.md](features/job-skill-shelver-298-semantic-change-rereview-ledger-2026-07-20.md) | 232道语义变化候选复审结果接收留档 |
| [features/job-skill-shelver-298-semantic-change-safety-technical-rereview-packet-he-dong-v1.md](features/job-skill-shelver-298-semantic-change-safety-technical-rereview-packet-he-dong-v1.md) | 232道语义变化候选安全与技术复审包（赫东） |
| [features/job-skill-shelver-298-semantic-change-safety-technical-rereview-result-he-dong-2026-07-20.md](features/job-skill-shelver-298-semantic-change-safety-technical-rereview-result-he-dong-2026-07-20.md) | 232道语义变化候选安全与技术复审包（赫东） |
| [features/job-skill-shelver-298-targeted-v3-rereview-ledger-v1.md](features/job-skill-shelver-298-targeted-v3-rereview-ledger-v1.md) | 超市理货员298题定点V3复审接收台账 |
| [features/job-skill-shelver-298-targeted-v4-rereview-ledger-v1.md](features/job-skill-shelver-298-targeted-v4-rereview-ledger-v1.md) | 超市理货员298题定点V4复审接收台账 |
| [features/job-skill-shelver-298-targeted-v5-rereview-ledger-v1.md](features/job-skill-shelver-298-targeted-v5-rereview-ledger-v1.md) | 超市理货员298题定点V5复审接收台账 |
| [features/job-skill-shelver-298-targeted-v6-rereview-ledger-v1.md](features/job-skill-shelver-298-targeted-v6-rereview-ledger-v1.md) | 超市理货员298题定点V6复审接收台账 |
| [features/job-skill-shelver-contract-chain-repair-implementation-plan-2026-07-20.md](features/job-skill-shelver-contract-chain-repair-implementation-plan-2026-07-20.md) | 岗位题库合同链修复与强绑定实施计划 |
| [features/job-skill-shelver-current-contracts.md](features/job-skill-shelver-current-contracts.md) | 超市理货员题库与素材当前合同入口 |
| [features/job-skill-shelver-phase4-activation-ledger-v1.md](features/job-skill-shelver-phase4-activation-ledger-v1.md) | 岗位题库阶段四统一激活门禁接线台账 v1 |
| [features/job-skill-shelver-pilot-13-question-revision-and-renderer-fix-v1.0.md](features/job-skill-shelver-pilot-13-question-revision-and-renderer-fix-v1.0.md) | 超市理货员 Pilot 13 道退回题修订与学习端渲染修复稿 v1.0 |
| [features/job-skill-shelver-pilot-current-question-authority.md](features/job-skill-shelver-pilot-current-question-authority.md) | 超市理货员 Pilot 当前题目门禁追溯入口 |
| [features/local-database-sync-sop.md](features/local-database-sync-sop.md) | 本地多开发机数据库同步 SOP |
| [features/multi-device-m4-safety-rekey-validation.md](features/multi-device-m4-safety-rekey-validation.md) | 多设备 M4 安全聚合三元键升级验收记录 |
| [features/mvp-pilot-freeze-plan.md](features/mvp-pilot-freeze-plan.md) | MVP Pilot 冻结与收口计划 |
| [features/pilot-r0-foundation-development-plan-2026-07-22.md](features/pilot-r0-foundation-development-plan-2026-07-22.md) | Pilot R0 基础能力开发与验收计划 |
| [features/question-bank-image-integration-checklist.md](features/question-bank-image-integration-checklist.md) | 视觉资产合同执行清单 |
| [features/question-bank-launch-gate.md](features/question-bank-launch-gate.md) | 题库上线门禁脚本 |
| [features/question-bank-source-csv-template.md](features/question-bank-source-csv-template.md) | 题库源 CSV 模板 |
| [features/visual-asset-prompt-compilation-session-guide.md](features/visual-asset-prompt-compilation-session-guide.md) | 逐资产 Prompt 编译新会话指南 |
| [features/visual-asset-video-production-sop.md](features/visual-asset-video-production-sop.md) | Seedance 视频资产生产 SOP |

### 7.5 Reference Markdown

| 文件 | 标题 |
|---|---|
| [reference/chatgpt建议298题作为核心测评母题.md](reference/chatgpt建议298题作为核心测评母题.md) | 一、298题作为核心测评母题 |
| [reference/offline-toolkit-procurement-spec.md](reference/offline-toolkit-procurement-spec.md) | 炫灿职途向导系统 — 线下工具包采购规格书 |
| [reference/visual-asset-master-plan.md](reference/visual-asset-master-plan.md) | 视觉素材统一规划书 — 炫灿职途向导系统 MVP |

### 7.6 视觉资产 Prompt 模板

| Template ID | 版本 | 文件 |
|---|---|---|
| `avatar` | `v1.3.0` | [assets/prompt-templates/avatar.txt](assets/prompt-templates/avatar.txt) |
| `character` | `v1.3.0` | [assets/prompt-templates/character.txt](assets/prompt-templates/character.txt) |
| `damaged-product` | `v1.3.0` | [assets/prompt-templates/damaged-product.txt](assets/prompt-templates/damaged-product.txt) |
| `icon-flat` | `v1.3.0` | [assets/prompt-templates/icon-flat.txt](assets/prompt-templates/icon-flat.txt) |
| `offline-demo` | `v1.3.0` | [assets/prompt-templates/offline-demo.txt](assets/prompt-templates/offline-demo.txt) |
| `offline-video` | `v1.3.0` | [assets/prompt-templates/offline-video.txt](assets/prompt-templates/offline-video.txt) |
| `product-photo` | `v1.3.0` | [assets/prompt-templates/product-photo.txt](assets/prompt-templates/product-photo.txt) |
| `scene-shelf` | `v1.3.0` | [assets/prompt-templates/scene-shelf.txt](assets/prompt-templates/scene-shelf.txt) |
| `software-task` | `v1.3.0` | [assets/prompt-templates/software-task.txt](assets/prompt-templates/software-task.txt) |
| `video-action` | `v1.3.0` | [assets/prompt-templates/video-action.txt](assets/prompt-templates/video-action.txt) |

### 7.7 视觉参考与归档入口

| 文件 | 标题 |
|---|---|
| [assets/reference-assets/README.md](assets/reference-assets/README.md) | 核心参考资产包 R1-R6 |
| [assets/reference-assets/video-scene-anchors/README.md](assets/reference-assets/video-scene-anchors/README.md) | 视频场景锚图 |
| [features/archive/README.md](features/archive/README.md) | 题库视觉资产历史归档 |
| [features/archive/generation-experiments/README.md](features/archive/generation-experiments/README.md) | 历史生成试验 |
| [features/archive/historical-design/README.md](features/archive/historical-design/README.md) | 历史设计资料 |
| [features/archive/job-skill-shelver-pilot-r0-v1-v2/README.md](features/archive/job-skill-shelver-pilot-r0-v1-v2/README.md) | 超市理货员 Pilot R0 v1/v2 审核历史 |
| [features/archive/legacy-data/README.md](features/archive/legacy-data/README.md) | 旧数据与脚本隔离区 |
| [features/archive/superseded-contracts/README.md](features/archive/superseded-contracts/README.md) | 已替代题库资源合同 |
<!-- AUTO-GENERATED:DOC-INVENTORY:END -->
