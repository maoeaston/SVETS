# JOB_SKILL 298 全量预览持久化与权限数据合同实施计划

- 计划状态：`IMPLEMENTED / AUTOMATION_PASS_MANUAL_PENDING`；计划设计阶段的独立 R3 `/vibe-review impl` 已通过，P0/P1/P2 均为 0；实现级复核与验收记录见 `doc/features/job-skill-298-full-preview-persistence-contract-impl-code-review-r3.md`、`doc/features/job-skill-298-full-preview-persistence-contract-impl-acceptance.md` 和 `doc/features/job-skill-298-full-preview-persistence-contract-impl-independent-r3-review.md`。此前独立实现 R3 发现的 3 个 P1、以及父会话后续发现的教师读取范围、反馈 grant 过期校验、canonical source reference 校验和 sender-bound executor 三个权限问题，均已完成修复和回归验证；Gauss 当前固定状态独立增量 R3 为 `CONDITIONAL_PASS`（P0/P1/P2=0、NOTE=1），已覆盖其后的 session source namespace 与 feedback 岗位/任务 scope 修复，但未运行自动化或真实环境人工门，完整人工门仍未完成。
- 修订轮次：`2`；首轮 `BLOCKED`（P0=1，P1=3）、第二轮 `BLOCKED`（P0=0，P1=2，P2=1）后完成收口；最终审查证据见 `doc/features/job-skill-298-full-preview-persistence-contract-impl-r3-review.md`
- 风险等级：`R3`
- 适用基线：`schema v0.1.19-job-skill-preview-contract-v1`（前置基线 `v0.1.18-event-batch-v2.2`）、`doc/specs/baseline.yaml`、`doc/specs/project-invariants.md`
- 输入合同：`doc/features/job-skill-298-full-preview-persistence-contract-prd.md`
- 原产品计划：`doc/features/job-skill-298-full-preview-impl.md`，仍保持旧计划状态，不能被本计划覆盖或视为已执行
- 本文件原先描述后续实现的顺序、边界、证据和回滚方式；本轮已按 Step 0 至 Step 10 落地对应合同与验证器。原产品计划、题库内容/素材生产、正式发布和 UI 交付仍未由本文件覆盖，默认数据库也未访问或 promotion。

## 1. 目标与边界

### 1.1 目标

把已批准的数据合同转成可逐步落地的、可测试且可回滚的实现序列，最终得到以下事实：

1. `official_publish_set` 与 `preview_publish_set` 是两个独立的权威命名空间。`question_bank.status = ACTIVE`、题量、题名、`task_code`、UI 路由或文件存在都不能推导另一条来源。
2. 发布责任清单、批准、题目/资产/renderer/evidence hash、有效期、签名 principal、执行 principal 和审计引用均为不可变事实。
3. Electron sender 或同进程 CLI 只能从受信 bootstrap chain 和签名的 `user_id ↔ principal_id` 映射得到执行 principal；请求正文不能自报 principal、role 或映射。
4. `JOB_SKILL_PREVIEW_PACK_RELEASE` 通过 M5B durable command 的 `PREPARE -> APPLY -> recovery/replay` 完成，发布前后的半状态、重放冲突和并发冲突均有稳定错误码。
5. `PREVIEW_CONTRACT_V1` 的预览 session 使用独立 snapshot、projection、EventType 和完成事件；正式旧 v1/v2 `SESSION_STARTED` 只按兼容注册表解释为 `FORMAL_DEMO`。
6. `PREVIEW_ONLY` 的正常完成、作废、技术中断和红线终止均保留过程/安全事实，但不创建正式 `result_record`、正式 `task_report` 或岗位等级结果；正式 18 online + 6 offline、最大 48 分历史链保持不变。
7. feedback 正文、草稿、revision 和真实身份映射的 canonical owner 是受控 `userData` vault；SQLite 只保存非敏感引用、hash、状态和审计事实。`feedback_commit_id` 由 vault 先生成并以 exclusive-create 裁决冲突。
8. migration、旧应用、版本漂移、DB/action-log 成对备份和 vault rollback 都能 fail-closed，且不会用迁移时的 `ACTIVE` 回填任何来源。

### 1.2 不在本计划中

- 不实现 298 题内容导入、素材生产、逐题人工审核、题库策略修改、正式发布或 UI 交付；这些属于原产品计划或另一个已批准变更。
- 不新增教师自由组卷、随机组卷、学生查看完整题库、AI 批准或外部网络反馈通道。
- 不执行原产品计划 Step 2 至 Step 9，不运行默认库初始化、默认库 verifier、实际迁移、Electron 或 UI 走查。
- 不提供未经批准的 down migration；回滚使用最后一份已验证的 DB/action-log 成对备份和版本降级门禁。

## 2. 当前事实与冲突

### 2.1 实施前取证的状态快照

> 本节保留实施前输入事实，供审计追溯；实际实施后的状态以 Step 10 和本文末尾的验收记录为准，不要把历史快照中的“当前”理解为实现后的运行状态。

| 领域 | 当前事实 | 对实施的直接约束 |
|---|---|---|
| Schema | `src/main/db/schema.sql` 是 `0.1.18-event-batch-v2.2`；现有 `question_bank.status` 是全局状态，`domain_event_projection` 和 `assessment_session` 只有正式 aggregate/status 边界 | 预览不能伪装成旧 aggregate，必须有新 projection 和自己的约束 |
| M5B | `command_log`、segment、`PreparedFactRegistry`、`EventBatchCoordinator`、`StartupRecovery` 已提供 request hash、租约、PREPARE/APPLY、冻结事实和 `plannerCalls: 0` 恢复原语 | 可以复用底层协调器，但不能把现有业务 command/event 注册表当成预览合同已经完成 |
| 认证 | `auth-session.ts` 有 sender-bound ACTIVE auth session；没有可信 principal enrollment、双向唯一映射和 bootstrap trust chain | 新发布/注册/反馈修复只能接入 trusted auth snapshot，不得使用旧的软 `auth-context` 作为授权来源 |
| 正式测评 | `assessment-session-snapshot.ts` 和 `assessment-event-contract.ts` 已有正式 snapshot v2 与历史 v1 兼容；评分/报告服务默认把 `JOB_SKILL_ASSESSMENT` 当正式路径 | 必须在结果规划和安全红线分支之前识别冻结 preview contract，不能事后删除正式结果 |
| Feedback | 当前没有业务 feedback repository/vault；`DurableFileCapability` 只有路径、身份、fsync、exclusive-create、atomic replace 等物理原语 | 需要单独实现业务 vault 协议，不能把文件原语名称当作 feedback 合同 |
| IPC | 当前 handler/preload/shared API 没有 preview release、principal、session snapshot 或 feedback capability 的通道 | 新通道必须同步 command registry、handler registry、preload allowlist、shared types 和权限测试 |
| Verifier | `scripts/config/database-content-pack.json` 仍是 `0.1.17-multi-device-m4-safety-rekey`，而 baseline、schema、M5B isolated migration 已是 `0.1.18-event-batch-v2.2` | parity 未收口前不能迁移、建 preview binding 或声称 `PREVIEW_CONTRACT_V1` READY |

### 2.2 实施前必须保留的 `[!]` 冲突及处理结果

> Step 0 已收口版本/parity 冲突；其余条目是实施时必须保留的设计约束。未完成的人工验收与默认库 promotion 仍保持关闭。

1. **[!] verifier parity 冲突**：`scripts/config/database-content-pack.json` 与 `scripts/lib/database-content-pack.mjs` 当前仍按 0.1.17 ledger 验证，而 `baseline.yaml`、`schema.sql`、`src/main/db/event-batch-migration.ts` 和 M5B isolated verifier 以 0.1.18 为基线。本计划 Step 0 只规划收口方式，本轮不改配置或 migration。
2. **[!] 原产品 PRD 与本 R3 合同的范围冲突**：`doc/features/job-skill-298-full-preview-prd.md` §5.2/§8 的“本阶段不新增 Schema/migration”适用于原产品实施阶段；本数据合同的目的正是先定义新 projection、principal、feedback reference、migration 和 rollback。以本 R3 合同为准，任何 DDL/migration 都必须在本计划独立 PASS 后进入新的实现变更。
3. **[!] 原产品 PRD §6.8 的物理复用假设与本合同冲突**：原计划倾向复用旧 assessment event/projection；本合同 §6.9.1 已固定 `preview_event_projection`、`preview_session_projection` 和 `preview_session_question_projection` 的 canonical owner。后续若不能提供共享 `assessment_session_id` shell 与新 preview projection 的一对一约束，必须整体禁用 preview，而不是扩展旧正式枚举。
4. **[!] 版本权属分裂**：`src/main/db/migrations.ts` 的旧 `CURRENT_SCHEMA_VERSION`/migration chain 与独立 M5B `event-batch-migration.ts` 分开维护。后续 preview migration 必须明确由同一 parity verifier 同时核对 schema、ledger、M5B ledger 和 content pack，不能只追加一条迁移记录后宣称全库版本一致。

## 3. 目标架构与不变量

### 3.1 逻辑来源边界

| 命名空间 | canonical owner | 建立方式 | 禁止的替代推断 |
|---|---|---|---|
| `official_publish_set` | 现有正式 Phase 4/正式 release authority 的明确适配器；每个成员必须暴露 `official_source_ref`、strategy/version、18+6 精确题集、hash、scope、期限和撤销事实 | 正式 release authority 的生命周期事件/已签名 registry | 不从 preview approval、`ACTIVE`、历史 session、题量或 pack 文件补齐 |
| `preview_publish_set` | `preview_release_projection` 中的精确 source binding 和 pack/manifest/approval refs | 仅 `JOB_SKILL_PREVIEW_PACK_RELEASE` 的 PREPARE/APPLY | 不从 official binding 自动复制，也不从题库状态或策略 JSON 推断 |

两条来源即使指向同一个 `question_ref`，也必须拥有不同的 authority/scope/approval 引用。撤销只结束该来源的新 session 能力，不能删除历史 binding；来源失效不自动创建另一来源。

### 3.2 物理 projection 决策

下面的名称是本实施计划固定的物理职责；DDL 细节只能在对应步骤中落地，不得改变 canonical owner：

- `preview_contract_registry`：记录 `PREVIEW_CONTRACT_V1` 的 schema/event/projection/validator/replay/query/error/migration readiness；状态至少为 `INSTALLING`、`READY`、`DISABLED`。
- `preview_event_projection`：只接受 preview aggregate 和 preview contract version；自有 `aggregate_type` CHECK、`UNIQUE (aggregate_type, aggregate_id, event_sequence)`、event checksum、source batch/hash、replay cursor 和 contract registry reference。
- `preview_release_projection`：canonical `preview_publish_set`，保存 pack、source binding、manifest、approval、题目/资产/renderer/evidence/strategy refs、生命周期和 SOD audit refs；不可原地覆盖。
- `principal_binding_projection`：保存 enrollment/rotation、组织/安装、user/principal 双向唯一、scope、version/hash、签名和有效窗口；不改变 `user_account.role`。
- `preview_session_projection`：保存 `delivery_mode=PREVIEW_ONLY`、pack/source/strategy/snapshot/root hash、assignment/grant、安全状态和技术中断；它是 preview session 状态的唯一业务权威。
- `preview_session_question_projection`：保存每题冻结的 `question_ref`、content/scoring/asset/renderer/rubric/safety refs 和顺序；不得回查当前题库重算旧 session。
- `preview_safety_incident_projection`：保存 preview 红线的 student/job/task 三元事实和 incident 生命周期，不能经过旧安全 projector 的正式结果写入分支；安全查询可显式合并该 projection，但不能把它变成正式结果。
- `preview_feedback_reference_projection` 与 `preview_feedback_tombstone_projection`：只保存非敏感 vault reference、commit/proof hash、状态和 tombstone；正文、identity-map、draft、revision 仅在 vault。
- 共享 `assessment_session_id` 只作为现有 assignment/answer 外键所需的 identity shell。shell 的 `strategy_type/status` 不能作为 delivery mode 权威；所有正式 planner、结果、报告和安全结果写入前必须先拒绝已关联 preview projection 的 shell。
- shell 必须新增基础设施判别列 `session_contract_kind = FORMAL_SHELL | PREVIEW_SHELL`、`preview_contract_version` 和 `preview_redline_ref`；这不是业务 `delivery_mode`，业务 delivery 仍只由 preview snapshot/projection 持有。`PREVIEW_SHELL` 的 redline 允许映射到旧 `status = REDLINE_HALTED`，但 `level_result`、旧 `redline_incident_id` 和正式 safety result 必须为空，并且 `preview_redline_ref` 必须指向 preview safety projection。所有旧 redline trigger 必须改成只约束 `FORMAL_SHELL`，preview redline 只由独立 preview event/projector 驱动。
- 当前单一 `PreparedFactRegistry` 仍是唯一 dispatch point；这里的 formal/preview registry 是同一 registry 内由 descriptor 形成的封闭子集，不得新增可由调用方选择的平行 registry。它必须把 `event_type + event_payload_version + aggregate_type + contract_version + allowed_shell_kind` 作为不可变 ownership descriptor，并把 descriptor 纳入 registration key、结构 digest、`eventRegistration`、`validatePrepared`、replay 和 `assertProjected` 校验；缺失或不匹配一律 `UNKNOWN_EVENT_VERSION`/`PREPARED_CONTEXT_CONFLICT` fail-closed。`SAFETY_INCIDENT_CREATED` 的 descriptor 固定为 `FORMAL_SHELL`，其 payload validator 明确拒绝 `PREVIEW_SHELL`；preview 红线固定使用 `PREVIEW_SAFETY_INCIDENT_CREATED@1`，descriptor 固定为 `JOB_SKILL_PREVIEW_SESSION + PREVIEW_CONTRACT_V1 + PREVIEW_SHELL`，只能绑定 `preview-safety-projector.ts`。formal descriptor 子集不注册 preview event，preview descriptor 子集也不注册旧 formal projector；实现必须以注册时拒绝和 replay 时拒绝两层证明，而不能只依赖调用方传参。

### 3.3 版本与 fail-closed 规则

- 新 preview session 使用独立 `PREVIEW_SESSION_STARTED` payload 和 `PREVIEW_SESSION_COMPLETED` event；不把 preview discriminator 塞进旧 BASE_ABILITY 专用 v1/v2 payload。
- 旧正式 `SESSION_STARTED` v1/v2 只命中 legacy formal registry；未知 payload/event/aggregate/contract version、缺 validator/projector/recovery/query 或 root hash 不匹配都进入只读修复，不能 fallback 到 `JOB_SKILL_ASSESSMENT`。
- `PREVIEW_CONTRACT_V1` 只有在全部 projection、EventType、validator、projector、reducer、replay、recovery、query、error mapping、FK/unique/status 约束和 migration verifier 都已安装并通过后才是 `READY`。
- pre-migration 任何 preview command/event 返回 `PREVIEW_CONTRACT_MIGRATION_REQUIRED`；in-migration 暂停 preview mutation；post-migration 先回放/校验旧 formal，再开放 preview；旧应用只能读取 preview 为 unsupported/read-only。

## 4. 依赖图与原子实施步骤

```text
Step 0 版本/parity 门禁
  -> Step 1 canonical refs、registry、错误码和兼容表
    -> Step 2 additive Schema、projection 和 migration gate
      -> Step 3 bootstrap、principal enrollment/rotation、SOD
        -> Step 4 preview release command + M5B PREPARE/APPLY/recovery
          -> Step 5 preview session snapshot、事件、replay
            -> Step 6 formal/preview scoring、safety、result/report 分流
              -> Step 7 feedback vault 物理提交协议
                -> Step 8 feedback DB reference、reconcile、repair、tombstone/purge
                  -> Step 9 IPC/read model/ACL 边界
                    -> Step 10 R3 集成、迁移回滚、历史兼容和独立验收
```

每一步完成前必须满足：代码或文档变更只在该步骤写集内；新增测试先失败后通过；隔离 fixture 上有可复现证据；没有未登记的跨文件副作用；回滚不删除历史事件、已引用 pack、feedback revision 或 tombstone。Step 3 至 Step 9 每步都必须生成自己的可复算 registry/inventory fragment 和 digest，Step 10 只能合并并复核这些 fragment，不能把缺失登记延迟到最终手工检查。任一步的停止条件触发后，后续步骤保持未开始。

### Step 0：收口 0.1.17/0.1.18 parity 和 migration 前置门

**单一目标**：把 schema、M5B、content pack、required ledger 和 isolated verifier 统一到一个可复算的 0.1.18 版本判断，并定义 preview migration 尚未 READY 时的 fail-closed 状态。

**前置状态**：当前工作树可保留其他用户改动；不访问默认数据库，不执行真实迁移。

**计划文件与职责**：

- `scripts/config/database-content-pack.json`：更新 required ledger/schema version 的目标事实，不能继续把 0.1.17 当 current。
- `scripts/lib/database-content-pack.mjs`、`scripts/db-verify.mjs`：把 M5B ledger/structure verifier 和 content pack verifier 接到同一 parity result；普通 `db:verify` 不再单独冒充 M5B 0.1.18 证明。
- `src/main/db/event-batch-migration.ts`、`src/main/db/migrations.ts`：明确旧 migration ledger、M5B ledger 和后续 preview migration 的归属与相互校验，不改变历史 migration 语义。
- 新增 `scripts/verify-preview-contract-parity.mjs` 及 `scripts/__tests__/preview-contract-parity.test.mjs`：在显式隔离数据库 fixture 上输出 `PASS/FAIL/BLOCKED`、version、ledger digest、object digest 和未满足项。
- `doc/specs/baseline.yaml` 只在 parity 实际收口后同步；本轮不得提前改 baseline 声明。

**原子边界与副作用**：只修改 verifier/config/test contract，不写业务库、不创建 preview source、不自动 backfill `ACTIVE`。输出必须固定包含 `preview_contract: NOT_READY`，直到后续 Step 10 的全链注册完成。

**测试与证据**：

- 0.1.17 pack、0.1.18 M5B、partial ledger、unknown ledger、partial object、fresh isolated DB 各一组 fixture。
- 断言 verifier 能区分 `PARITY_REQUIRED`、`M5B_LEDGER_DRIFT`、`M5B_SCHEMA_DRIFT` 和 `PREVIEW_CONTRACT_NOT_READY`，并且不触碰默认数据。
- 未来执行：`npm test -- scripts/__tests__/database-content-pack.test.mjs scripts/__tests__/database-content-pack-migration-ledger.test.mjs scripts/__tests__/preview-contract-parity.test.mjs`。

**回滚**：只回滚 verifier/config/test 文件到最后一份已验证 pair；不使用 down migration，不删除数据库对象。

**停止条件**：任一版本来源仍各自给出不同 current、隔离 verifier 不能识别 partial ledger、需要读取默认库才能证明 parity，或 `PREVIEW_CONTRACT_V1` 被错误报告为 READY，则停止并保持所有 preview mutation 禁用。

### Step 1：canonical refs、签名合同、错误码和 legacy registry

**单一目标**：建立所有后续步骤共用的 canonical JSON/hash、引用类型、信任 registry、公开错误码和旧正式兼容表；不产生业务写入。

**计划文件与职责**：

- 新增 `src/shared/types/preview-contract.ts`：`PREVIEW_CONTRACT_V1`、delivery mode、source/pack/strategy/question/asset/renderer/evidence/approval refs、lifecycle status、audit reference 和 readiness type。
- 新增 `src/shared/types/preview-feedback.ts`：vault operation、commit/proof、reconcile、repair capability、tombstone、匿名 export reference 类型；不包含正文和真实 identity map 类型的 IPC 暴露。
- 修改 `src/shared/types/event-payloads.ts`、`src/shared/types/json-schemas.ts`：只加入经过注册的 preview payload/type，不改变旧正式 payload 的字段解释。
- 新增 `src/main/domain/preview/preview-canonical.ts`、`preview-contract-registry.ts`、`preview-errors.ts`：复用 `src/main/domain/event-batch/canonical-json.ts` 的规则，不复制第二套不兼容 canonicalizer；校验未知字段、字段顺序、数值类型、hash 前缀和时间窗口。
- 新增 `src/main/domain/authority/authority-registry.ts`、`signed-manifest-verifier.ts`、`formal-source-adapter.ts`：校验 Ed25519 trust anchor、正式 authority adapter、preview manifest/approval 和 scope；正式 adapter 不从 preview projection 读取。
- 修改 `src/main/application/command/public-error-contract.ts`：登记稳定的 migration、authority、principal、SOD、preview source、feedback collision/reconcile/capability 错误码和公开错误范围，不泄露凭据、正文或绝对路径。

**必须固定的语义**：

- canonical hash 覆盖引用的 ID、version、semantic/file/rights/renderer/policy/approval/evidence hash 和 scope；只保存文件 hash 不算绑定完成。
- `official_publish_set` 只通过 `formal-source-adapter` 查询正式 authority；`preview_publish_set` 只通过 preview release projection 查询。
- 同一 `client_instance_id + idempotency_key` 只接受一个 request hash；同 hash 返回同一 durable result，异 hash 返回 conflict。
- 旧正式 `SESSION_STARTED` v1/v2 兼容表明确 `FORMAL_DEMO`，不把缺失 delivery discriminator 的历史事件解释成 preview。

**测试与证据**：canonical round-trip/hash fixture、签名篡改/未知字段/过期/scope 扩大、formal-only/preview-only/双来源四态、旧 v1/v2 和未知版本 fail-closed；未来执行相关 `src/main/domain/preview/__tests__/preview-contract.test.ts`、`src/main/domain/authority/__tests__/signed-manifest-verifier.test.ts`。

**回滚**：删除尚未被 migration/事件引用的新纯函数和 fixture；不修改旧 registry、正式 authority 或已存在内容。

**停止条件**：canonical 规则与既有 authority hash 不一致、formal adapter 只能从 `ACTIVE` 推导来源、错误码无法区分权限/迁移/数据冲突，或旧 payload 被重新解释。

### Step 2：additive Schema、projection 约束和 `PREVIEW_CONTRACT_V1` migration gate

**单一目标**：在完成 parity 后，以 additive migration 安装第 3 节的 preview/principal/feedback projections，并让 fresh schema 与 upgraded schema 结构一致。

**目标版本**：`0.1.19-job-skill-preview-contract-v1`；migration ID 在实现提交前固定为 `2026-08-01_job_skill_preview_contract_v1`，不得在已生成 ledger 后改名。

**计划文件与职责**：

- `src/main/db/schema.sql`：加入 fresh database 的完整 DDL、CHECK、FK、唯一索引、状态触发器和 contract registry 初始 `INSTALLING` 行；不能改变旧正式表的枚举含义。
- 新增 `src/main/db/preview-contract-migration.ts`：实现 source preflight、结构 digest、expected columns/indexes/FK/trigger inventory、upgrade apply 和 target ledger 验证。
- `src/main/db/migration-startup.ts`、`src/main/db/migration-backup.ts`：接入显式 preview migration stage；在 DDL 前创建已验证的 DB/action-log pair，失败时保留 `.INCOMPLETE` 证据并进入只读，不自动继续。
- `src/main/db/event-batch-migration.ts`、`src/main/db/migrations.ts`、`scripts/lib/database-content-pack.mjs`：同步版本/ledger ownership 和 structural verifier；旧 M5B migration 仍可独立识别，不能被 preview migration 覆盖。
- `src/main/db/__tests__/preview-contract-migration.test.ts`、`migration-startup.test.ts`、`migration-backup.test.ts`、`schema-*.test.ts`：覆盖 fresh、exact v0.1.18、partial/drift、backup failure、transaction rollback、foreign key/integrity failure 和旧应用读取行为。

**结构硬约束**：

- preview projections 自有 aggregate CHECK、contract registry FK/reference、source batch/hash、cursor 和 event sequence unique；禁止插入旧 `domain_event_projection`。
- `preview_release_projection` 对 `(delivery_mode, question_ref, pack_ref, approval_ref)` 建唯一约束，source ref 不可覆盖；撤销保留历史。
- `principal_binding_projection` 对同安装/组织有效窗口内的 user/principal 双向关系建结构唯一约束，并用 validator 检查时间重叠、签名和状态。
- `preview_session_projection.assessment_session_id` 唯一；若使用现有 shell，必须有 FK/触发器证明一对一，且 preview session 的 canonical 状态只在新 projection。
- `assessment_session` 的 migration rebuild 必须安装 `session_contract_kind`、`preview_contract_version`、`preview_redline_ref` 及 formal/preview 条件 trigger：formal shell 保持现有 `REDLINE_HALTED -> LEVEL_FAIL_BY_SAFETY + safety_incident` 约束，preview shell 只允许 `REDLINE_HALTED + preview_redline_ref`，不得写 `level_result`、旧 `redline_incident_id` 或 `result_record`。
- feedback reference/tombstone 对 `(feedback_id, revision_no, operation)`、`feedback_commit_id` 和 proof hash 建唯一/冲突约束；SQLite 不能无 vault proof 自行 mint commit ID。
- 不做历史 `ACTIVE`、历史 session、result、report、旧 auth account 或旧 feedback 的 backfill。

**迁移阶段行为**：

1. parity 未通过：返回 `PREVIEW_CONTRACT_MIGRATION_REQUIRED`，不写 preview。
2. migration PREPARE/APPLY 中：写入冻结 migration facts，暂停 preview mutation；重启只能继续 frozen facts 或返回 `PREVIEW_CONTRACT_MIGRATION_RECOVERY_REQUIRED`。
3. migration 完成：先校验旧 formal replay、integrity/foreign key、ledger/object digest，再将 registry 从 `INSTALLING` 推进到待 Step 10 的 `READY`；不能在本步单独宣称 READY。
4. 旧应用/旧 schema：旧 formal 仍可读，preview aggregate 只显示 unsupported/read-only；不能降级写旧 projection。

**测试与证据**：隔离 DB 上 fresh/upgraded 结构对等、rollback 后 byte/ledger 恢复、备份 manifest hash、旧 formal replay 不变、preview command 在 pre/in migration fail-closed。未来执行：`npm test -- src/main/db/__tests__/preview-contract-migration.test.ts src/main/db/__tests__/migration-startup.test.ts src/main/db/__tests__/migration-backup.test.ts`。

**回滚**：事务内失败直接 rollback；已完成结构变更只恢复最后已验证 DB/action-log pair，运行 `integrity_check`、`foreign_key_check`、parity verifier；不执行 down migration、不删除新事件或 vault 事实。

**停止条件**：任何表/索引/触发器只能在 `schema.sql` 或 migration 单边存在、旧 formal replay 发生差异、备份不是 DB/action-log 成对可验证、或旧应用可能将 preview 解码为正式 session。

### Step 3：bootstrap trust chain、principal enrollment/rotation 与 SOD

**单一目标**：把受信安装身份和执行 principal 的来源固定为可回放的签名事实，完成注册/轮换的独立命令边界；发布命令不能顺便创建映射。

**计划文件与职责**：

- 新增 `src/main/domain/authority/bootstrap-trust-chain.ts`：按固定顺序验证 compiled trust-anchor set、installation identity certificate、PoP challenge、signed authority registry、signed enrollment package；anchor 不从 DB/userData/CLI/env 替换。
- 新增 `src/main/domain/authority/principal-binding-service.ts`：验证 `PRINCIPAL_BINDING_ENROLLMENT`、`PRINCIPAL_BINDING_ROTATION` 的签名、组织/安装、有效窗口、旧/新 mapping、撤销/替代关系和双向唯一。
- 修改 `src/main/utils/auth-session.ts`：只暴露 sender-bound trusted caller snapshot 给敏感 command；请求输入中的 `callerUserId`、role、principal 和 mapping 一律视为 hint 或拒绝，不成为授权事实。
- 新增 `src/main/application/command/preview-principal-command-definitions.ts`，并在 `src/main/application/runtime/application-runtime.ts` / `m5b-domain-executor.ts` 注册 `preview:enrollPrincipal`、`preview:rotatePrincipal` 的 command、event、result recipe 和 recovery。
- `src/main/domain/projectors/principal-binding-projector.ts`、`src/main/domain/preview/preview-replay.ts`：从 frozen event 重建映射，旧 mapping 在 rotation 生效前保持可验证但不能重叠使用。
- 相关测试：`src/main/domain/authority/__tests__/bootstrap-trust-chain.test.ts`、`src/main/domain/authority/__tests__/principal-binding.test.ts`、`src/main/application/command/__tests__/preview-principal-command.test.ts`、`src/main/domain/event-batch/__tests__/preview-principal-recovery.test.ts`。

**状态和权限规则**：

- bootstrap 任一步失败只进入只读修复，返回精确的 `INSTALLATION_TRUST_UNAVAILABLE`、`INSTALLATION_IDENTITY_INVALID`、`AUTHORITY_REGISTRY_INVALID` 或 `PRINCIPAL_ENROLLMENT_REQUIRED/INVALID`；不创建默认 mapping。
- enrollment 只能在安装/组织 provisioning context 完成；enrollment executor、signer/approver、未来 preview release executor 不得违反责任集合互斥。
- rotation 必须是独立签名替换事实；旧 mapping 进入 `SUPERSEDED/REVOKED`，新 mapping 有明确生效窗口；已 PREPARE 的发布继续使用冻结 mapping，新命令使用新 mapping。
- signer/approver 与 executor principal 相同，或与内容/安全/代码/门禁责任集合相交，发布必须返回 `PREVIEW_PACK_RELEASE_SEPARATION_OF_DUTIES_FAILED`。

**测试与证据**：anchor/证书/PoP/registry/package 替换、nonce 重用、组织错绑、重复 enrollment、rotation overlap、revoked/expired mapping、sender spoof、CLI argv/env spoof、非 ACTIVE ADMIN、signer=executor、并发注册和重启回放；所有负向路径断言 DB/event/vault 无业务写入。

**回滚**：只撤销新 mapping/capability；保留旧签名 mapping、rotation event 和审计，不把 role 恢复或改写为默认值。

**停止条件**：principal 可由请求正文/role/username 推导，anchor 可由可写目录替换，enrollment 和 release 共用同一批准，或轮换有效窗口重叠。

### Step 4：`JOB_SKILL_PREVIEW_PACK_RELEASE` 与 M5B PREPARE/APPLY/recovery

**单一目标**：把精确 preview manifest/approval/pack/source binding 作为一个封闭 durable command 写入新 preview projection，并证明 PREPARE 后不再调用 planner。

**计划文件与职责**：

- 新增 `src/main/application/command/preview-release-command-definitions.ts`：规范化输入、request hash、trusted actor、target resolver、public errors、permission、result recipe；输入不得携带有效 caller identity 或未经验证的 source state。
- 新增 `src/main/application/planners/preview-release-planner.ts`：只在 PREPARE 前读取正式/预览 authority、question/asset/renderer/evidence 和 frozen principal binding，构建 immutable event facts；DRAFT -> ACTIVE 只允许由当前批准范围精确覆盖的题目发生。
- 新增 `src/main/domain/projectors/preview-release-projector.ts`、`preview-release-validator.ts`：分别投影 `preview_event_projection` / `preview_release_projection`，禁止触碰 `domain_event_projection`、正式 strategy authority 或历史题目语义。
- 修改 `src/main/domain/event-batch/result-registry.ts`、`application-runtime.ts`、`m5b-domain-executor.ts`：注册全部 preview release EventType、payload version、validator、projector、assertProjected、operational/preApply effects、result recipe；注册完成后 seal。
- 修改 `src/main/domain/event-batch/startup-recovery.ts`、`batch-coordinator.ts` 仅在新注册事实范围内复用既有 recovery；恢复必须从 frozen EVENT/segment 读取，`plannerCalls` 固定为 0。
- 更新 `src/main/application/command/command-registry.ts` 的 expected command set、`scripts/lib/m5b-runtime-inventory.mjs`、对应 fixture/test；新 command 不能通过 legacy handler 绕过 M5B。

**固定流程**：

```text
trusted sender/CLI -> canonical request hash -> authority/principal/SOD/hash/expiry preflight
  -> PREPARE frozen manifest/approval/mapping/source/pack/event facts + fsync
  -> reload verified prepared source; planner is no longer reachable
  -> SQLite IMMEDIATE APPLY: exact DRAFT->ACTIVE + preview release projection + cursor
  -> COMMITTED/CONFIRMED + durable result
```

- 同一 `(client_instance_id, idempotency_key, request_hash)` 重放返回同一 command/result/batch；同 ID 异 hash 或 actor/binding drift 返回 conflict。
- APPLY 任一 projector、FK、unique、hash、result recipe 或权限校验失败时事务整体回滚；不留下部分 ACTIVE、半 pack、半 source 或正式 authority 变更。
- `PREVIEW_CONTRACT_V1` 未 READY 时命令只返回 `PREVIEW_CONTRACT_MIGRATION_REQUIRED`；不能以旧 schema 的成功结果冒充。

**测试与证据**：正式先/预览先/双来源四态、同/异 idempotency、并发相同/不同 key、每个签名/hash/expiry/SOD/principal failure、DRAFT/ACTIVE/DISABLED/ARCHIVED、fault injection `BEFORE_PREPARE`、`AFTER_PREPARE_FSYNC`、`BEFORE_APPLY`、`AFTER_APPLY_COMMIT`、`BEFORE_CONFIRM`、重启 recovery、replay、`plannerCalls=0`；未来执行 `src/main/domain/event-batch/__tests__/preview-release-batch.test.ts`、`preview-release-recovery.test.ts` 和 M5B inventory tests。

**回滚**：停止新 pack 分配或写新的 revoke/retire event；不删除已经发布、被 session 引用的 source/pack/event，不撤销历史 formal authority。

**停止条件**：PREPARE 后 planner 再次读 DB/current facts、命令经过旧 writer、preview event 进入旧 projection、DRAFT/ACTIVE 发生部分提交、并发重放出现两个 source binding，或 recovery 需要重新规划。

### Step 5：preview session snapshot、独立事件、projection 和 replay

**单一目标**：创建可判别、可回放、不可漂移的 `PREVIEW_ONLY` session，并把 assignment/answer/observation/safety 事实与正式 session 物理边界隔开。

**计划文件与职责**：

- 新增 `src/main/domain/preview/preview-session-snapshot.ts`：冻结 delivery mode、contract version、pack/source/manifest/approval/strategy refs、完整题目、asset/renderer/rubric/safety refs、assignment/grant、student/job/task、root hash、event/batch refs。
- 新增 `src/main/domain/preview/preview-event-contract.ts`、`preview-session-projector.ts`、`preview-session-reducer.ts`：为 `PREVIEW_SESSION_STARTED`、`PREVIEW_SESSION_COMPLETED`、`PREVIEW_SESSION_ABORTED`、`PREVIEW_SESSION_TECHNICAL_INTERRUPTION` 和固定的 `PREVIEW_SAFETY_INCIDENT_CREATED@1` 提供独立 validator/projector/reducer/assert/replay。
- 修改 `src/shared/types/event-payloads.ts`、`src/main/domain/event-batch/result-registry.ts` 和 runtime registration：完整登记 EventType、payload schema/version、aggregate、delivery discriminator、权限、persist/project/recovery/result recipe。
- `src/main/db/schema.sql`/migration 已在 Step 2 提供 `preview_session_projection`、`preview_session_question_projection` 和必要 shell link；本步只能使用这些表，不能向旧 formal projection 塞 preview 字段。
- `src/main/application/services/assessment-service.ts`、assessment planner/selection、answer/offline/observation query：创建/恢复/提交前通过 preview source binding 和冻结 snapshot 校验，不回查当前题库/策略重选题目。
- 相关测试：`src/main/domain/preview/__tests__/preview-session-snapshot.test.ts`、`preview-session-replay.test.ts`、`src/main/domain/projectors/__tests__/preview-session-projector.test.ts`、`src/main/ipc/handlers/__tests__/preview-session.test.ts`。

**shell 规则**：若现有 answer/assignment 外键必须使用 `assessment_session_id`，创建一条 `session_contract_kind = PREVIEW_SHELL` 的 identity shell；`preview_session_projection.assessment_session_id` 唯一绑定后，所有 formal planner/result/report/safety-result 写入先检查 preview link 和 shell kind。固定的 `PREVIEW_SAFETY_INCIDENT_CREATED@1` 在同一 M5B APPLY 事务内把 shell 置为 `REDLINE_HALTED`，同时写 `preview_redline_ref`；shell 的 `level_result` 与旧 `redline_incident_id` 保持 NULL，preview safety projection 保存 student/job/task 和安全生命周期。migration 必须把 `trg_assessment_session_redline_requires_fail_by_safety`、同三元 incident trigger、直接插入 redline trigger 和显式 redline path trigger 改成 formal-only 条件，并新增 preview-only 条件；旧 `safety-projector.ts` 只接受其 formal descriptor，且 registry/payload validator 必须拒绝 preview shell。若无法以这些列、FK、CHECK、trigger 和注册级 descriptor 证明两条路径，停止并禁用 preview。

**完成与中断规则**：

- `PREVIEW_SESSION_STARTED -> answers/offline/observation -> PREVIEW_SESSION_COMPLETED` 是独立链；不得发出会触发正式 result 的 `RESULT_CALCULATED`。
- asset/renderer/hash 在启动、恢复、进入题目或提交时失效，记录 `TECHNICAL_INTERRUPTION`，保留既有答案、不换题、不静默判 0 分；终态不可回开。
- preview observation 仍是观察事实，不能作为独立 scored pack 或混入正式分数。

**测试与证据**：删除/漂移当前 strategy/question/asset/authority 后按冻结 snapshot 重放；未知 contract/payload version/root hash；重复 start/answer/offline/observation/complete；assignment/grant student/device/auth 一致性；technical interruption、normal abort、redline、冷启动删除 projection 后 replay；preview projection 与旧 formal projection 互不写入。

**回滚**：停止新 preview session/assignment；历史 preview snapshot、答案、事件和安全事实只读兼容，不删除、不重新选题。

**停止条件**：preview session 缺少显式 delivery mode、恢复查询当前 policy/题库/pack、preview event 能进入 formal result chain、技术中断被当作评分失败，或 shell 可被正式 planner 当成正常 JOB_SKILL session。

### Step 6：formal/preview scoring、safety、result/report 分流

**单一目标**：在所有结果和报告规划入口前完成 delivery/contract 分流，保留正式 18+6 链，同时让 preview 红线不写正式安全结果/报告。

**计划文件与职责**：

- 修改 `src/main/application/planners/scoring-planner.ts`、`src/main/application/services/job-skill-result-service.ts`、`job-skill-report-service.ts`、`report-planner.ts`、`report-export-planner.ts`：先读取 frozen preview link/contract，再决定是否构造正式 `RESULT_CALCULATED`、`SESSION_COMPLETED`、`JOB_SKILL_SCORE` 或 report fragment。
- 修改 `src/main/domain/projectors/scoring-projector.ts`、`assessment-projector.ts`、`report-projector.ts`、`report-reducer.ts`：formal projector 对 preview aggregate/link fail-closed；preview projector 只写 preview facts。
- 修改 `src/main/application/planners/safety-planner.ts` 只保留 formal redline 目标解析；新增 `src/main/domain/projectors/preview-safety-projector.ts`、`src/main/domain/preview/preview-safety-reducer.ts`：preview redline 固定接收 `PREVIEW_SAFETY_INCIDENT_CREATED@1`，不复用当前会写 `result_record` 的旧 REDLINE projector，独立写 `preview_safety_incident_projection`、`preview_redline_ref` 和 preview binding。旧 `src/main/domain/projectors/safety-projector.ts` 的 ownership 固定为 `FORMAL_SHELL`，其 `SAFETY_INCIDENT_CREATED` validator、registry descriptor 和 projector guard 都必须拒绝 preview shell，不能加入 preview 分支。
- 修改 `src/main/domain/event-batch/result-registry.ts` 的 registration descriptor 和 `eventRegistration`/`validatePrepared` guard，并新增 `src/main/domain/event-batch/__tests__/event-ownership-registry.test.ts`：覆盖 formal event 携带 preview shell、preview event 携带 formal shell、preview event 指向 formal projector、同 event/version 多 ownership 注册和 replay 时 metadata 漂移；每种情况都必须在 projector/DB 写入前失败。
- 修改 `src/main/application/query/job-skill-scoring-query-service.ts`、`reports-query-service.ts`、`results` query：正式结果/报告查询排除 preview；预览查询只返回过程、安全和完成状态，不虚构等级。
- 保留并新增 `src/main/application/services/__tests__/job-skill-result.test.ts`、`job-skill-report.test.ts`、`src/main/application/planners/__tests__/scoring-planner.test.ts`、`preview-result-suppression.test.ts`、`src/main/domain/projectors/__tests__/preview-safety-projector.test.ts`。

**正式兼容规则**：

- `FORMAL_DEMO` 创建/恢复在同一事务视图验证 `official_publish_set`、精确 18+6、strategy/version/hash 和安全三元聚合；缺 authority 返回 `FORMAL_RELEASE_AUTHORITY_MISSING`，不降级 preview。
- 旧正式 v1/v2 event、历史 `result_record`、`task_report` 和 18+6 `/48` 结果不回写、不迁移、不由 preview source 补齐。
- `PREVIEW_ONLY` 的正常完成、abort、technical interruption 和 redline 都没有 `result_record`、正式 report event、`task_report` 或 `level_result`；redline 仍建立 preview safety facts 并阻断相应后续会话。
- safety query 可以读取 preview safety projection，但 formal result/report writer 不得读取它生成 `LEVEL_FAIL_BY_SAFETY` 正式结果。

**测试与证据**：formal regression 保持原 result/report；preview 完成的 event/batch/replay 无正式结果/报告；preview redline 只写安全事实；planner 不调用 legacy result/report service；形式/预览并发、重复命令、终态和历史 replay；任何 query/统计不把 preview 计入正式结果。

**回滚**：只关闭 preview result/report path 和新 pack 分配；不删除 preview 过程/安全 facts，不改变历史正式结果或报告。

**停止条件**：任何 preview 分支产生 `RESULT_CALCULATED`、正式 `SESSION_COMPLETED`、`result_record`、`task_report` 或正式等级，或 redline 仍通过旧安全 projector 写出正式结果。

### Step 7：feedback vault 物理协议与匿名导出核心

**单一目标**：在 `userData` 下实现仅由 vault 拥有正文/identity-map/revision 的 append-only、可恢复、可审计提交协议；不写 SQLite reference。

**计划文件与职责**：

- 新增 `src/main/domain/feedback-vault/vault-layout.ts`、`vault-manifest.ts`、`vault-journal.ts`、`vault-proof.ts`、`feedback-vault.ts`：固定 `preview-feedback/{private/identity-map, private/drafts, private/revisions, export, journal, vault-manifest.json}` 布局、format version、root hash、状态和 canonical proof。
- 新增 `src/main/domain/feedback-vault/feedback-id.ts`、`feedback-serializer.ts`、`feedback-pii-scanner.ts`、`feedback-export.ts`：feedback/session/subject export ref 使用不可推导的 CSPRNG ID；export/JSON authority/Markdown generator 只通过 allowlist，禁止真实 ID、identity map、凭据、绝对路径、原始敏感自由文本泄漏。
- 复用 `src/main/domain/event-batch/file-capability.ts` 的 path/no-symlink/exclusive-create/fsync/atomic-replace 原语；不得把 `DurableFileCapability` 自身当业务 vault。
- 新增 `src/main/domain/feedback-vault/feedback-capability.ts`：`REFERENCE_REPAIR`、`TOMBSTONE`、`PURGE`、`IDENTITY_MAP_READ` 独立 capability、组织/安装/scope/expiry/signature/SOD 校验。
- 相关测试：`src/main/domain/feedback-vault/__tests__/vault-layout.test.ts`、`vault-journal.test.ts`、`feedback-vault.test.ts`、`feedback-export.test.ts`、`feedback-capability.test.ts`，并复用现有 `file-capability.test.ts` 的 path/identity/fault fixtures。

**提交协议**：

1. vault 在 `VAULT_INTENT_PREPARED` 之前用 CSPRNG 生成 `feedback_commit_id`，对 `(feedback_id, revision_no, operation)` 和 commit ID 建立 exclusive-create journal/manifest 事实。
2. canonical proof 覆盖 commit ID、operation、feedback/revision/previous hash、session/export scope、request hash、contract version、actor/auth reference、时间窗口和 vault manifest root hash。
3. 同 commit/proof 重放返回原结果；同 commit 异 proof 返回 `FEEDBACK_COMMIT_CONFLICT`；同 feedback/revision/operation 不同 commit 返回 `FEEDBACK_REVISION_CONFLICT`；碰撞返回 `FEEDBACK_COMMIT_ID_COLLISION`，不得换 ID 伪装成新提交。
4. journal、staged body、manifest 和 directory barrier 完成后才是 `VAULT_COMMITTED`；半写文件、权限错、hash/identity drift 只读失败关闭，不导出。
5. planner/PREPARE 必须冻结 vault commit/proof；M5B PONR 后 `preApplyEffect.ensurePrepared/assertPrepared` 只能重放该 frozen fact，不能重新 mint ID 或读取当前草稿。

**生命周期**：draft -> submitted -> exported；revision append-only，导出重复使用稳定匿名引用和 hash。删除不覆盖旧 revision，另建 delete/tombstone commit。

**回滚**：只清理未提交、未引用的 staged temp；保留已提交 revision、commit、tombstone 和 manifest root。旧格式无法验证时迁移为只读隔离，不自动导入新 revision。

**停止条件**：SQLite 能先 mint commit ID、identity map 进入 export/log/prompt、vault collision 可通过换 ID 绕过、正文 hash 不在 proof、未 fsync 就报告 committed，或 repair capability 可由普通 ADMIN/teacher 自己生成。

### Step 8：feedback reference、跨边界 reconcile、repair、tombstone/purge

**单一目标**：让 vault-first/DB-first、冲突、修复和删除都能被机器识别且不暴露正文；SQLite reference 只能接受完全匹配的 vault proof。

**计划文件与职责**：

- 新增 `src/main/domain/feedback-vault/feedback-reconcile-service.ts`：实现 `VAULT_INTENT_PREPARED -> VAULT_COMMITTED -> DB_REFERENCE_COMMITTED -> RECONCILED_SUBMITTED -> EXPORTED`。
- 新增 `src/main/domain/feedback-vault/feedback-delete-service.ts`：实现 `DELETE_INTENT_PREPARED -> VAULT_TOMBSTONED -> DB_TOMBSTONE_COMMITTED -> RECONCILED_DELETED`；tombstone/purge 使用新的 delete commit ID，只引用原 submit proof，不能复用 submit commit ID。
- 新增 `src/main/domain/projectors/preview-feedback-projector.ts`、`src/main/application/query/feedback-query-service.ts`：只投影非敏感 reference/status/hash/audit；单边 reference、`ORPHAN_VAULT_COMMIT`、`ORPHAN_REFERENCE`、`RECONCILE_REQUIRED` 只读且不可 export。
- 新增 `src/main/application/command/preview-feedback-command-definitions.ts`，修改 `src/main/domain/event-batch/result-registry.ts`、runtime command definitions/executor，固定登记以下完整 EventType 集合：`PREVIEW_FEEDBACK_DRAFT_SAVED`、`PREVIEW_FEEDBACK_REFERENCE_COMMITTED`、`PREVIEW_FEEDBACK_RECONCILED`、`PREVIEW_FEEDBACK_TOMBSTONE_COMMITTED`、`PREVIEW_FEEDBACK_REPAIRED`、`PREVIEW_FEEDBACK_PURGED`、`PREVIEW_FEEDBACK_EXPORT_COMMITTED`。`feedback:saveDraft`、`feedback:submit`、`feedback:delete`、`feedback:purge`、`feedback:export` 的 frozen payload 必须分别携带 vault commit/proof 或匿名 artifact proof，并登记对应的 `FeedbackVaultDraftCommitV1`、`FeedbackVaultCommitV1` 或 `FeedbackExportCommitV1` `PreparedPreApplyEffectV1`；SQLite projector 只写非敏感 draft/reference/export audit 或 tombstone。`feedback:reconcile` 和 `feedback:repair` 也必须各自有 payload validator、capability guard、projector、reducer、recovery、query、result recipe 和 public error mapping，其中 repair 只能消费原 commit/proof，不产生正文或新 revision。禁止在 EventType 与 operational effect 之间二选一，所有 effect view 必须由 frozen EVENT 推导，所有七个 mutation 都必须进入 central M5B path。
- 修改 `src/main/db/schema.sql`/migration 在 Step 2 已规划的 feedback reference/tombstone constraints；本步不能新增未审查的任意旁路表。
- 相关测试：`src/main/domain/feedback-vault/__tests__/feedback-draft.test.ts`、`feedback-reconcile.test.ts`、`feedback-delete.test.ts`、`feedback-repair.test.ts`、`feedback-export.test.ts`、`src/main/domain/projectors/__tests__/preview-feedback-projector.test.ts`、`src/main/domain/event-batch/__tests__/feedback-recovery.test.ts`、`src/main/domain/event-batch/__tests__/feedback-event-registration.test.ts`。

**冲突与修复规则**：

- 同 proof/commit 幂等；同 commit 异 hash/proof -> `FEEDBACK_COMMIT_CONFLICT`。
- 同 feedback/revision/operation 不同 commit -> `FEEDBACK_REVISION_CONFLICT`；非法状态 -> `FEEDBACK_STATE_CONFLICT`。
- vault 先提交但 DB 失败 -> `ORPHAN_VAULT_COMMIT` / `RECONCILE_REQUIRED`；DB 先有 reference 但 vault 缺 commit -> `ORPHAN_REFERENCE` / `RECONCILE_REQUIRED`；两者都只读，不导出。
- repair 只能由独立签名 capability 绑定 organization、feedback、target commit、proof hash 执行；普通 ADMIN/teacher 角色不隐含 repair、purge 或 identity-map read 权限。
- repair request 自身以 `(repair_request_id, target_commit_id, operation)` 去重；同 hash 返回原结果，异 hash/target -> `FEEDBACK_REPAIR_CONFLICT`。

**唯一提交顺序**：submit/delete command 在 PREPARE 前调用 vault `reserveIntent` 生成或按同一 `(client_instance_id, idempotency_key, request_hash)` 恢复原 `feedback_commit_id`，然后把 commit/proof 写入 frozen EVENT；M5B PREPARE fsync 后只能执行该 EVENT 的 `FeedbackVaultCommitV1` pre-APPLY effect，不能重新 mint 或读取当前草稿。SQLite APPLY 只写同 proof 的 reference/tombstone。draft 使用同一顺序但 operation 固定为 `DRAFT_SAVE`，由 `FeedbackVaultDraftCommitV1` 只提交 vault draft 和非敏感 draft reference；export 先验证 `RECONCILED_SUBMITTED`，再把匿名 artifact proof 冻结到 `PREVIEW_FEEDBACK_EXPORT_COMMITTED`，由 `FeedbackExportCommitV1` 以 atomic publish 写 export audit，不能把正文或 identity-map 写入 event/SQLite。repair 在 PREPARE 前冻结独立 capability、原 commit/proof 和 repair request hash，`PREVIEW_FEEDBACK_REPAIRED` 只幂等补写 reference/tombstone。DB APPLY 失败时 startup recovery 重放同一个 Event；无法自动对账时只能由 `PREVIEW_FEEDBACK_RECONCILED` 使用独立 capability 修复。vault journal state、EventType、projector、reducer、recovery 和 query 的注册必须形成唯一链，不能由实现者另选组合。

**测试与证据**：vault-first/DB-first 注入故障、相同/不同 commit 并发、revision collision、submit/delete 重放、repair scope/expiry/revocation/SOD、purge 不删除审计 tombstone、export 在 reconcile-required 时拒绝、identity-map read 与普通 feedback query 隔离。

**回滚**：停止 export/repair/purge；保留 vault journal、reference、tombstone 和审计，等待同 proof 的受限 reconcile；不得物理删除孤儿以掩盖故障。

**停止条件**：任何 repair 能改变正文或重新生成 proof，reference 不校验 vault proof，删除复用 submit commit，或单边状态能被 UI 当成已提交/已删除。

### Step 9：IPC、read model 和 ACL 边界

**单一目标**：把已完成的 command/query 以显式权限和最小数据暴露给 renderer；renderer 不直接读取 DB、vault 或 identity-map。

**计划文件与职责**：

- 新增 `src/shared/types/preview-ipc.ts`、`feedback-ipc.ts`：定义 source/release/session/feedback query、mutation result 和稳定错误联合；不包含正文以外不必要的 private map 字段。
- 新增 `src/main/application/query/preview-query-service.ts`、`feedback-query-service.ts`：按 canonical projection/vault status 查询；formal/preview、teacher/admin/student、organization/device/session scope 明确分离。
- 新增 `src/main/ipc/handlers/preview.ts`、`feedback.ts`；修改 `src/main/ipc/handler-registry.ts`：登记 preview source/pack/session/principal/feedback reads，以及 release/enrollment/rotation、draft/submit/reconcile/delete/purge/repair/export commands；每个 handler 使用 sender-bound trusted auth 和 capability validator。
- 修改 `src/preload/index.ts`、`src/shared/types/ipc-api.ts`：同步 allowlist、API namespace、参数/result/error type；使用静态 import，不能把本地模块改为动态 require。
- 修改 `src/main/application/command/public-error-contract.ts`、command registry/M5B inventory：新 mutation 只能进入 central M5B path；更新 expected closed set、source digest、channel counts 和 differential fixtures。
- 不实现 renderer view/store/router；原产品 UI 计划只能在本数据合同通过后另行实施。

**IPC 权威注册清单**：新通道必须先写入唯一的 `src/main/ipc/preview-channel-definitions.ts` 与 `src/main/ipc/feedback-channel-definitions.ts` source set，再由以下文件逐一消费，禁止手工只改数量：

- mutation source：`src/main/application/command/preview-principal-command-definitions.ts`、`preview-release-command-definitions.ts`、`preview-feedback-command-definitions.ts`、`src/main/application/runtime/m5b-domain-executor.ts`、`src/main/application/command/command-registry.ts`。
- read source：`src/main/application/query/preview-read-definitions.ts`、`src/main/application/query/m5a-read-definitions.ts` 的旧 exact set 保持封闭；新 preview read 不得混入旧 formal read 的 fallback。
- IPC install：`src/main/ipc/handler-registry.ts`、`src/main/ipc/legacy-handler-collector.ts`、`src/main/ipc/handlers/preview.ts`、`src/main/ipc/handlers/feedback.ts`、`src/preload/index.ts`、`src/shared/types/ipc-api.ts` 及新增 shared IPC 类型。
- inventory/gate：`scripts/lib/m5a-command-boundary-inventory.mjs`、`scripts/lib/m5b-runtime-inventory.mjs`、`scripts/lib/m5b-contract-scope.mjs`、`scripts/check-m5b-event-batch.mjs`、`scripts/fixtures/m5b-command-runtime-inventory-v1.json`、`scripts/__tests__/m5b-runtime-inventory.test.mjs`、新增 `scripts/fixtures/preview-contract-ipc-inventory-v1.json`、新增 `scripts/__tests__/preview-contract-ipc-inventory.test.mjs` 和 `src/main/ipc/__tests__/handler-registry.test.ts`。新旧 channel 数量、source digest、read/mutation exact set、command/EventType/result/recovery mapping 和 preload allowlist 必须由同一 fixture 核对；Step 9 完成时把 fragment digest 写入 Step 10 ready evidence。

固定 source set 是闭集合（不是“至少包括”），共 17 个通道；最终数量和 digest 由 source scanner 生成，不由实现者手填：

| 通道 | 模式 | 唯一 command/query owner | EventType 或查询映射 |
|---|---|---|---|
| `preview:enrollPrincipal` | `MUTATION` | `preview-principal-command-definitions.ts` | `PRINCIPAL_BINDING_ENROLLMENT` + M5B result/recovery |
| `preview:rotatePrincipal` | `MUTATION` | `preview-principal-command-definitions.ts` | `PRINCIPAL_BINDING_ROTATION` + M5B result/recovery |
| `preview:releasePack` | `MUTATION` | `preview-release-command-definitions.ts` | `PREVIEW_PACK_RELEASED` + M5B result/recovery |
| `preview:revokePack` | `MUTATION` | `preview-release-command-definitions.ts` | `PREVIEW_PACK_REVOKED` + M5B result/recovery |
| `preview:listSources` | `READ` | `preview-read-definitions.ts` | `preview_publish_set` query only |
| `preview:getRelease` | `READ` | `preview-read-definitions.ts` | `preview_release_projection` query only |
| `preview:getSession` | `READ` | `preview-read-definitions.ts` | `preview_session_projection` query only |
| `preview:listSessionQuestions` | `READ` | `preview-read-definitions.ts` | `preview_session_question_projection` query only |
| `feedback:saveDraft` | `MUTATION` | `preview-feedback-command-definitions.ts` | `PREVIEW_FEEDBACK_DRAFT_SAVED` + `FeedbackVaultDraftCommitV1` |
| `feedback:submit` | `MUTATION` | `preview-feedback-command-definitions.ts` | `PREVIEW_FEEDBACK_REFERENCE_COMMITTED` + `FeedbackVaultCommitV1` |
| `feedback:reconcile` | `MUTATION` | `preview-feedback-command-definitions.ts` | `PREVIEW_FEEDBACK_RECONCILED` + capability/recovery |
| `feedback:delete` | `MUTATION` | `preview-feedback-command-definitions.ts` | `PREVIEW_FEEDBACK_TOMBSTONE_COMMITTED` + `FeedbackVaultCommitV1` |
| `feedback:purge` | `MUTATION` | `preview-feedback-command-definitions.ts` | `PREVIEW_FEEDBACK_PURGED` + capability/recovery |
| `feedback:repair` | `MUTATION` | `preview-feedback-command-definitions.ts` | `PREVIEW_FEEDBACK_REPAIRED` + original proof only |
| `feedback:list` | `READ` | `feedback-query-service.ts` | non-sensitive reference/status query only |
| `feedback:get` | `READ` | `feedback-query-service.ts` | scoped non-sensitive reference/status query only |
| `feedback:export` | `MUTATION` | `preview-feedback-command-definitions.ts` | `PREVIEW_FEEDBACK_EXPORT_COMMITTED` + `FeedbackExportCommitV1` |

因此 `feedback:repair` 不是隐含的管理员旁路，`feedback:saveDraft` 和 `feedback:export` 也不能走普通文件写入或 legacy handler；七个 feedback mutation 均必须有 central M5B command、EventType、payload/schema、validator、projector/effect、reducer、recovery、result recipe、public error 和 exact-set evidence。

**权限矩阵**：

- TEACHER：只读已授权目录/pack/session process facts，提交 feedback；不能 publish、enroll、rotate、repair、identity-map read、purge。
- STUDENT：只读自己的 preview session snapshot/answer/process facts；不能读取题库全量、feedback private data 或 source authority。
- ADMIN：可执行已批准 release/revoke 和有限 feedback 运维，但不能自签、自报 principal、越 scope、自动恢复 DISABLED/ARCHIVED、读取 identity map 或绕过 capability。
- provisioning/data-responsibility authority：独立签发 enrollment/rotation/repair capability；不由普通 ADMIN UI 勾选框替代。

**测试与证据**：handler matrix、sender spoof/caller field mismatch、student/device/auth mismatch、deep scope and organization mismatch、unknown channel、preload allowlist、feedback export private-data scan、unsupported migration contract；未来执行 `src/main/ipc/handlers/__tests__/preview.test.ts`、`feedback.test.ts`、`src/main/ipc/__tests__/handler-registry.test.ts`。

**回滚**：移除新通道/入口并将 preview read-only；不删除 projection/vault facts，不改变现有正式通道。

**停止条件**：renderer 可直接访问 vault/DB、caller field 改变授权结果、read model 从 UI 标签/文件存在/ACTIVE 推导状态、或 capability scope 没有独立签名验证。

### Step 10：R3 集成、历史兼容、迁移 rollback 和交付验收

**单一目标**：用独立隔离 fixture 证明合同全链闭合，并证明只有显式满足全部 digest 的隔离库才能从 `INSTALLING` 置为 `READY`，同时形成可审计的实现交付证据。

**计划文件与职责**：

- 已新增 `scripts/verify-preview-contract-ready.mjs` 及 tests：检查 Step 0 parity、Step 2 structural digest、Step 3-9 registry completeness、contract version、error map、projection/query/recovery registration 和 historical replay digest。
- 已新增/更新各领域 R3 fixture，集中于 `src/main/domain/preview/__tests__/`、`src/main/domain/event-batch/__tests__/`、`src/main/db/__tests__/`、`src/main/domain/feedback-vault/__tests__/`、`src/main/ipc/handlers/__tests__/` 和 `scripts/__tests__/`。
- 已新增 `scripts/e2e/preview-contract-native-electron.ts` 与 `scripts/verify-preview-contract-native-electron.mjs`：在显式临时 native `better-sqlite3` 数据库上构造 v0.1.18-style `assessment_session` 缺列 fixture，保留正式 session 数据和外部触发器，验证预览 migration、DB/action-log 成对备份、隔离 READY promotion、重开一致性和注入式 DDL 回滚。
- 已更新 `src/main/application/runtime/application-runtime.ts` 的 readiness gate：registry/projection/constraint/verifier 缺失时保持 `PREVIEW_CONTRACT_MIGRATION_REQUIRED` 或 `CORRUPTION_READ_ONLY`，不得部分开放。
- 已补充 bootstrap 的 DB-backed ACTIVE ADMIN resolver、持久 `preview_bootstrap_replay_projection` replay marker 及跨实例/冲突测试；IPC 学生预览读取通过 ACTIVE `student_profile.user_id -> student_id` 映射，不再直接复用 account id。`scripts/lib/m5b-runtime-inventory.mjs` 将 bootstrap 文件登记为 preview 合同源码，未改写 M5B 冻结 fixture。
- 已同步本计划状态、实现复核/验收 evidence、`.continue-here.md`、`doc/会话启动.md`、`doc/specs/baseline.yaml` 和 `doc/index.md`；文档索引自动清单仍只由 `docs:index:update` 生成。

**AC-R3 对应测试矩阵**：

| 合同验收 | 必须覆盖的行为 | 证据归属 |
|---|---|---|
| AC-R3-01/02 | official/preview 00/10/01/11、正式先/预览先、撤销/过期/hash drift、来源不可互推 | source projection + formal adapter integration |
| AC-R3-03 | manifest/approval/题目/资产/renderer/evidence/strategy/scope/期限/hash 任一变化均拒绝且零业务写入 | canonical/signature validator tests |
| AC-R3-04/05 | bootstrap 全链、principal 双向唯一、enrollment/rotation、sender/CLI spoof、signer/executor SOD | authority/principal command/replay tests |
| AC-R3-06/07 | 同/异 request hash、并发 idempotency、PREPARE/APPLY、每个 fault point、`plannerCalls=0`、恢复/重放 | M5B batch/recovery/fault matrix |
| AC-R3-08/09 | preview snapshot 完整冻结、未知 version/root drift、技术中断、assignment/grant consistency | preview session snapshot/replay tests |
| AC-R3-10/11 | preview normal/abort/redline 无 formal result/report；formal v1/v2、18+6、/48 与历史 report 不变 | scoring/report/safety differential tests |
| AC-R3-12/13 | vault layout/mode、匿名 ID、revision hash chain、正文/identity-map 不进 export/log/prompt、提交/导出故障 | feedback vault/privacy tests |
| AC-R3-14/15 | feedback collision、vault-first/DB-first orphan、same/different proof、repair capability、tombstone/purge | feedback reconcile/delete tests |
| AC-R3-16 | parity、fresh/upgraded migration、backup pair、integrity/FK、rollback、旧应用 fail-closed、无 backfill | migration/verifier/legacy tests |
| AC-R3-17 | 全部 EventType/aggregate/payload/JSON schema/validator/projector/reducer/recovery/query/error/result registration 完整 | ready gate + registry inventory |

**并发/故障/历史最低矩阵**：

- 两个进程同时发布同一 idempotency key、不同 request hash、同一 pack binding、同一 feedback revision；验证唯一约束、lease fencing 和稳定 conflict。
- 在 `BEFORE_PREPARE`、`AFTER_PREPARE_FSYNC`、`BEFORE_APPLY`、`AFTER_APPLY_COMMIT`、`BEFORE_CONFIRM`、`AFTER_COMMITTED_FSYNC`、`AFTER_SQLITE_CONFIRM`、`BEFORE_RESULT` 注入退出/写入失败；每次重启都从 frozen facts recovery，planner 调用为 0。
- 对 migration 的 backup 前、DDL 中、ledger 写入后、post-replay gate 前注入失败；只恢复最后已验证 DB/action-log pair，preview 与 vault 历史不被删除。
- 对历史正式 v1/v2 `SESSION_STARTED`、18+6 result/report、旧 safety chain 做 replay digest 对比；任何历史正式事实发生变化即阻断。

**实际执行命令**（详细结果见 `doc/features/job-skill-298-full-preview-persistence-contract-impl-acceptance.md`）：

```bash
npm run docs:index:update
npm run docs:index:check
npm run typecheck
npm run lint
npm run contract:job-skill:check
npm run contract:job-skill:delivery:check
npm run db:m5b:native:verify
npm run db:preview:native:verify
git diff --check
```

已执行对应定向测试、`npm run contract:m5b:event-batch:check`、`npm run contract:preview:ipc:check`、M5B runtime inventory、显式隔离 DB verifier、Electron ABI native M5B verifier、Electron ABI native preview migration verifier、`npm run build` 和全量 `npm test`。全量测试为 199 test files / 1597 tests，并包含 principal ACTIVE ADMIN/replay/profile scope、教师 feedback grant 过期拒绝、canonical source reference 与岗位/任务 scope 漂移拒绝、preview session formal namespace 拒绝回归及同一隔离 `userData` 根目录的 feedback vault commit/export 与 purge marker 重启恢复回归。Bootstrap replay 另以安装范围 target+nonce 唯一性拒绝跨 certificate/challenge 重用，最新 bootstrap/migration 定向组为 15/15。基础 Electron health/login/student-create/logout 冒烟已使用隔离临时 `userData` 通过；native preview verifier 已覆盖 v0.1.18-style `assessment_session` 缺列 rebuild、正式 session 数据保留和外部触发器恢复；preview 专属 UI、真实签名与 userData 人工流程、真实安装环境 upgrade/rollback 和默认 DB verifier 仍为 `NOT_RUN`；新鲜隔离库保持 `INSTALLING`，不能把隔离 promotion 写成全局 `READY`。

**回滚**：未达到 ready gate 时维持 `INSTALLING/DISABLED` 和 read-only；通过 ready gate 后的功能降级只停止新 preview release/session/export，保留所有 canonical event、snapshot、answer、feedback revision、tombstone 和审计；应用回滚必须识别 contract version，formal 旧链继续读，preview 不进入旧写路径。

**停止条件**：任一 P0/P1、任何未登记 EventType/permission/projection/query/recovery、历史 formal replay drift、migration/backup 无法恢复、vault collision 或 privacy failure、或无法证明旧应用 fail-closed。

## 5. 跨文件副作用登记

| 主变更 | 必须同步核验的边界 |
|---|---|
| parity/version | `baseline.yaml`、`schema.sql`、`migrations.ts`、`event-batch-migration.ts`、content pack、isolated verifier、ledger/object digest、docs evidence |
| source binding | canonical refs、formal adapter、preview release projection、状态/unique/FK/trigger、source query、撤销/replay、无 ACTIVE backfill |
| signed authority/principal | trust anchor、manifest/approval schema、auth sender snapshot、enrollment/rotation projection、双向 unique、SOD、错误码、rotation replay |
| new command | command definition、request hash、permission/target resolver、central registry、M5B executor、inventory/fixture、result recipe、preflight zero-write |
| new EventType/aggregate | shared union、JSON schema、payload validator、event persist、aggregate CHECK、projector、reducer、assert/replay/recovery、cursor、unknown fail-closed |
| preview session | snapshot builder/parser、shell link、question projection、assignment/grant、answer/offline/observation、technical interruption、safety, query、formal guard |
| result/report suppression | scoring planner、legacy result/report services、report fragment/export、safety projector、formal regression、query/statistics、replay |
| feedback vault | path capability、modes、journal/manifest/proof、CSPRNG ID、revision/hash chain、ACL/capability、serializer/PII scan、fault recovery |
| feedback DB bridge | reference/tombstone projection、vault-first/DB-first reconcile、commit collision authority、repair SOD、delete/purge audit、M5B effect/replay |
| IPC | shared params/results/errors、handler registry、preload allowlist、trusted auth/capability guard、channel inventory、renderer no-Node boundary |
| documentation | target plan/review artifact、`.continue-here.md`、`doc/会话启动.md`、`baseline.yaml`、`doc/index.md`; docs index generated block only via script |

任何一行未同步完成，不能把对应实施步骤标为完成。

## 6. 交付门与当前停止点

1. 计划设计阶段的独立 `/vibe-review impl` 结论保持 `PASS`；此前实现级独立 R3 复核发现 P1=3，父会话已完成对应修复和回归；Gauss 当前固定状态独立增量 R3 为 `CONDITIONAL_PASS`（P0/P1/P2=0、NOTE=1），基础 Electron 冒烟已通过，preview 专属 UI 及其余真实环境人工门仍未执行。
2. Step 0 至 Step 10 的自动化实现证据已闭合：类型检查、lint、build、全量测试、M5B event-batch 门禁、预览 IPC exact-set 门禁和隔离 readiness verifier 均已记录；本轮另补齐 migration 外键完整性、完整 session snapshot 冻结、runtime fail-closed trust context、feedback capability/scope/过期 grant 回归及同一隔离 `userData` 根目录的 vault 重启恢复回归。
3. 当前交付状态为 `AUTOMATION_PASS_MANUAL_PENDING`：基础 Electron 启动、登录、学生档案创建和退出冒烟以及 native preview migration/rollback harness 已在隔离临时环境通过；preview 专属 Electron/UI、真实签名/安装信任链、真实 userData vault、多设备业务流和真实安装环境 migration upgrade/rollback 尚未验收，因此不能宣称生产发布完成。
4. 新鲜/当前同步数据库中的 `preview_contract_registry` 仍为 `INSTALLING`；只有验收测试中的显式隔离数据库在全部 digest 匹配后被 promotion 为 `READY`，没有执行全局或默认库 promotion。

## 7. Step 10 实施与验收记录

| 步骤/门禁 | 结果 | 证据与边界 |
|---|---|---|
| Step 0 parity/config/verifier | `PASS` | `preview-contract-parity` 隔离测试、0.1.19 migration/content-pack digest；默认库未访问 |
| Step 1 canonical refs/registry/error map | `PASS` | shared contract、authority/principal、错误码和 registry 定向测试 |
| Step 2 schema/migration/projection | `PASS` | `preview-contract-migration.test.ts` 等隔离 DB 测试；fresh registry 仍 `INSTALLING` |
| Step 3–8 principal/release/session/safety/vault/feedback | `PASS` | domain、projector、replay、vault、handler 定向测试；teacher feedback 读取校验责任 assignment/grant/session/student 精确绑定及 `grant_expires_at > now`，query 重新校验 canonical source reference 与 release source id；vault 测试含同一隔离根目录的 commit/export 与 purge marker 重启恢复；未运行真实签名或真实安装 userData 流程 |
| Step 9 IPC/read model/ACL | `PASS` | `contract:preview:ipc:check`：17 channels = 6 READ + 11 MUTATION，source digest 固定 |
| Step 10 readiness/replay/compatibility | `PASS`（自动化） | `preview-contract-ready.test.mjs`：INSTALLING 失败关闭、隔离 promotion 通过、tamper 失败；`db:preview:native:verify` 另以 Electron ABI 验证 v0.1.18-style `assessment_session` 缺列重建、数据保留、外部触发器恢复、备份、重开和注入式回滚；未做真实安装环境走查 |
| 工程质量 | `PASS` | `npm run typecheck`、`npm run lint`（0 errors，663 warnings）、`npm run build`、`npm test`（199 files / 1597 tests） |
| 基础 Electron 桌面冒烟 | `PASS` | `npm run e2e:m5b:ui` 使用隔离临时 `userData` 通过 health/login/student-create/logout；不覆盖 preview 专属 UI |
| native preview migration harness | `PASS` | `npm run db:preview:native:verify`：显式 `/tmp` native DB 完成 v0.1.18-style `assessment_session` 缺列 rebuild、数据保留、外部触发器恢复、preview migration、verified DB/action-log backup、隔离 READY/reopen、DDL 故障注入回滚和 integrity/FK；不覆盖真实安装环境 |
| M5B 兼容边界 | `PASS` | `contract:m5b:event-batch:check` 目标 75 channels，M5B 领域 36、gate-only 10 |
| M5B scope check | `BLOCKED` | dirty worktree 含本任务与既有用户改动，scope checker 无法作单一提交范围判断；不作为 preview 功能失败依据 |
| 修复后独立增量 R3 review | `CONDITIONAL_PASS` | Gauss 独立核验 canonical scope、学生 source namespace、session/feedback 岗位任务绑定、过期 grant、sender-bound IPC、executor SOD 和 plannerCalls=0；未运行自动化、migration 或真实环境人工门 |

本记录的自动化 `PASS` 和修复后独立 R3 `CONDITIONAL_PASS` 均不等于操作上线批准。完成剩余真实安装环境人工验收、migration upgrade/rollback 并取得明确发布批准前，`PREVIEW_CONTRACT_V1` 继续保持 fail-closed。
