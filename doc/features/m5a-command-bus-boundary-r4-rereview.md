# 审查报告

- 审查对象：`doc/features/m5a-command-bus-boundary-prd.md`
- 审查类型：Mini-PRD 独立 R3 再审查（R4 报告）
- 审查日期：2026-07-28
- Reviewer：Codex
- 风险等级：HIGH（覆盖 74 个 IPC channel、全部 mutation/write 入口、鉴权维护、启动/迁移/恢复与报告文件副作用）

## 审查结论

`CONDITIONAL_PASS`

上一轮四项 P1 中，`M5A-R3-01`、`M5A-R3-02`、`M5A-R3-04` 已由当前候选修订关闭；`M5A-R3-03` 仍未完全关闭。目标 PRD 的 35 个 direct-side-effect 文件与当前精确扫描一致，但“4 个 delegating roots”遗漏了真实生产委派节点 `src/main/domain/task-closure-service.ts`。该服务持有 `ReportCommandCoordinator`，并通过两个公开 mutation 方法写入 task closure/report 事件与投影。

因此当前结论不能为 `PASS`，也不能进入 `/vibe-impl`。先补齐该委派节点、两个 callsite 及相应静态门禁，再进行一次针对性独立复核。

- P0：0
- P1：1
- P2：0
- NOTE：2

## 审查范围

### 独立性

本轮先从当前权威基线、目标 PRD、实际代码、测试和静态扫描独立形成证据与结论，之后才读取 `doc/features/m5a-command-bus-boundary-r3-rereview.md` 作为问题清单对照。目标 PRD 第 14 节、上一轮结论和审查提示中的预设判断均未作为本轮事实证据。

### 权威资料

- `doc/specs/baseline.yaml`
- `doc/specs/project-invariants.md`
- `doc/ai/vibe-workflow-contract.md`
- `doc/specs/MVP_PRD_v1.0.9-authoritative.md` 的权限、事件、IPC、安全、恢复与验收章节
- `doc/specs/architecture-plan-b-multi-device-v2.2-authoritative-baseline.md` §10、§11、§12、§14.5
- `src/main/db/schema.sql`
- `src/shared/types/ipc-api.ts`
- `src/shared/types/event-payloads.ts`
- `src/shared/types/json-schemas.ts`
- `src/preload/index.ts`

### 实现证据

- target：`ability-scoring.ts`、`operation-scoring.ts`、`job-skill-scoring.ts` 及 assessment/session 查询路径
- preflight：`auth-session.ts`、`auth.ts`、`assessment.ts`、`student.ts`、`strategy.ts`
- inventory：Main/IPC/DB/domain/utils 下的 direct writer、隐藏文件写入口及其生产调用图
- JSONL/recovery：`event-writer.ts`、多事件 scoring、`recovery.ts`、`legacy-upgrade-recovery.ts` 及相关测试
- 新发现的委派链：`reports.ts` → `TaskClosureService` → `ReportCommandCoordinator` → `writeEvent()`/reducer

### 适用不变量

- `INV-EVT-001`、`INV-EVT-002`、`INV-EVT-003`
- `INV-SAFE-001`、`INV-SAFE-002`、`INV-SAFE-003`、`INV-SAFE-004`
- `INV-AUTH-001`、`INV-AUTH-002`
- `INV-RES-001`、`INV-RES-002`
- `INV-IPC-001`、`INV-IPC-002`
- `INV-DATA-001`、`INV-DATA-003`

### 工作区边界

审查开始时分支为 `feat/multi-device-m2-prd`，工作区已有用户文档改动及未跟踪文件。目标 PRD 本身未被 Git 跟踪；普通 `git diff` 不覆盖它。本轮不修改目标 PRD、代码、Schema、migration、默认数据库或历史 JSONL，只新增本报告并更新文档自动索引。

## 已执行检查

| 检查 | 结果 | 证据 |
|---|---|---|
| `git status --short --branch -uall` | PASS | 已记录分支、既有改动及目标 PRD 未跟踪状态；无 stash 操作 |
| 目标 PRD 完整逐行读取 | PASS | 已单独读取全文，不依赖普通 `git diff` |
| 目标 PRD whitespace/patch 格式检查 | PASS | `git diff --no-index --check /dev/null <target>` 无格式诊断；退出码 1 来自“存在内容差异”，不是 whitespace failure |
| 工作区已跟踪 diff 格式 | PASS | `git diff --check` 退出码 0 |
| IPC 注册点计数 | PASS | 实际 74 个 `ipcMain.handle()`；剔除 `src/main/ipc/index.ts` 的注释文本命中 |
| direct-side-effect 精确扫描 | PASS | 审查提示中的扫描式命中 35 个文件，与 PRD §5 lines 181-184 完全一致 |
| production test-only import 反查 | PASS | 未发现生产文件导入 `memory-adapter.ts` 或 `test-helpers.ts` |
| delegating call graph 反查 | FAIL | `task-closure-service.ts` 两次调用 `runSingleEventCommand()`，但未进入 PRD 的委派根闭集；见 `M5A-R4-01` |
| request hash 固定向量复算 | PASS | 得到 `df1470b5705db8c57362264c5ad9626f83b95ce732ede593b17ac60b61cd933c`，与 PRD 一致 |
| 13 个隔离定向测试文件 | PASS | 13/13 files、128/128 tests；使用 MemoryAdapter 或临时路径，未使用默认数据库 |
| `npm run typecheck` | PASS | 退出码 0 |
| `npm run lint` | PASS | 退出码 0；0 errors、661 个既有 warnings |
| `npm run docs:index:update` | PASS | 已更新 `doc/index.md` 自动清单 |
| `npm run docs:index:check` | PASS | 退出码 0，自动索引为 current |
| `npm test` 全量 | NOT_RUN | 本轮只执行与四项 P1 相关的隔离定向回归 |
| `npm run build` | NOT_RUN | PRD 审查不产生可构建代码变更 |
| `npm run db:verify -- --db <隔离库>` | NOT_RUN | 本轮无 Schema/DB 实现变更 |
| `npm run contract:m4:safety-sql:check` | NOT_RUN | 本轮无 M4 SQL 变更；相关 migration 定向测试已执行 |
| Electron/UI smoke、E2E | NOT_RUN | 本轮无 UI/运行时实现变更 |
| 默认 `xc-career-guide.db` | NOT_RUN | 按审查边界未读取、未修改、未初始化 |

定向测试文件覆盖 auth/auth-context、ability/operation/job-skill scoring、recovery/legacy recovery、report coordinator/export、task closure、local runtime、migration startup 与 M4 safety re-key migration。

## P0

未发现 P0。

## P1

### M5A-R4-01：writer inventory 漏登记 `TaskClosureService` 委派节点，`M5A-R3-03` 未完全关闭

- 严重度：P1
- 位置：
  - `doc/features/m5a-command-bus-boundary-prd.md:175`：报告写入族未列 `task-closure-service.ts`
  - `doc/features/m5a-command-bus-boundary-prd.md:185`：只冻结 4 个 delegating roots
  - `doc/features/m5a-command-bus-boundary-prd.md:187`、`:328`：静态闭集和验收继续硬编码“4 个”
  - `src/main/domain/task-closure-service.ts:78`：公开生产 service 持有注入的 `ReportCommandCoordinator`
  - `src/main/domain/task-closure-service.ts:100`、`:156`：确认/替换任务闭环均委派 `runSingleEventCommand()`
  - `src/main/ipc/handlers/reports.ts:385`、`:406`：两个生产 IPC mutation 实例化并调用该 service
- 触发条件：实现阶段以 PRD 的“35 direct + 4 roots”作为 machine-readable fixture 和 fail-closed 静态门禁真值。
- 实际影响：
  - fixture 可以在漏掉 `TaskClosureService` 两个 mutation 委派 callsite 的情况下仍然通过“4 roots 精确对账”；
  - 实现者可能只收口 `reports.ts` 和 coordinator，而未把 task-closure 的 actor/target resolver、correlation、phase、事务 owner、retry/concurrency policy 绑定到统一 composition-root capability；
  - 当前 `reports.ts` 每次构造 coordinator 后注入该 service，若该节点不被门禁追踪，单例串行化与旁路禁止无法由 inventory 证明；
  - 这会使 PRD 自称的“所有 writer/callsite 可追到 owner”与真实生产调用图不一致。
- 违反依据：目标 PRD §5 line 149 要求每个受控 writer callsite 命中 inventory，line 153 要求统一 composition-root capability，line 187 要求 delegating roots 可追到 owner，§7 line 303 将未登记 writer/旁路列为停止条件。当前闭集也不足以独立证明 `INV-EVT-002`、`INV-EVT-003` 在该调用链上持续受控。
- 最小修复：
  1. 在 §5 报告/任务闭环入口族中显式加入 `src/main/domain/task-closure-service.ts`；
  2. 将 delegating roots 的精确基线从 4 调整为 5，并同步 §5、自动化验收及所有数量断言；
  3. 单独登记 `confirmBaseTaskClosure()` 和 `replaceBaseTaskClosure()` 两个 callsite 的 owner/capability、actor policy、target resolver、phase、transaction owner、retry/concurrency policy、correlation 传递和 test reference；
  4. 让静态门禁不仅扫描低层 sink，还反查生产代码中对 `runSingleEventCommand()`/`runSingleEventCommandSync()` 及等价注入 capability 的调用，未登记即 fail closed。
- 回归测试：
  - fixture 精确断言 `35 direct + 5 delegating roots`，其中必须包含 `task-closure-service.ts`；
  - 精确断言该文件的两个 coordinator callsite 分别归属于 `reports:confirmTaskClosure` 和 `reports:replaceTaskClosure`；
  - 增加一个负向 fixture：在未登记生产文件中注入或调用 coordinator 时静态门禁失败；
  - 保留并扩展现有 `task-closure-service.test.ts`，断言统一 coordinator/correlation capability 经两个 mutation 透传。

## P2

未发现 P2。

## NOTE

### NOTE-01：目标 PRD 为未跟踪文件

普通 `git diff` 与 `git diff --check` 不覆盖目标内容。本轮已通过完整逐行读取和 `git diff --no-index --check` 单独核验；后续修订与复审仍必须保持这一检查方式，不能把普通 diff 的无输出写成目标 PRD 已通过。

### NOTE-02：现有回归通过不等于 Command Bus 验收已实现

本轮 128 个测试证明所引用的 legacy auth、writer、recovery、migration、报告和 task-closure 行为仍成立。`command-envelope`、`command-registry`、`preflight-no-side-effect`、真实多事件 JSONL 第 N 次故障等测试仍是 PRD 中的未来实现验收，本轮不存在可执行实现，未把它们声明为通过。

## 已核验通过关键项

### `M5A-R3-01`：CLOSED

- PRD §6.1.1 lines 219-236 强制每个 mutation 使用唯一纯读 `target_resolver`，冻结 owner/kind/locator/权威表列/canonical schema/hint/错误映射/test reference。
- existing/create/actor/static 四类来源已区分；client hint 全字段比较，并在 target/payload/hash/concurrency/correlation 归属前拒绝 mismatch/not-found。
- 实际代码证明该方案可执行：ability、operation、job-skill scoring 都能以 `sessionId` 从 `assessment_session` 读取 `student_id + job_code + task_code`，而不是依赖客户端三元键。
- §10 line 327 覆盖伪造 student/job/task、关联冲突、不存在记录、创建型候选不一致和 hash 前失败。
- canonical JSON 规则及固定 hash 向量独立复算一致。

### `M5A-R3-02`：CLOSED

- 当前 `auth-session.ts` 的 resolver 确实会 heartbeat，并会把过期/禁用状态持久化；auth/student/strategy/assessment 当前也确有首次 IPC lazy seed，原问题真实存在。
- PRD §6.2 lines 251-265 已冻结无写 preflight：静态 registry → 结构校验 → 无写 sender snapshot → SELECT-only target resolver → canonical envelope/hash → `ACCEPTED`。
- seed 被移到 `POST_DB_INIT_PRE_BOUNDARY_READY`，失败时 mutation boundary 保持关闭；禁止退回首次 IPC lazy seed。
- READ 永不 heartbeat，拒绝路径不持久化 EXPIRED/REVOKED、不刷新 last activity、不删 sender binding；heartbeat 只允许作为 accepted authenticated mutation 的登记子步骤，过期/禁用清理由独立 sweep 执行。
- §7 line 295 与 §10 line 329 给出 DB、action log、文件树和 sender binding 的前后状态验收，并区分 preflight 拒绝与 accepted 后业务失败。

### `M5A-R3-03`：PARTIALLY_CLOSED

- 已关闭部分：auth/student/strategy DML、四组 startup seed、M4 safety migration kernel、`getActionLogPath()` 隐藏 `mkdirSync`、E2E data-root、connection/migration/recovery/report/auth maintenance/local runtime/error writer 均已进入初始表；35 个 direct-side-effect 文件与当前精确扫描完全一致；test-only writer 未进入生产 import graph。
- 未关闭部分：委派调用图遗漏 `task-closure-service.ts`，见 `M5A-R4-01`。

### `M5A-R3-04`：CLOSED

- `event-writer.ts:98-120` 证实顺序为 JSONL append 后 SQLite `domain_event_projection` INSERT。
- `operation-scoring.ts:166-266` 证实 9 条评分事件与 1 条结果事件位于同一 SQLite transaction，但每次 JSONL append 不受 SQLite rollback 控制。
- `recovery.ts:522-595` 证实正常 `reconcileActionLog()` 逐事件调用独立 transaction；legacy factual-correction triplet 仅在升级桥中按显式 group 恢复。
- PRD §6.2 line 283、§7 line 299、§10 lines 332/334 已将承诺严格限定为当前调用内 SQLite 原子性，明确 JSONL 合法前缀不可回滚、recovery 可形成部分业务批次、correlation 不具备 group commit/recovery 语义。
- 验收要求使用真实临时 JSONL，在 `1 < N < 完整事件数` 时注入故障，并验证 SQLite 全回滚、N 条同 correlation 前缀及逐事件恢复，合同可执行且没有偷做 M5B batch/补偿。

## 范围与边界裁决

- M5A 仍是 Command Bus Boundary，没有隐含新增 Schema、`command_log`、lease/fencing、batch marker、v2.2 startupRecovery、HTTP、utilityProcess 或 renderer route。
- 当前 legacy startup reconcile 已被标为 `LEGACY_STARTUP_RECOVERY`/inventory capability，没有冒充架构基线中的未来 v2.2 `startupRecovery()`。
- M4 `student_id + job_code + task_code` 三元安全键、安全事实与普通评分隔离、现有事件 payload/schema_version、preload 白名单和 IPC 响应结构均被明确保留。
- JSONL 前缀恢复造成的部分业务批次是已诚实记录的 M5B 残余风险，不构成本轮 P1；遗漏真实委派节点构成本轮 P1。
- 在 `M5A-R4-01` 关闭前，不得开始 `/vibe-impl`。

## 残余风险

- Command Bus、registry、resolver、无写 auth snapshot、startup seed capability 和静态 bypass gate 尚未实现；本报告只裁决 PRD 是否可进入下一阶段。
- JSONL 与 SQLite 不具备命令级共同提交，进程崩溃或 reducer 失败后仍可恢复为多事件命令的合法前缀；解决该风险属于 M5B。
- 全量 `npm test`、build、隔离 `db:verify`、M4 SQL inventory gate 和 Electron smoke 本轮未执行，不能由 128 个定向用例外推。
- lint 当前为 0 error、661 warning；这些 warning 与本轮文档审查无直接因果关系，但不应被表述为零告警。
- 目标 PRD仍未被 Git 跟踪，后续普通 diff/审查工具可能漏看其内容。

## 规则沉淀候选

1. writer inventory 的闭集应同时覆盖“低层 sink 直接命中”与“生产调用图中的 capability 持有/委派节点”；仅靠 `.run()`、`writeEvent()` 或文件 API 正则不能证明没有旁路。
2. 对依赖注入的 mutation capability，应静态枚举其构造、持有和调用位置；type-only import、构造器注入和间接 service 调用都必须能回溯到 registry owner。
3. 精确数量断言应从同一 machine-readable fixture 生成文档和测试，避免 PRD 文本中的“4 个”与实际调用图独立漂移。

## 置信度

`HIGH（0.96）`

依据：目标 PRD、权威基线与必查实现已逐行/按问题读取；35 个 direct 文件、74 个 IPC channel、委派调用图与固定 hash 均独立复核；13 个隔离测试文件、128 个用例、typecheck 和 lint 已实际执行。剩余不确定性主要来自 Command Bus 尚未实现及本轮未运行全量工程门禁，而不是本次 P1 的证据链。
