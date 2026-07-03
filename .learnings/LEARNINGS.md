# Learnings

Corrections, insights, and knowledge gaps captured during development.

**Categories**: correction | insight | knowledge_gap | best_practice

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
- Related Files: doc/features/question-bank-image-plan.md, doc/features/question-bank-image-batch-plan-v001.json, doc/features/question-bank-image-batch-pilot-v001.json, doc/features/question-bank-image-batch-pilot-acceptance.md
- Tags: imagegen, localization, prompt, china-mainland, east-asian

---
