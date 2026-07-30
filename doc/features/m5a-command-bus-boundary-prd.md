# M4 Step 2B / M5A Command Bus Boundary Mini-PRD

## 1. 文档状态

- 状态：`ACCEPTED_STEP_2B`（M5A-1～M5A-11 已完成；独立代码审查与最终 `/vibe-accept` 均为 `PASS`）
- 风险等级：`R3`
- 日期：2026-07-28
- 本轮修订依据：`doc/features/m5a-command-bus-boundary-r3-rereview.md` 的 `M5A-R3-01`～`M5A-R3-04`，以及 `doc/features/m5a-command-bus-boundary-r4-rereview.md` 的 `M5A-R4-01`。历史 R3/R4 finding 与候选收口原文保留；最终实现审查见 `doc/features/m5a-command-bus-boundary-code-review.md`。
- 定义范围：当前 Electron Main 进程内的 Command Bus / mutation boundary；实现未修改 Schema、默认数据库、shared/preload/renderer API，也未执行 commit、push、merge 或发布。
- 当前前置：M4 Step 2A 已 `PASS / CLOSED`，当前 Schema 基线为 `v0.1.17-multi-device-m4-safety-rekey`。[!] `doc/features/multi-device-m4-m5-prd.md` 和 `doc/features/multi-device-m4-m5-impl.md` 仍有历史基线表述，只作为路线/历史输入，不作为本 Mini-PRD 的事实来源。
- [!] 权威架构文档 §0.4/§10.2 仍描述“当前无冷启动重放”，但当前 `src/main/db/connection.ts:72` 已调用 `recoverActionLog()`，且 `src/main/domain/recovery.ts`、`src/main/domain/legacy-upgrade-recovery.ts` 已存在 legacy reconciliation/recovery 路径。本 PRD 将代码现状登记为 M5A 的 `LEGACY_STARTUP_RECOVERY` 内部写入口；不把它误称为 v2.2 `startupRecovery`，也不在 M5A 改写该恢复协议。
- 权威依据：
  - `doc/specs/baseline.yaml`
  - `doc/specs/project-invariants.md`
  - `doc/ai/vibe-workflow-contract.md`
  - `doc/specs/MVP_PRD_v1.0.9-authoritative.md`
  - `doc/specs/architecture-plan-b-multi-device-v2.2-authoritative-baseline.md` §0.4、§2.3、§10.1-10.2、§11、§12、§14.5
  - `doc/features/multi-device-m4-safety-rekey-validation.md`
  - `doc/features/base-ability-42plus8-pilot-readiness-impl.md` Step 2A-2C 边界登记

## 2. 问题与目标

### 当前行为

- 当前写入口主要由各功能 handler 自己完成鉴权、参数校验、事务编排、`writeEvent()` 调用和 reducer/projector 调用；`src/main/domain/event-writer.ts:60-123` 仍是单事件 JSONL + `domain_event_projection` 双写。
- 当前 `src/main/ipc/handlers/` 有 74 个 `ipcMain.handle()` 注册点，写入路径分散在 auth、student、strategy、assessment、training、assignment、safety、scoring、observation 和 report 等模块。
- `src/main/ipc/index.ts:18-33` 只负责逐模块注册；大多数 handler 直接拥有传输层和领域写入边界。 `ReportCommandCoordinator` 已存在局部业务串行协调，但不是全局 Command Bus。
- 当前没有已注册的 HTTP、CLI 或后台业务 mutation transport，但启动恢复事件写入、策略 lazy seed 等非 IPC 副作用仍存在；未来 HTTP 与 IPC 汇入同一 Command Bus 是权威架构方向，但 HTTP/utilityProcess 不属于本阶段实现范围。

### 用户与工程问题

同一套业务写入规则分散在多个入口，后续接入教师 HTTP、后台任务和 Local Server 时容易出现权限、事件顺序、错误映射和事务边界漂移。若直接在 M5B 接入 batch runtime，现有 handler 和 writer 会再次迁移，扩大 R3 故障面。

### 目标行为

在当前 Electron Main 进程内建立唯一的应用命令入口：IPC 只负责传输层解析、认证上下文绑定和结果/错误映射；Command Bus 负责命令分类、统一 envelope、应用服务分派和 mutation capability；领域命令负责业务前置条件、事件意图和投影调用；底层 legacy writer 通过可替换的 mutation port 接入。

M5A 完成后，现有 IPC 的业务响应语义和 legacy JSONL/event envelope 保持不变，但所有生产 mutation 都必须有可观测的命令类型、actor、target、request hash 和来源，并且不能绕过统一 boundary 直接写数据库、文件或业务投影。M5A 只承诺运行时命令追踪和既有事件 `correlation_id` 关联，不承诺持久化 command audit 或跨重启幂等。

### 成功定义

1. 当前 74 个 IPC handler 均完成 `READ`/`MUTATION` 唯一分类，并另列 startup/migration/recovery/seed/auth-session-maintenance/report-file 等非 IPC mutation；分类以实际 DB/file side effect 为准。所有业务 mutation 经过 Command Bus，启动与基础设施写入经过显式登记的内部 capability；只有无任何副作用的命令进入 read registry。
2. Command Bus 可拒绝未知命令、缺失/无效 actor、非法 target、未初始化 boundary 和参数合同错误；拒绝前只允许静态检查与纯读快照/target 查询，不得 seed、更新 `auth_session`、写 `error_event_log`、追加 JSONL、创建目录或产生其他 DB/文件副作用。
3. 现有 assessment/training/assignment/safety/scoring/report 的成功结果、错误码和领域事件语义不变；多事件命令只承诺当前调用返回时 SQLite `domain_event_projection` 与 reducer/projector 写入处于同一事务、成功则一起提交、失败则一起回滚。已成功 append 的 JSONL 前缀不可回滚，且 legacy recovery 不提供命令级全有或全无。
4. M5A 不新增 batch record、`command_log`、segment、hash-chain、startupRecovery 或 HTTP/utilityProcess；这些属于后续 M5B/Step 2C 的独立 R3 范围。
5. 有一份可复核的 mutation inventory、command registry、writer callsite 静态门禁和定向回归证据，证明没有生产 bypass；命令元数据的可观测性通过运行时日志和既有事件 `correlation_id` 实现，不声称 M5A 已提供持久化 command audit 或跨重启幂等。

## 3. 用户角色与权限

| 主体 | M5A 行为 | 约束 |
|---|---|---|
| STUDENT | 通过既有 assessment/training/assignment 允许的 IPC 发起命令 | actor 必须由 Main 根据 sender 绑定的 ACTIVE `auth_session` 解析；请求体中的 caller 字段只作兼容性比对，不得作为权限来源 |
| TEACHER | 执行既有测评、训练、线下评分、观察和安全事件操作 | 必须使用 sender-bound trusted auth context；现有 TEACHER 规则和安全事件确认/触发边界不得放宽 |
| ADMIN | 执行既有管理和安全终结操作 | `INV-AUTH-001` 继续约束 RESOLVED/VOIDED 等终结操作；actor 不能由请求体自授权 |
| AUTH bootstrap | 登录、首次绑定等尚无用户会话的明确命令 | 仅允许 registry 标为 `BOOTSTRAP` 的命令；actor 使用显式 `UNAUTHENTICATED` context，不能调用普通 authenticated mutation capability |
| SYSTEM / startup | schema 初始化、migration、legacy recovery、seed 和 auth-session maintenance | 仅允许带固定 phase、调用方和 capability 的 `INTERNAL` 命令/受控例外；不得伪装成用户 actor |
| 未来 HTTP/后台 worker | 本阶段只登记 transport slot，不实现 | 必须复用同一 Command Bus；不得新增旁路写入口 |

Command envelope 中的 actor 是主进程解析后的可信上下文快照，不是产品请求正文的权限声明。Command Bus 不重新定义现有业务授权矩阵；无法映射到当前 caller/role 规则的命令必须失败关闭。

## 4. 核心场景

### M5A-01：IPC mutation 进入统一边界

**Given** 学生或教师通过现有 preload IPC 发起一个已登记 mutation，且认证上下文、target 和 payload 合法；

**When** IPC adapter 构造 `CommandEnvelope` 并调用 Command Bus；

**Then** Bus 将命令交给对应 application service，service 通过 mutation port 调用当前 legacy writer/reducer/projector；IPC 返回原有结果结构，且不产生第二份事件或直接写投影。

### M5A-02：读取路径不被伪装为写命令

**Given** 一个 list/get/report-read 请求；

**When** 请求通过 read registry；

**Then** 只执行无 DB/file side effect 的查询，不取得 mutation capability，不调用 Command Bus 的写入执行器，也不触发 lazy seed、auth-session heartbeat 或其他副作用。当前会写 `last_activity_at`/session status 的 resolver 必须拆出无写入 trusted-context snapshot；其写入部分只能进入 post-accept maintenance 或独立 sweep，不得把尚未拆分的调用链登记为 `READ`。

### M5A-03：权限和合同失败关闭

**Given** command type 未登记、actor 缺失/失效、target 不匹配、payload 校验失败或 boundary 尚未初始化；

**When** 请求进入 Bus；

**Then** 按“静态 registry/boundary 检查 → payload 结构校验 → 无写 sender-bound auth snapshot → 纯读权威 target 解析与 hint 比对”的顺序返回稳定错误映射；不得调用 lazy seed、auth heartbeat/过期/撤销持久化、`error_event_log`、`writeEvent()`、目录创建、文件追加或 reducer/projector，也不得修改 sender token binding。

### M5A-04：安全红线继续由事件链和当前三元键推进

**Given** 教师触发安全事件；

**When** `safety` mutation 经 Command Bus 进入现有事件写入路径；

**Then** 保持 `student_id + job_code + task_code` 聚合，SQLite 触发器继续先熔断开放 assessment/training，再完成后续归因；不得由 Bus 直接 INSERT `REDLINE_HALTED`。

### M5A-05：现有多事件 SQLite 事务不被拆开

**Given** operation scoring、BASE_ABILITY/JOB_SKILL 线下评分、结果终结或 assignment 路径需要多个事件和多个 reducer；

**When** 命令通过 Bus 执行；

**Then** 仍由一个 application command 保持当前调用内 SQLite `domain_event_projection` 与 reducer/projector 的事务原子性；M5A 不把 SQLite 写入拆成逐事件独立提交。若第 N 个事件已 append JSONL、随后 projection/reducer 失败，SQLite 事务整体回滚但 JSONL 合法前缀保留；`correlation_id` 只提供追踪，不把该前缀升级为可原子恢复的 batch。

### M5A-06：未来 transport 复用同一应用服务

**Given** 后续 HTTP 或后台 transport 需要调用同一业务 mutation；

**When** 它提供等价的可信 actor/context 和 envelope；

**Then** 只能调用已登记 Command Bus handler，不复制业务逻辑；本阶段不实现 HTTP、SSE 或 worker。

### M5A-07：启动和内部写入口不绕过边界

**Given** 启动恢复、迁移、pre-boundary error-code seed 或其他内部服务需要写 DB、JSONL 或配置文件；

**When** 该路径被注册到 mutation inventory；

**Then** 它必须使用明确的内部 capability/command context，或被记录为只允许在 startup/recovery 专用阶段执行的受控例外；普通 IPC read、业务 handler 和未登记模块不能调用该写入口。

### M5A-08：报告文件与事件边界可回归

**Given** 报告生成、报告导出或 job-skill 自动化需要写 HTML 文件、报告投影、事件或 `error_event_log`；

**When** 该操作进入统一报告 mutation adapter；

**Then** 同一 data root 只使用 composition root 注入的一个 `ReportCommandCoordinator` 实例，报告业务 key 串行化继续有效；文件临时写入、校验、最终 rename、事件事务和失败记录的先后顺序及部分失败矩阵必须显式登记和测试，不得宣称文件系统与 SQLite 原子提交，也不得由每次 IPC/自动化调用新建 coordinator 绕过该边界。

### M5A-09：target 由权威事实解析

**Given** mutation 只携带 `sessionId`/`incidentId`/`assignmentId` 等定位 ID，或兼容输入同时携带 `student_id/job_code/task_code` hint；

**When** registry 指定的 `target_resolver` 执行；

**Then** resolver 只用 SELECT 从对应 aggregate 及其受约束关联记录解析 canonical target；客户端字段只作候选输入或 compare-only hint。记录不存在或任一 hint 与权威事实不一致时，在计算 `request_hash` 和取得 mutation capability 前拒绝。创建型命令必须逐字段登记“已验证 payload 候选值”与“关联记录权威值”，完成外键/策略/父会话一致性查询后才形成 target。

### M5A-10：拒绝请求不触发鉴权维护或 seed

**Given** 未知命令、非法 payload、无效/过期/禁用会话、target 不存在或 mismatch；

**When** 请求未越过 `ACCEPTED` 边界；

**Then** sender-bound session 只以无写快照判定，错误码 seed 已在 boundary 对外 ready 前由 startup capability 完成；该请求不得刷新 `last_activity_at`、持久化 `EXPIRED/REVOKED`、写登录/异常审计或补 seed。过期/禁用状态持久化由独立 `AUTH_SESSION_SWEEP` 内部维护处理，mutation heartbeat 只能在命令被接受后执行；纯 READ 永不 heartbeat。

## 5. 范围

### 本次包含

1. 定义并实现计划化的运行时合同：`CommandEnvelope`、`CommandType`、actor/context、target、payload、`request_hash`、`created_at`、transport source 和结果/错误映射边界。
2. 建立 `CommandBus`、command registry、application service / mutation boundary 和只读 registry 的模块职责；具体文件路径在 `/vibe-impl` 根据当前代码再次冻结。
3. 将当前所有 IPC 注册点建立机器可读 inventory，唯一分类为 `READ` 或 `MUTATION`。每个 MUTATION 必须登记权限、actor policy、`target_resolver`/resolver owner/权威字段来源/client hint/mismatch 与 not-found 映射、payload contract、side effects、事件/投影影响、phase、事务 owner、retry policy、concurrency policy、现有结果类型和 test reference；同时登记 startup/recovery/migration/seed/auth-session maintenance/local runtime context/report file 与错误记录/automation fallback 等非 IPC 写入口，不能以“不是 IPC”排除。每个 `writeEvent()`、受控 projection/DB/file writer callsite 必须命中一条 inventory 记录。
4. 让 IPC handler 成为薄 adapter：解析/校验输入、绑定可信 actor、调用 Bus、映射结果；不得直接调用低层 writer 或直接更新受控业务状态。
5. 以 adapter 形式保留当前 legacy writer：M5A 不改变 JSONL bytes、`ActionLogEntry` v1/F7-v2、事件类型、reducer 语义或 current transaction behavior；M5B 再替换为权威 batch coordinator。
6. 为 safety、assessment、training、assignment、operation scoring、ability scoring、job-skill scoring、observation 和 reports 建立跨模块命令映射及 bypass 静态测试。
7. 为同一 data root 建立单一 composition-root capability 传递约束；低层 mutation port 不允许由 renderer、普通 read handler 或未经 registry 的模块自行构造。`ReportCommandCoordinator`、report automation 和 safety/report fallback 必须共享该 composition-root 实例；startup/recovery/migration/seed/auth maintenance/file publication 专用例外必须有阶段、调用方、actor policy、事务 owner 和副作用清单。
8. 为命令 envelope、权威 target 解析、拒绝前 auth/seed 零副作用、未知命令、命令映射、read 无副作用、现有响应兼容、多事件 SQLite 回滚与 JSONL 前缀恢复事实、报告文件失败矩阵和 M4 三元安全聚合补齐测试/验证入口。

### 初始写入口登记（实现前必须冻结为机器可读 fixture）

以下是基于 2026-07-28 当前代码的初始边界登记；它不是“只审查 IPC”的摘要。`phase`、事务 owner 和 retry policy 是强制字段，不能留到编码时自由解释：

| 当前路径/入口族 | 已确认副作用 | Boundary mode / actor policy | Phase | 事务 owner / retry policy | Test reference |
|---|---|---|---|---|---|
| `src/main/ipc/handlers/{ability-scoring,assessment,assignment,job-skill-result,job-skill-scoring,observation,operation-scoring,safety,training}.ts` | `writeEvent()`、reducer/projector、session/assignment/safety/result DML；含多事件评分与 redline 链 | `BUS_COMMAND → LEGACY_MUTATION_ADAPTER`；sender-bound `USER`，按既有角色规则 | `RUNTIME_ACCEPTED` | 原 application command 的既有 `db.transaction()`；逐命令 `NO_AUTO_RETRY`/现有 guard | 现有对应 handler/domain tests + planned `command-registry.test.ts`、`command-bypass.test.ts` |
| `src/main/ipc/handlers/auth.ts`、`src/main/utils/auth-session.ts` 的登录、退出、账号维护与审计 | INSERT/UPDATE `auth_session`/`user_account`，撤销会话，INSERT `error_event_log` | 登录为 `BUS_COMMAND/BOOTSTRAP`；退出为 sender-bound USER；账号维护为 ACTIVE ADMIN | `RUNTIME_ACCEPTED`；不得在 transport preflight 执行 | auth application command 保留当前事务/非原子审计矩阵；`NO_AUTO_RETRY` | `src/main/ipc/handlers/__tests__/auth.test.ts` + planned preflight test |
| `src/main/ipc/handlers/student.ts` | INSERT/UPDATE `user_account`/`student_profile`，INSERT `error_event_log` | `BUS_COMMAND`；sender-bound ACTIVE TEACHER/ADMIN | `RUNTIME_ACCEPTED` | 原 create/update/archive command；`NO_AUTO_RETRY` | `student-create.test.ts`、`student-mutate.test.ts`、`student-read.test.ts` |
| `src/main/ipc/handlers/strategy.ts` | INSERT/UPDATE `strategy_config`，INSERT `error_event_log` | `BUS_COMMAND`；sender-bound ACTIVE ADMIN | `RUNTIME_ACCEPTED` | 原 create/update/set-active command；`NO_AUTO_RETRY` | `strategy-create-version.test.ts`、`strategy-update.test.ts`、`strategy-set-active.test.ts`、`strategy-read.test.ts` |
| `auth.ts`、`student.ts`、`strategy.ts`、`assessment.ts` 的 `seed*ErrorCodes()`/`ensureSeeded()` | `INSERT OR IGNORE error_code_registry`；当前首次 IPC 可触发 | `STARTUP_SEED_INTERNAL`；固定 SYSTEM | `POST_DB_INIT_PRE_BOUNDARY_READY` | composition-root startup seed owner；`REPLAY_SAFE` | planned `startup-seed.test.ts`、`preflight-no-side-effect.test.ts`；实现后首次 IPC 不得再 seed |
| `job-skill-scoring.ts`、`observation.ts`、`operation-scoring.ts` 的 IPC wrapper | 当前可直接调服务并丢弃 `_event`，间接进入 writer | `BUS_COMMAND`；必须使用 sender-bound USER，不接受 caller 自报 | `RUNTIME_PREFLIGHT → RUNTIME_ACCEPTED` | 由对应 application command 登记；`NO_AUTO_RETRY` | 对应 handler tests + planned actor/target mismatch tests |
| `assignment.ts` → `src/main/domain/local-runtime-context.ts` | 可能创建 organization/node/device/runtime/auth session | assignment 的已登记 `INTERNAL_CAPABILITY` 子步骤；父命令可信 TEACHER/ADMIN，内部记录 SYSTEM phase | `RUNTIME_ACCEPTED_CHILD` | 父 assignment command/现有 transaction topology；`NO_AUTO_RETRY` | `local-runtime-context.test.ts`、assignment tests |
| `src/main/db/connection.ts` | schema 初始化、dev seed、legacy `recoverActionLog()`、recovery event/snapshot | `STARTUP_INTERNAL`；固定 SYSTEM | `DB_INIT → LEGACY_RECOVERY → BOUNDARY_READY` | `initDatabase` composition owner；失败关闭；`MANUAL_REVIEW` | connection/migration/recovery tests |
| `src/main/index.ts:31-34` | `SVETS_E2E` data-root `mkdirSync` 与 `app.setPath` | `E2E_BOOTSTRAP_INTERNAL`；固定 SYSTEM；只允许显式 E2E env | `PROCESS_BOOTSTRAP_PRE_DB_INIT` | 无 SQLite transaction；`REPLAY_SAFE` | planned static inventory test + `scripts/e2e/smoke.mjs` |
| `migration-startup.ts`、`migrations.ts`、`migration-backup.ts`、`report-migration.ts`、`safety-rekey-migration.ts` | DDL/DML、backup/manifest、历史 reconcile；M4 kernel DROP/CREATE 触发器与索引 | `MIGRATION_INTERNAL`；固定 SYSTEM | `STARTUP_UPGRADE`；M4 为 `M4_SAFETY_REKEY_MIGRATION` | migration startup owner，逐入口登记当前 transaction topology；`MANUAL_REVIEW` | 对应 migration tests，含 `safety-rekey-migration.test.ts`、`connection-m4-safety-rekey.test.ts` |
| `recovery.ts`、`legacy-upgrade-recovery.ts` | JSONL read/archive/truncate、逐事件 projection/reducer reconcile、snapshot/correction | `RECOVERY_INTERNAL`；固定 SYSTEM | `LEGACY_RECOVERY`/`LEGACY_UPGRADE_RECOVERY` | 当前 per-event/group transaction owner；文件修复 `MANUAL_REVIEW` | `recovery.test.ts`、`legacy-upgrade-recovery.test.ts` |
| `src/main/utils/auth-session.ts` 的 heartbeat、过期/禁用持久化 | UPDATE `last_activity_at`、`EXPIRED`、`REVOKED` | `AUTH_SESSION_MAINTENANCE`；USER snapshot 只供纯读 preflight，维护由 SYSTEM/已接受父命令触发 | heartbeat=`POST_ACCEPT_PRE_DOMAIN`；过期/禁用=`AUTH_SESSION_SWEEP` | 独立登记当前 transaction owner；幂等维护为 `REPLAY_SAFE` | `auth.test.ts`、`auth-context.test.ts` + planned preflight/sweep tests |
| `src/main/domain/action-log-path.ts:getActionLogPath()` | 隐含 `mkdirSync({userData}/data)` | `ACTION_LOG_PATH_INTERNAL`；固定 SYSTEM，不得从 READ 调用 | `EVENT_WRITE_PREPARE` 或 `LEGACY_RECOVERY` | 无 SQLite transaction；`REPLAY_SAFE` | planned `action-log-path-boundary.test.ts` + static inventory test |
| `report-service.ts`、`report-command-coordinator.ts`、`task-closure-service.ts`、`report-export.ts`、`report-errors.ts`、`handlers/{reports,job-skill-report,safety}.ts` | report/task-closure event/reducer、HTML temp/write/rename、`error_event_log`、automation fallback | `BUS_COMMAND + REPORT_FILE_CAPABILITY`；sender-bound USER 或已登记 SYSTEM fallback | `RUNTIME_ACCEPTED`/`REPORT_AUTOMATION_ACCEPTED` | 每 data root 单例 coordinator；逐阶段事务/文件 owner；`MANUAL_REVIEW` | report coordinator/export/integration/task-closure/job-skill-report tests |
| `src/main/domain/task-closure-service.ts:confirmBaseTaskClosure()` → `runSingleEventCommand()`；`replaceBaseTaskClosure()` → `runSingleEventCommand()`（分别由 `reports:confirmTaskClosure`、`reports:replaceTaskClosure` 调用） | 通过注入的 `ReportCommandCoordinator` 写入 `TASK_CLOSURE_CONFIRMED`/`TASK_CLOSURE_REPLACED` 及 report/task-closure projection；不得自行构造 coordinator 或低层 writer | `BUS_COMMAND → REPORT_COMMAND_COORDINATOR`；sender-bound ACTIVE `TEACHER`。前者的 registry `target_resolver` 以 `readBaseTaskResultBinding(resultIds)` 解析三元业务键与 `BASE_ABILITY` scope；后者先以 `requireClosure(oldTaskClosureId)` 解析旧 closure，再以 `readBaseTaskResultBinding(resultIds)` 校验同一业务键。两者均在取得 capability 前完成权威解析；owner 分别固定为 `reports:confirmTaskClosure`、`reports:replaceTaskClosure` | `RUNTIME_ACCEPTED → REPORT_TASK_CLOSURE_ACCEPTED` | 同一 data root 的 composition-root coordinator 按 `{studentId, jobCode, taskCode, scope: 'BASE_ABILITY'}` 串行，`runSingleEventCommand()` 是 SQLite transaction owner；`NO_AUTO_RETRY`。envelope `correlation_id` 必须经 service params 传入 F7 intent | `task-closure-service.test.ts`、`reports.test.ts`、`report-coordinator.test.ts` + planned `command-registry.test.ts`、`command-bypass.test.ts`；覆盖两个 callsite 的统一 coordinator/correlation 透传 |
| `event-writer.ts`、`assessment-reducer.ts`、`assignment-reducer.ts`、`report-reducer.ts`、`training-reducer.ts` | JSONL append、`domain_event_projection`、业务投影 DML | 仅 `LEGACY_MUTATION_ADAPTER`/`RECOVERY_INTERNAL` 可调用；actor 继承已接受父命令或固定 SYSTEM | `DOMAIN_APPLY`/`LEGACY_RECOVERY` | 父 application transaction；禁止自动重试；测试 adapter 为显式例外 | reducer/recovery/handler integration tests + static bypass test |
| `sqlite-adapter.ts`；`memory-adapter.ts`、`test-helpers.ts` | 通用 DB port；后两者仅测试写入 | `LOW_LEVEL_PORT`；后两者 `TEST_ONLY_EXCEPTION` | composition/test only | 不能作为生产 command owner；按调用方策略 | planned static inventory fixture test |

静态 fixture 的当前预期文件集合必须先以以下 35 个 direct-side-effect 文件为精确基线；不是只保存目录 glob 或“实施时再扫描”。实现时 fixture 还必须记录每个 callsite 的位置/owner，防止在已列文件内新增旁路：

- `BUS_COMMAND_DIRECT`（13）：`src/main/ipc/handlers/{ability-scoring,assessment,assignment,auth,job-skill-result,job-skill-scoring,observation,operation-scoring,reports,safety,strategy,student,training}.ts`。
- `PRODUCTION_INTERNAL_DIRECT`（19）：`db/{connection,migration-backup,migration-startup,migrations,report-migration,safety-rekey-migration}.ts`；`domain/{action-log-path,assessment-reducer,assignment-reducer,event-writer,local-runtime-context,recovery,report-errors,report-export,report-reducer,report-service,training-reducer}.ts`；`src/main/index.ts`；`utils/auth-session.ts`。
- `LOW_LEVEL_PORT`（1）：`src/main/db/sqlite-adapter.ts`。
- `TEST_ONLY_EXCEPTION`（2）：`src/main/db/memory-adapter.ts`、`src/main/db/test-helpers.ts`。
- 另列不直接命中低层写 API、但拥有/委派副作用的 5 个 call-graph roots：`src/main/ipc/index.ts`、`src/main/ipc/handlers/job-skill-report.ts`、`src/main/domain/report-command-coordinator.ts`、`src/main/domain/task-closure-service.ts`、`src/main/domain/legacy-upgrade-recovery.ts`。

`src/main/ipc/handlers/*.ts` 当前 74 个 `ipcMain.handle()` 必须逐一落到 `READ`/`MUTATION`。最终 fixture 必须同时满足“74 个 channel 恰好一次”“上述 35 个 direct 文件与 callsite 恰好归属”“5 个 delegating roots 可追到 owner”；对 `runSingleEventCommand()`、`runSingleEventCommandSync()` 及等价注入 capability 的生产调用必须反查到登记 callsite，特别是 `task-closure-service.ts` 的两个 callsite。扫描集合增删、同文件新增 callsite、未登记的 capability 持有/调用、direct DB/file write 无归属或 test-only 例外进入生产 import graph，均 fail closed。

### 明确不包含

- 不新增或修改 SQLite 表、列、CHECK、trigger、index 或 migration；若实现需要 Schema 扩展，立即停止并重新进行 R3 feature 定义。
- 不实现 `command_log` 持久化、跨进程租约、durable idempotency result、fencing 或 command recovery；这些属于 M5B batch runtime 的独立合同。
- 不实现 `BATCH_PREPARED → EVENT* → BATCH_COMMITTED`、fsync/durability barrier、hash chain、segment/index、v2.2 `startupRecovery` 或 corruption gate；当前 legacy `recoverActionLog`/migration startup 只做 inventory 和 capability 收口，不替换其协议。
- 不改变 `writeEvent()` 的 JSONL/SQLite 物理协议，不新增事件类型，不迁移历史事件，不重写或删除 action log；允许新命令把已有可选 `correlation_id` 传给 `writeEvent()` 以连接运行时 command trace，但不得新增事件字段或改变既有历史行 bytes。
- 不实现 HTTP REST、SSE、utilityProcess、MessagePort、AI command、教师 Web 或新的 renderer route。
- 不修改 BASE_ABILITY 激活状态、题目合同、策略版本、结果计算和报告解释边界。
- 不操作默认 `xc-career-guide.db`，不把测试或 inventory 生成到默认运行数据目录。

## 6. 行为与数据变化

### 6.1 Command envelope

M5A 运行时 envelope 只能由 Main 构造：`payload` 可源自通过 command-specific contract 的客户端输入，`target` 必须由 Main resolver 生成，其余可信元数据由 Main 生成或从已验证内部父命令继承。renderer/未来 transport 不得提交完整 envelope 或覆盖可信字段；`correlation_id` 仅允许可信内部嵌套命令继承。

| 字段 | 语义 |
|---|---|
| `command_id` | Main 在 adapter/内部 capability 入口生成的 UUID v4（格式必须匹配 UUID v4）；IPC 不接受客户端提供的命令 ID。它在一次 dispatch、日志和事件关联中保持不变，但只保证当前进程内的追踪唯一性，不表示重试去重或持久化唯一键。 |
| `command_type` | registry 中唯一、稳定、大小写敏感的字符串；adapter 只能使用静态登记值，未知值在任何副作用前拒绝。 |
| `source` | 由入口代码写死的 `IPC` 或 `INTERNAL`。`HTTP`/`BACKGROUND` 只能作为未启用的未来 registry slot，不能在 M5A runtime 接受。 |
| `actor` | Main 解析出的不可变快照：`kind`（`USER`/`SYSTEM`/`UNAUTHENTICATED`）、`user_id`、`role`、`auth_session_id` 或内部 `phase` reference。USER 必须来自 sender-bound ACTIVE auth session；SYSTEM/BOOTSTRAP 只能匹配显式 actor policy。`UNAUTHENTICATED` 不能直接作为既有 `ActionLogEntry.actor_role` 写入值；若 BOOTSTRAP 命令产生事件，必须有 registry 中明确的既有 `SYSTEM` 映射，否则在写入前拒绝。 |
| `target` | registry 的纯读 `target_resolver` 输出的 canonical 业务目标，不是客户端提交对象。涉及安全、assessment、training 或结果归因时必须从权威 aggregate/关联记录解析并包含 `student_id + job_code + task_code`；客户端同名字段只作候选输入或 compare-only hint，不得用二元键或未经解析的 payload 值替代当前 M4 三元键。 |
| `payload` | 按 command-specific schema 校验后的业务参数；不得包含可信权限声明。现有 IPC 的 `callerUserId`/`callerRole` 仅可留在兼容输入层并与 trusted actor 比对，不能进入业务 payload 或覆盖 actor。 |
| `request_hash` | 对 `{"command_type": command_type, "target": target, "payload": payload}` 的 canonical JSON 做 UTF-8 SHA-256，输出 64 位小写十六进制。故意不包含 actor、source、command_id 或时间字段；它描述业务请求，不是事件 checksum。 |
| `created_at` | Main 在生成 envelope 时取得的 UTC RFC 3339 时间，格式固定为 `YYYY-MM-DDTHH:mm:ss.sssZ`；不接受客户端时间。该时间是命令创建时间，不替代 `ActionLogEntry.created_at`。 |
| `correlation_id` | 顶层 command 默认等于 `command_id`，由 Main 生成；可信内部嵌套 command 可生成新的 `command_id` 但继承父 `correlation_id`。同一 correlation 下产生的所有既有事件必须将其传入现有可选 `writeEvent({ correlationId })`，以便从 action log 追溯。不是新的持久化列或事件字段。 |

#### 6.1.1 权威 target 解析合同

每个 MUTATION registry row 必须内联或静态引用唯一 `target_resolver`，并冻结以下字段：`resolver_owner`、`resolver_kind`、`locator_fields`、`authoritative_tables/columns`、`canonical_target_schema`、`client_hint_fields`、`not_found_mapping`、`mismatch_mapping` 和 `test_reference`。不得使用“由 handler 自行解析”或一个可按运行时路径任意选表的通用 resolver。

| Resolver kind | 权威来源与规则 | 当前命令族示例 |
|---|---|---|
| `EXISTING_AGGREGATE` | 结构校验后的 locator 只用于 SELECT 定位；canonical target 全部从命中的 aggregate 行及受约束关联记录产生。`sessionId` 命令必须分别从 `assessment_session`/`training_session` 读取三元键；incident、assignment、result/report 命令必须沿其真实关联记录解析，不能相信客户端三元键。 | assessment/training mutation、operation/ability/job-skill scoring、safety lifecycle、assignment、result/report |
| `CREATE_FROM_VALIDATED_REFERENCES` | payload 中的 student/job/task/strategy/business-session 等只是候选值；resolver 必须读取所有相关父记录/策略/授权，逐字段验证一致后才规范化为 target。Main 生成的新 aggregate ID 可在解析期间加入 target，但不能跳过关联事实校验。 | create session、create safety incident、create assignment、create student/strategy version |
| `ACTOR_SCOPED` | target 由无写 sender-bound actor snapshot 与必要的账号/档案 SELECT 共同确定；请求体 caller 不参与权威值。 | logout、当前用户/学生自助 mutation、账号维护 |
| `STATIC_CONTEXT` | target 由 registry/composition root 静态提供。BOOTSTRAP 登录使用命令级 `AUTH_LOGIN` target，username/credential 仍是待业务校验的敏感 payload，账号不存在或密码错误属于 accepted business outcome，允许产生已登记的失败审计；SYSTEM target、phase/capability 不得从 IPC payload 构造。 | auth login、startup seed、migration、legacy recovery、auth sweep、file publication |

解析顺序与冲突规则固定如下：

1. 先完成 command 静态登记和 payload 结构校验，再取得无写 actor snapshot；未通过时不得调用 resolver。
2. resolver 只能执行 SELECT/内存规范化，不得调用 seed、auth maintenance、日志、`getActionLogPath()` 或任何 DB/file writer。
3. 记录不存在时使用 registry 中该 channel 的既有 `NOT_FOUND`/兼容错误映射；关联记录彼此冲突或 client hint 与 canonical target 任一字段不一致时，产生内部 `COMMAND_TARGET_MISMATCH`，再由 registry 映射为该 channel 已有响应结构。M5A 不为此新增 renderer API。
4. 比对覆盖所有已提供 hint；不得只比 student 而忽略 job/task，也不得以 actor 有权限为由容忍 mismatch。
5. 只有 canonical target、去除 caller/hint 后的 canonical payload 均冻结，才计算 `request_hash`、创建完整 envelope 并进入 `ACCEPTED`。未通过解析的客户端 target 不得参与 hash、concurrency key、correlation 或审计归属。

canonical JSON 规则固定为：递归对象 key 按 UTF-16 code-unit 字典序排序、数组保持原顺序、只接受有限数字/普通对象/无循环引用、无空白 JSON 序列化，按 UTF-8 字节计算 SHA-256。实现应复用现有 `src/main/domain/report-canonical.ts` 的等价校验语义，或提供相同测试向量，不得使用 `JSON.stringify` 的输入插入顺序作为 canonical 依据。

固定测试向量：

```text
canonical = {"command_type":"student.read","payload":{"action":"list"},"target":{"aggregate_id":"student-1","aggregate_type":"STUDENT"}}
request_hash = df1470b5705db8c57362264c5ad9626f83b95ce732ede593b17ac60b61cd933c
```

M5A 只在运行时计算、传递和记录摘要，不把 `command_id`/`request_hash` 写入新表，不把它们偷塞进现有 event payload/schema_version，也不声称已提供跨进程、跨重启的幂等结果恢复。

M5A 不定义 `received_at`、`accepted_at`、`completed_at` 或客户端时间字段；耗时只作为运行时观测，不进入既有事件 payload。事件的持久化时间仍由 `writeEvent()` 生成，事件顺序仍由现有 sequence/事务语义决定。

### 6.2 写入路径

`ACCEPTED` 是 M5A 的物理副作用分界：它表示静态 registry、boundary readiness、结构合同、actor policy、权威 target 和 hint 比对全部通过，canonical payload/target 与 envelope 已冻结，Bus 才签发 mutation capability。固定 preflight 顺序为：

```text
static channel/command lookup + immutable registry/boundary-ready check
  -> structural payload validation and caller/target-hint separation
  -> no-write sender-bound auth snapshot (or explicit BOOTSTRAP policy)
  -> pure SELECT target_resolver + not-found/mismatch checks
  -> canonical target/payload + request_hash + frozen CommandEnvelope
  -> ACCEPTED: mutation capability becomes available
  -> registered post-accept internal maintenance/application command
```

错误码 seed 必须由 composition root 在 DB 初始化成功后、boundary 对外 ready 前以 `STARTUP_SEED_INTERNAL` 完成；seed 失败则 boundary 保持 mutation-closed，不得退回首次 IPC lazy seed。无写 auth snapshot 必须仅查询 sender token、session/account 状态和可信角色：过期或禁用立即按现有响应拒绝，但不得在该请求内持久化 `EXPIRED/REVOKED`、刷新 `last_activity_at` 或删除 sender binding。持久化清理由显式 `AUTH_SESSION_SWEEP` 执行。

只有已接受的 authenticated MUTATION 可把 heartbeat 作为登记的 `POST_ACCEPT_PRE_DOMAIN` 内部子步骤；READ（包括 `auth:getCurrentSession`）不 heartbeat。命令越过 `ACCEPTED` 后，领域前置条件或登录凭据校验仍可能返回业务失败；此时 registry 已登记的 heartbeat、登录失败审计或领域错误记录可以发生，必须由失败矩阵验证，不能把它误写成 preflight 零副作用。现有 IPC 成功/错误结构保持不变。

```text
IPC adapter
  -> static registry + structural contract
  -> no-write trusted auth snapshot
  -> authoritative target resolver + hint comparison
  -> canonical payload/target + CommandEnvelope
  -> ACCEPTED + registered post-accept maintenance
  -> CommandBus.dispatch
  -> application command handler
  -> current mutation port / legacy event writer
  -> existing reducer/projector and transaction
  -> stable IPC result/error mapping
```

现有 `writeEvent()` 的调用方不得继续作为生产 handler 的自由写入口；它只能由 M5A 明确登记的 legacy mutation adapter 调用。该 adapter 的替换点必须让 M5B 能在不再次修改每个业务 handler 的情况下接入 batch coordinator。

事务 owner 必须在 registry 中逐命令登记。领域 mutation 的最小边界仍是现有 `db.transaction(() => { writeEvent(); applyReducer/projector(); ... })`；这里的原子性只覆盖 SQLite。若第 N 次 `writeEvent()` 已完成 JSONL append、随后 `domain_event_projection` INSERT 或 reducer/projector 失败，当前调用返回失败，事务开始以来的 SQLite 写入全部回滚，但 JSONL 保留截至第 N 条的 parse-valid 前缀。当前 `reconcileActionLog()` 按单事件恢复，该前缀之后可被逐条投影为部分业务批次；相同 `correlation_id` 不提供 group commit/recovery 语义。M5A 必须用真实临时 JSONL 固化该行为，不得加入补偿事件、删改前缀或假称命令级原子性。报告文件同样不得宣称与 SQLite 原子；临时文件、hash/size 校验、最终 rename、报告事件和 `error_event_log` 的责任必须由报告 adapter 单独登记。

### 6.3 读取路径

查询保留现有模块服务和 IPC 结果合同，但只有实际无副作用的命令经过 read registry。read path 不取得 mutation capability，不调用写 adapter，不执行 lazy seed，不更新 `auth_session.last_activity_at`/session status，不写 `error_event_log`，不调用会隐式 `mkdirSync` 的 action-log path，也不写其他文件。现有会刷新 session 的 auth resolver 必须拆成纯读 snapshot resolver 与显式维护 capability；未拆分完成的 channel 不得进入 READ registry，也不得以“逻辑上是查询”掩盖物理写入。

### 6.4 幂等语义边界

M5A 不实现命令去重、重复结果缓存或冲突表。`command_id` 是一次 dispatch 的 trace ID，`request_hash` 是可重复计算的业务输入摘要；同一请求再次进入时默认仍是一次新的执行。Command Registry 必须为每个 MUTATION 登记 `retry_policy`（`NO_AUTO_RETRY`、`REPLAY_SAFE` 或 `MANUAL_REVIEW`）和 `concurrency_key`/已有 guard；IPC adapter 不得自动重试，调用方只能遵循该策略。若某命令需要可靠 duplicate detection、不可逆点或跨重启恢复，必须停止 M5A 并转入 M5B 的 `command_log`/fencing 合同，不得以进程内 Map 或 sidecar 冒充持久化幂等。

## 7. 边界条件与异常处理

- 空/畸形 payload、未知 command type、boundary 未 ready、缺失/过期/禁用 actor、角色不匹配、target 不存在或 mismatch：在 `ACCEPTED` 前失败。失败前后 `auth_session`、`error_code_registry`、`error_event_log`、领域/投影表、action log 与 data-root 文件树均不变，sender binding 也不删除或替换。
- 同一 `command_id` 再次出现：M5A 不承诺识别或去重；必须按 registry 的 retry/concurrency policy 处理，不得覆盖或伪造历史结果。
- 同一业务 key 并发执行：只能复用已经存在且注入为单例的 guard（报告命令使用同一 `ReportCommandCoordinator`），或在任何写入前拒绝为 `CONCURRENCY_UNSAFE`；不得新增 M5B lease/fencing。
- 已越过 `ACCEPTED` 后的业务前置条件/登录凭据失败：沿用现有错误码/结果合同，不写领域事件、不直接修改业务 projection；允许的 auth heartbeat、登录失败审计或错误记录必须是 registry 已登记的 post-accept side effect，并在失败矩阵中逐项断言。不得用该例外放宽 preflight 零副作用。
- `writeEvent()` 第 N 次 append 成功但随后 projection/reducer 失败：当前调用的 SQLite 事务整体回滚，JSONL 合法前缀不可回滚；legacy recovery 按该前缀逐事件恢复，可能形成部分评分/事件批次。M5A 只登记并测试这一 M5B 风险，不引入补偿事件、不截删 parse-valid 前缀，也不把 correlation 当 batch boundary。
- 报告文件 rename 与事件事务不是原子操作：必须保留临时文件校验和 owner-only cleanup；rename 前失败清理临时文件，rename 后事件/SQLite 失败记录现有 report error 并进入现有 recovery/write-gate 语义，测试必须验证不会静默返回成功或吞掉 orphan artifact。
- M4 安全事件：继续遵守 `INV-SAFE-001`～`INV-SAFE-004`；安全事实和普通评分不得由 command mapping 合并。
- Bus 初始化失败或 registry 不完整：应用进入 mutation-closed 状态；只读查询是否可用由现有启动错误合同决定，不得部分开放写入口。
- 发现任何未登记的 DB/file writer、直接 `ipcMain.handle` mutation 或绕过可信 actor 的调用：门禁失败，停止实现。

## 8. 迁移与兼容性

- M5A 预期为无 Schema migration 的应用层改造；`src/main/db/schema.sql`、migration ledger、默认数据库和历史 action log bytes 应保持不变。
- 保留 legacy `ActionLogEntry` v1 与 F7 envelope-v2 的读写兼容；不把 `command_id`/`request_hash` 偷塞进既有 payload 或 envelope 的 `schema_version`。只允许复用既有可选 `correlation_id` 传递 command trace；若某路径无法传递 correlation，必须在 inventory 标为“仅运行时可观测”，不得宣称事件可关联。
- 现有 IPC channel 名称、preload 白名单、shared API 类型和业务响应结构保持兼容；M5A 不新增 renderer API。
- 回滚时可移除 Command Bus adapter，恢复到既有 handler → legacy service/writer 的兼容版本；已写入的历史 event bytes、投影和结果不删除、不重写。
- 若实现过程中发现必须新增 `command_log`、mutation gate Schema、batch fields 或 startup recovery，M5A 立即停止，转入 M5B 独立 feature，不允许隐式扩大范围。
- 回滚责任按 inventory 的 boundary mode 分开：BUS adapter 可切回旧入口；startup/migration/recovery/seed/auth maintenance 例外不得被删除或跳过；report file cleanup 只能清理本次命令拥有的临时/最终 artifact，不能删除历史报告。

## 9. 非功能要求

- 性能：当前单进程 IPC 的正常响应路径不引入网络 hop；Bus 分派开销应可由定向基准或测试观察，不能改变事务提交点。
- 可访问性：本阶段无 renderer/UI 变更；若发现必须修改 UI 才能接入 Bus，另立影响项，不在本 PRD 中顺手扩大。
- 隐私与审计：command envelope 不打印密码、答案键、学生敏感原文或完整 payload；错误日志只记录稳定 command type、correlation/request hash 摘要和错误码。
- 可观测性：每个 mutation 至少能从 IPC source、command type、actor reference、target、request hash 摘要和结果/error code 追溯到 `correlation_id`；事件型 mutation 必须把 envelope 的 `correlation_id` 传入既有 event writer。无事件的 DB/file/internal mutation 只承诺运行时日志追踪，不得把该路径写成 durable audit。不得把敏感 payload 写入普通日志。
- 可测试性：Command Bus 接受显式注入的 DB/event adapter、可信 actor/context 和 action-log 临时路径；测试不得读取或修改默认运行库。
- Electron 边界：主进程本地模块使用静态 import；renderer 只能经 preload；不引入 ORM、前端持久化库、CSV 解析库或报告 Markdown 渲染库。

## 10. 验收标准

### 自动化验收

1. `command-envelope`/`target-resolver` 测试覆盖：Main 生成 UUID/UTC 毫秒时间、客户端 command_id/source/actor/time 注入被拒绝、sender-bound actor、BOOTSTRAP/SYSTEM actor policy、canonical hash 固定向量、非法数字/循环对象、缺字段/未知类型和敏感字段日志脱敏；对只带 `sessionId` 的 ability/operation/job-skill 路径从 DB 解析三元键，并覆盖伪造 student/job/task hint、关联记录冲突、记录不存在、创建型候选字段不一致。断言 mismatch/not-found 发生在 hash/concurrency/correlation 归属前。
2. `command-registry` 测试断言当前 74 个 IPC channel 恰好分类一次；每个 MUTATION row 含 resolver owner/kind/权威列/hint 与错误映射、boundary mode、actor policy、phase、transaction owner、retry/concurrency policy 和 test reference。非 IPC inventory 必须与 §5 的 35 个 direct-side-effect 文件及 5 个 delegating roots 精确对账到 callsite；其中 `task-closure-service.ts` 的两个 coordinator callsite 必须分别归属 `reports:confirmTaskClosure` 与 `reports:replaceTaskClosure`。静态门禁还必须反查生产代码对 `runSingleEventCommand()`、`runSingleEventCommandSync()` 或等价注入 capability 的调用；未知、重复、漏登记、集合漂移、同文件新增未归属 callsite，或未登记生产文件注入/调用 coordinator 时均 fail closed；read registry 不拥有 mutation capability。
3. `command-bus`/`preflight-no-side-effect` 测试覆盖成功 dispatch、业务错误映射、boundary 未初始化、未知命令、非法 payload、caller 与 trusted actor 不一致、过期/禁用 session、target not-found/mismatch。每个拒绝用隔离 DB/data root 比较前后 `auth_session`、`error_code_registry`、`error_event_log`、领域/投影表、action log 与文件树 hash 均不变；sender binding 不变。另证实 seed 只在 pre-boundary startup、READ 不 heartbeat、accepted MUTATION 才可 heartbeat、sweep 独立运行，并覆盖无自动重试与 concurrency policy。
4. 静态 callsite 门禁断言生产 `src/main/ipc/handlers/` 不直接调用 `writeEvent()`、不直接更新受控业务投影、不直接注册未分类 mutation；同时断言 auth 登录/账号、student、strategy 业务 DML，startup/seed/migration（含 M4 safety rekey kernel）/recovery/auth maintenance/local-runtime/action-log hidden mkdir/E2E data-root/report-file/error writers只出现在显式清单，并且每个例外有 owner/capability/phase/transaction/retry/test。门禁还必须从 coordinator/capability 调用反查到 owner，禁止未登记生产服务注入或调用 coordinator；legacy adapter、low-level port 和 test-only fixture 使用封闭例外清单。
5. 跨模块回归覆盖 assessment、training、assignment、safety、operation scoring、ability scoring、job-skill scoring、observation、reports 的主要 mutation；结果类型仍遵守 `INV-RES-001`，安全结果仍遵守 `INV-RES-002`。
6. 多事件路径覆盖 operation scoring 的 9 项评分、BASE_ABILITY/JOB_SKILL 线下评分、结果终结、assignment 和 safety incident。至少一项测试使用真实临时 JSONL，在第 `N`（`1 < N < 完整事件数`）次 append 后注入 projection/reducer 故障：断言命令返回失败、当前调用的 SQLite projection/reducer 写入全部回滚、JSONL 恰保留 N 条同 correlation 的合法前缀；随后运行 legacy `reconcileActionLog()`，断言只逐事件恢复该 N 条前缀且不会凭 correlation 补齐余下事件。该测试明确记录 M5B 残余风险，不期待 M5A 补偿或命令级全有或全无。
7. 报告回归覆盖单一 composition-root coordinator 的跨入口串行化、report export temp/final 文件的成功/rename 失败/event append 成功但 SQLite 失败/cleanup 失败矩阵、`error_event_log` 脱敏和现有 F7 write gate；job-skill fallback 不得新建旁路 coordinator。
8. 事件追溯回归断言一个多事件 command 的所有既有 `ActionLogEntry` 复用同一 `correlation_id = command_id`，不新增 event 字段、不改变历史 fixture bytes；并断言 recovery 不把 correlation 当作 group/commit marker。无事件 writer 的内部路径只能被标为 runtime-only trace。
9. M4 负向回归覆盖同 student/task 不同 job 不互相熔断、同三元键 assessment/training 同时熔断、不同 job 不被未解决 incident 阻断；所有业务命令均通过 Bus 或明确的内部 capability，且不允许 Bus 直接 INSERT `REDLINE_HALTED`。
10. schema/migration 变更检测断言本阶段未修改 `schema.sql`、migration ledger、event payload schema、action log fixture 和默认数据库；运行验证只针对隔离临时 DB/data root；`FUTURE_MULTI_DEVICE_TABLES` 中的 `command_log` 字符串不得被激活。

### 工程门禁

在实现阶段至少执行：

```bash
npm test -- <Command Bus 定向测试> <现有 mutation 相关回归>
npm run typecheck
npm run lint
npm test
npm run build
npm run db:verify -- --db <隔离临时数据库>
npm run contract:m4:safety-sql:check
npm run docs:index:update
npm run docs:index:check
git diff --check
```

`npm test`、build、人工 Electron smoke、默认数据库检查或命令未实际执行时必须分别记录 `NOT_RUN`/`BLOCKED`，不得由定向测试推断为通过。

### 人工/桌面验收

- 教师触发安全事件、学生提交作答、教师线下评分和报告 mutation 的现有 Electron 核心流程均通过统一 boundary，UI 可观察到原有成功/错误状态。
- 使用显式临时 userData/DB/evidence 根验证 Bus 初始化失败、未知命令、权限越权、重复/并发命令和 M4 跨岗位安全隔离；默认数据文件族前后存在状态与 hash 不变。

## 11. 适用不变量

- `INV-EVT-001`、`INV-EVT-002`、`INV-EVT-003`：领域状态仍由事件推进；M5A 不改变 legacy 写入顺序，也不得新增事件而漏登记；M5B 再以新稳定 ID 重基线事件协议。
- `INV-SAFE-001`、`INV-SAFE-002`、`INV-SAFE-003`、`INV-SAFE-004`：Command Bus 不绕过当前三元安全聚合、红线触发链和生命周期状态机。
- `INV-AUTH-001`、`INV-AUTH-002`：actor/context、TEACHER/ADMIN 边界和 assignment 三方一致性保持现状。
- `INV-RES-001`、`INV-RES-002`：结果类型不混算，安全结果优先。
- `INV-IPC-001`、`INV-IPC-002`：IPC/preload/shared API 登记完整，renderer 不访问 Node/SQLite。
- `INV-DATA-001`、`INV-DATA-003`：JSON 写入前校验；本阶段不改 Schema，临时库验证可重放且不触碰默认库。

## 12. 风险、回滚与停止条件

### 主要风险

- 74 个 IPC channel 的 mutation/read 分类遗漏会形成隐蔽 bypass。
- 既有 handler 的多事件事务、report coordinator 串行语义和安全 trigger 依赖可能被薄 adapter 误拆。
- 如果把 `command_log`、持久化幂等或 batch 字段提前塞进 M5A，会与 M5B 的权威 v2.2 协议形成双重合同。
- 旧实现已有 JSONL append 后 DB 失败的事实边界；M5A 不能以自定义补偿逻辑假装解决 M5B 的 durability/recovery 问题。
- 当前 auth-context 存在过渡态 caller soft-check，部分 handler 仍有 caller 字段、lazy seed、auth-session heartbeat 和直接 writer；若只包一层 Bus 而不收口这些 callsite，会形成“名义统一、实际旁路”。
- report handler/automation 当前可能创建不同的 `ReportCommandCoordinator`，且 HTML rename 与事件事务跨越文件/SQLite 两个边界；若不冻结单例注入和失败矩阵，会丢失串行与报告追溯。

### 回滚

在任何新 Command Bus mutation 进入非测试数据库前，可回退到 legacy adapter 版本；不删除或重写已有 JSONL、projection、session、结果和报告。M5A 不应产生新的 Schema 或不可逆日志格式，因此回滚不得要求 down migration。

### 停止条件

- 需要修改 `schema.sql`、migration、事件 envelope/payload、历史 JSONL bytes、默认 DB 或历史数据；新事件仅复用既有可选 `correlation_id`，不得添加字段；
- 无法让所有 mutation 经过唯一 registry，或 74 个 IPC、35 个 direct-side-effect 文件、5 个 delegating roots 与逐 callsite fixture 不能精确对账；
- 任一 mutation 无法给出纯读 `target_resolver`、权威字段来源、client hint 冲突规则和既有错误映射，或在 target 冻结前计算 hash/concurrency/audit 归属；
- 任一 preflight rejection 会触发 seed、auth heartbeat/EXPIRED/REVOKED、sender binding 变更、`error_event_log`、目录创建或其他 DB/file side effect；
- 需要以 caller request body 取代可信 auth context；
- 不能保留现有 IPC 响应、错误码、当前调用内 SQLite projection/reducer 事务原子性、安全红线和结果隔离语义；
- 需要把 JSONL 合法前缀回滚/删除、把 `correlation_id` 当作恢复 commit marker，或声称 legacy recovery 能恢复命令级原子性；
- 必须提前实现 batch、command_log、fencing、hash chain、startupRecovery、HTTP 或 utilityProcess；
- 无法让每个 writer/side effect 命中 inventory，或无法证明 READ 无 DB/file side effect、报告 coordinator 是 data-root 单例、trusted actor 来自 sender-bound session；
- 独立 `/vibe-review` 仍有 P0，或 R3 只能由非独立自审给出完全 `PASS`。

## 13. 已确认决策、假设与未解决问题

### 已确认决策

- 历史定义阶段授权不包含编码；2026-07-29 用户随后明确授权当前会话连续推进后续里程碑。该授权仍不包含默认数据库操作、commit、push、merge 或发布。
- M4 Step 2A 已关闭；M5A 必须以 `student_id + job_code + task_code` 为现行安全聚合语义。
- M5A 是当前进程内的边界整理阶段；M5B 才处理权威 v2.2 batch/event-log/recovery/fencing。
- 不新增 IPC channel；优先把现有 channel 接入中央 registry，保持 preload/shared API 兼容。
- `command_id`/`request_hash` 在 M5A 只用于运行时追踪、输入摘要和固定校验；不做 duplicate detection、自动重试或持久化幂等。
- canonical target 必须由 registry 的纯读 resolver 从权威 aggregate/关联事实生成；现有 aggregate 命令的客户端三元键只作 compare-only hint，创建型字段只有通过父记录/策略/授权一致性验证后才能进入 target。target mismatch/not-found 在 `request_hash` 之前拒绝。
- transport preflight 使用无写 sender-bound auth snapshot。错误码 seed 固定在 `POST_DB_INIT_PRE_BOUNDARY_READY`；READ 永不 heartbeat；accepted MUTATION 才可执行登记的 heartbeat；过期/禁用持久化由独立 `AUTH_SESSION_SWEEP` 完成。
- “零副作用拒绝”只指未越过 `ACCEPTED` 的 transport/auth/target 合同失败；越过该边界后的业务失败可产生 registry 明列的 heartbeat、登录失败审计或错误记录，但不得产生未登记副作用。
- 多事件命令仅保留当前调用内 SQLite projection/reducer 事务原子性。JSONL append 前缀不可回滚，legacy recovery 按单事件恢复；M5A 不补偿、不截删合法前缀、不提供命令级原子恢复。
- 每个 registry mutation 必须明确 `retry_policy`、`concurrency_key`/已有 guard、事务 owner 和 `correlation_id` 传递规则；没有安全策略的命令在写入前拒绝。
- 现有 `recoverActionLog`、migration、seed、auth-session maintenance、local runtime context、report file/error writer 是显式内部 capability/受控例外；它们不伪装为普通业务 command，也不被当作 v2.2 `startupRecovery`。

### 合理假设

- 当前 74 个 IPC 注册点、35 个 direct-side-effect 文件和 5 个 delegating roots 是本次 inventory 的初始精确基线；其中 `task-closure-service.ts` 的 `confirmBaseTaskClosure()`、`replaceBaseTaskClosure()` 是必须逐一登记的 coordinator callsite。实现前必须由脚本重新扫描并冻结到实现文档/测试 fixture，且每个 writer/capability callsite 都必须有 owner/phase/capability/retry/test reference。任何差异先审查，不能自动接受。
- `ReportCommandCoordinator` 必须由 composition root 按 data root 创建一次，并注入 reports、safety/report automation 等所有入口；不得继续在 handler invocation 内隐式 new。
- 当前没有已注册 CLI/background 业务 writer，但已知存在 startup/recovery/lazy-seed/auth-session/local-runtime/report-file/error side effect；这些已纳入 M5A inventory，不能静默排除。

### 定义阶段未解决问题与实现后裁决

- `[转交 M5B]` durable idempotency 的唯一 `command_log` 来源与 M5A/M5B 切换版本由 Step 2C PRD 重新基线裁决；M5A 未用进程内 Map 冒充持久化幂等。
- `[CLOSED]` 46 个 mutation 的 `concurrency_key`、retry policy 与既有 public error mapping 已逐行登记；缺 guard 的路径在写前拒绝。
- `[CLOSED]` caller 兼容对照、sender-bound actor、74 channel 分类及 target resolver 已写入 active/mapping fixture 并由 target gate 对账；未修改 `auth_session` Schema。

## 14. Reviewer 状态

- 修订类型：针对 R3 独立审查 P1 的 Mini-PRD 修订；本节不是新的独立 Reviewer 结论。
- `M5A-R3-01` 候选收口：每个 mutation 强制 `target_resolver`；区分 existing/create/actor/static-context 四类权威来源，客户端三元键为 compare-only hint，not-found/mismatch 在 hash 前失败，并补伪造/冲突验收。
- `M5A-R3-02` 候选收口：固定无写 preflight 顺序；seed 移至 boundary ready 前；READ 不 heartbeat；accepted MUTATION 才允许维护；过期/禁用持久化移至独立 sweep，并以 DB/file/tree 前后不变验收拒绝路径。
- `M5A-R3-03` 候选收口：补列 auth/student/strategy 业务 DML、M4 safety migration kernel、action-log hidden mkdir、E2E data-root 和 startup/recovery/report 入口；冻结 35 个 direct 文件、5 个 delegating roots及 owner/phase/transaction/retry/test 字段。
- `M5A-R4-01` 候选收口：将 `TaskClosureService` 纳入报告/任务闭环入口族和第 5 个 delegating root；分别登记确认与替换任务闭环的 coordinator callsite、owner、可信 actor、权威 target、phase、transaction/retry/concurrency、correlation 传递及 test reference，并把 capability 反查纳入 fail-closed 静态门禁。
- `M5A-R3-04` 候选收口：所有“全有或全无”已限定为当前调用内 SQLite projection/reducer 事务；明确 JSONL 第 N 条前缀、逐事件 legacy recovery 和 M5B 残余风险，并要求真实临时 JSONL 故障测试。
- P0：本轮仅修改文档，未产生代码/Schema/数据库副作用；独立复审 `NOT_RUN`。
- P1：R4 留存的 `M5A-R4-01` 已有候选合同与验收修订，但是否关闭仍需独立 R3 Reviewer 重新读取实际 diff、代码和测试后确认。
- 文档结论：上一轮独立结论仍为 `CONDITIONAL_PASS`；本轮 reviewer 为 `NOT_RUN`。文档保持 `DRAFT`，不具备运行 `/vibe-impl` 的条件，也不授权开始编码，直到新的独立复审确认没有未解决 P0/P1。

### 最终实现审查与验收（2026-07-29）

- 上述第 14 节条目是定义阶段的历史快照，不删除、不改写其当时的 `CONDITIONAL_PASS / NOT_RUN` 结论。
- 实施计划独立审查 Round 2：`PASS`，P0/P1/P2=0，见 `doc/features/m5a-command-bus-boundary-impl-review.md`。
- 实现代码独立审查：`PASS`，Round 1 的 1 项 P1、2 项 P2 均已关闭，最终未关闭 P0/P1/P2=0，见 `doc/features/m5a-command-bus-boundary-code-review.md`。
- 最终 `/vibe-accept step M5A-11 / Step 2B`：`PASS`；target pending=0、全量 129 files/1182 tests、隔离 DB、M4 原生 Electron/UI 与报告三视口 E2E 均通过，见 `doc/features/m5a-command-bus-boundary-validation.md`。
- 里程碑状态据此更新为 `ACCEPTED_STEP_2B`；只解除 Step 2C / M5B 重新基线与独立审查的前置阻断，不表示 M5B 已实现。
