# 炫灿-职途向导系统 MVP 产品需求文档｜专业岗位示范测评收口版

版本：PRD v1.0.9-job-skill-assessment-mvp-closure
当前工程基线：`schema.sql v0.1.10-scoring-closure`（现状事实一律以 `src/main/db/schema.sql` 为准）
当前类型基线：`src/shared/types/json-schemas.ts`（已实现状态，不代表目标合同已落地；升级差异见附录 E）
目标工程基线：`schema.sql v0.1.12-job-skill-assessment-mvp-closure`
上一版 PRD：`PRD v1.0.8-job-bank-governance-closure`
继承基线：v1.0.5 全文 + v1.0.6 + v1.0.7 + v1.0.8 全部替换与增补
产品阶段：MVP
最后更新：2026-07-07

> **schema 版本说明**：v0.1.11 尚未实际生成。**v0.1.12 是基于现行 v0.1.10，一次性合并 v1.0.7、v1.0.8 和 v1.0.9 要求生成的全量初始化 schema，不要求提供逐版本原地 migration。**
>
> **编写体例说明**：本文是可直接交给 Codex 执行的差异修订版。凡本文未出现的章节，依次沿用 v1.0.8 → v1.0.7 → v1.0.6 → v1.0.5。v1.0.7 的题库数据合同与 v1.0.8 的题库域治理合同（bank_domain、job_module_code、TEACHER_OBSERVATION、VIDEO_SCENE、administration、评分命名迁移、L→P 映射、UNSURE、ACTIVE 即冻结、job_code 统一、素材不可覆盖）**全部继续有效**，本文不重复其条文，只做运行时收口与范围修正。

---

## 0. 定稿说明

### 0.1 本版定位

本系统的核心差异化价值是"专业岗位能力测评"。学校查看 Demo 时必须看到：超市理货员专业岗位测评、M1-M6 六模块能力画像、线上软件化测评、线下实操评分、教师嵌入观察、测评结果与"拆箱与上架"训练任务的衔接、专业岗位测评报告。

因此本版将一套**最小但完整、真实可运行的专业岗位能力示范测评**纳入 MVP，建立以下真实闭环：

```text
学生建档
→ 专业岗位能力示范测评（JOB_SKILL_ASSESSMENT）
→ M1-M6 岗位能力画像
→ 推荐训练重点
→ 进入"拆箱与上架"训练
→ 任务实操评分
→ 综合报告
```

本版不是把 298 题全部上线，也不是开发专业岗位题库后台。298 题全量运营、随机组卷、多套试卷、高级分差指标仍在 Post-MVP。

### 0.2 对 v1.0.8 范围判断的修正声明

v1.0.8 中以下含义的表述**全部废止**：

- "JOB_SPECIFIC 只做静态题库治理"
- "JOB_SPECIFIC 不进入 MVP 测评运行时"
- "专业岗位组卷、评分和报告全部进入 Post-MVP"
- "TEACHER_OBSERVATION 当前不生成运行时记录"
- "JOB_SPECIFIC 不生成 result_record"
- "当前 task_report 不读取 JOB_SPECIFIC"
- "完整专业岗位施测 UI 不进入 MVP"（v1.0.8 附录 B 第 13 条删除）

统一替换为：

> MVP 实现一套固定的 `JOB_SKILL_ASSESSMENT` 专业岗位示范测评，覆盖 M1-M6 六个岗位模块，包含线上自动评分、线下教师评分、教师嵌入观察、岗位模块画像和专业岗位报告。
>
> MVP 不实现 298 题全部激活、随机组卷、完整题库运营、高级分差解释和岗位安置矩阵。

v1.0.8 §5.3.10.4 的"JOB_SPECIFIC → 不进入组卷 / 不生成结果"边界表相应替换为本文 §5.3.10.4（修订版，见 §7.6.3 后附）。v1.0.8 其余治理合同（§0.3 决策 57-69、§5.3.10.1-5.3.10.3、§5.3.10.5、§5.3.11、§5.3.12、§5.4.2 增补、§5.4.4、§7.6.1、§11.12.7-11.12.9、§16.6 增补、§17.10、§19 第 57-70 条）继续有效；其中与本文冲突的个别条目按本文 §0.3 决策与附录 C 修订记录为准。

### 0.3 v1.0.9 新增决策条目（承接 v1.0.8 第 57～69 条）

70. **新增 `JOB_SKILL_ASSESSMENT` 策略类型**：进入 `strategy_config.strategy_type`、`assessment_session.strategy_type`、`result_record.strategy_type`、TypeScript 枚举、事件 payload、strategy 引用一致性 trigger、session 创建/组卷/恢复/报告服务。策略与题库域强绑定：BASELINE_ASSESSMENT ↔ BASE_ABILITY、JOB_SKILL_ASSESSMENT ↔ JOB_SPECIFIC，互相命中数必须为 0。
71. **MVP 使用固定示范卷，不做随机组卷**：线上 18 题 + 线下 6 题（每模块 3+1）+ 教师嵌入观察 0-3 项；固定题目 ID 冻结在 strategy version 的 `question_policy_json` 中（`selection_mode = FIXED_SET`），不新增 assessment_paper 表。固定题缺失/未 ACTIVE/素材缺失/renderer 未实现时发起测评失败，不得临场补题，不得为凑题量降低审核标准。最终题量数字 [需确认]，数据合同按 18+6 设计。
72. **复用 `assessment_session`，不新增第二套 session 表**：专业岗位测评复用现有坐次、暂停/恢复、崩溃中断、安全红线、事件溯源和报告快照；禁止另建 `job_skill_assessment_session`。`assessment_session_question` 扩展 bank_domain / module_type 可空 / job_module_code / item_usage，`question_phase` 增加 `OBSERVATION`。
73. **TEACHER_OBSERVATION 进入 MVP 运行时**：v1.0.8 中"观察通道仅建数据合同"的保守边界废止。OBSERVATION phase → 教师录入观察 → `TEACHER_OBSERVATION_RECORDED` 事件 → offline_score_record（score_scope = TEACHER_OBSERVATION，score = NULL）→ 专业岗位报告。
74. **新增 `JOB_SKILL_SCORE` 结果类型**：专业岗位测评结果不得写成 ABILITY_SCORE / OPERATION_PASS_RATE / TRAINING_COMPLETION。总分 48（线上 36 + 线下 12），归一化 `raw_score / 48 × 100`；M1-M6 模块画像进入 `result_payload_json`（job-skill-result-v1.0），不为六模块分别生成六条 result_record。
75. **观察项完全不计分**：不进 raw_score / max_score / 计分 completion_ratio / 模块得分率；单独计算 `observation_completion_ratio`，进入 result_payload_json 与 report_content_json；本轮不新增 result_record 表字段。
76. **等级复用 + 独立文案**：复用 LEVEL_COMPETENT / LEVEL_CONDITIONAL / LEVEL_NOT_COMPETENT / LEVEL_FAIL_BY_SAFETY，但专业岗位报告文案独立定义（§7.2.3）；禁止输出就业安置类结论。专业岗位模块兜底规则 [需确认]；MVP 默认：展示模块得分、安全红线优先覆盖、单模块低分不覆盖总等级、低分模块写入 recommended_training_focus。
77. **专业岗位报告进入 MVP**：`report_content_json` 新增 `report_scope = "JOB_SKILL"`（job-skill-report-v1.0），复用现有 task_report 表，不新增报告 section 表。
78. **训练衔接采用固定规则**：`result_payload_json.recommended_training_focus` 与 `report_content_json.recommended_training_tasks` 保存"基于固定规则的训练重点建议"（不得称为 AI 自动推荐）；仅 M2 可链接到现有"拆箱与上架"训练任务，其他模块只显示"建议后续专项训练"，不伪造未实现的训练模块。
79. **答案键审核进入 content_json 合同**：新增 `content_json.review` 块（answer_key_status ∈ NOT_REQUIRED / PENDING / VERIFIED / CORRECTED / REJECTED）；自动评分题仅 VERIFIED / CORRECTED 可 ACTIVE；`M1_TF_015` 人工核验前保持 DRAFT。
80. **不新增 `job_construct` 字段**：题目直接测量构念继续由 `content_json.target_construct` 承载；JOB_SPECIFIC 题的 `ability_tags` 允许空数组或合法六大能力辅助标签，不得作为 M1-M6 主模块分类，不得含 `"0"`/`"1"`；主模块只由 `job_module_code` 承担。
81. **post disclosure 不作门禁**：预埋差错/干扰/隐蔽观察的事后告知流程是否强制 [需确认]（需学校与专业团队定伦理流程）；可选字段 `post_disclosure_status ∈ NOT_REQUIRED / PENDING / COMPLETED`，当前不作为题目 ACTIVE、观察记录保存或报告生成的门禁。v1.0.8 §8.7.4 payload 中 `post_disclosure_done` 必填布尔相应改为本可选字段。
82. **新增 `validateQuestionContract()` 统一跨层 validator**：校验范围见 §5.4.6。
83. **JOB_SPECIFIC ACTIVE 语义修订**：ACTIVE 表示题目已通过内容、答案、rubric、素材、专业审核和运行合同校验，可被符合条件的 JOB_SKILL_ASSESSMENT 策略选择；但 ACTIVE 不等于进入当前固定示范卷——只有列入当前 strategy version 固定题集的题才进入 Demo，非固定题即使 ACTIVE 也不被当前策略自动抽取。

### 0.4 本轮 Codex 交付边界

必须完成：JOB_SKILL_ASSESSMENT 策略与 session 运行时、固定 18+6 示范卷合同、TEACHER_OBSERVATION 运行时、JOB_SKILL_SCORE 与 M1-M6 模块画像、专业岗位报告、训练推荐衔接、schema v0.1.12 全量基线、validateQuestionContract、类型与 validator 升级、importer/dry-run、全部验收与回归。

本轮不做：298 题全部 ACTIVE、专业岗位随机组卷、多套/自定义试卷、单模块小测试、完整题库与试卷后台、549 题训练变式导入、五类高级专业指标、支架前后分差自动解释、门店/文职平行版差异解释、警觉衰减曲线、岗位安置矩阵、竞争性/支持性就业自动判定、question_role、parent_question_id、ORM、CSV 解析库、Markdown 报告渲染库。

---

## 2.5 专业岗位示范测评题量规格（全文新增）

MVP 固定示范卷（数字如调整仅动本节与策略种子，[需确认]最终题量）：

| 岗位模块 | 线上题 | 线下题 |
|---|--:|--:|
| M1 货架整理与价签核对 | 3 | 1 |
| M2 拆箱补货与先进先出 | 3 | 1 |
| M3 临期破损商品分拣 | 3 | 1 |
| M4 库房收纳与简易盘点 | 3 | 1 |
| M5 突发情况应对 | 3 | 1 |
| M6 商品识别与分类 | 3 | 1 |
| 合计 | 18 | 6 |

计分口径：

- 线上 18 题，每题自动判分 0/2，小计 36。
- 线下 6 题，每题教师评分 0/1/2，小计 12。
- 计分题共 24 题，总原始满分 48；`normalized_score = raw_score / 48 × 100`。
- 教师嵌入观察 0-3 项：不计分、不进 48 分、不进计分题 completion_ratio 分母；单独记录 `observation_completion_ratio = 已完成观察项数 / 选入观察项数`（选入 0 项时记 1）。
- 基础能力 42+8、满分 100 的口径不受影响，两套测评互不混用。

---

## 5.3.10.4 JOB_SPECIFIC 结果边界（全文替换 v1.0.8 同节）

```text
BASE_ABILITY
→ BASELINE_ASSESSMENT / MOCK_EXAM 策略
→ 42+8，满分 100
→ ABILITY_SCORE
→ 六大基础能力 module_profiles

JOB_SPECIFIC
→ JOB_SKILL_ASSESSMENT 策略（MVP 固定示范卷 18+6+观察 0-3）
→ 满分 48
→ JOB_SKILL_SCORE
→ M1-M6 岗位模块画像（result_payload_json 内）
→ report_scope = JOB_SKILL 专业岗位报告
→ 基于固定规则的训练重点建议
→ 不复用基础能力模块兜底；不输出就业安置结论
→ 298 题全量运营、随机组卷进入 Post-MVP
```

## 5.3.13 固定示范卷与 question_policy FIXED_SET（全文新增）

本版不新增 `assessment_paper` 表。固定题集保存在 JOB_SKILL_ASSESSMENT 策略的 `strategy_config.question_policy_json`：

```json
{
  "schema_version": "question-policy-v1.2",
  "bank_domain": "JOB_SPECIFIC",
  "selection_mode": "FIXED_SET",
  "job_module_quotas": {
    "M1": { "online": 3, "offline": 1 },
    "M2": { "online": 3, "offline": 1 },
    "M3": { "online": 3, "offline": 1 },
    "M4": { "online": 3, "offline": 1 },
    "M5": { "online": 3, "offline": 1 },
    "M6": { "online": 3, "offline": 1 }
  },
  "fixed_scored_question_ids": [],
  "embedded_observation_question_ids": [],
  "fallback_strategy": "BLOCK"
}
```

规则：

1. `fixed_scored_question_ids`（24 个）与 `embedded_observation_question_ids`（0-3 个）随 strategy version 冻结；同一 version 不得原地修改固定题集，调整必须新增 strategy version。
2. session 创建时校验：固定题全部存在、status = ACTIVE、bank_domain = JOB_SPECIFIC、item_usage 与列表用途一致、模块配额满足、素材齐全、renderer 已注册；任一不满足 → 发起测评失败（返回明确原因码），不得临时从 DRAFT 题中随机补题。
3. 不得为凑题量降低素材、rubric 或答案审核标准（沿用工程约束第 56 条精神）。
4. 基础能力策略的 question-policy-v1.2 继续使用 v1.0.8 §7.6.1 结构（`eligible_bank_domains: ["BASE_ABILITY"]`、`selection_mode` 缺省为随机组卷）；validator 按 `selection_mode` 分支校验。
5. 观察项 ID 必须满足 `item_usage = OBSERVATION_ONLY` 且 `interaction_type = TEACHER_OBSERVATION`；候选为现库 3 条嵌入观察（M1_OB_048、M5_OP_048、M5_OP_055），**必须确认其真实题号与语义后再激活** [需确认]。

## 5.3.14 固定示范卷素材范围（全文新增）

MVP 不要求完成 298 题全部素材，只需完成：

1. 固定 18 道线上题的全部素材（场景图/选项图/视频）。
2. 固定 6 道线下题的标准材料清单与逐题 rubric。
3. 0-3 个教师观察项的施测脚本（标准动作、台词、编码卡）。
4. **至少 1 个特色施测变体**，优先从预埋差错、角色扮演、中断恢复中选择（administration 合同按 v1.0.8 §5.3.11 执行）。

视频规则（承接 v1.0.8 §5.3.4，细化到示范卷）：

- 必须依赖动态线索的题（动作过程判断）制作短视频（VIDEO_SCENE + SCENE_VIDEO）。
- 静态图片不影响构念的题，可经逐题专业审核降级为 IMAGE_CARD（`source.transformation = VIDEO_TO_IMAGE_CARD` + 效度说明）。
- 其余非示范题继续 DRAFT，不要求制作全部 68 道视频。

## 5.3.15 答案键审核合同 content_json.review（全文新增）

```json
{
  "review": {
    "answer_key_status": "PENDING",
    "answer_key_reviewed_by": null,
    "answer_key_reviewed_at": null,
    "answer_key_review_note": null
  }
}
```

- `answer_key_status` 枚举：`NOT_REQUIRED`（无标准答案的观察项等）/ `PENDING` / `VERIFIED` / `CORRECTED` / `REJECTED`。
- 自动评分题（TRUE_FALSE / SINGLE_CHOICE / DRAG / SOFTWARE_TASK）只有 `VERIFIED` 或 `CORRECTED` 才可 ACTIVE。
- `M1_TF_015` 未人工核验前必须保持 DRAFT，不得进入固定示范卷。
- OFFLINE_OPERATION 的 rubric 审核沿用 v1.0.8 三档锚点门禁；观察项 `answer_key_status = NOT_REQUIRED`。

## 5.3.16 target_construct 与 ability_tags 职责分离（全文新增）

- `content_json.target_construct`：题目直接测量构念的唯一承载字段；不新增 `job_construct`。
- `ability_tags` 规则：
  - BASE_ABILITY：至少 1 个合法六大能力值。
  - JOB_SPECIFIC：允许空数组；允许合法六大能力**辅助**标签；不得作为 M1-M6 主模块分类；不得出现 `"0"`、`"1"` 或任何非法值（导入失败）。
- M1-M6 主模块只由 `question_bank.job_module_code` 承担。

---

## 5.4.5 JOB_SKILL_ASSESSMENT 测评运行时（全文新增）

### 5.4.5.1 session 复用

专业岗位测评复用现有 `assessment_session` 及其全部机制：坐次（sitting）、暂停/恢复、崩溃中断恢复、`EMOTION_INTERRUPTED` / `SUSPENDED_REVIEW_REQUIRED` / `OFFLINE_PENDING` 开放态、安全红线（`REDLINE_HALTED` 优先且不可转出）、事件溯源与报告快照。**不得另建 `job_skill_assessment_session` 表。**

session 创建参数：

- `strategy_type = 'JOB_SKILL_ASSESSMENT'`、`job_code = 'SUPERMARKET_SHELVER'`。
- `task_code`：现表为 NOT NULL；专业岗位示范测评取策略种子定义的固定值（建议 `JOB_SKILL_DEMO_M1M6`，与现有训练 task_code 命名规范对齐 [需确认]）。
- `online_question_count = 18`、`offline_question_count = 6`（现有列直接承载）。

### 5.4.5.2 session 题目快照

session 创建时必须将以下字段从 question_bank 快照写入 `assessment_session_question`：

`bank_domain`、`module_type`（BASE_ABILITY 题）、`job_module_code`（JOB_SPECIFIC 题）、`question_type`、`item_usage`、`question_phase`、`question_order`。

`question_phase` 三值：

- `ONLINE`：自动评分题（answer_record，0/2）。
- `OFFLINE`：教师 0/1/2 评分题（offline_score_record，score_scope = JOB_SKILL）。
- `OBSERVATION`：教师非计分嵌入观察（offline_score_record，score_scope = TEACHER_OBSERVATION）。

OBSERVATION phase 不生成普通 answer_record，不进入 `online/offline_question_count` 与完成率分母。

### 5.4.5.3 TEACHER_OBSERVATION 运行时

```text
JOB_SKILL_ASSESSMENT session
→ OBSERVATION phase（教师在指定时机执行嵌入观察）
→ 教师录入观察编码
→ 事件 TEACHER_OBSERVATION_RECORDED（写 action_log.jsonl 后投影）
→ offline_score_record（score_scope = TEACHER_OBSERVATION，score = NULL，observation_payload_json 必填）
→ 专业岗位报告 teacher_observations 区块
```

观察 payload 合同（进入 `offline_score_record.observation_payload_json`，同时作为事件 payload 主体）：

```json
{
  "schema_version": "teacher-observation-v1.0",
  "observation_code": "ACCIDENT_RESPONSE",
  "observed": true,
  "behavior_codes": [
    "STOPPED_CURRENT_ACTION",
    "REPORTED_TO_TEACHER",
    "ATTEMPTED_SAFE_RECOVERY"
  ],
  "prompt_level": "P1",
  "accommodations_used": [],
  "observation_note": "碰倒水瓶后停止操作并主动报告。",
  "post_disclosure_status": "PENDING",
  "recorded_by": "TEACHER_ID",
  "recorded_at": "2026-07-07T00:00:00Z"
}
```

规则：

1. `behavior_codes` 必须属于题目声明的编码维度白名单（`administration.observation_dimensions` 或 rubric 声明）。
2. 观察记录不进入 raw_score / max_score / 计分 completion_ratio / 模块得分率；必须进入报告。
3. 观察记录缺失时，报告显示"观察完成度不足"（observation_completion_ratio < 1），**不伪装为 0 分**。
4. `post_disclosure_status`（NOT_REQUIRED / PENDING / COMPLETED）为可选字段，当前不作为任何门禁 [需确认]（决策 81）。
5. 观察项必须具备：observation_code、behavior_codes 白名单、允许的提示等级、是否观察到、观察说明、标准施测条件、终止条件（落 content_json：administration + termination_policy + rubric_criteria 编码说明）。

### 5.4.5.4 线上/线下作答

- 线上题沿用 v1.0.7 §5.4.3 提交与自动评分链路：renderer 提交结构化 response + metrics → 主进程 validator → 评分器按冻结 scoring_rule_json 产生 0/2 → 事件 → answer_record；response_status / 支持等级 / accommodations / UNSURE 合同全部适用。
- 线下题由教师按逐题三档锚点评 0/1/2，写入 offline_score_record（score_scope = JOB_SKILL）；施测变体观察编码写 `observation_payload_json`，不改变 0/1/2 得分。

### 5.4.6 validateQuestionContract()（全文新增）

统一跨层 validator，导入、审核门禁、session 创建三处复用：

```ts
validateQuestionContract({
  questionRow,        // question_bank 行
  contentJson,
  scoringRuleJson,
  assetRegistry,
  rendererRegistry
})
```

至少校验：

1. bank_domain 与 module_type / job_module_code 域配对。
2. strategy_type 与 bank_domain 绑定（组卷入口调用时）。
3. item_usage 与 interaction_type（OBSERVATION_ONLY ↔ TEACHER_OBSERVATION / SYSTEM_DERIVED_OBSERVATION）。
4. item_usage 与 scoring_type（OBSERVATION_ONLY ↔ NO_SCORE）。
5. question_type 与 content_json.question_type 一致。
6. question_phase 与题型（OFFLINE_OPERATION ↔ OFFLINE；OBSERVATION_ONLY ↔ OBSERVATION；其余 ↔ ONLINE）。
7. presentation_type 与资产 role（VIDEO_SCENE ↔ 必有 required SCENE_VIDEO）。
8. VIDEO_TO_IMAGE_CARD 降级必须有专业审核记录与效度说明。
9. `content_json.review.answer_key_status`（自动评分题须 VERIFIED / CORRECTED）。
10. OFFLINE_RUBRIC 逐题三档行为锚点（拒绝通用模板）。
11. professional_review（安全/角色扮演/嵌入观察题）。
12. renderer registry 已注册且启用。
13. required assets 存在、ACTIVE、hash 一致。
14. ability_tags 合法性（含 JOB_SPECIFIC 空数组规则、拦截 `"0"`/`"1"`）。
15. 固定示范卷校验模式：fixed set 中题目全部 ACTIVE 且满足以上全部。

---

## 5.8.3 专业岗位报告 job-skill-report-v1.0（全文新增）

复用现有 `task_report` 表（report_type 继续用 `FULL_REPORT`，不新增表字段），`report_content_json` 新增 scope 判别：

```json
{
  "report_schema_version": "job-skill-report-v1.0",
  "report_scope": "JOB_SKILL",
  "assessment_meta": {},
  "overall_summary": {},
  "job_module_profiles": [],
  "online_knowledge_summary": {},
  "offline_performance_summary": {},
  "support_summary": {},
  "teacher_observations": [],
  "administration_summary": {},
  "safety_summary": {},
  "validity_limitations": [],
  "recommended_training_focus": [],
  "recommended_training_tasks": [],
  "placement_advice": {
    "enabled": false,
    "reason_disabled": "MVP_DEMO_PROFILE_ONLY"
  }
}
```

基础能力报告继续使用 task-report-v1.1（`report_scope` 缺省视为 `BASE_ABILITY`）。

Demo 报告至少展示：① 总体得分；② M1-M6 六模块条形图或雷达图；③ 线上与线下表现对比；④ 使用的支持等级；⑤ 教师观察；⑥ 安全表现；⑦ 主要优势；⑧ 待训练模块；⑨ 推荐训练任务；⑩ 效度限制。

报告解释约束（在 v1.0.7 §5.8.2 与 v1.0.8 增补之上追加）：

12. 报告不得自动生成岗位安置建议；禁止输出"适合就业 / 不适合就业 / 竞争性就业 / 支持性就业 / 岗位排除 / 自动安置结论"。
13. 训练建议必须表述为"基于固定规则的训练重点建议"，不得称为 AI 自动推荐。
14. 线上得分只解释为知识与情境判断表现，线下得分才是实操表现（知行分离进 validity_limitations）。
15. 观察完成度不足时如实呈现，不得以 0 分或空白伪装。

## 5.8.4 与"拆箱与上架"训练的推荐衔接（全文新增）

落点：`result_payload_json.recommended_training_focus` + `report_content_json.recommended_training_tasks`。

MVP 固定规则（阈值由 scoring_policy_json 定义，建议模块得分率 < 60% 触发 [需确认]）：

```text
M2 得分偏低 → 推荐进入现有"拆箱与上架"训练任务（task_code 与现有训练任务实际值对齐 [需确认]）
M1 得分偏低 → 显示"建议后续开展货架整理专项训练"（无链接）
M3 得分偏低 → 显示"建议后续开展临期/破损识别专项训练"（无链接）
M4/M5/M6 同理 → 仅显示建议文案
```

规则：

1. 本轮只有"拆箱与上架"是完整训练闭环：M2 可直接链接现有训练任务，其他模块只显示建议文案，**不伪造尚未实现的训练模块与虚假链接**。
2. 推荐生成是纯函数：输入模块得分 + 固定规则表，输出建议列表；规则表随 strategy version 冻结。

---

## 7.2.3 专业岗位评分模型（全文新增）

MVP 必须形成：总原始分（/48）、百分制归一化分、M1-M6 模块得分与得分率、线上得分（/36）、线下实操得分（/12）、支持等级分布、教师观察、安全表现、推荐训练重点。

### 等级

复用现有四等级，专业岗位报告文案独立定义：

| 等级 | 专业岗位报告文案 |
|---|---|
| LEVEL_COMPETENT | 当前示范任务表现较稳定 |
| LEVEL_CONDITIONAL | 在明确支持或结构化提示下可完成 |
| LEVEL_NOT_COMPETENT | 当前仍需专项训练和更多支持 |
| LEVEL_FAIL_BY_SAFETY | 因安全红线终止，本次不形成普通能力结论 |

等级阈值沿用 strategy_config 表字段（competent_threshold / conditional_threshold）；JOB_SKILL 策略种子的阈值取值 [需确认]（Demo 默认可沿用 80/60）。

### 模块兜底

**不照搬**基础能力"任一模块得分率低于 module_veto_threshold 即整体不胜任"的规则。专业岗位模块兜底规则 [需确认]；MVP Demo 默认策略：

- 计算并展示每个模块得分与得分率；
- 安全红线继续优先覆盖（LEVEL_FAIL_BY_SAFETY）；
- 不因单个模块低分自动覆盖总等级；
- 低分模块写入 recommended_training_focus。

落点：JOB_SKILL 策略的 `scoring_policy_json` 显式声明 `"module_veto_mode": "DISABLED_RECORD_ONLY"`；评分器对 JOB_SKILL_ASSESSMENT 忽略 `strategy_config.module_veto_threshold` 表字段（该列 NOT NULL，种子仍填 0.5 但不生效，schema 注释说明）。情绪熔断兜底（emotion_collapse_threshold）沿用现有机制。

### scoring_policy_json（JOB_SKILL 策略）

```json
{
  "schema_version": "scoring-policy-v1.2",
  "assessment_scope": "JOB_SKILL",
  "online_score_values": [0, 2],
  "offline_score_values": [0, 1, 2],
  "normalization": "raw_score/max_score*100",
  "module_veto_mode": "DISABLED_RECORD_ONLY",
  "training_focus_threshold": 0.6,
  "safety_override_enabled": true,
  "placement_advice_enabled": false
}
```

### result_record 合同

```text
result_type            = JOB_SKILL_SCORE
source_aggregate_type  = ASSESSMENT_SESSION
strategy_type          = JOB_SKILL_ASSESSMENT
job_code               = SUPERMARKET_SHELVER
module_type            = NULL
raw_score              = 专业测评原始分
max_score              = 48
normalized_score       = raw_score / 48 × 100
```

`result_payload_json`（job-skill-result-v1.0）：

```json
{
  "result_schema_version": "job-skill-result-v1.0",
  "overall": {
    "raw_score": 39,
    "max_score": 48,
    "normalized_score": 81.25,
    "completion_ratio": 1
  },
  "score_tracks": {
    "online_knowledge": { "raw_score": 30, "max_score": 36, "normalized_score": 83.33 },
    "offline_performance": { "raw_score": 9, "max_score": 12, "normalized_score": 75 }
  },
  "job_module_profiles": {
    "M1": { "online_raw": 0, "online_max": 6, "offline_raw": 0, "offline_max": 2, "score_rate": 0, "response_status_summary": {} },
    "M2": {}, "M3": {}, "M4": {}, "M5": {}, "M6": {}
  },
  "observation_completion_ratio": 1,
  "support_summary": {},
  "teacher_observations": [],
  "safety_summary": {},
  "validity_limitations": [],
  "recommended_training_focus": []
}
```

不为 M1-M6 分别生成六条 result_record；模块画像仅在 payload 内。NR/ST/技术中断的题目级不计分状态沿用 v1.0.7 §7.2.2（completion_ratio 按 24 题计分分母计算）。

---

## 7.6.3 JOB_SKILL_ASSESSMENT 策略配置（全文新增）

- `strategy_config.strategy_type` CHECK 增加 `'JOB_SKILL_ASSESSMENT'`（现值：BASELINE_ASSESSMENT / MOCK_EXAM / TRAINING_PRACTICE，以 v0.1.10 实测为准）。
- 策略与题库域绑定：

| strategy_type | 允许的 bank_domain |
|---|---|
| BASELINE_ASSESSMENT（及 MOCK_EXAM） | BASE_ABILITY |
| JOB_SKILL_ASSESSMENT | JOB_SPECIFIC |
| TRAINING_PRACTICE | 不涉及题库组卷（沿用现状） |

禁止 BASELINE_ASSESSMENT 选择 JOB_SPECIFIC 题；禁止 JOB_SKILL_ASSESSMENT 选择 BASE_ABILITY 题。绑定关系由组卷服务 + validateQuestionContract + 单元测试三层保证。

- JOB_SKILL 策略种子：`online_question_count = 18`、`offline_question_count = 6`、`max_score = 48`、question_policy_json 用 §5.3.13 FIXED_SET 结构、scoring_policy_json 用 §7.2.3 结构。
- 策略版本冻结、`UNIQUE(strategy_type, job_code, version)`、session 创建锁定 strategy_id + version 等现有机制不变。

---

## 8.7 领域事件类型（增补）

新增或确认以下事件语义（`domain_event_projection.event_type` 为自由文本，无 CHECK 约束，事件命名可与项目现有命名规范对齐，语义必须存在）：

- `JOB_SKILL_ASSESSMENT_STARTED`（可复用现有 session started 事件 + strategy_type 判别，二选一，实现时按现有事件目录对齐）
- `JOB_SKILL_ASSESSMENT_COMPLETED`（同上）
- `JOB_SKILL_RESULT_GENERATED`
- `TEACHER_OBSERVATION_RECORDED`（v1.0.8 §8.7.4 payload 修订：`post_disclosure_done` 布尔改为可选 `post_disclosure_status`；payload 主体采用 §5.4.5.3 teacher-observation-v1.0）

事件写入顺序、checksum、投影规则沿用现有事件溯源架构，不重构。

---

## 11.13 schema.sql v0.1.12-job-skill-assessment-mvp-closure（全文新增）

基于现行 v0.1.10 一次性合并 v1.0.7 §11.12、v1.0.8 §11.12.7-11.12.9 与本节要求，生成全量初始化 schema。以下仅列 v1.0.9 增量（现状列定义以 `src/main/db/schema.sql` 实测为准）：

### 11.13.1 strategy_config

- `strategy_type` CHECK：`('BASELINE_ASSESSMENT','MOCK_EXAM','TRAINING_PRACTICE')` → 增加 `'JOB_SKILL_ASSESSMENT'`。
- question_policy_json 支持 FIXED_SET 与 M1-M6 配额（应用层 validator，JSON 不建列）。
- 固定题集随 strategy version 冻结（现有版本不可变机制覆盖，无新触发器）。

### 11.13.2 assessment_session

- `strategy_type` CHECK：现为 `('BASELINE_ASSESSMENT','MOCK_EXAM')` → 增加 `'JOB_SKILL_ASSESSMENT'`。
- 坐次、暂停恢复、状态机、红线触发器全部不变。
- `online_question_count` / `offline_question_count` 现有列直接承载 18/6；观察项数量不占用这两列，由 assessment_session_question 中 phase = OBSERVATION 的行数派生。
- strategy 引用一致性触发器（现 schema 第 1339-1404 行区域）自动覆盖新 strategy_type，无需改写逻辑，仅确认测试覆盖。

### 11.13.3 assessment_session_question

现状（v0.1.10 实测）：`question_phase IN ('ONLINE','OFFLINE')`、`module_type NOT NULL`（六能力枚举）、`question_type` 四枚举、无 bank_domain / job_module_code / item_usage。

修改：

```sql
question_phase   TEXT NOT NULL CHECK (question_phase IN ('ONLINE', 'OFFLINE', 'OBSERVATION')),

bank_domain      TEXT NOT NULL CHECK (bank_domain IN ('BASE_ABILITY', 'JOB_SPECIFIC')),

module_type      TEXT CHECK (module_type IS NULL OR module_type IN (
                   'FINE_MOTOR','COGNITION','RULE_EXECUTION',
                   'EMOTION_REGULATION','BASIC_SOCIAL','SAFETY_OPERATION')),

job_module_code  TEXT CHECK (job_module_code IS NULL
                   OR job_module_code IN ('M1','M2','M3','M4','M5','M6')),

item_usage       TEXT NOT NULL CHECK (item_usage IN ('SCORED_ITEM', 'OBSERVATION_ONLY')),

CHECK (
  (bank_domain = 'BASE_ABILITY' AND module_type IS NOT NULL AND job_module_code IS NULL)
  OR
  (bank_domain = 'JOB_SPECIFIC' AND module_type IS NULL AND job_module_code IS NOT NULL)
),
CHECK (
  (item_usage = 'OBSERVATION_ONLY' AND question_phase = 'OBSERVATION')
  OR
  (item_usage = 'SCORED_ITEM' AND question_phase IN ('ONLINE', 'OFFLINE'))
)
```

- `question_type` CHECK 增加 `'SOFTWARE_TASK'`（v1.0.7 既有要求）。
- INSERT 校验（触发器）：question_bank 状态 ACTIVE、bank_domain / module_type / job_module_code / question_type / item_usage 与 question_bank 一致、job_code 与 session 一致、strategy_type 与 bank_domain 绑定；OFFLINE_OPERATION ↔ phase OFFLINE；OBSERVATION_ONLY ↔ phase OBSERVATION（**v1.0.7 "OBSERVATION_ONLY 不得进入该表" 与 v1.0.8 对应约束相应废止**——观察项现在以 OBSERVATION phase 进入 session 快照，但仍不进入计分与完成率）。

### 11.13.4 answer_record

- 沿用 v1.0.7 §11.12.3 全部修改（SOFTWARE_TASK、response_status、score 可空及配对 CHECK）。
- JOB_SKILL 线上题继续使用本表，score 仍限 0/2；question_type / interaction_type 与 session question 一致性由既有触发器 + validator 保证。
- OBSERVATION phase 不得写入本表（触发器校验 session_question.phase = ONLINE 已覆盖）。

### 11.13.5 offline_score_record

现状（v0.1.10 实测）：`score_scope IN ('OFFLINE_ABILITY','TASK_OPERATION')`、`score NOT NULL IN (0,1,2)`、无 response_status / observation_payload_json。

修改：

```sql
score_scope IN ('OFFLINE_ABILITY', 'JOB_SKILL', 'TASK_OPERATION', 'TEACHER_OBSERVATION')

response_status          TEXT NOT NULL DEFAULT 'ANSWERED',   -- v1.0.7 §5.4.1 枚举
observation_payload_json TEXT,
score                    INTEGER CHECK (score IS NULL OR score IN (0, 1, 2))
```

scope 规则（CHECK + 触发器）：

| score_scope | 约束 |
|---|---|
| OFFLINE_ABILITY | 现有规则不变（基础能力线下 8 题）+ v1.0.7 response_status/可空 score 规则 |
| JOB_SKILL | question_id 必填且属于该 session、phase = OFFLINE、item_usage = SCORED_ITEM、question_type = OFFLINE_OPERATION；ANSWERED → score ∈ {0,1,2}；非 ANSWERED → score = NULL；scoring_rubric_json 必填；observation_payload_json 可选 |
| TASK_OPERATION | 现有规则不变（task_operation_code 分流） |
| TEACHER_OBSERVATION | question_id 必填且属于该 session、phase = OBSERVATION、item_usage = OBSERVATION_ONLY、interaction_type = TEACHER_OBSERVATION、scoring_type = NO_SCORE；score 必须 NULL；observation_payload_json 必填 |

唯一性索引：`ux_offline_score_one_valid_score` 扩展覆盖 JOB_SKILL 与 TEACHER_OBSERVATION scope（每 session 每题一条 VALID 记录）。

### 11.13.6 result_record

- `result_type` CHECK 增加 `'JOB_SKILL_SCORE'`。
- `strategy_type` CHECK 增加 `'JOB_SKILL_ASSESSMENT'`。
- JOB_SKILL_SCORE 行：module_type = NULL、max_score = 48、result_payload_json 使用 job-skill-result-v1.0。
- 不新增表字段（observation_completion_ratio 在 payload 内）。

### 11.13.7 task_report / domain_event_projection

- task_report 不新增表字段；report_content_json 支持 `report_scope = 'JOB_SKILL'`（job-skill-report-v1.0），validator 按 scope 分支校验。
- domain_event_projection 无 schema 变更（event_type 自由文本）；事件目录补 §8.7 四个语义。

### 11.13.8 question_bank 及其余

- 承接 v1.0.7 §11.12.1 与 v1.0.8 §11.12.7 全部修改（DRAFT 默认、SOFTWARE_TASK、item_usage、bank_domain、job_module_code、域配对 CHECK、ACTIVE 即冻结触发器、素材约束）。
- 重导规则承接 v1.0.8 §5.3.10.5 与 §11.12.9（298 条全 DRAFT、数据清洗、dry-run 报告、job_code 迁移）。

---

## 16.6 行为日志（增补）

在 v1.0.7 §16.6 与 v1.0.8 增补之上：

- 观察记录字段集 = teacher-observation-v1.0 payload（§5.4.5.3）。
- `observation_completion_ratio` 计算：分母 = strategy 固定观察项数，分子 = 已写入 VALID TEACHER_OBSERVATION 记录数；进入 result_payload_json 与 report_content_json，不进入 result_record 表字段。
- §16.6.7 "不得直接等同成绩的指标"追加：`behavior_codes`、`observed`、`observation_completion_ratio`。

---

## 17.11 v1.0.9 专业岗位示范测评专项验收（新增）

### 策略与题库域

1. JOB_SKILL_ASSESSMENT 只能选择 JOB_SPECIFIC 题。
2. BASELINE_ASSESSMENT 只能选择 BASE_ABILITY 题。
3. 两个题库域互相命中数为 0。
4. strategy version 固定题集不可原地修改。

### 固定示范卷

5. 固定示范卷覆盖 M1-M6。
6. 每模块 3 道线上、1 道线下。
7. 总计 18 道线上、6 道线下。
8. 观察项不超过 3 项且不计分。
9. 任一固定题非 ACTIVE 时不能发起测评。
10. 任一固定题素材、答案或 rubric 未通过时不能发起测评。

### session

11. JOB_SKILL_ASSESSMENT 可创建 assessment_session。
12. 支持多坐次暂停和恢复。
13. session question 正确保存 bank_domain、job_module_code、item_usage 和 phase。
14. OBSERVATION phase 不生成普通 answer_record。
15. 安全红线能中断专业岗位测评（REDLINE_HALTED）。

### 评分

16. 线上题只能 0/2。
17. 线下题只能 0/1/2。
18. 观察项 score 必须为 NULL。
19. 原始计分满分为 48。
20. normalized_score 正确计算（raw/48×100）。
21. 观察项不进入计分 completion_ratio。
22. observation_completion_ratio 单独计算。

### 结果

23. 生成 JOB_SKILL_SCORE。
24. 不错误生成 ABILITY_SCORE。
25. result_payload 含 M1-M6 模块画像。
26. result_payload 分开保存线上和线下得分。
27. 安全红线优先覆盖普通等级。
28. 单模块低分不自动触发基础能力模块兜底。

### 报告

29. 生成 report_scope = JOB_SKILL 的报告。
30. 报告展示 M1-M6。
31. 报告展示线上与线下对比。
32. 报告展示支持等级和教师观察。
33. 报告展示训练重点建议。
34. 报告不输出就业安置结论。
35. M2 低分时可推荐现有拆箱与上架训练。
36. 未实现训练模块不得生成虚假链接。

### 素材和审核

37. 固定示范卷全部素材可加载（app://asset/ 链路）。
38. VIDEO_SCENE 缺视频不能 ACTIVE。
39. VIDEO_TO_IMAGE_CARD 必须有审核和效度说明。
40. 自动评分题答案键必须 VERIFIED 或 CORRECTED。
41. M1_TF_015 未确认前不得进入固定示范卷。
42. 6 道线下题必须有逐题 0/1/2 锚点。
43. ability_tags 不得存在 `"0"`、`"1"`。

### 观察

44. TEACHER_OBSERVATION 能正常录入。
45. 观察记录写入事件日志（action_log.jsonl）和 SQLite 投影。
46. 观察记录可在报告中复现。
47. 观察记录不改变 raw_score。
48. 观察记录缺失时报告显示观察完成度不足，不伪装为 0 分。

### 回归

49. 原基础能力 42+8 流程继续通过。
50. 原训练、实操评分、安全事件和报告快照流程继续通过。
51. 不破坏现有 strategy_config 版本冻结和引用一致性。

（v1.0.7 §17.9 与 v1.0.8 §17.10 验收全部继续有效。）

---

## 18. 版本规划（全文替换 v1.0.8 §18）

### 18.1 MVP v1.0.9 必须完成

- JOB_SKILL_ASSESSMENT 策略类型与题库域绑定。
- 固定专业岗位示范卷（M1-M6 六模块、18 线上 + 6 线下 + 0-3 观察）。
- 线上自动评分（0/2）、线下 0/1/2 评分。
- TEACHER_OBSERVATION 运行时（录入 → 事件 → 投影 → 报告）。
- JOB_SKILL_SCORE 与 M1-M6 岗位模块画像。
- 专业岗位测评报告（report_scope = JOB_SKILL）。
- 与拆箱上架训练的固定规则推荐衔接。
- 安全红线、支持等级、坐次暂停恢复（复用现有机制）。
- 答案、rubric、素材和专业审核门禁 + validateQuestionContract。
- 至少 1 个特色施测变体（预埋差错 / 角色扮演 / 中断恢复优先）。
- v1.0.7 + v1.0.8 已定的题库数据合同与域治理（继续有效）。

### 18.2 Post-MVP

- 298 题全部 ACTIVE 与全量运营。
- 专业岗位随机组卷、多套卷、自定义卷、单模块小测试。
- 549 题训练变式导入。
- question_role、parent_question_id 与四层题库分层。
- 支架指数、支架前后分差解释、门店/文职分差解释、警觉衰减曲线、五类高级指标。
- 岗位安置矩阵、对外与内部双报告。
- 完整题库后台、完整试卷后台。
- 视频素材批量制作流水线与视频高级行为分析。

---

## 19. 关键工程约束清单（增补第 71～80 条）

71. 不得为专业岗位测评另建第二套 session 表；必须复用 assessment_session 及其状态机。
72. 不得让 JOB_SKILL_ASSESSMENT 选择 BASE_ABILITY 题，或 BASELINE_ASSESSMENT 选择 JOB_SPECIFIC 题。
73. 不得在同一 strategy version 内原地修改固定题集；不得临场从 DRAFT 补题。
74. 不得把专业岗位结果写成 ABILITY_SCORE、OPERATION_PASS_RATE 或 TRAINING_COMPLETION。
75. 不得让观察项进入 raw_score、max_score、计分 completion_ratio 或模块得分率。
76. 不得输出就业安置类结论（适合/不适合就业、竞争性/支持性就业、岗位排除、自动安置）。
77. 不得把训练建议称为 AI 自动推荐；只能是基于固定规则的训练重点建议。
78. 不得为未实现的训练模块生成虚假链接。
79. 不得把基础能力模块兜底规则照搬到专业岗位测评。
80. 不得把 post_disclosure_status 用作 ACTIVE、观察保存或报告生成门禁（伦理流程定稿前）。

（v1.0.7 第 37-56 条、v1.0.8 第 57-70 条继续有效。）

---

## 20. Codex 最小执行顺序（全文替换）

1. **更新 PRD、共享枚举和 JSON 合同**：JOB_SKILL_ASSESSMENT、JOB_SKILL_SCORE、QuestionPhase(OBSERVATION)、question-policy-v1.2(FIXED_SET)、scoring-policy-v1.2、job-skill-result-v1.0、job-skill-report-v1.0、teacher-observation-v1.0、content_json.review（升级差异见附录 E）。
2. **生成 schema v0.1.12 全量初始化基线**：合并 v1.0.7/v1.0.8/v1.0.9 全部 schema 要求（§11.13），运行 SQLite 初始化与 foreign_key_check。
3. **实现 `validateQuestionContract()` 和专业岗位 importer/dry-run**：298 条清洗重导（全 DRAFT）+ 对账报告。
4. **从 298 题中审核并确定固定 18+6 示范题及 0-3 观察项**：答案键、素材、rubric、专业审核逐题闭环（人工 + 门禁）。
5. **实现 JOB_SKILL_ASSESSMENT session、固定组卷、线上与线下评分**。
6. **实现 TEACHER_OBSERVATION、JOB_SKILL_SCORE 和专业岗位报告**。
7. **接通"专业测评结果 → 拆箱与上架训练建议"，并执行基础能力与专业岗位全量回归**（§17.9 + §17.10 + §17.11）。

---

## 附录 A：TypeScript 类型增量（在 v1.0.7 / v1.0.8 附录 A 之上追加）

```ts
export type StrategyType =
  | 'BASELINE_ASSESSMENT'
  | 'MOCK_EXAM'
  | 'TRAINING_PRACTICE'
  | 'JOB_SKILL_ASSESSMENT'

export type ResultType =
  | 'ABILITY_SCORE'
  | 'TRAINING_COMPLETION'
  | 'OPERATION_PASS_RATE'
  | 'JOB_SKILL_SCORE'

export type QuestionPhase = 'ONLINE' | 'OFFLINE' | 'OBSERVATION'

export type AnswerKeyStatus =
  | 'NOT_REQUIRED'
  | 'PENDING'
  | 'VERIFIED'
  | 'CORRECTED'
  | 'REJECTED'

export type PostDisclosureStatus = 'NOT_REQUIRED' | 'PENDING' | 'COMPLETED'

export interface JobModuleQuota { online: number; offline: number }

export interface QuestionPolicyJobSkillFixedSet {
  schema_version: 'question-policy-v1.2'
  bank_domain: 'JOB_SPECIFIC'
  selection_mode: 'FIXED_SET'
  job_module_quotas: Record<JobModuleCode, JobModuleQuota>
  fixed_scored_question_ids: string[]
  embedded_observation_question_ids: string[]
  fallback_strategy: 'BLOCK'
}

export interface TeacherObservationPayload {
  schema_version: 'teacher-observation-v1.0'
  observation_code: string
  observed: boolean
  behavior_codes: string[]
  prompt_level: PromptLevel | null
  accommodations_used: string[]
  observation_note: string | null
  post_disclosure_status?: PostDisclosureStatus
  recorded_by: string
  recorded_at: string
}
```

另需：`JobSkillResultPayload`（job-skill-result-v1.0）、`JobSkillReportContent`（job-skill-report-v1.0）、`ContentJsonReview`（answer key review 块）、`validateQuestionContract()` 签名（§5.4.6）。

---

## 附录 B：本轮明确不做

1. 298 题全部 ACTIVE。
2. 专业岗位随机组卷 / 多套卷 / 自定义卷 / 单模块小测试。
3. assessment_paper 表。
4. 549 题训练变式正式导入。
5. question_role / parent_question_id / allowed_roles / exclude_exposed / GRADUATION 曝光排除。
6. 五类高级专业指标、支架分差、门店/文职分差、警觉衰减曲线。
7. 岗位安置矩阵、竞争性/支持性就业自动判定。
8. 对外与内部双报告模板。
9. 完整题库管理后台、试卷管理后台。
10. ORM、CSV 解析库、Markdown 报告渲染库。

---

## 附录 C：v1.0.9 相对 v1.0.8 的修订记录

1. **专业岗位能力示范测评进入 MVP**：废止 v1.0.8 "JOB_SPECIFIC 只做静态题库治理、运行时全部 Post-MVP"的范围判断（§0.2 列出全部被替换表述）。
2. **新增 JOB_SKILL_ASSESSMENT** 策略类型（strategy_config / assessment_session / result_record / 类型 / 事件 / 触发器 / 服务全链路）。
3. **新增 JOB_SKILL_SCORE** 结果类型与 job-skill-result-v1.0 payload 合同。
4. **固定 18+6 示范卷**：question-policy-v1.2 FIXED_SET，题集随 strategy version 冻结，不做随机组卷、不建 assessment_paper。
5. **TEACHER_OBSERVATION 运行时进入 MVP**：OBSERVATION phase → 教师录入 → TEACHER_OBSERVATION_RECORDED → offline_score_record（score=NULL）→ 报告；v1.0.8 §8.7.4 payload 的 post_disclosure_done 改为可选 post_disclosure_status（不作门禁，[需确认] 伦理流程）。
6. **assessment_session_question 支持 M1-M6 和 OBSERVATION**：新增 bank_domain / job_module_code / item_usage，module_type 可空，question_phase 增加 OBSERVATION；v1.0.7 "OBSERVATION_ONLY 不得进入该表"约束废止（改为以 OBSERVATION phase 进入但不计分）。
7. **offline_score_record 支持 JOB_SKILL 和 TEACHER_OBSERVATION** 两个新 score_scope，新增 response_status 与 observation_payload_json，score 可空。
8. **新增 M1-M6 模块画像**（result_payload_json.job_module_profiles，不生成六条 result_record）。
9. **新增专业岗位报告**（report_scope = JOB_SKILL，job-skill-report-v1.0，复用 task_report 表）。
10. **新增与拆箱上架训练的推荐衔接**（固定规则，仅 M2 链接现有任务，其余仅建议文案）。
11. **新增 content_json.review 答案键审核合同**与 validateQuestionContract() 统一 validator。
12. **JOB_SPECIFIC ACTIVE 语义修订**（决策 83）：ACTIVE = 全门禁通过可被策略选择，但不等于进入当前固定示范卷。
13. **目标 schema 基线由 v0.1.11 升级为 v0.1.12**：一次性合并 v1.0.7/v1.0.8/v1.0.9，基于 v0.1.10 全量生成，无逐版本 migration。
14. **298 题全量运营仍保留在 Post-MVP**；v1.0.8 的 bank_domain 隔离、job_module_code、VIDEO_SCENE、administration、评分命名迁移、L→P、UNSURE、ACTIVE 即冻结、job_code 统一等治理合同全部保留。

---

## 附录 D：[需确认] 集中清单

1. **最终题量数字**：18+6+0-3 为当前推荐口径；数据合同、schema 与验收均按此设计，数字若调整只动 §2.5 与策略种子。
2. **固定示范卷具体题目 ID 清单**：待执行顺序第 4 步（答案键/素材/rubric/专业审核闭环）后写入策略种子。
3. **3 条嵌入观察项（M1_OB_048、M5_OP_048、M5_OP_055）的真实题号与语义确认**后方可激活为 Demo 观察项。
4. **专业岗位模块兜底规则**：MVP 默认"不因单模块低分覆盖总等级"，正式规则需专业团队定稿。
5. **JOB_SKILL 策略等级阈值**：Demo 默认沿用 competent 80 / conditional 60，需专业确认。
6. **训练重点触发阈值**：默认模块得分率 < 60%（scoring_policy_json.training_focus_threshold），需确认。
7. **"拆箱与上架"训练任务的实际 task_code 值**：推荐规则中的链接目标须与现有训练任务实际编码对齐（不得凭 PRD 记忆猜测）。
8. **JOB_SKILL session 的 task_code 取值**：建议 `JOB_SKILL_DEMO_M1M6`，需与现有 task_code 命名规范对齐。
9. **post disclosure 伦理流程**：预埋差错/干扰/隐蔽观察是否强制事后告知，由学校与专业团队确定后再固化；当前不作任何门禁。
10. **M1_TF_015 答案键**：人工核验前保持 DRAFT，不得进入固定示范卷。
11. **特色施测变体选型**：预埋差错 / 角色扮演 / 中断恢复三选一（或多选），随固定卷定稿。
12. 承接 v1.0.8 未闭合项：支架版配对拆分口径、门店-文职逐题配对表、295 条旧 ACTIVE 是否被历史 session 引用（决定物理清库 vs ARCHIVED 重建）、Q_BASE 存量重导范围、手册附录 A-G 交付情况、549 疑错题剔除确认、JOB_SPECIFIC 新 ID 命名规则。

---

## 附录 E：从 src/shared/types/json-schemas.ts 升级到目标类型的差异清单

现状（`src/shared/types/json-schemas.ts` 实测）→ 目标：

| # | 现状 | 目标变更 |
|---|---|---|
| 1 | `ContentJson` 仅四分支（TrueFalse/SingleChoice/Drag/OfflineOperation），含 `expected_answer` | 增加 `ContentJsonSoftwareTask` 与观察项分支；**删除 content_json 内 expected_answer**（正确答案唯一事实源迁入 scoring_rule_json，v1.0.7 决策 49）；增加 presentation / interaction / expected_evidence / support_policy / termination_policy / log_metrics / administration / variant_role / review / source 扩展结构（question-content-v1.2） |
| 2 | `ContentJsonBase.ability_tags: AbilityTag[]` 必填 | 按 §5.3.16：BASE_ABILITY 至少 1 个；JOB_SPECIFIC 允许 `[]`；运行时校验拦截 `"0"`/`"1"` |
| 3 | `ScoringRuleDrag.scoring_type: 'DRAG_PARTIAL'` | 删除；新增 `ORDER_MATCH` / `MAPPING_MATCH` / `SET_MATCH` / `METRIC_THRESHOLD` / `EVENT_RULE` / `NO_SCORE`（v1.0.7 附录 A） |
| 4 | `ScoringRuleOffline.scoring_type: 'OFFLINE_RUBRIC'`，criteria 含 description_0/1/2 | 保留结构；新增"禁止通用模板锚点"运行时校验；`RUBRIC_BASED` 旧值仅允许出现在迁移输入，不得进入新库 |
| 5 | `QuestionPolicyJson.question_ratio`（14/14/14/8 型） | 废止；替换为 question-policy-v1.1/1.2 联合类型：基础能力（online_quota_by_module + eligible_bank_domains）与 JOB_SKILL FIXED_SET（附录 A） |
| 6 | `ScoringPolicyJson.level_rules: LevelRule[]` | 废止（v1.0.7 §7.6.2：阈值以 strategy_config 表字段为唯一事实源）；替换为 scoring-policy-v1.1（基础能力）与 v1.2（JOB_SKILL，含 module_veto_mode / training_focus_threshold） |
| 7 | 无 | 新增枚举与接口：QuestionType(+SOFTWARE_TASK)、ItemUsage、InteractionType(+TEACHER_OBSERVATION)、PresentationType(+VIDEO_SCENE)、ResponseStatus、PromptLevel、EvidenceType、BankDomain、JobModuleCode、QuestionPhase、StrategyType、ResultType、AnswerKeyStatus、PostDisclosureStatus、AdministrationConfig、VariantRole、TeacherObservationPayload、JobSkillResultPayload、JobSkillReportContent、AnswerPayloadJson、ResultPayloadJson、ReportContentJson 判别联合（task-report-v1.1 / job-skill-report-v1.0） |
| 8 | `ContentSource` 五字段 | 扩展：source_sheet / source_row / origin_refs / transformation / candidate_status / legacy_job_code / legacy_question_id / source_ref_549 |
| 9 | 无运行时校验函数导出 | 新增 `validateQuestionContract()`（§5.4.6）及各 JSON 合同 validator；共享类型文件继续只做类型声明，运行时校验在主进程实现（沿用现有分层） |

---

## 附录 F：需要同步修改的工程工件清单

1. `src/main/db/schema.sql`（v0.1.12 全量基线）
2. `src/shared/types/json-schemas.ts`（附录 E 差异）
3. `src/shared/types/event-payloads.ts` / `ipc-api.ts`（新事件与 IPC 入参）
4. content JSON validator / scoring rule validator / `validateQuestionContract()`
5. question importer / dry-run（298 条清洗重导）
6. paper generator / question selector（FIXED_SET 分支 + bank_domain 绑定）
7. session 创建 / 恢复 / 坐次服务（JOB_SKILL_ASSESSMENT 分支与题目快照）
8. 评分服务（JOB_SKILL 线上/线下）与结果生成（JOB_SKILL_SCORE）
9. TEACHER_OBSERVATION 录入 IPC + 事件 + 投影 reducer
10. 报告生成服务（job-skill-report-v1.0）+ 报告 schema validator
11. ACTIVE 审核门禁与题目冻结 trigger
12. 题库隔离与固定卷单元测试、全量回归套件
