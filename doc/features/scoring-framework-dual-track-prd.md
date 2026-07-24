# F6 评分计算框架与双轨隔离 Mini-PRD

- 状态：`APPROVED_FOR_IMPLEMENTATION`
- 产品合同：`doc/specs/MVP_PRD_v1.0.9-authoritative.md`
- 计划来源：`doc/features/pilot-r0-foundation-development-plan-2026-07-22.md` F6
- 日期：2026-07-24

## 1. 目标

把基础能力、专业岗位、训练完成度和任务实操达标率收口到同一个可追溯的结果投影框架，但保持四类结果互相隔离。

本阶段只实现评分计算、结果生成、结果读取和隔离验收。题库与素材仍可保持 DRAFT，使用内存库、临时库和测试夹具验证；不得为了跑通 F6 激活题目、写真实运行数据库或输出正式报告结论。

## 2. 最小闭环

```text
已锁定策略版本的 session / training
  -> 线上 answer_record 与线下 offline_score_record 写入
  -> 评分服务按 strategy_config + session 快照分流计算
  -> RESULT_CALCULATED 事件写入 action_log.jsonl
  -> reducer 投影 result_record
  -> 读取当前结果与历史结果时保持 result_type 隔离
```

## 3. 结果范围

### 3.1 `ABILITY_SCORE`

来源：

- `assessment_session.strategy_type = BASELINE_ASSESSMENT` 或 `MOCK_EXAM`。
- 线上 `assessment_session_question.question_phase = ONLINE` 的 `answer_record`。
- 线下 `offline_score_record.score_scope = OFFLINE_ABILITY`。

规则：

- 线上 42 题按 0/2 计分，线下 8 题按 0/1/2 计分。
- `max_score = 100` 固定不随已答题量缩减。
- `completion_ratio = 已有效作答和已有效评分数 / 50`。
- 线上 6 个基础能力模块的模块得分率分母固定为 14，未答按 0 占位。
- 线下 8 题计入总分和报告明细，但不参与模块兜底判定。
- `completion_ratio < 1` 时只能生成过程分，不输出就业安置方向。

### 3.2 `JOB_SKILL_SCORE`

来源：

- `assessment_session.strategy_type = JOB_SKILL_ASSESSMENT`。
- 线上 `JOB_SPECIFIC` 题的 `answer_record`。
- 线下 `offline_score_record.score_scope = JOB_SKILL`。
- `TEACHER_OBSERVATION` 只进入观察完成度和报告观察区，不进入 raw score。

规则：

- 固定示范卷计分题为 18 道线上 + 6 道线下，`max_score = 48`。
- `normalized_score = raw_score / 48 * 100`。
- 必须在单条 `JOB_SKILL_SCORE.result_payload_json` 中保存 M1-M6 岗位模块画像，不拆成 6 条结果。
- 不套用基础能力模块兜底；低分模块只进入 `recommended_training_focus`。
- 专业岗位结果不得输出就业安置方向、岗位排除或自动录用/淘汰结论。

### 3.3 `TRAINING_COMPLETION`

来源：

- `training_session` 与 `training_step_record`。

规则：

- 训练结果保持 `result_type = TRAINING_COMPLETION`，不与测评分或实操达标率混算。
- F6 只校验现有生成和读取语义是否符合四类结果隔离；若现有实现已满足，不重写训练完成度算法。

### 3.4 `OPERATION_PASS_RATE`

来源：

- `offline_score_record.score_scope = TASK_OPERATION`。

规则：

- 只统计“拆箱与上架”任务 9 个实操评分项。
- `OFFLINE_ABILITY` 不得进入 `OPERATION_PASS_RATE`。
- F6 只校验现有生成和读取语义是否符合双轨隔离；若现有实现已满足，不重写任务实操评分算法。

## 4. 双轨隔离合同

线下评分由 `offline_score_record.score_scope` 强制分流：

| `score_scope` | 用途 | 计入结果 | 评分 |
|---|---|---|---|
| `OFFLINE_ABILITY` | 基础能力 8 道线下题 | `ABILITY_SCORE` | 0/1/2 |
| `TASK_OPERATION` | 拆箱与上架 9 项实操评分 | `OPERATION_PASS_RATE` | 0/1/2 |
| `JOB_SKILL` | 专业岗位固定卷 6 道线下题 | `JOB_SKILL_SCORE` | 0/1/2 |
| `TEACHER_OBSERVATION` | 专业岗位嵌入观察 | 不计分，只进观察完成度 | `score = NULL` |

强制规则：

1. 任何一条 `offline_score_record` 只能被一个结果类型读取。
2. 计算 `ABILITY_SCORE` 时必须显式过滤 `OFFLINE_ABILITY`。
3. 计算 `OPERATION_PASS_RATE` 时必须显式过滤 `TASK_OPERATION`。
4. 计算 `JOB_SKILL_SCORE` 时必须显式过滤 `JOB_SKILL`，并单独读取 `TEACHER_OBSERVATION`。
5. 结果读取 API 和报告框架不得把四类结果平均、相加或展示为单一总分。

## 5. 等级与覆盖优先级

### 5.1 基础能力

等级判定优先级固定为：

1. 安全红线：`LEVEL_FAIL_BY_SAFETY`，最高优先级。
2. 模块兜底：任一基础能力模块线上得分率 `< strategy_config.module_veto_threshold`，强制 `LEVEL_NOT_COMPETENT`。
3. 情绪崩溃兜底：累计崩溃次数达到 `strategy_config.emotion_collapse_threshold`，强制 `LEVEL_NOT_COMPETENT`。
4. 分数阈值：使用 `competent_threshold / conditional_threshold`。

结果 payload 必须持久化模块得分明细、触发兜底的模块、崩溃次数和完成率，不得只保存最终等级。

### 5.2 专业岗位

- 安全红线继续最高优先级。
- 正常完成时只按 `competent_threshold / conditional_threshold` 判定等级。
- 不因单个 M1-M6 模块低分覆盖总等级。
- 低于训练重点阈值的模块进入固定规则训练重点建议。

## 6. 结果写入与读取合同

- 结果写入必须通过 `RESULT_CALCULATED` 事件进入 `result_record`，投影必须可由事件重放重建。
- `raw_score`、`max_score`、`normalized_score`、`completion_ratio` 必须独立持久化。
- 同一 `result_type + source_aggregate_type + source_aggregate_id` 只能有一条 `is_current = 1`。
- 重复计算同一未变化来源应幂等返回已有 current result；若因 revision 产生新结果，旧结果必须可追溯且不被静默覆盖。
- 读取当前结果时必须按 `student_id`、`result_type`、`source_aggregate_type` 和 `source_aggregate_id` 明确筛选。
- 安全红线覆盖结果必须满足 `safety_overridden = 1`、`level_result = LEVEL_FAIL_BY_SAFETY`、`redline_incident_id` 非空。

## 7. 非范围

- 不激活 BASE_ABILITY 96 题或 JOB_SKILL 298 题。
- 不生成激活 SQL，不写 `xc-career-guide.db` 真实运行库。
- 不实现 F7 报告列表、详情、锁定、导出或 `report_content_json` 渲染。
- 不实现 298 题随机组卷或专业岗位完整题库后台。
- 不引入 ORM、前端状态持久化库、CSV 解析库或 Markdown 报告渲染库。
- 不输出就业安置方向；Pilot 模式和未完成测评均必须阻断安置方向输出。
- 不把 JOB_SKILL 固定规则训练重点称为 AI 推荐。

## 8. 验收标准

### 8.1 BASE_ABILITY 评分

1. 42 道线上题只产生 0 或 2；出现 1 分时写入或计算失败。
2. 8 道 `OFFLINE_ABILITY` 可产生 0/1/2，且全部有效评分后可生成 `ABILITY_SCORE`。
3. 只答 20/50 题即终止时，`max_score = 100`、`completion_ratio = 0.4`。
4. 任一模块线上得分 6/14 且总分 >= 80 时，结果仍为 `LEVEL_NOT_COMPETENT`，payload 指明触发模块。
5. 线下单题 0 分或某模块线下 0 题，不触发模块兜底。
6. 累计崩溃达到策略阈值时，等级为 `LEVEL_NOT_COMPETENT`，payload 记录崩溃次数和坐次/时间来源。
7. 安全红线触发时，结果为 `LEVEL_FAIL_BY_SAFETY`，且优先级高于模块兜底与情绪崩溃。
8. `completion_ratio < 1` 的结果不会返回就业安置方向。

### 8.2 双轨隔离

1. `OFFLINE_ABILITY` 进入 `OPERATION_PASS_RATE` 计算应失败。
2. `TASK_OPERATION` 进入 `ABILITY_SCORE` 计算应失败。
3. `JOB_SKILL` 不得生成 `ABILITY_SCORE`、`OPERATION_PASS_RATE` 或 `TRAINING_COMPLETION`。
4. `TEACHER_OBSERVATION` 必须 `score = NULL`，且不进入 raw score、max score、计分 completion_ratio 或模块得分率。
5. BASE_ABILITY session 不得读取 JOB_SPECIFIC 题目快照；JOB_SKILL_ASSESSMENT 不得读取 BASE_ABILITY 题目快照。

### 8.3 JOB_SKILL 评分

1. 线上题只能 0/2，线下题只能 0/1/2。
2. 18+6 计分完成后生成 `JOB_SKILL_SCORE`，`max_score = 48`，`normalized_score = raw / 48 * 100`。
3. `result_payload_json` 分开保存线上得分、线下得分和 M1-M6 模块画像。
4. 观察项不进入计分完成率，`observation_completion_ratio` 单独计算。
5. 单个岗位模块低分不会触发基础能力式一票否决。
6. 专业岗位结果不返回就业安置、岗位排除或自动录用/淘汰文案。

### 8.4 结果 current 与历史追溯

1. 同一来源同一结果类型重复计算不会生成第二条 current result。
2. revision 或重新评分产生新结果时，旧结果不被删除，current 指针唯一。
3. `RESULT_CALCULATED` 事件 payload 足够重放出 `result_record.result_payload_json`。
4. 结果读取按角色权限返回；学生只能读取本人结果，教师只能读取教学范围内学生结果，管理员可维护级查看。

### 8.5 验证命令

F6 实现完成前必须通过：

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run docs:index:check
git diff --check
```

本 Mini-PRD 新增后先通过：

```bash
npm run docs:index:update
npm run docs:index:check
```

## 9. 已知边界

- [!] PRD §17.6.2 要求 `offline_score_record` 缺失 `score_scope` 写入失败；当前 `src/main/db/schema.sql` 给 `score_scope` 设置了 `DEFAULT 'OFFLINE_ABILITY'`。F6 实现阶段必须用 schema migration、触发器或写入层强校验消除这个静默默认风险，并补失败用例。
- [!] F6 可用测试夹具推进，但正式 BASE_ABILITY 和 JOB_SKILL 施测仍被题目 DRAFT、NO_SCORE、renderer、线下锚点、素材与 Pilot 门禁阻断。F6 不得绕过这些门禁。
- [!] 现有 JOB_SKILL 评分结果已有部分实现。F6 应先复核现有 `job-skill-result`、`operation-scoring`、`training-complete` 和 `level-judge` 行为，能保留的保留，只补缺口和隔离验收。
