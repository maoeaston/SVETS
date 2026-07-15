# 炫灿-职途向导系统 MVP 产品需求文档｜v1.0.9 权威合并版

产品合同版本：PRD v1.0.9-job-skill-assessment-mvp-closure
文档形态：Consolidated Authoritative Baseline（单一权威正文）
当前工程基线：`schema.sql v0.1.14-multi-device-m2-session-foundation`
MVP 功能基线：`schema.sql v0.1.12-job-skill-assessment-mvp-closure`
产品阶段：MVP
目标平台：本地化桌面端
核心岗位样板：超市理货员
MVP 核心任务：拆箱与上架
最后更新：2026-07-14

> 本文是当前唯一活跃的 MVP 产品合同。历史差异版 v1.0.5～v1.0.9 仅用于变更追溯，不再作为新开发的组合阅读入口。

## 0. 定稿说明

### 0.1 权威性与合并口径

本文将 v1.0.5 完整正文与 v1.0.6、v1.0.7、v1.0.8、v1.0.9 的全部有效替换和增补物化为一份可独立阅读的产品合同。发生冲突时，以后版本规则覆盖前版本规则；其中 v1.0.9 已废止 v1.0.8 关于“JOB_SPECIFIC 只做静态治理、不进入 MVP 运行时”的限制。

当前 MVP 同时包含两条互相隔离的测评路径：

1. `BASE_ABILITY`：基础能力测评 42+8，满分 100，生成 `ABILITY_SCORE`。
2. `JOB_SPECIFIC`：专业岗位固定示范卷 18+6，可选 0～3 个不计分观察项，满分 48，生成 `JOB_SKILL_SCORE`。

本文描述产品与数据合同；数据库 DDL 的唯一事实源是 `src/main/db/schema.sql`，JSON 与事件类型的唯一事实源分别是 `src/shared/types/json-schemas.ts` 和 `src/shared/types/event-payloads.ts`。若三者不一致，必须标记 `[!]` 并通过产品决策修正文档或实现，不得静默选择。

### 0.2 已固化的 MVP 默认值

以下曾在差异版中标记为“需确认”的值，已经由 schema、实现和测试固化为当前 MVP 合同：

- 专业岗位固定示范卷：线上 18 题 + 线下 6 题；观察项 0～3 个且不计分。
- 专业岗位等级阈值：胜任 80，有条件胜任 60。
- 训练重点触发阈值：模块得分率低于 60%。
- 专业岗位 session 的 `task_code`：`JOB_SKILL_DEMO_M1M6`。
- “拆箱与上架”训练任务编码：`UNBOXING_AND_SHELVING`。
- 专业岗位模块低分只生成训练重点，不覆盖总等级；安全红线仍具有最高优先级。

### 0.3 仍开放但不阻断当前 MVP 的专业决策

以下事项不改变当前 schema 与运行时合同，由产品负责人和学校专业团队负责裁决：

1. 预埋差错、干扰和隐蔽观察的事后告知伦理流程。当前字段可记录 `post_disclosure_status`，但不作为 ACTIVE、保存或报告门禁。
2. `M1_TF_015` 答案键专业核验。裁决前保持 DRAFT，不得进入固定示范卷。
3. 角色扮演逐题 rubric、支架题拆分、门店/文职配对、549 初始池疑错题和后续全量题库运营规则。这些属于内容治理或 Post-MVP，不得阻断当前固定示范卷。

### 0.4 MVP 边界

MVP 必须完成学生建档、基础能力测评、专业岗位示范测评、结构化训练、教师线下评分、安全红线、结果投影和报告闭环。MVP 不实现 298 题随机组卷、完整题库后台、多套或自定义试卷、岗位安置矩阵、AI 自动出题、PDF 报告渲染、ORM 或 CSV 解析库。

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
- 系统能够生成基础任务闭环三类结果和独立的专业岗位测评结果。
- 系统能够生成任务报告快照。
- 安全红线、异常中断、资源缺失、数据写入失败等关键异常能够被阻断、记录和恢复。

---

## 2. MVP 范围与非范围

### 2.1 MVP 范围

MVP 覆盖一个岗位、一个训练任务、两条测评路径和一个可追溯教学闭环。

岗位：

- 超市理货员（`SUPERMARKET_SHELVER`）

训练任务：

- 拆箱与上架（`UNBOXING_AND_SHELVING`）

用户角色：

- 学生
- 教师
- 管理员

测评路径：

1. 基础能力测评：BASE_ABILITY 42+8，生成 `ABILITY_SCORE`。
2. 专业岗位示范测评：JOB_SPECIFIC 固定 18+6，可选 0～3 个观察项，生成 `JOB_SKILL_SCORE` 和 M1-M6 岗位模块画像。

核心闭环：

1. 学生建档。
2. 教师按教学目的发起基础能力测评或专业岗位示范测评；两者互相隔离，不要求强制串行。
3. 系统生成对应结果与报告，并以固定规则给出训练重点。
4. M2 低分可链接到现有“拆箱与上架”四步训练；其他模块只显示后续训练建议。
5. 学生完成看、学、练、做训练。
6. 教师完成任务实操评分。
7. 系统生成训练完成度、实操达标率和任务报告快照。
8. 全流程记录异常、安全红线、策略版本、题目/素材版本和领域事件。

结果投影：

- 基础能力测评分 `ABILITY_SCORE`
- 专业岗位测评分 `JOB_SKILL_SCORE`
- 训练完成度 `TRAINING_COMPLETION`
- 实操达标率 `OPERATION_PASS_RATE`

核心工程能力包括轻量事件溯源、SQLite 查询投影、事件驱动状态机、学生任务级安全红线、异常中心、报告快照、本地资源完整性校验、题库域隔离和策略版本锁定。

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

基础能力评估采用：

- 线上固定 42 道计分题，6 个模块每模块 7 道，每题自动判分 `0 / 2`，线上小计 84 分。
- 线下固定 8 道计分题，每题教师评分 `0 / 1 / 2`，线下小计 16 分。
- 总计 50 道计分题，满分 100。
- `OBSERVATION_ONLY` 条目不计入 42+8，不进入 `completion_ratio` 分母，不产生独立题目分数。
- 线上允许的数据库级题型为 `TRUE_FALSE / SINGLE_CHOICE / DRAG / SOFTWARE_TASK`。
- 线下题型为 `OFFLINE_OPERATION`。
- 题型数量不按 14/14/14 固定分配；组卷仅固定模块配额、线上/线下总量、可用状态和策略版本。
- 每个模块 7 道线上题的交互类型应具备合理多样性，但 MVP 不设置数据库级硬配额。
- 任何未实现 renderer 的 `interaction_type` 不得计入 ACTIVE 可组卷题量。
- 模块级一票否决继续只按线上模块得分率计算，分母恒为 14。

历史口径废止：

- 废止“线上题仅由判断、单选、拖拽组成”的表述。
- 废止 `question_policy_json.question_ratio = 14/14/14/8` 的种子策略。
- 基础能力继续采用线上 0/2、线下 0/1/2、42+8、满分 100。

---

题库域隔离规则：

- 42+8、满分 100、模块配额、线上 0/2、线下 0/1/2 仅适用于 `bank_domain = 'BASE_ABILITY'`。
- `JOB_SPECIFIC` 不进入基础能力 42+8、ABILITY_SCORE 或基础能力 completion_ratio；它只进入 JOB_SKILL_ASSESSMENT 自己的计分完成率，观察项另算 observation_completion_ratio。
- 基础能力组卷 SQL 必须显式过滤 `bank_domain = 'BASE_ABILITY'`；组卷结果中 JOB_SPECIFIC 命中数必须为 0。

---

### 2.5 专业岗位示范测评题量规格

MVP 固定示范卷采用以下已固化题量：

| 岗位模块 | 线上题 | 线下题 |
|---|--:|--:|
| M1 货架整理与价签核对 | 3 | 1 |
| M2 拆箱补货与先进先出 | 3 | 1 |
| M3 临期破损商品分拣 | 3 | 1 |
| M4 库房收纳与简易盘点 | 3 | 1 |
| M5 突发情况应对 | 3 | 1 |
| M6 商品识别与分类 | 3 | 1 |
| 合计 | 18 | 6 |

计分口径：

- 线上 18 题，每题自动判分 0/2，小计 36。
- 线下 6 题，每题教师评分 0/1/2，小计 12。
- 计分题共 24 题，总原始满分 48；`normalized_score = raw_score / 48 × 100`。
- 教师嵌入观察 0-3 项：不计分、不进 48 分、不进计分题 completion_ratio 分母；单独记录 `observation_completion_ratio = 已完成观察项数 / 选入观察项数`（选入 0 项时记 1）。
- 基础能力 42+8、满分 100 的口径不受影响，两套测评互不混用。

---

### 2.6 后续版本边界

MVP 只验证“一个岗位任务的教学闭环是否成立”。

后续版本可以逐步扩展：

- 从一个任务扩展到理货员完整岗位任务包。
- 从单一基础能力评估策略扩展到多套标准化模拟卷（公共卷 1 / 2 / 3、教师自定义卷），题量与分值结构必须通过新策略版本明确。
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

MVP 提供两条独立测评入口，并共同衔接到现有训练任务：

```text
学生建档
├─ 基础能力测评（42+8）
│  └─ ABILITY_SCORE + 基础能力报告
└─ 专业岗位示范测评（18+6+观察 0～3）
   └─ JOB_SKILL_SCORE + M1-M6 岗位画像 + 固定规则训练重点
      └─ M2 低分可链接“拆箱与上架”训练

拆箱与上架四步训练
→ TRAINING_COMPLETION
→ 教师任务实操评分
→ OPERATION_PASS_RATE
→ 任务报告快照
```

基础能力和专业岗位测评均复用 assessment session、坐次暂停恢复、安全红线和事件审计机制，但使用不同的题库域、策略、计分分母、结果类型和报告 scope。任何一条路径都不得读取另一题库域的题目或把结果混算成单一总分。

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

#### 4.6.1 坐次（Sitting）机制

坐次机制用于区分单次中断与同一 session 的累计崩溃，同时解决 50 题一次性施测对目标人群负荷过大的问题。

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

#### 4.6.2 情绪崩溃定义

- **单次情绪中断**：学生点击"我遇到困难了"或教师端暂停，进入情绪支持层（§4.4）。**当次坐次内恢复继续的，不计崩溃。**
- **一次情绪崩溃** = 一个坐次以 `ENDED_BY_COLLAPSE` 方式结束，即：情绪中断后学生无法恢复，教师结束本坐次。系统记录 `EMOTION_COLLAPSE_RECORDED` 事件（含 sitting_no、时间、中断时所在题目）。
- 崩溃坐次结束后，session 进入 `SUSPENDED_REVIEW_REQUIRED`，**session 不终止**，可择时发起下一坐次。

#### 4.6.3 累计兜底

- 同一 `assessment_session` 内累计崩溃坐次数达到 `strategy_config.emotion_collapse_threshold`（默认 3）时：
  - 系统记录 `EMOTION_COLLAPSE_THRESHOLD_REACHED` 事件。
  - session 进入终止流程（`COMPLETED`，结果按 §7.2.1 中途终止规则计算）。
  - `ABILITY_SCORE` 等级强制 `LEVEL_NOT_COMPETENT`。
  - 报告记录崩溃次数、每次崩溃的坐次号、时间与所在题目。

#### 4.6.4 边界声明

- 情绪崩溃兜底**仅适用于 `assessment_session`**。`training_session` 不设崩溃兜底，训练中反复情绪中断由教师"标记需重训"处理。此为有意设计。
- 崩溃期间出现安全风险，安全红线优先（§4.5），不变。
- 情绪崩溃不触发 `safety_incident`，不变。

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

#### 5.3.1 数据库级 question_type

MVP 支持五类 `question_type`：

| question_type | 用途 | 评分方式 |
|---|---|---|
| `TRUE_FALSE` | 二元判断 | 自动 0/2 |
| `SINGLE_CHOICE` | 单一答案选择 | 自动 0/2 |
| `DRAG` | 简单拖拽匹配、分类和排序 | 自动 0/2 |
| `SOFTWARE_TASK` | 多选、轨迹、计时、序列、分支和复杂软件模拟 | 自动 0/2 |
| `OFFLINE_OPERATION` | 必要实物操作或教师现场观察 | 教师 0/1/2 |

`question_type` 不承担具体界面组件选择。具体交互由 `content_json.interaction.interaction_type` 决定。

#### 5.3.2 item_usage

`question_bank.item_usage` 为 schema 表字段，MVP 只允许：

- `SCORED_ITEM`：可进入 42+8 组卷、产生答题或线下评分记录。
- `OBSERVATION_ONLY`：系统派生或教师嵌入观察；可进入 session 的 OBSERVATION phase，但不进入计分题量、分数或计分完成率。

Post-MVP 可扩展 `TRAINING_ONLY / FINAL_EXAM_ONLY / PRACTICE_VARIANT`；当前 MVP 不预先实现完整用途体系。

观察用途补充规则：

- `OBSERVATION_ONLY` 允许两种交互：`SYSTEM_DERIVED_OBSERVATION`（从软件任务事件派生指标）与 `TEACHER_OBSERVATION`（线下嵌入观察，教师现场编码）。
- 3 条嵌入观察项（`M1_OB_048`、`M5_OB_048`、`M5_OB_055`）为 TEACHER_OBSERVATION 通道的当前示例：重导时必须从 OFFLINE_OPERATION 修正为 `item_usage = OBSERVATION_ONLY` + `interaction_type = TEACHER_OBSERVATION` + `scoring_type = NO_SCORE`，其现存"RUBRIC_BASED max_score=2"评分规则作废。

#### 5.3.3 interaction_type

`interaction_type` 进入 `question_bank.content_json`，不新增 schema 列。

MVP 数据合同枚举：

| interaction_type | 适用题型 | answer_shape | 自动评分 |
|---|---|---|---|
| `BINARY_SELECT` | TRUE_FALSE | `{ selected: boolean }` | 精确匹配 |
| `SINGLE_SELECT` | SINGLE_CHOICE | `{ selected_option_id: string }` | 精确匹配 |
| `MULTI_SELECT` | SOFTWARE_TASK | `{ selected_option_ids: string[] }` | 集合匹配/阈值 |
| `DRAG_DROP` | DRAG | `{ placements: [{ item_id, zone_id }] }` | 映射匹配 |
| `ORDERING` | DRAG | `{ ordered_item_ids: string[] }` | 顺序匹配 |
| `GESTURE_TASK` | SOFTWARE_TASK | `{ outcome, metrics }` | 指标阈值 |
| `TIMED_TASK` | SOFTWARE_TASK | `{ actions, metrics, final_state }` | 时间/事件阈值 |
| `TASK_SEQUENCE` | SOFTWARE_TASK | `{ completed_steps, step_order, metrics }` | 必要步骤和顺序 |
| `BRANCHING_TASK` | SOFTWARE_TASK | `{ path, messages, final_state }` | 必要节点/事件/终态 |
| `OFFLINE_RUBRIC` | OFFLINE_OPERATION | 不写 answer_record；教师评分 | 不自动评分 |
| `SYSTEM_DERIVED_OBSERVATION` | OBSERVATION_ONLY | 从事件派生 | 不计分 |

`GESTURE_TASK` 的 subtype 至少允许：

- `TRACE_PATH`
- `PRECISION_PLACEMENT`
- `CONTINUOUS_SLIDE`
- `MULTI_TOUCH_HOLD_DRAG`

`BRANCHING_TASK` 的 subtype 至少允许：

- `CLARIFICATION_REQUEST`
- `HELP_REQUEST`
- `STATUS_REPORT`
- `BREAK_NOTIFICATION`
- `SAFETY_RESPONSE`
- `FUNCTIONAL_COMMUNICATION`

`TIMED_TASK` 的 subtype 至少允许：

- `DELAYED_RESPONSE`
- `WAIT_AND_ACT`
- `SUSTAINED_ACTIVITY`
- `STOP_SIGNAL`

未列入的 subtype 可以在 `content_json` validator 中按 interaction_type 分支扩展，但不得使用任意字符串绕过校验。

§5.3.3 枚举表追加一行：

| interaction_type | 适用题型 | answer_shape | 自动评分 |
|---|---|---|---|
| `TEACHER_OBSERVATION` | OBSERVATION_ONLY | 不写 answer_record；教师观察编码进线下观察记录 | 不计分 |

强制合同：

```text
item_usage        = OBSERVATION_ONLY
interaction_type  = TEACHER_OBSERVATION
scoring_type      = NO_SCORE
score             = NULL
```

TEACHER_OBSERVATION 项：不进入正式计分题量、不进入 42+8、不进入能力总分、不进入 completion_ratio、不生成普通自动评分、不进入 `assessment_session_question`；只进入行为观察记录与报告描述区。

与 `SYSTEM_DERIVED_OBSERVATION` 的区分：后者的指标来源是软件任务事件派生，无教师现场编码；前者的指标来源是教师按题目定义的编码维度现场记录。validator 不得允许两者互换。

#### 5.3.4 presentation_type

`presentation_type` 进入 `content_json.presentation`，不新增 schema 列。

MVP 枚举：

- `TEXT_ONLY`
- `IMAGE_CARD`
- `AUDIO_PROMPT`
- `IMAGE_AUDIO`
- `VIDEO_SCENE`
- `INTERACTIVE_SCENE`
- `OFFLINE_MATERIAL`
- `SYSTEM_OBSERVATION`

`presentation_type` 只描述刺激呈现方式，不决定评分。

`VIDEO_SCENE` 规则：

1. 数据合同必须支持视频；实际视频素材可分批制作。
2. `VIDEO_SCENE` 题必须在 `presentation.assets` 绑定至少一个 `role = 'SCENE_VIDEO'` 且 `required = true` 的资产；缺少有效 SCENE_VIDEO（或经审核的图片替代素材）时题目保持 DRAFT。
3. 视频→图片降级只能**逐题**在专业审核后执行：`presentation_type` 改为 `IMAGE_CARD`，并在 `source.transformation` 记录 `VIDEO_TO_IMAGE_CARD` 及效度影响说明。
4. 不得仅为凑足 ACTIVE 题量批量将视频任务改成图片（工程约束第 61 条）。
5. M1-M6 的 68 条视频判断题默认目标形态为 `VIDEO_SCENE`。

#### 5.3.5 content_json 推荐合同

所有题目必须包含：

```json
{
  "schema_version": "question-content-v1.1",
  "question_type": "SOFTWARE_TASK",
  "sub_module": "不清楚时澄清",
  "target_construct": "在指令信息不完整时暂停执行并请求澄清",
  "presentation": {
    "presentation_type": "INTERACTIVE_SCENE",
    "prompt": "指令不清楚时，请用你能用的方式问清楚。",
    "standard_instruction": "请先听指令，再决定怎么做。",
    "instruction_repeat_limit": 1,
    "assets": [
      {
        "asset_key": "scene_background",
        "asset_id": "AST_BASE_RULE_009_SCENE_01_V1",
        "role": "SCENE_IMAGE",
        "required": true,
        "alt_text": "工作台与两个可能的放置区域"
      }
    ]
  },
  "interaction": {
    "interaction_type": "BRANCHING_TASK",
    "interaction_subtype": "CLARIFICATION_REQUEST",
    "config": {}
  },
  "expected_evidence": {
    "primary_evidence_type": "SOFTWARE_BEHAVIOR",
    "secondary_evidence_types": [],
    "observable_indicators": [
      "识别指令信息不完整",
      "未直接错误执行",
      "发出与缺失信息相关的澄清请求"
    ],
    "validity_boundary": "选择消息卡降低自主语言生成要求，报告须注明实际沟通方式。"
  },
  "support_policy": {
    "allowed_prompt_levels": ["P0", "P1"],
    "max_prompt_level_for_valid_score": "P1",
    "allowed_accommodations": [
      "AAC",
      "TOUCH_PEN",
      "VISUAL_AID",
      "HEARING_AID",
      "NON_KEY_FONT_SIZE_ADJUSTMENT",
      "NON_KEY_VOLUME_ADJUSTMENT"
    ],
    "prohibited_support": [
      "KEY_ANSWER_HINT",
      "DIRECT_ACTION_COMPLETION",
      "HAND_OVER_HAND_ASSISTANCE"
    ]
  },
  "termination_policy": {
    "allow_pause_on_distress": true,
    "technical_failure_is_not_zero": true,
    "safety_stop_codes": []
  },
  "log_metrics": [
    "first_action_latency_ms",
    "wrong_execution_count",
    "clarification_requested",
    "message_action_id",
    "completion_time_ms"
  ],
  "variant_group_id": null,
  "professional_review": {
    "required": false,
    "review_type": null,
    "status": "NOT_REQUIRED",
    "reviewed_by": null,
    "reviewed_at": null
  },
  "source": {
    "import_batch_id": "BATCH_202607_V02",
    "source_file": "通用基础能力正式测评候选题库_v0.2.csv",
    "source_sheet": "正式测评候选题库",
    "source_row": 47,
    "origin_refs": ["RULE-R122", "RULE-R125"],
    "transformation": "模糊指令角色任务数字化",
    "candidate_status": "PENDING_CONTENT_VALIDATION",
    "imported_at": "2026-07-07T00:00:00Z",
    "imported_by": "ADMIN_ID"
  },
  "note": null
}
```

##### 必填字段

- `schema_version`
- `question_type`
- `sub_module`
- `target_construct`
- `presentation.presentation_type`
- `presentation.prompt`
- `presentation.standard_instruction`
- `interaction.interaction_type`
- `interaction.config`
- `expected_evidence.primary_evidence_type`
- `expected_evidence.observable_indicators`
- `expected_evidence.validity_boundary`
- `support_policy.allowed_prompt_levels`
- `support_policy.allowed_accommodations`
- `termination_policy`
- `source`

##### 条件必填字段

- 有素材时：`presentation.assets`
- `SOFTWARE_TASK`：`log_metrics`
- 安全、PPE、授权工具和应急流程题：`professional_review.required = true`
- 平行题/档位题：`variant_group_id`
- `OFFLINE_OPERATION`：`offline_tool_brief`、标准材料规格、终止条件
- `OBSERVATION_ONLY`：`interaction_type = SYSTEM_DERIVED_OBSERVATION`

##### MVP 不新增的字段

- `parent_item_id`
- `scoring_rule_id`
- 公共 rubric 表外键
- 试卷 ID
- 题目编辑历史表

上述内容进入 Post-MVP 正式试卷或题库运营模型。

在 §5.3.5 合同基础上：

1. `schema_version` 升级为 `"question-content-v1.2"`。v1.1 结构是 v1.2 的真子集：v1.2 新增字段均为可选或条件必填，基础能力题不受影响。
2. 顶层新增可选块 `administration`（施测变体合同，见 §5.3.11）。缺省视为 `variant_type = "STANDARD"`。
3. 顶层新增可选字段 `variant_role`（与 `variant_group_id` 配对使用，见 §5.3.12）。
4. 选项类交互的 option 对象新增可选字段 `semantic_tag`，MVP 允许值：`"UNSURE"`（见 §5.4.4）。
5. `source` 新增可选字段：
   - `legacy_job_code`：旧库 job_code 原值（如 `supermarket_stocking`）。
   - `legacy_question_id`：旧库题目 ID（如 `M1_SC_001`），重导重命名时必填。
   - `source_ref_549`：549 题初始池原题号，仅作追溯。
6. 条件必填追加：
   - `bank_domain = 'JOB_SPECIFIC'`：`source.legacy_job_code`（迁移题）、`job_construct` 语义由 `target_construct` 承载（旧 ability_tags 非法值 `"0"`/`"1"` 必须在导入时修复为合法能力标签或置空，不得原样入库）。
   - `administration.variant_type ≠ 'STANDARD'`：`administration` 全块必填。
   - 平行/配对题：`variant_group_id` + `variant_role` 同时必填。
   - `presentation_type = 'VIDEO_SCENE'`：assets 含 `SCENE_VIDEO`。
7. `note` 字段只允许人类可读备注，**禁止存储状态值**（ACTIVE/DRAFT 等）；validator 检测到状态值时输出数据质量告警。

#### 5.3.6 字段落点总表

| 字段/概念 | MVP 落点 | 说明 |
|---|---|---|
| `question_id` | `question_bank` 表字段 | 唯一题目 ID；content_json 不重复 |
| `parent_item_id` | Post-MVP | testlet/复合题再引入 |
| `item_usage` | `question_bank` 表字段 | 组卷与计分必须 SQL 可过滤 |
| `module` | `question_bank.module_type` | 保持现有表字段 |
| `sub_module` | `content_json` | 不作为高频 SQL 过滤条件 |
| `target_construct` | `content_json` | 题目效度合同 |
| `question_type` | `question_bank` + content_json discriminator | 两者必须一致 |
| `interaction_type` | `content_json` | renderer 和 answer shape |
| `presentation_type` | `content_json` | 呈现方式 |
| `correct_answer` / `expected_answer` | `scoring_rule_json` | 唯一事实源 |
| `scoring_rule_id` | Post-MVP | MVP 使用内嵌 JSON |
| `scoring_rule_json` | 现有表字段 | 判分合同 |
| `support_level_allowed` | `content_json.support_policy.allowed_prompt_levels` | 不新增表字段 |
| accommodations | `content_json.support_policy` + answer payload | 允许项和实际使用分开 |
| assets | 主素材列 + `content_json.presentation.assets` | 不存本地绝对路径 |
| `log_metrics` | `content_json` | 声明允许/要求记录的指标 |
| `difficulty` | `question_bank.difficulty_level` | 不在 JSON 重复 |
| `safety_critical` | 继续使用 `safety_sensitive` | 不新增同义字段 |
| `sensory_tags` | `question_bank.sensory_tags_json` | 继续使用现有列 |
| evidence type | `content_json.expected_evidence` | 报告按证据类型分组 |
| validity boundary | `content_json.expected_evidence` | 报告必须显示 |
| source | `content_json.source` | 保留源文件、行号、原始引用和调整方式 |
| professional review | `content_json.professional_review` | ACTIVE 门禁校验 |

#### 5.3.7 scoring_rule_json

正确答案和判分条件统一进入 `scoring_rule_json`。

MVP `scoring_type`：

- `EXACT_MATCH`
- `SET_MATCH`
- `MAPPING_MATCH`
- `ORDER_MATCH`
- `METRIC_THRESHOLD`
- `EVENT_RULE`
- `OFFLINE_RUBRIC`
- `NO_SCORE`

线上规则必须包含：

```json
{
  "schema_version": "scoring-rule-v1.1",
  "scoring_type": "METRIC_THRESHOLD",
  "scoring_mode": "AUTOMATIC",
  "criteria_logic": "ALL",
  "criteria": [
    { "metric": "correct_count", "operator": "GTE", "value": 10 },
    { "metric": "random_touch_count", "operator": "LTE", "value": 1 }
  ],
  "pass_score": 2,
  "fail_score": 0,
  "scoring_engine_version": "1.0.0"
}
```

约束：

1. 线上 `pass_score` 固定 2，`fail_score` 固定 0。
2. 禁止 `partial_score = 1`。
3. 禁止在 JSON 中存储或执行任意 JavaScript 表达式。
4. `operator` 只能来自 validator 白名单：`EQ / NE / GT / GTE / LT / LTE / IN / NOT_IN`。
5. 集合题、映射题、顺序题必须保存正式 expected answer。
6. `NO_SCORE` 仅允许 `item_usage = OBSERVATION_ONLY`。
7. `OFFLINE_RUBRIC` 保留 0/1/2 三档描述。
8. 评分器必须把 `scoring_engine_version` 写入答题和结果快照。

岗位题评分规则补充：

1. **命名迁移**：`RUBRIC_BASED` 不得进入新库，统一迁移为 `OFFLINE_RUBRIC`；`DRAG_PARTIAL` 废止，排序题迁移为 `ORDER_MATCH`、分类题迁移为 `MAPPING_MATCH`。
2. **OFFLINE_RUBRIC 三档行为锚点必填**：每个 criterion 必须提供逐题撰写、可现场观察复核的 `description_0` / `description_1` / `description_2`。validator 拒绝以下通用模板（含语义等价变体）："未完成 / 未能完成"、"部分完成"、"完全达标 / 完成"。
3. 角色扮演题旧有"话术 1 分 / 找人 2 分 / 交接 2 分"五分式规则必须转换为 0/1/2 三档行为锚点，转换结果标记 [需专业确认]，不得由系统自行推断。
4. **UNSURE 判分**：含 UNSURE 选项的题仍用 `EXACT_MATCH`；选中 UNSURE 不属于正确答案 → `score = 0`，但记录语义见 §5.4.4。
5. 线上题最终成绩继续只有 0/2；部分完成、错误类型等只进入 `answer_payload_json.metrics`。

#### 5.3.8 素材资产结构与命名规范

##### 资源职责

- `asset_resource`：物理文件完整性、URI、hash、大小、尺寸、时长和状态。
- `question_bank.media_asset_id`：题目的主刺激或预览素材，只允许一个。
- `content_json.presentation.assets[]`：选项图、拖拽子素材、场景图、语音指令等多素材绑定。
- `tool_asset_ids_json`：只用于线下教具清单、材料模板或说明 PDF，不承载线上选项图片。

##### assets[] 最小字段

- `asset_key`：题内稳定键。
- `asset_id`：指向 `asset_resource.asset_id`。
- `role`：语义角色。
- `required`：资源缺失时是否阻断题目。
- `alt_text`：无障碍和审核说明。
- `sort_order`：需要稳定顺序时填写。

MVP role 枚举：

- `SCENE_IMAGE`
- `PRIMARY_STIMULUS`
- `OPTION_IMAGE`
- `DRAG_ITEM_IMAGE`
- `DROP_ZONE_IMAGE`
- `BACKGROUND_IMAGE`
- `VOICE_PROMPT`
- `INSTRUCTION_AUDIO`
- `OFFLINE_TOOL_GUIDE`
- `REFERENCE_TEMPLATE`

##### asset_id 命名

```text
AST_{DOMAIN}_{MODULE}_{ITEM_NO}_{ROLE}_{SEQ}_V{N}
```

示例：

```text
AST_BASE_COG_013_SCENE_01_V1
AST_BASE_COG_013_OPTION_01_V1
AST_BASE_RULE_009_VOICE_01_V1
AST_BASE_FM_004_TOOL_GUIDE_01_V1
```

文件名建议：

```text
ast-base-cog-013-option-01-v1.webp
ast-base-rule-009-voice-01-v1.ogg
```

强制规则：

1. renderer 统一通过 `app://asset/<asset_id>` 读取。
2. 题目 JSON 不得保存绝对路径或 `AIimages/` 工作目录路径。
3. 已被 ACTIVE 或历史题目引用的素材不得覆盖同一 asset ID 的文件内容。
4. 图片重绘、裁切、文字修改、答案语义变化均创建新 asset ID。
5. 题目改用新 asset 时，按题目作废重建机制创建新 question ID。
6. ACTIVE 门禁扫描 content_json 中全部 asset_id，验证存在、状态 ACTIVE、hash 一致。
7. 生图提示词、模型参数和制作过程可保存在素材制作清单中；当前 MVP 不新增资产生成历史表。

---

同时适用以下题目冻结、档位与来源规则：

岗位题素材角色补充：

1. role 枚举新增：
   - `SCENE_VIDEO`：视频场景刺激（VIDEO_SCENE 题必备）。
   - `ROLE_PLAY_SCRIPT`：角色扮演标准台词脚本（对接手册附录 D）。
   - `SEALED_ADMIN_CONFIG`：密封施测配置（如预埋差错位置页，对接手册附录 B），仅记录员开启；渲染端与教师端默认不可见，访问控制由应用层保证。
2. `asset_id` 命名域新增 `JOB`：

```text
AST_JOB_{MODULE}_{ITEM_NO}_{ROLE}_{SEQ}_V{N}
示例：AST_JOB_M1_015_SCENE_VIDEO_01_V1
      AST_JOB_M5_054_ROLE_PLAY_SCRIPT_01_V1
      AST_JOB_M4_035_SEALED_ADMIN_CONFIG_01_V1
```

3. `asset_resource` 现有时长/尺寸/hash 字段直接承载视频文件；视频同样受"已引用不得覆盖、修订创建新 asset_id"约束。

#### 题目内容冻结与作废重建

`question_bank` 与 `strategy_config` 遵循相同的历史事实锁定哲学：

1. **冻结条件**：题目一旦被任何 `answer_record` 引用，或被任何已发起的 `assessment_session` 组卷选中，即视为历史事实的一部分。
2. **冻结字段**：`module_type`、`question_type`、`difficulty_level`、`content_json`（题干、素材、变体、答案）、`scoring_rule_json`。
3. **修订方式**：不得原地 `UPDATE` 冻结字段。修订必须：
   - 新建题目（新 `question_id`，建议在原 ID 上追加版本后缀，如 `Q_BASE_COGNITION_SC_009_V2`）；
   - 旧题目状态转 `ARCHIVED`，写入 `superseded_by_question_id` 指向新题目；
   - 新题目按正常审核流程 `DRAFT → ACTIVE`。
4. **未被引用的 `DRAFT / DISABLED` 题目**可自由修改。
5. 历史 session 的答题记录始终通过原 `question_id` 复现当时的题目内容。

#### 档位与平行题规则

针对《优化建议报告》中的分挡与平行题建议：

1. 时间分挡（静坐 3/5 分钟、持续操作 2/3 分钟）、重量分挡（<3kg / 3-8kg）、低刺激平行题（大小球排序替代线材排序）等，一律登记为**独立题目**（不同 `question_id`），通过 `content_json.variant_group` 标注同源变体组。
2. 一套组卷策略版本（`strategy_config` 的一个 version）中，同一变体组只允许选定一个档位。**同一 session 内禁止临场换档**。
3. 因感官画像触发的替代题使用，按 §10.4 降级机制处理并记录，不属于临场换档。
4. 不同档位组成的策略版本产生的 `normalized_score` **不做跨档位横向比较**；报告必须展示本次测评使用的策略版本与档位说明。

#### 源文件口径

BASE_ABILITY 唯一权威来源为 `doc/reference/通用基础能力正式测评候选题库_v0.2-软件优先版.xlsx`，由一次性导入脚本读取并映射；归档旧表和旧 SQL 不得重新作为输入。

---

#### 5.3.9 题库导入字段映射

| 源字段 | 入库目标 |
|---|---|
| 题目ID | `question_bank.question_id` |
| 模块 | `question_bank.module_type` |
| 子维度 | `content_json.sub_module` |
| 呈现方式 | `content_json.presentation.presentation_type` |
| 交互类型 | `content_json.interaction.interaction_type/subtype` |
| 数字化等级 | `source.digitalization_level` |
| 预期难度 | `question_bank.difficulty_level` |
| 目标构念 | `content_json.target_construct` |
| 测评任务 | `presentation.prompt` 与 interaction config |
| 软件界面/标准材料 | assets / offline material config |
| 标准施测指令 | `presentation.standard_instruction` |
| 达标行为/正确反应 | `expected_evidence.observable_indicators` + scoring rule |
| 核心评分点 | `scoring_rule_json.criteria` |
| 允许的标准支持 | `content_json.support_policy` |
| 终止/安全条件 | `content_json.termination_policy` |
| 系统记录指标 | `content_json.log_metrics` |
| 证据类型 | `expected_evidence.primary/secondary_evidence_types` |
| 效度边界 | `expected_evidence.validity_boundary` |
| 来源追溯 | `content_json.source.origin_refs` |
| 调整方式 | `content_json.source.transformation` |
| 需专业确认 | `content_json.professional_review` |
| 候选状态 | `content_json.source.candidate_status`；question_bank 仍为 DRAFT |
| 备注 | `content_json.note` |

导入特殊规则：

- 跨任务系统观察项导入为 `item_usage = OBSERVATION_ONLY`、`scoring_type = NO_SCORE`。
- 无法识别 interaction_type 的行导入失败或保持 DRAFT，不得猜测映射。
- 需专业确认且未确认的题保持 DRAFT。
- 素材缺失、判分规则不完整、renderer 未实现的题保持 DRAFT。
- 导入脚本不得自动生成缺失题目、答案或素材。

---

#### 5.3.10 专业岗位题库治理：bank_domain 与 job_module_code

##### 5.3.10.1 bank_domain

`question_bank` 新增数据库级字段：

```sql
bank_domain TEXT NOT NULL
CHECK (bank_domain IN (
  'BASE_ABILITY',
  'JOB_SPECIFIC'
))
```

语义：

- `BASE_ABILITY`：基础能力评估题库（Q_BASE_* 与 v0.2 候选题库）。
- `JOB_SPECIFIC`：专业岗位能力题库（含 M1-M6 全部 298 条）。

强制规则：

1. 域隔离必须由 `bank_domain` 承担，**不得**用题目 ID 前缀、job_code、question_role、allowed_roles、module_type 或命名约定替代（工程约束第 57 条）。
2. 基础能力组卷 SQL 必须显式包含 `bank_domain = 'BASE_ABILITY'` 过滤条件。
3. `bank_domain` 属冻结字段（第 66 条决策）。

##### 5.3.10.2 job_module_code

`question_bank` 新增字段：

```sql
job_module_code TEXT
CHECK (
  job_module_code IS NULL
  OR job_module_code IN ('M1', 'M2', 'M3', 'M4', 'M5', 'M6')
)
```

域约束（schema CHECK 强制）：

| bank_domain | module_type | job_module_code |
|---|---|---|
| BASE_ABILITY | 必填（六大能力枚举） | 必须为 NULL |
| JOB_SPECIFIC | 必须为 NULL | 必填（M1-M6） |

M1-M6 现库的机械映射（M1→RULE_EXECUTION、M2→FINE_MOTOR、M3→COGNITION、M4→EMOTION_REGULATION、M5→SAFETY_OPERATION、M6→BASIC_SOCIAL）在重导时**全部作废**：`module_type` 置 NULL，岗位模块写入 `job_module_code`。

岗位题涉及的精细动作、认知、安全、社交等复合能力可进入 `content_json` 的能力标签（`ability_tags` / `target_construct`），但不得再把岗位模块伪装为基础能力主模块。报告中不得出现"库房收纳和盘点 = 情绪调节"、"商品识别与分类 = 基础社交"等错误解释。

##### 5.3.10.3 job_code 统一

- 旧 M1-M6 数据的 `supermarket_stocking` 必须统一迁移为现行正式值 `SUPERMARKET_SHELVER`。
- 旧值只保存在 `content_json.source.legacy_job_code`。
- 新库不得让两个 job_code 并存；导入 validator 拒绝 `supermarket_stocking` 作为正式 job_code 写入。

##### 5.3.10.4 JOB_SPECIFIC 结果边界

```text
BASE_ABILITY
→ BASELINE_ASSESSMENT / MOCK_EXAM 策略
→ 42+8，满分 100
→ ABILITY_SCORE
→ 六大基础能力 module_profiles

JOB_SPECIFIC
→ JOB_SKILL_ASSESSMENT 策略（MVP 固定示范卷 18+6+观察 0-3）
→ 满分 48
→ JOB_SKILL_SCORE
→ M1-M6 岗位模块画像（result_payload_json 内）
→ report_scope = JOB_SKILL 专业岗位报告
→ 基于固定规则的训练重点建议
→ 不复用基础能力模块兜底；不输出就业安置结论
→ 298 题全量运营、随机组卷进入 Post-MVP
```

##### 5.3.10.5 M1-M6 旧库重导规则

1. 重导后 298 条全部默认 DRAFT，**不得沿用旧 ACTIVE 状态**（现库 295 条 ACTIVE 视为 v0.1.10 历史遗留错误状态）。
2. 逐题通过答案键审核（`answer_key_verified`）、素材审核、rubric 三档锚点审核后方可进入 ACTIVE 门禁流程。
3. 安全题（safety_sensitive 26 条）、角色扮演题（5 条）、嵌入观察题（3 条）必须通过专业审核（`professional_review`）。
4. 无素材、无三档 rubric、答案存疑（含 `M1_TF_015`）、交互未实现的题不得转 ACTIVE。
5. 数据清洗强制项：
   - `ability_tags` 含 `"0"` 或 `"1"` → 导入失败（修复后重试）。
   - `note` 存储状态值 → 数据质量告警并清洗。
   - `RUBRIC_BASED` / `DRAG_PARTIAL` → 按 §5.3.7 迁移，原值不得入库。
   - 3 条嵌入观察 → 按 §5.3.2 修正为 OBSERVATION_ONLY + TEACHER_OBSERVATION + NO_SCORE。
   - `supermarket_stocking` → `SUPERMARKET_SHELVER` + `source.legacy_job_code`。
6. 导入 dry-run 必须输出：
   - 模块×题型对账矩阵（必须与 §0.2 实测一致：96/68/34/97/3）。
   - 单选与判断题答案位置/方向分布（含 C 位偏置统计）。
   - 素材缺口清单（media_brief 有值但无资产逐条列出）。
   - 非法字段清洗报告（ability_tags、note、命名迁移、job_code）。
   - rubric 三档锚点缺口清单。
   - 每题 ACTIVE 阻断原因码。

#### 5.3.11 施测变体合同 content_json.administration

用于承载标准化施测条件，**不新增 question_type**。

```json
{
  "administration": {
    "variant_type": "INTERRUPTION",
    "standard_instruction": "不好意思打断一下——你昨天晚饭吃了什么？",
    "instruction_repeat_limit": 0,
    "requires_two_examiners": true,
    "parameters": {
      "interrupt_at_progress": 0.5,
      "max_wait_seconds": 20
    },
    "observation_dimensions": [
      "RESUME_WITHOUT_REDO",
      "PARTIAL_REDO",
      "FULL_REDO",
      "NEEDS_PROMPT_TO_RESUME"
    ],
    "script_asset_id": null,
    "sealed_config_asset_id": null
  }
}
```

`variant_type` 枚举（MVP）：

- `STANDARD`：标准施测（缺省）。
- `INTERRUPTION`：中断版（中断时点、标准中断语、恢复编码）。
- `DISTRACTION`：干扰版（环境音资产、音量参数、隔日平行要求）。
- `PLANTED_ERROR`：预埋差错版（`sealed_config_asset_id` 指向密封差错页；检出/检出未报告/未检出编码）。
- `TIME_LIMITED`：限时版（时限、可视沙漏规则、到时即停不预警）。
- `VIGILANCE`：警觉衰减版（隐性问题总数、衰减点编码）。
- `ROLE_PLAY`：角色扮演（`script_asset_id` 指向标准台词脚本；`requires_two_examiners = true`）。

字段规则：

1. `variant_type = 'STANDARD'` 时其余字段必须为空/缺省；`administration.standard_instruction` 仅承载**变体专用逐字脚本**（如标准中断语、模糊指令台词），不替代也不重复 `presentation.standard_instruction`。
2. `observation_dimensions` 是题目声明的编码维度白名单；未声明的维度不得写入观察结果。
3. 施测变体的实际观察结果进入 `offline_score_record.observation_payload_json`（见 §11.12.8）或对应事件 payload，**不得直接混入题目 0/1/2 得分**。
4. 中断后的恢复方式、预埋差错检出、是否报告、是否需提示等属于观察指标，不得直接等同成绩（沿用 §16.6.7 与工程约束第 46 条精神）。
5. INTERRUPTION / DISTRACTION / PLANTED_ERROR / VIGILANCE / ROLE_PLAY 仅允许用于 OFFLINE_OPERATION 或 OBSERVATION_ONLY 条目；TIME_LIMITED 可用于线上 SOFTWARE_TASK（此时时限由 scoring_rule 显式定义为目标构念）。

当前 MVP 必须提供固定示范卷所需的专业岗位施测 UI、数据合同、validator、导入和存储；不实现 298 题全量运营后台。

#### 5.3.12 平行/配对关系 variant_group_id + variant_role

使用 `variant_group_id` 与 `content_json.variant_role`，表达同组平行题的角色：

```json
{
  "variant_group_id": "VG_JOB_M4_STORE_OFFICE_001",
  "variant_role": "STORE_CONTEXT"
}
```

MVP `variant_role` 允许值：

- `STORE_CONTEXT` / `OFFICE_CONTEXT`：门店版 / 文职平行版（M4_OP_028-042 ↔ M4_OP_043-048 [需确认逐题配对表]）。
- `SCAFFOLDED` / `UNSCAFFOLDED`：支架版 / 无支架版拖拽配对。MVP 保持现有题记录且不启用支架分差自动解释；Post-MVP 如经内容负责人决定拆分，支架版通过 `interaction.config.prefilled_placements` 锁定首步。
- `QUIET_VERSION` / `DISTRACTION_VERSION`：安静版 / 干扰版配对（M1_OP_045）。

规则：

1. 同组题必须同 bank_domain、同 job_module_code、同目标构念。
2. 分差计算（支架分差、门店-文职分差、干扰分差）属 Post-MVP 专业岗位报告；MVP 只保证配对关系可查询。
3. 当前 MVP 不新增 `parent_question_id`；变式母题指针列入 Post-MVP（见 §18）。

---

#### 5.3.13 固定示范卷与 question_policy FIXED_SET

本版不新增 `assessment_paper` 表。固定题集保存在 JOB_SKILL_ASSESSMENT 策略的 `strategy_config.question_policy_json`：

```json
{
  "schema_version": "question-policy-v1.2",
  "bank_domain": "JOB_SPECIFIC",
  "selection_mode": "FIXED_SET",
  "job_module_quotas": {
    "M1": { "online": 3, "offline": 1 },
    "M2": { "online": 3, "offline": 1 },
    "M3": { "online": 3, "offline": 1 },
    "M4": { "online": 3, "offline": 1 },
    "M5": { "online": 3, "offline": 1 },
    "M6": { "online": 3, "offline": 1 }
  },
  "fixed_scored_question_ids": [],
  "embedded_observation_question_ids": [],
  "fallback_strategy": "BLOCK"
}
```

规则：

1. `fixed_scored_question_ids`（24 个）与 `embedded_observation_question_ids`（0-3 个）随 strategy version 冻结；同一 version 不得原地修改固定题集，调整必须新增 strategy version。
2. session 创建时校验：固定题全部存在、status = ACTIVE、bank_domain = JOB_SPECIFIC、item_usage 与列表用途一致、模块配额满足、素材齐全、renderer 已注册；任一不满足 → 发起测评失败（返回明确原因码），不得临时从 DRAFT 题中随机补题。
3. 不得为凑题量降低素材、rubric 或答案审核标准（沿用工程约束第 56 条精神）。
4. 基础能力策略的 question-policy-v1.2 继续使用 §7.6.1 结构（`eligible_bank_domains: ["BASE_ABILITY"]`、`selection_mode` 缺省为随机组卷）；validator 按 `selection_mode` 分支校验。
5. 观察项 ID 必须满足 `item_usage = OBSERVATION_ONLY` 且 `interaction_type = TEACHER_OBSERVATION`；候选为 3 条嵌入观察（M1_OB_048、M5_OB_048、M5_OB_055）；只有通过内容、专业与素材门禁的观察项才可进入当前策略版本。

#### 5.3.14 固定示范卷素材范围

MVP 不要求完成 298 题全部素材，只需完成：

1. 固定 18 道线上题的全部素材（场景图/选项图/视频）。
2. 固定 6 道线下题的标准材料清单与逐题 rubric。
3. 0-3 个教师观察项的施测脚本（标准动作、台词、编码卡）。
4. **至少 1 个特色施测变体**，优先从预埋差错、角色扮演、中断恢复中选择（administration 合同按 §5.3.11 执行）。

视频规则：

- 必须依赖动态线索的题（动作过程判断）制作短视频（VIDEO_SCENE + SCENE_VIDEO）。
- 静态图片不影响构念的题，可经逐题专业审核降级为 IMAGE_CARD（`source.transformation = VIDEO_TO_IMAGE_CARD` + 效度说明）。
- 其余非示范题继续 DRAFT，不要求制作全部 68 道视频。

#### 5.3.15 答案键审核合同 content_json.review

```json
{
  "review": {
    "answer_key_status": "PENDING",
    "answer_key_reviewed_by": null,
    "answer_key_reviewed_at": null,
    "answer_key_review_note": null
  }
}
```

- `answer_key_status` 枚举：`NOT_REQUIRED`（无标准答案的观察项等）/ `PENDING` / `VERIFIED` / `CORRECTED` / `REJECTED`。
- 自动评分题（TRUE_FALSE / SINGLE_CHOICE / DRAG / SOFTWARE_TASK）只有 `VERIFIED` 或 `CORRECTED` 才可 ACTIVE。
- `M1_TF_015` 未人工核验前必须保持 DRAFT，不得进入固定示范卷。
- OFFLINE_OPERATION 的 rubric 必须通过逐题三档锚点门禁；观察项 `answer_key_status = NOT_REQUIRED`。

#### 5.3.16 target_construct 与 ability_tags 职责分离

- `content_json.target_construct`：题目直接测量构念的唯一承载字段；不新增 `job_construct`。
- `ability_tags` 规则：
  - BASE_ABILITY：至少 1 个合法六大能力值。
  - JOB_SPECIFIC：允许空数组；允许合法六大能力**辅助**标签；不得作为 M1-M6 主模块分类；不得出现 `"0"`、`"1"` 或任何非法值（导入失败）。
- M1-M6 主模块只由 `question_bank.job_module_code` 承担。

---

### 5.4 测评功能

#### 功能说明

教师发起测评后，学生进入基础能力评估流程。测评评估学生在精细动作、认知理解、规则执行、情绪调节、基础社交、安全操作 6 大基础能力维度上的通用水平，作为后续训练、实操评分与就业安置方向建议的基线。

MVP 的基础能力测评，不再区分「拆箱与上架任务测评」与「基础能力标准化模拟卷」两套口径。

#### 测评规则

MVP 基础能力评估默认策略：

- 线上 42 题（6 模块 × 7 题），每题 `0 / 2` 分，自动判分，小计 84 分。
- 线下 8 题，每题 `0 / 1 / 2` 分，教师评分，小计 16 分。
- 满分 100。
- 等级阈值：`LEVEL_COMPETENT >= 80`；`LEVEL_CONDITIONAL >= 60`；`< 60` 为 `LEVEL_NOT_COMPETENT`。
- 模块兜底：任一模块**线上得分率** `< 50%`（即模块 14 分中得分 < 7）触发 `LEVEL_NOT_COMPETENT`。
- 情绪崩溃兜底：累计 3 次崩溃坐次（默认，可配）。
- `LEVEL_FAIL_BY_SAFETY` 优先级最高。
- 分段施测：默认允许多坐次，`session_validity_days` 默认 14 天。

#### 测评过程

8. 全部线上题完成后，session 进入 `OFFLINE_PENDING`，等待线下 8 题教师评分（`score_scope = OFFLINE_ABILITY`）。
9. 线下 8 题评分提交完成后，系统计算：线上 6 模块得分率、线下得分、综合总分、`completion_ratio`。
10. 系统按 §7.3 / §7.4 优先级判定等级，生成 `ABILITY_SCORE` 结果（含 `level_result`、`normalized_score`、`completion_ratio`、模块得分明细）。

---

#### 产品规则

- 学生提交后的答案不得直接覆盖。
- 如需修改，必须通过 revision 机制生成新记录。
- 测评中断后必须支持恢复。
- 异常退出后不得丢失已提交题目。
- 测评完成后进入终态，不允许直接修改状态。
- 模块得分率、崩溃次数与等级判定依据必须随结果记录一同持久化，不得只存最终等级。

#### 5.4.1 response_status

`answer_record` 和 `offline_score_record` 必须支持以下题目级响应状态：

- `ANSWERED`：已形成有效答案或教师评分。
- `NOT_APPLICABLE`：因运动、视觉、听觉或沟通条件，该题不适用/未施测。
- `STOPPED_SAFETY`：题目执行中因疼痛、疲劳或具体安全风险停止。
- `TECHNICAL_INTERRUPTION`：设备、素材或输入故障导致无法完成。
- `ASSISTED_NOT_SCORED`：P3 直接答案提示、代操作或手把手协助后完成，仅保留过程记录。

规则：

1. `ANSWERED` 时线上 score 只能为 0/2，线下 score 只能为 0/1/2。
2. 其他状态下 `score = NULL`、`is_correct = NULL`。
3. `STOPPED_SAFETY` 不自动等于 `safety_incident`；只有实际出现安全红线行为时才进入安全事件流程。
4. `TECHNICAL_INTERRUPTION` 不得记 0 分。
5. 存在预先批准的同构替代题时，替代必须在 session 组卷时完成；同一 session 内不临场换题。
6. session 最终存在未评分项目时，`completion_ratio < 1`，报告不得输出就业安置方向。

#### 5.4.2 支持等级

提示等级：

| 等级 | 定义 | 计分规则 |
|---|---|---|
| P0 | 标准指令，无额外提示 | 可自动评分 |
| P1 | 按规则完整重复一次，或非答案性澄清 | 题目允许时可评分 |
| P2 | 提供过程性提示，但不直接给答案 | 由题目规则决定，默认教师复核 |
| P3 | 直接答案提示、代操作或手把手协助 | `ASSISTED_NOT_SCORED` |

合理便利 accommodations 单独记录，包括但不限于：

- AAC
- TOUCH_PEN
- VISUAL_AID
- HEARING_AID
- DAILY_ASSISTIVE_DEVICE
- NON_KEY_FONT_SIZE_ADJUSTMENT
- NON_KEY_VOLUME_ADJUSTMENT
- APPROVED_REST_BREAK

合理便利本身不自动扣分。只有当便利改变目标构念或违反题目 `support_policy` 时，才影响有效性。

P0-P3 与 accommodations 使用以下统一映射：

| 旧等级（手册 v1.0） | 新等级 | 默认处理 |
|---|---|---|
| 无提示 | P0 | 正常计分 |
| L1 一般提醒、完整重复标准指令 | P1 | 题目允许时可计分 |
| L2 定向提示、过程性线索 | P2 | 教师复核并标注支持依赖 |
| L3 示范、指出关键步骤、代操作或手把手协助 | P3 | `ASSISTED_NOT_SCORED`，score = NULL |

- 旧规则"L3 后得分上限为 3 分"**废止**。
- 不得重新引入 5 分制。
- M1-M6 重导时，题目 `support_policy.allowed_prompt_levels` 按映射后的 P 级填写。

#### 5.4.3 题目提交和自动评分

1. renderer 根据 `question_type + interaction_type` 选择组件。
2. renderer 只提交结构化 response 和 metrics，不自行决定等级。
3. 主进程 validator 校验 answer shape。
4. 主进程评分器根据冻结的 `scoring_rule_json` 产生 0/2 或不计分状态。
5. 写入 `action_log.jsonl` 后投影到 `answer_record`。
6. `answer_payload_json.scoring_snapshot` 必须保存评分器版本、通过结果和失败条件，保证历史复核。

---

#### 5.4.4 "不清楚"选项

"不清楚 / 不确定，需要查询"是**有效作答**，不是 NR，也不是技术中断。

合同：

1. option 对象标记：

```json
{ "key": "C", "text": "不确定，需要查询", "semantic_tag": "UNSURE" }
```

2. 答题记录：

```text
response_status = ANSWERED
score = 0
answer_payload_json.metrics.unsure_selected = true
```

3. 禁止保存为 `NOT_APPLICABLE` 或其他非 ANSWERED 状态。
4. 报告表述为"主动表达不确定 / 需要进一步确认"，可作为元认知观察证据；不得简单统一表述为"答错"。
5. `unsure_selected` 属行为证据指标，不得单独解释为能力高低（沿用 §16.6.7）。

---

#### 5.4.5 JOB_SKILL_ASSESSMENT 测评运行时

##### 5.4.5.1 session 复用

专业岗位测评复用现有 `assessment_session` 及其全部机制：坐次（sitting）、暂停/恢复、崩溃中断恢复、`EMOTION_INTERRUPTED` / `SUSPENDED_REVIEW_REQUIRED` / `OFFLINE_PENDING` 开放态、安全红线（`REDLINE_HALTED` 优先且不可转出）、事件溯源与报告快照。**不得另建 `job_skill_assessment_session` 表。**

session 创建参数：

- `strategy_type = 'JOB_SKILL_ASSESSMENT'`、`job_code = 'SUPERMARKET_SHELVER'`。
- `task_code`：现表为 NOT NULL；专业岗位示范测评固定为 `JOB_SKILL_DEMO_M1M6`。
- `online_question_count = 18`、`offline_question_count = 6`（现有列直接承载）。

##### 5.4.5.2 session 题目快照

session 创建时必须将以下字段从 question_bank 快照写入 `assessment_session_question`：

`bank_domain`、`module_type`（BASE_ABILITY 题）、`job_module_code`（JOB_SPECIFIC 题）、`question_type`、`item_usage`、`question_phase`、`question_order`。

`question_phase` 三值：

- `ONLINE`：自动评分题（answer_record，0/2）。
- `OFFLINE`：教师 0/1/2 评分题（offline_score_record，score_scope = JOB_SKILL）。
- `OBSERVATION`：教师非计分嵌入观察（offline_score_record，score_scope = TEACHER_OBSERVATION）。

OBSERVATION phase 不生成普通 answer_record，不进入 `online/offline_question_count` 与完成率分母。

##### 5.4.5.3 TEACHER_OBSERVATION 运行时

```text
JOB_SKILL_ASSESSMENT session
→ OBSERVATION phase（教师在指定时机执行嵌入观察）
→ 教师录入观察编码
→ 事件 TEACHER_OBSERVATION_RECORDED（写 action_log.jsonl 后投影）
→ offline_score_record（score_scope = TEACHER_OBSERVATION，score = NULL，observation_payload_json 必填）
→ 专业岗位报告 teacher_observations 区块
```

观察 payload 合同（进入 `offline_score_record.observation_payload_json`，同时作为事件 payload 主体）：

```json
{
  "schema_version": "teacher-observation-v1.0",
  "observation_code": "ACCIDENT_RESPONSE",
  "observed": true,
  "behavior_codes": [
    "STOPPED_CURRENT_ACTION",
    "REPORTED_TO_TEACHER",
    "ATTEMPTED_SAFE_RECOVERY"
  ],
  "prompt_level": "P1",
  "accommodations_used": [],
  "observation_note": "碰倒水瓶后停止操作并主动报告。",
  "post_disclosure_status": "PENDING",
  "recorded_by": "TEACHER_ID",
  "recorded_at": "2026-07-07T00:00:00Z"
}
```

规则：

1. `behavior_codes` 必须属于题目声明的编码维度白名单（`administration.observation_dimensions` 或 rubric 声明）。
2. 观察记录不进入 raw_score / max_score / 计分 completion_ratio / 模块得分率；必须进入报告。
3. 观察记录缺失时，报告显示"观察完成度不足"（observation_completion_ratio < 1），**不伪装为 0 分**。
4. `post_disclosure_status`（NOT_REQUIRED / PENDING / COMPLETED）为可选字段，当前不作为任何门禁；伦理流程由产品负责人和学校专业团队裁决。
5. 观察项必须具备：observation_code、behavior_codes 白名单、允许的提示等级、是否观察到、观察说明、标准施测条件、终止条件（落 content_json：administration + termination_policy + rubric_criteria 编码说明）。

##### 5.4.5.4 线上/线下作答

- 线上题沿用 §5.4.3 提交与自动评分链路：renderer 提交结构化 response + metrics → 主进程 validator → 评分器按冻结 scoring_rule_json 产生 0/2 → 事件 → answer_record；response_status / 支持等级 / accommodations / UNSURE 合同全部适用。
- 线下题由教师按逐题三档锚点评 0/1/2，写入 offline_score_record（score_scope = JOB_SKILL）；施测变体观察编码写 `observation_payload_json`，不改变 0/1/2 得分。

#### 5.4.6 validateQuestionContract()

统一跨层 validator，导入、审核门禁、session 创建三处复用：

```ts
validateQuestionContract({
  questionRow,        // question_bank 行
  contentJson,
  scoringRuleJson,
  assetRegistry,
  rendererRegistry
})
```

至少校验：

1. bank_domain 与 module_type / job_module_code 域配对。
2. strategy_type 与 bank_domain 绑定（组卷入口调用时）。
3. item_usage 与 interaction_type（OBSERVATION_ONLY ↔ TEACHER_OBSERVATION / SYSTEM_DERIVED_OBSERVATION）。
4. item_usage 与 scoring_type（OBSERVATION_ONLY ↔ NO_SCORE）。
5. question_type 与 content_json.question_type 一致。
6. question_phase 与题型（OFFLINE_OPERATION ↔ OFFLINE；OBSERVATION_ONLY ↔ OBSERVATION；其余 ↔ ONLINE）。
7. presentation_type 与资产 role（VIDEO_SCENE ↔ 必有 required SCENE_VIDEO）。
8. VIDEO_TO_IMAGE_CARD 降级必须有专业审核记录与效度说明。
9. `content_json.review.answer_key_status`（自动评分题须 VERIFIED / CORRECTED）。
10. OFFLINE_RUBRIC 逐题三档行为锚点（拒绝通用模板）。
11. professional_review（安全/角色扮演/嵌入观察题）。
12. renderer registry 已注册且启用。
13. required assets 存在、ACTIVE、hash 一致。
14. ability_tags 合法性（含 JOB_SPECIFIC 空数组规则、拦截 `"0"`/`"1"`）。
15. 固定示范卷校验模式：fixed set 中题目全部 ACTIVE 且满足以上全部。

---

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

#### 双轨分离

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

评分标准、评分流程、revision 机制和安全红线约束均按本文对应章节执行。

---

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

基础任务报告生成时必须固化当时的三类任务闭环结果：

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
- **就业安置方向建议**：基于 `ABILITY_SCORE` 等级映射，详见 §7.4。
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

报告内容还必须包含：

- 施测坐次记录（坐次数、每坐次日期时长、分段方式）。
- `completion_ratio` 与中途终止标记（若适用）。
- 本次测评使用的策略版本与题目档位说明。
- **就业安置方向建议区块必须包含**：
  - 固定免责声明："本安置方向为系统基于单次测评的参考建议，不构成安置决定，须由专业评估团队结合多次评估、行为观察与家庭意见综合决策。"
  - 教师复核确认信息（复核人、复核时间）。

附加产品规则：

- 报告导出前必须完成安置建议复核确认（`PLACEMENT_REVIEW_CONFIRMED` 事件，写入 `task_report.placement_review_by / placement_review_at`）；未复核的报告可生成、可查看，**不可导出**。
- `completion_ratio < 1` 的测评结果，报告不输出就业安置方向，仅输出终止原因与过程记录。

---

#### 5.8.1 report_content_json v1.1

`task_report.report_content_json` 必须符合以下顶层结构：

```json
{
  "report_schema_version": "task-report-v1.1",
  "assessment_meta": {},
  "score_summary": {},
  "module_profiles": [],
  "evidence_summary": {},
  "support_summary": {},
  "administration_status": {},
  "behavior_observations": [],
  "validity_limitations": [],
  "safety_summary": {},
  "placement_advice": {}
}
```

##### assessment_meta

至少包含：

- session_id
- strategy_id / strategy_version
- question bank import batch
- scoring engine version
- content/scoring/report schema version
- sitting count 和每坐次时间
- completion_ratio
- 题目档位/variant 说明

##### score_summary

至少包含：

- raw_score
- max_score
- normalized_score
- level_result
- module_veto_triggered
- emotion_collapse_triggered
- safety_overridden

##### module_profiles

每模块至少包含：

- online_raw_score / 14
- online_score_rate
- 线下题表现摘要（只展示，不参与模块否决）
- response_status 分布
- 主要观察指标

##### evidence_summary

按以下证据类型分组：

- `SOFTWARE_BEHAVIOR`
- `SITUATIONAL_JUDGMENT`
- `DIRECT_PERFORMANCE`
- `SELF_REPORT`
- `SELF_REPORT_PLUS_BEHAVIOR`
- `EMBEDDED_OBSERVATION`

不得把不同证据类型合并成同义能力结论。

##### support_summary

至少包含：

- P0/P1/P2/P3 使用次数
- accommodations_used
- 指令重播次数
- 有效性受影响的题目

##### administration_status

至少包含：

- NOT_APPLICABLE 项目
- STOPPED_SAFETY 项目
- TECHNICAL_INTERRUPTION 项目
- ASSISTED_NOT_SCORED 项目
- 未完成项目
- 资源或设备异常

##### behavior_observations

只展示有解释价值的聚合指标，不展示原始 pointer trace。至少可承载：

- 自我纠正
- 求助/澄清/报告
- 休息请求
- 恢复与交接
- 持续参与
- 错误类型

##### validity_limitations

必须从题目 `expected_evidence.validity_boundary` 聚合生成，包括但不限于：

- 触控表现不等于真实手部力量或阻力控制。
- 图片判断不等于真实岗位操作达标。
- AAC 消息卡降低自主语言生成要求。
- 音频任务同时受听觉和语言理解影响。

##### placement_advice

试测策略默认：

```json
{
  "enabled": false,
  "reason_disabled": "PILOT_QUESTION_BANK_NOT_VALIDATED",
  "recommendation": null,
  "reviewed_by": null,
  "reviewed_at": null
}
```

完成内容效度复核、可用性测试和小样本试测后，必须通过新增 strategy version 启用，不得修改历史策略。

#### 5.8.2 报告解释约束

1. 软件精细动作只能解释为触控、视觉动作整合和界面操作表现。
2. 安全选择或流程题只能解释为风险识别和流程判断证据。
3. 直接动作表现必须来自 OFFLINE_OPERATION。
4. OBSERVATION_ONLY 不进入总分。
5. 反应时间、速度、帮助次数和休息请求不得单独解释为能力高低。
6. NR/ST 不显示为答错。

---

岗位题报告解释还必须满足：

7. JOB_SPECIFIC 不得进入基础能力 ABILITY_SCORE 或基础能力 module_profiles；在 JOB_SKILL 报告中按 §5.8.3 生成独立岗位模块画像与等级。
8. 岗位模块（M1-M6）不得以基础能力模块名称解释；禁止"库房收纳=情绪调节"、"商品识别=基础社交"类表述。
9. TEACHER_OBSERVATION 编码只描述反应类型（如"扶起清理/口头提醒/注视无动作/未注意"），"无反应"不得写成能力缺陷。
10. UNSURE 选择按 §5.4.4 表述，不显示为答错。
11. 施测变体观察编码（恢复方式、检出-报告、衰减点）只能转译为支持需求描述，不得下能力结论。

---

#### 5.8.3 专业岗位报告 job-skill-report-v1.0

复用现有 `task_report` 表（report_type 继续用 `FULL_REPORT`，不新增表字段），`report_content_json` 新增 scope 判别：

```json
{
  "report_schema_version": "job-skill-report-v1.0",
  "report_scope": "JOB_SKILL",
  "assessment_meta": {},
  "overall_summary": {},
  "job_module_profiles": [],
  "online_knowledge_summary": {},
  "offline_performance_summary": {},
  "support_summary": {},
  "teacher_observations": [],
  "administration_summary": {},
  "safety_summary": {},
  "validity_limitations": [],
  "recommended_training_focus": [],
  "recommended_training_tasks": [],
  "placement_advice": {
    "enabled": false,
    "reason_disabled": "MVP_DEMO_PROFILE_ONLY"
  }
}
```

基础能力报告继续使用 task-report-v1.1（`report_scope` 缺省视为 `BASE_ABILITY`）。

Demo 报告至少展示：① 总体得分；② M1-M6 六模块条形图或雷达图；③ 线上与线下表现对比；④ 使用的支持等级；⑤ 教师观察；⑥ 安全表现；⑦ 主要优势；⑧ 待训练模块；⑨ 推荐训练任务；⑩ 效度限制。

报告解释约束：

12. 报告不得自动生成岗位安置建议；禁止输出"适合就业 / 不适合就业 / 竞争性就业 / 支持性就业 / 岗位排除 / 自动安置结论"。
13. 训练建议必须表述为"基于固定规则的训练重点建议"，不得称为 AI 自动推荐。
14. 线上得分只解释为知识与情境判断表现，线下得分才是实操表现（知行分离进 validity_limitations）。
15. 观察完成度不足时如实呈现，不得以 0 分或空白伪装。

#### 5.8.4 与"拆箱与上架"训练的推荐衔接

落点：`result_payload_json.recommended_training_focus` + `report_content_json.recommended_training_tasks`。

MVP 固定规则（阈值由 scoring_policy_json 定义，模块得分率 < 60% 触发）：

```text
M2 得分偏低 → 推荐进入现有"拆箱与上架"训练任务（task_code = `UNBOXING_AND_SHELVING`）
M1 得分偏低 → 显示"建议后续开展货架整理专项训练"（无链接）
M3 得分偏低 → 显示"建议后续开展临期/破损识别专项训练"（无链接）
M4/M5/M6 同理 → 仅显示建议文案
```

规则：

1. 当前 MVP 只有“拆箱与上架”是完整训练闭环：M2 可直接链接现有训练任务，其他模块只显示建议文案，**不伪造尚未实现的训练模块与虚假链接**。
2. 推荐生成是纯函数：输入模块得分 + 固定规则表，输出建议列表；规则表随 strategy version 冻结。

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

### 6.5 坐次与开放态

1. 坐次不是独立聚合，不新增 session 表；坐次由 `SITTING_STARTED / SITTING_ENDED` 事件在 `domain_event_projection` 中投影（`sitting_no` 列）。
2. 坐次进行中 session 为 `ACTIVE`；坐次间歇 session 为 `SUSPENDED_REVIEW_REQUIRED`（开放态，仍受唯一开放会话约束与安全阻断约束）。
3. 同一 session 同一时刻只能有一个进行中坐次。
4. 未解决安全事件阻断的对象是"新会话"与"新坐次"：存在 `PENDING_DETAIL / CONFIRMED` 安全事件时，同学生同任务的挂起 session **不得发起新坐次**。
5. `session_validity_days` 超期的 session 由教师作废，作废原因记录为 `VALIDITY_EXPIRED`。

---

## 7. 评分模型与结果体系

### 7.1 结果类型

MVP 固定维护四类独立结果投影。

#### 第一类：能力测评分 ABILITY_SCORE

用于回答：

学生在 6 大基础能力维度上是否具备进入目标岗位的基础能力水平？

`ABILITY_SCORE` 由基础能力评估（线上 42 题 + 线下 8 题 / 满分 100）产生。线上题与线下题属于同一结果内部结构，不违反 §7.5 的结果独立原则。结果按 §7.4 规则触发模块兜底与情绪崩溃兜底。

来源：

- `answer_record`
- `assessment_session`
- `strategy_config`（含 `competent_threshold / conditional_threshold / module_veto_threshold / emotion_collapse_threshold`）

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

`ABILITY_SCORE` 的线下来源为：`offline_score_record（score_scope = OFFLINE_ABILITY）`。
`OPERATION_PASS_RATE` 来源修正为：`offline_score_record（score_scope = TASK_OPERATION）`。
两类结果的数据来源自 schema 层物理分流，禁止交叉读取。

---

#### 第四类：专业岗位测评分 JOB_SKILL_SCORE

用于回答：学生在超市理货员 M1-M6 岗位模块上的当前表现如何，哪些模块需要优先训练？

来源：

- JOB_SKILL_ASSESSMENT 的线上 `answer_record`
- `offline_score_record（score_scope = JOB_SKILL）`
- 不计分的 TEACHER_OBSERVATION 仅进入观察完成度和报告，不进入 raw score

JOB_SKILL_SCORE 满分 48，独立生成 M1-M6 岗位模块画像。它不得写成 ABILITY_SCORE，也不得与训练完成度或实操达标率混算；专业岗位报告不得输出就业安置结论。

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

基础能力评估的分值结构：

- 50 道题，每题最高 2 分，`max_score = 100`。
- 因此 `normalized_score` 与 `raw_score` 数值一致，无需再做归一化换算。
- 但 `raw_score / max_score * 100` 公式仍须保留，用于：
  - 后续题量或分值结构变更时（例如试卷模型 v0.2.0 引入非 50 题试卷）的通用性。
  - 训练完成度 `TRAINING_COMPLETION` 与实操达标率 `OPERATION_PASS_RATE` 的非百分制 raw 来源归一化。

`raw_score` 与 `max_score` 必须在 `result_record` 中独立记录，不得只存 `normalized_score`。

#### 7.2.1 中途终止计分规则

适用于崩溃兜底终止、安全红线终止、作废等一切非正常完成场景：

1. `max_score` 恒为 **100**，不随已答题量缩减。
2. 未答题目一律计 **0 分**。
3. `result_record.completion_ratio` = 已答题数（含线下已评分题）/ 50，必须持久化。
4. 模块得分率统一定义：**模块线上实得分 / 14**（分母恒为模块线上满分，未答计 0）。不得按已答题量缩小模块分母。
5. 中途终止的 `normalized_score` 仅作过程记录：
   - 不用于就业安置方向判定；
   - 不参与 §16.4 的能力测评分变化趋势统计（单列"未完成测评"口径）；
   - 崩溃兜底终止的等级恒为 `LEVEL_NOT_COMPETENT`，红线终止恒为 `LEVEL_FAIL_BY_SAFETY`，均与分数无关。
6. 正常完成（50 题全部作答与评分）的结果，`completion_ratio = 1`，方可进入安置方向映射。

---

#### 7.2.2 题目级不计分状态与结果投影

1. item-level `score = NULL` 不等于 0 分。
2. 若 session 最终因 NR/ST/技术中断存在未完成项目，结果投影仍保持 `max_score = 100`，未形成有效分数的项目在过程分计算中按 0 占位，但必须同时：
   - `completion_ratio < 1`；
   - 标记 `incomplete_reason`；
   - 不进入安置方向；
   - 不进入完整测评趋势比较。
3. 报告必须显示“过程分”而非“完整能力结论”。
4. OBSERVATION_ONLY 不在分母 50 内。
5. 线上部分完成指标只用于判断 pass/fail 和行为分析，不产生 1 分。

---

#### 7.2.3 专业岗位评分模型

MVP 必须形成：总原始分（/48）、百分制归一化分、M1-M6 模块得分与得分率、线上得分（/36）、线下实操得分（/12）、支持等级分布、教师观察、安全表现、推荐训练重点。

##### 等级

复用现有四等级，专业岗位报告文案独立定义：

| 等级 | 专业岗位报告文案 |
|---|---|
| LEVEL_COMPETENT | 当前示范任务表现较稳定 |
| LEVEL_CONDITIONAL | 在明确支持或结构化提示下可完成 |
| LEVEL_NOT_COMPETENT | 当前仍需专项训练和更多支持 |
| LEVEL_FAIL_BY_SAFETY | 因安全红线终止，本次不形成普通能力结论 |

等级阈值沿用 strategy_config 表字段（competent_threshold / conditional_threshold）；JOB_SKILL 策略固定使用 80/60。

##### 模块兜底

**不照搬**基础能力"任一模块得分率低于 module_veto_threshold 即整体不胜任"的规则。专业岗位模块低分不覆盖总等级，当前策略为：

- 计算并展示每个模块得分与得分率；
- 安全红线继续优先覆盖（LEVEL_FAIL_BY_SAFETY）；
- 不因单个模块低分自动覆盖总等级；
- 低分模块写入 recommended_training_focus。

落点：JOB_SKILL 策略的 `scoring_policy_json` 显式声明 `"module_veto_mode": "DISABLED_RECORD_ONLY"`；评分器对 JOB_SKILL_ASSESSMENT 忽略 `strategy_config.module_veto_threshold` 表字段（该列 NOT NULL，种子仍填 0.5 但不生效，schema 注释说明）。情绪熔断兜底（emotion_collapse_threshold）沿用现有机制。

##### scoring_policy_json（JOB_SKILL 策略）

```json
{
  "schema_version": "scoring-policy-v1.2",
  "assessment_scope": "JOB_SKILL",
  "online_score_values": [0, 2],
  "offline_score_values": [0, 1, 2],
  "normalization": "raw_score/max_score*100",
  "module_veto_mode": "DISABLED_RECORD_ONLY",
  "training_focus_threshold": 0.6,
  "safety_override_enabled": true,
  "placement_advice_enabled": false
}
```

##### result_record 合同

```text
result_type            = JOB_SKILL_SCORE
source_aggregate_type  = ASSESSMENT_SESSION
strategy_type          = JOB_SKILL_ASSESSMENT
job_code               = SUPERMARKET_SHELVER
module_type            = NULL
raw_score              = 专业测评原始分
max_score              = 48
normalized_score       = raw_score / 48 × 100
```

`result_payload_json`（job-skill-result-v1.0）：

```json
{
  "result_schema_version": "job-skill-result-v1.0",
  "overall": {
    "raw_score": 39,
    "max_score": 48,
    "normalized_score": 81.25,
    "completion_ratio": 1
  },
  "score_tracks": {
    "online_knowledge": { "raw_score": 30, "max_score": 36, "normalized_score": 83.33 },
    "offline_performance": { "raw_score": 9, "max_score": 12, "normalized_score": 75 }
  },
  "job_module_profiles": {
    "M1": { "online_raw": 0, "online_max": 6, "offline_raw": 0, "offline_max": 2, "score_rate": 0, "response_status_summary": {} },
    "M2": {}, "M3": {}, "M4": {}, "M5": {}, "M6": {}
  },
  "observation_completion_ratio": 1,
  "support_summary": {},
  "teacher_observations": [],
  "safety_summary": {},
  "validity_limitations": [],
  "recommended_training_focus": []
}
```

不为 M1-M6 分别生成六条 result_record；模块画像仅在 payload 内。NR/ST/技术中断的题目级不计分状态沿用 §7.2.2（completion_ratio 按 24 题计分分母计算）。

---

### 7.3 结果等级

基础能力评估采用三档结果等级，旧枚举 `LEVEL_PASS / LEVEL_IMPROVE / LEVEL_FAIL` 废止。

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

基础任务报告展示“三类任务闭环结果 + 任务建议结论 + 经教师复核的就业安置方向”；专业岗位报告按 §5.8.3 独立展示 JOB_SKILL_SCORE，且不得输出就业安置结论。

#### 任务建议结论规则（按优先级从高到低）

1. **安全红线覆盖**：若 `safety_overridden = 1`，结论为“安全中止，暂不建议继续该任务实操”，就业安置方向不输出。
2. **模块级一票否决**：若任一基础能力模块的线上得分率 `< 50%`，结论为“核心模块能力缺失，建议针对薄弱模块进行专项训练”，等级强制为 `LEVEL_NOT_COMPETENT`。
3. **情绪崩溃兜底**：若同一测评会话累计情绪崩溃次数达 `strategy_config` 阈值，结论为“情绪调节稳定性不足，建议先进行情绪调节训练再复测”，等级强制为 `LEVEL_NOT_COMPETENT`。
4. **实操未达标**：若 `OPERATION_PASS_RATE` 等级未达 `LEVEL_COMPETENT`，结论为“建议继续实操训练”。
5. **训练未完成**：若 `TRAINING_COMPLETION` 未完成，结论为“建议补完训练流程”。
6. **基础能力偏低**：若 `ABILITY_SCORE` 等级为 `LEVEL_NOT_COMPETENT` 或 `LEVEL_CONDITIONAL`，结论为“建议回到对应能力模块的巩固训练”。
7. **三类结果均胜任**：若三类任务闭环结果等级均为 `LEVEL_COMPETENT`，结论为“当前任务阶段性达标，可进入下一阶段任务或岗位实操”。

#### 就业安置方向（基于 `ABILITY_SCORE` 等级，纳入报告 §5.8）

| `ABILITY_SCORE` 等级 | 分数线 | 就业安置方向 | 说明 |
|---|---|---|---|
| `LEVEL_NOT_COMPETENT` | `< 60` 或被模块/情绪兜底强制判定 | 日间照料 / 支持性转介 | 暂不具备进入真实工作岗位的条件，建议继续训练或转介日间照料机构 |
| `LEVEL_CONDITIONAL` | `60 ~ 79` | 支持性就业（Supported Employment） | 可在庇护工场或辅导员（Job Coach）陪同的岗位工作 |
| `LEVEL_COMPETENT` | `>= 80` | 竞争性就业（Competitive Employment） | 可独立进入真实企业的基础岗位（如超市、酒店、包装等） |
| `LEVEL_FAIL_BY_SAFETY` | 安全红线触发 | 不输出就业方向 | 报告类型为 `SAFETY_TERMINATION_REPORT`，仅输出安全中止结论 |

#### 模块级一票否决细则

- 否决判定**仅依据 6 大模块的线上得分率**：模块线上实得分 / 14。
- 任一模块线上得分率 `< strategy_config.module_veto_threshold`（默认 0.5）即触发否决。
- 线下 8 题按主归属模块在报告中展示模块贡献，**不参与否决判定**。理由：线下题不保证每模块覆盖（可能 0 题或 1 题），参与否决会产生除零与单题否决的测量学缺陷。
- 触发否决时报告必须指明触发模块及其线上得分明细。

#### 情绪崩溃兜底细则

- 同一 `assessment_session` 内累计因情绪崩溃（§4.4「我遇到困难了」按钮触发后未恢复而终止当前测评）的次数，由 `strategy_config.emotion_collapse_threshold` 配置，默认 `3`。
- 单次情绪中断后恢复继续的，不计入崩溃次数；只有中断后未恢复（学生放弃或教师终止）才计为一次崩溃。
- 触发兜底后等级强制为 `LEVEL_NOT_COMPETENT`，报告必须记录崩溃次数与触发时间。
- 该规则与 §4.4 单次情绪中断机制并存：单次中断仍可恢复，不影响等级；累计崩溃才触发兜底。

#### 建议结论与安置方向的调和

- 建议结论第 6 条修改为：
  - `LEVEL_NOT_COMPETENT`：结论为"建议回到对应能力模块的巩固训练"。
  - `LEVEL_CONDITIONAL`：结论为"**可在支持条件下进入岗位训练，同时对薄弱模块（得分率最低的 1~2 个模块）进行补强训练**"。
- 就业安置方向映射同时受两条硬约束：
  1. 仅 `completion_ratio = 1` 的正常完成测评可输出安置方向。
  2. 安置方向为系统参考建议，须教师复核确认后方可随报告导出（§5.8）。

其余优先级顺序和情绪崩溃兜底按本文 §4.6 执行。

---

### 7.5 禁止混算规则

四类结果投影必须保持独立：

- `ABILITY_SCORE`
- `JOB_SKILL_SCORE`
- `TRAINING_COMPLETION`
- `OPERATION_PASS_RATE`

基础任务报告可以并列展示 ABILITY_SCORE、TRAINING_COMPLETION 和 OPERATION_PASS_RATE；专业岗位报告独立展示 JOB_SKILL_SCORE 与 M1-M6 岗位画像。任何页面、报告或统计都不得把这些结果平均或合成为单一总分。

基础能力线上 42 题与线下 8 题合并为满分 100，属于 ABILITY_SCORE 内部结构，不违反结果独立原则。专业岗位线上 18 题与线下 6 题合并为满分 48，属于 JOB_SKILL_SCORE 内部结构；观察项不计分。

### 7.6 策略配置版本锁定

`strategy_config` 是测评、训练、组卷、评分与阈值的唯一配置源。业务代码不得硬编码题量、满分、等级阈值、模块兜底阈值、情绪崩溃阈值或固定题集。

当前表级阈值字段为：

- `competent_threshold`：胜任阈值，默认 80。
- `conditional_threshold`：有条件胜任阈值，默认 60。
- `module_veto_threshold`：基础能力模块兜底阈值，默认 0.5。
- `emotion_collapse_threshold`：情绪崩溃累计阈值，默认 3。

产品规则：

1. 每个策略必须由 `strategy_id + version` 唯一标识，并声明 `strategy_type`、`job_code`、题量、满分和 JSON 策略合同。
2. 新建 assessment 或 training session 时，必须冻结 `strategy_id / strategy_type / job_code / strategy_version`，四者共同匹配同一策略版本。
3. 已被任一 session 引用的策略版本属于历史事实，所有语义字段均不得原地修改。
4. 调整题量、阈值、固定题集、题型策略、红线能力或情绪中断规则时，必须创建新版本。
5. 进行中的 session、历史结果和报告始终使用创建时锁定的策略版本，不受后续版本影响。
6. 默认只允许对历史策略版本执行不改变历史解释的停用维护；展示名称也不得修改，避免历史报告漂移。

#### 7.6.1 question_policy_json

基础能力 question-policy-v1.2 必须声明 `eligible_bank_domains`：

```json
{
  "schema_version": "question-policy-v1.2",
  "module_scope": "CROSS_MODULE",
  "eligible_bank_domains": ["BASE_ABILITY"],
  "online_quota_by_module": {
    "FINE_MOTOR": 7,
    "COGNITION": 7,
    "RULE_EXECUTION": 7,
    "EMOTION_REGULATION": 7,
    "BASIC_SOCIAL": 7,
    "SAFETY_OPERATION": 7
  },
  "offline_total": 8,
  "eligible_item_usage": ["SCORED_ITEM"],
  "allowed_question_types": [
    "TRUE_FALSE",
    "SINGLE_CHOICE",
    "DRAG",
    "SOFTWARE_TASK",
    "OFFLINE_OPERATION"
  ],
  "unsupported_interaction_policy": "BLOCK",
  "sensory_filter_mode": "SOFT",
  "fallback_strategy": "BLOCK"
}
```

规则：

1. 基础能力评估策略的 `eligible_bank_domains` 固定为 `["BASE_ABILITY"]`。
2. 组卷器必须把 `bank_domain` 过滤写入候选题 SQL，不得依赖后置内存过滤。
3. 缺省值：历史策略无该字段时按 `["BASE_ABILITY"]` 解释（向后兼容）。
4. MVP 不定义 `["JOB_SPECIFIC"]` 组卷策略；专业岗位组卷进入 Post-MVP。

---

#### 7.6.2 scoring_policy_json v1.1

基础能力测评策略：

```json
{
  "schema_version": "scoring-policy-v1.1",
  "online_score_values": [0, 2],
  "offline_score_values": [0, 1, 2],
  "normalization": "raw_score/max_score*100",
  "safety_override_enabled": true,
  "placement_advice_enabled": false,
  "pilot_mode": true
}
```

规则：

- `competent_threshold / conditional_threshold / module_veto_threshold / emotion_collapse_threshold` 继续以 `strategy_config` 表字段为唯一事实源。
- `scoring_policy_json.level_rules` 自本版起废止，避免与表字段重复。
- 训练策略的 scoring policy 可维持独立结构，不强制套用基础能力测评字段。

---

#### 7.6.3 JOB_SKILL_ASSESSMENT 策略配置

- `strategy_config.strategy_type` CHECK 必须包含 `JOB_SKILL_ASSESSMENT`，并继续支持 BASELINE_ASSESSMENT、MOCK_EXAM 与 TRAINING_PRACTICE。
- 策略与题库域绑定：

| strategy_type | 允许的 bank_domain |
|---|---|
| BASELINE_ASSESSMENT（及 MOCK_EXAM） | BASE_ABILITY |
| JOB_SKILL_ASSESSMENT | JOB_SPECIFIC |
| TRAINING_PRACTICE | 不涉及题库组卷（沿用现状） |

禁止 BASELINE_ASSESSMENT 选择 JOB_SPECIFIC 题；禁止 JOB_SKILL_ASSESSMENT 选择 BASE_ABILITY 题。绑定关系由组卷服务 + validateQuestionContract + 单元测试三层保证。

- JOB_SKILL 策略种子：`online_question_count = 18`、`offline_question_count = 6`、`max_score = 48`、question_policy_json 用 §5.3.13 FIXED_SET 结构、scoring_policy_json 用 §7.2.3 结构。
- 策略版本冻结、`UNIQUE(strategy_type, job_code, version)`、session 创建锁定 strategy_id + version 等现有机制不变。

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

新增事件：

- `SITTING_STARTED`
- `SITTING_ENDED`（payload 含结束方式：`COMPLETED_NORMALLY / PAUSED_BY_PLAN / ENDED_BY_COLLAPSE`）
- `EMOTION_COLLAPSE_RECORDED`
- `PLACEMENT_REVIEW_CONFIRMED`
- `QUESTION_SUPERSEDED`（题目作废重建）

`EMOTION_COLLAPSE_THRESHOLD_REACHED` 保留，语义更新为"累计崩溃坐次达阈值"。

---

新增或标准化以下事件：

- `QUESTION_PRESENTED`
- `QUESTION_RESPONSE_SUBMITTED`
- `QUESTION_RESPONSE_NOT_SCORED`
- `QUESTION_SUPPORT_RECORDED`
- `OBSERVATION_METRIC_DERIVED`
- `QUESTION_ASSET_VALIDATION_FAILED`

#### 8.7.1 QUESTION_RESPONSE_SUBMITTED payload 最小合同

```json
{
  "schema_version": "question-response-event-v1.1",
  "session_id": "AS_001",
  "session_question_id": "SQ_001",
  "question_id": "GA-RULE-009",
  "question_type": "SOFTWARE_TASK",
  "interaction_type": "BRANCHING_TASK",
  "response_status": "ANSWERED",
  "response": {},
  "metrics": {},
  "support": {
    "prompt_level": "P1",
    "accommodations_used": ["AAC"],
    "instruction_replay_count": 1
  },
  "timing": {
    "presented_at": "...",
    "first_action_at": "...",
    "submitted_at": "...",
    "first_action_latency_ms": 3000,
    "total_duration_ms": 15000
  },
  "scoring_snapshot": {
    "scoring_engine_version": "1.0.0",
    "passed": true,
    "score": 2,
    "failed_criteria": []
  }
}
```

#### 8.7.2 QUESTION_RESPONSE_NOT_SCORED payload

必须包含：

- response_status
- reason_code
- teacher_confirmed_by（需要教师判断时）
- support
- timing
- completed_steps / retained_metrics
- 是否触发 session 暂停或终止

#### 8.7.3 行为事件边界

以下内容不得逐条写入 `domain_event_projection`：

- 每个 pointer move
- 每个轨迹采样点
- 每帧多点触控状态
- hover 数据
- 原始音频和语音识别中间结果

MVP 只在 answer payload 保存评分所需的聚合指标和必要轨迹摘要。高频原始数据列入 Post-MVP 分析数据方案。

---

§8.7 事件不变，新增：

- `TEACHER_OBSERVATION_RECORDED`

#### 8.7.4 TEACHER_OBSERVATION_RECORDED payload 最小合同

```json
{
  "schema_version": "teacher-observation-event-v1.0",
  "session_id": "AS_001",
  "question_id": "JOB_M1_OB_048",
  "bank_domain": "JOB_SPECIFIC",
  "interaction_type": "TEACHER_OBSERVATION",
  "observation_codes": ["口头提醒主试"],
  "observation_dimensions_version": "question-content-v1.2",
  "administration_variant": "STANDARD",
  "recorded_by": "USER_ID",
  "recorded_at": "...",
  "post_disclosure_status": "COMPLETED",
  "note": null
}
```

规则：

1. `observation_codes` 必须属于题目 `administration.observation_dimensions` 或 rubric 声明的编码维度白名单。
2. 事件不产生分数、不写 answer_record、不影响 completion_ratio。
3. 嵌入观察可记录 `post_disclosure_status`；该字段当前不作门禁，伦理流程按 §0.3 由产品负责人和学校专业团队裁决。
4. 施测变体（中断/干扰/预埋等）附着在计分实操题上的观察编码，随线下评分事件写入 `offline_score_record.observation_payload_json`，不单发本事件。

---

新增或确认以下事件语义（`domain_event_projection.event_type` 为自由文本，无 CHECK 约束，事件命名可与项目现有命名规范对齐，语义必须存在）：

- `JOB_SKILL_ASSESSMENT_STARTED`（可复用现有 session started 事件 + strategy_type 判别，二选一，实现时按现有事件目录对齐）
- `JOB_SKILL_ASSESSMENT_COMPLETED`（同上）
- `JOB_SKILL_RESULT_GENERATED`
- `TEACHER_OBSERVATION_RECORDED`（payload 采用 §5.4.5.3 teacher-observation-v1.0，可选 `post_disclosure_status`）

事件写入顺序、checksum、投影规则沿用现有事件溯源架构，不重构。

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
3. 视频题因感官标签被排除时，只能由策略选择事先审核通过的替代题或替代资产；不得运行时改写原题，也不得批量把视频降级为图片。
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

MVP 采用轻量事件溯源 + SQLite 查询投影：

- `action_log.jsonl` 是领域事实来源。
- SQLite 是查询快照，不是最高事实来源。
- 状态变化必须由领域事件驱动，不得由 UI 直接更新 session 状态。
- 评分修订、红线熔断、会话作废和报告生成必须可审计、可重放。
- 数据库 DDL 的唯一事实源是 `src/main/db/schema.sql`。

### 11.2 当前 schema 基线

当前基线为 `schema.sql v0.1.14-multi-device-m2-session-foundation`。v0.1.12 已物化题库合同、岗位题库治理和专业岗位测评运行时；v0.1.13 在其上增量增加组织、节点、设备与认证拓扑；v0.1.14 增加 business_session 父记录、assessment delivery_phase / event_sequence_version / observation_template_id、assessment/training business_session_id 与 D2-D6/D8 约束。

核心业务表包括：

- 账号与身份：`user_account`、`student_profile`。
- 多设备 M1：`organization`、`node`、`device`、`device_runtime_session`、`auth_session`。
- 策略与资源：`strategy_config`、`asset_resource`、`question_bank`。
- 测评与训练：`assessment_session`、`assessment_session_question`、`answer_record`、`offline_score_record`、`training_session`、`training_step_record`。
- 安全与结果：`safety_incident`、`safety_incident_binding`、`result_record`、`task_report`。
- 事件与恢复：`domain_event_projection`、`snapshot_meta`、`error_code_registry`、`error_event_log`、`schema_migration`。

### 11.3 策略、题库与资产合同

1. `strategy_config` 按 §7.6 版本冻结；session 必须完整引用策略复合身份。
2. `question_bank.bank_domain` 只允许 `BASE_ABILITY / JOB_SPECIFIC`。
3. BASE_ABILITY 必须使用 `module_type` 且 `job_module_code` 为空；JOB_SPECIFIC 必须使用 M1-M6 `job_module_code` 且 `module_type` 为空。
4. `item_usage` 区分 `SCORED_ITEM / OBSERVATION_ONLY`；观察项可进入 OBSERVATION phase，但不计分。
5. 题目 ACTIVE 或被历史 session/答题/评分引用后，语义字段冻结；修订必须新建 question_id，并用 `superseded_by_question_id` 追溯。
6. required 资产必须存在、状态可用且 hash 一致；已引用素材不得覆盖同一 asset_id，修订必须创建新 asset_id。
7. 题目跨层一致性由 `validateQuestionContract()` 在导入、ACTIVE 门禁和 session 创建时统一校验。

### 11.4 Session 题目快照与作答记录

`assessment_session` 同时承载 BASELINE_ASSESSMENT、MOCK_EXAM 与 JOB_SKILL_ASSESSMENT，不建立第二套专业岗位 session 表。

`assessment_session_question.question_phase` 支持：

- `ONLINE`：线上自动评分题。
- `OFFLINE`：教师 0/1/2 评分题。
- `OBSERVATION`：教师嵌入观察项，不计分。

插入题目快照时必须校验 strategy_type 与 bank_domain、job_code、模块字段、题型、item_usage 和 phase 配对。JOB_SKILL_ASSESSMENT 只能选择 JOB_SPECIFIC；基础能力策略只能选择 BASE_ABILITY。

`answer_record` 使用结构化 `response_status`：ANSWERED 时线上 score 只能为 0/2；NR、ST、技术中断或直接协助等非计分状态必须使用 NULL score，不得伪装成 0 分。

`offline_score_record.score_scope` 支持：

| scope | 用途 | score |
|---|---|---:|
| OFFLINE_ABILITY | 基础能力线下 8 题 | 0/1/2 |
| TASK_OPERATION | 拆箱与上架任务实操 | 0/1/2 |
| JOB_SKILL | 专业岗位固定卷线下 6 题 | 0/1/2 |
| TEACHER_OBSERVATION | 教师嵌入观察 | NULL |

四类记录必须按 scope 分流，不得交叉计入结果。TEACHER_OBSERVATION 必须属于 session 的 OBSERVATION 快照，并保存结构化 `observation_payload_json`。

### 11.5 结果与报告投影

`result_record.result_type` 支持：

- `ABILITY_SCORE`
- `TRAINING_COMPLETION`
- `OPERATION_PASS_RATE`
- `JOB_SKILL_SCORE`

专业岗位的 M1-M6 画像保存在单条 JOB_SKILL_SCORE 的 `result_payload_json`，不得拆成六条结果。报告复用 `task_report`，并通过 `report_content_json.report_scope` 区分 BASE_ABILITY 与 JOB_SKILL。结果和报告都是不可被后续重测静默覆盖的快照。

### 11.6 安全事件与一致性保护

1. `safety_incident` 以 student_id + task_code 为归属，可在无开放 session 时独立成立。
2. 安全事件必须先熔断再补充事实，并通过 `safety_incident_binding` 记录受影响聚合。
3. 教师负责触发、补充与确认；管理员负责 RESOLVED / VOIDED。
4. CONFIRMED 后核心事实冻结；事实修正必须在同一事务中 VOID 旧事件并创建 replacement。
5. REDLINE_HALTED session 的 incident 必须与同一学生、同一任务匹配。
6. 安全红线结果覆盖所有分数等级。

### 11.7 多设备 M1 边界

v0.1.14 提供 M1 身份拓扑与 M2 Business Session Foundation。Grant/Assignment、learning_session、离线草稿、发布同步、跨设备安全聚合和自动 JSONL 冷启动重放属于后续里程碑；在相应合同落地前，不得推断当前 MVP 已具备完整多设备运行能力。

### 11.8 初始化与迁移政策

- 新安装使用当前全量 schema 初始化。
- `CREATE TABLE IF NOT EXISTS` 不得被视为既有数据库迁移机制。
- 已存在真实数据时，任何字段、CHECK、触发器或状态语义变化都必须提供独立 migration、备份、回滚和验收步骤。
- 预发布种子库允许按明确脚本重建，但必须先确认不存在需要保留的历史引用。

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
- 模块兜底触发率（按 6 大模块分组，统计任一模块 `< 50%` 强制 `LEVEL_NOT_COMPETENT` 的发生频次）。
- 情绪崩溃兜底触发率（统计因累计情绪崩溃达阈值而强制 `LEVEL_NOT_COMPETENT` 的发生频次，以及平均崩溃次数分布）。
- 就业安置方向分布（按日间照料 / 支持性就业 / 竞争性就业 三档分组统计学生数量）。

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
- 系统能够生成基础任务闭环三类结果和独立的专业岗位测评结果。
- 系统能够生成任务报告。
- 异常退出后不丢失已提交数据。
- 安全红线能正确批量熔断开放会话。
- 无会话红线能被独立记录。
- 未解决安全事件能阻断新会话。
- 资源缺失能被识别并记录。
- 教师愿意在真实课堂中复用该流程。

---

### 16.6 行为日志最小字段集

#### 16.6.1 通用字段

进入 `answer_record.answer_payload_json`：

- schema_version
- session_question_id
- question_id
- question_type
- interaction_type / subtype
- response_status
- attempt_no / revision_no
- presented_at
- first_action_at
- submitted_at
- first_action_latency_ms
- total_duration_ms
- prompt_level
- accommodations_used
- instruction_replay_count
- input_method
- response
- metrics
- scoring_snapshot

#### 16.6.2 点击/选择题

最小字段：

- selected_option_ids
- selection_sequence
- deselected_option_ids
- change_count
- premature_action_count
- first_selection_latency_ms

#### 16.6.3 拖拽/排序题

最小字段：

- placements / ordered_item_ids
- item_id / zone_id
- attempt_count
- drop_accepted
- start_x / start_y / end_x / end_y（0～1 归一化）
- wrong_zone_count
- correction_count
- unplaced_item_ids
- total_duration_ms

MVP 不要求保存每个 pointer move。

#### 16.6.4 GESTURE_TASK

按 subtype 保存评分所需聚合：

- average_deviation
- max_deviation
- boundary_cross_count
- lift_count
- fixed_touch_break_count
- successful_target_count
- retry_count
- input_method

#### 16.6.5 TIMED_TASK

- planned_duration_ms
- active_duration_ms
- idle_duration_ms
- completed_count
- correct_count
- error_count
- rest_requested
- premature_action_count
- early_exit

#### 16.6.6 TASK_SEQUENCE / BRANCHING_TASK

- completed_steps
- step_order
- omitted_steps
- wrong_order_count
- path `{node_id, action_id, offset_ms}[]`
- message_action_ids
- recipient_id
- final_state
- help_requested / clarification_requested / status_reported

#### 16.6.7 不得直接等同成绩的指标

除非具体 scoring_rule 明确把该指标定义为目标构念和通过阈值，否则下列指标只能作为行为证据：

- 反应时间和总用时
- 拖拽速度和轨迹长度
- 修改次数、重试次数、自我纠正
- 指令重播次数
- 求助、澄清、休息请求次数
- 情绪恢复时间
- 沟通方式
- AAC、触控笔或其他合理便利使用
- 惯用手
- 空闲时长
- 行为外显程度

禁止用“速度慢”“请求休息”“使用 AAC”“没有眼神接触”等单一指标直接判低分。

---

1. §16.6.2 点击/选择题最小字段追加：`unsure_selected`（布尔，选中 semantic_tag=UNSURE 选项时为 true）。
2. 新增 §16.6.8 线下观察编码（进入 `offline_score_record.observation_payload_json`）：
   - `administration_variant`
   - `observation_codes[]`（白名单内）
   - `interruption_recovery_code`（A 接续不重做 / B 部分重做 / C 完全重做 / D 需提示）
   - `planted_error_outcome`（检出并指出 / 检出未报告 / 未检出）
   - `vigilance_decline_point`（件数）
   - `time_limit_expired`（布尔）
   - `prompt_level` / `accommodations_used`
   - `examiner_ids[]`（requires_two_examiners 时长度 ≥ 2）
3. §16.6.7 "不得直接等同成绩的指标"清单追加：`unsure_selected`、`interruption_recovery_code`、`planted_error_outcome`、`vigilance_decline_point`。

---

专业岗位测评还必须记录：

- 观察记录字段集 = teacher-observation-v1.0 payload（§5.4.5.3）。
- `observation_completion_ratio` 计算：分母 = strategy 固定观察项数，分子 = 已写入 VALID TEACHER_OBSERVATION 记录数；进入 result_payload_json 与 report_content_json，不进入 result_record 表字段。
- §16.6.7 "不得直接等同成绩的指标"追加：`behavior_codes`、`observed`、`observation_completion_ratio`。

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
2. 已被 `assessment_session` 引用的 `strategy_config` 版本，修改 `competent_threshold`（默认 80）应失败。
3. 已被 `assessment_session` 引用的 `strategy_config` 版本，修改 `conditional_threshold`（默认 60）应失败。
4. 已被 `assessment_session` 引用的 `strategy_config` 版本，修改 `question_policy_json` 应失败。
5. 已被 `training_session` 引用的 `strategy_config` 版本，修改 `scoring_policy_json`应失败。
6. 已被任一 session 引用的 `strategy_config` 版本，修改 `strategy_name` 应失败。
7. 已被任一 session 引用的 `strategy_config` 版本，修改 `version` 应失败。
8. 已被引用的策略如需调整阈值或规则，必须插入新的 `version`。
9. 历史 session 通过 `strategy_id + strategy_version` 能够复现当时策略。

### 17.6.1 基础能力评估兜底专项验收

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

### 17.6.2 评分收口专项验收

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
11. CSV 题库导入后，必须能支撑 `strategy_config.question_policy_json` 配置的「每模块 7 道线上题」组卷约束；若任一模块 `ACTIVE` 题量不足 7 道，组卷时应进入异常中心「感官屏蔽后题目不足」或「题库不足」分支（§10），不得静默降级。
12. BASE_ABILITY 题的 `module_type` 必须与 6 大基础能力模块一致；OFFLINE_OPERATION 的复合能力标签仅用于线下模块展示，不参与线上模块计分或否决。

13. **上线门禁**：MVP 交付验收时，6 大模块每模块 `ACTIVE` 线上题 ≥ 7 道、全库 `ACTIVE` 线下实操题 ≥ 8 道且覆盖主归属模块标注，否则测评功能不得开放。
14. 线上题 rubric 含"经提示 / 犹豫 / 提示后"等过程观察描述的，不得转 `ACTIVE`（须改写为二值标准或改为线下题）。
15. 导入验收必须证明 OFFLINE_OPERATION 的复合能力标签不会进入线上模块计分与否决。

---

### 17.9 题库数据合同专项验收

#### schema 与题库

1. 新导入 question_bank 默认 DRAFT。
2. question_type 可写 SOFTWARE_TASK，其他非法值失败。
3. item_usage 只允许 SCORED_ITEM / OBSERVATION_ONLY。
4. OBSERVATION_ONLY 只有在策略明确选入时才能写入 assessment_session_question，且 question_phase 必须为 OBSERVATION。
5. OBSERVATION_ONLY 不得生成 answer_record 或分数；TEACHER_OBSERVATION 使用 score=NULL 的 offline_score_record 保存结构化观察。
6. 96 个源条目 dry-run 必须识别 87 纯软件、1 嵌入观察、8 必要实物；不得把观察项算入 42+8。
7. 已选入 session 的题目修改语义字段应失败。
8. 已引用主素材不得覆盖为不同 hash 的文件。

#### interaction 与 validator

9. 每道 ACTIVE 题必须有合法 presentation_type 和 interaction_type。
10. question_type 与 content_json.question_type 不一致时不得转 ACTIVE。
11. interaction_type 与 answer shape 不匹配时提交失败。
12. 未在 renderer registry 注册的 interaction_type 不得转 ACTIVE。
13. MULTI_SELECT 能保存多个 option ID 并按集合规则判分。
14. ORDERING 能保存稳定顺序并按 order rule 判分。
15. GESTURE/TIMED/BRANCHING 至少各有一条合法和非法 fixture 测试。
16. 线上所有评分路径只产生 0 或 2，不产生 1。

#### support 与 response status

17. prompt_level 与 accommodations 分开记录。
18. 使用 AAC、触控笔或日常辅具不自动扣分。
19. NOT_APPLICABLE / STOPPED_SAFETY / TECHNICAL_INTERRUPTION / ASSISTED_NOT_SCORED 时 score 必须为 NULL。
20. 技术故障不得记 0 分。
21. P3 直接协助完成必须为 ASSISTED_NOT_SCORED。
22. response_status 非 ANSWERED 时 completion_ratio 和报告状态正确。

#### 行为日志与评分

23. answer_payload 包含 scoring_engine_version 和 failed_criteria。
24. 评分器可仅依据冻结题目、scoring_rule_json 和 answer_payload 复算原分数。
25. 未在 content_json.log_metrics 声明的非通用指标不得随意写入报告结论。
26. pointer move 不逐条进入 domain_event_projection。
27. 反应时间、帮助次数和休息请求不直接等同成绩。

#### 素材

28. 所有必需 asset_id 存在、ACTIVE、hash 正确后题目才可转 ACTIVE。
29. renderer 统一通过 app://asset/<asset_id> 加载。
30. 题目 JSON 不得包含本地绝对路径。
31. 修改图片内容需创建新 asset_id；修改题目引用需创建新 question_id。

#### 报告

32. report_content_json 符合 task-report-v1.1。
33. 报告按 evidence type 分组。
34. 报告展示支持等级、合理便利和 response status。
35. OBSERVATION_ONLY 出现在行为观察区，不进入总分。
36. validity_boundary 能进入报告限制说明。
37. pilot_mode=true 时 placement_advice.enabled=false。
38. completion_ratio<1 时不输出安置方向。

#### 组卷门禁

39. 6 大模块每模块至少 7 道 ACTIVE、SCORED_ITEM、renderer 已实现的线上题。
40. 至少 8 道 ACTIVE、SCORED_ITEM 的 OFFLINE_OPERATION。
41. 题量不足时继续返回 QUESTION_BANK_INSUFFICIENT，不静默降低模块或交互要求。
42. 组卷不得固定要求判断、单选、拖拽各 14 道。

---

### 17.10 专业岗位题库治理专项验收

#### 域隔离

1. BASE_ABILITY 组卷命中 JOB_SPECIFIC 题目数为 0。
2. JOB_SPECIFIC 题不能生成现有 ABILITY_SCORE。
3. JOB_SPECIFIC 题必须有 job_module_code。
4. JOB_SPECIFIC 题的 module_type 必须为空。
5. BASE_ABILITY 题必须有 module_type。
6. BASE_ABILITY 题的 job_module_code 必须为空。

#### 观察通道

7. OBSERVATION_ONLY 必须 NO_SCORE。
8. TEACHER_OBSERVATION 不生成 answer score；写入 offline_score_record 时 score 必须为 NULL。
9. 观察项不进入 completion_ratio。
10. 3 条嵌入观察（M1_OB_048、M5_OP_048、M5_OP_055）重导后必须识别为 OBSERVATION_ONLY + TEACHER_OBSERVATION。

#### 呈现与素材

11. VIDEO_SCENE 缺少有效 SCENE_VIDEO（或经审核的图片替代素材）时不得 ACTIVE。
12. 图片降级题必须有 `source.transformation = VIDEO_TO_IMAGE_CARD` 留痕。

#### 评分规则

13. RUBRIC_BASED 不得进入新库。
14. DRAG_PARTIAL 不得进入新库。
15. OFFLINE_RUBRIC 缺少逐题三档行为锚点（或使用通用模板）时不得 ACTIVE。
16. 线上所有评分路径仍只产生 0 或 2。

#### 数据质量与重导

17. M1_TF_015 在 answer_key_verified 未通过时不得 ACTIVE。
18. ability_tags 包含 `"0"` 或 `"1"` 时导入失败。
19. note 存储 ACTIVE/DRAFT 等状态值时输出数据质量告警。
20. `supermarket_stocking` 不得作为正式 job_code 写入新题；迁移题的 `source.legacy_job_code` 保留原值。
21. M1-M6 298 条 dry-run 模块×题型矩阵与 §0.2 实测一致（96 单选 / 68 判断 / 34 拖拽 / 97 实操 / 3 观察）。
22. dry-run 输出答案位置分布、素材缺口与非法字段清洗报告。
23. 295 条旧 ACTIVE 数据重导后不得继续保持 ACTIVE。

#### 冻结与施测变体

24. ACTIVE 题修改语义字段（含 bank_domain / job_module_code）必须失败。
25. 施测变体的 observation_dimensions 能写入和读取（offline_score_record.observation_payload_json），但不直接改变题目 0/1/2 得分。
26. "不清楚"选项保存为 ANSWERED + score 0 + unsure_selected，不保存为 NOT_APPLICABLE。

#### 回归

27. 现有基础能力题库、坐次、评分、报告和安全事件回归测试继续通过。

---

### 17.11 专业岗位示范测评专项验收

#### 策略与题库域

1. JOB_SKILL_ASSESSMENT 只能选择 JOB_SPECIFIC 题。
2. BASELINE_ASSESSMENT 只能选择 BASE_ABILITY 题。
3. 两个题库域互相命中数为 0。
4. strategy version 固定题集不可原地修改。

#### 固定示范卷

5. 固定示范卷覆盖 M1-M6。
6. 每模块 3 道线上、1 道线下。
7. 总计 18 道线上、6 道线下。
8. 观察项不超过 3 项且不计分。
9. 任一固定题非 ACTIVE 时不能发起测评。
10. 任一固定题素材、答案或 rubric 未通过时不能发起测评。

#### session

11. JOB_SKILL_ASSESSMENT 可创建 assessment_session。
12. 支持多坐次暂停和恢复。
13. session question 正确保存 bank_domain、job_module_code、item_usage 和 phase。
14. OBSERVATION phase 不生成普通 answer_record。
15. 安全红线能中断专业岗位测评（REDLINE_HALTED）。

#### 评分

16. 线上题只能 0/2。
17. 线下题只能 0/1/2。
18. 观察项 score 必须为 NULL。
19. 原始计分满分为 48。
20. normalized_score 正确计算（raw/48×100）。
21. 观察项不进入计分 completion_ratio。
22. observation_completion_ratio 单独计算。

#### 结果

23. 生成 JOB_SKILL_SCORE。
24. 不错误生成 ABILITY_SCORE。
25. result_payload 含 M1-M6 模块画像。
26. result_payload 分开保存线上和线下得分。
27. 安全红线优先覆盖普通等级。
28. 单模块低分不自动触发基础能力模块兜底。

#### 报告

29. 生成 report_scope = JOB_SKILL 的报告。
30. 报告展示 M1-M6。
31. 报告展示线上与线下对比。
32. 报告展示支持等级和教师观察。
33. 报告展示训练重点建议。
34. 报告不输出就业安置结论。
35. M2 低分时可推荐现有拆箱与上架训练。
36. 未实现训练模块不得生成虚假链接。

#### 素材和审核

37. 固定示范卷全部素材可加载（app://asset/ 链路）。
38. VIDEO_SCENE 缺视频不能 ACTIVE。
39. VIDEO_TO_IMAGE_CARD 必须有审核和效度说明。
40. 自动评分题答案键必须 VERIFIED 或 CORRECTED。
41. M1_TF_015 未确认前不得进入固定示范卷。
42. 6 道线下题必须有逐题 0/1/2 锚点。
43. ability_tags 不得存在 `"0"`、`"1"`。

#### 观察

44. TEACHER_OBSERVATION 能正常录入。
45. 观察记录写入事件日志（action_log.jsonl）和 SQLite 投影。
46. 观察记录可在报告中复现。
47. 观察记录不改变 raw_score。
48. 观察记录缺失时报告显示观察完成度不足，不伪装为 0 分。

#### 回归

49. 原基础能力 42+8 流程继续通过。
50. 原训练、实操评分、安全事件和报告快照流程继续通过。
51. 不破坏现有 strategy_config 版本冻结和引用一致性。

（§17.9 与 §17.10 验收全部继续有效。）

---

## 18. 版本边界

### 18.1 当前 MVP 产品合同

当前 MVP 包含：

- 基础能力 42+8 测评与 ABILITY_SCORE。
- 专业岗位固定 18+6 示范卷、0～3 观察项与 JOB_SKILL_SCORE。
- M1-M6 岗位模块画像和专业岗位报告。
- 四步训练、拆箱与上架实操评分及固定规则训练建议。
- 坐次暂停恢复、支持等级、合理便利、安全红线、事件审计和报告快照。
- 题库域隔离、题目/素材冻结、答案/rubric/素材/专业审核门禁。

### 18.2 当前内容生产边界

题目、图片和视频只有通过内容、答案、rubric、素材、专业审核、renderer 和合同校验门禁后才能进入 ACTIVE。固定示范卷只读取当前 strategy version 明确列出的题目；其他 JOB_SPECIFIC 题即使 ACTIVE，也不会自动进入 Demo。

### 18.3 Post-MVP

- 298 题全量 ACTIVE 与随机组卷、多套卷、自定义卷、单模块测评。
- 549 题训练变式、question_role、parent_question_id 和四层题库分层。
- 支架前后分差、门店/文职分差、警觉衰减曲线和五类高级指标。
- 岗位安置矩阵、对外与内部双报告。
- 完整题库/试卷后台、视频高级行为分析和多设备 M2-M7 能力。

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

### 19.1 一致性保护补充约束

- 新建或更新 `assessment_session` 时，必须在 schema 层校验 `strategy_id / strategy_type / job_code / strategy_version` 与 `strategy_config` 同行匹配。
- 新建或更新 `training_session` 时，必须在 schema 层校验 `strategy_id / strategy_type / job_code / strategy_version` 与 `strategy_config` 同行匹配。
- `training_session.strategy_id` 业务上不得为空。
- `REDLINE_HALTED` 的 `assessment_session.redline_incident_id` 必须指向同一 `student_id + task_code` 的 `safety_incident`。
- `REDLINE_HALTED` 的 `training_session.redline_incident_id` 必须指向同一 `student_id + task_code` 的 `safety_incident`。
- `training_step_record.status` 不得出现 `ACTIVE` 或 `VOID`。
- 当前全量初始化基线为 v0.1.14；已有真实数据升级必须提供独立 migration。
- 基础能力 CSV 题库导入不得直接发布为正式题库，必须先入 `DRAFT`，审核后再转 `ACTIVE`。
- 完整试卷系统不属于当前 MVP，不得在现有固定策略上临时拼接实现。
- 基础能力代码不得硬编码或假设「17+3 / 满分 40 / 阈值 70/40」等 v1.0.4 旧默认值；所有题量、满分、阈值必须从 `strategy_config` 读取。
- 基础能力三档等级（`LEVEL_COMPETENT / LEVEL_CONDITIONAL / LEVEL_NOT_COMPETENT`）必须在代码层一次性切换，不得保留 `LEVEL_PASS / LEVEL_IMPROVE / LEVEL_FAIL` 旧枚举兼容。
- 模块级一票否决与情绪崩溃兜底必须在结果计算阶段强制执行，不得依赖前端或教师判断。
- 就业安置方向建议必须严格按 `ABILITY_SCORE` 等级映射（§7.4），不得由前端自由文案。

29. 不得让线上自动判分产生 `1 分`；`1 分`仅存在于教师现场评分。
30. 不得让一条 `offline_score_record` 同时计入 `ABILITY_SCORE` 与 `OPERATION_PASS_RATE`。
31. 不得在模块兜底计算中引入线下题得分率。
32. 不得原地修改已被 `answer_record` 引用的题目内容语义字段。
33. 不得对 `completion_ratio < 1` 的结果输出就业安置方向。
34. 不得在未经教师安置复核确认的情况下导出含安置方向的报告。
35. 不得在同一 session 内临场切换题目档位。
36. 不得以“50 题每题均为 0/1/2”的旧口径实现判分逻辑。

---

37. 不得把复杂软件任务全部伪装为 SINGLE_CHOICE 或 DRAG。
38. 不得为每种界面控件扩展一个数据库 question_type；具体交互进入 interaction_type。
39. 不得让 OBSERVATION_ONLY 进入 42+8、分数或完成率分母。
40. 不得让未实现 renderer 的题转 ACTIVE。
41. 不得在 content_json 和 scoring_rule_json 同时维护正确答案。
42. 不得让线上部分完成产生 1 分。
43. 不得把 NR、ST 或设备故障写成错误 0 分。
44. 不得把 P3 直接协助后的完成写成独立完成。
45. 不得把 accommodations 等同提示或自动扣分。
46. 不得用反应时间、速度、帮助请求或休息请求单独判定能力等级。
47. 不得把情境判断证据解释为真实岗位实操已经达标。
48. 不得把触控精细动作解释为真实握力、阻力控制或纸笔书写能力。
49. 不得把高频 pointer move 写入领域事件投影。
50. 不得在题目 JSON 保存绝对本地路径。
51. 不得覆盖已引用 asset_id 的文件内容。
52. 不得继续使用 question_ratio 14/14/14/8 固定题型结构。
53. 不得在 pilot_mode 下输出就业安置方向。
54. 不得让 report_content_json 缺少 schema_version、证据类型和效度限制。
55. 不得声称内嵌 JSON asset_id 已由 SQLite 外键完整保护；必须由 validator 和门禁校验。
56. 不得为了满足上线题量自动生成、猜测或伪造缺失答案、素材和专业确认结论。

---

57. 不得用题目 ID 前缀、job_code、question_role、allowed_roles、module_type 或命名约定替代 bank_domain 实现域隔离。
58. 不得让 JOB_SPECIFIC 题进入基础能力组卷、42+8、ABILITY_SCORE 或基础能力 completion_ratio。
59. 不得把岗位模块伪装或解释为基础能力模块。
60. 不得混用 TEACHER_OBSERVATION 与 SYSTEM_DERIVED_OBSERVATION。
61. 不得为凑足 ACTIVE 题量批量将视频任务降级为图片；降级必须逐题专业审核并留痕。
62. 不得让 RUBRIC_BASED 或 DRAG_PARTIAL 进入新库。
63. 不得用通用模板（未完成/部分完成/完全达标）代替逐题三档行为锚点。
64. 不得恢复"L3 后限分"规则或任何 5 分制计分。
65. 不得把"不清楚"选择保存为 NOT_APPLICABLE 或在报告中表述为答错。
66. 不得原地修改 ACTIVE 或已被引用题目的语义字段（含 bank_domain、job_module_code）。
67. 不得让 supermarket_stocking 作为正式 job_code 写入新库。
68. 不得把施测变体观察编码（恢复方式、检出-报告、衰减点）直接计入 0/1/2 得分。
69. 不得在 MVP 实现 question_role、parent_question_id、五类岗位分数、分差自动解释或安置矩阵。
70. 不得让 OBSERVATION_ONLY 条目生成 answer_record 分数或线下 0/1/2 评分。

---

71. 不得为专业岗位测评另建第二套 session 表；必须复用 assessment_session 及其状态机。
72. 不得让 JOB_SKILL_ASSESSMENT 选择 BASE_ABILITY 题，或 BASELINE_ASSESSMENT 选择 JOB_SPECIFIC 题。
73. 不得在同一 strategy version 内原地修改固定题集；不得临场从 DRAFT 补题。
74. 不得把专业岗位结果写成 ABILITY_SCORE、OPERATION_PASS_RATE 或 TRAINING_COMPLETION。
75. 不得让观察项进入 raw_score、max_score、计分 completion_ratio 或模块得分率。
76. 不得输出就业安置类结论（适合/不适合就业、竞争性/支持性就业、岗位排除、自动安置）。
77. 不得把训练建议称为 AI 自动推荐；只能是基于固定规则的训练重点建议。
78. 不得为未实现的训练模块生成虚假链接。
79. 不得把基础能力模块兜底规则照搬到专业岗位测评。
80. 不得把 post_disclosure_status 用作 ACTIVE、观察保存或报告生成门禁（伦理流程定稿前）。

---

## 20. 产品合同维护与验收顺序

1. 产品范围、题量、评分、状态机或数据语义发生变化时，先修改本文并明确验收标准。
2. 数据库合同变化时，同步修改 `src/main/db/schema.sql`；已有真实数据时必须增加独立 migration 和回滚方案。
3. JSON、事件或 IPC 合同变化时，同步修改共享类型、运行时 validator、事件写入和投影读取方。
4. 题库与视觉资产变化必须通过 ACTIVE、文件、hash、版权、renderer 和验收门禁，不得直接修改历史事实。
5. 每次修改至少验证受影响的正常路径、错误路径、边界条件和历史回归。
6. 完成后运行文档索引更新/检查、类型检查、lint、相关测试和生产构建；不得把未验证的目标状态写成已实现。

---

## 附录 A：版本来源与覆盖关系

| 来源 | 在本文中的作用 | 状态 |
|---|---|---|
| PRD v1.0.5 | 提供完整章节骨架与未被后续替换的通用产品规则 | 历史来源 |
| PRD v1.0.6 | 评分、坐次、线下分流、题目冻结和中途终止规则 | 已物化 |
| PRD v1.0.7 | 题库数据合同、交互/呈现、评分与报告 JSON 合同 | 已物化 |
| PRD v1.0.8 | 专业岗位题库域治理、观察、视频、施测变体和导入清洗 | 已物化 |
| PRD v1.0.9 | 专业岗位示范测评运行时及对 v1.0.8 范围判断的最终覆盖 | 当前产品版本 |

历史差异版保留在仓库中，仅用于审计决策来源。新需求、验收和实现不得要求读者按顺序拼接历史文件。

## 附录 B：实现事实源

| 合同 | 当前唯一事实源 |
|---|---|
| 数据库表、索引、触发器、策略种子 | `src/main/db/schema.sql` |
| JSON 字段与判别联合类型 | `src/shared/types/json-schemas.ts` |
| 事件类型与 payload | `src/shared/types/event-payloads.ts` |
| IPC 公共接口 | `src/shared/types/ipc-api.ts` |
| 专业岗位固定卷题目与资源状态 | 当前 strategy version + `doc/assets/asset-manifest.json` |
| 视觉风格和生产数量 | `doc/reference/visual-asset-master-plan.md` |

## 附录 C：历史章节兼容映射

历史文档或测试中的 `v1.0.x §N` 引用，默认映射到本文同编号章节。发生以下覆盖时使用本文最终正文：

- §5.3.10.4 → 本文 §5.3.10.4。
- §18 → 本文 §18。
- §7.6.1 → 本文 §7.6.1。
- §8.7.4 的 `post_disclosure_done` → 本文使用可选 `post_disclosure_status`。
- v1.0.7 “OBSERVATION_ONLY 不进入 session 题目快照” → 本文允许以 OBSERVATION phase 进入，但不计分。
