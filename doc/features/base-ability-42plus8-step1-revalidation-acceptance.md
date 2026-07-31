# BASE_ABILITY 42+8 Step 1 重验记录

## 验收报告

### 结论

`PASS`

本记录只验收 Step 1 的 DRAFT 候选清单、来源和机器合同，不代表内容/专业审核、renderer、真实激活、课堂试测或 Step 3 已获准开始。

### 范围

- 模式：`/vibe-accept step 1`
- 风险：`R3`
- 验收日期：2026-07-31
- PRD / 实施计划：`doc/features/base-ability-42plus8-pilot-readiness-prd.md`、`doc/features/base-ability-42plus8-pilot-readiness-impl.md`
- 适用不变量：`INV-DATA-001`、`INV-DATA-002`、`INV-DATA-003`、`INV-RES-001`、`INV-STR-002`
- 边界：未读取、初始化或修改默认运行数据库；未激活题目，未生成激活授权或激活 SQL。

### 工作区

| 项目 | 状态 | 证据 |
|---|---|---|
| 执行前工作区 | PASS | `git status --short --branch` 仅显示分支 `feat/multi-device-m2-prd`，无未提交文件；无 stash。 |
| 计划外变更 | PASS | authority build、gate check、文档索引更新后，`git diff --stat` 无输出。 |
| 差异格式 | PASS | `git diff --check` 退出码 0。 |

### 自动化检查

| 检查 | 命令 | 状态 | 证据 |
|---|---|---|---|
| 定向合同测试 | `npm test -- scripts/__tests__/base-ability-42plus8-authority.test.mjs scripts/__tests__/base-ability-42plus8-gate.test.mjs` | PASS | 2 个文件、13/13 tests 通过。 |
| authority 生成 | `npm run contract:base-ability:authority:build` | PASS | 生成 `42+8 DRAFT`；authority hash 为 `sha256:52c27a71596f7c32e1aab287af40c9c88268ed807bbfdee187a683b4f40d0201`。 |
| authority 一致性 | `npm run contract:base-ability:authority:check` | PASS | 提交的 authority 产物与确定性重建结果一致。 |
| gate 一致性 | `npm run contract:base-ability:gate:check` | PASS | 96 candidates、online=87、offline=8、observation=1；总状态仍是 `BLOCKED_DRAFT_REVIEW_RENDERER_MATERIAL_AND_TRIAL_GATE`。 |
| workbook 与派生 SQL 逐字段对账 | `assertWorkbookMatchesSql()` | PASS | 受控执行后输出 `[base-ability-source] workbook and import SQL match`。初次沙箱运行因 `spawnSync unzip EPERM` 受阻，未把该结果记为通过；只读重跑后实际通过。 |
| 文档索引更新 | `npm run docs:index:update` | PASS | 命令退出码 0。 |
| 文档索引检查 | `npm run docs:index:check` | PASS | `doc/index.md is current`。 |
| 类型检查 | `npm run typecheck` | PASS | 退出码 0。 |
| lint | `npm run lint` | PASS | 退出码 0，663 条既有 warning，0 error。 |

### 题集与边界核验

| 要求 | 状态 | 证据 |
|---|---|---|
| 96 = 50 + 46 | PASS | authority/gate 测试及 authority 产物：50 道入选、46 道 deferred。 |
| 42+8 配额 | PASS | 42 道线上、8 道线下；6 个模块均为 7 道线上题。 |
| 观察项和岗位域隔离 | PASS | `OBSERVATION_ONLY` 入选数为 0；`JOB_SPECIFIC` 入选数为 0。 |
| DRAFT / 激活失败关闭 | PASS | 96 道均为 `DRAFT`、0 `ACTIVE`；每题 `activation_authority = NONE`。 |
| 评分、素材和教具仍未冒充就绪 | PASS | gate 记录 96 条 `NO_SCORE`、0 媒体绑定、0 工具绑定，且相关 gate 保持 `BLOCKED/PENDING`。 |
| 逐题合同及 hash | PASS | 所选 50 题均有结构化内容、评分和 renderer requirement hash；authority 根 hash 已由定向测试和 `authority:check` 重算。 |
| 来源一致性 | PASS | authority 同时绑定唯一 xlsx、派生 SQL 和结构化输入 hash；本次 workbook↔SQL 逐字段对账实际通过。 |
| 无运行库副作用 | PASS | `scripts/lib/base-ability-42plus8-authority.mjs:495-567` 仅读取合同输入与来源，写入目标仅为 `doc/features/base-ability-42plus8-authority-v1.json`；`scripts/lib/base-ability-42plus8-gate.mjs:231-250` 仅写 gate JSON；来源解析使用内存 `sql.js`。所有本轮命令均未接收数据库路径或激活参数。 |

### 跨文件登记检查

- [PASS] authority JSON 与 schema、结构化输入、来源 workbook / SQL、生成器、gate 和定向测试同步核验。
- [PASS] `package.json` 中的 authority/gate build/check 入口实际可运行，并保持 DRAFT / 无运行库写入边界。
- [PASS] 文档索引已重新生成并检查。
- [NOT_RUN] 内容/专业/无障碍人工审核、renderer、素材、教具、真实 Pilot 激活和课堂试测不属于 Step 1 完成范围，且 gate 仍明确阻断这些动作。

### 人工验收

| 场景 | 状态 | 环境与证据 |
|---|---|---|
| 人工内容/专业/无障碍审核 | NOT_RUN | Step 1 不得将机器预选或答案草案冒充为审核完成。 |
| Electron / 课堂 Pilot | NOT_RUN | 本步骤不启动真实题库或默认数据库，也不进行激活。 |

### 未通过项

无。本步骤的候选合同验收没有失败项。

### 未执行 / 阻塞项

外部审核和运行时准备项保持 `NOT_RUN`，它们是后续 gate 的真实阻断，不影响本次 DRAFT 合同的 Step 1 结论。

### 规则沉淀候选

- 将 workbook↔SQL 逐字段对账接入日常必跑命令；详见同日实施计划复审的 `P1-02`。

### 下一步

不得进入 Step 3。先关闭实施计划复审中的 P1，再以当前基线重新执行独立复审。
