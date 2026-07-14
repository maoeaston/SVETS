# 训练功能 Mini-PRD

**功能代号：** training  
**关联 PRD：** `doc/specs/MVP_PRD_v1.0.9-authoritative.md` §5.5 / §17.1
**schema 基线：** v0.1.10-scoring-closure  
**状态：** v1.0（Reviewer 审查通过，6处已修订）

---

## 功能名称

训练（Training）

---

## 解决的问题

测评完成后，教师需要针对学生薄弱模块分配训练任务。学生按「看 → 学 → 练 → 做」四步依序完成训练，系统记录每步状态变更事件，并在全部必要步骤完成后生成 `TRAINING_COMPLETION` 结果。

---

## 用户角色

| 角色 | 操作 |
|------|------|
| TEACHER | 分配训练任务、查看训练列表与步骤进度 |
| STUDENT | 进入训练、依序完成四步、触发重试 |
| ADMIN | 可触发安全红线（与 TEACHER 相同）；**是唯一可解除安全阻断（RESOLVED/VOIDED）的角色**，解除后同学生同任务方可发起新 training_session；无其他直接训练操作 |

---

## 核心使用场景

### 教师侧

1. 教师进入学生详情 → 选择「新建训练」
2. 选择模块（`module_type`，6 个基础能力模块之一）
3. 选择策略版本（`TRAINING_PRACTICE`，`job_code = SUPERMARKET_SHELVER`）
4. 提交 → 主进程在同一事务内创建 `training_session`（`status = INIT`）并**一次性插入 4 条 `training_step_record`**（WATCH/LEARN/PRACTICE/DO，`status = NOT_STARTED`），同时将 `training_session.total_step_count` 设为 4；后续步骤状态变更只 UPDATE 已有行，不新增
5. 教师训练列表页可查看各会话状态和步骤进度

### 学生侧

1. 学生登录后进入训练主页 → 看到分配给自己的待完成训练
2. 进入训练步骤页，步骤顺序展示：WATCH → LEARN → PRACTICE → DO
3. 点击「开始」触发步骤 → `IN_PROGRESS`；完成后 → `COMPLETED`
4. 跳过步骤 → `SKIPPED`（不计入完成数）
5. 步骤失败 → `FAILED`；可点击重试（`attempt_count` 递增），直到成功或放弃
6. 所有步骤处理完毕（无 `NOT_STARTED` 剩余）→ 系统计算完成率，生成 `TRAINING_COMPLETION` result_record，`training_session` 进入 `COMPLETED`

---

## 功能范围

### 本次做

- 创建 `training_session`（含策略锁定：`strategy_id + strategy_version`）
- 初始化 4 条 `training_step_record`（step_code / step_name / step_type / step_order）
- 四步生命周期：`NOT_STARTED → IN_PROGRESS → COMPLETED / SKIPPED / FAILED`
- 重试：`FAILED` 后可重试，写 `TRAINING_STEP_RETRIED` 事件，`attempt_count + 1`，状态回 `IN_PROGRESS`
- 跳过：`SKIPPED` 不计入 `completed_step_count`
- 完成率计算：`completed_step_count / total_step_count × 100`（0–100 百分制，只有 `COMPLETED` 计入分子；`SKIPPED`/`FAILED` 不计入）；写入 `training_session.completion_rate` 和 `result_record.normalized_score`
- `TRAINING_COMPLETED` 事件 → `TRAINING_COMPLETION` result_record（`normalized_score = completion_rate`）
- 教师查看训练会话列表（分学生 + 状态筛选）
- 安全红线触发时：schema trigger 自动将 training_session 置 `REDLINE_HALTED`，但**不级联更新 training_step_record**；**应用层**在写 `REDLINE_TRIGGERED` 事件后，必须将该 session 所有 `IN_PROGRESS` 步骤 UPDATE 为 `FAILED`
- 补充 `TRAINING_PRACTICE` `strategy_config` seed（当前 schema 仅有 BASELINE_ASSESSMENT + MOCK_EXAM）

### 本次不做

- 视频/音频素材实际播放（展示占位文字 + 模拟进度条）
- 情绪中断 IPC（`training:emotionInterrupt` / `training:emotionResume`）**本次不实现**；`EMOTION_INTERRUPTED` 状态**不会出现在训练投影中**（本次实现路径仅含 INIT / ACTIVE / SUSPENDED_REVIEW_REQUIRED / COMPLETED / REDLINE_HALTED / ABORTED）；schema trigger 中 `EMOTION_INTERRUPTED` 纳入红线熔断路径的约束保留，供后续实现使用
- 训练报告独立页（由后续「报告」功能承接）
- 教师主动终止训练（ABORTED）的 UI 入口

---

## 数据模型变更

**无新增表，无字段变更。** 使用现有：
- `training_session`（字段齐全，v0.1.7 对齐）
- `training_step_record`（step_type WATCH/LEARN/PRACTICE/DO，状态枚举 v0.1.7 对齐）

**需要新增的 seed：**
```sql
INSERT OR IGNORE INTO strategy_config (...) VALUES (
  'strategy_training_shelver_v1',
  'TRAINING_PRACTICE',
  'SUPERMARKET_SHELVER',
  '理货员拆箱与上架训练 v1',
  0, 0, 100, 80, 60, 0.5, 3, ...
);
```

---

## 新增领域事件

| EventType | Aggregate | 说明 |
|-----------|-----------|------|
| `TRAINING_SESSION_CREATED` | TRAINING_SESSION | 训练会话创建（含步骤列表 payload） |
| `TRAINING_STEP_STARTED` | TRAINING_SESSION | 步骤从 NOT_STARTED 进入 IN_PROGRESS |
| `TRAINING_STEP_COMPLETED` | TRAINING_SESSION | 步骤完成 |
| `TRAINING_STEP_SKIPPED` | TRAINING_SESSION | 步骤被跳过 |
| `TRAINING_STEP_FAILED` | TRAINING_SESSION | 步骤失败 |
| `TRAINING_STEP_RETRIED` | TRAINING_SESSION | 重试：attempt_count + 1，状态回 IN_PROGRESS |
| `TRAINING_COMPLETED` | TRAINING_SESSION | 所有步骤处理完毕，生成 result_record |
| `TRAINING_ABORTED` | TRAINING_SESSION | 训练中止（本次不暴露 UI 入口，仅预留事件类型） |

---

## 新增 IPC 通道

| 通道 | 方向 | 说明 |
|------|------|------|
| `training:createSession` | 主进程 | 教师创建训练会话 |
| `training:listSessions` | 主进程 | 查询训练列表（支持按学生/状态筛选） |
| `training:getSession` | 主进程 | 查询单个训练会话及步骤详情 |
| `training:startStep` | 主进程 | 学生开始某步骤 |
| `training:completeStep` | 主进程 | 学生完成某步骤 |
| `training:skipStep` | 主进程 | 学生跳过某步骤 |
| `training:failStep` | 主进程 | 步骤失败（超时/错误） |
| `training:retryStep` | 主进程 | 学生重试失败步骤 |

---

## 新增视图与路由

| 路由 | 视图 | 角色 |
|------|------|------|
| `/teacher/trainings` | `TrainingListView.vue` | TEACHER |
| `/teacher/trainings/create` | `TrainingCreateView.vue` | TEACHER |
| `/student/training/:sessionId` | `TrainingView.vue` | STUDENT |

---

## FSM 状态迁移

```
training_session（本次实现路径，不含 EMOTION_INTERRUPTED）:
  INIT
    ↓ TRAINING_STEP_STARTED（第一步开始时，session 进入 ACTIVE）
  ACTIVE
    ↓ 所有步骤处理完毕（无 NOT_STARTED 剩余）
  COMPLETED（终态）

  INIT / ACTIVE / SUSPENDED_REVIEW_REQUIRED
    → 安全红线（schema trigger 批量熔断）
  REDLINE_HALTED（终态）

  ABORTED（终态，本次不暴露 UI 入口）

  注：EMOTION_INTERRUPTED 在 schema 中存在但本次不实现；
      实现路径不会写入该状态。

training_step_record:
  NOT_STARTED → IN_PROGRESS → COMPLETED（终态，不可回退）
                             → SKIPPED（终态，不可回退）
                             → FAILED → IN_PROGRESS（重试，合法路径）
  安全红线触发后：IN_PROGRESS → FAILED（应用层负责级联，非 trigger）
```

---

## 边界条件和异常处理

| 情况 | 处理 |
|------|------|
| 同一学生同一任务已有开放 training_session | schema UNIQUE INDEX 阻断，handler 提前校验并返回 DUPLICATE_TRAINING_SESSION 错误 |
| 未解决安全事件阻断创建 | schema trigger 阻断，handler 捕获后返回 UNRESOLVED_SAFETY_INCIDENT 错误 |
| 步骤乱序推进（跳过前置步骤直接完成后序步骤） | handler 校验 step_order，前序步骤必须为非 NOT_STARTED 才允许当前步骤推进 |
| COMPLETED/REDLINE_HALTED/ABORTED 终态再操作 | schema trigger 阻断，handler 提前校验 |
| 重试次数无限制 | MVP 不设上限；attempt_count 仅做记录 |
| training_session.strategy_id 为 NULL | schema trigger 强制非空，handler 创建时必须传入有效 strategy_id |
| step 状态从 COMPLETED/SKIPPED 回退 | handler 层拒绝；COMPLETED 和 SKIPPED 步骤不可再推进到任何前置状态 |
| step FAILED → IN_PROGRESS（重试） | **合法路径**；写 `TRAINING_STEP_RETRIED` 事件，`attempt_count + 1`；MVP 不设重试次数上限 |
| 安全红线熔断后 IN_PROGRESS 步骤未归档 | handler 在写 REDLINE_TRIGGERED 事件后，必须将所有 IN_PROGRESS 步骤 UPDATE 为 FAILED；schema trigger 不级联处理 |

---

## 与现有功能的接口关系

- **strategy_config**：读取 TRAINING_PRACTICE 策略；需补 seed
- **student_profile**：通过 student_id 关联
- **domain_event_projection**：所有状态变更写入事件（writeEvent 工具函数复用 assessment.ts 模式）
- **result_record**：训练完成时写入 TRAINING_COMPLETION 类型记录（`normalized_score = completion_rate`，`source_aggregate_type = TRAINING_SESSION`）
- **safety_incident**：触发时 schema trigger 自动批量熔断 training_session；**应用层还需额外将 IN_PROGRESS 步骤更新为 FAILED**（trigger 不级联）

---

## 成功验收标准

对应 §17.1 训练部分：

1. 教师可以分配训练任务（createSession 成功，training_session.status = INIT）
2. 学生可以完成看、学、练、做四步（每步完成状态变 COMPLETED）
3. 系统每步变更后写入事件（domain_event_projection 有对应记录）
4. 跳过步骤不计为完成（SKIPPED 步骤不计入 completed_step_count）
5. 失败后重试被记录（attempt_count 递增，TRAINING_STEP_RETRIED 事件存在）
6. 训练完成后生成 TRAINING_COMPLETION result_record（normalized_score = completion_rate）
7. 同一学生同一任务重复创建开放 training_session 应失败（§17.5 第2条）
8. training_session.strategy_id IS NULL 创建应失败（§17.7 第4条）

---

## 风险点

- **[!] FSM 路径**：`INIT→ACTIVE` 触发时机是「第一步 TRAINING_STEP_STARTED」而非创建时，需与 schema trigger 路径严格对齐；实现路径不得写入 `EMOTION_INTERRUPTED`（本次不实现），否则会产生游离状态与 schema trigger 覆盖范围不符
- **[!] TRAINING_PRACTICE seed 缺失**：创建训练前必须确认 strategy_config 有 TRAINING_PRACTICE 行，否则 schema trigger 阻断 INSERT
- **事件类型枚举扩展**：需在 `event-payloads.ts` 补全上述8个 EventType，避免运行时 checksum 写入类型错误
- **步骤顺序校验**：handler 层需防止乱序推进，仅依赖 schema UNIQUE INDEX 不够（UNIQUE 只防重复，不防乱序）
