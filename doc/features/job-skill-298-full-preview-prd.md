# JOB_SKILL 298 题全量预览版 Mini-PRD

## 1. 文档状态

- 状态：APPROVED（独立 R3 闭合复核：PASS；已批准进入实施规划，尚未实施）
- 风险等级：R3
- 产品决策日期：2026-07-31
- 用户已确认路线：`298题全量入预览库、教师全库可见、素材AI并行生产、逐题包开放`
- 独立审查记录：`doc/features/job-skill-298-full-preview-prd-r3-review.md`（历史记录）
- 独立 R3 闭合复核记录：`doc/features/job-skill-298-full-preview-prd-r3-closure-review.md`
- 权威依据：
  - `doc/specs/baseline.yaml`
  - `doc/specs/MVP_PRD_v1.0.9-authoritative.md`
  - `doc/specs/project-invariants.md`
  - `doc/ai/vibe-workflow-contract.md`
  - `doc/features/job-skill-shelver-runtime-authority-v1.json`
  - `doc/features/job-skill-shelver-phase4-activation-gate-v1.json`
  - `doc/features/job-skill-shelver-current-contracts.md`
  - `doc/features/question-bank-resources-prd.md`
  - `doc/assets/asset-manifest.json`

### 1.1 权威合同同步结果

权威 PRD 正文已于 2026-07-31 升级为 v1.0.10，并纳入并行的 `PREVIEW_ONLY` 产品路径。固定 18+6、满分 48 继续是正式示范测评合同；298 题全量预览不替代、不扩容也不改写该正式结果链。

298 题当前用途已统一为 297 道计分题和 1 道观察题，其中线下为 99 道 `SCORED_ITEM + OFFLINE_RUBRIC` 和 1 道 `OBSERVATION_ONLY + TEACHER_OBSERVATION`。`M5_OP_048_V4`、`M5_OP_055_V3` 的替代版本已经完成审核，按计分实操题管理；旧版本观察语义只保留历史追溯价值。

[!] 产品合同已经更新，但当前 v0.1.18 实现仍只有固定 18+6 JOB_SKILL 运行时，没有教师全库目录、PREVIEW_ONLY 题包、逐题交付状态或学校反馈出口；当前 assessment 完成/红线投影也尚未具备 PREVIEW_ONLY 的正式结果抑制分支。本 Mini-PRD 描述目标状态，不得被写成“已经实现”。

### 1.2 本次风险分级理由

本功能至少涉及 `UI_UX`、`DOMAIN_LOGIC`、`EVENT_PROJECTION`、`IPC_API`、`AUTH_PERMISSION`、`SAFETY_FSM`、`RESULT_REPORT`、`ASSET_CONTENT` 和 `DEPLOYMENT_OPERATIONS`。虽然首阶段明确不新增 Schema，但会改变 JOB_SKILL 会话用途、题包版本、结果解释边界和内容包发布方式，并涉及持久化导入和历史复现，因此按 R3 管理。

## 2. 问题与目标

### 2.1 当前行为

1. 当前机器权威已保留 298 道 JOB_SKILL 当前题目版本，全部为 `DRAFT`。
2. 只读导入预检可成功映射 298 道题，题型分布为 96 道单选、68 道判断、34 道拖拽和 100 道线下实操或观察。
3. 当前 Phase 4 门禁把 24 道 Pilot 题、270 项素材和全库激活绑定成一个总开关；任何一项未完成时，所有题均不能激活或创建 JOB_SKILL session。
4. 教师端没有 298 题完整目录、逐题可用状态、题包预览入口或面向学校的结构化反馈出口。
5. 当前 JOB_SKILL 运行时、结果和报告只支持固定 18+6、满分 48 的正式示范测评语义。
6. 270 项素材当前均为 `planned`，其中一部分属于 UI、共享参考或后续内容，不应继续作为 298 题全部入库和教师查看的总门槛。

### 2.2 用户问题

学校已经审核过完整题库并希望在开学前看到和使用完整内容。只提供 24 道题无法支持学校内部预览、课程安排、问题反馈和上级部门材料准备。当前全有或全无的门禁把内容入库、教师浏览、学生作答、正式评分和素材生产混为一件事，导致已经具备价值的内容无法提前交付。

### 2.3 目标行为

1. 298 道当前题目版本全部进入学校预览内容库，并在教师端完整可见。
2. 教师可以按 M1-M6、题型、线上/线下、复核状态、素材状态和可作答状态筛选、查看和预览题目。
3. 题目以不可变、版本化的系统预设题包逐批开放；任何题目的缺口只阻断该题及包含它的题包版本，不阻断全库浏览或其他题包。
4. AI 辅助素材生产与学校预览并行进行；每批素材经过机器校验和人类审核后，立即投影到 `asset_resource`，并触发受影响题目的可用性重算。
5. 学校预览产生可追溯的作答、线下评分、安全事件和问题反馈，但不生成正式岗位胜任等级、就业安置建议或跨题包可比较的 JOB_SKILL_SCORE。
6. 已有审核结果按题目版本和语义 hash 继承；只对后来发生语义变化且缺少当前证据的题目做差异复核，不要求学校重审全部 298 道题。

### 2.4 成功定义

1. 教师账号可以在离线学校环境中看到 298/298 道当前题目，数量、题号和版本与运行时权威完全一致。
2. 所有当前不依赖数字素材且通过内容、答案、rubric、renderer 和安全检查的题目均进入首批预览题包，不再设置 24 道的人为上限。
3. 每完成一个资产批次，只新增或升级受影响题包版本；其他已开放题包不回退，历史 session 不漂移。
4. 学校可以导出自包含 HTML 填写入口和 JSON 权威反馈结果，反馈能定位到题目 ID、版本、题包版本、session 和资产版本。
5. 预览会话在异常退出、重复命令、安全红线和资产失效情况下仍保持可恢复、可审计和失败关闭。

## 3. 用户角色与权限

### 3.1 STUDENT

- 只能进入教师已分配且当前仍可用的预览题包 session。
- 只能查看 session 快照内的题目与已批准素材。
- 可以提交线上答案、请求帮助、暂停或恢复允许恢复的 session。
- 不得浏览完整题库、答案键、rubric、素材审核状态或其他学生数据。
- 不得把预览作答情况解释或导出为岗位胜任结论。

### 3.2 TEACHER

- 可以浏览 298 题完整预览目录和逐题交付状态。
- 可以查看题干、选项、标准答案或评分锚点、材料清单、支持要求和效度限制。
- 可以分配系统已发布的预览题包，不得把 `CATALOG_ONLY` 题目临时加入 session。
- 可以完成线下评分、教师观察和安全红线操作。
- 可以生成并填写学校反馈包，导出 JSON 和由 JSON 生成的 Markdown 留档。
- 不得批准 AI 素材、改写题目状态、修改策略或覆盖历史题包版本。

### 3.3 ADMIN

- 可以执行经过校验的 298 题预览内容包导入、资产批次导入和题包发布运维。
- 只能执行产品负责人签名且机器校验通过的 `job-skill-preview-pack-release-responsibility-manifest-v1` 与 `job-skill-preview-pack-release-approval-v1`；不能生成、自签、改写或扩大责任、身份映射或批准范围。
- 只能把完整审核链、文件 hash 和运行时合同均通过的资产投影为 `ACTIVE`。
- 可以停用有缺陷的题包版本或题目新版本，但不得删除历史 session、题目、素材、结果或反馈证据。
- 安全事件终结权限继续遵循 `INV-AUTH-001`，不因预览版扩大。

### 3.4 内容生产与审核人员

- AI 只生成候选素材和机器预审信息，不具备内容、职业、安全、特教、测评或激活批准权限。
- 人类审核结论必须绑定稳定 reviewer 身份、题目/资产 ID、版本、hash、时间和审核范围。
- 现有学校审核证据与当前语义 hash 一致时直接继承；不一致时只复核差异版本。
- 产品负责人使用安装版固定信任根对应的离线密钥签署逐题包责任清单与预览发布批准；该责任主体不是新的应用登录角色，且必须与实际执行发布的 ADMIN `principal_id` 不同。

## 4. 核心场景

### 4.1 教师浏览完整题库

Given 298 题预览内容包已经导入，部分题目仍缺素材或当前版本复核，

When TEACHER 打开 JOB_SKILL 预览目录，

Then 系统展示 298 道题，并为每题明确展示 `可作答`、`仅目录可见` 或 `已停用` 状态及稳定原因码；缺素材不得让题目从目录消失。

### 4.2 分配首批无数字素材题包

Given 一组题目不引用数字素材，且答案、rubric、renderer、安全和版本证据均通过，

When ADMIN 发布包含这些题目的不可变题包版本，TEACHER 将其分配给学生，

Then 系统创建预览 session、冻结题目和策略快照，并允许学生或教师完成对应线上/线下流程；不得因为其他未完成资产阻断该题包。

### 4.3 素材批次后补

Given 某批图片、视频、音频或工具卡完成 AI 辅助生产和人类审核，

When ADMIN 导入经批准文件并校验 hash，

Then 系统只更新 `DRAFT` 题目的候选绑定或创建新的题目版本，重新计算相关题目的可用状态，并发布新的题包版本；已被 session 引用的题目和题包不得原地改变。

### 4.4 预览会话作答与反馈

Given 学生完成一个预览题包，教师完成该题包所需线下评分，

When TEACHER 查看本次情况并导出反馈包，

Then 系统展示题包内的完成情况、逐题响应、支持使用、技术中断和安全事实，并生成自包含 HTML 与机器可读 JSON；不得生成正式胜任等级、就业安置建议或跨版本排名。

### 4.5 运行中素材失效

Given session 已冻结题目和素材 hash，但本地文件随后缺失或校验失败，

When 学生启动、恢复或进入受影响题目，

Then 系统失败关闭该题，记录 `TECHNICAL_INTERRUPTION` 和稳定错误码，保留此前已提交事实；不得记 0 分、临时换题或继续显示损坏素材。

### 4.6 安全红线

Given 学生在任一预览线上或线下环节出现安全红线，

When TEACHER 触发红线，

Then 系统继续按 `student_id + job_code + task_code` 先熔断相关开放 session，再补充归因；预览模式不得降低或绕过既有安全 FSM 和权限。

## 5. 范围

### 5.1 本次包含

1. 298 题全量 DRAFT 内容包的非破坏性导入与数量/hash 对账。
2. 教师端完整题库目录、筛选、题目详情和逐题交付状态。
3. 逐题可用性计算与稳定阻断原因码。
4. 系统预设、不可变、版本化的预览题包；题包按模块、线上/线下和交付批次拆分。
5. 预览题包的教师分配、学生线上作答、教师线下评分、暂停恢复和安全红线。
6. 预览作答情况汇总，不形成正式结果类型或岗位等级。
7. 自包含学校反馈 HTML、自动保存、必填校验、JSON 导出和由 JSON 生成的 Markdown 留档。
8. 270 项素材的优先级重排、Prompt 编译、AI 辅助生产、机器校验、人类审核、批量入库和题目版本补绑。
9. 24 道首批题当前版本证据与既有审核证据的差异对账。
10. 99 道线下计分题 `rubric_anchor_status` 与现有具体 0/1/2 锚点、审核 hash 的一次性对账。
11. `M5_OP_048_V4`、`M5_OP_055_V3` 计分实操语义的导入、validator 和专项验收一致性保护。
12. 现有 18+6 正式示范测评的历史兼容和结果隔离。

### 5.2 明确不包含

1. 教师自由选题、复制试卷、编辑试卷或完整 `assessment_paper` 后台。
2. 298 道题一次性组成单个学生 session。
3. 随机组卷、自动难度平衡、跨学校常模或题目参数估计。
4. 将预览题包输出为 `JOB_SKILL_SCORE`、`ABILITY_SCORE` 或任何新的正式结果类型。
5. 根据预览数据输出岗位适合/不适合、竞争性就业、支持性就业或证书结论。
6. AI 自动批准题目、答案、rubric、素材或策略。
7. 学校端在线生成 AI 素材；学校运行继续保持离线。
8. 删除或覆盖现有 18+6 策略、历史 session、结果、报告和审核 manifest。
9. 本阶段新增 Schema、migration、权限角色或外部付费运行时依赖。
10. BASE_ABILITY 路线扩容；其 42+8 工作继续独立推进。

## 6. 行为与数据变化

### 6.1 预览目录与可用状态

每道当前题目必须同时具有两个互不混淆的维度：

- 库内状态：继续使用 `question_bank.status` 的 `DRAFT / ACTIVE / DISABLED / ARCHIVED`。
- 预览交付状态：由当前题目 authority、审核证据、资产注册表、renderer registry 和内容合同计算，不新增数据库枚举。

预览交付状态固定为：

| 状态 | 含义 | 教师可见 | 可进入发布请求 |
|---|---|---:|---:|
| `CATALOG_ONLY` | 已入库但至少一个运行门禁未通过 | 是 | 否 |
| `PREVIEW_RELEASE_CANDIDATE` | 当前版本已通过全部预览内容与运行门禁，但尚未绑定 PREVIEW_ONLY 发布批准；库内状态可为 DRAFT，也可因正式发布或其他授权来源已经 ACTIVE | 是 | 是 |
| `PREVIEW_READY` | 当前题目版本为 ACTIVE，且已绑定至少一个有效 `JOB_SKILL_PREVIEW_ONLY` 发布批准和已发布 PREVIEW_ONLY 题包 | 是 | 是 |
| `PREVIEW_DISABLED` | 曾可用，因缺陷或资产失效停止新使用 | 是 | 否 |
| `ARCHIVED_HISTORY` | 仅供历史追溯 | 按权限 | 否 |

`CATALOG_ONLY` 必须带一个或多个稳定原因码：

- `CONTENT_RECONFIRMATION_REQUIRED`
- `SAFETY_TECH_REVIEW_REQUIRED`
- `ANSWER_KEY_NOT_VERIFIED`
- `RUBRIC_ANCHOR_NOT_VERIFIED`
- `ITEM_USAGE_CONFLICT`
- `ASSET_NOT_APPROVED`
- `ASSET_COMMERCIAL_USE_NOT_CLEARED`
- `ASSET_FILE_UNAVAILABLE`
- `RENDERER_NOT_READY`
- `CONTRACT_INVALID`
- `SUPERSEDED_VERSION`

状态计算必须确定、可复算。UI 不得用笼统的“未完成”隐藏原因，也不得把 `DRAFT` 自动等同于内容不合格；无 PREVIEW_ONLY 发布批准时，即使题目已由正式链转为 ACTIVE，也只能显示 `PREVIEW_RELEASE_CANDIDATE`，不能提前显示为 `PREVIEW_READY`。`question_bank.status = ACTIVE` 只表示至少一条运行授权链允许使用，不证明正式和预览两条链都已授权。

### 6.2 全量内容导入

1. 新安装或隔离预览库可以导入 298 道当前版本，初始均为 `DRAFT`。
2. 已有业务数据的数据库只允许增量 upsert；不得执行当前旧脚本中的全域 `DELETE FROM question_bank WHERE bank_domain = 'JOB_SPECIFIC'`。
3. 若 question_id 已被 session、答题或评分引用，任何语义变化必须创建新 question_id/version 并建立 supersede 关系。
4. 导入必须校验 source/current ID、version、candidate hash、semantic hash 和 runtime authority hash。
5. 题目入库不要求数字资产已批准；但带未满足资产引用的题目只能是 `CATALOG_ONLY`，不能进入可发起题包。
6. 导入和资产补挂不得操作默认用户数据库；实施与验收使用显式隔离数据库，学校部署另走批准的内容包运维步骤。

### 6.3 题包合同

1. 预览题包继续使用 `strategy_config.question_policy_json` 的 `FIXED_SET` 思路，新增明确的 `PREVIEW_ONLY` 策略语义字段；具体 JSON 合同由实现计划定义并进入共享类型与 validator。
2. 题包发布请求只能包含同一 `job_code = SUPERMARKET_SHELVER`、`bank_domain = JOB_SPECIFIC` 且为 `PREVIEW_RELEASE_CANDIDATE` 或已由其他有效题包批准的 `PREVIEW_READY` 题目；发布事务提交后，当前包内每题必须均为 `PREVIEW_READY`。
3. 题包按 M1-M6、ONLINE/OFFLINE/OBSERVATION 和交付批次拆分，避免一次 session 承载 298 道题。
4. 单个题包的题号、题目版本、资产 ID/hash、renderer 版本、策略 ID/version 和可用性证据必须随题包版本冻结。
5. 同一题包版本一旦被任一 session 引用即不可修改；新增题目、补素材或修文案必须发布新版本。
6. 不允许 session 创建时临时换题、跳过缺口题或从 DRAFT 随机补题。
7. 包含线下题的题包必须同时冻结材料清单、复位要求、0/1/2 锚点和必要安全停止条件。
8. 系统可以并存多个已发布题包版本，但教师新分配默认只显示当前版本；历史版本仅用于恢复和追溯。
9. 首批题包不得设置 24 道总量上限。当前 authority 中所有不依赖数字素材且通过其余门禁的题目都必须纳入首批分包候选。
10. 每个预览题包至少包含 1 道 SCORED_ITEM；当前唯一 OBSERVATION_ONLY 题只能嵌入含计分题的题包，不能形成 `max_score = 0` 的独立 session，否则返回 `PREVIEW_PACK_SCORED_ITEM_REQUIRED`。
11. v1.0.10 后新策略必须显式声明 `delivery_mode = FORMAL_DEMO | PREVIEW_ONLY`。只有冻结兼容注册表中的既有正式 strategy_id/version 可在缺字段时解释为 FORMAL_DEMO；新策略缺失、拼写错误或未知值均失败关闭，不得按 task_code、名称、题量或 max_score 推断。
12. PREVIEW_ONLY 与正式示范测评共用 `task_code = JOB_SKILL_DEMO_M1M6`，由冻结策略的 delivery mode 区分。这是有意保持同一学生-岗位-任务安全边界：两种会话不能并行开放，任一路径的未解决安全事件都会阻断另一条路径。
13. delivery mode 解析只允许以下顺序：字段存在时按判别联合校验；缺字段且 strategy_id/version 精确命中冻结兼容注册表时解释为 FORMAL_DEMO；v1.0.10+ 新 policy 缺字段返回 `QUESTION_POLICY_DELIVERY_MODE_MISSING`；其他缺字段返回 `QUESTION_POLICY_LEGACY_COMPATIBILITY_DENIED`；拼写错误或未知值返回 `QUESTION_POLICY_DELIVERY_MODE_UNKNOWN`。不得读取题量、task_code、名称、max_score 或 fixed IDs 推断。

### 6.3.1 逐题激活与题包原子发布

1. 每个新题包版本必须同时具有不可变 `job-skill-preview-pack-release-responsibility-manifest-v1` 和 `job-skill-preview-pack-release-approval-v1`，两者均由安装版固定的产品负责人 Ed25519 信任根直接验签。责任清单绑定 pack ID/version、批准签发人 principal_id、计划执行发布的 `user_account.user_id ↔ principal_id` 唯一映射及责任范围；批准明确 `scope = JOB_SKILL_PREVIEW_ONLY`，绑定责任清单 ID/hash、pack ID/version、delivery mode、job code、精确 question ID/version/semantic hash、asset ID/hash、renderer registry hash、内容/答案或 rubric/专业/安全审核证据 ID/hash、门禁结果 hash、签发人 principal_id、issued/effective/expires 时间和 payload hash。两者必须满足 `issued_at <= effective_at < expires_at` 且有效期不超过 30 天。
2. 预览发布批准只授权该精确题包必要的 DRAFT→ACTIVE、PREVIEW_ONLY 授权引用与发布；题目已经由正式链或其他有效来源转为 ACTIVE 时，不得重写状态，但仍必须写入并复验当前 PREVIEW_ONLY 授权引用。该批准不授予正式 18+6、JOB_SKILL_SCORE、其他题目、其他版本或后续新题包权限。批准必须在执行时有效；到期不回写已发布历史，但阻断重放为新发布和任何未完成发布。
3. ADMIN 只能在可信认证上下文中执行批准：Electron 入口从当前 sender 绑定且仍 ACTIVE 的 auth_session 取得 `user_id`，独立 CLI 必须在目标库交互验证 ACTIVE ADMIN 账号并创建仅限本进程的认证上下文；再用已签名责任清单将该 `user_id` 机械映射为 executor principal_id。映射缺失、一个 user_id 对应多个 principal、请求正文自报/覆盖映射、映射签名无效，或 executor principal_id 等于批准签发人时，均失败关闭。
4. 一个 durable `JOB_SKILL_PREVIEW_PACK_RELEASE` 命令必须在单一原子提交边界内：复验责任清单/批准签名、身份映射、有效期、全部 hash 和逐题门禁；把批准集合中仍为 DRAFT 的精确题目版本转为 ACTIVE；对已因正式发布或其他有效授权来源而 ACTIVE 的同一语义版本只复验并增加当前题包的 PREVIEW_ONLY 发布引用，不重写状态；写入不可变 PREVIEW_ONLY strategy/题包版本、责任清单与批准 ID/hash 及可恢复审计事实。DISABLED/ARCHIVED 题失败关闭，不得复活。
5. 任一题、资产、renderer、身份映射、批准或写入失败必须回滚整个命令，不得留下部分 ACTIVE、半个题包或无审计的策略。批准/签名/期限无效返回 `PREVIEW_PACK_RELEASE_APPROVAL_INVALID`；执行身份映射无效返回 `PREVIEW_PACK_RELEASE_EXECUTOR_IDENTITY_INVALID`；签发人与执行人实际为同一 principal 返回 `PREVIEW_PACK_RELEASE_SEPARATION_OF_DUTIES_FAILED`；相同 approval ID/hash 重放幂等返回同一结果，同 ID 不同 hash 返回 `PREVIEW_PACK_RELEASE_CONFLICT`。dry-run 只输出拟激活集合和阻断原因，不写库。
6. 发布成功后，新 session 仍逐次复验题目 ACTIVE、题包当前可分配、对应 delivery mode 的独立发布授权来源、资产/renderer/hash、assignment/grant 和安全阻断。FORMAL_DEMO 必须验证正式 Phase 4/正式发布批准 ID/hash，缺失返回 `FORMAL_RELEASE_AUTHORITY_MISSING`；PREVIEW_ONLY 必须验证当前责任清单、预览批准和题包引用，缺失返回 `PREVIEW_RELEASE_AUTHORITY_MISSING`。预览先把重叠题转为 ACTIVE 绝不能使正式 18+6 自动可运行，正式先激活也不能跳过预览题包批准。
7. `/vibe-impl` 必须证明现有 strategy、审计和 durable command 边界能够保存责任清单、批准和相互独立的正式/预览发布授权来源，并完成上述原子恢复；若必须新增表、列、事件权限或状态，停止并提交单独 R3 变更，不得弱化为 ADMIN 手工激活。

### 6.4 预览结果解释

1. 预览 session 可以展示题包内：已答/未答数量、自动评分题答对数量、线下 0/1/2 分布、response_status、支持等级、技术中断和安全事实。
2. 上述信息统一命名为“本题包作答情况”，只描述当前题包和当前版本。
3. 预览 session 不写 `JOB_SKILL_SCORE`、`ABILITY_SCORE`、`TRAINING_COMPLETION` 或 `OPERATION_PASS_RATE`。
4. 不计算或展示 `LEVEL_COMPETENT / LEVEL_CONDITIONAL / LEVEL_NOT_COMPETENT`。
5. 不跨题包平均，不跨版本比较，不生成 M1-M6 综合岗位画像，不进入正式教学效果统计。
6. 安全红线仍生成 `REDLINE_HALTED`、incident、binding 和对应安全说明；安全优先级不因不生成普通结果而降低，但 PREVIEW_ONLY 红线同样不得生成 result_record 或正式 task_report。
7. 现有 18+6 正式示范测评继续按满分 48 的原合同运行，必须通过 strategy/scoring policy 与预览题包明确隔离。

### 6.5 审核证据对账

1. 274 道非首批题按当前 runtime authority 中的 resolution 和 candidate hash 继承已完成复审链。
2. 24 道首批题不得继续被一个总 `PILOT_GATE_PENDING` 掩盖：
   - 5 道当前候选已有内容、安全和技术通过证据，按 hash 对账后可解除内容阻断；
   - 12 道改版题需要当前内容差异确认；
   - 7 道改版题需要当前内容、安全和技术复核；
   - 6 道线下题的 Electron renderer witness 属技术运行证据，不要求重审未变化的题目语义。
3. 若既有学校审核文件能证明当前 candidate/semantic hash 未变化，应机械继承，不重新发整套审核包。
4. 若审核证据只绑定旧版本或无法核对 hash，题目仍可目录展示，但保持 `CATALOG_ONLY`。
5. 99 道线下计分题虽然已具有具体 score labels 和 criteria，但 `rubric_anchor_status = PENDING`；只有审核证据与当前语义 hash 一致时才能批量改为已验证，否则逐题保留阻断。

### 6.6 AI 辅助素材并行生产

资产生产分为独立批次，不再等待 270 项一起完成：

1. `P0_QUESTION_STIMULUS`：直接阻断线上题作答的图片、视频、音频和答案图。
2. `P1_OFFLINE_DELIVERY`：线下示例图、工具卡、角色脚本、音频、固定数据和布置说明。
3. `P2_SHARED_UI_REFERENCE`：共享参考、UI 和不直接阻断当前题包的资源。

每批固定流程：

```text
锁定题目/答案/素材合同 hash
→ 编译并复核 prompt_text
→ AI 生成候选文件
→ 机器校验格式、尺寸、时长、hash、文字叠加和答案一致性
→ 人类视觉/职业/特教/安全/测评审核
→ manifest 标记 approved
→ 批量投影 asset_resource ACTIVE
→ 重算受影响题目状态
→ 发布新题包版本
```

规则：

1. AI 生成请求和素材 Prompt 不得包含学生、教师或学校个人信息。
2. 图片继续遵循当前项目指定的图像生成合同；视频、音频和程序化文字叠加使用各自批准的生产链，不能用静态图片冒充必须依赖动态线索的题目。
3. AI 预审不能替代人类批准，`generated` 或 `reviewing` 不得写入运行库为 `ACTIVE`。
4. 每项候选资产必须在 manifest 中保存可追溯来源、生成模型或制作方式、许可信息和版权审核结论；`rights.commercial_use_cleared` 不是 `true` 时，稳定原因码为 `ASSET_COMMERCIAL_USE_NOT_CLEARED`，不得批准、投影为 `ACTIVE` 或解锁题目。
5. 资产文件、manifest、题目引用和 runtime `asset_resource` 的 ID/hash 必须一致。
6. 资产批次失败只能让相关题目保持 `CATALOG_ONLY`，不得撤销其他已通过题目的目录可见性或题包。

### 6.7 学校反馈包

1. 面向教师和职教专家的反馈入口使用自包含 HTML，支持本地自动保存、必填校验和 JSON 导出。
2. JSON 是机器可读权威反馈；Markdown 只能由 JSON 生成用于留档。
3. 校内工作记录可以使用真实 `session_id` 定位原始事实；自包含 HTML、JSON 和 Markdown 等外部导出只能绑定随机生成、不可由真实 ID 推导的 `session_export_ref` 和 `subject_export_ref`。映射表只保留在学校受控的本地 userData 区域，不进入导出、日志或 AI Prompt。
4. 外部反馈固定包含学校匿名代码、题包 ID/version、question ID/version、asset ID/hash、结构化问题类型、严重程度、稳定反馈 ID/revision、匿名引用和提交时间；不得序列化原始 session/student/teacher ID。
5. 复现步骤、教学观察等自由文本默认只保存在本地草稿，不进入外部 JSON。教师明确选择外发时，系统必须先执行本地敏感数据检测并显示最终脱敏预览；检测到姓名、电话、身份证号、邮箱或其他疑似身份信息时失败关闭，完成删除或替换、重新扫描并由教师显式确认后，才可导出脱敏文本。
6. 反馈提交不得直接激活/停用题目、修改策略、批准素材或覆盖历史 manifest。
7. 同一反馈包重复导出必须保留稳定反馈 ID 和匿名引用；修改后生成 revision，不覆盖旧 JSON。
8. `/vibe-impl` 必须用现有持久化和权限证据说明匿名映射与本地草稿如何保存；若不改 Schema 无法满足映射隔离、恢复和删除责任，必须停止并提交单独 R3 Schema 决策。

### 6.8 事件与投影

1. 预览 session 继续复用现有 assessment event、reducer、projection 和恢复链，不新增第二套 session 表。
2. 所有已受理 mutation 继续经过 durable command coordinator 与 v2 event batch 边界。
3. 若实现需要新增 EventType，必须同步 payload、validator、JSONL、projection、recovery 和幂等测试，遵循 `INV-EVT-003`。
4. 目录读取和可用性计算是只读查询，不得直接修改 session 或题目状态。
5. 题包发布按 §6.3.1 的 durable 原子命令和批准 ID/hash 审计；停用和内容包导入的具体事件映射由实现计划列全，但不得只靠 UI 状态或临时日志证明。

### 6.9 IPC/API

预计需要以下能力边界，实际命名由实现计划确定：

- 教师分页列出 JOB_SKILL 预览题目及筛选条件。
- 教师读取单题预览详情和阻断原因。
- 教师列出可分配预览题包。
- 教师创建/恢复预览 session。
- 教师导出学校反馈包。
- ADMIN 执行显式路径的内容包/资产包校验与导入。

所有新 IPC 必须同步主进程 handler、preload 白名单、shared type、权限校验、参数校验、错误映射和 IPC 测试；renderer 不得直接读取仓库 JSON、文件系统或 SQLite。

### 6.10 影响矩阵

| 影响域 | YES/NO | 证据与说明 |
|---|---|---|
| UI / UX | YES | 新增教师全库目录、详情、题包入口和反馈出口；学生复用题目交互 |
| Domain model | YES | 新增 PREVIEW_ONLY 题包语义和逐题可用性计算 |
| Database / migration | YES/NO | 有 DRAFT 内容和 ACTIVE 资产的持久化导入；本阶段明确 NO Schema/migration |
| Event / projection | YES | 复用 assessment 事件链；题包发布/停用审计需实施计划收口 |
| IPC / API | YES | 新增目录、详情、题包和导出边界 |
| Authentication / authorization | YES | STUDENT/TEACHER/ADMIN 可见性和运维权限不同 |
| Safety / FSM / concurrency | YES | 预览 session 继续适用红线、开放会话唯一性和恢复规则 |
| Result / report | YES | 预览只生成题包作答情况，不生成正式 result_record；18+6 结果保持隔离 |
| Accessibility | YES | 学生题面和教师筛选均需键盘、触控、字号、对比度和低认知负荷验收 |
| Privacy / audit | YES | 学校反馈默认匿名，题目/资产/题包版本与操作必须可追溯 |
| Backward compatibility | YES | 不能改变既有 18+6 session、结果、报告和已引用题目语义 |
| Deployment / rollback | YES | 新内容包和资产包分批部署；按题包停用回滚，不删除历史 |

### 6.11 跨文件副作用登记

| 主变更 | 必须同步核验 |
|---|---|
| PREVIEW_ONLY strategy JSON | shared type、validator、strategy service、session snapshot、fixtures、版本冻结测试 |
| 逐题激活与题包发布 | 产品负责人签名责任清单/批准 Schema 与 validator、固定信任根、auth_session/CLI `user_id ↔ principal_id` 映射、ADMIN 执行权限、durable command、共享 ACTIVE 的双授权来源、strategy 原子写入、幂等/回滚/恢复测试 |
| 题库目录 IPC | handler、preload、shared IPC type、权限、分页/筛选测试、renderer store/view |
| 逐题可用性计算 | question validator、asset registry、renderer registry、审核 authority、稳定错误码 |
| 预览 session 分支 | planner/service、事件 payload、reducer/projector、恢复、幂等、红线、assignment/grant |
| 不生成正式结果 | completion 流程、result service、report service、查询页、统计、回放测试 |
| 资产批量后补 | manifest、文件/hash、asset_resource seed、题目版本绑定、app asset protocol、回滚 |
| 学校反馈导出 | IPC、文件选择/写入、匿名引用与校内映射隔离、敏感数据检测、脱敏预览、HTML 自动保存、JSON Schema、Markdown 生成器 |
| PRD 范围变更 | 权威 PRD、baseline 说明、doc index、现有 JOB_SKILL 门禁与测试 |

## 7. 边界条件与异常处理

### 7.1 空数据和数量漂移

- runtime authority 不是恰好 298 题时，全量内容包发布失败。
- 题号重复、source/current 映射不唯一、hash 缺失或模块/题型对账漂移时失败关闭。
- 筛选结果为空时展示空状态，不把全库计数误显示为 0。

### 7.2 重复导入和重复分配

- 相同内容包 ID/hash 重复导入必须幂等。
- 同 ID 不同 hash 必须拒绝，不能覆盖。
- 同一 `student_id + job_code + task_code` 已有开放 JOB_SKILL_ASSESSMENT session 时，正式和 PREVIEW_ONLY 均按现有唯一性规则返回既有可恢复入口或稳定冲突错误，不得并行开放。

### 7.3 并发资产更新

- session 创建使用事务内同一份题目、策略和资产可用性快照。
- 资产在 session 创建后失效时，启动/恢复/提交均需按冻结 hash 复核；失效不得把已答题改写为 0。
- 题包新版本发布与旧版本 session 并发时，旧 session 始终使用旧快照。

### 7.4 中途失败与恢复

- 内容包、资产包和题包发布必须原子化；失败不能留下半批 ACTIVE。
- 逐题激活与题包发布必须由同一个 `JOB_SKILL_PREVIEW_PACK_RELEASE` durable 命令提交；不得先批量 ACTIVE 再补题包，也不得先发布不可运行题包再补状态。
- 应用异常退出后恢复到最后一个已提交事实之后。
- feedback HTML 自动保存失败时必须显式提示并允许导出当前内存内容，不得静默丢失。

### 7.5 题目停用

- 新发现答案、职业、安全、素材或 renderer 缺陷时，立即阻断包含该题的新题包版本。
- 已发布题包版本进入不可新分配状态；进行中的 session 按缺陷严重度执行暂停、技术中断或安全熔断，不能静默换题。
- 历史 session、答案、评分和反馈仍可按原快照读取。

### 7.6 终态和修订

- 完成、作废或红线终止的 session 不得回到开放态。
- 答案和线下评分修订继续使用现有 revision 机制。
- 已导出的反馈 JSON 修改后必须形成新 revision。

## 8. 迁移与兼容性

1. 本阶段不新增或修改数据库表、列、CHECK、trigger 或 migration。
2. 298 题导入使用现有 `question_bank`，批准资产使用现有 `asset_resource`，预览题包使用现有 `strategy_config` 和 `assessment_session`。
3. 如果 `/vibe-impl` 证明无法在不改变 Schema 的前提下实现题包审计、预览完成或反馈边界，必须停止并提交单独 R3 Schema 决策，不得顺手加表或放宽约束。
4. 现有 18+6 策略和 `job-skill-result-v1.0 / job-skill-report-v1.0` 不原地修改；需要正式全量评分时另立产品合同和版本。
5. 已有真实数据数据库不得执行全量删除重导。新安装种子和既有库增量导入分别提供验证路径。
6. 应用回滚时停用新的预览题包和目录入口；已创建 session 和事件必须仍能被兼容版本读取或明确阻止降级，不能丢失。

## 9. 非功能要求

### 9.1 性能

- 298 题目录首屏查询和渲染在目标设备上不超过 2 秒。
- 筛选或翻页反馈不超过 500ms。
- 单题详情不一次加载无关大文件；图片和视频按需加载。
- 答题持久化继续满足当前 500ms 目标。

### 9.2 可访问性

- 教师目录支持键盘、触控和清晰焦点状态；筛选条件不只依赖颜色区分。
- 学生题面继续满足低认知负荷、大点击区域、无闪烁和非惩罚反馈。
- 图片有不泄露答案的替代文本；视频提供必要字幕或等效说明，但不得改变目标构念。
- 缺素材状态不向学生显示技术堆栈或内部路径。

### 9.3 隐私与审计

- AI 素材生产不得出网发送学校或学生个人数据。
- 外部反馈只使用随机、不可逆推的匿名引用；真实 session/student/teacher ID 与匿名引用的映射只保留在学校受控本地 userData，受既有角色权限约束且不得导出。
- 自由文本默认本地保存且不外发；显式外发必须经过本地敏感数据检测、脱敏预览和教师确认，命中疑似身份信息时失败关闭。
- 内容包、资产包、题包和反馈包均有稳定 ID、版本、hash、生成时间和来源。
- 不在日志记录答案正文、学生自由文本隐私、凭据或本地绝对路径。

### 9.4 可观测性

- 目录状态统计至少输出 298 总数、各交付状态和各阻断原因数量。
- 每个资产批次输出计划、生成、审核、批准、入库和解锁题目数量。
- 每个题包记录创建失败的稳定错误码，不只记录自由文本。
- 学校预览统计与正式 JOB_SKILL 结果统计分开。

### 9.5 离线与部署

- 学校侧浏览、分配、作答、评分、反馈和恢复均不依赖网络。
- AI 生成只在开发/内容生产环境执行，学校安装包只接收批准后的不可变资产。
- 内容包和资产包必须支持显式目标库、dry-run、对账和失败回滚。

## 10. 验收标准

### AC-01 全量目录对账

Given 当前 runtime authority，When 对隔离预览数据库执行内容包 dry-run 和导入，Then 题目总数为 298，M1-M6 分别为 48/41/58/48/55/48，题型为 96/68/34/100，source/current ID、version 和 hash 全部一致。

验证：自动化合同测试 + 隔离 SQLite 查询。

### AC-02 教师全库可见

Given 298 题均为 DRAFT 且 270 项资产均未批准，When TEACHER 打开预览目录，Then 仍能看到 298/298 道题及逐题原因；STUDENT 和无权限账号不能访问目录和答案/rubric。

验证：IPC 权限集成测试 + Playwright 教师/学生人工走查。

### AC-03 缺口局部阻断

Given 两道 DRAFT 题中一道缺资产、另一道除发布批准外全部通过，When 系统计算可用性，Then 前者为 `CATALOG_ONLY + ASSET_NOT_APPROVED`，后者为 `PREVIEW_RELEASE_CANDIDATE`；缺资产题不得阻断后者进入题包发布请求。

验证：表驱动单元测试。

### AC-04 首批不设 24 题上限

Given 当前 authority 的逐题资产引用审计，When 构建首批候选，Then 所有零数字资产引用且通过其余门禁的题目均被纳入分包候选；数量漂移必须输出逐题差异，不能硬编码或截断为 24。

验证：authority 全量集合测试。

### AC-05 当前版本复核对账

Given 24 道首批题的现有审核证据，When 按 candidate/semantic hash 对账，Then 已匹配证据直接继承，未匹配的 12+7 道分别保留相应阻断；不得把整个 24 题集合一律标记为通过或一律标记为未审核。

验证：审核链 fixture 正向/负向测试。

### AC-06 线下 rubric 对账

Given 99 道线下计分题，When 执行 rubric gate，Then 每题具备可观察、互斥的 0/1/2 锚点并绑定当前 semantic hash；仍为 `PENDING` 且无匹配证据的题不能成为 `PREVIEW_RELEASE_CANDIDATE` 或 `PREVIEW_READY`。

验证：question contract 全量测试。

### AC-07 观察语义权威一致性

Given `M5_OP_048_V4` 和 `M5_OP_055_V3` 当前替代版本，When 执行导入、validator 和题包门禁，Then 两题保持 `SCORED_ITEM + OFFLINE_RUBRIC`；当前唯一观察题 `M1_OB_048_V3` 保持 `OBSERVATION_ONLY + TEACHER_OBSERVATION`，PRD、runtime authority、item_usage、interaction、scoring 和专项验收完全一致。

验证：合同检查 + 两题定向 fixture。

### AC-08 不可变题包

Given 一个已被 session 引用的题包版本，When 尝试原地增加题目、换素材或改变 renderer/评分合同，Then 操作失败；新内容只能通过新题目或题包版本发布。

验证：策略冻结和 session 快照集成测试。

### AC-09 预览任何终态都不生成正式结果

Given 一个 PREVIEW_ONLY session，When 它正常完成、红线终止或作废，Then 系统可显示和导出对应的本题包过程事实，但数据库不新增 JOB_SKILL_SCORE、ABILITY_SCORE、TRAINING_COMPLETION 或 OPERATION_PASS_RATE，也不生成胜任等级、正式 task_report 或就业建议。

验证：结果/报告集成测试和数据库断言。

### AC-10 正式 18+6 回归

Given 现有正式示范策略，When 完成 18+6 session，Then 仍按满分 48 生成 JOB_SKILL_SCORE 和 JOB_SKILL 报告；预览策略不得改变其题量、结果或历史报告。

验证：现有 JOB_SKILL result/report 回归测试。

### AC-11 素材批次解锁

Given 一个只缺单项素材的题目，When 对应资产具有可追溯来源和许可、`rights.commercial_use_cleared = true`，并经过人工批准、文件/hash 校验后投影为 ACTIVE，Then 仅该题及相关题包候选状态改变；来源、许可、商用授权或任一批准门缺失时必须保持 `ASSET_COMMERCIAL_USE_NOT_CLEARED` 或相应阻断，不能解锁题目。

验证：资产 manifest、seed 和可用性集成测试。

### AC-12 运行中资产失效

Given session 已冻结资产 hash，When 文件缺失或 hash 改变，Then 启动/恢复/进入题目失败关闭并记录 TECHNICAL_INTERRUPTION，已答数据不丢失且不记 0 分。

验证：Electron 隔离 userData 人工走查 + 集成测试。

### AC-13 安全红线

Given 同一 `student_id + job_code + task_code` 下有一个或多个正式或 PREVIEW_ONLY 开放 session，When TEACHER 触发红线，Then 按现有安全 FSM 批量熔断并生成 incident/binding，未解决事件阻断两种新 session，教师不能自行解除；数据库不得为其中的 PREVIEW_ONLY session 写入 result_record、FULL_REPORT 或 SAFETY_TERMINATION_REPORT。

验证：安全红线回归 + 预览 task 定向测试。

### AC-14 幂等与恢复

Given 内容包/资产包重复导入或 session mutation 重放，When idempotency key 和请求 hash 相同，Then 返回同一 durable 结果；同 key 不同请求被拒绝，异常退出后可从最后持久化事实恢复。

验证：durable command、event batch 和恢复测试。

### AC-15 反馈包

Given 教师完成预览，When 填写反馈并提交，Then HTML 执行必填校验并导出符合 Schema 的 JSON；导出只含匿名引用和结构化字段，自由文本默认不外发；Markdown 可由 JSON 重建，提交不改变题目、素材或策略状态。

验证：HTML 浏览器测试 + JSON Schema 正负 fixture。

### AC-16 隐私

Given 默认反馈导出和 AI 生成批次，When 检查 HTML、JSON、Markdown、Prompt 和日志，Then 不包含原始 session/student/teacher ID、学生姓名、身份证号、电话、邮箱、凭据或未脱敏自由文本；匿名引用不能由原始 ID 确定性推导。Given 教师选择外发自由文本，When 本地检测命中疑似敏感数据，Then 导出失败关闭；只有重新扫描无命中并完成脱敏预览确认才可导出。

验证：JSON Schema 正负 fixture + 敏感数据检测正负 fixture + 匿名引用非确定性测试 + HTML/JSON/Markdown/日志人工抽查。

### AC-17 性能与可访问性

Given 298 题和目标学校设备，When 加载、筛选和预览目录，Then 满足 §9 性能目标，键盘/触控/焦点/字号/对比度和学生低认知负荷检查通过。

验证：Playwright 性能记录、桌面 Electron 人工验收。

### AC-18 无破坏导入和回滚

Given 已存在历史 JOB_SKILL session 的数据库，When 导入新内容包或回滚预览版，Then 不执行全域 DELETE，不改变已引用题目语义，不删除历史事件/session/result/report；回滚仅停止新分配并保留读取能力。

验证：带历史 fixture 的 migration-free 数据运维测试。

### AC-19 delivery mode 判别与兼容

Given 表驱动 policy fixture，When validator 解析 delivery mode，Then 精确命中冻结兼容注册表的旧正式 strategy 缺字段时按 FORMAL_DEMO 通过；v1.0.10+ 新 policy 缺字段返回 `QUESTION_POLICY_DELIVERY_MODE_MISSING`；注册表外旧 policy 缺字段返回 `QUESTION_POLICY_LEGACY_COMPATIBILITY_DENIED`；拼写错误或未知值返回 `QUESTION_POLICY_DELIVERY_MODE_UNKNOWN`。改变题量、task_code、名称、max_score 或 fixed IDs 不能改变任一结论。

验证：共享 validator 表驱动正负测试 + strategy create/session create 集成测试。

### AC-20 逐题激活与题包原子发布

Given 有效签名责任清单和只绑定当前题包精确版本/hash 的批准，When auth_session/CLI 的当前 ACTIVE ADMIN `user_id` 精确映射为不同于签发人的 executor principal_id 并执行发布，Then 单一 durable 命令把包内 DRAFT 候选转为 ACTIVE、对已由正式链 ACTIVE 的题增加 PREVIEW_ONLY 发布引用、写入不可变 PREVIEW_ONLY strategy 及责任清单/批准 ID/hash，并使全部题成为 PREVIEW_READY。Given 任一题门禁漂移、批准过期/签名无效、映射缺失/多值/请求伪造、执行人与签发人实际同 principal、DISABLED 题、写入故障或同 ID 异 hash，Then 整体失败且数据库没有部分 ACTIVE、半个题包或无审计策略；同 ID/hash 重放幂等。Given 正式链先激活重叠题，Then 它仍可经独立预览批准进入题包；Given 预览链先激活重叠题，Then 正式 18+6 在正式 Phase 4/发布批准通过前以 `FORMAL_RELEASE_AUTHORITY_MISSING` 失败关闭。

验证：签名/权限正负 fixture + 隔离 SQLite 原子性/故障注入/恢复测试 + dry-run 零写入断言。

### AC-21 观察题不得独立成包

Given 只含 `M1_OB_048_V3` 的题包，When 校验或发布，Then 以 `PREVIEW_PACK_SCORED_ITEM_REQUIRED` 拒绝且不创建 max_score=0 session。Given 至少一道 SCORED_ITEM 加该观察题，When 校验，Then 题包可通过其余门禁，max_score 只累计计分题，观察题不进入 online/offline scored count、分数或计分 completion ratio。

验证：question policy/strategy 表驱动 fixture + session snapshot 与计分回归测试。

## 11. 适用不变量

- `INV-EVT-001`
- `INV-EVT-002`
- `INV-EVT-003`
- `INV-EVT-004`
- `INV-EVT-005`
- `INV-EVT-006`
- `INV-SAFE-001`
- `INV-SAFE-002`
- `INV-SAFE-003`
- `INV-SAFE-004`
- `INV-AUTH-001`
- `INV-AUTH-002`
- `INV-RES-001`
- `INV-RES-002`
- `INV-STR-001`
- `INV-STR-002`
- `INV-IPC-001`
- `INV-IPC-002`
- `INV-DATA-001`
- `INV-DATA-002`
- `INV-DATA-003`
- `INV-A11Y-001`

## 12. 风险、回滚与停止条件

### 12.1 主要风险

1. 把“全库可见”误宣传为“全库可有效作答”，造成学校预期再次失配。
2. 预览题包与正式 18+6 结果语义串线，产生不可解释的分数或岗位结论。
3. 复用旧审核结论时未核对当前 hash，导致改版内容未经确认进入学生 session。
4. 为提速绕过素材和 renderer 检查，使依赖视觉/动态线索的题目失效。
5. 全量重导删除已引用题目，破坏历史 session 和回放。
6. AI 素材出现答案泄漏、不符合职业流程、安全误导、人物一致性或版权问题。
7. 预览 session 绕过既有多设备 assignment、幂等或安全红线边界。
8. 298 题目录一次性渲染导致教师端卡顿或信息过载。
9. ADMIN 绕过逐题包批准先批量激活 DRAFT，或激活与题包写入分步失败，留下可被其他策略误用的半发布状态。

### 12.2 回滚

1. 停用当前预览题包版本和教师导航入口，阻止新分配。
2. 保留 DRAFT 题、资产、历史 session、事件和反馈；不执行物理删除。
3. 有缺陷资产改为 `DEPRECATED`，题目转为 `CATALOG_ONLY/PREVIEW_DISABLED`，修复后以新 asset/question/pack version 发布。
4. 正式 18+6 路线继续按原策略运行，不依赖预览题包回滚。

### 12.3 停止条件

出现以下任一情况时停止进入实现或发布：

- R3 独立 Reviewer 仍有未关闭 P0。
- 无法证明预览结果与正式 JOB_SKILL_SCORE 隔离。
- 实现需要 Schema/migration、权限模型扩张或新正式结果类型，但尚未获得单独明确批准。
- 需要删除、覆盖或重写已有业务数据库和历史引用。
- `M5_OP_048_V4 / M5_OP_055_V3` 被错误回退为旧观察语义，或 `M1_OB_048_V3` 被错误纳入计分。
- 任一 `PREVIEW_READY` 题缺少当前版本答案/rubric/专业审核、renderer 或 required asset 证据。
- 安全红线、幂等、恢复或 assignment/grant 回归失败。
- AI 生产需要把学生或学校敏感信息发送到外部服务。

## 13. 已确认决策、假设与未解决问题

### 13.1 已确认决策

1. 298 题全部进入预览内容库并对教师可见。
2. 素材生产与学校预览并行推进，不再使用 270 项全部完成的总门槛。
3. 题目按版本化题包逐批开放，缺口局部阻断。
4. AI 辅助生成素材，但人类保留全部审核和批准责任。
5. 用户确认不再以 24 题作为 JOB_SKILL 首发内容上限。
6. 当前 298 题用途以 99 道计分实操加 1 道观察为准；`M5_OP_048_V4`、`M5_OP_055_V3` 保留已审核的计分实操语义。
7. 学校反馈首发从教师端导出自包含 HTML，并以提交导出的 JSON 作为权威结果；Markdown 只由 JSON 生成留档。
8. 正式与 PREVIEW_ONLY 共用 `JOB_SKILL_DEMO_M1M6` 安全任务边界；delivery mode 只区分结果语义，不隔离安全事件和开放会话唯一性。
9. 外部反馈只使用随机匿名引用；自由文本默认不外发，显式外发必须经过本地检测、脱敏预览和教师确认。
10. 通过逐题预览门禁但尚无预览批准的题成为 PREVIEW_RELEASE_CANDIDATE，无论它仍为 DRAFT 还是已由正式链 ACTIVE；有效逐题包责任清单/批准由产品负责人签署，可信 `user_id ↔ principal_id` 映射必须证明签发与执行职责分离，必要的 DRAFT→ACTIVE、PREVIEW_ONLY 授权引用与题包发布在同一原子命令完成。

### 13.2 本 Mini-PRD 采用的假设

1. “全部上架”指 298 题全部进入教师可见目录；依赖缺失素材或当前版本复核的题目在缺口关闭前不对学生开放。
2. 学校当前目标是尽快形成真实使用和内容反馈，不要求把每个预览题包解释为正式岗位胜任测评。
3. 首阶段使用系统预设题包足以支持学校内部预览；教师自由组卷延后。
4. 现有 `strategy_config + assessment_session` 能在不改 Schema 的情况下承载 PREVIEW_ONLY 题包；该假设必须在 `/vibe-impl` 中用代码和 Schema 证据验证。
5. BASE_ABILITY 当前 42+8 路线不因本需求扩容。

### 13.3 未解决问题

1. 当前 99 道线下计分题的具体锚点与审核 hash 是否足以机械解除 `rubric_anchor_status = PENDING`；需生成逐题对账报告。
2. 270 项资产中实际阻断首批题包的最小集合、生成批次和成本，需要由 asset dependency audit 输出，不能继续按总数推断。
