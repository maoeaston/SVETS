# 题库视觉资产历史归档

**状态：** 只读历史资料

**归档日期：** 2026-07-14

本目录保存旧题库图片方案、APIMart 试跑 Prompt、旧 TSV/SQL 产物和已被替代的题库资源合同。它们只用于追溯早期决策、复盘失败样例和核对迁移来源，不得作为当前生产、入库或新会话 Prompt 的输入。

## 当前执行入口

1. `doc/features/job-skill-shelver-current-contracts.md`
2. `doc/assets/asset-manifest.json`
3. `doc/reference/visual-asset-master-plan.md`
4. `doc/features/visual-asset-prompt-compilation-session-guide.md`
5. `doc/features/visual-asset-video-production-sop.md`
6. `doc/features/question-bank-image-integration-checklist.md`

## 目录结构

| 目录 | 内容 | 处置 |
|---|---|---|
| `historical-design/` | 旧图片规划、资产接入草案、试跑验收和会话模板 | 保留决策轨迹，不再更新 |
| `generation-experiments/` | 旧 APIMart 批次 JSON 和单条 Prompt 试验 | 保留生成迭代证据，不得重新提交 |
| `legacy-data/` | 旧 TSV、SQL 和 v0.1 生成脚本 | 隔离保存，禁止执行或导入 |
| `superseded-contracts/` | schema v0.1.10 / PRD v1.0.6 时期的题库资源 PRD 与实现文档 | 保留需求演进依据 |
| `job-skill-shelver-pilot-r0-v1-v2/` | 超市理货员 Pilot strategy v1/v2 候选、审核包、审核结果和旧 manifest | 只读审计历史；当前生产入口使用 strategy v3 |

## 已知失效点

- 依赖旧 schema、旧 PRD、旧题目 ID 或本地 `AIimages/` 目录。
- 部分 Prompt 使用 `gpt-image-2-official` 主路由或已经退出当前接口合同的参数。
- 资产 ID、紫色使用、训练与测评区分、生命周期和五道验收门不符合当前合同。
- 部分 SQL 使用旧 URI，或把占位母版直接登记为 `ACTIVE`。
- 历史文档中的相对路径保留原貌，不代表文件仍位于该位置。

除各归档子目录 README 明确列出的审计复算脚本外，当前业务脚本和活跃文档不得把本目录作为生产输入。需要复用历史经验时，只能提炼决策原因，再按当前主规划、Manifest 和模板重新编译，不能复制旧 Prompt 或执行旧 SQL。

## 未物理移动的 298 审核链

`doc/features/job-skill-shelver-298-*` 的大量 JSON、HTML 和 Markdown 当前仍保留在 `doc/features/` 根层，是因为多个 `scripts/build-job-skill-shelver-298-*.mjs` 生成器、校验测试和 hash 追溯仍按这些路径读取。它们的业务状态不是日常入口，而是“重建 298 DRAFT 权威时的证据链和机器输入”。

素材生产、Prompt 编译、视频生成和入库工作不得从这些审核包直接读取题号、答案或素材条件；当前入口统一见 `doc/features/job-skill-shelver-current-contracts.md`。

## 待确认后可删除

以下文件已经被当前合同完全替代，运行价值为零；本次先隔离，不做不可逆删除：

- `historical-design/question-bank-image-continue-here-template.md`
- `legacy-data/question-bank-image-asset-resource-seed.sql`
- `legacy-data/question-bank-image-drag-question-seed.sql`
- `legacy-data/question-bank-import-base-ability.sql`
- `legacy-data/gen-base-ability-import-v01.py`

保留它们的唯一理由是审计和迁移追溯。Git 历史稳定后，可以在单独清理提交中删除。
