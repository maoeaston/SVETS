# 实施启动检查清单

> **IMPLEMENTED / 历史实施快照**：本文记录从 schema v0.1.10 升级到 v0.1.12 之前的启动状态，正文中的“待实现”已经过期。当前开发先读 `doc/specs/MVP_PRD_v1.0.9-authoritative.md`、`src/main/db/schema.sql` 和对应 feature 文档；仅在追溯 v0.1.12 实施决策时阅读本文。

版本：start-here v1.0
日期：2026-07-07
用途：追溯 schema v0.1.12 实施前状态，不再作为新会话入口

---

## 1. 现状基线（已实现，代码真实状态）

### 1.1 数据库
- schema 版本：`v0.1.10-scoring-closure`
- 文件：`src/main/db/schema.sql`
- 策略类型 CHECK：`BASELINE_ASSESSMENT / MOCK_EXAM / TRAINING_PRACTICE`（**不含 JOB_SKILL_ASSESSMENT**）
- question_bank 无以下字段：`bank_domain`、`job_module_code`、`item_usage`、`job_code`
- assessment_session_question 的 question_phase 只有 ONLINE / OFFLINE（**无 OBSERVATION**）
- offline_score_record.score_scope：`OFFLINE_ABILITY / TASK_OPERATION`（**无 JOB_SKILL / TEACHER_OBSERVATION**）
- result_record.result_type：`ABILITY_SCORE / TRAINING_COMPLETION / OPERATION_PASS_RATE`（**无 JOB_SKILL_SCORE**）

### 1.2 共享类型
- 文件：`src/shared/types/json-schemas.ts`（165 行）
- 无 `StrategyType`、`BankDomain`、`JobModuleCode`、`QuestionPhase`、`TeacherObservationPayload` 等枚举
- `ContentJson` 仅有 4 个分支（TrueFalse/SingleChoice/Drag/OfflineOperation）
- `ScoringRuleDrag.scoring_type: 'DRAG_PARTIAL'`（v1.0.9 要废弃）
- `QuestionPolicyJson.question_ratio`（v1.0.9 要废弃）

### 1.3 已运行功能
| 功能 | 状态 |
|---|---|
| 基础能力测评（42+8 题，BASELINE_ASSESSMENT） | **已实现** |
| 训练任务（TRAINING_PRACTICE） | **已实现** |
| 实操评分（OFFLINE_ABILITY） | **已实现** |
| 安全事件与红线（REDLINE_HALTED） | **已实现** |
| 结果三分离（ABILITY_SCORE/TRAINING_COMPLETION/OPERATION_PASS_RATE） | **已实现** |
| 报告（task-report-v1.1 BASE_ABILITY 部分） | **已实现** |
| 专业岗位测评（JOB_SKILL_ASSESSMENT） | **待实现** |
| 题库域隔离（bank_domain） | **待实现** |
| 固定示范卷（18+6+观察） | **待实现** |
| TEACHER_OBSERVATION 运行时 | **待实现** |


---

## 2. 目标基线（待实现）

- schema 版本：`v0.1.12-job-skill-assessment-mvp-closure`
- PRD：v1.0.9（最终目标）
- SQL 草案：`doc/specs/impl/01-schema-v0.1.12.sql`（已通过 SQLite 语法验证）
- 类型方案：`doc/specs/impl/02-json-contracts-and-types.md`

---

## 3. 实施前置检查（开始编码前必须确认）

### 3.1 数据安全检查

```bash
# 检查 295 条 M1-M6 旧 ACTIVE 题是否被任何 session 引用
# 若有引用 → 转 ARCHIVED + 新 ID 重建；若无引用 → 可物理删除后重导
sqlite3 xc-career-guide.db "
  SELECT COUNT(*) as session_refs
  FROM assessment_session_question asq
  JOIN question_bank qb ON asq.question_id = qb.question_id
  WHERE qb.job_code = 'supermarket_stocking'
    AND qb.status = 'ACTIVE';
"
```

期望结果：0（无引用则可物理清库）。若非 0，先确认再清库。

### 3.2 备份

```bash
# 备份现有数据库和 JSONL
cp xc-career-guide.db xc-career-guide.db.bak-$(date +%Y%m%d)
cp action_log.jsonl action_log.jsonl.bak-$(date +%Y%m%d)
```

### 3.3 回归基线

运行现有测试套件，记录基线通过数：

```bash
npx vitest run
```

保存通过数量，T12（全量回归）时对比确认无退化。


---

## 4. 任务执行顺序（完整路径）

```
前置人工操作（H1-H6）
    ↓
T1: 共享类型升级  → src/shared/types/json-schemas.ts
    ↓
T2: schema v0.1.12 全量重建  → src/main/db/schema.sql
    ↓
T3: validateQuestionContract()  → src/main/domain/validators/
    ↓
T4: 导入脚本 dry-run  → src/main/tools/question-importer.ts
    ↓
T5: 人工确认 24 题 ACTIVE（需人工审核）
    ↓
T6: JOB_SKILL session 与固定组卷  → session-service.ts
    ↓
T7 + T8: 评分 + TEACHER_OBSERVATION  → scoring-service.ts / observation-service.ts
    ↓
T9 + T10: 结果 + 报告  → result-service.ts / report-service.ts
    ↓
T11: 训练推荐衔接
    ↓
T12: 全量回归验收
```

详细说明见 `doc/specs/impl/07-implementation-task-book.md`。

## 5. 前置人工操作（非编码，需人在 T5 之前完成）

| # | 操作 | 依据 |
|---|---|---|
| H1 | 人工核验 M1_TF_015 答案键（正向组孤例 false，疑似键错） | PRD v1.0.9 附录 D 第 10 条 |
| H2 | 逐题补写 6 道线下题三档行为锚点（参考 03 文档 §7 草稿） | 审查报告 v2 D2 |
| H3 | 专业审查 M5_OP_040 安全终止条件（搬运题 safety_sensitive） | PRD v1.0.8 §5.3 |
| H4 | 确认"拆箱与上架"训练实际 task_code 值 | PRD v1.0.9 附录 D 第 7 条 |
| H5 | 确认 JOB_SKILL session task_code（建议 JOB_SKILL_DEMO_M1M6） | PRD v1.0.9 附录 D 第 8 条 |
| H6 | 三条嵌入观察语义已由数据核验确认（可直接执行） | 03 文档 §4.1 |


---

## 6. 关键文件速查

| 需要 | 读这个 |
|---|---|
| 了解整体目标和范围 | `doc/specs/impl/00-implementation-overview.md` |
| 写 schema SQL | `doc/specs/impl/01-schema-v0.1.12-design.md` → 草案 `01-schema-v0.1.12.sql` |
| 写或改 TypeScript 类型 | `doc/specs/impl/02-json-contracts-and-types.md` |
| 确认示范卷题目 ID | `doc/specs/impl/03-job-skill-demo-paper-spec.md` |
| 写导入脚本 | `doc/specs/impl/04-question-bank-import-cleaning-spec.md` |
| 写状态机/事件 | `doc/specs/impl/05-state-machine-and-events.md` |
| 写测试用例 | `doc/specs/impl/06-acceptance-test-plan.md` |
| 查任务拆解和依赖 | `doc/specs/impl/07-implementation-task-book.md` |
| 确认当前 schema 现状 | `src/main/db/schema.sql`（v0.1.10 实测） |
| 确认当前类型现状 | `src/shared/types/json-schemas.ts`（v0.1.10 基线） |

---

## 7. 常见陷阱（新会话 Agent 必读）

1. **不要把 impl/ 文档当成已实现的代码**。impl/ 是"怎么做"的方案，代码中目前没有 JOB_SKILL_ASSESSMENT 任何内容。
2. **不要改 v0.1.10 schema 的现有触发器逻辑**，只在它基础上新增。
3. **题库 298 条全部是 DRAFT**，不要假设任何题目是 ACTIVE 或可组卷状态。
4. **M1_TF_015 必须保持 DRAFT** 直到人工核验（H1）。
5. **三条嵌入观察（M1_OB_048、M5_OP_048、M5_OP_055）当前 status=DRAFT，scoring_type 是错误的 RUBRIC_BASED**，重导时必须修复。
6. **不要新建 job_skill_assessment_session 表**，复用 assessment_session。
