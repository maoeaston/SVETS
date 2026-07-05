# 实操评分（Operation Scoring）Mini-PRD

版本：v1.0.1（经 Reviewer 审查修订）  
关联 PRD：v1.0.6 §5.6（线下实操评分 — 双轨分离 TASK_OPERATION 轨道）  
schema 基线：v0.1.10-scoring-closure

---

## 功能名称

实操评分（Operation Scoring）— 教师对学生"拆箱与上架"任务的线下实操表现进行结构化评分，生成 `OPERATION_PASS_RATE` 结果。

## 解决的问题

MVP 闭环要求"测评→训练→评分→报告"四环完整。当前测评和训练已实现，但教师无法对学生的真实任务实操进行结构化评分并生成达标率结果。缺少这一环，报告无法包含 `OPERATION_PASS_RATE` 数据。

## 用户角色

- **TEACHER**：发起评分、确认教具清单、逐项评分、填写观察备注、提交评分。
- **STUDENT**：被动角色，线下执行实操，不与系统交互。

## 核心使用场景

### 前置条件

- 该学生存在一个 `assessment_session`，状态为 `OFFLINE_PENDING`（线上 42 题已完成，等待线下评分）。
- 该学生 + 任务下无未解决安全事件。

### 流程步骤

1. 教师从测评列表中选择状态为 `OFFLINE_PENDING` 的 assessment_session，进入实操评分页。
2. 系统展示"拆箱与上架"任务的 9 个实操评分项（task_operation_code）及对应的评分标准（rubric）。
3. 教师确认教具清单已准备就绪（session 级别一次性操作）。
4. 学生在线下执行实操，教师观察。
5. 教师逐项按 0 / 1 / 2 评分：
   - 0 = 不达标
   - 1 = 需改进 / 需辅助
   - 2 = 达标
6. 教师可为每项填写观察备注（`observation_note`，可选）。
7. 教师在页面填写完 9 项后一次性点击"提交评分"（单次 IPC 调用，批量提交）。
8. 系统在一个事务中写入 9 条 `offline_score_record`（`score_scope = TASK_OPERATION`，`tool_checklist_confirmed = 1`），每条产生一个 `OFFLINE_SCORE_SUBMITTED` 事件（event_sequence 连续递增）。
9. 全部 9 项写入成功后，系统计算 `OPERATION_PASS_RATE`：
   - `raw_score` = 9 项分数之和（0~18）
   - `max_score` = 18
   - `normalized_score` = raw_score / max_score * 100
   - `level_result` 按 strategy_config 阈值判定（MVP 决定：复用 competent_threshold=80 / conditional_threshold=60）
10. 系统写入 `result_record`（`result_type = OPERATION_PASS_RATE`，`completion_ratio = 1.0`）+ `RESULT_CALCULATED` 事件。

### 9 个实操评分项（task_operation_code）

| # | task_operation_code | 评分项名称 |
|---|---|---|
| 1 | `IDENTIFY_BOX` | 识别纸箱 |
| 2 | `CHECK_BOX_DAMAGE` | 检查箱体是否破损 |
| 3 | `OPEN_PACKAGE_SAFELY` | 按安全方式打开包装 |
| 4 | `TAKE_OUT_GOODS` | 取出商品 |
| 5 | `CHECK_GOODS_APPEARANCE` | 检查商品外观 |
| 6 | `IDENTIFY_SHELF_POSITION` | 识别货架位置 |
| 7 | `PLACE_BY_RULE` | 按规则摆放 |
| 8 | `TIDY_SHELF_FACE` | 整理排面 |
| 9 | `CONFIRM_COMPLETION` | 完成后确认 |

枚举定义位置：`src/shared/types/operation-scoring.ts` 中定义为 TypeScript 字面量联合类型，前后端共用。不写入 DB CHECK 约束（保留后续任务扩展灵活性）。

## 功能范围

### 本次做什么

- 教师端实操评分页面（从 OFFLINE_PENDING 的 assessment_session 进入）
- IPC handler：批量提交实操评分、查询评分状态、计算 OPERATION_PASS_RATE
- 领域事件写入（OFFLINE_SCORE_SUBMITTED × 9 + RESULT_CALCULATED × 1）
- assessment_session 状态不变（OFFLINE_PENDING 是等待线下评分的开放态；OPERATION_PASS_RATE 生成后 session 状态由后续报告流程驱动）
- Reducer：处理 OFFLINE_SCORE_SUBMITTED 事件，写入 offline_score_record 投影

### 本次不做什么

- OFFLINE_ABILITY 轨道（基础能力线下 8 题评分）——独立功能，拆分实现
- 报告生成——下一功能
- 评分修订（revision 机制）——MVP 支持 revision_no 字段，但首版 UI 不提供"修改评分"入口
- 教具清单配置管理——MVP 硬编码清单文案，不做动态配置
- assessment_session 从 OFFLINE_PENDING → COMPLETED 的状态迁移——由基础能力线下 8 题评分完成后驱动

## 关键设计决策

### D1：criterion_scores 适配 TASK_OPERATION

事件 payload `OFFLINE_SCORE_SUBMITTED` 定义了 `criterion_scores: CriterionScore[]`。对 TASK_OPERATION 轨道，每个 task_operation_code 仅产生一个 0/1/2 分（单维度评分），`criterion_scores` 数组长度为 1，`criterion_id` 使用 task_operation_code 本身。`total_score` = 该项的 score（0/1/2）。

### D2：scoring_rubric_json 内容来源

schema 要求 `offline_score_record.scoring_rubric_json` NOT NULL。MVP 评分标准硬编码在共享配置 `src/shared/types/operation-scoring.ts` 中，写入 offline_score_record 时将对应评分项的 rubric 描述 JSON 填入此字段（作为历史快照存储），保证 NOT NULL 约束和评分可追溯。

### D3：红线中途触发后不生成 OPERATION_PASS_RATE

如果 9 项未全部提交时红线触发（session 变 REDLINE_HALTED），已提交的评分记录保留，但**不生成** `OPERATION_PASS_RATE` result_record。该 session 的实操结果由安全终止报告反映。

### D4：RESULT_CALCULATED 的 completion_ratio

OPERATION_PASS_RATE 的 `RESULT_CALCULATED` 事件中 `completion_ratio = 1.0`（因为只有 9 项全部评分完成才触发计算）。

### D5：tool_checklist_confirmed 粒度

教具清单确认是 session 级别的一次性操作（前端在提交前强制勾选）。批量写入 9 条 offline_score_record 时统一设 `tool_checklist_confirmed = 1`。

### [!] D6：上游规范 bug 标记

`doc/specs/xc-career-guide-json-field-schema-v1.0.0.md` §10 中 `OperationPassRatePayload.CriterionScore.question_id` 应为 `task_operation_code`。实现时以 schema 约束（TASK_OPERATION 时 question_id = NULL，task_operation_code 非空）为准。后续统一修正规范文档。

## 边界条件和异常处理

| 条件 | 处理 |
|---|---|
| session 不在 OFFLINE_PENDING 状态 | 阻断，返回错误 |
| 该 student+task 存在未解决安全事件 | 阻断，提示先处理安全事件 |
| session 已处于 REDLINE_HALTED | 阻断，不允许评分 |
| 同一 session + task_operation_code 已有 VALID 评分 | 阻断（唯一索引保证），提示已评分 |
| 教具清单未确认 | 阻断提交 |
| 评分值不在 {0, 1, 2} | schema CHECK 约束拒绝 |
| 9 项未全部提交就请求计算结果 | 不适用（批量提交自动触发计算） |
| 评分中途安全红线触发 | 已提交评分保留，session 进入 REDLINE_HALTED，后续提交被阻断，不生成 OPERATION_PASS_RATE |
| 提交的 task_operation_code 不在合法枚举中 | handler 层校验拒绝 |
| 提交项数不等于 9 | handler 层校验拒绝 |

## 与现有功能的接口关系

| 功能 | 关系 |
|---|---|
| assessment_session | 本功能依赖 OFFLINE_PENDING 状态的 session 作为评分载体。session_id 是 offline_score_record 的外键 |
| safety_incident | 未解决安全事件阻断评分；评分中途触发红线终止评分 |
| result_record | 生成 OPERATION_PASS_RATE 结果投影 |
| strategy_config | 复用 competent_threshold / conditional_threshold 判定等级 |
| 报告（后续功能） | 报告需读取 OPERATION_PASS_RATE 结果 |
| OFFLINE_ABILITY 评分（后续功能） | 与本功能共用 offline_score_record 表，通过 score_scope 分流，互不干扰 |

## 成功验收标准

1. 教师可以打开实操评分页，看到 9 个评分项及其评分标准。
2. 教师可以确认教具清单（勾选后方可提交）。
3. 教师可以按 0 / 1 / 2 评分。
4. 教师可以为每项填写观察备注。
5. 批量提交后生成 `OPERATION_PASS_RATE` 结果（result_record 中 result_type = OPERATION_PASS_RATE，source_aggregate_type = ASSESSMENT_SESSION）。
6. `OFFLINE_SCORE_SUBMITTED` 事件正确写入 × 9（score_scope = TASK_OPERATION，question_id 为空，task_operation_code 非空，criterion_scores 长度为 1）。
7. `RESULT_CALCULATED` 事件正确写入（result_type = OPERATION_PASS_RATE，completion_ratio = 1.0）。
8. normalized_score 计算正确：sum(scores) / 18 * 100。
9. level_result 按 strategy_config 阈值正确判定。
10. 安全红线触发后评分入口被阻断。
11. 同一 session 不可重复提交相同 task_operation_code 的评分（唯一索引保证）。
12. 未在 OFFLINE_PENDING 状态的 session 不可进入评分。
13. `TASK_OPERATION` 记录不参与 `ABILITY_SCORE` 计算（schema 层 CHECK 约束保证 question_id 为空）。
14. scoring_rubric_json 正确写入每条 offline_score_record（NOT NULL 约束满足）。

## 风险点

- 与 OFFLINE_ABILITY 的提交顺序无耦合：两轨可独立提交，不要求先后顺序。但 assessment_session → COMPLETED 需要两轨都完成（本次不实现这个状态迁移）。
- [!] 上游规范 bug（见 D6），需在下次规范修订时同步修正。
