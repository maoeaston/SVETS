# 炫灿-职途向导系统 事件载荷规范

版本：v1.0.0  
工程基线：`schema.sql v0.1.7-consistency-guard`，`PRD v1.0.4`  
文档状态：草案（首期落地实施前置文档）  
最后更新：2026-06-30

---

## 0. 约定

1. 本文档定义 `action_log.jsonl` 的 **JSONL 信封格式** 及 **26 个领域事件的 payload 结构**。
2. 每行为一个完整 JSON 对象（无换行符），以 `\n` 分隔。
3. `checksum` 由 `SHA-256(JSON.stringify(payload))` 生成，用于完整性校验。
4. `event_sequence` 在同一 `aggregate_id` 内单调递增，用于检测事件缺失或重复。
5. 所有时间戳使用 ISO 8601 UTC 格式，例如 `2026-06-30T08:33:23.344Z`。
6. `actor_role` 为 `SYSTEM` 时，`actor_id` 可填写 `system` 或系统组件标识符。

---

## 1. JSONL 信封格式

```typescript
interface ActionLogEntry {
  // required
  event_id: string;                  // UUID v4
  aggregate_type: AggregateType;     // 聚合根类型
  aggregate_id: string;              // 聚合根 ID
  event_type: EventType;             // 事件类型
  event_sequence: number;            // 每个聚合根内的序列号，从 1 开始
  payload: Record<string, unknown>;  // 事件载荷，结构见后续章节
  checksum: string;                  // SHA-256 of JSON.stringify(payload)
  schema_version: number;            // payload schema 版本号，当前为 1
  created_at: string;                // ISO 8601 UTC
  actor_id: string;                  // 操作者 user_id 或 'system'
  actor_role: ActorRole;             // 操作者角色
  app_version: string;               // 应用版本，例如 "1.0.4"

  // optional
  correlation_id?: string;           // 关联 ID，用于串联同一用户操作产生的多个事件
}

type AggregateType =
  | 'ASSESSMENT_SESSION'
  | 'TRAINING_SESSION'
  | 'SAFETY_INCIDENT'
  | 'TASK_REPORT'
  | 'SYSTEM';

type ActorRole = 'STUDENT' | 'TEACHER' | 'ADMIN' | 'SYSTEM';

type EventType =
  | 'SESSION_STARTED'
  | 'ANSWER_SUBMITTED'
  | 'EMOTION_INTERRUPTED'
  | 'EMOTION_RESUMED'
  | 'OFFLINE_SCORE_SUBMITTED'
  | 'REDLINE_TRIGGERED'
  | 'SESSION_COMPLETED'
  | 'SESSION_ABORTED'
  | 'TRAINING_STARTED'
  | 'TRAINING_STEP_STARTED'
  | 'TRAINING_STEP_COMPLETED'
  | 'TRAINING_STEP_SKIPPED'
  | 'TRAINING_STEP_FAILED'
  | 'TRAINING_COMPLETED'
  | 'RESULT_CALCULATED'
  | 'REPORT_GENERATED'
  | 'REPORT_EXPORTED'
  | 'REPORT_LOCKED'
  | 'SAFETY_INCIDENT_CREATED'
  | 'SAFETY_INCIDENT_DETAIL_CONFIRMED'
  | 'SAFETY_INCIDENT_RESOLVED'
  | 'SAFETY_INCIDENT_VOIDED'
  | 'SAFETY_INCIDENT_REPLACED_FOR_FACTUAL_CORRECTION'
  | 'SNAPSHOT_COMMITTED'
  | 'RECOVERY_REPLAYED'
  | 'RECOVERY_LOG_TRUNCATED';
```

**示例（完整 JSONL 行）：**
```json
{"event_id":"550e8400-e29b-41d4-a716-446655440000","aggregate_type":"ASSESSMENT_SESSION","aggregate_id":"sess_001","event_type":"SESSION_STARTED","event_sequence":1,"payload":{"session_id":"sess_001","student_id":"stu_001","strategy_id":"strategy_baseline_shelver_v1","strategy_type":"BASELINE_ASSESSMENT","strategy_version":1,"job_code":"SUPERMARKET_SHELVER","task_code":"UNBOX_AND_SHELVE","online_question_count":17,"offline_question_count":3,"question_ids":["Q_BASE_RULE_TF_001","Q_BASE_FINE_MOTOR_SC_001"]},"checksum":"a1b2c3d4e5f6...","schema_version":1,"created_at":"2026-06-30T08:33:23.344Z","actor_id":"teacher_001","actor_role":"TEACHER","app_version":"1.0.4","correlation_id":"corr_20260630_001"}
```

---

## 2. 测评会话事件（ASSESSMENT_SESSION）

### 2.1 SESSION_STARTED

测评会话开始，已完成组卷。

```typescript
interface SessionStartedPayload {
  session_id: string;
  student_id: string;
  strategy_id: string;
  strategy_type: 'BASELINE_ASSESSMENT' | 'FOLLOWUP_ASSESSMENT' | 'MOCK_EXAM';
  strategy_version: number;
  job_code: string;
  task_code: string;
  online_question_count: number;
  offline_question_count: number;
  question_ids: string[];            // 已生成的题目 ID 列表（顺序即为出题顺序）
}
```

### 2.2 ANSWER_SUBMITTED

学生提交了一道在线题的答案。

```typescript
interface AnswerSubmittedPayload {
  session_id: string;
  answer_id: string;                 // answer_record.answer_id
  question_id: string;
  question_type: 'TRUE_FALSE' | 'SINGLE_CHOICE' | 'DRAG';
  answer_payload: AnswerPayloadDetail;
  is_correct: boolean;
  score: 0 | 1 | 2;
  question_order: number;            // 该题在本次会话中的序号（1-based）
  submitted_at: string;              // ISO 8601 UTC
}

type AnswerPayloadDetail =
  | { question_type: 'TRUE_FALSE'; selected: boolean }
  | { question_type: 'SINGLE_CHOICE'; selected: string }
  | { question_type: 'DRAG'; placements: { item_id: string; zone_id: string }[] };
```

### 2.3 EMOTION_INTERRUPTED

学生情绪中断，暂停会话。

```typescript
interface EmotionInterruptedPayload {
  session_id: string;
  interrupted_at: string;
  current_question_order?: number | null; // 中断时正在作答的题目序号
  reason?: string | null;            // 教师记录的原因
}
```

### 2.4 EMOTION_RESUMED

学生情绪恢复，会话继续。

```typescript
interface EmotionResumedPayload {
  session_id: string;
  resumed_at: string;
  resume_from_question_order?: number | null; // 从哪道题继续
}
```

### 2.5 OFFLINE_SCORE_SUBMITTED

教师提交了线下实操题的评分。

```typescript
interface OfflineScoreSubmittedPayload {
  session_id: string;
  offline_score_id: string;          // offline_score_record.offline_score_id
  question_id: string;
  criterion_scores: CriterionScore[];
  total_score: number;               // 该题总分（所有 criterion 分数之和）
  scored_by: string;                 // 评分教师 user_id
  scored_at: string;
}

interface CriterionScore {
  criterion_id: string;              // 对应 content_json.rubric_criteria
  score: 0 | 1 | 2;
}
```

### 2.6 REDLINE_TRIGGERED

安全红线触发，会话被强制熔断。

```typescript
interface RedlineTriggeredPayload {
  session_id: string;
  incident_id: string;               // 关联的 safety_incident.incident_id
  reason_code: string;               // 安全事件原因码
  context_phase: 'BASELINE_ASSESSMENT' | 'FOLLOWUP_ASSESSMENT' | 'MOCK_EXAM' | 'TRAINING';
  triggered_at: string;
}
```

### 2.7 SESSION_COMPLETED

测评会话正常完成（所有题目已答完或跳过）。

```typescript
interface SessionCompletedPayload {
  session_id: string;
  completed_at: string;
  total_online_answered: number;
  total_offline_scored: number;
  has_pending_offline: boolean;      // 是否还有未评分的线下题
}
```

### 2.8 SESSION_ABORTED

测评会话被人工中止（非红线，非正常完成）。

```typescript
interface SessionAbortedPayload {
  session_id: string;
  aborted_at: string;
  aborted_by: string;                // user_id
  reason?: string | null;            // 中止原因
}
```

---

## 3. 训练会话事件（TRAINING_SESSION）

### 3.1 TRAINING_STARTED

训练会话开始。

```typescript
interface TrainingStartedPayload {
  training_session_id: string;
  student_id: string;
  strategy_id: string;
  strategy_type: 'TRAINING_PRACTICE';
  strategy_version: number;
  job_code: string;
  task_code: string;
  total_steps: number;               // 训练总步骤数
  step_order: string[];              // 步骤顺序，例如 ['WATCH', 'LEARN', 'PRACTICE', 'DO']
}
```

### 3.2 TRAINING_STEP_STARTED

某个训练步骤开始。

```typescript
interface TrainingStepStartedPayload {
  training_session_id: string;
  step_record_id: string;            // training_step_record.step_record_id
  step_type: 'WATCH' | 'LEARN' | 'PRACTICE' | 'DO';
  step_order: number;                // 1-based
  started_at: string;
}
```

### 3.3 TRAINING_STEP_COMPLETED

某个训练步骤完成。

```typescript
interface TrainingStepCompletedPayload {
  training_session_id: string;
  step_record_id: string;
  step_type: 'WATCH' | 'LEARN' | 'PRACTICE' | 'DO';
  completed_at: string;
  duration_seconds?: number | null;
}
```

### 3.4 TRAINING_STEP_SKIPPED

某个训练步骤被跳过。

```typescript
interface TrainingStepSkippedPayload {
  training_session_id: string;
  step_record_id: string;
  step_type: 'WATCH' | 'LEARN' | 'PRACTICE' | 'DO';
  skipped_at: string;
  reason?: string | null;
}
```

### 3.5 TRAINING_STEP_FAILED

某个训练步骤失败（例如"做"环节未通过评估）。

```typescript
interface TrainingStepFailedPayload {
  training_session_id: string;
  step_record_id: string;
  step_type: 'WATCH' | 'LEARN' | 'PRACTICE' | 'DO';
  failed_at: string;
  reason?: string | null;
}
```

### 3.6 TRAINING_COMPLETED

训练会话完成（所有步骤已完成/跳过/失败）。

```typescript
interface TrainingCompletedPayload {
  training_session_id: string;
  completed_at: string;
  total_steps: number;
  completed_steps: number;
  skipped_steps: number;
  failed_steps: number;
  completion_rate: number;           // 完成率百分比
}
```

---

## 4. 结果与报告事件

### 4.1 RESULT_CALCULATED

某类结果计算完成并写入 result_record。

```typescript
interface ResultCalculatedPayload {
  result_id: string;                 // result_record.result_id
  result_type: 'ABILITY_SCORE' | 'TRAINING_COMPLETION' | 'OPERATION_PASS_RATE';
  source_type: 'ASSESSMENT_SESSION' | 'TRAINING_SESSION';
  source_id: string;                 // session_id 或 training_session_id
  student_id: string;
  job_code: string;
  task_code: string;
  raw_score?: number | null;
  max_score?: number | null;
  normalized_score: number;
  level_result: string;
  calculated_at: string;
  calculated_by: string;             // 'system' 或 user_id
}
```

### 4.2 REPORT_GENERATED

报告生成完成并写入 task_report。

```typescript
interface ReportGeneratedPayload {
  report_id: string;                 // task_report.report_id
  student_id: string;
  job_code: string;
  task_code: string;
  report_type: 'FULL_REPORT' | 'SAFETY_TERMINATION_REPORT';
  result_ids: string[];              // 关联的 result_record.result_id 列表
  incident_ids?: string[];           // 关联的 safety_incident.incident_id 列表（可选）
  generated_at: string;
  generated_by: string;              // 'system' 或 user_id
}
```

### 4.3 REPORT_EXPORTED

报告被导出为外部文件。

```typescript
interface ReportExportedPayload {
  report_id: string;
  export_format: 'PDF' | 'HTML' | 'JSON';
  export_path: string;               // 导出文件路径（相对于应用数据目录）
  exported_at: string;
  exported_by: string;
}
```

### 4.4 REPORT_LOCKED

报告被锁定，禁止修改。

```typescript
interface ReportLockedPayload {
  report_id: string;
  locked_at: string;
  locked_by: string;
  lock_reason?: string | null;       // 例如 "已提交给家长" 或 "归档"
}
```

---

## 5. 安全事件（SAFETY_INCIDENT）

### 5.1 SAFETY_INCIDENT_CREATED

安全事件创建（初始状态为 PENDING_DETAIL）。

```typescript
interface SafetyIncidentCreatedPayload {
  incident_id: string;               // safety_incident.incident_id
  student_id: string;
  job_code: string;
  task_code: string;
  reason_code: string;               // 对应 error_code_registry.error_code
  context_phase: 'BASELINE_ASSESSMENT' | 'FOLLOWUP_ASSESSMENT' | 'MOCK_EXAM' | 'TRAINING';
  occurred_at: string;
  reported_by: string;               // user_id
  brief_description?: string | null;
}
```

### 5.2 SAFETY_INCIDENT_DETAIL_CONFIRMED

安全事件详情确认（状态从 PENDING_DETAIL → CONFIRMED）。

```typescript
interface SafetyIncidentDetailConfirmedPayload {
  incident_id: string;
  confirmed_at: string;
  confirmed_by: string;
  full_description: string;
  severity_level?: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  witnesses?: string[];              // 见证人 user_id 列表
  photos_asset_ids?: string[];       // 现场照片 asset_id 列表
}
```

### 5.3 SAFETY_INCIDENT_RESOLVED

安全事件处理完毕（状态 → RESOLVED）。

```typescript
interface SafetyIncidentResolvedPayload {
  incident_id: string;
  resolved_at: string;
  resolved_by: string;
  resolution_notes: string;          // 处理措施说明
  follow_up_required: boolean;
}
```

### 5.4 SAFETY_INCIDENT_VOIDED

安全事件作废（状态 → VOIDED）。

```typescript
interface SafetyIncidentVoidedPayload {
  incident_id: string;
  voided_at: string;
  voided_by: string;
  void_reason: 'FALSE_ALARM' | 'DUPLICATE' | 'STUDENT_MISMATCH' | 'DATA_ENTRY_ERROR';
  void_notes?: string | null;
}
```

### 5.5 SAFETY_INCIDENT_REPLACED_FOR_FACTUAL_CORRECTION

安全事件因事实性错误被替换（PRD §5.7 原子事务）。

```typescript
interface SafetyIncidentReplacedPayload {
  old_incident_id: string;           // 被作废的旧事件 ID
  new_incident_id: string;           // 新创建的事件 ID
  replaced_at: string;
  replaced_by: string;
  correction_reason: string;         // 更正原因说明
  factual_changes: FactualChange[];
}

interface FactualChange {
  field: string;                     // 被更正的字段名
  old_value: string;
  new_value: string;
}
```

---

## 6. 系统事件（SYSTEM）

### 6.1 SNAPSHOT_COMMITTED

SQLite 投影快照提交（domain_event_projection 写入完成）。

```typescript
interface SnapshotCommittedPayload {
  snapshot_id: string;               // 快照 ID（可用 UUID 或时间戳）
  last_event_id: string;             // 最后一个已投影的 event_id
  last_event_sequence: number;       // 最后一个已投影的 event_sequence
  projection_timestamp: string;
  event_count: number;               // 本次投影的事件数量
}
```

### 6.2 RECOVERY_REPLAYED

系统恢复：从 action_log.jsonl 重放事件到 SQLite。

```typescript
interface RecoveryReplayedPayload {
  recovery_session_id: string;       // 本次恢复会话 ID
  started_at: string;
  completed_at: string;
  total_events_replayed: number;
  last_event_id: string;
  consistency_check_passed: boolean;
  errors_encountered?: ErrorSummary[];
}

interface ErrorSummary {
  event_id: string;
  error_type: string;
  error_message: string;
}
```

### 6.3 RECOVERY_LOG_TRUNCATED

action_log.jsonl 日志截断（已投影的历史事件被归档）。

```typescript
interface RecoveryLogTruncatedPayload {
  truncated_at: string;
  truncated_by: string;
  archive_path: string;              // 归档文件路径
  archived_event_count: number;
  retained_event_count: number;      // 保留在 action_log.jsonl 中的事件数
  oldest_retained_event_id: string;
}
```

---

## 7. 事件写入与回放规则

### 7.1 写入顺序

1. 主进程领域服务生成事件 payload。
2. 计算 `checksum = SHA-256(JSON.stringify(payload))`。
3. 分配 `event_id`（UUID v4）和 `event_sequence`（查询当前 aggregate 最大 sequence + 1）。
4. 构造完整 `ActionLogEntry` 并追加写入 `action_log.jsonl`（文件锁保护）。
5. 同步写入 `domain_event_projection` 表。
6. 调用 reducer 更新 SQLite 投影表（assessment_session / training_session / result_record 等）。

### 7.2 回放规则

冷启动时或恢复时，从 `action_log.jsonl` 逐行读取：

1. 解析 JSON 并验证 `checksum`。
2. 按 `aggregate_id` 分组，检查 `event_sequence` 连续性。
3. 按 `created_at` 顺序依次调用 reducer。
4. 跳过 `schema_version` 不兼容的事件（记录警告）。
5. 恢复完成后，对比 SQLite 投影与最后一个 `SNAPSHOT_COMMITTED` 的 `last_event_id`。

### 7.3 Checksum 计算示例（Node.js）

```javascript
const crypto = require('crypto');

function calculateChecksum(payload) {
  const canonical = JSON.stringify(payload); // 不使用 replacer 或 space
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}
```

---

## 8. 事件版本兼容性

`schema_version` 用于标记 payload 结构版本。当前所有事件为 `schema_version: 1`。

若未来需要修改某个事件的 payload 结构：

1. **向后兼容修改**（新增可选字段）→ 保持 `schema_version: 1`，reducer 容错处理。
2. **不兼容修改**（删除字段、改变必填字段语义）→ 递增为 `schema_version: 2`，旧版本 reducer 跳过新版本事件。

---

## 附录 A：事件聚合根映射表

| 事件类型 | aggregate_type | aggregate_id 来源 |
|---|---|---|
| SESSION_STARTED | ASSESSMENT_SESSION | session_id |
| ANSWER_SUBMITTED | ASSESSMENT_SESSION | session_id |
| EMOTION_INTERRUPTED | ASSESSMENT_SESSION | session_id |
| EMOTION_RESUMED | ASSESSMENT_SESSION | session_id |
| OFFLINE_SCORE_SUBMITTED | ASSESSMENT_SESSION | session_id |
| REDLINE_TRIGGERED | ASSESSMENT_SESSION | session_id |
| SESSION_COMPLETED | ASSESSMENT_SESSION | session_id |
| SESSION_ABORTED | ASSESSMENT_SESSION | session_id |
| TRAINING_STARTED | TRAINING_SESSION | training_session_id |
| TRAINING_STEP_STARTED | TRAINING_SESSION | training_session_id |
| TRAINING_STEP_COMPLETED | TRAINING_SESSION | training_session_id |
| TRAINING_STEP_SKIPPED | TRAINING_SESSION | training_session_id |
| TRAINING_STEP_FAILED | TRAINING_SESSION | training_session_id |
| TRAINING_COMPLETED | TRAINING_SESSION | training_session_id |
| RESULT_CALCULATED | ASSESSMENT_SESSION or TRAINING_SESSION | source_id |
| REPORT_GENERATED | TASK_REPORT | report_id |
| REPORT_EXPORTED | TASK_REPORT | report_id |
| REPORT_LOCKED | TASK_REPORT | report_id |
| SAFETY_INCIDENT_CREATED | SAFETY_INCIDENT | incident_id |
| SAFETY_INCIDENT_DETAIL_CONFIRMED | SAFETY_INCIDENT | incident_id |
| SAFETY_INCIDENT_RESOLVED | SAFETY_INCIDENT | incident_id |
| SAFETY_INCIDENT_VOIDED | SAFETY_INCIDENT | incident_id |
| SAFETY_INCIDENT_REPLACED_FOR_FACTUAL_CORRECTION | SAFETY_INCIDENT | new_incident_id |
| SNAPSHOT_COMMITTED | SYSTEM | 'system' |
| RECOVERY_REPLAYED | SYSTEM | 'system' |
| RECOVERY_LOG_TRUNCATED | SYSTEM | 'system' |

---

## 附录 B：事件完整性检查清单

在主进程写入事件前，必须验证：

| 检查项 | 规则 |
|---|---|
| event_id | UUID v4 格式 |
| aggregate_id | 非空且存在于对应表中 |
| event_sequence | 当前 aggregate 最大 sequence + 1 |
| payload | 必须是有效 JSON 对象，不得为 null 或数组 |
| checksum | SHA-256(JSON.stringify(payload)) 的十六进制字符串 |
| created_at | ISO 8601 UTC 格式，且 >= 最近一个事件的时间戳 |
| actor_id | 非空且符合 user_id 格式（或 'system'）|
| schema_version | 正整数，当前固定为 1 |

---

*本文档配套文件：`doc/xc-career-guide-json-field-schema-v1.0.0.md`*

