# M5B-15 Final R3 Acceptance

## 审查结论

`PASS`。审查了 `8249974` 到 `210b3a2` 的 runtime 修复，并补核当前工作树登记的 M5B-15 planning clone、assignment projection、answer target 和 sequence 修复；已核对 read-only fail-closed 边界，未发现未关闭的 P0/P1。人工教师、学生、安全红线和可访问性验收不属于本代码审查结论，已由最终验收记录单独提供证据。

## 审查范围

- 类型：CODE
- 风险：R3（持久化命令、PREPARE/恢复、并发和运行时只读状态）
- base/head：`8249974...210b3a2`，当前 HEAD 为 `77b88b6`；工作树中的 M5B-15 修复集另以 source delta 固定并由最终回归覆盖
- 工件：`src/main/domain/event-batch/batch-coordinator.ts`、`src/main/application/runtime/m5b-domain-executor.ts`、`src/main/ipc/handler-registry.ts`，以及对应 command/recovery/inventory 测试
- 权威资料：`doc/specs/baseline.yaml`、`doc/specs/project-invariants.md`、`doc/ai/vibe-workflow-contract.md`
- 适用不变量：`INV-EVT-004`、`INV-EVT-005`、`INV-EVT-006`、`INV-SAFE-001`、`INV-SAFE-002`、`INV-SAFE-003`、`INV-A11Y-001`
- 未审查内容：未将人工业务操作或默认运行库作为本次代码审查证据；这两类项目仍须单独验收。

## 已执行检查

| 检查 | 状态 | 证据 |
|---|---|---|
| 真实差异与空白字符 | PASS | `git diff --stat 8249974...210b3a2` 为 11 个文件、273 additions/54 deletions；`git diff --check 8249974...210b3a2` 无输出。 |
| coordinator/recovery/IPC 回归 | PASS | `npm test -- src/main/domain/event-batch/__tests__/batch-coordinator.test.ts src/main/domain/event-batch/__tests__/startup-recovery.test.ts src/main/ipc/__tests__/handler-registry.test.ts`：3 files、21 tests 通过。 |
| gate-only、scope、inventory、isolated 回归 | PASS | `npm test -- scripts/__tests__/m5b-contract-scope.test.mjs scripts/__tests__/m5b-runtime-inventory.test.mjs scripts/__tests__/m5b-isolated-db.test.mjs src/main/application/command/__tests__/gate-only-executor.test.ts`：4 files、64 tests 通过。 |
| production runtime inventory | PASS | `npm run contract:m5b:event-batch:check -- --mode target`：75 channels，36 BATCH_DOMAIN / 10 GATE_ONLY，pending 全为 0。 |
| M5B 范围 | PASS | `npm run contract:m5b:scope:check -- --step M5B-15`：preserved=823、m5b_changes=114、violations=0；M5B-15 source delta 链校验通过。 |
| isolated migration/runtime | PASS | `npm run db:m5b:isolated:verify -- --stage full`：artifact、command、coordinator、gate-only、safety、schema、storage 均通过，7 个临时根均删除。 |
| migration/connection/runtime | PASS | `npm test -- src/main/db/__tests__/event-batch-migration.test.ts src/main/db/__tests__/connection-event-batch.test.ts src/main/application/runtime/__tests__/application-runtime.test.ts`：3 files、19 tests 通过。 |
| 原生 Electron ABI migration | PASS | `npm run db:m5b:native:verify`：exact M4 升级到 `0.1.18-event-batch-v2.2`，配对备份已验证。 |
| crash、tamper 与 command state | PASS | `npm test -- src/main/domain/event-batch/__tests__/fault-matrix.test.ts src/main/domain/event-batch/__tests__/tamper-recovery.test.ts src/main/application/command/__tests__/durable-command-store.test.ts`：3 files、35 tests 通过。 |

## P0

无。

## P1

无。

## P2

无。

## NOTE / 待验证

- `batch-coordinator.ts:365-373` 在获得 writer mutex 后先执行 `assertWritable()`。若运行时已是 `CORRUPTION_READ_ONLY`，它不会继续写 `command_log`；这符合实施计划 `event-batch-v2.2-runtime-impl.md:18` 和 `:594` 规定的“所有 mutation 零副作用拒绝”。此时无 PREPARE 的已受理 command 保持 `PROCESSING`，而 `startup-recovery.ts:698-709` 会在下一次受控启动、租约过期且证明没有 PREPARE 后复位为 `PENDING`。`fault-matrix.test.ts:143-177` 已覆盖这个 no-PONR reset/replan 合同，因此不是 P1。
- 原生 Electron ABI 迁移和 health/login/logout smoke 已有自动化证据，但不替代教师、学生、安全红线和可访问性人工验收。

## 已核验通过的关键项

- planner 抛错发生在未写 PREPARE 时，`batch-coordinator.ts:570-595` 会将 command 标记为 `FAILED`；对应测试断言无 batch 和无 projection source。
- PREPARE append/fsync 失败前已设定 `prepareWriteAttempted`，`batch-coordinator.ts:458-465` 不会误写 `FAILED`；恢复测试证明 complete PREPARE 可在不重调 planner 的情况下收敛为 `SUCCEEDED`，符合 `INV-EVT-005`。
- gate-only DML 与命令结果在同一 IMMEDIATE transaction 中完成，`gate-only-executor.ts:57-64`；事务抛错后新的 executor catch 将 pre-PREPARE command 标为 `FAILED`。
- 保存对话框与 artifact probe 的异常在 `handler-registry.ts:263-284` 被标为 `FAILED`，不生成 event batch。
- target inventory 未发现 legacy production writer，符合 `INV-EVT-006`；isolated safety stage 覆盖三元聚合键的 redline 熔断与结果 override，符合 `INV-SAFE-001` 至 `INV-SAFE-003`。

## 残余风险

独立 R3 已通过；人工教师、学生、安全红线与可访问性验收已在独立的最终验收记录中完成。默认运行库仍不得读取、初始化或修改。

## 规则沉淀候选

无。普通 pre-PREPARE 失败与 corruption fail-closed 两条语义已有针对性测试和恢复合同。

## 置信度

HIGH。当前补丁、迁移/连接、native ABI、crash/recovery、scope 和 isolated verifier 均在本轮实际执行；read-only 边界同时有权威实施计划和故障矩阵支撑。
