## 功能名称

任务与岗位配置（管理员维护 `strategy_config`：创建策略 / 新增版本 / 编辑未引用版本 / 启用停用）

文件名：`strategy-config-prd.md`
PRD 版本：v1.0.0
创建日期：2026-07-01
对应主 PRD：炫灿-职途向导系统 MVP PRD v1.0.5（§5.2 任务与岗位配置、§7.6 策略配置版本锁定、§7.2 统一百分制模型、§7.3 结果等级）
对应 schema：`xc-career-guide-mvp-schema-v0.1.8-base-ability-rebalance`
状态：已定稿（二审通过，可进入 /vibe-impl）

---

## 解决的问题

学生档案管理（PR #1）已落地。下一站是 5.4 测评发起 / 5.5 训练分配，两者都强依赖 `strategy_config`：测评题量、题型比例、满分、达标阈值、红线策略、情绪中断策略、是否需要线下评分全部由策略决定，PRD §5.4 与 AGENTS.md「单一策略配置源」原则都禁止在业务代码里硬编码这些值。

当前 schema 仅通过 `schema.sql` 末尾 `INSERT OR IGNORE` 播了 2 条 seed（`strategy_baseline_shelver_v1` / `strategy_mock_shelver_v1`），且**缺 `TRAINING_PRACTICE` 类型策略**——而 `training_session.strategy_type` 只允许 `TRAINING_PRACTICE`（schema CHECK）。没有任何 UI 让管理员查看、新增版本或停用旧版本。如果跳过 5.2 直接做 5.4，要么硬编码题量违反 PRD，要么得在测评功能里夹带写策略——两条路都违反架构原则。

本功能交付一个管理员端策略维护闭环：列表查看、新建策略族、在已有策略族上新增版本（PRD §7.6 的"策略变更=新增版本"）、编辑**未被引用**的版本、启用 / 停用版本。完成后 5.4 / 5.5 可直接按 `strategy_id + strategy_version` 锁定策略。

---

## 用户角色

| 角色 | 在本功能中的能力 |
|---|---|
| `ADMIN` | 创建策略族、新增策略版本、编辑未引用版本、启用 / 停用版本、查看策略列表与详情 |
| `TEACHER` | 只读：查看策略列表与详情（便于发起测评前确认题量阈值，但不允许任何写操作）|
| `STUDENT` | 不可访问本功能任何 IPC |

> PRD §3.3 明确「管理员负责维护策略配置」；§3.2 教师"发起任务测评"需要能看到策略但不应改策略。本 PRD 据此把写路径锁 ADMIN，读路径开放 TEACHER。MVP 阶段 ADMIN 与 TEACHER 共用教师端入口（与 student-profile PRD 决策一致），管理员维护入口路由挂 `/admin/*`。

---

## 核心使用场景（流程步骤）

### 策略族模型（前置说明）

本 PRD 采用「**一族一 strategy_id**」模型：

- **策略族 = `(strategy_type, job_code)` 组合**。一个族内所有版本共享同一个 `strategy_id`。
- **新建策略族** = 新 `strategy_id` + 新 `(strategy_type, job_code)` 组合（或同 `strategy_type` 不同 `job_code`），`version` 必须为 1。
- **新增版本**（PRD §7.6 策略变更原则）= 同 `strategy_id` + 同 `(strategy_type, job_code)` + `version = max(既有) + 1`（跳号允许，见边界条件）。

依据：schema `UNIQUE (strategy_type, job_code, version)` 三元组全局唯一。若允许同 `(type, job_code)` 下多个 `strategy_id`，version 全局分配会导致产品语义混乱（"哪个 strategy_id 是当前活跃族？"无法回答）。本 PRD 在 handler 层强制「同 `(strategy_type, job_code)` 已存在任何 `strategy_id` 时，禁止再新建族」，schema UNIQUE 作为兜底。

### 场景 A：管理员新建策略族（首个版本）

1. 管理员登录后进入 `/admin/strategies`（策略列表页）
2. 点击「新建策略」，进入 `/admin/strategies/new`
3. 填写表单（详见「功能范围」字段清单），其中：
   - **基础**：`strategy_id`（人类可读 slug，如 `strategy_baseline_shelver`，全局唯一）、`strategy_type`、`job_code`、`strategy_name`、`version`（固定 1，UI 只读）
   - **题量与满分**：`online_question_count`、`offline_question_count`、`max_score`
   - **阈值**：`competent_threshold`、`conditional_threshold`（必须 `competent > conditional`）
   - **策略 JSON**：`question_policy_json`、`scoring_policy_json`（表单提供结构化输入或 JSON 文本框，详见「功能范围」）
   - **开关**：`supports_redline_halt`、`allows_emotion_interrupt`、`requires_offline_scoring`、`is_active`
4. 点击「保存」，渲染进程将 `form` 展开为普通对象后调用 `window.api.strategy.createVersion({ callerUserId, callerRole, strategy })`
5. 主进程 `strategy:createVersion` handler：
   - 校验调用者角色 `callerRole = 'ADMIN'`（写路径锁管理员）
   - 校验 `version === 1`（新建族硬性要求）
   - 校验 `strategy_id` 非空
   - **校验 `(strategy_type, job_code)` 不存在任何已建族**（`SELECT 1 FROM strategy_config WHERE strategy_type=? AND job_code=? LIMIT 1`，否则返回 `DUPLICATE_JOB_STRATEGY`，避免破坏一族一 strategy_id 模型）
   - 校验 `competent_threshold > conditional_threshold`
   - 校验 `question_policy_json` 结构（按 JSON 字段规范 §5）
   - 校验 `scoring_policy_json` 结构（按 JSON 字段规范 §6），**且 `scoring_policy_json` 不再含 `competent_threshold` / `conditional_threshold` / `module_veto_threshold` / `emotion_collapse_threshold` 键（schema v0.1.8 已将这些提升为表列），改为校验 `level_rules` 中 `LEVEL_COMPETENT` 首条 `min` 必须等于表列 `competent_threshold`、`LEVEL_CONDITIONAL` 首条 `min` 必须等于表列 `conditional_threshold`**（防 level_rules 与表列漂移，见边界条件）
   - 校验附录 A 跨字段一致性：`sum(question_ratio.values) === online_question_count + offline_question_count`（缺失题型 key 按 0 处理）
   - 事务内 INSERT `strategy_config`（捕获 `strategy_id` PRIMARY KEY 冲突转 `DUPLICATE_STRATEGY_ID`；理论 (type, job_code, version) UNIQUE 冲突已被前置校验挡住，兜底返回 `DUPLICATE_VERSION`）
   - 事务提交后写 `error_event_log` INFO 审计
6. 返回 `{ success: true }`，渲染进程跳回 `/admin/strategies`

### 场景 B：管理员为已有策略族新增版本（PRD §7.6 策略变更原则）

1. 在策略列表点击某策略族（按 `strategy_id` 分组），进入 `/admin/strategies/:strategyId`（版本列表页）
2. 点击「新增版本」，进入 `/admin/strategies/:strategyId/new-version`
3. 表单预填当前最新版本的语义字段（题量、阈值、开关、策略 JSON），`version` 自动填为 `max(existing versions) + 1`（允许跳号，见边界条件），`strategy_id` / `strategy_type` / `job_code` **只读不可改**（变更三者等价于新建策略族，应走场景 A）
4. 管理员修改需要调整的字段（如降低 `competent_threshold`、调整 `question_ratio`），点击「保存」
5. 渲染进程调用 `window.api.strategy.createVersion({ callerUserId, callerRole, strategy })`（同场景 A 的 IPC，handler 内部通过 `version > 1` 判断是新增版本）
6. handler 校验：
   - `strategy_id` 必须已存在（否则 `NOT_FOUND`）
   - 新 `version` 必须 > 该 `strategy_id` 当前 max version（跳号允许；`<= max` 返回 `DUPLICATE_VERSION`）
   - 新 `version` 必须 >= 2（新建族走场景 A）
   - `strategy_type` / `job_code` 必须与既有版本一致（否则 `STRATEGY_TYPE_MISMATCH` / `JOB_CODE_MISMATCH`）
   - 其余字段校验同场景 A
7. INSERT 新版本行，写 INFO 审计
8. 旧版本不受影响（PRD §7.6「进行中的 session 不受管理员后续新增策略版本影响」由 session 创建时锁定 `strategy_version` 保证，本 PRD 不实现该锁定——是 5.4 / 5.5 的职责）

### 场景 C：管理员编辑**未被引用**的版本

1. 在版本列表点击某版本，进入 `/admin/strategies/:strategyId/v/:version`（编辑页）
2. 修改字段（如调整 `question_ratio`），点击「保存」
3. 渲染进程调用 `window.api.strategy.update({ callerUserId, callerRole, strategyId, version, patch })`
4. handler 校验：
   - 目标存在（否则 `NOT_FOUND`）
   - **目标未被任何 session 引用**（`NOT EXISTS assessment_session ... OR training_session ...`，否则 `REFERENCED_IMMUTABLE`，对应 PRD §14.3 审计项「尝试修改已引用策略版本」）
   - `patch` 字段白名单校验（详见功能范围）
   - `patch` 内的 JSON 字段结构校验同场景 A
   - `strategy_id` / `strategy_type` / `job_code` / `version` 不可通过 update 修改（白名单不含）
5. UPDATE 对应字段 + `updated_at = datetime('now')`，写 INFO 审计
6. 若运行时因 schema 触发器 `trg_strategy_config_referenced_version_semantic_immutable` ABORT（理论不应发生，因步骤 4 已挡），捕获并写 ERROR 审计，返回 `REFERENCED_IMMUTABLE`

### 场景 D：管理员启用 / 停用版本

1. 在版本列表点击某版本旁的「停用」/「启用」按钮
2. 渲染进程调用 `window.api.strategy.setActive({ callerUserId, callerRole, strategyId, version, isActive })`
3. handler：UPDATE `is_active = ?`，写 INFO 审计
4. **此操作对已引用版本也允许**（schema 触发器的 immutability 白名单显式允许 `is_active` 与 `updated_at`）

> **不限制 `(strategy_type, job_code)` 下同时只能有一个 `is_active=1`**：schema 未强制该 UNIQUE，PRD 也未要求。MVP 允许多版本同时 active，由 5.4 / 5.5 测评发起时显式选版本。Mini-PRD 不加此应用层约束，避免在 schema 没要求的地方过度设计。

### 场景 E：教师只读查看策略

1. 教师（`callerRole = 'TEACHER'`）进入 `/admin/strategies`（与 ADMIN 共用路由，UI 隐藏所有写按钮）
2. 调用 `strategy:list` / `strategy:get`，handler 不阻止（读路径开放 TEACHER）
3. 任何写 IPC 调用（createVersion / update / setActive）→ handler 返回 `FORBIDDEN`

---

## 功能范围

### 本次做

**IPC handler（`src/main/ipc/handlers/strategy.ts`）**

- `strategy:list` — 分页 / 过滤查询：参数 `strategyType?` / `jobCode?` / `isActive?` / `includeInactive?`（默认 false）/ `page`；按 `strategy_id ASC, version DESC` 排序，每页 20 条；返回摘要列表（不含策略 JSON 全文，详情走 `get`）
- `strategy:get` — 查询单个版本详情（解析 `question_policy_json` / `scoring_policy_json` 为对象）
- `strategy:listVersions` — 查询某 `strategy_id` 下所有版本（版本列表页用，按 `version DESC`）
- `strategy:createVersion` — 创建新策略族（version=1）或新增版本（version>1）；事务 INSERT
- `strategy:update` — 编辑**未被引用**版本的语义字段（白名单）；已被引用版本仅允许通过 `setActive` 改 `is_active`
- `strategy:setActive` — 启用 / 停用版本（对已引用版本也允许）

**类型与桥接**

- `src/shared/types/strategy.ts` — 新增 `StrategyRow` / `StrategySummary` / `StrategyDetail` / `CreateStrategyParams` / `UpdateStrategyParams` / `SetStrategyActiveParams` / 各 Result 类型；复用 `src/shared/types/json-schemas.ts` 已声明的 `QuestionPolicyJson` / `ScoringPolicyJson` / `LevelRule`
- `src/shared/types/ipc-api.ts` — 在 `IpcApi` 接口新增 `strategy` section
- `src/preload/index.ts` — 暴露 `window.api.strategy.{list, get, listVersions, createVersion, update, setActive}` 白名单

**校验工具**

- `src/main/utils/validate-question-policy.ts` — `validateQuestionPolicy(json, ctx)` 返回 `{ ok, value? }`；校验：
  - `module_scope ∈ {SINGLE_MODULE, CROSS_MODULE}`
  - `question_ratio`（可选 key）缺失视为 0；存在的 key 值为非负整数
  - `required_modules`（若存在）非空数组，各值属于 `AbilityTag` 枚举
  - `difficulty_distribution`（若存在）各值为数值且和约为 1.0（容差 0.001）；缺失时直接通过
  - `sensory_filter_mode` / `fallback_strategy`（若存在）枚举合法
  - **跨字段**：`sum(question_ratio.values, 缺失按 0) === online_question_count + offline_question_count`（ctx 传入这两个 count）。例：`{TRUE_FALSE:14,SINGLE_CHOICE:14,DRAG:14,OFFLINE_OPERATION:8}` 与 online=42, offline=8 → sum=50 ✓
- `src/main/utils/validate-scoring-policy.ts` — `validateScoringPolicy(json, ctx)` 返回 `{ ok, value? }`；ctx 含 `{ strategyCompetentThreshold, strategyConditionalThreshold, strategyModuleVetoThreshold, strategyEmotionCollapseThreshold }`（表列值）；校验：
  - `score_values === [0, 1, 2]`（严格相等）
  - `normalization === 'raw_score/max_score*100'`
  - **schema v0.1.8 后 JSON 不再含 threshold 键**：`competent_threshold` / `conditional_threshold` / `module_veto_threshold` / `emotion_collapse_threshold` 由 `strategy_config` 表列承载（DEFAULT 80 / 60 / 0.5 / 3），handler 直接校验表列值；JSON 中若仍出现这些键视为非法（返回 `INVALID_SCORING_POLICY`，消息含"scoring_policy_json 不得再含 threshold/module_veto/emotion_collapse 键，schema v0.1.8 已提升为表列"）
  - `safety_override_enabled` 为布尔
  - `level_rules` 非空数组，每条 `{ min, max, level }`：`min <= max`、`level ∈ {LEVEL_COMPETENT, LEVEL_CONDITIONAL, LEVEL_NOT_COMPETENT}`
  - **覆盖性**：`level_rules` 排序后必须连续覆盖 `[0, 100]` 无盲区无重叠（min 从 0 起，相邻 max+1=min，最后 max=100）
  - **level_rules ↔ 表列一致性**（替代旧双源一致性）：`level_rules` 中 `LEVEL_COMPETENT` 首条 `min` 必须等于表列 `competent_threshold`，`LEVEL_CONDITIONAL` 首条 `min` 必须等于表列 `conditional_threshold`（否则返回 `INVALID_SCORING_POLICY`，消息含"level_rules 的下界与表列 threshold 不一致"）。表列为权威源，JSON 不再重复定义阈值
  - **新表列范围校验**：`module_veto_threshold ∈ [0, 1]`（REAL），`emotion_collapse_threshold >= 1`（INTEGER）；不满足返回 `VALIDATION_ERROR`（schema CHECK 兜底 ABORT）
  - **seed 兼容**：seed 数据 `scoring_policy_json` 现已含 `level_rules`（v0.1.8 seed 已修正，见风险点），本 handler 在 `ensureSeeded` 时按统一规则校验；管理员编辑 seed 版本时无需额外补全

**渲染进程**

- `src/renderer/src/views/admin/StrategyListView.vue` — 策略族列表（按 `strategy_id` 分组，显示 `strategy_type` / `job_code` / 最新 version / 当前 active 数量），ADMIN 可见「新建策略」按钮
- `src/renderer/src/views/admin/StrategyVersionListView.vue` — 某 `strategy_id` 下所有版本列表，ADMIN 可见「新增版本」/「编辑」/「启用 / 停用」
- `src/renderer/src/views/admin/StrategyFormView.vue` — 新建策略族 + 新增版本 + 编辑未引用版本 共用表单（按模式区分只读字段），策略 JSON 提供结构化分区 + 原始 JSON 文本框两种输入方式。**level_rules ↔ 表列同步提示**：表列 `competent_threshold` / `conditional_threshold` 字段旁标注"`scoring_policy_json.level_rules` 中 `LEVEL_COMPETENT` / `LEVEL_CONDITIONAL` 首条 `min` 必须等于对应表列值，否则保存会被 `INVALID_SCORING_POLICY` 拒绝"（schema v0.1.8 后 JSON 不再含 threshold 键，仅 `level_rules` 与表列需保持一致）；推荐 UI 实现：改表列阈值时自动同步写入 `level_rules` 对应条目的 `min`
- 路由注册为 `/admin` 的 children；`/admin` 入口由 `TeacherLayout` 复用（MVP 不为 ADMIN 单建 layout，与 student-profile 决策一致）
- Pinia `useAuthStore` 提供 `userId` / `role`；UI 根据 `role !== 'ADMIN'` 隐藏写按钮

**审计**

- 复用 `error_event_log`，`error_category='SYSTEM'`（schema CHECK 枚举不含 `'STRATEGY_CONFIG'`，与 student-profile 决策一致），`severity='INFO'`，`related_aggregate_type='STRATEGY_CONFIG'`，`related_aggregate_id = strategy_id + ':' + version`（如 `strategy_baseline_shelver:2`，便于按版本查审计；`context_json` 仍冗余写 `strategyId` / `version` / `callerUserId` / 变更字段）
- createVersion / update / setActive 各写一条 INFO
- 尝试修改已引用版本被 schema 触发器 ABORT（理论 4 步已挡，触发器是兜底）→ 写 ERROR 审计 + 返回 `REFERENCED_IMMUTABLE`，覆盖 PRD §14.3 审计项

### 本次不做

- **物理删除策略**：PRD §14.4 禁止物理删除核心业务数据；schema 无软删字段（`strategy_config` 无 `status` 列）。停用等价于 `is_active=0`
- **新建 job / task 独立配置表**：schema v0.1.8 冻结，`strategy_config.job_code` 字符串字段已承载岗位标识；`task_code` 仅出现在 `assessment_session` / `training_session`，留给 5.4 在测评发起时作为 session 属性，本 PRD 不建模 job/task 主数据表
- **引入 STRATEGY_CONFIG 领域事件 / 写 `domain_event_projection`**：策略配置是主数据维护，不是事件溯源聚合状态变更，与 student-profile 决策一致；PRD §8.7 列出的领域事件不含 STRATEGY 相关，审计需求由 `error_event_log` 满足
- **强制 `(strategy_type, job_code)` 下单 active 版本**：schema 未强制 UNIQUE，PRD 未要求；多 active 由 5.4 / 5.5 显式选版本解决
- **`strategy_snapshot_json` 写入**：JSON 字段规范 §7 标注"MVP 阶段 nullable"；snapshot 写入由 5.5 `training_session` 创建时负责，本 PRD 不写
- **seed `TRAINING_PRACTICE` 策略**：seed 在 `schema.sql` 末尾，本 PRD 不改 schema；管理员可通过本功能 UI 手动创建（schema CHECK 已允许 `strategy_type='TRAINING_PRACTICE'`）。**记录为 5.4 / 5.5 启动前置依赖**——见风险点
- **批量导入策略**：MVP 单机本地，管理员手动维护可接受
- **策略版本对比工具**（diff v1 vs v2）：MVP 不做，列表已能看到各版本字段
- **修改 `strategy_id` / `strategy_type` / `job_code` / `version`**：update 白名单不含；变更三者等价于新建策略族，应走 createVersion

---

## 边界条件和异常处理

| 场景 | 处理 |
|---|---|
| `callerRole = 'STUDENT'` 调任意 strategy handler | 返回 `FORBIDDEN`，不执行 |
| `callerRole = 'TEACHER'` 调写 handler（createVersion / update / setActive）| 返回 `FORBIDDEN`；读 handler（list / get / listVersions）允许 |
| `callerRole` 缺失，或调用者本人 `user_account.status != ACTIVE` | 返回 `FORBIDDEN`（assertCaller 已有逻辑，复用） |
| `callerRole = 'ADMIN'` 但 `user_account.role` 实际非 ADMIN | assertCaller 返回 FORBIDDEN（DB 层角色为准，不信任 IPC 传入的 callerRole） |
| `strategy_id` 空字符串或超长 | handler 校验，返回 `VALIDATION_ERROR` |
| `version < 1` 或非整数 | 返回 `VALIDATION_ERROR` |
| `competent_threshold <= conditional_threshold` | schema CHECK 在 INSERT 时 ABORT，handler 校验先行返回 `VALIDATION_ERROR`；兜底捕获 ABORT 返回 `SYSTEM_ERROR` |
| `competent_threshold` / `conditional_threshold` 超出 `[0, 100]` | schema CHECK ABORT，handler 先行校验返回 `VALIDATION_ERROR` |
| `module_veto_threshold` 超出 `[0, 1]` | schema CHECK ABORT，handler 先行校验返回 `VALIDATION_ERROR` |
| `emotion_collapse_threshold < 1` | schema CHECK ABORT，handler 先行校验返回 `VALIDATION_ERROR` |
| `online_question_count < 0` 或 `offline_question_count < 0` | schema CHECK ABORT，handler 先行校验返回 `VALIDATION_ERROR` |
| `max_score <= 0` | schema CHECK ABORT，handler 先行校验返回 `VALIDATION_ERROR` |
| `sum(question_ratio) !== online + offline` | handler 跨字段校验返回 `QUESTION_RATIO_MISMATCH`（附录 A 强制项） |
| `question_policy_json` 结构非法（module_scope 枚举越界、required_modules 非法、difficulty_distribution 和偏离 1.0） | 返回 `INVALID_QUESTION_POLICY` |
| `scoring_policy_json` 结构非法（score_values 非 [0,1,2]、normalization 错误、level_rules 盲区 / 重叠 / 覆盖不完整） | 返回 `INVALID_SCORING_POLICY` |
| `strategy_type` / `job_code` 不在 schema CHECK 允许范围 | schema CHECK ABORT，handler 先行校验返回 `VALIDATION_ERROR` |
| 新增版本时 `strategy_id` 不存在（首次 version 应 = 1） | 返回 `NOT_FOUND` |
| 新增版本时 `version <= max(existing versions)` | 返回 `DUPLICATE_VERSION`（schema UNIQUE (type, job_code, version) 兜底） |
| 新增版本时 `strategy_type` / `job_code` 与既有版本不一致 | 返回 `STRATEGY_TYPE_MISMATCH` / `JOB_CODE_MISMATCH`（防脏数据；schema UNIQUE (type, job_code, version) 兜底） |
| `UNIQUE (strategy_id)` 冲突（建族时 strategy_id 已被占用） | schema PRIMARY KEY 冲突，捕获返回 `DUPLICATE_STRATEGY_ID` |
| `UNIQUE (strategy_type, job_code, version)` 冲突（并发 TOCTOU 场景） | 捕获后按 `version === 1` 分支：建族场景返回 `DUPLICATE_JOB_STRATEGY`（产品语义是族已存在），新增版本场景返回 `DUPLICATE_VERSION`。实现建议：catch 后再 `SELECT` 判断是 PK 还是 UNIQUE(type,job,version) 冲突，后者按 version 分支返回码 |
| 编辑目标版本不存在 | 返回 `NOT_FOUND` |
| 编辑目标版本已被 `assessment_session` 或 `training_session` 引用 | 返回 `REFERENCED_IMMUTABLE`，覆盖 PRD §14.3「尝试修改已引用策略版本」审计项 |
| update patch 含白名单外字段（strategy_id / version / strategy_type / job_code） | 静默忽略（与 student.update 一致） |
| update patch 为空（或只含白名单外字段） | 返回 `success: true`，不写审计（无变更） |
| update 时 schema 触发器 `trg_strategy_config_referenced_version_semantic_immutable` ABORT | 理论不应发生（前置挡），兜底捕获写 ERROR 审计 + 返回 `REFERENCED_IMMUTABLE` |
| `setActive` 目标不存在 | 返回 `NOT_FOUND` |
| `setActive` 目标已引用版本 | **允许**（schema 触发器白名单显式允许 is_active），照常 UPDATE |
| `setActive` `isActive` 非布尔值 | 返回 `VALIDATION_ERROR` |
| DB 未初始化 | `getDatabase()` 抛出，handler 捕获返回 `SYSTEM_ERROR` |
| IPC 异常 | 主进程 try/catch，写 `error_event_log`（severity=ERROR），返回 `SYSTEM_ERROR` |
| 列表为空 | 前端展示空状态引导（「点击新建策略开始」） |
| `form.value`（Vue Proxy）直接传入 IPC | **必须展开为普通对象**再传（与 student.create 一致） |
| 策略 JSON 文本框解析失败（前端允许原始 JSON 输入） | 前端 JSON.parse 阻断提交；绕过前端则后端校验返回 `INVALID_QUESTION_POLICY` / `INVALID_SCORING_POLICY` |
| 新建族时 `(strategy_type, job_code)` 已存在任何 `strategy_id` | 返回 `DUPLICATE_JOB_STRATEGY`（一族一 strategy_id 模型，schema UNIQUE 兜底） |
| 新建族时 `version != 1` | 返回 `VALIDATION_ERROR` |
| 新增版本时 `version > max(existing) + 1`（跳号，如 v1 → v3） | **允许**（PRD §17.6 第 7 项未禁止，schema 不拦），返回 `success: true` 并写入 |
| 新增版本时 `version` 是小数或负数 | 返回 `VALIDATION_ERROR` |
| 并发两个 IPC 同时为同 `strategy_id` 新增同 `version` | 一个成功，另一个 PRIMARY KEY 或 UNIQUE 冲突，捕获返回 `DUPLICATE_VERSION`；handler 不预分配 version（由前端传，并发场景由 DB UNIQUE 兜底） |
| 并发两个 IPC 同时新建同 `(strategy_type, job_code)` 不同 `strategy_id` 的族 | 前置校验 TOCTOU 都通过，INSERT 时第二个命中 UNIQUE (type,job,version)；按 `version===1` 分支返回 `DUPLICATE_JOB_STRATEGY`（见上 UNIQUE 冲突行） |
| `question_ratio` 缺失部分题型 key（如只有 TRUE_FALSE） | 缺失 key 按 0 处理，仍执行 sum 校验（见 validate-question-policy） |
| `difficulty_distribution` 缺失 | 直接通过（optional 字段） |
| `scoring_policy_json` 仍含 `competent_threshold` / `conditional_threshold` / `module_veto_threshold` / `emotion_collapse_threshold` 键 | 返回 `INVALID_SCORING_POLICY`（schema v0.1.8 已将这些提升为表列，JSON 不得重复定义） |
| `scoring_policy_json.level_rules` 与表列 threshold 不一致（LEVEL_COMPETENT 首条 min != competent_threshold） | 返回 `INVALID_SCORING_POLICY` |
| `module_veto_threshold` 超出 `[0, 1]` | 返回 `VALIDATION_ERROR` |
| `emotion_collapse_threshold < 1` | 返回 `VALIDATION_ERROR` |
| 编辑 seed 版本（`strategy_baseline_shelver_v1` 等）时 `level_rules` 与表列 threshold 不一致 | 返回 `INVALID_SCORING_POLICY`，提示"请对齐 level_rules 与表列 threshold" |
| `strategy_type='TRAINING_PRACTICE'` 但 `job_code` 不是理货员岗位 | schema 不校验 job_code 内容（TEXT 字段），handler 也不校验岗位合法性；MVP 单岗位（`SUPERMARKET_SHELVER`）接受管理员自由填写，5.4/5.5 会按 job_code 查策略 |
| `setActive` 停用已引用版本后，5.4/5.5 仍可创建新 session 引用该版本 | schema `trg_assessment_session_strategy_config_match_insert` 不校验 `is_active`；本 PRD 不阻止，5.4/5.5 需自行决定是否过滤 `is_active=0`（见接口关系） |

---

## 与现有功能的接口关系

| 资源 | 关系 |
|---|---|
| `strategy_config` 表 | 本功能核心读写对象；schema 已有 `trg_strategy_config_referenced_version_semantic_immutable` 触发器强制"已引用版本不可改语义字段" |
| `assessment_session` 表 | 只读：判断某 `(strategy_id, version)` 是否已被引用（`UPDATE` 前置校验）；5.4 测评发起功能将消费本功能产出的策略 |
| `training_session` 表 | 同上；5.5 训练分配功能将消费本功能产出的策略。**注意**：`training_session.strategy_id` DDL 允许 NULL，但 schema trigger `trg_training_session_strategy_config_match_insert` 禁止 NULL 写入（PRD §7.6 第 9 项），5.5 实现时必须传非空 strategy_id |
| `strategy_config.is_active` 与 session 创建 | schema 的 session strategy 一致性触发器**不校验 `is_active`**。停用版本仍可被新 session 引用。5.4/5.5 测评发起时需自行决定是否过滤 `is_active=0`（推荐：UI 默认只列 active，但允许教师显式选 inactive 版本以支持历史复测） |
| `error_event_log` 表 | createVersion / update / setActive 写 INFO；系统异常或 schema ABORT 写 ERROR |
| `error_code_registry` 表 | handler 启动时 `INSERT OR IGNORE` 补充本功能错误码（`error_category='SYSTEM'`，不改 schema.sql） |
| `src/main/db/connection.ts` | `getDatabase()` 由 handler 调用 |
| `src/main/utils/auth-context.ts` | `assertCaller` 复用；写路径额外校验 `callerRole = 'ADMIN'` |
| `src/main/ipc/handlers/student.ts` | 实现模式参考（纯函数 + DBAdapter 注入 + seed 错误码 + 惰性 ensureSeeded） |
| `src/main/ipc/index.ts` | import `./handlers/strategy` 完成注册 |
| Pinia `useAuthStore` | 提供 `userId` / `role` 作为 IPC caller 身份 |
| 全局路由守卫 | 已保护 `/admin/*`（与 `/teacher/*` 一致），未登录自动跳 `/login` |
| 5.4 测评发起功能 | **本功能是 5.4 硬前置**：5.4 需要 `strategy_config` 行才能创建 `assessment_session`（schema `trg_assessment_session_strategy_config_match_insert` 强校验） |
| 5.5 训练分配功能 | **本功能是 5.5 硬前置**：同上；且需 `TRAINING_PRACTICE` 类型策略存在（当前 seed 缺失，见风险点） |
| 报告生成功能（后续） | 通过 `assessment_session.strategy_id + strategy_version` 复现当时策略（PRD §7.6 历史可复现） |

---

## 成功验收标准

| # | 场景 | 预期结果 |
|---|---|---|
| 1 | ADMIN 填写完整表单创建新策略族（version=1） | `strategy_config` 写入，跳回列表，列表可见 |
| 2 | 创建时 `strategy_id` 已被占用 | 返回 `DUPLICATE_STRATEGY_ID`，不写入 |
| 3 | 创建时 `(strategy_type, job_code, version)` 已存在 | 返回 `DUPLICATE_VERSION`，不写入 |
| 4 | 创建时 `competent_threshold <= conditional_threshold` | 返回 `VALIDATION_ERROR`（handler 先行校验） |
| 5 | 创建时 `competent_threshold` 超出 `[0,100]` | 返回 `VALIDATION_ERROR` |
| 5b | 创建时 `module_veto_threshold` 超出 `[0,1]` 或 `emotion_collapse_threshold < 1` | 返回 `VALIDATION_ERROR` |
| 6 | 创建时 `sum(question_ratio) !== online + offline count` | 返回 `QUESTION_RATIO_MISMATCH`（附录 A） |
| 7 | 创建时 `question_policy_json.module_scope` 枚举越界 | 返回 `INVALID_QUESTION_POLICY` |
| 8 | 创建时 `scoring_policy_json.level_rules` 未覆盖 `[0,100]`（盲区或重叠） | 返回 `INVALID_SCORING_POLICY` |
| 9 | 创建时 `scoring_policy_json.score_values` 非 `[0,1,2]` | 返回 `INVALID_SCORING_POLICY` |
| 10 | TEACHER 调用 `strategy:createVersion` | 返回 `FORBIDDEN` |
| 11 | STUDENT 调用任意 strategy handler | 返回 `FORBIDDEN` |
| 12 | TEACHER 调用 `strategy:list` / `strategy:get` | 正常返回（读路径开放） |
| 13 | ADMIN 为已有策略族新增版本（version=2） | 新版本写入，旧版本不受影响，审计 INFO 写入 |
| 14 | 新增版本时 `strategy_type` 与既有版本不一致 | 返回 `STRATEGY_TYPE_MISMATCH` |
| 15 | 新增版本时 `version <= max(existing)` | 返回 `DUPLICATE_VERSION` |
| 16 | ADMIN 编辑未被引用版本（改题量 `online/offline_question_count`） | 字段更新，`updated_at` 刷新，审计 INFO 写入（PRD §17.6 第 1 项正向） |
| 16b | ADMIN 编辑未被引用版本的 `competent_threshold` / `conditional_threshold` / `module_veto_threshold` / `emotion_collapse_threshold` | 成功更新（PRD §17.6 第 1 项要求覆盖多字段可改） |
| 16c | ADMIN 编辑未被引用版本的 `question_policy_json` / `scoring_policy_json` | 成功更新，校验通过 |
| 16d | ADMIN 编辑未被引用版本的 `supports_redline_halt` / `allows_emotion_interrupt` / `requires_offline_scoring` 开关 | 成功更新 |
| 17 | ADMIN 编辑已被 session 引用的版本 | 返回 `REFERENCED_IMMUTABLE`，审计 ERROR 写入（覆盖 PRD §14.3） |
| 18 | update patch 含 `strategy_id` / `version` | 静默忽略这些字段 |
| 19 | update patch 为空 | 返回 `success: true`，不写审计 |
| 20 | ADMIN 停用某未引用版本 | `is_active=0`，审计 INFO |
| 21 | ADMIN 停用某已被引用的版本 | **允许**（schema 触发器白名单），`is_active=0`，审计 INFO |
| 22 | ADMIN 启用某已停用版本 | `is_active=1`，审计 INFO |
| 23 | `callerRole` 与 `user_account.role` 不一致（伪造） | 返回 `FORBIDDEN`（DB 层为准） |
| 24 | 每次写操作写 `error_event_log` | createVersion / update / setActive 各一条 INFO，`error_category='SYSTEM'`，`related_aggregate_type='STRATEGY_CONFIG'`，`related_aggregate_id = strategy_id:version`，`context_json` 含 `strategyId` + `version` + `callerUserId` |
| 25 | 列表按 `strategy_type` / `jobCode` 过滤 | 仅返回匹配项 |
| 26 | 列表默认排除 `is_active=0` | `includeInactive=true` 时才返回停用版本 |
| 27 | 列表分页 | 默认每页 20 条，按 `strategy_id ASC, version DESC` |
| 28 | 类型检查 | `npm run typecheck` 通过 |
| 29 | 构建 | `npm run build` 通过 |
| 30 | 单元测试 | vitest 覆盖：纯函数各错误码、JSON 校验跨字段一致性、已引用 / 未引用分支 |
| 31 | E2E（仿 student-profile.e2e） | ADMIN 完整闭环：登录 → 新建策略族 → 新增版本 → 编辑未引用版本成功 → 尝试编辑已引用版本返回 `REFERENCED_IMMUTABLE` → 停用 → 启用；TEACHER 登录后只读可见列表/详情，但「新建/编辑/停用」按钮不可见且 IPC 返回 `FORBIDDEN` |
| 32 | 新建族时 `(strategy_type, job_code)` 已存在 | 返回 `DUPLICATE_JOB_STRATEGY`（一族一 strategy_id 模型） |
| 33 | 新建族时 `version != 1` | 返回 `VALIDATION_ERROR` |
| 34 | 新增版本时跳号（v1 → v3） | **允许**，写入成功，审计 INFO |
| 35 | 并发两个 IPC 同时为同 `strategy_id` 新增同 `version` | 一个成功，另一个返回 `DUPLICATE_VERSION` |
| 35b | 并发两个 IPC 同时新建同 `(strategy_type, job_code)` 不同 `strategy_id` 的族 | 一个成功，另一个返回 `DUPLICATE_JOB_STRATEGY`（version===1 分支） |
| 36 | 创建/编辑时 `scoring_policy_json.level_rules` 中 `LEVEL_COMPETENT` 首条 `min` 不等于表列 `competent_threshold` | 返回 `INVALID_SCORING_POLICY`（level_rules 与表列漂移检查，覆盖 B2；schema v0.1.8 后 JSON 不再含 threshold 键） |
| 37 | 创建/编辑时 `scoring_policy_json.level_rules` 中 `LEVEL_CONDITIONAL` 首条 `min` 不等于表列 `conditional_threshold` | 返回 `INVALID_SCORING_POLICY` |
| 38 | `question_ratio` 缺失部分题型 key（如只填 TRUE_FALSE:20） | 缺失按 0 处理，sum 校验仍执行；若 sum 等于 online+offline 则通过 |
| 39 | `difficulty_distribution` 缺失 | 通过（optional） |
| 40 | 编辑 seed 版本（如 `strategy_baseline_shelver_v1`）时 `level_rules` 与表列 threshold 不一致 | 返回 `INVALID_SCORING_POLICY`，提示对齐（v0.1.8 seed 已含 `level_rules`，无需补全） |
| 41 | `setActive` 停用已引用版本后，该版本仍能被新 `assessment_session` 引用 | schema 不校验 is_active，引用成立（记录 5.4/5.5 设计约束） |

---

## 风险点

**[!] `TRAINING_PRACTICE` 策略 seed 缺失（5.4 / 5.5 阻塞）**

schema.sql 末尾仅 seed `strategy_baseline_shelver_v1`（BASELINE_ASSESSMENT）与 `strategy_mock_shelver_v1`（MOCK_EXAM），**没有 TRAINING_PRACTICE 类型策略**。但 `training_session.strategy_type` 只允许 `TRAINING_PRACTICE`（schema CHECK），且 v0.1.8 一致性触发器 `trg_training_session_strategy_config_match_insert` 强制 training_session 必须匹配一行 strategy_config。

这意味着 5.5 训练分配功能启动前必须有一条 `strategy_type='TRAINING_PRACTICE'` 的策略存在。本 PRD **不改 schema.sql**（冻结基线），但提供两条互斥路径供后续选择：
1. 管理员通过本功能 UI 手动创建 TRAINING_PRACTICE 策略（推荐，schema CHECK 已允许）
2. 在 5.5 实现时通过应用层 migration 脚本补 seed（需另起 PRD）

**当前 PRD 不实现 seed**，只在文档中标记为 5.5 前置依赖。如 5.5 启动时仍无 TRAINING_PRACTICE 策略，5.5 handler 必须明确报错而非硬编码。

**[!] schema 无 `created_by` 列（已知偏差，与 student-profile 一致）**

`strategy_config` 无 `created_by` / `updated_by` 列，且 v0.1.8 冻结。本 PRD 采用与 student-profile 一致的「审计日志方案」：`error_event_log` 写 INFO 记录操作人 `callerUserId`，通过 `related_aggregate_type='STRATEGY_CONFIG'` + `related_aggregate_id=strategy_id:version` 建立关联。这是**已知偏差**：审计可追溯 ≠ 表内有 created_by 列。后续 schema 升级（如 v0.2.0）应补 `created_by TEXT` / `updated_by TEXT` 列正式满足 PRD §14.3 审计要求。MVP 阶段以「操作可追溯」为接受标准。

**[!] `error_event_log.error_category` 无 'STRATEGY_CONFIG' 枚举**

schema 的 `error_event_log.error_category` 与 `error_code_registry.error_category` CHECK 枚举仅允许 `IPC / DB / AOL / RECOVERY / ASSET / FSM / SCORING / REPORT / AUTH / SYSTEM`。本功能审计写入用 `error_category='SYSTEM'`（最接近「主数据维护」语义），并通过 `related_aggregate_type='STRATEGY_CONFIG'` 建立关联。与 student-profile 决策一致；后续如需专属审计分类，应在 schema 升级时扩展枚举。

**[!] caller 身份校验为应用层防御（非安全强）**

与 student-profile PRD 记录的风险一致：当前无 session token，caller 身份由渲染进程从 Pinia auth store 读取后随 IPC 参数传入。assertCaller 在 DB 层用 `user_account.role` 复核 callerUserId，能挡住「callerUserId 合法但 callerRole 伪造」的基础攻击，但无法防御「恶意渲染进程直接构造 IPC 调用」。MVP 单机本地、无网络攻击面，此方案可接受；后续如引入多端需改为基于 token 的会话鉴权。

**[!] `level_rules` 覆盖性校验是应用层职责**

schema 只校验 `scoring_policy_json` 是合法 JSON TEXT，**不校验内部 `level_rules` 是否覆盖 `[0,100]` 无盲区无重叠**。本 PRD 在 `validate-scoring-policy.ts` 中实现该校验（排序后检查连续覆盖），属于应用层防御。若未来有其他写入路径（如批量导入脚本），必须复用该校验函数，不得绕过。

**[!] 多 active 版本不冲突（schema 允许）**

schema 未强制 `(strategy_type, job_code, is_active=1)` UNIQUE，本 PRD 不加应用层约束。这意味着管理员可以让同 `strategy_type + job_code` 下多个版本同时 active——5.4 / 5.5 测评发起时 UI 必须显式选 version，不能默认选 max version。**这是 5.4 / 5.5 的设计约束**，本 PRD 不实现该选择逻辑。

**[!] 编辑未引用版本与"管理员误操作"风险**

本 PRD 允许 ADMIN 编辑**未被引用**的版本任何语义字段（schema 触发器不挡）。如果管理员在 5.4 测评发起前最后一次修改了 `competent_threshold`，由于无 session 引用，修改会成功——这合法但有风险。MVP 接受此风险（管理员是受信角色），且审计日志记录变更。未来若需要"草稿态"管理，应通过 schema 升级引入 `strategy_config.status` 列，不在本 PRD 范围。

**`level_rules` 与 schema 表列 threshold 的一致性（v0.1.8 已收敛双源）**

schema v0.1.8 已将 `competent_threshold` / `conditional_threshold` / `module_veto_threshold` / `emotion_collapse_threshold` 提升为 `strategy_config` 表列（DEFAULT 80 / 60 / 0.5 / 3），`scoring_policy_json` 不再含这些键。**旧版（v0.1.7）的"JSON 键 + 表列"双源问题在 v0.1.8 已解决**——表列为唯一权威源。剩余一致性约束是 `scoring_policy_json.level_rules` 中 `LEVEL_COMPETENT` 首条 `min` 必须等于表列 `competent_threshold`、`LEVEL_CONDITIONAL` 首条 `min` 必须等于表列 `conditional_threshold`（防止 `level_rules` 自身与表列漂移），由 `validate-scoring-policy.ts` 的 ctx 校验承接。

**[!] seed 数据 `scoring_policy_json` 已在 v0.1.8 补全 `level_rules`（历史陷阱已修复）**

schema.sql v0.1.8 seed 的两条策略（`strategy_baseline_shelver_v1` / `strategy_mock_shelver_v1`）`scoring_policy_json` 已更新为 `{"score_values":[0,1,2],"normalization":"raw_score/max_score*100","safety_override_enabled":true,"level_rules":[{"min":80,"max":100,"level":"LEVEL_COMPETENT"},{"min":60,"max":79,"level":"LEVEL_CONDITIONAL"},{"min":0,"max":59,"level":"LEVEL_NOT_COMPETENT"}]}`——含 `level_rules` 字段，且 threshold 键已移除。旧版 v0.1.7 seed 缺 `level_rules` 的数据一致性陷阱在 v0.1.8 已修复。

后果：管理员通过本功能 UI 打开 seed 版本编辑、保存时按统一 `validate-scoring-policy.ts` 规则校验，无需额外补全 `level_rules`。

**[!] schema 不校验 session 引用的 `strategy_config.is_active`**

schema 的 session strategy 一致性触发器（`trg_assessment_session_strategy_config_match_insert` 等）只校验 `(strategy_id, strategy_type, job_code, strategy_version)` 四字段匹配，**不校验 `strategy_config.is_active`**。这意味着管理员停用某已引用版本后，5.4/5.5 仍可创建新 session 引用该停用版本——schema 层不阻止。

本 PRD 不在 handler 层加"停用版本不可被新 session 引用"的约束，因为：
- PRD 未要求 is_active 影响会话创建
- 停用语义可能用于"历史版本只允许复测、不允许新测"等业务规则，这是 5.4/5.5 的产品决策
- 把决策推到使用方，避免 5.2 过度设计

**这是 5.4/5.5 的设计约束**：测评发起 / 训练分配时，UI 列出可选策略版本时需自行决定是否过滤 `is_active=0`。推荐：默认只列 active，但允许教师显式展开 inactive 版本以支持历史复测场景。
