# JOB_SKILL 298 题全量预览实施计划

## 1. 实现目标

将 298 道当前版本 JOB_SKILL 题目以非破坏性方式导入教师可见目录，按逐题证据和不可变 `PREVIEW_ONLY` 题包逐批开放；预览可完成受控作答、线下评分、安全处置与学校反馈，但绝不产生正式岗位测评结果。固定 18+6 正式示范测评保持可用，且必须与预览发布来源、会话解释和结果链相互隔离。

本文件只定义实施顺序和证据，**不授权实施**。其中 Step 1 是阻断性可行性结论：没有单独批准的 R3 Schema/数据合同决策，不得进入 Step 2 及以后。

## 2. 基线与范围

- Mini-PRD：`doc/features/job-skill-298-full-preview-prd.md`，状态 `APPROVED`，独立 R3 闭合复核 `PASS`。
- R3 闭合复核：`doc/features/job-skill-298-full-preview-prd-r3-closure-review.md`。
- 工程基线：`schema.sql v0.1.18-event-batch-v2.2`，分支 `feat/multi-device-m2-prd`；计划开始时工作树已有 BASE_ABILITY 和 PRD 准备改动，必须原样保留。
- 风险等级：R3（权限、持久化命令、事件恢复、安全 FSM、结果/报告隔离、资产与匿名反馈）。
- 权威入口：`doc/specs/baseline.yaml`、`doc/specs/MVP_PRD_v1.0.9-authoritative.md`（正文 v1.0.10）、`src/main/db/schema.sql`、`doc/features/job-skill-shelver-current-contracts.md`。

明确不做：教师自由组卷或编辑试卷；单个 298 题 session；随机组卷；全量正式评分或新正式 result type；AI 自动批准；学校运行时访问外部 AI；删除/覆盖既有题目、资产、session、结果、报告或审核 manifest；扩容 BASE_ABILITY；对默认用户库做导入、修复或测试。

### [!] Schema 前置冲突

Mini-PRD §5.2 / §8 要求本阶段不新增 Schema；但 §6.3.1、AC-20 和 §6.7 同时要求持久化、可恢复且不可混淆地证明：

1. 同一题目语义版本的 `official_publish_set` 与 `preview_publish_set` 两条独立授权来源；
2. 责任清单、发布批准、精确题目/资产/renderer/evidence hash、有效期、签发 principal、执行 principal、幂等命令和题包版本的不可变关联；
3. 认证上下文中 ACTIVE ADMIN 的 `user_account.user_id ↔ principal_id` 已签名唯一映射与职责分离；
4. 反馈导出匿名引用与仅本机保存的真实 ID 映射、草稿恢复和修订历史。

当前 Schema 只有全局 `question_bank.status`、任意 `question_policy_json`、通用 `domain_event_projection.payload_json` 与 durable command 账本；`user_account` / `auth_session` 也没有 `principal_id` 映射。它们无法以 FK、唯一约束、触发器或冻结快照证明上述来源彼此独立，不能把 `ACTIVE` 的来源限定为当前题包，也不能保证反馈映射不进入导出物。把这些事实仅写入策略 JSON、命令输入或 UI 状态会违反 `INV-DATA-001`、`INV-EVT-004`、`INV-EVT-005`、`INV-EVT-006`。

所以 Step 1 必须输出可复现的“现有结构足够”证明；若无法证明，按 Mini-PRD §6.3.1(7)、§6.7(8)、§8(3)停止本计划，另建并独立 R3 审查 Schema/数据合同决策。当前代码阅读显示该停止分支极可能成立，不得把后续步骤当作已获准的 Schema 实施。

## 3. 适用不变量

`INV-EVT-001`、`INV-EVT-002`、`INV-EVT-003`、`INV-EVT-004`、`INV-EVT-005`、`INV-EVT-006`、`INV-SAFE-001`、`INV-SAFE-002`、`INV-SAFE-003`、`INV-SAFE-004`、`INV-AUTH-001`、`INV-AUTH-002`、`INV-RES-001`、`INV-RES-002`、`INV-STR-001`、`INV-STR-002`、`INV-IPC-001`、`INV-IPC-002`、`INV-DATA-001`、`INV-DATA-002`、`INV-DATA-003`、`INV-A11Y-001`。

## 4. 变更地图

### 4.1 当前状态

- 298 题运行时权威存在，但当前版本均为 `DRAFT`；教师没有全库目录或题包入口。
- `question_bank.status = ACTIVE` 是全局可用标记，当前不能说明它来自正式或预览发布链。
- `strategy_job_skill_shelver_v1` 是固定 18+6、48 分的 `JOB_SKILL_ASSESSMENT`；现有 validator 不识别 `delivery_mode`。
- 现有 assessment 创建、作答、评分、结果和报告把 JOB_SKILL 解释为正式结果路径；其共享安全任务边界和 assignment/grant 已存在。
- 所有生产 mutation 已经走 durable command + v2 batch 边界；新写操作不得回接 legacy writer。
- `asset_resource` 可记录文件完整性，未持久化审查批准、题目版本绑定或题包冻结；270 项素材当前均为 `planned`。

### 4.2 目标状态与状态迁移

| 对象 | 当前 | 目标 | 失败/恢复 |
|---|---|---|---|
| 298 题目录 | 仅 DRAFT 数据事实 | 教师始终见 298/298；`CATALOG_ONLY`、`PREVIEW_RELEASE_CANDIDATE`、`PREVIEW_READY`、`PREVIEW_DISABLED`、`ARCHIVED_HISTORY` 为可复算读模型 | 导入/hash 漂移时整包拒绝；目录保留已验证历史，不把计数伪报为 0 |
| 题目发布 | 单一 ACTIVE，来源不明 | `ACTIVE` 与正式、预览两条发布来源分别证明；状态读模型不以 DRAFT 推断内容失败 | 任一来源/证据失效仅阻断相关题与新题包，禁止复活 DISABLED/ARCHIVED |
| 预览题包 | 不存在 | 系统预设、不可修改、按策略版本冻结的 `PREVIEW_ONLY` 固定集 | 发布命令任一环节失败整笔回滚；历史包只读、可恢复 |
| 会话 | JOB_SKILL 默认正式评分 | 同一 session 表按明确 delivery mode 分支；预览保留作答事实，抑制正式结果/报告 | 资产失效记录技术中断；红线仍熔断；重启只按冻结 batch 恢复 |
| 正式 18+6 | 固定集可生成 JOB_SKILL_SCORE | 保持原语义，必须有正式发布来源才可创建 | 预览先发布不得授予正式创建；缺来源返回 `FORMAL_RELEASE_AUTHORITY_MISSING` |
| 反馈 | 无学校反馈包 | HTML 本地草稿/提交 JSON/由 JSON 生成 MD；外发仅匿名引用 | 自动保存失败显式提示并允许导出内存内容；敏感文本拒绝外发；修订创建 revision |

### 4.3 两种发布顺序的不可越权规则

| 顺序 | 所允许的事实 | 必须拒绝 |
|---|---|---|
| 正式先发布 | 正式批准可将精确题目版本置为 ACTIVE；无有效 PREVIEW_ONLY 批准时目录为 `PREVIEW_RELEASE_CANDIDATE` | 不得因为已 ACTIVE 自动变为 `PREVIEW_READY`；预览创建返回 `PREVIEW_RELEASE_AUTHORITY_MISSING` |
| 预览先发布 | 有效预览责任清单/批准可在原子命令中将精确 DRAFT 题置为 ACTIVE，并写入仅该 pack 的预览来源 | 不得使 18+6 正式 session 可创建；缺正式来源返回 `FORMAL_RELEASE_AUTHORITY_MISSING` |
| 已经双发布 | 两个来源分别仍指向当前题目语义、包/策略、资产和 renderer hash | 任何来源过期、hash 漂移、题目 DISABLED/ARCHIVED、批准范围扩大或重放冲突均不得创建新 session |

### 4.4 发布命令与身份状态机

```text
输入文件/批准 -> 结构+Ed25519+期限校验 -> 可信 auth_session/CLI ADMIN
  -> 已签名 user_id<->principal_id 唯一映射 -> 职责分离校验
  -> 精确题目/资产/renderer/evidence/hash 门禁 -> durable PREPARE
  -> 单事务：必要 DRAFT->ACTIVE + 双来源记录 + 冻结 pack/strategy + 审计事实
  -> APPLY/投影 -> 可分配 PREVIEW_READY
```

任一箭头失败均进入 durable `FAILED` 或预准备失败结果：不保留部分 ACTIVE、半题包、可分配策略或匿名映射泄漏。相同 approval ID/hash 重放返回原结果；同 ID 不同 hash 返回 `PREVIEW_PACK_RELEASE_CONFLICT`。`user_id` 缺失、映射多值、映射签名无效、请求正文自报 principal，或 executor principal 等于 signer principal，均返回稳定的 `PREVIEW_PACK_RELEASE_EXECUTOR_IDENTITY_INVALID` 或 `PREVIEW_PACK_RELEASE_SEPARATION_OF_DUTIES_FAILED`。

### 4.5 实施依赖图

```text
Step 1 可行性/R3 决策
  -> Step 2 持久化合同、签名和双来源模型
    -> Step 3 内容/资产导入与可用性读模型
      -> Step 4 durable 原子发布
        -> Step 5 session 快照、执行、结果抑制
          -> Step 6 教师目录、分配与学生入口
          -> Step 7 资产失效与停用
          -> Step 8 匿名反馈包
            -> Step 9 R3 故障/恢复/兼容回归与人工验收
```

### 4.6 跨文件副作用登记表

| 主变更 | 必须同步修改或核验 |
|---|---|
| 持久化发布来源 / principal 映射 | `schema.sql`、迁移、DB fixtures、SQL 触发器/唯一约束、repository、备份恢复、Schema 验证；若 Step 1 不能避免，移交单独 R3 决策，当前计划停止 |
| `PREVIEW_ONLY` policy | `src/shared/types/strategy.ts`、`json-schemas.ts`、`validate-question-policy.ts`、strategy service/query、session snapshot、策略 fixture、版本冻结与兼容测试 |
| 新命令或事件 | `m5a-command-definitions.ts` 的封闭 command/read 注册表、`handler-registry.ts`、`scripts/lib/m5b-runtime-inventory.mjs` 及其测试，public errors、planner、M5B executor、payload types/validator、event persist、projector/reducer、recovery、idempotency/fault matrix |
| 题目/资产导入与可用性 | runtime authority/manifest parser、hash validator、`question_bank`/`asset_resource` repository、renderer registry、错误码、dry-run、隔离数据库 fixture |
| 预览 session | assessment planner/service、session snapshot、question selection、answer/offline/observation、assignment/grant、safety triggers、completion/result/report/query 测试 |
| IPC/read API | handler registry、handler、preload、`ipc-api.ts`、参数/error type、auth session guard、handler tests；renderer 不直接读 SQLite/仓库 JSON |
| 路由/UI | router guard、teacher navigation/layout、Pinia store、目录/详情/题包/反馈视图、student session UI、deep link、a11y 与性能检查 |
| 结果/报告隔离 | assessment completion、job-skill score/result/report services、queries、report export、reducer/replay、历史 18+6 regression |
| 学校反馈 | 本地 userData repository、IPC/文件保存、HTML 模板、JSON schema、敏感数据检测、Markdown generator、revision 测试、导出脱敏审计 |
| 新/改文档 | `doc/index.md` 自动清单；运行 `npm run docs:index:update` 和 `npm run docs:index:check` |

## 5. 实施步骤

### Step 1：R3 持久化可行性证明与停止门

**目的与理由：** 验证“无 Schema/migration”是否真的能满足独立双发布来源、职责分离、恢复和匿名映射；这是所有写代码前的阻断门。

**前置状态：** 当前 v0.1.18 Schema 与 M5B command boundary；不得访问默认数据库。

**完成状态：** 仅在隔离 SQLite fixture 上证明全部 AC-19/20 的持久化、重启恢复和反向越权拒绝，才可将结论记录为可继续。否则创建单独的 R3 Schema/数据合同决策及其 PRD/review，当前实施计划状态为 `BLOCKED`，不做任何运行时代码改动。

**改动文件及职责：** 本步骤只可新增决策/审查文档和隔离探针；不得修改现有 Schema、默认库、题目、资产或发布状态。

**关键检查：**

- 逐项映射策略 JSON、domain event、durable ledger 和现有表到 §4.4 所有事实，证明不可变性、唯一性、范围约束与恢复来源；“能序列化 JSON”不等于证明。
- 在隔离库验证正式先、预览先、重复同 hash、同 ID 异 hash、prepare 后崩溃、apply 前失败和重启恢复。
- 验证 auth sender 绑定的 ACTIVE ADMIN 只能由可信上下文提供；CLI 同样必须交互认证且上下文仅在本进程。
- 验证反馈真实 ID 映射从不进入 HTML/JSON/Markdown、日志或 AI prompt。

**精确验证命令：** `npm run db:verify`；新增 probe 后执行其定向 test；`npm run typecheck`；`npm run lint`；`git diff --check`。

**停止条件：** 任一事实只能依赖可编辑 JSON、没有唯一约束/审计关联、不能在恢复时读取冻结事实，或需要新增列/表/触发器，即停止并走独立 R3 决策。

**回滚方式：** 删除未采用的隔离测试库和临时 fixture；不修改任何运行时数据。

**建议 commit message：** `docs(job-skill): record preview persistence feasibility decision`

### Step 2：双发布来源、签名批准和 delivery mode 合同（条件步骤）

**前置：** Step 1 通过，或独立 R3 Schema/数据合同决策、审查和迁移验收均已批准。

**目的与理由：** 定义唯一的持久化来源模型与 validator，不能以 `question_bank.status` 代替来源证明。

**完成状态：**

- 策略 policy 使用显式判别 `delivery_mode: FORMAL_DEMO | PREVIEW_ONLY`；只允许冻结兼容注册表中精确 strategy ID/version 的旧正式 policy 缺字段。缺失、未知、拼写错误和任何基于题量/名称/task code 的猜测分别失败关闭。
- 责任清单与批准使用固定 Ed25519 信任根直接验签，冻结 payload/hash、scope、pack、题目语义、资产、renderer、审核证据、期限（最长 30 天）、signer principal 和 executor 映射。
- 正式与预览 publish set 分别可查询、可审计、不可互相推导；`ACTIVE` 只反映存在至少一条有效运行授权。

**数据、事务与失败恢复：** 所有持久化结构、迁移和回滚遵循独立 R3 决策；migration 必须幂等、可升级，历史 18+6 仅由冻结兼容注册表解释为 `FORMAL_DEMO`。

**测试设计：** 表驱动 AC-19；签名篡改、时间边界、未知 mode、兼容表外 legacy、伪造 principal、映射缺失/多值、signer=executor 和双来源反向越权负向测试。

**验证：** 定向 validator/迁移/策略测试、`npm run db:verify`、`npm run typecheck`、`npm run lint`。

**回滚：** 回滚尚未引用的新策略/来源版本；禁止删除已引用审计事实或重写正式策略。

### Step 3：隔离内容包、资产包与逐题可用性读模型（条件步骤）

**目的与理由：** 在不以全局 Phase 4 门禁阻断目录的前提下，导入 298 当前版本并复算局部可用性。

**完成状态：** 非破坏性 dry-run/commit 导入核对 298 数量、模块/题型/用途、source/current ID、version、candidate/semantic/runtime-authority hash；既有引用题语义变化新版本化。状态计算输出全部稳定原因码，目录查询不写库。

**不得改变：** 不在已有业务库执行 `DELETE FROM question_bank WHERE bank_domain = 'JOB_SPECIFIC'`；未批准资产不得写 `asset_resource.ACTIVE`；`M5_OP_048_V4` / `M5_OP_055_V3` 保持计分实操，`M1_OB_048_V3` 保持唯一观察题。

**改动范围：** content/asset import service、authority/manifest parser、question/asset validator、availability query、错误码、isolated fixtures；按需要登记 command/event 全链。

**测试：** 298/298 对账、重复同 hash 幂等、同 ID 异 hash 拒绝、引用题不覆盖、99 rubric hash 对账、资产许可/文件/renderer 缺失、局部批次不影响无关题、dry-run 零写入。

**验证：** `npm run contract:job-skill:check`、`npm run contract:job-skill:delivery:check`、定向 importer/validator tests、隔离 DB test、`npm run typecheck`、`npm run lint`。

**回滚：** 只停用新内容/资产版本和新 pack 候选；保留历史引用和审计。

### Step 4：`JOB_SKILL_PREVIEW_PACK_RELEASE` durable 原子发布（条件步骤）

**目的与理由：** 将精确题目由候选变为可分配的 PREVIEW_ONLY pack，并使批准、授权来源与策略冻结在同一提交边界。

**核心伪代码：**

```text
accept durable command -> load trusted sender/CLI auth context
-> derive executor principal only from signed mapping
-> verify separation, signature, expiry, scope, exact hashes, all item gates
-> PREPARE frozen event batch
-> one transaction: promote only approved DRAFT items; attach preview source for all items;
   persist immutable pack/strategy + responsibility/approval references + audit facts
-> APPLY projections; return persisted public result
```

**完成状态：** AC-20 两种顺序均通过，任何一项失败整个命令回滚；DISABLED/ARCHIVED 不复活；同 approval ID/hash 重放；冲突/过期/失败留 durable 公开结果；dry-run 完全零写入。

**跨文件登记：** `m5a-command-definitions.ts` 的封闭 mutation/read 注册表、`handler-registry.ts`、`scripts/lib/m5b-runtime-inventory.mjs` 及其 tests、command definition/envelope/public error、planner、M5B executor、event payload/validator/projector/recovery、strategy repository、auth guard、双 publish source query、IPC/CLI boundary、fault matrix。

**测试：** SQLite 事务故障注入（每个写入点）、PREPARE 崩溃重启、APPLY 恢复、并发相同/不同幂等 key、正式先/预览先、每个签名/hash/期限/身份失败路径，及 `FORMAL_RELEASE_AUTHORITY_MISSING` / `PREVIEW_RELEASE_AUTHORITY_MISSING`。

**验证：** 定向 durable-command、event-batch/recovery、release integration tests，`npm run db:verify`、`npm run typecheck`、`npm run lint`。

**回滚：** 停用当前 pack 的新分配，不撤销历史 session；只能以新版本修复，不原地篡改已引用 pack。

### Step 5：PREVIEW_ONLY session 快照、执行与正式结果抑制（条件步骤）

**目的与理由：** 复用 assessment 生命周期与安全边界，却禁止预览进入正式结果/报告路径。

**完成状态：** 创建 session 时新增与旧 payload 兼容的 `SESSION_STARTED` 预览判别版本（不得把字段塞入现有 BASE_ABILITY 专用 v1/v2），冻结 `delivery_mode`、pack ID/version、strategy ID/version/policy hash、正式与预览来源 ID/hash、题目 ID/version/semantic hash、asset ID/hash、renderer version/hash、评分/线下材料/安全停止条件和整体 snapshot root hash。parser 对既有 v1/v2 保持原行为；未知 payload version 或冻结 root hash 不匹配失败关闭。reducer、prepared projector、恢复和回放只读取已冻结 payload，不重新查询当前策略/题库/资产/授权读模型。

预览完成使用显式 `PREVIEW_SESSION_COMPLETED` 事件及其判别载荷，事件链为 `SESSION_STARTED(preview snapshot) -> 作答/线下评分/观察事实 -> PREVIEW_SESSION_COMPLETED`；它在 payload、validator、JSONL、event-batch、assessment reducer/projector、recovery 与 replay 中完成全链登记。正式 18+6 保持原有 `RESULT_CALCULATED -> SESSION_COMPLETED -> report` 事实链。不得让预览复用会触发正式投影的 `RESULT_CALCULATED`。

在生产 M5B `scoring-planner` clone 规划路径、结果事件生成和 report fragment 拼接点首先解析冻结 delivery mode：`PREVIEW_ONLY` 只计划预览完成投影和公开作答情况，绝不计划 `RESULT_CALCULATED`、`result_record`、JOB_SKILL 报告事件或 `task_report`；`FORMAL_DEMO` 才允许原 48 分 JOB_SKILL result/report 路径。不得依赖 UI、事后删除或只修改旧 result/report service。

**失败恢复：** 资产 hash 在启动/恢复/进入题目/提交时失效，记录 `TECHNICAL_INTERRUPTION`，保留既有答案，不给 0 分、不换题；红线仍按已有同学生-岗位-任务触发链先熔断。终态不回开。

**改动范围：** `event-payloads.ts`、assessment event contract/parser、assessment session snapshot builder、assessment planner/service、M5B `scoring-planner.ts`、scoring/assessment projector、result/report event planners and services、selection、answer/offline/observation flows、recovery、query/fixture 与现有 18+6 regression tests。

**测试：** formal 与 preview session 分别冻结和重放；删除或漂移当前策略、题目、资产或授权读模型后，仍只按 preview/formal snapshot 恢复；未知 payload version/root hash 失败关闭；PREVIEW session 题包冻结、观察题不能独包、观察题不计分、asset failure、重复命令、恢复、红线、assignment/grant。对 PREVIEW_ONLY 完成线下评分、观察、重复命令、恢复和红线逐项断言没有 `RESULT_CALCULATED`、`result_record`、report event 或 `task_report`，但作答事实、`PREVIEW_SESSION_COMPLETED` 与安全链可回放；历史 18+6 同路径仍产生 `RESULT_CALCULATED`、48 分正式结果和报告。

**回滚：** 停止新 pack 分配；兼容读取已有预览快照，不能删除 session/event/answers。

### Step 6：教师目录、题包分配和学生入口（条件步骤）

**目的与理由：** 交付教师 298/298 目录与受限分配，而不泄露答案或题库给学生。

**完成状态：** TEACHER 可按 M1-M6、题型、线上/线下、复核、素材与可作答状态分页筛选、看详情和原因码；只可分配已发布且当前可分配的 pack。STUDENT 只见自己的 session 快照与批准素材。ADMIN 发布/导入入口只接受可信认证上下文。

**改动范围：** read/mutation handlers、preload、`ipc-api.ts`、shared request/response types、auth policy、queries、Pinia stores、teacher layout/navigation/router/deep-link guard、目录/详情/分配视图与 student assessment view。

**测试：** handler 权限矩阵、pagination/filter empty result、答案/rubric 不泄露、CATALOG_ONLY 不可分配、direct route 无 session 拒绝、298 计数、preload/channel registration；Playwright/Electron 人工桌面走查。

**a11y/性能验收：** 键盘、触控、焦点、对比度、大字号、低认知负荷；目标设备目录首屏小于 2 秒、筛选/分页小于 500ms。

**回滚：** 移除新导航和入口、停止新分配；不改变历史正式页面或 session。

### Step 7：资产批次、停用和运行中失效（条件步骤）

**目的与理由：** 让素材生产并行且局部生效，防止一项缺失扩散为全库阻断或静默损坏。

**完成状态：** P0/P1/P2 资产批次按 machine validation + 人工审批 + hash 投影 + 受影响题重算 + 新 pack 版本发布流程工作；资产缺失、损坏、许可未清、renderer 漂移会局部禁用新分配。旧 pack session 用冻结快照处理技术中断或安全熔断。

**测试：** manifest/文件/hash/asset_resource 四方一致性、版权 false、批量失败原子性、无关 pack 不回退、旧 session 与新 asset 版本并发、不可把静态图片替代动态线索。

**回滚：** `DEPRECATED` 缺陷资源及停用受影响新 pack；用新 asset/question/pack 版本恢复，保留历史。

### Step 8：匿名学校反馈包（条件步骤）

**目的与理由：** 将真实课堂问题反馈为可审核的 JSON，而不外泄真实身份或改写内容治理。

**完成状态：** 自包含 HTML 自动保存、必填校验、最终脱敏预览、JSON 权威导出、由 JSON 生成 Markdown；导出仅含匿名学校/subject/session 引用、pack/question/asset 版本和结构化问题。真实 ID 映射仅存本机 userData，反馈 revision 不覆盖历史，提交不能激活题目、资产或策略。

**测试：** 无网络运行、自动保存失败、必填拒绝、姓名/电话/身份证/邮箱检测、显式脱敏确认、稳定 ID 重导出、revision、导出内容无真实 ID/映射/日志泄漏、JSON-to-Markdown 确定性。

**回滚：** 隐藏导出入口并保留本地草稿/既有导出；禁止清理已经形成的审计证据。

### Step 9：R3 全量验证、回退演练与独立验收（条件步骤）

**目的与理由：** 把跨边界、故障、兼容和人工体验证据集中闭合；每个前置步骤先用 `/vibe-accept step <id>` 记录结果，未通过不得前进。

**完成状态：** 通过第 6 节矩阵，独立 `/vibe-review` 和 `/vibe-accept` 没有未关闭 P0/P1；发布前演练正反双发布顺序、故障回滚和从 durable PREPARE 恢复。

**回滚：** 停用新预览 pack/导航，保持正式 18+6 运行；数据保留、不可物理删除。

## 6. 全量回归矩阵

| 类别 | 必测证据 |
|---|---|
| 数据与导入 | 298 数量/分布/hash、DRAFT 增量 upsert、已有引用不可改写、asset 批次局部影响、rubric/观察题语义对账 |
| 发布与身份 | 两发布顺序、签名/期限/hash/scope、可信 sender/CLI ADMIN、映射缺失/多值/伪造、signer-executor 分离、幂等/冲突/dry-run |
| 持久化恢复 | durable command 请求 hash、事务故障注入、PREPARE/APPLY 崩溃恢复、无半 ACTIVE/半 pack、历史事件回放 |
| 会话与安全 | snapshot、assignment/grant、同任务开放唯一性、暂停恢复、asset failure、redline、终态保护、观察题不独包/不计分 |
| 结果隔离 | PREVIEW 零正式 result/report/level/placement/跨包统计；18+6 保持 JOB_SKILL_SCORE、48 分和正式来源门禁 |
| IPC/UI | handler/preload/shared types 同步，RBAC、分页/筛选、答案不泄露、deep link、Electron 离线 smoke |
| 反馈与隐私 | 本地草稿、匿名导出、PII 阻断、revision、JSON 权威、Markdown 仅生成物、没有真实 ID 或映射泄漏 |
| 回退 | 停用新包、目录入口回退、历史预览/正式 session/答案/事件仍可读，旧版本不得静默替换题目 |

预期命令（按实际新增文件补充定向 test 路径）：

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run db:verify
npm run contract:job-skill:check
npm run contract:job-skill:delivery:check
npm run docs:index:check
git diff --check
```

所有数据库测试必须显式创建隔离临时数据库；不可声称这些命令在本计划阶段已经执行或通过。

## 7. 人工验收矩阵

| 场景 | 预期 |
|---|---|
| 教师目录 | 离线看到 298/298，缺口题仍可见且有具体原因；筛选、详情、键盘/触控可用 |
| 正式先发布 | 同一题仍不是预览可分配题，直到独立预览批准和 pack 发布完成 |
| 预览先发布 | 同一题不能用于固定 18+6，正式来源缺失明确报错 |
| 题包会话 | 教师仅分配已发布 pack；学生只见快照；红线和缺资产按失败关闭处理 |
| 反馈 | HTML 自动保存；带真实身份信息的外发文本被拒绝；最终 JSON/MD 不含真实 ID |
| 回退 | 停用 pack 后不能新分配，历史事实仍可追溯，正式 18+6 不受影响 |

## 8. 残余风险与后续项

1. 当前无 Schema 前提与 R3 审计/身份/匿名映射要求存在明确冲突，必须先由独立 Schema/数据合同决策处理；这不是可由 ADMIN 手工流程替代的实现细节。
2. 99 道线下计分题的 `rubric_anchor_status` 与当前 semantic hash 对账、以及 270 项中首批最小资产集合，属于开始发布前必须完成的事实输入。
3. 视觉可访问性和目标设备性能需要真实 Electron 人工验收，`INV-A11Y-001` 目前没有全覆盖自动门禁。
4. 每个实际步骤完成后执行 `/vibe-accept step <id>`；本计划必须先经独立 `/vibe-review impl`，通过后才能申请实施授权。
