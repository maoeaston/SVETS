# SVETS MVP Pilot 收口与全量产品 1.0 规划审查报告

> **文档性质：** 只读审查报告，不是产品合同、schema 基线或实施授权  
> **审查日期：** 2026-07-18  
> **审查结论：** REJECT  
> **审查快照：** `feat/multi-device-m2-prd` / `95c9808bbbcb8c5c5c057e275a610a0ca2573824`  
> **用途：** 为后续上下文压缩、R0 修订、M4/M5 评审和 Full Product PRD 重置保留完整事实依据

## 0. 审查边界与使用规则

本报告核对了当前仓库事实，而不是接受文档中的“已完成”声明。审查期间：

- 未修改被审文档或源码。
- 未执行 `git add`、`git commit`、删除或移动文件。
- 未访问外部网络，未调用第三方 skill。
- 未假设当前工作树中的未提交内容均属于本轮规划产出。
- 审查完成前后 `git status --short` 一致：6 个已修改文件、8 个未跟踪文件、无 staged。

本报告本身只记录审查结论。后续实施仍必须以经评审通过的产品合同、当前 `src/main/db/schema.sql` 和共享类型为准。

### 0.1 已读取基线

1. `AGENTS.md`
2. `doc/index.md`
3. `doc/specs/MVP_PRD_v1.0.9-authoritative.md`
4. `src/main/db/schema.sql`
5. `doc/specs/architecture-plan-b-multi-device-v2.2-authoritative-baseline.md`
6. `doc/features/multi-device-v2.2-migration-prd.md`
7. `doc/features/multi-device-v2.2-migration-impl.md`
8. `doc/specs/题库分层架构说明.md`
9. `doc/specs/《分数解释手册》v1.0+《施测者操作手册》v1.md`

### 0.2 重点审查产出

1. `doc/features/mvp-pilot-freeze-plan.md`
2. `doc/specs/FULL_PRODUCT_PRD_v2.0-draft.md`
3. `doc/features/multi-device-m4-m5-prd.md`
4. `doc/features/multi-device-m4-m5-impl.md`
5. `doc/index.md` 中对应导航与权威性说明

## 1. 总体结论：REJECT

规划方向基本正确：提前冻结 MVP、AI 自动评分和 AI 自动岗位推荐进入产品 1.0、M4 三元安全键、M5 分阶段换轨均合理。

但当前产出存在可重复发布、安全闭环、AI 正式结果合同和恢复架构等阻断项：

- R0 目前不能创建稳定 Pilot tag。
- Full Product PRD 不能升格为权威合同。
- M4 任务书不能按现状直接开工。
- M5 顺序合理，但阶段边界尚未达到可实施状态。

## 2. BLOCKER

### B1. [!] Pilot 对外承诺了当前产品无法操作的安全处置和报告闭环

**文件和准确行号**

- `doc/features/mvp-pilot-freeze-plan.md:12-18`
- `src/renderer/src/router/index.ts:60-89`
- `src/shared/types/ipc-api.ts:145-178`
- `src/preload/index.ts:29-52`
- `src/main/ipc/handlers/assessment.ts:1515-1532`
- `src/main/ipc/handlers/job-skill-report.ts:36-138`

**文档/代码 A 的事实**

冻结计划承诺“管理员安全事件处理”和“结果和报告”。

**文档/代码 B 的事实**

- 管理员端只有策略管理。
- IPC 只有 `triggerRedline`，没有事件列表、教师确认、管理员解决/作废、事实修正。
- 报告只在后台写入 `task_report`，没有读取、展示或导出 API/路由。

**实际影响**

红线事件创建后停留在 `PENDING_DETAIL`，后续会话持续被阻断；用户也无法查看所谓报告。Pilot 闭环不成立。

**推荐目标**

R0 至少交付安全事件列表、教师确认、管理员 `RESOLVED/VOIDED`、事实修正及审计；报告增加只读查询和展示。若不实现报告 UI，承诺必须收窄为“后台生成不可操作的报告快照”，但安全终态处置不能省略。

**需要同步修改**

- Pilot 冻结计划
- IPC 类型、preload、handler
- 管理员/教师 UI
- 操作手册
- 真实冒烟矩阵

**阻断：** R0、M4。

### B2. [!] 仓库可重建内容合同不能交付 Pilot 18+6

**文件和准确行号**

- `doc/features/mvp-pilot-freeze-plan.md:14,120`
- `doc/features/question-bank-import.sql:43` 起的 JOB 题记录
- `doc/features/question-bank-import-base-ability-v02.sql:8` 起的 BASE 题记录
- `scripts/lib/database-content-pack.mjs:67-99,353-383,421-466`
- `src/main/ipc/handlers/assessment.ts:425-468`
- `src/renderer/src/views/teacher/AssessmentCreateView.vue:23-45,184-187`
- `.continue-here.md:2-8`

**文档/代码 A 的事实**

- 冻结计划承诺专业岗位固定 18+6。
- 未提交交接记录称某本机运行库 298 题已 ACTIVE。

**文档/代码 B 的事实**

- 内容包重建时先清空题库，再执行两份 SQL。
- 96 条 BASE 和 298 条 JOB 源 SQL均为 `DRAFT`。
- 固定卷创建要求每个固定题都为 `ACTIVE`。
- 内存 SQLite 加载当前 schema 和题库源后实测：
  - `BASE_ABILITY | DRAFT | 96`
  - `JOB_SPECIFIC | DRAFT | 298`
  - ACTIVE JOB 为 0。
- 当前教师创建页仍显示并默认选择 BASE。

**实际影响**

全新安装或 `db:sync --reset` 后无法创建 18+6；某台机器的可变运行库不能作为 tag 的可重复发布基线。BASE 入口则形成“可点但必败”。

**推荐目标**

- 增加版本化的 Pilot 固定卷激活清单。
- 冻结 24 个题目 ID、审核状态、内容 hash、策略和所需资源。
- 在全新数据库上验收创建、答题、线下评分、结果、报告全链路。
- `db:verify` 检查固定题均 ACTIVE，而不只是总题数和语义 hash。
- BASE 入口禁用并说明审核中，后端继续 fail closed。

**需要同步修改**

- 题库内容包
- 激活来源和发布脚本
- content-pack metadata
- Pilot 能力矩阵和冻结计划

**阻断：** R0。

### B3. 默认公开开发凭据破坏 Pilot 权限和安全责任边界

**文件和准确行号**

- `src/shared/config/dev-accounts.json:1-22`
- `src/main/db/connection.ts:45-48,60-86`
- `README.md:90-94`

**证据**

每次数据库初始化都会自动写入 README 公开的管理员、教师和学生账号；没有生产构建隔离、首次管理员配置、强制改密或一次性凭据流程。

**为什么是问题**

任何知道仓库文档的人都能取得 Pilot 管理员权限，安全事件终态处置、学生隐私和教师责任边界失效。

**建议修改**

- 开发 seed 仅允许明确的开发模式。
- Pilot 首次启动生成一次性管理员凭据并强制轮换，或采用安装时配置。
- 发布测试断言生产包不会写入公开账号。

**阻断：** R0。

### B4. Pilot 自己规定的备份恢复门禁尚不可执行

**文件和准确行号**

- `doc/features/mvp-pilot-freeze-plan.md:41-49,120-123,137-143`
- `src/main/db/connection.ts:89-98`
- `scripts/lib/database-content-pack.mjs:421-432`

**证据**

现有代码能在迁移或 reset 前复制 SQLite 和单个 JSONL，但仓库没有正式 restore 命令、恢复清单、hash 校验、失败回退或真实恢复记录。

**为什么是问题**

无法完成冻结计划第 123 行的“配套备份、恢复后的常规启动”，因而不满足自己的冻结完成定义。

**建议修改**

R0 至少交付停机一致性备份/恢复 SOP 或脚本，明确文件集、hash、SQLite integrity/FK 校验、失败时保留旧 generation，并完成一次真实恢复演练。

**阻断：** R0。

### B5. [!] 1.0 必选 AI 可以被 Shadow 模式和“训练方向”绕过

**文件和准确行号**

- `doc/specs/FULL_PRODUCT_PRD_v2.0-draft.md:17-28`
- `doc/specs/FULL_PRODUCT_PRD_v2.0-draft.md:210-217`
- `doc/specs/FULL_PRODUCT_PRD_v2.0-draft.md:265-271`
- `doc/specs/FULL_PRODUCT_PRD_v2.0-draft.md:328-339`

**文档/代码 A 的事实**

17-28 行明确 AI 自动评分和自动岗位推荐是 1.0 必选核心卖点。

**文档/代码 B 的事实**

- 评分不达标允许只跑 Shadow。
- 推荐不达标允许只显示训练方向。
- 总体验收没有规定至少一个正式生产评分范围和一套真实岗位推荐范围必须上线。

**实际影响**

两项 AI 都没有实际进入生产，仍可能形式上通过 1.0 验收，违反已确认产品决策。

**推荐目标**

加入 GA 硬门禁：

1. 至少一组明确题目/证据类型真实产生 AI 建议分数并进入教师复核。
2. 至少一套已发布岗位目录真实产生 Top-N 推荐。
3. 两者均达到预先冻结的统计和安全门槛。
4. Shadow 只能是 pre-GA；运行时人工回退不能被解释为功能可以缺席。

**需要同步修改**

- Full PRD §3.5
- Full PRD §4.5
- Full PRD §9
- R6 完成定义

**阻断：** R1、产品 1.0。

### B6. [!] AI 证据到正式分数/报告的合同在当前模型中不可表达

**文件和准确行号**

- `doc/specs/FULL_PRODUCT_PRD_v2.0-draft.md:153-180,183-208,289-300`
- `src/main/db/schema.sql:396-443`
- `src/main/db/schema.sql:669-703`
- `src/main/db/schema.sql:714-762`
- `src/main/db/schema.sql:1147-1263`

**文档/代码 A 的事实**

AI 要评分开放回答、语音、视频实操和过程观察，并最终进入正式结果。

**文档/代码 B 的事实**

- 当前题型没有开放回答、语音或视频证据类型。
- `answer_record` 只接受规则题 0/2。
- `offline_score_record.scored_by` 必须是用户账号。
- `TEACHER_OBSERVATION` 被硬约束为 `score=NULL`。
- `result_record/task_report` 没有 confirmed evaluation/review 引用。
- PRD 的 AI 表和状态仅写成“建议”。

**实际影响**

实现者只能覆盖教师原始评分、把 AI 冒充教师，或把不可回放媒体直接塞进 JSON；这些路径都会破坏原始事实、回放能力和教师责任边界。

**推荐目标**

R1 将以下内容升级为规范合同：

1. 每题冻结 `RULE / AI_PROPOSED / MANUAL` 评分模式。
2. 独立 evidence artifact，包含 session/question/rubric、媒体 hash、时间片、MIME、同意和授权快照。
3. request/attempt/review 状态机，含 RUNNING、RETRYABLE/FINAL failure、REJECTED、CANCELLED、SUPERSEDED。
4. 同 input hash 幂等、最大重试、迟到响应与人工评分竞态。
5. 教师确认后创建新的 score revision，再生成新的 result/report revision，绝不覆盖原始证据。
6. `TEACHER_OBSERVATION` 继续非计分；若需 AI 评分，使用独立 scored evidence 类型。

**阻断：** R1、产品 1.0，并影响 M5 Command Bus 设计。

### B7. [!] “单岗位完整产品”与至少五岗位推荐没有内容工程合同

**文件和准确行号**

- `doc/specs/FULL_PRODUCT_PRD_v2.0-draft.md:7-15`
- `doc/specs/FULL_PRODUCT_PRD_v2.0-draft.md:223-231`
- `doc/specs/FULL_PRODUCT_PRD_v2.0-draft.md:291-300`
- `doc/specs/FULL_PRODUCT_PRD_v2.0-draft.md:312`
- `doc/specs/FULL_PRODUCT_PRD_v2.0-draft.md:346`
- `doc/specs/《分数解释手册》v1.0+《施测者操作手册》v1.md:137-146`

**文档/代码 A 的事实**

目标叫“单岗位完整产品”，2.0 多岗位研发又被列为后续。

**文档/代码 B 的事实**

1.0 推荐至少覆盖五个岗位，但 `job_catalog`/能力要求仅是建议表，首批范围和责任人仍待决策；专业手册也没有完整覆盖包装和植物养护矩阵。

**实际影响**

Top 3 要么只能编造岗位任务或资格要求，要么无法返回；也无法解释为何其他推荐岗位没有内置课程。

**推荐目标**

明确 1.0 为“一个完整课程岗位 + N 个推荐目录岗位”。每个推荐岗位发布前必须具有版本化的任务、环境、风险、支持、资格来源、证据映射、审核人和生效状态；未发布矩阵的岗位必须被输出校验器拒绝。报告应注明哪些岗位没有内置课程。

**需要同步修改**

- Full PRD
- 岗位目录 schema
- 内容工程计划
- 推荐验收集

**阻断：** R1、产品 1.0。

### B8. [!] M4 只给报告 JOIN 增加 `job_code` 仍会误判合法复测

**文件和准确行号**

- `src/main/ipc/handlers/job-skill-result.ts:207-215,238-247`
- `src/main/domain/assessment-reducer.ts:797-830`
- `src/main/ipc/handlers/job-skill-report.ts:177-185`
- `doc/features/multi-device-m4-m5-impl.md:58-60,123-127`

**文档/代码 A 的事实**

规划只要求安全摘要 JOIN 增加 `job_code`，测试只覆盖“不同 job 不串入”。

**文档/代码 B 的事实**

- 查询会汇入同学生/任务下所有非 VOIDED 历史 incident。
- 只要存在就判 `LEVEL_FAIL_BY_SAFETY`。
- 即使补成三元键，一个旧的 `RESOLVED` incident 仍会污染新复测。
- 当前 reducer 又会从新 session 读取空的 `redline_incident_id`，最终可能触发 `result_record` CHECK 而失败。

**实际影响**

同岗位合法复测可能永久判安全失败或无法生成结果，报告又会把历史事件解释为本次 `safety_overridden`。

**推荐目标**

- 本次结果只按 `assessment_session.redline_incident_id` 或当前 session 的 `safety_incident_binding` 关联。
- 历史安全史放独立报告区，不能参与本次等级裁决。
- 补“旧 RESOLVED incident + 新复测”用例。
- 错误历史报告通过 correction/supersede 修订，不原地覆盖。

**需要同步修改**

- M4 PRD
- M4 实施书
- 结果/报告查询
- 结果/报告测试

**阻断：** M4、产品 1.0。

### B9. [!] M5A 幂等身份与权威 v2.2 合同不一致

**文件和准确行号**

- `doc/features/multi-device-m4-m5-prd.md:111,125-131,145-151`
- `doc/specs/architecture-plan-b-multi-device-v2.2-authoritative-baseline.md:910-938`
- `doc/specs/architecture-plan-b-multi-device-v2.2-authoritative-baseline.md:1838-1885`
- `doc/specs/architecture-plan-b-multi-device-v2.2-authoritative-baseline.md:2200-2205`

**文档/代码 A 的事实**

新 PRD 的 envelope 只有 `command_id`，并以 `command_id + request_hash` 判断重试；`command_log` 到 M5B 才落地。

**文档/代码 B 的事实**

权威基线规定幂等身份是唯一的 `(client_instance_id, idempotency_key)`；`command_id` 是服务端命令标识，REST 也强制两个对应 header。

**实际影响**

HTTP 重试重新生成 command ID 时会重复执行；M5A 也不能在没有持久 command receipt 的情况下兑现跨重启幂等。

**推荐目标**

envelope 增加 `client_instance_id`、`idempotency_key`、`actor_id`、`device_id`、`auth_session_id`；把最小 command registry 前移 M5A，或明确 M5A 只保证单进程路由一致性，持久幂等从 M5B 才生效。

**需要同步修改**

- M5A 合同
- REST header 合同
- Command Bus 类型
- 幂等测试

**阻断：** M5A/M5B。

### B10. M5B/C 缺不可逆点、租约 fencing 和跨进程单写者合同

**文件和准确行号**

- `doc/features/multi-device-m4-m5-prd.md:155-169,184-209`
- `doc/specs/architecture-plan-b-multi-device-v2.2-authoritative-baseline.md:1857-1885`
- `doc/specs/architecture-plan-b-multi-device-v2.2-authoritative-baseline.md:1887-1908`
- `doc/specs/architecture-plan-b-multi-device-v2.2-authoritative-baseline.md:1910-1933`

**证据**

新 PRD 只说“不能产生双写者”，没有写入：

- `current_lease_generation` 与不可变 `prepared_lease_generation`。
- PREPARE fsync 后不得重新运行 Domain Handler。
- 旧 utilityProcess 与新进程重叠期间的 writer ownership/epoch。
- J-07/J-14 等接管故障注入。

**为什么是问题**

utilityProcess 崩溃重启时，旧 worker 可能继续 append/commit，形成重复副作用、sequence/hash 冲突或双投影。

**建议修改**

M5B 完整吸收架构 §11 的七步协议、不可逆点和 crash matrix；M5C 再增加进程级独占 writer lock/owner epoch，测试失去 fencing 的旧进程不能 append、APPLY 或提交 command result。

**阻断：** M5B/M5C。

### B11. [!] M7 能力被从新路线中遗漏，但 M5D 和产品 1.0 依赖它

**文件和准确行号**

- `doc/features/multi-device-v2.2-migration-prd.md:24-34`
- `doc/features/multi-device-m4-m5-prd.md:133-151,211-235,247-253`
- `doc/specs/FULL_PRODUCT_PRD_v2.0-draft.md:273-286,328-339`
- `doc/specs/architecture-plan-b-multi-device-v2.2-authoritative-baseline.md:981-1068`
- `doc/specs/architecture-plan-b-multi-device-v2.2-authoritative-baseline.md:2591-2668`

**文档/代码 A 的事实**

旧合同的 M7 包含 `offline_score_draft`、correction、invalidation、`backup_manifest`、`pairing_challenge` 和报告发布字段。

**文档/代码 B 的事实**

新路线 M5A-D 没有安排这些对象，但 M5D 要配对，教师 Web 要草稿恢复，Full PRD 要正式纠错和备份恢复。`command_log` 的幂等键、租约和结果体也无法仅从 JSONL 重建。

**实际影响**

M5D 实施中会被迫临时补 schema，破坏独立迁移/独立验收；startupRecovery 也不能替代完整备份。

**推荐目标**

按依赖拆入路线，而不是整体等待后置 M7：

- M5A/B：command registry、offline draft/finalize。
- M5B2：正式 backup/restore。
- M5D0：pairing challenge 和浏览器 auth session。
- 正式报告/AI 前：correction、invalidation、report publication。

**需要同步修改**

- M4/M5 PRD
- Full PRD 里程碑
- 旧迁移 PRD

**阻断：** M5B、M5D、产品 1.0。

## 3. HIGH

### H1. [!] M3 被写成“已完成”，但权威验收记录仍未闭合

**文件和准确行号**

- `doc/features/multi-device-m4-m5-prd.md:6`
- `doc/features/multi-device-v2.2-migration-impl.md:727`
- `doc/features/multi-device-v2.2-migration-impl.md:1180-1199`
- `.continue-here.md:2-8`

**文档/代码 A 的事实**

新 PRD、commit 和未提交交接声称主链路真实 Electron 冒烟通过。

**文档/代码 B 的事实**

权威实施记录仍是“已实现，待最终验收”，主链路、负向 `startSession`、rebind 两路径三项手工冒烟均未勾选。

**实际影响**

主链路或许执行过，但没有进入正式验收记录；负向和 rebind 冒烟也不能被推断为完成。

**推荐目标**

在实施记录写入 Electron 版本、数据库 identity、步骤、结果和证据位置；主链路可单独标通过，另外两项继续保持未完成。此前新 PRD 应写“代码已实现，主链路有交接声明，最终证据待归档”。

**需要同步修改**

- 多设备迁移 PRD/impl
- M4/M5 PRD
- `doc/index.md`
- 交接文件

**阻断：** R0、M5 启动门槛。

### H2. [!] v2.2 权威基线只覆盖 4 个安全触发器，当前 schema 实际需要 10 个

**文件和准确行号**

- `doc/specs/architecture-plan-b-multi-device-v2.2-authoritative-baseline.md:2049-2156`
- `doc/features/multi-device-v2.2-migration-prd.md:12-15,31`
- `src/main/db/schema.sql:1509-1562`
- `src/main/db/schema.sql:1717-1740`
- `doc/features/multi-device-m4-m5-prd.md:54-70`

**文档/代码 A 的事实**

架构 §13.2 只明确替换 4 个熔断/阻断触发器和 2 个开放会话索引。

**文档/代码 B 的事实**

另有 4 个 redline incident 同归属守卫和 2 个 replacement 守卫仍使用两元键。

**实际影响**

按旧权威合同实施只能完成部分三元化。

**推荐目标**

以新 M4 文档识别的“10 个触发器、2 个唯一索引、3 个查询索引”为目标。

**需要同步修改**

- v2.2 基线现实表、对象计数、§13.2 SQL、rollback
- 覆盖矩阵
- 旧迁移 PRD

新 M4 文档对这一点判断正确。

**阻断：** M4。

### H3. M4 没有定义如何处理旧两元触发器已产生的污染数据

**文件和准确行号**

- `doc/features/multi-device-m4-m5-prd.md:74-79`
- `doc/features/multi-device-m4-m5-impl.md:45-48,100-110`
- `src/main/db/schema.sql:1513-1559`
- `src/main/db/schema.sql:1721-1738`
- `src/main/db/schema.sql:1793-1834`

**证据**

旧触发器允许 job A incident 绑定 job B session、binding 或 replacement；替换触发器只保护新写入。实施书只检查 job 非空/父子键，却要求历史 binding 原样保留。

**为什么是问题**

结构升级成功的数据库仍可能包含违反三元合同的历史事实。

**建议修改**

DDL 前 fail closed 并输出冲突 ID，至少检查：

- assessment/training redline 引用。
- replacement。
- binding。
- safety-overridden result 的三元一致性。

增加合法旧库和污染旧库两组迁移夹具，不得静默补默认 job。

**阻断：** M4。

### H4. [!] Full Product 尚未决定 1.0 的分数语义和量尺

**文件和准确行号**

- `doc/specs/《分数解释手册》v1.0+《施测者操作手册》v1.md:24-44`
- `doc/specs/MVP_PRD_v1.0.9-authoritative.md:1434`
- `doc/specs/MVP_PRD_v1.0.9-authoritative.md:4498`
- `doc/specs/FULL_PRODUCT_PRD_v2.0-draft.md:149-217`

**文档/代码 A 的事实**

专业来源要求知识、直接表现、支持需求等五类分开报告，操作题采用 5 分制。

**文档/代码 B 的事实**

冻结 MVP 固定使用线上 0/2、线下 0/1/2，并明确禁止恢复任何 5 分制。

**文档/代码 C 的事实**

Full PRD 只区分规则评分和 AI 评分，没有选择 1.0 的 score ontology 和量尺。

**实际影响**

AI rubric、岗位矩阵、正式试卷和报告无法使用一致分数语义，历史结果也可能被错误重解释。

**推荐目标**

保留“知识、直接表现、支持信号分离”的专业原则；当前 0/1/2 历史保持不变。若 1.0 采用新量尺，必须通过专业评审、新 schema/result/report 版本和 migration 合同实施，不能静默将旧结果换算。

**需要同步修改**

- Full PRD
- 分数手册权威性说明
- JSON schema
- result/report 合同

**阻断：** R1、产品 1.0。

### H5. M1-M6 闭环仍是声明，不是可验收产品合同

**文件和准确行号**

- `doc/specs/FULL_PRODUCT_PRD_v2.0-draft.md:115-145`
- `doc/specs/FULL_PRODUCT_PRD_v2.0-draft.md:328-339`
- `doc/specs/题库分层架构说明.md:118-132`
- `doc/specs/题库分层架构说明.md:326-345`

**证据**

PRD 列了六门课程并直接宣称一一对应，但没有逐模块的 `course_id/task_code → 学习 → 训练 → 分项卷 → 未曝光复测/结业卷 → result/report` 映射，也没有各题库层最低内容量。

**为什么是问题**

仍可能出现“有课程名称但无复测卷”“能训但无未曝光结业题”“有结果但无报告去向”。

**建议修改**

新增六行闭环矩阵，固定课程、任务编码、试卷类型、MASTER/VARIANT/GENERALIZATION/GRADUATION 最低数量、直接表现证据、结果/报告 schema、安全归属和逐项验收方式。

**阻断：** R3-R5、产品 1.0。

### H6. AI 状态、数据授权和统计门槛不可机械验收

**文件和准确行号**

- `doc/specs/FULL_PRODUCT_PRD_v2.0-draft.md:158-165`
- `doc/specs/FULL_PRODUCT_PRD_v2.0-draft.md:183-217`
- `doc/specs/FULL_PRODUCT_PRD_v2.0-draft.md:265-271`
- `doc/specs/《分数解释手册》v1.0+《施测者操作手册》v1.md:197-204`
- `doc/specs/《分数解释手册》v1.0+《施测者操作手册》v1.md:320`

**证据**

- 158-165 行像是只有异常场景需要人工确认，199 行又要求所有 AI 结果确认。
- 状态机没有 retry attempt、超时、取消、拒绝、迟到响应和并发 guard。
- 没有声音/视频录制、AI 处理、云出站的授权主体、范围、期限、撤回、TTL 和删除。
- Kappa/80% 未定义样本量、CI、权重、分层、校准和安全 false-negative。
- 推荐“一致率”没有定义 hit@3、recall@3、Jaccard 或 exact-set。

**为什么是问题**

无法写机械化验收测试，也无法证明低置信度、安全和隐私回退正确。

**建议修改**

- 所有 AI 输出都作为 proposal 并需教师确认。
- 高置信非安全项可以批量复核。
- 预注册验证集、N/CI、指标公式和分层阈值。
- 推荐增加 harmful recommendation rate、evidence-grounding、abstention/coverage。
- 证据授权按学生、证据、用途、provider、部署方式冻结。

**阻断：** R1、产品 1.0。

### H7. AI Provider 必须是异步 saga，不能作为一次普通领域事务

**文件和准确行号**

- `doc/features/multi-device-m4-m5-prd.md:155-161`
- `doc/features/multi-device-m4-m5-prd.md:237-245`

**证据**

M5B 要求 PREPARE 时完整事件已经确定，但模型调用耗时、可能收费、不可完全复现且可能外发数据。

**为什么是问题**

- PREPARE 前调用：崩溃重试可能重复上传或计费。
- APPLY 事务内调用：长期占用 SQLite 并破坏确定性。
- PREPARE 后调用：结果未知，无法写完整 batch。

**建议修改**

固定为异步 saga：

1. `RequestAiEvaluation` 冻结授权、证据、input hash 和 provider 配置。
2. 独立 worker 执行外部调用。
3. `RecordAiEvaluationResult/Failure` 作为第二个 fenced command。
4. `ConfirmAiScore/Recommendation` 作为第三个命令进入正式结果。

Provider 不能直接写核心表，也不能任意读取 DB 或绝对文件路径。

**阻断：** M5 架构就绪、产品 1.0。

### H8. M5A 没有完整盘点读写边界

**文件和准确行号**

- `doc/features/multi-device-m4-m5-prd.md:107-116,184-200`
- `src/main/ipc/handlers/student.ts:115-122,335-384`
- `src/main/ipc/handlers/strategy.ts:458-468,726-796`
- `src/main/ipc/handlers/auth.ts:17-43`

**证据**

新 PRD 只列 assessment、training、assignment、安全、评分和报告；当前 student、strategy、认证审计、local runtime context 仍直接写 SQLite，大量 GET 也直接从 Main 查询。

**为什么是问题**

M5C 会同时迁移遗漏的业务边界、Query 授权和进程通信，违背分阶段换轨目标。

**建议修改**

M5A 增加全量读写 inventory；每条写入标记为领域命令、基础设施命令或停机运维；同时建立 transport-neutral Query Service。

**阻断：** M5A/M5C。

### H9. Pilot 没有可安装产物验收

**文件和准确行号**

- `package.json:6-22`
- `doc/features/mvp-pilot-freeze-plan.md:110-123`
- `src/main/index.ts:28-56`

**证据**

- 当前只有 `electron-vite build`，未见 installer/packager 配置。
- R0 没有干净机器安装、native addon ABI、内容包、升级、卸载和 userData 权限验收。
- 窗口仍显式 `sandbox:false`。

**为什么是问题**

`npm run build` 只证明 bundle 可生成，不证明学校机器可以安装和运行。

**建议修改**

若称学校 Pilot，增加目标 Windows 安装包和干净机器验收，包括 better-sqlite3 ABI、schema/content/assets、数据目录权限、升级保留与卸载行为。否则明确标成“工程环境演示”，不能称可试点发布。

**阻断：** R0。

### H10. Full PRD 尚未形成“当前/冻结/1.0/远期”四层权威基线

**文件和准确行号**

- `doc/specs/FULL_PRODUCT_PRD_v2.0-draft.md:3-11`
- `doc/specs/FULL_PRODUCT_PRD_v2.0-draft.md:314-348`
- `doc/index.md:46-55`

**证据**

DRAFT 和未替代 MVP 的说明正确，但 PRD 没有当前实现事实表、Pilot tag/偏差、1.0 MUST 和 post-1.0 的逐项状态。

**为什么是问题**

后续容易把目标能力当成现状，或把 Pilot 历史改成全量产品需求。

**建议修改**

增加基线治理章，对每个能力标出：

- `CURRENT_IMPLEMENTED`
- `PILOT_FROZEN`
- `PRODUCT_1_0_MUST`
- `FUTURE`

并声明 Full PRD 只向前 supersede，永不改写冻结 MVP 历史。

**阻断：** R1、产品 1.0 权威化。

## 4. MEDIUM

### M1. M4 测试矩阵覆盖类别，但没有覆盖完整分支和结构漂移

**文件和准确行号**

- `doc/features/multi-device-m4-m5-impl.md:85-133`
- `src/main/db/migrations.ts:325-359,626-643`

**证据**

已覆盖误熔断、误阻断、跨 job 汇总、replacement 和事务 rollback；未明确覆盖：

- assessment/training 的 INSERT/UPDATE 四个守卫。
- replacement INSERT/UPDATE 及两种 void reason。
- 同三元键历史 incident。
- 污染旧库 fail closed。
- legacy trigger/index 残留。
- partial unique index 的 WHERE predicate 漂移。
- 配套 DB+JSONL 的真实恢复演练。

**为什么是问题**

对象名存在或单一路径通过，不能证明旧两元语义完全消失。

**建议修改**

5 个索引按规范化完整 SQL 比较；断言所有 legacy 对象不存在；补上述行为和恢复测试，并固定真实 SQLite gate。

**阻断：** M4 发布验收。

### M2. [!] M4 PRD 要求的安全生命周期 API 没有进入实施任务书

**文件和准确行号**

- `doc/features/multi-device-m4-m5-prd.md:81-87`
- `doc/features/multi-device-m4-m5-impl.md:50-68,164-170`
- `src/main/ipc/handlers/assessment.ts:2240-2283`

**文档/代码 A 的事实**

PRD 要求创建、确认、解决、作废和事实修正 API 都验证三元键。

**文档/代码 B 的事实**

任务书只改已有创建、评分、报告查询，没有安排安全事件 handler、IPC 和 UI。

**实际影响**

按任务书完成仍不能通过自己的 PRD 条款。

**推荐目标**

鉴于 Pilot 已承诺管理员处理，建议直接纳入 R0/M4；若决定后置，必须从 M4 验收删除这些 API，并明确具体前置里程碑，不能两边同时保留。

**需要同步修改**

- M4 PRD/impl
- Pilot 计划
- IPC
- 验收矩阵

**阻断：** R0/M4。

### M3. [!] 冻结 MVP 是否允许修改存在文档治理冲突

**文件和准确行号**

- `doc/features/mvp-pilot-freeze-plan.md:104`
- `doc/features/multi-device-m4-m5-prd.md:50-52`
- `doc/features/multi-device-m4-m5-impl.md:79`

**文档/代码 A 的事实**

冻结计划要求 MVP PRD 保留历史、不再加入全量需求。

**文档/代码 B 的事实**

M4 文档提出在 MVP PRD 中增加 Post-MVP 覆盖说明。

**实际影响**

冻结 tag 后历史合同内容发生变化，降低 hash 和审计可追溯性。

**推荐目标**

MVP PRD 正文完全不改。覆盖关系只写在 `doc/index.md`、Full Product PRD 和 M4 合同中。

**需要同步修改**

- M4 PRD/impl
- `doc/index.md`
- Full PRD

**阻断：** R0/M4 文档治理。

### M4. 工作树处置表不完整，且把本机运行库状态写成仓库事实

**文件和准确行号**

- `doc/features/mvp-pilot-freeze-plan.md:73-83`
- `scripts/config/database-content-pack.json:2-4`
- `doc/features/question-bank-review-report.json:1`

**证据**

- 当前实际为 6 个修改文件、8 个未跟踪文件、无 staged。
- 处置表未列四份新文档和 `doc/index.md`。
- content-pack 元数据仍指向 schema v0.1.13，当前已是 v0.1.15。
- review report 没有生成时间、数据库 identity 或 commit。
- “落后于 298 ACTIVE”只能描述某台运行库，不能作为仓库事实。

**为什么是问题**

可能把用户文件误当生成物，或把不可复现快照带入 tag。

**建议修改**

从当前 `git status` 重建完整处置表；保留“无法确认归属不删除”的规则；更新 content-pack metadata；快照补 provenance，否则不纳入 tag。

**阻断：** R0。

### M5. `doc/index.md` 对两份专业/历史来源的权威性标注过高

**文件和准确行号**

- `doc/index.md:31-41`
- `doc/specs/题库分层架构说明.md:3-8`
- `doc/specs/题库分层架构说明.md:219-238`
- `doc/specs/题库分层架构说明.md:263-276`

**证据**

index 将题库分层和分数/施测手册列为“跨版本稳定规范”；前者自称草案/历史规划，还引用不存在的 `assessment_session_response`，并错误称当前没有 `superseded_by_question_id`；后者与 MVP 量尺冲突。

**为什么是问题**

后续实现者可能绕过当前 schema/PRD，直接执行历史设计。

**建议修改**

标注为“专业来源/历史设计，非当前工程合同；经 Full Product PRD reconciliation 后方可采纳”。Full PRD DRAFT/未替代 MVP 的现有说明应保留。

**阻断：** R1 文档治理。

### M6. 模型“可复现”和敏感属性规则仍过强或过弱

**文件和准确行号**

- `doc/specs/FULL_PRODUCT_PRD_v2.0-draft.md:208`
- `doc/specs/FULL_PRODUCT_PRD_v2.0-draft.md:242`
- `doc/specs/FULL_PRODUCT_PRD_v2.0-draft.md:246`
- `doc/specs/FULL_PRODUCT_PRD_v2.0-draft.md:271`

**证据**

- 云模型别名和非确定采样无法保证历史结果精确复现。
- “敏感属性不得单独降权”仍允许组合使用。
- “至少 Top 3”会在只有 1-2 个合格岗位时强迫凑数。

**建议修改**

- 将“可复现”拆为审计可重现和统计稳定性。
- 保存 model artifact/digest、adapter/runtime、推理参数和 provider request ID。
- 诊断、残障、性别不进入 ranker，功能性支持字段单独使用。
- 改为“最多 3 个合格候选”，不足时返回证据不足和补测清单。

**阻断：** 产品 1.0 验收，不阻断 R0/M4。

## 5. LOW

### L1. 版本和“M6”命名容易混淆

**文件和准确行号**

- `doc/specs/FULL_PRODUCT_PRD_v2.0-draft.md:4`
- `doc/specs/FULL_PRODUCT_PRD_v2.0-draft.md:7`
- `doc/specs/FULL_PRODUCT_PRD_v2.0-draft.md:321`

**证据**

文档版本叫 PRD v2.0，目标产品叫 1.0；R3 的“M6 Learning”又容易与岗位模块 M6 混淆。

**为什么是问题**

发布、schema、PRD 和里程碑引用可能产生错误传播。

**建议修改**

明确“文档版本 / 产品发布版本 / schema 版本”三者；把“M6 Learning”写成“多设备里程碑 M6 Learning 子系统”，岗位侧写成“M1-M6 岗位模块”。

**阻断：** 不阻断任何里程碑。

## 6. M4 Safety Re-key 源码扫描结论

### 6.1 已确认的完整生产影响面

除以下位置外，没有发现另一处生产安全两元查询。

**Schema 索引**

- `src/main/db/schema.sql:597-602`
- `src/main/db/schema.sql:847-855`
- `src/main/db/schema.sql:1106-1107`

**10 个触发器**

- 4 个 redline incident ownership：`src/main/db/schema.sql:1509-1562`
- 2 个新会话阻断：`src/main/db/schema.sql:1603-1628`
- 2 个 replacement ownership：`src/main/db/schema.sql:1717-1740`
- 2 个开放 assessment/training 绑定触发器：`src/main/db/schema.sql:1779-1835`

**Handler、级联与报告**

- `src/main/ipc/handlers/assessment.ts:373-398,1582-1592`
- `src/main/ipc/handlers/training.ts:114-131,713-729`
- `src/main/ipc/handlers/operation-scoring.ts:68-100`
- `src/main/ipc/handlers/job-skill-scoring.ts:67-95`
- `src/main/ipc/handlers/job-skill-result.ts:207-215,240-247`

**Reducer**

- 没有发现额外两元 SQL。
- `src/main/domain/assessment-reducer.ts:675-680` 的注释仍是旧语义。

**报告**

- `src/main/ipc/handlers/job-skill-report.ts` 没有直接两元 JOIN。
- 其 `177-185` 会消费已污染的安全摘要。

### 6.2 受影响的现有测试夹具

至少包括：

- `src/main/domain/__tests__/assessment-reducer.test.ts:39-40,124-143,702-785`
- `src/main/ipc/handlers/__tests__/assessment-create.test.ts:127-141`
- `src/main/ipc/handlers/__tests__/training-create.test.ts:253-260`
- `src/main/ipc/handlers/__tests__/assessment-redline.test.ts:658-680,826-830`
- `src/main/ipc/handlers/__tests__/training-redline.test.ts:107-114,141-173`
- `src/main/ipc/handlers/__tests__/assessment-answer.test.ts:215-230`
- `src/main/ipc/handlers/__tests__/assessment-read.test.ts:245-262`
- `src/main/ipc/handlers/__tests__/assessment-start-session.test.ts:226-243`
- `src/main/ipc/handlers/__tests__/assessment-emotion.test.ts:194-207`
- `src/main/ipc/handlers/__tests__/job-skill-scoring.test.ts:448-469`
- `src/main/ipc/handlers/__tests__/job-skill-result.test.ts:336-360`

## 7. 已验证无问题的关键声明

1. `BASE_ABILITY 42+8` 当前确实不能开放：96 条均为 DRAFT/NO_SCORE，且不是可评分正式卷。
2. JSONL 冷启动重建确实未实现：当前仍是单事件 append + SQLite 投影，启动不扫描 JSONL。
3. v2.2 §13.2 确实只明确 4 个安全触发器和 2 个开放会话索引。
4. M4 新文档识别“当前共需处理 10 个触发器”准确。
5. M4 测试矩阵已经覆盖误熔断、误阻断、跨 job 误汇总、replacement 和 migration transaction rollback；完整分支缺口见 M1。
6. M5A → M5B → M5C → M5D 的大顺序合理。
7. “先在同进程稳定 Command Bus/Event Batch，再迁 utilityProcess，最后开放 Teacher Web”能避免同时迁业务边界、事件协议和进程通信。
8. Full PRD 已正确做到：
   - AI 确实产生 `proposed_score`，不是模糊建议。
   - 输出包含 evidence refs、置信、模型/提示版本、input hash 和原始输出。
   - 推荐输入区分直接表现、知识、支持需求、兴趣和感官条件。
   - 推荐受控目录、禁止编造、教师确认、覆盖理由和历史版本方向正确。
   - 教师而非黑盒模型承担最终责任。
9. `doc/index.md` 正确把四份新产出标记为 DRAFT，尚未覆盖 MVP PRD 历史。
10. 当前迁移前确实会配套备份 DB 和现有 `action_log.jsonl`；缺的是正式 restore 合同和验证。

## 8. 当前自动验证结果

审查期间取得以下当前证据：

- `npm run typecheck`：通过。
- `npm run lint`：退出码 0；0 error、160 个既有 warning。
- `npm test`：52 个测试文件、666 个测试全部通过。
- M3 focused tests：4 个文件、33 个测试全部通过。
- `npm run docs:index:check`：通过。
- `git diff --check`：通过。
- 内存 SQLite 加载 schema 和两份题库合同：通过；确认两域题目均为 DRAFT。

未运行生产 build/installer，也未执行新的真实 Electron 冒烟，因此没有把历史交接中的 build/冒烟声明当成当前独立验证。

## 9. 必须修改清单

1. 重写 Pilot 对外承诺和 R0 验收矩阵，补安全终态、报告读取、可重复 18+6 内容包、生产账号、安装和备份恢复。
2. 将 M3 当前状态改为“主链路声明待归档、负向/rebind 冒烟未完成”，或补齐正式证据。
3. Full PRD 增加四层基线治理、AI GA 硬门禁和六模块闭环矩阵。
4. 冻结首批 AI 评分题/证据范围、正式状态机、证据授权和 result/report revision 合同。
5. 冻结首批推荐岗位目录、能力矩阵、来源、责任人和输出校验。
6. 决定 1.0 分数 ontology/量尺，解决五类分数、5 分制与 MVP 0/1/2 冲突。
7. M4 改为 session-binding 级安全汇总，并增加污染历史数据 preflight。
8. M4 实施书补安全生命周期 API 或明确将其移出验收；当前建议纳入。
9. M5A 对齐 `client_instance_id + idempotency_key`，补全读写 inventory 和 Query Service。
10. M5B/C 补 fencing、不可逆点、writer ownership 和完整 crash matrix。
11. 给 offline draft、correction/invalidation、pairing 和正式 backup/restore 安排明确里程碑。
12. 把 AI Provider 固定为异步、可审计 saga。

## 10. 可以后置清单

- 第二家云模型适配器。
- 更多岗位的完整课程；但首批推荐岗位目录和矩阵不能后置。
- 家长端、企业导师端和跨校云平台。
- VR/数字人、高级行为分析和自动题目生成。
- 精确私有模型硬件型号；但至少一种私有部署路径和资源预算门槛不能后置。
- doc-map 工具是否保留。
- 非阻断的 Vue lint warning 整理。

## 11. 推荐的下一步唯一原子动作

只修订 `doc/features/mvp-pilot-freeze-plan.md`：

1. 把第 10 行改为“满足冻结完成定义后方可冻结”。
2. 在同一文件中用全新数据库事实重写 R0 验收矩阵。
3. 验收矩阵至少纳入：
   - 18+6 激活清单。
   - 安全事件终态。
   - 报告读取。
   - 生产账号。
   - 可安装产物。
   - 备份恢复。
   - M3 可追溯证据。

完成该单文件评审前，不启动 M4 编码。

## 12. 四份新文档判定

| 文档 | 判定 | 说明 |
|---|---|---|
| `doc/features/mvp-pilot-freeze-plan.md` | 修改后可接受 | 框架可保留，但当前“可以冻结”和对外承诺不成立 |
| `doc/specs/FULL_PRODUCT_PRD_v2.0-draft.md` | 修改后可接受 | 产品骨架和 AI 方向可保留；必须结构性补写后才能 authoritative |
| `doc/features/multi-device-m4-m5-prd.md` | 修改后可接受 | M4 影响面和 M5 顺序正确；幂等、fencing、M7 和 AI saga 需补齐 |
| `doc/features/multi-device-m4-m5-impl.md` | 修改后可接受 | M4 基本任务骨架可用；结果关联、污染迁移、安全 API 和完整测试仍缺失 |

`doc/index.md`：修改后可接受。DRAFT 导航正确，但需修正 M3 状态，并将题库分层/评分手册降为“专业或历史来源，非当前工程合同”。

## 13. 压缩上下文后的恢复提示

新会话继续推进时，先读本报告，再执行第 11 节唯一原子动作。不得跳过 R0 直接编码 M4；不得把本报告中的目标状态写成当前已实现事实；不得修改冻结 MVP PRD 历史正文。
