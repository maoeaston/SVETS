# 岗位题库合同链修复与强绑定实施计划

**状态：** 历史实施记录；当前入口见 `doc/features/job-skill-shelver-current-contracts.md`。阶段四统一激活门禁与 DRAFT seed 接线已完成，因 Pilot 独立门禁和270项资产未交付而保持失败关闭  
**日期：** 2026-07-20  
**适用范围：** 超市理货员 298 道来源题、Pilot 24 题、Full Product 候选、视觉资产和线下工具包  
**上位合同：** `doc/specs/MVP_PRD_v1.0.9-authoritative.md`

## 1. 目标

停止“修改题目 → 全量审核 → 再修改 → 再审核”的循环，把当前分散的题目、答案、视觉资产、线下采购和运行库导入连接成一条单向、可验证、失败关闭的合同链。

完成后必须满足：

1. 298 道原始来源中的每一道都只有一个可追溯去向：Pilot、原样保留、修订版本、淘汰或阻断。
2. 运行库 SQL 和内容包只能从当前权威集生成，不能继续读取旧 298 快照直接 seed。
3. 题意变化与交付绑定变化分开判断；只有题意、答案、评分或安全边界变化才触发人工复审。
4. 68 道视频题的锁定答案、13 道图片需求和 89 道保留线下题的工具配置可被机器交叉验证。
5. 任何来源、答案、工具、素材或 hash 漂移都会使检查失败，不允许“期望值和实际值一起变化后继续通过”。

## 2. 不在本计划内

- 不在合同未通过前激活题目或写入正式运行库。
- 不重新审核全部 211 道退回题。
- 不重新设计已经存在的 100 道线下工具采购方案。
- 不在本阶段生产全部图片和视频文件；先冻结答案和生产合同，再按合同生产。
- 不新增题库运营后台、公共 rubric 表或新的微服务。
- 不把实物采购编号伪装成 `asset_resource.asset_id`。

## 3. 当前事实基线

### 3.1 题目集合

- 原始来源：298 道。
- Pilot：24 道，其中线下题 6 道。
- 非 Pilot 审核范围：274 道。
- 首轮结论：31 道原样保留、232 道修订、11 道淘汰。
- 232 道修订候选复审：21 道双审通过、211 道退回。
- 保留线下题：83 道 Full Product 候选 + 6 道 Pilot，共 89 道。
- 89 道线下题模块计数必须为：M1 14 道，M2-M6 各 15 道。

### 3.2 已存在但未接通的合同

- `doc/assets/asset-manifest.json`：当时为 237 个视觉资产交付项；当前生产合同已由 `doc/assets/asset-manifest.json` v0.5.0 取代，统一为 270 项 planned 资产并绑定当前运行时题号。
- `doc/reference/offline-toolkit-procurement-spec.md`：v2.1，覆盖原始 100 道线下题的共享工具包。
- `doc/features/job-skill-shelver-298-question-revision-candidates-v1.json`：83 道线下候选全部已有 `offline_tool_brief` 和 `rubric_criteria`。
- 当前有效机器绑定仍为 0/89：线下候选 `tool_asset_ids` 为空，G 类工具卡也没有当前题号反向索引。

### 3.3 当前链路断点

1. `scripts/question-bank-import.mjs` 和 `doc/features/question-bank-import.sql` 仍消费旧 298 快照，不消费候选和复审结果。
2. `scripts/lib/database-content-pack.mjs` 从同一份 SQL 同时导出参考值和实际值，存在 false-green。
3. 复审 HTML 可以导出 JSON，但当前接收脚本重新解析 Markdown，审核原件链不唯一。
4. `candidate_record_hash` 混入状态和审核说明，不能判断运行语义是否改变。
5. `tool_asset_ids_json`、`presentation.assets`、`administration.*_asset_id` 没有统一扫描和 hash 门禁。
6. manifest Schema 允许空 `question_ids`，Schema 通过不代表跨文件绑定成立。
7. `asset_resource` seed 允许相同 ID 覆盖不同 hash，违反已引用资产不可变规则。

## 4. 选定架构

```text
不可变 298 来源快照
        +
Pilot 当前题目权威
        +
审核 JSON 原件与结构化修订补丁
        ↓
298 来源去向权威集 + semantic_hash
        +
视觉 asset-manifest
        +
线下 offline-toolkit-manifest
        ↓
确定性合同解析器
        ↓
question-delivery-lock
        ↓
审核包 / 素材生产 / question-bank-import.sql / content pack / renderer
```

所有箭头只允许向下生成。审核包、Markdown、SQL、内容包和运行库都属于下游产物，不得反向成为题目或答案的事实源。

## 5. 合同职责

### 5.1 题目语义权威

题干、选项、正确答案、逐题 rubric、安全边界和终止条件组成 `semantic_hash`。审核状态、文件路径、素材 hash、生成时间和说明文字不得进入 `semantic_hash`。

规则：

- `semantic_hash` 不变：属于交付绑定，不创建新题版本，不触发内容复审。
- `semantic_hash` 改变：创建新 question ID，只有受影响题进入对应专业复审。
- 正确答案只以 `scoring_rule_json` 为事实源；manifest 中的 `expected_answer` 只作生产交叉校验。

### 5.2 线下实物合同

新增 `doc/assets/offline-toolkit-manifest-v1.json` 及 Schema，保存：

- 工具包版本和采购规格 hash。
- 实物编号、类别、数量、安全属性、可替代规则和场景包。
- 89 道保留线下题各自唯一的 `setup_id`。
- 每个 setup 的实物编号、数量、初始状态、摆位、复位规则和公开教师说明。
- 预埋差错、召回标记、日期答案键等密封配置引用。

题目 `content_json` 新增 `offline_setup` 结构块，只保存 `setup_id`、`kit_id` 和必需实物引用。`offline_tool_brief` 继续作为教师可读摘要，但不再是机器绑定权威。

### 5.3 文件资产合同

- `tool_asset_ids_json` 只保存工具清单、流程条、工具卡、说明 PDF 等 `asset_resource` 文件 ID。
- `administration.script_asset_id` 保存角色扮演脚本资产 ID。
- `administration.sealed_config_asset_id` 保存预埋差错和施测实例 JSON 资产 ID。
- 实物编号保存在 offline toolkit manifest，不进入 `asset_resource`。
- 题目侧引用是正向权威；manifest 的 `question_ids` 只是反向索引，两者必须交叉一致。

### 5.4 密封配置权限

MVP 将“记录员”映射为 `ADMIN`：

- TEACHER 只能看到公开工具清单、复位说明、rubric 和安全停止条件。
- `SEALED_ADMIN_CONFIG` 不允许通过通用 `app://asset` 读取。
- ADMIN 通过独立、受鉴权 IPC 读取密封配置。
- 该决定写回 PRD，后续如果新增记录员角色，再单独迁移权限，不改变资产合同。

### 5.5 资产命名

统一采用已经被 manifest 和运行时支持的 `asset_[a-z0-9_]+`。修订 PRD 中尚未落地的 `AST_JOB_*` 示例，不建立双命名体系，也不批量重命名已有资产。

## 6. 线下工具包 v2.2 固定决策

实施时基于 v2.1 发布 v2.2，只修兼容性差异，不重做采购规划：

1. 日期商品权威集合固定为 `G01-G12 + G15-G16` 共 14 件；开箱清单同步修正。
2. `G01` 当天到期：未过期，但进入当日临期处置集合；题干、答案键和页尾统计统一该口径。
3. 题目中的“真实印刷日期”统一改为“固定模拟日期标签”；20 道日期题进入一次定点复审。
4. 为 `M6_OP_037` 增配近邻商品副本，为 `M6_OP_043` 配齐大/中/小各 2 件；不降低题目数量要求。
5. 增加 2 件冷链模拟商品，形成 3 件可唯一判断的冷藏/冷冻样品，并补冷藏、冷冻区域标签。
6. 为 `M4_OP_038` 和 `M6_OP_044` 固定品类分布；优先复用现有 G 商品，缺少的包装使用安全空包装补齐。
7. `M6_OP_038/039` 使用本地 JSON SKU 映射和固定扫码返回；扫码失败提供纸面编号查找作为技术故障替代，不改变评分答案。
8. 增加实体安全开箱刀和防割手套；工具卡不能代替实体 PPE。
9. `M3_OP_053`、`M6_OP_044` 删除沙漏要求，统一使用软件可视计时。
10. 为背景音、疏散信号和异常噪声增加 AUDIO 资产类型与固定音量/时长合同。
11. 4 道示例图题各绑定一张唯一答案图：`M1_OP_043`、`M4_OP_034`、`M6_OP_040`、`M6_OP_047`。
12. 13 道角色/中断题各生成唯一脚本，包含逐字台词、允许回应、提示等级、停止条件和评分答案键。
13. 增加 3 件召回标记、召回通知和密封答案键，供 `M5_OP_041` 使用。
14. `M5_OP_046` 使用钝边破损角仿真卡和“未归位踏脚凳”场景，不使用真实尖角或梯子。
15. `M5_OP_053` 使用断电设备外壳或设备图片卡，不使用真实运行设备。
16. 锁定 D02 凹陷位置/程度、D04 正常品身份和 D05 包装形态；修正 `M3_OP_058` 的问题品计数。
17. 外箱和随箱文件版本统一改为 v2.2。

## 7. 分阶段实施

每个阶段必须独立可合并；任何阶段停止后，仓库都不能比实施前更容易误用旧数据。

### 阶段一：建立来源权威和失败关闭门禁

**实施状态：已完成（2026-07-20）**

**目的：** 先阻断旧 298 SQL 继续伪装成当前题库。

新增：

- `doc/features/job-skill-shelver-298-source-manifest-v1.json`
- `doc/features/job-skill-shelver-298-disposition-authority-v1.schema.json`
- `doc/features/job-skill-shelver-298-disposition-authority-v1.json`
- `scripts/build-job-skill-shelver-298-authority.mjs`
- `scripts/verify-job-skill-shelver-contract-chain.mjs`
- `scripts/__tests__/job-skill-shelver-contract-chain.test.mjs`

修改：

- `scripts/build-job-skill-shelver-298-revisions.mjs`
- `scripts/build-job-skill-shelver-298-rereview-results.mjs`
- 两份复审结果 Schema
- `package.json`

固定命令：

- `npm run contract:job-skill:build`
- `npm run contract:job-skill:check`

验收：

- 24 Pilot + 274 非 Pilot 精确覆盖 298 个原始 ID，重复和遗漏均为 0。
- 31 原样、232 修订、11 淘汰可从原件复算。
- 复审 JSON、合并结果和候选集均绑定来源文件 SHA-256。
- 任意来源改一个字节，`contract:job-skill:check` 非零退出。
- 211 道仍退回时，authority 可以生成但 `releaseable=false`；SQL 和运行库不得被修改。

阶段一实际结果：

- 新权威精确登记 298 条来源去向：24 Pilot、31 原样保留、21 修订复审通过、211 修订退回、11 淘汰。
- 当前保留题总数 287；`releaseable=false`、`may_generate_runtime_sql=false`。
- `semantic_root_hash` 与 `authority_hash` 已生成，历史候选文件保持字节和 candidate hash 不变。
- 两份复审结果 Schema 已补齐 `source_files`、分组汇总和逐题备注字段，接收状态改为准确的 `INGESTED_REVIEWER_MARKDOWN`。
- focused 18 tests、typecheck、lint、全量 59 files / 702 tests 均通过；lint 为 0 error / 175 个既有 warning。

### 阶段二：建立视觉与线下交付合同

**实施状态：已完成（2026-07-20）**

**目的：** 把“已经规划”变成可逐题解析的机器合同。

新增：

- `doc/assets/offline-toolkit-manifest-v1.schema.json`
- `doc/assets/offline-toolkit-manifest-v1.json`
- `doc/features/job-skill-shelver-question-delivery-lock-v1.schema.json`
- `doc/features/job-skill-shelver-question-delivery-lock-v1.json`
- `scripts/build-job-skill-shelver-delivery-lock.mjs`
- `scripts/__tests__/job-skill-shelver-delivery-lock.test.mjs`

修改：

- `doc/reference/offline-toolkit-procurement-spec.md`，升级为 v2.2。
- `doc/assets/asset-manifest.schema.json`
- `doc/assets/asset-manifest.json`
- `scripts/build-visual-asset-manifest.mjs`
- `src/shared/types/json-schemas.ts`
- `src/main/utils/validate-content-json.ts`
- 对应单元测试。

验收：

- 89 道保留线下题全部且仅绑定一个 setup；模块计数为 14/15/15/15/15/15。
- 89 道与 11 道淘汰题交集为 0；其中 10 道 OP 和 1 道 OB 的去向均可追溯。
- 68 道视频题 expected answer 与 `scoring_rule_json` 一致。
- 13 道图片需求都有明确生产合同；4 道示例图题各有唯一答案图合同。
- 20 道日期题、13 道脚本题和安全材料题的固定计数断言通过。
- 资产或实物反向索引与题目正向引用不一致时检查失败。

阶段二实际结果（截至 2026-07-22 已由当前合同修订）：

- `offline-toolkit-manifest-v1` 登记22类共享实物/文件/软件项目，并为100道线下实操题各生成唯一 setup；模块分布为16/15/16/21/17/15。
- `question-delivery-lock-v1` 锁定181道唯一题目：100道线下 setup、68道视频答案、13道线上图片需求；另在线下题内绑定4张唯一答案图、13份唯一施测脚本和3个音频合同。
- 68个视频答案均从当前候选内容复算并与既有视频资产 `expected_answer` 一致；17张答案图均携带逐题 `answer_contract_hash`，生产时必须按答案反推画面。
- 日期题固定为20道，其中包含 Pilot `M3_OP_043_V2`；采购规格升级为v2.2，修正日期编号、当天到期口径、近邻/规格副本、冷链、离线扫码、PPE、召回、安全仿真、软件计时、音频、脚本和示例图差异。
- `asset-manifest` 升级到v0.5.0，共270项：231个 A-G 资产 + 33个 DELIVERY 资产 + 6个核心参考资产；全部仍为 `planned`，本阶段没有声称素材已生产或批准。
- 新增 `contract:job-skill:delivery:build/check`；交付锁保持 `releaseable=false`，没有修改运行库或生成激活SQL。
- 阶段二 focused 39 tests、typecheck、lint和全量60 files / 711 tests通过；lint为0 error / 175个既有warning。

### 阶段三：生成定点 V3 修订和最小复审包

**实施状态：V6内容复审结果已接收（2026-07-20）；完整145题全部通过，阶段四可以开始但尚未执行**

**目的：** 只修真实语义冲突，不再把绑定工作伪装成题目改写。

新增：

- `doc/features/job-skill-shelver-298-revision-patches-v2.json`
- `doc/features/job-skill-shelver-298-question-revision-candidates-v3.json`
- 自包含的定点复审 HTML、审核结果 Schema 和 JSON 原件。

修改：

- `scripts/build-job-skill-shelver-298-revisions.mjs`：改为消费结构化 patch，不再在脚本内写题目内容。
- `scripts/build-job-skill-shelver-298-rereview-packets.mjs`：只选择 `semantic_hash` 变化题。
- 相关 revisions、packets、results 测试。

规则：

- 纯素材、工具、路径和 hash 绑定保留当前题目 ID，不进入内容复审。
- 修改日期刺激口径、扫码行为、问题品计数、安全场景或评分边界的题创建 V3。
- 角色脚本如果不改变题干和评分边界，只做脚本专业确认；如果改变允许回应或评分行为，创建 V3。
- 审核人只能从 HTML 导出 JSON；Markdown 仅由 JSON 生成留档，不再作为机器接收源。

验收：

- V3 数量精确等于 `semantic_hash` 变化题数量。
- 未变化题创建 V3 时测试失败。
- 每道 V3 都绑定旧题 ID、旧/新 semantic hash、结构化 patch 和复审结论。
- 定点审核未通过时 `releaseable=false`，但已完成的交付绑定不作废。

阶段三实际结果：

- 211 道历史退回题重新按真实变更复算后，145 道需要 V3，66 道保留 V2。保留 V2 的题包括56道只缺视频绑定的判断题、9道只缺唯一图片/顺序/裁切合同的图片题，以及1道内容安全标记与安全专业结论不一致但无需改变实际安全边界的题。
- 145 道 V3 分布为：34道单选、12道视频判断、16道拖拽、83道线下实操；每道都绑定 V2 ID、旧/新 `semantic_hash`、结构化 patch 和审核路由。
- 定点V3审核原件已接收并通过集合、版本链和hash校验：陈晓青内容审核144道，通过8道、退回136道；赫东安全技术审核135道，通过19道、退回116道。
- 合并后137道被审核退回。另有4道内容审核通过的视频判断题被机器一致性检查阻断：题干规则、视频行为和 `expected_answer=true` 互相矛盾，且V3未将这类技术语义变化路由给安全技术复审。因此真正可保留V3的只有4道图片单选题，V4总范围为141道。
- V4按题型拆成30道单选、12道视频判断、16道拖拽和83道线下实操；普通退回题只回到退回轨道，4道合同冲突题补走内容与安全技术双轨。
- 141道V4已逐题生成，内容复审包覆盖140道，安全技术复审包覆盖120道；4道无冲突图片单选继续引用已通过V3，不复制为V4。V4门禁保持 `PENDING_REVIEW`、`releaseable=false`。
- V4审核人原件已逐字节固化：陈晓青140道内容复审（135通过、5退回），赫东120道安全技术复审（118通过、2退回）；Schema身份、集合、版本链、逐题语义hash、候选记录hash和汇总均通过校验。
- 12道视频判断题的题干规则、视频行为与预设答案一致，没有新增合同冲突；加入4道已通过V3引用后，完整145题中139题通过、6题退回。
- V5只覆盖 `M1_OP_037_V4`、`M1_OP_038_V4`、`M2_OP_031_V4`、`M2_OP_038_V4`、`M2_OP_041_V4`、`M5_DG_034_V4`，并只复审各自失败轨道；其余139题和阶段二交付锁保持不变。
- 6道退回意见已拆成场景事实、答案、权限、异常分支、评分阈值和安全动作，并写入 `job-skill-shelver-298-v5-editorial-input.json`；确定性生成器只接受上述6道及V4合并门禁给出的失败轨道。
- V5候选精确为5道线下实操和1道拖拽；内容失败轨道复审包5道，安全技术失败轨道复审包2道。139道通过题只保存hash引用，不复制、不升版、不重审。
- V5待审门禁为 `PENDING_FAILED_TRACK_REREVIEW`、`releaseable=false`、`phase_4_allowed=false`；阶段二交付锁、运行数据库和激活SQL保持不变。
- V5专项15项测试和全量65 files / 754 tests通过；typecheck、lint（0 error / 175个既有warning）、阶段一至V5合同检查、交付锁、资产合同、文档索引和diff检查均通过。
- V5审核人原件已逐字节固化：陈晓青内容复审5道（1通过、4退回，4769字节，SHA-256 `4577c7b88712dcd21ab7352651c5edb7f19e5cf9ce3fd01aa8e491768a25eab0`），赫东安全技术复审2道（2通过、0退回，1167字节，SHA-256 `27ccf836619c5f3008adf83fef32cc7e83ee8bf5b0551eedfb328134c80904aa`）。
- 两份V5结果的Schema身份、审核人、submitted_at、精确集合、版本链、逐题语义hash、候选记录hash和汇总均通过；`M1_OP_037_V5`与`M1_OP_038_V5`通过，另外4道仅内容轨道退回。
- V5合并门禁精确覆盖145道：139道既有通过题保持hash引用，2道V5新增通过，4道V5退回；逐题保留来源结果、审核意见、版本链、候选hash、语义hash、失败轨道、下一版题号和合并记录hash。
- V5门禁为 `COMPLETED_WITH_RETURNS`、`releaseable=false`、`phase_4_allowed=false`；只为4道实际退回题保留V6内容复审范围，运行数据库、激活SQL、阶段二交付锁和历史题目保持不变。
- V5结果接收专项12项测试和全量66 files / 766 tests通过；typecheck、lint（0 error / 175个既有warning）、阶段一至V5结果合同检查、交付锁、资产合同、文档索引和diff检查均通过。
- V6只覆盖 `M2_OP_031_V5`、`M2_OP_038_V5`、`M2_OP_041_V5`、`M5_DG_034_V5` 的内容退回意见；其余141道通过题继续引用V5合并记录，不复制、不升版、不重审。
- 3道线下题已把商品数量、状态、标签和中断脚本等评估设置异常移出学员0/1/2分，统一定义为本次施测无效、由评估员复位后重测；`M5_DG_034_V6`改为从发现顾客倒地开始排序完整四步，消除题干前置条件与拖拽卡重复。
- V6只生成陈晓青4道内容复审包，不生成安全技术复审包；待审门禁为 `PENDING_FAILED_TRACK_REREVIEW`、`releaseable=false`、`phase_4_allowed=false`，运行数据库、激活SQL、阶段二交付锁和历史题目保持不变。
- V6专项11项测试和全量67 files / 777 tests通过；typecheck、lint（0 error / 175个既有warning）、阶段一至V6合同检查、交付锁、资产合同、文档索引和diff检查均通过。
- V6审核人原件已逐字节固化：陈晓青内容复审4道全部通过（1864字节，SHA-256 `1595eee1bb27847d72126c7b52e10b32838a54f93db4caaa6d2f826b59d375d5`）。Schema身份、审核人、submitted_at、精确集合、版本链、逐题语义hash、候选记录hash和汇总均通过校验。
- V6合并门禁精确覆盖145道：141道既有通过题保持V5合并记录hash引用，4道V6新增通过；最终145道全部通过、0退回、0待审。
- V6门禁为 `PASSED`、`releaseable=true`、`phase_4_allowed=true`、`phase_4_executed=false`；运行数据库、激活SQL、阶段二交付锁和历史题目保持不变。
- V6结果接收专项12项测试和全量68 files / 789 tests通过；typecheck、lint（0 error / 175个既有warning）、阶段一至V6结果合同检查、交付锁、资产合同、文档索引和diff检查均通过。
- 内容复审包仅含144道；安全技术复审包仅含135道。`M5_DG_037_V3` 只走安全技术复审，纯交付题不进入任一复审包。
- 新增显式白名单语义投影，只包含题型、题干、选项/拖拽结构、有效答案、逐题 rubric、评分规则、安全敏感和停止条件；素材ID、工具ID、setup、文件路径和交付hash不参与升版判断。
- 两份审核包均为自包含HTML，支持本地自动保存、必填校验和JSON导出；未伪造审核结果JSON。当前待审核门禁为 `PENDING_REVIEW`、`releaseable=false`。
- 新增 `contract:job-skill:v3:build/check` 和定点V3测试；本阶段未改写阶段一 authority、阶段二 delivery lock、运行时SQL或数据库。

### 阶段四：接通运行库 seed 和统一激活门禁

**实施状态：已完成接线（2026-07-20）；真实激活与 session 创建继续关闭**

**目的：** 让运行库只消费通过的 authority 和 delivery lock。

修改：

- `scripts/question-bank-import.mjs`
- `scripts/lib/question-bank-import.mjs`
- `scripts/config/database-content-pack.json`
- `scripts/lib/database-content-pack.mjs`
- `scripts/lib/question-bank-review-gate.mjs`
- `scripts/review-question-bank.mjs`
- `scripts/lib/visual-asset-manifest.mjs`
- `scripts/seed-question-bank-image-assets.mjs`
- `src/main/domain/validators/question-validator.ts`
- `src/shared/types/json-schemas.ts`
- `src/main/db/schema.sql` 和迁移：只扩展资产角色，不新增表。
- 对应数据库、validator、review gate 和内容包测试。

新增资产角色：

- `ROLE_PLAY_SCRIPT`
- `SEALED_ADMIN_CONFIG`
- `OFFLINE_SETUP_GUIDE`

门禁必须扫描：

- `media_asset_id`
- `presentation.assets[]`
- 选项、拖拽项和 variant 素材
- `tool_asset_ids_json`
- `administration.script_asset_id`
- `administration.sealed_config_asset_id`

验收：

- import 默认输入改为 disposition authority + delivery lock，不再默认旧 298 快照。
- 内容包配置固定 authority SHA-256、delivery lock SHA-256 和预期 semantic root hash。
- SQL 被单独修改后，内容包验证失败。
- 相同 asset ID 遇到不同 hash 时 seed 失败，不覆盖旧文件事实。
- 任一引用缺失、非 ACTIVE、文件不存在、大小或 hash 不符时禁止激活和创建 session。
- authority `releaseable=false` 时构建命令不得覆盖现有 SQL。

阶段四实际结果：

- 新增 `job-skill-shelver-runtime-authority-v1`，精确覆盖298道来源题：287道保留为当前版本 DRAFT，11道淘汰题明确排除；145道由V6通过门禁解析，66道无语义变化题保留V2，21道沿用首轮复审通过版本，31道原样保留，24道Pilot继续服从独立门禁。
- 默认岗位题导入不再读取旧298快照，改为从运行权威和delivery lock确定性编译287道当前版本；`question-bank-import.sql`只包含DRAFT seed，不包含激活语句。
- 内容包固定运行权威、semantic root、delivery lock、统一激活门禁和岗位SQL的SHA-256；任一文件或SQL单独漂移都会在运行库写入前失败。
- 新增统一门禁 `job-skill-shelver-phase4-activation-gate-v1.json`：当前为 `BLOCKED_ASSET_DELIVERY_AND_PILOT_GATE`；允许编译DRAFT seed，但禁止生成激活SQL、激活题目和创建岗位测评session。
- 审核门禁和主进程validator已覆盖 `media_asset_id`、`presentation.assets[]`、选项/拖拽/zone/variant素材、`tool_asset_ids_json`、角色脚本、密封配置和offline setup资产；岗位session创建会再次拒绝缺失或非ACTIVE的引用资产。
- 资产seed遇到相同asset ID但不同file hash时事务失败，不再覆盖既有文件事实；新增三类资产角色及兼容迁移，没有新增表。
- 本阶段只生成DRAFT SQL和机器门禁，没有执行SQL、没有写真实数据库、没有生成激活SQL、没有修改阶段二delivery lock或历史题目。

### 阶段五：教师端公开配置与密封配置隔离

**目的：** 完成线下施测运行体验，同时满足密封答案权限。

修改：

- `src/main/protocol/app-asset.ts`
- `src/main/ipc/handlers/job-skill-scoring.ts`
- `src/shared/types/job-skill-scoring.ts`
- `src/renderer/src/components/OfflineOperationCard.vue`
- 对应 IPC、权限和组件测试。

验收：

- TEACHER 能看到工具摘要、公开摆位、rubric、安全停止条件和复位说明。
- TEACHER 不能通过 UI、IPC 或 `app://asset` 读取密封配置。
- ADMIN 可通过专用 IPC 读取与当前 question ID、version、setup hash 完全匹配的密封配置。
- 角色扮演题没有脚本、预埋差错题没有密封配置时不能开始施测。
- 6 道 Pilot 线下题完成真实 Electron 教师端和学生端见证后，证据写入 Pilot 门禁，不把自动测试冒充人工见证。

## 8. 验证矩阵

每阶段运行 focused tests，阶段五完成后运行全量验证：

```bash
npm run contract:job-skill:check
npm run typecheck
npm run lint
npm test
npm run docs:index:check
git diff --check
```

关键负向测试：

1. 改动来源文件一个字节，所有下游检查失败。
2. 改题干但保持答案不变，`semantic_hash` 必须变化并触发复审。
3. 只补素材 hash，`semantic_hash` 不变且不得触发内容复审。
4. 删除一个实物、脚本或密封资产引用，delivery lock 构建失败。
5. 将旧题 ID 写入 manifest，正反向绑定检查失败。
6. 将淘汰题加入工具包映射，集合检查失败。
7. 相同 asset ID 使用不同文件 hash，seed 失败。
8. 让内容包 SQL 与 authority 不一致，验证失败。
9. TEACHER 请求密封资产，权限测试返回拒绝。
10. 任一人工门禁未通过时，运行库写入和 session 创建保持阻断。

## 9. 回滚与工作区保护

当前工作区存在大量未提交和未跟踪的审核成果。实施前必须：

1. 记录 `git status --short` 和本计划所依赖输入文件的 SHA-256，不清理、不 reset、不覆盖用户现有改动。
2. 每个阶段限定写入文件清单；遇到同文件并发变化时先重读并合并，不恢复旧版本。
3. 阶段一至三只生成文档和候选，不写正式数据库，回滚方式是停止消费新 authority，不删除历史产物。
4. 数据库 Schema 扩展只在阶段四执行；迁移前备份数据库，迁移失败保持旧 generation 可启动。
5. 已被引用的 asset ID 永不覆盖；错误资产通过新 ID 和 supersession 修正。

## 10. 上下文压缩与交接

- 本文件是实施计划的唯一文字权威；聊天记录不是执行依据。
- 用户批准后，在 `.continue-here.md` 写入当前阶段、已完成门禁、下一条原子动作和本文件路径。
- 每完成一个阶段立即更新状态和验证结果，不能等全部完成后一次性补写。
- 自动上下文压缩或新会话只需读取 `AGENTS.md`、`.continue-here.md` 和本文件，不重新开展合同盘点。

## 11. 最脆弱假设

本计划假设当前 `rubric_criteria` 基本表达了每道线下题真实考查行为。如果定点复审证明某题的观察指标本身错误，只重建该题版本及其 setup/脚本引用；不得因此作废共享工具包、其他题目的锁定答案或整套 delivery lock。

## 12. 下一实施步骤

阶段一至四已经完成：145道定点复审题全部通过，287道保留题已从当前权威确定性编译为DRAFT seed，统一激活门禁和内容包哈希校验已经接通。当前因Pilot独立门禁未通过、270项资产全部为planned，真实激活和session创建继续失败关闭；本轮没有写运行库或生成激活SQL。下一步按项目里程碑设计岗位线下评分草稿投影与恢复合同，之后回到Pilot R0-G01复审与真实Electron见证。
