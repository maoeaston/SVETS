# JOB_SKILL 298 题全量预览 Step 1 持久化可行性 R3 独立审查

## 审查结论

**PASS**

最终结论为 **PASS**：无 P0、无 P1、无 P2。目标文档准确证明了当前运行时尚未实现双发布来源、PREVIEW_ONLY 会话和匿名反馈，也准确核验了既有 M5B 幂等/恢复基础与正式 18+6 回归。

当前版本已明确把 `[!] EXISTING_STRUCTURE_INSUFFICIENT` 限定为“当前已登记的持久化、恢复与权限合同不足”，而不是预先断言必须新增 SQL 表。§6.1 逐项核对了 event-only、策略 JSON、`DurableFileCapability` 和临时载体：这些通用原语可以复用，但仍缺业务 EventType/validator/read model、唯一性与授权语义，或反馈文件格式、权限、恢复和删除合同。实施计划 Step 1 又明确要求只有隔离 fixture 证明全部 AC-19/20 才可继续，否则必须转独立 R3 Schema/数据合同决策。因此目标文档选择停止、不进入 Step 2，并由下一轮 R3 比较关系表、事件/read model、本地文件或组合方案，符合既定门槛。

本 PASS 只批准 Step 1 的停止门结论，不批准修改 Schema、权限或运行时，也不表示 event-only 或 userData 方案已经不可行。下一动作仍是 `/vibe-feature` 的独立 R3 数据合同；其方案与迁移边界必须另行审查。

上一版唯一 P2 已关闭：反馈矩阵现准确引用 `report-presentation.test.ts:52-85` 的静态白名单和姓名/内部字段排除证据，并明确 `report-presentation.ts:111-115` 的真实 ID 后四位假名不满足随机、不可推导的匿名引用要求；验证摘要也已区分 86 项主回归与 6 项 tamper recovery。

## 审查范围

- 类型：IMPL（Step 1 可行性证明/停止门工件）
- 风险：R3
- base/head：`f2a1504ee2da` / 当前 dirty working tree
- 被审查工件：`doc/features/job-skill-298-full-preview-step1-persistence-feasibility.md`
- 工件 SHA-256：`c5ee20ed6a56a50e05142d9e5f56e1a7a2e8ebe38248ad13de8fdb32d5071735`
- 权威资料：`AGENTS.md`、`doc/specs/baseline.yaml`、`doc/specs/MVP_PRD_v1.0.9-authoritative.md`、`doc/features/job-skill-298-full-preview-prd.md`、其闭合复核与实施计划、`src/main/db/schema.sql`
- 影响域：`DATABASE_MIGRATION`、`EVENT_PROJECTION`、`AUTH_PERMISSION`、`RESULT_REPORT`、`DEPLOYMENT_OPERATIONS`
- 适用不变量：`INV-EVT-003/004/005/006`、`INV-AUTH-001/002`、`INV-RES-001/002`、`INV-STR-001/002`、`INV-DATA-001/002/003`
- 独立性：独立 Reviewer 上下文重新读取目标、权威资料、完整当前 Schema 和目标引用的 auth、command、event batch、session、result/report/export 实现，不采用作者结论作为通过证据
- 未审查内容：默认业务数据库、未来真实签名包、真实学校 userData、Electron 人工流程、素材质量、Step 2-9 实现

## 已执行检查

| 检查 | 状态 | 证据 |
|---|---|---|
| 权威基线、目标 PRD/闭合复核/实施计划、完整 Schema 与关键实现读取 | PASS | 已逐段读取；目标九个源码 SHA-256 全部复算一致 |
| 运行时目标能力存在性搜索 | PASS | 指定 `rg` 无结果；当前 46 个 mutation 无 preview release/feedback 命令 |
| 显式临时 DB `db:sync` + `db:verify` | PASS | `/tmp/svets-step1-r3-review-*/review.db`；BASE=96、JOB=298、hash 一致；临时目录已清理；verifier 仍回报 0.1.17 |
| M5B command/recovery + JOB_SKILL 正式链定向回归 | PASS | 7 files / 86 tests：6+6+24+13+14+15+8 全部通过 |
| 未登记 EVENT/result recipe 重启失败关闭 | PASS | 独立复跑 `tamper-recovery.test.ts`：1 file / 6 tests 全部通过 |
| P2 修正增量复核 | PASS | 目标 hash 为 `c5ee20ed...71735`；反馈证据与 86+6 表述均已核对；`report-presentation.test.ts` 独立复跑 3/3 通过 |
| `npm run contract:m5b:event-batch:check` | PASS | 75 channels；29 READ/46 MUTATION；36 BATCH_DOMAIN/10 GATE_ONLY |
| `npm run db:m5b:isolated:verify -- --stage full` | PASS | 7 个隔离临时根全部 PASS 并清理，schema=0.1.18 |
| JOB_SKILL authority/delivery contracts | PASS | 两项检查 exit 0；runtime SQL remains blocked，delivery lock current |
| `npm run typecheck` | PASS | exit 0 |
| `npm run lint` | PASS | exit 0；0 error、663 warning |
| `npm run contract:m5b:scope:check -- --step M5B-15` | FAIL | 34 项既有 dirty baseline drift/unexpected path；与目标记录一致，不适合作为本 Step 通过门 |
| `npm run docs:index:check`（报告落档前） | FAIL | `doc/index.md is stale`；目标文档已如实标记该项 `NOT_RUN`，待汇总新增审查/验收文档后统一更新 |
| `git diff --check`（报告落档前） | PASS | exit 0，无输出 |
| 全量 `npm test` / build / Electron 人工验收 | NOT_RUN | 本轮只复算与 Step 1 直接相关的 86 项主回归、6 项 tamper recovery 和静态合同，不扩大声明 |

## P0

无。

## P1

无。

## P2

无。上一版 `[P2-01]` 已由当前目标文档第 74 行关闭：引用位置、证据能力边界和确定性后四位假名的限制均已准确表述；对应测试本轮复跑 3/3 通过。

## NOTE / 待验证

### [NOTE-01] 普通 DB verifier 的 0.1.17 口径漂移已独立复现

显式临时库完整执行当前 Schema 后，`db:verify` 仍回报 `schema=0.1.17-multi-device-m4-safety-rekey`；`scripts/config/database-content-pack.json:3-37` 的 ledger 确实止于 0.1.17，而 M5B isolated verifier 回报 0.1.18。目标文档对该项的范围和 `PASS` 限定准确。

### [NOTE-02] 文档索引尚未汇总更新

落档前 `npm run docs:index:check` 返回 stale。因为本轮还会新增独立 review/accept 工件，建议由主会话汇总后运行一次 `npm run docs:index:update` 和 `npm run docs:index:check`，避免并行改写自动区块。本项已如实记录为 FAIL/待集成，不作为目标结论缺陷。

## 已核验通过的关键项

1. 六类矩阵均有覆盖：双来源、签名责任/批准、认证与 principal、幂等恢复、匿名反馈、PREVIEW_ONLY 与正式 18+6 兼容。
2. 正式先、预览先两个方向均明确要求反向越权失败关闭；当前运行时只看 ACTIVE 的事实判断准确。
3. M5B 通用能力与具体业务未登记能力被区分，PREPARE/APPLY/重启恢复代码和 36 项定向测试均与文档描述一致。
4. 当前 JOB_SKILL 到 READY_TO_FINALIZE 会生成 JOB_SKILL_SCORE、RESULT_CALCULATED、SESSION_COMPLETED 和报告 fragment；没有 PREVIEW_ONLY 分流的判断准确。
5. 旧正式 seed 仍为 18+6、满分 48；正式 session/result/report 三组 42 项测试通过。
6. 九个源码 hash、运行时空搜索、临时 DB 数量/hash、M5B isolated verifier、scope gate 的 34 项失败、typecheck/lint 结果均可复算。
7. 目标没有把 build、全量测试、Electron 人工验收或未运行探针写成通过，也没有访问默认数据库或修改 Schema/runtime。
8. §6.1 已把 event-only 与 userData 方案保留为下一轮 R3 候选，同时证明它们不能在缺少新业务数据/权限合同时直接复用；这与实施计划“只有隔离 fixture 证明后才能继续，否则转独立 R3 决策”的门槛一致。
9. 反馈矩阵当前准确区分现有静态导出白名单、确定性假名与目标随机匿名双引用；验证表也准确区分 86 项主回归和 6 项 tamper recovery。

## 残余风险

1. 最终应采用关系表、event-only/read model、受控本地文件还是组合方案仍未决。本 PASS 只确认当前登记合同不足且必须先走独立 R3 数据合同，不批准任何具体 Schema 方案。
2. 即使 event-only 发布事实可行，跨客户端 approval ID 全局唯一、生命周期事件、未引用 strategy 防篡改、session 创建同事务视图仍可能暴露真正的 Schema 缺口；下一轮必须用明确不变量和隔离 fixture 定位。
3. userData 文件能力提供耐久原语，不自动提供角色授权、删除责任、JSON 合同或泄漏防护；这些仍需完整设计与负向测试。
4. 当前工作树包含 BASE_ABILITY Step 3 和多份 JOB_SKILL 文档改动；后续复核必须重算目标 hash，不能沿用本报告锚点判断新版本。

## 规则沉淀候选

- 在持久化可行性停止门中明确区分“业务尚未实现”“当前登记合同不足”和“物理 Schema 结构性不足”；前两者可以触发数据合同设计，只有最后一种可直接批准具体 SQL Schema 分支。
- 为 DB verifier 增加 `database-content-pack.schemaVersion == baseline/schema latest ledger` 的静态门禁。
- 明确 Mini-PRD 中“新增 EventType”与“扩张事件权限模型”的术语边界，避免把正常全链登记误判为必须新增 Schema。

## 置信度

**HIGH**。

限制：本审查完整核对了当前 Schema、关键实现和定向回归，但没有访问默认数据库或真实学校 userData，也没有替下一轮 R3 选择或验证最终载体。因此能高置信确认 Step 1 的停止门记录成立，不能据此提前确认最终是否需要 SQL Schema 迁移。
