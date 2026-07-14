# 5.4 测评功能 实现文档

**输入**：`doc/features/assessment-prd.md`（Mini-PRD）
**当前产品合同**：`doc/specs/MVP_PRD_v1.0.9-authoritative.md` | **原实施基线**：schema v0.1.9 / PRD v1.0.5
**预估步数**：10 步（每步一个 commit；Step 6 拆为 6a/6b）
**高风险**：FSM / safety_incident / 事件一致性——整体跑 `/vibe-review`，Step 5/8 额外重点

---

## 实现目标（一句话）

把 strategy_config 首次落地为运行时行为：教师发起测评 → 系统按策略组卷 → 学生答线上 42 题（情绪中断/崩溃可恢复/终止）→ 红线可批量熔断 → 等级判定服务决定 LEVEL_*，所有学生行为事实写 action_log.jsonl。

## 前置条件

- **5.1 学生档案**（已交付）：`student_profile` + `user_account(STUDENT)`
- **5.2 strategy_config**（已交付）：`(strategy_id, version)` 复合 PK + seed 数据 `strategy_baseline_shelver_v1`
- **schema v0.1.9**（已就位）：`assessment_session` / `assessment_session_question` / `answer_record` / `safety_incident` / `result_record` / `domain_event_projection` + 全部触发器（FSM / 红线 / 一致性 / 终态保护）
- **event-writer**（已实现）：`writeEvent()` 写 JSONL + domain_event_projection（不更新业务投影，5.4 自建 reducer）
- **handler 模式**（已验证）：纯函数 + DBAdapter 注入 + 延迟 seed error codes + 审计走 error_event_log
- **5.3 题库未交付**：组卷算法假设 `question_bank` 有 ACTIVE 题；单测 mock，端到端验证推迟到 5.3
- **线下实操评分独立功能**：5.4 不做 OFFLINE_SCORE_SUBMITTED / OPERATION_PASS_RATE / 完整 ABILITY_SCORE 落盘（仅红线 result_record）

---

## 事件写入事务边界（架构决策 — 阅读前必看）

**问题**：AGENTS.md 要求"writeEvent 写 jsonl → domain_event_projection → reducer"严格顺序，且 handler 期望这三步在一个事务内。但 `writeEvent`（src/main/domain/event-writer.ts）实现是：
1. `appendFileSync(logPath, ...)`（fs 操作，**不可回滚**）
2. `getDatabase().prepare(...).run(...)`（better-sqlite3 singleton connection 上的 INSERT）

writeEvent 不接收 db 参数，内部调 `getDatabase()`。better-sqlite3 是**单连接同步**驱动，事务是 connection 级。调用者 `db.transaction(() => { writeEvent(...); reducer(...) })` 时，writeEvent 内部的 INSERT 会**自动加入调用者事务**（同一 connection）。所以：

| 操作 | 是否在 better-sqlite3 事务内 | 回滚行为 |
|---|---|---|
| `appendFileSync`（jsonl） | 否（fs 不可回滚） | 不回滚，jsonl 已多一行 |
| `domain_event_projection` INSERT | **是**（singleton connection） | 随事务回滚 |
| reducer UPDATE/INSERT | **是** | 随事务回滚 |

**可接受的边界（事件溯源原则）**：若 DB 事务回滚（如 reducer 抛错或 schema trigger ABORT），jsonl 会留下"孤儿事件"（已记录但投影未应用）。这是**符合事件溯源原则**的——jsonl 是事实来源，投影可重建。冷启动重放时 reducer 幂等 apply 该孤儿事件，最终一致。反向（DB 写了 jsonl 没写）不会发生，因为 jsonl 先写。

**因此决策**：
- **不改 writeEvent 签名**（不引入 db 参数）。DB 部分通过 singleton connection 自动加入调用者事务，已满足一致性。
- **jsonl fs 写入不在事务内**是接受的边界，由 reducer 幂等性 + 冷启动重放兜底。
- handler 必须用 `db.transaction(() => { writeEvent(...); applyAssessmentEvent(...) })` 包裹，保证 DB 部分原子。
- **reducer 幂等性是硬约束**（Step 5 强制），保证孤儿事件重放 no-op。
- 高风险步骤（Step 5/8）跑 `/vibe-review` 重点审查此边界。

[!] **唯一真实风险场景**：jsonl 写入成功后、DB INSERT 前，进程崩溃（断电、OOM kill）。此时 jsonl 有事件、projection 空。冷启动重放修复（reducer apply 该事件）。action_log.jsonl 末尾损坏由 RECOVERY_LOG_TRUNCATED 处理（PRD §17.4 已覆盖）。

---

## 实现步骤

### Step 1：共享类型补缺（v0.1.8→v0.1.9 遗漏）

**改动文件：**
- `src/shared/types/event-payloads.ts`：
  - `EventType` 联合类型追加 `'EMOTION_COLLAPSE_THRESHOLD_REACHED'`
  - 新增 `EmotionCollapseThresholdReachedPayload` + `CollapseRecord` interface（对齐事件规范 §2.9）
  - 新增 `AbilityScorePayload` + `ModuleScore` interface（对齐 JSON 字段规范 §10，红线 result_record 落盘 result_payload_json 需要）

**核心逻辑：**
纯类型层补缺，无运行时逻辑。`EventType` 缺口是 v0.1.8 修订时漏同步的遗留（AGENTS.md "字段/枚举变更下游全仓扫描" 规则印证）。

```typescript
// EmotionCollapseThresholdReachedPayload（事件规范 §2.9）
interface CollapseRecord {
  interrupted_at: string
  unresolved_since: string
  current_question_order?: number | null
}
interface EmotionCollapseThresholdReachedPayload {
  session_id: string
  collapse_count: number
  threshold: number
  collapse_history: CollapseRecord[]
  triggered_at: string
}

// AbilityScorePayload（JSON 字段规范 §10）
interface ModuleScore {
  module_type: AbilityTag  // 复用 json-schemas.ts 已有类型
  raw_score: number
  max_score: number
  normalized_score: number
}
interface AbilityScorePayload {
  result_type: 'ABILITY_SCORE'
  module_scores?: ModuleScore[]
  online_raw_score: number
  offline_raw_score: number
  question_count: number
  answered_count: number
  emotion_collapse_count: number
  module_veto_triggered_by?: AbilityTag | null
  level_forced_by?: 'MODULE_VETO' | 'EMOTION_COLLAPSE' | null
}
```

**测试用例：**
- 无新单测（纯类型）；`npm run typecheck` 保证。
- 回归：确认现有 `writeEvent` 调用方未受影响（类型扩展只增不改）。

**commit message：** `feat(shared): add EMOTION_COLLAPSE_THRESHOLD_REACHED + AbilityScore payload types`

---

### Step 2：assertStudent 身份校验 + test-helpers 扩展

**改动文件：**
- `src/main/utils/auth-context.ts`：
  - 保留 `assertCaller`（TEACHER/ADMIN，管理类 handler 用）
  - 新增 `assertStudent(db, callerUserId, callerRole)`：校验 callerRole='STUDENT' + user 存在 ACTIVE + role 一致
  - 新增 `assertSessionOwner(db, callerUserId, sessionId)`：校验 session.student_id === callerUserId（防越权答题）
- `src/main/db/test-helpers.ts`：
  - 新增 `seedStudent(db, over?)`：seed user_account(STUDENT) + student_profile（同 UUID 复用，与 student.ts 一致），返回 studentId
  - 新增 `seedQuestionBank(db, over?)`：批量 seed ACTIVE 题目行（mock 题库，6 模块 × 各题型若干），供组卷单测用
- `src/main/utils/__tests__/auth-context.test.ts`：扩展 assertStudent 用例

**核心逻辑：**
STUDENT 答题路径不能复用 assertCaller（它只允 TEACHER/ADMIN）。assertStudent 是软校验（与 assertCaller 同级风险：渲染进程可伪造 callerRole，PRD 已记录，MVP 单进程可信环境接受）。

```typescript
export function assertStudent(db, callerUserId, callerRole): CallerCheck {
  if (callerRole !== 'STUDENT') return { ok: false, errorCode: 'FORBIDDEN' }
  // ...同 assertCaller 的 user_account 校验
}

export function assertSessionOwner(db, callerUserId, sessionId): 
  | { ok: true; sessionRow } 
  | { ok: false; errorCode: 'FORBIDDEN' | 'NOT_FOUND' } {
  // SELECT student_id FROM assessment_session WHERE session_id = ?
  // 不匹配 → FORBIDDEN
}
```

**测试用例：**
- assertStudent：STUDENT 正常 / TEACHER 传给 student 通道 → FORBIDDEN / 账号 DISABLED → FORBIDDEN
- assertSessionOwner：本人 session ok / 他人 session → FORBIDDEN / 不存在 session → NOT_FOUND

**commit message：** `feat(auth): add assertStudent + assertSessionOwner for assessment paths`

---

### Step 3：组卷服务（纯函数）

**改动文件：**
- `src/main/domain/paper-generator.ts`：新建
- `src/main/domain/__tests__/paper-generator.test.ts`：新建

**核心逻辑：**
纯函数，输入策略配置 + 题库行集合，输出 50 道题 ID 列表（42 ONLINE + 8 OFFLINE）+ 每题的 (question_phase, module_type, question_type, question_order)。无 DB 副作用（DB 查询在 handler 层做）。

```typescript
interface GeneratePaperInput {
  onlineQuestionCount: number       // strategy_config.online_question_count (42)
  offlineQuestionCount: number      // 8
  questionRatio: QuestionPolicyJson['question_ratio']  // {TF:14, SC:14, DRAG:14, OFFLINE:8}
  requiredModules: AbilityTag[]     // 6 模块
  questionBankRows: QuestionBankRow[]  // handler 查出的 ACTIVE 题
  sensoryFilterMode?: 'SOFT' | 'STRICT'
}

interface GeneratePaperOutput {
  ok: true
  questions: GeneratedQuestion[]   // 50 项，已按 question_phase + order 排序
}
| { ok: false; errorCode: 'QUESTION_BANK_INSUFFICIENT' | 'INVALID_POLICY' }

interface GeneratedQuestion {
  questionId: string
  questionPhase: 'ONLINE' | 'OFFLINE'
  questionType: 'TRUE_FALSE' | 'SINGLE_CHOICE' | 'DRAG' | 'OFFLINE_OPERATION'
  moduleType: AbilityTag
  questionOrder: number  // 1..50
}
```

模块均衡：每个 `required_modules` 模块按 `onlineQuestionCount / requiredModules.length` 分配题数（42/6=7），每模块内按 question_ratio 比例抽题型。OFFLINE 8 题按 OFFLINE_OPERATION 抽，模块归属按题的 ability_tags[0]（复合标签取首）。

**测试用例：**
- 正常路径：6 模块 × 7 题均衡输出 42 ONLINE + 8 OFFLINE，question_order 连续 1..50
- 题库不足：某模块 ACTIVE 题数 < 7 → `QUESTION_BANK_INSUFFICIENT`
- 无效策略：question_ratio 之和 != online+offline → `INVALID_POLICY`
- sensory filter 分支：STRICT 模式下过滤掉冲突标签（5.3 未交付，单测 mock 标签）
- 确定性：相同输入两次调用输出相同（避免随机种子不稳）
- **极值策略**：onlineQuestionCount=0（理论策略异常，但 strategy_config 可配）→ 返回 0 ONLINE + 8 OFFLINE 或 INVALID_POLICY（按 question_ratio 之和校验决定，明确二选一并在注释标注决策依据）

**commit message：** `feat(assessment): paper generator pure function + module balance`

---

### Step 4：等级判定服务（纯函数，覆盖 §17.6.1 全 9 条）

**改动文件：**
- `src/main/domain/level-judge.ts`：新建
- `src/main/domain/__tests__/level-judge.test.ts`：新建

**核心逻辑：**
纯函数，实现 PRD §7.3 等级判定优先级：红线 > 模块兜底/情绪兜底 > 分数阈值。5.4 阶段 moduleScores 仅含线上 6 模块分（线下未评分），单测 mock 数据需明确标注。

```typescript
interface JudgeLevelInput {
  moduleScores: { module: AbilityTag; raw: number; max: number }[]
  emotionCollapseCount: number
  emotionCollapseThreshold: number
  moduleVetoThreshold: number       // strategy_config.module_veto_threshold (0.5)
  competentThreshold: number        // 80
  conditionalThreshold: number      // 60
  safetyTriggered: boolean
}

interface JudgeLevelOutput {
  levelResult: 'LEVEL_COMPETENT' | 'LEVEL_CONDITIONAL' | 'LEVEL_NOT_COMPETENT' | 'LEVEL_FAIL_BY_SAFETY'
  levelForcedBy: 'MODULE_VETO' | 'EMOTION_COLLAPSE' | null
  moduleVetoTriggeredBy: AbilityTag | null
  normalizedScore: number           // raw_score / max_score * 100
}
```

判定顺序（不可颠倒）：
1. `safetyTriggered=true` → LEVEL_FAIL_BY_SAFETY（levelForcedBy=null，红线覆盖不属兜底）
2. 任一模块 raw/max < moduleVetoThreshold → LEVEL_NOT_COMPETENT（levelForcedBy=MODULE_VETO, moduleVetoTriggeredBy=该模块）
3. emotionCollapseCount >= emotionCollapseThreshold → LEVEL_NOT_COMPETENT（levelForcedBy=EMOTION_COLLAPSE）
4. normalizedScore >= competentThreshold → LEVEL_COMPETENT
5. >= conditionalThreshold → LEVEL_CONDITIONAL
6. else → LEVEL_NOT_COMPETENT

**测试用例（映射 §17.6.1 全 9 条）：**
1. 总分 85 但 COGNITION 模块得分率 0.4 < 0.5 → LEVEL_NOT_COMPETENT + MODULE_VETO + moduleVetoTriggeredBy=COGNITION
2. 总分 85 无兜底 → LEVEL_COMPETENT
3. 总分 70 无兜底 → LEVEL_CONDITIONAL
4. 总分 50 → LEVEL_NOT_COMPETENT（levelForcedBy=null）
5. collapseCount=3, threshold=3 → LEVEL_NOT_COMPETENT + EMOTION_COLLAPSE
6. collapseCount=1, threshold=3（单次中断恢复）→ 不触发兜底，按分数判定
7. safetyTriggered=true + 总分 90 + 模块兜底也触发 → LEVEL_FAIL_BY_SAFETY（优先级最高）
8. 模块兜底多模块同时 < 50% → moduleVetoTriggeredBy 取第一个命中的模块（确定性：按 AbilityTag 枚举顺序）
9. emotionCollapseCount=0 + 模块正常 + 总分 80 → LEVEL_COMPETENT（levelForcedBy=null）

**commit message：** `feat(assessment): level judge pure function with veto/backstop logic`

---

### Step 5：assessment-reducer（事件 → 投影，幂等）

**改动文件：**
- `src/main/domain/assessment-reducer.ts`：新建
- `src/main/domain/__tests__/assessment-reducer.test.ts`：新建

**核心逻辑：**
按 AGENTS.md 事件写入协议第 6 步：writeEvent 后调用 reducer 更新业务投影表。reducer 必须幂等（冷启动回放复用，重复执行 no-op）。

```typescript
// reducer 入口：根据 event_type 分发
export function applyAssessmentEvent(db: DBAdapter, event: ActionLogEntry): void {
  switch (event.event_type) {
    case 'SESSION_STARTED': applySessionStarted(db, event); break
    case 'ANSWER_SUBMITTED': applyAnswerSubmitted(db, event); break
    case 'EMOTION_INTERRUPTED': applyEmotionInterrupted(db, event); break
    case 'EMOTION_RESUMED': applyEmotionResumed(db, event); break
    case 'EMOTION_COLLAPSE_THRESHOLD_REACHED': /* 累计计数已在前置事件维护，no-op 或审计 */ break
    case 'SESSION_COMPLETED': applySessionCompleted(db, event); break
    case 'SESSION_ABORTED': applySessionAborted(db, event); break
    case 'REDLINE_TRIGGERED': applyRedlineTriggered(db, event); break
    case 'RESULT_CALCULATED': applyResultCalculated(db, event); break
  }
}
```

幂等性实现：每个 apply* 先 SELECT 投影当前状态判断是否已应用。例：applyAnswerSubmitted 先查 `answer_record WHERE answer_id = ?`，存在则 return（重放 no-op）。

[!] **架构决策**：本步是事件/投影一致性的核心。handler 调用顺序：`writeEvent()` → `applyAssessmentEvent()`，两步在 `db.transaction()` 内（DB 部分原子；jsonl fs 写入不在事务内，见上方"事件写入事务边界"段——孤儿事件由 reducer 幂等性 + 冷启动重放兜底）。

**测试用例：**
- SESSION_STARTED：apply 后 assessment_session 行存在 + status=INIT（或 ACTIVE，看 handler 决定）+ assessment_session_question 50 行存在
- ANSWER_SUBMITTED：apply 后 answer_record 行存在 + online_completed_count +1 + current_question_id 前移
- 幂等（基本）：同一事件 apply 两次，第二次 no-op（计数不翻倍、行不重复插）
- **冷启动重放（关键，映射 PRD §17.4 / 验收 20）**：模拟"jsonl 有 N 个事件、domain_event_projection 部分空、assessment_session 投影为空"→ 逐事件 applyAssessmentEvent → 最终投影状态与"在线正常执行 N 个事件"结果一致。覆盖 SESSION_STARTED+ANSWER_SUBMITTED×5+EMOTION_INTERRUPTED+EMOTION_RESUMED 序列重放。
- **孤儿事件幂等**：模拟"jsonl 有事件但 projection 已回滚"（手动删 projection 行保留 jsonl 行）→ 重放该事件 → 投影正确恢复，不重复。
- 未知 event_type：no-op + 不抛错（向前兼容 schema_version 升级）

**commit message：** `feat(assessment): idempotent reducer for event projection`

---

### Step 6a：assessment IPC 通道声明（类型 + preload 白名单）

**改动文件（3 文件，纯类型/接线，无 handler 逻辑）：**
- `src/shared/types/assessment.ts`：新建（IPC 参数/返回类型声明：CreateSessionParams / CreateSessionResult / SessionDetail / 各错误码联合等）
- `src/shared/types/ipc-api.ts`：IpcApi 加 `assessment` 命名空间（含 createSession / getSession / submitAnswer / emotionInterrupt / emotionResume / abortSession / triggerRedline / calculateResult 方法签名——后续 Step 6b/7/8 逐步实现 handler）
- `src/preload/index.ts`：白名单加 `assessment` 命名空间（ipcRenderer.invoke 桥接）

**核心逻辑：**
纯通道声明。preload 声明的 IPC 通道此时还没有 main 进程 handler，调用会 reject（标准 Electron 行为，Step 6b 注册 handler 后正常）。本步保证 typecheck 通过 + renderer 类型链完整。

**测试用例：**
- 无新单测（纯类型）；`npm run typecheck` + `npm run build` 通过。

**commit message：** `feat(assessment): IPC channel declaration + shared types`

---

### Step 6b：createSession handler + 注册 + seed 错误码

**改动文件（3 文件）：**
- `src/main/ipc/handlers/assessment.ts`：新建（createSession 纯函数 + registerAssessmentHandlers + seedAssessmentErrorCodes，含全 5.4 步骤的错误码 seed）
- `src/main/ipc/index.ts`：注册 registerAssessmentHandlers
- `src/main/ipc/handlers/__tests__/assessment-create.test.ts`：新建

**核心逻辑：**

`createSession`（TEACHER）：
1. assertCaller(TEACHER)
2. 读 strategy_config（strategyId, version），校验存在 + strategy_type ∈ {BASELINE_ASSESSMENT, MOCK_EXAM}
3. 校验 student 存在 ACTIVE
4. 校验无同 (student, task, strategy_type) 开放 session（否则 SESSION_ALREADY_OPEN，让 UI 提示继续/作废）
5. 校验无未解决安全事件：handler 前置 SELECT safety_incident (PENDING_DETAIL/CONFIRMED + requires_review=1) → 返回友好错误码 BLOCKED_BY_SAFETY_INCIDENT。schema trigger `trg_assessment_session_block_unresolved_safety_incident` 是兜底（BEFORE INSERT ABORT），两者并存不冲突。
6. 查 ACTIVE question_bank（5.3 未交付时返回空 → QUESTION_BANK_INSUFFICIENT）
7. generatePaper(strategy, questionBankRows) → 50 题（Step 3 输出的 questions 数组，question_ids 从中提取写 SESSION_STARTED payload）
8. `db.transaction` 内：
   - INSERT assessment_session（status=INIT）
   - INSERT 50 行 assessment_session_question
   - writeEvent(SESSION_STARTED, payload 含 question_ids) — jsonl 先写（fs，不可回滚），projection 随事务
   - applyAssessmentEvent（reducer，Step 5）
   - UPDATE assessment_session status=ACTIVE, started_at
9. 返回 { sessionId, questions: [...42 ONLINE] }

**seedAssessmentErrorCodes（一次性 seed 5.4 全部步骤的码，FK 约束要求 ERROR 码先存在才能写 error_event_log 审计）**：

ERROR 级（异常，写 error_event_log 审计）：
- ASSESSMENT_SYSTEM_ERROR (P1) — handler catch 兜底
- ASSESSMENT_FSM_VIOLATION (P1) — 非法状态迁移
- QUESTION_BANK_INSUFFICIENT (P2)
- ANSWER_PERSIST_FAILED (P1) — 答题持久化异常
- EMOTION_TRANSITION_FAILED (P1) — 情绪状态转换异常
- REDLINE_TRIGGER_SYSTEM_ERROR (P1)

INFO 级（审计 TEACHER 关键操作，与 strategy.ts 决策一致；学生答题行为不写 error_event_log——已写领域事件 action_log.jsonl，不重复）：
- SESSION_CREATED (P3)
- SESSION_ABORTED (P3)
- REDLINE_TRIGGERED (P2)

业务校验返回码（FORBIDDEN / NOT_FOUND / SESSION_ALREADY_OPEN / ALREADY_ANSWERED / SESSION_NOT_ACTIVE / SESSION_PAUSED / SESSION_HALTED / QUESTION_NOT_IN_SESSION / BLOCKED_BY_SAFETY_INCIDENT / VALIDATION_ERROR）**不 seed、不写审计**（与 student.ts FORBIDDEN/NOT_FOUND 一致：正常业务拒绝，非异常）。

[!] **schema trigger 注意**：assessment_session INSERT 时 status=INIT 是合法的（trg_assessment_session_no_insert_redline_status 只拦 REDLINE_HALTED）。trg_assessment_session_strategy_config_match_insert 会校验 4 列匹配 strategy_config，handler 必须传对。

**测试用例：**
- createSession 正常：返回 sessionId + 50 行 assessment_session_question + SESSION_STARTED 事件落 domain_event_projection
- 学生不存在 → NOT_FOUND
- 策略 (strategyId, version) 不存在 → NOT_FOUND
- 策略 strategy_type=TRAINING_PRACTICE → VALIDATION_ERROR（assessment 只能 BASELINE/MOCK）
- 重复开放 session → SESSION_ALREADY_OPEN（partial unique index 兜底）
- 题库为空 → QUESTION_BANK_INSUFFICIENT
- 非 TEACHER（STUDENT）→ FORBIDDEN
- 未解决安全事件 → BLOCKED_BY_SAFETY_INCIDENT（seed safety_incident PENDING_DETAIL 后测，验证 handler 前置 SELECT 路径）

**commit message：** `feat(assessment): createSession handler + error code seed + ipc registration`

---

### Step 7：答题 + 情绪中断/崩溃 handler

**改动文件：**
- `src/main/ipc/handlers/assessment.ts`：扩展（submitAnswer / emotionInterrupt / emotionResume / abortSession）
- `src/main/ipc/handlers/__tests__/assessment-answer.test.ts`：新建
- `src/main/ipc/handlers/__tests__/assessment-emotion.test.ts`：新建

**核心逻辑：**

`submitAnswer`（STUDENT）：
1. assertStudent + assertSessionOwner
2. 校验 session.status=ACTIVE（否 → SESSION_NOT_ACTIVE / SESSION_PAUSED / SESSION_HALTED）
3. 校验 question_id ∈ 本 session 的 assessment_session_question 且 phase=ONLINE
4. 校验该 question 无 VALID answer_record（ux_answer_record_one_valid_answer 兜底）→ 否则 ALREADY_ANSWERED
5. **校验 answer_payload 结构**（按 question_type 分支，AGENTS.md "JSON 字段必须验证" 约束）：
   [!] 字段名以 `src/shared/types/event-payloads.ts` 的 `AnswerPayloadDetail` 为准
   （含 `question_type` 判别字段）；下面每个题型是判别后的成员。
   - TRUE_FALSE：`{ question_type: 'TRUE_FALSE', selected: boolean }`，对比 `content_json.expected_answer`
   - SINGLE_CHOICE：`{ question_type: 'SINGLE_CHOICE', selected: string }` 且 ∈ `content_json.options[].key`，对比 `content_json.expected_answer`
   - DRAG：`{ question_type: 'DRAG', placements: { item_id: string; zone_id: string }[] }`，长度 = `content_json.drag_items` 数，按 `content_json.drop_zones[].accepts` 判定每项对错
   - 不匹配 / content_json 缺校验字段 → VALIDATION_ERROR（不落 answer_record，不写事件）
6. 计分（按题型硬编码，不读 scoring_rule_json；该字段供 UI 标签用）：TRUE_FALSE/SINGLE_CHOICE exact（对=2/错=0）；DRAG 按 `content_json.scoring_mode`：全对=2，`PARTIAL_CREDIT` 且对的多于半数=1，其余=0 → score ∈ {0,1,2}
7. 事务：writeEvent(ANSWER_SUBMITTED, payload 含 answer_payload) + applyAssessmentEvent（reducer 承担 INSERT answer_record + 计数前移；handler 不另 INSERT）

`emotionInterrupt`（STUDENT）：允许从 ACTIVE 与 EMOTION_INTERRUPTED（escalating collapse，连续未恢复中断累加）；writeEvent(EMOTION_INTERRUPTED) + reducer 承担 status=EMOTION_INTERRUPTED + pause_count+1
`emotionResume`（TEACHER）：仅 EMOTION_INTERRUPTED 可恢复；writeEvent(EMOTION_RESUMED) + reducer 承担 status=ACTIVE
`abortSession`（TEACHER）：
- collapse_count = count(EMOTION_INTERRUPTED) − count(EMOTION_RESUMED)（事件溯源查询，同 aggregate）
- 若 collapse_count ≥ emotion_collapse_threshold 且本 aggregate 未发过崩溃事件 → 先写 EMOTION_COLLAPSE_THRESHOLD_REACHED 再写 SESSION_ABORTED
- writeEvent(SESSION_ABORTED) + reducer 承担 status=ABORTED

[!] **崩溃计数来源**：handler 维护 session.pause_count？或从 domain_event_projection 查 EMOTION_INTERRUPTED 后无 EMOTION_RESUMED 的次数。后者更符合事件溯源原则（投影可重建），但有性能成本。**本步选事件溯源查询**（count EMOTION_INTERRUPTED - count EMOTION_RESUMED on same aggregate）。注意 pause_count 只增不减（恢复不递减），故 pause_count ≠ collapse_count；"I R I R I" 序列 pause_count=3 但 collapse_count=1。
[!] [!] impl.md 早期措辞 "累计未恢复中断数 +1 后达 threshold" 有歧义；以测试用例为准：collapse_count=3,threshold=3 触发（≥），collapse_count=2 不触发。

**测试用例：**
- submitAnswer 正常：answer_record 行 + ANSWER_SUBMITTED 事件 + online_completed_count +1
- 重复答题 → ALREADY_ANSWERED
- STUDENT 答他人 session → FORBIDDEN
- 非 ACTIVE 态答题 → SESSION_NOT_ACTIVE
- 越权 question_id → QUESTION_NOT_IN_SESSION
- 情绪中断+恢复：状态 ACTIVE→EMOTION_INTERRUPTED→ACTIVE，恢复后可继续答题
- 累计崩溃：3 次中断未恢复 + abortSession 第 3 次 → EMOTION_COLLAPSE_THRESHOLD_REACHED 事件 + SESSION_ABORTED
- 单次中断恢复不计崩溃：中断→恢复→中断→恢复→中断→abort → collapseCount=1（不是 3）
- **崩溃计数边界（语义验证）**：threshold=3 时，collapseCount=2 不触发兜底（中断→恢复 2 次未恢复也只算 2，judgeLevel 走分数路径）；collapseCount=3 边界触发；collapseCount=4（理论不应达，abort 后终态）防御性断言不重复发事件
- **计数来源一致性**：直接删 domain_event_projection 的 EMOTION_INTERRUPTED 行模拟投影损坏 → 重放后 collapseCount 仍正确（证明计数来自事件流而非冗余字段）
- DRAG 部分得分：all_correct=2 / partial=1 / rest=0

**commit message：** `feat(assessment): submit answer + emotion interrupt/collapse handlers`

---

### Step 8：红线触发 + result_record 落盘

**改动文件：**
- `src/main/ipc/handlers/assessment.ts`：扩展（triggerRedline / calculateResult）
- `src/main/ipc/handlers/__tests__/assessment-redline.test.ts`：新建

**核心逻辑：**

`triggerRedline`（TEACHER/ADMIN）：
1. assertCaller(TEACHER 或 ADMIN)
2. 校验 reason_code ∈ schema 枚举 + context_phase 取 **schema 枚举值**（如 ONLINE_ASSESSMENT，非事件规范 §2.6 过时的 BASELINE_ASSESSMENT）—— [!] 见风险点 10
3. 事务：
   - writeEvent(SAFETY_INCIDENT_CREATED, aggregate_type=SAFETY_INCIDENT)
   - INSERT safety_incident（status=PENDING_DETAIL）
   - **schema trigger trg_safety_incident_bind_open_assessments 自动**：批量 UPDATE 同 student+task 开放 session → REDLINE_HALTED + level_result=LEVEL_FAIL_BY_SAFETY + 写 safety_incident_binding
   - writeEvent(REDLINE_TRIGGERED, aggregate_type=ASSESSMENT_SESSION, payload context_phase=ONLINE_ASSESSMENT)
   - 调 calculateResult 落盘 result_record（见下）

`calculateResult`（红线场景）：
1. 查 session（应已 REDLINE_HALTED）
2. judgeLevel({ safetyTriggered: true, ... }) → LEVEL_FAIL_BY_SAFETY
3. 事务：
   - INSERT result_record（**result_type=ABILITY_SCORE**，safety_overridden=1, level_result=LEVEL_FAIL_BY_SAFETY, redline_incident_id 填充, result_payload_json=AbilityScorePayload；source_aggregate_type=ASSESSMENT_SESSION, source_aggregate_id=session_id）
   - writeEvent(RESULT_CALCULATED)
   - applyAssessmentEvent

[!] **schema trigger 强约束**：result_record INSERT 时 trg_result_record_insert_safety_override_guard + trg_result_record_redline_source_insert_guard 双重校验 safety_overridden/level_result/redline_incident_id 一致。handler 必须三字段同时正确，否则 ABORT。

[!] **红线触发链（理解 schema 自动行为，handler 不重复实现）**：
1. handler INSERT safety_incident(PENDING_DETAIL) → 触发 `trg_safety_incident_bind_open_assessments`（AFTER INSERT）
2. 该 trigger 批量 UPDATE 同 student+task 的开放 session（status ∈ INIT/ACTIVE/EMOTION_INTERRUPTED/SUSPENDED_REVIEW_REQUIRED/OFFLINE_PENDING，与 schema `trg_safety_incident_bind_open_assessments` WHERE 子句一致）→ status=REDLINE_HALTED, level_result=LEVEL_FAIL_BY_SAFETY + 写 safety_incident_binding 行
3. 每个 session UPDATE 又触发 `trg_assessment_session_redline_incident_same_student_task_update`（AFTER UPDATE）——校验 session 改成 REDLINE_HALTED 时必须有对应 safety_incident binding，防止应用层绕过红线流程私自写 REDLINE_HALTED
4. handler 在事务内 writeEvent(REDLINE_TRIGGERED) 记录事实（投影已由 trigger 完成），然后调 calculateResult 落 result_record

**handler 不应**：手动 UPDATE session 为 REDLINE_HALTED（绕过 trigger 链，会被 trigger 拦），不写 safety_incident 直接写 result_record（trigger 校验 redline_incident_id 存在）。

**result_type=ABILITY_SCORE 说明**：红线 result_record 仍是 ABILITY_SCORE 类型（不是独立红线类型），通过 safety_overridden=1 + level_result=LEVEL_FAIL_BY_SAFETY 标记。线下评分独立功能补全后，正常 ABILITY_SCORE result_record 也会是 result_type=ABILITY_SCORE 但 safety_overridden=0。ux_result_record_one_current_per_source_type 保证同 session 同 result_type 唯一。

[!] **[!] 必跑 /vibe-review**：本步是 FSM + safety_incident + 批量熔断最高风险点。

**测试用例：**
- 红线正常触发：safety_incident(PENDING_DETAIL) + session→REDLINE_HALTED + safety_incident_binding + result_record(LEVEL_FAIL_BY_SAFETY)
- 批量熔断多 session：同一学生同时有 ACTIVE assessment + INIT assessment → 两个都被熔断
- EMOTION_INTERRUPTED 态 session 也被熔断（trigger WHERE 含此状态）
- OFFLINE_PENDING 态 session 被熔断（trigger WHERE 含此状态）
- STUDENT 触发红线 → FORBIDDEN
- reason_code 非法 → VALIDATION_ERROR
- context_phase 用事件规范过时枚举 BASELINE_ASSESSMENT → 被 schema CHECK 拦截（回归风险点 10）
- 无开放 session 也能创建 safety_incident（schema 允许）
- result_record 落盘后 ux_result_record_one_current_per_source_type 保证唯一

**commit message：** `feat(assessment): trigger redline + safety-overridden result record`

**实测结论（Step 8 实现）：**
- 22 测试用例全绿（impl.md 8 项 + 边界 + ADMIN + 计算幂等等）
- 实测发现 impl.md 未明示的边界：handler 对**终态 session**（COMPLETED/ABORTED）触发红线时，schema trigger 不熔断，`persistRedlineResult` 在事务内检测 `status !== 'REDLINE_HALTED'` 抛错回滚 → 返回 `REDLINE_TRIGGER_SYSTEM_ERROR`（错误码语义错位）。补加 `statusToRedlineErrorCode` 前置校验：开放态允许 / REDLINE_HALTED → `SESSION_HALTED` / 终态 → `SESSION_NOT_ACTIVE`。与 `statusToAbortErrorCode` 同模式。
- **MemoryAdapter.transaction 不支持 SAVEPOINT**（sql.js BEGIN/COMMIT/ROLLBACK 平铺）。设计调整：`persistRedlineResult` 是不开事务的辅助纯函数（与 reducer 同模式），由 triggerRedline / calculateResult 各自的 transaction 包裹。两 handler 路径各自完整。
- calculateResult 注册 IPC + 纯函数 export。本 Step 仅支持红线场景（session.status === 'REDLINE_HALTED'）；正常完成路径（COMPLETED + 线下评分）由后续 Step 扩展。幂等：已有 result_record 直接返回。
- result_record 落盘使用 `judgeLevel({safetyTriggered:true})` 强制 LEVEL_FAIL_BY_SAFETY，但 `normalized_score` 仍从 answer_record 算真实模块分（0-100 之间，schema CHECK 要求）。
- 批量熔断实测：同 student+task 不同 strategy_type（BASELINE+MOCK）的两个 session 都被 schema trigger 熔断；result_record 仅对 handler 指定的 target session 落盘（persistRedlineResult 单次调用，未遍历批量 session —— 后续若需对所有熔断 session 落盘可扩展）。

**[!] /vibe-review 后修复（P1）：**
- **`result_payload_json` 重放丢失修复**：原实现 handler 在事务内 UPDATE 写 abilityPayload，但 reducer `applyResultCalculated` 不读该字段，冷启动重放后字段为 NULL（报告模块分丢失）。修复：`ResultCalculatedPayload` 加 `breakdown?: AbilityScorePayload | null`，handler 把 abilityPayload 放进事件 payload，reducer 在 INSERT 时一并写入。删除 handler 后置 UPDATE。新增 reducer 重放测试验证字段一致。
- **`question_count` / `answered_count` 语义修复**：原实现两字段同值（因 `computeRedlineModuleScores` 过滤未答模块 + `m.max/2` 隐式反推题数）。修复：`question_count` 从 `session.online_question_count` 读（42），`answered_count` 从 `answer_record COUNT(*)` 读，加 `MAX_SCORE_PER_QUESTION = 2` 显式常量。红线中途触发时两字段语义分离。
- **死代码清理**：`judge.moduleVetoTriggeredBy ? undefined : ...` 三元判断永远走 else（红线场景 moduleVetoTriggeredBy 永远 null），简化为直接构造数组；`level_forced_by: null` 改用 `judge.levelForcedBy`（红线场景仍 null，但保持一致性）。

**测试规模：** 25 测试全绿（22 + 3 P1 验证：result_payload_json 结构 / question_count=42 / reducer 重放幂等）。

---

### Step 9：渲染层（学生答题 + 教师发起/列表 + Pinia store + router）

**改动文件（5 文件，渲染层内聚）：**
- `src/renderer/src/stores/assessment.ts`：新建（Pinia store，封装 assessment IPC）
- `src/renderer/src/views/student/AssessmentView.vue`：新建（答题页）
- `src/renderer/src/views/teacher/AssessmentCreateView.vue`：新建（发起测评页）
- `src/renderer/src/views/teacher/AssessmentListView.vue`：新建（进行中列表 + 继续/终止/触发红线）
- `src/renderer/src/router/index.ts`：注册 `/student/assessment/:sessionId` + `/teacher/assessments/*`

**核心逻辑：**

Pinia store 封装 `window.api.assessment.*`，提供 reactive 状态（currentSession / currentQuestion / progress / emotionState）。

AssessmentView（学生）：
- 加载 session + 当前题（按 current_question_id）
- 渲染题型（TRUE_FALSE 单选/SINGLE_CHOICE 单选/DRAG 拖拽）
- 提交按钮 → submitAnswer → 加载下一题
- "我遇到困难了"按钮 → emotionInterrupt（转教师端处理）
- 进度条（online_completed_count / 42）

AssessmentCreateView（教师）：选学生 + 岗位 + 任务 + 策略版本（调 strategy:listVersions）→ createSession
AssessmentListView（教师）：列出 ACTIVE/EMOTION_INTERRUPTED/OFFLINE_PENDING session → 继续/终止/触发红线按钮

**测试用例：**
- 手工验收（无单测，与 student/strategy 视图一致策略）：
  1. 教师发起测评 → 跳学生答题页
  2. 学生答几题 → 刷新/重启 → 恢复到最后一道已提交题之后
  3. 情绪中断 → 教师端看到提示 → 恢复 → 学生继续
  4. 触发红线 → session REDLINE_HALTED + 红线结果展示
- `npm run build` 通过（vue-tsc 类型检查）
- E2E（webapp-testing skill 或手工）：核心路径截图

**commit message：** `feat(assessment): renderer views + pinia store + router`

**实测结论（Step 9b 实现）：**
- **范围扩展**：原 impl.md 列 5 文件（store + 3 view + router）。实际因两个未明的设计点扩到 13 文件：①学生首次进入 session（current_question_id=null）无法渲染第一题 → 新增 `SESSION_FIRST_QUESTION_ACTIVATED` 事件 + reducer 分支 + `assessment:startSession` IPC；②学生端无入口（listSessions 是 TEACHER/ADMIN only）→ 新增 `assessment:listMySessions` IPC + `StudentHomeView.vue`。决策点记录在 `.continue-here.md` Key Decisions。
- **事件命名**：`SESSION_FIRST_QUESTION_ACTIVATED`（与 SESSION_STARTED/ABORTED 前缀一致；描述业务事实"学生点了开始"，比"QUESTION_POINTER_INITIALIZED"等实现细节命名更可读）。
- **reducer 幂等策略**：applySessionFirstQuestionActivated 不依赖 `last_status_event_id`（该字段追踪 status 变更，本事件非 status 变更）。改为 SELECT `current_question_id`，非 NULL 则 skip；UPDATE 时只动 `last_applied_event_id`（与 `applyAnswerSubmitted` 同模式）。WHERE 加 `AND current_question_id IS NULL` 兜底防覆盖。冷启动重放（如 SESSION_STARTED → ANSWER_SUBMITTED → SESSION_FIRST_QUESTION_ACTIVATED 乱序）下，current_question_id 已被 ANSWER_SUBMITTED 推进，本事件 WHERE 0 row affected 无害 skip。
- **handler startSession 幂等返回**：current_question_id 已非 NULL → 直接返回现有指针，**不写事件**（与 calculateResult 已有 result_record 时返回已有 resultId 同模式）。避免引入 `SESSION_ALREADY_STARTED` 新错误码。
- **startSession status 映射**：复用 `statusToAnswerErrorCode`（与 submitAnswer 同映射），只允许 ACTIVE；EMOTION_INTERRUPTED→SESSION_PAUSED / REDLINE_HALTED→SESSION_HALTED / 终态→SESSION_NOT_ACTIVE。
- **listMySessions**：复用 listSessions 的 SELECT + 行映射，仅 WHERE 改为 `student_id = caller.userId AND status IN (OPEN_SESSION_STATUSES)`。返回 SessionListItem[]（含 studentName 字段，虽对学生自查冗余但保持类型一致）。
- **学生入口实现**：StudentLayout 从 placeholder 改为带 sidebar + RouterView 外壳；新增 StudentHomeView.vue（默认 `/student` 子路由）调 listMySessions 展示卡片列表，点击进入 AssessmentView。
- **AssessmentView 题型分支**：TRUE_FALSE / SINGLE_CHOICE 用 radio；DRAG 简化为 select-per-item（MVP 阶段；真正 HTML5 拖拽 UI 后续迭代，计分逻辑 handler 已正确实现）。
- **AssessmentListView 教师操作**：每行 inline 按钮（恢复/终止/触发红线）；红线触发用内嵌下拉选 reasonCode + contextPhase（一次只展开一行），与 `SAFETY_REASON_CODES` / `SAFETY_CONTEXT_PHASES` schema 枚举同步。
- **测试规模**：13 单测（startSession 正常/幂等/ANSWER_SUBMITTED 之后不覆盖/FORBIDDEN/NOT_FOUND/SESSION_PAUSED/SESSION_HALTED/SESSION_NOT_ACTIVE/他人 session + listMySessions 4 项）+ reducer 直接幂等 3 单测（apply 两次 / ANSWER_SUBMITTED 后重放不覆盖 / session 不存在静默 skip）。typecheck + build + 全量回归（356/356）通过。
- **/vibe-review 修复**：①P1.1 store.startSession/submitAnswer/emotionInterrupt 在 loadSession 失败时仍返回 ok:true → propagate 刷新结果让 view 决策；②P1.2 reducer 缺直接幂等单测（仅通过 handler short-circuit 间接覆盖）→ 补 3 个直接构造 ActionLogEntry 调 applyAssessmentEvent 的单测覆盖冷启动回放场景。P2 共 5 项作为后续小重构。
- **未验证项**：5.3 题库未交付，端到端真实答题验证推迟。手工冒烟需 5.3 题库就位后补。

---

## 项目约束检查（Writer 自检）

- [x] **事件写入顺序**：writeEvent（JSONL → projection）→ reducer（业务投影），Step 5/6/7/8 严格遵循。事务包裹 writeEvent+reducer。
- [x] **新 EventType 已加 event-payloads.ts**：Step 1 补 EMOTION_COLLAPSE_THRESHOLD_REACHED。
- [x] **新 IPC 通道在 preload 白名单**：Step 6a 显式声明 assessment 命名空间。
- [x] **无硬编码题量/阈值**：Step 3/4/6b 全部从 strategy_config 读（onlineQuestionCount / thresholds / emotionCollapseThreshold）。
- [x] **FSM 状态迁移与 schema trigger 一致**：Step 7/8 状态转换严格落在 schema 允许路径（INIT→ACTIVE→EMOTION_INTERRUPTED→ACTIVE / →ABORTED / →REDLINE_HALTED / →OFFLINE_PENDING / →COMPLETED）。
- [x] **安全红线 [!] 标注**：Step 8 + 整体 /vibe-review。
- [x] **JSON 字段写入前校验**：answer_payload 按 question_type 分支校验；result_payload_json 按 AbilityScorePayload 结构。

---

## 回归验收清单

- [ ] `npm run typecheck` 通过（每步）
- [ ] `npm run build` 通过（每步，含 vue-tsc）
- [ ] `npm run test`（vitest）通过（每步，新单测 + 全回归）
- [ ] 手工冒烟（Step 9 后）：
  - 教师发起 → 学生答完 42 题 → session OFFLINE_PENDING（无红线）
  - 情绪中断 → 恢复 → 继续
  - 累计崩溃 → ABORTED
  - 红线触发 → REDLINE_HALTED + result_record
  - 重启恢复 → 最后一道已提交题之后
- [ ] Step 5/8 完成后单独跑 `/vibe-review`（高风险双审查）
- [ ] 整体完成跑 `/vibe-accept` 全绿 → 本地 squash merge main → push

---

## 步骤依赖图

```
Step 1（共享类型：EventType + payloads）
  ↓                                          ↓ (Step 5 直接依赖：reducer switch on EventType)
Step 2（assertStudent + test-helpers）        │
  ↓                                          │
Step 3（组卷）   Step 4（等级判定）   Step 5（reducer，依赖 1+2）
  ↓                ↓                    ↓
  └────────────────┴────────────────────┘
                   ↓
     Step 6a（IPC 通道声明，依赖 1 类型）
                   ↓
     Step 6b（createSession handler，依赖 2+3+5+6a）
                   ↓
            Step 7（答题+情绪，依赖 6b）
                   ↓                              ↓ (Step 8 直接依赖：调 judgeLevel)
            Step 8（红线，依赖 4+7）←─────────────┘
                   ↓
            Step 9（渲染，依赖 6b+7+8）
```

**直接依赖说明（非传递）**：
- Step 5 → Step 1：reducer 在 event_type 上 switch 分发，EventType 联合类型由 Step 1 定义；缺 Step 1 则 reducer 无法通过 typecheck。
- Step 8 → Step 4：calculateResult 调 judgeLevel({ safetyTriggered: true })，judgeLevel 由 Step 4 实现。
- Step 3/4 可并行（独立纯函数，互不依赖）；Step 5 仅依赖 Step 1+2，可与 3/4 并行。建议按编号顺序提交以保证 typecheck 渐进绿。
