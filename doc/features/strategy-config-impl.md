# 5.2 任务与岗位配置 — 实现文档

对应 Mini-PRD：`doc/features/strategy-config-prd.md` v1.0.0（二审通过）
对应主 PRD：§5.2、§7.6、§7.2、§7.3、§17.6
对应 schema：v0.1.8-base-ability-rebalance（冻结，无 schema 变更）
分支：`feat/strategy-config`

---

## 实现目标（一句话）

交付管理员端 `strategy_config` 维护闭环（列表 / 新建族 / 新增版本 / 编辑未引用版本 / 启用停用），写路径锁 ADMIN、读路径开放 TEACHER，所有写操作写 `error_event_log` INFO 审计，为 5.4 / 5.5 提供唯一策略配置源。

---

## 前置条件

- **schema 已就绪**：`strategy_config` 表（schema.sql:215-257）、`trg_strategy_config_referenced_version_semantic_immutable` 触发器（schema.sql:1880-1915）、2 条 seed（schema.sql:1924-2002）已存在；本功能 **不改 schema**
- **PR #1 基线**：`assertCaller`（`src/main/utils/auth-context.ts`）、DBAdapter / SqliteAdapter / MemoryAdapter、`createTestDb` / `seedCaller`（`src/main/db/test-helpers.ts`）、`error_event_log` 审计模式、Pinia `useAuthStore`、路由守卫均已就绪
- **类型基类已就绪**：`QuestionPolicyJson` / `ScoringPolicyJson` / `LevelRule` / `AbilityTag` 已在 `src/shared/types/json-schemas.ts` 声明（json-schemas.ts:119-142）
- **seed 数据已知缺陷**：v0.1.8 seed 的 `scoring_policy_json` 已包含 `level_rules`，但历史版本可能缺；本功能 `validate-scoring-policy.ts` 不给 seed 特例豁免；管理员首次编辑缺 `level_rules` 的版本时需补全才能保存

---

## 实现步骤（每步对应一个 commit）

### Step 1：策略 JSON 校验工具（纯函数 + 单测）

**改动文件：**
- `src/main/utils/validate-question-policy.ts`（新建，~120 行）
- `src/main/utils/validate-scoring-policy.ts`（新建，~160 行）
- `src/main/utils/__tests__/validate-question-policy.test.ts`（新建）
- `src/main/utils/__tests__/validate-scoring-policy.test.ts`（新建）

（4 文件）

**核心逻辑：**

模仿 `src/main/utils/validate-sensory-profile.ts` 风格：纯函数，无 DB 依赖，返回 `{ ok: true } | { ok: false, reason }`。

`validateQuestionPolicy(json, ctx)`，`ctx = { onlineQuestionCount: number, offlineQuestionCount: number }`：
1. `module_scope ∈ {'SINGLE_MODULE', 'CROSS_MODULE'}`
2. `question_ratio` 各值为非负整数（缺失 key 按 0 处理）
3. `required_modules`（若有）非空数组，各值属于 `AbilityTag` 枚举
4. `difficulty_distribution`（若有）各值为数值且和约 1.0（容差 0.001）；缺失则跳过
5. `sensory_filter_mode`（若有）∈ {'SOFT','STRICT'}；`fallback_strategy`（若有）∈ {'LOW_STIMULI_FIRST','SAME_TYPE_DIFFERENT_ASSET','BLOCK'}
6. **跨字段**：`sum(question_ratio.values, 缺失按 0) === online + offline`，否则返回 `{ok:false, reason:'question_ratio sum mismatch'}`

`validateScoringPolicy(json, ctx)`，`ctx = { strategyCompetentThreshold: number, strategyConditionalThreshold: number }`：
1. `score_values` 严格等于 `[0,1,2]`
2. `normalization === 'raw_score/max_score*100'`
3. `safety_override_enabled` 为布尔
4. `level_rules` 非空数组，每条 `{min,max,level}`：`min<=max`、`level ∈ {'LEVEL_COMPETENT','LEVEL_CONDITIONAL','LEVEL_NOT_COMPETENT'}`
5. **覆盖性**：`level_rules` 按 min 排序后须连续覆盖 `[0,100]`——首条 min=0、相邻前条 max+1=后条 min、末条 max=100；无盲区无重叠
6. **表列与 level_rules 一致性**（v0.1.8 单源：阈值只在表列，JSON 不再携带 `competent_threshold` / `conditional_threshold` 键）：`level_rules` 中 LEVEL_COMPETENT 首条 min === ctx.strategyCompetentThreshold；LEVEL_CONDITIONAL 首条 min === ctx.strategyConditionalThreshold

[!] v0.1.8 语义变化：`scoring_policy_json` 不再包含 `competent_threshold` / `conditional_threshold` / `module_veto_threshold` / `emotion_collapse_threshold` 键（已提升为 `strategy_config` 表列）。`level_rules` 的 `min/max` 是 JSON 内唯一与阈值相关的数据，必须与表列交叉比对，防止漂移。

[!] 实现要点：`level_rules` 覆盖性校验是纯应用层职责（schema 不校验 JSON 内部结构）。排序后逐对比较，发现盲区/重叠返回 `{ok:false, reason}` 含具体冲突区间。

**测试用例（validate-question-policy）：**
- 正常路径：完整 4 题型 ratio，sum=50 与 ctx 匹配
- 缺失 key：只填 `{TRUE_FALSE:50}`，online=42 offline=8 → sum=50 通过
- ratio 不足：sum=49 → 失败
- `module_scope` 非法 → 失败
- `required_modules` 含非 AbilityTag → 失败
- `difficulty_distribution` 和=0.999 → 通过（容差内）；和=0.95 → 失败
- `difficulty_distribution` 缺失 → 通过
- `sensory_filter_mode` / `fallback_strategy` 枚举非法 → 失败
- 两字段都缺失 → 通过（optional）

**测试用例（validate-scoring-policy）：**
- 正常路径：3 条 level_rules 覆盖 [0,60)/[60,80)/[80,100]，level_rules min 与 ctx 表列一致
- `score_values=[0,1,1]` → 失败
- `normalization` 错误 → 失败
- `level_rules` 空数组 → 失败
- `level_rules` 有盲区（[0,60)+[80,100] 缺中间）→ 失败
- `level_rules` 重叠（[0,80)+[60,100]）→ 失败
- `level_rules` 末条 max=99 → 失败（未到 100）
- level_rules min 与表列漂移：`level_rules` LEVEL_COMPETENT 首条 min=85 vs ctx.strategyCompetentThreshold=80 → 失败
- LEVEL_CONDITIONAL 首条 min != ctx.strategyConditionalThreshold → 失败（表列与 JSON 漂移）
- seed 数据模拟（无 level_rules）→ 失败（覆盖验收 #40）

**commit message 建议：**
`feat(strategy): add question/scoring policy validators with cross-field checks`

---

### Step 2：共享类型 + IPC 桥接声明

**改动文件：**
- `src/shared/types/strategy.ts`（新建，~110 行）
- `src/shared/types/ipc-api.ts`（编辑：新增 `strategy` section）
- `src/preload/index.ts`（编辑：新增 strategy 白名单）

（3 文件）

**核心逻辑：**

`src/shared/types/strategy.ts`（模仿 `src/shared/types/student.ts` 模式）：

```typescript
import type { QuestionPolicyJson, ScoringPolicyJson } from './json-schemas'
export type { QuestionPolicyJson, ScoringPolicyJson }

// schema CHECK 枚举对应
export type StrategyType = 'BASELINE_ASSESSMENT' | 'MOCK_EXAM' | 'TRAINING_PRACTICE'
export type StrategyErrorCode =
  | 'FORBIDDEN' | 'VALIDATION_ERROR' | 'NOT_FOUND'
  | 'DUPLICATE_STRATEGY_ID' | 'DUPLICATE_VERSION' | 'DUPLICATE_JOB_STRATEGY'
  | 'STRATEGY_TYPE_MISMATCH' | 'JOB_CODE_MISMATCH'
  | 'QUESTION_RATIO_MISMATCH'
  | 'INVALID_QUESTION_POLICY' | 'INVALID_SCORING_POLICY'
  | 'REFERENCED_IMMUTABLE' | 'SYSTEM_ERROR'

export type StrategyOpError = { success: false; errorCode: StrategyErrorCode }

// --- list ---
export interface StrategyListParams {
  callerUserId: string; callerRole: string
  strategyType?: StrategyType; jobCode?: string
  isActive?: boolean; includeInactive?: boolean
  page?: number
}
export interface StrategySummary {
  strategyId: string; strategyType: StrategyType; jobCode: string
  strategyName: string; version: number; isActive: boolean
  competentThreshold: number; conditionalThreshold: number
  moduleVetoThreshold: number; emotionCollapseThreshold: number
  onlineQuestionCount: number; offlineQuestionCount: number
  maxScore: number; createdAt: string; updatedAt: string
}
export interface StrategyListSuccess { success: true; items: StrategySummary[]; page: number }

// --- get / listVersions ---
export interface StrategyDetail extends StrategySummary {
  questionPolicy: QuestionPolicyJson
  scoringPolicy: ScoringPolicyJson
  supportsRedlineHalt: boolean; allowsEmotionInterrupt: boolean; requiresOfflineScoring: boolean
}
export interface StrategyGetSuccess { success: true; strategy: StrategyDetail }
export interface StrategyListVersionsSuccess {
  success: true; items: StrategySummary[]
  familyStrategyId: string; familyStrategyType: StrategyType; familyJobCode: string
}

// --- createVersion（新建族 + 新增版本共用）---
export interface StrategyInput {
  strategyId: string; strategyType: StrategyType; jobCode: string
  strategyName: string
  onlineQuestionCount: number; offlineQuestionCount: number; maxScore: number
  competentThreshold: number; conditionalThreshold: number
  moduleVetoThreshold: number; emotionCollapseThreshold: number
  questionPolicy: QuestionPolicyJson; scoringPolicy: ScoringPolicyJson
  supportsRedlineHalt: boolean; allowsEmotionInterrupt: boolean; requiresOfflineScoring: boolean
  version: number; isActive: boolean
}
export interface CreateStrategyVersionParams {
  callerUserId: string; callerRole: string; strategy: StrategyInput
}
export type CreateStrategyVersionResult = { success: true } | StrategyOpError

// --- update ---
export interface UpdateStrategyParams {
  callerUserId: string; callerRole: string
  strategyId: string; version: number
  patch: {
    strategyName?: string
    onlineQuestionCount?: number; offlineQuestionCount?: number; maxScore?: number
    competentThreshold?: number; conditionalThreshold?: number
    moduleVetoThreshold?: number; emotionCollapseThreshold?: number
    questionPolicy?: QuestionPolicyJson; scoringPolicy?: ScoringPolicyJson
    supportsRedlineHalt?: boolean; allowsEmotionInterrupt?: boolean; requiresOfflineScoring?: boolean
  }
}
export type UpdateStrategyResult = { success: true } | StrategyOpError

// --- setActive ---
export interface SetStrategyActiveParams {
  callerUserId: string; callerRole: string
  strategyId: string; version: number; isActive: boolean
}
export type SetStrategyActiveResult = { success: true } | StrategyOpError
```

`src/shared/types/ipc-api.ts` 编辑：在 `IpcApi` 接口加 `strategy` section（顶部 `import type { ... } from './strategy'`，接口内 6 个方法签名，返回类型显式 `| StrategyOpError`）。

`src/preload/index.ts` 编辑：在 `api` 对象加 strategy section（6 个通道全部走 `ipcRenderer.invoke`，参数类型用 `unknown` 与 student 一致）：
```typescript
strategy: {
  list: (params: unknown) => ipcRenderer.invoke('strategy:list', params),
  get: (params: unknown) => ipcRenderer.invoke('strategy:get', params),
  listVersions: (params: unknown) => ipcRenderer.invoke('strategy:listVersions', params),
  createVersion: (params: unknown) => ipcRenderer.invoke('strategy:createVersion', params),
  update: (params: unknown) => ipcRenderer.invoke('strategy:update', params),
  setActive: (params: unknown) => ipcRenderer.invoke('strategy:setActive', params)
}
```

**测试用例：** 类型层无运行时测试；typecheck 覆盖（步骤验收时 `npm run typecheck`）。

**commit message 建议：**
`feat(strategy): add shared types and IPC bridge for strategy config`

---

### Step 3：handler 纯函数 + 注册（核心）

**改动文件：**
- `src/main/ipc/handlers/strategy.ts`（新建，~600 行）
- `src/main/ipc/index.ts`（编辑：import + `registerStrategyHandlers()`）

（2 文件）

**核心逻辑：** 模仿 `src/main/ipc/handlers/student.ts` 模式（纯函数 + DBAdapter 注入 + 惰性 ensureSeeded + `ipcMain.handle` 薄包装）。

**文件结构：**

1. `seedStrategyErrorCodes(db)` — `INSERT OR IGNORE` 错误码到 `error_code_registry`，`error_category='SYSTEM'`（schema CHECK 枚举不含 'STRATEGY_CONFIG'，与 student 决策一致）。码列表：
   - `STRATEGY_CONFIG_CREATED` (INFO, P3)
   - `STRATEGY_CONFIG_VERSION_ADDED` (INFO, P3)
   - `STRATEGY_CONFIG_UPDATED` (INFO, P3)
   - `STRATEGY_CONFIG_ACTIVE_TOGGLED` (INFO, P3)
   - `STRATEGY_CONFIG_REFERENCED_IMMUTABLE_ATTEMPT` (ERROR, P2)（覆盖 PRD §14.3）
   - `STRATEGY_CONFIG_SYSTEM_ERROR` (ERROR, P1)

2. `logStrategyEvent(db, code, severity, strategyId, version, callerUserId, context)` — 写 `error_event_log`：
   ```sql
   INSERT INTO error_event_log
     (error_event_id, error_code, severity, error_category,
      related_aggregate_type, related_aggregate_id, message, context_json, recovery_status, created_at)
   VALUES (?, ?, ?, 'SYSTEM', 'STRATEGY_CONFIG', ?, ?, ?, ?, datetime('now'))
   ```
   `related_aggregate_id = strategyId + ':' + version`（如 `strategy_baseline_shelver:2`）。
   `recovery_status` 同 student：INFO→'IGNORED'，ERROR→'UNRESOLVED'。

3. `listStrategies(db, params)` — 读路径（TEACHER/ADMIN 均可）：
   - `assertCaller` 失败 → FORBIDDEN
   - 默认 `is_active=1`；`includeInactive=true` 时全量；`isActive` 显式过滤优先级最高
   - `strategyType` / `jobCode` 可选过滤
   - 排序 `strategy_id ASC, version DESC`；每页 20 条
   - 返回 `StrategySummary[]`（不含 JSON 全文）

4. `getStrategy(db, params)` — 读路径：
   - `assertCaller` → FORBIDDEN
   - `SELECT * FROM strategy_config WHERE strategy_id=? AND version=?`
   - 不存在 → NOT_FOUND
   - `JSON.parse` `question_policy_json` / `scoring_policy_json`（try/catch，失败按 SYSTEM_ERROR——理论不应发生）

5. `listVersions(db, params)` — 读路径：
   - `assertCaller` → FORBIDDEN
   - `SELECT * FROM strategy_config WHERE strategy_id=? ORDER BY version DESC`
   - 族不存在 → NOT_FOUND
   - 返回所有版本 + family 元信息（`familyStrategyId` / `familyStrategyType` / `familyJobCode`）

6. `createVersion(db, params)` — 写路径（**仅 ADMIN**），核心分支：
   ```
   assertCaller → FORBIDDEN
   if (caller.row.role !== 'ADMIN') return FORBIDDEN  // 写路径额外校验
   // 基础字段校验
   validate strategyId 非空 / strategyType 枚举 / jobCode 非空 / version 整数 >= 1
   validate competentThreshold > conditionalThreshold, 都在 [0,100]
   validate moduleVetoThreshold ∈ [0,1], emotionCollapseThreshold >= 1
   validate onlineQuestionCount >= 0, offlineQuestionCount >= 0, maxScore > 0
   // JSON 校验（调 Step 1 validators）
   qp = validateQuestionPolicy(strategy.questionPolicy, { online, offline })
   if (!qp.ok) return INVALID_QUESTION_POLICY
   sp = validateScoringPolicy(strategy.scoringPolicy,
     { strategyCompetentThreshold: strategy.competentThreshold, strategyConditionalThreshold: strategy.conditionalThreshold })
   if (!sp.ok) return INVALID_SCORING_POLICY
   // 分支：新建族 (version===1) vs 新增版本 (version>=2)
   if (strategy.version === 1) {
     existing = SELECT 1 FROM strategy_config WHERE strategy_type=? AND job_code=? LIMIT 1
     if (existing) return DUPLICATE_JOB_STRATEGY
   } else {
     family = SELECT strategy_type, job_code, MAX(version) AS max_v
              FROM strategy_config WHERE strategy_id=? GROUP BY strategy_type, job_code
     if (!family) return NOT_FOUND
     if (family.strategy_type !== strategy.strategyType) return STRATEGY_TYPE_MISMATCH
     if (family.job_code !== strategy.jobCode) return JOB_CODE_MISMATCH
     if (strategy.version <= family.max_v) return DUPLICATE_VERSION
   }
   // 事务 INSERT
   try {
     db.transaction(() => {
       db.prepare(`INSERT INTO strategy_config (...) VALUES (...)`).run(...)
     })()
   } catch (err) {
     if (String(err).includes('PRIMARY KEY')) return DUPLICATE_STRATEGY_ID
     if (String(err).includes('UNIQUE')) {
       return strategy.version === 1 ? DUPLICATE_JOB_STRATEGY : DUPLICATE_VERSION
     }
     logStrategyEvent(..., 'STRATEGY_CONFIG_SYSTEM_ERROR', 'ERROR', ...)
     return SYSTEM_ERROR
   }
   logStrategyEvent(..., version===1 ? 'STRATEGY_CONFIG_CREATED' : 'STRATEGY_CONFIG_VERSION_ADDED', 'INFO', ...)
   return { success: true }
   ```

7. `updateStrategy(db, params)` — 写路径（**仅 ADMIN**）：
   ```
   assertCaller + role==='ADMIN' 检查 → FORBIDDEN
   target = SELECT * FROM strategy_config WHERE strategy_id=? AND version=?
   if (!target) return NOT_FOUND
   // 引用检查（PRD §14.3）
   referenced = EXISTS(assessment_session matching) OR EXISTS(training_session matching)
   // 合并 patch 得到「合并后逻辑策略」
   merged = { ...target, ...whitelistPicked(patch) }
   // 表列与 level_rules 一致性校验：用合并后值组 ctx 再调 validateScoringPolicy（防「只改表列不改 JSON level_rules min」漂移）
   if (patch touches competentThreshold | conditionalThreshold | moduleVetoThreshold | emotionCollapseThreshold | scoringPolicy) {
     sp = validateScoringPolicy(merged.scoringPolicy,
       { strategyCompetentThreshold: merged.competentThreshold, strategyConditionalThreshold: merged.conditionalThreshold })
     if (!sp.ok) return INVALID_SCORING_POLICY
   }
   if (patch touches online|offline | questionPolicy) {
     qp = validateQuestionPolicy(merged.questionPolicy,
       { onlineQuestionCount: merged.onlineQuestionCount, offlineQuestionCount: merged.offlineQuestionCount })
     if (!qp.ok) return INVALID_QUESTION_POLICY
   }
   if (referenced && patchContainsSemanticFields) {
     logStrategyEvent(..., 'STRATEGY_CONFIG_REFERENCED_IMMUTABLE_ATTEMPT', 'ERROR', ...)
     return REFERENCED_IMMUTABLE
   }
   // 白名单逐字段 UPDATE（模仿 student.ts UPDATE_FIELDS 常量模式）
   for key in patch: if key in UPDATE_FIELDS: db.prepare(`UPDATE ... SET ${col}=? ...`).run(value, ...)
   // 空 patch → success（不写审计）
   // schema 触发器兜底：UPDATE ABORT → 捕获 → REFERENCED_IMMUTABLE + ERROR 审计
   ```

   [!] 关键：`patch` 内任何影响 `scoring_policy_json` 一致性的字段（`competentThreshold` / `conditionalThreshold` / `moduleVetoThreshold` / `emotionCollapseThreshold` / `scoringPolicy`）都必须**组一起**重新校验。实现要点：先 SELECT 完整 target 行，把 patch 叠加得到「合并后的逻辑策略」，再调 `validateScoringPolicy(merged.scoringPolicy, { merged.competentThreshold, merged.conditionalThreshold })`。否则会出现「只改表列不改 JSON `level_rules` min」导致表列与 level_rules 漂移。
   [!] 字段白名单（`UPDATE_FIELDS`）只含语义字段；`strategyId` / `version` / `strategyType` / `jobCode` 不在白名单（静默忽略，与 student.update 一致）。

8. `setActive(db, params)` — 写路径（**仅 ADMIN**）：
   ```
   assertCaller + role==='ADMIN' → FORBIDDEN
   target 存在检查 → NOT_FOUND
   isActive 布尔校验 → VALIDATION_ERROR
   UPDATE strategy_config SET is_active=?, updated_at=datetime('now') WHERE strategy_id=? AND version=?
   // schema 触发器白名单显式允许 is_active，已引用版本也允许
   logStrategyEvent(..., 'STRATEGY_CONFIG_ACTIVE_TOGGLED', 'INFO', ...)
   ```

9. `registerStrategyHandlers(getDb = defaultGetDb)` — 同 student.ts 惰性 ensureSeeded 模式（注册早于 `app.whenReady → initDatabase()`，必须延迟到首次 IPC 调用时 seed）：
   ```typescript
   let codesSeeded = false
   function ensureSeeded(): DBAdapter {
     const db = getDb()
     if (!codesSeeded) { seedStrategyErrorCodes(db); codesSeeded = true }
     return db
   }
   ipcMain.handle('strategy:list', (_e, params) => listStrategies(ensureSeeded(), params))
   // ... 其余 5 个
   ```

`src/main/ipc/index.ts` 编辑：
```typescript
import { registerStrategyHandlers } from './handlers/strategy'
registerStrategyHandlers()
```

**测试用例：** 见 Step 4（测试与 handler 同步开发，commit 拆分仅为 history 清晰）。

**手工验收点：** 启动 Electron，DevTools 调 `await window.api.strategy.list({callerUserId, callerRole, includeInactive:true})` 应返回 seed 2 条。

**commit message 建议：**
`feat(strategy): implement strategy_config CRUD handlers with admin-only writes`

---

### Step 4：handler 集成测试

**改动文件：**
- `src/main/ipc/handlers/__tests__/strategy-create-version.test.ts`（新建）
- `src/main/ipc/handlers/__tests__/strategy-update.test.ts`（新建）
- `src/main/ipc/handlers/__tests__/strategy-read.test.ts`（新建）
- `src/main/ipc/handlers/__tests__/strategy-set-active.test.ts`（新建）
- `src/main/db/test-helpers.ts`（编辑：新增 `seedStrategyReference` 辅助函数）

（5 文件）

**核心逻辑：** 模仿 `student-create.test.ts` 模式：`createTestDb()` + `seedCaller(db, 'ADMIN' | 'TEACHER')` + `beforeEach` 清表 + `baseParams` 工厂。直接调纯函数，不触 `ipcMain` / Electron。

**[!] 引用版本测试辅助函数**（Reviewer Blocker 修复）：assessment_session 有 ~12 个 NOT NULL 字段 + 3 个 FK（student_id→student_profile、strategy_id→strategy_config、created_by→user_account），直接在测试里手写 INSERT 太重。在 `test-helpers.ts` 加一个辅助：

```typescript
/**
 * 在测试 DB 中制造一条对 (strategyId, version) 的引用，用于 REFERENCED_IMMUTABLE / 已引用版本 setActive 测试。
 * - via='assessment'：插一条 assessment_session（assessment_session.strategy_type CHECK
 *   只允许 BASELINE_ASSESSMENT/MOCK_EXAM，故本分支仅用于 BASELINE/MOCK 策略）
 * - via='training'：插一条 training_session（strategy_type 强制 TRAINING_PRACTICE，
 *   故本分支仅用于 TRAINING_PRACTICE 策略）
 * 自动前置插好 student_profile + user_account(STUDENT)（若不存在）。
 */
export function seedStrategyReference(
  db: DBAdapter,
  strategyId: string,
  version: number,
  via: 'assessment' | 'training'
): void
```

实现要点：assessment_session 分支 INSERT 字段最小集（session_id 随机 UUID、student_id、strategy_id、strategy_type='BASELINE_ASSESSMENT'、job_code='SUPERMARKET_SHELVER'、task_code='test-task'、strategy_version、status='COMPLETED'、online/offline_question_count、created_by）；training_session 分支类似（按其 schema NOT NULL 集，实现时查 DDL line 487+ 补字段）。handler 的引用检查与 trigger 都按 `(strategy_id, strategy_version)` 匹配，不校验 strategy_type 一致性，故 assessment 引用可用于 BASELINE/MOCK 策略，training 引用可用于 TRAINING_PRACTICE 策略。

**测试用例矩阵（覆盖 PRD 验收 #1-41）：**

`strategy-create-version.test.ts`：
- 正常：新建族 v1（#1）、新增版本 v2（#13）、跳号 v1→v3（#34）
- 错误码：`DUPLICATE_STRATEGY_ID`（#2）、`DUPLICATE_VERSION`（#3, #15）、`VALIDATION_ERROR`（competent<=conditional #4、competent 超 100 #5、version!=1 建族 #33、moduleVetoThreshold <0 或 >1、emotionCollapseThreshold <1）、`QUESTION_RATIO_MISMATCH`（#6）、`INVALID_QUESTION_POLICY`（#7）、`INVALID_SCORING_POLICY`（level_rules 盲区 #8、score_values 非[0,1,2] #9、level_rules min 与表列漂移 #36/#37、seed 缺 level_rules #40）、`FORBIDDEN`（TEACHER #10、STUDENT #11）、`DUPLICATE_JOB_STRATEGY`（#32）、`STRATEGY_TYPE_MISMATCH`（#14）、`NOT_FOUND`（新增版本时 strategy_id 不存在）、伪造 callerRole（#23）
- 审计：成功写入后 `error_event_log` 一条 INFO，`related_aggregate_type='STRATEGY_CONFIG'`，`related_aggregate_id='sid:version'`（#24）
- 事务回滚：monkey-patch `db.prepare` 抛异常 → `SYSTEM_ERROR` + ERROR 审计
- DB 约束兜底（Reviewer 修正）：MemoryAdapter 单线程同步无真竞态，所谓「并发 TOCTOU」改为验证 DB UNIQUE/PK 的兜底返回码——第一个 `createVersion` 成功后，第二个用相同 (sid, version) 直接调（串行），断言返回 `DUPLICATE_VERSION`（#35）；同 (type,job) 不同 sid 建族，第二个返回 `DUPLICATE_JOB_STRATEGY`（#35b）。这测的是 catch 分支的正确性，不模拟真并发。

`strategy-update.test.ts`：
- 正常：改题量（#16）、改阈值（#16b）、改 JSON（#16c）、改开关（#16d）、改 moduleVetoThreshold / emotionCollapseThreshold、审计 INFO
- `REFERENCED_IMMUTABLE`：先调 `seedStrategyReference(db, strategyId, version, 'assessment')` 制造引用，再 UPDATE → 错误码 + ERROR 审计（#17）。审计断言：`error_event_log` 存一行 `error_code='STRATEGY_CONFIG_REFERENCED_IMMUTABLE_ATTEMPT'` `severity='ERROR'` `recovery_status='UNRESOLVED'`，`related_aggregate_id='sid:version'`
- 静默忽略白名单外字段（#18）
- 空 patch → success 不写审计（#19）
- `NOT_FOUND`（目标不存在）
- level_rules 与表列漂移：只改 `competentThreshold` 不改 `scoringPolicy.level_rules` 中 LEVEL_COMPETENT 首条 min → `INVALID_SCORING_POLICY`
- 触发器兜底：monkey-patch 让引用检查通过但触发 UPDATE ABORT → `REFERENCED_IMMUTABLE`

`strategy-read.test.ts`：
- `list` 默认排除 inactive（#26）、`includeInactive` 含 inactive、`strategyType`/`jobCode` 过滤（#25）、分页（#27）、TEACHER 可读（#12）
- `get` 返回 Detail 含解析后的 JSON、`NOT_FOUND`
- `listVersions` 按 version DESC、`NOT_FOUND`（族不存在）
- `FORBIDDEN`：STUDENT 调读路径

`strategy-set-active.test.ts`：
- 停用未引用版本（#20）
- 停用已引用版本 → 允许（#21）—— 先调 `seedStrategyReference(db, strategyId, version, 'assessment')` 制造引用再调 setActive（schema 触发器白名单显式允许 is_active）
- 启用已停用版本（#22）
- `NOT_FOUND`、`VALIDATION_ERROR`（isActive 非布尔）
- 审计 INFO（#24）
- TEACHER 调用 → FORBIDDEN

**commit message 建议：**
`test(strategy): add integration tests for strategy handlers (41 acceptance scenarios)`

---

### Step 5：路由 + admin 入口 + 列表视图

**改动文件：**
- `src/renderer/src/router/index.ts`（编辑：加 `/admin` 路由 + `/admin` 加入 `protectedPrefixes`；**只注册 list / version-list 两条子路由**，form 路由留给 Step 6——Reviewer Major 修复：避免 lazy import 引用 Step 6 才创建的 `StrategyFormView.vue` 导致 typecheck 失败）
- `src/renderer/src/views/teacher/TeacherLayout.vue`（编辑：ADMIN 时新增「策略配置」导航链接）
- `src/renderer/src/views/admin/StrategyListView.vue`（新建，~250 行）
- `src/renderer/src/views/admin/StrategyVersionListView.vue`（新建，~280 行）

（4 文件）

**核心逻辑：**

`router/index.ts` 编辑：
```typescript
// protectedPrefixes 加 '/admin'
const protectedPrefixes = ['/teacher', '/student', '/admin']

// 新增 /admin 路由（与 /teacher 平级，复用 TeacherLayout——MVP 不为 ADMIN 单建 layout，
// 与 student-profile 决策一致）。本步只注册 list + version-list 两条子路由；
// form 三条子路由（strategies/new、:strategyId/new-version、:strategyId/v/:version）
// 在 Step 6 创建 StrategyFormView.vue 后再补，避免 typecheck 时 lazy import 找不到模块。
{
  path: '/admin',
  component: () => import('../views/teacher/TeacherLayout.vue'),
  children: [
    { path: '', redirect: '/admin/strategies' },
    { path: 'strategies', component: () => import('../views/admin/StrategyListView.vue') },
    { path: 'strategies/:strategyId', component: () => import('../views/admin/StrategyVersionListView.vue') }
  ]
}
```

`TeacherLayout.vue` 编辑（Reviewer Major 修复——明确 nav 条件渲染）：现状 nav 有两条硬编码链接「学生列表」「新建学生」（无 `v-if`）。修改方案：
- 保留「学生列表」「新建学生」对 TEACHER + ADMIN 都可见（ADMIN 也能管学生，`assertCaller` 已允许 ADMIN；功能上无害）
- 在「新建学生」下方加一条 `v-if="auth.role === 'ADMIN'"` 的 `<RouterLink to="/admin/strategies">策略配置</RouterLink>`
- ADMIN 在 `/admin/strategies` 时，由于 route path 不以 `/teacher` 开头，「学生列表」不会高亮（`router-link-active` 只匹配 `/teacher/students`）——这是预期行为，不修；如后续需要高亮 admin 入口，可加 `:class` 显式判断 `route.path.startsWith('/admin')`

```vue
<nav class="nav">
  <RouterLink to="/teacher/students" class="nav-item">学生列表</RouterLink>
  <RouterLink to="/teacher/students/new" class="nav-item">新建学生</RouterLink>
  <RouterLink v-if="auth.role === 'ADMIN'" to="/admin/strategies" class="nav-item">策略配置</RouterLink>
</nav>
```

TEACHER 登录看不到「策略配置」入口；但 TEACHER 手敲 `#/admin/strategies` 仍可进入（读路径允许），UI 在 list/version-list 视图里按 `role !== 'ADMIN'` 隐藏写按钮。

`StrategyListView.vue`：策略族列表（按 `strategy_id` 分组）。模仿 `StudentListView.vue` 模式：
- `onMounted` 调 `window.api.strategy.list({ callerUserId, callerRole, includeInactive: true })`
- 按 `strategyId` 分组展示，每组显示 `strategyType` / `jobCode` / 最新 version / 当前 active 数量
- 过滤栏：`strategyType` 下拉、`jobCode` 文本框、`includeInactive` 复选框
- 每组点击 → 跳 `/admin/strategies/:strategyId`（版本列表）
- `role !== 'ADMIN'` 时隐藏「新建策略」按钮（→ `/admin/strategies/new`）

`StrategyVersionListView.vue`：某 `strategyId` 下所有版本列表：
- `onMounted` 调 `window.api.strategy.listVersions({ callerUserId, callerRole, strategyId })`
- 按 version DESC 展示
- 每行：「编辑」按钮（→ `/:strategyId/v/:version`）、「新增版本」（→ `/:strategyId/new-version`）、启用/停用 toggle（调 `setActive`）
- `role !== 'ADMIN'` 全部隐藏
- setActive 成功后重新拉列表（`fetchVersions()`）

[!] Vue Proxy 展开要点：所有 IPC 调用前必须把 reactive form 展开为普通对象（`{ ...form.value }` 或显式构造），与 `StudentFormView.vue` 一致。

**测试用例：**
- 单元测试：无（视图无独立单测）
- 手工验收：启动应用，ADMIN 登录后能进入 `/admin/strategies` 看到列表；TEACHER 登录看不到入口但手敲 URL 可进入（写按钮隐藏）

**commit message 建议：**
`feat(strategy): add admin routes, nav entry, and list/version-list views`

---

### Step 6：策略表单视图（新建族 / 新增版本 / 编辑 共用）

**改动文件：**
- `src/renderer/src/views/admin/StrategyFormView.vue`（新建，~500 行）
- `src/renderer/src/router/index.ts`（编辑：补 Step 5 留下的 3 条 form 子路由——`strategies/new` / `strategies/:strategyId/new-version` / `strategies/:strategyId/v/:version`，全部 lazy import 到 `StrategyFormView.vue`）

（2 文件）

**路由补全（Step 5 留尾）：**
```typescript
// 在 Step 5 已注册的 /admin children 数组里追加 3 条：
{ path: 'strategies/new', component: () => import('../views/admin/StrategyFormView.vue') },
{ path: 'strategies/:strategyId/new-version', component: () => import('../views/admin/StrategyFormView.vue') },
{ path: 'strategies/:strategyId/v/:version', component: () => import('../views/admin/StrategyFormView.vue') }
```

**核心逻辑：** 单文件支持 3 模式（按 route 判断）：
- `/admin/strategies/new` → **新建族模式**：所有字段可填，`version` 固定 1 且只读，`strategyId` 可填
- `/admin/strategies/:strategyId/new-version` → **新增版本模式**：`strategyId` / `strategyType` / `jobCode` 只读（route params 提供），`version` 自动填 `max+1` 只读，其余字段从当前最新版本预填
- `/admin/strategies/:strategyId/v/:version` → **编辑模式**：`strategyId` / `version` / `strategyType` / `jobCode` 只读，其余字段从目标版本预填

**表单结构**（`fieldset` 分区，模仿 `StudentFormView.vue`）：
- **基础**：strategyId（新建族可填，否则只读）、strategyType（select：3 选项）、jobCode（新建族可填，否则只读）、strategyName、version（只读）、isActive（toggle）
- **题量与满分**：onlineQuestionCount、offlineQuestionCount、maxScore
- **阈值**：competentThreshold、conditionalThreshold、moduleVetoThreshold（number，默认 0.5，step 0.1）、emotionCollapseThreshold（integer，默认 3）（旁注 level_rules 同步提示：「修改阈值需同步 `scoring_policy_json.level_rules` 中对应等级的 min，否则保存会被 `INVALID_SCORING_POLICY` 拒绝」）
- **question_policy_json**：结构化分区（module_scope select、4 题型 ratio input、required_modules 多选、difficulty_distribution raw JSON textarea 可选）+ 原始 JSON textarea（高级模式切换）
- **scoring_policy_json**：结构化分区（safety_override_enabled toggle、level_rules 动态行编辑器：min/max/level 三列，可增删行）+ 原始 JSON textarea。v0.1.8 起 JSON 不再含 `competent_threshold` / `conditional_threshold` / `module_veto_threshold` / `emotion_collapse_threshold` 键；阈值仅存表列，`level_rules` 的 min 须与表列保持一致

[!] level_rules 同步实现（v0.1.8 单源）：改表列 `competentThreshold` 时，reactive `watch` 自动同步 `scoringPolicy.level_rules` 中 LEVEL_COMPETENT 首条的 min；改 `conditionalThreshold` 时同步 LEVEL_CONDITIONAL 首条 min。v0.1.8 不再有 JSON `pass_threshold` / `improve_threshold` 键需要同步。这样减少用户手动同步出错的概率，后端校验是兜底。

[!] seed 兼容提示：编辑模式下 `get` 返回的 `scoringPolicy` 若缺 `level_rules`（历史 seed 遗留），UI 显示醒目提示「该版本 `scoring_policy_json` 缺 `level_rules`（历史 seed 遗留），保存前请补全」（覆盖验收 #40）。

**提交逻辑：**
```typescript
async function submit() {
  // 表单 HTML5 validation 兜底必填
  // 把 reactive form 展开为普通对象（防 Proxy 跨 IPC 报错）
  const strategy: StrategyInput = {
    ...form.value,
    questionPolicy: { ...form.value.questionPolicy },
    scoringPolicy: { ...form.value.scoringPolicy, levelRules: [...form.value.scoringPolicy.levelRules] }
  }
  if (mode === 'create' || mode === 'newVersion') {
    const r = await window.api.strategy.createVersion({ callerUserId, callerRole, strategy })
    if (!r.success) { errorMsg.value = mapStrategyError(r.errorCode); return }
  } else {
    const patch = buildPatch()  // 只含 dirty 字段
    const r = await window.api.strategy.update({ callerUserId, callerRole, strategyId, version, patch })
    if (!r.success) { errorMsg.value = mapStrategyError(r.errorCode); return }
  }
  router.push(`/admin/strategies/${strategy.strategyId}`)
}
```

**错误码中文映射**（集中在一个 `mapStrategyError` 函数）：
- `FORBIDDEN` → 「无权限」
- `DUPLICATE_STRATEGY_ID` → 「策略 ID 已被占用」
- `DUPLICATE_JOB_STRATEGY` → 「该岗位 + 类型下已有策略族」
- `DUPLICATE_VERSION` → 「版本号已存在」
- `QUESTION_RATIO_MISMATCH` → 「题型数量之和不等于 online + offline」
- `INVALID_QUESTION_POLICY` / `INVALID_SCORING_POLICY` → 「策略 JSON 结构错误（详见控制台）」
- `REFERENCED_IMMUTABLE` → 「该版本已被测评/训练引用，不可修改语义字段」
- 其它 → 「操作失败」

**测试用例：**
- 单元测试：无
- 手工冒烟：3 模式分别走通；改阈值不同步 level_rules min 时保存报 `INVALID_SCORING_POLICY`；seed 编辑缺 level_rules 时显示提示

**commit message 建议：**
`feat(strategy): add StrategyFormView for create/new-version/edit modes`

---

### Step 7：E2E 冒烟

**改动文件：**
- `scripts/e2e/strategy-config.mjs`（新建，~300 行）

（1 文件）

**核心逻辑：** 模仿 `student-profile.mjs` 模式（Node 版 Playwright `_electron.launch`，多次启动覆盖不同角色）。覆盖 PRD 验收 #31。

**[!] 前置：ADMIN 账号 seed**——`scripts/seed-dev-accounts.mjs`（或 `.ts` Windows 版）负责给 `user_account` 插 `teacher` / `admin` 等开发账号。跑 E2E 前必须先确保 admin 账号存在：`node scripts/seed-dev-accounts.mjs`（与 student-profile E2E 用同一组账号）。脚本读 package.json appName 定位 Linux `~/.config/<appName>/data/<appName>.db`；Windows 用 `.ts` 版。

```
app A (admin):
  1. ADMIN 登录 → /admin/strategies 列表显示 >=2 条 seed
  2. 新建策略族（TRAINING_PRACTICE 类型，为 5.5 铺路）→ 列表出现
  3. 进入版本列表 → 新增版本 v2 → 看到 v1+v2
  4. 编辑 v2 未引用版本（改题量）→ 成功
  5. 停用 v1 → ACTIVE 数量变化
  6. 启用 v1 → ACTIVE 数量恢复
app B (teacher):
  7. TEACHER 登录 → 手敲 #/admin/strategies → 列表可见（读路径开放）
  8. 「新建策略」「编辑」「停用」按钮均不可见
  9. DevTools 直接调 window.api.strategy.createVersion({...}) → 返回 FORBIDDEN
```

[!] seed 状态依赖：app A step 1 对「初始 seed 数」做软断言（>=2，因可能被前次 E2E 污染）。每次 E2E 用唯一 strategyId（带时间戳）避免冲突。
[!] 管理员账号：由 `scripts/seed-dev-accounts.mjs` 提供（前置已说明），E2E 启动前确认已跑过该脚本。

**测试用例：** E2E 本身是测试；无额外单测。

**commit message 建议：**
`test(strategy): add strategy-config E2E smoke (admin loop + teacher read-only)`

---

## 回归验收清单

每步完成后运行 `/vibe-accept <step-n>`，最终全量：

- [ ] `npm run typecheck` 通过（覆盖 Step 2 类型契约）
- [ ] `npm run build` 通过（main + renderer + preload 三端）
- [ ] `npm run test`（vitest）通过——新增校验工具单测 + handler 集成测试全绿
- [ ] 手工冒烟：ADMIN 完整闭环（新建族 → 新增版本 → 编辑 → 启用/停用）、TEACHER 只读可见
- [ ] E2E `node scripts/e2e/strategy-config.mjs` 全绿（9 步）
- [ ] 回归：`node scripts/e2e/smoke.mjs` + `node scripts/e2e/student-profile.mjs` 不退化
- [ ] PRD §17.6 验收项逐条勾选（41 条，见 Mini-PRD「成功验收标准」）

---

## 项目约束检查（Writer 自检）

- [x] **事件写入顺序**：本功能不写 `action_log.jsonl` / `domain_event_projection`（策略配置是主数据维护，非事件溯源聚合状态变更，与 student-profile 决策一致；PRD §8.7 不含 STRATEGY 事件）。审计写 `error_event_log`（非事件溯源链路），无写入顺序约束
- [x] **新 EventType**：本功能不引入 EventType（同上）
- [x] **IPC 白名单**：Step 2 在 `src/preload/index.ts` 显式声明 6 个通道（strategy:list / get / listVersions / createVersion / update / setActive）
- [x] **无硬编码题量/阈值**：本功能本身是 `strategy_config` 维护工具，题量/阈值全部存表；handler 内部除 schema CHECK 已覆盖的范围（如 `competentThreshold > conditionalThreshold`）外不引入新的硬编码默认值
- [x] **FSM 状态迁移**：本功能不触 `assessment_session` / `training_session` FSM；仅只读查询是否被引用
- [x] **安全红线相关逻辑**：本功能不直接触红线逻辑；`supports_redline_halt` 是策略字段，被 5.4/5.5 消费时才生效。无 [!] 标注触发链
- [x] **JSON 字段校验**：Step 1 两个 validator 覆盖 `question_policy_json` / `scoring_policy_json`，含 level_rules min 与表列一致性 + level_rules 覆盖性（应用层职责，见 PRD 风险点 [!]）
- [x] **schema 不变**：本功能不改 `schema.sql`（v0.1.8 冻结）；错误码通过运行时 `INSERT OR IGNORE` 补 `error_code_registry`，不改 schema CHECK 枚举
- [x] **步骤粒度**：7 步，单步最多 5 文件（Step 1/5 各 4 文件，Step 2/3 各 2-3 文件，Step 4 五文件——4 测试 + `test-helpers.ts` 编辑加 `seedStrategyReference`，Step 6/7 各 1-2 文件），均 ≤5 文件
- [x] **audit 复用**：`logStrategyEvent` 与 `logStudentEvent` 模式一致（`error_category='SYSTEM'`，`related_aggregate_type` 区分）；未来可抽公共工具但 MVP 保留重复以降低耦合风险

---

## Reviewer 审查迭代记录（vibe-impl Step 3）

一审发现 4 项问题，全部已修复：

| 严重度 | 问题 | 修复 |
|---|---|---|
| Blocker | Step 4 REFERENCED_IMMUTABLE 测试需 INSERT assessment_session，但该表 ~12 NOT NULL + 3 FK，实现者会卡在 setup | 在 `test-helpers.ts` 加 `seedStrategyReference(db, strategyId, version, via)` 辅助函数，自动前置插 student_profile + user_account；Step 4 文件数 4→5（仍 ≤5） |
| Major | Step 5 router lazy import 引用 Step 6 才创建的 `StrategyFormView.vue`，typecheck 失败 | Step 5 只注册 list/version-list 子路由；3 条 form 子路由移到 Step 6（StrategyFormView.vue 创建后补） |
| Major | Step 4 措辞「模拟并发 TOCTOU」——MemoryAdapter 单线程同步无真竞态 | 改为「验证 DB UNIQUE/PK 兜底返回码」，串行调两次断言第二次的错误码 |
| Major | Step 5 TeacherLayout nav 条件渲染逻辑未明确 | 明确：保留「学生列表」「新建学生」对 TEACHER+ADMIN 可见；新增 `v-if="auth.role==='ADMIN'"` 的「策略配置」链接；`router-link-active` 不匹配 admin 路径是预期，不强求高亮 |

外加 Minor：Step 7 显式说明 ADMIN 账号由 `scripts/seed-dev-accounts.mjs` 提供，跑 E2E 前需先执行该脚本。

---

## 实现启动检查

进入实现前确认：
- [x] Mini-PRD `strategy-config-prd.md` 已二审定稿
- [x] 本实现文档已通过 Reviewer 审查并迭代修复 4 项问题
- [ ] `git status` 确认当前分支 `feat/strategy-config`（非 main）
- [ ] 从 Step 1 开始执行，每步完成运行 `/vibe-accept <step-n>` 验收
