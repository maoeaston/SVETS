# M5A Command Bus Boundary 验收记录

**里程碑状态：`PASS`（`ACCEPTED_STEP_2B`）。**

M5A-1 至 M5A-11 均已完成分步验收；最终代码审查无未关闭 P0/P1，最终全量门禁、隔离 DB、原生 Electron 与 UI 见证均已实际通过。Step 2B 已关闭，Step 2C / M5B 获得重新基线与独立审查资格；这不代表 M5B 已实现，也不授权默认数据库迁移、commit、push、merge 或发布。

## Step M5A-1 — legacy mutation inventory 与静态扫描器

### 结论

`PASS`

- 模式：`/vibe-accept step M5A-1`
- 风险：R3 里程碑中的只读静态门禁步骤
- 规划基点：`40541c82ef374f28ce300365e0e5cc82423dd99a`
- PRD：`doc/features/m5a-command-bus-boundary-prd.md`
- 实施计划：`doc/features/m5a-command-bus-boundary-impl.md`
- 验收日期：2026-07-29

本步只新增 scanner、四份 fixture、负向测试和 package gate；没有修改 `src/` 运行时代码、Schema、事件合同、IPC/preload/shared API、默认数据库或报告文件。

### 冻结结果

| 项目 | 结果 |
|---|---:|
| IPC channel | 74 |
| READ | 28 |
| MUTATION | 46 |
| direct-side-effect callsite | 260 |
| direct-side-effect file | 35 |
| capability construction/import/injection/callsite | 40 |
| delegating root | 5 |
| M5A-1 `MIGRATION_PENDING` | 374 |
| inventory digest | `90391b52a7a44e596533af9cdc11fc2fa2db2a4cf76a8e7ed0e948f1d79d7483` |

35 个 direct 文件分类为 `BUS_COMMAND_DIRECT=13`、`PRODUCTION_INTERNAL_DIRECT=19`、`LOW_LEVEL_PORT=1`、`TEST_ONLY_EXCEPTION=2`。5 个 delegating roots 精确包含 IPC 注册根、job-skill report、report coordinator、task closure 和 legacy upgrade recovery；`TaskClosureService` 的确认与替换两个 coordinator callsite 分开登记。

### 工作区检查

| 检查 | 状态 | 证据 |
|---|---|---|
| `git status --short --untracked-files=all` | PASS | 新增/修改范围与本步计划一致；`.continue-here.md`、`doc/会话启动.md`、BASE_ABILITY review 和 M5A PRD/历史复审为进入本步前已存在的用户/交接文档，未覆盖或清理。 |
| `git diff --stat` | PASS | tracked diff 仅显示既存交接/索引改动与本步 `package.json` 命令；未跟踪 scanner/fixture/test 另由 status 和 no-index 检查覆盖。 |
| `git diff --check` | PASS | 退出码 0。 |
| 新增文件 `git diff --no-index --check` | PASS | 9 个本步/计划未跟踪文件均只有“与 `/dev/null` 存在内容差异”的退出码 1，无 whitespace diagnostics。 |
| 锁文件/依赖 | PASS | 未修改 `package-lock.json`，未安装依赖。 |
| runtime/Schema/API | PASS | `git status` 无 `src/`、Schema、migration、shared、preload 或 renderer 变更。 |

### 自动化检查

| 检查 | 命令 | 状态 | 证据 |
|---|---|---|---|
| 定向 scanner 测试 | `npm test -- scripts/__tests__/m5a-command-boundary-inventory.test.mjs` | PASS | 1 file，8/8 tests。覆盖固定 Git tree、漏/重复/dynamic channel、同文件新 sink、漏 task-closure callsite、coordinator import/alias/injection/call、test-only production import、manifest/mapping/pending 漂移和 target 负向。 |
| 默认 gate | `npm run contract:m5a:command-boundary:check` | PASS | 默认执行 baseline；74/28/46、35 direct files、5 roots，digest 与 fixture 一致。 |
| 固定基点 gate | `npm run contract:m5a:command-boundary:check -- --mode baseline` | PASS | 从规划基点 Git tree 读取源码，不受 checkout 文件移动影响。 |
| 当前迁移态 gate | `npm run contract:m5a:command-boundary:check -- --mode migration --step M5A-1` | PASS | 当前 checkout 与 active manifest、legacy→active mapping、M5A-1 pending 精确一致；pending=374。 |
| target 预期负向 | `npm run contract:m5a:command-boundary:check -- --mode target` | PASS（负向） | 退出码 1，明确拒绝 `374 MIGRATION_PENDING`；未把该预期失败写成 target 已通过。 |
| MJS 语法 | `node --check` 三个新增 MJS | PASS | 退出码 0。 |
| 类型检查 | `npm run typecheck` | PASS | `vue-tsc --noEmit` 与 `tsc --noEmit -p tsconfig.node.json` 退出码 0。 |
| lint | `npm run lint` | PASS | 退出码 0；0 errors、661 个既有 warnings，其中 396 个可自动修复。本步不声称零 warning。 |

### 不变量与跨文件登记

| ID / 项目 | 状态 | 证据 |
|---|---|---|
| `INV-IPC-001` | PASS | 74 个实际 `ipcMain.handle()` channel 恰好登记一次，冻结为 28 READ / 46 MUTATION；dynamic、重复和漏项测试失败关闭。 |
| `INV-IPC-002` | PASS | 本步未修改 renderer/preload；scanner 仅运行在 Node 脚本。 |
| `INV-EVT-001`～`003` | PASS | 260 个直接副作用 callsite 与 event writer/capability 调用只读冻结；未修改事件类型、payload、writer、reducer 或 recovery。 |
| `INV-SAFE-001`～`004` | PASS | safety/assessment/training/assignment 的现有入口被纳入 fixture；本步无安全逻辑或三元键变更。 |
| `INV-AUTH-001`～`002` | PASS | auth/assignment 写入口纳入 fixture；本步无权限或 session 行为变更。 |
| `INV-DATA-003` | PASS | scanner 不打开数据库；所有检查未读取、初始化、迁移或修改默认 `xc-career-guide.db`。 |
| legacy→active mapping | PASS | 374 个 legacy channel/direct/capability ID 全部一一覆盖当前 active ID，并预先冻结 M5A-3～10 的单调 expected-pending 集合。 |
| test-only port | PASS | `memory-adapter.ts`、`test-helpers.ts` 明确为测试例外；production import 反向测试失败关闭。 |

### 人工验收

`NONE`。本步没有 UI、Electron runtime、设备协同或数据库行为变化，不需要人工操作验收。

### 未执行项

- 全量 `npm test`：`NOT_RUN`；Step M5A-1 的精确范围只要求新增 scanner 定向测试，里程碑最终 Step M5A-11 再执行全量测试。
- `npm run build`、Electron smoke、E2E、DB verify：`NOT_RUN`；本步无运行时代码或数据库变化。
- target mode：作为负向已运行并按预期拒绝；真正的 target PASS 要等 Step M5A-11 `MIGRATION_PENDING=0`。

### 下一步

进入 Step M5A-2：实现尚未接线的 command envelope、typed registry、CommandBus、active-key guard、既有 public error mapping 和脱敏观测合同。该步不得注册生产 IPC 或产生 DB/JSONL/文件副作用。

## Step M5A-2 — 未接线的 envelope、registry 与 CommandBus 核心

### 结论

`PASS`

- 模式：`/vibe-accept step M5A-2`
- 风险：R3 里程碑中的纯模块边界步骤
- 前置：Step M5A-1 `PASS`
- 验收日期：2026-07-29

本步只新增 `src/main/application/command/` 下的纯命令合同、运行核心和单元测试。生产 IPC 尚未注册，现有 handler 尚未调用 CommandBus；没有引入 DB、JSONL、文件写能力，没有修改 Schema、事件合同、preload、renderer 或 shared public response union。

### 完成状态

| 合同 | 状态 | 证据 |
|---|---|---|
| Main-owned envelope | PASS | factory 生成 UUID v4、UTC 毫秒时间、默认 correlation，并冻结 canonical target/payload；拒绝 renderer 提供受信 envelope 字段和 payload actor claim。 |
| canonical request hash | PASS | 复用 `report-canonical.ts` 的 plain-object、finite-number、cycle 校验；固定向量得到 `df1470b5705db8c57362264c5ad9626f83b95ce732ede593b17ac60b61cd933c`。 |
| typed registry | PASS | definition 必须声明 actor、resolver、phase、transaction/retry/concurrency、side effects、完整 preflight map、public error family 和测试引用；seal 后不可再注册。 |
| closed-by-default Bus | PASS | registry 未 seal 时拒绝打开；未知命令、非法 actor/target/payload、重复 active key 都在 capability 发放前结束。 |
| accepted capability | PASS | accepted context 使用 nominal brand；只有完成 preflight 后 executor 才可获得，且 mapper 在 accepted 后失败不会倒退标记为 preflight。 |
| active-key lifecycle | PASS | sync/async 共用 guard；冲突被映射为当前 response family 的既有错误码，key 始终在 `finally` 释放。 |
| public error compatibility | PASS | 只使用 `SYSTEM_ERROR`、`ASSESSMENT_SYSTEM_ERROR`、`TRAINING_SYSTEM_ERROR`、`ASSIGNMENT_SYSTEM_ERROR`、`SAFETY_SYSTEM_ERROR`、`REPORT_SYSTEM_ERROR`，没有新增 shared/API 字段。 |
| observability | PASS | trace 只包含稳定 ID、phase、摘要和结果；sink 抛错被隔离，不记录密码、答案键、完整 payload 或学生敏感文本。 |

### 工作区检查

| 检查 | 状态 | 证据 |
|---|---|---|
| `git status --short --untracked-files=all` | PASS | 本步新增 6 个 command core 文件和 3 个测试；既存脏文件与 M5A-1/规划产物均保留，未清理或覆盖。 |
| `git diff --check` | PASS | 退出码 0。 |
| 9 个新增 TS 文件 `git diff --no-index --check` | PASS | 每个文件仅以退出码 1 表示相对 `/dev/null` 有内容差异，均无 whitespace diagnostics。 |
| 依赖与锁文件 | PASS | 未安装依赖，`package-lock.json` 无变化。 |
| runtime/Schema/API | PASS | 本步没有 production wiring、Schema/migration、shared、preload 或 renderer 变更。 |

### 自动化检查

| 检查 | 命令 | 状态 | 证据 |
|---|---|---|---|
| command core 定向测试 | `npm test -- src/main/application/command/__tests__/command-envelope.test.ts src/main/application/command/__tests__/command-registry.test.ts src/main/application/command/__tests__/command-bus.test.ts` | PASS | 3 files，21/21 tests。 |
| scanner + command 回归 | `npm test -- scripts/__tests__/m5a-command-boundary-inventory.test.mjs src/main/application/command/__tests__/command-envelope.test.ts src/main/application/command/__tests__/command-registry.test.ts src/main/application/command/__tests__/command-bus.test.ts` | PASS | 4 files，29/29 tests。 |
| 类型检查 | `npm run typecheck` | PASS | `vue-tsc --noEmit` 与 `tsc --noEmit -p tsconfig.node.json` 退出码 0。 |
| command 目录 lint | `./node_modules/.bin/eslint src/main/application/command --ext .ts` | PASS | 退出码 0，无输出。 |
| 全量 lint | `npm run lint` | PASS | 退出码 0；0 errors、661 个既有 warnings，其中 396 个可自动修复。本步不声称零 warning。 |
| M5A migration gate | `npm run contract:m5a:command-boundary:check -- --mode migration --step M5A-1` | PASS | 仍为 74 channels（28 READ/46 MUTATION）、35 direct files、5 roots、pending=374，digest 未漂移。纯核心没有伪装成已迁移 production callsite。 |

### 不变量与副作用审计

| ID / 项目 | 状态 | 证据 |
|---|---|---|
| `INV-IPC-001`～`002` | PASS | 无 `ipcMain.handle`、preload 或 renderer 接线；现有 74-channel fixture 未漂移。 |
| `INV-EVT-001`～`003` | PASS | command core 不导入 event writer、DB 或文件 capability；scanner direct-side-effect 集合未变化。 |
| `INV-AUTH-001`～`002` | PASS | USER/SYSTEM/BOOTSTRAP actor policy 在纯合同层封闭；未改变现有 session、权限或绑定行为。 |
| `INV-SAFE-001`～`004` | PASS | 未改 safety 聚合、状态机或三元键。 |
| `INV-DATA-003` | PASS | 全部测试使用纯注入依赖，未打开、初始化、迁移或修改默认 `xc-career-guide.db`。 |
| API compatibility | PASS | public error mapping 被限制在当前六个既有 system error family；没有新增 IPC channel、response 字段或 renderer 信任输入。 |

### 人工验收

`NONE`。本步没有 UI、Electron runtime、设备协同或持久化行为变化。

### 未执行项

- 全量 `npm test`：`NOT_RUN`；本步按计划执行 command core 与 scanner 的 29 项相关回归，里程碑最终 Step M5A-11 再执行全量测试。
- `npm run build`、Electron smoke、E2E、DB verify：`NOT_RUN`；本步没有 runtime wiring 或数据库行为。
- target mode：`NOT_RUN`；M5A-1 已证明 pending 非零时 target 会拒绝，真正 target PASS 留到 Step M5A-11。

### 下一步

进入 Step M5A-3：建立 data-root 级 application runtime，前移 startup seed，拆分无写 auth snapshot/accepted heartbeat/sweep，显式准备 action-log path，并把报告协调器收敛为 runtime 单例后注入所有生产消费者。

## Step M5A-3 — application runtime 与内部副作用所有权

### 结论

`PASS`

- 模式：`/vibe-accept step M5A-3`
- 风险：R3 里程碑中的生产 runtime 组合根步骤
- 前置：Step M5A-2 `PASS`
- 验收日期：2026-07-29

本步建立 data-root 级 `ApplicationRuntime`，把启动 seed、action-log 目录准备、legacy event port、auth session 维护和报告协调器放入明确生命周期。生产 IPC 仍沿用原业务函数；本步没有改变 Schema、事件 payload、preload/shared API、renderer 或 M4 safety 聚合键。

### 完成状态

| 合同 | 状态 | 证据 |
|---|---|---|
| 启动顺序 | PASS | DB 初始化之后创建 runtime；四组 error-code seed 在 boundary 注册之前于同一事务执行。注入 seed 失败时注册调用数为 0，data-root reservation 被释放。 |
| data-root 单例 | PASS | 规范化路径在同一进程只能有一个 active runtime；`dispose()` 后允许安全重建。 |
| 内部写所有权 | PASS | `PRE_DB_INIT`、`DB_INIT_RECOVERY`、`POST_DB_INIT_PRE_BOUNDARY_READY`、`ACCEPTED_MUTATION`、`RUNTIME_MAINTENANCE`、`SHUTDOWN` 六个 phase 均有明确 owner 与 capability inventory。 |
| action-log 路径 | PASS | `resolveActionLogPath()` 变为纯路径解析；目录只由 runtime capability 显式准备。DB startup recovery 与 accepted event port 都显式获得 DB/path。 |
| auth snapshot | PASS | trusted caller 读取使用无写 snapshot，不因普通 READ 隐式 heartbeat、撤销或清空 binding。 |
| auth maintenance | PASS | SYSTEM timer sweep 先持久化过期/撤销事实，再清除匹配 runtime owner 的 binding；持久化失败保留 binding。renderer 销毁和 runtime dispose 只清理由该 runtime 拥有的 binding。 |
| report coordinator | PASS | production `new ReportCommandCoordinator` 只有 runtime 组合根一处；reports、safety、job-skill 与 task closure 接收同一实例。测试 helper 是唯一额外构造点。 |
| sync/async admission | PASS | report coordinator 的同步与异步操作共享 active-key admission；同键冲突失败关闭，`finally` 释放 key。 |
| shutdown | PASS | `dispose()` 停止 maintenance timer、清理 runtime binding 与 data-root owner，并在 DB close 之前执行。 |

### 冻结结果

| 项目 | 结果 |
|---|---:|
| IPC channel | 74 |
| READ | 28 |
| MUTATION | 46 |
| direct-side-effect callsite | 259 |
| direct-side-effect file | 35 |
| capability callsite | 41 |
| delegating root | 6 |
| M5A-3 `MIGRATION_PENDING` | 333 |
| active inventory digest | `de945446082ef0a4d7d6f621a85aaac4ff6756e4faa920cd47493d8f8c420003` |

当前总 active 数仍为 374：259 direct + 41 capability + 74 channel。相对 legacy 的两个目录创建 callsite 合并为一个 runtime owner，同时新增 explicit legacy event port 与 runtime coordinator import 两个 `M5A_NEW_ACTIVE` 登记；mapping 共 376 行，legacy 覆盖未丢失。

### 工作区检查

| 检查 | 状态 | 证据 |
|---|---|---|
| `git status --short` / `git diff --stat` | PASS | 运行时代码、相关测试、M5A scanner/文档均在计划范围；进入本步前已有的交接、BASE_ABILITY review 与 M5A 规划文档保持原状，未清理用户改动。 |
| `git diff --check` | PASS | 退出码 0。 |
| 7 个本步新增 runtime/updater 文件 `git diff --no-index --check` | PASS | 每个文件仅以退出码 1 表示相对 `/dev/null` 有内容差异，均无 whitespace diagnostics。 |
| Schema/API path gate | PASS | `src/main/db/schema.sql`、`src/main/db/migrations.ts`、`src/shared`、`src/preload`、`src/renderer` diff 为空。 |
| 依赖与锁文件 | PASS | 未安装依赖，`package-lock.json` diff 为空。 |
| 默认运行库 | PASS | 验证未读取、初始化、迁移或修改默认 `xc-career-guide.db`。 |

### 自动化检查

| 检查 | 命令 | 状态 | 证据 |
|---|---|---|---|
| M5A-3 精确测试组 | `npm test -- src/main/application/runtime/__tests__ src/main/utils/__tests__/auth-context.test.ts src/main/ipc/handlers/__tests__/auth.test.ts src/main/domain/__tests__/report-coordinator.test.ts src/main/__tests__/startup-error.test.ts` | PASS | 5 files，60/60 tests。覆盖 seed 顺序/失败、runtime owner/dispose、auth snapshot/sweep、报告共享 admission 与 startup error。 |
| 业务兼容组 | `npm test -- src/main/domain/__tests__/report-generation.test.ts src/main/domain/__tests__/report-builders.test.ts src/main/domain/__tests__/task-closure-service.test.ts src/main/ipc/handlers/__tests__/report-integration.test.ts src/main/ipc/handlers/__tests__/reports.test.ts src/main/ipc/handlers/__tests__/report-export.test.ts src/main/ipc/handlers/__tests__/safety.test.ts src/main/ipc/handlers/__tests__/job-skill-report.test.ts src/main/ipc/handlers/__tests__/job-skill-result.test.ts src/main/ipc/handlers/__tests__/job-skill-scoring.test.ts src/main/ipc/handlers/__tests__/observation.test.ts` | PASS | 11 files，87/87 tests。 |
| scanner 定向测试 | `npm test -- scripts/__tests__/m5a-command-boundary-inventory.test.mjs` | PASS | 1 file，8/8 tests。 |
| M5A-3 migration gate | `npm run contract:m5a:command-boundary:check -- --mode migration --step M5A-3` | PASS | 74/28/46、35 direct files、6 roots、pending=333，active digest 精确一致。 |
| legacy baseline gate | `npm run contract:m5a:command-boundary:check` | PASS | legacy 74/28/46、35 files、5 roots及冻结 digest 未漂移。 |
| target 预期负向 | `npm run contract:m5a:command-boundary:check -- --mode target` | PASS（负向） | 退出码 1，明确拒绝 `333 MIGRATION_PENDING`；未把预期失败声明成 target 已通过。 |
| 类型检查 | `npm run typecheck` | PASS | `vue-tsc --noEmit` 与 `tsc --noEmit -p tsconfig.node.json` 退出码 0。 |
| 定向 lint | `eslint` 覆盖全部本步 runtime/main/handler 变更 | PASS | 退出码 0，无输出。 |
| 全量 lint | `npm run lint` | PASS | 退出码 0；0 errors、661 个既有 warnings，其中 396 个可自动修复。本步不声称零 warning。 |
| MJS 语法 | `node --check` updater 与 scanner | PASS | 退出码 0。 |

### 不变量与副作用审计

| ID / 项目 | 状态 | 证据 |
|---|---|---|
| `INV-IPC-001`～`002` | PASS | 74 channel 集合未变；本步只改变启动组合与 handler 依赖注入，没有 preload/renderer API 变化。 |
| `INV-EVT-001`～`003` | PASS | event writer、payload、reducer/recovery 顺序保持；accepted legacy port 显式注入 DB/path，报告兼容组通过。 |
| `INV-AUTH-001`～`002` | PASS | 普通 session snapshot 无写；heartbeat 与 sweep 责任分离；binding 按 runtime owner 清理。 |
| `INV-SAFE-001`～`004` | PASS | safety/job-skill 只改为共享 coordinator 注入；`student_id + job_code + task_code` 聚合和阻断逻辑未变。 |
| `INV-DATA-003` | PASS | 测试使用 memory/temp resources；默认运行库未被触碰。 |
| startup closed state | PASS | seed 或 boundary 注册失败都会关闭 runtime，且失败前不会留下部分 handler 注册或长期 timer。 |

### 人工验收

`NONE`。本步没有 UI 或 renderer 交互变化；启动、timer、binding 和 coordinator 行为由定向 runtime/handler 测试覆盖。

### 未执行项

- 全量 `npm test`：`NOT_RUN`；本步执行 60 项精确测试、87 项业务兼容回归与 8 项 scanner 测试，里程碑最终 Step M5A-11 再执行全量测试。
- `npm run build`、Electron smoke、E2E、DB verify：`NOT_RUN`；本步没有打包、UI 或 Schema 变化，留到最终里程碑验收。
- target mode：已作为负向执行并按预期拒绝；真正 target PASS 要等 `MIGRATION_PENDING=0`。

### 下一步

进入 Step M5A-4：由单一 central registry 一次注册 74 个 channel；28 个 READ 走无写 query adapter，46 个 MUTATION 在调用现有业务函数前统一经过结构校验、可信 actor、权威 target、request hash、active-key guard 与 accepted boundary。

## Step M5A-4 — 统一 74-channel 注册与 READ/preflight boundary

### 结论

`PASS`

- 模式：`/vibe-accept step M5A-4`
- 风险：R3 里程碑中的生产 IPC 边界切换步骤
- 前置：Step M5A-3 `PASS`
- 验收日期：2026-07-29

本步把 74 个生产 IPC channel 收敛到单一中央注册入口：28 个 READ 只使用无写 actor snapshot 和 query adapter；46 个 MUTATION 在调用原业务函数前统一经过 readiness、结构校验、sender-bound actor、权威 target、request hash 和 active-key guard。原 handler 的业务 SQL、事件逻辑和事务边界尚未搬移。

### 完成状态

| 合同 | 状态 | 证据 |
|---|---|---|
| 单一注册 owner | PASS | `src/main/ipc/handler-registry.ts` 是生产代码中唯一 `ipcMain.handle()` owner，静态登记 74 次且 channel 不重复；普通 handler 模块为 0 次。注册中途失败会移除已装 handler。 |
| 精确分类 | PASS | sealed registry 为 74 channel，其中 28 READ、46 MUTATION；集合与 preload 的 74 个 `ipcRenderer.invoke()` 精确一致。 |
| READ 零写 | PASS | READ adapter 使用无写 session snapshot；测试确认不 heartbeat，definition 不声明 mutation capability 或 side effect。 |
| mutation closed-by-default | PASS | runtime 未 ready、actor 无效、caller 冲突、target 缺失/冲突和 active-key race 均返回 typed `success:false`，不产生 rejected IPC Promise。 |
| accepted 边界 | PASS | 仅在权威 target 成功解析并取得 guard 后生成 envelope、heartbeat 并调用既有业务函数；传入业务函数的 caller/locator 来自可信 actor/target。 |
| 错误码兼容 | PASS | registry 冻结基础原因及安全细节映射；策略族冲突分别保留 `STRATEGY_TYPE_MISMATCH`/`JOB_CODE_MISMATCH`，训练依次保留 `NOT_FOUND`/`STEP_NOT_FOUND`/`FORBIDDEN`，任务闭环冲突映射 `TASK_CLOSURE_INVALID`。 |
| 生命周期 | PASS | runtime dispose 会移除 74 个 handler 并关闭 CommandBus；重复、漏项、dynamic channel 或不完整 legacy collector 均失败关闭。 |
| API/数据合同 | PASS | channel、preload、shared response、Schema、migration、renderer 均未修改；默认运行库未读取或写入。 |

### 冻结结果

| 项目 | 结果 |
|---|---:|
| IPC channel | 74 |
| READ | 28 |
| MUTATION | 46 |
| direct-side-effect callsite | 259 |
| direct-side-effect file | 35 |
| capability callsite | 28 |
| delegating root | 6 |
| M5A-4 `MIGRATION_PENDING` | 245 |
| active inventory digest | `c190b42272cedd98fb9035b19c085326f4b1ed61027594cd75bd5336ee27f29c` |

相对 M5A-3，本步迁移 74 个旧 IPC registration 和 14 个 handler registration capability 映射；当前 active manifest 为 361 项，legacy mapping 为 376 行，未丢失历史覆盖。

### 工作区检查

| 检查 | 状态 | 证据 |
|---|---|---|
| `git status --short` | PASS | M5A-4 的 command/query/registry/collector、handler registration 改造、测试与 fixture 在计划范围；进入本步前已有交接、BASE_ABILITY review 与 M5A 规划产物均保留。 |
| `git diff --check` | PASS | 退出码 0。 |
| 新增/未跟踪 TS/MJS `git diff --no-index --check` | PASS | 13 个本步涉及文件均只有相对 `/dev/null` 有内容差异的退出码 1，无 whitespace diagnostics。 |
| Schema/API path gate | PASS | `src/main/db/schema.sql`、`src/main/db/migrations.ts`、`src/shared`、`src/preload`、`src/renderer` diff 为空。 |
| 依赖与锁文件 | PASS | 未安装依赖，`package-lock.json` diff 为空。 |
| 默认运行库 | PASS | 测试只使用 `MemoryAdapter`/临时资源；未打开、初始化、迁移或修改默认 `xc-career-guide.db`。 |

### 自动化检查

| 检查 | 命令 | 状态 | 证据 |
|---|---|---|---|
| M5A-4 精确测试组 | `npm test -- src/main/ipc/__tests__/handler-registry.test.ts src/main/application/command/__tests__/preflight-no-side-effect.test.ts src/main/ipc/handlers/__tests__/auth.test.ts src/main/ipc/handlers/__tests__/student-read.test.ts src/main/ipc/handlers/__tests__/strategy-read.test.ts src/main/ipc/handlers/__tests__/assessment-read.test.ts` | PASS | 6 files，89/89 tests。 |
| command/runtime 核心 | `npm test --` command envelope、registry、bus、application runtime 四个文件 | PASS | 4 files，29/29 tests。 |
| 既有 handler 回归 | `npm test -- src/main/ipc/handlers/__tests__` | PASS | 32 files，449/449 tests。 |
| scanner 定向测试 | `npm test -- scripts/__tests__/m5a-command-boundary-inventory.test.mjs` | PASS | 1 file，8/8 tests。 |
| M5A-4 migration gate | `npm run contract:m5a:command-boundary:check -- --mode migration --step M5A-4` | PASS | 74/28/46、35 direct files、6 roots、pending=245，active digest 精确一致。 |
| legacy baseline gate | `npm run contract:m5a:command-boundary:check` | PASS | 规划基点 74/28/46、35 files、5 roots及 digest `90391b52...79d7483` 未漂移。 |
| target 预期负向 | `npm run contract:m5a:command-boundary:check -- --mode target` | PASS（负向） | 退出码 1，明确拒绝 `245 MIGRATION_PENDING`；未把该预期失败声明成 target 已通过。 |
| 类型检查 | `npm run typecheck` | PASS | `vue-tsc --noEmit` 与 `tsc --noEmit -p tsconfig.node.json` 退出码 0。 |
| 定向 lint | `eslint` 覆盖 command、query、runtime、central IPC 与测试 | PASS | 退出码 0，无输出。 |
| 全量 lint | `npm run lint` | PASS | 退出码 0；0 errors、661 个既有 warnings，其中 396 个可自动修复。本步不声称零 warning。 |
| 生产构建 | `npm run build` | PASS | Electron main、preload、renderer 三段构建全部完成。 |

### 不变量与副作用审计

| ID / 项目 | 状态 | 证据 |
|---|---|---|
| `INV-IPC-001`～`002` | PASS | 74 channel 名称和 preload/shared API 不变；唯一静态注册 owner 与 exact-set 测试失败关闭。 |
| `INV-EVT-001`～`003` | PASS | accepted 后仍调用原业务函数；事件 writer、payload、reducer/recovery 和事务语义未搬移，449 项 handler 回归通过。 |
| `INV-AUTH-001`～`002` | PASS | actor 只来自 sender-bound ACTIVE session；caller 仅 compare-only；READ 不 heartbeat，拒绝前不 heartbeat，accepted mutation 才 heartbeat。 |
| `INV-SAFE-001`～`004` | PASS | assessment/training/assignment/safety target 均从 DB 解析；M4 `student_id + job_code + task_code` 键未改变。 |
| `INV-DATA-003` | PASS | 无 Schema/migration/默认运行库变化。 |
| preflight zero side effect | PASS | not-ready、invalid actor、caller/三元 hint 冲突、missing target、策略族冲突、训练 session/step/owner 冲突均比较 DB 状态快照不变，业务 handler 调用数为 0。 |

### 人工验收

`NONE`。本步没有 renderer/UI 变化；中央注册、启动关闭、权限、错误码和业务兼容由自动化测试覆盖。

### 未执行项

- 全量 `npm test`：`NOT_RUN`；本步已运行 29 项核心、89 项精确边界、449 项全部 handler 与 8 项 scanner，M5A-11 再执行仓库全量测试。
- Electron GUI smoke、E2E、`npm run db:verify`：`NOT_RUN`；本步无 UI 或 Schema 变更，最终里程碑统一执行适用检查。
- target mode：已作为负向运行并按预期拒绝；真正 target PASS 要等 `MIGRATION_PENDING=0`。

### 下一步

进入 Step M5A-5：把 auth、student、strategy 的 10 个 mutation 迁移到 application services/query services，保留现有权限、返回结构、密码与事务行为，并把对应 legacy direct sink/capability 从 pending inventory 中精确移除。

## Step M5A-5 — auth、student、strategy application services

### 结论

`PASS`

- 模式：`/vibe-accept step M5A-5`
- 风险：R3 里程碑中的首批业务 mutation ownership 迁移
- 前置：Step M5A-4 `PASS`
- 验收日期：2026-07-29

本步把 auth 的 4 个 mutation、student 的 3 个 mutation 和 strategy 的 3 个 mutation 从兼容 handler 路由迁入 application services。中央注册仍保持 74 个 channel；上述 10 条写命令现在由 Command Bus 直接调用 application owner，原 handler 只保留 transport/兼容 re-export，三域 READ 通过 query service 转发。

### 完成状态

| 合同 | 状态 | 证据 |
|---|---|---|
| 10 条 application route | PASS | `auth:login/logout/createTeacherAccount/setTeacherAccountStatus`、`student:create/update/archive`、`strategy:createVersion/update/setActive` 均由 central registry 注入 application service，不再从 legacy handler 执行业务写逻辑。 |
| handler 薄化 | PASS | `auth.ts`、`student.ts`、`strategy.ts` 中无 `.run()`，无 `ipcMain.handle()`；保留既有函数 re-export 与 collector transport surface。 |
| 权限与可信上下文 | PASS | Command Bus 在 application service 前完成 sender-bound actor、caller compare-only、权威 target 与 active-key guard；角色、伪造 caller、missing target 负测均在 DML/heartbeat 前拒绝。 |
| 密码与会话语义 | PASS | 密码哈希/校验算法未变；登录失败仍写审计，成功仍绑定 sender，会话绑定失败仍撤销 token，logout 仍撤销会话并清理内存 binding。 |
| 事务与审计 | PASS | student account+profile、strategy update/active、teacher status 的原事务拓扑保留；成功审计及登录失败审计均由 application service 在 accepted 后执行。 |
| metadata 完整性 | PASS | 10 个 registry row 均登记 application `transactionOwner`、`NO_AUTO_RETRY`、`FAIL_FAST_ACTIVE_KEY`、side effects 和测试引用；不再声明 `LEGACY_HANDLER_MUTATION`。 |
| API/数据合同 | PASS | 返回结构、错误码、channel、preload/shared API、Schema、migration、renderer 和密码算法均未修改；默认运行库未读写。 |

### 冻结结果

| 项目 | 结果 |
|---|---:|
| IPC channel | 74 |
| READ | 28 |
| MUTATION | 46 |
| direct-side-effect callsite | 259 |
| direct-side-effect file | 35 |
| capability callsite | 28 |
| delegating root | 6 |
| 本步 legacy→active 迁移映射 | 18/18 |
| M5A-5 `MIGRATION_PENDING` | 227 |
| active inventory digest | `e859a72e6d6ce73523e809fa33ddc6400af4a9700af8c435acedde253de9bad1` |

本步的 18 个 direct sink 保持原 active/legacy ID，只把 owner 文件从三个 IPC handler 精确迁到三个 application service。active manifest 仍为 361 项、legacy mapping 仍为 376 行，pending 相对 M5A-4 从 245 单调收缩到 227。

### 工作区检查

| 检查 | 状态 | 证据 |
|---|---|---|
| `git status --short` | PASS | 本步 service/query/registry/handler/test/updater/fixture/validation 改动均在实现计划范围；进入本步前已有交接、BASE_ABILITY review 与 M5A 规划产物原样保留。 |
| `git diff --check` | PASS | 退出码 0。 |
| 新增/未跟踪 TS/MJS/JSON `git diff --no-index --check` | PASS | 14 个本步涉及文件均仅因内容差异退出 1，无 whitespace diagnostics。 |
| Schema/API path gate | PASS | `src/main/db/schema.sql`、`src/main/db/migrations.ts`、`src/shared`、`src/preload`、`src/renderer` diff 为空。 |
| 依赖与锁文件 | PASS | 未安装依赖，`package-lock.json` diff 为空。 |
| 默认运行库 | PASS | 测试使用 memory adapter；未打开、初始化、迁移或修改默认 `xc-career-guide.db`。 |

### 自动化检查

| 检查 | 命令 | 状态 | 证据 |
|---|---|---|---|
| M5A-5 精确测试组 | `npm test --` auth/student/strategy 的 8 个既有测试文件及 `account-command-bus.test.ts` | PASS | 9 files，157/157 tests。 |
| central/preflight 边界 | `npm test -- src/main/ipc/__tests__/handler-registry.test.ts src/main/application/command/__tests__/preflight-no-side-effect.test.ts` | PASS | 2 files，12/12 tests。 |
| scanner 定向测试 | `npm test -- scripts/__tests__/m5a-command-boundary-inventory.test.mjs` | PASS | 1 file，8/8 tests；覆盖 active/mapping 漂移、pending 单调性、未知 sink/capability 与 test-only import。 |
| M5A-5 migration gate | `npm run contract:m5a:command-boundary:check -- --mode migration --step M5A-5` | PASS | 74/28/46、35 direct files、6 roots、pending=227，active digest 精确一致。 |
| legacy baseline gate | `npm run contract:m5a:command-boundary:check -- --mode baseline` | PASS | 规划基点 74/28/46、35 files、5 roots及 digest `90391b52...79d7483` 未漂移。 |
| target 预期负向 | `npm run contract:m5a:command-boundary:check -- --mode target` | PASS（负向） | 退出码 1，明确拒绝 `227 MIGRATION_PENDING`；未把预期失败声明成 target 已通过。 |
| 类型检查 | `npm run typecheck` | PASS | `vue-tsc --noEmit` 与 `tsc --noEmit -p tsconfig.node.json` 退出码 0。 |
| 全量 lint | `npm run lint` | PASS | 退出码 0；0 errors、661 个既有 warnings，其中 396 个可自动修复。本步不声称零 warning。 |
| 生产构建 | `npm run build` | PASS | Electron main、preload、renderer 三段构建全部完成。 |

### 不变量与副作用审计

| ID / 项目 | 状态 | 证据 |
|---|---|---|
| `INV-IPC-001`～`002` | PASS | 74 channel 集合、唯一 central registration owner、preload/shared API 均未变。 |
| `INV-EVT-001`～`003` | PASS | 本步三域不产生领域事件；未改 event writer、payload、projection 或 recovery。 |
| `INV-AUTH-001`～`002` | PASS | actor 只来自 sender-bound ACTIVE session；login 是明确的 unauthenticated 命令，其他 mutation 只在 accepted 后 heartbeat。 |
| `INV-SAFE-001`～`004` | PASS | 本步未改 assessment/training/safety 路径，M4 `student_id + job_code + task_code` 键保持。 |
| `INV-DATA-003` | PASS | 无 Schema/migration/默认运行库变化。 |
| accepted side effects | PASS | role/caller/target 拒绝测试确认 DML、审计和 heartbeat 均不发生；accepted 正常、业务失败与 login/logout 审计矩阵通过。 |

### 人工验收

`NONE`。本步没有 renderer/UI 变化；写命令路由、密码/会话、事务、审计和返回兼容由自动化测试覆盖。

### 未执行项

- 全量 `npm test`：`NOT_RUN`；本步执行 157 项三域回归、12 项中央边界和 8 项 scanner 测试，里程碑最终 Step M5A-11 再执行仓库全量测试。
- Electron GUI smoke、E2E、`npm run db:verify`：`NOT_RUN`；本步无 UI 或 Schema 变化，最终里程碑统一执行适用检查。
- target mode：已作为负向运行并按预期拒绝；真正 target PASS 要等 `MIGRATION_PENDING=0`。

### 下一步

进入 Step M5A-6：把 training 的 6 个 mutation 和 3 个 READ 迁入 application/query services，建立只能由已接受 assessment/safety 父命令调用的 training halt child capability，并保持 FSM、事件/投影顺序、事务和 M4 三元阻断语义不变。

## Step M5A-6 — training application service

### 结论

`PASS`

- 模式：`/vibe-accept step M5A-6`
- 风险：R3 里程碑中的 training 事件、投影与安全熔断边界迁移
- 前置：Step M5A-5 `PASS`
- 验收日期：2026-07-29

本步把 training 的 6 个 mutation 迁入 application service，把 3 个 READ 迁入 query service。中央 Command Bus 仍保持 74 个 channel；training handler 只保留 transport adapter/re-export。assessment 红线所需的 training halt 已改为只能继承已接受父命令上下文的 child capability。

### 完成状态

| 合同 | 状态 | 证据 |
|---|---|---|
| 6 mutation application route | PASS | `training:createSession/startStep/completeStep/skipStep/failStep/retryStep` 均接收 `AcceptedCommandContext` 和注入的 legacy event port；registry metadata 不再声明 `LEGACY_HANDLER_MUTATION`。 |
| 3 READ query-only | PASS | `training:listSessions/listMySessions/getSession` 转入 `training-query-service.ts`；READ definition 无 mutation capability，Bus 集成测试断言调用前后事件写入数为 0。 |
| handler 薄化 | PASS | `src/main/ipc/handlers/training.ts` 中无 `.run()`、`writeEvent()` 或 `ipcMain.handle()`；业务写逻辑位于 application service。 |
| 事件与 correlation | PASS | 7 个 training 事件写入点统一经 injected event port，全部透传 `correlation_id = command_id`；最后一步的 step 事件与可选完成事件复用同一 correlation。 |
| 事务拓扑 | PASS | 保留原有“事件写入后 reducer”顺序和每段 `db.transaction()`；最后一步成功后触发的 completion/finalization 仍是既有第二段事务，不把它误称为整个命令级原子事务。故障注入测试确认当前 SQLite 事务中的 projection/reducer 一起回滚。 |
| halt child capability | PASS | `haltTrainingSessionSteps` 只接受登记的 `assessment:triggerRedline` accepted parent；phase 固定为 `RUNTIME_ACCEPTED_CHILD`，继承父 correlation，三元目标只从父 envelope 的权威 target 取得。错误父命令被拒绝。 |
| FSM/M4/API 兼容 | PASS | training 状态、步骤迁移、完成率、事件类型、响应结构和 `student_id + job_code + task_code` 阻断语义未改；同三元红线联动和跨 job 隔离回归通过。 |

### 冻结结果

| 项目 | 结果 |
|---|---:|
| IPC channel | 74 |
| READ | 28 |
| MUTATION | 46 |
| direct-side-effect callsite | 252 |
| direct-side-effect file | 35 |
| capability callsite | 35 |
| 其中 `LEGACY_EVENT_PORT_CALL` | 7 |
| delegating root | 6 |
| 本步 legacy→active 迁移映射 | 24/24 |
| M5A-6 `MIGRATION_PENDING` | 203 |
| active inventory digest | `4ab4c030953cc5aab5f900a3a27c3031d0bef28f0ee02de4ade302fafceb4745` |

active manifest 共 361 项、legacy mapping 共 376 行。本步把 training reducer DML、event-port capability 和 halt 写入的 24 个 legacy owner 精确迁移；pending 相对 M5A-5 从 227 单调收缩到 203。

### 工作区检查

| 检查 | 状态 | 证据 |
|---|---|---|
| `git status --short` / `git diff --stat` | PASS | training service/query、Command Bus metadata、runtime port、assessment child 调用、测试、scanner/updater/fixture 和本验收记录均在计划范围；原有交接、BASE_ABILITY review 与先前 M5A 产物未清理。 |
| `git diff --check` | PASS | 退出码 0。 |
| 未跟踪文件 `git diff --no-index --check` | PASS | 对 44 个相关 application/IPC/scanner/fixture/validation 文件逐一检查；均仅因相对 `/dev/null` 有内容差异退出 1，无 whitespace diagnostics。 |
| Schema/API path gate | PASS | `src/main/db/schema.sql`、`src/main/db/migrations.ts`、`src/shared`、`src/preload`、`src/renderer` diff 为空。 |
| 依赖与锁文件 | PASS | 未安装依赖，`package-lock.json` diff 为空。 |
| 默认运行库 | PASS | 验证使用 memory/临时 DB 与注入 port；未打开、初始化、迁移或修改默认 `xc-career-guide.db`。 |

### 自动化检查

| 检查 | 命令 | 状态 | 证据 |
|---|---|---|---|
| M5A-6 精确测试组 | `npm test --` 4 个 training handler 测试、`training-reducer.test.ts`、`training-command-bus.test.ts` | PASS | 6 files，54/54 tests。覆盖 create/steps/complete/redline、READ 零写、同 correlation、SQLite rollback 与 child capability。 |
| 全部 handler 回归 | `npm test -- src/main/ipc/handlers` | PASS | 32 files，449/449 tests；包含 assessment/training 红线、M4 跨岗位、评分、assignment、safety 与 reports 回归。 |
| scanner 定向测试 | `npm test -- scripts/__tests__/m5a-command-boundary-inventory.test.mjs` | PASS | 1 file，8/8 tests。最初误用 `node --test` 因 Vitest 上下文不兼容退出 1，随后按仓库 `npm test` 入口纠正并通过。 |
| M5A-6 migration gate | `npm run contract:m5a:command-boundary:check -- --mode migration --step M5A-6` | PASS | 74/28/46、35 direct files、6 roots、pending=203，active digest 精确一致。 |
| legacy baseline gate | `npm run contract:m5a:command-boundary:check -- --mode baseline` | PASS | 规划基点 74/28/46、35 files、5 roots及 digest `90391b52...79d7483` 未漂移。 |
| target 预期负向 | `npm run contract:m5a:command-boundary:check -- --mode target` | PASS（负向） | 退出码 1，明确拒绝 `203 MIGRATION_PENDING`；未把预期失败声明成 target 已通过。 |
| 类型检查 | `npm run typecheck` | PASS | `vue-tsc --noEmit` 与 `tsc --noEmit -p tsconfig.node.json` 退出码 0。 |
| 全量 lint | `npm run lint` | PASS | 退出码 0；0 errors、661 个既有 warnings，其中 396 个可自动修复。本步不声称零 warning。 |
| 生产构建 | `npm run build` | PASS | Electron main、preload、renderer 三段构建全部完成。 |
| MJS 语法 | `node --check` scanner、gate 与 M5A-6 updater | PASS | 三条命令退出码均为 0。 |
| 文档索引 | `npm run docs:index:check` | PASS | `doc/index.md is current`。 |

### 不变量与副作用审计

| ID / 项目 | 状态 | 证据 |
|---|---|---|
| `INV-IPC-001`～`002` | PASS | 74 channel、central registration、preload/shared API 均未变；handler 无原始注册或写入旁路。 |
| `INV-EVT-001`～`003` | PASS | event type/payload 未变；所有状态仍由既有 event→reducer 链推进，54 项精确测试与 449 项 handler 回归通过。 |
| `INV-SAFE-001`～`004` | PASS | 红线仍由 safety event/Schema trigger 先熔断，Bus 不直接插入 `REDLINE_HALTED`；halt child 使用权威 M4 三元 target。 |
| `INV-AUTH-001`～`002` | PASS | training mutation 的 actor 仍由 sender-bound accepted context 提供；角色与 owner 校验回归通过。 |
| `INV-RES-001`～`002` | PASS | `TRAINING_COMPLETION` 独立生成且安全优先逻辑未改；完成闭环和红线回归通过。 |
| `INV-DATA-003` | PASS | 无 Schema/migration/默认运行库变化。 |
| 跨文件登记 | PASS | create target、step→session 反查、event→reducer 顺序、halt owner/phase/correlation、reducer 回归和 24/24 inventory mapping 均有自动化证据。 |

### 人工验收

`NONE`。本步没有 renderer/UI 变化；training 状态、权限、红线联动、返回兼容和故障回滚由自动化测试覆盖。

### 未执行项

- 仓库全量 `npm test`：`NOT_RUN`；本步已运行 54 项精确测试、449 项全部 handler 与 8 项 scanner，M5A-11 再执行仓库全量测试。
- Electron GUI smoke、E2E、`npm run db:verify`：`NOT_RUN`；本步无 UI 或 Schema 变化，最终里程碑统一执行适用检查。
- target mode：已作为负向运行并按预期拒绝；真正 target PASS 要等 `MIGRATION_PENDING=0`。

### 下一步

进入 Step M5A-7：把 11 个 assessment mutation 和 3 个 READ 迁入 application/query services，保留 session 事件链、M4 红线顺序、坐次/结果计算、现有多段事务与 training halt child correlation。

## Step M5A-7 — assessment core application service

### 结论

`PASS`

- 模式：`/vibe-accept step M5A-7`
- 风险：R3 里程碑中的 assessment 多事件事务、M4 红线与结果写入边界迁移
- 前置：Step M5A-6 `PASS`
- 验收日期：2026-07-29

本步把 assessment core 的 11 个 mutation 迁入 application service，把 3 个 READ 迁入 query service。中央 Command Bus 仍保持 74 个 channel；assessment handler 只保留 transport adapter/re-export。红线命令继续在既有 SQLite 事务中创建安全事件、触发 M4 三元熔断、写 assessment 事件和安全结果，提交后再以 accepted child capability 处理 training step halt。

### 完成状态

| 合同 | 状态 | 证据 |
|---|---|---|
| 11 mutation application route | PASS | `assessment:abortSession/calculateResult/createSession/emotionInterrupt/emotionResume/pauseSitting/recordEmotionCollapse/startNextSitting/startSession/submitAnswer/triggerRedline` 均接收 `AcceptedCommandContext` 和注入的 event port；registry metadata 不再声明 legacy handler mutation。 |
| 3 READ query-only | PASS | `assessment:getSession/listSessions/listMySessions` 转入 `assessment-query-service.ts`；集成测试断言 READ 前后 event write 数为 0，伪造三元 target 在 accepted 前被拒绝。 |
| handler 薄化 | PASS | `src/main/ipc/handlers/assessment.ts` 中无 `.run()`、`writeEvent()` 或 `ipcMain.handle()`；业务读写分别位于 application/query service。 |
| 权威三元 target | PASS | session mutation 从 session 权威记录解析 `student_id + job_code + task_code`；create 从已验证 student/strategy/safety 引用生成 target。central/preflight 测试固定 caller/target hint 仅 compare、冲突在业务调用前拒绝。 |
| 事件与 correlation | PASS | 26 个 assessment legacy event-port callsite 全部由注入 port 执行；single/multi-event 路径透传 accepted command correlation。红线的安全、assessment、result 事件与 training child 继承同一 correlation。 |
| 多事件事务 | PASS | sitting、collapse、result 与 redline 保留既有 event→reducer/projection 顺序和 SQLite transaction owner；注入 event-port 失败时当前事务中的 projection/safety facts 整体回滚。JSONL 已成功追加的前缀仍遵循既有不可回滚边界，未引入截删或 command-group recovery。 |
| M4 红线顺序 | PASS | `triggerRedline` 仍先写 `SAFETY_INCIDENT_CREATED`，由 safety row/schema trigger 对同 `student + job + task` 熔断，再写 `REDLINE_TRIGGERED` 与安全结果；Bus/service 不直接插入 `REDLINE_HALTED`。training halt 在主事务提交后使用登记的 accepted parent child capability。 |
| 结果/API 兼容 | PASS | paper generation、question snapshot、score/level 计算、事件类型/顺序、返回结构和错误码未改；Schema、migration、shared/preload/renderer 均未改。 |

### 冻结结果

| 项目 | 结果 |
|---|---:|
| IPC channel | 74 |
| READ | 28 |
| MUTATION | 46 |
| direct-side-effect callsite | 233 |
| direct-side-effect file | 35 |
| capability callsite | 54 |
| 其中 `LEGACY_EVENT_PORT_CALL` | 26 |
| delegating root | 6 |
| 本步 legacy→active 迁移映射 | 47/47 |
| M5A-7 `MIGRATION_PENDING` | 156 |
| active inventory digest | `6d1c445cb6c138d5411535fe0726f86121f8d1e320817ec52c4c916d46270373` |

active manifest 共 361 项、legacy mapping 共 376 行。本步把 assessment core 的 DB sink 与 event-port capability 47 个 legacy owner 精确迁移；pending 相对 M5A-6 从 203 单调收缩到 156。

### 工作区检查

| 检查 | 状态 | 证据 |
|---|---|---|
| `git status --short` | PASS | assessment service/query、Command Bus metadata、runtime routing、测试 helper/集成测试、scanner/updater/fixture、M4 清单和本验收记录均在计划范围；原有交接、BASE_ABILITY review 与先前 M5A 产物未清理。 |
| `git diff --check` | PASS | 退出码 0。 |
| 未跟踪文件 `git diff --no-index --check` | PASS | 对当前 56 个未跟踪文件逐一检查；均无 whitespace diagnostics。 |
| Schema/API path gate | PASS | `src/main/db/schema.sql`、`src/main/db/migrations.ts`、`src/shared`、`src/preload`、`src/renderer` diff 为空。 |
| 依赖与锁文件 | PASS | 未安装依赖，`package-lock.json` diff 为空。 |
| 默认运行库 | PASS | 验证使用 memory/临时 DB 与注入 port；未打开、初始化、迁移或修改默认 `xc-career-guide.db`。 |

### 自动化检查

| 检查 | 命令 | 状态 | 证据 |
|---|---|---|---|
| M5A-7 精确测试组 | `npm test --` implementation plan 指定的 8 个 assessment/reducer 测试及 `assessment-command-bus.test.ts` | PASS | 9 files，171/171 tests。覆盖 create/start/answer/emotion/redline/result/read、三元拒绝、同 correlation 与 SQLite rollback。首次抽取 query 时把开放态常量误写为 `PREPARED`，2 项 `listMySessions` 回归立即失败；修正为权威状态 `INIT` 后精确组全通过。 |
| 全部 handler 回归 | `npm test -- src/main/ipc/handlers` | PASS | 32 files，449/449 tests；包含 assessment/job-skill/scoring、training、M4 红线、assignment、safety 与 reports 回归。 |
| central/preflight 边界 | `npm test -- src/main/ipc/__tests__/handler-registry.test.ts src/main/application/command/__tests__/preflight-no-side-effect.test.ts` | PASS | 2 files，12/12 tests；包含伪造 assessment 三元 hint 在 accepted/heartbeat/业务调用前拒绝。 |
| scanner 定向测试 | `npm test -- scripts/__tests__/m5a-command-boundary-inventory.test.mjs` | PASS | 1 file，8/8 tests；覆盖 active/mapping 漂移、pending 单调性、未知 sink/capability 与 test-only import。 |
| M4 safety SQL 清单测试 | `npm test -- scripts/__tests__/multi-device-m4-safety-sql-inventory.test.mjs` | PASS | 1 file，8/8 tests，真实生产命中 52 条。初次门禁发现 11 个 service 路径迁移未同步及 3 个只读 resolver SQL 未登记；只修正路径敏感清单和断言后通过，业务 SQL 未改。 |
| M4 safety SQL target gate | `npm run contract:m4:safety-sql:check` | PASS | 52 hits：aggregate 9、incident primary-key 20、student-wide 3、non-safety 20；无未登记、陈旧指纹或缺三元键。 |
| M5A-7 migration gate | `npm run contract:m5a:command-boundary:check -- --mode migration --step M5A-7` | PASS | 74/28/46、35 direct files、6 roots、pending=156，active digest 精确一致。 |
| legacy baseline gate | `npm run contract:m5a:command-boundary:check -- --mode baseline` | PASS | 规划基点 74/28/46、35 files、5 roots及 digest `90391b52...79d7483` 未漂移。 |
| target 预期负向 | `npm run contract:m5a:command-boundary:check -- --mode target` | PASS（负向） | 退出码 1，明确拒绝 `156 MIGRATION_PENDING`；未把预期失败声明成 target 已通过。 |
| 类型检查 | `npm run typecheck` | PASS | `vue-tsc --noEmit` 与 `tsc --noEmit -p tsconfig.node.json` 退出码 0。 |
| 定向 lint | `eslint` 覆盖 assessment service/query/handler、command definitions、测试 helper 与集成测试 | PASS | 退出码 0，无输出。 |
| 全量 lint | `npm run lint` | PASS | 退出码 0；0 errors、661 个既有 warnings，其中 396 个可自动修复。本步不声称零 warning。 |
| 生产构建 | `npm run build` | PASS | Electron main、preload、renderer 三段构建全部完成。 |
| MJS 语法 | `node --check` command-boundary gate 与 M5A-7 updater | PASS | 两条命令退出码均为 0。 |
| 文档索引 | `npm run docs:index:check` | PASS | `doc/index.md is current`。 |

### 不变量与副作用审计

| ID / 项目 | 状态 | 证据 |
|---|---|---|
| `INV-IPC-001`～`002` | PASS | 74 channel、central registration、preload/shared API 均未变；assessment handler 无原始注册或写入旁路。 |
| `INV-EVT-001`～`003` | PASS | event type/payload 未变；assessment 状态仍由既有 event→reducer 链推进，171 项精确测试和 449 项 handler 回归通过。 |
| `INV-SAFE-001`～`004` | PASS | 红线仍由 safety event/Schema trigger 先熔断；assessment/training child 使用同一权威 M4 三元 target，跨 job 隔离回归通过。 |
| `INV-AUTH-001`～`002` | PASS | assessment actor 来自 sender-bound accepted context；service 的 caller 字段由可信 actor 覆盖，角色/owner 规则保持。 |
| `INV-RES-001`～`002` | PASS | ability result、safety override 与 completion 生成规则未变；安全结果优先和幂等回归通过。 |
| `INV-DATA-003` | PASS | 无 Schema/migration/默认运行库变化。 |
| 跨文件登记 | PASS | create/session target、事件 correlation、`applyAssessmentEvent`、training halt child、result transaction、M4 SQL inventory 和 47/47 mapping 均有自动化证据。 |

### 人工验收

`NONE`。本步没有 renderer/UI 变化；assessment 流程、权限、红线联动、返回兼容、事务与故障回滚由自动化测试覆盖。

### 未执行项

- 仓库全量 `npm test`：`NOT_RUN`；本步已运行 171 项精确测试、449 项全部 handler、12 项中央边界、8 项 scanner 与 8 项 M4 清单测试，M5A-11 再执行仓库全量测试。
- Electron GUI smoke、E2E、`npm run db:verify`：`NOT_RUN`；本步无 UI 或 Schema 变化，最终里程碑统一执行适用检查。
- target mode：已作为负向运行并按预期拒绝；真正 target PASS 要等 `MIGRATION_PENDING=0`。

### 下一步

进入 Step M5A-8：把 ability、operation、job-skill scoring 与 observation 的 4 个 mutation、5 个 READ 及 result/report automation 迁入 application/query services，保留多事件事务、runtime 单例 coordinator、JSONL 合法前缀和逐事件 recovery 边界。

## Step M5A-8 — scoring、observation 与 JOB_SKILL automation

### 结论

`PASS`

- 模式：`/vibe-accept step M5A-8`
- 风险：R3 里程碑中的批量评分、多事件 JSONL/SQLite 边界及结果/报告自动化迁移
- 前置：Step M5A-7 `PASS`
- 验收日期：2026-07-29

本步把 ability、operation、JOB_SKILL scoring 和 teacher observation 的 4 个 mutation 迁入 application services，把 5 个 READ 迁入纯 query services，并把 JOB_SKILL result/report automation 收口为只接受登记父命令的 accepted context。所有评分事件由 runtime 注入的 legacy event port 写入；自动报告继续使用 application runtime 的同一 `ReportCommandCoordinator` 实例。

### 完成状态

| 合同 | 状态 | 证据 |
|---|---|---|
| 4 mutation application route | PASS | `assessment:submitOfflineAbilityScores/submitOperationScores/submitJobSkillOfflineScores/recordTeacherObservation` 均接收 accepted context 与注入 event port；metadata 登记 application transaction owner，不再声明 legacy handler mutation。 |
| 5 READ query-only | PASS | `getOfflineAbilityScores/getOperationScores/getJobSkillOfflineScores/getSessionScoringQuestions/getTeacherObservations` 分别位于 4 个 query service；无 event port、accepted context、coordinator 或 `.run()`，registry side effects 为空。 |
| handler 薄化 | PASS | 6 个 scoring/result/report 兼容 handler 无 `.run()`、`writeEvent()` 或 `ipcMain.handle()`，只负责 transport、可信 caller 和 re-export。 |
| 权威三元 target | PASS | 四条 mutation 均由 `sessionId` 解析 assessment session 的 `student_id + job_code + task_code`；伪造 job hint 在 accepted/heartbeat/业务调用前拒绝。评分安全查询继续使用持久化 session 三元事实。 |
| 同 correlation | PASS | operation 9+1、多题 ability/JOB_SKILL、observation + result + completion 均复用父命令 correlation；自动 `REPORT_GENERATED` 继承最终 accepted observation 的同一 correlation。 |
| result/report accepted parent | PASS | `finalizeJobSkillResultCore` 与 report automation 仅接受 `submitJobSkillOfflineScores` 或 `recordTeacherObservation` 父命令；已接受但未登记的 ability scoring parent 被显式拒绝。 |
| runtime coordinator 单例 | PASS | `createJobSkillReportAutomation(runtime.db, runtime.reportCoordinator).coordinator === runtime.reportCoordinator`；application service/handler 中没有自行 `new ReportCommandCoordinator`。 |
| JSONL/SQLite 边界 | PASS | 真实临时 action log 在第 4 次成功 append 后注入失败：当前 SQLite 事务中的 event projection、4 条评分 projection 和 result 全回滚，JSONL 保留 4 条 checksum/sequence/correlation 合法前缀。recovery 逐事件补回 4 条事实，不按 correlation 补齐其余事件；二次 recovery 幂等跳过 4 条。 |
| 评分/API 兼容 | PASS | 9+1 operation、ability batch、JOB_SKILL/observation finalize 的题量、阈值、结果类型、报告内容、错误码和返回结构未改；Schema/shared/preload/renderer 未改。 |

### 冻结结果

| 项目 | 结果 |
|---|---:|
| IPC channel | 74 |
| READ | 28 |
| MUTATION | 46 |
| direct-side-effect callsite | 226 |
| direct-side-effect file | 30 |
| capability callsite | 61 |
| 其中 `LEGACY_EVENT_PORT_CALL` | 33 |
| delegating root | 11 |
| 本步 legacy→active 迁移映射 | 7/7 |
| M5A-8 `MIGRATION_PENDING` | 149 |
| active inventory digest | `41d106adb9948325c45e8168159b0fa9a268797420fb264330f1743acf4f6bfe` |

active manifest 共 361 项、legacy mapping 共 376 行。本步把 7 个 raw event-writer callsite 精确迁为 injected event-port capabilities；pending 相对 M5A-7 从 156 单调收缩到 149。JOB_SKILL report 的 coordinator import/injection 已随 service 路径重定位，但按实施计划仍保持 `M5A-10` pending，不在本步提前宣称迁移完成。

### 工作区检查

| 检查 | 状态 | 证据 |
|---|---|---|
| `git status --short` | PASS | scoring/result/report service、query、薄 handler、runtime routing、command metadata、测试 helper/集成测试、scanner/updater/fixture、M4 清单和本验收记录均在计划范围；先前 dirty worktree 内容未清理或覆盖。 |
| `git diff --check` | PASS | 退出码 0。 |
| 未跟踪文件 `git diff --no-index --check` | PASS | 对当前 70 个未跟踪文件逐一检查，无 whitespace diagnostics。 |
| Schema/API path gate | PASS | `src/main/db/schema.sql`、`src/main/db/migrations.ts`、`src/shared`、`src/preload`、`src/renderer` diff 为空。 |
| 依赖与锁文件 | PASS | 未安装依赖，`package-lock.json` diff 为空。 |
| 默认运行库 | PASS | 测试使用 memory DB 和临时 JSONL 目录；未打开、初始化、迁移或修改默认 `xc-career-guide.db`。 |

### 自动化检查

| 检查 | 命令 | 状态 | 证据 |
|---|---|---|---|
| M5A-8 精确测试组 | implementation plan 指定的 6 个 scoring/result/report 测试、2 个 recovery 测试及 2 个新增 Bus/failure 测试 | PASS | 10 files，96/96 tests。覆盖 4 mutation、5 read、accepted parent、coordinator identity、报告 correlation、真实 JSONL 第 4 次故障和逐事件 recovery。 |
| 全部 handler 回归 | `npm test -- src/main/ipc/handlers` | PASS | 32 files，450/450 tests；唯一 stderr 是既有坏 JSON 容错用例的预期诊断。 |
| central/preflight/runtime | `npm test --` handler registry、preflight-no-side-effect、application runtime | PASS | 3 files，19/19 tests。 |
| scanner 定向测试 | `npm test -- scripts/__tests__/m5a-command-boundary-inventory.test.mjs` | PASS | 1 file，8/8 tests；覆盖 M5A-8 counts、pending、capability 重定位和 test-only import。updater 首次 dry run 在写 fixture 前发现 relocation key 未包含 legacy file，导致 JOB_SKILL/Safety coordinator ID 碰撞；收紧为 file-aware key 后生成唯一 active IDs 并通过。 |
| M4 safety SQL 清单测试 | `npm test -- scripts/__tests__/multi-device-m4-safety-sql-inventory.test.mjs` | PASS | 1 file，8/8 tests。初次门禁准确发现 4 条 scoring service 路径迁移；只同步 `M4-SQL-023/033/034/035` 路径、指纹和证据，SQL 文本与分类未改。 |
| M4 safety SQL target gate | `npm run contract:m4:safety-sql:check` | PASS | 52 hits：aggregate 9、incident primary-key 20、student-wide 3、non-safety 20。 |
| M5A-8 migration gate | `npm run contract:m5a:command-boundary:check -- --mode migration --step M5A-8` | PASS | 74/28/46、30 direct files、11 roots、pending=149，active digest 精确一致。 |
| legacy baseline gate | `npm run contract:m5a:command-boundary:check -- --mode baseline` | PASS | 规划基点 74/28/46、35 files、5 roots及 digest `90391b52...79d7483` 未漂移。 |
| target 预期负向 | `npm run contract:m5a:command-boundary:check -- --mode target` | PASS（负向） | 退出码 1，明确拒绝 `149 MIGRATION_PENDING`；未把预期失败声明成 target 已通过。 |
| 类型检查 | `npm run typecheck` | PASS | `vue-tsc --noEmit` 与 `tsc --noEmit -p tsconfig.node.json` 退出码 0。 |
| 定向 lint | `eslint` 覆盖 6 个 service、4 个 query、6 个 handler、3 个新测试与 scanner 文件 | PASS | 退出码 0，无输出。 |
| 全量 lint | `npm run lint` | PASS | 退出码 0；0 errors、661 个既有 warnings，其中 396 个可自动修复。本步不声称零 warning。 |
| 生产构建 | `npm run build` | PASS | Electron main、preload、renderer 三段构建全部完成。 |
| MJS 语法 | `node --check` command-boundary gate 与 M5A-8 updater | PASS | 两条命令退出码均为 0。 |
| 文档索引 | `npm run docs:index:check` | PASS | `doc/index.md is current`。 |

### 不变量与副作用审计

| ID / 项目 | 状态 | 证据 |
|---|---|---|
| `INV-IPC-001`～`002` | PASS | 74 channel、唯一 central registration、preload/shared API 均未变；六个兼容 handler 无写入旁路。 |
| `INV-EVT-001`～`003` | PASS | event type/payload/顺序未改；批量事件继续 event→assessment reducer，96 项精确测试、450 项 handler 回归和 recovery 回归通过。 |
| `INV-SAFE-001`～`004` | PASS | scoring gate 与 JOB_SKILL safety summary 继续使用完整 M4 三元键；52 条 SQL 清单无漂移或缺键。 |
| `INV-AUTH-001`～`002` | PASS | actor/caller 来自 sender-bound accepted context；伪造 caller/target 在写入前拒绝。 |
| `INV-RES-001`～`002` | PASS | operation/JOB_SKILL result 和自动报告仍保留现有 F7 write gate、结果幂等、报告 fallback 与 runtime coordinator。 |
| `INV-DATA-003` | PASS | 无 Schema/migration/默认运行库变化。 |
| recovery 边界 | PASS | 合法 JSONL 前缀不截删、不补偿、不按 correlation 分组重放；SQLite 恢复按事件独立事务，第二次幂等跳过。 |

### 人工验收

`NONE`。本步没有 renderer/UI 变化；评分结果、观察、报告自动化、事务/恢复和权限兼容由自动化测试覆盖。

### 未执行项

- 仓库全量 `npm test`：`NOT_RUN`；本步已运行 96 项精确测试、450 项全部 handler、19 项中央/runtime、8 项 scanner 与 8 项 M4 清单测试，M5A-11 再执行仓库全量测试。
- Electron GUI smoke、E2E、`npm run db:verify`：`NOT_RUN`；本步无 UI 或 Schema 变化，最终里程碑统一执行适用检查。
- target mode：已作为负向运行并按预期拒绝；真正 target PASS 要等 `MIGRATION_PENDING=0`。

### 下一步

进入 Step M5A-9：把 assignment 的 5 个 mutation、safety 的 4 个 mutation 与相关 READ 迁入 application/query services，收口 local-runtime child 与 safety report fallback，并保持 M3 assignment FSM、M4 三元熔断和角色权限不变。

## Step M5A-9 — assignment、local runtime 与 safety

### 结论

`PASS`

- 模式：`/vibe-accept step M5A-9`
- 风险：R3 里程碑中的多设备 assignment、local-runtime child mutation、安全 FSM 与安全报告自动化迁移
- 前置：Step M5A-8 `PASS`
- 验收日期：2026-07-29

本步把 assignment 的 5 个 mutation 与 safety 的 4 个 mutation 迁入 application services，把 safety 的 2 个 READ 迁入纯 query service。所有普通事件写入均由 application runtime 注入的 legacy event port 执行；local runtime 只接受已通过 Bus 的 assignment create/rebind 父上下文；safety 自动报告继续使用 runtime 的同一 `ReportCommandCoordinator`，并继承父命令 correlation。

### 完成状态

| 合同 | 状态 | 证据 |
|---|---|---|
| 9 mutation application route | PASS | 5 个 assignment 与 4 个 safety mutation 均要求 `AcceptedCommandContext`；普通事件调用使用注入 event port，metadata 登记 `assignment-service.*` / `safety-service.*` transaction owner。 |
| 2 safety READ query-only | PASS | `listSafetyIncidents/getSafetyIncident` 位于 `safety-query-service.ts`；无 event port、accepted context、coordinator 或业务 DML。 |
| handler 薄化 | PASS | assignment/safety handler 只做 transport、sender-bound caller、accepted context/event-port/coordinator 注入和兼容 re-export；无 `.prepare().run()`、原始 `writeEvent()` 或自行构造 coordinator。 |
| assignment 权威 target | PASS | create 从 business/assessment/current assignment/grant/runtime/auth 事实解析；confirm/start/rebind/release 从 assignment→business session→assessment→grant→runtime→auth 链解析。伪造 job hint 在 heartbeat、local-runtime 与事件写入前拒绝。 |
| local-runtime accepted child | PASS | `ensureLocalRuntimeContext` 在任何 DML 前验证父命令只能是 `assignment:create/rebind`、actor 必须是同一 ACTIVE TEACHER/ADMIN、target 类型正确且 correlation 非空；无 accepted child 的直接调用被拒绝且零写入。PASSWORD auth 不再被误当作该 runtime 的可复用 DEVICE_KEY auth。 |
| assignment owner/FSM | PASS | STUDENT confirm/start owner 检查、grant/assignment/session/runtime 一致性、rebind version/grant 替换、release 终态和 M3 delivery phase 均由原回归保持。Bus 测试额外固定 forged existing-target 与他人学生 start 在执行前拒绝。 |
| safety actor/FSM | PASS | confirm 仅 TEACHER；resolve/void/replace 仅 ADMIN。PENDING_DETAIL→CONFIRMED→RESOLVED、void、duplicate 与 factual correction 规则、replacement transaction 和原确认教师保留不变。 |
| safety 三元与熔断 | PASS | canonical safety target 来自 incident 的 `student_id + job_code + task_code + status/replacement facts`；跨 job duplicate 被拒绝，同三元 assessment/training 红线回归通过，Schema trigger 与 direct `REDLINE_HALTED` 零插入保持。 |
| coordinator/correlation | PASS | safety automation factory 接收 runtime coordinator；Bus 集成中 `SAFETY_INCIDENT_DETAIL_CONFIRMED` 与自动 `REPORT_GENERATED` 使用同一非空 correlation，void/replace intent 同样继承父 correlation。 |
| API/数据合同兼容 | PASS | 事件类型、payload、错误码、返回结构、M3/M4 Schema/trigger、shared/preload/renderer 均未改；安全报告优先级与失败后保留已确认事实的语义不变。 |

### 冻结结果

| 项目 | 结果 |
|---|---:|
| IPC channel | 74 |
| READ | 28 |
| MUTATION | 46 |
| direct-side-effect callsite | 216 |
| direct-side-effect file | 29 |
| capability callsite | 71 |
| 其中 `LEGACY_EVENT_PORT_CALL` | 43 |
| delegating root | 12 |
| 本步 legacy→active 迁移映射 | 34/34 |
| M5A-9 `MIGRATION_PENDING` | 115 |
| active inventory digest | `eac5ef3141e7e742b1608aa6f8ce01974e7106b9cee0bd0bb8af5fa83828e33c` |

active manifest 共 361 项、legacy mapping 共 376 行。本步精确迁移 34 个 owner：12 个 assignment reducer DML、5 个 local-runtime DML、10 个 assignment/safety event-port callsite、4 个 safety DML 与 3 个 safety coordinator capability；pending 相对 M5A-8 从 149 单调收缩到 115。

### 工作区检查

| 检查 | 状态 | 证据 |
|---|---|---|
| `git status --short` | PASS | assignment/safety service/query、薄 handler、runtime routing、command metadata、测试 helper/Bus 集成、scanner/updater/fixture、M4 SQL 清单和本验收记录均在计划范围；先前 dirty worktree 内容未清理或覆盖。 |
| `git diff --check` | PASS | 退出码 0。 |
| 本步未跟踪文件 whitespace | PASS | 对 3 个 service/query、3 个测试 helper/Bus 文件及 M5A-9 updater 分别执行 `git diff --no-index --check`；退出码 1 仅表示 `/dev/null` 与新文件有差异，均无 whitespace diagnostics。 |
| Schema/API path gate | PASS | `src/main/db/schema.sql`、`src/main/db/migrations.ts`、`src/shared`、`src/preload`、`src/renderer` 与 `package-lock.json` 无工作区变化。 |
| 依赖与锁文件 | PASS | 未安装依赖，`package-lock.json` 无变化。 |
| 默认运行库 | PASS | 测试使用 memory DB 与 runtime 注入 port；未打开、初始化、迁移或修改默认 `xc-career-guide.db`。 |

### 自动化检查

| 检查 | 命令 | 状态 | 证据 |
|---|---|---|---|
| M5A-9 精确测试组 | implementation plan 指定的 assignment、local runtime、safety、assessment/training redline、report integration 与 M4 schema 测试 | PASS | 7 files，59/59 tests。 |
| M5A-9 Bus 与清单组 | `npm test --` assignment-safety Bus、M5A inventory、M4 SQL inventory | PASS | 3 files，19/19 tests；覆盖 9 mutation metadata、实际 assignment/safety lifecycle、伪造 target、角色、local-runtime accepted child、coordinator identity 与 report correlation。 |
| 全部 handler 回归 | `npm test -- src/main/ipc/handlers` | PASS | 32 files，450/450 tests；唯一 stderr 是既有坏 JSON 容错用例的预期诊断。 |
| central/runtime 组合根 | `npm test -- src/main/application/runtime/__tests__/application-runtime.test.ts src/main/ipc/__tests__/handler-registry.test.ts` | PASS | 2 files，13/13 tests；74 channel 集合、coordinator identity、runtime 生命周期与 central registration 通过。 |
| scanner 定向测试 | `npm test -- scripts/__tests__/m5a-command-boundary-inventory.test.mjs` | PASS | 1 file，8/8 tests；固定 M5A-9 的 29 direct files、12 roots、71 capabilities、43 event-port calls 与 pending=115。首次运行准确发现测试仍停留在 M5A-8/149，更新阶段断言后通过。 |
| M4 safety SQL 清单测试 | `npm test -- scripts/__tests__/multi-device-m4-safety-sql-inventory.test.mjs` | PASS | 1 file，8/8 tests。首次门禁发现 safety target 新投影字段及 7 条 service/query 路径迁移；同步 `M4-SQL-038`～`044/050` 路径与指纹后通过，分类保持不变。 |
| M4 safety SQL target gate | `npm run contract:m4:safety-sql:check` | PASS | 52 hits：aggregate 9、incident primary-key 20、student-wide 3、non-safety 20。 |
| M5A-9 migration gate | `npm run contract:m5a:command-boundary:check -- --mode migration --step M5A-9` | PASS | 74/28/46、29 direct files、12 roots、pending=115，active digest 精确一致。 |
| legacy baseline gate | `npm run contract:m5a:command-boundary:check -- --mode baseline` | PASS | 规划基点 74/28/46、35 files、5 roots及 digest `90391b52...79d7483` 未漂移。 |
| target 预期负向 | `npm run contract:m5a:command-boundary:check -- --mode target` | PASS（负向） | 退出码 1，明确拒绝 `115 MIGRATION_PENDING`；未把预期失败声明成 target 已通过。 |
| 类型检查 | `npm run typecheck` | PASS | `vue-tsc --noEmit` 与 `tsc --noEmit -p tsconfig.node.json` 退出码 0。 |
| 定向 lint | `eslint` 覆盖本步 service/query/handler、command definitions、测试 helper 与 Bus 测试 | PASS | 退出码 0，无输出。 |
| 全量 lint | `npm run lint` | PASS | 退出码 0；0 errors、661 个既有 warnings，其中 396 个可自动修复。本步不声称零 warning。 |
| 生产构建 | `npm run build` | PASS | Electron main、preload、renderer 三段构建全部完成。 |
| MJS 语法 | `node --check` command-boundary gate 与 M5A-9 updater | PASS | 两条命令退出码均为 0。 |
| 文档索引 | `npm run docs:index:check` | PASS | `doc/index.md is current`。 |

### 不变量与副作用审计

| ID / 项目 | 状态 | 证据 |
|---|---|---|
| `INV-IPC-001`～`002` | PASS | 74 channel、唯一 central registration、preload/shared API 均未变；assignment/safety handler 无写入旁路。 |
| `INV-EVT-001`～`003` | PASS | 事件类型/payload/顺序未改；assignment 继续 event→reducer，safety lifecycle 继续原 DML/F7 reducer 路径，59 项精确测试和 450 项 handler 回归通过。 |
| `INV-SAFE-001`～`004` | PASS | safety target 与 duplicate 校验使用持久化完整三元键；assessment/training 同三元熔断、跨 job 隔离及 52 条 SQL 清单通过。 |
| `INV-AUTH-001`～`002` | PASS | actor/caller 来自 sender-bound accepted context；assignment 学生 owner、TEACHER/ADMIN 与 local runtime actor 一致性均在写入前验证。 |
| `INV-RES-001`～`002` | PASS | safety report generation、void/archive、factual correction/supersede 与报告安全优先级保持；自动报告 correlation 继承父命令。 |
| `INV-DATA-003` | PASS | 无 Schema/migration/默认运行库变化。 |
| 跨文件登记 | PASS | runtime child owner、student owner、grant/runtime/session target、safety status/triple、coordinator identity、correlation 与 34/34 mapping 均有自动化证据。 |

### 人工验收

`NONE`。本步没有 renderer/UI 变化；assignment、权限、安全 FSM、报告自动化、三元熔断和事务兼容由自动化测试覆盖。

### 未执行项

- 仓库全量 `npm test`：`NOT_RUN`；本步已运行 59 项精确测试、19 项 Bus/清单、450 项全部 handler 与 13 项 central/runtime，M5A-11 再执行仓库全量测试。
- Electron GUI smoke、E2E、`npm run db:verify`：`NOT_RUN`；本步无 UI 或 Schema 变化，最终里程碑统一执行适用检查。
- target mode：已作为负向运行并按预期拒绝；真正 target PASS 要等 `MIGRATION_PENDING=0`。

### 下一步

进入 Step M5A-10：迁移 reports、task closure、report export/error/file publication 等剩余 runtime command/capability 路径，保持 F7 coordinator 单例、文件发布边界、恢复语义与报告合同不变。

## Step M5A-10 — reports、task closure 与 export publication

### 结论

`PASS`

- 模式：`/vibe-accept step M5A-10`
- 风险：R3 里程碑中的报告命令边界、任务闭环、单例协调器与文件发布故障矩阵
- 前置：Step M5A-9 `PASS`
- 验收日期：2026-07-29

本步把 reports 的 6 个 mutation 迁入 application service，把 3 个 READ 迁入纯 query service。任务闭环、三类报告生成、审核/锁定、导出事件与失败记录均接收 Command Bus 生成的 accepted context；reports、safety、JOB_SKILL automation 共用 application runtime 的同一 `ReportCommandCoordinator`。导出流程显式区分临时文件、最终文件、JSONL 与 SQLite 的非原子边界，并仅清理由本命令 owner token 标识的临时 artifact。

### 完成状态

| 合同 | 状态 | 证据 |
|---|---|---|
| 6 mutation application route | PASS | `confirmBaseTaskClosure/replaceBaseTaskClosure/generateReport/reviewReport/lockReport/exportReport` 均要求 `AcceptedCommandContext`，并在业务执行前核对 command type、actor、非空 correlation 与权威 target。 |
| 3 READ query-only | PASS | `listReports/getReport/listReportGenerationCandidates` 位于 `reports-query-service.ts`；不持有 accepted context、event port、coordinator 或写入 capability。 |
| handler 薄化 | PASS | reports handler 只做 transport、sender-bound auth、Electron save dialog 与 service/query 委派；无业务 DML、原始事件写入或自行构造 coordinator。 |
| task closure owner | PASS | confirm/replace 两个 callsite 各有 command metadata、权威三元 target 与测试证据；`TaskClosureService` 强制继承非空父 correlation。 |
| 三类 report target | PASS | BASE 从 task closure、JOB_SKILL 从 result/session、SAFETY 从 incident 解析持久化 `student_id + job_code + task_code`，再与 accepted canonical target 比对。 |
| runtime coordinator 单例 | PASS | reports service factory 暴露的 coordinator identity 与 application runtime 相同；runtime 测试同时固定 reports、safety、JOB_SKILL automation 共用该实例。 |
| correlation 透传 | PASS | task closure、report generate/review/lock、export success/failure 与 F7 intent 全部继承 command envelope correlation；47 项精确测试及 Bus 测试覆盖。 |
| 文件发布故障矩阵 | PASS | rename、JSONL append、SQLite projection、cleanup 失败均返回显式失败；已存在 final target 拒绝覆盖；rename 后不删除 final artifact；cleanup 仅作用于 owner-token temp path。 |
| 发布内容与脱敏 | PASS | hash 基于实际落盘 bytes；错误上下文继续经 scrubber 脱敏；报告 schema-v2、内容合同、导出 HTML 格式与 IPC 响应未改。 |
| F7 recovery/write gate | PASS | coordinator、report integration、write-gate 与 generation 回归通过；合法 JSONL 前缀、投影恢复及幂等语义保持。 |

### 冻结结果

| 项目 | 结果 |
|---|---:|
| IPC channel | 74 |
| READ | 28 |
| MUTATION | 46 |
| direct-side-effect callsite | 214 |
| direct-side-effect file | 28 |
| capability callsite | 72 |
| delegating root | 13 |
| 本步 legacy/new-active mapping | 40 |
| M5A-10 `MIGRATION_PENDING` | 76 |
| active inventory digest | `ccfb8f4c43d01a65b87157ee4ae6a20e0e76a00cfe5353fa06e8387c6ce14db3` |

active manifest 共 360 项、mapping 共 377 行。本步新增 1 条 application-service owner mapping，并迁移 report/task-closure/export 相关 legacy owner，使 pending 相对 M5A-9 从 115 单调收缩到 76；剩余 76 项全部标记为 Step M5A-11 的 infrastructure/compatibility 收口项，不含本步业务 pending。

### 工作区检查

| 检查 | 状态 | 证据 |
|---|---|---|
| `git status --short` | PASS | reports service/query、薄 handler、domain correlation/export 边界、command metadata、测试、scanner fixture/updater、M4 SQL 清单及本验收记录均在计划范围；先前 dirty worktree 内容未清理或覆盖。 |
| `git diff --check` | PASS | 退出码 0。 |
| 本步未跟踪文件 whitespace | PASS | 对 6 个新增 service/query/test/updater 文件逐一执行 `git diff --no-index --check`；退出码 1 仅表示与 `/dev/null` 有内容差异，均无 whitespace diagnostics。 |
| Schema/API path gate | PASS | `src/main/db/schema.sql`、`src/main/db/migrations.ts`、`src/shared`、`src/preload`、`src/renderer` 与 `package-lock.json` 无工作区变化。 |
| 依赖与锁文件 | PASS | 未安装依赖，`package-lock.json` 无变化。 |
| 默认运行库 | PASS | 测试使用 memory DB、临时 JSONL 与临时导出目录；未打开、初始化、迁移或修改默认 `xc-career-guide.db`。 |

### 自动化检查

| 检查 | 命令 | 状态 | 证据 |
|---|---|---|---|
| M5A-10 精确测试组 | implementation plan 指定的 reports、export、integration、task closure、coordinator、write gate、generation 测试，并补充 reports Bus/runtime identity 测试 | PASS | 10 files，47/47 tests；覆盖 6 mutation、3 read、权威 target、同 correlation、共享 coordinator 与文件发布故障矩阵。 |
| scanner 定向测试 | `npm test -- scripts/__tests__/m5a-command-boundary-inventory.test.mjs` | PASS | 1 file，8/8 tests；固定 M5A-10 的 28 direct files、13 roots、72 capabilities、pending=76 与 active digest。 |
| M4 safety SQL 清单测试 | `npm test -- scripts/__tests__/multi-device-m4-safety-sql-inventory.test.mjs` | PASS | 1 file，8/8 tests。首次门禁发现 reports query relocation 与 report source resolver 重命名；仅同步 `M4-SQL-020/036/037` 路径、symbol 和指纹，查询语义及总数未改。 |
| M4 safety SQL target gate | `npm run contract:m4:safety-sql:check` | PASS | 52 hits：aggregate 9、incident primary-key 20、student-wide 3、non-safety 20。 |
| M5A-10 migration gate | `npm run contract:m5a:command-boundary:check -- --mode migration --step M5A-10` | PASS | 74/28/46、28 direct files、13 roots、pending=76，active digest 精确一致。 |
| legacy baseline gate | `npm run contract:m5a:command-boundary:check -- --mode baseline` | PASS | 规划基点 74/28/46、35 files、5 roots及 digest `90391b52...79d7483` 未漂移。 |
| target 预期负向 | `npm run contract:m5a:command-boundary:check -- --mode target` | PASS（负向） | 退出码 1，明确拒绝 `76 MIGRATION_PENDING`；未把预期失败声明成 target 已通过。 |
| 仓库全量测试 | `npm test` | PASS | 127 files，1166/1166 tests；包含 handler、domain、scanner、migration、renderer 与内容工具回归。 |
| 类型检查 | `npm run typecheck` | PASS | `vue-tsc --noEmit` 与 `tsc --noEmit -p tsconfig.node.json` 退出码 0。 |
| 定向 lint | `eslint` 覆盖本步 service/query/handler/domain/test 文件 | PASS | 退出码 0，无输出。 |
| 全量 lint | `npm run lint` | PASS | 退出码 0；0 errors、661 个既有 warnings，其中 396 个可自动修复。本步不声称零 warning。 |
| 生产构建 | `npm run build` | PASS | Electron main、preload、renderer 三段构建全部完成。 |
| MJS 语法 | `node --check scripts/update-m5a10-command-boundary-fixtures.mjs` | PASS | 退出码 0。 |
| 文档索引 | `npm run docs:index:check` | PASS | `doc/index.md is current`。 |

### 不变量与副作用审计

| ID / 项目 | 状态 | 证据 |
|---|---|---|
| `INV-IPC-001`～`002` | PASS | 74 channel、唯一 central registration、preload/shared API 均未变；reports handler 无 direct writer。 |
| `INV-EVT-001`～`003` | PASS | F7 event type/payload/schema-v2 与 reducer 顺序未改；任务闭环、报告事件、恢复与幂等回归通过。 |
| `INV-SAFE-001`～`004` | PASS | SAFETY source 使用 incident 主键与持久化三元 target；M4 52 条 SQL target gate 通过。 |
| `INV-AUTH-001`～`002` | PASS | actor 来自 sender-bound accepted context；教师/管理员权限及 target mismatch 在副作用前拒绝。 |
| `INV-RES-001`～`002` | PASS | task-closure lineage、报告优先级、write gate、repair/lock/export 规则与报告合同保持。 |
| `INV-DATA-003` | PASS | 无 Schema/migration/默认运行库变化。 |
| 文件所有权边界 | PASS | 文件系统与 SQLite 未被描述为原子；失败只清理本命令临时文件，不覆盖或删除其他 artifact。 |

### 人工验收

`NONE`。本步没有 renderer/UI 变化；报告读写、任务闭环、权限、文件发布与恢复语义均有自动化证据。

### 未执行项

- Electron GUI smoke、M4 E2E 与隔离 DB gate：`NOT_RUN`；这些是 Step M5A-11 的最终里程碑门禁，本步不由 build 推断通过。
- target mode 已作为负向运行并按预期拒绝；真正 target PASS 要等 Step M5A-11 将 infrastructure/compatibility pending 清零。

### 下一步

进入 Step M5A-11：关闭剩余 76 个 infrastructure/compatibility bypass，移除迁移 allowlist，新增固定规划基点的四层 scope gate 与隔离 DB gate，执行 target/full/Electron 门禁并完成独立 code review 和最终验收。

## Step M5A-11 — 关闭 bypass、独立代码审查与里程碑最终验收

### 结论

`PASS / ACCEPTED_STEP_2B`

- 模式：`/vibe-review code` 后执行 `/vibe-accept step M5A-11 / Step 2B`
- 风险：R3
- 规划基点：`40541c82ef374f28ce300365e0e5cc82423dd99a`
- 验收日期：2026-07-29
- 独立审查：`doc/features/m5a-command-bus-boundary-code-review.md`，最终未关闭 P0/P1/P2 均为 0
- 默认运行库：未检查、读取、初始化或修改；所有 DB、JSONL、Electron userData、导出与截图见证使用显式 `/tmp` 隔离根

### 最终冻结结果

| 项目 | 结果 |
|---|---:|
| IPC channel | 74 |
| READ / MUTATION | 28 / 46 |
| active direct callsite / file | 215 / 28 |
| active capability callsite / delegating root | 72 / 13 |
| active manifest entry | 361 |
| mapping entry | 378 |
| `MIGRATION_PENDING` | 0 |
| registered exception | 76（`TEST_ONLY=29`、`MIGRATION_INTERNAL=47`） |
| active inventory digest | `f97ef382ab9a9678ab20f06310e6906e811cdd765526d69a4fcc11bca6939527` |

76 项不是可跳过的 migration allowlist。每项都冻结 `exception_kind/reason`、actor、phase、transaction owner、retry policy 与 test evidence；production test-only import、handler side effect、composition root 外 coordinator 构造和漏登记 capability 均由负向测试失败关闭。

### 最终门禁

| 检查 | 状态 | 证据 |
|---|---|---|
| M5A target scanner | PASS | `npm run contract:m5a:command-boundary:check`：74 channels（28 READ / 46 MUTATION）、28 direct files、13 roots、pending=0、registered exceptions=76。 |
| 固定基点 scope gate | PASS | committed=0、index=0；working tree 62 项、untracked 91 项全部输出供审查；四层 restricted changes 均为 0。禁止集合含 Schema、production migration/startup/backup、shared、preload、renderer 与 lockfile。 |
| scanner/scope/isolated helper 测试 | PASS | 9/9、9/9、5/5；覆盖 malformed ID、旁路、固定基点 committed/index/worktree/untracked 与失败证据根。 |
| 隔离 content-pack DB | PASS | `db:m5a:isolated:verify` 使用 `/tmp/svets-m5a-isolated-db-rDnvf1/data/xc-career-guide.db`；schema `0.1.17-multi-device-m4-safety-rekey`，pack `2026.07.22.1`，hash `97368c4788e54c8693ff2daf5aceaea9f679a8f261f38a73d645a0f41c8af85d`；PASS 后临时根已删除。 |
| 类型检查 | PASS | `npm run typecheck` 退出码 0。 |
| lint | PASS | `npm run lint` 退出码 0；0 errors、661 个既有 warnings，其中 396 个可自动修复；不声称零 warning。 |
| 全量测试 | PASS | `npm test`：129/129 files、1182/1182 tests。首次运行只有新审查文档导致 `doc-index.test` 1 项失败；执行索引更新后完整复跑全通过，未掩盖首次 FAIL。 |
| 生产构建 | PASS | `npm run build`：Electron main、preload、renderer 全部构建完成。 |
| M4 SQL inventory | PASS | 52 hits：aggregate 9、incident primary-key 20、student-wide 3、non-safety 20。 |
| M4 DB migration/backup | PASS | `db:m4:verify`：7/7 files、36/36 tests。 |
| 原生 SQLite/Electron | PASS | Electron 41.9.1、Node ABI 145、SQLite 3.53.2；fresh/migration/hash/integrity/query-plan/backup/restore/preflight 均通过。 |
| M4 Electron UI | PASS | 临时 userData `/tmp/svets-m4-ui-29c93R`；跨 job 隔离、同三元熔断与 duplicate replacement 通过，脚本退出时删除隔离根。 |
| 报告 Electron E2E | PASS | 见证根 `/tmp/svets-report-e2e-WKOwT8`；1366×768、1280×720、375×812，锁定、脱敏导出、越权拒绝和重启恢复全部通过。 |
| 文档索引 | PASS | `docs:index:update` 后 `docs:index:check` 为 current；全量 `doc-index.test` 同步通过。 |

### 独立代码审查闭环

| Finding | 初始状态 | 最终状态 | 关闭证据 |
|---|---|---|---|
| 报告导出 `exists + rename` 可在 TOCTOU 下覆盖新建目标 | P1 | CLOSED | 同目录 `linkSync + unlinkSync` no-clobber 发布；新增竞态测试，报告导出 10/10 tests PASS。 |
| `ACTIVE-CAP-NaN` 未被 fixture validator 拒绝 | P2 | CLOSED | active/legacy/mapping ID 正则 fail closed；inventory 9/9 tests PASS。 |
| 报告 E2E 缺权威 safety source 且使用非法 phase | P2 | CLOSED | 补齐 v1 created/confirmed + F7-v2 generated 事件链与投影；三视口 Electron E2E PASS。 |

### 不变量与范围裁决

- `INV-EVT-001`～`003`：领域状态仍由既有事件/reducer 推进；M5A 只统一命令入口和 correlation，不改变 legacy JSONL/F7 payload/recovery 语义。
- `INV-SAFE-001`～`004`：权威 target 继续使用 `student_id + job_code + task_code`；M4 SQL、DB、原生与 UI 门禁全部 PASS。
- `INV-AUTH-001`～`002`：actor 只来自 sender-bound snapshot；READ 无 heartbeat，拒绝路径无 DB/file/binding 副作用。
- `INV-RES-001`～`002`：评分类型、任务闭环、报告优先级、锁定/导出/修复合同保持。
- `INV-IPC-001`～`002`：74 channel 与 public preload/shared/renderer 合同未改。
- `INV-DATA-003`：无 Schema、production migration、默认 DB 或依赖锁文件变化。
- M5A 没有实现 durable idempotency、batch、hash chain、fencing 或 v2.2 `startupRecovery`；这些明确转交 Step 2C / M5B。

### 下一步

以本步最终 74/28/46 registry、361 项 active mutation/writer manifest、76 项注册例外和 legacy v1/F7-v2 事实边界为输入，重新基线 `doc/features/event-batch-v2.2-runtime-prd.md`，执行独立 R3 `/vibe-review`；通过后才进入 `/vibe-impl`。不得直接把 M5A runtime trace、exception manifest 或 correlation 当成 M5B `command_log`/batch 协议。
