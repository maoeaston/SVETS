# 多设备架构 v2.2 迁移 — Mini-PRD（分里程碑实施）

> **状态：** M1 已实施并验收通过（2026-07-14）；M2–M7 仍为 DRAFT/登记
> **上游权威：** `doc/specs/architecture-plan-b-multi-device-v2.2-authoritative-baseline.md`（AUTHORITATIVE BASELINE）
> **正式 Schema 基线：** `src/main/db/schema.sql` v0.1.13-multi-device-m1-identity
> **本轮实施范围：** 仅 **M1 Schema Foundation**（身份与拓扑骨架）。M2–M7 只列清单，不实施。

---

## 0. 背景与不可一次性落地的理由

v2.2 权威基线定义了 19 张新表、14 个增量列、22 条 CREATE TRIGGER（18 新增 + 4 安全键替换）、25 个索引，并已在临时 SQLite 3.50.6 全量 forward→rollback 验证通过。但**不得一次性落进 schema 和运行代码**，因为：

1. 多数新表（command_log、learning_session、offline_score_draft、applied_event_batch…）只有在对应运行时能力（三段式事件协议、学习子系统、服务端草稿）落地后才有写入方；空表无消费者 = 死代码。
2. 安全聚合键 re-key（替换 4 个 v0.1.12 触发器）是最高风险改动，必须单独隔离一个里程碑，配独立回归。
3. delivery_phase 状态机、父子一致性触发器改变现有业务表 INSERT/UPDATE 行为，需与 handler/reducer 协同，不能先于运行代码落库。

因此按依赖与风险切分为 M1–M7，本轮只做 M1。

## 1. 实现目标（一句话）

在 `schema.sql` 中落地多设备**身份与拓扑骨架**（organization / node / device / device_runtime_session / auth_session 五张纯新增表 + student_profile 可选关联 user_id），不触碰任何现有业务表的语义、触发器和状态机。

## 2. 里程碑分解（M1 实施，M2–M7 仅登记）

| 里程碑 | 范围 | 依赖 | 风险 | 本轮 |
|--------|------|------|------|------|
| **M1 Schema Foundation** | organization, node, device, device_runtime_session, auth_session（T1–T5）+ student_profile.user_id（B1）+ 相关索引 | 无（纯新增 + 1 nullable 列） | 低 | **实施** |
| M2 Business Session 骨架 | business_session（T6）+ assessment/training.business_session_id（B3/B4）+ 父子一致性触发器 D5–D8 + delivery_phase 列/状态机 D1–D4 + 回填 | M1 | 中（改现有表 INSERT/UPDATE 行为） | 登记 |
| M3 Grant/Assignment | delegated_access_grant（T7）、business_session_assignment（T8）+ D9–D11 + rebind 事务 | M2 | 中 | 登记 |
| M4 Safety Re-key | 替换 4 个安全触发器 + 2 个开放会话唯一索引 + job_code 查询索引（§13） | M2 | **高**（改熔断语义） | 登记 |
| M5 Event-Sourcing Infra | command_log, applied_event_batch, processed_event, projector_cursor（T11–T14）+ 三段式协议代码 | M1 | 高 | 登记 |
| M6 Learning | learning_session, learning_progress（T9/T10）+ 学习 handler/view | M2 | 中 | 登记 |
| M7 支撑表 | offline_score_draft, session_invalidation_record, correction_record, backup_manifest, pairing_challenge（T15–T19）+ result_record/task_report 发布列（B5–B7） | M2/M3 | 中 | 登记 |

## 3. 前置条件

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

**核心逻辑（DDL 取自 v2.2 §7.2 T1–T5 / §7.3 B1 / §7.4，已 forward 验证）：**
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

## 6. 明确不做（M1 边界）

- 不加任何触发器（父子一致性、delivery_phase、grant 一致性、安全 re-key 全部推迟）。
- 不改 assessment_session / training_session / safety_incident / result_record / task_report。
- 不新增 business_session / grant / assignment / learning / command_log 等表。
- 不改任何 TS 类型、IPC handler、Vue 视图（M1 纯 schema，无运行代码消费这些表——它们是后续里程碑的 FK 锚点）。
- 不 seed organization/node/device 数据（安装配对流程职责，后续里程碑）。
- 不 commit（除非用户明确要求）。

## 7. 回归验收清单（M1）— 全部通过（2026-07-14）

- [x] `schema.sql` 在临时 SQLite 全量加载零错误
- [x] `PRAGMA foreign_key_check` 空 + `PRAGMA integrity_check` = ok
- [x] table 20→25；trigger 保持 48；新增索引就位（ux_device_one_active_runtime、ux_student_profile_user_id、idx_auth_session_user_status、idx_auth_session_token）
- [x] student_profile.user_id 列存在且 FK/部分唯一索引生效
- [x] device 单 ACTIVE runtime 唯一性生效（ACTIVE+ENDED 并存 OK；第二个 ACTIVE 被拒）
- [x] typecheck 通过（vue-tsc + tsc 均无错）
- [x] build 通过（electron-vite build 成功）
- [x] vitest 全套通过：593/593（含 schema-scoring-closure 4/4）
- [ ] 手工冒烟：删 dev DB → 启动 → initDatabase 正常（**需在真实 Electron 环境执行，留待用户手工验收**）

## 8. 审查 WARN 处置（Reviewer 5 条，无 BLOCK）

| WARN | 处置 |
|------|------|
| §4 重建 dev 库前确认无需保留数据 | `--reset` 显式触发且先备份 DB + JSONL；普通启动不再要求删库 |
| §3 补 capabilities_json 非法 JSON 应 THROW | 已在临时库实测：bad JSON → `CHECK constraint failed`；valid JSON 正常插入 |
| §3 补 ON DELETE SET NULL（删 user_account → student_profile.user_id 置 NULL） | 已实测：删除后 user_id = NULL（未级联删档、未阻断） |
| §3 FK 失败用例为套件首个依赖 FK 强制者 | 已实测：auth_session FK 到不存在 user → `FOREIGN KEY constraint failed`；sql.js 环境 FK 已开启 |
| §2 不为 M1 引入 PRAGMA-检测-ALTER runner | **已被后续多开发机同步需求取代**：现由结构驱动 runner 承担 v0.1.12 → v0.1.13 安全迁移 |

## 9. 下一步

M1（Schema Foundation）完成。M2（Business Session 骨架 + delivery_phase 状态机 + 父子一致性触发器）为下一里程碑，需独立 `/vibe-impl` 轮次——它首次改变现有业务表 INSERT/UPDATE 行为，须与 handler/reducer 协同评审。未 commit（等用户指示）。
