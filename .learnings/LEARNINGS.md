# Learnings

## [LRN-20260720-001] correction

**Logged**: 2026-07-20T11:00:00+08:00
**Priority**: high
**Status**: resolved
**Area**: docs

### Summary
`M5_DG_035` 的权威求助顺序是先找负责人、再说明问题、最后复述确认并执行指示。

### Details
用户确认原内容审核的“建议映射”沿用了错误顺序，而修改意见正确指出必须先找到沟通对象。即时安全风险还要求先采取本人权限内的现场控制措施，三项排序不能替代该前置安全动作。

### Suggested Action
独立保存人工裁决证据，将 `M5_DG_035_V2` 修订为 `i2 → i1 → i3`，把 `i3` 改为“复述确认并执行指示”，并将即时风险控制写入安全边界。

### Metadata
- Source: user_feedback
- Related Files: doc/features/job-skill-shelver-298-review-conflict-resolution-m5-dg-035-2026-07-20.md, scripts/build-job-skill-shelver-298-revisions.mjs
- Tags: human-review, conflict-resolution, safety-boundary

### Resolution
- **Resolved**: 2026-07-20T11:00:00+08:00
- **Commit/PR**: working tree
- **Notes**: 已将裁决纳入版本化构建输入并保留原审核文件不变。

---

## [LRN-20260722-A11] best_practice

**Logged**: 2026-07-22T17:15:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: tests

### Summary
三档实操题除列出典型错误外，还要检查“1次非指向性提示加部分完成”是否有唯一计分归属。

### Details
只写“独立部分完成计1分”与“恰好1次非指向性提示后全部完成计1分”，会遗漏“1次非指向性提示后仍只完成部分要求”的表现。0分应包含“未达到1分最低条件”的失败关闭兜底，1分的独立分支应明确为0次提示。

### Suggested Action
审核0/1/2分规则时，交叉检查完成程度、关键动作、非关键错误和提示次数，不只检查典型动作组合。

### Metadata
- Source: error
- Related Files: scripts/build-job-skill-shelver-298-rejected-replacement-targeted-v4.mjs, scripts/__tests__/job-skill-shelver-298-rejected-replacement-targeted-v4.test.mjs
- Tags: assessment, rubric, exhaustive-scoring, fail-closed

### Resolution
- **Resolved**: 2026-07-22T17:15:00+08:00
- **Commit/PR**: none
- **Notes**: 6道V4均使用可穷尽的最低条件兜底，相关测试锁定该规则。

---

## [LRN-20260720-E31] best_practice

**Logged**: 2026-07-20T15:10:00+08:00
**Priority**: critical
**Status**: pending
**Area**: data

### Summary
人工复审退回数不能直接作为新版本数量，必须用显式语义投影与交付锁重新分流。

### Details
阶段三把211道历史退回题复算为145道真实语义变化和66道保留V2。56道视频、9道图片题只缺交付绑定；另1道只有审核标记分歧，安全专业结论未要求改变真实边界。若直接按退回状态升版，会再次制造无意义审核循环。

### Suggested Action
后续升版只能由题干、有效答案、选项/映射、逐题rubric、评分规则或真实安全边界的旧/新hash差异触发；素材、工具、setup、路径和文件hash走delivery lock。

### Metadata
- Source: conversation
- Related Files: scripts/lib/job-skill-contract-hash.mjs, scripts/build-job-skill-shelver-298-targeted-v3.mjs
- Tags: question-bank, semantic-hash, delivery-lock, rereview

---

## [LRN-20260720-P2H] best_practice

**Logged**: 2026-07-20T14:48:00+08:00
**Priority**: high
**Status**: resolved
**Area**: tests

### Summary
审核包生成器不得拥有已接收审核结果的 Schema，否则重建历史审核包会回滚后续合同。

### Details
`build-job-skill-shelver-298-rereview-packets.mjs` 同时生成审核入口和结果 Schema。人工 Markdown 接收后，结果 Schema 增加了来源、分组和逐题备注字段，但全量测试重建审核包时又把 Schema 写回早期网页导出形态，造成测试顺序相关的合同漂移。

### Suggested Action
按生命周期拆分产物所有权：packet builder 只生成填写入口，ingestion builder/固定 Schema 负责已接收结果；重建测试必须冻结不属于本构建器的文件 hash。

### Metadata
- Source: error
- Related Files: scripts/build-job-skill-shelver-298-rereview-packets.mjs, scripts/__tests__/job-skill-shelver-298-rereview-packets.test.mjs
- Tags: generated-artifact, schema-ownership, deterministic-build, contract-drift

### Resolution
- **Resolved**: 2026-07-20T14:48:00+08:00
- **Commit/PR**: working tree
- **Notes**: 审核包构建器不再写结果 Schema；测试断言两份 Schema 重建前后 hash 不变。

---

Corrections, insights, and knowledge gaps captured during development.

**Categories**: correction | insight | knowledge_gap | best_practice

---

## [LRN-20260719-001] correction

**Logged**: 2026-07-19T01:50:00+08:00
**Priority**: high
**Status**: resolved
**Area**: docs

### Summary
面向非技术审核人的逐题审核包应优先提供交互式 HTML，不应把 Markdown 作为填写入口。

### Details
用户指出内容审核人陈晓青不是程序员，更习惯网页交互。此前生成的 Markdown 审核包适合留档，不适合作为主要填写界面。后续审核包应使用自包含 HTML 展示题目、校验必填项、自动保存进度，并通过提交按钮导出结构化审核结果和人类可读结论。

### Suggested Action
把 HTML 作为审核输入界面，JSON 作为机器可读的权威审核结果，Markdown 作为由 JSON 生成的留档摘要。提交动作不得直接激活题目或修改 manifest，应保留人工复核和 hash 校验门禁。

### Metadata
- Source: user_feedback
- Related Files: AGENTS.md, doc/features/job-skill-shelver-pilot-content-review-packet-v1.html, doc/features/job-skill-shelver-pilot-review-result-v1.schema.json
- Tags: reviewer-experience, html, audit-trail, human-review

### Resolution
- **Resolved**: 2026-07-19T02:08:00+08:00
- **Commit/PR**: pending
- **Notes**: 已实施自包含 HTML 审核入口、JSON 结果合同、自动保存、必填校验及 JSON/Markdown 导出，并将规则写入 AGENTS.md。

---
## [LRN-20260720-001] correction

**Logged**: 2026-07-20T12:23:37+08:00
**Priority**: high
**Status**: promoted
**Area**: docs

### Summary
SVETS 项目对用户沟通要先用普通话解释结论，再补技术细节。

### Details
用户明确反馈：上一轮用“门禁、DRAFT、hash、合同”等专业话解释时看不懂；当改成“哪些题因为缺视频、缺图片、缺工具所以没法审核”这种表达后，用户认为能看明白，并要求以后都用这种风格。

### Suggested Action
后续回复先说明“现在做到哪、为什么、下一步做什么”，需要时再给文件名、命令和技术名词。

### Metadata
- Source: user_feedback
- Related Files: AGENTS.md, .continue-here.md
- Tags: communication, handoff, user-facing-summary

### Resolution
- **Resolved**: 2026-07-20T12:23:37+08:00
- **Commit/PR**: pending
- **Notes**: 已提升到 `AGENTS.md` 的沟通规则。

---
## [LRN-20260714-001] correction

**Logged**: 2026-07-14T15:30:00+08:00
**Priority**: high
**Status**: resolved
**Area**: config

### Summary
视觉资产生产必须区分图片与视频模型，并以成本更低的 GPT-Image-2 路由作为图片默认值。

### Details
用户指出 `gpt-image-2-official` 单价较高，只能在 `gpt-image-2` 不可用或人工明确指定时兜底；GPT 图片模型不能生成视频。APIMart 视频合同应使用 `doubao-seedance-2.0`、`/v1/videos/generations` 和 720p。正式测评视频保持静音。

### Suggested Action
在 Manifest 生成器和校验器中固化主备模型、兜底原因、图片/视频接口隔离与 720p 视频参数，防止配置回退。

### Metadata
- Source: user_feedback
- Related Files: scripts/build-visual-asset-manifest.mjs, scripts/lib/visual-asset-manifest.mjs, doc/assets/asset-manifest.json
- Tags: apimart, image-generation, video-generation, cost-control, routing

### Resolution
- **Resolved**: 2026-07-14T15:30:00+08:00
- **Commit/PR**: pending
- **Notes**: Manifest v0.3.1 改为图片 `gpt-image-2` 主模型、official 受控兜底；视频改为 Seedance 2.0 720p 静音。

---
## [LRN-20260704-001] correction

**Logged**: 2026-07-04T11:53:20+08:00
**Priority**: medium
**Status**: pending
**Area**: data

### Summary
题库 Excel 标题“单模块 40 题”表示每个模块至少 40 道题，不代表实际源数据必须恰好 40 道。

### Details
处理 `doc/通用基础能力评估题库.xlsx` 时，曾把模块题量超过 40 误判为源数据内部不一致。用户纠正：实际测评会从模块题库中抽取题目，“单模块 40 题”是最低题量口径。后续转换和导入应保留源表全量题目，不因超过 40 题而裁剪或标记为冲突。

### Suggested Action
处理题库导入、审核报告或交接记录时，将“单模块 40 题”描述为“每模块至少 40 题”；只有低于最低题量、枚举/字段不合法或门禁失败才标记为数据问题。

### Metadata
- Source: user_feedback
- Related Files: doc/reference/通用基础能力评估题库.xlsx, .continue-here.md
- Tags: question-bank, data-import, acceptance-criteria

---
## [LRN-20260702-001] correction

**Logged**: 2026-07-02T16:32:49+08:00
**Priority**: high
**Status**: pending
**Area**: docs

### Summary
中国大陆学校使用的测评出图中，人物必须限定为东亚面孔，场景语境也要避免明显海外卖场风格。

### Details
本次首批试跑中，货架正确态和错误态出现了明显非亚裔人物，说明原 prompt 只写了职业训练场景和服装约束，不足以稳定约束 ethnicity 与本地化语境。用户明确要求软件最终给中国大陆学校使用，因此后续所有人物相关 prompt 必须显式写明 East Asian / Chinese mainland school vocational training context，同时验收清单必须把明显非亚裔人物判为不通过。

### Suggested Action
后续所有判断题、流程卡、社交题 prompt 统一加入东亚面孔与中国大陆学校实训语境约束；验收阶段把非亚裔主角和明显海外卖场环境列为硬失败项。

### Metadata
- Source: user_feedback
- Related Files: doc/features/question-bank-image-plan.md, doc/features/archive/question-bank-image-batch-plan-v001.json, doc/features/archive/question-bank-image-batch-pilot-v001.json, doc/features/question-bank-image-batch-pilot-acceptance.md
- Tags: imagegen, localization, prompt, china-mainland, east-asian

---

## [LRN-20260720-D2E] correction

**Logged**: 2026-07-20T13:02:26+08:00
**Priority**: high
**Status**: pending
**Area**: docs

### Summary
题库素材缺口分析必须同时检索视觉资产合同和线下工具采购合同，不能把空 `tool_asset_ids` 等同于尚未规划工具。

### Details
用户指出 `doc/reference/offline-toolkit-procurement-spec.md` 已经完成线下工具包 v2.1 采购规划。此前只将 manifest G 类通用工具资产与83道线下题对账，遗漏了这份覆盖100道线下实操题、固定SKU、日期矩阵、场景包和验收清单的既有合同，因而低估了可复用工作。

### Suggested Action
以后生成题库候选、审核包或缺口报告前，先建立题目候选、视觉 manifest、线下采购规格三方索引；只有采购规格也无法覆盖时才标记为“未规划工具”。

### Metadata
- Source: user_feedback
- Related Files: doc/reference/offline-toolkit-procurement-spec.md, doc/assets/asset-manifest.json, doc/features/job-skill-shelver-298-question-revision-candidates-v1.json
- Tags: question-bank, offline-operation, procurement, contract-drift, duplicate-work

---
