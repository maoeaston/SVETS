# 视觉素材统一规划书 — 炫灿职途向导系统 MVP

> [!IMPORTANT]
> 本文件负责视觉风格、生产方法和验收原则；题号、当前版本和激活状态以 `doc/features/job-skill-shelver-current-contracts.md`、`doc/features/job-skill-shelver-runtime-authority-v1.json` 和 `doc/assets/asset-manifest.json` 为准。旧 Pilot 文档只作门禁追溯，不再作为 298 题素材生产入口。

**版本：** v1.3.0-298-runtime-authority
**日期：** 2026-07-22
**范围：** 全部 394 题（BASE_ABILITY 96 + JOB_SKILL 298）+ 系统通用 UI；机器合同为 270 项资产
**用途：** 视觉资产范围规划 + 风格方向 + 混合生产流水线规范  
**生成平台：** APIMart；图片主模型 `gpt-image-2`，视频模型 `doubao-seedance-2.0`
**目标设备：** Windows 触控一体机（1920×1080, 21-27寸）  
**生产方法：** AI 生成基础视觉 + 程序化合成 + 人工专业审核（三层架构）

> **v1.3.0-298-runtime-authority 修订说明：**
> - 视觉生产入口改为 298 题运行时 DRAFT 权威 + 270 项 `asset-manifest.json` v0.5.0
> - `question_ids` 保留来源题号，`current_question_ids` 绑定当前运行时题号
> - DELIVERY 33 项纳入同一 manifest，包含唯一答案图、逐字脚本和音频合同
> - 旧 Pilot strategy v3 文档降级为 Pilot 门禁追溯，不再作为全量素材生产入口
> - 资产批准只解除资产门禁，不激活 DRAFT 题目、不覆盖 Pilot 门禁、不写运行库
>
> **v1.2.4-video-sop 修订说明：**
> - 将 Seedance 生产输入收敛为 `SUBJECT / SCENE / AUDIO / SHOT` 四段合同
> - A 类判断题固定为单 Shot、单一可评分动作；G 类训练示范最多三个 Shot
> - 不向 Seedance 上传完整故事板，不写逐秒时间戳，不使用长篇情绪或镜头修辞
> - 增加视频场景锚图前置条件和 720p 候选抽选流程，内容通过后才允许有条件放大
> - 新增 `visual-asset-video-production-sop.md` 和逐资产 Prompt 编译新会话指南

> **v1.2.3-routing-fix 修订说明：**
> - 图片主模型改为性价比优先的 `gpt-image-2`；`gpt-image-2-official` 仅允许主模型不可用或人工明确指定时兜底
> - A 类与 G 类视频改用 `doubao-seedance-2.0`，统一走 `/v1/videos/generations`，不得使用 GPT 图片模型
> - 视频输出统一为 720p、16:9、默认静音；判断题 5 秒，线下操作示范 8 秒
> - 移除 `gpt-image-2` 接口未列为支持字段的 `quality` / `background` / `output_format` 请求参数
> - 当时 Manifest Schema 升级为 v0.3.1，增加 official 兜底条件与实际使用原因记录；当前机器合同见 v0.5.0

> **v1.2.2-consistency-fix 修订说明：**  
> - 删除"中文文字不由AI直接生成"一刀切禁止，改为三级文字处理规则（普通/识别关键/数据关键）
> - 异常商品难度等级 L1/L2/L3 重命名为 D1/D2/D3，避免与复杂度 L0–L3 冲突
> - 过期商品图（damaged_milk_expired_01、damaged_bread_expired_01）拆分训练版/测评版，测评版禁止泄露答案
> - `expected_answer` 明确以题库为唯一事实来源；Manifest 为同步副本
> - `gate_reviews.status` 增加 `revision_required`；非必需门状态改为 `waived`
> - 新增 `text_handling` 字段（none/ai_reviewed/programmatic/mixed）
> - 新增 §17.4 跨文件校验清单（P0 批量前必做）
> - Prompt 模板中"Do not render legible product names"改为按需处理
>
> **v1.2.1-hardening 修订说明：**  
> - 商品单品图由 36 张修正为实际 32 张，级联修正全部统计  
> - 删除 `production_class`，拆为 `production_method` + `review_level` 两独立维度  
> - `question_id` 改为 `question_ids` 数组（一素材可关联多题）  
> - 所有 Prompt 改为虚构包装 + 空白标签区 + 禁止可读文字/品牌/商标  
> - 新增 §4.6 视频音频规则  
> - VID_C04 重设为 composite 生产 + assessment_critical 审核  
> - 全部紫色替换为青绿/灰蓝系（执行"不使用紫色"规则）  
> - 复杂度规则修正：不再强制测评=L2，由测量构念决定  
> - 80×80 规则拆分为点击热区 vs 图标视觉主体  
> - Schema 硬化：增加 `lifecycle_status`、`gate_reviews`、`rights`、条件必填  
> - 文件名/引用 ID 全部小写统一；参考图增加 `asset_type: "reference"`  
> - 增加 API 参数完整字段（quality/background/output_format/n）  
>
> **v1.2 修订说明（全面落地审查意见）：**  
> - v1.1 修订说明中声称的修复均已在正文中实际落地  
> - §6.1 统一生成参数改为 APIMart official 路由格式；所有 `transparent` 标注统一加技术说明  
> - §12.1 "种子图策略"重写为"标准参考图资产包"，定义 R1–R6 参考图清单和生产流程  
> - §2.1 色彩表删除"绝对禁止"行，改为引用 §1.1 红色使用细则  
> - §4.5 新增视频生产分类（A/B/C 三类），标注每段视频的生产方式  
> - §5.5 新增多商品场景组件化合成说明  
> - 所有 Prompt 模板中"No red"系列改为差异化表述  
> - 模板 C/E/F 标题段数修正为实际内容数  
> - 新增 §十六（三层生产架构）、§十七（资产合同 Schema）、§十八（五道验收门）、§十九（MVP 外泛化规划）

---

## 一、设计红线（强制约束）

本产品面向**轻中度自闭症/智力障碍青少年**，所有视觉素材必须遵循：

| # | 约束 | 原因 |
|---|:---|:---|
| 1 | **避免装饰性/高饱和/闪烁红色；保留安全标志和真实商品中的必要红色** | 红色不得作为唯一信息通道，必须配合图形/文字/形状。安全色（禁止、停止、消防）在职业转衔中不可回避 |
| 2 | **色彩柔和低饱和** | 避免过度视觉刺激 |
| 3 | **复杂度分级（L0–L3），而非一律简化** | 教学阶段简化，测评阶段需逐步逼近真实工作场景复杂度（见§1.2） |
| 4 | **人物表情自然、适度、符合场景** | 不使用戏剧化/恐怖化/漫画式夸张；但允许担心、疼痛、困惑、请求帮助等真实情境表情 |
| 5 | **风格高度统一** | 这些学生对不一致性非常敏感 |
| 6 | **可交互点击热区 ≥ 80×80px；图标视觉主体可小于 80px（须通过识别测试）；纯装饰图标不受此约束** | 触控操作精度有限 |
| 7 | **视频每个镜头只呈现一个可评分动作；时长由任务分析决定** | 多步骤任务拆成若干短镜头或允许暂停/回放/逐步播放 |
| 8 | **视频无快切、无闪烁、无突然音效** | 防止癫痫或惊吓反应 |
| 9 | **中文文字使用黑体/圆体** | 易读性优先于美感 |
| 10 | **文字按三级规则处理：普通文字可 AI 生成+目视检查；识别关键文字可 AI 生成+逐字审核；数据关键文字（日期/价格/数量/条形码/二维码）必须程序化生成** | 详见 §6.2.1 三级文字处理规则。日期/价格等直接影响答案的数据不可依赖 AI 随机生成 |

### 1.1 红色使用细则

| 允许 | 禁止 |
|:---|:---|
| 安全标志（禁止、停止、消防） | 大面积纯红装饰背景 |
| 真实商品包装自带红色（红富士苹果、草莓、可乐罐等） | 高饱和闪烁红色动画 |
| 问题商品区标识牌（Z-2） | 红色作为唯一错误/警告信息通道 |
| 安全出口/消防通道标识 | 纯红字体用于正文 |

所有使用红色的场景必须同时配合文字标注或图形符号，确保色觉异常学生同样可理解。

### 1.2 素材复杂度分级

| 等级 | 适用阶段 | 视觉特点 |
|:---|:---|:---|
| **L0** — 单物体识别 | 教学示范 | 箭头、放大、高亮、步骤编号、慢动作；一个主体 |
| **L1** — 简化工作场景 | 支持练习 | 保留少量边框或位置提示；2-3 个主体 |
| **L2** — 多物体低干扰 | 独立测评 | 不出现高亮/颜色暗示/箭头/答案线索；真实场景 |
| **L3** — 综合职业场景 | 泛化迁移 | 更换包装/人物/货架/光线/背景干扰；接近真实工作 |

**规则：** 复杂度等级由测量构念和目标学生支持需求决定，不由 `usage_mode` 单独决定。训练素材通常使用 L0–L1；测评素材允许 L0–L3（单物体识别测评可使用 L0，无需强行加入多主体）；泛化测评原则上使用 L3。所有等级均禁止答案提示线索。

### 1.3 训练 vs 测评素材区分

| 字段 | 训练素材 | 测评素材 |
|:---|:---|:---|
| `usage_mode` | `training` | `assessment` |
| 允许高亮/箭头 | 是 | **否** |
| 允许颜色暗示 | 是（如绿=正确位置） | **否** |
| 允许步骤编号 | 是 | **否** |
| 允许答案文字 | 是（示范用） | **否** |
| 复杂度等级 | L0–L1 | L0–L3（由构念决定） |

---

## 二、统一视觉风格定义

### 2.1 色彩体系

| 用途 | 色值 | 说明 |
|:---|:---|:---|
| 主色-正确/积极 | `#66BB6A` (柔绿) | 正确反馈、正向动作 |
| 主色-中性/信息 | `#64B5F6` (柔蓝) | 信息提示、步骤指引 |
| 主色-警告/注意 | `#FFA726` (柔橙) | 需注意、需修正 |
| 主色-专业/模块 | `#4DB6AC` (青绿) | 模块标识 |
| 背景-浅 | `#F5F5F5` (极浅灰) | 页面背景 |
| 背景-暖 | `#FFF8E1` (米色) | 卡片背景 |
| 货架木色 | `#D7CCC8` (暖灰棕) | 货架道具 |
| 文字-主 | `#424242` (深灰) | 正文文字 |
| 文字-辅 | `#9E9E9E` (中灰) | 辅助说明 |
| **红色使用** | 见 §1.1 红色使用细则 | 非装饰性、必须配合文字/图形 |

### 2.2 图片风格 — 写实风格

- **类型：** 真实物理世界风格（AI 生成的高质量照片级渲染）
- **参考：** 中国大陆中型综合超市的通用环境特征，不出现任何真实连锁品牌标志
- **商品：** 照片级真实商品，虚构中国大陆快消品包装，标签区域留白供程序叠加中文
- **场景：** 真实中国超市货架、库房、通道环境，自然光照或标准超市荧光灯
- **人物：** 真实比例的中国青年工作人员，穿绿色工作围裙/马甲，面部表情自然温和
- **拍摄角度：** 商品 45° 前侧视角（产品摄影标准），场景正面或微斜俯视
- **特殊约束：** 尽管是写实风格，仍需保持画面简洁干净——单一主体、背景不杂乱、光线柔和均匀，避免信息过载

### 2.3 图标/UI 元素风格

- **类型：** 扁平极简图标（与写实场景形成层次对比）
- **理由：** 图标在 64-120px 尺寸使用，写实风格在小尺寸不可辨认
- **色彩：** 单色填充，遵循 §2.1 色彩体系
- **形态：** 圆角、极简、3-5 个视觉元素以内

### 2.4 视频风格

- **类型：** AI 生成短视频（真实感 CG 动画或 Sora 级写实视频）
- **画面：** 中国超市实景风格，自然光照，真实货架和商品
- **角色：** 同一个"理货员"角色贯穿全部 68 段视频——中国青年，绿色工作马甲，动作沉稳
- **场景：** 固定超市货架场景，镜头正面固定或微幅平移，不晃动
- **帧率：** 24fps，无快切、无转场特效
- **音频：** 无语音、无 BGM、无音效（由系统 TTS 朗读题目）
- **文化适配：** 货架商品为虚构中国大陆快消品包装（无真实品牌），价签由程序叠加

---

## 三、素材总览

| 类别 | 数量 | 来源题库 | 生成方式 |
|:---|:---|:---|:---|
| A. 短视频（判断题配套） | 68 段 | JOB_SKILL TF | AI 视频生成 |
| B. 货架/场景插图 | ~20 张 | JOB_SKILL DRAG+SC | AI 图片生成 |
| C. 商品单品图 | 32 张 | JOB_SKILL + 系统通用 | AI 图片生成 |
| D. 临损/异常商品图 | 9 个异常母题 / 11 个交付件 | 系统通用（已有 spec） | AI 图片生成 + 程序叠加 |
| E. 交互界面素材（SOFTWARE_TASK） | ~50 组 | BASE_ABILITY | AI 图 + 前端组件 |
| F. 系统通用 UI 图标/头像/背景 | 40+ 张 | 系统 | AI 图片生成 |
| G. 线下实操示范图/视频 | ~10 组 | OFFLINE（108题参考） | AI 图/视频 |
| **合计** | **~230+ 素材** | | |

---

## 四、A 类：短视频素材（68 段）

### 4.1 概述

所有 68 道 TRUE_FALSE 判断题都有 `media_brief` 字段描述视频内容。学生观看视频后判断"做法对不对"。

### 4.2 场景模板（6 类复用场景）

通过模板化减少生成成本——同类场景共享环境、角色、道具，只变换关键动作。

#### 模板 A：货架摆放场景（27 段）

**固定元素：** 超市三层货架 + 绿色围裙理货员 + 各类商品  
**变量：** 理货员的具体操作动作（正确/错误）

| 视频ID | 题目ID | 动作描述 | 正/误 |
|:---|:---|:---|:---|
| VID_A01 | M1_TF_015 | 将商品正面朝外逐一摆正对齐 | 正确 |
| VID_A02 | M1_TF_016 | 把大桶洗衣液搬上货架最顶层 | 错误 |
| VID_A03 | M1_TF_017 | 发现价签歪了当场直接扶正抚平 | 正确 |
| VID_A04 | M1_TF_018 | 将零食区发现的一瓶饮料取出放回饮料区 | 正确 |
| VID_A05 | M1_TF_019 | 两种不同价格的商品共用一张价签 | 错误 |
| VID_A06 | M1_TF_020 | 整理货架时先摆商品最后才清理垃圾 | 错误 |
| VID_A07 | M1_TF_021 | 发现商品挡住价签直接挪开露出价签 | 正确 |
| VID_A08 | M1_TF_022 | 将新到商品直接堆在旧商品前面没有规整 | 错误 |
| VID_A09 | M1_TF_023 | 每天上班先快速检查一遍价签和摆放 | 正确 |
| VID_A10 | M1_TF_024 | 把破损价签撕掉后没有补新价签 | 错误 |
| VID_A11 | M1_TF_025 | 未查看排面图和价签，直接把小件糖果集中放到自己认为显眼的中层位置 | 错误 |
| VID_A12 | M1_TF_026 | 货架有空位保留原价签等待补货 | 正确 |
| VID_A13 | M2_TF_015 | 补货时日期早的摆前排日期晚的摆后排 | 正确 |
| VID_A14 | M2_TF_016 | 上新时新货直接压在旧货前面没有移出旧货 | 错误 |
| VID_A15 | M2_TF_019 | 玻璃瓶饮料逐瓶竖直放稳没有叠放 | 正确 |
| VID_A16 | M3_TF_028 | 只看到饼干封口完好，未检查污染、漏气和异常鼓胀便直接上架 | 错误 |
| VID_A17 | M3_TF_033 | 封口完好仅有褶皱直接判断可上架 | 正确 |
| VID_A18 | M3_TF_035 | 临期商品留在原货架旁边放临期提示牌 | 错误 |
| VID_A19 | M4_TF_013 | 日期早的商品放库存前方先进先出出库 | 正确 |
| VID_A20 | M4_TF_018 | 把几大桶水搬上货架最顶层 | 错误 |
| VID_A21 | M4_TF_021 | 同款商品按品类集中存放标签朝外 | 正确 |
| VID_A22 | M6_TF_015 | 薯片归零食区洗发水归洗护区 | 正确 |
| VID_A23 | M6_TF_016 | 把可乐放进了零食区货架 | 错误 |
| VID_A24 | M6_TF_018 | 两件外包装相似的商品随意互换位置 | 错误 |
| VID_A25 | M6_TF_023 | 巡检时找到错放商品拿出放回正确区域 | 正确 |
| VID_A26 | M6_TF_024 | 大号和小号同品牌商品混放同一位置 | 错误 |
| VID_A27 | M6_TF_025 | 所有商品标签朝外并对应价签摆放 | 正确 |

#### 模板 B：拆箱补货场景（6 段）

**固定元素：** 超市货架旁地面 + 纸箱 + 理货员 + 商品  
**变量：** 拆箱/检查/上架的具体操作

| 视频ID | 题目ID | 动作描述 | 正/误 |
|:---|:---|:---|:---|
| VID_B01 | M2_TF_013 | 拆箱后先逐件检查日期和完好度再补货 | 正确 |
| VID_B02 | M2_TF_014 | 把新到整箱货直接上架没有开箱检查 | 错误 |
| VID_B03 | M2_TF_017 | 拆箱发现轻微受潮变形仍然摆上货架 | 错误 |
| VID_B04 | M2_TF_018 | 发现褶皱封口完好直接抚平上架 | 正确 |
| VID_B05 | M2_TF_020 | 补完货把空纸箱留在通道上 | 错误 |
| VID_B06 | M2_TF_022 | 普通胶带封箱且没有易开结构时，徒手用力撕扯并让手指贴近纸箱边缘 | 错误 |

#### 模板 C：日期检查/临期处置场景（9 段）

**固定元素：** 货架 + 理货员 + 带日期标签的商品 + 临期专区标识  
**变量：** 检查后的处置决策

| 视频ID | 题目ID | 动作描述 | 正/误 |
|:---|:---|:---|:---|
| VID_C01 | M3_TF_025 | 酸奶保质期到当天立即移入临期专区 | 正确 |
| VID_C02 | M3_TF_026 | 破损商品单独放入问题商品区并登记上报 | 正确 |
| VID_C03 | M3_TF_027 | 临期商品直接从货架取下扔进垃圾桶 | 错误 |
| VID_C04 | M3_TF_029 | 工作人员按压薯片袋发现袋子发软松手后不能恢复饱满状态仍放上货架 | 错误 |
| VID_C05 | M3_TF_030 | 使用个人手机计算剩余天数，并据此直接处理商品 | 错误 |
| VID_C06 | M3_TF_031 | 已过期3天将其移入临期专区（应报损） | 错误 |
| VID_C07 | M3_TF_032 | 侧面凹陷但未漏气的可乐上架 | 错误 |
| VID_C08 | M3_TF_034 | 只计算出剩余9天，未填写临期记录便直接把商品移入临期专区 | 错误 |
| VID_C09 | M3_TF_036 | 胀袋奶粉检查发现没有漏气仍上架 | 错误 |

#### 模板 D：库房/收货/盘点场景（8 段）

**固定元素：** 仓库货架 + 纸箱 + 送货单 + 理货员  
**变量：** 收货/盘点/拣货的操作

| 视频ID | 题目ID | 动作描述 | 正/误 |
|:---|:---|:---|:---|
| VID_D01 | M2_TF_021 | 收货数量不符暂停收货找负责人 | 正确 |
| VID_D02 | M4_TF_014 | 靠墙通道两侧全用纸箱堵满 | 错误 |
| VID_D03 | M4_TF_015 | 收货逐件核对数量和完好度 | 正确 |
| VID_D04 | M4_TF_016 | 库存数量不符直接修改系统数据 | 错误 |
| VID_D05 | M4_TF_017 | 数量不对暂停收货等负责人确认再签收 | 正确 |
| VID_D06 | M4_TF_019 | 发现少1件后重新清点并在清单标注，但未上报或交接便继续作业 | 错误 |
| VID_D07 | M4_TF_020 | 盘点时凭记忆填写数量没有逐件清点 | 错误 |
| VID_D08 | M4_TF_022 | 按单拣货发现缺货先标注再继续拣 | 正确 |

#### 模板 E：安全/应急场景（9 段）

**固定元素：** 超市环境 + 理货员 + 安全隐患道具  
**变量：** 应急处置行为

| 视频ID | 题目ID | 动作描述 | 正/误 |
|:---|:---|:---|:---|
| VID_E01 | M5_TF_021 | 发现地面水渍放置警示牌并通知清洁 | 正确 |
| VID_E02 | M5_TF_022 | 发现仓库有人吸烟装作没看到 | 错误 |
| VID_E03 | M5_TF_023 | 顾客晕倒呼叫同事通知负责人 | 正确 |
| VID_E04 | M5_TF_025 | 遇激动顾客保持冷静请负责人来 | 正确 |
| VID_E05 | M5_TF_026 | 搬货腰部疼痛咬牙继续搬完 | 错误 |
| VID_E06 | M5_TF_027 | 打碎玻璃瓶先放警示牌再专用工具清理 | 正确 |
| VID_E07 | M5_TF_029 | 发现货架支架松动继续整理没有报告 | 错误 |
| VID_E08 | M5_TF_030 | 下班前发现梯子没收回主动收回 | 正确 |
| VID_E09 | M5_TF_032 | 发现货架破损尖角放警示牌并上报 | 正确 |

#### 模板 F：商品识别/分类场景（9 段）

**固定元素：** 货架 + 理货员 + 商品 + 扫码设备  
**变量：** 分类/识别/扫码操作

| 视频ID | 题目ID | 动作描述 | 正/误 |
|:---|:---|:---|:---|
| VID_F01 | M5_TF_024 | 收到召回通知把商品移到最里排慢慢处理 | 错误 |
| VID_F02 | M5_TF_028 | 顾客问产地看包装直接告诉顾客 | 正确 |
| VID_F03 | M5_TF_031 | 发现价签金额异常直接撕掉价签 | 错误 |
| VID_F04 | M6_TF_017 | 不确定归属翻看包装品类信息再归位 | 正确 |
| VID_F05 | M6_TF_019 | 用扫码设备扫描条形码确认品名后上架 | 正确 |
| VID_F06 | M6_TF_020 | 冷冻食品放在常温货架上 | 错误 |
| VID_F07 | M6_TF_021 | 翻看价签品类信息后放到正确区域 | 正确 |
| VID_F08 | M6_TF_022 | 仅凭包装颜色将两款不同商品归入同区域 | 错误 |
| VID_F09 | M6_TF_026 | 外籍商品通过扫码获得品名信息后归类 | 正确 |

### 4.3 视频生成 Prompt 模板

```text
[SUBJECT]
使用已批准的理货员、绿色工作马甲和相关商品参考图，保持人物一致。

[SCENE]
使用对应场景族的已批准锚图，保持货架结构、光照、机位和人物比例一致。

[AUDIO]
完全静音。无对白、音乐、环境音或反馈音。

[SHOT]
固定可读机位，一个连续镜头，只呈现一个可评分动作：{具体动作描述}。
必须可见：{target_cue}。无缩放、剪切、晃动或转场。
```

实际模板见 `doc/assets/prompt-templates/video-action.txt`。Prompt 不写题目正误，不泄露 `expected_answer`，不要求模型生成日期、价格、数量、条形码、二维码或系统文字。

### 4.4 视频命名规范

`vid_{template}_{seq:02d}_{question_id_lower}.mp4`

示例：`vid_a_01_m1_tf_015.mp4`（question_id 在文件名中一律小写）

### 4.6 视频音频规则

1. 当前 A 类判断题和 G 类训练示范统一设置 `generate_audio=false`。
2. 无人物对白、背景音乐、环境音、成功音、失败音、警报声或答案提示音。
3. 题干和操作说明由系统 TTS 独立朗读，不写入视频 Prompt。
4. 职业线索必须在画面中独立成立，不得依赖声音完成判断。
5. VID_C04 通过近景展示袋体按压后明显塌陷、松手后不能恢复饱满状态，不生成漏气声音。
6. 未来如新增功能性音效，必须先另行修订 Manifest 音频合同和无障碍验收规则，不能在单个 Prompt 中临时开启。

### 4.7 Seedance 生产规则

1. A 类视频使用一个连续 Shot，只呈现一个可评分动作；G 类视频最多三个 Shot，每个 Shot 一个动作。
2. 主体与场景信息由已批准参考图提供，Prompt 只补充本资产的可观察动作和必要约束。
3. 不上传完整故事板，不写镜头运动曲线、Highlight 表格或逐秒时间戳。
4. 抽选阶段固定 720p。每类先做代表资产试跑，模板冻结后再批量生成。
5. 标准资产先生成两个候选，必要时再生成第三个；测评关键和安全关键资产生成三个候选。
6. 只有通过内容审核的候选才能进入放大处理。MVP 仅在目标设备实测不清楚时放大到 1080p，不要求 4K。

完整执行步骤、示例和验收清单见 `doc/features/visual-asset-video-production-sop.md`。

### 4.5 视频生产分类（Production Method + Review Level）

根据内容特征，68 段视频按两个独立维度分类：

**`production_method`（生产方式）：**

| 值 | 含义 | 生产方式 | 适用条件 |
|:---|:---|:---|:---|
| `ai_direct` | 可直接生成 | AI 视频生成 | 动作结果明显、无文字/数字依赖 |
| `ai_plus_overlay` | AI 底片 + 程序叠加 | AI 生成动作视频 + 前端/视频脚本叠加信息面板 | 关键证据依赖日期/数字/价格/系统界面 |
| `composite` | 合成生产 | AI 场景底片 + 受控动画/后期合成关键证据 | 关键判断依据非纯视觉直观（如触觉推断） |
| `programmatic` | 程序生成 | 无 AI 底片，完全由代码/脚本生成 | 纯数据展示（条形码、系统界面截图等） |

**`review_level`（审核级别）：**

| 值 | 含义 | 审核要求 |
|:---|:---|:---|
| `standard` | 标准审核 | 通过技术 + 视觉 + 特教门即可 |
| `assessment_critical` | 测评关键 | 必须额外通过测评验收门（门 5），确认无答案线索 |
| `safety_critical` | 安全关键 | 必须通过全部五道门 + 逐帧安全审核 |

**各视频 ID 归类：**

| production_method | review_level | 视频 ID |
|:---|:---|:---|
| `ai_direct` | `standard` | VID_A01–A04, A06–A09, A11–A12, A14–A16, A20–A27, VID_B01–B06, VID_F06, F08 |
| `ai_direct` | `assessment_critical` | VID_A17（封口完好仅有褶皱） |
| `ai_plus_overlay` | `standard` | VID_F04（品类信息）, VID_F07（价签品类） |
| `ai_plus_overlay` | `assessment_critical` | VID_A05（价签）, A10（价签）, A13（日期排序）, A18（临期提示牌）, A19（日期判断）, VID_C01–C03, C05–C09（日期/保质期）, VID_D01–D08（送货单/数量/系统）, VID_F01（召回通知）, F02（产地文字）, F03（价签金额）, F05（扫码界面）, F09（扫码界面） |
| `composite` | `assessment_critical` | VID_C04（薯片漏气——需合成按压塌陷动画） |
| `ai_direct` | `safety_critical` | VID_E01–E09（全部涉及安全/应急/人身伤害场景） |

**`ai_plus_overlay` 叠加要求：**
- 模拟工作日（2026-09-10）由程序统一注入
- 日期、保质期剩余天数、价格金额由 SVG/Canvas 叠加层渲染
- 送货单、库存系统界面由前端组件截图合成
- 条形码由程序生成标准 EAN-13 图案

**`composite` 合成要求（VID_C04）：**
- AI 生成场景/人物底片（工作人员拿起薯片袋的基础动作）
- 薯片袋按压变形与不回弹状态通过受控动画或后期合成实现
- 分镜：①拿起外观无明显破口的薯片袋 → ②近景按压袋体，袋体明显发软并塌陷 → ③松手后袋体不恢复饱满 → ④仍将商品放上货架
- 测评素材中禁止出现红叉、绿勾、箭头、颜色高亮、"漏气""错误"等答案提示
- 题干改为："工作人员按压薯片袋，发现袋子发软、松手后不能恢复饱满状态，但仍然把它放上货架。这种做法对不对？"
- 注：该视频题测量学生依据可见包装状态进行品质判断的能力，不完全替代真实触觉检查能力

**`safety_critical` 审核清单：**
- [ ] 危险点是否视觉清晰可判断
- [ ] 错误行为是否可能被误认为正确
- [ ] 人物动作本身是否安全（不造成二次伤害示范）
- [ ] 是否出现多余危险行为（画面中 AI 随机添加）
- [ ] 正误判断是否存在歧义
- [ ] 审核人签字：特教专业 _____ / 安全专业 _____

---

## 五、B 类：货架/场景插图（~20 张）

### 5.1 用途

DRAG 和 SINGLE_CHOICE 题目的配图，学生看图后做出判断或拖拽分类。

### 5.2 场景插图清单

| 素材ID | 关联题目 | 内容描述 | size | background |
|:---|:---|:---|:---|:---|
| scene_shelf_correct_01 | M1_DG_031 item1 | 货架整齐无杂物价签对应 | 1536x1024 | opaque |
| scene_shelf_wrong_tilt | M1_DG_031 item2 | 货架商品歪斜 | 1536x1024 | opaque |
| scene_shelf_wrong_sign | M1_DG_031 item3 | 价签被商品遮挡 | 1536x1024 | opaque |
| scene_shelf_wrong_box | M1_DG_031 item4 | 通道有空纸箱 | 1536x1024 | opaque |
| scene_shelf_mixed_zones | M1_SC_014 | 含5件商品的货架（1件错放） | 1536x1024 | opaque |
| scene_shelf_layers | M2_DG_025 | 三层货架标注上/中/下层 | 1536x1024 | opaque |
| scene_shelf_m6_wrong | M6_DG_031 | 含4件商品的货架（部分位置错误） | 1536x1024 | opaque |
| scene_shelf_m6_single | M6_SC_011 | 含1件错放商品的货架 | 1536x1024 | opaque |
| scene_shelf_ref_neat | 通用-示例图 | 完美整齐的示范货架 | 1536x1024 | opaque |
| scene_shelf_ref_messy | 通用-示例图 | 凌乱需整理的货架 | 1536x1024 | opaque |
| scene_warehouse | M4_OP_034 | 库房货架场景 | 1536x1024 | opaque |
| scene_barcode_label | M6_SC_006 | 清晰可读的条形码标签特写 | 1024x1024 | transparent |
| scene_chips_vs_shrimp | M6_SC_007 | 薯片和虾片外包装对比图 | 1536x1024 | opaque |
| scene_tea_compare | M6_SC_008 | 两瓶茶饮料对比图（日期标签清晰） | 1536x1024 | opaque |

### 5.3 生产方式

**单主体场景**（scene_shelf_correct_01、scene_warehouse 等）使用纯 AI 生成：

```json
{
  "model": "gpt-image-2",
  "size": "3:2",
  "resolution": "2k",
  "n": 1
}
```

**多商品精确位置场景**（scene_shelf_mixed_zones、scene_shelf_m6_wrong 等涉及"N 件商品中 1 件错放""商品与价签一一对应"的测评题配图）使用**组件化合成**：

```text
AI 生成空货架背景（opaque）
+
已审核的透明商品母版（C 类单品图）
+
程序确定坐标、层级和遮挡关系
+
SVG 叠加价签、日期、区域边框
=
最终题目场景
```

> **原因：** 文生图模型在多对象精确空间关系方面不可靠（数量、左右、遮挡、对应关系可能出错）。对于测评题，这不是美术瑕疵而是测量效度问题——错误的布局会改变正确答案。

### 5.4 Prompt 风格前缀

```
[STYLE: Photorealistic front-facing view of a Chinese supermarket shelf section.
Modern metal/wood shelving typical of generic Chinese mid-size supermarkets (no real chain logos).
Standard supermarket fluorescent lighting, clean and well-maintained.
Products on shelf are generic fictional Chinese FMCG packaging with no recognizable trademarks.
Render short Simplified Chinese product names exactly as specified in the prompt — must be clear, correctly spelled, no extra words or random characters.
Do not generate dates, prices, quantities, barcodes, QR codes, or store signage — these are added via programmatic overlay.
Photo-quality rendering. Prefer blue/green price labels; safety signage red acceptable per §1.1.
Educational clarity — lighting even, no dark shadows, all elements clearly visible.]
```

---

## 六、C 类：商品单品图（32 张）

### 6.1 统一参数

```json
{
  "model": "gpt-image-2",
  "size": "1:1",
  "resolution": "2k",
  "n": 1
}
```

> **技术说明：** GPT-Image-2 主接口未提供 `background=transparent` 参数。所有需要透明底的素材采用以下流程：
> 1. 生成时使用纯浅灰底 `#F0F0F0`（Prompt 中指定 "on uniform light gray #F0F0F0 background"）
> 2. 后处理执行主体分割 + Alpha 通道生成
> 3. 人工抽查边缘质量（发丝、瓶身、塑料袋、透明孔洞）
> 4. 最终导出透明 PNG/WebP
>
> 后续各节标注 `transparent` 的地方，均指**最终交付格式**为透明 PNG，而非 API 请求参数。

应用目标尺寸：512×512px（正常展示）/ 200×200px（拖拽项缩略图）

### 6.2 Prompt 统一前缀

```
[STYLE: Professional product photography on uniform light gray #F0F0F0 background.
Generic fictional Chinese consumer product packaging — no real brand names or trademarks.
Studio lighting from upper-left. Clean crisp edges, high detail, true-to-life colors and textures.
Render the specified Simplified Chinese product name clearly and correctly on the main label area.
Do not generate dates, prices, quantities, barcodes, or QR codes — reserve clean areas for programmatic overlays.
45-degree front-side view angle. Single product centered, no props, no shadows on background.
Background will be removed — ensure clean edges for cutout.]
```

### 6.3 水果类（6 张）

| 素材ID | 商品 | Prompt 要点 |
|:---|:---|:---|
| fruit_apple_01 | 红富士苹果 | 一个红富士苹果，自然红绿渐变色，顶部带绿叶 |
| fruit_banana_01 | 香蕉 | 一串3根香蕉，自然黄色带轻微棕色斑点 |
| fruit_orange_01 | 脐橙 | 一个新鲜脐橙，可见果皮纹理，顶部小绿梗 |
| fruit_grape_01 | 紫葡萄 | 一串紫葡萄带绿色枝梗，颗粒饱满 |
| fruit_watermelon_01 | 西瓜 | 一个完整西瓜，深绿条纹外皮 |
| fruit_strawberry_01 | 草莓 | 一颗草莓，顶部绿色花萼，可见表面种子纹理 |

### 6.4 饮品类（7 张）

| 素材ID | 商品 | Prompt 要点 |
|:---|:---|:---|
| drink_milk_01 | 纯牛奶 | 中国常见的白色纸盒利乐包装牛奶，蓝白配色，中文"纯牛奶"字样 |
| drink_cola_01 | 可乐 | 深棕色/黑色易拉罐（非亮红），银色拉环可见 |
| drink_orange_juice_01 | 橙汁 | 透明塑料瓶装橙汁，橙色瓶盖，标签有橙子图案 |
| drink_water_01 | 矿泉水 | 透明塑料瓶装水，蓝色瓶盖，简洁蓝白标签 |
| drink_yogurt_01 | 酸奶杯 | 白色塑料杯酸奶，银色铝箔封口，水果图案标签 |
| drink_soy_milk_01 | 豆奶 | 黄色/米色纸盒装豆奶，标签有大豆图案，中文"豆奶" |
| drink_soy_sauce_01 | 酱油 | 深色玻璃瓶装酱油，红棕色瓶盖，中文"酱油"标签 |

### 6.5 零食类（5 张）

| 素材ID | 商品 | Prompt 要点 |
|:---|:---|:---|
| snack_chips_01 | 薯片 | 金黄色充气袋装薯片，中文品名 |
| snack_cookie_01 | 饼干 | 棕色/米色方形纸盒装饼干，饼干图案 |
| snack_chocolate_01 | 巧克力 | 长条巧克力金色锡纸包装 |
| snack_candy_01 | 糖果 | 透明袋装混合彩色糖果 |
| snack_nuts_01 | 坚果 | 透明罐装混合坚果 |

### 6.6 日用品类（5 张）

| 素材ID | 商品 | Prompt 要点 |
|:---|:---|:---|
| daily_toothpaste_01 | 牙膏 | 白色牙膏管，绿色/蓝色条纹设计，绿色盖 |
| daily_shampoo_01 | 洗发水 | 蓝色/青色泵头瓶装洗发水，中文标签 |
| daily_tissue_01 | 纸巾 | 白色软包抽纸，浅蓝花纹包装，一张抽出 |
| daily_soap_01 | 香皂 | 纸盒包装香皂，绿白配色叶子图案 |
| daily_laundry_01 | 洗衣液 | 大瓶蓝色洗衣液，白色泵头/瓶盖 |

### 6.7 相似品对照组（5 张）— 近邻商品识别用

| 素材ID | 商品 | Prompt 要点 | 与何品对比 |
|:---|:---|:---|:---|
| drink_whole_milk_01 | 全脂牛奶 | 白色利乐盒，顶部**蓝色**色带，中文"全脂牛奶" | vs 脱脂 |
| drink_skim_milk_01 | 脱脂牛奶 | 白色利乐盒，顶部**绿色**色带，中文"脱脂牛奶" | vs 全脂 |
| drink_soy_milk_02 | 豆奶（同尺寸盒） | 同利乐盒型但黄色系包装，中文"豆奶" | vs 牛奶盒 |
| drink_oj_pure_01 | 鲜橙汁 | 透明瓶，橙色液体无气泡，"鲜橙汁"标签 | vs 橙味汽水 |
| drink_orange_soda_01 | 橙味汽水 | 透明瓶，橙色液体有**可见气泡**，"橙味汽水" | vs 鲜橙汁 |

### 6.8 新增商品（补充题目缺口，4 张）

| 素材ID | 商品 | 关联题目 | Prompt 要点 |
|:---|:---|:---|:---|
| daily_dishwash_01 | 洗洁精 | M1_SC_014 | 绿色瓶装洗洁精，泵头或翻盖 |
| product_frozen_dumpling | 速冻水饺 | M6_TF_020 | 塑料袋装速冻水饺，可见饺子形状，中文标签 |
| snack_shrimp_chips_01 | 虾片 | M6_SC_007 | 充气袋装虾片，与薯片外包装形似但品名不同 |
| drink_tea_green_01 | 绿茶饮料 | M6_SC_008 | 绿色标签瓶装茶饮 |

### 6.9 总计：32 张商品单品图

> 当前题库已确认商品母版 32 张，后续随泛化题扩展增量维护。

---

## 七、D 类：临损/异常商品图（9 个异常母题 / 11 个交付件）

> 计数口径：牛奶过期、面包过期各拆为训练版和测评版，因此异常概念仍为 9 个，Manifest 中必须登记 11 个独立交付件。

### 7.1 统一参数

与 C 类一致（见 §6.1 技术说明）：最终交付透明 PNG，生成时使用浅灰底 + 后处理抠图

### 7.2 三个难度等级

> **命名说明：** 异常难度使用 D1/D2/D3（Damage difficulty），避免与素材复杂度 L0–L3（Level）冲突。

#### D1 — 明显异常（一眼可见，面积 >30%）

| 素材ID | 商品 | 损伤描述 |
|:---|:---|:---|
| damaged_milk_leak_01 | 牛奶盒 | 底部角破损，白色牛奶液体明显渗出并积在下方 |
| damaged_box_crushed_01 | 饼干盒 | 纸盒严重压瘪变形，一整侧凹陷，失去方形外观 |
| damaged_bag_torn_01 | 薯片袋 | 正面有大面积撕裂口，2-3片薯片从裂口掉出 |

#### D2 — 中等异常（需稍加注意，面积 15-20%）

| 素材ID | 商品 | 损伤描述 | 使用模式 |
|:---|:---|:---|:---|
| damaged_milk_expired_01_train | 牛奶盒 | 侧面日期标签显示已过保质期日期；训练版：作答后叠加"已过期"讲解层 | training |
| damaged_milk_expired_01_assess | 牛奶盒 | 侧面日期标签仅显示生产日期与到期日期（程序化叠加），无任何答案提示 | assessment |
| damaged_bread_expired_01_train | 面包袋 | 透明袋装切片面包，日期标签显示旧日期；训练版：作答后叠加橙色"已过期"讲解层 | training |
| damaged_bread_expired_01_assess | 面包袋 | 透明袋装切片面包，日期标签仅显示生产日期与到期日期（程序化叠加），无任何答案提示 | assessment |
| damaged_bread_mold_01 | 面包袋 | 透明袋装面包，2-3片面包表面有绿蓝色霉斑（15-20%面积） | both |

> **过期商品拆分规则：** 正式测评版（assessment）只呈现客观日期信息，禁止出现"已过期"文字、日历打叉、红叉、绿勾、箭头或任何指向答案的视觉提示。学生必须依据日期与门店规则自行判断。训练版可在作答完成后叠加讲解层。两个版本基于同一商品母版生成，保持包装外观一致。

#### D3 — 细微异常（需仔细观察，面积 5-8%）

| 素材ID | 商品 | 损伤描述 |
|:---|:---|:---|
| damaged_can_dent_01 | 可乐罐 | 深色易拉罐，中部偏右有一处极浅凹陷，需仔细看才注意到 |
| damaged_label_off_01 | 洗发水瓶 | 蓝色洗发水瓶，前标签右下角翘起/卷曲，约10%标签脱离 |
| damaged_discolor_01 | 苹果 | 表面一小块区域有轻微棕色变色（初期碰伤），与自然色过渡模糊 |

### 7.3 Prompt 注意事项

- D1 的损伤必须**第一眼就注意到**，占画面比例大
- D3 的损伤必须**仔细看才能发现**，模拟真实品质检查难度
- 所有异常商品的**基础外观**必须与 C 类对应正常品一致（同色系、同角度、同光照）
- 不使用红色警告标记——用橙色或蓝色标注

---

## 八、E 类：BASE_ABILITY SOFTWARE_TASK 交互界面素材（50 组）

### 8.1 概述

50 道 SOFTWARE_TASK 题目需要软件界面中的交互元素。分两类：

- **需定制图形素材（16 题）**：涉及货架背景、路径动画、包装图、虚拟场景等
- **仅需标准 UI 控件（34 题）**：按钮、选项卡、消息卡、确认框等

### 8.2 需定制图形素材的 16 题

| 题目ID | 模块 | 任务简述 | 需要的素材类型 |
|:---|:---|:---|:---|
| GA-FM-010 | 精细动作 | 一只手按住固定区另一只手拖图形 | 固定区 + 目标区背景图 |
| GA-FM-011 | 精细动作 | 商品图拖到货架正面对齐 | 货架正面插槽背景 + 6个商品图 |
| GA-FM-013 | 精细动作 | 沿易撕条路径持续滑动 | 包装盒 + 易撕条路径线 + 封条图标 |
| GA-FM-014 | 精细动作 | 沿路径拖拽到终点 | 路径背景图（类 FM-013 变体） |
| GA-FM-015 | 精细动作 | 多点触控或复合控件 | 待定（需原始 xlsx 确认） |
| GA-COG-013 | 认知理解 | 复杂认知交互 | 待定场景插图 |
| GA-RULE-013 | 规则执行 | 在标记工作区内3分钟分类 | 工作区域背景 + 边界标记 |
| GA-RULE-016 | 规则执行 | 三步流程执行交互 | 流程步骤背景图 |
| GA-EMO-001 | 情绪调节 | 状态卡选择（含多选+强度） | 情绪状态卡片图标组（6-8张） |
| GA-EMO-003 | 情绪调节 | 错误恢复（可撤销/重做） | 任务结果展示图 + 撤销动画 |
| GA-EMO-004 | 情绪调节 | 等待调节（视觉计时器） | 倒计时环/进度条动画 |
| GA-EMO-005 | 情绪调节 | 预告转换（切换提示） | 切换过渡动画/提示图 |
| GA-EMO-010 | 情绪调节 | 情绪相关交互 | 待定 |
| GA-SOC-001 | 基础社交 | 回应呼唤（确认按钮/AAC） | AAC 符号图标组 |
| GA-SOC-009 | 基础社交 | 社交场景交互 | 虚拟同伴角色图 |
| GA-SAFE-014 | 安全操作 | 安全场景交互 | 安全隐患场景图 |

### 8.3 标准 UI 控件覆盖的 34 题

这些题目使用前端组件库即可实现，不需要定制图形：

| 控件类型 | 覆盖题数 | 说明 |
|:---|:---|:---|
| 大按钮组（2-4 选项） | 12 | 单选/判断类交互 |
| 拖拽目标区 + 拖拽项 | 8 | 文本拖拽排序/分类 |
| 消息卡/AAC 组合面板 | 6 | 社交沟通类题目 |
| 确认/求助浮动按钮 | 4 | 情绪调节/求助类 |
| 倒计时/进度条 | 2 | 等待/计时类 |
| 反馈展示卡 | 2 | 查看示例/接受反馈 |

### 8.4 情绪状态卡片图标（专用素材组）

GA-EMO-001/003/005 等题需要情绪/状态选择卡片：

| 素材ID | 状态 | 描述 |
|:---|:---|:---|
| state_calm | 平静 | 圆脸微笑，柔蓝底 |
| state_happy | 开心 | 圆脸灿笑，柔黄底 |
| state_tired | 疲惫 | 圆脸半闭眼，柔灰底 |
| state_worried | 担心 | 圆脸微皱眉，柔灰蓝底 `#90A4AE` |
| state_confused | 困惑 | 圆脸歪头问号，柔橙底 |
| state_proud | 自豪 | 圆脸挺胸，柔绿底 |

**最终交付格式：SVG**（AI 生成仅用于风格参考，最终由设计/开发实现为 SVG 组件）  
应用目标尺寸：120×120px

### 8.5 AAC 符号图标组（社交题专用）

GA-SOC-001~007 需要简化版 AAC（辅助替代沟通）符号：

| 素材ID | 含义 | 描述 |
|:---|:---|:---|
| aac_yes | 是/好的 | 绿色圆形 + 白色勾 |
| aac_no | 不/拒绝 | 橙色圆形 + 白色叉 |
| aac_help | 需要帮助 | 蓝色圆形 + 举手图标 |
| aac_wait | 请等一下 | 青蓝圆形 `#4DA3B6` + 手掌图标 |
| aac_again | 请再说一次 | 蓝色圆形 + 循环箭头 |
| aac_done | 我完成了 | 绿色圆形 + 旗帜图标 |
| aac_sorry | 抱歉 | 柔粉圆形 + 鞠躬图标 |
| aac_thankyou | 谢谢 | 黄色圆形 + 合掌图标 |

**最终交付格式：SVG**（使用经过许可的成熟符号体系，或由特教/AAC 专业人员审核的固定 SVG。AI 可生成风格参考，不直接作为最终交付。）  
应用目标尺寸：96×96px

---

## 九、F 类：系统通用 UI 素材（52 项）

> **交付格式分流：** 动物头像、人物、场景背景使用 AI 生成（写实/扁平位图）；系统图标、模块图标、区域图标、操作图标最终交付 SVG/CSS，AI 仅用于风格参考生成。

### 9.1 动物头像（10 张）

学生选择个人头像。统一参数：`1024x1024`, `high`, `transparent`, `png`，应用 200×200px。

| 素材ID | 动物 | 主色调 |
|:---|:---|:---|
| avatar_bear | 熊 | 暖棕 |
| avatar_rabbit | 兔子 | 柔粉白 |
| avatar_panda | 熊猫 | 黑白灰 |
| avatar_fox | 狐狸 | 柔琥珀橙（非红） |
| avatar_koala | 考拉 | 柔灰蓝 |
| avatar_lion | 狮子 | 暖金黄 |
| avatar_frog | 青蛙 | 柔绿 |
| avatar_cat | 猫 | 柔橘白 |
| avatar_dog | 狗 | 金驼色 |
| avatar_dolphin | 海豚 | 柔蓝米白 |

**Prompt 模板：**
```
A friendly {animal} character portrait, facing forward with a gentle smile.
Flat illustration style, rounded soft lines, {color} as main color.
Simple clean design, no complex details, centered composition.
Rounded friendly feel. Pastel warm tones only. Avoid red as main character color.
Single character on clean background.
```

### 9.2 表情/状态图标（3 项） — 最终交付 SVG

> AI 可生成风格参考图，最终交付为手工/Codex 制作的 SVG。

应用目标尺寸：160×160px。

| 素材ID | 状态 | 描述 |
|:---|:---|:---|
| emotion_happy | 开心 | 圆形，弯眼微笑，柔金黄，腮红 |
| emotion_neutral | 平静 | 圆形，平直嘴线，柔米色 |
| emotion_sad | 轻微低落 | 圆形，嘴角极轻微下弯（无泪），柔灰蓝 `#90A4AE` |

### 9.3 系统状态图标（8 项） — 最终交付 SVG

> AI 可生成风格参考图，最终交付为规范化 SVG（统一 viewBox、线宽、圆角）。

| 素材ID | 用途 | 应用尺寸 | 描述 |
|:---|:---|:---|:---|
| icon_sos_heart | 求助入口 | 80×80 | 柔粉心形，温暖安心感 |
| icon_star | 得分/进度 | 64×64 | 金黄五角星，轻微立体高光 |
| icon_medal_bronze | 铜牌成就 | 96×96 | 圆形铜色奖牌 + 青色短丝带 |
| icon_medal_silver | 银牌成就 | 96×96 | 圆形银色奖牌 + 蓝色短丝带 |
| icon_medal_gold | 金牌成就 | 96×96 | 圆形金色奖牌 + 深青短丝带 `#00897B` |
| icon_correct | 正确反馈 | 120×120 | 绿色圆底白色粗圆角勾 |
| icon_retry | 重试提示 | 120×120 | 柔橙圆底白色循环箭头 |
| icon_rest | 休息提示 | 240×240 | 简化人物伸懒腰 + 水杯，柔绿蓝色调 |

### 9.4 模块选择卡片图标（4 项） — 最终交付 SVG

> AI 可生成风格参考图，最终交付为规范化 SVG。

应用目标尺寸：120×120px。

| 素材ID | 模块 | 主色 | 图形 |
|:---|:---|:---|:---|
| module_shelf_stocking | 超市理货 | 柔绿 | 简化货架 + 购物车轮廓 |
| module_packaging | 包装分拣 | 柔蓝 | 简化纸箱 + 传送带 |
| module_annotation | 数据标注 | 青绿 `#4DB6AC` | 简化屏幕 + 标注框 |
| module_handicraft | 手工制作 | 暖橙 | 简化剪刀 + 折纸 |

### 9.5 分类区域图标（6 项） — 最终交付 SVG

> 纯单色剪影，最终交付为 SVG（CSS 变量控制填色）。

应用目标尺寸：96×96px。

| 素材ID | 区域 | 单色 | 图形 |
|:---|:---|:---|:---|
| zone_fruit | 水果区 | `#81C784` | 水果篮轮廓 |
| zone_drink | 饮品区 | `#64B5F6` | 杯子+吸管 |
| zone_snack | 零食区 | `#FFB74D` | 零食袋锯齿顶边 |
| zone_daily | 日用区 | `#80CBC4` | 泵头瓶轮廓 |
| zone_dairy | 乳品区 | `#D7CCC8` | 牛奶盒尖顶轮廓 |
| zone_damaged | 报损区 | `#FFAB91` | 回收三角循环箭头 |

### 9.6 货架场景背景（4 张）

> 这组使用**写实风格**，作为答题界面背景。

统一参数：`1536x1024`, `high`, `opaque`, `png`，应用裁切到 1200×600/800px。

| 素材ID | 内容 | Prompt 要点 |
|:---|:---|:---|
| shelf_empty_2row | 空两层货架 | 正面拍摄中国超市真实金属/木质两层空货架，无商品，灰白墙背景 |
| shelf_empty_3row | 空三层货架 | 同上但三层 |
| shelf_reference_neat | 整齐示范 | 两层货架上 4-5 件商品整齐排列，标签朝外、间距均匀 |
| shelf_reference_messy | 凌乱初态 | 同货架但商品歪斜、间距不一、标签朝向不统一 |

### 9.7 补货流程步骤图（5 张）

> 这组使用**写实风格**——真实中国超市工作人员演示动作。

统一参数：`1024x1024`, `high`, `transparent`, `png`，应用 480×480px。

| 素材ID | 步骤 | Prompt 要点 |
|:---|:---|:---|
| step_check_empty | 检查空位 | 穿绿色马甲的工作人员指向货架空位，蓝色圆圈高亮空位 |
| step_get_from_cart | 取货 | 工作人员从手推车上取出纸箱/商品 |
| step_inspect_item | 检查商品 | 工作人员双手持商品在眼前查看，附近有放大镜图标 |
| step_place_item | 上架 | 工作人员将商品标签朝外放上货架 |
| step_align_items | 规整 | 工作人员双手推齐货架上一排商品 |

### 9.8 新增系统 UI 素材（12 项）

| 素材ID | 用途 | 最终交付格式 | 风格 | AI 生成？ |
|:---|:---|:---|:---|:---|
| icon_video_play | 视频播放覆盖 | SVG | 扁平 | 仅风格参考 |
| icon_timer_ring | 倒计时环 | SVG + CSS 动画 | 扁平 | 仅风格参考 |
| icon_drag_hint | 拖拽手势提示 | SVG | 扁平 | 仅风格参考 |
| icon_touch_hint | 触控手势提示 | SVG | 扁平 | 仅风格参考 |
| icon_swipe_hint | 滑动手势提示 | SVG | 扁平 | 仅风格参考 |
| bg_assessment_header | 测评顶部装饰 | PNG 1792x1024 | 写实渐变 | ✓ AI 生成 |
| bg_report_header | 报告顶部装饰 | PNG 1792x1024 | 写实渐变 | ✓ AI 生成 |
| character_worker | 理货员全身像 | PNG 1024x1024 | 写实 | ✓ AI 生成 |
| character_colleague | 虚拟同事 | PNG 1024x1024 | 写实 | ✓ AI 生成 |
| character_supervisor | 虚拟负责人 | PNG 1024x1024 | 写实 | ✓ AI 生成 |
| app_icon | 应用图标 | PNG 1024x1024 | 现代扁平 | ✓ AI 生成 |
| splash_screen | 启动画面 | PNG 1792x1024 | 写实渐变 | ✓ AI 生成 |

---

## 十、G 类：线下实操示范素材（~10 组）

### 10.1 概述

108 道 OFFLINE_OPERATION 题（JOB_SKILL 100 + BASE_ABILITY 8）在线下由教师施测，但学生需要：
- 示范图/视频：展示正确操作供理解
- 工具识别图：让学生认识将要使用的实物

### 10.2 示范素材（按场景包分组）

| 场景包 | 涉及题数 | 需要素材 |
|:---|:---|:---|
| A-货架整理 | ~20 | 示范：正确摆放、价签位置、分层规则 |
| B-日期检查 | ~15 | 示范：翻看日期、计算天数、临期分拣 |
| C-品质检查 | ~15 | 示范：检查完好度、分拣流程 |
| D-拆箱补货 | ~20 | 示范：拆箱、检查、先进先出、规整 |
| E-库房/收货 | ~15 | 示范：核对送货单、清点、盘点记录 |
| F-安全/社交 | ~15 | 示范：安全处置、求助沟通、上报流程 |

### 10.3 素材类型

| 类型 | 数量 | 用途 |
|:---|:---|:---|
| 示范短视频 | 6 组（每场景包1段） | 开始前播放的操作示范 |
| 工具识别卡 | 12 张 | 展示实物工具/商品外观 |
| 流程步骤条 | 6 张 | 2-4步操作流程的横向图解 |

---

## 十一、素材制作优先级与排期

### P0 — 核心路径必需（上线前必须完成）

| 类别 | 数量 | 交付方式 | 说明 |
|:---|:---|:---|:---|
| 商品单品图 | 32 | AI 生成 | 写实产品摄影风格 |
| 临损商品图 | 11 | AI 生成 + 程序叠加 | 9 个异常母题；两项拆训练/测评版 |
| 货架场景图 | 6 | AI 生成 | 写实中国超市场景 |
| 动物头像 | 10 | AI 生成 | 学生个人头像选择 |
| 系统状态图标 | 8 | SVG/CSS | 求助/星/奖牌/正确/重试/休息 |
| 模块选择图标 | 4 | SVG/CSS | 理货/包装/标注/手工 |
| 分区图标 | 6 | SVG/CSS | 水果/饮品/零食/日用/乳品/报损 |
| 表情/状态图标 | 3 | SVG/CSS | 开心/平静/低落 |
| 情绪状态卡 | 6 | SVG/CSS | BASE_ABILITY 情绪题核心 |
| AAC 图标 | 8 | SVG/CSS | BASE_ABILITY 社交题核心 |
| **P0 小计** | **94 项** | **59 AI/合成 + 35 SVG/CSS** | |

### P1 — MVP 验收需要

| 类别 | 数量 | 交付方式 | 说明 |
|:---|:---|:---|:---|
| 判断题视频 | 68 段 | AI 视频生成 | 所有 TRUE_FALSE 题配套 |
| 扩展场景图 | 12 | AI 生成/合成 | B 类 14 项中另 2 项已计入 P0 |
| SOFTWARE_TASK 定制图 | 16 组 | AI + 前端组合 | 拖拽路径/触控交互背景 |
| 操作提示图标 | 5 | SVG/CSS | 视频播放/计时/拖拽/触控/滑动 |
| 人物角色图 | 3 | AI 生成 | 理货员/同事/负责人 |
| 背景/装饰 | 4 | AI 生成 | 测评头/报告头/应用图标/启动画面 |
| **P1 小计** | **108 项** | **103 AI/合成 + 5 SVG/CSS** | |

### P2 — 完整体验增强

| 类别 | 数量 | 说明 |
|:---|:---|:---|
| 线下示范视频 | 6 组 | OFFLINE_OPERATION 施测辅助 |
| 工具识别卡 | 12 | 实物工具照片/插图 |
| 流程步骤条 | 6 | 横向步骤图解 |
| 补货流程步骤图 | 5 | 写实训练步骤图 |
| 临损商品图 | 9 个异常母题 / 11 个交付件 | 复用 P0 资产，新增量 0 |
| 相似品图 | 5 | 复用 P0 资产，新增量 0 |
| **P2 小计** | **29 项（新增生产）** | |

---

## 十二、风格一致性保障措施

### 12.1 标准参考图资产包（Reference Anchor Pack）

GPT-Image-2 没有可锁定画面结果的 `seed` 参数。跨批次一致性必须通过**图生图 / 编辑接口 + 参考图**实现，而非仅靠 Prompt 文本。

**资产包内容（生产前必须先完成并锁定）：**

| # | 参考图 | 用途 |
|---|:---|:---|
| R1 | 理货员角色设定图（正面 / 45° / 侧面 / 全身 / 半身） | 人物一致性锚点 |
| R2 | 绿色工作马甲标准图 | 服装一致性 |
| R3 | 货架主场景标准图（三层金属/木质） | 场景一致性 |
| R4 | 商品标准母版（每个品类 1 张已审核图） | 商品系列生成基础 |
| R5 | 光照 / 机位 / 色温 / 镜头距离参考图 | 技术一致性 |
| R6 | 图标风格总览板（9 宫格） | 图标线宽 / 圆角 / 光学尺寸统一 |

**生产流程：**

1. 先用 GPT-Image-2 生成 R1–R6 各 3–5 张候选，人工选定最终版
2. 后续每张系列图使用**图生图或编辑接口**，附带对应参考图（APIMart 官方通道支持最多 16 张参考图 + 遮罩编辑）
3. 每生成一批（10–15 张）后做一次**风格审计**——与参考图放在一起目视检查是否统一
4. 若漂移超过可接受阈值，回溯到参考图重新生成，不靠微调 Prompt 修补

### 12.2 Prompt 中的一致性锚点

所有 prompt 必须包含以下统一前缀（分类型）：

**商品图前缀（写实）：**
```
[STYLE: Professional product photography on uniform light gray #F0F0F0 background.
Generic fictional Chinese consumer product — no real brand names or trademarks.
Studio lighting from upper-left, true-to-life colors and textures.
Render short Simplified Chinese product name clearly if specified in prompt parameters.
Do not render dates, prices, quantities, barcodes, or QR codes — these are programmatic overlays.
Do not add random characters, unauthorized brand names, or extra text beyond what is specified.
45-degree front-side view. Single product centered, pure white background for cutout.
Avoid large decorative red areas; real product packaging colors (apple, strawberry, Coke) are acceptable.]
```

**场景图前缀（写实）：**
```
[STYLE: Photorealistic Chinese supermarket interior, generic mid-size chain (no real brand logos).
Metal/wood shelving, standard fluorescent lighting, clean and well-maintained.
Generic fictional Chinese FMCG packaging — no recognizable trademarks.
Area signage and short product names may appear if contextually appropriate.
Do not render dates, prices, quantities, barcodes, or QR codes — these are programmatic overlays.
Even lighting, no harsh shadows. Prefer blue/green price labels; safety signage red acceptable per §1.1.
Educational clarity.]
```

**图标前缀（扁平）：**
```
[STYLE: Minimal flat icon. Pure single-color silhouette.
Extremely simplified, 3-5 visual elements max.
Recognizable at 64px. No gradients, no shadows, no outlines.
Friendly and approachable. Avoid red for decorative icons; safety icons may use red per §1.1.]
```

**人物前缀（写实）：**
```
[STYLE: Photorealistic young Chinese worker in green work vest/apron.
Natural friendly expression, calm professional demeanor.
Medium skin tone, neat appearance. Chinese retail workplace context.
Warm even lighting, clean background for cutout. No red in clothing.]
```

**视频前缀（写实）：**
```
[STYLE: Photorealistic video, Chinese supermarket aisle, generic mid-size chain (no real brand logos).
Generic fictional products on shelving. Standard fluorescent lighting.
Fixed camera angle, no cuts, no effects. Natural color grading.
Chinese mainland retail environment. Silent — no audio.
Product names on packaging may appear if contextually appropriate.
Do not render dates, prices, quantities, barcodes, QR codes, or numeric data — these are programmatic overlays.]
```

### 12.3 色彩审计检查表

每张生成的图完成后执行：
- [ ] 无装饰性大面积红色；安全标志/商品自带红色需同时有文字或图形配合（§1.1）
- [ ] 主色调在 §2.1 色板范围内
- [ ] 背景色与系统背景兼容（浅灰 `#F0F0F0` / 白 / 抠图后透明）
- [ ] 人物服装色一致（绿围裙/马甲，参照 R2）
- [ ] 货架木色一致（参照 R3）
- [ ] 若为透明底需求：确认已经过后处理抠图，边缘无残留底色

---

## 十三、文件命名与目录规范

### 13.1 目录结构

```
assets/
├── products/        # C类 商品单品图
│   ├── fruit_apple_01.png
│   └── ...
├── scenes/          # B类 场景图
│   ├── scene_shelf_correct_01.png
│   └── ...
├── damaged/         # D类 临损商品
├── icons/           # F类 系统图标
│   ├── system/      # 状态/操作图标
│   ├── zones/       # 分区图标
│   ├── emotions/    # 情绪状态卡
│   └── aac/         # AAC符号
├── characters/      # 角色图
├── backgrounds/     # 背景/装饰
├── videos/          # A类 判断题视频
│   ├── vid_a_01_m1_tf_015.mp4
│   └── ...
├── sw_task/         # E类 SOFTWARE_TASK 定制素材
│   ├── ga_fm_011_shelf_slots.png
│   └── ...
└── offline_demo/    # G类 线下示范素材
```

### 13.2 命名规则

- 全小写，下划线分隔
- 规划书中的素材 ID 在 Manifest 中记录为 `plan_key`；运行时 `asset_id` 固定为 `asset_${plan_key}`，以兼容 `app://asset/<asset_id>` 协议
- 商品：`{category}_{name}_{variant:02d}.png`
- 场景：`scene_{description}.png`
- 视频：`vid_{template}_{seq:02d}_{question_id_lower}.mp4`
- 图标：`icon_{name}.png` / `aac_{name}.png` / `state_{name}.png`
- SW_TASK：`sw_{question_id_lower}_{element}.png`

---

## 十四、与其他文档的关系

| 文档 | 状态 | 说明 |
|:---|:---|:---|
| `offline-toolkit-procurement-spec.md` | 保留 | 线下实物工具包规格，与 G 类互补 |
| 本文档 `visual-asset-master-plan.md` | **自包含** | 全部视觉素材的唯一规划来源 |

---

## 十五、总量统计

| 素材类型 | 数量 | 生成方式 |
|:---|:---|:---|
| A-G 明确交付资产 | 231 项 | P0 94 + P1 108 + P2 29 |
| DELIVERY 交付锁资产 | 33 项 | 17 张答案图 + 13 份逐字脚本 + 3 个音频合同 |
| 核心参考资产 R1-R6 | 6 项 | 生产前先生成并冻结 |
| 写实静态图片（商品/场景/人物/步骤/背景） | 按 Manifest 分类统计 | AI 图片生成（写实风格） |
| 动物头像 | 10 张 | AI 图片生成（扁平插画风格） |
| SVG/CSS 图标及符号（系统/模块/分区/操作/情绪/AAC） | ~40 项 | 前端开发（AI 仅用于风格探索，不作为最终交付） |
| 交互界面定制素材 | ~16 组 | AI 图片 + 前端组合 |
| 短视频 | 68 + 6 = 74 段 | AI 视频生成 |
| 前端组件（无需图片） | 34 组 | 纯开发实现 |
| **Manifest 合同总计** | **270 项** | 231 个 A-G 资产 + 33 个 DELIVERY 资产 + 6 个参考资产 |

---

---

## 十六、三层生产架构

所有视觉素材的生产遵循**AI 生成 → 程序合成 → 人工审核**三层架构，禁止跳层交付。

### 16.1 架构总览

```
┌─────────────────────────────────────────────────────────┐
│ Layer 1: AI 生成层                                       │
│   输入: 参考图(R1-R6) + Prompt 模板 + 生成参数             │
│   输出: 原始 AI 图片/视频（含底色、无文字叠加）              │
│   工具: APIMart gpt-image-2 / doubao-seedance-2.0          │
└──────────────────────────┬──────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────┐
│ Layer 2: 程序合成层                                       │
│   - 主体分割 + Alpha 通道（抠图）                          │
│   - 中文文字 / 日期 / 价格 / 条形码 SVG/Canvas 叠加        │
│   - 多商品货架组件化合成（空货架 + 商品母版 + 程序定位）      │
│   - ai_plus_overlay 视频信息面板叠加                        │
│   工具: 脚本(Python/Node) + ImageMagick/Sharp + FFmpeg     │
└──────────────────────────┬──────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────┐
│ Layer 3: 人工审核层                                       │
│   - 技术审核（尺寸/格式/边缘质量）                         │
│   - 视觉审核（风格一致性 vs R1-R6）                        │
│   - 职业审核（动作/流程是否符合真实理货规范）                │
│   - 特教审核（认知负荷/感官刺激/符号可理解性）              │
│   - 测评审核（是否泄露答案线索/引入构念外难度）             │
│   责任人: 见 §十八验收门                                   │
└─────────────────────────────────────────────────────────┘
```

### 16.2 各资产类型的层级要求

| 资产类型 | Layer 1 | Layer 2 | Layer 3 |
|:---|:---|:---|:---|
| 超市/库房背景 | GPT-Image-2 生成 | — | 视觉审核 |
| 人物母版/角色设定 | GPT-Image-2 + 多参考图 | 抠图 | 视觉 + 特教审核 |
| 单品商品基础外观 | GPT-Image-2 | 抠图 | 视觉审核 |
| 同一商品破损变体 | 基于正常母版遮罩编辑 | 抠图 | 视觉 + 测评审核 |
| 商品日期/价格/产地 | — | SVG/Canvas 叠加 | 测评审核 |
| 条形码/二维码 | — | 程序生成 | 技术审核 |
| 多商品货架题（测评） | 空货架背景 | 商品组件合成 + 价签叠加 | 全部五道审核 |
| UI 图标 | GPT-Image-2（参考用）| SVG/CSS 最终实现 | 技术 + 特教审核 |
| AAC 图标 | — | 固定符号库 SVG | 特教专业审核 |
| 视频 `ai_direct`（纯动作演示） | AI 视频生成 | — | 职业 + 特教审核 |
| 视频 `ai_plus_overlay`（含程序叠加信息） | AI 视频底片 | FFmpeg 信息面板叠加 | 职业 + 测评审核 |
| 视频 `composite` / `safety_critical`（安全/情绪） | AI 视频 + 分镜合成 | 可能需叠加 | 全部五道 + 逐帧审核 |

### 16.3 APIMart 模型路由与参数锁定

图片统一调用 `POST /v1/images/generations`。主模型固定为 `gpt-image-2`；高价 `gpt-image-2-official` 不得作为默认模型，只能在主模型连接/服务不可用或人工明确指定时使用。内容审核失败、画面质量不满意和普通重试不属于自动切换 official 的理由。

```json
{
  "provider": "apimart",
  "model": "gpt-image-2",
  "route": "/v1/images/generations",
  "fallback_model": "gpt-image-2-official",
  "fallback_route": "/v1/images/generations",
  "fallback_allowed_when": ["primary_unavailable", "manual_override"],
  "fallback_used": false,
  "fallback_reason": null,
  "generation_params": {
    "size": "1:1 | 3:2 | 16:9",
    "resolution": "2k",
    "n": 1
  }
}
```

`gpt-image-2` 接口文档只列出 `model/prompt/n/size/resolution/image_urls` 等请求字段，未列出的 `quality/background/output_format` 不得写入生产请求；交付格式由后处理与 `delivery_format` 管理。

视频统一调用 `POST /v1/videos/generations`，使用 APIMart `doubao-seedance-2.0`：

```json
{
  "provider": "apimart",
  "model": "doubao-seedance-2.0",
  "route": "/v1/videos/generations",
  "fallback_model": null,
  "fallback_route": null,
  "fallback_allowed_when": [],
  "fallback_used": false,
  "fallback_reason": null,
  "generation_params": {
    "size": "16:9",
    "resolution": "720p",
    "duration": 5,
    "generate_audio": false
  }
}
```

A 类判断题 `duration=5`；G 类线下操作示范 `duration=8`。

接口依据：[GPT-Image-2 图像生成](https://docs.apimart.ai/cn/api-reference/images/gpt-image-2/generation)、[doubao-seedance-2.0 视频生成](https://docs.apimart.ai/cn/api-reference/videos/doubao-seedance-2-0/generation)。

---

## 十七、资产合同 Schema（asset-manifest.json）

Markdown 规划书保留为设计说明文档。**机器可执行的单一事实来源**是 `asset-manifest.json`，每项资产一条记录。

> **重要区分：** `doc/assets/` 是**生产合同目录**（设计规范、Prompt 模板、参考图、验收记录），不是运行时资产目录。当前统一运行时目录为 `resources/assets/`，通过 `app://asset/<asset_id>` 访问；生产文件与运行时文件通过 `source_path` / `runtime_path` 字段关联。

### 17.1 目录结构

```
doc/assets/                         # 生产合同目录（不进入运行时打包）
├── asset-manifest.json             # 机器可执行资产合同
├── asset-manifest.schema.json      # JSON Schema 验证规范
├── prompt-templates/               # Prompt 模板文件
│   ├── product-photo.txt
│   ├── scene-shelf.txt
│   ├── icon-flat.txt
│   ├── character.txt
│   ├── video-action.txt
│   ├── offline-video.txt
│   └── offline-demo.txt
├── reference-assets/               # 标准参考图资产包 (R1-R6)
│   ├── R1_character_sheet/
│   ├── R2_vest_standard.png
│   ├── R3_shelf_standard.png
│   ├── R4_product_masters/
│   ├── R5_lighting_camera_ref/
│   ├── R6_icon_style_board.png
│   └── video-scene-anchors/         # 视频生产场景锚图，不计入运行时交付数
└── qa-results/                     # 验收记录
    ├── batch_001_review.json
    └── ...
```

### 17.2 每项资产必须记录的字段

> 机器可执行合同见 `asset-manifest.schema.json` v0.5.0。下表为人类可读摘要。

| 字段 | 类型 | 必填 | 说明 |
|:---|:---|:---:|:---|
| `asset_id` | string | ✓ | 运行时唯一标识符，固定为 `asset_${plan_key}`，pattern: `^asset_[a-z0-9_]+$` |
| `plan_key` | string | ✓ | 本规划书表格中的素材 ID，与交付文件名主体一致 |
| `category` | enum | ✓ | `A`–`G`、`DELIVERY` 或 `REFERENCE` |
| `priority` | enum | ✓ | `P0` / `P1` / `P2` / `REFERENCE` |
| `question_ids` | string[] | — | 来源题号数组（`uniqueItems: true`）；系统通用素材使用空数组 |
| `current_question_ids` | string[] | — | 当前运行时题号数组；JOB_SKILL 由 298 题 DRAFT 权威自动映射，BASE_ABILITY 保持原题号 |
| `asset_type` | enum | ✓ | 图片、视频、SVG、SOFTWARE_TASK、工具卡、步骤条或参考资产类型 |
| `asset_role` | enum | ✓ | 对应 `asset_resource.asset_role` 的运行时角色 |
| `usage_mode` | enum | ✓ | `training` \| `assessment` \| `both` \| `system` \| `production` |
| `delivery_format` | enum | ✓ | `png` \| `webp` \| `svg` \| `css` \| `mp4` |
| `production_method` | enum | ✓ | `ai_direct` \| `ai_plus_overlay` \| `programmatic` \| `composite` |
| `review_level` | enum | ✓ | `standard` \| `assessment_critical` \| `safety_critical` |
| `lifecycle_status` | enum | ✓ | `planned` \| `generated` \| `composited` \| `reviewing` \| `approved` \| `retired` |
| `complexity_level` | enum\|null | — | `L0` \| `L1` \| `L2` \| `L3`（由测量构念决定，不与 usage_mode 绑定） |
| `construct` | string\|null | — | 测量构念 |
| `target_cue` | string\|null | — | 正确视觉目标 |
| `distractors` | string[] | — | 干扰项描述 |
| `reference_asset_ids` | string[] | — | 使用的参考图 ID（全小写格式，如 `ref_r4_fruit_master`） |
| `prompt_template_id` | string\|null | — | Prompt 模板文件名 |
| `prompt_version` | string\|null | — | Prompt 模板版本 |
| `prompt_text` | string\|null | — | 实际使用的完整 Prompt |
| `provider` | enum\|null | — | `apimart` \| `manual` \| `codegen` |
| `model` | string\|null | — | 主模型；图片固定 `gpt-image-2`，视频固定 `doubao-seedance-2.0` |
| `route` | string\|null | — | APIMart API 路径（图片或视频 generations） |
| `fallback_model` / `fallback_route` | string\|null | — | 图片 official 兜底模型与接口；视频必须为 null |
| `fallback_allowed_when` | string[] | — | 只允许 `primary_unavailable` / `manual_override` |
| `fallback_used` / `fallback_reason` | boolean / string\|null | — | 是否实际使用兜底及审计原因 |
| `generation_params` | object\|null | — | 图片：`size/resolution/n`；视频：`size/resolution/duration/generate_audio` |
| `generation_date` | string(date)\|null | — | 生成日期 |
| `source_path` | string\|null | — | 生产合同目录中的原始文件路径（`lifecycle_status ≥ generated` 时必填） |
| `runtime_path` | string\|null | — | 运行时打包后的文件路径（全小写） |
| `overlay_spec` | object\|null | — | Layer 2 叠加规格 |
| `expected_answer` | string\|boolean\|null | — | 正确答案同步副本（**题库为唯一事实来源**；Manifest 不允许独立维护第二套答案） |
| `text_handling` | enum\|null | — | `none` \| `ai_reviewed` \| `programmatic` \| `mixed`（文字生成与审核方式） |
| `policy_basis` | string\|null | — | 答案依据的门店规则 |
| `forbidden_visual_cues` | string[] | — | 禁止出现的答案线索 |
| `required_overlay` | string[] | — | 必须叠加的程序化内容 |
| `gate_reviews` | object | — | 五道验收门结构化记录（见下） |
| `ai_pre_review` | object\|null | — | AI 预审结果（model/date/result/notes，仅供参考） |
| `rights` | object | — | 版权与许可追踪（见下） |
| `qa_record_paths` | string[] | — | 相关 QA 记录文件路径 |
| `file_hash` | string\|null | — | SHA-256，`approved` 时必填，用于检测漂移 |

**`gate_reviews` 子结构（每道门）：**

| 字段 | 类型 | 说明 |
|:---|:---|:---|
| `required` | boolean | 该门是否为本资产必需验收 |
| `status` | enum | `pending` \| `passed` \| `rejected` \| `waived` \| `revision_required` |
| `reviewer_kind` | enum | `human` \| `script` \| `ai_advisory` |
| `reviewer_name` | string\|null | 审核人姓名或脚本标识 |
| `reviewed_at` | string(date)\|null | 审核日期 |
| `report_path` | string\|null | 审核报告路径 |
| `notes` | string\|null | 审核备注 |

**`rights` 子结构：**

| 字段 | 类型 | 说明 |
|:---|:---|:---|
| `source_type` | enum | `ai_generated` \| `original` \| `licensed_library` \| `public_domain` |
| `license` | string\|null | 许可证标识（如 CC-BY-4.0） |
| `attribution_required` | boolean | 是否需要署名 |
| `source_reference` | string\|null | 来源引用 |
| `commercial_use_cleared` | boolean | 商业使用是否已确认 |

**示例：**

```json
{
  "asset_id": "asset_fruit_apple_01",
  "plan_key": "fruit_apple_01",
  "category": "C",
  "priority": "P0",
  "description": "红富士苹果",
  "question_ids": ["M1_SC_014"],
  "asset_type": "product_photo",
  "asset_role": "QUESTION_MEDIA",
  "usage_mode": "both",
  "complexity_level": "L0",
  "production_method": "ai_direct",
  "review_level": "standard",
  "lifecycle_status": "planned",
  "delivery_format": "png",
  "construct": "商品外观识别",
  "target_cue": "红富士苹果正常外观",
  "distractors": [],
  "reference_asset_ids": ["asset_ref_r4_product_masters", "asset_ref_r5_lighting_camera"],
  "reference_pack": "core",
  "prompt_template_id": "product-photo",
  "prompt_version": "v1.2.2",
  "prompt_text": null,
  "provider": "apimart",
  "model": "gpt-image-2",
  "route": "/v1/images/generations",
  "fallback_model": "gpt-image-2-official",
  "fallback_route": "/v1/images/generations",
  "fallback_allowed_when": ["primary_unavailable", "manual_override"],
  "fallback_used": false,
  "fallback_reason": null,
  "generation_params": {
    "size": "1:1",
    "resolution": "2k",
    "n": 1
  },
  "generation_date": null,
  "source_path": null,
  "runtime_path": "resources/assets/products/fruit_apple_01.png",
  "overlay_spec": null,
  "expected_answer": null,
  "policy_basis": null,
  "forbidden_visual_cues": [],
  "required_overlay": [],
  "gate_reviews": {
    "technical":         { "required": true,  "status": "pending", "reviewer_kind": "script" },
    "visual":            { "required": true,  "status": "pending", "reviewer_kind": "human" },
    "vocational":        { "required": false, "status": "waived", "reviewer_kind": "human" },
    "special_education": { "required": false, "status": "waived", "reviewer_kind": "human" },
    "assessment":        { "required": false, "status": "waived", "reviewer_kind": "human" }
  },
  "ai_pre_review": null,
  "rights": {
    "source_type": "ai_generated",
    "license": null,
    "attribution_required": false,
    "source_reference": null,
    "commercial_use_cleared": false
  },
  "qa_record_paths": [],
  "file_hash": null
}
```

### 17.3 与题库的关联

双向引用：资产通过 `question_ids` 数组声明关联题目；题库通过 `question_bank.media_asset_id`、`content_json.variants[].media_asset_id`、`content_json.options[].image_asset_id` 或 `content_json.drag_items[].image_asset_id` 引用资产。一个题目可引用多个素材，一个素材可被多题复用。系统通用素材使用空数组 `[]`。关联关系以题库为主、资产合同为辅。

### 17.4 跨文件校验清单（P0 批量生产前必做）

JSON Schema 仅能校验单条记录内的结构与条件约束，以下跨记录 / 跨系统一致性检查需由独立校验脚本执行：

| # | 校验项 | 说明 |
|---|:---|:---|
| 1 | `asset_id` 全局唯一 | 同一 manifest 内不得重复 |
| 2 | `reference_asset_ids` 真实存在 | 引用的参考资产 ID 必须在 manifest 中可查 |
| 3 | `question_ids` 在题库中存在 | 每个题目 ID 必须能在 question bank 中匹配 |
| 4 | `expected_answer` 与题库一致 | manifest 中的答案副本必须与题库主记录相同 |
| 5 | `runtime_path` 全小写 | 路径中不得出现大写字母，避免跨平台问题 |
| 6 | 文件真实存在 | `approved` 状态的资产，其 `source_path` 和 `runtime_path` 对应的文件必须存在于工程目录中 |
| 7 | `file_hash` 与文件一致 | 计算实际文件哈希并与 manifest 记录比对 |
| 8 | 已批准资产完成全部必需验收门 | 所有 `required: true` 的门状态必须为 `passed` |

本清单已由 `scripts/validate-visual-asset-manifest.mjs` 实现。P0 批量生产前、每次审核状态变更后和入库前都必须执行；不得以手工目视检查替代该脚本。

---

## 十八、五道验收门

每项资产交付前必须通过对应验收门。未通过任何一道门的素材不得进入正式题库。

### 18.0 AI 预审与人类签署原则

GPT/Claude 可作为 `ai_pre_review` 辅助工具，对素材进行初步筛查（如色彩合规、尺寸检测、风格比对得分），但：

- **AI 不得作为任何验收门的最终责任人**
- 门 1（技术验收）可由脚本自动化完成，无需人工签署
- 门 2–5（视觉/职业/特教/测评）的最终 `passed` 状态**必须由人类审核员签署**
- MVP 阶段允许同一名合格人员兼任多个角色（需在 manifest 中记录实际签署人）
- `ai_pre_review` 字段记录 AI 辅助结果，供人类审核参考，不替代人类判断

### 18.1 验收门定义

| # | 门 | 判定准则 | 最终责任人 | AI 可辅助 | 不通过时处置 |
|---|:---|:---|:---|:---:|:---|
| 1 | **技术验收** | 尺寸/格式/DPI 符合规范；透明底无残留；文件名合规；hash 与 manifest 一致 | 脚本自动化 | ✓ | 退回 Layer 2 |
| 2 | **视觉验收** | 与参考图(R1-R6)风格一致；色彩在 §2.1 色板内；光照/机位/角色外观无漂移 | 人类设计审核员 | ✓（风格比对得分） | 退回 Layer 1 重新生成 |
| 3 | **职业验收** | 动作/流程/道具/商品符合真实超市理货规范；门店规则有据可查（`policy_basis`） | 人类·职业教育教师 / 超市实操顾问 | — | 修正动作描述后重新生成 |
| 4 | **特教验收** | 认知负荷适当；无过度感官刺激；AAC 符号可理解；触控目标 ≥80px；表情自然适度 | 人类·特教专业人员 | — | 调整复杂度/风格后重新生成 |
| 5 | **测评验收** | 无答案线索（高亮/颜色暗示/文字提示）；无构念外难度；`forbidden_visual_cues` 全部未出现 | 人类·测评设计专家 | ✓（线索扫描） | 退回并标注具体线索位置 |

### 18.2 各类素材所需门数

| 素材类型 | 门 1 | 门 2 | 门 3 | 门 4 | 门 5 |
|:---|:---:|:---:|:---:|:---:|:---:|
| 商品单品图（训练） | ✓ | ✓ | — | ✓ | — |
| 商品单品图（测评） | ✓ | ✓ | — | ✓ | ✓ |
| 货架场景图（测评） | ✓ | ✓ | ✓ | ✓ | ✓ |
| 临损商品图 | ✓ | ✓ | ✓ | ✓ | ✓ |
| UI/系统图标 | ✓ | ✓ | — | ✓ | — |
| AAC 图标 | ✓ | ✓ | — | ✓ | — |
| 视频 (`review_level: standard`) | ✓ | ✓ | ✓ | ✓ | — |
| 视频 (`review_level: assessment_critical`) | ✓ | ✓ | ✓ | ✓ | ✓ |
| 视频 (`review_level: safety_critical`) | ✓ | ✓ | ✓ | ✓ | ✓ + 逐帧 |

### 18.3 验收记录格式

```jsonc
{
  "batch_id": "batch_001",
  "review_date": "2026-07-20",
  "reviewer": "张老师",
  "reviewer_role": "sped",
  "gate": 4,
  "assets_reviewed": ["asset_fruit_apple_01", "asset_fruit_banana_01", "..."],
  "results": {
    "asset_fruit_apple_01": { "status": "passed", "notes": null },
    "asset_fruit_banana_01": { "status": "revision_required", "notes": "颜色过于鲜艳，刺激度偏高" }
  }
}
```

---

## 十九、MVP 范围外的泛化规划（远期）

当前 MVP 固定单角色、单场景、单岗位，素材复杂度以 L0–L2 为主。完整职业转衔训练体系要求逐步引入 L3 泛化素材，但不在 v1.0 范围内。此处仅预留扩展方向，不展开实现。

### 19.1 泛化维度

| 维度 | MVP 当前 | 未来泛化 |
|:---|:---|:---|
| 角色 | 1 名固定理货员 | 3–4 名不同性别/年龄角色 |
| 场景 | 1 套固定货架/库房 | 2–3 套不同超市环境 |
| 商品 | 固定品牌包装 | 更换包装/品牌/配色 |
| 光照 | 标准荧光灯 | 自然光/不同时段/夜间补货 |
| 干扰物 | 无或极少 | 顾客经过/同事交谈/背景噪声 |
| 服装 | 绿色马甲固定 | 不同款式但功能等价的工作服 |

### 19.2 资产结构预留

```
assets/
├── core/              # MVP 核心题库素材（当前全部）
├── generalization/    # 泛化训练包（未来）
│   ├── characters/    # 3-4 名备选角色
│   ├── scenes/        # 备选场景
│   └── products/      # 备选包装
└── final_exam/        # 固定结业卷（学生未见过的等价场景）
```

### 19.3 参考包分层策略

R1–R6 参考图在 MVP 冻结后即为**核心参考包（core）**，长期有效。后续泛化题新增的角色、商品包装或门店环境使用独立的**泛化参考包（extended）**，但必须继承核心包的风格锚点（色板、笔触、光照方向、人物比例）。

| 参考包 | 内容 | 冻结时机 | 引用规则 |
|:---|:---|:---|:---|
| core | R1–R6（角色表、光照板、货架标准、水果母版、色卡、Icon 风格板） | v1.2.1-hardening 基线冻结 | 所有素材必须引用至少 1 项 |
| extended | R7+（备选角色表、新场景环境板、泛化商品包装板…） | 泛化批次启动前逐批冻结 | 可叠加引用，不可替代 core |

**Manifest 标注方式：** 每项资产的 `reference_pack` 字段声明它依赖的参考包层级。引用了 extended 包的资产同时隐含依赖 core（extended 是 core 的超集延伸，而非替代）。

**实践约束：**
- 泛化参考图出图前，必须先通过"风格一致性门"（Gate 2 — visual）与核心包做 A/B 对比
- extended 包内的新角色仍复用核心包的服装配色方案和体型比例
- 任何 extended 参考图不得与 core 包的色板/禁色规则冲突

### 19.4 远期验收补充

泛化素材上线前需额外验证：
- 新角色/场景是否仍能让学生正确迁移已学规则
- 新环境复杂度是否超出目标学生认知承受范围
- 结业卷场景是否与训练场景规则等价但视觉不同

---

**文档结束。** 本文档是全系统视觉素材的唯一规划来源。执行时按优先级（P0→P1→P2）分批生成，每批通过标准参考图资产包锚定风格一致性，所有交付素材必须通过对应验收门后方可入库。
