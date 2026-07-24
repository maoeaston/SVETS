# 题库与视觉资源当前合同

**工程基线：** schema v0.1.15-multi-device-m3-grant-assignment / `doc/specs/MVP_PRD_v1.0.9-authoritative.md`

**视觉基线：** `visual-asset-master-plan.md v1.3.0-298-runtime-authority`

**合同版本：** `asset-manifest.schema.json v0.5.0`

## 目标

让 96 条 BASE_ABILITY 与 298 条 JOB_SPECIFIC 题目只引用经过生产、合成、版权确认和人工审核的视觉资产，同时保持题目答案、素材生产记录与 SQLite 运行时登记各自只有一个权威来源。

## 权威边界

| 数据 | 唯一权威来源 |
|---|---|
| 视觉风格、范围、复杂度、验收原则 | `doc/reference/visual-asset-master-plan.md` |
| 逐资产生产状态、Prompt、参考图、版权、审核 | `doc/assets/asset-manifest.json` |
| JOB_SKILL 当前题号与 DRAFT 状态 | `doc/features/job-skill-shelver-runtime-authority-v1.json` |
| 题库与素材入口边界 | `doc/features/job-skill-shelver-current-contracts.md` |
| 题目语义、正确答案、素材引用 | `question_bank` / 题库导入合同 |
| 已批准文件的运行时访问 | `asset_resource` |
| 早期试跑与旧 seed | `doc/features/archive/`，只读历史资料 |

## 功能要求

1. Manifest 必须覆盖 270 项资产：231 个 A-G 资产、33 个 DELIVERY 资产和 6 个 R1-R6 参考资产。
2. 图片主模型必须为 `gpt-image-2`；`gpt-image-2-official` 只能作为主模型不可用或人工指定时的可审计兜底。
3. 视频必须使用 `doubao-seedance-2.0`、`/v1/videos/generations`、720p、16:9 和静音生成参数。
4. AI 资产必须先完成逐资产 `prompt_text` 编译和独立复核，才能离开 `planned`。
5. 所有运行时 ID 使用 `asset_${plan_key}`，通过 `app://asset/<asset_id>` 访问。
6. 非参考资产必须引用至少一个存在的核心参考资产。
7. 日期、价格、数量、条形码和二维码只能程序化生成或叠加。
8. `question_ids` 必须保留来源题号；`current_question_ids` 必须能映射到当前运行时题号或 BASE_ABILITY 当前题号。
9. `expected_answer` 必须与题库 `scoring_rule_json` 一致，题库始终是答案唯一事实来源。
10. AI 只能预审；视觉、职业、特教和测评门由人类签署。
11. 只有 `approved`、版权已确认、文件和 hash 一致、必需验收门全部通过的资产可以写入 `asset_resource` 为 `ACTIVE`。
12. 未出现在 approved 集合中的受管视觉资产必须降为 `DEPRECATED`。

## 不做

- 不把 Prompt、版权、验收记录复制进 SQLite。
- 不修改 `asset_resource` 或 `question_bank` 表结构。
- 不从 archive、旧 TSV 或 `AIimages/` 目录导入素材。
- 不自动把 `generated` 或 `reviewing` 资产提升为 `approved`。
- 不用 AI 签署任何需要人类负责的验收门。

## 验收标准

1. `npm run asset:validate` 返回 `total=270, planned=270, approved=0` 且无错误，除非本批已有真实批准资产。
2. 68 个判断视频的 `expected_answer` 与当前题库清洗合同一致，包括已纠正的 `M1_TF_015=true`。
3. Manifest 中所有 `asset_id` 与 app 协议兼容，所有 `runtime_path` 为小写仓库相对路径。
4. 任意缺失题目、参考资产、Prompt 模板、文件、hash、版权确认或必需门签署都会阻止入库。
5. Manifest 没有 approved 资产时，真实入库命令拒绝修改数据库。
6. dry-run 只生成临时 SQL，不在 `doc/features/` 产生派生 SQL。
7. 现有题库审核门和 `app://asset` 协议测试保持通过。

## 历史说明

原 5.3 PRD 已移至 `doc/features/archive/superseded-contracts/question-bank-resources-prd-v0.1.10.md`。其中题库导入与审核设计仍有追溯价值，但 TSV、旧 URI、`AIimages/` 和拖拽 seed 不再是当前实现合同。
