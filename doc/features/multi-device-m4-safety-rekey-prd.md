# 多设备 M4 安全聚合三元键升级 Mini-PRD

## 1. 文档状态

- 状态：ACCEPTED_STEP_2A（独立 R3 `/vibe-review code` 与 `/vibe-accept` 均为 `PASS`；M4-1 至 M4-6 已完成验收）。
- 审查快照：`a9e5e15489e01b577577b3f63ed48c94799c85c1ec1c696d98e9d4923eb979f0`；P0/P1/P2 均为 0。
- 风险等级：R3。原因是本功能同时修改 Schema、增量 migration、安全红线聚合键、并发唯一性、历史兼容和结果/报告归属。
- 在 Q1 中的位置：Step 2A。必须先于 Step 2B Command Bus Boundary 和 Step 2C Event Batch + `startupRecovery` 完成并验收；Step 2A–2C 任一未通过，Q1 Step 3–10 均不得开始。
- 当前工程基线：`schema v0.1.17-multi-device-m4-safety-rekey`（ACCEPTED_STEP_2A）；实施前历史基线：`schema v0.1.16-report-framework`。
- 权威依据：
  - `doc/specs/baseline.yaml`；
  - `doc/specs/MVP_PRD_v1.0.9-authoritative.md` §11.6 及其后续版本覆盖说明；
  - `doc/specs/architecture-plan-b-multi-device-v2.2-authoritative-baseline.md` §12.5、§13；
  - `doc/specs/project-invariants.md`：`INV-EVT-001`、`INV-EVT-003`、`INV-SAFE-001`、`INV-SAFE-002`、`INV-SAFE-003`、`INV-SAFE-004`、`INV-AUTH-001`、`INV-RES-002`、`INV-STR-001`、`INV-DATA-003`；
  - 当前真实 DDL：`src/main/db/schema.sql`；当前 migration 链：`src/main/db/migrations.ts`。

## 2. 问题与目标

### 实施前历史行为

当前 `safety_incident`、`assessment_session` 和 `training_session` 都已有 `job_code`，但正式 Schema 和部分运行查询仍按：

```text
student_id + task_code
```

执行安全事件熔断、新会话阻断、开放会话唯一性、红线事件归属、replacement 归属和报告汇总。当前只有一个正式岗位，因此问题尚不明显；后续岗位合法复用同一 `task_code` 时，一个岗位的安全事件会误伤另一个岗位。

当前两元语义分散在 10 个触发器/守卫、2 个开放会话唯一索引、3 个查询索引以及 assessment、training、评分、结果和报告查询中。只替换权威架构旧清单中的 4 个主触发器，会留下 6 个两元归属守卫，形成混合语义。

### 用户问题

系统必须保证安全红线仍然优先、同一业务聚合仍然整体熔断，同时允许同一学生在不同岗位下合法复用任务码，且不得通过 UI 传入或猜测 `job_code` 来修补归属。

### 目标行为

把所有当前安全归属、开放会话唯一性、阻断、熔断、replacement、结果与报告查询统一升级为：

```text
student_id + job_code + task_code
```

`job_code` 必须来自已验证的 strategy、session 或 incident 事实。M4 不改变安全事件生命周期、角色权限、事件类型、IPC 输入结构、评分含义或报告格式。

### 成功定义

1. 产品合同、v2.2 架构、正式 Schema、migration、运行查询、结果/报告和测试只存在同一套三元安全聚合语义。
2. 10 个触发器/守卫、2 个开放会话唯一索引和 3 个查询索引全部按三元键实现，并由 SQL body 结构断言和真实 SQLite 行为测试共同证明。
3. 同一三元键的 assessment 与 training 继续被同一 incident 同步熔断；不同 `job_code` 的会话不被误熔断、误阻断、误绑定或误汇总。
4. migration 严格排在 F7 `2026-07-24_f7_report_framework` 之后；已完成 F7 的 v0.1.16 库也必须由 `initDatabase()` 启动编排显式进入 M4，而非因 F7 已存在而跳过。历史数据预检或结构 drift 失败时在任何 DDL/seed 前关闭失败，不猜测、不自动修复、不重写历史。
5. 既有单岗位行为、权限边界、安全优先级、事件重放和报告内容不回退；独立 `/vibe-review` 与 `/vibe-accept` 均为 `PASS` 后才进入 Step 2B。

## 3. 用户角色与权限

- 学生、教师、管理员的现有权限保持不变；M4 不新增角色、能力或授权入口。
- 安全事件的触发、补充、确认、解决和作废继续执行当前权威产品合同、handler 与 Schema 角色守卫；若审查发现三者已有不一致，标记 `[!]` 并停止，不借 M4 静默改权限。
- Renderer 和 IPC 调用方不得提供可信 `jobCode`。创建路径从冻结且已校验的 strategy 取得 `job_code`；已有 session、incident、result/report 路径从持久化事实取得并相互核对。
- migration 只能由现有受控数据库初始化/升级路径执行，不新增普通业务用户可调用的迁移 IPC。

## 4. 核心场景

### S1：同三元键安全事件整体熔断

Given 同一 `student_id + job_code + task_code` 下存在开放 assessment 和 training，

When 合法用户创建一个安全事件，

Then SQLite 确定性投影把两类开放会话设为 `REDLINE_HALTED`，各生成一条 binding，并保持安全结果覆盖普通分数；事件生命周期和权限语义不变。

### S2：跨岗位隔离

Given 同一学生在 job A 与 job B 下使用相同 `task_code`，

When job A 创建或存在未解决安全事件，

Then 只熔断并阻断 job A；job B 的开放会话、创建、评分、结果和报告不受影响。

### S3：开放会话唯一性

Given 同一学生和同一任务码，

When 两个岗位分别创建开放会话，

Then 两者可以并存；同一 `student_id + job_code + task_code` 下重复创建仍由唯一索引拒绝。assessment 继续按现有 `strategy_type` 维度保持唯一性，training 继续按现有会话维度保持唯一性。

### S4：红线 incident 与 replacement 归属

Given session 进入 `REDLINE_HALTED`，或安全事件通过 replacement/factual-correction 链关联另一 incident，

When 被引用 incident 的任一三元键字段不同，

Then insert/update 均由 Schema 失败关闭；同三元键引用保持可用。

### S5：旧库迁移

Given 一个已完成 M1–M3、F4、F6、F7 的 v0.1.16 数据库和与之配套的事件日志，

When 启动受控 M4 migration，

Then 先完成只读历史一致性预检和配套备份，再在一个事务中替换全部对象、验证结构与数据并写 migration ledger；任何预检、DDL、结构或完整性检查失败都不留下半迁移状态。

### S6：历史异常失败关闭

Given 历史 binding、`REDLINE_HALTED.redline_incident_id` 或 replacement 链按三元键无法对应，

When M4 预检运行，

Then migration 在 DDL 前拒绝并输出只读诊断；不得自动改 job、重开会话、改绑 incident、删除 binding 或覆盖历史。需要修复时另立 R3 数据修复 PRD。

## 5. 范围

### 本次包含

- 在当前权威 MVP PRD 中增加明确的后续版本覆盖说明，不改写 v1.0.9 当时的两元历史正文。
- 修订 v2.2 架构 §7、§8、§13 的对象覆盖矩阵，使其包含完整 10 个触发器/守卫、2 个唯一索引和 3 个查询索引。
- 更新 `schema.sql` 到 `v0.1.17-multi-device-m4-safety-rekey`，替换全部两元对象和错误语义注释/报错文案。
- 在 `migrations.ts` 中新增排在 F7 后的独立 migration：建议 ID `2026-07-27_mvp_schema_v0_1_17_multi_device_m4_safety_rekey`。
- 修改 `src/main/db/connection.ts` 的启动编排：保留现有 F7 pre-reconcile/backup bridge，并在 F7 已完成后显式判定和运行 M4；不得依赖 `runDatabaseMigrations()` 当前默认只到 F6 的行为。
- 新增 M4 历史预检、结构检测、SQL body drift 检测、事务回滚、ledger 补记和真实 SQLite 验证。
- 修改 assessment、training、BASE_ABILITY ability scoring、operation scoring、job-skill scoring、safety duplicate replacement、job-skill result/report 及其他实际扫描到的安全查询，使 `job_code` 显式参与匹配。
- 修改训练步骤红线级联、reducer 注释/断言、测试 fixture 和只读统计/报告关联，使其与三元语义一致。
- 生成版本化 production safety-SQL inventory，并新增静态扫描/结构门禁与 inventory 对账，阻止生产 SQL 再引入未经登记的二元安全匹配。

### 明确不包含

- Step 2B Command Bus、command envelope、统一 mutation registry 或 IPC transport 重构。
- Step 2C `BATCH_PREPARED/EVENT/BATCH_COMMITTED`、hash chain、segment/index、command fencing 或 `startupRecovery`。
- M5C utilityProcess、Local Server、REST/SSE、Teacher Web 或网络安全。
- 新事件类型、事件 payload 改义、新 IPC 参数、新 UI 页面或新角色权限。
- 自动修复历史跨岗位错绑、自动重开已熔断会话、删除/改写历史事件或默认运行库人工运维。
- 题库激活、42+8 评分/报告新语义、Pilot 授权或真实课堂数据操作。

## 6. 行为与数据变化

### 影响矩阵

| 影响域 | YES/NO | 证据与说明 |
|---|---|---|
| UI / UX | NO | 不新增页面、字段或交互；错误仍由现有映射展示。 |
| Domain model | YES | 安全聚合身份由二元升级为三元。 |
| Database / migration | YES | Schema 版本、10 个 trigger/guard、5 个唯一/查询索引和增量 migration。 |
| Event / projection | YES | 不新增事件；安全事件确定性投影和 reducer/replay 断言改用三元键。 |
| IPC / API | NO | 输入输出合同不变；handler 内部从可信事实取得 `job_code`。 |
| Authentication / authorization | NO | 角色与能力不变，仍需回归既有权限守卫。 |
| Safety / FSM / concurrency | YES | 红线聚合、新会话阻断和开放会话并发唯一性改变。 |
| Result / report | YES | 安全摘要、关联和统计必须增加 `job_code`。 |
| Accessibility | NO | 无 UI 变化。 |
| Privacy / audit | YES | 保留 incident/binding/event 历史；迁移诊断不得泄露非必要个人信息。 |
| Backward compatibility | YES | v0.1.16 数据前滚、单岗位行为、历史事件和报告必须兼容。 |
| Deployment / rollback | YES | 需要配套备份、结构断言、失败事务回滚和写后前滚策略。 |

### Schema 对象清单

必须用稳定、表达正确语义的新名称替换旧对象；实现计划可在不改变数量和语义的前提下细化命名。

1. 4 个主安全触发器：
   - `trg_safety_incident_bind_open_assessments`；
   - `trg_safety_incident_bind_open_trainings`；
   - `trg_assessment_session_block_unresolved_safety_incident`；
   - `trg_training_session_block_unresolved_safety_incident`。
2. 4 个 `REDLINE_HALTED` incident 归属守卫：assessment/training 的 insert/update；旧名中的 `same_student_task` 改为 `same_student_job_task`。
3. 2 个 replacement incident 归属守卫：insert/update；旧名中的 `same_student_task` 改为 `same_student_job_task`。
4. 2 个开放会话唯一索引：
   - `ux_assessment_one_open_session_per_student_job_task_strategy`；
   - `ux_training_one_open_session_per_student_job_task`。
5. 3 个查询索引：assessment、training、safety incident 均使用 `student_id + job_code + task_code`，并保留各自当前所需的 status/review 后缀。

结构验收既核对对象集合，也规范化并核对 `sqlite_master.sql` 中三元谓词、开放状态集合和旧对象不存在；不得只看 migration ledger 或对象名。

### 运行查询

- `assessment.ts`：开放 session、未解决 incident、红线触发后的 training 级联都带 `job_code`。
- `training.ts`：开放 session、未解决 incident、halted step 级联都带 `job_code`。
- `ability-scoring.ts`、`operation-scoring.ts`、`job-skill-scoring.ts`：从目标 session 取得 `job_code`，仅查询同三元键未解决 incident。
- `safety.ts`：`DUPLICATE_RECORD` replacement 的 handler 前置校验比较完整三元键，跨 job 在进入事务/Schema 前返回现有稳定校验错误；同三元键保持通过。
- `job-skill-result.ts` 及实际扫描到的报告/异常/统计查询：安全 incident JOIN/EXISTS 同时匹配 student、job、task。
- 任何创建路径都先验证 strategy 与 session 的 `job_code` 一致，不接受 UI 补值或默认值。

### Production safety-SQL inventory

实现必须生成版本化、可机器校验的 `doc/features/multi-device-m4-safety-sql-inventory-v1.json`。每一项至少记录：生产文件、函数/符号、SQL 定位指纹、分类、当前谓词、M4 目标谓词、允许理由和测试证据。分类只允许：

- `AGGREGATE_MATCH_REKEY`：按业务聚合匹配 incident/session，M4 后必须使用完整三元键；
- `INCIDENT_PRIMARY_KEY_LOOKUP`：只按唯一 `incident_id` 读取，允许不重复附加三元条件；
- `STUDENT_WIDE_LIST`：产品明确按学生跨岗位展示的只读列表，不得用于阻断、熔断、归属或结果关联；
- `NON_SAFETY_QUERY`：扫描命中但不参与安全匹配，并记录排除理由。

静态门禁必须扫描全部生产 `FROM/JOIN/INSERT/UPDATE safety_incident`、assessment/training 开放会话谓词、replacement/redline 归属检查和训练步骤级联，与 inventory 一一对账；未登记命中、重复分类、定位指纹漂移，或 `AGGREGATE_MATCH_REKEY` 仍缺 `job_code` 均失败关闭。测试 fixture 与 migration SQL 另行分类，不得混入生产清单伪造覆盖率。

### 事件、IPC 与权限

- 事件类型、envelope、payload 和 `writeEvent()` 时序不在 M4 改变；M4 只让现有安全事件投影读取三元事实。
- IPC/preload/shared type 不新增 `jobCode` 输入。若实现发现必须改公开合同，立即停止并重审范围。
- 权限检查和错误码保持现有语义；可增加仅供稳定识别 migration/结构漂移的内部错误，不得暴露敏感历史行内容。

## 7. 边界条件与异常处理

- 无开放会话：安全 incident 仍可创建，binding 为 0。
- 重复操作：现有事件和 incident 幂等/唯一性语义不因 M4 改变；不得借本功能补做 Step 2B/2C。
- 并发创建：同三元键重复开放会话必须由 SQLite 唯一索引裁决；跨 job 可并存。
- 终态操作：`REDLINE_HALTED`、`RESOLVED`、`VOIDED` 和 CONFIRMED 后冻结规则保持不变。
- migration 中途失败：同一 SQLite transaction 回滚所有对象和 ledger；配套备份保留，不自动覆盖原库。
- 启动编排失败：F7 bridge、M4 preflight、备份或 M4 transaction 任一失败时，不执行 `database.exec(schema)`、`assertCurrentDatabaseSchema()` 后续 seed 或业务 recovery；关闭数据库并返回稳定启动错误。
- ledger/结构不一致：结构完整而仅缺本 migration ledger 时，经 SQL body 和行为结构断言后可补记；ledger 存在但结构缺失或漂移时失败关闭。
- 历史不一致：任何三元归属无法证明时在 DDL 前停止；诊断只记录稳定 row ID、问题类型和计数，不自动修复。
- 默认库保护：测试和故障注入只能使用显式临时 DB/data root；没有单独运维授权不得迁移或修复默认运行库。

## 8. 迁移与兼容性

1. 当前 migration 链按实际代码执行 M1 → M2 → M3 → Phase4 asset role → F4 → F6 → F7 → M4；不得沿用旧任务书把 M4 命名为 v0.1.16 或从 v0.1.15 直接覆盖 F7。
2. `connection.ts` 必须保留 F7 的特殊启动 bridge：非 fresh 且 F7 结构未完成时，先只运行到 F6，再执行 legacy action-log pre-reconcile、创建 F7 配套备份并显式运行至 F7。只有 F7 结构与 ledger 可证明完成后，才进入独立 M4 判定。
3. F7 后的 M4 启动编排必须显式覆盖且测试以下互斥分支：
   - fresh DB：直接加载已含 M4 对象和 ledger seed 的当前全量 `schema.sql`，不运行增量 migration；
   - F7 完成、M4 旧二元结构且无 M4 ledger：执行 M4 只读预检 → 创建并核验新的 M4 配套 DB + event-log 备份 → 以 `throughMigrationId: M4_MIGRATION_ID` 显式运行 M4 transaction；
   - M4 结构完整但 ledger 缺失：先完成 SQL body、行为结构和完整性断言，只补 M4 ledger，不重复 DDL，也不把 F7 备份冒充 M4 备份；
   - M4 ledger 与结构均完整：幂等跳过；
   - M4 ledger 已存在但任一对象缺失或 SQL body 漂移：在任何 DDL、ledger 更新或业务 seed 前失败关闭，不自动重建；
   - F7 结构/ledger 不完整或 bridge 失败：保持现有 F7 稳定错误，不得越级尝试 M4。
4. 不得依赖 `runDatabaseMigrations()` 无参数调用；该函数当前为保护 F7 bridge 默认只运行到 F6。M4 必须由启动编排显式传入目标 migration ID，`assertCurrentDatabaseSchema()` 只在 F7/M4 编排完成后执行。
5. M4 DDL 前预检至少验证：
   - `safety_incident.job_code`、session `job_code` 均非空且可追溯；
   - 每个现有 `REDLINE_HALTED.redline_incident_id` 与 session 同三元键；
   - 每个现有 binding 的 incident 与 aggregate 同三元键；
   - 每个 replacement 链同三元键；
   - 当前对象结构属于可识别的 v0.1.16 基线且无 SQL body 漂移。
6. 在任何 M4 DDL 前创建并核验配套 DB 与事件日志备份；自动化使用临时副本，不触碰默认库。F7 和 M4 各自的备份阶段、用途和日志必须可区分。
7. 一个 transaction 内 DROP 旧对象、CREATE 新对象、执行结构/历史数据断言、`foreign_key_check`、`integrity_check` 并写 ledger。
8. migration 不改业务行、事件 bytes、binding、session 状态、结果或报告。单岗位历史行为应逐字节/逐字段保持，除 Schema 对象和 ledger 外无业务数据 diff。
9. 第一笔依赖 M4 三元语义的非测试写入前，可用配套备份回到旧版本；写入后不得自动 down 到两元语义，只能前滚到兼容版本。原因是旧唯一索引和触发器可能错误拒绝或熔断合法跨岗位会话。

## 9. 非功能要求

- 性能：三元查询必须命中相应索引；验收记录关键安全查询的 `EXPLAIN QUERY PLAN`，不得以全表扫描替代正确索引。
- 可访问性：无 UI 变化，现有错误展示不得退化。
- 隐私与审计：历史事件、incident、binding、结果和报告不可改写；诊断与日志只输出必要 ID/计数，不输出题目内容、密码或完整个人资料。
- 可观测性：启动日志明确记录当前 schema version、M4 migration 状态和稳定失败码；不得把结构漂移误报为已迁移。
- 可维护性：生产 SQL 中的安全聚合必须经共享 query/helper 或静态门禁覆盖，防止后续复制回两元条件。

## 10. 验收标准

| ID | 场景 | 可验证结果 |
|---|---|---|
| M4-01 | 同 student/task、不同 job 各有开放 assessment/training | 可合法并存；job A incident 只熔断 job A。 |
| M4-02 | 同三元键 assessment + training | 两者均 `REDLINE_HALTED`，各一条 binding，安全结果优先。 |
| M4-03 | 同三元键有未解决 incident | 新 assessment/training 均被拒绝。 |
| M4-04 | 仅不同 job 有未解决 incident | 目标 job 新会话不被阻断。 |
| M4-05 | session 绑定不同 job incident | insert/update Schema 守卫均拒绝。 |
| M4-06 | replacement 指向不同 job incident | insert/update Schema 守卫均拒绝；同三元键通过。 |
| M4-07 | 真实启动编排迁移 v0.1.16 干净旧库 | `initDatabase()` 等价路径在 F7 后显式进入 M4；M1–F7 业务行、事件、状态、binding、结果和报告不变，M4 对象/ledger 完整。 |
| M4-08 | 历史存在三元错绑 | 在第一条 DDL 前稳定失败，库与日志 hash 不变，无自动修复。 |
| M4-09 | 第 N 个对象/完整性检查故障注入 | 事务回滚，旧 10 个 trigger/guard 与 5 个索引全部完整。 |
| M4-10 | fresh/F7 bridge/M4 ledger/结构启动分支 | fresh 直接加载；F7 未完成先 bridge；M4 结构完整仅补 ledger；ledger+结构完整幂等跳过；ledger 已有但结构漂移在 DDL/seed 前失败。 |
| M4-11 | handler、结果与报告回归 | 跨 job 不误阻断/误汇总；job A incident 不阻断 job B BASE_ABILITY 评分；duplicate replacement 跨 job 在 handler 前置拒绝；同 job 与既有单岗位输出不回退。 |
| M4-12 | 静态覆盖门禁 | 版本化 production safety-SQL inventory 与扫描结果一一对账；允许按 incident PK 与明确的学生跨岗只读列表，不存在未登记或未经豁免的二元安全匹配。 |
| M4-13 | F7/M4 备份和故障边界 | F7 备份与 M4 配套备份可区分；M4 preflight/drift 失败时零 DDL，M4 transaction 失败时旧对象完整，业务 seed 未运行。 |

实现阶段至少执行并保留以下证据；精确测试文件可由 `/vibe-impl` 按真实代码调整，但不得缩减场景：

```bash
npm test -- src/main/db/__tests__/schema-m4-safety-rekey.test.ts src/main/db/__tests__/migrations.test.ts src/main/db/__tests__/connection-m4-safety-rekey.test.ts src/main/ipc/handlers/__tests__/assessment-create.test.ts src/main/ipc/handlers/__tests__/training-create.test.ts src/main/ipc/handlers/__tests__/assessment-redline.test.ts src/main/ipc/handlers/__tests__/training-redline.test.ts src/main/ipc/handlers/__tests__/assessment-ability-scoring.test.ts src/main/ipc/handlers/__tests__/operation-scoring.test.ts src/main/ipc/handlers/__tests__/job-skill-scoring.test.ts src/main/ipc/handlers/__tests__/job-skill-result.test.ts src/main/ipc/handlers/__tests__/safety.test.ts
npm run typecheck
npm run lint
npm test
npm run build
npm run docs:index:check
git diff --check
```

另需在显式临时 SQLite 库执行 migration 前后结构、行为、`foreign_key_check`、`integrity_check`、查询计划和文件 hash 验证；Electron 人工冒烟覆盖同 task 跨 job 隔离及同三元键红线流程。未执行的项目记 `NOT_RUN`，环境缺失记 `BLOCKED`。

## 11. 适用不变量

- `INV-EVT-001`、`INV-EVT-003`：既有安全事件仍是状态推进事实，不新增或漏登记事件类型。
- `INV-SAFE-001`、`INV-SAFE-002`、`INV-SAFE-003`、`INV-SAFE-004`：先熔断后归因、禁止直接插入红线终态、未解决 incident 阻断同聚合新会话、安全生命周期不变。
- `INV-AUTH-001`：TEACHER/ADMIN 责任边界不因 re-key 改变。
- `INV-RES-002`：安全结果继续覆盖普通分数。
- `INV-STR-001`：创建路径从同一冻结 strategy/session 取得可信 `job_code`。
- `INV-DATA-003`：migration 可重放、可识别、历史兼容并失败关闭。

## 12. 风险、回滚与停止条件

### 主要风险

- 漏改 6 个归属守卫或某个只读 JOIN，造成写入与读取使用不同聚合键。
- 只在 `migrations.ts` 登记 M4、却未修改 `connection.ts` 的 F7 特殊启动 bridge，导致已完成 F7 的真实库永远跳过 M4。
- 旧任务书占用已被 F7 使用的 v0.1.16 版本，导致 migration 顺序或结构判定错误。
- 自动“修复”历史跨岗位错绑，破坏不可追溯性。
- M4 与 Command Bus 或 batch runtime 合并实施，使 Schema、恢复和写边界同时变化，扩大故障面并迫使 handler 二次迁移。

### 回滚

- DDL/验证失败依靠同一 transaction 回滚，保留配套备份与诊断。
- 无 M4 语义写入时可恢复配套备份；出现 M4 语义写入后只允许前滚，不提供会恢复两元语义的普通 down migration。
- 回滚不得删除事件、重写 incident/binding、自动重开会话或覆盖默认库。

### 停止条件

- 产品、架构、Schema 或运行查询仍存在二元/三元混用。
- 无法证明历史三元归属、F7→M4 启动编排、备份配对、migration 顺序、production safety-SQL inventory 完整性或结构 SQL body。
- 需要改变角色权限、安全生命周期、事件类型、IPC 输入或报告业务含义。
- 需要自动修复历史数据或对默认运行库做未经授权的写操作。
- 独立审查仍有 P0/P1，或验收结论为 `FAIL`、`BLOCKED`、`NOT_RUN`。

## 13. 已确认决策、假设与未解决问题

### 已确认决策

- 为尽量减少后续返工，Q1 Step 2 固定拆分为：Step 2A M4 Safety Re-key → Step 2B M5A Command Bus Boundary → Step 2C M5B Event Batch + `startupRecovery`。
- M4、M5A、M5B 各自独立 R3 PRD、实现计划、审查、验收和 commit；不得合并成一次 Schema + 命令边界 + 恢复协议的大改造。
- `task_code` 可跨岗位合法复用，不新增全局唯一约束。
- M4 目标版本为 `0.1.17-multi-device-m4-safety-rekey`，排在当前 F7 v0.1.16 之后。
- 历史事实只读保留；三元错绑失败关闭，不自动修复。

### 假设

- 当前正式表中的 `job_code` 均为持久化必填事实，可由 strategy/session/incident 交叉验证。
- M4 不需要新增表、列或事件；若影响面扫描推翻该假设，必须重新审查 PRD。

### 未解决问题

- 无产品范围待选项。实现前仍需独立 Reviewer 验证当前权限合同、全部 mutation/query inventory 和 migration 预检集合；发现遗漏按 P0/P1 修订，不由编码阶段临时决定。
