# 生图交接模板（可直接粘贴进 `.continue-here.md`）

> 用途：用于生图会话结束时记录“最小可恢复现场”。  
> 约束：当 `.continue-here.md` 当前主任务仍是编码推进时，本模板只能以“附加图片区块”方式写入，不能覆盖原有编码状态。  
> 适用场景：判断题 / 拖拽题图片资产规划、试跑、定稿、资源接入准备。

# Current State
- 任务：<当前生图任务一句话，必须精确到资产批次或接入阶段，例如“收口第一批标准资产并整理资源接入草案”>
- 当前阶段：<方案规划 / 小批次试跑 / 批量正式出图 / 资源接入准备>
- 当前图片基线：
  - 判断题标准资产：<例如 `JDG-MS02-standard-shelf-master-v001` / `JDG-MS02-facing-correct-v001` / `JDG-MS02-facing-wrong-v001` / `JDG-MS04-safety-risk-master-v001`>
  - 拖拽题标准资产：<例如 `DRG-BG01-shelf-alignment-board-v001` / `DRG-OBJ02-goods-facing-pack-v003`>
  - 当前标准基线说明：<后续继续沿用的唯一标准资产组；若仍未收口，明确写“未收口”>
- 已完成资产：
  - <标准文件名 1>
  - <标准文件名 2>
- 已废弃资产：
  - <废弃文件名或版本名；若无则写 `None`>
  - 规则：凡是 `r2` / `r3` / 时间戳试跑版如果已被标准版替代，必须列入这里，不能让后续会话自己猜
- 资源接入状态：
  - `asset_resource` 登记：<No / Draft only / Partial / Yes>
  - 题目挂接：<No / Draft only / Partial / Yes>
  - 当前接入位点：<例如 `question_bank.media_asset_id` / `content_json.variants[].media_asset_id` / `content_json.drag_items[].image_asset_id`>
  - 当前缺口：<例如 `asset_id` 未定 / `app_uri` 未定 / `file_hash` 未算 / `DRG-OBJ02` 尚未拆子素材>
- 与编码会话关系：
  - 当前 `.continue-here.md` 主状态是否为编码任务：<Yes / No>
  - 本次图片状态是否允许写入 `.continue-here.md`：
    - 允许写入：当本轮已明确标准资产基线、已废弃资产、下一步唯一原子动作，且不会覆盖当前编码任务主状态
    - 不应覆盖：当编码 agent 正在推进实现步骤，或 `.continue-here.md` 当前主任务仍是编码链路时
  - 写入方式：<附加图片区块 / 新建独立文档，不覆盖主区块>

# Next Action
- <下一步唯一原子动作，只能写 1 条，例如“把当前 6 个标准资产整理成 `asset_resource` 登记草案表”>

# Blockers
- <真实阻塞；没有则写 `None`>
- <如果阻塞来自并行编码 agent，例如“资源接入代码正在并行修改，当前只保留文档草案，不进入代码接入”>

# Key Decisions
- 图片会话的完成标准不是“PNG 已生成”，而是至少要写清：`标准资产基线`、`废弃资产`、`资源接入状态`、`下一步唯一原子动作`
- 题目层不直接写磁盘路径；正式接入应走 `asset_resource`，题目字段只挂 `asset_id`
- 当前可用挂接位点：
  - 判断题主媒体：`question_bank.media_asset_id`
  - 判断题正误变体：`content_json.variants[].media_asset_id`
  - 拖拽题底图：`question_bank.media_asset_id`
  - 拖拽题子素材：`content_json.drag_items[].image_asset_id`
  - 单选题选项图：`content_json.options[].image_asset_id`
- `DRG-OBJ02-goods-facing-pack-v003` 这类“素材总览图”如果尚未拆成独立 draggable 子图，不应宣称“已完成正式挂题”
- 只有在以下条件同时满足时，才可以把图片会话状态写入 `.continue-here.md`：
  - 已确认本轮标准资产基线
  - 已标明废弃资产
  - 已写明资源接入是 `No / Draft only / Partial / Yes` 之一
  - 已写出唯一原子 `Next Action`
  - 不会覆盖当前编码任务的主状态
- 遇到以下情况，不应直接改写 `.continue-here.md` 主内容：
  - 当前 `.continue-here.md` 主要承载编码推进状态
  - 并行编码 agent 正在推进实现步骤或验收步骤
  - 图片标准版尚未收口，目录里仍有多套近似同名资产并存
  - 资源接入位点尚未确认，只是“出了图”
- 如果必须记录图片状态，但不适合覆盖主 `.continue-here.md`，应改为：
  - 在 `.continue-here.md` 末尾追加独立图片区块，标题明确为 `Image State`
  - 或新建独立文档，例如 `doc/features/question-bank-image-continue-here-template.md` / `doc/features/question-bank-image-handoff.md`

# Relevant Files
- `doc/生图启动.md`
- `doc/生图结束.md`
- `doc/features/question-bank-image-plan.md`
- `doc/features/question-bank-image-asset-linking-draft.md`
- `.continue-here.md`
- <如果下一步涉及正式接入，再补：`src/main/db/schema.sql`、题库 seed 或资源接入实现文件>

---

## 可追加到现有 `.continue-here.md` 的最小图片区块

> 仅当不覆盖编码主状态时追加；否则保留在独立文档中。

## Image State
- 当前生图任务：<一句话>
- 当前阶段：<方案规划 / 小批次试跑 / 批量正式出图 / 资源接入准备>
- 当前标准资产基线：<标准资产组>
- 已完成资产：<标准文件名列表>
- 已废弃资产：<废弃文件名列表或 `None`>
- 资源接入状态：<No / Draft only / Partial / Yes>
- 资源接入位点：<字段列表>

## Image Next Action
- <唯一原子动作>

## Image Blockers
- <阻塞项或 `None`>
