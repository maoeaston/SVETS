# 方案 B 架构 v2.0.1 — Schema 对齐硬化修订

> **基线：** v2.0 权威实施基线 (2026-07-14)  
> **修订范围：** 极小范围硬化，不重新设计总体架构  
> **正式 Schema 基线：** `src/main/db/schema.sql` v0.1.12-job-skill-assessment-mvp-closure  
> **约束：** 不修改代码、不修改正式 Schema 文件、不安装依赖

---

## §0 Schema 基线修正

### 0.1 v2.0 中的错误

v2.0 §3 中为 `assessment_session`、`training_session`、`safety_incident` 等表给出了简化版 `CREATE TABLE`，与正式 schema v0.1.12 存在以下冲突：

| v2.0 错误 | 正式 v0.1.12 事实 |
|-----------|------------------|
| 定义了简化版 `assessment_session` (约 30 字段) | 正式表有 ~60 字段 + 48 触发器 |
| 使用 `student_user_id` 作为学生标识 | 正式 schema 使用 `student_id` FK → `student_profile` |
| 重新定义 `safety_incident` | 正式表已有完整状态机 + 触发器链 |
| 定义 `business_session.status` | 与子表权威状态冲突 |
| `assessment_session` 包含 `VOIDED` 终态 | 终态保护触发器不允许新增终态 |

### 0.2 修正后的正式基线声明

**多设备架构必须是对 `src/main/db/schema.sql` v0.1.12 的增量扩展。**

不得重新定义或替换以下既有表：
- `assessment_session` (305-395 行)
- `training_session` (562-637 行)
- `result_record` (780-862 行)
- `safety_incident` (675-737 行)
- `safety_incident_binding` (748-773 行)
- `task_report` (868-902 行)
- `domain_event_projection` (262-298 行)
- `student_profile` (91-105 行)
- `strategy_config` (111-152 行)

不得删除或修改以下触发器（共 48 个，行 999-1791）。

> **[!] 用户在修订请求中引用 `06-current-schema-v0.1.10.sql`。实际仓库中该文件不存在；正式 schema 文件为 `src/main/db/schema.sql`，版本标记 v0.1.12（从 v0.1.10-scoring-closure 合并而来）。本文以实际文件 v0.1.12 为准。**

---

## §1 assessment_session 增量扩展（替代 v2.0 §3.9）

### 1.1 v0.1.12 保留字段（不修改）

以下字段保留原样，不做任何修改：

```
session_id, student_id, strategy_id, strategy_type, job_code, task_code,
strategy_version, status, current_question_id, online_question_count,
offline_question_count, online_completed_count, offline_completed_count,
pause_count, pause_started_at, pause_duration_total_sec, last_interruption_reason,
raw_score, max_score, normalized_score, level_result,
redline_incident_id, is_report_generated, report_type,
started_at, completed_at, created_by, updated_at,
created_event_id, last_applied_event_id, last_status_event_id
```

status 枚举保留原值：
```
'INIT', 'ACTIVE', 'EMOTION_INTERRUPTED', 'SUSPENDED_REVIEW_REQUIRED',
'OFFLINE_PENDING', 'COMPLETED', 'REDLINE_HALTED', 'ABORTED'
```

### 1.2 需要新增的字段

```sql
-- 多设备架构：交互阶段投影
ALTER TABLE assessment_session ADD COLUMN delivery_phase TEXT DEFAULT 'PREPARED'
  CHECK (delivery_phase IS NULL OR delivery_phase IN (
    'PREPARED', 'ASSIGNED', 'STUDENT_CONFIRMED', 'ONLINE_IN_PROGRESS',
    'ONLINE_COMPLETED', 'OFFLINE_SCORING', 'OBSERVATION',
    'READY_TO_FINALIZE', 'FINALIZED'));

-- 多设备架构：乐观锁版本
ALTER TABLE assessment_session ADD COLUMN event_sequence_version INTEGER DEFAULT 0
  CHECK (event_sequence_version IS NULL OR event_sequence_version >= 0);

-- 多设备架构：观察模板引用（决定是否需要 OBSERVATION 阶段）
ALTER TABLE assessment_session ADD COLUMN observation_template_id TEXT;
```

### 1.3 需要新增的索引

```sql
CREATE INDEX IF NOT EXISTS idx_assessment_session_delivery_phase
  ON assessment_session(delivery_phase)
  WHERE delivery_phase IS NOT NULL;
```

### 1.4 需要新增的触发器

```sql
-- delivery_phase 单向迁移保护
CREATE TRIGGER IF NOT EXISTS trg_assessment_delivery_phase_forward_only
BEFORE UPDATE OF delivery_phase ON assessment_session
FOR EACH ROW
WHEN OLD.delivery_phase IS NOT NULL AND NEW.delivery_phase IS NOT NULL
  AND OLD.delivery_phase <> NEW.delivery_phase
BEGIN
  SELECT CASE
    WHEN OLD.delivery_phase = 'FINALIZED' THEN
      RAISE(ABORT, 'delivery_phase FINALIZED is terminal')
    WHEN OLD.delivery_phase = 'READY_TO_FINALIZE' AND NEW.delivery_phase <> 'FINALIZED' THEN
      RAISE(ABORT, 'delivery_phase READY_TO_FINALIZE can only advance to FINALIZED')
    WHEN OLD.delivery_phase = 'OBSERVATION' AND NEW.delivery_phase <> 'READY_TO_FINALIZE' THEN
      RAISE(ABORT, 'delivery_phase OBSERVATION can only advance to READY_TO_FINALIZE')
    WHEN OLD.delivery_phase = 'OFFLINE_SCORING'
      AND NEW.delivery_phase NOT IN ('OBSERVATION', 'READY_TO_FINALIZE') THEN
      RAISE(ABORT, 'delivery_phase OFFLINE_SCORING can only advance to OBSERVATION or READY_TO_FINALIZE')
  END;
END;
```

### 1.5 SQLite 迁移步骤

```sql
-- Migration: v0.1.12 → v0.2.0 (multi-device increment)
-- 执行前提：所有 assessment_session 已有 status 值

-- Step 1: 新增列（SQLite 允许 ALTER TABLE ADD COLUMN）
ALTER TABLE assessment_session ADD COLUMN delivery_phase TEXT DEFAULT 'PREPARED'
  CHECK (delivery_phase IS NULL OR delivery_phase IN (
    'PREPARED','ASSIGNED','STUDENT_CONFIRMED','ONLINE_IN_PROGRESS',
    'ONLINE_COMPLETED','OFFLINE_SCORING','OBSERVATION','READY_TO_FINALIZE','FINALIZED'));

ALTER TABLE assessment_session ADD COLUMN event_sequence_version INTEGER DEFAULT 0
  CHECK (event_sequence_version IS NULL OR event_sequence_version >= 0);

ALTER TABLE assessment_session ADD COLUMN observation_template_id TEXT;

-- Step 2: 回填已有数据
UPDATE assessment_session SET delivery_phase = 'FINALIZED'
  WHERE status IN ('COMPLETED', 'REDLINE_HALTED', 'ABORTED');
UPDATE assessment_session SET delivery_phase = 'ONLINE_IN_PROGRESS'
  WHERE status = 'ACTIVE';
UPDATE assessment_session SET delivery_phase = 'PREPARED'
  WHERE status = 'INIT';
UPDATE assessment_session SET delivery_phase = 'OFFLINE_SCORING'
  WHERE status = 'OFFLINE_PENDING';

-- Step 3: 新增索引
CREATE INDEX IF NOT EXISTS idx_assessment_session_delivery_phase
  ON assessment_session(delivery_phase) WHERE delivery_phase IS NOT NULL;

-- Step 4: 新增触发器（见 §1.4）

-- Step 5: 记录迁移
INSERT INTO schema_migration (migration_id, schema_version, description)
VALUES ('2026-07-14_multi_device_v0_2_0', '0.2.0-multi-device',
  'Multi-device architecture increment: delivery_phase, event_sequence_version, observation_template_id');
```

### 1.6 向后兼容说明

- `delivery_phase` 默认 `'PREPARED'`，允许 NULL（兼容旧记录迁移前的瞬态）
- `event_sequence_version` 默认 0
- 既有代码不使用 `delivery_phase`，不受影响
- 所有 48 个既有触发器不受影响（它们不引用新字段）
- `status` 仍为权威业务状态，`delivery_phase` 是辅助投影

---

## §2 student_profile ↔ user_account 身份统一

### 2.1 v0.1.12 现状

```
user_account(user_id TEXT PK, role, username, ...)
student_profile(student_id TEXT PK, name, gender, age_group, ...)
```

- `student_profile.student_id` 是独立 PK，**无** FK 指向 `user_account`
- 所有业务表 (`assessment_session`, `training_session`, `safety_incident`, `result_record`) FK 指向 `student_profile(student_id)`
- `assessment_session.created_by` FK → `user_account(user_id)`（教师操作者）

### 2.2 问题

v2.0 多设备架构中 `delegated_access_grant` 表引用 `student_user_id`，暗示学生有 `user_account` 记录。但 v0.1.12 中学生没有登录账号——学生由教师在教师端管理。

### 2.3 决策：增量关联，不合并

**不合并** `student_profile` 和 `user_account`。增加可选的关联列：

```sql
-- Migration: 新增学生→用户可选关联
ALTER TABLE student_profile ADD COLUMN user_id TEXT
  REFERENCES user_account(user_id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_student_profile_user_id
  ON student_profile(user_id) WHERE user_id IS NOT NULL;
```

### 2.4 语义规则

| 场景 | student_profile.user_id | 说明 |
|------|------------------------|------|
| MVP 单机模式 | NULL | 学生无账号，教师代操作 |
| 多设备学生自主登录 | 指向 user_account | 学生有独立登录能力 |
| 多设备但教师代操作 | NULL | 兼容 MVP 行为 |

### 2.5 多设备表中的外键统一

v2.0 中所有引用学生的多设备新表（如 `delegated_access_grant`、`business_session_assignment`）**必须引用 `student_profile(student_id)`**，不引用 `user_account(user_id)`：

```sql
-- v2.0 中的错误写法（作废）：
-- student_user_id TEXT REFERENCES user_account(user_id)

-- v2.0.1 修正写法：
CREATE TABLE delegated_access_grant (
  grant_id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES student_profile(student_id),
  teacher_auth_session_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'EXPIRED', 'REVOKED')),
  replaces_grant_id TEXT REFERENCES delegated_access_grant(grant_id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX ux_grant_one_active_per_student_device
  ON delegated_access_grant(student_id, device_id)
  WHERE status = 'ACTIVE';
```

### 2.6 向后兼容

- `student_profile.user_id` 允许 NULL，不影响既有数据
- UNIQUE 约束仅限非 NULL 值——不影响 NULL 行
- 所有既有 FK 继续指向 `student_profile(student_id)`，无需修改

---

## §3 安全事件投影修正（消除双重执行）

### 3.1 v2.0 中的错误描述

v2.0 §8 声称："既有触发器执行双熔断（对目标 session 和 training_session 触发 REDLINE_HALTED）"。

**事实核查（v0.1.12）：**

1. `safety_incident` 表上只有以下触发器：
   - `trg_safety_incident_no_update_core_facts` — 禁止修改核心事实字段
   - `trg_safety_incident_status_forward_only` — 状态只能前进
   - `trg_safety_incident_confirmed_immutable` — CONFIRMED 后不可修改
   - `trg_safety_incident_insert_requires_pending_detail` — INSERT 时强制 PENDING_DETAIL 状态
   - `trg_safety_incident_role_authorization` — 角色授权检查

2. **不存在**"INSERT safety_incident 时自动 UPDATE assessment_session.status = 'REDLINE_HALTED'"的触发器。

3. v0.1.12 中 assessment_session 被标记为 REDLINE_HALTED 是通过 **应用层事件投影器** 处理 `SafetyIncidentCreated` 事件时完成的。

### 3.2 修正后的安全事件流程

```
┌─────────────────────────────────────────────────────────────────┐
│ 安全事件处理（v2.0.1 权威流程）                                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. 教师触发安全事件命令                                          │
│     ↓                                                           │
│  2. Command Handler 验证前置条件                                  │
│     ↓                                                           │
│  3. 生成事件: SafetyIncidentCreated                              │
│     ↓                                                           │
│  4. 写入 JSONL（PREPARE→APPLY→CONFIRM 协议）                     │
│     ↓                                                           │
│  5. 事件投影器（应用层，单线程）：                                  │
│     a. INSERT INTO safety_incident (...)                         │
│        → 触发 trg_safety_incident_insert_requires_pending_detail │
│     b. INSERT INTO safety_incident_binding (...)                 │
│     c. UPDATE assessment_session SET                             │
│          status = 'REDLINE_HALTED',                             │
│          redline_incident_id = :incident_id                     │
│        → 触发 trg_assessment_terminal_status_guard（验证合法性）  │
│     d. UPDATE training_session SET status = 'HALTED' ...        │
│        （如有相关 training_session）                              │
│                                                                 │
│  注意：步骤 5a-5d 在同一个 SQLite 事务中执行                      │
│  5c 和 5d 是投影器代码执行的 UPDATE，不是触发器自动执行的          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 3.3 关键不变量

| 不变量 | 保证方式 |
|--------|----------|
| safety_incident INSERT 时状态必须为 PENDING_DETAIL | 触发器 `trg_safety_incident_insert_requires_pending_detail` |
| assessment_session 终态不可逆 | 触发器 `trg_assessment_terminal_status_guard` |
| 安全事件核心事实不可篡改 | 触发器 `trg_safety_incident_no_update_core_facts` |
| 一个事务内原子完成（incident + binding + session halt） | 投影器在同一个 BEGIN…COMMIT 中执行所有写入 |
| 不存在 "第二次投影" | 投影器是唯一执行 halt 的代码路径 |

### 3.4 v2.0 §8 需要修改的原文

删除以下错误描述：
> ~~"既有触发器执行双熔断"~~  
> ~~"safety_incident INSERT 触发器自动 HALT 相关 session"~~

替换为：
> "安全事件的会话熔断由事件投影器在同一事务中执行。触发器仅负责数据完整性约束（状态合法性、核心事实不可变性），不执行跨表副作用。"

---

## §4 business_session 状态模型修正

### 4.1 v2.0 中的问题

v2.0 定义了 `business_session` 父表并包含 `status` 字段。但：

1. v0.1.12 中不存在 `business_session` 表
2. `assessment_session` 和 `training_session` 各自有独立的 `status` 字段和触发器保护
3. 父表 `status` 与子表 `status` 可能不一致

### 4.2 修正：business_session 无 status 列

```sql
CREATE TABLE IF NOT EXISTS business_session (
  session_id TEXT PRIMARY KEY,
  session_type TEXT NOT NULL CHECK (session_type IN ('ASSESSMENT', 'TRAINING')),
  student_id TEXT NOT NULL REFERENCES student_profile(student_id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- 无 status 列。权威状态存在子表中。
  CONSTRAINT fk_bs_student FOREIGN KEY (student_id)
    REFERENCES student_profile(student_id)
);
```

### 4.3 状态查询方式

```sql
-- 查询 business_session 的实际状态
SELECT bs.session_id, bs.session_type,
  CASE bs.session_type
    WHEN 'ASSESSMENT' THEN a.status
    WHEN 'TRAINING' THEN t.status
  END AS actual_status
FROM business_session bs
LEFT JOIN assessment_session a ON bs.session_id = a.session_id
LEFT JOIN training_session t ON bs.session_id = t.training_session_id;
```

### 4.4 与现有 FK 的兼容

- `assessment_session.session_id` 须同时存在于 `business_session(session_id)` — 通过迁移脚本回填
- 新 assessment/training session 创建时，投影器先 INSERT `business_session`，再 INSERT 子表
- 触发器保护只在子表上，父表仅做聚合查询入口

### 4.5 迁移脚本

```sql
-- 从既有数据回填 business_session
INSERT OR IGNORE INTO business_session (session_id, session_type, student_id, created_at)
  SELECT session_id, 'ASSESSMENT', student_id, created_at FROM assessment_session;
INSERT OR IGNORE INTO business_session (session_id, session_type, student_id, created_at)
  SELECT training_session_id, 'TRAINING', student_id, created_at FROM training_session;
```

---

## §5 Grant ↔ Assignment FK 方向修正

### 5.1 v2.0 中的问题

v2.0 中 `business_session_assignment` 引用 `delegated_access_grant(grant_id)`，同时 `delegated_access_grant` 引用回 assignment。FK 双向循环，导致 INSERT 顺序依赖。

### 5.2 修正：单向 FK（Assignment 引用 Grant）

```sql
CREATE TABLE IF NOT EXISTS business_session_assignment (
  assignment_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES business_session(session_id),
  device_id TEXT NOT NULL REFERENCES device(device_id),
  grant_id TEXT NOT NULL REFERENCES delegated_access_grant(grant_id),
  assigned_by TEXT NOT NULL REFERENCES user_account(user_id),
  status TEXT NOT NULL DEFAULT 'ASSIGNED'
    CHECK (status IN ('ASSIGNED', 'ACTIVE', 'COMPLETED', 'CANCELLED')),
  assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
  activated_at TEXT,
  completed_at TEXT
);

CREATE UNIQUE INDEX ux_assignment_one_active_per_session
  ON business_session_assignment(session_id)
  WHERE status IN ('ASSIGNED', 'ACTIVE');
```

**Grant 表不引用 Assignment。** Grant 是访问授权凭据，Assignment 是业务会话的设备绑定——两者是独立关切：

- Grant 表达 "教师允许该学生在该设备上操作"
- Assignment 表达 "该测评会话分配到该设备执行"
- 一个 Grant 可对应多个 Assignment（同一学生多次测评）
- Assignment 通过 `grant_id` FK 验证授权有效性

### 5.3 INSERT 顺序

```
1. INSERT delegated_access_grant（教师授权）
2. INSERT business_session_assignment（使用已有 grant_id）
```

无循环依赖。

---

## §6 终态修正：移除 VOIDED，使用 correction_record

### 6.1 v2.0 中的问题

v2.0 提议为 `assessment_session.status` 新增 `VOIDED` 值。但：

1. v0.1.12 的终态保护触发器 `trg_assessment_terminal_status_guard` 禁止从任何终态迁移
2. 一旦 session 达到 COMPLETED/REDLINE_HALTED/ABORTED，不可再改变
3. 新增 VOIDED 需要修改触发器逻辑，违反"不修改既有触发器"的约束

### 6.2 修正方案：session_invalidation_record

对于需要"作废"已完成测评的场景（如发现作弊），不修改原 session 状态，而是创建一个独立的失效记录：

```sql
CREATE TABLE IF NOT EXISTS session_invalidation_record (
  invalidation_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES assessment_session(session_id),
  reason TEXT NOT NULL CHECK (reason IN (
    'INTEGRITY_VIOLATION', 'PROCEDURE_ERROR', 'EQUIPMENT_FAILURE', 'ADMIN_OVERRIDE')),
  evidence_json TEXT CHECK (evidence_json IS NULL OR json_valid(evidence_json)),
  invalidated_by TEXT NOT NULL REFERENCES user_account(user_id),
  invalidated_at TEXT NOT NULL DEFAULT (datetime('now')),
  notes TEXT
);

CREATE UNIQUE INDEX ux_invalidation_per_session
  ON session_invalidation_record(session_id);
```

### 6.3 查询逻辑

```sql
-- 判断 session 是否有效
SELECT a.session_id, a.status,
  CASE WHEN inv.invalidation_id IS NOT NULL THEN 'INVALIDATED' ELSE 'VALID' END AS validity
FROM assessment_session a
LEFT JOIN session_invalidation_record inv ON a.session_id = inv.session_id;
```

### 6.4 不变量

- `assessment_session.status` 终态保护触发器不修改
- 一个 session 最多一条 invalidation 记录（UNIQUE INDEX）
- 作废不改变历史数据，只添加标记——满足审计要求
- 报告生成时检查 `session_invalidation_record`，已失效的 session 不生成新报告

---

## §7 command_log 不可逆点定义

### 7.1 问题

v2.0 中 `BATCH_PREPARED` 被描述为不可逆点，但未明确定义其语义边界和 command_log 中的对应字段。

### 7.2 不可逆点定义

```
命令生命周期：
  PENDING → PROCESSING → [BATCH_PREPARED] → SUCCEEDED
                       ↘ FAILED (可重试)

[BATCH_PREPARED] = JSONL 中已写入 BATCH_PREPARED 标记行且 fsync 完成

不可逆约束：
  一旦 command_log.status = 'PROCESSING' 且事件已写入 JSONL：
  - 不可删除已写入的 JSONL 行
  - 不可回滚已 fsync 的事件数据
  - 即使 SQLite 投影失败，事件数据仍存在于 JSONL 中
  - 恢复流程会重放这些事件
```

### 7.3 command_log 增量字段

```sql
-- v2.0.1：command_log 增加 JSONL 写入追踪
ALTER TABLE command_log ADD COLUMN request_hash TEXT;
ALTER TABLE command_log ADD COLUMN lease_generation INTEGER DEFAULT 0;
ALTER TABLE command_log ADD COLUMN worker_id TEXT;
ALTER TABLE command_log ADD COLUMN event_batch_id TEXT;
```

### 7.4 Fencing Token 机制

```
lease_generation 用法：
1. Server 启动时 lease_generation = last_generation + 1
2. 每个 command_log INSERT 记录当前 lease_generation
3. 恢复时拒绝 lease_generation < current 的 PROCESSING 记录（视为上一任期残留）
4. 残留记录由恢复流程标记为 FAILED + error_code = 'LEASE_EXPIRED'
```

### 7.5 关键不变量

| 不变量 | 保证方式 |
|--------|----------|
| 已 fsync 的 JSONL 数据不可删除 | append-only 文件 + 无 truncate API |
| 同一时刻最多一个 in-flight batch | lease_generation fencing |
| worker 崩溃后旧命令不干扰新 worker | generation 比较拒绝旧租约 |
| 命令幂等 | (client_instance_id, idempotency_key) UNIQUE |

---

## §8 JSONL 重建范围分类

### 8.1 v2.0 中的错误声明

v2.0 声称"所有 SQLite 表可从 JSONL 重建"。这不正确。

### 8.2 表分类

| 分类 | 含义 | 表 |
|------|------|-----|
| **领域事实表**（可重建） | 全部数据由领域事件投影产生，可从 JSONL 完整重放 | `assessment_session`, `training_session`, `safety_incident`, `safety_incident_binding`, `result_record`, `task_report`, `domain_event_projection`, `student_profile`* |
| **运维/基础设施表**（不可重建） | 数据来源非领域事件，不在 JSONL 中 | `user_account`, `strategy_config`, `error_code_registry`, `schema_migration`, `snapshot_meta`, `error_event_log` |
| **事件溯源基础设施表**（自举表） | JSONL 恢复流程自身使用的跟踪表 | `applied_event_batch`, `projector_cursor` |
| **多设备架构新增表**（混合） | 部分可从事件重建，部分是运维配置 | 见 §8.3 |

\* `student_profile` 的创建事件在 JSONL 中，但初始导入数据可能来源于 seed 脚本而非事件。

### 8.3 多设备新增表分类

| 表 | 分类 | 说明 |
|----|------|------|
| `node` | 运维 | 节点注册信息，非事件产物 |
| `device` | 运维 | 设备注册，非事件产物 |
| `auth_session` | 运维 | 登录会话，非事件产物 |
| `delegated_access_grant` | 领域事实 | 由 GrantIssued 事件投影 |
| `business_session` | 领域事实 | 由 SessionCreated 事件投影 |
| `business_session_assignment` | 领域事实 | 由 SessionAssigned 事件投影 |
| `command_log` | 事件溯源基础设施 | 命令去重/幂等跟踪 |
| `session_invalidation_record` | 领域事实 | 由 SessionInvalidated 事件投影 |

### 8.4 备份策略差异

| 分类 | 备份方式 | 恢复方式 |
|------|----------|----------|
| 领域事实表 | 可选（SQLite 备份更快） | 优先从备份恢复；极端情况从 JSONL 重放 |
| 运维表 | **必须**备份 | 只能从备份恢复 |
| 自举表 | 可从 JSONL 推算重建 | 重放 JSONL 时自动重建 |

### 8.5 修正后的恢复不变量

> "从 JSONL 可重建**领域事实**表。运维/基础设施表必须从 SQLite 备份恢复，不可从 JSONL 推导。恢复后执行一致性校验确认两者同步。"

---

## §9 CA 证书安装流程修正

### 9.1 v2.0 中的错误

v2.0 中 CA 证书下载通过 HTTPS 端口提供。但设备首次连接时尚未信任 CA，HTTPS 握手会失败（证书未知）。

### 9.2 修正后的流程

```
CA 证书安装（v2.0.1 修正）：

┌─ HTTP :7070（临时，明文）──────────────────────────────────┐
│                                                            │
│  GET /api/v1/bootstrap/ca.crt                             │
│  → 返回 PEM 格式 CA 证书                                   │
│  → Response Header: X-Cert-Fingerprint: SHA256:<hex>       │
│                                                            │
│  约束：                                                    │
│  - 仅在"配对模式"下开放（教师触发）                          │
│  - 5 分钟无活动自动关闭                                     │
│  - 配对完成后立即关闭                                       │
│  - 不接受 POST/PUT/DELETE                                  │
│  - 不传输任何业务数据                                       │
│                                                            │
└────────────────────────────────────────────────────────────┘

┌─ HTTPS :7443（永久，加密）─────────────────────────────────┐
│                                                            │
│  所有业务 API（REST + SSE）                                 │
│  认证：Cookie-based auth_session                           │
│  证书：Node CA 签发的叶子证书（ECDSA P-256）                │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### 9.3 安全考量

| 风险 | 缓解措施 |
|------|----------|
| HTTP 明文传输 CA 证书被中间人替换 | 教师手动比对屏幕上显示的指纹（SHA-256） |
| HTTP 端口长期暴露 | 配对完成/超时后关闭，非配对模式不开放 |
| 证书下载后被篡改 | 客户端比对下载证书的 SHA-256 与显示的指纹 |

### 9.4 端口职责划分

| 端口 | 协议 | 生命周期 | 职责 |
|------|------|----------|------|
| :7070 | HTTP | 临时（配对时） | CA 证书下载 + 指纹展示 |
| :7443 | HTTPS | 永久 | 全部业务数据通信 |

---

## §10 学生可见性规则

### 10.1 v2.0 中的问题

v2.0 引用了 v1.1 §10 的可见性规则，但 v1.1 已声明为历史文档。规则需要内联到 v2.0.1 中。

### 10.2 学生端可见数据范围

```
学生端（平板/一体机）数据可见性规则：

可见：
  - 当前分配给自己的 assessment_session（status IN ('ACTIVE', 'OFFLINE_PENDING')）
  - 自己的 student_profile 基本信息（姓名、性别、年龄段）
  - 当前 session 的在线题目（按 delivery_phase 控制进度）
  - 自己已完成测评的结果摘要（normalized_score, level_result）
  - 系统公告（如有）

不可见：
  - 其他学生的任何数据
  - 教师端管理信息（strategy_config、user_account 列表）
  - 安全事件详情（safety_incident 的 description、evidence）
  - 原始评分明细（raw_score、逐题得分）
  - 已失效的 session 内容（session_invalidation_record 存在时）
  - 离线评分表数据（offline 题目的答案/评分由教师在教师端操作）
  - 未分配给自己的 session

部分可见：
  - 自己的 task_report：仅在 session status = 'COMPLETED' 且 is_report_generated = 1 时可见
  - 安全事件对自己的影响：仅显示"测评已中止"，不显示具体事件内容
```

### 10.3 Grant 授权验证逻辑

```sql
-- 学生设备请求数据时的授权验证
SELECT 1 FROM delegated_access_grant g
JOIN business_session_assignment bsa ON bsa.grant_id = g.grant_id
WHERE g.student_id = :requesting_student_id
  AND g.device_id = :requesting_device_id
  AND g.status = 'ACTIVE'
  AND g.expires_at > datetime('now')
  AND bsa.session_id = :requested_session_id
  AND bsa.status IN ('ASSIGNED', 'ACTIVE');
-- 返回 0 行 → 403 Forbidden
```

### 10.4 SSE 频道过滤

学生设备订阅 SSE 时只推送与自己相关的事件：

```
SSE 频道: /api/v1/sse/student/:student_id

推送事件类型（白名单）：
  - session.phase_changed（仅自己的 session）
  - session.score_available（仅自己的 session 已完成时）
  - system.announcement
  - device.heartbeat_ack

不推送：
  - safety_incident.*（通过状态变化间接感知）
  - admin.*
  - teacher.*
  - 其他学生的任何事件
```

---

## §11 备份与恢复：版本化数据目录

### 11.1 v2.0 中的问题

v2.0 备份方案使用 `VACUUM INTO` + staging 恢复，但未定义数据目录的版本管理和原子切换机制。

### 11.2 数据目录结构

```
{app_data}/
├── current → v3/            ← 原子符号链接（活跃版本）
├── v1/                      ← 历史版本（保留 N 个）
│   ├── xc-career-guide.db
│   ├── action_log.jsonl
│   └── manifest.json
├── v2/
│   ├── xc-career-guide.db
│   ├── action_log.jsonl
│   └── manifest.json
├── v3/                      ← 当前活跃版本
│   ├── xc-career-guide.db
│   ├── action_log.jsonl
│   └── manifest.json
└── staging/                 ← 恢复用临时区
```

### 11.3 备份流程

```
备份流程（v2.0.1）：

1. 进入 BACKUP_FREEZE 模式（§8.4 + v1.2 §九-C）
2. 确保所有 in-flight batch 完成
3. 读取当前版本号 N = current 指向的目录编号
4. 创建备份目录 v{N+1}/
5. VACUUM INTO 'v{N+1}/xc-career-guide.db'
6. cp action_log.jsonl → v{N+1}/action_log.jsonl（截取到 cut_offset）
7. 写入 v{N+1}/manifest.json:
   {
     "version": N+1,
     "schema_version": "0.2.0-multi-device",
     "cut_batch_sequence": <seq>,
     "cut_jsonl_byte_offset": <offset>,
     "created_at": "<iso8601>",
     "db_sha256": "<hash>",
     "jsonl_sha256": "<hash>"
   }
8. 原子切换: ln -sfn v{N+1} current  （POSIX rename 语义）
9. 退出 BACKUP_FREEZE 模式
10. 清理旧版本（保留最近 3 个）
```

### 11.4 恢复流程

```
恢复流程（v2.0.1）：

1. 进入 BACKUP_FREEZE 模式
2. 选择目标版本 v{M}
3. 验证 manifest.json 中的 hash：
   - 计算 v{M}/xc-career-guide.db 的 SHA-256，对比 db_sha256
   - 计算 v{M}/action_log.jsonl 的 SHA-256，对比 jsonl_sha256
   - 任一不匹配 → 恢复失败，不切换
4. 复制到 staging/：
   cp v{M}/* staging/
5. 对 staging/ 执行 startupRecovery()（§1.5 of v1.2）
6. 通过一致性校验（§8.4）
7. 原子切换: ln -sfn staging current
   然后: mv staging v{N+1}
8. 退出 BACKUP_FREEZE 模式
9. 重新加载所有连接
```

### 11.5 Windows 兼容说明

Windows 不支持 POSIX 符号链接原子 rename。替代方案：

```
Windows 上的"原子切换"：
1. 写入 current.json: {"active_version": "v3", "switched_at": "..."}
2. 应用启动时读取 current.json 确定活跃目录
3. 切换时：写临时文件 → rename（Windows NTFS rename 是原子的）
```

---

## §12 验收测试补充

### 12.1 迁移验收测试

```
T-MIG-001: v0.1.12 → v0.2.0 迁移完整性
  前置：v0.1.12 schema 数据库，含 5 条 assessment_session 记录
  步骤：
    1. 执行 §1.5 迁移脚本
    2. 验证所有新增列存在且有正确默认值
    3. 验证回填逻辑：COMPLETED session → delivery_phase = FINALIZED
    4. 验证既有触发器仍然工作（UPDATE 终态 session → 触发器 ABORT）
  预期：迁移成功，既有功能无回归

T-MIG-002: 触发器保留验证
  前置：迁移后数据库
  步骤：
    1. SELECT count(*) FROM sqlite_master WHERE type='trigger' → 预期 ≥ 48 + 新增触发器数
    2. 对每个既有触发器执行违规操作，验证 RAISE(ABORT)
  预期：所有原有触发器正常工作

T-MIG-003: delivery_phase 前向保护
  前置：迁移后数据库，一条 delivery_phase = 'OFFLINE_SCORING' 的记录
  步骤：
    1. UPDATE delivery_phase = 'OBSERVATION' → 应成功
    2. UPDATE delivery_phase = 'ONLINE_IN_PROGRESS' → 应被触发器阻止
    3. UPDATE delivery_phase = 'FINALIZED' (从 OBSERVATION) → 应成功
    4. UPDATE delivery_phase = 'OBSERVATION' (从 FINALIZED) → 应被阻止
  预期：单向迁移严格执行
```

### 12.2 FK 一致性验收测试

```
T-FK-001: student_id FK 链完整性
  步骤：
    1. INSERT delegated_access_grant 引用不存在的 student_id → 应 FK 失败
    2. INSERT business_session_assignment 引用不存在的 grant_id → 应 FK 失败
    3. INSERT session_invalidation_record 引用不存在的 session_id → 应 FK 失败
  预期：所有 FK 约束生效

T-FK-002: Grant → Assignment 单向引用
  步骤：
    1. INSERT grant（无 assignment 引用）→ 应成功
    2. INSERT assignment 引用上一步的 grant_id → 应成功
    3. DELETE grant（被 assignment 引用时）→ 应 FK 失败（RESTRICT）
  预期：单向依赖关系正确

T-FK-003: student_profile.user_id 可选关联
  步骤：
    1. INSERT student_profile user_id = NULL → 应成功
    2. INSERT student_profile user_id = 'existing_user' → 应成功
    3. INSERT student_profile user_id = 'nonexistent_user' → 应 FK 失败
    4. INSERT 两条 student_profile 同一 user_id → 应 UNIQUE 失败
  预期：可选但唯一的关联约束
```

### 12.3 安全事件流程验收测试

```
T-SAFETY-001: 安全事件不产生自动 halt（验证无自动触发器）
  步骤：
    1. 创建 assessment_session（status = 'ACTIVE'）
    2. INSERT safety_incident（绑定到该 session）
    3. 检查 assessment_session.status
  预期：status 仍为 'ACTIVE'（halt 由投影器执行，不是触发器）

T-SAFETY-002: 投影器原子 halt
  步骤：
    1. 创建 assessment_session（status = 'ACTIVE'）
    2. 模拟投影器事务：BEGIN; INSERT safety_incident; UPDATE assessment_session SET status='REDLINE_HALTED'; COMMIT
    3. 验证两表都已更新
    4. 尝试 UPDATE assessment_session SET status='ACTIVE' → 应被终态触发器阻止
  预期：原子 halt 成功，终态不可逆

T-SAFETY-003: 安全事件核心事实不可变
  步骤：
    1. INSERT safety_incident
    2. UPDATE safety_incident SET trigger_event_id = 'new_value' → 应被触发器阻止
    3. UPDATE safety_incident SET student_id = 'other' → 应被触发器阻止
  预期：核心事实字段 INSERT 后不可修改
```

### 12.4 JSONL 恢复分类验收测试

```
T-JSONL-001: 领域事实表可从 JSONL 重建
  步骤：
    1. 备份当前 SQLite
    2. 删除所有领域事实表数据（DROP 表然后 recreate 空结构）
    3. 从 JSONL 完整重放所有事件
    4. 对比重放结果与备份数据
  预期：领域事实表数据完全一致

T-JSONL-002: 运维表不可从 JSONL 重建
  步骤：
    1. 删除 user_account、strategy_config 数据
    2. 从 JSONL 重放
    3. 检查这些表
  预期：表为空或仅含 JSONL 中记录的教师操作（不完整）

T-JSONL-003: 恢复后一致性校验
  步骤：
    1. 从备份恢复
    2. 运行 startupRecovery()
    3. 验证 projector_cursor.last_batch_sequence == applied_event_batch 最大 batch_sequence
    4. 验证 JSONL 文件大小 ≥ manifest.cut_jsonl_byte_offset
  预期：一致性校验通过
```

### 12.5 备份/恢复验收测试

```
T-BACKUP-001: 版本化备份创建
  步骤：
    1. 执行备份流程
    2. 验证新版本目录存在
    3. 验证 manifest.json 中 hash 正确
    4. 验证 current 指针已更新
  预期：备份成功，指针原子切换

T-BACKUP-002: 恢复后数据完整
  步骤：
    1. 写入新数据（在最新备份之后）
    2. 恢复到上一个备份版本
    3. 验证新数据不存在
    4. 验证恢复后 startupRecovery() 正常完成
    5. 验证业务操作恢复正常
  预期：恢复到精确的备份时间点

T-BACKUP-003: Hash 校验失败时拒绝恢复
  步骤：
    1. 篡改备份目录中的 .db 文件（追加一个字节）
    2. 尝试恢复
  预期：SHA-256 校验失败，恢复中止，不切换 current 指针
```

---

## §13 闭环矩阵（v2.0.1 修订后）

| # | 领域 | v2.0 状态 | v2.0.1 修订 | 修订后状态 |
|---|------|-----------|-------------|-----------|
| 1 | Schema 基线声明 | 引用简化 DDL | §0: 声明 v0.1.12 为正式基线，禁止重定义 | **CLOSED** |
| 2 | assessment_session 扩展 | CREATE TABLE 替换 | §1: ALTER TABLE 增量迁移 | **CLOSED** |
| 3 | student_id 统一 | student_user_id 混乱 | §2: FK 统一到 student_profile(student_id) | **CLOSED** |
| 4 | 安全事件双重投影 | 错误声称触发器执行 halt | §3: 明确投影器是唯一 halt 路径 | **CLOSED** |
| 5 | business_session.status | 父子状态冲突 | §4: 父表无 status 列 | **CLOSED** |
| 6 | Grant↔Assignment FK 循环 | 双向引用 | §5: 单向 FK（Assignment→Grant） | **CLOSED** |
| 7 | VOIDED 终态 | 需要修改触发器 | §6: session_invalidation_record 替代 | **CLOSED** |
| 8 | 命令不可逆点 | 未定义边界 | §7: BATCH_PREPARED fsync = 不可逆 + fencing token | **CLOSED** |
| 9 | JSONL 全表可重建声称 | 错误 | §8: 分三类（领域事实/运维/自举） | **CLOSED** |
| 10 | CA 证书 HTTPS 下载 | 信任循环 | §9: HTTP :7070 下载 CA，HTTPS :7443 仅业务 | **CLOSED** |
| 11 | 学生可见性引用已废弃文档 | 外部引用 | §10: 规则内联，含 Grant 验证 SQL | **CLOSED** |
| 12 | 备份缺乏版本管理 | 未定义切换机制 | §11: 版本化目录 + 原子指针切换 | **CLOSED** |
| 13 | 缺少迁移/FK/触发器验收测试 | 不完整 | §12: 15 个具体测试用例 | **CLOSED** |

**全部 13 项修订已 CLOSED。v2.0 + v2.0.1 共同构成 AUTHORITATIVE BASELINE。**

---

## 附录 A：完整多设备新增表 DDL 汇总

```sql
-- ============================================================
-- 多设备架构增量 DDL（v2.0.1 权威版本）
-- 基线：src/main/db/schema.sql v0.1.12
-- ============================================================

-- A1: student_profile 增量
ALTER TABLE student_profile ADD COLUMN user_id TEXT
  REFERENCES user_account(user_id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_student_profile_user_id
  ON student_profile(user_id) WHERE user_id IS NOT NULL;

-- A2: assessment_session 增量
ALTER TABLE assessment_session ADD COLUMN delivery_phase TEXT DEFAULT 'PREPARED'
  CHECK (delivery_phase IS NULL OR delivery_phase IN (
    'PREPARED','ASSIGNED','STUDENT_CONFIRMED','ONLINE_IN_PROGRESS',
    'ONLINE_COMPLETED','OFFLINE_SCORING','OBSERVATION','READY_TO_FINALIZE','FINALIZED'));
ALTER TABLE assessment_session ADD COLUMN event_sequence_version INTEGER DEFAULT 0
  CHECK (event_sequence_version IS NULL OR event_sequence_version >= 0);
ALTER TABLE assessment_session ADD COLUMN observation_template_id TEXT;
CREATE INDEX IF NOT EXISTS idx_assessment_session_delivery_phase
  ON assessment_session(delivery_phase) WHERE delivery_phase IS NOT NULL;

-- A3: command_log 增量
ALTER TABLE command_log ADD COLUMN request_hash TEXT;
ALTER TABLE command_log ADD COLUMN lease_generation INTEGER DEFAULT 0;
ALTER TABLE command_log ADD COLUMN worker_id TEXT;
ALTER TABLE command_log ADD COLUMN event_batch_id TEXT;

-- A4: 新表 — node
CREATE TABLE IF NOT EXISTS node (
  node_id TEXT PRIMARY KEY,
  node_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('SERVER', 'STUDENT_DEVICE', 'TEACHER_TABLET')),
  registered_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT
);

-- A5: 新表 — device
CREATE TABLE IF NOT EXISTS device (
  device_id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES node(node_id),
  device_name TEXT,
  platform TEXT,
  registered_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A6: 新表 — auth_session
CREATE TABLE IF NOT EXISTS auth_session (
  auth_session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_account(user_id),
  device_id TEXT NOT NULL REFERENCES device(device_id),
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'EXPIRED', 'REVOKED')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

-- A7: 新表 — delegated_access_grant
CREATE TABLE IF NOT EXISTS delegated_access_grant (
  grant_id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES student_profile(student_id),
  teacher_auth_session_id TEXT NOT NULL REFERENCES auth_session(auth_session_id),
  device_id TEXT NOT NULL REFERENCES device(device_id),
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'EXPIRED', 'REVOKED')),
  replaces_grant_id TEXT REFERENCES delegated_access_grant(grant_id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_grant_one_active_per_student_device
  ON delegated_access_grant(student_id, device_id) WHERE status = 'ACTIVE';

-- A8: 新表 — business_session
CREATE TABLE IF NOT EXISTS business_session (
  session_id TEXT PRIMARY KEY,
  session_type TEXT NOT NULL CHECK (session_type IN ('ASSESSMENT', 'TRAINING')),
  student_id TEXT NOT NULL REFERENCES student_profile(student_id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A9: 新表 — business_session_assignment
CREATE TABLE IF NOT EXISTS business_session_assignment (
  assignment_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES business_session(session_id),
  device_id TEXT NOT NULL REFERENCES device(device_id),
  grant_id TEXT NOT NULL REFERENCES delegated_access_grant(grant_id),
  assigned_by TEXT NOT NULL REFERENCES user_account(user_id),
  status TEXT NOT NULL DEFAULT 'ASSIGNED'
    CHECK (status IN ('ASSIGNED', 'ACTIVE', 'COMPLETED', 'CANCELLED')),
  assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
  activated_at TEXT,
  completed_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_assignment_one_active_per_session
  ON business_session_assignment(session_id) WHERE status IN ('ASSIGNED', 'ACTIVE');

-- A10: 新表 — session_invalidation_record
CREATE TABLE IF NOT EXISTS session_invalidation_record (
  invalidation_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES assessment_session(session_id),
  reason TEXT NOT NULL CHECK (reason IN (
    'INTEGRITY_VIOLATION','PROCEDURE_ERROR','EQUIPMENT_FAILURE','ADMIN_OVERRIDE')),
  evidence_json TEXT CHECK (evidence_json IS NULL OR json_valid(evidence_json)),
  invalidated_by TEXT NOT NULL REFERENCES user_account(user_id),
  invalidated_at TEXT NOT NULL DEFAULT (datetime('now')),
  notes TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_invalidation_per_session
  ON session_invalidation_record(session_id);

-- A11: 新表 — applied_event_batch（事件溯源基础设施）
CREATE TABLE IF NOT EXISTS applied_event_batch (
  batch_id TEXT PRIMARY KEY,
  batch_sequence INTEGER NOT NULL UNIQUE,
  event_count INTEGER NOT NULL,
  jsonl_offset_start INTEGER NOT NULL,
  jsonl_offset_end INTEGER NOT NULL,
  batch_status TEXT NOT NULL DEFAULT 'APPLIED'
    CHECK (batch_status IN ('APPLIED', 'CONFIRMED')),
  applied_at TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at TEXT
);

-- A12: 新表 — projector_cursor
CREATE TABLE IF NOT EXISTS projector_cursor (
  projector_name TEXT PRIMARY KEY,
  last_batch_id TEXT,
  last_batch_sequence INTEGER DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A13: delivery_phase 前向触发器
CREATE TRIGGER IF NOT EXISTS trg_assessment_delivery_phase_forward_only
BEFORE UPDATE OF delivery_phase ON assessment_session
FOR EACH ROW
WHEN OLD.delivery_phase IS NOT NULL AND NEW.delivery_phase IS NOT NULL
  AND OLD.delivery_phase <> NEW.delivery_phase
BEGIN
  SELECT CASE
    WHEN OLD.delivery_phase = 'FINALIZED' THEN
      RAISE(ABORT, 'delivery_phase FINALIZED is terminal')
    WHEN OLD.delivery_phase = 'READY_TO_FINALIZE' AND NEW.delivery_phase <> 'FINALIZED' THEN
      RAISE(ABORT, 'delivery_phase READY_TO_FINALIZE can only advance to FINALIZED')
    WHEN OLD.delivery_phase = 'OBSERVATION' AND NEW.delivery_phase <> 'READY_TO_FINALIZE' THEN
      RAISE(ABORT, 'delivery_phase OBSERVATION can only advance to READY_TO_FINALIZE')
    WHEN OLD.delivery_phase = 'OFFLINE_SCORING'
      AND NEW.delivery_phase NOT IN ('OBSERVATION', 'READY_TO_FINALIZE') THEN
      RAISE(ABORT, 'delivery_phase OFFLINE_SCORING can only advance to OBSERVATION or READY_TO_FINALIZE')
  END;
END;

-- A14: 新表 — schema_migration（如不存在）
CREATE TABLE IF NOT EXISTS schema_migration (
  migration_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  description TEXT,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

---

## 附录 B：本文与 v2.0 的关系

本文 (v2.0.1) 是 v2.0 的 schema 对齐硬化补丁：

- v2.0 中未被本文涉及的章节直接继承，无变更
- 当 v2.0 与 v2.0.1 内容冲突时，以 v2.0.1 为准
- v2.0.1 不引入新的架构概念，仅修补 v2.0 与正式 schema v0.1.12 的不一致
- v2.0 + v2.0.1 共同构成权威实施基线

**文档状态：**
- `architecture-plan-b-multi-device-v2.0-authoritative-baseline.md` — 总体架构（继承有效）
- `architecture-plan-b-multi-device-v2.0.1-schema-alignment.md` — Schema 对齐修订（本文）
- `architecture-review-plan-b-multi-device-v1.1.md` — **SUPERSEDED**
- `architecture-review-plan-b-multi-device-v1.2-consistency-closure.md` — **SUPERSEDED**
