# BASE_ABILITY 42+8 正式 `/vibe-review` 记录

## 审查结论

`CONDITIONAL_PASS`（无 P0；有 2 项未关闭 P1）。

本轮已确认 42+8 authority/gate 产物保持 `DRAFT`、不授予激活权限、不写运行库，相关自动检查与定向测试通过。但当前审查为本轮上下文中的非独立自审；平台未提供可用的独立 Reviewer，因此不能把本次 R3 审查写成完全独立 `PASS`。用户明确授权的下一步只能进入 M4 Step 2B / M5A 的 `/vibe-feature` 定义阶段，不能据此开始编码、迁移或修改默认数据库。

## 审查范围

- 类型：`IMPL + CODE`（以实现计划为主，核对 `ce5831d` 的真实差异和相关测试）
- 风险：`R3`
- base/head：`5dbb670...ce5831d`
- 工件：
  - `doc/features/base-ability-42plus8-pilot-readiness-prd.md`
  - `doc/features/base-ability-42plus8-pilot-readiness-impl.md`
  - `doc/features/base-ability-42plus8-authority-v1.json` 及其 schema
  - `doc/features/base-ability-42plus8-contract-input-v1.json`
  - `scripts/lib/base-ability-42plus8-{authority,gate,source}.mjs`
  - 相关构建入口、测试和 `package.json` scripts
- 权威资料：`AGENTS.md`、`doc/specs/baseline.yaml`、`doc/specs/project-invariants.md`、`doc/ai/vibe-workflow-contract.md`、`vibe-coding-skills-v2/commands/vibe-review.md`、`doc/specs/MVP_PRD_v1.0.9-authoritative.md`
- 适用不变量：`INV-DATA-001`、`INV-DATA-002`、`INV-RES-001`、`INV-STR-002`、`INV-AUTH-002`；并核对 PRD §5.4.7、§7.6.1、§17.9 的 BASE_ABILITY 42+8、域隔离、DRAFT/ACTIVE 与 Pilot 顺序。
- 未审查内容：真实课堂试测、人工内容/专业/无障碍审核、真实 Pilot 激活、M4/M5A 尚未实现的运行时行为；这些不是本次 BASE_ABILITY authority/gate 提交的已交付范围。

## 已执行检查

| 检查 | 状态 | 证据 |
|---|---|---|
| authority 生成物一致性 | PASS | `npm run contract:base-ability:authority:check`，退出码 0；输出 authority hash `sha256:52c27a71596f...d0201` |
| gate 生成物一致性 | PASS | `npm run contract:base-ability:gate:check`，退出码 0；输出 96 candidates、online=87、offline=8、observation=1，状态为 `BLOCKED_DRAFT_REVIEW_RENDERER_MATERIAL_AND_TRIAL_GATE` |
| 相关定向测试 | PASS | `npm test -- scripts/__tests__/base-ability-42plus8-authority.test.mjs scripts/__tests__/base-ability-42plus8-gate.test.mjs`；2 个文件、13/13 tests 通过 |
| 类型检查 | PASS | `npm run typecheck`，退出码 0 |
| lint | PASS | `npm run lint`，退出码 0；661 条 warning、0 errors，warning 为既有 renderer 规范提示，未把它们写成新增阻断 |
| 文档索引 | PASS | `npm run docs:index:check`，退出码 0 |
| 真实差异格式 | PASS | `git diff --check 5dbb670...ce5831d`，退出码 0 |
| workbook↔SQL 独立对账函数 | BLOCKED | 直接执行 `assertWorkbookMatchesSql` 时，沙箱禁止其 `unzip` 子进程，返回 `spawnSync unzip EPERM`；普通 authority/gate check 当前也没有调用该函数 |

## P0

无。

## P1

### [P1-01] 实施计划仍引用已过时的 Schema/阶段基线

- 位置：`doc/features/base-ability-42plus8-pilot-readiness-impl.md:13`、`:732`。
- 证据：当前 `doc/specs/baseline.yaml:74` 和 `AGENTS.md` 声明 Schema 基线为 `v0.1.17-multi-device-m4-safety-rekey`，且 `.continue-here.md:7` 记录 M4 Step 2A 已 `PASS / CLOSED`；但实施计划仍写 `schema v0.1.16-report-framework`，并把 Step 2A 描述为“当前均尚未实现”。
- 触发条件：后续按该计划继续执行 `/vibe-impl` 或审查时直接采用其基线/阻断描述。
- 影响：可能把已完成的 M4 三元安全基线误当成待实施前置，或让 M5A 计划引用旧 Schema，破坏跨会话状态和下一阶段的前置判断。
- 违反依据：工作流合同 §1/§2 要求以 `baseline.yaml` 指向的当前权威资料和实际状态为准；实现计划自身第 4 节和第 9 节要求进入下一阶段前重新核对实际基线。
- 最小修复：在下一次 `/vibe-impl` 修订或 M5A feature 定义前，把 Schema、实际 base commit、M4 状态和残余风险改为当前事实；保留历史迁移版本只作为迁移来源说明。
- 回归测试：加入文档/基线一致性检查，至少断言实施计划引用的当前 Schema 版本与 `baseline.yaml` 一致，并断言 M4 状态描述不与 `.continue-here.md`/验收记录冲突。

### [P1-02] workbook↔SQL 来源对账没有进入常规强制门禁

- 位置：`scripts/lib/base-ability-42plus8-source.mjs:294-353`、`scripts/lib/base-ability-42plus8-authority.mjs:495-551`、`doc/features/base-ability-42plus8-authority-v1.json:21`。
- 证据：仓库提供 `assertWorkbookMatchesSql()`，但 authority 构建实际只通过 `loadBaseAbilityCandidates()` 从 SQL 生成候选，并分别校验 workbook/SQL hash；`package.json` 没有该对账命令，两个 authority/gate 测试也没有调用它。生成物明确写明字节级对账“不进入沙箱强制路径”。
- 触发条件：输入合同同步更新 workbook hash、而派生 SQL 的字段没有同步，随后只运行 `authority:check`/`gate:check`。
- 影响：authority 仍可能绑定两份不同语义的来源文件；来源可追溯性与“任一来源不一致整体失败关闭”的 Step 1 约束没有被常规门禁完整保证。
- 违反依据：`doc/features/base-ability-42plus8-pilot-readiness-impl.md:114-121` 要求从唯一 workbook、派生 SQL 和结构化输入确定性生成/检查，并把来源/哈希不一致作为失败关闭条件；`INV-DATA-001`、`INV-DATA-003` 要求数据合同和可验证产物保持一致。
- 最小修复：将 workbook↔SQL 对账接入 `authority:check` 或独立但必跑的 `base-ability:source:check`，补充非零退出和字段漂移测试；若运行环境必须使用提权命令，应把命令、权限前提和 `BLOCKED` 结果写入验收门禁，而非仅写在生成物说明中。
- 回归测试：临时复制并篡改 SQL 或 workbook 字段，确认 authority/gate 常规检查失败；恢复原文件后确认 byte-for-byte 产物仍一致。

## P2

### [P2-01] 激活阶段门禁的 ACTIVE 判定仍过宽

- 位置：`scripts/lib/base-ability-42plus8-gate.mjs:161-165`；authority 记录的 `runtime_status` 在 `scripts/lib/base-ability-42plus8-authority.mjs:354-364` 固定为 `DRAFT`。
- 证据：`active_question_status` 以 `activeTotal >= 50` 判定通过，没有核对 ACTIVE 的 50 个 question ID 是否正好来自冻结的 42+8 集合；authority 的 `active_total` 也不会反映 SQL 行本身的 status。
- 影响：当前其它门禁仍保持阻断，所以不会直接激活题目；但后续复用该 gate 时，误激活 deferred 题或漏激活 selected 题可能被错误计数为通过。
- 建议：后续激活门禁改为 selected ID 集合精确对账，并将运行库实际状态作为输入；本轮不建议借此改写 DRAFT authority。

### [P2-02] 重复选择测试没有调用生产校验入口

- 位置：`scripts/__tests__/base-ability-42plus8-authority.test.mjs:165-180`。
- 证据：测试自行复制 `Set` 去检查重复 ID，并注释说明“emulate the duplicate detection directly”，没有构造临时输入调用 `buildBaseAbilityAuthority()`/`assertInput()`。
- 影响：生产入口的重复选择校验被删除或失效时，该测试仍可能通过。
- 建议：改为隔离临时输入文件或抽取可注入的 input validator，直接验证生产路径的失败关闭行为。

## NOTE / 待验证

- `npm run lint` 只覆盖 `src`，本次新增 `.mjs` 脚本没有被 ESLint 检查；本轮以 typecheck、相关测试和实际命令结果为主，未将脚本 lint 缺口升级为阻断。
- 未执行全量 `npm test`、`npm run build`、默认数据库验证和人工/桌面验收；它们不属于本次 authority/gate 定向提交的最小验证集，不能写成通过。
- workbook↔SQL 对账函数本身因沙箱的 `unzip` 子进程限制未完成实跑；它保持 `BLOCKED/NOT_RUN`，不伪装成 PASS。

## 已核验通过的关键项

- 96 条候选与 authority 结果为 `96 = 50 selected + 46 deferred`；selected 为线上 42 + 线下 8，6 个模块各 7 道线上题。
- 96 条均为 `DRAFT`，selected 题 `activation_authority = NONE`，authority boundaries 中 `runtime_database_write_allowed = false`、`activation_authority_granted = false`、`activation_sql_generated = false`。
- `OBSERVATION_ONLY` 未进入 selected；`BASE_ABILITY` 与 `JOB_SPECIFIC` 的 authority 统计边界保持隔离；gate 当前为阻断状态，不产生激活授权。
- 50 道 selected 合同的内容、评分和 renderer requirement hash 可确定重算，答案键仍为 `PENDING`，renderer requirement 仍为 `PENDING_IMPLEMENTATION`；这表示草案合同，不表示正式施测就绪。

## 残余风险

- P1-01/P1-02 关闭前，BASE_ABILITY Step 1 的文档基线和来源对账仍不能作为无条件完整闭环；不得把本记录当作正式激活或运行时就绪批准。
- M4 Step 2B / M5A Command Bus Boundary 仍需按独立 R3 feature 流程定义、实现、review 和 accept；本记录不授权 Schema、IPC 或写入口修改。

## 规则沉淀候选

- 增加 `doc` 基线引用一致性静态检查，防止实现计划继续引用过时 Schema/里程碑状态。
- 把“唯一来源 workbook 与派生 SQL 对账”纳入 authority/gate 的机器门禁及测试，不允许只保留未接线的 helper。
- 激活 gate 使用冻结 selected question ID 集合做精确对账，不使用 `activeTotal >= N` 的数量阈值替代集合校验。

## 置信度

`MEDIUM`。authority/gate、定向测试、类型检查、lint、文档索引和实际 diff 均有命令证据；但本轮没有独立 Reviewer，且 workbook↔SQL 对账受沙箱子进程权限限制未能实跑，故不提升为 HIGH。
