# 数据保存与恢复闭环实现

对应需求：`data-persistence-recovery-prd.md`  
状态：`IMPLEMENTED_VERIFIED_2026-07-23`

## 阶段 1：日志完整性服务

- 已新建 `src/main/domain/recovery.ts`，通过 `DBAdapter` 与显式日志路径运行，专项测试只使用内存库和 `/tmp`。
- 已逐行验证 JSON、`ActionLogEntry` 必填字段、聚合类型加聚合 ID 范围内的事件序号，以及 `sha256(JSON.stringify(payload))`。
- 已仅允许最后一条非空记录 JSON 损坏时归档并截断；中间损坏、checksum 不符和序号冲突均失败关闭。

## 阶段 2：缺失事件投影补写

- 已为 JSONL 中不在 `domain_event_projection` 的事件补写原始事件投影，再按事件类型调度 assessment、training、assignment reducer。
- 每个事件在独立 SQLite 事务中处理。任一 reducer 失败时事件投影和业务投影一起回滚，启动失败关闭。
- 已存在 `event_id` 的事件严格跳过，恢复重复执行保持幂等。

## 阶段 3：非 reducer 事件恢复

- 已为 `SAFETY_INCIDENT_CREATED` 建立专用恢复写入，复用 schema trigger 的熔断和绑定约束；其后的 `REDLINE_TRIGGERED`、`RESULT_CALCULATED` 仍复用 assessment reducer。
- `REPORT_GENERATED` 事件已补齐来源聚合、标题和最终 `report_content`。恢复服务只从事件 payload 写回 `task_report`，不读取渲染层数据。
- 旧版报告事件若缺少完整重建字段，恢复服务以 `UNRECOVERABLE_EVENT` 明确阻断，并回滚该事件投影。

## 阶段 4：启动、快照和验收

- `initDatabase()` 已在 schema、迁移和 seed 后调用恢复服务。成功后写 RECOVERY 系统事件与 `snapshot_meta`；失败会关闭数据库。IPC 注册已移到恢复成功之后。
- 已覆盖日志孤儿、尾行损坏、中间行损坏、checksum 错误、序号冲突、训练恢复、幂等、红线安全事件、报告恢复、旧版报告阻断和快照元数据。
- 专项测试使用内存库和临时日志，不访问运行库 `xc-career-guide.db`。
- 2026-07-23 验证通过：`npm test`（80 files / 903 tests）、`npm run typecheck`、`npm run build`、`npm run docs:index:check` 与 `git diff --check`。`npm run lint` 为 0 error，保留 175 条既有 Vue 格式 warning。
- [!] 默认运行库存在本任务前已有的内容包漂移，`npm run db:verify` 仍由独立数据运维任务处理；F3 未读取或写入该运行库。
