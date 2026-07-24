# 超市理货员剩余274题审核合并与修订台账

**审核日期：** 2026-07-19  
**生成状态：** DRAFT；不具备激活授权  
**来源快照：** `doc/reference/专业岗位能力测评题库-M1-M6-数据库导出-298条.json`（sha256:7af29b8ab55edfa07f5931fce4721a6777fbf0f5d0f9d68e7028ac8228f4bc98）

## 汇总

| 合并状态 | 题数 | 处理 |
|---|---:|---|
| APPROVED_UNCHANGED | 31 | 保留原 ID / v1 与原始语义，状态保持 DRAFT |
| REVISION_REQUIRED | 232 | 创建 `_V2` / v2 修订候选，等待陈晓青与赫东对新 hash 复审 |
| REJECTED | 11 | 不进入候选，保留原始审核证据 |
| BLOCKED_CONFLICT | 0 | 阻断并等待人工裁决 |

候选共 263 题。未修改298题来源快照、Pilot v3、历史审核结果或运行库，也未生成激活 SQL。

## 逐题台账

| 原始题目 | 内容 | 安全 | 技术 | 合并状态 | 候选题目 / 版本 | 审核依据与修订要求 |
|---|---|---|---|---|---|---|
| `M1_DG_027` | APPROVED | PASS | PASS | APPROVED_UNCHANGED | `M1_DG_027` / v1 | 三类审核均通过，保留原题语义并保持 DRAFT。 |
| `M1_DG_028` | RETURN_FOR_REVISION | RETURN_FOR_REVISION | RETURN_FOR_REVISION | REVISION_REQUIRED | `M1_DG_028_V2` / v2 | 酸奶被映射到饮品区，但酸奶通常属于冷藏乳品/冷链区。应增加冷链区并修正映射，或改用常温饮料。；将“酸奶”直接归入普通饮品区，可能脱离冷藏条件，存在商品温控和食品安全风险；应明确为常温酸奶，或改入冷藏区。；商品分区错误或条件不足：普通酸奶通常属于冷藏商品，不能与可乐统一归入常温饮品区。 |
| `M1_DG_029` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M1_DG_029_V2` / v2 | 当前漏标安全敏感，应增加安全标记并进入安全复核。 |
| `M1_DG_030` | APPROVED | PASS | PASS | APPROVED_UNCHANGED | `M1_DG_030` / v1 | 三类审核均通过，保留原题语义并保持 DRAFT。 |
| `M1_DG_031` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M1_DG_031_V2` / v2 | 题目依赖4张货架照片，当前未绑定照片。需固定每张照片的唯一问题点、视角和可见范围，避免一图多错；当前漏标安全敏感，应增加安全标记并进入安全复核。 |
| `M1_DG_032` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M1_DG_032_V2` / v2 | “仅有褶皱且封口完好”是否可直接上架仍受门店外观标准约束。应补充无污染、无漏气、无异常鼓胀并符合门店标准的边界。 |
| `M1_OB_048` | REJECTED | RETURN_FOR_REVISION | RETURN_FOR_REVISION | REJECTED | 不进入候选 | 该题属于非预告、事后告知且不计分的隐蔽观察，不是可稳定复现的理货岗位题目。建议移出正式题库，另存为经伦理审查和标准化培训后的补充观察协议。 |
| `M1_OP_034` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M1_OP_034_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点。 |
| `M1_OP_035` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M1_OP_035_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点。 |
| `M1_OP_036` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M1_OP_036_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点。 |
| `M1_OP_037` | RETURN_FOR_REVISION | PASS | RETURN_FOR_REVISION | REVISION_REQUIRED | `M1_OP_037_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点；按商品大小从左到右排序不是通用Facing或排面规则，应改为按价签/排面图归位并保持同SKU成面。；“同类商品从大到小排列”不是通用陈列标准；真实门店应按陈列图、SKU、品牌块、规格和价签位置执行。 |
| `M1_OP_038` | RETURN_FOR_REVISION | RETURN_FOR_REVISION | RETURN_FOR_REVISION | REVISION_REQUIRED | `M1_OP_038_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点。；未限定污渍性质、是否先移开商品、是否使用批准清洁剂及警示措施，可能造成污染、湿滑或商品受损。；清洁流程和评分锚点过于简化，仅以“无明显污渍”判定，缺少移货、隔离、清洁、干燥、复位和复查步骤。 |
| `M1_OP_039` | RETURN_FOR_REVISION | PASS | RETURN_FOR_REVISION | REVISION_REQUIRED | `M1_OP_039_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点。；仅凭“错位”移动价签不足以完成真实核对；应先核对条码、品名、规格和价格，再按权限归位或上报。 |
| `M1_OP_040` | RETURN_FOR_REVISION | RETURN_FOR_REVISION | PASS | REVISION_REQUIRED | `M1_OP_040_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点；当前漏标安全敏感，应增加安全标记并进入安全复核。；使用“大桶水”等重物配合未注明额定载荷和防倾倒措施的迷你货架，存在货架倾覆、砸伤风险。 |
| `M1_OP_041` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M1_OP_041_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点。 |
| `M1_OP_042` | REJECTED | PASS | RETURN_FOR_REVISION | REJECTED | 不进入候选 | “全部取下再按原样摆回”主要测工作记忆，且会造成不必要的整架搬动，不符合日常理货验收流程。建议用示例图/价签/排面图的真实复位任务替代。 |
| `M1_OP_043` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M1_OP_043_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点。 |
| `M1_OP_044` | RETURN_FOR_REVISION | PASS | RETURN_FOR_REVISION | REVISION_REQUIRED | `M1_OP_044_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点；“同类内从大到小”不是通用门店标准，应以SKU、规格价签和排面图为准。；按品类归拢和正面朝外正确，但“同类内从大到小”不是通用规则，应改为按陈列图、规格价签和既定排面还原。 |
| `M1_OP_045` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M1_OP_045_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点。 |
| `M1_OP_046` | RETURN_FOR_REVISION | PASS | RETURN_FOR_REVISION | REVISION_REQUIRED | `M1_OP_046_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点；“插入新品且不影响原位置”可能违反FIFO和排面数量。应明确同款/不同款、旧货移出、新货后置及价签对应。；新品不能在没有分配货位、价签和排面空间的前提下直接“插入”；应先核对上新指令/陈列图并配置对应价签。 |
| `M1_OP_047` | RETURN_FOR_REVISION | PASS | RETURN_FOR_REVISION | REVISION_REQUIRED | `M1_OP_047_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点。；题目称“完整整理”，但发现错价后只要求识别，没有暂停相关排面、上报和更换/核验价签的闭环。 |
| `M1_SC_002` | APPROVED | PASS | PASS | APPROVED_UNCHANGED | `M1_SC_002` / v1 | 三类审核均通过，保留原题语义并保持 DRAFT。 |
| `M1_SC_003` | APPROVED | PASS | PASS | APPROVED_UNCHANGED | `M1_SC_003` / v1 | 三类审核均通过，保留原题语义并保持 DRAFT。 |
| `M1_SC_005` | APPROVED | PASS | RETURN_FOR_REVISION | REVISION_REQUIRED | `M1_SC_005_V2` / v2 | 题干、岗位口径、答案/映射和施测条件一致，可进入下一轮安全与技术审核。；“价签模糊即暂停售卖”不是唯一通用流程；应先核对系统价、隔离错误价签并按门店权限补打/更换，是否停售由门店规则或负责人决定。 |
| `M1_SC_006` | APPROVED | PASS | PASS | APPROVED_UNCHANGED | `M1_SC_006` / v1 | 三类审核均通过，保留原题语义并保持 DRAFT。 |
| `M1_SC_008` | APPROVED | PASS | PASS | APPROVED_UNCHANGED | `M1_SC_008` / v1 | 三类审核均通过，保留原题语义并保持 DRAFT。 |
| `M1_SC_009` | APPROVED | PASS | PASS | APPROVED_UNCHANGED | `M1_SC_009` / v1 | 三类审核均通过，保留原题语义并保持 DRAFT。 |
| `M1_SC_010` | APPROVED | PASS | PASS | APPROVED_UNCHANGED | `M1_SC_010` / v1 | 三类审核均通过，保留原题语义并保持 DRAFT。 |
| `M1_SC_011` | APPROVED | PASS | PASS | APPROVED_UNCHANGED | `M1_SC_011` / v1 | 三类审核均通过，保留原题语义并保持 DRAFT。 |
| `M1_SC_012` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M1_SC_012_V2` / v2 | “玻璃瓶饮料固定放中层”不是通用陈列规则，实际应优先服从门店排面图、层板承重和防跌落要求。题目应改为考查“竖直放稳、不叠放、不超边、按排面和承重要求摆放”；当前漏标安全敏感，应增加安全标记并进入安全复核。 |
| `M1_SC_013` | APPROVED | PASS | PASS | APPROVED_UNCHANGED | `M1_SC_013` / v1 | 三类审核均通过，保留原题语义并保持 DRAFT。 |
| `M1_SC_014` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M1_SC_014_V2` / v2 | 题目依赖货架照片，但当前未绑定可核验素材；文字又直接描述了各商品所在区域，弱化了图片识别。应绑定唯一照片并锁定错放商品位置，或改为纯文本题。 |
| `M1_TF_015` | RETURN_FOR_REVISION | PASS | RETURN_FOR_REVISION | REVISION_REQUIRED | `M1_TF_015_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”；候选答案与素材行为相反：视频描述为正面朝外、摆正对齐，应改为正确（true）。；素材描述为“商品正面朝外、逐一摆正对齐”，这是正确陈列行为，但答案却标为错误，标准答案反向。 |
| `M1_TF_016` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M1_TF_016_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”；当前漏标安全敏感，应增加安全标记并进入安全复核。 |
| `M1_TF_017` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M1_TF_017_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”。 |
| `M1_TF_018` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M1_TF_018_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”。 |
| `M1_TF_019` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M1_TF_019_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”。 |
| `M1_TF_020` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M1_TF_020_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”。 |
| `M1_TF_021` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M1_TF_021_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”。 |
| `M1_TF_022` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M1_TF_022_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”。 |
| `M1_TF_023` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M1_TF_023_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”。 |
| `M1_TF_024` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M1_TF_024_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”。 |
| `M1_TF_025` | RETURN_FOR_REVISION | PASS | RETURN_FOR_REVISION | REVISION_REQUIRED | `M1_TF_025_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”；小件糖果固定放中层显眼位不是通用排面规则，应以门店排面图和价签为准。；小件糖果固定放“中层显眼位置”不是通用规则，应服从陈列图、价签、儿童可触及风险及门店商品布局。 |
| `M1_TF_026` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M1_TF_026_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”。 |
| `M2_DG_023` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M2_DG_023_V2` / v2 | 当前漏标安全敏感，应增加安全标记并进入安全复核。 |
| `M2_DG_024` | APPROVED | PASS | PASS | APPROVED_UNCHANGED | `M2_DG_024` / v1 | 三类审核均通过，保留原题语义并保持 DRAFT。 |
| `M2_DG_025` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M2_DG_025_V2` / v2 | 当前漏标安全敏感，应增加安全标记并进入安全复核。 |
| `M2_DG_026` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M2_DG_026_V2` / v2 | 把“褶皱但封口完好品”直接判为可补货过于绝对，应补充门店外观验收边界和异常复核条件；当前漏标安全敏感，应增加安全标记并进入安全复核。 |
| `M2_OP_028` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M2_OP_028_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点；当前漏标安全敏感，应增加安全标记并进入安全复核。 |
| `M2_OP_029` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M2_OP_029_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点。 |
| `M2_OP_030` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M2_OP_030_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点。 |
| `M2_OP_031` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M2_OP_031_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点。 |
| `M2_OP_032` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M2_OP_032_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点。 |
| `M2_OP_033` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M2_OP_033_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点；“从后往前、从下往上”不是通用补货顺序，且没有说明货架结构和安全原因。应删除固定方向或改为门店明确SOP。 |
| `M2_OP_034` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M2_OP_034_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点。 |
| `M2_OP_035` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M2_OP_035_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点。 |
| `M2_OP_036` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M2_OP_036_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点。 |
| `M2_OP_037` | RETURN_FOR_REVISION | RETURN_FOR_REVISION | RETURN_FOR_REVISION | REVISION_REQUIRED | `M2_OP_037_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点；当前漏标安全敏感，应增加安全标记并进入安全复核。；题目要求“安全拆箱”，但工具清单没有批准的安全开箱器具、刀具使用边界或防割措施，无法保证实操安全。；线下材料不足以执行评分锚点中的“安全拆箱”；需明确安全刀具、切割方向、刀刃伸出长度、手部位置和空箱处置。 |
| `M2_OP_038` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M2_OP_038_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点。 |
| `M2_OP_039` | RETURN_FOR_REVISION | PASS | RETURN_FOR_REVISION | REVISION_REQUIRED | `M2_OP_039_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点；当前漏标安全敏感，应增加安全标记并进入安全复核。；将“不足15天”直接作为通用临期标准不符合不同品类和门店规则；应在题干明确“按本门店模拟规则：剩余≤15天”。 |
| `M2_OP_040` | RETURN_FOR_REVISION | RETURN_FOR_REVISION | RETURN_FOR_REVISION | REVISION_REQUIRED | `M2_OP_040_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点。；题目把“发现破损或其他异常后停止收货”与后续“入库登记、签收”串成同一路径，可能引导学员在异常未闭环时继续接收入库，造成问题商品进入库存或销售链路。；收货流程缺少异常分支和签收权限说明；发现异常后不能继续入库签收，且应明确由谁签字、学员是提交还是签署。 |
| `M2_OP_041` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M2_OP_041_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点。 |
| `M2_SC_001` | RETURN_FOR_REVISION | RETURN_FOR_REVISION | RETURN_FOR_REVISION | REVISION_REQUIRED | `M2_SC_001_V2` / v2 | 题目问“拆箱补货第一步”，候选答案却直接检查箱内商品；在未开箱前应先检查外箱、箱唛/补货单和作业环境，再安全开箱。当前题干、选项与M2拆箱流程不一致。；题目把“检查商品完好度和生产日期”设为拆箱补货第一步，遗漏外箱检查和安全开箱，可能弱化开箱风险控制。；与同模块标准流程矛盾：正确首步应先检查外箱/作业环境，再安全开箱，之后才能逐件检查商品。现有选项无完整正确答案。 |
| `M2_SC_004` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M2_SC_004_V2` / v2 | 当前漏标安全敏感，应增加安全标记并进入安全复核。 |
| `M2_SC_006` | APPROVED | PASS | PASS | APPROVED_UNCHANGED | `M2_SC_006` / v1 | 三类审核均通过，保留原题语义并保持 DRAFT。 |
| `M2_SC_007` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M2_SC_007_V2` / v2 | “拆箱补货”与“收货核单”混在一起。门店前场从库房补货未必持送货单；若考查收货应明确单据，若考查补货应核对补货单/品名数量及破损效期；当前漏标安全敏感，应增加安全标记并进入安全复核。 |
| `M2_SC_008` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M2_SC_008_V2` / v2 | 当前漏标安全敏感，应增加安全标记并进入安全复核。 |
| `M2_SC_009` | APPROVED | PASS | PASS | APPROVED_UNCHANGED | `M2_SC_009` / v1 | 三类审核均通过，保留原题语义并保持 DRAFT。 |
| `M2_SC_010` | APPROVED | PASS | PASS | APPROVED_UNCHANGED | `M2_SC_010` / v1 | 三类审核均通过，保留原题语义并保持 DRAFT。 |
| `M2_SC_011` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M2_SC_011_V2` / v2 | 当前漏标安全敏感，应增加安全标记并进入安全复核。 |
| `M2_SC_012` | APPROVED | PASS | PASS | APPROVED_UNCHANGED | `M2_SC_012` / v1 | 三类审核均通过，保留原题语义并保持 DRAFT。 |
| `M2_TF_013` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M2_TF_013_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”。 |
| `M2_TF_014` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M2_TF_014_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”；当前漏标安全敏感，应增加安全标记并进入安全复核。 |
| `M2_TF_015` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M2_TF_015_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”。 |
| `M2_TF_016` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M2_TF_016_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”。 |
| `M2_TF_017` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M2_TF_017_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”；当前漏标安全敏感，应增加安全标记并进入安全复核。 |
| `M2_TF_018` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M2_TF_018_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”；褶皱封口完好是否可售仍受外观标准约束，不应一律允许无复核上架。 |
| `M2_TF_019` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M2_TF_019_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”；当前漏标安全敏感，应增加安全标记并进入安全复核。 |
| `M2_TF_020` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M2_TF_020_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”；当前漏标安全敏感，应增加安全标记并进入安全复核。 |
| `M2_TF_021` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M2_TF_021_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”。 |
| `M2_TF_022` | RETURN_FOR_REVISION | RETURN_FOR_REVISION | RETURN_FOR_REVISION | REVISION_REQUIRED | `M2_TF_022_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”；徒手撕胶带并非统一安全拆箱方法，应改为使用易开结构或批准的安全开箱工具；当前漏标安全敏感，应增加安全标记并进入安全复核。；把徒手撕胶带认定为正确，可能导致指甲、手指割伤或突然用力失衡；应使用批准的安全开箱器具。；徒手撕胶带不是稳定、可复制的标准拆箱方法；应考查安全刀具、刀口远离身体和商品、另一只手避开切割线。 |
| `M3_DG_037` | APPROVED | PASS | PASS | APPROVED_UNCHANGED | `M3_DG_037` / v1 | 三类审核均通过，保留原题语义并保持 DRAFT。 |
| `M3_DG_038` | RETURN_FOR_REVISION | PASS | RETURN_FOR_REVISION | REVISION_REQUIRED | `M3_DG_038_V2` / v2 | “褶皱封口完好=正常”和“胀袋奶粉=报损”均需同款正常样或更明确异常特征；否则图片/文字难以稳定区分；当前漏标安全敏感，应增加安全标记并进入安全复核。；破损、过期和胀袋商品应先隔离、标识、登记并上报，不能由理货员直接统一判为“报损”；报损/退货/销毁需按权限处理。 |
| `M3_DG_039` | APPROVED | PASS | PASS | APPROVED_UNCHANGED | `M3_DG_039` / v1 | 三类审核均通过，保留原题语义并保持 DRAFT。 |
| `M3_DG_040` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M3_DG_040_V2` / v2 | 当前漏标安全敏感，应增加安全标记并进入安全复核。 |
| `M3_DG_041` | RETURN_FOR_REVISION | PASS | RETURN_FOR_REVISION | REVISION_REQUIRED | `M3_DG_041_V2` / v2 | 当前漏标安全敏感，应增加安全标记并进入安全复核。；“已过期商品→立即下架报损”缺少隔离、登记、上报和授权处置，且理货员通常无权直接完成报损。 |
| `M3_DG_042` | APPROVED | PASS | PASS | APPROVED_UNCHANGED | `M3_DG_042` / v1 | 三类审核均通过，保留原题语义并保持 DRAFT。 |
| `M3_OP_044` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M3_OP_044_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点。 |
| `M3_OP_045` | RETURN_FOR_REVISION | PASS | RETURN_FOR_REVISION | REVISION_REQUIRED | `M3_OP_045_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点。；临期阈值固定为15天但未声明为本门店模拟规则；不同商品、供应商和门店阈值不同。 |
| `M3_OP_046` | RETURN_FOR_REVISION | PASS | RETURN_FOR_REVISION | REVISION_REQUIRED | `M3_OP_046_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点。；正常/临期/报损分类依赖未声明的固定临期阈值，且破损和过期不应直接等同于已批准报损。 |
| `M3_OP_047` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M3_OP_047_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点；剩余天数计算必须固定模拟工作日、计日口径和标准答案，并允许批准的日期计算工具。 |
| `M3_OP_048` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M3_OP_048_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点；“凹陷罐必定不可上架”需按凹陷部位/程度及门店问题品标准设定样品，不能用任意轻微凹陷；当前漏标安全敏感，应增加安全标记并进入安全复核。 |
| `M3_OP_049` | RETURN_FOR_REVISION | RETURN_FOR_REVISION | PASS | REVISION_REQUIRED | `M3_OP_049_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点；五件边界样品必须定义同款正常样、异常程度和门店判据；充氮包装、轻微凹陷和褶皱不能只凭名称判定。；漏气、松盖、胀袋等样品若使用真实内容物会有泄漏、污染或接触风险；必须使用清空、二次封装且不可食用的模拟样品。 |
| `M3_OP_050` | RETURN_FOR_REVISION | PASS | RETURN_FOR_REVISION | REVISION_REQUIRED | `M3_OP_050_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点。；把“≤15天”作为临期标准但未写明是本门店模拟规则，无法作为通用岗位判据。 |
| `M3_OP_051` | RETURN_FOR_REVISION | PASS | RETURN_FOR_REVISION | REVISION_REQUIRED | `M3_OP_051_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点；当前漏标安全敏感，应增加安全标记并进入安全复核。；题干要求“登记上报”，评分锚点只检查登记，没有实际上报/交接行为，达标标准不闭环。 |
| `M3_OP_052` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M3_OP_052_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点；当前漏标安全敏感，应增加安全标记并进入安全复核。 |
| `M3_OP_053` | RETURN_FOR_REVISION | PASS | RETURN_FOR_REVISION | REVISION_REQUIRED | `M3_OP_053_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点；3分钟不是已说明的岗位达标标准；应把时间作为观察指标，正确率和安全优先，不能时间到即以未达标判定。；“3分钟内完成15件”是未经说明来源的硬性速度标准；应依据岗位实测基准或试测常模设定，并将准确率与速度分开评分。 |
| `M3_OP_054` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M3_OP_054_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点；工具描述称第三种为“生产日期见瓶身”，但题干要求读到期日；若需计算还必须提供保质期和固定计算规则。 |
| `M3_OP_055` | RETURN_FOR_REVISION | PASS | RETURN_FOR_REVISION | REVISION_REQUIRED | `M3_OP_055_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点；题干要求“临期商品放最前排”，rubric却要求临期品不在原货架，二者直接冲突。应统一为移入临期专区，再对正常库存按FIFO排列。；题干要求“临期优先摆在最前排”，评分锚点却要求临期商品不应留在货架，题干与标准答案直接矛盾。 |
| `M3_OP_056` | REJECTED | PASS | RETURN_FOR_REVISION | REJECTED | 不进入候选 | 要求“所有日期标签可见”与商品正面朝外、按排面陈列存在结构性冲突；实际巡检通常逐件翻看日期后恢复Facing，不会让底部或背面日期长期朝外。 |
| `M3_OP_057` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M3_OP_057_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点。 |
| `M3_OP_058` | RETURN_FOR_REVISION | PASS | RETURN_FOR_REVISION | REVISION_REQUIRED | `M3_OP_058_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点；工具说明称“共4件问题”，但其中“褶皱封口完好品”又被设为不应误判的问题陷阱，数量表述自相矛盾；当前漏标安全敏感，应增加安全标记并进入安全复核。；材料备注把“褶皱但封口完好品”计入4件问题品，评分又要求不误判为破损，样本总数和正确分类相互矛盾。 |
| `M3_SC_002` | APPROVED | PASS | PASS | APPROVED_UNCHANGED | `M3_SC_002` / v1 | 三类审核均通过，保留原题语义并保持 DRAFT。 |
| `M3_SC_003` | RETURN_FOR_REVISION | PASS | RETURN_FOR_REVISION | REVISION_REQUIRED | `M3_SC_003_V2` / v2 | 生产日期加30天存在是否包含生产当日的口径差异。题目必须给出统一计算规则，或直接提供“到期日/有效期至”标签，避免把法规和门店口径差异当作学生错误。；“生产日期+30天”的到期日受是否计入生产当日、标签规则和月份天数影响，题目未规定计算口径，答案不具唯一性。 |
| `M3_SC_004` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M3_SC_004_V2` / v2 | “还有几天”未说明是否包含今天和到期当天。候选8天采用日期差口径，但题目未声明，无法保证唯一判分。 |
| `M3_SC_006` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M3_SC_006_V2` / v2 | 题干引号异常，且“剩余天数”未说明计日口径。应明确“按到期日减今天，不含今天”并修正文案。 |
| `M3_SC_007` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M3_SC_007_V2` / v2 | 题干引号异常；按月保质期的到期日计算和是否包含当天需在题目规则中明确，不能默认所有门店采用同一口径。 |
| `M3_SC_008` | RETURN_FOR_REVISION | PASS | RETURN_FOR_REVISION | REVISION_REQUIRED | `M3_SC_008_V2` / v2 | 题干引号异常；270天计算必须明确起算规则并允许使用批准的日期计算工具，否则易测成纯算术而非效期巡检能力。；“生产日期+270天”的到期日同样受是否计入生产当日的计算口径影响；题目未规定口径，2026-08-16与2026-08-17均可能被不同制度采用，答案不唯一。 |
| `M3_SC_009` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M3_SC_009_V2` / v2 | 题干引号异常；“还有59天”采用不含今天的日期差，应在题干中写明计算口径，并说明可使用门店批准的计算工具。 |
| `M3_SC_010` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M3_SC_010_V2` / v2 | 题干引号异常。若只考查先后，应直接比较两件商品的到期日，不必夹带“还有21/45天”这一未声明计日口径。 |
| `M3_SC_011` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M3_SC_011_V2` / v2 | 当前漏标安全敏感，应增加安全标记并进入安全复核。 |
| `M3_SC_012` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M3_SC_012_V2` / v2 | 罐体凹陷是否不可售取决于凹陷位置、深度及是否涉及卷边/接缝。当前把所有“明显侧面凹陷”一律判不可上架过于绝对，应改成严重凹陷、接缝受损或按门店问题品标准隔离复核；当前漏标安全敏感，应增加安全标记并进入安全复核。 |
| `M3_SC_013` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M3_SC_013_V2` / v2 | 当前漏标安全敏感，应增加安全标记并进入安全复核。 |
| `M3_SC_014` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M3_SC_014_V2` / v2 | “轻微褶皱且封口完好即可上架”仍受商品外观验收和门店销售标准约束。应改为“无破口、无漏气、无污染且符合门店外观标准；有疑问隔离复核”。 |
| `M3_SC_015` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M3_SC_015_V2` / v2 | 部分商品采用充氮或预留气体包装，单凭“像气球”不能区分正常包装与异常胀袋。应提供同款正常样对照或明确“异常鼓胀、异味/渗漏”等异常特征；当前漏标安全敏感，应增加安全标记并进入安全复核。 |
| `M3_SC_016` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M3_SC_016_V2` / v2 | 当前漏标安全敏感，应增加安全标记并进入安全复核。 |
| `M3_SC_017` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M3_SC_017_V2` / v2 | 当前漏标安全敏感，应增加安全标记并进入安全复核。 |
| `M3_SC_018` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M3_SC_018_V2` / v2 | 当前漏标安全敏感，应增加安全标记并进入安全复核。 |
| `M3_SC_020` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M3_SC_020_V2` / v2 | 当前漏标安全敏感，应增加安全标记并进入安全复核。 |
| `M3_SC_021` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M3_SC_021_V2` / v2 | “破损一定优先于临期”只有在破损带来割伤、泄漏、污染等即时风险时成立。应把情境改为“破裂玻璃/泄漏商品”并明确先隔离危险；当前漏标安全敏感，应增加安全标记并进入安全复核。 |
| `M3_SC_022` | RETURN_FOR_REVISION | PASS | RETURN_FOR_REVISION | REVISION_REQUIRED | `M3_SC_022_V2` / v2 | 临期品移区后原位价签是否保留取决于该SKU是否仍有正常库存和门店价签制度。当前答案不能跨门店通用，应补充“仍有正常库存”或明确门店SOP。；临期商品全部移走后是否保留原价签取决于是否继续保留该SKU货位；临期专区还必须有可对应的商品价签，现答案过于绝对。 |
| `M3_SC_023` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M3_SC_023_V2` / v2 | “当天到期必须移入临期专区”依赖门店临期阈值及停售时间。题干应重申本题门店规则，并区分“当日可售至何时”和“过期后不得销售”。 |
| `M3_SC_024` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M3_SC_024_V2` / v2 | 当前漏标安全敏感，应增加安全标记并进入安全复核。 |
| `M3_TF_025` | RETURN_FOR_REVISION | RETURN_FOR_REVISION | RETURN_FOR_REVISION | REVISION_REQUIRED | `M3_TF_025_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”；当天到期品的下架/临期处理时间须引用明确门店SOP；当前漏标安全敏感，应增加安全标记并进入安全复核。；酸奶属于温控商品；移入未说明制冷条件的“临期专区”可能造成冷链中断和食品安全风险。；临期处理必须保持原储存温度，应明确移入冷藏临期区，而非通用临期专区。 |
| `M3_TF_026` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M3_TF_026_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”；当前漏标安全敏感，应增加安全标记并进入安全复核。 |
| `M3_TF_027` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M3_TF_027_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”。 |
| `M3_TF_028` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M3_TF_028_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”；轻微褶皱能否上架须增加无污染、无漏气且符合门店外观标准。 |
| `M3_TF_029` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M3_TF_029_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”；当前漏标安全敏感，应增加安全标记并进入安全复核。 |
| `M3_TF_030` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M3_TF_030_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”；个人手机计算器可能受门店设备管理限制，应改为批准的计算器或工作终端。 |
| `M3_TF_031` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M3_TF_031_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”；当前漏标安全敏感，应增加安全标记并进入安全复核。 |
| `M3_TF_032` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M3_TF_032_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”；当前漏标安全敏感，应增加安全标记并进入安全复核。 |
| `M3_TF_033` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M3_TF_033_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”；不能把封口完好直接等同于符合销售外观标准。 |
| `M3_TF_034` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M3_TF_034_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”；判断临期后还应按门店记录/移区流程执行，不能仅凭个人计算直接完成处置。 |
| `M3_TF_035` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M3_TF_035_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”。 |
| `M3_TF_036` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M3_TF_036_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”。 |
| `M4_DG_023` | RETURN_FOR_REVISION | RETURN_FOR_REVISION | RETURN_FOR_REVISION | REVISION_REQUIRED | `M4_DG_023_V2` / v2 | “发现异常停止收货”是条件分支，不应作为所有收货流程都必须经过的固定第3步。应设计为有异常/无异常两条路径。；题目把“发现破损或其他异常后停止收货”与后续“入库登记、签收”串成同一路径，可能引导学员在异常未闭环时继续接收入库，造成问题商品进入库存或销售链路。；流程把“发现异常停止收货”与后续“入库登记、签字确认”串成单一路径；异常时应转入复核/拒收/隔离分支，不能继续签收。 |
| `M4_DG_024` | APPROVED | PASS | PASS | APPROVED_UNCHANGED | `M4_DG_024` / v1 | 三类审核均通过，保留原题语义并保持 DRAFT。 |
| `M4_DG_025` | RETURN_FOR_REVISION | RETURN_FOR_REVISION | RETURN_FOR_REVISION | REVISION_REQUIRED | `M4_DG_025_V2` / v2 | 当前漏标安全敏感，应增加安全标记并进入安全复核。；将冷冻食品和酸奶统一放入同一“冷链区”可能造成温度条件错误，存在商品安全风险。；冷冻与冷藏是不同储存区和温度范围，必须分别设置“冷冻区”和“冷藏区”，不能合并评分。 |
| `M4_DG_026` | APPROVED | PASS | PASS | APPROVED_UNCHANGED | `M4_DG_026` / v1 | 三类审核均通过，保留原题语义并保持 DRAFT。 |
| `M4_DG_027` | APPROVED | PASS | PASS | APPROVED_UNCHANGED | `M4_DG_027` / v1 | 三类审核均通过，保留原题语义并保持 DRAFT。 |
| `M4_OP_028` | RETURN_FOR_REVISION | RETURN_FOR_REVISION | PASS | REVISION_REQUIRED | `M4_OP_028_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点；当前漏标安全敏感，应增加安全标记并进入安全复核。；大桶水与未注明额定载荷、防倾倒固定的迷你货架组合存在坠落和倾覆风险。 |
| `M4_OP_030` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M4_OP_030_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点。 |
| `M4_OP_031` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M4_OP_031_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点；单题结果不能直接写入岗位推荐意见，应与多题表现、安全结果和支持条件综合判断。 |
| `M4_OP_032` | RETURN_FOR_REVISION | RETURN_FOR_REVISION | RETURN_FOR_REVISION | REVISION_REQUIRED | `M4_OP_032_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点。；要求学员把所有通道障碍物直接搬走，未区分重物、危险品、失稳堆垛或需多人搬运物，可能造成搬运伤害。；真实流程应先停止通行、隔离并评估物品性质和重量，能安全搬移的才归位，不能处理的立即上报求助。 |
| `M4_OP_033` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M4_OP_033_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点。 |
| `M4_OP_034` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M4_OP_034_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点。 |
| `M4_OP_035` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M4_OP_035_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点。 |
| `M4_OP_036` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M4_OP_036_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点。 |
| `M4_OP_037` | RETURN_FOR_REVISION | RETURN_FOR_REVISION | RETURN_FOR_REVISION | REVISION_REQUIRED | `M4_OP_037_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点；r3同时写“未发现异常继续/发现异常停收”，但未说明本轮是否预置异常，评分人无法采用同一标准。；题目把“发现破损或其他异常后停止收货”与后续“入库登记、签收”串成同一路径，可能引导学员在异常未闭环时继续接收入库，造成问题商品进入库存或销售链路。；“发现异常停收”与“入库登记、签字确认”未设置分支，且签收角色/权限不清，无法唯一评分。 |
| `M4_OP_038` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M4_OP_038_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点。 |
| `M4_OP_039` | RETURN_FOR_REVISION | RETURN_FOR_REVISION | PASS | REVISION_REQUIRED | `M4_OP_039_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点；当前漏标安全敏感，应增加安全标记并进入安全复核。；乱架中包含重轻混放，但工具未限定重量、货架载荷和搬运辅助，整理时可能发生坠物或货架失稳。 |
| `M4_OP_040` | RETURN_FOR_REVISION | PASS | RETURN_FOR_REVISION | REVISION_REQUIRED | `M4_OP_040_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点。；未给出本门店临期阈值和商品类型，无法唯一判断“所有临期商品”。 |
| `M4_OP_041` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M4_OP_041_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点。 |
| `M4_OP_042` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M4_OP_042_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点。 |
| `M4_OP_043` | REJECTED | PASS | RETURN_FOR_REVISION | REJECTED | 不进入候选 | 财务、人事、运营文件分类属于文职归档任务，不是超市理货员拆箱、补货、陈列、盘点或安全巡检的岗位任务。 |
| `M4_OP_044` | REJECTED | PASS | RETURN_FOR_REVISION | REJECTED | 不进入候选 | 文件编号排序属于文职归档任务，与理货员核心工作流程无直接对应。 |
| `M4_OP_045` | REJECTED | PASS | RETURN_FOR_REVISION | REJECTED | 不进入候选 | 文件夹纠错属于文职归档任务，不应混入超市理货员正式岗位题库。 |
| `M4_OP_046` | REJECTED | PASS | RETURN_FOR_REVISION | REJECTED | 不进入候选 | 文件清单核对属于文职平行任务，不能直接代表理货员收货或库存核对能力。 |
| `M4_OP_047` | REJECTED | PASS | RETURN_FOR_REVISION | REJECTED | 不进入候选 | 文件日期排序属于文职平行任务，与商品效期、FIFO和库存作业的情境差异过大。 |
| `M4_OP_048` | REJECTED | PASS | RETURN_FOR_REVISION | REJECTED | 不进入候选 | 完整文件归档及中断恢复属于文职平行任务，不应进入超市理货员正式岗位题库。 |
| `M4_SC_002` | RETURN_FOR_REVISION | RETURN_FOR_REVISION | RETURN_FOR_REVISION | REVISION_REQUIRED | `M4_SC_002_V2` / v2 | “纸箱竖放且不超过人肩高度”不是可靠的统一码放标准，且竖放可能不符合包装方向。应改为遵守层板承重、箱体标识、门店限高线和稳定码放要求；当前漏标安全敏感，应增加安全标记并进入安全复核。；仅以“不超过肩高”判断码放安全，未考虑单箱重量、堆垛稳定、货架额定载荷、消防喷淋净空和搬运工具，可能仍然不安全。；库房码放没有统一“肩高”行业标准；应按货架额定层高/载荷、包装码放标识、门店SOP和机械辅助规定判定。 |
| `M4_SC_004` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M4_SC_004_V2` / v2 | 当前漏标安全敏感，应增加安全标记并进入安全复核。 |
| `M4_SC_006` | APPROVED | PASS | PASS | APPROVED_UNCHANGED | `M4_SC_006` / v1 | 三类审核均通过，保留原题语义并保持 DRAFT。 |
| `M4_SC_007` | APPROVED | PASS | PASS | APPROVED_UNCHANGED | `M4_SC_007` / v1 | 三类审核均通过，保留原题语义并保持 DRAFT。 |
| `M4_SC_008` | APPROVED | PASS | PASS | APPROVED_UNCHANGED | `M4_SC_008` / v1 | 三类审核均通过，保留原题语义并保持 DRAFT。 |
| `M4_SC_009` | APPROVED | PASS | PASS | APPROVED_UNCHANGED | `M4_SC_009` / v1 | 三类审核均通过，保留原题语义并保持 DRAFT。 |
| `M4_SC_010` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M4_SC_010_V2` / v2 | 当前漏标安全敏感，应增加安全标记并进入安全复核。 |
| `M4_SC_011` | APPROVED | PASS | PASS | APPROVED_UNCHANGED | `M4_SC_011` / v1 | 三类审核均通过，保留原题语义并保持 DRAFT。 |
| `M4_SC_012` | RETURN_FOR_REVISION | PASS | RETURN_FOR_REVISION | REVISION_REQUIRED | `M4_SC_012_V2` / v2 | 签字表示完成核对并对记录真实性负责，不等于签字人承担全部商品数量和质量责任。候选A责任表述过宽。；签收表示在授权范围内确认数量、外观/温度等验收结果，并不等同于“所有问题由签字人负责”；责任表述过度简化。 |
| `M4_TF_013` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M4_TF_013_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”。 |
| `M4_TF_014` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M4_TF_014_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”。 |
| `M4_TF_015` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M4_TF_015_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”。 |
| `M4_TF_016` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M4_TF_016_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”。 |
| `M4_TF_017` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M4_TF_017_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”。 |
| `M4_TF_018` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M4_TF_018_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”。 |
| `M4_TF_019` | RETURN_FOR_REVISION | PASS | RETURN_FOR_REVISION | REVISION_REQUIRED | `M4_TF_019_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”；拣货差异重新清点和标注后仍应上报或按异常流程交接。；复核确认短缺后仅在清单标注还不构成完整处置，应同时保留差异记录并上报/交接；将该行为直接判为完全正确会漏教闭环。 |
| `M4_TF_020` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M4_TF_020_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”。 |
| `M4_TF_021` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M4_TF_021_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”。 |
| `M4_TF_022` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M4_TF_022_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”；缺货标注后仍需按流程报告，不能只标注后继续。 |
| `M5_DG_033` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M5_DG_033_V2` / v2 | 隔离危险区只能在确保自身安全时进行；部分隐患应先撤离并立即报警/上报。当前把所有隐患套入单一固定顺序过于绝对；当前漏标安全敏感，应增加安全标记并进入安全复核。 |
| `M5_DG_034` | RETURN_FOR_REVISION | RETURN_FOR_REVISION | RETURN_FOR_REVISION | REVISION_REQUIRED | `M5_DG_034_V2` / v2 | 顾客晕倒流程缺少呼叫急救电话/受训急救员、AED和现场安全判断，不能只等负责人到场；当前漏标安全敏感，应增加安全标记并进入安全复核。；顾客晕倒流程仅呼叫同事和负责人后等待，缺少确认环境安全、呼叫急救/120、观察意识与呼吸、取得AED或由受训人员急救等关键动作。；应急流程不完整，且“等待负责人”不能替代紧急医疗响应。需按门店应急预案和急救培训权限设置分支。 |
| `M5_DG_035` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M5_DG_035_V2` / v2 | 求助顺序不合理，应先找到正确负责人，再说明问题、已采取措施和所需支持，最后确认交接。；采用 i2 → i1 → i3；将 i3 改为“复述确认并执行指示”；即时安全风险须先采取本人权限内的现场控制措施。 |
| `M5_DG_036` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M5_DG_036_V2` / v2 | 地面水渍不能仅归为“自己处理”，应先警示隔离并通知清洁/负责人；顾客晕倒也需急救呼叫而非只上报负责人；当前漏标安全敏感，应增加安全标记并进入安全复核。 |
| `M5_DG_037` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M5_DG_037_V2` / v2 | 当前漏标安全敏感，应增加安全标记并进入安全复核。 |
| `M5_DG_038` | RETURN_FOR_REVISION | RETURN_FOR_REVISION | RETURN_FOR_REVISION | REVISION_REQUIRED | `M5_DG_038_V2` / v2 | 玻璃碎片处置缺少PPE、同步上报和最终复查；“清理后再报告”不是通用安全流程；当前漏标安全敏感，应增加安全标记并进入安全复核。；玻璃碎片流程缺少防割手套/封闭鞋、硬质容器处置和细小碎片复查，单靠扫把铲子仍有割伤风险。；标准流程应包括警戒隔离、上报、佩戴PPE、专用工具清理、硬质容器封存、复查和解除警戒。 |
| `M5_OP_040` | RETURN_FOR_REVISION | RETURN_FOR_REVISION | RETURN_FOR_REVISION | REVISION_REQUIRED | `M5_OP_040_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点；搬运评分只看“腰背挺直、用腿发力”不足；还需评估重量、贴近身体、避免扭转、放置路线及是否需要两人/工具。；仅规定8–10kg和“腰背挺直、用腿发力”，未评估个人能力、握持、路线、扭转、贴近身体或求助条件，可能诱发搬运伤。；搬运评分锚点过于单一；应增加先评估重量、必要时求助/使用工具、负荷贴近身体、避免扭转和稳定放下。 |
| `M5_OP_041` | RETURN_FOR_REVISION | RETURN_FOR_REVISION | RETURN_FOR_REVISION | REVISION_REQUIRED | `M5_OP_041_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点；召回流程缺少核对通知、停售隔离标识、清点记录和上报闭环。；召回题未要求先核对召回通知中的商品名称、规格、条码和批次，也未要求隔离标识与数量交接，可能造成漏下架、错下架或召回商品重新流入销售区。；召回处置缺少核对商品名称、规格、批次/条码、召回范围、隔离标识、数量记录和上报交接，可能误下架或漏下架。 |
| `M5_OP_042` | RETURN_FOR_REVISION | RETURN_FOR_REVISION | RETURN_FOR_REVISION | REVISION_REQUIRED | `M5_OP_042_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点；玻璃碎片流程缺少PPE、上报、检查残留碎片和模拟物控制；不能把清理动作仅简化为扫把铲子。；玻璃碎片“全流程”未要求使用防护手套、扫帚簸箕、硬质专用容器、区域复查和确认无残留，可能遗留割伤风险或诱导不安全清理。；题干称“全流程”，评分只检查警示、隔离和非徒手清理，未评分碎片容器处置、区域复查、报告和解除警戒。 |
| `M5_OP_043` | RETURN_FOR_REVISION | RETURN_FOR_REVISION | PASS | REVISION_REQUIRED | `M5_OP_043_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点。；使用真实“松动支架”作为实操道具，若货架带载或可倾倒，会在评估中制造坍塌风险；应使用固定牢靠的视觉模拟缺陷。 |
| `M5_OP_044` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M5_OP_044_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点；当前漏标安全敏感，应增加安全标记并进入安全复核。 |
| `M5_OP_045` | RETURN_FOR_REVISION | RETURN_FOR_REVISION | RETURN_FOR_REVISION | REVISION_REQUIRED | `M5_OP_045_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点；疏散题必须引用学校/门店固定应急预案、集合点和评估员停止机制，不能临场让受测者承担未授权的顾客疏导职责。；要求学员在报警后承担“疏导顾客”但未规定不延误自身撤离、最近安全出口、集合点和禁止返回，可能造成滞留风险。；疏散SOP不完整；应按门店预案明确报警、停止作业、就近引导、不得使用电梯、到集合点报到及不擅自返回。 |
| `M5_OP_046` | RETURN_FOR_REVISION | RETURN_FOR_REVISION | RETURN_FOR_REVISION | REVISION_REQUIRED | `M5_OP_046_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点；三种隐患的处置边界不同：水渍可警示并通知清洁；梯子可在安全时归位；尖角不得自行维修。rubric需分别写明。；水渍、未归位梯子和破损尖角需要不同处置，笼统要求“逐一处置或上报”可能诱导学员徒手处理尖角或搬动不安全梯具。；缺少每类隐患的唯一达标行为、处置顺序和安全边界，无法稳定评分。 |
| `M5_OP_047` | RETURN_FOR_REVISION | RETURN_FOR_REVISION | RETURN_FOR_REVISION | REVISION_REQUIRED | `M5_OP_047_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点；面对超高堆放应先隔离、评估稳定性并寻求协助，不能要求受测者直接搬动可能倒塌的货物。；直接要求学员拆解超高堆放，未先隔离、判断稳定性/重量或安排协助，可能触发货物坠落。；真实流程应先停止靠近并隔离，确认可安全搬移后从上到下逐件处理，重物或失稳堆垛必须求助。 |
| `M5_OP_048` | REJECTED | RETURN_FOR_REVISION | RETURN_FOR_REVISION | REJECTED | 不进入候选 | 该题为非预告且不计分的隐蔽助人观察，评分对象和岗位行为边界不稳定。建议移出正式题库，另作经授权的补充观察。 |
| `M5_OP_049` | RETURN_FOR_REVISION | RETURN_FOR_REVISION | RETURN_FOR_REVISION | REVISION_REQUIRED | `M5_OP_049_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点；应区分受训急救员与普通员工；普通员工避免血液接触并呼救，受训人员可在PPE下实施急救。当前“一律不自行处理”过于笼统。；“不自行处理伤口”过于绝对，可能导致持续出血无人控制；正确做法应避免徒手接触血液，同时立即呼救并由受训人员戴手套实施急救。；题目没有区分受训急救员与普通员工，也未设置紧急呼叫、严重出血控制、PPE和污染物处置流程。 |
| `M5_OP_050` | RETURN_FOR_REVISION | RETURN_FOR_REVISION | RETURN_FOR_REVISION | REVISION_REQUIRED | `M5_OP_050_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点。；工具只写“4处安全隐患”而未列明类型和模拟方式，无法确认是否会使用真实湿滑、尖锐、带电或失稳风险。；隐患内容、正确处置和评分锚点均不具体，不能实际复现或一致评分。 |
| `M5_OP_051` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M5_OP_051_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点；当前漏标安全敏感，应增加安全标记并进入安全复核。 |
| `M5_OP_052` | RETURN_FOR_REVISION | RETURN_FOR_REVISION | RETURN_FOR_REVISION | REVISION_REQUIRED | `M5_OP_052_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点；评分候选最高分为2，但指标写成1+2+2=5分，数据合同冲突；“奇怪噪声”也需明确停止作业、隔离和报告边界；当前漏标安全敏感，应增加安全标记并进入安全复核。；“货架出现奇怪噪声”可能意味着结构失稳；若只执行通用求助脚本而未立即停工、隔离和远离，存在倒塌风险。；情境应先考查停止作业和隔离，再考查说明问题、找到负责人和交接；当前脚本顺序不完整。 |
| `M5_OP_053` | RETURN_FOR_REVISION | RETURN_FOR_REVISION | PASS | REVISION_REQUIRED | `M5_OP_053_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点；“一台无说明的新设备正在运行”风险类型、距离和正确动作不明确，难以标准化且可能诱导靠近真实设备。；在评估区放置“正在运行且无说明的新设备”会制造真实机械/电气风险；应改为断电道具、图片或视频模拟。 |
| `M5_OP_054` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M5_OP_054_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点；评分候选最高分为2，但指标写成总分5分，必须统一计分结构；退款情境还需固定顾客台词和升级边界。 |
| `M5_OP_055` | REJECTED | PASS | RETURN_FOR_REVISION | REJECTED | 不进入候选 | 该题用故意含糊指令进行非预告观察且不计分，受评估员表演和受测者关系影响较大，不宜作为正式岗位题。 |
| `M5_SC_003` | RETURN_FOR_REVISION | RETURN_FOR_REVISION | RETURN_FOR_REVISION | REVISION_REQUIRED | `M5_SC_003_V2` / v2 | 让理货员直接制止吸烟者可能引发冲突。应先远离火源风险、立即通知负责人/安保并按门店消防流程处置；只有在确保自身安全时才口头提醒；当前漏标安全敏感，应增加安全标记并进入安全复核。；要求理货员直接当面制止仓库吸烟者可能引发冲突；应优先远离火源并通知负责人/安保，必要时启动消防处置。；“立即上报”正确，但是否直接劝阻取决于门店权限和现场安全，当前答案把两者强制捆绑，不是唯一安全流程。 |
| `M5_SC_004` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M5_SC_004_V2` / v2 | 当前漏标安全敏感，应增加安全标记并进入安全复核。 |
| `M5_SC_005` | RETURN_FOR_REVISION | PASS | RETURN_FOR_REVISION | REVISION_REQUIRED | `M5_SC_005_V2` / v2 | 当前漏标安全敏感，应增加安全标记并进入安全复核。；硬币属于现金和失物管理范围，理货员不应在无见证/无交接的情况下自行拾取放到收银台；应先警示并通知收银员按现金遗失流程处理。 |
| `M5_SC_006` | RETURN_FOR_REVISION | RETURN_FOR_REVISION | RETURN_FOR_REVISION | REVISION_REQUIRED | `M5_SC_006_V2` / v2 | 顾客晕倒的应急动作不应只停留在通知负责人。应先确认现场安全，立即呼叫急救/受训急救员，按门店程序取AED并避免随意移动，除非现场存在继续危险；当前漏标安全敏感，应增加安全标记并进入安全复核。；顾客晕倒的正确响应不能只停留在呼叫同事和负责人；需根据情况立即呼叫急救、检查意识和呼吸并由受训人员处置。；选项缺少完整且唯一的应急动作，容易把“等负责人”误当成足够处置。 |
| `M5_SC_007` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M5_SC_007_V2` / v2 | 召回应包含核对召回通知、立即停售下架、隔离标识、清点记录和上报。仅“全部下架并上报”不足以形成可执行闭环；当前漏标安全敏感，应增加安全标记并进入安全复核。 |
| `M5_SC_008` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M5_SC_008_V2` / v2 | 当前漏标安全敏感，应增加安全标记并进入安全复核。 |
| `M5_SC_010` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M5_SC_010_V2` / v2 | 当前漏标安全敏感，应增加安全标记并进入安全复核。 |
| `M5_SC_011` | APPROVED | PASS | PASS | APPROVED_UNCHANGED | `M5_SC_011` / v1 | 三类审核均通过，保留原题语义并保持 DRAFT。 |
| `M5_SC_012` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M5_SC_012_V2` / v2 | 当前漏标安全敏感，应增加安全标记并进入安全复核。 |
| `M5_SC_013` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M5_SC_013_V2` / v2 | 求助流程顺序表述不清。“先用话术说明再找到负责人”在现场无法执行；应先找到正确负责人，再简洁说明事实、已采取的控制措施和需要的支持。 |
| `M5_SC_014` | APPROVED | PASS | PASS | APPROVED_UNCHANGED | `M5_SC_014` / v1 | 三类审核均通过，保留原题语义并保持 DRAFT。 |
| `M5_SC_015` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M5_SC_015_V2` / v2 | “腰背挺直、用腿部力量”过于简化。真实搬运还需先评估重量、保持货物贴近身体、避免扭转，必要时用搬运工具或两人协作；当前漏标安全敏感，应增加安全标记并进入安全复核。 |
| `M5_SC_016` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M5_SC_016_V2` / v2 | 同事流血时应立即呼叫受训急救人员/急救电话并做好血液暴露防护；并非任何情况下都只能等待负责人。题目需区分受训与未受训员工的动作边界；当前漏标安全敏感，应增加安全标记并进入安全复核。 |
| `M5_SC_017` | RETURN_FOR_REVISION | RETURN_FOR_REVISION | RETURN_FOR_REVISION | REVISION_REQUIRED | `M5_SC_017_V2` / v2 | 理货员不能仅凭“封口完好”向顾客保证“可以放心购买”。应客观说明外观检查结果，提供更换选择；涉及质量疑问时按门店流程请负责人处理；当前漏标安全敏感，应增加安全标记并进入安全复核。；理货员仅凭封口完好就向顾客保证“可以放心购买”，可能掩盖日期、储存、胀袋或其他异常，存在商品安全误导。；岗位可说明“封口未见破损”，但不应作安全保证；应核对日期与其他异常，顾客仍有疑虑时更换商品或请负责人处理。 |
| `M5_SC_018` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M5_SC_018_V2` / v2 | 安全隐患即使超出职责，也应在自身安全范围内先警示或隔离，再上报；“上报后等候”遗漏即时风险控制；当前漏标安全敏感，应增加安全标记并进入安全复核。 |
| `M5_SC_019` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M5_SC_019_V2` / v2 | 题干引号混乱。可直接读取包装产地并如实回答，但应避免把包装标注的“产地/生产商地址”混为一谈。 |
| `M5_SC_020` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M5_SC_020_V2` / v2 | 当前漏标安全敏感，应增加安全标记并进入安全复核。 |
| `M5_TF_021` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M5_TF_021_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”。 |
| `M5_TF_022` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M5_TF_022_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”。 |
| `M5_TF_023` | RETURN_FOR_REVISION | RETURN_FOR_REVISION | RETURN_FOR_REVISION | REVISION_REQUIRED | `M5_TF_023_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”；顾客晕倒流程缺少急救电话、受训急救员和AED等关键动作。；视频把呼叫同事和负责人、提醒不移动作为完整正确做法，遗漏急救呼叫、意识/呼吸观察和受训人员响应。；该行为只能算初始动作，不能直接判为完整正确应急流程。 |
| `M5_TF_024` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M5_TF_024_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”。 |
| `M5_TF_025` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M5_TF_025_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”；当前漏标安全敏感，应增加安全标记并进入安全复核。 |
| `M5_TF_026` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M5_TF_026_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”。 |
| `M5_TF_027` | RETURN_FOR_REVISION | RETURN_FOR_REVISION | RETURN_FOR_REVISION | REVISION_REQUIRED | `M5_TF_027_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”；玻璃清理必须包含报告、PPE和残留复查；不能只强调无需等待负责人。；玻璃碎片处置只强调警示牌和专用工具，未体现PPE、硬质容器、细碎片复查和上报，答案判“正确”会漏教关键防割措施。；未等待负责人可以合理，但必须完成门店规定的报告、碎片封存和区域复查，现素材不足以判为完整合规。 |
| `M5_TF_028` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M5_TF_028_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”。 |
| `M5_TF_029` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M5_TF_029_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”。 |
| `M5_TF_030` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M5_TF_030_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”。 |
| `M5_TF_031` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M5_TF_031_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”。 |
| `M5_TF_032` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M5_TF_032_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”。 |
| `M6_DG_027` | RETURN_FOR_REVISION | RETURN_FOR_REVISION | RETURN_FOR_REVISION | REVISION_REQUIRED | `M6_DG_027_V2` / v2 | 酸奶被映射到饮品区，实际通常应进入冷藏乳品/冷链区。需新增冷链区并修正答案；当前漏标安全敏感，应增加安全标记并进入安全复核。；把酸奶归入普通饮品区可能造成冷链中断，存在食品安全风险。；酸奶应根据标签存放于冷藏区；除非明确为常温酸奶，否则答案不能与可乐同归普通饮品区。 |
| `M6_DG_028` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M6_DG_028_V2` / v2 | 题目要求商品图片，但当前未绑定4张图片。需锁定图片内容、背景和尺寸，并避免图片文字直接泄露分类。 |
| `M6_DG_029` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M6_DG_029_V2` / v2 | 题目要求5张商品图片，但当前未绑定素材。需建立一项一图、类别唯一的资产清单。 |
| `M6_DG_030` | APPROVED | PASS | RETURN_FOR_REVISION | REVISION_REQUIRED | `M6_DG_030_V2` / v2 | 题干、岗位口径、答案/映射和施测条件一致，可进入下一轮安全与技术审核。；“扫码确认”和“翻看文字确认”不是互斥类别：中文包装也可扫码，外文包装也可能可读；应按条码是否可用、系统是否有商品资料和文字是否可识别设计分支。 |
| `M6_DG_031` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M6_DG_031_V2` / v2 | 题目依赖货架照片/卡片场景，需绑定每项唯一图片并保证区域标识清楚、每图只有一个判断点。 |
| `M6_DG_032` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M6_DG_032_V2` / v2 | 近邻商品配对依赖4张具体图片，当前无资产。需锁定图片顺序和可辨别文字/规格，避免凭颜色猜测。 |
| `M6_DG_033` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M6_DG_033_V2` / v2 | “整箱饼干”是否属于下层重货取决于实际重量和层板承重，不能仅凭名称判定。应标注重量或改用明确重物；当前漏标安全敏感，应增加安全标记并进入安全复核。 |
| `M6_OP_034` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M6_OP_034_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点。 |
| `M6_OP_036` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M6_OP_036_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点。 |
| `M6_OP_037` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M6_OP_037_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点。 |
| `M6_OP_038` | RETURN_FOR_REVISION | PASS | RETURN_FOR_REVISION | REVISION_REQUIRED | `M6_OP_038_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点；必须提供能返回固定品名的离线扫码设备/数据库，并定义扫码失败时的替代流程。；普通扫码器只返回条码数字，不能自动显示品名；工具清单缺少连接商品数据库的终端/软件和已建档SKU。 |
| `M6_OP_039` | RETURN_FOR_REVISION | PASS | RETURN_FOR_REVISION | REVISION_REQUIRED | `M6_OP_039_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点；“说出/指出/写出”只能表达分类判断，不等同于把实物归位；题干和允许通道需拆开设计。；允许用扫码完成归区，但工具只写“扫码设备”，未说明商品数据库、显示终端和品类字段，扫码通道不可实际执行。 |
| `M6_OP_040` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M6_OP_040_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点。 |
| `M6_OP_041` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M6_OP_041_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点。 |
| `M6_OP_042` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M6_OP_042_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点。 |
| `M6_OP_043` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M6_OP_043_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点。 |
| `M6_OP_044` | RETURN_FOR_REVISION | PASS | RETURN_FOR_REVISION | REVISION_REQUIRED | `M6_OP_044_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点；指标一要求10件全部完成，指标二又允许±1件，达标标准冲突；2分钟阈值也缺少岗位依据。；题干和指标要求10件全部正确，备注却允许±1件，满分/达标标准互相冲突。 |
| `M6_OP_045` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M6_OP_045_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点；需固定模拟工作日、日期格式、答案键和是否允许计算工具；仅“识别到期日”不应混入未声明的日期计算。 |
| `M6_OP_046` | RETURN_FOR_REVISION | RETURN_FOR_REVISION | RETURN_FOR_REVISION | REVISION_REQUIRED | `M6_OP_046_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点；冷链题应使用仿真空包装或图片卡，避免真实冷链商品离开温控；并明确冷藏与冷冻分区；当前漏标安全敏感，应增加安全标记并进入安全复核。；把真实冷链商品预先混放在常温商品中会造成温控失效；实操必须使用空包装/图片卡或全程在受控温度内完成。；“冷链区”未区分冷藏和冷冻，三件商品的具体储存条件也未列出，无法唯一归位。 |
| `M6_OP_047` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M6_OP_047_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点；当前漏标安全敏感，应增加安全标记并进入安全复核。 |
| `M6_OP_048` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M6_OP_048_V2` / v2 | 当前0/1/2分仅写“未能完成/部分完成/完全达标”，不同评分人无法稳定判定；必须改成与每个观察指标对应的具体锚点；破损商品可能涉及泄漏或割伤，需增加隔离、PPE和停止条件，不能只写“放入问题区”；当前漏标安全敏感，应增加安全标记并进入安全复核。 |
| `M6_SC_001` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M6_SC_001_V2` / v2 | 题干括号已直接写出“一袋薯片”，图片识别失去测量意义；同时未绑定图片。应删除文字泄题并绑定唯一商品图。 |
| `M6_SC_002` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M6_SC_002_V2` / v2 | 题干括号已直接写出“一瓶洗发水”，图片识别失去测量意义；应删除括号提示并绑定唯一素材。 |
| `M6_SC_004` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M6_SC_004_V2` / v2 | 题干括号已直接写出“一瓶酱油”，直接泄露商品类别；应依赖清晰图片或改成纯文本分类题。 |
| `M6_SC_005` | APPROVED | PASS | PASS | APPROVED_UNCHANGED | `M6_SC_005` / v1 | 三类审核均通过，保留原题语义并保持 DRAFT。 |
| `M6_SC_006` | RETURN_FOR_REVISION | PASS | RETURN_FOR_REVISION | REVISION_REQUIRED | `M6_SC_006_V2` / v2 | 答案取决于具体条形码图片，当前未绑定唯一素材和可读区域。必须锁定图片、分辨率、号码及答案，且不得用可扫描真实商品码造成外部依赖。；选项中的13位条码校验位均不符合EAN-13规则，且答案依赖未绑定的图片资产；应使用有效条码并固定素材版本。 |
| `M6_SC_007` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M6_SC_007_V2` / v2 | “左/右”答案完全依赖具体对比图，当前未绑定素材。必须锁定图片顺序、包装文字可读性和不泄题的裁切范围。 |
| `M6_SC_008` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M6_SC_008_V2` / v2 | 题目问判断方法，图片并非必要；若保留图片，需绑定两件商品并确保日期标签可见。当前“图片中的”与无素材状态不一致。 |
| `M6_SC_010` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M6_SC_010_V2` / v2 | 题干引号异常，应改为“以下哪件商品不属于洗护区，是被错放的商品？”。 |
| `M6_SC_011` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M6_SC_011_V2` / v2 | 答案取决于货架照片，当前未绑定唯一素材。需锁定货架区域标识、三件商品位置和错放项。 |
| `M6_SC_013` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M6_SC_013_V2` / v2 | “最快”取决于现场是否有可用扫码设备及系统数据库。应改为“有扫码设备时优先扫码；无设备时核对品名、规格和条形码数字”。 |
| `M6_SC_014` | APPROVED | PASS | PASS | APPROVED_UNCHANGED | `M6_SC_014` / v1 | 三类审核均通过，保留原题语义并保持 DRAFT。 |
| `M6_TF_015` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M6_TF_015_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”。 |
| `M6_TF_016` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M6_TF_016_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”。 |
| `M6_TF_017` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M6_TF_017_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”。 |
| `M6_TF_018` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M6_TF_018_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”。 |
| `M6_TF_019` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M6_TF_019_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”。 |
| `M6_TF_020` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M6_TF_020_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”；当前漏标安全敏感，应增加安全标记并进入安全复核。 |
| `M6_TF_021` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M6_TF_021_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”。 |
| `M6_TF_022` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M6_TF_022_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”。 |
| `M6_TF_023` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M6_TF_023_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”。 |
| `M6_TF_024` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M6_TF_024_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”。 |
| `M6_TF_025` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M6_TF_025_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”。 |
| `M6_TF_026` | RETURN_FOR_REVISION | PASS | PASS | REVISION_REQUIRED | `M6_TF_026_V2` / v2 | 题干写“图中理货员”，素材说明却是视频；应统一为“观看视频，判断该做法是否符合门店规范”。 |
