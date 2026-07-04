# 图片资产接入执行清单（供编码 agent 使用）

**目标**：把当前已定稿图片，从文件状态推进到“可被题目正式引用”的状态。  
**适用对象**：负责资源接入、题库 seed、`asset_resource` 入库或题目挂接的编码 agent。  
**输入前提**：

- `doc/features/question-bank-image-asset-resource-seed-draft.md`
- `doc/features/question-bank-image-asset-seed-input.tsv`
- `src/main/db/schema.sql`
- `doc/xc-career-guide-json-field-schema-v1.0.0.md`

---

## 1. 执行目标

本清单只关心这一条链：

```text
TSV 输入表
→ 补齐文件元数据
→ 写入 asset_resource
→ 按题型挂到 question_bank / content_json
→ 渲染层可通过 app_uri 访问
```

本清单不负责：

- 再次生成图片
- 重构生图 prompt
- 改题目业务规则
- 改产品范围

---

## 2. 开始前确认

执行前先确认以下事实，不要跳过：

1. 当前 `AIimages/` 中标准资产已经收口，没有混用 `r2 / r3`。
2. `question-bank-image-asset-seed-input.tsv` 中列头就是本轮唯一输入表。
3. 当前 `.continue-here.md` 主状态如果仍是编码实现，不要被图片交接信息覆盖。
4. 本轮若要写入题目 JSON，必须遵守 `doc/xc-career-guide-json-field-schema-v1.0.0.md`。

---

## 3. 第一步：补齐 TSV 中的真实文件元数据

文件：

- `doc/features/question-bank-image-asset-seed-input.tsv`

当前占位字段：

- `file_hash`
- `file_size_bytes`
- `width_px`
- `height_px`

执行要求：

1. 对每个标准图片文件计算真实 `SHA-256`
2. 读取真实文件大小（字节）
3. 读取真实宽高像素
4. 用真实值替换当前 `__TODO_*__`

完成标准：

- `question-bank-image-asset-seed-input.tsv` 不再含 `__TODO_`

失败条件：

- 任一 `local_path` 对应文件不存在
- 同一文件 hash 为空或读取失败

---

## 4. 第二步：生成 `asset_resource` 入库数据

基于：

- `question-bank-image-asset-seed-input.tsv`
- `doc/features/question-bank-image-asset-resource-seed-draft.md`

执行方式二选一：

### 方案 A：生成 SQL seed

输出：

- `INSERT INTO asset_resource (...) VALUES ...`

要求：

1. `asset_type='IMAGE'`
2. `asset_role='QUESTION_MEDIA'`
3. `status='ACTIVE'`
4. `app_uri` 唯一
5. `asset_id` 唯一

### 方案 B：生成代码 / 脚本输入 JSON

输出：

- 供 seed 脚本消费的结构化 JSON

要求：

1. 字段与 `asset_resource` 表结构一一对应
2. 不保留中间解释字段进入最终插入结构
3. 保留题目挂接说明供后续第二步使用

---

## 5. 第三步：区分“可直接接题”和“只可占位”

按当前约定分两组处理。

### 5.1 可直接接题

当前可直接接题资产：

- `asset_img_jdg_ms02_facing_correct_v001`
- `asset_img_jdg_ms02_facing_wrong_v001`
- `asset_img_drg_bg01_shelf_board_v001`
- `asset_img_drg_obj02_snack_box_blue_v002`
- `asset_img_drg_obj02_snack_box_red_v002`
- `asset_img_drg_obj02_snack_box_yellow_v002`
- `asset_img_drg_obj02_snack_box_green_v002`
- `asset_img_drg_obj02_homecare_box_white_blue_v002`
- `asset_img_drg_obj02_homecare_box_white_orange_v002`
- `asset_img_drg_obj02_homecare_box_purple_white_v002`
- `asset_img_drg_obj02_drink_bottle_orange_v002`
- `asset_img_drg_obj02_drink_bottle_green_v002`

处理要求：

- 入 `asset_resource` 后，可以继续推进题目字段挂接

### 5.2 只可占位 / 母版

当前只能占位的资产：

- `asset_img_jdg_ms02_shelf_master_v001`
- `asset_img_jdg_ms04_safety_master_v001`
- `asset_img_drg_obj02_goods_pack_v003`

处理要求：

- 可以先入 `asset_resource`
- 但不能误报为“题目已完成正式挂接”

特别说明：

- `asset_img_drg_obj02_goods_pack_v003` 是素材总览图，不能直接写进 `content_json.drag_items[].image_asset_id`

---

## 6. 第四步：按题型挂接字段

### 6.1 判断题：`TRUE_FALSE`

优先挂接到：

- `content_json.variants[].media_asset_id`

当前适用：

- `asset_img_jdg_ms02_facing_correct_v001`
- `asset_img_jdg_ms02_facing_wrong_v001`

要求：

1. 同一题的 `variants` 中同时写入 correct / wrong
2. 每个 variant 都要有：
   - `variant_id`
   - `media_asset_id`
   - `media_brief`
   - `expected_answer`

### 6.2 拖拽题：`DRAG`

底图优先挂到：

- `question_bank.media_asset_id`

当前适用：

- `asset_img_drg_bg01_shelf_board_v001`

可拖拽子素材未来应挂到：

- `content_json.drag_items[].image_asset_id`

当前不适用：

- `asset_img_drg_obj02_goods_pack_v003`

原因：

- 它还是总览图，不是单个 draggable item

当前已适用：

- `asset_img_drg_obj02_snack_box_blue_v002`
- `asset_img_drg_obj02_snack_box_red_v002`
- `asset_img_drg_obj02_snack_box_yellow_v002`
- `asset_img_drg_obj02_snack_box_green_v002`
- `asset_img_drg_obj02_homecare_box_white_blue_v002`
- `asset_img_drg_obj02_homecare_box_white_orange_v002`
- `asset_img_drg_obj02_homecare_box_purple_white_v002`
- `asset_img_drg_obj02_drink_bottle_orange_v002`
- `asset_img_drg_obj02_drink_bottle_green_v002`

原因：

- 它们已经是单元素单图片 PNG，符合 `drag_items[].image_asset_id` 的结构要求；其中零食盒为透明底，日化盒和饮料瓶当前为白底成品

### 6.3 占位母版

当前仅可作为母版占位的：

- `asset_img_jdg_ms02_shelf_master_v001`
- `asset_img_jdg_ms04_safety_master_v001`

要求：

- 若临时挂 `question_bank.media_asset_id`，必须在备注或文档中标注“占位”

---

## 7. 第五步：渲染访问链路检查

接入完成前，至少确认以下问题：

1. 渲染层是否通过 `app_uri` 访问资源，而不是 `local_path`
2. `app_uri` 对应资源是否可被 Electron 正常读取
3. 图片丢失时是否有错误处理
4. `asset_resource.status != ACTIVE` 时是否会被拦截

当前代码已实现 `app://asset/<asset_id>` 读取；接入时需要确认 seed 数据不再写入旧口径 `app://assets/question-media/...`。

---

## 8. 最小交付物清单

本轮如果要宣称“图片已进入接入阶段”，最少应交付：

1. 更新后的 `question-bank-image-asset-seed-input.tsv`
2. 一份可执行的 `asset_resource` seed 数据（SQL 或 JSON）
3. 至少一组题目挂接示例：
   - `JDG-MS02` correct / wrong
   - `DRG-BG01` 底图
4. 交接说明：
   - 哪些已正式挂接
   - 哪些只是占位
   - 哪些还要继续拆素材

---

## 9. 推荐执行顺序（唯一原子化版本）

如果编码 agent 需要最小阻力推进，建议严格按这个顺序做：

1. 更新 `question-bank-image-asset-seed-input.tsv` 的真实 hash / size / 宽高
2. 生成 `asset_resource` seed
3. 先落 `asset_resource`
4. 再挂 `JDG-MS02` 的 `variants[].media_asset_id`
5. 再挂 `DRG-BG01` 的 `question_bank.media_asset_id`
6. 最后把占位资产标记清楚，不提前宣称完成

---

## 10. 完成判定

> 更新时间：2026-07-03（DB 入库 + DRAFT 拖拽题落库后复核）

以下条件同时满足，才可说”图片接入准备完成”：

| # | 条件 | 当前状态 | 备注 |
|---|---|---|---|
| 1 | `asset_resource` 数据已准备好 | ✅ | 16 条全入库（JDG 4 + DRG-BG01 + DRG-OBJ02-v003 + 9 v002 子素材 + 1 v001 历史孤儿） |
| 2 | `TSV` 中不再有占位元数据 | ✅ | hash / size / width / height 全部真实值 |
| 3 | `JDG-MS02` 已有可落地的变体挂接方案 | ⚠️ | 方案有（§6.1），DB 里 JDG 资产已 ACTIVE，但 `question_bank` 未实际挂 `variants[].media_asset_id` |
| 4 | `DRG-BG01` 已有可落地的主图挂接方案 | ✅ | `Q_BASE_FINE_MOTOR_DRAG_002` / `_005` 已落库，`media_asset_id = asset_img_drg_bg01_shelf_board_v001` |
| 5 | 占位资产和正式挂接资产已明确区分 | ⚠️ | 草案区分清楚，但 v001 历史总览仍 `ACTIVE`，未标 `DEPRECATED` |
| 6 | 渲染层可通过 `app_uri` 访问资源（§7） | ✅ | 主进程已实现 `app://asset/<asset_id>`；seed 数据需保持与 `asset_id` 一一对应 |

### 当前结论

```text
DB 层 + 题库挂接层已就绪
→ 渲染层 app://asset 协议已实现
→ 仍需完成 JDG 判断题实际挂接后，才能称为“图片接入完成”
```

### 走向”完成”的剩余路径

1. 确认所有 seed 数据统一使用 `app://asset/<asset_id>`
2. 把 `asset_img_drg_obj02_goods_pack_v001` 改为 `DEPRECATED`
3. 实际挂接至少一道 `JDG-MS02` 判断题的 `variants[].media_asset_id` 走通端到端
4. 决策 `Q_BASE_FINE_MOTOR_DRAG_002/005` 是保持 3-item DRAFT 还是扩成 6/9-item 正式版
