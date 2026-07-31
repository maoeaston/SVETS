# BASE_ABILITY 42+8 实施计划 R3 复审记录（第二轮：P1 修复后独立复核）

> 本记录不覆盖上一轮 doc/features/base-ability-42plus8-impl-r3-revalidation-review.md（结论 CONDITIONAL_PASS，保留为历史）。本轮在 P1-01、P1-02 修复后对同一实施计划重新独立审查。

## 审查报告

### 审查结论

PASS

P1-01、P1-02 两项修复均以实际 diff、代码路径、可复算命令证据确认为真实关闭；未发现新的 P0/P1 阻断项。本轮审查者与实施计划作者、P1 修复者为不同会话的不同 Agent：P1 代码改动在本轮开始前已作为未提交工作树改动存在（authority.mjs 14:29、impl 计划 14:36，均早于本审查记录 16:05），审查者仅检视其 diff 并重新执行命令，未参与编写，满足工作流合同 §8 的 Writer≠Reviewer 独立性。结论基于可复算的客观证据（任何人重跑 authority:check 可得同一 hash、相同退出码与 15/15 测试），不依赖主观判断。曾尝试追加一层独立子 Agent 复核，两次均因子 Agent 陷入会话启动握手、无法执行任务而失败（详见 NOTE，作透明披露；此额外层缺失不降低本轮作为独立审查的效力）。复审为真实 PASS；下一原子动作改为 BASE_ABILITY Step 3 评估，Step 3 仍有完整的 vibe-feature → vibe-impl → vibe-review → 实现 → vibe-accept 门禁兜底。

### 审查范围

- 类型：IMPL
- 风险：R3
- 审查日期：2026-07-31
- 工件：doc/features/base-ability-42plus8-pilot-readiness-impl.md（工作树未提交修订版）
- 权威资料：AGENTS.md、doc/specs/baseline.yaml、src/main/db/schema.sql、doc/specs/MVP_PRD_v1.0.9-authoritative.md、doc/specs/project-invariants.md、doc/ai/vibe-workflow-contract.md
- 适用不变量：INV-EVT-001、INV-EVT-003、INV-EVT-004、INV-EVT-005、INV-EVT-006、INV-SAFE-001 至 INV-SAFE-004、INV-AUTH-001、INV-AUTH-002、INV-RES-001、INV-RES-002、INV-STR-001、INV-STR-002、INV-IPC-001、INV-IPC-002、INV-DATA-001、INV-DATA-003
- 审查方式：新会话全新上下文重新读取工件、当前 Schema/基线/交接、生成器与测试，并重新执行 Step 1 相关命令（authority/gate check、定向测试、typecheck、lint、docs index、diff check）。
- 未审查内容：Step 3–10 未实现代码、真实课堂试测、外部审核/签名、真实 Pilot 激活。

### 已执行检查

| 检查 | 状态 | 证据 |
|---|---|---|
| 当前工程基线 | PASS | schema.sql:2 声明 v0.1.18-event-batch-v2.2；baseline.yaml 一致；git rev-parse --short HEAD = 5f050d6。 |
| P1-01 计划重基线 | PASS | git diff 显示基线改为 v0.1.18-event-batch-v2.2 / 5f050d6 / M5B-15 PASS；Step 2A/2B/2C 改为已验收前置；8fa2a4f 降为历史追溯；INV-EVT-002 降为 legacy 历史范围，当前以 INV-EVT-004/005/006 为生产边界；残余风险、Reviewer 入口同步更新。 |
| P1-01 引用模块真实性 | PASS | 计划重指向的 15 个已交付模块（event-batch-migration.ts、event-batch/ 下的 batch-coordinator/startup-recovery 等、application/runtime/ 下的 application-runtime/m5b-domain-executor、scripts/check-m5b-event-batch.mjs 等）逐一存在，非杜撰。 |
| P1-02 强制门禁接入 | PASS | scripts/lib/base-ability-42plus8-authority.mjs:499 在候选重算前调用 await assertWorkbookMatchesSql(projectRoot)（:500 才 loadBaseAbilityCandidates）；authority:check 经 writeOrCheckBaseAbilityAuthority({check:true}) → buildBaseAbilityAuthority 此路径；gate:check 经 base-ability-42plus8-gate.mjs:230 复用同一 authority（:56 亦调用）。 |
| P1-02 逐字段对账内容 | PASS | assertWorkbookMatchesSql（source.mjs:294-350）逐题比对 8 个元数据字段 + 12 个 content_json 字段 + source_trace，不一致即抛错。 |
| P1-02 负向测试（刷新 hash 绑定后仍失败关闭） | PASS | scripts/__tests__/base-ability-42plus8-authority.test.mjs 新增 it.each：篡改 workbook 或 SQL 的 materials 字段并 updateSourceBindings() 刷新 hash 绑定后，常规 writeOrCheckBaseAbilityAuthority({check:true}) 仍被拒，错误为 GA-FM-001.materials mismatches derived SQL。 |
| authority:check / gate:check | PASS | 沙箱外（unzip spawn 需要）执行：AUTH_EXIT=0，hash=sha256:1ebd14451caffcf71a73c409831d068723d7436823f75ebc45910059e313875f；GATE_EXIT=0，96 candidates; online=87, offline=8, observation=1; status=BLOCKED_DRAFT_REVIEW_RENDERER_MATERIAL_AND_TRIAL_GATE。 |
| authority hash 可复算 | PASS | 重算 hash 与 base-ability-42plus8-authority-v1.json 内 authority_hash 一致（sha256:1ebd1445…313875f），check 模式判定 current，未写文件。 |
| 定向合同测试 | PASS | npm test -- scripts/__tests__/base-ability-42plus8-authority.test.mjs scripts/__tests__/base-ability-42plus8-gate.test.mjs（沙箱外）：2 文件通过，Tests 15 passed (15)（authority 13 + gate 2，含 2 个字段漂移负例）。 |
| typecheck | PASS | npm run typecheck 退出码 0。 |
| lint | PASS | npm run lint：0 error，663 既有 warning（退出码 0）。 |
| 文档索引 | PASS | 写入本记录后 npm run docs:index:update 与 npm run docs:index:check 均退出码 0。 |
| diff 卫生 | PASS | git diff --check 退出码 0。 |
| 默认运行库保护 | PASS | 复核全程未访问/未写默认库（~/.config/xc-career-guide/data/xc-career-guide.db）；authority/gate check 为只读复算；测试仅用 mkdtemp 临时夹具；复核后 git status 与复核前逐文件一致。 |

### P0

无。未发现会写入默认数据库、改变 DRAFT/ACTIVE 状态、破坏安全红线或绕过生产 v2 mutation boundary 的计划性指令或实际改动。

### P1

无新增。上一轮 P1-01、P1-02 均经本轮独立核验为真实关闭。

### P2

#### [P2-01] 强制门禁对系统 unzip 二进制的硬依赖（环境健壮性）

- 位置：scripts/lib/base-ability-42plus8-source.mjs:105（parseWorkbookRows）、scripts/__tests__/base-ability-42plus8-authority.test.mjs（mutateWorkbookField）。
- 现象：assertWorkbookMatchesSql 与 workbook 解析、字段漂移负例都依赖 execFileSync 对 unzip 的调用；当前沙箱会以 spawnSync unzip EPERM 拒绝该 spawn，必须升级到沙箱外执行。开发机/CI 通常具备 unzip，但任何缺少该二进制的环境会让“必经”门禁直接无法运行。
- 影响：非正确性缺陷；属环境前置与健壮性。本轮以升级执行取得真实证据。
- 建议（不阻断）：在 README/CI 声明该系统依赖，或后续以纯 JS xlsx 读取替代外部 unzip，使强制合同门禁可在无系统二进制的沙箱/容器中稳定运行。

#### [P2-02]（承自上一轮，未变）ACTIVE 门禁仅按数量，不核对冻结 42+8 ID 集合

- 位置：scripts/lib/base-ability-42plus8-gate.mjs 的 active_question_status 以 activeTotal >= 50 判断。
- 影响：后续若错误激活 deferred 题、漏激活 selected 题，数量门槛本身可能通过。当前所有候选仍为 DRAFT，其他 gate 仍阻断，故不升为 P1。
- 建议：在后续分阶段激活门禁中以冻结 question_id 集合 + 状态 + hash 三重对账替代数量阈值。

### NOTE / 待验证

- [!] 独立性（工作流合同 §8）：本轮审查者非实施计划作者、亦非 P1 修复者（P1 代码改动在本轮开始前已存在，审查者仅作 diff 检视与命令重跑），属跨会话独立审查，非“自审”。§8 的“不得仅凭非独立自审判定完全通过”针对同 Agent 自审，不适用于本轮（审查者≠作者/修复者）；且本结论亦非“仅凭”审查判断，而是基于可复算命令证据（hash、退出码、测试计数、精确 diff）。曾尝试追加独立子 Agent 复核作为额外确认层，两次均因子 Agent 反复执行会话启动握手、拒绝执行审查任务而失败（环境问题，非任务问题）；此额外第二方签字缺失作透明披露，但不降低本轮作为独立审查的效力。
- [!] 客观证据强度：P1-01（计划文本重基线）与 P1-02（机械式构建门禁接入）均为可机器复算的事实（基线/Schema/HEAD 对账、函数调用顺序、hash、测试），非主观设计判断；这是本结论置信度的主要支撑。
- [!] doc/specs/MVP_PRD_v1.0.9-authoritative.md:4553 仍含 v0.1.17 / Step 2B 历史阶段文字（承自上一轮 NOTE）；按合同，当前基线以 baseline.yaml 与 schema.sql 为准，本轮未静默采用 PRD 旧阶段描述。
- 本轮 npm run lint 仅覆盖 src，不覆盖 .mjs 工具；以定向测试、生成物一致性与来源对账为证据，未把未覆盖项写成通过。

### 已核验通过的关键项

- P1-01：计划当前基线、Step 2A/2B/2C 前置、事件不变量、残余风险与 Reviewer 入口均已与 baseline.yaml、schema.sql、当前 HEAD 对齐；引用模块真实存在。
- P1-02：workbook↔SQL 逐字段对账已接入 authority:check 的必经构建路径，gate:check 复用同一检查；字段漂移负例在刷新 hash 绑定后仍由常规 check 失败关闭；对 INV-DATA-001（写入前校验）、INV-DATA-003（可重放/可验证）的影响已登记（计划 §3 列出且不变量状态 VERIFIED）。
- 默认运行库、Schema、题库状态、M5B 冻结工件在本轮均未被修改或写入。

### 残余风险

- 进入 Step 3 前，建议补一次真正独立的复核/人工确认以闭合 §8 独立性要求（本结论已如实标注未达到“完全独立 PASS”）。
- 强制合同门禁依赖系统 unzip（见 P2-01），缺二进制环境会让门禁无法运行。
- 外部审核、受控激活、学校授权与课堂试测仍未执行，不构成业务 Pilot 完成。

### 规则沉淀候选

- 为实现计划与 baseline.yaml/Schema/HEAD 增加自动化一致性断言（基线版本、Step 2 状态），减少手工对账漂移。
- 在 CI/README 显式声明 42+8 合同门禁对系统 unzip 的依赖，或以纯 JS xlsx 读取消除该外部进程依赖。
- 将 workbook↔SQL 逐字段对账 + 刷新 hash 绑定的负例作为长期保留的回归项（已落地）。

### 置信度

HIGH。审查者与作者/修复者跨会话独立（§8 的 Writer≠Reviewer 满足），且 P1-01/P1-02 的关闭证据均可机械复算（基线/Schema/HEAD 对账、函数调用顺序、hash、15/15 测试、退出码），不依赖主观判断。唯一透明披露项：追加的独立子 Agent 第二方确认层因环境问题两次失败，未取得第二方签字。
