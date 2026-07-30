# M5A Command Bus Boundary — Independent R3 Re-review

- Reviewer: Codex，独立 R3 Reviewer
- Review target: `doc/features/m5a-command-bus-boundary-prd.md`
- Review date: 2026-07-28
- Review basis: 当前工作树、权威基线、实际 Main/IPC/DB/report/recovery 实现、相关测试及本轮命令输出
- Independence statement: PRD 第 14 节、上一轮 Reviewer 结论及用户说明均未作为证据；结论由实际文件、代码、测试和 Git 状态重新推导。
- Conclusion: `CONDITIONAL_PASS`

## Evidence

实际读取的权威与工作流文件：

- `AGENTS.md`
- `doc/specs/baseline.yaml`
- `doc/specs/project-invariants.md`
- `doc/ai/vibe-workflow-contract.md`
- `.agents/skills/vibe-review/SKILL.md`
- `vibe-coding-skills-v2/commands/vibe-review.md`
- `doc/specs/MVP_PRD_v1.0.9-authoritative.md`
- `doc/specs/architecture-plan-b-multi-device-v2.2-authoritative-baseline.md`
- 目标 PRD 全文，以及为核验 `[!]` 读取的 `multi-device-m4-m5-prd.md`、`multi-device-m4-m5-impl.md` 相关段落

实际读取的代码：

- IPC：`src/main/ipc/index.ts` 及当前注册的 `src/main/ipc/handlers/*.ts`
- 事件与报告：`event-writer.ts`、`action-log-path.ts`、`report-command-coordinator.ts`、`report-write-gate.ts`、`report-service.ts`、`report-export.ts`、`report-errors.ts`、`report-canonical.ts`
- 启动与恢复：`connection.ts`、`migration-startup.ts`、`migrations.ts`、`report-migration.ts`、`safety-rekey-migration.ts`、`migration-backup.ts`、`recovery.ts`、`legacy-upgrade-recovery.ts`、`local-runtime-context.ts`
- 鉴权与合同：`auth-session.ts`、`auth-context.ts`、`preload/index.ts`、`ipc-api.ts`、`event-payloads.ts`、`schema.sql`

实际读取的测试与 helper：

- `src/main/db/test-helpers.ts`
- report canonical/write-gate/coordinator/export
- recovery、legacy-upgrade-recovery、local-runtime-context
- auth-context、auth handler
- migration-startup、safety-rekey-migration
- assessment ability scoring

实际命令与结果：

- `git status --short --branch -uall`：退出码 0；目标 PRD 为未跟踪文件，工作区另有既存文档改动。
- `git diff --check`：退出码 0，无输出。该命令不覆盖未跟踪的目标 PRD，因此目标内容另以逐行读取核验。
- IPC 静态检索：实际 `ipcMain.handle(...)` 调用数为 74；注释命中已剔除。
- DB/file/`writeEvent()` 静态检索：确认存在 Findings 所列遗漏入口。
- request hash 固定向量复算：`df1470b5705db8c57362264c5ad9626f83b95ce732ede593b17ac60b61cd933c`，与 PRD 一致。
- `npm run docs:index:check`：PASS。
- 12 个隔离定向测试文件：PASS，105/105 tests；使用 `MemoryAdapter` 或 `os.tmpdir()` 临时路径，未访问默认数据库。
- `npm run typecheck`：PASS。
- `npm run lint`：退出码 0；0 errors、661 warnings。
- `npm test` 全量：NOT_RUN。
- `npm run build`：NOT_RUN。
- `npm run db:verify -- --db <隔离库>`：NOT_RUN。
- `npm run contract:m4:safety-sql:check`：NOT_RUN。
- Electron/UI smoke、E2E：NOT_RUN。
- 默认 `xc-career-guide.db` 状态/hash：NOT_RUN，按要求未读取。
- 运营性 migration、默认库 migration：NOT_RUN。

## Findings

### M5A-R3-01

- ID：M5A-R3-01
- Severity：P1
- Location：`doc/features/m5a-command-bus-boundary-prd.md` §6.1 lines 172-184；`src/main/ipc/handlers/ability-scoring.ts` lines 79-87；`src/main/ipc/handlers/operation-scoring.ts` lines 67-103
- Trigger：只携带 `sessionId` 的命令需要构造 envelope target，或客户端同时提交了与数据库事实不一致的 `student_id/job_code/task_code`。
- Impact：PRD 只规定 target “按 schema 校验”，未确定每个命令的权威来源、解析 owner、解析时机和冲突规则。实现可能把客户端三元键用于 `request_hash`、并发键或审计，而领域服务实际使用数据库中的另一组三元键，造成错误串行、错误追溯或跨岗位安全边界漂移。
- Rule or contract violated：CommandEnvelope 每个字段必须有明确来源、格式和校验；`INV-SAFE-001`；PRD 自身 §2 成功定义第 2 项及 §7 的 target mismatch 零副作用要求。
- Minimal fix：规定 registry 中每个命令必须带权威 `target_resolver`：已有 aggregate/session 命令从数据库事实解析三元键；客户端 target 只能作为 compare-only hint；创建型命令明确哪些字段来自已验证 payload、哪些来自关联记录。先完成纯读取解析和 mismatch 校验，再计算 `request_hash`。补伪造 job/task/student、记录不存在及客户端 hint 冲突测试。
- Regression evidence：当前 ability、operation、job-skill scoring 都会通过 `sessionId` 从 `assessment_session` 读取三元键；现有 105 个定向测试未测试尚不存在的 CommandEnvelope target resolver。

### M5A-R3-02

- ID：M5A-R3-02
- Severity：P1
- Location：目标 PRD lines 41-42、76、80-84、218、226；`src/main/utils/auth-session.ts` lines 150-180；`src/main/ipc/handlers/assessment.ts` lines 2450-2472
- Trigger：未知命令、非法 payload、target mismatch 或其他前置失败先经过当前 `ensureSeeded()` 和 sender-bound auth resolver。
- Impact：当前顺序会先 INSERT lazy seed，并对 ACTIVE session 更新 `last_activity_at`；过期/禁用会话还会写 EXPIRED/REVOKED。它与“任何 DB/file 副作用前拒绝”“失败零副作用”直接冲突，且 PRD 只为 READ 明确提出纯 resolver，没有裁决 mutation preflight 与 auth maintenance 的顺序。
- Rule or contract violated：M5A-03、成功定义第 2 项、§7 第一条，以及 read/mutation 物理副作用分类原则。
- Minimal fix：明确 preflight 顺序：静态 channel/command lookup → 结构校验 → 无写 sender-bound session snapshot → 权威 target 解析 → envelope/hash → dispatch。heartbeat、过期标记、禁用撤销和 seed 必须在命令被接受后作为登记的内部 mutation 执行；若安全上允许某类 auth maintenance 在拒绝时写入，则应明确列为“零业务副作用”的唯一例外，并修改验收措辞及测试。
- Regression evidence：`auth.test.ts` 已证明 session 恢复会刷新或改变状态；当前没有“未知/非法命令前后 auth_session、error_event_log 均不变”的测试。

### M5A-R3-03

- ID：M5A-R3-03
- Severity：P1
- Location：目标 PRD 初始写入口表 lines 139-156；`src/main/ipc/handlers/auth.ts` lines 145-151、214-281；`student.ts` lines 145-179；`strategy.ts` lines 490-515；`safety-rekey-migration.ts` lines 341-351；`action-log-path.ts` lines 5-8
- Trigger：以 PRD 的初始登记作为 `/vibe-impl` inventory 种子。
- Impact：表中对 auth/student/strategy 仅登记了 lazy seed，却漏列登录建 session、账号维护、学生档案和策略配置的直接业务 DML；还未单列 M4 safety migration kernel、`getActionLogPath()` 的隐藏 `mkdirSync` 和 `src/main/index.ts` 的 E2E data-root 创建。因而“全部 writer inventory”尚未成为与当前代码一致的审查基线。
- Rule or contract violated：成功定义第 1、5 项；§5.1 第 3、7 项；§12 “每个 writer/side effect 命中 inventory”的停止条件。
- Minimal fix：在 PRD 初始表中补齐上述入口及 boundary mode、actor policy、phase、transaction owner、retry policy 和 test reference；明确静态 fixture 的预期完整文件集合，而不只写“实施时再扫描”。
- Regression evidence：静态 DML/file scan 直接命中上述文件；74 个 IPC 数量正确，但仓库当前不存在逐 channel READ/MUTATION fixture，也不存在能够证明这些遗漏已归属的 bypass gate。

### M5A-R3-04

- ID：M5A-R3-04
- Severity：P1
- Location：目标 PRD lines 43、94-100、214、230、263、309、322；`event-writer.ts` lines 98-120；`operation-scoring.ts` lines 173-264；`recovery.ts` lines 522-595
- Trigger：多事件命令的第 N 次 JSONL append 成功，随后 projection/reducer 写入失败。
- Impact：SQLite 事务会回滚，但已经追加的 JSONL 前缀不会回滚；现有 recovery 又按单事件分别重放，因此可能恢复成部分评分批次。PRD 一方面正确承认该事实，另一方面多处仍无条件承诺“多事件全有或全无”，形成不可同时满足的验收合同，并可能诱导 M5A 偷做补偿/batch 协议。
- Rule or contract violated：`INV-EVT-002` 的实际 append→projection 顺序；M5A 不得伪装解决 M5B durability；验收标准必须可执行且无矛盾。
- Minimal fix：把所有“全有或全无”限定为“当前调用返回时的 SQLite projection/reducer 事务原子性”；明确 JSONL 可能留下同 correlation 的合法前缀，legacy recovery 不能恢复命令级原子性。增加真实临时 JSONL 的第 N 次 projection/reducer 故障测试，验证 DB 回滚、JSONL 前缀、后续 recovery 结果和明确的 M5B 风险，不在 M5A 引入补偿事件。
- Regression evidence：现有 ability scoring 故障测试只验证 SQLite/projection 回滚；report coordinator 测试只覆盖单事件 JSONL append 后 projection 失败。105 个定向测试中没有真实多事件 JSONL 前缀恢复测试。

## P1 closure verdict

1. Envelope 字段、actor、hash、时间和 correlation 语义：`PARTIALLY_CLOSED`。`command_id/source/hash/created_at/correlation_id` 已明确；target 权威解析和 actor/auth preflight 副作用顺序仍未闭合。
2. trusted actor 与 caller 字段兼容策略：`CLOSED`。USER 来自 sender-bound ACTIVE session，caller 只 compare-only；BOOTSTRAP 事件必须映射既有 SYSTEM actor 或拒绝。
3. READ/MUTATION 与 hidden side effect：`PARTIALLY_CLOSED`。物理无副作用规则已写入，但没有实际 74 行分类，且拒绝路径与 auth maintenance 顺序仍矛盾。
4. 全部 writer inventory 与静态 bypass gate：`PARTIALLY_CLOSED`。门禁要求已写入，但当前初始 inventory 遗漏真实业务 DML 和文件入口。
5. legacy recovery 与 v2.2 startupRecovery 边界：`CLOSED`。
6. report coordinator、文件写入和事务边界：`CLOSED`。
7. retry/concurrency/idempotency 是否越界到 M5B：`CLOSED`。

## Scope and boundary verdict

1. M5A 是否仍是 Command Bus Boundary？**是。**
2. 是否存在隐含 Schema、command_log、fencing、batch、startupRecovery、HTTP 或 utilityProcess 变更？**未发现。**
3. 是否覆盖所有当前写入入口？**否。** 目标要求覆盖，但当前初始 inventory 不完整。
4. 是否保留 M4 三元安全键和现有事件追溯约束？**三元键、现有 event envelope、报告写入门禁及结果隔离均被明确保留；多事件命令级原子性表述仍需修正。**
5. 是否可以安全进入 `/vibe-impl`？**否。** 应先修订并独立确认上述 4 个 P1。

## Passed checks

- 当前权威基线为 `v0.1.17-multi-device-m4-safety-rekey / ACCEPTED_STEP_2A`。
- 两处现有 `[!]` 均有真实证据。
- 实际 IPC 注册调用数为 74。
- request hash canonical 固定向量复算一致。
- PRD 明确排除 M5B/Step 2C 的 batch、command_log、fencing、startupRecovery、HTTP 和 utilityProcess。
- PRD 明确保留 M4 三元安全键、JSONL/event envelope、F7 write gate、结果类型隔离和 IPC/preload 兼容。
- `docs:index:check`、typecheck、`git diff --check` 退出码均为 0。
- 定向隔离测试 12 个文件、105 个用例全部通过。
- lint 退出码 0，无 error；存在 661 个既有 warning。
- 复审阶段未修改任何文件，未访问默认数据库，未提交或推送。

## Final decision

- 未发现 P0。
- 存在 4 个影响实现安全性、writer 收口和事件追溯准确性的未解决 P1。
- 最终结论：`CONDITIONAL_PASS`。
- 在关闭 target 权威解析、拒绝前副作用顺序、完整 writer inventory、以及多事件 JSONL/SQLite 原子性措辞与测试合同之前，不得进入 `/vibe-impl`。
