# Project Invariants

本文件集中维护本项目 Vibe Coding 工作流使用的项目不变量。Skill、PRD、实现文档、Review 和 Accept 应引用稳定 ID，不复制维护完整文本。

状态标记：

- `VERIFIED`：已由当前 `AGENTS.md`、权威 PRD、`src/main/db/schema.sql`、共享类型、实现或测试证实。
- `UNVERIFIED`：安装时未能从当前仓库证实为已生效约束；执行相关任务前必须补充核验或产品/架构确认。

## 使用规则

- 每条不变量使用稳定 ID；修改语义时新增版本说明，不复用旧 ID 表达不同含义。
- 能通过 Schema、类型、lint、测试或 CI 强制的，应同步建立自动门禁。
- 发生 PRD / Schema / 代码不一致时，按 `doc/ai/vibe-workflow-contract.md` 的事实来源优先级处理，并标记 `[!]`。

## 事件与投影

### INV-EVT-001 领域状态必须由事件推进

状态：VERIFIED

`assessment_session`、`training_session` 等受控状态不得由 UI 或 renderer 直接修改；状态迁移必须由主进程领域事件、数据库触发器和对应 reducer/projection 链推进。

证据：

- `src/main/db/schema.sql` 头部基线声明 “State transitions are driven by domain events only”。
- `src/main/domain/event-writer.ts` 写入领域事件。
- `src/main/domain/assessment-reducer.ts`、`src/main/domain/training-reducer.ts` 负责业务投影。

### INV-EVT-002 事件持久化顺序唯一

状态：VERIFIED

事件写入顺序为：

```text
action_log.jsonl append → domain_event_projection persist → reducer/projector update
```

`writeEvent()` 只负责前两步；调用方必须在事件持久化后调用对应 reducer/projector 更新业务投影。

证据：

- `src/main/domain/event-writer.ts`
- `src/main/domain/assessment-reducer.ts`

### INV-EVT-003 新事件必须完成全链登记

状态：VERIFIED

新增 `EventType` 时，必须同步完成 payload type、序列化/校验、持久化、reducer/projector、回放兼容和测试登记。

证据：

- `src/shared/types/event-payloads.ts`
- `src/main/domain/event-writer.ts`
- `src/main/domain/__tests__/assessment-reducer.test.ts`
- `src/main/domain/__tests__/training-reducer.test.ts`
- `src/main/domain/__tests__/recovery.test.ts`

### INV-EVT-004 已受理命令只能产生一个确定结果

状态：VERIFIED

每个 `(client_instance_id, idempotency_key)` 只对应一个 request hash 和一个 durable `SUCCEEDED` 或 `FAILED` 结果。重放必须返回已持久化的公开结果；同 key 不同请求必须拒绝，不能覆盖历史命令或重复执行业务副作用。

证据：

- `src/main/application/command/durable-command-coordinator.ts`
- `src/main/application/command/durable-command-store.ts`
- `src/main/application/command/__tests__/durable-command-coordinator.test.ts`
- `src/main/db/schema.sql` 中 `ux_command_idempotency`

### INV-EVT-005 已准备批次只能由冻结事件恢复

状态：VERIFIED

事件批次在 durable PREPARE 后发生重启或租约交接时，恢复路径只可读取持久化的 batch/EVENT 事实并继续 APPLY 或进入只读故障状态；不得重新调用 planner、使用当前业务资料重新计算，或产生第二个 batch。

证据：

- `src/main/domain/event-batch/startup-recovery.ts`
- `src/main/domain/event-batch/batch-coordinator.ts`
- `src/main/domain/event-batch/__tests__/startup-recovery.test.ts`
- `src/main/domain/event-batch/__tests__/fault-matrix.test.ts`

### INV-EVT-006 生产 mutation 只能走 v2 批次边界

状态：VERIFIED

生产 IPC mutation 必须经过 durable command coordinator 与 v2 batch/gate executor；不得重新接入 legacy JSONL writer。为保持既有行为而保留的 legacy service 仅可在隔离的 planning clone 中作为事实来源，不能获得 production 写入能力或成为运行时 mutation writer。

证据：

- `src/main/application/runtime/application-runtime.ts`
- `src/main/application/runtime/m5b-domain-executor.ts`
- `src/main/ipc/handler-registry.ts`
- `scripts/lib/m5b-runtime-inventory.mjs`
- `scripts/__tests__/m5b-runtime-inventory.test.mjs`

## 安全红线与权限

### INV-SAFE-001 先熔断后归因

状态：VERIFIED

版本语义：v0.1.16 及以前的历史语义为同一 `student_id + task_code`；自 v0.1.17-multi-device-m4-safety-rekey 起，当前 `VERIFIED` 语义为同一 `student_id + job_code + task_code`。历史文档中的二元表述仅描述当时基线，不覆盖当前 Schema。

检测到满足红线条件的事实时，必须先阻断同一学生、同一岗位、同一任务范围内受影响的开放测评/训练会话，再进入原因补充、确认、作废、解除或事实更正流程。

证据：

- `src/main/db/schema.sql` 中 `trg_safety_incident_bind_open_assessments`
- `src/main/db/schema.sql` 中 `trg_safety_incident_bind_open_trainings`
- `src/main/ipc/handlers/__tests__/assessment-redline.test.ts`
- `src/main/ipc/handlers/__tests__/training-redline.test.ts`

### INV-SAFE-002 红线不得通过直接插入 REDLINE_HALTED 会话实现

状态：VERIFIED

版本语义：v0.1.16 及以前的历史语义为同一 `student_id + task_code`；自 v0.1.17-multi-device-m4-safety-rekey 起，当前 `VERIFIED` 语义为同一 `student_id + job_code + task_code`。历史文档中的二元表述仅描述当时基线，不覆盖当前 Schema。

`REDLINE_HALTED` 必须由安全事件触发链产生，并关联同一 `student_id + job_code + task_code` 的有效安全事件。不得直接 INSERT 为 `REDLINE_HALTED` 会话。

证据：

- `src/main/db/schema.sql` 中 `trg_assessment_session_no_insert_redline_status`
- `src/main/db/schema.sql` 中 `trg_training_session_no_insert_redline_status`
- `src/main/db/schema.sql` 中 `trg_assessment_session_redline_incident_same_student_job_task_insert`
- `src/main/db/schema.sql` 中 `trg_assessment_session_redline_incident_same_student_job_task_update`
- `src/main/db/schema.sql` 中 `trg_training_session_redline_incident_same_student_job_task_insert`
- `src/main/db/schema.sql` 中 `trg_training_session_redline_incident_same_student_job_task_update`

### INV-SAFE-003 未解决安全事件阻断新会话

状态：VERIFIED

版本语义：v0.1.16 及以前的历史语义为同一 `student_id + task_code`；自 v0.1.17-multi-device-m4-safety-rekey 起，当前 `VERIFIED` 语义为同一 `student_id + job_code + task_code`。历史文档中的二元表述仅描述当时基线，不覆盖当前 Schema。

同一学生、同一岗位、同一任务范围内仍存在 `PENDING_DETAIL` 或 `CONFIRMED` 且 `requires_review_before_next_session = 1` 的安全事件时，不得创建受规则约束的新测评或训练会话。

证据：

- `src/main/db/schema.sql` 中 `trg_assessment_session_block_unresolved_safety_incident`
- `src/main/db/schema.sql` 中 `trg_training_session_block_unresolved_safety_incident`

### INV-SAFE-004 safety_incident 生命周期受状态机约束

状态：VERIFIED

安全事件只能按批准路径迁移：`PENDING_DETAIL → CONFIRMED/VOIDED`，`CONFIRMED → RESOLVED/VOIDED`。已确认或终态安全事件的核心事实字段不得漂移。

证据：

- `src/main/db/schema.sql` 中 `trg_safety_incident_status_transition_guard`
- `src/main/db/schema.sql` 中 `trg_safety_incident_core_facts_immutable_after_confirmed`
- `src/main/db/schema.sql` 中 `trg_safety_incident_terminal_resolution_immutable`

### INV-AUTH-001 TEACHER 与 ADMIN 权限边界

状态：VERIFIED

教师可触发/确认安全事件；`RESOLVED`、`VOIDED` 等安全事件终结操作必须由 ACTIVE ADMIN 执行。新增权限敏感操作必须显式校验 caller 身份与角色。

证据：

- `src/main/db/schema.sql` 中 `trg_safety_incident_confirmed_requires_teacher`
- `src/main/db/schema.sql` 中 `trg_safety_incident_terminal_requires_admin`
- `src/main/ipc/handlers/__tests__/safety.test.ts`
- `src/main/utils/__tests__/auth-context.test.ts`

## 结果体系

### INV-RES-001 结果类型不得混算

状态：VERIFIED

以下结果保持独立计算、独立存储和独立解释：

- `ABILITY_SCORE`
- `TRAINING_COMPLETION`
- `OPERATION_PASS_RATE`
- `JOB_SKILL_SCORE`

不得合并为单一总分，除非权威 PRD 新增明确、经批准的独立综合指标及其解释规则。

证据：

- `doc/specs/MVP_PRD_v1.0.9-authoritative.md`
- `src/main/db/schema.sql` 中 `result_record.result_type`
- `src/shared/types/json-schemas.ts` 中 `ResultType`

### INV-RES-002 安全优先级高于普通评分

状态：VERIFIED

当 `safety_overridden = 1` 或来源会话为 `REDLINE_HALTED` 时，结果等级必须使用安全失败语义，不得被普通分数覆盖。

证据：

- `src/main/db/schema.sql` 中 `trg_result_record_insert_safety_override_guard`
- `src/main/db/schema.sql` 中 `trg_result_record_redline_source_insert_guard`

## Strategy 配置

### INV-STR-001 会话引用必须匹配同一配置版本

状态：VERIFIED

会话引用的 `strategy_id`、`strategy_type`、`job_code`、`strategy_version` 必须共同匹配 `strategy_config` 中同一行。

证据：

- `src/main/db/schema.sql` 中 `trg_assessment_session_strategy_config_match_insert`
- `src/main/db/schema.sql` 中 `trg_training_session_strategy_config_match_insert`
- `src/main/ipc/handlers/__tests__/strategy-create-version.test.ts`

### INV-STR-002 已被引用配置的语义不可漂移

状态：VERIFIED

被测评或训练会话引用过的 `strategy_config` 版本，不得原地修改会影响历史复现的语义字段；必须新增版本。

证据：

- `src/main/db/schema.sql` 中 `trg_strategy_config_referenced_version_semantic_immutable`

## IPC 与运行边界

### INV-IPC-001 新 IPC 必须完成白名单登记

状态：VERIFIED

所有新 IPC 通道必须在主进程 handler、preload 暴露层和 shared type 中显式登记，并进行权限、参数校验和错误映射。

证据：

- `src/shared/types/ipc-api.ts`
- `src/preload/index.ts`
- `src/main/ipc/handlers/`

### INV-IPC-002 Renderer 不得直接访问 Node

状态：VERIFIED

渲染进程不得绕过 preload 使用 `require()`、Node API、文件系统或数据库连接。

证据：

- `src/preload/index.ts` 白名单说明
- `AGENTS.md` 对 Electron IPC 的约束

## 数据质量与兼容性

### INV-DATA-001 JSON TEXT 写入前必须校验

状态：VERIFIED

写入数据库 JSON TEXT 字段前，必须按当前数据合同完成结构和语义校验。

证据：

- `src/shared/types/json-schemas.ts`
- `src/main/utils/__tests__/validate-content-json.test.ts`
- `src/main/utils/__tests__/validate-scoring-rule-json.test.ts`
- `src/main/utils/__tests__/validate-question-policy.test.ts`
- `src/main/utils/__tests__/validate-scoring-policy.test.ts`

### INV-DATA-002 不得硬编码策略数据

状态：VERIFIED

题量、阈值、比例及其他策略性参数必须来自批准的 `strategy_config` 或数据合同，不得散落硬编码于 UI 或领域逻辑。

证据：

- `AGENTS.md`
- `src/main/db/schema.sql` 头部基线声明 `strategy_config` 是评分、组卷和阈值的单一来源。

### INV-DATA-003 数据迁移必须保持可重放和兼容

状态：VERIFIED

Schema 变更必须通过当前迁移机制保持既有数据库可升级；建库、迁移、触发器和种子数据必须有验证入口。

证据：

- `src/main/db/migrations.ts`
- `src/main/db/__tests__/migrations.test.ts`
- `src/main/db/__tests__/schema-scoring-closure.test.ts`
- `src/main/db/__tests__/schema-m3-grant-assignment.test.ts`
- `npm run db:verify`

## 多设备与授权

### INV-AUTH-002 多设备授权与分配必须保持三方一致

状态：VERIFIED

业务会话、设备授权和学生分配必须保持 `student_id`、`device_id`、`business_session_id` 等关键字段一致；授权过期、重绑、释放不得破坏会话交付阶段状态机。

证据：

- `src/main/db/schema.sql` v0.1.15 patch notes
- `src/main/db/__tests__/schema-m3-grant-assignment.test.ts`
- `src/main/ipc/handlers/__tests__/assignment.test.ts`

## 安装时未完全自动证实的规则

### INV-A11Y-001 UI 可访问性必须人工验收

状态：UNVERIFIED

涉及学生端或教师端 UI 的改动，应执行视觉、键盘/触控、字号、对比度和低认知负荷检查。安装时未发现覆盖全部 UI 可访问性的自动化测试门禁。

### INV-CI-001 CI 门禁路径

状态：UNVERIFIED

安装时未发现 `.github/workflows/` 目录。合并前应以 `doc/specs/baseline.yaml` 的本地命令作为门禁，并由项目负责人确认是否存在外部 CI。
