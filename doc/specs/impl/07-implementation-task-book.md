# 实施任务书

版本：task-book v1.0
日期：2026-07-07
依据：PRD v1.0.9 §20（7步执行顺序）+ impl/ 全套设计文档
目标：把设计文档拆解为可分配给编码 agent 的任务序列

---

## 任务概览

| 任务 ID | 任务名称 | 前置任务 | 文件范围 | 验收子集 |
|---|---|---|---|---|
| T1 | 共享类型与枚举升级 | — | json-schemas.ts | A, C, K |
| T2 | schema v0.1.12 全量基线 | T1 | schema.sql | A, B |
| T3 | validateQuestionContract() | T1, T2 | validator.ts | C, K, Q |
| T4 | 导入脚本与 dry-run | T2, T3 | importer.ts | L |
| T5 | 固定示范卷题目确认与 ACTIVE | T4 | strategy_config seed | H, Q |
| T6 | JOB_SKILL session 与固定组卷 | T2, T5 | session service | N |
| T7 | 线上/线下评分（JOB_SKILL） | T6 | scoring service | O |
| T8 | TEACHER_OBSERVATION 运行时 | T6 | observation service | I |
| T9 | JOB_SKILL_SCORE 与模块画像 | T7, T8 | result service | O |
| T10 | 专业岗位报告 | T9 | report service | P |
| T11 | 训练推荐衔接 | T10 | recommendation | P5 |
| T12 | 全量回归验收 | T1-T11 | 测试套件 | R |


---

## T1 共享类型与枚举升级

**产出文件：**`src/shared/types/json-schemas.ts`（修改）  
**依赖：**无  
**验收子集：**TC-A02～A05, TC-C01～C10, TC-K01～K04

### 具体步骤

1. 新增枚举：`StrategyType`（+JOB_SKILL_ASSESSMENT）、`ResultType`（+JOB_SKILL_SCORE）、`QuestionPhase`、`BankDomain`、`JobModuleCode`（M1-M6）、`ItemUsage`、`AnswerKeyStatus`、`PostDisclosureStatus`
2. 修改 `ContentJsonBase`：`ability_tags` 允许空数组；删除 `expected_answer`
3. 新增 `ScoringRuleOrderMatch`、`ScoringRuleMapping Match`、`ScoringRuleNoScore`；废弃 `ScoringRuleDrag`（DRAG_PARTIAL）和 `ScoringRuleOffline` 中的 RUBRIC_BASED
4. 新增 `QuestionPolicyJobSkillFixedSet`（v1.2 FIXED_SET）；修改 `QuestionPolicyJson` 为联合类型
5. 新增 `ScoringPolicyJobSkill`（v1.2）；`ScoringPolicyJson` 扩展为联合类型
6. 新增 `TeacherObservationPayload`、`JobSkillResultPayload`、`JobSkillReportContent`、`ContentJsonReview`
7. 新增 `validateQuestionContract()` 函数签名（实现在 T3）

**自查方式：**`npx tsc --noEmit` 无类型错误；检查附录 E 9 项差异逐一落地


---

## T2 schema v0.1.12 全量基线

**产出文件：**`src/main/db/schema.sql`（替换为 v0.1.12）  
**依赖：**T1（类型确认后再写 SQL）  
**验收子集：**TC-A01～A12, TC-B01～B10

### 具体步骤

1. 以 `doc/specs/impl/01-schema-v0.1.12.sql` 为草案，对照 `src/main/db/schema.sql`（v0.1.10 实测）逐节确认
2. 合并变更（详见 `01-schema-v0.1.12-design.md`）：
   - strategy_config: strategy_type CHECK 加 JOB_SKILL_ASSESSMENT
   - assessment_session: strategy_type CHECK 扩展
   - assessment_session_question: 新增 bank_domain/job_module_code/item_usage；question_phase 加 OBSERVATION；module_type 改为可空；新增 CHECK 约束和插入校验触发器
   - answer_record: 新增 response_status（DEFAULT 'ANSWERED'）；score 改为可空
   - offline_score_record: score_scope 加 JOB_SKILL/TEACHER_OBSERVATION；新增 response_status/observation_payload_json；score 改为可空
   - result_record: result_type/strategy_type CHECK 加 JOB_SKILL_SCORE/JOB_SKILL_ASSESSMENT
   - question_bank: 新增 bank_domain/job_module_code/item_usage/job_code；status DEFAULT 'DRAFT'；加 SOFTWARE_TASK；新增 ACTIVE 冻结触发器；域配对 CHECK
3. 更新 schema_migration 种子，末行版本为 v0.1.12
4. 在内存 SQLite 运行 `sqlite3 :memory: < schema.sql`；`PRAGMA foreign_key_check` 无错误

**自查方式：**`sqlite3 :memory:` 建库成功；无 foreign key 违规


---

## T3 validateQuestionContract()

**产出文件：**`src/main/domain/validators/question-validator.ts`（新建）  
**依赖：**T1（类型）、T2（schema 约束已知）  
**验收子集：**TC-C01～C10, TC-K03～K05, TC-Q01～Q07

### 具体步骤

1. 实现 `validateQuestionContract()` 函数（参照 `02-json-contracts-and-types.md` §10）
2. 15 条规则逐一实现：
   - 规则 1: bank_domain 与 module_type/job_module_code 配对
   - 规则 2: strategy_type 与 bank_domain 绑定（组卷调用时）
   - 规则 3-4: item_usage 与 interaction_type/scoring_type 配对
   - 规则 5: question_type 与 content_json.question_type 一致
   - 规则 6: question_phase 推导一致性
   - 规则 7: presentation_type 与 asset role 匹配
   - 规则 8: VIDEO_TO_IMAGE_CARD 须有审核记录
   - 规则 9: answer_key_status 门禁
   - 规则 10: OFFLINE_RUBRIC 三档锚点非通用模板
   - 规则 11: professional_review 必需项
   - 规则 12: renderer registry 已注册
   - 规则 13: required assets 存在且 ACTIVE
   - 规则 14: ability_tags 合法性
   - 规则 15: 固定示范卷全量校验
3. 单元测试：15 个反例 fixture + 正例验证

**自查方式：**单元测试全通过；TC-C10 覆盖全部 15 条规则


---

## T4 导入脚本与 dry-run

**产出文件：**`src/main/tools/question-importer.ts`（新建）  
**依赖：**T2（schema）、T3（validator）  
**验收子集：**TC-L01～L08

### 具体步骤

1. 读取 `doc/reference/...298条.json`，逐条按 `04-question-bank-import-cleaning-spec.md` §2-§5 规则清洗
2. 实现 `--dry-run` 模式：只输出报告不写库
3. dry-run 报告包含：对账矩阵、数据质量报告、素材缺口清单、SC 位置分布、rubric 锚点缺口、域隔离验证
4. 实现正式写入：每条 INSERT + 对应 `QUESTION_IMPORTED` 事件写 action_log.jsonl
5. 错误码处理：IMP_E001~E006 触发时终止；IMP_W001~W005 记录继续

**自查方式：**dry-run 对账矩阵与审查报告 v2 §0 一致；域隔离验证全绿；无 IMP_E 错误


---

## T5 固定示范卷题目确认与 ACTIVE

**产出文件：**strategy_config 种子 + 逐题审核记录  
**依赖：**T4（298 条已导入 DRAFT）  
**验收子集：**TC-H05～H06, TC-Q04～Q07

### 具体步骤

1. 人工确认 `03-job-skill-demo-paper-spec.md` §3 选定的 24+2 题 ID
2. 逐题检查：答案键审核、素材齐全、rubric 三档锚点（线下 6 题）、专业审核（safety_sensitive/观察项）
3. 逐题转 ACTIVE（调用 validateQuestionContract 前置校验）
4. 更新 strategy_config（version=4）的 question_policy_json，写入固定题集
5. 运行 session 创建前置校验（TC-N09）

**自查方式：**24 道计分题全 ACTIVE；2 道观察项 ACTIVE；session 创建校验通过


---

## T6 JOB_SKILL Session 与固定组卷

**产出文件：**`src/main/domain/session-service.ts`（修改）、`src/main/ipc/handlers/session.ts`（修改）  
**依赖：**T2、T5  
**验收子集：**TC-N01～N12

### 具体步骤

1. session 创建逻辑增加 JOB_SKILL_ASSESSMENT 分支：
   - 读 question_policy_json（FIXED_SET）
   - 验证 24 道固定题全 ACTIVE（调用 validateQuestionContract 规则 15）
   - INSERT assessment_session_question（含 bank_domain/job_module_code/item_usage/question_phase）
   - 观察项以 phase=OBSERVATION INSERT，不进 online/offline_question_count
2. 复用现有坐次/暂停/恢复/崩溃中断机制（不新建表）
3. strategy_type=JOB_SKILL_ASSESSMENT 进 assessment_session.strategy_type CHECK

**自查方式：**TC-N01～N12 全通过；`NOT NULL` 约束无违规

---

## T7 线上/线下评分（JOB_SKILL）

**产出文件：**`src/main/domain/scoring-service.ts`（修改）  
**依赖：**T6  
**验收子集：**TC-O01～O09

### 具体步骤

1. 线上评分：复用现有 EXACT_MATCH/ORDER_MATCH/MAPPING_MATCH 评分路径；确保只产生 0/2
2. 线下评分：score_scope=JOB_SKILL 的 offline_score_record，score ∈ {0,1,2}
3. 观察项：score_scope=TEACHER_OBSERVATION，score=NULL（CHECK 已在 schema 层保证）
4. normalized_score 计算：raw/48×100（max_score=48 写在 result_record）
5. observation_completion_ratio：分子=已完成观察数，分母=strategy 固定观察项数

**自查方式：**TC-O01～O09 全通过；不产生 ABILITY_SCORE


---

## T8 TEACHER_OBSERVATION 运行时

**产出文件：**`src/main/domain/observation-service.ts`（新建）、`src/main/ipc/handlers/observation.ts`（新建）  
**依赖：**T6  
**验收子集：**TC-I01～I07

### 具体步骤

1. IPC 入参：session_id + observation_question_id + TeacherObservationPayload
2. 校验：behavior_codes 属于题目声明的编码维度白名单
3. 事件链：payload → TEACHER_OBSERVATION_RECORDED 事件 → action_log.jsonl → domain_event_projection
4. 写 offline_score_record（score_scope=TEACHER_OBSERVATION, score=NULL, observation_payload_json=payload）
5. observation_completion_ratio 更新到 session 或在结果生成时计算

**自查方式：**TC-I01～I07 全通过；score=NULL 约束；事件可在 JSONL 中查询

---

## T9 JOB_SKILL_SCORE 与模块画像

**产出文件：**`src/main/domain/result-service.ts`（修改）  
**依赖：**T7、T8  
**验收子集：**TC-O01～O09

### 具体步骤

1. 结果生成分支：strategy_type=JOB_SKILL_ASSESSMENT → 生成 JOB_SKILL_SCORE（不生成 ABILITY_SCORE）
2. result_payload_json 使用 job-skill-result-v1.0 格式：
   - raw_score / max_score=48 / normalized_score
   - job_module_profiles: {M1~M6} × {online_score, offline_score, pass_rate}
   - completion_ratio（分母=24，不含观察）
   - observation_completion_ratio
3. 安全红线：level_result=LEVEL_FAIL_BY_SAFETY 优先

**自查方式：**TC-O07～O09 全通过；不产生 ABILITY_SCORE；result_payload 可解析为 JobSkillResultPayload

---

## T10 专业岗位报告

**产出文件：**`src/main/domain/report-service.ts`（修改）  
**依赖：**T9  
**验收子集：**TC-P01～P09

### 具体步骤

1. report 生成分支：result_type=JOB_SKILL_SCORE → report_scope='JOB_SKILL'，job-skill-report-v1.0
2. 报告内容：M1-M6 各模块得分、线上/线下对比、支持等级、教师观察区块
3. 训练重点建议：模块得分率 < training_focus_threshold（默认 60%）→ 对应建议文案
4. M2 低分 → 链接现有"拆箱与上架"训练（task_code 从 strategy 配置读取，[需人工确认] §附录 D 第 7 条）
5. 禁止输出就业安置结论；M3-M6 低分只给文案无链接

**自查方式：**TC-P01～P09 全通过；无"就业"字样；无虚假链接


---

## T11 训练推荐衔接

**产出文件：**`src/main/domain/recommendation-service.ts`（新建或修改报告服务）  
**依赖：**T10  
**验收子集：**TC-P05, TC-P07

### 具体步骤

1. 读取 strategy_config 中训练推荐 task_code（[需人工确认] §附录 D 第 7 条）
2. M2 模块得分率 < threshold → 推荐"拆箱与上架"训练链接
3. M1/M3/M4/M5/M6 低分 → 只输出建议文案，不生成可点击链接
4. 不得为未实现训练模块生成链接（工程约束 78）

**自查方式：**TC-P05/P07 通过；查询 task_code 确认实际值

---

## T12 全量回归验收

**产出文件：**测试套件更新  
**依赖：**T1-T11 全部完成  
**验收子集：**TC-R01～R03；复跑 §17.9 + §17.10 全部用例

### 具体步骤

1. 运行完整 vitest 套件（包含既有基础能力用例）
2. 验证 TC-R01：42+8 基础能力全流程不变
3. 验证 TC-R02：训练/实操/安全事件不受影响
4. 验证 TC-R03：strategy_config 版本冻结正常
5. 补充 domain A-R 新增用例，覆盖率达标

**自查方式：**所有 vitest 测试通过；无回归失败


---

## 依赖关系图

```
T1(类型) ──┬──> T2(schema) ──┬──> T4(导入) ──> T5(激活) ──> T6(session) ──┬──> T7(评分) ──> T9(结果) ──> T10(报告) ──> T11(推荐) ──> T12(回归)
           │                 │                                               │
           └──> T3(validator) ┘                                             └──> T8(观察) ──────────────────────────────┘
```

---

## 前置人工操作（非编码任务）

在 T5 之前，须人工完成：

| # | 操作 | 对应 [需人工确认] |
|---|---|---|
| H1 | 确认 M1_TF_015 答案键 | 附录 D 第 10 条 |
| H2 | 确认 3 条嵌入观察项语义（已由本文档数据核验） | 附录 D 第 3 条 |
| H3 | 逐题补写 6 道线下题三档行为锚点（参考 03 §7） | 审查报告 D2 |
| H4 | 专业审查：M5_OP_040 safety_sensitive 终止条件 | 审查报告 §5 |
| H5 | 确认"拆箱与上架"训练 task_code 实际值 | 附录 D 第 7 条 |
| H6 | 确认 JOB_SKILL session task_code 取值 | 附录 D 第 8 条 |

