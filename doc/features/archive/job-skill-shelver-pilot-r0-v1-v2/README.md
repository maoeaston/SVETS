# 超市理货员 Pilot R0 v1/v2 审核历史

**状态：** 只读审计资料  
**归档日期：** 2026-07-19

本目录保存 strategy v1 与 strategy v2 的候选、审核包、人工审核结果、审核结论和 fail-closed manifest。它们用于追溯 strategy v3 的来源和复算历史 hash，不是当前题目、素材生产、复审或激活输入。

## 当前执行入口

1. `doc/features/job-skill-shelver-pilot-current-question-authority.md`
2. `doc/features/job-skill-shelver-pilot-revision-candidates-v3.json`
3. `doc/features/job-skill-shelver-pilot-activation-manifest-v3.json`
4. `doc/features/job-skill-shelver-pilot-13-question-revision-and-renderer-fix-v1.0.md`

制作图片、视频、教具卡、复审包或激活清单时，不得从本目录复制题目文本、题目 ID、候选 hash 或审核状态。需要追溯来源时，先从当前 v3 候选的 `source`、`replaces_question_id` 和 manifest 引用反向查找。

## 归档内容

| 文件 | 历史用途 |
|---|---|
| `job-skill-shelver-pilot-activation-manifest-v1.json` | strategy v1 初始 fail-closed manifest |
| `job-skill-shelver-pilot-content-review-packet-v1.html` | 陈晓青填写的 v1 内容审核入口 |
| `job-skill-shelver-pilot-content-review-packet-v1.md` | v1 内容候选只读快照 |
| `job-skill-shelver-pilot-content-review-result-2026-07-19.json` | 陈晓青提交的 v1 原始审核结果 |
| `job-skill-shelver-pilot-content-review-conclusion-2026-07-19.md` | v1 内容审核人类可读结论 |
| `job-skill-shelver-pilot-review-checklist-v1.md` | v1 逐题门禁清单 |
| `job-skill-shelver-pilot-revision-candidates-v2.json` | strategy v2 候选合同 |
| `job-skill-shelver-pilot-activation-manifest-v2.json` | strategy v2 fail-closed manifest |
| `job-skill-shelver-pilot-safety-technical-review-packet-v2.html` | 赫东填写的 v2 安全与技术审核入口 |
| `job-skill-shelver-pilot-safety-technical-review-result-2026-07-19.json` | 赫东提交的 v2 原始审核结果 |
| `job-skill-shelver-pilot-safety-technical-review-conclusion-2026-07-19.md` | v2 安全与技术人类可读结论 |

## 可重复性约束

`npm run review:job-skill:v2:archive-rebuild` 只用于显式重建本目录中的 v2 审计产物；`scripts/build-job-skill-shelver-revision-v3.mjs` 读取归档 v2 输入以验证 v3 来源。其他活跃业务脚本不得把本目录作为生产输入。

归档文件不得手工修改。只有上述显式审计重建命令可以重复生成机器产物；如需纠正历史说明，只能在本 README 追加勘误，或者创建新的版本化审计记录。
