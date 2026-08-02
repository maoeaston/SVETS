# JOB_SKILL 298 题全量预览持久化与权限数据合同 R3 独立审查

## 审查结论

**CONDITIONAL_PASS**

- P0：0
- P1：3
- P2：2
- 当前不能进入 `/vibe-impl`：按照 R3 规则，必须先关闭全部 P1。
- 未发现已确认的 P0 数据损坏、权限越权、正式结果串线或不可回滚迁移缺陷；但以下 P1 会使实现阶段仍需自行补齐关键业务合同。

## 审查范围

- 类型：PRD
- 风险：R3
- 工件：`doc/features/job-skill-298-full-preview-persistence-contract-prd.md`
- 权威资料：`AGENTS.md`、`doc/specs/baseline.yaml`、`doc/specs/project-invariants.md`、`doc/ai/vibe-workflow-contract.md`、Step 1 feasibility/review/acceptance、原 298 PRD、`src/main/db/schema.sql`
- 重点：双 official/preview 来源与 00/10/01/11 四态、两种发布顺序、批准/owner/hash/签名/SOD、principal 映射、幂等/PREPARE/APPLY/恢复、PREVIEW freeze 与结果/报告抑制、18+6 兼容、反馈隐私生命周期、migration/rollback/verifier drift、方案矩阵和机械 AC。
- 未审查内容：未访问默认数据库；未执行运行时验收、隔离 SQLite 验证、Electron/Playwright 人工走查或实现代码变更验证。

## 已执行检查

| 检查 | 状态 | 证据 |
|---|---|---|
| 必读基线与工作流规则 | PASS | 已读取 `AGENTS.md`、baseline、不变量、工作流协议、`vibe-review` skill/command |
| 目标 Mini-PRD 全文 | PASS | 已读取目标文档，覆盖 §1-§18 及行号证据 |
| Step 1 feasibility/review/acceptance | PASS | 已读取三份 Step 1 材料 |
| 原 298 PRD | PASS | 已读取原 Mini-PRD |
| Schema 相关定义 | PASS | 已读取 `question_bank`、`assessment_session`、`assessment_session_question`、`domain_event_projection`、`strategy_config`、M5B ledger 等定义 |
| 默认数据库访问 | PASS | 本轮未访问、初始化或修改默认数据库 |
| 目标文档/代码/Schema 写入 | PASS | 本轮只生成本审查文件 |
| 类型检查 | NOT_RUN | 本轮为文档独立审查，未执行 `npm run typecheck` |
| lint | NOT_RUN | 未执行 `npm run lint` |
| 相关测试/隔离数据库验收 | NOT_RUN | 文档 AC 明确要求后续实现阶段执行，本轮未冒充通过 |
| docs index update/check | NOT_RUN | 用户明确说明本轮不更新索引；不作为 blocker |

## P0

无。

## P1

### [P1-01] principal 映射缺少可执行的初始注册与轮换闭环

- 位置：目标 PRD §6.3.1-§6.4，约第 184-249 行；§16 未解决问题第 732-734 行。
- 证据：文档要求 `principal_binding` 只能来自已验签责任清单/authority registry，且执行人必须由 trusted `user_id` 查到签名映射；同时又要求责任清单包含计划执行的 mapping version/hash。文档没有定义首次 mapping 如何在没有既有 mapping 时被可信注册、由谁批准、如何防止自签、撤销后如何安全替换，也把 authority registry、trust anchor、key rotation 留为未解决问题。
- 触发条件：全新安装、首次 ADMIN 执行发布、mapping 过期/撤销或 principal 轮换。
- 影响：实现者无法完成第一条合法发布命令；若自行补默认映射会违反“不得按 username/display name 自动映射”和“请求不得自报 principal”，若允许 ADMIN 自注册则破坏 signer/executor SOD 与信任根边界。
- 权威依据：`INV-AUTH-001/002`；目标 §6.3.3、§6.4.1；工作流要求未确定的权限边界不能伪装成实现细节。
- 最小修复：在 PRD 中增加独立的 mapping enrollment/rotation 合同：可信注册入口、签发 authority、初始 bootstrap trust、组织范围、旧映射撤销与新映射生效顺序、SOD 规则、恢复和 public error；增加首次注册、重复注册、撤销后发布和 key rotation 的机械 AC。
- 回归测试：无 mapping、重复 user/principal、过期/撤销、签名篡改、ADMIN 自报 principal、首次 bootstrap 与轮换的正负 fixture；确认任何失败无业务写入。

### [P1-02] SQLite 主库与 feedback vault 的提交/恢复协议未闭合

- 位置：目标 PRD §6.7.1、§7.3、§7.4、§8.6、§10.4，约第 317-359、401-405、449-455、511-515 行；§16 未解决问题第 731 行。
- 证据：推荐方案明确“不声称跨库 ACID”，但主库保存 feedback reference/hash，vault 保存正文、draft、revision；文档只规定“reconcile 失败禁止外发并进入只读修复”，没有给出每个顺序的 canonical owner、提交状态机、重启时主库已提交/vault 未提交及反向情况的唯一判定、重试幂等键和修复权限。§16 仍将 reconcile 顺序和故障结果列为未解决问题。
- 触发条件：提交/导出在主库事务提交、vault journal COMMIT、目录 fsync 或崩溃恢复之间退出；重复提交或半完成 tombstone/purge。
- 影响：可能出现主库返回已提交但 vault 没有完整正文、vault 已提交但主库没有可查询 reference，进而违反“只显示最后完整 commit”、不得返回“已提交”以及不得半写外发的要求；不同实现可能产生不可互换的事实认定。
- 权威依据：`INV-EVT-002/004/005`、`INV-DATA-001/003`；目标 §7.3、§7.4、AC-R3-11/13。
- 最小修复：明确 vault journal 与主库 reference 的两阶段状态协议、唯一 commit ID、每个故障点的恢复裁决、幂等重放、只读修复/人工授权边界，并把协议写入 AC-R3-11/13 的 Given/Then。
- 回归测试：分别在 vault-first、DB-first、fsync 前后、重复提交、tombstone/purge 和重启点注入崩溃；断言只能得到完整提交或明确未提交/只读修复，不能产生孤立 reference、孤立正文或可导出半写 revision。

### [P1-03] PREVIEW 新状态/事件与现有 Schema aggregate 边界未收敛

- 位置：目标 PRD §1.2、§6.5.3、§6.6.2、§9、§12、AC-R3-07/08/09/15，约第 31、270-311、473-485、591-607、639-643 行；`src/main/db/schema.sql` 中 `assessment_session.status`、`strategy_type`、`domain_event_projection.aggregate_type` 定义及 M5B 末尾定义。
- 证据：现有 Schema 的 `assessment_session.status` 没有文档生命周期使用的 `OPEN`，`strategy_type` 只有三种正式类型且没有 PREVIEW 类型，`assessment_session` 没有 `delivery_mode`、题包/来源/snapshot root 字段；`domain_event_projection.aggregate_type` 也没有 preview pack、release source、feedback vault 等新聚合。目标 PRD 虽明确当前结构不足并允许后续 additive migration，但仍同时要求 `PREVIEW_SESSION_COMPLETED`、新 command/EventType/projector、四态 source read model 和 session freeze，而未明确哪些是 canonical aggregate、哪些只是 projection，以及 migration 前旧事件/旧状态如何被解析和拒绝。
- 触发条件：实现新增 preview session、发布事件或回放未知 aggregate/event；旧正式 session 与新 preview session 共存；迁移中断后启动恢复。
- 影响：实现者可能把 PREVIEW 塞进现有正式 `JOB_SKILL_ASSESSMENT` 或 `payload_json`，导致正式结果链串线；也可能新增 enum/aggregate 后破坏旧 verifier、回放和降级停止边界。
- 权威依据：`INV-EVT-001/003/005/006`、`INV-RES-001/002`、`INV-STR-001/002`；baseline 声明 `schema.sql` 是唯一 DDL 来源；目标 §6.6.2 和 §12 跨文件登记要求。
- 最小修复：在进入 `/vibe-impl` 前补一份明确的状态/aggregate 注册表合同：preview session 的物理/逻辑判别、旧 status/strategy 的兼容规则、新 EventType/aggregate 的全链登记边界、未知版本/aggregate 的 fail-closed 行为，以及 migration 前后 replay 规则；将其加入 AC-R3-08/09/15 的机械断言。
- 回归测试：旧 v1/v2 正式事件、preview 新事件、未知 delivery mode、未知 aggregate、迁移中断后恢复、正式/preview 并发与结果查询过滤；确认 preview 永不写正式 result/report，正式 18+6 不依赖 preview source。

## P2

### [P2-01] 方案矩阵的分数可复算，但评分依据仍是叙述性判断

- 位置：目标 PRD §7.1-§7.2，约第 371-393 行。
- 证据：矩阵给出 79/78/55/94 分和权重公式，但各候选每项 0-5 分没有逐项证据映射、反例 fixture 或评分门禁输入；“组合方案 94”不能单独证明跨边界恢复已满足。
- 触发条件：实现计划选择非推荐方案、或候选方案在新增约束后重新评分。
- 影响：评分容易成为设计偏好，不能作为方案淘汰或进入实施的机械依据。
- 权威依据：目标 §7.1 自身要求“可复算”；工作流要求证据优先。
- 最小修复：为每个分值增加可验证能力断言和证据来源；将“任一关键能力为 0 即淘汰”写成表驱动门禁，而不是只写在叙述中。
- 回归测试：矩阵 fixture 计算总分、关键能力为 0 的候选拒绝进入实施、候选变更后分数差异可审计。

### [P2-02] 部分性能/可访问性 AC 的环境基线尚未定义

- 位置：目标 PRD §9.1-§9.2、AC-R3-16 及原始 AC-17，约第 414-428、549-553、645-649 行。
- 证据：给出 2 秒/500ms 和桌面人工验收要求，但未定义目标设备、数据装载口径、测量次数、冷/热缓存或通过阈值；本轮也未执行 UI/性能测试。
- 影响：测试结果不可稳定复算，但不阻断本数据合同的核心安全与持久化语义。
- 权威依据：工作流 Step 3 要求验收可执行；目标 §9 和 AC-17。
- 最小修复：在实现计划/验收包中固定设备档案、数据 fixture、测量口径和失败阈值。
- 回归测试：固定 fixture 的冷启动、热启动、筛选翻页、键盘/焦点/对比度人工记录。

## 已核验通过的关键项

- 双来源没有被 `question_bank.status = ACTIVE` 推导；formal-first、preview-first 和 00/10/01/11 的方向均有场景/AC 覆盖。
- 批准、scope、期限、hash、manifest 和 signer/executor SOD 已明确列为不可变事实；请求正文不能授权。
- 幂等键、request hash、PREPARE/APPLY、重启 plannerCalls=0、故障注入和只读恢复状态均有明确要求，没有把现有 M5B 原语直接当成已完成业务合同。
- PREVIEW snapshot、独立完成事件、结果/报告抑制和正式 18+6 `/48` 回归边界已明确；红线仍沿用 `student_id + job_code + task_code` 安全范围。
- 反馈匿名引用、private userData 分区、draft/revision、tombstone、retention purge、serializer allowlist 和外发敏感数据失败关闭均已覆盖。
- 已知 `0.1.17`/`0.1.18` verifier drift 被标记 `[!]`，并规定 parity 未通过时停止迁移、发布和正式 source 回填。
- 本轮未修改目标文档、代码、Schema、baseline、handoff、index，未访问默认数据库；docs index 未更新符合本轮边界，不计为 blocker。

## 残余风险

- 发布主库、M5B 事件链、session freeze 和独立 vault 形成多个跨文件/跨持久化边界；P1 关闭前实现计划不能自行选择缺失的 canonical owner 或 bootstrap 规则。
- 本报告没有执行隔离数据库、故障注入、签名验证、ACL、性能或 Electron 人工验收；这些只能在后续实现/验收阶段确认。
- 现有工作树存在用户既有 dirty changes；本轮未清理、未回滚、未把它们作为本目标实现证据。

## 规则沉淀候选

- 增加 principal enrollment/rotation contract checker，禁止没有可信初始注册事实的发布命令。
- 增加 SQLite-reference 与 userData-vault reconcile fault matrix，机械区分 `COMMITTED`、`UNCOMMITTED` 和 `READ_ONLY_REPAIR`。
- 增加 preview aggregate/event/status registry 的 cross-file inventory，未知版本或聚合必须 fail closed。
- 将方案矩阵评分改为带 fixture/能力断言的自动化门禁。

## 置信度

**HIGH**。目标 Mini-PRD、指定权威基线、Step 1 材料、原 298 PRD 和 `schema.sql` 相关定义均已读取；限制是本轮未运行代码、数据库、迁移、故障注入和 UI 验收，因此结论只针对数据合同是否足以进入 `/vibe-impl`，不代表运行时行为已实现或通过。
