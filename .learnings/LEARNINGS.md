# Learnings

Corrections, insights, and knowledge gaps captured during development.

**Categories**: correction | insight | knowledge_gap | best_practice

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
