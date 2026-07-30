# M5B Event Batch Runtime — 独立 R3 PRD 审查

## 1. 审查对象

- Reviewer：Codex，切换到独立 R3 Reviewer 视角。
- Review target：`doc/features/event-batch-v2.2-runtime-prd.md`。
- Review date：2026-07-29。
- Review type：`PRD`。
- 风险等级：R3。
- 输入基线：Schema `0.1.17-multi-device-m4-safety-rekey`、M4 `ACCEPTED_STEP_2A`、M5A `ACCEPTED_STEP_2B`。
- 独立性声明：不把 PRD 的自述状态、M5A 的验收结论或起草过程当作 M5B 正确性证据；从权威架构、当前代码、静态 inventory 与实际命令输出重新核对。
- 数据边界：未定位、打开、读取、hash、初始化或修改默认运行数据库；本轮是文档审查，没有运行数据库迁移或 Electron 应用。

## 2. 最终结论

结论：`PASS`

- 未关闭 P0：0。
- 未关闭 P1：0。
- 未关闭 P2：0。
- `/vibe-impl` 资格：`GRANTED`。

Round 1 共发现 5 项 P1 与 3 项 P2；进入实现上下文后的 pre-impl 复核再发现 1 项 P1。目标 PRD 已逐项修订；复核后没有剩余会使实现产生替代 batch、重跑 PONR 后 handler、破坏 legacy bytes、覆盖导出文件、绕过认证或让 corruption 诊断不可达的阻断问题。

## 3. 审查证据

### 3.1 权威与工作流

实际核对：

- `AGENTS.md`；
- `doc/specs/baseline.yaml`；
- `doc/specs/project-invariants.md`；
- `doc/ai/vibe-workflow-contract.md`；
- `vibe-coding-skills-v2/commands/vibe-review.md`；
- `doc/specs/MVP_PRD_v1.0.9-authoritative.md`；
- `doc/specs/architecture-plan-b-multi-device-v2.2-authoritative-baseline.md` §7.2 T11–T14、§10–§12、§18.3、§22.4、§23.5–23.6；
- `doc/features/multi-device-m4-m5-prd.md` §4；
- `doc/features/full-product-1.0-planning-review-2026-07-18.md` B9–B11。

### 3.2 当前代码与合同

实际核对：

- Command Bus / envelope / registry：`command-bus.ts`、`command-envelope.ts`、`command-types.ts`、`m5a-command-definitions.ts`、`handler-registry.ts`；
- 写入与恢复：`event-writer.ts`、`recovery.ts`、`legacy-upgrade-recovery.ts`、`connection.ts`、`application-runtime.ts`；
- report artifact：`reports-service.ts`、`reports.ts`、`report-export.ts`、`report-command-coordinator.ts`；
- safety：`assessment-service.ts`、`event-payloads.ts` 与当前 M4 Schema trigger 合同；
- runtime health 可复用面：`foundation.ts` shared/handler、`SystemReadinessView.vue`。

### 3.3 实际命令

| 检查 | 状态 | 结果 |
|---|---|---|
| `npm run contract:m5a:command-boundary:check` | PASS | 74 channels（28 READ / 46 MUTATION）、28 direct files、13 roots、pending=0、registered exceptions=76；digest `f97ef382ab9a9678ab20f06310e6906e811cdd765526d69a4fcc11bca6939527`。 |
| mutation definition 独立抽取 | PASS | 46 条：assessment 15、assignment 5、auth 4、reports 6、safety 4、strategy 3、student 3、training 6；由此精确得到 36 batch-domain + 10 gate-only。 |
| `npm run docs:index:check` | PASS | 修改现有 PRD 后索引仍 current。新增本审查文档后须更新索引。 |
| `git diff --check -- doc/features/event-batch-v2.2-runtime-prd.md` | PASS | 无 whitespace error。 |
| typecheck / lint / unit / build / native / Electron | NOT_RUN | 本轮只审查 PRD，不把未实现功能的工程检查写成通过；它们是后续 impl/accept 的 required gates。 |

## 4. Round 1 Findings 与关闭证据

### M5B-PRD-P1-01：report export 的旧 staging 顺序无法在 PONR 后确定恢复

- 初始问题：草案先在 PREPARE 前写同目录 stage，路径只存在于内存；若进程退出且 renderer 以新 key 重启，startupRecovery 不知道任意外部目录中的 stage。反过来若 PREPARE 后才尝试 hard-link，而目标文件系统不支持 hard-link，会把一个本可在 PONR 前拒绝的选择变成全局恢复阻塞。
- 影响：可能遗留不可证明归属的文件，或在完整 PREPARE 后永久无法发布 artifact；不能同时满足 PONR、no-clobber 与“不可删除外来文件”。
- 修订：dialog 在 durable claim 后执行；选定目录先用 command-owned hidden probe 验证 exclusive create、hard-link no-clobber、identity 与 durability，能力不足在 PONR 前失败。planner 只在内存冻结 bytes/hash；PONR 后 stage/publish，缺失时通过 EVENT 的 versioned `artifact_from_event` 重建并复算 hash。
- 关闭证据：PRD §5 S8、§7.2、§7.7、EBR-10 已形成完整 interaction/probe/stage/publish/recovery matrix。
- 状态：`CLOSED`。

### M5B-PRD-P1-02：OS save dialog 与 durable retry / writer mutex 的顺序未闭合

- 初始问题：若把 dialog 放进 planner并持有 writer mutex，用户长时间不选择路径会阻塞全部写入；若 startup 自动重跑 planner，则会在无用户上下文时弹 dialog。
- 影响：全局写队列饥饿或 recovery 产生非预期 UI 交互。
- 修订：dialog 是唯一 `INTERACTION_PREFLIGHT`，发生在 durable claim 后、writer mutex 前，等待时续租；取消 result 持久化。PREPARE 前崩溃按 §11.7 回到 PENDING，但 startup/background 不显示 dialog，只有原 metadata 的显式 transport replay 才重新交互。
- 关闭证据：PRD §7.1 的锁顺序、§7.2 的 retry 边界、§7.7 与 EBR-10。
- 状态：`CLOSED`。

### M5B-PRD-P1-03：migration 状态机与正文顺序矛盾

- 初始问题：状态图写 `MIGRATING -> LEGACY_RECONCILING`，旧正文却把 T11–T14 DDL 放在 legacy reconcile 之后。
- 影响：实现可按两个互斥顺序落地，导致 backup、ledger、legacy truncate 与 Schema transaction 的错误归属。
- 修订：历史库固定为只读 schema/legacy preflight → paired backup → T11–T14 migration/结构断言 → 证明后的尾部处理 → legacy reconcile/seal → batch recovery；migration transaction 不含文件操作。
- 关闭证据：PRD §3.2 与 §9.3 一致。
- 状态：`CLOSED`。

### M5B-PRD-P1-04：APPLIED + 已存在 COMMITTED 的恢复可能重复追加确认记录

- 初始问题：旧 Phase 2 只写“补 COMMITTED”，未区分 JSONL 已 fsync COMMITTED 但 SQLite 尚未改 CONFIRMED 的窗口。
- 影响：恢复可能追加第二条 `BATCH_COMMITTED`，破坏三 record 协议和 parser 唯一性。
- 修订：无 COMMITTED 才追加；恰好一条完全匹配时只补 SQLite/index；重复或冲突 COMMITTED 进入 corruption。
- 关闭证据：PRD §7.5 Phase 2 与 EBR-04。
- 状态：`CLOSED`。

### M5B-PRD-P1-05：prepared event 不足以保证 projector/result 在恢复时确定

- 初始问题：草案要求 side-effect-free planner，却没有要求现有 event payload 固定 projector、operational effect 与 command result 所需的全部状态。进程崩溃后 planner 内存消失，projector 可能重新读取已变化领域状态。
- 影响：同一 batch 在正常 APPLY 与 recovery APPLY 得到不同投影/结果，或被迫违反 PONR 重跑 handler。
- 修订：每个新 EVENT payload 必须冻结业务 ID、时间、前后状态、lineage、版本/hash；允许在既有 EventType 下版本化 payload。operational effect 只能从 command row/actor/type/prepared events 确定重建，否则进入 EVENT 或 gate-only transaction。
- 关闭证据：PRD §7.2、§7.8、EBR-02/04/09。
- 状态：`CLOSED`。

### M5B-PRD-P2-01：corruption 后 ADMIN 诊断可能不可达

- 初始问题：只允许已绑定 ADMIN 读取诊断，但冷启动 corruption 会阻断 login mutation，当前进程可能没有可用 auth binding。
- 修订：`runtime:getHealth` 的最小脱敏诊断无会话可达，内存态不依赖 SQLite；ADMIN 只增加非敏感结构统计。业务 READ 在数据库不可查询时可返回稳定错误。
- 关闭证据：PRD §4、S6、§8、EBR-05/13。
- 状态：`CLOSED`。

### M5B-PRD-P2-02：request hash 可能形成低成本密码摘要或随 key 漂移

- 初始问题：直接对含 password 的 canonical request 做 SHA-256 会形成低成本离线猜测目标；改用 idempotency key 作 salt 又会让相同业务输入跨 key 的 request hash 不稳定。
- 修订：secret 字段由 registry 标记，使用稳定 domain salt 和 PBKDF2-SHA512（100,000 iterations、64 bytes）替换后再进入 canonical SHA-256；transport metadata 仍不进入 normalized business input。
- 关闭证据：PRD §7.1.5 与 EBR-03 privacy tests。
- 状态：`CLOSED`。

### M5B-PRD-P2-03：accepted envelope 与 channel 计数边界不完整

- 初始问题：草案未明确当前临时 UUID 必须替换为持久 command ID，也未说明 runtime health push 是否计入 75 个 invoke channel。
- 修订：CommandEnvelope v2 明确携带 persisted command ID、client/key、actor/device/auth 与 generation；root correlation 使用 command ID。75 只计算 invoke channel，push event 不计入 registry 数。
- 关闭证据：PRD §7.1.7、§8 与 EBR-01/13。
- 状态：`CLOSED`。

### M5B-PRD-P1-06：login/logout 的 completed replay 与 sender binding 不可同时满足

- 初始问题：通用规则要求 existing-key lookup 前重新验证 ACTIVE actor，但 `auth:logout` 成功后正是由该命令撤销自己的 session，因此精确同 key 重放必然在 lookup 前失败。`auth:login` 的旧实现又以只存在内存的 raw token 绑定 sender，completed result 只有 auth session ID，无法在安全重放时恢复 binding。
- 影响：durable idempotency 对两个认证命令名义成立、实际不可重放；若为解决问题持久化明文 token，则引入更高的凭据泄漏风险。
- 修订：logout 是唯一 post-effect actor invalidation 例外，只允许同一可信 client/key 且 row actor/session 完全匹配时返回非敏感旧成功结果；不能借此执行或读取其他内容。login replay 重新核验 account/session，有效时按持久 auth session ID 绑定 sender，不保存/恢复明文 raw token；禁用或撤销后不返回旧成功。
- 关闭证据：PRD §7.1.6、§7.2 与 EBR-03 明确独立 auth-binding 负向测试。
- 状态：`CLOSED`。

## 5. 权威合同复核

| 审查面 | 结论 | 说明 |
|---|---|---|
| 三 record / hash | PASS | canonical JSON、UTF-8、每 EVENT 尾 LF、`events_hash`、`batch_hash`、`GENESIS` 与 segment 跨链均被冻结。 |
| 七步 command / lease | PASS | client+key unique、atomic lease takeover、30s/10s、generation snapshot、PONR 与 fenced result 均有合同和验收矩阵。 |
| 四阶段 recovery | PASS | incomplete tail、APPLIED/COMMITTED、PREPARED replay、cursor/result/index 均区分，且禁止 PONR 后 planner rerun。 |
| Schema 范围 | PASS | 只采用 T11–T14；T18、backup product 和其他 1.0 表不被静默吸收。 |
| legacy 兼容 | PASS | 合法 LF/EOF byte-exact；只截断可证明不完整尾部；v1/F7 两事件 safety history 保留。 |
| M4 safety | PASS | 新 redline batch 只有 `SAFETY_INCIDENT_CREATED`；M4 三元 trigger/projector 在一个 APPLY 中完成，不生成未 prepared 事件。 |
| M5A boundary | PASS | 74-channel 输入与实际 scanner一致；目标新增 1 READ，46 mutation 精确分 36/10，76 exceptions 要逐项重裁决。 |
| M5C 边界 | PASS | 只保证 current-process mutex/logical worker fencing；明确不宣称跨进程 writer ownership / owner epoch。 |
| 默认数据保护 | PASS | 验收改为 open-before path/alias guard；不再要求读取默认库做前后 hash。 |

## 6. 残余风险与实施要求

1. 36 个领域 service 当前大量交错 `writeEvent + DML + reducer + accepted child`；实现计划必须按命令族拆 planner/projector，不能以一个低层 writer 替换完成迁移。
2. report target 目录的 pre-PONR probe 在异常退出时可能留下 command-owned hidden file；PRD 正确禁止无证明通配清理。实现需提供可观察命名与定向故障测试，但这不授权扫描或删除任意用户目录文件。
3. M5B 不解决第二个 OS 进程同时打开 data root；M5C 之前只能在当前 process/runtime 范围声明 PASS。
4. 本审查没有执行未实现代码的 typecheck、lint、unit、build、native 或 Electron 流程；后续任何 accept 必须实际运行，不能引用本报告外推。
5. 本审查不授权默认库迁移、自动 corruption 修复、commit 或 push。

## 7. Reviewer 结语

重基线 PRD 已把 M5A 的最终 writer 边界转化为可实施、可故障注入、可回滚的 M5B 合同。Round 1 的 P0/P1/P2 均无未关闭项，可以进入 `/vibe-impl`；后续实现计划必须逐命令冻结 planner/projector/result 与 migration side effect，不能把本次 PRD PASS 当作代码验收。
