# JOB_SKILL 298 题全量预览 Step 1 持久化可行性证明

## 1. 结论

- 日期：2026-08-01
- 范围：`doc/features/job-skill-298-full-preview-impl.md` Step 1，仅做持久化可行性证明与停止门
- 风险：R3
- 证据基线：Schema `v0.1.18-event-batch-v2.2`；Git `f2a1504ee2da` 加当前 dirty 工作树
- 二元结论：`[!] EXISTING_STRUCTURE_INSUFFICIENT`
- 实施状态：`BLOCKED`。当前结构不能在不新增 Schema/migration/权限或本地持久化合同的条件下，可靠承载双发布来源、签名 principal 映射、职责分离、PREVIEW_ONLY 冻结恢复和匿名反馈映射。
- 后续边界：停止当前实施，不进入 Step 2；下一唯一动作是 `/vibe-feature`，定义并独立 R3 审查 Schema/数据合同。未经批准不得修改 Schema、发布权限或运行时实现。

这不是“测试尚未补齐”的结论。现有表和事件合同没有保存若干必需事实的位置，也没有对应唯一约束、外键、触发器或封闭命令/事件注册。把这些事实临时塞入普通 JSON、请求正文、UI 状态或日志，不能满足不可变性、权限和恢复要求。

## 2. 判定标准与取证方法

本证明按以下规则判定：

1. 每项要求必须能从当前持久化事实机械重算，不能依赖名称、题量、当前 `ACTIVE` 状态或调用方自报身份推断。
2. “JSON 可以保存字段”不等于已具备结构校验、唯一性、范围约束、职责分离、冻结恢复或防泄漏能力。
3. 通用 durable command/event batch 能力只有在命令、规范化业务输入、冻结事件、projector 和结果 recipe 全链登记后，才能证明具体业务命令可恢复。
4. 任一要求需要新增表、列、trigger、权限或持久化约束，Step 1 即判为现有结构不足。
5. 静态合同已经足以否证时不新增探针。探针不能为不存在的数据关系或权限约束制造证明。

适用不变量为 `INV-EVT-004/005/006`、`INV-AUTH-001/002`、`INV-RES-001/002`、`INV-STR-001/002`、`INV-DATA-001/002/003`。其中：

- `INV-EVT-004` 要求同一幂等键只对应一个 request hash 和确定结果（`doc/specs/project-invariants.md:61-72`）。
- `INV-EVT-005` 要求 PREPARE 后只从冻结事件恢复，不重新规划（`doc/specs/project-invariants.md:74-85`）。
- `INV-STR-002` 只保证已被 session 引用的策略版本语义不漂移（`doc/specs/project-invariants.md:219-227`），不能替代发布批准自身的不可变性。
- `INV-DATA-001` 要求 JSON TEXT 写入前有当前结构和语义校验（`doc/specs/project-invariants.md:256-268`）。

## 3. 证据锚点

以下 hash 锚定本次读取的关键实现；文档完成后复验这些文件不因 Step 1 被修改：

| 文件 | SHA-256 |
|---|---|
| `src/main/db/schema.sql` | `05fd50169b8ed1108682d4aad40b707a98a8f24d7b9cf8d50a6ae27dd79a5b76` |
| `src/main/utils/auth-session.ts` | `9396e28e15c2ee60a444d3c993a2254ab8148dac657de50412ddacdc5219f880` |
| `src/main/application/command/m5a-command-definitions.ts` | `f61504db3abca05dd1beddb8543d99676cf8c3a9f41320ddf5276390c6b02690` |
| `src/main/application/command/durable-command-coordinator.ts` | `97dbf07e19403ae582fed1acbfb59a828c90c9a94dafeeea7c4be3a361fbc74b` |
| `src/main/domain/event-batch/batch-coordinator.ts` | `23bac280edd5004e5d873a363227b064b095291bada0577bde6bd533ae8b9104` |
| `src/main/domain/event-batch/startup-recovery.ts` | `dbe66334a4cb4d2560c57dd12232f2a2945b368c8c5f8aabfc2f6010dfb11aad` |
| `src/main/domain/assessment-session-snapshot.ts` | `39a816219e7d6be5170e266c2f0fd059d218c77a42d9285575f96af31090581f` |
| `src/main/application/planners/scoring-planner.ts` | `4211347a3611b1276d435322f3d4297ef6309861b7ec903aced742aa2e389074` |
| `src/main/domain/report-export.ts` | `3759338b0a32c6d00432e2bb33f8a2262828877e8cbea6f45c865c44a41d333b` |

运行时存在性搜索：

```bash
rg -n 'JOB_SKILL_PREVIEW_PACK_RELEASE|PREVIEW_PACK_RELEASE|official_publish_set|preview_publish_set|principal_id|responsibility_manifest|session_export_ref|subject_export_ref|feedback' \
  src/main src/shared scripts --glob '!**/__tests__/**'
```

结果为空。当前 production mutation 封闭清单位于 `src/main/application/command/m5a-command-definitions.ts:1088-1135`，其中也没有发布包或反馈 mutation。

### [!] 3.1 既有 DB verifier 版本口径漂移

显式临时库上的 `db:sync` 与 `db:verify` 均返回 PASS，但 verifier 报告的 schema 是 `0.1.17-multi-device-m4-safety-rekey`。原因不是临时库漏执行 DDL，而是 `scripts/config/database-content-pack.json:2-37` 的 `schemaVersion` 和 `requiredMigrationLedger` 仍止于 0.1.17；`verifyDatabase()` 直接回报该配置值（`scripts/lib/database-content-pack.mjs:395-405`）。与此同时：

- `doc/specs/baseline.yaml:76-80` 和 `src/main/db/schema.sql:1-24,2530-2543` 声明当前为 `0.1.18-event-batch-v2.2`；
- `npm run db:m5b:isolated:verify -- --stage full` 在七个隔离临时根上验证并回报 `schema=0.1.18-event-batch-v2.2`。

因此普通 `db:verify` 的 PASS 可证明当前内容包、显式 Schema 对象、题库和旧 required ledger 自洽，但不能单独作为“已检查 0.1.18 ledger 标签”的证据。本 Step 不修改这项既有配置漂移；独立 R3 Schema/数据合同应将它列为基线输入，或另立维护项收口。

## 4. 可重算证据矩阵

| 需求事实 | 当前持久化/实现 | DB、事件与权限约束 | 幂等/中断恢复 | 结论 |
|---|---|---|---|---|
| 同一题目语义版本分别属于 `official_publish_set`、`preview_publish_set`，两种发布顺序不得互相授权 | `question_bank` 只有单一 `status` 与 `version`（`schema.sql:413-460`）；`strategy_config` 只有通用 `question_policy_json`（`:321-359`）；session 选题只检查题目为 `ACTIVE`（`:2283-2301`；`assessment-service.ts:511-546`） | 没有发布来源实体、题目语义版本到来源的关联、mode/scope、来源状态或两条来源的唯一约束。通用 `domain_event_projection.payload_json`（`schema.sql:475-504`）没有对应封闭 event validator/projector | 通用账本不能从 `ACTIVE` 还原由哪条来源授权，也不能在重启后复验某个 mode 的独立来源 | **FAIL**。至少需要独立、可查询、不可混淆的持久发布来源及约束；现有结构无法证明反向越权拒绝 |
| 不可变责任清单、批准、pack/strategy/question/asset/renderer/evidence hash、有效期与 scope | `asset_resource` 只保存文件完整性和状态（`schema.sql:368-404`）；策略 JSON 无这些强制字段；题目 ACTIVE/被引用后语义冻结（`:2191-2242`），策略仅在被 session 引用后冻结（`:2248-2276`） | 没有 responsibility manifest/approval、signer、scope、validity、pack version、evidence hash 绑定；没有 FK、唯一约束或有效期/范围 guard。未引用策略仍不能作为不可变批准权威 | PREPARE 只能冻结已注册事件中的事实；当前没有 release command/event/projector，也没有可供 planner 读取并绑定的批准记录 | **FAIL**。需要独立 R3 定义批准/责任/发布关系及不可变性；不能用任意策略 JSON 或事件 JSON 替代 |
| Electron sender-bound ACTIVE ADMIN，或独立 CLI 交互认证；签名 `user_id <-> principal_id` 唯一映射；signer/executor 分离 | `auth_session` 关联 `user_account.user_id` 并检查 ACTIVE/有效期（`schema.sql:92-102,202-224`；`auth-session.ts:254-293`）；IPC 会用 sender 绑定覆盖请求自报 caller（`auth-session.ts:388-409`） | 现有 sender-bound ACTIVE user 是可复用基础。但 `user_account`、`auth_session`、`CommandActor` 都没有 `principal_id`（`command-types.ts:8-20`）；没有签名映射、双向唯一性、signer/executor 字段或职责分离约束；没有目标库独立 CLI 登录上下文 | command stable replay 会绑定 actor/auth session，但不能绑定或验证不存在的 principal 映射；请求正文若自行携带 principal 也没有权威关系可核对 | **FAIL**。ACTIVE ADMIN sender 只满足一半；principal 唯一映射、CLI 认证和职责分离需要新的权限/持久化合同 |
| 相同 ID+hash 重放返回同一结果；同 ID 不同 hash 冲突；PREPARE/APPLY 中断后恢复 | `command_log` 持久化 request hash、batch、actor/auth 与结果，`ux_command_idempotency` 唯一（`schema.sql:2423-2486`）；coordinator 对同 key 的 command/request/actor/device/auth 漂移报冲突（`durable-command-coordinator.ts:104-139`）；PREPARE 后丢弃 planner 内存并重载 durable source（`batch-coordinator.ts:359-499`）；startup recovery 的 `plannerCalls=0`（`startup-recovery.ts:491-731`） | 通用机制已满足已登记命令的 INV-EVT-004/005；APPLY 将 batch、events、projection、projector/cursor 放在 IMMEDIATE transaction（`projection-source.ts:462-520`） | 既有测试覆盖同 key 同/异请求、租约接管（`durable-command-coordinator.test.ts:163-285`），以及 PREPARE/APPLY 故障恢复（`startup-recovery.test.ts:42-164`、`fault-matrix.test.ts:109-280`） | **通用基础 PASS，具体需求 FAIL**。没有 `JOB_SKILL_PREVIEW_PACK_RELEASE` 的规范化输入、approval ID/hash 语义、冻结 event/projector/result recipe，不能把通用恢复证明升格为预览发布证明 |
| 反馈仅外发随机 `session_export_ref`/`subject_export_ref`；真实 ID 映射只在本地 userData；自动保存、草稿恢复、稳定 feedback ID、revision 历史与防泄漏 | 运行时无 feedback repository/schema/IPC；上述存在性搜索为空。现有 `report-export.ts` 读取真实 `student_id`/`report_id` 并生成报告 HTML（`:112-141,260-267`），写到用户选择路径并记录 `REPORT_EXPORTED`（`:145-254`） | `report-presentation.test.ts:52-85` 只证明静态导出白名单和姓名/内部字段排除；`report-presentation.ts:111-115` 仍由真实 student ID 后四位确定性生成假名，不是随机、不可推导的 `subject_export_ref`。现有测试不证明随机双引用、本地真实 ID 映射、反馈自包含 HTML、草稿、revision、导出 Schema 或日志/Prompt 排除合同 | 报告导出有文件完整性与命令恢复，但没有反馈草稿/映射的原子持久化、重启恢复或修订 append-only 事实 | **FAIL**。需要受控 userData 本地存储、权限/生命周期和外发序列化边界；是否落 SQLite 或独立本地仓储须由 R3 数据合同决定 |
| PREVIEW_ONLY session 冻结 mode/pack/来源/hash；任何终态抑制正式 result/report；旧正式 18+6 保持兼容 | `assessment_session` 无 `delivery_mode`、pack/source/hash 字段（`schema.sql:520-607`）；旧 `SESSION_STARTED` v1 无判别字段（`event-payloads.ts:110-124`）；v2 明确是 BASE_ABILITY 快照（`:126-190`、`assessment-session-snapshot.ts:1-18`），parser 只识别旧 v1/v2（`assessment-event-contract.ts:61-97`） | EventType 没有 `PREVIEW_SESSION_COMPLETED`（`event-payloads.ts:44-87`）。JOB_SKILL 创建仅按固定集和 `ACTIVE` 检查，继续写旧 v1 payload（`assessment-service.ts:482-588,824-850`） | JOB_SKILL 到 `READY_TO_FINALIZE` 后自动写 `JOB_SKILL_SCORE`、`RESULT_CALCULATED`、`SESSION_COMPLETED`（`job-skill-result-service.ts:60-97,346-399`），scoring planner 随后拼接 JOB_SKILL report fragment（`scoring-planner.ts:368-405`）；没有 mode 分流可在 PREPARE 前抑制 | **预览隔离 FAIL；正式兼容事实 PASS**。正式 seed 仍为固定 18+6/48（`schema.sql:2399-2417`），既有回归断言结果/完成事件唯一且 FINALIZED（`job-skill-result.test.ts:589-631`），但当前合同不能表达或恢复 PREVIEW_ONLY，也不能保证其不写正式结果/报告 |

## 5. 两种发布顺序的反向越权证明

现有数据库最终只看见 `question_bank.status = ACTIVE`，因此两种顺序在持久化状态上不可区分：

| 顺序 | 当前可见事实 | 当前 formal 创建行为 | 所需但不存在的拒绝依据 |
|---|---|---|---|
| 正式先发布 | 题目为 `ACTIVE` | 固定 18+6 可以通过题目状态检查 | 预览发布不存在，无法机械判断“正式 ACTIVE 不能授予预览” |
| 预览先发布（若仅把 DRAFT 改 ACTIVE） | 与上一行完全相同 | formal 创建同样通过，因为只检查固定题存在且 ACTIVE | 没有 `official_publish_set`，无法返回 `FORMAL_RELEASE_AUTHORITY_MISSING` |
| 两者均发布 | 仍只有同一个 `ACTIVE` | 与单来源状态相同 | 没有两条独立 source refs，无法分别撤销、过期、审计或在新 session 时复验 |

因此，不论把来源放进策略 JSON、命令请求或通用事件 payload，只要没有可查询且受约束的独立权威关系，正式先/预览先都至少有一个方向不能证明失败关闭。

## 6. 通用幂等与恢复能力的适用边界

现有 M5B 基础设施是可复用的，并非缺口来源：

1. `(client_instance_id, idempotency_key)` 唯一，request/actor/device/auth 漂移冲突。
2. PREPARE 追加并 fsync 后到达不可回退点，planner 内存被清空。
3. APPLY 事务性写入 batch/event/projection/projector/cursor。
4. 重启只读取冻结 PREPARE/EVENT，`plannerCalls=0`，重复恢复不产生第二批次或第二结果。

但它证明的是“一个已经完整登记且事件事实足够的命令如何可靠执行”，不是“任意尚不存在的业务命令天然满足恢复”。预览发布仍缺：

- 封闭 mutation 定义和规范化输入；
- approval/manifest/principal/source 的权威读取与冻结事实；
- registered event payload validator、projector、result recipe；
- 能在恢复时执行相同约束的持久化关系；
- 对 approval ID/hash 的业务冲突错误映射。

一个可能的后续方案是把批准、双来源和 principal 映射全部设计为不可变事件，而不新增业务表。本 Step 不排除该方案，但它仍必须新增封闭 EventType/aggregate 权限、payload validator、projector/read model、查询唯一性和恢复合同。Mini-PRD §6.3.1(7) 已把“新增事件权限”列为必须停止并提交独立 R3 变更的条件，所以“可以放进通用 `payload_json`”不能把当前结论改写为结构已足够。

### 6.1 无 Schema 候选载体排除

`EXISTING_STRUCTURE_INSUFFICIENT` 不等于“已经决定必须新增 SQL 表”。它表示当前已登记的持久化合同不足；下一轮 R3 可以比较关系表、事件加 read model、受控本地文件或组合方案。Step 1 必须先排除“无需新增任何持久化/权限合同，直接复用通用载体即可”的解释：

| 候选载体 | 可复用能力 | 为什么不能按当前合同直接承载 | 是否触发停止门 |
|---|---|---|---|
| `domain_event_projection.payload_json` / M5B segment | canonical EVENT、PREPARE fsync、aggregate sequence、APPLY 原子事务均可复用 | `domain_event_projection` 是 APPLY 的派生写入，不是可绕过命令边界的自由 KV。production registry 只组合 assessment/training/report/scoring/assignment/safety/export projector 并立即 seal（`application-runtime.ts:118-128`）；每个 EVENT 必须命中 `(eventType, payloadVersion)` 注册且通过 payload validator，否则 `UNKNOWN_EVENT_VERSION`（`result-registry.ts:151-225,265-281`）。APPLY 在写 projection 前先执行完整 registry 校验和事务内 authority 复验（`projection-source.ts:466-512`）。现有 EventType、mutation、projector 均没有发布来源/批准/principal 语义；复用无关既有事件会违反其 payload 与 aggregate 合同。 | **YES**。可行的 event-only 设计仍需新增 release EventType/aggregate 权限、validator、projector/read model 和 result recipe；Mini-PRD §6.3.1(7) 明确将“新增事件权限”列为独立 R3 停止条件。 |
| `strategy_config.question_policy_json` | 已有版本、状态和被 session 引用后的语义冻结 trigger | 任意 JSON 不能提供 approval ID/hash 唯一性、双来源独立存在性、principal 双向唯一映射或 signer/executor 排斥；策略被引用前还能修改，且发布授权不能靠 session 引用才获得不可变性 | **YES**。至少要新增结构/语义 validator、权限及持久关联合同；仅塞字段违反 `INV-DATA-001`。 |
| `DurableFileCapability` 下的 userData 文件 | 路径防逃逸、目录 `0700`、文件 `0600`、exclusive create、fsync 和 identity/hash 防篡改能力可复用（`file-capability.ts:161-204`） | 该能力只保证字节与路径安全，不定义反馈文件 Schema、真实 ID 到两个随机 ref 的唯一映射、稳定 feedback ID、append-only revision、draft 所有者/RBAC、删除责任或“映射绝不进入导出/日志/Prompt”的序列化边界。production 搜索也没有 feedback repository。 | **YES**。可能不需要 SQL migration，但仍需新的受控本地持久化格式、权限、恢复和删除合同；这正是 Mini-PRD §6.7(8) 要求单独 R3 决策的内容。 |
| 请求正文、UI/Pinia、普通日志或导出文件 | 可临时携带/展示字段 | 不构成重启后权威来源；请求可伪造、UI 状态会丢失，日志/导出还会扩大身份映射泄漏面 | **YES**。直接违反可信身份、冻结恢复和隐私边界，不是候选权威仓储。 |

现有 `tamper-recovery.test.ts:43-101` 还提供了动态反证：PREPARE 已 fsync 后，若重启 registry 不再登记 result recipe 或 EVENT payload version，恢复会失败关闭为 `EVENT_BATCH_RECOVERY_CONFLICT`，且不会写入 `applied_event_batch` / `processed_event`。本次定向重跑 6/6 通过。因此 M5B segment 里的“字节已经持久化”不能替代业务事件权限和恢复注册。

## 7. 最小 R3 Schema/数据合同缺口

下一轮 `/vibe-feature` 至少必须对以下事实作出权威、可迁移、可回滚的决定；本 Step 不预先指定表名或实现方案：

1. **发布来源关系**：精确题目语义版本与 `FORMAL_DEMO`/`PREVIEW_ONLY` 独立来源、pack/strategy 版本、状态和历史关联；两条来源不得互相推导。
2. **批准与责任权威**：责任清单、批准 ID/hash、签名、signer principal、scope、有效期、question/asset/renderer/evidence hash 的不可变关联及唯一/FK/状态约束。
3. **执行身份**：ACTIVE ADMIN `user_id` 到 principal 的已签名双向唯一映射、Electron sender 绑定、独立 CLI 交互认证、executor 持久事实和 signer/executor 分离。
4. **原子发布与恢复**：`JOB_SKILL_PREVIEW_PACK_RELEASE` 的规范化 business input、durable event/projector/result recipe、DRAFT->ACTIVE 与 source ref/pack/审计的同一原子边界，以及同 approval ID 异 hash 冲突语义。
5. **会话冻结与结果隔离**：兼容旧 v1/v2 的新 session payload 判别合同，冻结 mode/pack/source/root hashes；`PREVIEW_SESSION_COMPLETED` 全链注册；result/report/safety 入口按冻结 mode 失败关闭。是否增加 session 投影列或独立投影关系由 R3 决策，但不能依赖当前 strategy 回查。
6. **反馈本地持久化**：随机不可推导的双匿名引用、真实 ID 映射、访问权限、草稿自动保存/恢复、稳定 feedback ID、append-only revision、敏感文本外发确认，以及确保映射不进入 HTML/JSON/Markdown、日志或 Prompt 的序列化边界与删除责任。
7. **历史兼容与迁移**：只允许冻结兼容注册表中的旧正式策略解释为 `FORMAL_DEMO`；现有 18+6/48 结果报告链保持不变，历史 session/event/result/report 不回写。

只要其中任一项必须新增表、列、trigger、权限或持久化约束，当前 Step 1 的二元结论就只能是现有结构不足。

## 8. 探针决定

`NOT_RUN`：没有新增 SQLite fixture/probe。

理由：静态 Schema、封闭 command/event 注册表和 production planner 已直接证明关键字段、关系与分流不存在。最小探针只能验证通用 SQLite JSON 可写或 M5B 可恢复，不能证明不存在的双来源、principal 唯一映射、职责分离、匿名映射隔离或 PREVIEW_ONLY result suppression。继续制作探针会把“能序列化”误报为“有数据合同”，违反 Step 1 判定规则。

现有通用机制和正式 18+6 行为仍通过定向回归复验，不访问默认数据库；命令结果见下节。

## 9. 验证与审查记录

### 9.1 自动化检查

| 检查 | 命令 | 状态 | 证据 |
|---|---|---|---|
| 显式临时库同步与 Schema/content pack 校验 | `npm run db:sync -- --db /tmp/svets-preview-step1-*/step1.db`；`npm run db:verify -- --db /tmp/svets-preview-step1-*/step1.db` | `PASS` | 临时库仅在命令生命周期存在并已清理；BASE=96、JOB=298、approved assets=0，pack `2026.07.22.1`，hash `2fdbb611c443b47be9fc4376f02f7bbdc3437c5b410785703e049473cc8ff952`；但 verifier 版本口径仍止于 0.1.17，见 §3.1 |
| durable command 同/异 hash、租约与 PREPARE/APPLY crash recovery | `vitest run` 定向 command/startup-recovery/fault-matrix | `PASS` | 与下面正式回归合并执行；7 files / 86 tests 全部通过，其中 command 6、startup recovery 6、fault matrix 24 |
| 未登记 EVENT/result recipe 重启失败关闭 | `vitest run src/main/domain/event-batch/__tests__/tamper-recovery.test.ts` | `PASS` | 1 file / 6 tests；未知 EVENT payload version 或已退役 result recipe 均进入只读 corruption，且不 APPLY 投影 |
| 正式 JOB_SKILL 18+6 result/report 与 session snapshot 回归 | 同一定向 `vitest run` | `PASS` | assessment JOB_SKILL 13、JOB_SKILL result 14、JOB_SKILL report 15、snapshot 8；合计包含在 86/86 |
| M5B source inventory | `npm run contract:m5b:event-batch:check` | `PASS` | target=75（29 READ/46 MUTATION），36 BATCH_DOMAIN/10 GATE_ONLY，pending=0 |
| M5B v0.1.18 全量隔离恢复 | `npm run db:m5b:isolated:verify -- --stage full` | `PASS` | artifact/command/coordinator/gate-only/safety/schema/storage 全部 PASS；7 个临时根全部清理 |
| M5B-15 历史 scope 冻结门 | `npm run contract:m5b:scope:check -- --step M5B-15` | `FAIL` | exit 1；该历史 gate 不适用于当前 Step 的 dirty 范围，将既有 BASE_ABILITY/JOB_SKILL 现场判为 34 项 baseline drift/unexpected path。未清理用户改动，也不将失败写成通过 |
| JOB_SKILL authority/delivery contracts | `npm run contract:job-skill:check`；`npm run contract:job-skill:delivery:check` | `PASS` | runtime SQL remains blocked；toolkit/delivery lock current |
| typecheck | `npm run typecheck` | `PASS` | `vue-tsc --noEmit && tsc --noEmit -p tsconfig.node.json` exit 0 |
| lint | `npm run lint` | `PASS` | exit 0；0 error、663 条既有 warning |
| docs index | `npm run docs:index:update && npm run docs:index:check` | `NOT_RUN` | 待回填 |
| diff whitespace/conflicts | `git diff --check` | `NOT_RUN` | 待回填 |
| build | `npm run build` | `NOT_RUN` | Step 1 仅新增/更新文档，不修改可构建产物；impl Step 1 未要求 build |
| 全量单元测试 | `npm test` | `NOT_RUN` | Step 1 使用与需求直接相关的 86 项主回归和 6 项 tamper recovery；未把全量套件写成通过 |
| Electron/manual UI | 手工 | `NOT_RUN` | 本 Step 不实现 UI/运行时 |

### 9.2 独立审查

- `/vibe-review`：`NOT_RUN`，待独立审查者回填。
- `/vibe-accept step 1`：`NOT_RUN`，待验收回填。

## 10. 不变边界确认

- 默认数据库：未读取、未初始化、未修改。
- Schema/migration：未修改。
- 运行时代码：未因本 Step 修改。
- 题目/素材/策略/发布状态：未修改。
- dirty 工作树：既有 BASE_ABILITY Step 3 和 JOB_SKILL 文档改动原样保留；未 reset、restore、stash、commit、push、merge、rebase 或清理。
- Step 2-9：未进入。
