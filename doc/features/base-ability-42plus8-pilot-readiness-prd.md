# Q1 BASE_ABILITY 42+8 正式施测补料 Mini-PRD

## 1. 文档状态

- 状态：`REVIEWED`
- 风险等级：`R3`
- 日期：2026-07-26
- 产品决策：采用方案 A。选定 50 题先完成内容、专业和技术门禁，再经独立 Pilot 激活批准成为 `ACTIVE`，之后执行真实课堂试测；试测证据只门禁正式解释与发布。
- 产品名称口径：在课堂试测证据接受和正式解释评审完成前，统一称为“基础能力教学诊断试测”，不得称为已验证标准化量表、诊断工具或就业安置测验。
- 计划来源：`doc/features/pilot-r0-foundation-development-plan-2026-07-22.md` 的 Q1。
- 权威依据：
  - `doc/specs/MVP_PRD_v1.0.9-authoritative.md` §2.4、§5.3、§5.4、§5.8、§7、§10、§17.8、§17.9、§18.2。
  - `src/main/db/schema.sql`。
  - `src/shared/types/json-schemas.ts`、`src/shared/types/event-payloads.ts`、`src/shared/types/ipc-api.ts`。
  - `doc/features/base-ability-current-contracts.md`。
  - `doc/features/base-ability-42plus8-evaluation-memo.md`。
  - `doc/features/base-ability-42plus8-activation-gate-v1.json`。

### 1.1 风险分级理由

本功能会补齐决定 `ABILITY_SCORE` 的答案键、线上自动评分规则和线下三档锚点，并会收口组卷、事件 payload、主进程评分器、renderer、资产、审核和试测证据链；为使授权失效后的开放坐次与 assignment 有无歧义的终止原因，还需对现有两个 CHECK 枚举做受限增量 migration。它直接影响核心结果计算、授权边界与历史复算语义，按工作流合同定为 R3，而不是按文件数量降级。

主要影响域：`UI_UX`、`DOMAIN_LOGIC`、`EVENT_PROJECTION`、`IPC_API`、`AUTH_PERMISSION`、`SAFETY_FSM`、`RESULT_REPORT`、`ASSET_CONTENT`、`DEPLOYMENT_OPERATIONS`。

### 1.2 已确认的当前事实

- 当前候选池为 96 条 `BASE_ABILITY`：87 条线上候选、8 条 `OFFLINE_OPERATION`、1 条 `OBSERVATION_ONLY`。
- 96 条均为 `DRAFT`，0 条 `ACTIVE`，96 条 `scoring_rule_json` 均为 `NO_SCORE`。
- 当前 96 条 `content_json` 虽标记 `question-content-v1.2`，但仍是扁平候选格式；0 条满足完整的嵌套 `presentation / interaction / expected_evidence / support_policy` 合同。
- 当前素材绑定和线下工具绑定均为 0；16 条候选标记 `safety_sensitive = 1`，但候选内容尚未形成完整专业审核块。
- `npm run contract:base-ability:gate:check` 当前通过的是“候选池与门禁文件未漂移”，结果仍为 `BLOCKED_DRAFT_REVIEW_RENDERER_MATERIAL_AND_TRIAL_GATE`，不是施测就绪或激活通过。

### 1.3 合同差异与处理

- [已裁决] 原合同对课堂试测与 DRAFT→ACTIVE 的先后顺序互相冲突。方案 A 已写回权威 PRD、当前合同、evaluation memo 和 Q1 总计划：内容/专业/技术门禁 → 独立 Pilot 激活批准 → 选定 50 题 ACTIVE → 课堂试测 → 正式解释/发布评审。`ACTIVE` 只表示受控 Pilot 可运行，不表示标准化验证或正式发布。
- [已修订] 原批准合同只要求“产品负责人书面指定”和批准 JSON 自报批准人，机器无法证明指定来源、签名真实性或责任独立性。Q1 现定义安装版固定的产品负责人公钥信任根、产品负责人根签名的批准人授权登记与版本责任清单、登记批准人签名的批准 JSON，以及基于稳定 `principal_id` 的职责分离校验；任一链路缺失或冲突均失败关闭。
- [!] 权威 PRD §2.4、§7.6.1、§17.9 已废止判断/单选/拖拽各 14 道的固定题型比例，当前 `src/main/domain/paper-generator.ts`、`src/main/utils/validate-question-policy.ts` 及相关测试仍依赖旧 `question_ratio`；而 schema 种子已经写入 `question-policy-v1.2.online_quota_by_module`。Q1 必须收口到 v1.2 模块配额合同。
- [!] 当前基础能力候选查询只按 `job_code + ACTIVE` 读取，未在 SQL 中显式过滤 `bank_domain = 'BASE_ABILITY'`、`item_usage = 'SCORED_ITEM'` 和 renderer 可用性，与 PRD §7.6.1、§17.9 不一致。
- [!] 当前学生端和 `AnswerPayloadDetail` 只完整支持判断、单选、旧式拖拽；`SOFTWARE_TASK` 无可提交 renderer。当前提交 handler 仍按题型硬编码判分，未按冻结的 `scoring_rule_json` 统一评分，也未写入完整 `scoring_snapshot`。
- [!] 权威 PRD §8.7 已标准化 `QUESTION_RESPONSE_SUBMITTED / QUESTION_RESPONSE_NOT_SCORED`，当前事件类型和 reducer 仍只写 `ANSWER_SUBMITTED`。Q1 必须增加新事件全链并保留旧事件回放兼容，不能破坏历史日志。
- [!] 当前 `assessment_sitting.end_reason` 不含 `ENDED_BY_AUTHORIZATION_INVALIDATION`，`business_session_assignment.release_reason` 与共享 `AssignmentReleaseReason` 不含 `AUTHORIZATION_INVALIDATED`，共享 `EventType` 也不含 `STUDENT_CONSENT_WITHDRAWAL_REPORTED / PILOT_AUTHORITY_PROVENANCE_REVIEW_REQUIRED`。Q1 必须通过增量 migration 和事件全链登记补齐，不能把授权失效伪装成计划暂停、设备离线或管理员手工撤销，也不能用可覆盖日志代替已完成 session 的证据隔离。
- [已修订] `base-ability-42plus8-evaluation-memo.md` 已移除“应修正统计脚本”的旧句，并明确当前 v1 门禁的供给统计仍有效、旧单阶段状态文案必须在 Q1 实现中升级为方案 A 的分阶段门禁。

### 1.4 影响矩阵

| 影响域 | YES/NO | 证据与说明 |
|---|---|---|
| UI / UX | YES | 学生端需按 `question_type + interaction_type` 渲染并提交所选 42 道线上题；教师端需显示 8 道线下施测与评分锚点。 |
| Domain model | YES | 需要统一 response envelope、评分器和方案 A 分阶段门禁；Pilot 激活、课堂试测和正式解释/发布保持独立状态。 |
| Database / migration | YES | 不新增表/列/状态机，只增量扩展 `assessment_sitting.end_reason = ENDED_BY_AUTHORIZATION_INVALIDATION` 与 `business_session_assignment.release_reason = AUTHORIZATION_INVALIDATED`，并提供既有数据库前滚/回滚和约束测试；超出该范围须停止并重审。 |
| Event / projection | YES | 新响应事件、非计分事件、只减权同意撤回事件、旧 `ANSWER_SUBMITTED` 回放兼容及 reducer/recovery 全链。 |
| IPC / API | YES | 现有作答和线下评分 IPC 的 payload、校验与错误映射需覆盖完整合同；新增通道时须登记全链。 |
| Authentication / authorization | YES | 学生只能提交本人已分配题目；教师负责线下评分和支持/异常确认；管理员维护内容与策略但不能绕过激活门禁。Pilot 批准必须通过安装版固定信任根、授权登记、责任清单和批准人签名链，不能信任 ADMIN 提供的身份声明。 |
| Safety / FSM / concurrency | YES | 安全停止不得记 0；真实红线仍先熔断；重复提交、终态和并发写入必须失败关闭。 |
| Result / report | YES | 答案键和 rubric 决定 `ABILITY_SCORE`；报告必须保持 Pilot 限制、证据类型和效度边界。 |
| Accessibility | YES | 特殊学生的触控、键盘替代、AAC、字号、感官避让和低认知负荷是上线前门禁。 |
| Privacy / audit | YES | 审核和试测证据必须可追溯；批准链记录稳定责任主体、公钥指纹、payload hash 与验证结果，但私钥不得进入仓库、应用或运行库，学生身份和原始敏感数据也不得提交进仓库。 |
| Backward compatibility | YES | 历史策略、旧事件、旧 session/报告及 96 条来源追溯不得失真。 |
| Deployment / rollback | YES | 合成技术演练只能使用显式临时库；真实激活必须绑定独立批准和显式 Pilot 目标库。产品负责人信任根只能随单独审查的安装版变更，不能由激活输入覆盖；试测发现问题时停用/归档受影响 ACTIVE 题并新建版本，不覆盖历史。 |

### 1.5 独立审查结论

- 首轮独立 `/vibe-review prd` 结论：`BLOCKED`。
- `P0-01`：DRAFT 课堂试测发布路径未经产品裁决；本轮不接受为残余风险，保持阻断。
- `P1-01`：首次试测与试测证据形成循环；修订为分阶段门禁。
- `P1-02`：课堂路径未登记多设备授权链；修订为必须复用完整 grant / assignment / device 链。
- `P1-03`：并发、终态和非计分结果缺少验收；补入可执行验收项。
- `P2-01`：默认数据库保护仅有声明；补为路径拒绝和运行前后 hash 门禁。
- 第二轮独立审查结论仍为 `BLOCKED`：上述 P1/P2 已关闭，未发现新增 P0/P1；`P0-01` 是唯一阻断 `/vibe-impl` 的问题，关闭条件是产品裁决试测发布路径、同步权威合同并再次审查 PRD。
- 2026-07-26 产品负责人选择方案 A，原 `P0-01` 已经关闭。方案 A 合同同步后的独立复审结论仍为 `BLOCKED`：`P0-02` 要求补齐产品负责人可验证的批准人信任根与独立性来源，`P0-03` 要求补齐产品批准和学校授权的状态、有效期、撤销及失效后 session 规则。
- 本次 `P0-02` 专项独立复审结论为 `PASS`，未发现新的 P0/P1/P2：安装版固定根、产品负责人签名的授权登记/责任清单、登记批准人签名和可信执行身份映射已覆盖未获指定者冒名、批准 JSON 伪造、参与者自批及实际 ADMIN 自授四类路径，`P0-02` 关闭。`P0-03` 仍保持阻断，不进入 `/vibe-impl`。
- `P0-03` 生命周期初版独立审查（冻结 SHA-256 `0ccaa6e54efe62f98dd03692d7e01e68fd929523978c9451587b90a5404df34b`）结论为 `BLOCKED`：P0 是普通撤销在 session 完成后才送达时缺少运行区间追溯处置；P1 是离线索引/签发件没有机器最大期限，以及逐学生同意缺少可信签发与撤回链。本版已补入统一晚到失效矩阵、24/4 小时最大索引租约、各类签发件最大期限、学校签名逐学生同意、只减权教师撤回事件及两个 reason 枚举 migration，提交再次独立审查。
- `P0-03` 第二次独立审查（冻结 SHA-256 `af00bda3a897bf58c5b6c3f74cd2dde27222e26e2ec936b73341715e6a9e0973`）结论为 `CONDITIONAL_PASS`：P0 已清零且 P0-01/P0-02 未重开；唯一 P1 是新 reason/事件已有真实历史后无法无损降回旧 CHECK/旧应用。本版已补入写入前可 down、写入后 expand-only 的两阶段回滚，另固定撤回事件 aggregate、稳定 `invalidation_fact_id` 和多原因最早失效规则，提交最终独立复核。
- 最终独立 R3 复核（冻结 SHA-256 `6a0671ae6a87f33fbfa25f502552277a46832b5f482e85142768e375d63bb231`）结论为 `PASS`，P0/P1/P2 均为 0；上一轮回滚 P1 已关闭，P0-01/P0-02/P0-03 均未重开。该结论允许进入 `/vibe-impl`，不代表实现、人工审核、真实激活或课堂试测已经通过。

## 2. 问题与目标

### 2.1 当前行为

当前系统已经具备 42+8 评分框架和 96 条候选供给，但候选题不能形成真实施测：没有锁定 50 道组合，没有正式答案键和逐题评分规则，没有完整 renderer/响应事件链，没有线下标准教具和三档行为锚点，也没有专业审核与课堂试测证据。

此外，schema 中的基础能力 v1.2 策略与运行时旧组卷器不兼容；即使未来把题目错误地改成 ACTIVE，也不能保证按当前权威合同生成 6 模块各 7 道的试测组合。

### 2.2 用户问题

- 教师无法用同一套标准条件完成 42 道线上题和 8 道线下题。
- 学生遇到 SOFTWARE_TASK、技术中断、合理便利或安全停止时，现有界面和事件合同不能完整记录有效响应。
- 内容负责人和审核人没有一个按题目 hash 锁定、可填写、可合并、不会直接激活题目的审核入口。
- 产品负责人无法从当前门禁区分“候选数量够”“试测技术就绪”“专业审核通过”“课堂证据完成”和“已授权激活”。

### 2.3 目标行为

1. 从当前 96 条唯一来源候选中，锁定一个 42 道线上 + 8 道线下的 Pilot DRAFT 组合；线上每模块精确 7 道，8 道线下全部纳入，观察项不计入 42+8。
2. 为所选 50 道建立机器可读、带来源 hash 和逐题合同 hash 的 DRAFT 运行权威；未选 46 道仍保留来源追溯和 DRAFT 状态。
3. 所选 42 道线上题具备经审核的答案键、合法 `scoring_rule_json`、可用 renderer、资产、支持政策、终止政策和效度边界；所选 8 道线下题具备标准教具、布置/复位说明和逐题 0/1/2 行为锚点。
4. v1.2 组卷、作答、主进程评分、事件投影、恢复和报告证据链先以合成身份和显式临时库完成技术演练；门禁通过后，经处于有限有效期内且可撤销/轮换的独立批准只将选定 50 题激活为 `PILOT_ONLY`，再按同样具有完整生命周期的学校授权和完整运行授权链执行真实课堂试测。
5. 内容、答案、测评学、安全/康复、特教/无障碍和课堂试测证据可由机器门禁逐项核验；任何 hash 漂移会使相应审核失效。
6. 内容、专业和技术门禁闭合后，门禁只可进入 `READY_FOR_PILOT_ACTIVATION_REVIEW`，`activation_authority_granted` 仍为 `false`；只有状态由已签名原件和追加生命周期事件派生为 `ACTIVE` 的独立批准文件可推进到 `PILOT_ACTIVATION_APPROVED / PILOT_ACTIVE`。
7. 课堂证据接受后只进入 `READY_FOR_FORMAL_INTERPRETATION_REVIEW`；正式阈值解释、报告用语、对外发布或 placement advice 必须另行批准并通过新策略版本生效。

### 2.4 成功定义

Q1 有两个不可混写的完成口径：

- 工程交付完成：选定 50 题、内容/评分/renderer/资产/教具合同、人工审核工具、技术演练、分阶段门禁、独立批准与学校授权的签发/有效期/撤销/轮换校验、受控激活和失效后 session 处置均实现并通过验收；没有有效批准文件时真实题目仍保持 DRAFT，没有当前有效学校授权时真实 session 无法创建或继续。
- 业务 Pilot 完成：有效独立批准已将选定 50 题推进为 PILOT ACTIVE，学校按批准协议完成真实课堂试测，证据经接受并进入 `READY_FOR_FORMAL_INTERPRETATION_REVIEW`。这仍不等于正式解释或发布。

任何阶段都不得静默修改默认运行库、历史策略、历史题目、session、结果或报告。外部批准、专业签字或课堂试测未实际完成时，验收必须如实标记 `NOT_RUN / BLOCKED`，不能用工程测试代替。

## 3. 用户角色与权限

| 角色 | 本功能内职责 | 禁止行为 |
|---|---|---|
| STUDENT | 在学校已批准、题目已完成 Pilot 激活的课堂试测或后续正式 session 中完成线上题、使用允许的便利、触发求助或安全停止。 | 查看答案、评分规则、其他学生数据或修改结果；真实学生身份和数据不得被纳入合成技术演练。 |
| TEACHER | 执行标准指令、记录支持与异常、完成 8 道 `OFFLINE_ABILITY` 评分、触发真实安全红线；在学生/监护人提出撤回时，以可信 auth session 追加只减权的同意撤回报告并立即停测。 | 修改题目合同、绕过工具确认、把技术故障记 0、直接激活题目，或用撤回入口授予/延长/恢复同意。 |
| ADMIN | 运行导入/门禁、维护策略新版本和资产登记、查看阻断原因；在有效独立批准存在时执行绑定同一 hash 的 Pilot 激活包。 | 覆盖审核原件、原地修改已引用策略/题目、绕过门禁写 ACTIVE、自授激活批准或扩大批准题集。 |
| 内容/测评审核人 | 审核构念、题干、选项、答案键、证据边界和分数解释。 | 直接写运行库或以素材生产状态代替内容结论。 |
| 安全/康复/特教审核人 | 审核教具规格、动作安全、终止条件、支持方式、感官与无障碍条件。 | 用 AI 或开发人员签名替代专业责任人。 |
| 产品负责人 | 通过安装版固定的产品负责人根密钥，签发批准人/学校授权人登记、版本责任清单及产品侧撤销/替代事件；课堂证据接受后组织正式解释/发布与后续策略版本决策。 | 把根私钥交给 ADMIN/批准人，允许运行时替换信任根，回填或延后撤销，恢复终态授权，让参与被审版本的责任人自审自批，或把 Pilot ACTIVE 自动升格为正式发布。 |
| 独立 Pilot 激活批准人 | 使用授权登记中匹配的个人密钥，核验内容/专业/技术证据和关键 hash，签发或拒绝 `scope = PILOT_ONLY` 的有限期版本化批准，并可签名撤回本人批准。 | 与产品负责人为同一责任主体，参与被审版本内容制作、代码实现、门禁生成或激活执行，出借私钥，或批准未绑定授权登记/责任清单/集合/策略/hash/有效期的泛化授权。 |
| 学校试测责任人 | 使用产品负责人根签名登记中匹配的学校密钥，签发/撤回有限期课堂授权，绑定协议、适用知情同意、数据保留/访问规则、教师与学生范围。 | 用题目 ACTIVE 或产品批准替代学校授权，回填撤销时间，覆盖个人知情同意撤回，或允许未获授权学生/设备进入试测。 |

专业审核人、产品负责人、独立 Pilot 激活批准人和学校试测责任人都不是新的应用登录角色；它们使用跨授权登记、责任清单、批准 JSON 和执行审计稳定可比的 `principal_id`。人工审核与批准继续使用自包含 HTML/版本化 JSON 入口，带可验证分离签名的 JSON 是机器权威结果，Markdown 仅由 JSON 生成留档。运行时仍由现有 STUDENT / TEACHER / ADMIN 角色和授权链执行业务操作。

## 4. 核心场景

### 4.1 锁定 DRAFT 组合

Given 当前来源 hash、96 个题号和候选供给门禁均未漂移，When 内容/测评负责人按构念覆盖、证据类型、可访问性、安全性和技术可实现性完成选择，Then 生成恰好 42+8 的版本化清单，线上每模块 7 道，8 道线下全部纳入，`GA-EMO-014` 观察项和其他未选题不进入计分清单，所有题仍为 DRAFT。

### 4.2 内容修订与审核

Given 某道入选题仍是扁平候选或 `NO_SCORE`，When 编辑者生成结构化 v1.2 合同并提交审核，Then 审核包展示来源、修订前后、答案/锚点、资产、支持和效度边界；审核 JSON 必须绑定该版本逐题 hash，审核页提交不得修改题目状态或策略。

### 4.3 线上结构化作答

Given 题目、renderer、资产和评分规则均通过试测门禁，When 学生完成一个已注册交互，Then renderer 只提交结构化 response、metrics、timing 和 support；主进程校验 answer shape 后按冻结 `scoring_rule_json` 产生 0/2，并把评分版本和失败条件写入事件及答题快照。

### 4.4 非计分响应与安全

Given 学生遇到技术故障、题目不适用、P3 直接协助或需要安全停止，When 教师/系统按权限确认对应状态，Then 写入 `score = NULL` 的非计分响应，完成率和报告限制同步更新；若出现真实红线事实，仍先执行现有安全熔断链，错误答案本身不得自动创建安全事件。

### 4.5 线下标准评分

Given 教师已核对题目对应的标准教具、布置、复位和终止条件，When 学生完成线下操作，Then 教师只能按该题审核通过的可观察 0/1/2 锚点评分，并以 `score_scope = OFFLINE_ABILITY` 写入；该分数进入 ABILITY_SCORE 总分但不进入线上模块否决。

### 4.6 门禁失败关闭

Given 任一入选题缺答案审核、renderer、必需资产、hash、教具或试测前必需专业签字，When 构建技术演练或 Pilot 激活前置门禁，Then 返回逐题阻断码并停止，不临时换题、不减少题量、不把 DRAFT 改为 ACTIVE、不把故障记 0。课堂试测证据不反向阻断首次 Pilot 激活，但会阻断正式解释与发布。

### 4.7 独立批准与受控激活

Given 安装版验证器已固定产品负责人公钥指纹，产品负责人已分别签发绑定同一待批版本的批准人授权登记和责任清单，When 登记批准人签发绑定两份上游证据、全部关键 hash 与有限 `[effective_at, expires_at)` 的 `PILOT_ONLY` 批准，Then 机器验证产品负责人根签名、批准人签名、payload hash、生命周期 revision/时间窗和稳定 `principal_id` 职责集合，并只允许可信执行上下文认证、且与批准人不同的 ADMIN 执行恰好 42+8 的激活。Electron 入口从当前 sender 的 ACTIVE `auth_session` 解析执行人；独立运维 CLI 在目标库上交互认证并只在本次进程保存认证上下文。信任根来自批准包、上游签名无效、批准密钥未登记、责任清单缺失、授权非 ACTIVE、索引过期/回退、请求/CLI 参数自报执行身份、主体映射缺失或批准人与任一被审/执行责任主体相同时均失败关闭。

### 4.8 授权到期、撤销与轮换

Given 产品批准、学校授权或逐学生知情同意在真实 Pilot session 创建后失效，When 应用启动扫描或下一次开始/恢复坐次、作答、线下评分或完成操作重新校验授权，Then 主进程先停止输入，以 `ENDED_BY_AUTHORIZATION_INVALIDATION` 事件化关闭当前坐次、将所有受影响开放 session 置为 `ABORTED`，并以 `AUTHORIZATION_INVALIDATED` 撤销/释放对应 grant 与 assignment，保留但不解释已有不完整事实；安全红线并发命中时仍以 `REDLINE_HALTED` 为先。若失效晚于本机接收，系统按 `[created_at, terminal_at]` 与 `invalidation_at` 判定：运行区间重叠的已完成 session 保持原终态和 bytes，追加 `PILOT_AUTHORITY_PROVENANCE_REVIEW_REQUIRED` 并永久隔离结果、报告、课堂证据与正式解释；MVP 内事后重签或人工复核均不能恢复证据资格，失效发生在终态之后才保持历史资格不变。

### 4.9 课堂试测与修订

Given 选定 50 题已绑定有效独立批准并成为 PILOT ACTIVE，且学校协议、适用知情同意、数据规则、教师准备和完整授权链均通过，When 学校执行真实课堂试测，Then 记录匿名化汇总证据、评分一致性和异常；任何语义修订都停用/归档受影响旧题、生成新 `question_id` 与合同 hash，并使旧审核和旧试测证据不能用于新版本，直至重新通过相应门禁。技术夹具不得替代真实课堂证据。

### 4.10 正式解释与发布

Given 课堂试测证据已被产品与专业团队接受，When 申请正式阈值解释、报告用语、对外发布或 placement advice，Then 系统只允许进入独立正式解释评审；批准后以新的策略版本生效，历史 Pilot 策略、结果和报告保持不变。未批准时 Pilot 题可以继续停用或在获批范围内使用，但不得输出正式结论。

## 5. 范围

### 5.1 本次包含

#### A. 权威链与选择清单

- 建立一个覆盖全部 96 条候选的版本化 BASE_ABILITY Pilot 运行权威：入选 50 道保存完整结构化合同，未选 46 道保存题号、来源和未选原因，不丢失候选池对账。
- 运行权威必须记录来源 xlsx hash、导入 SQL hash、生成器版本、逐题内容/评分 hash、选定状态和激活边界。
- 当前 xlsx 继续是原始候选唯一来源；结构化修订和人工结果以 JSON 作为机器权威层，由生成器合并。`question-bank-import-base-ability-v02.sql` 保持派生产物，不允许手工维护第二套答案。
- 选择只固定模块配额和 Pilot 组合，不恢复 14/14/14 题型配额；不得单纯为少写 renderer 而牺牲构念或证据覆盖。

#### B. 50 道 DRAFT 内容和评分合同

- 将入选题规范为 `question-content-v1.2`，补齐 presentation、interaction、expected_evidence、support_policy、termination_policy、source、review、ability_tags 和条件必填字段。
- 正确答案只进入 `scoring_rule_json`；入选计分题不得继续使用 `NO_SCORE`。
- 线上题按题型使用 `EXACT_MATCH / SET_MATCH / MAPPING_MATCH / ORDER_MATCH / METRIC_THRESHOLD / EVENT_RULE`，固定 `pass_score = 2`、`fail_score = 0`，禁止任意 JavaScript 表达式和部分 1 分。
- 8 道线下题使用 `OFFLINE_RUBRIC`，每题总分 0/1/2，逐 criterion 提供可观察、可复核、非通用模板的三档锚点。
- 所有自动评分题的 `review.answer_key_status` 必须在人工确认后为 `VERIFIED` 或 `CORRECTED`；未确认前保持 DRAFT 和阻断状态。

#### C. v1.2 组卷与试测隔离

- 基础能力运行时读取 `online_quota_by_module + offline_total + allowed_question_types`，不再依赖废止的 `question_ratio`。
- 候选 SQL 必须显式过滤 `job_code`、`bank_domain = 'BASE_ABILITY'`、`status = 'ACTIVE'`、`item_usage = 'SCORED_ITEM'`；session 创建前再执行完整合同、资产和 renderer 校验。
- 旧 `question_ratio` 策略只保留明确的历史兼容分支，不得影响 v1.2 新 session。
- 技术演练只允许在显式临时库使用合成身份、合成授权和 ACTIVE 测试夹具；不得承载真实学生课堂 session，不得把结果发布为真实学生 ABILITY_SCORE 或报告结论。
- 方案 A 不实现 DRAFT 课堂旁路或临时映射。真实题目必须在内容/专业/技术门禁通过并取得有效独立 `PILOT_ONLY` 批准后，才可由 ADMIN 将选定 50 题转为 ACTIVE；批准文件与 Pilot 策略共同绑定题集和关键 hash。
- Pilot ACTIVE 题只允许匹配 `pilot_mode = true`、`placement_advice_enabled = false` 的冻结策略；任何获批真实课堂路径都必须复用 `business_session → device grant → assignment → student confirmation → start` 全链，不得由试测配置直接创建或启动 session。

#### D. renderer、响应与主进程评分

- 建立显式 renderer registry，按 `question_type + interaction_type` 选择组件；标准 UI 控件应复用，只有真实不同的交互语义才新增组件。
- 覆盖入选题实际需要的 SINGLE_SELECT、MULTI_SELECT、DRAG_DROP、ORDERING、GESTURE_TASK、TIMED_TASK、TASK_SEQUENCE、BRANCHING_TASK 等交互；未入选交互不因 Q1 自动进入范围。
- renderer 不判等级、不持有答案，只提交符合白名单的 response、metrics、support 和 timing。
- 主进程评分器以冻结 `scoring_rule_json` 为唯一答案/规则来源，统一校验与评分；不得继续从 content 中读取第二份正确答案或按 UI 分支硬编码结果。
- 扩展现有作答 IPC 和共享类型以承载 SOFTWARE_TASK、response_status、prompt_level、accommodations、instruction replay、metrics 和 scoring snapshot。

#### E. 事件、投影和恢复

- 新写入使用权威 PRD 定义的 `QUESTION_RESPONSE_SUBMITTED` 与 `QUESTION_RESPONSE_NOT_SCORED` 语义；如需要支持/呈现独立事件，只实现入选交互实际需要的最小集合。
- 事件类型、payload type、序列化、event writer、reducer、answer_record 投影、恢复重放和测试必须全链登记。
- 历史 `ANSWER_SUBMITTED` 日志必须继续可回放；不得重写旧 JSONL 或把旧事件静默解释成新字段已存在。

#### F. 素材、教具与无障碍

- 复用 `doc/assets/asset-manifest.json` 中已有 BASE_ABILITY E 类和共享资产；入选题若需新增资产，必须更新权威计划/manifest/schema 和分类计数，不得使用未登记占位图。
- 必需资产只有在文件、hash、版权和适用人工门全部通过后才可满足试测就绪门禁；程序化 SVG/CSS 同样需要技术、视觉和特教/AAC 审核。
- 为 8 道线下题建立版本化教具/布置合同，包含稳定 item/setup ID、规格、数量、摆位、复位、清洁、风险和替代限制；不得只写自由文本材料名。
- 学生交互必须支持触控和非拖拽键盘替代，避免依赖精细鼠标操作、颜色单一编码或隐藏手势。

#### G. 人工审核与课堂试测

- 生成自包含 HTML 审核包，支持自动保存、必填校验和 JSON 导出；审核原件只读固化，合并门禁不得覆盖原件。
- 内容/测评轨审核构念、题干、答案、评分和解释边界；安全/康复/特教轨审核安全、教具、支持和可访问性。每题只要求其声明的必需轨道，但安全敏感题和全部线下题不得豁免安全技术轨。
- 在经过审查的安装版批准验证器中固定 `pilot-product-owner-trust-anchor-v1`，至少包含产品负责人稳定 `principal_id`、`key_id`、Ed25519 公钥、SHA-256 指纹和安装版声明的 UTC `issued_at / effective_at / expires_at`；信任来自安装包签名/发布完整性而不是根自签。由产品负责人通过独立发布/安装渠道核对指纹。根私钥离线保管，验证器不得从批准目录、目标数据库、命令行、环境变量或 ADMIN 输入读取替代根；根变更必须单独审查和发布。
- 建立 `pilot-approver-authority-registry-v1`：由产品负责人根密钥对精确 UTF-8 JSON 字节作 Ed25519 分离签名，绑定获指定批准人的稳定 `principal_id`、批准公钥 `key_id`/指纹、`BASE_ABILITY + PILOT_ONLY` 授权范围以及有限 `issued_at / effective_at / expires_at`。
- 建立 `pilot-release-responsibility-manifest-v1`：由同一产品负责人根密钥分离签名，绑定选定题集、策略和内容/评分/资产/renderer/门禁 hash、有限有效期，并按内容制作、代码实现、门禁生成和计划激活执行列出稳定 `principal_id` 与证据引用；每个允许执行的 ADMIN 还必须预先绑定 `user_account.user_id ↔ principal_id`。该清单是独立性校验来源，不能由批准 JSON 或激活请求自报替代。
- 建立 `pilot-activation-approval-v1`：批准人使用授权登记中匹配的私钥，对精确 UTF-8 JSON 字节作 Ed25519 分离签名；批准 JSON 绑定授权登记 ID/hash、责任清单 ID/hash、50 题、策略版本、关键 hash、批准人、`issued_at / effective_at / expires_at` 和 `PILOT_ONLY` 范围。所有分离签名信封记录算法、签名 `key_id`、payload SHA-256 和签名值；审核页提交本身不得执行激活。
- 激活前按稳定 `principal_id` 校验批准人与产品负责人、内容制作、代码实现、门禁生成、计划激活执行和实际已认证 ADMIN 执行主体无交集。Electron 入口的实际 `user_id` 只能由当前 sender 绑定且 ACTIVE 的 `auth_session` 解析；独立运维 CLI 必须在目标库上交互验证 ACTIVE ADMIN 账号并创建仅限本次进程的认证上下文，账号凭据不得经命令行参数、环境变量、批准包或日志传递。两条路径都按已签名责任清单映射，不能使用请求正文中的 `callerUserId`、角色或临时主体映射。姓名、角色文本、扫描签名、Markdown、未签名 JSON 或 ADMIN 手工声明均不能证明获授权或独立。
- 建立产品负责人根签名的 `pilot-school-authority-registry-v1`，绑定 `organization_id`、学校试测责任人 `principal_id`、签名公钥 `key_id`/指纹、授权范围及有限有效期；再由登记学校密钥签发 `school-classroom-trial-authorization-v1`，绑定产品批准 ID/hash、学校协议和适用知情同意模板 hash、学生/教师范围、数据保留/访问规则、题集/Pilot 策略及有限有效期。它不能替代产品侧 Pilot 激活批准，产品批准也不能替代它。
- 为每名学生建立学校责任人签名的 `student-trial-consent-v1`，绑定 `consent_id`、`organization_id`、`student_id`、按协议必须同意的学生/监护人主体、原始同意证据 hash、见证教师从 ACTIVE `auth_session` 解析的 `user_id` 及其预登记 `principal_id`、协议/同意模板 hash、授权范围和有限有效期。学校签名只提供原始同意证据的机器可信证明，纸面/电子原件仍留在学校批准的本地存储；ADMIN 不能签发或恢复同意。
- 学生或监护人撤回时，当前 ACTIVE TEACHER 可为本人有权施测的学生追加只减权的 `STUDENT_CONSENT_WITHDRAWAL_REPORTED`；`reported_at` 由主进程使用当前统一 UTC 决策时间生成而非接受客户端输入，并立即作为 `invalid_from` 阻断该学生。事件必须绑定 consent ID/hash、学生、报告人可信身份、原因和原始撤回证据 hash，并进入下一份学校责任人签名的同意生命周期索引。该路径只能撤回，不能授予、延长或恢复同意；若原始证据证明更早 `withdrawn_at`，只有学校责任人签名的 `student-trial-consent-lifecycle-event-v1` 可确认更早 `invalid_from`，随后按晚到失效矩阵处理。
- 所有上述签发件为不可变原件，运行状态只能从原件和追加式签名生命周期事件派生。统一派生状态为 `PENDING / ACTIVE / EXPIRED / REVOKED / SUPERSEDED / INVALID`：签名/schema/hash/范围或已验证上游链失败为 INVALID；已生效撤销为 REVOKED；已生效替代且无更早撤销为 SUPERSEDED；到达 `expires_at` 为 EXPIRED；未到 `effective_at` 为 PENDING；仅 `[effective_at, expires_at)` 内且无失效条件为 ACTIVE。`EXPIRED / REVOKED / SUPERSEDED` 及自身 bytes/schema/签名无效的 INVALID 不可复活；只是缺少上游证据时可在补齐原始有效证据后重验，但缺失期间不授权。
- 产品侧 `pilot-authorization-lifecycle-event-v1`、学校侧 `school-trial-authorization-lifecycle-event-v1` 和同意侧 `student-trial-consent-lifecycle-event-v1` 均绑定目标 ID/hash/`key_id`、`REVOKE | SUPERSEDE`、签发人、`issued_at / effective_at`、原因码、非空原因、可选替代件；普通事件满足 `issued_at <= effective_at`，不能追溯回填。密钥泄漏可另含更早的 `compromised_at / invalid_from`；个人撤回只有学校责任人签名事件可依据原始证据确认早于教师报告时间的 `withdrawn_at / invalid_from`。产品根可撤销产品下游件和学校授权人登记；批准人只可用本人登记密钥签发撤回本人批准的事件，并由下一份产品根签名索引发布；学校责任人只可撤回本人学校授权/同意。ADMIN 只能导入和执行有效签名事件，不能签发、回填或改期。
- 产品与学校各自维护签名的追加式生命周期索引，包含单调 revision、前一 revision hash、`published_at` 和 `next_refresh_at`。产品索引最大租约 24 小时；存在可运行课堂授权时，学校授权/同意索引最大租约 4 小时。目标安装持久化最高已见 revision 与最近成功校验 UTC；revision 回退/断链、租约超限/过期或本机时间回拨均失败关闭。离线租约不是撤销安全港：紧急撤销立即现场停测，全部目标安装导入新索引并完成失效处置后才可恢复；预告的未来生效撤销必须在 `effective_at` 前导入。
- JSON Schema/validator 强制最大授权期限：产品根 365 天、批准人登记 90 天、责任清单/激活批准各 30 天、学校授权人登记 90 天、学校课堂授权/逐学生同意各 14 天；允许更短期限，不允许缺省延长，且任一下游 `expires_at` 不得晚于全部上游件。
- 课堂试测协议至少记录：题目完成时间、跳题/中断、感官筛除或替代、技术中断、支持等级、线下教师间一致性、复测熟悉效应和与后续训练/实操结果的关系。
- 仓库只保存匿名化汇总、协议、合同版本和证据 hash；学生身份、健康信息和原始观察记录留在学校批准的本地存储。

#### H. 分阶段机器门禁

- 将现有“候选数量 + 总阻断”门禁升级为可逐题核验的阶段门禁，至少区分：来源/集合、选择、内容结构、评分、renderer、资产、教具、专业审核、技术演练、Pilot 激活批准/执行、课堂试测和正式解释/发布。
- 门禁状态按 `READY_FOR_TECHNICAL_REHEARSAL → READY_FOR_PILOT_ACTIVATION_REVIEW → PILOT_ACTIVATION_APPROVED → PILOT_ACTIVE → READY_FOR_CLASSROOM_TRIAL → TRIAL_EVIDENCE_ACCEPTED → READY_FOR_FORMAL_INTERPRETATION_REVIEW → FORMAL_RELEASE_APPROVED` 推进。任一失败转入带原因的 `BLOCKED_*`，历史状态和证据不覆盖；产品批准失效使用 `BLOCKED_PILOT_AUTHORIZATION_INACTIVE`，学校授权/知情同意失效使用 `BLOCKED_SCHOOL_TRIAL_AUTHORIZATION_INACTIVE`。
- `READY_FOR_PILOT_ACTIVATION_REVIEW` 时 `activation_authority_granted = false`；只有有效独立批准可改为 true，且必须同时记录 `activation_scope = PILOT_ONLY`。课堂试测证据只参与 `TRIAL_EVIDENCE_ACCEPTED` 及以后状态。
- 批准信任链失败至少使用稳定阻断码：`PILOT_TRUST_ANCHOR_INVALID`、`PILOT_APPROVER_NOT_AUTHORIZED`、`PILOT_AUTHORITY_SIGNATURE_INVALID`、`PILOT_RESPONSIBILITY_MANIFEST_INVALID`、`PILOT_APPROVAL_SIGNATURE_INVALID`、`PILOT_PRINCIPAL_MAPPING_MISSING`、`PILOT_APPROVER_NOT_INDEPENDENT` 和 `PILOT_APPROVER_EXECUTOR_CONFLICT`；生命周期失败至少区分 `PILOT_AUTHORIZATION_NOT_ACTIVE`、`PILOT_AUTHORIZATION_LEDGER_STALE`、`PILOT_AUTHORIZATION_LEDGER_ROLLBACK`、`PILOT_AUTH_CLOCK_INVALID`、`PILOT_KEY_COMPROMISED`、`SCHOOL_TRIAL_AUTHORITY_INVALID`、`SCHOOL_TRIAL_AUTHORIZATION_NOT_ACTIVE` 与 `PILOT_SESSION_AUTHORIZATION_INVALIDATED`，不得降级为可覆盖警告。
- 所有失败项输出稳定阻断码、题号和证据路径，便于只重做受影响的题或审核轨。

### 5.2 明确不包含

- 本次 PRD 修订本身不把任何题改为 ACTIVE、不签发批准、不写运行库；后续实现只提供经有效独立批准后恰好激活选定 50 题的受控入口，不提供 96 题批量激活。
- 不提供 DRAFT 试测旁路、临时激活映射，或绕过学校协议和授权链的真实学生试测启动器。
- 不让代码、门禁生成器或 ADMIN 自授激活权限，也不把“审核通过”“题目 ACTIVE”“试测完成”中的任一单项自动等同于正式发布。
- 不允许批准包、目标数据库、CLI 参数、环境变量或 ADMIN 输入携带/替换产品负责人信任根；不把姓名文本、角色、勾选框、扫描签名或未签名 JSON 当作机器授权证据。
- 不修改 42+8、满分 100、80/60 阈值、模块否决阈值或当前线上/线下计分值；若要改变权重或分数解释，必须另行修改产品合同和策略新版本。
- 不宣称六项能力等权，不输出诊断结论或就业安置方向；`pilot_mode = true`、`placement_advice.enabled = false` 保持不变。
- 不补齐未入选的其余 46 道候选题，不实现多套卷、完整试卷后台、随机平行卷或稳定复测比较。
- 不处理 JOB_SKILL Q2、298 题全量素材或 270 项 JOB_SKILL Pilot 门禁。
- 不新增应用角色、ORM、前端状态持久化、CSV 解析库或 Markdown 报告渲染库。
- 不新增授权状态表、第二套 session/assignment 表或其他列/状态；除本 PRD 明列的两个 CHECK 枚举增量 migration 外，发现还需修改表结构时必须停止实现并重新进行 R3 范围审查。

## 6. 行为与数据变化

### 6.1 状态变化

- 在有效独立批准文件出现前，Q1 权威数据、派生 SQL 和任何非测试运行库中的 `question_bank.status` 始终为 DRAFT；合成技术演练只能使用显式临时测试夹具。
- 内容准备、专业审核、技术演练、Pilot 激活批准、激活执行、课堂试测证据和正式解释/发布是门禁文档中的独立状态；`question_bank.status = ACTIVE` 只对应 `PILOT_ACTIVE` 的题目可运行事实，不能替代其他状态。
- 有效批准后，受控激活事务只允许选定 42 道线上 + 8 道线下题 `DRAFT → ACTIVE`，并锁定同一 Pilot 策略版本；其余 46 题不变。重复执行同一批准 ID 必须幂等，不得扩大集合。
- 产品、学校和逐学生同意签发件的状态不是可编辑字段，而是在每个授权决策点由不可变原件、签名生命周期事件、决策时间和本机最高 revision 派生；任何终态恢复都必须创建新 ID/hash/签名。
- 产品批准后来失效不把题目退回 DRAFT：题目保留 ACTIVE 历史事实，阶段门禁转为 `BLOCKED_PILOT_AUTHORIZATION_INACTIVE`，新批准以新 ID/hash 重新授权同一冻结版本后才可恢复未来运行。学校授权失效只阻断其 `organization_id`、学生/教师范围内的课堂运行，不影响其他学校的独立有效授权。
- 任一授权在开放 session 中失效时，系统先用 `SITTING_ENDED(end_reason = ENDED_BY_AUTHORIZATION_INVALIDATION)` 关闭当前坐次，再通过现有事件驱动状态链将 session 置为 `ABORTED`，并以 `AUTHORIZATION_INVALIDATED` 撤销/释放 grant/assignment；安全红线同一时点命中时仍进入 `REDLINE_HALTED`。授权失效不新增 assessment 状态枚举。
- 课堂试测证据不参与首次激活判定；它只推进 `TRIAL_EVIDENCE_ACCEPTED → READY_FOR_FORMAL_INTERPRETATION_REVIEW`。正式解释批准通过新策略版本表达，不原地修改 Pilot 策略。
- 任何语义字段、答案、rubric、资产引用或教具合同变化都会产生新合同 hash，并使绑定旧 hash 的人工结论和试测证据失效。

### 6.2 数据读写

- 读取：当前 xlsx、导入 SQL、策略、题库/JSON/事件合同、asset manifest、renderer registry、审核结果、安装版固定产品负责人信任根、根签名的批准人/学校授权人登记与版本责任清单、批准人签名的批准 JSON、学校责任人签名的课堂授权和逐学生同意、产品/学校/同意追加式生命周期索引。
- 写入：版本化 JSON 权威及其 JSON Schema、派生 SQL、审核包/结果门禁、只读固化的签发件与生命周期事件、最高已见 revision/最近授权校验时间水位、只减权的同意撤回报告、Pilot 激活执行台账、session 授权快照、学校试测授权记录、资产/教具合同、匿名化试测证据和测试夹具。
- 禁止写入：任何产品负责人或批准人私钥、历史审核/批准原件、已引用策略版本、历史 session/answer/result/report；未经有效批准的默认或 Pilot 运行数据库。
- 所有技术演练命令必须要求显式临时数据库路径，解析到默认 userData/`xc-career-guide.db` 时失败；运行前后记录默认数据库 hash 并断言不变。真实激活必须使用单独的显式运维命令、有效批准文件和明确目标库，先备份并校验目标库身份与前后集合，不能复用技术演练入口。

### 6.3 事件与投影

- 新响应事件必须携带 response status、interaction、response、metrics、support、timing 和 scoring snapshot；投影到 `answer_record` 时保持 ANSWERED 与非计分状态的 schema 约束。
- reducer 以事件 payload 为唯一投影输入；恢复测试必须证明旧 `ANSWER_SUBMITTED` 与新响应事件可以在同一历史中确定性重放。
- 高频 pointer move 不写领域事件，只保存题目声明允许的聚合 metrics。
- `SESSION_STARTED` 或等价创建事件必须冻结产品批准、学校授权、知情同意的 ID/hash/revision/状态/有效期与统一 `verified_at`。授权失效终止复用 `SESSION_ABORTED`，payload reason 使用稳定产品/学校/同意失效原因；不得直接更新 session 状态。若实现发现现有事件/投影无法完整承载该快照或终止原因，必须按 `INV-EVT-003` 全链扩展并在实现计划登记，不能绕开事件链。
- `STUDENT_CONSENT_WITHDRAWAL_REPORTED` 是 Q1 新增的只减权事件，固定复用 `aggregate_type = SYSTEM`、`aggregate_id = consent_id`，不新增 consent aggregate CHECK：actor 必须来自当前 ACTIVE TEACHER auth session，payload 绑定 consent/student/organization、由主进程生成的 `reported_at = invalid_from`、原因和撤回证据 hash；事件写入后先阻断该学生并终止开放 session，再等待学校签名索引闭环。它必须完成 EventType、payload validator、JSONL、projection/recovery 和测试全链，且不能被用于创建或恢复 consent。
- `PILOT_AUTHORITY_PROVENANCE_REVIEW_REQUIRED` 是 Q1 新增的永久证据隔离事件：写入受影响 `ASSESSMENT_SESSION` aggregate，payload 绑定 session/business session、稳定 `invalidation_fact_id`、失效来源类型与 ID/hash、cause type/ref、`invalidation_at / detected_at`、`created_at / terminal_at`、区间重叠判定和隔离范围。相同 `session_id + invalidation_fact_id` 幂等，不同 payload 冲突；projection/recovery 必须由它恢复结果、报告、课堂证据和正式解释写门禁，不改变既有终态或历史 bytes。人工复核结论只能作为追加审计，MVP 不提供清除该事件效果的路径。

### 6.4 IPC/API

- 学生作答入口只接受本人当前 session 中当前未提交的 ONLINE 题；业务 session、ACTIVE device grant、ACTIVE assignment、student confirmation 和设备身份必须三方一致；question type、interaction type、answer shape 和 metrics 白名单均由主进程复核。
- 教师/系统确认非计分状态时必须校验角色、session 状态和题目归属；学生不能自行伪造教师确认字段。
- Pilot 激活入口只接受 ADMIN 调用，但 ADMIN 身份不是批准证据。主进程入口必须从当前 Electron sender 的 ACTIVE `auth_session` 解析实际 `user_id`；独立运维 CLI 必须在目标库交互认证 ACTIVE ADMIN 并只建立本次进程认证上下文，二者都不得信任请求/参数自报身份。随后从安装版固定根验证产品负责人对授权登记/责任清单的签名、批准人对批准 JSON 的签名、责任清单中的 `user_account.user_id ↔ principal_id` 映射、稳定主体独立性、题集/策略/合同 hash、`PILOT_ONLY` 范围、目标库和幂等键。信任根不得由该调用传入，账号凭据不得进入参数、环境变量、批准包或日志。
- 业务主进程必须在激活、session 创建、grant/assignment 创建、学生确认、坐次开始/恢复、线上作答、线下评分和 session 完成的同一写事务中，以一个统一 UTC 决策时间重新校验两条授权链和逐学生同意；仅在 renderer 打开页面时校验一次不够。若校验后业务写入提交前 authorization revision 改变，事务必须回滚并重试校验。
- 若新增 IPC 通道，必须同步主进程 handler、preload 白名单、shared type、权限、参数、错误映射和测试。

### 6.5 权限检查

- 学生：普通运行时只允许 ACTIVE 题；且题目已分配给本人、设备 grant/assignment/confirmation 有效、session 处于可答阶段、题目属于 session。
- 教师：线下评分、支持/非计分确认和试测观察；不具有激活权限。
- 教师：只有当前 auth session 对应本人有权施测的学生时，才可报告个人同意撤回；该入口立即减权并审计，不得创建同意、改变有效期或撤销其他学生。
- 管理员：内容导入和策略维护；可执行有效独立批准绑定的 Pilot 激活包，但不能生成/篡改批准或扩大题集，仍受审核、资产、目标库和激活授权门禁约束。
- 产品负责人/独立批准人：不获得应用运行角色；其权限只由安装版信任根、公钥授权登记和数字签名证明。实际 ADMIN `user_id` 必须来自当前 sender 的 ACTIVE `auth_session`，或独立运维 CLI 在目标库交互认证形成的本次进程上下文，并命中责任清单预签名的 `user_account.user_id ↔ principal_id` 映射后再做职责分离校验。
- 学校试测责任人：不获得新的应用角色；其签发/撤回权限只来自产品负责人根签名的学校授权人登记及匹配数字签名。ACTIVE ADMIN 可以导入已签名学校文件和执行失效处置，但不能生成学校授权、撤销或修改生效时间。

## 7. 边界条件与异常处理

- 空数据：任何模块少于 7 道入选线上题、线下少于 8 道、清单多/少于 50 道均失败。
- 重复操作：重复题号、重复有效作答、重复有效线下评分、重复审核原件或重复试测证据不得产生第二条 current 事实。
- 并发：同一题并发提交只允许一条有效记录；失败返回明确错误，不重复推进进度。
- 终态操作：COMPLETED、REDLINE_HALTED、ABORTED session 不接受新作答或评分。
- 中途失败：事件日志写入失败必须阻断；投影失败保留可恢复事实；资产加载失败或 renderer 异常记技术中断，不记 0。
- 断线/重试：本地重试按稳定 request/answer ID 幂等；不得重新随机选题或更换合同版本。
- 题库不足：感官筛除后不满足配额时返回 `QUESTION_BANK_INSUFFICIENT` 和缺口，不静默降低题量。
- 不支持交互：renderer 未注册/未启用时该题不得进入试测运行集合。
- 安全事件：`STOPPED_SAFETY` 本身不自动创建 incident；检测到真实红线事实时先走现有熔断链，安全优先级不变。
- 线下评分：未确认教具清单、锚点合同 hash 不匹配或 response status 非 ANSWERED 时，不接受普通 0/1/2 分。
- 审核漂移：审核后的题目或资产 hash 变化，只失效受影响题和轨道，不覆盖历史原件，也不假定其他题仍需全量重审。
- 激活漂移：批准文件引用的组合、题目、renderer、资产、策略、评分器或门禁 hash 与待激活版本不一致时，激活失败；已使用的批准文件不得重新绑定新版本。
- 批准信任失败：安装版信任根缺失/指纹不符、根来自运行时覆盖、授权登记或责任清单签名无效、批准签名密钥未登记、payload hash 不一致、稳定主体映射缺失或批准人与任一禁止责任主体相同时，激活失败且记录稳定阻断码；ADMIN 不能手工覆盖。
- 生命周期时间：所有授权时间必须为带 `Z` 的 UTC RFC 3339，满足 `issued_at <= effective_at < expires_at`；普通撤销/替代满足 `issued_at <= effective_at`，密钥泄漏和由学校签名证据确认的个人撤回可以使用更早 `invalid_from`，教师即时报告时间不得由客户端回填。`expires_at` 缺失/为空、超过最大期限、下游晚于上游、授权尚未生效、到期、撤销、替代、上游密钥失效、生命周期索引租约超限/过期/回退/断链或本机 UTC 早于最近校验水位时均失败关闭。
- 生命周期并发：授权校验和业务写入共用一个事务与决策时间；若 revision 在提交前变化则回滚。失效在业务事务提交后才成为本机已知事实时不回写该条已提交事件，但下一业务动作必须检测并按下表处置；离线租约内完成不是免于晚到失效追溯的安全港。

| 失效生效时间与 session 区间 | 创建前/尚未创建 | 检测时仍为开放态 | 检测时已为终态 |
|---|---|---|---|
| `invalidation_at <= business_session.created_at` | 拒绝创建 | 事件化 `ABORTED`，释放/撤销 grant/assignment | 追加 `PILOT_AUTHORITY_PROVENANCE_REVIEW_REQUIRED`，隔离结果/报告，禁止证据接受与正式解释 |
| `business_session.created_at < invalidation_at <= terminal_at` | 不适用 | 拒绝当前动作并事件化 `ABORTED`，保留不完整事实 | 同上；普通批准/学校授权/同意失效永久排除，不能追溯补授权 |
| `invalidation_at > terminal_at` | 不适用 | 不适用 | 历史按完成时有效链复验，不删除、不回写、不重算 |
| 无法验证生效时间或当前链 | 拒绝创建 | 失败关闭并事件化 `ABORTED` | 先隔离；只有补齐原始证据证明根本不存在区间内失效时，才按原事件重放结果保持或移除临时阻断；一旦确认区间重叠并追加来源隔离事件则永久隔离 |

- 每个失效事实的 `invalidation_fact_id` 固定为 `SHA-256("pilot-invalidation-fact-v1\n" + source_type + "\n" + source_id + "\n" + source_payload_sha256 + "\n" + cause_type + "\n" + cause_ref + "\n" + invalidation_at)`，字段不得包含换行。自然到期使用 `EXPIRY / EXPIRES_AT / expires_at`；普通撤销/替代使用 `REVOKE|SUPERSEDE / lifecycle_event_id:payload_sha256 / effective_at`；密钥泄漏使用 `KEY_COMPROMISE / lifecycle_event_id:payload_sha256 / invalid_from`；个人撤回使用 `CONSENT_WITHDRAWAL / withdrawal_event_id:payload_sha256 / invalid_from`。同一授权多个事实必须逐项保留，派生 ACTIVE 终止时间取最早 `invalidation_at`，不得用较晚到期覆盖较早撤销/替代。`terminal_at` 取 `completed_at` 或其他终态事件时间；未终态时使用当前决策时间。
- 终态证据隔离不改变 `COMPLETED / ABORTED / REDLINE_HALTED`、历史作答、评分、结果或报告 bytes。一旦确认产品批准、学校授权、个人同意或密钥泄漏的失效区间与 session 重叠并追加来源隔离事件，MVP 内永久排除该 session，不得事后重签或人工恢复证据资格；人工复核只能追加来源结论。`REDLINE_HALTED` 的安全事实和安全报告始终保留，但仍不得作为普通课堂效度证据。
- 安全并发：授权失效与真实红线同时命中时，先执行 `INV-SAFE-001` 的熔断并保持 `REDLINE_HALTED`，不得用普通 ABORTED 覆盖安全终态。
- 轮换：旧根/登记/授权从替代生效起只能历史验签，后续运行必须重新签发新链；不得接受临时双根。计划轮换必须安排在无开放 session 的窗口，否则开放 session 直接终止，不得原 session 换绑新链；紧急泄漏立即停测并导入撤销/新安装版。
- 试测漂移：课堂证据引用的组合、题目、renderer、资产、策略或评分器版本与 PILOT ACTIVE 版本不一致时，门禁失败。
- 未获批路径：缺少有效独立批准时，任何真实题目激活或真实学生课堂试测请求以稳定错误失败，不得回退到 DRAFT 临时映射；题目已 ACTIVE 但学校协议/授权链不完整时同样不得创建或启动课堂 session。

## 8. 迁移与兼容性

- 本功能需要一项受限 schema migration：为 `assessment_sitting.end_reason` 增加 `ENDED_BY_AUTHORIZATION_INVALIDATION`，为 `business_session_assignment.release_reason` 增加 `AUTHORIZATION_INVALIDATED`；同步共享枚举、事件 payload、reducer/recovery 和迁移测试。来源隔离由追加式 `PILOT_AUTHORITY_PROVENANCE_REVIEW_REQUIRED` 事件及其投影派生，不新增隔离状态列、表或第二套状态机。
- 回滚分为两个不可混淆的阶段：首次写入两个新 reason 或两个新事件前，允许在事务中重建表并真正 down migrate 到旧 CHECK，前提查询必须证明数据库和 JSONL 均无新值/事件；任一新 reason 或事件写入后，数据合同成为 expand-only，应用回滚只能部署仍识别并重放新旧 reason/事件的兼容版本，同时保留扩展 schema。此后任何旧 schema down migration 必须在写入前无损拒绝，禁止映射、删除、降格历史 reason 或截断事件，失败前后数据库和 JSONL hash 必须不变。
- 96 条导入总量和来源追溯保持不变；仅选定 50 道获得完整结构化 DRAFT 合同，其余候选不得被删除或伪装为已审核。
- 已存在的 `question-policy-v1.2` 是新基础能力 session 的权威结构；旧 `question_ratio` 只在明确识别的历史策略上兼容读取。
- 当前或历史 session 继续使用创建时的题目快照和策略版本。未来激活必须创建或确认独立策略版本，不原地改写已引用 v1。
- 历史 `ANSWER_SUBMITTED` 继续回放；新事件不要求重写旧 JSONL。若 reducer 无法同时兼容两类事件，功能状态改为 BLOCKED。
- 授权和学校记录使用版本化 JSON/JSON Schema、追加式生命周期事件及 session 事件快照，不为生命周期新增数据库状态枚举。若实现无法在现有事件/JSON/审计存储上可靠持久化最高 revision、时间水位和授权快照，或除上述两个 reason 枚举外还需 schema 变化，必须停止并把新增影响重新纳入 R3 审查。
- 历史签发件、公钥和签名算法必须保留为只读验证目录；轮换只追加 successor 和生效关系，不覆盖旧 key、旧签名或旧 session 快照。历史验证器不得把历史专用旧根重新用于新的授权决策。
- asset manifest 当前共有 270 项，其中含 30 项 BASE_ABILITY 关联资产及岗位、训练、共享/参考项；Q1 必须按实际 scope 分组对账，不得把 270 误写为全属 JOB_SKILL。无关项及其 hash 不得漂移。
- 激活前回滚恢复到现有 v1 门禁和全部 DRAFT/NO_SCORE 候选，不涉及运行库写入。激活后发现问题时不得把 ACTIVE 题退回 DRAFT 或原地改语义；停止新 session，将受影响题 `DISABLED / ARCHIVED`，以新题版本重走门禁，同时保留历史 session、结果、报告和批准台账。

## 9. 非功能要求

### 9.1 性能

- 当前权威基线未批准题目切换或提交的固定毫秒阈值；Q1 不把未经裁决的 500/800ms 写成产品 SLA。技术演练应记录题目切换、提交、事件投影和线下评分耗时，供后续基线裁决。
- 本地资产加载失败不得导致页面崩溃或错误计 0；阻断和重试必须可观察。
- TIMED_TASK 的计时必须使用单调时钟或等价可靠计时，不能把渲染掉帧直接解释为学生能力。

### 9.2 可访问性

- 覆盖鼠标、触控和键盘替代路径；拖拽必须有选择目标/移动/确认的非拖拽操作方式。
- 控件、焦点、提示和错误状态在现有 E2E 白名单 `1366x768 / 1280x720 / 375x812` 下无重叠、溢出或状态跳动；每次截图前断言实际 content viewport。
- 颜色不作为唯一信息；文字、图片和音频具备适当替代；AAC 与日常辅具不自动扣分。
- 指令保持低认知负荷，避免开发说明、评分线索和答案暗示出现在学生端。

### 9.3 隐私与审计

- 题目、答案、审核人、合同 hash、生成器/评分器版本和试测汇总均可追溯。
- Pilot 批准链必须追溯安装版/验证器版本、信任根 ID/指纹、授权登记/责任清单/批准 ID 与 payload hash、各签名 `key_id` 和验证结果、全部参与比较的稳定 `principal_id`、入口类型、实际 `auth_session_id` 或 CLI 本次进程认证 ID、由可信执行上下文解析的 ADMIN `user_id` 及失败码；还必须追溯产品、学校和逐学生同意三侧生命周期状态、`issued_at / effective_at / expires_at`、revision/前序 hash、`published_at / next_refresh_at`、撤销/替代人/时间/原因、`compromised_at / invalid_from`、同意撤回 `reported_at`/证据 hash、决策时间与最近校验水位，不得记录账号凭据。
- 每个真实 Pilot session 必须冻结产品批准、学校授权和适用知情同意的 ID/hash/revision/状态/有效期；授权失效终止、grant/assignment 释放和来源隔离事件必须能回溯同一失效事实。晚到失效还必须记录稳定 `invalidation_fact_id`、失效来源/cause、`invalidation_at`、本机 `detected_at`、与运行区间的关系及永久隔离状态。
- 审核 JSON 可保存审核人身份；课堂试测仓库证据只能保存匿名标识或汇总，不保存学生姓名、账号、健康信息、原始视频或家庭信息。
- 产品负责人和批准人私钥不得进入仓库、应用、日志、目标数据库或激活包；不覆盖人工原件，Markdown 不是机器输入。

### 9.4 可观测性

- 门禁输出逐阶段状态、阻断码、题号、当前/预期 hash 和证据路径。
- 批准验证输出每一层签名/绑定/主体集合校验结果，但不得输出私钥、签名原始材料之外的敏感凭据或允许绕过的内部秘密。
- 生命周期验证输出签发件派生状态、统一决策时间、最高已见/本次 revision、刷新期限、时间水位和触发失效的精确事件；启动扫描必须同时扫描受影响开放与已终态 session，逐一输出终止或隔离结果，不能只把全局门禁改成 BLOCKED。
- renderer、资产、评分和事件错误进入现有异常中心或结构化测试报告；阻断型错误不能只显示 Toast。
- 报告快照继续记录策略、题库、资产、内容 schema 和评分器版本。

## 10. 验收标准

### 10.1 权威链与选择

1. 机器检查可从当前 xlsx 和导入 SQL复算 96 条候选、87 线上、8 线下、1 观察项及其 source hash。
2. Pilot 权威恰好标记 50 道计分题：42 ONLINE + 8 OFFLINE；每个基础能力模块 ONLINE 恰好 7 道；`GA-EMO-014` 不在计分集合。
3. 激活前的选定清单中，50 道均为 `bank_domain = BASE_ABILITY`、`item_usage = SCORED_ITEM`、`status = DRAFT`；JOB_SPECIFIC 命中数为 0。后续状态变化只按 §10.6-10.7 的批准与激活验收执行。
4. 未选 46 道都有稳定题号、来源和未选原因；构建过程不删除候选题。
5. 任一来源、集合、逐题内容或评分 hash 漂移都会使门禁失败，并列出受影响题号。

### 10.2 内容、答案与线下 rubric

6. 入选 50 道全部通过完整 `question-content-v1.2` 与跨字段 validator；扁平候选格式不得被判为试测就绪。
7. 入选 42 道线上题全部使用合法自动评分类型和 0/2 分值，不存在 `NO_SCORE`、答案双写、任意脚本或 1 分路径。
8. 每道自动评分题的答案结果可由人工审核 JSON 复算，且审核结果绑定当前逐题 hash。
9. 8 道线下题均有稳定 setup/item ID、标准材料规格、布置/复位/清洁/终止说明和逐题 0/1/2 行为锚点；通用“未完成/部分完成/完全达标”模板被拒绝。
10. 16 条安全敏感候选中，凡被选入的题均声明必需专业审核；全部 8 道线下题必须经过安全技术和特教/可访问性审核。

### 10.3 v1.2 组卷与隔离

11. schema 基础能力种子策略可被运行时按 `question-policy-v1.2` 成功解析，不访问 `question_ratio`。
12. 组卷 SQL 显式过滤 BASE_ABILITY、ACTIVE、SCORED_ITEM 和 job_code；混入 JOB_SPECIFIC、OBSERVATION_ONLY、DRAFT 或未注册 renderer 的 fixture 时不被选中。
13. 显式临时技术演练库使用合成身份、合成授权和所选 50 道 ACTIVE 测试夹具时，session 快照稳定生成 42+8、每模块 7 道，题目集合与锁定清单一致；重复构建可复现，且不得把测试状态写回 DRAFT 权威。
14. 任一模块不足、线下不足、感官过滤后不足或资产/renderer 不可用时返回明确阻断，不回退到 14/14/14 题型要求，也不静默换成未选题。

### 10.4 renderer、评分、事件与恢复

15. 入选的每种 interaction type 至少各有合法、非法 answer shape 和主进程评分 fixture；所有线上路径只产生 0/2 或 NULL。
16. 主进程评分器仅凭冻结 `content_json`、`scoring_rule_json` 和 response envelope 可复算 is_correct、score、failed_criteria 和评分器版本；renderer 不能伪造最终分数。
17. SOFTWARE_TASK 可在学生端完成并提交；SINGLE_CHOICE、DRAG 既有路径无回归；未注册交互在 session 创建前失败关闭。
18. NOT_APPLICABLE、STOPPED_SAFETY、TECHNICAL_INTERRUPTION、ASSISTED_NOT_SCORED 均保存 `score = NULL`，技术故障和 P3 协助不会记 0。
19. 新响应事件完成 payload、writer、reducer、projection、recovery 和测试登记；旧 `ANSWER_SUBMITTED` 日志与新事件混合重放后，答题记录、进度和终态一致且不重复。
20. `scoring_snapshot` 保存 scoring engine version、passed、score 和 failed criteria；未声明的高频 metrics 不进入领域事件。

### 10.5 UI、资产与线下施测

21. 所选线上题在实际断言的 `1366x768 / 1280x720 / 375x812` content viewport 下无文字/控件重叠；触控和键盘替代路径均可完成，焦点和错误提示可辨识。
22. 必需资产必须在 manifest 中存在、状态和 hash 正确、版权确认及适用人工门通过；题目 JSON 不包含绝对路径，统一经 `app://asset/<asset_id>` 加载。
23. 8 道线下卡片显示对应标准指令、教具和终止条件；教师提交前必须确认教具清单，并按 `OFFLINE_ABILITY` 写入，不得混入 `TASK_OPERATION`。
24. 缺文件、hash 不符、教具不全或 renderer 错误时，试测发起/继续被明确阻断，不产生错误 0 分。

### 10.6 人工审核、课堂试测与解释边界

25. 人工审核入口为自包含 HTML，具备自动保存、必填校验和 JSON 导出；JSON 通过 schema、审核人、题目集合、逐题 hash 和汇总复算校验。
26. 审核结果合并只按题目声明的必需轨道裁决；任一必需轨道退回或合同冲突时，该题和整套 42+8 门禁失败。
27. 内容、专业和技术门禁全部通过时，机器报告只进入 `READY_FOR_PILOT_ACTIVATION_REVIEW`，同时断言 `activation_authority_granted = false`；课堂试测证据不在该阶段的必填项。
28. Pilot 激活批准入口必须完成以下机器验收；任一失败时 `activation_authority_granted = false`，不得执行 DRAFT→ACTIVE：
    - 安装版验证器只接受固定且指纹匹配的 `pilot-product-owner-trust-anchor-v1`；从批准包、目标库、CLI、环境变量或 ADMIN 输入替换根时返回 `PILOT_TRUST_ANCHOR_INVALID`。
    - `pilot-approver-authority-registry-v1` 和 `pilot-release-responsibility-manifest-v1` 的精确 UTF-8 payload hash 与产品负责人 Ed25519 分离签名均通过，且共同绑定当前 `BASE_ABILITY + PILOT_ONLY` 版本；缺失、伪造、签名损坏或跨版本复用分别失败。
    - `pilot-activation-approval-v1` 通过 schema，绑定授权登记 ID/hash、责任清单 ID/hash、批准 ID、独立批准人、`issued_at / effective_at / expires_at`、`PILOT_ONLY` 范围、选定 50 题、策略版本及内容/评分/资产/renderer/门禁 hash；批准人 Ed25519 签名必须匹配授权登记公钥。复制获授权姓名/`principal_id`、改 JSON 后复用旧签名或使用未登记密钥均失败。
    - 批准人 `principal_id` 不等于产品负责人，且不出现在责任清单的内容制作、代码实现、门禁生成、计划激活执行集合中，也不等于执行时已认证 ADMIN 映射的实际 `principal_id`。实际 `user_id` 必须由当前 sender 的 ACTIVE `auth_session`，或独立运维 CLI 在目标库交互认证形成的本次进程上下文解析，并命中责任清单预签名的 `user_account.user_id ↔ principal_id` 映射。主体映射缺失或任一相交分别返回 `PILOT_PRINCIPAL_MAPPING_MISSING`、`PILOT_APPROVER_NOT_INDEPENDENT` 或 `PILOT_APPROVER_EXECUTOR_CONFLICT`；伪造请求 `callerUserId`、`callerRole`、`principal_id`，或 CLI `--user-id/--role`/环境变量均不得改变判定，账号凭据不得出现在进程参数或日志。
29. 产品根、批准人登记、责任清单、激活批准、学校授权人登记、学校课堂授权和逐学生同意均通过 schema，并具有有限且非空的 `issued_at / effective_at / expires_at`；产品根最长 365 天、批准人/学校授权人登记最长 90 天、责任清单/激活批准最长 30 天、学校课堂授权/逐学生同意最长 14 天，且下游不得晚于上游。每类在精确最大边界通过、超过 1 秒失败；表驱动测试覆盖 `PENDING / ACTIVE / EXPIRED / REVOKED / SUPERSEDED / INVALID`、`now = effective_at` 有效、`now = expires_at` 失效及终态不得恢复 ACTIVE。
30. 产品侧签名撤销/替代事件必须绑定目标 ID/hash/key、签发人、时间、原因码和非空原因；普通撤回、常规轮换、批准人密钥泄漏和产品根泄漏 fixture 均能导出确定状态。批准人只能撤回本人批准，ADMIN 自签、回填普通撤销的生效时间、修改旧文件或临时双根均失败；只有密钥泄漏可声明更早且有证据的 `compromised_at / invalid_from`。
31. 学校授权人登记必须由产品根签名；学校课堂授权与 `student-trial-consent-v1` 必须由登记学校密钥签名。逐学生同意绑定 consent/organization/student、协议要求的签署方、原始证据 hash、可信见证教师、模板/范围和 14 天内有效期；缺项、伪造/未登记密钥、错学生/组织/模板、过期/撤销/替代或旧 revision 均不能创建或继续真实 session。
32. 当前有权施测的 ACTIVE TEACHER 代录撤回时，`STUDENT_CONSENT_WITHDRAWAL_REPORTED` 以可信 auth session 绑定本人、目标学生、consent ID/hash、由主进程生成且不可由请求覆盖的 `reported_at = invalid_from`、原因及撤回证据 hash，并立即阻断该学生。无权教师、ADMIN/学生伪造、错 consent/student、客户端回填时间、同 ID 不同 payload 均失败；它不能授予、延长、恢复同意或影响其他学生，并完成 EventType、payload/validator、JSONL、projection/recovery、幂等和并发测试。学校签名事件确认更早撤回时间时必须触发第 36 条晚到失效处置。
33. 产品生命周期索引 revision 递增、前序 hash 连续且最大租约 24 小时；存在可运行课堂授权时，学校授权/同意索引最大租约 4 小时。精确最大租约通过、超过 1 秒失败；低于本机最高 revision、断链、`now >= next_refresh_at` 或 `now < last_successful_authorization_check_at` 时，激活和全部真实 session 写入口返回稳定 stale/rollback/clock 错误，不能由 ADMIN 覆盖。
34. 同一测试矩阵证明激活、session 创建、grant/assignment 创建、学生确认、坐次开始/恢复、线上作答、线下评分和 session 完成都在主进程写事务内以统一 UTC 重验产品、学校和逐学生同意三条链；校验后任一 revision 在提交前变化时事务回滚，不追加业务事件。离线租约内提交也必须在晚到失效导入后进入第 36 条处置。
35. 产品批准、学校授权或逐学生同意在开放 session 中失效时，启动扫描或下一业务动作拒绝当前输入：有开放 sitting 时先追加 `SITTING_ENDED(ENDED_BY_AUTHORIZATION_INVALIDATION)`，再追加 `SESSION_ABORTED`（稳定授权失效 reason），以 `AUTHORIZATION_INVALIDATED` 撤销/释放 grant/assignment，且之后答题/评分/完成均失败；已有响应不生成完整 ABILITY_SCORE。与红线并发时只保留 `REDLINE_HALTED` 终态，授权处置不得降级或覆盖安全事实。
36. 表驱动测试覆盖每种失效来源（产品批准、学校授权及其上游登记、逐学生同意）与 `invalidation_at <= created_at`、`created_at < invalidation_at <= terminal_at`、`invalidation_at > terminal_at` 三种关系，并分别覆盖失效到达本机时 session 开放/已终态及安全红线并发。运行区间重叠的已完成 session 必须保持原终态和 session/result/report bytes，追加 `PILOT_AUTHORITY_PROVENANCE_REVIEW_REQUIRED` 并永久隔离结果、报告、`TRIAL_EVIDENCE_ACCEPTED` 与正式解释；该事件完成 EventType、payload/validator、JSONL、projection/recovery、幂等/冲突及各写门禁测试，MVP 内人工复核也不能恢复证据资格。失效晚于终态时历史资格不变。
37. 常规轮换、泄漏处置和授权恢复必须创建新 ID/hash/签名及可追溯 successor；旧链只供历史验签，开放 session 必须按第 35 条终止且不得重新绑定新链继续。计划轮换须安排无开放 session 窗口，产品根轮换须经单独审查的安装版发布。
38. 有效批准执行后恰好 42 ONLINE + 8 OFFLINE 为 ACTIVE，其余 46 题仍为 DRAFT，同一批准 ID 重放不产生额外变化；批准后来失效只把阶段门禁转为 BLOCKED，不把题目退回 DRAFT，新批准必须使用新 ID/hash。
39. 课堂试测证据至少能复算技术中断率、感官替代率、线下评分一致性和完成/中断分布，并绑定实际 Pilot 题集、策略、renderer、资产、评分器及产品/学校/逐学生同意授权快照版本；处于来源隔离的 session 不得计入。
40. 试测发现安全、构念、答案、评分或可访问性问题时，受影响 ACTIVE 题停止进入新 session 并转为 DISABLED/ARCHIVED；旧证据不能沿用到新 question/hash，必须重新审核/激活/试测受影响范围。
41. 页面和报告统一使用“基础能力教学诊断试测”；`pilot_mode = true` 时 placement advice 保持 disabled，并展示总分权重、证据类型和效度限制。
42. 只有 `TRIAL_EVIDENCE_ACCEPTED` 才可进入 `READY_FOR_FORMAL_INTERPRETATION_REVIEW`；证据接受本身不启用正式解释、对外发布或 placement advice。
43. 正式解释批准必须记录产品与专业责任、适用证据和结论边界，并创建新策略版本；修改已引用 Pilot 策略或历史结果必须失败。

### 10.7 激活边界与回归

44. 默认导入 SQL 和未获批运行库始终保持 DRAFT；显式临时库中的合成 ACTIVE 测试夹具不得导出、复制或解释为激活产物。
45. 实现完成前至少执行并如实记录：BASE_ABILITY 合同门禁、相关脚本/validator/组卷/评分/事件/renderer/激活权限与授权生命周期测试、migration 前滚/回滚测试、`npm run typecheck`、`npm run lint`、`npm test`、`npm run build`、`npm run docs:index:check` 和 `git diff --check`。
46. 真实 Electron 合成身份技术演练至少见证一条完整 42+8 主路径、一条技术中断路径、一条安全停止/红线路径、一条中断恢复路径、一条授权失效终止路径和一条晚到失效隔离路径；这不构成学校课堂试测证据，未执行项必须标为 NOT_RUN。
47. 技术演练命令未传显式临时数据库路径、路径解析到默认 userData/`xc-career-guide.db` 或默认数据库运行前后 hash 改变时失败。
48. 真实激活命令必须要求当前 ACTIVE 批准、显式 Pilot 目标库、目标库身份校验、备份、预期 50 题集合与事务后复核；任一失败整体回滚，不得留下部分 ACTIVE。
49. 获批课堂路径必须通过业务 session、grant、assignment、student confirmation 和 device 三方一致性测试；错误学生/设备、过期 grant、未确认 assignment 和非法 rebind 均失败。
50. `pilot_mode != true`、`placement_advice_enabled != false`、策略/批准 hash 不匹配、产品/学校/逐学生同意授权不是 ACTIVE 或题集不是获批 50 题时，Pilot session 创建失败。
51. 相同稳定 request/answer ID 的并发重复提交只保留一条 current 事实且进度只推进一次；同 ID 不同 payload 返回冲突，不覆盖原记录。
52. `COMPLETED / REDLINE_HALTED / ABORTED` 对线上作答和线下评分均失败；失败不追加评分事实、不推进进度或结果。
53. 四种非 ANSWERED 状态均保持 score/is_correct 为 NULL、使 `completion_ratio < 1`，并阻断完整能力结论与就业安置输出；报告只呈现过程、支持和效度限制。
54. 受影响题转 DISABLED/ARCHIVED 后不得进入新 session；历史 session、答题、结果、报告、批准和课堂证据仍按旧 question/hash 可复现。
55. 状态机测试证明课堂证据缺失不阻断 `READY_FOR_PILOT_ACTIVATION_REVIEW → PILOT_ACTIVE`，但会阻断 `TRIAL_EVIDENCE_ACCEPTED`、正式解释和发布；不得形成新的反向循环依赖。
56. migration 测试必须覆盖两个阶段：数据库/JSONL 尚无新 reason/事件时可事务化前滚再 down 且数据 hash 不变；写入两个新 reason 和两个新事件后，旧 schema down migration 必须在任何写入前无损拒绝，数据库/JSONL hash 不变，而保留扩展 schema 的兼容应用版本能完整重放新旧历史。
57. 失效事实测试必须覆盖自然到期、撤销、替代、密钥泄漏和个人撤回的稳定 `invalidation_fact_id`；同一事实跨索引 revision ID 不变，不同事实不碰撞。到期、撤销和替代并存时逐项保留并以最早 `invalidation_at` 结束 ACTIVE，按 `session_id + invalidation_fact_id` 幂等隔离，较晚事实不得掩盖较早区间重叠。

## 11. 适用不变量

- `INV-EVT-001`、`INV-EVT-002`、`INV-EVT-003`
- `INV-SAFE-001`、`INV-RES-001`、`INV-RES-002`
- `INV-AUTH-001`
- `INV-STR-001`、`INV-STR-002`
- `INV-IPC-001`、`INV-IPC-002`
- `INV-DATA-001`、`INV-DATA-002`、`INV-DATA-003`
- `INV-AUTH-002`
- `INV-A11Y-001`

## 12. 风险、回滚与停止条件

### 12.1 主要风险

- 分数解释风险：7 道精细动作线下题使精细动作最大分值为 28，不能把总分说成六模块等权。Q1 必须保留 Pilot 限制，并等待产品/专业团队对权重解释签字。
- 内容效度风险：工程上容易实现的题未必最能覆盖构念；选择必须有测评学理由和未选原因，不能由 renderer 成本单独决定。
- 评分漂移风险：content、renderer 和 scoring rule 各存答案会产生历史不可复算；答案必须只在 scoring rule，事件保存评分快照。
- 事件兼容风险：切换新响应事件可能破坏旧 JSONL 重放；必须保留旧 reducer 分支和混合历史测试。
- 安全风险：线下材料、姿势、疲劳和安全题解释未经专业确认时不得试测；真实红线必须继续优先熔断。
- 无障碍风险：拖拽、计时、多点触控和 AAC 若只有单一输入方式，会把界面操作障碍误当能力不足。
- Pilot 范围泄漏风险：schema 的 ACTIVE 本身不表达 PILOT_ONLY；session 创建必须同时校验冻结 Pilot 策略、独立批准 hash、学校协议和完整授权链，不能只看题目状态。
- 批准独立性风险：批准人与内容制作、代码实现、门禁生成或激活执行责任混同会使门禁失去意义；批准 schema 和执行入口必须机械拦截角色/责任冲突并留痕。
- 批准根替换风险：若激活调用能携带新的公钥或责任清单能自签，ADMIN 仍可构造完整外观的自授权链；信任根必须固定在经审查安装版中，所有下游证据都向该根验签。
- 私钥泄漏风险：产品负责人、批准人或学校责任人私钥一旦进入仓库、应用、日志、数据库或授权包，签名只剩形式；私钥必须离线/由本人保管，泄漏后由上游根撤销登记，停止开放 session，并对与 `invalid_from` 重叠的历史证据追加来源复核门禁。
- 同意真实性风险：只保存“已同意”布尔值或允许 ADMIN/任意教师代录会使个人同意不可验证。必须使用学校责任人签名、绑定学生/模板/原始证据 hash 的有限期同意；教师入口只可报告本人有权施测学生的撤回，且只能减权。
- 离线撤销传播风险：目标安装无法感知尚未送达的撤销。产品索引最大租约 24 小时，存在课堂授权时学校/同意索引最大租约 4 小时；紧急撤销立即现场停测，导入新索引并完成失效处置后才可恢复。离线租约内完成也不是安全港，晚到失效必须按运行区间回溯隔离，不能把“未联网”解释为授权继续有效。
- 枚举回滚风险：SQLite 旧 CHECK 和旧应用不能承载新增 reason/事件；首次写入前可 down，写入后只能保留扩展 schema 并回滚到兼容应用版本。任何声称可无损降回 v0.1.16 的操作都必须失败关闭，不能以改写历史换取降级。
- 时间回拨风险：只按可调系统时钟判断有效期会让过期授权复活；必须持久化最近成功授权校验 UTC，检测回拨并阻断，待可信人工校时与审计恢复后才能继续。
- 解释升格风险：课堂证据接受只是正式解释评审的输入，不得自动启用 placement advice、正式量表措辞或对外发布。

### 12.2 回滚

- 内容与脚本按版本化 JSON/生成物回退，保留上一版本 hash 和审核原件。
- renderer/评分/事件实现按原子步骤回滚；旧 `ANSWER_SUBMITTED` 兼容分支在完成历史验证前不得删除。
- 合成技术演练使用显式临时库，结束后不合并回默认数据库。真实激活在事务失败时整体回滚；激活后发现问题则停止新 session，将受影响题 DISABLED/ARCHIVED，并以新 question ID 重走审核与激活，不退回 DRAFT 原地修改。
- 学校可通过登记密钥撤回课堂试测授权/逐学生同意，批准人可撤回本人批准，产品负责人根可撤销下游登记/清单/批准或学校授权人登记；有权教师只能追加即时减权的个人撤回报告。所有撤销和轮换只追加事件与 successor，不修改原件。未创建 session 时直接阻断；开放 session 关闭 sitting、事件化 ABORTED 并释放授权链；运行区间与失效重叠的已完成 session 只追加隔离，不删除或覆盖。新 reason/事件已有事实后回滚应用时保留扩展 schema，并只使用兼容版本重放，不能回到不识别它们的旧二进制或旧 CHECK。
- 任一门禁失败时回到 `BLOCKED_*`，不得通过手工编辑汇总 JSON改成通过。
- 信任根变更只能通过单独审查和安装版发布回滚/轮换；不得为恢复激活临时接受旧根、新根或 ADMIN 提供的公钥。新安装版必须保留旧根的历史验签目录，但旧根不得再参与新的授权决策。

### 12.3 停止条件

- 权威 PRD、schema、共享类型或来源 xlsx 对 42+8、分值、域隔离产生新的未裁决冲突。
- 需要超出 §8 明列两个 reason 枚举的 schema/migration、修改权限模型或安全 FSM、改变 42+8 权重或就业解释，但未先修订并审查本 PRD；或在新 reason/事件已有历史后要求降回旧 CHECK/旧二进制、映射或删除历史值。
- 任一 R3 审查仍有 P0；两轮修订后仍有 P0 时状态改为 BLOCKED。
- 缺少能承担内容/测评或安全/特教责任的人工审核人，却要求把对应门禁写成通过。
- 激活请求缺少有效独立批准、批准人与执行人不独立、目标库不明确、集合/hash 不一致，或要求批量激活 96 题。
- 安装版没有可核对的产品负责人信任根，或要求从批准包/运行时输入替换根；授权登记、责任清单、批准 JSON 的任一签名/主体映射无法验证。
- 任一产品/学校/逐学生同意签发件缺授权人签名、超过最大有效期或下游晚于上游；生命周期 revision 回退/断链、索引超过 24/4 小时最大租约或刷新期限、时钟回拨、撤销/替代无法验证，或要求 ADMIN 手工恢复终态授权。
- 无法在每个 session 写边界事务内重验授权，无法事件化终止受影响开放 session，无法按晚到失效时间矩阵隔离已完成 session，或授权失效处置会覆盖安全红线、历史作答、结果和报告。
- 课堂试测要求弱化 DRAFT/ACTIVE 或 Pilot/正式解释边界、绕过学校协议/多设备授权链，或保存未获授权的学生敏感数据。
- 正式解释/发布要求原地修改已引用 Pilot 策略、跳过课堂证据接受或输出未经批准的就业安置方向。
- 评分器无法仅依赖冻结合同复算，或历史事件无法确定性重放。

## 13. 已确认决策、假设与未解决问题

### 13.1 已确认决策

- 当前产品合同继续使用 42 道线上 + 8 道线下、满分 100；线上每模块 7 道、每题 0/2，线下每题 0/1/2。
- `BASE_ABILITY` 只生成 `ABILITY_SCORE`，不与 JOB_SKILL、TRAINING_COMPLETION、OPERATION_PASS_RATE 混算。
- 采用方案 A：选定 50 题先完成内容、专业和技术门禁，再经独立 Pilot 激活批准成为 ACTIVE，之后执行真实课堂试测；课堂证据只门禁正式解释/发布。
- 独立批准人由产品负责人书面指定，且不得参与该版本内容制作、代码实现、门禁生成或激活执行；ADMIN 只负责按批准执行，不能自授权限。
- 书面指定的机器可信来源固定为“安装版产品负责人公钥根 → 产品负责人签名的批准人授权登记/版本责任清单 → 登记批准人签名的批准 JSON”；独立性只按稳定 `principal_id` 和实际执行身份判定，不按姓名、角色或自报声明判定。
- 产品批准链、学校授权链和逐学生同意链统一使用不可变签发件、有限 `[effective_at, expires_at)`、追加式签名生命周期事件和可回退检测的 revision 索引；状态只派生为 `PENDING / ACTIVE / EXPIRED / REVOKED / SUPERSEDED / INVALID`，终态不复活。最大期限为产品根 365 天、批准人/学校授权人登记 90 天、责任清单/激活批准 30 天、学校课堂授权/逐学生同意 14 天，且下游不得晚于上游。
- 学校机器可信链固定为“安装版产品负责人根 → 产品负责人签名的学校授权人登记 → 登记学校责任人签名的课堂授权/逐学生同意”；同意绑定学生、模板、原始证据和可信见证教师。当前有权施测的教师只能报告撤回，不能授予、延长或恢复同意；产品批准和题目 ACTIVE 均不能替代个人同意。
- 产品生命周期索引最大租约 24 小时；存在课堂授权时学校授权/同意索引最大租约 4 小时。离线租约不是撤销安全港，revision/链/租约/时钟异常均失败关闭。
- 授权失效后不回退题目 DRAFT：阻断未来运行，开放 session 关闭 sitting、事件化 ABORTED 并释放 grant/assignment，安全红线优先；对晚到失效按 `[created_at, terminal_at]` 与 `invalidation_at` 判定，运行区间重叠的已完成 session 保持事实不变但永久隔离解释和证据，MVP 内人工复核也不能恢复资格。
- 同意撤回事件固定使用现有 `SYSTEM + consent_id` aggregate；所有到期/撤销/替代/泄漏/撤回都生成稳定 `invalidation_fact_id`，多原因逐项保留并取最早失效时间。两个 reason 枚举在首次新值/事件写入后成为 expand-only 数据合同，只允许保留扩展 schema 的兼容应用回滚。
- Pilot ACTIVE 只表示受控运行资格；真实课堂还需要学校协议和完整授权链，正式解释仍需课堂证据接受、独立评审和新策略版本。
- 当前阶段统一使用“基础能力教学诊断试测”，不宣称标准化诊断或自动就业安置。
- 唯一原始候选来源仍是 `通用基础能力正式测评候选题库_v0.2-软件优先版.xlsx`；旧 xlsx 和归档 SQL 不再使用。
- 现有 v1.2 组卷、评分、事件和 renderer 合同差异属于 Q1 真实施测就绪的必要缺口，不另留给激活步骤临时修补。

### 13.2 合理假设

- 当前 schema 足以承载所需响应、评分和结果；实施主要是合同、内容、事件、服务和 UI 收口。
- 入选 50 道是 Pilot 唯一允许提交激活评审的集合；未选题继续 DRAFT，不作为运行时临时替补。
- 合成身份技术演练可在显式临时库完成；它只满足技术前置门，不能替代独立 Pilot 激活批准、学校课堂批准或真实课堂证据。
- 方案 A 的阶段状态和批准文件可由版本化 JSON/门禁承载，不要求新增数据库状态；若实现证明无法在不修改 schema 的情况下可靠限制 PILOT_ONLY 运行，必须停止并重新审查。
- P0-02 的威胁边界是应用级 ADMIN 不能伪造或替换批准链；操作系统级替换已审查安装包属于部署完整性问题，仍必须由安装包校验/发布流程防护，不能由本地批准 JSON 解决。
- 现有 asset manifest 的 BASE_ABILITY E 类与共享资产可复用；新增量由最终选题和交互设计复算，而不是在 PRD 中猜数量。

### 13.3 已关闭的产品决策

- 原“课堂试测在 DRAFT→ACTIVE 之前还是之后”的 P0 已由方案 A 关闭：不建立 DRAFT 课堂旁路；先独立批准并激活选定 50 题，再按学校协议试测，课堂证据门禁正式解释/发布。
- 该决策已同步到权威 PRD、`base-ability-current-contracts.md`、evaluation memo 和 Q1 总计划。
- `P0-02` 已由可信批准链关闭：产品负责人信任根固定在经审查安装版中，产品负责人签名批准人授权登记和版本责任清单，登记批准人签名批准 JSON；机器按稳定 `principal_id` 和可信执行上下文拒绝未获指定者、伪造批准、参与者自批及 ADMIN 自授。专项独立复审结论为 `PASS`。
- `P0-03` 已关闭：产品批准、学校授权和逐学生同意均有可信签发、状态、最大有效期、撤销人/时间/原因、轮换/泄漏、离线最大租约及失效后新/开放/历史 session 时间矩阵；最终独立 `/vibe-review prd` 为 `PASS`，P0/P1/P2 均为 0。

### 13.4 未解决但不阻断前置工具设计的问题

- 最终 42 道线上题的具体 ID、交互分布和选择理由，需要在 Q1 内容选择步骤中由机器预选与专业人员共同确认。
- 内容/测评、安全/康复、特教/无障碍审核人的姓名和学校责任人尚未提供；这不阻断工具和候选包实现，但阻断相应人工门禁通过。
- 课堂试测学校、样本、时间、教师间一致性阈值和复测间隔尚待专业团队写入试测协议；缺失时课堂门禁保持 PENDING。
- 当前 100 分权重是否长期解释为“理货岗位基础准备度指数”，还是将线下表现改为独立画像，仍需产品与专业团队裁决；Q1 不修改现行计分，但该决策阻断正式量表/就业解释。
- 最终所需 renderer 组合和新增资产数量取决于入选题；一旦选定，必须在 `/vibe-impl` 前半段冻结登记副作用，不能在实现中无记录扩张。
