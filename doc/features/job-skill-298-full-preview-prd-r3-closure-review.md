# JOB_SKILL 298 题全量预览版 PRD R3 独立闭合复核报告

## 审查结论

**PASS**

本轮在不沿用旧 Reviewer 结论的前提下，先独立读取当前 Mini-PRD、权威 PRD、当前合同、Schema、真实工作树差异和相关认证代码，最后才读取旧 R3 记录并把其中两项 P1 当作待验证命题。复核未发现 P0 或未关闭 P1：

- 共享 `question_bank.status = ACTIVE` 已被明确降为“至少一条授权链成立”的库内事实；FORMAL_DEMO 与 PREVIEW_ONLY 各自复验独立发布来源，正式先、预览先两个顺序均不能借共享 ACTIVE 越权。
- 执行 ADMIN 的 `user_id` 必须来自 Electron sender 绑定的有效 auth session，或目标库交互认证形成的 CLI 本进程上下文；已签名责任清单再把该 `user_id` 唯一映射为 `principal_id`，缺失、多值、伪造、签名无效或签发执行同主体均失败关闭。

存在 1 项不阻断实施批准性的 P2：`baseline.yaml` 的进度注记仍把已完成的 BASE_ABILITY Step 3 写成下一工作项。该项不改变产品合同、Schema 指针或本次两项 P1 的结论。

本报告只给出 PRD 审查结论，不修改 Mini-PRD 的 `REVIEWED / CONDITIONAL_PASS` 状态，不批准或实现功能，也不进入 `/vibe-impl`。状态更新留给后续作者会话。

## 审查范围

- 类型：PRD
- 风险：R3
- base/head：`f2a1504` / 当前 working tree（`feat/multi-device-m2-prd`，已知 dirty，领先远端 6 个提交）
- 被审查工件：`doc/features/job-skill-298-full-preview-prd.md`
- 同步核验工件：`doc/specs/MVP_PRD_v1.0.9-authoritative.md`、`doc/features/job-skill-shelver-current-contracts.md`、`src/main/db/schema.sql`
- 工作流与基线：`AGENTS.md`、`doc/specs/baseline.yaml`、`doc/specs/project-invariants.md`、`doc/ai/vibe-workflow-contract.md`、`vibe-coding-skills-v2/commands/vibe-review.md`
- 真实实现证据：`src/main/utils/auth-session.ts`、`src/main/ipc/handlers/strategy.ts`、JOB_SKILL 三个定向测试文件及当前 Git diff
- 适用不变量：`INV-EVT-001` 至 `INV-EVT-006`、`INV-SAFE-001` 至 `INV-SAFE-004`、`INV-AUTH-001`、`INV-AUTH-002`、`INV-RES-001`、`INV-RES-002`、`INV-STR-001`、`INV-STR-002`、`INV-IPC-001`、`INV-IPC-002`、`INV-DATA-001` 至 `INV-DATA-003`、`INV-A11Y-001`
- 独立性：在完整读取当前工件、权威资料、Schema、diff 和源代码证据后，最后读取 `doc/features/job-skill-298-full-preview-prd-r3-review.md`；旧记录和作者摘要未作为通过证据
- 未审查内容：未来 `/vibe-impl`、尚未存在的 PREVIEW_ONLY 运行时代码、真实发布包、真实学校部署、默认业务数据库、素材生成质量和人工可访问性验收

[!] 当前 Schema 没有 PREVIEW_ONLY 专用发布表、批准列或 `principal_id` 列，运行时也尚未实现本功能。Mini-PRD 已把这一区分为目标状态，并在 `doc/features/job-skill-298-full-preview-prd.md:247`、`:406-408` 设置实现停止条件：后续必须证明现有 strategy、审计和 durable command 边界足以承载；若不能，另立 R3 Schema 决策。因而这是已显式管理的实现风险，不是当前 PRD/Schema 静默冲突。

## 已执行检查

| 检查 | 状态 | 证据 |
|---|---|---|
| `git status --short --branch` | PASS | 退出码 0；分支 `feat/multi-device-m2-prd`，dirty 范围与交接一致，无 stash |
| 真实相关 diff | PASS | 完整读取新增 Mini-PRD，并核验权威 PRD、当前合同和 baseline 的 tracked diff；未修改被审查工件 |
| `git diff --check`（写报告前） | PASS | 退出码 0，无输出 |
| `npm run docs:index:check`（写报告前） | PASS | 退出码 0；`doc/index.md is current` |
| `npm run contract:job-skill:check` | PASS | 退出码 0；authority current，runtime SQL remains blocked |
| `npm run contract:job-skill:delivery:check` | PASS | 退出码 0；toolkit 与 delivery lock current |
| `npm run asset:validate` | PASS | 退出码 0；`total=270, planned=270, approved=0` |
| `npm run typecheck` | PASS | 退出码 0 |
| `npm run lint` | PASS | 退出码 0；0 error，663 个既有 warning |
| JOB_SKILL 三文件定向测试 | PASS | 退出码 0；3 files / 18 tests 全部通过 |
| `npm run docs:index:update` + `npm run docs:index:check`（报告落档后） | PASS | 两项退出码均为 0；`doc/index.md is current` |
| `git diff --check`（报告落档后） | PASS | 退出码 0，无输出 |
| 全量 `npm test` | NOT_RUN | 本交接未要求重跑；已知 BASE_ABILITY Step 3 未提交改动会触发 M5B frozen inventory 12 项失败，本报告不声明全量通过 |

定向测试命令：

```bash
npm test -- scripts/__tests__/job-skill-shelver-contract-chain.test.mjs scripts/__tests__/job-skill-shelver-delivery-lock.test.mjs scripts/__tests__/job-skill-shelver-phase4.test.mjs
```

关键输出：`Test Files 3 passed (3)`，`Tests 18 passed (18)`。

## P0

无。

## P1

无。旧记录中的两项 P1 均已由本轮独立证据闭合，详见“已核验通过的关键项”。

## P2

### [P2-01] baseline 进度注记仍指向已经完成的 BASE_ABILITY Step 3

- 位置：`doc/specs/baseline.yaml:78`；对照 `.continue-here.md:9-16`
- 证据：baseline 仍写“下一工作项是 BASE_ABILITY Step 3 评估”，而当前交接明确 Step 3 已验收 `PASS`，当前优先里程碑是 JOB_SKILL 298 题 R3 闭合复核，之后才恢复 Step 4。
- 触发条件：后续会话只依据 baseline 的进度注记选择下一工作项，而未同步读取 `.continue-here.md`。
- 影响：可能把已完成的 Step 3 再次排入队列，造成会话导航和进度陈述失真；不影响权威 PRD 路径、Schema 版本或本次两项 P1 的技术结论。
- 违反依据：`doc/会话启动.md` 要求启动时恢复 `Current Milestone / Next Action / Milestone Queue` 并如实表达当前状态；`doc/ai/vibe-workflow-contract.md` §6 要求状态结论有当前证据。
- 最小修复：后续作者会话在处理本次 PASS 状态时，同步把 baseline 该句更新为当前 JOB_SKILL 复核结果和后续 Step 4 队列；本 Reviewer 不修改被审查基线。
- 回归测试：`rg -n "下一工作项|BASE_ABILITY Step 3|JOB_SKILL 298" doc/specs/baseline.yaml .continue-here.md doc/会话启动.md`，再运行 `npm run docs:index:check`。

## NOTE / 待验证

### [NOTE-01] 当前机械测试证明旧合同未漂移，不证明目标功能已经实现

- `scripts/__tests__/job-skill-shelver-phase4.test.mjs:31-45` 仍证明 298 题全部为 DRAFT，旧 Phase 4 激活与 session 创建保持关闭。
- 当前源代码中不存在 `JOB_SKILL_PREVIEW_PACK_RELEASE`、`PREVIEW_ONLY`、`FORMAL_RELEASE_AUTHORITY_MISSING` 或 `PREVIEW_RELEASE_AUTHORITY_MISSING` 运行时实现。
- 这与 Mini-PRD `doc/features/job-skill-298-full-preview-prd.md:16-17` 的“目标状态，尚未实现”声明一致；后续实现必须新增 AC-19 至 AC-21 的目标行为测试，不能把本轮 18/18 当作功能验收。

### [NOTE-02] Goal 创建受线程现有 Goal 限制

- 本轮按交接尝试创建指定 Goal，系统返回“本线程已有未完成 Goal”；现有 Goal 正是附件任务入口，不能嵌套创建第二个 Goal。
- 审查仍在本次新 Reviewer 上下文中按完整独立顺序执行；该工具限制不改变工件、证据或结论。

## 已核验通过的关键项

### P1-A 共享 ACTIVE 的双发布授权来源

| 核验点 | 当前证据 | 结论 |
|---|---|---|
| 候选状态覆盖 DRAFT 与正式链已 ACTIVE | Mini-PRD `:193`、`:212`；权威 PRD `:1380` | PASS |
| 预览发布只对 DRAFT 执行状态变化，已 ACTIVE 只增加 PREVIEW_ONLY 引用 | Mini-PRD `:244`；权威 PRD `:1382-1384` | PASS |
| FORMAL_DEMO 独立复验正式来源 | Mini-PRD `:246`；权威 PRD `:1344`、`:1386` | PASS |
| PREVIEW_ONLY 独立复验责任清单、批准和题包引用 | Mini-PRD `:246`；权威 PRD `:1634` | PASS |
| 正式先、预览先均不能借 ACTIVE 越权 | Mini-PRD AC-20 `:566-568`；权威 PRD §17.12.21 `:4663` | PASS |
| 当前合同入口没有把 ACTIVE 误写成双授权 | `doc/features/job-skill-shelver-current-contracts.md:11` | PASS |
| 运行时仍逐次复验而非只在发布时检查 | Mini-PRD `:246` 与权威 PRD `:1634` | PASS |

状态机复算：

```text
DRAFT + 无来源
  -> 正式来源先成立: ACTIVE + FORMAL
       -> 独立预览批准: ACTIVE + FORMAL + PREVIEW
  -> 预览来源先成立: ACTIVE + PREVIEW
       -> 正式来源缺失: FORMAL_DEMO 失败关闭

任何 ACTIVE + 仅一条来源
  -> 另一 delivery_mode 均不能仅凭 ACTIVE 创建 session
```

AC-20 已直接包含正式先和预览先两个顺序；§6.3.1.6 同时固定两类缺失来源错误码。后续实现仍应把四种 `(formal_source, preview_source)` 组合做成表驱动测试，以证明合法来源补齐后的可达性和缺失来源的失败关闭。

### P1-B 执行 ADMIN 的可信 principal 映射

| 核验点 | 当前证据 | 结论 |
|---|---|---|
| 签名责任清单绑定题包、签发人和唯一 `user_id ↔ principal_id` 映射 | Mini-PRD `:241`；权威 PRD `:1381` | PASS |
| Electron 身份只取当前 sender 绑定的有效 auth session | Mini-PRD `:243`；`src/main/utils/auth-session.ts:254-293`、`:392-407` | PASS |
| CLI 必须在目标库交互验证 ACTIVE ADMIN，并只形成进程内上下文 | Mini-PRD `:243`；权威 PRD `:1383` | PASS |
| 缺失、多值、伪造、签名无效和同 principal 全部失败关闭 | Mini-PRD `:243-245`、AC-20 `:568` | PASS |
| 身份、签名、hash、逐题门禁、状态、引用、strategy 和审计同原子提交 | Mini-PRD `:244-245`；权威 PRD `:1384-1385` | PASS |
| Schema 现有身份事实可支撑可信 `user_id` 来源 | `src/main/db/schema.sql:92-104`、`:202-226`；auth helper 同时检查 session 期限、session 状态和 account 状态 | PASS |
| 跨文件副作用和无法承载时的停止条件明确 | Mini-PRD `:356`、`:247`、`:406-408` | PASS |

请求正文中的 `callerUserId`、角色或主体映射没有授权效力。现有 IPC 认证帮助器已经展示了可复用的可信模式：`resolveBoundAuthSessionSnapshot()` 由 sender 绑定解析会话，并拒绝过期、撤销或非 ACTIVE 账号；未来发布入口仍须按 AC-20 增加 ADMIN 角色、签名映射和职责分离的专项断言。

### 此前问题回归扫描

| 回归项 | 证据 | 结论 |
|---|---|---|
| 安全聚合键为 `student_id + job_code + task_code` | Mini-PRD `:147`、`:377`、AC-13 `:526` | PASS |
| PREVIEW_ONLY 正常完成、红线终止或作废均不生成正式 result/report | Mini-PRD AC-09 `:502`、AC-13 `:526` | PASS |
| delivery mode 兼容注册表、缺字段、未知值和拼写错误失败关闭 | Mini-PRD `:237`、AC-19 `:560-562` | PASS |
| 反馈外发使用随机匿名引用，自由文本默认不外发 | Mini-PRD `:306-309`、AC-15/16 `:538-550` | PASS |
| 素材具有来源、许可和 `commercial_use_cleared` 证据 | Mini-PRD `:298`、AC-11 `:514` | PASS |
| 纯 OBSERVATION_ONLY 题包被拒绝 | Mini-PRD `:234`、AC-21 `:570-574` | PASS |

## 残余风险

1. 发布批准、双授权来源和签名主体映射还没有运行时载体。`/vibe-impl` 必须先证明现有 `strategy_config`、事件审计和 durable command 能保持不可变引用与原子恢复；不能证明时必须停止并另立 R3 Schema 变更。
2. AC-20 已定义两个发布顺序的隔离语义，但当前仓库没有实现测试。实现计划应建立四态授权矩阵，并加入“预览先 ACTIVE 后正式来源补齐可成功”和“正式先 ACTIVE 后预览来源补齐可成功”的正向测试，以及两个缺失来源的负向测试。
3. 全量测试未在本轮重跑；相关 JOB_SKILL 定向测试、类型检查和 lint 已执行。已知的 12 项 frozen inventory 失败属于既有 BASE_ABILITY Step 3 工作树，不得用本报告推断全量绿灯。
4. 真实学校设备性能、可访问性、反馈脱敏和离线发布流程仍属于未来实现验收，不属于本轮 PRD 通过证据。

## 规则沉淀候选

- 将题目库内状态与 delivery-mode 发布来源建模为独立的表驱动授权矩阵，至少覆盖 `(FORMAL, PREVIEW) = 00/10/01/11` 和两个发布顺序。
- 将签名 `user_id ↔ principal_id` 映射的唯一性、请求覆盖拒绝、会话来源、CLI 交互认证和职责分离负例纳入统一发布授权 validator 与专项测试。
- 清理 baseline 中的易过期进度句，或把项目队列只保留在 `.continue-here.md`，避免权威基线与会话导航重复维护当前步骤。

## 置信度

**HIGH**。

限制：这是 R3 PRD 设计闭合复核，不是实现验收。结论建立在完整当前工件、权威 PRD、Schema、真实 diff、认证边界代码和本轮命令证据上；尚未实现的发布链、默认数据库和真实学校环境均未被写成通过。
