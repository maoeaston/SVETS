# M5A Command Bus Boundary 实施计划独立审查

## 审查对象

- 实施计划：`doc/features/m5a-command-bus-boundary-impl.md`
- 对应 PRD：`doc/features/m5a-command-bus-boundary-prd.md`
- 风险等级：R3
- 规划基点：`40541c82ef374f28ce300365e0e5cc82423dd99a`
- PRD SHA-256：`0830a38a258a025e98e95ef65fec31a01a05b613eb0dec9b2077be6c37032add`
- 审查方式：与计划编写上下文分离的独立只读审查；Reviewer 不修改目标计划或生产代码。

## Round 1 — 2026-07-29

结论：`CONDITIONAL_PASS`

- P0：0
- P1：5
- P2：1
- 编码资格：`BLOCKED`，关闭 P1 并完成定向独立复核前不得进入实现。

### P1-01：coordinator 合同变更与消费者迁移错步

Step M5A-3 要求移除 `ReportCommandCoordinator` 的默认 writer/recovery 构造并完成 data-root 单例，但 reports、safety、job-skill automation 的生产构造迁移原安排在 Step M5A-8～10。按原计划执行会出现中间状态不可构建，或继续保留 root 外构造而使 Step 3 的完成声明失真。

修订要求：在 Step M5A-3 原子完成所有生产消费者注入与 root 外 constructor 清零；测试四类 consumer identity 以及 sync/async 同 key 不重叠。

### P1-02：legacy→active inventory 缺少逐步可执行合同

原计划只有 legacy fixture 的明确路径，Step M5A-4 移动 74 个 registration 后却仍运行 baseline scan；未定义 active manifest、legacy→active mapping、逐步骤 expected-pending 或 migration gate。

修订要求：固定 `baseline`、`migration`、`target` 三种语义；新增 active/mapping/pending fixtures；Step M5A-3～10 每步更新映射并运行当前 checkout migration gate，最终才要求 pending 为零。

### P1-03：最终差异门禁漏掉早期 commit 和 index

原计划使用无基点的 `git diff`/`git diff --check`，不能证明早期分步 commit、index 和未跟踪受限路径没有越界修改 Schema、migration、event/shared/preload/renderer 合同。

修订要求：所有最终差异检查相对固定规划基点，并以自动 helper 覆盖 committed/index/worktree/untracked 四层；输出全里程碑 name-status 和 status 供审查。

### P1-04：隔离 `db:verify` 不可直接执行

原计划只有 `/tmp/<m5a-isolated-run>/...` 占位符，没有初始化隔离 content-pack DB 的可执行命令；直接省略 `--db` 会回落默认路径。

修订要求：新增 fail-closed isolated DB helper，由其自行创建临时根，并以同一显式绝对路径执行 sync 与 verify；禁止解析默认 DB path，失败保留证据根。

### P1-05：并发拒绝未冻结到既有 IPC 响应

内部 `CONCURRENCY_UNSAFE` 不存在于当前 shared public error union。原计划未逐 mutation 规定映射，可能泄漏新码、产生 rejected Promise 或破坏 renderer 兼容。

修订要求：46 个 mutation row 都必须包含 `preflight_error_map`，覆盖 active-key conflict 等 preflight 原因，并只映射到当前 public response union 已有错误码；生成逐响应族契约测试。

### P2-01：auth sweep 的 sender binding 生命周期未固定

原计划没有裁决 sweep、renderer destroyed、runtime dispose 对失效 binding 的 owner、顺序与 DB 失败语义。

修订要求：拒绝请求不删除 binding；SYSTEM sweep 先成功持久化再清理，DB 失败保留；renderer destroyed 和 runtime dispose 分别清理其拥有的内存 binding，并用 fake timer/失败注入验证。

## Round 1 已核验通过项

- 当前 74 个 IPC channel 与计划的 `28 READ / 46 MUTATION` exact-set 一致。
- 当前 35 个 direct-side-effect 文件与 5 个 delegating roots 的文件级集合一致。
- target resolver、无写 preflight、trusted actor、真实 JSONL 第 N 次故障、M4 三元安全边界和 M5B 排除项方向符合 PRD。
- 审查未运行尚不存在的目标实现测试、build、Electron smoke 或 target gate；这些状态均为 `NOT_RUN`。
- 审查未读取或修改默认数据库。

## Round 2

审查日期：2026-07-29

审查计划 SHA-256：`c2f51c0031475af38c22240fc2a8b901495a20faf001dc347488b41811d0b878`

结论：`PASS`

- P0：0
- P1：0
- P2：0
- 编码资格：`GRANTED`

### 定向关闭结论

| Round 1 finding | 状态 | 关闭证据 |
|---|---|---|
| P1-01 coordinator 原子迁移 | `CLOSED` | Step M5A-3 同一步迁移 reports、safety、job-skill、task closure，要求 composition root 外生产构造为零，并验证四类 consumer identity、constructor/import gate 与 sync/async 同键互斥。 |
| P1-02 inventory/scanner 迁移合同 | `CLOSED` | 已定义 legacy、active、mapping、pending 四类 fixture和 baseline/migration/target 三种互斥模式；Step M5A-3～10 每步更新映射并执行 migration gate。 |
| P1-03 最终 diff 覆盖 | `CLOSED` | scope helper 固定规划基点，覆盖 committed、index、working tree 和受限路径 untracked；最终证据不再只依赖无参数 `git diff`。 |
| P1-04 隔离 DB 验证 | `CLOSED` | isolated-db helper 自行 `mkdtemp`，以同一绝对路径调用 `syncDatabase()` 与 `verifyDatabase()`，禁止默认路径解析并覆盖失败路径。 |
| P1-05 并发 public error mapping | `CLOSED` | `CONCURRENCY_UNSAFE` 仅为 Main 内部原因；46 个 mutation 必须逐行映射到当前 public response union，禁止新增 error code 或 rejected Promise。 |
| P2-01 auth binding 生命周期 | `CLOSED` | preflight 不删 binding；SYSTEM sweep 先成功持久化再清理，失败保留，并覆盖 renderer destroyed、runtime dispose 和 timer 清理。 |

定向复核未发现修订引入新的 P0/P1。此结论只授予实施计划编码资格；尚不存在的 M5A 实现测试、build、Electron smoke 和 target gate 仍为 `NOT_RUN`。
