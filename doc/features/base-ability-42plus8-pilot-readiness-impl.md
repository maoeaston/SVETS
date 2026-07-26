# BASE_ABILITY 42+8 正式施测补料实施计划

## 1. 实现目标

将 `doc/features/base-ability-42plus8-pilot-readiness-prd.md` 转换为可逐步实施、验证和回滚的 Q1 计划。目标是先在显式临时数据库和合成身份上闭合 42 道线上题 + 8 道线下题的内容、组卷、作答、评分、事件、恢复、报告和授权门禁，再允许经独立批准执行受控 Pilot 激活。

本计划不等同于 Pilot 已激活或课堂试测已完成。真实题目在有效独立批准前必须保持 `DRAFT`；没有当前有效学校授权时，真实 session 不得创建或继续。

## 2. 基线与范围

- PRD：`doc/features/base-ability-42plus8-pilot-readiness-prd.md`，状态 `REVIEWED`，风险 `R3`。
- 权威产品合同：`doc/specs/MVP_PRD_v1.0.9-authoritative.md`。
- 权威 Schema：`src/main/db/schema.sql`，基线 `schema v0.1.16-report-framework`。
- 权威运行时合同：`src/shared/types/json-schemas.ts`、`src/shared/types/event-payloads.ts`、`src/shared/types/ipc-api.ts`。
- 当前基线：`6077635`，分支 `feat/multi-device-m2-prd`；计划以当前工作树为起点，不覆盖用户已有改动。
- 影响域：`UI_UX`、`DOMAIN_LOGIC`、`DATABASE_MIGRATION`、`EVENT_PROJECTION`、`IPC_API`、`AUTH_PERMISSION`、`SAFETY_FSM`、`RESULT_REPORT`、`ASSET_CONTENT`、`DEPLOYMENT_OPERATIONS`。
- 明确不做：正式标准化量表解释、就业安置或 `placement_advice`；自动将 Pilot ACTIVE 升格正式发布；真实学生数据进入技术演练；覆盖历史题目、策略、session、结果或报告；新增 ORM、前端持久化库、CSV 解析库或 Markdown 报告渲染库；超出两个既定 CHECK 枚举的 Schema 扩展。

## 3. 适用不变量

- `INV-EVT-001`、`INV-EVT-002`、`INV-EVT-003`：状态由事件推进，写入顺序固定，新事件完成 payload、持久化、reducer、回放和测试全链登记。
- `INV-SAFE-001`、`INV-SAFE-002`、`INV-SAFE-003`、`INV-SAFE-004`：授权失效不能绕过既有安全熔断；安全状态迁移必须走批准路径。
- `INV-AUTH-001`、`INV-AUTH-002`：TEACHER/ADMIN 边界和业务 session、device grant、assignment 三方一致性不可削弱。
- `INV-RES-001`、`INV-RES-002`：`ABILITY_SCORE` 与其他结果独立，安全语义优先于普通分数。
- `INV-STR-001`、`INV-STR-002`：session 绑定同一策略版本，历史引用策略不可原地漂移。
- `INV-IPC-001`、`INV-IPC-002`：新增 IPC 完成 handler/preload/shared type/权限/错误映射登记，renderer 不得访问 Node。
- `INV-DATA-001`、`INV-DATA-002`、`INV-DATA-003`：JSON 写入前校验，策略数据来自配置，迁移可前滚、可重放、可验证。

## 4. 变更地图

### 当前状态

96 条 `BASE_ABILITY` 候选均为 `DRAFT`、`NO_SCORE`，尚无完整 v1.2 题目合同、素材/教具绑定或可用于 Pilot 的 50 题固定清单。当前组卷器仍按旧 `question_ratio` 工作；基础能力读取条件、`SOFTWARE_TASK` renderer、作答事件、统一评分快照和授权失效处置均不完整。已有线下评分入口只能覆盖局部流程。

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
候选清单/题目合同
  -> v1.2 策略与组卷门禁
  -> renderer + response contract + scoring
  -> event/reducer/recovery + authorization FSM
  -> report/evidence + synthetic temp-db drill
  -> independent approval verification
  -> controlled activation (DRAFT -> PILOT_ACTIVE)
  -> school/student authorization runtime checks
```

### 跨文件副作用登记表

| 主变更 | 必须同步核验 |
|---|---|
| 新 `EventType` | `event-payloads.ts`、validator、event writer、reducer、recovery、JSONL/projection、幂等/冲突测试 |
| 两个 reason 枚举 | `schema.sql`、migration、shared type、domain contract、assignment/session handler、旧库前滚/回滚测试 |
| 组卷规则 | `strategy_config`、paper generator、assessment handler、session snapshot、策略版本测试 |
| 统一评分 | answer payload 校验、scoring snapshot、result projection、report contract、旧题型回放测试 |
| 新 IPC 或权限动作 | handler、`src/preload/index.ts`、`src/shared/types/ipc-api.ts`、auth context、错误映射和负向测试 |
| 新 renderer/路由入口 | Vue route/view/store、题型状态、无障碍、Electron smoke 和 viewport 测试 |
| 激活/授权包 | 固定信任根、签名/主体分离、有效期/revision、目标库保护、审计与重复执行测试 |
| 审核/资产产物 | 自包含 HTML、JSON 权威结果、manifest/hash、文档索引和不得直接激活的门禁测试 |

## 5. 实现步骤

### Step 2-9 共通状态约束

- Step N 只有在 Step N-1 的 `/vibe-accept step <N-1>` 结论为 `PASS` 后才可开始；`FAIL`、`BLOCKED`、`NOT_RUN` 或 `AUTOMATION_PASS_MANUAL_PENDING` 均表示尚未闭环，必须停在当前 Step。Step 7 的审核工具和 Step 9 的受控入口可以单独记录工程子项 `PASS`，但外部原件缺失时该 Step 总状态仍按“完成状态”保持 `BLOCKED` 或 `NOT_RUN`，工程子项状态不授权进入下一 Step 或执行真实激活。
- 每一步必须分别记录三类状态：工程验收结论、分阶段机器门禁状态、非测试数据库中的题目/session 状态。不得用其中一类的 `PASS` 推断另外两类也已通过。
- Step 2-8 的构建、测试、门禁生成和技术演练不得把任何非测试数据库中的 BASE_ABILITY 题从 `DRAFT` 改为 `ACTIVE`；Step 8 的合成 `ACTIVE` fixture 只能存在于命令行显式指定的临时库。
- 任一“完成状态”只能由该 Step 的精确命令、产物 hash、数据库断言和 `/vibe-accept` 证据共同证明。命令未执行记 `NOT_RUN`，外部原件或环境缺失记 `BLOCKED`，不得写成已完成。
- 进入下一 Step 前必须核对真实 diff、跨文件副作用登记和 `git diff --check`。发现范围扩大到 PRD 未批准的 Schema、状态机、权限模型或正式解释时立即停止，重新进行 R3 审查。

### Step 1：冻结 42+8 候选清单与 v1.2 题目合同

**目的与理由：** 把 96 条候选变成可审计的 50 题 DRAFT 运行输入，先解决来源、题型、模块、合同 hash 和观察项混入问题。

**前置状态：** `contract:base-ability:gate:check` 仍可证明候选来源未漂移；无任何真实题目激活。

**完成状态：** 生成版本化清单，线上 6 模块各 7 题、线下 8 题、观察项为 0；每题有结构化 `presentation/interaction/expected_evidence/support_policy/termination_policy`、答案或 rubric、来源 hash 和合同 hash；提交审核不改变 DB 状态。

**改动文件及职责：**
- `doc/features/base-ability-42plus8-pilot-readiness-prd.md` 引用的清单、审核包和 JSON schema：定义 50 题机器权威及版本绑定。
- `scripts/build-base-ability-42plus8-gate.mjs`、`scripts/lib/base-ability-42plus8-gate.mjs`：输出阶段化门禁、阻断码、hash 和题集统计。
- `scripts/__tests__/base-ability-42plus8-gate.test.mjs` 及新增合同测试：覆盖缺题、重复题、模块配额、观察项和 hash 漂移。

**数据、事务与失败恢复：** 只生成 DRAFT/审核产物，不写默认运行库；任一 hash 或来源不一致整体失败关闭。

**精确验证命令：** `npm test -- scripts/__tests__/base-ability-42plus8-gate.test.mjs`；`npm run contract:base-ability:gate:check`；`git diff --check`。

**回滚方式：** 删除/替换本步骤新生成的版本化候选产物，不触碰历史审核结果和运行库。

**停止条件：** 50 题无法满足模块/线上线下配额、题目合同与权威 PRD 冲突、或需要改变题目状态时停止并重审。

### Step 2：收口 `strategy_config` 与 42+8 组卷器

**目的与理由：** 消除旧固定题型比例与 v1.2 模块配额的冲突，确保 session snapshot 可重复。

**前置状态：** Step 1 的 `/vibe-accept step 1` 为 `PASS`；冻结清单恰好包含 42 道 ONLINE + 8 道 OFFLINE、每个模块 ONLINE 7 道且观察项为 0；50 道入选题和 46 道未选题在所有非测试数据源中仍为 `DRAFT`；`activation_authority_granted = false`。

**完成状态：** 新 `question-policy-v1.2` 策略可在不读取 `question_ratio` 的情况下稳定生成相同 42+8；session snapshot 冻结题目 ID/版本/hash、策略 ID/版本、seed 和模块配额；不足、越域、观察项、未注册 renderer 和重复候选均以稳定错误失败；历史策略仍可按明确兼容分支读取；`/vibe-accept step 2` 为 `PASS`，产品门禁仍未进入技术演练就绪状态。

**不得改变：** 不得原地修改已被引用的 `strategy_config`；不得把 JOB_SPECIFIC、OBSERVATION_ONLY、DRAFT 真实题或未选 46 题作为替补；不得静默降低 42+8 或恢复 14/14/14；不得改变题目状态、结果阈值或默认运行库。

**改动文件及职责：**
- `src/main/domain/paper-generator.ts`：按 v1.2 `online_quota_by_module` 生成每模块 7 题，过滤 `BASE_ABILITY + SCORED_ITEM + renderer 可用`，线下固定 8 题，保留 seed 可复现。
- `src/main/ipc/handlers/assessment.ts`、相关 repository/query：只从冻结策略和合格候选组卷，并保存题目/策略/hash 快照。
- `src/shared/types/json-schemas.ts`、策略校验和现有 paper-generator 测试：禁止旧 `question_ratio` 偷渡和模块配额不足。

**测试设计：** 纯函数覆盖精确 42+8、每模块 7、重复/不足、seed 重放和非 BASE_ABILITY/观察项排除；集成测试覆盖 session 绑定策略版本和历史策略不可变。

**精确验证命令：** `npm test -- src/main/domain/__tests__/paper-generator.test.ts src/main/utils/__tests__/validate-question-policy.test.ts src/main/ipc/handlers/__tests__/assessment-create.test.ts src/main/ipc/handlers/__tests__/strategy-create-version.test.ts`；`npm run typecheck`。

**回滚方式：** 仅回退组卷器和新增策略版本，保留已有 session snapshot；不得原地改被引用策略。

**停止条件：** 只能通过改变旧历史策略、混入 JOB_SPECIFIC、或无法保存完整 snapshot 才能通过时停止。

### Step 3：统一线上响应、评分和非计分路径

**目的与理由：** 用冻结 `scoring_rule_json` 替代题型硬编码，保证 0/2、非计分 NULL、support/timing/metrics 和评分快照可复算。

**前置状态：** Step 2 的 `/vibe-accept step 2` 为 `PASS`；新 session 已能冻结唯一题目/策略/hash 快照；旧 `ANSWER_SUBMITTED` 历史 fixture 和 action log 基线已固化，可用于新旧事件混合回放对照；非测试库仍无新响应事件写入。

**完成状态：** `QUESTION_RESPONSE_SUBMITTED` 与 `QUESTION_RESPONSE_NOT_SCORED` 完成 shared payload、validator、JSONL 持久化、reducer/projection、recovery 和幂等/冲突测试全链登记；所有线上题只产生 0/2 或 NULL；同一历史混合新旧事件后 answer、进度、终态和 scoring snapshot 可确定重放；`/vibe-accept step 3` 为 `PASS`。

**不得改变：** 不得删除或重解释旧 `ANSWER_SUBMITTED`；不得由 renderer 提交最终分数或读取答案；不得把技术故障、P3 协助或安全停止记为 0；不得让普通 response 自动创建安全 incident；不得直接修改 session 投影或重写历史 JSONL。

**改动文件及职责：**
- `src/shared/types/assessment.ts`、`src/shared/types/event-payloads.ts`、`src/shared/types/json-schemas.ts`：定义统一 response envelope、线上题型 payload、非计分原因和 `scoring_snapshot`。
- `src/main/ipc/handlers/assessment.ts`：校验题目属于本人 session，读取已冻结合同，事务内写响应事件并调用 reducer；重复、终态、越权和错误 shape 均失败。
- `src/main/domain/assessment-reducer.ts`、`src/main/domain/recovery.ts`：登记新响应/非计分事件，旧 `ANSWER_SUBMITTED` 只作为兼容输入，保证幂等、乱序和冷启动重放。
- `src/main/domain/ability-scoring.ts` 或现有评分模块、测试 fixture：实现 EXACT_MATCH 等合同化评分，不把安全停止当错误 0 分。

**测试设计：** 各题型正常/错误/缺字段；`SOFTWARE_TASK`；技术故障、题目不适用、P3 协助、安全停止；重复提交、并发唯一约束、事件写入失败回滚；旧事件回放与新事件结果一致。

**精确验证命令：** `npm test -- src/main/ipc/handlers/__tests__/assessment-answer.test.ts src/main/domain/__tests__/assessment-reducer.test.ts src/main/domain/__tests__/recovery.test.ts`；`npm run typecheck`。

**回滚方式：** 保留旧 `ANSWER_SUBMITTED` 回放分支；新事件只在新策略/session 中启用，不能删除旧事件识别。

**停止条件：** 无法同时保留旧日志回放、评分快照和新合同，或出现安全事件由普通响应自动创建时停止。

### Step 4：完成线上 renderer、线下评分和 IPC 白名单

**目的与理由：** 让学生能操作所有获选线上交互，让教师按审核锚点评 8 道线下题，并确保 renderer 只经 preload 访问主进程。

**前置状态：** Step 3 的 `/vibe-accept step 3` 为 `PASS`；入选 42 道线上题的 `question_type + interaction_type` 精确集合已经冻结；主进程 response/评分合同可在无 renderer 的测试中独立通过；8 道线下 rubric 与教具合同 hash 已可供只读绑定。

**完成状态：** 入选交互全部命中显式 renderer registry，合法/非法 shape、触控和键盘替代路径均有证据；8 道线下题只允许教师按当前 rubric hash 写 `OFFLINE_ABILITY`；新增/修改 IPC 已同步 handler、`src/main/ipc/index.ts`、preload、shared type、权限、错误映射和负向测试；三个规定 viewport 的实际 content viewport 检查通过；`/vibe-accept step 4` 为 `PASS`。

**不得改变：** 不得实现未入选交互、在 renderer 暴露答案/评分规则、绕过 preload 访问 Node/数据库、把 `OFFLINE_ABILITY` 混入 `TASK_OPERATION`，或因组件异常推进题目/会话状态；不得激活真实题目。

**改动文件及职责：**
- `src/renderer/src/views/`、`src/renderer/src/components/`、`src/renderer/src/stores/`：按 `question_type + interaction_type` 渲染，支持键盘/触控/AAC 替代、求助、技术异常和安全状态。
- `src/main/ipc/handlers/ability-scoring.ts`：验证 TEACHER/ADMIN、session/题集归属、rubric 版本、重复评分和 `OFFLINE_ABILITY` scope。
- `src/shared/types/ipc-api.ts`、`src/preload/index.ts`：登记现有或新增通道、参数和错误映射。
- `src/main/ipc/handlers/__tests__/assessment-ability-scoring.test.ts`、renderer 组件测试/E2E：覆盖部分补交、重复、权限、回滚和无重叠布局。

**精确验证命令：** `npm test -- src/main/ipc/handlers/__tests__/assessment-ability-scoring.test.ts src/main/ipc/handlers/__tests__/assessment-answer.test.ts`；`npm run lint`；`npm run typecheck`；按现有 Playwright 白名单执行 `1366x768 / 1280x720 / 375x812`。

**回滚方式：** 按题型逐步启用新 renderer；保留现有 assessment route 和旧事件消费路径。

**停止条件：** renderer 绕过 preload、学生可见答案/评分规则、或安全/终态切换发生重叠时停止。

### Step 5：实现授权生命周期、失效处置与受限 Schema migration

**目的与理由：** 将产品批准、学校授权和逐学生同意变成可验证、有限期、可撤销/轮换的链，并在失效后可靠终止或隔离 session。

**前置状态：** Step 4 的 `/vibe-accept step 4` 为 `PASS`；当前已知默认运行库的 migration/Schema/账号/题库漂移已通过独立运维任务核实并使 `npm run db:verify` 返回退出码 0，否则本 Step 为 `BLOCKED`；所有非测试数据库和 JSONL 均尚未写入两个新 reason 或两个新事件；迁移前数据库与 JSONL hash 已记录。

**完成状态：** Schema 只扩展两个已批准 CHECK 值；产品、学校、逐学生同意的状态派生、租约/revision/时钟水位、撤销/替代/泄漏和最早失效事实均可验证；授权失效通过事件链关闭 sitting/session、释放 grant/assignment 并隔离重叠终态，红线并发仍保持 `REDLINE_HALTED`；写入前 down 和写入后 expand-only 两阶段测试通过；`/vibe-accept step 5` 为 `PASS`。

**不得改变：** 不得新增表、列、授权状态枚举、assessment 状态或第二套 session/assignment；不得接受 caller 自报身份、客户端时间或 ADMIN 自签授权；不得直接 UPDATE 受控状态；不得映射、删除或降格新 reason/事件以回到旧 CHECK/旧二进制；不得覆盖安全终态或历史 bytes。

**改动文件及职责：**
- `src/main/db/schema.sql`、`src/main/db/migrations.ts`：仅扩展 `assessment_sitting.end_reason = ENDED_BY_AUTHORIZATION_INVALIDATION` 和 `business_session_assignment.release_reason = AUTHORIZATION_INVALIDATED`；保持既有状态机和安全 trigger。
- `src/shared/types/event-payloads.ts`、`src/main/domain/event-writer.ts`、reducer/recovery：登记 `STUDENT_CONSENT_WITHDRAWAL_REPORTED`、`PILOT_AUTHORITY_PROVENANCE_REVIEW_REQUIRED` 及授权失效/释放 payload。
- `src/main/ipc/handlers/`、auth context、assignment/grant service：从可信 ACTIVE auth session 解析身份，实施 TEACHER 只减权撤回、ADMIN 不得自授，复用三方一致链。
- `src/main/db/__tests__/migrations.test.ts`、schema/assignment/safety/assessment tests：覆盖前滚、写入前可 down、写入后 expand-only、旧库回放、授权时间矩阵、终态不可复活、红线优先和并发重复处置。

**核心流程：** 授权校验失败 -> 同一事务/事件链停止当前 sitting 输入 -> `SESSION_ABORTED`/终止原因 -> 释放 grant/assignment -> 对运行区间重叠终态追加 provenance review 并隔离 result/report/evidence；安全红线并发时只保留红线终态。

**精确验证命令：** `npm run db:verify`；`npm test -- src/main/db/__tests__/migrations.test.ts src/main/ipc/handlers/__tests__/assignment.test.ts src/main/ipc/handlers/__tests__/assessment-redline.test.ts src/main/domain/__tests__/recovery.test.ts`。

**回滚方式：** 新 reason 尚未写入真实库前允许受控 down；一旦有真实新 reason 或新事件，禁止回到不识别它们的旧 CHECK/旧应用，只能使用 expand-only 兼容版本。

**停止条件：** 需要新增表/状态机、覆盖授权原件、依赖 caller 自报身份、或无法证明失效时间关系时停止并重审 PRD。

### Step 6：接通 ABILITY_SCORE、Pilot 报告和证据隔离

**目的与理由：** 使 42 道线上 + 8 道线下的能力分数独立可解释，同时保留 Pilot 限制和授权失效后的永久隔离。

**前置状态：** Step 5 的 `/vibe-accept step 5` 为 `PASS`；新旧 reason/事件可由兼容 reducer/recovery 确定重放；完整、非计分、红线、授权失效和晚到失效 session fixture 均已固定；报告生成仍以现有 `report_content_json` 合同为输入。

**完成状态：** 只有 42 道有效线上响应与 8 道有效线下评分满足冻结策略时才生成独立 `ABILITY_SCORE`；非计分、不完整、红线和来源隔离路径均阻断普通完整结论；报告固定呈现 `PILOT_ONLY`、完成率、支持/非计分和效度限制，历史报告 bytes 可复现；`/vibe-accept step 6` 为 `PASS`。

**不得改变：** 不得把 `ABILITY_SCORE` 与其他结果混算，不得让普通分数覆盖安全语义，不得把 NULL 变成 0，不得修改历史 result/report bytes，不得输出正式诊断、正式量表、placement advice 或把课堂证据缺失反向阻断首次 Pilot 激活评审。

**改动文件及职责：**
- `src/main/ipc/handlers/assessment.ts`、result reducer/projector：只在全部有效线上响应和 8 道线下评分满足条件时生成 `ABILITY_SCORE`；非计分/红线/授权失效不得被普通分数覆盖。
- `src/main/domain/report-contract.ts`、`src/main/ipc/handlers/reports.ts`、报告 Vue 组件：呈现 `PILOT_ONLY`、完成率、支持/非计分限制和 evidence provenance，不输出正式诊断或 placement advice。
- `src/main/domain/__tests__/report-contract.test.ts`、report generation/assessment scoring tests：覆盖完整、部分完成、非计分、红线、安全优先、授权隔离和历史报告复现。

**精确验证命令：** `npm test -- src/main/domain/__tests__/report-contract.test.ts src/main/domain/__tests__/report-generation.test.ts src/main/ipc/handlers/__tests__/assessment-ability-scoring.test.ts`；`npm run e2e:report`。

**回滚方式：** 新报告 schema/version 与旧报告读取兼容并行；不得修改历史 report bytes。

**停止条件：** 结果混算、非计分被记为 0、或报告将 Pilot 语言升级为正式结论时停止。

### Step 7：建立人工审核包、资产/教具 manifest 与内容门禁

**目的与理由：** 让内容、测评、安全/康复/特教/无障碍审核结果成为机器可校验的前置条件，且审核入口不具备激活权限。

**前置状态：** Step 6 的 `/vibe-accept step 6` 为 `PASS`；Step 1 冻结的 50 题及其逐题内容/评分/renderer hash 未漂移；所有非测试数据源仍为 96 道 DRAFT、0 道 ACTIVE；旧 `base-ability-42plus8-activation-gate-v1.json` 只作为不可覆盖的历史单阶段快照。审核人尚未提供时可以实现生成/导入工具，但本 Step 不得完成，也不得进入 Step 8。

**完成状态：** 两轨自包含 HTML、严格结果 Schema、两份只读审核 JSON、合并审核门禁、视觉资产 manifest 和 8 题教具 manifest 均通过；每个必需轨道都有当前 hash 的人工结论，任一退回/缺失均失败关闭；分阶段门禁产物进入 `READY_FOR_TECHNICAL_REHEARSAL`，`activation_authority_granted = false`，课堂试测证据仍为 `PENDING/NOT_RUN`，50+46 题仍为 DRAFT；`/vibe-accept step 7` 为 `PASS`。外部审核原件缺失时工程工具可记 `PASS`，但 Step 7 总状态必须为 `BLOCKED`。

**不得改变：** 审核 HTML、结果导入和 gate build 均不得写运行库或执行激活；不得把 Markdown 当机器权威；不得覆盖审核原件、v1 门禁、无关资产及其 hash；不得提交私钥、学生身份、健康信息或原始观察数据；缺专业责任人时不得把人工门写成通过。

**改动文件及职责：**
- `scripts/build-base-ability-42plus8-review-packets.mjs`、`scripts/lib/base-ability-42plus8-review.mjs`：确定性生成两轨审核包和结果 Schema；支持 `--check`，不得读取或写入运行库。
- `scripts/ingest-base-ability-42plus8-review-results.mjs`：只读校验两份审核原件，复算 reviewer、题目集合、逐题 hash、必需轨道和汇总，生成合并门禁；不得覆盖输入原件。
- `doc/features/base-ability-42plus8-content-assessment-review-packet-v1.html`、`doc/features/base-ability-42plus8-safety-accessibility-review-packet-v1.html`：内容/测评轨与安全/康复/特教/无障碍轨自包含填写入口。
- `doc/features/base-ability-42plus8-content-assessment-review-result-v1.schema.json`、`doc/features/base-ability-42plus8-safety-accessibility-review-result-v1.schema.json`：两轨机器结果合同。
- `doc/features/base-ability-42plus8-content-assessment-review-result-v1.json`、`doc/features/base-ability-42plus8-safety-accessibility-review-result-v1.json`：审核人导出的只读原件；文件不存在时结果检查必须 `BLOCKED`，生成脚本不得创建伪结果。
- `doc/features/base-ability-42plus8-review-gate-v1.json`、`doc/features/base-ability-42plus8-review-gate-v1.schema.json`：合并后的逐题/逐轨人工审核权威，只引用原件 bytes/hash。
- `doc/assets/asset-manifest.json`、`doc/assets/asset-manifest.schema.json`：登记入选题必需视觉资产、版权、感官标签、人工门和 `app://asset/<asset_id>`。
- `doc/assets/base-ability-offline-toolkit-manifest-v1.json`、`doc/assets/base-ability-offline-toolkit-manifest-v1.schema.json`：精确登记 8 道线下题的稳定 item/setup ID、数量、摆位、复位、清洁、风险和替代限制。
- `scripts/build-visual-asset-manifest.mjs`、`scripts/validate-visual-asset-manifest.mjs`：构建/校验视觉资产；不得改变无关 270 项的语义或 hash。
- `scripts/build-base-ability-42plus8-gate.mjs`、`scripts/lib/base-ability-42plus8-gate.mjs`：生成分阶段 v2 门禁和稳定阻断码。
- `doc/features/base-ability-42plus8-pilot-gate-v2.json`、`doc/features/base-ability-42plus8-pilot-gate-v2.schema.json`：替代 v1 成为当前分阶段机器门禁；v1 文件保留不覆盖。
- `doc/features/base-ability-current-contracts.md`、`doc/index.md`：将当前入口指向 v2 并同步文档索引。
- `scripts/__tests__/base-ability-42plus8-review.test.mjs`、`scripts/__tests__/base-ability-42plus8-gate.test.mjs`、`scripts/__tests__/visual-asset-manifest.test.mjs`：覆盖缺审核/资产/教具、hash 漂移、旧审核失效、结果不改题目状态和敏感内容扫描。
- `package.json`：新增 `review:base-ability:42plus8:build`、`review:base-ability:42plus8:check`、`review:base-ability:42plus8:results:check`；既有 `contract:base-ability:gate:build/check` 改为生成/检查 v2。

**精确验证命令：**

```bash
npm test -- scripts/__tests__/base-ability-42plus8-review.test.mjs scripts/__tests__/base-ability-42plus8-gate.test.mjs scripts/__tests__/visual-asset-manifest.test.mjs
npm run review:base-ability:42plus8:build
npm run review:base-ability:42plus8:check
npm run review:base-ability:42plus8:results:check
npm run asset:validate
npm run contract:base-ability:gate:build
npm run contract:base-ability:gate:check
npm run docs:index:update
npm run docs:index:check
git diff --check
```

`review:base-ability:42plus8:results:check` 必须读取上面两份精确 JSON 原件；外部审核尚未返回时该命令和 Step 7 均记 `BLOCKED`，不得用 fixture 或 Markdown 替代。

**回滚方式：** 版本化替换审核包/manifest，保留原始 JSON 和 hash；不得直接写 ACTIVE。

**停止条件：** 审核 HTML 能直接激活、Markdown 被当作机器权威、或素材/教具缺少专业责任人时停止。

### Step 8：合成身份临时库技术演练与故障注入

**目的与理由：** 在真实课堂之前证明跨模块链路可重复、可恢复、不会污染默认数据库。

**前置状态：** Step 7 的 `/vibe-accept step 7` 为 `PASS`；`doc/features/base-ability-42plus8-pilot-gate-v2.json` 精确处于 `READY_FOR_TECHNICAL_REHEARSAL` 且 `activation_authority_granted = false`；两份人工审核原件、50 题权威、策略、renderer、资产和教具 hash 与 gate 引用一致；默认数据库的存在状态及 SHA-256 可在演练前读取。

**完成状态：** 单一显式临时库完成主路径和全部故障注入，冷启动重放与在线投影一致；同一冻结时钟/seed 重跑后 session snapshot、事件语义序列、result/report 与 gate 证据一致；默认数据库在运行前后的存在状态和 SHA-256 完全相同；v2 门禁只推进到 `READY_FOR_PILOT_ACTIVATION_REVIEW`，`activation_authority_granted = false`，真实激活、学校授权和课堂试测仍为 `NOT_RUN/BLOCKED`；`/vibe-accept step 8` 为 `PASS`。

**不得改变：** 不得缺省或推断数据库路径，不得解析到默认 userData/`xc-career-guide.db`，不得使用真实 student/teacher/admin 或真实签发件，不得将合成 ACTIVE fixture、结果、报告或证据写回仓库/默认库，不得把演练证据解释为专业审核、真实激活或课堂试测。

**演练内容：** 使用显式临时库、合成 student/teacher/admin、固定 50 题和策略 hash；执行创建 session -> 组卷 -> 42 题线上作答 -> 8 题线下评分 -> 事件投影/报告 -> 重启恢复。注入重复提交、并发写、事件投影缺失、设备/grant 释放失败、授权在创建前/运行中/终态后失效和红线并发。

**改动文件及职责：**
- `scripts/run-base-ability-42plus8-rehearsal.mjs`、`scripts/lib/base-ability-42plus8-rehearsal.mjs`：要求显式 `--db` 与 `--evidence-dir`，拒绝默认库/仓库内路径；只接受已经 `db:sync` 和 `db:verify` 通过的临时基线库，再建立合成身份/授权/ACTIVE fixture，运行主路径与故障矩阵并输出确定性证据。
- `scripts/e2e/base-ability-42plus8-flow.mjs`：在构建产物上复用显式临时 userData，见证 42+8 主路径、技术中断、安全停止/红线、中断恢复、授权失效终止和晚到失效隔离。
- `scripts/__tests__/base-ability-42plus8-rehearsal.test.mjs`：覆盖缺 `--db`、默认库同路径/软链接、仓库路径、重复运行、hash 保护和证据结构。
- `src/main/ipc/handlers/__tests__/base-ability-pilot-flow.test.ts`：覆盖 42+8 IPC 主链、并发/终态/非计分、grant/assignment/device 三方一致。
- `src/main/domain/__tests__/base-ability-pilot-recovery.test.ts`：覆盖投影丢失、混合事件、冷启动重放、授权失效和红线优先。
- `package.json`：新增 `rehearsal:base-ability:42plus8` 与 `e2e:base-ability:42plus8` 精确入口；`scripts/db-verify.mjs` 继续复用现有 `--db` 参数。

**精确验证命令：**

```bash
npm test -- scripts/__tests__/base-ability-42plus8-rehearsal.test.mjs src/main/ipc/handlers/__tests__/base-ability-pilot-flow.test.ts src/main/domain/__tests__/base-ability-pilot-recovery.test.ts
npm run typecheck
npm run lint
npm run build
REHEARSAL_ROOT="$(mktemp -d /tmp/svets-base-ability-42plus8.XXXXXX)"
npm run db:sync -- --db "$REHEARSAL_ROOT/userData/data/xc-career-guide.db"
npm run db:verify -- --db "$REHEARSAL_ROOT/userData/data/xc-career-guide.db"
npm run rehearsal:base-ability:42plus8 -- --db "$REHEARSAL_ROOT/userData/data/xc-career-guide.db" --evidence-dir "$REHEARSAL_ROOT/evidence"
npm run e2e:base-ability:42plus8 -- --db "$REHEARSAL_ROOT/userData/data/xc-career-guide.db" --evidence-dir "$REHEARSAL_ROOT/evidence/electron"
npm run contract:base-ability:gate:check
git diff --check
```

**完成证据：** `$REHEARSAL_ROOT/evidence/rehearsal-summary.json`、`default-db-before.sha256`、`default-db-after.sha256`、`session-snapshot.json`、`event-sequence.jsonl`、`result-record.json`、`report-content.json`、`gate-state.json` 以及 `$REHEARSAL_ROOT/evidence/electron/` 下的日志和截图全部存在并通过脚本复核。`REHEARSAL_ROOT` 仅用于当前命令进程，不写入仓库或产品配置。

**回滚方式：** 删除本步骤创建的临时目录/数据库；不得删除默认运行库或历史产物。

**停止条件：** 任何真实库写入、合成身份进入仓库运行数据、恢复结果与在线结果不一致、或故障注入无法确定失败码时停止。

### Step 9：独立批准校验与受控激活入口

**目的与理由：** 将技术就绪与外部批准分离，确保只有固定信任根、有效生命周期、独立主体和可信执行上下文才能把选定 50 题激活为 Pilot。

**前置状态：** Step 8 的 `/vibe-accept step 8` 为 `PASS`，v2 门禁为 `READY_FOR_PILOT_ACTIVATION_REVIEW` 且 `activation_authority_granted = false`；生产验证器所需产品负责人公钥/指纹已经通过单独安装版审查，否则只能实现纯逻辑与合成测试，Step 9 总状态保持 `BLOCKED`。真实激活还必须另有当前 ACTIVE 的签名批准链、显式 Pilot 目标库、可写备份目录和用户对该次运维操作的明确授权；这些条件不得从测试通过推断。

**完成状态：** 工程层面，固定根、签名/schema/hash/主体独立性、生命周期、可信 ADMIN 身份、目标库/备份/集合和事务幂等的正负测试全部通过，`/vibe-accept step 9` 可对“受控入口实现”给出 `PASS`；若真实外部批准尚未提供，产品门禁仍为 `READY_FOR_PILOT_ACTIVATION_REVIEW`、`activation_authority_granted = false`，真实激活记 `NOT_RUN/BLOCKED`。只有在另行授权执行真实命令且全部原件有效时，门禁才可先派生 `PILOT_ACTIVATION_APPROVED`，事务成功后成为 `PILOT_ACTIVE`：恰好 42 ONLINE + 8 OFFLINE 为 ACTIVE、其余 46 题仍为 DRAFT；学校授权和逐学生同意未通过时仍不得创建或继续真实 session。

**不得改变：** 构建、测试、gate check 和审核提交不得自动执行真实激活；不得从批准包、数据库、CLI、环境变量或 ADMIN 输入替换信任根；不得接受 `callerUserId`、role、`principal_id` 或账号凭据参数；不得激活 96 题、扩大签名集合、部分提交或把已激活题退回 DRAFT；不得把产品批准替代学校授权/个人同意，也不得推进课堂证据或正式解释状态。

**改动文件及职责：**
- `src/shared/types/pilot-authorization.ts`：定义签发件、分离签名信封、生命周期事件/索引、派生状态、稳定主体映射、激活请求/结果和错误码。
- `doc/features/base-ability-pilot-authorization/base-ability-pilot-authorization-contracts-v1.schema.json`：以带 discriminator 的 `$defs` 精确定义 `pilot-product-owner-trust-anchor-v1`、批准人/学校登记、责任清单、激活批准、学校课堂授权、逐学生同意、三类生命周期事件/索引和分离签名信封。
- `doc/features/base-ability-pilot-authorization/README.md`：固定只读 authority bundle 的文件布局、签名 bytes、绝对路径参数、备份与输出合同；不得存放真实私钥、账号凭据或学生原始证据。
- `src/main/domain/pilot-product-owner-trust-anchor.ts`：只包含经单独审查并随安装版发布的产品负责人稳定 `principal_id`、`key_id`、Ed25519 公钥和指纹；生产路径不提供运行时覆盖。
- `src/main/domain/pilot-authorization-contract.ts`：解析 Schema、精确 UTF-8 bytes/hash、Ed25519 分离签名、上下游绑定和最大期限。
- `src/main/domain/pilot-authorization-lifecycle.ts`：派生状态、revision/链/租约/时钟水位、撤销/替代/泄漏和稳定 `invalidation_fact_id`。
- `src/main/domain/pilot-activation-service.ts`：在事务内校验目标库、备份、冻结 50 题/策略/hash、幂等键和前后集合，只执行获批 `DRAFT -> ACTIVE`。
- `src/main/cli/pilot-activation.ts`、`src/main/index.ts`：提供 `--pilot-activate` 运维模式；只从目标库交互认证 ACTIVE ADMIN，凭据只存在当前进程内存且不进入 argv/env/log。
- `src/main/ipc/handlers/pilot-activation.ts`、`src/main/ipc/index.ts`、`src/preload/index.ts`、`src/shared/types/ipc-api.ts`：登记 Electron 激活通道，从 sender 绑定的 ACTIVE `auth_session` 解析执行人并完成权限/参数/错误映射。
- `src/main/domain/__tests__/pilot-authorization-contract.test.ts`、`src/main/domain/__tests__/pilot-authorization-lifecycle.test.ts`、`src/main/domain/__tests__/pilot-activation-service.test.ts`：覆盖签名链、期限边界、状态机、主体分离、集合/hash、幂等与整体回滚。
- `src/main/ipc/handlers/__tests__/pilot-activation.test.ts`、`src/main/ipc/handlers/__tests__/pilot-session-authorization.test.ts`：覆盖可信 sender、伪造 caller、三条授权链、session 每个写边界和 grant/assignment/device 负向路径。
- `src/main/cli/__tests__/pilot-activation.test.ts`：覆盖显式目标库、交互认证、argv/env 凭据拒绝、备份和失败无写入。
- `scripts/e2e/base-ability-pilot-activation.mjs`：基于已验证临时基线库启动生产 composition root，证明批准包/数据库/CLI/env 不能替换固定根，伪造身份和无效批准均失败且目标库无写入；正向合成批准/激活由上述领域、IPC 和 CLI 测试通过依赖注入的临时 Ed25519 根覆盖，测试根不得进入生产 composition root，测试私钥不落仓库。
- `package.json`：新增 `pilot:base-ability:activate`（`electron out/main/index.js --pilot-activate`）和 `e2e:base-ability:pilot-activation`（`node scripts/e2e/base-ability-pilot-activation.mjs`）。

**精确验证命令（只使用临时库和合成签名）：**

```bash
npm test -- src/main/domain/__tests__/pilot-authorization-contract.test.ts src/main/domain/__tests__/pilot-authorization-lifecycle.test.ts src/main/domain/__tests__/pilot-activation-service.test.ts src/main/ipc/handlers/__tests__/pilot-activation.test.ts src/main/ipc/handlers/__tests__/pilot-session-authorization.test.ts src/main/cli/__tests__/pilot-activation.test.ts
npm run typecheck
npm run lint
npm run build
PILOT_TEST_ROOT="$(mktemp -d /tmp/svets-base-ability-pilot-activation.XXXXXX)"
npm run db:sync -- --db "$PILOT_TEST_ROOT/baseline/xc-career-guide.db"
npm run db:verify -- --db "$PILOT_TEST_ROOT/baseline/xc-career-guide.db"
npm run e2e:base-ability:pilot-activation -- --temp-root "$PILOT_TEST_ROOT" --source-db "$PILOT_TEST_ROOT/baseline/xc-career-guide.db"
npm run contract:base-ability:gate:check
npm run docs:index:check
git diff --check
```

**真实激活命令合同（不属于自动验收，不得自动执行）：**

```bash
npm run build
npm run pilot:base-ability:activate -- --db /absolute/path/to/pilot/xc-career-guide.db --authority-bundle /absolute/path/to/read-only/authority-bundle --backup-dir /absolute/path/to/write-once/backups
```

三个路径参数必须是调用者逐次提供并经 `realpath` 校验的绝对路径；生产命令没有 `--trust-anchor`、`--user-id`、`--role`、`--principal-id` 或密码参数。真实路径和签名原件尚未提供时，该命令保持 `NOT_RUN`，计划不得猜测或生成替代值。

**回滚方式：** 激活失败事务整体回滚；已激活题不得退回 DRAFT 覆盖历史，只能停止新 session、禁用/归档旧版本并发布新题版本。

**停止条件：** 缺固定信任根、批准人和执行人主体冲突、目标库不明确、hash 不一致、批准已过期/撤销、或需要 ADMIN 自报身份时，状态保持 `BLOCKED`。

## 6. 全量回归矩阵

| 检查 | 时机 | 证据 |
|---|---|---|
| 类型检查 | 每个跨模块步骤后、最终 | `npm run typecheck`，退出码 0 |
| Lint | renderer/IPC/domain 变更后、最终 | `npm run lint`，退出码 0 |
| 单元/集成测试 | 每步定向、Step 8 全量 | `npm test` 与定向测试结果 |
| Schema/迁移 | Step 5、Step 8、最终 | `npm run db:verify`、migration 测试 |
| 构建 | Step 8/9、最终 | `npm run build` |
| 资产/题库门禁 | Step 1/7/9 | `npm run asset:validate`、`npm run contract:base-ability:gate:check` |
| 报告回归 | Step 6/8 | `npm run e2e:report`、report contract tests |
| 文档索引 | 新增本计划后及后续文档变更 | `npm run docs:index:check` |

所有未实际执行的项目必须标记 `NOT_RUN`，环境缺失标记 `BLOCKED`，不得以计划代替通过证据。

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

- [!] PRD 已明确的现状冲突必须在实现中关闭：旧 `question_ratio`、基础能力查询过滤、硬编码评分、`ANSWER_SUBMITTED` 独占、两个 reason CHECK 缺口。每项关闭都要对应代码和测试证据。
- 题目最终选择、资产数量、线下教具和 renderer 组合在 Step 1 前仍可能变化；一旦清单冻结，后续不得无记录扩张。
- 产品根、公钥、批准人和学校责任人签名必须在仓库外/离线管理；本计划不生成或存储私钥。
- 操作系统级替换已审查安装包属于部署完整性风险，不由本地批准 JSON 解决，需纳入发布验收。
- 真实课堂试测、专业签字、学校授权、逐学生同意和正式解释仍是外部依赖，工程测试不能替代这些验收。

## 9. Reviewer 入口

计划完成后执行独立审查：

```text
/vibe-review impl doc/features/base-ability-42plus8-pilot-readiness-impl.md
```

审查输入应同时包含本 PRD、适用不变量、R3 风险、当前基线 `6077635` 和本计划引用的实际代码范围。出现未关闭 P0、跨文件登记遗漏、不可回滚中间状态或把 R3 降级为机械任务时，计划状态为 `BLOCKED`，不得进入编码。
