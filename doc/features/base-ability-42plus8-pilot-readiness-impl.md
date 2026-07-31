# BASE_ABILITY 42+8 正式施测补料实施计划

## 1. 实现目标

将 `doc/features/base-ability-42plus8-pilot-readiness-prd.md` 转换为可逐步实施、验证和回滚的 Q1 计划。目标是先在显式临时数据库和合成身份上闭合 42 道线上题 + 8 道线下题的内容、组卷、作答、评分、事件、恢复、报告和授权门禁，再允许经独立批准执行受控 Pilot 激活。

本计划不等同于 Pilot 已激活或课堂试测已完成。真实题目在有效独立批准前必须保持 `DRAFT`；没有当前有效学校授权时，真实 session 不得创建或继续。

## 2. 基线与范围

- PRD：`doc/features/base-ability-42plus8-pilot-readiness-prd.md`，状态 `REVIEWED`，风险 `R3`。
- 权威产品合同：`doc/specs/MVP_PRD_v1.0.9-authoritative.md`。
- 权威 Schema：`src/main/db/schema.sql`，当前基线 `schema v0.1.18-event-batch-v2.2`；其 M5B v2.2 durable command ledger 和 event-batch apply cursors 是 production write/recovery boundary。
- 权威运行时合同：`src/shared/types/json-schemas.ts`、`src/shared/types/event-payloads.ts`、`src/shared/types/ipc-api.ts`。
- 当前工程基线：`5f050d6`，分支 `feat/multi-device-m2-prd`；M5B-15 为 `PASS`，M4 Step 2A、M5A Step 2B 和 M5B Step 2C 均为已验收前置。本计划以当前工作树为修订起点，不覆盖用户已有改动；每个后续实现 Step 开始时仍必须记录届时实际 base commit，不能把本行 hash 当作未来实现基线。
- 历史修订基线：`8fa2a4f` 是本计划首次形成时的 M4-M5B checkpoint，只能用于追溯当时的设计语境，不是当前 Schema、运行时或 Step 3 的前置依据。
- 影响域：`UI_UX`、`DOMAIN_LOGIC`、`DATABASE_MIGRATION`、`EVENT_PROJECTION`、`IPC_API`、`AUTH_PERMISSION`、`SAFETY_FSM`、`RESULT_REPORT`、`ASSET_CONTENT`、`DEPLOYMENT_OPERATIONS`。
- 明确不做：正式标准化量表解释、就业安置或 `placement_advice`；自动将 Pilot ACTIVE 升格正式发布；真实学生数据进入技术演练；覆盖历史题目、策略、session、结果或报告；新增 ORM、前端持久化库、CSV 解析库或 Markdown 报告渲染库；超出两个既定 CHECK 枚举的 Schema 扩展。

## 3. 适用不变量

- `INV-EVT-001`、`INV-EVT-003`、`INV-EVT-004`、`INV-EVT-005`、`INV-EVT-006`：状态由事件推进；新增事件完成 payload、持久化、reducer/projector、回放和测试全链登记；生产 mutation 必须走 durable command 与 v2 batch/gate 边界，恢复只能使用冻结 batch 事件事实。`INV-EVT-002` 仅保留 legacy JSONL writer 的历史适用范围，不得作为当前生产写入、恢复或 Step 3 设计依据。
- `INV-SAFE-001`、`INV-SAFE-002`、`INV-SAFE-003`、`INV-SAFE-004`：授权失效不能绕过既有安全熔断；安全状态迁移必须走批准路径。
- `INV-AUTH-001`、`INV-AUTH-002`：TEACHER/ADMIN 边界和业务 session、device grant、assignment 三方一致性不可削弱。
- `INV-RES-001`、`INV-RES-002`：`ABILITY_SCORE` 与其他结果独立，安全语义优先于普通分数。
- `INV-STR-001`、`INV-STR-002`：session 绑定同一策略版本，历史引用策略不可原地漂移。
- `INV-IPC-001`、`INV-IPC-002`：新增 IPC 完成 handler/preload/shared type/权限/错误映射登记，renderer 不得访问 Node。
- `INV-DATA-001`、`INV-DATA-002`、`INV-DATA-003`：JSON 写入前校验，策略数据来自配置，迁移可前滚、可重放、可验证。

## 4. 变更地图

### 当前状态

Step 1 已验收为 `PASS`：96 条 `BASE_ABILITY` 候选均保持 `DRAFT`、`NO_SCORE`，`base-ability-42plus8-authority-v1.json` 已冻结 50 题（42 online + 8 offline）和 46 题 deferred 清单。素材/教具、renderer、作答事件、统一评分快照和授权失效处置仍未就绪，相关 gate 继续失败关闭；后续实现不得把这份 DRAFT 合同或既有评分入口误写为 Pilot 就绪。

### 目标状态

产生可追溯的 50 题 DRAFT 运行权威：线上每个模块 7 题、线下 8 题，未选 46 题继续 DRAFT；每题绑定结构化合同、答案/锚点、支持和安全政策、资源 hash 与审核结果。临时库可稳定生成 42+8，学生线上作答、教师线下评分、非计分响应、安全停止、事件投影、恢复、报告限制和授权失效均可重放和拒绝非法操作。只有有效批准链和可信执行上下文才能激活，且只激活获批集合。

### 迁移路径与失败恢复

1. 候选来源冻结为版本化清单，仍保持 DRAFT。
2. 结构化合同、评分规则、renderer、资产和审核结果进入门禁，失败关闭。
3. 技术演练在显式临时库执行，验证通过后才进入 `READY_FOR_PILOT_ACTIVATION_REVIEW`。
4. 有效独立批准 + 学校授权 + 逐学生同意共同满足时才创建/继续真实 session。
5. 授权失效先停止输入，再关闭坐次、终止受影响开放 session、释放 grant/assignment；运行区间重叠的已完成 session 永久隔离证据，不覆盖历史 bytes。
6. 内容或实现发现问题时停用/归档受影响版本并新建 question/strategy 版本；数据库迁移采用写入前可 down、写入后 expand-only 的受限策略，禁止带真实新 reason 的无损降级假设。

### 依赖图

```text
Step 1 候选清单/题目合同 [PASS]
  -> Step 2A [ACCEPTED，M4] Safety Re-key（三元安全聚合）
  -> Step 2B [ACCEPTED，M5A] Command Bus Boundary（统一命令/写入口）
  -> Step 2C [PASS，M5B-15] v2.2 batch/hash-chain/command-fencing、全 writer 迁移与重基线
  -> P1-01 当前计划重基线 [PASS]
  -> P1-02 workbook<->SQL 日常强制门禁 [PASS]
  -> 新的独立 R3 计划复审 [下一原子任务]
  -> Step 3 v1.2 策略、组卷合同、renderer 需求与 SESSION_STARTED v2 快照链
  -> Step 4 response/scoring 事件链（只读取冻结快照）
  -> Step 5 共享路径守卫、真实 renderer registry、线下评分和三视口运行证据
  -> Step 6 通用授权原件库/导入/生命周期/水位/启动扫描/写边界 + reason migration
  -> Step 7 ABILITY_SCORE、报告与来源隔离
  -> Step 8 人工审核、资产/教具和分阶段门禁
  -> Step 9 合成身份显式临时库演练
  -> Step 10 生产固定根装配、独立批准和受控激活
```

Step 2 的三个独立 R3 已按顺序交付：Step 2A 将安全聚合从二元键统一为三元键，Step 2B 建立统一 Command Bus / mutation boundary，Step 2C 落地权威架构 `doc/specs/architecture-plan-b-multi-device-v2.2-authoritative-baseline.md` §10、§11、§12、§18 的 `BATCH_PREPARED -> EVENT* -> BATCH_COMMITTED`、hash chain、`command_log` fencing 和 `startupRecovery`，并以 M5B-15 `PASS` 成为当前基线。Step 3-10 必须消费该既有 production v2 runtime，不得重复迁移为 legacy 逐行写入或另建旁路。Step 3 仍不以 Step 5 尚未实现的 renderer 作为自身“可运行”完成条件：它冻结每道题所需的 renderer key，并让缺失实现稳定失败关闭；Step 5 才登记真实 registry、放行合成 session 并完成 viewport 验收。Step 6 必须先交付可注入测试根的通用授权底座，Step 9 才能执行授权失效演练；Step 10 只装配不可覆盖的生产根、独立批准链和激活入口，不再补做 Step 6 的生命周期基础能力。

### 跨文件副作用登记表

| 主变更 | 必须同步核验 |
|---|---|
| 新 `EventType` | `event-payloads.ts`、validator、event writer、reducer、recovery、JSONL/projection、幂等/冲突测试 |
| 事件版本 | `ActionLogEntry.schema_version` 只表示 envelope；业务 payload 使用独立 `payload_version`，不得复用同一版本号原地增加必填字段 |
| 已验收 Step 2A M4 安全三元键 | 已完成的产品覆盖、v2.2 架构 §13、trigger/guard、索引、全部安全查询/报告 JOIN、v0.1.16→v0.1.17 历史迁移与跨 job 正负测试；后续工作必须保持三元键，不得和新的业务需求重新合并迁移 |
| 已验收 Step 2B M5A Command Bus | 已建立的统一 command envelope、application service、IPC/CLI/background mutation inventory 与最终写边界；后续保持 IPC 响应和业务成功语义，不得回接分散 writer |
| 已验收 Step 2C v2.2 事件基础设施 | 当前权威 `BATCH_PREPARED/EVENT/BATCH_COMMITTED`、hash chain、segment/index、`command_log` fencing、batch projector/startupRecovery、legacy `ActionLogEntry` 兼容、data-root 单写者锁、durability barrier、最终 writer call site 与整批故障/并发测试；不得自定义 group/sidecar 协议或回退至逐行 writer |
| 当前事件不变量 | `project-invariants.md` 已版本化保留旧 `INV-EVT-002` 的历史适用范围，并以 `INV-EVT-004/005/006` 约束命令确定性、冻结 batch 恢复和 production v2 mutation boundary；静态门禁不得把旧逐行 writer 声明为当前合同 |
| 全局 mutation 门禁 | IPC channel 唯一分类 registry、preload/shared API 对账、后台/启动写入与 CLI mutation registry、所有 DB/文件写入口统一 gate、关闭门禁时零副作用测试；与 Step 2 batch runtime 同一 data-root context，不另设旁路 |
| `SESSION_STARTED` v2/v3 快照 | envelope 保持 schema v1；payload v2 冻结逐题/策略/资产/renderer，payload v3 追加授权快照；创建 handler、validator、reducer 不回查题库、冷启动混合重放、后续评分只读冻结快照 |
| 两个 reason 枚举 | `schema.sql`、migration、shared type、domain contract、assignment/session handler、旧库前滚/回滚测试 |
| 组卷规则 | `strategy_config`、paper generator、assessment handler、session snapshot、策略版本测试 |
| 统一评分 | answer payload 校验、scoring snapshot、result projection、report contract、旧题型回放测试 |
| 新 IPC 或权限动作 | handler、`src/preload/index.ts`、`src/shared/types/ipc-api.ts`、auth context、错误映射和负向测试 |
| 新 renderer/路由入口 | Vue route/view/store、题型状态、无障碍、Electron smoke 和 viewport 测试 |
| 默认数据路径保护 | 从 Step 2 验收后的 production runtime layout 与独立默认 userData 推导递归 manifest：DB/-wal/-shm、legacy log、active/archived segments、segment index、recovery/corruption metadata、授权原件/水位/current-index；比较相对路径、类型、存在状态、size、SHA-256，并拒绝链接别名 |
| 授权合同/原件/水位 | shared type、JSON Schema、签名/期限 validator、content-addressed 不可变原件库、可信导入/当前索引发现、最高 revision/UTC 水位持久化、启动扫描、事务写边界和故障测试 |
| 激活/授权包 | 固定信任根、签名/主体分离、有效期/revision、目标库保护、`PILOT_ACTIVATION_EXECUTED` 台账事件、审计与重复执行测试 |
| reason down migration | DB 两列、SQLite projection、与目标 DB/data root 可证明配对的当前/归档 action log 联合预检、表/索引/trigger 恢复、允许 down 与拒绝 down 前后 hash |
| 审核/资产产物 | 自包含 HTML、JSON 权威结果、manifest/hash、文档索引和不得直接激活的门禁测试 |

## 5. 实现步骤

### Step 2-10 共通状态约束

- Step N 只有在 Step N-1 的 `/vibe-accept step <N-1>` 结论为 `PASS` 后才可开始；`FAIL`、`BLOCKED`、`NOT_RUN` 或 `AUTOMATION_PASS_MANUAL_PENDING` 均表示尚未闭环，必须停在当前 Step。Step 8 的审核工具和 Step 10 的受控入口可以单独记录工程子项 `PASS`，但外部原件缺失时该 Step 总状态仍按“完成状态”保持 `BLOCKED` 或 `NOT_RUN`，工程子项状态不授权进入下一 Step 或执行真实激活。
- 每一步必须分别记录三类状态：工程验收结论、分阶段机器门禁状态、非测试数据库中的题目/session 状态。不得用其中一类的 `PASS` 推断另外两类也已通过。
- Step 2-9 的构建、测试、门禁生成和技术演练不得把任何非测试数据库中的 BASE_ABILITY 题从 `DRAFT` 改为 `ACTIVE`；Step 9 的合成 `ACTIVE` fixture 只能存在于命令行显式指定的临时库。
- 任一“完成状态”只能由该 Step 的精确命令、产物 hash、数据库断言和 `/vibe-accept` 证据共同证明。命令未执行记 `NOT_RUN`，外部原件或环境缺失记 `BLOCKED`，不得写成已完成。
- 进入下一 Step 前必须核对真实 diff、跨文件副作用登记和 `git diff --check`。发现范围扩大到 PRD 未批准的 Schema、状态机、权限模型或正式解释时立即停止，重新进行 R3 审查。
- Step 2A、2B、2C 是已完成的三个跨功能独立 R3：其 `/vibe-feature -> /vibe-impl -> /vibe-review -> implementation -> /vibe-accept` 记录不得被本 PRD 的两个 reason CHECK 覆盖或重写。当前 `baseline.yaml` 已指向 Step 2C/M5B-15 基线；后续仅能在该边界上扩展，不能把三阶段重新合并，或用自定义 `EVENT_GROUP`、逐行单事件重试、复合业务 payload、sidecar intent 代替。P1-01 与 P1-02 均已关闭；Step 3 仍被新的独立 `/vibe-review impl` 阻断。
- 所有 Electron E2E、技术演练或其他同时拥有 DB 与 userData 的组合自动验证必须显式传入 `--temp-root / --db / --user-data-dir / --evidence-dir`；命令缺参、DB 与 userData 不配对、路径解析到默认 userData、仓库目录、符号链接或硬链接别名时必须在打开数据库前失败。纯 `db:sync/db:verify` helper 是明确例外，只接收 `--db` 且不得启动 Electron、推导 userData 或写 action log；它只能在共享 path guard 已验证或紧接着将由四路径组合入口验证的显式临时 DB 上运行。任何“默认库不变”都必须比较默认数据文件族的存在状态与逐文件 hash，而不是只比较主 `.db` 文件。

### Step 1：冻结 42+8 候选清单与 v1.2 题目合同

**目的与理由：** 把 96 条候选变成可审计的 50 题 DRAFT 运行输入，先解决来源、题型、模块、合同 hash 和观察项混入问题。

**前置状态：** `contract:base-ability:authority:check` 会先逐字段核验 workbook↔SQL，`contract:base-ability:gate:check` 复用同一 authority 检查；二者均可证明候选来源未漂移；无任何真实题目激活。

**完成状态：** 生成版本化清单，线上 6 模块各 7 题、线下 8 题、观察项为 0；每题有结构化 `presentation/interaction/expected_evidence/support_policy/termination_policy`、答案或 rubric、来源 hash、内容/评分/renderer 需求 hash 和选择理由；未选 46 题有来源与未选原因；提交审核不改变 DB 状态；`/vibe-accept step 1` 为 `PASS`。

**不得改变：** 不得覆盖唯一来源 xlsx、历史候选清单或审核结果；不得把观察项、未选题或 JOB_SPECIFIC 题补入 42+8；不得由生成脚本写运行库、改变题目状态或自报人工审核/激活权限。

**改动文件及职责：**
- `doc/features/base-ability-42plus8-authority-v1.json`、`doc/features/base-ability-42plus8-authority-v1.schema.json`：定义覆盖 96 题的机器权威、入选 50 题、未选 46 题及版本/hash 绑定；不得自报激活权限。
- `scripts/build-base-ability-42plus8-authority.mjs`、`scripts/lib/base-ability-42plus8-authority.mjs`：从唯一 xlsx、派生 SQL 和逐题结构化输入确定性生成/检查权威，不写运行库。
- `scripts/build-base-ability-42plus8-gate.mjs`、`scripts/lib/base-ability-42plus8-gate.mjs`：输出阶段化门禁、阻断码、hash 和题集统计。
- `scripts/__tests__/base-ability-42plus8-authority.test.mjs`、`scripts/__tests__/base-ability-42plus8-gate.test.mjs`：覆盖缺题、重复题、模块配额、观察项、未选原因、hash 漂移，以及 workbook 或 SQL 字段漂移时 authority check 的失败关闭。
- `package.json`：新增 `contract:base-ability:authority:build/check`，保持 gate build/check 不具有运行库写权限。

**数据、事务与失败恢复：** 只生成 DRAFT/审核产物，不写默认运行库；任一 hash 或来源不一致整体失败关闭。

**精确验证命令：** `npm test -- scripts/__tests__/base-ability-42plus8-authority.test.mjs scripts/__tests__/base-ability-42plus8-gate.test.mjs`；`npm run contract:base-ability:authority:build`；`npm run contract:base-ability:authority:check`；`npm run contract:base-ability:gate:check`；`npm run docs:index:update`；`npm run docs:index:check`；`git diff --check`。

**预期证据：** authority 和 gate 的确定性 hash、96=50+46 对账、42+8/模块配额断言、所有非测试数据源 96 DRAFT/0 ACTIVE 的查询结果。

**回滚方式：** 删除/替换本步骤新生成的版本化候选产物，不触碰历史审核结果和运行库。

**停止条件：** 50 题无法满足模块/线上线下配额、题目合同与权威 PRD 冲突、或需要改变题目状态时停止并重审。

**建议 commit message：** `feat(base-ability): freeze 42plus8 draft authority`

### 已验收前置：Step 2A–2C 稳定安全身份、命令边界与权威 v2.2 batch 运行时（三个独立 R3）

**历史目的与当前约束：** 此前安全聚合为二元键、写命令分散在 handler，legacy `writeEvent()` 的 JSONL/SQLite 双写会在 append 后 DB 失败时留下未投影事实并可能复用 sequence。为避免二次迁移，Step 2A、2B、2C 已依次完成三元安全身份、统一命令/写入口和 v2.2 的原子性、durability、recovery、fencing、锁序及全局 mutation gate。后续 42+8 事件只能扩展该既有边界。

**已完成前置状态：** Step 1 的 `/vibe-accept step 1` 为 `PASS`；Step 2A（M4 Safety Re-key）和 Step 2B（M5A Command Bus）均为 `ACCEPTED`；Step 2C 已随 M5B-15 取得 `PASS`。其交付过程已对 legacy `ActionLogEntry`、F7 envelope-v2、LF/EOF、recovery snapshot、最终 writer 调用点以及 IPC/CLI/后台 mutation inventory 建立兼容与恢复边界。默认运行库仅可只读记录存在状态/hash，不作为迁移或故障注入目标。P1-01 与 P1-02 均已关闭；当前进入 Step 3 前，仍须完成新的独立 `/vibe-review impl`；不得重做 Step 2。

**当前已接受运行时合同：**

- 独立功能严格实现权威架构 §10、§11、§12、§18 的 `BATCH_PREPARED -> EVENT* -> BATCH_COMMITTED`、全局 `batch_sequence`、canonical hash chain、segment/index、单写者、command/request fencing、PREPARE/APPLY/CONFIRM 和四阶段 `startupRecovery`；batch record version、领域 event envelope version 与业务 `payload_version` 三层各自独立，不改写 F7 envelope-v2 或历史 payload 语义。
- 每个生产写命令都有稳定 `command_id/idempotency_key/request_hash`，在一个 batch 中携带该命令全部有序事件。现存 `operation-scoring` 的 9 条 `OFFLINE_SCORE_SUBMITTED + RESULT_CALCULATED`、BASE_ABILITY 多项线下评分、JOB_SKILL 多项评分及 `RESULT_CALCULATED + SESSION_COMPLETED`、首次坐次与首题激活、安全 incident + redline 以及所有单事件命令全部迁移；成功语义不变，任一 EVENT/PREPARE/APPLY/CONFIRM 故障都不得暴露部分业务投影或生成第二个 batch。
- Phase 1 在同一已复核 identity 的 fd 上完整写入 `BATCH_PREPARED + EVENT*` 并 fsync/fdatasync 后才成立。首次创建 segment/index 时还必须通过平台适配器持久化文件和父目录项，或在目标平台以等价且经 KAT 证明的 metadata flush 完成；无法证明 durability 时启动失败为稳定错误，不得开始 PREPARE。bytes 可见但 fsync 结果不确定时立刻关闭当前 data root 的全局 mutation gate；recovery 必须先重新成功建立同一 batch 的 durability barrier，才能 APPLY 或开放 gate。
- 旧 `ActionLogEntry` 迁移/兼容合同不重写历史事实：完整、可解析且 checksum 合法的 legacy record 以 LF 或当前 EOF 终止都保留；EOF JSON bytes 不变，只能补 LF 并重新 fsync。完整但 checksum/version 非法的记录进入 corruption；只有已证明不构成完整合法 legacy record 或权威 batch 的尾部 bytes 才能按审核后的归档/截断规则处理。现行 v1、F7-v2、projection 已有/缺失、旧 snapshot/metadata 与新 segment genesis 的映射可确定重放。
- `startupRecovery` 在任何业务 IPC、后台 mutation 或 lazy seed 注册/执行前完成：不完整 PREPARE 尾部、PREPARED 未 APPLIED、APPLIED 未 CONFIRMED、command_log/projector cursor 和 hash-chain/segment-index 分别按权威状态机处理。恢复期间只有持有 composition-root 内部 capability 的 recovery/migration 可写；任一 hash、identity、sequence、request 或 projection 冲突保持 gate 关闭并失败关闭。
- 全局 mutation gate 覆盖所有 DB/文件副作用。每个 shared/preload IPC channel 在中央 registry 中恰好分类一次；所有 CLI、后台任务、启动 seed、报告导出和本地配置 mutation 也进入同一 data-root runtime。gate 关闭时登录/登出、账号/学生/策略、session/assignment/safety/scoring、报告导出、down 和未来 activation 均在副作用前拒绝，纯读取仍可用；read handler 不得 lazy write。
- 全局锁序固定为 `authorization state lock（未来 Pilot 路径适用） -> event-log single-writer lock -> BEGIN IMMEDIATE`。普通 batch、startupRecovery、down 和 activation 不得反向获取；同一 data root 不能构造第二套 coordinator/gate，低层 append/project API 只接受不可伪造 ownership token。
- Step 2A、2B、2C 已各自完成独立 `/vibe-feature`、`/vibe-impl`、`/vibe-review`、实现和 `/vibe-accept`：M4/Step 2A 与 M5A/Step 2B 为 `ACCEPTED`，M5B/Step 2C 以 M5B-15 为 `PASS`。Step 2C 已将最终 Schema/运行时/数据合同、`project-invariants.md` 与 `baseline.yaml` 同步为当前基线。BASE_ABILITY Step 1、P1-01 与 P1-02 随后均已重验/关闭为 `PASS`；本计划仍须取得新的独立 `/vibe-review impl` `PASS`，才允许 Step 3 开始。

**不得改变：** 该独立 R3 不得借 42+8 PRD 擅自实现授权 reason、题目激活或 Pilot 业务；不得新增 `EVENT_GROUP` 或权威三类 batch record 之外的永久日志协议；不得把 SQLite 改成事实来源、在 PREPARE durability barrier 前 APPLY、以 sidecar intent 补造未落盘 EVENT、吞掉 PREPARE 后错误、重写/删除历史合法记录、把完整 legacy EOF 当损坏尾部，或让不同 data root 共用锁/gate。不得以“最终能重放”为由放宽现有整批零投影失败测试。

**已验收独立 R3 的文件职责（后续扩展必须遵守）：**

- `doc/features/event-batch-v2.2-runtime-prd.md`、`doc/features/event-batch-v2.2-runtime-impl.md` 和 M5B-15 验收记录：保留独立范围、Schema migration、旧日志切换、分阶段 rollout/rollback 与实际验收证据；本段不是其替代 Mini-PRD。
- `src/main/db/schema.sql`、`src/main/db/event-batch-migration.ts`：已建立 `applied_event_batch`、`processed_event`、`projector_cursor`、`command_log` 等当前合同和约束；任何新 Schema 仍须独立 R3 批准，不能混入 42+8 的两个 reason CHECK diff。
- `src/shared/types/event-payloads.ts` 及 `src/main/domain/event-batch/record-types.ts`：保留 legacy `ActionLogEntry` / F7 兼容读取和权威 `BATCH_PREPARED/EVENT/BATCH_COMMITTED` 合同，batch/event/payload version 分层校验。
- `src/main/domain/event-batch/{batch-coordinator,segment-store,writer-mutex,file-capability,artifact-publisher,segment-index}.ts`：构成唯一 data-root runtime、file identity、完整写循环、durability、hash chain、segment/index、command fencing、PREPARE/APPLY/CONFIRM 和 capability 边界；本仓库本地模块保持静态 import。
- `src/main/domain/event-batch/{startup-recovery,artifact-recovery,legacy-reader,runtime-corruption}.ts`、`src/main/application/runtime/{application-runtime,m5b-domain-executor}.ts`：在业务 mutation 前建立旧日志兼容、batch recovery、command/cursor 恢复与 corruption gate；完整 legacy EOF 保留并重新建立 durability barrier。
- `src/main/ipc/handler-registry.ts`、`src/main/application/runtime/application-runtime.ts` 与 `src/main/application/runtime/m5b-domain-executor.ts`：维持 IPC 读写分类、production mutation 统一经 durable command 与 v2 batch/gate executor；登录/登出、账号/学生/策略变更和报告导出不得绕过该边界。
- `src/main/domain/event-writer.ts` 仅保留 legacy/planning 兼容角色；production direct `writeEvent()` 和外层事务拼接已由 v2 batch command、已登记 reducer/projector 和 APPLY transaction 取代。业务前置条件在 PREPARE 前检查，并在 APPLY 锁内复核。
- `doc/specs/project-invariants.md` 已为 `INV-EVT-002` 标明 legacy baseline 适用范围，并以 `INV-EVT-004/005/006` 记录 PREPARE durability、整批 APPLY/CONFIRM、batch 原子性、fencing/recovery 与实际证据；`INV-EVT-001/003` 的当前证据不得回退到私有 writer/recovery 路径。
- `doc/specs/xc-career-guide-event-payload-schema-v1.0.0.md`、`doc/specs/baseline.yaml`、`doc/index.md` 已记录当前 record/兼容边界、不变量引用与基线；自动清单只由 docs index 命令更新。
- `scripts/check-m5b-event-batch.mjs`、`scripts/__tests__/m5b-runtime-inventory.test.mjs`、`src/main/domain/event-batch/__tests__/{batch-coordinator,startup-recovery,fault-matrix,fencing,legacy-reader}.test.ts`：覆盖当前 record/stage、迁移/兼容、并发/callsite 与整批业务断言。
- `package.json` 中的 `contract:m5b:event-batch:check` 是已验收 runtime 的精确合同入口；不得进入 postinstall，也不得使用默认运行库。

**当前权威提交与恢复协议：**

```text
resolve canonical data-root runtime -> acquire event-log single-writer lock
  -> assert recovery/corruption gate OPEN and hash-chain/DB cursors aligned
  -> allocate command_id, batch_sequence and all aggregate event_sequence values
  -> write BATCH_PREPARED + all ordered EVENT records -> fsync       [PREPARED / 事实提交点]
  -> BEGIN IMMEDIATE
  -> INSERT applied_event_batch/processed_event -> apply all projectors/reducers -> advance cursor
  -> COMMIT                                                        [APPLIED]
  -> write BATCH_COMMITTED -> fsync -> mark CONFIRMED -> release lock

failure before any PREPARE write -> no fact/no projection; same command may retry
failure after PREPARE starts     -> close mutation gate before releasing lock; never create a replacement batch
next mutation                    -> reject before any DB/file side effect
startupRecovery                  -> same lock -> verify durability/hash/identity/request
                                 -> PREPARED only: one APPLY transaction for the whole batch
                                 -> APPLIED only: write/verify BATCH_COMMITTED and CONFIRM
                                 -> only after cursors/command_log align may gate reopen
```

**历史验收命令（当前 P1-01 不重跑；后续影响 v2 runtime 时必须按届时范围重新执行）：**

```bash
npm test -- src/main/domain/__tests__/event-log-durability.test.ts src/main/domain/__tests__/event-batch-coordinator.test.ts src/main/domain/__tests__/startup-recovery.test.ts src/main/domain/__tests__/event-lock-order.test.ts src/main/ipc/handlers/__tests__/event-write-callsite.test.ts src/main/ipc/handlers/__tests__/mutation-gate-registry.test.ts src/main/ipc/handlers/__tests__/operation-scoring.test.ts src/main/ipc/handlers/__tests__/assessment-ability-scoring.test.ts src/main/ipc/handlers/__tests__/job-skill-scoring.test.ts src/main/ipc/handlers/__tests__/assessment-redline.test.ts src/main/ipc/handlers/__tests__/assessment-start-session.test.ts
npm run typecheck
npm run lint
npm test
npm run build
EVENT_BATCH_ROOT="$(mktemp -d /tmp/svets-event-batch-v22.XXXXXX)"
mkdir -p "$EVENT_BATCH_ROOT/userData/data" "$EVENT_BATCH_ROOT/evidence"
npm run db:sync -- --db "$EVENT_BATCH_ROOT/userData/data/xc-career-guide.db"
npm run db:verify -- --db "$EVENT_BATCH_ROOT/userData/data/xc-career-guide.db"
npm run contract:event-batch:v2.2:check -- --temp-root "$EVENT_BATCH_ROOT" --db "$EVENT_BATCH_ROOT/userData/data/xc-career-guide.db" --user-data-dir "$EVENT_BATCH_ROOT/userData" --evidence-dir "$EVENT_BATCH_ROOT/evidence"
node scripts/check-project-invariants.mjs
npm run docs:index:update
npm run docs:index:check
git diff --check
```

**预期证据：** 独立 R3 PRD/plan/review/accept 四类记录；首次 segment/index 文件及父目录 durability KAT；0-byte/短写/完整写但 fsync 不确定/re-fsync 连续失败与恢复；PREPARE、每个 EVENT、APPLY/reducer/COMMIT、CONFIRM、marker/index 更新故障矩阵；旧 v1/F7-v2 LF/EOF 在 projection 已有/缺失时 bytes/语义一致；同 command 重放幂等、异载 request hash 冲突；9+1 操作评分、BASE_ABILITY/JOB_SKILL 多项评分、结果终结、红线和坐次路径在每个故障点均满足整批 JSONL 事实边界、零部分业务投影或启动后整体恢复；sequence/batch hash 连续；所有 mutation 入口无绕过；并发普通写/startupRecovery/down/activation 锁模拟无反转；版本化事件不变量与新实际证据一致；默认数据文件族前后 hash 不变。

**回滚方式：** 第一条非测试 `BATCH_PREPARED` 写入前，可按独立迁移计划回退应用和新增空 Schema，同时保留所有 legacy reader/gate 修复；一旦任一目标数据源写入 v2.2 batch，只能前滚或回滚到仍完整支持 legacy + v2.2、hash chain、command fencing 和 startupRecovery 的兼容版本，不得展开、重写或删除历史记录。备份只作经批准灾难恢复，不是普通 rollback。

**当前变更停止条件：** 不得重做或合并 Step 2A/2B/2C，不得偏离权威三类 record/hash/恢复协议、放宽现存整批失败合同、回退 legacy LF/EOF/投影兼容、绕过锁或 gate，或为验证而触碰默认库。任何需要改变 v2 runtime、Schema、IPC/CLI mutation 边界或恢复语义的后续工作必须停止本计划，另行进入独立 R3，而不是把 Step 2 写回 `BLOCKED`。

**建议 commit message：** 由独立 R3 实施计划定义；42+8 分支不得把该基础设施伪装成本功能的小改动。

### Step 3：收口 v1.2 组卷合同与 `SESSION_STARTED` v2 冻结快照

**目的与理由：** 消除旧固定题型比例与 v1.2 模块配额冲突，并让创建事件本身携带可独立重放的题目/策略事实，避免 recovery 重新读取可能变化的 `question_bank`。本步骤只冻结 renderer 需求和稳定阻断，不宣称真实 renderer 已可用。

**前置状态：** Step 2A（M4）与 Step 2B（M5A）均为 `ACCEPTED`，Step 2C/M5B-15 为 `PASS`；Step 1 重验与 P1-01 已为 `PASS`，P1-02 已关闭且新的独立计划复审为 `PASS`；Step 1 冻结清单恰好包含 42 道 ONLINE + 8 道 OFFLINE、每个模块 ONLINE 7 道且观察项为 0；50 道入选题和 46 道未选题在所有非测试数据源中仍为 `DRAFT`；`activation_authority_granted = false`。

**完成状态：** 新 `question-policy-v1.2` 策略可在不读取 `question_ratio` 的情况下按 seed 稳定生成相同 42+8；`SESSION_STARTED` payload v2 冻结完整 strategy snapshot、paper seed/集合 hash，以及逐题 ID/version/order/phase/domain/module/type/usage、`content_json`、`scoring_rule_json`、合同 hash、资产 ID/hash 和 renderer requirement key/hash。该事件继续使用 `ActionLogEntry.schema_version = 1`，业务版本只由 payload 内必填 `payload_version = 2` 判定，不占用当前专属于 F7 report 事件的 envelope schema v2。payload-v2 reducer 只使用事件 payload 建立 `assessment_session_question`，不得回查 `question_bank`；payload-v1 历史事件保留原回放分支。冷启动删除业务投影后，仅凭 action log + 基线静态外键数据即可恢复完全相同的 session/question 投影；后续评分读取 payload-v2 创建事件中的冻结合同。缺 renderer 时稳定返回 `QUESTION_RENDERER_UNAVAILABLE` 并保持分阶段门禁 `BLOCKED_RENDERER_IMPLEMENTATION`，不阻断本步骤工程验收；`/vibe-accept step 3` 为 `PASS`。

**不得改变：** 不得原地修改已被引用的 `strategy_config`；不得把 JOB_SPECIFIC、OBSERVATION_ONLY、DRAFT 真实题或未选 46 题作为替补；不得静默降低 42+8 或恢复 14/14/14；不得从 renderer 回传答案/评分；不得为快照新增 Schema 列、直接写投影绕过事件、把 payload version 写入 envelope `schema_version`，或把 Step 5 的真实 renderer 可用性提前声明为通过。

**改动文件及职责：**
- `src/main/domain/paper-generator.ts`：新增明确的 v1.2 分支，按 `online_quota_by_module` 生成每模块 7 题，候选只接受 `BASE_ABILITY + SCORED_ITEM + ACTIVE + authority 选定集合`，线下固定 8 题并保留 seed 可复现；旧 `question_ratio` 仅供已识别历史策略兼容。
- `src/shared/types/event-payloads.ts`：新增带 `payload_version: 2` discriminator 的 `SessionStartedPayloadV2`、`SessionQuestionSnapshotV2`、`SessionStrategySnapshotV2`；保留无 discriminator 的历史 v1 payload 类型，不新增 EventType，也不改变 envelope schema 语义。
- `src/main/domain/assessment-event-contract.ts`：先断言 `SESSION_STARTED` envelope schema 为 1，再按 payload discriminator 解析 v1/v2，复算逐题、策略、资产、renderer 和集合 hash；handler 写前、reducer 应用前、recovery 重放前使用同一 parser，未知 payload version 失败关闭。
- `src/main/domain/assessment-session-snapshot.ts`：构建 v2 payload，并按 `assessment_session.created_event_id` 从 `domain_event_projection` 读取/校验冻结合同，供 Step 4 评分和后续报告使用。
- `src/main/ipc/handlers/assessment.ts`：SQL 显式过滤 `job_code + bank_domain + status + item_usage`，创建 v2 事件前校验 authority 选定集合与策略；真实 renderer 未登记时失败关闭。
- `src/main/domain/assessment-reducer.ts`、`src/main/domain/recovery.ts`：在现有 envelope-schema 路由之后登记 `SESSION_STARTED` payload-v2 分支；payload-v2 逐题投影完全来自事件，payload-v1 历史分支仍按既有逻辑回放，F7 envelope-v2 继续只进入 report reducer。
- `src/shared/types/json-schemas.ts`、`src/main/utils/validate-question-policy.ts`：以 `QuestionPolicyBaseAbility` 校验 v1.2；旧 `QuestionPolicyJson` 只进入显式兼容分支。
- `src/shared/config/base-ability-renderer-requirements-v1.json`：只登记 Step 1 所选交互需要的稳定 renderer key/合同 hash和 `IMPLEMENTED|PENDING_IMPLEMENTATION`；Step 3 不在 renderer 进程实现组件。
- `src/main/domain/__tests__/assessment-session-snapshot.test.ts`、现有 paper-generator/assessment/reducer/recovery/strategy 测试：覆盖 v1/v2 混合重放、保留 FK 静态行但把当前题库语义改写或状态改为 `DISABLED/ARCHIVED` 后 v2 不漂移、payload/hash 篡改失败、renderer pending 阻断和旧策略兼容。

**测试设计：** 纯函数覆盖精确 42+8、每模块 7、重复/不足、seed 重放和域/usage/未选题排除；事件测试通过 Step 2 已验收的 v2.2 coordinator 写含一个 envelope-v1 + payload-v2 EVENT 的 batch，删除 session 业务投影并改变当前题库语义/状态，再证明 startupRecovery 仍恢复相同逐题快照；混合迁移后的 F7 envelope-v2、`SESSION_STARTED` payload-v1/v2 和未知 payload version；生产 assessment handler 在 renderer 仍为 pending 时只验证稳定阻断，不要求 Step 5 的组件提前存在；缺失/重复/hash 错误 payload 在 PREPARE 前和 recovery 中均失败。

**精确验证命令：** `npm test -- src/main/domain/__tests__/paper-generator.test.ts src/main/domain/__tests__/assessment-session-snapshot.test.ts src/main/domain/__tests__/assessment-reducer.test.ts src/main/domain/__tests__/recovery.test.ts src/main/utils/__tests__/validate-question-policy.test.ts src/main/ipc/handlers/__tests__/assessment-create.test.ts src/main/ipc/handlers/__tests__/strategy-create-version.test.ts`；`npm run typecheck`；`git diff --check`。

**预期证据：** envelope/payload 两套版本矩阵、payload-v2 fixture/hash、payload-v1/v2 与 F7 envelope-v2 混合 recovery 对照、同 seed 相同集合、非 BASE/观察项/未选题命中数为 0，以及 `BLOCKED_RENDERER_IMPLEMENTATION` 不被误报为运行就绪。

**回滚方式：** 停止新 session 使用 payload-v2，保留 payload-v1/v2 reader、reducer 和 recovery 兼容；已经写入的 payload-v2 事件不得删除或改写，应用只能回滚到仍识别 payload-v2 且不误路由为 F7 envelope-v2 的兼容版本。

**停止条件：** 只能通过改变旧历史策略、混入 JOB_SPECIFIC、回查当前题库或新增快照列才能复现 session 时停止并重新做 R3 范围审查。

**建议 commit message：** `feat(base-ability): freeze v1.2 session snapshots`

### Step 4：统一线上响应、评分和非计分路径

**目的与理由：** 用冻结 `scoring_rule_json` 替代题型硬编码，保证 0/2、非计分 NULL、support/timing/metrics 和评分快照可复算。

**前置状态：** Step 3 的 `/vibe-accept step 3` 为 `PASS`；`SESSION_STARTED` v2 已能冻结并只读恢复唯一题目/策略/资产/renderer 需求快照；旧 `ANSWER_SUBMITTED` 历史 fixture 和 action log 基线已固化，可用于新旧事件混合回放对照；非测试库仍无 v2 创建事件或新响应事件写入。

**完成状态：** `QUESTION_RESPONSE_SUBMITTED` 与 `QUESTION_RESPONSE_NOT_SCORED` 使用 envelope schema v1 和各自不可变的 `payload_version = 1`，完成 shared payload、validator、Step 2 v2.2 batch coordinator、JSONL 持久化、reducer/projection、startupRecovery 和 command 幂等/冲突测试全链登记；所有线上题只产生 0/2 或 NULL；同一历史混合新旧事件后 answer、进度、终态和 scoring snapshot 可确定重放；`/vibe-accept step 4` 为 `PASS`。

**不得改变：** 不得删除或重解释旧 `ANSWER_SUBMITTED`；不得由 renderer 提交最终分数或读取答案；不得把技术故障、P3 协助或安全停止记为 0；不得让普通 response 自动创建安全 incident；不得直接修改 session 投影或重写历史 JSONL。

**改动文件及职责：**
- `src/shared/types/assessment.ts`、`src/shared/types/event-payloads.ts`、`src/shared/types/json-schemas.ts`：定义统一 response envelope、线上题型 payload、非计分原因和 `scoring_snapshot`。
- `src/main/domain/assessment-event-contract.ts`：扩展 `QUESTION_RESPONSE_SUBMITTED / QUESTION_RESPONSE_NOT_SCORED` 的版本化 validator；写入、投影和恢复共用，拒绝 event type 与 response status 不一致。
- `src/main/ipc/handlers/assessment.ts`：校验题目属于本人 session，只从 `assessment-session-snapshot.ts` 读取冻结合同，向 Step 2 v2.2 coordinator 提交一个 command/单 EVENT batch；不得自行开启外层 DB 写事务或回查当前题库决定答案/规则，重复、终态、越权和错误 shape 均失败。
- `src/main/domain/assessment-reducer.ts`、`src/main/domain/recovery.ts`：登记新响应/非计分事件，旧 `ANSWER_SUBMITTED` 只作为兼容输入，保证幂等、乱序和冷启动重放。
- `src/main/domain/ability-scoring.ts` 或现有评分模块、测试 fixture：实现 EXACT_MATCH 等合同化评分，不把安全停止当错误 0 分。

**测试设计：** 各题型正常/错误/缺字段；`SOFTWARE_TASK`；技术故障、题目不适用、P3 协助、安全停止；重复提交、并发唯一约束；新响应在 PREPARE 前失败可安全重试，PREPARE 后 APPLY/reducer/CONFIRM 故障立即触发 Step 2 gate、紧接写入被拒绝且 startupRecovery 只应用同一 command/batch 一次；旧事件回放与新事件结果一致。

**精确验证命令：** `npm test -- src/main/ipc/handlers/__tests__/assessment-answer.test.ts src/main/domain/__tests__/assessment-event-contract.test.ts src/main/domain/__tests__/assessment-reducer.test.ts src/main/domain/__tests__/assessment-session-snapshot.test.ts src/main/domain/__tests__/event-batch-coordinator.test.ts src/main/domain/__tests__/startup-recovery.test.ts`；`npm run typecheck`；`git diff --check`。

**预期证据：** 每种入选 response shape 的 0/2/NULL fixture、当前题库被改变后仍按冻结规则复算、v1/v2/新响应混合历史重放一致、同 request ID 幂等且不同 payload 冲突。

**回滚方式：** 保留旧 `ANSWER_SUBMITTED` 回放分支；新事件只在新策略/session 中启用，不能删除旧事件识别。

**停止条件：** 无法同时保留旧日志回放、评分快照和新合同，或出现安全事件由普通响应自动创建时停止。

**建议 commit message：** `feat(base-ability): unify response scoring events`

### Step 5：完成线上 renderer、线下评分和 IPC 白名单

**目的与理由：** 让学生能操作所有获选线上交互，让教师按审核锚点评 8 道线下题，并确保 renderer 只经 preload 访问主进程。

**前置状态：** Step 4 的 `/vibe-accept step 4` 为 `PASS`；入选 42 道线上题的 `question_type + interaction_type` 精确集合已经冻结；主进程 response/评分合同可在无 renderer 的测试中独立通过；8 道线下 rubric 与教具合同 hash 已可供只读绑定。

**完成状态：** Step 1 入选交互全部命中显式 renderer registry，registry hash 与 v2 session snapshot 一致，合法/非法 shape、触控和键盘替代路径均有证据；8 道线下题只允许教师按当前 rubric hash 写 `OFFLINE_ABILITY`，同一提交请求的 N 条评分 EVENT 使用一个 Step 2 batch 和一次 APPLY，保持现有任一项失败时整批零投影合同；新增/修改 IPC 已同步中央 handler registry、preload、shared type、权限、错误映射和负向测试；构建产物在实际断言的 `1366x768 / 1280x720 / 375x812` content viewport 下完成主交互、键盘替代、技术异常和终态切换检查，无重叠/溢出；分阶段门禁的 renderer 项由 `BLOCKED_RENDERER_IMPLEMENTATION` 变为 `PASSED`，但仍不表示人工审核或技术演练就绪；`/vibe-accept step 5` 为 `PASS`。

**不得改变：** 不得实现未入选交互、在 renderer 暴露答案/评分规则、绕过 preload 访问 Node/数据库、把 `OFFLINE_ABILITY` 混入 `TASK_OPERATION`，或因组件异常推进题目/会话状态；不得激活真实题目。

**改动文件及职责：**
- `src/renderer/src/components/questions/registry.ts`、按入选 interaction 拆分的组件、`src/renderer/src/views/student/AssessmentView.vue`、`src/renderer/src/stores/assessment.ts`：按 `question_type + interaction_type` 显式选择 renderer，未知 key 不得落入 DRAG 兜底；支持键盘/触控/AAC 替代、求助、技术异常和安全状态。现有 assessment route 复用，不新增路由；若实现发现必须新增路由，再补 router/guard/navigation/deep-link 登记并重审副作用。
- `src/shared/config/base-ability-renderer-requirements-v1.json`、`src/shared/types/assessment.ts`：把已实现 renderer 状态和 registry hash 写实，供主进程创建前校验；renderer 不携带答案或评分规则。
- `src/main/ipc/handlers/ability-scoring.ts`：验证 TEACHER/ADMIN、session/题集归属、rubric 版本、重复评分和 `OFFLINE_ABILITY` scope；把同一 IPC 请求的全部评分构造成一个 command batch，不直接循环调用低层 writer。
- `src/shared/types/ipc-api.ts`、`src/preload/index.ts`：登记现有或新增通道、参数和错误映射。
- `src/renderer/src/components/questions/__tests__/renderer-registry.test.ts`、`src/main/ipc/handlers/__tests__/assessment-ability-scoring.test.ts`：覆盖 registry 全量命中、未知交互、部分补交、重复、权限和回滚。
- `scripts/lib/pilot-path-guard.mjs`：在最早需要 Electron/数据库 E2E 的本步骤建立共享守卫。从平台、home、`package.json` 和 Step 2 已验收的 production runtime layout descriptor 独立推导默认 userData/事件文件树，不接受 CLI/env 覆盖安全基准；在打开目标库前校验四个显式路径的 canonical containment、DB 与 userData 配对、仓库目录和符号链接，并在文件存在后以 device/inode 拒绝默认库硬链接。对递归树每个 entry 使用 `lstat/realpath` 拒绝 symlink、越界和与显式临时根相同 file identity；运行前后比较默认主 DB、`-wal`、`-shm`、legacy `action_log.jsonl`、active/archived segment tree、`segment_index.json`、batch recovery/corruption metadata，以及 `pilot-authorization/**` 的全部相对路径、类型、存在状态、size 和 SHA-256；新增、修改、删除或类型变化都失败。实际目录名以 Step 2 重基线后的 runtime contract 为准，Step 5 开始前必须把占位名替换为真实路径。
- `scripts/e2e/base-ability-42plus8-renderers.mjs`：必须同时接收 `--temp-root / --db / --user-data-dir / --evidence-dir`，复用共享守卫并断言 `db === <userData>/data/xc-career-guide.db`；在已 `db:sync/db:verify` 的显式临时库和构建产物上遍历三个 viewport，先断言 `window.innerWidth/innerHeight`，再检查页面错误、横纵向 overflow、关键控件 bounding box、键盘焦点/替代路径和状态切换，并输出截图与 JSON 摘要。
- `scripts/__tests__/pilot-path-guard.test.mjs`、`scripts/__tests__/base-ability-42plus8-renderer-e2e-contract.test.mjs`、`package.json`：覆盖任一缺参、默认库或其不存在路径别名、仓库路径、软/硬链接、DB 与 userData 不配对；分别新增、修改、删除默认 DB/WAL/SHM、legacy log、active segment、archived segment、segment index、recovery/corruption metadata 和授权原件树，renderer E2E 均必须非 0；新增 `e2e:base-ability:renderers` 精确入口。

**精确验证命令：**

```bash
npm test -- src/renderer/src/components/questions/__tests__/renderer-registry.test.ts src/main/ipc/handlers/__tests__/assessment-ability-scoring.test.ts src/main/ipc/handlers/__tests__/assessment-answer.test.ts scripts/__tests__/base-ability-42plus8-renderer-e2e-contract.test.mjs
npm run lint
npm run typecheck
npm run build
RENDERER_E2E_ROOT="$(mktemp -d /tmp/svets-base-ability-renderers.XXXXXX)"
mkdir -p "$RENDERER_E2E_ROOT/userData/data"
npm run db:sync -- --db "$RENDERER_E2E_ROOT/userData/data/xc-career-guide.db"
npm run db:verify -- --db "$RENDERER_E2E_ROOT/userData/data/xc-career-guide.db"
npm run e2e:base-ability:renderers -- --temp-root "$RENDERER_E2E_ROOT" --db "$RENDERER_E2E_ROOT/userData/data/xc-career-guide.db" --user-data-dir "$RENDERER_E2E_ROOT/userData" --evidence-dir "$RENDERER_E2E_ROOT/evidence"
git diff --check
```

**预期证据：** `$RENDERER_E2E_ROOT/evidence/summary.json` 明列三个实际 content viewport、每种入选 renderer、键盘/触控路径、overflow/bounding-box 断言与截图路径；`default-data-before.json/default-data-after.json` 证明默认数据文件族逐项不变；任何 renderer 未命中、页面错误或路径保护失败使命令非 0。

**回滚方式：** 按题型逐步启用新 renderer；保留现有 assessment route 和旧事件消费路径。

**停止条件：** renderer 绕过 preload、学生可见答案/评分规则、或安全/终态切换发生重叠时停止。

**建议 commit message：** `feat(base-ability): register pilot renderers`

### Step 6：建立授权生命周期底座、写边界与受限 reason migration

**目的与理由：** 在技术演练之前，将产品批准、学校授权和逐学生同意收口为同一套可验证、有限期、可撤销/轮换、可持久化水位的授权决策服务；所有真实 session 写边界共用它，并能在失效后事件化终止或永久隔离。Step 10 只装配生产固定根和激活入口，不再实现本步骤的通用合同或生命周期。

**前置状态：** Step 5 的 `/vibe-accept step 5` 为 `PASS`；Step 2A（M4）与 Step 2B（M5A）已 `ACCEPTED`、Step 2C/M5B-15 为 `PASS`，P1-01 已关闭，且 P1-02 和新的独立计划复审均可核对为 `PASS`；当前已知默认运行库的 migration/Schema/账号/题库漂移已由单独、获授权的运维任务核实，并有 `npm run db:verify` 退出码 0 的证据，否则本 Step 为 `BLOCKED`；所有非测试数据库和 JSONL 均尚未写入两个新 reason 或两个授权事件；迁移前数据库文件族和 event-log/index 的存在状态/hash 已记录。自动测试只使用显式临时库，不得为满足此前置条件自动修复默认库。

**完成状态：**

- 通用 JSON Schema/type/validator 覆盖产品根、批准人/学校登记、责任清单、激活批准、学校课堂授权、逐学生同意、三类生命周期事件/索引和分离签名；统一派生 `PENDING / ACTIVE / EXPIRED / REVOKED / SUPERSEDED / INVALID`，强制产品根 365 天、登记 90 天、责任清单/激活批准 30 天、课堂授权/同意 14 天以及下游不晚于上游。
- 显式 data root 下建立内容寻址、不可覆盖的授权原件库：ADMIN 只能经主进程文件选择器导入，导入先完成 canonical bytes/hash、Schema、签名、scope、期限、主体、revision/前序 hash 和权限检查，再以临时文件 + fsync + 原子 rename 写入 hash 路径；重复同 bytes 幂等，已存在 hash 不得覆盖，不保存私钥或原始学生证据。运行时从全部已验证索引的连续链和最高有效 revision 推导 current，不信任文件名、mtime、调用者路径或可写 pointer。
- 产品索引 24 小时、学校/同意索引 4 小时最大租约，revision/前序 hash、UTC 水位、撤销/替代/泄漏、稳定 `invalidation_fact_id` 和最早失效事实均可复算；最高已见 revision 和最近成功校验 UTC 在业务写入前以只减权方式原子持久化，重启后回退/断链/时钟回拨失败关闭。
- `initDatabase()` 完成权威 v2.2 `startupRecovery` 并确认全局 mutation gate 开放后，主进程必须先初始化授权原件库和运行时，再执行 `scanPilotAuthorizationInvalidations()`，成功后才调用 `registerIpcHandlers(runtime)` 和创建窗口。生产根尚未由 Step 10 装配且库中无 Pilot 事实时，普通功能可启动但所有 Pilot 导入/写入稳定返回 `PILOT_TRUST_ANCHOR_UNAVAILABLE`；若已有 Pilot 事件、授权水位或开放 Pilot session 而原件/根不可验证，则在注册业务 IPC 前失败关闭。
- session 创建、grant/assignment 创建、学生确认、坐次开始/恢复、线上响应、线下评分和完成均通过同一 `withPilotAuthorizationDecision()` 写边界和已验收的 v2.2 batch coordinator，以同一 UTC 决策时间验证产品/学校/个人三条链；授权 revision 在 PREPARE 前变化时回滚。Pilot 新建 session 使用 envelope schema v1 + `SESSION_STARTED.payload_version = 3`：完整保留 Step 3 的 payload-v2 内容快照，并追加三条授权链的 ID/hash/revision/派生状态/effective/expires 与 `verified_at`。已经写入的 payload v2 合同不可增字段或改义，仍可读取/恢复，但真实 Pilot 创建必须写 v3。
- `STUDENT_CONSENT_WITHDRAWAL_REPORTED` 和 `PILOT_AUTHORITY_PROVENANCE_REVIEW_REQUIRED` 完成 EventType、payload parser、JSONL、SQLite projection、reducer/recovery、幂等/冲突和写门禁全链；开放 session 的 `SITTING_ENDED -> SESSION_ABORTED -> ASSIGNMENT_RELEASED/grant release` 必须作为同一 command 的一个 v2.2 batch 原子 PREPARE/APPLY/CONFIRM，运行区间重叠的终态隔离事件也在该 batch 内，红线并发仍保持 `REDLINE_HALTED`。
- ADMIN 授权导入和 TEACHER 学生同意撤回都有完整 renderer -> preload -> trusted IPC -> domain -> event/recovery 路径；请求不携带 caller 身份、根、任意文件路径或客户端决策时间。导入到更严格/更新的有效失效事实时，先不可变持久化原件并收紧水位，再阻断 Pilot 写并事件化应用失效；DB 应用失败保持阻断，下一次启动扫描继续同一事实，不回退原件或水位。
- 本步骤自己的 Schema diff 只扩展两个已批准 CHECK 值；Step 2 v2.2 基线的 Schema 不在本步骤重复实现或回滚。down 联合预检从目标 DB/data root 可证明推导当前 active segment/index 与全部相关归档，核对 projection/snapshot metadata 的 canonical path/file identity。尚无新 reason/授权事件时可按 v2.2 唯一锁序事务化 down；存在 recovery/corruption gate、任一相关事实、配对歧义、诱饵日志、软/硬链接或元数据不一致时在任何 DDL/日志写入前拒绝，数据库文件族与全部相关 JSONL/index hash 不变。`/vibe-accept step 6` 为 `PASS`。

**不得改变：** 不得新增表、列、授权状态枚举、assessment 状态或第二套 session/assignment；不得把水位缓存当成授权原件或允许其降低 revision/UTC；不得接受 caller 自报身份、客户端时间、运行时根或 ADMIN 自签授权；不得直接 UPDATE session 受控状态；不得映射、删除或降格新 reason/事件以回到旧 CHECK/旧二进制；不得覆盖安全终态或历史 bytes；本步骤不得加入真实产品根、公钥、批准原件、私钥或真实学生数据。

**改动文件及职责：**

- `src/shared/types/pilot-authorization.ts`：定义签发件、分离签名信封、生命周期事件/索引、派生状态、授权决策/session snapshot、稳定主体映射、失效事实和错误码。
- `doc/features/base-ability-pilot-authorization/base-ability-pilot-authorization-contracts-v1.schema.json`、`doc/features/base-ability-pilot-authorization/README.md`：以 discriminator `$defs` 固定文件布局、canonical UTF-8 bytes、最大期限、上下游约束和私钥/敏感数据边界；这里只定义合同，不包含真实原件。
- `src/main/domain/pilot-authorization-contract.ts`：解析 Schema、canonical bytes/hash、Ed25519 分离签名、scope/上下游绑定和期限边界；信任根由 composition root 显式提供，生产根留到 Step 10。
- `src/main/domain/pilot-authorization-lifecycle.ts`：派生状态、revision/链/租约、撤销/替代/泄漏、稳定 `invalidation_fact_id`、多原因最早失效和晚到失效矩阵。
- `src/main/domain/pilot-authorization-artifact-store.ts`、`src/main/domain/pilot-authorization-import-service.ts`：在显式 data root 下实现 `pilot-authorization/artifacts/sha256/<hash>.json` 不可变原件库和可信导入；目录/文件分别按最小权限创建，写入使用同目录临时文件、fsync、原子 rename，拒绝覆盖、链接、权限过宽、private-key 字段和原始敏感附件。current 由验证后的索引连续链推导；本地缓存可删除重建且不具授权权威。
- `src/main/domain/pilot-authorization-state-store.ts`：维护 `pilot-authorization-watermark-v1.json`；使用同目录临时文件、fsync、原子 rename 和进程互斥，只允许 revision/UTC 单调增加。损坏、缺失但已有 Pilot 事实、回退或并发 generation 变化均失败关闭；不保存授权原件、私钥或学生原始证据。
- `src/main/domain/pilot-authorization-runtime.ts`：从不可变原件库加载并验证产品/学校/个人当前链，组合 watermark generation、决策服务与失效扫描；生产根不可用时只允许明确的 Pilot-disabled 状态，测试 composition 可注入临时根但不得进入生产构造路径。
- `src/main/domain/pilot-session-authorization.ts`：实现 `withPilotAuthorizationDecision()`；先在授权锁内校验签名/索引并持久化只减权水位，再开启业务 DB transaction，在提交前复核 state generation/revision，变化则回滚。启动扫描和下一业务动作共用该服务。
- `src/main/domain/pilot-authorization-invalidation.ts`：按失效时间矩阵追加 sitting/session/assignment/grant 事件，并对终态追加来源隔离；安全检查先于普通授权终止。
- `src/shared/types/event-payloads.ts`、`src/main/domain/assessment-event-contract.ts`、已验收的 v2.2 batch coordinator/projector、`src/main/domain/assessment-reducer.ts`、`src/main/domain/assignment-reducer.ts`、`src/main/domain/recovery.ts`、`doc/specs/xc-career-guide-event-payload-schema-v1.0.0.md`：登记两个授权事件、稳定 abort/end/release payload 和 `SESSION_STARTED` payload-v3。v2/v3 都使用 envelope schema v1 并各自不可变；授权失效产生的 sitting/session/assignment/grant 多事件由一个 `BATCH_PREPARED` 包含全部有序 `EVENT`，一次 APPLY transaction 整体投影，再写 `BATCH_COMMITTED`。recovery 先按权威 batch record、再按 envelope、最后按 payload discriminator 分支，F7 envelope-v2 仍只处理 report。`PILOT_AUTHORITY_PROVENANCE_REVIEW_REQUIRED` 从事件投影派生，result/report/evidence 写门禁查询该事实，不新增隔离列。
- `src/main/index.ts`、`src/main/ipc/index.ts`：固定 `initDatabase -> initializePilotAuthorizationRuntime -> scanPilotAuthorizationInvalidations -> registerIpcHandlers(runtime) -> createWindow` 启动顺序；运行时依赖显式传入 handler，禁止 handler 自行从默认路径加载另一份授权状态。
- `src/main/ipc/handlers/pilot-authorization.ts`、`src/shared/types/ipc-api.ts`、`src/preload/index.ts`：提供 ADMIN 导入/状态查询和 TEACHER 同意撤回白名单；导入由主进程打开文件选择器并只传内部 handle，sender 的 ACTIVE auth session 决定执行身份，请求正文不接收任意路径、caller 身份或根。
- `src/renderer/src/views/admin/PilotAuthorizationView.vue`、`src/renderer/src/views/admin/AdminLayout.vue`、`src/renderer/src/router/index.ts`：新增 `/admin/pilot-authorization` 管理入口，显示可信派生状态、原件 hash/revision 和稳定错误，不展示/编辑签名 bytes，不允许页面直接激活题目；补齐 ADMIN route guard、导航和 deep-link 测试。
- `src/renderer/src/views/teacher/StudentFormView.vue`：在现有学生详情页显示同意状态并提供明确的“撤回同意”确认动作；只允许 TEACHER 对当前学生执行只减权撤回，撤回后立即刷新 session/assignment 状态且不得提供恢复同意或代签入口。
- `src/main/ipc/handlers/assessment.ts`、`src/main/ipc/handlers/ability-scoring.ts`、`src/main/ipc/handlers/assignment.ts`、auth context：从 sender 绑定的 ACTIVE auth session 解析身份；所有列明写边界调用同一授权服务，ADMIN 不得自授。
- `src/main/db/base-ability-authorization-reason-migration.ts`、`src/main/db/schema.sql`、`src/main/db/migrations.ts`：只扩展 `assessment_sitting.end_reason = ENDED_BY_AUTHORIZATION_INVALIDATION` 和 `business_session_assignment.release_reason = AUTHORIZATION_INVALIDATED`；表重建必须捕获并恢复全部索引、trigger、FK 与行，结构检查和 migration ledger 同步更新。
- `src/main/cli/base-ability-authorization-migration.ts`：复用 v2.2 runtime 的同一个 segment/index lock、mutation/corruption gate 和 coordinator ownership。down 只接收 `--data-root / --db / --backup-dir`，从配对 data root/DB metadata 推导 active segment/index 与相关归档；先按唯一顺序取得真实 log 锁，再拒绝 recovery-required、锁内校验 canonical identity、完成只读联合扫描和一致备份，最后才允许 `BEGIN IMMEDIATE`/DDL。不得接受独立 `--action-log`，也不得在持 DB 锁后等待 log 锁；真实 down 不属于自动验收。
- `src/main/domain/__tests__/pilot-authorization-contract.test.ts`、`src/main/domain/__tests__/pilot-authorization-artifact-store.test.ts`、`src/main/domain/__tests__/pilot-authorization-import-service.test.ts`、`src/main/domain/__tests__/pilot-authorization-lifecycle.test.ts`、`src/main/domain/__tests__/pilot-authorization-state-store.test.ts`、`src/main/domain/__tests__/pilot-authorization-startup.test.ts`：使用临时 Ed25519 根和合成主体，覆盖期限、不可变原件、索引发现、水位重启/回退、导入中断恢复、无根/损坏原件启动和 IPC 前失效扫描。
- `src/main/domain/__tests__/pilot-authorization-invalidation-batch.test.ts`：对同一 `invalidation_fact_id/command_id` 断言 sitting/session/assignment/grant/隔离事件的顺序、一个 batch、一次 APPLY、幂等 fencing，以及 PREPARE/APPLY/CONFIRM 各故障点的启动恢复。
- `src/main/ipc/handlers/__tests__/pilot-session-authorization.test.ts`、`src/main/ipc/handlers/__tests__/pilot-authorization.test.ts`、renderer 路由/视图测试：覆盖每个写边界、可信 sender、ADMIN 导入、TEACHER 撤回、伪造路径/身份、个人撤回和晚到失效。
- `src/main/db/__tests__/base-ability-authorization-reason-migration.test.ts`、现有 migration/assignment/safety/recovery tests：覆盖旧库前滚、索引/trigger/FK/数据保持、联合预检允许 down、每一种 DB/SQLite projection/active JSONL/归档阻断来源、干净诱饵日志、metadata 路径歧义、软/硬链接、检查与写入竞争、拒绝前后文件族 hash、红线优先，以及 F7 envelope-v2 与 `SESSION_STARTED` payload-v1/v2/v3 的兼容重放。
- `package.json`：新增只要求显式路径的 `db:base-ability:authz:down`；该命令不得出现在 build/test/postinstall 生命周期脚本中。

**核心流程：**

```text
应用启动
  -> initDatabase（schema + v2.2 startupRecovery；mutation/corruption gate 必须 OPEN）
  -> initializePilotAuthorizationRuntime（不可变原件 + current 链 + 水位）
  -> scanPilotAuthorizationInvalidations（补写/恢复所有只减权事实）
  -> registerIpcHandlers(runtime) -> createWindow

ADMIN 导入授权材料
  -> 主进程文件选择器产生进程内 handle
  -> canonical/hash/schema/signature/scope/revision/权限预检
  -> 内容寻址原件原子落盘 -> 收紧水位并提升 generation
  -> 阻断 Pilot 写 -> 事件化应用失效；失败由下次启动继续

业务写请求
  -> 可信 sender/CLI auth context
  -> 取得授权 state lock，验证签名、scope、revision、租约、UTC
  -> 原子持久化 max(revision/verified_at) 水位（只会收紧）
  -> 在仍持授权锁时进入 v2.2 batch coordinator
  -> action-log/segment lock -> 复核授权 state generation 与统一 decision time
  -> PREPARE 一个 command batch（单事件或有序多事件）并 fsync
  -> BEGIN IMMEDIATE -> APPLY 全部 projection/reducer -> COMMIT
  -> CONFIRM 并 fsync
  -> 依次释放 action-log lock、授权 state lock

检测失效
  -> 先判断真实安全红线
  -> SITTING_ENDED(ENDED_BY_AUTHORIZATION_INVALIDATION)
  -> SESSION_ABORTED + ASSIGNMENT_RELEASED(AUTHORIZATION_INVALIDATED)
  -> 终态区间重叠时追加 PILOT_AUTHORITY_PROVENANCE_REVIEW_REQUIRED
```

**数据、事务与失败恢复：** 全局顺序固定为 `authorization state lock（仅 Pilot 路径） -> v2.2 action-log/segment lock -> BEGIN IMMEDIATE`；导入、业务写、失效扫描和 activation 都不得反向获取。授权原件和水位先于业务 DB 失效投影持久化，二者都只会收紧权限；DB APPLY 回滚不会使旧授权重新有效。完整失效 batch 在 PREPARE 后任一失败同时保持 Pilot blocked 和全局 recovery gate，紧接的所有 mutation 被拒绝；下一次启动在业务 IPC 注册前按相同 `batch_id/command_id/invalidation_fact_id` 完成权威 `startupRecovery`，不得补造另一批。PREPARE 前发现 generation 变化必须回滚重验；PREPARE 后按 command fencing 恢复同一请求。原件、水位或 current 链损坏时禁止 Pilot 写；已有 Pilot 事实时禁止开放业务 IPC。migration down 不修改 action log，只在 recovery/corruption gate OPEN、锁住实际 active segment/index、证明所有 metadata/归档配对且联合预检无相关事实后重建 DB；调用者提供的干净旁路日志不能影响判断。

**精确验证命令：**

```bash
npm test -- src/main/domain/__tests__/pilot-authorization-contract.test.ts src/main/domain/__tests__/pilot-authorization-artifact-store.test.ts src/main/domain/__tests__/pilot-authorization-import-service.test.ts src/main/domain/__tests__/pilot-authorization-lifecycle.test.ts src/main/domain/__tests__/pilot-authorization-state-store.test.ts src/main/domain/__tests__/pilot-authorization-startup.test.ts src/main/domain/__tests__/pilot-authorization-invalidation-batch.test.ts src/main/domain/__tests__/event-lock-order.test.ts src/main/db/__tests__/base-ability-authorization-reason-migration.test.ts src/main/db/__tests__/migrations.test.ts src/main/ipc/handlers/__tests__/pilot-session-authorization.test.ts src/main/ipc/handlers/__tests__/pilot-authorization.test.ts src/main/ipc/handlers/__tests__/assignment.test.ts src/main/ipc/handlers/__tests__/assessment-redline.test.ts src/main/domain/__tests__/recovery.test.ts
npm run typecheck
npm run lint
AUTH_MIGRATION_ROOT="$(mktemp -d /tmp/svets-base-ability-authz-migration.XXXXXX)"
mkdir -p "$AUTH_MIGRATION_ROOT/userData/data" "$AUTH_MIGRATION_ROOT/backups" "$AUTH_MIGRATION_ROOT/evidence"
npm run db:sync -- --db "$AUTH_MIGRATION_ROOT/userData/data/xc-career-guide.db"
npm run db:verify -- --db "$AUTH_MIGRATION_ROOT/userData/data/xc-career-guide.db"
npm run docs:index:update
npm run docs:index:check
git diff --check
```

`db:base-ability:authz:down -- --data-root "$AUTH_MIGRATION_ROOT/userData/data" --db "$AUTH_MIGRATION_ROOT/userData/data/xc-career-guide.db" --backup-dir "$AUTH_MIGRATION_ROOT/backups"` 的允许/拒绝、真实 active/归档日志命中和诱饵日志负例由定向测试在临时副本执行；本 Step 的自动命令不得对默认库运行真实 down。默认运行库只有在另行获授权运维完成后才执行只读 `npm run db:verify` 并保存证据。

**预期证据：** Step 2 v2.2 R3 验收记录和本计划重审 `PASS`；原件 hash/权限/不可覆盖和 current 索引发现矩阵；导入中断后启动续扫；无根但无 Pilot 事实的 disabled 启动与已有事实的 fail-closed 启动；表驱动期限/状态/写边界矩阵；重启后水位不回退；envelope-v1 + payload-v3 session 授权快照及 v1/v2/v3/F7 混合重放；ADMIN 导入和 TEACHER 撤回 UI/IPC 负向证据；撤回/失效多事件 batch 在 PREPARE/APPLY/CONFIRM 各故障点即时全局拒写并于启动整体恢复；授权/log/DB 唯一锁序并发无死锁；migration 前后结构/行/trigger 对照，以及允许 down 与由 recovery gate、DB、projection、真实/归档 JSONL/index、诱饵/别名造成拒绝时的完整文件族 hash 证明。

**回滚方式：** 新 reason 和两个授权事件尚未进入目标 DB/真实或归档 JSONL 时，才可在显式备份和联合预检后受控 down；不可变授权原件和水位不因代码回退而删除或降低。一旦存在任一相关事实，禁止降回旧 CHECK 或旧应用，只能部署仍识别新旧 reason/事件及 `SESSION_STARTED` payload-v1/v2/v3 的 expand-only 兼容版本。

**停止条件：** Step 2 v2.2 验收或本计划重审未通过；本步骤自身需要在两个 reason CHECK 之外新增表/列/状态机；无法在既有 v2.2 基线和批准范围内可靠持久化原件/水位；只能靠可写 current pointer；需要修改 payload-v2 语义；依赖 caller 自报身份/任意路径；无法在业务 IPC 前扫描失效；无法证明 DB 与实际 segment/index/归档配对；或无法证明失效时间关系时停止并重审 PRD。

**建议 commit message：** `feat(base-ability): enforce pilot authorization lifecycle`

### Step 7：接通 ABILITY_SCORE、Pilot 报告和证据隔离

**目的与理由：** 使 42 道线上 + 8 道线下的能力分数独立可解释，同时保留 Pilot 限制和授权失效后的永久隔离。

**前置状态：** Step 6 的 `/vibe-accept step 6` 为 `PASS`；新旧 reason/事件可由兼容 reducer/recovery 确定重放；完整、非计分、红线、授权失效和晚到失效 session fixture 均已固定；报告生成仍以现有 `report_content_json` 合同为输入。

**完成状态：** 每个进入终态的 BASE_ABILITY session 都生成独立 `ABILITY_SCORE`：正常完成必须恰有 42 道有效线上响应 + 8 道有效线下评分，`max_score = 100`、`completion_ratio = 1`，才允许形成“完整能力结论”；崩溃兜底、安全红线、作废、NR/ST、技术中断、授权失效等非正常终态仍持久化 `max_score = 100` 的过程结果、实际 `completion_ratio` 和稳定 `incomplete_reason`。未答/未形成有效分数的 scored item 在聚合 raw/module 分子中按 0 占位，但 item-level `score` 保持 `NULL`，不得回写为 0；OBSERVATION_ONLY 不进分母。红线等级固定 `LEVEL_FAIL_BY_SAFETY`，崩溃兜底固定 `LEVEL_NOT_COMPETENT`，不被过程分覆盖。过程结果不得进入安置、完整测评趋势或普通完整结论；来源待复核结果保留追加式记录但默认隔离。报告固定呈现 `PILOT_ONLY`、完成率、支持/非计分、`incomplete_reason` 和“过程分”限制，历史报告 bytes 可复现；`/vibe-accept step 7` 为 `PASS`。

**不得改变：** 不得把 `ABILITY_SCORE` 与其他结果混算，不得让普通分数覆盖安全语义，不得把 item-level NULL 变成 0，也不得因部分完成缩小 `max_score` 或模块固定分母；不得把过程结果伪装为完整结果或完全丢弃；不得修改历史 result/report bytes，不得输出正式诊断、正式量表、placement advice 或把课堂证据缺失反向阻断首次 Pilot 激活评审。

**改动文件及职责：**
- `src/main/ipc/handlers/assessment.ts`、result reducer/projector：所有 BASE_ABILITY 终态都生成 `ABILITY_SCORE`；正常完成和异常过程结果走显式分支。聚合器固定 50 题/100 分与模块线上分母 14，区分 `item.score = NULL` 和聚合占位 0，持久化 `completion_ratio/incomplete_reason`；安全等级由终止原因覆盖，授权来源待复核只追加隔离事实。
- `src/main/ipc/handlers/results.ts`：读取时执行来源隔离与 scope 校验；已隔离 result 不得由普通列表/详情入口重新暴露为有效证据。
- `src/main/domain/report-contract.ts`、`src/main/ipc/handlers/reports.ts`、报告 Vue 组件：呈现 `PILOT_ONLY`、完成率、支持/非计分限制和 evidence provenance，不输出正式诊断或 placement advice。
- `scripts/e2e/report-flow.mjs`、`scripts/__tests__/report-flow-contract.test.mjs`：改为强制接收 `--temp-root / --db / --user-data-dir / --evidence-dir`，复用 Step 5 的 `pilot-path-guard`，只在已同步/验证的配对临时库中造数；三个实际 content viewport、导出/锁定/历史报告与完整默认数据 manifest 前后对照均进入证据。测试分别新增、修改、删除默认 active/archive segment 和 segment index 时必须非 0，不能只检查 legacy action log。
- `src/main/domain/__tests__/report-contract.test.ts`、report generation/assessment scoring tests、`src/main/ipc/handlers/__tests__/results.test.ts`：覆盖完整、每一种异常终止、部分完成、item NULL/聚合 0、固定 max/module 分母、红线/崩溃等级、安全优先、授权隔离、读取门禁和历史报告复现。

**精确验证命令：**

```bash
npm test -- src/main/domain/__tests__/report-contract.test.ts src/main/domain/__tests__/report-generation.test.ts src/main/ipc/handlers/__tests__/assessment-ability-scoring.test.ts src/main/ipc/handlers/__tests__/results.test.ts scripts/__tests__/report-flow-contract.test.mjs
npm run typecheck
npm run build
REPORT_E2E_ROOT="$(mktemp -d /tmp/svets-base-ability-report.XXXXXX)"
mkdir -p "$REPORT_E2E_ROOT/userData/data"
npm run db:sync -- --db "$REPORT_E2E_ROOT/userData/data/xc-career-guide.db"
npm run db:verify -- --db "$REPORT_E2E_ROOT/userData/data/xc-career-guide.db"
npm run e2e:report -- --temp-root "$REPORT_E2E_ROOT" --db "$REPORT_E2E_ROOT/userData/data/xc-career-guide.db" --user-data-dir "$REPORT_E2E_ROOT/userData" --evidence-dir "$REPORT_E2E_ROOT/evidence"
git diff --check
```

**预期证据：** 完整、崩溃、红线、作废、NR/ST、技术中断、授权失效和晚到隔离 fixture 的 result/report 对照；异常路径均有 `ABILITY_SCORE(max_score=100, completion_ratio, incomplete_reason)`，item NULL 与聚合 0 同时成立，红线/崩溃等级固定；历史报告 bytes/hash 不变，`PILOT_ONLY`、过程分与 placement/trend 禁用断言成立；报告 E2E 的默认数据文件族前后逐项相同。

**回滚方式：** 新报告 schema/version 与旧报告读取兼容并行；不得修改历史 report bytes。

**停止条件：** 结果混算、异常终态不生成过程结果、item NULL 被持久化为 0、分母随完成量缩小、安全等级被分数覆盖，或报告将过程/Pilot 语言升级为完整正式结论时停止。

**建议 commit message：** `feat(base-ability): project pilot ability reports`

### Step 8：建立人工审核包、资产/教具 manifest 与内容门禁

**目的与理由：** 让内容、测评、安全/康复/特教/无障碍审核结果成为机器可校验的前置条件，且审核入口不具备激活权限。

**前置状态：** Step 7 的 `/vibe-accept step 7` 为 `PASS`；Step 1 冻结的 50 题及其逐题内容/评分/renderer hash 未漂移；所有非测试数据源仍为 96 道 DRAFT、0 道 ACTIVE；旧 `base-ability-42plus8-activation-gate-v1.json` 只作为不可覆盖的历史单阶段快照。审核人尚未提供时可以实现生成/导入工具，但本 Step 不得完成，也不得进入 Step 9。

**完成状态：** 两轨自包含 HTML 均可离线填写、逐题自动保存、提交前必填校验并导出严格 JSON；严格结果 Schema、两份只读审核 JSON、合并审核门禁、视觉资产 manifest 和 8 题教具 manifest 均通过。JSON 是机器权威；可选 Markdown 只能由已校验 JSON 生成供留档，不能反向导入。每个必需轨道都有当前 hash 的人工结论，任一退回/缺失均失败关闭；分阶段门禁产物进入 `READY_FOR_TECHNICAL_REHEARSAL`，`activation_authority_granted = false`，课堂试测证据仍为 `PENDING/NOT_RUN`，50+46 题仍为 DRAFT；`/vibe-accept step 8` 为 `PASS`。外部审核原件缺失时工程工具可记 `PASS`，但 Step 8 总状态必须为 `BLOCKED`。

**不得改变：** 审核 HTML、结果导入和 gate build 均不得写运行库或执行激活；不得把 Markdown 当机器权威；不得覆盖审核原件、v1 门禁、无关资产及其 hash；不得提交私钥、学生身份、健康信息或原始观察数据；缺专业责任人时不得把人工门写成通过。

**改动文件及职责：**
- `scripts/build-base-ability-42plus8-review-packets.mjs`、`scripts/lib/base-ability-42plus8-review.mjs`：确定性生成两轨审核包和结果 Schema；支持 `--check`，不得读取或写入运行库。
- `scripts/ingest-base-ability-42plus8-review-results.mjs`：默认 build 模式只读校验两份审核原件，复算 reviewer、题目集合、逐题 hash、必需轨道和汇总后原子写合并门禁；`--check` 只比较预期 bytes，不写任何文件。两种模式均不得覆盖输入原件，缺原件均返回稳定 `BLOCKED_REVIEW_RESULT_MISSING`。
- `doc/features/base-ability-42plus8-content-assessment-review-packet-v1.html`、`doc/features/base-ability-42plus8-safety-accessibility-review-packet-v1.html`：内容/测评轨与安全/康复/特教/无障碍轨自包含填写入口；实现浏览器本地自动保存、恢复、必填/逐题校验和 JSON 下载提交，提交动作不得调用 IPC、修改题目/策略/gate、激活数据或覆盖历史 manifest。
- `doc/features/base-ability-42plus8-content-assessment-review-result-v1.schema.json`、`doc/features/base-ability-42plus8-safety-accessibility-review-result-v1.schema.json`：两轨机器结果合同。
- `doc/features/base-ability-42plus8-content-assessment-review-result-v1.json`、`doc/features/base-ability-42plus8-safety-accessibility-review-result-v1.json`：审核人导出的只读原件；文件不存在时结果检查必须 `BLOCKED`，生成脚本不得创建伪结果。
- `doc/features/base-ability-42plus8-review-gate-v1.json`、`doc/features/base-ability-42plus8-review-gate-v1.schema.json`：合并后的逐题/逐轨人工审核权威，只引用原件 bytes/hash。
- `doc/assets/asset-manifest.json`、`doc/assets/asset-manifest.schema.json`：登记入选题必需视觉资产、版权、感官标签、人工门和 `app://asset/<asset_id>`。
- `doc/assets/base-ability-offline-toolkit-manifest-v1.json`、`doc/assets/base-ability-offline-toolkit-manifest-v1.schema.json`：精确登记 8 道线下题的稳定 item/setup ID、数量、摆位、复位、清洁、风险和替代限制。
- `scripts/build-visual-asset-manifest.mjs`、`scripts/validate-visual-asset-manifest.mjs`：构建/校验视觉资产；不得改变无关 270 项的语义或 hash。
- `scripts/build-base-ability-42plus8-gate.mjs`、`scripts/lib/base-ability-42plus8-gate.mjs`：生成分阶段 v2 门禁和稳定阻断码。
- `doc/features/base-ability-42plus8-pilot-gate-v2.json`、`doc/features/base-ability-42plus8-pilot-gate-v2.schema.json`：替代 v1 成为当前分阶段机器门禁；v1 文件保留不覆盖。
- `doc/features/base-ability-current-contracts.md`、`doc/index.md`：将当前入口指向 v2 并同步文档索引。
- `scripts/__tests__/base-ability-42plus8-review.test.mjs`、`scripts/__tests__/base-ability-42plus8-review-html.test.mjs`、`scripts/__tests__/base-ability-42plus8-gate.test.mjs`、`scripts/__tests__/visual-asset-manifest.test.mjs`：覆盖离线加载、自动保存/恢复、必填阻断、JSON 导出、缺审核/资产/教具、hash 漂移、旧审核失效、页面无 IPC/激活能力、结果不改题目状态和敏感内容扫描。
- `package.json`：新增 `review:base-ability:42plus8:build/check` 和成对的 `review:base-ability:42plus8:results:build/check`；既有 `contract:base-ability:gate:build/check` 改为生成/检查 v2。build/check 不得互相复用到无法证明 check 无写入的入口。

**精确验证命令：**

```bash
npm test -- scripts/__tests__/base-ability-42plus8-review.test.mjs scripts/__tests__/base-ability-42plus8-review-html.test.mjs scripts/__tests__/base-ability-42plus8-gate.test.mjs scripts/__tests__/visual-asset-manifest.test.mjs
npm run review:base-ability:42plus8:build
npm run review:base-ability:42plus8:check
npm run review:base-ability:42plus8:results:build
npm run review:base-ability:42plus8:results:check
npm run asset:validate
npm run contract:base-ability:gate:build
npm run contract:base-ability:gate:check
npm run docs:index:update
npm run docs:index:check
git diff --check
```

`review:base-ability:42plus8:results:build/check` 必须读取上面两份精确 JSON 原件。外部审核尚未返回时，packet build/check 可以作为工程子项 `PASS`，results build/check 与 Step 8 总状态均记 `BLOCKED`；不得用 fixture、Markdown 或生成脚本伪造审核结果。results build 成功后必须再次运行 results check，证明合并产物可确定性复算且 check 前后工作树不变。

**预期证据：** 两轨原件 bytes/hash、逐题/逐轨合并矩阵、results build 后 check 的确定性对照、缺失/退回/hash 漂移的稳定阻断码、资产/教具 manifest 对账和 96 DRAFT/0 ACTIVE 断言。

**回滚方式：** 版本化替换审核包/manifest，保留原始 JSON 和 hash；不得直接写 ACTIVE。

**停止条件：** 审核 HTML 能直接激活、Markdown 被当作机器权威、或素材/教具缺少专业责任人时停止。

**建议 commit message：** `feat(base-ability): gate pilot review evidence`

### Step 9：合成身份临时库技术演练与故障注入

**目的与理由：** 在真实课堂之前证明跨模块链路可重复、可恢复、不会污染默认数据库。

**前置状态：** Step 8 的 `/vibe-accept step 8` 为 `PASS`；`doc/features/base-ability-42plus8-pilot-gate-v2.json` 精确处于 `READY_FOR_TECHNICAL_REHEARSAL` 且 `activation_authority_granted = false`；两份人工审核原件、50 题权威、策略、renderer、资产和教具 hash 与 gate 引用一致；默认 data 文件族可在演练前稳定读取其存在状态和逐文件 SHA-256，且没有另一个进程正在修改它。

**完成状态：** 单一显式临时库和与之严格配对的临时 userData 完成主路径和全部故障注入，startupRecovery 与在线投影一致；同一冻结时钟/seed 重跑后 session snapshot、事件语义序列、result/report 与 gate 证据一致；Step 5 定义的完整默认数据递归 manifest（DB 文件族、legacy log、active/archived segment tree、segment index、recovery/corruption metadata、授权原件/水位/current-index）运行前后逐项完全相同；v2 门禁只推进到 `READY_FOR_PILOT_ACTIVATION_REVIEW`，`activation_authority_granted = false`，真实激活、学校授权和课堂试测仍为 `NOT_RUN/BLOCKED`；`/vibe-accept step 9` 为 `PASS`。

**不得改变：** 不得缺省或推断数据库、userData、temp root 或 evidence 路径，不得接受调用者覆盖“默认库路径”的安全基准，不得解析到默认 userData、仓库目录、符号链接/硬链接别名，不得使用真实 student/teacher/admin 或真实签发件，不得将合成 ACTIVE fixture、结果、报告、水位或证据写回仓库/默认库，不得把演练证据解释为专业审核、真实激活或课堂试测。

**演练内容：** 使用显式临时库、合成 student/teacher/admin、固定 50 题和策略 hash；执行创建 session -> 组卷 -> 42 题线上作答 -> 8 题线下评分 -> 事件投影/报告 -> 重启恢复。注入重复提交、并发写、事件投影缺失、设备/grant 释放失败、授权在创建前/运行中/终态后失效和红线并发。

**改动文件及职责：**
- `scripts/lib/pilot-path-guard.mjs`：复用 Step 5 已交付的默认路径独立推导、四路径配对、symlink/hardlink 和默认数据文件族快照能力；仅扩展 rehearsal 所需的多进程锁/运行中重新核验，不在本步骤另建第二套路径保护。
- `scripts/run-base-ability-42plus8-rehearsal.mjs`、`scripts/lib/base-ability-42plus8-rehearsal.mjs`：要求显式 `--temp-root`、`--db`、`--user-data-dir` 与 `--evidence-dir`，调用共享 path guard；只接受已经 `db:sync` 和 `db:verify` 通过的临时基线库，再建立合成身份/授权/ACTIVE fixture，运行主路径与故障矩阵并输出确定性证据。
- `scripts/e2e/base-ability-42plus8-flow.mjs`：要求相同四个显式路径，并断言 `db === <userData>/data/xc-career-guide.db`；在构建产物上设置 `SVETS_E2E=1 + SVETS_USER_DATA_DIR`，见证 42+8 主路径、技术中断、安全停止/红线、中断恢复、授权失效终止和晚到失效隔离。
- `scripts/__tests__/pilot-path-guard.test.mjs`、`scripts/__tests__/base-ability-42plus8-rehearsal.test.mjs`：扩展覆盖每个缺参、默认库相同路径/不存在路径别名/软链接/硬链接、仓库路径、DB 与 userData 不配对、默认库或事件目录本来不存在却被创建、运行中路径/file identity 变化、重复运行和证据结构；对 WAL、legacy log、active/archive segment、segment index、recovery/corruption metadata、授权原件树分别执行新增/修改/删除负例，rehearsal E2E 均必须非 0。
- `src/main/ipc/handlers/__tests__/base-ability-pilot-flow.test.ts`：覆盖 42+8 IPC 主链、并发/终态/非计分、grant/assignment/device 三方一致。
- `src/main/domain/__tests__/base-ability-pilot-recovery.test.ts`：覆盖投影丢失、混合事件、冷启动重放、授权失效和红线优先。
- `package.json`：新增 `rehearsal:base-ability:42plus8` 与 `e2e:base-ability:42plus8` 精确入口；`scripts/db-verify.mjs` 继续复用现有 `--db` 参数。

**精确验证命令：**

```bash
npm test -- scripts/__tests__/pilot-path-guard.test.mjs scripts/__tests__/base-ability-42plus8-rehearsal.test.mjs src/main/ipc/handlers/__tests__/base-ability-pilot-flow.test.ts src/main/domain/__tests__/base-ability-pilot-recovery.test.ts
npm run typecheck
npm run lint
npm run build
REHEARSAL_ROOT="$(mktemp -d /tmp/svets-base-ability-42plus8.XXXXXX)"
npm run db:sync -- --db "$REHEARSAL_ROOT/userData/data/xc-career-guide.db"
npm run db:verify -- --db "$REHEARSAL_ROOT/userData/data/xc-career-guide.db"
npm run rehearsal:base-ability:42plus8 -- --temp-root "$REHEARSAL_ROOT" --db "$REHEARSAL_ROOT/userData/data/xc-career-guide.db" --user-data-dir "$REHEARSAL_ROOT/userData" --evidence-dir "$REHEARSAL_ROOT/evidence/domain"
npm run e2e:base-ability:42plus8 -- --temp-root "$REHEARSAL_ROOT" --db "$REHEARSAL_ROOT/userData/data/xc-career-guide.db" --user-data-dir "$REHEARSAL_ROOT/userData" --evidence-dir "$REHEARSAL_ROOT/evidence/electron"
npm run contract:base-ability:gate:check
git diff --check
```

**预期证据：** `$REHEARSAL_ROOT/evidence/domain/rehearsal-summary.json`、`default-data-before.json`、`default-data-after.json`、`session-snapshot.json`、`event-sequence.jsonl`、`result-record.json`、`report-content.json`、`gate-state.json` 以及 `$REHEARSAL_ROOT/evidence/electron/` 下的日志和截图全部存在并通过脚本复核。默认文件快照必须包含每个目标的 canonical path、存在状态、size 和 SHA-256；`REHEARSAL_ROOT` 仅用于当前命令进程，不写入仓库或产品配置。

**回滚方式：** 删除本步骤创建的临时目录/数据库；不得删除默认运行库或历史产物。

**停止条件：** 任何真实库写入、合成身份进入仓库运行数据、恢复结果与在线结果不一致、或故障注入无法确定失败码时停止。

**建议 commit message：** `test(base-ability): rehearse isolated 42plus8 flow`

### Step 10：独立批准校验与受控激活入口

**目的与理由：** 只完成生产信任根装配、独立批准链验证和受控激活，不在本步骤补做 Step 6 已交付的通用授权合同、生命周期、水位或 session 写边界。激活必须成为可恢复的追加式事实，不能只留下题目状态变化而没有执行台账。

**前置状态：** Step 9 的 `/vibe-accept step 9` 为 `PASS`，v2 门禁为 `READY_FOR_PILOT_ACTIVATION_REVIEW` 且 `activation_authority_granted = false`。产品负责人必须通过单独发布审查提供固定生产根的完整公开字段和由同一真实私钥签出的非敏感 KAT 原件；缺公钥、指纹、`issued_at / effective_at / expires_at`、安装版审查证据或 KAT 任一项时，不得提交占位根，Step 10 工程验收保持 `BLOCKED`。真实激活还需另有当前 `ACTIVE` 的批准链、显式目标库/备份目录和用户对该次外部运维的明确授权；这些条件不得由工程测试推断。

**完成状态：**

- 安装版静态 current 根精确绑定 `principal_id`、`key_id`、Ed25519 公钥、SHA-256 指纹和 UTC `issued_at / effective_at / expires_at`，强制 `issued_at <= effective_at < expires_at` 且期限不超过 365 天；生产 composition root 只能静态导入经发布审查的 current + historical public-key 集合。current 根只负责新授权决策；历史根仅允许按签发时有效性验证旧原件，不能签发/恢复新权限。实际固定公钥 KAT 在冻结的合法决策时间正向通过，任一 payload/signature/key/fingerprint 字节变化失败；另有当前时钟测试证明过期生产根拒绝授权。
- 激活入口复用已验收的 v2.2 batch coordinator/锁/recovery/corruption gate 和 Step 6 的产品链 validator/lifecycle/watermark，机械验证独立批准人、责任主体和可信执行人映射；测试可在领域层注入临时根，生产 composition root 和 Electron/CLI E2E 不得出现根注入点。
- `PILOT_ACTIVATION_EXECUTED` 使用既有 `SYSTEM` aggregate 和不可变 `payload_version = 1`，作为单事件 v2.2 batch 完成 EventType、payload parser、EVENT、projection、activation reducer、startupRecovery 和 command fencing/幂等/冲突全链；EVENT envelope 精确遵守前置功能验收后的合同，不复用 batch record version 充当 payload version，不新增本步骤私有 record、表、列或 aggregate CHECK。事件冻结根/批准链/责任清单/门禁/题集/策略/各合同 hash、目标数据库的稳定逻辑 identity、备份 manifest hash、入口和可信执行身份、执行前后精确题集状态及 UTC 决策时间；canonical path/device/inode 等物理 identity 只进入脱敏审计和备份 manifest，不作为跨恢复逻辑 identity。
- 对同一 `activation_execution_id/command_id`，相同 request hash 返回同一结果，不重复 PREPARE/EVENT/投影；不同 request hash 稳定冲突。PREPARE 前失败不得改变题目或写执行事件；`BATCH_PREPARED + EVENT` 完整 fsync 是不可逆事实提交点，之后 APPLY/reducer/CONFIRM 失败必须返回 `ACTIVATION_COMMITTED_RECOVERY_REQUIRED`（不是通用“激活失败”），阻断业务并由 `startupRecovery` 仅凭同一 batch 完成 50 题投影和 CONFIRM；禁止删除记录、回退水位、补造另一 batch 或改用另一集合重试。
- CLI 和 Electron 激活都绑定目标 DB 的 canonical data root，并从该 root 推导/验证同一 active segment/index、授权原件库、水位/current 索引及相关归档；不得调用全局 `getActionLogPath()` 落到默认 userData。目标稳定逻辑 identity 由已验证 schema baseline、event-log genesis 与激活前 chain head/authority generation 复算，物理路径/file identity 在取得锁、备份后和 PREPARE 前各复核一次。
- ADMIN 页面提供批准链预检、目标/备份选择、摘要确认和执行回执；主进程文件/目录选择器产生一次性进程内 handle，renderer/IPC 请求不传原始路径、根或身份。页面不得以“预检通过”改 gate，也不得在未二次确认时执行。
- 工程入口、固定根 KAT、临时库正负路径和 recovery 全部通过时，`/vibe-accept step 10` 可对“受控入口实现”给出 `PASS`。若真实批准尚未提供，产品门禁仍为 `READY_FOR_PILOT_ACTIVATION_REVIEW`、`activation_authority_granted = false`，真实命令为 `NOT_RUN/BLOCKED`；只有另行授权的真实执行成功后，获批 42 ONLINE + 8 OFFLINE 才为 ACTIVE，其余 46 题仍为 DRAFT。学校授权和逐学生同意未通过时，仍不得创建或继续真实 session。

**不得改变：** 构建、测试、gate check、审核提交和应用启动不得自动执行真实激活；不得从批准包、目标 DB、CLI、环境变量、IPC 请求、ADMIN 输入或测试 fixture 替换生产根；不得提交生产私钥、账号凭据或学生数据；不得接受 `callerUserId`、role、`principal_id` 或密码参数；不得激活 96 题、扩大签名集合、部分提交、直接 UPDATE 绕过事件或把已激活题退回 DRAFT；不得把产品批准替代学校授权/个人同意，也不得推进课堂证据或正式解释状态。

**改动文件及职责：**

- `src/shared/config/pilot-product-owner-trust-anchor-v1.json`、`src/shared/config/pilot-product-owner-trust-anchors-history-v1.json`：保存经单独审查的固定 current 根与只追加历史公开根，包含稳定 ID、`principal_id`、`key_id`、Ed25519 公钥、SHA-256 指纹、`issued_at / effective_at / expires_at`、状态和发布审查引用；只含公开信息，不允许占位值、删除仍被原件引用的历史键或运行时覆盖。
- `src/main/domain/pilot-product-owner-trust-anchor.ts`、生产 composition root：静态 import current/history JSON，启动时复算指纹、Schema、期限、唯一 current 和历史引用完整性；新决策只接受 current ACTIVE 根，历史验证按签发时点选择 key。生产构造函数不接收 trust-anchor 参数，根轮换只能随单独审查的新安装版发布。
- `src/main/domain/__fixtures__/pilot-product-owner-production-kat-v1.json`：由实际固定根私钥签出的非敏感、domain-separated `TRUST_ANCHOR_KAT_ONLY` canonical payload/signature 已知答案原件，只用于证明发布公钥装配正确；记录固定验证时间和自身 hash，不包含私钥，且 authorization parser 必须拒绝把该 scope 当作真实 Pilot 授权。
- `src/main/domain/pilot-activation-event-contract.ts`：先断言 envelope schema v1，再解析并复算 `PILOT_ACTIVATION_EXECUTED.payload_version = 1`；要求 `aggregate_type = SYSTEM`、稳定 aggregate/execution ID、逻辑 DB identity、完整 hash/身份/备份/前后集合和恰好 42+8。
- `src/shared/types/event-payloads.ts`、已验收的 v2.2 batch coordinator/startupRecovery modules（重基线复审时记录实际路径）、`doc/specs/xc-career-guide-event-payload-schema-v1.0.0.md`：登记激活事件全链和可读参考；激活使用含一个 EVENT 的权威 batch，startupRecovery 在开放业务 IPC 前完成 PREPARED/APPLIED/CONFIRMED 对齐，未知 batch-record/event-envelope/payload version 或不完整 payload 失败关闭，不占用 F7 envelope-v2。
- `src/main/domain/pilot-activation-reducer.ts`：只从已校验事件 payload 将精确 50 题 `DRAFT -> ACTIVE`，断言未选 46 题和所有其他题状态不变；重复应用幂等，当前状态/hash 与事件前置快照冲突时停止恢复。
- `src/main/domain/pilot-activation-service.ts`：从显式目标 data root 解析目标专用 v2.2 runtime；先按全局顺序取得 authorization state lock，再由 coordinator 取得 active segment/index 单写者锁，拒绝 recovery/corruption gate，完成可信身份、生产根/批准链/水位、逻辑/物理 DB identity、gate/authority/策略/hash 和题集状态预检。锁内生成 SQLite、active/相关归档 event log、segment index、授权原件/水位/current-index 一致备份并复核 manifest，再复核 generation/state 后执行 `PREPARE -> BEGIN IMMEDIATE/APPLY activation reducer -> COMMIT -> CONFIRM`。PREPARE 后异常不得删除日志；底层 gate 保持关闭，激活入口映射为 `ACTIVATION_COMMITTED_RECOVERY_REQUIRED` 并阻断业务开放。
- `src/main/domain/pilot-activation-audit.ts`、`error_code_registry` seed：把每次尝试的入口、可信 auth context ID、ADMIN `user_id`、映射后 `principal_id`、根 ID/指纹/验证器版本、批准 ID/hash、独立性集合、目标 DB identity、结果/失败码/恢复状态写入既有审计设施；不记录凭据。预检拒绝允许写审计，但不得改变题目、gate 或追加“已执行”事件。
- `scripts/lib/pilot-path-guard.mjs`：复用严格临时模式并增加独立 activation 模式；真实激活要求显式 data root、DB、只读 authority bundle 和备份目录，校验它们的 canonical containment/file identity、DB-metadata/action-log 配对、符号/硬链接、仓库路径、备份可写与 source/backup 分离。activation 模式不把合法显式 Pilot 目标误判为演练路径，但不得接受安全基准覆盖或使用默认全局 action-log getter。
- `src/main/cli/pilot-activation.ts`、`src/main/index.ts`：提供 `--pilot-activate` 运维模式；只在目标库交互认证 ACTIVE ADMIN，凭据只存在当前进程内存且不进入 argv/env/log。CLI 展示逻辑/物理 DB identity、active log identity 与备份 manifest，要求交互确认后把目标专用路径依赖传给 activation service。
- `src/main/ipc/handlers/pilot-activation.ts`、`src/main/ipc/index.ts`、`src/preload/index.ts`、`src/shared/types/ipc-api.ts`：登记 Electron 预检、主进程文件/目录选择、二次确认和激活通道；从 sender 绑定且仍 ACTIVE 的 `auth_session` 解析执行人，用一次性 handle 解析目标，不接收 caller 身份、根、原始路径或客户端生成 DB identity。
- `src/renderer/src/views/admin/PilotAuthorizationView.vue`：扩展 Step 6 页面，显示批准/主体独立性、42+8 前后集合、目标逻辑 identity 和备份摘要，提供明确二次确认与成功/committed-recovery-required 回执；刷新/重启后从事件台账查询结果，不以本地状态判断激活成功。
- `src/main/domain/__tests__/pilot-product-owner-trust-anchor.test.ts`：生产 composition root 使用实际固定公钥完成正向 KAT，并覆盖根字段/365 天边界、当前过期、payload/signature/key/fingerprint 变异和所有运行时替换入口。
- `src/main/domain/__tests__/pilot-activation-event-contract.test.ts`、`src/main/domain/__tests__/pilot-activation-service.test.ts`、`src/main/domain/__tests__/pilot-activation-reducer.test.ts`、`src/main/domain/__tests__/recovery.test.ts`：覆盖精确 42+8、未选 46、身份独立、同 command 幂等/异载冲突、PREPARE 前失败、PREPARE/APPLY/CONFIRM 故障和冷启动恢复。
- `src/main/ipc/handlers/__tests__/pilot-activation.test.ts`、`src/main/cli/__tests__/pilot-activation.test.ts`、renderer 激活视图测试、`scripts/__tests__/pilot-path-guard.test.mjs`：覆盖可信 sender、伪造 caller、一次性 handle、二次确认、交互认证、argv/env 凭据或根拒绝、显式 data root/路径、DB/action-log identity、备份、默认路径误写和拒绝路径只有脱敏审计无业务写。
- `scripts/e2e/base-ability-pilot-activation.mjs`：只接受显式 `--temp-root / --db / --user-data-dir / --evidence-dir`，并要求 DB 与 userData/data 配对；在构建产物的生产 composition root 中执行实际固定公钥 KAT 与根替换负测。临时根正向激活仅在领域测试注入，不得伪装成生产 KAT；真实批准原件缺失时，E2E 证明入口稳定阻断，不生成替代批准。
- `package.json`：新增 `pilot:base-ability:activate` 和 `e2e:base-ability:pilot-activation` 精确入口；二者不得进入 build/test/postinstall 自动生命周期。

**事件提交与恢复边界：**

```text
从显式 data root 推导目标专用 v2.2 runtime/segment index/原件/水位/current-index
  -> 验证 DB metadata/event-log pairing、hash-chain head 与逻辑/物理 identity
  -> 取得 authorization state lock，认证/签名/生命周期/独立性/水位预检
  -> coordinator 确认 recovery/corruption gate OPEN
  -> 取得 active segment/index 单写者锁
  -> 目标库/集合预检
  -> 锁内生成 DB/active+相关归档 event log/index/授权状态一致备份并复核 manifest hash
  -> 复核逻辑 identity、canonical path/file identity、题集状态和授权 generation
  -> 写 BATCH_PREPARED + PILOT_ACTIVATION_EXECUTED EVENT -> fsync（逻辑提交点）
  -> BEGIN IMMEDIATE -> 写 batch/event projection -> activation reducer -> COMMIT
  -> 写 BATCH_COMMITTED -> fsync -> 标记 CONFIRMED

PREPARE 前失败 -> 无激活事件、无题目变化，可按同一 command 重试
PREPARE 后失败 -> DB 按 stage 回滚/保留 APPLIED，关闭 recovery gate、返回 ACTIVATION_COMMITTED_RECOVERY_REQUIRED、阻断业务、禁止换集合重试
下次启动 -> v2.2 startupRecovery -> 校验同一 batch/request hash -> 投影精确 50 题并 CONFIRM
```

**精确验证命令（不执行真实激活）：**

```bash
npm test -- src/main/domain/__tests__/pilot-product-owner-trust-anchor.test.ts src/main/domain/__tests__/pilot-authorization-contract.test.ts src/main/domain/__tests__/pilot-authorization-lifecycle.test.ts src/main/domain/__tests__/pilot-activation-event-contract.test.ts src/main/domain/__tests__/pilot-activation-service.test.ts src/main/domain/__tests__/pilot-activation-reducer.test.ts src/main/domain/__tests__/event-lock-order.test.ts src/main/domain/__tests__/recovery.test.ts src/main/ipc/handlers/__tests__/pilot-activation.test.ts src/main/cli/__tests__/pilot-activation.test.ts scripts/__tests__/pilot-path-guard.test.mjs
npm run typecheck
npm run lint
npm run build
PILOT_TEST_ROOT="$(mktemp -d /tmp/svets-base-ability-pilot-activation.XXXXXX)"
mkdir -p "$PILOT_TEST_ROOT/userData/data" "$PILOT_TEST_ROOT/evidence"
npm run db:sync -- --db "$PILOT_TEST_ROOT/userData/data/xc-career-guide.db"
npm run db:verify -- --db "$PILOT_TEST_ROOT/userData/data/xc-career-guide.db"
npm run e2e:base-ability:pilot-activation -- --temp-root "$PILOT_TEST_ROOT" --db "$PILOT_TEST_ROOT/userData/data/xc-career-guide.db" --user-data-dir "$PILOT_TEST_ROOT/userData" --evidence-dir "$PILOT_TEST_ROOT/evidence"
npm run contract:base-ability:authority:check
npm run contract:base-ability:gate:check
npm run docs:index:check
git diff --check
```

**预期证据：** 实际 production current/history 根 JSON、KAT 与发布审查引用 SHA-256 对账；current 根当前状态、历史签发时验证和冻结 KAT 时间分别通过，历史根不能授予新权限；根替换、身份相交、批准过期/撤销、集合/hash 漂移、已有 recovery/corruption gate、目标 DB/event-log/index 错配、默认日志误写和路径别名均有稳定失败码；普通 batch 写、down 与 activation 并发证明统一 `auth（适用时） -> log -> DB` 顺序无死锁；PREPARE 前失败无执行事件，PREPARE/APPLY/CONFIRM 后各故障点同时出现底层 gate 和 committed-recovery-required 回执，并由目标 batch 恢复为恰好 50 ACTIVE/46 DRAFT 且 CONFIRMED；重复执行只有一个 execution ID/command/batch/event；备份 manifest、稳定逻辑 DB identity、物理 identity 和脱敏尝试审计可关联；ADMIN 页面预检/二次确认/回执经构建产物验证。

**真实激活命令合同（不属于自动验收，不得自动执行）：**

```bash
npm run build
npm run pilot:base-ability:activate -- --data-root /absolute/path/to/pilot/data --db /absolute/path/to/pilot/data/xc-career-guide.db --authority-bundle /absolute/path/to/read-only/authority-bundle --backup-dir /absolute/path/to/write-once/backups
```

四个路径参数必须由调用者逐次提供并经 `realpath`/file identity/metadata pairing 校验；active event-log segment/index、授权原件库和水位只能从 data root 推导，不另收 `--action-log`、`--segment` 或 `--index`。生产命令没有 `--trust-anchor`、`--user-id`、`--role`、`--principal-id` 或密码参数。真实路径、有效签名原件和本次执行授权尚未同时存在时，该命令保持 `NOT_RUN/BLOCKED`，计划和自动化不得猜测、生成或调用替代值。

**回滚方式：** PREPARE 前失败不得修改 event log 或题目状态，无需也不得自动覆盖目标库；备份只作为经批准的灾难恢复原件。PREPARE 完整 fsync 后 batch 已成为事实，只允许先阻断业务、用 startupRecovery 完成同一 APPLY/CONFIRM，不能删记录或退回 DRAFT。激活后发现问题只能停止新 session，将受影响题转为 `DISABLED/ARCHIVED` 并以新 `question_id` 重走审核和激活。

**停止条件：** 固定根或实际 KAT 缺失/失效、需要运行时根注入、批准人/责任人/执行人主体冲突、目标库或备份 identity 不明确、recovery/corruption gate 未开放、hash/集合不一致、批准不是 ACTIVE、batch/event payload 不能独立恢复、或只能靠直接 UPDATE/删除日志获得幂等时，Step 10 保持 `BLOCKED` 并重新进行 R3 审查。

**建议 commit message：** `feat(base-ability): add audited pilot activation`

## 6. 全量回归矩阵

| 检查 | 必须执行的入口 | 通过证据 |
|---|---|---|
| 类型、Lint、全量测试、构建 | `npm run typecheck`、`npm run lint`、`npm test`、`npm run build` | 四条命令分别退出码 0；不得用定向测试代替 `npm test` |
| Step 2A–2C 前置链 | M4/Step 2A、M5A/Step 2B 的独立验收记录（`ACCEPTED`），M5B-15（`PASS`）与本计划新的独立复审 | 三元安全身份、最终 Command Bus、M5B PREPARE/APPLY/CONFIRM、durability、hash chain、command fencing、segment/index、legacy LF/EOF、全 writer 整批迁移、mutation registry、startupRecovery 和版本化不变量持续有效；P1-01/P1-02 已关闭，新的独立复审未通过时 Step 3-10 `BLOCKED` |
| Step 3-10 batch 集成 | 42+8 session/响应/评分/授权/激活 batch、gate、lock-order、recovery 定向测试 + 全量测试 | 单/多 EVENT batch 各阶段故障、启动整体恢复/CONFIRM、普通写/down/activation 无锁反转 |
| Schema/迁移 | 全量 migration tests；对显式临时库执行 `db:sync` + `db:verify` | 前滚、允许/拒绝 down、结构/trigger/FK/行/hash 证据；默认库不在自动命令目标中 |
| 题库、人工审核、资产、门禁 | authority check、两轨 packet/results check、asset validate、gate check | 当前原件/manifest/gate 可确定复算且 check 不写文件；缺人工原件为 `BLOCKED` |
| 报告桌面回归 | `e2e:report` + 四个显式路径 | 配对临时库、三视口、导出、锁定、历史 bytes 与完整默认递归 manifest 通过；segment/index 新增/改/删负例非 0 |
| 42+8 renderer 桌面回归 | `e2e:base-ability:renderers` + 四个显式路径 | 配对临时库、三个实际 content viewport、全 registry、键盘/触控、overflow、截图摘要与完整默认递归 manifest 通过 |
| 42+8 全链与恢复 | `rehearsal:base-ability:42plus8` + `e2e:base-ability:42plus8` | 主链、故障矩阵、startupRecovery、完整默认递归 manifest 前后相同 |
| 生产根/激活入口 | 激活定向测试 + `e2e:base-ability:pilot-activation` | 实际固定公钥 KAT 正向、根替换负向、事件/recovery、临时库无越界写通过；真实激活仍不执行 |
| 文档与 diff | `npm run docs:index:check`、`git diff --check` | 两条命令退出码 0 |

最终 `/vibe-accept` 必须逐行执行以下回归，不得用此前 Step 的旧日志替代。每个 Electron/数据库入口使用独立显式临时根；任一脚本缺少路径保护、实际解析到默认 data 文件族或仓库目录时应在打开 DB 前失败：

```bash
npm run typecheck
npm run lint
npm test
npm run build

npm run contract:base-ability:authority:check
npm run review:base-ability:42plus8:check
npm run review:base-ability:42plus8:results:check
npm run asset:validate
npm run contract:base-ability:gate:check

FINAL_REGRESSION_ROOT="$(mktemp -d /tmp/svets-base-ability-final.XXXXXX)"
BATCH_ROOT="$FINAL_REGRESSION_ROOT/event-batch"
REPORT_ROOT="$FINAL_REGRESSION_ROOT/report"
RENDERER_ROOT="$FINAL_REGRESSION_ROOT/renderers"
REHEARSAL_ROOT="$FINAL_REGRESSION_ROOT/rehearsal"
PILOT_TEST_ROOT="$FINAL_REGRESSION_ROOT/pilot-activation"
mkdir -p "$BATCH_ROOT/userData/data" "$REPORT_ROOT/userData/data" "$RENDERER_ROOT/userData/data" "$REHEARSAL_ROOT/userData/data" "$PILOT_TEST_ROOT/userData/data"

npm run db:sync -- --db "$BATCH_ROOT/userData/data/xc-career-guide.db"
npm run db:verify -- --db "$BATCH_ROOT/userData/data/xc-career-guide.db"
npm run contract:event-batch:v2.2:check -- --temp-root "$BATCH_ROOT" --db "$BATCH_ROOT/userData/data/xc-career-guide.db" --user-data-dir "$BATCH_ROOT/userData" --evidence-dir "$BATCH_ROOT/evidence"
node scripts/check-project-invariants.mjs

npm run db:sync -- --db "$REPORT_ROOT/userData/data/xc-career-guide.db"
npm run db:verify -- --db "$REPORT_ROOT/userData/data/xc-career-guide.db"
npm run e2e:report -- --temp-root "$REPORT_ROOT" --db "$REPORT_ROOT/userData/data/xc-career-guide.db" --user-data-dir "$REPORT_ROOT/userData" --evidence-dir "$REPORT_ROOT/evidence"

npm run db:sync -- --db "$RENDERER_ROOT/userData/data/xc-career-guide.db"
npm run db:verify -- --db "$RENDERER_ROOT/userData/data/xc-career-guide.db"
npm run e2e:base-ability:renderers -- --temp-root "$RENDERER_ROOT" --db "$RENDERER_ROOT/userData/data/xc-career-guide.db" --user-data-dir "$RENDERER_ROOT/userData" --evidence-dir "$RENDERER_ROOT/evidence"

npm run db:sync -- --db "$REHEARSAL_ROOT/userData/data/xc-career-guide.db"
npm run db:verify -- --db "$REHEARSAL_ROOT/userData/data/xc-career-guide.db"
npm run rehearsal:base-ability:42plus8 -- --temp-root "$REHEARSAL_ROOT" --db "$REHEARSAL_ROOT/userData/data/xc-career-guide.db" --user-data-dir "$REHEARSAL_ROOT/userData" --evidence-dir "$REHEARSAL_ROOT/evidence/domain"
npm run e2e:base-ability:42plus8 -- --temp-root "$REHEARSAL_ROOT" --db "$REHEARSAL_ROOT/userData/data/xc-career-guide.db" --user-data-dir "$REHEARSAL_ROOT/userData" --evidence-dir "$REHEARSAL_ROOT/evidence/electron"
npm run db:verify -- --db "$REHEARSAL_ROOT/userData/data/xc-career-guide.db"

npm run db:sync -- --db "$PILOT_TEST_ROOT/userData/data/xc-career-guide.db"
npm run db:verify -- --db "$PILOT_TEST_ROOT/userData/data/xc-career-guide.db"
npm run e2e:base-ability:pilot-activation -- --temp-root "$PILOT_TEST_ROOT" --db "$PILOT_TEST_ROOT/userData/data/xc-career-guide.db" --user-data-dir "$PILOT_TEST_ROOT/userData" --evidence-dir "$PILOT_TEST_ROOT/evidence"

npm run docs:index:check
git diff --check
```

`review:base-ability:42plus8:results:check` 缺真实审核原件时，最终回归和对应 Step 必须为 `BLOCKED`；固定生产根/KAT 缺失时激活入口验收同样为 `BLOCKED`。所有未实际执行的项目标记 `NOT_RUN`，环境或外部原件缺失标记 `BLOCKED`，不得以计划、旧日志或单元 fixture 代替当前证据。真实 `pilot:base-ability:activate` 和默认运行库 `db:verify/down` 不属于上述自动回归，未经单独授权不得执行。

## 7. 人工验收矩阵

| 场景 | 结果标准 | 状态要求 |
|---|---|---|
| 教师审核与学生线上作答 | 42 题按冻结合同完成，错误/非计分/求助路径可解释 | `NOT_RUN`，需桌面实测 |
| 教师线下评分 | 8 题按 0/1/2 锚点评分，不能改 rubric 或重复计分 | `NOT_RUN` |
| 安全红线 | 先熔断，安全结果优先，不记普通 0 分 | `NOT_RUN` |
| 授权撤回/失效 | 立即停输入、关闭/隔离、释放 assignment，红线优先 | `NOT_RUN` |
| Electron 桌面 smoke | preload 白名单、窗口尺寸、资源加载、无重叠/溢出 | `NOT_RUN` |
| 多设备授权链 | business session、grant、assignment、student/device 一致 | `NOT_RUN` |
| 真实 Pilot 激活/课堂试测 | 需要外部签名、学校协议、逐学生同意和实际课堂证据 | `BLOCKED` 直到外部资料存在 |

## 8. 残余风险与后续项

- [!] Step 2A M4、Step 2B Command Bus 和 Step 2C 权威 v2.2 batch runtime 均已验收并构成当前生产边界；P1-01 与 P1-02 已关闭。P1-02 已将 `assertWorkbookMatchesSql()` 接入 `authority:check` 的必经构建路径，gate 复用同一检查；复制件的 workbook 或 SQL `materials` 字段漂移在刷新 hash 绑定后仍会由正常 authority check 失败关闭。Step 3-10 的硬阻断仅为新的独立 R3 计划复审。后续不得用本计划或两个 reason CHECK 改写既有 Schema、命令边界或日志协议。
- [!] PRD 已明确的现状冲突必须在实现中关闭：旧 `question_ratio`、基础能力查询过滤、硬编码评分、`ANSWER_SUBMITTED` 独占、两个 reason CHECK 缺口。每项关闭都要对应代码和测试证据。
- [!] 当前默认运行库存在已知漂移；必须作为单独、获授权的运维任务修复并取得 `db:verify` 证据，计划实现和临时库测试不得自动修复或覆盖它。
- [!] `doc/features/mvp-pilot-freeze-plan.md` 的 R0-G02 仍写着禁用 BASE_ABILITY，与当前权威 PRD 的受控 Pilot 路径不一致；不阻断本计划修订，但在进入 R0 冻结前必须单独修订并复审。
- Step 1 已冻结题目选择；后续如需调整题目、资产数量、线下教具或 renderer 组合，必须生成新的权威版本、保留选择理由并重新走相应门禁，不能无记录扩张。
- 产品负责人固定公开根和非敏感 KAT 经安装版审查后进入静态配置；所有私钥必须离线保管，真实批准/授权原件通过只读包导入。本计划不生成、提交或存储生产私钥。
- 操作系统级替换已审查安装包属于部署完整性风险，不由本地批准 JSON 解决，需纳入发布验收。
- 真实课堂试测、专业签字、学校授权、逐学生同意和正式解释仍是外部依赖，工程测试不能替代这些验收。

## 9. Reviewer 入口

计划完成后执行独立审查：

```text
/vibe-review impl doc/features/base-ability-42plus8-pilot-readiness-impl.md
```

审查输入应同时包含本 PRD、适用不变量、R3 风险、当前工程基线（本次修订时为 `5f050d6` / `v0.1.18-event-batch-v2.2`）、本计划的实际 diff 和引用的代码范围；实施真正开始时还必须换成届时实际 base commit。出现未关闭 P0、跨文件登记遗漏、不可恢复中间状态、默认库保护缺口或把 R3 降级为机械任务时，计划状态为 `BLOCKED`，不得进入编码。
