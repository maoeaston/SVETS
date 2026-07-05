# 训练功能实现文档

**功能代号：** training  
**关联 PRD：** `doc/features/training-prd.md`（v1.0，状态：Reviewer 审查通过）  
**schema 基线：** v0.1.10-scoring-closure  
**生成日期：** 2026-07-05

---

## 实现目标（一句话）

在 SVETS MVP 中实现完整的训练（Training）闭环：教师分配训练任务 → 学生依序完成四步 → 系统生成 `TRAINING_COMPLETION` 结果记录。

---

## 前置条件

### 已有模块（必须已存在）
- `src/main/domain/event-writer.ts` — `writeEvent` 工具函数（本次直接复用）
- `src/main/db/connection.ts` — `getDatabase()` singleton
- `src/main/db/sqlite-adapter.ts` / `memory-adapter.ts` / `interface.ts` — DBAdapter 模式
- `src/main/utils/auth-context.ts` — `assertCaller` / `assertStudent`
- `src/shared/types/event-payloads.ts` — `ActionLogEntry`, `AggregateType`, `EventType`, `ActorRole`, `WriteEventParams`
- `src/preload/index.ts` — 现有 auth / student / strategy / assessment 白名单
- `src/main/ipc/index.ts` — 现有 4 个 handler 注册
- `src/renderer/src/router/index.ts` — 现有路由

### schema 中已存在的表/字段
- `training_session`（字段完整，v0.1.7 对齐）
- `training_step_record`（step_type WATCH/LEARN/PRACTICE/DO，status NOT_STARTED/IN_PROGRESS/COMPLETED/SKIPPED/FAILED）
- `result_record`（含 TRAINING_COMPLETION result_type）
- `domain_event_projection`（事件投影）
- schema trigger `trg_training_session_no_terminal_status_change` — 阻止终态迁移
- schema trigger `trg_training_session_block_unresolved_safety_incident` — 未解决安全事件阻断
- schema trigger `ux_training_one_open_session_per_student_task` — 同学生同任务仅一个开放会话

### 已存在的事件类型（`event-payloads.ts` 中）
- `TRAINING_STARTED`（对应 PRD 的 `TRAINING_SESSION_CREATED`，**本实现统一使用 `TRAINING_STARTED`**）
- `TRAINING_STEP_STARTED / COMPLETED / SKIPPED / FAILED`
- `TRAINING_COMPLETED`

> [!] 命名对齐说明：PRD event 表中 `TRAINING_SESSION_CREATED` 与代码现有 `TRAINING_STARTED` 是同一事件，本实现以代码现有值为准，不新增 `TRAINING_SESSION_CREATED`，避免产生游离枚举值。

### 必须补充的内容（本次实现负责）
- `strategy_config` 中 `TRAINING_PRACTICE` seed 行（当前缺失，schema trigger 会阻断 INSERT）
- `TRAINING_STEP_RETRIED`、`TRAINING_ABORTED` 事件类型 + payload 接口（`event-payloads.ts`）
- `src/shared/types/training.ts`（新建）
- `src/shared/types/ipc-api.ts` training namespace
- `src/main/ipc/handlers/training.ts`（新建）
- `src/main/domain/training-reducer.ts`（新建）
- 3 个 Vue 视图 + 路由条目

---

## 实现步骤

### Step 1：前置数据补全 — strategy_config seed + event 枚举

**改动文件：**
- `src/main/db/schema.sql`：在末尾 seed 段新增 `TRAINING_PRACTICE` 策略行
- `src/shared/types/event-payloads.ts`：EventType 中补 `TRAINING_STEP_RETRIED`、`TRAINING_ABORTED`；新增对应 payload 接口

**核心逻辑：**

`schema.sql` seed 追加（放在最后一个 `INSERT OR IGNORE INTO strategy_config` 之后）：

```sql
INSERT OR IGNORE INTO strategy_config (
  strategy_id, strategy_type, job_code, strategy_name,
  online_question_count, offline_question_count,
  max_score, competent_threshold, conditional_threshold,
  module_veto_threshold, emotion_collapse_threshold,
  question_policy_json, scoring_policy_json,
  supports_redline_halt, allows_emotion_interrupt,
  requires_offline_scoring, version, is_active
) VALUES (
  'strategy_training_shelver_v1',
  'TRAINING_PRACTICE',
  'SUPERMARKET_SHELVER',
  '理货员拆箱与上架训练 v1',
  0, 0, 100, 80, 60, 0.5, 3,
  '{"module_scope":"SINGLE_MODULE","step_types":["WATCH","LEARN","PRACTICE","DO"]}',
  '{"score_values":[0,100],"normalization":"completed_steps/total_steps*100","safety_override_enabled":true,"level_rules":[{"min":100,"max":100,"level":"LEVEL_COMPETENT"},{"min":1,"max":99,"level":"LEVEL_CONDITIONAL"},{"min":0,"max":0,"level":"LEVEL_NOT_COMPETENT"}]}',
  1, 0, 0, 1, 1
);
```

新增 payload 接口（`event-payloads.ts` 末尾）：

```typescript
export interface TrainingStepRetriedPayload {
  training_session_id: string
  step_record_id: string
  step_type: 'WATCH' | 'LEARN' | 'PRACTICE' | 'DO'
  step_order: number
  attempt_count: number   // 重试后的新 attempt_count
  retried_at: string
}

export interface TrainingAbortedPayload {
  training_session_id: string
  aborted_at: string
  aborted_by: string
  reason?: string | null
}
```

**测试用例：**
- 单元测试（手工验证）：执行 `src/main/db/schema.sql`，查询 `SELECT strategy_id FROM strategy_config WHERE strategy_type = 'TRAINING_PRACTICE'` 应返回 1 行
- 类型测试：`TRAINING_STEP_RETRIED`、`TRAINING_ABORTED` 加入 EventType 后 `tsc --noEmit` 通过

**commit message 建议：**
`feat(schema): 补 TRAINING_PRACTICE seed + 补全训练相关 event 枚举`

---

### Step 2：共享类型层 — training.ts + ipc-api.ts 扩展

**改动文件：**
- `src/shared/types/training.ts`（新建）
- `src/shared/types/ipc-api.ts`：import training 类型，添加 `training` namespace

**核心逻辑：**

`training.ts` 关键类型：

```typescript
// training_session.status（本次实现路径，不含 EMOTION_INTERRUPTED）
export type TrainingSessionStatus =
  | 'INIT' | 'ACTIVE' | 'SUSPENDED_REVIEW_REQUIRED'
  | 'COMPLETED' | 'REDLINE_HALTED' | 'ABORTED'

export type TrainingStepStatus =
  | 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED' | 'FAILED'

export type TrainingStepType = 'WATCH' | 'LEARN' | 'PRACTICE' | 'DO'

export type TrainingModuleType =
  | 'FINE_MOTOR' | 'COGNITION' | 'RULE_EXECUTION'
  | 'EMOTION_REGULATION' | 'BASIC_SOCIAL' | 'SAFETY_OPERATION'

// 统一错误码
export type TrainingErrorCode =
  | 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION_ERROR'
  | 'SESSION_ALREADY_OPEN' | 'SESSION_NOT_ACTIVE' | 'SESSION_HALTED'
  | 'STEP_NOT_FOUND' | 'STEP_INVALID_TRANSITION' | 'STEP_PREREQUISITE_NOT_MET'
  | 'BLOCKED_BY_SAFETY_INCIDENT' | 'DUPLICATE_TRAINING_SESSION'
  | 'UNRESOLVED_SAFETY_INCIDENT' | 'TRAINING_SYSTEM_ERROR'

// --- createSession ---
export interface CreateTrainingSessionParams {
  callerUserId: string
  callerRole: string
  studentId: string
  strategyId: string
  strategyVersion: number
  moduleType: TrainingModuleType
  taskCode: string
}
export interface CreateTrainingSessionSuccess {
  success: true
  trainingSessionId: string
  status: TrainingSessionStatus
}
export type CreateTrainingSessionResult =
  | CreateTrainingSessionSuccess
  | { success: false; errorCode: TrainingErrorCode }

// --- listSessions ---
export interface ListTrainingSessionsParams {
  callerUserId: string
  callerRole: string
  studentId?: string
  status?: TrainingSessionStatus
  limit?: number
  offset?: number
}
export interface TrainingSessionListItem {
  trainingSessionId: string
  studentId: string
  moduleType: string | null
  status: TrainingSessionStatus
  totalStepCount: number
  completedStepCount: number
  completionRate: number | null
  createdBy: string
  startedAt: string | null
  completedAt: string | null
}
export interface ListTrainingSessionsSuccess {
  success: true
  sessions: TrainingSessionListItem[]
  total: number
}
export type ListTrainingSessionsResult =
  | ListTrainingSessionsSuccess
  | { success: false; errorCode: TrainingErrorCode }

// --- getSession ---
export interface GetTrainingSessionParams {
  callerUserId: string
  callerRole: string
  trainingSessionId: string
}
export interface TrainingStepView {
  stepRecordId: string
  stepCode: string
  stepName: string
  stepOrder: number
  stepType: TrainingStepType
  status: TrainingStepStatus
  attemptCount: number
  startedAt: string | null
  completedAt: string | null
}
export interface TrainingSessionDetail {
  trainingSessionId: string
  studentId: string
  strategyId: string
  strategyVersion: number
  moduleType: string | null
  status: TrainingSessionStatus
  totalStepCount: number
  completedStepCount: number
  completionRate: number | null
  steps: TrainingStepView[]
  createdBy: string
  startedAt: string | null
  completedAt: string | null
}
export interface GetTrainingSessionSuccess {
  success: true
  session: TrainingSessionDetail
}
export type GetTrainingSessionResult =
  | GetTrainingSessionSuccess
  | { success: false; errorCode: TrainingErrorCode }

// --- step action params（start/complete/skip/fail/retry 共用模式）---
export interface TrainingStepActionParams {
  callerUserId: string
  callerRole: string
  trainingSessionId: string
  stepRecordId: string
}
export interface TrainingStepActionSuccess {
  success: true
  stepRecordId: string
  newStatus: TrainingStepStatus
  sessionCompleted?: boolean   // true 时表示本步是最后一步，session 已进入 COMPLETED
}
export type TrainingStepActionResult =
  | TrainingStepActionSuccess
  | { success: false; errorCode: TrainingErrorCode }
```

`ipc-api.ts` 添加 training namespace（import + interface IpcApi）：
```typescript
training: {
  createSession: (params: CreateTrainingSessionParams) => Promise<CreateTrainingSessionResult>
  listSessions: (params: ListTrainingSessionsParams) => Promise<ListTrainingSessionsResult>
  getSession: (params: GetTrainingSessionParams) => Promise<GetTrainingSessionResult>
  startStep: (params: TrainingStepActionParams) => Promise<TrainingStepActionResult>
  completeStep: (params: TrainingStepActionParams) => Promise<TrainingStepActionResult>
  skipStep: (params: TrainingStepActionParams) => Promise<TrainingStepActionResult>
  failStep: (params: TrainingStepActionParams) => Promise<TrainingStepActionResult>
  retryStep: (params: TrainingStepActionParams) => Promise<TrainingStepActionResult>
}
```

**测试用例：**
- `tsc --noEmit`：training.ts 类型通过，ipc-api.ts 引用正确
- 无运行时测试（纯类型文件）

**commit message 建议：**
`feat(types): 新增 training 共享类型 + IPC API 声明`

---

### Step 3：骨架接线 — preload + ipc/index + handler/reducer 骨架

**改动文件：**
- `src/preload/index.ts`：添加 training namespace（8 个通道）
- `src/main/ipc/index.ts`：import + 调用 `registerTrainingHandlers()`
- `src/main/ipc/handlers/training.ts`（新建）：骨架 + `seedTrainingErrorCodes` + `registerTrainingHandlers`（暂返回 NOT_IMPLEMENTED）
- `src/main/domain/training-reducer.ts`（新建）：骨架 `applyTrainingEvent` 导出

**核心逻辑：**

`preload/index.ts` 追加：
```typescript
training: {
  createSession: (params: unknown) => ipcRenderer.invoke('training:createSession', params),
  listSessions:  (params: unknown) => ipcRenderer.invoke('training:listSessions', params),
  getSession:    (params: unknown) => ipcRenderer.invoke('training:getSession', params),
  startStep:     (params: unknown) => ipcRenderer.invoke('training:startStep', params),
  completeStep:  (params: unknown) => ipcRenderer.invoke('training:completeStep', params),
  skipStep:      (params: unknown) => ipcRenderer.invoke('training:skipStep', params),
  failStep:      (params: unknown) => ipcRenderer.invoke('training:failStep', params),
  retryStep:     (params: unknown) => ipcRenderer.invoke('training:retryStep', params),
}
```

`training-reducer.ts` 骨架：
```typescript
import type { DBAdapter } from '../db/interface'
import type { ActionLogEntry } from '@shared/types/event-payloads'

export function applyTrainingEvent(db: DBAdapter, entry: ActionLogEntry): void {
  switch (entry.event_type) {
    case 'TRAINING_STARTED':          return applyTrainingStarted(db, entry)
    case 'TRAINING_STEP_STARTED':     return applyStepStarted(db, entry)
    case 'TRAINING_STEP_COMPLETED':   return applyStepCompleted(db, entry)
    case 'TRAINING_STEP_SKIPPED':     return applyStepSkipped(db, entry)
    case 'TRAINING_STEP_FAILED':      return applyStepFailed(db, entry)
    case 'TRAINING_STEP_RETRIED':     return applyStepRetried(db, entry)
    case 'TRAINING_COMPLETED':        return applyTrainingCompleted(db, entry)
    default: break
  }
}
// 具体实现在 Step 4/5/6 补充
```

**测试用例：**
- typecheck：`tsc --noEmit` 通过（骨架需要有正确的 import 路径）
- `npm run build`：主进程和 preload 构建无报错

**commit message 建议：**
`feat(training): preload + IPC index 接线 + handler/reducer 骨架`

---

### Step 4：createSession handler + reducer applyTrainingStarted

**改动文件：**
- `src/main/ipc/handlers/training.ts`：实现 `createTrainingSession` 纯函数
- `src/main/domain/training-reducer.ts`：实现 `applyTrainingStarted`（INSERT training_session + 4 step records）

**核心逻辑：**

`createTrainingSession` 流程（参照 `assessment.ts createSession` 模式）：

```
1. assertCaller(TEACHER)
2. 校验 studentId / strategyId / strategyVersion / moduleType / taskCode 非空
3. 读 strategy_config（WHERE strategy_id=? AND version=?）
   校验 strategy_type = 'TRAINING_PRACTICE'（非 TRAINING_PRACTICE → VALIDATION_ERROR）
4. 校验 student ACTIVE（student_profile + user_account 双 ACTIVE）
5. 校验无开放 training_session（INIT/ACTIVE/EMOTION_INTERRUPTED/SUSPENDED_REVIEW_REQUIRED）
   → DUPLICATE_TRAINING_SESSION
6. 校验无未解决安全事件
   → UNRESOLVED_SAFETY_INCIDENT / BLOCKED_BY_SAFETY_INCIDENT
7. 生成 trainingSessionId（uuid v4）
8. db.transaction(() => {
     writeEvent(TRAINING_STARTED, payload: TrainingStartedPayload)
     applyTrainingEvent(db, entry)  // INSERT training_session + 4 step records
   })
9. return { success: true, trainingSessionId, status: 'INIT' }
```

`applyTrainingStarted` 在 reducer 中：
- 从 payload 读 `training_session_id`, `student_id`, `strategy_id`, `strategy_version`, `job_code`, `task_code`, `total_steps`, `step_order`
- INSERT training_session（status='INIT', total_step_count=4）
- 4 步骤顺序定义（固定，读 strategy_config 不影响 step 顺序——MVP 固定 WATCH/LEARN/PRACTICE/DO）：
  ```
  [
    { step_order:1, step_type:'WATCH',    step_code:'WATCH_VIDEO',   step_name:'观看示范视频' },
    { step_order:2, step_type:'LEARN',    step_code:'LEARN_MATERIAL', step_name:'学习操作要领' },
    { step_order:3, step_type:'PRACTICE', step_code:'PRACTICE_TASK',  step_name:'练习任务操作' },
    { step_order:4, step_type:'DO',       step_code:'DO_REAL_TASK',   step_name:'独立完成任务' },
  ]
  ```
- 一次性 INSERT 4 条 training_step_record（status='NOT_STARTED', attempt_count=0）
- UPDATE training_session SET created_event_id = entry.event_id, last_applied_event_id = entry.event_id

> [!] FSM 注意：createSession 时 training_session.status = 'INIT'（不是 'ACTIVE'）；
> `INIT → ACTIVE` 由第一个 `TRAINING_STEP_STARTED` 事件触发（见 Step 5 applyStepStarted）。

**测试用例：**
- 单元测试（`src/main/ipc/handlers/__tests__/training-create.test.ts`）：
  - 正常路径：TEACHER 创建 → 返回 trainingSessionId，DB 有 training_session status=INIT + 4 step records status=NOT_STARTED
  - VALIDATION_ERROR：strategy_type 非 TRAINING_PRACTICE
  - NOT_FOUND：strategyId 不存在
  - DUPLICATE_TRAINING_SESSION：同学生同任务已有开放 session
  - BLOCKED_BY_SAFETY_INCIDENT：有未解决安全事件
  - FORBIDDEN：非 TEACHER 调用
- 集成测试：domain_event_projection 有 TRAINING_STARTED 记录，checksum 正确

**commit message 建议：**
`feat(training): createSession handler + applyTrainingStarted reducer`

---

### Step 5：步骤生命周期 handler + reducer（start/complete/skip/fail/retry）

**改动文件：**
- `src/main/ipc/handlers/training.ts`：实现 startStep / completeStep / skipStep / failStep / retryStep 5 个纯函数
- `src/main/domain/training-reducer.ts`：实现 applyStepStarted / applyStepCompleted / applyStepSkipped / applyStepFailed / applyStepRetried

**核心逻辑：**

所有步骤操作共用前置校验（提取为私有函数 `loadStepContext`）：
```
1. assertCaller（STUDENT）
2. 读 training_session（WHERE training_session_id=? 且 created_by = callerUserId 或 student_id = callerUserId）
   校验 session 存在 + status 非终态（COMPLETED/REDLINE_HALTED/ABORTED → SESSION_NOT_ACTIVE）
3. 读 training_step_record（WHERE step_record_id=? AND training_session_id=?）
   校验步骤存在（STEP_NOT_FOUND）
```

步骤顺序前置校验（适用于 startStep 和 completeStep）：
```
前序步骤（step_order < 当前 step_order）必须 status != 'NOT_STARTED'
否则 → STEP_PREREQUISITE_NOT_MET
```

各操作合法前置状态：

| 操作 | 当前步骤合法状态 | 目标状态 | 事件类型 |
|------|----------------|---------|---------|
| startStep | NOT_STARTED | IN_PROGRESS | TRAINING_STEP_STARTED |
| completeStep | IN_PROGRESS | COMPLETED | TRAINING_STEP_COMPLETED |
| skipStep | NOT_STARTED / IN_PROGRESS | SKIPPED | TRAINING_STEP_SKIPPED |
| failStep | IN_PROGRESS | FAILED | TRAINING_STEP_FAILED |
| retryStep | FAILED | IN_PROGRESS | TRAINING_STEP_RETRIED |

非法迁移（如 COMPLETED → IN_PROGRESS）返回 STEP_INVALID_TRANSITION。

`applyStepStarted` 额外逻辑（[!] FSM 关键）：
```
UPDATE training_step_record SET status='IN_PROGRESS', started_at=?, attempt_count=attempt_count+1
-- 如果 session.status = 'INIT'（第一个步骤开始），同步升级 training_session.status = 'ACTIVE'
IF session.status == 'INIT':
  UPDATE training_session SET status='ACTIVE', started_at=?
```

`applyStepRetried` 逻辑：
```
UPDATE training_step_record SET status='IN_PROGRESS', attempt_count=attempt_count+1
-- 不改 session status（session 已是 ACTIVE）
```

每个 reducer 函数都需要 UPDATE `training_step_record.last_applied_event_id`。

每次步骤操作后检查是否触发 TRAINING_COMPLETED（放在 handler 层，非 reducer）：

```typescript
// 在 handler 中，步骤 UPDATE 完成后检查
function checkSessionCompletion(db: DBAdapter, trainingSessionId: string): boolean {
  const remaining = db.prepare(
    `SELECT COUNT(*) as cnt FROM training_step_record
     WHERE training_session_id = ? AND status = 'NOT_STARTED'`
  ).get(trainingSessionId) as { cnt: number }
  return remaining.cnt === 0
}
// 若为 true，调用 finalizeTrainingSession（见 Step 6）
```

**测试用例：**
- 单元测试（`src/main/ipc/handlers/__tests__/training-steps.test.ts`）：
  - startStep 正常路径：NOT_STARTED → IN_PROGRESS；第一步触发 session INIT→ACTIVE
  - 前序步骤未完成时 startStep → STEP_PREREQUISITE_NOT_MET
  - completeStep 正常路径：IN_PROGRESS → COMPLETED
  - skipStep 正常路径：NOT_STARTED / IN_PROGRESS → SKIPPED（不计入 completedStepCount）
  - failStep 正常路径：IN_PROGRESS → FAILED
  - retryStep 正常路径：FAILED → IN_PROGRESS；attempt_count + 1；TRAINING_STEP_RETRIED 事件存在
  - 终态步骤（COMPLETED/SKIPPED）再次操作 → STEP_INVALID_TRANSITION
  - domain_event_projection 有对应记录，checksum 正确
- 集成测试：retryStep 三次，attempt_count 递增正确

**commit message 建议：**
`feat(training): 步骤生命周期 handler + reducer（start/complete/skip/fail/retry）`

---

### Step 6：TRAINING_COMPLETED 闭环 + listSessions + getSession

**改动文件：**
- `src/main/ipc/handlers/training.ts`：实现 `finalizeTrainingSession`（内部函数）、`listTrainingSessions`、`getTrainingSession`
- `src/main/domain/training-reducer.ts`：实现 `applyTrainingCompleted`

**核心逻辑：**

`finalizeTrainingSession`（在每次步骤操作 handler 尾部调用，当 checkSessionCompletion = true 时）：

```
1. 查 training_step_record 统计：
   completed_steps = COUNT WHERE status='COMPLETED'
   skipped_steps   = COUNT WHERE status='SKIPPED'
   failed_steps    = COUNT WHERE status='FAILED'
   total_steps     = total_step_count（从 training_session 读）
2. completion_rate = completed_steps / total_steps * 100（0–100，仅 COMPLETED 计入分子）
3. 生成 result_id（uuid v4）
4. db.transaction(() => {
     writeEvent(TRAINING_COMPLETED, TrainingCompletedPayload{
       training_session_id, completed_at, total_steps,
       completed_steps, skipped_steps, failed_steps, completion_rate
     })
     applyTrainingEvent(db, entry)  // applyTrainingCompleted
   })
5. 返回 { sessionCompleted: true }
```

`applyTrainingCompleted` reducer：
```
UPDATE training_session SET
  status = 'COMPLETED',
  completed_step_count = completed_steps,
  completion_rate = completion_rate,
  completed_at = now,
  last_applied_event_id = entry.event_id

INSERT INTO result_record (
  result_id, result_type='TRAINING_COMPLETION',
  source_aggregate_type='TRAINING_SESSION',
  source_aggregate_id=training_session_id,
  student_id, job_code, task_code,
  normalized_score=completion_rate,
  level_result=（按 scoring_policy_json.level_rules 计算：100→COMPETENT, 1-99→CONDITIONAL, 0→NOT_COMPETENT）,
  calculated_at, calculated_by=training_session.created_by,
  safety_overridden=0
)
```

> [!] level_result 计算：从 strategy_config.scoring_policy_json 读取 level_rules，基于 normalized_score 匹配。不硬编码阈值——读 strategy_config（strategy_id + strategy_version 在 training_session 中已锁定）。

`listTrainingSessions`（TEACHER/ADMIN 可调）：
```sql
SELECT ts.*, sp.display_name as student_name
FROM training_session ts
JOIN student_profile sp ON sp.student_id = ts.student_id
WHERE (ts.student_id = :studentId OR :studentId IS NULL)
  AND (ts.status = :status OR :status IS NULL)
ORDER BY ts.updated_at DESC
LIMIT :limit OFFSET :offset
```

`getTrainingSession`（TEACHER/ADMIN/STUDENT 可调，STUDENT 只能读自己的）：
```sql
SELECT * FROM training_session WHERE training_session_id = ?
-- 再查 training_step_record ORDER BY step_order ASC
```

**测试用例：**
- 单元测试（`src/main/ipc/handlers/__tests__/training-complete.test.ts`）：
  - 4 步全 COMPLETED → completion_rate=100，training_session.status=COMPLETED，result_record 存在，normalized_score=100
  - 3 步 COMPLETED + 1 步 SKIPPED → completion_rate=75，level_result=LEVEL_CONDITIONAL
  - 4 步全 SKIPPED → completion_rate=0，level_result=LEVEL_NOT_COMPETENT
  - 3 步 COMPLETED + 1 步 FAILED → completion_rate=75（FAILED 不计入分子）
  - `sessionCompleted: true` 在返回结果中标记
- 集成测试：result_record.source_aggregate_id = training_session_id，checksum 正确

**commit message 建议：**
`feat(training): TRAINING_COMPLETED 闭环 + result_record + listSessions/getSession`

---

### Step 7：安全红线处理（REDLINE_HALTED + IN_PROGRESS 步骤级联归档）

**改动文件：**
- `src/main/ipc/handlers/training.ts`：新增并导出 `haltTrainingSessionSteps` 函数
- `src/main/ipc/handlers/assessment.ts`：在 `triggerRedline` 函数的 `db.transaction` 提交后调用 `haltTrainingSessionSteps(db, studentId, taskCode)`

> 本 step 不新建单独的 `training:triggerRedline` IPC 通道。训练侧的红线触发由现有
> `assessment:triggerRedline` 在 safety_incident 写入后经 schema trigger
> `trg_safety_incident_batch_halt_sessions` 自动将 training_session 置为 REDLINE_HALTED。
> 应用层只需处理「红线后的 IN_PROGRESS 步骤级联 FAILED」这一步骤。

**核心逻辑：**

schema trigger 已自动：
- 将开放 training_session 置 `REDLINE_HALTED`

应用层额外处理（handler 监听红线触发后的后续动作）：

```typescript
// 在 assessment:triggerRedline handler 写完 REDLINE_TRIGGERED 事件之后调用
// （修改 assessment.ts 的 triggerRedline 函数，在事务后追加此步骤）
export function haltTrainingSessionSteps(
  db: DBAdapter,
  studentId: string,
  taskCode: string
): void {
  // 找到 REDLINE_HALTED 的 training_session（刚由 trigger 批量更新的）
  const haltedSessions = db.prepare(
    `SELECT training_session_id FROM training_session
     WHERE student_id = ? AND task_code = ? AND status = 'REDLINE_HALTED'`
  ).all(studentId, taskCode) as Array<{ training_session_id: string }>

  for (const { training_session_id } of haltedSessions) {
    // 将所有 IN_PROGRESS 步骤更新为 FAILED（应用层级联，trigger 不处理步骤）
    db.prepare(
      `UPDATE training_step_record SET status = 'FAILED', updated_at = datetime('now')
       WHERE training_session_id = ? AND status = 'IN_PROGRESS'`
    ).run(training_session_id)
  }
}
```

> [!] 安全红线触发链：
> 1. `assessment:triggerRedline` → 写 `REDLINE_TRIGGERED` 事件 → schema trigger 批量 HALT assessment_session + training_session
> 2. 应用层（assessment handler 事务提交后）调用 `haltTrainingSessionSteps` → UPDATE IN_PROGRESS 步骤为 FAILED
> 3. 不再写 training 侧的额外事件（PRD 明确：schema trigger 不级联步骤，应用层 UPDATE 不用写事件）

**测试用例：**
- 单元测试（`src/main/ipc/handlers/__tests__/training-redline.test.ts`）：
  - 创建有 IN_PROGRESS 步骤的 training_session，触发红线 → training_session.status=REDLINE_HALTED
  - IN_PROGRESS 步骤 status 变为 FAILED
  - NOT_STARTED / COMPLETED / SKIPPED / FAILED 步骤不被修改
  - 红线后继续操作步骤（startStep/completeStep等）→ SESSION_HALTED

**commit message 建议：**
`feat(training): 安全红线应用层级联 — IN_PROGRESS 步骤归档为 FAILED`

---

### Step 8：三个 Vue 视图 + 路由

**改动文件：**
- `src/renderer/src/views/teacher/TrainingListView.vue`（新建）
- `src/renderer/src/views/teacher/TrainingCreateView.vue`（新建）
- `src/renderer/src/views/student/TrainingView.vue`（新建）
- `src/renderer/src/router/index.ts`：添加 3 条路由

**核心逻辑：**

路由条目（添加至 `/teacher` children 和 `/student` children）：
```typescript
// /teacher children
{ path: 'trainings', component: () => import('../views/teacher/TrainingListView.vue') },
{ path: 'trainings/create', component: () => import('../views/teacher/TrainingCreateView.vue') },

// /student children
{ path: 'training/:sessionId', component: () => import('../views/student/TrainingView.vue') },
```

**TrainingListView.vue（教师侧）：**
- 页面加载：调用 `window.api.training.listSessions({ callerUserId, callerRole })`
- 表格显示：学生姓名 | 模块 | 状态 | 完成率 | 操作时间
- 状态筛选 select（全部 / INIT / ACTIVE / COMPLETED / REDLINE_HALTED）
- 按学生筛选（输入框）
- 「新建训练」按钮 → navigate `/teacher/trainings/create`

**TrainingCreateView.vue（教师侧）：**
- 表单字段：选学生（从 `student:list` 获取）、选模块（6 个 FINE_MOTOR / COGNITION / ... 下拉）、选策略版本（`strategy:list` 筛选 strategy_type=TRAINING_PRACTICE）
- 提交 → `window.api.training.createSession(...)` → 成功后 navigate 到 TrainingListView
- 错误处理：DUPLICATE_TRAINING_SESSION / BLOCKED_BY_SAFETY_INCIDENT 显示友好提示

**TrainingView.vue（学生侧）：**
- 页面加载：调用 `getSession(sessionId)` 展示 4 个步骤卡片
- 每个步骤卡片：
  - 展示步骤名、当前状态 badge（颜色区分 NOT_STARTED/IN_PROGRESS/COMPLETED/SKIPPED/FAILED）
  - 步骤内容区：占位文字 + 模拟进度条（本次不做真实播放）
  - 按钮组：「开始」（NOT_STARTED → IN_PROGRESS）| 「完成」（IN_PROGRESS → COMPLETED）| 「跳过」| 「失败/重试」
- 步骤乱序提示：前序步骤未处理时「开始」按钮 disabled
- 全部步骤处理完毕后：显示训练完成横幅 + completion_rate

**测试用例（手工验收）：**
- 教师创建训练 → 列表可见 status=INIT
- 学生进入训练页，按顺序完成 4 步 → 完成率 100%
- 学生跳过 1 步 → 完成率 75%
- 学生失败 → 点击重试 → attempt_count 显示

**commit message 建议：**
`feat(training): 三个 Vue 视图 + 路由（TrainingList / TrainingCreate / TrainingView）`

---

## 项目约束自检

- [x] **事件写入顺序**：JSONL append → domain_event_projection → applyTrainingEvent（reducer 更新投影表），不可颠倒。所有事务均使用 `db.transaction`。
- [x] **新 EventType 已加入 `event-payloads.ts`**：Step 1 补 `TRAINING_STEP_RETRIED`、`TRAINING_ABORTED`；`TRAINING_STARTED` 复用现有值（不新增 `TRAINING_SESSION_CREATED`，PRD 命名差异已记录）。
- [x] **新 IPC 通道已在 `preload/index.ts` 白名单中声明**：Step 3 接线 8 个通道。
- [x] **无硬编码题量/阈值**：completion_rate 使用 `total_step_count`（来自 training_session）；level_result 从 strategy_config.scoring_policy_json.level_rules 计算。
- [x] **FSM 状态迁移路径与 schema trigger 一致**：
  - `INIT → ACTIVE`：第一个 TRAINING_STEP_STARTED 时在 applyStepStarted 中触发（非 INSERT 时）
  - 终态（COMPLETED/REDLINE_HALTED/ABORTED）由 schema trigger `trg_training_session_no_terminal_status_change` 兜底阻止非法迁移
  - `EMOTION_INTERRUPTED` 本次实现路径不写入（PRD「不做」）
- [x] **[!] 安全红线触发链**：schema trigger 批量 HALT training_session；应用层在 assessment:triggerRedline 事务后调用 `haltTrainingSessionSteps` 将 IN_PROGRESS 步骤 UPDATE 为 FAILED；不写额外训练事件。
- [x] **JSON 字段写入前有格式校验**：`question_policy_json`/`scoring_policy_json` 在 createSession 读取时 try/catch parse；training handler 不新增非结构化 JSON 字段。
- [ ] **结果分离展示**：TRAINING_COMPLETION result_record 独立写入，不与 ABILITY_SCORE 合并——由视图层各自读取，本 impl 不包含报告页（后续功能承接）。

---

## 回归验收清单

- [ ] typecheck 通过：`npm run typecheck`（或 `tsc --noEmit`）0 报错
- [ ] build 通过：`npm run build`（electron-vite，主进程 + preload + renderer）0 报错
- [ ] vitest 通过：`npm run test`（training-create / training-steps / training-complete / training-redline 测试文件）
- [ ] 手工冒烟：教师创建训练 → 学生依序完成四步 → 检查 TRAINING_COMPLETION result_record 存在，normalized_score = completion_rate
- [ ] 边界验收（对应 PRD 成功验收标准 §1–§8）：
  - [ ] §1：教师 createSession 成功，training_session.status = INIT
  - [ ] §2：学生完成四步，每步 status = COMPLETED
  - [ ] §3：每步变更后 domain_event_projection 有对应记录
  - [ ] §4：SKIPPED 步骤不计入 completed_step_count，completion_rate < 100
  - [ ] §5：failStep + retryStep，attempt_count 递增，TRAINING_STEP_RETRIED 事件存在
  - [ ] §6：训练完成后 result_record 存在，normalized_score = completion_rate
  - [ ] §7：同学生同任务重复创建返回 DUPLICATE_TRAINING_SESSION 错误
  - [ ] §8：strategy_id 为 NULL 的 INSERT 被 schema trigger 阻断，handler 返回 VALIDATION_ERROR

---

## 步骤依赖关系

```
Step 1（seed + event 枚举）
  ↓
Step 2（共享类型）
  ↓
Step 3（接线骨架）
  ↓
Step 4（createSession）
  ↓
Step 5（步骤生命周期）
  ↓
Step 6（TRAINING_COMPLETED + list/get）
  ↓
Step 7（安全红线）
  ↓
Step 8（Vue 视图 + 路由）
```

Step 4–6 严格串行（reducer 函数互相依赖）。Step 7 和 Step 8 可在 Step 6 完成后并行，但手工验收需要 Step 8 视图就位。

