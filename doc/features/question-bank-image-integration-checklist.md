# 视觉资产合同执行清单

> [!IMPORTANT]
> 素材生产先读 `job-skill-shelver-current-contracts.md`、`job-skill-shelver-runtime-authority-v1.json` 和 `asset-manifest.json`。旧 Pilot 文档、旧审核包和 archive 文件只作追溯，不得直接生成图片、视频或入库 SQL。

**当前基线：** `visual-asset-master-plan.md v1.3.0-298-runtime-authority` / `asset-manifest.schema.json v0.5.0`

**适用范围：** 270 项资产：231 个 A-G 资产 + 33 个 DELIVERY 资产 + 6 个 R1-R6 核心参考资产

**唯一机器合同：** `doc/assets/asset-manifest.json`

旧 TSV、SQL、batch JSON 和首批试跑图片只在 `doc/features/archive/` 中保留追溯价值，不得作为新素材生产或入库输入。

## 1. 合同边界

```text
visual-asset-master-plan.md（风格、范围、审核原则）
  -> asset-manifest.json（逐资产生产合同）
  -> source_path（生成/合成后的生产文件）
  -> 五道验收门 + 版权确认
  -> runtime_path（运行时交付文件）
  -> asset_resource（仅 approved 资产的运行时投影）
  -> question_bank / content_json（题目语义引用）
```

- Manifest 管生产状态、Prompt、参考图、版权和验收记录。
- `question_bank` 管题目语义与答案，Manifest 的 `expected_answer` 只是同步副本。
- `asset_resource` 只管已批准文件的运行时路径、hash、MIME 和可用状态。
- 不为生产治理信息扩展 SQLite schema。

## 2. 生产前

1. 运行 `npm run asset:validate`，当前基线必须显示 `total=270, planned=270, approved=0`，除非本批真实完成了批准。
2. 优先完成 R1-R6；非参考资产必须至少引用一个核心参考资产。
3. 从 `doc/assets/prompt-templates/` 读取对应模板，不得从 archive 复制旧 Prompt。
4. 按 `visual-asset-prompt-compilation-session-guide.md` 分批编译并独立复核逐资产 `prompt_text`。
5. 视频生产前读取 `visual-asset-video-production-sop.md`，并先完成对应场景锚图。
6. `asset_id` 固定为 `asset_${plan_key}`，运行 URI 固定为 `app://asset/<asset_id>`。
7. 生成参数必须与 Manifest 的 `generation_params` 一致。
8. 图片先调用 `gpt-image-2`；`gpt-image-2-official` 只允许 `primary_unavailable` 或人工指定 `manual_override`，不得因画面不满意自动切换。
9. 视频只调用 `doubao-seedance-2.0` 的 `/v1/videos/generations`，统一 720p、16:9、`generate_audio=false`。

AI 资产的 `prompt_text` 为空时只能保持 `planned`。校验器会阻止其进入 `generated`、`composited`、`reviewing` 或 `approved`。

## 3. 生成与合成

每个资产按生命周期推进：

```text
planned -> generated -> composited（按需） -> reviewing -> approved
                                            \-> revision_required 后退回生成/合成
```

调用生成 API 前，`prompt_text` 必须已经完整填写并通过独立复核。生成完成后回填：

- `provider`、`model`、`route`、`generation_date`
- 若实际使用 official：`fallback_used=true`，并填写 `fallback_reason=primary_unavailable|manual_override`
- `source_path`、`file_hash`
- 实际使用的 `reference_asset_ids`

涉及日期、价格、数量、条形码或界面的资产必须执行程序化叠加，并填写 `required_overlay` 与 `overlay_spec`。`ai_plus_overlay` 和 `composite` 不允许直接从 AI 原图进入审核。

## 4. 审核与批准

1. 技术门可由脚本签署。
2. 视觉、职业、特教和测评门必须由人类签署；AI 只能写 `ai_pre_review`。
3. `required: true` 的门全部 `passed` 后才能设为 `approved`。
4. `rights.commercial_use_cleared` 必须为 `true`。
5. 审核批次 JSON 放入 `doc/assets/qa-results/`，路径回填 `qa_record_paths`。
6. `approved` 资产必须同时存在 `source_path` 和 `runtime_path`，且 runtime 文件 SHA-256 与 `file_hash` 一致。

## 5. 题库关联

题目引用位置只有以下四类：

- 主素材：`question_bank.media_asset_id`
- 判断题变体：`content_json.variants[].media_asset_id`
- 单选图片：`content_json.options[].image_asset_id`
- 拖拽项：`content_json.drag_items[].image_asset_id`

关联前运行 `npm run asset:validate`，确认：

- `question_ids` 在当前 96 + 298 题合同中存在
- `current_question_ids` 能从 298 题运行时权威或 BASE_ABILITY 当前题号映射得到
- `expected_answer` 与题库 `scoring_rule_json` 一致
- 被题目引用的资产已经 `approved`
- 测评素材不存在高亮、箭头、勾叉、颜色暗示或答案文字

## 6. 入库

先执行 dry-run：

```bash
npm run asset:seed:dry-run
```

确认 SQL 后再执行：

```bash
node scripts/seed-question-bank-image-assets.mjs --db /absolute/path/to/xc-career-guide.db
```

入库脚本行为：

- 只把 `lifecycle_status='approved'` 的资产写为 `ACTIVE`
- 自动计算运行时文件大小，使用 Manifest 中的 hash 和尺寸/时长
- 将未出现在 approved 集合中的受管视觉资产降为 `DEPRECATED`
- 当 approved 数量为 0 时拒绝修改数据库

## 7. 完成门禁

- `npm run asset:validate` 通过
- `npm test -- scripts/__tests__/visual-asset-manifest.test.mjs` 通过
- `npm run typecheck`、`npm run lint`、`npm run build` 通过
- R1-R6 已批准后才允许批量生产 P0
- P0 全部批准并完成题库引用后，才可宣称“核心视觉资产已接入”
