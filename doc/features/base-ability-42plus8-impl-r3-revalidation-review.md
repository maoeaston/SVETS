# BASE_ABILITY 42+8 实施计划 R3 重审记录

## 审查报告

### 审查结论

`CONDITIONAL_PASS`

Step 1 重验的实际结果为 `PASS`，但实施计划仍有 2 项未关闭 P1。它们修复并由新的独立复审确认前，不得进入 BASE_ABILITY Step 3 或以本记录授权任何 Schema、题目状态、运行库或激活操作。

### 审查范围

- 类型：`IMPL`
- 风险：`R3`
- 审查日期：2026-07-31
- 工件：`doc/features/base-ability-42plus8-pilot-readiness-impl.md`
- 权威资料：`AGENTS.md`、`doc/specs/baseline.yaml`、`src/main/db/schema.sql`、`doc/specs/MVP_PRD_v1.0.9-authoritative.md`、`doc/specs/project-invariants.md`、`doc/ai/vibe-workflow-contract.md`
- 适用不变量：`INV-EVT-001`、`INV-EVT-003`、`INV-EVT-004`、`INV-EVT-005`、`INV-EVT-006`、`INV-SAFE-001` 至 `INV-SAFE-004`、`INV-AUTH-001`、`INV-AUTH-002`、`INV-RES-001`、`INV-RES-002`、`INV-STR-001`、`INV-STR-002`、`INV-IPC-001`、`INV-IPC-002`、`INV-DATA-001` 至 `INV-DATA-003`
- 审查方式：在新上下文中重新读取工件、当前 Schema、基线、交接、生成器和测试，并运行 Step 1 相关命令。未使用独立子 Agent，因此这是非独立自审；R3 不得据此获得完全 `PASS`。
- 未审查内容：未来 Step 3-10 的未实现代码、真实课堂试测、外部审核/签名和真实 Pilot 激活。

### 已执行检查

| 检查 | 状态 | 证据 |
|---|---|---|
| 当前工程基线 | PASS | `doc/specs/baseline.yaml` 明示当前 Schema 为 `v0.1.18-event-batch-v2.2`；`src/main/db/schema.sql:2` 一致。 |
| 当前 Step 2 现场 | PASS | `.continue-here.md` 记录 M5B-15 及 Step 2A/2B/2C 已完成；当前 `HEAD` 为 `5f050d6`。 |
| Step 1 实际验收 | PASS | 定向 13/13 tests、authority/gate build/check、workbook↔SQL 对账、typecheck、lint 和文档索引均有本轮退出码 0 证据。 |
| 计划的前置和副作用登记 | PASS | 计划列出了事件、Schema、IPC/preload、授权、默认库保护、激活与恢复等跨文件登记项；范围仍保持 R3。 |
| 历史 P1-01 重核 | FAIL | 当前实施计划仍将 `v0.1.16` 和 `8fa2a4f` 写为当前基线，并把已交付的 Step 2A/2B/2C 写为未实现。 |
| 历史 P1-02 重核 | FAIL | workbook↔SQL 对账函数存在且本次实际通过，但未接入 `authority:check`、`gate:check` 或独立必跑 script。 |

### P0

无。没有发现会直接写入默认数据库、改变 DRAFT/ACTIVE 状态、破坏安全红线或绕过生产 v2 mutation boundary 的计划性指令。

### P1

#### [P1-01] 实施计划的基线、完成阶段和当前事件不变量未重基线

- 位置：`doc/features/base-ability-42plus8-pilot-readiness-impl.md:13-15`、`:21`、`:102-113`、`:732`、`:749`。
- 证据：计划仍称权威 Schema 为 `v0.1.16-report-framework`、当前基线为 `8fa2a4f`，并在残余风险中称 Step 2A/2B/2C “当前均尚未实现”。实际 Schema 已在 `src/main/db/schema.sql:2` 声明 `v0.1.18-event-batch-v2.2`，`doc/specs/baseline.yaml` 与 `.continue-here.md` 已记录 M5B 完成。计划仍把 `INV-EVT-002` 作为“当前 legacy”后续待替换对象，而当前不变量已经另有生产 v2 边界 `INV-EVT-006`。
- 触发条件：依据当前计划评估 Step 3 前置、选择 writer/recovery 边界或编排后续 R3 工作。
- 影响：会把已验收的 v2.2 runtime 和安全/命令阶段误认为待实现，错误地安排重复迁移，或以旧 JSONL 逐行写入语义审查新的工作。
- 违反依据：工作流合同 §1 的事实来源优先级、§5 的跨文件副作用要求，以及计划自身要求 Step 2C 后按实际基线重新审查。
- 最小修复：将计划的“当前基线”更新为当前 `HEAD`、v0.1.18/M5B 事实和适用 v2 不变量；将 Step 2A/2B/2C 改为已验收前置及其现有验证记录，只保留与 Step 3 的真实接口/风险。随后重新审查计划。
- 回归测试：增加文档一致性检查，至少将计划当前 Schema 版本和 Step 2 状态与 `baseline.yaml`、`schema.sql` 和 `.continue-here.md` 的受控摘要比对。

#### [P1-02] workbook↔SQL 逐字段对账没有成为日常强制门禁

- 位置：`scripts/lib/base-ability-42plus8-source.mjs:294-353`、`scripts/lib/base-ability-42plus8-authority.mjs:495-522`、`package.json` 中的 `contract:base-ability:*` scripts。
- 证据：`assertWorkbookMatchesSql()` 存在，本轮实际输出 workbook 与 import SQL 匹配；但 authority 构建只调用 `loadBaseAbilityCandidates()`，并明确记录逐字段对账“不进入沙箱强制路径”。`authority:check` 和 `gate:check` 均不会调用该函数，也没有独立的 `source:check` 必跑入口。
- 触发条件：workbook 和派生 SQL 的字段语义发生不一致变动，但两份文件 hash 与结构化输入被同时更新后，只执行日常 authority/gate 检查。
- 影响：题集可继续具有各自有效 hash，却不再证明唯一 workbook 与实际导入 SQL 的逐题语义一致，违反 Step 1 的“任一来源不一致整体失败关闭”目标。
- 违反依据：实施计划 Step 1 对唯一 xlsx、派生 SQL 与结构化输入的确定性检查要求；`INV-DATA-001`、`INV-DATA-003`。
- 最小修复：将该对账接入 `authority:check`，或新增受测试覆盖且必须运行的 `contract:base-ability:source:check`；移除“沙箱强制路径以外”的例外，或把其环境前提做成明确 `BLOCKED` 而非跳过。
- 回归测试：篡改复制的 workbook 或 SQL 字段时，常规检查必须非零；完整恢复后 authority/gate 产物仍须 byte-for-byte 一致。

### P2

#### [P2-01] 当前 ACTIVE 门禁仅按数量，不核对冻结的 42+8 ID 集合

- 位置：`scripts/lib/base-ability-42plus8-gate.mjs:176-181`。
- 证据：`active_question_status` 以 `activeTotal >= 50` 判断，而非与 authority 冻结的 50 个 `question_id` 精确对账。
- 影响：后续若错误激活 deferred 题、漏激活 selected 题，数量门槛本身可能通过。当前所有候选仍为 DRAFT，其他 gate 仍阻断，故不升为 P1。
- 建议：在后续分阶段激活门禁中以集合、状态和 hash 三重对账替代数量阈值。

#### [P2-02] 重复选择测试没有调用生产输入校验入口

- 位置：`scripts/__tests__/base-ability-42plus8-authority.test.mjs:165-180`。
- 证据：测试自行使用 `Set` 模拟重复检查，未调用 `assertInput()` 或其他生产可注入入口。
- 建议：抽取可注入的输入验证器，使用篡改后的临时输入验证真实构建路径失败关闭。

### NOTE / 待验证

- [!] `doc/specs/MVP_PRD_v1.0.9-authoritative.md:4553` 仍将“当前全量初始化基线”写为 v0.1.17、将 Step 2B 描述为可开始；这与 `baseline.yaml` 和 `schema.sql` 的 v0.1.18/M5B 现场冲突。按工作流合同，当前基线和 Schema 优先，本轮没有静默采用 PRD 的旧阶段描述。该段应在计划重基线时同时标明历史性质或由产品合同维护者更新。
- `npm run lint` 只覆盖 `src`，不会 lint 本次涉及的 `.mjs` 工具；本轮以定向测试、生成物一致性和来源对账为证据，未将未覆盖项写成通过。
- 未执行全量 `npm test`、`npm run build`、默认数据库验证、Electron 或真实课堂验收；它们不属于 Step 1 的最小验收，均不得据此声明为通过。

### 已核验通过的关键项

- Step 1 仍严格保持 96 道 DRAFT，42+8 冻结清单、46 道 deferred、域隔离和观察项排除均有实际命令证据。
- 当前 Schema 的 session question trigger 同时验证 `ACTIVE`、bank domain、module/type 和 item usage，见 `src/main/db/schema.sql:2283-2314`；这与后续 BASE_ABILITY 域隔离计划一致。
- `strategy_config` 当前种子采用 `question-policy-v1.2` 的六模块各 7 道线上配额和 8 道线下配额，见 `src/main/db/schema.sql:2349-2376`。
- 实施计划明确禁止默认数据库自动写入、DRAFT 提前激活和将 Step 2 R3 合并；这些边界仍正确。

### 残余风险

- 在 P1-01 关闭前，计划不能作为 Step 3 的当前工程基线。
- 在 P1-02 关闭前，未来常规验证不能单独证明 workbook 与导入 SQL 的字段级一致性。
- 外部审核、受控激活、学校授权与课堂试测仍未执行，不能写作业务 Pilot 完成。

### 规则沉淀候选

- 建立实现计划与 `baseline.yaml` / Schema / 交接当前阶段的一致性门禁。
- 将 workbook↔SQL 对账作为无例外的常规合同检查，并保留字段漂移负向测试。
- 以冻结 question ID 集合而非 `ACTIVE >= 50` 检查未来激活范围。

### 置信度

`MEDIUM`。当前文件、命令和源码证据完整，但本轮是新上下文的非独立自审，且发现的 P1 尚未修复和复审。
