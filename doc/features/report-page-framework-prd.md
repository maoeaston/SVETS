# F7 报告页面框架 Mini-PRD

- 状态：`APPROVED_FOR_IMPLEMENTATION`
- 审阅：2026-07-24 Reviewer 终检通过，无剩余高、中严重度问题
- 产品合同：`doc/specs/MVP_PRD_v1.0.9-authoritative.md`
- 计划来源：`doc/features/pilot-r0-foundation-development-plan-2026-07-22.md` F7
- Pilot 门禁补充：`doc/features/mvp-pilot-freeze-plan.md` R0-G04
- 日期：2026-07-24

## 1. 功能名称与目标

功能名称：F7 报告页面框架。

目标是让教师从统一入口查询、生成、查看、复核、锁定和导出报告，并保证页面展示的是已持久化的报告快照，不是打开页面时重新拼出的实时结果。

本阶段覆盖三类报告：

- 基础任务完整报告：`report_type = FULL_REPORT`，`report_scope = BASE_ABILITY`，内容合同为 `task-report-v1.1`。
- 专业岗位报告：`report_type = FULL_REPORT`，`report_scope = JOB_SKILL`，内容合同为 `job-skill-report-v1.0`。
- 安全中止报告：`report_type = SAFETY_TERMINATION_REPORT`，`report_scope = SAFETY`，并用 `source_scope` 标识 BASE_ABILITY、JOB_SKILL、TRAINING、MIXED 或 NO_BOUND_SESSION 来源。渲染时先按 `report_type` 进入安全中止外壳，再展示来源路径和红线前过程记录。

报告使用 `task_report.report_content_json` 直接渲染，不引入 Markdown 渲染库。F7 不实现 PDF 报告渲染，用户可用的最小导出格式为自包含 HTML。

## 2. 解决的问题

当前工程已有 `task_report`、报告事件类型和 JOB_SKILL 报告生成代码，但还没有完整报告闭环：

- 教师端没有报告列表、详情、受控重试、安置复核、锁定和导出入口。
- BASE_ABILITY 完整报告和安全中止报告尚无统一生成服务。
- 现有 JOB_SKILL 报告生成失败只写控制台，无法从产品页面识别和重试。
- `REPORT_LOCKED`、`REPORT_EXPORTED`、`PLACEMENT_REVIEW_CONFIRMED` 尚无完整 SQLite 投影和恢复重放路径。
- 重测后的报告版本、旧报告 `SUPERSEDED` 状态和幂等边界尚未统一。
- 当前报告元数据存在硬编码，不能如实展示策略、题库、素材、评分器版本和实际坐次。

F7 要把这些能力收口为教师可操作、主进程可授权、事件可重放、失败可恢复的最小报告框架。

## 3. 用户角色与权限

### 3.1 教师 `TEACHER`

教师是 F7 完整报告页面的唯一业务角色，可以：

- 查看学生报告列表和报告详情。
- 查看可生成或可重试的报告候选。
- 对基础任务的三类结果执行一次任务闭环确认，并从已确认闭环生成报告。
- 对误配的任务闭环执行有原因、有替换关系的修正确认。
- 为符合条件的 JOB_SKILL 结果或已确认安全事件生成报告。
- 对包含安置建议的报告执行一次安置建议复核确认。
- 锁定报告。
- 导出默认脱敏的自包含 HTML 报告。

教师不能：

- 修改 `report_content_json` 中已经生成的分数、观察、建议或版本事实。
- 删除报告或覆盖旧报告。
- 绕过任务闭环确认，直接提交任意三条 result ID 生成基础任务完整报告。
- 为红线来源生成普通报告。
- 为 Pilot、未完成测评或 JOB_SKILL 报告启用就业安置建议。
- 导出完整非脱敏报告。该能力不在 F7 范围内。

### 3.2 学生 `STUDENT`

学生继续使用简化成果反馈，不进入 F7 完整报告列表和详情页，也不能调用报告生成、复核、锁定或导出 IPC。

### 3.3 管理员 `ADMIN`

权威 PRD 未授予管理员报告业务操作权。F7 不为管理员新增报告列表、生成、复核、锁定或导出入口。管理员仍可通过异常中心处理系统级报告异常，但不能绕过教师责任边界修改报告事实。

### 3.4 权限校验原则

- 路由守卫只负责页面跳转体验，主进程 IPC 必须从可信登录会话解析真实用户和角色。
- 渲染进程传入的 `callerUserId`、`callerRole` 或学生 ID 不能作为最终授权依据。
- 未授权请求统一返回稳定的 `FORBIDDEN`，且不得泄露报告标题、学生信息、内容或文件路径。

## 4. 最小闭环与核心场景

```text
教师进入报告列表
  -> 查看已有快照和可生成/可重试候选
  -> BASE_ABILITY 候选先确认 task_closure，其他候选确认合法来源
  -> 主进程校验角色、来源、红线、结果集合和内容合同
  -> REPORT_GENERATED 写入 action_log.jsonl
  -> reducer 投影 task_report
  -> 详情页直接读取并渲染 report_content_json
  -> 按需完成安置建议复核
  -> 按需锁定或导出默认脱敏 HTML
  -> REPORT_LOCKED / REPORT_EXPORTED / PLACEMENT_REVIEW_CONFIRMED 可重放
```

### 4.1 报告列表

- 默认按 `generated_at DESC, report_id DESC` 稳定排序。
- 支持按学生、报告范围、报告类型、状态和生成日期筛选。
- 每行至少显示学生、报告标题、范围、类型、状态、报告版本、生成时间和是否可导出。
- `SUPERSEDED`、`ARCHIVED` 和历史报告默认不隐藏，但要有明确历史标识。
- `contract_validation_status = REPAIR_REQUIRED` 的旧报告显示受控合同错误和“修复报告”入口，不把缺失区块当作空数据正常展示。
- 生成失败没有合法快照时，不伪造 `task_report` 行；列表通过可重试候选和关联异常显示失败状态。
- 空数据、加载失败、无权限和可重试错误使用页面内稳定状态，不只显示 Toast。

### 4.2 报告生成

报告生成必须是显式、幂等的领域命令。打开列表或详情不得隐式生成新报告。

允许的触发方式：

- 基础任务完整报告由教师从已经持久化的 `task_closure` 显式生成；生成 IPC 只接收 `task_closure_id`，不接收可任意组合的三条 result ID。
- 正常新轮次与闭环来源修正使用不同命令；修正不能伪装为普通新轮次来复用历史 result。
- JOB_SKILL 结果完成后可继续自动尝试生成；教师页面必须提供同一幂等命令作为失败重试入口。
- 安全事件处于 `PENDING_DETAIL` 时只显示“等待教师确认事实”，不生成报告。教师将事件推进到 `CONFIRMED` 后，系统自动尝试生成安全中止报告；失败后教师可从候选入口重试。
- `PENDING_DETAIL -> VOIDED` 的误报或重复记录在确认前不生成安全报告。

生成成功时，最终 `report_content_json` 必须完整进入 `REPORT_GENERATED` payload，保证仅依赖事件日志即可重建 SQLite 报告投影。

### 4.3 报告详情

- 详情页先读取 `task_report`，再解析已保存的 `report_content_json`。
- 详情页不得查询 current result 后重新计算报告分数、等级、模块画像或建议。
- 即使来源结果后来被 supersede，历史报告仍按原快照显示，并清楚标记为历史版本。
- 详情页必须显示报告 ID、来源 result/session/incident ID、报告 schema 版本、策略版本、题库批次、素材标识与 hash、评分器版本、生成时间和实际坐次。
- JSON 合同无效时显示受控错误并登记异常，不得白屏、猜测缺失内容或退回 Markdown 渲染。

### 4.4 安置建议复核

- 只有 `contract_validation_status = VALID` 的活动报告可以复核；`REPAIR_REQUIRED` 只能查看错误和执行 `CONTRACT_REPAIR`。
- `placement_advice.enabled = true` 时，`recommendation` 必须为非空结构，且报告一律需要复核。
- `placement_advice.enabled = false` 时，`recommendation` 必须为 `null`，`reason_disabled` 必须非空，且报告不得被要求复核。
- 复核前报告可生成、可查看，不可导出。
- 复核由教师执行，写入 `PLACEMENT_REVIEW_CONFIRMED`，事件同时绑定 `placement_advice_hash`，再投影到 `task_report.placement_review_by / placement_review_at`。
- 复核人和复核时间属于生命周期元数据，不回写或覆盖 `report_content_json`；详情与导出视图将该元数据和固定免责声明合并展示。
- 同一报告只能首次确认，重复请求幂等返回原确认，不允许静默改写复核人或复核时间。
- 当前 Pilot、`completion_ratio < 1` 和 JOB_SKILL 报告的 `placement_advice.enabled` 必须为 `false`，不得借 F7 生成正式就业安置结论。

### 4.5 锁定

- 只有 `contract_validation_status = VALID` 的活动报告可以锁定；合同修复完成前禁止锁定旧快照。
- 锁定需要二次确认，并写入 `REPORT_LOCKED` 事件。
- 报告内容从 `GENERATED` 起就是快照，锁定是教师确认该快照不再进入业务修订的审计状态，不是允许锁定前自由编辑。
- 包含安置建议的报告必须先完成复核，才能锁定。
- `GENERATED` 或 `EXPORTED` 可进入 `LOCKED`；重复锁定幂等。
- `LOCKED` 仍可导出，导出后保持 `LOCKED`，导出历史由事件记录。
- 新一轮合法结果生成新报告时，旧 `LOCKED` 报告仍可转为 `SUPERSEDED`；该状态变化不修改旧内容。

### 4.6 导出

- 只有 `contract_validation_status = VALID` 的活动报告可以导出；`REPAIR_REQUIRED` 即使生命周期状态为 `GENERATED / EXPORTED / LOCKED` 也必须被领域服务和 schema guard 阻断。
- F7 只提供自包含 HTML 导出，`REPORT_EXPORTED.export_format = HTML`。
- 默认脱敏：学生显示名固定为 `学生-<student_id 末四位>`，不导出真实姓名；监护人联系方式、异常技术信息和教师备注不进入导出。
- F7 不提供完整非脱敏导出，因此不新增该路径的二次确认界面。
- 导出内容只能来自报告快照和其复核/锁定元数据，不得重新读取 current result 生成另一份内容。
- 文件成功写入并计算 hash 后，才写 `REPORT_EXPORTED`，创建 `asset_type = OTHER / asset_role = REPORT_FILE / mime_type = text/html` 的 `asset_resource`，并把 `task_report.file_*` 更新为最后一次成功导出元数据。历史导出仍由事件和独立 asset 行保留。
- 用户取消保存不是失败，不写导出事件，也不改变报告状态。
- 文件写入、hash 或事件持久化失败时，报告快照保留，状态不伪装成成功，并记录可在异常中心查看的导出失败。
- `SUPERSEDED`、`ARCHIVED` 和 `FAILED` 报告只读，不允许从 F7 页面新导出。

导出与页面渲染必须共用结构化字段渲染器，并满足以下内容安全约束：

- Vue 页面只使用文本插值和受控属性，不使用 `v-html`、`innerHTML` 或把报告字段拼成模板源码。
- HTML 导出对所有动态文本和属性值执行上下文对应的转义，不允许报告内容注入 `<script>`、事件属性、`javascript:` URL、表单、iframe 或未审核 HTML。
- 导出文件不加载外部脚本、样式、字体、图片或网络资源；允许的图片必须是系统审核后的 `data:` 内嵌资源。
- 导出文件写入 CSP：`default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'`，且模板本身不含脚本。
- 恶意学生姓名、教师备注、题目文本和观察文本必须作为测试夹具，证明页面与导出均只显示文本而不执行内容。

## 5. 报告快照合同

### 5.1 基础任务完整报告

基础任务完整报告必须从持久化的 `task_closure` 读取以下三条结果，不能按“该学生最新结果”静默拼接，也不能由生成 IPC 临时提交结果组合：

1. 一条 `ABILITY_SCORE`。
2. 一条 `TRAINING_COMPLETION`。
3. 一条 `OPERATION_PASS_RATE`。

`task_closure` 是 F7 为基础任务报告新增的最小闭环事实。教师在候选页看见来源会话、完成时间和结果摘要后执行“确认本轮闭环”，主进程写 `TASK_CLOSURE_CONFIRMED` 事件并投影闭环记录。三条 binding 一经确认不可原地修改，但闭环有事件化的生命周期：

- 正常确认新教学轮次时，`cycle_no` 在同一 `student_id + job_code + task_code` 下递增，`closure_revision = 1`。此前仍为 `CONFIRMED` 的闭环和其活动报告在同一事件投影中进入 `SUPERSEDED`，新闭环成为唯一活动闭环；若新报告随后生成失败，页面如实显示“新闭环待生成”，不得继续把旧报告当作当前报告导出。
- 发现某轮来源误配时，教师使用 `TASK_CLOSURE_REPLACED` 对该 `cycle_no` 的最新 revision 执行二次确认，填写非空修正原因；旧 revision 退出 cycle head，replacement 沿用 `cycle_no`、递增 `closure_revision` 并记录 `replaces_task_closure_id`。
- replacement 可以复用被替换闭环中的正确 result，也可以加入从未绑定的新 result；不得借修正命令复用其他历史轮次的 result。
- replacement 至少有一条 typed result binding 必须与直接旧版不同；三条完全相同的请求按幂等返回旧闭环，不创建空修订。
- 若修正的是当前最高 `cycle_no`，replacement 保持 `status = CONFIRMED` 并可生成新报告；若修正的是已有更新轮次的历史闭环，replacement 保持 `status = SUPERSEDED`，只纠正审计关系，不得越过水位成为活动报告。
- 若被替换闭环已有报告，该报告立即进入 `ARCHIVED` 并显示“闭环来源已修正”；当前轮 replacement 可另行生成报告，历史轮不补造新的活动报告，旧内容不被覆盖。

闭环确认服务必须验证：

- 三条结果在闭环确认时均为 `is_current = 1`。
- 三条结果属于同一 `student_id + job_code + task_code`。
- `ABILITY_SCORE` 来源是 BASE_ABILITY 路径，不得混入 `JOB_SKILL_SCORE`。
- 每类结果恰好一条，结果 ID 按固定类型顺序写入 `source_result_ids_json`。
- 三条结果的来源 session 均已进入可出报告的终态，且未绑定红线或安全覆盖；除合法 replacement 复用其直接前版外，不得绑定另一个 `task_closure`。
- 正常新轮次使用的 result ID 从未出现在任何历史闭环；replacement 使用的旧 result 只能来自其直接替换对象。
- 闭环记录固化 `cycle_no / closure_revision / status / is_cycle_head`、三条 result ID、各自 source aggregate ID、学生、岗位、任务、确认教师、确认事件和确认时间。

报告首次生成时还必须验证 `task_closure.status = CONFIRMED`、`is_cycle_head = 1`、它是该学生/岗位/任务的唯一活动闭环、binding 与确认事件一致，且三条结果仍为 current。`cycle_no / closure_revision` 提供明确水位：新闭环确认后旧闭环已是 `SUPERSEDED`，因此不能反向生成活动报告。结果后来变为非 current 不会改变已经生成的历史报告；尚未生成报告的旧闭环只保留审计事实。

报告来源字段固定为：

- `task_report.source_aggregate_type = ASSESSMENT_SESSION`，`source_aggregate_id` 使用 `ABILITY_SCORE` 的来源 session。
- `source_result_ids_json` 使用 `ABILITY_SCORE`、`TRAINING_COMPLETION`、`OPERATION_PASS_RATE` 固定顺序。
- `report_content_json.source_meta` 保存 `task_closure_id / cycle_no / closure_revision` 和 `task_result_snapshots`。

`source_meta.task_result_snapshots` 必须按上述固定顺序保存三个判别联合对象。每个对象共有 `result_id / result_type / source_aggregate_type / source_aggregate_id / generated_at / strategy_id / strategy_type / raw_score / max_score / normalized_score / completion_ratio / level_result / safety_overridden / redline_incident_id / source_started_at / source_completed_at`，并按类型增加：

- `ABILITY_SCORE.details`：通过 `AbilityScorePayload` validator 的模块得分、线上/线下原始分、题目完成数、情绪崩溃次数和兜底原因。
- `TRAINING_COMPLETION.details`：`total_steps / completed_steps / skipped_steps / failed_steps / completion_rate / completed_at`；这些值从对应完成事件和训练快照固化，不能只保留一个百分比。
- `OPERATION_PASS_RATE.details`：通过 `OperationPassRatePayload` validator 的九项评分、原始分、满分、总项数和 `scored_at`。

页面的能力分、训练完成度、实操达标率、等级和三个时间全部只读 `task_result_snapshots`。生成后即使来源 result 的 `is_current` 改变、source session 出现新结果或运行库策略升级，详情和导出也不得回查并替换这些值。

BASE validator 必须同时校验：三个 snapshot ID 与 `source_result_ids_json` 完全一致，snapshot canonical JSON 与 `source_set_hash` 的输入一致，页面使用的 `score_summary / module_profiles / training / operation` 展示字段与 typed snapshot 不矛盾。任一重复事实不一致时拒绝生成或标记 `REPAIR_REQUIRED`，不得由前端自行选择一个值。

内容必须符合 `task-report-v1.1`，至少包含：

- `assessment_meta`
- `score_summary`
- `module_profiles`
- `evidence_summary`
- `support_summary`
- `administration_status`
- `behavior_observations`
- `validity_limitations`
- `safety_summary`
- `placement_advice`

页面并列展示 `ABILITY_SCORE`、`TRAINING_COMPLETION` 和 `OPERATION_PASS_RATE`，不得平均、相加或合成为单一总分。

### 5.2 专业岗位报告

专业岗位报告绑定一条 current `JOB_SKILL_SCORE`，来源必须是已完成的 `JOB_SKILL_ASSESSMENT` session。

内容必须符合 `job-skill-report-v1.0`，至少包含：

- 总体得分和等级。
- M1-M6 六个岗位模块画像。
- 线上知识与情境判断、线下实操的分开展示。
- 支持等级、合理便利和教师观察。
- 观察完成度和管理状态。
- 安全摘要与效度限制。
- 基于固定规则的训练重点和训练任务。
- `placement_advice.enabled = false`、`recommendation = null`，原因固定为专业岗位 MVP 不输出安置建议。

只有 M2 低分可链接现有“拆箱与上架”训练。其他模块仅显示建议文案，不生成虚假链接，也不得把固定规则建议称为 AI 推荐。

### 5.3 安全中止报告

安全中止报告以 `safety_incident` 为主来源：

- `source_aggregate_type = SAFETY_INCIDENT`。
- `source_aggregate_id = incident_id`。
- `incident_ids` 至少包含主 incident。
- 可关联该 incident 熔断前已经存在的 result、answer、offline score 和 training step 摘要，但不得把这些记录解释为普通达标结论。

安全中止报告至少显示事件时间、原因、发生环节、绑定会话、红线前过程记录、安全结论和后续责任提示。不得显示就业安置方向，也不得把普通分数覆盖 `LEVEL_FAIL_BY_SAFETY`。

安全报告采用独立运行时合同 `safety-termination-report-v1.0`，至少包含：

```json
{
  "report_schema_version": "safety-termination-report-v1.0",
  "report_scope": "SAFETY",
  "source_scope": "NO_BOUND_SESSION",
  "report_type": "SAFETY_TERMINATION_REPORT",
  "incident_snapshot": {
    "incident_id": "...",
    "student_id": "...",
    "job_code": "...",
    "task_code": "...",
    "status_at_generation": "CONFIRMED",
    "reason_code": "...",
    "context_phase": "...",
    "description": "...",
    "occurred_at": "...",
    "triggered_by": "...",
    "confirmed_by": "...",
    "confirmed_at": "..."
  },
  "binding_snapshots": [],
  "pre_redline_records": {
    "result_ids": [],
    "answer_summary": {},
    "offline_score_summary": {},
    "training_step_summary": {}
  },
  "safety_summary": {
    "level_result": "LEVEL_FAIL_BY_SAFETY",
    "ordinary_report_blocked": true
  },
  "validity_limitations": [],
  "correction_lineage": {
    "root_incident_id": "...",
    "replaces_incident_id": null,
    "supersedes_report_id": null
  },
  "source_meta": {
    "metadata_availability": "NO_BOUND_SESSION",
    "binding_metadata": []
  }
}
```

其中 `source_scope` 只允许 `BASE_ABILITY / JOB_SKILL / TRAINING / MIXED / NO_BOUND_SESSION`。权威 PRD §5.7.1 允许在没有开放会话时创建 incident，因此 `NO_BOUND_SESSION` 下 `binding_snapshots`、红线前记录和 `source_meta.binding_metadata` 可以为空，`metadata_availability` 必须为 `NO_BOUND_SESSION`，不得伪造任何 session 元数据。其他 scope 下，`binding_snapshots` 必须逐条固化 incident 绑定对象的 `aggregate_type / aggregate_id / pre_status / post_status`；`pre_redline_records` 只收录 `occurred_at` 前已经持久化且属于绑定会话的记录。

`source_meta.binding_metadata` 按 binding 类型使用判别联合：

- `aggregate_type = ASSESSMENT_SESSION`：必须固化 session/strategy ID 与版本、题库版本与导入批次、引用素材 ID/hash、评分器与 content/scoring schema 版本、实际 sittings、完成率和开始/结束时间。
- `aggregate_type = TRAINING_SESSION`：必须固化 training session、开始/结束时间、实际训练策略 ID/版本或明确的 `strategy_availability = NOT_CONFIGURED`、红线前 step 状态/次数/时间、引用素材 ID/hash；不要求 assessment 题库、评分器或 sitting，相关数组必须为空而非伪造。
- 同一 incident 同时绑定 assessment 与 training 时逐条保存两个 variant，`metadata_availability = BY_BINDING`。

只缺少某个 variant 合同要求的元数据时生成失败；对该 variant 明确不适用的字段为空不构成失败。

安全报告要求 incident 曾由教师确认事实，而不是要求生成瞬间仍处于 `CONFIRMED`。生成或重试时只允许：

- 当前状态为 `CONFIRMED`；或
- 当前状态为 `RESOLVED`，且 `confirmed_by / confirmed_at` 完整、`void_reason` 为空。

此时 `incident_snapshot.status_at_generation` 写实际状态，validator 允许 `CONFIRMED / RESOLVED`。从未确认的 incident，以及当前为 `VOIDED` 的 incident，不得生成或重试安全报告。

安全事件后续状态规则：

- `CONFIRMED -> RESOLVED` 只解除后续会话阻断，不修改既有安全报告；若此前自动生成失败，仍可从已确认且已解决的事实重试生成。
- `CONFIRMED -> VOIDED` 且 `void_reason = FALSE_TRIGGER / NON_SAFETY_EVENT` 时，既有报告立即进入 `ARCHIVED` 并显示失效原因；若此前未生成，候选直接消失，不得事后补生成。
- `CONFIRMED -> VOIDED` 且 `void_reason = FACTUAL_CORRECTION` 时，既有报告立即进入 `SUPERSEDED`；replacement incident 经教师再次确认后生成替代报告，并通过 `correction_lineage` 关联旧报告。
- `void_reason = DUPLICATE_RECORD` 时，以 `replacement_incident_id` 指向的主 incident 为事实源；重复 incident 的既有报告立即进入 `SUPERSEDED`，主 incident 报告独立生成或复用。
- 事实修正或重复归并不得原地更新旧安全报告内容。

详情渲染分支优先级固定为：

1. `report_type = SAFETY_TERMINATION_REPORT`。
2. `report_scope = JOB_SKILL`。
3. `report_scope = BASE_ABILITY` 或缺省的基础任务报告。

### 5.4 版本、坐次和来源元数据

每份报告都必须固化报告 schema 版本、lineage 内的 `report_revision`、生成时间和适用的来源标识。BASE_ABILITY、JOB_SKILL 普通报告以及安全报告中的 assessment binding 还必须固化并展示以下真实值，不得硬编码：

- 报告 schema 版本和同一报告 lineage 下的 `report_revision`。
- 来源 result ID、session ID 和 incident ID。
- `strategy_id + strategy_version`。
- session 题目对应的 `question_bank.version` 和不同 `content_json.source.import_batch_id`。
- 引用素材的 `asset_id + file_hash`，以及可用时的 content-pack 版本。
- `scoring_engine_version`、content/scoring schema 版本。
- 实际 `sitting_count` 和每坐次的开始、结束、时长、结束方式。
- `completion_ratio`、中途终止原因和生成时间。

training-only 安全报告按 §5.3 的 training variant 校验，不因没有 assessment 题库、评分器或 sitting 而失败。没有绑定会话的安全报告使用 `NO_BOUND_SESSION` 分支和空数组表达“不存在”。两者都不能用固定版本、空字符串或虚构坐次冒充完整元数据。

基础能力报告还必须从该 session 冻结的 `strategy_config.scoring_policy_json.pilot_mode` 写入 `assessment_meta.pilot_mode`，并据此写入不可由前端参数覆盖的 `assessment_meta.report_usage`：

- `pilot_mode = true` 时固定为 `PILOT_ONLY`，页面和导出醒目标示“试测报告，仅用于流程与内容验证，不作为就业安置依据”。
- `pilot_mode = false` 时才允许标记为 `FORMAL`，但仍须遵守 `placement_advice_enabled` 和安置复核规则。
- JOB_SKILL 报告固定为 `MVP_DEMO_PROFILE_ONLY`，页面和导出显示“岗位测评演示画像，不输出就业安置结论”。

`pilot_mode`、`report_usage` 和对应免责声明都是报告快照及运行时 validator 的字段，不能由渲染进程传参删除或降级。

缺少强制版本元数据时报告生成失败并进入受控重试，不允许用固定常量或空字符串伪装完整快照。

### 5.5 幂等、版本与 supersede

普通报告的 lineage 输入为：

```text
{ student_id, job_code, task_code, report_scope, report_type }
```

安全报告的 lineage 输入为 `{ report_type: SAFETY_TERMINATION_REPORT, root_incident_id }`。互不相关的安全事件各自保留活动报告；`FACTUAL_CORRECTION` replacement 与 `DUPLICATE_RECORD` 归并沿用根 incident lineage。

所有 canonical JSON 均采用 UTF-8、对象键按字典序、数组按合同固定顺序、无额外空白的编码；hash 使用小写十六进制 SHA-256。`lineage_key` 是 lineage 输入 canonical JSON 的 SHA-256，`content_hash` 是最终 `report_content_json` canonical JSON 的 SHA-256，`file_hash` 是实际导出文件字节的 SHA-256。

服务必须生成以下规范化键并持久化到 `task_report` 的索引列：

- `source_set_hash = SHA-256(canonical JSON)`；BASE 输入包含 `task_closure_id / cycle_no / closure_revision` 和固定结果类型顺序的完整 `task_result_snapshots`，JOB_SKILL 使用单一 typed result snapshot，安全报告使用根 incident、replacement 链、binding snapshot 和红线前记录标识。
- `generation_key = SHA-256(canonical JSON)`，输入对象固定为 `{ lineage_key, source_set_hash, report_schema_version, report_builder_version, generation_reason, repair_of_report_id }`，其中不存在 repair 对象时 `repair_of_report_id` 也必须显式编码为 `null`，不得使用裸字符串拼接。
- `report_revision` 在 lineage 内从 1 单调递增。

规则：

- 只有来源集合相同、schema 和 builder 版本相同、来源元数据一致，且现有内容通过当前运行时 validator 时，重复生成才返回已有报告。
- 相同来源的当前活动 JOB_SKILL 或其他快照若缺少强制字段、含硬编码伪元数据或未通过 validator，必须以 `generation_reason = CONTRACT_REPAIR` 创建新 revision，并用 `repair_of_report_id` 关联和淘汰旧报告，不能永久复用无效快照。
- `report_builder_version` 是生成器实现版本；生成规则或合同修复发布时必须递增，同一实现生成普通报告时保持稳定。同一修复请求使用相同 `generation_key`，并发重试只产生一份修复快照。
- `generation_reason` 只允许 `NORMAL / CONTRACT_REPAIR / FACTUAL_CORRECTION / DUPLICATE_MERGE`。
- 同一 lineage 使用新的 current result 集合生成时，创建新 `report_id` 和递增 `report_revision`。
- BASE_ABILITY 的旧活动报告在新 `TASK_CLOSURE_CONFIRMED` 投影中退出活动状态；JOB_SKILL、合同修复和安全 replacement 则在对应新报告生成或安全修正事件中处理旧报告。每种路径的状态变化必须和其决定性事件在同一数据库事务内完成。
- 一个 lineage 在 `GENERATED / EXPORTED / LOCKED` 中最多存在一条活动报告，由 partial unique index 兜底；同一 `generation_key` 全局唯一。
- `REPORT_GENERATED` payload 必须携带完整内容、规范化键、版本、生成原因和 `superseded_report_ids`，保证回放能重建旧报告状态。
- 安全中止报告按 incident 幂等生成，不因后续普通重测自动 supersede。
- 历史报告不得物理删除。

## 6. 状态与异常合同

### 6.1 状态迁移

| 当前状态 | 允许动作 | 结果状态 |
|---|---|---|
| `GENERATED` | 导出成功 | `EXPORTED` |
| `GENERATED` | 锁定 | `LOCKED` |
| `EXPORTED` | 再次导出 | `EXPORTED` |
| `EXPORTED` | 锁定 | `LOCKED` |
| `LOCKED` | 导出 | 保持 `LOCKED` |
| `GENERATED / EXPORTED / LOCKED` | 同 lineage 新快照生成 | `SUPERSEDED` |
| `GENERATED / EXPORTED / LOCKED` | BASE_ABILITY 新教学轮次闭环确认 | `SUPERSEDED` |
| `GENERATED / EXPORTED / LOCKED` | 安全事实修正、重复归并 | `SUPERSEDED` |
| `GENERATED / EXPORTED / LOCKED` | 安全事实判定为误报/非安全事件，或任务闭环来源修正 | `ARCHIVED` |
| `SUPERSEDED` | 历史安全事实判定为误报/非安全事件，或历史任务闭环来源修正 | `ARCHIVED` |
| `SUPERSEDED / ARCHIVED / FAILED` | 查看 | 状态不变 |

补充规则：

- `report_content_json`、来源 ID、生成者和生成时间从创建起不可修改。
- `SUPERSEDED -> ARCHIVED` 只表示后续事件证明其来源事实无效或误配，不改写内容，也不把报告恢复为活动状态。
- 允许变化的字段只包括状态、安置复核元数据和最后一次成功导出的文件元数据，且必须由对应领域事件驱动。
- 非法状态迁移返回稳定错误，不写事件、不修改投影。
- `FAILED` 保留为历史兼容状态。新生成在快照落库前失败时只写 `error_event_log`，不创建带伪内容和伪 `REPORT_GENERATED` 事件的失败报告行。
- `contract_validation_status = REPAIR_REQUIRED` 不是新的生命周期状态。它只允许查看受控错误和执行 `CONTRACT_REPAIR`，禁止安置复核、锁定和导出；修复生成的 replacement 通过 validator 并标为 `VALID` 后才开放合法动作。

### 6.2 红线阻断

- 任一选中结果 `safety_overridden = 1`、来源 session 为 `REDLINE_HALTED`，或来源绑定红线 incident 时，`FULL_REPORT` 生成必须失败。
- 被红线影响的来源只能生成 `SAFETY_TERMINATION_REPORT`。
- 管理员后续解决或作废 incident 不改变历史红线 session，也不改写既有安全报告内容；报告生命周期按 §5.3 进入保留、`ARCHIVED` 或 `SUPERSEDED`。合法的新 session 可在新结果上生成新的普通报告。
- 阻断必须同时存在于领域服务和 schema guard，不能只靠按钮禁用。

### 6.3 失败与恢复

- 闭环来源不合法使用新增的 `TASK_CLOSURE_INVALID`；闭环确认后尚未生成、但来源已经不再 current 时使用 `STALE_REPORT_SOURCE`。两者都不得写领域事件。
- 报告生成失败使用现有 `REPORT_GENERATION_FAILED` 错误码，保留来源 result，并提供幂等重试。
- F7 新增语义明确的 `REPORT_EXPORT_FAILED` 错误码，避免把文件导出失败伪装成报告生成失败。
- 合法状态并发冲突使用新增的 `REPORT_STATE_CONFLICT`，页面重读最新状态后决定显示幂等成功还是要求用户重试。
- `REPORT_GENERATED`、`REPORT_LOCKED`、`REPORT_EXPORTED` 和 `PLACEMENT_REVIEW_CONFIRMED` 都必须有幂等恢复 reducer。
- `TASK_CLOSURE_CONFIRMED` 和 `TASK_CLOSURE_REPLACED` 都必须有幂等恢复 reducer，确保闭环确认、轮次水位和修正关系不会只存在 SQLite。
- JSONL 已写入但 SQLite 投影中断时，当前命令返回可恢复错误；冷启动恢复或同一命令重试必须先补投影，再返回原 `task_closure_id / report_id`。重复重放不能产生重复报告、重复 supersede 或重复状态副作用。
- 任一事件已追加但投影失败后，主进程立即进入写入阻断状态；在该事件补投影成功前不得接受新的闭环、结果或报告变更，避免恢复时的 current 校验被后续命令改变。
- 导出文件已写入但 `REPORT_EXPORTED` 未成功追加时，服务必须尽力删除临时文件；删除失败则把文件移入不对用户展示的 orphan 隔离目录并登记异常，不能把无事件文件视为正式导出。
- 报告快照存在但导出失败时，详情仍可打开，教师可重试导出。

### 6.4 并发与竞态

- Electron 主进程使用一个报告协调器和 keyed command queue，不新增第三方锁库。协调键按 `student_id + job_code + task_code + command_scope` 生成，`command_scope` 为 `BASE_ABILITY / JOB_SKILL / SAFETY`。
- BASE_ABILITY 队列必须覆盖 `confirmTaskClosure`、`replaceTaskClosure`、报告生成/修复、安置复核、锁定、导出完成和 supersede/archive；不能只串行化 `reports:*` 而遗漏闭环命令。
- JOB_SKILL 队列必须覆盖自动生成、教师重试/修复、锁定、导出完成和 supersede。
- SAFETY 队列必须覆盖 incident 创建、事实确认、解决、作废、事实修正、重复归并，以及安全报告生成/重试、锁定和导出完成。`SAFETY_INCIDENT_VOIDED / SAFETY_INCIDENT_REPLACED_FOR_FACTUAL_CORRECTION` 不得绕过该协调器直接写事件。
- 每个命令取得队列后、追加 JSONL 前必须重新读取最新 closure watermark、incident 状态、report 状态、content hash 和投影完成标记，再构造 payload。前置条件已变化时直接返回幂等结果或 `REPORT_STATE_CONFLICT`，不得先追加一个 reducer 注定无法应用的事件。
- SQLite 事务和唯一索引是最终一致性兜底：同一 `generation_key` 唯一，同一 lineage 最多一条活动报告，同一学生/岗位/任务最多一个活动闭环，result 的历史复用只能发生在直接 replacement 链。
- 两个并发生成或闭环确认请求只能一个创建事件和快照，另一个在队列内重读投影后返回同一对象或稳定冲突。
- 复核和锁定使用条件更新，只能从允许的旧状态进入目标状态；失败方重新读取后返回幂等成功或稳定的 `REPORT_STATE_CONFLICT`。
- 导出分为“准备”和“完成”两步：准备时固化 `report_id + content_hash + status`，写文件后在同一 lineage 队列中重新校验。若期间报告已经 `SUPERSEDED / ARCHIVED / FAILED`，不写 `REPORT_EXPORTED`，并清理或隔离该文件。

## 7. 与现有功能的接口关系

### 7.1 数据库

- 复用 `task_report`，不新建第二套报告内容表。
- 新增 `task_closure` 关联表，字段至少包括 `task_closure_id`、`student_id`、`job_code`、`task_code`、`cycle_no`、`closure_revision`、`status`、`is_cycle_head`、三类 result/source aggregate ID、`replaces_task_closure_id`、`replacement_task_closure_id`、`correction_reason`、`confirmed_by`、`confirmed_event_id` 和 `confirmed_at`。`status` 只允许 `CONFIRMED / SUPERSEDED`；三条 binding 和确认元数据不可更新或删除，只有 status、cycle-head 与 replacement 链字段可由闭环事件推进。
- 增加 `UNIQUE(student_id, job_code, task_code, cycle_no, closure_revision)`、每个 `cycle_no` 最多一个 `is_cycle_head = 1`，以及每组最多一条 `status = CONFIRMED` 的 partial unique index。replacement 只能指向该 cycle 当前 head。触发器必须校验结果类型、来源终态、学生/岗位/任务一致性、非红线状态；正常确认拒绝任何历史 result 复用，replacement 只允许复用直接旧版 result 或全新 result。
- `AggregateType`、`domain_event_projection.aggregate_type` 和异常关联类型增加 `TASK_CLOSURE`，事件 sequence 按 `TASK_CLOSURE + task_closure_id` 单调递增。
- `task_report` 增加可索引的 `lineage_key`、`source_set_hash`、`generation_key`、`content_hash`、`report_revision`、`report_schema_version`、`report_builder_version`、`generation_reason` 和 `contract_validation_status`。`contract_validation_status` 只允许 `VALID / REPAIR_REQUIRED`；`report_scope` 的内容事实仍以 `report_content_json` 为准，辅助列不得另造不同 scope。
- 增加 `UNIQUE(generation_key)`、`UNIQUE(lineage_key, report_revision)`，以及仅覆盖 `GENERATED / EXPORTED / LOCKED` 的 active lineage partial unique index。
- 复用 `result_record`、`assessment_session`、`assessment_sitting`、`training_session`、`safety_incident`、`safety_incident_binding` 和 `asset_resource`。
- 普通 `REPORT_GENERATED` 投影把对应来源 assessment 的 `is_report_generated` 置为 1，并写入实际 `report_type`；安全报告对 incident 绑定的 assessment 执行同样投影。该标记只表示至少生成过报告，不因报告后来 `SUPERSEDED` 而回退。
- 既有报告行采用“加 nullable 列、按历史内容回填、校验、再启用 guard”的迁移顺序；无法通过合同校验的旧报告标为 `REPAIR_REQUIRED`，不得伪造元数据完成回填。无法可靠恢复 builder 的旧行使用明确的 `legacy-unknown` 标识，且 legacy `generation_key` 只按 `report_id` 生成、永不作为幂等复用命中。若迁移发现同一 lineage 有多条活动旧报告，迁移必须 fail-closed 并列出冲突 report ID，不得静默选择最新一条。
- F7 实现阶段需要补状态迁移、内容不可变、scope-aware 安置复核导出和幂等约束；涉及 schema 时必须提供独立 migration、升级验证和回滚方案。
- 安置复核、锁定和导出必须同时有 domain guard 与 DB trigger 检查 `contract_validation_status = VALID`，不能只靠页面隐藏按钮。
- `source_result_ids_json` 与 `report_content_json` 写入前必须运行结构校验，不能只依赖 TypeScript 类型断言。

### 7.2 事件与恢复

- 新增 `TASK_CLOSURE_CONFIRMED`，使用 `aggregate_type = TASK_CLOSURE`；payload 必须携带闭环 ID、学生/岗位/任务、`cycle_no / closure_revision`、三类 typed result/source ID、确认人、确认时间、`superseded_task_closure_ids` 和 `superseded_report_ids`。
- 新增 `TASK_CLOSURE_REPLACED`，使用 `aggregate_id = new_task_closure_id`；payload 必须携带旧/新闭环 ID、相同 `cycle_no`、递增的 `closure_revision`、replacement 的 `status / is_cycle_head`、修正原因、复用与新增 result 清单、操作者、时间和 `archived_report_ids`。
- 复用并扩展 `REPORT_GENERATED`：增加枚举值为 `BASE_ABILITY / JOB_SKILL / SAFETY` 的 `report_scope`，以及 `report_revision`、`report_schema_version`、`report_builder_version`、`lineage_key`、`source_set_hash`、`generation_key`、`generation_reason`、可选 `task_closure_id / repair_of_report_id` 和 `superseded_report_ids`。
- 扩展 `PLACEMENT_REVIEW_CONFIRMED`：增加 `placement_advice_hash`，保证复核事件绑定实际快照中的建议。
- 扩展 `REPORT_LOCKED`：增加 `content_hash`、`status_before` 和固定的 `status_after = LOCKED`。
- 扩展 `REPORT_EXPORTED`：在既有格式、路径、时间和操作者之外，增加 `file_asset_id`、`file_hash`、`file_size_bytes`、`mime_type`、`content_hash`、`status_before` 和 `status_after`；锁定报告导出时 `status_after` 仍为 `LOCKED`。这些字段必须足以在恢复时重建对应 `asset_resource` 和最后一次导出元数据。
- 扩展 `SAFETY_INCIDENT_VOIDED`：`FALSE_TRIGGER / NON_SAFETY_EVENT` 携带 `archived_report_ids`，`DUPLICATE_RECORD` 携带 `superseded_report_ids` 和主 incident ID。
- 扩展 `SAFETY_INCIDENT_REPLACED_FOR_FACTUAL_CORRECTION`：携带根/旧/新 incident ID 和 `superseded_report_ids`，使旧安全报告在 replacement 尚未确认时也能确定性退出活动状态。
- 所有新增或扩展 payload 必须进入共享类型和运行时 validator；恢复器不得信任未经校验的 `Record<string, unknown>`。
- 事件写入顺序继续遵守 JSONL append、`domain_event_projection`、业务 reducer。
- 页面读取 SQLite 投影，恢复事实以 action log 为准。

### 7.3 IPC

F7 需要提供受主进程授权的报告 API，名称在实现文档中可按现有命名规范微调，但能力必须覆盖：

- `reports:list`
- `reports:get`
- `reports:listGenerationCandidates`
- `reports:confirmTaskClosure`
- `reports:replaceTaskClosure`
- `reports:generate`
- `reports:confirmPlacementReview`
- `reports:lock`
- `reports:export`

所有通道必须同步进入共享类型、preload 白名单和主进程注册。渲染进程不得直接读取 SQLite 或写导出文件。

`reports:generate` 使用判别联合输入：BASE_ABILITY 只接受 `task_closure_id`，JOB_SKILL 只接受 `result_id`，安全报告只接受 `incident_id`。多余或跨 scope 的来源字段必须被运行时 validator 拒绝。

### 7.4 页面与导航

- 新增教师路由 `/teacher/reports`。
- 新增教师路由 `/teacher/reports/:reportId`。
- 教师首页既有报告入口跳转到列表。
- 详情页共享报告外壳，按安全中止、JOB_SKILL、BASE_ABILITY 的优先级装配内容区，不复制三套整页。
- 前端状态从 IPC 加载，不引入前端持久化库。

### 7.5 结果与训练

- F7 只读取 F6 已生成的四类结果，不修改评分算法。
- 基础报告并列展示三类任务闭环结果；JOB_SKILL 报告只读取 `JOB_SKILL_SCORE`。
- M2 训练链接只跳转到现有“拆箱与上架”入口；其他模块没有可点击的虚假入口。

## 8. 功能范围

### 8.1 本次做什么

- 统一报告列表、详情、候选生成、失败重试、复核、锁定和 HTML 导出。
- 增加基础任务报告所需的最小 `task_closure` 确认与恢复能力。
- 增加误配闭环的可审计 replacement 路径，不原地改 binding。
- 实现 BASE_ABILITY 完整报告、JOB_SKILL 报告和安全中止报告的统一快照服务。
- 完整定义报告 JSON 运行时校验和直接渲染分支。
- 补齐报告事件投影、恢复重放、supersede 和权限门禁。
- 展示版本、来源、坐次、安全、效度和支持信息。
- 使用测试夹具和临时数据库验证，不写真实运行数据库。

### 8.2 本次不做什么

- 不激活 BASE_ABILITY 96 题或 JOB_SKILL 298 题，不生成激活 SQL。
- 不输出正式就业安置结论，不把 Pilot 报告升格为正式测评报告。
- 不实现 AI 岗位推荐、AI 最终录用或淘汰裁决。
- 不实现 PDF 报告渲染、Markdown 报告渲染或报告模板编辑器。
- 不实现完整非脱敏导出、云端分享、家长端、企业端或学生完整报告页。
- 不建立覆盖所有业务流程的通用 task-cycle 聚合；F7 只增加报告所需、binding 不可原地修改的 `task_closure` 关联事实。
- 不修改 F6 的评分公式、阈值、结果类型或双轨隔离规则。

## 9. 成功验收标准

### 9.1 列表、权限和页面状态

1. 教师可以从首页进入报告列表，按学生、范围、类型、状态和日期筛选。
2. 教师可以打开一个持久化报告详情；重复打开不会生成新报告。
3. STUDENT 和 ADMIN 通过路由或直接 IPC 访问 F7 报告能力均被拒绝，且不泄露报告内容。
4. 加载、空数据、无权限、阻断、可重试错误和成功状态都有稳定页面反馈。
5. 1280x720、1366x768 和 375px 宽度下无文字遮挡、按钮溢出和状态切换跳动。

### 9.2 生成、幂等与历史

1. 三类合法 current 结果经教师确认后生成一条 binding 不可变的活动 `task_closure`；从该闭环生成一条 `task-report-v1.1` 完整报告。
2. 少一类结果、重复结果类型、学生/岗位/任务不一致、非终态、红线来源、混入 JOB_SKILL 或已有闭环绑定时，闭环确认失败且不写事件。
3. BASE_ABILITY 生成 IPC 直接提交三条 result ID、伪造闭环 ID，或把两个已确认教学轮次的结果交叉组合时被拒绝。
4. 正常新轮次递增 `cycle_no` 并淘汰旧活动闭环；旧闭环即使从未生成报告也不能越过水位补生成。
5. 闭环误配通过 `TASK_CLOSURE_REPLACED` 在同一 `cycle_no` 创建新 cycle head，可复用直接旧版中的正确结果，但不能复用其他历史轮次；已有错误报告进入 `ARCHIVED`。当前轮 replacement 可生成报告，历史轮 replacement 保持 `SUPERSEDED` 且不能越过水位。
6. 合法的 current `JOB_SKILL_SCORE` 生成一条 `report_scope = JOB_SKILL` 的报告。
7. 相同来源、schema、builder 和有效合同重复生成只返回原 `report_id`。
8. 相同 JOB_SKILL result 的旧快照缺少强制区块或元数据时，以 `CONTRACT_REPAIR` 生成新 revision 并淘汰旧报告，不返回无效快照。
9. `REPAIR_REQUIRED` 旧报告只能显示受控错误并执行 repair；复核、锁定和导出经 IPC 直调与数据库写入均被阻断。replacement 为 `VALID` 后才恢复操作。
10. 新 current 结果集合生成新快照，旧活动报告进入 `SUPERSEDED`，旧内容和来源 ID 不变。
11. 生成故障记录异常并显示重试入口；故障解除后重试只生成一个活动快照。
12. 应用重启和事件重放后仍能读取同一 `task_closure_id / report_id`、内容和历史状态。

### 9.3 内容和解释边界

1. BASE_ABILITY 报告通过 `task-report-v1.1` 运行时校验，包含证据类型、效度限制、支持摘要和安置建议状态。
2. 三类基础任务结果完整进入 `source_meta.task_result_snapshots` 并并列展示，不形成单一总分。
3. 模块兜底显示触发模块，情绪崩溃兜底显示次数和每次坐次/时间。
4. `completion_ratio < 1` 显示“过程分”和终止原因，不输出安置方向。
5. JOB_SKILL 报告展示 M1-M6、线上与线下对比、支持等级、教师观察、训练重点和效度限制。
6. 观察缺失显示观察完成度不足，不伪装为 0 分。
7. JOB_SKILL 不输出就业安置结论，不把岗位模块解释为基础能力模块。
8. M2 低分可以链接现有训练；未实现训练模块只有文案，无虚假链接。
9. NR、ST、帮助次数、休息请求和响应速度均按权威解释边界展示，不被单独解释为能力高低。
10. `pilot_mode = true` 的基础报告快照含 `PILOT_ONLY` 机器字段，页面与 HTML 固定显示试测免责声明，且渲染参数无法关闭。
11. JOB_SKILL 报告固定显示 `MVP_DEMO_PROFILE_ONLY` 免责声明。
12. 报告生成后切换来源 result 的 `is_current`、生成同 source 新结果或升级策略，历史详情和 HTML 导出的三类数值、等级与时间保持不变。

### 9.4 安全红线

1. 红线来源生成 `FULL_REPORT` 被领域服务和 schema 双重阻断。
2. `PENDING_DETAIL` 不生成报告；教师确认后按 incident 幂等生成通过 `safety-termination-report-v1.0` 校验的报告。
3. `PENDING_DETAIL -> VOIDED` 的确认前误报或重复记录不生成安全报告。
4. 没有开放会话、binding 或 result 的已确认 incident 可生成 `source_scope = NO_BOUND_SESSION` 的安全报告，session 元数据为空数组且不伪造版本。
5. 只绑定 `TRAINING_SESSION` 的 incident 可生成安全报告，固化训练 step、素材和时间，但不因没有题库、评分器或 assessment sitting 被阻断。
6. 有绑定的安全报告固化所有绑定对象的前后状态和红线前过程记录，但不形成普通达标或就业安置结论。
7. 安全报告和安全覆盖结果始终显示 `LEVEL_FAIL_BY_SAFETY`，普通分数不能覆盖。
8. 自动生成失败后 incident 先进入 `RESOLVED`，仍可凭确认事实重试成功；当前为 `VOIDED` 时不可重试。
9. `FALSE_TRIGGER / NON_SAFETY_EVENT` 使既有报告进入 `ARCHIVED`；未生成的报告候选消失。
10. `FACTUAL_CORRECTION` 立即淘汰旧报告，replacement 经确认后生成关联的替代报告；旧内容保持不变。
11. `DUPLICATE_RECORD` 归并到主 incident，重复 incident 的报告进入 `SUPERSEDED`。

### 9.5 复核、锁定和导出

1. 含实际安置建议但未执行 `PLACEMENT_REVIEW_CONFIRMED` 的报告不可导出。
2. 复核后详情和导出包含复核人、复核时间和固定免责声明。
3. `placement_advice.enabled = false` 的 JOB_SKILL、Pilot 或未完成报告不被错误要求安置复核。
4. 锁定前显示二次确认；锁定成功写 `REPORT_LOCKED`，重复锁定幂等。
5. 默认脱敏 HTML 可导出，导出内容与详情快照一致，写 `REPORT_EXPORTED`、操作者、路径、hash 和独立 `REPORT_FILE` asset；再次导出不会覆盖旧 asset 审计记录。
6. 用户取消保存不记失败；真实导出失败记录异常，不删除或改写报告快照。
7. `LOCKED` 报告可再次导出但内容不变；`SUPERSEDED / ARCHIVED / FAILED` 只读不可导出。

### 9.6 版本、坐次和恢复

1. 报告显示真实策略、题库批次、题目版本、素材 ID/hash、评分器和报告 schema 版本。
2. 一坐次和多坐次报告均显示实际坐次数、时间和结束方式，不允许固定写 2。
3. `TASK_CLOSURE_CONFIRMED`、`TASK_CLOSURE_REPLACED` 和 `REPORT_GENERATED` 重放可恢复轮次水位、修正链、完整内容和 supersede/archive 关系。
4. `REPORT_LOCKED`、`REPORT_EXPORTED`、`PLACEMENT_REVIEW_CONFIRMED` 重放幂等并恢复相同投影与文件 hash 元数据。
5. JSONL 写入成功、SQLite reducer 人为失败后，重启或重试能补齐投影，且不产生第二个闭环、报告、复核或锁定事件。
6. `REPORT_GENERATED` 投影与重放均正确恢复来源 assessment 的 `is_report_generated / report_type`。
7. 报告生成耗时不超过 PRD §17.3 的 3 秒要求。

### 9.7 并发与内容安全

1. 两个并发生成请求只产生一个活动报告和一个有效 `generation_key`，没有双活动快照。
2. 复核、锁定、导出完成与新 revision supersede 并发时，结果满足状态机；不存在已淘汰报告被新导出或事件无法重放的状态。
3. 两个并发闭环确认，或闭环确认与 replacement 并发时，只有队列内重读后仍合法的命令写事件，不能重复占用 result 或产生两个活动 closure watermarks。
4. 安全报告生成/重试与 `SAFETY_INCIDENT_VOIDED / SAFETY_INCIDENT_REPLACED_FOR_FACTUAL_CORRECTION` 并发时，只形成一种合法顺序；JSONL 中不存在当前状态下无法投影的后续事件。
5. 包含 `<script>`、事件属性、`javascript:` URL 和 HTML 标签的姓名、备注、题目与观察夹具在页面和导出中只显示为文本。
6. 导出 HTML 不含脚本和外部请求，CSP 存在，文件 hash 与 `REPORT_EXPORTED.file_hash` 一致。

### 9.8 验证命令

F7 实现完成前必须通过：

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run docs:index:check
git diff --check
```

涉及 schema 时增加全新库、升级库、回滚和 `PRAGMA foreign_key_check / integrity_check` 验证；涉及 UI 与导出时增加真实 Electron 的桌面和小屏见证。

本 Mini-PRD 新增后先通过：

```bash
npm run docs:index:update
npm run docs:index:check
git diff --check
```

## 10. 风险点与已知偏差

- [!] **安置复核 guard 过宽。** 当前 `trg_task_report_placement_review_export_*` 对所有 `FULL_REPORT` 要求复核；权威 PRD §5.8.3 又明确 JOB_SKILL 不含就业安置建议。F7 必须按 `placement_advice.enabled` 和实际建议进行 scope-aware 判断，不能让 JOB_SKILL、Pilot 或未完成过程报告被错误阻断。
- [!] **JOB_SKILL JSON 合同未完全对齐。** 权威 PRD §5.8.3 要求 `online_knowledge_summary`、`offline_performance_summary` 和 `administration_summary`，当前 `ReportContentJobSkill` 与生成器缺少这些区块。F7 必须同步共享类型、运行时 validator、生成器和渲染器。
- [!] **版本和坐次存在硬编码。** 当前 JOB_SKILL 生成器固定 `sitting_count = 2`、评分器和内容版本常量，无法证明历史事实。F7 必须从实际坐次、策略、题目来源和运行时版本读取并固化。
- [!] **报告生命周期不能完整重放。** 当前恢复器只处理 `REPORT_GENERATED`，遇到锁定、导出或安置复核事件会缺少专用 reducer。F7 未补齐前不能宣称报告状态可由 JSONL 重建。
- [!] **失败路径不可审计。** 当前 JOB_SKILL 报告生成异常只写 `console.error`。F7 必须写 `error_event_log` 并提供受控重试，不能把结果已生成但报告永久缺失当成成功。
- [!] **三结果闭环缺少统一关联键。** `business_session` 目前一条只对应一个 assessment 或 training，无法天然证明三类基础任务结果属于同一教学轮次。F7 必须先落地事件化、binding 不可原地修改的 `task_closure` 教师确认事实，报告生成不得直接接收三条 result ID。该确认能证明教师对本轮闭环的业务认定，但不能自动推断教学计划关系；若后续要求全自动归组，需要在上游会话创建阶段引入通用 task-cycle 聚合。
- [!] **安全报告没有独立内容合同。** 当前共享类型只覆盖宽松的 BASE 报告和 JOB_SKILL 报告，无法校验安全事件事实、绑定前后状态与修正链。F7 必须增加 `safety-termination-report-v1.0` 类型和运行时 validator；incident 必须曾经 `CONFIRMED`，当前为 `CONFIRMED / RESOLVED` 时才可生成或重试。
- [!] **现有幂等会固化无效 JOB_SKILL 快照。** 当前生成器按来源查到报告即可复用，但现有内容缺少权威 PRD 要求的区块和真实元数据。F7 必须把 validator、schema 版本和 builder 版本纳入复用条件，并提供 `CONTRACT_REPAIR` revision。
- [!] **报告事件 payload 缺少恢复所需事实。** 当前 `REPORT_EXPORTED` 不含文件 hash，其他生命周期事件也没有 content hash、状态前后值、lineage 或 revision。F7 必须按 §7.2 扩展共享类型和运行时校验后再开放页面操作。
- [!] **状态并发保护不足。** 当前 `task_report` 没有完整的内容冻结、合法迁移和 active lineage 唯一约束。实现阶段必须用事务、schema guard 和并发测试保证两个生成或锁定请求不会产生双活动快照或丢失状态。
- 最脆弱假设：一个由教师确认的 `task_closure` 足以表达 F7 的基础任务报告轮次，而不需要重构所有上游 session 创建流程。若试测证明教师无法可靠判断三个来源是否同轮，必须先把通用 task-cycle 关联前移到会话创建阶段，不能退回“取最新三条结果”的静默拼接。
