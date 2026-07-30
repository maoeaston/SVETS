# M4 Step 2B / M5A Command Bus Boundary 实施计划

**状态：`ACCEPTED_STEP_2B`（M5A-1～M5A-11 与最终代码审查、验收均为 `PASS`）。**

## 1. 实现目标

把 `doc/features/m5a-command-bus-boundary-prd.md` 转换为可逐步实现、逐步验证、可独立回滚的工程计划，在当前 Electron Main 进程内建立唯一的业务 mutation boundary。

完成后：

1. 当前 74 个 IPC channel 恰好分类一次，其中 28 个 `READ`、46 个 `MUTATION`；
2. IPC handler 只负责 transport 输入、sender 身份绑定、Bus 调用和既有结果/错误映射；
3. 所有业务 mutation 由 `CommandBus` 在无副作用 preflight 完成后签发 capability，再调用 application service；
4. 每个命令具有 Main 生成的 `command_id`、可信 actor、权威 target、canonical `request_hash`、UTC `created_at`、source 和 `correlation_id`；
5. 所有既有事件写入复用 `correlation_id = command_id`，但不改变 JSONL bytes 合同、事件 payload、Schema 或 recovery 语义；
6. startup、migration、legacy recovery、seed、auth-session maintenance、report file/error writer 等内部写入口由显式 phase/capability 管理；
7. 同一 data root 只有一个 composition-root runtime 和一个 `ReportCommandCoordinator`；
8. 静态门禁可从 IPC registry、低层 sink 和注入 capability 三个方向反查所有 owner，未知写入口失败关闭。

本计划不把 M5B 的 durable idempotency、batch、hash chain、fencing 或 `startupRecovery` 偷渡进 M5A。

## 2. 基线与范围

### 2.1 输入与状态

- 输入 PRD：`doc/features/m5a-command-bus-boundary-prd.md`。
- PRD 快照 SHA-256：`0830a38a258a025e98e95ef65fec31a01a05b613eb0dec9b2077be6c37032add`。
- 风险等级：`R3`。
- 影响域：`DOMAIN_LOGIC`、`EVENT_PROJECTION`、`IPC_API`、`AUTH_PERMISSION`、`SAFETY_FSM`、`RESULT_REPORT`、`DEPLOYMENT_OPERATIONS`。
- 当前分支：`feat/multi-device-m2-prd`。
- 规划基点 commit：`40541c82ef374f28ce300365e0e5cc82423dd99a`。
- 当前 Schema：`v0.1.17-multi-device-m4-safety-rekey / ACCEPTED_STEP_2A`。
- 当前工作区：dirty；M5A PRD、复审记录、BASE_ABILITY review、交接与文档索引均有既存未提交改动。实施时必须保留这些改动，不得 reset、覆盖或把无关文件混入 M5A 变更。
- 进入计划阶段证据：`.continue-here.md` 与 `doc/会话启动.md` 的 HANDOFF 已记录 `M5A-R4-01` 独立复核无 P0/P1，并把 `/vibe-impl` 指定为唯一下一步；2026-07-29 用户进一步明确授权本会话连续推进后续里程碑。
- 编码门禁：本计划必须先完成独立 `/vibe-review impl` 且无 P0/P1；之后按本计划逐步实施，每一步执行 `/vibe-accept step <step-id>`，不以本计划存在本身替代验收。

### 2.2 状态差说明

- [!] PRD 第 1、14 节仍保留候选修订时的 `DRAFT`、历史 `CONDITIONAL_PASS` 和“不得进入 `/vibe-impl`”文字。仓库已保存 R3、R4 两轮 `CONDITIONAL_PASS` 报告；其后的会话交接记录 `M5A-R4-01` 已完成独立针对性复核且无 P0/P1，但该最终复核没有单独落盘。当前用户指令允许继续计划与后续实施，但不能覆盖新的工程正确性门禁。
- 实施前必须把“状态证据来自哪里”固定到 review/accept 记录中；不得把历史 R4 报告改写成从一开始就是 `PASS`，也不得删除其 P1 发现。
- 该状态差只影响工作流元数据，不改变 M5A 的功能合同、风险等级、范围或验收标准。若独立 plan review 重新发现 P0/P1，则按新证据停止编码并修订计划。

### 2.3 权威依据

- `AGENTS.md`；
- `doc/specs/baseline.yaml`；
- `doc/specs/project-invariants.md`；
- `doc/ai/vibe-workflow-contract.md`；
- `doc/specs/MVP_PRD_v1.0.9-authoritative.md` §3、§5.7、§8、§11、§12.3、§14、§17、§19；
- `doc/specs/architecture-plan-b-multi-device-v2.2-authoritative-baseline.md` §10、§11、§12、§14.5；
- `src/main/db/schema.sql`；
- `src/shared/types/ipc-api.ts`、`src/preload/index.ts`；
- `src/shared/types/event-payloads.ts`、`src/shared/types/json-schemas.ts`；
- 当前 74 个 IPC registration、35 个 direct-side-effect 文件、5 个 delegating roots 和真实 production call graph。

### 2.4 明确不做

- 不修改 `src/main/db/schema.sql`、migration ledger、trigger、index 或默认数据库；
- 不新增 `command_log`、batch record、segment/index、hash chain、lease、fencing、持久化幂等结果或 v2.2 `startupRecovery`；
- 不改变 `ActionLogEntry` v1、F7 envelope-v2、EventType、payload、checksum、历史 fixture bytes 或合法 JSONL 前缀；
- 不新增或修改 renderer API、preload channel、shared `IpcApi` 响应结构、Vue 页面或路由；
- 不实现 HTTP、REST、SSE、CLI 业务入口、background worker、utilityProcess、MessagePort 或 AI 业务；
- 不改变 BASE_ABILITY 题目状态、激活合同、评分算法、报告解释或 M4 已验收证据；
- 不把 `command_id` 或 `request_hash` 写入新表、既有 payload 或事件 schema；
- 不自动 retry 普通业务命令，不把 correlation 当作 batch commit/recovery marker；
- 不读取、初始化、迁移或修改默认 `xc-career-guide.db`；
- 不自动 commit、push、merge、rebase 或发布。

## 3. 适用不变量

- `INV-EVT-001`：受控状态仍由领域事件与 reducer/projector 推进；Bus 不直接修改 session 状态。
- `INV-EVT-002`：继续保留 `JSONL append → domain_event_projection → reducer/projector` 的 legacy 顺序；M5A 不伪造命令级原子性。
- `INV-EVT-003`：不新增事件类型；所有既有事件调用必须继续进入 payload、writer、reducer、recovery 与测试链。
- `INV-SAFE-001`～`INV-SAFE-004`：安全红线继续使用 `student_id + job_code + task_code`，先熔断后归因，禁止直接插入 `REDLINE_HALTED`，生命周期和事实冻结不变。
- `INV-AUTH-001`：TEACHER/ADMIN 边界不放宽；可信身份只来自 sender-bound auth session 或固定 SYSTEM/BOOTSTRAP policy。
- `INV-AUTH-002`：assignment 的 student/device/business-session 三方一致性保持不变。
- `INV-RES-001`、`INV-RES-002`：四类结果不混算，安全结果优先。
- `INV-STR-001`、`INV-STR-002`：strategy 身份匹配及已引用版本语义不可变。
- `INV-IPC-001`、`INV-IPC-002`：74 个既有通道登记完整；renderer 不直接访问 Node、文件或数据库。
- `INV-DATA-001`：JSON TEXT 写入前继续执行当前 validator；Bus 的 structural validator 不能替代领域 JSON 合同。
- `INV-DATA-002`：不在 registry、target resolver 或 concurrency key 中硬编码策略阈值、题量或评分数据。
- `INV-DATA-003`：本阶段无 Schema 迁移；隔离临时库、legacy recovery 和历史数据兼容回归必须保留。

## 4. 变更地图

### 4.1 当前状态

1. `src/main/ipc/index.ts` 直接调用 14 个模块注册函数；各模块自行 `ipcMain.handle()`，总计 74 个 channel。
2. 当前物理分类为 28 个纯读意图与 46 个 mutation；分类尚未形成 runtime registry 和机器门禁。
3. mutation 的鉴权、参数校验、事务、`writeEvent()`、reducer/projector 和错误映射分散在 handler 文件。
4. `auth.ts`、`student.ts`、`strategy.ts`、`assessment.ts` 在首次 IPC 时 lazy seed `error_code_registry`；READ 也可能触发 seed。
5. `resolveBoundAuthSession()` 会刷新 `last_activity_at`，并在过期/禁用时持久化 `EXPIRED/REVOKED`、删除 sender binding；因此当前查询和 preflight 不是无写快照。
6. `getActionLogPath()` 隐式 `mkdirSync`；`writeEvent()` 默认获取全局数据库和默认 action-log path。
7. `reports.ts`、`safety.ts`、`job-skill-report.ts` 会分别构造 `ReportCommandCoordinator`，同一 data root 不能证明共享一个串行 guard。
8. 当前 direct-side-effect 精确基线为 35 个文件；另有 5 个不直接命中低层 sink、但拥有或委派 mutation capability 的 roots。
9. 多事件命令依赖现有 SQLite transaction 保持投影整体回滚；JSONL 第 N 条 append 后的合法前缀不可回滚，`reconcileActionLog()` 仍按单事件恢复。
10. 当前 IPC channel、preload、shared API 和 renderer 流程已经存在，本阶段只重接 Main 内部边界。

### 4.2 当前 IPC 唯一分类

| 模块 | `READ` channel | `MUTATION` channel | 数量 |
|---|---|---|---:|
| auth | `auth:getCurrentSession`、`auth:listAccounts` | `auth:login`、`auth:logout`、`auth:createTeacherAccount`、`auth:setTeacherAccountStatus` | 2 + 4 |
| student | `student:get`、`student:list` | `student:create`、`student:update`、`student:archive` | 2 + 3 |
| strategy | `strategy:list`、`strategy:get`、`strategy:listVersions` | `strategy:createVersion`、`strategy:update`、`strategy:setActive` | 3 + 3 |
| assessment core | `assessment:getSession`、`assessment:listSessions`、`assessment:listMySessions` | `assessment:createSession`、`assessment:submitAnswer`、`assessment:emotionInterrupt`、`assessment:emotionResume`、`assessment:pauseSitting`、`assessment:startNextSitting`、`assessment:recordEmotionCollapse`、`assessment:abortSession`、`assessment:triggerRedline`、`assessment:calculateResult`、`assessment:startSession` | 3 + 11 |
| ability scoring | `assessment:getOfflineAbilityScores` | `assessment:submitOfflineAbilityScores` | 1 + 1 |
| operation scoring | `assessment:getOperationScores` | `assessment:submitOperationScores` | 1 + 1 |
| job-skill scoring | `assessment:getJobSkillOfflineScores`、`assessment:getSessionScoringQuestions` | `assessment:submitJobSkillOfflineScores` | 2 + 1 |
| observation | `assessment:getTeacherObservations` | `assessment:recordTeacherObservation` | 1 + 1 |
| assignment | — | `assignment:create`、`assignment:confirmStudent`、`assignment:startAssessment`、`assignment:rebind`、`assignment:release` | 0 + 5 |
| safety | `safety:list`、`safety:get` | `safety:confirm`、`safety:resolve`、`safety:void`、`safety:replaceForFactualCorrection` | 2 + 4 |
| training | `training:listSessions`、`training:listMySessions`、`training:getSession` | `training:createSession`、`training:startStep`、`training:completeStep`、`training:skipStep`、`training:failStep`、`training:retryStep` | 3 + 6 |
| foundation | `foundation:getOverview`、`foundation:listExceptions`、`foundation:getException` | — | 3 + 0 |
| results | `results:getCurrent`、`results:listCurrentByStudent` | — | 2 + 0 |
| reports | `reports:list`、`reports:get`、`reports:listGenerationCandidates` | `reports:confirmTaskClosure`、`reports:replaceTaskClosure`、`reports:generate`、`reports:confirmPlacementReview`、`reports:lock`、`reports:export` | 3 + 6 |
| **合计** | **28** | **46** | **74** |

每个 channel 在最终 runtime registry 中必须是独立 row；上表的分组不得替代逐 channel 的 payload、actor、target、错误和测试登记。

### 4.3 当前 writer/capability 基线

**35 个 direct-side-effect 文件：**

- `BUS_COMMAND_DIRECT`（13）：`src/main/ipc/handlers/ability-scoring.ts`、`assessment.ts`、`assignment.ts`、`auth.ts`、`job-skill-result.ts`、`job-skill-scoring.ts`、`observation.ts`、`operation-scoring.ts`、`reports.ts`、`safety.ts`、`strategy.ts`、`student.ts`、`training.ts`。
- `PRODUCTION_INTERNAL_DIRECT`（19）：`src/main/db/connection.ts`、`migration-backup.ts`、`migration-startup.ts`、`migrations.ts`、`report-migration.ts`、`safety-rekey-migration.ts`；`src/main/domain/action-log-path.ts`、`assessment-reducer.ts`、`assignment-reducer.ts`、`event-writer.ts`、`local-runtime-context.ts`、`recovery.ts`、`report-errors.ts`、`report-export.ts`、`report-reducer.ts`、`report-service.ts`、`training-reducer.ts`；`src/main/index.ts`；`src/main/utils/auth-session.ts`。
- `LOW_LEVEL_PORT`（1）：`src/main/db/sqlite-adapter.ts`。
- `TEST_ONLY_EXCEPTION`（2）：`src/main/db/memory-adapter.ts`、`src/main/db/test-helpers.ts`。

**5 个 delegating roots：**

- `src/main/ipc/index.ts`；
- `src/main/ipc/handlers/job-skill-report.ts`；
- `src/main/domain/report-command-coordinator.ts`；
- `src/main/domain/task-closure-service.ts`；
- `src/main/domain/legacy-upgrade-recovery.ts`。

实施中业务逻辑会从 `src/main/ipc/handlers/` 移到 `src/main/application/services/`。机器 fixture 必须同时保存：

1. 上述 base-commit 的 `legacy_baseline`；
2. 每个旧 callsite 的 `migrated_to` owner/capability；
3. 当前 checkout 的 `active_inventory`；
4. active scan 与 inventory 的一一对应。

不得通过“代码移动后旧 35 个文件不再命中”删除迁移证据，也不得要求最终扫描仍伪造旧路径命中。

### 4.4 目标 resolver、actor 与并发合同

| 命令族 | actor policy | resolver kind 与权威来源 | client hint / 错误映射 | concurrency / retry |
|---|---|---|---|---|
| `auth:login` | `BOOTSTRAP / UNAUTHENTICATED` | `STATIC_CONTEXT`；target=`AUTH_LOGIN`，username/password 只作 accepted 后敏感 payload | credential 失败沿用 `INVALID_CREDENTIALS/ACCOUNT_DISABLED`；日志不得含密码 | sender + normalized username；`NO_AUTO_RETRY` |
| `auth:logout` | sender-bound ACTIVE `USER` | `ACTOR_SCOPED`；auth session ID 来自无写快照 | 无请求体 caller；缺失/失效沿用 auth 结果 | auth-session key；`NO_AUTO_RETRY` |
| account create/status | ACTIVE `ADMIN` | create=`CREATE_FROM_VALIDATED_REFERENCES`；status=`EXISTING_AGGREGATE(user_account)` | caller 只 compare-only；not-found/validation 沿用现有码 | username 或 teacher user ID；`NO_AUTO_RETRY` |
| student create | ACTIVE `TEACHER/ADMIN` | `CREATE_FROM_VALIDATED_REFERENCES`；校验 username、档案字段，目标为拟建 STUDENT；UUID 由 Main/application 生成 | caller 剥离；validation/username 冲突沿用现有码 | normalized username；`NO_AUTO_RETRY` |
| student update/archive | ACTIVE `TEACHER/ADMIN` | `EXISTING_AGGREGATE(student_profile)`；从 `student_profile.user_id/status` 解析 | `studentId` 是 locator；不存在=`NOT_FOUND` | student ID；`NO_AUTO_RETRY` |
| strategy create | ACTIVE `ADMIN` | `CREATE_FROM_VALIDATED_REFERENCES`；读取同族、strategy ID/version 与 JSON 合同 | strategy type/job/version 为验证候选，不信 caller | strategy family + version；`NO_AUTO_RETRY` |
| strategy update/setActive | ACTIVE `ADMIN` | `EXISTING_AGGREGATE(strategy_config)`；复合键 `strategy_id+version` | 不存在=`NOT_FOUND`；引用不可变沿用现有码 | strategy ID + version；`NO_AUTO_RETRY` |
| assessment create | ACTIVE `TEACHER/ADMIN` | `CREATE_FROM_VALIDATED_REFERENCES`；读取 student、strategy 与未解决三元 incident，target 从权威 strategy 得出 `student+job+task` | payload `studentId/strategy/task` 为候选；冲突映射现有 `NOT_FOUND/VALIDATION_ERROR` | student+job+task；`NO_AUTO_RETRY` |
| assessment existing-session mutation | 按现有 STUDENT/TEACHER/ADMIN 规则 | `EXISTING_AGGREGATE(assessment_session)`；`sessionId` 定位并读取三元键、status、strategy、owner | caller/三元 hint 不进入 payload；不存在=`NOT_FOUND`，owner mismatch=`FORBIDDEN` | assessment session ID；`NO_AUTO_RETRY` |
| training create | ACTIVE `TEACHER/ADMIN` | `CREATE_FROM_VALIDATED_REFERENCES`；读取 student、TRAINING strategy、三元 safety facts | payload 候选逐字段验证 | student+job+task；`NO_AUTO_RETRY` |
| training step mutation | 按现有 STUDENT/TEACHER/ADMIN 规则 | `EXISTING_AGGREGATE(training_session)`；由 `stepRecordId` 反查所属 session 和三元键 | session/step 不存在沿用现有码 | training session ID；`NO_AUTO_RETRY` |
| scoring / observation | ACTIVE `TEACHER/ADMIN` | `EXISTING_AGGREGATE(assessment_session)`；由 `sessionId` 读取三元键、strategy/status；question 再与 session snapshot 关联 | 客户端 caller 和可能的三元值不可信；不存在/状态沿用现有码 | assessment session ID；`NO_AUTO_RETRY` |
| assignment create | ACTIVE `TEACHER/ADMIN` | `EXISTING_AGGREGATE(business_session)`；JOIN assessment 读取 student/job/task 和当前 assignment/runtime facts | runtime ID/capability 是候选；本地 runtime 创建只在 accepted child capability | business session ID；`NO_AUTO_RETRY` |
| assignment confirm/start/rebind/release | 按现有 STUDENT 或 TEACHER/ADMIN 规则 | `EXISTING_AGGREGATE(business_session_assignment)`；JOIN grant/runtime/assessment 得到 canonical target | actor/assignment owner mismatch 沿用 `FORBIDDEN/NOT_FOUND` | assignment ID；`NO_AUTO_RETRY` |
| safety lifecycle | confirm=ACTIVE `TEACHER`；resolve/void/replace=ACTIVE `ADMIN` | `EXISTING_AGGREGATE(safety_incident)`；从 incident 读取三元键、状态、replacement facts | 请求只提供 incident locator 与待变更字段 | student+job+task；`NO_AUTO_RETRY` |
| report task closure | ACTIVE `TEACHER` | confirm：`readBaseTaskResultBinding(resultIds)`；replace：`requireClosure(oldId)` + result binding；均读取三元业务键 | result/closure 不一致=`TASK_CLOSURE_INVALID` | 复用单例 coordinator 的三元 report key；`NO_AUTO_RETRY` |
| report generate | ACTIVE `TEACHER` | 按 scope 从 task closure、result 或 incident 读取 canonical 三元 target | 三种 locator 互斥；沿用报告错误码 | 单例 report coordinator；`NO_AUTO_RETRY` |
| report lifecycle/export | ACTIVE `TEACHER` | `EXISTING_AGGREGATE(task_report)`；从 report/source 解析三元键和状态 | `reportId` 是 locator；not-found/state conflict 沿用现有码 | 单例 report coordinator；`NO_AUTO_RETRY` |
| startup/seed/migration/recovery/auth sweep | 固定 `SYSTEM` | `STATIC_CONTEXT`；phase、owner、data root 由 composition root 注入 | 不能由 IPC payload 构造 | `REPLAY_SAFE` 或 `MANUAL_REVIEW`，逐项登记 |

所有非报告业务 key 使用进程内 fail-fast active-key guard：同 key 已有 mutation 时，在任何写入前产生只在 Main 内部存在的 `CONCURRENCY_UNSAFE` 原因；不得把该内部原因泄漏成新 IPC error code。机器 registry 的 46 个 mutation row 都必须包含 `preflight_error_map`，至少逐项冻结 `NOT_READY`、`INVALID_ACTOR`、`TARGET_NOT_FOUND`、`TARGET_MISMATCH`、`ACTIVE_KEY_CONFLICT` 到该 channel 现有 public error union 的映射；不同响应族可分别映射到现有 `SYSTEM_ERROR`、`ASSESSMENT_SYSTEM_ERROR`、`TRAINING_SYSTEM_ERROR`、`ASSIGNMENT_SYSTEM_ERROR`、`SAFETY_SYSTEM_ERROR` 或既有 report error，但只能使用当前 shared 类型已声明的值。任何命令无法给出既有 public 映射时停止实施，不新增 renderer 合同。报告命令继续使用既有 coordinator 串行队列，不重复建立第二把锁。

### 4.5 目标状态

1. `createApplicationRuntime()` 在数据库初始化、legacy migration/recovery 完成后创建每 data root 唯一 runtime。
2. runtime 在对外 ready 前完成 action-log 目录准备与四组 error-code seed；任一步失败则 mutation boundary 保持关闭。
3. runtime 注入 DB、action-log path、clock、UUID、logger、无写 auth snapshot、auth maintenance、legacy mutation port 和单例 report coordinator。
4. `registerIpcHandlers(runtime)` 只通过 `registerReadHandler()` / `registerMutationHandler()` 注册 74 个 channel；普通模块不再直接调用 `ipcMain.handle()`。
5. READ 只使用无写 actor snapshot 和 query service；不 seed、不 heartbeat、不更新 session 状态、不写错误日志、不创建目录。
6. MUTATION 严格执行 registry lookup → structural validation → no-write actor snapshot → SELECT-only target resolver → canonical hash/envelope → `ACCEPTED` capability → registered maintenance/application service。
7. application service 持有业务规则和现有 transaction；它只能通过注入的 legacy mutation port 调 writer/reducer，不从全局自行构造 port。
8. startup/migration/recovery 等不伪装为普通用户 command，但都命中内部 inventory row 和 phase capability。
9. 每个事件型 mutation 将同一 envelope correlation 传给全部既有 `writeEvent()`；无事件 DB/file mutation只输出脱敏运行时 trace。
10. handler 目录不再包含直接 `writeEvent()`、受控 projection DML、report coordinator 构造或未登记 mutation capability。

### 4.6 迁移路径

```text
冻结 74/35/5 legacy inventory、active manifest 与 legacy→active mapping
  -> 建立未接线的 envelope/registry/Bus/guard 合同
  -> 建立 composition root、startup seed、无写 auth snapshot 与内部 capability
  -> 74 个 IPC 统一注册；46 mutation 先经 Bus 再调用现有 application function；运行 migration gate
  -> 按域把业务函数迁出 handler，并改为显式 capability/port 注入；每步更新 mapping/pending
  -> 收口 report/safety/job-skill automation 到同一 coordinator
  -> 删除 migration allowlist，启用 target-mode bypass gate
  -> 全量回归、独立 code review、/vibe-accept
```

scanner 固定三种互不混淆的模式：

- `baseline`：从规划基点 `40541c82ef374f28ce300365e0e5cc82423dd99a` 的 Git tree 读取源码，只验证冻结的 74/35/5 legacy 事实，不声称当前 checkout 无旁路；
- `migration`：扫描当前 checkout，对照 active manifest、legacy→active mapping 与当前步骤 expected-pending 集合；未知/重复/漂移/未映射 callsite 立即失败；
- `target`：扫描当前 checkout，并额外要求 `MIGRATION_PENDING = 0`、所有 active sink/capability 都有最终 owner。

迁移期间静态 fixture 可保留明确的 `MIGRATION_PENDING` callsite，但必须满足：

- 已经只能由 registry owner 调用；
- 每个实施步骤后集合单调缩小；
- 新增 callsite 不能自动进入 allowlist；
- Step M5A-3～M5A-10 每步同步 active manifest、legacy→active mapping 和该步 expected-pending，并实际运行 `migration` gate；
- M5A 最终验收前 `MIGRATION_PENDING` 必须为 0。

### 4.7 失败恢复路径

- Step 1–2 尚未接线：删除新增 inventory/command 模块即可，生产行为无变化。
- composition root 或 startup seed 失败：不注册 mutation handler，关闭 runtime；不退回 lazy seed。
- 单一业务域迁移失败：只回退该域 service/registry adapter，其他已迁移域保持可构建；不得绕过 Bus 恢复直接 IPC mutation。
- preflight 失败：DB、JSONL、`error_event_log`、auth session、sender binding 和 data-root 文件树不变。
- accepted 后业务失败：保留当前域既有结果/错误及已登记审计矩阵；不得误报 preflight 零副作用。
- 第 N 条 JSONL append 后 projection/reducer 失败：SQLite transaction 回滚、合法 JSONL 前缀保留；只允许 legacy recovery 按现有单事件规则恢复。
- 报告 rename 前失败：只清理当前命令拥有的 temp；rename 后 SQLite/event 失败保留并登记 orphan/error，不宣称文件与 DB 原子。
- 若实现需要 Schema、event 字段、command log、batch 或默认库操作：立即停止 M5A，转入独立 R3 feature。

### 4.8 依赖图

```text
M5A-1 legacy inventory + scanner
  -> M5A-2 envelope/registry/Bus core
      -> M5A-3 composition root + startup/auth/internal capabilities
          -> M5A-4 74-channel central registration + read/preflight boundary
              -> M5A-5 auth/student/strategy services
              -> M5A-6 training services
                  -> M5A-7 assessment services
                      -> M5A-8 scoring/observation/job-skill automation
              -> M5A-9 assignment/safety services
              -> M5A-10 reports/task-closure/export singleton path

M5A-5..10
  -> M5A-11 target bypass gate + fault matrix + full regression
      -> independent /vibe-review code + /vibe-accept
```

### 4.9 跨文件副作用登记表

| 主变更 | 必须同步登记或核验 |
|---|---|
| 74-channel registry | `ipcMain.handle` 唯一注册、preload/shared channel 集合无差异、READ/MUTATION 恰好一次、每行 payload/actor/target/`preflight_error_map`/test 字段完整 |
| Command envelope | UUID v4、UTC 毫秒、source、可信 actor、canonical target/payload、固定 hash 向量、敏感字段脱敏、correlation 透传 |
| auth snapshot | `getCurrentSession`、所有 READ、mutation preflight、heartbeat、EXPIRED/REVOKED sweep、sender binding、renderer destroyed、runtime dispose、auth tests |
| startup seed | 四组 seed owner、connection/runtime ready 顺序、失败关闭、首次 IPC 零 seed、startup tests |
| handler 业务逻辑迁移 | application service、compatibility re-export、既有测试 import、runtime registry owner、低层 port 注入、静态 import、active manifest、legacy→active mapping、expected-pending |
| legacy event port | `writeEvent`、DB/action-log 显式注入、reducer/projector、transaction owner、correlation、recovery compatibility |
| session target resolver | assessment/training/scoring/observation 的三元事实、client hint 比对、owner/role、not-found、hash 前拒绝 |
| assignment | business session/grant/runtime/assignment 三方一致、local-runtime accepted child capability、M3 tests |
| safety | M4 三元聚合、TEACHER/ADMIN FSM、trigger chain、replacement、报告 fallback、负向测试 |
| report coordinator | composition-root 单例、reports/safety/job-skill/task-closure/export 全入口、两个 TaskClosureService callsite、失败矩阵 |
| internal mutation inventory | startup、migration、M4 kernel、recovery、seed、auth sweep、action-log mkdir、E2E root、report file/error、test-only ports |
| bypass scanner | baseline Git tree、当前 checkout active manifest、legacy→active mapping、expected-pending、direct sink、`writeEvent`、projection/reducer、`runSingleEventCommand*`、coordinator construction/injection、生产 import graph、未知 callsite 负测 |
| 无 Schema/Event/API 变更 | `schema.sql`、migrations、event/shared types、preload、renderer 的 path-level diff gate |
| 新增文档与门禁命令 | `package.json`、`baseline.yaml` 命令登记、`doc/index.md` 自动索引、implementation/validation 证据 |

## 5. 实现步骤

### Step M5A-1：冻结 legacy mutation inventory 与静态扫描器

**目的与理由：**

先把当前 74 个 IPC、35 个直接副作用文件、5 个委派根和逐 callsite owner 固定为可执行 fixture，避免重构过程中因文件移动丢失入口。

**前置状态：**

- M5A PRD 已完成独立 P0/P1 清零记录；
- production 代码尚未接入 Command Bus；
- base commit 和 dirty worktree 已记录。

**完成状态：**

- fixture 精确保存 74/35/5 基线；
- active manifest 初始值与 legacy 基线一一对应，legacy→active mapping 初始全部为 `MIGRATION_PENDING`；
- 46 个 mutation 与 28 个 read 的 channel 集合可机械复算；
- 两个 `TaskClosureService.runSingleEventCommand()` callsite 分别归属 `reports:confirmTaskClosure` / `reports:replaceTaskClosure`；
- scanner 能捕获 direct DB/file/event sinks、coordinator construction/injection/call 和 test-only import；
- baseline 模式从固定 Git tree 验证后 PASS；migration 模式扫描当前 checkout，并精确报告初始 expected-pending；target 模式因 pending 非零按预期失败，不能作为通过结论。

**不得改变：**

- 不改变运行时注册、鉴权、事务、事件、Schema、默认库或报告文件；
- 不使用目录 glob 代替逐文件/逐 callsite fixture；
- 不把注释或 test fixture 当 production mutation。

**改动文件及职责：**

- `scripts/fixtures/m5a-command-boundary-legacy-v1.json`（新增）：base commit 的 74/35/5 与逐 callsite 快照。
- `scripts/fixtures/m5a-command-boundary-active-v1.json`（新增）：当前 checkout 的 active owner/callsite manifest；只允许由人工审查后的迁移步骤更新，scanner 不自动吸收新命中。
- `scripts/fixtures/m5a-command-boundary-mapping-v1.json`（新增）：每个 legacy ID 的 `legacy_path/symbol/fingerprint`、`active_owner/capability/path/symbol/fingerprint`、`status`、`migrated_in_step` 与 test evidence；初始 `status=MIGRATION_PENDING`。
- `scripts/fixtures/m5a-command-boundary-pending-v1.json`（新增）：按 `M5A-1`、`M5A-3`～`M5A-10` 冻结每步 expected-pending ID 集合，后一步必须是前一步真子集或相等且有书面理由。
- `scripts/lib/m5a-command-boundary-inventory.mjs`（新增）：源文件扫描、稳定 symbol/callsite 定位、分类与 owner 对账。
- `scripts/check-m5a-command-boundary.mjs`（新增）：`baseline` / `migration --step <step-id>` / `target` 三种模式；baseline 读取固定 Git tree，后两者扫描当前 checkout。
- `scripts/__tests__/m5a-command-boundary-inventory.test.mjs`（新增）：未知、重复、漂移、漏 capability、test-only 进入 production 等负测。
- `package.json`：登记 `contract:m5a:command-boundary:check`，初始默认执行 baseline；最终 Step M5A-11 切到 target。

**跨文件登记项：**

- [ ] 74 个 channel 恰好一次；
- [ ] 35 direct 文件与每个实际 sink callsite 一一对应；
- [ ] 5 delegating roots 均能追到 owner；
- [ ] 两个 task-closure coordinator callsite 分开登记；
- [ ] `runSingleEventCommand()`、`runSingleEventCommandSync()`、coordinator constructor 与等价 capability 都被扫描；
- [ ] `memory-adapter.ts` / `test-helpers.ts` 不进入 production import graph。

**核心设计与伪代码：**

```text
legacy = loadFixture(baseCommit)
actualChannels = scanIpcMainHandleCallsites()
actualSinks = scanDbFileEventSinks()
actualCapabilities = scanCoordinatorConstructionInjectionAndCalls()

if mode == baseline:
  baseTree = readGitTree(legacy.base_commit)
  assertExactLegacy(baseTree, legacy)
if mode == migration:
  assertExactActiveCheckout(actualChannels, actualSinks, actualCapabilities, activeManifest)
  assertCompleteLegacyToActiveMapping(legacy, activeManifest, mapping)
  assertPendingEquals(step, mapping, pendingFixture)
if mode == target:
  assertExactActiveCheckout(actualChannels, actualSinks, actualCapabilities, activeManifest)
  assertCompleteLegacyToActiveMapping(legacy, activeManifest, mapping)
  assert pending.length == 0
```

**数据、事务与失败恢复：**

只读扫描；不打开任何数据库。扫描失败只输出 repo-relative path、symbol 和差异类别。

**测试设计：**

- 单元：74/35/5 正向；漏 channel、重复 channel、同文件新增 sink、漏 task-closure callsite、未登记 coordinator 注入负向。
- 单元：临时 Git fixture 覆盖 callsite 移动、已提交/checkout 差异、active manifest 漏项、mapping 漏项、pending 非单调、alias/import capability 与 test-only production import。
- 回归：baseline 对固定基点、migration 对当前 checkout 和 `M5A-1` pending 均一致。
- 手工：NONE。

**精确验证命令：**

```bash
npm test -- scripts/__tests__/m5a-command-boundary-inventory.test.mjs
npm run contract:m5a:command-boundary:check -- --mode baseline
npm run contract:m5a:command-boundary:check -- --mode migration --step M5A-1
npm run typecheck
npm run lint
git diff --check
```

**预期证据：**

- baseline：固定 Git tree 中 74 channels、35 direct files、5 roots；
- migration：当前 checkout 与 active manifest 完全一致，pending 与 `M5A-1` fixture 完全一致；
- target：预期因 pending 非零失败，不写成 PASS，也不作为本步命令块的通过项；
- 命令退出码与测试计数记录到 step accept。

**回滚方式：** 删除新增 scanner/fixture/package script；production 行为无变化。

**停止条件：** 实际集合与已独立复核的 74/35/5 不一致且无法从当前代码解释，或 scanner 不能稳定区分 production/test/migration。

**建议 commit message：** `test(m5a): freeze command boundary inventory`

### Step M5A-2：实现未接线的 envelope、registry 与 CommandBus 核心

**目的与理由：**

先用纯模块和注入依赖固定 `ACCEPTED` 分界、canonical hash、错误、active-key guard 与脱敏 trace，避免迁移业务域时各自实现一套 Bus。

**前置状态：** Step M5A-1 `/vibe-accept` 为 `PASS`。

**完成状态：**

- Command envelope 只能由 Main factory 创建；
- registry row 类型强制 mode、actor、resolver、payload validator、transaction/retry/concurrency、side effects、逐原因 `preflight_error_map`、result/error mapper 和 test reference；
- Bus 在 preflight 全部完成前不给出 mutation capability；
- 未初始化、未知命令、非法 actor/target/payload、重复 active key 均无副作用失败；内部失败原因只能由 registry 映射为当前 public response union 已有错误码，不产生 rejected Promise 或新增 IPC 字段；
- runtime logger 只记录稳定 ID/摘要，不记录密码、答案键、完整 payload 或学生敏感文本。

**不得改变：** 不注册生产 IPC、不调用现有 mutation、不写 DB/JSONL/文件。

**改动文件及职责：**

- `src/main/application/command/command-types.ts`（新增）：envelope、actor、target、source、phase、retry/concurrency、error 类型。
- `src/main/application/command/command-envelope.ts`（新增）：UUID/clock/canonical hash/freeze 与敏感字段拒绝。
- `src/main/application/command/command-registry.ts`（新增）：typed registry、唯一性和 completeness assertion。
- `src/main/application/command/command-bus.ts`（新增）：preflight、accepted capability、dispatch、active-key lifecycle。
- `src/main/application/command/command-observability.ts`（新增）：脱敏运行时 trace。
- `src/main/application/command/public-error-contract.ts`（新增）：只引用当前 shared response union，验证 46 个 mutation 的 preflight 原因均有既有 public 映射；不新增 shared error code。
- `src/main/application/command/__tests__/{command-envelope,command-registry,command-bus}.test.ts`（新增）。

**跨文件登记项：**

- [ ] 复用 `src/main/domain/report-canonical.ts` 的 plain-object/finite-number/cycle 校验；
- [ ] 固定向量得到 `df1470b5705db8c57362264c5ad9626f83b95ce732ede593b17ac60b61cd933c`；
- [ ] `command_id` 为 UUID v4，`created_at` 为 UTC 毫秒 RFC3339；
- [ ] 顶层 correlation 默认等于 command ID，内部 child 只允许继承 correlation；
- [ ] active key 始终在 `finally` 释放；
- [ ] `ACTIVE_KEY_CONFLICT` 对每个 response family 都返回 typed `success:false` 和既有错误码，不抛 IPC rejected Promise；
- [ ] shared/preload 文件在本步相对规划基点无差异；
- [ ] logger 不持有 mutation capability。

**核心设计与伪代码：**

```text
definition = registry.require(commandType)
definition.validateStructure(rawInput)
actor = definition.resolveActorNoWrite(transport)
target = definition.resolveTargetReadOnly(db, actor, rawInput)
payload = definition.canonicalPayload(rawInput, actor, target)
envelope = buildEnvelope(commandType, actor, target, payload)
guard.acquireOrReject(definition.concurrencyKey(envelope))
capability = acceptedCapability(envelope)
return definition.execute(capability)
```

**数据、事务与失败恢复：** 无持久化；异常释放 active key。clock/UUID/logger 可注入。

**测试设计：**

- 正常：同步/异步 dispatch、内部 correlation 继承、固定 hash。
- 异常：unknown、not-ready、invalid number/object/cycle、actor/target mismatch、concurrent same key；逐 public response family 验证 typed error mapping。
- 边界：不同 key 并行允许；同 command ID 不做持久化去重。
- 安全：日志脱敏；未接受路径的 DB/file spy 为零调用。

**精确验证命令：**

```bash
npm test -- src/main/application/command/__tests__/command-envelope.test.ts src/main/application/command/__tests__/command-registry.test.ts src/main/application/command/__tests__/command-bus.test.ts
npm run typecheck
npm run lint
git diff --check
```

**预期证据：** 固定 hash、preflight 顺序、zero-call spy、guard 释放、逐响应族既有错误映射与无 rejected Promise 全部通过。

**回滚方式：** 删除未接线 command 模块和测试。

**停止条件：** canonical 规则无法与 `report-canonical.ts` 等价，或需要持久化 `command_id/request_hash` 才能完成本步。

**建议 commit message：** `feat(m5a): add command bus contracts`

### Step M5A-3：建立 composition root、startup seed 与无写 auth/internal capability

**目的与理由：**

把 data-root 级资源和所有 pre-boundary 副作用集中到唯一 runtime，在任何 IPC 对外可用前准备 seed、action-log path、auth maintenance 和报告 coordinator。

**前置状态：** Step M5A-2 `/vibe-accept` 为 `PASS`。

**完成状态：**

- `createApplicationRuntime()` 每次只为一个 DB/data root 构造一套资源；
- error-code seed 固定在 `POST_DB_INIT_PRE_BOUNDARY_READY`；首次 IPC 不再 seed；
- auth session 拆为纯读 snapshot、accepted heartbeat、独立 sweep 和显式 revoke；
- `auth:getCurrentSession` 可使用 snapshot 而不写状态或移除 binding；
- action-log directory preparation、E2E root、migration/recovery 等内部入口具有 phase/owner/capability inventory；
- `ReportCommandCoordinator` 在 runtime 中单例创建；reports、safety、job-skill automation 和经 reports 注入的 task closure 在本步全部改为接收该实例，所有 root 外生产 constructor 为零；
- coordinator 的 async queue 与 sync admission 共享同一 key 状态：sync 在同 key 有 queued/active async 时沿用既有 report failure mapping 失败，async 不得与 active sync 重叠；不能只证明对象 identity；
- coordinator constructor/consumer 的 legacy callsite 已映射到 runtime owner，`M5A-3` expected-pending 相对 M5A-1 单调收缩；
- preflight 拒绝不删除 sender binding；SYSTEM sweep 先成功持久化 EXPIRED/REVOKED 再清理对应无效 binding，DB 更新失败则 binding 保留；renderer destroyed 立即清理该 sender 的内存 binding；runtime dispose 清理 timer 和该 runtime 拥有的 binding；
- runtime dispose 清理 sweep timer 和进程内资源。

**不得改变：** 不改变账号权限、会话 TTL、IPC 返回结构、migration/recovery 算法、默认 DB。

**改动文件及职责：**

- `src/main/application/runtime/application-runtime.ts`（新增）：composition root、ready/closed 状态、resource ownership。
- `src/main/application/runtime/internal-mutation-capability.ts`（新增）：startup/seed/recovery/migration/auth-maintenance phase capability。
- `src/main/application/runtime/error-code-bootstrap.ts`（新增）：四组 seed 的唯一 startup owner。
- `src/main/application/runtime/legacy-mutation-port.ts`（新增）：封装显式 DB/action-log/correlation 的 legacy writer；factory 只允许 runtime 与 test helper 导入。
- `src/main/utils/auth-session.ts`：新增 no-write snapshot、heartbeat、sweep；旧有隐式写 resolver 仅作为迁移兼容并在 M5A-4 删除。
- `src/main/domain/action-log-path.ts`：拆出纯 path 计算与显式 directory preparation。
- `src/main/domain/report-command-coordinator.ts`：生产构造必须显式注入 event port；移除隐式默认 writer/recovery 构造。
- `src/main/ipc/handlers/reports.ts`：在不搬移报告业务逻辑的前提下由 runtime 注入 coordinator，删除本地 factory/constructor；`TaskClosureService` 继续接收同一实例。
- `src/main/ipc/handlers/safety.ts`、`job-skill-report.ts`：automation factory 改为显式接收 runtime coordinator，删除本地 constructor；原业务函数和响应保持不变。
- `scripts/fixtures/m5a-command-boundary-{active,mapping,pending}-v1.json`：更新 coordinator 构造/注入/调用的 active owner、`migrated_in_step=M5A-3` 与 expected-pending。
- `src/main/index.ts`、`src/main/ipc/index.ts`：数据库 ready 后创建 runtime，退出时 dispose；本步可暂时把 runtime 传给 legacy registration。
- 相应 runtime/auth/startup/report coordinator tests。

**跨文件登记项：**

- [ ] seed functions 从 handler owner 移到 bootstrap；
- [ ] seed 失败时 0 个 mutation handler 对外 ready；
- [ ] no-write snapshot 对 expired/disabled 只返回结果，不 UPDATE/DELETE binding；
- [ ] heartbeat 只由 accepted authenticated mutation 调用；
- [ ] sweep 使用 SYSTEM capability，固定间隔可注入、测试后 dispose；
- [ ] sweep DB 成功后才清理失效 binding；DB 失败保留 binding；renderer destroyed/runtime dispose 的 owner 与顺序有测试；
- [ ] READ 永不触发 action-log path directory preparation；
- [ ] coordinator constructor 只在 runtime 和 test helper 白名单；reports/safety/job-skill/task-closure 严格共享 runtime 实例；
- [ ] sync/async 同 key admission 不能重叠，不同 key 保留现有并行语义。

**数据、事务与失败恢复：**

seed 使用现有 `INSERT OR IGNORE` 幂等语义；失败保持 boundary closed。sweep 每轮独立短事务，失败记录运行时错误并保持下一轮可重试，不由用户请求触发。

**测试设计：**

- startup seed 成功/重复/失败关闭；首次 IPC seed spy=0。
- snapshot 对 ACTIVE/EXPIRED/REVOKED/DISABLED 的 DB 与 binding 前后不变。
- accepted heartbeat 更新一次；READ 不更新。
- sweep 持久化 EXPIRED/REVOKED 且不接收 renderer 输入；覆盖 DB 失败时 binding 保留、DB 成功后 binding 清理。
- renderer destroyed 清理对应 binding；runtime 同 data root 重复构造失败，dispose 后 timer 与 runtime-owned binding 清理。
- report coordinator 所有 runtime consumers 获得同一实例；静态 constructor/import gate 为零旁路；sync/async 同 key 交叉进入负测。

**精确验证命令：**

```bash
npm test -- src/main/application/runtime/__tests__ src/main/utils/__tests__/auth-context.test.ts src/main/ipc/handlers/__tests__/auth.test.ts src/main/domain/__tests__/report-coordinator.test.ts src/main/__tests__/startup-error.test.ts
npm run contract:m5a:command-boundary:check -- --mode migration --step M5A-3
npm run typecheck
npm run lint
git diff --check
```

**预期证据：** seed 时序、snapshot 零写、heartbeat/sweep/binding 生命周期、唯一 coordinator construction、四类 consumer identity、sync/async 同 key admission 与 dispose 均有自动证据。

**回滚方式：** 恢复旧 startup/seed/auth resolver 与 coordinator 构造；不回滚或删除已存在 seed rows。

**停止条件：** 需要修改 `auth_session` Schema、用用户请求触发 sweep、不能在 IPC ready 前完成 seed、或不能在本步一次消除全部 root 外生产 coordinator construction。

**建议 commit message：** `feat(m5a): compose mutation runtime`

### Step M5A-4：统一 74-channel 注册并接通 READ/preflight boundary

**目的与理由：**

先让所有生产 IPC 的注册与 mutation acceptance 经过同一个入口，再按业务域迁移内部实现；避免迁移期间出现新的未分类 channel。

**前置状态：** Step M5A-3 `/vibe-accept` 为 `PASS`。

**完成状态：**

- 普通 handler 模块不再直接 `ipcMain.handle()`；
- `src/main/ipc/handler-registry.ts` 一次注册 74 个 channel；
- 28 个 READ 使用无写 actor snapshot/query service，不取得 mutation capability；
- 46 个 MUTATION 全部完成结构校验、可信 actor、权威 target、hash、guard 和 accepted boundary 后才调用现有业务函数；
- 46 个 MUTATION 的 `preflight_error_map` 全部冻结到当前 public response union；active-key 冲突返回 typed `success:false`，不泄漏内部错误、不 reject IPC Promise；
- caller 字段只在 transport compare-only 层出现，canonical payload 和 application params 使用可信 actor；
- 未知/重复 channel、registry 不完整或 boundary not-ready 失败关闭；
- 当前业务响应和 preload/shared API 无差异。

**不得改变：** 本步不搬移业务 SQL/事件逻辑，不改变事务或错误码；`MIGRATION_PENDING` 只允许指向已由 Bus 调用的已登记 application function。

**改动文件及职责：**

- `src/main/ipc/handler-registry.ts`（新增）：唯一 `ipcMain.handle` owner、read/mutation adapter 和结果映射。
- `src/main/application/command/m5a-command-definitions.ts`（新增）：74 个逐 channel definitions；46 个 mutation resolver/validator/mapper。
- `src/main/application/query/m5a-read-definitions.ts`（新增）：28 个无副作用 query definitions。
- `src/main/ipc/index.ts`：只调用 central registry。
- `src/main/ipc/handlers/*.ts`：删除各自 registration block；暂时 re-export application functions供 definitions/legacy tests 使用。
- `scripts/fixtures/m5a-command-boundary-{active,mapping,pending}-v1.json`：登记中央注册后的 active callsite、74 个旧 registration 的迁移映射与 `M5A-4` expected-pending。
- command registry、IPC registration、preflight zero-side-effect tests。

**跨文件登记项：**

- [ ] channel 集合与 `src/preload/index.ts`、`src/shared/types/ipc-api.ts` 精确一致；
- [ ] 46 resolver 都只 SELECT/内存规范化；
- [ ] target mismatch/not-found 在 hash、guard、heartbeat、logger acceptance 前；
- [ ] 28 READ 不调用 seed、heartbeat、error writer、action-log path 或 coordinator；
- [ ] 现有 caller 与 trusted actor 不一致时按该 channel 既有响应失败；
- [ ] 46 行分别覆盖 not-ready、invalid actor、not-found、target mismatch、active-key conflict 的既有 public error mapping；
- [ ] 未迁移业务函数只能由 command definition owner 进入 production import graph。

**核心设计与伪代码：**

```text
for definition in all74:
  if READ: ipcMain.handle(channel, event => readAdapter(definition, event))
  if MUTATION: ipcMain.handle(channel, event => mutationAdapter(bus, definition, event))

assert channelCount == 74
assert readCount == 28
assert mutationCount == 46
```

**数据、事务与失败恢复：** preflight 无写；accepted 后仍调用原业务 transaction。registry 构建失败时不注册任何 channel。

**测试设计：**

- 74/28/46 exact-set；重复/漏项负测。
- unknown command、boundary closed、invalid payload、actor invalid、target missing/mismatch。
- active-key conflict 对所有现有 public response family 生成契约测试：typed `success:false`、既有 error code、无 rejected Promise、无副作用。
- 每个拒绝场景比较 auth/error/业务/投影表、JSONL 和文件树 hash 不变，sender binding 不变。
- 全部 read channel spy 断言 0 mutation capability/heartbeat/seed。
- preload/shared compatibility typecheck。

**精确验证命令：**

```bash
npm test -- src/main/ipc/__tests__/handler-registry.test.ts src/main/application/command/__tests__/preflight-no-side-effect.test.ts src/main/ipc/handlers/__tests__/auth.test.ts src/main/ipc/handlers/__tests__/student-read.test.ts src/main/ipc/handlers/__tests__/strategy-read.test.ts src/main/ipc/handlers/__tests__/assessment-read.test.ts
npm run contract:m5a:command-boundary:check -- --mode migration --step M5A-4
npm run typecheck
npm run lint
git diff --check
```

**预期证据：** 74/28/46、拒绝前状态 hash、READ 零 capability、逐响应族 concurrency mapping、当前 checkout active/mapping/pending 对账和 API diff 为零。

**回滚方式：** 恢复模块 registration blocks 与旧 `registerIpcHandlers()`；只允许在本步尚未与后续服务迁移混合时回滚。

**停止条件：** 任一 mutation 无法定义纯读 target resolver/既有错误映射，或必须信任请求体 caller/三元键。

**建议 commit message：** `feat(m5a): route ipc through command registry`

### Step M5A-5：迁移 auth、student、strategy application services

**目的与理由：**

先收口无领域事件但有直接 DML/审计的基础 mutation，验证 accepted capability、actor、target 和 post-accept side-effect 模式。

**前置状态：** Step M5A-4 `/vibe-accept` 为 `PASS`。

**完成状态：**

- 4 个 auth、3 个 student、3 个 strategy mutation 的业务逻辑位于 application services；
- handler 文件只有 transport re-export/compatibility surface，无直接 DML、seed、auth maintenance 或 error writer；
- login 失败审计、账号/学生/策略 error log 明确标记为 accepted 后副作用；
- create/status/update 的目标与 actor 在 accepted 前冻结，领域内部保留 TOCTOU 防御和现有事务；
- auth/student/strategy 的 legacy callsite 均有 active owner 映射，`M5A-5` expected-pending 相对 M5A-4 单调收缩；
- 既有返回结构、权限和错误码不变。

**不得改变：** 不把 student/strategy DML伪装成领域事件，不新增事件或审计表，不更改密码算法。

**改动文件及职责：**

- `src/main/application/services/auth-service.ts`、`student-service.ts`、`strategy-service.ts`（新增/迁移）。
- 对应 query service/command definitions：调用 typed execution context。
- `src/main/ipc/handlers/{auth,student,strategy}.ts`：薄 adapter/compatibility re-export。
- 原 handler tests 更新为 service/test-runtime 注入，并增加 Bus 集成测试。
- `scripts/fixtures/m5a-command-boundary-{active,mapping,pending}-v1.json`：更新三域 active owner、`migrated_in_step=M5A-5` 与 expected-pending。

**跨文件登记项：**

- [ ] auth login/revoke/binding/error log 各自 owner；
- [ ] student account+profile transaction 与审计失败矩阵；
- [ ] strategy JSON validator、引用不可变与逐字段 update 事务事实；
- [ ] accepted heartbeat 不在 transaction 失败时伪装回滚；
- [ ] 10 个 registry row 的 transaction/retry/concurrency/test 字段齐全。
- [ ] 三域每个 legacy sink/capability ID 恰好映射到一个 active owner，未迁移集合与 fixture 精确一致。

**数据、事务与失败恢复：** 保留现有 DB transaction topology；error log 的非原子事实逐命令登记。回滚只恢复 service routing，不删除已写业务/审计行。

**测试设计：** 复跑 auth/student/strategy 全部现有测试；新增 Bus 正常、权限、target mismatch、重复 active key、accepted 后审计矩阵。

**精确验证命令：**

```bash
npm test -- src/main/ipc/handlers/__tests__/auth.test.ts src/main/ipc/handlers/__tests__/student-create.test.ts src/main/ipc/handlers/__tests__/student-mutate.test.ts src/main/ipc/handlers/__tests__/student-read.test.ts src/main/ipc/handlers/__tests__/strategy-create-version.test.ts src/main/ipc/handlers/__tests__/strategy-update.test.ts src/main/ipc/handlers/__tests__/strategy-set-active.test.ts src/main/ipc/handlers/__tests__/strategy-read.test.ts src/main/application/services/__tests__/account-command-bus.test.ts
npm run contract:m5a:command-boundary:check -- --mode migration --step M5A-5
npm run typecheck
npm run lint
git diff --check
```

**预期证据：** 10 个 mutation 经 Bus，权限/返回兼容，handler direct sink 与 expected-pending 精确单调下降且无未知 active callsite。

**回滚方式：** 恢复三域旧 service routing；保留 startup seed 和 central registry。

**停止条件：** preflight 必须写 error log/seed 才能返回，或需要改变 shared auth/student/strategy API。

**建议 commit message：** `refactor(m5a): move account commands behind bus`

### Step M5A-6：迁移 training application service

**目的与理由：**

收口 training create 与五个 step mutation，并先建立 assessment redline 所依赖的 training halt application capability。

**前置状态：** Step M5A-5 `/vibe-accept` 为 `PASS`。

**完成状态：**

- training business functions 移到 `src/main/application/services/training-service.ts`；
- 6 个 mutation 经 injected legacy mutation port 写事件/投影；
- 3 个 training READ 保持 query-only；
- `haltTrainingSessionSteps` 只能作为已登记 assessment/safety accepted child capability 调用；
- 所有事件透传 command correlation，事务和 reducer 顺序不变。
- training legacy callsite 均有 active owner 映射，`M5A-6` expected-pending 相对 M5A-5 单调收缩。

**不得改变：** training FSM、step 状态、完成率、M4 三元阻断、事件类型和响应结构。

**改动文件及职责：**

- `src/main/application/services/training-service.ts`（新增/迁移）。
- `src/main/application/query/training-query-service.ts`（新增/迁移读逻辑）。
- `src/main/ipc/handlers/training.ts`：薄 adapter/re-export。
- training command definitions、target resolvers、tests。
- `scripts/fixtures/m5a-command-boundary-{active,mapping,pending}-v1.json`：更新 training active owner、迁移步骤与 expected-pending。

**跨文件登记项：**

- [ ] create 从 strategy 解析 job，使用 student+job+task concurrency key；
- [ ] stepRecordId 反查 training session；
- [ ] `writeEvent → applyTrainingEvent` 顺序与 transaction owner；
- [ ] halt child owner/phase/correlation；
- [ ] training reducer/recovery tests 不变。
- [ ] training 每个 legacy sink/capability ID 恰好映射到 active owner，迁移 gate 无未知命中。

**测试设计：** create、steps、complete、redline、target/actor mismatch、correlation 与 rollback。

**精确验证命令：**

```bash
npm test -- src/main/ipc/handlers/__tests__/training-create.test.ts src/main/ipc/handlers/__tests__/training-steps.test.ts src/main/ipc/handlers/__tests__/training-complete.test.ts src/main/ipc/handlers/__tests__/training-redline.test.ts src/main/domain/__tests__/training-reducer.test.ts src/main/application/services/__tests__/training-command-bus.test.ts
npm run contract:m5a:command-boundary:check -- --mode migration --step M5A-6
npm run typecheck
npm run lint
git diff --check
```

**预期证据：** 6 mutation/3 read 分类、child halt owner、同 correlation、SQLite rollback、active mapping 与 expected-pending 通过。

**回滚方式：** 恢复 training service routing；不回退 central registry/auth boundary。

**停止条件：** training halt 必须绕过 accepted parent capability，或事务拆分会改变现有结果。

**建议 commit message：** `refactor(m5a): move training commands behind bus`

### Step M5A-7：迁移 assessment core application service

**目的与理由：**

收口 11 个 assessment mutation，保持 session 事件链、M4 红线、坐次、结果计算和多事件 SQLite transaction。

**前置状态：** Step M5A-6 `/vibe-accept` 为 `PASS`。

**完成状态：**

- assessment core 业务逻辑移到 application service；
- 所有 session mutation 从 `sessionId` 或已验证创建引用得到 canonical 三元 target；
- trusted actor 覆盖 caller，STUDENT owner 和 TEACHER/ADMIN 权限保持现状；
- `triggerRedline` 继续先写安全事件并由 M4 trigger 熔断，同 accepted parent correlation 调用 training halt；
- 多事件 sitting/collapse/result 路径继续在当前 SQLite transaction 内整体提交/回滚；
- 3 个 assessment READ 为 query-only。
- assessment core legacy callsite 均有 active owner 映射，`M5A-7` expected-pending 相对 M5A-6 单调收缩。

**不得改变：** paper generation、question snapshot、score/level 计算、M4 trigger 责任、现有事件顺序或 JSONL recovery 边界。

**改动文件及职责：**

- `src/main/application/services/assessment-service.ts`（新增/迁移）。
- `src/main/application/query/assessment-query-service.ts`（新增/迁移）。
- `src/main/ipc/handlers/assessment.ts`：薄 adapter/re-export。
- assessment target resolvers、structural contracts、Bus integration tests。
- `scripts/fixtures/m5a-command-boundary-{active,mapping,pending}-v1.json`：更新 assessment core active owner、迁移步骤与 expected-pending。

**跨文件登记项：**

- [ ] create strategy/student/safety refs 与 target；
- [ ] session owner/role 与三元 canonical target；
- [ ] 事件 correlation 覆盖 single/multi-event paths；
- [ ] `applyAssessmentEvent`、training halt、result calculation 的 transaction owner；
- [ ] safety trigger 不直接 INSERT `REDLINE_HALTED`；
- [ ] 既有 error code/result response 无差异。
- [ ] assessment core 每个 legacy sink/capability ID 恰好映射到 active owner，迁移 gate 无未知命中。

**测试设计：** assessment create/start/answer/emotion/sitting/abort/redline/result/read 全部现有测试；新增 forged hint、not-found/hash-before-reject、correlation 和 transaction rollback。

**精确验证命令：**

```bash
npm test -- src/main/ipc/handlers/__tests__/assessment-create.test.ts src/main/ipc/handlers/__tests__/assessment-start-session.test.ts src/main/ipc/handlers/__tests__/assessment-answer.test.ts src/main/ipc/handlers/__tests__/assessment-emotion.test.ts src/main/ipc/handlers/__tests__/assessment-redline.test.ts src/main/ipc/handlers/__tests__/assessment-ability-scoring.test.ts src/main/ipc/handlers/__tests__/assessment-read.test.ts src/main/domain/__tests__/assessment-reducer.test.ts src/main/application/services/__tests__/assessment-command-bus.test.ts
npm run contract:m5a:command-boundary:check -- --mode migration --step M5A-7
npm run contract:m4:safety-sql:check
npm run typecheck
npm run lint
git diff --check
```

**预期证据：** 11 mutation/3 read、三元安全负测、所有 event correlation、SQLite rollback、active mapping 与 expected-pending 通过。

**回滚方式：** 恢复 assessment service routing；training child capability 保留。

**停止条件：** 必须改变 event payload/Schema、信任客户端三元键，或安全熔断需移出当前 trigger 链。

**建议 commit message：** `refactor(m5a): move assessment commands behind bus`

### Step M5A-8：迁移 scoring、observation 与 job-skill completion/automation

**目的与理由：**

收口 ability、operation、job-skill scoring 和 observation 的 4 个 IPC mutation，以及它们委派的 result/report automation，保留多事件事务和报告 fallback。

**前置状态：** Step M5A-7 `/vibe-accept` 为 `PASS`。

**完成状态：**

- 四个 mutation 从 session 权威事实解析三元 target；
- ability/operation/job-skill 多事件 path 的每条事件使用同一 correlation；
- `finalizeJobSkillResultCore` 与 `maybeGenerateJobSkillReportAfterResult` 只接受 accepted parent context；
- job-skill report automation 使用 runtime 单例 coordinator，不自行 new；
- 5 个 scoring/observation READ 保持 query-only；
- 真实临时 JSONL 第 N 次失败测试固定 SQLite 全回滚、N 条合法前缀和逐事件 recovery 事实。
- scoring/observation/job-skill automation legacy callsite 均有 active owner 映射，`M5A-8` expected-pending 相对 M5A-7 单调收缩。

**不得改变：** 评分题量/阈值/结果类型、JOB_SKILL completion、报告内容、JSONL prefix 或 recovery 算法。

**改动文件及职责：**

- `src/main/application/services/{ability-scoring,operation-scoring,job-skill-scoring,observation,job-skill-result,job-skill-report}-service.ts`（新增/迁移）。
- 对应 query services 与 command definitions。
- 原 `src/main/ipc/handlers/` 文件变为薄 adapter/re-export。
- `src/main/domain/event-writer.ts`/legacy port：提供可注入第 N 次故障测试点，不改变生产格式。
- scoring/automation/failure-injection tests。
- `scripts/fixtures/m5a-command-boundary-{active,mapping,pending}-v1.json`：更新 scoring/observation/job-skill active owner、迁移步骤与 expected-pending。

**跨文件登记项：**

- [ ] `sessionId` → assessment session 三元 target；
- [ ] score question 与 session snapshot 一致性；
- [ ] 9+1 operation、ability batch、job-skill/observation finalize 的 transaction owner；
- [ ] result/report child owner、correlation、错误隔离；
- [ ] report automation coordinator identity 与 runtime 相同；
- [ ] recovery 明确不按 correlation 补齐事件。
- [ ] 本域每个 legacy sink/capability ID 恰好映射到 active owner，迁移 gate 无未知 coordinator/capability 命中。

**数据、事务与失败恢复：** 保留现有 SQLite transaction；JSONL append 不回滚。第 N 次故障只在显式临时 action-log 测试注入。

**测试设计：** 所有评分/observation/job-skill result/report tests；真实 JSONL `1 < N < total` 故障与 recovery；不同 job 安全隔离。

**精确验证命令：**

```bash
npm test -- src/main/ipc/handlers/__tests__/assessment-ability-scoring.test.ts src/main/ipc/handlers/__tests__/operation-scoring.test.ts src/main/ipc/handlers/__tests__/job-skill-scoring.test.ts src/main/ipc/handlers/__tests__/observation.test.ts src/main/ipc/handlers/__tests__/job-skill-result.test.ts src/main/ipc/handlers/__tests__/job-skill-report.test.ts src/main/domain/__tests__/recovery.test.ts src/main/domain/__tests__/legacy-upgrade-recovery.test.ts src/main/application/services/__tests__/multi-event-command-failure.test.ts
npm run contract:m5a:command-boundary:check -- --mode migration --step M5A-8
npm run contract:m4:safety-sql:check
npm run typecheck
npm run lint
git diff --check
```

**预期证据：** 4 mutation、5 read、同 correlation、N 条前缀、SQLite rollback、逐事件 recovery、active mapping 与 expected-pending 均被测试固定。

**回滚方式：** 恢复六个 service routing；不得删除测试产生的事实合同或改写 legacy logs。

**停止条件：** 需要补偿/截删合法 JSONL、按 correlation group recovery，或引入 batch/command log。

**建议 commit message：** `refactor(m5a): route scoring commands through bus`

### Step M5A-9：迁移 assignment 与 safety application services

**目的与理由：**

收口多设备 assignment、local runtime child mutation 和安全 FSM，验证跨域 actor/target/capability 与 M4 三元负向门禁。

**前置状态：** Step M5A-8 `/vibe-accept` 为 `PASS`。

**完成状态：**

- 5 个 assignment、4 个 safety mutation 经 application services；
- assignment resolver 从 business session/assignment/grant/runtime 权威事实生成 target；
- local runtime 创建只由 accepted assignment child capability 触发；
- safety confirm 只允许 TEACHER，resolve/void/replace 只允许 ADMIN；
- safety report fallback 使用 runtime 单例 coordinator并继承 correlation；
- 同 student/task 不同 job 隔离，同三元 assessment/training 同时熔断。
- assignment/safety legacy callsite 均有 active owner 映射，`M5A-9` expected-pending 相对 M5A-8 单调收缩。

**不得改变：** M3 grant/assignment FSM、M4 Schema/trigger、safety lifecycle、replacement transaction 或报告安全优先级。

**改动文件及职责：**

- `src/main/application/services/assignment-service.ts`、`safety-service.ts`（新增/迁移）。
- assignment/safety query service、target resolvers、command definitions。
- `src/main/ipc/handlers/{assignment,safety}.ts`：薄 adapter/re-export。
- `src/main/domain/local-runtime-context.ts`：要求显式 accepted child/internal capability。
- assignment/safety/report integration tests。
- `scripts/fixtures/m5a-command-boundary-{active,mapping,pending}-v1.json`：更新 assignment/safety active owner、迁移步骤与 expected-pending。

**跨文件登记项：**

- [ ] assignment create/rebind 的 runtime child owner；
- [ ] STUDENT confirm/start owner 检查；
- [ ] grant/assignment/session target 一致；
- [ ] safety actor policy、三元 target、incident status；
- [ ] F7 safety mutation/report fallback coordinator identity；
- [ ] direct REDLINE_HALTED insert 为零。
- [ ] 两域每个 legacy sink/capability ID 恰好映射到 active owner，迁移 gate 无未知 local-runtime/report capability 命中。

**测试设计：** assignment、local runtime、safety lifecycle、assessment/training redline、cross-job、report integration、actor/target mismatch。

**精确验证命令：**

```bash
npm test -- src/main/ipc/handlers/__tests__/assignment.test.ts src/main/domain/__tests__/local-runtime-context.test.ts src/main/ipc/handlers/__tests__/safety.test.ts src/main/ipc/handlers/__tests__/assessment-redline.test.ts src/main/ipc/handlers/__tests__/training-redline.test.ts src/main/ipc/handlers/__tests__/report-integration.test.ts src/main/db/__tests__/schema-m4-safety-rekey.test.ts
npm run contract:m5a:command-boundary:check -- --mode migration --step M5A-9
npm run contract:m4:safety-sql:check
npm run typecheck
npm run lint
git diff --check
```

**预期证据：** 9 mutation、M3/M4 正负向、角色 FSM、单例 coordinator、correlation、active mapping 与 expected-pending 通过。

**回滚方式：** 恢复 assignment/safety service routing；不回滚 runtime 或已迁移其他域。

**停止条件：** local runtime 必须在 preflight 创建，或 safety command 必须绕过三元 target/现有 trigger。

**建议 commit message：** `refactor(m5a): route assignment and safety through bus`

### Step M5A-10：迁移 reports、task closure 与文件导出单例路径

**目的与理由：**

完成最后 6 个业务 mutation，把 report/task-closure/export 与所有 automation 收口到同一 runtime coordinator，并固定文件/SQLite 部分失败矩阵。

**前置状态：** Step M5A-9 `/vibe-accept` 为 `PASS`。

**完成状态：**

- reports handler 为纯 transport；3 个 READ query-only，6 个 MUTATION 经 Bus；
- `confirmBaseTaskClosure()` / `replaceBaseTaskClosure()` 两个 callsite 各自命中 registry owner；
- reports、safety、job-skill automation、task closure、export 全部使用同一 coordinator identity；
- correlation 从 command envelope 透传到 F7 intent；
- export temp/write/hash/rename/event/error/cleanup 顺序与 owner 清楚；
- rename、append、SQLite、cleanup 各故障点均不静默成功，不删除非本命令 artifact。
- report/task-closure/export legacy callsite 均有 active owner 映射，`M5A-10` expected-pending 收缩到只剩 Step 11 明确关闭的 infrastructure/compatibility 项；若业务 pending 非零则本步失败。

**不得改变：** F7 payload/schema-v2、report contract、write gate、task-closure lineage、导出格式或用户响应。

**改动文件及职责：**

- `src/main/application/services/reports-service.ts`（新增/迁移 IPC application functions）。
- `src/main/application/query/reports-query-service.ts`（新增/迁移 reads）。
- `src/main/ipc/handlers/reports.ts`、`job-skill-report.ts`：薄 adapter/re-export。
- `src/main/domain/{report-command-coordinator,task-closure-service,report-service,report-export,report-errors}.ts`：显式 runtime capability/correlation，禁止自行构造 coordinator。
- reports/task-closure/coordinator/export integration and failure tests。
- `scripts/fixtures/m5a-command-boundary-{active,mapping,pending}-v1.json`：更新 report/task-closure/export active owner、迁移步骤与 expected-pending。

**跨文件登记项：**

- [ ] 2 个 task-closure callsite 的 owner/target/actor/phase/transaction/retry/concurrency/correlation/test；
- [ ] report scope 三种 target resolver；
- [ ] coordinator constructor production callsite 只有 composition root；
- [ ] report file capability 只拥有本次 temp/final artifact；
- [ ] error log 脱敏；
- [ ] F7 recovery/write gate 回归。
- [ ] report/task-closure/export 每个 legacy sink/capability ID 恰好映射到 active owner，业务 `MIGRATION_PENDING=0`。

**数据、事务与失败恢复：** report coordinator 保留现有 per-key serialization 与 SQLite transaction；文件系统与 SQLite 不宣称原子。cleanup 只对 owner token 标记的路径执行。

**测试设计：** list/get/candidates、task closure confirm/replace、generate/review/lock/export、coordinator cross-entry serialization、rename/event/DB/cleanup 故障、F7 recovery gate。

**精确验证命令：**

```bash
npm test -- src/main/ipc/handlers/__tests__/reports.test.ts src/main/ipc/handlers/__tests__/report-export.test.ts src/main/ipc/handlers/__tests__/report-integration.test.ts src/main/domain/__tests__/task-closure-service.test.ts src/main/domain/__tests__/report-coordinator.test.ts src/main/domain/__tests__/report-export.test.ts src/main/domain/__tests__/report-write-gate.test.ts src/main/domain/__tests__/report-generation.test.ts
npm run contract:m5a:command-boundary:check -- --mode migration --step M5A-10
npm run typecheck
npm run lint
git diff --check
```

**预期证据：** 6 mutation/3 read、两个 callsite owner、单例 identity、correlation、完整失败矩阵、active mapping 与业务 pending 清零通过。

**回滚方式：** 恢复 report service routing；不得删除已导出文件或历史 report/event。

**停止条件：** 无法保证同 data root 单例 coordinator，或需要假称文件/SQLite 原子才能通过验收。

**建议 commit message：** `refactor(m5a): unify report command boundary`

### Step M5A-11：关闭所有 bypass、执行全量回归并形成里程碑证据

**目的与理由：**

移除迁移期 allowlist，以真实 checkout 证明所有 mutation、writer、内部 capability 和调用图已经收口，并执行 R3 全量门禁。

**前置状态：** Step M5A-5 至 M5A-10 的 `/vibe-accept` 均为 `PASS`。

**完成状态：**

- `MIGRATION_PENDING = 0`；
- target-mode scanner PASS：74/28/46、active writer inventory、5 个 legacy roots 的迁移映射、两个 task-closure callsite、coordinator/capability 反查均闭合；
- handler 目录无 direct writer、projection DML、coordinator construction 或未分类 `ipcMain.handle()`；
- preflight zero-side-effect、multi-event JSONL prefix、report failure matrix、M4 cross-job、安全权限和响应兼容全通过；
- Schema/migration/event payload/preload/shared API/default DB 均未改变；
- 合同不变门禁以规划基点 `40541c82ef374f28ce300365e0e5cc82423dd99a` 同时覆盖早期 commit、index、working tree 和受限路径下未跟踪文件，不依赖无参数 `git diff`；
- 新 gate 写入 `baseline.yaml`，文档索引 current；
- 独立 `/vibe-review code` 无 P0/P1，最终 `/vibe-accept` 为 `PASS` 后，M5A 才可标记 `ACCEPTED_STEP_2B`。

**不得改变：** 不因门禁失败扩大到 M5B、默认 DB 修复或 BASE_ABILITY；不把 NOT_RUN 写成 PASS。

**改动文件及职责：**

- `scripts/check-m5a-command-boundary.mjs`、active inventory：默认切换 target mode，删除迁移 allowlist。
- `scripts/verify-m5a-contract-scope.mjs`、`scripts/__tests__/m5a-contract-scope.test.mjs`（新增）：相对固定规划基点检查禁止变化路径，分别覆盖 committed/index/worktree/untracked；同时输出全里程碑 name-status 供审查。
- `scripts/verify-m5a-isolated-db.mjs`、`scripts/__tests__/m5a-isolated-db.test.mjs`（新增）：内部创建 `/tmp` 隔离根，以显式路径调用 content-pack sync 和 DB verify；不导入/解析默认 DB path，失败保留证据根并返回非零。
- `package.json`、`doc/specs/baseline.yaml`：登记最终 gate 命令；在 Accept PASS 前不把 Schema/工程状态声称为已验收。
- `doc/features/m5a-command-bus-boundary-validation.md`（新增）：逐门禁 PASS/FAIL/NOT_RUN/BLOCKED 证据。
- `doc/features/m5a-command-bus-boundary-prd.md`、本实施计划、`.continue-here.md`、`doc/会话启动.md`：只在独立 review/accept 后同步真实状态与下一里程碑。
- `doc/index.md`：索引脚本更新。

**跨文件登记项：**

- [x] 相对固定规划基点的 committed/index/worktree/untracked 四层门禁证明 `schema.sql`、全部 migration、event/shared types、preload/renderer API 无变化；
- [x] 不检查、读取或修改默认 DB；
- [x] 全量 test/build/typecheck/lint；
- [x] 隔离临时 DB/data root 的 db verify、M4 SQL gate、Electron smoke；
- [x] 文档索引 update/check；
- [x] 独立 code review 与 accept 状态分开记录。

**核心设计与伪代码：**

```text
assert migrationPending.length == 0
assert exactChannelClassification(74, 28, 46)
assert everyCurrentSinkHasInventoryOwner()
assert everyCapabilityConstructionInjectionCallHasOwner()
assert noHandlerDirectMutation()
assert noForbiddenContractDiff()
runFullGatesOnIsolatedRoots()
```

**数据、事务与失败恢复：** 所有 DB/文件验证使用 `mktemp -d` 下显式路径；失败保留证据目录直到诊断完成，不访问默认 userData。

**测试设计：**

- 全部定向和全量 Vitest；
- typecheck/lint/build；
- scanner 负向 fixtures；
- contract-scope 临时 Git fixture 覆盖早期 commit、index、working tree、untracked 四种越界；
- isolated-db helper 覆盖临时根 sync+verify、初始化失败不回退默认路径和失败证据保留；
- 隔离 schema/content/M4 gate；
- Electron 临时 userData 的核心 mutation smoke；
- 默认数据库存在状态/hash不读取，本轮直接记为按边界未操作。

**精确验证命令：**

```bash
npm run contract:m5a:command-boundary:check -- --mode target
npm run contract:m5a:scope:check -- --base 40541c82ef374f28ce300365e0e5cc82423dd99a
npm run db:m5a:isolated:verify
npm run typecheck
npm run lint
npm test
npm run build
npm run contract:m4:safety-sql:check
npm run db:m4:verify
npm run db:m4:native:verify
npm run e2e:m4:ui
npm run docs:index:update
npm run docs:index:check
git diff --check 40541c82ef374f28ce300365e0e5cc82423dd99a
git diff --cached --check 40541c82ef374f28ce300365e0e5cc82423dd99a
git diff --name-status 40541c82ef374f28ce300365e0e5cc82423dd99a
git status --short --untracked-files=all
```

`contract:m5a:scope:check` 的禁止变化集合至少包括 `src/main/db/schema.sql`、现有 production migration/startup/backup 源文件、`src/shared/**`、`src/preload/**` 和 `src/renderer/**`。helper 必须分别比较 `base..HEAD`、base→index、base→working tree，并拒绝上述路径下的未跟踪文件；其他未跟踪文件仍输出到最终 status 供人工范围审查，不能静默忽略。

`npm run db:m5a:isolated:verify` 是本里程碑唯一的 content-pack DB 验证入口：helper 必须自行 `mkdtemp`，将生成的绝对 DB path 同时显式传给 `syncDatabase()` 与 `verifyDatabase()`，且代码中不得调用 `resolveDefaultDbPath()`。不得用无 `--db` 的 `npm run db:sync`/`npm run db:verify` 替代它，也不得执行占位路径。

**预期证据：** 每条命令记录退出码、测试数、关键输出和隔离路径；scope helper 证明四层差异均被覆盖，isolated-db helper 输出唯一临时路径且不解析默认路径；Electron smoke 若环境不可用必须为 `BLOCKED/NOT_RUN`，不得由 build 推断通过。

**回滚方式：** 若尚未进入非测试数据库，按域回退 application service/registry；M5A 无 Schema/down migration。已经生成的历史事件、投影、报告和导出文件不删除、不重写。

**停止条件：** 任一 P0、未关闭 P1、target gate 漏入口、Schema/Event/API 非预期 diff、默认 DB 被触碰、或必须实现 M5B 才能通过。

**建议 commit message：** `feat(m5a): close command bus boundary`

## 6. 全量回归矩阵

| 域 | 自动化证据 | 关键错误实现必须被杀死 |
|---|---|---|
| Envelope | UUID/UTC/canonical/hash/脱敏/correlation tests | 信任客户端 command ID/actor/time；hash 依赖 key 插入顺序；泄露密码/完整 payload |
| Registry | 74/28/46 exact-set、row completeness | 漏/重复 channel；READ 持有 capability；缺 resolver/transaction/retry/test |
| Preflight | 隔离 DB/data-root 前后 hash | reject 时 seed、heartbeat、EXPIRED/REVOKED、error log、mkdir、binding 变化 |
| Auth | login/logout/account + snapshot/sweep | 请求体 caller 自授权；READ heartbeat；拒绝删除 binding |
| Student/Strategy | 现有 CRUD/version/immutability | 直接 handler DML；未验证 JSON；绕过 ADMIN |
| Assessment | create/start/answer/sitting/redline/result | 客户端三元键覆盖 DB；Bus 直接 REDLINE_HALTED；事件 correlation 不一致 |
| Training | create/step/complete/redline | step 与 session 错绑；halt child 无 owner；跨 job 被误熔断 |
| Scoring | ability/operation/job-skill/observation | 结果混算；多事件 SQLite 部分提交；session target 伪造 |
| Multi-event failure | 真实临时 JSONL 第 N 次故障 + reconcile | 删除合法前缀；按 correlation 补齐；把 SQLite rollback 写成 JSONL rollback |
| Assignment | create/confirm/start/rebind/release | runtime 在 preflight 创建；student/device/session 不一致；绕过 grant |
| Safety | confirm/resolve/void/replace + M4 negatives | TEACHER 解除；ADMIN 绕 FSM；二元聚合；直接恢复 session |
| Reports | closure/generate/review/lock/export | 多 coordinator；漏两个 TaskClosure callsite；文件/SQLite 假原子；吞 orphan |
| Recovery/internal | startup/migration/recovery/seed/sweep inventory | internal writer 冒充 READ/USER；未登记 capability；legacy recovery 变 batch |
| Static bypass | sink + capability + import graph | alias/注入 coordinator 逃过扫描；test-only port 进入 production |
| Compatibility | preload/shared/renderer/API diff + handler regression | 新增 channel、响应字段或事件字段；旧 fixture bytes 改变 |
| M4 | SQL inventory、schema/handler/Electron smoke | 同 student/task 跨 job 相互阻断；三元安全归属漂移 |

## 7. 人工验收矩阵

所有人工验收使用显式临时 `SVETS_USER_DATA_DIR`；不得打开默认 userData。

| 场景 | 操作 | 预期观察 |
|---|---|---|
| 登录与账号 | 登录、退出、管理员创建/停用教师 | UI 响应与现状一致；READ 不刷新 session，accepted mutation 才维护；停用后的 sweep/拒绝可解释 |
| 学生建档/策略 | 教师建档、管理员新增策略版本 | 成功/错误 UI 不变；运行日志只有 command type/actor ref/target/hash 摘要 |
| 学生测评 | 分配、确认、开始、答题、情绪中断/恢复 | 所有 mutation 有同一 Bus trace；单命令事件 correlation 一致；界面行为不变 |
| 线下评分 | ability、operation、job-skill、observation | 结果类型不混算；批量提交失败不暴露 SQLite 部分投影 |
| 安全红线 | 同三元 assessment+training 触发；另建不同 job 会话 | 同三元同时熔断；不同 job 不受影响；教师不能解除 |
| 报告 | task closure、生成、复核、锁定、导出 | 各入口串行；原有结果/错误不变；导出失败不静默成功 |
| boundary failure | 在测试构建注入 not-ready/unknown/target mismatch | 请求前后临时 DB、JSONL、文件树和 sender binding 不变 |
| 并发 | 同一 target 同时提交两次 mutation | 普通命令一个执行、一个在写前拒绝；报告使用既有 coordinator 串行；无自动重试 |
| 启动恢复 | 临时 data root 制造合法 legacy prefix/尾部故障后重启 | 沿用 legacy recovery；不把 correlation 当 batch marker；boundary 在 seed/recovery 后才 ready |

## 8. 残余风险与后续项

1. M5A 仍不提供 durable idempotency。同一业务请求重新进入会获得新的 command ID 并可能再次执行；只按 registry 的 existing guard/`NO_AUTO_RETRY` 处理。
2. JSONL append 与 SQLite transaction 不共同原子。合法前缀可能在 recovery 后形成多事件命令的部分业务批次；由 M5B 关闭。
3. active-key guard 仅在当前进程内有效，不是 lease/fencing；utilityProcess/HTTP/background 尚未实现。
4. auth sweep 引入进程内定时维护，需要 Electron 长时间运行与 fake-timer/退出清理证据；它不是用户请求链的一部分。
5. report file rename 与 SQLite/event 仍非原子；M5A 只统一 owner、错误和恢复语义。
6. `src/main/ipc/handlers/` 现有大文件迁移会造成较大 diff；必须按步骤保留 compatibility re-export 和真实 diff review，不能顺手重写业务算法。
7. lint 当前历史基线可能存在 warnings；验收以退出码、0 errors 和新增 warning 差异如实记录，不声称零 warning，除非实际为零。
8. M5A 通过后，下一里程碑是按最终 mutation inventory 重基线并独立审查 Step 2C / M5B batch runtime；不得直接复用 M5A 的 runtime trace 充当 command log。
9. BASE_ABILITY P1-01/P1-02 仍需独立收口；不得与 M5A 同一原子步骤或提交混合。

## 9. Reviewer 输入包

执行 `/vibe-review impl doc/features/m5a-command-bus-boundary-impl.md` 时必须显式提供：

- PRD：`doc/features/m5a-command-bus-boundary-prd.md`；
- 实施计划：本文件；
- 风险等级：`R3`；
- 适用不变量：第 3 节全部 ID；
- 已读代码范围：74 个 IPC registration、35 direct-side-effect 文件、5 delegating roots、auth session、event writer/reducers/recovery、report coordinator/task closure/export、preload/shared types、相关测试；
- 重点问题：
  1. 74/28/46 分类与 35+5 legacy→active 映射是否可机械证明；
  2. preflight 是否真正零 DB/file/binding 副作用；
  3. 每个 mutation 是否有可执行的纯读 target resolver 和既有错误映射；
  4. 迁移步骤中是否存在可从 IPC 绕过 Bus 的中间状态；
  5. Step M5A-3 是否原子消除全部 root 外 coordinator 构造，且 sync/async 同 key 不能重叠；
  6. 多事件 failure test 是否能杀死“SQLite 回滚等于 JSONL 回滚”的错误实现；
  7. 每个中间步骤是否可构建、可验证、可单独回退；
  8. baseline/migration/target 三种门禁及 active/mapping/pending fixtures 是否在 Step M5A-3～10 可机械执行；
  9. 46 个 mutation 的 `preflight_error_map` 是否只使用既有 public response union；
  10. 最终 scope gate 是否覆盖 committed/index/worktree/untracked，isolated DB helper 是否永不回落默认路径；
  11. 是否无意进入 Schema、batch、command log、fencing、startupRecovery、HTTP 或 utilityProcess。

Reviewer 只有在 P0/P1 为 0 且必需证据充分时才能判定 `PASS`；R3 不得用非独立自审替代最终结论。
