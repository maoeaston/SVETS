# 炫灿-职途向导系统 MVP 产品需求文档

> **SUPERSEDED / 历史差异版**：本文件只用于追溯评分收口来源。当前唯一产品合同是 `doc/specs/MVP_PRD_v1.0.9-authoritative.md`，新开发不得把本文件作为现行基线。

版本：PRD v1.0.6-scoring-closure  
工程基线：`schema.sql v0.1.10-scoring-closure`（在 v0.1.9-strategy-composite-pk 基础上修订，见 §0.3）  
历史基线：`schema.sql v0.1.4 ~ v0.1.8` 已全部纳入  
上一版 PRD：`PRD v1.0.5-base-ability-rebalance`  
产品阶段：MVP  
目标平台：本地化桌面端  
核心岗位样板：超市理货员  
MVP 核心任务：拆箱与上架  
文档状态：v1.0.6 评分口径收口（缝合 v1.0.5 重平衡与底层数据模型之间的裂缝；已进入 schema 与核心评分编码落地）  
最后更新：2026-07-03

> **编写体例说明**：本版为修订收口版。凡下文未出现的章节（如 §1、§3、§9、§11.4~11.8、§12、§13、§14、§15、§20 等），**全文沿用 v1.0.5，一字不改**。出现的章节为**全文替换**或**明确标注的增补**。

---

## 0. 定稿说明

### 0.1 v1.0.6 的定位

v1.0.5 完成了基础能力评估的产品规则重平衡（42+8 / 满分 100 / 新三档 / 双兜底 / 就业安置方向），但该次重平衡与底层数据模型、自动化评分机制之间存在五处未缝合的结构裂缝。v1.0.6 是专项收口版，**不新增产品功能面**，只解决以下问题：

| # | v1.0.5 遗留问题 | v1.0.6 解决方案 | 涉及章节 |
|---|---|---|---|
| 1 | 线上题三档评分（0/1/2）依赖"经提示/犹豫"等人工观察，自动判分无法实现 | 线上 42 题改为 **0/2 二值自动判分**；1 分档仅保留给线下实操题 | §2.4、§5.4、§7.2 |
| 2 | 情绪崩溃"累计 3 次"与"崩溃=测评终止"自相矛盾 | 引入**坐次（sitting）分段施测机制**，重定义崩溃与累计规则 | §4.6、§6.5、§8.7 |
| 3 | 模块兜底存在单题否决与除零风险 | 模块兜底**仅按线上模块**（每模块 7 题 / 14 分）计算 | §7.4 |
| 4 | 基础能力线下 8 题与"拆箱上架"任务实操评分边界不清，同一数据可能双重计入两类结果 | `offline_score_record` 引入 **`score_scope`** 强制分流，两套线下评分彻底分离 | §5.6、§7.1、§11.10 |
| 5 | 文档内 schema 基线 v0.1.7 / v0.1.8 表述打架 | 统一声明工程基线，废止矛盾备注 | §0.3 |
| 6 | 已被引用题目可被修订，历史结果不可复现（策略锁了版本，题目没锁） | **题目内容冻结 + 作废重建**机制，对齐 strategy_config 的锁定哲学 | §5.3.1、§11.11 |
| 7 | 测评中途终止（兜底/红线）时分数计算规则缺失 | 明确 `max_score` 恒为 100、未答题计 0、终止类结果标注完成率 | §7.2.1 |
| 8 | 单次测评自动输出就业安置方向，伦理与效度风险 | 安置方向降级为"系统参考建议"，强制教师复核确认后方可导出 | §7.4、§5.8 |
| 9 | 优化建议报告中的"分挡/平行题"破坏标准化可比性 | 档位/变体必须绑定策略版本，禁止临场换档 | §5.3.1、§7.6 |
| 10 | 每题库模块 ACTIVE 题量不足会导致上线日无法组卷 | 题库审核完成度作为**上线门禁**写入验收 | §17.8 |

### 0.2 v1.0.6 新增决策条目（承接 v1.0.5 第 1~28 条）

29. **线上/线下分值结构调整**：线上 42 题每题 `0 / 2` 分二值自动判分（小计 84 分）；线下 8 题每题 `0 / 1 / 2` 分教师评分（小计 16 分）；总分仍为 100。`1 分（需改进/需辅助）`档位仅存在于教师现场评分场景。
30. **坐次（sitting）机制**：一次 `assessment_session` 可拆分为多个坐次分段施测（支持跨日）。session 是结果聚合单位，sitting 是施测单位。情绪崩溃定义修正为"**一次坐次因情绪中断未恢复而提前结束**"，同一 session 累计 3 次崩溃坐次触发兜底。
31. **模块兜底口径收窄**：模块级一票否决仅依据 6 大模块的**线上得分率**（每模块 7 题 / 满分 14 分）计算。线下 8 题的模块归属仅用于报告展示与教学分析，不参与否决判定，从根上消除除零与单题否决问题。
32. **线下评分双轨分离**：`offline_score_record.score_scope` 枚举为 `OFFLINE_ABILITY`（基础能力线下 8 题 → 计入 `ABILITY_SCORE`）与 `TASK_OPERATION`（拆箱上架任务实操 → 计入 `OPERATION_PASS_RATE`）。同一条评分记录只能归属一个 scope，禁止双重计入。
33. **题目版本冻结**：已被任何 `answer_record` 或已发布组卷引用的 `question_bank` 题目，其内容语义字段（题干、素材、答案、rubric、模块、题型、难度）冻结，不得原地修改；修订必须新建题目并通过 `superseded_by_question_id` 追溯，旧题转 `ARCHIVED`。
34. **中途终止计分规则**：任何非正常完成的测评（崩溃兜底、安全红线、作废），`max_score` 恒为 100，未答题计 0 分；结果记录必须写入 `completion_ratio`（已答题数 / 50）；此类分数仅作过程记录，不得用于就业安置方向判定。
35. **就业安置方向复核**：系统输出的安置方向为"参考建议"，报告导出前必须由教师执行安置建议复核确认（`PLACEMENT_REVIEW_CONFIRMED` 事件），报告固定展示免责声明。
36. **档位即版本**：优化建议报告中的时间分挡（2/3/5 分钟）、重量分挡（<3kg / 3-8kg）、低刺激平行题等，一律实现为不同题目变体 + 不同 `strategy_config` 版本组合。同一 session 内禁止临场换档；因感官画像使用替代题的，按 §10.4 既有降级记录机制处理。
37. **训练不设崩溃兜底（显式声明）**：情绪崩溃兜底仅适用于 `assessment_session`。`training_session` 中的反复情绪中断由教师通过"标记需重训"处理，不做自动等级判定。此为有意设计，非遗漏。
38. **管理员冗余要求**：系统初始化必须配置**至少 2 个**管理员账号，避免安全阻断解除的单点不可用。MVP 不引入教师联签紧急解除通道。
39. **题库源文件口径统一**：题库种子源统一表述为"题库源表（xlsx 导出的 CSV）"，导入流程按 CSV 处理，§5.3.1 字段映射不变。
40. **优化建议报告的吸收边界**：《通用基础能力评估题库-优化建议报告》中标注"高优先级"的新增/修订题目，纳入题库审核冲刺范围（DRAFT 入库 → 审核 → ACTIVE）；其中评分标准含"经提示/犹豫"字样的线上题 rubric，审核时必须改写为可自动判分的二值标准，或改造为线下实操题。"规则×情绪交叉分析框架""感官过敏筛查前置 session"列入 PRD v1.1.0，不进 MVP。

### 0.3 工程基线唯一化声明

**本版唯一工程基线为 `schema.sql v0.1.10-scoring-closure`。**

- v1.0.5 中"§7.6 落地状态备注（v0.1.8 已执行）"与"工程基线 v0.1.7"的矛盾表述**全部废止**。
- v0.1.8-base-ability-rebalance 确认已落地内容：`pass_threshold / improve_threshold` 重命名为 `competent_threshold / conditional_threshold`，DEFAULT 调整为 `80 / 60`；`module_veto_threshold / emotion_collapse_threshold` 提升为 `strategy_config` 表级字段；等级枚举一次性切换为新三档。
- v0.1.10 在 v0.1.9-strategy-composite-pk 基础上新增（详见 §11.10、§11.11）：
  1. `offline_score_record.score_scope`（`OFFLINE_ABILITY / TASK_OPERATION`，NOT NULL）。
  2. `question_bank.superseded_by_question_id` 与题目内容冻结触发器。
  3. `result_record.completion_ratio`。
  4. `task_report.placement_review_by / placement_review_at`。
  5. 坐次事件投影支持（`domain_event_projection` 增加 `sitting_no` 可空列；不新增独立 sitting 表，坐次为事件层概念）。
- 由于项目尚未存在真实业务数据，v0.1.10 作为新的全量初始化 schema 基线使用，不要求 v0.1.9 → v0.1.10 原地迁移脚本。

---

## 2.4 题量规格口径（全文替换）

基础能力评估（MVP 当前 + 后续标准化模拟卷统一口径）：

- 线上固定 **42 道**混合题（判断 / 单选 / 拖拽），每题 **`0 / 2` 分二值自动判分**，线上小计 **84 分**。
- 线下固定 **8 道**实操题，每题 **`0 / 1 / 2` 分教师评分**（0=不达标，1=需辅助/需改进，2=达标），线下小计 **16 分**。
- 总计 50 题，满分 **100**。
- 线上 42 题按 6 大模块均匀分布，每模块固定 7 道。每模块内题型比例由 `strategy_config.question_policy_json` 配置。
- 线下 8 道实操题通过复合能力标签覆盖 6 大基础能力，**每题必须标注唯一主归属模块**（用于报告展示），不要求每维度 1 道。
- 模块级一票否决**仅按线上模块得分率**（模块实得分 / 14）计算，阈值 `< 50%`，详见 §7.4。

> **v1.0.6 变更说明**：v1.0.5 的"每题 0/1/2"统一口径废止。原因：`1 分`档的判定标准（"经提示后选对""犹豫后选A"）依赖评估人员现场观察，学生端自主答题的自动判分系统无法实现。二值化后满分结构不变（42×2 + 8×2 = 100），组卷、阈值、兜底规则均不受影响。
>
> **题库审核约束**：源题库及《优化建议报告》中所有线上题的 rubric，凡含"经提示""犹豫""提示后"等过程观察描述的，审核转 `ACTIVE` 前必须改写为可自动判分的二值标准；无法改写的必须改造为 `OFFLINE_OPERATION` 题型。

专项岗位技能综合测评、分项模块小测试口径：沿用 v1.0.5，不变。

历史口径废止说明：沿用 v1.0.5，另增补——v1.0.5 的"50 题每题 0/1/2"口径自本版起废止。

---

## 4.6 情绪崩溃累计与等级判定联动（全文替换）

### 4.6.1 坐次（Sitting）机制

v1.0.6 引入坐次机制解决 v1.0.5 中"崩溃=终止测评"与"同一 session 累计 3 次"的定义矛盾，同时解决 50 题一次性施测对目标人群负荷过大的问题。

定义：

- **`assessment_session`**：一次完整基础能力评估的**结果聚合单位**。50 题、三类兜底、等级判定均以 session 为单位。
- **坐次（sitting）**：一次连续的**施测单位**。一个 session 由 1 个或多个坐次组成，支持跨日续测。

坐次规则：

1. 每个坐次由 `SITTING_STARTED` / `SITTING_ENDED` 事件界定，`sitting_no` 在 session 内递增。
2. 坐次结束方式分三类：
   - `COMPLETED_NORMALLY`：本坐次计划题目答完，或全卷完成。
   - `PAUSED_BY_PLAN`：教师按计划分段暂停（如按模块分段施测），session 进入 `SUSPENDED_REVIEW_REQUIRED`，等待下一坐次。
   - `ENDED_BY_COLLAPSE`：因情绪中断未恢复而提前结束（见 4.6.2）。
3. 坐次之间 session 保持开放态（`SUSPENDED_REVIEW_REQUIRED`），已提交答案不丢失，下一坐次从下一未答题继续。
4. 教师端可按模块规划分段施测（建议每坐次 ≤ 2 个模块 / ≤ 20 分钟），降低测评疲劳对后半段模块得分的污染。
5. 同一 session 的坐次总数与每坐次时间必须写入报告，保证施测条件可追溯。
6. session 存在有效期约束：自首个坐次起 `strategy_config.session_validity_days`（默认 14 天）内未完成的 session，由教师作废（`ABORTED`）后重新发起，防止跨度过长导致测评效度失真。

### 4.6.2 情绪崩溃定义（修正）

- **单次情绪中断**：学生点击"我遇到困难了"或教师端暂停，进入情绪支持层（§4.4）。**当次坐次内恢复继续的，不计崩溃。**
- **一次情绪崩溃** = 一个坐次以 `ENDED_BY_COLLAPSE` 方式结束，即：情绪中断后学生无法恢复，教师结束本坐次。系统记录 `EMOTION_COLLAPSE_RECORDED` 事件（含 sitting_no、时间、中断时所在题目）。
- 崩溃坐次结束后，session 进入 `SUSPENDED_REVIEW_REQUIRED`，**session 不终止**，可择时发起下一坐次。

### 4.6.3 累计兜底

- 同一 `assessment_session` 内累计崩溃坐次数达到 `strategy_config.emotion_collapse_threshold`（默认 3）时：
  - 系统记录 `EMOTION_COLLAPSE_THRESHOLD_REACHED` 事件。
  - session 进入终止流程（`COMPLETED`，结果按 §7.2.1 中途终止规则计算）。
  - `ABILITY_SCORE` 等级强制 `LEVEL_NOT_COMPETENT`。
  - 报告记录崩溃次数、每次崩溃的坐次号、时间与所在题目。

### 4.6.4 边界声明

- 情绪崩溃兜底**仅适用于 `assessment_session`**。`training_session` 不设崩溃兜底，训练中反复情绪中断由教师"标记需重训"处理。此为有意设计。
- 崩溃期间出现安全风险，安全红线优先（§4.5），不变。
- 情绪崩溃不触发 `safety_incident`，不变。

---

## 5.3.1 基础能力评估题库入库规则（增补，其余沿用 v1.0.5）

在 v1.0.5 全部规则基础上，增补以下条款：

### 题目内容冻结与作废重建（v1.0.6 新增）

`question_bank` 与 `strategy_config` 遵循相同的历史事实锁定哲学：

1. **冻结条件**：题目一旦被任何 `answer_record` 引用，或被任何已发起的 `assessment_session` 组卷选中，即视为历史事实的一部分。
2. **冻结字段**：`module_type`、`question_type`、`difficulty_level`、`content_json`（题干、素材、变体、答案）、`scoring_rule_json`。
3. **修订方式**：不得原地 `UPDATE` 冻结字段。修订必须：
   - 新建题目（新 `question_id`，建议在原 ID 上追加版本后缀，如 `Q_BASE_COGNITION_SC_009_V2`）；
   - 旧题目状态转 `ARCHIVED`，写入 `superseded_by_question_id` 指向新题目；
   - 新题目按正常审核流程 `DRAFT → ACTIVE`。
4. **未被引用的 `DRAFT / DISABLED` 题目**可自由修改。
5. 历史 session 的答题记录始终通过原 `question_id` 复现当时的题目内容。

### 档位与平行题规则（v1.0.6 新增）

针对《优化建议报告》中的分挡与平行题建议：

1. 时间分挡（静坐 3/5 分钟、持续操作 2/3 分钟）、重量分挡（<3kg / 3-8kg）、低刺激平行题（大小球排序替代线材排序）等，一律登记为**独立题目**（不同 `question_id`），通过 `content_json.variant_group` 标注同源变体组。
2. 一套组卷策略版本（`strategy_config` 的一个 version）中，同一变体组只允许选定一个档位。**同一 session 内禁止临场换档**。
3. 因感官画像触发的替代题使用，按 §10.4 降级机制处理并记录，不属于临场换档。
4. 不同档位组成的策略版本产生的 `normalized_score` **不做跨档位横向比较**；报告必须展示本次测评使用的策略版本与档位说明。

### 源文件口径（v1.0.6 澄清）

题库种子源统一为"题库源表"（`通用基础能力评估题库.xlsx` 导出的 CSV），导入流程与字段映射按 CSV 处理，v1.0.5 §5.3.1 映射表不变。

---

## 5.4 测评功能（关键段替换，其余沿用 v1.0.5）

#### 测评规则（替换）

MVP 基础能力评估默认策略：

- 线上 42 题（6 模块 × 7 题），每题 `0 / 2` 分，自动判分，小计 84 分。
- 线下 8 题，每题 `0 / 1 / 2` 分，教师评分，小计 16 分。
- 满分 100。
- 等级阈值：`LEVEL_COMPETENT >= 80`；`LEVEL_CONDITIONAL >= 60`；`< 60` 为 `LEVEL_NOT_COMPETENT`。
- 模块兜底：任一模块**线上得分率** `< 50%`（即模块 14 分中得分 < 7）触发 `LEVEL_NOT_COMPETENT`。
- 情绪崩溃兜底：累计 3 次崩溃坐次（默认，可配）。
- `LEVEL_FAIL_BY_SAFETY` 优先级最高。
- 分段施测：默认允许多坐次，`session_validity_days` 默认 14 天。

#### 测评过程（第 8~10 步替换）

8. 全部线上题完成后，session 进入 `OFFLINE_PENDING`，等待线下 8 题教师评分（`score_scope = OFFLINE_ABILITY`）。
9. 线下 8 题评分提交完成后，系统计算：线上 6 模块得分率、线下得分、综合总分、`completion_ratio`。
10. 系统按 §7.3 / §7.4 优先级判定等级，生成 `ABILITY_SCORE` 结果（含 `level_result`、`normalized_score`、`completion_ratio`、模块得分明细）。

---

## 5.6 线下实操评分（关键段替换，其余沿用 v1.0.5）

#### 双轨分离（v1.0.6 核心变更）

线下评分存在**两套彼此独立的评分轨道**，均由 `offline_score_record` 承载，通过 `score_scope` 强制分流：

| 轨道 | `score_scope` | 内容 | 计入结果 | 评分制 |
|---|---|---|---|---|
| 基础能力线下题 | `OFFLINE_ABILITY` | 基础能力评估的 8 道通用实操题（如描画、拾取、静坐、模拟搬运等） | `ABILITY_SCORE`（16/100 分） | 0 / 1 / 2 |
| 任务实操评分 | `TASK_OPERATION` | "拆箱与上架"任务的 9 动作实操评分项 | `OPERATION_PASS_RATE` | 0 / 1 / 2 |

强制规则：

1. 每条 `offline_score_record` 必须且只能归属一个 `score_scope`。
2. `OFFLINE_ABILITY` 记录必须关联具体 `question_id`（8 道线下题之一）；`TASK_OPERATION` 记录关联任务评分项配置。
3. 结果计算服务按 scope 分流：`OFFLINE_ABILITY` 只进 `ABILITY_SCORE`，`TASK_OPERATION` 只进 `OPERATION_PASS_RATE`。**任何一条评分记录不得同时计入两类结果**。
4. 两套评分可以在同一次线下课组织完成，但在系统内是两组独立记录、两次独立提交。
5. 教师端评分页必须清晰区分两个评分区块，不得混排在同一提交表单中。

评分标准、评分流程、revision 机制、安全红线约束：沿用 v1.0.5。

---

## 5.8 任务报告（增补，其余沿用 v1.0.5）

报告内容在 v1.0.5 清单基础上增补：

- 施测坐次记录（坐次数、每坐次日期时长、分段方式）。
- `completion_ratio` 与中途终止标记（若适用）。
- 本次测评使用的策略版本与题目档位说明。
- **就业安置方向建议区块必须包含**：
  - 固定免责声明："本安置方向为系统基于单次测评的参考建议，不构成安置决定，须由专业评估团队结合多次评估、行为观察与家庭意见综合决策。"
  - 教师复核确认信息（复核人、复核时间）。

产品规则增补：

- 报告导出前必须完成安置建议复核确认（`PLACEMENT_REVIEW_CONFIRMED` 事件，写入 `task_report.placement_review_by / placement_review_at`）；未复核的报告可生成、可查看，**不可导出**。
- `completion_ratio < 1` 的测评结果，报告不输出就业安置方向，仅输出终止原因与过程记录。

---

## 6.5 坐次与开放态（新增小节，§6 其余沿用 v1.0.5）

1. 坐次不是独立聚合，不新增 session 表；坐次由 `SITTING_STARTED / SITTING_ENDED` 事件在 `domain_event_projection` 中投影（`sitting_no` 列）。
2. 坐次进行中 session 为 `ACTIVE`；坐次间歇 session 为 `SUSPENDED_REVIEW_REQUIRED`（开放态，仍受唯一开放会话约束与安全阻断约束）。
3. 同一 session 同一时刻只能有一个进行中坐次。
4. 未解决安全事件阻断的对象是"新会话"与"新坐次"：存在 `PENDING_DETAIL / CONFIRMED` 安全事件时，同学生同任务的挂起 session **不得发起新坐次**。
5. `session_validity_days` 超期的 session 由教师作废，作废原因记录为 `VALIDITY_EXPIRED`。

---

## 7.1 三类结果（增补一段，其余沿用 v1.0.5）

`ABILITY_SCORE` 来源增补：`offline_score_record（score_scope = OFFLINE_ABILITY）`。  
`OPERATION_PASS_RATE` 来源修正为：`offline_score_record（score_scope = TASK_OPERATION）`。  
两类结果的数据来源自 schema 层物理分流，禁止交叉读取。

---

## 7.2 统一百分制模型（增补 §7.2.1，其余沿用 v1.0.5）

### 7.2.1 中途终止计分规则（v1.0.6 新增）

适用于崩溃兜底终止、安全红线终止、作废等一切非正常完成场景：

1. `max_score` 恒为 **100**，不随已答题量缩减。
2. 未答题目一律计 **0 分**。
3. `result_record.completion_ratio` = 已答题数（含线下已评分题）/ 50，必须持久化。
4. 模块得分率统一定义：**模块线上实得分 / 14**（分母恒为模块线上满分，未答计 0）。v1.0.5 中"已答题目实得分 / 模块题目满分"的歧义表述废止。
5. 中途终止的 `normalized_score` 仅作过程记录：
   - 不用于就业安置方向判定；
   - 不参与 §16.4 的能力测评分变化趋势统计（单列"未完成测评"口径）；
   - 崩溃兜底终止的等级恒为 `LEVEL_NOT_COMPETENT`，红线终止恒为 `LEVEL_FAIL_BY_SAFETY`，均与分数无关。
6. 正常完成（50 题全部作答与评分）的结果，`completion_ratio = 1`，方可进入安置方向映射。

---

## 7.4 综合建议结论（关键段替换，其余沿用 v1.0.5）

#### 模块级一票否决细则（替换）

- 否决判定**仅依据 6 大模块的线上得分率**：模块线上实得分 / 14。
- 任一模块线上得分率 `< strategy_config.module_veto_threshold`（默认 0.5）即触发否决。
- 线下 8 题按主归属模块在报告中展示模块贡献，**不参与否决判定**。理由：线下题不保证每模块覆盖（可能 0 题或 1 题），参与否决会产生除零与单题否决的测量学缺陷。
- 触发否决时报告必须指明触发模块及其线上得分明细。

#### 建议结论与安置方向的调和（替换第 6 条 + 安置表注释）

- 建议结论第 6 条修改为：
  - `LEVEL_NOT_COMPETENT`：结论为"建议回到对应能力模块的巩固训练"。
  - `LEVEL_CONDITIONAL`：结论为"**可在支持条件下进入岗位训练，同时对薄弱模块（得分率最低的 1~2 个模块）进行补强训练**"。（消除 v1.0.5 中 CONDITIONAL 学生"既建议回炉、又建议支持性就业"的矛盾。）
- 就业安置方向映射表沿用 v1.0.5，增加两条硬约束：
  1. 仅 `completion_ratio = 1` 的正常完成测评可输出安置方向。
  2. 安置方向为系统参考建议，须教师复核确认后方可随报告导出（§5.8）。

其余优先级顺序、情绪崩溃兜底细则（按坐次口径，见 §4.6）沿用。

---

## 7.6 策略配置版本锁定（增补/修正，其余沿用 v1.0.5）

1. 第 10~13 条（阈值字段语义重解释、schema DEFAULT 不信任、v0.1.8 备忘及落地备注）**全部废止**，由 §0.3 工程基线唯一化声明替代。字段名以 v0.1.8 落地后的 `competent_threshold / conditional_threshold` 为准，DEFAULT `80 / 60`；`module_veto_threshold / emotion_collapse_threshold` 为表级字段。
2. `strategy_config` 语义字段冻结清单同步更新字段名，并增加：`session_validity_days`、`question_policy_json` 中的变体组档位选择。
3. 新增：策略版本的 `question_policy_json` 若包含档位选择（§5.3.1），档位变更同样必须通过新增 version 完成。

---

## 8.7 领域事件类型（增补，其余沿用 v1.0.5）

新增事件：

- `SITTING_STARTED`
- `SITTING_ENDED`（payload 含结束方式：`COMPLETED_NORMALLY / PAUSED_BY_PLAN / ENDED_BY_COLLAPSE`）
- `EMOTION_COLLAPSE_RECORDED`
- `PLACEMENT_REVIEW_CONFIRMED`
- `QUESTION_SUPERSEDED`（题目作废重建）

`EMOTION_COLLAPSE_THRESHOLD_REACHED` 保留，语义更新为"累计崩溃坐次达阈值"。

---

## 11.10 offline_score_record 双轨约束（新增小节）

- `score_scope` NOT NULL，枚举 `OFFLINE_ABILITY / TASK_OPERATION`，schema 层 CHECK 约束。
- `score_scope = OFFLINE_ABILITY` 时 `question_id` 必须非空且指向 `question_type = OFFLINE_OPERATION` 的 ACTIVE 题目。
- 结果计算服务按 scope 分流，交叉读取视为 `FSM_INVALID_TRANSITION` 级工程缺陷。

## 11.11 question_bank 冻结约束（新增小节）

- 新增 `superseded_by_question_id`（可空，自引用外键，不得等于自身）。
- 已被 `answer_record` 引用的题目，schema 触发器禁止修改 §5.3.1 冻结字段清单。
- `ARCHIVED` + `superseded_by_question_id` 联动：作废重建须在同一事务完成（参照 safety_incident `FACTUAL_CORRECTION` 模式）。

---

## 17. 验收标准（增补以下专项，其余沿用 v1.0.5）

### 17.6.2 v1.0.6 评分收口专项验收（新增）

**二值判分与双轨分离：**

1. 线上题自动判分只产生 0 或 2 分；出现 1 分应失败。
2. 线下题教师评分可产生 0 / 1 / 2 分。
3. `offline_score_record` 缺失 `score_scope` 写入应失败。
4. `OFFLINE_ABILITY` 记录参与 `OPERATION_PASS_RATE` 计算应失败（结果计算服务层断言）。
5. `TASK_OPERATION` 记录参与 `ABILITY_SCORE` 计算应失败。

**坐次与崩溃：**

6. 一个 session 可跨 2 个以上坐次完成，已答题不丢失，续测从下一未答题开始。
7. 坐次内情绪中断后恢复，不计崩溃。
8. 坐次以 `ENDED_BY_COLLAPSE` 结束，崩溃计数 +1，session 保持开放。
9. 累计崩溃达阈值，session 终止，等级 `LEVEL_NOT_COMPETENT`，报告含每次崩溃的坐次/时间/题目。
10. 存在未解决安全事件时，挂起 session 发起新坐次应被阻断。
11. 超过 `session_validity_days` 的 session 发起新坐次应被阻断并提示作废重开。

**模块兜底：**

12. 任一模块线上得分 6/14（<50%），总分 ≥80，结果应为 `LEVEL_NOT_COMPETENT`。
13. 线下某模块 0 题或线下单题 0 分，只要线上模块得分率均 ≥50% 且无其他兜底，不触发否决。
14. 模块得分率分母恒为 14，未答题计 0。

**中途终止计分：**

15. 只答 20/50 题即终止，`max_score = 100`、`completion_ratio = 0.4` 正确持久化。
16. `completion_ratio < 1` 的结果不输出就业安置方向。

**安置复核：**

17. 未执行 `PLACEMENT_REVIEW_CONFIRMED` 的报告导出应被阻断。
18. 复核后导出的报告含复核人、复核时间与免责声明。

**题目冻结：**

19. 已被 `answer_record` 引用的题目修改 `content_json` 应失败。
20. 题目作废重建后，`superseded_by_question_id` 正确指向新题；历史 session 按旧 `question_id` 复现原题内容。
21. `superseded_by_question_id = question_id` 应失败。

### 17.8 基础能力题库导入验收（增补第 13~15 条）

13. **上线门禁**：MVP 交付验收时，6 大模块每模块 `ACTIVE` 线上题 ≥ 7 道、全库 `ACTIVE` 线下实操题 ≥ 8 道且覆盖主归属模块标注，否则测评功能不得开放。
14. 线上题 rubric 含"经提示 / 犹豫 / 提示后"等过程观察描述的，不得转 `ACTIVE`（须改写为二值标准或改为线下题）。
15. v1.0.5 §17.8 第 12 条文字勘误：`OFFLINE_OPERATION` 题目的复合能力标签用于**线下模块展示归属**，不参与线上模块计分与否决。

---

## 18. 版本规划（增补）

### 18.1 MVP v1.0.6-scoring-closure（当前版本）

在 v1.0.5 范围基础上：

- 线上二值判分 + 线下三档评分（满分 100 不变）。
- 坐次分段施测机制。
- 线下评分双轨分离（`score_scope`）。
- 模块兜底收窄至线上模块。
- 中途终止计分规则与 `completion_ratio`。
- 就业安置方向教师复核门禁。
- 题目内容冻结与作废重建。
- `schema.sql v0.1.10-scoring-closure` 基线。
- 题库审核上线门禁。

### 18.2 PRD v1.1.0-outline-alignment（增补两项）

- **感官过敏筛查前置 session**：按《优化建议报告》§4.1，实现为测评前独立轻量筛查（5-10 分钟），结果回写学生感官画像并影响组卷避让，**不混入模块四计分**。
- **规则×情绪交叉分析框架**：按《优化建议报告》§3.3，作为报告建议结论的规则引擎升级（规则低+情绪低 / 规则低+情绪高 / 规则高+情绪低 三类交叉解读）。

---

## 19. 关键工程约束清单（增补第 29~36 条，其余沿用 v1.0.5）

29. 不得让线上自动判分产生 `1 分`；`1 分`仅存在于教师现场评分。
30. 不得让一条 `offline_score_record` 同时计入 `ABILITY_SCORE` 与 `OPERATION_PASS_RATE`。
31. 不得在模块兜底计算中引入线下题得分率。
32. 不得原地修改已被 `answer_record` 引用的题目内容语义字段。
33. 不得对 `completion_ratio < 1` 的结果输出就业安置方向。
34. 不得在未经教师安置复核确认的情况下导出含安置方向的报告。
35. 不得在同一 session 内临场切换题目档位。
36. 不得以 v1.0.5 的"50 题每题 0/1/2"旧口径实现判分逻辑。

---

## 附：v1.0.5 → v1.0.6 变更摘要（供评审快速核对）

| 类别 | 变更 |
|---|---|
| 评分 | 线上 0/2 二值，线下 0/1/2；满分 100 不变 |
| 施测 | 新增坐次机制，支持分段/跨日；session 有效期默认 14 天 |
| 崩溃 | 崩溃 = 坐次因情绪中断未恢复而结束；累计 3 崩溃坐次触发兜底；训练侧显式声明不设兜底 |
| 兜底 | 模块否决仅按线上模块（÷14）；消除除零/单题否决 |
| 线下 | `score_scope` 双轨分离，两类结果数据源物理隔离 |
| 终止 | `max_score` 恒 100、未答计 0、`completion_ratio` 落库 |
| 安置 | 参考建议 + 免责声明 + 教师复核导出门禁；未完成测评不输出 |
| 题库 | 题目内容冻结 + 作废重建；档位即版本；rubric 二值化审核约束；上线门禁 |
| 基线 | 统一为 schema v0.1.10-scoring-closure，废止 v1.0.5 的矛盾备注 |
| 运维 | 至少 2 个管理员账号 |
