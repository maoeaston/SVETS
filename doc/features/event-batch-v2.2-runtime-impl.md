# M5B Event Batch Runtime 实施计划

**状态：`APPROVED_FOR_IMPLEMENTATION`。** Round 1 独立审查发现 0 个 P0、6 个 P1、1 个 P2；修订版经 Round 2 复审全部关闭，最终结论 `PASS`，详见 `doc/features/event-batch-v2.2-runtime-impl-review.md`。用户已明确授权连续实施，无需为正常步骤切换重复确认。

## 1. 实现目标

把 `doc/features/event-batch-v2.2-runtime-prd.md` 转换为可逐步实现、逐步验收、在不可逆点前可单独回退的 R3 工程计划，并把 M5A 已验收的单进程 Command Bus 边界升级为 durable command + v2.2 batch runtime。

最终必须同时成立：

1. 中央 IPC registry 恰好 75 个 invoke channel：29 个 `READ`、46 个 `MUTATION`；push health event 不计入 invoke 数。
2. 46 个 mutation 恰好分为 36 个 `BATCH_DOMAIN_MUTATION` 与 10 个 `GATE_ONLY_MUTATION`。
3. 每个 durable mutation 先持久 claim 并预留 `event_batch_id`；只有计划出 1..N 个领域事件的命令创建 batch，gate-only、取消和成功 no-op 不创建零事件 batch。
4. 领域命令统一执行 `plan -> BATCH_PREPARED + EVENT* + fsync -> BEGIN IMMEDIATE APPLY -> BATCH_COMMITTED + fsync -> CONFIRMED/index -> fenced result`；完整 PREPARE fsync 后禁止重跑 planner/handler。
5. 三种永久 record、canonical bytes、checksum、`events_hash`、`batch_hash`、全局 sequence、segment rotation 和 index 可机械验证。
6. T11–T14 成为 Schema `v0.1.18-event-batch-v2.2` 的唯一新增表；不引入 T18 或其他 v2.2 全量架构表。
7. legacy `action_log.jsonl` 合法 bytes 原样封存；新链从 `GENESIS` 开始。43 个 production legacy event-port callsite 与 8 个 request-time report coordinator callsite 最终归零。
8. startup 按 `CLOSED -> MIGRATING -> LEGACY_RECONCILING -> BATCH_RECOVERING -> OPEN` 执行；无法唯一恢复时进入 `CORRUPTION_READ_ONLY`，所有 mutation 零副作用拒绝，READ 与脱敏 health 保持可达。
9. 同一 `(client_instance_id, idempotency_key)` 稳定重放；request/actor/session/device 冲突拒绝；30 秒 lease、10 秒续约、generation fencing 与 3 次 pre-PONR attempt 上限均有故障注入证据。
10. report export 的 dialog、probe、stage、no-clobber publish、artifact rebuild 与恢复遵守冻结协议，不覆盖或删除外来文件。
11. renderer 既有业务方法参数与结果保持不变；transport metadata 由 preload 透明附加。只新增版本化 `runtime:getHealth` 与 health push/UI。
12. 所有自动化使用显式成对 `/tmp` 路径，并在任何 DB/file adapter open 前拒绝缺失、非临时、不配对及 alias；不得定位、读取、hash、初始化或修改默认运行库。

## 2. 基线与范围

### 2.1 输入与状态

- 输入 PRD：`doc/features/event-batch-v2.2-runtime-prd.md`。
- PRD 快照 SHA-256：`bcf99c10cc7ff3832fd454969ac9aae36517980a798700d0b95acea29655e746`。
- 独立 PRD Review：`doc/features/event-batch-v2.2-runtime-prd-review.md`，结论 `PASS`，未关闭 P0/P1/P2 均为 0。
- 风险等级：`R3`。
- 影响域：`SCHEMA_MIGRATION`、`EVENT_PERSISTENCE`、`EVENT_PROJECTION`、`COMMAND_IDEMPOTENCY`、`AUTH_PERMISSION`、`SAFETY_FSM`、`REPORT_ARTIFACT`、`IPC_API`、`RENDERER_STATE`、`DEPLOYMENT_OPERATIONS`。
- 当前分支：`feat/multi-device-m2-prd`。
- 规划基点 commit：`40541c82ef374f28ce300365e0e5cc82423dd99a`。
- 输入 Schema：`v0.1.17-multi-device-m4-safety-rekey`；目标 Schema：`v0.1.18-event-batch-v2.2`。
- 前置里程碑：M4 `ACCEPTED_STEP_2A`、M5A `ACCEPTED_STEP_2B`。
- M5A 固定输入：74 channels（28/46）、215 active direct callsites / 28 files、72 capability callsites / 13 roots、active manifest 361、mapping 378、exceptions 76、pending 0、digest `f97ef382ab9a9678ab20f06310e6906e811cdd765526d69a4fcc11bca6939527`。
- 工作区为 dirty，且大量已验收 M4/M5A 文件相对规划 commit 仍未提交。Step M5B-1 必须保存实现起点的 path/kind/SHA-256 清单，M5B scope gate 必须区分“起点已有改动”“M5B 明确重叠改动”“M5B 新增改动”；不得 reset、覆盖或把无关文件归入 M5B。
- 本计划不授权 commit、push、merge、rebase、发布或默认库迁移。

### 2.2 权威依据

- `AGENTS.md`；
- `doc/specs/baseline.yaml`；
- `doc/specs/project-invariants.md`；
- `doc/ai/vibe-workflow-contract.md`；
- `doc/specs/MVP_PRD_v1.0.9-authoritative.md`；
- `doc/specs/architecture-plan-b-multi-device-v2.2-authoritative-baseline.md` §7.2 T11–T14、§10、§11、§12、§18.3、§22.4、§23.5–23.6；
- `doc/features/multi-device-m4-m5-prd.md` §4；
- `src/main/db/schema.sql`；
- `src/shared/types/event-payloads.ts`、`src/shared/types/json-schemas.ts`、`src/shared/types/ipc-api.ts`；
- M5A final command registry、active inventory/mapping、current service/reducer/report/export/recovery call graph 与实际测试。

### 2.3 明确不做

- 不实现 M5C utilityProcess、MessagePortMain、OS 级 data-root lock、owner epoch 或跨进程单写者声明。
- 不新增 HTTP、REST、SSE、Teacher Web、mDNS、证书、配对或局域网 transport。
- 不新增 T18 `offline_score_draft`、草稿 API/UI、多教师草稿交接。
- 不新增 backup/restore 产品功能、generation pointer、自动 corruption 修复或 destructive down migration。
- 不修改 42+8 内容、BASE_ABILITY 激活/评分/reason/pilot authorization 语义。
- 不新增 EventType、`EVENT_GROUP`、sidecar intent、SQLite 事实源、ORM、通用 UPSERT projector、前端持久化库或动态加载本地 TS。
- 不改写合法 legacy bytes，不把 legacy hash 接到新 batch chain，不删除 `REDLINE_TRIGGERED` 历史 EventType。
- 不改变 46 个既有业务方法的 renderer 参数/结果 union，不让 renderer 构造 command/batch/lease/writer capability。
- 不把测试 build、WASM SQLite 或静态检查替代 native Electron、真实文件系统 durability 与人工桌面流程。
- 不打开、读取、hash、初始化、迁移或修改默认 `xc-career-guide.db`、默认 userData 或默认 action-log。

## 3. 适用不变量

- `INV-EVT-001`：领域受控状态继续由事件和 projector 推进；command/batch 基础设施不直接替代领域事件。
- `INV-EVT-002`：保留 legacy “事实先于投影”的历史语义；不得把它改写成 v2.2 三阶段合同。
- `INV-EVT-003`：EventType、payload validator、persist、projector/reducer 与 replay 必须同步；本步只增加向后兼容 payload 版本。
- `INV-SAFE-001`～`004`：安全聚合键保持 `student_id + job_code + task_code`，先熔断后归因、禁止直接插入 `REDLINE_HALTED`、生命周期和事实冻结不变。
- `INV-RES-001`～`002`：四类结果不混算，安全结果优先；batch 化不得改变评分公式或 lineage。
- `INV-AUTH-001`～`002`：角色边界与 assignment 三方一致不放宽；可信 actor/session/device 只来自 Main。
- `INV-IPC-001`～`002`：目标 75 invoke channels 全登记；renderer 不直接访问 Node/文件/DB。
- `INV-DATA-001`～`003`：JSON TEXT 继续运行 validator；不硬编码策略；迁移和恢复只在隔离临时数据上验收。
- 完成后新增而不覆盖：
  - `INV-EVT-004`：v2.2 canonical batch persistence order、hash chain 与单 batch 原子 projector；
  - `INV-EVT-005`：durable idempotency、lease generation fencing 与 PONR 后禁止 planner rerun；
  - `INV-EVT-006`：startup gate、legacy seal、segment/index/cursor 一致及 corruption read-only。

## 4. 变更地图

### 4.1 当前状态

1. M5A runtime 有 `PRE_BOUNDARY_READY / BOUNDARY_READY / CLOSED`，只提供当前进程 active-key guard；envelope command ID 是临时 UUID，没有 durable row、lease 或 generation。
2. 46 个 mutation 已经统一通过 Command Bus，但 application service 仍拥有 legacy event port、transaction、reducer 和 report automation；43 个 production event-port callsite 每次追加一个 `ActionLogEntry`。
3. `connection.ts` 在启动中迁移、加载 schema、seed，并调用 legacy `reconcileActionLog()`；legacy recovery 可能追加 audit event，runtime OPEN 后仍有 request-time report recovery/coordinator 路径。
4. `DBAdapter.transaction()` 未保证 `BEGIN IMMEDIATE`；所有 adapter/test wrapper 尚无显式 immediate transaction contract。
5. `schema.sql` 当前止于 M4 `0.1.17`，没有 T11–T14。
6. preload 对 mutation 只发送业务参数；sender binding 仍依赖 auth 模块的当前进程数据，其中 login/replay 无持久 auth-session-ID 重绑合同。
7. report export 当前有同步文件写/rename 与 legacy event/DB transaction，不能从 prepared event 确定性重建 artifact。
8. renderer 没有 runtime durability health store/banner；corruption 冷启动后没有无会话诊断入口。

### 4.2 目标状态与组件边界

```text
renderer business method
  -> preload: business payload + trusted TransportMetadataV1
  -> central handler registry (75 invoke channels)
  -> structural + actor + secret-safe request hash
  -> DurableCommandStore claim/lookup/lease (short IMMEDIATE txn)
  -> optional reports:export INTERACTION_PREFLIGHT (no writer mutex/DB txn)
  -> process WriterMutex
  -> revalidate gate/lease/target
       |-> GATE_ONLY executor: DML + command result in one IMMEDIATE txn
       `-> BATCH coordinator:
             side-effect-free planner
             PREPARE + EVENT* + fsync             [PONR]
             optional prepared artifact stage/publish
             IMMEDIATE APPLY: batch/processed/projectors/effects/cursors
             COMMITTED + fsync
             fenced CONFIRMED + index + result
  -> post-commit idempotent in-memory binding / owned-stage cleanup
```

目标模块职责：

- `src/main/application/command/`：transport metadata、secret-safe request hash、durable command store、lease/envelope v2、result envelope 与 gate-only executor。
- `src/main/domain/event-batch/`：record/schema、canonical/hash、segment/index/file identity、writer mutex、coordinator、projector/result registry、startup recovery、legacy anchor/seal。
- `src/main/application/planners/`：逐命令纯 planner、plan fragment 与 deterministic ID/time；不持有低层 DB mutation/file capability。
- `src/main/domain/projectors/`：逐事件版本 projector 与 operational apply effect；复用现有业务规则但不调用 writer/planner。
- `src/main/application/runtime/`：startup state、capability、composition root、health snapshot/push 与 corruption gate。
- `src/main/db/`：T11–T14、`BEGIN IMMEDIATE` port、迁移 preflight/backup/结构断言；文件 I/O 不进入 migration transaction。
- `src/shared/`、`src/preload/`、`src/renderer/`：仅 transport metadata 内部桥接及 runtime health public contract/UI；业务 API 不变。

### 4.3 固定 command 分类与迁移归属

| 类别 / Step | channel | batch event / effect 约束 |
|---|---|---|
| Gate-only / M5B-7 | `auth:login`、`auth:logout`、`auth:createTeacherAccount`、`auth:setTeacherAccountStatus` | 无领域事件；business DML + fenced result 同一 IMMEDIATE transaction；binding 是 commit 后可重建 effect。 |
| Gate-only / M5B-7 | `student:create`、`student:update`、`student:archive` | 无领域事件；既有 JSON/账号/档案约束不变，不创建零事件 batch。 |
| Gate-only / M5B-7 | `strategy:createVersion`、`strategy:update`、`strategy:setActive` | 无领域事件；引用版本不可变与 ACTIVE 规则不变。 |
| Report / M5B-6 | `reports:confirmTaskClosure`、`reports:replaceTaskClosure`、`reports:generate`、`reports:confirmPlacementReview`、`reports:lock` | 现有 `TASK_CLOSURE_*`、`REPORT_GENERATED`、`PLACEMENT_REVIEW_CONFIRMED`、`REPORT_LOCKED`；自动化作为同一 root plan fragment。 |
| Training / M5B-8 | `training:createSession`、`training:startStep`、`training:completeStep`、`training:skipStep`、`training:failStep`、`training:retryStep` | `TRAINING_STARTED`、逐 step event；最后一步需要时追加确定性 `TRAINING_COMPLETED` fragment。 |
| Assessment / M5B-9 | `assessment:createSession`、`assessment:submitAnswer`、`assessment:emotionInterrupt`、`assessment:emotionResume`、`assessment:pauseSitting`、`assessment:startNextSitting`、`assessment:recordEmotionCollapse`、`assessment:abortSession`、`assessment:calculateResult`、`assessment:startSession` | 现有 session/answer/emotion/sitting/result/completion event；collapse、start、calculate 的 1..N 顺序由 golden fixture 固定。 |
| Scoring / M5B-10 | `assessment:submitOfflineAbilityScores`、`assessment:submitOperationScores`、`assessment:submitJobSkillOfflineScores`、`assessment:recordTeacherObservation` | N 个 score/observation event；operation 的 result、job-skill 的 result + completion + report automation 必须并入同一 root batch。 |
| Assignment / M5B-11 | `assignment:create`、`assignment:confirmStudent`、`assignment:startAssessment`、`assignment:rebind`、`assignment:release` | 现有 assignment event；local runtime IDs、organization/node/device/runtime/auth/grant before/after facts由 prepared EVENT 冻结并在 APPLY 重建。 |
| Safety / M5B-12 | `safety:confirm`、`safety:resolve`、`safety:void`、`safety:replaceForFactualCorrection`、`assessment:triggerRedline` | lifecycle event 顺序固定；新 redline batch 恰好一个 `SAFETY_INCIDENT_CREATED`，由 M4 trigger + projector 产生 halt/binding/result，不写新 `REDLINE_TRIGGERED`。 |
| Artifact / M5B-13 | `reports:export` | `REPORT_EXPORTED` + versioned artifact metadata；dialog cancel/no-op 无 batch；PONR 后 artifact 可从 event 重建。 |

上述每个 row 都必须在 machine registry 中登记：command type、execution class、actor policy、target resolver、normalized input schema、secret fields、planner/result recipe version、projector set、operational effects、pre-PONR retry policy、public error mapper、fault-test ID和legacy→v2 differential test ID/允许差异。按 family 汇总不能替代逐 channel row。

### 4.4 Planner / EVENT / projector / result 自足合同

每个 v2 EVENT 使用既有 `EventType`，但 payload 增加向后兼容的 `event_payload_version` 与 `batch_context`。`batch_context` 至少冻结 `plan_version`、`result_recipe_version`、root command type、root command ID、child ordinal、所需 before/after 状态和不可变 lineage/hash。一个 batch 的全部 EVENT 必须携带完全相同的 root command ID/type、plan version 与 result recipe version，recovery 在 APPLY 前逐条比对；缺失或冲突进入 corruption。legacy reader 继续接受旧 payload；v2 projector 按版本 dispatch，未知版本 fail closed。

`CommandPlanV1.operationalEffects` 只是由 `EventIntent[]` 编译得到的进程内执行视图，不是新的事实源。它不得含任何未在 EVENT payload 或 command row稳定字段中持久化的参数。正常 APPLY、startup recovery 与 mixed rebuild 必须通过同一个 registry，仅以 `command_type + event_type + event_payload_version + prepared payload` 重建 projector/effect；`result_from_batch` 同样只能以 command row稳定字段与prepared EVENT dispatch。测试必须在PREPARE后销毁整个plan对象并创建新composition，证明effect和result仍相同。

| 业务族 | planner 必须冻结 | projector / effect 只允许消费 | result 恢复来源 |
|---|---|---|---|
| Assessment / training | session/step/question/result IDs、权威三元键、策略和题目版本/hash、event sequence、before/after 状态、统一 timestamp | EVENT payload + M4 已验收 trigger；不得重新读取可变策略/题目决定旧 batch 结果 | 最后/指定 EVENT 的 versioned result fields |
| Scoring / observation | 每个 score ID、rubric/anchor version、分数、结果 breakdown、completion/report lineage、确定 child order | 逐 event payload；同一 APPLY transaction 中 score→result→session→report | root result recipe + prepared IDs/items count |
| Report / closure | closure/report IDs、source snapshot/hash、revision/builder/schema、before/after lifecycle | prepared snapshot，不重新 build 当前来源 | report/closure EVENT + recipe version |
| Assignment | assignment/grant/device/runtime/auth IDs、capabilities、expiry、before/after phase/version、local runtime bootstrap facts | EVENT 与 command actor/session；不得调用随机 ID/token generator | assignment EVENT |
| Safety | incident/replacement/result IDs、三元键、frozen facts/reason/time、before/after FSM | EVENT + M4 native trigger；禁止直接 `REDLINE_HALTED` DML | incident/lifecycle EVENT |
| Export | trusted target identity、report/source lineage、content/presentation/file hash、size、format、builder version、file asset ID、timestamp | EVENT + immutable report projection；路径/bytes 不进 trace | `REPORT_EXPORTED` EVENT 或 canceled result |

确定性 ID 使用 `UUIDv5(protocol namespace, command_id + child ordinal + semantic role)` 或等价固定 SHA-256→UUID 映射；时间由 root planner 一次读取并显式派生/复用。不得在 projector/recovery 中调用 `uuidv4()` 或 `new Date()` 生成事实。

`domain_event_projection` 的 v2 source合同固定为：`source_log_path` 只存 data-root相对路径 `event-log/segments/<segment-id>.jsonl`，禁止绝对路径；`source_log_line_no` 与 `source_log_byte_offset` 指向该 EVENT record 的 verified起点；`schema_version` 从已验证的 payload version映射。`processed_event` 与 `domain_event_projection` 必须对同一event严格核对 event ID/type/aggregate，且 `processed_event.batch_id -> applied_event_batch.segment_id` 必须与source path一致。normal APPLY、startup recovery与mixed rebuild共用唯一insert/assert函数，不能各自拼SQL。

### 4.4.1 Legacy → v2 差分行为 oracle

M5B-6～13 的36个领域command每row至少绑定一个不可由新实现自动生成的differential test ID。harness从同一显式`/tmp` pre-state克隆A/B两份数据库与data root：A运行实现起点冻结的legacy service oracle，B运行v2 planner+projector。两侧注入相同clock与可控ID源；无法直接相同的基础设施ID必须通过有审计的字段级normalizer比较，不得删除业务字段。比较范围至少包括public result、全部受影响业务表、领域event type/order/业务payload语义和预期文件变化。正常、确定性拒绝、成功no-op和每个多事件child路径均不能只靠v2自身golden证明。

legacy oracle代码/fixture在M5B-1以hash固定；若实现需要修改oracle源，必须先保存只读测试fixture并由scope gate证明其语义未随被测实现一起变化。最终production不保留oracle/legacy writer可达性。

### 4.5 锁、事务与持久化顺序

```text
read-only validation
  -> short BEGIN IMMEDIATE: INSERT/SELECT command + atomic generation lease
  -> COMMIT
  -> [export only] dialog + renew loop + target probe; no writer mutex
  -> acquire process writer mutex
  -> revalidate runtime OPEN + lease + actor + target
  -> pure plan
  -> allocate sequence / verify file identity / apply prospective rotation rule
  -> append PREPARED + all EVENT records / file sync          # PONR
  -> [export only] stage/publish from prepared EVENT
  -> BEGIN IMMEDIATE
       fenced APPLIED row
       processed_event uniqueness
       domain_event_projection
       versioned projectors + operational DB effects
       projector_cursor
     COMMIT
  -> append exactly one COMMITTED / file sync
  -> fenced batch CONFIRMED
  -> durable index barrier
  -> fenced canonical result_json
  -> release mutex
  -> idempotent in-memory binding / owned-stage cleanup
```

segment轮转临界规则唯一固定为：非空active segment在 `current_bytes + prepared_batch_bytes > 10,485,760` 或 `confirmed_batch_count >= 10,000` 时，于本批PREPARE前先seal并创建新segment；恰好等于byte阈值仍写当前segment，下一批轮转；空segment必须接纳满足8MiB EVENT上限的单batch。prepared bytes含PREPARED与全部EVENT record/LF，不含未来COMMITTED；COMMITTED计入segment最终byte size和file hash。阈值前1 byte、恰好阈值、超过1 byte及9999/10000批必须有golden。

禁止：等待 writer mutex 时持有 SQLite transaction；dialog 时持有 mutex/transaction；完整 PREPARE 后执行 planner；旧 generation 写 PREPARE/APPLY/CONFIRM/index/result；在 APPLY 中做外部文件 I/O；把 file rename 与 SQLite transaction 描述成原子。PREPARE、artifact stage/publish、COMMITTED、index和result每个写阶段前都重新核对当前lease generation；文件写完成后若generation已漂移，旧worker不得继续下一阶段，新owner按已持久事实接管。

### 4.6 Legacy 迁移与唯一生产切换

所有新 runtime、planner、projector、store 和 recovery 在 M5B-14 前只由显式 `/tmp` 测试 composition 使用，现有 production composition 继续完整走 M5A legacy 路径。不得按 domain 把生产同时接到 legacy 与 v2.2 两个事实日志。

M5B-14 是唯一生产切换步骤：

```text
open-before path/alias guard
  -> readonly schema + legacy preflight
  -> paired DB + exact legacy-log backup
  -> T11-T14 migration transaction + structural assertions
  -> provable incomplete legacy tail archive/truncate (if any)
  -> legacy reconcile without appending recovery audit
  -> write durable index legacy anchor; logical seal
  -> v2.2 startupRecovery
  -> register 75 handlers and OPEN / CORRUPTION_READ_ONLY
```

切换同时完成：`schema.sql` 目标结构、migration registry、connection/bootstrap、runtime、preload metadata、handler definitions、所有 46 command executor、health contract/UI、legacy port/request-time recovery 的 production unreachability。任一子项未完成则不宣称切换。

### 4.7 失败恢复与回滚边界

- M5B-1～13 都未接入 production：删除该步新增模块或恢复该步调用即可；默认运行时仍是已验收 M5A。
- migration preflight/backup/DDL 失败：runtime 不 OPEN；migration transaction 不含文件 I/O。未知 schema 在任何 DDL 前失败。
- legacy tail 只有“末尾且不可解析为完整 JSON”可在已备份、原样归档、durability barrier 后截断；其他 checksum/sequence/unsupported 冲突 fail closed。
- 完整 PREPARE 前：允许按 registry policy沿用原 command/reserved batch 重试，最多 3 attempts；领域 DML/永久文件必须为零。
- 完整 PREPARE 后：只前滚同一 batch；不得换 batch、重跑 planner、写 FAILED 或增加业务 attempt。
- 直接回退M5A binary只允许在runtime从未到达`OPEN`、未发布legacy seal/index anchor、无command claim、无v2 record且T11–T14空的情况下进行；仍须按人工批准方案核验成对backup，不自动down。
- legacy seal/anchor已发布但尚未OPEN时，失败恢复只能前滚，或恢复migration前成对DB+legacy-log backup后再使用M5A；不得只换binary或单独“取消seal”。
- runtime一旦到达`OPEN`、任一command被claim、任一gate-only DML完成或任一v2 PREPARE出现，即使尚无confirmed batch，也禁止直接回退M5A；只允许forward recovery或批准的整对backup disaster restore。
- 完整production v2 PREPARE后尤其不得删表、删segment、重置sequence或回写legacy。
- corruption：保持 read-only；不自动覆盖 index、truncate 完整 record、删除 stage/target 或“猜测修复”。

### 4.8 依赖图

```text
M5B-1 inventory/scope/path guard
  -> M5B-2 DB immediate transaction + inactive T11-T14 migration
  -> M5B-3 canonical records + segment/index + legacy primitives
  -> M5B-4 durable command identity/store/lease
      -> M5B-5 generic coordinator/projector/result/recovery
          -> M5B-6 report/closure non-artifact planners
          -> M5B-7 gate-only 10 + auth binding
          -> M5B-8 training planners
          -> M5B-9 assessment core planners
          -> M5B-10 scoring/observation + flattened automation
          -> M5B-11 assignment planners/effects
          -> M5B-12 safety/redline planners/projectors
          -> M5B-13 report export interaction/artifact

M5B-2..13
  -> M5B-14 startup/health/schema + atomic production cutover
      -> M5B-15 target gate, invariants, full R3 validation
          -> independent code review + final /vibe-accept
```

M5B-6～13 逻辑上都依赖 M5B-5，但按上述顺序实施，便于复用 report fragment 并让每步 inventory pending 单调下降；不得并行修改相同 registry/service/payload 文件。

### 4.9 跨文件副作用登记表

| 主变更 | 必须同步登记或核验 |
|---|---|
| 75-channel registry | shared IPC、preload whitelist、handler registry、READ/MUTATION exact set、46 execution classes、health push 不计数、renderer tests |
| transport metadata | preload 每 context client ID、每调用新 key、第二 trusted arg、renderer 签名不变、伪造业务字段拒绝、same-key test adapter |
| CommandEnvelope v2 | persisted command/batch ID、actor/device/auth/generation、root correlation、request hash、observability redaction、M5A envelope compatibility tests |
| secret-safe request hash | registry secret declaration、PBKDF2 KAT、stable domain salt、canonical JSON、DB/trace/log secret scan、login replay |
| DBAdapter immediate transaction | SqliteAdapter、MemoryAdapter、所有 test wrapper/mock、nested transaction rejection、lock/concurrency tests |
| T11–T14 | `schema.sql`、migration module/list/startup/backup、structure SQL assertion、FK/index/check、fresh/historical/unknown tests、baseline version |
| JSONL record/payload | runtime TS types、validators、canonical bytes/checksum/hash、legacy ActionLogEntry reader、unknown version handling、golden vectors |
| segment/index | path guard、exclusive create、file identity、fsync/fdatasync + directory barrier、rotation、sealed immutability、index rebuild/conflict、legacy anchor |
| durable command store | unique client/key、status/result schema、lease SQL、generation fence、attempt policy、clock, cancellation/no-op, recovery classification |
| planner | no DML/file/random clock/UUID、authoritative reread under mutex、deterministic IDs/times、1..N/0 event limits、per-command golden fixture |
| projector | `domain_event_projection`相对segment path/line/byte、`processed_event`逐字段与batch→segment对账、业务 reducer、prepared-only operational effect、cursor、BEGIN IMMEDIATE、no UPSERT、normal/recovery/mixed rebuild共用插入函数 |
| root child automation | accepted-child/report coordinator owners、child ordinal/ID、single batch、single result、no nested transaction/coordinator/batch |
| auth gate-only | sender binding、auth snapshot、login session-ID rebinding、logout exception、disabled/revoked negatives、heartbeat/sweep inventory |
| assignment | local runtime context、organization/node/device/runtime/auth/grant rows、deterministic credentials/IDs、three-party consistency、M3 regressions |
| safety | M4 trigger/index/three-key facts、new one-event path、legacy two-event replay、result/report fallback、teacher/admin negatives |
| report export | dialog timing/lease, trusted path, probe identity/barriers, in-memory bytes, EVENT lineage/hash, stage/no-clobber, rebuild, cleanup warning |
| startup | connection order、migration capability、legacy reconcile without audit、batch recovery、runtime state, handler registration, app window behavior |
| corruption health | in-memory snapshot、shared/preload/push、renderer banner/download、ADMIN augmentation、PII/absolute-path redaction、business READ stable errors |
| legacy retirement | 43 event-port + 8 request coordinator target zero、47 migration exceptions逐项重裁、29 test-only隔离、production import graph、只读legacy differential oracle不得进入production graph |
| default-data protection | explicit paired `/tmp` roots、open-before guard、symlink/hardlink/evidence reuse negatives、禁止 default resolver/import/open/hash |
| docs/workflow | PRD/impl/reviews/step accepts/final review/validation、baseline commands/version、project invariants、新 docs index |

## 5. 实现步骤

### Step M5B-1：冻结 M5B inventory、实现起点与隔离范围门禁

**目的与理由：** 在任何代码变化前把 M5A final facts、当前 dirty worktree 和 361/378/76 entries 逐项转成 M5B 可执行迁移账本，避免旧改动被覆盖、例外被整体继承或 writer 因移动文件而消失在扫描器之外。

**前置状态：** 本计划的独立 review 为 `PASS`；M5A target scanner 在实现起点仍输出固定 digest。

**完成状态：**

- worktree 起点 fixture 保存 tracked/untracked kind、repo-relative path、SHA-256；敏感/default-data 路径不纳入内容扫描。
- 75 channel target、36/10 command row、43 legacy writer、8 request recovery、361 active entries、378 mapping 与 76 exceptions 都有稳定 ID 和唯一 disposition。
- 76 exceptions 被逐项分类为 `PRE_GATE_MIGRATION_INTERNAL`、`RECOVERY_INTERNAL`、目标 command class 或 `TEST_ONLY`；没有继承式 allowlist。
- 46个command row均绑定legacy→v2 differential test ID；36个领域row的event语义允许差异默认为空，仅redline与export可按PRD登记明确差异，不能用通配normalizer。
- `baseline` 从固定 M5A evidence 验证；`migration --step` 验证当前 checkout 与 expected pending；`target` 要求 legacy/request recovery/pending 为 0。
- path guard 在 open 前拒绝缺失、非绝对、非 `/tmp`、不配对、symlink/hardlink alias 与 evidence-root 复用；adapter open spy 为 0。

**不得改变：** production runtime、Schema、IPC、DB、legacy log、renderer；不得读取默认库或用默认库 hash 作保护证据。

**改动文件及职责：**

- `scripts/fixtures/m5b-implementation-start-v1.json`：实现起点路径/hash与 M5A evidence 引用；冻结legacy differential oracle源码/fixture hash。
- `scripts/fixtures/m5b-command-runtime-inventory-v1.json`：75/36/10、legacy→target owner、exceptions disposition、每步 expected pending。
- `scripts/lib/m5b-runtime-inventory.mjs`：channel/sink/capability/import graph 扫描。
- `scripts/check-m5b-event-batch.mjs`：`baseline|migration|target` 门禁。
- `scripts/lib/m5b-isolated-paths.mjs`：显式 paired `/tmp` path/identity guard。
- `scripts/verify-m5b-contract-scope.mjs`：起点 hash、M5B allow-path、committed/index/worktree/untracked 四层差异与 default resolver 禁止面。
- `scripts/__tests__/{m5b-runtime-inventory,m5b-isolated-paths,m5b-contract-scope}.test.mjs`：exact/negative tests。
- `package.json`：登记 `contract:m5b:event-batch:check`、`contract:m5b:scope:check`。

**跨文件登记项：** [ ] M5A digest；[ ] 75/29/46；[ ] 36/10；[ ] 43/8；[ ] 361/378/76；[ ] dirty baseline；[ ] legacy oracle hash；[ ] default-data open spy；[ ] unknown/alias sink 负测。

**核心设计与伪代码：**

```text
start = hashCurrentTrackedAndUntrackedFiles()
legacy = loadM5AFinalInventoryAndEvidenceDigest()
target = classifyEveryChannelCallsiteCapabilityAndException()
assertExactSetsAndUniqueDisposition(legacy, target)
assertPathsBeforeOpen({ db, dataRoot, userData, exportRoot, evidenceRoot })
```

**数据、事务与失败恢复：** 全部只读源码/显式 `/tmp` fake paths；不打开 SQLite 或事实日志。失败只报告 repo-relative path/stable ID。

**测试设计：** 单元覆盖漏/重复/alias import/未知 sink/例外漂移、path symlink/hardlink/missing/non-temp；集成复算 M5A input；回归证明 production 文件无行为 diff；手工 NONE。

**精确验证命令：**

```bash
npm test -- scripts/__tests__/m5b-runtime-inventory.test.mjs scripts/__tests__/m5b-isolated-paths.test.mjs scripts/__tests__/m5b-contract-scope.test.mjs
npm run contract:m5a:command-boundary:check
npm run contract:m5b:event-batch:check -- --mode baseline
npm run contract:m5b:event-batch:check -- --mode migration --step M5B-1
npm run contract:m5b:scope:check -- --step M5B-1
npm run typecheck
npm run lint
git diff --check
```

**预期证据：** M5A digest 精确匹配；M5B target 分类 exact；target 模式因 pending 非零按预期失败且不记作 PASS；所有非法 path 在 open 前被拒绝。

**回滚方式：** 删除新增 fixture/scanner/scripts/package entries；production 无变化。

**停止条件：** M5A 固定事实无法复算、任一 mutation/capability/exception 无唯一归属，或 scope gate 不能区分起点已有与 M5B 增量。

**建议 commit message：** `test(m5b): freeze event batch migration inventory`

### Step M5B-2：实现 BEGIN IMMEDIATE 端口与未接线 T11–T14 Schema 迁移核

**目的与理由：** 先固定数据库原子边界、目标 DDL、迁移 preflight/backup/结构断言，在不改变 production startup 的情况下证明 fresh 与 v0.1.17 历史临时库可安全前滚。

**前置状态：** M5B-1 accept `PASS`。

**完成状态：**

- `DBAdapter.immediateTransaction()` 在 native/Memory adapter 和全部 wrapper 一致实现，禁止无意嵌套。
- migration ID 固定为 `2026-07-29_mvp_schema_v0_1_18_event_batch_v2_2`，version 为 `0.1.18-event-batch-v2.2`。
- T11–T14 DDL、CHECK、unique/index 与架构 §7.2 精确；不含 T15–T19/T18。
- structural assertion 比较 table/index SQL 和列/FK，不以 ledger row 代替。
- historical preflight 只接受精确 M4；paired backup 在 DDL 前；unknown/mixed/partial target 在 DDL 前失败。
- 本步 migration kernel 只在显式测试 composition 调用，不登记到 production migration list，不修改 production `schema.sql` 版本；正式接线留到 M5B-14。

**不得改变：** production startup/Schema、默认库、legacy file、业务 handler；migration transaction 不做文件 I/O。

**改动文件及职责：**

- `src/main/db/interface.ts`、`sqlite-adapter.ts`、`memory-adapter.ts`：显式 IMMEDIATE transaction。
- 相关 test adapters：转发新方法，禁止静默回退普通 transaction。
- `src/main/db/event-batch-migration.ts`：T11–T14 DDL、ID/version、preflight/structural inspection/up。
- `src/main/db/__tests__/event-batch-migration.test.ts`：fresh/M4/partial/unknown/FK/check/index/rollback。
- `scripts/verify-m5b-isolated-db.mjs`、`scripts/__tests__/m5b-isolated-db.test.mjs`：`mkdtemp` paired paths、backup/restore/integrity/query-plan verifier。
- `package.json`：登记 `db:m5b:isolated:verify`；native 命令在 M5B-15 前接通。

**跨文件登记项：** [ ] 所有 DBAdapter 实现；[ ] exact T11–T14 SQL；[ ] migration ledger；[ ] backup before DDL；[ ] `BEGIN IMMEDIATE` lock test；[ ] no production registration；[ ] no default resolver。

**核心设计与伪代码：**

```text
inspectReadonly(db)
assert state == FRESH || exactM4
if exactM4: createPairedBackupBeforeDDL()
db.immediateTransaction(() => {
  executeT11ToT14()
  insertMigrationLedgerOnce()
})()
assertExactTargetStructure(db)
```

**数据、事务与失败恢复：** DDL/ledger 同一 transaction；backup 是 transaction 前独立 durable 文件步骤。故障回滚不留 partial T11–T14；备份保留。

**测试设计：** 单元 adapter/nesting/rollback；集成 fresh、历史、重复 migration、partial objects、unknown ledger、FK/check/index、backup restore；native 后续；手工 NONE。

**精确验证命令：**

```bash
npm test -- src/main/db/__tests__/event-batch-migration.test.ts src/main/db/__tests__/migrations.test.ts src/main/db/__tests__/migration-backup.test.ts scripts/__tests__/m5b-isolated-db.test.mjs
npm run db:m5b:isolated:verify -- --stage schema
npm run contract:m5b:event-batch:check -- --mode migration --step M5B-2
npm run contract:m5b:scope:check -- --step M5B-2
npm run typecheck
npm run lint
git diff --check
```

**预期证据：** fresh/M4 结构一致；unknown/partial 在 DDL 前失败；失败注入后无 partial table/ledger；path 均为唯一 `/tmp`。

**回滚方式：** 删除未接线 migration module/verify helper并恢复 adapter interface；production DB 未迁移。

**停止条件：** 架构 T11–T14 与 SQLite/native 能力冲突，或需要 T18/额外表/文件 I/O transaction 才能实现。

**建议 commit message：** `feat(m5b): add event batch schema kernel`

### Step M5B-3：实现 canonical record、segment/index 与 legacy 无损原语

**目的与理由：** 在 command/coordinator 之前把永久 bytes、文件身份和 durability 合同做成可 KAT 的低层端口，避免上层把“写成功”误当作“持久成功”。

**前置状态：** M5B-2 accept `PASS`。

**完成状态：**

- 永久 record 仅 `BATCH_PREPARED`、`EVENT`、`BATCH_COMMITTED`；严格 validator 拒绝未知字段/非 JSON 值/错误 hash/sequence。
- canonical recursive key sort、UTF-8/LF、EVENT checksum、`events_hash` 和 `batch_hash` 有固定向量；最后 EVENT 含 LF。
- segment 固定命名/identity、prospective byte规则与10,000 confirmed batches规则、batch 不跨段、1,000 events/8 MiB pre-PONR限制；阈值临界与COMMITTED计入最终size的语义与§4.5完全一致。
- `segment_index.json` schema/version、legacy anchor、active/sealed segment、atomic update/barrier 与 rebuild/conflict 规则冻结。
- file capability KAT 覆盖 exclusive create、same-file identity、sync、directory barrier、hard-link no-clobber；不支持则 runtime capability CLOSED，不降级。
- legacy parser byte-exact识别 v1/F7-v2、LF/完整 EOF、可证明 incomplete tail；合法 bytes 不写，异常尾部先原样归档再定点 truncate。

**不得改变：** production log/path、`ActionLogEntry` bytes、startup；不删除 sealed segment/legacy/probe；不使用通配 cleanup。

**改动文件及职责：**

- `src/main/domain/event-batch/{record-types,canonical-json,batch-hash}.ts`：record 与唯一 bytes/hash。
- `src/main/domain/event-batch/{file-capability,segment-store,segment-index}.ts`：文件 adapter、identity、barrier、rotation/index。
- `src/main/domain/event-batch/{legacy-reader,legacy-anchor}.ts`：兼容 parse、tail classification、anchor。
- `src/main/domain/event-batch/__tests__/*`：golden/tamper/rotation/index/legacy/KAT tests。
- `scripts/fixtures/m5b-event-batch-golden-v1.json`：跨 key-order/segment/legacy 固定向量。

**跨文件登记项：** [ ] type/schema/validator；[ ] checksum/hash vectors；[ ] segment/index schema；[ ] path guard；[ ] file handle identity before/after；[ ] archive barrier；[ ] legacy reducer compatibility。

**核心设计与伪代码：**

```text
eventBytes = concat(events.map(canonical(EVENT) + LF))
eventsHash = sha256(eventBytes)
batchHash = sha256(utf8(previousHash) || utf8(eventsHash))
preparedBytes = canonical(PREPARED) + LF + eventBytes
appendExact(activeHandle, preparedBytes)
syncFile(activeHandle)
reStatAndAssertSameIdentity(activeHandle, expected)
```

**数据、事务与失败恢复：** 所有 tests 用独立 `/tmp` data root；partial active tail 归档原始 bytes并只截断到最后 verified boundary；index 落后可重建，冲突 fail closed。

**测试设计：** canonical KAT；每字节/字段 tamper；partial write/sync/rename/identity fault；rotation阈值前1 byte/恰好/超过1 byte及9999/10000批、跨段chain；index missing/lag/conflict；legacy LF/EOF/F7/tail/non-tail conflict；手工 NONE。

**精确验证命令：**

```bash
npm test -- src/main/domain/event-batch/__tests__/canonical-json.test.ts src/main/domain/event-batch/__tests__/batch-hash.test.ts src/main/domain/event-batch/__tests__/segment-store.test.ts src/main/domain/event-batch/__tests__/segment-index.test.ts src/main/domain/event-batch/__tests__/legacy-reader.test.ts src/main/domain/event-batch/__tests__/file-capability.test.ts
npm run db:m5b:isolated:verify -- --stage storage
npm run contract:m5b:event-batch:check -- --mode migration --step M5B-3
npm run contract:m5b:scope:check -- --step M5B-3
npm run typecheck
npm run lint
git diff --check
```

**预期证据：** golden bytes/hash exact；所有 tamper 被拒绝；合法 legacy length/hash不变；unsupported capability 在 append 前关闭。

**回滚方式：** 删除未接线 event-batch storage modules/fixtures。

**停止条件：** 目标平台无法提供必需 barrier/identity/no-clobber，或必须改变 frozen hash/record/legacy bytes。

**建议 commit message：** `feat(m5b): implement canonical event segments`

### Step M5B-4：实现 durable command identity、claim、lease 与 envelope v2

**目的与理由：** 将 M5A 临时 accepted envelope 升级为由 command row 签发的 durable identity，并在领域 planner 接入前独立证明幂等、秘密处理和 generation fencing。

**前置状态：** M5B-2、M5B-3 accept `PASS`。

**完成状态：**

- `TransportMetadataV1` 只接受 Main/preload trusted second arg；业务 payload 中同名字段拒绝。
- request pipeline 顺序固定为 structural→actor→secret-safe hash→existing lookup→new target→claim/lease；成功 replay 不重新 resolve target。
- PBKDF2-SHA512 100,000/64-byte、稳定 domain salt、canonical SHA-256 有 KAT；DB/trace/result 不含明文或低成本 password hash。
- command insert 预留 command/batch ID；unique key、same/different request/actor/device/session 行为固定。
- lease 30s/renew10s、atomic takeover、generation单调、max attempts=3；旧 owner 在 renew/result及后续 coordinator gate 均被 fence。
- `CommandEnvelopeV2` 的 command ID/batch ID/actor/device/auth/generation来自 durable row；root correlation=command ID。
- canonical result envelope 为 `{schema_version, public_result}`；所有确定性public result（包括`success:false`）均以`status=SUCCEEDED`完成并不可变，`FAILED`只用于registry允许重试的pre-PONR系统失败，PONR后永不写FAILED。
- 本步只提供显式 test transport/composition，不修改 production preload/handler。

**不得改变：** production IPC/API、业务 service、legacy writer、Schema registration；不得持久化 raw token/password/完整 payload。

**改动文件及职责：**

- `src/shared/types/command-transport.ts`：internal bridge metadata shape（不暴露 writer字段）。
- `src/main/application/command/{command-request-hash,durable-command-store,durable-command-coordinator,command-result}.ts`。
- `command-types.ts`、`command-envelope.ts`、`command-bus.ts`、`m5a-command-definitions.ts`：新增兼容 v2 interface/registry fields，production 仍用 legacy adapter。
- `src/main/application/command/__tests__/{request-hash,durable-command-store,durable-command-coordinator,envelope-v2}.test.ts`。

**跨文件登记项：** [ ] shared type不进 renderer business API；[ ] 46 registry secret/result/retry fields；[ ] SQL fence predicates；[ ] clock/UUID injection；[ ] trace redaction；[ ] unique conflict；[ ] no lock inversion。

**核心设计与伪代码：**

```text
validateStructure(raw)
actor = resolveActorNoWrite(sender)
fingerprint = secretSafeHash(commandType, normalizedBusinessInput)
existing = find(clientId, key)
if existing: compareStableFieldsThenReplayOrConflict(existing)
target = resolveTargetReadOnly(raw, actor)
row = insertCommandWithReservedIds(...)
lease = atomicAcquire(row.commandId, seenGeneration)
return envelopeV2(row, lease)
```

**数据、事务与失败恢复：** claim/lease使用短 IMMEDIATE transactions；等待外部锁前结束。pre-PONR system failure按attempt policy；completed结果不可变。

**测试设计：** same-key matrix、new-key同 payload、并发 takeover、fake clock renew、旧 generation 每个 store method、secret scan/login vector、result version/invalid JSON；确定性`success:false`在外部状态变化后同key仍返回旧result且attempt不变、新key重新求值；集成 native DB later；手工 NONE。

**精确验证命令：**

```bash
npm test -- src/main/application/command/__tests__/request-hash.test.ts src/main/application/command/__tests__/durable-command-store.test.ts src/main/application/command/__tests__/durable-command-coordinator.test.ts src/main/application/command/__tests__/envelope-v2.test.ts
npm run db:m5b:isolated:verify -- --stage command
npm run contract:m5b:event-batch:check -- --mode migration --step M5B-4
npm run contract:m5b:scope:check -- --step M5B-4
npm run typecheck
npm run lint
git diff --check
```

**预期证据：** conflict/replay/generation/attempt exact；PBKDF2 KAT与 secret absence；所有失败路径未调用 planner/file sink。

**回滚方式：** 删除未接线 durable modules并恢复兼容类型字段。

**停止条件：** 需要信任 renderer key/actor、在 lookup 前写副作用、持久化 raw secret，或不能用单 SQL 原子 lease。

**建议 commit message：** `feat(m5b): add durable command fencing`

### Step M5B-5：实现通用 batch coordinator、projector/result registry 与四阶段恢复

**目的与理由：** 用合成领域事件先证明不可逆点、单 batch APPLY、恢复与结果重建，再迁移真实业务，避免业务复杂度掩盖协议错误。

**前置状态：** M5B-3、M5B-4 accept `PASS`。

**完成状态：**

- process-wide fair writer mutex 覆盖普通 batch/gate execution与event-log recovery；migration/legacy reconcile发生在 runtime 建立前。
- planner port通过静态类型和 capability隔离 DML/file/random source；输出 frozen `CommandPlanV1`、1..N EventIntent、result recipe和operational effects。
- coordinator按唯一顺序执行 PREPARE/APPLY/CONFIRM/index/result，所有阶段比较 owner+generation。
- APPLY 是一个 IMMEDIATE transaction，插入 batch/processed/domain projection、执行 projectors/effects、推进 cursor；任何 event N 故障整体回滚。
- normal/recovery/rebuild共用一个projection source writer，保存相对segment path、EVENT line/byte offset，并严格对账processed event与batch segment。
- operational effect与result registry只从prepared EVENT和command row稳定字段重建；plan-only参数被类型/运行时断言拒绝。result registry保留所有已写入recipe version；未知或同batch冲突的recipe/event payload version fail closed。
- 四阶段 startup recovery幂等；完整 PREPARE后 planner调用数为0；已有匹配 COMMITTED只补SQLite/index，不追加第二条。
- mixed replay按legacy anchor先byte-exact运行legacy reducer，再按verified global batch sequence运行v2 projector；必须显式注入不可重建的user/student/strategy/question/auth等基础设施fixture，不声称从JSONL恢复完整command history。
- crash/tamper matrix覆盖 partial record/fsync/APPLY/COMMIT/index/result及旧 generation写入。
- synthetic no-op成功持久 result但无 batch/DML/file。

**不得改变：** production composition与真实 service；不加入 sidecar intent或新 EventType；不把 current-process mutex声明为跨进程锁。

**改动文件及职责：**

- `src/main/domain/event-batch/{writer-mutex,command-plan,batch-coordinator,projection-source,result-registry,startup-recovery,mixed-domain-replay,runtime-corruption}.ts`。
- `src/main/domain/event-batch/fault-injection.ts`：仅测试可构造的稳定 point IDs。
- `src/main/domain/event-batch/__tests__/{batch-coordinator,startup-recovery,mixed-domain-replay,projection-source,fencing,fault-matrix,tamper-recovery}.test.ts`。
- `src/main/domain/event-batch/__tests__/command-differential-harness.ts`：A/B临时根克隆、clock/ID注入、字段级normalizer与业务投影/result/event语义比较；oracle hash来自M5B-1。
- `scripts/fixtures/m5b-crash-matrix-v1.json`：每窗口输入/预期/允许动作/planner-count。

**跨文件登记项：** [ ] lock owner/order；[ ] DB IMMEDIATE；[ ] record/index store；[ ] command fence；[ ] prepared-only effect/result version；[ ] projection source/processed/batch segment对账；[ ] mixed replay+infrastructure fixture；[ ] differential harness；[ ] corruption transition；[ ] no-op reservation。

**核心设计与伪代码：**

```text
withWriterMutex(async () => {
  assertOpenAndLease()
  plan = freeze(await planner.plan(readSnapshot, envelope))
  if plan.events.length == 0: fencedComplete(plan.result)
  else {
    prepared = segmentStore.prepare(plan, envelope) // returns only after fsync
    discardInMemoryPlanAfterPrepareForRecoveryTests()
    applyImmediate(prepared.events, registries.deriveEffectsFromPrepared(), cursors)
    segmentStore.confirmExactlyOnce(prepared)
    commandStore.confirmBatchAndPersistIndexAndResultFenced(...)
  }
})
```

**数据、事务与失败恢复：** PONR 为完整 PREPARE+EVENT bytes在同一已验证 identity 上 fsync完成。PONR前按policy；PONR后只读prepared facts继续。corruption transition单向关闭mutation。

**测试设计：** normal 1/N/0；1,000/8MiB边界；每 fault point重启；duplicate/conflicting COMMITTED；index lag；old worker at every phase；projector N rollback；PREPARE后销毁plan/new composition恢复；recipe/effect版本tamper；projection相对path/offset round-trip及两表对账；legacy+v2 mixed rebuild与缺基础设施fixture拒绝；planner count；result recovery；手工 NONE。

**精确验证命令：**

```bash
npm test -- src/main/domain/event-batch/__tests__/batch-coordinator.test.ts src/main/domain/event-batch/__tests__/startup-recovery.test.ts src/main/domain/event-batch/__tests__/mixed-domain-replay.test.ts src/main/domain/event-batch/__tests__/projection-source.test.ts src/main/domain/event-batch/__tests__/fencing.test.ts src/main/domain/event-batch/__tests__/fault-matrix.test.ts src/main/domain/event-batch/__tests__/tamper-recovery.test.ts
npm run db:m5b:isolated:verify -- --stage coordinator
npm run contract:m5b:event-batch:check -- --mode migration --step M5B-5
npm run contract:m5b:scope:check -- --step M5B-5
npm run typecheck
npm run lint
git diff --check
```

**预期证据：** 所有crash window最终唯一batch/result；PONR后planner count 0且plan对象不存在；partial projection 0；duplicate COMMITTED被杀死；旧generation零写入；source offset/processed/batch一致；mixed replay只有在显式infra fixture存在时通过。

**回滚方式：** 删除未接线 coordinator/recovery/fixtures。

**停止条件：** 任一恢复需要重跑 planner、替换 batch、猜测 hash/index或执行通用 UPSERT。

**建议 commit message：** `feat(m5b): implement batch coordinator recovery`

### Step M5B-6：迁移五个非 artifact report/closure planner 与 projector

**目的与理由：** 先建立可复用 report plan fragment，使后续 job-skill automation能在 root batch内生成报告，而不再启动嵌套 coordinator。

**前置状态：** M5B-5 accept `PASS`。

**完成状态：** 五个 report command均有纯 planner、versioned event payload/projector/result recipe；closure/result/source snapshot与builder lineage冻结；同 generation no-op不创建 batch；child report fragment可由允许的root command嵌入且不能独立 claim/batch。

**不得改变：** `reports:export`、production composition、报告内容/HTML语义、source precedence、public response。

**改动文件及职责：** `src/main/application/planners/{report-planner,task-closure-planner,report-plan-fragment}.ts`；`src/main/domain/projectors/{report-projector,task-closure-projector}.ts`；shared payload version unions；现有 report builders/reducers作纯函数复用；对应 tests/golden fixtures。

**跨文件登记项：** [ ] 5 registry rows；[ ] payload validators；[ ] builder/source hash；[ ] report/closure lifecycle；[ ] child ordinal/ID；[ ] result recipe；[ ] legacy fixture replay。

**核心设计与伪代码：** `planRootOrChild(snapshot, deterministicContext) -> EventIntent[]`；child只返回fragment，root coordinator统一排序/prepare/apply/result。

**数据、事务与失败恢复：** planner无写；所有 report/closure DML仅projector APPLY；PONR后由prepared source snapshot重放。

**测试设计：** 五命令各绑定legacy→v2 A/B differential ID，比较public result、closure/report业务表、event语义与文件零变化；另测正常/拒绝/no-op、source drift after PREPARE、child nested-batch spy为0、event N rollback、report content/hash回归。

**精确验证命令：**

```bash
npm test -- src/main/application/planners/__tests__/report-planner.test.ts src/main/domain/projectors/__tests__/report-projector.test.ts src/main/domain/__tests__/report-generation.test.ts src/main/domain/__tests__/task-closure-service.test.ts
npm run contract:m5b:event-batch:check -- --mode migration --step M5B-6
npm run contract:m5b:scope:check -- --step M5B-6
npm run typecheck
npm run lint
git diff --check
```

**预期证据：** 五row golden plans/results；恢复不调用builder planner；无第二 command/batch/coordinator。

**回滚方式：** 删除未接线 planners/projectors并恢复 payload union。

**停止条件：** report result需依赖PREPARE后可变来源，或child只能通过nested command实现。

**建议 commit message：** `feat(m5b): plan report domain batches`

### Step M5B-7：实现十个 gate-only command 与可恢复 auth binding

**目的与理由：** 将无领域事件的 auth/student/strategy 写入 durable gate，确保业务DML和最终结果同一transaction，又不伪造事件。

**前置状态：** M5B-5 accept `PASS`。

**完成状态：** 10个命令使用同一gate-only executor；DML+fenced canonical result同一IMMEDIATE transaction；command reservation保持unused；重复不重复DML。sender binding改为持久 `auth_session_id`，login replay重绑，logout自撤销例外精确实现，账号禁用/会话撤销负测通过。

**不得改变：** role、密码校验、student/strategy业务合同、public result；不创建domain event/segment/零batch。

**改动文件及职责：** `src/main/application/command/gate-only-executor.ts`；auth/student/strategy services的gate plan/apply；`src/main/utils/auth-session.ts` binding；registry row；auth/student/strategy tests。

**跨文件登记项：** [ ] 10 rows；[ ] result same transaction；[ ] reservation unused；[ ] login PBKDF2 request hash≠account password hash；[ ] logout exception；[ ] sender destroy/revoke/disable；[ ] heartbeat/sweep capability。

**核心设计与伪代码：**

```text
db.immediateTransaction(() => {
  assertLeaseGeneration()
  publicResult = definition.applyGateOnlyDml(db, envelope)
  persistCanonicalResultFenced(db, publicResult)
})()
applyIdempotentPostCommitBinding(publicResult.auth_session_id)
```

**数据、事务与失败恢复：** transaction故障回滚DML+result；commit后binding丢失可由completed replay重建。logout只对同client/key/row actor+session返回非敏感旧成功。

**测试设计：** 10 command均以A/B临时库比较legacy与gate-only business DML/public result语义（durable command基础设施字段作为登记后的允许差异）；另测native/Memory matrix、same key/new key、transaction cutpoints、login/logout replay、disabled/revoked、binding restart、no segment/file spy，以及确定性`success:false`以SUCCEEDED持久且同key不重求值。

**精确验证命令：**

```bash
npm test -- src/main/application/command/__tests__/gate-only-executor.test.ts src/main/application/services/__tests__/account-command-bus.test.ts src/main/ipc/handlers/__tests__/auth.test.ts src/main/ipc/handlers/__tests__/student-create.test.ts src/main/ipc/handlers/__tests__/student-mutate.test.ts src/main/ipc/handlers/__tests__/strategy-create-version.test.ts src/main/ipc/handlers/__tests__/strategy-update.test.ts src/main/ipc/handlers/__tests__/strategy-set-active.test.ts
npm run db:m5b:isolated:verify -- --stage gate-only
npm run contract:m5b:event-batch:check -- --mode migration --step M5B-7
npm run contract:m5b:scope:check -- --step M5B-7
npm run typecheck
npm run lint
git diff --check
```

**预期证据：** DML/result同进退；重复DML计数0；no batch；login安全重绑和logout精确例外通过。

**回滚方式：** 删除未接线gate executor并恢复旧binding实现；production尚未切换。

**停止条件：** replay需要保存raw token/password，或DML/result不能同transaction。

**建议 commit message：** `feat(m5b): gate non-event mutations durably`

### Step M5B-8：迁移六个 training planner/projector

**目的与理由：** 把训练创建及步骤FSM转换为self-sufficient batch plan，先验证自动完成fragment不会形成第二transaction/batch。

**前置状态：** M5B-5 accept `PASS`。

**完成状态：** 六个training command golden plan完整；`completeStep`需要时在同一plan追加 `TRAINING_COMPLETED`；所有ID/time/before-after/三元键/strategy-step版本冻结；projector只消费event；结果与legacy行为一致。

**不得改变：** training FSM、completion计算、safety block、public API；不接production。

**改动文件及职责：** `src/main/application/planners/training-planner.ts`；`src/main/domain/projectors/training-projector.ts`；training service/reducer抽取纯计算；payload version unions；planner/projector/service tests。

**跨文件登记项：** [ ] 6 rows；[ ] step/session target；[ ] auto completion order；[ ] result recipe；[ ] strategy snapshot；[ ] safety three-key；[ ] legacy replay。

**核心设计与伪代码：** `completeStep -> [TRAINING_STEP_COMPLETED, maybe TRAINING_COMPLETED]`，统一deterministic context和root correlation。

**数据、事务与失败恢复：** N events同一APPLY；event N fault回滚所有step/session投影；recovery不重新统计可变表决定是否完成。

**测试设计：** 6 commands各绑定legacy→v2 A/B differential ID；另测正常/invalid status/owner/safety、last/non-last step、fail at each event、prepared后数据漂移、legacy regressions。

**精确验证命令：**

```bash
npm test -- src/main/application/planners/__tests__/training-planner.test.ts src/main/domain/projectors/__tests__/training-projector.test.ts src/main/application/services/__tests__/training-command-bus.test.ts src/main/ipc/handlers/__tests__/training-create.test.ts src/main/ipc/handlers/__tests__/training-steps.test.ts src/main/ipc/handlers/__tests__/training-complete.test.ts src/main/ipc/handlers/__tests__/training-redline.test.ts
npm run contract:m5b:event-batch:check -- --mode migration --step M5B-8
npm run contract:m5b:scope:check -- --step M5B-8
npm run typecheck
npm run lint
git diff --check
```

**预期证据：** 6row/event order exact；last-step root只有一个batch；故障零部分投影；prepared replay planner count 0。

**回滚方式：** 删除未接线training planner/projector与payload扩展。

**停止条件：** completion必须在APPLY时重新决策，或现有FSM与prepared before/after无法同时成立。

**建议 commit message：** `feat(m5b): plan training event batches`

### Step M5B-9：迁移十个非 redline assessment core planner/projector

**目的与理由：** 承接测评主FSM的单/多事件路径，并把collapse/start/calculate的隐式追加转换为有序prepared facts。

**前置状态：** M5B-5 accept `PASS`。

**完成状态：** 十个command逐row planner/projector/result version齐全；create/question snapshot、answer sequence、emotion/sitting状态、collapse threshold、abort/result/completion全冻结；多事件顺序golden化；unknown payload/version fail closed。

**不得改变：** `assessment:triggerRedline`（留M5B-12）、评分公式、题目选择、情绪/坐席FSM、public API；不接production。

**改动文件及职责：** `src/main/application/planners/assessment-planner.ts`；`src/main/domain/projectors/assessment-projector.ts`；assessment service/reducer纯计算抽取；event payload/json validators；相关 tests/fixtures。

**跨文件登记项：** [ ] 10 rows；[ ] session/strategy/question snapshots；[ ] event sequence；[ ] sitting/collapse ordered fragments；[ ] result recipe；[ ] legacy payload dispatch；[ ] M4 safety read gate。

**核心设计与伪代码：** planner一次读取并决定完整events；projector不因当前DB状态再新增事件，只验证before状态并应用after状态。

**数据、事务与失败恢复：** 全部event同一APPLY；冲突/sequence mismatch进入corruption而非UPSERT；pre-PONR拒绝零写。

**测试设计：** 十命令各绑定legacy→v2 A/B differential ID并比较public result、全部assessment业务表与event语义；另测normal/invalid/owner/strategy/safety、1..N event goldens、每event故障、prepared后策略/题目变化、legacy replay、existing handler regressions。

**精确验证命令：**

```bash
npm test -- src/main/application/planners/__tests__/assessment-planner.test.ts src/main/domain/projectors/__tests__/assessment-projector.test.ts src/main/application/services/__tests__/assessment-command-bus.test.ts src/main/ipc/handlers/__tests__/assessment-create.test.ts src/main/ipc/handlers/__tests__/assessment-answer.test.ts src/main/ipc/handlers/__tests__/assessment-emotion.test.ts src/main/ipc/handlers/__tests__/assessment-start-session.test.ts
npm run contract:m5b:event-batch:check -- --mode migration --step M5B-9
npm run contract:m5b:scope:check -- --step M5B-9
npm run typecheck
npm run lint
git diff --check
```

**预期证据：** 10row golden；event N fault无partial；recovery使用prepared snapshots；旧行为/错误码一致。

**回滚方式：** 删除未接线assessment planner/projector与payload扩展。

**停止条件：** planner无法在PONR前决定完整event序列/结果，或需要更改题目/评分产品合同。

**建议 commit message：** `feat(m5b): plan assessment core batches`

### Step M5B-10：迁移四个 scoring/observation root 并压平 job-skill automation

**目的与理由：** 关闭当前最明显的“批量score + result + completion + report分transaction”窗口，确保一个用户提交只有一个root batch。

**前置状态：** M5B-6、M5B-9 accept `PASS`。

**完成状态：** ability、operation、job-skill、observation四个root完整plan；operation的RESULT、job-skill的RESULT+SESSION_COMPLETED+REPORT_GENERATED及observation触发的同类automation均以deterministic child ordinal合并；结果类型/lineage/评分不变。

**不得改变：** T18 draft、评分阈值、题量、rubric、report内容/public API；不吞child失败，不接production。

**改动文件及职责：** `src/main/application/planners/{ability-scoring,operation-scoring,job-skill-scoring,observation}-planner.ts`；相应projector；job-skill result/report automation改为pure fragments；payload types/validators/tests。

**跨文件登记项：** [ ] 4 rows；[ ] N score order；[ ] result/session/report child order；[ ] deterministic IDs/time；[ ] report fragment owner；[ ] result type isolation；[ ] no nested transaction/coordinator。

**核心设计与伪代码：**

```text
rootEvents = scorePlanner(snapshot)
if finalize:
  rootEvents += resultFragment + sessionCompletedFragment
  rootEvents += reportPlanFragment(resultSnapshot)
return one CommandPlan(rootEvents, rootResultRecipe)
```

**数据、事务与失败恢复：** 任一child projector失败整批rollback；PONR后不重新评分/build report；prepared events存rubric/version/breakdown/lineage。

**测试设计：** 四root各绑定legacy→v2 A/B differential ID，覆盖finalize与no-finalize并比较score/result/session/report全部投影；另测exact item counts/order、duplicate/invalid scores、report fail、event N fault、source drift、四类result不混算、legacy fixtures。

**精确验证命令：**

```bash
npm test -- src/main/application/planners/__tests__/scoring-planners.test.ts src/main/domain/projectors/__tests__/scoring-projectors.test.ts src/main/application/services/__tests__/scoring-command-bus.test.ts src/main/application/services/__tests__/multi-event-command-failure.test.ts src/main/ipc/handlers/__tests__/assessment-ability-scoring.test.ts src/main/ipc/handlers/__tests__/operation-scoring.test.ts src/main/ipc/handlers/__tests__/job-skill-scoring.test.ts src/main/ipc/handlers/__tests__/observation.test.ts src/main/ipc/handlers/__tests__/job-skill-result.test.ts src/main/ipc/handlers/__tests__/job-skill-report.test.ts
npm run contract:m5b:event-batch:check -- --mode migration --step M5B-10
npm run contract:m5b:scope:check -- --step M5B-10
npm run typecheck
npm run lint
git diff --check
```

**预期证据：** 每root恰好一个plan/batch；nested coordinator count 0；child fault零partial score/result/session/report。

**回滚方式：** 删除未接线scoring planners/projectors并恢复automation兼容入口。

**停止条件：** report automation只能在root commit后运行，或评分结果不能由prepared facts恢复。

**建议 commit message：** `feat(m5b): batch scoring automation atomically`

### Step M5B-11：迁移五个 assignment planner 与本地 runtime operational effects

**目的与理由：** 把当前 accepted child 中随机创建organization/node/device/runtime/auth/grant的副作用变为prepared、自足、可恢复的单batch apply effect。

**前置状态：** M5B-5、M5B-9 accept `PASS`。

**完成状态：** 五个assignment command完整plan；所有runtime/credential/assignment/grant IDs、capabilities、expiry与before/after version在EVENT冻结；operational effect仅从prepared EVENT + command actor/session重建；三方一致与M3规则不变。

**不得改变：** M5C ownership、assignment capability/confirmation/FSM/public API；projector不生成随机token/ID。

**改动文件及职责：** `src/main/application/planners/assignment-planner.ts`；`src/main/domain/projectors/assignment-projector.ts`；`local-runtime-context.ts`拆为pure plan + apply；assignment payload version；tests。

**跨文件登记项：** [ ] 5 rows；[ ] org/node/device/runtime/auth/grant facts；[ ] credential hash不泄露；[ ] deterministic ID；[ ] assignment version/status；[ ] sender/actor/device；[ ] M3 schema triggers/tests。

**核心设计与伪代码：** assignment EVENT携带 `runtime_context_v2`；APPLY按明确insert/update顺序执行并用约束拒绝冲突，不使用UPSERT掩盖现存不同identity。

**数据、事务与失败恢复：** runtime infrastructure DML与assignment projector同一IMMEDIATE APPLY；冲突rollback全批；内存binding post-commit可重建。

**测试设计：** 五command各绑定legacy→v2 A/B differential ID，以受控clock/ID比较runtime infrastructure、assignment/grant业务语义和public result；另测existing/missing runtime、rebind、credential/identity mismatch、event fault、PONR recovery、三方负测、M3 regression。

**精确验证命令：**

```bash
npm test -- src/main/application/planners/__tests__/assignment-planner.test.ts src/main/domain/projectors/__tests__/assignment-projector.test.ts src/main/application/services/__tests__/assignment-safety-command-bus.test.ts src/main/domain/__tests__/local-runtime-context.test.ts src/main/domain/__tests__/assignment-reducer.test.ts src/main/ipc/handlers/__tests__/assignment.test.ts src/main/db/__tests__/schema-m3-grant-assignment.test.ts
npm run contract:m5b:event-batch:check -- --mode migration --step M5B-11
npm run contract:m5b:scope:check -- --step M5B-11
npm run typecheck
npm run lint
git diff --check
```

**预期证据：** projector/recovery random source calls=0；所有infra+assignment同进退；identity mismatch不被UPSERT覆盖。

**回滚方式：** 删除未接线assignment planner/projector与payload扩展。

**停止条件：** operational effect需要planner内存秘密才能恢复，或需要跨进程owner epoch。

**建议 commit message：** `feat(m5b): prepare assignment runtime effects`

### Step M5B-12：迁移安全生命周期与单事件 redline batch

**目的与理由：** 在native M4 trigger证据下完成5个安全相关root，使新redline只写一个prepared安全事实，同时保留legacy两事件replay。

**前置状态：** M5B-6、M5B-8、M5B-9、M5B-11 accept `PASS`。

**完成状态：** safety四命令+assessment redline五row planner/projector/result齐全；新redline batch恰好一个 `SAFETY_INCIDENT_CREATED`；APPLY先incident/M4 trigger，再确定性安全结果/step投影；legacy `SAFETY_INCIDENT_CREATED + REDLINE_TRIGGERED`仍byte/replay兼容；teacher/admin负向不变。

**不得改变：** M4三元键、10 triggers/index、incident FSM、历史EventType；禁止直接插入 `REDLINE_HALTED`。

**改动文件及职责：** `src/main/application/planners/safety-planner.ts`；`src/main/domain/projectors/safety-projector.ts`；assessment redline fragment；safety payload versions；native/fault/replay/E2E fixtures。

**跨文件登记项：** [ ] 5 rows；[ ] one-event new path；[ ] legacy pair reader；[ ] M4 trigger inventory；[ ] result/report fallback；[ ] teacher/admin permissions；[ ] assessment+training same triple/different job。

**核心设计与伪代码：**

```text
planTriggerRedline() => [SAFETY_INCIDENT_CREATED(v2 self-sufficient)]
apply:
  insert domain_event_projection + processed_event
  insert safety_incident             // M4 trigger halts matching sessions
  assert exact affected triple/bindings
  apply prepared safety result/step projections
```

**数据、事务与失败恢复：** 全部在一个IMMEDIATE APPLY；trigger/result fault整体rollback；prepared replay不会再生成REDLINE_TRIGGERED。

**测试设计：** safety四command各绑定legacy→v2 A/B differential ID；`assessment:triggerRedline`使用经PRD裁决的semantic differential（业务投影/result相同，但明确断言legacy 2 events→v2 1 event的允许差异）；另测lifecycle正常/invalid/role、legacy pair mixed replay、native trigger failure/cursor/processed rollback、same triple/different job、historical reports。

**精确验证命令：**

```bash
npm test -- src/main/application/planners/__tests__/safety-planner.test.ts src/main/domain/projectors/__tests__/safety-projector.test.ts src/main/ipc/handlers/__tests__/assessment-redline.test.ts src/main/ipc/handlers/__tests__/safety.test.ts src/main/application/services/__tests__/assignment-safety-command-bus.test.ts
npm run contract:m4:safety-sql:check
npm run db:m4:verify
npm run db:m5b:isolated:verify -- --stage safety
npm run contract:m5b:event-batch:check -- --mode migration --step M5B-12
npm run contract:m5b:scope:check -- --step M5B-12
npm run typecheck
npm run lint
git diff --check
```

**预期证据：** 新path一个安全EVENT；legacy pair不改；M4三元trigger和整批rollback native通过。

**回滚方式：** 删除未接线safety planner/projector与payload扩展。

**停止条件：** 单event无法驱动全部确定性投影，或需删除历史REDLINE_TRIGGERED/改M4语义。

**建议 commit message：** `feat(m5b): project redline from one prepared event`

### Step M5B-13：实现 report export interaction、artifact publish 与恢复矩阵

**目的与理由：** 单独处理唯一含用户dialog和外部artifact的mutation，证明PONR前能力探测与PONR后确定性恢复均不覆盖用户文件。

**前置状态：** M5B-5、M5B-6 accept `PASS`。

**完成状态：** durable claim后、mutex前显示dialog并续租；cancel持久completed result/no batch；trusted target重新校验；hidden probe验证exclusive/hardlink/identity/barriers并在PONR前清理；planner仅内存bytes/hash；EVENT self-sufficient；PONR后stage/publish/rebuild/no-clobber matrix完整；cleanup失败只warning。

**不得改变：** renderer export参数/结果、HTML bytes语义；不把path/body写trace；不覆盖/删除外来target/stage/probe；startup不弹dialog。

**改动文件及职责：** `src/main/application/planners/report-export-planner.ts`；`src/main/domain/event-batch/{artifact-probe,artifact-publisher,artifact-recovery}.ts`；`report-export.ts`拆pure builder与adapter；REPORT_EXPORTED payload v2；interaction/result tests。

**跨文件登记项：** [ ] dialog/lease/lock order；[ ] trusted interaction context；[ ] probe naming/ownership；[ ] file/directory barrier；[ ] EVENT lineage/hash；[ ] target/stage identity races；[ ] artifact_from_event；[ ] trace redaction；[ ] no wildcard cleanup。

**核心设计与伪代码：** claim→dialog/renew→probe→mutex/revalidate→build bytes/plan→PREPARE(PONR)→publish prepared artifact→APPLY/CONFIRM/result→owned cleanup。

**数据、事务与失败恢复：** dialog/probe故障是pre-PONR；publish后故障按event重建/采用；target同hash采用，异hash/identity漂移进入corruption；不在SQLite transaction做file I/O。

**测试设计：** export row绑定legacy→v2 semantic differential，比较public result、report projection与成功HTML bytes/hash，同时登记新协议允许的no-clobber/staging差异；另测cancel/same-key/new-key/timeout/lease takeover、unsupported FS、probe cleanup/crash、pre-PONR restart无dialog、stage/publish/APPLY/CONFIRM/index/result每窗、same/different hash、symlink/hardlink race、missing artifact rebuild、external files remain。

**精确验证命令：**

```bash
npm test -- src/main/application/planners/__tests__/report-export-planner.test.ts src/main/domain/event-batch/__tests__/artifact-probe.test.ts src/main/domain/event-batch/__tests__/artifact-publisher.test.ts src/main/domain/event-batch/__tests__/artifact-recovery.test.ts src/main/domain/__tests__/report-export.test.ts src/main/ipc/handlers/__tests__/report-export.test.ts
npm run db:m5b:isolated:verify -- --stage artifact
npm run contract:m5b:event-batch:check -- --mode migration --step M5B-13
npm run contract:m5b:scope:check -- --step M5B-13
npm run typecheck
npm run lint
git diff --check
```

**预期证据：** target外来bytes始终保留；cancel/no-op无batch；startup dialog count 0；PONR后缺失artifact可重建且hash一致；异hash只读失败。

**回滚方式：** 删除未接线artifact modules与payload扩展；production export仍为M5A路径。

**停止条件：** 目标文件系统KAT不支持必要语义、artifact不能由EVENT确定重建，或实现需要覆盖/删除无法证明归属文件。

**建议 commit message：** `feat(m5b): recover report export artifacts`

### Step M5B-14：接通 startup/health 并原子切换全部 production mutation

**目的与理由：** 在全部未接线模块已逐步通过后，一次性完成Schema、legacy seal、startup recovery、75-channel transport与46 command执行切换，杜绝production hybrid事实源。

**前置状态：** M5B-2～13逐步accept全部 `PASS`，migration inventory pending只剩composition/cutover项；所有KAT在目标native Electron环境已可运行。

**完成状态：**

- `schema.sql`、migration list/startup/backup/connection正式目标v0.1.18；历史启动严格按固定顺序，fresh非空legacy失败。
- legacy reconcile不追加新audit；合法bytes原样封存，anchor写入index，新batch从GENESIS。
- runtime状态升级并执行四阶段recovery与legacy→v2 mixed replay验证；OPEN运行中检测不确定性可单向进入CORRUPTION_READ_ONLY。bootstrap对可诊断corruption返回typed outcome而不是丢弃预先创建的内存health；因此即使业务DB不可读，health handler仍可建立。
- 75 invoke handler全注册：29 READ/46 MUTATION；health从内存始终可用，其他READ在OPEN/corruption无lazy write，DB不可查询时返回原family stable system error。
- preload每context client ID、每mutation调用新key并作第二trusted arg；46个renderer业务签名/结果不变。
- 46命令全部接durable executor；production legacy event port、request-time recovery、嵌套report coordinator不可达；43+8目标0。
- shared/preload/renderer新增versioned health query/push、全局只读banner和脱敏JSON下载；无自动修复按钮。
- auth binding、runtime dispose、window/sender lifecycle、post-commit effects接线完整。

**不得改变：** public业务API、默认库、M4语义、M5C边界；不在startup/background打开export dialog；不保留fallback到legacy writer。

**改动文件及职责：**

- `src/main/db/schema.sql`、`migrations.ts`、`migration-startup.ts`、`connection.ts`、`migration-backup.ts`：正式Schema/bootstrap。
- `src/main/application/runtime/application-runtime.ts`及health/capability模块：状态机、composition、corruption。
- `src/main/application/command/m5a-command-definitions.ts`、`command-bus.ts`：46 durable definitions/executors。
- `src/main/ipc/handler-registry.ts`、`src/main/ipc/index.ts`：75 channel及gates。
- `src/shared/types/{ipc-api,runtime-health,command-transport}.ts`、`src/preload/index.ts`：transport/health合同。
- `src/renderer/src/stores/runtime-health.ts`、`components/RuntimeHealthBanner.vue`、`App.vue`、readiness view/tests：health UI/diagnostic download。
- 现有 application services/domain legacy modules：移除production writer/request recovery import/call；compatibility reader只供migration/replay。
- `src/main/index.ts`：path guard→bootstrap→handler/window顺序。

**跨文件登记项：** [ ] target schema/ledger；[ ] backup/reconcile/seal/recovery order；[ ] 75/29/46；[ ] second arg all46；[ ] health query/push/UI；[ ] public signature snapshots；[ ] 43/8 zero；[ ] 76 disposition；[ ] auth/window lifecycle；[ ] no legacy fallback；[ ] default open-before guard。

**核心设计与伪代码：**

```text
paths = resolveAndValidateBeforeOpen()
health = createInMemoryHealth(CLOSED)
bootstrap = openAndMigrateReconcileSealRecover(paths, health)
runtime = createEventBatchRuntime(bootstrap, health)
registerAllHandlers(runtime) // health always; business gates by state
if bootstrap.uniqueAndVerified: transition OPEN
else if corruption: transition CORRUPTION_READ_ONLY
createWindowWithHealthSubscription()
```

**数据、事务与失败恢复：** migration/reconcile/recovery分别使用明确capability与边界；任何切换失败不OPEN。第一次PREPARE后遵守只前滚规则；本步验收只在临时历史库执行切换。

**测试设计：** startup每state/顺序/failure；fresh/history/legacy LF/EOF/tail；legacy+v2 mixed replay及缺不可重建infra fixture拒绝；75 registry；metadata spoof/replay；all46 IPC golden；READ no-write；health anonymous/admin/redaction/push/UI和DB不可读；production import graph；Electron restart/crash/corruption；seal前、seal后、OPEN后、gate-only claim后、partial/complete PREPARE后的rollback barrier。

**精确验证命令：**

```bash
npm test -- src/main/application/runtime/__tests__/application-runtime.test.ts src/main/ipc/__tests__/handler-registry.test.ts src/main/db/__tests__/migration-startup.test.ts src/main/db/__tests__/connection-event-batch.test.ts src/main/domain/event-batch/__tests__/startup-recovery.test.ts src/renderer/src/stores/__tests__/runtime-health.test.ts src/renderer/src/components/__tests__/runtime-health-banner.test.ts
npm run db:m5b:isolated:verify -- --stage cutover
npm run contract:m5b:event-batch:check -- --mode migration --step M5B-14
npm run contract:m5b:scope:check -- --step M5B-14
npm run typecheck
npm run lint
npm run build
git diff --check
```

**预期证据：** production graph只有v2 writer；75 exact；legacy bytes exact；每startup状态可观察；corruption mutation side-effect spy=0且health/UI可达；build通过。

**回滚方式：** 只有runtime从未OPEN、seal/anchor未发布、无command claim/v2 record且T11–T14空时，才可按人工批准方案恢复M5A。seal已发布但未OPEN必须先恢复完整成对backup；OPEN、任一claim/gate-only DML或任一v2 record之后禁止单独回退binary/Schema，只能前滚或经批准恢复整对backup。

**停止条件：** 任一domain仍需legacy writer/hybrid、bootstrap顺序无法满足、health需暴露敏感信息、默认路径保护失败，或出现权威PRD/Schema冲突。

**建议 commit message：** `feat(m5b): activate event batch runtime`

### Step M5B-15：关闭 target gate、更新不变量/基线并完成 R3 全量验收

**目的与理由：** 用独立静态账本、native/Electron故障证据和文档合同确认里程碑真实完成，不从定向单测外推。

**前置状态：** M5B-14 accept `PASS`，runtime已在显式临时路径完成切换验证。

**完成状态：** target inventory pending=0、43 legacy writer=0、8 request recovery=0、75/29/46与36/10 exact；所有required gates实际PASS；baseline更新为v0.1.18/M5B accepted；新增INV-EVT-004～006；独立code review P0/P1=0并最终`/vibe-accept` PASS。

**不得改变：** 不借验收顺手修改产品行为、默认数据、M5C/42+8范围；任何required check不得记NOT_RUN为PASS。

**改动文件及职责：** inventory target fixtures/scripts；`doc/specs/baseline.yaml`；`doc/specs/project-invariants.md`；本impl/review/step accept/code review/validation；`.continue-here.md`、`doc/会话启动.md`；`doc/index.md`自动区块；`package.json`最终命令。

**跨文件登记项：** [ ] inventory target；[ ] scope/worktree起点；[ ] Schema/invariants/baseline；[ ] docs index；[ ] all tests/build/native/Electron；[ ] manual matrix；[ ] independent review；[ ] no default data；[ ] no commit/push。

**核心设计与伪代码：** `targetGate = exact inventory + production reachability + schema/event/api cross-file checks + default-data open-before proof`。

**数据、事务与失败恢复：** 验收只使用helper自行创建的唯一成对`/tmp` roots；故障fixture完成后可定向清理其自身tmp，不删除用户文件。

**测试设计：** 见第6、7节；独立review必须读取真实diff和执行证据。

**精确验证命令：**

```bash
npm run contract:m5b:event-batch:check -- --mode target
npm run contract:m5b:scope:check -- --step M5B-15
npm run db:m5b:isolated:verify -- --stage full
npm run db:m5b:native:verify
npm test
npm run typecheck
npm run lint
npm run build
npm run contract:m4:safety-sql:check
npm run db:m4:verify
npm run db:m4:native:verify
npm run contract:m5a:command-boundary:check -- --mode baseline
npm run e2e:m5b:ui
npm run e2e:m4:ui
npm run docs:index:update
npm run docs:index:check
git diff --check
git diff --cached --check
git status --short --untracked-files=all
```

`db:m5b:native:verify` 与 `e2e:m5b:ui` 的helper必须自行建立并输出唯一显式`/tmp` DB/dataRoot/userData/export/evidence路径，且在open前执行guard。不得无参数调用现有default DB命令。M5A target是历史已验收形态，M5B切换后只运行其固定baseline证据；当前production正确性由M5B target gate接管。

**预期证据：** 每条命令记录exit code、测试数/关键计数、临时路径；lint如仍有历史warning需报告准确数量，不声称0；Electron环境不可用则本步为`BLOCKED/NOT_RUN`且不得完成里程碑。

**回滚方式：** 文档/gate可单独修订；代码/数据回滚遵守M5B-14的PREPARE边界，验收不得触发默认数据。

**停止条件：** P0、未关闭P1、任一required FAIL/BLOCKED/NOT_RUN、target pending/legacy callsite非0、默认路径open、Schema/invariant/index不一致。

**建议 commit message：** `test(m5b): accept event batch runtime`

## 6. 全量回归矩阵

| 域 | 自动化证据 | 必须杀死的错误实现 |
|---|---|---|
| Inventory/scope | 75/29/46、36/10、361/378/76逐项迁移、43/8 target0、dirty起点hash | 文件移动后漏sink；整体继承allowlist；把既有改动覆盖/归入M5B |
| Path/default protection | missing/non-temp/unpaired/symlink/hardlink/evidence reuse，open spy=0 | 先open再校验；解析default做before/after hash |
| Schema/migration | fresh/M4/unknown/partial、backup/restore、SQL结构/FK/check/index/query plan | 只写ledger；含T18；文件I/O包进migration transaction；unknown先DDL |
| Canonical/hash | fixed bytes、key order、LF、checksum/events/batch hash、GENESIS/跨段 | 最后event漏LF；hash二进制/hex混用；legacy hash接新链 |
| Segment/index | 双阈值、batch不跨段、sealed、index rebuild/conflict、identity/barrier | split batch；覆盖冲突index；重开不同inode继续写；静默降级fsync |
| Durable idempotency | same/new key matrix、secret KAT、lease/takeover/generation/attempt | renderer选key；先resolve target再replay；低成本密码摘要；SELECT→UPDATE竞争 |
| Coordinator/PONR | 1/N/0、APPLY rollback、7+细分crash windows、planner count | PREPARE后重跑handler；replacement batch；重复COMMITTED；部分projection |
| Prepared-only recovery | PREPARE后销毁plan/new composition、effect/recipe一致性与tamper | effect参数只在内存；不同EVENT recipe冲突仍执行；恢复重跑planner |
| Projection source | relative segment path、line/byte round-trip、processed/projection/batch join | 绝对path入库；event归属不同segment；normal/recovery SQL漂移 |
| Mixed replay | legacy v1/F7 + v2 segments + explicit infrastructure fixture | 只重放一代；声称空DB恢复command/auth基础设施；两代sequence漂移 |
| Result recovery | every command recipe version、confirmed before result、unknown version、deterministic rejection=SUCCEEDED | 从当前可变state重算响应；确定性失败写FAILED重试；SUCCEEDED result可变 |
| Gate-only | auth/student/strategy native txn/replay/no segment | DML与result分transaction；伪造0-event batch；login保存raw token；logout无法replay |
| Legacy→v2 differential | 46 rows A/B临时根；36 event命令逐rowtest ID；允许差异显式登记 | legacy与v2测试各自通过但业务表/result漂移；oracle随被测实现更新 |
| Assessment/training | FSM/order/snapshot/recovery/fault | projector重新决策event；prepared后读取新策略；自动completion第二batch |
| Scoring/automation | N score+result+completion+report one root、result isolation | child失败留下部分score；吞report失败；四类结果混算 |
| Assignment | deterministic runtime facts/credential/three-party/M3 | projector随机ID；preflight建runtime；UPSERT覆盖identity冲突 |
| Safety | new one-event、legacy pair、M4 native trigger、same triple/different job | 新写REDLINE_TRIGGERED；直接REDLINE_HALTED；二元键熔断；trigger失败部分提交 |
| Export artifact | dialog/lease/probe/stage/publish/rebuild/race/no-clobber | mutex内等dialog；PREPARE后才发现unsupported FS；覆盖/删除外来文件；startup弹窗 |
| Startup/corruption | state order、tail/APPLIED/PREPARED/result recovery、tamper、health/READ | runtime提前OPEN；corruption继续mutation；health依赖坏DB；READ lazy write |
| Cutover rollback | pre-seal、post-seal、OPEN、claim/gate-only、partial/complete PREPARE | seal后只换回M5A继续append；gate-only后误判“无PREPARE即可回退” |
| Compatibility/UI | 46业务签名snapshot、75 whitelist、health push/banner/download、legacy replay | transport metadata进入业务payload；新增业务字段；绝对path/PII泄露；自动修复按钮 |
| Native/Electron | better-sqlite ABI、BEGIN IMMEDIATE、file KAT、restart/crash、M4 safety/full task flow | WASM/build替代native；主/preload/renderer任一未实际运行 |

## 7. 人工验收矩阵

所有场景只使用启动脚本显示的显式临时 `SVETS_USER_DATA_DIR`、DB、data root、export/evidence root；不得手工打开默认应用数据。

| 场景 | 操作 | 预期观察 |
|---|---|---|
| 正常教师/学生闭环 | 登录、建学生、建测评、分配、确认、答题、线下评分、训练、报告 | 业务界面/错误不变；每次点击一个root command；无部分结果/报告 |
| 重复transport | 测试构建重放同metadata；另以新点击提交同payload | 同key返回旧结果；新key是新意图；UI不提供复用key控件 |
| 启动恢复 | 在各批准fault point退出再重启临时应用 | recovery期间无可操作假象；最终恢复同batch；不重复dialog/planner |
| Legacy升级 | 准备LF/完整EOF/F7临时log并升级 | bytes hash/length完全不变；新事件只在segments；health显示legacy anchor |
| Corruption | 测试构建篡改hash/index/identity | 全局只读banner；mutation稳定失败；health/诊断可下载且无绝对path/PII；无自动修复 |
| Safety | 同三元assessment+training触发，另建不同job | 同三元整体熔断并安全失败；不同job不受影响；新batch只一个安全事件 |
| Report export | cancel、正常导出、目标已存在、故障后重启 | cancel可重放且无文件/batch；不覆盖既有文件；故障后采用/重建同hash artifact |
| 权限 | student/teacher/admin逐项尝试越权与停用/撤销重放 | 权限不放宽；login/logout replay仅按冻结例外；corruption诊断不泄露事实内容 |
| 桌面构建 | 真实Electron窗口、重启、health push、退出清理 | Main/preload/renderer协同；无ABI/console error；退出无残留writer/lease timer |

## 8. 残余风险与后续项

1. M5B 只证明当前OS进程内唯一runtime/writer mutex；第二进程同时打开data root仍由M5C process-exclusive lock/owner epoch关闭。
2. `command_log` 是混合基础设施表，不能从JSONL重建client key、lease、attempt和完整result；灾难恢复仍依赖成对SQLite备份。
3. sealed segments永久保留且本步不实现磁盘清理；空间告警/备份产品能力需后续feature。
4. report owned stage清理失败只形成maintenance warning；不授权按通配符清理历史探针或外部目录。
5. 当前renderer不保存跨重启pending metadata；M5B只保证同transport metadata重放，不承诺普通用户在应用重启后自动恢复未提交点击。
6. T18草稿、多教师交接、utilityProcess、网络transport与42+8内容仍明确在后续里程碑。
7. 一旦写入首个v2 PREPARE，自动代码/Schema down被禁止；后续缺陷只能前滚或走批准的成对backup恢复。
8. lint历史warning必须按实际输出报告；本计划不借M5B清理无关warning或重构。

## 9. Reviewer 输入包

执行 `/vibe-review impl doc/features/event-batch-v2.2-runtime-impl.md` 时显式提供：

- PRD：`doc/features/event-batch-v2.2-runtime-prd.md`；
- PRD Review：`doc/features/event-batch-v2.2-runtime-prd-review.md`；
- 实施计划：本文件；
- 风险等级：R3；
- 适用不变量：第3节全部ID；
- 已读代码范围：M5A command/runtime/registry、46 definitions、DB adapter/schema/migration/startup/connection、legacy writer/recovery、assessment/training/assignment/safety/report/scoring services/reducers、preload/shared IPC、renderer root/readiness、相关tests与M5A inventory；
- 重点问题：
  1. 未接线模块→单一原子production cutover是否避免hybrid事实源且中间步骤可构建/回退；
  2. 15步是否单一、依赖正确，是否有一步把R3关键副作用留到后续却先接production；
  3. 46个command的planner/projector/result/operational effect与36/10分类是否完整；
  4. gate-only DML/result、batch APPLY、file artifact三种边界是否没有假原子；
  5. PONR、lease/generation、duplicate COMMITTED、result recovery与planner-count tests能否杀死错误实现；
  6. versioned EVENT是否足以在策略/题目/source变化后确定性project/recover；
  7. legacy合法bytes、尾部处理、backup/migration/seal/recovery顺序是否唯一；
  8. report dialog/probe/stage/no-clobber/rebuild是否存在覆盖/删除外来文件或startup弹窗路径；
  9. login/logout replay与binding是否无需raw token且不放宽权限；
  10. runtime health在SQLite损坏/无会话时是否可达且脱敏，75计数是否正确；
  11. dirty worktree/scope/default-data门禁是否能给出独立证据；
  12. 是否越界进入M5C、T18、网络、backup产品或42+8内容。

Reviewer只有在P0/P1为0且required evidence路径可执行时才能判定`PASS`；最多两轮。计划PASS后按M5B-1～15逐步实现，每步必须真实diff review + `/vibe-accept step`，不得用本计划或PRD PASS替代实现验收。
