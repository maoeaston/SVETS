# 方案 B 多设备架构 v2.2 — 覆盖矩阵

> **配套文档：** architecture-plan-b-multi-device-v2.2-authoritative-baseline.md
> **生成日期：** 2026-07-14（含最小一致性硬化修订）
> **规则：** 每个 CLOSED 项同时具备 (1) 正文设计 (2) 完整 DDL 或明确数据合同 (3) 状态不变量 (4) 测试或人工验收证据。缺任一项则标 PARTIAL。合同本身存在矛盾的项目不得以"运行时 PARTIAL"掩盖——先修正合同再保留端到端 PARTIAL。本矩阵指向 v2.2 正文章节、DDL 位置和验收编号。

---

## 一、决策矩阵（正式实现事实 → v2.2 决策）

| # | 设计领域 | 正式实现事实 (v0.1.12) | v2.1 设计与问题 | v2.2 最终决策 | 章节 | DDL/合同位置 | 验收 | 状态 |
|---|----------|----------------------|----------------|--------------|------|-------------|------|------|
| 1 | organization | 不存在 | 固定 org_default 种子 | 安装生成 UUID，禁止 org_default | §3.2 | §7.2 T1 | M-01~03 | CLOSED |
| 2 | node | 不存在 | CREATE TABLE | 保留 | §3.3 | §7.2 T2 | M-01 | CLOSED |
| 3 | device | 不存在 | CREATE TABLE | 保留完整（trust/credential） | §3.4 | §7.2 T3 | M-01 | CLOSED |
| 4 | device_runtime_session | 不存在 | CREATE TABLE | 保留 + ux_device_one_active_runtime | §3.5 | §7.2 T4 | M-01 | CLOSED |
| 5 | auth_session | 不存在（仅 auth:login） | CREATE TABLE | 保留完整 | §3.6 | §7.2 T5 | M-01 | CLOSED |
| 6 | student_profile/user_account | 分离无 FK | nullable user_id FK | 采用 + 部分唯一索引 | §4 | §7.3 B1,§7.4 | M-01 | CLOSED |
| 7 | delegated_access_grant | 不存在 | 按 student+device 长期授权（问题 #2） | 绑 business_session_id + 自一致性触发器 D9 | §6.1,§6.2 | §7.2 T7,§7.5 D9 | G-01,G-08~11 | CLOSED |
| 8 | business_session | 不存在 | 无 job_code/task_code | 加 job_code+task_code；无 status，子表派生；父键不可变 D8 | §5.1 | §7.2 T6,§7.5 D8 | C-01~06 | CLOSED |
| 9 | business_session_assignment | 不存在 | 缺 UNIQUE grant | 单向 FK→grant；3 唯一索引（含 per_grant）；D10/D11 | §6.3 | §7.2 T8,§7.5 D10/D11 | G-02,G-03,G-07 | CLOSED |
| 10 | assessment_session | 完整表 8 触发器 | validation report 编造列（问题 #4） | 增量 4 列，只在 §7.3 出现一次 | §5.3 | §7.3 B2/B3 | P-01~08 | CLOSED |
| 11 | training_session | 完整表 6 触发器 | 声称加 business_session_id/assignment_id（正文无） | 只增 business_session_id 1 列 | §5.4 | §7.3 B4 | C-01 | CLOSED |
| 12 | learning_session | 完全不存在 | 双 ID 可漂移 | business_session_id 作 PK+FK，无第二 ID；UPDATE 一致性 D7 | §5.5 | §7.2 T9,§7.5 D7 | C-06 | CLOSED |
| 13 | learning_progress | 完全不存在 | FK 到 learning_session_id | FK 到 business_session_id | §5.6 | §7.2 T10 | M-01 | CLOSED |
| 14 | delivery_phase 状态机 | 无此列 | DEFAULT PREPARED + 回填矛盾（问题 #1） | NULL→回填→触发器；前向 + 守卫 D2~D4 | §9 | §7.3 B2,§8.3,§9.4,§7.5 D2~D4 | P-01~08 | CLOSED |
| 15 | offline_score_draft | 仅组件内存（问题 #11） | 判为 localStorage/仅运行时 | 新增服务端表 + 乐观锁 + XOR CHECK；批次化 finalize | §18 | §7.2 T18 | D-01,D-02 | CLOSED |
| 16 | command_log | 不存在 | 声称可全量从 JSONL 重建（问题 #7） | 混合表 + 恢复分类；current_lease_generation 可变 | §11.1,§11.8,§11.9 | §7.2 T11 | J-07,J-13 | CLOSED(合同)/PARTIAL(运行时) |
| 17 | applied_event_batch | 不存在 | 缺 fencing 字段 | previous/events/batch_hash + prepared_lease_generation（不可变）+ worker_id | §10.7 | §7.2 T12 | J-09 | CLOSED(合同)/PARTIAL(运行时) |
| 18 | processed_event | 不存在 | CREATE TABLE | 保留 | §10.7 | §7.2 T13 | J-10 | CLOSED(合同)/PARTIAL(运行时) |
| 19 | projector_cursor | 不存在 | CREATE TABLE | 保留 | §10.8 | §7.2 T14 | J-09 | CLOSED(合同)/PARTIAL(运行时) |
| 20 | JSONL segment/index/hash chain | 单文件，无 hash | 两套 batch_hash（问题 #6） | 唯一算法 canonical+LF | §10.5,§10.6 | §10.5 合同 | J-01~06 | CLOSED（算法已测） |
| 21 | BATCH_PREPARED fencing | 不存在 | 缺字段（问题 #5）；generation 语义混淆 | 12 字段完整；prepared vs current generation 区分；lease 原子 WHERE | §10.4,§11.2,§11.3 | §10.4,§11.2 合同 | J-08,J-14 | CLOSED(合同)/PARTIAL(运行时) |
| 22 | safety incident | 完整表 10 触发器 | 两种聚合键写法（问题 #8,#9） | 目标 student_id+job_code+task_code；替换 4 触发器；无追加领域事件 | §12,§13 | §13.2 | S-01~06 | CLOSED |
| 23 | session_invalidation_record | 不存在 | 多态裸 session_id（问题 #13.3） | FK→business_session | §20.3 | §7.2 T16 | W-09 | CLOSED |
| 24 | result publication | 无发布列 | student_visible 可漂移（问题 #10） | 删持久化 student_visible，查询派生 | §17.2 | §7.3 B6 | W-09 | CLOSED |
| 25 | invalidation 可见性映射 | 无 | 直接比较 source_aggregate_id（问题 #5） | result_record.business_session_id 稳定映射；子表显式 JOIN | §17.2 | §7.3 B6 | W-09 | CLOSED（SQL 已测） |
| 26 | asset authorization | app:// 无授权（问题 #12） | 标注"无需认证" | 强制授权链 | §19.1 | §19.3 合同 | W-08 | CLOSED(合同)/PARTIAL(运行时) |
| 27 | backup manifest | 不存在 | 未明确事实来源（问题 #13.4） | 外部 manifest 权威 + backup_manifest 台账 | §21.2 | §7.2 T15 | B-01,B-07 | CLOSED(合同)/PARTIAL(集成) |
| 28 | versioned generation restore | 不存在 | POSIX 指向根 gen-N（问题 #9） | generation 目录 + current→generations/gen-N + 原子切换 | §21.6,§21.7 | §21 协议 | B-05,B-06 | CLOSED(合同)/PARTIAL(集成) |
| 29 | HTTPS/CA/pairing | 不存在 | 无配对挑战持久化 | ECDSA + pairing_challenge 审计 | §16 | §7.2 T19 | W-05,W-07 | CLOSED(合同)/PARTIAL(集成) |
| 30 | REST/SSE/IPC | 仅 IPC（已注册通道） | — | 三通道 + Command Bus 统一 | §14 | §14.4/§14.5 | W-03,W-04 | CLOSED(合同)/PARTIAL(运行时) |
| 31 | CSRF / Web 安全 | 不存在（纯 IPC） | — | 三层 CSRF + Cookie 策略 | §15 | §15 合同 | W-01,W-02 | CLOSED(合同)/PARTIAL(运行时) |
| 32 | student visibility | 无 | — | 派生可见性 + 白名单 | §17 | §17.2 派生 | W-09 | CLOSED |
| 33 | 冗余字段漂移 | assignment/grant 无跨表约束 | "App+CHECK"无 trigger（问题 #13.2） | trigger 强制一致 D10 | §6.5 | §7.5 D10 | G-03 | CLOSED |
| 34 | 父子会话一致性 | 无 | 仅 ID 约定（问题 #3） | FK + 四字段匹配 + NOT NULL + 父键不可变 + learning UPDATE（D5~D8） | §5.2 | §7.5 D5~D8 | C-01~06 | CLOSED |
| 35 | Grant Rebind 事务 | 不存在 | 步骤松散、无事务（问题 #1） | 单事务 expire→create→repoint + version+1 + 重确认；活动 assignment 需 ACTIVE grant | §6.6 | §7.5 D11 | G-04~07 | CLOSED |
| 36 | 触发器统计 | — | 46 保留 + 4 替换（错） | 44 保留 + 4 替换 + 18 新增（实测 48→66） | §7.1 | §7.5,§13.2 | M-04,M-05 | CLOSED |

---

## 二、机械抽取的 DDL 清单（与正文一致，问题 #4；已 diff 校验）

### 2.1 CREATE TABLE（19）

organization, node, device, device_runtime_session, auth_session, business_session, delegated_access_grant, business_session_assignment, learning_session, learning_progress, command_log, applied_event_batch, processed_event, projector_cursor, backup_manifest, session_invalidation_record, correction_record, offline_score_draft, pairing_challenge

### 2.2 ALTER TABLE ADD COLUMN（14）

student_profile.user_id；assessment_session.delivery_phase / .event_sequence_version / .observation_template_id / .business_session_id；training_session.business_session_id；safety_incident.source_device_id / .source_node_id / .command_id；result_record.publication_status / .published_at / .published_by / .business_session_id；task_report.visibility_scope

### 2.3 CREATE INDEX（25，含 UNIQUE）

ux_device_one_active_runtime, idx_auth_session_user_status, idx_auth_session_token, idx_business_session_student, idx_business_session_student_job_task, ux_grant_one_active_per_business_session, idx_grant_student_device_status, ux_assignment_one_active_per_grant, ux_assignment_one_active_per_session, ux_assignment_one_active_per_device, idx_learning_session_student_status, ux_command_idempotency, idx_applied_event_batch_segment, idx_processed_event_batch, ux_invalidation_per_business_session, idx_correction_record_target, ux_offline_score_draft_open_item, ux_student_profile_user_id, ux_assessment_business_session, ux_training_business_session, idx_assessment_session_delivery_phase, idx_result_record_business_session, idx_safety_incident_student_job_task_status, ux_assessment_one_open_session_per_student_job_task_strategy, ux_training_one_open_session_per_student_job_task

### 2.4 CREATE TRIGGER（22 = 18 新增 + 4 安全键替换）

**新增 18（§7.5）：** D1 trg_assessment_delivery_phase_forward_only；D2 _insert_prepared；D3 _frozen_on_abnormal；D4 _finalized_completed_consistency_insert/_update；D5 trg_assessment_business_session_consistency_insert/_update；D6 trg_training_business_session_consistency_insert/_update；D7 trg_learning_business_session_consistency_insert/_update；D8 trg_business_session_key_immutable；D9 trg_grant_self_consistency_insert/_update；D10 trg_assignment_grant_consistency_insert/_update；D11 trg_assignment_active_requires_active_grant_insert/_update

**替换 4（§13.2，DROP 后 CREATE 加 job_code）：** trg_safety_incident_bind_open_assessments, trg_safety_incident_bind_open_trainings, trg_assessment_session_block_unresolved_safety_incident, trg_training_session_block_unresolved_safety_incident

### 2.5 DROP（迁移中）

DROP TRIGGER：上述 4 安全触发器（v0.1.12 student_id+task_code 版本）
DROP INDEX：ux_assessment_one_open_session_per_student_task_strategy, ux_training_one_open_session_per_student_task

### 2.6 触发器计数核对（问题 #10 修正）

v0.1.12 = 48。迁移 DROP 4 + CREATE 22（18 新 + 4 重建）。**44 原样保留 + 4 替换 + 18 新增 = 66**（实测 sqlite_master 加载后 trigger 数 48→66）。

### 2.7 enum 增量

delivery_phase(9 值)、publication_status(DRAFT/PUBLISHED/WITHDRAWN)、visibility_scope(TEACHER_ONLY/STUDENT_VISIBLE/PUBLIC)、learning_type、learning_session.status、offline_score_draft.status(OPEN/SUBMITTED/DISCARDED)。

---

## 三、13 条必关闭问题 + 本轮 10 项硬化状态

| 项 | 内容 | 章节 | 状态 |
|----|------|------|------|
| 原#1 | delivery_phase 迁移顺序 | §8.2,§8.3,§9 | CLOSED（AUTO） |
| 原#2 | Grant 授权粒度（业务会话） | §6 | CLOSED（AUTO） |
| 原#3 | business_session 与子会话一致 | §5.2,§7.5 | CLOSED（AUTO） |
| 原#4 | 三工件不一致 | 本矩阵 §2 | CLOSED（AUTO diff） |
| 原#5 | BATCH_PREPARED fencing 字段 | §10.4,§11.3 | CLOSED(合同)/运行时 PARTIAL |
| 原#6 | 统一 JSONL hash 算法 | §10.5 | CLOSED（AUTO 8 项） |
| 原#7 | command_log 重建分类 | §11.8,§11.9 | CLOSED |
| 原#8 | 安全事件聚合键 job_code | §13 | CLOSED（AUTO） |
| 原#9 | 安全事件不追加未 PREPARE 领域事件 | §12.2 | CLOSED |
| 原#10 | publication 派生模型 | §17.2 | CLOSED |
| 原#11 | 线下评分草稿服务端持久化 | §18 | CLOSED |
| 原#12 | Student Renderer 资源授权 | §19 | CLOSED(合同)/运行时 PARTIAL |
| 原#13 | 其余结构约束 | §3.2,§6.5,§20.3,§21.2 | CLOSED |
| 硬化1 | Grant Rebind 单事务 + 活动 assignment 需 ACTIVE grant | §6.6,§7.5 D11 | CLOSED（AUTO G-04~07） |
| 硬化2 | Grant 自一致性触发器 + assigned_by 规则 | §6.5,§7.5 D9/D10 | CLOSED（AUTO G-08~11,G-03） |
| 硬化3 | 父子完整闭合（NOT NULL + job/task + 父键不可变 + learning UPDATE） | §5.2,§7.5 D5~D8 | CLOSED（AUTO C-01~06） |
| 硬化4 | fencing：prepared vs current generation；lease 原子 WHERE；严格相等 | §11.2,§11.3 | CLOSED(合同)/运行时 PARTIAL |
| 硬化5 | invalidation 经稳定 business_session_id | §17.2 | CLOSED（AUTO W-09） |
| 硬化6 | delivery_phase 守卫（INSERT PREPARED / 异常冻结 / FINALIZED↔COMPLETED） | §9.4.1,§7.5 D2~D4 | CLOSED（AUTO P-05~08） |
| 硬化7 | offline_score_draft XOR + 批次化 finalize | §7.2,§18.3 | CLOSED（AUTO D-02，批次化为合同） |
| 硬化8 | 回滚顺序（FK 列→父表→旧触发器） | §8.5 | CLOSED（AUTO forward→rollback） |
| 硬化9 | POSIX pointer 指 generations/gen-N | §21.7 | CLOSED（合同） |
| 硬化10 | 触发器统计 44+4+19 | §7.1,本矩阵 §2.6 | CLOSED（AUTO 计数） |

---

## 四、统计

- **设计领域：36**
- **完全 CLOSED（含 AUTO 或算法/合同+SQL 证据）：26**
- **CLOSED(合同/DDL/不变量齐全) + 端到端 PARTIAL：10**（fencing 崩溃恢复、SSE/CSRF、asset 授权链运行时、备份恢复/pointer 集成——这些**合同已一致、DDL/数据合同齐全、状态不变量已定义**，仅端到端验收依赖运行时 utilityProcess Server 或文件系统集成，如实标 PARTIAL，不掩盖为纯运行时）。

所有 PARTIAL 项的**合同层已消除矛盾**（本轮硬化重点）：fencing 的 generation 语义、rebind 事务顺序、父子 job/task 匹配、invalidation 映射、回滚顺序均在临时库真实执行验证。运行时 PARTIAL 仅指端到端行为（需 Server/文件系统），非合同缺陷。
