# 专业岗位 Pilot 固定 18+6 逐题审核清单 v1

> [!WARNING]
> 本清单的逐题表是 strategy v1 历史审核快照。当前题目与素材生产入口已经切换到 `job-skill-shelver-pilot-current-question-authority.md` 和 `job-skill-shelver-pilot-revision-candidates-v3.json`，不得继续按下表旧题干或旧 hash 制作素材。

- 状态：内容审核已提交，固定集门禁仍为 `PENDING` / `NOT PASSED`
- 适用策略：`strategy_job_skill_shelver_v1@1`
- 机器合同：`doc/features/job-skill-shelver-pilot-activation-manifest-v1.json`
- 内容审核入口：`doc/features/job-skill-shelver-pilot-content-review-packet-v1.html`
- 审核结果合同：`doc/features/job-skill-shelver-pilot-review-result-v1.schema.json`
- 内容审核原始结果：`doc/features/job-skill-shelver-pilot-content-review-result-2026-07-19.json`
- 内容审核正式结论：`doc/features/job-skill-shelver-pilot-content-review-conclusion-2026-07-19.md`
- strategy v2 修订候选集：`doc/features/job-skill-shelver-pilot-revision-candidates-v2.json`
- strategy v2 activation manifest：`doc/features/job-skill-shelver-pilot-activation-manifest-v2.json`
- strategy v3 当前修复候选集：`doc/features/job-skill-shelver-pilot-revision-candidates-v3.json`
- strategy v3 activation manifest：`doc/features/job-skill-shelver-pilot-activation-manifest-v3.json`
- 赫东审核入口：`doc/features/job-skill-shelver-pilot-safety-technical-review-packet-v2.html`
- 安全与技术结果合同：`doc/features/job-skill-shelver-pilot-safety-technical-review-result-v1.schema.json`
- Markdown 内容快照：`doc/features/job-skill-shelver-pilot-content-review-packet-v1.md`（只读参考）
- 范围：仅当前 schema 固定集的 18 道线上题 + 6 道线下题；不覆盖其余 274 条 JOB 题。
- 禁止动作：本清单不授权执行激活 SQL，不授权修改 strategy v1，不授权把任一候选题改为 `ACTIVE`。
- 内容/职教审核人：陈晓青（已于 2026-07-19 提交逐题审核结果）
- 安全复核人：赫东（已完成 strategy v2 审核，7道新在线候选需重新复审）
- 技术复核人：赫东（已完成 strategy v2 审核，7道新在线候选与6道渲染修复题需重新复审）
- 责任人指定时间：`2026-07-19T01:29:20+08:00`
- 审核包状态：陈晓青已通过交互式 HTML 提交结果。结果经 Schema、24 题集合、版本、候选 hash 和汇总重算校验通过；提交结果不改变任何题目状态。
- 后续审核包状态：赫东已提交 strategy v2 审核结果；当前 strategy v3 仍有19题等待陈晓青确认，7道在线新候选等待安全和技术复审，6道离线题等待真实 Electron 见证和技术复审。

内容审核汇总：11 题 `APPROVED`，13 题 `RETURN_FOR_REVISION`，0 题 `REJECTED`。18 道线上题均裁决为纯文本审核可接受，但其中 7 题仍因内容问题退回。完整理由以原始结果和正式结论为准。

## 1. 审核结论规则

每题只有同时满足以下条件，`overall_status` 才能从 `PENDING` 改为 `APPROVED`：

1. 线上题答案键经专业复核，线下题完成可观察、互斥且可执行的 0/1/2 三档 rubric 锚点复核。
2. renderer 在真实 Electron 中展示题干、选项或评分锚点，无未注册题型和静默降级。
3. 所需数字素材与线下工具逐项可用；存在文件的资源必须记录 SHA-256，只有文字需求但尚无交付物时不得填 `APPROVED`。
4. `safety_sensitive`、停止条件和施测保护经专业复核，尤其是 `M2_OP_027` 与 `M5_OP_039`。
5. 复算 `candidate_record_hash` 与 manifest 一致，并填写审核人、审核时间和审核备注。

任一项失败时，该题保持 `PENDING` 或标记 `REJECTED`。如需换题，创建新的 strategy version；不得原地修改 strategy v1 或历史结果。

## 2. 已知阻断

[已解决-工程门禁] `scripts/config/database-content-pack.json` 已升级到 `2026.07.19.1`，绑定 `0.1.15-multi-device-m3-grant-assignment`，并要求 M1/M2/M3 三条 migration ledger 全部存在。manifest v1 仍保留对齐前的初始审核快照；最终 release binding 必须由后续 manifest 版本绑定新 content-pack hash，不得回写覆盖本快照。

[已修复-待见证] 6道线下题现已通过独立离线实操组件展示题干、工具、观察指标、完整0/1/2锚点和停止条件；教师端评分提交会保存命中锚点和锚点版本，学生端不返回密封配置。真实 Electron 双端见证完成前，技术结论仍不得改为通过。

[!] 18 道线上题的 `presentation.assets` 均为空。是否允许纯文本施测必须逐题裁决；若素材必需，须绑定可用资产及 SHA-256。

[已解决-内容裁决] 陈晓青已裁决 18 道线上题在内容审核阶段均可采用纯文本，不要求先补图片或视频。该裁决不替代 renderer 和真实 Electron 展示复核。

[!] 内容审核要求将 `M2_SC_003`、`M5_SC_001`、`M5_SC_002`、`M5_SC_009` 标记为安全敏感，但 manifest v1 中 4 题的 `safety.source_sensitive` 均为 `false`。该冲突必须由赫东在安全复核中裁决。

[已处理-版本化候选] 13 道退回题已按 PRD 的作废重建规则使用新 question ID（原 ID 后缀 `_V2`）建立修订候选，strategy v2 固定集复用 11 道内容已通过题并替换 13 道退回题。manifest v2 仍为 `PENDING`，未写入运行库，未授权激活。

[!] 13 道 `_V2` 修订题尚未由陈晓青复确认。赫东的安全与技术结论不能替代内容复确认。

## 3. 逐题清单

表中 `答案/锚点` 仅记录当前候选值，不代表已确认。hash 为 manifest 中的候选记录 SHA-256 短写，完整值以机器合同为准。

| 题目 | 类型 | 当前候选答案/锚点 | Renderer | 素材/工具 | 安全 | Hash | 审核人/时间 | 结论 |
|---|---|---|---|---|---|---|---|---|
| M1_SC_001@1 | 线上单选 | A / `NOT_REVIEWED` | `AssessmentView:SINGLE_CHOICE` / `NOT_REVIEWED` | 摆放规范R1；asset 为空 / `NOT_REVIEWED` | false / `NOT_REVIEWED` | `c109e889…` | — / — | `PENDING` |
| M1_SC_004@1 | 线上单选 | B / `NOT_REVIEWED` | `AssessmentView:SINGLE_CHOICE` / `NOT_REVIEWED` | 分层摆放R5；asset 为空 / `NOT_REVIEWED` | false / `NOT_REVIEWED` | `e744f295…` | — / — | `PENDING` |
| M1_SC_007@1 | 线上单选 | A / `NOT_REVIEWED` | `AssessmentView:SINGLE_CHOICE` / `NOT_REVIEWED` | 价签核对要点R3；asset 为空 / `NOT_REVIEWED` | false / `NOT_REVIEWED` | `27e19951…` | — / — | `PENDING` |
| M1_OP_033@1 | 线下实操 | 泛化 0/1/2 / `NOT_REVIEWED` | `JobSkillScoringView:OFFLINE_OPERATION` / `NOT_REVIEWED` | 迷你货架1组；5件实物商品（大小不一） / `NOT_REVIEWED` | false / `NOT_REVIEWED` | `d7b99fc4…` | — / — | `PENDING` |
| M2_SC_002@1 | 线上单选 | A / `NOT_REVIEWED` | `AssessmentView:SINGLE_CHOICE` / `NOT_REVIEWED` | FIFO规则再认R6；asset 为空 / `NOT_REVIEWED` | false / `NOT_REVIEWED` | `e7340e01…` | — / — | `PENDING` |
| M2_SC_003@1 | 线上单选 | A / `NOT_REVIEWED` | `AssessmentView:SINGLE_CHOICE` / `NOT_REVIEWED` | 安全拆箱操作；asset 为空 / `NOT_REVIEWED` | false / `NOT_REVIEWED` | `265a18fb…` | — / — | `PENDING` |
| M2_SC_005@1 | 线上单选 | A / `NOT_REVIEWED` | `AssessmentView:SINGLE_CHOICE` / `NOT_REVIEWED` | FIFO双批次应用R6；asset 为空 / `NOT_REVIEWED` | false / `NOT_REVIEWED` | `b65e89ac…` | — / — | `PENDING` |
| M2_OP_027@1 | 线下实操 | 泛化 0/1/2 / `NOT_REVIEWED` | `JobSkillScoringView:OFFLINE_OPERATION` / `NOT_REVIEWED` | 整箱商品1箱（胶带封装） / `NOT_REVIEWED` | true / `NOT_REVIEWED` | `39fd7d93…` | — / — | `PENDING` |
| M3_SC_001@1 | 线上单选 | A / `NOT_REVIEWED` | `AssessmentView:SINGLE_CHOICE` / `NOT_REVIEWED` | 效期计算基础R7；asset 为空 / `NOT_REVIEWED` | false / `NOT_REVIEWED` | `8633ff8f…` | — / — | `PENDING` |
| M3_SC_005@1 | 线上单选 | B / `NOT_REVIEWED` | `AssessmentView:SINGLE_CHOICE` / `NOT_REVIEWED` | 临期判别15天门槛R7；asset 为空 / `NOT_REVIEWED` | false / `NOT_REVIEWED` | `4394fb24…` | — / — | `PENDING` |
| M3_SC_019@1 | 线上单选 | B / `NOT_REVIEWED` | `AssessmentView:SINGLE_CHOICE` / `NOT_REVIEWED` | 临期商品处置R7；asset 为空 / `NOT_REVIEWED` | false / `NOT_REVIEWED` | `689fb511…` | — / — | `PENDING` |
| M3_OP_043@1 | 线下实操 | 泛化 0/1/2 / `NOT_REVIEWED` | `JobSkillScoringView:OFFLINE_OPERATION` / `NOT_REVIEWED` | 货架、日期商品、临期/报损标识 / `NOT_REVIEWED` | false / `NOT_REVIEWED` | `f1c77eb7…` | — / — | `PENDING` |
| M4_SC_001@1 | 线上单选 | B / `NOT_REVIEWED` | `AssessmentView:SINGLE_CHOICE` / `NOT_REVIEWED` | 入库基本规范R5；asset 为空 / `NOT_REVIEWED` | false / `NOT_REVIEWED` | `714ac74a…` | — / — | `PENDING` |
| M4_SC_003@1 | 线上单选 | A / `NOT_REVIEWED` | `AssessmentView:SINGLE_CHOICE` / `NOT_REVIEWED` | 收货核对R12；asset 为空 / `NOT_REVIEWED` | false / `NOT_REVIEWED` | `e60fc387…` | — / — | `PENDING` |
| M4_SC_005@1 | 线上单选 | B / `NOT_REVIEWED` | `AssessmentView:SINGLE_CHOICE` / `NOT_REVIEWED` | 数量不符停收上报R12；asset 为空 / `NOT_REVIEWED` | false / `NOT_REVIEWED` | `ac08e25f…` | — / — | `PENDING` |
| M4_OP_029@1 | 线下实操 | 泛化 0/1/2 / `NOT_REVIEWED` | `JobSkillScoringView:OFFLINE_OPERATION` / `NOT_REVIEWED` | 货架、商品、记录本 / `NOT_REVIEWED` | false / `NOT_REVIEWED` | `78b9a9bc…` | — / — | `PENDING` |
| M5_SC_001@1 | 线上单选 | B / `NOT_REVIEWED` | `AssessmentView:SINGLE_CHOICE` / `NOT_REVIEWED` | 地面水渍安全处置；asset 为空 / `NOT_REVIEWED` | false / `NOT_REVIEWED` | `2e7999af…` | — / — | `PENDING` |
| M5_SC_002@1 | 线上单选 | B / `NOT_REVIEWED` | `AssessmentView:SINGLE_CHOICE` / `NOT_REVIEWED` | 货架安全隐患应急；asset 为空 / `NOT_REVIEWED` | false / `NOT_REVIEWED` | `1c9ca58f…` | — / — | `PENDING` |
| M5_SC_009@1 | 线上单选 | B / `NOT_REVIEWED` | `AssessmentView:SINGLE_CHOICE` / `NOT_REVIEWED` | 玻璃碎片安全处置；asset 为空 / `NOT_REVIEWED` | false / `NOT_REVIEWED` | `a76f0177…` | — / — | `PENDING` |
| M5_OP_039@1 | 线下实操 | 泛化 0/1/2 / `NOT_REVIEWED` | `JobSkillScoringView:OFFLINE_OPERATION` / `NOT_REVIEWED` | 警示牌、水渍、清洁工具 / `NOT_REVIEWED` | true / `NOT_REVIEWED` | `72849591…` | — / — | `PENDING` |
| M6_SC_003@1 | 线上单选 | B / `NOT_REVIEWED` | `AssessmentView:SINGLE_CHOICE` / `NOT_REVIEWED` | 冷链商品识别A组；asset 为空 / `NOT_REVIEWED` | false / `NOT_REVIEWED` | `ce435dea…` | — / — | `PENDING` |
| M6_SC_009@1 | 线上单选 | B / `NOT_REVIEWED` | `AssessmentView:SINGLE_CHOICE` / `NOT_REVIEWED` | 近邻商品区分原则B组；asset 为空 / `NOT_REVIEWED` | false / `NOT_REVIEWED` | `aa0310c1…` | — / — | `PENDING` |
| M6_SC_012@1 | 线上单选 | B / `NOT_REVIEWED` | `AssessmentView:SINGLE_CHOICE` / `NOT_REVIEWED` | 条形码功能知识；asset 为空 / `NOT_REVIEWED` | false / `NOT_REVIEWED` | `445b250d…` | — / — | `PENDING` |
| M6_OP_035@1 | 线下实操 | 泛化 0/1/2 / `NOT_REVIEWED` | `JobSkillScoringView:OFFLINE_OPERATION` / `NOT_REVIEWED` | 6件商品；带区域标识货架 / `NOT_REVIEWED` | false / `NOT_REVIEWED` | `11f5afca…` | — / — | `PENDING` |

## 4. Manifest 级复核

- [ ] 24 题集合与 `strategy_job_skill_shelver_v1@1` 双向差集均为空。
- [ ] 18 道线上题、6 道线下题计数准确，且未包含其余 274 条 JOB 题。
- [ ] release commit、schema、题库源、导入源、content-pack 版本与 SHA-256 均已绑定。
- [ ] content-pack schema version 已与 `0.1.15-multi-device-m3-grant-assignment` 对齐。
- [ ] 24 题逐项均为 `APPROVED`，不存在 `PENDING`、`NOT_REVIEWED`、缺失 hash 或空审核人。
- [ ] 只有全部条件通过后，另行生成可执行激活产物；本 v1 清单本身始终不包含激活 SQL。

当前结论：`PENDING`。R0-G01 仍为 `NOT PASSED`。
