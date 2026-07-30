# M5B-14 R3 Production Cutover Review

## 审查结论

`CONDITIONAL_PASS`。

本次生产切换使 M5B v2.2 command/batch runtime 成为正式启动与 IPC mutation 边界：schema/startup 迁移、runtime composition、preload metadata、handler registry 和 renderer runtime health 已共同接通。自动化证据未发现未关闭的 P0 或 P1。

本审查与实施处于同一上下文，不能作为独立 R3 `PASS`；M5B-15 必须另由未参与实现者复核。

## 核验范围

- 精确 M4 到 v0.1.18 的 backup-before-DDL migration、fresh database 与 fail-closed drift handling。
- 75-channel runtime inventory，36 batch-domain 与 10 gate-only command 的唯一 mutation composition。
- durable result/replay、prepared batch recovery、runtime read-only health 公开边界。
- safety redline 与 report artifact 的 production handler routing。

## 已核验项

- `runConnectionEventBatchCutover()` 对 fresh、exact M4 与已是目标三种来源分别处理，未知或部分结构被拒绝；历史迁移在 DDL 前调用配对备份。
- `ApplicationRuntime` 只组合 v2 coordinator/recovery/domain executor；handler registry 的 production mutation 不再直接调用 legacy write service。
- trusted command metadata 由 preload 注入，公开 caller payload 不能伪造 actor、device 或 command idempotency 身份。
- target inventory 固定为 75 channels 和 `pending=0`；legacy service 只作为 clone-only planning oracle。这个静态引用例外不具有 production writer capability，且有 source delta/reverse reconstruction 防止静默回归。
- runtime health 在不一致或恢复拒绝时暴露只读状态；OPEN 状态下 renderer 不显示阻断 banner。

## 实际证据

| 检查 | 状态 |
|---|---|
| M5B inventory historical/target tests | PASS |
| exact M4 migration、connection cutover tests | PASS |
| full isolated database verifier | PASS |
| typecheck、build、lint quiet | PASS |

## 残余风险

- 不是独立审查：`NOT_RUN`，不得提升为 R3 `PASS`。
- 原生 Electron ABI、UI smoke 和人工业务流由 M5B-15 收口；本文件不替代该证据。
- legacy planner oracle 的静态依赖是有意的过渡兼容面；后续若能将 planner 改为纯 v2 读取，应删除此例外并收紧 inventory。
