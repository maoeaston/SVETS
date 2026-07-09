# 验收测试方案

版本：acceptance-test-plan v1.0
日期：2026-07-07
覆盖：PRD v1.0.7 §17.9（42条）+ v1.0.8 §17.10（27条）+ v1.0.9 §17.11（51条）
原则：按功能域分组；每条三段式（输入/步骤/预期结果）；不按 PRD 编号排列

---

## 功能域索引

| 域 | 测试用例数 | 对应 PRD 条目 |
|---|---|---|
| A. Schema 与题库基础合同 | TC-A01~A12 | v1.0.7: 1-8 |
| B. 域隔离（BASE_ABILITY vs JOB_SPECIFIC） | TC-B01~B08 | v1.0.8: 1-6, 27 |
| C. interaction 与 validator | TC-C01~C10 | v1.0.7: 9-16 |
| D. 支持等级与 response_status | TC-D01~D08 | v1.0.7: 17-22 |
| E. 行为日志与评分 | TC-E01~E05 | v1.0.7: 23-27 |
| F. 素材资产 | TC-F01~F06 | v1.0.7: 28-31, v1.0.8: 11-12 |
| G. 报告与结果 | TC-G01~G08 | v1.0.7: 32-38 |
| H. 组卷门禁 | TC-H01~H06 | v1.0.7: 39-42, v1.0.9: 9-10 |
| I. 观察通道（TEACHER_OBSERVATION） | TC-I01~I07 | v1.0.8: 7-10, v1.0.9: 44-48 |
| J. 呈现与视频降级 | TC-J01~J04 | v1.0.8: 11-12 |
| K. 评分规则命名与三档锚点 | TC-K01~K05 | v1.0.8: 13-16 |
| L. 数据质量与重导 | TC-L01~L08 | v1.0.8: 17-26 |
| M. 冻结与施测变体 | TC-M01~M04 | v1.0.8: 24-26 |
| N. 固定示范卷与 JOB_SKILL session | TC-N01~N18 | v1.0.9: 1-15 |
| O. JOB_SKILL 评分与结果 | TC-O01~O09 | v1.0.9: 16-28 |
| P. 专业岗位报告 | TC-P01~P09 | v1.0.9: 29-36 |
| Q. 素材与审核门禁（JOB_SKILL） | TC-Q01~Q07 | v1.0.9: 37-43 |
| R. 回归保证 | TC-R01~R03 | v1.0.9: 49-51 |

---

## A. Schema 与题库基础合同

### TC-A01 新导入默认 DRAFT
- 输入：一条合法 question_bank INSERT（不含 status 字段）
- 步骤：执行 INSERT；查询该 question_id 的 status
- 预期：status = 'DRAFT'（DEFAULT 约束生效）

### TC-A02 SOFTWARE_TASK 可写入
- 输入：question_type = 'SOFTWARE_TASK' 的 INSERT
- 步骤：执行 INSERT
- 预期：成功写入；question_type 可查询到 SOFTWARE_TASK

### TC-A03 非法 question_type 拒绝
- 输入：question_type = 'ESSAY' 的 INSERT
- 步骤：执行 INSERT
- 预期：CHECK 约束触发，INSERT 失败

### TC-A04 item_usage 合法值
- 输入：item_usage = 'SCORED_ITEM' / 'OBSERVATION_ONLY' 各一条
- 步骤：分别 INSERT
- 预期：两条均成功写入

### TC-A05 item_usage 非法值拒绝
- 输入：item_usage = 'TRAINING_ONLY'
- 步骤：执行 INSERT
- 预期：CHECK 约束触发，INSERT 失败

### TC-A06 OBSERVATION_ONLY 不得进入 assessment_session_question（v1.0.7 规则）
- 注：v1.0.9 附录 C 修订此规则，OBSERVATION_ONLY 以 OBSERVATION phase 进入快照
- 输入：item_usage=OBSERVATION_ONLY 的题，尝试以 question_phase='ONLINE' 插入 assessment_session_question
- 步骤：尝试 INSERT（phase=ONLINE, item_usage=OBSERVATION_ONLY）
- 预期：触发器或 CHECK 拒绝（item_usage=OBSERVATION_ONLY 只允许 phase=OBSERVATION）

### TC-A07 已选入 session 的题不能修改语义字段
- 输入：已被 assessment_session_question 引用的 question_bank 行
- 步骤：UPDATE question_bank SET prompt = '新 prompt' WHERE question_id = 被引用题
- 预期：ACTIVE 冻结触发器拒绝（或 v1.0.8 语义冻结触发器拒绝）

### TC-A08 bank_domain 域配对约束
- 输入：bank_domain='JOB_SPECIFIC' 且 module_type IS NOT NULL 的 INSERT
- 步骤：执行 INSERT
- 预期：CHECK 约束（bank_domain=JOB_SPECIFIC ↔ module_type=NULL）触发，失败

### TC-A09 BASE_ABILITY 须有 module_type
- 输入：bank_domain='BASE_ABILITY' 且 module_type=NULL 的 INSERT
- 步骤：执行 INSERT
- 预期：CHECK 约束触发，失败

### TC-A10 JOB_SPECIFIC 须有 job_module_code
- 输入：bank_domain='JOB_SPECIFIC' 且 job_module_code=NULL 的 INSERT
- 步骤：执行 INSERT
- 预期：CHECK 约束触发，失败

### TC-A11 已引用素材不能替换为不同 hash
- 输入：已被题目引用（asset_id 在 content_json.presentation.assets）的 asset_resource 行
- 步骤：UPDATE asset_resource SET file_hash = 'newhash' WHERE asset_id = 已引用资产
- 预期：触发器拒绝；file_hash 不变

### TC-A12 strategy_type JOB_SKILL_ASSESSMENT 合法
- 输入：strategy_type = 'JOB_SKILL_ASSESSMENT' 的 strategy_config INSERT
- 步骤：执行 INSERT
- 预期：成功写入


---

## B. 域隔离

### TC-B01 BASE_ABILITY 组卷不命中 JOB_SPECIFIC 题
- 输入：strategy_type=BASELINE_ASSESSMENT，JOB_SPECIFIC 题已 ACTIVE
- 步骤：触发组卷逻辑；查询 assessment_session_question 中 bank_domain
- 预期：所有选入题 bank_domain = 'BASE_ABILITY'；JOB_SPECIFIC 命中数 = 0

### TC-B02 JOB_SPECIFIC 题不能生成 ABILITY_SCORE
- 输入：JOB_SKILL_ASSESSMENT session 完成全部题目
- 步骤：触发结果生成；查询 result_record
- 预期：result_type = 'JOB_SKILL_SCORE'；不存在 result_type='ABILITY_SCORE'

### TC-B03 JOB_SPECIFIC 题必须有 job_module_code
- 输入：bank_domain='JOB_SPECIFIC' 且 job_module_code=NULL 的 INSERT
- 步骤：执行 INSERT
- 预期：失败（见 TC-A10）

### TC-B04 JOB_SPECIFIC 题 module_type 必须为 NULL
- 输入：bank_domain='JOB_SPECIFIC' 且 module_type='COGNITION' 的 INSERT
- 步骤：执行 INSERT
- 预期：CHECK 约束触发，失败

### TC-B05 BASE_ABILITY 题必须有 module_type
- 输入：bank_domain='BASE_ABILITY' 且 module_type=NULL 的 INSERT
- 步骤：执行 INSERT
- 预期：失败（见 TC-A09）

### TC-B06 BASE_ABILITY 题 job_module_code 必须为 NULL
- 输入：bank_domain='BASE_ABILITY' 且 job_module_code='M1' 的 INSERT
- 步骤：执行 INSERT
- 预期：CHECK 约束触发，失败

### TC-B07 strategy_type 与 bank_domain 绑定
- 输入：JOB_SKILL_ASSESSMENT 策略尝试选 BASE_ABILITY 题；BASELINE_ASSESSMENT 尝试选 JOB_SPECIFIC 题
- 步骤：触发组卷或 session 创建校验
- 预期：两种情况均被 validator 或触发器拒绝

### TC-B08 回归：基础能力全流程在域隔离后仍通过
- 输入：现有基础能力 Q_BASE 题库（42+8 卷）
- 步骤：创建 BASELINE_ASSESSMENT session，完成答题，生成结果
- 预期：ABILITY_SCORE 生成正常；结果含六大模块画像；无 JOB_SPECIFIC 题混入

---

## C. Interaction 与 Validator

### TC-C01 ACTIVE 题必须有合法 presentation_type 和 interaction_type
- 输入：缺少 interaction_type 的 content_json，尝试转 ACTIVE
- 步骤：UPDATE status='ACTIVE'
- 预期：触发器或 validator 拒绝；status 保持 DRAFT

### TC-C02 question_type 与 content_json 一致性
- 输入：question_type='SINGLE_CHOICE' 但 content_json.question_type='TRUE_FALSE'
- 步骤：尝试转 ACTIVE
- 预期：validateQuestionContract 失败，不得转 ACTIVE

### TC-C03 interaction_type 与 answer shape 匹配
- 输入：SINGLE_SELECT 题，提交 { ordered_item_ids: [...] }（ORDERING 的 answer shape）
- 步骤：调用提交 API
- 预期：validator 拒绝，返回错误码

### TC-C04 未注册 renderer 不得转 ACTIVE
- 输入：interaction_type 为未在 renderer registry 注册的值
- 步骤：尝试转 ACTIVE
- 预期：validateQuestionContract 规则 12 拒绝

### TC-C05 ORDERING 判分按顺序规则
- 输入：4 个 drag_items，correct_order = [i1,i2,i3,i4]；提交 [i1,i3,i2,i4]
- 步骤：评分器计算
- 预期：ORDER_MATCH + partial_credit=false → score=0；全对 → score=2

### TC-C06 MAPPING_MATCH 判分按配对规则
- 输入：分类题 correct_mapping={i1:z1, i2:z2, i3:z1}；提交全对
- 步骤：评分器计算
- 预期：score=2

### TC-C07 线上评分路径只产生 0 或 2
- 输入：任意线上题（SC/TF/DG）各一条
- 步骤：提交各种答案（正确/错误/部分）
- 预期：score ∈ {0, 2}；不产生 1

### TC-C08 UNSURE 选项保存为 ANSWERED + score=0 + unsure_selected=true
- 输入：SC 题，用户选择"不清楚"选项
- 步骤：提交答案
- 预期：answer_record.response_status='ANSWERED'；score=0；answer_payload.unsure_selected=true；不保存为 NOT_APPLICABLE

### TC-C09 TRUE_FALSE 答案布尔类型
- 输入：TF 题，提交 true
- 步骤：评分
- 预期：与 correct_answer 布尔比较；M1_TF_016 correct_answer=false，提交 true → score=0

### TC-C10 validateQuestionContract 15 条规则完整覆盖
- 输入：15 种违规 fixture（每条规则各一个反例）
- 步骤：对每个 fixture 调用 validateQuestionContract()
- 预期：每个 fixture 均返回对应的错误码，无遗漏


---

## D. 支持等级与 response_status

### TC-D01 prompt_level 与 accommodations 分开记录
- 输入：P2 等级 + 使用 AAC 辅具的答题
- 步骤：提交答案
- 预期：answer_record.answer_payload.prompt_level='P2'；accommodations=['AAC']；score 正常计算（不自动扣分）

### TC-D02 技术故障不记 0 分
- 输入：TECHNICAL_INTERRUPTION response_status
- 步骤：写入 answer_record
- 预期：score=NULL；completion_ratio 分母不计此题；报告展示技术中断

### TC-D03 P3 直接协助必须 ASSISTED_NOT_SCORED
- 输入：P3 协助完成的答题
- 步骤：写入 answer_record
- 预期：response_status='ASSISTED_NOT_SCORED'；score=NULL

### TC-D04 非 ANSWERED 时 score 为 NULL
- 输入：NOT_APPLICABLE / STOPPED_SAFETY / TECHNICAL_INTERRUPTION
- 步骤：写入 answer_record
- 预期：各状态下 score=NULL；CHECK 约束阻止 score 非 NULL

### TC-D05 completion_ratio 在非 ANSWERED 时正确计算
- 输入：18 题中 2 题 TECHNICAL_INTERRUPTION，16 题 ANSWERED
- 步骤：生成 result_record
- 预期：completion_ratio = 16/18（非 ANSWERED 不进分母）

### TC-D06 AAC/触控笔/辅具不自动扣分
- 输入：accommodations=['TOUCH_STYLUS']，答案正确
- 步骤：评分
- 预期：score=2，不因辅具减分

### TC-D07 response_status 合法枚举校验
- 输入：response_status='UNKNOWN_STATUS'
- 步骤：写入 answer_record
- 预期：CHECK 约束拒绝

### TC-D08 STOPPED_SAFETY 线下题 score=NULL
- 输入：M5_OP_040 搬运姿势严重不当，记录 STOPPED_SAFETY
- 步骤：写入 offline_score_record
- 预期：score=NULL；报告展示安全终止

---

## E. 行为日志与评分

### TC-E01 answer_payload 含 scoring_engine_version 和 failed_criteria
- 输入：错误答案的 SC 题
- 步骤：提交；查询 answer_record.answer_payload
- 预期：answer_payload 含 scoring_engine_version 字段；failed_criteria 列出不匹配项

### TC-E02 评分器可仅凭冻结数据复算分数
- 输入：历史 answer_record 行（question_bank 快照 + scoring_rule_json + answer_payload）
- 步骤：调用评分器复算
- 预期：复算结果与原 score 一致

### TC-E03 未声明指标不进报告结论
- 输入：题目 log_metrics 未声明 reaction_time；answer_payload 含 reaction_time
- 步骤：生成报告
- 预期：报告不展示 reaction_time 为能力结论

### TC-E04 pointer_move 事件不进 domain_event_projection
- 输入：拖拽题用户操作产生 pointer_move 事件
- 步骤：查询 domain_event_projection
- 预期：无 pointer_move 行

### TC-E05 反应时间/帮助次数不直接等同成绩
- 输入：latency_ms=50000（超慢反应）；help_count=3
- 步骤：评分；生成报告
- 预期：score 不因 latency/help_count 自动减分；报告中作为参考信息而非能力得分


---

## F. 素材资产

### TC-F01 必需素材全部 ACTIVE 才可转题目 ACTIVE
- 输入：题目 content_json.presentation.assets 含 required=true 的 asset_id，该 asset status=DRAFT
- 步骤：尝试转题目 ACTIVE
- 预期：validateQuestionContract 规则 13 拒绝

### TC-F02 素材 hash 不一致不可转 ACTIVE
- 输入：asset_resource.file_hash 与实际文件不符
- 步骤：尝试转题目 ACTIVE
- 预期：hash 校验失败，拒绝

### TC-F03 renderer 统一通过 app://asset/<id> 加载
- 输入：任一 IMAGE_CARD 题目
- 步骤：renderer 请求素材
- 预期：请求 URL 为 app://asset/<asset_id>；不含绝对路径

### TC-F04 题目 JSON 不含本地绝对路径
- 输入：content_json
- 步骤：扫描所有 ACTIVE 题目 content_json
- 预期：无 /home/、/Users/、C:\ 等绝对路径字符串

### TC-F05 修改图片内容需新 asset_id
- 输入：已有 asset_resource 行，尝试 UPDATE file_hash 为不同值
- 步骤：执行 UPDATE
- 预期：触发器拒绝原地修改（须新建 asset_id）

### TC-F06 VIDEO_SCENE 缺 SCENE_VIDEO 不得 ACTIVE
- 输入：presentation_type=VIDEO_SCENE，presentation.assets 无 role=SCENE_VIDEO 的资产
- 步骤：尝试转 ACTIVE
- 预期：validateQuestionContract 规则 7 拒绝

---

## G. 报告与结果

### TC-G01 report_content_json 符合 task-report-v1.1
- 输入：基础能力测评完成，生成报告
- 步骤：查询 task_report.report_content_json；调用 validator
- 预期：schema 校验通过；report_scope='BASE_ABILITY'

### TC-G02 报告按 evidence_type 分组
- 输入：混合 SOFTWARE_BEHAVIOR 和 SITUATIONAL_JUDGMENT 题的测评
- 步骤：查看报告 evidence_summary
- 预期：两类证据分开展示

### TC-G03 OBSERVATION_ONLY 在行为观察区
- 输入：含 OBSERVATION_ONLY 题的测评
- 步骤：查看报告
- 预期：观察项在 behavior_observations 区；不进总分

### TC-G04 pilot_mode=true 时安置建议禁用
- 输入：strategy_config.pilot_mode=true 的测评
- 步骤：生成报告
- 预期：placement_advice.enabled=false

### TC-G05 completion_ratio<1 不输出安置方向
- 输入：测评未完成（completion_ratio=0.8）
- 步骤：生成报告
- 预期：无安置方向文字；报告标注未完成

### TC-G06 validity_boundary 进入报告限制说明
- 输入：题目 content_json.validity_boundary 有值
- 步骤：生成报告
- 预期：validity_limitations 区块展示对应内容

### TC-G07 支持等级和 accommodations 展示
- 输入：有 P2 等级、AAC 使用记录的测评
- 步骤：查看报告 support_summary
- 预期：展示 prompt_level=P2；accommodations=['AAC']

### TC-G08 结果三类独立，不合成总分
- 输入：同时产出 ABILITY_SCORE + TRAINING_COMPLETION + OPERATION_PASS_RATE 的测评
- 步骤：查询 result_record；查看报告
- 预期：三条独立 result_record；报告分三栏展示；无"总分"字段


---

## H. 组卷门禁

### TC-H01 基础能力题库充足性门禁
- 输入：每模块有 ≥7 道 ACTIVE、SCORED_ITEM、renderer 已实现的线上题
- 步骤：触发 BASELINE_ASSESSMENT 组卷
- 预期：成功组卷

### TC-H02 题库不足返回 QUESTION_BANK_INSUFFICIENT
- 输入：某模块只有 3 道 ACTIVE 线上题（<7）
- 步骤：触发组卷
- 预期：返回 QUESTION_BANK_INSUFFICIENT；不静默降级

### TC-H03 线下题充足性门禁
- 输入：仅有 5 道 ACTIVE OFFLINE_OPERATION（<8）
- 步骤：触发组卷
- 预期：QUESTION_BANK_INSUFFICIENT

### TC-H04 不固定每模块题型比例
- 输入：某模块全为 SINGLE_CHOICE，无 TRUE_FALSE 和 DRAG
- 步骤：触发组卷
- 预期：组卷成功（不强制 14/14/14 分布）

### TC-H05 固定示范卷任一题非 ACTIVE 不能发起
- 输入：fixed_scored_question_ids 中一道题 status=DRAFT
- 步骤：尝试创建 JOB_SKILL_ASSESSMENT session
- 预期：返回明确错误码（如 FIXED_PAPER_QUESTION_NOT_ACTIVE）；session 未创建

### TC-H06 固定示范卷素材或答案未通过不能发起
- 输入：固定题集中一道题 answer_key_status=PENDING
- 步骤：尝试创建 JOB_SKILL_ASSESSMENT session
- 预期：validateQuestionContract 规则 9 触发；session 未创建

---

## I. 观察通道

### TC-I01 OBSERVATION_ONLY 必须 NO_SCORE
- 输入：item_usage=OBSERVATION_ONLY，scoring_type=OFFLINE_RUBRIC 的 INSERT
- 步骤：尝试转 ACTIVE
- 预期：validateQuestionContract 规则 3/4 拒绝

### TC-I02 TEACHER_OBSERVATION 写 offline_score_record score=NULL
- 输入：JOB_SKILL session，OBSERVATION phase 题，教师录入观察编码
- 步骤：写入 offline_score_record（score_scope=TEACHER_OBSERVATION）
- 预期：score=NULL；CHECK 约束允许；observation_payload_json 有值

### TC-I03 观察记录不进 completion_ratio
- 输入：18+6 计分题全完成，2 条观察项完成
- 步骤：生成 JOB_SKILL_SCORE
- 预期：result_payload.completion_ratio 分母=24（不含观察项）

### TC-I04 3 条嵌入观察重导后识别为 OBSERVATION_ONLY
- 输入：重导后数据库中 M1_OB_048、M5_OP_048（或 M5_OB_048）、M5_OP_055（或 M5_OB_055）
- 步骤：查询 question_bank 的 item_usage 和 interaction_type
- 预期：item_usage=OBSERVATION_ONLY；interaction_type=TEACHER_OBSERVATION

### TC-I05 TEACHER_OBSERVATION 写入 action_log.jsonl
- 输入：教师录入 M1_OB_048 观察编码
- 步骤：调用 TEACHER_OBSERVATION_RECORDED 事件；查询 action_log.jsonl
- 预期：事件写入 JSONL；event_type=TEACHER_OBSERVATION_RECORDED；payload 含 observation_code/behavior_codes

### TC-I06 观察记录不改变 raw_score
- 输入：18 线上全部 0 分，6 线下全部 0 分，2 条观察完成
- 步骤：生成结果
- 预期：raw_score=0；observation_completion_ratio=1；两值独立

### TC-I07 观察缺失时报告展示观察完成度不足
- 输入：0 条观察完成，observation_completion_ratio < 1
- 步骤：生成报告
- 预期：报告 teacher_observations 区块展示"观察完成度不足"；不伪装为 0 分

---

## J. 呈现与视频降级

### TC-J01 IMAGE_CARD 降级必须有 transformation 留痕
- 输入：原为视频题，降级为 IMAGE_CARD
- 步骤：查询 content_json.source.transformation
- 预期：transformation = 'VIDEO_TO_IMAGE_CARD'

### TC-J02 VIDEO_TO_IMAGE_CARD 须有专业审核记录
- 输入：无审核记录的 VIDEO_TO_IMAGE_CARD 降级题
- 步骤：尝试转 ACTIVE
- 预期：validateQuestionContract 规则 8 拒绝（须有专业审核记录与效度说明）

### TC-J03 VIDEO_SCENE 缺视频不能 ACTIVE（同 TC-F06）
- 输入：presentation_type=VIDEO_SCENE，无 SCENE_VIDEO 素材
- 步骤：尝试转 ACTIVE
- 预期：拒绝

### TC-J04 图片降级后素材可通过 app://asset/ 加载
- 输入：IMAGE_CARD 题，assets 含 IMAGE_CARD role 的资产 ID
- 步骤：renderer 加载素材
- 预期：加载成功；URL 格式正确


---

## K. 评分规则命名与三档锚点

### TC-K01 RUBRIC_BASED 不得进入新库
- 输入：scoring_rule_json.scoring_type = 'RUBRIC_BASED'
- 步骤：尝试导入/转 ACTIVE
- 预期：validator 拒绝（IMP_W / ACTIVE 门禁）

### TC-K02 DRAG_PARTIAL 不得进入新库
- 输入：scoring_rule_json.scoring_type = 'DRAG_PARTIAL'
- 步骤：尝试导入/转 ACTIVE
- 预期：validator 拒绝

### TC-K03 OFFLINE_RUBRIC 缺三档锚点不得 ACTIVE
- 输入：scoring_rule_json.scoring_type='OFFLINE_RUBRIC'，criteria 中 score_0/score_1/score_2 为通用"未完成/部分完成/达标"
- 步骤：尝试转 ACTIVE
- 预期：validateQuestionContract 规则 10 拒绝（通用模板不合格）

### TC-K04 线上评分仍只产生 0 或 2
- 输入：ORDER_MATCH / MAPPING_MATCH / EXACT_MATCH 各一道
- 步骤：提交各种答案
- 预期：score ∈ {0, 2}

### TC-K05 OFFLINE_RUBRIC 三档锚点后 score 可为 0/1/2
- 输入：M1_OP_033，教师评 score=1
- 步骤：写入 offline_score_record
- 预期：score=1 合法写入


---

## L. 数据质量与重导

### TC-L01 M1_TF_015 未核验前不得 ACTIVE
- 输入：M1_TF_015 题，answer_key_status=PENDING
- 步骤：尝试转 ACTIVE
- 预期：validateQuestionContract 规则 9 拒绝

### TC-L02 ability_tags "0"/"1" 导入失败
- 输入：ability_tags = ["0"] 的题目导入
- 步骤：执行导入脚本
- 预期：IMP_E / IMP_W001 触发；自动清洗为 [] 或终止导入

### TC-L03 note 存储状态值输出告警
- 输入：note = "ACTIVE" 的题目导入
- 步骤：dry-run
- 预期：IMP_W002 告警；状态值丢弃

### TC-L04 job_code supermarket_stocking 不进新库
- 输入：job_code = 'supermarket_stocking' 的题目导入
- 步骤：执行导入
- 预期：自动替换为 'SUPERMARKET_SHELVER'；source.legacy_job_code 保留原值

### TC-L05 M1-M6 dry-run 矩阵与审查报告一致
- 输入：298 条 JSON
- 步骤：dry-run，生成模块×题型矩阵
- 预期：M1:48, M2:41, M3:58, M4:48, M5:55, M6:48；SC:96, TF:68, DG:34, OP:97, OB:3

### TC-L06 dry-run 输出位置分布和素材缺口
- 输入：298 条 JSON
- 步骤：dry-run
- 预期：报告含 SC 位置分布（A/B/C 占比）；素材缺口清单（200 条有 media_brief 无素材）

### TC-L07 295 条旧 ACTIVE 重导后不保持 ACTIVE
- 输入：现库 295 条 status=ACTIVE 的题
- 步骤：重导
- 预期：全部变为 DRAFT；无一保持 ACTIVE

### TC-L08 非法字段清洗报告
- 输入：ability_tags/note/media_brief 有问题的题
- 步骤：dry-run
- 预期：清洗报告列出 121 条 ability_tags 清洗、96 条 note 清洗、30 条 media_brief 前导逗号修复


---

## M. 冻结与施测变体

### TC-M01 ACTIVE 题修改语义字段失败
- 输入：ACTIVE 题，尝试 UPDATE bank_domain
- 步骤：执行 UPDATE
- 预期：ACTIVE 冻结触发器拒绝

### TC-M02 施测变体编码进观察字段不改分数
- 输入：M2_OP_035 预埋差错题，教师录入"差错检出=是"
- 步骤：写 offline_score_record；score=2；observation_payload_json.detected_error=true
- 预期：score=2 不变；observation_payload_json 独立记录

### TC-M03 不清楚选项不保存为 NOT_APPLICABLE
- 输入：SC 题选"不清楚"
- 步骤：提交
- 预期：response_status=ANSWERED；score=0；unsure_selected=true；非 NOT_APPLICABLE

### TC-M04 同一 strategy version 固定题集不可修改
- 输入：已有 JOB_SKILL_ASSESSMENT strategy version=4，尝试修改 question_policy_json 中的 fixed_scored_question_ids
- 步骤：UPDATE strategy_config SET question_policy_json = '...' WHERE version=4
- 预期：strategy 版本不可变触发器拒绝


---

## N. 固定示范卷与 JOB_SKILL Session

### TC-N01 JOB_SKILL_ASSESSMENT 能创建 session
- 输入：strategy_type=JOB_SKILL_ASSESSMENT，24 道题全 ACTIVE
- 步骤：创建 assessment_session
- 预期：session 创建成功；online_question_count=18；offline_question_count=6

### TC-N02 固定卷覆盖 M1-M6
- 输入：JOB_SKILL_ASSESSMENT session 创建
- 步骤：查询 assessment_session_question 中 job_module_code 分布
- 预期：M1/M2/M3/M4/M5/M6 各出现；每模块 3 online + 1 offline

### TC-N03 每模块 3 线上 1 线下
- 输入：TC-N02 同
- 步骤：按 job_module_code + question_phase 统计
- 预期：每模块 ONLINE=3, OFFLINE=1

### TC-N04 观察项不超 3 项
- 输入：strategy embedded_observation_question_ids 含 2 项
- 步骤：查询 assessment_session_question phase=OBSERVATION
- 预期：≤3 行

### TC-N05 支持多坐次暂停恢复
- 输入：JOB_SKILL session 答题一半后暂停
- 步骤：暂停→恢复→继续答题
- 预期：session sitting_no 递增；已答题保留；状态机流转正确

### TC-N06 session_question 保存 bank_domain/job_module_code/item_usage/phase
- 输入：创建 JOB_SKILL session
- 步骤：查询 assessment_session_question
- 预期：bank_domain='JOB_SPECIFIC'；job_module_code ∈ {M1-M6}；item_usage='SCORED_ITEM'；phase ∈ {ONLINE,OFFLINE}

### TC-N07 OBSERVATION phase 不生成普通 answer_record
- 输入：OBSERVATION phase 题完成观察
- 步骤：查询 answer_record
- 预期：该题无对应 answer_record 行

### TC-N08 安全红线中断专业岗位测评
- 输入：JOB_SKILL session 中触发安全事件
- 步骤：创建 safety_incident + 批量熔断
- 预期：session status → REDLINE_HALTED；不可恢复

### TC-N09 任一固定题非 ACTIVE 不能发起测评
- 输入：M3_TF_025 status=DRAFT，其余全 ACTIVE
- 步骤：尝试创建 JOB_SKILL session
- 预期：错误码 FIXED_PAPER_QUESTION_NOT_ACTIVE；session 未创建

### TC-N10 不得临场从 DRAFT 题补题
- 输入：TC-N09 同场景，系统不自动补题
- 步骤：创建失败后查询 assessment_session_question
- 预期：无 session 创建；不存在用其他题替补的逻辑

### TC-N11 session task_code 合法
- 输入：task_code = 'JOB_SKILL_DEMO_M1M6'（或实际值）
- 步骤：创建 session；查询 task_code
- 预期：task_code 与 strategy 种子一致；非空

### TC-N12 online_question_count=18 / offline_question_count=6
- 输入：JOB_SKILL session 创建完成
- 步骤：查询 assessment_session
- 预期：online_question_count=18；offline_question_count=6


---

## O. JOB_SKILL 评分与结果

### TC-O01 线上题只能 0/2
- 输入：JOB_SKILL session 线上 18 题提交各种答案
- 步骤：查询 answer_record.score
- 预期：score ∈ {0, 2}；无 1

### TC-O02 线下题只能 0/1/2
- 输入：教师评 M1_OP_033
- 步骤：写入 offline_score_record
- 预期：score ∈ {0, 1, 2}

### TC-O03 观察项 score 必须 NULL
- 输入：TEACHER_OBSERVATION scope 的 offline_score_record
- 步骤：写入 score=1
- 预期：CHECK 约束拒绝；score 必须 NULL

### TC-O04 总满分 48
- 输入：所有题满分
- 步骤：查询 result_record.max_score
- 预期：max_score=48

### TC-O05 normalized_score 计算正确
- 输入：raw_score=24
- 步骤：生成 JOB_SKILL_SCORE
- 预期：normalized_score = 24/48×100 = 50.0

### TC-O06 observation_completion_ratio 单独计算
- 输入：2 条观察完成，共 2 条观察
- 步骤：查询 result_payload_json.observation_completion_ratio
- 预期：1.0（独立于计分 completion_ratio）

### TC-O07 生成 JOB_SKILL_SCORE，不生成 ABILITY_SCORE
- 输入：JOB_SKILL session 完成
- 步骤：查询 result_record
- 预期：result_type='JOB_SKILL_SCORE'；无 ABILITY_SCORE 行

### TC-O08 result_payload 含 M1-M6 模块画像
- 输入：TC-O07 同
- 步骤：解析 result_payload_json.job_module_profiles
- 预期：包含 M1~M6 各模块 online_score / offline_score / pass_rate

### TC-O09 安全红线优先覆盖普通等级
- 输入：JOB_SKILL session 触发 REDLINE_HALTED
- 步骤：查询 result_record.level_result
- 预期：level_result = 'LEVEL_FAIL_BY_SAFETY'；不受 normalized_score 影响


---

## P. 专业岗位报告

### TC-P01 生成 report_scope=JOB_SKILL 报告
- 输入：JOB_SKILL session 完成
- 步骤：生成报告；查询 task_report.report_content_json
- 预期：report_scope='JOB_SKILL'；schema 符合 job-skill-report-v1.0

### TC-P02 报告展示 M1-M6
- 输入：TC-P01 同
- 步骤：解析报告内容
- 预期：每个模块（M1~M6）均有对应得分区块

### TC-P03 报告展示线上与线下对比
- 输入：TC-P01 同
- 步骤：解析报告
- 预期：每模块有 online_score 和 offline_score 分开展示

### TC-P04 报告展示支持等级和教师观察
- 输入：有 P2 等级记录 + 观察完成
- 步骤：解析报告
- 预期：support_summary 含等级；teacher_observations 含编码结果

### TC-P05 报告展示训练重点建议
- 输入：M2 模块得分率 < 60%
- 步骤：生成报告
- 预期：报告含 M2 训练重点建议文案；推荐"拆箱与上架"训练

### TC-P06 报告不输出就业安置结论
- 输入：任何 JOB_SKILL 测评结果
- 步骤：检查报告全文
- 预期：不含"适合就业"、"不适合就业"、"竞争性就业"、"支持性就业"等字样

### TC-P07 未实现训练模块不生成虚假链接
- 输入：M3-M6 模块低分
- 步骤：生成报告
- 预期：M3-M6 只有建议文案；无可点击链接（仅 M2 有链接）

### TC-P08 单模块低分不触发基础能力模块兜底
- 输入：M1 得分率 0%，其余满分
- 步骤：生成结果
- 预期：结果不因 M1 低分切换为 ABILITY_SCORE 链路

### TC-P09 报告使用 task_report 表（不新增表）
- 输入：TC-P01 同
- 步骤：查询数据库表列表
- 预期：无 job_skill_report 新表；job-skill-report-v1.0 存储在 task_report.report_content_json


---

## Q. 素材与审核门禁（JOB_SKILL）

### TC-Q01 固定示范卷全部素材可加载
- 输入：24 道固定题全部素材已上传
- 步骤：通过 app://asset/ 加载每道题素材
- 预期：全部 200 OK；无 404

### TC-Q02 VIDEO_SCENE 缺视频不能 ACTIVE
- 输入：presentation_type=VIDEO_SCENE 但无 SCENE_VIDEO 资产
- 步骤：尝试转 ACTIVE
- 预期：拒绝（同 TC-F06）

### TC-Q03 VIDEO_TO_IMAGE_CARD 须有审核与效度说明
- 输入：降级题无 review 记录
- 步骤：尝试转 ACTIVE
- 预期：拒绝（同 TC-J02）

### TC-Q04 自动评分题答案键必须 VERIFIED 或 CORRECTED
- 输入：M1_SC_001，answer_key_status=PENDING
- 步骤：尝试转 ACTIVE
- 预期：拒绝（validateQuestionContract 规则 9）

### TC-Q05 M1_TF_015 不得进固定示范卷
- 输入：M1_TF_015 answer_key_status=PENDING，尝试写入 fixed_scored_question_ids
- 步骤：创建 JOB_SKILL session
- 预期：session 创建校验失败；M1_TF_015 不在任何 session_question 中

### TC-Q06 线下题 6 道必须有逐题 0/1/2 锚点
- 输入：M5_OP_040 缺三档锚点
- 步骤：尝试转 ACTIVE
- 预期：validateQuestionContract 规则 10 拒绝

### TC-Q07 ability_tags 不含 "0"/"1"
- 输入：ACTIVE 题 ability_tags 含 "0"
- 步骤：validateQuestionContract
- 预期：规则 14 拒绝（JOB_SPECIFIC 不得含非法值）

---

## R. 回归保证

### TC-R01 基础能力 42+8 流程继续通过
- 输入：现有 Q_BASE 题库，BASELINE_ASSESSMENT session
- 步骤：完整答题→评分→生成 ABILITY_SCORE→报告
- 预期：全流程通过；无影响

### TC-R02 训练/实操评分/安全事件/报告快照流程不受影响
- 输入：现有 TRAINING_PRACTICE session + safety_incident 创建
- 步骤：完整流程
- 预期：全部通过；strategy_config 版本冻结和引用一致性正常

### TC-R03 strategy_config 版本冻结和引用一致性
- 输入：已被 session 引用的 strategy version
- 步骤：尝试 UPDATE strategy_config（同一 version 字段）
- 预期：版本不可变触发器拒绝

