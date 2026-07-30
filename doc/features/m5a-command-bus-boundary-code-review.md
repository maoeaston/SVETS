# M5A Command Bus Boundary 代码独立审查

## 1. 审查对象

- 功能：M4 Step 2B / M5A Command Bus Boundary
- PRD：`doc/features/m5a-command-bus-boundary-prd.md`
- 实施计划：`doc/features/m5a-command-bus-boundary-impl.md`
- 规划基点：`40541c82ef374f28ce300365e0e5cc82423dd99a`
- 风险等级：R3
- 审查日期：2026-07-29
- 审查方式：实现步骤结束后切换到只读 Reviewer 视角，从固定规划基点重新核对生产 diff、静态清单、故障矩阵和隔离运行证据；不把分步验收结论本身作为代码正确性的证据。
- 数据边界：未检查、读取、初始化或修改默认运行数据库；DB 与 Electron 见证只使用 `/tmp` 下显式隔离路径。

## 2. 最终结论

结论：`PASS`

- 未关闭 P0：0
- 未关闭 P1：0
- 未关闭 P2：0
- M5A 最终 `/vibe-accept` 资格：`GRANTED`

Round 1 发现 1 项 P1、2 项 P2。修复后重新扫描生产调用图、重跑精确测试和报告 Electron 流程，未发现新的 P0/P1。完整工程回归仍由独立的最终 `/vibe-accept` 执行，本报告不提前把未在最终轮复跑的检查写成 PASS。

## 3. Round 1 Findings 与关闭证据

### M5A-CODE-P1-01：报告导出发布存在目标覆盖竞态

- 初始问题：导出先以 `existsSync(target)` 检查目标，再使用 POSIX `rename()` 发布临时文件。若另一个进程在两步之间创建目标，`rename()` 可覆盖该文件，违反“命令只清理自己的临时文件，不覆盖既有 artifact”的合同。
- 影响：教师导出报告时可能覆盖不属于当前命令的同名文件；早期 existence check 不能消除 TOCTOU。
- 修复：默认文件端口改为同目录 `linkSync(temp, target)` 原子发布；目标已存在时由文件系统以 `EEXIST` 失败，再 `unlinkSync(temp)`。接口名保留以避免扩大迁移范围，真实语义已在实现注释中明确。
- 代码证据：`src/main/domain/report-export.ts:78-94`。
- 回归证据：新增“初始检查后才创建目标”竞态测试，断言既有目标 bytes 不变、命令临时文件被清理、错误被记录；报告导出精确组 2 files、10/10 tests PASS。
- 状态：`CLOSED`。

### M5A-CODE-P2-01：active/mapping fixture ID 未 fail closed

- 初始问题：生成中的 active capability ID 出现 `ACTIVE-CAP-NaN`，清单验证只检查集合引用，没有验证 ID 格式，错误标识仍可进入 target digest。
- 修复：active、legacy、mapping ID 全部增加正则格式校验，并修复错误 ID；负向测试证明 malformed ID 会使 gate 失败。
- 代码证据：`scripts/lib/m5a-command-boundary-inventory.mjs:637-653`。
- 回归证据：inventory 精确组 9/9 tests PASS；target gate 输出稳定 digest `f97ef382ab9a9678ab20f06310e6906e811cdd765526d69a4fcc11bca6939527`。
- 状态：`CLOSED`。

### M5A-CODE-P2-02：报告 E2E 使用过期的非权威 source fixture

- 初始问题：E2E 只插入 `task_report`，却没有插入报告声明引用的 `safety_incident`；报告内容还使用 Schema 不允许的 `OFFLINE_ASSESSMENT`。新的 target resolver 正确地从 source 聚合解析三元键，因此锁定命令按合同拒绝该伪造 fixture。
- 修复：夹具改为完整的 `SAFETY_INCIDENT_CREATED(v1) → SAFETY_INCIDENT_DETAIL_CONFIRMED(v1) → REPORT_GENERATED(v2)` 事件链，投影、JSONL、incident 与 report 使用相同的 student/job/task，阶段改为 `OFFLINE_SCORING`。
- 代码证据：`scripts/e2e/report-flow.mjs:20-28`、`:195-348`。
- 回归证据：`xvfb-run -a npm run e2e:report` PASS；覆盖 1366×768、1280×720、375×812，教师锁定与脱敏 HTML 导出、管理员/学生越权拒绝、重启恢复；见证根 `/tmp/svets-report-e2e-WKOwT8`。
- 状态：`CLOSED`。

## 4. 关键审查结论

| 审查面 | 状态 | 证据 |
|---|---|---|
| IPC 分类与统一入口 | PASS | target scanner 精确得到 74 channels（28 READ / 46 MUTATION）；handler 无未分类 registration，mutation 由中央 registry/Bus 路由。 |
| writer/capability 闭集 | PASS | 28 direct files、13 roots、215 direct callsites、72 capability callsites均与 active manifest 对账；`MIGRATION_PENDING=0`。76 项均是逐项登记并具 owner/phase/transaction/retry/test evidence 的 `TEST_ONLY` 或 `MIGRATION_INTERNAL` exception，不是迁移 allowlist。 |
| 报告单例与任务闭环 | PASS | production 仅 composition root 构造一个 report coordinator；`TaskClosureService.confirmBaseTaskClosure` 与 `replaceBaseTaskClosure` 两个 callsite 都被反查并继承 correlation。 |
| 无写 preflight | PASS | READ 不取得 mutation capability；actor snapshot、target resolver 和拒绝路径精确测试覆盖 DB/文件/binding 零副作用。 |
| 事件与故障边界 | PASS | 当前调用内 SQLite 回滚与 JSONL 合法前缀边界保持；真实临时 JSONL 第 N 次故障测试没有删除前缀，也没有按 correlation 补齐未发生事件。 |
| 报告文件所有权 | PASS | 原子 no-clobber 发布、临时文件 ownership、append/projection 失败后的最终 artifact 语义都有故障注入测试；未声称文件系统与 SQLite 原子。 |
| M4 安全边界 | PASS | safety target 均由持久化 `student_id + job_code + task_code` 解析；跨 job 隔离、生命周期与权限合同未降级。 |
| 合同范围 | PASS | 相对固定基点的 committed/index/worktree/untracked 四层 scope gate 均为 restricted changes=0；Schema、production migration/backup、shared/preload/renderer 未改变。 |
| 隔离数据验证 | PASS | `db:m5a:isolated:verify` 以同一显式绝对路径完成 sync/verify，schema `0.1.17-multi-device-m4-safety-rekey`、pack `2026.07.22.1`、hash `97368c4788e54c8693ff2daf5aceaea9f679a8f261f38a73d645a0f41c8af85d`；成功后删除临时根。 |

## 5. 已执行审查检查

| 检查 | 状态 | 结果 |
|---|---|---|
| `npm run contract:m5a:command-boundary:check` | PASS | target：74/28/46，pending=0，registered exceptions=76。 |
| `npm run contract:m5a:scope:check -- --base 40541c...` | PASS | committed/index/working-tree/untracked restricted changes 均为 0。 |
| `npm run db:m5a:isolated:verify` | PASS | 显式 `/tmp` DB sync+verify；未解析默认 DB。 |
| inventory/scope/isolated helper tests | PASS | 9/9、9/9、5/5。 |
| report export tests | PASS | 2 files、10/10。 |
| report Electron E2E | PASS | 三视口、锁定、导出、权限、重启恢复全部通过。 |
| `npm run build` | PASS | P1 修复后的 main/preload/renderer 生产构建通过。 |
| 最终全量 `npm test`、typecheck、lint、M4 DB/Electron、docs index | NOT_RUN | 留给随后独立 `/vibe-accept` 统一复跑；不得由定向证据外推。 |

## 6. 残余风险

1. M5A 仍没有 durable idempotency、跨进程 lease/fencing 或命令级 JSONL+SQLite 共同提交；这些是 Step 2C / M5B 的明确范围。
2. hard-link no-clobber 发布依赖目标文件系统支持同目录硬链接；不支持时命令显式失败并保留原目标，不会退回可覆盖目标的 rename。
3. 76 项注册例外必须在 M5B 重基线时重新裁决，不能把 M5A exception manifest 直接当作未来 command log/batch 协议。
4. 本审查不授权修改默认数据库、不授权发布、提交或推送。

## 7. Reviewer 结语

当前实现已满足 M5A PRD 与实施计划的代码审查门槛，Round 1 的 P0/P1/P2 均无未关闭项。只有随后最终 `/vibe-accept` 的全量门禁全部 PASS，才可把里程碑状态更新为 `ACCEPTED_STEP_2B`。
