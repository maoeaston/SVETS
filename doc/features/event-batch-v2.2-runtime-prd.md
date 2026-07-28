# 权威 v2.2 批事件运行时 Mini-PRD

## 1. 文档状态

- 状态：DRAFT（依赖顺序已确认；须待 Step 2A M4 与 Step 2B Command Bus 均验收 `PASS` 后，按最终 mutation boundary 重基线并重新独立审查，才可进入 `/vibe-impl`）。
- 风险等级：R3。
- 功能范围：Q1 BASE_ABILITY 42+8 的 Step 2C 独立硬前置；Step 2A–2C 全部完成前不得开始 Step 3–10。
- 权威依据：
  - `doc/specs/architecture-plan-b-multi-device-v2.2-authoritative-baseline.md` §10、§11、§12、§18；
  - `doc/features/base-ability-42plus8-pilot-readiness-impl.md` Step 2；
  - `doc/specs/MVP_PRD_v1.0.9-authoritative.md` 的事件溯源与安全结果要求；
  - `doc/specs/project-invariants.md`：`INV-EVT-001`、`INV-EVT-002`、`INV-EVT-003`、`INV-SAFE-001`、`INV-SAFE-002`、`INV-SAFE-003`、`INV-RES-001`、`INV-RES-002`、`INV-DATA-001`、`INV-DATA-003`、`INV-IPC-001`、`INV-AUTH-002`。

## 2. 问题与目标

### 当前行为

`src/main/domain/event-writer.ts` 逐条以 `appendFileSync()` 把 legacy `ActionLogEntry` 写入 `action_log.jsonl`，随后插入 `domain_event_projection`；调用方再在其自有事务中调用 reducer。`src/main/db/connection.ts` 的启动恢复按单事件日志补写投影。这一模型缺少命令级原子边界、全局批次序列、hash chain、写入 fencing、稳定 durability barrier 和权威的批次恢复状态机。

当前已有操作评分、多项 BASE_ABILITY / JOB_SKILL 评分、结果终结、坐次、assignment 与安全红线路径依赖“一个命令中的多事件要么全投影、要么零投影”。不得把这些路径降级为多个独立提交。

### 用户问题

在 JSONL 已追加但 SQLite APPLY 失败、进程崩溃、同一命令重试或同一 data root 并发写入时，系统必须保留可验证、可恢复、不可重复执行业务 handler 的事实边界，同时不降低安全熔断、结果独立性或历史重放能力。

### 目标行为

以权威 v2.2 协议替换生产写路径：每个 mutation command 产出唯一的 `BATCH_PREPARED -> EVENT* -> BATCH_COMMITTED`；在单写者锁和 durability barrier 之后，以一次 SQLite APPLY transaction 投影整批事件，再 CONFIRM。启动时在注册任何业务 mutation 前完成四阶段 `startupRecovery`，仅在 hash、文件身份、DB cursor、command fencing 与投影全部一致时打开同一 data root 的全局 mutation gate。

### 成功定义

1. 所有生产领域写入都由一个批事件协调器执行，禁止 production direct `writeEvent()` 与 caller-owned JSONL/投影拼接。
2. 任一 PREPARE、EVENT、APPLY、COMMIT、CONFIRM、segment/index durability 故障不会暴露部分业务投影，也不会形成替代 batch；恢复只接管原 `batch_id`。
3. 合法的 legacy v1 / F7-v2 记录不被改写；LF 与完整 EOF 语义相同，历史可重放。
4. 所有 IPC、CLI、后台与启动写入在 gate 关闭时、产生任何 DB 或文件副作用前拒绝；只读操作仍可用且不得 lazy write。
5. 迁移、兼容、故障注入、并发、恢复、全 writer call-site 和默认数据保护均有可执行证据；独立 R3 工作流结论为 `PASS`。

## 3. 用户角色与权限

- 学生、教师、管理员的业务权限不因本功能扩张或放宽；既有角色校验仍在 handler、Schema trigger 与 reducer 生效。
- `SYSTEM` runtime 仅可在 composition root 建立后持有不可伪造的 event-log ownership / recovery capability；低层 append、APPLY、CONFIRM 与 gate 状态切换不得由 IPC payload、renderer、CLI 参数或普通 handler 伪造。
- startup recovery 与 schema migration 允许在 gate 初始关闭时使用内部 capability；其他 mutation 一律不允许旁路。
- 未来 Pilot authorization state lock 不在本功能实现业务，但锁序接口必须预留在 `authorization state lock -> event-log single-writer lock -> BEGIN IMMEDIATE` 中；本步骤不得实现题目激活或 Pilot 授权。

## 4. 核心场景

### S1：正常批事件提交

Given data root 已解析为唯一 runtime，recovery/corruption gate 为 OPEN，命令通过既有权限和业务前置条件校验，

When handler 提交一个或多个有序领域事件，

Then coordinator 预分配 command、batch 与聚合 event sequence，在同一经身份校验的文件描述符写完 `BATCH_PREPARED + EVENT*` 并完成 durability barrier，随后在一个 `BEGIN IMMEDIATE` 中投影整批，写入 `BATCH_COMMITTED` 并确认 batch；返回语义保持当前命令合同。

### S2：PREPARE 后崩溃与恢复

Given 完整 `BATCH_PREPARED + EVENT*` 已 durability-confirmed，尚未 APPLY 或尚未 CONFIRM，

When 进程退出并再次启动，

Then `startupRecovery` 在业务 IPC 注册前取得同一 writer lock，验证 batch、hash、request、fencing generation 和 cursor；只对原 batch APPLY 或 CONFIRM，绝不重跑 domain handler 或生成第二个 batch。

### S3：不完整尾部与历史日志切换

Given data root 包含完整 legacy EOF、带 LF 的 legacy 记录、或 PREPARE 写入中断的 batch 尾部，

When runtime 升级并启动恢复，

Then 合法 legacy bytes 和语义保持；仅可证明不完整的权威 batch 尾部按合同归档/截断。完整 EOF 只可补 LF 并建立 durability barrier；checksum、版本、hash 或 identity 不一致则标记 corruption 并保持 gate 关闭。

### S4：批量评分与安全红线

Given 一个命令携带多条线下评分加结果，或携带安全事件及其既有确定性投影，

When 任一 event、reducer、SQLite trigger 或 CONFIRM 阶段失败，

Then 当前进程不暴露部分业务投影；下次仅恢复同一 batch。安全事件 APPLY 时仍由 Step 2A 已验收的 SQLite trigger 先熔断同 `student_id + job_code + task_code` 开放会话，且不得追加未包含在原 batch 的伪造领域事件。Step 2C 只迁移最终命令/写入边界，不得再次修改或降级已经验证的 M4 三元安全语义。

### S5：gate 关闭

Given recovery、durability 或 corruption gate 为 CLOSED，

When 任意共享/preload IPC mutation、CLI、后台任务、启动 seed、导出、配置写入或未来 down / activation 请求发生，

Then 请求在副作用前返回稳定错误；read handler 不注册隐式写入。

## 5. 范围

### 本次包含

- 权威三类 JSONL record、canonical serialization、全局 batch sequence、hash chain、segment rotation 与 segment index。
- `command_log` fencing、`applied_event_batch`、`processed_event`、`projector_cursor` 的 schema / migration / 结构断言及新旧库兼容。
- PREPARE / APPLY / CONFIRM、同一 data root 单写者锁、文件与目录 durability、文件身份校验、failure-close gate、四阶段 startup recovery。
- legacy `ActionLogEntry` / F7 envelope 的无损 reader、切换和重放；batch record、envelope 与业务 payload 各自版本化。
- 全部现存写入者、report coordinator 与 recovery 路径迁入 coordinator；现有 reducer/projector 仍在一次 APPLY transaction 内执行。
- 中央 mutation registry、IPC/preload/shared contract 对账，以及 CLI、后台、启动服务和文件写入口的同 gate 覆盖。
- 版本化 mutation inventory：逐项列明入口文件与符号、`READ` / `GATE_ONLY_MUTATION` / `BATCH_DOMAIN_MUTATION` 分类、所需 capability、data root、迁移目标与零副作用验证方式；它是 registry completeness test 的唯一待核对集合。
- `project-invariants.md` 的版本化重基线、静态合同检查、文档索引和独立验收脚本。

### 明确不包含

- 42+8 的新题目、题目激活、评分含义、renderer、授权原件、Pilot activation 或两条 reason migration。
- 新增 `EVENT_GROUP`、sidecar intent、复合业务 payload 或权威三 record 之外的永久事件日志协议。
- 以 SQLite 取代 JSONL 事实来源，或通过重写 / 删除合法历史日志来“迁移”。
- 真实默认运行库迁移、故障注入或数据修复；自动化只可使用显式、成对的临时 data root / DB / userData / evidence 目录。
- v2.2 学习、离线草稿、备份恢复、网络服务等与当前 event runtime 无直接写入方的后续里程碑。
- M4 Safety Re-key 的三元安全聚合、10 个 trigger / guard 替换、开放会话索引和跨岗位历史迁移；它是 Step 2A 独立 R3 和本功能的硬前置，不能在 batch runtime 中重复实现或静默吸收。

## 6. 行为与数据变化

### 状态变化

```text
CLOSED (startup) -> RECOVERING -> OPEN
                       |             |
                       v             v
                  CORRUPTION     PREPARED -> APPLIED -> CONFIRMED
                  (CLOSED)             |           |
                                       +-- recovery +-- recovery
```

- 完整 `BATCH_PREPARED` + durability barrier 是命令的不可重新执行点。
- `APPLY` 的 `applied_event_batch`、`processed_event`、domain event projection、业务 reducer/projector 和 cursor 在同一 SQLite transaction 中完成。
- `BATCH_COMMITTED` durability 成功后 batch 才标记 `CONFIRMED`；命令 result 恢复按 v2.2 §11.7 执行。

### 数据读写与兼容

- 新增 / 迁移 v2.2 的 command、batch、processed-event、cursor 数据结构；结构判定不得只依赖 migration ledger。
- JSONL 当前写入改为 segments + index；segment/index、SQLite batch row 和 JSONL `BATCH_PREPARED` 的 `previous_batch_hash/events_hash/batch_hash` 必须一致。
- legacy 完整记录保留为历史事实。读者可重放 legacy 与 v2.2 segment；不得用 schema envelope 版本暗改业务 payload 语义。
- domain_event_projection 继续是查询投影，不升级为事实来源；现有 projector/reducer 的幂等性在 `processed_event` 保护下保留。

### IPC / API 与非 IPC mutation

- 不新增 renderer 直连数据库能力。
- 每个 IPC channel 必须在唯一中央 registry 中登记 `READ` 或 `MUTATION`；shared API、preload 暴露与 handler 登记三方对账。
- mutation registry 以版本化 inventory 为输入：`READ` 只允许无副作用查询；`GATE_ONLY_MUTATION` 必须先过 gate 但不产生领域 batch；`BATCH_DOMAIN_MUTATION` 必须先过 gate 并经 command/batch coordinator 写入。任何未登记入口、重复分类或类型不匹配都失败关闭。
- mutation handler 只把已验证的业务事件计划交给 coordinator，不得直接取得低层 writer capability。
- CLI、background、startup seed、report export、配置写、down 和后续 activation 需登记为同一 data-root runtime 的 mutation source；读路径不得因初始化而写库或文件。

## 7. 边界条件与异常处理

- 请求重复：同一 `(client_instance_id, idempotency_key)` 返回同 command；request hash 不同必须失败关闭，不得复用或新建 batch。
- 锁与并发：普通写、recovery、down、activation 均按固定锁序；不允许第二 runtime、第二 gate 或不带 ownership token 的低层写。
- PREPARE 前失败：无事实、无投影，允许以同 command 重试；PREPARE 后任何不确定性：关闭 gate、不得创建 replacement batch。
- 写入短写、fsync / fdatasync 不确定、目录 metadata 不能持久化或 file identity 变化：不 APPLY，关闭 gate；恢复须先重新证明同一 batch durability。
- APPLY transaction / trigger / projector 失败：SQLite 回滚整批；保留已准备事实，恢复只重放原 batch。
- CONFIRM 失败：保持 APPLIED，恢复只补同一 `BATCH_COMMITTED` 并确认。
- 任何 hash、sequence、cursor、request、fencing generation、segment index、checksum 或 projection 冲突：写 corruption metadata，gate 保持 CLOSED，业务 IPC 不注册或拒绝 mutation。
- 安全：安全事件的既有 trigger 在 APPLY 内先熔断；不得因 batch 化改变 `INV-SAFE-001` 至 `INV-SAFE-004`。
- 默认运行库：路径缺参、解析到默认 userData / 仓库目录、DB-userData 不配对，或路径为符号链接 / 硬链接别名时，验证命令在打开数据库前失败。

## 8. 迁移与兼容性

- Step 2A 与 Step 2B 的独立 `/vibe-accept` 必须均为 `PASS`；本功能随后以已验收的三元安全 Schema 和统一 Command Bus 为唯一输入基线，不兼容从二元安全键或分散 handler 直接跨级迁移。
- 新库加载完整 v2.2 schema；既有库经静态注册 migration 前滚，备份和结构断言由当前迁移机制执行。不得为本功能引入动态本地 TS 模块加载。
- 第一条非测试 `BATCH_PREPARED` 写入前，允许按独立 impl 中批准的迁移回退应用与空结构；写入后只允许前滚，或恢复经过批准的成对灾难备份。
- 迁移前先只读盘点 legacy log / projection / snapshot / metadata；完整 legacy EOF 不视为损坏。无法建立无损映射时停止并保持 gate CLOSED。
- 本功能完成后必须更新 `baseline.yaml`、项目不变量、可读事件合同和文档索引；随后重跑 Step 1 验收并独立重审 42+8 实施计划。

## 9. 非功能要求

- Durability：每个 PREPARE / CONFIRM 在同一 identity 的 file descriptor 上完成可验证 flush；新建 index/segment 也持久化必要目录元数据，或提供等价 KAT 证据。
- 一致性：固定 canonical hash 算法、UTF-8、key sorting、LF 规则和 `GENESIS`；批次顺序全局递增。
- 可观测性：记录 command、batch、stage、segment、corruption / recovery code；不记录密码、token、未脱敏个人资料或完整敏感 payload。
- 性能：10 MB 或 10,000 batches 才轮转；批次大小与 event_count 需有可测上界，不能无限制累积内存。
- 可访问性：无 renderer UI 改动；若现有 UI 暴露稳定错误，错误文本不得替代角色或安全提示。
- 隐私与审计：保证日志及索引路径只位于已验证 data root；归档 segment 永久保留，测试证据必须只落在显式临时目录。

## 10. 验收标准

| ID | 输入 | 预期输出 | 验证方式 |
|---|---|---|---|
| EBR-01 | 正常单事件与多事件命令 | 一批三 record、hash chain、cursor、projection 和 command 状态一致 | coordinator integration test + `contract:event-batch:v2.2:check` |
| EBR-02 | operation / BASE_ABILITY / JOB_SKILL 批量评分、结果终结、坐次、红线 | 保持既有成功语义；任一注入故障时零部分业务投影或启动后同 batch 整体恢复；不改变或降级已验收的 M4 三元安全聚合键 | handler 回归与 stage-by-stage fault injection |
| EBR-03 | PREPARE、EVENT、APPLY、COMMIT、CONFIRM、index 与 durability 的每个故障点 | 无 replacement batch；gate 关闭；恢复只接管原 batch | durability / recovery test matrix |
| EBR-04 | 合法 v1、F7-v2，分别用 LF 与完整 EOF，projection 有/无 | bytes 与语义无损；EOF 仅补 LF；可确定重放 | legacy upgrade / mixed replay tests |
| EBR-05 | malformed legacy、hash/request/cursor/fencing/index/identity 冲突 | fail closed、corruption evidence、业务 mutation 零副作用 | negative recovery tests |
| EBR-06 | 两个相同 / 冲突 idempotency request、并发 writer 与 recovery | 同 key 幂等、异 hash 冲突、锁序无反转、batch sequence 连续 | concurrency / fencing tests |
| EBR-07 | 已版本化 inventory 中所有 IPC、CLI、background、startup 与文件写入入口 | inventory 与 shared/preload/handler、CLI/background/startup/file entrypoint 对账；唯一分类、gate closed 时零副作用；read 不 lazy write | registry completeness / negative tests |
| EBR-08 | 新库与可迁移历史库 | migration forward、结构断言、FK/integrity、重启恢复通过；无自动 destructive down | migration tests + `db:verify` 临时库 |
| EBR-09 | 显式临时 runtime 四路径；默认运行库快照 | 默认数据文件族路径、存在、size、SHA-256 均未变化 | runtime contract script + before/after manifests |
| EBR-10 | R3 交付 | PRD、impl、独立 review、accept、基线/不变量/文档索引和 Step 1 重验均有 PASS 证据 | workflow artifacts、命令退出码、实际 diff |

## 11. 适用不变量

- `INV-EVT-001`、`INV-EVT-002`、`INV-EVT-003`：实施中需版本化重基线；不能静默改写旧 ID 的历史语义。
- `INV-SAFE-001`、`INV-SAFE-002`、`INV-SAFE-003`、`INV-SAFE-004`：批次 APPLY 不得绕过或削弱既有 trigger / 状态机。
- `INV-RES-001`、`INV-RES-002`：批量评分和恢复不混合结果类型、不覆盖安全失败。
- `INV-IPC-001`、`INV-IPC-002`：IPC 白名单、类型、权限和 renderer Node 边界保持。
- `INV-DATA-001`、`INV-DATA-002`、`INV-DATA-003`：JSON 合同、策略来源、迁移兼容与可重放要求保持。
- `INV-AUTH-001`、`INV-AUTH-002`：既有角色边界与业务会话 / grant / assignment 三方一致性保持。

## 12. 风险、回滚与停止条件

### 主要风险

- 迁移期 legacy 和 v2.2 reader 同时存在，若边界不清会破坏历史重放。
- 文件 durability、父目录 flush、跨进程锁和 canonical identity 的平台差异可能无法仅用内存测试证明。
- 全 writer / mutation inventory 遗漏会留下绕过 gate 的写路径。
- 安全 trigger 与复杂多事件 command 的投影顺序若改变，会违反熔断优先级或现有零投影失败合同。

### 回滚

- 目标 data root 未写入 v2.2 batch 前：只可依批准 impl 回退应用与新增空结构，仍保持 legacy reader 与 gate 修正。
- 任一目标 data root 已写入 batch 后：仅可前滚修复，或按批准的成对 DB + data-root 灾难恢复；不得回写、删除、重排或假定无损 down。

### 停止条件

- 需要偏离权威三 record、canonical hash 或 PREPARE/APPLY/CONFIRM；
- 不能证明 file identity / durability / 单写者锁；
- 不能保留合法 legacy LF/EOF 或既有整批失败合同；
- 发现 IPC、CLI、后台、启动或文件写入旁路；
- 测试需要触碰默认运行库；
- 独立 review 或 accept 存在 P0/P1、`FAIL`、`BLOCKED` 或 `NOT_RUN`。

## 13. 已确认决策、假设与未解决问题

### 已确认决策

- 采用 v2.2 权威三 record、唯一 canonical hash 算法、global `batch_sequence` 和四阶段 recovery；不引入 `EVENT_GROUP`。
- JSONL / segments 是领域事实来源；SQLite 为投影与基础设施状态，不取代事实来源。
- 完整 `BATCH_PREPARED` + durability barrier 为不可重新执行点；command fencing 按 v2.2 §11。
- Q1 Step 2 固定拆分为 Step 2A M4 Safety Re-key → Step 2B M5A Command Bus Boundary → Step 2C 本功能；三个阶段各自独立 R3、独立验收，不合并实施。
- Step 2C 完成后必须重基线、重跑 Step 1 验收、独立重审原 42+8 实施计划。

### 实施假设（须在 impl 核验）

- 现有 `better-sqlite3` 运行环境可提供 `BEGIN IMMEDIATE` 语义；测试适配器需要显式补足能验证的 transactional contract。
- Electron 主进程能以静态 import 接入所有新本地模块；无需新增依赖或动态 `require()`。
- 不同平台的目录 durability 通过能力适配器和 KAT 处理；若当前平台不可证明，运行时 fail closed 而非降级。

### 未解决问题

- 无待选的产品顺序问题。Step 2A/2B 尚未实施，因此当前 mutation inventory、handler 接线和 migration 基线仍会变化；本 PRD 必须在两个前置阶段验收后按实际代码重扫并重新独立审查，不能把当前 DRAFT 直接交给编码。
- 具体文件布局、错误码、batch 大小上限、平台 KAT 实现和 migration ID 由后续 `/vibe-impl` 基于届时实际代码确定，但不得偏离本 PRD 的权威协议和停止条件。
