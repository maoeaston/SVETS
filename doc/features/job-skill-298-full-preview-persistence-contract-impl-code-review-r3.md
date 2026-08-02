# JOB_SKILL 298 全量预览持久化实现 R3 复核

- 复核对象：`doc/features/job-skill-298-full-preview-persistence-contract-impl.md` Step 0–10 及其实现变更
- 复核类型：实现级 `/vibe-review impl` 证据复核
- 复核结论：`CONDITIONAL_PASS`
- 已观察问题：`P0=0`、`P1=0`；保留人工验收和独立性限制

## 复核范围

复核覆盖 0.1.19 additive schema/migration、preview/formal ownership descriptor、principal/auth scope、preview session/safety、feedback vault/reference、M5B command/recovery、17 个 IPC 通道、read model、readiness registry、隔离 verifier，以及为保持 M5B 历史边界而更新的 inventory 过滤逻辑。复核未将 dirty worktree 中与本任务无关的既有改动纳入功能结论。

## 证据结论

1. `PREVIEW_CONTRACT_V1` 的事件、投影、query、recovery、error map 和 IPC source digest 有封闭注册与负向 tamper 检查；fresh/current isolated DB 在 registry 为 `INSTALLING` 时不会开放。
2. formal 与 preview 的 shell、event/projector、result suppression 和 safety 分支均有显式边界；preview 不通过旧 formal result/report 路径补写结果。
3. principal/caller/scope 校验和 feedback vault bridge 通过定向测试覆盖 sender spoof、scope mismatch、collision、reconcile 和 privacy boundary；未发现请求正文可改变授权结果的路径。
4. 全量测试、类型检查、lint、build、M5B event-batch 门禁和 preview IPC exact-set 门禁均已执行并通过。

## 复核修复记录

初始复核发现 readiness verifier 虽检查了 preview 结构和 registry digest，但没有实际调用 Step 0 parity verifier。已在 `scripts/lib/preview-contract-ready.mjs` 接入 parity，并在 readiness 返回值中保留 parity 状态；3 个 preview verifier 测试文件的 12 项定向测试及随后全量 193 files / 1558 tests 均通过。

## 限制与剩余门

- 本复核由当前实现会话完成，属于有证据的同上下文复核，不等同于另一位审查者或另一代理执行的独立 R3 审查；因此结论不提升为独立 `PASS`。
- Electron/UI、真实签名和安装信任链、真实 `userData`、多设备业务流、迁移 upgrade/rollback 故障注入均未执行，见配套验收记录；这些是当前 `CONDITIONAL_PASS` 的明确剩余门。
- `contract:m5b:scope:check -- --step M5B-15` 因 dirty worktree 混有既有用户改动和本任务改动而无法完成单一提交范围判断；M5B 功能门禁本身仍通过。
- 没有访问或 promotion 默认数据库。`READY` 仅在测试内显式 promotion 的隔离库成立；新鲜/当前同步库仍为 `INSTALLING`。

在人工门和真正独立实现复核完成前，不能把本记录解释为生产发布批准，也不能恢复原产品计划的题库、素材或 UI 交付。
