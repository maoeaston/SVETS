# M5B-13 R3 Code Review

## 审查结论

`CONDITIONAL_PASS`。

本步骤在 test-only 边界内实现了报告 HTML 导出的可恢复工件发布：报告字节、哈希、目标目录身份与公开结果都冻结进 `REPORT_EXPORTED` v3 EVENT；PREPARE 后只依据该 EVENT 发布或重建工件。审读及自动测试未发现未关闭的 P0 或 P1。

本审查与实现处于同一上下文，不是独立 R3 审查。因此不得提升为 `PASS`，也不能替代 M5B-15 的独立最终审查。

## 审查范围

- 类型：代码与 M5B-13 实施合同审查。
- 风险：R3（持久化 EVENT、PONR 恢复、外部文件系统与报告投影）。
- 实施合同：`doc/features/event-batch-v2.2-runtime-impl.md` 的 Step M5B-13。
- 适用不变量：`INV-EVT-001`、`INV-EVT-003`、`INV-AUTH-001`、`INV-DATA-001`。
- 未审查的生产范围：Electron dialog、production command composition、IPC/preload、正式 startup/schema 与默认数据库；这些均由 M5B-14/15 负责，当前为 `NOT_RUN`。

## 已核验通过的关键项

- `artifact-probe.ts` 在 durable PONR 前验证显式根、目标缺失、probe 归属和目录 barrier；嵌套链接、根外路径和占用 probe/stage 均拒绝。
- 目标根与父目录的 canonical path、device、inode 被冻结进 artifact 事实。`artifact-publisher.ts` 在每次 publish/recovery 前重新比较身份；根或父目录被链接替换时拒绝，不会向根外写入。
- 发布使用硬链接 no-clobber。外来 target 的不同 hash、目标符号链接以及 PREPARE 后出现的冲突均拒绝并保留外来文件。
- 每次发布使用新的随机 stage 名；预存的确定性 stage 即使字节相同也不会被读取、链接或删除。当前调用只清理自己创建并通过 inode/link-count 校验的 stage。
- `REPORT_EXPORTED` v3 payload 同时校验业务 F7 字段、artifact bytes/hash/size、目录身份和 root result；投影复用冻结 report reducer，并以 schema v3 marker 完成已应用标记。
- `EventBatchCoordinator` 在 durable source reload 后、SQLite APPLY 前执行 pre-APPLY effect；`StartupRecovery` 在不调用 planner/dialog 的前提下重放同一 effect。`BEFORE_APPLY` PONR 测试证明删除工件后可由 EVENT 重建，`plannerCalls: 0`。
- 取消路径通过当前 lease/envelope 一致性检查后持久化 `{ success: true, canceled: true }`，不创建 batch 或 `REPORT_EXPORTED`。
- `artifact` 隔离验证阶段只在唯一 `/tmp/svets-m5b-*` 根下执行 publish、缺失重建和外来 target 保留；成功后删除其自有临时根。

## 已执行检查

| 检查 | 状态 | 证据 |
|---|---|---|
| 工件、计划、投影定向回归 | PASS | 6 files / 29 tests：probe、publisher、recovery、report export planner、projector、isolated verifier。 |
| 既有 report export 回归 | PASS | `src/main/domain/__tests__/report-export.test.ts` 与 `src/main/ipc/handlers/__tests__/report-export.test.ts` 共10 tests通过。 |
| TypeScript | PASS | `npm run typecheck`退出码0。 |
| 隔离 artifact 验证 | PASS | `npm run db:m5b:isolated:verify -- --stage artifact`：published/rebuilt/probe clean/external target preserved 均为 true，临时根已删除。 |
| source delta | PASS | M5B-13 精确登记14个 direct callsite、0个新增 capability 入口；当前 digest 为 `4c4013bdbad060e06d4c6fae0bd93d8280e5add4cdb260f371c3e553aeb10b56`。 |

## 残余风险

- PONR 后进程在目标发布完成、stage 清理前中断时，旧 stage 可能保留。恢复优先采用已存在且 hash 相同的 target，不会猜测或删除遗留 stage，以保证绝不删除外来文件；这属于可恢复的磁盘清理残余，不影响 EVENT、报告投影或目标 bytes。
- 真实 Electron 保存对话框、真实用户目录权限/文件系统兼容性、生产 startup 和多进程竞争为 `NOT_RUN`，不得以 test-only 结果替代；M5B-14/15 必须在显式授权后验证。

## 规则沉淀候选

- M5B-13 的目录身份与外来 stage 测试已自动化；M5B-14 接线时应保持该 publisher 为唯一 artifact 发布入口，避免重新引入直接 `writeFile` 导出路径。
