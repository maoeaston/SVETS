# 实操评分（Operation Scoring）实现文档

版本：v1.0.0  
来源 PRD：`doc/features/operation-scoring-prd.md` v1.0.1  
schema 基线：v0.1.10-scoring-closure

---

## 实现目标（一句话）

教师对 OFFLINE_PENDING 状态的 assessment_session 批量提交 9 项实操评分，系统写入 offline_score_record + 计算 OPERATION_PASS_RATE result_record。

## 前置条件

- schema v0.1.10 的 `offline_score_record` 表已存在（含 `score_scope`、`task_operation_code` 列、唯一索引 `ux_offline_score_one_valid_task_operation`）
- `result_record` 表已存在（含 `result_type` CHECK 包含 `OPERATION_PASS_RATE`）
- `OfflineScoreSubmittedPayload` 已定义于 `src/shared/types/event-payloads.ts`
- `ResultCalculatedPayload.result_type` 已包含 `'OPERATION_PASS_RATE'`
- `assessment-reducer.ts` 已处理 `RESULT_CALCULATED` 事件
- `level-judge.ts` 纯函数可复用（OPERATION_PASS_RATE 仅使用分数阈值路径，无模块兜底/情绪兜底）

---

## 实现步骤（每步对应一个 commit）

### Step 1：共享类型定义 + payload 扩展

**改动文件：**
- `src/shared/types/operation-scoring.ts`（新建）：9 个 task_operation_code 枚举 + rubric 定义 + IPC 参数/结果类型 + OperationPassRatePayload
- `src/shared/types/event-payloads.ts`：扩展 `OfflineScoreSubmittedPayload`（+3 字段）+ 扩展 `ResultCalculatedPayload.breakdown` 联合类型

**核心逻辑：**

```typescript
// --- src/shared/types/operation-scoring.ts ---

// 9 个实操评分项
export const TASK_OPERATION_CODES = [
  'IDENTIFY_BOX',
  'CHECK_BOX_DAMAGE',
  'OPEN_PACKAGE_SAFELY',
  'TAKE_OUT_GOODS',
  'CHECK_GOODS_APPEARANCE',
  'IDENTIFY_SHELF_POSITION',
  'PLACE_BY_RULE',
  'TIDY_SHELF_FACE',
  'CONFIRM_COMPLETION'
] as const
export type TaskOperationCode = typeof TASK_OPERATION_CODES[number]

// 每项的评分标准（MVP 硬编码）
export interface OperationRubric {
  code: TaskOperationCode
  name: string
  rubric: { score: 0 | 1 | 2; description: string }[]
}
export const OPERATION_RUBRICS: OperationRubric[] = [...]

// OPERATION_PASS_RATE result_payload_json 结构
export interface OperationPassRatePayload {
  result_type: 'OPERATION_PASS_RATE'
  items: { task_operation_code: TaskOperationCode; score: 0 | 1 | 2 }[]
  raw_score: number
  max_score: 18
  total_items: 9
}

// 错误码（复用 AssessmentErrorCode 中的 + 本功能独有的）
export type OperationScoringErrorCode =
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'BLOCKED_BY_SAFETY_INCIDENT'
  | 'ASSESSMENT_SYSTEM_ERROR'
  | 'SESSION_NOT_OFFLINE_PENDING'
  | 'ALREADY_SCORED'
  | 'TOOL_CHECKLIST_NOT_CONFIRMED'

// IPC 参数
export interface SubmitOperationScoresParams {
  callerUserId: string
  callerRole: string
  sessionId: string
  toolChecklistConfirmed: boolean
  scores: { taskOperationCode: TaskOperationCode; score: 0 | 1 | 2; observationNote?: string }[]
}

// IPC 返回
export interface SubmitOperationScoresSuccess {
  success: true
  resultId: string
  normalizedScore: number
  levelResult: string
}
export type SubmitOperationScoresResult =
  | SubmitOperationScoresSuccess
  | { success: false; errorCode: OperationScoringErrorCode }

// 查询类型
export interface GetOperationScoresParams {
  callerUserId: string
  callerRole: string
  sessionId: string
}
export interface OperationScoreItem {
  taskOperationCode: TaskOperationCode
  score: 0 | 1 | 2
  observationNote: string | null
  scoredAt: string
}
export interface GetOperationScoresSuccess {
  success: true
  items: OperationScoreItem[]
  resultId?: string
  normalizedScore?: number
  levelResult?: string
}
export type GetOperationScoresResult =
  | GetOperationScoresSuccess
  | { success: false; errorCode: OperationScoringErrorCode }
```

```typescript
// --- src/shared/types/event-payloads.ts 变更 ---

// 1. 扩展 OfflineScoreSubmittedPayload（+3 字段，事件溯源：投影可从事件流重建）
export interface OfflineScoreSubmittedPayload {
  // ...existing fields...
  scoring_rubric_json: string       // 评分标准 JSON 快照
  observation_note?: string | null  // 教师观察备注
  tool_checklist_confirmed: boolean // 教具清单确认
}

// 2. 扩展 ResultCalculatedPayload.breakdown 联合类型
breakdown?: AbilityScorePayload | OperationPassRatePayload | null
// 需要 import { OperationPassRatePayload } from './operation-scoring'
```

**测试用例：**
- 单元测试：`TASK_OPERATION_CODES` 长度 = 9；每个 code 在 `OPERATION_RUBRICS` 中有对应 rubric
- 单元测试：类型导出正确（tsc 编译通过即验证）

**commit message 建议：**
`feat(operation-scoring): 共享类型 + payload 扩展（9 枚举 + rubric + IPC 契约）`

---

### Step 2：Reducer 扩展 — 处理 OFFLINE_SCORE_SUBMITTED

**改动文件：**
- `src/main/domain/assessment-reducer.ts`：新增 `applyOfflineScoreSubmitted` 分支 + import 类型

**核心逻辑：**

```typescript
case 'OFFLINE_SCORE_SUBMITTED':
  applyOfflineScoreSubmitted(db, event)
  break
```

`applyOfflineScoreSubmitted` 职责：
- 幂等：`offline_score_id` 存在则 skip
- INSERT into `offline_score_record`（所有字段从 event payload 映射）
- 不更新 `assessment_session` 状态（OFFLINE_PENDING 保持不变）

**字段映射（payload → offline_score_record）：**
| payload 字段 | 列名 | 说明 |
|---|---|---|
| offline_score_id | offline_score_id | PK |
| session_id | session_id | FK |
| question_id (null) | question_id | TASK_OPERATION 轨道固定 NULL |
| score_scope | score_scope | 'TASK_OPERATION' |
| task_operation_code | task_operation_code | 评分项 code |
| criterion_scores[0].score | score | 单维度 0/1/2 |
| scoring_rubric_json | scoring_rubric_json | 评分标准快照 |
| observation_note | observation_note | 可选 |
| scored_by | scored_by | FK |
| event.event_id | scored_event_id | FK |
| scored_at | scored_at | ISO timestamp |
| tool_checklist_confirmed | tool_checklist_confirmed | 1 |

payload 扩展已在 Step 1 完成（`scoring_rubric_json`、`observation_note`、`tool_checklist_confirmed` 三字段），此步 reducer 直接从 payload 读取。

**测试用例：**
- 集成测试：构造 OFFLINE_SCORE_SUBMITTED event → apply → SELECT offline_score_record 验证行存在
- 单元测试：幂等——同 event apply 两次，offline_score_record 只有一行
- 边界：score_scope = 'TASK_OPERATION' 时 question_id 必须为 null（schema CHECK 兜底）
- 边界：9 个不同 offline_score_id 的事件 apply 后，offline_score_record 有 9 行

**commit message 建议：**
`feat(operation-scoring): reducer 处理 OFFLINE_SCORE_SUBMITTED → offline_score_record`

---

### Step 3：IPC handler — submitOperationScores

**改动文件：**
- `src/main/ipc/handlers/operation-scoring.ts`（新建）：核心纯函数 + registerHandler
- `src/main/ipc/index.ts`：import 新 handler 模块

**核心逻辑：**

```
submitOperationScores(db, params):
  1. assertCaller(TEACHER)
  2. 校验 sessionId 非空
  3. 读 assessment_session（含 strategy_id, strategy_version, student_id, task_code）
     → 校验 status = OFFLINE_PENDING
  4. 校验无未解决安全事件（同 createSession 模式：safety_incident WHERE student_id + task_code）
  5. 校验 toolChecklistConfirmed = true
  6. 校验 scores 数组长度 = 9 且每项 taskOperationCode ∈ TASK_OPERATION_CODES
  7. 校验每项 score ∈ {0, 1, 2}
  8. 校验无重复 taskOperationCode
  9. 校验该 session 无已有 VALID + TASK_OPERATION 记录（幂等防护；SELECT COUNT）
  10. 读 strategy_config WHERE strategy_id + version → 获取 competent_threshold / conditional_threshold
  11. db.transaction {
       for each score item (按 TASK_OPERATION_CODES 顺序):
         - 生成 offline_score_id = uuidv4()
         - 查 OPERATION_RUBRICS 拿对应 rubric → JSON.stringify 作为 scoring_rubric_json
         - 构造 OfflineScoreSubmittedPayload（含扩展字段）
         - writeEvent(OFFLINE_SCORE_SUBMITTED, aggregate=ASSESSMENT_SESSION, aggregateId=sessionId)
         - applyAssessmentEvent(db, event)  // → INSERT offline_score_record
       计算 OPERATION_PASS_RATE:
         - raw_score = sum(9 items score)
         - max_score = 18
         - normalized_score = raw / 18 * 100
         - level_result 直接判定（不复用 judgeLevel）:
           if (normalized >= competentThreshold) → 'LEVEL_COMPETENT'
           else if (normalized >= conditionalThreshold) → 'LEVEL_CONDITIONAL'
           else → 'LEVEL_NOT_COMPETENT'
       构造 ResultCalculatedPayload:
         - result_type = 'OPERATION_PASS_RATE'
         - source_type = 'ASSESSMENT_SESSION'
         - source_id = sessionId
         - breakdown = OperationPassRatePayload { items, raw_score, max_score: 18 }
         - completion_ratio = 1.0
       writeEvent(RESULT_CALCULATED)
       applyAssessmentEvent(db, event)  // → applyResultCalculated INSERT result_record
     }
  12. 返回 { success: true, resultId, normalizedScore, levelResult }
```

**[!] 等级判定决策：不复用 judgeLevel，直接 if-else**

`judgeLevel` 专为 ABILITY_SCORE 设计（6 模块兜底 + 情绪兜底 + 分数阈值三级优先）。OPERATION_PASS_RATE 只需分数阈值。若复用 judgeLevel 必须传入 `moduleScores: []`、`emotionCollapseCount: 0`、`moduleVetoThreshold: 1`、`emotionCollapseThreshold: 999` 等 magic number 才能让前两级不触发——语义不清晰且脆弱。

**选择直接实现**（3 行 if-else，从 strategy_config 读 competent_threshold / conditional_threshold）。理由：简单、语义明确、无间接依赖。

`getOperationScores` 纯读函数：
- assertCaller(TEACHER/ADMIN)
- SELECT offline_score_record WHERE session_id AND score_scope = 'TASK_OPERATION' AND status = 'VALID'
- SELECT result_record WHERE source_aggregate_id = sessionId AND result_type = 'OPERATION_PASS_RATE' AND is_current = 1

**错误码**（新增到 assessment.ts 或单独类型文件）：
- `SESSION_NOT_OFFLINE_PENDING`：status != OFFLINE_PENDING
- `ALREADY_SCORED`：已有 TASK_OPERATION VALID 评分记录
- `TOOL_CHECKLIST_NOT_CONFIRMED`：教具清单未确认
- 复用已有：`FORBIDDEN` / `NOT_FOUND` / `BLOCKED_BY_SAFETY_INCIDENT` / `VALIDATION_ERROR` / `ASSESSMENT_SYSTEM_ERROR`

**测试用例：**
- 集成测试：完整路径 → 9 条 offline_score_record + 1 条 result_record
- 单元测试：normalized_score 计算（0/0/0... → 0, 2/2/2... → 100, 1/1/1... → 50）
- 单元测试：level_result 阈值判定（≥80=COMPETENT, 60-79=CONDITIONAL, <60=NOT_COMPETENT）
- 异常测试：非 OFFLINE_PENDING → SESSION_NOT_OFFLINE_PENDING
- 异常测试：scores 长度 != 9 → VALIDATION_ERROR
- 异常测试：重复提交 → ALREADY_SCORED
- 异常测试：未确认教具清单 → TOOL_CHECKLIST_NOT_CONFIRMED
- 异常测试：安全事件阻断 → BLOCKED_BY_SAFETY_INCIDENT
- 幂等：同 session 提交两次（第二次被 ALREADY_SCORED 阻断）

**commit message 建议：**
`feat(operation-scoring): IPC handler — 批量提交 + OPERATION_PASS_RATE 计算`

---

### Step 4：Preload 白名单 + IPC API 类型声明

**改动文件：**
- `src/preload/index.ts`：assessment 对象下新增 `submitOperationScores` / `getOperationScores`
- `src/shared/types/ipc-api.ts`：import 新类型 + assessment 接口声明新增两个方法

**核心逻辑：**
```typescript
// preload
assessment: {
  ...existing,
  submitOperationScores: (params: unknown) => ipcRenderer.invoke('assessment:submitOperationScores', params),
  getOperationScores: (params: unknown) => ipcRenderer.invoke('assessment:getOperationScores', params)
}

// ipc-api.ts
import type { SubmitOperationScoresParams, SubmitOperationScoresResult, GetOperationScoresParams, GetOperationScoresResult } from './operation-scoring'

assessment: {
  ...existing
  submitOperationScores: (params: SubmitOperationScoresParams) => Promise<SubmitOperationScoresResult>
  getOperationScores: (params: GetOperationScoresParams) => Promise<GetOperationScoresResult>
}
```

**测试用例：**
- typecheck 通过（preload + ipc-api 类型一致）
- build 通过

**commit message 建议：**
`feat(operation-scoring): preload 白名单 + IPC 类型声明`

---

### Step 5：Vue 视图 — OperationScoringView.vue + 路由

**改动文件：**
- `src/renderer/src/views/teacher/OperationScoringView.vue`（新建）
- `src/renderer/src/router/index.ts`：新增路由 `/teacher/assessments/:sessionId/scoring`
- `src/renderer/src/views/teacher/AssessmentListView.vue`：OFFLINE_PENDING 状态的行增加"实操评分"入口按钮

**核心逻辑（Vue 组件）：**

1. onMounted：调 `api.assessment.getOperationScores({ sessionId })` 检查是否已评分
   - 已评分：显示结果摘要（只读模式）
   - 未评分：显示评分表单
2. 表单结构：
   - 9 行，每行：评分项名称 + rubric 描述 + 0/1/2 单选 + observation_note 输入
   - 顶部：教具清单确认 checkbox
   - 底部：提交按钮（disabled 直到所有项评分完成 + 教具清单已确认）
3. 提交：调 `api.assessment.submitOperationScores(params)`
   - 成功：显示结果（normalized_score + level_result）
   - 失败：显示错误信息

**路由：**
```typescript
{
  path: 'assessments/:sessionId/scoring',
  component: () => import('../views/teacher/OperationScoringView.vue')
}
```

**AssessmentListView 入口：**
在 `OFFLINE_PENDING` 状态的 session 行操作列增加 `<RouterLink>` 到 `/teacher/assessments/${sessionId}/scoring`。

**测试用例：**
- 手工验收：导航到 OFFLINE_PENDING session → 看到 9 项评分表
- 手工验收：全部评分 + 确认教具清单 → 提交成功，显示结果
- 手工验收：未勾选教具清单 → 提交按钮 disabled
- 手工验收：部分评分 → 提交按钮 disabled
- 手工验收：已评分 session 再进入 → 只读模式

**commit message 建议：**
`feat(operation-scoring): Vue 视图 + 路由 + 列表入口`

---

## 项目约束自检

- [x] 事件写入顺序：JSONL append → domain_event_projection → reducer（writeEvent 内部保证 1→2，外部 applyAssessmentEvent 保证 3）
- [x] 新 EventType：`OFFLINE_SCORE_SUBMITTED` 已在 event-payloads.ts（无需新增 EventType）
- [x] 新 IPC 通道：`assessment:submitOperationScores` / `assessment:getOperationScores` 在 Step 4 加入 preload 白名单
- [x] 无硬编码阈值：competent_threshold / conditional_threshold 从 strategy_config 读取
- [x] FSM 状态不变：OFFLINE_PENDING 保持，不迁移（由后续功能驱动）
- [x] 安全红线相关：[!] 提交前校验无未解决安全事件 + session 非 REDLINE_HALTED；D3 明确红线中途不生成 OPERATION_PASS_RATE
- [x] JSON 字段写入前有格式校验：scoring_rubric_json 从硬编码 rubric 生成，结构已知；observation_note 为纯文本无需 JSON 校验

---

## 回归验收清单

- [ ] typecheck 通过（`npm run typecheck`）
- [ ] build 通过（`npm run build`）
- [ ] vitest 通过（`npx vitest run`）
- [ ] 手工冒烟：
  1. 教师登录 → 测评列表 → OFFLINE_PENDING session → 点"实操评分"
  2. 看到 9 项评分表 + 教具清单 checkbox
  3. 逐项评 2 分（满分）→ 勾选教具清单 → 提交
  4. 看到结果：100 分 + LEVEL_COMPETENT
  5. 再次进入该 session 评分页 → 只读模式
  6. 新 session：评 0 分（全零）→ 提交 → 0 分 + LEVEL_NOT_COMPETENT
  7. 红线 session（REDLINE_HALTED）→ 不可进入评分页
