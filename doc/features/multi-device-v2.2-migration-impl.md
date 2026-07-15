# 多设备架构 v2.2 M2 Business Session Foundation：实现文档

> **状态：** Reviewer 二审通过，待用户确认后实施
> **对应 Mini-PRD：** `doc/features/multi-device-v2.2-migration-prd.md` §10.1-§10.6
> **上游权威：** `doc/specs/architecture-plan-b-multi-device-v2.2-authoritative-baseline.md`
> **当前起点：** schema v0.1.13-multi-device-m1-identity
> **目标版本：** schema v0.1.14-multi-device-m2-session-foundation
> **目标 migration id：** `2026-07-15_mvp_schema_v0_1_14_multi_device_m2_session_foundation`
> **分支：** `feat/multi-device-m2-prd`

---

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
- 新增 `db:m2:verify`：脚本用项目现有 TypeScript 编译器生成临时验证入口，再以本地 Electron 运行 production `runDatabaseMigrations` 与 better-sqlite3，避免 Node ABI 不一致。所有数据库、action log 和编译产物位于临时目录。
- 真实迁移成功路径断言只生成一个备份目录，目录同时含 DB 与 `action_log.jsonl`；重启 no-op 不新增备份。失败路径断言 M2 DDL 与 ledger 均未提交，修复后可重试。
- 同一脚本再验证 D2-D6/D8 正负样例、五个索引、`foreign_key_check`、`integrity_check`，并断言 D1/D7 不存在。
- 验证脚本不修改用户运行库，不读取真实 Electron userData，不新增运行时依赖。

**测试用例：**

- M2-MIG-03、M2-MIG-05、M2-MIG-06 的真实启动与备份路径。
- 备份失败在 M2 第一条 DDL 前中止，seed 未执行。
- M1 完整、M2 中断的数据库在下一次启动可重试成功。
- Electron 使用其匹配 ABI 的 better-sqlite3，SQLite 引擎版本记录在输出中；系统 SQLite CLI 3.50.6 继续用于独立完整 schema 交叉验证。
- 验证脚本失败时退出码非 0，并保留足够的约束名称与 SQL 操作上下文。

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
| M2-MIG-01 | Step 12、Step 13 | migration test + native SQLite 验证 |
| M2-MIG-02 | Step 12、Step 13 | 历史 schema 数据快照测试 |
| M2-MIG-03 | Step 12、Step 13 | migration 顺序与真实备份测试 |
| M2-MIG-04 | Step 12 | 结构漂移与 ledger 测试 |
| M2-MIG-05 | Step 12、Step 13 | 幂等启动测试 |
| M2-MIG-06 | Step 12、Step 13 | 事务与备份故障注入测试 |
| M2-MIG-07 | Step 12 | 冲突数据集成测试 |
| M2-MIG-08 | Step 12、Step 13 | schema trigger test + native SQLite 验证 |
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
| M2-BIZ-11 | Step 12、Step 13 | schema 负向测试 + native SQLite 验证 |
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
- [ ] v0.1.12、v0.1.13、新库和重复启动四类数据库均有验证。

## 回归验收清单

- [ ] `npm run db:m2:verify` 通过。
- [ ] `npm run docs:index:check` 通过。
- [ ] `npm run typecheck` 通过。
- [ ] `npm run lint` 0 error；若仍有既有 warning，记录数量且不得新增。
- [ ] `npm test` 全量通过。
- [ ] `npm run build` 通过。
- [ ] `git diff --check` 通过。
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
