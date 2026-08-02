# JOB_SKILL 298 题全量预览版 PRD R3 独立审查记录

## 1. 审查结论

**CONDITIONAL_PASS**

独立审查未发现尚未处理的 P0。审查者最后提出 2 项 P1：共享 `question_bank.status = ACTIVE` 时正式/预览两条发布顺序未闭合，以及执行 ADMIN 的可信 `principal_id` 来源不能机械证明。作者已在审查结束后补入双发布来源、正式先/预览先顺序规则、签名责任清单和 `user_account.user_id ↔ principal_id` 映射，但这两项修订尚未由独立 Reviewer 重新验证。

因此，当前 Mini-PRD 状态只能是 `REVIEWED`，不能标记为 `APPROVED`，也不能据此进入 `/vibe-impl`。后续须由独立 Reviewer 对最后两项修订做闭合复核；结论达到 `PASS` 后，才可批准实施。

## 2. 审查范围

- 审查类型：PRD
- 风险等级：R3
- 审查日期：2026-07-31
- 被审查工件：`doc/features/job-skill-298-full-preview-prd.md`
- 同步核验工件：`doc/specs/MVP_PRD_v1.0.9-authoritative.md`、`doc/features/job-skill-shelver-current-contracts.md`、`doc/specs/baseline.yaml`、`doc/index.md`、`AGENTS.md`
- 权威基线：`doc/specs/baseline.yaml`、`doc/specs/project-invariants.md`、`doc/ai/vibe-workflow-contract.md`
- 独立 Reviewer：`/root/review_job_skill_298_prd`
- 独立性：Reviewer 全程只读，未修改文件；作者根据审查意见修订工件
- 未审查内容：实现计划、运行时代码、Schema 变更、默认业务数据库、真实学校部署、真实题包发布和 AI 素材生产

适用不变量：`INV-EVT-001` 至 `INV-EVT-006`、`INV-SAFE-001` 至 `INV-SAFE-004`、`INV-AUTH-001`、`INV-AUTH-002`、`INV-RES-001`、`INV-RES-002`、`INV-STR-001`、`INV-STR-002`、`INV-IPC-001`、`INV-IPC-002`、`INV-DATA-001` 至 `INV-DATA-003`、`INV-A11Y-001`。

## 3. 审查轮次与处理结果

| 轮次 | 独立结论 | 主要发现 | 当前处理状态 |
|---|---|---|---|
| 首轮 | REJECT | 旧二元安全键与当前三元安全键冲突；PREVIEW_ONLY 红线终止仍可能生成正式结果；delivery mode 兼容边界、反馈隐私、旧 Phase 4 总门禁和素材商用授权不完整 | 已在后续修订中处理，Reviewer 已确认关闭 |
| 第二轮 | CONDITIONAL_PASS | 顶层并发口径、delivery mode 负向矩阵、DRAFT→ACTIVE 与题包发布的授权/原子边界不完整；纯观察题包缺直接验收 | 已在后续修订中处理，Reviewer 已确认关闭 |
| 闭合复核 | CONDITIONAL_PASS | 正式先激活/预览先激活时，共享 ACTIVE 可能互相越权；ADMIN `principal_id` 缺可信机械映射 | 作者已修订，尚待独立复核 |

工作流允许的两轮自动修订已经用完。本记录保留独立 Reviewer 的最终 `CONDITIONAL_PASS`，不把作者侧最后修订自行提升为 `PASS`。

## 4. 最后两项 P1 的作者侧修订

### P1-01 共享 ACTIVE 的双授权来源

已补入以下合同：

1. `PREVIEW_RELEASE_CANDIDATE` 可以是仍为 DRAFT 的题，也可以是已由正式链或其他有效来源转为 ACTIVE、但尚无预览批准的题。
2. `JOB_SKILL_PREVIEW_PACK_RELEASE` 只把包内仍为 DRAFT 的精确版本转为 ACTIVE；已 ACTIVE 的同语义版本只增加 PREVIEW_ONLY 发布引用，不重写状态。
3. FORMAL_DEMO session 必须独立验证正式 Phase 4/正式发布来源，缺失时返回 `FORMAL_RELEASE_AUTHORITY_MISSING`。
4. PREVIEW_ONLY session 必须独立验证责任清单、预览批准和题包发布引用，缺失时返回 `PREVIEW_RELEASE_AUTHORITY_MISSING`。
5. AC-20 同时覆盖“正式先激活后进入预览包”和“预览先激活但正式门禁仍失败关闭”两个顺序。

### P1-02 执行主体的可信机械映射

已补入以下合同：

1. 每个题包版本同时要求产品负责人信任根签名的责任清单和预览发布批准。
2. 责任清单绑定计划执行发布的 `user_account.user_id ↔ principal_id` 唯一映射。
3. Electron 只能从当前 sender 绑定且仍 ACTIVE 的 auth session 取 `user_id`；独立 CLI 必须在目标库交互验证 ACTIVE ADMIN 后建立本进程认证上下文。
4. 映射缺失、多值、签名无效、请求正文伪造/覆盖映射，或执行人与签发人实际为同一 principal，均失败关闭。
5. AC-20 已加入上述正负 fixture 和职责分离断言。

## 5. 已执行验证

独立 Reviewer 在闭合复核时执行并报告：

| 检查 | 状态 | 结果 |
|---|---|---|
| 文档索引 | PASS | `docs:index:check` 通过 |
| JOB_SKILL 权威合同 | PASS | 两项合同检查通过，运行时 SQL 仍保持阻断状态 |
| 素材 Manifest | PASS | 270 项均为 planned，0 项 approved；校验器通过 |
| TypeScript 类型检查 | PASS | 退出码 0 |
| 相关定向测试 | PASS | 18 个测试通过 |
| lint | PASS | 0 error；663 个既有 warning |
| diff 卫生 | PASS | `git diff --check` 通过 |

作者完成最后两项 P1 的文档修订后重新执行：`docs:index:check`、两项 JOB_SKILL 合同检查、素材 Manifest 校验、TypeScript 类型检查、lint 和 `git diff --check` 均通过；`job-skill-shelver-contract-chain` 7 项、`job-skill-shelver-delivery-lock` 6 项、`job-skill-shelver-phase4` 5 项定向测试共 18/18 通过。这些证据只能证明文档与既有合同未发生机械漂移，不能替代最后两项 P1 所需的独立设计复核。

[!] 全量测试不是全绿。作者会话执行全量测试及 `scripts/__tests__/m5b-runtime-inventory.test.mjs` 时，后者 38 项中 12 项失败、26 项通过；失败来自工作树中本任务开始前已有的 BASE_ABILITY Step 3 代码变化，包括 `applySessionStartedV2` 新入口、直接调用点 262→264 和冻结 checkout digest 漂移。本次仅更新文档，未改写这些代码，也未通过更新冻结 inventory 掩盖失败。

## 6. 发布与实施边界

- 当前仅更新产品合同和新会话导航，不代表 298 题预览功能已经实现或上线。
- 当前运行时仍只有固定 18+6 正式 JOB_SKILL 路径；教师全库目录、PREVIEW_ONLY 题包、反馈出口和正式结果抑制分支尚不存在。
- 当前 authority 中 298 题仍为 DRAFT；运行时 SQL 继续保持阻断。
- 本轮未修改 Schema、migration、权限角色、默认业务数据库、题目状态或素材状态。
- 99 道线下计分题的 rubric 审核 hash 对账和首批题包资产依赖审计仍需完成；它们是内容/发布门禁，不再阻断 298 题先进入教师可见目录。

## 7. 后续闭合条件

后续独立 Reviewer 必须至少确认：

1. Mini-PRD、权威 PRD 和当前合同对共享 ACTIVE、双发布来源、正式先/预览先顺序的定义完全一致。
2. 签名责任清单、可信认证上下文、`user_id ↔ principal_id` 映射和职责分离负例足以机械实现，且没有要求 ADMIN 自报身份。
3. AC-20 与错误码能覆盖上述两项 P1，不存在只写说明、没有验收的缺口。
4. 若复核结论为 PASS，再将 Mini-PRD 从 `REVIEWED` 更新为 `APPROVED` 并进入 `/vibe-impl`；否则继续保持停止状态。

## 8. 置信度

对产品路线和范围边界为 HIGH：298 题全量进入教师可见预览库、素材 AI 并行生产、逐题包开放、预览不生成正式结果已经跨权威 PRD、Mini-PRD 和当前合同统一。

对实施可批准性为 CONDITIONAL：最后两项 P1 已有作者侧修订，但尚缺独立闭合复核，不能以本记录替代 Reviewer 的 PASS。
