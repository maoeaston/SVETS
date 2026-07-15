# 多设备架构 v2.2 迁移：实现文档

> **状态：** M2 已实施；M3 待实施
> **对应 Mini-PRD：** `doc/features/multi-device-v2.2-migration-prd.md` §10.1-§10.6、§11
> **上游权威：** `doc/specs/architecture-plan-b-multi-device-v2.2-authoritative-baseline.md`
> **当前起点：** schema v0.1.14-multi-device-m2-session-foundation
> **下一目标版本：** schema v0.1.15-multi-device-m3-grant-assignment
> **下一目标 migration id：** `2026-07-15_mvp_schema_v0_1_15_multi_device_m3_grant_assignment`
> **分支：** `feat/multi-device-m2-prd`

---

## M2 Business Session Foundation（已实施记录）

## 实现目标（一句话）

在不改变现有 assessment/training IPC 必填输入的前提下，为两类子会话增加稳定的 `business_session` 父记录，落地 assessment `delivery_phase`、`event_sequence_version` 和观察集合标识，并保证 v0.1.12/v0.1.13 数据迁移、旧事件重放、正常业务写入与数据库触发器约束一致。

## 范围与非范围

### 本轮交付

- T6 `business_session`。
- B2-B4：assessment 的四个增量列与 training 的一个增量列。
- M2 索引、D2-D6、D8 触发器。
- M1 后的顺序 migration、确定性回填、结构断言、备份与失败回滚验证。
- assessment/training 开始事件的向后兼容 payload。
- assessment 创建、开始、答题、评分、观察、完成、异常终止阶段投影。
- training 父子会话创建与 `module_type` 事务内投影。
- assessment/training 创建、详情和列表的增量输出字段。
- 旧 `ActionLogEntry` 的 reducer 重建、父记录修复、冲突拒绝和乱序版本保护。

### 明确不交付

- D1 完整前向状态机，以及 Grant、Assignment、学生确认流程。这些属于 M3。
- D7 和 `learning_session`。这些属于 M6。
- D9-D11、REST/SSE、HTTPS/CA、fencing、离线评分草稿、备份恢复产品能力。
- renderer 新页面或新增展示。M2 只保证已有页面接收增量字段时不报错。
- 独立 Observation Template 表或查询接口。
- JSONL 读取、排序和冷启动重放协调器。

## 前置条件

- M1 migration runner 已存在于 `src/main/db/migrations.ts`，支持结构判定、单次 `beforeMigrate`、逐 migration 事务和 ledger 修复。
- `src/main/db/connection.ts` 已在 migration 前通过 `VACUUM INTO` 备份数据库，并复制同目录 `action_log.jsonl`。
- assessment/training handler 均遵守 `writeEvent` 后调用 reducer 的写入顺序。
- `doc/specs/impl/01-schema-v0.1.12.sql` 是可加载的 v0.1.12 历史 schema，可作为跨两级迁移测试夹具。
- 本机存在 SQLite CLI 3.50.6，可用于最终 DDL、触发器、外键和完整性验证。自动测试仍使用项目现有的 sql.js `MemoryAdapter`，避免 better-sqlite3 的 Node/Electron ABI 差异。

[!] 当前 `src/main/db/connection.ts` 启动链只执行 migration、完整 schema、结构断言和 seed，仓库内没有读取 `action_log.jsonl` 并驱动 reducer 的重放协调器。M2 不虚构该能力。本计划中的“旧事件兼容”只表示：已反序列化为 `ActionLogEntry` 的旧开始事件可由 reducer 在空投影上按序重建父子记录。完整 JSONL 冷启动恢复需另立里程碑，不作为 M2 验收通过的证据。

## 关键实现决策

1. **M2 是一个发布单元。** Schema、migration、共享类型、handler 和 reducer 最终只以一个 v0.1.14 应用版本发布。实现阶段允许多个可审查 commit，但不得把中间 commit 单独合入 `main` 或发布；功能分支验收后按仓库规则 squash merge。
2. **先兼容测试夹具，再扩展 schema，再改运行时，最后启用触发器。** 这样每一步都能运行对应测试，也避免 D5/D6 先于父记录写入方生效。
3. **父 ID 固定复用子 ID。** 新事件与旧事件重放均使用 `business_session_id = child session id`，但读路径必须读取真实列，不能靠 ID 相等临时拼接。
4. **父记录修复先于子记录幂等判断。** reducer 重放开始事件时先创建或校验父记录，再判断子投影是否已存在；父键冲突直接抛错并回滚。
5. **阶段只从已有领域事实派生。** M2 不新增阶段专用事件。reducer 根据开始、答题、评分、观察与完成事件更新阶段；未知事件保持 no-op。
6. **数据库完成态必须原子写入。** `SESSION_COMPLETED` 使用一条 UPDATE 同时写 `status='COMPLETED'` 与 `delivery_phase='FINALIZED'`，满足 D4 双向约束。

[!] `business_session`、新增列和运行时代码存在强耦合，无法切成可独立发布的多个里程碑。以下 15 步是同一 M2 发布阶段内的审查提交，不是 15 个可分别发布的产品版本。任何中途停止都只能停留在功能分支，不能更新正式工程基线。

## 依赖与数据流

```text
现有 IPC 输入
    |
    v
assessment/training handler
    |  构造向后兼容事件 payload
    v
writeEvent: JSONL -> domain_event_projection
    |
    v
assessment/training reducer
    |----> business_session
    |----> assessment_session / training_session
    |----> question / step / score / result 投影
    |
    v
read handler -> 共享 IPC 输出类型 -> renderer

启动时：v0.1.12/v0.1.13 DB -> migrations.ts -> v0.1.14 结构断言 -> seed/IPC
```

最脆弱的前提是：开始事件内的 `student_id/job_code/task_code/actor_id` 足以重建父记录，并且同一子 ID 没有被 assessment 与 training 同时占用。若历史数据不满足此前提，migration 和 reducer 都必须 fail closed，保留备份并报告冲突，不能猜测或覆盖。

---

## 实现步骤（每步对应一个 commit）

### Step 1：M2 测试夹具前向兼容

**改动文件：**

- `src/main/db/test-helpers.ts`
- `src/main/db/__tests__/schema-scoring-closure.test.ts`
- `src/main/ipc/handlers/__tests__/assessment-read.test.ts`
- `src/main/ipc/handlers/__tests__/observation.test.ts`
- `src/main/utils/__tests__/auth-context.test.ts`

（5 文件）

**核心逻辑：**

- 在 test helper 增加父会话夹具：检测 `business_session` 是否存在；存在时先插入四键匹配的父记录，不存在时保持 M1 测试行为。
- 在 test helper 增加 assessment 状态夹具：检测 `delivery_phase` 是否存在；写 `COMPLETED` 时同步写 `FINALIZED`，写异常终态时保留当前阶段。
- 更新 `seedStrategyReference`，assessment/training 两条引用夹具均先建立匹配父记录；assessment 的完成态写 `FINALIZED`。
- 四个直接 INSERT assessment 的测试改用父会话夹具，并显式写合理的初始阶段。
- helper 只用于测试，不进入生产 bundle，不引入 ORM 或通用数据访问层。

**测试用例：**

- 当前 v0.1.13 schema 下，新增 helper 为 no-op 兼容，原测试全部通过。
- 带 M2 表/列的测试 schema 下，直接子会话夹具均有匹配父记录。
- completed fixture 形成 `COMPLETED + FINALIZED`，异常 fixture 不伪造 FINALIZED。

**验证命令：**

- `npm test -- src/main/db/__tests__/schema-scoring-closure.test.ts src/main/ipc/handlers/__tests__/assessment-read.test.ts src/main/ipc/handlers/__tests__/observation.test.ts src/main/utils/__tests__/auth-context.test.ts`

**commit message 建议：**

`test(m2): make session fixtures business-session aware`

---

### Step 2：Assessment 流程测试前向兼容

**改动文件：**

- `src/main/ipc/handlers/__tests__/assessment-answer.test.ts`
- `src/main/ipc/handlers/__tests__/assessment-emotion.test.ts`
- `src/main/ipc/handlers/__tests__/assessment-redline.test.ts`
- `src/main/ipc/handlers/__tests__/assessment-job-skill.test.ts`
- `src/main/ipc/handlers/__tests__/assessment-read.test.ts`

（5 文件）

**核心逻辑：**

- 所有直接把 assessment 改成 `COMPLETED` 的测试改用 Step 1 状态夹具，保证同时写 `FINALIZED`。
- 直接制造 `ACTIVE`、`OFFLINE_PENDING`、`REDLINE_HALTED`、`ABORTED` 的测试显式保留或设置匹配阶段。
- 当前依赖“create 后立即 ACTIVE”的 answer、emotion、JOB_SKILL 和 read 测试，在准备真实业务动作前显式调用 `startSession`。该调整在 M1 与 M2 行为下都成立。
- 不放宽生产触发器，不在测试中 DROP M2 触发器，也不通过 `PRAGMA foreign_keys=OFF` 绕过约束。
- 仅调整夹具构造，不改变原测试的业务断言。

**测试用例：**

- 完成态、红线态、终止态夹具在 M1 与 M2 schema 下均能建立。
- D3/D4 负向测试仍由后续 schema 约束测试覆盖，不在业务测试中吞掉异常。

**验证命令：**

- `npm test -- src/main/ipc/handlers/__tests__/assessment-answer.test.ts src/main/ipc/handlers/__tests__/assessment-emotion.test.ts src/main/ipc/handlers/__tests__/assessment-redline.test.ts src/main/ipc/handlers/__tests__/assessment-job-skill.test.ts src/main/ipc/handlers/__tests__/assessment-read.test.ts`

**commit message 建议：**

`test(m2): align assessment state fixtures with delivery phases`

---

### Step 3：JOB_SKILL 终态测试夹具兼容

**改动文件：**

- `src/main/ipc/handlers/__tests__/job-skill-report.test.ts`
- `src/main/ipc/handlers/__tests__/job-skill-result.test.ts`
- `src/main/ipc/handlers/__tests__/job-skill-scoring.test.ts`

（3 文件）

**核心逻辑：**

- 三个测试文件统一使用 Step 1 的状态夹具建立 OFFLINE_PENDING、COMPLETED 和 REDLINE_HALTED。
- 完成态始终同步 FINALIZED，异常终态保留终止前阶段。
- 重复评分与重复 finalize 的测试继续验证业务幂等，不通过直接 SQL 绕过 D3/D4。

**测试用例：**

- 报告、结果与评分测试在 M1/M2 schema 下均可建立相同业务前置。
- 已完成、已红线和待评分三类状态夹具符合阶段合同。

**验证命令：**

- `npm test -- src/main/ipc/handlers/__tests__/job-skill-report.test.ts src/main/ipc/handlers/__tests__/job-skill-result.test.ts src/main/ipc/handlers/__tests__/job-skill-scoring.test.ts`

**commit message 建议：**

`test(m2): align job skill fixtures with delivery phases`

---

### Step 4：扩展新库 schema 与增量共享类型

**改动文件：**

- `src/main/db/schema.sql`
- `src/shared/types/event-payloads.ts`
- `src/shared/types/assessment.ts`
- `src/shared/types/training.ts`

（4 文件）

**核心逻辑：**

- 在完整 schema 中加入 T6、B2-B4 和五个 M2 索引，但本步暂不加入 D2-D6/D8，也不更新正式版本号和 migration ledger。五个索引逐名为 `idx_business_session_student`、`idx_business_session_student_job_task`、`ux_assessment_business_session`、`ux_training_business_session`、`idx_assessment_session_delivery_phase`。约束在 Step 12 与 migration 同时启用。
- 新增 `DeliveryPhase` 联合类型。
- `SessionStartedPayload` 增加可选 `business_session_id`、`initial_delivery_phase`、`observation_template_id`。
- `TrainingStartedPayload` 增加可选 `business_session_id`、`module_type`。
- assessment/training 创建与读输出先增加可选字段，使后续运行时提交保持 typecheck 绿色；Step 10/11 在所有写入方和读路径补齐后再收紧为必填。
- 事件字段保持可选是最终合同，不在 Step 10/11 收紧。原因是旧事件必须继续通过同一 payload 类型进入 reducer。

**测试用例：**

- 全量 schema 可被 sql.js 加载。
- 现有 handler 在尚未写入新字段时仍可运行。
- typecheck 覆盖旧 payload 与新 payload 的兼容性。

**验证命令：**

- `npm run typecheck`
- `npm test -- src/main/db/__tests__/schema-scoring-closure.test.ts`

**commit message 建议：**

`feat(m2): expand session schema and shared compatibility types`

---

### Step 5：Assessment 父会话、创建与开始流程

**改动文件：**

- `src/main/domain/assessment-reducer.ts`
- `src/main/ipc/handlers/assessment.ts`
- `src/main/domain/__tests__/assessment-reducer.test.ts`
- `src/main/ipc/handlers/__tests__/assessment-create.test.ts`
- `src/main/ipc/handlers/__tests__/assessment-start-session.test.ts`

（5 文件）

**核心逻辑：**

- `createSession` 令 `businessSessionId=sessionId`，并在开始事件写入父 ID、`PREPARED` 和观察集合标识。
- JOB_SKILL 固定题集含观察题时，观察标识为 `${strategyId}@${strategyVersion}`；其他情况为 NULL。
- assessment reducer 增加精确的父记录创建/校验函数。已有父记录四键完全一致时 no-op；任一字段冲突时抛错。
- `SESSION_STARTED` 先修复父记录，再判断子记录是否存在；新子会话写 `INIT + PREPARED`，题目快照仍在同一事务生成。
- `SESSION_FIRST_QUESTION_ACTIVATED` 使用一条 UPDATE 写 `ACTIVE + ONLINE_IN_PROGRESS`、首题指针、started_at 和事件指针。
- `startSession` 接受 `INIT + PREPARED` 的首次开始；已有指针时保持幂等，不再要求调用前已经是 ACTIVE。
- `ANSWER_SUBMITTED` 只允许 ACTIVE 业务路径。最后一题推进到 `ONLINE_COMPLETED`；需要后续评分或观察时，status 同时进入 OFFLINE_PENDING。不得由答案事件直接写 COMPLETED，后续是否完成由现有结果与完成事件决定。
- assessment reducer 在分发前读取当前 `event_sequence_version`。SESSION_STARTED 始终先修复或校验父记录；其他已识别事件若 `event_sequence <= current version` 则整体 no-op，不再写状态、阶段、计数或事件指针。重放方必须按 aggregate 内序号升序提供事件。
- 已识别且成功完成分支处理的事件按 `event.aggregate_id` 统一执行 MAX 版本 UPDATE；`EMOTION_COLLAPSE_THRESHOLD_REACHED` 虽无额外业务投影，但在 session 存在且序号更新时视为已消费。未知事件不推进版本，分支抛错时事务回滚且版本不变。
- 阶段推进集中到按阶段序号比较的 helper，只允许目标阶段等于或晚于当前阶段。该应用层规则补足 M2 尚未启用 D1 的窗口，不允许调用方任意跳阶段。
- 创建成功返回父 ID。系统异常仍映射 `ASSESSMENT_SYSTEM_ERROR`，不暴露 trigger 文本。

**测试用例：**

- M2-BIZ-01：创建得到相同的两个 ID、父子四键一致、子会话 `INIT + PREPARED`。
- M2-BIZ-03：首次 start 推进状态、阶段、started_at 和版本；重复 start 不新增事件。
- M2-BIZ-04：中途答题保持 ONLINE_IN_PROGRESS，最后一题进入 ONLINE_COMPLETED。
- M2-BIZ-08：无 M2 字段的旧 SESSION_STARTED 可建父子投影；子存在父缺失时补父；冲突父键回滚。
- M2-BIZ-09：同事件重复、较小序列乱序和未知事件分别保持幂等、不降版本、no-op；乱序 emotion interrupt/resume、complete/abort/redline 均不得改写较新状态。
- 旧 SESSION_STARTED 后按序应用旧 answer/emotion 事件，可从空投影重建到相同状态。此项直接传入 `ActionLogEntry`，不声称覆盖 JSONL 文件读取。
- 创建过程中父、子或题目任一写入失败时，SQLite 投影事务整体回滚。JSONL append 可能留下孤儿事件，但自动读取与重放不在 M2 范围。

**验证命令：**

- `npm test -- src/main/domain/__tests__/assessment-reducer.test.ts src/main/ipc/handlers/__tests__/assessment-create.test.ts src/main/ipc/handlers/__tests__/assessment-start-session.test.ts src/main/ipc/handlers/__tests__/assessment-answer.test.ts src/main/ipc/handlers/__tests__/assessment-read.test.ts`
- `npm run typecheck`

**commit message 建议：**

`feat(m2): project assessment business sessions and prepared lifecycle`

---

### Step 6：Training 父会话与事务内模块投影

**改动文件：**

- `src/main/domain/training-reducer.ts`
- `src/main/ipc/handlers/training.ts`
- `src/main/domain/__tests__/training-reducer.test.ts`（新建）
- `src/main/ipc/handlers/__tests__/training-create.test.ts`

（4 文件）

**核心逻辑：**

- `createTrainingSession` 令 `businessSessionId=trainingSessionId`，开始事件携带父 ID 与 `module_type`。
- training reducer 先创建或校验 TRAINING 父记录，再创建子会话和四条 step。
- `module_type` 随 training_session INSERT 一次写入，删除 handler 事务提交后的 UPDATE。
- 旧 TRAINING_STARTED 缺父 ID 时从子 ID 派生，缺 `module_type` 时保留 NULL。
- 子会话已存在但父记录缺失时先修复父记录；父键冲突时抛错。
- 创建成功返回父 ID；错误仍映射 `TRAINING_SYSTEM_ERROR`。

**测试用例：**

- M2-BIZ-02：父、子、module 和四条 step 同事务落库，故障注入后无半成品。
- M2-BIZ-08：新旧 TRAINING_STARTED `ActionLogEntry` 都可在空投影上按序应用，旧事件 module 为 NULL。
- 父记录冲突、同事件重复和未知 training 事件不产生覆盖或重复 step。
- 原 training step、完成和红线测试不回归。

**验证命令：**

- `npm test -- src/main/domain/__tests__/training-reducer.test.ts src/main/ipc/handlers/__tests__/training-create.test.ts src/main/ipc/handlers/__tests__/training-steps.test.ts src/main/ipc/handlers/__tests__/training-complete.test.ts src/main/ipc/handlers/__tests__/training-redline.test.ts`
- `npm run typecheck`

**commit message 建议：**

`feat(m2): project training business sessions atomically`

---

### Step 7：Assessment 评分、观察与完成阶段

**改动文件：**

- `src/main/domain/assessment-reducer.ts`
- `src/main/ipc/handlers/job-skill-result.ts`
- `src/main/ipc/handlers/job-skill-scoring.ts`
- `src/main/ipc/handlers/observation.ts`
- `src/main/ipc/handlers/operation-scoring.ts`

（5 文件）

**核心逻辑：**

- `OFFLINE_SCORE_SUBMITTED` 首次应用时进入 `OFFLINE_SCORING`；后续评分不回退阶段。
- JOB_SKILL 线下评分完成后，有观察集合则进入 `OBSERVATION`，无观察集合则进入 `READY_TO_FINALIZE`。
- `TEACHER_OBSERVATION_RECORDED` 应用后重新计算观察完整性；全部完成时进入 `READY_TO_FINALIZE`。
- 将 `maybeGenerateJobSkillResult` 拆为“不自行开事务的 finalize core”和“供独立重试调用的事务 wrapper”。`submitJobSkillOfflineScores` 与 `recordTeacherObservation` 在各自写入事务末尾调用 core；最后一批评分/观察、RESULT_CALCULATED 与 SESSION_COMPLETED 要么一起提交，要么一起回滚，不保留 READY_TO_FINALIZE 卡点。
- finalize core 只在阶段已就绪、完整性检查通过且 session 仍为开放态时生成结果；红线或 abort 已发生时 no-op，不写 COMPLETED/FINALIZED。
- `SESSION_COMPLETED` reducer 用一条 UPDATE 写 `COMPLETED + FINALIZED + completed_at + 事件指针`。
- `submitOperationScores` 仍只生成 OPERATION_PASS_RATE，不补造 SESSION_COMPLETED；TASK_OPERATION 事实不足以证明整个 assessment 已满足终结条件，阶段停在 OFFLINE_SCORING。
- 情绪中断/恢复不改阶段；abort/redline 保留当前阶段。终态后 reducer 不再尝试阶段更新。

**测试用例：**

- M2-BIZ-05：无观察项的 JOB_SKILL 经 OFFLINE_SCORING、READY_TO_FINALIZE 到 COMPLETED + FINALIZED。
- M2-BIZ-06：有观察项时先 OBSERVATION，再 READY_TO_FINALIZE，最后 FINALIZED。
- M2-BIZ-07：ONLINE_IN_PROGRESS 与 OFFLINE_SCORING 上的 abort/redline 保留阶段。
- `submitOperationScores` 不产生 SESSION_COMPLETED，阶段与 OPERATION_PASS_RATE 事实一致。
- 任一评分/观察/结果事务失败时，不留下阶段先行或完成态半更新；模拟进程在原 `txn()` 与 finalize 调用间退出的旧窗口时，重复提交或显式 wrapper 可幂等恢复。

**验证命令：**

- `npm test -- src/main/domain/__tests__/assessment-reducer.test.ts src/main/ipc/handlers/__tests__/job-skill-scoring.test.ts src/main/ipc/handlers/__tests__/job-skill-result.test.ts src/main/ipc/handlers/__tests__/observation.test.ts src/main/ipc/handlers/__tests__/job-skill-report.test.ts`

**commit message 建议：**

`feat(m2): project assessment scoring and finalization phases`

---

### Step 8：评分、观察与实操阶段测试

**改动文件：**

- `src/main/domain/__tests__/assessment-reducer.test.ts`
- `src/main/ipc/handlers/__tests__/job-skill-result.test.ts`
- `src/main/ipc/handlers/__tests__/job-skill-scoring.test.ts`
- `src/main/ipc/handlers/__tests__/observation.test.ts`
- `src/main/ipc/handlers/__tests__/operation-scoring.test.ts`（新建）

（5 文件）

**核心逻辑：**

- 补齐 OFFLINE_SCORING、OBSERVATION、READY_TO_FINALIZE、FINALIZED 的逐事件投影断言。
- 模拟最后一批评分或观察写入时 finalize core 抛错，断言整个事务回滚；再次提交后可幂等完成。
- 新增 operation scoring handler 测试，覆盖第 1 至第 9 条 OFFLINE_SCORE 事件任一点失败时整体回滚、成功后阶段保持 OFFLINE_SCORING、版本等于最大事件序号且无 SESSION_COMPLETED。
- 覆盖 finalize wrapper 重复调用，不重复 result 或 SESSION_COMPLETED。

**测试用例：**

- M2-BIZ-05、M2-BIZ-06 的完整阶段链。
- 评分提交后异常退出窗口被事务消除，旧 READY_TO_FINALIZE 卡点可由 wrapper 恢复。
- TASK_OPERATION 批次原子、阶段不冒进、版本不回退。

**验证命令：**

- `npm test -- src/main/domain/__tests__/assessment-reducer.test.ts src/main/ipc/handlers/__tests__/job-skill-result.test.ts src/main/ipc/handlers/__tests__/job-skill-scoring.test.ts src/main/ipc/handlers/__tests__/observation.test.ts src/main/ipc/handlers/__tests__/operation-scoring.test.ts`

**commit message 建议：**

`test(m2): cover scoring observation and finalization phases`

---

### Step 9：异常中断与红线阶段冻结测试

**改动文件：**

- `src/main/ipc/handlers/__tests__/assessment-emotion.test.ts`
- `src/main/ipc/handlers/__tests__/assessment-redline.test.ts`

（2 文件）

**核心逻辑：**

- 分别在 ONLINE_IN_PROGRESS、OFFLINE_SCORING、OBSERVATION 和 READY_TO_FINALIZE 触发 emotion interrupt/resume、abort 与 redline。
- emotion 只改 status；resume 后阶段保持原值。
- abort/redline 保留阶段，后续评分、观察或 finalize 均不得把异常终态写成 COMPLETED + FINALIZED。
- 红线发生在最后评分已写但 finalize 尚未执行的构造场景中，finalize core 必须因终态检查 no-op。

**测试用例：**

- M2-BIZ-07 的四个阶段中断矩阵。
- 较小序号的 emotion resume/interrupt、complete、abort 和 redline 事件均不改写较新状态与事件指针。

**验证命令：**

- `npm test -- src/main/ipc/handlers/__tests__/assessment-emotion.test.ts src/main/ipc/handlers/__tests__/assessment-redline.test.ts src/main/domain/__tests__/assessment-reducer.test.ts`

**commit message 建议：**

`test(m2): cover abnormal delivery phase freezing`

---

### Step 10：Assessment 读路径与必填输出

**改动文件：**

- `src/shared/types/assessment.ts`
- `src/main/ipc/handlers/assessment.ts`
- `src/main/ipc/handlers/__tests__/assessment-create.test.ts`
- `src/main/ipc/handlers/__tests__/assessment-read.test.ts`

（4 文件）

**核心逻辑：**

- 创建成功的 `businessSessionId` 改为必填。
- detail/list/listMy 增加必填 `businessSessionId`、`deliveryPhase`、`eventSequenceVersion`、`observationTemplateId`。仅迁移异常数据允许 `deliveryPhase=null`。
- 查询直接 SELECT 子表的 `business_session_id`，不以 `session_id` 临时回填。
- 现有字段、错误码、权限与排序不变。

**测试用例：**

- M2-BIZ-10 的 assessment create/get/list/listMy 增量字段。
- 新建 assessment 阶段非 NULL，迁移异常 assessment 可返回 NULL。
- typecheck 证明每个成功返回分支都提供必填字段。

**验证命令：**

- `npm test -- src/main/ipc/handlers/__tests__/assessment-create.test.ts src/main/ipc/handlers/__tests__/assessment-read.test.ts src/main/ipc/handlers/__tests__/assessment-start-session.test.ts`
- `npm run typecheck`

**commit message 建议：**

`feat(m2): expose assessment business session projections`

---

### Step 11：Training 读路径与必填输出

**改动文件：**

- `src/shared/types/training.ts`
- `src/main/ipc/handlers/training.ts`
- `src/main/ipc/handlers/__tests__/training-create.test.ts`
- `src/main/ipc/handlers/__tests__/training-complete.test.ts`

（4 文件）

**核心逻辑：**

- 创建成功、detail 和 list 的 `businessSessionId` 改为必填。
- 查询直接 SELECT `training_session.business_session_id`，不按 ID 相等规则拼接。
- renderer 与 preload 不新增 IPC 通道或输入字段；现有通道签名通过共享类型获得增量输出。

**测试用例：**

- M2-BIZ-10 的 training create/get/list 增量字段。
- 现有分页、权限、step 和完成结果字段不变。
- typecheck 覆盖所有成功返回分支。

**验证命令：**

- `npm test -- src/main/ipc/handlers/__tests__/training-create.test.ts src/main/ipc/handlers/__tests__/training-complete.test.ts src/main/ipc/handlers/__tests__/training-steps.test.ts`
- `npm run typecheck`

**commit message 建议：**

`feat(m2): expose training business session projections`

---

### Step 12：M2 migration、触发器与结构断言

**改动文件：**

- `src/main/db/migrations.ts`
- `src/main/db/schema.sql`
- `src/main/db/__tests__/migrations.test.ts`
- `src/main/db/__tests__/schema-m2-session-foundation.test.ts`（新建）

（4 文件）

**核心逻辑：**

- 将当前常量切换到 v0.1.14，同时保留独立的 M1 migration id/version，migration 列表固定为 M1 后 M2。
- `MigrationOptions` 增加验证专用的 `throughMigrationId`，允许测试与真实验证器停在完整 M1 后再继续 M2；生产 `connection.ts` 不传该选项，始终迁到当前版本。
- M2 `up` 顺序固定为：建父表、加 nullable 列、回填父记录、回填阶段/版本/观察标识、校验、建五个索引、建 D2-D6/D8。`up` 返回后，runner 再执行结构断言；只有断言通过才由 runner 写 ledger，`up` 内不得重复写 migration 记录。
- assessment/training 父记录使用子 ID 和子表的 student/job/task/created_by。assessment 与 training 子 ID 冲突、已有父四键冲突或空关键字段均拒绝迁移。
- 普通状态回填：COMPLETED 到 FINALIZED，OFFLINE_PENDING 到 OFFLINE_SCORING，INIT 到 PREPARED；ACTIVE/中断/待复核按当前指针或有效答案判定 ONLINE_IN_PROGRESS，否则 PREPARED。
- REDLINE_HALTED/ABORTED 按异常终止前的可验证事实选最深阶段：全部应有评分与观察均完成且不存在安全覆盖结果时为 READY_TO_FINALIZE，已进入观察为 OBSERVATION，已有线下评分为 OFFLINE_SCORING，线上答完为 ONLINE_COMPLETED，已开始为 ONLINE_IN_PROGRESS，仅开始事件为 PREPARED。红线产生的 `LEVEL_FAIL_BY_SAFETY` 结果不作为 READY_TO_FINALIZE 证据；事实互相矛盾或关键记录损坏时保持 NULL。
- `event_sequence_version` 回填 assessment aggregate 的最大 `event_sequence`，无事件为 0。
- 存在 OBSERVATION 题时回填 `${strategy_id}@${strategy_version}`，否则 NULL。
- 结构判定检查表、列、FK、五个索引的列与 partial WHERE、触发器 SQL 语义与父子不变量。发现同名但 SQL 语义不同的对象时 fail closed，不 DROP 后猜测修复。
- 完整结构但 ledger 缺失时只补记录；结构缺失时执行幂等修复；伪造 ledger 不跳过结构检查。
- 完整 schema 加入 D2-D6/D8，追加 M2 ledger，更新头尾版本与 patch notes。D1、D7 必须不存在。
- migration 事务提交前执行 `foreign_key_check` 和 `integrity_check`。任一失败不记录 M2。

**测试用例：**

- M2-MIG-01：空库加载完整 v0.1.14，M1/M2 ledger、结构与触发器完整。
- M2-MIG-02：从冻结的 v0.1.12 schema 构造未开始、答题中、待评分、已完成、红线和终止记录，迁移后数量与主键不变，回填符合合同。
- M2-MIG-03：v0.1.12 同次启动按 M1、M2 顺序迁移，`beforeMigrate` 仅调用一次且收到两个 id。
- M2-MIG-04：ledger 缺失、ledger 伪造、同名错误触发器分别补记录、修复或拒绝。
- M2-MIG-05：重复启动 no-op，不重复回填，不调用备份。
- M2-MIG-06：在回填和建触发器处注入失败，M2 整体回滚到完整 M1。
- M2-MIG-07：父 ID 类型冲突、四键冲突、非法阶段事实均拒绝覆盖。
- M2-MIG-08：D2-D6/D8 正负路径通过，D1/D7 不存在。
- M2-BIZ-11：空父 ID、错 type/student/job/task 和父关键键更新均被数据库拒绝。

**验证命令：**

- `npm test -- src/main/db/__tests__/migrations.test.ts src/main/db/__tests__/schema-m2-session-foundation.test.ts`
- `npm test`

**commit message 建议：**

`feat(db): migrate to m2 business session foundation`

---

### Step 13：启动备份与真实 SQLite 迁移验证

**改动文件：**

- `src/main/db/connection.ts`
- `src/main/db/__tests__/connection-migration.test.ts`（新建）
- `scripts/verify-m2-migration.mjs`（新建）
- `package.json`

（4 文件）

**核心逻辑：**

- 将 `createMigrationBackup` 提取为可注入路径、可单测的导出函数，生产 `initDatabase` 仍在任何 DDL 前通过 runner 的 `beforeMigrate` 调用它。
- connection 集成测试模拟备份成功、数据库备份失败、JSONL 复制失败和结构断言失败。后三种情况均关闭数据库，不进入 seed 或 IPC 可用状态。
- Step 12 的 runner 提供仅供验证器使用的 `throughMigrationId` 选项。验证器先不传 `beforeMigrate`，从冻结 v0.1.12 schema 执行到 M1，构造不带生产备份副作用的 v0.1.13 夹具；复制该夹具后再通过 production connection 执行 M2。正式 v0.1.12 -> M1 -> M2 另用单次 production runner 调用验证，`beforeMigrate` 只触发一次。生产应用不传 `throughMigrationId`。
- 新增 `db:m2:verify`：当前脚本是 sql.js 自动门禁，运行 M2 migration 单测与 schema scoring closure 测试；不读取或修改用户运行库，不触碰 Electron `userData`，不新增运行时依赖。
- M2 migration 单测覆盖 v0.1.12 形态旧库执行 M1+M2、同名错误触发器/索引漂移、ledger 补写前 `foreign_key_check`/`integrity_check` 闸门、D2-D6/D8 关键负向样例，并断言 D1/D7 不存在。
- Node 直接加载 `better-sqlite3` 在当前开发机仍可能受 Node/Electron ABI 差异影响；native 可用性不由 `db:m2:verify` 承诺，继续通过 Electron build/smoke 路径验证。

**测试用例：**

- M2-MIG-02、M2-MIG-03、M2-MIG-04、M2-MIG-05、M2-MIG-08 的 sql.js 自动测试路径。
- M2 结构完整但 ledger 缺失时，必须先通过 `foreign_key_check` 和 `integrity_check` 才能补记录。
- 同名错误触发器或索引不能被当作当前结构；runner 会 fail closed，不覆盖错误对象。
- 验证脚本失败时退出码非 0，并输出正在运行的测试 gate。

**验证命令：**

- `npm run db:m2:verify`
- `npm test -- src/main/db/__tests__/connection-migration.test.ts src/main/db/__tests__/migrations.test.ts`

**commit message 建议：**

`test(db): verify m2 backup and native migration flow`

---

### Step 14：工程基线文档传播

**改动文件：**

- `AGENTS.md`
- `README.md`
- `doc/index.md`
- `doc/features/local-database-sync-sop.md`
- `doc/features/multi-device-v2.2-migration-prd.md`

（5 文件）

**核心逻辑：**

- 将正式工程基线更新为 v0.1.14。只更新“当前基线”类引用；历史 migration id、旧版本 patch note 与冻结 schema 说明不改写。
- M2 Mini-PRD 状态按实际进度更新为已实施或待验收，不提前写“已验收”。
- `rg` 扫描所有 v0.1.13 token，逐一判定当前引用或历史引用。
- 运行文档索引更新与检查，自动清单区块只由脚本修改。

**测试用例：**

- AGENTS、README、文档导航和数据库 SOP 指向同一当前版本。
- M1 历史实现记录仍保留 v0.1.13，不被批量替换破坏。

**验证命令：**

- `npm run docs:index:update`
- `npm run docs:index:check`
- `rg -n "0\\.1\\.13-multi-device-m1-identity" AGENTS.md README.md src doc`

**commit message 建议：**

`docs(m2): update current schema baseline to v0.1.14`

---

### Step 15：权威说明同步与最终发布闸门

**改动文件：**

- `doc/specs/MVP_PRD_v1.0.9-authoritative.md`
- `doc/specs/impl/NEW-SESSION-PROMPT.md`
- `doc/features/multi-device-v2.2-migration-impl.md`

（3 文件）

**核心逻辑：**

- 更新权威 PRD 中“当前 schema 基线”的事实说明，不改变 PRD v1.0.9 业务合同正文与历史差异记录。
- 更新新会话提示中的当前版本和 M2 已知边界，保留 `[!]` JSONL 重放协调器缺失项，避免后续会话误报已有冷启动恢复。
- 所有自动与手工验收通过后，才把本实现文档状态改为“已验收”。

**测试用例：**

- 当前版本、M2 范围和 M3/M6 延后项在三份文档中一致。
- 最终工程闸门全部通过，无新增 lint warning。

**验证命令：**

- `npm run db:m2:verify`
- `npm run docs:index:check`
- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`
- `git diff --check`

**commit message 建议：**

`docs(m2): finalize v0.1.14 implementation record`

---

## 验收矩阵映射

| 合同编号 | 主实现步骤 | 自动验证 |
|----------|------------|----------|
| M2-MIG-01 | Step 12、Step 13 | migration test + schema 加载验证 |
| M2-MIG-02 | Step 12、Step 13 | 历史 schema 数据快照测试 |
| M2-MIG-03 | Step 12、Step 13 | migration 顺序测试 |
| M2-MIG-04 | Step 12、Step 13 | 结构漂移与 ledger 测试 |
| M2-MIG-05 | Step 12、Step 13 | 幂等启动测试 |
| M2-MIG-06 | Step 12 | 事务故障注入测试 |
| M2-MIG-07 | Step 12 | 冲突数据集成测试 |
| M2-MIG-08 | Step 12、Step 13 | schema trigger test + PRAGMA 验证 |
| M2-BIZ-01 | Step 5 | assessment create/reducer test |
| M2-BIZ-02 | Step 6 | training create/reducer test |
| M2-BIZ-03 | Step 5 | assessment start test |
| M2-BIZ-04 | Step 5 | assessment answer/reducer test |
| M2-BIZ-05 | Step 7、Step 8 | JOB_SKILL 无观察闭环测试 |
| M2-BIZ-06 | Step 7、Step 8 | JOB_SKILL 观察闭环测试 |
| M2-BIZ-07 | Step 7、Step 9、Step 12 | redline/abort test + D3 trigger test |
| M2-BIZ-08 | Step 5、Step 6 | 两类 reducer 旧 ActionLogEntry 测试 |
| M2-BIZ-09 | Step 5、Step 9 | reducer 幂等、乱序与未知事件测试 |
| M2-BIZ-10 | Step 10、Step 11 | assessment/training read test |
| M2-BIZ-11 | Step 12、Step 13 | schema 负向测试 + PRAGMA 验证 |
| M2-BIZ-12 | Step 15 | 全量工程闸门 |

## 回滚与失败处理

- Step 12 前的中间 commit 只允许存在于功能分支。若方向被否决，丢弃该功能分支；不得把带部分 M2 结构的 `schema.sql` 合入 `main`。
- migration 未提交时，由单个 M2 SQLite 事务回滚到完整 M1；ledger 不写入。
- migration 已提交但应用启动后续失败时，不自动 down。修复当前版本后重试；必须降级时，关闭应用并恢复同一迁移前目录中的 DB 与 `action_log.jsonl`。
- schema 触发器或结构断言失败时，应用不得进入 seed、IPC 或 renderer。
- JSONL append 发生但 SQLite 事务失败时，允许留下孤儿事件。M2 reducer 能在调用方提供按序 `ActionLogEntry` 时幂等重建；当前仓库没有自动 JSONL 重放协调器，因此不得把该路径描述为已自动恢复。
- 不通过删除父记录、改写父键或 `INSERT OR REPLACE` 修复冲突。

## 项目约束自检

- [ ] 事件写入仍为 JSONL append -> domain_event_projection -> reducer。
- [ ] 未新增 EventType，只扩展两个开始事件的可选 payload。
- [ ] 未新增 IPC 通道，preload 白名单无需修改。
- [ ] 未新增 renderer 必填输入或持久化状态。
- [ ] 未引入 ORM、CSV、Markdown renderer 或新运行时依赖。
- [ ] `src/main/` 本地模块仍使用静态 import。
- [ ] delivery phase 写入与 D2-D4 一致，D1 明确留到 M3。
- [ ] 安全红线保留现有触发链，异常终态阶段冻结且不写 FINALIZED。
- [ ] `module_type`、观察集合标识与其他 JSON 派生值均来自已验证的 strategy 配置。
- [ ] 每个业务成功输出分支都满足共享类型的必填增量字段。
- [x] v0.1.12 形态旧库、M1 已应用旧库、新库和重复启动路径均有自动验证。

## 回归验收清单

- [x] `npm run db:m2:verify` 通过。
- [x] `npm run docs:index:check` 通过。
- [x] `npm run typecheck` 通过。
- [x] `npm run lint` 0 error；当前仍为 160 个既有 Vue warning。
- [x] `npm test` 全量通过。
- [x] `npm run build` 通过。
- [x] `git diff --check` 通过。
- [ ] 手工冒烟：教师创建 assessment，学生 start 并答题，教师完成 JOB_SKILL 评分/观察，最终得到 COMPLETED + FINALIZED。
- [ ] 手工冒烟：教师创建 training，四步完成，父子记录和 module_type 正确。
- [ ] 手工冒烟：ONLINE_IN_PROGRESS 与 OFFLINE_SCORING 各触发一次红线，阶段保留、状态冻结、后续阶段写入被拒。
- [ ] 手工运维：复制一份 v0.1.13 数据库启动新版本，确认只生成一个迁移备份目录，业务记录数量与主键不变。

## 实施完成定义

只有以下条件同时满足，M2 才能从“实现中”改为“已验收”：

1. 15 个步骤全部完成，并经过逐步 `/vibe-accept`。
2. M2-MIG-01 至 M2-MIG-08、M2-BIZ-01 至 M2-BIZ-12 均有通过证据。
3. 当前基线文档已更新为 v0.1.14，历史版本说明未被误改。
4. 功能分支通过最终 `/check`，再按仓库规则 squash merge 到 `main`。

---

## M3 Grant/Assignment：实现文档

> **状态：** 待实施
> **对应 Mini-PRD：** `doc/features/multi-device-v2.2-migration-prd.md` §11
> **当前起点：** schema v0.1.14-multi-device-m2-session-foundation
> **目标版本：** schema v0.1.15-multi-device-m3-grant-assignment
> **目标 migration id：** `2026-07-15_mvp_schema_v0_1_15_multi_device_m3_grant_assignment`

## M3 实现目标（一句话）

在 M2 `business_session` 父会话之上落地本地 Grant/Assignment 最小闭环，让新 assessment 从 `PREPARED` 经 `ASSIGNED`、`STUDENT_CONFIRMED` 后才能进入 `ONLINE_IN_PROGRESS`，同时保持 v0.1.14 存量进行中会话可继续答题。

## M3 范围与非范围

### 本轮交付

- `delegated_access_grant`、`business_session_assignment` 两张表、五个索引、D9-D11 六个触发器。
- D1 `trg_assessment_delivery_phase_forward_only`。
- `assessment_session.delivery_phase` CHECK 枚举升级，补入 `ASSIGNED`、`STUDENT_CONFIRMED`。
- M3 migration、结构断言、漂移拒绝、完整性校验。
- Assignment 共享类型、IPC 白名单、主进程 handler 和本地领域投影。
- `ASSIGNMENT_CREATED`、`ASSIGNMENT_STUDENT_CONFIRMED`、`ASSIGNMENT_ASSESSMENT_STARTED`、`GRANT_REBOUND`、`ASSIGNMENT_RELEASED` 事件。
- `assignment:create`、`assignment:confirmStudent`、`assignment:startAssessment`、`assignment:rebind`、`assignment:release`。
- `assessment:startSession` 收窄为 M3 状态机兼容入口。
- 本地最小 node/device/runtime/auth_session 引导，生成每库唯一 ID，不写固定 `org_default`。

### 明确不交付

- M4 安全事件聚合键 re-key。
- M5 command_log、SSE、REST/HTTPS、租约、跨设备同步和离线冲突合并。
- M6 learning_session / learning_progress 与 D7。
- M7 offline_score_draft、invalidation、correction、backup_manifest、pairing_challenge。
- PIN、PHOTO_MATCH、摄像头、照片比对、真实设备发现、证书、网络配对或生产级推送。
- renderer 新页面。M3 只暴露 IPC 与本地数据闭环，前端接入可另立小步。

## M3 前置条件

- M2 migration runner 已能按静态列表顺序执行、备份、事务提交、结构断言和 ledger 修复。
- M2 新库/旧库均已有 `business_session`、assessment/training 父子约束、D2-D6、D8，且 D1/D7 不存在。
- `assessment:createSession` 已创建 `INIT + PREPARED` 的 assessment，`business_session_id` 已稳定存在。
- `assessment:startSession` 当前仍允许 M2 直跳 `ONLINE_IN_PROGRESS`，M3 必须按 phase/assignment 条件收窄。
- 当前仓库没有 JSONL 冷启动自动重放协调器；M3 事件只承诺通过当前 `writeEvent` + reducer 路径更新 SQLite 投影。

[!] M3 的第一处 PRD/Schema 冲突已经在 PRD §11.2 修正：v0.1.14 的 `assessment_session.delivery_phase` CHECK 不含 `ASSIGNED` / `STUDENT_CONFIRMED`。实现时若只新增 D1 和 Assignment 表，会在 `assignment:create` 第一次更新阶段时失败。M3 migration 必须先升级 CHECK 枚举，再启用 D1。

## M3 关键实现决策

1. **M3 仍是单版本发布单元。** Schema、migration、事件类型、IPC、handler、reducer 和 startSession 收窄必须随 v0.1.15 一起交付；中间 commit 只在功能分支审查。
2. **用表重建升级 SQLite CHECK。** SQLite 不能原地修改列 CHECK；M3 通过事务内重建 `assessment_session` 保留所有列、数据、索引和 M2 触发器，再创建 D1。重建前后用行数、主键集合和关键字段快照验证。
3. **Assignment 事件聚合到 `BUSINESS_SESSION`。** 新增 `AggregateType='BUSINESS_SESSION'`，Grant/Assignment 投影负责更新 grant、assignment 与 assessment phase；真正启动答题仍写 `ASSESSMENT_SESSION` 聚合事件，复用首题激活语义。
4. **首版确认方式只做两种。** `TEACHER_ATTESTATION` 由教师/管理员确认；`NONE_REQUIRED` 只允许同机开发或演示路径，确认 evidence 可为空但仍显式写确认事件。PIN/PHOTO_MATCH 类型可保留在 schema 枚举中，不暴露为成功业务路径。
5. **本地 runtime 引导生成每库唯一数据。** 若缺 node/device/runtime/auth_session，则用 UUID 创建可审计本地记录并复用已有 ACTIVE runtime；不得创建固定 `org_default`、固定 device_id、固定 token_hash 或跨安装共享 ID。
6. **M2 存量进行中会话不追溯 assignment。** `ONLINE_IN_PROGRESS` 或之后阶段保持旧路径兼容；`PREPARED` 存量会话可被新 assignment 流程接管。

最脆弱的前提是：重建 `assessment_session` 时能完整保留当前 schema 中所有列和索引。若 implementation 发现表结构已经发生未记录漂移，M3 migration 必须 fail closed，不能用 `CREATE TABLE AS SELECT` 丢约束或猜测恢复。

## M3 数据流

```text
TEACHER/ADMIN assignment:create
  -> ensureLocalRuntimeContext
  -> writeEvent(BUSINESS_SESSION, ASSIGNMENT_CREATED)
  -> applyAssignmentEvent: grant ACTIVE + assignment PENDING_CONFIRM + phase ASSIGNED

STUDENT/TEACHER assignment:confirmStudent
  -> writeEvent(BUSINESS_SESSION, ASSIGNMENT_STUDENT_CONFIRMED)
  -> applyAssignmentEvent: assignment ACTIVE + phase STUDENT_CONFIRMED

STUDENT assignment:startAssessment
  -> writeEvent(ASSESSMENT_SESSION, ASSIGNMENT_ASSESSMENT_STARTED)
  -> reducer: status ACTIVE + phase ONLINE_IN_PROGRESS + first question pointer
```

## M3 实现步骤（每步对应一个 commit）

### Step M3-1：Schema 全量基线升级到 v0.1.15

**改动文件：**

- `src/main/db/schema.sql`
- `src/main/db/__tests__/schema-scoring-closure.test.ts`
- `doc/features/multi-device-v2.2-migration-prd.md`

**核心逻辑：**

- 头注释与 `schema_migration` seed 增加 v0.1.15/M3 记录。
- `assessment_session.delivery_phase` CHECK 增加 `ASSIGNED`、`STUDENT_CONFIRMED`。
- 按权威基线 T7/T8 增加 `delegated_access_grant`、`business_session_assignment`、五个索引。
- 按权威基线 §9.4、§7.5 增加 D1、D9-D11 七个触发器。
- 保留 D7 缺席，M4-M7 表与安全 re-key 触发器不进入 schema。

**测试用例：**

- 新库完整加载后 `foreign_key_check` 空、`integrity_check=ok`。
- `delivery_phase='ASSIGNED'`、`'STUDENT_CONFIRMED'` 可插入/更新；非法 phase 仍被 CHECK 拒绝。
- D1 阻止 `PREPARED -> ONLINE_IN_PROGRESS`、`ASSIGNED -> ONLINE_IN_PROGRESS`、`FINALIZED -> OBSERVATION`。
- D9-D11 基础负向：grant student 不匹配、assignment 指向非 ACTIVE grant、assigned_by 非教师非 ACTIVE ADMIN。

**验证命令：**

- `npm test -- src/main/db/__tests__/schema-scoring-closure.test.ts`

**commit message 建议：**

`feat(schema): add m3 grant assignment baseline`

---

### Step M3-2：M3 migration runner 与 CHECK 表重建

**改动文件：**

- `src/main/db/migrations.ts`
- `src/main/db/__tests__/migrations.test.ts`
- `src/main/db/__tests__/connection-migration.test.ts`

**核心逻辑：**

- 新增 `M2_SCHEMA_VERSION` / `M2_MIGRATION_ID` 常量，并把 `CURRENT_SCHEMA_VERSION` / `CURRENT_MIGRATION_ID` 切到 M3。
- 新增 `isM3StructurallyApplied()`：断言 M2 仍通过、T7/T8、五索引、D1/D9-D11 语义匹配、`delivery_phase` 完整枚举、D7 和 M4-M7 对象不存在。
- `applyM3Migration()` 顺序：
  1. 校验 M2 完整。
  2. 快照 assessment 行数、主键集合和关键字段。
  3. 重建 `assessment_session`，只扩 CHECK，不改业务值。
  4. 重新创建 assessment 相关索引与 M2 assessment 触发器。
  5. 创建 T7/T8、索引、D9-D11、D1。
  6. 快照回查、`foreign_key_check`、`integrity_check` 通过后写 M3 ledger。
- 同名错误对象必须 fail closed；不得 `DROP TRIGGER IF EXISTS` 覆盖语义不符对象。

**测试用例：**

- v0.1.14 旧库升级后原 assessment/training 行数、主键和关键字段不变。
- M2 结构完整但 M3 ledger 缺失时补 ledger；M3 结构残缺时拒绝。
- 注入错误 D1/D9-D11 或错误索引，runner 失败且不写 M3 记录。
- 重建过程中故障注入时事务回滚，旧库仍是完整 M2。

**验证命令：**

- `npm test -- src/main/db/__tests__/migrations.test.ts src/main/db/__tests__/connection-migration.test.ts`

**commit message 建议：**

`feat(db): migrate v0.1.15 grant assignment schema`

---

### Step M3-3：本地 runtime/auth 引导服务

**改动文件：**

- `src/main/domain/local-runtime-context.ts`
- `src/main/domain/__tests__/local-runtime-context.test.ts`
- `src/main/db/test-helpers.ts`

**核心逻辑：**

- 新增 `ensureLocalRuntimeContext(db, teacherUserId)`，返回 `organizationId`、`nodeId`、`deviceId`、`deviceRuntimeSessionId`、`teacherAuthSessionId`。
- 若库中已有 ACTIVE 本地 runtime，则复用；否则用 UUID 新建 organization/node/device/runtime，名称可读但 ID 不固定。
- 若教师已有 ACTIVE 且未过期的 auth_session 可复用；否则插入新的 `auth_session`，`auth_method='DEVICE_KEY'`，`token_hash` / `refresh_token_hash` 使用 UUID 派生哈希，不写明文 token。
- 只在 assignment handler 调用，不在 `initDatabase()` 自动污染每个库。

**测试用例：**

- 空 M1/M2/M3 拓扑下首次调用创建完整 FK 链。
- 重复调用复用同一 ACTIVE runtime，不触发 `ux_device_one_active_runtime`。
- 不生成固定 `org_default`、固定 device_id、固定 token_hash。
- teacher 非 ACTIVE 或非 TEACHER/ADMIN 时拒绝。

**验证命令：**

- `npm test -- src/main/domain/__tests__/local-runtime-context.test.ts`

**commit message 建议：**

`feat(m3): add local runtime context bootstrap`

---

### Step M3-4：Assignment 共享类型、事件合同与 IPC 白名单

**改动文件：**

- `src/shared/types/assignment.ts`
- `src/shared/types/event-payloads.ts`
- `src/shared/types/ipc-api.ts`
- `src/preload/index.ts`

**核心逻辑：**

- 新增 assignment IPC 参数/结果类型和错误码联合：`ASSIGNMENT_REQUIRED`、`STUDENT_CONFIRMATION_REQUIRED`、`ASSIGNMENT_NOT_ACTIVE`、`DEVICE_RUNTIME_NOT_ACTIVE`、`GRANT_AUTH_INVALID`、`UNSUPPORTED_CONFIRMATION_METHOD`。
- `AggregateType` 增加 `BUSINESS_SESSION`；`EventType` 增加 M3 五个事件。
- 新增五个事件 payload interface，payload 包含可重建 grant/assignment/phase 的完整字段，不依赖 handler 后置 UPDATE。
- `IpcApi` 与 preload 增加 `assignment.create`、`confirmStudent`、`startAssessment`、`rebind`、`release` 白名单。

**测试用例：**

- `npm run typecheck` 覆盖共享类型。
- 新事件 payload 字段足以重建 grant、assignment、phase，不引用未落地 M5 command_log 字段。

**验证命令：**

- `npm run typecheck`

**commit message 建议：**

`feat(types): define m3 assignment ipc and events`

---

### Step M3-5：Assignment reducer 与 DB 投影

**改动文件：**

- `src/main/domain/assignment-reducer.ts`
- `src/main/domain/__tests__/assignment-reducer.test.ts`
- `src/main/domain/assessment-reducer.ts`

**核心逻辑：**

- 新增 `applyAssignmentEvent(db, event)` 处理 BUSINESS_SESSION 聚合事件：
  - `ASSIGNMENT_CREATED`：插入 ACTIVE grant、PENDING_CONFIRM assignment，更新 assessment `PREPARED -> ASSIGNED`。
  - `ASSIGNMENT_STUDENT_CONFIRMED`：assignment `PENDING_CONFIRM -> ACTIVE`，写确认字段，assessment `ASSIGNED -> STUDENT_CONFIRMED`。
  - `GRANT_REBOUND`：旧 grant EXPIRED，新 grant ACTIVE，assignment 改指新 grant、version+1，按需清空确认。
  - `ASSIGNMENT_RELEASED`：assignment 终态、grant 终态。
- `assessment-reducer` 增加 `ASSIGNMENT_ASSESSMENT_STARTED`，复用 `SESSION_FIRST_QUESTION_ACTIVATED` 指针语义，但要求 phase 已是 `STUDENT_CONFIRMED`。
- reducer 幂等：已存在 grant/assignment 或 event_sequence 已旧时不重复推进；冲突字段不覆盖。

**测试用例：**

- 创建、确认、启动三步按 D1 合法推进。
- 重复 apply 不重复插入、不重复 version+1。
- 乱序确认或启动在缺少前置状态时不写出非法 phase。
- D9-D11 由真实 SQLite 触发器兜底，reducer 冲突时抛错并回滚。

**验证命令：**

- `npm test -- src/main/domain/__tests__/assignment-reducer.test.ts src/main/domain/__tests__/assessment-reducer.test.ts`

**commit message 建议：**

`feat(m3): project assignment events`

---

### Step M3-6：Assignment IPC handler

**改动文件：**

- `src/main/ipc/handlers/assignment.ts`
- `src/main/ipc/handlers/__tests__/assignment.test.ts`
- `src/main/ipc/index.ts`

**核心逻辑：**

- 新增纯函数并由 IPC 薄包装注册：
  - `createAssignment`
  - `confirmStudentAssignment`
  - `startAssignedAssessment`
  - `rebindAssignment`
  - `releaseAssignment`
- 每个写路径遵守 JSONL append -> `domain_event_projection` -> reducer。
- `assignment:create` 校验 TEACHER/ADMIN、business_session 类型为 ASSESSMENT、assessment phase 为 PREPARED、runtime ACTIVE、teacher auth ACTIVE 未过期；默认 `TEACHER_ATTESTATION`。
- `assignment:confirmStudent` 首版只接受 `NONE_REQUIRED` / `TEACHER_ATTESTATION`；PIN/PHOTO_MATCH 返回 `UNSUPPORTED_CONFIRMATION_METHOD`，不进入成功路径。
- `assignment:startAssessment` 校验 STUDENT、assignment ACTIVE、session owner、phase STUDENT_CONFIRMED 后写启动事件。
- `assignment:rebind` 按 expire-old -> create-new -> repoint-assignment 顺序单事务完成。

**测试用例：**

- M3-GRANT-01、M3-PHASE-03、M3-PHASE-04 正向集成。
- 非教师创建、学生不匹配、runtime 非 ACTIVE、auth 过期返回明确错误。
- PIN/PHOTO_MATCH 不被首版接受。
- rebind 无需重确认与需重确认两条路径均 version+1。

**验证命令：**

- `npm test -- src/main/ipc/handlers/__tests__/assignment.test.ts`

**commit message 建议：**

`feat(ipc): add assignment grant handlers`

---

### Step M3-7：收窄 assessment:startSession 并兼容存量会话

**改动文件：**

- `src/main/ipc/handlers/assessment.ts`
- `src/main/ipc/handlers/__tests__/assessment-start-session.test.ts`
- `src/shared/types/assessment.ts`

**核心逻辑：**

- 原 `assessment:startSession`：
  - phase `PREPARED` 返回 `ASSIGNMENT_REQUIRED`。
  - phase `ASSIGNED` 返回 `STUDENT_CONFIRMATION_REQUIRED`。
  - phase `STUDENT_CONFIRMED` 返回 `STUDENT_CONFIRMATION_REQUIRED`，提示使用 `assignment:startAssessment`，避免绕过 assignment 校验。
  - phase `ONLINE_IN_PROGRESS` 或之后且已有 current_question_id 的 M2 存量会话继续幂等成功。
- `assignment:startAssessment` 可复用内部 helper 激活第一题，但外部旧 IPC 不得直跳 D1。
- 更新错误码 seed，保证 `error_event_log.error_code` FK 可写。

**测试用例：**

- M3-PHASE-01、M3-PHASE-02。
- M2 存量 `ONLINE_IN_PROGRESS` 会话重复 start 仍成功，不要求 assignment。
- 新 M3 `STUDENT_CONFIRMED` 会话直接调用旧 startSession 不写事件、不改 phase。

**验证命令：**

- `npm test -- src/main/ipc/handlers/__tests__/assessment-start-session.test.ts`

**commit message 建议：**

`feat(assessment): require assignment before start`

---

### Step M3-8：M3 schema/handler 负向约束测试补齐

**改动文件：**

- `src/main/db/__tests__/schema-m3-grant-assignment.test.ts`
- `src/main/ipc/handlers/__tests__/assignment.test.ts`
- `src/main/db/test-helpers.ts`

**核心逻辑：**

- 增加真实 SQLite/MemoryAdapter 负向测试覆盖 D9-D11 和 D1。
- test helper 增加最小 business_session + runtime + auth + assignment 夹具，但只供测试使用。
- 覆盖 `ASSIGNMENT_REQUIRED`、`STUDENT_CONFIRMATION_REQUIRED`、`ASSIGNMENT_NOT_ACTIVE`、`DEVICE_RUNTIME_NOT_ACTIVE`、`GRANT_AUTH_INVALID`、`UNSUPPORTED_CONFIRMATION_METHOD`。

**测试用例：**

- M3-GRANT-02 至 M3-GRANT-04。
- M3-ASSIGN-01 至 M3-ASSIGN-03。
- M3-PHASE-05。
- assignment release 后不能再次 start；grant EXPIRED 时活动 assignment 写入被 D11 拒绝。

**验证命令：**

- `npm test -- src/main/db/__tests__/schema-m3-grant-assignment.test.ts src/main/ipc/handlers/__tests__/assignment.test.ts`

**commit message 建议：**

`test(m3): cover grant assignment constraints`

---

### Step M3-9：读路径与最小人工验证入口

**改动文件：**

- `src/shared/types/assignment.ts`
- `src/main/ipc/handlers/assignment.ts`
- `src/renderer/src/stores/assessment.ts`
- `src/renderer/src/views/student/AssessmentView.vue`

**核心逻辑：**

- 当前学生答题 UI 仍直接调用 `assessment.startSession`；M3 最小改为收到 `ASSIGNMENT_REQUIRED` / `STUDENT_CONFIRMATION_REQUIRED` 时停止进入答题态，并复用现有错误展示入口显示阻断原因。
- 本轮不新增 `assignment:getActiveForSession` 或完整教师分配页面；教师创建/确认 assignment 的验收通过 handler 集成测试和主进程 IPC 调用完成。
- UI 不自动伪造 assignment、不调用 `assignment:confirmStudent`，避免把首版本地授权流程伪装成完整跨设备体验。

**测试用例：**

- renderer typecheck 通过。
- 学生误点未分配 assessment 不会进入答题页，也不会写 `ONLINE_IN_PROGRESS`。

**验证命令：**

- `npm run typecheck`
- `npm test -- src/main/ipc/handlers/__tests__/assignment.test.ts`

**commit message 建议：**

`feat(m3): expose minimal assignment start path`

---

### Step M3-10：文档、版本传播与最终闸门

**改动文件：**

- `AGENTS.md`
- `README.md`
- `doc/features/multi-device-v2.2-migration-prd.md`
- `doc/features/multi-device-v2.2-migration-impl.md`
- `doc/index.md`

**核心逻辑：**

- 当前工程基线更新为 `0.1.15-multi-device-m3-grant-assignment`。
- PRD §2 / §11 状态从 PRD DRAFT 更新为实现中或待验收，不改写 M1/M2 历史记录。
- 实现文档自检项按实际完成勾选；未执行的手工冒烟保持未勾。
- 运行文档索引更新与检查。

**测试用例：**

- `rg` 扫描 `0.1.14-multi-device-m2-session-foundation`，只保留历史引用，当前基线类引用均指向 v0.1.15。
- docs index 自动清单由脚本更新，无手工编辑自动区块。

**验证命令：**

- `npm run docs:index:update`
- `npm run docs:index:check`
- `rg -n "0\\.1\\.14-multi-device-m2-session-foundation" AGENTS.md README.md src doc`

**commit message 建议：**

`docs(m3): update baseline to v0.1.15`

## M3 验收矩阵映射

| 合同编号 | 主实现步骤 | 自动验证 |
|----------|------------|----------|
| M3-MIG-01 | Step M3-1、M3-2 | schema 加载 + migration test |
| M3-MIG-02 | Step M3-2 | v0.1.14 旧库迁移测试 |
| M3-MIG-03 | Step M3-2、M3-8 | drift 单测 |
| M3-GRANT-01 | Step M3-5、M3-6 | handler 集成测试 |
| M3-GRANT-02 | Step M3-8 | SQLite 负向测试 |
| M3-GRANT-03 | Step M3-8 | SQLite 负向测试 |
| M3-GRANT-04 | Step M3-6、M3-8 | handler + trigger 测试 |
| M3-ASSIGN-01 | Step M3-8 | trigger 测试 |
| M3-ASSIGN-02 | Step M3-8 | trigger 测试 |
| M3-ASSIGN-03 | Step M3-8 | trigger 测试 |
| M3-PHASE-01 | Step M3-7 | startSession 回归测试 |
| M3-PHASE-02 | Step M3-7 | startSession 回归测试 |
| M3-PHASE-03 | Step M3-5、M3-6 | handler 集成测试 |
| M3-PHASE-04 | Step M3-5、M3-6 | handler 集成测试 |
| M3-PHASE-05 | Step M3-1、M3-8 | SQLite trigger 测试 |
| M3-REBIND-01 | Step M3-5、M3-6 | rebind 集成测试 |
| M3-REBIND-02 | Step M3-5、M3-6 | rebind 集成测试 |
| M3-REG-01 | Step M3-7、M3-10 | 全量 vitest + focused tests |

## M3 回滚与失败处理

- M3 migration 未提交时，由单个 SQLite 事务回滚到完整 M2。
- `assessment_session` 重建失败不得留下 `_new` / `_old` 临时表；测试必须覆盖故障注入后的对象清理或事务回滚。
- M3 已提交但应用启动后续失败时不自动 down。修复当前版本后重试；必须降级时恢复迁移前 DB 与 `action_log.jsonl` 备份。
- rebind 事务中任何一步失败都回滚到旧 grant/assignment 状态，不允许旧 grant EXPIRED 而 assignment 仍指向旧 grant 的提交态。
- JSONL append 成功但 SQLite reducer 失败时，保持现有事件溯源风险边界；M3 不宣称已实现 M5 command_log 幂等恢复。

## M3 项目约束自检

- [ ] 事件写入顺序仍为 JSONL append -> domain_event_projection -> reducer。
- [ ] 新 EventType 与 AggregateType 已加入 `src/shared/types/event-payloads.ts`。
- [ ] 新 IPC 通道已在 `src/preload/index.ts` 白名单声明。
- [ ] 未新增 ORM、CSV、Markdown renderer 或新运行时依赖。
- [ ] `src/main/` 本地模块仍使用静态 import。
- [ ] FSM 状态迁移路径与 D1/D2-D4 一致。
- [ ] D7、M4 safety re-key、M5 command_log/SSE、M6 learning、M7 支撑表未提前落地。
- [ ] JSON 字段 `capabilities_json` / `confirmation_evidence` 写入前有运行时验证。
- [ ] 本地 runtime 引导不创建固定 `org_default` 或跨安装共享 ID。
- [ ] `assessment:startSession` 不再允许新 M3 会话绕过 assignment。

## M3 回归验收清单

- [ ] `npm run docs:index:check` 通过。
- [ ] `npm run typecheck` 通过。
- [ ] `npm run lint` 通过或仅剩既有 warning 且无新增 error。
- [ ] `npm test` 全量通过。
- [ ] `npm run build` 通过。
- [ ] `git diff --check` 通过。
- [ ] 手工冒烟：教师创建 assessment -> assignment:create -> confirmStudent -> assignment:startAssessment -> 学生答第一题。
- [ ] 手工冒烟：`assessment:startSession` 对 PREPARED/ASSIGNED 返回明确错误，不写事件、不改 phase。
- [ ] 手工冒烟：rebind 无需重确认与需重确认两条路径均保持事务一致。

## M3 实施完成定义

只有以下条件同时满足，M3 才能从“待实施/实现中”改为“已验收”：

1. Step M3-1 至 Step M3-10 全部完成，并经过逐步 `/vibe-accept`。
2. M3-MIG-01 至 M3-MIG-03、M3-GRANT-01 至 M3-GRANT-04、M3-ASSIGN-01 至 M3-ASSIGN-03、M3-PHASE-01 至 M3-PHASE-05、M3-REBIND-01 至 M3-REBIND-02、M3-REG-01 均有通过证据。
3. 当前基线文档已更新为 v0.1.15，历史版本说明未被误改。
4. 功能分支通过最终 `/check`，再按仓库规则合并。
