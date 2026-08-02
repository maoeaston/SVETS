# R3 独立审查报告（第二轮）

## 审查结论

`BLOCKED`

P0：1；P1：2；P2：1。

本轮结论依据：存在 P0，且 P1 未清零。目标 Mini-PRD 不得进入 `/vibe-impl`，也不得据此实施 Schema、migration、EventType、权限或 feedback vault。

## 审查范围

- 类型：PRD / 数据合同 Mini-PRD
- 风险：R3（权限、持久化、事件回放、migration、隐私删除）
- 工件：`doc/features/job-skill-298-full-preview-persistence-contract-prd.md`
- 权威资料：`AGENTS.md`、`doc/specs/baseline.yaml`、`doc/specs/project-invariants.md`、`doc/ai/vibe-workflow-contract.md`、`vibe-coding-skills-v2/commands/vibe-review.md`、Step 1 feasibility/review/acceptance、原 JOB_SKILL PRD、`src/main/db/schema.sql`
- 适用不变量：`INV-EVT-001`～`006`、`INV-AUTH-001`、`INV-AUTH-002`、`INV-RES-001`～`002`、`INV-STR-001`～`002`、`INV-DATA-001`～`003`、`INV-IPC-001`～`002`
- 未审查内容：未访问默认数据库；未修改目标 Mini-PRD、代码、Schema、migration、baseline、handoff 或 `doc/index.md`；未执行运行时实现验收。

## 已执行检查

| 检查 | 状态 | 证据 |
|---|---|---|
| 必读基线、工作流协议和审查技能 | PASS | 已读取指定文件全文/相关内容，并按其事实来源优先级审查 |
| 目标 Mini-PRD 全文及相关 Step 1/原 PRD | PASS | 已读取目标合同、候选方案、AC、停止条件和交接边界 |
| `schema.sql` 相关定义 | PASS | 已核对 `user_account/auth_session`、`strategy_config`、`question_bank`、`domain_event_projection`、`assessment_session`、`command_log` 与 migration ledger |
| 双来源、四态、发布顺序、批准/hash、PREVIEW 抑制和 18+6 | PASS | §6.2、§6.3、§6.6、§7、AC-R3-01～08 已逐项核对 |
| principal bootstrap、SOD、撤销/轮换 | FAIL | §6.4.3 要求“证明目标安装身份”，但没有定义可验证的初始安装凭据/证书、authority registry 装载链或具体失败边界；见 P0-01 |
| feedback vault 两阶段提交、ORPHAN、repair、删除 | FAIL | §6.7.5 有顺序和状态语义，但 `feedback_commit_id` 的跨边界唯一/索引合同和 repair ACL 的权威来源未闭合；见 P1-01、P1-02 |
| PREVIEW aggregate/status/EventType、旧 v1/v2、migration 前后 | FAIL | §6.9 定义逻辑注册表，但没有把逻辑状态与当前受限 `aggregate_type/status/strategy_type` 的迁移映射固定为可验收合同；见 P1-03 |
| 默认数据库/dirty worktree 保护 | PASS | 本轮未访问默认数据库，未清理或回滚已有 dirty 改动 |
| typecheck/lint/build/全量测试/docs index | NOT_RUN | 本轮只允许生成审查文件，且目标为文档合同，未执行会产生额外工作树变更或实现验收的命令 |

## P0

### [P0-01] 首次 principal enrollment 的 trust bootstrap 仍可被实现为自证链

- 位置：目标 Mini-PRD §6.4.3，约第 255～266 行；AC-R3-04，约第 645～647 行。
- 触发条件：全新安装没有有效 `principal_binding`，执行 enrollment；或安装版首次加载 authority registry 时，只有“目标安装身份”“受信 provisioning authority”“固定 trust anchor”这些逻辑名称，没有规定安装身份凭据从哪里来、如何与固定 anchor 绑定、如何防止 registry/安装标识由目标库或 enrollment package 一起替换。
- 影响：实现者可以把请求携带的 installation ID、目标库中的 registry、环境配置或一个未验证的 provisioning session 当作 bootstrap 事实。这样常规 ADMIN 可能通过伪造 enrollment 获得可用于发布的 `principal_id`；反之，严格实现又可能无法完成首次注册。两种结果分别是权限越权或核心流程不可用。
- authority：`INV-AUTH-001` 要求权限敏感操作校验可信 caller；§6.4.2 要求执行身份只能由 trusted auth → ACTIVE ADMIN → signed mapping 推导；§6.4.3 明确禁止 mapping 自举；`schema.sql` 当前只有 `user_account/auth_session`，没有安装信任根或 provisioning authority 的权威事实表（约第 90～220 行）。
- 最小修复：在 Mini-PRD 中补齐“首次信任建立”合同：固定 anchor 的装载来源/版本和 fingerprint，安装身份凭据或证书的来源、签名链与绑定字段，authority registry 的防替换校验，首次 enrollment 的可信输入、单次/幂等键、有效期/撤销及 `PRINCIPAL_ENROLLMENT_REQUIRED` 与 `PRINCIPAL_ENROLLMENT_INVALID` 的精确分界。明确 anchor、installation identity、provisioning signer、enrollment executor/approver 的 SOD，并规定任一 bootstrap 证据缺失时只读修复且不得写 command/mapping/event。
- 回归：全新安装的合法 bootstrap、替换 registry/目标库、错 installation ID、过期/撤销 provisioning 包、重复同 hash、同 key 异 hash、provisioning executor 与 signer/approver 重合、撤销后发布和 trust-root rotation 的正负 fixture；断言 DB、event log、vault 均无业务写入。

## P1

### [P1-01] `feedback_commit_id` 的跨边界唯一性与幂等存储合同未闭合

- 位置：目标 Mini-PRD §6.7.5，约第 397～423 行；AC-R3-17，约第 690～694 行。
- 触发条件：相同 `feedback_commit_id` 在 vault 与 SQLite 各出现一次，或两个不同 request hash 复用同一 commit ID；发生崩溃后 repair/retry 只读取一侧记录。
- 影响：文档规定了 `feedback_commit_id` 必须全局唯一、两边都写 request hash，但没有规定两边各自的唯一键/索引、commit ID 与 `(operation, feedback_id, revision_no)` 的冲突关系、哪一侧是 collision authority，以及 DB reference 已存在时如何判定“同 hash 可重放”与“同 commit 异 hash 冲突”。不同实现可产生第二 revision、错误补写 reference 或把旧正文错误绑定到新请求，破坏 `ORPHAN/RECONCILE_REQUIRED` 的确定性。
- authority：`INV-EVT-004` 要求 `(client_instance_id, idempotency_key)` 对应单一 request hash 和确定 durable 结果；`INV-EVT-005` 要求恢复只读取冻结事实；§6.7.5 第 1～7 项要求 repair 不猜测正文、不覆盖历史 revision。当前 `schema.sql` 的 `command_log` 只对 `(client_instance_id, idempotency_key)` 建唯一索引（约第 2423～2486 行），并未提供 feedback reference 合同。
- 最小修复：明确 vault journal、vault manifest、SQLite reference、tombstone 各自对 `feedback_commit_id` 建立唯一约束/索引；固定 canonical commit proof 字段和冲突判定优先级；规定同 commit 同 hash、同 commit 异 hash、同 revision 异 commit、delete/purge 与 submit 交叉重试的 public status/error；把 repair 只能补写原 commit 的条件写成可验证谓词。
- 回归：vault-first、DB-first、两边同时存在、同 commit 异 hash、同 request 异 commit、崩溃在每个 fsync/DB commit 点、重复 repair、submit/delete 交叉重试；断言不会创建第二 revision、export 或正文复活。

### [P1-02] feedback repair ACL 没有可机械确定的权威来源，且与读取权限边界未分离

- 位置：目标 Mini-PRD §6.7.4～§6.7.5，约第 380～423 行；§11.2，约第 598～600 行。
- 触发条件：出现 `ORPHAN_REFERENCE` 或 `ORPHAN_VAULT_COMMIT`，调用 repair；调用者是 ADMIN、学校数据责任人、原教师或跨组织管理员中的任一主体。
- 影响：文档一方面允许“具有独立 repair 权限的 ADMIN/学校数据责任人”补写 reference，另一方面只要求实施计划落成 ACL，没有定义 repair capability 的签发者、组织/责任范围、是否需要双人批准、是否允许读取 private identity-map。实现可能给所有 ADMIN 过宽修复权，或无法在不读取真实映射的情况下完成授权判断，造成跨组织恢复或隐私泄漏。
- authority：`INV-AUTH-001` 要求新增权限敏感操作显式校验 caller/role；§3 角色表将学校数据责任人与 ADMIN 分开，§6.7.4 又将二者合并描述；`INV-IPC-001` 要求新权限操作有参数、权限和错误登记。
- 最小修复：把 `FEEDBACK_REPAIR_REFERENCE`、`FEEDBACK_TOMBSTONE`、`FEEDBACK_PURGE` 分成独立 capability，定义其权威授权记录、组织/feedback scope、期限、SOD/批准要求、是否允许读取 identity-map，以及缺失/越界/过期时的稳定错误。明确 repair ACL 只允许使用 commit proof 和非敏感 scope 校验，不自动授予 private map 读取权。
- 回归：教师、普通 ADMIN、学校数据责任人、跨组织 ADMIN、被撤销/过期 repair capability 的矩阵；分别覆盖 reference repair、tombstone、purge 和 identity-map 读取，断言未授权调用不写任何一侧事实。

### [P1-03] PREVIEW 逻辑状态/aggregate 与当前 Schema 的迁移映射不足以验收

- 位置：目标 Mini-PRD §6.9，约第 470～512 行；§10.2～§10.3，约第 567～580 行；当前 `src/main/db/schema.sql` 的 `domain_event_projection.aggregate_type` CHECK 约第 475～489 行、`assessment_session.strategy_type/status` 约第 520～550 行、`strategy_config.strategy_type` CHECK 约第 321～359 行。
- 触发条件：迁移前回放旧正式 v1/v2 事件、迁移中断恢复、迁移后读取新 preview event，或旧应用读取新事实；实现需要把 `JOB_SKILL_PREVIEW_RELEASE`、`JOB_SKILL_PREVIEW_SESSION`、`PREPARED/PUBLISHED/RECONCILE_REQUIRED` 等逻辑值落入当前受限列或新增表。
- 影响：§6.9 说“不能直接塞进现有正式枚举”，但只规定了逻辑状态和“物理列/表由 `/vibe-impl` 提出”，没有固定旧 Schema 的拒绝/旁路/新增 projection 映射、事件 sequence 归属、migration contract version 与 pre/post replay 的逐项关系。实施者可能扩大旧 CHECK、复用 `ASSESSMENT_SESSION` 的 `strategy_type`，或让旧应用把 preview aggregate 当正式 session；AC-R3-15/AC-R3-14 因而不能仅凭合同机械判定。
- authority：`INV-EVT-003` 要求新 EventType 完成 payload、持久化、reducer/projector、回放兼容和测试登记；`INV-EVT-005/006` 要求已准备批次只由冻结事实恢复且生产 mutation 走 v2 边界；当前 Schema 明确只允许既有 aggregate/status/strategy 值。
- 最小修复：在 PRD 中固定候选物理映射的决策表：哪些 preview aggregate 必须新表/新 projection，哪些事件允许进入现有 `domain_event_projection`，旧应用/旧 migration 对每个新 contract version 的行为，pre-migration、in-migration、post-migration 的 replay 顺序和 fail-closed 错误。要求每个 status/event registry entry 具备唯一 registry ID、版本、持久化目标和 migration contract version；不得把“实现计划决定”作为 AC 的唯一答案。
- 回归：旧 Schema 读取新 preview event、旧 v1/v2 formal replay、新 Schema replay 旧 formal、migration 中断后恢复、未知 aggregate/status/event/schema version、rollback 后新 preview command；断言旧正式 18+6 可读且 preview 永不降级为正式。

## P2

### [P2-01] 关键合同的测试证据全部保留为 NOT_RUN，交接表未提供最小静态合同校验

- 位置：目标 Mini-PRD §13 的 AC-R3-01～17，及 §17 的验证状态表。
- 触发条件：目标文件后续被复制到实现计划时，新增 EventType、error code、registry entry 或 AC 字段发生漂移。
- 影响：本轮文档不会被误称为运行时已通过，但当前没有一个只读的 schema/registry/AC 结构检查来发现“矩阵列了，登记项漏了”的合同漂移。
- authority：`INV-EVT-003` 和 `INV-DATA-003` 要求跨文件登记、可升级和可重放；工作流要求未执行检查必须如实标记。
- 最小修复：为下一阶段增加文档合同 lint，至少校验 aggregate/status/EventType/error code/AC 引用闭合、`feedback_commit_id` 两阶段状态集合一致、P0/P1 清零后才能生成 APPROVED 交接。
- 回归：删除任一 registry 字段、加入未知状态、删掉 AC 对应错误码或改变状态顺序时，静态检查失败。

## 已核验通过的关键项

- 双 official/preview 来源被定义为不可互推的独立 namespace，覆盖四态 `00/10/01/11`、正式先/预览先和撤销/过期/hash 漂移。
- responsibility manifest、approval、scope、期限、精确 question/asset/renderer/evidence/strategy hash 与 signer/executor SOD 已明确，且禁止用 `ACTIVE` 代替发布授权。
- 发布命令已定义规范化输入、request hash、M5B PREPARE/APPLY、冻结恢复、冲突和 dry-run 零写入语义。
- PREVIEW session 有独立 delivery mode/snapshot root hash，明确抑制 result/report、红线安全终止报告和跨题包综合结论；正式 18+6 `/48` 旧链保持独立。
- feedback vault 明确 vault-first、`ORPHAN_REFERENCE`/`ORPHAN_VAULT_COMMIT`、`RECONCILE_REQUIRED`、不可导出的中间态和 delete tombstone 顺序；问题在可执行索引/ACL 细节，而非遗漏两阶段原则。
- 旧正式 v1/v2 缺失 preview 判别时不得猜测为 preview，未知 registry/recipe/projector/schema 失败关闭。

## 残余风险

在 P0-01 未修复前，任何“首次安装可发布”验证都不能证明发布身份可信；在 P1-01/P1-02/P1-03 未修复前，repair、迁移和 replay 的实现验收可能出现不同解释。当前工作树已有用户改动，本报告未用 diff 或数据库状态推断其来源，也未将未执行的 typecheck/lint/build/test 声明为通过。

## 规则沉淀候选

- 增加 bootstrap trust contract 检查：安装身份、anchor、authority registry 和 provisioning package 必须形成可验证链，缺任一项不得写 mapping。
- 增加跨存储 commit contract 检查：每个 commit ID 必须在 vault/DB/tombstone 中唯一且可由同一 proof 重放。
- 为 repair capability 建立独立权限枚举和跨组织负向测试，禁止从 ADMIN 角色隐式推导。
- 为 preview registry 建立 migration pre/post replay fixture，明确旧 Schema 的 fail-closed 行为。

## 置信度

`HIGH`。结论基于目标 Mini-PRD 的具体章节/行号、当前 `schema.sql` 的 CHECK/索引定义及项目不变量；未对尚未实现的运行时行为作推断式“通过”判断。
