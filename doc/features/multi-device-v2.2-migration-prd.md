# 多设备架构 v2.2 迁移：Mini-PRD（分里程碑实施）

> **状态：** M1 已实施并验收通过（2026-07-14）；M2 Business Session Foundation 已实施，自动验收进行中；M3-M7 仍为 DRAFT/登记
> **上游权威：** `doc/specs/architecture-plan-b-multi-device-v2.2-authoritative-baseline.md`（AUTHORITATIVE BASELINE）
> **正式 Schema 基线：** `src/main/db/schema.sql` v0.1.14-multi-device-m2-session-foundation
> **本轮文档范围：** M2 Business Session Foundation PRD 与实施记录；M3-M7 不在本轮交付。

---

## 0. 背景与不可一次性落地的理由

v2.2 权威基线定义了 19 张新表、13 个增量列、22 条 CREATE TRIGGER（18 新增 + 4 安全键替换）、25 个索引，并已在临时 SQLite 3.50.6 全量 forward→rollback 验证通过。但**不得一次性落进 schema 和运行代码**，因为：

1. 多数新表（command_log、learning_session、offline_score_draft、applied_event_batch…）只有在对应运行时能力（三段式事件协议、学习子系统、服务端草稿）落地后才有写入方；空表无消费者 = 死代码。
2. 安全聚合键 re-key（替换 4 个 v0.1.12 触发器）是最高风险改动，必须单独隔离一个里程碑，配独立回归。
3. delivery_phase 状态机、父子一致性触发器改变现有业务表 INSERT/UPDATE 行为，需与 handler/reducer 协同，不能先于运行代码落库。

因此按依赖与风险切分为 M1-M7。M1 的实施记录保留在 §1、§3-§8，当前从 §10 开始起草 M2 PRD。

## 1. M1 实现目标（已完成）

在 `schema.sql` 中落地多设备**身份与拓扑骨架**（organization / node / device / device_runtime_session / auth_session 五张纯新增表 + student_profile 可选关联 user_id），不触碰任何现有业务表的语义、触发器和状态机。

## 2. 里程碑分解

| 里程碑 | 范围 | 依赖 | 风险 | 状态 |
|--------|------|------|------|------|
| **M1 Schema Foundation** | organization, node, device, device_runtime_session, auth_session（T1-T5）+ student_profile.user_id（B1）+ 相关索引 | 无（纯新增 + 1 nullable 列） | 低 | **已完成** |
| **M2 Business Session 骨架** | business_session（T6）+ assessment/training.business_session_id（B3/B4）+ assessment.delivery_phase/event_sequence_version/observation_template_id（B2）+ D2-D6、D8 + 回填 + handler/reducer 兼容 | M1 | 中（改现有表 INSERT/UPDATE 行为） | **已实施，待最终验收** |
| M3 Grant/Assignment | delegated_access_grant（T7）、business_session_assignment（T8）+ 完整前向状态机 D1 + D9-D11 + rebind 事务 | M2 | 中 | 登记 |
| M4 Safety Re-key | 替换 4 个安全触发器 + 2 个开放会话唯一索引 + job_code 查询索引（§13） | M2 | **高**（改熔断语义） | 登记 |
| M5 Event-Sourcing Infra | command_log, applied_event_batch, processed_event, projector_cursor（T11-T14）+ 三段式协议代码 | M1 | 高 | 登记 |
| M6 Learning | learning_session, learning_progress（T9/T10）+ D7 + 学习 handler/view | M2 | 中 | 登记 |
| M7 支撑表 | offline_score_draft, session_invalidation_record, correction_record, backup_manifest, pairing_challenge（T15-T19）+ result_record/task_report 发布列（B5-B7） | M2/M3 | 中 | 登记 |

## 3. M1 前置条件（已完成）

- 依赖模块：无。M1 五张表只 FK 到已存在的 `user_account`；`student_profile.user_id` FK 到 `user_account`。
- 必须已存在：`user_account`、`student_profile`（v0.1.12 均在）。
- 不依赖任何未落地的 v2.2 表/事件/触发器。

## 4. 物理落地方式（关键工程决策）

**当前决策：新库加载全量基线；既有 v0.1.12 库通过结构驱动 runner 增量迁移。**

M1 初次落地时采用“仅全量重建”是开发期临时决策。2026-07-14 为解决多台开发机结构漂移，已补充 `src/main/db/migrations.ts`，因此现行规则为：

- 新库在单一事务内执行完整 `schema.sql`；所有 DDL、触发器和 seed 成功后才写当前迁移记录。
- v0.1.12 库先按关键表/列确认基线，再备份 DB + `action_log.jsonl`，执行 `student_profile.user_id` ALTER 和 M1 五表/索引 DDL。
- 是否迁移以真实表、列、索引为准，不信任可能提前写入的 `schema_migration` 行。
- 早于 v0.1.12 或结构残缺的开发库拒绝自动猜测，使用 `npm run db:sync -- --reset` 显式重建。
- `scripts/config/database-content-pack.json` 管理三台开发机共同的 schema/题库/资产内容包版本；操作见 `local-database-sync-sop.md`。

## 5. 实现步骤（M1，单 commit）

### Step M1：身份与拓扑骨架进 schema.sql

**改动文件：**
- `src/main/db/schema.sql`：
  1. 头注释版本 `v0.1.12-...` → `v0.1.13-multi-device-m1-identity`，追加 patch note。
  2. `schema_migration` seed 追加：`('2026-07-14_mvp_schema_v0_1_13_multi_device_m1_identity', '0.1.13-multi-device-m1-identity', 'M1: identity+topology tables (organization/node/device/device_runtime_session/auth_session) + student_profile.user_id')`。
  3. `student_profile` CREATE TABLE 内联新增 `user_id TEXT REFERENCES user_account(user_id) ON DELETE SET NULL`。
  4. 新章节"1b. 多设备身份与拓扑（M1）"：organization、node、device、device_runtime_session（+ ux_device_one_active_runtime）、auth_session（+ 2 索引）五张表 CREATE TABLE IF NOT EXISTS。
  5. 索引 `ux_student_profile_user_id ON student_profile(user_id) WHERE user_id IS NOT NULL`。

**核心逻辑（DDL 取自 v2.2 §7.2 T1-T5 / §7.3 B1 / §7.4，已 forward 验证）：**
- organization：无固定 org_default 种子（安装时由应用生成 UUID；M1 不写死种子，seed 留待安装脚本/后续里程碑）。
- device_runtime_session：`ux_device_one_active_runtime` 部分唯一索引（status='ACTIVE'）。
- auth_session：token_hash UNIQUE、refresh_token_hash UNIQUE。

**测试用例：**
- 集成（schema 加载）：`sqlite3 :memory: .read schema.sql` 零错误；`PRAGMA foreign_key_check` 空；`PRAGMA integrity_check`=ok。
- 计数断言：table 20→25（+5）；index 增加（含 ux_device_one_active_runtime、ux_student_profile_user_id、idx_auth_session_*）；trigger 数**不变（48）**（M1 不加触发器）。
- 结构断言：`pragma_table_info('student_profile')` 含 `user_id`；五张新表存在。
- 部分唯一索引：同一 device 两条 status='ACTIVE' runtime → 第二条 UNIQUE 失败；一条 ACTIVE + 一条 ENDED → 允许。
- FK：auth_session.user_id 引用不存在 user → FK 失败（PRAGMA foreign_keys=ON 下）。
- 回归：现有 `src/main/db/__tests__/schema-scoring-closure.test.ts` 仍通过（schema 可加载、既有约束不变）。
- 手工验收点：`npm run db:sync -- --reset` 后启动，`initDatabase()` 无错误、共享 seed 用户正常登录。

**commit message 建议：**
`feat(schema): v0.1.13 M1 多设备身份骨架（organization/node/device/runtime/auth + student_profile.user_id）`

## 6. M1 明确不做（历史边界）

- 不加任何触发器（父子一致性、delivery_phase、grant 一致性、安全 re-key 全部推迟）。
- 不改 assessment_session / training_session / safety_incident / result_record / task_report。
- 不新增 business_session / grant / assignment / learning / command_log 等表。
- 不改任何 TS 类型、IPC handler、Vue 视图（M1 纯 schema，无运行代码消费这些表；它们是后续里程碑的 FK 锚点）。
- 不 seed organization/node/device 数据（安装配对流程职责，后续里程碑）。

## 7. 回归验收清单（M1）：全部通过（2026-07-14）

- [x] `schema.sql` 在临时 SQLite 全量加载零错误
- [x] `PRAGMA foreign_key_check` 空 + `PRAGMA integrity_check` = ok
- [x] table 20→25；trigger 保持 48；新增索引就位（ux_device_one_active_runtime、ux_student_profile_user_id、idx_auth_session_user_status、idx_auth_session_token）
- [x] student_profile.user_id 列存在且 FK/部分唯一索引生效
- [x] device 单 ACTIVE runtime 唯一性生效（ACTIVE+ENDED 并存 OK；第二个 ACTIVE 被拒）
- [x] typecheck 通过（vue-tsc + tsc 均无错）
- [x] build 通过（electron-vite build 成功）
- [x] vitest 全套通过：593/593（含 schema-scoring-closure 4/4）
- [ ] 手工冒烟：`npm run db:sync -- --reset` → 启动 → initDatabase 正常（**需在真实 Electron 环境执行，留待用户手工验收**）

## 8. 审查 WARN 处置（Reviewer 5 条，无 BLOCK）

| WARN | 处置 |
|------|------|
| §4 重建 dev 库前确认无需保留数据 | `--reset` 显式触发且先备份 DB + JSONL；普通启动不再要求删库 |
| §3 补 capabilities_json 非法 JSON 应 THROW | 已在临时库实测：bad JSON → `CHECK constraint failed`；valid JSON 正常插入 |
| §3 补 ON DELETE SET NULL（删 user_account → student_profile.user_id 置 NULL） | 已实测：删除后 user_id = NULL（未级联删档、未阻断） |
| §3 FK 失败用例为套件首个依赖 FK 强制者 | 已实测：auth_session FK 到不存在 user → `FOREIGN KEY constraint failed`；sql.js 环境 FK 已开启 |
| §2 不为 M1 引入 PRAGMA-检测-ALTER runner | **已被后续多开发机同步需求取代**：现由结构驱动 runner 承担 v0.1.12 → v0.1.13 安全迁移 |

## 9. 下一步

M1（Schema Foundation）完成。M2（Business Session 骨架 + delivery_phase 状态机 + 父子一致性触发器）进入独立 PRD 轮次；PRD 通过后再运行 `/vibe-impl`。M2 首次改变现有业务表 INSERT/UPDATE 行为，schema、migration、handler 与 reducer 必须作为同一版本协同设计和验收。

## 10. M2 Business Session Foundation（PRD DRAFT）

### 10.1 Schema 升级机制：扩展现有结构驱动 runner

#### 决策目标

M2 必须把已有 v0.1.13 数据库原地升级到 `v0.1.14-multi-device-m2-session-foundation`，保留 assessment、training、答题、评分和事件记录。升级过程必须可重复执行、单步失败可回滚，并在结构或历史数据无法安全判定时拒绝启动。

[!] 交接摘要仍按“`connection.ts` 只有全量 `schema.sql`、没有 migration runner”描述前置阻断，但当前 `main` 的 `5532e7e` 已落地 `src/main/db/migrations.ts`，`connection.ts` 也已接入迁移前备份、顺序迁移和结构断言。本节以仓库代码事实为准：M2 不再新建第二套机制，而是扩展现有 runner。

#### 方案比较

| 方案 | 数据保留 | 漂移识别 | 工程影响 | 结论 |
|------|----------|----------|----------|------|
| 删除数据库后加载全量 `schema.sql` | 否 | 不适用 | 最小，但会丢失真实业务记录 | 拒绝；M2 已进入改既有业务表阶段 |
| 继续只执行 `CREATE ... IF NOT EXISTS` 全量基线 | 不完整 | 弱 | 无新增机制，但不能给既有表加列、回填或替换约束 | 拒绝 |
| 仅用 `PRAGMA user_version` 驱动版本号迁移 | 是 | 弱 | 需要并行维护整数版本和现有 `schema_migration` | 拒绝；单一整数无法识别“记录已写、结构未落”的漂移 |
| 按版本动态扫描 SQL/TS migration 文件 | 是 | 取决于实现 | 需要新加载器和文件发现协议 | 本阶段不采用；也不得用动态路径加载本地 TS 模块 |
| 扩展现有 `migrations.ts`：显式顺序 + 结构判定 + ledger | 是 | 强 | 复用已上线入口、备份和测试适配器 | **采用** |

选定方案保持两条初始化路径：新库直接在事务内加载当前完整 `schema.sql`；既有库先运行按顺序注册的增量迁移，再加载幂等全量基线，最后执行当前版本结构断言。`schema_migration` 记录审计事实，真实表、列、外键、索引、触发器和回填不变量决定迁移是否完成，不能只凭 ledger 跳过升级。

#### Runner 合同

M2 在现有静态 `migrations` 列表中排在 M1 后，目标标识固定为：

- schema version：`0.1.14-multi-device-m2-session-foundation`
- migration id：`2026-07-15_mvp_schema_v0_1_14_multi_device_m2_session_foundation`
- 前置结构：M1 的表、列、索引必须完整；v0.1.12 可由同一 runner 先迁 M1，再迁 M2
- 新库：完整 `schema.sql` 同时写入 M1、M2 migration 记录，随后通过 M2 结构断言

runner 按以下顺序执行：

1. 检查 v0.1.12 最低基线与 M1 结构；无法确认来源或关键结构残缺时 fail closed，不猜测历史版本。
2. 计算全部 pending migration。存在 pending 时只调用一次 `beforeMigrate`，在任何 DDL 前备份 SQLite 数据库和同目录 `action_log.jsonl`。
3. 每个 migration 使用独立事务，按注册顺序执行。M1 成功、M2 失败时，数据库停留在完整可识别的 M1；本版本应用拒绝继续启动，下次启动可重试 M2。
4. M2 事务内严格执行“新增父表 → 增加 nullable 列 → 回填父子关系与阶段 → 校验回填 → 建索引与 M2 触发器 → 写 migration 记录”。M2 触发器固定为 D2-D6、D8；D1 随 M3 写入方落地，D7 随 M6 的 `learning_session` 落地。DDL 以权威基线 §7-§9 为准，回填按下述兼容规则细化。
5. M2 事务成功后加载当前完整 `schema.sql`，再执行 `assertCurrentDatabaseSchema()`；断言失败时关闭数据库并中止初始化，不进入 seed、IPC handler 或 renderer。

`isM2StructurallyApplied()` 至少覆盖以下事实，不能退化为只查 migration id：

- `business_session` 表及其必要外键、索引存在。
- `assessment_session` 存在 `delivery_phase`、`event_sequence_version`、`observation_template_id`、`business_session_id`；`training_session` 存在 `business_session_id`。
- assessment/training 的 `business_session_id` 唯一索引、FK 目标和 D2-D6、D8 触发器完整；D1、D7 在 M2 不应存在。
- 每个 assessment/training 子会话都能映射到类型、student_id、job_code、task_code 一致的父会话。
- 正常完成的 assessment 为 `COMPLETED + FINALIZED`；`REDLINE_HALTED`、`ABORTED` 不得被误写成 `FINALIZED`。

[!] 权威基线 §8.3 将所有 assessment 开放态统一回填为 `PREPARED`，这会把已有答题记录或当前题指针的进行中会话降级。M2 采用更窄的确定性回填，不覆盖既有业务事实：

- 父 ID 继续按权威规则使用子会话 ID，父表四个关键字段来自子表。
- `COMPLETED → FINALIZED`，`OFFLINE_PENDING → OFFLINE_SCORING`，`INIT → PREPARED`。
- `ACTIVE/EMOTION_INTERRUPTED/SUSPENDED_REVIEW_REQUIRED` 若已有 `current_question_id` 或 VALID answer，则回填 `ONLINE_IN_PROGRESS`；否则回填 `PREPARED`。
- `REDLINE_HALTED/ABORTED` 优先按事件事实恢复中断前阶段，无法确定时保持 NULL，绝不写 `FINALIZED`。
- `event_sequence_version` 回填为该 assessment aggregate 在 `domain_event_projection` 中的 `MAX(event_sequence)`，无事件时为 0。
- assessment 存在 `question_phase='OBSERVATION'` 的题目时，`observation_template_id` 回填为 `${strategy_id}@${strategy_version}`；否则保持 NULL。

结构已经完整但 ledger 缺失时，runner 只补 migration 记录。结构不完整且能按确定规则修复时，runner 幂等补齐并重新校验；发现父子键冲突、无法解释的阶段值或同名对象语义不符时，迁移失败并保留备份，不覆盖冲突数据。

#### 事务、备份与回滚

M2 不提供自动 `down` migration。自动逆向删除列、父表或触发器会在有新版本写入后破坏数据语义，风险高于显式恢复。回滚合同如下：

- DDL、回填、校验和 migration 记录属于同一 M2 事务，任一步抛错都回到迁移前的完整 M1 状态。
- 迁移前备份必须先完成；备份失败时不得开始迁移。
- M2 已提交但后续启动失败时，不自动执行逆向 DDL。修复后重试当前版本；若必须降级，关闭应用后恢复配套的 DB 与 `action_log.jsonl` 备份，再运行旧版本。
- `PRAGMA foreign_key_check` 必须为空，`PRAGMA integrity_check` 必须为 `ok`，否则不得写入 M2 migration 记录。

#### 与运行代码的发布边界

M2 schema、migration、session handler 和 reducer 必须随同一应用版本交付。迁移完成后，新的 session 创建路径必须先创建 `business_session`，再在同一事务创建 assessment/training 子会话；assessment 必须显式写入 `delivery_phase='PREPARED'`。finalize 必须用单条 UPDATE 同时写 `status='COMPLETED'` 和 `delivery_phase='FINALIZED'`。旧写路径在 D2-D6、D8 生效后会被约束拒绝，因此不得只发布 schema。

本 PRD 不把 Grant/Assignment、learning、offline_score_draft、fencing、REST/SSE、HTTPS/CA、backup/restore 子系统纳入 M2。迁移前备份是 runner 的安全措施，不等于实现 v2.2 backup/restore 子系统。

#### 验收标准

| # | 输入 | 预期输出 | 验证方式 |
|---|------|----------|----------|
| M2-MIG-01 | 全新空库 | 完整创建 v0.1.14，M1/M2 记录齐全，结构断言通过 | sql.js 单测 + 真实 SQLite 集成测试 |
| M2-MIG-02 | 含未开始、答题中、待评分、已完成和异常终止数据的 v0.1.13 库 | 原记录主键与数量不变；父会话、阶段、事件版本和观察标识按合同回填 | 迁移前后数据快照断言 |
| M2-MIG-03 | v0.1.12 库 | 同一次启动顺序执行 M1、M2，迁移前只备份一次 | runner 单测 + `beforeMigrate` 调用断言 |
| M2-MIG-04 | M2 结构完整但 ledger 缺失/伪造 | 缺失记录被补齐；伪造记录不能掩盖结构缺口 | 结构漂移单测 |
| M2-MIG-05 | 已完成的 v0.1.14 再次启动 | migration no-op，不重复回填，不新增备份 | 幂等单测 |
| M2-MIG-06 | 在回填或建触发器阶段注入失败 | M2 事务整体回滚，无 M2 记录，应用初始化失败 | 故障注入单测 |
| M2-MIG-07 | 父子键冲突或非法历史阶段 | 拒绝迁移，原数据不被覆盖，错误指出冲突类型 | 冲突数据集成测试 |
| M2-MIG-08 | 迁移成功后的数据库 | `foreign_key_check` 空、`integrity_check=ok`，D2-D6、D8 行为通过，且不存在提前启用的 D1/D7 | 真实 SQLite 约束测试 |

### 10.2 里程碑边界修正

[!] 权威基线按最终形态一次性定义 D1-D11，但本 Mini-PRD 将功能拆为 M2、M3、M6 后，原范围出现两个不可执行依赖：

1. D1 要求 `PREPARED → ASSIGNED → STUDENT_CONFIRMED → ONLINE_IN_PROGRESS`，其中 Assignment 和学生确认的表、handler 均在 M3。M2 若先启用 D1，当前 `assessment:startSession` 没有合法路径进入线上作答。
2. D7 是 `learning_session` 的 INSERT/UPDATE 触发器，而该表到 M6 才创建。SQLite 不能在目标表不存在时创建 D7。

因此采用按写入方启用约束的切分：

- M2 落地 D2-D6、D8，保证新 assessment 从 `PREPARED` 创建、异常阶段冻结、正常完成一致、assessment/training 父子键一致、父会话关键字段不可变。
- M2 单机 IPC 路径允许由 `startSession` 把 `PREPARED` 直接推进到 `ONLINE_IN_PROGRESS`。这是 M2 的临时本机兼容迁移，不伪造 Assignment 或学生确认记录。
- M3 创建 Grant/Assignment 及对应命令后落地 D1。此后新会话必须逐级经过 `ASSIGNED` 和 `STUDENT_CONFIRMED`；M2 已进入 `ONLINE_IN_PROGRESS` 或更后阶段的存量会话不回退。
- M6 创建 `learning_session` 时同步落地 D7，不在 M2 建无目标表的触发器。

这项切分只改变约束的落地里程碑，不改变权威基线的最终数据库形态。M2 实现不得把 D1 的缺席解释为任意跳阶段；允许的阶段写入方仍由 §10.4 固定。

### 10.3 输入与输出合同

#### 标识与事件 payload

M2 不新增独立的 create IPC。assessment 和 training 继续使用现有 `createSession` 入口，主进程生成 `businessSessionId`。M2 固定使用 `business_session_id = assessment_session.session_id` 或 `training_session.training_session_id`，以兼容既有路由、事件 aggregate id 和迁移回填规则。后续里程碑不得依赖两个 ID 必然不同。

`SessionStartedPayload` 和 `TrainingStartedPayload` 采用可选增量字段，保证旧 JSONL 仍可重放：

```ts
interface SessionStartedPayload {
  // 既有字段保持不变
  business_session_id?: string
  initial_delivery_phase?: 'PREPARED'
  observation_template_id?: string | null
}

interface TrainingStartedPayload {
  // 既有字段保持不变
  business_session_id?: string
  module_type?: TrainingModuleType
}
```

新事件必须写入上述字段。重放旧事件时，reducer 按 `business_session_id ?? session_id/training_session_id` 派生父 ID；assessment 初始阶段按 `PREPARED`，training 的旧事件允许 `module_type=NULL`。`module_type` 进入训练开始事件后，删除 create handler 在事务提交后的补写，避免父会话、子会话已提交但模块类型未写入的半成品状态。

`observation_template_id` 在 M2 不增加独立模板表或 FK。JOB_SKILL 策略的 `embedded_observation_question_ids` 非空时，handler 写入稳定标识 `${strategyId}@${strategyVersion}`；为空或非 JOB_SKILL 时写 NULL。该标识只表示冻结在策略版本内的观察题集合，不提供独立模板查询接口。

#### IPC 输入兼容

以下现有写入参数保持不变，renderer 无需为 M2 增加必填字段：

- `assessment:createSession`、`training:createSession`
- `assessment:startSession`、`assessment:submitAnswer`
- `assessment:submitOperationScores`、`assessment:submitJobSkillOfflineScores`
- `assessment:recordTeacherObservation`
- `assessment:emotionInterrupt`、`assessment:emotionResume`、`assessment:abortSession`、`assessment:triggerRedline`
- training 的 start/complete/skip/fail/retry step 操作

M2 不在 renderer 输入中接受 `businessSessionId`、`deliveryPhase`、`eventSequenceVersion` 或 `observationTemplateId`。这些字段由主进程从现有身份、策略和事件序列派生，防止调用方构造不一致父子键或阶段。

#### IPC 输出增量

创建成功响应增加父会话 ID，现有字段不删除、不改名：

```ts
interface CreateSessionSuccess {
  success: true
  sessionId: string
  businessSessionId: string
  questions: SessionQuestionView[]
}

interface CreateTrainingSessionSuccess {
  success: true
  trainingSessionId: string
  businessSessionId: string
  status: TrainingSessionStatus
}
```

assessment 的 `SessionDetail`、`SessionListItem` 增加：

- `businessSessionId: string`
- `deliveryPhase: DeliveryPhase | null`
- `eventSequenceVersion: number`
- `observationTemplateId: string | null`

training 的 `TrainingSessionDetail`、`TrainingSessionListItem` 增加 `businessSessionId: string`。这些均为只读投影字段；迁移遗留的异常 assessment 允许 `deliveryPhase=null`，新建会话不得返回 NULL。

错误码沿用各 handler 现有联合类型。父子约束、阶段约束或 reducer 原子事务失败映射到对应模块的系统错误码，并写现有错误审计；M2 不把 SQLite trigger 文本直接暴露给 renderer。

### 10.4 业务流程合同

#### Assessment 创建与开始

1. `assessment:createSession` 完成现有身份、学生、策略、开放会话、安全事件和题库校验。
2. handler 生成 `sessionId`，并令 `businessSessionId=sessionId`；写 `SESSION_STARTED` 时带 M2 可选字段。
3. 同一现有数据库事务内，reducer 先 INSERT `business_session(session_type='ASSESSMENT')`，再 INSERT `assessment_session(status='INIT', delivery_phase='PREPARED')` 和题目快照。任一步失败，事件投影、父会话、子会话和题目快照全部回滚。
4. 返回 `sessionId`、`businessSessionId` 和原有线上题列表。创建完成不等于学生已经开始作答。
5. 学生首次调用 `assessment:startSession` 时写 `SESSION_FIRST_QUESTION_ACTIVATED`；reducer 用同一条 UPDATE 设置 `status='ACTIVE'`、`delivery_phase='ONLINE_IN_PROGRESS'`、首题指针和事件版本。重复调用直接返回当前指针，不重复推进阶段或事件版本。

#### Assessment 作答、评分与完成

阶段推进由已存在的领域事件触发，不新增无事实来源的“阶段修复”事件：

| 事实 | reducer/handler 输出 |
|------|----------------------|
| `SESSION_FIRST_QUESTION_ACTIVATED` 首次应用 | `INIT + PREPARED → ACTIVE + ONLINE_IN_PROGRESS` |
| 非最后一题 `ANSWER_SUBMITTED` | 保持 `ACTIVE + ONLINE_IN_PROGRESS`，只推进题目指针和计数 |
| 最后一题 `ANSWER_SUBMITTED` | `delivery_phase='ONLINE_COMPLETED'`；有后续评分/观察时 `status='OFFLINE_PENDING'`，不得直接写 COMPLETED |
| 进入任一批线下评分事务 | 在写第一条 `OFFLINE_SCORE_SUBMITTED` 前设 `delivery_phase='OFFLINE_SCORING'` |
| 线下评分齐全且有观察集合 | 设 `delivery_phase='OBSERVATION'` |
| 所有评分及观察齐全，或无需观察 | 设 `delivery_phase='READY_TO_FINALIZE'` |
| `SESSION_COMPLETED` | 单条 UPDATE 同时写 `status='COMPLETED'`、`delivery_phase='FINALIZED'`、`completed_at` 和事件指针 |

现有 `maybeGenerateJobSkillResult` 在完整性检查通过后，必须先把阶段推进到 `READY_TO_FINALIZE`，再于同一事务写 `RESULT_CALCULATED`、`SESSION_COMPLETED` 并应用 reducer。`submitOperationScores` 当前只生成 `OPERATION_PASS_RATE`，不发 `SESSION_COMPLETED`；M2 只将其阶段推进到与现有评分事实一致的位置，不借 M2 擅自补造基础能力会话的最终结果或报告。

情绪中断和恢复只改变 `status`，不改变 `delivery_phase`。`SESSION_ABORTED`、`REDLINE_TRIGGERED` 保留中断时阶段；status 进入 `ABORTED` 或 `REDLINE_HALTED` 后，D3 禁止再修改阶段。异常终止不得写 `FINALIZED`。

#### Training 创建与完成

1. `training:createSession` 继续完成现有身份、策略、开放会话和安全事件校验。
2. handler 生成 `trainingSessionId`，并令 `businessSessionId=trainingSessionId`；`TRAINING_STARTED` 同时携带 `module_type`。
3. reducer 在现有事务内先创建 `business_session(session_type='TRAINING')`，再创建 `training_session(status='INIT', business_session_id=...)` 和四条 step，`module_type` 随 INSERT 一次写入。
4. step 事件和 `TRAINING_COMPLETED` 保持现有输入输出语义。训练没有 `delivery_phase`；完成时仍以 `training_session.status` 为权威状态。
5. 红线批量熔断只改变子会话和 step 状态，不修改或删除父 `business_session`。

### 10.5 Handler 与 reducer 兼容合同

#### 写入职责

- handler 负责鉴权、参数和业务前置校验、构造事件、开启事务及错误码映射，不直接 INSERT assessment/training 投影。
- assessment/training reducer 是父会话、子会话及其明细投影的唯一创建者。创建顺序固定为父表后子表。
- `business_session` 没有 status；禁止 handler 或 reducer 复制子会话状态到父表。
- `business_session.session_type/student_id/job_code/task_code` 创建后不可更新。需要纠正这些键时走后续 correction/invalidation 能力，不原地改父会话。
- 所有已识别并成功应用的 assessment 事件都令 `event_sequence_version = MAX(event_sequence_version, event.event_sequence)`。同一事件重放不得再次增加；未知事件继续 no-op，也不得推进版本。

#### 新旧事件重放

[!] 当前 `src/main/db/connection.ts` 没有读取 `action_log.jsonl`、排序并驱动 reducer 的冷启动重放协调器。因此 M2 的兼容验收限定为：调用方提供按 aggregate 内 `event_sequence` 升序排列的旧 `ActionLogEntry` 时，reducer 能从空投影重建父子会话。完整 JSONL 文件级恢复另立里程碑，不得用 reducer 单测宣称已经交付。

M2 reducer 必须同时接受两代开始事件：

- M2 新事件：读取显式 `business_session_id`、初始阶段和 observation/module 字段。
- M1 及更早事件：从既有 payload 派生父会话字段，父 ID 使用子会话 ID；缺少 observation/module 字段时按 NULL 兼容。

若子会话已存在但父会话缺失，reducer 不得因 INSERT 类自然幂等直接 return；应先按事件事实幂等补齐并校验父会话，再判断子投影是否已应用。若同 ID 父会话已存在但 type/student/job/task 任一不一致，必须抛错并让调用事务回滚，不能覆盖父表。

reducer 对同一 `event_id` 重放必须 no-op；对较小 `event_sequence` 的乱序事件不得降低 `event_sequence_version` 或把阶段回退。M2 不引入通用 UPSERT 或 `INSERT OR REPLACE`，继续使用事件类型对应的精确 INSERT/UPDATE。

#### 读路径与兼容发布

所有 assessment/training 读查询必须从子表直接返回 `business_session_id`，不按 ID 相等规则临时拼接。`getSession`、教师列表和学生列表对迁移数据与新数据返回同一字段结构。

M2 的共享类型、preload 白名单和 renderer 调用保持向后兼容：输入不新增必填项，成功输出只增加字段。现有页面可以暂不展示 M2 字段，但不得因严格对象比较丢弃或拒绝响应。Schema、migration、共享类型、handler、reducer 和测试必须同一版本发布。

### 10.6 M2 业务验收矩阵

| # | 输入 | 预期输出 | 验证方式 |
|---|------|----------|----------|
| M2-BIZ-01 | TEACHER 用既有参数创建 assessment | 返回两个相同的稳定 ID；父表 ASSESSMENT 与子表四键一致；子会话 `INIT + PREPARED` | handler 集成测试 + 父子查询 |
| M2-BIZ-02 | TEACHER 用既有参数创建 training | 父表 TRAINING、子表和四步在同一事务创建；`module_type` 无事务后补写 | handler 集成测试 + 故障注入 |
| M2-BIZ-03 | STUDENT 首次/重复 start assessment | 首次进入 `ACTIVE + ONLINE_IN_PROGRESS` 且版本推进；重复调用不写事件、不改版本 | startSession 集成测试 + 事件计数 |
| M2-BIZ-04 | 连续提交线上答案直到最后一题 | 中途保持 ONLINE_IN_PROGRESS；最后进入 ONLINE_COMPLETED，需后续处理时 status 为 OFFLINE_PENDING | reducer 与 answer handler 测试 |
| M2-BIZ-05 | 提交 JOB_SKILL 线下评分，无观察项 | 阶段依次反映 OFFLINE_SCORING、READY_TO_FINALIZE，最终同一 UPDATE 得到 `COMPLETED + FINALIZED` | job-skill 结果集成测试 + D4 约束 |
| M2-BIZ-06 | 提交含观察项的 JOB_SKILL 评分和观察 | 评分齐全后进入 OBSERVATION；观察齐全后 READY_TO_FINALIZE；结果生成后 FINALIZED | scoring/observation 集成测试 |
| M2-BIZ-07 | ONLINE_IN_PROGRESS 或 OFFLINE_SCORING 时 abort/redline | status 进入异常终态，阶段保留并冻结；后续阶段更新被 D3 拒绝 | handler 测试 + 真实 SQLite trigger 测试 |
| M2-BIZ-08 | 重放不含 M2 可选字段的旧 SESSION_STARTED/TRAINING_STARTED | 自动创建或补齐匹配父会话；旧事件可重建子投影；不覆盖冲突父键 | reducer 兼容测试 |
| M2-BIZ-09 | 同一事件重复 apply、乱序 apply、未知事件 | 投影幂等，版本不重复增加、不下降；未知事件不改变版本或阶段 | reducer 单测 |
| M2-BIZ-10 | get/list assessment 和 training | 现有字段保持，新增父 ID/阶段/版本/观察标识按投影返回 | read handler + shared type 测试 |
| M2-BIZ-11 | 构造空父 ID、错误 session_type/student/job/task 或修改父关键键 | D5、D6、D8 拒绝写入，应用返回模块系统错误而非 trigger 原文 | 真实 SQLite 负向测试 |
| M2-BIZ-12 | 全量现有 assessment/training 测试 | 既有鉴权、错误码、答题、情绪、红线、训练 step 和报告行为无回归 | typecheck + lint + 全量 vitest |

M2 PRD 至此具备实现输入。`/vibe-impl` 已生成 `doc/features/multi-device-v2.2-migration-impl.md` 并通过 Reviewer 二审；用户确认后，从该文档 Step 1 开始逐步实施。
