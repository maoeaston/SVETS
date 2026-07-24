# F6 评分计算框架与双轨隔离实现说明

对应 Mini-PRD：`doc/features/scoring-framework-dual-track-prd.md`
状态：READY_FOR_IMPLEMENTATION
日期：2026-07-24

## 1. 目标和边界

F6 的目标不是重做所有评分链路，而是在现有事件溯源和 `result_record` 基线之上，把四类结果稳定地生成、读取和隔离：

- `ABILITY_SCORE`：基础能力测评结果，来源为 `ASSESSMENT_SESSION`，只计 `BASE_ABILITY` 线上题和 `OFFLINE_ABILITY` 线下评分。
- `JOB_SKILL_SCORE`：岗位技能测评结果，来源为 `ASSESSMENT_SESSION`，只计 `JOB_SPECIFIC` 岗位技能题、`JOB_SKILL` 线下评分和教师观察。
- `TRAINING_COMPLETION`：训练完成结果，来源为 `TRAINING_SESSION`，不进入测评分数。
- `OPERATION_PASS_RATE`：拆箱与上架操作通过率，来源为 `ASSESSMENT_SESSION`，只计 `TASK_OPERATION` 九项操作。

本步骤不做以下事项：

- 不激活真实题库，不修改 DRAFT 题库 manifest。
- 不生成正式报告，不改报告模板。
- 不改运行库数据，不直接初始化或修复用户本地 `xc-career-guide.db`。
- 不引入 ORM、前端状态持久化、CSV/Markdown 渲染依赖。

## 2. 当前代码快照

### 2.1 已具备能力

- `src/main/db/schema.sql` 已有 `result_record` 四类 `result_type`、source 约束和 `ux_result_record_one_current_per_source_type` 当前结果唯一索引。
- `src/main/domain/level-judge.ts` 已提供安全红线、模块否决、情绪崩溃、阈值判级的纯函数。
- `src/main/ipc/handlers/assessment.ts` 已在红线场景生成 `ABILITY_SCORE`，并明确排除 `TASK_OPERATION`。
- `src/main/ipc/handlers/job-skill-result.ts` 已在岗位技能线下评分和观察完成后生成 `JOB_SKILL_SCORE`，并写 `SESSION_COMPLETED`。
- `src/main/ipc/handlers/operation-scoring.ts` 已写 9 条 `TASK_OPERATION` 和 1 条 `OPERATION_PASS_RATE`，且不完成测评会话。
- `src/main/ipc/handlers/training.ts` 与 `src/main/domain/training-reducer.ts` 已生成 `TRAINING_COMPLETION`。
- 现有测试已覆盖红线结果、岗位技能结果、操作通过率、训练完成结果和部分 schema 约束。

### 2.2 缺口

- 基础能力正常完成路径尚未实现：`assessment:calculateResult` 目前只接受 `REDLINE_HALTED`，正常 `OFFLINE_PENDING -> COMPLETED` 未生成 `ABILITY_SCORE`。
- 基础能力线下评分没有独立提交入口；现有 `OFFLINE_SCORE_SUBMITTED` reducer 可写 `OFFLINE_ABILITY`，但缺少面向教师的 handler 校验和自动结算。
- `[!]` PRD §17.6.2 要求漏写 `score_scope` 的写入失败，但 schema 当前为 `offline_score_record.score_scope TEXT NOT NULL DEFAULT 'OFFLINE_ABILITY'`。SQLite 会在列省略时补默认值，因此无法满足“漏写失败”验收。
- `ResultCalculatedPayload` 不携带 `strategy_id`、`strategy_type`、`module_type`，`applyResultCalculated` 也未向 `result_record` 写这些列。实现阶段必须选择：扩展事件 payload 并落库，或在实现文档/验收中明确这些列暂不作为 F6 输出合同。建议扩展 payload，因为结果读取和报告快照会受益。
- 四类结果读取目前分散在训练、操作和岗位技能报告路径中，缺少统一的只读 IPC 合同用于验收双轨隔离。

## 3. 实现策略

采用最小增量实现：

1. 先修正 schema 合同和迁移，确保 `score_scope` 必须显式写入。
2. 新增基础能力线下评分提交入口，复用 `OFFLINE_SCORE_SUBMITTED` 事件和 reducer。
3. 抽出基础能力结果计算纯函数，红线和正常完成都走同一套 payload 构造规则。
4. 扩展 `RESULT_CALCULATED` payload/投影，补齐 `strategy_id`、`strategy_type`、`module_type` 的落库规则。
5. 新增统一结果读取 IPC，只读 `result_record` 当前结果，不反向推导或补写。
6. 用隔离回归测试证明四条轨道互不污染。

不新建通用“评分大服务”。岗位技能、操作、训练已有稳定专用实现，F6 只在必要位置抽可复用的纯函数和结果读取层。

## 4. 子任务拆分

### F6-1 修正 `score_scope` 合同

影响文件：

- `src/main/db/schema.sql`
- `src/main/db/migrations.ts`
- `src/main/db/__tests__/schema-scoring-closure.test.ts`
- `src/main/db/__tests__/migrations.test.ts`

实现要求：

- 从 `offline_score_record.score_scope` 移除 `DEFAULT 'OFFLINE_ABILITY'`。
- 新增迁移，重建旧库的 `offline_score_record` 表以移除默认值，并保留既有行、索引和约束。
- 迁移前后执行 `PRAGMA foreign_key_check` 与 `PRAGMA integrity_check`。
- 新增测试：直接 SQL 插入 `offline_score_record` 但省略 `score_scope` 必须失败。
- 保留并增强现有测试：显式 `OFFLINE_ABILITY`、`JOB_SKILL`、`TASK_OPERATION`、`TEACHER_OBSERVATION` 仍按各自 CHECK 通过或失败。

验收点：

- `PRAGMA table_info('offline_score_record')` 中 `score_scope.dflt_value` 为 `NULL`。
- 任意 handler 写线下评分时 payload 和投影都显式携带 `score_scope`。

### F6-2 扩展结果事件和投影

影响文件：

- `src/shared/types/event-payloads.ts`
- `src/main/domain/assessment-reducer.ts`
- `src/main/domain/training-reducer.ts`
- `src/main/domain/__tests__/assessment-reducer.test.ts`
- `src/main/ipc/handlers/__tests__/training-complete.test.ts`

实现要求：

- 在 `ResultCalculatedPayload` 中增加可选字段：
  - `strategy_id?: string | null`
  - `strategy_type?: 'BASELINE_ASSESSMENT' | 'MOCK_EXAM' | 'TRAINING_PRACTICE' | 'JOB_SKILL_ASSESSMENT' | null`
  - `module_type?: AbilityTag | null`
- `applyResultCalculated` 插入 `result_record` 时写入上述字段。
- `training-reducer` 生成 `TRAINING_COMPLETION` 时也填 `strategy_id`、`strategy_type='TRAINING_PRACTICE'`、`module_type`。
- 已有 `RESULT_CALCULATED` 事件重放兼容：缺失字段时投影为 `NULL`，不得影响旧事件。

验收点：

- `ABILITY_SCORE`、`JOB_SKILL_SCORE` 的 `strategy_type` 分别能区分基础能力和岗位技能。
- `TRAINING_COMPLETION` 的 `source_aggregate_type='TRAINING_SESSION'` 且 `strategy_type='TRAINING_PRACTICE'`。
- 旧事件 payload 不带策略字段时仍可重放。

### F6-3 基础能力线下评分提交

影响文件：

- `src/main/ipc/handlers/assessment.ts`，或新建 `src/main/ipc/handlers/ability-scoring.ts`
- `src/main/ipc/index.ts`
- `src/shared/types/assessment.ts`，或新建 `src/shared/types/ability-scoring.ts`
- `src/shared/types/ipc-api.ts`
- `src/preload/index.ts`
- 新增 `src/main/ipc/handlers/__tests__/assessment-ability-scoring.test.ts`

建议 IPC：

- `assessment:submitOfflineAbilityScores`
- `assessment:getOfflineAbilityScores`

提交参数最小字段：

- `callerUserId`
- `callerRole`
- `sessionId`
- `scores: Array<{ questionId, score, scoringRubricJson, observationNote?, toolChecklistConfirmed? }>`

实现要求：

- 仅 `TEACHER`/`ADMIN` 可提交。
- session 必须存在，且 `strategy_type` 为 `BASELINE_ASSESSMENT` 或 `MOCK_EXAM`。
- session 状态必须为 `OFFLINE_PENDING`，`delivery_phase` 必须至少到 `ONLINE_COMPLETED`。
- 每个 `questionId` 必须属于该 session 的 `BASE_ABILITY`、`question_phase='OFFLINE'`、`item_usage='SCORED_ITEM'` 题。
- 每条事件 payload 必须显式 `score_scope='OFFLINE_ABILITY'`。
- 单次提交在事务内写 8 条或部分补交；重复提交同一题必须返回可解释错误或先作废旧 revision，不能制造两个 `VALID` 分数。
- 当 `OFFLINE_ABILITY` 完成数量等于 session `offline_question_count` 时，调用基础能力结算核心函数并写 `SESSION_COMPLETED`。

验收点：

- `OFFLINE_ABILITY` 分数不会推进岗位技能观察阶段。
- `TASK_OPERATION` 和 `JOB_SKILL` 记录不会被此接口读取或覆盖。
- 提交失败时不留下部分 `offline_score_record` 或结果记录。

### F6-4 基础能力结果计算核心

影响文件：

- 新增 `src/main/domain/ability-scoring.ts`
- 新增 `src/main/domain/__tests__/ability-scoring.test.ts`
- `src/main/ipc/handlers/assessment.ts`
- `src/main/ipc/handlers/__tests__/assessment-redline.test.ts`
- `src/main/ipc/handlers/__tests__/assessment-ability-scoring.test.ts`

实现要求：

- 抽出纯函数计算 `AbilityScorePayload`：
  - 线上分：只取 `assessment_session_question.question_phase='ONLINE'` 且 `bank_domain='BASE_ABILITY'` 的 `answer_record.status='VALID'`。
  - 每个基础能力模块最高 14 分，未答按 0 分，仍保留模块 max。
  - 线下分：只取 `offline_score_record.score_scope='OFFLINE_ABILITY'`。
  - 不计入 `JOB_SKILL`、`TASK_OPERATION`、`TEACHER_OBSERVATION`。
  - `raw_score = online_raw_score + offline_raw_score`，`max_score = 100`，`normalized_score` 限定 0-100。
  - `question_count = online_question_count + offline_question_count`。
  - `answered_count = VALID answer_record 数 + VALID OFFLINE_ABILITY 数`。
  - `completion_ratio = answered_count / question_count`。
- 情绪崩溃计数继续沿用 F4 现有事件溯源口径：查询 `EMOTION_INTERRUPTED` 与 `EMOTION_RESUMED` 后得到未恢复 collapse 数，传入 `judgeLevel`。
- 红线场景继续强制 `LEVEL_FAIL_BY_SAFETY`，但仍输出真实线上/线下分和 payload 快照。
- 正常完成场景按 `judgeLevel` 判级；写 `RESULT_CALCULATED` 后再写 `SESSION_COMPLETED`，保证 session 进入 `COMPLETED + FINALIZED`。
- `assessment:calculateResult` 改为幂等入口：
  - `REDLINE_HALTED`：保持现有红线路径。
  - `OFFLINE_PENDING` 且 `OFFLINE_ABILITY` 已全量评分：正常结算。
  - 已有当前 `ABILITY_SCORE`：直接返回现有结果。
  - 其余状态返回现有错误码或新增精确错误码，类型中同步。

验收点：

- 42 道线上题 + 8 道基础能力线下题全量完成后生成 1 条当前 `ABILITY_SCORE`。
- 重复调用不产生第二条当前结果，不重复写 `SESSION_COMPLETED`。
- 操作评分完成但基础能力线下题未完成时，不生成 `ABILITY_SCORE`。

### F6-5 统一结果读取 IPC

影响文件：

- 新增 `src/main/ipc/handlers/results.ts`
- `src/main/ipc/index.ts`
- 新增 `src/shared/types/results.ts`
- `src/shared/types/ipc-api.ts`
- `src/preload/index.ts`
- 新增 `src/main/ipc/handlers/__tests__/results.test.ts`

建议 IPC：

- `results:getCurrent`
- `results:listCurrentByStudent`

读取合同：

- 只读 `result_record WHERE is_current = 1`。
- 支持按 `studentId`、`resultType`、`sourceAggregateType`、`sourceAggregateId` 过滤。
- `STUDENT` 只能读自己的结果；`TEACHER`/`ADMIN` 可按学生和来源过滤。
- 返回 `resultPayload` 为解析后的 JSON；无 payload 返回 `null`。
- 不在读取时补算缺失结果，不修改 `is_current`。

验收点：

- 同一学生可以同时读取四类当前结果。
- `ABILITY_SCORE` 与 `JOB_SKILL_SCORE` 同源表但不同 `result_type`，互不覆盖。
- `TRAINING_COMPLETION` 只能来自 `TRAINING_SESSION`。

### F6-6 双轨隔离回归

影响文件：

- `src/main/ipc/handlers/__tests__/assessment-ability-scoring.test.ts`
- `src/main/ipc/handlers/__tests__/job-skill-result.test.ts`
- `src/main/ipc/handlers/__tests__/operation-scoring.test.ts`
- `src/main/ipc/handlers/__tests__/training-complete.test.ts`
- `src/main/db/__tests__/schema-scoring-closure.test.ts`

必须覆盖：

- 基础能力结算只使用 `BASE_ABILITY + OFFLINE_ABILITY`。
- 岗位技能结算只使用 `JOB_SPECIFIC + JOB_SKILL + TEACHER_OBSERVATION`。
- 操作通过率只使用九项 `TASK_OPERATION`，不改变测评完成状态。
- 训练完成只来自训练步骤，不读取测评题或线下评分。
- `ux_result_record_one_current_per_source_type` 拦截同一 source/type 的第二条当前结果。
- schema 直接插入混轨数据失败：
  - `TASK_OPERATION` 带 `question_id` 失败。
  - `OFFLINE_ABILITY` 缺 `question_id` 或 rubric 失败。
  - `JOB_SKILL` 写入 `BASE_ABILITY` 题失败应由 handler 拦截；schema 至少保证 scope 结构正确。
  - `TEACHER_OBSERVATION` 带 score 失败。

## 5. 推荐提交顺序

1. `F6-1`：schema + migration + schema tests。
2. `F6-2`：`RESULT_CALCULATED` payload 和投影字段补齐。
3. `F6-3/F6-4`：基础能力线下评分提交与正常结算。
4. `F6-5`：统一结果读取 IPC。
5. `F6-6`：跨轨隔离回归测试和文档同步。

每个提交都应能独立运行对应测试。不要把 schema 迁移、IPC、新计算逻辑和结果读取混在一个不可拆的大提交里。

## 6. 验证命令

最小针对性验证：

```bash
./node_modules/.bin/vitest run src/main/db/__tests__/schema-scoring-closure.test.ts
./node_modules/.bin/vitest run src/main/db/__tests__/migrations.test.ts
./node_modules/.bin/vitest run src/main/domain/__tests__/level-judge.test.ts
./node_modules/.bin/vitest run src/main/ipc/handlers/__tests__/assessment-redline.test.ts
./node_modules/.bin/vitest run src/main/ipc/handlers/__tests__/operation-scoring.test.ts
./node_modules/.bin/vitest run src/main/ipc/handlers/__tests__/job-skill-result.test.ts
./node_modules/.bin/vitest run src/main/ipc/handlers/__tests__/training-complete.test.ts
```

完成 F6 后跑完整门禁：

```bash
git diff --check
npm run typecheck
npm run lint
npm test
npm run build
npm run docs:index:update
npm run docs:index:check
```

若只新增或移动文档，至少运行：

```bash
npm run docs:index:update
npm run docs:index:check
```

## 7. 回滚策略

- 当前实现说明文档可直接删除并重新运行文档索引。
- 后续代码阶段若只改 handler/domain/types，可按提交粒度回滚。
- 后续 schema 阶段必须通过新迁移前进，不直接修改用户运行库；本地运维若遇到 `better-sqlite3` ABI 不一致，按项目约定优先用 `sqlite3` CLI 执行 schema。
