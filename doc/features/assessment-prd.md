# 5.4 测评功能 Mini-PRD

**工程基线**：schema v0.1.9-strategy-composite-pk | PRD v1.0.5 | 事件溯源架构首次大规模实战
**前置依赖**：5.1 学生档案（已交付）、5.2 strategy_config（已交付）
**未交付依赖（明确边界）**：5.3 题库与资源（未交付）、线下实操评分（拆为独立功能）、5.8 报告（未交付）

---

## 功能名称

5.4 测评功能 —— 基础能力评估**线上 42 题**答题闭环 + 等级判定服务。

---

## 解决的问题

1. **PRD 闭环第一环**：测评 → 训练 → 评分 → 报告的入口，没有测评结果就没有后续训练分流与报告输入。
2. **strategy_config 首次落地为运行时行为**：5.2 交付的组卷规则、阈值、兜底配置需要被一个真实消费者读取并执行，否则策略配置只是死数据。
3. **事件溯源架构首次大规模实战**：学生答题是高频、可中断、需可回放的行为事实，必须写入 `action_log.jsonl`（不是 `error_event_log`），是验证 writeEvent + reducer + 投影一致性的关键场景。

---

## 用户角色

| 角色 | 在 5.4 的职责 |
|---|---|
| **TEACHER** | 发起测评（选学生 + 岗位 + 任务 + BASELINE_ASSESSMENT 策略版本）、触发安全红线、决定情绪中断后恢复或终止、查看进行中测评 |
| **STUDENT** | 逐题答题、提交答案、"我遇到困难了"情绪中断按钮 |
| **SYSTEM** | 组卷、checksum 计算、事件写入、投影更新、等级判定、兜底触发 |
| **ADMIN** | 不直接参与（策略已由 5.2 配置）；ADMIN 可代教师触发红线（schema trigger 允许 TEACHER/ADMIN） |

---

## 核心使用场景（流程步骤）

### 主路径：正常完成线上 42 题

1. TEACHER 在发起测评页选学生 + 岗位 + 任务 + 策略版本（默认 active 的 BASELINE_ASSESSMENT）。
2. 系统校验：学生 ACTIVE + 无同 `student+task+strategy_type` 开放 session（partial unique index 强制）+ 无未解决安全事件（trigger 强制）。
3. 系统按 `strategy_config.question_policy_json` 组卷：TRUE_FALSE 14 + SINGLE_CHOICE 14 + DRAG 14 = 42 道线上题，按 `required_modules` 均衡 6 模块。
4. 写 `SESSION_STARTED` 事件 + 插入 `assessment_session`（INIT）+ **50 行 `assessment_session_question`**（42 行 question_phase=ONLINE + 8 行 question_phase=OFFLINE）。组卷时 50 道题一次性确定并落盘，线下评分独立功能只补 `offline_score_record`，不重新插 assessment_session_question。
5. session 转 ACTIVE，STUDENT 逐题答题。
6. 每题提交：写 `ANSWER_SUBMITTED` 事件 + 插入 `answer_record`（status=VALID, revision_no=1）+ 更新 `assessment_session.online_completed_count` + `current_question_id` 前移。
7. 第 42 题提交后：写 `SESSION_COMPLETED` 事件（has_pending_offline=true，因 `requires_offline_scoring=1`）+ session 转 `OFFLINE_PENDING`（等待线下评分独立功能）。

### 情绪中断/崩溃路径

8. STUDENT 按"我遇到困难了" → 写 `EMOTION_INTERRUPTED` + session 转 `EMOTION_INTERRUPTED` + 记录 `current_question_order`。
9. TEACHER 决定：
   - **恢复** → 写 `EMOTION_RESUMED` + session 回 ACTIVE + 从中断题继续（不计崩溃）。
   - **终止** → 不写 EMOTION_RESUMED，计为一次崩溃；累计崩溃数 +1。
10. 累计崩溃数 = `strategy_config.emotion_collapse_threshold`（默认 3）→ 系统写 `EMOTION_COLLAPSE_THRESHOLD_REACHED` + 写 `SESSION_ABORTED`（aborted_by=TEACHER）+ session 转 ABORTED + 触发等级判定 → `LEVEL_NOT_COMPETENT`（level_forced_by=EMOTION_COLLAPSE）。

### 安全红线路径（schema 批量熔断）

11. TEACHER/ADMIN 触发红线（选 reason_code + context_phase=ONLINE_ASSESSMENT + 描述）。
12. 写 `SAFETY_INCIDENT_CREATED` 事件 → 插入 `safety_incident`（PENDING_DETAIL）。
13. schema trigger `trg_safety_incident_bind_open_assessments` 自动：绑定所有同 `student+task` 开放 session + 批量 UPDATE 到 `REDLINE_HALTED` + `level_result=LEVEL_FAIL_BY_SAFETY` + `report_type=SAFETY_TERMINATION_REPORT`。
14. 写 `REDLINE_TRIGGERED` 事件（aggregate_id=session_id）。
15. 触发等级判定服务 → 落盘 `result_record`（safety_overridden=1, level_result=LEVEL_FAIL_BY_SAFETY, redline_incident_id 填充）+ 写 `RESULT_CALCULATED` 事件。

### 异常退出恢复路径

16. 测评中强关应用 → 重启后读 `domain_event_projection` 重建 session 状态，恢复到最后一道已提交题之后（current_question_id 的下一题）。
17. action_log 末尾损坏 → 截断损坏尾行（RECOVERY_LOG_TRUNCATED）。

---

## 功能范围

### 本次做

**共享层（一致性补缺）**
- 补 `src/shared/types/event-payloads.ts`：
  - `EventType` 联合类型加 `EMOTION_COLLAPSE_THRESHOLD_REACHED`；新增 `EmotionCollapseThresholdReachedPayload` + `CollapseRecord` interface（对齐事件规范 §2.9）。
  - 新增 `AbilityScorePayload` + `ModuleScore` interface（对齐 JSON 字段规范 §10）——红线 result_record 落盘时 `result_payload_json` 需要 TS 类型，当前缺失。
- 扩展 `assertCaller`（或新建 `assertStudent`）支持 STUDENT 答题身份校验路径。

**领域层**
- `src/main/domain/`：
  - 组卷服务 `paper-generator.ts`（纯函数：strategy_config + question_bank → question_ids 列表，含模块均衡）。
  - 等级判定服务 `level-judge.ts`（纯函数：scores + collapse_count + safety_triggered → {level_result, level_forced_by, module_veto_triggered_by}）。
  - reducer 雏形 `assessment-reducer.ts`（writeEvent 后 UPDATE assessment_session / answer_record / assessment_session_question 投影）—— 或在 handler 内直接 UPDATE，二选一（见风险点 4）。

**事件写入协议（所有 assessment handler 硬约束，对齐 AGENTS.md）**：
1. 生成 payload
2. 计算 checksum: `SHA-256(JSON.stringify(payload))`
3. 分配 event_id (UUID v4) + event_sequence（aggregate 内递增）
4. 追加写入 `action_log.jsonl`
5. 写入 `domain_event_projection`
6. 调用 reducer 更新业务投影表

reducer 必须是**幂等的**：同一事件重放不产生副作用（冷启动从 jsonl 回放时复用同一 reducer，重复执行不能导致 online_completed_count 翻倍、answer_record 重复插入等）。实现要点：reducer 先 SELECT 检查投影当前状态，已应用则 no-op。

**IPC handler 层**
- `src/main/ipc/handlers/assessment.ts`：`assessment` 命名空间纯函数 + register 函数，模式对齐 strategy.ts / student.ts。
  - `assessment:createSession`（TEACHER）—— 组卷 + 写 SESSION_STARTED + 插投影。
  - `assessment:getSession`（TEACHER/STUDENT）—— 读 session + 已答题 + 进度。
  - `assessment:submitAnswer`（STUDENT）—— 写 ANSWER_SUBMITTED + 插 answer_record + UPDATE 投影。
  - `assessment:emotionInterrupt`（STUDENT）+ `assessment:emotionResume`（TEACHER）。
  - `assessment:abortSession`（TEACHER）—— 含崩溃终止路径。
  - `assessment:triggerRedline`（TEACHER/ADMIN）—— 写 SAFETY_INCIDENT_CREATED + REDLINE_TRIGGERED，schema trigger 自动熔断。
  - `assessment:calculateResult`（SYSTEM/TEACHER 触发）—— 仅红线场景落盘 result_record（LEVEL_FAIL_BY_SAFETY 不依赖线下分）。
- seed 错误码到 `error_code_registry`（IPC/FSM/SCORING/AOL 类别）。

**渲染层**
- `src/renderer/src/views/student/AssessmentView.vue`：答题页（当前题 + 进度 + "我遇到困难了"按钮 + 提交）。
- `src/renderer/src/views/teacher/AssessmentCreateView.vue`：发起测评页（选学生+岗位+任务+策略版本）。
- `src/renderer/src/views/teacher/AssessmentListView.vue`：进行中测评列表 + 继续/终止/触发红线操作。
- `src/renderer/src/stores/assessment.ts`：Pinia store。
- router 注册 `/student/assessment/:sessionId` + `/teacher/assessments/*`。

### 本次不做（明确边界）

| 不做项 | 原因 | 后续承接 |
|---|---|---|
| **题库 seed / CSV 导入 / asset_resource 校验** | 用户决策：5.4 只做逻辑，seed 留给 5.3 | 5.3 题库与资源 |
| **线下 8 题 OFFLINE_OPERATION 评分** | 用户决策：拆为独立功能（PRD §17.1 实操评分独立验收段） | 线下实操评分独立功能 |
| **OPERATION_PASS_RATE result_record** | 依赖线下分数 | 线下实操评分独立功能 |
| **完整 ABILITY_SCORE result_record 落盘（非红线场景）** | 综合分需线下 8 题分数；5.4 完成后 session 停在 OFFLINE_PENDING。PRD §17.1 "测评完成后生成 ABILITY_SCORE" 条目由线下实操评分功能验收，5.4 只验收 §17.6.1 兜底专项 + 红线 result_record 落盘 | 线下实操评分独立功能补全后触发 RESULT_CALCULATED |
| **报告生成 task_report** | 独立功能 | 5.8 报告 |
| **训练** | 独立功能 | 5.5 训练 |

### 等级判定服务的可验证性（关键设计）

等级判定服务作为**纯函数 + 完整单测**交付，覆盖 PRD §17.6.1 全 9 条兜底场景。这样即使 5.4 阶段完整 ABILITY_SCORE 不落盘（等线下评分），等级判定算法本身也独立可验证：

```typescript
judgeLevel(params: {
  moduleScores: { module: AbilityTag; raw: number; max: number }[]
  emotionCollapseCount: number
  emotionCollapseThreshold: number
  moduleVetoThreshold: number
  competentThreshold: number
  conditionalThreshold: number
  safetyTriggered: boolean
}): {
  levelResult: 'LEVEL_COMPETENT' | 'LEVEL_CONDITIONAL' | 'LEVEL_NOT_COMPETENT' | 'LEVEL_FAIL_BY_SAFETY'
  levelForcedBy: 'MODULE_VETO' | 'EMOTION_COLLAPSE' | null
  moduleVetoTriggeredBy: AbilityTag | null
  normalizedScore: number
}
```

红线场景（safety_triggered=true）落盘 `LEVEL_FAIL_BY_SAFETY` result_record 作为 5.4 的可见端到端输出。

**moduleScores 的线上线下语义（5.4 阶段）**：PRD §7.4 "线上模块与线下模块分别计算"。5.4 阶段线下 8 题 OFFLINE_OPERATION 未评分，`judgeLevel` 的 `moduleScores` 入参**仅含线上 6 模块分**（OFFLINE_OPERATION 题按复合 ability_tags 归入对应模块，5.4 阶段这些题未评分不计入）。线下评分功能补全后，等级判定服务需重新调用以纳入线下模块分。单测的 mock moduleScores 应明确标注"仅线上分"。

---

## 边界条件和异常处理

| 场景 | 处理 |
|---|---|
| 题库为空 / 不足组卷（5.3 未交付的现实情况） | `createSession` 返回 `QUESTION_BANK_INSUFFICIENT`；组卷算法单测用 mock question_bank 数据 |
| 重复发起（同学生+任务+策略类型已有开放 session） | schema partial unique index 阻止 → handler 捕获 UNIQUE 冲突返回 `SESSION_ALREADY_OPEN` |
| 未解决安全事件阻断新会话 | schema trigger `trg_assessment_session_block_unresolved_safety_incident` 强制 → handler 返回 `BLOCKED_BY_SAFETY_INCIDENT` |
| STUDENT 重复提交同一题 | answer_record `ux_answer_record_one_valid_answer`（partial unique，status=VALID）阻止；最小版本返回 `ALREADY_ANSWERED`，不实现 SUPERSEDE revision 机制（留给后续） |
| STUDENT 提交不属于本 session / 越权的 question_id | 返回 `QUESTION_NOT_IN_SESSION` |
| STUDENT 提交非本人名下 session 的答案（session.student_id !== caller.user_id） | 返回 `FORBIDDEN`；assertStudent 必须校验 session 归属，防越权答题 |
| 非 ACTIVE 态 session 接收答题/中断事件 | 返回 `SESSION_NOT_ACTIVE`；schema trigger 终态保护兜底 |
| EMOTION_INTERRUPTED 超时（学生长时间不恢复） | **5.4 不实现自动超时**；教师手动终止即可（PRD §4.4 教师决定恢复/终止）。后续如需超时自动终止再独立迭代 |
| 红线触发中（REDLINE_HALTED）的 session 接收任何事件 | 返回 `SESSION_HALTED`；schema trigger 终态不可转出兜底 |
| EMOTION_INTERRUPTED 态直接提交答案 | 返回 `SESSION_PAUSED`；必须先 EMOTION_RESUMED |
| emotion_collapse_threshold = 1（极端配置） | 单次中断未恢复即触发崩溃兜底；算法按配置值，不硬编码 3 |
| 组卷时 sensory_filter_mode=STRICT 且无可用低刺激题 | 返回 `QUESTION_BANK_INSUFFICIENT`（5.3 未交付，5.4 单测覆盖逻辑分支即可） |
| 异常退出后 action_log 末尾损坏 | 截断损坏尾行（RECOVERY_LOG_TRUNCATED 事件）；恢复后从 domain_event_projection 重建 session |
| writeEvent 写 JSONL 失败（磁盘满/权限） | 返回 `SYSTEM_ERROR` + 写 error_event_log（AOL_APPEND_FAILED）；不更新投影（保证 jsonl 是事实来源） |
| checksum 计算与 payload 不一致 | writeEvent 内部 SHA-256(JSON.stringify(payload)) 保证一致；reducer 不重算 |

---

## 与现有功能的接口关系

| 现有功能 | 接口 | 方向 |
|---|---|---|
| **strategy_config（5.2）** | `assessment:createSession` 调 `strategy:get(strategyId, version)` 读 `question_policy_json` + 阈值 + `requires_offline_scoring`；session 锁定 `(strategy_id, strategy_version)`；schema v0.1.9 复合 FK 强制 | 读 |
| **student_profile（5.1）** | `createSession` 校验 student_id 存在且 ACTIVE | 读 |
| **question_bank（5.3，未交付）** | 组卷算法读 ACTIVE 题目；5.3 未交付 → 单测 mock，端到端验证推迟 | 读（依赖） |
| **event-writer** | 复用 `writeEvent`；扩展 reducer / handler 内 UPDATE 业务投影 | 调用 |
| **auth-context** | 扩展支持 STUDENT 答题路径（当前 assertCaller 只允 TEACHER/ADMIN） | 扩展 |
| **result_record 投影** | 红线场景落盘（safety_overridden=1, LEVEL_FAIL_BY_SAFETY）；ux_result_record_one_current_per_source_type 保证唯一 | 写 |
| **safety_incident + trigger** | triggerRedline 写 incident → schema trigger 自动批量熔断 + binding | 写 + 被 trigger 影响 |

---

## 成功验收标准

映射 PRD §17.1 测评 + §17.6.1 兜底专项 + §17.4 恢复：

### 功能验收（§17.1 测评）
1. 教师可发起基础能力评估（`assessment:createSession` 成功，组出 42 道线上题）。
2. 学生可完成线上 42 题答题（每题 `ANSWER_SUBMITTED` 事件 + `answer_record` 行）。
3. 每题提交后 `action_log.jsonl` 追加一行（事实来源）。
4. 中断测评可恢复（关闭应用重启后从最后一道已提交题之后继续，已提交答案不丢失）。
5. 红线触发后 session 进入 `REDLINE_HALTED` + `LEVEL_FAIL_BY_SAFETY` result_record 落盘。

### 兜底专项验收（§17.6.1，等级判定服务单测全覆盖）
6. 总分 >= 80 但任一模块得分率 < 50% → `LEVEL_NOT_COMPETENT`（MODULE_VETO）。
7. 总分 >= 80 且无兜底 → `LEVEL_COMPETENT`。
8. 总分 60-79 且无兜底 → `LEVEL_CONDITIONAL`。
9. 总分 < 60 → `LEVEL_NOT_COMPETENT`。
10. 累计情绪崩溃达阈值 → `LEVEL_NOT_COMPETENT`（EMOTION_COLLAPSE）。
11. 单次情绪中断恢复 → 不计崩溃，不影响等级。
12. 安全红线 → `LEVEL_FAIL_BY_SAFETY`，优先级高于模块/情绪兜底。
13. 模块兜底触发时 `module_veto_triggered_by` 字段标识具体模块。
14. 情绪兜底触发时 `emotion_collapse_count` 与每次崩溃时间持久化。

### 一致性保护验收（§17.7 5.4 相关子集）
15. `assessment:createSession` 使用不存在的 `strategy_version` 应失败（schema trigger `trg_assessment_session_strategy_config_match_insert` + handler 前置校验）。
16. `strategy_id / strategy_type / job_code / strategy_version` 任一与 `strategy_config` 不匹配时 createSession 应失败。
17. session 不可直接 INSERT 为 REDLINE_HALTED（schema trigger `trg_assessment_session_no_insert_redline_status` 拦截，红线只能经由 safety_incident 批量熔断路径）。
18. REDLINE_HALTED session 的 redline_incident_id 必须属于同 student + 同 task（schema trigger `trg_assessment_session_redline_incident_same_student_task_*` 强制）。
19. 终态 session 不可转出（schema trigger `trg_assessment_session_no_terminal_status_change` 强制）。

### 数据验收（§17.2 相关）
20. `action_log.jsonl` 是事实来源，SQLite 投影可由事件回放恢复。
21. 终态 session 不可直接修改（schema trigger 强制）。
22. 同学生同任务重复创建开放 assessment_session 应失败（partial unique index）。
23. `safety_overridden` 与 `LEVEL_FAIL_BY_SAFETY` 强约束一致（schema trigger 强制）。

### 性能验收（§17.3 相关）
24. 答题持久化（submitAnswer IPC 含 JSONL 写入 + 投影 UPDATE）≤ 500ms。

### 恢复验收（§17.4）
25. 测评中强制关闭应用，重启后可恢复到最后一道已提交题之后，已提交答案不丢失。

---

## 风险点（[!] 高风险项）

1. **[!] 事件溯源首次大规模实战**：writeEvent 已实现但**不更新业务投影表**（assessment_session / answer_record / assessment_session_question），5.4 必须建立 reducer 层。决策点：独立 reducer 文件 vs handler 内 UPDATE。事件/投影一致性是架构核心，出错会导致 jsonl 与 SQLite 漂移。**必须 /vibe-review 双审查**。

2. **[!] FSM + 红线批量熔断**：状态迁移路径多（INIT→ACTIVE→EMOTION_INTERRUPTED→ACTIVE / →ABORTED / →REDLINE_HALTED / →OFFLINE_PENDING / →COMPLETED），红线批量熔断由 schema AFTER INSERT trigger 自动执行（写 binding + UPDATE session）。应用层必须正确驱动事件顺序，错误顺序会导致 trigger ABORT 或投影/事件不一致。**必须 /vibe-review**。

3. **[!] STUDENT 身份校验**：当前 `assertCaller` 只允 TEACHER/ADMIN。学生答题需扩展权限模型。PRD 已记录"无 session token，caller 身份由渲染进程传入，无法防伪造 callerRole 的恶意渲染进程"——这是已知架构风险，5.4 不解决，但 STUDENT 路径必须加（否则学生无法答题）。

4. **[!] reducer 层位置**：writeEvent 后的投影更新，两种模式：
   - A. 独立 `assessment-reducer.ts`，handler 调 writeEvent 后调 reducer（解耦，可复用于冷启动回放）。
   - B. handler 内直接 UPDATE（简单，但冷启动回放需另写）。
   推荐方案 A（事件溯源架构的 reducer 本就应可复用于回放），但增加复杂度。Mini-PRD 选 A，Reviewer 审查确认。

5. **[!] 组卷算法的模块均衡**：PRD §5.4 + strategy seed 要求"6 模块 × 7 题"。组卷算法需在 4 种题型（TF/SC/DRAG/OFFLINE_OPERATION）× 6 模块矩阵中均衡抽取，且需支持 sensory_filter（5.3 未交付时单测 mock）。算法复杂度中等，需独立单测。

6. **[!] answer_record revision 机制**：PRD §5.4 产品规则"学生提交后的答案不得直接覆盖，必须通过 revision 机制"。最小版本是否禁止重复提交（返回 ALREADY_ANSWERED）vs 实现 SUPERSEDE 机制（旧记录 status=SUPERSEDED + 新记录 revision_no+1）。Mini-PRD 选最小版本（禁止重复），SUPERSEDE 留给后续。Reviewer 确认是否满足 PRD。

7. **[!] 共享类型补缺（v0.1.8→v0.1.9 遗漏）**：必须补 `EventType` 联合类型 + `EmotionCollapseThresholdReachedPayload` + `CollapseRecord`（事件规范 §2.9，TS 类型缺）；同时补 `AbilityScorePayload` + `ModuleScore`（JSON 字段规范 §10，红线 result_record 落盘 result_payload_json 需要）。

8. **[!] 红线场景的 result_record 落盘时机**：schema trigger 批量熔断后 session 已是 REDLINE_HALTED + level_result=LEVEL_FAIL_BY_SAFETY。result_record 落盘是 5.4 触发还是后续报告（5.8）触发？Mini-PRD 选 5.4 触发（红线不依赖线下分，立即可落盘），但需注意 schema trigger `trg_result_record_redline_source_insert_guard` 强制 result_record 必须安全覆盖。Reviewer 确认。

9. **[!] 事件 sequence 与并发**：writeEvent 的 `nextSequence` 读 `domain_event_projection` MAX(event_sequence)。单进程 Electron 下 IPC 串行处理，无真并发；但若同一 aggregate 高频写入（如快速连点提交答案），需保证 IPC handler 内 writeEvent + 投影 UPDATE 是原子的（better-sqlite3 同步事务）。

10. **[!] REDLINE_TRIGGERED 事件 context_phase 枚举不一致（既有问题，非 5.4 引入）**：事件规范 §2.6 定义 `context_phase: 'BASELINE_ASSESSMENT' | 'FOLLOWUP_ASSESSMENT' | 'MOCK_EXAM' | 'TRAINING'`，但 schema `safety_incident.context_phase` CHECK 约束是 `'ONLINE_ASSESSMENT' | 'TRAINING_WATCH' | ... | 'OFFLINE_SCORING' | ...`。两者枚举不同。5.4 写 `REDLINE_TRIGGERED` 事件 payload 的 context_phase **取 schema 枚举值**（如 `ONLINE_ASSESSMENT`），否则 safety_incident 插入会被 trigger 拦截。事件规范 §2.6 的枚举已过时，需后续修订（不在 5.4 范围，但需在共享类型注释中标注）。

---

## 后续衔接

- **/vibe-impl** 拆解：预估 8-10 步（共享类型补缺 → assertStudent → 组卷服务 → 等级判定服务 → reducer → createSession handler → submitAnswer handler → 情绪中断 handler → 红线 handler → 渲染视图）。
- **/vibe-review** 强制：FSM / safety_incident / 事件一致性是高风险，必须双 AI 审查。
- **/vibe-accept** 每步：typecheck + build + vitest 全绿才进入下一步。
