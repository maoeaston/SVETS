# 权威 v2.2 批事件运行时 Mini-PRD

## 1. 文档状态

- 状态：`APPROVED_FOR_IMPL`（Step 2A / M4 与 Step 2B / M5A 均已验收；本版已按最终 Command Bus 边界重基线，并通过 `doc/features/event-batch-v2.2-runtime-prd-review.md` 独立 R3 审查，未关闭 P0/P1/P2 均为 0）。
- 风险等级：R3。
- 里程碑：Step 2C / M5B Event Batch Runtime；它是 Q1 BASE_ABILITY 42+8 Step 3–10 与 M5C utilityProcess 的硬前置。
- 目标 Schema：`v0.1.18-event-batch-v2.2`；只采用 v2.2 架构 T11–T14，不在本步提前采用 T18 `offline_score_draft`。
- 权威依据：
  - `doc/specs/baseline.yaml`；
  - `doc/specs/architecture-plan-b-multi-device-v2.2-authoritative-baseline.md` §7.2 T11–T14、§10、§11、§12、§18.3、§22.4、§23.5–23.6；
  - `doc/features/multi-device-m4-m5-prd.md` §4；
  - `doc/features/full-product-1.0-planning-review-2026-07-18.md` B9–B11；
  - `doc/specs/MVP_PRD_v1.0.9-authoritative.md`；
  - `doc/specs/project-invariants.md` 与 `doc/ai/vibe-workflow-contract.md`。

本 PRD 只批准功能边界和可验证结果。独立审查未达到 P0=0、P1=0 前，不得进入 `/vibe-impl`；PRD 通过也不等于实现通过。

## 2. 最终输入基线

### 2.1 已验收前置

| 前置 | 状态 | 本步继承的事实 |
|---|---|---|
| Step 2A / M4 Safety Re-key | `ACCEPTED_STEP_2A` | 当前 Schema 为 `0.1.17-multi-device-m4-safety-rekey`；安全聚合键为 `student_id + job_code + task_code`，10 个 trigger / guard、2 个开放会话唯一索引及 3 个查询索引已验收。 |
| Step 2B / M5A Command Bus Boundary | `ACCEPTED_STEP_2B` | 单一 runtime、中央 registry、可信 actor、权威 target、无写 preflight、统一 correlation 与注册例外闭集已验收；尚无 durable idempotency、batch、hash chain、lease fencing 或 v2.2 startupRecovery。 |

M5A 最终扫描是本步的固定迁移输入，不得重新解释成“尚未盘点”：

| 项目 | 冻结值 |
|---|---:|
| IPC channel | 74（28 READ / 46 MUTATION） |
| active direct callsite / file | 215 / 28 |
| active capability callsite / delegating root | 72 / 13 |
| active manifest / mapping | 361 / 378 |
| registered exception | 76（`TEST_ONLY=29`、`MIGRATION_INTERNAL=47`） |
| pending | 0 |
| active inventory digest | `f97ef382ab9a9678ab20f06310e6906e811cdd765526d69a4fcc11bca6939527` |

M5B 允许新增一个无副作用 `runtime:getHealth` READ channel，因此目标中央 registry 为 75 channels（29 READ / 46 MUTATION）。任何其他 channel 增删都必须退回 PRD 重审。

### 2.2 当前写入事实

当前 `event-writer.ts` 每次追加一条 legacy `ActionLogEntry` 到 `action_log.jsonl`，再插入 `domain_event_projection`；调用方在自己的事务中继续执行 reducer。当前 43 个 production legacy event-port callsite 与 8 个 report coordinator command callsite 仍按这一模型工作。`connection.ts` 会在启动时执行 legacy 日志协调，并可能追加 recovery audit；这不是 v2.2 四阶段恢复。

当前 46 个 mutation channel 的目标分类固定如下：

| 分类 | 数量 | channel family | 目标执行边界 |
|---|---:|---|---|
| `BATCH_DOMAIN_MUTATION` | 36 | assessment 15、assignment 5、reports 6、safety 4、training 6 | side-effect-free plan → 一个有序事件批次 → APPLY projector；不得再调用 legacy writer 或 request-time recovery。 |
| `GATE_ONLY_MUTATION` | 10 | auth 4、student 3、strategy 3 | durable command claim + gate + 单一 SQLite transaction；不伪造领域事件，不创建零事件 batch。 |

非 IPC 写入必须在 M5B inventory 中逐项分类为 `PRE_GATE_MIGRATION_INTERNAL`、`RECOVERY_INTERNAL`、`GATE_ONLY_MUTATION`、`BATCH_DOMAIN_MUTATION` 或 `TEST_ONLY`。M5A 的 76 项注册例外必须逐项重新裁决，不能整体继承为 M5B allowlist。

### 2.3 已发现的合同冲突及裁决

- [!] 当前 `assessment:triggerRedline` 依次写 `SAFETY_INCIDENT_CREATED` 与 `REDLINE_TRIGGERED`；v2.2 架构 §12.2 要求新命令只以一个安全事件驱动确定性 halt 投影。裁决：legacy v1 / F7-v2 两事件历史继续可读、可重放；新的 v2.2 redline batch 只含一个 `SAFETY_INCIDENT_CREATED`，projector 插入 incident 后由已验收的 M4 trigger 熔断并绑定会话，再确定性落安全失败结果，不生成第二条事件。既有 `REDLINE_TRIGGERED` EventType 不删除，专供历史兼容。
- [!] 架构 §0.4 写“当前无冷启动恢复”，但当前仓库已有 legacy reconcile。裁决：把它标记为 `LEGACY_RECONCILING` 兼容步骤；它不得被包装成 v2.2 `startupRecovery`，也不得在 runtime OPEN 后按请求执行。
- [!] 旧版草案允许给合法无 LF 的 legacy EOF 补换行。裁决：合法 legacy 文件一字节不改，包括完整 EOF 无 LF；只有可证明不完整的末尾才可在先备份、原样归档、记录精确 byte offset 后截断。
- [!] v2.2 整体架构采用 T18 `offline_score_draft`，但 Step 2C 的依赖边界只要求 batch finalize。裁决：本步只保证现有批量评分命令能形成单一批次；T18 表、草稿 API、UI 与多设备草稿交接是后续独立功能，不得声称已实现。

## 3. 问题、目标与成功定义

### 3.1 用户问题

JSONL 已追加但 SQLite APPLY 失败、进程在任一 durability 窗口崩溃、同一请求被重放或写入者租约被接管时，系统必须恢复原命令和原批次，不能重跑已经越过不可逆点的业务逻辑，也不能暴露部分投影、重复报告、重复评分或被拆开的安全熔断。

### 3.2 目标行为

生产领域写入统一为：

```text
read-only preflight
  -> durable command claim + lease
  -> side-effect-free plan
  -> BATCH_PREPARED + EVENT* + fsync        # PONR
  -> SQLite BEGIN IMMEDIATE / APPLY / COMMIT
  -> BATCH_COMMITTED + fsync
  -> batch CONFIRMED + durable index
  -> fenced command result
```

启动状态固定为：

```text
CLOSED -> MIGRATING -> LEGACY_RECONCILING -> BATCH_RECOVERING -> OPEN
                                                    |
                                                    +-> CORRUPTION_READ_ONLY
OPEN ------------------------------------------------^  # runtime durability / identity uncertainty
```

只有 `OPEN` 可执行普通 mutation；`CORRUPTION_READ_ONLY` 允许无写查询和脱敏诊断导出，拒绝全部业务 mutation。迁移、legacy reconcile 与 batch recovery 只能使用 composition root 创建的内部 capability，并受阶段白名单约束。

### 3.3 成功定义

1. 36 个领域 mutation 均由一个 batch coordinator 执行；43 个 production legacy event-port callsite 与 8 个 request-time report coordinator callsite 归零。
2. 10 个 gate-only mutation 保持现有业务响应，但其业务 DML 与 command result 在同一 SQLite transaction 中提交；不创建虚假事件或零事件 batch。
3. 完整 PREPARE fsync 后，任何 worker 都只恢复同一 `batch_id`，不再运行 planner / handler；每个崩溃窗口都有故障注入证据。
4. legacy 日志 bytes 保持，v2.2 segment/hash/index 可验证；篡改、身份漂移或不一致进入只读损坏态，不猜测修复。
5. renderer 业务方法的参数与结果形状保持；持久幂等 metadata 由可信 transport 透明附加。新增 runtime health 是单独、版本化、无敏感信息的只读合同。
6. 所有自动化只使用显式 `/tmp` 成对 data root / DB / userData / export / evidence 路径；默认运行库不得被打开、读取、hash、初始化或修改。

## 4. 用户、权限与能力

- 学生、教师、管理员的既有权限不扩张；actor 继续来自 sender-bound auth snapshot，payload 中的 caller 字段不可信。
- `UNAUTHENTICATED` 仅用于 login；`command_log.actor_id` 使用固定保留值，不能伪装用户或 SYSTEM。
- `SYSTEM` command 必须来自 composition root 的不可伪造 capability，并声明稳定 operation epoch；IPC payload、CLI 参数与普通 service 不能构造 writer、recovery 或 migration capability。
- renderer / preload 不获得数据库、低层文件句柄、lease generation、worker ID、batch ID 或 writer capability。
- `runtime:getHealth` 的通用健康字段与最小脱敏诊断快照可在无会话时读取，保证冷启动 corruption 后仍有可达的审计入口；已绑定 ADMIN 可以取得更多非敏感结构统计，但不能取得原始事实内容。两种响应都不得返回绝对路径、凭据、token、密码派生物、完整业务 payload 或个人资料。
- corruption mode 中，普通 report export 仍被拒绝；诊断“导出”只返回只读、版本化 JSON 数据，由 renderer 的浏览器下载能力保存，不写 data root，不取得 mutation capability。

## 5. 核心场景

### S1：正常单事件与多事件命令

Given runtime 为 OPEN，transport metadata、actor、结构与 target 全部合法，

When 一个命令计划出 1..N 个有序 EventIntent，

Then coordinator 在同一当前进程 writer mutex 下完成 PREPARE/APPLY/CONFIRM；一个命令只有一个 batch，N 个事件在同一 `BEGIN IMMEDIATE` 中整体投影，成功响应只在 batch、command result 与必要 index barrier 全部持久后返回。

### S2：重复与冲突幂等请求

Given 同一 `(client_instance_id, idempotency_key)` 被再次提交，

When command type、可信 actor/session/device 与 secret-safe normalized request fingerprint 全部相同，

Then `SUCCEEDED` 直接返回已存的版本化 result；`PROCESSING` 未过期返回稳定冲突；已过期按 generation 原子接管。任一比较字段不同都在 handler 前返回稳定 idempotency conflict，不创建第二个 command 或 batch。新 key 即使 payload 相同也表示新用户意图。

### S3：PREPARE 前失败

Given command 已持久接收但尚无完整 durability-confirmed PREPARE，

When planner、lease renewal、interaction preflight 或进程失败，

Then 没有领域事实或业务投影。恢复可按 registry 的 pre-PONR policy 重新执行 side-effect-free planner，沿用原 command / reserved batch ID；不得把 transport 的 `NO_AUTO_RETRY` 误解为禁止架构规定的 lease takeover。当前本地 deterministic commands 的 durable max attempts 固定为 3，达到上限后保留稳定失败，不生成新 batch。

### S4：PREPARE 后崩溃

Given 完整 `BATCH_PREPARED + EVENT*` 已在同一文件身份上 fsync，

When 在 APPLY 中途、APPLY 后、COMMIT record 后、index 后或 result 前崩溃，

Then startupRecovery 验证 command/batch/request/generation/hash/cursor 后只执行 projector、CONFIRM、index repair 或 `result_from_batch`；绝不再调用业务 planner，不分配 replacement batch。

### S5：legacy 切换

Given `action_log.jsonl` 含 v1、F7-v2、带 LF 或合法完整 EOF，

When 首次升级到目标 Schema，

Then 先创建成对备份，再完成一次 legacy reconcile；合法 bytes 前后 hash 与长度完全一致，文件被逻辑封存。`segment_index.json` 记录 legacy anchor；新事件只写 `event-log/segments/`，第一批 `previous_batch_hash` 仍为 `GENESIS`。

### S6：损坏与只读模式

Given legacy anchor、segment、batch hash、sequence、index、SQLite batch、cursor、file identity 或 fencing 不一致，

When startupRecovery 无法从权威完整记录确定唯一状态，

Then runtime 进入 `CORRUPTION_READ_ONLY`；29 个 READ channel 保持注册且无 lazy write（若 SQLite 本身不可安全查询，业务 READ 返回自身稳定 system error），46 个 mutation 以各自既有 public system-error family 失败。内存态 `runtime:getHealth` 始终返回稳定 `CORRUPTION_DETECTED` 和脱敏定位信息，并向已订阅 renderer 推送同一版本状态。

### S7：安全红线

Given `assessment:triggerRedline` 被接受，

When planner 构造新 v2.2 batch，

Then batch 只含一个 `SAFETY_INCIDENT_CREATED`；APPLY 先插入 incident，由 M4 trigger 对相同 `student_id + job_code + task_code` 的 assessment/training 会话执行熔断和 incident binding，再确定性落 `LEVEL_FAIL_BY_SAFETY` 结果及可重建步骤投影。APPLY 不得临时生成 `REDLINE_TRIGGERED` 或其他未 PREPARE 事件。

### S8：报告导出 artifact

Given report export target 已通过权限、source lineage、路径与 no-clobber 校验，

When coordinator 执行 export，

Then command 在 durable claim 后显示一次 save dialog；取消被持久化为无 batch 的完成结果。选定路径后先以 command-owned 临时探针验证目标目录支持所需 identity、durability 与原子 no-clobber 能力，再由纯 exporter 在内存中冻结 bytes 与 SHA-256；能力不成立时在 PONR 前失败且不创建目标。`REPORT_EXPORTED` EVENT 包含 target identity、builder version 与 content hash。PREPARE 后才创建 command-owned 同目录 stage 并原子 no-clobber 发布，再 APPLY/CONFIRM。恢复时：最终目标 hash 匹配则继续；owned stage hash 匹配则采用；两者都不存在时按 EVENT 的版本化 `artifact_from_event` 确定性重建并校验 hash；身份冲突或无法重建才进入 corruption/read-only，绝不覆盖或删除外来文件。

### S9：gate-only 命令

Given auth/student/strategy 命令通过 preflight 与 durable claim，

When 执行业务 DML，

Then DML、审计行与版本化 result 在同一 `BEGIN IMMEDIATE` transaction 中完成；确定性业务失败作为已完成 result 持久化，`FAILED` 只表示符合 registry policy 的 pre-PONR 系统失败。进程内 binding 等可重建 effect 只能由已提交结果幂等恢复，不能成为重复 DML 的理由。

## 6. 范围

### 6.1 本次包含

- v2.2 三类 JSONL record、canonical serialization、EVENT checksum、global batch sequence、hash chain、segment rotation 与原子 `segment_index.json`。
- T11 `command_log`、T12 `applied_event_batch`、T13 `processed_event`、T14 `projector_cursor` 的 Schema、静态 migration、结构断言与临时库验证。
- durable idempotency、30s lease / 10s renewal、generation fencing、PONR、结果恢复与完整 crash matrix。
- M5A Command Bus pipeline 的 durable acceptance 重排，以及 46 个 mutation 的执行分类。
- 所有现存领域 writer 与 report automation 的 side-effect-free planner / projector 化；nested automation 合并进 root command 的同一 batch。
- legacy v1 / F7-v2 reader、一次性 reconcile、无损封存、mixed replay 与 legacy anchor。
- report export staging/publish/recovery 的 artifact crash matrix。
- runtime startup gate、只读 corruption mode、一个 `runtime:getHealth` READ channel、renderer 状态通知与脱敏诊断快照。
- M5B mutation/writer inventory、静态 capability gate、故障注入、迁移/恢复、原生 SQLite、Electron E2E、范围与默认数据保护证据。
- 实施完成后新增版本化不变量 `INV-EVT-004`～`INV-EVT-006`；既有 `INV-EVT-002` 保留 legacy 语义，不覆盖。

### 6.2 明确不包含

- M5C 的 utilityProcess、MessagePortMain、OS 级跨进程 writer ownership / owner epoch；M5B 只实现并证明当前进程的唯一 runtime、全局 writer mutex 与逻辑 worker lease fencing。
- HTTP、REST、SSE、Teacher Web、mDNS、证书、配对或局域网传输。
- T18 `offline_score_draft`、草稿 API/UI、多教师交接；只迁移当前正式评分提交的 batch finalize。
- backup/restore 产品能力、generation pointer、自动修复 corruption 或 destructive down migration；本步仅复用迁移前成对备份。
- 42+8 题目内容、激活、评分语义、reason migration、Pilot authorization lock 或 BASE_ABILITY 策略变更。
- 新 EventType、`EVENT_GROUP`、sidecar intent、SQLite 事实源、合法历史重写或通用 ORM / UPSERT 投影。
- 默认运行库的测试、快照、hash 或人工迁移。

## 7. 冻结协议

### 7.1 Transport 与 durable command identity

1. preload 对每个可信 context 生成一个 `client_instance_id`，每次业务 mutation invocation 生成 UUID `idempotency_key`，作为第二个 IPC transport argument 透明附加；现有 renderer 业务参数和返回类型不变。
2. renderer business payload 中同名字段一律忽略并拒绝；测试 adapter 与未来 transport 可显式重放同一 metadata，生产 renderer 不能选择或复用 key。
3. 当前 renderer 不自动重试；一次新点击使用新 key。M5B 保证“同一 metadata 的 transport replay”幂等，不虚构跨应用重启的 UI pending queue。
4. pipeline 顺序为：transport/结构校验 → read-only actor 验证 → secret-safe request fingerprint → existing-key lookup → 新命令才做权威 target resolve → INSERT/SELECT command + 原子 lease → 取得 current-process writer mutex → 在 mutex 内重验 gate/lease/target并 plan。command claim 的短 SQLite transaction 在等待 mutex 前结束，不能反向持锁。只有 command row 成功建立后才叫 `DURABLE_ACCEPTED`。
5. `request_hash = SHA-256(UTF8(canonical_json({command_type, normalized_business_input})))`。caller hints 和 transport metadata 不进入 business input；password 等低熵秘密先按 registry 声明的稳定 domain salt（`protocol label + command_type + normalized non-secret identity`）做 PBKDF2-SHA512（100,000 iterations、64 bytes），再用固定结构替换原值进入 canonical input。相同业务输入跨 idempotency key 的 hash 保持一致；禁止在 DB、trace 或普通 SHA-256 输入中保留明文秘密。
6. existing-key 比较 `command_type`、`request_hash`、`actor_id`、`device_id`、`auth_session_id`；actor 权限仍在 lookup 前重新验证。成功重放不依赖当前 target 仍可重新解析；pre-PONR 接管才重新执行 target resolve / planner。唯一例外是 `auth:logout`：该命令会撤销自己的 session，因此同一可信 client/key、row actor/session 完全匹配的 `SUCCEEDED` 重放可在 active-session 校验后置时返回非敏感 `{success:true}`，不能借此执行其他命令或读取数据。
7. `CommandEnvelope` 升级为 v2：`commandId` 必须取持久化 command row 的 ID，并包含可信 `clientInstanceId`、`idempotencyKey`、`actorId`、`deviceId`、`authSessionId` 与当前 lease generation；不得继续用 preflight 临时 UUID 充当 accepted command ID。root correlation 使用该 command ID。
8. root command 是唯一 command_log / batch owner。当前 accepted-child/report automation 改为 deterministic plan fragment，并以 `parent command id + child ordinal + child type` 派生 event/correlation identity；不得在父命令内启动第二个 batch。独立后台 SYSTEM command 才拥有自己的稳定 operation-epoch idempotency key。

### 7.2 Planner、projector 与结果

- planner 在 writer mutex 和有效 lease 下读取权威状态，输出冻结的有序 `EventIntent[]`、确定性 ID / UTC timestamp、版本化 `result_from_batch` recipe 与显式 operational apply effects；planner 不执行 DB DML、不追加/创建/重命名/删除永久文件、不清理外部文件。
- PREPARE 之前不得创建 staging 或目标文件。`reports:export` 的 OS save dialog 是唯一 `INTERACTION_PREFLIGHT`：它发生在 durable claim 后、writer mutex 前，不写 data root，并在等待期间续租；取消结果 fenced 持久化。路径选定后允许一次 `PRE_PONR_ARTIFACT_PROBE`，只在目标同目录创建 command-owned hidden probe 来验证 exclusive create、hard-link no-clobber、file/directory barrier 与 identity，并在进入 PONR 前清理；探针失败不触碰选定目标，异常退出留下的探针不得被当作成功 artifact 或无证明自动删除。PREPARE 前崩溃按 §11.7 重置 PENDING，但 startup/background 不得主动重开 dialog；只有携带原 metadata 的显式 transport replay 才可在 max attempts 内重新交互。当前本地 commands 的 durable max attempts 固定为 3。
- projector 只消费 PREPARE 中已有 EVENT。`domain_event_projection`、`processed_event`、业务投影、command-declared operational effect 与 `projector_cursor` 在同一 `BEGIN IMMEDIATE` 中执行；禁止通用 `INSERT OR REPLACE` / UPSERT 掩盖冲突。
- 每个新 EVENT payload 必须自足到可在 startupRecovery / rebuild 中确定性投影：需要的业务 ID、时间、状态前后值、lineage、策略/题目版本或内容 hash 都在 payload 中冻结。允许在既有 EventType 下增加向后兼容的 payload schema version；旧 v1/F7 reader 保留。projector 不得读取会随命令后续变化且未由版本/hash 固定的领域状态。
- auth heartbeat 等非领域运行态写必须作为确定性 operational effect 明确登记；它不能发生在拒绝路径，也不能生成事件。可重建内存 binding 在 commit 后幂等应用，并可从 DB/result 重新建立。
- `auth:login` 的 completed replay 必须重新核验账号与 auth_session 仍有效，再以持久 `auth_session_id` 幂等绑定当前 sender；本地 binding 不得依赖无法从 command result 安全恢复的明文 raw token。账号已禁用/会话已撤销时不返回旧成功快照。`auth:logout` 清理 binding 是可重复的 post-result effect。
- operational apply effect 必须能仅由 command row、可信 actor/session 字段、command type 与 prepared EVENT 确定性重建；否则它必须进入 EVENT payload 或改为 gate-only transaction，不能只存在于 planner 内存。
- `BATCH_DOMAIN_MUTATION` 若按既有合同得到“成功但无业务变化”，可以直接持久化完成 result，但必须满足事件数为 0、业务 DML 为 0、永久文件变化为 0；不得创建 `event_count=0` batch。
- `result_json` 是 `{schema_version, public_result}` 的 canonical envelope。每个 command type 必须有版本化 `result_from_batch`；恢复所需 ID、时间和 lineage 必须在 EVENT 中，不能依赖重跑 planner。
- 确定性业务拒绝作为不可变 completed result 保存；只有 pre-PONR 系统失败使用 `FAILED`。越过 PONR 后不得把 command 标为 FAILED、不得增加新业务 attempt，只能恢复原 batch。

### 7.3 JSONL、hash 与 segment

- 永久 record type 只有 `BATCH_PREPARED`、`EVENT`、`BATCH_COMMITTED`；字段满足架构 §10.4，禁止额外 sidecar intent。
- canonical JSON：对象 key 递归升序、数组保序、无多余空白、UTF-8；拒绝 `undefined`、NaN、Infinity 与非 JSON 值。每条新 v2.2 record 以一个 LF 结束。
- EVENT `checksum = SHA-256(UTF8(canonical_json(payload)))`，存 64 位小写 hex。
- `events_hash` 输入为每条 canonical EVENT 加 LF 的有序拼接，最后一条也含 LF；`batch_hash = SHA-256(UTF8(previous_batch_hash) || UTF8(events_hash))`。第一批 previous 为字符串 `GENESIS`，其后跨 segment 连续。
- PREPARE、SQLite batch 与 segment index 的 previous/events/batch hash 必须一致；EVENT 的 batch ID、event count、aggregate sequence 与 checksum 必须可复算。
- segment 阈值固定为 10,485,760 bytes 或 10,000 个 confirmed batches；batch 不跨段。单 batch 上限固定为 1,000 events 且 canonical EVENT 总 bytes 不超过 8 MiB，越界在 PREPARE 前稳定失败。
- sealed segment 永久保留。index 以同目录临时文件 + 原子 no-clobber/replace + file/directory durability barrier 更新；index 落后可从已验证 segment 重建，冲突不能猜测覆盖。

### 7.4 PREPARE / APPLY / CONFIRM 与 fencing

1. 每个 durable mutation 按架构 §11.6 在 command 注册时预留 `event_batch_id`；只有确有 1..N 个领域事件的 `BATCH_DOMAIN_MUTATION` 使用它，gate-only / canceled / no-event completed command 将其保留为未使用 reservation，不创建 batch。在全局 writer mutex 下分配单调 `batch_sequence`，检查 segment identity，写完整 PREPARE + 全部 EVENT 并 fsync。完整记录及其 event_count/hash 可复算后进入 PONR。
2. APPLY 使用一个 `BEGIN IMMEDIATE`：插入 `applied_event_batch(APPLIED)` → 逐事件检查/插入 `processed_event` → 执行 projectors/effects → 更新全部 projector cursor → COMMIT。任一冲突回滚整批。
3. CONFIRM 追加 `BATCH_COMMITTED` 并 fsync，再 fenced 更新 batch 为 CONFIRMED，持久更新 index，最后 fenced 写 command result。成功响应只在这些步骤完成后返回。
4. lease 默认 30 秒、每 10 秒续约。租约获取、续约、APPLY、CONFIRM 与 result update 都比较 `lease_owner + current_lease_generation`；PREPARE 固定保存 `prepared_lease_generation`。
5. 接管允许 `prepared_lease_generation < current_lease_generation`；`prepared > current`、command/batch/request 不相等或旧 generation 继续写任何阶段均为 corruption/fencing failure。
6. M5B 的 current-process writer mutex 覆盖全部普通 mutation 与 event-log recovery；migration/legacy reconcile 在 runtime 构造前独占 data root。M5C 才增加跨进程 owner epoch，M5B 不声称已经解决 OS 级双进程写入。

### 7.5 startupRecovery 四阶段

1. 扫描 legacy anchor、sealed segments、active segment 与 index；只把 active v2.2 segment 的不可解析尾部截断到最后一个已验证 record/batch byte boundary。完整 PREPARE 不截断、不替换；先把原始尾部归档并完成 durability barrier。
2. 对 SQLite `APPLIED` 未 `CONFIRMED` 批次验证完整 PREPARE/hash/fencing：若无 COMMITTED，追加恰好一条并 fsync；若已有恰好一条匹配的完整 COMMITTED，只补 SQLite confirmed/index；重复或冲突 COMMITTED 进入 corruption。
3. 对完整 PREPARE、无 COMMITTED 且 SQLite 未 applied 的批次执行原 EVENT projector APPLY，再确认；不调用 planner。
4. 校准 cursor/index，恢复 PROCESSING command：confirmed batch 通过 `result_from_batch` 完成；无完整 PREPARE 的命令按 pre-PONR policy 重置/失败；command_log 只能恢复架构 §11.9 明确可恢复的部分，不声称可从 JSONL 完整重建。

每阶段都必须幂等。任何无法证明唯一动作的冲突进入 `CORRUPTION_READ_ONLY`；corruption 诊断只在 SQLite integrity 可证明时通过 `RECOVERY_INTERNAL` best-effort 写 `error_event_log`，不能让诊断写失败掩盖原始故障。

### 7.6 legacy 无损切换

- migration 前只读解析 legacy record、checksum、aggregate sequence 与 F7 factual-correction group；先建立成对 DB + exact-log backup。
- 合法 legacy 文件永不补 LF、重排、canonicalize、复制覆盖或追加新 recovery audit。既有 `RECOVERY_REPLAYED` / `RECOVERY_LOG_TRUNCATED` 继续由 compatibility reader 识别。
- 只有最后一条可证明为不完整 JSON 时，才可归档从精确 byte offset 起的原始 bytes 并截断；checksum 错误、完整但不支持的事件、非尾部 malformed 或 sequence conflict 一律 fail closed。
- legacy reconcile 只用于把已存在事实补进投影；完成后 production `writeEvent()` 不再可达。`action_log.jsonl` 逻辑封存，legacy anchor 至少记录相对路径、byte length、SHA-256、last event ID/time 与 sealed time。
- 新 v2.2 chain 不把 legacy hash 当作 `previous_batch_hash`；第一批仍用 `GENESIS`，legacy anchor 提供两代事实的可审计连接。

### 7.7 report artifact 与交互协议

- `reports:export` 先 durable claim，再在不持有 writer mutex / SQLite transaction 时显示一次 save dialog，并续约 command lease。取消写入版本化 `{success:true,canceled:true}` result，不生成 batch；同 key 重放不再显示 dialog。
- dialog 选择的路径是 Main 产生的可信 interaction context，不由 renderer business payload 提供，也不改变 renderer API；它在取得 writer mutex 后重新校验。若进程在 PREPARE 前退出，startupRecovery 不猜测路径并把命令重置 PENDING；startup/background 不显示 dialog，只有原 key 的显式 transport replay 可重新选择，用户也可用新 key 发起新意图。
- 进入 PONR 前必须用 command-owned hidden probe 在 target 同目录实测 exclusive create、hard-link no-clobber、file/directory durability 与 file identity。能力不成立时清理 probe、fenced 记录失败并保持 runtime OPEN；不能先 PREPARE 再因目标文件系统不支持原子发布而把全局 runtime 卡入 corruption。probe 绝不使用选定 target 名称，异常遗留也不允许按通配符清理。
- planner 只在内存中生成冻结 HTML bytes/hash。EVENT 存 target 的规范身份、report/source lineage、content/presentation/file hash、file size、export timestamp、file asset ID、format 与 builder version；不得把路径或正文写入 trace。
- PONR 后，`artifact_from_event` 可由不可变 report projection + EVENT 元数据重建同一 bytes。staging path 从 command ID 派生并位于 target 同目录；以 exclusive create 写入，拒绝 symlink、hardlink alias 与已存在的不可证明文件。
- 以原子 no-clobber 发布。target 已存在且 hash 相同视为已发布；不同则 corruption，不允许 rename 覆盖。stage 存在时只采用 hash 完全匹配的 command-owned bytes；stage 与 target 都缺失时重建，重建 hash 不匹配才 fail closed。
- target/stage 任一身份在检查与使用之间改变或 bytes 不匹配时，不 APPLY、不删除外部文件、进入只读态。
- owned stage 只在 confirmed/result durable 后清理；清理失败是可观察 maintenance warning，不撤销已确认命令。永久 sidecar 不作为事实源。

### 7.8 Schema 与恢复分类

- `schema.sql` 与静态 migration 新增架构 §7.2 T11–T14 的字段、CHECK、unique/index；结构断言检查实际 table/index SQL，不只看 migration ledger。
- `domain_event_projection` 保留为查询投影；`processed_event` 负责 v2 event 幂等，二者 event ID / source segment 必须对账。
- `command_log` 是混合基础设施表：event batch identity 与进度部分可恢复，client/key、lease、attempt、完整 result 等依赖 SQLite 备份；文档和测试不得声称空 DB 可恢复全部 command history。
- 领域投影可从 legacy + v2.2 事实重建，但 rebuild 测试必须显式提供不可重建基础设施 fixture，不把 user/student/strategy/question/auth 等伪装为事件投影。
- 不新增 `offline_score_draft`、backup manifest 或其他 v2.2 全量架构表。

## 8. 错误、状态与兼容性

- mutation 在 `MIGRATING`、`LEGACY_RECONCILING`、`BATCH_RECOVERING`、`CORRUPTION_READ_ONLY`、`CLOSED` 均不得执行业务 side effect。
- boundary not ready、durability、fencing、corruption 等内部原因映射到现有六类 public system error，保持 46 个业务 API union；详细 code 只通过 versioned runtime health/diagnostic contract 暴露。
- READ 仅在 `OPEN` / `CORRUPTION_READ_ONLY` 注册或放行；不得执行 heartbeat、seed、reconcile、目录创建、snapshot 更新或其他 lazy write。
- `runtime:getHealth` 返回 `schema_version`、runtime state、blocking code、last verified batch/segment、recovery phase 与始终可用的最小脱敏诊断；已绑定 ADMIN 可取得额外非敏感结构统计。新增 invoke channel 和 push event 必须同时更新 shared/preload/renderer 合同与白名单测试；75 只统计 invoke channel，push event 不计入 registry channel 数。
- 当前 active-key guard 可保留为快速并发提示，但 durable command row + writer mutex + lease generation 才是正确性边界；不能以进程内 Map 代替持久幂等。
- legacy v1/F7-v2 payload、EventType 与 replay reducer 保持；新 v2.2 EVENT envelope 的协议版本不改变既有业务 payload schema_version 含义。

## 9. 迁移、回滚与数据保护

1. 路径解析与 alias guard 必须在数据库或日志 open 前完成；DB、data root、userData 与 evidence root 成对且绝对。
2. 仅接受 fresh DB 或结构精确匹配 `v0.1.17-multi-device-m4-safety-rekey` 的历史库；未知/混合/ledger 漂移在备份或 DDL 前失败。
3. 历史库顺序固定为：只读 schema/legacy preflight → paired backup → T11–T14 migration/结构断言 → 必要的已证明尾部归档/截断 → legacy reconcile → legacy seal/index anchor → v2.2 recovery → OPEN。migration transaction 不包含文件操作；任一步失败都不开放 runtime。
4. fresh DB 从完整 `schema.sql` 建立目标结构，不运行历史 destructive transform；有非空 legacy log 却是 fresh DB 时失败关闭。
5. 第一条 production v2.2 PREPARE 前，可在批准 impl 明确的条件下回退应用和空的 T11–T14；一旦任一 v2.2 batch 写入，只允许前滚修复或从批准的成对备份灾难恢复，不提供自动 down。
6. 自动化不得解析默认 Electron userData。测试 harness 缺路径、路径非 `/tmp`、DB 与 data root 不配对、symlink/hardlink alias 或 evidence 复用时，必须在 open 前失败；以“默认库前后 hash 相同”替代隔离不算通过。

## 10. 非功能要求

- Durability：文件内容与必要目录 metadata 必须使用平台适配的已验证 barrier；KAT 不通过的平台保持 mutation closed，不静默降级。
- 一致性：一个 data root 当前进程最多一个 runtime、一个 writer mutex、一个 active segment、一个 global batch sequence。
- 性能：正常 command 不全量扫描 sealed segments；startupRecovery 使用 index/cursor，但必须能在 index 丢失时从 segment 验证重建。批次上限在 PREPARE 前执行。
- 可观测性：只记录 command/batch/stage/segment/generation/hash prefix/稳定错误，不记录密码、token、完整请求/结果、PII 或报告正文。
- 安全：文件路径 canonicalize 后检查目录与 identity；所有生产本地模块使用静态 import；不得引入 ORM、前端持久化库或新的动态本地 TS 加载。
- 用户体验：正常业务响应合同不变；recovery 期间不显示虚假可操作状态；corruption 时显示只读说明、稳定错误与诊断入口，不提供“自动修复”按钮。

## 11. 验收标准

| ID | 输入 | 预期输出 | 必须执行的证据 |
|---|---|---|---|
| EBR-01 | M5A 最终 checkout 与新 inventory | 精确识别 75 channels（29 READ/46 MUTATION）、36 batch/10 gate-only，361 active entries 与 76 exceptions 均有唯一迁移裁决；43 legacy writer + 8 request recovery target 为 0 | versioned inventory + scanner exact/negative tests |
| EBR-02 | 正常单事件、多事件、无事件成功命令 | 三 record/hash/cursor/projection/result 一致；多事件一个 batch；无事件成功无 batch/业务 DML | coordinator + planner/projector integration tests |
| EBR-03 | same key/same request、same key/different request/actor、new key/same payload、并发 lease、含 password 的请求、login/logout 重放 | 稳定重放、冲突拒绝、新意图、generation 单调且旧 worker 所有写阶段被 fence；command_log/trace 不含明文或低成本秘密摘要；login 安全重绑、logout 自撤销后只返回非敏感旧结果 | command-log/idempotency/concurrency/privacy/auth-binding tests |
| EBR-04 | 7 个架构 crash window，加 PREPARE/record/fsync/APPLY/COMMIT/index/result 每个细分故障 | 无部分 projection、无 replacement batch；PONR 前按 policy，PONR 后只恢复原 batch | stage-by-stage fault matrix，必须证明 planner 调用次数 |
| EBR-05 | payload/previous hash/events hash/batch hash/sequence/checksum/index/cursor/file identity 篡改 | `CORRUPTION_READ_ONLY`、mutation 零副作用、READ 与 health 可用、诊断脱敏 | tamper/negative recovery + renderer contract tests |
| EBR-06 | 10 MiB / 10,000 batch 边界、跨段 chain、index 丢失/落后/冲突 | batch 不拆分、sealed segment 永久、合法 index 可重建、冲突不覆盖 | segment rotation/index KAT tests |
| EBR-07 | legacy v1/F7-v2，分别含 LF/完整 EOF，projection 有/无，合法/不完整/冲突尾部 | 合法 bytes hash+length 不变；只归档并截断已证明的末尾；mixed replay 确定 | byte-exact legacy migration/replay tests |
| EBR-08 | `assessment:triggerRedline` 与历史两事件日志 | 新 batch 恰好一个安全事件，M4 三元 trigger/结果整体投影；legacy pair 原样重放 | native SQLite fault tests + Electron safety E2E |
| EBR-09 | operation / BASE_ABILITY / JOB_SKILL 批量评分、自动结果/报告/任务闭环 | 每个 root command 一个 batch，child plan 顺序固定，失败零部分投影，结果类型/lineage 不变 | service regressions + full task-flow tests |
| EBR-10 | report dialog cancel/超时、unsupported target filesystem、probe cleanup/崩溃、PREPARE 前崩溃与显式 same-key replay，以及 staging/publish/APPLY/CONFIRM 每个 crash window和目标竞态 | cancel 幂等无 batch；能力不足在 PONR 前失败且 target 不存在；startup/background 不重开 dialog；same-key 可重新交互；PONR 后可从 event 重建；no-clobber；同 hash 采用；异 hash 只读失败；不删除外来文件 | real temporary-filesystem artifact + interaction matrix |
| EBR-11 | auth/student/strategy 10 个 gate-only 命令 | DML+audit+result 同 transaction；无事件/segment；重放不重复 DML；binding 可恢复 | native SQLite + IPC regression tests |
| EBR-12 | fresh 与 v0.1.17 历史临时库、mixed/unknown schema | T11–T14 forward、结构/FK/integrity/query plan/backup/restore 验证；未知态 DDL 前失败 | migration tests + isolated DB verifier |
| EBR-13 | runtime 各 startup state、corruption、read handler | mutation 全关闭；READ 无 lazy write；health query/push 与 ADMIN diagnostic 正确 | registry/readiness/renderer tests |
| EBR-14 | 缺失/非临时/不配对/alias 测试路径 | DB/file adapter open count 为 0；默认库未读、未 hash、未改 | isolated scope/path guard negative tests |
| EBR-15 | 生产构建与 native addon | `BEGIN IMMEDIATE`、fsync/identity KAT、Electron ABI、主/preload/renderer 构建及真实桌面流程通过 | native Electron verifier + Electron E2E |
| EBR-16 | R3 交付 | PRD、impl、独立 review、逐步 accept、最终 code review/accept、基线/不变量/文档索引均有实际 PASS；required check 无 NOT_RUN | workflow artifacts + command exit codes + diff |

## 12. 适用不变量

- 保持：`INV-EVT-001`～`003`、`INV-SAFE-001`～`004`、`INV-RES-001`～`002`、`INV-IPC-001`～`002`、`INV-DATA-001`～`003`、`INV-AUTH-001`～`002`。
- 实施完成后新增而非覆盖：
  - `INV-EVT-004`：v2.2 batch persistence order、canonical hash 与单 batch 原子 projector；
  - `INV-EVT-005`：durable idempotency、lease fencing、PONR 后禁止 planner rerun；
  - `INV-EVT-006`：data-root startup gate、legacy seal、segment/index/cursor 一致与 corruption read-only。
- `INV-EVT-002` 继续描述 legacy “先事实后投影”历史，不改写为三阶段语义。
- 如实施发现权威 PRD、当前 Schema 或上述不变量无法同时成立，标记 [!] 并停止；不得用测试 fixture 选择性绕过。

## 13. 风险、回滚与停止条件

### 13.1 主要风险

- 当前 service 把事件追加、业务 DML、child automation 与 error log 交错在同一函数；机械替换 writer 会在 PREPARE 后继续运行 handler，直接违反 PONR。
- legacy 与 v2.2 两代 reader 共存，任何“顺手格式化”都可能破坏历史事实或 F7 factual-correction group。
- report artifact 无法与 SQLite 原子提交，必须靠 prepared fact、hash 与 no-clobber 恢复；缺任一 identity 证明都可能覆盖用户文件。
- current-process mutex 不是跨进程 ownership；若 M5B 文档或测试宣称解决多进程双写，会掩盖 M5C 的阻断风险。
- command result 若依赖当前状态而非 prepared events，CONFIRM 后崩溃会产生不同响应或迫使重跑 handler。

### 13.2 回滚

- 无 v2.2 PREPARE：可按批准 impl 回退应用，保留 migration backup 与 legacy bytes；T11–T14 只有经结构/空表证明后才可人工回退。
- 已存在 v2.2 PREPARE：只允许前滚恢复或成对备份恢复；不得删表、删 segment、重置 sequence、断开 hash chain或回写 legacy。
- corruption：保持只读并导出诊断，不自动 truncate 完整 record、不覆盖 index、不删除 artifact。

### 13.3 停止条件

- 需要偏离权威三 record、canonical hash、PONR、七步 lease/fencing 或四阶段 recovery；
- 无法把任一现存 writer/capability 唯一分类，或仍有 production direct legacy writer/request-time recovery；
- 无法证明新安全命令单事件与 legacy 两事件兼容同时成立；
- 需要读取或操作默认运行库；
- 需要新增 T18、HTTP、utilityProcess、跨进程 owner epoch 或其他本 PRD 排除的产品能力；
- 独立 review / accept 出现未关闭 P0/P1，或 required check 为 `FAIL`、`BLOCKED`、`NOT_RUN`。

## 14. 已确认决策与待实施核验

### 14.1 已确认决策

- 采用 v2.2 三 record、JSONL 事实源、SQLite projector、T11–T14、单 batch / root command、PONR 与四阶段 recovery。
- 当前 46 mutation 固定分类为 36 batch-domain + 10 gate-only；新增一个 runtime health READ，不改变现有业务 mutation API。
- legacy bytes 零改写，新 chain 从 `GENESIS` 开始，以 index legacy anchor 建立审计关联。
- safety 新写路径只写 `SAFETY_INCIDENT_CREATED`；legacy `REDLINE_TRIGGERED` 保留可读。
- M5B 只保证 current-process ownership；M5C 承担进程独占 writer / owner epoch。
- 默认数据保护以 open-before guard 证明，不读取默认数据做 before/after 快照。

### 14.2 实施计划必须核验但不改变产品边界的事项

- Node/Electron 在目标平台可用的 file/directory durability barrier 与 identity KAT 适配；
- 每个 command 的 planner、projector、result schema、pre-PONR retry 与 operational effect 明细；
- legacy anchor 与 segment index 的精确 JSON Schema、文件名和原子更新步骤；
- migration ID、结构断言 SQL、故障注入 point ID 与定向命令名；
- `runtime:getHealth` shared/preload/renderer 形状及脱敏字段。

不存在待用户选择的产品分支。上述核验若暴露权威冲突，按停止条件退回，不以实现便利修改本 PRD。
