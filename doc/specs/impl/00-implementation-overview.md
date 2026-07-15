# 实现总览：从 schema v0.1.10 到 v0.1.12

> **IMPLEMENTED / 历史实施记录**：本文说明 v0.1.12 当时如何实现。当前产品合同以 `doc/specs/MVP_PRD_v1.0.9-authoritative.md` 为准，当前数据库以 `src/main/db/schema.sql`（v0.1.14）为准。

版本：impl-overview v1.0  
日期：2026-07-07  
产品合同：`MVP_PRD_v1.0.9-authoritative.md`（历史来源链：v1.0.7 → v1.0.8 → v1.0.9）
目标 schema：v0.1.12-job-skill-assessment-mvp-closure  

---

## 1. 一句话目标

基于三份已定稿 PRD 增量（v1.0.7 题库数据合同 → v1.0.8 专业岗位题库治理 → v1.0.9 专业岗位示范测评运行时），产出一套可按序执行的实现文档，将工程基线从 schema v0.1.10 + PRD v1.0.6 升级到 schema v0.1.12 + PRD v1.0.9，最终交付一个真实可运行的专业岗位能力示范测评闭环。

---

## 2. 统一范围边界（本轮不做）

以下内容由三份 PRD 的"本轮不做"清单合并去重得出。任何实现文档不得越此边界。

### 2.1 题库与试卷运营

- 完整题库管理后台 / 可视化题目编辑器 / 分支流程设计器
- 正式试卷表（assessment_paper）/ 自定义组卷 / 固定结业卷后台
- 298 题全部 ACTIVE 与全量运营
- 专业岗位随机组卷 / 多套卷 / 单模块小测试
- 549 题训练变式正式导入
- question_role / parent_question_id / allowed_roles / 四层题库分层
- 自动生题、生图或自动补答案

### 2.2 高级评分与分析

- 五类高级专业指标（支架指数、注意执行、社交元认知编码等）
- 支架前后分差自动解释 / 门店-文职分差自动解释
- 警觉衰减曲线分析
- 岗位安置矩阵 / 竞争性-支持性就业自动判定
- 原始高频行为分析数据库（pointer move / 逐帧触控 / 原始音频）
- 热点区域编辑器 / 摄像头 / 眼动 / 姿态识别 / 语音 NLP 自动评分
- 常模、IRT、信效度分析和题目参数

### 2.3 报告与安置

- 对外与内部双报告模板
- 就业安置方向自动输出（试测阶段 placement_advice_enabled = false）
- PDF 报告渲染

### 2.4 基础设施

- ORM 库（TypeORM / Sequelize / Prisma）
- CSV 解析库（papaparse / csv-parser）
- Markdown 报告渲染库
- action_log / safety_incident / 训练状态机总架构重构

---

## 3. 两条平行链路架构对比

系统存在两条独立的测评链路，共享底层基础设施但在题库域、评分模型和报告结构上完全隔离。

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        共享基础设施层                                         │
│  assessment_session（状态机/坐次/暂停恢复/红线/事件溯源）                       │
│  action_log.jsonl → domain_event_projection                                 │
│  task_report 表 → report_content_json                                       │
│  result_record 表 → result_payload_json                                     │
│  asset_resource → app://asset/<id>                                          │
│  安全红线 → REDLINE_HALTED（优先覆盖，不可转出）                               │
└──────────────────────────────┬───────────────────────────────────────────────┘
                               │
            ┌──────────────────┴──────────────────┐
            │                                     │
┌───────────▼───────────────┐       ┌─────────────▼─────────────────┐
│   BASE_ABILITY 链路        │       │   JOB_SPECIFIC 链路            │
├────────────────────────────┤       ├───────────────────────────────┤
│ 策略: BASELINE_ASSESSMENT  │       │ 策略: JOB_SKILL_ASSESSMENT    │
│       MOCK_EXAM            │       │                               │
├────────────────────────────┤       ├───────────────────────────────┤
│ 题库域: BASE_ABILITY       │       │ 题库域: JOB_SPECIFIC          │
│ 模块:  module_type         │       │ 模块:  job_module_code        │
│        (六大基础能力)       │       │        (M1-M6 岗位模块)       │
├────────────────────────────┤       ├───────────────────────────────┤
│ 组卷: 随机, 每模块7线上    │       │ 组卷: FIXED_SET 固定示范卷    │
│       共42线上 + 8线下     │       │       18线上 + 6线下          │
│                            │       │       + 0-3 OBSERVATION       │
├────────────────────────────┤       ├───────────────────────────────┤
│ 评分: 满分100              │       │ 评分: 满分48                  │
│   线上 42×2 = 84           │       │   线上 18×2 = 36              │
│   线下  8×(0/1/2) = 16    │       │   线下  6×(0/1/2) = 12       │
├────────────────────────────┤       ├───────────────────────────────┤
│ 结果: ABILITY_SCORE        │       │ 结果: JOB_SKILL_SCORE         │
│ 画像: 六大能力 module_     │       │ 画像: M1-M6 job_module_       │
│       profiles             │       │       profiles (payload内)    │
├────────────────────────────┤       ├───────────────────────────────┤
│ 报告: task-report-v1.1     │       │ 报告: job-skill-report-v1.0   │
│ scope: BASE_ABILITY(缺省)  │       │ scope: JOB_SKILL              │
├────────────────────────────┤       ├───────────────────────────────┤
│ 模块兜底: 启用             │       │ 模块兜底: DISABLED_RECORD_    │
│ (module_veto_threshold)    │       │           ONLY                │
├────────────────────────────┤       ├───────────────────────────────┤
│ 训练衔接: 无               │       │ 训练衔接: M2→拆箱与上架      │
│                            │       │ 其余模块仅建议文案            │
└────────────────────────────┘       └───────────────────────────────┘
```

关键隔离规则：
- 两个 bank_domain 互相命中数必须为 0
- strategy_type 与 bank_domain 强绑定，组卷服务 + validateQuestionContract + 单元测试三层保证
- 不得把岗位模块伪装为基础能力模块，不得合成"总分"

---

## 4. 与现有 v0.1.10 的兼容性说明

v0.1.12 是基于 v0.1.10 的**全量初始化基线**，不提供逐版本原地 migration。以下按变更性质分类。

### 4.1 纯新增（不影响现有表结构）

| 变更 | 来源 PRD | 说明 |
|------|----------|------|
| `question_bank.bank_domain` 列 | v1.0.8 | NOT NULL，现有题回填 BASE_ABILITY |
| `question_bank.job_module_code` 列 | v1.0.8 | 可空，BASE_ABILITY 题为 NULL |
| `question_bank.item_usage` 列 | v1.0.7 | NOT NULL DEFAULT 'SCORED_ITEM' |
| `assessment_session_question.bank_domain` 列 | v1.0.9 | NOT NULL |
| `assessment_session_question.job_module_code` 列 | v1.0.9 | 可空 |
| `assessment_session_question.item_usage` 列 | v1.0.9 | NOT NULL |
| `answer_record.response_status` 列 | v1.0.7 | NOT NULL DEFAULT 'ANSWERED' |
| `offline_score_record.response_status` 列 | v1.0.7 | NOT NULL DEFAULT 'ANSWERED' |
| `offline_score_record.observation_payload_json` 列 | v1.0.8 | 可空 TEXT |
| `strategy_config.strategy_type` 新枚举值 | v1.0.9 | 增加 JOB_SKILL_ASSESSMENT |
| `assessment_session.strategy_type` 新枚举值 | v1.0.9 | 增加 JOB_SKILL_ASSESSMENT |
| `result_record.result_type` 新枚举值 | v1.0.9 | 增加 JOB_SKILL_SCORE |
| `offline_score_record.score_scope` 新枚举值 | v1.0.9 | 增加 JOB_SKILL / TEACHER_OBSERVATION |
| JOB_SKILL_ASSESSMENT 策略种子行 | v1.0.9 | strategy_config INSERT |

### 4.2 字段变更（需修改现有列定义）

| 变更 | 来源 PRD | 影响 |
|------|----------|------|
| `question_bank.status` DEFAULT 改为 'DRAFT' | v1.0.7 | 现为 'ACTIVE'，新导入必须默认 DRAFT |
| `question_bank.question_type` CHECK 增加 SOFTWARE_TASK | v1.0.7 | 扩展枚举 |
| `question_bank.module_type` 由 NOT NULL 改为可空 | v1.0.8 | JOB_SPECIFIC 题 module_type = NULL |
| `assessment_session_question.module_type` 由 NOT NULL 改为可空 | v1.0.9 | 同上 |
| `assessment_session_question.question_phase` CHECK 增加 OBSERVATION | v1.0.9 | 三值 |
| `assessment_session_question.question_type` CHECK 增加 SOFTWARE_TASK | v1.0.7 | 扩展枚举 |
| `answer_record.score` 由 NOT NULL 改为可空 | v1.0.7 | NR/ST 等非 ANSWERED 状态 score=NULL |
| `answer_record.question_type` CHECK 增加 SOFTWARE_TASK | v1.0.7 | 扩展枚举 |
| `offline_score_record.score` 由 NOT NULL 改为可空 | v1.0.7/v1.0.9 | TEACHER_OBSERVATION scope score=NULL |

### 4.3 新增约束和触发器

| 约束 | 来源 PRD | 说明 |
|------|----------|------|
| bank_domain + module_type/job_module_code 域配对 CHECK | v1.0.8 | 互斥规则 |
| item_usage + question_phase 配对 CHECK | v1.0.9 | OBSERVATION_ONLY ↔ OBSERVATION |
| ACTIVE 即冻结触发器（语义字段不可变） | v1.0.8 | ACTIVE 状态或已被引用即冻结 |
| strategy_type + bank_domain 绑定校验 | v1.0.9 | 组卷时强制隔离 |
| answer_record response_status + score 配对 CHECK | v1.0.7 | ANSWERED→0/2，其余→NULL |
| offline_score_record scope + score 配对 CHECK | v1.0.9 | TEACHER_OBSERVATION→NULL |

### 4.4 数据迁移要求

| 数据集 | 操作 | 说明 |
|--------|------|------|
| Q_BASE 现有题 | 回填 bank_domain='BASE_ABILITY' | 最小迁移，不改内容 |
| M1-M6 298 条 | 全量清洗重导，全部 DRAFT | 按 v1.0.8 §5.3.10.5 清洗规则 |
| M1-M6 旧 ACTIVE 题 | 如已被 session 引用则 ARCHIVED + 重建 | [需确认] 是否有引用 |
| 现有策略种子 | 回填 eligible_bank_domains | question_policy_json 升级 |
| scoring_type 命名 | RUBRIC_BASED→OFFLINE_RUBRIC, DRAG_PARTIAL→拆分 | 旧值不得入新库 |

### 4.5 回归保证

以下现有功能必须在 v0.1.12 基线下继续通过：
- 基础能力 42+8 组卷、评分、报告全链路
- 坐次机制（暂停/恢复/多坐次）
- 安全红线触发与 REDLINE_HALTED 终态
- 事件溯源写入与回放
- 训练任务实操评分（TASK_OPERATION）
- 策略版本冻结与引用一致性

---

## 5. 实现文档索引

本套 impl 文档共 8 份（含本文），按执行顺序编号。每份文档对应一个或若干个 commit 粒度的交付物。

| # | 文件名 | 职责 | 对应 PRD 章节 |
|---|--------|------|---------------|
| 00 | `00-implementation-overview.md` | 总览、范围、架构、索引（本文） | 三份 PRD 全覆盖 |
| 01 | `01-shared-enums-and-types.md` | 共享枚举、TypeScript 类型定义、JSON 合同升级 | v1.0.7 附录A + v1.0.8 附录A + v1.0.9 附录A/E |
| 02 | `02-schema-v0.1.12.md` | schema.sql v0.1.12 全量基线生成、触发器、CHECK 约束 | v1.0.7 §11.12 + v1.0.8 §11.12.7-9 + v1.0.9 §11.13 |
| 03 | `03-validators-and-contract.md` | validateQuestionContract()、content/scoring/report JSON validator | v1.0.7 §5.3.5-7 + v1.0.8 §5.3.5/7/11 + v1.0.9 §5.4.6 |
| 04 | `04-importer-and-dry-run.md` | 题库导入器、298 条清洗重导、dry-run 报告 | v1.0.7 §5.3.9 + v1.0.8 §5.3.10.5 + v1.0.9 §20 步骤3 |
| 05 | `05-job-skill-session-and-scoring.md` | JOB_SKILL_ASSESSMENT session、固定组卷、线上/线下评分、TEACHER_OBSERVATION 运行时 | v1.0.9 §5.4.5 + §7.2.3 + §7.6.3 |
| 06 | `06-result-and-report.md` | JOB_SKILL_SCORE 生成、M1-M6 模块画像、专业岗位报告、训练推荐衔接 | v1.0.9 §5.8.3-4 + §7.2.3 |
| 07 | `07-gates-regression-acceptance.md` | ACTIVE 审核门禁、回归测试、三份 PRD 全量验收清单 | v1.0.7 §17.9 + v1.0.8 §17.10 + v1.0.9 §17.11 |

---

## 6. 文档依赖关系

```
00-overview ─────────────────────── 所有文档的入口与范围约束
    │
    ▼
01-enums-types ──────────────────── 类型是后续所有实现的基础
    │
    ├───────────────┐
    ▼               ▼
02-schema       03-validators ──── schema 与 validator 可并行开发
    │               │               但 validator 需引用 01 的类型
    │               │
    └───────┬───────┘
            │
            ▼
    04-importer ─────────────────── 依赖 schema 建表 + validator 校验
            │
            ▼
    05-session-scoring ──────────── 依赖 schema（session/question 表）
            │                       + validator（组卷门禁）
            │                       + importer（题已入库）
            ▼
    06-result-report ────────────── 依赖 session 产生的评分数据
            │
            ▼
    07-gates-regression ─────────── 最终验收，依赖全部实现就绪
```

关键依赖说明：
- 01 是 02 和 03 的前置：类型定义确定后 schema 和 validator 才能实现
- 02 和 03 可并行：schema 用 SQL 写，validator 用 TypeScript 写，互不阻塞
- 04 必须在 02 之后：需要目标 schema 的表结构
- 05 依赖 04 的产出：需要已入库的 ACTIVE 题目
- 07 是全量集成验收，执行时所有功能必须就绪

---

## 7. 执行顺序与 PRD §20 对齐

| 本文档编号 | PRD v1.0.9 §20 步骤 | 交付物 |
|---|---|---|
| 01 | 步骤 1（枚举/JSON合同） | TypeScript 类型文件 + JSON schema 版本 |
| 02 | 步骤 2（schema v0.1.12） | schema.sql 全量初始化脚本 |
| 03 | 步骤 3 前半（validator） | validateQuestionContract + 各 JSON validator |
| 04 | 步骤 3 后半 + 步骤 4 | importer/dry-run + 固定卷题目确定 |
| 05 | 步骤 5（session/评分） | JOB_SKILL session + 自动/教师评分 |
| 06 | 步骤 6（结果/报告/衔接） | 结果生成 + 报告 + 训练推荐 |
| 07 | 步骤 7（门禁/回归） | 审核门禁 + 全量验收 |

---

## 8. 阅读建议

- **首次通读**：按 00→01→02→...→07 顺序完整阅读，建立全局认知
- **实现某一步**：先回看 00（范围边界）和前置文档产出，再读当前步骤文档
- **遇到冲突**：以 PRD v1.0.9 为最高优先级（后版覆盖前版），schema 以 `src/main/db/schema.sql` 实测为准
- **[需确认] 项**：整合在 PRD v1.0.9 附录 D，实现前必须逐项落定
