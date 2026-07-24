# 超市理货员298题 V4 复审结果接收交接

**状态：** 已执行完成；后续入口已转为6道V5定点修订  
**交接日期：** 2026-07-20  
**当前动作：** V4结果已接收、校验并合并；阶段四关闭，下一步只处理6道退回题

## 现在做到哪

- V3 定点复审已经接收：陈晓青审核144道，赫东审核135道。
- V3 合并后，137道被审核退回；另有4道视频判断题因“规则、视频行为、预设答案”冲突被机器阻断。
- 已逐题生成141道V4：30道单选、12道视频判断、16道拖拽、83道线下实操。
- 4道无冲突图片单选保留已通过V3，不生成V4、不重复复审。
- V4内容复审包覆盖140道，安全技术复审包覆盖120道。
- 两份V4结果已原样固化并通过Schema、身份、集合、版本链、逐题hash和汇总校验。
- 陈晓青135通过/5退回，赫东118通过/2退回；合并去重后135道V4通过、6道V4退回。
- 加入4道已通过V3引用后，完整145题中139题通过、6题退回；12道视频合同一致，无范围异常。
- 当前合并门禁为 `COMPLETED_WITH_RETURNS`、`releaseable=false`；运行库、SQL和阶段二交付锁未修改。

## 执行产物

- 陈晓青原件：`doc/features/job-skill-shelver-298-targeted-v4-content-rereview-result-chen-xiaoqing-2026-07-20.json`
- 赫东原件：`doc/features/job-skill-shelver-298-targeted-v4-safety-technical-rereview-result-he-dong-2026-07-20.json`
- 合并门禁：`doc/features/job-skill-shelver-298-targeted-v4-rereview-merged-gate-v1.json`
- 接收台账：`doc/features/job-skill-shelver-298-targeted-v4-rereview-ledger-v1.md`
- 接收检查：`npm run contract:job-skill:v4:results:check`

## 后续唯一动作

只为 `M1_OP_037_V4`、`M1_OP_038_V4`、`M2_OP_031_V4`、`M2_OP_038_V4`、`M2_OP_041_V4`、`M5_DG_034_V4` 创建V5；已通过的139题不重复修订或复审。

## 新会话读取顺序

1. `AGENTS.md`
2. `doc/会话启动.md`
3. `.continue-here.md`
4. 本文件
5. 用户提供的两份V4审核JSON原件
6. `doc/features/job-skill-shelver-298-question-revision-candidates-v4.json`
7. `doc/features/job-skill-shelver-298-targeted-v4-rereview-gate-v1.json`
8. 两份V4结果Schema

不要重新读取298题原始大文件，不要重新设计V4，不要回到211题分组工作。

## V4 权威基线

- 候选集：`doc/features/job-skill-shelver-298-question-revision-candidates-v4.json`
- 候选集hash：`sha256:309a399aed46d0a7f5ca257c74a30312bd3a2931f53e5c03422739602c8c0d5a`
- 待审核门禁：`doc/features/job-skill-shelver-298-targeted-v4-rereview-gate-v1.json`
- 陈晓青审核包：`doc/features/job-skill-shelver-298-targeted-v4-content-rereview-packet-chen-xiaoqing-v1.html`
- 赫东审核包：`doc/features/job-skill-shelver-298-targeted-v4-safety-technical-rereview-packet-he-dong-v1.html`
- 陈晓青结果Schema：`doc/features/job-skill-shelver-298-targeted-v4-content-rereview-result-v1.schema.json`
- 赫东结果Schema：`doc/features/job-skill-shelver-298-targeted-v4-safety-technical-rereview-result-v1.schema.json`
- 构建与检查：`npm run contract:job-skill:v4:build`、`npm run contract:job-skill:v4:check`

## 收到两份 JSON 后立即执行

用户在新会话提供两份结果路径并要求处理时，完成启动摘要后直接执行以下步骤，不需要再次询问“是否继续”。

### 1. 原件固化

- 先读取，不编辑原件。
- 将两份文件原样保存到 `doc/features/`，保留审核人、V4、日期或原文件名信息。
- 记录接收路径、字节数和 SHA-256。
- 后续规范化、合并或留档产物不得覆盖审核人原件。

### 2. Schema、身份和汇总校验

陈晓青结果必须满足：

- `schema_version=job-skill-shelver-298-targeted-v4-content-rereview-result-v1`
- `package_id=job-skill-shelver-298-targeted-v4-content-rereview-packet-v1`
- `reviewer=陈晓青`
- `candidate_set_hash=sha256:309a399aed46d0a7f5ca257c74a30312bd3a2931f53e5c03422739602c8c0d5a`
- 恰好140题，无重复、无漏题、无越界题。

赫东结果必须满足：

- `schema_version=job-skill-shelver-298-targeted-v4-safety-technical-rereview-result-v1`
- `package_id=job-skill-shelver-298-targeted-v4-safety-technical-rereview-packet-v1`
- `reviewer=赫东`
- 候选集hash同上。
- 恰好120题，无重复、无漏题、无越界题。

两份结果都必须逐题校验：

- `question_id`、`previous_question_id`、`new_semantic_hash`、`candidate_record_hash` 与V4候选一致。
- 结论只能是 `PASS` 或 `RETURN_FOR_REVISION`。
- 退回题必须有非空、具体的 `review_note`。
- 顶层summary必须能由逐题结果复算。
- `submitted_at` 是有效时间。

任一身份、集合、hash或汇总不一致时标记 `[!]`，列出具体题号并停止合并，不猜测、不自动修正审核人选择。

### 3. 合并裁决并失败关闭

- 加入4道已通过V3引用，形成145道定点修订题的完整结果。
- 每道V4只要求 `required_review_tracks` 中列出的轨道通过。
- 已通过轨道永久保留，不因另一轨退回而重复审核。
- 任一所需轨道退回，则该题状态为 `RETURN_FOR_REVISION`。
- 两位意见冲突、意见与答案合同冲突或信息不足时，状态为 `BLOCKED_CONTRACT_CONFLICT`，不得自行选边。
- 对12道视频判断题再次检查“题干规则、`media_brief`视频行为、`expected_answer`”三方一致；人工均通过但机器检查不一致时仍失败关闭。
- 纯素材未生产、asset ID、setup ID、工具编号、文件路径和hash不是内容或安全退回理由。若审核意见只包含这些事项，列入范围异常清单，不据此改题。

建议新增JSON原生接收脚本、合并门禁、台账和测试；Markdown只允许由JSON生成留档，不作为机器输入。

### 4. 根据结果决定下一步

如果所有所需轨道通过且无合同冲突：

- 阶段三复审完成。
- 合并门禁可以记录 `releaseable=true`、`phase_4_allowed=true`，但不得在同一步写数据库或生成激活SQL。
- 更新实施计划和 `.continue-here.md`，下一步才进入阶段四。

如果仍有退回题：

- 只为退回或冲突题创建V5，绝不覆盖V4。
- V5只送失败轨道；已通过轨道不重复复审。
- 先把意见拆成场景事实、答案、权限、异常分支、评分阈值和安全动作，再逐题编辑；禁止把审核意见原文直接塞入学生题干、选项、拖拽卡、rubric或停止条件。
- 不作废4道已通过V3、已通过V4题、66道保留V2和阶段二交付锁。
- 门禁继续 `releaseable=false`，不得进入阶段四。

## 禁止事项

- 不覆盖V2、V3、V4或审核原件。
- 不从Markdown解析审核结果。
- 不因素材或工具绑定触发全量内容复审。
- 不修改 `doc/features/question-bank-import.sql`、运行数据库或激活状态。
- 不把历史文件里的 `ACTIVE` 当作当前激活授权。
- 不在结果未全部通过时进入阶段四。

## 完成前验证

至少运行：

```bash
npm run typecheck
npm run lint
npm run contract:job-skill:check
npm run contract:job-skill:delivery:check
npm run contract:job-skill:v3:check
npm run contract:job-skill:v3:results:check
npm run contract:job-skill:v4:check
npm test
npm run docs:index:update
npm run docs:index:check
git diff --check
```

当前最近一次基线：63 files / 735 tests通过；lint 0 error / 175个既有warning。
