# 数据保存与恢复闭环

文件名：`data-persistence-recovery-prd.md`  
对应主 PRD：`doc/specs/MVP_PRD_v1.0.9-authoritative.md` §8、§17.2  
状态：`CURRENT_2026-07-23`

## 目标

把 `action_log.jsonl` 落实为业务事件的事实来源。应用启动时必须验证日志完整性，补回“日志已写入但 SQLite 事务未提交”的事件投影，并在无法安全恢复时阻断业务入口。

## 范围

- 逐行解析 `action_log.jsonl`，校验事件必填字段、事件序号和 payload checksum。
- 只允许截断最后一行的损坏 JSON。截断前归档损坏尾部，写 `RECOVERY_LOG_TRUNCATED` 审计。
- 对 JSONL 已存在、`domain_event_projection` 缺失的事件，在单个 SQLite 事务中补写事件投影和业务 reducer 投影。
- 每次成功恢复写入 `snapshot_meta`，并记录 `RECOVERY_REPLAYED` 审计。
- 在 `initDatabase()` 完成 schema、迁移和开发账号 seed 后，开放任何 IPC 前执行恢复。

## 不在范围

- 不删除或从零重建既有 SQLite 业务投影。
- 不同步多设备业务数据，不引入前端状态持久化，不修改真实运行数据库。
- 不激活题库或改变安全状态机。

## 关键约束

1. 非尾行损坏、checksum 不符、事件序号冲突、未知且无法安全跳过的事件，必须失败关闭。
2. 重放只处理缺少 `domain_event_projection` 的 JSONL 事件。已存在的事件不重复执行。
3. 每种可恢复事件必须有完整 payload 和确定的 reducer 路径。`SAFETY_INCIDENT_CREATED`、`REPORT_GENERATED` 等当前含 handler 直写投影的事件，先补齐专用恢复路径再纳入恢复集合。
4. 所有测试使用内存库或 `/tmp` 临时日志和数据库。

## 验收

1. 日志中孤儿事件可在启动时补写事件投影和业务投影，重复启动不重复写入。
2. 最后一行 JSON 损坏时，应用保留有效前缀、归档尾部并继续启动。
3. 中间行损坏、checksum 错误和未知不可恢复事件会阻断启动，且不会报告虚假的保存成功。
4. 答题、训练步骤、评分、红线和报告的恢复路径都有专项测试。
5. `snapshot_meta` 记录恢复后的最后事件，`npm run db:verify` 与恢复专项测试通过。
