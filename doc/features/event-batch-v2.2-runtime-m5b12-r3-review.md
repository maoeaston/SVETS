# M5B-12 R3 Code Review

## 审查结论

`CONDITIONAL_PASS`。

本步骤在 test-only 边界内完成五个安全 root 的 prepared planner/projector：四个安全生命周期命令和 `assessment:triggerRedline`。新 redline 路径严格写入一个 `SAFETY_INCIDENT_CREATED` v2 EVENT，数据库既有 M4 trigger 负责按 `student_id + job_code + task_code` 熔断和绑定开放会话，projector 随后只应用已冻结的安全结果与训练步骤事实。审读和自动证据未发现未关闭的 P0 或 P1。

本审查与实现处于同一上下文，不是独立 R3 审查，不能代替 M5B-15 的独立最终审查或生产验收。

## 审查范围

- 实施合同：`doc/features/event-batch-v2.2-runtime-impl.md` 的 Step M5B-12。
- 风险：R3，涉及安全红线、事件投影、状态机、权限和持久化。
- 适用不变量：`INV-EVT-001`、`INV-EVT-003`、`INV-SAFE-001`、`INV-SAFE-002`、`INV-SAFE-004`、`INV-AUTH-001`、`INV-RES-002`。
- 生产 composition、IPC/preload、startup、schema/migration 注册、Electron 和默认数据库均未接线或访问，状态为 `NOT_RUN`。

## 已核验项

- `SafetyPlanner` 只从读取快照冻结新 EVENT；redline 恰好产生一个 `SAFETY_INCIDENT_CREATED`，不产生新的 `REDLINE_TRIGGERED`。
- 触发 redline 后，projector 先插入 incident，由原生 M4 trigger 熔断同一三元组的 assessment/training 会话并创建 binding；随后才写入 safety override result 和失败训练步骤。
- 确认、结案、作废和事实纠正替换均保留冻结的前后状态、角色、时间和 replacement 关系；TEACHER 只可确认，终结操作由 ADMIN 执行。
- `AFTER_PREPARE_FSYNC` 故障后，`StartupRecovery` 只重放已持久化 batch，`plannerCalls: 0`；不会重新计算安全事实或产生第二个 redline EVENT。
- M4 safety SQL inventory 已逐条登记 planner/projector 的 11 条新增生产源码 SQL：2 条三元聚合查询、6 条 incident 主键查找/生命周期写入和 3 条准备事实投影写入。
- 隔离 safety stage 在唯一 `/tmp/svets-m5b-*` 根中完成 M4 到 event-batch schema 的迁移、单 EVENT redline、2 条 binding、训练步骤失败、安全结果和重开持久化检查；成功后删除该临时根。

## 已执行检查

| 检查 | 状态 | 证据 |
|---|---|---|
| safety planner/projector 回归 | PASS | 2 files / 7 tests：单 redline EVENT、M4 trigger/binding/result/step、确认/结案、作废、事实纠正替换和 PREPARE 后恢复。 |
| M4 safety SQL inventory | PASS | `npm run contract:m4:safety-sql:check`：68 hits，`15` 三元聚合、`26` incident 主键、`3` student-wide、`24` non-safety。 |
| 隔离 safety 验证 | PASS | `npm run db:m5b:isolated:verify -- --stage safety`：1 event、2 bindings、planner calls=1，重开后 persisted=true。 |
| M5B-12 source delta | PASS | 当前 digest `523387a6779e4a379f098038798e866f42726efb8609ac8adbdba64d4412efda`，精确登记 8 个 safety projector direct callsite。 |
| M5B-13 历史快照 | PASS | 仍固定为 digest `4c4013bdbad060e06d4c6fae0bd93d8280e5add4cdb260f371c3e553aeb10b56`，验证时排除后续 M5B-12 登记项。 |

## 残余风险

- legacy `SAFETY_INCIDENT_CREATED + REDLINE_TRIGGERED` 回放兼容、现有 IPC/服务的 A/B 差分和原生 M4 migration 回归仍需在完整回归中复核；本步骤未修改 legacy oracle 或生产入口。
- Electron、真实教师/管理员操作、真实多设备竞争、production cutover 与默认数据库为 `NOT_RUN`。M5B-14/15 未获明确授权前不得推进。

## 规则沉淀候选

- 安全 planner/projector 中新增的所有可执行 SQL 都必须进入 M4 safety SQL inventory；新增 safety source 文件时，不得以 test-only composition 为由省略登记。
