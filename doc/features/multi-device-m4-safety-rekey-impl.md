# 多设备 M4 安全聚合三元键升级实施计划

## 1. 实现目标

把已通过独立 R3 审查的 `doc/features/multi-device-m4-safety-rekey-prd.md` 转换为可逐步实现、逐步验收、可在语义写入前恢复、语义写入后只前滚的工程计划。

本计划只覆盖 Q1 Step 2A：将安全聚合、开放会话唯一性、阻断、熔断、incident/replacement 归属、评分与报告关联从：

```text
student_id + task_code
```

一次性升级为：

```text
student_id + job_code + task_code
```

计划必须同时关闭以下缺口：

1. 当前正式 Schema 中 10 个二元触发器/守卫、2 个二元开放会话唯一索引、3 个二元查询索引；
2. F7 `2026-07-24_f7_report_framework` 特殊启动 bridge 之后没有显式进入 M4 的启动分支；
3. assessment、training、三条评分路径、训练步骤级联、duplicate replacement、JOB_SKILL 结果/报告中的二元运行查询；
4. 生产安全 SQL 没有版本化 inventory 和一一对账门禁；
5. v0.1.16 历史三元归属、配套 DB/事件日志备份、结构漂移和迁移失败恢复缺少 M4 独立证据。

本计划默认只生成实施文档，不执行编码、迁移、默认运行库修复、commit、push 或 Step 2B。

## 2. 基线与范围

### 2.1 输入与状态

- 批准 PRD：`doc/features/multi-device-m4-safety-rekey-prd.md`。
- PRD 状态：`REVIEWED`；第二轮独立 R3 审查 `PASS`，P0/P1/P2 均为 0。
- PRD 审查快照：`a9e5e15489e01b577577b3f63ed48c94799c85c1ec1c696d98e9d4923eb979f0`。
- 风险等级：R3。
- 影响域：`DOMAIN_LOGIC`、`DATABASE_MIGRATION`、`EVENT_PROJECTION`、`SAFETY_FSM`、`RESULT_REPORT`、`DEPLOYMENT_OPERATIONS`；IPC 公共合同和 UI/UX 仅做“不变”核验。
- 当前 Schema：`v0.1.16-report-framework`。
- 目标 Schema：`v0.1.17-multi-device-m4-safety-rekey`。
- 建议 migration ID：`2026-07-27_mvp_schema_v0_1_17_multi_device_m4_safety_rekey`。
- 当前分支：`feat/multi-device-m2-prd`。
- 规划基点 commit：`ebb106880dd29d648a20f5be11c6057951f9ca7d`。
- 工作区状态：dirty；当前 PRD、架构、权威产品合同、Q1 计划和 BASE_ABILITY 门禁等已有未提交改动。实施时必须保留并逐路径核对，不能要求清空、reset 或覆盖工作区。

### 2.2 权威依据

- `doc/specs/baseline.yaml`；
- `doc/specs/project-invariants.md`；
- `doc/ai/vibe-workflow-contract.md`；
- `doc/specs/MVP_PRD_v1.0.9-authoritative.md` §11.6、§17.2、§17.5 及 M4 后续版本覆盖说明；
- `doc/specs/architecture-plan-b-multi-device-v2.2-authoritative-baseline.md` §7.5、§8、§12.5、§13、§23.1–23.3；
- `src/main/db/schema.sql`；
- `src/main/db/migrations.ts`、`src/main/db/report-migration.ts`、`src/main/db/connection.ts`；
- 当前 production safety-SQL 扫描结果，而非旧任务书的文件清单。

### 2.3 已确认的现状差异

- [!] 权威 PRD 的历史正文和当前 v0.1.16 Schema 仍使用二元键，已审查 M4 PRD 与 §11.6 后续版本覆盖说明要求 v0.1.17 使用三元键。这是本功能要关闭的受控版本差异，不得在实现中静默挑选一边，也不得把目标状态写成当前已实现。
- [!] 权威 PRD §17.2/§17.5 仍保留“同一学生同一任务”的历史验收措辞；v0.1.17 生效时应通过版本覆盖说明明确这些场景改按同一 `student_id + job_code + task_code` 验收，不改写 v1.0.9 当时的历史事实。
- `doc/features/multi-device-m4-m5-impl.md` 是 `STALE / HISTORICAL INPUT`，扫描基线为 v0.1.15。它只能用于核对遗漏风险，不能作为实施任务书。
- 当前 `runDatabaseMigrations()` 无目标参数时故意只运行至 F6；F7 由 `connection.ts` 在 legacy action-log pre-reconcile 和配套备份后显式执行。M4 必须延续这条边界，不得把默认 target 直接推进到 M4。
- 当前 `connection.ts` 在 F7 bridge 后直接执行全量 `schema.sql` 和 seed。M4 必须在这之前完成结构/ledger 分类、历史预检、配套备份和显式 migration，避免全量 Schema 的 `INSERT OR IGNORE` 掩盖缺失 ledger。
- 当前默认运行库存在已知 migration/Schema/账号/题库漂移。本计划和自动测试只使用显式临时库/临时 data root；默认库修复不属于 M4。

### 2.4 明确不做

- 不实现 Step 2B Command Bus、command envelope、统一 mutation registry 或 IPC transport 重构；
- 不实现 Step 2C event batch、hash chain、segment/index、command fencing 或 `startupRecovery` 新协议；
- 不新增 EventType、修改 event payload 语义或改变 `writeEvent()` 的当前顺序；
- 不新增 IPC 参数、preload 通道、renderer 页面、路由或角色能力；
- 不从 UI 接受可信 `jobCode`，不使用默认岗位或字符串猜测补值；
- 不新增表、列、ORM、前端持久化库、CSV 库或报告 Markdown renderer；
- 不自动修复历史错绑，不重开已熔断会话，不删除/覆盖事件、incident、binding、结果或报告；
- 不迁移、重建或修复默认 `xc-career-guide.db`；
- 不把 M4 与 M5A/M5B 合并提交或合并验收；
- 不在 `/vibe-accept` 为 `PASS` 前把 v0.1.17 或 Step 2A 标记为已验收，也不进入 Step 2B。

## 3. 适用不变量

- `INV-EVT-001`：会话状态继续由领域事件与确定性投影推进；M4 不让 UI 直接改状态。
- `INV-EVT-002`：既有事件持久化顺序不变；M4 不顺手实施 batch runtime。
- `INV-EVT-003`：不新增事件类型；若实现被迫新增，立即停止并重审范围。
- `INV-SAFE-001`：同一三元聚合继续先整体熔断，再补充/确认事实。
- `INV-SAFE-002`：不得直接插入 `REDLINE_HALTED` 会话。
- `INV-SAFE-003`：未解决 incident 只阻断同一三元聚合的新会话。
- `INV-SAFE-004`：incident 生命周期、终态和核心事实冻结不变。
- `INV-AUTH-001`：TEACHER/ADMIN 权限边界不变。
- `INV-RES-002`：安全结果优先于普通评分。
- `INV-STR-001`：会话的 strategy/job/version 必须匹配；创建路径从已校验 strategy 取得 `job_code`。
- `INV-IPC-001`：本次不新增 IPC；shared type、preload 和公开参数应保持无差异。
- `INV-DATA-002`：不硬编码正式岗位值或策略参数。
- `INV-DATA-003`：migration 可识别、可重放、失败关闭，并保留历史兼容证据。
- `INV-AUTH-002`：M4 不破坏 business session、grant 和 assignment 的三方一致性。

## 4. 变更地图

### 4.1 当前状态

1. `schema.sql` 的 4 个批量熔断/阻断 trigger、4 个 redline incident 归属守卫、2 个 replacement 归属守卫仍按 student/task。
2. assessment、training、safety incident 的 3 个热路径查询索引，以及 assessment/training 的 2 个开放唯一索引仍按 student/task。
3. `migrations.ts` 当前最后一项是 F7；`assertCurrentDatabaseSchema()` 只要求 F7 结构和 ledger。
4. `connection.ts` 只为 F7 提供 pre-reconcile + backup bridge；没有 F7 完成后的 M4 状态机。
5. 生产聚合查询的已确认缺口包括：
   - `assessment.ts#createSession`：开放 assessment、未解决 incident；
   - `training.ts#createTrainingSession`：开放 training、未解决 incident；
   - `training.ts#haltTrainingSessionSteps`：已熔断 training 与步骤级联；
   - `ability-scoring.ts#hasBlockingSafetyIncident`；
   - `operation-scoring.ts#submitOperationScores`；
   - `job-skill-scoring.ts#submitJobSkillOfflineScores`；
   - `job-skill-result.ts#finalizeJobSkillResultCore` 的安全摘要 JOIN；
   - `safety.ts#voidSafetyIncident` 的 duplicate replacement handler 前置比较。
6. `safety.ts` 生命周期读写、`recovery.ts`、`report-reducer.ts`、`report-builders.ts`、`report-service.ts` 主要按唯一 incident ID 工作；`reports.ts#safetyCandidates`、`safety.ts#listSafetyIncidents` 和 `foundation.ts` 是只读列表/总量。它们不应机械附加三元条件，但必须进入 inventory 并说明允许理由。
7. production safety-SQL 尚无稳定机器清单，无法证明未来没有重新引入二元聚合匹配。

### 4.2 目标状态

1. fresh schema 和 v0.1.16 增量升级都得到同一组 10 个三元 trigger/guard、2 个三元开放唯一索引、3 个三元查询索引。
2. 结构检查同时核对对象集合、规范化 SQL body、索引列/partial predicate、开放状态集合和旧对象不存在；不能只信对象名或 ledger。
3. 所有聚合匹配从可信 strategy/session/incident 事实取得 `job_code`；IPC 参数不增加 `jobCode`。
4. F7→M4 启动编排明确处理 fresh、F7 bridge、legacy M4、current/no-ledger、current/ledger、ledger/drift 六类分支。
5. M4 preflight 在第一条 M4 DDL 前检查旧结构、非空/可追溯 job、redline 引用、binding 和 replacement 三元归属；异常只输出稳定 ID、类别和计数。
6. legacy M4 分支在 DDL 前创建并核验 M4 专属 DB + action-log 配套备份；F7 与 M4 备份目录、manifest 和日志可区分。
7. migration 在一个事务内替换对象、核验结构、执行 `foreign_key_check`/`integrity_check` 并记录 ledger；任一失败恢复完整旧对象集合。
8. 版本化 inventory 与扫描结果一一对应；未登记命中、重复分类、指纹漂移或 `AGGREGATE_MATCH_REKEY` 缺 `job_code` 均失败。
9. 单岗位历史业务行、事件 bytes、状态、binding、结果和报告不变；跨岗位同 task 合法隔离。

### 4.3 启动迁移路径

| 数据库状态 | 允许动作 | 预期结果 |
|---|---|---|
| fresh，且 action log 为空/不存在 | 直接加载含 M4 对象和 ledger 的全量 `schema.sql` | 不运行增量 migration，断言 v0.1.17 |
| fresh，但 action log 非空 | 保持 `FRESH_DATABASE_WITH_ACTION_LOG` 失败关闭 | 不建表、不 seed、不 recovery |
| F7 结构未完成 | 只运行至 F6 → legacy log pre-reconcile → F7 专属配套备份 → 显式运行 F7 | F7 结构与 ledger 均成立后才检查 M4 |
| F7 结构完整但 ledger 缺失 | 显式运行至 F7，先做完整性检查再补 ledger | 不重复 F7 DDL，不由 `schema.sql` seed 掩盖 |
| F7 完整；M4 为完整 v0.1.16 旧对象且无 ledger | M4 只读 preflight → M4 专属配套备份 → 显式运行至 M4 | 得到完整 v0.1.17 对象和 ledger |
| M4 新对象完整但 ledger 缺失 | SQL body/index/query-plan/完整性断言后只补 ledger | 不做 M4 DDL、不创建伪备份 |
| M4 新对象与 ledger 均完整 | 幂等跳过 | 进入全量 schema seed、当前结构断言和 recovery |
| M4 ledger 存在但对象缺失/漂移/仍为旧对象 | 稳定失败 | 零 M4 DDL、零 ledger 改写、零 seed |
| 无 ledger，但新旧对象混合或旧 SQL body 漂移 | 稳定失败 | 不猜测、不重建、不自动修复 |
| 历史三元归属无法证明 | preflight 失败 | DB/action log bytes 不变；另立 R3 数据修复 PRD |

### 4.4 失败恢复路径

- preflight、结构分类或备份核验失败：没有 M4 DDL；关闭数据库并保留原库、日志和只读诊断。
- M4 transaction 内任一步失败：事务回滚；旧 10 个 trigger/guard 和 5 个索引必须全部恢复，M4 ledger 不存在。
- F7 bridge 失败：沿用 F7 稳定错误，不越级尝试 M4。
- M4 尚无任何业务语义写入：经单独运维授权，可从 M4 配套备份恢复整对 DB/action log。
- 已出现跨岗位同 task 等 M4 语义写入：禁止普通 down migration，只允许前滚到继续支持三元语义的兼容版本；灾难恢复必须另行批准。
- 任何恢复都不得自动覆盖默认库、删除事件、改绑 incident/binding 或重开会话。

### 4.5 依赖图

```text
M4-1 生产 SQL inventory 与扫描器基线
 ├── M4-2 M4 迁移内核、结构分类与历史 preflight
 │    └── M4-3 fresh schema + F7→M4 启动编排 + 配套备份
 └── M4-4 会话/评分/训练级联运行查询三元化
      └── M4-5 replacement、结果/报告、回放回归 + inventory 强制门禁

M4-2 + M4-3 + M4-4 + M4-5
 └── M4-6 基线传播、全量回归、独立 Review 与 Accept
```

不得提前合并 M4-2/M4-3 的 migration 激活，也不得在 M4-5 强制门禁前声称 inventory 完整。

### 4.6 跨文件副作用登记表

| 主变更 | 必须同步登记或核验 |
|---|---|
| Schema 版本 v0.1.17 | `schema.sql` 头尾、M4 ledger seed、M4 常量、current schema 断言、recovery snapshot 版本、content-pack 配置/测试、AGENTS/README/baseline/PRD/doc index |
| 10 个 trigger/guard | fresh DDL、incremental DDL、旧/新对象集合与 SQL body matcher、insert/update 行为测试、旧对象不存在断言、架构对象矩阵 |
| 5 个索引 | fresh DDL、incremental DDL、列顺序、partial predicate、旧索引不存在、`EXPLAIN QUERY PLAN`、结构测试 |
| 新 M4 migration | migration 数组必须排在 F7 后、显式 target、默认无参仍停 F6、ledger-only 分支、transaction rollback、M4 verify 命令 |
| F7→M4 启动编排 | F7 pre-reconcile 不回退、F7/M4 备份分名、fresh 分支、seed 时序、失败关闭、连接关闭、启动分支测试 |
| 配套备份 | DB checkpoint/VACUUM 副本、action-log 原样副本、hash/manifest/完整性核验、临时目录测试、无默认库写入 |
| assessment/training 创建查询 | strategy 提供可信 job、开放唯一索引、Schema 阻断 trigger、友好错误码、跨 job/同 job handler 测试 |
| 评分阻断查询 | session SELECT 必须带 job、三条评分 handler、同 job 阻断/跨 job 放行、既有评分结果回归 |
| 训练步骤级联 | `haltTrainingSessionSteps` 签名、assessment 调用点、同三元 halted session 查询、步骤测试 |
| duplicate replacement | handler 三字段比较、Schema insert/update 两个守卫、report reducer/recovery 回放、权限和事务测试 |
| JOB_SKILL 安全摘要 | session JOIN 增加 job、报告内容快照、同 job 保留/跨 job 排除、历史单岗位输出回归 |
| production SQL inventory | JSON 产物、扫描器、指纹、分类枚举、测试证据、package script、baseline 命令、未登记/重复/漂移/二元负测 |
| 不新增 IPC/Event | `src/shared/types/ipc-api.ts`、`src/preload/index.ts`、`src/shared/types/event-payloads.ts` 路径 diff 应为空；既有权限测试继续通过 |
| 新增 `doc/` 文件 | `npm run docs:index:update` 后 `npm run docs:index:check`；自动清单不手改 |

## 5. 实现步骤

### Step M4-1：冻结 production safety-SQL inventory 与扫描器合同

**目的与理由：**

先把当前真实生产 SQL 命中变成机器可对账的基线，防止后续只修改 PRD 点名的 7 个 handler，却漏掉报告、回放、全局只读查询或新复制的二元匹配。

**前置状态：**

- M4 PRD 审查通过；
- 当前 production SQL 尚未修改；
- 工作区现有改动已用 `git status --short` 和路径级 diff 记录。

**完成状态：**

- 新增 inventory JSON，当前每个命中恰好有一个稳定条目；
- 扫描器可区分生产运行 SQL、migration SQL 和测试 fixture；
- 分类只允许 PRD 指定的 4 类；
- baseline 模式确认当前指纹完整；target 模式能明确检出当前 `AGGREGATE_MATCH_REKEY` 缺 `job_code`，该预期失败不接入全量门禁；
- 扫描器单测能杀死未登记、重复登记、指纹漂移和二元 target 四类错误实现。

**不得改变：**

- 不修改 Schema、handler 行为、migration 数组或启动编排；
- 不把 migration/test SQL 混进生产清单凑覆盖率；
- 不把按唯一 incident ID 的合法查询误判为三元聚合查询；
- 不为通过扫描器而把 SQL 隐藏、拼接或加入无语义 `job_code` 文本。

**改动文件及职责：**

- `doc/features/multi-device-m4-safety-sql-inventory-v1.json`（新增）：版本化权威 inventory；每项至少含 `id`、`file`、`symbol`、`sql_fingerprint`、`classification`、`current_predicate`、`target_predicate`、`allowed_reason`、`test_evidence`、`status`。
- `scripts/lib/multi-device-m4-safety-sql-inventory.mjs`（新增）：生产文件枚举、SQL literal/模板片段提取、规范化、SHA-256 指纹和一一对账逻辑。
- `scripts/check-multi-device-m4-safety-sql-inventory.mjs`（新增）：baseline/target 两种显式模式；target 模式最终不得保留 bypass。
- `scripts/__tests__/multi-device-m4-safety-sql-inventory.test.mjs`（新增）：fixture 驱动的 scanner 负向测试，并核对真实仓库 baseline inventory。
- `doc/index.md`：只由索引脚本更新自动清单。

**跨文件登记项：**

- [ ] 扫描范围覆盖 `src/main/**/*.ts`，排除 `__tests__`、test helpers 和明确登记的 migration 模块；
- [ ] 捕获全部 `FROM/JOIN/INSERT INTO/UPDATE safety_incident`；
- [ ] 捕获 assessment/training 开放状态聚合查询、redline/replacement 归属检查和 training step 级联；
- [ ] `safety.ts` 读写、`recovery.ts`、`report-reducer.ts`、`report-builders.ts`、`report-service.ts`、`reports.ts`、`foundation.ts` 均有分类结论；
- [ ] 每个命中只对应一个 inventory ID，inventory 中也不存在无命中条目；
- [ ] migration SQL 单独在 M4-2/M4-3 结构测试覆盖，不出现在 production inventory。

**核心设计与伪代码：**

```text
files = listProductionTsFiles()
hits = extractSqlOccurrences(files, candidatePatterns)
for hit in hits:
  symbol = enclosingFunctionOrStableAnchor(hit)
  normalized = normalizeSql(hit.sql)
  fingerprint = sha256(file + "\0" + symbol + "\0" + normalized)

compare hits <-> inventory by stable id/fingerprint
reject unknown classification or duplicate mapping

if mode == TARGET:
  reject status != REKEYED for AGGREGATE_MATCH_REKEY
  reject aggregate SQL without semantic student_id + job_code + task_code match
```

已知分类边界：

- `AGGREGATE_MATCH_REKEY`：create/open/block、评分阻断、训练步骤级联、JOB_SKILL 安全摘要；
- `INCIDENT_PRIMARY_KEY_LOOKUP`：按 `incident_id` 获取/更新 lifecycle、报告 builder/service、reducer/recovery 幂等检查；
- `STUDENT_WIDE_LIST`：明确只读的安全列表/报告候选，不参与阻断、熔断、归属或结果关联；
- `NON_SAFETY_QUERY`：全局 dashboard 计数、按 replacement pointer 追溯 lineage、合法 incident INSERT 等，并写清排除理由。

**数据、事务与失败恢复：**

- 本步只读源码并新增文档/脚本，不写数据库；
- inventory 生成或检查失败时不覆盖旧 JSON；
- 删除本步新增文件即可独立回退，不影响运行行为。

**测试设计：**

- 单元正常：真实 baseline 命中集合与 inventory 一一相等；
- 单元异常：新增未登记 SQL、删除登记 SQL、重复 ID/指纹、修改 SQL body、非法分类均失败；
- 边界：动态模板 builder、同一 helper 多调用、migration/test 排除不产生漏报；
- 负向：target fixture 少 `job_code` 失败，仅在注释中写 `job_code` 仍失败；
- 回归：脚本不扫描 renderer、shared type 或文档中的示例 SQL。

**精确验证命令：**

```bash
npm test -- scripts/__tests__/multi-device-m4-safety-sql-inventory.test.mjs
node scripts/check-multi-device-m4-safety-sql-inventory.mjs --mode baseline
npm run docs:index:update
npm run docs:index:check
git diff --check
```

target 模式在本步应以“发现待 re-key 项”退出非零；只能记录为预期负向证据，不能写成 `PASS`。

**预期证据：**

- baseline 检查 `PASS`，输出命中数、分类计数和 inventory 版本；
- target 检查列出所有待 re-key ID，且没有“未登记命中”；
- scanner 单测全部通过；
- doc index 同步。

**回滚方式：**

删除本步新增 inventory/scanner/test，并恢复本步生成的 doc index 自动清单；不触碰其他未提交改动。

**停止条件：**

- 无法稳定提取某个生产动态 SQL；
- 无法判定查询是否参与安全聚合；
- 扫描发现新的公开 IPC job 输入、未知安全写入口或 PRD 未覆盖的权限语义。

**建议 commit message：**

`test(m4): freeze production safety sql inventory`

### Step M4-2：实现 M4 迁移内核、结构分类与历史预检

**目的与理由：**

先实现尚未接入启动路径的纯 M4 migration kernel，让旧/新结构识别、历史失败关闭、15 个对象替换和事务回滚可在隔离数据库中独立证明，再修改当前应用基线。

**前置状态：**

- M4-1 inventory baseline `PASS`；
- 当前全量 Schema 和启动路径仍为 v0.1.16/F7；
- 已冻结当前 v0.1.16 的 10 个旧 trigger/guard 和 5 个旧 index 定义。

**完成状态：**

- M4 常量、旧/新对象合同、严格结构分类、只读历史 preflight 和 DDL apply 函数存在；
- M4 migration 在 `migrations.ts` 中严格位于 F7 后，只有显式 `throughMigrationId` 才可调用；
- 无参数 `runDatabaseMigrations()` 仍停在 F6；
- 本步尚不让 `assertCurrentDatabaseSchema()` 或 `connection.ts` 要求 M4，避免半接入启动路径；
- 隔离迁移测试证明正常、drift、历史错绑、ledger-only 和第 N 对象故障回滚。

**不得改变：**

- 不修改 `schema.sql` 当前版本或 fresh schema；
- 不修改 `connection.ts`、seed、recovery 或默认 migration target；
- 不更新业务行、事件、binding、session 状态、结果或报告；
- 不自动修正空 job、错绑 incident 或 replacement；
- 不提供普通 down migration。

**改动文件及职责：**

- `src/main/db/safety-rekey-migration.ts`（新增）：M4 version/ID、旧/新 15 对象 SQL、结构状态机、preflight、apply 和稳定错误类型。
- `src/main/db/migrations.ts`：静态 import M4 模块，在 F7 后注册 migration；显式 target 可运行，默认 F6 cap 保持。
- `src/main/db/__tests__/fixtures/m4-v016-safety-objects.sql`（新增）：冻结当前 v0.1.16 的 15 个旧对象，供非同源 fixture 核验。
- `src/main/db/__tests__/safety-rekey-migration.test.ts`（新增）：结构、数据、事务、query-plan 与故障注入测试。
- `src/main/db/__tests__/migrations.test.ts`：增加 F7→M4 显式 target 顺序、ledger 和默认 cap 回归。

**跨文件登记项：**

- [ ] 常量：`M4_SCHEMA_VERSION`、`M4_SAFETY_REKEY_MIGRATION_ID`；不得复用含义为 M3 的既有 `CURRENT_SCHEMA_VERSION`；
- [ ] migration 数组顺序为 F7 → M4；
- [ ] `rebuildsReferencedTables` 不启用，M4 不重建表、不关闭 foreign keys；
- [ ] 旧对象识别要求 10+5 集合和规范化 SQL body 全匹配；
- [ ] 新对象识别要求 10+5 集合、SQL body、索引列/partial predicate 全匹配，且旧名称不存在；
- [ ] 4 个主 trigger 名称虽不变，也必须区分旧/新 body；
- [ ] 6 个 `same_student_task` 旧 guard 必须由 `same_student_job_task` 新名称替换；
- [ ] preflight 先于第一条 M4 DROP/CREATE；
- [ ] `foreign_key_check`、`integrity_check` 和 ledger 写入与 DDL 同一 transaction；
- [ ] 错误只包含稳定 row ID、问题类型和计数，不泄露姓名、题目、密码或完整描述。

**核心设计与伪代码：**

```text
inspectM4Structure(db):
  legacy = exactMatch(legacy 10 triggers + 5 indexes) && noNewNamedObjects
  current = exactMatch(current 10 triggers + 5 indexes) && noLegacyNamedObjects
  if legacy: return LEGACY_V016
  if current: return CURRENT_M4
  return PARTIAL_OR_DRIFTED(with stable issue ids)

preflightM4History(db):
  assert F7 structure and ledger are present
  assert trim(job_code) non-empty in incident/assessment/training
  assert assessment/training strategy_id+type+job+version resolves to one strategy row
  assert every REDLINE_HALTED.redline_incident_id has same student+job+task
  assert every binding resolves to an aggregate with same incident triplet
  assert every replacement link has same incident triplet
  if any count > 0: throw M4_HISTORY_KEY_MISMATCH before DDL

applyM4(db):
  require inspect == LEGACY_V016
  preflightM4History(db)  // defensive repeat for direct callers
  execute each DROP/CREATE as an individually identifiable operation
  require inspect == CURRENT_M4
```

preflight 对“可追溯”的最小、非推断定义：session 必须与现有 strategy 四字段匹配；无会话 incident 允许以自身持久化 `student_id/job_code/task_code` 作为事实，但其 redline、binding、replacement 外键关系必须与该三元事实一致。不得额外猜测岗位或要求无会话 incident 绑定 session。

**数据、事务与失败恢复：**

- `runDatabaseMigrations()` 负责 transaction、完整性检查和 ledger；M4 `up` 不自行嵌套事务；
- DDL 数组逐对象执行，测试 adapter 可在第 N 项抛错；
- transaction 失败后核对旧 10+5 对象 body 全部恢复且 M4 ledger 为 0；
- 成功前后对除 `schema_migration`/`sqlite_master` 外的业务表做排序 canonical hash，必须相等。

**测试设计：**

- 正常：完整 v0.1.16 对象迁到 M4，10+5 新对象精确匹配；
- 历史：单岗位 assessment/training/incident/binding/result/report/event 行 hash 不变；
- 跨岗：新唯一索引允许同 student/task 不同 job 开放会话，同三元重复仍拒绝；
- preflight：空 job、strategy job 漂移、assessment/training redline 错绑、两类 binding 错绑、replacement 错绑分别在 DDL 前失败；
- drift：同名主 trigger body 改写、旧/新对象混合、索引列或 partial status 漂移均失败；
- ledger-only：新结构完整、M4 ledger 缺失时只执行完整性检查和 ledger 写入；
- ledger/drift：ledger 已有但结构旧/缺失/漂移时拒绝；
- 故障注入：每个 DROP/CREATE 边界及结构/完整性检查失败都回滚；
- 性能：3 个关键查询的 `EXPLAIN QUERY PLAN` 命中新三元查询索引；
- 回归：默认 migration 调用仍只到 F6，显式 F7/M4 target 顺序正确。

**精确验证命令：**

```bash
npm test -- src/main/db/__tests__/safety-rekey-migration.test.ts src/main/db/__tests__/migrations.test.ts
npm run typecheck
npm run lint
git diff --check
```

**预期证据：**

- migration 顺序最后两项为 F7、M4；
- 正常迁移业务数据 hash 不变，`foreign_key_check=[]`、`integrity_check=ok`；
- 每个故障注入案例旧 10+5 对象完整、M4 ledger 不存在；
- 默认 target 未改变。

**回滚方式：**

M4 尚未接入启动路径；按本步 path 恢复 migration 注册并删除新增模块/fixture/test，即可独立回退。不得删除或覆盖用户其他工作区改动。

**停止条件：**

- 扫描证明 M4 需要新增表、列或事件；
- 无法以只读 SQL 证明某类历史三元归属；
- migration 需要改变 F7 数据、权限、FSM 或报告语义；
- SQL.js/临时 SQLite 对 transaction rollback 的结果与正式 SQLite 不一致且无法补充证据。

**建议 commit message：**

`feat(db): add M4 safety rekey migration kernel`

### Step M4-3：升级 fresh schema，并接入 F7→M4 启动编排与配套备份

**目的与理由：**

把已验证的 M4 kernel 安全接入全量 Schema 和真实 `initDatabase()` 前置编排，确保 fresh 与 v0.1.16 旧库最终都进入同一 v0.1.17，而不是由全量 Schema seed 或 F7 bridge 偶然掩盖状态。

**前置状态：**

- M4-2 migration kernel 与全部失败关闭测试通过；
- `connection.ts` 仍只编排 F7；
- 默认运行库不参与本步。

**完成状态：**

- fresh `schema.sql` 直接生成 M4 10+5 对象和 M4 ledger；
- current schema assertion、recovery snapshot 和 content-pack 基线使用 v0.1.17；
- 非 fresh 启动严格执行 §4.3 分支；
- F7 与 M4 配套备份各自有 stage-specific 目录、manifest、DB 完整性和 action-log hash 证据；
- 任一 F7/M4 失败都在全量 schema seed 和业务 recovery 前关闭连接；
- 新的 `db:m4:verify` 只创建/使用临时库和临时 data root。

**不得改变：**

- 不改变 F7 legacy action-log pre-reconcile 的时序和错误语义；
- 不把 M4 加到 `runDatabaseMigrations()` 无参数默认 target；
- 不在 preflight/backup 之前执行 `database.exec(schema)`；
- 不把 F7 backup 复用或重命名为 M4 backup；
- 不在测试中打开默认运行库；
- 不开始修改 handler 聚合查询。

**改动文件及职责：**

- `src/main/db/schema.sql`：头尾版本、15 个 M4 对象、错误文案/注释、M4 ledger seed。
- `src/main/db/migrations.ts`：`currentSchemaIssues()`/`assertCurrentDatabaseSchema()` 要求 M4；新增仅验证至 F7 的 pre-M4 断言供启动编排使用。
- `src/main/db/migration-startup.ts`（新增）：不依赖 Electron 的 F7→M4 分支编排，可注入 pre-reconcile/backup 回调并做单元测试。
- `src/main/db/migration-backup.ts`（新增）：stage-specific paired backup、manifest、hash 和完整性核验；只接收显式路径。
- `src/main/db/connection.ts`：静态 import 启动编排和备份 helper；全量 schema/seed/recovery 只在 F7/M4 成功后执行；recovery snapshot 写 M4 版本。
- `src/main/db/__tests__/schema-m4-safety-rekey.test.ts`（新增）：fresh schema 结构与真实行为。
- `src/main/db/__tests__/connection-m4-safety-rekey.test.ts`（新增）：所有互斥启动分支和调用顺序。
- `src/main/db/__tests__/migration-backup.test.ts`（新增）：临时目录中的配套备份、manifest/hash/失败清理。
- `src/main/db/__tests__/migrations.test.ts`、`src/main/db/__tests__/schema-report-framework.test.ts`：current baseline 与 F7 历史里程碑回归。
- `scripts/verify-m4-migration.mjs`（新增）：串联 M4 定向 schema/migration/startup/backup tests，强制临时路径。
- `package.json`：新增 `db:m4:verify`。
- `scripts/config/database-content-pack.json`：current schema/migration 和 required ledger 增加 M4。
- `scripts/__tests__/database-content-pack.test.mjs`、`scripts/__tests__/database-content-pack-migration-ledger.test.mjs`：v0.1.17 参考库和 M4 ledger 断言。

**跨文件登记项：**

- [ ] fresh Schema 与 incremental module 的 10+5 SQL 规范化完全一致；
- [ ] `schema.sql` 同时保留 F7 ledger 并追加 M4 ledger；
- [ ] current assertion 检查 M4 结构与 ledger，不只检查版本字符串；
- [ ] F7 structure 完整但 ledger 缺失时，通过 migration runner 补记，不由 schema seed 补记；
- [ ] M4 structure 完整但 ledger 缺失时，不执行 DDL或创建 M4 backup；
- [ ] M4 legacy/no-ledger 分支先 preflight，再 M4 backup，再显式 target；
- [ ] ledger/drift 和 partial/drift 分支在 `database.exec(schema)` 前失败；
- [ ] catch 路径关闭 database、清空 singleton，不执行 seed/recovery；
- [ ] backup manifest 至少记录 stage、migration ID、UTC time、DB hash、action-log presence/hash、验证结果；
- [ ] action log 存在时副本 bytes/hash 必须相等；不存在时 manifest 明确记录 `ABSENT`，不得伪称已复制；
- [ ] DB 副本执行 `integrity_check=ok`，备份失败不能进入 migration；
- [ ] 所有自动测试使用 `mkdtemp`/显式临时路径并清理。

**核心设计与伪代码：**

```text
orchestrateDatabaseUpgrade(db, deps):
  if fresh:
    return FRESH_SCHEMA_REQUIRED

  if !isF7StructurallyApplied(db):
    runMigrations(through F6)
    preReconcileLegacyActionLog()
    createVerifiedPairedBackup(stage=F7)
    runMigrations(through F7) or throw F7_MIGRATION_FAILED
  else if !hasF7Ledger(db):
    runMigrations(through F7)  // integrity then ledger only

  assertPreM4DatabaseSchema(db)
  state = inspectM4StructureAndLedger(db)
  switch state:
    LEGACY_NO_LEDGER:
      preflightM4History(db)
      createVerifiedPairedBackup(stage=M4)
      runMigrations(through M4)
    CURRENT_NO_LEDGER:
      assertM4SqlBodiesAndQueryPlans(db)
      runMigrations(through M4)  // ledger only
    CURRENT_WITH_LEDGER:
      no-op
    otherwise:
      throw stable M4 drift/recovery error

connection:
  orchestrateDatabaseUpgrade(...)
  transaction(exec current schema)  // seed only after orchestration
  assertCurrentDatabaseSchema()
  seedDevUsers()
  recoverActionLog(schemaVersion=M4_SCHEMA_VERSION)
```

**数据、事务与失败恢复：**

- backup 创建失败时不调用 migration；若生成了不完整的新备份目录，移动到标记为 `INCOMPLETE` 的隔离目录或仅删除本次新建且已精确解析的临时目录，绝不触碰既有备份；
- M4 transaction 失败保留已核验配套备份和稳定日志，原库保持旧 10+5；
- `database.exec(schema)` 和 dev seed 在 M4 成功后才执行；
- startup test 记录调用序列，证明 failure 分支没有 seed/recovery；
- 不自动 restore 备份。

**测试设计：**

- fresh：全量 schema 一次加载，M4 ledger=1，旧对象=0，新对象=15；
- F7 bridge：F6→pre-reconcile→F7 backup→F7→M4 preflight→M4 backup→M4 顺序；
- F7 current/no-ledger：只补 F7 ledger 后进入 M4；
- M4 legacy/no-ledger：只创建一份 M4 stage backup，迁移后 current；
- M4 current/no-ledger：无 M4 backup/DDL，仅补 ledger；
- M4 current/ledger：幂等零迁移；
- ledger/drift、partial/no-ledger、preflight fail、backup fail、migration fail：均无 seed/recovery；
- F7 与 M4 备份目录/manifest 不同，event log hash 一致；
- fresh schema 行为覆盖 M4-01–M4-06、binding 唯一、安全结果优先和无会话 incident；
- 查询计划命中 3 个新索引；
- content-pack 参考库要求 M4 ledger，删除任一 ledger 会失败。

**精确验证命令：**

```bash
npm test -- src/main/db/__tests__/schema-m4-safety-rekey.test.ts src/main/db/__tests__/safety-rekey-migration.test.ts src/main/db/__tests__/connection-m4-safety-rekey.test.ts src/main/db/__tests__/migration-backup.test.ts src/main/db/__tests__/migrations.test.ts src/main/db/__tests__/schema-report-framework.test.ts scripts/__tests__/database-content-pack.test.mjs scripts/__tests__/database-content-pack-migration-ledger.test.mjs
npm run db:m4:verify
npm run typecheck
npm run lint
git diff --check
```

**预期证据：**

- fresh/upgrade/ledger/drift 分支各有独立测试名和调用顺序断言；
- M4 backup manifest 与 source action log hash 匹配；
- 所有失败分支 `seedCalls=0`、`recoveryCalls=0`；
- v0.1.17 current assertion、content-pack 参考库和 M4 ledger 通过；
- 未访问默认 DB。

**回滚方式：**

- 尚未部署或尚无 M4 语义写入：恢复本步代码/Schema/config，并使用实施前代码继续读取 v0.1.16；已迁移的测试库直接丢弃。
- 已部署但无 M4 语义写入：只能经授权恢复完整配套 DB/action log，不执行对象级 down。
- 已有 M4 语义写入：禁止回滚 Schema，只回滚不改变三元合同的应用代码，或前滚修复。

**停止条件：**

- 无法保持 F7 pre-reconcile bridge 的既有行为；
- backup 无法证明 DB 完整或 action-log bytes 配对；
- `database.exec(schema)` 仍可能在结构分类前补 ledger/seed；
- 需要修改默认运行库或新增人工 repair 逻辑；
- current/no-ledger 与 ledger/drift 无法可靠区分。

**建议 commit message：**

`feat(db): orchestrate safe F7 to M4 startup`

### Step M4-4：将会话创建、评分阻断和训练步骤级联升级为三元查询

**目的与理由：**

让应用层友好前置校验、评分门禁和红线后的步骤级联与 v0.1.17 Schema 使用同一聚合键；所有 `job_code` 必须来自已验证 strategy/session。

**前置状态：**

- M4-3 fresh/upgrade Schema 与启动编排通过；
- M4-1 inventory 仍完整标记当前/目标谓词；
- 不存在公开 jobCode 参数变更。

**完成状态：**

- assessment/training 同 student/task 不同 job 可并存，不互相阻断；
- 同三元键重复开放会话仍返回既有友好错误并由唯一索引兜底；
- job A incident 不阻断 job B 的 BASE_ABILITY、TASK_OPERATION 或 JOB_SKILL 评分；
- 同 job incident 仍阻断全部对应路径；
- training step 级联只处理同三元键已 halt 的 training；
- inventory 中相关条目更新为新指纹和 `REKEYED`，但全局 target 门禁在 M4-5 才启用。

**不得改变：**

- 不新增/修改 IPC params、preload、shared API 或 EventType；
- 不信任 `params.jobCode`，也不硬编码 `SUPERMARKET_SHELVER`；
- 不改变错误码、评分公式、result type、权限或事务边界；
- 不让 job B 绕过其自身同三元 incident；
- 不把学生级只读列表收窄为单 job。

**改动文件及职责：**

- `src/main/ipc/handlers/assessment.ts`：`createSession` 的开放 session/incident 查询增加 `strategy.job_code`；redline 注释改为三元；调用 training step 级联时传 session.job_code。
- `src/main/ipc/handlers/training.ts`：创建查询使用 `strategy.job_code`；`haltTrainingSessionSteps(db, studentId, jobCode, taskCode)` 只查同三元 halted session。
- `src/main/ipc/handlers/ability-scoring.ts`：`hasBlockingSafetyIncident` 使用 session.job_code。
- `src/main/ipc/handlers/operation-scoring.ts`：评分阻断查询使用 session.job_code。
- `src/main/ipc/handlers/job-skill-scoring.ts`：session SELECT 增加 `job_code`，阻断查询使用该持久化事实并删除陈旧注释。
- `src/main/domain/assessment-reducer.ts`：仅修正 redline guard/重放说明为三元语义；若需逻辑改动必须先说明原因。
- `doc/features/multi-device-m4-safety-sql-inventory-v1.json`：更新相关 SQL 指纹、target predicate、测试证据和状态。
- 对应测试：`assessment-create.test.ts`、`training-create.test.ts`、`assessment-redline.test.ts`、`training-redline.test.ts`、`assessment-ability-scoring.test.ts`、`operation-scoring.test.ts`、`job-skill-scoring.test.ts`、`assessment-reducer.test.ts`。

**跨文件登记项：**

- [ ] assessment create 的 open 和 blocked 两个查询都使用 strategy.job_code；
- [ ] training create 的 open 和 blocked 两个查询都使用 strategy.job_code；
- [ ] 三个 scoring handler 都从 session row 取 job，不接受外部补值；
- [ ] job-skill-scoring 的 TS row type 同步增加 job_code；
- [ ] `haltTrainingSessionSteps` 定义、唯一调用点和测试同步改签名；
- [ ] Schema unique/block/halt 与 handler predicates 的开放状态集合保持一致；
- [ ] reducer 冷启动分支仍由 Schema guard 拒绝跨 job incident；
- [ ] shared/preload/event files path diff 为空；
- [ ] 每个 inventory 指纹同步更新且仍一一对账。

**核心设计与伪代码：**

```text
assessment/training create:
  strategy = SELECT ... job_code ...
  open = WHERE student_id=? AND job_code=strategy.job_code AND task_code=? [...]
  blocked = WHERE student_id=? AND job_code=strategy.job_code AND task_code=? [...]

scoring:
  session = SELECT ... student_id, job_code, task_code ... BY session PK
  blocked = safety_incident WHERE all three keys match and unresolved

redline step cascade:
  haltTrainingSessionSteps(student, session.job_code, task)
  SELECT halted training WHERE all three keys match
  UPDATE only those training_step_record rows
```

**数据、事务与失败恢复：**

- 本步不做 migration 或新持久化字段；
- 前置 SELECT 与 Schema trigger/index 使用同一三元键，仍以 SQLite 为并发最终裁决；
- handler 事务失败保持既有回滚语义；
- 回滚本步代码不会改写数据，但在 v0.1.17 上会重新引入跨 job 误阻断，故只能在没有 M4 语义写入的开发环境回滚；部署后必须前滚。

**测试设计：**

- assessment create：job A 已开放/有 incident，job B 同 task 可创建；job A 重复仍拒绝；
- training create：同上；
- redline：job A assessment+training 均 halt/bind，job B 两类会话与 step 不变；
- ability scoring：仅 job A incident 时 job B BASE_ABILITY 可提交；同 job 拒绝；
- operation scoring：跨 job 放行、同 job 阻断；
- job-skill scoring：session job 字段驱动查询，跨 job 放行、同 job 阻断；
- reducer replay：跨 job incident 无法绑定目标 session，同 job 保持幂等；
- 权限/错误码：既有 FORBIDDEN、SESSION_ALREADY_OPEN、DUPLICATE_TRAINING_SESSION、BLOCKED_BY_SAFETY_INCIDENT 不变；
- 回归：单岗位现有测试继续通过。

**精确验证命令：**

```bash
npm test -- src/main/ipc/handlers/__tests__/assessment-create.test.ts src/main/ipc/handlers/__tests__/training-create.test.ts src/main/ipc/handlers/__tests__/assessment-redline.test.ts src/main/ipc/handlers/__tests__/training-redline.test.ts src/main/ipc/handlers/__tests__/assessment-ability-scoring.test.ts src/main/ipc/handlers/__tests__/operation-scoring.test.ts src/main/ipc/handlers/__tests__/job-skill-scoring.test.ts src/main/domain/__tests__/assessment-reducer.test.ts
node scripts/check-multi-device-m4-safety-sql-inventory.mjs --mode baseline
npm run typecheck
npm run lint
git diff --check
```

**预期证据：**

- 每条跨 job 用例明确断言 job B 未被误阻断/误 halt；
- 每条同 job 用例明确断言原安全门禁仍生效；
- inventory 无未登记命中；
- shared/preload/event 合同无 diff。

**回滚方式：**

仅在 M4 尚未产生业务语义写入的开发/测试环境恢复本步 handler 与 inventory 指纹；生产或已写入环境不得降回二元查询。

**停止条件：**

- 某路径只能通过新增 IPC `jobCode` 才能实现；
- strategy/session job 无法证明一致；
- 错误码或权限边界必须改变；
- 跨 job 测试只能靠禁用 Schema trigger/index 才能通过。

**建议 commit message：**

`fix(safety): scope session and scoring gates by job`

### Step M4-5：关闭 replacement、结果/报告和回放边界，并启用 inventory 强制门禁

**目的与理由：**

完成剩余运行语义：duplicate replacement 必须比较完整三元键，JOB_SKILL 安全摘要不得串岗；同时证明按 incident PK 的生命周期/报告/回放查询是合法例外，并把 inventory 从基线审计升级为不可绕过的 target 门禁。

**前置状态：**

- M4-4 所有聚合查询与 inventory 指纹已更新；
- Schema replacement insert/update guard 已为三元；
- report/recovery 仍使用既有事件和 payload。

**完成状态：**

- handler 在进入事务/Schema 前拒绝跨 job `DUPLICATE_RECORD`，同三元键仍通过；
- factual correction 继续复制旧 incident 的完整三元事实并保持单事务；
- JOB_SKILL safety summary 只含同 student/job/task 非 VOIDED incident；
- incident PK lifecycle、报告 builder/service、report reducer 和 recovery 路径经测试证明不需要机械附加三元 WHERE；
- target inventory 检查无 pending、未登记、重复或漂移项，并成为 package/baseline 门禁。

**不得改变：**

- 不改变 TEACHER/ADMIN 权限、incident FSM、void reason、event payload 或报告 JSON 结构；
- 不把按 incident ID 的安全报告/回放改成可能找不到历史事实的复合查询；
- 不收窄安全列表/报告候选等明确只读跨岗位视图；
- 不让 inventory exemption 允许阻断、熔断、归属或结果关联继续用二元键。

**改动文件及职责：**

- `src/main/ipc/handlers/safety.ts`：duplicate replacement 前置比较增加 `job_code`；既有读写 SQL inventory 分类与测试证据补齐。
- `src/main/ipc/handlers/job-skill-result.ts`：安全摘要 JOIN 增加 `s.job_code = si.job_code`。
- `src/main/domain/report-reducer.ts`、`src/main/domain/recovery.ts`：原则上不改 SQL；补/扩展三元 payload 与 Schema guard 回归测试。若发现逻辑缺口，仅作范围内最小修正。
- `src/main/domain/report-builders.ts`、`src/main/domain/report-service.ts`、`src/main/ipc/handlers/reports.ts`、`src/main/ipc/handlers/foundation.ts`：原则上不改行为；inventory 记录 PK/list/non-safety 分类理由。
- `doc/features/multi-device-m4-safety-sql-inventory-v1.json`：全部 target 状态、最终指纹、允许理由和测试证据。
- `scripts/check-multi-device-m4-safety-sql-inventory.mjs`：移除实施期 pending bypass，默认即 target fail-closed。
- `package.json`：新增 `contract:m4:safety-sql:check`。
- `doc/specs/baseline.yaml`：登记 M4 inventory check 和 `db:m4:verify` 命令。
- 测试：`safety.test.ts`、`job-skill-result.test.ts`、`report-reducer.test.ts`、`recovery.test.ts`、`report-builders.test.ts`、`reports.test.ts`、inventory script tests。

**跨文件登记项：**

- [ ] duplicate handler 比较 student/job/task，Schema insert/update guard 也比较三字段；
- [ ] factual correction payload 的 student/job/task 与旧 incident 一致，reducer 再校验；
- [ ] JOB_SKILL safety summary JOIN 三字段齐全；
- [ ] safety report 仍按唯一 incident/root lineage 生成，不串改来源；
- [ ] recovery 的 incident INSERT 使用事件中完整三元事实，后续 mutation 按唯一 ID；
- [ ] `STUDENT_WIDE_LIST` 仅用于只读展示/候选，不被复用到安全决策；
- [ ] inventory 默认命令不接受 `PENDING_REKEY` 或 allow flag；
- [ ] package script 与 baseline.yaml 名称一致；
- [ ] shared event/IPC/preload 合同无改动。

**核心设计与伪代码：**

```text
duplicate replacement:
  current = readIncident(currentId)     // PK lookup
  replacement = readIncident(targetId)  // PK lookup
  require replacement.id != current.id
  require replacement.student == current.student
       && replacement.job == current.job
       && replacement.task == current.task
  transaction(event + UPDATE); Schema guard remains final authority

job skill summary:
  JOIN assessment_session s
    ON s.student_id = si.student_id
   AND s.job_code = si.job_code
   AND s.task_code = si.task_code
  WHERE s.session_id = ? AND si.status <> 'VOIDED'

inventory final:
  scan current production sources
  require exact 1:1 mapping
  require every AGGREGATE_MATCH_REKEY semantic predicate contains job_code
  require exemption category + reason + test evidence
```

**数据、事务与失败恢复：**

- duplicate/factual correction 保持既有单事务事件+投影顺序；
- report/recovery 不改历史 bytes、snapshot schema 或结果含义；
- inventory 失败阻断合并，但不写运行数据；
- 已有 M4 语义写入后，本步只能前滚修复。

**测试设计：**

- duplicate：同 student/task 不同 job 在 handler 前置返回稳定 `VALIDATION_ERROR`，事件/incident/report 均无写入；
- duplicate：同三元键成功，权限和终态守卫不回退；
- Schema：replacement insert/update 跨 job 均拒绝，同 job 均允许；
- factual correction：reducer/recovery 保留完整三元键，跨 job payload/历史状态冲突失败并回滚；
- JOB_SKILL result：job A incident 不进入 job B summary；job B 同三元 incident 仍进入；单岗位 snapshot 不变；
- report：按 incident ID 的安全报告、root lineage 和 binding snapshot 正常；
- list：跨岗位只读列表仍可展示，不参与阻断；
- inventory：真实 target `PASS`；新增一个未登记二元查询 fixture 必须 `FAIL`；
- 全量安全 FSM/权限回归继续通过。

**精确验证命令：**

```bash
npm test -- src/main/ipc/handlers/__tests__/safety.test.ts src/main/ipc/handlers/__tests__/job-skill-result.test.ts src/main/domain/__tests__/report-reducer.test.ts src/main/domain/__tests__/recovery.test.ts src/main/domain/__tests__/report-builders.test.ts src/main/ipc/handlers/__tests__/reports.test.ts scripts/__tests__/multi-device-m4-safety-sql-inventory.test.mjs
npm run contract:m4:safety-sql:check
npm run db:m4:verify
npm run typecheck
npm run lint
git diff --check
```

**预期证据：**

- duplicate 跨 job 零写入、同 job 正常；
- JOB_SKILL report summary 无跨 job incident；
- recovery/report lifecycle 不回退；
- target inventory 输出 `PASS`，无 exemption 缺理由或测试；
- M4 database verify 仍通过。

**回滚方式：**

实施环境尚无 M4 语义写入时可按本步 path 恢复；已有 M4 写入时禁止恢复二元 replacement/report 逻辑，只能前滚。

**停止条件：**

- inventory 仍有未分类生产 SQL；
- 需要改变 event payload、报告 JSON、权限或 FSM 才能通过；
- 某个 exemption 实际参与阻断、熔断、归属或结果计算；
- report/recovery 测试显示历史单岗位输出漂移。

**建议 commit message：**

`fix(m4): isolate safety lineage and enforce sql inventory`

### Step M4-6：传播 v0.1.17 基线，执行全量回归并准备独立验收

**目的与理由：**

在代码、迁移、运行查询和静态门禁全部通过后，才把当前工程基线传播为 v0.1.17，生成完整证据包并进入独立 `/vibe-review code` 和 `/vibe-accept`；文档不得提前宣称已验收。

**前置状态：**

- M4-1–M4-5 的定向验收均为 `PASS`；
- target inventory 和 `db:m4:verify` 为 `PASS`；
- 没有未关闭的 P0/P1。

**完成状态：**

- 当前工程入口、产品覆盖说明、架构实现事实、content-pack 和 doc index 均指向 v0.1.17；
- 历史 v0.1.16/F7 文档保持历史语境，不做无差别替换；
- 全量 typecheck、lint、tests、build、docs index、diff check 有退出码证据；
- 临时 SQLite 的结构、行为、迁移、hash、query-plan 和备份恢复演练有记录；
- Electron 人工场景逐项记录 `PASS/FAIL/NOT_RUN/BLOCKED`；
- 独立代码 Review P0/P1 清零；
- `/vibe-accept` 未通过前，PRD/impl 仅可标记 `IMPLEMENTED_PENDING_ACCEPTANCE`，Step 2B 仍阻断。

**不得改变：**

- 不把历史 `report-page-framework-impl.md`、旧 M4/M5 任务书或已冻结 validation snapshot 的 v0.1.16 叙述批量改成 v0.1.17；
- 不因默认库漂移而自动修复/迁移默认库；
- 不把未执行 Electron smoke 或 restore rehearsal 写成通过；
- 不 commit、push、merge、发布或开始 Step 2B，除非用户另行明确授权且 Accept 已通过。

**改动文件及职责：**

- `AGENTS.md`：当前工程基线升级为 v0.1.17；
- `README.md`：当前 Schema 状态升级；
- `doc/specs/baseline.yaml`：current baseline note 和 M4 验证命令；
- `doc/specs/MVP_PRD_v1.0.9-authoritative.md`：保留历史正文，将 M4 覆盖说明改为按验收结果生效，并补充 v0.1.17 当前基线/验收映射；
- `doc/specs/architecture-plan-b-multi-device-v2.2-authoritative-baseline.md`：§0.4/§7/§8/§13 将 M4 从目标差异更新为已实现事实，同时保留后续 M5 仍未实现的边界；
- `doc/index.md`：人工当前基线行 + 自动清单；
- `doc/features/multi-device-m4-safety-rekey-prd.md`：仅在实现完成后标记 `IMPLEMENTED_PENDING_ACCEPTANCE`；Accept PASS 后才标记验收通过；
- `doc/features/multi-device-m4-safety-rekey-impl.md`：逐步记录实际命令、状态和证据，不把计划命令当成已运行；
- `doc/features/multi-device-m4-safety-rekey-validation.md`（由 `/vibe-accept` 生成）：最终结构、迁移、运行、人工和残余风险证据；
- 必要的当前计划/交接文件：只更新当前基线和下一原子动作，不改写历史里程碑。

**跨文件登记项：**

- [ ] AGENTS、README、baseline、PRD、architecture、schema、content-pack 版本一致；
- [ ] PRD 历史 §11.6/§17 文本不被伪装为当时已三元化，v0.1.17 覆盖说明清晰；
- [ ] architecture 将 M4 与仍未实现的 M5 batch/command/startupRecovery 明确分开；
- [ ] 新/改/移动的 doc 文件运行 index update/check；
- [ ] 验证表只记录真实命令退出码；
- [ ] default DB verify 若因既知 drift 未运行/失败，明确记 `BLOCKED`，以临时库 M4 verify 作为本功能自动证据，不伪称默认库通过；
- [ ] 独立 reviewer 读取真实 diff、测试和迁移代码；
- [ ] Accept PASS 前 Step 2B 保持阻断。

**核心设计与伪代码：**

```text
if any targeted gate != PASS:
  stop; do not promote baseline

update only current-baseline surfaces
preserve historical documents and snapshots
run docs index update/check
run full automated matrix
run independent /vibe-review code
if P0 or P1:
  revise within M4 scope and rerun affected + full gates
run /vibe-accept
only Accept PASS may close Step 2A
```

**数据、事务与失败恢复：**

- 文档传播不写运行库；
- migration/backup/recovery 验证只用显式临时路径；
- 人工 restore rehearsal 从配套备份恢复到新的隔离路径，不覆盖 source；
- 基线传播若验证失败，恢复本步文档/config 改动，代码保持 `IMPLEMENTED_PENDING_ACCEPTANCE`，不降级已写入测试数据语义。

**测试设计：**

- 全量自动回归见 §6；
- 文档：index、baseline/version grep、历史文件不被批量重写；
- 临时 DB：fresh、v0.1.16→M4、preflight fail、Nth DDL fail、ledger/drift、backup/restore、business hash、event-log hash；
- Electron：同 task 跨 job 隔离、同三元整体熔断、权限/FSM、报告摘要；
- 独立 Review：迁移顺序、跨文件登记、测试杀伤力、rollback/forward-only、中间步骤可构建。

**精确验证命令：**

```bash
npm run contract:m4:safety-sql:check
npm run db:m4:verify
npm run typecheck
npm run lint
npm test
npm run build
npm run docs:index:update
npm run docs:index:check
git diff --check
```

另由 `db:m4:verify` 在显式临时目录内执行并输出：

```text
fresh schema load
v0.1.16 → M4 migration
PRAGMA foreign_key_check
PRAGMA integrity_check
sqlite_master SQL body/object-set assertions
EXPLAIN QUERY PLAN
preflight-failure source DB/action-log hash comparison
paired-backup manifest/hash/isolated restore
```

**预期证据：**

- 所有自动命令退出码 0；
- 13 条 M4 验收标准均映射到自动或人工证据；
- independent Review 为 `PASS`，P0/P1=0；
- Accept 明确记录未执行人工项，不使用模糊“整体通过”；
- default DB 未被修改。

**回滚方式：**

- 文档/config 传播可按路径恢复；
- 代码/Schema 回滚遵循 M4-3/M4-5 的语义写入边界；
- 不自动 restore 默认库，不执行 down migration。

**停止条件：**

- 任一 typecheck/lint/test/build/docs/index/diff gate 失败；
- independent Review 尚有 P0/P1；
- M4-01–M4-13 任一必需证据为 `FAIL`、`BLOCKED` 或 `NOT_RUN`；
- 发现产品/架构/Schema/运行查询仍二元/三元混用；
- 需要默认库修复、权限变更、event/IPC 变更或不可逆生产操作。

**建议 commit message：**

`docs(m4): promote safety rekey baseline after validation`

## 6. 全量回归矩阵

| 验收/风险 | 自动验证 | 必要断言 |
|---|---|---|
| M4-01 跨 job 开放会话与隔离 | schema M4、assessment/training create、redline tests | job A incident 不改变 job B session/step/binding |
| M4-02 同三元整体熔断 | schema M4、assessment/training redline | assessment+training 都 halt，各一条 binding，安全结果优先 |
| M4-03 同三元未解决阻断 | schema M4、create handlers | 两类新 session 均拒绝 |
| M4-04 仅其他 job incident | create/scoring handlers | job B 创建与三类评分均放行 |
| M4-05 redline incident 归属 | schema M4 | assessment/training insert/update 跨 job 均拒绝 |
| M4-06 replacement 归属 | schema M4、safety handler/reducer | insert/update/handler 跨 job 拒绝，同三元通过 |
| M4-07 v0.1.16 启动迁移 | migration/startup M4 tests | F7 后显式 M4；业务行/event/status/report hash 不变 |
| M4-08 历史异常 | preflight tests、临时文件 hash | 第一条 M4 DDL 前失败，DB/log hash 不变 |
| M4-09 故障注入 | migration tests | 旧 10+5 完整、M4 ledger=0、integrity ok |
| M4-10 启动互斥分支 | connection M4 tests | fresh/F7/current-no-ledger/current-ledger/drift 顺序准确 |
| M4-11 handler/结果/报告 | scoring、safety、job result、report/recovery tests | 跨岗不串，同岗不回退，权限/FSM 不变 |
| M4-12 静态覆盖 | inventory script/tests | 一一对账、无 pending、无二元 aggregate、exemption 有证据 |
| M4-13 备份/失败边界 | backup/startup/migration tests | F7/M4 可区分；preflight 零 DDL；seed/recovery 未运行 |
| 事件/重放 | reducer/recovery 全量相关 tests | EventType/payload 不变，既有幂等/回放通过 |
| 结果体系 | ability/operation/job result/report tests | 四类 result 不混算，safety override 不回退 |
| 权限/FSM | safety、redline、auth tests | TEACHER/ADMIN 边界和终态冻结不变 |
| 多设备 M1–M3 | schema M3、assignment/reducer tests | grant/assignment/business session 一致性不回退 |
| 工程门禁 | typecheck、lint、full test、build、doc index、diff check | 全部实际执行且退出码 0 |

最终相关测试至少覆盖 PRD 列出的文件，并增补本计划发现的 inventory、backup、connection、report reducer/recovery 测试；不得因为文件名调整而缩减场景。

## 7. 人工验收矩阵

人工验收必须使用显式临时 data root 和测试专用第二岗位/strategy，不向正式 seed 增加伪造岗位，不触碰默认库。

| 场景 | 操作 | 预期 | 状态规则 |
|---|---|---|---|
| Electron fresh smoke | 临时空 data root 启动 | v0.1.17 ready，M4 ledger/object 完整，无 migration backup | 未执行记 `NOT_RUN` |
| F7→M4 smoke | 复制合规 v0.1.16 fixture + action log 到临时 root 后启动 | 依次记录 F7/M4 状态，M4 backup 配对，业务可进入 | 环境缺失记 `BLOCKED` |
| 跨 job 隔离 | 同 student/task 建 job A/job B assessment+training，job A 触发红线 | 只 halt A；B 可继续/评分；B 报告不含 A incident | 必须观察 DB 和 UI |
| 同三元红线 | 同三元 assessment+training 开放后触发 | 两者 halt，各一 binding，普通报告阻断、安全报告可生成 | 权限角色分别验证 |
| duplicate replacement | ADMIN 尝试跨 job duplicate，再用同三元 duplicate | 前者稳定拒绝且零写入；后者按 FSM 成功 | TEACHER 仍被拒绝 |
| 备份隔离恢复 | 将 M4 配套备份恢复到新的临时目录 | DB integrity ok，action-log hash 匹配，原 source 未覆盖 | 不做自动 down |
| 可用性回归 | 学生/教师现有核心流程 | 无新增 UI 字段、错误展示不退化 | 无 UI 变化仍需 smoke |

## 8. 实施与验收证据记录规则

每完成一个 Step：

1. 读取真实 path-scoped diff；
2. 核对 §4.6 副作用登记项；
3. 运行本 Step 精确命令；
4. 使用 `/vibe-accept step M4-N` 记录 `PASS / FAIL / NOT_RUN / BLOCKED`；
5. 只有本 Step 必需项均 `PASS` 才进入下一步；
6. 记录测试名、退出码、关键输出、临时路径类型和未执行人工项；
7. 不因工作区已有无关改动扩大 commit 范围；
8. 不自动 commit、push、merge 或发布。

R3 独立代码审查输入至少包括：

- 本实施计划与批准 PRD；
- 适用不变量 ID；
- `schema.sql`、M4 migration、startup/backup、production handlers 和 inventory 的真实 diff；
- M4-01–M4-13 证据映射；
- 当前工作区未纳入 M4 的既有改动清单；
- 默认运行库未验证/未迁移的明确状态。

## 9. 残余风险与后续项

### 9.1 已知残余风险

1. 默认运行库已有独立 drift；M4 开发可开始，但默认库部署/迁移在单独诊断和授权前保持 `BLOCKED`。不得用临时库 PASS 推断默认库可直接升级。
2. 当前正式产品只有一个岗位，跨岗位场景依赖测试专用 strategy/fixture；不得把测试岗位写入生产 seed。
3. Electron `initDatabase()`、native `better-sqlite3` 和文件系统备份仍需至少一次真实运行环境 smoke；纯 DBAdapter 测试不能替代该证据。
4. inventory 使用无新增解析依赖的源码扫描器，必须通过动态模板和指纹负测证明没有漏报；若无法稳定解析，停止并改为更明确的静态标记方案，而不是放宽门禁。
5. M4 只修复聚合键，不解决 Step 2B 命令边界或 Step 2C batch recovery；现有单事件写入/回放限制仍然存在。
6. 架构文档中 M5 目标合同不能因 M4 完成而被误标为已实现。

### 9.2 规则沉淀候选

- 将 `contract:m4:safety-sql:check` 作为所有后续安全查询改动的常驻门禁；
- 将 10+5 exact SQL body 和旧对象不存在断言保留在 current schema verification；
- 将 F7/M4 stage-specific paired backup 规范抽成后续高风险 migration 复用机制；
- 若后续再次出现聚合键遗漏，评估新增稳定不变量 ID，禁止安全聚合 SQL 缺完整业务键。

### 9.3 开始实施条件

满足以下条件后可从 M4-1 开始编码：

- 本计划独立 `/vibe-review impl` 为 `PASS`，P0/P1=0；
- 用户明确要求进入实施；
- 实施者确认保留当前 dirty worktree，并按路径隔离 M4 改动；
- 自动测试仅使用临时库/临时 data root；
- 默认库 repair、Step 2B、Step 2C 和生产部署继续保持范围外。

M4 独立 `/vibe-accept` 为 `PASS` 前，Step 2A 不关闭，Step 2B 不开始。
