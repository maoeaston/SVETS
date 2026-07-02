# 炫灿-职途向导系统 MVP 产品需求文档

版本：PRD v1.0.5-base-ability-rebalance  
工程基线：`schema.sql v0.1.7-consistency-guard`  
历史基线：`schema.sql v0.1.4-safety-lifecycle`、`schema.sql v0.1.5-integrity-lock`、`schema.sql v0.1.6-void-reason` 已纳入  
上一版 PRD：`PRD v1.0.4-outline-and-consistency`（基础能力评估口径调整前）  
产品阶段：MVP  
目标平台：本地化桌面端  
核心岗位样板：超市理货员  
MVP 核心任务：拆箱与上架  
文档状态：v1.0.5 基础能力评估口径重平衡（线上 42 + 线下 8 / 满分 100 / 新三档等级 / 模块与情绪兜底纳入；尚未进入正式编码落地）  
最后更新：2026-07-01

---

## 0. 定稿说明

本 PRD 是《炫灿-职途向导系统 MVP》的产品需求文档。v1.0.5 在 v1.0.4 一致性保护基线上，对基础能力评估的题量、分值与等级体系进行了重平衡。已吸收以下决策与工程基线：

1. MVP 不做完整职业训练平台，只验证一个最小但完整的任务闭环：**测评 → 训练 → 实操评分 → 报告反馈**。
2. 结果体系采用三类分开展示：**能力测评分、训练完成度、实操达标率**，禁止混算为单一总分。
3. 底层采用统一百分制评分模型：`raw_score / max_score * 100`，并通过 `result_record` 投影。
4. 工程架构采用 **轻量事件溯源 + SQLite 查询投影**：`action_log.jsonl` 是事实来源，SQLite 是查询快照。
5. 所有状态变更必须由领域事件推进，UI 不得直接修改 session 状态。
6. 安全红线是**学生 + 任务级全局安全事件**，不是某个 session 的附属记录。
7. 安全红线触发后必须**先熔断、后归因**，批量熔断同一学生、同一任务下所有开放测评与训练会话。
8. 无开放会话时，也必须允许独立记录安全事件；未解决前阻断同一学生同一任务的新会话。
9. 安全事件采用两级权限：教师负责触发、补充与事实确认；管理员负责解除阻断。
10. `safety_incident` 状态机锁定为 `PENDING_DETAIL -> CONFIRMED / VOIDED` 与 `CONFIRMED -> RESOLVED / VOIDED`，`RESOLVED` 与 `VOIDED` 为终态。
11. `PENDING_DETAIL` 是安全事件事实补充的唯一窗口；安全事件进入 `CONFIRMED` 后，核心事实字段冻结，不允许静默原地修改。
12. 已被 `assessment_session` 或 `training_session` 引用的 `strategy_config(strategy_id, version)` 是历史事实的一部分，评分、组卷、阈值、策略 JSON 等语义字段不得原地改写，只能新增版本。
13. `safety_incident.status = VOIDED` 必须通过 `void_reason` 区分误触误报、重复记录、非安全事件与事实修正作废重建，不得将所有 `VOIDED` 事件一律视为误报。
14. 当 `void_reason = FACTUAL_CORRECTION` 时，旧安全事件表示真实事件的错误记录版本，必须在同一事务中创建 replacement safety_incident，并写入 `replacement_incident_id`，避免解除阻断与重建之间出现空窗。
15. 报告是结果快照，不得被后续重测、复评或评分修正覆盖。
16. 异常中心与错误码体系进入 MVP，不作为后续补丁。
17. `schema.sql v0.1.7-consistency-guard` 已补齐 session 对 `strategy_config` 的跨表引用一致性保护。
18. `schema.sql v0.1.7-consistency-guard` 已补齐 `REDLINE_HALTED` session 的 `redline_incident_id` 同学生同任务保护。
19. `schema.sql v0.1.7-consistency-guard` 已将 `training_step_record.status` 统一为 `NOT_STARTED / IN_PROGRESS / COMPLETED / SKIPPED / FAILED`。
20. 《软件大纲内容设计.md》作为产品总蓝图纳入本文档的版本边界说明；其中完整试卷系统、自定义组卷、PDF 导出与 4 大专项岗位模块不进入当前 MVP 主流程。
21. `通用基础能力评估题库.xlsx` 可作为基础能力题库种子数据进入 `question_bank`，但默认以 `DRAFT` 状态入库，完成素材、答案与计分规则审核后才允许转为 `ACTIVE`。
22. **基础能力评估口径重平衡（v1.0.5）**：MVP 测评环节题量统一为线上 42 题 + 线下 8 题 = 50 题，每题 `0 / 1 / 2` 分，满分 100。原 §2.4「基础能力标准化模拟卷 18+5」与 §5.4「拆箱与上架任务测评 17+3 / 满分 40」两套口径合并为此一套。
23. 6 大基础能力模块（精细动作、认知理解、规则执行、情绪调节、基础社交、安全操作）每模块选 7 道线上题（6×7=42）；线下 8 道实操题通过复合能力标签覆盖 6 大维度，不要求机械做到每维度 1 道。
24. **结果等级改为新三档**：`LEVEL_COMPETENT`（基础能力胜任）`normalized_score >= 80`；`LEVEL_CONDITIONAL`（有条件胜任）`60 <= normalized_score < 80`；`LEVEL_NOT_COMPETENT`（完全不胜任）`normalized_score < 60`。原 `LEVEL_PASS / LEVEL_IMPROVE / LEVEL_FAIL` 枚举废止。`LEVEL_FAIL_BY_SAFETY` 作为安全红线覆盖等级保留，优先级高于一切分数判定。
25. **模块级一票否决**：6 大基础能力模块中任一模块（线上或线下）得分率 `< 50%`，无论总分多少，结果直接判定为 `LEVEL_NOT_COMPETENT`。该规则在结果计算阶段强制执行，不依赖教师判断。
26. **情绪崩溃兜底**：同一测评会话累计因情绪崩溃无法继续的次数达到 `strategy_config` 配置的阈值（默认建议 3 次），无论已得分数多少，结果直接判定为 `LEVEL_NOT_COMPETENT`。单次情绪中断仍按 §4.4 可恢复机制处理，不影响等级判定。
27. **就业安置方向纳入报告系统建议**：`LEVEL_NOT_COMPETENT` 对应「日间照料 / 支持性转介」；`LEVEL_CONDITIONAL` 对应「支持性就业 Supported Employment」；`LEVEL_COMPETENT` 对应「竞争性就业 Competitive Employment」。详见 §7.4。
28. 本次重平衡不改变三类结果独立原则：42+8 合并的 100 分属于 `ABILITY_SCORE` 内部结构，不与 `TRAINING_COMPLETION` 或 `OPERATION_PASS_RATE` 混算。

本 PRD 与 `schema.sql v0.1.7-consistency-guard` 对齐。v0.1.7 在既有 `schema.sql v0.1.4-safety-lifecycle`、`schema.sql v0.1.5-integrity-lock`、`schema.sql v0.1.6-void-reason` 基础上，只补充一致性保护，不扩展完整试卷系统、公共模拟卷、自定义试卷库、PDF 导出、4 大专项岗位模块，也不重构红线批量熔断、事件溯源、结果投影、报告、题库、异常中心、安全事件生命周期或 `void_reason` 逻辑。

本版继续保留 `schema.sql v0.1.4-safety-lifecycle` 的产品约束：`safety_incident` 必须具备明确生命周期状态机与两级权限控制。教师可以触发红线、补充详情并确认事实；管理员才可以解除安全阻断，将事件标记为 `RESOLVED` 或带明确 `void_reason` 的 `VOIDED`。

本版继续保留 `schema.sql v0.1.5-integrity-lock` 的完整性约束：`safety_incident` 离开 `PENDING_DETAIL` 后核心事实字段冻结；已被会话引用的 `strategy_config` 历史版本禁止原地改写。

本版继续保留 `schema.sql v0.1.6-void-reason` 的作废语义约束：`VOIDED` 必须通过 `void_reason` 分型，`FACTUAL_CORRECTION / DUPLICATE_RECORD` 必须通过 `replacement_incident_id` 追溯真实或主安全事件。

由于当前项目尚未正式进入编码落地，`schema.sql v0.1.7-consistency-guard` 作为新的全量初始化 schema 基线使用，暂不要求提供 v0.1.6 → v0.1.7 的原地迁移脚本。若后续已有真实数据后再升级 schema，必须另行编写 migration 脚本，不得依赖 `CREATE TABLE IF NOT EXISTS` 修改既有表约束。

---

## 1. 项目背景与目标

### 1.1 项目背景

特殊教育学校及职业转衔机构在帮助孤独症、心智障碍及其他特殊需要青少年进入职业训练阶段时，常见三个痛点：

第一，职业能力评估缺乏结构化工具。教师通常依赖经验判断学生是否适合某类岗位训练，难以形成可追溯、可复盘、可横向比较的能力记录。

第二，训练过程缺少标准化拆解。真实岗位任务往往包含多个连续动作，例如识别商品、拆箱、检查包装、上架、整理排面和处理异常。对特殊学生而言，如果任务没有被拆解为稳定、可视化、低认知负荷的步骤，训练结果会高度依赖教师个人经验。

第三，线下实操结果难以数字化沉淀。学生是否真正具备实操能力，最终需要教师现场观察。但如果教师评分没有被结构化记录，后续无法追踪能力变化，也无法形成持续干预依据。

本系统的目标是将真实岗位任务转化为可测评、可训练、可评分、可追溯的数字化闭环。

### 1.2 产品定位

炫灿-职途向导系统是一款面向特殊教育职业转衔场景的本地化桌面端工具。

它不是普通题库系统，也不是在线考试系统，而是一个围绕真实岗位任务建立的：

**岗位任务拆解 + 能力测评 + 结构化训练 + 教师实操评分 + 结果报告系统。**

MVP 阶段以“超市理货员”岗位中的“拆箱与上架”任务为唯一样板，验证产品闭环与工程底座是否成立。

### 1.3 MVP 产品目标

MVP 的核心目标是：

通过一个真实岗位任务样板，验证特殊学生是否可以在教师支持下完成从线上能力测评、结构化训练到线下实操评分的完整闭环，并形成可追溯、可复盘、可导出的任务报告。

MVP 成功不以功能数量多为标准，而以以下闭环是否稳定跑通为标准：

- 教师能够创建学生档案。
- 教师能够发起一次任务测评。
- 学生能够完成线上测评。
- 系统能够记录线上测评结果。
- 学生能够进入“看、学、练、做”训练流程。
- 系统能够记录训练完成度。
- 教师能够完成线下实操评分。
- 系统能够生成三类结果。
- 系统能够生成任务报告快照。
- 安全红线、异常中断、资源缺失、数据写入失败等关键异常能够被阻断、记录和恢复。

---

## 2. MVP 范围与非范围

### 2.1 MVP 范围

MVP 只覆盖一个岗位、一个任务、一个闭环。

岗位：

- 超市理货员

任务：

- 拆箱与上架

用户角色：

- 学生
- 教师
- 管理员

核心流程：

1. 学生建档。
2. 任务测评。
3. 四步训练。
4. 线下实操评分。
5. 三类结果展示。
6. 任务报告生成。
7. 异常中心记录。
8. 本地资源完整性管理。
9. 本地恢复。

核心结果：

- 能力测评分 `ABILITY_SCORE`
- 训练完成度 `TRAINING_COMPLETION`
- 实操达标率 `OPERATION_PASS_RATE`

核心工程能力：

- 轻量事件溯源。
- SQLite 查询投影。
- 事件驱动状态机。
- 学生任务级安全红线。
- 批量熔断开放会话。
- 无会话安全事件记录。
- 异常中心与错误码体系。
- 报告快照。
- 本地资源哈希校验。
- `strategy_config` 引用一致性保护。
- `redline_incident_id` 同学生同任务保护。
- `training_step_record.status` 与 PRD 枚举一致。

### 2.2 MVP 非范围

以下内容不进入 MVP 主流程：

- 完整理货员岗位训练体系。
- 完整 6 大维度全量测评体系。
- 公共标准模拟卷 1 / 2 / 3 的完整试卷管理。
- 教师自定义岗位试卷库。
- 自定义专项综合卷库。
- 试卷复制、编辑、下发与组卷强制校验后台。
- 导出整套题目 + 教具清单 PDF。
- 4 大专项岗位技能模块完整体系。
- 专项技能综合测评。
- 分项模块小测试。
- 全日制上班流程结业考核。
- 家长端。
- 企业端。
- 多评价人盲评。
- 正式证书系统。
- 云端同步。
- 多校区管理。
- 复杂审批流。
- AI 自动推荐岗位。
- 复杂统计看板。
- 跨设备实时协同。

MVP 可以在数据模型中保留扩展能力，但前端不开放这些复杂入口。基础能力题库可以作为 `question_bank` 种子数据导入，但不等于当前 MVP 已实现完整基础能力标准化模拟卷系统。

### 2.3 软件大纲对齐边界

《软件大纲内容设计.md》是理货员职业化训练软件的产品总蓝图，不等同于当前 MVP 的全部交付范围。

大纲中已与 MVP 一致或可在 MVP 内以最小形态承接的内容包括：

- 登录页的用户名、密码、登录按钮。
- 学生端最小学习入口。
- 学生个人基础档案查看。
- 个性化适配参数的底层字段，例如视频播放速度、提示语音开关、音量。
- “我遇到困难了”全局求助入口的 MVP 形态。
- 基础能力题库的底层入库。
- 超市理货员 / 拆箱与上架任务的测评、训练、实操评分和报告。
- 教师端学员档案管理。
- 教师端测评与训练管理的最小入口。
- 教具清单作为本地资源类型登记与校验。

大纲中暂不进入 MVP、但应进入后续版本规划的内容包括：

- 学员端完整五大主菜单。
- 实操测试中心的两大考核板块完整实现。
- 基础能力标准化模拟试卷完整体系。
- 公共标准模拟卷 1 / 2 / 3。
- 老师下发的自定义试卷。
- 基础能力自由练习专区。
- 4 大专项岗位技能训练模块。
- 专项岗位技能综合测评。
- 分项模块小测试。
- 教师端模拟题库与组卷管理。
- 全量总题库浏览。
- 导出整套试卷 + 教具清单 PDF。
- 教具使用说明书 PDF 在线预览与打印。
- 我的训练成果完整勋章体系与综合汇总页。

### 2.4 题量规格口径

为避免大纲、PRD、schema 和组卷策略出现分叉，基础能力评估与后续完整试卷系统采用以下题量口径。

v1.0.5 起，MVP 当前测评与「基础能力标准化模拟卷」共用同一口径，不再区分：

基础能力评估（MVP 当前 + 后续标准化模拟卷统一口径）：

- 线上固定 **42 道**混合题。
- 线下固定 **8 道**实操题。
- 总计 50 题，每题 `0 / 1 / 2` 分，满分 **100**。
- 覆盖精细动作、认知理解、规则执行、情绪调节、基础社交、安全操作 6 大基础能力。
- 线上 42 题按 6 大模块均匀分布，每模块固定 **7 道**（6×7=42）。每模块内题型（判断 / 单选 / 拖拽）比例由 `strategy_config.question_policy_json` 配置，不强制「判断+单选+拖拽各 1」的固定切分。
- 线下 8 道实操题通过复合能力标签覆盖 6 大基础能力，不要求机械做到每维度 1 道。
- 任一模块（线上或线下）得分率 `< 50%` 触发模块级一票否决，详见 §7.4。

专项岗位技能综合测评（后续 v0.3.0-job-skill-modules，不进入 MVP）：

- 线上固定 16 道专项混合题。
- 线下固定 4 道实操题。
- 覆盖货架整理 + 价签核对、拆箱补货 + 先进先出、临期破损商品分拣、库房收纳 + 简易盘点 4 大理货模块。

分项模块小测试（后续 v0.3.0，不进入 MVP）：

- 单模块线上 8–10 道。
- 单模块线下固定 2 道实操。
- 仅覆盖当前模块习题，不作为 MVP 主流程。

历史口径废止说明：v1.0.4 及更早大纲中出现的「基础能力线上 18 题 + 线下 5 实操」「基础能力线上 18 题 + 线下 3 实操」「拆箱与上架任务测评 17 + 3 / 满分 40」「专项综合线上 20 + 线下 4」一律废止。基础能力评估以 42 + 8 / 满分 100 为唯一口径；专项综合以 16 + 4 为唯一口径。

### 2.5 后续版本边界

MVP 只验证“一个岗位任务的教学闭环是否成立”。

后续版本可以逐步扩展：

- 从一个任务扩展到理货员完整岗位任务包。
- 从单一基础能力评估策略扩展到多套标准化模拟卷（公共卷 1 / 2 / 3、教师自定义卷），题量与分值结构沿用 v1.0.5 口径。
- 从 `strategy_config.question_policy_json` 扩展到正式 `assessment_paper / assessment_paper_question` 试卷模型。
- 从理货员扩展到其他岗位，例如文件整理、后勤辅助、手工包装、AI 数据标注辅助等。
- 从教师单点评分扩展到多评价人复核。
- 从本地单机扩展到局域网或私有化部署。

---

## 3. 用户角色与权限

### 3.1 学生 STUDENT

学生是测评与训练的执行者。

学生可执行操作：

- 登录学生端。
- 进入教师分配的测评。
- 完成线上题目。
- 观看训练视频。
- 学习步骤卡片。
- 完成互动练习。
- 点击“我遇到困难了”。
- 查看简化成果反馈。

学生不可执行操作：

- 查看其他学生档案。
- 修改测评结果。
- 修改训练记录。
- 修改教师评分。
- 查看异常中心。
- 导出完整报告。
- 访问教师端管理功能。
- 触发、确认、解除安全红线事件。

### 3.2 教师 TEACHER

教师是教学流程发起者、评分者、安全红线触发者、事实确认者和报告查看者。

教师可执行操作：

- 登录教师端。
- 创建和维护学生档案。
- 配置学生感官避让信息。
- 发起任务测评。
- 暂停、恢复、作废测评。
- 分配训练任务。
- 查看训练完成度。
- 完成线下实操评分。
- 触发安全红线，并创建 `PENDING_DETAIL` 状态的 `safety_incident`。
- 补充安全事件的 `reason_code`、`context_phase`、`description`。
- 将安全事件从 `PENDING_DETAIL` 推进到 `CONFIRMED`。
- 查看教学相关异常。
- 生成、导出、锁定任务报告。
- 发起复评或重训。

教师不可执行操作：

- 修改已锁定报告。
- 物理删除业务记录。
- 绕过安全红线结果。
- 直接修改底层 session 状态。
- 直接覆盖历史评分记录。
- 将 `PENDING_DETAIL` 安全事件直接标记为 `RESOLVED`。
- 将 `PENDING_DETAIL` 安全事件标记为 `VOIDED`。
- 将 `CONFIRMED` 安全事件标记为 `RESOLVED` 或 `VOIDED`。
- 绕过管理员复盘直接解除同一学生同一任务的新会话阻断。

### 3.3 管理员 ADMIN

管理员负责系统初始化、基础配置、系统维护和安全事件阻断解除。

管理员可执行操作：

- 管理教师账号。
- 管理学生账号状态。
- 导入题库和资源包。
- 维护策略配置。
- 查看系统级异常。
- 执行资源完整性检查。
- 执行本地备份与恢复。
- 查看 schema 与版本信息。
- 将 `PENDING_DETAIL` 安全事件标记为 `VOIDED`。
- 将 `CONFIRMED` 安全事件标记为 `RESOLVED`。
- 将 `CONFIRMED` 安全事件标记为 `VOIDED`。

管理员不可执行操作：

- 绕过审计日志直接修改已完成结果。
- 物理删除核心业务会话。
- 绕过事件机制直接改写状态。
- 绕过 `safety_incident` 状态机直接恢复被红线熔断的测评或训练会话。
- 在未生成安全事件状态变更记录的情况下解除安全阻断。

### 3.4 安全红线事件两级处理机制

安全红线事件实行两级处理机制：教师负责触发与事实确认，管理员负责解除安全阻断。

教师端拥有安全红线触发权与事实确认权。教师发现危险行为后，可立即触发红线。系统自动创建学生任务级 `safety_incident`，并批量熔断同一 `student_id + task_code` 下所有开放态 `assessment_session` 与 `training_session`。红线触发后，`safety_incident` 初始状态为 `PENDING_DETAIL`。教师随后补充发生环节、原因代码、事件说明，并可将事件从 `PENDING_DETAIL` 推进至 `CONFIRMED`。

管理员端拥有安全阻断解除权。任何 `PENDING_DETAIL` / `CONFIRMED` 状态的 `safety_incident` 都会阻断同一学生同一任务的新测评或训练会话。只有管理员将事件标记为 `RESOLVED` 或 `VOIDED` 后，系统才允许继续发起新的会话。

`RESOLVED` 表示安全事件属实，已经完成复盘并采取补救措施，允许重新发起同一学生同一任务的新会话。

`VOIDED` 表示安全事件被管理员作废或被替代，但必须通过 `void_reason` 明确作废原因。系统不得将所有 `VOIDED` 一律解释为“误报”。

`void_reason` 至少包括：

- `FALSE_TRIGGER`：误触、误按、误报，事件不成立。
- `DUPLICATE_RECORD`：重复记录，真实事件以另一条 incident 为准。
- `NON_SAFETY_EVENT`：不属于安全红线事件。
- `FACTUAL_CORRECTION`：真实安全事件成立，但原记录核心事实字段有误，需要作废旧记录并新建修正后的 replacement incident。

教师不得将安全事件标记为 `RESOLVED` 或 `VOIDED`。管理员不得绕过 `safety_incident` 状态机直接恢复被红线熔断的测评或训练会话。

### 3.5 角色边界原则

MVP 阶段只开放学生端、教师端、管理员维护入口。

不开发家长端与企业端。

底层角色枚举可以保留扩展空间，但前端不得出现未实现角色入口。

## 4. 核心业务闭环

### 4.1 MVP 主流程

MVP 主流程如下：

1. 教师创建学生档案。
2. 教师选择“超市理货员 / 拆箱与上架”任务。
3. 系统根据策略配置生成测评会话。
4. 学生完成线上测评。
5. 系统记录答题结果并生成能力测评分。
6. 教师分配训练任务。
7. 学生按“看、学、练、做”完成训练。
8. 系统生成训练完成度。
9. 教师组织线下实操评分。
10. 教师按 0 / 1 / 2 评分规则提交实操结果。
11. 系统生成实操达标率。
12. 系统汇总三类结果。
13. 系统生成任务报告快照。
14. 教师查看、导出或锁定报告。

### 4.2 教师端流程

教师端流程为：

1. 登录。
2. 进入学生档案列表。
3. 选择学生或新建学生。
4. 检查学生感官信息。
5. 选择任务：拆箱与上架。
6. 发起测评。
7. 查看测评进度。
8. 处理异常或中断。
9. 查看能力测评分。
10. 分配训练任务。
11. 查看训练步骤完成情况。
12. 组织线下实操。
13. 提交线下评分。
14. 必要时触发安全红线。
15. 生成任务报告。
16. 导出报告。
17. 锁定报告。

### 4.3 学生端流程

学生端流程为：

1. 登录。
2. 进入今日任务。
3. 开始测评。
4. 完成线上题目。
5. 进入训练任务。
6. 完成“看”步骤：观看短视频。
7. 完成“学”步骤：学习图文步骤卡。
8. 完成“练”步骤：完成互动练习。
9. 完成“做”步骤：参与线下实操。
10. 必要时点击“我遇到困难了”。
11. 查看简化成果反馈。

### 4.4 “我遇到困难了”全局求助机制

学生端在测评、训练、视频播放、互动练习过程中，必须常驻显示“我遇到困难了”按钮。

点击后：

- 当前流程暂停。
- 当前视频暂停。
- 计时暂停。
- 系统生成情绪中断事件。
- 界面进入情绪支持层。
- 教师端看到学生已中断提示。

情绪支持层包含：

- 深呼吸提示卡。
- 安静等待提示。
- 请老师帮忙提示。
- 噪音烦躁应对提示。
- 任务太难时的求助提示。

恢复条件：

- 学生点击继续。
- 或教师端点击恢复。
- 系统生成恢复事件。
- 恢复后回到中断前步骤。

### 4.5 情绪中断与安全红线冲突规则

如果学生处于 `EMOTION_INTERRUPTED` 或 `SUSPENDED_REVIEW_REQUIRED` 状态时发生安全风险，教师点击安全红线后，安全红线优先级高于情绪中断。

系统必须立即执行红线流程：

- 创建 `safety_incident`。
- 批量熔断同一学生同一任务下所有开放会话。
- 将相关 session 置为 `REDLINE_HALTED`。
- 后续再由教师补充 `context_phase`、`reason_code` 和说明。

不得要求教师先选择“测评场景”或“训练场景”后才执行熔断。

### 4.6 情绪崩溃累计与等级判定联动

§4.4 描述的是**单次**情绪中断的可恢复机制。v1.0.5 新增情绪崩溃累计兜底：

- 单次情绪中断后**成功恢复**继续测评的，不计入崩溃次数。
- 单次情绪中断后**未恢复**（学生放弃或教师终止当前测评）的，计为一次「情绪崩溃」。
- 同一 `assessment_session` 内累计情绪崩溃次数达到 `strategy_config.emotion_collapse_threshold`（默认 `3`）时：
  - 系统记录 `EMOTION_COLLAPSE_THRESHOLD_REACHED` 事件。
  - 当前测评进入终止流程，结果强制判定为 `LEVEL_NOT_COMPETENT`（详见 §7.4 情绪崩溃兜底细则）。
  - 报告必须记录崩溃次数、每次崩溃的时间与当时所在的题目/步骤。

该规则与安全红线并存，互不替代：

- 情绪崩溃兜底影响的是**结果等级**，不会触发 `safety_incident`。
- 若崩溃期间同时出现安全风险，安全红线优先（§4.5）。

---

## 5. 核心功能需求

### 5.1 学生档案

#### 功能说明

教师可为学生建立最小必要档案，用于测评、训练、实操评分和报告归档。

#### 必填字段

- 学生姓名。
- 学生状态。
- 创建人。
- 创建时间。

#### 可选字段

- 性别。
- 出生日期。
- 监护人联系方式。
- 感官画像。

#### 感官画像字段

- 噪音敏感度。
- 光线敏感度。
- 触觉敏感度。
- 人群密度敏感度。
- 需要避让的场景标签。

#### 产品规则

- MVP 不做复杂医学档案。
- 学生档案只记录与教学和任务适配直接相关的信息。
- 学生档案中的感官标签可影响题目与资源选择。
- 学生档案不允许物理删除，只允许归档。

### 5.2 任务与岗位配置

#### 功能说明

系统以岗位和任务为配置单元，不把理货员业务写死在页面中。

MVP 默认岗位：

- 超市理货员。

MVP 默认任务：

- 拆箱与上架。

#### 任务内容

拆箱与上架任务至少包含以下动作：

1. 识别纸箱。
2. 检查箱体是否破损。
3. 按安全方式打开包装。
4. 取出商品。
5. 检查商品外观。
6. 识别货架位置。
7. 按规则摆放。
8. 整理排面。
9. 完成后确认。

#### 产品规则

- 岗位、任务、题目、训练资源必须通过配置驱动。
- 前端组件只负责展示和交互。
- 不得在前端组件中硬编码“理货员”专属逻辑。

### 5.3 题库与资源

#### 题目类型

MVP 支持四类题：

- 判断题 `TRUE_FALSE`
- 单选题 `SINGLE_CHOICE`
- 拖拽题 `DRAG`
- 线下实操题 `OFFLINE_OPERATION`

#### 题目模块

题目可归属以下模块：

- 精细动作 `FINE_MOTOR`
- 认知理解 `COGNITION`
- 规则执行 `RULE_EXECUTION`
- 情绪调节 `EMOTION_REGULATION`
- 基础社交 `BASIC_SOCIAL`
- 安全操作 `SAFETY_OPERATION`

#### 资源类型

系统支持以下本地资源：

- 视频。
- 图片。
- 音频。
- PDF。
- 教具清单。

#### 产品规则

- 题库不存储视频、图片、PDF 二进制。
- 题库只保存资源 ID 或本地资源路径。
- 本地资源必须通过资源表登记。
- 资源需要记录文件哈希、文件大小、资源状态、最近校验时间。
- 资源访问应通过应用私有协议，例如 `app://`。
- 视频加载失败、资源缺失、哈希不一致必须进入异常中心。

### 5.3.1 基础能力评估题库入库规则

`通用基础能力评估题库.xlsx` 可作为基础能力评估题库的种子来源，但不得直接全量发布为正式可用题库。

入库目标表：

- `question_bank`

入库默认状态：

- `DRAFT`

转为 `ACTIVE` 的前置条件：

1. 题干已审核。
2. 能力维度标签已审核。
3. 题型已确认。
4. 难度等级已映射。
5. 正确答案或评分 rubric 已补齐。
6. 所需视频、图片、拖拽素材、音频、PDF、教具清单等资源已登记到 `asset_resource`。
7. 本地资源通过 hash 校验。
8. 感官标签、低刺激替代说明和安全敏感标记已确认。
9. 管理员或被授权教师完成内容审核。

CSV 字段建议映射：

| CSV 字段 | 入库目标 |
|---|---|
| 模块标题 | `question_bank.module_type` |
| 题型标题 | `question_bank.question_type` |
| 考察点 | `content_json.assessment_point` |
| 题目 | `content_json.prompt` |
| 素材内容描述 | `content_json.media_brief` 或 `content_json.offline_tool_brief` |
| 能力维度标签 | `content_json.ability_tags` |
| 考察难度 | `difficulty_level` |
| 计分规则 | `scoring_rule_json.rubric` |
| 备注 | `content_json.note` |

能力模块映射：

| CSV 模块 | `module_type` |
|---|---|
| 精细动作能力 | `FINE_MOTOR` |
| 认知理解能力 | `COGNITION` |
| 规则执行能力 | `RULE_EXECUTION` |
| 情绪调节能力 | `EMOTION_REGULATION` |
| 基础社交能力 | `BASIC_SOCIAL` |
| 安全操作能力 | `SAFETY_OPERATION` |

题型映射：

| CSV 题型 | `question_type` |
|---|---|
| 判断题 | `TRUE_FALSE` |
| 单项选择题 | `SINGLE_CHOICE` |
| 拖拽题 | `DRAG` |
| 实物操作题 / 实操题 | `OFFLINE_OPERATION` |

难度映射：

| CSV 难度 | `difficulty_level` |
|---|---|
| 低级 | `1` |
| 中级 | `3` |
| 高级 | `5` |

题库导入必须生成 `import_batch_id`，并将源文件名、源行号、导入时间、导入人写入 `content_json.source` 或后续专门的导入批次表中。MVP 可先写入 `content_json.source`，后续 `schema v0.2.0-question-paper` 再拆出正式导入批次表。

题目 ID 建议采用稳定命名，不使用随机 UUID 作为唯一识别来源。例如：

```text
Q_BASE_FINE_MOTOR_TF_001
Q_BASE_FINE_MOTOR_SC_001
Q_BASE_FINE_MOTOR_DRAG_001
Q_BASE_FINE_MOTOR_OFFLINE_001
Q_BASE_COGNITION_TF_001
```

判断题需要特别处理。CSV 中大量判断题以“正确版 / 错误版素材描述”的形式存在，这类内容本质是题目蓝本，不是已经绑定素材和正确答案的最终题。正式发布前必须选择以下方式之一：

1. 拆成两道正式题：正确素材题 `expected_answer = TRUE`，错误素材题 `expected_answer = FALSE`。
2. 在 `content_json.variants` 中登记正确版与错误版素材变体，并在出题时由策略选择具体变体。

安全操作题不得等同于安全红线。`SAFETY_OPERATION` 只表示题目能力维度；学生答错安全操作题通常记为 0 分，不自动创建 `safety_incident`。只有真实测评、训练、线下实操或教具准备现场出现明确危险行为时，才进入安全红线流程。

基础能力题库导入后的审核状态建议：

- `DRAFT`：草稿题；素材、答案、计分规则或审核未完成。
- `ACTIVE`：可正式用于测评或训练。
- `DISABLED`：内容通过但暂不参与组卷。
- `ARCHIVED`：历史题保留，不再使用。

MVP 当前 schema 未提供完整试卷表。公共模拟卷 1 / 2 / 3、老师自定义试卷、试卷复制、编辑、下发、PDF 导出等功能不得强行塞入 `question_bank`，应在后续 `schema v0.2.0-question-paper` 中通过 `assessment_paper`、`assessment_paper_question` 等正式模型实现。

### 5.4 测评功能

#### 功能说明

教师发起测评后，学生进入基础能力评估流程。测评评估学生在精细动作、认知理解、规则执行、情绪调节、基础社交、安全操作 6 大基础能力维度上的通用水平，作为后续训练、实操评分与就业安置方向建议的基线。

v1.0.5 起，MVP 测评环节即基础能力评估，不再区分「拆箱与上架任务测评」与「基础能力标准化模拟卷」两套口径。

#### 测评规则

测评题量、题型比例、满分、阈值、模块兜底与情绪崩溃兜底阈值均由 `strategy_config` 决定。

MVP 不允许在代码中硬编码题量和阈值。

MVP 基础能力评估的默认策略采用：

- 线上题 **42 题**（6 大模块 × 每模块 7 题）。
- 线下题 **8 题**。
- 满分 **100 分**（50 题 × 每题最高 2 分）。
- 每题 `0 / 1 / 2` 分。
- 等级阈值：`LEVEL_COMPETENT >= 80`；`LEVEL_CONDITIONAL >= 60`；`< 60` 为 `LEVEL_NOT_COMPETENT`。
- 模块兜底阈值：任一模块得分率 `< 50%` 触发 `LEVEL_NOT_COMPETENT`。
- 情绪崩溃兜底阈值：同一测评会话累计 **3 次**情绪崩溃无法继续触发 `LEVEL_NOT_COMPETENT`（具体次数由 `strategy_config` 配置，默认 3）。
- `LEVEL_FAIL_BY_SAFETY` 优先级高于上述一切分数与兜底判定。

后续「公共标准模拟卷 1 / 2 / 3」「教师自定义试卷」等多套试卷管理能力进入 `schema v0.2.0-question-paper` 的正式试卷模型，但题量与分值结构沿用本节口径。

#### 测评过程

1. 学生进入测评。
2. 系统展示题目。
3. 学生提交答案。
4. 系统每题提交后立即生成答题事件。
5. 系统写入 `action_log.jsonl`。
6. 系统回放事件并更新 SQLite 投影。
7. 系统记录 `answer_record`。
8. 测评完成后计算 6 大模块各自得分率与综合得分。
9. 系统按 §7.3 / §7.4 规则判定等级：先检查安全红线 / 模块兜底 / 情绪崩溃兜底，再按分数阈值落档。
10. 系统生成 `ABILITY_SCORE` 结果（含 `level_result` 与 `normalized_score`）。

#### 产品规则

- 学生提交后的答案不得直接覆盖。
- 如需修改，必须通过 revision 机制生成新记录。
- 测评中断后必须支持恢复。
- 异常退出后不得丢失已提交题目。
- 测评完成后进入终态，不允许直接修改状态。
- 模块得分率、崩溃次数与等级判定依据必须随结果记录一同持久化，不得只存最终等级。

### 5.5 四步训练功能

#### 功能说明

训练任务采用固定四步法：

1. 看。
2. 学。
3. 练。
4. 做。

每一步都要被系统单独记录，不能只用一个“已完成”按钮替代。

#### 步骤 1：看

学生观看 15-30 秒实拍或动画指导视频。

系统记录：

- 开始时间。
- 完成时间。
- 是否完整播放。
- 是否中断。
- 是否跳过。

#### 步骤 2：学

学生查看图文步骤卡。

每张步骤卡只表达一个动作。

文字尽量控制在 20 字以内。

系统记录：

- 查看步骤数。
- 完成状态。
- 是否跳过。

#### 步骤 3：练

学生完成互动练习。

可采用拖拽排序、选择判断、匹配等形式。

系统记录：

- 练习开始时间。
- 提交结果。
- 错误次数。
- 完成状态。
- 重试次数。

#### 步骤 4：做

学生进入线下实操准备阶段。

教师根据教具清单组织实物操作。

系统记录：

- 是否进入线下做阶段。
- 是否完成教具确认。
- 是否进入教师评分。

#### 训练完成度计算

训练完成度来自 `training_session` 与 `training_step_record`。

训练完成度结果类型为 `TRAINING_COMPLETION`。

MVP 阶段按四步均分：

- 看：25%。
- 学：25%。
- 练：25%。
- 做：25%。

若某一步被跳过，不计为完成。

若某一步失败后重试成功，则该步骤可计为完成，但应记录失败次数与重试次数。

若因安全红线终止，训练结果必须显示安全终止，且 `safety_overridden = 1`。

#### 非线性与重试规则

训练步骤不是严格一次性线性流程。MVP 支持以下重试规则：

1. 学生在“练”步骤失败后，可以重试同一步。
2. 教师可以将学生从“做”步骤退回到“练”步骤继续练习。
3. 单个训练步骤可以被标记为 `FAILED`，但 `FAILED` 不是 training_session 终态。
4. `FAILED` 后允许进入 `IN_PROGRESS` 重新尝试。
5. 教师可以标记“需重训”，但不得覆盖原训练步骤记录。
6. 重训应生成新的训练步骤记录或新的训练 session，不得静默改写历史。
7. 训练完成度展示应同时显示完成比例、跳过步骤、失败次数和重试次数。

### 5.6 线下实操评分

#### 功能说明

教师在线下观察学生完成“拆箱与上架”任务，并按标准提交评分。

MVP 不新增独立 `practical_evaluation_session`。

实操评分由 `assessment_session` 的 offline 阶段承载。

实操达标率 `OPERATION_PASS_RATE` 来自 `offline_score_record` 投影。

#### 评分标准

每个实操评分项采用 0 / 1 / 2：

- 0 = 不达标。
- 1 = 需改进或需辅助。
- 2 = 达标。

#### 评分流程

1. 教师进入实操评分页。
2. 系统展示当前任务和评分项。
3. 教师确认教具清单已准备。
4. 学生执行实操。
5. 教师逐项评分。
6. 教师可填写观察备注。
7. 教师提交评分。
8. 系统生成 `OFFLINE_SCORE_SUBMITTED` 事件。
9. 系统写入 `offline_score_record`。
10. 系统生成 `OPERATION_PASS_RATE` 结果。

#### 产品规则

- 教师评分提交后不得直接 UPDATE 覆盖。
- 如需修正，必须通过 revision 机制生成新版本。
- 最终报告只读取当前有效版本。
- 评分未完成时不得生成完整任务报告。
- 安全红线触发后不得继续按普通评分结论判定达标。

### 5.7 安全红线熔断

#### 功能说明

安全红线是学生任务级全局事件。

它不是 `assessment_session` 或 `training_session` 的附属动作。

当学生在测评、训练、线下实操、教具准备、课间过渡等场景中出现明显安全风险时，教师必须能够立即记录安全事件。

#### 典型红线原因

- 刀具或模拟工具朝向自己。
- 刀具或模拟工具朝向他人。
- 危险攀爬。
- 投掷物品。
- 攻击行为。
- 其他安全风险。

#### 先熔断、后归因、管理员解除原则

安全红线遵循：**先熔断，后归因，管理员解除**。

教师点击安全红线按钮后，系统不得要求教师先判断红线属于测评还是训练。

正确流程：

1. 教师点击红线按钮。
2. 系统立即创建 `PENDING_DETAIL` 状态的 `safety_incident`。
3. 系统查询同一 `student_id + task_code` 下所有开放 `assessment_session`。
4. 系统查询同一 `student_id + task_code` 下所有开放 `training_session`。
5. 系统将所有开放会话批量更新为 `REDLINE_HALTED`。
6. 系统为每个受影响会话生成 `safety_incident_binding`。
7. 系统暂停媒体、输入和计时。
8. 系统显示安全中止界面。
9. 教师先处理现场安全。
10. 教师事后补充 `context_phase`、`reason_code` 和 `description`。
11. 教师确认事实后，将事件从 `PENDING_DETAIL` 推进至 `CONFIRMED`。
12. 管理员完成复盘后，将事件标记为 `RESOLVED`；若需要作废，则标记为 `VOIDED`，并必须填写 `void_reason`。

红线触发后，教师不得直接恢复训练或测评。系统必须阻断该学生该任务的新会话，直到管理员完成复盘并将安全事件标记为 `RESOLVED`，或按明确 `void_reason` 将事件标记为 `VOIDED`。

#### 安全事件上下文 context_phase

`context_phase` 用于事后归因，不作为红线触发前置条件。

建议枚举：

- `ONLINE_ASSESSMENT`
- `TRAINING_WATCH`
- `TRAINING_LEARN`
- `TRAINING_PRACTICE`
- `TRAINING_DO`
- `OFFLINE_SCORING`
- `TOOL_PREPARATION`
- `BREAK_OR_TRANSITION`
- `OTHER`

#### 有开放会话时的红线规则

如果触发红线时存在开放 `assessment_session` 或 `training_session`：

- 所有相关开放会话必须进入 `REDLINE_HALTED`。
- 每个被熔断会话必须生成一条 `safety_incident_binding`。
- binding 必须记录 `aggregate_type`、`aggregate_id`、`pre_status`、`post_status`。
- `post_status` 固定为 `REDLINE_HALTED`。
- 被熔断 session 的 `redline_incident_id` 必须指向同一 `student_id + task_code` 的 `safety_incident`。
- 不得将一个学生或一个任务的安全事件错误绑定到另一个学生或另一个任务的 session。
- 相关 `result_record` 必须 `safety_overridden = 1`。
- 相关 `level_result` 必须为 `LEVEL_FAIL_BY_SAFETY`。
- 后续只能生成 `SAFETY_TERMINATION_REPORT`。

#### 无开放会话时的红线规则

如果触发红线时不存在开放 `assessment_session` 或 `training_session`：

- 仍必须允许创建 `safety_incident`。
- 不生成 `safety_incident_binding`。
- 不生成 `result_record`。
- 不更新 session 状态。
- 必须设置 `requires_review_before_next_session = 1`。
- 后续教师尝试为同一学生同一任务发起新测评或训练时，系统必须阻断。
- 只有该安全事件状态变为 `RESOLVED` 或 `VOIDED` 后，才允许继续新会话。

#### 安全事件两级权限

教师可以执行：

- 创建 `PENDING_DETAIL`。
- 补充 `reason_code`、`context_phase`、`description`。
- 将 `PENDING_DETAIL` 推进到 `CONFIRMED`。

教师不可以执行：

- `PENDING_DETAIL -> VOIDED`。
- `PENDING_DETAIL -> RESOLVED`。
- `CONFIRMED -> RESOLVED`。
- `CONFIRMED -> VOIDED`。

管理员可以执行：

- `PENDING_DETAIL -> VOIDED`。
- `CONFIRMED -> RESOLVED`。
- `CONFIRMED -> VOIDED`。

管理员解除安全阻断时，必须通过 `safety_incident` 状态流转完成，不得直接修改 session 或绕过审计日志。

#### safety_incident 生命周期

`safety_incident` 状态包括：

- `PENDING_DETAIL`：红线已触发，等待教师补充细节。
- `CONFIRMED`：事件事实已确认，等待管理员复盘处理。
- `RESOLVED`：事件属实，已完成复盘并采取补救措施，可以重新发起同一学生同一任务的新会话。
- `VOIDED`：事件被管理员作废或被替代。该状态本身不表达“误报”，必须结合 `void_reason` 判断统计口径。

合法状态流转：

```text
PENDING_DETAIL -> CONFIRMED
PENDING_DETAIL -> VOIDED
CONFIRMED -> RESOLVED
CONFIRMED -> VOIDED
```

禁止状态流转：

```text
PENDING_DETAIL -> RESOLVED
CONFIRMED -> PENDING_DETAIL
RESOLVED -> CONFIRMED
VOIDED -> CONFIRMED
RESOLVED -> VOIDED
VOIDED -> RESOLVED
RESOLVED -> PENDING_DETAIL
VOIDED -> PENDING_DETAIL
```

`RESOLVED` 和 `VOIDED` 均为终态。终态 `safety_incident` 不允许再次变更状态，也不允许修改核心事实字段。

#### safety_incident 事实冻结规则

`PENDING_DETAIL` 是安全事件事实补充阶段，也是教师补充或修正事件细节的唯一窗口。

在 `PENDING_DETAIL` 状态下，教师可以补充或修正：

- `reason_code`
- `context_phase`
- `description`

当教师将安全事件从 `PENDING_DETAIL` 推进至 `CONFIRMED` 后，事件事实即被冻结。`CONFIRMED` 状态下不得原地修改核心事实字段。

核心事实字段至少包括：

- `student_id`
- `job_code`
- `task_code`
- `reason_code`
- `context_phase`
- `description`
- `triggered_by`
- `confirmed_by`
- `occurred_at`

若 `CONFIRMED` 后发现事实记录错误，MVP 阶段不允许静默 `UPDATE` 修正。处理方式为：由管理员通过事实修正作废重建流程，将旧安全事件标记为 `VOIDED` 且 `void_reason = FACTUAL_CORRECTION`，并在同一事务中创建新的 replacement `safety_incident`。旧事件的 `replacement_incident_id` 必须指向新事件。后续版本如需支持更精细的事实修订，应通过独立的安全事件修订事件实现，而不是直接覆盖原记录。

`CONFIRMED / RESOLVED / VOIDED` 状态下均不得原地修改上述核心事实字段。`RESOLVED` 和 `VOIDED` 继续作为终态，不得回退或互转。

#### VOIDED 语义分型与作废重建规则

`VOIDED` 是安全事件生命周期的终态之一，但 `VOIDED` 不等于“误报”。所有进入 `VOIDED` 的安全事件必须填写 `void_reason`，用于区分作废原因和后续统计口径。

`void_reason` 枚举包括：

- `FALSE_TRIGGER`：误触、误按、误报，事件不成立。
- `DUPLICATE_RECORD`：重复记录，真实事件以另一条 incident 为准。
- `NON_SAFETY_EVENT`：不属于安全红线事件，应作为普通教学异常或行为记录另行处理。
- `FACTUAL_CORRECTION`：真实安全事件成立，但原记录的核心事实字段记录错误，需要作废旧记录并新建修正后的 replacement incident。

字段规则：

- `status = VOIDED` 时，`void_reason` 必须非空。
- `status != VOIDED` 时，`void_reason` 必须为空。
- `void_reason = FACTUAL_CORRECTION` 时，`replacement_incident_id` 必须非空，并指向同一 `student_id + task_code` 下的新 safety_incident。
- `void_reason = DUPLICATE_RECORD` 时，`replacement_incident_id` 应指向保留的主 incident。
- `replacement_incident_id` 不得等于自身 `incident_id`。
- `FALSE_TRIGGER / NON_SAFETY_EVENT` 可以不填写 `replacement_incident_id`。

当 `CONFIRMED` 后发现核心事实字段错误时，系统不得先将旧事件 `VOIDED` 再由人工另行创建新事件。正确动作必须由领域服务在同一数据库事务中完成：

1. 创建新的 replacement safety_incident。
2. 将旧 safety_incident 更新为 `status = VOIDED`。
3. 设置旧事件 `void_reason = FACTUAL_CORRECTION`。
4. 设置旧事件 `replacement_incident_id = 新 incident_id`。
5. 确保 replacement safety_incident 继续阻断同一学生同一任务的新 session，直到管理员后续处理为 `RESOLVED` 或具备明确原因的 `VOIDED`。

该动作应对应领域命令 `ReplaceSafetyIncidentForFactualCorrection` 或领域事件 `SAFETY_INCIDENT_REPLACED_FOR_FACTUAL_CORRECTION`。不得拆成两次独立 IPC 操作，以免在旧事件作废与新事件创建之间出现新会话发起空窗。

#### 未解决安全事件规则

所有 `PENDING_DETAIL` 或 `CONFIRMED` 状态的安全事件，必须满足：

```text
requires_review_before_next_session = 1
```

系统不得允许未解决安全事件静默存在。

#### 红线前记录保留规则

红线触发前已经存在的：

- `answer_record`
- `offline_score_record`
- `training_step_record`

不得删除、不得覆盖。

这些记录在报告中展示为“红线触发前过程记录”，不得作为普通达标判断依据。

### 5.8 任务报告

#### 功能说明

任务报告是一次闭环结果的快照，不是实时页面。

报告生成时必须固化当时的三类结果：

- 能力测评分。
- 训练完成度。
- 实操达标率。

#### 报告类型

- 完整任务报告 `FULL_REPORT`
- 安全中止报告 `SAFETY_TERMINATION_REPORT`

#### 报告状态

- `GENERATED`：已生成。
- `LOCKED`：已锁定。
- `EXPORTED`：已导出。
- `SUPERSEDED`：已被新版本替代。
- `ARCHIVED`：已归档。
- `FAILED`：生成失败。

MVP 不提供报告草稿编辑流，因此不设置 `DRAFT` 状态。

#### 报告内容

- 学生基础信息。
- 任务名称。
- 测评时间。
- 训练时间。
- 实操评分时间。
- 能力测评分（含等级 `LEVEL_COMPETENT` / `LEVEL_CONDITIONAL` / `LEVEL_NOT_COMPETENT` / `LEVEL_FAIL_BY_SAFETY` 之一）。
- 6 大基础能力模块得分明细（用于模块兜底可视化）。
- 训练完成度。
- 实操达标率。
- 安全红线记录。
- 情绪崩溃次数（若触发兜底，必须记录每次崩溃时间）。
- 教师观察备注。
- 系统建议结论。
- **就业安置方向建议（v1.0.5 新增）**：基于 `ABILITY_SCORE` 等级映射，详见 §7.4。
- 报告生成时间。
- 报告版本信息。

#### 产品规则

- 报告一旦生成，不应被新结果覆盖。
- 重测或复评后生成新报告。
- 旧报告进入 `SUPERSEDED` 或 `ARCHIVED`。
- `LOCKED` 报告不可修改。
- 导出失败不应删除报告快照。
- `REDLINE_HALTED` 来源不得生成 `FULL_REPORT`。
- 安全红线后只能生成 `SAFETY_TERMINATION_REPORT`。

---

## 6. 会话并发与开放态唯一性

### 6.1 开放态定义

#### AssessmentSession 开放态

- `INIT`
- `ACTIVE`
- `EMOTION_INTERRUPTED`
- `SUSPENDED_REVIEW_REQUIRED`
- `OFFLINE_PENDING`

#### AssessmentSession 终态

- `COMPLETED`
- `REDLINE_HALTED`
- `ABORTED`

#### TrainingSession 开放态

- `INIT`
- `ACTIVE`
- `EMOTION_INTERRUPTED`
- `SUSPENDED_REVIEW_REQUIRED`

#### TrainingSession 终态

- `COMPLETED`
- `REDLINE_HALTED`
- `ABORTED`

### 6.2 唯一开放会话约束

数据库层必须强制：

1. 同一 `student_id + task_code + strategy_type` 下，只允许存在一个开放态 `assessment_session`。
2. 同一 `student_id + task_code` 下，只允许存在一个开放态 `training_session`。

这必须通过 partial unique index 实现，不得只依赖前端判断。

### 6.3 重复发起处理

如果教师重复点击“发起测评”：

- 系统不得创建新 `assessment_session`。
- 系统应提示已有未完成测评。
- 教师可选择继续原测评、作废后重开，或取消操作。

如果教师重复点击“分配训练”：

- 系统不得创建新 `training_session`。
- 系统应提示已有进行中训练。
- 教师可选择继续训练、标记需重训，或取消操作。

### 6.4 未解决安全事件阻断新会话

如果同一 `student_id + task_code` 下存在状态为：

- `PENDING_DETAIL`
- `CONFIRMED`

且 `requires_review_before_next_session = 1` 的安全事件，则系统必须阻断新建 `assessment_session` 和 `training_session`。

安全事件进入以下终态后，系统才允许继续发起新会话：

- `RESOLVED`
- `VOIDED`

但 `VOIDED` 必须具备明确 `void_reason`。其中：

- `FALSE_TRIGGER` 与 `NON_SAFETY_EVENT` 可以解除阻断。
- `DUPLICATE_RECORD` 必须通过 `replacement_incident_id` 指向保留的主 incident，由主 incident 承接后续阻断或处理状态。
- `FACTUAL_CORRECTION` 必须通过 `replacement_incident_id` 指向 replacement incident，由 replacement incident 承接真实安全事件与后续阻断责任。

系统不得在旧 incident 已 `VOIDED`、replacement incident 尚未创建或尚未承担阻断责任的窗口内允许新会话发起。

---

## 7. 评分模型与结果体系

### 7.1 三类结果

MVP 固定展示三类结果。

#### 第一类：能力测评分 ABILITY_SCORE

用于回答：

学生在 6 大基础能力维度上是否具备进入目标岗位的基础能力水平？

v1.0.5 起，`ABILITY_SCORE` 由基础能力评估（线上 42 题 + 线下 8 题 / 满分 100）产生。线上题与线下题属于同一类结果内部的分值结构（详见 §7.5 澄清），不违反三类结果独立原则。结果按 §7.4 规则触发模块兜底与情绪崩溃兜底。

来源：

- `answer_record`
- `assessment_session`
- `strategy_config`（含 `pass_threshold` / `improve_threshold` / `scoring_policy_json` 中的 `module_veto_threshold` 与 `emotion_collapse_threshold`）

#### 第二类：训练完成度 TRAINING_COMPLETION

用于回答：

学生是否完成结构化训练过程？

来源：

- `training_session`
- `training_step_record`

#### 第三类：实操达标率 OPERATION_PASS_RATE

用于回答：

学生是否能在线下真实或半真实环境中完成任务？

来源：

- `assessment_session` 的 offline 阶段
- `offline_score_record`

### 7.2 统一百分制模型

所有结果底层统一记录：

- `raw_score`
- `max_score`
- `normalized_score`
- `level_result`
- `result_type`
- `strategy_type`
- `source_aggregate_type`
- `source_aggregate_id`
- `calculated_event_id`
- `is_current`
- `safety_overridden`
- `redline_incident_id`

统一公式：

```text
normalized_score = raw_score / max_score * 100
```

基础能力评估的分值结构（v1.0.5）：

- 50 道题，每题最高 2 分，`max_score = 100`。
- 因此 `normalized_score` 与 `raw_score` 数值一致，无需再做归一化换算。
- 但 `raw_score / max_score * 100` 公式仍须保留，用于：
  - 后续题量或分值结构变更时（例如试卷模型 v0.2.0 引入非 50 题试卷）的通用性。
  - 训练完成度 `TRAINING_COMPLETION` 与实操达标率 `OPERATION_PASS_RATE` 的非百分制 raw 来源归一化。

`raw_score` 与 `max_score` 必须在 `result_record` 中独立记录，不得只存 `normalized_score`。

### 7.3 结果等级

v1.0.5 起基础能力评估的结果等级采用新三档，旧枚举 `LEVEL_PASS / LEVEL_IMPROVE / LEVEL_FAIL` 废止。

默认等级：

- `LEVEL_COMPETENT`：基础能力胜任。
- `LEVEL_CONDITIONAL`：有条件胜任（过渡区间）。
- `LEVEL_NOT_COMPETENT`：完全不胜任。
- `LEVEL_FAIL_BY_SAFETY`：安全红线失败（覆盖性等级，优先级最高）。

等级阈值由 `strategy_config` 控制。

MVP 默认阈值：

- `normalized_score >= 80`：`LEVEL_COMPETENT`
- `60 <= normalized_score < 80`：`LEVEL_CONDITIONAL`
- `normalized_score < 60`：`LEVEL_NOT_COMPETENT`
- 安全红线触发：`LEVEL_FAIL_BY_SAFETY`（优先级高于一切分数判定）
- 模块兜底触发（任一模块得分率 `< 50%`）：强制 `LEVEL_NOT_COMPETENT`
- 情绪崩溃兜底触发（累计情绪崩溃次数达阈值）：强制 `LEVEL_NOT_COMPETENT`

等级判定优先级（从高到低）：

1. `LEVEL_FAIL_BY_SAFETY`（安全红线）
2. `LEVEL_NOT_COMPETENT`（模块兜底 / 情绪崩溃兜底）
3. 按分数阈值的 `LEVEL_COMPETENT / LEVEL_CONDITIONAL / LEVEL_NOT_COMPETENT`

旧枚举迁移说明：本次 PRD 修订不要求保留 `LEVEL_PASS / LEVEL_IMPROVE / LEVEL_FAIL` 字符串兼容。代码层如有引用，须一次性切换到新枚举。

### 7.4 综合建议结论

系统不展示单一总分。

系统展示“三类结果 + 任务建议结论 + 就业安置方向”。

#### 任务建议结论规则（按优先级从高到低）

1. **安全红线覆盖**：若 `safety_overridden = 1`，结论为“安全中止，暂不建议继续该任务实操”，就业安置方向不输出。
2. **模块级一票否决**：若任一基础能力模块（线上或线下）得分率 `< 50%`，结论为“核心模块能力缺失，建议针对薄弱模块进行专项训练”，等级强制为 `LEVEL_NOT_COMPETENT`。
3. **情绪崩溃兜底**：若同一测评会话累计情绪崩溃次数达 `strategy_config` 阈值，结论为“情绪调节稳定性不足，建议先进行情绪调节训练再复测”，等级强制为 `LEVEL_NOT_COMPETENT`。
4. **实操未达标**：若 `OPERATION_PASS_RATE` 等级未达 `LEVEL_COMPETENT`，结论为“建议继续实操训练”。
5. **训练未完成**：若 `TRAINING_COMPLETION` 未完成，结论为“建议补完训练流程”。
6. **基础能力偏低**：若 `ABILITY_SCORE` 等级为 `LEVEL_NOT_COMPETENT` 或 `LEVEL_CONDITIONAL`，结论为“建议回到对应能力模块的巩固训练”。
7. **三类结果均胜任**：若三类结果等级均为 `LEVEL_COMPETENT`，结论为“当前任务阶段性达标，可进入下一阶段任务或岗位实操”。

#### 就业安置方向（基于 `ABILITY_SCORE` 等级，纳入报告 §5.8）

| `ABILITY_SCORE` 等级 | 分数线 | 就业安置方向 | 说明 |
|---|---|---|---|
| `LEVEL_NOT_COMPETENT` | `< 60` 或被模块/情绪兜底强制判定 | 日间照料 / 支持性转介 | 暂不具备进入真实工作岗位的条件，建议继续训练或转介日间照料机构 |
| `LEVEL_CONDITIONAL` | `60 ~ 79` | 支持性就业（Supported Employment） | 可在庇护工场或辅导员（Job Coach）陪同的岗位工作 |
| `LEVEL_COMPETENT` | `>= 80` | 竞争性就业（Competitive Employment） | 可独立进入真实企业的基础岗位（如超市、酒店、包装等） |
| `LEVEL_FAIL_BY_SAFETY` | 安全红线触发 | 不输出就业方向 | 报告类型为 `SAFETY_TERMINATION_REPORT`，仅输出安全中止结论 |

#### 模块级一票否决细则

- 6 大模块（精细动作、认知理解、规则执行、情绪调节、基础社交、安全操作）分别计算模块得分率 = 模块内已答题目实得分 / 模块内题目满分。
- 任一模块得分率 `< 50%` 即触发否决，无论其他模块分数多高、总分是否 >= 60。
- 线上模块与线下模块分别计算；线下 8 道实操题通过复合能力标签归入对应模块计入。
- 模块否决由结果计算阶段强制执行，不依赖教师判断；触发后必须在报告中明确指出是哪个模块触发否决。

#### 情绪崩溃兜底细则

- 同一 `assessment_session` 内累计因情绪崩溃（§4.4「我遇到困难了」按钮触发后未恢复而终止当前测评）的次数，由 `strategy_config.emotion_collapse_threshold` 配置，默认 `3`。
- 单次情绪中断后恢复继续的，不计入崩溃次数；只有中断后未恢复（学生放弃或教师终止）才计为一次崩溃。
- 触发兜底后等级强制为 `LEVEL_NOT_COMPETENT`，报告必须记录崩溃次数与触发时间。
- 该规则与 §4.4 单次情绪中断机制并存：单次中断仍可恢复，不影响等级；累计崩溃才触发兜底。

### 7.5 禁止混算规则

能力测评分、训练完成度、实操达标率不得直接平均成一个总分。

教师端可以展示三类结果卡片或趋势，但不得用单一总分替代教学判断。

v1.0.5 澄清：基础能力评估的「线上 42 题 + 线下 8 题合并为满分 100」属于 **`ABILITY_SCORE` 内部**的分值结构，不违反本条规则。三类结果（`ABILITY_SCORE` / `TRAINING_COMPLETION` / `OPERATION_PASS_RATE`）之间的独立原则不变，仍然禁止相互平均或合成单一总分。

### 7.6 策略配置版本锁定

`strategy_config` 是测评、训练、组卷、评分与阈值的唯一策略配置源。为了保证历史测评、训练结果和报告可复现，session 创建时必须锁定当时使用的策略版本。

产品规则：

1. `strategy_config` 必须有版本号。
2. 新建 `assessment_session` 或 `training_session` 时，必须记录 `strategy_id`、`strategy_type`、`strategy_version`。
3. 如 schema 提供 `strategy_snapshot_json`，创建 session 时应保存策略快照；若 MVP 暂不启用快照，也必须通过“已引用策略版本不可改写”保证历史可复现。
4. 进行中的 session 不受管理员后续新增策略版本影响。
5. 历史结果必须能按当时的 `strategy_id + strategy_version` 复现。
6. 报告生成时必须记录本次结果使用的策略版本。
7. `assessment_session` 创建或更新 `strategy_id / strategy_type / job_code / strategy_version` 时，必须共同匹配 `strategy_config` 中同一行。
8. `training_session` 创建或更新 `strategy_id / strategy_type / job_code / strategy_version` 时，必须共同匹配 `strategy_config` 中同一行。
9. `training_session.strategy_id` 在业务语义上必须非空；即使表定义为兼容性原因暂时允许 NULL，也必须由 schema 触发器或领域服务禁止写入 NULL。
10. **v1.0.5 阈值字段语义重解释**：`pass_threshold` 字段语义由 v1.0.4 的「达标线」改为「`LEVEL_COMPETENT` 基础能力胜任线」，默认值 `80`；`improve_threshold` 字段语义由「需改进线」改为「`LEVEL_CONDITIONAL` 有条件胜任线」，默认值 `60`。字段名暂不改（避免触及 schema），但语义、默认值、应用层解释全面切换。
11. **v1.0.5 新增子配置承载在 `scoring_policy_json`**：包括 `module_veto_threshold`（模块否决阈值，默认 `0.5`，即 50%）与 `emotion_collapse_threshold`（情绪崩溃次数阈值，默认 `3`）。这两个子配置不新增 schema 字段，由应用层解析 `scoring_policy_json` 强制校验。
12. **schema DEFAULT 不信任原则**：`schema.sql v0.1.7` 中 `pass_threshold DEFAULT 70` 与 `improve_threshold DEFAULT 40` 与 v1.0.5 默认值不一致。MVP seed 数据必须显式写入 `80 / 60`，覆盖 schema DEFAULT；应用层不得依赖 schema DEFAULT 推断阈值语义。
13. **schema v0.1.8 修订备忘**（非本次 PRD 范围）：将 `pass_threshold / improve_threshold` 重命名为 `competent_threshold / conditional_threshold`，调整 DEFAULT 为 `80 / 60`，并把 `module_veto_threshold / emotion_collapse_threshold` 提升为表级字段。本次 PRD 不修改 schema.sql，但要求 v0.1.8 修订时落地这些变更。

    > **落地状态（2026-07-01 更新）**：schema v0.1.8-base-ability-rebalance 已执行上述全部修订。本节及 §17.6 验收中后续出现的 `pass_threshold / improve_threshold` 字段名引用，应理解为 v0.1.8 重命名后的 `competent_threshold / conditional_threshold`；`scoring_policy_json` 不再承载四个阈值键（已提升为表级字段）。等级枚举 `LEVEL_PASS / LEVEL_IMPROVE / LEVEL_FAIL` 已一次性切换为 `LEVEL_COMPETENT / LEVEL_CONDITIONAL / LEVEL_NOT_COMPETENT`，代码层不得保留旧枚举兼容。

#### strategy_config 引用一致性保护

`schema.sql v0.1.7-consistency-guard` 要求 `assessment_session` 与 `training_session` 不得只引用 `strategy_id`，还必须同时校验 `strategy_type`、`job_code` 与 `strategy_version`。

合法 session 必须满足：

```text
strategy_config.strategy_id = session.strategy_id
strategy_config.strategy_type = session.strategy_type
strategy_config.job_code = session.job_code
strategy_config.version = session.strategy_version
```

如果上述任一字段不匹配，session 创建或更新必须失败。该规则用于防止错误 `strategy_version` 绕过“已引用策略版本不可改写”约束，保证历史结果和报告可复现。

#### 已引用策略版本不可改写

任何已经被 `assessment_session` 或 `training_session` 引用过的 `(strategy_id, version)` 组合，都视为历史事实的一部分。

已被引用的策略版本不得原地修改以下字段：

- `strategy_type`
- `job_code`
- `strategy_name`
- `online_question_count`
- `offline_question_count`
- `max_score`
- `pass_threshold`
- `improve_threshold`
- `question_policy_json`
- `scoring_policy_json`
- `supports_redline_halt`
- `allows_emotion_interrupt`
- `requires_offline_scoring`
- `version`

如需调整题量、题型比例、评分规则、阈值、红线策略或情绪中断策略，必须插入新的 `version`，不得 `UPDATE` 已被引用的旧版本。

MVP 允许对已引用策略版本进行非语义性维护操作的范围必须极窄。默认只允许修改 `is_active` 与 `updated_at`；若工程实现认为 `strategy_name` 也属于展示字段，MVP 仍应按历史报告可复现原则禁止修改，避免历史报告显示名称漂移。

#### 策略版本变更原则

管理员修改策略时，不是编辑旧策略版本，而是创建新版本。

示例：

- 错误做法：将已被引用的 `strategy_config(strategy_id='x', version=1)` 的 `pass_threshold` 从 70 原地改为 60。
- 正确做法：插入 `strategy_config(strategy_id='x', version=2)`，并将新 session 指向 version 2。

历史 session 始终通过 `strategy_id + strategy_version` 找回当时策略。后续版本可进一步增加 `strategy_snapshot_json` 强化复现能力，但 MVP 阶段至少必须禁止改写已被引用的策略版本。

---

## 8. 核心状态机

### 8.1 状态机总原则

所有状态变更必须由领域事件推进。

前端不得直接修改 session 状态。

主进程负责：

- 校验事件合法性。
- 写入 `action_log.jsonl`。
- 计算 checksum。
- 回放 reducer。
- 更新 SQLite 投影。
- 写入 `domain_event_projection`。
- 更新 `snapshot_meta`。

终态不可逆。

业务数据不可物理删除。

### 8.2 AssessmentSession 状态

状态枚举：

- `INIT`
- `ACTIVE`
- `EMOTION_INTERRUPTED`
- `SUSPENDED_REVIEW_REQUIRED`
- `OFFLINE_PENDING`
- `COMPLETED`
- `REDLINE_HALTED`
- `ABORTED`

核心流转：

- `INIT → ACTIVE`
- `ACTIVE → EMOTION_INTERRUPTED`
- `EMOTION_INTERRUPTED → ACTIVE`
- `ACTIVE → OFFLINE_PENDING`
- `OFFLINE_PENDING → COMPLETED`
- `ACTIVE → COMPLETED`
- `ACTIVE → ABORTED`

显式红线路径：

- `ACTIVE → REDLINE_HALTED`
- `EMOTION_INTERRUPTED → REDLINE_HALTED`
- `SUSPENDED_REVIEW_REQUIRED → REDLINE_HALTED`
- `OFFLINE_PENDING → REDLINE_HALTED`
- `INIT → REDLINE_HALTED` 仅允许通过 `safety_incident` 批量熔断触发，不允许普通 UI 直接触发。

终态：

- `COMPLETED`
- `REDLINE_HALTED`
- `ABORTED`

终态不可逆，不允许直接更新为其他状态。

### 8.3 TrainingSession 状态

状态枚举：

- `INIT`
- `ACTIVE`
- `EMOTION_INTERRUPTED`
- `SUSPENDED_REVIEW_REQUIRED`
- `COMPLETED`
- `REDLINE_HALTED`
- `ABORTED`

核心流转：

- `INIT → ACTIVE`
- `ACTIVE → EMOTION_INTERRUPTED`
- `EMOTION_INTERRUPTED → ACTIVE`
- `ACTIVE → COMPLETED`
- `ACTIVE → ABORTED`

显式红线路径：

- `ACTIVE → REDLINE_HALTED`
- `EMOTION_INTERRUPTED → REDLINE_HALTED`
- `SUSPENDED_REVIEW_REQUIRED → REDLINE_HALTED`
- `INIT → REDLINE_HALTED` 仅允许通过 `safety_incident` 批量熔断触发，不允许普通 UI 直接触发。

训练步骤记录状态：

- `NOT_STARTED`
- `IN_PROGRESS`
- `COMPLETED`
- `SKIPPED`
- `FAILED`

产品规则：

- 训练会话完成不等于任务达标。
- 训练步骤跳过不能算完成。
- 训练红线可触发 `REDLINE_HALTED`。
- 终态不可逆。

### 8.4 ResultRecord 状态

结果记录用于投影三类结果。

每个来源聚合、每种 `result_type` 只能有一个 current result。

旧结果不得覆盖。

如重新计算结果：

- 旧 `result_record` 标记为非 current。
- 新 `result_record` 成为 current。

安全覆盖结果必须满足：

- `safety_overridden = 1`
- `level_result = LEVEL_FAIL_BY_SAFETY`
- `redline_incident_id` 非空

### 8.5 TaskReport 状态

状态枚举：

- `GENERATED`
- `LOCKED`
- `EXPORTED`
- `SUPERSEDED`
- `ARCHIVED`
- `FAILED`

产品规则：

- 报告生成后形成快照。
- 报告锁定后不可修改。
- 重测或复评生成新报告时，旧报告应标记为 `SUPERSEDED`。
- 报告导出失败时，保留报告快照并记录异常。

### 8.6 SafetyIncident 状态

`safety_incident` 是学生任务级安全事件聚合。其生命周期独立于单一 session，但可通过 `safety_incident_binding` 影响一个或多个开放态 `assessment_session` / `training_session`。

安全事件状态：

- `PENDING_DETAIL`
- `CONFIRMED`
- `RESOLVED`
- `VOIDED`

状态语义：

- `PENDING_DETAIL`：红线已触发，等待教师补充细节。
- `CONFIRMED`：事件事实已确认，等待管理员复盘处理。
- `RESOLVED`：事件属实，已完成复盘并采取补救措施，可以重新发起同一学生同一任务的新会话。
- `VOIDED`：事件被管理员作废或被替代。该状态本身不表达“误报”，必须结合 `void_reason` 判断统计口径。

合法状态流转：

```text
PENDING_DETAIL -> CONFIRMED
PENDING_DETAIL -> VOIDED
CONFIRMED -> RESOLVED
CONFIRMED -> VOIDED
```

禁止状态流转：

```text
PENDING_DETAIL -> RESOLVED
CONFIRMED -> PENDING_DETAIL
RESOLVED -> CONFIRMED
VOIDED -> CONFIRMED
RESOLVED -> VOIDED
VOIDED -> RESOLVED
RESOLVED -> PENDING_DETAIL
VOIDED -> PENDING_DETAIL
```

权限约束：

- 教师 `TEACHER` 可以创建 `PENDING_DETAIL`。
- 教师 `TEACHER` 可以补充 `reason_code / context_phase / description`。
- 教师 `TEACHER` 可以执行 `PENDING_DETAIL -> CONFIRMED`。
- 教师 `TEACHER` 不得执行 `PENDING_DETAIL -> VOIDED`、`CONFIRMED -> RESOLVED`、`CONFIRMED -> VOIDED`。
- 管理员 `ADMIN` 可以执行 `PENDING_DETAIL -> VOIDED`。
- 管理员 `ADMIN` 可以执行 `CONFIRMED -> RESOLVED`。
- 管理员 `ADMIN` 可以执行 `CONFIRMED -> VOIDED`。

字段约束：

- 创建 `PENDING_DETAIL` 时，`triggered_by` 必须非空，且操作者角色应为 `TEACHER` 或 `ADMIN`。MVP 默认由教师触发。
- `PENDING_DETAIL -> CONFIRMED` 时，`confirmed_by` 必须非空，且对应 `user_account.role = TEACHER`。
- `CONFIRMED` 状态下，`confirmed_by` 必须非空。
- `RESOLVED / VOIDED` 状态下，`resolved_by` 与 `resolved_at` 必须非空，且 `resolved_by` 对应 `user_account.role = ADMIN`。
- `PENDING_DETAIL / CONFIRMED` 状态下，`resolved_by` 与 `resolved_at` 必须为空。
- `PENDING_DETAIL / CONFIRMED` 均视为未解决安全事件，必须 `requires_review_before_next_session = 1`。
- `RESOLVED` 与 `VOIDED` 均为终态，状态不得再变更。
- `CONFIRMED` 是事件事实冻结点。
- `CONFIRMED / RESOLVED / VOIDED` 状态下，不得原地修改核心事实字段，包括 `student_id`、`job_code`、`task_code`、`reason_code`、`context_phase`、`description`、`triggered_by`、`confirmed_by`、`occurred_at`。
- 终态安全事件还不得修改 `status`、`resolved_by`、`resolved_at` 等生命周期字段。
- `status = VOIDED` 时，`void_reason` 必须非空。
- `status != VOIDED` 时，`void_reason` 必须为空。
- `void_reason = FACTUAL_CORRECTION` 时，`replacement_incident_id` 必须非空，并指向同一 `student_id + task_code` 下的 replacement safety_incident。
- `void_reason = DUPLICATE_RECORD` 时，`replacement_incident_id` 应指向保留的主 incident。
- `replacement_incident_id` 不得等于自身 `incident_id`。

产品规则：

- 未解决安全事件必须阻断同一 `student_id + task_code` 下的新测评或训练会话。
- 只有管理员将事件推进至 `RESOLVED` 或 `VOIDED` 后，系统才允许继续发起新会话。
- 若 `CONFIRMED` 后发现核心事实错误，MVP 阶段不得原地 `UPDATE` 修正；必须由管理员通过同一事务执行 `FACTUAL_CORRECTION` 作废重建，旧事件写入 `void_reason = FACTUAL_CORRECTION` 与 `replacement_incident_id`，新事件承接真实安全事件与阻断责任。
- 管理员不得通过直接修改 session 状态绕过安全事件生命周期。

### 8.7 领域事件类型

MVP 至少支持以下事件：

- `SESSION_STARTED`
- `ANSWER_SUBMITTED`
- `EMOTION_INTERRUPTED`
- `EMOTION_RESUMED`
- `EMOTION_COLLAPSE_THRESHOLD_REACHED`
- `OFFLINE_SCORE_SUBMITTED`
- `REDLINE_TRIGGERED`
- `SESSION_COMPLETED`
- `SESSION_ABORTED`
- `TRAINING_STARTED`
- `TRAINING_STEP_STARTED`
- `TRAINING_STEP_COMPLETED`
- `TRAINING_STEP_SKIPPED`
- `TRAINING_STEP_FAILED`
- `TRAINING_COMPLETED`
- `RESULT_CALCULATED`
- `REPORT_GENERATED`
- `REPORT_EXPORTED`
- `REPORT_LOCKED`
- `SAFETY_INCIDENT_CREATED`
- `SAFETY_INCIDENT_DETAIL_CONFIRMED`
- `SAFETY_INCIDENT_RESOLVED`
- `SAFETY_INCIDENT_VOIDED`
- `SAFETY_INCIDENT_REPLACED_FOR_FACTUAL_CORRECTION`
- `SNAPSHOT_COMMITTED`
- `RECOVERY_REPLAYED`
- `RECOVERY_LOG_TRUNCATED`

资源异常、数据库异常、状态非法迁移等进入 `error_event_log`。

---

## 9. 异常中心与错误码体系

### 9.1 异常中心目标

异常中心用于统一处理：

- 系统异常。
- 数据异常。
- 资源异常。
- 状态机异常。
- 评分异常。
- 报告异常。
- 安全异常。
- 恢复异常。

异常中心不是简单弹窗，而是具备错误码、优先级、阻断规则、恢复提示和日志记录的工程机制。

### 9.2 错误等级

系统使用技术严重度 `severity` 与产品优先级 `priority_level` 两层字段。

`severity`：

- `INFO`
- `WARN`
- `ERROR`
- `CRITICAL`

`priority_level`：

- `P0`
- `P1`
- `P2`
- `P3`

建议映射：

- `CRITICAL` 通常对应 `P0`。
- `ERROR` 通常对应 `P1`。
- `WARN` 通常对应 `P2` 或 `P3`。
- `INFO` 通常对应 `P3`。

具体以 `error_code_registry` 为准。

### 9.3 P0 异常

P0 是安全或数据完整性事故。

P0 必须阻断当前流程。

P0 必须写入 `error_event_log`。

P0 必须关联领域事件或聚合对象。

P0 必须给出恢复路径。

典型 P0：

- `action_log.jsonl` 写入失败。
- 事件 checksum 不一致。
- SQLite 快照提交失败。
- 安全红线触发。
- 数据库文件损坏。
- 答题记录无法持久化。

### 9.4 P1 异常

P1 是核心流程中断。

典型 P1：

- IPC 写入超时。
- 资源文件缺失。
- 资源哈希不一致。
- 非法状态迁移。
- 评分策略缺失。
- 题库不足。
- 训练资源缺失。

### 9.5 P2 异常

P2 是可恢复业务异常。

典型 P2：

- 报告生成失败但结果记录已保存。
- 教师误提交评分后申请修正。
- 学生跳过训练步骤。
- 重复发起同一任务。
- 感官屏蔽后题目不足。

### 9.6 P3 异常

P3 是轻量提示或非阻断异常。

典型 P3：

- 恢复时截断损坏日志但已自动恢复。
- 磁盘空间预警。
- 视频加载较慢。
- 非核心资源校验延迟。

### 9.7 MVP 初始错误码

MVP 初始错误码至少包括：

- `IPC_WRITE_TIMEOUT`
- `AOL_APPEND_FAILED`
- `AOL_CHECKSUM_MISMATCH`
- `RECOVERY_LOG_TRUNCATED`
- `SNAPSHOT_COMMIT_FAILED`
- `ASSET_HASH_MISMATCH`
- `ASSET_MISSING`
- `FSM_INVALID_TRANSITION`
- `SCORING_POLICY_MISSING`
- `REPORT_GENERATION_FAILED`

### 9.8 异常处理规则

- 阻断型异常不得只用 Toast 提示。
- P0 / P1 异常必须进入异常中心。
- 与评分、报告、安全、状态机、数据写入相关的异常必须结构化记录。
- 异常恢复动作必须写入 `recovery_action`。
- 异常状态必须记录 `recovery_status`。
- 已解决异常必须记录 `resolved_at`。

---

## 10. 感官画像与题目不足兜底

### 10.1 问题定义

学生感官画像可能导致系统屏蔽部分题目或资源。例如高噪音、高亮光、拥挤场景、强触觉刺激等标签可能被排除。

当排除规则过强时，可能出现可用题量不足，无法按策略生成测评。

### 10.2 兜底策略

感官屏蔽后题目不足时，不允许系统静默降低测评质量。

MVP 采用以下处理顺序：

1. 优先在同一任务、同一模块内寻找低刺激替代题。
2. 如果低刺激替代题不足，尝试使用同题型、同能力点但不同资源形式的题目。
3. 如果视频题因感官标签被排除，可优先替换为图片或图文题。
4. 如果仍无法满足策略配置的最小题量，阻断测评发起。
5. 系统进入异常中心，记录“感官屏蔽后题目不足”。
6. 教师端提示缺少哪些模块、题型、资源标签。
7. 管理员可补充题库或调整策略后重新发起。

### 10.3 禁止行为

- 不得在教师无感知情况下减少题量。
- 不得在策略要求线下实操时自动取消线下题。
- 不得用高刺激资源替代已被感官画像排除的资源。
- 不得让学生进入一个无法完整评分的测评。

### 10.4 允许行为

在教师确认并记录原因后，可以使用策略降级方案：

- 低刺激替代题。
- 图文替代视频。
- 同能力点不同题型。
- 降级策略版本。

降级必须记录到 session 使用的策略版本或策略快照中，保证报告可复现。

---

## 11. 数据模型与工程基线

### 11.1 工程基线原则

MVP 使用：

**轻量事件溯源 + SQLite 投影。**

核心原则：

- `action_log.jsonl` 是事实来源。
- SQLite 是查询快照。
- `domain_event_projection` 是事件投影，不是最高事实。
- 状态变更只能由领域事件驱动。
- 所有评分修改、红线熔断、作废会话必须留事件。
- 不得静默 UPDATE 覆盖历史。

### 11.2 schema.sql v0.1.7-consistency-guard 核心表

`schema.sql v0.1.7-consistency-guard` 包含 20 张核心表，并已纳入安全事件生命周期、两级权限、完整性锁定、`VOIDED` 语义分型与一致性保护约束。

核心表包括：

- `schema_migration`
- `user_account`
- `student_profile`
- `strategy_config`
- `asset_resource`
- `question_bank`
- `assessment_session`
- `assessment_session_question`
- `training_session`
- `training_step_record`
- `domain_event_projection`
- `answer_record`
- `offline_score_record`
- `safety_incident`
- `safety_incident_binding`
- `result_record`
- `task_report`
- `snapshot_meta`
- `error_code_registry`
- `error_event_log`

### 11.3 strategy_config

`strategy_config` 是评分、组卷、阈值的唯一配置源。

代码不得硬编码：

- 题量。
- 线上题数量。
- 线下题数量。
- 满分。
- 达标阈值。
- 需改进阈值。
- 题型比例。
- 是否支持红线。
- 是否允许情绪中断。
- 是否需要线下评分。

工程约束：

- `assessment_session` 和 `training_session` 创建时必须记录 `strategy_id + strategy_type + job_code + strategy_version`。
- `assessment_session` 和 `training_session` 创建或更新时，上述四个字段必须共同匹配 `strategy_config` 中同一行。
- 已被任一 session 引用的 `(strategy_id, version)` 不得原地修改策略语义字段。
- 策略变更必须通过插入新 `version` 完成。
- 历史报告和历史结果必须能按当时策略复现。

### 11.4 domain_event_projection

`domain_event_projection` 用于投影 `action_log.jsonl` 中的事件，支持查询、审计、恢复和报表。

核心规则：

- `event_id` 全局唯一。
- 同一 session 内 `event_sequence` 递增。
- 事件必须有 checksum。
- 恢复时根据 event_sequence 幂等回放。
- `last_applied_event_id` 用于快照边界判断。

### 11.5 snapshot_meta

`snapshot_meta` 用于记录 SQLite 快照状态。

核心作用：

- 冷启动校验 SQLite 快照完整性。
- 判断 `action_log.jsonl` 哪些事件尚未回放。
- 支持崩溃恢复。
- 支持审计追踪。
- 支持 `app_version` 与 `schema_version` 记录。

### 11.6 asset_resource

`asset_resource` 用于管理本地视频、图片、音频、PDF 和教具清单资源。

核心字段：

- `asset_id`
- `asset_type`
- `local_path`
- `app_url`
- `file_hash`
- `file_size`
- `status`
- `last_verified_at`

产品规则：

- 资源缺失必须产生 `ASSET_MISSING`。
- 资源哈希不一致必须产生 `ASSET_HASH_MISMATCH`。
- 资源不得以 base64 写入数据库。

### 11.7 safety_incident

`safety_incident` 用于记录学生任务级安全事件。

核心规则：

- `safety_incident` 必须允许在无开放 session 的情况下独立创建。
- `safety_incident` 以 `student_id + task_code` 为核心归属，不依附于单一 session。
- 有开放会话时，安全事件通过 `safety_incident_binding` 绑定并批量熔断相关会话。
- 无开放会话时，安全事件仍可成立，并阻断同一学生同一任务的新会话。
- 未解决事件状态包括 `PENDING_DETAIL` 与 `CONFIRMED`。
- 已解除阻断的终态包括 `RESOLVED` 与 `VOIDED`。
- `RESOLVED` 表示事件属实，已完成复盘并采取补救措施。
- `VOIDED` 必须结合 `void_reason` 判断语义，不得一律视为误报。
- 教师只能触发、补充和确认事件事实。
- 管理员才可将事件推进至 `RESOLVED` 或 `VOIDED`。
- 安全事件状态变化必须通过领域事件推进，并写入 `action_log.jsonl` 与 SQLite 投影。
- `PENDING_DETAIL` 是事实补充阶段。
- `CONFIRMED` 是事实冻结点。
- `CONFIRMED / RESOLVED / VOIDED` 状态下不得原地修改核心事实字段。
- `CONFIRMED` 后如需更正事实，MVP 阶段必须由管理员执行 `FACTUAL_CORRECTION` 作废重建：旧事件 `VOIDED`，写入 `replacement_incident_id`，并在同一事务中创建 replacement 事件，不允许静默覆盖。

`safety_incident` 需要支持以下 `VOIDED` 语义字段：

- `void_reason`：作废原因。
- `replacement_incident_id`：替代或主安全事件 ID。

`void_reason` 枚举：

- `FALSE_TRIGGER`
- `DUPLICATE_RECORD`
- `NON_SAFETY_EVENT`
- `FACTUAL_CORRECTION`

### 11.8 safety_incident_binding

`safety_incident_binding` 用于记录一次安全事件影响了哪些聚合。

一条 safety_incident 可以绑定：

- 一个 assessment_session。
- 一个 training_session。
- 或同时绑定两者。

binding 必须记录：

- 受影响聚合类型。
- 受影响聚合 ID。
- 熔断前状态。
- 熔断后状态。
- 关联 halt event。
- 创建时间。

### 11.9 v0.1.7 一致性保护约束

`schema.sql v0.1.7-consistency-guard` 在 v0.1.6 基础上新增 3 类 schema 级一致性保护：

第一，`strategy_config` 引用一致性保护。

`assessment_session` 和 `training_session` 写入时，`strategy_id / strategy_type / job_code / strategy_version` 必须共同匹配 `strategy_config` 中同一行。该约束不得只依赖业务代码或前端判断。

第二，`redline_incident_id` 同学生同任务保护。

当 `assessment_session.status = REDLINE_HALTED` 或 `training_session.status = REDLINE_HALTED` 时，`redline_incident_id` 必须指向同一 `student_id + task_code` 的 `safety_incident`。该约束必须兼容现有 safety_incident 创建后的批量熔断触发器。

第三，训练步骤状态枚举统一。

`training_step_record.status` 只能使用：

- `NOT_STARTED`
- `IN_PROGRESS`
- `COMPLETED`
- `SKIPPED`
- `FAILED`

不得继续使用 `ACTIVE` 或 `VOID`。如果后续需要“作废训练步骤”语义，应新增明确业务事件与字段，不得复用未解释的 `VOID` 状态。

由于当前尚未正式编码落地，v0.1.7 作为全量初始化 schema 基线，不要求原地迁移脚本。若后续已有真实数据后再进行 schema 升级，必须提供独立 migration 脚本处理既有表 CHECK 约束、历史状态映射和历史空值修复。

---

## 12. 本地部署与技术架构

### 12.1 技术栈

MVP 建议技术栈：

- Electron。
- Vue 3。
- TypeScript。
- 本地 SQLite / SQL.js 兼容执行环境。
- Node.js 主进程文件系统能力。
- 本地资源私有协议 `app://`。

### 12.2 架构分层

系统分为：

- 学生端 UI。
- 教师端 UI。
- 管理员维护入口。
- 渲染进程交互层。
- Electron preload 安全桥。
- 主进程领域服务。
- 事件日志服务。
- SQLite 投影服务。
- 资源校验服务。
- 报告生成服务。
- 异常中心服务。

### 12.3 IPC 规则

渲染进程不得直接访问文件系统。

渲染进程不得直接写 SQLite。

渲染进程通过 preload 暴露的安全 API 调用主进程。

主进程统一处理：

- 事件校验。
- 状态迁移。
- action_log 写入。
- SQLite 投影更新。
- 资源校验。
- 报告生成。
- 异常记录。

IPC 超时必须进入异常中心。

### 12.4 离线运行

系统必须支持无网络完成完整闭环：

- 登录。
- 建档。
- 测评。
- 训练。
- 实操评分。
- 红线记录。
- 报告生成。
- 报告查看。
- 异常记录。
- 本地恢复。

MVP 不依赖云服务完成核心流程。

---

## 13. 非功能性需求 NFR

### 13.1 性能指标

应用启动时间：

- ≤ 5 秒。

学生端首页首屏加载：

- ≤ 2 秒。

教师端学生列表加载：

- 100 名学生以内 ≤ 2 秒。

本地视频首帧加载：

- ≤ 800ms。

题目切换响应：

- ≤ 500ms。

每题答题记录持久化：

- ≤ 500ms。

训练步骤完成记录持久化：

- ≤ 500ms。

线下评分提交：

- ≤ 800ms。

报告生成：

- ≤ 3 秒。

异常中心最近 30 天 P0 / P1 列表加载：

- ≤ 2 秒。

### 13.2 可靠性指标

异常退出后，已提交题目丢失数：

- 0 道。

`action_log.jsonl` 写入失败：

- 必须阻断流程。

SQLite 快照写入失败：

- 不得删除 action_log。

恢复时发现日志末尾损坏：

- 允许截断最后一条损坏记录，但必须记录 `RECOVERY_LOG_TRUNCATED`。

终态会话：

- 不得被直接修改。

报告快照：

- 不得被新结果覆盖。

### 13.3 兼容性指标

MVP 支持：

- Windows 10 及以上。
- Windows 11。

最低屏幕分辨率建议：

- 1366 × 768。

推荐屏幕分辨率：

- 1920 × 1080。

输入方式：

- 鼠标。
- 触控屏。
- 基础键盘输入。

### 13.4 资源指标

- 视频资源不得写入数据库。
- PDF 资源不得写入数据库。
- 单个视频建议控制在 15-30 秒。
- 本地资源包必须支持完整性校验。
- 资源导入后必须记录 hash 和 file_size。
- 资源缺失不得导致应用崩溃。

### 13.5 可恢复性指标

应用异常关闭后，下次启动必须执行恢复检查。

恢复流程必须检查：

- `action_log.jsonl`。
- SQLite 快照。
- `snapshot_meta`。
- `domain_event_projection`。
- 未应用事件。
- 损坏日志尾部。

恢复完成后必须生成恢复事件或异常记录。

---

## 14. 数据安全与隐私

### 14.1 权限隔离

- 学生端不得查看其他学生数据。
- 学生端不得进入教师端。
- 教师端关键操作必须登录。
- 管理员操作必须登录。
- 报告导出必须记录操作者。
- 评分修改必须记录操作者。
- 作废会话必须记录操作者和原因。

### 14.2 本地数据保护

本地数据库文件应设置应用级访问保护。

用户密码必须存储 `password_hash`，不得明文保存。

报告导出默认脱敏。

脱敏字段包括：

- 学生姓名可显示简称。
- 监护人联系方式默认隐藏。
- 教师备注可选择是否导出。
- 异常技术信息不进入学生版报告。

### 14.3 审计规则

以下操作必须可追溯：

- 登录。
- 创建学生档案。
- 修改学生档案。
- 发起测评。
- 提交答案。
- 暂停测评。
- 恢复测评。
- 作废测评。
- 提交线下评分。
- 修正线下评分。
- 触发安全红线。
- 补充安全事件详情。
- 确认安全事件事实。
- 解决安全事件。
- 作废安全事件。
- 创建策略新版本。
- 尝试修改已引用策略版本。
- 生成结果。
- 生成报告。
- 导出报告。
- 锁定报告。
- 资源校验失败。
- 恢复流程执行。
- 安全事件 `VOIDED` 时的 `void_reason`。
- `FACTUAL_CORRECTION` 作废重建时的新旧 incident 关联。

### 14.4 删除规则

核心业务数据不得物理删除。

允许的替代方式：

- `ABORTED`
- `ARCHIVED`
- `SUPERSEDED`
- `DISABLED`
- `INACTIVE`
- `VOIDED`

所有删除类操作必须转化为状态变更、归档事件或作废事件。

---

## 15. UI 与交互要求

### 15.1 学生端 UI 原则

- 视觉优先。
- 文字少。
- 按钮大。
- 路径短。
- 反馈温和。
- 避免惩罚性刺激。
- 页面聚焦单一任务。
- 单页核心文字尽量控制在 20 字以内。

### 15.2 禁止性 UI

- 不得出现刺耳错误音效。
- 不得出现巨大红叉惩罚反馈。
- 不得频繁闪烁。
- 不得用复杂弹窗打断学生。
- 不得让学生看到复杂分数解释。
- 不得让学生接触异常技术信息。

### 15.3 教师端 UI 原则

- 流程清晰。
- 状态明确。
- 异常可见。
- 评分高效。
- 报告可导出。
- 关键操作有二次确认。

### 15.4 安全红线 UI 原则

安全红线按钮是紧急中止按钮。

要求：

- 必须在教师端关键实操与训练观察页面常驻。
- 点击后立即执行安全事件创建与批量熔断。
- 不得在熔断前要求教师填写完整表单。
- 不得在熔断前要求教师选择 assessment 或 training。
- 熔断后再进入详情补充页面。
- 补充详情可以延后完成，但安全事件必须先成立。

### 15.5 关键确认操作

以下操作需要二次确认：

- 作废测评。
- 提交线下评分。
- 解决安全事件。
- 作废安全事件。
- 锁定报告。
- 导出完整非脱敏报告。
- 归档学生档案。

安全红线触发本身不要求二次确认，因为它是紧急中止动作。

---

## 16. 数据埋点与成功指标

### 16.1 指标来源

MVP 不依赖外部埋点系统。

指标从以下本地数据计算：

- `domain_event_projection`
- `assessment_session`
- `training_session`
- `training_step_record`
- `answer_record`
- `offline_score_record`
- `safety_incident`
- `safety_incident_binding`
- `result_record`
- `task_report`
- `error_event_log`

### 16.2 产品可用性指标

测评完成率：

- 完成测评会话数 / 发起测评会话数。

训练完成率：

- 完成训练任务数 / 分配训练任务数。

实操评分完成率：

- 完成线下评分数 / 发起线下评分数。

报告生成成功率：

- 成功生成报告数 / 请求生成报告数。

异常恢复成功率：

- 自动恢复或人工解决异常数 / 异常总数。

资源完整率：

- 校验通过资源数 / 已登记资源数。

### 16.3 教学效率指标

- 教师建档平均耗时。
- 教师发起测评平均耗时。
- 学生完成线上测评平均耗时。
- 学生完成训练平均耗时。
- 教师完成实操评分平均耗时。
- 报告生成平均耗时。
- 报告导出平均耗时。

### 16.4 教学效果指标

- 能力测评分变化（按 `LEVEL_COMPETENT` / `LEVEL_CONDITIONAL` / `LEVEL_NOT_COMPETENT` 分组统计）。
- 训练完成度变化。
- 实操达标率变化。
- 需重训次数。
- 安全红线触发率。
- 安全事件解决耗时。
- 真实安全事件数。
- 作废安全事件数，按 `void_reason` 分组。
- 事实修正作废重建次数。
- 同一任务复评通过率。
- 教师复用率。
- 学生任务完成稳定性。
- **v1.0.5 新增**：模块兜底触发率（按 6 大模块分组，统计任一模块 `< 50%` 强制 `LEVEL_NOT_COMPETENT` 的发生频次）。
- **v1.0.5 新增**：情绪崩溃兜底触发率（统计因累计情绪崩溃达阈值而强制 `LEVEL_NOT_COMPETENT` 的发生频次，以及平均崩溃次数分布）。
- **v1.0.5 新增**：就业安置方向分布（按日间照料 / 支持性就业 / 竞争性就业 三档分组统计学生数量）。

安全事件统计口径：

- 安全红线触发率可以统计所有触发记录，包括后续被 `VOIDED` 的记录。
- 真实安全事件数必须排除 `void_reason = FALSE_TRIGGER` 与 `void_reason = NON_SAFETY_EVENT` 的记录。
- `void_reason = DUPLICATE_RECORD` 的旧记录不计入唯一安全事件数，但应追溯到 `replacement_incident_id` 指向的主 incident。
- `void_reason = FACTUAL_CORRECTION` 不得被视为误报；旧事件不计入唯一事件数，但 replacement incident 应承接真实安全事件统计。
- 安全事件解决耗时应优先统计真实安全事件；`FALSE_TRIGGER / NON_SAFETY_EVENT` 可单独统计为作废处理耗时。

### 16.5 MVP 成功判定

MVP 成功需要同时满足：

- 教师能够独立完成学生建档与任务发起。
- 学生能够完成线上测评和训练流程。
- 教师能够完成线下实操评分。
- 系统能够生成三类结果。
- 系统能够生成任务报告。
- 异常退出后不丢失已提交数据。
- 安全红线能正确批量熔断开放会话。
- 无会话红线能被独立记录。
- 未解决安全事件能阻断新会话。
- 资源缺失能被识别并记录。
- 教师愿意在真实课堂中复用该流程。

---

## 17. 验收标准

### 17.1 功能验收

#### 学生档案

- 教师可以创建学生档案。
- 教师可以编辑感官画像。
- 教师可以归档学生档案。

#### 测评

- 教师可以发起基础能力评估。
- 学生可以完成线上 42 题 + 线下 8 题。
- 系统每题提交后生成事件。
- 系统可以恢复中断测评。
- 测评完成后生成 `ABILITY_SCORE`，等级为新三档之一（`LEVEL_COMPETENT` / `LEVEL_CONDITIONAL` / `LEVEL_NOT_COMPETENT`）或 `LEVEL_FAIL_BY_SAFETY`。
- 任一模块得分率 `< 50%` 时，结果强制 `LEVEL_NOT_COMPETENT`（模块兜底）。
- 同一测评累计情绪崩溃达阈值时，结果强制 `LEVEL_NOT_COMPETENT`（情绪崩溃兜底）。

#### 训练

- 教师可以分配训练任务。
- 学生可以完成看、学、练、做四步。
- 系统可以记录每一步状态。
- 跳过步骤不计为完成。
- 失败后重试应被记录。
- 训练完成后生成 `TRAINING_COMPLETION`。

#### 实操评分

- 教师可以打开实操评分页。
- 教师可以确认教具清单。
- 教师可以按 0 / 1 / 2 评分。
- 教师可以填写观察备注。
- 提交后生成 `OPERATION_PASS_RATE`。

#### 安全红线

- 教师可以触发安全红线。
- 有开放会话时，系统批量熔断所有相关开放 session。
- 无开放会话时，系统仍可独立创建 safety_incident。
- 安全红线后 session 进入 `REDLINE_HALTED`。
- 结果强制 `LEVEL_FAIL_BY_SAFETY`。
- 系统生成安全中止报告。
- 未解决安全事件阻断新会话。

#### 报告

- 系统可以生成完整任务报告。
- 系统可以生成安全中止报告。
- 系统可以导出报告。
- 系统可以锁定报告。
- 重测后旧报告不被覆盖。
- 红线后普通报告生成被阻断。

#### 异常中心

- 系统可以记录 P0 / P1 / P2 / P3 异常。
- 阻断型异常可以阻断流程。
- 异常详情可查看恢复提示。

### 17.2 数据验收

- `action_log.jsonl` 是事实来源。
- SQLite 快照可由事件回放恢复。
- 终态 session 不可直接修改。
- 同一学生同一任务重复创建开放 assessment_session 应失败。
- 同一学生同一任务重复创建开放 training_session 应失败。
- `answer_record` 支持 revision。
- `offline_score_record` 支持 revision。
- `result_record` 同一来源同一类型只有一个 current result。
- `safety_overridden` 与 `LEVEL_FAIL_BY_SAFETY` 强约束一致。
- `safety_incident` 可在无开放 session 时独立创建。
- `safety_incident_binding` 支持一对多绑定。
- `task_report` 支持 `LOCKED` 和 `SUPERSEDED`。
- `error_code_registry` 包含 `priority_level`。
- `asset_resource` 包含 hash 与 file_size。
- `CONFIRMED / RESOLVED / VOIDED` 状态的 `safety_incident` 核心事实字段不可原地修改。
- `VOIDED` 状态的 `safety_incident` 必须填写 `void_reason`。
- `FACTUAL_CORRECTION` 作废重建必须写入 `replacement_incident_id`。
- 已被 `assessment_session` 引用的 `strategy_config(strategy_id, version)` 不可原地修改策略语义字段。
- 已被 `training_session` 引用的 `strategy_config(strategy_id, version)` 不可原地修改策略语义字段。

### 17.3 性能验收

- 启动 ≤ 5 秒。
- 学生端首页 ≤ 2 秒。
- 视频首帧 ≤ 800ms。
- 答题持久化 ≤ 500ms。
- 评分提交 ≤ 800ms。
- 报告生成 ≤ 3 秒。
- 异常中心列表 ≤ 2 秒。

### 17.4 恢复验收

- 测评中强制关闭应用。
- 重启后可恢复到最后一道已提交题之后。
- 已提交答案不丢失。
- action_log 末尾损坏时可截断损坏尾行。
- 恢复过程写入异常或恢复事件。
- SQLite 快照损坏时可通过 action_log 重建。

### 17.5 安全红线专项验收

必须覆盖以下场景：

1. 同一学生同一任务重复创建开放 `assessment_session` 应失败。
2. 同一学生同一任务重复创建开放 `training_session` 应失败。
3. `assessment_session + training_session` 同时开放时触发红线，两者都进入 `REDLINE_HALTED`。
4. `safety_incident_binding` 正确生成两条绑定记录。
5. 无开放会话时可以创建 `safety_incident`。
6. 无会话 `safety_incident` 未解决前，新 session 创建应被阻断。
7. `safety_overridden = 1` 时 `result_record` 必须是 `LEVEL_FAIL_BY_SAFETY`。
8. 红线触发前的 `answer_record / offline_score_record / training_step_record` 不被删除。
9. 红线后的普通报告生成会被阻断。
10. 红线后允许生成 `SAFETY_TERMINATION_REPORT`。
11. 无会话安全事件不会生成 binding。
12. `TEACHER` 可以创建 `PENDING_DETAIL`。
13. `TEACHER` 可以将 `PENDING_DETAIL` 推进到 `CONFIRMED`。
14. `TEACHER` 不可以将 `CONFIRMED` 推进到 `RESOLVED`。
15. `TEACHER` 不可以将 `PENDING_DETAIL` 推进到 `VOIDED`。
16. `ADMIN` 可以将 `PENDING_DETAIL` 推进到 `VOIDED`。
17. `ADMIN` 可以将 `CONFIRMED` 推进到 `RESOLVED`。
18. `ADMIN` 可以将 `CONFIRMED` 推进到 `VOIDED`。
19. `PENDING_DETAIL` 不允许直接进入 `RESOLVED`。
20. `RESOLVED` 不允许回退到 `CONFIRMED`。
21. `VOIDED` 不允许回退到 `CONFIRMED`。
22. `RESOLVED / VOIDED` 终态安全事件不允许继续修改核心事实字段。
23. `PENDING_DETAIL` 状态下可以补充或修正 `reason_code / context_phase / description`。
24. `PENDING_DETAIL -> CONFIRMED` 后，修改 `reason_code` 应失败。
25. `PENDING_DETAIL -> CONFIRMED` 后，修改 `context_phase` 应失败。
26. `PENDING_DETAIL -> CONFIRMED` 后，修改 `description` 应失败。
27. `PENDING_DETAIL -> CONFIRMED` 后，修改 `confirmed_by` 应失败。
28. `CONFIRMED -> RESOLVED` 后，修改核心事实字段应失败。
29. `status = VOIDED` 但 `void_reason` 为空应失败。
30. `status != VOIDED` 但 `void_reason` 非空应失败。
31. `void_reason = FALSE_TRIGGER` 且 `replacement_incident_id` 为空可以通过。
32. `void_reason = NON_SAFETY_EVENT` 且 `replacement_incident_id` 为空可以通过。
33. `void_reason = FACTUAL_CORRECTION` 且 `replacement_incident_id` 为空应失败。
34. `void_reason = DUPLICATE_RECORD` 且 `replacement_incident_id` 为空应失败。
35. `replacement_incident_id = incident_id` 应失败。
36. `FACTUAL_CORRECTION` 指向同一 `student_id + task_code` 的 replacement incident 应通过。
37. `FACTUAL_CORRECTION` 指向不同 `student_id` 或不同 `task_code` 的 incident 应失败。
38. `FACTUAL_CORRECTION` 作废重建必须在同一事务完成，不得存在旧事件已 `VOIDED` 且新事件尚未创建的可发起新会话空窗。

### 17.6 策略版本锁定专项验收

必须覆盖以下场景：

1. 未被任何 session 引用的 `strategy_config` 版本，可以修改策略字段。
2. 已被 `assessment_session` 引用的 `strategy_config` 版本，修改 `pass_threshold`（v1.0.5 起语义为 `LEVEL_COMPETENT` 阈值，默认 80）应失败。
3. 已被 `assessment_session` 引用的 `strategy_config` 版本，修改 `improve_threshold`（v1.0.5 起语义为 `LEVEL_CONDITIONAL` 阈值，默认 60）应失败。
4. 已被 `assessment_session` 引用的 `strategy_config` 版本，修改 `question_policy_json` 应失败。
5. 已被 `training_session` 引用的 `strategy_config` 版本，修改 `scoring_policy_json`（承载 `module_veto_threshold`、`emotion_collapse_threshold` 等子配置）应失败。
6. 已被任一 session 引用的 `strategy_config` 版本，修改 `strategy_name` 应失败。
7. 已被任一 session 引用的 `strategy_config` 版本，修改 `version` 应失败。
8. 已被引用的策略如需调整阈值或规则，必须插入新的 `version`。
9. 历史 session 通过 `strategy_id + strategy_version` 能够复现当时策略。

### 17.6.1 基础能力评估兜底专项验收（v1.0.5 新增）

必须覆盖以下场景：

1. 总分 `>= 80` 但任一模块得分率 `< 50%`，结果应为 `LEVEL_NOT_COMPETENT`（模块兜底优先于总分）。
2. 总分 `>= 80` 且无模块兜底、无情绪崩溃、无安全红线，结果应为 `LEVEL_COMPETENT`。
3. 总分在 `60 ~ 79` 区间且无任何兜底触发，结果应为 `LEVEL_CONDITIONAL`。
4. 总分 `< 60`，结果应为 `LEVEL_NOT_COMPETENT`。
5. 同一 `assessment_session` 累计情绪崩溃次数达到 `strategy_config.emotion_collapse_threshold`（默认 3），无论总分多少，结果应为 `LEVEL_NOT_COMPETENT`。
6. 单次情绪中断后恢复继续，不计入崩溃次数，不影响等级。
7. 安全红线触发，结果应为 `LEVEL_FAIL_BY_SAFETY`，优先级高于模块兜底与情绪崩溃兜底。
8. 报告中模块兜底触发时，必须能追溯到具体触发否决的模块标识。
9. 报告中情绪崩溃兜底触发时，必须记录崩溃次数与每次崩溃发生时间。

### 17.7 v0.1.7 一致性保护专项验收

必须覆盖以下场景：

1. `assessment_session` 使用不存在的 `strategy_version` 创建应失败。
2. `assessment_session.strategy_id / strategy_type / job_code / strategy_version` 任一字段与 `strategy_config` 不匹配时应失败。
3. `training_session` 使用不存在的 `strategy_version` 创建应失败。
4. `training_session.strategy_id IS NULL` 应失败。
5. `training_session.strategy_id / strategy_type / job_code / strategy_version` 任一字段与 `strategy_config` 不匹配时应失败。
6. `assessment_session.status = REDLINE_HALTED` 时，`redline_incident_id` 为空应失败。
7. `training_session.status = REDLINE_HALTED` 时，`redline_incident_id` 为空应失败。
8. `assessment_session.status = REDLINE_HALTED` 绑定到不同 `student_id` 或不同 `task_code` 的 `safety_incident` 应失败。
9. `training_session.status = REDLINE_HALTED` 绑定到不同 `student_id` 或不同 `task_code` 的 `safety_incident` 应失败。
10. 正常创建同一 `student_id + task_code` 的 `safety_incident` 后，开放 `assessment_session` 和 `training_session` 应仍可被批量熔断。
11. `training_step_record.status = IN_PROGRESS` 应成功。
12. `training_step_record.status = ACTIVE` 应失败。
13. `training_step_record.status = VOID` 应失败。
14. v0.1.6 的 `void_reason / replacement_incident_id / FACTUAL_CORRECTION` 规则不得回退。
15. v0.1.5 的 `CONFIRMED` 后事实冻结与已引用 `strategy_config` 语义字段不可改写规则不得回退。

### 17.8 基础能力题库导入验收

必须覆盖以下场景：

1. CSV 导入后题目默认状态为 `DRAFT`。
2. 未补齐正确答案的判断题不得转为 `ACTIVE`。
3. 未补齐 `scoring_rule_json` 的题目不得转为 `ACTIVE`。
4. 未绑定必需素材资源的题目不得转为 `ACTIVE`。
5. 资源 hash 校验失败的题目不得参与测评或训练。
6. 题目必须正确映射到 6 大 `module_type`。
7. 题目必须正确映射到 4 类 `question_type`。
8. 难度必须映射为数值型 `difficulty_level`。
9. 安全操作题答错只按评分规则记分，不自动创建 `safety_incident`。
10. 导入批次、源文件名和源行号必须可追溯。
11. **v1.0.5 新增**：CSV 题库导入后，必须能支撑 `strategy_config.question_policy_json` 配置的「每模块 7 道线上题」组卷约束；若任一模块 `ACTIVE` 题量不足 7 道，组卷时应进入异常中心「感官屏蔽后题目不足」或「题库不足」分支（§10），不得静默降级。
12. **v1.0.5 新增**：题目 `module_type` 必须与 6 大基础能力模块一一对应；`question_type` 为 `OFFLINE_OPERATION` 的题目通过 `content_json.ability_tags`（复合能力标签）参与线上模块计分时，必须明确标注主归属模块，用于模块兜底计算。

## 18. 版本规划

### 18.1 MVP v1.0.5-base-ability-rebalance

范围：

- 超市理货员。
- 拆箱与上架。
- **基础能力评估（线上 42 + 线下 8 / 满分 100）**。
- 训练。
- 实操评分。
- 学生任务级安全红线。
- 三类结果。
- 任务报告。
- 异常中心。
- 本地资源校验。
- 本地恢复。
- `schema.sql v0.1.7-consistency-guard` 一致性保护。
- 基础能力题库 CSV 作为 `question_bank` 种子数据导入。
- 新三档结果等级（`LEVEL_COMPETENT` / `LEVEL_CONDITIONAL` / `LEVEL_NOT_COMPETENT` / `LEVEL_FAIL_BY_SAFETY`）。
- 模块级一票否决（任一模块 `< 50%` 强制 `LEVEL_NOT_COMPETENT`）。
- 情绪崩溃兜底（累计达阈值强制 `LEVEL_NOT_COMPETENT`）。
- 就业安置方向建议（日间照料 / 支持性就业 / 竞争性就业）。
- 《软件大纲内容设计.md》纳入版本边界，不作为当前 MVP 全量交付范围。

v1.0.5 相对 v1.0.4 的差异：

- 基础能力评估口径统一：合并 §2.4「18+5」与 §5.4「17+3 / 满分 40」为「42+8 / 满分 100」一套。
- 等级阈值变更：70 / 40 → 80 / 60，等级枚举重命名。
- 新增模块兜底、情绪崩溃兜底、就业安置方向三条产品规则。
- 新增领域事件 `EMOTION_COLLAPSE_THRESHOLD_REACHED`。
- `strategy_config.scoring_policy_json` 承载 `module_veto_threshold`、`emotion_collapse_threshold` 子配置；`pass_threshold / improve_threshold` 字段语义重解释为 `LEVEL_COMPETENT / LEVEL_CONDITIONAL` 阈值（schema 字段名暂不改，待 v0.1.8 修订）。

不进入本阶段：

- 公共标准模拟卷 1 / 2 / 3。
- 老师自定义试卷库。
- 试卷复制、编辑、下发、导出 PDF。
- 4 大专项岗位技能模块完整体系。
- 专项技能综合测评。
- 分项模块小测试。

历史基线：

- `PRD v1.0.4-outline-and-consistency`（基础能力评估口径调整前；测评 17+3 / 满分 40 / 阈值 70/40）。

### 18.2 PRD v1.1.0-outline-alignment

建议扩展：

- 正式吸收《软件大纲内容设计.md》的学员端五大主菜单。
- 完善登录页与新手引导短视频入口。
- 完善“我的个人设置”和个性化适配设置。
- 完善“我遇到困难了”情绪安抚专区与工作常见问题解答。
- 增加基础能力训练专区。
- 增加教师端“预览学员界面”。
- 增加教师端题库浏览和基础题库审核界面。
- 增加教具使用说明书 PDF 在线预览与打印。
- 增加训练成果页的基础记录展示。

### 18.3 schema v0.2.0-question-paper

建议扩展：

- 新增正式试卷模型，例如 `assessment_paper`。
- 新增试卷题目关联模型，例如 `assessment_paper_question`。
- 支持公共标准模拟卷 1 / 2 / 3。
- 支持公共专项综合卷。
- 支持老师自定义试卷库。
- 支持试卷复制、编辑、启用、停用、归档。
- 支持组卷强制校验题量、模块、题型和线下实操数量。
- 支持导出整套题目 + 教具清单 PDF 的导出记录。
- 保持 `strategy_config` 作为评分、阈值和组卷策略版本源。

### 18.4 schema v0.3.0-job-skill-modules

建议扩展：

- 新增或扩展岗位专项模块模型。
- 支持 4 大理货实操训练模块：
  - 货架整理 + 价签核对。
  - 拆箱补货 + 先进先出。
  - 临期破损商品分拣。
  - 库房收纳 + 简易盘点。
- 支持分项模块小测试。
- 支持专项岗位技能综合测评。
- 支持专项技能训练进度与通关记录。
- 支持专项技能综合报告。

### 18.5 后续长期版本

建议扩展：

- 多岗位支持。
- 家长端可选。
- 企业端可选。
- 多评价人复核。
- 局域网部署。
- 私有化多终端同步。
- 岗位适配推荐。
- 长期职业转衔档案。
- 学生阶段性进步趋势。
- 批量报告导出。

---

## 19. 关键工程约束清单

以下约束必须写入开发任务和代码评审标准：

1. 不得把题量、阈值、题型比例写死在业务代码中。
2. 不得让前端直接修改 session 状态。
3. 不得物理删除核心业务会话。
4. 不得覆盖历史答题和评分记录。
5. 不得让安全红线被普通分数覆盖。
6. 不得让 safety_incident 依附于单一 session 才能成立。
7. 不得让教师在红线熔断前先选择 assessment 或 training。
8. 不得允许未解决安全事件绕过新会话阻断。
9. 不得允许教师解除安全阻断，教师只能触发、补充和确认事实。
10. 不得允许管理员绕过 `safety_incident` 状态机直接恢复会话。
11. 不得允许 `PENDING_DETAIL` 直接进入 `RESOLVED`。
12. 不得允许 `RESOLVED / VOIDED` 终态安全事件回退或修改核心事实字段。
13. 不得允许 `CONFIRMED` 状态安全事件静默修改核心事实字段。
14. 不得在 `CONFIRMED` 后通过原地 `UPDATE` 修正 `reason_code / context_phase / description / confirmed_by`。
15. 不得将所有 `VOIDED` 安全事件一律视为误触或误报。
16. 不得在 `status = VOIDED` 时缺失 `void_reason`。
17. 不得将 `FACTUAL_CORRECTION` 作废重建拆成两次独立 IPC 操作。
18. 不得在旧 incident 已 `VOIDED`、replacement incident 尚未创建期间打开新会话发起窗口。
19. 不得让 `FACTUAL_CORRECTION` 的旧 incident 被统计为误报；真实事件必须由 replacement incident 承接。
20. 不得原地修改已被 session 引用的 `strategy_config(strategy_id, version)` 策略语义字段。
21. 不得通过修改旧策略版本改变历史测评、训练或报告解释。
22. 不得从页面实时拼接报告替代报告快照。
23. 不得把视频、图片、PDF 以 base64 写入数据库。
24. 不得忽略 action_log 写入失败。
25. 不得将 SQLite 视为最高事实来源。
26. 不得让阻断型异常只显示 Toast。
27. 不得让学生端访问其他学生数据。
28. 不得在学生端展示复杂异常技术信息。

---

### 19.1 v0.1.7 追加工程约束

- 新建或更新 `assessment_session` 时，必须在 schema 层校验 `strategy_id / strategy_type / job_code / strategy_version` 与 `strategy_config` 同行匹配。
- 新建或更新 `training_session` 时，必须在 schema 层校验 `strategy_id / strategy_type / job_code / strategy_version` 与 `strategy_config` 同行匹配。
- `training_session.strategy_id` 业务上不得为空。
- `REDLINE_HALTED` 的 `assessment_session.redline_incident_id` 必须指向同一 `student_id + task_code` 的 `safety_incident`。
- `REDLINE_HALTED` 的 `training_session.redline_incident_id` 必须指向同一 `student_id + task_code` 的 `safety_incident`。
- `training_step_record.status` 不得出现 `ACTIVE` 或 `VOID`。
- 当前未进入正式编码落地阶段，v0.1.7 作为全量初始化 schema 基线使用；后续如存在真实数据升级，必须单独提供 migration。
- 基础能力 CSV 题库导入不得直接发布为正式题库，必须先入 `DRAFT`，审核后再转 `ACTIVE`。
- 完整试卷系统不得在 v1.0.5 / schema v0.1.7 中临时拼接实现，应进入 v1.1.0 与 schema v0.2.0。
- v1.0.5 基础能力评估口径下，代码不得硬编码或假设「17+3 / 满分 40 / 阈值 70/40」等 v1.0.4 旧默认值；所有题量、满分、阈值必须从 `strategy_config` 读取。
- v1.0.5 新三档等级（`LEVEL_COMPETENT / LEVEL_CONDITIONAL / LEVEL_NOT_COMPETENT`）必须在代码层一次性切换，不得保留 `LEVEL_PASS / LEVEL_IMPROVE / LEVEL_FAIL` 旧枚举兼容。
- 模块级一票否决与情绪崩溃兜底必须在结果计算阶段强制执行，不得依赖前端或教师判断。
- 就业安置方向建议必须严格按 `ABILITY_SCORE` 等级映射（§7.4），不得由前端自由文案。

## 20. MVP 最终定义

炫灿-职途向导系统 MVP 是一个本地化桌面端职业训练闭环验证系统。

它以“超市理货员 / 拆箱与上架”为唯一任务样板，验证特殊学生是否可以通过结构化数字工具完成：

- 规则理解。
- 过程训练。
- 线下实操。
- 教师评分。
- 结果反馈。
- 安全中止。
- 异常恢复。
- 报告沉淀。

本 MVP 的核心价值不在于覆盖多少岗位，而在于建立一套可扩展、可追溯、可恢复、可审计、能适应真实特教现场不确定性的职业训练底层范式。

MVP 通过后，系统再进入完整软件大纲对齐、正式试卷系统、专项岗位模块、多任务、多岗位、多角色和长期转衔档案阶段。
