# schema v0.1.12-job-skill-assessment-mvp-closure 设计文档

**基线版本**：schema v0.1.10-scoring-closure  
**目标版本**：schema v0.1.12-job-skill-assessment-mvp-closure  
**来源 PRD**：v1.0.7 §11.12 + v1.0.8 §11.12.7-11.12.9 + v1.0.9 §11.13  
**编写日期**：2026-07-07

---

## 版本跳跃说明

从 v0.1.10 直接跳到 v0.1.12，原因：

- v0.1.11 原计划对应 PRD v1.0.7 单独产出，但实际未生成。
- PRD v1.0.9 明确要求"v0.1.12 基于现行 v0.1.10，一次性合并 v1.0.7、v1.0.8 和 v1.0.9 要求生成全量初始化 schema，不要求提供逐版本原地 migration"。
- 因此跳过 v0.1.11，直接产出包含三轮变更的 v0.1.12 全量基线。

---

## 变更总览

| 变更类型 | 表/对象 | 来源 |
|---|---|---|
| 修改列 | question_bank | v1.0.7 §11.12.1 + v1.0.8 §11.12.7 |
| 新增列 | question_bank (item_usage, bank_domain, job_module_code) | v1.0.7 + v1.0.8 |
| 修改列 | assessment_session_question | v1.0.7 §11.12.2 + v1.0.9 §11.13.3 |
| 修改列 | answer_record | v1.0.7 §11.12.3 |
| 修改列 | offline_score_record | v1.0.7 §11.12.4 + v1.0.8 §11.12.8 + v1.0.9 §11.13.5 |
| 修改 CHECK | strategy_config | v1.0.9 §11.13.1 |
| 修改 CHECK | assessment_session | v1.0.9 §11.13.2 |
| 修改 CHECK | result_record | v1.0.9 §11.13.6 |
| 新增触发器 | question_bank ACTIVE 即冻结 | v1.0.8 §11.12.7 |
| 新增触发器 | assessment_session_question INSERT 校验 | v1.0.7 + v1.0.9 |
| 新增触发器 | answer_record 跨表校验 | v1.0.7 §11.12.3 |
| 新增触发器 | offline_score_record scope 校验 | v1.0.9 §11.13.5 |
| 修改种子 | strategy_config seed data | v1.0.8 + v1.0.9 |
| 新增种子 | JOB_SKILL_ASSESSMENT 策略 | v1.0.9 §7.6.3 |

---

## 逐表变更详情

### 1. question_bank

**相对 v0.1.10 现状的差异：**

| 变更 | 描述 | 来源 |
|---|---|---|
| 修改 DEFAULT | `status DEFAULT 'ACTIVE'` → `DEFAULT 'DRAFT'` | v1.0.7 §11.12.1 条 1 |
| 修改 CHECK | `question_type` 增加 `'SOFTWARE_TASK'` | v1.0.7 §11.12.1 条 2 |
| 新增列 | `item_usage TEXT NOT NULL DEFAULT 'SCORED_ITEM' CHECK (...)` | v1.0.7 §11.12.1 条 3 |
| 新增列 | `bank_domain TEXT NOT NULL CHECK (...)` | v1.0.8 §11.12.7 条 1 |
| 新增列 | `job_module_code TEXT CHECK (...)` | v1.0.8 §11.12.7 条 2 |
| 修改约束 | `module_type` 从 NOT NULL 改为可空 | v1.0.8 §11.12.7 条 2 |
| 新增 CHECK | 域配对：BASE_ABILITY↔module_type, JOB_SPECIFIC↔job_module_code | v1.0.8 §11.12.7 |
| 扩展冻结 | 冻结字段增加 job_code, item_usage, safety_sensitive, sensory_tags_json, media_asset_id, tool_asset_ids_json, bank_domain, job_module_code | v1.0.7 + v1.0.8 |
| 新增触发器 | ACTIVE 即冻结（status='ACTIVE' 时阻止语义字段修改） | v1.0.8 §11.12.7 条 4 |
| 修改索引 | 扩展现有索引 + 新增 bank_domain 相关索引 | v1.0.8 §11.12.7 条 5 |

**变更理由**：PRD v1.0.7 引入 SOFTWARE_TASK 题型和 item_usage 区分计分与观察项。PRD v1.0.8 引入 bank_domain 实现基础能力/专业岗位域隔离，job_module_code 承载 M1-M6 岗位模块。ACTIVE 即冻结强化数据完整性。

### 2. strategy_config

**相对 v0.1.10 现状的差异：**

| 变更 | 描述 | 来源 |
|---|---|---|
| 修改 CHECK | `strategy_type` 增加 `'JOB_SKILL_ASSESSMENT'` | v1.0.9 §11.13.1 |
| 新增种子行 | JOB_SKILL_ASSESSMENT 策略（18 线上 + 6 线下, 满分 48, FIXED_SET） | v1.0.9 §7.6.3 |

**变更理由**：PRD v1.0.9 引入 JOB_SKILL_ASSESSMENT 策略类型支持专业岗位示范测评。

### 3. assessment_session

**相对 v0.1.10 现状的差异：**

| 变更 | 描述 | 来源 |
|---|---|---|
| 修改 CHECK | `strategy_type` 增加 `'JOB_SKILL_ASSESSMENT'` | v1.0.9 §11.13.2 |

**变更理由**：专业岗位测评复用 assessment_session，需允许新策略类型。坐次、暂停恢复、状态机、红线触发器全部不变。

### 4. assessment_session_question

**相对 v0.1.10 现状的差异：**

| 变更 | 描述 | 来源 |
|---|---|---|
| 修改 CHECK | `question_type` 增加 `'SOFTWARE_TASK'` | v1.0.7 §11.12.2 |
| 修改 CHECK | `question_phase` 增加 `'OBSERVATION'` | v1.0.9 §11.13.3 |
| 新增列 | `bank_domain TEXT NOT NULL CHECK (...)` | v1.0.9 §11.13.3 |
| 修改约束 | `module_type` 从 NOT NULL 改为可空 | v1.0.9 §11.13.3 |
| 新增列 | `job_module_code TEXT CHECK (...)` | v1.0.9 §11.13.3 |
| 新增列 | `item_usage TEXT NOT NULL CHECK (...)` | v1.0.9 §11.13.3 |
| 新增 CHECK | 域配对约束 | v1.0.9 §11.13.3 |
| 新增 CHECK | item_usage ↔ question_phase 约束 | v1.0.9 §11.13.3 |
| 新增触发器 | INSERT 校验（ACTIVE/域一致/phase 对应） | v1.0.7 + v1.0.9 |

**变更理由**：v1.0.9 将观察项以 OBSERVATION phase 纳入 session 快照（废止 v1.0.7 "OBSERVATION_ONLY 不得进入该表"的约束），同时实现跨域隔离。

**[!] 注意**：v1.0.7 §11.12.2 原文为"OBSERVATION_ONLY 不得进入该表"，v1.0.9 §11.13.3 明确废止该约束，改为"观察项以 OBSERVATION phase 进入但不计分"。本 schema 按 v1.0.9 最终决策执行。

### 5. answer_record

**相对 v0.1.10 现状的差异：**

| 变更 | 描述 | 来源 |
|---|---|---|
| 修改 CHECK | `question_type` 增加 `'SOFTWARE_TASK'` | v1.0.7 §11.12.3 |
| 新增列 | `response_status TEXT NOT NULL DEFAULT 'ANSWERED' CHECK (...)` | v1.0.7 §11.12.3 |
| 修改约束 | `score` 从 NOT NULL 改为可空 | v1.0.7 §11.12.3 |
| 修改约束 | `is_correct` CHECK 更新（非 ANSWERED 时可 NULL） | v1.0.7 §11.12.3 |
| 新增 CHECK | ANSWERED↔score/is_correct 配对规则 | v1.0.7 §11.12.3 |
| 新增触发器 | session_question 跨表校验 | v1.0.7 §11.12.3 |

**变更理由**：PRD v1.0.7 引入 response_status 支持 NR/ST/技术中断/协助不计分场景。

### 6. offline_score_record

**相对 v0.1.10 现状的差异：**

| 变更 | 描述 | 来源 |
|---|---|---|
| 修改 CHECK | `score_scope` 增加 `'JOB_SKILL'` 和 `'TEACHER_OBSERVATION'` | v1.0.8 §11.12.8 + v1.0.9 §11.13.5 |
| 新增列 | `response_status TEXT NOT NULL DEFAULT 'ANSWERED' CHECK (...)` | v1.0.7 §11.12.4 |
| 新增列 | `observation_payload_json TEXT` | v1.0.8 §11.12.8 + v1.0.9 §11.13.5 |
| 修改约束 | `score` 从 NOT NULL 改为可空 | v1.0.7 §11.12.4 + v1.0.9 |
| 修改 CHECK | scope 规则（JOB_SKILL/TEACHER_OBSERVATION 各自约束） | v1.0.9 §11.13.5 |
| 修改唯一索引 | 扩展覆盖 JOB_SKILL 和 TEACHER_OBSERVATION scope | v1.0.9 §11.13.5 |

**变更理由**：v1.0.7 引入 response_status 和可空 score。v1.0.8 引入 observation_payload_json 承载施测变体观察编码。v1.0.9 引入 JOB_SKILL（线下评分）和 TEACHER_OBSERVATION（教师嵌入观察）两个新 scope。

### 7. result_record

**相对 v0.1.10 现状的差异：**

| 变更 | 描述 | 来源 |
|---|---|---|
| 修改 CHECK | `result_type` 增加 `'JOB_SKILL_SCORE'` | v1.0.9 §11.13.6 |
| 修改 CHECK | `strategy_type` 增加 `'JOB_SKILL_ASSESSMENT'` | v1.0.9 §11.13.6 |
| 修改 CHECK | result_type ↔ source_aggregate_type 约束扩展 | v1.0.9 §11.13.6 |

**变更理由**：PRD v1.0.9 引入 JOB_SKILL_SCORE 结果类型，对应 JOB_SKILL_ASSESSMENT 策略。

### 8. task_report / domain_event_projection

**相对 v0.1.10 现状的差异：**

无 schema 级变更。report_content_json 支持 `report_scope = 'JOB_SKILL'`（job-skill-report-v1.0）由应用层 validator 分支校验。domain_event_projection 的 event_type 为自由文本无 CHECK 约束。

---

## 种子数据变更

### strategy_config 种子

1. **现有 BASELINE_ASSESSMENT 种子**：`question_policy_json` 需升级为 question-policy-v1.2 格式（增加 `eligible_bank_domains: ["BASE_ABILITY"]`），`scoring_policy_json` 升级为 scoring-policy-v1.1 格式。
2. **现有 MOCK_EXAM 种子**：同上。
3. **现有 TRAINING_PRACTICE 种子**：不变。
4. **新增 JOB_SKILL_ASSESSMENT 种子**：
   - `strategy_id = 'strategy_job_skill_shelver_v1'`
   - `strategy_type = 'JOB_SKILL_ASSESSMENT'`
   - `job_code = 'SUPERMARKET_SHELVER'`
   - `online_question_count = 18`, `offline_question_count = 6`, `max_score = 48`
   - `competent_threshold = 80`, `conditional_threshold = 60`
   - `question_policy_json`：question-policy-v1.2 FIXED_SET 结构
   - `scoring_policy_json`：scoring-policy-v1.2 JOB_SKILL 结构

---

## 触发器变更

### 新增触发器

| 触发器名 | 表 | 说明 | 来源 |
|---|---|---|---|
| trg_question_bank_active_semantic_immutable | question_bank | ACTIVE 状态下阻止语义字段修改 | v1.0.8 |
| trg_assessment_session_question_insert_validation | assessment_session_question | INSERT 时校验来源题目 ACTIVE、域一致、phase 合法 | v1.0.7 + v1.0.9 |
| trg_answer_record_session_question_validation | answer_record | 校验 session+question 存在于 assessment_session_question 且 phase=ONLINE | v1.0.7 |
| trg_offline_score_observation_payload_required | offline_score_record | TEACHER_OBSERVATION scope 必须有 observation_payload_json | v1.0.9 |

### 修改触发器

| 触发器名 | 修改内容 | 来源 |
|---|---|---|
| trg_question_bank_referenced_semantic_immutable | 冻结字段列表扩展 + 增加 bank_domain/job_module_code/item_usage | v1.0.7 + v1.0.8 |

---

## 约束与不变式

1. strategy_config 仍是组卷/评分/红线规则唯一定义源（AGENTS.md）。
2. 终态（COMPLETED/REDLINE_HALTED/ABORTED）不可转出，触发器不变。
3. 红线触发后 LEVEL_FAIL_BY_SAFETY 不可恢复。
4. assessment_session 状态机开放态包含 OFFLINE_PENDING（不变）。
5. JSON 字段在应用层做 schema 验证（不在 SQLite CHECK 中解析 JSON）。
6. 不引入 ORM。

---

## [!] PRD 间冲突与处理

1. **v1.0.7 "OBSERVATION_ONLY 不得进入 assessment_session_question" vs v1.0.9 明确允许以 OBSERVATION phase 进入**：按 v1.0.9 最终决策执行。v1.0.8 §11.12.8 条 1 的同类约束也由 v1.0.9 废止。

2. **v1.0.8 目标基线写 v0.1.11 vs v1.0.9 跳过 v0.1.11 直接到 v0.1.12**：v0.1.11 从未实际生成，按 v1.0.9 直接产出 v0.1.12。

3. **v1.0.8 §8.7.4 `post_disclosure_done` 布尔 vs v1.0.9 改为可选 `post_disclosure_status`**：按 v1.0.9 最终决策，schema 层不涉及（在 JSON payload 内）。
