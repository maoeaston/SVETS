# JOB_SKILL 298 题全量预览持久化与权限数据合同 Mini-PRD

## 1. 文档状态

- 状态：APPROVED（最终独立 R3 `/vibe-review` PASS；仅批准进入下一步 `/vibe-impl`，不表示已实现）
- 风险等级：R3
- 功能边界：只定义 JOB_SKILL 298 题全量预览的持久化、权限、恢复和隐私数据合同；不实施 Schema、migration、事件、IPC、文件仓储或 UI。
- 目标里程碑：解除原实施计划 Step 2-9 的数据合同阻断；PASS 只表示下一会话可以执行 `/vibe-impl`。
- 本文不是运行时实现、Schema 草案或迁移脚本，也不把任何目标状态写成当前已实现事实。
- 本轮实际写入范围：仅新增本文件。既有 dirty 工作树、原 Mini-PRD、原实施计划、Schema 和运行时代码均不改。

### 1.1 权威依据与证据边界

按事实来源优先级，本 Mini-PRD 直接依据：

- `doc/specs/baseline.yaml`：当前 Schema `v0.1.18-event-batch-v2.2`、权威 PRD、项目不变量和本地验证命令入口。
- `doc/specs/project-invariants.md`：`INV-EVT-001/002/003/004/005/006`、`INV-AUTH-001/002`、`INV-RES-001/002`、`INV-STR-001/002`、`INV-IPC-001/002`、`INV-DATA-001/002/003`、`INV-A11Y-001`。
- `doc/ai/vibe-workflow-contract.md`：事实来源、R3 分级、跨文件副作用、证据、Reviewer 独立性和停止条件。
- `doc/specs/MVP_PRD_v1.0.9-authoritative.md`（正文 v1.0.10）：§5.3.13-5.3.14.1、§5.4.5、§5.8.5、§6、§17.11-17.12、§18.2。
- `doc/features/job-skill-298-full-preview-prd.md`：已批准的产品范围、正式 18+6 与 PREVIEW_ONLY 语义、AC-19/20 和原有实现边界。
- `doc/features/job-skill-298-full-preview-impl.md`：原 Step 1 停止门和 Step 2-9 的依赖关系；该计划仍保持 BLOCKED。
- `doc/features/job-skill-298-full-preview-step1-persistence-feasibility.md`、其独立 R3 review 和 acceptance：当前已登记结构不足的可复算证据。
- `doc/features/job-skill-shelver-current-contracts.md`：当前题库/素材只读入口和禁止把 `ACTIVE` 当作双发布授权的规则。
- `src/main/db/schema.sql`：当前唯一 DDL 来源；头部声明 v0.1.18，`question_bank.status`、`strategy_config`、`assessment_session`、`domain_event_projection`、`command_log` 和现有约束分别见约第 90-505、520-740、2400-2543 行。
- `src/main/utils/auth-session.ts`：Electron sender 绑定和 ACTIVE、未过期 `auth_session` 的可信 `user_id` 解析边界。
- `src/main/domain/event-batch/file-capability.ts`：现有路径、0600/0700、exclusive create、fsync、文件 identity 和 atomic replace 原语。
- `src/main/db/migrations.ts`、`src/main/db/migration-startup.ts`、`src/main/db/migration-backup.ts`：当前 migration、备份、完整性检查和失败关闭边界。

### 1.2 当前事实与显式冲突

- 当前已有 M5B durable command/event-batch 能力可证明已登记命令的幂等、PREPARE/APPLY 和重启恢复，但没有 `JOB_SKILL_PREVIEW_PACK_RELEASE` 的命令、业务 payload、发布来源 read model、principal 映射、PREVIEW session 判别或反馈仓储合同。`EXISTING_STRUCTURE_INSUFFICIENT` 不是“已决定必须新增 SQL 表”，而是“当前登记业务合同不足”。
- `question_bank.status = ACTIVE` 只表示题目可被某条既有运行链使用，不是 `official_publish_set` 或 `preview_publish_set` 的权威来源。正式先发布和预览先发布必须能在持久化事实上区分，并对另一条路径失败关闭。
- [!] `scripts/config/database-content-pack.json` 的 `schemaVersion` 和 required migration ledger 仍止于 `0.1.17-multi-device-m4-safety-rekey`，而 `doc/specs/baseline.yaml`、`src/main/db/schema.sql` 和 M5B isolated verifier 已将当前工程基线定为 `0.1.18-event-batch-v2.2`。本 Mini-PRD 不修改该配置；它把版本对齐列为进入迁移实现前的硬门禁。普通 `npm run db:verify` 在该漂移未收口前不能单独证明当前 0.1.18 ledger 已验证。
- [!] 原 Mini-PRD §5.2/§8 的“本阶段不新增 Schema/migration”仍适用于原 298 题预览产品实施阶段；本独立 R3 功能的目的正是先定义是否需要、需要哪些和如何回滚的持久化合同。任何实际 Schema/migration 写入都必须在本文独立审查 PASS 后进入新的 `/vibe-impl`，并按单独 R3 变更门禁执行。

## 2. 问题与目标

### 2.1 当前行为

1. `question_bank` 只有一个全局 `status`，`strategy_config.question_policy_json` 是可校验的策略 JSON，但当前没有两个独立发布来源的可查询关系、来源状态或唯一性约束。
2. `user_account`、`auth_session` 和现有 `CommandActor` 能提供 sender-bound ACTIVE 用户，但没有可信、双向唯一的 `user_account.user_id ↔ principal_id` 业务映射，也没有发布批准人与执行人的持久职责分离事实。
3. `command_log` 和 M5B segment 可以为已登记命令保存 request hash、actor、auth、batch 和结果，但没有预览发布的规范化输入、批准/hash 语义、冻结事件或业务 read model。
4. `assessment_session` 没有 `delivery_mode`、题包、来源或冻结 root hash 字段；旧正式 session/event 解析合同不等同于 PREVIEW_ONLY session 合同。当前 JOB_SKILL 完成链会进入正式结果/报告规划路径。
5. 当前没有反馈 repository。`DurableFileCapability` 只提供物理文件安全原语，不自动提供匿名映射、草稿/revision、访问权限、删除责任或导出防泄漏合同。

### 2.2 用户问题

学校需要看到完整 298 题并按逐题题包反馈，但系统必须同时保证：教师全库可见不等于学生可作答；正式 18+6 与 PREVIEW_ONLY 不串线；发布批准和执行身份可审计；异常退出、重放、回放和迁移不会产生半发布状态、权限越权或隐私泄漏。

### 2.3 目标行为

本 R3 功能为下列事实定义一个可查询、可验证、可恢复、可删除且不依赖调用方自报的合同：

1. `official_publish_set` 和 `preview_publish_set` 是两个独立的逻辑权威来源；同一题目语义版本可以同时拥有两条来源，但任何一条来源都不能推导或替代另一条。
2. 每个发布包都绑定责任清单、批准、签发人/批准人、执行人、`principal_id`、精确题目/资产/renderer/evidence hash、scope、期限和不可变 audit reference。
3. ACTIVE ADMIN 的执行主体由 Electron sender 绑定或独立 CLI 交互认证得到 `user_id`，再由已签名、双向唯一、有效期受控的 `user_id ↔ principal_id` 映射机械确定。
4. `JOB_SKILL_PREVIEW_PACK_RELEASE` 具备规范化输入、幂等键、PREPARE/APPLY、崩溃恢复、回放和失败关闭语义；不能靠把任意字段塞进 JSON 或日志来替代业务合同。
5. PREVIEW session 冻结 `delivery_mode`、题包/来源/hash 和结果抑制判别；正式旧 18+6 路径继续按原策略生成 `/48` `JOB_SKILL_SCORE` 与正式报告。
6. 学校反馈只在受控本地 userData 保存真实 ID 映射、草稿和完整 revision；外部 HTML/JSON/Markdown 只携带随机不可逆推匿名引用和允许的结构化字段。
7. 迁移、回滚、历史兼容和 verifier 版本漂移都有硬门禁、可复算 AC 和停止条件。

### 2.4 成功定义

- 后续实现可以从权威记录机械重算“某题是否属于正式/预览发布集、依据哪份批准、谁负责、谁执行、依据哪些 hash、是否仍有效”。
- 同一发布命令在相同 idempotency key/hash 下只产生一个 durable 结果；不同 hash、身份或来源漂移均拒绝且无部分写入。
- 重启和 replay 只依赖已冻结的 PREPARE/EVENT/反馈 vault commit facts，不重新使用当前题库、策略、身份请求或 UI 状态规划。
- PREVIEW_ONLY 的正常完成、作废、资产中断和红线终止都不会创建 `result_record` 或正式 `task_report`；正式 18+6 历史数据不被回写。
- 反馈查询、删除和外发都能说明“谁可访问、删除什么、保留什么、为什么不泄漏真实 ID”。

## 3. 角色与权限

| 主体 | 可做 | 不可做 | 认证/审计事实 |
|---|---|---|---|
| `STUDENT` | 读取自己被分配的已冻结 PREVIEW session 和作答过程 | 浏览全库、答案/rubric、批准、真实反馈映射；导出正式结论 | 既有 assignment/grant 和 session snapshot；不参与发布 |
| `TEACHER` | 浏览 298 题目录；分配已发布题包；录入线下评分/观察；创建和编辑自己负责的反馈草稿 | 发布/激活题包；修改批准、策略、题目或历史 revision；读取其他学校的映射 | 当前 sender-bound auth session；反馈访问按学校/责任范围过滤 |
| `ADMIN` | 在目标库执行已签名、范围精确的发布/停用、反馈保留和删除运维 | 自签批准、自报 principal、扩大 scope、恢复 DISABLED/ARCHIVED 题、删除历史事件 | Electron sender 的 ACTIVE auth session 或 CLI 本进程交互认证；执行 user/principal 和命令结果持久审计 |
| 产品负责人信任根 | 签署责任/批准/生命周期信封的信任根，不是应用登录角色 | 通过请求正文、环境变量或目标库替换信任根 | 安装版固定信任根和 key fingerprint；私钥不进仓库、应用、DB 或题包 |
| 批准/责任主体 | 对明确 scope 和 hash 负责 | 与实际执行主体重合；使用姓名、勾选框、Markdown 或未签名 JSON 授权 | 稳定 `principal_id`、签名 payload hash、角色集合和时间范围 |
| 学校数据责任人/本地管理员 | 决定反馈保留、删除、外发和本地 userData 访问范围 | 以反馈提交改变题目、批准、策略或 session 事实 | 删除/导出/外发操作留下不含正文和真实映射的审计 tombstone |

### 3.1 职责分离合同

每份 `responsibility_manifest` 必须列出以下稳定主体集合：产品负责人/信任根、内容或答案/rubric 责任、专业/安全审核、renderer/资产责任、门禁生成、批准签发、计划执行、实际执行。至少满足：

- `approval_signer_principal_id != executor_principal_id`；
- 责任清单声明的执行 principal、实际认证 user 映射得到的 executor principal 和批准 scope 完全相同；
- 需要独立批准时，批准人不得与产品负责人、被批准版本内容/代码/门禁责任集合或实际执行人重合；
- 任何集合缺失、重复、相交、签名无效、hash/版本漂移或过期均失败关闭；ADMIN 不能用参数覆盖这些事实。

## 4. 范围

### 4.1 本次包含

1. 两个独立发布集合的逻辑数据合同、来源绑定、状态、唯一性、查询和授权边界。
2. 责任清单、批准、信任根、签发人/批准人、执行人、principal 映射、scope/期限/hash 的不可变关系。
3. `JOB_SKILL_PREVIEW_PACK_RELEASE` 的规范化业务输入、幂等、PREPARE/APPLY、崩溃恢复、回放和 public error 语义。
4. PREVIEW session 的冻结 payload 判别、`PREVIEW_SESSION_COMPLETED` 事件边界、结果/报告抑制和正式旧链兼容。
5. 受控 userData feedback vault 的身份映射、draft、revision、查询、导出、删除、保留和防泄漏合同。
6. 四类候选架构比较、可复算评分矩阵、推荐组合边界和后续 `/vibe-impl` 的跨文件副作用登记。
7. additive migration 的前置条件、历史数据处理、不降级 rollback、verifier 0.1.17/0.1.18 漂移门禁和可机械 AC。

### 4.2 明确不包含

- 不修改 `src/main/db/schema.sql`、`src/main/db/migrations.ts`、migration backup、触发器或种子。
- 不创建或注册新的 EventType、command、projector、IPC channel、shared type、repository 或文件目录。
- 不实现 298 题导入、题包发布、PREVIEW session、反馈 UI、HTML/JSON/Markdown、签名验证或 CLI。
- 不访问、初始化、同步、修复或修改默认 `xc-career-guide.db`；任何未来 SQLite 证据必须指向显式 `/tmp` 隔离库。
- 不修改题目、素材、策略、审核结果、发布状态、历史 session/result/report。
- 不恢复原实施计划 Step 2-9，不运行 `/vibe-impl`，不做正式全量评分或新增正式结果类型。

## 5. 影响域与风险分级

| 影响域 | YES/NO | 证据与本 R3 边界 |
|---|---|---|
| UI / UX | YES（合同影响） | 反馈导出和教师目录的可见性/错误语义受数据合同约束；本轮不做 UI |
| Domain model | YES | 发布集合、责任、principal、题包、session delivery mode、feedback revision 生命周期 |
| Database / migration | YES | 当前 Schema 缺少多项权威事实；只定义 additive/rollback 合同，不改 DDL |
| Event / projection | YES | M5B 可复用，但需新增封闭命令/EventType/projector/read model 的全链登记 |
| IPC / API | YES（合同影响） | ADMIN/TEACHER 查询与执行身份必须通过白名单/可信上下文；本轮不改 IPC |
| Authentication / authorization | YES | sender/CLI auth、signed mapping、scope、职责分离、反馈 ACL |
| Safety / FSM / concurrency | YES | 正式/PREVIEW 同一三元安全边界、开放态唯一性、原子发布、故障恢复 |
| Result / report | YES | PREVIEW 必须在正式 result/report 计划前分流；正式 18+6 保持原链 |
| Accessibility | YES（后续验收） | 目录/反馈操作需保留既有人工可访问性门禁；本轮不实现 |
| Privacy / audit | YES | 匿名引用、真实映射、日志/Prompt/导出排除、删除责任和 audit tombstone |
| Backward compatibility | YES | 旧正式 18+6、v1/v2 payload、历史事件/result/report 不回写 |
| Deployment / rollback | YES | v0.1.18 precondition、additive migration、backup/restore、vault format rollback |

## 6. 核心数据合同

本节描述逻辑事实和必须可验证的关系；表名、列名、EventType payload 的最终物理落点留给独立 `/vibe-impl`，但不得弱化下列语义。

### 6.1 规范化标识与不可变 hash

每个业务版本使用以下独立标识：

- `question_ref = (question_id, version, semantic_hash)`；`semantic_hash` 覆盖题干、选项/交互、答案或 rubric、用途、模块和施测语义。
- `asset_ref = (asset_id, asset_version, file_hash, rights_hash)`；文件完整性与商用许可不能只看 `asset_resource.status`。
- `renderer_ref = (renderer_id, renderer_version, renderer_hash)`。
- `pack_ref = (pack_id, pack_version, pack_hash)`；`strategy_ref = (strategy_id, strategy_version, policy_hash, scoring_policy_hash)`。
- `evidence_ref` 覆盖内容、答案/rubric、专业/安全、renderer、资产和门禁结果的稳定 ID/hash。
- `approval_ref = (approval_id, approval_version, approval_hash, signer_principal_id)`；责任清单有独立 `manifest_id/version/hash`。

所有 hash 采用固定 canonical JSON/UTF-8 字节规则；验签前先规范化，签名后不接受字段顺序、空白、数值类型或未知字段漂移。只存某个文件的 hash 不能替代其对应版本、范围和责任主体关系。

### 6.2 `official_publish_set` 与 `preview_publish_set`

这两个名称是持久化数据合同中的两个独立逻辑命名空间，不是同一个 `ACTIVE` 布尔值的别名。

#### 6.2.1 `official_publish_set`（正式来源）

- 权威来源是经过验证的正式 Phase 4/正式发布 authority registry 或等价正式 release authority；其精确记录绑定正式 strategy/version、固定 18+6 题、资产/renderer/hash、正式批准 ID/hash、scope 和有效期/撤销事实。
- 该集合的成员关系必须能查询 `question_ref -> official_source_ref`，并且只能由正式发布命令/生命周期事件建立或撤销；不能由 `question_bank.status = ACTIVE`、预览批准、题量、名称、task_code 或历史 session 推导。
- `FORMAL_DEMO` 创建/恢复 session 时，在同一事务视图中复验当前正式来源。缺失、过期、hash 漂移、scope 不符或题目不属于当前 strategy 的精确正式集时返回 `FORMAL_RELEASE_AUTHORITY_MISSING` 或对应稳定错误，不得降级为预览来源。

#### 6.2.2 `preview_publish_set`（预览来源）

- 权威来源是精确绑定当前题包的 `JOB_SKILL_PREVIEW_ONLY` responsibility manifest、preview approval 和已发布 pack binding；成员关系绑定每个 `question_ref`、`asset_ref`、`renderer_ref`、`evidence_ref` 和 `strategy_ref`。
- 该集合的成员关系必须能查询 `question_ref -> preview_source_ref -> pack_ref/approval_ref/manifest_ref`，并且只能由预览发布命令写入；正式来源不能自动创建预览成员，预览来源不能自动创建正式成员。
- DRAFT 题只能在该单一原子发布命令中转为 ACTIVE 并成为预览集合成员；已由正式来源或其他有效来源 ACTIVE 的同语义版本只增加预览集合 binding，不重写题目状态。
- `PREVIEW_ONLY` 创建/恢复 session 时复验当前 preview binding、题包、批准、责任清单和所有 hash。缺失或漂移返回 `PREVIEW_RELEASE_AUTHORITY_MISSING`，不得仅凭共享 ACTIVE 放行。

#### 6.2.3 发布集合 binding 的最小字段

逻辑记录至少包含：

```text
source_ref_id
delivery_mode                 FORMAL_DEMO | PREVIEW_ONLY
question_id/version/semantic_hash
pack_id/version/pack_hash
strategy_id/version/policy_hash
authority_id/authority_hash
responsibility_manifest_id/manifest_hash
approval_id/approval_hash
status                        ACTIVE | REVOKED | SUPERSEDED
effective_at/expires_at/revoked_at
created_event_id/aggregate_sequence
```

必须有以下约束：同一 `source_ref_id` 不可覆盖；同一 `(delivery_mode, question_ref, pack_ref, approval_ref)` 不得重复；`FORMAL_DEMO` 与 `PREVIEW_ONLY` binding 即使指向相同 question_ref 也必须有不同 authority/scope；撤销不删除历史 binding，新的 session 只允许有效 binding。

### 6.3 责任清单、批准、hash 与职责分离

#### 6.3.1 responsibility manifest

责任清单是不可变、可签名、可回放的责任事实，至少绑定：

- `pack_ref`、`delivery_mode = PREVIEW_ONLY`、`job_code = SUPERMARKET_SHELVER`；
- 题目全集及每个 `question_ref`；资产、renderer、内容/答案/rubric/专业/安全审核和门禁 `evidence_ref`；
- 产品负责人/信任根、内容、专业/安全、renderer/资产、代码、门禁、批准和计划执行的 `principal_id` 集合；
- 计划执行的 `user_account.user_id ↔ principal_id` 映射版本/hash；
- 发布 scope、issued/effective/expires、canonical payload hash、签名 key ID/fingerprint；
- 撤销/替代关系只作为新生命周期事实，不原地修改旧 manifest。

#### 6.3.2 approval

预览批准必须是独立不可变记录，至少绑定：

- `approval_id/version/hash`、signer/approver `principal_id` 和批准 authority registry；
- `manifest_ref` 及其 hash、精确 pack/strategy/question/asset/renderer/evidence hash；
- `scope = JOB_SKILL_PREVIEW_ONLY`、issued/effective/expires；期限满足 `issued_at <= effective_at < expires_at` 且最长 30 天；
- 允许的行为集合：必要的 DRAFT→ACTIVE、预览 source binding、pack publish；不含正式 18+6、JOB_SKILL_SCORE、其他题目/版本或后续 pack；
- 签名算法、key ID、payload SHA-256、签名值和验证器版本。

#### 6.3.3 签名与执行边界

- 安装版固定产品负责人 Ed25519 trust anchor 验证 manifest/approval，不从待验文件、目标 DB、CLI 参数、环境变量或 ADMIN 输入接受替代根。
- Electron 执行人只能由当前 sender 绑定且仍 ACTIVE、未过期的 `auth_session` 解析；请求正文中的 `callerUserId`、role、principal 或映射永远不具授权效力。
- CLI 执行人必须在目标库交互验证 ACTIVE ADMIN，凭据不得出现在 argv、环境变量、批准包或日志；只在本次进程建立认证上下文。
- 验证器必须比较签名、scope、期限、题目/资产/renderer/evidence hash、执行身份和职责集合，并在任何失败时返回稳定错误且不写业务事实。

### 6.4 `user_account.user_id ↔ principal_id` 唯一可信映射

#### 6.4.1 权威映射事实

逻辑 `principal_binding` 记录至少包含：

```text
mapping_id
target_installation_id / organization_id
user_id
principal_id
mapping_version / mapping_hash
issued_by_trust_root / key_id / signature
effective_at / expires_at / revoked_at
status                        ACTIVE | REVOKED | SUPERSEDED
source_manifest_id/hash
```

规则：

1. 同一目标安装/组织在同一有效时间窗口内，一个 `user_id` 至多一个 ACTIVE principal，一个 `principal_id` 至多一个 ACTIVE user；双向唯一必须由结构约束和 validator 同时保证。
2. mapping 只能来自已验签责任清单/authority registry 的预注册关系；不能由请求正文、用户名、display name、role、环境变量、CLI `--user-id/--role` 或 ADMIN 勾选框生成。
3. 映射变更采用新 version + supersede/revoke 事实，不覆盖旧 hash；有效期区间不能重叠，回放时使用事件中冻结的 mapping version/hash。
4. `user_id` 解析后还必须由当前 `user_account.role = ADMIN`、`status = ACTIVE` 和当前 auth session 有效性复验；principal 映射本身不能把 TEACHER 升级为 ADMIN。
5. 缺失、多值、反向重复、签名/key/hash 不匹配、过期/撤销、组织范围不符或 manifest scope 不符均失败关闭。

#### 6.4.2 执行身份确定顺序

```text
Electron sender / CLI trusted auth context
  -> ACTIVE ADMIN user_id
  -> signed principal_binding exact lookup
  -> manifest executor principal + scope comparison
  -> signer/executor and responsibility-set disjointness
  -> canonical command input and PREPARE
```

任何一步失败都不能通过“用户输入了正确 principal”补救。命令日志可以保存脱敏的 `user_id`/principal/hash reference 和审计结果，但不能保存凭据。

#### 6.4.3 初始注册、撤销与轮换

`principal_binding` 不能依赖“已有 mapping”自举，也不能由第一次发布命令顺便创建。为闭合首次安装和 principal 轮换，增加两个独立的受信事实类型：

- `PRINCIPAL_BINDING_ENROLLMENT` 是安装/组织配置阶段的签名注册包，至少绑定 `target_installation_id`、`organization_id`、已存在的 `user_id`、`principal_id`、角色/责任 scope、mapping version/hash、issued/effective/expires、签发 trust root、签名 key ID、签名值和 enrollment package hash。它只能由固定 trust anchor 签发的 provisioning authority 接受；不能由目标 ADMIN、CLI 参数、环境变量、用户名或普通发布 approval 代替。
- `PRINCIPAL_BINDING_ROTATION` 是签名的替换事实，必须同时绑定旧 `mapping_id/hash`、新 user/principal pair、reason、effective window、撤销/替代关系和独立批准。轮换提交在一个逻辑原子边界内把旧 binding 标记 `SUPERSEDED` 或 `REVOKED`、激活新 binding，并写入新的 mapping version/hash；有效区间不得重叠。已进入 PREPARE 的发布命令继续使用其冻结 mapping，新的命令只使用生效后的新 mapping。

注册和轮换的执行边界如下：

1. 首次 enrollment 只允许在安装/组织 provisioning session 中执行；该 session 必须证明目标安装身份、`user_account` 已由受信账户 provisioning 建立且目标用户为 ACTIVE ADMIN。它不是发布命令，也不能在同一调用中激活题目、source、pack、strategy 或 session。provisioning executor 不能同时是 enrollment signer/approver，且不能直接成为发布 approval 的唯一批准人。
2. 常规 ADMIN 没有自注册权。若没有有效 mapping，发布命令固定返回 `PRINCIPAL_ENROLLMENT_REQUIRED`；若 enrollment package、trust anchor、用户状态、scope、hash 或职责集合不合法，返回 `PRINCIPAL_ENROLLMENT_INVALID`，不写 mapping 或业务事实。
3. 非紧急轮换必须先有独立签发的 rotation package；旧 mapping 在新 mapping 生效前保持可验证但不能与新 mapping 重叠。紧急撤销可以立即阻断旧 principal，但在新 mapping 生效前所有依赖该 principal 的发布操作返回 `PRINCIPAL_MAPPING_REVOKED`，不得降级为用户名或角色授权。
4. 重放以 `(mapping_id, mapping_version, mapping_hash)` 和 enrollment/rotation idempotency key 去重；同 hash 返回原结果，异 hash、旧 mapping 缺失、反向重复或生效窗口冲突返回 `PRINCIPAL_MAPPING_ROTATION_CONFLICT`，不覆盖历史。
5. key rotation 只通过新 trust-root/authority registry 版本和新签名事实发生；旧 key 的撤销、替代和生效时间必须可回放。任何无法验证 bootstrap chain 的安装都进入只读修复，不创建默认 mapping。

因此，首次注册、重复注册、撤销后发布和 key rotation 都是后续实现必须登记的独立 command/EventType、validator、projector、recovery 和 public error 链；本阶段只定义合同，不实现入口。

#### 6.4.4 首次信任建立与 authority registry 防替换

“受信 provisioning”不是一个可由调用方命名的角色，而是一条可验证的 bootstrap chain。逻辑记录和验证顺序固定如下：

```text
signed application release
  -> compiled trust-anchor set (anchor_id, fingerprint, version)
  -> installation identity certificate (public key, installation_id, organization_id)
  -> proof-of-possession challenge
  -> signed authority registry (registry_id, version, parent_anchor_fingerprint, root_hash)
  -> signed enrollment package (enrollment_id, mapping, scope, expiry)
  -> distinct enrollment executor/approver
```

1. 固定 trust anchor 集合及其 `anchor_id/fingerprint/version` 只能来自已签名的应用发行物/安装包完整性边界；不得从目标 SQLite、`userData` registry 文件、CLI 参数、环境变量或待验 enrollment package 加载替代 anchor。anchor 变更必须是新应用版本中签名的 root-rotation 事实，旧 anchor 只用于历史验证和撤销，不可被目标安装自换。
2. `installation_identity_certificate` 必须由该 anchor/允许的 provisioning CA 签发，包含安装公钥、`installation_id`、`organization_id`、contract version、issued/expires、key ID、parent fingerprint、证书 hash 和签名。安装身份不能只是一段请求正文 ID；首次 enrollment 前必须通过 OS/平台保护的私钥完成 challenge-response proof-of-possession。私钥不可进入 DB、日志、argv、环境变量或 vault 正文。
3. `authority_registry` 必须签名绑定证书 fingerprint、registry version/root hash、允许的 provisioning signer、组织 scope、可签发 capability 类型、有效期和撤销列表。应用先以固定 anchor 验证 registry，再比较安装证书、registry 的 target scope 和当前 contract version；registry 文件落地前后都用 canonical bytes/hash 校验，替换只能由已验证的 registry-rotation package 批准，不能通过覆盖目标 DB/userData 文件生效。
4. 首次 enrollment 需要同时满足：目标安装 proof、当前 registry 通过 anchor 验证、签名 enrollment package 通过 registry signer 验证、`user_account.user_id` 已由受信账户 provisioning 建立且是 ACTIVE ADMIN、enrollment idempotency key/nonce 未使用、mapping scope/有效期/双向唯一检查通过。任何一项缺失都返回 `INSTALLATION_TRUST_UNAVAILABLE`、`INSTALLATION_IDENTITY_INVALID`、`AUTHORITY_REGISTRY_INVALID` 或 `PRINCIPAL_ENROLLMENT_INVALID` 的精确错误，不写 command、mapping、event 或 vault。
5. anchor holder、registry/provisioning signer、enrollment executor/approver 和未来 release approver 必须按职责集合互斥；安装 operator 的 proof-of-possession 只证明目标安装，不给予发布或读取 private identity-map 的权限。首次 enrollment 的 package signer 不能是 enrollment executor/approver，也不能成为同一 pack 的 release approver。
6. 同一 `enrollment_id + package_hash + installation_id` 重放返回原 durable enrollment result；同 ID 异 hash、证书/registry 被替换、nonce 重用、target scope 不符或 package 过期返回稳定 conflict/invalid error，不替换已接受 registry 或 mapping。bootstrap 任一步失败后只能进入只读修复；不得为了“让首个 ADMIN 可用”创建默认 mapping。

这组事实是安装/组织 provisioning 的独立信任合同，不在本阶段选择具体 OS keychain、TPM 或文件路径实现；但任何实现都必须提供上述可验证输入，否则发布流程保持 `PRINCIPAL_ENROLLMENT_REQUIRED`。

### 6.5 预览发布命令、幂等与 PREPARE/APPLY

#### 6.5.1 规范化业务输入

`JOB_SKILL_PREVIEW_PACK_RELEASE` 的 canonical business input 至少包括：target installation/organization、pack/strategy refs、manifest/approval refs 和 hash、精确 question/asset/renderer/evidence refs、resolved executor mapping version/hash、dry-run 标志和 release intent version。输入不得包括可覆盖身份的 caller 字段；签名文件的 canonical bytes 由系统重新读取和验签。

规范化后生成 request hash。`(client_instance_id, idempotency_key)` 是全局命令幂等键；同 key 同 request hash 且 actor/device/auth 事实一致必须返回同一 durable public result；同 key 不同 hash 或 actor/device/auth/mapping 漂移返回 `PREVIEW_PACK_RELEASE_CONFLICT`，不得重跑或覆盖。

#### 6.5.2 PREPARE

PREPARE 必须在到达不可回退点前完成：

1. 读取并验证冻结的 manifest/approval/mapping、authority、所有 hash、期限、题目状态和来源矩阵。
2. 写入规范化 command envelope、request hash、业务输入快照、预期 source binding、result recipe version 和 execution identity reference。
3. 将 canonical PREPARE/EVENT segment 追加并 fsync；若任何写入/fsync 失败，在没有证明已达 PREPARE 前返回 `PRE_PONR_EXECUTION_FAILURE`，不能盲目重试产生第二批。
4. 到达 PREPARE 后丢弃 planner 内存。重启只读取 durable PREPARE/EVENT，不重新读取当前题库、策略、批准文件或调用 planner 重新决定 DRAFT/ACTIVE 集合。

#### 6.5.3 APPLY

APPLY 必须在一个明确的 SQLite `IMMEDIATE` 事务和已登记 projector 里完成：

- 对批准集合的每个精确题目执行状态/版本/hash/source 再验证；DRAFT 才允许按批准转 ACTIVE，已有 ACTIVE 只写 preview binding；DISABLED/ARCHIVED 拒绝。
- 写入不可变 preview pack/strategy/source/approval/manifest/mapping 引用及 audit 事实；不得只写 `payload_json` 而无 read model/唯一约束。
- 写入 `preview_event_projection`、对应的 processed-event/cursor 和 public result 的顺序符合 `INV-EVT-002/003/004/005/006`；旧正式 `domain_event_projection` 不接收 preview aggregate/event。
- 任一 projector、约束、hash、result recipe 或权限校验失败，事务整体回滚；重启后要么从冻结事实继续 APPLY，要么进入只读 `EVENT_BATCH_RECOVERY_CONFLICT`，不得留下部分 ACTIVE 或半题包。

#### 6.5.4 回放与冲突

- 相同 approval ID/hash、同命令键回放返回已持久化结果，不重新执行发布副作用。
- 相同 approval ID 不同 hash、同题目不同 semantic hash、manifest/approval 版本漂移或 source binding 冲突都生成稳定冲突结果并保持原事实。
- 事件缺 payload validator、projector、result recipe、known schema version 或 aggregate 权限时，回放失败关闭且不 APPLY。
- dry-run 只能输出拟发布集合、缺口和错误码，数据库、事件日志和 userData vault 均零写入。

### 6.6 PREVIEW session 冻结与正式结果/报告抑制

#### 6.6.1 冻结快照

预览 session 创建时必须冻结一个可判别、可回放的 snapshot，至少包括：

- `delivery_mode = PREVIEW_ONLY`、snapshot schema version、`pack_ref`、`preview_publish_set` source refs、`manifest/approval` refs/hash；
- `strategy_ref`、policy/scoring contract hash；精确 question refs、module/phase/item usage；
- asset/renderer refs、线下材料和 0/1/2 rubric、观察约束、安全停止条件；
- assignment/grant、student/job/task 三元安全键、snapshot root hash、创建命令/event/batch ID。

snapshot 事实一旦 STARTED 不因当前 `question_bank`、strategy、资产、授权或 renderer 的后续变化而重新规划。恢复只使用已冻结 snapshot 和事件。

#### 6.6.2 payload 兼容和完成事件

- 既有正式 v1/v2 `SESSION_STARTED` 只能按冻结兼容注册表解释为正式 `FORMAL_DEMO`；不能把旧 payload 缺字段猜成 PREVIEW_ONLY。
- 新预览判别 payload 使用独立版本和判别字段；缺字段、未知 delivery mode、注册表外 legacy 或 root hash 不匹配均失败关闭。
- 预览完成必须使用独立 `PREVIEW_SESSION_COMPLETED` 事件，全链登记 payload validator、JSON schema/type、event registry、prepared projector、reducer、recovery、replay 和测试。
- 正式链继续使用既有 `RESULT_CALCULATED -> SESSION_COMPLETED -> JOB_SKILL_SCORE/task_report` 语义；不得把预览完成事件接到正式结果生成链。

#### 6.6.3 结果与安全边界

在任何终态事件、结果查询和报告生成前都以冻结 snapshot 的 delivery mode 分流：

- PREVIEW 正常完成、作废、技术中断或红线终止：可以保留作答/评分/观察/支持/中断/安全事实和题包作答情况，但不得新增任何 `result_record`、`JOB_SKILL_SCORE`、`ABILITY_SCORE`、`TRAINING_COMPLETION`、`OPERATION_PASS_RATE`、正式 `task_report`、`FULL_REPORT` 或 `SAFETY_TERMINATION_REPORT`。
- PREVIEW 红线仍按 `student_id + job_code + task_code` 先熔断，生成 `REDLINE_HALTED`、incident、binding 和红线前事实；安全优先级不降低，但不写安全覆盖结果。
- PREVIEW 不生成岗位等级、跨题包比较、M1-M6 综合画像、训练重点结论或就业安置建议。
- 正式旧 18+6：固定 18 online + 6 offline、最大分 48、正式 source/strategy 仍独立验证，继续生成原有正式结果/报告；不回写历史 session/event/result/report。

### 6.7 反馈 vault：匿名映射、草稿、revision、查询、删除与隐私

#### 6.7.1 存储边界

推荐组合方案中的 feedback vault 位于受控 `userData` 下的独立目录。现有 `DurableFileCapability` 只能作为物理安全原语，业务仓储还必须定义格式、权限、提交协议和恢复规则：

```text
userData/preview-feedback/
  private/identity-map/       # 0700 directory, 0600 files; real session/student/teacher mapping
  private/drafts/             # local draft and autosave data
  private/revisions/          # append-only canonical revision records
  export/                     # anonymized HTML/JSON/Markdown only
  journal/                    # prepare/commit/tombstone records
  vault-manifest.json         # format/version/root hash, no raw identity
```

路径必须通过 `DurableFileCapability` 的 normalized relative path、no symlink、exclusive create、fsync、directory barrier、identity/hash 和 atomic replace 检查；目录和文件权限不足时仓储不可用并失败关闭。实际目录名和文件名由实现计划确定，以上分区边界不可合并。

#### 6.7.2 匿名引用与外发格式

- 每个反馈包生成随机 `feedback_id`、`session_export_ref` 和 `subject_export_ref`；引用不能由真实 ID、后四位、固定盐或可预测序列确定性推导，碰撞必须拒绝。
- `private/identity-map` 保存真实 `session_id/student_id/teacher_user_id` 与匿名引用的最小必要映射、创建时间、scope、retention 和 mapping hash；映射不进入 HTML/JSON/Markdown、日志、error message、telemetry 或 AI prompt。
- 外部 JSON 只含学校匿名代码、匿名引用、pack/question/asset 版本/hash、结构化问题类型、严重程度、稳定 feedback ID/revision、提交时间和经脱敏确认的文本；不得含原始 session/student/teacher ID、姓名、身份证、电话、邮箱、凭据或未脱敏自由文本。
- Markdown 只能由已验证的 JSON 确定性生成，不能成为第二个可编辑权威。

#### 6.7.3 状态与 revision

逻辑反馈记录：

```text
DRAFT -> SUBMITTED -> EXPORTED
  |          |
  +-> DELETED/TOMBSTONED (only before submission or retention purge)
  +-> new immutable revision
```

- 自动保存只写当前 owner 的 DRAFT；每次保存采用版本号、content hash、previous revision hash 和 atomic replace/journal commit，崩溃后恢复到最后一个完整 commit。
- `SUBMITTED` revision 不原地修改。更正、补充或脱敏改变都创建递增 revision，并保留前一 revision hash 和提交主体的内部审计引用。
- 重复导出不新建 feedback ID；同一 revision 导出保持稳定匿名引用和内容 hash。外发文本必须经过敏感数据扫描、脱敏预览和教师显式确认，命中疑似敏感数据则失败关闭。

#### 6.7.4 查询、访问和删除

- TEACHER 只能查询自己组织/责任范围内的题包作答情况和自己可见的 feedback draft/submitted revision；STUDENT 不可查询 identity-map；ADMIN/学校数据责任人可按 retention policy 执行管理查询和删除。
- 内部查询可以使用真实 `session_id` 作为受控索引，但任何跨边界返回/导出都只返回匿名引用；查询结果不得把 private 映射和外发 DTO 合并。
- DRAFT 可由创建者或授权管理员删除；删除写入无正文 tombstone（feedback ID、revision/hash、删除主体、原因、时间）。已提交 revision 默认 append-only，不提供覆盖/物理删除按钮。
- 达到学校 retention 或经授权隐私删除后，系统可以物理删除正文和 identity mapping，并保留不含个人信息的 tombstone/hash/计数审计；外部用户已下载的文件无法由本地系统撤回，必须在外发前明确责任提示。
- 学校数据责任人负责 retention、导出审批和外部文件管理；应用负责 ACL、最小化、脱敏门禁、日志排除、hash 完整性和删除审计。责任变更必须有新 policy/version，不修改历史 revision。

#### 6.7.5 主库引用与 vault 提交/恢复协议

反馈正文、匿名映射、draft 和 revision 的 canonical owner 是 vault；主库只拥有非敏感的 session linkage、反馈索引、commit 状态、hash/reference 和审计事实。跨边界不声称 ACID，但必须使用一个预先生成且全局唯一的 `feedback_commit_id`，并把同一 request hash/idempotency key 写进两边的可验证记录。

`feedback_commit_id` 的唯一性和冲突裁决固定如下，不能留给实现者自行选择：

- vault journal/manifest 对 `feedback_commit_id` 建立 exclusive-create 唯一事实；同一 vault 还必须对 `(feedback_id, revision_no, operation)` 建立唯一事实。SQLite 的 `feedback_reference_projection` 和 `feedback_tombstone_projection` 对这两个键分别建唯一约束，并且只能接受与 vault commit proof 完全相等的值；SQLite 不能自行 mint commit ID。
- commit ID 由 vault 在 `VAULT_INTENT_PREPARED` 前用 CSPRNG 生成并写入 canonical proof；若 exclusive-create 发现碰撞，返回 `FEEDBACK_COMMIT_ID_COLLISION`，不得换 ID 后把同一次请求伪装成新提交。重试必须带回原 commit ID；同一 `(feedback_id, revision_no, operation)` 只允许一个 commit ID。
- canonical proof 至少覆盖 `feedback_commit_id`、operation、feedback/revision/previous hash、session/export scope、request hash、schema/contract version、actor/auth reference、created_at window 和 vault manifest root hash。任一字段不同即为不同事实，不得只比较正文 hash。
- 同 commit ID 同 canonical proof/request hash返回原状态；同 commit ID 异 hash 返回 `FEEDBACK_COMMIT_CONFLICT`；同 feedback/revision/operation 异 commit ID 返回 `FEEDBACK_REVISION_CONFLICT`；submit/delete/purge 交叉重试按 vault 当前状态序列化，非法转移返回 `FEEDBACK_STATE_CONFLICT`，不创建第二 revision 或覆盖历史。
- vault manifest 是 commit ID 的 collision authority；DB reference 只消费 proof。DB 中先出现的 reference 没有 vault proof 时只能是 `ORPHAN_REFERENCE`，不能成为新的 canonical commit；vault 中先出现的 commit 没有 DB reference 时只能是 `ORPHAN_VAULT_COMMIT`。repair 只能使用原 commit ID、原 proof/hash、目标 scope 和同一 revision，不能用新正文或新 commit ID补齐旧事实。
- repair request 自身也要以 `(repair_request_id, target_commit_id, operation)` 唯一去重；同 hash 返回原修复结果，异 hash 或不同 target 返回 `FEEDBACK_REPAIR_CONFLICT`。tombstone/purge 必须使用新的 delete commit ID，但只允许引用被删除 revision 的原 proof，不能复用 submit commit ID。

新 revision/提交只允许以下顺序：

```text
VAULT_INTENT_PREPARED
  -> VAULT_COMMITTED
  -> DB_REFERENCE_COMMITTED
  -> RECONCILED_SUBMITTED
  -> EXPORTED (optional)
```

1. vault 先以 journal PREPARE 固化 `feedback_commit_id`、feedback/revision/previous hash、session/export scope、schema version、actor/auth reference 和操作类型；正文 staged file、manifest 和目录 barrier 完成后才能成为 `VAULT_COMMITTED`。
2. 只有带匹配 commit proof/hash 的 `VAULT_COMMITTED` 才能在 SQLite `IMMEDIATE` 事务中写 `DB_REFERENCE_COMMITTED`；主库不能先声明 submitted，也不能凭一个 reference 推断 vault 正文存在。
3. 两边事实和 hash 都可验证后才暴露 `RECONCILED_SUBMITTED` 或允许外发。重复 request 只能返回原 commit 状态；异 hash、revision/previous hash 不匹配或 actor/scope 漂移返回稳定 conflict。
4. 若发现 DB reference 已提交而 vault commit 不存在，状态固定为 `ORPHAN_REFERENCE/RECONCILE_REQUIRED`：不得查询正文、不得导出、不得显示为 submitted；修复只能从仍完整的 vault PREPARE/commit proof 恢复，若证据不存在则由授权 data steward 写无正文 tombstone。不能猜测或补造正文。
5. 若 vault commit 已提交而 DB reference 缺失，状态固定为 `ORPHAN_VAULT_COMMIT/RECONCILE_REQUIRED`：正文保持 private、不可外发且不进入可见 revision；具有独立 repair 权限的 ADMIN/学校数据责任人可依据完整 commit proof 幂等补写 reference，或在 ACL/会话 scope 无法验证时 tombstone/purge。修复不得覆盖正文、previous hash 或历史 revision。
6. tombstone/purge 采用同一 commit 协议的 `DELETE_INTENT_PREPARED -> VAULT_TOMBSTONED -> DB_TOMBSTONE_COMMITTED -> RECONCILED_DELETED` 顺序；vault 先完成隐私删除事实，DB 缺失时也必须 fail-closed，不能因主库事务成功而复活正文。
7. 重启 recovery 只处理上述持久状态；自动恢复只能补齐已有 hash/proof 的幂等 reference，不能改变 revision 内容或授权。所有 `RECONCILE_REQUIRED` 进入只读修复队列，修复者、批准、原因、结果和最终 hash 留审计；修复权限不等于读取 private map 的权限。

因此，“已提交”只表示 `RECONCILED_SUBMITTED`，不表示任一单边写成功。任何中间状态都不能被导出、统计为已提交或转成正式结果。

#### 6.7.6 feedback repair capability 与读取权限分离

`ADMIN`、TEACHER、原 feedback owner 或“学校数据责任人”称谓本身都不产生 repair 权限。所有跨边界修复都必须消费独立的签名 capability record：

```text
feedback_repair_capability_id/version/hash
capability_type        REFERENCE_REPAIR | TOMBSTONE | PURGE | IDENTITY_MAP_READ
target_installation_id / organization_id
target_feedback_id / target_commit_id / target_revision_no
allowed_operation_scope
issued_by_authority / approver_principal_id(s) / executor_principal_id
issued_at / expires_at / revoked_at
signature / key_id / policy_version
```

- `FEEDBACK_REFERENCE_REPAIR` 只能由 ACTIVE ADMIN 执行，且必须有学校数据责任 authority 签发的、精确绑定 `organization_id + feedback_id + target_commit_id + proof_hash` 的 capability；它只允许用非敏感 scope 和 vault commit proof 补写 DB reference，不允许读取正文或 `private/identity-map`。
- `FEEDBACK_TOMBSTONE` 只能按明确的 retention/privacy policy 和目标 commit/revision 执行；普通 DRAFT 删除仍需 owner scope，但跨边界 orphan tombstone 必须使用 capability。`FEEDBACK_PURGE` 需要学校数据责任人和独立 privacy/admin approver 的双签，executor 不得与任一 approver 相同；物理清除按 hash/ID 操作，不以读取映射作为授权前提。
- `IDENTITY_MAP_READ` 是独立于所有 repair capability 的最高敏感权限，必须由学校数据责任人/隐私 authority 按最小 scope、用途、期限单独签发；reference repair、tombstone、purge、发布 ADMIN 权限均不能隐式授予它。
- capability 的签发 authority 必须锚定 §6.4.4 的固定 trust anchor、已验证 organization/installation registry 和 enrolled principal；目标 DB 中的 role、UI 勾选框、调用方自报 `principal_id`、username 或 environment 不是 capability 来源。签发人、批准人、执行人职责集合必须互斥；缺失、越界、过期、撤销、组织不符或签名/hash 错误分别返回稳定的 `FEEDBACK_REPAIR_CAPABILITY_REQUIRED/INVALID/SCOPE_DENIED`，不写任一边界。
- capability 本身要有唯一 `(capability_id, version, capability_hash)` 和生命周期事件；修复请求/重试使用 §6.7.5 的 `repair_request_id` 去重。repair audit 记录主体、scope、target commit/proof、reason、结果和 hash，但不记录正文或 private map。

所以 repair 的 canonical authority 是签名 capability + 原 commit proof，而不是 ADMIN 角色或可读取的真实身份映射；无法同时验证二者时保持 `RECONCILE_REQUIRED` 只读。

### 6.8 查询/read model 与审计

- 目录可见、题包可分配、正式/预览来源有效、反馈可见和删除状态分别由各自 read model/仓储状态计算；不得从 UI 标签、题量、文件存在或 `ACTIVE` 单字段推断。
- read model 必须能够从 canonical event/log/manifest/vault journal 重建；派生查询损坏时可重建，不能反向覆盖 canonical facts。
- audit 记录至少包括 command/event/batch ID、source/pack/approval/manifest/mapping/hash refs、actor/auth/device、结果/error code、rollback/recovery 状态；不记录凭据、答案正文、自由文本、private map 内容或绝对路径。

### 6.9 PREVIEW aggregate、status 与 EventType 注册表

本节是逻辑注册合同；§6.9.1 进一步固定所需 projection 边界。当前 `assessment_session.status` 的既有枚举和 `strategy_type` 的正式值只服务旧正式链；不能把 `OPEN`、`PREVIEW_ONLY` 或新 preview aggregate 直接塞进现有正式枚举，也不能用 `payload_json` 的偶然字段替代注册。

| 逻辑 aggregate | canonical facts | 允许的生命周期/事件 | 必须有的 read/recovery 边界 |
|---|---|---|---|
| `JOB_SKILL_PREVIEW_RELEASE` | preview source binding、pack、manifest、approval、题目/资产/renderer/evidence hash、principal refs | `PREPARED -> PUBLISHED -> DISABLED/RETIRED`；release prepare/apply/revoke 事件 | source/pack 查询、唯一性、撤销、发布命令恢复；不写正式 strategy authority |
| `PRINCIPAL_BINDING` | enrollment/rotation、user/principal 双向映射、scope、version/hash、签名与生效窗口 | `ENROLLMENT_PREPARED -> ACTIVE -> SUPERSEDED/REVOKED` | 双向唯一、信任链、轮换恢复；不升级 user role |
| `JOB_SKILL_PREVIEW_SESSION` | explicit delivery mode、pack/source/strategy/question snapshot、root hash、assignment/grant 和安全事实 | `CREATED -> STARTED -> COMPLETED/ABORTED/TECHNICAL_INTERRUPTION/REDLINE_HALTED`；`PREVIEW_SESSION_COMPLETED` 独立事件 | snapshot/replay/result suppression；不进入正式 result/report aggregate |
| `JOB_SKILL_PREVIEW_FEEDBACK_REF` | 非敏感 feedback reference、commit state/hash、tombstone/reconcile status | `INTENT -> RECONCILE_REQUIRED/RECONCILED_SUBMITTED/RECONCILED_DELETED` | vault proof 对账和 ACL 查询；正文/identity-map 仍只在 vault |

每个新 command/EventType 必须在注册表中同时登记 `event_type + schema_version + aggregate_type + delivery_mode 判别 + payload validator/JSON schema + actor/permission + persistence order + projector/read model + reducer + recovery recipe + result/report recipe + public error mapping + migration contract version`。旧正式 v1/v2 `SESSION_STARTED` 只命中 `FORMAL_DEMO` legacy registry；新 PREVIEW 必须有显式、版本化的 `PREVIEW_SESSION_STARTED` 判别事实。

- event/aggregate/schema version 未注册、未知、缺 validator/projector、migration contract version 不匹配或 read model 不能从 canonical fact 重建：回放失败关闭、启动进入只读修复，不 fallback 到 `JOB_SKILL_ASSESSMENT`、正式 `strategy_type` 或普通 JSON。
- migration 前只允许按旧 registry 回放旧正式事件；新 preview event 不得写入旧 schema 边界。migration 后先验证旧 formal replay，再启用新 preview registry；migration 中断恢复只能从已登记 PREPARE/EVENT 继续或停止。
- rollback/旧应用读取新事实时，必须识别 contract version 并停止新 preview release/session；不得把 `JOB_SKILL_PREVIEW_SESSION` 解码为正式 session。历史正式 18+6 仍按旧 registry 读取且不回写。
- `delivery_mode` 是 session snapshot 的独立逻辑判别，不由 `strategy_type`、题量、ACTIVE、pack 文件存在或 UI 路由推导；物理列/表和索引由 `/vibe-impl` 另行提出并经 R3 门禁。

#### 6.9.1 物理映射决策表与 migration gate

为使本合同可机械验收，以下是目标物理边界的决策表；它定义新增投影的职责，但不在本阶段写 DDL 或 migration：

| 事实/事件 | canonical event 入口 | 目标持久化投影 | 当前 v0.1.18 对其行为 |
|---|---|---|---|
| 旧正式 `SESSION_STARTED`/result/report/18+6 | 既有正式 event registry/M5B batch | 当前 `domain_event_projection`、`assessment_session`、`strategy_config`、result/report 表 | 继续按旧 aggregate/status/strategy registry 回放；不读取 preview registry |
| `JOB_SKILL_PREVIEW_RELEASE` | M5B v2 batch 中的 `PREVIEW_CONTRACT_V1` event segment | 新增 `preview_event_projection` + `preview_release_projection` | 当前库没有目标 projection，命令返回 `PREVIEW_CONTRACT_MIGRATION_REQUIRED`，不得写旧 `domain_event_projection` |
| `PRINCIPAL_BINDING` | 同一新 contract event segment | 新增 `principal_binding_projection` + registry/capability references | 当前 `user_account`/`auth_session` 不被猜测扩列或自动映射；无新 projection 时 enrollment/publish fail-closed |
| `JOB_SKILL_PREVIEW_SESSION` | `PREVIEW_SESSION_STARTED/COMPLETED/...`，独立 EventType | 新增 `preview_session_projection`、`preview_session_question_projection`，必要时以唯一 `assessment_session_id` 作为共享身份 shell | 业务逻辑状态以 preview projection 为 canonical；现有 `assessment_session.status` 只做兼容影子映射：`CREATED→INIT`、`STARTED→ACTIVE`、终态按 `COMPLETED/ABORTED/REDLINE_HALTED` 映射，`TECHNICAL_INTERRUPTION` 只在 preview projection 保留；旧正式 planner 必须先检查 contract version/preview projection，不得把 shell 当正式 session |
| `JOB_SKILL_PREVIEW_FEEDBACK_REF` | feedback metadata/tombstone/reconcile EventType | 新增 `preview_feedback_reference_projection`；正文、identity-map、draft/revision 仍只在 vault | 当前库只可读取旧 feedback/无该 projection；单边 reference 不得显示或外发 |

固定规则：

1. 当前 `domain_event_projection` 的 aggregate CHECK、当前 `assessment_session.strategy_type/status` 和当前 `strategy_config.strategy_type` 都是旧正式边界；新 preview EventType/aggregate 不得伪装成 `ASSESSMENT_SESSION`、`STRATEGY_CONFIG` 或任一旧值。新 projection 必须有自身的 aggregate CHECK、`UNIQUE (aggregate_type, aggregate_id, event_sequence)`、`contract_registry_id`、source batch/hash 和 replay cursor。
2. 共享 `assessment_session_id` 只满足原产品“assessment session 复用”的身份/assignment 语义；`delivery_mode`、pack/source/hash、preview logical status 和结果抑制的 canonical owner 是 `preview_session_projection`。若 migration 无法提供这个一对一 shell + preview projection 双边约束，必须整体拒绝 PREVIEW，而不是扩大旧唯一索引或用 `strategy_type` 猜测。
3. `PREVIEW_CONTRACT_V1` 是逻辑 registry/migration gate，必须在新 projection、EventType、validator、projector、reducer、recovery、query、error mapping 和所有 unique/FK/状态约束同一版本安装后才标记 `READY`。它不是当前 v0.1.18 已存在的事实；当前 0.1.17/0.1.18 drift 未收口前不能声明 READY。
4. pre-migration：只允许旧 formal registry 和旧 projection；任何 preview command/event 返回 `PREVIEW_CONTRACT_MIGRATION_REQUIRED`。in-migration：写入 migration PREPARE 但暂停 preview mutation；重启只能恢复冻结 migration facts 或进入只读 `PREVIEW_CONTRACT_MIGRATION_RECOVERY_REQUIRED`。post-migration：先对旧 formal replay 做完整性校验，再启用 `PREVIEW_CONTRACT_V1` preview writes；任何 registry/projection/constraint 缺失都保持禁用。
5. rollback/旧应用：若 `PREVIEW_CONTRACT_V1` 不被当前应用支持，旧 formal event/result/report 仍可按旧 registry 读取；新 preview aggregate/event 只能显示为 unsupported/read-only，不能插入旧 projection、解码成正式 session、生成 result/report 或执行新 preview command。回滚不删除新 event、snapshot、feedback revision 或 tombstone。

因此，`/vibe-impl` 可以选择具体 DDL 名称、migration ID 和 SQLite 版本号，但不能重新选择上述 canonical owner、旧/新 projection 边界、session shell 映射、registry gate 或 pre/in/post/rollback 行为；改变这些语义必须重新走 R3 review。

## 7. 候选架构比较与推荐

### 7.1 评分方法

以下矩阵不是凭“已有原语可复用”打分，而是按目标业务合同验证能力评分。每项 0-5 分：0 表示无法满足，5 表示可在该边界内机械满足；权重总和 100。任一候选若不能独立证明双发布来源、可信身份、PREPARE/APPLY 或隐私隔离，不能仅凭总分进入实施。总分计算为 `Σ(得分/5 × 权重)`，四舍五入到整数。

| 评价维度 | 权重 | 关系表 + DB 约束 | M5B event + read model | 受控 userData 文件仓储 | 组合方案 |
|---|---:|---:|---:|---:|---:|
| 双发布来源、唯一性、精确查询 | 20 | 5 | 4 | 1 | 5 |
| PREPARE/APPLY、回放和崩溃恢复 | 15 | 3 | 5 | 2 | 5 |
| 发布状态/批准/hash 原子边界 | 15 | 5 | 5 | 2 | 5 |
| principal 映射、RBAC、职责分离 | 15 | 5 | 4 | 2 | 5 |
| 反馈匿名、draft/revision/删除 | 15 | 2 | 2 | 5 | 5 |
| migration、rollback、历史兼容 | 10 | 3 | 4 | 4 | 3 |
| 离线查询和 userData 运维边界 | 10 | 4 | 3 | 5 | 4 |
| 加权总分 / 100 | 100 | 79 | 78 | 55 | 94 |

每个评分单元都必须对应能力断言；没有该能力的候选该单元最高为 0，不能用“未来可以补”取得 3/5 分。3 分表示该方案在自己的边界内可证明，但必须依赖另一方案提供明确的合同；5 分表示在该方案边界内可独立证明，并能由另一边界消费稳定 reference/hash。

| 能力断言 | 对应 AC/合同证据 |
|---|---|
| 双来源唯一性和 00/10/01/11 查询不会互推 | AC-R3-01/02、§6.2、§6.8 |
| PREPARE/APPLY、plannerCalls=0 和 replay 决策唯一 | AC-R3-06/07、§6.5、§6.9 |
| approval/manifest/scope/hash/SOD 原子绑定 | AC-R3-03/05、§6.3 |
| trusted user/principal enrollment、rotation 和 ACL | AC-R3-04/05、§6.4 |
| feedback vault 的匿名、revision、对账和删除边界 | AC-R3-11/13/17、§6.7 |
| migration parity、历史回放、rollback 不回写 | AC-R3-08/10/14/15、§10、§6.9 |
| 离线查询不跨越 private map、外发 allowlist 和 userData 权限 | AC-R3-12/13、§6.7.1/6.8 |

分数的可复算解释：关系表在唯一性、事务和身份上强，但单靠表不能形成事件回放和反馈正文隐私；event/read model 在事件恢复强，但若没有专用 projector/唯一约束，查询与权限不能靠通用 `payload_json`；文件仓储适合反馈草稿和匿名映射，但单靠文件无法可靠承担正式/预览发布关系、SQLite session 安全约束和跨启动查询；组合方案把高一致性业务事实、事件回放和敏感反馈正文放在各自适合的边界。

### 7.2 四类方案的边界影响

| 方案 | 默认 DB 与历史事件 | 回放/恢复 | Electron/CLI 认证 | 删除与隐私责任 | 结论 |
|---|---|---|---|---|---|
| 关系表与数据库约束 | 需要 additive tables/index/trigger；历史 18+6 只做兼容注册，不回写旧 session | DB 事务强，但必须补 canonical event 全链，否则不能满足 INV-EVT | mapping/approval 可用 FK/unique + signed validator；sender/CLI 仍需显式入口 | 反馈正文若进主库，删除/导出边界与默认备份扩大 | 适合发布、身份、查询；不适合直接保存反馈正文 |
| M5B event + read model | 新 command/EventType/projector/read model；旧事件保持原 schema/registry | 最适合 PREPARE/APPLY、租约接管、replay 和恢复失败关闭 | actor/auth 仍只证明已有 user；principal 需新 signed mapping/read model | event payload 一旦含自由文本/映射会扩大泄漏，必须拆出敏感 vault | 适合业务事实和审计；不能把通用 event 当自由 KV |
| 受控 userData 文件仓储 | 不改主库可先落地，但不能提供 SQLite source binding/FK/安全唯一性 | 需自有 journal/manifest/atomic replace；不能自动加入 M5B replay | 可复用 file capability，不会自动验证 ADMIN/role/principal | 最适合 private map、draft/revision/export 分区；删除和保留需明确责任 | 只适合 feedback/privacy 子域，不能独立承载发布授权 |
| 组合方案（推荐） | 主库增加经批准的发布/身份/session read model；历史事实不回写；vault 独立保留敏感正文 | 主业务使用 M5B；vault 使用 prepare/commit journal，跨边界以 hash/reference reconcile，不假称跨库 ACID | 主库 command 只接受 trusted sender/CLI user，再查 signed mapping；反馈读写分 ACL | mapping/draft/revision 放 private vault；外发只读 export 区；主库只保留非敏感 reference/hash/audit | 业务一致性、恢复、查询和隐私边界最完整；需要两套恢复/验证器，实施复杂度最高 |

### 7.3 推荐目标合同：组合方案 C

本 R3 推荐组合方案 C 作为进入 `/vibe-impl` 的目标：

1. **主库关系投影**：发布来源 binding、approval/manifest reference、principal binding、pack/strategy/session freeze index、非敏感反馈索引使用受约束的 SQLite projection，提供唯一性、FK/范围/状态检查和授权查询。
2. **M5B canonical event**：所有发布、身份映射生命周期、session freeze/complete、反馈 metadata/tombstone 等受控 mutation 通过封闭 command + event + projector/replay 链；每个 EventType 需全链登记。
3. **private userData vault**：真实 ID mapping、反馈正文、DRAFT、revision 和外发文件只在受控 userData 分区保存；vault 有自己的 canonical journal、prepare/commit、manifest、hash 和恢复测试。主库不复制真实映射或正文。
4. **跨边界桥接**：业务 session/pack 只引用 `feedback_id`、匿名 refs、vault commit/hash 和非敏感版本；vault 不反向授权题目/策略/发布。跨边界不声称单一 ACID；任一边界无法 reconcile 时禁止外发并进入只读修复，而不返回“已提交”。
5. **授权入口**：发布和敏感查询均使用同一 trusted auth resolution；反馈草稿 ACL 不等于发布 ADMIN 权限。Electron 与 CLI 只提供认证上下文，不允许调用方自报身份。

该推荐不是已实施的 Schema 结论。`/vibe-impl` 必须用真实 migration、projector、vault journal 和隔离故障注入证明；若组合方案无法满足本文件 AC，只能回到独立 R3 变更，不得降级为“把字段塞进普通 JSON”。

## 8. 核心场景（Given / When / Then）

### 8.1 正式先发布，预览后发布

**Given** 精确题目版本已在 `official_publish_set` 有效成员，但没有当前预览 approval/binding。

**When** 创建 PREVIEW_RELEASE_CANDIDATE 或尝试预览 session。

**Then** 题目可在教师目录显示为候选，但不能显示 `PREVIEW_READY`、不能创建 PREVIEW session；返回 `PREVIEW_RELEASE_AUTHORITY_MISSING`。补齐独立预览批准后，原子发布只增加 preview binding，不把正式来源当作预览批准。

### 8.2 预览先发布，正式后发布

**Given** 精确题目版本已在 `preview_publish_set` 有效成员并可能因预览命令从 DRAFT 变为 ACTIVE，但没有正式 Phase 4/正式 release authority。

**When** 创建正式 18+6 session。

**Then** 正式来源复验失败并返回 `FORMAL_RELEASE_AUTHORITY_MISSING`；不能因共享 `ACTIVE` 或预览 approval 自动取得正式权限。之后补齐独立正式来源，正式路径才可继续；预览来源本身不改写历史正式事实。

### 8.3 发布重复与 hash 冲突

**Given** 已完成同一 `(client_instance_id, idempotency_key)` 的发布命令。

**When** 以相同 canonical request/hash 重试，或以同 ID 不同 hash 重试。

**Then** 前者返回原 durable public result 且不产生第二批/第二 binding；后者返回 `PREVIEW_PACK_RELEASE_CONFLICT`，不覆盖原批准、题目状态或审计。

### 8.4 PREPARE 后崩溃

**Given** PREPARE/EVENT 已 fsync，但 SQLite APPLY 尚未完成。

**When** 进程重启并执行 startup recovery/replay。

**Then** 只读取冻结 PREPARE/EVENT 和已登记 recipe/projector；恢复为完整 APPLY 或只读 `EVENT_BATCH_RECOVERY_CONFLICT`。planner 调用数为 0，不重新计算当前题目/批准集合，不产生半 ACTIVE、半 pack 或第二命令结果。

### 8.5 PREVIEW session 完成与红线

**Given** session snapshot 的 `delivery_mode = PREVIEW_ONLY`，题包和题目 hash 已冻结。

**When** session 正常完成、作废、资产失效或触发安全红线。

**Then** 保存过程事实；正常完成使用 `PREVIEW_SESSION_COMPLETED`；资产失效记录 `TECHNICAL_INTERRUPTION`；红线生成 `REDLINE_HALTED`/incident/binding；任何分支均不写 `result_record` 或正式 `task_report`。正式 session 仍由其冻结正式 mode 进入原有 18+6 结果链。

### 8.6 反馈草稿、revision 和外发

**Given** 教师已被授权查看某个本地 session，并在反馈 HTML 中填写内容。

**When** 自动保存、提交、修改已提交反馈或导出。

**Then** 草稿只写 private vault 并能重启恢复；提交创建不可变 revision；修改产生新 revision；外发只包含随机匿名引用和允许字段；敏感文本命中检测、映射文件权限不足或 vault commit 不完整时失败关闭。提交不改变题目、资产、strategy、publish binding 或 session。

### 8.7 删除与保留

**Given** 本地反馈处于 DRAFT、SUBMITTED 或已达到 retention。

**When** owner/admin 执行删除或学校数据责任人触发保留策略。

**Then** DRAFT 可删除并写无正文 tombstone；SUBMITTED revision 默认不可覆盖；retention purge 才能物理清除正文和 identity-map，并保留不含个人信息的 hash/tombstone。外部已下载文件不由应用宣称可撤回。

### 8.8 历史正式 18+6

**Given** 旧 `strategy_job_skill_shelver_v1` 和旧正式 `SESSION_STARTED` v1/v2 命中冻结兼容注册表。

**When** 读取历史 session 或创建符合正式 authority 的新正式 session。

**Then** 解释为 `FORMAL_DEMO`，固定 18+6、/48、正式 result/report 链保持不变；不能把旧缺失字段解释为 PREVIEW_ONLY，不能修改历史 event/result/report。

## 9. 生命周期与状态合同

| 对象 | 状态/生命周期 | 不可逆事实 | 失败关闭 |
|---|---|---|---|
| 发布 source binding | `ACTIVE -> REVOKED/SUPERSEDED` | source/question/pack/authority/hash 不原地改写 | 过期、hash 漂移、scope 错误或来源缺失拒绝新 session |
| responsibility manifest | `ISSUED -> REVOKED/SUPERSEDED` | canonical payload、签名、责任集合和 hash 不变 | 签名/key/集合/期限任一错误拒绝 |
| preview approval | `ISSUED -> EXPIRED/REVOKED/SUPERSEDED` | approval ID/hash 与授权范围不变 | 到期阻断未完成发布和新 session，不回写历史 |
| principal binding | `ACTIVE -> REVOKED/SUPERSEDED` | user/principal 双向关系和版本不原地改写 | 缺失、多值、反向重复、范围错拒绝 |
| preview pack | `PUBLISHED -> DISABLED/RETIRED` | 被 session 引用版本只读 | 停止新分配，历史 session 按 snapshot 读取 |
| preview session | `CREATED -> STARTED -> COMPLETED/ABORTED/TECHNICAL_INTERRUPTION/REDLINE_HALTED` | snapshot/题目/资产/hash 不漂移 | 恢复只读冻结事实；不重规划、不换题 |
| feedback draft | `DRAFT -> SUBMITTED/DELETED` | 每次 commit 有 hash/version | 写入不完整则不暴露为可恢复草稿 |
| feedback revision | append-only `SUBMITTED/EXPORTED` | previous hash、正文 hash、匿名 refs 固定 | 冲突创建新 revision 或拒绝，不覆盖旧 revision |
| identity-map | `ACTIVE -> REVOKED/PURGED` | 映射不进入外发物；purge 留无 PII tombstone | 权限/完整性失败禁止解匿名或外发 |

## 10. 迁移、回滚与版本漂移

### 10.1 迁移前置条件

1. 本阶段不执行迁移；后续若批准组合方案，必须新增明确的 migration ID/version，遵循现有 `schema_migration`、`runDatabaseMigrations()`、`foreign_key_check`、`integrity_check` 和 `migration-backup` 流程。
2. 迁移开始前必须先完成 `[!]` verifier parity 修复或形成等价的独立验证器：`baseline.yaml`、`schema.sql`、M5B isolated verifier、`database-content-pack.json` 和 required ledger 对同一个 0.1.18 版本/迁移 ID 负责。不能用当前普通 `db:verify` 的 0.1.17 回报冒充 0.1.18 通过。
3. parity 门禁未通过时，禁止创建新的 preview source binding、执行新 migration、回填正式 source、宣布数据库已升级；本功能 PRD 和下一实现计划只能标为 `BLOCKED`。
4. 所有 DB 迁移使用显式目标库和阶段标记；禁止默认数据库初始化、全域 DELETE 或在迁移中把既有 `ACTIVE` 自动解释成双来源。

### 10.2 正式历史与新数据 backfill

- 不回写历史 session/event/result/report，不为历史 `ACTIVE` 题目臆造 `official_publish_set` 或 `preview_publish_set`。
- 旧正式 `strategy_id/version` 只通过冻结 legacy compatibility registry 解释为 `FORMAL_DEMO`；新正式 session 在切换后仍必须具有可验证正式 authority。缺 authority 时失败关闭，不以迁移时的题目状态补齐。
- 预览题目初始可以保持 DRAFT/目录可见；只有经签名 preview approval 和原子发布命令的精确题目才建立 preview binding。
- 既有 `user_account` 不按 username/display name 自动映射 principal。缺 signed mapping 的 ADMIN 必须先完成独立映射注册，否则发布命令不可执行。
- userData vault 首次启用只做格式版本检查和显式导入；无法验证 manifest/root hash 的旧反馈文件进入只读隔离，不自动纳入新 revision。

### 10.3 数据库 rollback

- migration 失败：事务回滚；若已执行结构性变更，按 `createVerifiedMigrationBackup()` 生成的 DB/action-log 成对验证备份恢复，恢复后运行 `integrity_check`、`foreign_key_check` 和版本/verifier 检查。
- 不提供未经审批的 down migration，不删除新表/事件以“回滚”；恢复目标是最后一个已验证的数据库/日志对。
- 新应用版本不可读取新 preview contract 时，必须在启动/命令边界识别 contract version 并停止新的预览发布/session，而不是把新事实当成正式事实；旧正式 18+6 读取保持兼容。
- rollback/disable 只停止新 preview pack 分配，保留已创建 preview snapshot、事件、作答事实、反馈 revision 和审计 tombstone；不得物理删除历史业务数据。

### 10.4 userData vault rollback

- vault 迁移采用新目录/manifest version、journal PREPARE/COMMIT 和目录 fsync；旧版本保留只读备份，不能原地覆盖未验证文件。
- vault commit 未完成、hash/identity 漂移或权限不符时，只读失败关闭；不得把半写文件导出或推断为最后草稿。
- 回滚保留原有提交 revision 和 tombstone；只回退未提交临时文件，不回退已提交的匿名引用或历史责任。

## 11. 非功能要求

### 11.1 一致性、恢复和可观测性

- 所有受控状态变化遵循 `INV-EVT-001/002/003`；command ledger 遵循 `INV-EVT-004`；PREPARE recovery 遵循 `INV-EVT-005`；production mutation 遵循 `INV-EVT-006`。
- 事件、source binding、approval、mapping 和 vault revision 都要有稳定 hash/version；每个失败有可公开的稳定 error code，不把敏感正文放进错误信息。
- 需要记录 recovery outcome、rollback outcome、replay count/plannerCalls=0、vault reconcile 状态，但不记录凭据、绝对路径、原始答案或自由文本。

### 11.2 隐私

- 默认外发最小化；真实映射只在 private userData，权限 0700/0600，业务 ACL 先于文件读取。
- 外部反馈、日志、Prompt、telemetry 和报告查询均必须通过显式 serializer allowlist；禁止用“删掉常见字段”作为唯一脱敏证明。
- 学校数据责任人、应用管理员、教师和产品维护者的访问/删除责任必须在实施计划中落成 ACL 和人工验收；没有责任主体的“自动清理”不算完成。

### 11.3 兼容与可访问性

- 旧正式 18+6 结果/报告和安全三元聚合不可被新预览合同改写。
- UI/HTML 的可访问性由后续实现验收承担；本合同要求错误码、空状态、权限拒绝和保存失败可被 UI 区分，不可只显示“失败”。

## 12. 跨文件副作用登记

| 主变更 | 必须同步核验 |
|---|---|
| release source / binding | Schema、migration、repository、source validator、formal/preview query、唯一性/状态触发器、content pack verifier、隔离 DB fixture |
| responsibility/approval | trust-anchor registry、canonical JSON/signature verifier、manifest/approval schema、scope/expiry/hash checks、public errors、审计和 lifecycle revoke |
| principal mapping | enrollment/rotation provisioning、`user_account`/`auth_session`、Electron sender guard、CLI auth context、双向 unique、mapping version/hash、角色/组织 ACL、signer-executor negative tests |
| preview release command | command definition/closed registry、request hash、durable coordinator、M5B EventType/payload/validator/projector/cursor/recovery/result recipe、fault matrix、replay |
| preview aggregate/event registry | logical aggregate/status table、legacy compatibility registry、EventType/schema version、payload validator、projector/reducer、recovery、migration contract、unknown-version fail-closed tests |
| session freeze | strategy validator、assessment snapshot/parser、legacy v1/v2 registry、`PREVIEW_SESSION_COMPLETED`、prepared projector/reducer、assignment/grant、safety FSM、scoring planner、result/report queries |
| result/report suppression | completion planner、result writer、report writer/export、redline path、replay、query/statistics filters、18+6 regression |
| feedback vault | path capability、vault schema/journal/manifest、ACL、autosave/revision/hash、identity map、two-phase commit/reconcile state、serializer allowlist、PII scanner、JSON schema、Markdown generator、delete/tombstone/recovery tests |
| migration/verifier | migration list/ledger、backup/recovery、database-content-pack、baseline/schema version, isolated verifier, downgrade guard, docs and acceptance evidence |

任何登记项未全链完成，不能把实现步骤标为完成；主循环或高能力 Reviewer 必须进行一次跨文件同步核验。

## 13. 验收标准（AC）

本节是后续 `/vibe-impl` 的可机械验收合同。本轮 feature 阶段只定义标准，不执行运行时验收；未执行项必须保持 `NOT_RUN`。

### AC-R3-01 双来源权威与四态矩阵

Given 两个精确 question_ref 和四种 source 组合 `00/10/01/11`，When 分别执行 formal/preview session preflight，Then 只能在对应 source 有效时成功；正式先/预览先两个顺序分别覆盖，`ACTIVE` 单字段不能改变结论。

验证：隔离 SQLite/read-model table test + 正负 authority fixture + `FORMAL_RELEASE_AUTHORITY_MISSING`/`PREVIEW_RELEASE_AUTHORITY_MISSING` 断言。当前状态：`NOT_RUN`。

### AC-R3-02 来源不可互推与撤销

Given 只有 official 或只有 preview binding，When 撤销、过期或 hash 漂移该 binding，Then 另一 source 不被自动创建/保留授权；历史 binding 保留，新的 session 失败关闭。

验证：source lifecycle/replay test，覆盖正式先、预览先和双来源撤销。当前状态：`NOT_RUN`。

### AC-R3-03 责任/批准/hash 精确绑定

Given manifest/approval 中任一 pack、question、asset、renderer、evidence、strategy、scope、期限或 canonical payload hash 改变，When 运行验证器，Then 返回稳定 approval/hash error，未写入 ACTIVE/source/pack/audit 成功事实。

验证：签名篡改、字段顺序/未知字段、范围扩大、过期时间边界、精确集合差异 fixture。当前状态：`NOT_RUN`。

### AC-R3-04 principal 双向唯一和可信来源

Given 缺失、多值、反向重复、撤销、过期、签名错、组织错、请求自报或非 ACTIVE ADMIN 的映射，或全新安装缺少 anchor/installation certificate/proof-of-possession/authority registry/enrollment package 任一 bootstrap 证据，When Electron 或 CLI 执行发布、enrollment 或 rotation，Then 发布返回 `PREVIEW_PACK_RELEASE_EXECUTOR_IDENTITY_INVALID`，bootstrap 返回精确的 `INSTALLATION_TRUST_UNAVAILABLE`、`INSTALLATION_IDENTITY_INVALID`、`AUTHORITY_REGISTRY_INVALID` 或 `PRINCIPAL_ENROLLMENT_REQUIRED/INVALID`，rotation 返回稳定 conflict/revoked error；数据库、event log 和 vault 无业务写入。合法 sender/CLI user 只能解析受信预注册 mapping，不能在发布命令中自建 mapping。

验证：auth/mapping matrix + sender spoof + CLI argv/env spoof + reverse uniqueness fixture + anchor/证书/PoP/registry 替换和错绑定 fixture + 首次 bootstrap、重复 enrollment、撤销后发布、rotation/key-rotation 正负 fixture。当前状态：`NOT_RUN`。

### AC-R3-05 signer/executor 职责分离

Given signer/approver 与 executor principal 相同，或与责任集合禁配主体相交，When 执行发布，Then 返回 `PREVIEW_PACK_RELEASE_SEPARATION_OF_DUTIES_FAILED`，无部分 ACTIVE/pack/source。

验证：角色集合交集表驱动测试；合法分离路径必须有正向 fixture。当前状态：`NOT_RUN`。

### AC-R3-06 发布命令幂等与冲突

Given 同一 client/idempotency key，When 同 hash 重放或不同 hash/actor/device/auth/mapping 重放，Then 同 hash 返回原 durable result，不产生第二 batch；漂移返回 `PREVIEW_PACK_RELEASE_CONFLICT`，不覆盖历史。

验证：durable-command coordinator integration test。当前状态：`NOT_RUN`。

### AC-R3-07 PREPARE/APPLY 崩溃恢复与回放

Given PREPARE fsync 后在每个 APPLY 写入点注入崩溃，When startup recovery/replay，Then 只能完整 APPLY 或只读失败关闭；planner 不再调用，不能留下半 ACTIVE、半 pack、孤立 source 或第二结果。

验证：M5B fault matrix、tamper/recovery、replay fixture，要求记录 `plannerCalls=0`、唯一 batch/result 和 `foreign_key_check/integrity_check`。当前状态：`NOT_RUN`。

### AC-R3-08 PREVIEW snapshot 冻结与 payload 判别

Given 新 PREVIEW session snapshot 已提交，When 修改当前 strategy/question/asset/source/read model 或重启，Then 恢复仍使用冻结 mode/pack/source/hash；旧正式 v1/v2 只按 registry 解释为 FORMAL_DEMO，未知/缺失/错版、未知 aggregate 或未注册 delivery mode 均失败关闭，不能回退到现有正式 status/strategy_type。

验证：snapshot/replay test、legacy compatibility table test、root hash tamper test、aggregate/status/EventType registry inventory、migration 前后 replay fixture。当前状态：`NOT_RUN`。

### AC-R3-09 PREVIEW completion/result/report 抑制

Given PREVIEW session 正常完成、作废、技术中断和红线终止，When 执行 completion/scoring/report/replay/query，Then 只能生成已注册的 `PREVIEW_SESSION_COMPLETED` 或相应过程/安全事实，但不新增任何 `result_record`、正式 `task_report`、`FULL_REPORT`、`SAFETY_TERMINATION_REPORT` 或正式等级；未知 EventType/aggregate 直接只读失败，红线仍生成 incident/binding。

验证：结果/报告集成测试、SQL 断言、红线回归、replay 和查询过滤、unknown aggregate/event negative fixture。当前状态：`NOT_RUN`。

### AC-R3-10 正式 18+6 历史兼容

Given 旧 `strategy_job_skill_shelver_v1`/兼容 registry 和现有历史 session/event/result/report，When 读取或运行正式示范路径，Then 仍为 FORMAL_DEMO、18+6、/48 和正式报告；不回写历史、不读取预览 source 作为正式 authority。

验证：既有 JOB_SKILL result/report 回归 + legacy v1/v2 replay fixture。当前状态：`NOT_RUN`。

### AC-R3-11 feedback vault 原子草稿与 revision

Given autosave、submit、crash、重复导出、修订和 vault 文件/权限/hash 故障，When 在 vault PREPARE、vault COMMIT、目录 fsync、SQLite reference commit 或重启恢复的任一点退出，Then 每个 vault manifest、SQLite reference、tombstone 都对 `feedback_commit_id` 和 `(feedback_id, revision_no, operation)` 执行唯一校验；只显示 `RECONCILED_SUBMITTED` 的最后完整 commit；`ORPHAN_REFERENCE`、`ORPHAN_VAULT_COMMIT` 和 `RECONCILE_REQUIRED` 均不可查询正文、不可导出、不可显示为 submitted，只能按同一 proof 幂等修复或写无正文 tombstone。feedback ID/匿名 ref 稳定，修订 append-only，半写正文不被导出。

验证：userData 隔离目录 fault injection、vault-first/DB-first 异常状态、每个 fsync 点、两边 unique/collision fixture、权限/identity/path probe、journal replay、commit idempotency、revision hash chain。当前状态：`NOT_RUN`。

### AC-R3-12 feedback privacy/export allowlist

Given HTML/JSON/Markdown、日志、Prompt 和错误路径中包含真实 ID、PII、凭据或自由文本，When 默认导出或显式外发，Then 默认模式剔除/拒绝，命中敏感数据时失败关闭；只有重新扫描、脱敏预览和教师确认后才允许外发。

验证：serializer allowlist、PII 正负 fixture、匿名 ref 非确定性/不可推导测试和人工抽查。当前状态：`NOT_RUN`。

### AC-R3-13 feedback ACL/query/delete

Given STUDENT、TEACHER、ADMIN、学校数据责任人和不同组织/owner，When 查询、编辑 draft、提交、导出或删除，Then 只有合同允许的主体可做对应操作；`FEEDBACK_REFERENCE_REPAIR`、`FEEDBACK_TOMBSTONE`、`FEEDBACK_PURGE` 和 `IDENTITY_MAP_READ` 必须分别验证签名 capability、target scope、期限、SOD 和 capability 类型，普通 ADMIN/教师角色不能隐式获得；任一单边提交或修复状态均不可导出，删除必须先完成 vault tombstone，再以匹配 commit proof 写主库 tombstone；不能改变题目、pack、strategy 或历史 revision。

验证：权限矩阵、cross-organization negative fixture、reference repair/tombstone/purge/map-read capability fixture、被撤销/过期 capability、双签 SOD、retention purge、two-phase tombstone/purge recovery 和 audit test。当前状态：`NOT_RUN`。

### AC-R3-14 migration parity、备份和 rollback

Given 0.1.17 ledger 配置漂移、0.1.18 baseline/schema、旧正式 DB、部分迁移、备份失败或恢复后 verifier 不一致，When 执行 migration preflight/upgrade/rollback，Then 版本不一致必须 `BLOCKED`；通过时有成对 DB/action-log 备份、幂等 migration、完整性检查和可读的 rollback 结果；不得自动从 ACTIVE 回填双来源。

验证：显式 `/tmp` legacy/current fixture、migration backup/restore、ledger parity verifier、`npm run db:verify` 与 `npm run db:m5b:isolated:verify -- --stage full` 对账。当前状态：`NOT_RUN`；本轮仅记录现有 drift。

### AC-R3-15 事件/投影/查询全链登记

Given 任一新 EventType、command、aggregate、status、read model 或 vault journal version，When 运行 inventory/validator/replay/contract tests，Then payload、权限、持久化目标、唯一约束、projector、cursor、recovery、query、error mapping、migration contract 和回放均有登记；旧正式 v1/v2、新 preview registry、`assessment_session` 兼容 shell、migration 中断和未知版本/aggregate 都按 §6.9.1 决策表解释，未知项失败关闭。

验证：`INV-EVT-003` cross-file inventory、M5B registry tests、legacy formal replay、preview aggregate/status registry、四类新 projection 的 unique/FK/constraint inventory 和 migration pre/post/rollback replay tests。当前状态：`NOT_RUN`。

### AC-R3-16 feature 边界与默认库保护

Given 本轮 feature 文档完成，When 检查 Git diff、路径和数据库访问记录，Then 只有本 Mini-PRD、通过后的交接/索引文档属于本轮新增文档；`schema.sql`、migration、runtime、题目/素材/策略、默认 DB 无写入，原 dirty 改动无丢失。

验证：`git status --short --branch`、`git diff --check`、目标文件 hash/diff 审阅；默认数据库路径不作为命令参数。当前状态：本轮读取与边界检查 `PASS`，最终 diff 检查待收尾。

### AC-R3-17 跨边界反馈提交裁决

Given `feedback_commit_id` 在 vault 或 SQLite 任一边界已经存在，When 以相同或不同 request hash 重试提交、导出、tombstone 或 purge，Then vault manifest 是 collision authority，vault/DB/tombstone 均拒绝重复 `(feedback_commit_id)` 与 `(feedback_id, revision_no, operation)`；相同 proof/hash 只能返回同一状态，异 hash、异 revision commit 或 submit/delete 状态冲突均返回稳定 error；只有 `RECONCILED_SUBMITTED/RECONCILED_DELETED` 可对外可见，单边 commit、孤立 reference 或修复队列状态必须保持 private/read-only，不能产生第二 revision、孤立 export 或正文复活。

验证：vault-first、DB-first 异常状态、vault/DB/fsync/crash fault matrix、两边 unique/index/collision fixture、repair capability ACL、commit proof/hash 对账和重启 replay。当前状态：`NOT_RUN`。

## 14. 适用不变量

- `INV-EVT-001`：受控状态由领域事件推进。
- `INV-EVT-002`：事件持久化顺序唯一。
- `INV-EVT-003`：新 EventType 全链登记。
- `INV-EVT-004`：已受理命令一个幂等键对应一个 request hash 和确定结果。
- `INV-EVT-005`：已准备批次只能由冻结事件恢复。
- `INV-EVT-006`：生产 mutation 只能走 v2 批次边界。
- `INV-AUTH-001`：TEACHER/ADMIN 边界及权限敏感操作的可信 caller。
- `INV-AUTH-002`：student/device/business_session 三方一致和授权状态机。
- `INV-RES-001`：四类正式结果不混算。
- `INV-RES-002`：安全优先级高于普通评分。
- `INV-STR-001`：session 引用必须匹配同一 strategy 版本。
- `INV-STR-002`：被引用 strategy 版本语义不可漂移。
- `INV-IPC-001`：新 IPC 必须完成 handler/preload/shared type/权限/参数/错误登记。
- `INV-IPC-002`：Renderer 不得直读 Node/文件/DB。
- `INV-DATA-001`：JSON TEXT 写入前完成结构和语义校验。
- `INV-DATA-002`：策略数据不得硬编码。
- `INV-DATA-003`：迁移可升级、可重放且有验证入口。
- `INV-A11Y-001`：后续 UI/反馈人工可访问性验收。

## 15. 风险、回滚与停止条件

### 15.1 主要风险

1. 用 `ACTIVE` 或普通策略 JSON 误授予另一条发布路径。
2. 把 signed `principal_id` 当成请求正文文本，造成伪造或 signer/executor 同主体。
3. 只复用 M5B byte durability，却没有业务 EventType、read model 和恢复 recipe，重启后不能复算授权。
4. 预览在 completion/scoring/report 之间串入正式结果，或红线误写安全终止报告。
5. 主库与 userData vault 跨边界提交不一致，半写反馈泄漏或反馈 reference 宣称已提交。
6. migration/rollback 误删历史数据，或把旧 `ACTIVE` 状态批量回填为正式/预览来源。
7. 0.1.17/0.1.18 verifier 漂移造成“数据库验证通过”但实际没有验证当前基线。
8. 首次 principal enrollment 或轮换没有可信 bootstrap chain，导致发布永久无法启动或被自注册绕过。
9. 新 preview aggregate/EventType 与当前正式 status/strategy 边界混用，回放时把预览误解为正式事实。

### 15.2 失败关闭规则

- 权威 source、scope、签名、期限、hash、principal、组织、题目状态、资产/renderer/evidence 或 assignment/grant 任一缺失/不一致：拒绝新发布/session，不回退到默认路径。
- 无可信 enrollment/rotation chain、同幂等键异 hash、同 approval ID 异 hash、事件/aggregate/recipe/projector 未注册、PREPARE source 缺失或 vault commit 不完整：返回稳定错误或只读故障，不重试产生新副作用。
- 任何反馈 serializer 无法证明 allowlist 或检测命中 PII：禁止外发；不把本地草稿自动转成外部 JSON。
- `ORPHAN_REFERENCE`、`ORPHAN_VAULT_COMMIT`、`RECONCILE_REQUIRED` 和未知 contract version 不是成功状态；不得显示为 submitted、创建正式结果或降级到旧正式 aggregate。
- 任何 migration parity、backup、integrity、foreign key 或 rollback 证据失败：停止升级/新发布；不访问默认库，不通过手工“修正”继续。

### 15.3 本目标的停止条件

出现任一情况，当前 R3 feature 只保留证据并标记 `BLOCKED`，不得进入 `/vibe-impl`：

- 权威 PRD/Schema/不变量之间的冲突未以 `[!]` 记录并没有最小决策。
- 独立 R3 review 存在未关闭 P0/P1，或两轮修订后仍有 P0。
- 无法用候选方案机械失败关闭双发布来源、principal 唯一映射、职责分离、PREPARE/APPLY、预览结果抑制或隐私外发。
- 需要提前实施 Schema/migration/权限/文件 vault 才能决定合同，而本文没有给出可审查的逻辑边界和 AC。
- verifier 0.1.17/0.1.18 parity 未达成却试图宣称迁移或数据库验证通过。
- 要求访问默认数据库、清理 dirty 工作树、恢复 stash、提交/推送/合并或修改题目/素材/策略状态。

### 15.4 回滚原则

- feature 文档回滚：只撤销本轮新增文档，不触碰既有 dirty 文件；不得用回滚掩盖审查 finding。
- 设计进入实施后：遵循 §10 的成对 DB/action-log 备份、additive migration、disable-new-release 和 vault journal rollback；不提供无审计物理删除。

## 16. 已确认决策、假设与未解决问题

### 16.1 已确认决策

1. 本功能风险定为 R3；下一步必须先完成独立 `/vibe-review`，不能直接 `/vibe-impl`。
2. `official_publish_set` 与 `preview_publish_set` 永远是两个独立 authority namespace；`ACTIVE` 不构成授权。
3. 推荐组合方案 C：主库关系 read model + M5B event/replay + private userData feedback vault；不得把三者的物理安全原语写成已存在业务合同。
4. 发布执行身份必须是 trusted auth `user_id` 加 signed、双向唯一 mapping 推导的 principal；请求正文、姓名或角色不授权。
5. PREVIEW session 用新判别 payload 和 `PREVIEW_SESSION_COMPLETED`；正式 18+6 旧 v1/v2 和正式结果/report 兼容不回写。
6. 外部反馈匿名引用随机且不可由真实 ID 推导；JSON 权威，Markdown 仅生成物；draft/revision/tombstone/delete 由 private vault 负责。
7. 0.1.17/0.1.18 verifier parity 是进入 migration implementation 的硬前置；本 feature 不修该漂移。
8. principal enrollment/rotation 通过独立受信 provisioning package 和 signer/executor 分离闭合；普通 ADMIN、发布 approval 和请求正文不能自建 mapping。
9. feedback vault 以 `feedback_commit_id` 和两阶段 reconcile 状态作为跨边界提交合同；只有 `RECONCILED_SUBMITTED/RECONCILED_DELETED` 对外可见。
10. PREVIEW 使用独立逻辑 aggregate/status/EventType registry；旧正式 status/strategy 只解释旧正式事件，未知项 fail-closed。

### 16.2 合理假设

- 学校安装环境可以提供受控 userData 根和目标库组织范围；若无法提供，feedback vault 合同必须失败关闭而不是写入任意路径。
- 产品负责人信任根/authority registry 可通过安装版完整性建立，不需要把私钥放入仓库或目标数据库。
- 现有 M5B durable command/event batch 可作为基础，但具体 release/session/feedback EventType、projector、recipe、vault journal 均尚未实现。
- 现有正式 18+6 strategy/version 可纳入冻结 legacy compatibility registry；这只说明兼容解释规则，不自动创建缺失的正式发布批准。

### 16.3 仍需在 `/vibe-impl` 前锁定的实现细节

这些不是本 Mini-PRD 的产品语义空缺，但必须在实现计划中逐项落到文件、迁移和测试：

1. 组合方案中主库 projection 的具体表/列/trigger；逻辑 aggregate、状态和事件边界已由 §6.9 固定。
2. vault journal 和主库 reference 的具体文件/表实现；两阶段顺序、`feedback_commit_id`、每个故障点的裁决和 repair ACL 已由 §6.7.5 固定。
3. authority registry、principal enrollment/rotation 和 trust anchor 的具体 canonical JSON schema/key rotation 实现；bootstrap chain、SOD、scope 和 public error 已由 §6.4.3 固定。
4. migration 的具体 ID、backup stage、旧 DB upgrade fixture 和 verifier parity 修复的单独维护任务；migration 前后 registry/replay 边界已由 §6.9 固定。
5. 反馈 ACL 的 organization/user scope 与学校 retention policy 的实际配置来源。
6. 原产品 AC-17 的固定设备档案、fixture、冷/热缓存和测量次数；实现计划/验收包必须在执行前声明并复用同一 profile。

若这些细节发现会改变本节已确认的权威、权限、恢复或隐私语义，必须退回新的 R3 设计审查，不得在实现步骤中自行缩小范围。

## 17. 当前验证状态与交接

| 检查/证据 | 状态 | 说明 |
|---|---|---|
| 必读基线和工作流文件 | PASS | 已完整读取并按权威入口核对 |
| Step 1 可行性、独立 review、acceptance、原 Mini-PRD、原 impl、完整 `schema.sql` | PASS | 已读取；当前不足结论和边界已纳入本文 |
| 分支/stash/dirty/recent log 现场 | PASS | `feat/multi-device-m2-prd`；dirty；stash 列表为空；最近提交已记录；未清理现场 |
| 默认数据库访问 | PASS | 本轮未访问/初始化/修改；所有事实来自文件和既有隔离证据 |
| Schema/migration/runtime/题目/素材/策略写入 | PASS | 本轮作者未写入；目标合同已获 R3 PASS 但本目标仍未实施；独立 review 产物单独保存 |
| 方案矩阵和核心合同覆盖 | PASS | 四类候选、双来源、身份、幂等恢复、session/result、反馈生命周期、迁移/rollback、verifier drift 已定义 |
| 独立 `/vibe-review` 第一轮 | CONDITIONAL_PASS | 独立子代理报告 P0=0、P1=3、P2=2；当前按最多两轮规则关闭 P1 后重审 |
| 独立 `/vibe-review` 第二轮 | BLOCKED | 独立子代理报告 P0=1、P1=2、P2=1；已进入第二次也是最后一次合同修订，修订后必须重新独立审查 |
| 独立 `/vibe-review` 最终轮 | PASS | 独立子代理报告 P0=0、P1=0、P2=2；只批准进入 `/vibe-impl`，不批准实现已完成 |
| `npm run docs:index:update` / `docs:index:check` | PASS | 审查通过后已更新并确认 `doc/index.md` 当前 |
| `npm run typecheck` | PASS | `vue-tsc --noEmit` 与 Node `tsc` 均退出 0 |
| `npm run lint` | PASS | 退出 0；现有工作区有 663 个 warning、0 errors，未把 warning 冒充 error |
| `npm run contract:job-skill:check` / `contract:job-skill:delivery:check` | PASS | 两项既有 JOB_SKILL 合同检查均退出 0 |
| `git diff --check` | PASS | 最终文档与既有 dirty diff 无空白错误 |
| `npm run build` / 全量 `npm test` / Electron / 默认 DB verifier | NOT_RUN | 本目标不把未执行项写成通过；默认 DB verifier 明确禁止访问 |

## 18. 下一步与批准边界

1. 最终独立审查记录为 `doc/features/job-skill-298-full-preview-persistence-contract-prd-r3-review-final.md`，结论 `PASS`、P0/P1 为零；前两轮的 finding 和修订记录保留，不作为最终 PASS 的替代证据。
2. 本文状态已改为 `APPROVED`，只批准下一会话进入 `/vibe-impl`；当前目标不执行 `/vibe-impl`，不恢复原 Step 2-9。
3. 当前目标只同步 `.continue-here.md`、`doc/会话启动.md`、`doc/specs/baseline.yaml` 和 `doc/index.md` 的导航状态；不实施 Schema/migration/EventType/IPC/文件 vault/UI，不访问默认数据库。
4. verifier parity、migration/rollback 和全部运行时 AC 仍是后续实现/验收门禁；未执行项必须保持 `NOT_RUN`，任何实现语义变更都需重新走 R3 review。
