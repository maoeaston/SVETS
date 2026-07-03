# 通用基础能力评估题库出图规划（判断题 + 拖拽题）

**工程基线**：schema v0.1.9-strategy-composite-pk | PRD v1.0.5  
**题库来源**：`doc/通用基础能力评估题库.xlsx`  
**本轮范围**：只规划判断题、拖拽题的图片资产；本轮不实际出图  
**目标岗位**：超市理货员  
**目标任务**：拆箱与上架  
**适配技能**：`gpt-image` 为主，后续批量执行优先兼容 `apimart-imagegen batch-json`

---

## 1. 结论

本题库的图片资产不应按「每题单独出图」拆，而应按「共用母版 + 正误变体 + 独立拖拽物素材」组织。

建议资产体系如下：

1. 判断题使用 **5 个共用场景母版**，每题基于母版生成 `correct / wrong` 变体。
2. 拖拽题使用 **6 个底图母版**，配合 **8 组独立拖拽物素材包**。
3. 情绪题和社交题不单独扩出新环境，优先复用既有环境，通过角色动作、表情、人与人关系来表达差异。
4. 判断题若后续要扩成小视频，先把当前图片产物定义为 **视频关键帧母版**，保证后续可继续做 edit / 帧间延展。
5. 首批优先出 **24 个高复用资产**，先覆盖货架、桌面、安全、流程排序四类高频题。

---

## 2. 已确认决策

### 2.1 视觉方向

- 风格：`A. 写实风格`
- 画面用途：训练/测评素材，不是广告海报，不追求戏剧化光影
- 统一要求：
  - 固定环境
  - 固定机位
  - 固定灯光
  - 固定基础道具
  - 人物允许变化，但限制在有限角色池内
  - 人物默认限定为**东亚面孔、中国大陆学校使用场景可接受的学生 / 教师 / 理货训练角色**
  - 场景默认限定为**中国大陆学校职教教室或校内商超实训区语境**，避免明显海外卖场氛围

### 2.2 资产组织方式

- 判断题：`场景母版 + 正确 / 错误双态变体`
- 拖拽题：`底图母版 + 可拖拽物独立素材`

### 2.3 场景体系

固定 5 个母场景：

1. 训练桌面区
2. 标准货架区
3. 库房通道区
4. 安全风险演示区
5. 社交互动区

### 2.4 人物与环境硬约束

后续所有出图 prompt 必须显式包含以下约束：

1. 人物限定为东亚面孔，不出现明显非亚裔角色。
2. 角色设定默认贴近中国大陆中职 / 特教 / 职教学校实训使用环境。
3. 场景避免明显海外超市元素：
   - 避免明显西式大型连锁卖场陈列气质
   - 避免明显海外消防、导视、卖场标牌风格
   - 避免明显英文品牌主导画面
4. 商品包装允许使用中性虚构包装，但不能靠海外品牌视觉撑画面。
5. 所有人物服装和气质应更接近中国学校实训服或简洁工作服，不走欧美零售广告人物风格。
6. 货架上若出现大量重复商品，优先使用无文字 / 低文字包装，避免伪文字乱码。
7. 货架区优先采用浅色或白色标准货架体系，贴近 `JDG-MS02-standard-shelf-master-v001-r2` 的结构与颜色。

---

## 3. 判断题资产规划

### 3.1 判断题共用母版

#### `JDG-MS01-training-desk-master`

用于手部精细动作、桌面操作、基础认知、小件动作控制。

覆盖题型：

- 精细动作能力：
  - `ROW 6` 指尖夹取小物件
  - `ROW 10` 夹子夹取小件
  - `ROW 13` 连续拾取桌面散落物件
  - `ROW 15` 瓶盖开合
  - `ROW 18` 抚平褶皱纸张
- 认知理解能力：
  - `ROW 60` 连续两步指令
  - `ROW 64` 放到盒子外侧
- 情绪调节能力：
  - `ROW 155` 出错后平静重试
  - `ROW 161` 心愿未达成后自我平复
  - `ROW 166` 难度提升后继续尝试

#### `JDG-MS02-standard-shelf-master`

用于货架摆放、价签匹配、同类归位、卖场理货稳定性。

覆盖题型：

- 精细动作能力：
  - `ROW 11` 盒装商品单层平放
  - `ROW 17` 并排摆放多件商品
- 认知理解能力：
  - `ROW 59` 饮料区标识识别
  - `ROW 62` 同款货品识别
  - `ROW 65` 价签与商品匹配
  - `ROW 68` 同类商品摆放合理性
- 规则执行能力：
  - `ROW 109` 在指定区域活动
  - `ROW 112` 按既定步骤整理货品
  - `ROW 117` 用完物品放回原位
- 情绪调节能力：
  - `ROW 159` 长时间重复整理货品保持稳定
  - `ROW 162` 工作被打断后继续完成任务
- 安全操作能力：
  - `ROW 248` 不攀爬货架
  - `ROW 250` 货品堆叠不过高
  - `ROW 253` 卖场 / 库房内不追逐奔跑

#### `JDG-MS03-storeroom-aisle-master`

用于拆箱、箱体整理、库房通道、区域转移与物料管理。

覆盖题型：

- 精细动作能力：
  - `ROW 8` 单手扶箱、另一手撕开封条
  - `ROW 14` 整理空纸箱、折叠后整齐靠放
- 规则执行能力：
  - `ROW 115` 非工作物品不带入作业区
- 情绪调节能力：
  - `ROW 156` 临时调整作业区域愿意配合
- 安全操作能力：
  - `ROW 257` 通道内不堆放杂物
  - `ROW 255` 搬运货品平稳移动
  - `ROW 258` 工具使用完毕收纳至工具箱

#### `JDG-MS04-safety-risk-master`

用于红线和高风险安全判断，强调危险源与正确避险行为的对比。

覆盖题型：

- 安全操作能力：
  - `ROW 245` 不触碰电源插孔 / 裸露电线
  - `ROW 246` 地面湿滑慢行
  - `ROW 247` 裁剪工具刃口不对人
  - `ROW 249` 尖锐物品轻拿轻放
  - `ROW 251` 陌生不明物品不把玩
  - `ROW 252` 上下台阶稳步慢行
  - `ROW 254` 异物入眼不揉搓
  - `ROW 256` 化学品 / 清洁用品单独存放不触碰

#### `JDG-MS05-social-interaction-master`

用于人与人互动、礼貌用语、求助、汇报、离岗沟通。

覆盖题型：

- 规则执行能力：
  - `ROW 116` 别人做事时不随意打断
  - `ROW 118` 离岗休息前主动告知
  - `ROW 119` 遵守先后顺序等待轮到自己
- 情绪调节能力：
  - `ROW 164` 小分歧时平和沟通
  - `ROW 165` 疲惫时主动申请休息
  - `ROW 167` 周围人员增多时保持放松
- 基础社交能力：
  - `ROW 200-213` 判断题基本全部可复用本母版

### 3.2 判断题独立素材

#### `JDG-PK01-abstract-cognition-cards`

这组不适合硬塞进 5 个场景母版，建议作为独立平面识别卡资产。

覆盖题型：

- `ROW 57` 蔬菜 / 非蔬菜
- `ROW 58` 三角形 / 非三角形
- `ROW 61` 两组物品数量是否相等
- `ROW 63` 红色 / 非红色
- `ROW 66` 阿拉伯数字识别
- `ROW 67` 完整 / 破损
- `ROW 69` 心形 / 非心形

另有以下题建议独立处理，但仍可复用本卡组风格：

- `ROW 78` 临期 / 过期商品识别
- `ROW 79` 上午 / 下午判断
- `ROW 80` 数量最少判断

---

## 4. 拖拽题资产规划

### 4.1 拖拽题底图母版

#### `DRG-BG01-shelf-alignment-board`

货架类拖拽底图，正视角、低透视畸变、清晰格位。

覆盖题型：

- `ROW 35` 正面朝外商品摆放
- `ROW 38` 货品拖拽到对应格位
- `ROW 88` 零食 / 日化 / 饮料分类
- `ROW 91` 正常商品 / 破损商品分类
- `ROW 94` 价签匹配到商品

#### `DRG-BG02-three-zone-classification-board`

三分区拖拽底图，适合非货架分类题。

覆盖题型：

- `ROW 36` 文具 / 玩具 / 餐具 分类
- `ROW 41` 空箱 / 货品 / 耗材 分区
- `ROW 89` 动物 / 植物 / 生活用品 分类
- `ROW 273` 安全行为 / 危险行为 分类可做变体

#### `DRG-BG03-three-step-flow-board`

三步流程排序底图，三卡或多卡排序统一使用。

覆盖题型：

- `ROW 37` 拿取 → 摆放 → 整理
- `ROW 95` 吃早餐 → 吃午饭 → 放学回家
- `ROW 136-143` 规则执行模块 8 道拖拽题
- `ROW 182-189` 情绪调节模块 8 道拖拽题
- `ROW 228-235` 社交模块 8 道拖拽题
- `ROW 274-280` 安全模块中的步骤排序题

#### `DRG-BG04-two-zone-safety-board`

二分区安全底图，突出禁止区和安全区。

覆盖题型：

- `ROW 273` 安全行为 / 危险行为
- `ROW 279` 危险物品拖入「禁止触碰」区域
- `ROW 275` 重物在下 / 轻物在上，可作为双层规则底图变体

#### `DRG-BG05-vertical-position-board`

上下方位指定位置专用底图。

覆盖题型：

- `ROW 93` 上方 / 下方 指定位置

#### `DRG-BG06-square-puzzle-frame`

拼图与对齐专用底图。

覆盖题型：

- `ROW 40` 正方形拆分卡片拼接

### 4.2 拖拽物独立素材包

#### `DRG-OBJ01-geometry-sort-pack`

覆盖：

- `ROW 34` 球体、立方体、柱体，按体积从大到小排序  
  说明：按用户确认，**必须按「球体、立方体、柱体」出**，不采用原素材列中「大中小正方体」写法。

#### `DRG-OBJ02-goods-facing-pack`

覆盖：

- `ROW 35` 正面朝外商品摆放
- `ROW 38` 货架格位归位

#### `DRG-OBJ03-category-pack`

覆盖：

- `ROW 36` 文具、玩具、餐具 分类  
  说明：按用户确认，**必须按「文具、玩具、餐具」出**，不采用原素材列中「食品」写法。
- `ROW 41` 空箱、货品、耗材 分区
- `ROW 88` 零食、日化、饮料 分类
- `ROW 89` 动物、植物、生活用品 分类

#### `DRG-OBJ04-sequence-card-pack`

覆盖：

- `ROW 37` 拿取 / 摆放 / 整理
- `ROW 39` 粗 / 中 / 细 线材
- `ROW 87` 红 / 黄 / 绿
- `ROW 90` 数字 1-5
- `ROW 95` 活动顺序
- `ROW 136-143`
- `ROW 182-189`
- `ROW 228-235`
- `ROW 274-280`

#### `DRG-OBJ05-shape-and-puzzle-pack`

覆盖：

- `ROW 40` 正方形拆分卡片
- `ROW 92` 大 / 中 / 小图形

#### `DRG-OBJ06-price-tag-pack`

覆盖：

- `ROW 94` 价签与商品匹配

#### `DRG-OBJ07-safety-behavior-pack`

覆盖：

- `ROW 273` 安全行为 / 危险行为
- `ROW 279` 危险物品禁止触碰

#### `DRG-OBJ08-position-pack`

覆盖：

- `ROW 93` 上 / 下 方位目标物

---

## 5. 资产命名规则

统一使用 ASCII 命名，禁止空格，版本号显式保留。

### 5.1 判断题

- 母版：`JDG-MS{sceneNo}-{topic}-master-v001`
- 正确态：`JDG-MS{sceneNo}-{topic}-correct-v001`
- 错误态：`JDG-MS{sceneNo}-{topic}-wrong-v001`

示例：

- `JDG-MS02-standard-shelf-master-v001`
- `JDG-MS02-facing-correct-v001`
- `JDG-MS02-facing-wrong-v001`

### 5.2 拖拽题

- 底图母版：`DRG-BG{boardNo}-{topic}-v001`
- 素材包：`DRG-OBJ{packNo}-{topic}-v001`
- 单物件：`DRG-OBJ{packNo}-{topic}-{itemName}-v001`

示例：

- `DRG-BG01-shelf-alignment-board-v001`
- `DRG-OBJ06-price-tag-pack-v001`
- `DRG-OBJ06-price-tag-pack-milk-500ml-v001`

---

## 6. 首批优先出图资产（24 个）

### 6.1 判断题首批

1. `JDG-MS02-standard-shelf-master-v001`
2. `JDG-MS02-facing-correct-v001`
3. `JDG-MS02-facing-wrong-v001`
4. `JDG-MS01-training-desk-master-v001`
5. `JDG-MS01-pinch-correct-v001`
6. `JDG-MS01-pinch-wrong-v001`
7. `JDG-MS03-storeroom-aisle-master-v001`
8. `JDG-MS03-open-box-correct-v001`
9. `JDG-MS03-open-box-wrong-v001`
10. `JDG-MS04-safety-risk-master-v001`
11. `JDG-MS04-wet-floor-correct-v001`
12. `JDG-MS04-wet-floor-wrong-v001`
13. `JDG-MS04-electric-wire-correct-v001`
14. `JDG-MS04-electric-wire-wrong-v001`
15. `JDG-MS05-social-interaction-master-v001`
16. `JDG-MS05-greeting-correct-v001`
17. `JDG-MS05-greeting-wrong-v001`

### 6.2 拖拽题首批

18. `DRG-BG01-shelf-alignment-board-v001`
19. `DRG-BG02-three-zone-classification-board-v001`
20. `DRG-BG03-three-step-flow-board-v001`
21. `DRG-BG04-two-zone-safety-board-v001`
22. `DRG-OBJ02-goods-facing-pack-v001`
23. `DRG-OBJ04-sequence-card-pack-v001`
24. `DRG-OBJ06-price-tag-pack-v001`

### 6.3 建议出图顺序

1. 先出 `MS02`、`MS01`、`BG01`、`BG03`，复用率最高。
2. 再出 `MS04`，因为安全题是高优先级、且后续容易扩红线案例。
3. 再出 `MS05`，补齐社交与情绪相关题。
4. 最后补 `BG02`、`BG04`、抽象认知卡组、拼图类底图。

---

## 7. Prompt 模板（基于 `gpt-image` 参考库）

本规划优先参考：

- `gallery-photography.md`
- `gallery-architecture-and-interior.md`
- `gallery-product-and-food.md`
- `gallery-edit-endpoint-showcase.md`
- `craft.md`

### 7.1 判断题母版 Prompt 模板

```text
Landscape 16:9 photorealistic vocational assessment still. Fixed environment: SCENE_NAME. Eye-level 28 mm lens feel, soft neutral indoor lighting, realistic supermarket vocational training setting inside a Chinese mainland school practice room or campus retail training zone, clean but believable surfaces, stable shelf geometry, stable floor markings, stable table and prop positions. Show one East Asian trainee from a fixed character pool: CHARACTER_PROFILE. Wardrobe fixed: light gray training polo shirt, dark navy work apron, black pants, non-slip shoes. The person must look like a Chinese mainland school vocational training participant, not a Western retail advertisement model. If many products appear on a shelf, use mostly text-free or low-text packaging based on color blocks, icons, and simple shapes to avoid garbled packaging text. Keep the scene instructional, calm, and realistic, not cinematic drama, not commercial advertising. Leave clear visual space for later assessment UI overlay. No baked text, no watermark.
```

### 7.2 判断题错误态 Edit Prompt 模板

```text
Transform the provided assessment scene into the wrong-action variant while preserving the original camera angle, environment layout, shelf positions, table positions, lighting direction, costume, and character identity. Change only the action from CORRECT_ACTION to WRONG_ACTION. Keep the image readable as a paired vocational training comparison image. No extra people, no new props unless required by the wrong action, no dramatic effects, no text overlay.
```

### 7.3 拖拽底图母版 Prompt 模板

```text
Landscape 16:9 photorealistic training interface background for a supermarket vocational drag-and-drop task. Front-facing composition, low perspective distortion, clear landing zones, stable geometry, soft shadow, neutral light, realistic but uncluttered environment. Scene type: BOARD_TYPE. Keep the background visually clean for later UI overlay. No baked Chinese text, no arrows, no watermark.
```

### 7.4 拖拽物素材包 Prompt 模板

```text
/* DRAG_OBJECT_PACK_CONFIG
   VERSION: 1.0.0
   AESTHETIC: Realistic training asset pack */
{
  "GLOBAL_SETTINGS": {
    "aspect_ratio": "1:1 or 3:4",
    "style": "photorealistic training prop packshot",
    "background": "clean white seamless studio background",
    "lighting": "soft top-front studio light",
    "render_flags": ["sharp_edges", "consistent_scale", "no_text", "no_watermark"]
  },
  "CORE_ASSETS": {
    "pack_name": "PACK_NAME",
    "items": ["ITEM_1", "ITEM_2", "ITEM_3", "ITEM_4"],
    "view": "front-facing or slight three-quarter view",
    "material_goal": "real supermarket vocational training props, not luxury advertising props, and prefer text-free or low-text packaging for repeated shelf assets"
  },
  "OUTPUT": {
    "consistency": "all items belong to one visual system",
    "avoid": ["busy background", "decorative composition", "hard reflections"]
  }
}
```

### 7.5 抽象认知卡组 Prompt 模板

```text
Create a square educational recognition card set in realistic tabletop assessment style. Subject group: SUBJECT_A versus SUBJECT_B. Top-down flat lay on a neutral light table, evenly lit, crisp edges, clear separation between objects, no decorative clutter, no in-image text. The result should look like standardized vocational cognitive assessment material, not a poster, not a toy catalog.
```

---

## 8. 首批重点资产的具体 Prompt 草案

### 8.1 `JDG-MS02-standard-shelf-master-v001`

```text
Landscape 16:9 photorealistic vocational assessment still. Fixed environment: standard supermarket training shelf area inside a Chinese mainland school practice room. Eye-level 28 mm lens feel, neutral indoor fluorescent lighting softened for realism, one white or light-neutral three-layer retail shelf with clear price rails, several boxed goods, bottle drinks, and daily-use products arranged in a campus training supermarket corner. Product packaging should use low-text or text-free design with color blocks, icons, and simple shapes, similar in readability to `DRG-OBJ02-goods-facing-pack-v001`, to avoid garbled shelf text. Floor is clean light gray anti-slip tile, right side has a narrow aisle, left side has one small replenishment cart parked still. Keep shelf geometry, aisle width, lighting direction, and prop positions stable for future variants. One East Asian trainee stands near the middle shelf in a light gray training polo shirt, dark navy apron, black pants, non-slip shoes. The person must read as a Chinese mainland school vocational trainee. Calm instructional realism, no dramatic cinema, no baked text, no watermark.
```

### 8.2 `JDG-MS04-safety-risk-master-v001`

```text
Landscape 16:9 photorealistic vocational assessment still. Fixed environment: supermarket safety demonstration zone inside a Chinese mainland school practice room. Eye-level 28 mm lens feel, neutral indoor training light, one controlled practice corner containing a wet-floor patch, a visible wall socket area, a cleaning-supplies cabinet, a small step platform, and a safety tool table. The layout must feel like a standardized training environment, not a real accident scene. Keep camera angle, floor markings, object positions, and lighting stable for future correct and wrong variants. One East Asian trainee from the fixed character pool is present. The person must read as a Chinese mainland school vocational trainee. Calm instructional realism, no panic, no cinematic hazard effects, no text overlay, no watermark.
```

### 8.3 `DRG-BG01-shelf-alignment-board-v001`

```text
Landscape 16:9 photorealistic training interface background for a supermarket shelf drag-and-drop task. Front-facing composition, minimal perspective distortion, one clear retail shelf with three horizontal levels and six obvious product landing zones. The shelf should look realistic but visually clean, with subtle material contrast indicating drop areas. Neutral indoor light, soft shadows, no baked text, no arrows, no watermark, no extra clutter.
```

### 8.4 `DRG-OBJ01-geometry-sort-pack-v001`

```text
/* DRAG_OBJECT_PACK_CONFIG
   VERSION: 1.0.0
   AESTHETIC: Realistic training geometry props */
{
  "GLOBAL_SETTINGS": {
    "aspect_ratio": "1:1",
    "style": "photorealistic educational prop packshot",
    "background": "clean white seamless studio background",
    "lighting": "soft top-front studio light",
    "render_flags": ["sharp_edges", "consistent_scale", "no_text", "no_watermark"]
  },
  "CORE_ASSETS": {
    "pack_name": "geometry_sort_pack",
    "items": [
      "large matte plastic sphere",
      "medium matte plastic cube",
      "small matte plastic cylinder"
    ],
    "view": "front-facing slight three-quarter view",
    "material_goal": "simple educational training props with realistic volume and clear silhouette"
  },
  "OUTPUT": {
    "consistency": "all three shapes must feel like one matching training set",
    "avoid": ["toy-like cartoon styling", "busy reflections", "decorative composition"]
  }
}
```

### 8.5 `DRG-OBJ03-category-pack-v001`

```text
/* DRAG_OBJECT_PACK_CONFIG
   VERSION: 1.0.0
   AESTHETIC: Realistic training category props */
{
  "GLOBAL_SETTINGS": {
    "aspect_ratio": "1:1",
    "style": "photorealistic training prop packshot",
    "background": "clean white seamless studio background",
    "lighting": "soft top-front studio light",
    "render_flags": ["sharp_edges", "consistent_scale", "no_text", "no_watermark"]
  },
  "CORE_ASSETS": {
    "pack_name": "stationery_toy_tableware_pack",
    "items": [
      "pencil, eraser, ruler",
      "toy car, toy block, plush toy",
      "spoon, bowl, cup"
    ],
    "view": "front-facing slight three-quarter view",
    "material_goal": "real everyday objects used in vocational training classification tasks"
  },
  "OUTPUT": {
    "consistency": "all items must read clearly at small drag-card size",
    "avoid": ["decorative background", "brand logos", "overlapping objects"]
  }
}
```

---

## 9. 批量执行 JSON 结构建议

建议分为两份：

1. 规划版：保留题号、模块、复用关系、引用母版
2. 执行版：只保留脚本需要的字段，避免额外字段影响批量执行

### 9.1 规划版示例

```json
{
  "project": "SVETS-question-bank-image-plan",
  "defaults": {
    "model": "gpt-image-2",
    "size": "16:9",
    "resolution": "2k",
    "quality": "medium"
  },
  "jobs": [
    {
      "name": "JDG-MS02-facing-correct-v001",
      "asset_type": "judgement-variant",
      "module": "精细动作能力",
      "question_rows": [11, 17],
      "base_asset": "JDG-MS02-standard-shelf-master-v001",
      "mode": "edit",
      "prompt": "..."
    }
  ]
}
```

### 9.2 执行版示例

```json
{
  "defaults": {
    "model": "gpt-image-2",
    "size": "16:9",
    "resolution": "2k"
  },
  "jobs": [
    {
      "name": "JDG-MS02-standard-shelf-master-v001",
      "prompt": "..."
    },
    {
      "name": "JDG-MS02-facing-wrong-v001",
      "prompt": "Transform the provided assessment scene into the wrong-action variant while preserving the original camera angle, environment layout, shelf positions, table positions, lighting direction, costume, and character identity. Change only the action from placing goods neatly front-facing to placing goods tilted and misaligned. Keep the image readable as a paired vocational training comparison image. No extra people, no dramatic effects, no text overlay.",
      "image_paths": [
        "AIimages/JDG-MS02-standard-shelf-master-v001.png"
      ]
    },
    {
      "name": "DRG-OBJ06-price-tag-pack-v001",
      "prompt": "..."
    }
  ]
}
```

---

## 10. [!] 题库歧义与当前处理结论

### 已确认并按用户结论处理

- `ROW 34`：题干写「球体、立方体、柱体」，素材描述原写成「大 / 中 / 小正方体」。  
  当前结论：**按题干出，使用球体、立方体、柱体。**

- `ROW 36`：题干写「文具、玩具、餐具」，素材描述原写成「文具、玩具、食品」。  
  当前结论：**按题干出，使用文具、玩具、餐具。**

### 仍待后续确认

- `ROW 95`：认知理解能力拖拽题段落标题写「8 题」，但实际出现第 `9` 题；同时素材描述与计分文案明显沿用了别题文本。  
  当前结论：**不纳入首批出图。**

### 实现层注意事项

- 判断题原始设计说明为「统一观看小视频」。本规划当前输出的是 **图片母版 / 关键帧母版**，不是最终视频资产。
- 若后续扩成视频，优先沿用本规划中的母版资产做 edit / 镜头延展，避免推翻重来。
