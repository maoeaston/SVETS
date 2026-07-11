# 图片资产接入草案表（第一批标准资产）

**目标**：把当前已定稿的生图产物，映射到应用正式可接入的资源链路。  
**范围**：先覆盖当前已经收口完成的 6 个标准资产，以及 `DRG-OBJ02` 的 9 个 draggable 子素材。  
**用途**：供编码会话后续登记 `asset_resource`、补 `question_bank` / `content_json` 挂接字段时直接使用。

---

## 1. 接入原则

### 1.1 不直接在题目中写磁盘路径

题目层只写 `asset_id`，不写 `AIimages/...png`。

### 1.2 先登记 `asset_resource`，再挂题

正确顺序：

```text
AIimages/*.png
→ 计算 hash / size / mime / width / height
→ 写 asset_resource
→ 题目字段写 asset_id
→ 渲染层通过 app_uri 访问
```

### 1.3 当前可用挂接位点

- 判断题主媒体：`question_bank.media_asset_id`
- 判断题正误变体：`content_json.variants[].media_asset_id`
- 拖拽题素材：`content_json.drag_items[].image_asset_id`
- 单选题选项图：`content_json.options[].image_asset_id`

---

## 2. 当前已定稿标准资产

当前目录中的标准版：

- `AIimages/JDG-MS02-standard-shelf-master-v001.png`
- `AIimages/JDG-MS02-facing-correct-v001.png`
- `AIimages/JDG-MS02-facing-wrong-v001.png`
- `AIimages/JDG-MS04-safety-risk-master-v001.png`
- `AIimages/DRG-BG01-shelf-alignment-board-v001.png`
- `AIimages/DRG-OBJ02-goods-facing-pack-v003.png`
- `AIimages/drg-obj02-snack-box-blue-v002.png`
- `AIimages/drg-obj02-snack-box-red-v002.png`
- `AIimages/drg-obj02-snack-box-yellow-v002.png`
- `AIimages/drg-obj02-snack-box-green-v002.png`
- `AIimages/drg-obj02-homecare-box-white-blue-v002.png`
- `AIimages/drg-obj02-homecare-box-white-orange-v002.png`
- `AIimages/drg-obj02-homecare-box-purple-white-v002.png`
- `AIimages/drg-obj02-drink-bottle-orange-v002.png`
- `AIimages/drg-obj02-drink-bottle-green-v002.png`

其中前 6 个仍是标准基线资产；后 9 个是当前已可进入 `drag_items[].image_asset_id` 的正式子素材。

---

## 3. `asset_resource` 登记草案

> 说明：以下 `app_uri`、`asset_id` 是建议值，不是数据库现状。  
> 真正入库前，还需要补齐 `file_hash`、`file_size_bytes`、`mime_type`、`width_px`、`height_px`。

| asset_id | local_path | app_uri | asset_type | asset_role | 建议状态 | 说明 |
|---|---|---|---|---|---|---|
| `asset_img_jdg_ms02_shelf_master_v001` | `AIimages/JDG-MS02-standard-shelf-master-v001.png` | `app://asset/asset_img_jdg_ms02_shelf_master_v001` | `IMAGE` | `QUESTION_MEDIA` | `ACTIVE` | 货架判断题母版 |
| `asset_img_jdg_ms02_facing_correct_v001` | `AIimages/JDG-MS02-facing-correct-v001.png` | `app://asset/asset_img_jdg_ms02_facing_correct_v001` | `IMAGE` | `QUESTION_MEDIA` | `ACTIVE` | 货架正确态 |
| `asset_img_jdg_ms02_facing_wrong_v001` | `AIimages/JDG-MS02-facing-wrong-v001.png` | `app://asset/asset_img_jdg_ms02_facing_wrong_v001` | `IMAGE` | `QUESTION_MEDIA` | `ACTIVE` | 货架错误态 |
| `asset_img_jdg_ms04_safety_master_v001` | `AIimages/JDG-MS04-safety-risk-master-v001.png` | `app://asset/asset_img_jdg_ms04_safety_master_v001` | `IMAGE` | `QUESTION_MEDIA` | `ACTIVE` | 安全判断题母版 |
| `asset_img_drg_bg01_shelf_board_v001` | `AIimages/DRG-BG01-shelf-alignment-board-v001.png` | `app://asset/asset_img_drg_bg01_shelf_board_v001` | `IMAGE` | `QUESTION_MEDIA` | `ACTIVE` | 拖拽题货架底图 |
| `asset_img_drg_obj02_goods_pack_v003` | `AIimages/DRG-OBJ02-goods-facing-pack-v003.png` | `app://asset/asset_img_drg_obj02_goods_pack_v003` | `IMAGE` | `QUESTION_MEDIA` | `ACTIVE` | 拖拽题商品素材包总图 v003 |
| `asset_img_drg_obj02_snack_box_blue_v002` | `AIimages/drg-obj02-snack-box-blue-v002.png` | `app://asset/asset_img_drg_obj02_snack_box_blue_v002` | `IMAGE` | `QUESTION_MEDIA` | `ACTIVE` | 拖拽题零食盒蓝色子素材 |
| `asset_img_drg_obj02_snack_box_red_v002` | `AIimages/drg-obj02-snack-box-red-v002.png` | `app://asset/asset_img_drg_obj02_snack_box_red_v002` | `IMAGE` | `QUESTION_MEDIA` | `ACTIVE` | 拖拽题零食盒红色子素材 |
| `asset_img_drg_obj02_snack_box_yellow_v002` | `AIimages/drg-obj02-snack-box-yellow-v002.png` | `app://asset/asset_img_drg_obj02_snack_box_yellow_v002` | `IMAGE` | `QUESTION_MEDIA` | `ACTIVE` | 拖拽题零食盒黄色子素材 |
| `asset_img_drg_obj02_snack_box_green_v002` | `AIimages/drg-obj02-snack-box-green-v002.png` | `app://asset/asset_img_drg_obj02_snack_box_green_v002` | `IMAGE` | `QUESTION_MEDIA` | `ACTIVE` | 拖拽题零食盒绿色子素材 |
| `asset_img_drg_obj02_homecare_box_white_blue_v002` | `AIimages/drg-obj02-homecare-box-white-blue-v002.png` | `app://asset/asset_img_drg_obj02_homecare_box_white_blue_v002` | `IMAGE` | `QUESTION_MEDIA` | `ACTIVE` | 拖拽题日化盒白蓝子素材 |
| `asset_img_drg_obj02_homecare_box_white_orange_v002` | `AIimages/drg-obj02-homecare-box-white-orange-v002.png` | `app://asset/asset_img_drg_obj02_homecare_box_white_orange_v002` | `IMAGE` | `QUESTION_MEDIA` | `ACTIVE` | 拖拽题日化盒白橙子素材 |
| `asset_img_drg_obj02_homecare_box_purple_white_v002` | `AIimages/drg-obj02-homecare-box-purple-white-v002.png` | `app://asset/asset_img_drg_obj02_homecare_box_purple_white_v002` | `IMAGE` | `QUESTION_MEDIA` | `ACTIVE` | 拖拽题日化盒紫白子素材 |
| `asset_img_drg_obj02_drink_bottle_orange_v002` | `AIimages/drg-obj02-drink-bottle-orange-v002.png` | `app://asset/asset_img_drg_obj02_drink_bottle_orange_v002` | `IMAGE` | `QUESTION_MEDIA` | `ACTIVE` | 拖拽题饮料瓶橙色子素材 |
| `asset_img_drg_obj02_drink_bottle_green_v002` | `AIimages/drg-obj02-drink-bottle-green-v002.png` | `app://asset/asset_img_drg_obj02_drink_bottle_green_v002` | `IMAGE` | `QUESTION_MEDIA` | `ACTIVE` | 拖拽题饮料瓶绿色子素材 |

---

## 4. 题目挂接草案

## 4.1 判断题：`JDG-MS02` 货架母版链路

### 方案建议

判断题不要直接把 `correct` / `wrong` 各建成两道完全无关联的题。  
更适合当前 schema 和 PRD 的方式是：

1. 主题目 `question_bank.media_asset_id` 可指向母版或留空
2. 正误素材写入 `content_json.variants[]`
3. 出题时按策略或题目版本选择具体变体

### 草案示例

适用题：

- `ROW 11`
- `ROW 17`
- `ROW 68`
- 后续同一母场景下的货架判断题

建议挂接：

| target_question | question_type | attach_field | asset_id | note |
|---|---|---|---|---|
| `Q_BASE_FINE_MOTOR_TF_011`（示例） | `TRUE_FALSE` | `content_json.variants[0].media_asset_id` | `asset_img_jdg_ms02_facing_correct_v001` | `expected_answer=true` |
| `Q_BASE_FINE_MOTOR_TF_011`（示例） | `TRUE_FALSE` | `content_json.variants[1].media_asset_id` | `asset_img_jdg_ms02_facing_wrong_v001` | `expected_answer=false` |

建议 `content_json.variants` 结构示例：

```json
[
  {
    "variant_id": "jdg_ms02_facing_correct_v001",
    "media_asset_id": "asset_img_jdg_ms02_facing_correct_v001",
    "media_brief": "白色标准货架，商品正面朝外、对齐整齐",
    "expected_answer": true
  },
  {
    "variant_id": "jdg_ms02_facing_wrong_v001",
    "media_asset_id": "asset_img_jdg_ms02_facing_wrong_v001",
    "media_brief": "白色标准货架，商品歪斜、未正面朝外、未对齐",
    "expected_answer": false
  }
]
```

---

## 4.2 判断题：`JDG-MS04` 安全母版链路

适用题：

- `ROW 245`
- `ROW 246`
- `ROW 247`
- `ROW 249`
- `ROW 251`
- `ROW 252`
- `ROW 254`
- `ROW 256`

当前状态：

- 已有安全母版：`asset_img_jdg_ms04_safety_master_v001`
- 尚未拆出各题专属 `correct / wrong` 变体图

当前建议：

| target_question | question_type | attach_field | asset_id | note |
|---|---|---|---|---|
| 对应安全判断题 | `TRUE_FALSE` | `question_bank.media_asset_id` | `asset_img_jdg_ms04_safety_master_v001` | 当前先作为母版占位；后续应继续拆题目变体 |

说明：

- 这只是“可接入草案”，不是最终最优结构。
- 真正用于上线测评前，`JDG-MS04` 应继续扩成具体安全动作题的正误变体，再迁移到 `content_json.variants[]`。

---

## 4.3 拖拽题：`DRG-BG01` 货架底图

适用题：

- `ROW 35`
- `ROW 38`
- `ROW 88`
- `ROW 91`
- `ROW 94`

建议挂接：

| target_question | question_type | attach_field | asset_id | note |
|---|---|---|---|---|
| 对应拖拽题 | `DRAG` | `question_bank.media_asset_id` | `asset_img_drg_bg01_shelf_board_v001` | 底图 / 场景母版 |

说明：

- `question_bank.media_asset_id` 适合作为拖拽题的主底图。
- 真正可拖拽元素不要靠这一张总底图完成，需要配合 `drag_items[].image_asset_id`。

---

## 4.4 拖拽题：`DRG-OBJ02` 商品素材包

适用题：

- `ROW 35` 正面朝外
- `ROW 38` 货架格位归位

当前状态：

- 现在 `DRG-OBJ02-goods-facing-pack-v003.png` 是当前定稿的“素材总览图”，适合做视觉基线，不适合直接作为多个 draggable item 分别挂接。
- 已补出 9 张 `v002` 子素材，可直接登记并挂到 `content_json.drag_items[].image_asset_id`。

当前正确落地建议：

1. 保留 `DRG-OBJ02-goods-facing-pack-v003.png` 作为素材包总览 / 视觉基线，不直接挂题。
2. 将以下 9 张 `v002` 子素材单独登记 `asset_resource`：
   - `drg-obj02-snack-box-blue-v002.png`
   - `drg-obj02-snack-box-red-v002.png`
   - `drg-obj02-snack-box-yellow-v002.png`
   - `drg-obj02-snack-box-green-v002.png`
   - `drg-obj02-homecare-box-white-blue-v002.png`
   - `drg-obj02-homecare-box-white-orange-v002.png`
   - `drg-obj02-homecare-box-purple-white-v002.png`
   - `drg-obj02-drink-bottle-orange-v002.png`
   - `drg-obj02-drink-bottle-green-v002.png`
3. 每个拖拽项单独写入 `content_json.drag_items[].image_asset_id`。
4. 继续禁止混用旧版 `v001`、`whitebg` 和 `task_*` 中间图。

当前建议挂接如下：

| target_question | question_type | attach_field | asset_id | note |
|---|---|---|---|---|
| 暂不直接挂题 | `DRAG` | 暂不建议直接挂 | `asset_img_drg_obj02_goods_pack_v003` | 作为素材包总览 / 设计基线，而不是最终 draggable item |
| `ROW 35` / `ROW 38` 对应拖拽项（示例） | `DRAG` | `content_json.drag_items[0].image_asset_id` | `asset_img_drg_obj02_snack_box_blue_v002` | 蓝色零食盒 draggable item |
| `ROW 35` / `ROW 38` 对应拖拽项（示例） | `DRAG` | `content_json.drag_items[1].image_asset_id` | `asset_img_drg_obj02_snack_box_red_v002` | 红色零食盒 draggable item |
| `ROW 35` / `ROW 38` 对应拖拽项（示例） | `DRAG` | `content_json.drag_items[2].image_asset_id` | `asset_img_drg_obj02_snack_box_yellow_v002` | 黄色零食盒 draggable item |
| `ROW 35` / `ROW 38` 对应拖拽项（示例） | `DRAG` | `content_json.drag_items[3].image_asset_id` | `asset_img_drg_obj02_snack_box_green_v002` | 绿色零食盒 draggable item |
| `ROW 35` / `ROW 38` 对应拖拽项（示例） | `DRAG` | `content_json.drag_items[4].image_asset_id` | `asset_img_drg_obj02_homecare_box_white_blue_v002` | 白蓝日化盒 draggable item |
| `ROW 35` / `ROW 38` 对应拖拽项（示例） | `DRAG` | `content_json.drag_items[5].image_asset_id` | `asset_img_drg_obj02_homecare_box_white_orange_v002` | 白橙日化盒 draggable item |
| `ROW 35` / `ROW 38` 对应拖拽项（示例） | `DRAG` | `content_json.drag_items[6].image_asset_id` | `asset_img_drg_obj02_homecare_box_purple_white_v002` | 紫白日化盒 draggable item |
| `ROW 35` / `ROW 38` 对应拖拽项（示例） | `DRAG` | `content_json.drag_items[7].image_asset_id` | `asset_img_drg_obj02_drink_bottle_orange_v002` | 橙色饮料瓶 draggable item |
| `ROW 35` / `ROW 38` 对应拖拽项（示例） | `DRAG` | `content_json.drag_items[8].image_asset_id` | `asset_img_drg_obj02_drink_bottle_green_v002` | 绿色饮料瓶 draggable item |

建议 `content_json.drag_items` 结构示例：

```json
[
  {
    "item_id": "snack_box_blue",
    "label": "蓝色零食盒",
    "image_asset_id": "asset_img_drg_obj02_snack_box_blue_v002"
  },
  {
    "item_id": "snack_box_red",
    "label": "红色零食盒",
    "image_asset_id": "asset_img_drg_obj02_snack_box_red_v002"
  },
  {
    "item_id": "snack_box_yellow",
    "label": "黄色零食盒",
    "image_asset_id": "asset_img_drg_obj02_snack_box_yellow_v002"
  },
  {
    "item_id": "snack_box_green",
    "label": "绿色零食盒",
    "image_asset_id": "asset_img_drg_obj02_snack_box_green_v002"
  },
  {
    "item_id": "homecare_box_white_blue",
    "label": "白蓝日化盒",
    "image_asset_id": "asset_img_drg_obj02_homecare_box_white_blue_v002"
  },
  {
    "item_id": "homecare_box_white_orange",
    "label": "白橙日化盒",
    "image_asset_id": "asset_img_drg_obj02_homecare_box_white_orange_v002"
  },
  {
    "item_id": "homecare_box_purple_white",
    "label": "紫白日化盒",
    "image_asset_id": "asset_img_drg_obj02_homecare_box_purple_white_v002"
  },
  {
    "item_id": "drink_bottle_orange",
    "label": "橙色饮料瓶",
    "image_asset_id": "asset_img_drg_obj02_drink_bottle_orange_v002"
  },
  {
    "item_id": "drink_bottle_green",
    "label": "绿色饮料瓶",
    "image_asset_id": "asset_img_drg_obj02_drink_bottle_green_v002"
  }
]
```

---

## 5. 编码会话下一步建议

如果编码会话要开始做“资源接入”，建议按这个顺序推进：

1. 先实现 `asset_resource` 的登记脚本 / seed 方案
2. 先登记当前 6 个标准资产 + 9 个 `DRG-OBJ02` 子素材
3. 先把 `JDG-MS02`、`DRG-BG01` 和完整 `DRG-OBJ02` 拖拽项接进题库草案
4. `DRG-OBJ02-goods-facing-pack-v003` 继续不要直接挂题，只保留为总览基线
5. 后续补 `JDG-MS04` 的具体正误变体，再从“母版占位”升级到“正式变体挂接”

---

## 6. 当前进度与未完成项

> 更新时间：2026-07-03（asset_resource 已全量入库、DRAG DRAFT 已落库后同步）

### 6.1 已完成

1. ✅ 真实 `file_hash`（SHA-256）已计算并写入 TSV 与 `asset_resource`
2. ✅ 真实 `file_size_bytes` / `width_px` / `height_px` 已补齐
3. ✅ 数据库 `asset_resource` 已全量登记：16 条，含 4 张 JDG + 1 张 DRG-BG01 底图 + 1 张 DRG-OBJ02-v003 总览 + 9 张 DRG-OBJ02 v002 子素材 + 1 张 v001 历史总览（待 DEPRECATED，见 6.2）
4. ✅ `DRG-OBJ02` 拖拽题 DRAFT 已落库：`Q_BASE_FINE_MOTOR_DRAG_002`（src_row=35，3 item 零食盒）/ `Q_BASE_FINE_MOTOR_DRAG_005`（src_row=38，3 item 跨品类）
5. ✅ seed 脚本 + 单测到位：`scripts/seed-question-bank-image-assets.mjs`、`scripts/seed-question-bank-image-drag-questions.mjs`，`scripts/__tests__/` 下 7/7 通过

### 6.2 仍未完成

1. ✅ **渲染层 `app://asset/<asset_id>` 协议已实现**：`src/main/protocol/app-asset.ts` 负责按 `asset_id` 解析资源，`asset_resource.app_uri` 应统一保存 `app://asset/<asset_id>`。
2. ⚠️ **v001 总览图孤儿**：`asset_img_drg_obj02_goods_pack_v001` 仍 `status=ACTIVE`，但 v003 才是定稿，且 `question_bank` 无任何引用——应改为 `DEPRECATED`
3. ⚠️ **`JDG-MS02` 判断题未挂接**：DB 里 4 张 JDG 资产已 ACTIVE，但没有任何 `TRUE_FALSE` 题写入 `content_json.variants[].media_asset_id`
4. ⚠️ **`JDG-MS04` 仅有母版**：没有逐题正误变体
5. ⚠️ **ROW 35 / 38 当前是 3-item DRAFT**：是否扩成 6/9-item 正式版属于产品决策，不是单纯代码问题
6. ⚠️ **`question_id` 命名未对照正式题库导入表**：`Q_BASE_FINE_MOTOR_DRAG_002 / _005` 是按 PRD 规则 + Excel 行号推出来的，若后续有正式题库导入对照表，需要核对

### 6.3 当前状态定义

```text
图片已定稿（部分）
→ asset_resource 全量入库 ✓
→ 拖拽题 DRAFT 落库 ✓
→ 渲染层 app://asset 协议已实现 ✓
→ 判断题正式挂接未开始
```
