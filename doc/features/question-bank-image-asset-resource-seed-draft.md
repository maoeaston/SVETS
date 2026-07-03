# 题库图片资产 `asset_resource` Seed 草案

文档状态：草案  
适用范围：题库图片资产首次登记、`asset_resource` seed 准备、题目素材挂接前置整理  
相关文档：

- `doc/生图结束.md`
- `doc/features/question-bank-image-asset-linking-draft.md`
- `src/main/db/schema.sql`
- `doc/xc-career-guide-json-field-schema-v1.0.0.md`

---

## 1. 背景与目标

当前项目已经形成第一批标准图片产物，但这些 PNG 文件本身还不是应用内可稳定引用的正式资源。按照项目既定链路，图片接入必须遵循：

```text
图片文件定稿
→ 登记 asset_resource
→ 题目字段写入 asset_id
→ 渲染层通过 app_uri 访问
```

本文档目标是为“题库图片资产首批入库”提供统一草案，覆盖以下内容：

1. 明确 `asset_resource` 表需要补齐的字段。
2. 统一 `asset_id`、`app_uri`、`local_path` 的命名规则。
3. 给出可直接改造成脚本或手工 SQL 的 seed 模板。
4. 给出 JSON / TSV 两类中间模板，便于整理资产清单。
5. 标注当前 `6` 个标准图片分别应该如何映射。
6. 区分哪些图片已经可以直接接入，哪些只能先作为占位资产。

---

## 2. 适用范围与非目标

### 2.1 本文档覆盖

- `asset_resource` 中图片类资产的登记准备
- `question_bank.media_asset_id` 与 `content_json` 内图片引用位点梳理
- 当前第一批 `6` 个标准图片的接入建议
- 供后续编码会话实现 seed 脚本或手工导入使用的模板

### 2.2 本文档不覆盖

- 实际文件 hash / size / 分辨率的计算实现
- Electron `app://` 协议读取逻辑实现
- 题库正式批量写库脚本
- 拖拽题子素材切图流程
- 图片生成工作流本身

---

## 3. [!] 上下文约束与冲突说明

### 3.1 必须遵守的约束

1. 所有题目层引用都必须写 `asset_id`，不能直接写磁盘路径。
2. 所有写入 JSON 字段中的 `media_asset_id` / `image_asset_id` 都必须能在 `asset_resource.asset_id` 中找到。
3. 所有被题目引用的资产都必须满足：
   - `asset_resource` 中存在该记录
   - `status = 'ACTIVE'`
4. 判断题支持两类图片挂接位点：
   - `question_bank.media_asset_id`
   - `content_json.variants[].media_asset_id`
5. 拖拽题支持两类图片挂接位点：
   - `question_bank.media_asset_id`
   - `content_json.drag_items[].image_asset_id`
6. 单选题选项图片位点为：
   - `content_json.options[].image_asset_id`

### 3.2 [!] 文档基线冲突

存在一个需要显式标记的上下文冲突：

- `AGENTS.md` 工程基线写的是 `schema v0.1.9-strategy-composite-pk`
- `doc/xc-career-guide-json-field-schema-v1.0.0.md` 内写的是 `schema.sql v0.1.8-base-ability-rebalance`

本草案以当前仓库中的 `src/main/db/schema.sql` 实际表结构为准，尤其是 `asset_resource` 与 `question_bank` 字段定义。后续如果整理正式文档，应补一次版本对齐说明。

---

## 4. `asset_resource` 字段清单

根据 `src/main/db/schema.sql`，`asset_resource` 结构如下。

| 字段名 | 类型 / 约束 | 必填 | 图片资产建议值 / 说明 |
|---|---|---:|---|
| `asset_id` | `TEXT PRIMARY KEY` | 是 | 资产稳定 ID，题目层只引用这个值 |
| `asset_type` | `TEXT NOT NULL`，枚举：`VIDEO / IMAGE / AUDIO / PDF / JSON / SQLITE / OTHER` | 是 | 图片固定写 `IMAGE` |
| `asset_role` | `TEXT`，可空，枚举：`QUESTION_MEDIA / TOOL_CHECKLIST / REPORT_FILE / VOICE_PROMPT / UI_ASSET / DATA_SNAPSHOT / OTHER` | 否 | 题库图片建议写 `QUESTION_MEDIA` |
| `app_uri` | `TEXT NOT NULL UNIQUE` | 是 | 渲染层稳定访问 URI，例如 `app://assets/question-media/...png` |
| `local_path` | `TEXT NOT NULL` | 是 | 仓库内或应用侧真实文件路径，当前草案用 `AIimages/...png` |
| `mime_type` | `TEXT` | 否但应补 | PNG 固定可写 `image/png` |
| `file_hash` | `TEXT NOT NULL` | 是 | 真实文件内容 hash，建议 `SHA-256` 十六进制 |
| `file_size_bytes` | `INTEGER NOT NULL >= 0` | 是 | 文件字节数 |
| `duration_ms` | `INTEGER`，可空 | 否 | 图片为 `NULL` |
| `width_px` | `INTEGER`，可空 | 否但应补 | 图片像素宽 |
| `height_px` | `INTEGER`，可空 | 否但应补 | 图片像素高 |
| `status` | `TEXT NOT NULL`，枚举：`ACTIVE / MISSING / CORRUPTED / DEPRECATED` | 是 | 可用图片写 `ACTIVE` |
| `last_verified_at` | `TEXT` | 否 | 最近一次文件存在性 / hash 校验时间 |
| `created_at` | `TEXT NOT NULL DEFAULT datetime('now')` | 否 | 可用默认值 |
| `updated_at` | `TEXT NOT NULL DEFAULT datetime('now')` | 否 | 可用默认值 |

### 4.1 图片资产最低入库要求

图片类资源至少应补齐以下字段后再视为正式可接入：

- `asset_id`
- `asset_type='IMAGE'`
- `asset_role='QUESTION_MEDIA'`
- `app_uri`
- `local_path`
- `mime_type='image/png'`
- `file_hash`
- `file_size_bytes`
- `status='ACTIVE'`

### 4.2 建议但可后补字段

以下字段不影响最小链路成立，但建议在首批入库时一并补齐：

- `width_px`
- `height_px`
- `last_verified_at`

---

## 5. 命名规则

### 5.1 `asset_id` 命名规则

建议统一格式：

```text
asset_img_<场景编码小写下划线化>_<语义标签>_v###
```

例如：

```text
asset_img_jdg_ms02_shelf_master_v001
asset_img_jdg_ms02_facing_correct_v001
asset_img_drg_bg01_shelf_board_v001
```

规则说明：

1. 固定前缀使用 `asset_img_`。
2. 原始图片代号如 `JDG-MS02`、`DRG-BG01` 转成小写下划线：
   - `JDG-MS02` → `jdg_ms02`
   - `DRG-BG01` → `drg_bg01`
3. 中段使用稳定语义标签，不直接照搬中文描述。
4. 末尾保留版本号，格式固定 `v001`、`v002`。
5. 已入题的 `asset_id` 不应被复用到不同图片内容；内容变化应新建版本。

### 5.2 `app_uri` 命名规则

建议统一格式：

```text
app://assets/question-media/<原文件名>
```

例如：

```text
app://assets/question-media/jdg-ms02-facing-correct-v001.png
```

规则说明：

1. 统一归入 `question-media` 命名空间。
2. URI 文件名部分使用标准文件名的小写形式。
3. `app_uri` 必须稳定且唯一，不能直接暴露本地绝对路径。
4. 同一内容变更后若产出新版本文件，应对应新 URI，而不是覆盖旧 URI。

### 5.3 `local_path` 命名规则

当前草案阶段建议直接记录仓库相对路径：

```text
AIimages/<标准文件名>
```

例如：

```text
AIimages/JDG-MS04-safety-risk-master-v001.png
```

说明：

1. 这里记录的是资产来源路径，不是渲染层消费路径。
2. 后续如果资源被复制到 Electron 应用资产目录，`local_path` 是否保留原路径或改为部署路径，需要编码方案统一决定。
3. 在题库 JSON 中绝不能写 `local_path`，只能写 `asset_id`。

---

## 6. SQL Seed 模板

以下模板用于手工 seed 或后续脚本生成时参考。

### 6.1 单条插入模板

```sql
INSERT INTO asset_resource (
  asset_id,
  asset_type,
  asset_role,
  app_uri,
  local_path,
  mime_type,
  file_hash,
  file_size_bytes,
  duration_ms,
  width_px,
  height_px,
  status,
  last_verified_at
) VALUES (
  :asset_id,
  'IMAGE',
  'QUESTION_MEDIA',
  :app_uri,
  :local_path,
  'image/png',
  :file_hash,
  :file_size_bytes,
  NULL,
  :width_px,
  :height_px,
  'ACTIVE',
  :last_verified_at
);
```

### 6.2 首批批量 Seed 模板

> 说明：以下 `file_hash`、`file_size_bytes`、`width_px`、`height_px` 为占位值，正式执行前必须替换。

```sql
INSERT INTO asset_resource (
  asset_id,
  asset_type,
  asset_role,
  app_uri,
  local_path,
  mime_type,
  file_hash,
  file_size_bytes,
  duration_ms,
  width_px,
  height_px,
  status,
  last_verified_at
) VALUES
(
  'asset_img_jdg_ms02_shelf_master_v001',
  'IMAGE',
  'QUESTION_MEDIA',
  'app://assets/question-media/jdg-ms02-standard-shelf-master-v001.png',
  'AIimages/JDG-MS02-standard-shelf-master-v001.png',
  'image/png',
  '__TODO_SHA256__',
  0,
  NULL,
  NULL,
  NULL,
  'ACTIVE',
  NULL
),
(
  'asset_img_jdg_ms02_facing_correct_v001',
  'IMAGE',
  'QUESTION_MEDIA',
  'app://assets/question-media/jdg-ms02-facing-correct-v001.png',
  'AIimages/JDG-MS02-facing-correct-v001.png',
  'image/png',
  '__TODO_SHA256__',
  0,
  NULL,
  NULL,
  NULL,
  'ACTIVE',
  NULL
),
(
  'asset_img_jdg_ms02_facing_wrong_v001',
  'IMAGE',
  'QUESTION_MEDIA',
  'app://assets/question-media/jdg-ms02-facing-wrong-v001.png',
  'AIimages/JDG-MS02-facing-wrong-v001.png',
  'image/png',
  '__TODO_SHA256__',
  0,
  NULL,
  NULL,
  NULL,
  'ACTIVE',
  NULL
),
(
  'asset_img_jdg_ms04_safety_master_v001',
  'IMAGE',
  'QUESTION_MEDIA',
  'app://assets/question-media/jdg-ms04-safety-risk-master-v001.png',
  'AIimages/JDG-MS04-safety-risk-master-v001.png',
  'image/png',
  '__TODO_SHA256__',
  0,
  NULL,
  NULL,
  NULL,
  'ACTIVE',
  NULL
),
(
  'asset_img_drg_bg01_shelf_board_v001',
  'IMAGE',
  'QUESTION_MEDIA',
  'app://assets/question-media/drg-bg01-shelf-alignment-board-v001.png',
  'AIimages/DRG-BG01-shelf-alignment-board-v001.png',
  'image/png',
  '__TODO_SHA256__',
  0,
  NULL,
  NULL,
  NULL,
  'ACTIVE',
  NULL
),
(
  'asset_img_drg_obj02_goods_pack_v003',
  'IMAGE',
  'QUESTION_MEDIA',
  'app://assets/question-media/drg-obj02-goods-facing-pack-v003.png',
  'AIimages/DRG-OBJ02-goods-facing-pack-v003.png',
  'image/png',
  '__TODO_SHA256__',
  0,
  NULL,
  NULL,
  NULL,
  'ACTIVE',
  NULL
);
```

### 6.3 入库前校验清单

执行前至少校验：

1. `app_uri` 唯一。
2. `asset_id` 唯一。
3. `local_path` 对应文件存在。
4. `file_hash` 由真实文件计算，不允许保留占位值。
5. `file_size_bytes > 0`。
6. PNG 文件 `mime_type` 为 `image/png`。
7. 若后续要挂题，状态必须是 `ACTIVE`。

---

## 7. JSON / TSV 模板

### 7.1 JSON 模板

适用于先整理清单，再由脚本转 SQL。

```json
[
  {
    "asset_id": "asset_img_jdg_ms02_facing_correct_v001",
    "asset_type": "IMAGE",
    "asset_role": "QUESTION_MEDIA",
    "app_uri": "app://assets/question-media/jdg-ms02-facing-correct-v001.png",
    "local_path": "AIimages/JDG-MS02-facing-correct-v001.png",
    "mime_type": "image/png",
    "file_hash": "__TODO_SHA256__",
    "file_size_bytes": 0,
    "width_px": null,
    "height_px": null,
    "status": "ACTIVE",
    "last_verified_at": null,
    "link_target": {
      "question_type": "TRUE_FALSE",
      "attach_field": "content_json.variants[].media_asset_id",
      "note": "判断题正确态变体"
    }
  }
]
```

建议保留两个额外说明字段，便于人工整理但不一定直接入库：

- `link_target`
- `note`

这两个字段可在真正写表前剔除。

### 7.2 TSV 模板

适用于人工盘点与批量导入前审阅。

```tsv
asset_id	asset_type	asset_role	app_uri	local_path	mime_type	file_hash	file_size_bytes	width_px	height_px	status	target_question_type	attach_field	note
asset_img_jdg_ms02_facing_correct_v001	IMAGE	QUESTION_MEDIA	app://assets/question-media/jdg-ms02-facing-correct-v001.png	AIimages/JDG-MS02-facing-correct-v001.png	image/png	__TODO_SHA256__	0			ACTIVE	TRUE_FALSE	content_json.variants[].media_asset_id	判断题正确态变体
```

建议列顺序固定，原因是后续最常见的核对动作就是：

1. 先看资源自身是否可入库。
2. 再看它计划挂到哪个题型字段。

---

## 8. 当前 `6` 个标准图片映射

当前已明确的第一批标准资产如下：

1. `AIimages/JDG-MS02-standard-shelf-master-v001.png`
2. `AIimages/JDG-MS02-facing-correct-v001.png`
3. `AIimages/JDG-MS02-facing-wrong-v001.png`
4. `AIimages/JDG-MS04-safety-risk-master-v001.png`
5. `AIimages/DRG-BG01-shelf-alignment-board-v001.png`
6. `AIimages/DRG-OBJ02-goods-facing-pack-v003.png`

对应映射建议如下。

| 标准文件 | 建议 `asset_id` | 建议 `app_uri` | 推荐挂接位点 | 当前定位 |
|---|---|---|---|---|
| `JDG-MS02-standard-shelf-master-v001.png` | `asset_img_jdg_ms02_shelf_master_v001` | `app://assets/question-media/jdg-ms02-standard-shelf-master-v001.png` | 可作为 `question_bank.media_asset_id` 的母版，或仅保留为场景基线 | 母版资产 |
| `JDG-MS02-facing-correct-v001.png` | `asset_img_jdg_ms02_facing_correct_v001` | `app://assets/question-media/jdg-ms02-facing-correct-v001.png` | `content_json.variants[].media_asset_id` | 判断题正确态 |
| `JDG-MS02-facing-wrong-v001.png` | `asset_img_jdg_ms02_facing_wrong_v001` | `app://assets/question-media/jdg-ms02-facing-wrong-v001.png` | `content_json.variants[].media_asset_id` | 判断题错误态 |
| `JDG-MS04-safety-risk-master-v001.png` | `asset_img_jdg_ms04_safety_master_v001` | `app://assets/question-media/jdg-ms04-safety-risk-master-v001.png` | 当前仅适合 `question_bank.media_asset_id` 母版占位 | 安全题母版 |
| `DRG-BG01-shelf-alignment-board-v001.png` | `asset_img_drg_bg01_shelf_board_v001` | `app://assets/question-media/drg-bg01-shelf-alignment-board-v001.png` | `question_bank.media_asset_id` | 拖拽题底图 |
| `DRG-OBJ02-goods-facing-pack-v003.png` | `asset_img_drg_obj02_goods_pack_v003` | `app://assets/question-media/drg-obj02-goods-facing-pack-v003.png` | 当前不建议直接写入 `drag_items[].image_asset_id` | 素材包总览图 |

---

## 9. 哪些资产可直接接入，哪些只能占位

### 9.1 可直接接入的资产

以下资产从“结构适配性”看，已经可以直接进入正式接入链路。前提是补齐 hash / size 等物理元数据。

#### A. `JDG-MS02-facing-correct-v001.png`

可直接接入原因：

1. 它对应判断题中的单一明确变体。
2. 与 `content_json.variants[].media_asset_id` 的设计完全匹配。
3. 不需要再切分子素材。

建议用途：

- 作为 `TRUE_FALSE` 题的正确态素材。

#### B. `JDG-MS02-facing-wrong-v001.png`

可直接接入原因：

1. 与上面同理。
2. 可和 `correct` 版本组成完整的判断题双变体集合。

建议用途：

- 作为 `TRUE_FALSE` 题的错误态素材。

#### C. `DRG-BG01-shelf-alignment-board-v001.png`

可直接接入原因：

1. 它是完整场景底图，而不是元素拼图。
2. 与拖拽题 `question_bank.media_asset_id` 的“主场景图”定位一致。

建议用途：

- 作为 `DRAG` 题主底图。

### 9.2 可登记但当前只建议作为占位 / 母版的资产

#### A. `JDG-MS02-standard-shelf-master-v001.png`

原因：

1. 这是母版，不是判断题最终答题态本身。
2. 如果已经有 `correct` / `wrong` 正式变体，母版不一定需要直接展示给学生。
3. 更适合保留为场景源资产，或个别题目的 `question_bank.media_asset_id` 占位。

结论：

- 可以登记到 `asset_resource`
- 但是否直接挂题，需要题目展示策略进一步确认

#### B. `JDG-MS04-safety-risk-master-v001.png`

原因：

1. 当前只有安全风险母版，没有逐题拆开的正误变体。
2. 安全题通常更适合最终落在 `variants[].media_asset_id`，而不是多个题共用同一张模糊母版。
3. 现在直接挂题会形成“能展示，但题目语义不够闭合”的状态。

结论：

- 可以先登记
- 当前只建议作为 `question_bank.media_asset_id` 占位或蓝本母版
- 不建议视为最终上线态素材

#### C. `DRG-OBJ02-goods-facing-pack-v003.png`

原因：

1. 它是素材总览图，不是单个可拖拽元素。
2. `content_json.drag_items[].image_asset_id` 需要的是一项对应一张图。
3. 如果直接把总览图挂成 draggable item，会破坏题目交互结构。

结论：

- 可以登记到 `asset_resource`
- 当前只应作为素材包总览、设计基线或评审参考图
- 不能直接替代后续拆分后的子素材图

---

## 10. 与 JSON 字段规范的对应关系

根据 `doc/xc-career-guide-json-field-schema-v1.0.0.md`，图片接入位点如下。

### 10.1 判断题

`TRUE_FALSE` 的变体结构：

```json
{
  "variant_id": "jdg_ms02_facing_correct_v001",
  "media_asset_id": "asset_img_jdg_ms02_facing_correct_v001",
  "media_brief": "白色标准货架，商品正面朝外、对齐整齐",
  "expected_answer": true
}
```

要点：

1. `media_asset_id` 必须存在于 `asset_resource`。
2. `variants` 适合判断题正误双图。
3. 若使用 `variants`，应避免再让同一题依赖裸路径或临时文件名。

### 10.2 拖拽题

拖拽项结构：

```json
{
  "item_id": "d1",
  "label": "牛奶",
  "image_asset_id": "asset_milk_img_001"
}
```

要点：

1. `drag_items[].image_asset_id` 需要单元素单图片。
2. 因此 `DRG-OBJ02-goods-facing-pack-v003.png` 不能直接填进这里。
3. 只有等素材包拆成多个独立 PNG 后，才适合进入 `drag_items[].image_asset_id`。

### 10.3 单选题

若未来单选题引入图片选项，可写：

- `content_json.options[].image_asset_id`

但当前第一批 `6` 张标准图里，没有哪一张明确对应“单选题选项图”定位。

---

## 11. 推荐落地顺序

建议编码会话后续按以下顺序推进：

1. 先补齐首批 `6` 张图片的真实文件元数据：
   - `file_hash`
   - `file_size_bytes`
   - `width_px`
   - `height_px`
2. 先写入 `asset_resource`。
3. 优先把可直接接入的 `3` 类资产挂到题目草案：
   - `JDG-MS02-facing-correct-v001.png`
   - `JDG-MS02-facing-wrong-v001.png`
   - `DRG-BG01-shelf-alignment-board-v001.png`
4. 将以下资产仅作为占位 / 母版保留：
   - `JDG-MS02-standard-shelf-master-v001.png`
   - `JDG-MS04-safety-risk-master-v001.png`
   - `DRG-OBJ02-goods-facing-pack-v003.png`
5. 后续补图方向：
   - `JDG-MS04` 拆成逐题正误变体
   - `DRG-OBJ02` 拆成多个独立 draggable 子素材

---

## 12. 待补清单

> 更新时间：2026-07-03（草案落地后回填）

### 12.1 已完成

1. ✅ 所有图片真实 `SHA-256 file_hash` 已计算并写入 TSV 与 `asset_resource`
2. ✅ 真实 `file_size_bytes` 已写入
3. ✅ `width_px` / `height_px` 已确认并写入
4. ✅ 正式导入脚本已形成：`scripts/seed-question-bank-image-assets.mjs` + `scripts/lib/question-bank-image-asset-seed.mjs` 校验器 + `scripts/__tests__/seed-question-bank-image-assets.test.mjs`（6/6 通过）
5. ✅ 草案扩展：原 6 张标准资产 + `DRG-OBJ02` v003 总览 + 9 张 `v002` 子素材 = 共 16 条已全部入库
6. ✅ 题目挂接：`Q_BASE_FINE_MOTOR_DRAG_002` / `Q_BASE_FINE_MOTOR_DRAG_005` DRAFT 已写入 `question_bank`，并通过 `media_asset_id` + `content_json.drag_items[].image_asset_id` 完成与 `asset_resource` 的绑定

### 12.2 仍未完成

1. ⚠️ **`app://assets/question-media/...` 协议在渲染层未实现**：DB 层 `app_uri` 已写入，但 Electron 主进程没有 `registerFileProtocol` / `protocol.handle` 注册代码，渲染进程读不到图片。这是当前链路的硬阻塞点。
2. ⚠️ **`question_id` ↔ `asset_id` 一一对应清单尚未形成正式文档**：当前 `Q_BASE_FINE_MOTOR_DRAG_002` / `_005` 是按 Excel 行号推命名，未与正式题库导入对照表核对。
3. ⚠️ **v001 历史总览待标记 DEPRECATED**：`asset_img_drg_obj02_goods_pack_v001` 仍 `ACTIVE`，但定稿是 v003。
4. ⚠️ **JDG 判断题挂接未开始**：4 张 JDG 资产已入库 ACTIVE，但 `question_bank` 中没有任何 `TRUE_FALSE` 题实际写入 `variants[].media_asset_id`。

### 12.3 当前状态定义

```text
图片标准版已收口（部分，含 9 张 v002 子素材）
→ asset_resource 全量入库 ✓
→ 拖拽题 DRAFT 挂接 ✓
→ 渲染层 app:// 协议未实现 ✗  ← 当前阻塞点
→ 判断题挂接未开始
```

---

## 13. 结论

首批 `6` 张标准图片已经足够支撑一版 `asset_resource` seed 草案，但它们并不都处于同样的“可直接接题”状态：

- `JDG-MS02-facing-correct-v001`、`JDG-MS02-facing-wrong-v001`、`DRG-BG01-shelf-alignment-board-v001` 可直接进入正式接入准备；
- `JDG-MS02-standard-shelf-master-v001`、`JDG-MS04-safety-risk-master-v001`、`DRG-OBJ02-goods-facing-pack-v003` 现阶段更适合作为母版或占位资源；
- 所有题目最终都必须引用 `asset_id`，不能绕过 `asset_resource` 直接写路径。
