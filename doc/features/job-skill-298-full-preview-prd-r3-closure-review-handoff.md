# JOB_SKILL 298 题全量预览 PRD R3 独立闭合复核交接

## 当前状态

- 用户已经确认产品路线：298 题全量进入预览库、教师全库可见、素材 AI 并行生产、按逐题门禁组成不可变题包开放。
- `doc/features/job-skill-298-full-preview-prd.md` 当前状态为 `REVIEWED / CONDITIONAL_PASS`，尚未批准进入 `/vibe-impl`。
- 上一轮独立 Reviewer 最后留下 2 项 P1。作者随后补充了共享 ACTIVE 的双发布授权来源，以及签名 `user_id ↔ principal_id` 执行主体映射，但这两项修订尚未经过新的独立复核。
- 当前代码仍只有固定 18+6 的正式 JOB_SKILL 运行时。教师全库目录、PREVIEW_ONLY 题包、反馈出口和正式结果抑制分支尚未实现。
- 当前工作树包含本轮文档变化和此前 BASE_ABILITY Step 3 的未提交代码。它们必须原样保留。

本任务必须放在新的上下文中执行。当前会话只准备交接，不替代独立 Reviewer 下结论。

## Goal 目标

对 JOB_SKILL 298 题全量预览 Mini-PRD 的最后 2 项 P1 做独立 R3 闭合复核，重新核对当前工件、权威 PRD、Schema、项目不变量、真实 Git diff 和机械验证结果，形成可复算的 `PASS / CONDITIONAL_PASS / BLOCKED` 结论。

Goal 的完成条件是独立审查已经完成、证据已保存并如实报告。审查结论不必强行达到 `PASS`。如果仍有 P0/P1，记录问题后 Goal 仍可完成，但 Mini-PRD 继续保持未批准状态。

## 独立性与修改边界

1. 新会话中的 Codex 自身担任 Reviewer，不延续当前作者上下文的判断，也不把旧审查记录或交接摘要当作通过证据。
2. 被审查工件只读。不得修改以下文件的设计内容或状态：
   - `doc/features/job-skill-298-full-preview-prd.md`
   - `doc/specs/MVP_PRD_v1.0.9-authoritative.md`
   - `doc/features/job-skill-shelver-current-contracts.md`
   - `doc/features/job-skill-298-full-preview-prd-r3-review.md`
3. Reviewer 只允许新增独立结果文件 `doc/features/job-skill-298-full-preview-prd-r3-closure-review.md`，并按项目规则更新、检查 `doc/index.md`。
4. 不实现功能，不创建 `/vibe-impl`，不修改代码、Schema、migration、权限、题目状态、素材状态或默认业务数据库。
5. 不执行 `reset`、`restore`、`stash`、`commit`、`push`、merge 或 rebase，不清理现有未提交文件。
6. 不访问、初始化或修改默认数据库 `xc-career-guide.db`。所有检查限于只读文件、现有生成器和测试的临时夹具。

## 必读顺序

1. `AGENTS.md`
2. `doc/会话启动.md`
3. `.continue-here.md`
4. `.agents/skills/vibe-review/SKILL.md`
5. `doc/specs/baseline.yaml`
6. `doc/specs/project-invariants.md`
7. `doc/ai/vibe-workflow-contract.md`
8. `vibe-coding-skills-v2/commands/vibe-review.md`
9. 完整读取 `doc/features/job-skill-298-full-preview-prd.md`
10. 读取权威 PRD 中 JOB_SKILL 正式卷、PREVIEW_ONLY 发布、运行时边界和 §17.12 验收相关章节
11. `doc/features/job-skill-shelver-current-contracts.md`
12. `src/main/db/schema.sql` 中 `user_account`、`auth_session`、`question_bank`、`strategy_config` 及相关约束
13. 真实 `git status`、相关文档 diff 和必要源代码证据
14. 最后再读 `doc/features/job-skill-298-full-preview-prd-r3-review.md`，把其中 2 项 P1 当作待验证命题，不当作事实结论

## 必须闭合的 2 项 P1

### P1-A 共享 ACTIVE 的双发布授权来源

独立核验以下问题：

- `PREVIEW_RELEASE_CANDIDATE` 是否同时覆盖 DRAFT 题和由正式链先行转为 ACTIVE、但尚无预览批准的题。
- `JOB_SKILL_PREVIEW_PACK_RELEASE` 是否只把仍为 DRAFT 的精确版本转为 ACTIVE，对已 ACTIVE 的同语义版本只增加 PREVIEW_ONLY 授权引用，不重写状态。
- FORMAL_DEMO 是否必须验证独立的正式 Phase 4 或正式发布来源，缺失时稳定返回 `FORMAL_RELEASE_AUTHORITY_MISSING`。
- PREVIEW_ONLY 是否必须验证责任清单、预览批准和题包发布引用，缺失时稳定返回 `PREVIEW_RELEASE_AUTHORITY_MISSING`。
- 正式先激活和预览先激活两个顺序是否都被 AC-20 直接覆盖，且共享 ACTIVE 不会让两条交付路径互相越权。
- Mini-PRD、权威 PRD、当前合同入口和专项验收的表述是否一致，没有循环状态、不可达状态或遗漏的运行时复验点。

### P1-B 执行 ADMIN 的可信 principal 映射

独立核验以下问题：

- 产品负责人信任根签名的责任清单是否绑定题包、批准签发人和计划执行 ADMIN 的唯一 `user_account.user_id ↔ principal_id` 映射。
- Electron 是否只能从当前 sender 绑定且仍 ACTIVE 的 auth session 取得 `user_id`。
- 独立 CLI 是否必须在目标库交互验证 ACTIVE ADMIN，并只在本进程形成认证上下文。
- 请求正文自报或覆盖映射、映射缺失、多值、签名无效，以及执行人与签发人实际为同一 principal 时是否全部失败关闭。
- 责任清单、批准、身份、hash、逐题门禁、状态变化、PREVIEW_ONLY 引用、strategy 和审计是否在同一 durable 原子边界内验证和提交。
- AC-20、错误码、跨文件副作用登记和实现停止条件是否足以让后续 `/vibe-impl` 机械落地，而不是依赖 ADMIN 手工声明身份。

## 回归扫描

确认上述补丁没有重新引入此前已关闭的问题：

- 安全聚合键必须是 `student_id + job_code + task_code`。
- PREVIEW_ONLY 正常完成、作废或红线终止均不得生成正式 result/report。
- `delivery_mode` 的兼容注册表、缺字段、未知值和拼写错误必须失败关闭。
- 反馈外发必须使用随机匿名引用，自由文本默认不外发。
- 素材必须具有来源、许可和 `commercial_use_cleared` 证据。
- 纯 OBSERVATION_ONLY 题包必须被拒绝。

## 必须执行的检查

新会话必须自行运行并记录退出码和关键输出，不能沿用本交接中的历史结果：

```bash
git status --short --branch
git diff --check
npm run docs:index:check
npm run contract:job-skill:check
npm run contract:job-skill:delivery:check
npm run asset:validate
npm run typecheck
npm run lint
npm test -- scripts/__tests__/job-skill-shelver-contract-chain.test.mjs scripts/__tests__/job-skill-shelver-delivery-lock.test.mjs scripts/__tests__/job-skill-shelver-phase4.test.mjs
```

已知现场说明：全量 `npm test` 此前受 BASE_ABILITY Step 3 未提交改动影响，`scripts/__tests__/m5b-runtime-inventory.test.mjs` 有 12 项冻结 inventory 失败。Reviewer 可以复核该事实，但不得为本 PRD 审查改写冻结 inventory 或修 BASE_ABILITY 代码，也不得把未执行的全量测试写成通过。

## 输出要求

1. 使用 `/vibe-review prd doc/features/job-skill-298-full-preview-prd.md` 的标准结构，问题优先，逐项给出文件路径、行号、触发条件、影响、违反依据、最小修复和建议测试。
2. 结论规则保持不变：存在 P0 为 `BLOCKED`；无 P0 但存在未关闭 P1 为 `CONDITIONAL_PASS`；P0/P1 清零且必需检查有证据才可为 `PASS`。
3. 不为满足 Reviewer 角色制造问题。无法确认的内容标记 `NOTE / 待验证`。
4. 将完整结果写入 `doc/features/job-skill-298-full-preview-prd-r3-closure-review.md`，保留旧 `CONDITIONAL_PASS` 记录。
5. 新增结果文档后运行 `npm run docs:index:update` 和 `npm run docs:index:check`。
6. 即使结论为 `PASS`，Reviewer 也不得修改 Mini-PRD 状态或进入 `/vibe-impl`。下一作者会话再根据独立结果更新状态。

## Goal 停止条件

- 权威资料缺失、互相冲突或无法定位当前 Schema 时，输出 `BLOCKED` 并停止。
- 任何检查因环境无法运行时标记 `BLOCKED` 或 `NOT_RUN`，不得写成通过。
- 发现需要修改被审查工件才能继续时，只记录 finding，不在 Reviewer 会话修复。
- 发现现有未提交改动与审查范围冲突时保留现场，说明冲突，不执行清理。

## 新会话 Goal Prompt

```text
你正在维护 `/home/maoea/projects/SVETS`。请使用 Goal 模式执行一次新的、独立的 R3 PRD 闭合复核。

开始后先调用 `create_goal`，不要设置 token budget，objective 写为：
“独立复核 JOB_SKILL 298 题全量预览 Mini-PRD 的最后两项 P1，形成可复算的 R3 结论；只审查，不修改被审查工件，不进入实现。”

先读取 `AGENTS.md`、`doc/会话启动.md`、`.continue-here.md` 和 `doc/features/job-skill-298-full-preview-prd-r3-closure-review-handoff.md`，再严格按交接文档的必读顺序、独立性边界、两项 P1、回归扫描、验证命令和停止条件执行。必须使用 `vibe-review`，完整读取其 `SKILL.md` 与权威工作流正文。

本次 Reviewer 只能只读审查现有 Mini-PRD、权威 PRD、当前合同、Schema、真实 diff 和测试证据。不得修改这些被审查工件，不得实现功能、创建 `/vibe-impl`、访问默认数据库、改题目或素材状态，也不得 reset、restore、stash、commit、push、merge 或清理现有未提交改动。只允许新增独立结果文件 `doc/features/job-skill-298-full-preview-prd-r3-closure-review.md`，并更新、检查文档索引。

不要沿用旧 Reviewer 或作者的结论。先独立核验当前工件，再把旧审查记录中的两项 P1 当作待验证命题：一是共享 `question_bank.status = ACTIVE` 时，正式与 PREVIEW_ONLY 必须各自具有发布来源，且正式先、预览先两个顺序都不会互相越权；二是执行 ADMIN 必须由可信认证上下文和已签名的 `user_account.user_id ↔ principal_id` 唯一映射机械确定，映射缺失、多值、伪造或签发执行同主体时全部失败关闭。同时扫描此前已关闭问题是否回归。

按 `/vibe-review prd doc/features/job-skill-298-full-preview-prd.md` 的格式形成带路径、行号和命令证据的报告。结论可以是 `PASS`、`CONDITIONAL_PASS` 或 `BLOCKED`，不要为了通过而降低标准，也不要制造问题。Goal 的完成条件是独立审查和结果落档完成，不是强求 PRD 获得 `PASS`。即使结论为 `PASS`，也不要修改 Mini-PRD 状态或进入实现，留给后续作者会话处理。

只有在独立审查报告已经落档、必需检查已经如实记录且没有剩余审查工作时，才调用 `update_goal` 将 Goal 标记为 `complete`。审查结论为 `CONDITIONAL_PASS` 不妨碍审查 Goal 完成；审查尚未做完时不得提前标记完成。
```
