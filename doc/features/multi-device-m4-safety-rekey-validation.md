# 多设备 M4 安全聚合三元键升级验收记录

## 1. 当前结论

**状态：`PASS`（ACCEPTED_STEP_2A）。**

本轮已关闭权威合同 P0、验收记录 P2，以及原生 SQLite/Electron/UI 的旧 `NOT_RUN` 项。未参与实施者的独立 R3 `/vibe-review code` 结论为 `PASS`、P0/P1/P2=0；随后 `/vibe-accept step M4-6 / Step 2A` 为 `PASS`。M4 Step 2A 已关闭，Step 2B 获得开始资格但未在本轮实施。

默认 `xc-career-guide.db` 未被读取、迁移、修复或覆盖。所有运行验证使用 `mkdtemp` 创建的临时 SQLite 文件或临时 `SVETS_USER_DATA_DIR`。

## 2. 本轮修正

- P0：`project-invariants.md` 的 INV-SAFE-001～003 已明确区分历史 v0.1.16 二元语义与当前 v0.1.17 三元语义，并将证据改为当前三元 trigger；INV-SAFE-004、事件、策略和数据不变量未改义。
- P2：本文件是新增 `doc/` 文档，`doc/index.md` 已有索引项；不再声称“没有新增文档”。
- 新发现并修复两条运行路径缺口：安全终止报告不再读取不存在的 `training_step_record.occurred_at`；管理员事实更正时 replacement 保留原教师的 `confirmed_by`，管理员仍为触发和作废执行者。

## 3. M4-01～M4-13 证据映射

| 项目 | 状态 | 主要证据 |
|---|---|---|
| M4-01 跨岗位开放会话隔离 | PASS | `npm run e2e:m4:ui`：A 岗红线后学生端 B 岗仍可答题；临时 DB 最终状态与独立 B 岗 fixture 一致。 |
| M4-02 同三元整体熔断 | PASS | UI/Electron 观察 A 岗 assessment 与 training 均终止；稳定 SQLite 快照确认两条 binding。 |
| M4-03 同三元未解决阻断 | PASS | `npm run db:m4:verify` 的 fresh-schema/Schema guard 覆盖；36 项通过。 |
| M4-04 仅其他岗位 incident | PASS | UI 验证 A 岗红线不阻断 B 岗；M4 handler/评分定向回归通过。 |
| M4-05 session 红线归属 | PASS | `npm run db:m4:verify` 的 Schema M4 守卫、`foreign_key_check` 和三元查询计划断言通过。 |
| M4-06 replacement 归属 | PASS | UI：跨岗 duplicate 被拒绝、同三元事实更正和 duplicate 成功；report integration 回归覆盖教师确认人约束。 |
| M4-07 v0.1.16 启动迁移 | PASS | `npm run db:m4:native:verify`：真实 `better-sqlite3` 完成 frozen v0.1.16→M4，业务/action-log 规范 hash 守恒。 |
| M4-08 历史异常 preflight | PASS | 原生验证断言 source DB/action-log hash 不变，且未进入 backup/migration。 |
| M4-09 故障注入 | PASS | `npm run db:m4:verify` 保留 M4 DDL 注入回滚；原生验证执行 `foreign_key_check` 与 `integrity_check`。 |
| M4-10 启动互斥分支 | PASS | `npm run db:m4:verify` 的 migration-startup、connection bridge 与 ledger 分支共 36 项通过。 |
| M4-11 handler、结果和报告回归 | PASS | M4 定向命令 7 文件 56 项通过；安全报告训练绑定和事实更正协调器路径均有新增回归。 |
| M4-12 静态 SQL 覆盖 | PASS | `npm run contract:m4:safety-sql:check`：49 hits，9 个 rekey aggregate，0 pending。 |
| M4-13 F7/M4 备份与故障边界 | PASS | 原生验证完成配套 backup manifest/hash 与隔离 restore；DB 门禁覆盖启动/备份边界。 |

## 4. 实际命令和结果

| 验证 | 状态 | 实际结果 |
|---|---|---|
| `npm test -- …M4 定向 7 文件…` | PASS | 7 个测试文件、56 项通过（safety、job-skill result、report reducer/recovery/builders、reports、inventory）。 |
| `npm run contract:m4:safety-sql:check` | PASS | 49 hits：`AGGREGATE_MATCH_REKEY=9`、PK lookup=18、student-wide list=3、non-safety=19。 |
| `npm run db:m4:verify` | PASS | 7 个测试文件、36 项；临时 data root 的 Schema、startup、backup、migration 与回滚验证。 |
| `npm run db:m4:native:verify` | PASS | Electron 41.9.1 / ABI 145 / SQLite 3.53.2；真实 fresh、升级、hash、三条 `EXPLAIN QUERY PLAN`、完整性、backup/restore、preflight hash 验证。临时路径：`mkdtemp(/tmp/svets-m4-native-electron-*)`。 |
| `npm run e2e:m4:ui` | PASS | `xvfb-run` + `SVETS_E2E=1` + 单一 `mkdtemp(/tmp/svets-m4-ui-*)` userData；教师、学生、管理员页面与真实 Electron IPC 均通过。 |
| `npm run typecheck` | PASS | `vue-tsc --noEmit` 与 Node TypeScript 检查退出码 0。 |
| `npm run lint` | PASS | 0 errors、661 条既有 warnings。 |
| `npm test` | PASS | 在允许 sqlite3 临时子进程的环境中退出码 0；当前清单为 112 个文件、1081 项。受限沙箱中的 3 个 `spawnSync sqlite3 EPERM` 不计为产品失败，已在同一命令的可执行环境复跑通过。 |
| `npm run build` | PASS | Electron-Vite 构建退出码 0。 |

## 5. 原生与 UI 证据边界

- 原生验证由 Electron runtime 运行 `better-sqlite3`，未使用 ABI 137 的系统 Node，也未执行 `npm rebuild`。
- UI 验证使用项目现有 Playwright Electron 入口并遵循 `$webapp-testing` 的隔离/可观察性要求；临时 UI 根在成功后删除。`sqlite3` CLI 仅用于初始测试 fixture 和 Electron 关闭后的稳定快照断言，不替代原生 SQLite 证据。
- 全部 backup/restore 都恢复到新的临时路径；不执行 down migration，未触碰默认运行库。

## 6. 独立审查与最终验收

- 独立 reviewer：未参与实施的 `/vibe-review code` 子 Agent；结论 `PASS`，P0/P1/P2 均为 0。其复跑包含 SQL inventory、DB M4、原生 ABI 145、Xvfb UI、typecheck、lint、build、docs/diff 和全量测试。
- `/vibe-accept step M4-6 / Step 2A`：`PASS`。适用 R3 不变量、M4-01～M4-13、跨文件副作用与人工 Electron 流程均有本文件记录的执行证据。
- 后续边界：仅解除 Step 2B 的前置阻断；不代表 Step 2B/2C 已实现，也不授权默认数据库迁移、commit、push、merge 或发布。
