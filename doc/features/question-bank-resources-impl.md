# 题库与视觉资源实现说明

对应当前合同：`doc/features/question-bank-resources-prd.md`

## 已落地结构

```text
doc/reference/visual-asset-master-plan.md
  -> scripts/build-visual-asset-manifest.mjs
  -> doc/assets/asset-manifest.json
  -> scripts/validate-visual-asset-manifest.mjs
  -> scripts/seed-question-bank-image-assets.mjs
  -> asset_resource
  -> app://asset/<asset_id>
```

### 生产合同

- `doc/assets/asset-manifest.schema.json`：v0.5.0 结构合同。
- `doc/assets/asset-manifest.json`：270 条逐资产记录，包含来源题号和当前运行时题号绑定。
- `doc/assets/prompt-templates/`：按资产类型拆分的 Prompt 模板；测评视频与训练视频使用独立模板。
- `doc/assets/reference-assets/`：R1-R6 参考资产包落位说明。
- `doc/assets/qa-results/`：审核批次记录目录。
- `doc/features/visual-asset-video-production-sop.md`：Seedance 四段式输入、抽选与验收规则。
- `doc/features/visual-asset-prompt-compilation-session-guide.md`：逐资产 `prompt_text` 分批编译和复核方式。

### 校验链路

`scripts/lib/visual-asset-manifest.mjs` 负责：

- ID、路径、生命周期与生产方法约束
- 参考资产、Prompt 模板和题目 ID 存在性
- `question_ids` 到 `current_question_ids` 的当前 298 题权威映射
- `expected_answer` 与当前 298 题清洗结果一致性
- approved 资产的文件、SHA-256、版权和五道门状态
- approved Manifest 到 `asset_resource` 行和 SQL 的投影
- 图片 `gpt-image-2` 主路由与受控 official 兜底策略
- 视频 `doubao-seedance-2.0` / 720p / 静音参数及图片模型隔离
- AI 资产离开 `planned` 前必须存在非空 `prompt_text`

### 数据库边界

`asset_resource` 不承载生产治理字段，继续只保存：

- `asset_id` / `app_uri` / `local_path`
- 类型、角色、MIME、hash、大小、宽高、时长
- `ACTIVE` / `MISSING` / `CORRUPTED` / `DEPRECATED`

因此本功能不需要 schema migration，也不与 M2 migration runner 竞争。

## 命令

```bash
# 当规划书的明确资产清单发生变化时重建 Manifest
npm run asset:manifest:build

# 每次生产状态或审核记录变化后校验
npm run asset:validate

# 查看 approved 资产将产生的 SQL
npm run asset:seed:dry-run

# 明确指定数据库执行投影
node scripts/seed-question-bank-image-assets.mjs --db /absolute/path/to/xc-career-guide.db
```

`asset:manifest:build` 是从当前规划基线初始化/同步计划清单的受控工具。进入实际生产后，Prompt、路径、hash 和审核结果必须直接维护在 Manifest；重建前必须先确认不会覆盖已产生的生产记录。

## 当前状态

- 231 个 A-G 资产、33 个 DELIVERY 资产和 6 个参考资产均已登记。
- 所有记录当前为 `planned`。
- approved 数量为 0，因此不会向 SQLite 写入 ACTIVE 视觉资产。
- 下一生产动作是先编译并复核 R1-R6 的逐资产 Prompt，再生成和批准 R1-R6；R1-R6 批准后才开始 P0 批次。

## 历史说明

旧实现文档已移至 `doc/features/archive/superseded-contracts/question-bank-resources-impl-v0.1.10.md`。旧 TSV 资产输入、解析库、拖拽题 seed 脚本和活跃 SQL 均已退出当前流程；题库 CLI 共用的默认数据库路径函数已迁移到 `scripts/lib/database-path.mjs`。
