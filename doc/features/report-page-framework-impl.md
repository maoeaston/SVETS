# F7 报告页面框架实施计划

- 状态：`PASS`
- 版本：v1.0.3
- 日期：2026-07-26
- 来源 PRD：`doc/features/report-page-framework-prd.md`
- 风险等级：`R3`
- 基线提交：`71280abe86fca430841e3144b2b87d058353fb2c`
- 基线分支：`feat/multi-device-m2-prd`

## 1. 实现目标

把已经批准的 F7 Mini-PRD 落成一个教师可操作、主进程可授权、事件可重放、失败可恢复的报告闭环：教师可以确认基础任务闭环，生成并查看 BASE_ABILITY、JOB_SKILL 和 SAFETY 三类持久化报告快照，完成安置建议复核、锁定和默认脱敏 HTML 导出。

页面和导出只消费已经持久化且通过运行时合同校验的 `task_report.report_content_json`。打开列表或详情不得隐式生成报告，不得回查 current result 后重算历史快照。

## 2. 基线与范围

### 2.1 前置校验

- Mini-PRD 状态为 `APPROVED_FOR_IMPLEMENTATION`，没有未关闭 P0。
- 当前产品合同由 `doc/specs/baseline.yaml` 指向 `doc/specs/MVP_PRD_v1.0.9-authoritative.md`。
- 当前 Schema 权威源为 `src/main/db/schema.sql`，当前版本为 `0.1.15-multi-device-m3-grant-assignment`。
- 影响域：`DATABASE_MIGRATION`、`EVENT_PROJECTION`、`IPC_API`、`AUTH_PERMISSION`、`SAFETY_FSM`、`RESULT_REPORT`、`UI_UX`。
- 因涉及 Schema、迁移、安全事件、权限、并发和事件恢复，采用最高风险等级 `R3`。

### 2.2 当前代码事实

- `src/main/db/schema.sql` 已有 `task_report`、报告状态、红线来源 guard 和安置复核导出 guard，但没有 `task_closure`、lineage/revision/hash/合同状态列和完整生命周期 guard。
- `src/main/ipc/handlers/job-skill-report.ts` 会自动生成 JOB_SKILL 报告，但按 source session 粗粒度幂等，且坐次和版本元数据存在常量。
- `src/shared/types/json-schemas.ts` 的 BASE 报告类型仍是宽松索引签名，JOB_SKILL 合同缺少三个权威必填区块，且没有安全报告判别分支。
- `src/main/domain/recovery.ts` 只恢复 `REPORT_GENERATED`，不恢复闭环、复核、锁定和导出；现有 `applied_to_snapshot` 字段尚未形成报告事件完成标记。
- `src/main/db/connection.ts` 当前先运行 migration、再执行 action log reconcile；升级前仅存在于 JSONL 的 schema v1 事件不会进入 F7 的旧行回填集合。
- `src/main/ipc/handlers/safety.ts` 的事实修正会在一个 SQLite 事务中连续 append 创建、replacement 和 void 三个 JSONL 事件；SQLite rollback 不能撤销已经追加的 JSONL 前缀。
- `src/shared/types/ipc-api.ts`、`src/preload/index.ts` 和 `src/main/ipc/index.ts` 尚无 `reports:*` API。
- `src/renderer/src/router/index.ts`、教师导航和首页报告入口尚未接入报告列表和详情。

### 2.3 已确认冲突

- [!] `src/main/db/schema.sql` 的 `trg_task_report_placement_review_export_*` 对所有 `FULL_REPORT` 要求复核，与权威 PRD §5.8.3 的 JOB_SKILL 禁止安置建议冲突。目标为按已校验快照中的 `placement_advice.enabled` 判定。
- [!] `src/shared/types/json-schemas.ts` 和 `src/main/ipc/handlers/job-skill-report.ts` 缺少 `online_knowledge_summary`、`offline_performance_summary`、`administration_summary`，与权威 PRD §5.8.3 冲突。
- [!] 当前 JOB_SKILL 报告固定 `sitting_count = 2`，并硬编码评分器和内容版本，与权威 PRD §5.8、§17.2 的历史可追溯要求冲突。
- [!] 当前报告恢复、失败审计、合同修复和并发约束不足，不能满足 F7 Mini-PRD §6、§9.2、§9.6、§9.7。
- [!] 当前结果表没有统一教学轮次键，不能证明三类 BASE 结果属于同一闭环。目标是按已批准 PRD 增加教师确认且 binding 不可原地修改的 `task_closure`，不使用“最新三条结果”推断。
- [!] 当前“先迁移、后恢复”的启动顺序会让 JSONL-only schema v1 事件绕过 F7 backfill；F7 migration 前必须先把旧日志恢复到 v0.1.15 投影，失败时禁止进入新 Schema 和业务窗口。
- [!] 当前安全事实修正的三个 JSONL append 不具备崩溃原子性；F7 必须改为一个携带完整 replacement/void/report 副作用的 schema v2 决定性事件，不能继续依赖 SQLite 事务包裹多个 append。

### 2.4 本次明确不做

- 不激活 BASE_ABILITY 96 题或 JOB_SKILL 298 题，不生成题库激活 SQL，不写真实运行数据库。
- 不修改 F6 评分公式、阈值、结果类型或双轨隔离规则。
- 不实现 PDF、Markdown 报告渲染、非脱敏导出、云分享或报告模板编辑器。
- 不实现 AI 岗位推荐、AI 最终录用或淘汰裁决。
- 不为 STUDENT 或 ADMIN 开放完整报告业务 API 或页面。
- 不建立覆盖所有业务流程的通用 task-cycle 聚合。
- 不承诺 F7 之外所有历史事件都可从 JSONL 完整重建；本计划只补齐 F7 新增或扩展的闭环、报告和安全联动事件。

## 3. 适用不变量

| 不变量 | 本次落实位置 |
|---|---|
| `INV-EVT-001` | 闭环、报告生成、复核、锁定、导出及安全报告失效全部由领域事件推进 |
| `INV-EVT-002` | 保持 JSONL append -> event projection -> reducer 顺序，并为 F7 事件增加完成标记和写入阻断 |
| `INV-EVT-003` | 新增/扩展事件同步 payload、运行时 validator、持久化、reducer、恢复和回放测试 |
| `INV-SAFE-001` 至 `INV-SAFE-004` | 安全报告只消费已确认事实；不改变先熔断、生命周期和终态事实冻结 |
| `INV-AUTH-001` | F7 业务操作只允许 ACTIVE TEACHER；ADMIN 仍只处理安全终态，不获得报告业务权限 |
| `INV-RES-001` | BASE 报告并列固化三类结果，JOB_SKILL 独立展示，不生成单一混合总分 |
| `INV-RES-002` | 红线来源普通报告在领域服务和 DB 双重阻断，安全等级不可被普通分数覆盖 |
| `INV-STR-001`、`INV-STR-002` | 报告固化会话实际引用的策略版本，不修改历史策略 |
| `INV-IPC-001`、`INV-IPC-002` | 所有报告通道同步 handler、preload、shared type 和权限测试；renderer 不碰文件或 SQLite |
| `INV-DATA-001` | `source_result_ids_json`、报告内容和 F7 事件 payload 写入前运行时校验 |
| `INV-DATA-002` | 阈值、Pilot 标志和训练建议规则读取冻结策略，不在页面散落策略常量 |
| `INV-DATA-003` | 新库、升级库、迁移失败、备份恢复、FK 和 integrity 均有自动证据 |
| `INV-AUTH-002` | F7 只读取现有会话身份，不改变授权、分配或 delivery phase 关系 |
| `INV-A11Y-001` | 报告页面执行桌面、小屏、键盘、触控、字号、对比度和低认知负荷人工验收 |
| `INV-CI-001` | 无仓库 CI 时保留全部本地命令证据，不把未执行项写成通过 |

## 4. 变更地图

### 4.1 当前状态

```text
JOB_SKILL_SCORE -> maybeGenerateJobSkillReport -> REPORT_GENERATED + task_report
                                               -> 失败仅 console.error

BASE 三类结果 ---------------------------------> 无统一闭环确认/报告服务
CONFIRMED safety_incident ---------------------> 无安全报告生成服务

task_report -----------------------------------> 无教师读取 IPC/页面
REPORT_LOCKED/EXPORTED/PLACEMENT_REVIEW -------> 无完整 reducer/replay
```

### 4.2 目标状态

```text
三类 current BASE 结果 --教师确认--> task_closure --显式生成--> BASE 快照
current JOB_SKILL_SCORE ------------------------自动/重试--> JOB 快照
CONFIRMED/合规 RESOLVED incident --------------自动/重试--> SAFETY 快照
                                                        |
                                                        v
                                                task_report lineage
                                                        |
                       列表/详情 <- SQLite 投影 <- F7 event reducer
                                                        |
                                  复核 -> 锁定 -> 脱敏 HTML 导出
```

### 4.3 迁移路径

1. fresh DB 只允许配空或不存在的 action log；fresh DB 配非空历史日志属于更广的全量重建场景，F7 以 `STARTUP_RECOVERY_REQUIRED` 失败关闭。对非 fresh DB 先只升级到 v0.1.15 结构；若 F7 尚未应用，使用 v0.1.15 reducer 恢复所有 JSONL-only schema v1 事件，并确认旧日志与旧投影没有 pending/unrecoverable 项。
2. 旧日志恢复成功后创建同一代次的 DB + JSONL 备份；恢复失败则保留原文件、终止启动，不注册业务 IPC 或打开正常业务窗口。
3. 再创建 `task_closure` 和 F7 索引列的可迁移结构，并扩展两个 aggregate CHECK 表。
4. 对已经包含旧日志恢复结果的 `task_report` 逐行解析 JSON、计算内容 hash、推导 lineage/revision，并用当前 validator 标记 `VALID` 或 `REPAIR_REQUIRED`。
5. 旧报告的 builder 标记为 `legacy-unknown`；legacy generation key 仅由 report ID 构造，永不参与正常幂等命中。
6. 若旧报告 JSON 无法解析，或同一 lineage 存在多条活动报告，迁移失败并列出 report ID，不静默选择或伪造元数据。
7. 回填完整并验证后再创建唯一索引、状态/内容冻结 trigger 和合同状态 guard。
8. 成功迁移后的回退不做逆向 ALTER，而是恢复上述已完成 v1 reconcile 的成对备份，防止旧二进制误读 F7 事件。

### 4.4 失败恢复路径

- F7 新增或扩展事件使用 `ActionLogEntry.schema_version = 2`，以区别旧事件的兼容处理。
- 启动升级采用 `v0.1.15 migration -> schema v1 reconcile -> paired backup -> F7 migration -> schema v2 reconcile` 两阶段顺序；schema v1 reconcile 失败时保持数据库未进入 F7，并以 `STARTUP_RECOVERY_REQUIRED` 终止正常启动。
- 正常命令在一个 SQLite 事务内写 projection、应用 reducer 并把 `applied_to_snapshot` 置为 1；JSONL 仍先于 SQLite。
- 每个 F7 业务命令最多追加一个决定性 schema v2 事件。安全事实修正由扩展后的 `SAFETY_INCIDENT_REPLACED_FOR_FACTUAL_CORRECTION` 一次携带新 incident 完整快照、旧 incident 状态变化和报告 ID，并由单个 reducer 原子应用；该路径不再另行 append CREATED/VOIDED。
- 若 JSONL 已追加但 projection/reducer 失败，报告协调器立即关闭闭环、结果和报告写入口；只读列表、详情和异常中心仍可用。
- 同一命令重试或冷启动时，恢复器对 schema v2 的 F7 事件同时处理“projection 缺失”和“projection 存在但未 applied”两种情况，完成后才解除写入阻断。
- schema v1 旧事件保持现有兼容语义，不把历史上未使用的 `applied_to_snapshot = 0` 误判为待重放。
- 导出采用准备、临时文件、完成三阶段；完成阶段重入 lineage 队列并校验 content hash 和状态。失效文件删除失败时移入 userData 下不可见的 orphan 隔离目录并登记异常。

### 4.5 依赖图

```text
Step 1 合同/validator/hash
  -> Step 2 legacy reconcile bridge + Schema/migration
      -> Step 3 reducer/recovery/coordinator
          -> Step 4 task_closure
              -> Step 5 三类报告生成
                  -> Step 6 自动生成与安全联动
                      -> Step 7 读取/生命周期 IPC
                          -> Step 8 HTML 导出
                              -> Step 9 教师页面
                                  -> Step 10 全量验收与文档收口
```

Step 7 的只读接口依赖 Step 5 的稳定快照合同；Step 8 的导出依赖 Step 7 的生命周期 guard；Step 9 不得提前于 IPC 合同落地。

### 4.6 跨文件副作用登记表

| 主变更 | 必须同步登记或核验 |
|---|---|
| `AggregateType += TASK_CLOSURE` | shared type、`domain_event_projection` CHECK、`error_event_log` CHECK、migration、event sequence、恢复测试 |
| 新增 `TASK_CLOSURE_*` | payload、validator、service、reducer、replay、Schema guard、并发和幂等测试 |
| 扩展 `REPORT_*` / `PLACEMENT_REVIEW_*` | payload、validator、normal reducer、recovery reducer、状态 trigger、旧事件兼容测试 |
| 扩展 safety 事件 | `safety.ts`、payload validator、recovery、安全报告 supersede/archive、权限和故障注入测试 |
| 安全事实修正改为单事件 | replacement payload 完整事实、旧三事件兼容、reducer 原子副作用、每个旧 append 边界升级夹具 |
| `task_report` 列和约束 | fresh schema、增量 migration、旧行 backfill、读取模型、fixture、DB 直写负向测试 |
| 报告内容字段 | builder、运行时 validator、共享 presentation projection、页面、HTML 导出 allowlist、历史兼容、恶意文本测试 |
| 报告 IPC | handler、trusted auth session、shared API、preload 白名单、注册、直接 IPC 负向测试 |
| 新教师路由 | router、role guard、TeacherLayout、首页入口、deep link 和未授权路由测试 |
| 文件导出 | dialog、路径/临时文件、hash、`asset_resource`、事件、状态投影、失败清理/隔离测试 |
| Schema 版本升级 | legacy pre-reconcile、schema header、migration runner、connection snapshot、启动失败处理、`baseline.yaml`、`AGENTS.md`、迁移验证脚本 |

## 5. 实现步骤

### Step 1：冻结报告、IPC 与事件运行时合同

**目的与理由：**

先建立三类报告、typed result snapshot、task closure、IPC 判别联合和 F7 事件 payload 的单一类型及运行时校验入口，防止后续 Schema、服务、页面各自解释 JSON。

**前置状态：** Mini-PRD 已批准；`json-schemas.ts` 仍是运行时 JSON 类型权威源。

**完成状态：** 所有 F7 输入和持久化 JSON 都能从 `unknown` 得到 `valid + typed value` 或稳定字段错误；canonical JSON/hash 有固定测试向量。

**不得改变：** 现有四类结果计算、旧事件 payload 和任何数据库结构。

**改动文件及职责：**

- `src/shared/types/json-schemas.ts`：收紧 BASE，补齐 JOB_SKILL，新增 SAFETY 报告和三类 typed result snapshot 判别联合。
- `src/shared/types/report.ts`（新增）：报告列表、详情、候选、闭环和生命周期 IPC DTO/错误码。
- `src/shared/types/event-payloads.ts`：增加 `TASK_CLOSURE` aggregate、两个闭环事件及扩展后的报告/安全事件 payload。
- `src/main/domain/report-contract.ts`（新增）：内容、source result IDs、IPC 输入和 F7 event payload 运行时 validator。
- `src/main/domain/report-canonical.ts`（新增）：递归键排序、数组保序、UTF-8 canonical JSON 和小写 SHA-256。
- `src/main/domain/__tests__/report-contract.test.ts`（新增）：三类合同正常、异常、边界测试。
- `src/main/domain/__tests__/report-canonical.test.ts`（新增）：固定 hash、键顺序、数组顺序和非法 JSON 值测试。

**跨文件登记项：**

- [ ] `ReportContentJson` 只有 BASE/JOB/SAFETY 三个可判别分支。
- [ ] `reports:generate` 输入按 scope 严格互斥，多余 source 字段也拒绝。
- [ ] `placement_advice` 是 enabled true/false 判别联合，false 时 recommendation 必须为 null。
- [ ] BASE 三个 snapshot ID、固定顺序和 `source_result_ids_json` 完全一致。
- [ ] safety assessment/training/no-bound metadata 分支不允许伪造不适用字段。
- [ ] schema v2 `SAFETY_INCIDENT_REPLACED_FOR_FACTUAL_CORRECTION` payload 足以单独创建 replacement、作废旧 incident、固化 root lineage 并淘汰指定报告；同一命令不需要第二个事件补事实。
- [ ] 所有新增/扩展事件均有运行时 parser，不依赖 `as Record<string, unknown>` 作为校验。

**核心设计与伪代码：**

```text
parseReportContent(unknown)
  -> inspect report_type first
  -> SAFETY_TERMINATION_REPORT => parse safety-termination-report-v1.0
  -> otherwise report_scope=JOB_SKILL => parse job-skill-report-v1.0
  -> otherwise => parse task-report-v1.1 BASE_ABILITY
  -> validate cross-field invariants

canonicalize(value)
  -> reject undefined/function/symbol/non-finite number
  -> object keys sorted lexicographically
  -> arrays preserve contract order
  -> JSON.stringify(normalized)
```

**数据、事务与失败恢复：** 本步无持久化写入；validator 必须纯函数，错误携带字段路径但不包含学生敏感内容。

**测试设计：**

- 单元：三个合法最小合同、完整合同、placement 分支、Pilot/未完成/JOB 禁止建议。
- 异常：缺块、错 scope、重复 snapshot、hash 输入不一致、额外 source 字段、NaN/undefined。
- 边界：一坐次、多坐次、training-only、NO_BOUND_SESSION、空观察但完成度不足。
- 回归：现有结果类型和 JOB_SKILL result payload 编译不变。

**精确验证命令：**

```bash
npx vitest run src/main/domain/__tests__/report-contract.test.ts src/main/domain/__tests__/report-canonical.test.ts
npm run typecheck
git diff --check
```

**预期证据：** 两个测试文件全通过；typecheck 退出码 0；无 whitespace error。

**回滚方式：** 删除新增文件并恢复三个 shared type 文件；本步无数据回滚。

**停止条件：** PRD 无法唯一确定跨字段语义，或 validator 必须接受同一 JSON 的两种冲突解释。

**建议 commit message：** `feat(report): define F7 report and event contracts`

### Step 2：升级 Schema 并实现可失败关闭的增量迁移

**目的与理由：**

先消除升级前 JSONL-only 事件，再为 task closure、报告 lineage、合同状态、状态机和 DB 级安全约束建立新库与旧库一致的数据库基线。

**前置状态：** Step 1 validator/hash 可复用；现有成对备份机制可复用，但备份时点调整到 legacy reconcile 成功后、F7 migration 前。

**完成状态：** 全新库直接得到 F7 结构；v0.1.15 库先恢复 schema v1 日志再升级到 `0.1.16-report-framework`；迁移或 pre-reconcile 失败保留旧库与日志且不进入业务窗口；旧报告不会被伪装为有效快照。

**不得改变：** 既有 result、session、incident、asset 行的业务事实；不触碰真实 `xc-career-guide.db`。

**改动文件及职责：**

- `src/main/db/schema.sql`：新增 `task_closure`，扩展 aggregate CHECK、`task_report` 列/索引/trigger 和报告错误码。
- `src/main/db/migrations.ts`：增加 `2026-07-24_f7_report_framework` 结构检测、增量升级和版本登记。
- `src/main/db/report-migration.ts`（新增）：旧报告解析、backfill、lineage 冲突预检和可诊断错误。
- `src/main/domain/legacy-upgrade-recovery.ts`（新增）：在 F7 migration 前以 v0.1.15 合同恢复 JSONL-only schema v1 projection/业务行，并拒绝无法确定处理的事件。
- `src/main/db/connection.ts`：编排 legacy migration/reconcile、成对备份、F7 migration 和 post-migration reconcile；从 migration 常量读取 snapshot schema version，移除硬编码旧版本。
- `src/main/index.ts`：捕获结构化 `STARTUP_RECOVERY_REQUIRED`，不注册业务 IPC/协议或打开正常业务窗口，显示不含敏感数据的阻断信息后退出。
- `src/main/db/__tests__/schema-report-framework.test.ts`（新增）：fresh schema 的闭环、状态、内容冻结和合同 guard。
- `src/main/db/__tests__/migrations.test.ts`：增加 F7 升级、幂等、失败回滚和旧报告兼容。
- `src/main/domain/__tests__/legacy-upgrade-recovery.test.ts`（新增）：v1 JSONL-only report/safety 事件、坏 checksum/sequence 和重复启动测试。
- `scripts/verify-f7-migration.mjs`（新增）：只在临时目录演练 fresh/upgrade/restore 和 integrity。
- `package.json`：增加 `db:f7:verify`，不修改依赖。
- `doc/specs/baseline.yaml`、`AGENTS.md`：实现落地时同步 Schema 版本事实；保留工作树中已有非 F7 修改。

**跨文件登记项：**

- [ ] `TASK_CLOSURE` 同时进入 shared aggregate、event projection CHECK 和 error aggregate CHECK。
- [ ] `task_closure` 三类 binding/确认字段不可更新或删除，replacement 只更新允许字段。
- [ ] closure revision、cycle head、唯一 active closure 和 replacement 指向当前 head 有 DB 兜底。
- [ ] `task_report` 的 generation key、lineage revision 和 active lineage 均唯一。
- [ ] 内容、来源、生成者、生成时间和 hash 从 INSERT 后冻结。
- [ ] review/lock/export 同时检查 `contract_validation_status = VALID`。
- [ ] placement review guard 读取已校验 JSON 的 `placement_advice.enabled`，不再按所有 FULL_REPORT 粗判。
- [ ] fresh schema 与 migration 最终对象 SQL 一致，结构检查不只看对象名。
- [ ] F7 backfill 开始前，schema v1 日志中可恢复事件均已进入 projection 和旧业务表；迁移不得只扫描迁移前已有的 SQLite 行。
- [ ] pre-reconcile 只接受 schema v1 且使用 v0.1.15 reducer，不用 F7 validator 猜测旧 payload；schema v2 或未知事件在旧库上失败关闭。
- [ ] legacy bridge 按当前 v1 合同识别事实修正三联事件：带 `brief_description` 的 replacement `SAFETY_INCIDENT_CREATED`、引用同一 new ID 的 `SAFETY_INCIDENT_REPLACED_FOR_FACTUAL_CORRECTION` 和随后 `SAFETY_INCIDENT_VOIDED`。只有完整且字段一致的三联事件可以在一个 SQLite 事务中恢复；任一截断前缀标记 `AMBIGUOUS_LEGACY_EVENT_PREFIX` 并停止升级，不补造缺失事件。
- [ ] pre-reconcile 成功后、F7 migration 前创建成对备份；任何失败均不登记 F7 migration ledger。
- [ ] 启动恢复失败时不注册正常 IPC/窗口，不允许 renderer 在半迁移数据库上继续写入。
- [ ] fresh DB 配非空历史 JSONL 不被当成普通新装；在 M5 全量重建落地前稳定失败关闭。

**核心设计与伪代码：**

```text
startup upgrade:
  migrate legacy DB through v0.1.15 only
  scan JSONL schema-v1 events and group complete legacy correction triplets
  reject truncated/ambiguous multi-event prefixes without inventing facts
  reconcile single events and complete groups with legacy reducers
  assert no missing/unapplied/unrecoverable legacy projection
  create paired DB + JSONL backup

F7 migration transaction:
  rebuild domain_event_projection CHECK with TASK_CLOSURE
  rebuild error_event_log CHECK with TASK_CLOSURE
  create task_closure + indexes
  add nullable F7 columns to task_report
  for each legacy report ordered by generated_at/report_id:
    parse JSON or fail with report_id
    derive scope/source business key
    canonicalize content and compute content_hash
    assign lineage_key + monotonic revision
    builder = legacy-unknown
    generation_key = hash({ legacy_report_id })
    validation = current validator ? VALID : REPAIR_REQUIRED
  detect >1 active legacy report per lineage => fail closed with IDs
  create final unique indexes and triggers
  verify row snapshots + FK + integrity

post migration:
  apply full schema and assert structure
  reconcile schema-v2 F7 events
  only then expose normal IPC/window
```

`task_closure` 至少保存三类 result/source ID、`cycle_no`、`closure_revision`、status/head、replacement 双向关联、修正原因、确认人/事件/时间和 `last_applied_event_id`。binding 字段不使用全局 UNIQUE，因为合法 replacement 可以复用直接旧版结果；复用边界由 trigger 和领域服务共同校验。

**数据、事务与失败恢复：**

- legacy reconcile 本身按单事件事务恢复，成功后才创建 F7 迁移前备份；迁移本体单事务执行。
- CHECK 表重建时使用现有 `foreign_keys = OFF + legacy_alter_table = ON` 机制，并恢复外部 trigger。
- 成功后的回退只恢复配套 DB + JSONL 备份，不提供会丢失 F7 事实的 down migration。
- pre-reconcile、备份或 migration 任一步失败均关闭数据库连接并抛出稳定启动错误；不执行 seed、不写恢复审计事件、不注册正常 IPC。
- 验证脚本使用 `mkdtemp`/临时数据库，结束后可直接删除，不读取或写入真实 userData。

**测试设计：**

- 新库：所有表、列、索引、trigger、error code 和 migration ledger 存在。
- 升级：合法旧报告回填；缺块报告为 REPAIR_REQUIRED；legacy key 不被正常幂等复用。
- 跨版本恢复：v0.1.15 DB 分别配入 JSONL-only `REPORT_GENERATED`、安全创建/确认/解决/作废事件、完整事实修正三联事件及已有 projection 未完成夹具；升级后同一业务 ID 存在且 F7 元数据、幂等、FK/integrity 完整。
- 多事件旧前缀：分别只保留 v1 factual correction 的第 1 个、第 1-2 个和完整 3 个 append；前两者稳定报 `AMBIGUOUS_LEGACY_EVENT_PREFIX` 且不迁移/不补造 replacement，完整三联一次恢复并只产生一个 replacement。
- 异常：非法 JSON、双活动 lineage、部分对象、对象 SQL 漂移均失败关闭并列出 ID。
- 启动异常：fresh DB + 非空历史日志、schema v1 坏 checksum/sequence/未知 payload、旧库出现 schema v2 事件、pre-reconcile reducer 失败时不写 F7 ledger、不注册业务 IPC，DB/JSONL 字节或允许的 legacy 恢复结果保持可诊断。
- DB 负向：直接修改内容/source、非法状态跳转、无复核导出 enabled 建议、REPAIR_REQUIRED 操作均失败。
- 兼容：现有 session/result/safety/asset/report 行逐字段不变；FK/integrity 通过；二次迁移为空。
- 回滚：故障注入后旧结构和行不变；恢复备份后旧二进制基线可读。

**精确验证命令：**

```bash
npx vitest run src/main/db/__tests__/schema-report-framework.test.ts src/main/db/__tests__/migrations.test.ts src/main/domain/__tests__/legacy-upgrade-recovery.test.ts
npm run db:f7:verify
npm run typecheck
git diff --check
```

**预期证据：** fresh/legacy-reconcile/upgrade/rollback 四组证据、JSONL-only v1 事件得到同 ID 和完整 F7 backfill、`foreign_key_check=[]`、`integrity_check=ok`、二次启动无操作。

**回滚方式：** 代码回滚后恢复迁移前成对备份；不得在已产生 schema v2 F7 事件的运行库上只降级二进制。

**停止条件：** 无法以旧合同确定性恢复 schema v1 事件、无法证明 pre-reconcile 在 migration 前完成、无法可靠解析旧报告、检测到双活动 lineage，或重建导致任一历史行/外部 trigger 漂移。

**建议 commit message：** `feat(db): add F7 report schema and migration`

### Step 3：建立 F7 事件 reducer、重放完成标记和写入协调器

**目的与理由：**

先让所有后续写命令拥有同一套可重放、可幂等、失败后立即阻断的基础设施，避免把恢复逻辑复制到 handler。

**前置状态：** Step 2 Schema 和 schema v2 event contract 已存在。

**完成状态：** F7 事件 normal apply 与 recovery apply 共用 reducer；缺失 projection 和未完成 projection 都可重放；同 key 命令串行；每个 F7 业务命令只能追加一个决定性事件；失败后写入口关闭并可恢复。

**不得改变：** 旧 schema v1 事件的既有兼容行为；事件持久化顺序。

**改动文件及职责：**

- `src/main/domain/report-reducer.ts`（新增）：闭环、报告生成、复核、锁定、导出及安全报告状态副作用的幂等 reducer。
- `src/main/domain/report-command-coordinator.ts`（新增）：按业务 key 的 Promise queue、单事件命令入口、F7 pending projection 检查和写入 gate。
- `src/main/domain/event-writer.ts`：允许显式 `schemaVersion: 2`，不改变旧调用默认值 1。
- `src/main/domain/recovery.ts`：分发 F7 事件，核对既有 projection 内容，并处理 schema v2 未 applied 事件。
- `src/main/domain/__tests__/report-reducer.test.ts`（新增）：normal apply、重复 apply 和非法事件。
- `src/main/domain/__tests__/report-coordinator.test.ts`（新增）：同 key 串行、不同 key 可推进、阻断/恢复。
- `src/main/domain/__tests__/recovery.test.ts`：补 F7 缺 projection、未 applied、校验失败和 schema v1 兼容。

**跨文件登记项：**

- [ ] normal path 与 replay path 调用同一个 `applyReportEvent`。
- [ ] reducer 成功和 `applied_to_snapshot = 1` 在同一 SQLite 事务。
- [ ] schema v2 projection 已存在时必须核对 event type、aggregate、sequence、payload 和 checksum。
- [ ] 不支持或未通过 runtime validator 的 F7 payload 失败关闭。
- [ ] queue key 固定为 `student_id + job_code + task_code + scope`，不使用 report ID 造成同 lineage 竞态。
- [ ] 写 gate 至少覆盖 closure、结果、报告和 safety 变更；只读不被误阻断。
- [ ] handler 不直接组合多个 schema v2 `writeEvent`；coordinator 接收一个完整 event intent，并在一个 SQLite 事务内完成 projection、reducer 和 applied 标记。
- [ ] 一个业务命令若需要创建行、迁移状态和淘汰报告，全部由同一个决定性 payload 固化；不以多个 JSONL append 的“最终都会成功”作为原子性假设。

**核心设计与伪代码：**

```text
runSingleEventCommand(key, buildIntent):
  await previous[key]
  recoverPendingF7EventsOrThrow()
  reread preconditions and build zero-or-one complete event intent
  append exactly one schema-v2 event when mutation is required
  transaction(insert projection -> reducer -> mark applied)
  on event-transaction error:
    block relevant writes
    throw RECOVERY_REQUIRED
  release key in finally

reconcile schema-v2 event:
  projection missing -> insert projection -> validate -> reducer -> mark applied
  projection exists + applied=0 -> verify exact event -> reducer -> mark applied
  projection exists + applied=1 -> skip
```

**数据、事务与失败恢复：** 每个 F7 mutation 由单一决定性事件独立重放；来源事实提交后触发的自动报告生成属于后续独立命令和事务，不把两个事件伪装成一个原子命令。恢复完成前 gate 不因普通刷新自行解除。

**测试设计：**

- 单元：所有 F7 event payload 分支、状态前后值、content hash 和 actor 校验。
- 集成：JSONL append 后 projection INSERT 失败；projection 成功但 reducer 失败；重启/重试补齐。
- 幂等：重复 replay 不增加 closure、report、asset 或 revision，不重复 supersede/archive。
- 并发：同 lineage 两个生成命令只进入一个临界区；不同学生不共享锁。
- 崩溃原子性：对每类 F7 mutation 断言一个命令最多一个 schema v2 事件；复合副作用在 reducer 故障后重放时全有或全无，不出现只完成前缀。
- 回归：schema v1 的旧 REPORT_GENERATED 不因 applied=0 被重复应用。

**精确验证命令：**

```bash
npx vitest run src/main/domain/__tests__/report-reducer.test.ts src/main/domain/__tests__/report-coordinator.test.ts src/main/domain/__tests__/recovery.test.ts
npm run typecheck
git diff --check
```

**预期证据：** 三类恢复故障均得到同一业务 ID；并发测试没有第二条活动投影；每个 F7 mutation 的事件数为 0（幂等）或 1（首次成功/可恢复失败）。

**回滚方式：** 恢复本步代码；若测试产生 schema v2 JSONL，只能连同测试临时库删除，不能让旧代码读取该日志。

**停止条件：** normal/replay 需要两套不同业务规则，任一 F7 命令仍需依赖两个以上 JSONL append 才能表达完整事实，或任一失败会留下无法判定是否已应用的事件。

**建议 commit message：** `feat(report): add replayable report event pipeline`

### Step 4：实现 task closure 确认、水位和 replacement

**目的与理由：**

把 BASE 三类结果的同轮关系变成教师确认且可审计的持久事实，阻止生成接口临时拼接任意 result ID。

**前置状态：** Step 3 reducer、queue 和恢复可用。

**完成状态：** 正常闭环和误配修正均通过事件生成；binding 不可原地改；cycle/revision 水位、历史复用和报告状态副作用有领域与 DB 双重约束。

**不得改变：** 四类 result 的计算和 current 切换；已有 session 状态。

**改动文件及职责：**

- `src/main/domain/task-closure-service.ts`（新增）：候选事实读取、正常确认、replacement 校验和事件构造。
- `src/main/domain/report-source-reader.ts`（新增）：按 source aggregate 读取 student/job/task/终态和 typed result，供闭环与 builder 共用。
- `src/main/domain/__tests__/task-closure-service.test.ts`（新增）：闭环、replacement、水位、权限和并发矩阵。
- `src/main/db/test-helpers.ts`：增加仅测试使用的四类结果/闭环夹具，不写生产 seed。

**跨文件登记项：**

- [ ] 正常确认恰好接收 ABILITY/TRAINING/OPERATION 各一条，并按固定顺序持久化。
- [ ] 三条结果的 student/job/task 一致，source session 终态合法且非红线。
- [ ] 正常确认拒绝任何曾进入历史 closure 的 result。
- [ ] replacement 只复用直接旧版 result 或全新 result，且至少一条不同。
- [ ] 历史复用/head/current 校验前先按固定类型顺序计算 binding fingerprint 并查询幂等命中；同请求重试不能先被“result 已使用”拒绝。
- [ ] replacement 重试以 `old_task_closure_id + requested_binding_fingerprint` 查找已创建的直接 replacement；三条与直接旧版完全相同时返回旧闭环，不创建空 revision。
- [ ] 新 cycle 确认在同一事件投影中 supersede 旧活动 closure 和报告。
- [ ] 历史 cycle replacement 保持 SUPERSEDED，不越过最高 cycle 水位。
- [ ] payload 固化 superseded closure/report IDs，replay 不重新查询 current 决定历史。

**核心设计与伪代码：**

```text
confirm(resultIds):
  queue(student/job/task/BASE)
  reread all three current results and source sessions
  fingerprint = hash(fixed-order typed bindings)
  if current closure has same fingerprint: return current closure ID
  validate unused + same business key + non-redline + terminal
  cycle_no = max(cycle_no) + 1; revision = 1
  payload includes deterministic bindings and superseded IDs
  append TASK_CLOSURE_CONFIRMED(v2) -> reducer -> applied

replace(oldClosureId, resultIds, reason):
  queue(old closure business key)
  fingerprint = hash(fixed-order typed bindings)
  if existing direct replacement matches oldClosureId + fingerprint: return replacement ID
  if old closure fingerprint == fingerprint: return old closure ID without an event
  require old is cycle head; reason non-empty
  enforce direct-old/new-only reuse and at least one changed binding
  revision = old + 1; status depends on highest cycle watermark
  append TASK_CLOSURE_REPLACED(v2) -> reducer -> applied
```

**数据、事务与失败恢复：** 取得 queue 后、append 前重读 closure watermark 和 result current 状态。幂等查询必须先于“已使用/非 head/至少一条变化”校验；事件 append 后失败由 Step 3 重放，不创建第二个 closure ID。

**测试设计：**

- 正常：首轮、下一轮、普通确认重复请求先命中 fingerprint、旧报告 supersede。
- 异常：缺类型、重复类型、跨学生/岗位/任务、非终态、非 current、红线、安全覆盖、混入 JOB_SKILL。
- 历史：普通复用旧 result 被拒；直接 replacement 部分复用成功；跨历史轮复用失败；三条不变返回旧闭环；replacement 在 reducer 故障恢复后重试返回同一 replacement ID。
- 并发：双确认、确认与 replacement、双 replacement 只有合法序列。
- 故障：JSONL 后 reducer 失败可恢复同一 closure/revision。

**精确验证命令：**

```bash
npx vitest run src/main/domain/__tests__/task-closure-service.test.ts src/main/domain/__tests__/report-reducer.test.ts
npm run typecheck
git diff --check
```

**预期证据：** 每个业务 key 只有一个 CONFIRMED closure；每个 cycle 只有一个 head；普通确认和 replacement 重试返回相同 ID 且事件数不增；非法请求事件数不变。

**回滚方式：** 回滚服务和测试；已经写入 F7 closure 的库只能恢复配套备份，不能物理删除 closure。

**停止条件：** 现有数据无法从 source session 得到唯一 task_code，或教师确认仍需要系统静默猜测教学轮次。

**建议 commit message：** `feat(report): add auditable task closure lifecycle`

### Step 5：实现三类报告 builder、幂等生成与合同修复

**目的与理由：**

统一从冻结来源构造 BASE、JOB_SKILL、SAFETY 快照，并在写事件前完成合同校验、canonical hash 和幂等判断。

**前置状态：** task closure 与报告 event reducer 可用。

**完成状态：** 三类合法来源生成合同有效快照；无效旧 JOB 快照可 CONTRACT_REPAIR；失败进入异常中心且来源结果保留。

**不得改变：** F6 分数、等级、模块画像计算；历史报告内容。

**改动文件及职责：**

- `src/main/domain/report-builders.ts`（新增）：BASE/JOB/SAFETY builder 和真实来源元数据装配。
- `src/main/domain/report-service.ts`（新增）：generate、idempotency、revision、repair、error log 和 reducer 编排。
- `src/main/domain/report-errors.ts`（新增）：报告错误码 seed/写入，敏感字段脱敏。
- `src/main/ipc/handlers/job-skill-report.ts`：保留兼容 wrapper，但生成核心改为调用统一 service，不再自行 INSERT。
- `src/main/domain/__tests__/report-builders.test.ts`（新增）：三类内容合同和解释边界。
- `src/main/domain/__tests__/report-generation.test.ts`（新增）：幂等、revision、repair、失败和性能。
- `src/main/ipc/handlers/__tests__/job-skill-report.test.ts`：从旧宽松断言升级到完整合同和真实元数据断言。

**跨文件登记项：**

- [ ] BASE 生成只接收 task_closure_id；JOB 只接收 result_id；SAFETY 只接收 incident_id。
- [ ] BASE 三类 typed snapshot 并列，不做平均、加总或综合等级。
- [ ] JOB 包含三个缺失区块、M1-M6、观察完成度和 `MVP_DEMO_PROFILE_ONLY`。
- [ ] sitting、策略、题库批次、题目版本、素材 hash、评分器/content/scoring 版本均从实际来源读取。
- [ ] training-only 与 NO_BOUND_SESSION 安全报告不要求或伪造 assessment 元数据。
- [ ] SAFETY 的 `pre_redline_records` 只读取 `safety_incident_binding` 指向的会话，且记录持久化时间必须严格 `< incident.occurred_at`；同时间、事后和未绑定会话记录全部排除。
- [ ] 红线前记录按 `persisted_at ASC, record_type ASC, record_id ASC` 稳定排序，事件 payload 固化最终选择，不在 replay 时重查。
- [ ] Pilot/未完成/JOB 的 placement disabled 由 builder 和 validator 双重强制。
- [ ] generation key 包含 lineage/source/schema/builder/reason/repair ID 的 canonical 对象。
- [ ] 只有同 key 且现有内容通过当前 validator 才返回旧 report ID。

**核心设计与伪代码：**

```text
generate(input):
  resolve business key -> enter queue -> reread source/current/status
  for SAFETY: resolve exact bindings and select only persisted_at < occurred_at
  build typed source snapshot and final report content
  validate content and source_result_ids
  compute lineage_key/source_set_hash/content_hash/generation_key
  if matching VALID report exists: return it
  if same source report is invalid: reason=CONTRACT_REPAIR, repair_of=old
  revision = max(lineage revision) + 1
  append REPORT_GENERATED(v2, complete content + superseded IDs)
  reducer inserts report and supersedes old rows atomically
```

每个 scope 使用显式 `report_builder_version` 常量；改变生成语义时递增。模块名称可以是稳定显示映射，但阈值、训练链接触发和 Pilot 标志必须从冻结策略/批准规则读取。

**数据、事务与失败恢复：** builder 在事件 append 前完成所有 DB 读取和校验；append 前再次检查 source current/incident/closure 水位。安全记录必须按 binding 归属和严格时间上界在同一读快照中选择。失败只写 `error_event_log`，不创建 FAILED 假报告。恢复只使用事件 payload，不回查 current 来源重算内容。

**测试设计：**

- BASE：三快照一致、模块兜底、崩溃记录、Pilot、历史 current 变化后内容不变。
- JOB：完整区块、实际 sitting/version、观察缺失非 0、M2 真链接、其他模块无链接、禁止就业结论。
- SAFETY：assessment、training、mixed、no-bound、CONFIRMED、合规 RESOLVED、VOIDED/PENDING 拒绝；同一夹具混入绑定会话红线前、恰好同时间、红线后及其他未绑定会话记录，只允许严格早于且属于 binding 的记录按稳定顺序进入快照。
- 幂等：相同 generation key 返回同 ID；新 source 新 revision；invalid legacy 生成 CONTRACT_REPAIR。
- 安全：红线来源 FULL_REPORT 在 service 和 DB 均拒绝。
- 性能：内存完整夹具生成小于 3 秒并记录实际耗时。

**精确验证命令：**

```bash
npx vitest run src/main/domain/__tests__/report-builders.test.ts src/main/domain/__tests__/report-generation.test.ts src/main/ipc/handlers/__tests__/job-skill-report.test.ts
npm run typecheck
git diff --check
```

**预期证据：** 三个 schema validator 全通过；重复生成 report/event 数不增加；错误路径只有 error_event 行。

**回滚方式：** 恢复旧 wrapper 并删除新增 domain 文件；有 F7 report 事件的测试库随临时目录删除，正式库使用备份恢复。

**停止条件：** 任一必填版本只能通过常量伪造，或 safety binding 无法确定红线前记录边界。

**建议 commit message：** `feat(report): build versioned report snapshots`

### Step 6：接入 JOB 自动生成、安全生命周期和跨命令并发

**目的与理由：**

让已有评分完成和安全确认路径调用统一生成服务，并确保 safety 修正、报告生成和导出不会绕开同一协调器。

**前置状态：** Step 5 统一 service 已通过定向测试。

**完成状态：** JOB 结果后自动尝试报告；安全确认后自动尝试安全报告；失败可重试；void/duplicate 各由自身决定性事件、factual correction 由单一复合 replacement 事件同步推进 incident 和旧报告状态。

**不得改变：** 安全先熔断后归因、TEACHER/ADMIN 终态权限、结果已成功时不因报告失败回滚结果。

**改动文件及职责：**

- `src/main/ipc/handlers/job-skill-result.ts`：提交结果后调用统一生成并记录失败，不再只 console.error。
- `src/main/ipc/handlers/job-skill-scoring.ts`、`src/main/ipc/handlers/observation.ts`：最终结算和自动报告进入 JOB queue。
- `src/main/ipc/handlers/safety.ts`：确认后自动生成；void payload 固化 archived/superseded report IDs；事实修正不再顺序写 CREATED/REPLACED/VOIDED，而只构造一个完整 replacement event intent。
- `src/main/ipc/handlers/assessment.ts`、`src/main/ipc/handlers/training.ts`：红线创建路径进入 SAFETY queue；写 gate 阻断待恢复后的新结果/安全变更。
- `src/main/ipc/handlers/operation-scoring.ts`：结果写入前检查 F7 写 gate。
- `src/main/ipc/handlers/__tests__/report-integration.test.ts`（新增）：JOB、安全和异常中心集成。
- `src/main/ipc/handlers/__tests__/safety.test.ts`、`job-skill-result.test.ts`：扩展 payload、权限和历史状态断言。

**跨文件登记项：**

- [ ] JOB 结果事务先提交，自动报告失败不删除 result，且只产生一个可重试异常。
- [ ] safety confirm 事实先提交，自动报告失败不回退 CONFIRMED。
- [ ] CONFIRMED -> RESOLVED 后仍可按确认事实重试；VOIDED 不可重试。
- [ ] FALSE_TRIGGER/NON_SAFETY_EVENT => ARCHIVED；FACTUAL_CORRECTION/DUPLICATE => SUPERSEDED。
- [ ] safety 决定性事件 payload 携带目标 report IDs，replay 不按当前库重新选择。
- [ ] `SAFETY_INCIDENT_REPLACED_FOR_FACTUAL_CORRECTION` schema v2 payload 携带 replacement 的完整创建字段、root/old/new incident ID、旧状态/目标状态、correction reason、操作者/时间和 superseded report IDs。
- [ ] 事实修正首次 mutation 只 append 上述一个事件；其 reducer 在同一 SQLite 事务中插入 replacement、把旧 incident 置为 VOIDED/FACTUAL_CORRECTION、链接双向关系并 supersede 报告。
- [ ] schema v1 历史 CREATED -> REPLACED -> VOIDED 前缀仍由 Step 2 legacy bridge 按旧语义恢复；新命令不得继续产生该多事件序列。
- [ ] assessment/training redline、safety mutation 和 safety report 使用同一业务 key。
- [ ] STUDENT/TEACHER/ADMIN 原有安全权限矩阵不被报告集成放宽。

**核心设计与伪代码：**

```text
finish JOB result transaction
  -> coordinator.run(JOB key, generate)
  -> on generation failure: log REPORT_GENERATION_FAILED, return result success

confirm safety transaction
  -> commit SAFETY_INCIDENT_DETAIL_CONFIRMED
  -> same queue invokes safety generate
  -> on failure: incident remains confirmed, candidate becomes retryable

void/correct/merge
  -> queue + reread incident/report states
  -> void/duplicate build one void event
  -> factual correction builds one composite replacement event with complete new incident
  -> one event reducer applies all incident/report side effects in one transaction
```

**数据、事务与失败恢复：** 自动生成与来源事实是两个清晰事务，避免报告失败回滚已完成评分或已确认安全事实；每个 mutation 事务由恰好一个 schema v2 决定性事件恢复。事实修正 append 成功但 reducer 失败时，旧 incident、replacement 和报告副作用由同一事件重放，不能出现可见的半个修正。

**测试设计：**

- JOB：自动成功、builder/INSERT 故障、重试、并发自动/手工生成。
- Safety：无 binding、training-only、mixed、确认失败、生成失败后 RESOLVED 重试、VOIDED 阻断。
- 修正：四类 void reason 的报告状态、root lineage、旧内容不变、重复 replay；事实修正断言首次只写一个事件，分别在 append 后、projection 后、incident INSERT 后、旧 incident UPDATE 后和报告 UPDATE 后故障，重启均得到同一 replacement ID 及全有或全无的完整状态。
- 旧版升级：构造 schema v1 CREATED/REPLACED/VOIDED 在每个 append 边界截断的 JSONL；完整三联原子恢复后迁移，第 1 或第 1-2 个前缀以 `AMBIGUOUS_LEGACY_EVENT_PREFIX / STARTUP_RECOVERY_REQUIRED` 失败关闭，绝不补造事件或生成第二个 replacement。
- 权限：STUDENT/ADMIN 不生成；TEACHER 不终结 safety；ADMIN 不获得 report API。
- 竞态：生成与 void/correction 只形成一种可回放顺序。

**精确验证命令：**

```bash
npx vitest run src/main/ipc/handlers/__tests__/report-integration.test.ts src/main/ipc/handlers/__tests__/safety.test.ts src/main/ipc/handlers/__tests__/job-skill-result.test.ts
npm run typecheck
git diff --check
```

**预期证据：** 来源事实成功而报告失败时 result/incident 保留；异常中心可查；重试只有一个活动报告；schema v2 事实修正只有一个事件且任一 reducer 故障点恢复后 incident/report 状态完整唯一。

**回滚方式：** 恢复调用点和 payload 扩展；已产生扩展 safety 事件的库必须恢复成对备份。

**停止条件：** 自动生成失败仍会回滚来源事实，任一 safety mutation 可绕过协调器写事件，或事实修正仍依赖多个 schema v2 JSONL append 才能完成。

**建议 commit message：** `feat(report): integrate job and safety report lifecycles`

### Step 7：开放教师报告读取、闭环和生命周期 IPC

**目的与理由：**

提供页面所需的稳定主进程 API，并把权限、参数、状态和合同校验留在可信边界内。

**前置状态：** 三类报告服务和联动路径稳定。

**完成状态：** `list/get/listGenerationCandidates/confirmTaskClosure/replaceTaskClosure/generate/confirmPlacementReview/lock` 完整接线；只有 ACTIVE TEACHER 可调用且无信息泄露。

**不得改变：** renderer 不直接访问 DB/Node；ADMIN 不因异常中心权限获得报告内容。

**改动文件及职责：**

- `src/main/ipc/handlers/reports.ts`（新增）：纯函数入口、查询、trusted wrapper、错误映射和 handler 注册。
- `src/shared/types/report.ts`：补齐实际 DTO 和状态 capability 字段。
- `src/shared/report-presentation.ts`（新增）：把已校验快照和生命周期元数据投影为带稳定字段 ID、scope 分支和可见性分类的纯结构化 presentation document；不读取 DB、DOM 或 Node API。
- `src/shared/types/ipc-api.ts`：增加 reports API（本步暂不暴露 export）。
- `src/preload/index.ts`：增加对应白名单。
- `src/main/ipc/index.ts`：注册 report handlers。
- `src/shared/__tests__/report-presentation.test.ts`（新增）：三类 presentation 稳定字段 ID、分支优先级和敏感度分类。
- `src/main/ipc/handlers/__tests__/reports.test.ts`（新增）：读、写、权限、输入和状态矩阵。

**跨文件登记项：**

- [ ] 每个 IPC 使用 `resolveTrustedAuthSessionCaller`，忽略 renderer 伪造的 caller。
- [ ] 业务层再次要求 caller 为 ACTIVE TEACHER；STUDENT/ADMIN 均统一 FORBIDDEN。
- [ ] FORBIDDEN 不返回标题、学生名、内容、路径或候选数量。
- [ ] list 排序固定 `generated_at DESC, report_id DESC`，筛选参数有上限和日期校验。
- [ ] get 重新执行运行时合同校验；无效内容返回受控 repair 状态，不把 raw unknown JSON 给页面。
- [ ] get 使用 `buildReportPresentation` 返回结构化 document；页面不再维护第二套 scope 字段映射，HTML 导出也只能消费同一投影。
- [ ] presentation node 使用代码定义的敏感度/导出策略，不接受报告 JSON 自报“可导出”；真实姓名、监护人信息、异常技术细节和教师自由备注只能是 `PAGE_ONLY` 或完全不进入模型。
- [ ] lifecycle capability 由主进程根据状态、合同和 placement 计算，页面按钮不是授权依据。
- [ ] placement review 事件绑定 canonical `placement_advice_hash`，重复确认幂等且不能换人。
- [ ] lock 使用 content hash/status 条件更新，重复锁定幂等。

**核心设计与伪代码：**

```text
trusted(event, params):
  session = resolveTrustedAuthSessionCaller(sender.id, params)
  if missing or role != TEACHER => FORBIDDEN with no payload
  validate exact input shape
  call report service/query
  map known domain/constraint errors to stable code

get report:
  parse persisted report_content_json
  presentation = buildReportPresentation(validated content, lifecycle metadata)
  return typed detail + presentation; never return raw unknown JSON
```

候选返回显式联合：BASE 待选三类结果、BASE 已确认待生成 closure、JOB 待生成/修复、SAFETY 等待确认/可生成/可重试。候选只展示来源事实，不自动替教师确认同轮关系。

**数据、事务与失败恢复：** list/get 纯读；生命周期写操作全部经过 Step 3 queue/reducer。合同无效读取可写去重后的 error_event，但不得修改报告内容。

**测试设计：**

- 读取：筛选、排序、分页、历史状态、REPAIR_REQUIRED、detail snapshot 不重算；三类合法快照映射到稳定 presentation field IDs。
- 权限：ACTIVE/DISABLED TEACHER、STUDENT、ADMIN、伪造 caller、缺失 auth session。
- 输入：generate 判别联合的多余字段、无效日期、超限 limit、空 ID。
- 生命周期：review/lock 正常、重复、非法状态、placement false 不要求 review、contract invalid 阻断。
- 信息泄露：FORBIDDEN 响应只含 errorCode。

**精确验证命令：**

```bash
npx vitest run src/shared/__tests__/report-presentation.test.ts src/main/ipc/handlers/__tests__/reports.test.ts src/main/ipc/handlers/__tests__/report-integration.test.ts
npm run typecheck
git diff --check
```

**预期证据：** 八个通道 handler/type/preload/注册一致；权限负向请求行数和事件数均不变。

**回滚方式：** 删除 handler 和三处注册；保留数据库快照，不删除历史报告。

**停止条件：** 任何页面所需字段只能由 renderer 直查 SQLite 获得，或 FORBIDDEN 路径会先查询并泄露内容。

**建议 commit message：** `feat(report): expose teacher report IPC lifecycle`

### Step 8：实现默认脱敏、自包含 HTML 导出

**目的与理由：**

在主进程完成安全渲染、文件写入、hash、asset 审计和导出事件，并让 HTML 与详情严格消费 Step 7 的同一结构化 presentation document。

**前置状态：** Step 7 detail/lifecycle capability 稳定。

**完成状态：** 合法活动报告可导出 HTML；取消不写事件；失败不改快照；重复导出保留独立 asset；锁定报告导出后仍 LOCKED。

**不得改变：** 不增加 PDF/JSON 导出，不暴露任意文件写 API，不导出真实姓名、监护人信息、异常技术细节或教师自由备注。

**改动文件及职责：**

- `src/shared/report-presentation.ts`：增加固定 `EXPORT_FIELD_ALLOWLIST` 和 page/export projection；两者保持相同 section/field ID，不复制 scope 映射。
- `src/main/domain/report-html.ts`（新增）：共享 presentation document 的 export projection 到无脚本 HTML 的纯渲染器和上下文转义，不直接遍历 `report_content_json`。
- `src/main/domain/report-export.ts`（新增）：prepare、临时写入、hash、完成、清理/隔离和 asset 元数据。
- `src/main/ipc/handlers/reports.ts`：增加 `reports:export`，注入 save dialog 便于测试。
- `src/shared/types/report.ts`、`src/shared/types/ipc-api.ts`：增加 export 输入/结果。
- `src/preload/index.ts`：白名单增加 export。
- `src/main/domain/__tests__/report-html.test.ts`（新增）：CSP、转义、无外部请求和内容一致性。
- `src/shared/__tests__/report-presentation.test.ts`（新增）：三 scope 黄金字段、page/export 同源、敏感字段分类和 allowlist 测试。
- `src/main/ipc/handlers/__tests__/report-export.test.ts`（新增）：状态、asset、hash、取消、失败和竞态。

**跨文件登记项：**

- [ ] 动态文本和属性分别转义，不拼接未审核 HTML。
- [ ] 模板无 script/form/iframe/外部 URL，CSP 与 PRD 完全一致。
- [ ] 学生显示名固定 `学生-<student_id 末四位>`。
- [ ] 页面 document 与导出 document 来自同一次 `buildReportPresentation` 语义；HTML 只按代码内静态 `EXPORT_FIELD_ALLOWLIST` 过滤，不能自行读取遗漏字段或按标题字符串猜测敏感性。
- [ ] 三类黄金夹具逐个比较 section/field ID 和文本；所有 `PAGE_AND_EXPORT` 节点都进入 HTML，所有 `PAGE_ONLY`/未建模敏感字段都不进入 HTML。
- [ ] prepare 固化 report ID/content hash/status；完成阶段重入同 lineage queue。
- [ ] placement enabled 未复核、REPAIR_REQUIRED、SUPERSEDED/ARCHIVED/FAILED 均由 service 和 DB 阻断。
- [ ] 文件字节 hash 与 event、asset、task_report 最后导出元数据一致。
- [ ] 每次成功导出创建新 REPORT_FILE asset，不覆盖历史 asset。
- [ ] 用户取消不写 error/event；真实失败写 REPORT_EXPORT_FAILED。

**核心设计与伪代码：**

```text
prepare under queue:
  parse persisted snapshot -> build shared presentation document
  filter by static export allowlist + replace student identity with pseudonym
  render immutable HTML bytes
  freeze token(report_id, content_hash, status, presentation_hash, rendered bytes)
showSaveDialog -> canceled => CANCELED
write bytes to unique temp file -> hash/size
reenter queue:
  reread report + contract + content_hash + status
  stale => delete/quarantine temp, REPORT_STATE_CONFLICT
  rename temp to final path
  append REPORT_EXPORTED(v2 with asset/hash/size/status before+after)
  reducer inserts asset and updates report atomically
on pre-event failure => cleanup or quarantine + error log
on event append/reducer failure => write gate; recovery completes same event
```

**数据、事务与失败恢复：** presentation 是纯投影，不读取 current result。dialog 等待和文件 IO 不持有 queue；完成阶段必须重验 content/presentation hash。正式导出只在事件已可恢复后对页面返回 success。

**测试设计：**

- 内容：三 scope、复核元数据、Pilot/JOB 免责声明、历史快照一致；同一快照的页面与 HTML 逐 field ID 对照，不允许两套 mapper 漂移。
- 注入：`<script>`、事件属性、`javascript:`、HTML 标签、引号和路径字符均只显示文本。
- 脱敏：真实姓名、监护人信息、异常技术细节和教师自由备注即使存在于页面上下文或恶意伪造 JSON 中也不出现在 export document/HTML。
- 文件：CSP、无脚本/外部请求、hash/size/mime、独立 asset、重复导出。
- 状态：GENERATED/EXPORTED/LOCKED、placement review、contract invalid、历史状态。
- 故障：取消、写失败、rename 失败、event append 失败、reducer 失败、orphan 隔离失败。
- 并发：prepare 后 report supersede，完成必须冲突且不产生正式 asset/event。

**精确验证命令：**

```bash
npx vitest run src/shared/__tests__/report-presentation.test.ts src/main/domain/__tests__/report-html.test.ts src/main/ipc/handlers/__tests__/report-export.test.ts
npm run typecheck
git diff --check
```

**预期证据：** 页面/HTML 使用同一组稳定字段 ID 且敏感字段不在 export allowlist；恶意夹具无可执行节点；文件 hash 三处相同；所有失败路径报告内容不变。

**回滚方式：** 删除导出通道和服务；保留已有 REPORT_FILE asset 审计，不删除用户已导出文件。

**停止条件：** HTML 仍需绕过共享 presentation 直接解释 raw report JSON，无法证明敏感字段 allowlist，无法区分事件是否已 append 就删除正式文件，或导出需要 renderer/任意路径写权限。

**建议 commit message：** `feat(report): add audited self-contained HTML export`

### Step 9：实现教师报告列表、详情与操作界面

**目的与理由：**

把持久化报告闭环作为教师工作台的实际入口，并在桌面和小屏下提供稳定、可恢复的操作状态。

**前置状态：** 九个 reports IPC 能力已完成，字段和 error code 稳定。

**完成状态：** `/teacher/reports` 和 `/teacher/reports/:reportId` 可用；三类报告共用外壳并直接渲染 shared presentation sections；页面无第二套字段映射、无隐式生成、无 raw HTML、无前端持久化。

**不得改变：** 学生和管理员路由；现有训练/测评入口；报告快照事实。

**改动文件及职责：**

- `src/renderer/src/stores/report.ts`（新增）：Pinia 内存状态、筛选、候选和操作后重读，不持久化。
- `src/renderer/src/views/teacher/ReportListView.vue`（新增）：筛选、已有快照、候选、失败重试和稳定页面状态。
- `src/renderer/src/views/teacher/ReportDetailView.vue`（新增）：报告外壳、历史/合同状态、生命周期操作和二次确认。
- `src/renderer/src/components/report/ReportSectionList.vue`（新增）：只按 shared presentation section/field 节点渲染文本、值、列表和受控内部 action，不解释 raw report JSON。
- `src/renderer/src/components/report/report-page-state.ts`（新增）：加载、错误、capability 和操作状态映射，不复制 scope 内容字段。
- `src/renderer/src/components/report/__tests__/report-page-state.test.ts`（新增）：历史、repair、capability、M2 action 和错误状态测试。
- `src/main/window-config.ts`（新增）：纯函数定义生产窗口下限和仅 `SVETS_E2E=1` 时可用的 allowlisted content viewport，不从 renderer 接受尺寸参数。
- `src/main/__tests__/window-config.test.ts`（新增）：生产下限、测试 allowlist、非法尺寸和 content-size 语义测试。
- `src/main/index.ts`：启用 `useContentSize`，把生产最小尺寸调整为可容纳 1280x720 的 `1024x640`；E2E 模式允许 `1366x768 / 1280x720 / 375x812` 三个固定 content viewport。
- `src/renderer/src/router/index.ts`：增加两条 TEACHER 子路由。
- `src/renderer/src/views/teacher/TeacherLayout.vue`：增加报告导航。
- `src/renderer/src/views/teacher/TeacherHomeView.vue`：启用现有任务报告入口并跳转列表。

**跨文件登记项：**

- [ ] route guard 只改善体验，所有操作仍依赖 IPC 权限。
- [ ] 详情优先级固定 SAFETY -> JOB_SKILL -> BASE_ABILITY。
- [ ] renderer 只消费 `reports:get` 返回的 `ReportPresentationDocument`；scope 字段到 section/field 的映射只存在于 `src/shared/report-presentation.ts`。
- [ ] `ReportSectionList.vue` 对 shared nodes 做通用渲染；M2 训练使用受控内部 action ID，任意 URL/HTML 字符串都不能由报告内容直接变成链接或节点。
- [ ] Vue 只用文本插值/受控属性，不使用 `v-html`、`innerHTML` 或动态模板源码。
- [ ] list/get 不触发 generate；生成只来自明确按钮和二次确认。
- [ ] 加载、空、forbidden、blocked、repair、retryable error、success 都有稳定页面内状态。
- [ ] 历史报告可见但只读；按钮尺寸和状态文案变化不引发布局跳动。
- [ ] M2 只链接现有训练入口；其他模块只显示文案。
- [ ] Pilot/JOB/安全免责声明不可由页面参数关闭。
- [ ] 生产窗口可实际达到 1280x720；375px 只通过主进程测试标志和固定 allowlist 放开，不建立 renderer 任意改窗能力。
- [ ] 每张响应式截图前读取 `window.innerWidth / window.innerHeight` 并断言目标 content viewport，尺寸被窗口下限钳制时测试必须失败。

**核心设计与伪代码：**

```text
list mount -> Promise.all(list reports, list candidates)
filter change -> explicit reload with latest request token
mutation -> disable only affected action -> call IPC -> reread list/detail
detail mount -> reports:get only
detail success -> render returned presentation sections without remapping report fields
contract invalid -> controlled error + repair action, no partial guessed rendering
```

**数据、事务与失败恢复：** store 只缓存当前页面会话；刷新和重启均从主进程投影恢复。并发冲突收到 `REPORT_STATE_CONFLICT` 后重读，不乐观覆盖状态。

**测试设计：**

- 单元：page state、capability、M2 受控 action、历史/repair 文案；shared 黄金测试负责分支优先级、缺观察及字段映射。
- 路由：TEACHER 可达；STUDENT/ADMIN deep link 被角色首页接管。
- UI 状态：加载、空、无权限、失败、重试、锁定确认、导出取消。
- 内容安全：恶意文本只进入 text node；代码扫描禁止 `v-html/innerHTML`。
- 响应式：1280x720、1366x768、375px；长 ID、长中文、状态切换无溢出和遮挡。
- 窗口配置：生产最小尺寸、三个 E2E allowlisted viewport、未启用测试标志时忽略覆盖、非法值失败关闭。

**精确验证命令：**

```bash
npx vitest run src/shared/__tests__/report-presentation.test.ts src/renderer/src/components/report/__tests__/report-page-state.test.ts src/main/__tests__/window-config.test.ts
npm run typecheck
npm run build
git diff --check
```

**预期证据：** 路由 chunk 构建成功；shared presentation、页面状态和窗口配置测试通过；renderer 代码不存在第二套 scope 字段映射；真实 `innerWidth/innerHeight` 三尺寸截图待 Step 10 归档。

**回滚方式：** 删除报告 store/view/component 和路由/导航入口；后端报告仍可审计，不删除数据。

**停止条件：** 页面需要回查 current result 或重新解释 raw report JSON 才能显示必填事实，或任一宽度出现文字遮挡/操作不可达。

**建议 commit message：** `feat(report): add teacher report workspace`

### Step 10：完成独立审查、全量门禁和真实 Electron 见证

**目的与理由：**

把 R3 的自动、迁移、权限、恢复、内容安全和人工体验证据集中收口，只有证据齐全才进入 `/vibe-accept` 通过状态。

**前置状态：** Step 1-9 各自定向验收均 PASS。

**完成状态：** 全量门禁通过；真实 Electron 在隔离临时 userData 完成教师报告流程和三宽度截图；独立 Reviewer 无 P0/P1；实现记录和文档索引同步。

**不得改变：** 不使用真实运行 DB，不自动 commit/push/merge，不把 NOT_RUN 写成 PASS。

**改动文件及职责：**

- `scripts/e2e/report-flow.mjs`（新增）：用 `sqlite3` CLI 和临时 userData 构造合法 fixture，分别以 allowlisted content viewport 启动真实 Electron，断言实际 inner size 后完成列表、详情、权限和导出见证。
- `package.json`：增加 `e2e:report` 命令。
- `doc/features/report-page-framework-impl.md`：逐步记录实际证据、偏差和 Reviewer 结论。
- `doc/features/pilot-r0-foundation-development-plan-2026-07-22.md`、`.continue-here.md`：仅在全部通过后更新 F7 状态和下一原子动作。
- `doc/index.md`：通过自动索引脚本同步新增文档。

**跨文件登记项：**

- [x] 每一步实际 diff 已读，`git diff --check` 已执行。
- [x] Schema fresh/upgrade/rollback/integrity 证据已归档。
- [x] legacy JSONL-only pre-reconcile、截断旧多事件前缀、权限、并发、schema v2 单事件恢复、内容注入和导出 hash 均有自动测试。
- [x] 页面与 HTML 的 shared presentation/静态 export allowlist 黄金对照通过，敏感字段负向夹具未进入导出。
- [x] 真实 Electron 只使用临时 userData，结束后不污染正式配置。
- [x] 1366x768、1280x720、375x812 的真实 content viewport 均先通过 `window.innerWidth/innerHeight` 断言，再记录截图和操作观察。
- [x] Reviewer 独立读取 PRD、实现、diff 和测试输出；P0/P1 清零。
- [x] 未执行的人工项标为 NOT_RUN 或 BLOCKED。

**核心设计与伪代码：**

```text
mkdtemp -> sql.js execute authoritative schema -> seed only test fixture
for viewport in 1366x768, 1280x720, 375x812:
  launch built Electron with isolated --user-data-dir + SVETS_E2E=1
  assert window.innerWidth/innerHeight exactly matches viewport
  login TEACHER -> list -> open persisted report -> capture screenshot
on desktop viewport: exercise lifecycle/export and STUDENT/ADMIN rejection
close app -> relaunch same temp userData -> verify same report_id/content
```

**数据、事务与失败恢复：** E2E fixture 和导出目标均位于临时目录。测试失败保留临时路径用于诊断，人工清理前先记录；不得指向默认 userData。

**测试设计：** 见第 6、7 节矩阵。Reviewer 使用 `/vibe-review code <base>...<head>`；最终使用 `/vibe-accept feature F7`。

**精确验证命令：**

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run db:f7:verify
npm run docs:index:update
npm run docs:index:check
npm run e2e:report
git diff --check
```

**预期证据：** 所有自动命令退出码 0；Electron 无 pageerror；截图、导出文件和 DB/event/hash 对照一致；Reviewer 为 PASS。

**实际证据（2026-07-26）：**

- `npm run typecheck`：PASS。
- `npm run lint`：PASS_WITH_WARNINGS，0 error，661 条既有 Vue 格式 warning。
- `npm test`：PASS，104 files / 1026 tests。
- `npm run build`：PASS。
- `npm run db:f7:verify`：PASS，4 files / 21 tests。
- `npm run e2e:report`：PASS；最终隔离目录 `/tmp/svets-report-e2e-QaK2nr`，数据库 `/tmp/svets-report-e2e-QaK2nr/userData/data/xc-career-guide.db`，截图目录 `/tmp/svets-report-e2e-QaK2nr/screenshots`，导出目录 `/tmp/svets-report-e2e-QaK2nr/exports`。
- Electron 见证：`1366x768`、`1280x720`、`375x812` 均先断言 `window.innerWidth/innerHeight`；教师登录后读取持久化报告列表与详情；详情含注入字符串但未执行；列表/详情读取未新增报告；1280x720 下完成锁定和脱敏 HTML 导出；ADMIN/STUDENT 深链被路由带回角色首页且直接 `reports:list` 返回 `FORBIDDEN`；重启后同一临时 userData 仍能读取同一 `report_id`、`LOCKED` 状态和 `lastExportedAt`。
- DB/event 对照：隔离库中 `e2e-safety-report-001` 状态为 `LOCKED`，`REPORT_GENERATED -> REPORT_LOCKED -> REPORT_EXPORTED` 三条 `TASK_REPORT` 事件均 `applied_to_snapshot = 1`，导出后 `file_path/file_hash` 非空。
- HTML 安全对照：导出文件包含 CSP，未包含 `<script` 或原始恶意描述。
- 偏差记录：原 Step 10 伪代码写 `sql.js`，实际采用 `sqlite3` CLI 写入临时隔离库，原因是本地 `better-sqlite3` 为 Electron ABI、Node 侧不可加载；脚本已增加 `userData/export/db` realpath 均落在 `mkdtemp` 根目录内的 preflight。

**回滚方式：** 测试脚本和文档可独立回滚；业务实现回滚遵循各步策略，Schema 已升级时恢复成对备份。

**停止条件：** 任一 P0、未关闭 P1、迁移/恢复失败、权限泄露、普通报告绕过红线、恶意文本可执行或必需人工见证未运行。

**建议 commit message：** `test(report): close F7 acceptance evidence`

## 6. 全量回归矩阵

| 验收域 | 自动证据 | 关键错误实现必须被杀死 |
|---|---|---|
| 列表/权限/页面状态 | `reports.test.ts`、shared presentation/page-state tests、Electron | ADMIN/STUDENT 可读、FORBIDDEN 泄露、打开详情隐式生成、renderer 重建第二套字段映射 |
| 窗口/响应式 | `window-config.test.ts`、Electron inner-size assertions | 最小窗口钳制目标尺寸但仍保存截图、renderer 可传任意窗口尺寸、375px 内容遮挡 |
| 闭环/历史 | `task-closure-service.test.ts`、schema test | 最新三条静默拼接、幂等前先拒绝已使用 result、历史 result 复用、旧水位补生成、binding 原地改 |
| 生成/幂等/repair | `report-generation.test.ts` | 粗粒度 source 幂等、无效旧快照永久复用、双活动 lineage |
| BASE 内容 | `report-builders.test.ts` | 三类结果混算、snapshot 与 source ID 不一致、Pilot 建议误启用 |
| JOB 内容 | builder + existing JOB tests | 缺三个必填区块、坐次/版本硬编码、观察缺失显示 0、虚假训练链接 |
| SAFETY | builder + integration + safety tests | PENDING/VOIDED 可生成、普通分覆盖安全、无 binding 被错误阻断、同时间/事后/未绑定记录混入红线前快照 |
| 生命周期 | reducer + reports tests | 非法状态跳转、重复复核改 actor、LOCKED 导出变 EXPORTED |
| 恢复 | legacy bridge + recovery tests | migration 先于 v1 JSONL-only 恢复、截断旧修正前缀被补造、projection 存在未 applied 被跳过、重放重复 asset/report、副作用按 current 重算 |
| 并发 | coordinator/closure/generation/export tests | 双 closure、双活动报告、stale export 成功、schema v2 factual correction 多 append、void 与生成不可回放 |
| HTML 安全 | shared presentation + report-html/export tests | 页面/导出 mapper 漂移、敏感字段绕过 allowlist、script/event/javascript 注入、外部请求、缺 CSP、hash 不一致 |
| Schema/migration | schema + legacy bridge + migration + verify script | 未 reconcile 旧日志即 backfill、双活动旧数据静默选最新、伪造 metadata、迁移失败仍记 ledger |
| 双轨回归 | F6/结果/JOB 全量测试 | 修改评分公式、BASE/JOB 混算、operation/ability scope 串轨 |
| 多设备回归 | assignment + assessment/training tests | F7 改变 business/grant/assignment 三方一致性或 delivery phase |

## 7. 人工验收矩阵

| 场景 | 环境/角色 | 操作 | 预期 | 状态 |
|---|---|---|---|---|
| 报告列表 | 1280x720 / TEACHER | 筛选、查看历史、候选和失败重试 | 无遮挡、稳定排序、状态不跳动 | `PASS_E2E_PARTIAL`：持久化列表、历史报告、稳定状态已见证；筛选和失败重试仍 `NOT_RUN` |
| 报告详情 | 1366x768 / TEACHER | 依次打开 BASE/JOB/SAFETY | 共用外壳且分支正确，刷新不新增报告 | `PASS_E2E_PARTIAL`：SAFETY 详情和不新增报告已见证；BASE/JOB 详情仍 `NOT_RUN` |
| 小屏 | 375x812 content viewport / TEACHER | 列表、详情、确认、锁定、导出 | 实际 `innerWidth = 375`；无横向内容遮挡、按钮可触控、长 ID 可换行 | `PASS_E2E_PARTIAL`：375x812 列表/详情已见证；锁定/导出在 1280x720 见证 |
| 权限 | STUDENT/ADMIN | deep link + 直接 IPC | 跳回角色首页；IPC FORBIDDEN 且无内容 | `PASS_E2E` |
| 闭环确认 | TEACHER | 查看三个来源后确认、再执行 replacement | 来源和时间清楚；修正必须填写原因；历史保留 | `NOT_RUN` |
| 安置复核 | TEACHER | enabled/disabled 两类报告 | enabled 未复核不可导出；disabled 不误阻断 | `NOT_RUN` |
| 锁定 | TEACHER | 二次确认、重复锁定 | 首次写事件；重复幂等；内容不变 | `PASS_E2E_PARTIAL`：首次锁定写事件已见证；重复锁定仍 `NOT_RUN` |
| 导出 | TEACHER | 取消、成功、重复、锁定后导出 | 取消无事件；成功脱敏；每次独立 asset；LOCKED 保持 | `PASS_E2E_PARTIAL`：锁定后成功导出已见证；取消和重复导出仍 `NOT_RUN` |
| 恶意文本 | TEACHER | 打开含注入字符串的详情和 HTML | 仅显示文本，无执行、外部请求或表单 | `PASS_E2E` |
| 重启恢复 | TEACHER | 生成/锁定/导出后重启 | 同 report ID、内容、状态和最后导出 hash | `PASS_E2E` |
| 可访问性 | TEACHER | 键盘、触控、200% 字号和对比度检查 | 焦点可见、顺序合理、文字与命令可辨识 | `NOT_RUN` |

人工状态只在实际执行后更新；截图本身不能替代权限、DB 和 event 对照。

## 8. 残余风险与后续项

- 教师确认 `task_closure` 仍是最脆弱的产品假设。若 Pilot 证明教师不能可靠判断三类结果是否同轮，必须把通用 task-cycle 前移到上游会话创建，不得退回“取最新三条”。
- F7 只保证 schema v2 的闭环/报告/安全联动事件完成标记和重放；全量 JSONL 重建仍属于更广的 M5 startupRecovery 路线。
- SQLite JSON1 是 scope-aware DB guard 的运行前提；fresh、迁移测试和真实 Electron 都必须验证 JSON 函数可用。
- 文件保存对话框、杀毒软件和学校 Windows 路径策略只能通过目标环境见证，自动单测不能完全替代。
- 迁移发现非法 JSON 或双活动 legacy lineage 会失败关闭，需要先制作只读诊断和人工修复方案，不允许在 migration 中猜测。
- `INV-A11Y-001`、`INV-CI-001` 当前仍为 UNVERIFIED；F7 验收只能记录实际本地与人工证据。
- BASE Pilot 继续固定 `PILOT_ONLY` 且 placement disabled；启用正式建议必须通过新的 strategy version 和独立产品批准。

## 9. Reviewer 审查记录

- 审查类型：`IMPL`
- Reviewer：独立 Reviewer（只读 `/vibe-review impl`）
- 审查范围：本计划、来源 PRD、适用不变量、R3 影响域和本计划列出的当前代码文件。
- Round 1 结论：`BLOCKED`（2 P0、3 P1）。
- Round 1 修订：
  - `P0-01`：事实修正改为一个完整 schema v2 决定性事件；增加旧 v1 三联事件完整分组和截断前缀失败关闭测试。
  - `P0-02`：启动顺序改为 legacy migration/reconcile、成对备份、F7 migration、schema v2 reconcile；JSONL-only v1 报告/安全事件进入升级夹具。
  - `P1-01`：binding fingerprint 幂等命中前置于 result 复用、head 和“至少一条变化”校验。
  - `P1-02`：新增 shared presentation document 和静态 export allowlist；页面与 HTML 不再各自映射 raw JSON。
  - `P1-03`：安全红线前记录增加 binding 归属、严格 `< occurred_at`、稳定排序及同时间/事后/外部会话杀错夹具。
- Round 2 结论：`CONDITIONAL_PASS`（Round 1 的 2 P0、3 P1 全部关闭；新增 `P1-NEW-01`）。
- `P1-NEW-01` 修订：Step 9 登记 `window-config.ts`、`src/main/index.ts` 和定向测试；生产窗口允许 1280x720，测试模式只接受三个固定 content viewport；Step 10 在截图前断言真实 `window.innerWidth/innerHeight`。
- Round 3 结论：`PASS`（只读 `/vibe-review code`，范围为 `HEAD` 到当前 Step 10 working tree diff）。上一轮代码审查发现的 `BASE_RESULTS` 隐式生成 P1 已修复：`BASE_RESULTS` 现在只确认闭环并返回 `null`，新增 store 测试断言不调用 `reports.generate`。
- Round 3 P2：E2E fixture 实际使用 `sqlite3` CLI，而 Step 10 伪代码写 `sql.js`。已记录为实现偏差，并补充 realpath preflight，确保 `userData/export/db` 均位于 `mkdtemp` 临时根目录。
- 当前结论：`PASS`。P0/P1 清零；P2 已处置为记录偏差和脚本防护。
- 未审查内容：目标学校 Windows 环境的保存对话框、杀毒软件和路径策略仍需现场见证；本轮仅覆盖本地 Linux/Electron 自动化见证。
