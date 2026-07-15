# 本地多开发机数据库同步 SOP

> **适用范围：** A/B/C 三台 Windows + WSL 开发机轮流开发，不并发写入；当前开发阶段无须保留业务数据。
> **内容包版本：** `scripts/config/database-content-pack.json`
> **Schema 基线：** `v0.1.15-multi-device-m3-grant-assignment`

## 1. 同步模型

Git 只同步可审查、可重放的数据库合同，不同步 SQLite 运行文件：

| 数据类别 | 权威来源 | 同步方式 |
|---|---|---|
| Schema / 触发器 /策略 seed | `src/main/db/schema.sql` | `db:sync` 加载完整基线 |
| 数据库迁移 | `src/main/db/migrations.ts` | Electron 启动前按真实结构执行 |
| 开发账号 | `src/shared/config/dev-accounts.json` | `db:sync` 统一账号、密码、角色 |
| BASE_ABILITY 96 题 | `doc/features/question-bank-import-base-ability-v02.sql` | `db:sync` 重放 |
| JOB_SPECIFIC 298 题 | `doc/features/question-bank-import.sql` | `db:sync` 重放 |
| 已批准视觉资产 | `doc/assets/asset-manifest.json` + 运行时文件 | `db:sync` 投影到 `asset_resource` |
| 测评、训练、评分等业务数据 | 当前阶段不跨机同步 | 换机前确认无需保留，必要时先留备份 |
| 设备身份、运行会话、认证会话 | 每台设备独立 | 不跨机复制 |

禁止通过 Git、OneDrive、Syncthing 等工具同步正在使用的 `.db`、`.db-wal`、`.db-shm`。这些文件不是可合并数据，复制时还可能得到不一致快照。

## 2. 首次初始化一台机器

先关闭 Electron，再在仓库根目录执行：

```bash
git pull
npm install
npm run db:sync -- --reset
npm run db:verify
npm run dev
```

WSL 默认数据库路径：

```text
~/.config/xc-career-guide/data/xc-career-guide.db
```

`--reset` 的行为：

1. 用 `VACUUM INTO` 生成一致性 SQLite 快照。
2. 把现有 `action_log.jsonl` 一并复制到同一备份代次。
3. 删除当前 DB / WAL / SHM 和当前 action log。
4. 从 Git 中的合同重建并执行完整验证。

备份目录位于：

```text
~/.config/xc-career-guide/data/backups/pre-reset.<timestamp>/
```

## 3. 日常换机流程

每次在另一台机器继续开发：

```bash
git pull
npm run db:sync
npm run db:verify
npm run dev
```

`db:sync` 会重新写入共享开发账号和 394 条题库合同，重复运行结果一致。它比较的是业务字段语义，不比较随机密码盐、时间戳或 SQLite 文件字节。

如果内容包发生结构性变化，命令会明确要求 `--reset`，不得静默删除业务数据。

## 4. 验证门禁

`npm run db:verify` 检查：

- `PRAGMA integrity_check = ok`、`foreign_key_check = 0`
- 当前 M1/M2/M3 表、`student_profile.user_id`、业务父子会话约束、Grant/Assignment 约束与迁移记录存在
- 三个开发账号的角色、状态和密码符合共享合同
- BASE_ABILITY = 96、JOB_SPECIFIC = 298
- 题库业务字段的 SHA-256 语义哈希与临时参考库一致
- `ACTIVE` 视觉资产投影与当前 Manifest 中的 approved 集合一致

验证失败时不要直接修改本地表来“修数字”。先判断 Git 中的内容合同是否需要更新；若合同无误且本地无需保留数据，关闭 Electron 后用 `npm run db:sync -- --reset` 重建。

## 5. 启动迁移策略

- 新库：事务内加载完整 `schema.sql`，全部成功后才登记当前 baseline。
- v0.1.12/v0.1.13/v0.1.14 库：启动前创建 DB + JSONL 备份，随后按顺序执行 M1、M2 与 M3 结构迁移；迁移记录只在结构验证通过后写入。
- 早于 v0.1.12 或结构不完整的开发库：拒绝猜测式迁移，提示显式 `--reset`。
- 即使旧库错误地提前写入了 v0.1.13/v0.1.14 迁移记录，runner 仍按表、列、索引和触发器的真实结构判断并修复。

## 6. 边界

本 SOP 只适合三台机器**轮流**开发。若未来需要两台机器同时录入测评/训练/评分数据，必须切换到单一权威 Application Server，由服务器单写 SQLite；不能继续用快照或 Git 合并业务数据。

当前 `action_log.jsonl` 尚未实现启动回放，因此只复制 JSONL 不能恢复 SQLite 业务投影。正式业务数据备份/恢复仍按 `architecture-plan-b-multi-device-v2.2-authoritative-baseline.md` 的代次快照方案推进。
