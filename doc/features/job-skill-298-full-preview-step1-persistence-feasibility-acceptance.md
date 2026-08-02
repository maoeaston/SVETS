# JOB_SKILL 298 题全量预览 Step 1 持久化可行性验收记录

## 验收报告

### 结论

`PASS`

本结论表示 Step 1 已按计划完成取证、二元判定和停止门执行。它不表示现有运行时已实现 JOB_SKILL 全量预览，也不批准进入 Step 2、修改 Schema、扩张权限或发布题目。

实现继续状态为 `BLOCKED`：当前已登记的持久化、权限与恢复合同不足，下一唯一动作是 `/vibe-feature`，定义并独立 R3 审查 Schema/数据合同。该决策可以比较关系表、事件/read model、受控 userData 文件或组合方案；本验收没有预先批准其中任何一种。

### 范围

- 模式：`/vibe-accept step 1`
- 风险：`R3`
- 验收日期：2026-08-01
- base/工作区：`f2a1504ee2da` / `feat/multi-device-m2-prd` dirty working tree
- PRD / 实施计划：`doc/features/job-skill-298-full-preview-prd.md`、`doc/features/job-skill-298-full-preview-impl.md`
- Step 1 证据：`doc/features/job-skill-298-full-preview-step1-persistence-feasibility.md`
- 独立审查：`doc/features/job-skill-298-full-preview-step1-persistence-feasibility-r3-review.md`
- 证据冻结：可行性证明保持独立审查实际核验的 hash `c5ee20ed6a56a50e05142d9e5f56e1a7a2e8ebe38248ad13de8fdb32d5071735`；其 §9.2 保留审查前 `NOT_RUN` 快照，最终 review/accept 和集成检查状态以独立审查报告及本记录为准。
- 适用不变量：`INV-EVT-003/004/005/006`、`INV-AUTH-001/002`、`INV-RES-001/002`、`INV-STR-001/002`、`INV-DATA-001/002/003`
- 边界：未读取、初始化或修改默认数据库；未修改 Schema/migration、运行时代码、题目/素材/策略/发布状态；未进入 Step 2-9。

### 工作区

| 项目 | 状态 | 证据 |
|---|---|---|
| 分支与基点 | `PASS` | 分支 `feat/multi-device-m2-prd`，HEAD `f2a1504ee2da`。 |
| dirty 现场保留 | `PASS` | 既有 BASE_ABILITY Step 3、JOB_SKILL PRD/计划和其他用户改动均原样保留；未 reset、restore、stash、commit、push、merge、rebase 或清理。 |
| Step 1 变更范围 | `PASS` | 仅新增可行性、独立审查、验收文档并更新交接/自动索引；九个关键 runtime/Schema 文件 hash 与取证锚点一致。 |
| 默认数据库与生产状态 | `PASS` | 所有数据库命令均使用显式 `/tmp` 隔离路径；默认库、题目、素材、策略和发布状态无本轮写入。 |
| 未解决冲突/格式 | `PASS` | `git diff --check` exit 0；Step 1 文档、交接和索引无尾随空白或冲突标记。 |

### 自动化检查

| 检查 | 命令 | 状态 | 证据 |
|---|---|---|---|
| 显式临时 DB 同步/校验 | `npm run db:sync -- --db /tmp/svets-preview-step1-*/step1.db`；`npm run db:verify -- --db ...` | `PASS` | BASE=96、JOB=298、approved assets=0，pack/hash 匹配；临时库已清理。普通 verifier 仍回报 0.1.17，见可行性证明 §3.1。 |
| M5B 幂等、PREPARE/APPLY 恢复与正式 18+6 回归 | 定向 `vitest run` | `PASS` | 7 files / 86 tests 全部通过。 |
| 未登记 EVENT/result recipe 恢复失败关闭 | `vitest run .../tamper-recovery.test.ts` | `PASS` | 1 file / 6 tests 全部通过。 |
| M5B source inventory | `npm run contract:m5b:event-batch:check` | `PASS` | 75 channels，29 READ/46 MUTATION，36 BATCH_DOMAIN/10 GATE_ONLY，pending=0。 |
| M5B v0.1.18 全量隔离校验 | `npm run db:m5b:isolated:verify -- --stage full` | `PASS` | artifact/command/coordinator/gate-only/safety/schema/storage 全部通过；7 个临时根清理。 |
| JOB_SKILL 当前 authority/delivery 合同 | `npm run contract:job-skill:check`；`npm run contract:job-skill:delivery:check` | `PASS` | runtime SQL remains blocked；delivery lock current。 |
| TypeScript | `npm run typecheck` | `PASS` | exit 0。 |
| lint | `npm run lint` | `PASS` | exit 0；0 error、663 条既有 warning。 |
| 文档索引 | `npm run docs:index:update`；`npm run docs:index:check` | `PASS` | 自动清单已纳入三份 Step 1 文档；`doc/index.md is current`。 |
| 差异检查 | `git diff --check`；未跟踪文档尾随空白/冲突标记扫描 | `PASS` | tracked diff exit 0；`rg` 对三份新文档、两份交接和索引无命中；九个关键源码 hash 与取证锚点一致。 |
| M5B-15 历史 scope 冻结门 | `npm run contract:m5b:scope:check -- --step M5B-15` | `FAIL` | 该历史 gate 将当前既有 dirty 现场判为 34 项 baseline drift/unexpected path；不是 Step 1 精确门禁，未清理用户改动，也未将失败写成通过。 |
| build / 全量 `npm test` / Electron 人工流程 | 对应命令或手工 | `NOT_RUN` | Step 1 不改可构建产物或 UI；使用 92 项直接相关回归，未把未执行项写成通过。 |

### 不变量核验

| ID | 状态 | 证据 |
|---|---|---|
| `INV-EVT-003` | `PASS` | production prepared registry 是封闭、逐版本校验并 seal 的；未知 EVENT/result recipe 恢复 6/6 失败关闭。该事实也是转独立 R3 数据合同而不直接塞 JSON 的依据。 |
| `INV-EVT-004` | `PASS` | command ledger 与 6 项定向测试证明同 key 同请求稳定重放、异请求/actor/device/auth 漂移冲突。 |
| `INV-EVT-005/006` | `PASS` | PREPARE 后只读冻结 EVENT；startup/fault matrix 与 M5B full isolated 验证通过。 |
| `INV-AUTH-001/002` | `PASS` | 现有 Electron sender-bound ACTIVE user 可复用；principal 唯一映射、CLI 上下文和职责分离缺口已明确阻断后续实施，没有降级为请求自报身份。 |
| `INV-RES-001/002` | `PASS` | 可行性矩阵证明当前 PREVIEW_ONLY 无冻结分流且会污染正式 result/report，因此保持停止；旧正式 18+6 定向回归通过。 |
| `INV-STR-001/002` | `PASS` | 没有把未引用策略 JSON 冒充不可变发布批准；正式 strategy 兼容事实与冻结边界已核验。 |
| `INV-DATA-001/002/003` | `PASS` | 没有把通用 JSON/file capability 冒充完整数据合同；版本、hash、匿名映射、修订与导出边界缺口均逐项登记。 |

### 跨文件登记检查

- [PASS] 可行性证明覆盖双来源、批准/责任、principal/职责分离、幂等恢复、匿名反馈、PREVIEW_ONLY 结果隔离和旧正式兼容六类事实。
- [PASS] event-only、策略 JSON、`DurableFileCapability` 与临时载体四种候选已区分“可复用原语”和“尚缺业务持久化/权限合同”。
- [PASS] 独立 R3 `/vibe-review` 对最终证据版本为 `PASS`，P0/P1/P2 均为零；具体 hash 记录在独立审查报告中。
- [PASS] `.continue-here.md` 与 `doc/会话启动.md` HANDOFF 将下一动作固定为独立 R3 `/vibe-feature`，没有进入 Step 2。
- [PASS] 新增文档自动索引、最终差异检查、typecheck 和 lint 已在本记录落档后复跑。

### 人工验收

| 场景 | 状态 | 环境与证据 |
|---|---|---|
| Electron / 教师与学生预览流程 | `NOT_RUN` | Step 1 不实现运行时或 UI，不能冒充人工产品验收。 |
| 真实签名批准、CLI 交互认证与学校 userData | `NOT_RUN` | 权威合同尚未定义；它们是下一 R3 数据合同的输入，不是本 Step 可伪造的通过项。 |
| 默认数据库或真实发布 | `NOT_RUN` | 明确禁止访问或修改。 |

### 未通过项

Step 1 精确必需检查无失败项。历史 M5B-15 scope gate 的 `FAIL` 已单独保留，因为它针对 M5B 冻结范围且与当前既有 dirty 现场不兼容，不是本 Step 的精确验收门。

### 未执行 / 阻塞项

- build、全量测试和 Electron 人工验收为 `NOT_RUN`，与纯文档/取证 Step 1 的风险范围相符。
- Step 2-9 为 `BLOCKED`；原因是双来源、批准/责任、principal、session 冻结和反馈映射尚无经批准的数据合同。

### 计划外变更

未发现由 Step 1 引入的运行时、Schema、migration、依赖、锁文件、题目、素材或发布状态变化。工作树中的其他 dirty 文件为执行前既有现场，未擅自清理或归并。

### 规则沉淀候选

- 为普通 DB verifier 增加 `database-content-pack.schemaVersion` 与 baseline/latest migration ledger 一致性门禁。
- 在可行性停止门中显式区分“通用持久化原语可复用”和“业务持久化/权限合同已存在”，避免把任意 JSON 或文件能力误报为需求已满足。

### 下一步

执行 `/vibe-feature`，定义独立 R3 Schema/数据合同 Mini-PRD；通过 `/vibe-impl`、独立 `/vibe-review` 和批准后，才能决定是否恢复原计划 Step 2。不得在当前计划中直接修改 Schema、注册发布权限或实现 Step 2。
