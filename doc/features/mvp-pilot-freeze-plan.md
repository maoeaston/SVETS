# MVP Pilot 冻结与收口计划

- 状态：DRAFT；当前不满足 Pilot 冻结条件
- 日期：2026-07-18
- 事实快照：`feat/multi-device-m2-prd` / `95c9808bbbcb8c5c5c057e275a610a0ca2573824` + 当前未提交工作树
- 工程基线：PRD v1.0.9 / schema v0.1.15-multi-device-m3-grant-assignment
- 目标：停止 MVP 扩功能，在完成本文全部 R0 闸门后，形成可重复安装、可追溯、可恢复的 Pilot 冻结基线。

## 0. 文档性质与判定规则

- 本文是向前执行的 R0 冻结合同，不是“当前已经完成”的证明，也不替代 `doc/specs/MVP_PRD_v1.0.9-authoritative.md`。
- 冻结的 MVP PRD 正文保持不变；Full Product、M4 或 M5 的需求不得回写并改写该历史合同。
- 当前已实现事实以当前 schema、源码、全新数据库重建结果和可追溯验收证据为准；交接文字或本机运行库快照不能单独证明完成。
- `doc/features/full-product-1.0-planning-review-2026-07-18.md` 是审查快照，不是产品合同。
- 本文所有闸门默认 `NOT PASSED`。只有输入、预期输出、实际结果和证据位置均被记录并复核后，才能改为 `PASSED`。

本文使用三种状态标签：

| 标签 | 含义 |
|---|---|
| `CURRENT_FACT` | 2026-07-18 当前仓库或全新数据库可以直接证明的事实 |
| `R0_REQUIRED` | 创建稳定 Pilot tag 之前必须实现并验收的合同 |
| `FULL_PRODUCT_1_0` | Pilot 冻结后进入完整产品 1.0 的能力，不得被倒写成 Pilot 已实现 |

## 1. 收口结论

**当前版本不得直接作为稳定 `MVP Pilot` 冻结。只有本文 R0-G00 至 R0-G10 全部通过，才允许创建 Pilot release commit 和 tag。**

“停止 MVP 扩功能”的产品决策立即生效，但它不把 R0 待完成项变成当前事实。R0 只处理 Pilot 可重复发布、安全闭环、可操作报告、生产账号、安装、恢复和验收证据，不借机扩展完整课程、真实局域网多设备或 AI。

冻结 tag 仍不得标记为“完整满足 PRD v1.0.9”或“生产正式版”。

### 1.1 当前仓库事实

| 能力 | `CURRENT_FACT` | 仓库证据 | 当前判定 |
|---|---|---|---|
| 专业岗位固定 18+6 | 当前策略已列出 24 个固定题 ID，但全新库按仓库内容源重建后，JOB 298 条均为 `DRAFT`，ACTIVE JOB 为 0；创建 session 又要求固定题全部 `ACTIVE` | `src/main/db/schema.sql:2151`；`src/main/ipc/handlers/assessment.ts:425-468`；`doc/features/question-bank-import.sql:43` 起 | 不能从 tag 重建可运行 18+6 |
| BASE 42+8 | BASE 96 条均为 `DRAFT/NO_SCORE`；教师创建页仍展示并默认选择基础能力 | `doc/features/question-bank-import-base-ability-v02.sql:8` 起；`src/renderer/src/views/teacher/AssessmentCreateView.vue:23-45,184-187` | 不能开放，UI 尚未冻结 |
| 安全事件 | 已能触发红线、写入 `PENDING_DETAIL` incident、熔断会话并生成安全失败结果；没有列表、教师确认、管理员解决/作废或事实修正的 IPC/UI | `src/main/ipc/handlers/assessment.ts:1424-1532`；`src/shared/types/ipc-api.ts:145-178`；`src/renderer/src/router/index.ts:60-89` | 安全责任闭环未成立 |
| 结果与报告 | 专业岗位完成后可在主进程生成 `result_record` 和 `task_report`；没有报告读取、展示或导出 API/页面 | `src/main/ipc/handlers/job-skill-report.ts:36-138`；`src/shared/types/ipc-api.ts:145-178`；`src/preload/index.ts:29-52` | 不能对外承诺“用户可查看报告” |
| 生产账号 | 每次数据库初始化均无条件 seed 仓库和 README 公开的 ADMIN/TEACHER/STUDENT 凭据 | `src/main/db/connection.ts:45-48,60-86`；`src/shared/config/dev-accounts.json:1-22`；`README.md:90-94` | 生产责任边界不成立 |
| 安装产物 | `npm run build` 仅执行 `electron-vite build`；没有 package/installer 命令、打包器依赖或干净机器记录 | `package.json:6-22,24-50`；`electron.vite.config.ts:6-37` | 只有工程 bundle，不是可安装 Pilot |
| 备份与恢复 | migration/reset 前可用 `VACUUM INTO` 复制 SQLite，并在存在时复制 JSONL；没有正式 restore 命令、代次 manifest/hash、失败回退或真实恢复记录 | `src/main/db/connection.ts:89-98`；`scripts/lib/database-content-pack.mjs:421-432`；`doc/features/local-database-sync-sop.md:90-94` | 有备份副本，不具备正式恢复闭环 |
| M3 验收 | 自动测试已存在；交接文件声明主链路执行过，但权威实施记录仍标“待最终验收”，主链路、负向 `startSession`、rebind 两路径三项均未勾选 | `.continue-here.md:2-8`；`doc/features/multi-device-v2.2-migration-impl.md:727,1180-1199` | 代码已实现，正式证据未闭合 |
| JSONL 冷启动 | 只有 append 与 SQLite 投影，没有文件级冷启动扫描、batch/hash-chain 校验或 SQLite 全量重建协调器 | 审查报告 §7-§8；`doc/features/local-database-sync-sop.md:90-94` | Pilot 不承诺自动重建 |
| 多设备 | M1-M3 已有本地身份、Business Session、Grant/Assignment 结构与 IPC；没有 Local Server、REST/SSE、HTTPS/CA、mDNS 或真实跨设备恢复 | `doc/features/multi-device-v2.2-migration-prd.md:24-34,528-535` | 只承诺本机基础，不承诺局域网协同 |

### 1.2 满足 R0 后的 Pilot 对外合同

以下承诺仅在稳定 Pilot tag 创建后生效：

- 超市理货员专业岗位固定示范测评 18 道线上题 + 6 道线下实操题可从空白环境重复构建并完成。
- 拆箱与上架四步训练、实操评分、结果生成和教师可读取的报告形成闭环。
- 学生建档、教师施测，以及教师确认、管理员解决/作废、事实修正可追溯的安全事件闭环可操作。
- 本地 Electron 内可完成教师分配、学生确认、开始测评和继续作答。
- SQLite、JSONL、策略、题目和结果版本具有可追溯证据；SQLite 与 JSONL 可以按同一备份代次真实恢复。

在 tag 创建前，演示文案只能写“R0 收口中”，不得提前使用上述完成时表述。

### 1.3 Pilot 明确不承诺

- `BASE_ABILITY 42+8` 已达到正式可施测状态。
- SQLite 损坏后可从 JSONL 自动完整重建；该能力属于 M5 startupRecovery/event batch 路线。
- 教师平板与学生一体机已实现真实局域网协同。
- 当前结果具有标准化诊断、录用淘汰或职业资格鉴定效力。
- Pilot 已上线 AI 自动评分或 AI 岗位推荐；两项 AI 仍是 `FULL_PRODUCT_1_0` 必选能力，不得降级为 1.0 之后的可选项。
- Pilot 已具备完整正式试卷、M1-M6 完整课程、多岗位课程或多岗位推荐目录。

## 2. 范围分层与冲突记录

### 2.1 当前、R0 与 Full Product 1.0 的边界

| 领域 | `CURRENT_FACT` | `R0_REQUIRED` | `FULL_PRODUCT_1_0` |
|---|---|---|---|
| 题库与测评 | 固定策略存在；仓库重建后 JOB/BASE 均为 DRAFT | 只激活经版本化审核的专业岗位固定 18+6；BASE 全入口禁用 | 正式试卷体系、BASE 正式卷、M1-M6 分项/复测/结业合同 |
| 训练与报告 | 四步训练和评分代码存在；后台可生成报告行 | 真实完成专业岗位测评→训练→复测/评分→结果→可读报告 | 六模块完整课程、未曝光复测和版本化报告发布/纠错 |
| 安全 | 红线触发、熔断和失败结果存在 | 完成教师确认、管理员终态、事实修正和审计 UI/API | M4 三元安全键、多设备下统一安全生命周期 |
| 多设备 | M1-M3 本机结构/IPC 已实现 | 归档 M3 四类真实证据；不宣称跨机 | M4 re-key、M5 Command Bus/recovery/utilityProcess/Teacher Web |
| AI | 未上线 | 不进入 Pilot | 自动评分和自动岗位推荐均为 1.0 必选能力 |
| 运维 | 有迁移/reset 前 DB+JSONL 副本 | 生产账号隔离、安装包、干净机器、配套恢复和演练 | startupRecovery、batch/hash chain、正式 backup manifest 与更完整运维 |

### 2.2 已发现合同冲突

[!] 本机 298 ACTIVE 声明与仓库可重建内容合同冲突

- 文档/代码 A 的事实：`.continue-here.md:2-8` 描述某台本机运行库已有 298 条 ACTIVE JOB 题。
- 文档/代码 B 的事实：当前两份题库源重建后是 `BASE_ABILITY | DRAFT | 96`、`JOB_SPECIFIC | DRAFT | 298`、ACTIVE JOB 为 0；固定题创建要求全部 ACTIVE。
- 实际影响：本机可变数据库即使可演示，也不能证明 release tag 在新安装或 reset 后可运行 18+6。
- 推荐目标：以版本化固定 18+6 激活清单和全新数据库重复构建结果为 Pilot 目标；不得把 298 条批量激活当成替代方案。
- 需要同步修改的文件：题库激活来源/manifest、content-pack metadata 与 verify、`.continue-here.md`、最终 Pilot release record。本轮只修订本文，不同步这些文件。

[!] M3 交接声明与权威实施记录冲突

- 文档/代码 A 的事实：`.continue-here.md:2-8` 声明主链路真实 Electron 冒烟通过。
- 文档/代码 B 的事实：`doc/features/multi-device-v2.2-migration-impl.md:727,1180-1199` 仍为“已实现，待最终验收”，主链路、负向 `startSession`、rebind 两路径均未勾选；仓库内没有对应日志、截图或验收记录。
- 实际影响：无法区分“执行过但未归档”与“尚未执行”，也不能由主链路推断负向和 rebind 已通过。
- 推荐目标：以权威实施记录及其链接的证据包为准；主链路可以在证据补齐后单独通过，其余场景必须分别执行。
- 需要同步修改的文件：`doc/features/multi-device-v2.2-migration-impl.md`、`doc/features/multi-device-v2.2-migration-prd.md`、`.continue-here.md`、`doc/index.md`。本轮不修改这些文件。

[!] 两份固定示范卷的 24 个题目 ID 不一致

- 文档/代码 A 的事实：`doc/specs/impl/03-job-skill-demo-paper-spec.md:35-69` 选择每模块 SC/TF/DG 各一题及一组线下题。
- 文档/代码 B 的事实：`src/main/db/schema.sql:2136-2153` 的 `strategy_job_skill_shelver_v1@1` 选择每模块 3 道 SC 和另一组 OP；两者不是同一集合。
- 实际影响：裁决前没有唯一可审核、可配资产、可写入施测手册的“Pilot 18+6”，不能生成可信激活 manifest。
- 产品裁决（2026-07-18）：Pilot 优先快速收口，以当前 schema 的 `strategy_job_skill_shelver_v1@1` 固定 18+6 作为内容审核候选；旧实施规格中的另一组题不作为本次 Pilot 激活目标。
- 已选目标：先审核、不直接激活。24 题全部通过后方可为 strategy v1 生成激活 manifest；任一题审核不通过时，创建新的 strategy version 替换对应题目，不原地修改 strategy v1 或其历史结果。
- 需要同步修改的文件：strategy seed/schema 或后续 migration、`doc/specs/impl/03-job-skill-demo-paper-spec.md` 的 superseded/导航说明、题库激活 manifest、施测手册、内容 gate 和测试夹具。本轮不修改这些文件。

[!] M3 rebind 两路径合同与当前实现不一致

- 文档/代码 A 的事实：`doc/features/multi-device-v2.2-migration-prd.md:492-503,524-525` 要求“需重确认”时，已确认 assignment 转 `PENDING_CONFIRM` 并清空 `student_confirmed_at`。
- 文档/代码 B 的事实：`src/main/ipc/handlers/assignment.ts:517-530` 拒绝 ACTIVE assignment 携带 `requireReconfirmation=true`；现有测试从未确认的 `PENDING_CONFIRM` 起步。无重确认路径还可能把已为 `ONLINE_IN_PROGRESS` 的 API 响应 phase 返回为 `STUDENT_CONFIRMED`，而 SQLite 并未回退（`assignment.ts:535-566`）。
- 实际影响：不能声称 rebind 两路径均实现；调用返回值与持久化事实不一致也会产生错误恢复判断。
- 推荐目标：本文按现有 M3 PRD 的两路径语义验收：已确认/进行中 assignment 若要求重确认，必须真正阻断继续作答直至重新确认；无需重确认时，API 必须返回 SQLite 的真实 phase。若产品决定只支持 pre-start replacement，必须先显式收窄迁移 PRD、实施记录和 Pilot 合同，不能用现有窄测试冒充原验收项。
- 需要同步修改的文件：`doc/features/multi-device-v2.2-migration-prd.md`、`doc/features/multi-device-v2.2-migration-impl.md`、assignment handler/reducer/types 与测试。本轮只记录冲突，不修改实现。

## 3. R0 收口任务

### 3.1 工作树归属与发布边界

2026-07-18 当前快照为 6 个已修改文件、9 个未跟踪文件、无 staged。该计数包含本轮新增的审查报告，不能反推文件归属。

- 逐项确认未提交文件属于源文件、生成物、临时报告还是会话元数据。
- 源文件与生成物不得分离；生成物必须能由 release commit 中的当前源重复生成。
- 没有生成时间、数据库 identity、内容 hash 或 commit 来源的快照不得作为正式交付证据。
- 不删除、移动或覆盖无法确认归属的用户文件；先记录保留、排除或重生成结论。

当前工作树首轮处置建议：

| 文件/组 | 建议处置 | 当前状态 |
|---|---|---|
| `scripts/question-bank-import.mjs` | 若进入 Pilot 运维，按 R0-G09 修复并独立验收；否则从正式包和运维说明排除 | 待选定路径 |
| `scripts/build-doc-map.mjs` + `package.json` + `doc/doc-map.html` | 逐项复核 diff；若保留文档地图，脚本、命令和可重复生成的 HTML 同组，不能假定 `package.json` 的其他改动均属该工具 | 待确认归属 |
| `doc/features/base-ability-42plus8-evaluation-memo.md` | 只作为讨论备忘录；“本机运行库”事实必须带日期、DB identity 和 commit，不得升级为 Pilot 合同 | 待专业评审 |
| `doc/features/question-bank-review-report.json` | 当前缺生成时间、DB identity 和 commit；不得根据某台库的 298 ACTIVE 声明判断其新旧，补 provenance 后重生成或排除 | 待确认归属 |
| `doc/features/full-product-1.0-planning-review-2026-07-18.md` | 保留为审查快照，不作为产品合同 | 已明确性质，待提交决策 |
| `doc/features/mvp-pilot-freeze-plan.md` + `doc/specs/FULL_PRODUCT_PRD_v2.0-draft.md` + `doc/features/multi-device-m4-m5-{prd,impl}.md` + `doc/index.md` | 分别保持 R0 合同、Full Product DRAFT、M4/M5 DRAFT、导航的权威性；评审状态不得混写 | 待分别评审 |
| `.learnings/ERRORS.md` | 项目元数据独立处置，不与 release 产品合同混成一个无法审查的改动 | 待确认归属 |
| `.continue-here.md` + `doc/会话启动.md` | R0 收口最后刷新；先消除 M3 状态冲突，不能保留“全部完成”的泛化声明 | 收口最后执行 |

### 3.2 产品入口冻结

- `BASE_ABILITY` 在所有可达入口禁用或明确显示“内容审核中，暂不可发起”，且不作为默认值。
- 专业岗位入口标记为“超市理货员示范测评 / Pilot”。
- 未接入的课程、训练模块、报告出口不得生成虚假链接。
- 教师界面不展示尚未完成的真实跨设备、AI、标准化诊断或证书承诺。
- 后端必须增加显式 Pilot fail-closed gate；当前 canonical seed 只是因策略字段漂移和 DRAFT 题事故性失败，兼容策略加 ACTIVE 题仍可能成功。隐藏或禁用 UI 不能代替 IPC/领域层阻断。

### 3.3 文档和版本治理

- `doc/specs/MVP_PRD_v1.0.9-authoritative.md` 保持字节级历史正文，不为 R0、M4 或 Full Product 增加覆盖说明。
- 应用版本、PRD 版本、schema 版本、题库激活 manifest 版本和安装 artifact hash 分别记录。
- M3 不得直接改成“已验收”；先逐场景归档证据，再更新对应勾选项。
- 最终 release record 必须包含 Pilot 已实现/未实现能力矩阵和已知限制，且链接到各 R0 证据。

### 3.4 R0 证据最小格式

每个闸门的证据至少记录：

- release candidate commit、工作树状态和 artifact SHA-256；
- 操作时间、操作人、复核人；
- OS/架构、Electron 版本、应用版本；
- SQLite 路径脱敏 identity、schema migration 列表、内容 manifest 版本；
- 输入、预期输出、实际输出、通过/失败；
- 日志、截图、测试报告或只读 SQL 查询结果的仓库内位置；
- 若失败，保留失败证据和修复后新证据，不覆盖原记录。

仅有“执行过”“冒烟通过”或未带运行身份的截图，不算可追溯证据。

## 4. R0 可机械验收矩阵

### 4.1 闸门总表

| ID | 闸门 | 当前状态 | 阻断对象 |
|---|---|---|---|
| R0-G00 | 工作树归属与 release commit | `NOT PASSED` | Pilot tag |
| R0-G01 | 版本化 ACTIVE 18+6 | `NOT PASSED` | Pilot 核心测评 |
| R0-G02 | BASE_ABILITY 全入口禁用 | `NOT PASSED` | Pilot 入口真实性 |
| R0-G03 | 安全事件完整生命周期 | `NOT PASSED` | Pilot 安全责任边界 |
| R0-G04 | 报告读取与展示 | `NOT PASSED` | Pilot 结果闭环 |
| R0-G05 | 生产构建不植入公开开发账号 | `NOT PASSED` | Pilot 权限边界 |
| R0-G06 | 可安装产物与干净机器 | `NOT PASSED` | Pilot 发布 |
| R0-G07 | SQLite + JSONL 配套备份和真实恢复 | `NOT PASSED` | Pilot 数据恢复 |
| R0-G08 | M3 主链路、负向 startSession、rebind 两路径证据 | `NOT PASSED` | Pilot 本机分配链路 |
| R0-G09 | 题库导入运维安全 | `NOT PASSED` | Pilot 运维路径 |
| R0-G10 | 工程、迁移和完整 Pilot 闭环 | `NOT PASSED` | Pilot tag |

### R0-G00：工作树归属与 release commit

- **输入：** 当前 `git status --short`、每个 diff/untracked 文件、生成源和 provenance。
- **预期输出：** 每个文件都有责任人和“纳入 / 重生成后纳入 / 明确排除 / 保留待后续”的结论；纳入 tag 的生成物可由同一 commit 重建；release commit 对应工作树干净，无未知文件、无误删用户内容。
- **验证方式：** 逐文件 review；对生成物执行确定性重建和 hash/diff；运行 `git status --short`、`git diff --check`，并把处置表写入 release record。
- **通过条件：** 不以 `git add` 或忽略文件掩盖未知归属；tag 精确指向唯一已评审 commit。

### R0-G01：版本化 ACTIVE 18+6 激活清单

根据 2026-07-18 产品裁决，当前 schema 中 `strategy_job_skill_shelver_v1@1` 的固定 24 题是本次 Pilot 的唯一内容审核候选。候选不等于已审核或已激活：

```text
M1: M1_SC_001, M1_SC_004, M1_SC_007, M1_OP_033
M2: M2_SC_002, M2_SC_003, M2_SC_005, M2_OP_027
M3: M3_SC_001, M3_SC_005, M3_SC_019, M3_OP_043
M4: M4_SC_001, M4_SC_003, M4_SC_005, M4_OP_029
M5: M5_SC_001, M5_SC_002, M5_SC_009, M5_OP_039
M6: M6_SC_003, M6_SC_009, M6_SC_012, M6_OP_035
```

- **当前额外事实：** schema 候选集的 24/24 题当前均为 DRAFT 且 `answer_key_status=PENDING`；6/6 线下题 `rubric_anchor_status=PENDING`，18 道线上题的 presentation assets 为空。现有 review gate 不检查这些审核状态，并可能为全部 298 个 eligible ID 生成激活 SQL，不能替代固定卷人工审核。
- **内容审核结果（2026-07-19）：** 陈晓青已提交 24 题逐题结果，Schema、题目集合、版本和候选 hash 校验通过。11 题内容通过，13 题退回修改，0 题否决；正式结论已归档到 `archive/job-skill-shelver-pilot-r0-v1-v2/`。R0-G01 因未达到 24 题全部通过且安全、技术复核尚未完成，继续保持 `NOT PASSED`。
- **修订候选（2026-07-19）：** 13 道退回题已按 PRD 的新 question ID 规则建立 `_V2` 候选，strategy v2 候选固定集由 11 道已通过原题和 13 道修订题组成。manifest v2 保持 `PENDING` 和 `activation_authorized=false`，运行库 seed 尚未写入；13 道修订题等待陈晓青复确认，24 题等待赫东完成安全与技术审核。
- **安全与技术审核（2026-07-19）：** 赫东已提交 strategy v2 的24题结果并通过 Schema、集合、版本、candidate hash 和汇总复算校验。技术通过11题、退回13题；安全通过19题、退回5题。审核结论只对绑定的 v2 candidate hash 有效，相关证据已归档到 `archive/job-skill-shelver-pilot-r0-v1-v2/`。
- **strategy v3 修复候选（2026-07-19）：** 已依据 `job-skill-shelver-pilot-13-question-revision-and-renderer-fix-v1.0.md` 创建 v3。7道在线题使用新 ID/版本/hash，6道离线题保持 v2 ID、版本和hash，仅修复独立渲染器。当前权威入口为 `job-skill-shelver-pilot-current-question-authority.md`，manifest v3 继续 fail closed；19题等待内容确认，7道在线题等待安全与技术复审，6道离线题等待真实 Electron 见证和技术复审。
- **输入：** 已记录的产品裁决、空白 userData、release candidate、版本化激活 manifest。manifest 必须逐题记录 question ID/version、内容 hash、答案或 rubric 审核状态、审核人/时间、renderer、所需资产/工具及其 hash，并绑定唯一 strategy ID/version、content-pack 版本和 commit。
- **预期输出：** 若 24 题全部通过审核，manifest 必须与其绑定的当前 strategy version 双向集合完全一致，18 个线上题和 6 个线下题方可进入 Pilot 固定卷并成为 `ACTIVE`。任一题缺失、DRAFT、hash 漂移、答案/rubric 审核未完成、renderer 未注册或资源不可用时，R0-G01 保持失败并创建新 strategy version 处理替换，不回写任何历史版本；初始化/verify 必须 fail closed。其余 JOB 题不得因“凑足 298 ACTIVE”被无条件批量激活；content-pack metadata 必须对齐 schema v0.1.15 并验证 M1/M2/M3 ledger。
- **验证方式：** 对 manifest 与 strategy 做双向集合差；从空库执行正式内容初始化两次；查询 24 题状态、版本、审核状态和 hash；比较两次语义 digest；运行专用 JOB fixed-set gate，确认任何单题改成 DRAFT、PENDING 或 hash 漂移都失败；在真实 Electron 创建并完成固定卷。
- **通过条件：** 新安装和 reset 均可重复得到相同 24 题合同；某台本机数据库的手工 UPDATE 不计入证据。

### R0-G02：BASE_ABILITY 禁用状态

- **输入：** 空库初始化后的 canonical BASE 96 条、教师创建页、所有可达学生/教师入口，以及两组直接 `assessment:createSession` 请求：当前 DRAFT 内容；人为构造的兼容策略 + 足量 ACTIVE 42+8 对抗数据。
- **预期输出：** BASE 96 条保持 `DRAFT/NO_SCORE`，不批量转 ACTIVE；UI 隐藏或显示“内容审核中，暂不可发起”，控件不可提交且不是默认项；专业岗位为默认可用入口；两组绕过 UI 的直接请求都返回稳定、可翻译的 `PILOT_FEATURE_DISABLED` 或等价专用错误，不创建 business/assessment/session_question，不写 `SESSION_STARTED`。不得依赖策略解析异常或题量不足实现“事故性阻断”。
- **验证方式：** 组件/路由测试、两组 handler 负向测试、真实 Electron 截图与操作录像；只读查询 BASE 状态、business/session/question/event 数量；重启后状态不变化。
- **通过条件：** 不存在“可点击后才报题库不足”的假入口。

### R0-G03：安全事件确认、解决、作废和事实修正闭环

- **输入：** 分别构造从开放 assessment 触发、只有开放 training 或没有开放 session 时独立记录现场红线、教师补充详情并确认、管理员解决、`FALSE_TRIGGER/NON_SAFETY_EVENT` 作废、`DUPLICATE_RECORD/FACTUAL_CORRECTION` replacement，以及未授权角色调用；在 incident 终态前后尝试创建同学生/任务新会话。
- **预期输出：**
  - 触发后创建不可变来源事实，incident 从 `PENDING_DETAIL` 开始，会话熔断并保留安全失败结果；
  - 安全事件不依赖必须先找到一条开放 assessment；只有 training 或暂时无开放 session 时仍能按学生/岗位/任务记录，并对存在的开放对象逐一 binding/熔断；
  - 只有 ACTIVE TEACHER 可确认详情并转为 `CONFIRMED`；
  - 只有 ACTIVE ADMIN 可转为 `RESOLVED/VOIDED`，必须记录 actor、时间和原因；
  - 事实修正或重复记录不覆盖原 incident，而是创建 replacement 并保留双向可追溯关系；
  - `PENDING_DETAIL/CONFIRMED` 持续阻断新会话，只有满足冻结安全合同的终态才解除阻断；
  - 每个被批量熔断的 assessment/training 都有可追溯 binding 和可读取的安全结论；不能只有触发按钮所在的目标 assessment 得到结果；
  - UI 能列出待处理项、展示历史和完成上述授权操作；未授权调用返回 `FORBIDDEN` 且无写入。
- **验证方式：** schema/handler/权限集成测试和 replacement 事务故障注入；逐状态只读 SQL；真实 Electron 以教师、管理员和未授权用户分别冒烟；核对 domain event、incident、每个受影响 aggregate 的 binding/result 及审计记录。
- **通过条件：** 创建、确认、终态和 correction 任一路径不可操作即失败；不能只靠直接改数据库完成验收。

### R0-G04：报告读取和展示

- **输入：** 一个已完成且已有 current `JOB_SKILL_SCORE` 的专业岗位 session、授权教师、未授权用户，以及一次报告构建/INSERT 故障注入。
- **预期输出：** 后台幂等生成一条 `FULL_REPORT`；完成会话进入可查询历史列表，授权教师可从产品 UI 打开并读取持久化 `report_content_json`，页面明确展示 report/result/session ID、策略/题库/评分版本、生成时间、分模块分数、安全摘要和支持建议；重复打开不生成新报告；未授权用户不可读取。报告生成失败必须形成可审计状态和受控重试入口，不能只写 `console.error` 后永久丢失报告。
- **验证方式：** handler/权限/幂等/失败重试测试；真实 Electron 从完成历史进入报告页；将 UI 字段与 `task_report`、`result_record` 只读查询逐项对照；重启后仍可读取同一 report ID；故障解除后重试只生成一个 current 报告。
- **通过条件：** 后端存在 `task_report` 行但无读取/展示入口不算通过。若产品负责人决定取消报告 UI，必须先删除 Pilot 的“报告闭环”对外承诺并重新审批本文，不得直接把本闸门标为通过。

### R0-G05：生产构建不得植入公开开发账号

- **输入：** Pilot production package + 全空 userData；仓库已公开的开发账号；一份已有正式账号的升级库。
- **预期输出：**
  - 首次启动不创建 `seed-admin-001`、`seed-teacher-001`、`seed-student-001`，仓库公开凭据均无法登录；
  - production bundle 不包含开发密码或 seed ID；
  - 首个管理员通过受控安装配置或一次性凭据建立，并在正式使用前完成轮换，过程留审计；
  - 已有正式库重启/升级不新增开发账号，也不改变正式账号密码、角色或状态；
  - 开发模式仍可显式 seed，但其开关不能由普通 Pilot 用户在运行时开启。
- **验证方式：** 扫描最终 main bundle；查询首次启动和重启前后的 `user_account`；逐一尝试公开凭据；执行首次管理员建立与轮换；测试 production/development 配置隔离。
- **通过条件：** 仅在 README 标“开发账号”而生产代码仍自动 seed，判失败。

### R0-G06：可安装产物和干净机器验收

- **输入：** release commit、正式 package 命令，以及无 Node/npm/sqlite3 CLI、无历史 userData 的目标学校 Windows 干净 VM/实体机；目标 OS 版本与架构必须写入 release record。
- **预期输出：**
  - 生成带应用版本和 SHA-256 的安装 artifact，包含 main/preload/renderer、schema、匹配 Electron ABI 的 `better-sqlite3`、Pilot 内容和必需资产；
  - 普通授权用户可安装、启动、退出和再次启动；首次 schema/content 初始化成功，无 native ABI 错误，userData 可写；
  - 从上一 Pilot 候选版升级时保留已知业务记录，migration 只执行一次；
  - 卸载只按发布说明处理应用文件和 userData，不静默删除业务数据。
- **验证方式：** 记录 package 命令、artifact 清单/hash；在干净机执行安装和首次启动；保存 Electron 日志并查询 schema/content/account；对带已知记录的旧版本执行升级和双重启；执行卸载/重装并核对声明。
- **通过条件：** `npm run build` 通过不能替代 installer 和干净机器证据。

### R0-G07：SQLite + JSONL 配套备份与真实恢复

- **输入：** 应用已停止、包含已知 student/session/answer/score/result/report/safety 记录和 `action_log.jsonl` 的数据目录；有效同代备份；故意损坏的当前库；DB 与 JSONL 来自不同代次的错误组合。
- **预期输出：**
  - 备份在无并发写入下生成同一 generation 的一致性 SQLite 与 JSONL，并带 manifest：generation ID、schema/app 版本、文件大小/SHA-256、创建时间、投影/JSONL 对齐检查结果；
  - 备份失败时 migration/reset 不开始；
  - 正式 restore 命令或明确 SOP 在 staging 中校验 hash、`PRAGMA integrity_check`、`foreign_key_check` 和代次关系，全部通过后再替换当前数据；
  - 恢复后应用正常启动，已知业务主键、结果、报告和安全历史可读；
  - 混用代次、hash 不符或校验失败时 fail closed，恢复前当前目录保持可回退。
- **验证方式：** 做一次真实故障注入和恢复演练；保存 backup/restore 日志、manifest、恢复前后 SQL 对照和应用截图；交换 DB/JSONL 后确认明确拒绝。
- **通过条件：** 只证明 `VACUUM INTO` 和复制 JSONL 成功不算通过；R0 不要求从 JSONL 重建 SQLite，但必须能同时恢复配套文件。

### R0-G08：M3 主链路、负向 startSession 和 rebind 两路径证据

- **输入与预期输出：**

| 场景 | 输入 | 预期输出 |
|---|---|---|
| 主链路 | 教师创建 assessment → `assignment:create` → 学生确认 → `assignment:startAssessment` → 答第一题 | phase 依次为 `PREPARED → ASSIGNED → STUDENT_CONFIRMED → ONLINE_IN_PROGRESS`；首题和 answer/event 落盘；重启后可继续 |
| 负向 PREPARED | 对未分配 session 直接调用 `assessment:startSession` | 返回 `ASSIGNMENT_REQUIRED`；phase、version、事件数不变 |
| 负向 ASSIGNED | 对未确认 session 直接调用 `assessment:startSession` | 返回 `STUDENT_CONFIRMATION_REQUIRED`；phase、version、事件数不变 |
| rebind 无需重确认 | ACTIVE assignment + crash restart 新 runtime | 旧 grant EXPIRED、新 grant ACTIVE、assignment 指向新 grant且 version+1；assignment 保持 ACTIVE，确认事实和数据库 delivery phase 不倒退 |
| rebind 需要重确认 | 已确认 assignment + graceful/replacement 新 runtime | 旧 grant EXPIRED、新 grant ACTIVE、assignment 指向新 grant且 version+1；状态转 `PENDING_CONFIRM`，`student_confirmed_at` 清空，重新确认前不能开始 |

- **验证方式：** 每个场景分别执行真实 Electron 主进程/IPC 冒烟，并保留自动测试输出；记录 Electron/app 版本、DB identity、grant/assignment/session/event 的前后只读查询、日志和 UI/调用结果。rebind 必须核对数据库实际 phase，不能只检查返回 DTO。
- **通过条件：** 五个场景逐项有独立证据，并链接回 `doc/features/multi-device-v2.2-migration-impl.md:1188-1190`；主链路交接声明不能替代另外四个场景。

### R0-G09：题库导入运维安全

- **输入：** 含小数/越界 `difficulty_level`、含历史 session/answer/score 引用的目标库、sqlite3 CLI 路径和带确定 source row 的导入样本。
- **预期输出（两条路径必须明确选择一条）：**
  - **正式运维路径：** 非整数或越界难度在写 SQL 前被拒绝；存在历史引用时拒绝物理清库/重导；CLI 显式启用 `PRAGMA foreign_keys=ON`；`source_row/imported_at/imported_by` 与真实输入一致；
  - **开发工具路径：** 导入器不进入 production package、Pilot 运维文档或任何可由学校用户触发的入口，并明确标注会破坏开发数据。
- **验证方式：** 正式路径运行 CLI 级正负回归并对数据库做前后查询；开发路径扫描 artifact、菜单、package scripts 和 Pilot SOP，确认无正式入口。
- **通过条件：** 不能一边标“开发工具”一边让正式运维依赖它激活或重建题库。

### R0-G10：工程、迁移和完整 Pilot 闭环

- **输入：** 最终 release candidate commit、空库、v0.1.12 真实夹具、目标安装 artifact，以及一名测试学生。
- **预期输出：**
  - `npm run typecheck`、`npm run lint`、`npm test`、`npm run build`、`npm run docs:index:check`、`git diff --check` 全部按 release commit 记录；lint 不得有新增 error；
  - 空库初始化成功；v0.1.12 → v0.1.13 → v0.1.14 → v0.1.15 顺序迁移成功，原业务主键/数量不变，重复启动不重复迁移；失败时可用 R0-G07 的配套备份恢复；
  - 在安装 artifact 上完成学生建档 → 教师分配 → 学生确认 → 专业岗位 18 线上题 → 6 线下实操评分 → result → 教师可读 report；
  - 完成拆箱与上架四步训练、重启继续和训练结果核对；
  - 至少执行一次红线触发 → 教师确认 → 管理员终态，并证明开放会话阻断/解除符合合同；
  - 发布说明准确列出 §1.3 的不承诺项。
- **验证方式：** 保存全部命令退出码和报告；在干净安装环境执行真实 Electron 端到端；用只读 SQL 核对 session/assignment/answer/offline score/result/report/training/safety/event；让独立复核人按证据重放。
- **通过条件：** 任何子链路未完成都不得用单元测试总绿替代；本轮文档修改不执行这些未来发布命令，也不把历史结果记为当前通过。

## 5. Pilot 冻结完成定义

同时满足以下条件后，才能冻结：

1. R0-G00 至 R0-G10 全部有符合 §3.4 的 `PASSED` 证据，且没有豁免项或“稍后补证”。
2. 固定 18+6 可从 release tag 的仓库内容在空白环境重复构建；BASE 保持不可发起。
3. 安全事件、报告、生产账号、安装和恢复均在真实 artifact 上通过，而不只是源码或测试夹具通过。
4. M3 主链路、PREPARED/ASSIGNED 负向启动、rebind 两路径分别归档并同步权威实施记录。
5. 所有已知偏差进入 release notes，没有把 `R0_REQUIRED` 或 `FULL_PRODUCT_1_0` 写成 `CURRENT_FACT`。
6. 冻结的 MVP PRD 正文未被修改；Full Product 和 M4/M5 仍按各自 DRAFT/权威状态管理。
7. release commit 工作树干净、来源明确，Pilot tag 精确指向该 commit，并记录安装 artifact SHA-256。

任一条件失败时，结论只能是“R0 收口中”或“工程环境演示”，不能创建稳定 Pilot tag。

## 6. 冻结后的变更规则

冻结后只允许以下修订进入 Pilot 维护分支：

- P0/P1 数据安全、崩溃、权限和安全红线缺陷。
- 安装、迁移、备份和恢复阻断问题。
- 不改变产品语义的文案、兼容性和可访问性修复。

正式试卷、BASE 正式卷、M1-M6 完整课程、真实多设备、AI 自动评分、AI 岗位推荐、家长/企业端等功能统一进入 Full Product 1.0 路线。AI 两项能力仍是产品 1.0 必选项。

## 7. 本文评审后的下一步唯一原子动作

只为上述 24 个审核候选设计版本化激活 manifest 和逐题审核清单：初始状态全部保持 `PENDING/NOT_REVIEWED`，记录答案、rubric、renderer、素材、工具、安全、hash 和审核人字段；不执行激活 SQL，不修改 strategy v1，不批量处理其余 274 条 JOB 题，也不同时推进 BASE、安全、M4 或 M5。
