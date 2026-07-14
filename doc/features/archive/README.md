# 题库视觉资产历史归档

**状态：** 只读历史资料

**归档日期：** 2026-07-14

本目录保存旧题库图片方案、APIMart 试跑 Prompt、旧 TSV/SQL 产物和已被替代的题库资源合同。它们只用于追溯早期决策、复盘失败样例和核对迁移来源，不得作为当前生产、入库或新会话 Prompt 的输入。

## 当前执行入口

1. `doc/reference/visual-asset-master-plan.md`
2. `doc/assets/asset-manifest.json`
3. `doc/features/visual-asset-prompt-compilation-session-guide.md`
4. `doc/features/visual-asset-video-production-sop.md`
5. `doc/features/question-bank-image-integration-checklist.md`

## 目录结构

| 目录 | 内容 | 处置 |
|---|---|---|
| `historical-design/` | 旧图片规划、资产接入草案、试跑验收和会话模板 | 保留决策轨迹，不再更新 |
| `generation-experiments/` | 旧 APIMart 批次 JSON 和单条 Prompt 试验 | 保留生成迭代证据，不得重新提交 |
| `legacy-data/` | 旧 TSV、SQL 和 v0.1 生成脚本 | 隔离保存，禁止执行或导入 |
| `superseded-contracts/` | schema v0.1.10 / PRD v1.0.6 时期的题库资源 PRD 与实现文档 | 保留需求演进依据 |

## 已知失效点

- 依赖旧 schema、旧 PRD、旧题目 ID 或本地 `AIimages/` 目录。
- 部分 Prompt 使用 `gpt-image-2-official` 主路由或已经退出当前接口合同的参数。
- 资产 ID、紫色使用、训练与测评区分、生命周期和五道验收门不符合当前合同。
- 部分 SQL 使用旧 URI，或把占位母版直接登记为 `ACTIVE`。
- 历史文档中的相对路径保留原貌，不代表文件仍位于该位置。

当前脚本和活跃文档均不得读取本目录。需要复用历史经验时，只能提炼决策原因，再按当前主规划、Manifest 和模板重新编译，不能复制旧 Prompt 或执行旧 SQL。

## 待确认后可删除

以下文件已经被当前合同完全替代，运行价值为零；本次先隔离，不做不可逆删除：

- `historical-design/question-bank-image-continue-here-template.md`
- `legacy-data/question-bank-image-asset-resource-seed.sql`
- `legacy-data/question-bank-image-drag-question-seed.sql`
- `legacy-data/question-bank-import-base-ability.sql`
- `legacy-data/gen-base-ability-import-v01.py`

保留它们的唯一理由是审计和迁移追溯。Git 历史稳定后，可以在单独清理提交中删除。
