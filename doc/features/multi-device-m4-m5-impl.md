# 多设备 M4/M5 实施任务书

状态：M4 READY FOR REVIEW；M5 待 M4 完成后细化  
日期：2026-07-18  
对应 PRD：`doc/features/multi-device-m4-m5-prd.md`  
当前基线：schema v0.1.15-multi-device-m3-grant-assignment  
M4 目标版本建议：schema v0.1.16-multi-device-m4-safety-rekey

## 1. 影响面扫描结论

M4 不是只修改 4 个 schema trigger。当前两元语义同时存在于索引、10 个触发器、多个 handler 前置查询、训练步骤级联、结果报告关联和测试夹具中。

### 1.1 Schema

`src/main/db/schema.sql` 需要处理：

- 开放会话唯一索引：
  - `ux_assessment_one_open_session_per_student_task_strategy`
  - `ux_training_one_open_session_per_student_task`
- 性能查询索引：
  - `idx_assessment_session_student_task_status`
  - `idx_training_session_student_task_status`
  - `idx_safety_incident_student_task_status`
- 4 个主迁移触发器：
  - `trg_safety_incident_bind_open_assessments`
  - `trg_safety_incident_bind_open_trainings`
  - `trg_assessment_session_block_unresolved_safety_incident`
  - `trg_training_session_block_unresolved_safety_incident`
- 4 个 REDLINE_HALTED incident 同归属守卫：
  - assessment insert/update 两个。
  - training insert/update 两个。
- 2 个 replacement incident 同归属守卫：
  - replacement insert/update 两个。

建议将 6 个名称含 `same_student_task` 的旧触发器 DROP 后改名为 `same_student_job_task`，避免对象名继续表达错误语义。migration 结构断言必须验证 SQL body，不得只验证新对象名存在。

### 1.2 Migration runner

`src/main/db/migrations.ts` 需要：

- 新增 M4 schema version 和 migration id 常量。
- 保留 M1 → M2 → M3 → M4 严格顺序。
- 增加 `isM4StructurallyApplied()`，至少验证 3 个新查询索引、2 个新唯一索引和 10 个三元触发器。
- `assertCurrentDatabaseSchema()` 目标升级到 M4。
- M4 不重建既有表，默认不需要关闭 foreign_keys。
- migration 事务内先检查历史 `job_code` 非空和父子键一致，再替换对象并写 ledger。
- 结构完整但 ledger 缺失时只补记录；SQL body 漂移时 fail closed。
- M4 失败必须完整回滚到可识别的 v0.1.15。

### 1.3 运行代码

必须给以下查询补 `job_code`：

| 文件 | 当前风险 | M4 修改 |
|---|---|---|
| `src/main/ipc/handlers/assessment.ts` | 开放 session 和未解决 incident 查询只按 student/task | 使用 strategy.job_code 参与查询；日志补 jobCode |
| `src/main/ipc/handlers/training.ts` | 开放 training、incident 阻断和 halted step 查询只按 student/task | 使用 strategy.job_code；`haltTrainingSessionSteps` 增加 jobCode 参数 |
| `src/main/ipc/handlers/operation-scoring.ts` | 未解决 incident 可能被其他岗位误阻断 | session.job_code 参与查询 |
| `src/main/ipc/handlers/job-skill-scoring.ts` | session 查询未取 job_code，安全查询无法三元过滤 | SELECT 增加 job_code 并参与安全查询 |
| `src/main/ipc/handlers/job-skill-result.ts` | 报告安全事件 JOIN 只按 student/task，可能串入其他岗位事件 | JOIN 增加 job_code |

同时更新：

- `assessment:triggerRedline` 事务后的训练步骤级联只处理同 student/job/task。
- assessment/training reducer 的注释、冷启动重放断言和测试夹具改为三元语义。
- 任何异常中心、报告或统计新增查询不得继续复制两元过滤。

共享 IPC 输入不需要新增 jobCode；创建路径从冻结 strategy 取得 job_code，已有 session 路径从 session 反查，避免信任 UI 传入值。

### 1.4 文档

M4 同步修改：

- 全量产品权威合同中的安全归属语义。
- `architecture-plan-b-multi-device-v2.2-authoritative-baseline.md` §13.2，把遗漏的 6 个守卫纳入迁移合同。
- coverage matrix 和多设备迁移 PRD；为 M4 新增验证报告，不改写旧 validation report 的历史快照。
- schema 版本传播文件和会话交接。

冻结的 MVP PRD v1.0.9 不改写历史正文，只增加 Post-MVP 覆盖说明，防止将新语义伪装成 MVP 当时已实现。

## 2. 测试先行策略

先增加失败测试，再改 schema 和运行代码。测试分五层。

### 2.1 Schema 行为测试

新增 `src/main/db/__tests__/schema-m4-safety-rekey.test.ts`：

1. 同 student/task、不同 job 的两个 assessment 可同时开放。
2. 同 student/task、不同 job 的两个 training 可同时开放。
3. 同 student/job/task 的重复 assessment 仍被唯一索引拒绝。
4. 同 student/job/task 的重复 training 仍被唯一索引拒绝。
5. job A incident 只熔断 job A assessment/training。
6. job A incident 不阻断 job B 新 session。
7. session 绑定不同 job 的 incident 进入 REDLINE_HALTED 时被拒绝。
8. replacement incident 指向不同 job 时被拒绝。
9. 同三元键 replacement 正常通过。
10. 绑定生成仍满足每 incident/aggregate 唯一。

### 2.2 Migration 测试

扩展 `src/main/db/__tests__/migrations.test.ts`：

1. v0.1.15 真实结构迁到 M4，历史主键、状态、binding 和业务行不变。
2. v0.1.12 一次启动依次迁 M1-M4，只执行一次迁移前备份。
3. M4 结构完整但 ledger 缺失时只补记录。
4. ledger 已有但旧两元 trigger/index 仍存在时不得跳过。
5. 同名三元 trigger body 被改写时 fail closed。
6. 替换第 N 个对象时注入失败，事务回滚后 10 个旧触发器和旧索引仍完整。
7. `foreign_key_check` 空，`integrity_check=ok`。

### 2.3 Handler 测试

扩展：

- `assessment-create.test.ts`：其他 job 同 task 的开放 session/incident 不阻断；同三元键仍阻断。
- `training-create.test.ts`：同上。
- `assessment-redline.test.ts`：跨 job 不误熔断；同三元键 assessment+training 同时熔断。
- `operation-scoring.test.ts`：其他 job incident 不阻断评分。
- `job-skill-scoring.test.ts`：其他 job incident 不阻断岗位评分。
- `training-redline.test.ts`：步骤级联只影响同三元键 halted training。

### 2.4 结果与报告测试

- `job-skill-result.test.ts`：安全摘要不包含同 student/task 但不同 job 的 incident。
- 安全终止结果仍只产生一个 current result。
- 历史单岗位数据报告内容不变。

### 2.5 回归

- 全部 M3 assignment 测试继续通过。
- 基础能力、专业岗位、训练、评分、观察、报告和安全事件全量回归。
- 真实 SQLite 触发器行为测试，不只依赖 sql.js。

## 3. 实施步骤

### Step M4-1：合同和失败测试

影响文件：

- `doc/specs/FULL_PRODUCT_PRD_v2.0-draft.md`
- v2.2 架构正文/覆盖矩阵/验证计划。
- 新增 schema M4 测试和 handler 跨岗位测试。

完成条件：测试准确因为现有两元语义失败，不因夹具错误失败。

### Step M4-2：全量 schema 基线

- schema 版本升级到 v0.1.16。
- 替换 3 个性能索引、2 个唯一索引、10 个触发器。
- RAISE 文案和注释改成 `student_id + job_code + task_code`。
- schema migration seed 增加 M4 记录。

完成条件：新库加载、结构断言和 schema M4 测试通过。

### Step M4-3：增量 migration

- 实现 M4 结构检测、drift 检测和事务升级。
- 补 v0.1.15、v0.1.12 链式升级和故障注入测试。
- 确认 M4 不触发 M3 的 referenced-table rebuild 特殊路径。

完成条件：迁移测试、真实 SQLite 完整性检查通过。

### Step M4-4：Handler 三元过滤

- 修改 assessment/training 创建前置查询。
- 修改 operation/job-skill scoring 阻断查询。
- 修改训练步骤级联函数签名和调用。
- 修改 job-skill result 安全摘要 JOIN。

完成条件：跨 job 负向测试与既有同 job 正向测试通过。

### Step M4-5：文档传播与验收

- 更新架构覆盖矩阵、验证报告、迁移 PRD/impl、schema 基线和文档索引。
- 执行类型检查、lint、全量测试、构建和 `git diff --check`。
- 使用真实 Electron 创建同 student/task 的跨 job session，验证不误阻断；当前只有一个正式 job 时可使用测试 seed，不污染生产 seed。

## 4. M4 完成定义

1. 产品、架构、schema 和运行查询统一使用三元聚合键。
2. 10 个三元触发器、2 个三元唯一索引和 3 个三元查询索引通过结构与行为验证。
3. 跨 job 不误熔断、不误阻断、不误汇总。
4. 同三元键安全红线仍一次性熔断 assessment/training 并生成正确 binding/result。
5. v0.1.15 真实数据可原地迁移，失败可从配套备份恢复。
6. 类型检查、lint、全量测试、构建、文档索引和真实 SQLite 验证通过。
7. M4 独立提交、独立验收后才允许启动 M5A。

## 5. M5 状态

M5A-M5D 范围已在 PRD 中确定。本任务书暂不拆 M5 文件级步骤；M4 完成后，以实际三元安全语义和最新运行代码重新扫描 Command Bus 写入口，避免基于 v0.1.15 快照生成过期任务清单。
