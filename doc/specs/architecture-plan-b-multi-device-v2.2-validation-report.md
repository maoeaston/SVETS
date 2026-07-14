# 方案 B 多设备架构 v2.2 — 验证报告

> **快照说明：** 本报告记录 M1 落地前以 schema v0.1.12 为输入的 v2.2 方案验证，不代表当前仓库实现状态。当前 schema 已为 v0.1.13，数据库迁移与三机开发同步见 `doc/features/multi-device-v2.2-migration-prd.md` 和 `doc/features/local-database-sync-sop.md`。
> **配套文档：** architecture-plan-b-multi-device-v2.2-authoritative-baseline.md + coverage-matrix.md
> **验证日期：** 2026-07-14
> **验证工具：** SQLite 3.50.6（临时库真实执行）+ Node.js v24.14.1（hash 算法）
> **原则：** 本报告不以关键词出现次数代替结构验证；所有 AUTO 项均在临时 SQLite/Node 真实执行并记录结果；无法自动执行的项如实标 MANUAL/PARTIAL，不虚报 PASS。

---

## 1. 实际读取的仓库文件

| 文件 | 读取 | 用途 |
|------|------|------|
| `src/main/db/schema.sql` | 全文（1791 行） | Schema 基线 v0.1.12（实测 20 表 / 48 触发器 / 73 索引） |
| `doc/specs/MVP_PRD_v1.0.9-authoritative.md` | 关键节全文 | PRD 基线 v1.0.9 |
| `doc/specs/architecture-plan-b-multi-device-v2.1-authoritative-baseline.md` | 全文（2195 行） | v2.1 输入 |
| `doc/specs/architecture-plan-b-multi-device-v2.1-coverage-matrix.md` | 全文 | v2.1 输入 |
| `doc/specs/architecture-plan-b-multi-device-v2.1-validation-report.md` | 全文 | v2.1 输入 |
| `src/main/domain/event-writer.ts` / `assessment-reducer.ts` | 摘要 | 事件写入/投影实现事实 |
| `src/main/ipc/handlers/*` | 摘要 | IPC 通道清单 |
| `src/main/db/{connection,interface,sqlite-adapter,memory-adapter}.ts` | 摘要 | DB 适配器事实 |
| `src/preload/index.ts` / `src/renderer/**` | 摘要 | Renderer 数据访问事实 |
| `doc/reference/2.2.md` | 全文 | 任务规范 |

---

## 2. Schema 和 PRD 实际版本

| 工件 | 版本 | 路径 | 依据 |
|------|------|------|------|
| Schema | v0.1.12-job-skill-assessment-mvp-closure | `src/main/db/schema.sql` | 文件头 + schema_migration 记录 line 69-70 |
| PRD | v1.0.9 authoritative | `doc/specs/MVP_PRD_v1.0.9-authoritative.md` | 当前唯一产品合同；v1.0.6～v1.0.9 差异版仅作历史追溯 |

**候选 PRD 文件甄别：** 目录存在 PRD_v1.0.6 / MVP_PRD_v1.0.7 / v1.0.8 / v1.0.9。选 v1.0.9 为正式基线，因其版本号最高、内含 v0.1.12 schema 对应的 JOB_SKILL_ASSESSMENT 全链路合同、且 schema.sql 头注释明确"merge PRD v1.0.7+v1.0.8+v1.0.9"。

---

## 3. 正式 Schema 关键表真实结构（逐项核对）

| 表 | 存在 | v2.2 相关事实 |
|----|------|--------------|
| student_profile | ✓ | 无 user_id 列（v2.2 §7.3 B1 新增） |
| user_account | ✓ | 与 student_profile 无 FK |
| assessment_session | ✓ | 8 状态枚举，无 delivery_phase / business_session_id 列 |
| training_session | ✓ | 7 状态枚举，无 business_session_id 列 |
| safety_incident | ✓ | 有 job_code 列；触发器 WHERE 仅用 student_id+task_code |
| safety_incident_binding | ✓ | UNIQUE(incident_id, aggregate_type, aggregate_id) |
| result_record | ✓ | 无 publication_status/student_visible/published_* 列 |
| task_report | ✓ | 无 visibility_scope 列 |
| strategy_config | ✓ | 4 strategy_type 含 JOB_SKILL_ASSESSMENT |
| domain_event_projection | ✓ | 事件投影，非 batch/segment |
| offline_score_record | ✓ | VALID/SUPERSEDED/VOID，无 DRAFT 态 |
| schema_migration | ✓ | 最新 0.1.12-job-skill-assessment-mvp-closure |
| organization/node/device/device_runtime_session/auth_session | ✗ | 全部不存在（仅文档） |
| delegated_access_grant/business_session/business_session_assignment | ✗ | 不存在 |
| learning_session/learning_progress/offline_score_draft | ✗ | 不存在 |
| command_log/applied_event_batch/processed_event/projector_cursor | ✗ | 不存在 |
| backup_manifest/session_invalidation_record/correction_record | ✗ | 不存在 |

**触发器数量：** 实测 48 个（`grep -c "CREATE TRIGGER"` = 48）。关键：终态保护、策略一致性(4)、红线路径(4)、safety 批量 halt(2 AFTER INSERT)、safety 生命周期/核心事实冻结、report 守卫。

**safety incident 执行者：** SQLite AFTER INSERT 触发器确定性执行（`trg_safety_incident_bind_open_assessments/trainings` 内直接 UPDATE 会话状态 + INSERT binding + 写 level_result/report_type），非应用层 projector。应用层只生成 SafetyIncidentCreated + INSERT safety_incident。

**safety 聚合键实测：** schema.sql line 740/1150/1426/1438/1456/1466 的 WHERE 均为 `student_id + task_code`，**不含 job_code**。task_code 仅 `length(trim)>0`，无全局 UNIQUE。→ v2.2 §13 迁移合同修正为 student_id+job_code+task_code。

---

## 4. 当前实现事实（代码级，非文档）

| 项 | 事实 | 证据 |
|----|------|------|
| JSONL 写入 | 单事件同步双写（appendFileSync 一行 + INSERT domain_event_projection），无三段式/hash/segment | `src/main/domain/event-writer.ts` writeEvent() |
| SQLite 投影 | reducer 在同一 db.transaction() 内直接写业务投影表；无从 JSONL 回读重放 | `assessment-reducer.ts` applyAssessmentEvent |
| 冷启动恢复 | 未实现（initDatabase 只执行 schema + seed 用户） | `connection.ts` |
| command_log/batch/segment 表 | 全部不存在于代码和 SQL | grep 零匹配 |
| Renderer 数据访问 | 纯 IPC（contextBridge + ipcRenderer.invoke），零 SQLite，零 fetch/EventSource/WebSocket | `src/preload/index.ts`, `src/renderer` CSP `connect-src 'self' app:` |
| 线下评分草稿 | 仅 Vue 组件内存 reactive，提交才落 offline_score_record；零 localStorage/草稿表 | `JobSkillScoringView.vue`, `job-skill-scoring.ts` |
| learning/video 模型 | 完全不存在 | grep learning_* 零匹配 |
| 多设备表 | 全部不存在 | grep 零匹配 |
| DB 适配器 | 生产 better-sqlite3（getDatabase 裸实例）；测试 MemoryAdapter(sql.js) | `connection.ts`, `sqlite-adapter.ts`, `memory-adapter.ts` |

这些确认 v2.2 中三段式事件协议、fencing、多设备表、learning、asset 授权链、offline_score_draft 均为**目标合同（需正式迁移/编码）**，非当前实现；v2.2 §0.4 已明确区分。

---

## 5. 真实 SQL 执行结果

### 5.1 语法 + 迁移 + 完整性检查（AUTO — PASS）

执行：临时库 `.read src/main/db/schema.sql` → `.read 增量迁移.sql`。

```
base(schema.sql only) tbl/trg/idx = 20|48|73
after migration       tbl/trg/idx = 39|56|118
foreign_key_check: PASS (empty)
integrity_check:   ok
```

- 表：20 → 39（+19 新表）。
- 触发器：48 → 56（+8 新增；4 安全触发器 DROP 后重建，净 +8）。
- 索引：73 → 118（+24 显式 CREATE INDEX + SQLite 为新表 UNIQUE 约束自动创建的索引；减 2 个被 DROP 替换的开放会话唯一索引）。
- `PRAGMA foreign_key_check` 返回空（所有 FK 有效）。
- `PRAGMA integrity_check` 返回 `ok`。

### 5.2 触发器行为测试（AUTO — 29/29 PASS）

脚本对每条 SQL 断言成功/中止/等值，重建库后逐组执行。

| 组 | 用例 | 结果 |
|----|------|------|
| 1 delivery_phase 合法迁移 | 8 步 PREPARED→…→FINALIZED 全部成功 | 8 PASS |
| 2 delivery_phase 非法迁移 | PREPARED→FINALIZED、PREPARED→STUDENT_CONFIRMED、ASSIGNED→OBSERVATION、ASSIGNED→PREPARED(回退)、ONLINE_IN_PROGRESS→READY_TO_FINALIZE、FINALIZED→OBSERVATION、FINALIZED→READY_TO_FINALIZE 全部被 RAISE(ABORT) | 7 PASS |
| 3 回填 | COMPLETED→FINALIZED；ABORTED 保持 NULL（不伪造） | 2 PASS |
| 4 安全键 job_code | 同 student+task_code 异 job_code 不误熔断（jobA=REDLINE_HALTED, jobB=ACTIVE）；binding=1 | 3 PASS |
| 5 assessment+training 同时熔断 | 同三元键 assessment 和 training 均 REDLINE_HALTED；binding=2 | 3 PASS |
| 6 无开放会话可创建 + REDLINE 不可逆 | 无会话创建 incident(binding=0)；REDLINE_HALTED→COMPLETED 被终态触发器阻止 | 3 PASS |
| 7 父子一致性 | ASSESSMENT 绑 TRAINING 父被拒；student_id 错配被拒；类型+student 一致可插入 | 3 PASS |
| **合计** | | **29 PASS / 0 FAIL** |

关键发现（已在正文 §13.2 F6 修正）：安全键测试暴露 v0.1.12 的 `ux_assessment_one_open_session_per_student_task_strategy`（student_id+task_code+strategy_type）也不含 job_code，导致同 student+task_code 跨 job 无法并存两个开放会话；v2.2 将该唯一索引和 training 对应索引一并 job-scoped 重建，测试遂通过。

### 5.3 Grant/Assignment/Draft 唯一性（AUTO — 4/4 PASS）

| 用例 | 结果 |
|------|------|
| 每 business_session 最多一个 ACTIVE grant（第二个被拒） | PASS |
| 每 grant 最多一个非终态 assignment（第二个被拒） | PASS |
| assignment student/device/session 与 grant 不一致被触发器拒 | PASS |
| offline_score_draft 每项最多一条 OPEN（第二个被拒） | PASS |

### 5.4 JSONL hash 算法测试（AUTO — 8/8 PASS，Node.js）

| 用例 | 结果 |
|------|------|
| canonical 序列化与 key 顺序无关 | PASS |
| events_hash 确定性 | PASS |
| events_hash 为 64 hex | PASS |
| batch_hash 从 GENESIS 链式 | PASS |
| batch2.previous = batch1.hash（链接） | PASS |
| 篡改事件字段 → events_hash 改变 | PASS |
| 篡改 previous_batch_hash → batch_hash 改变 | PASS |
| 末尾 LF 策略固定（与无末尾 LF 不同） | PASS |

算法固定：canonical JSON（key 升序）+ UTF-8 + 每事件后 LF；events_hash=SHA256(event_bytes)；batch_hash=SHA256(UTF8(previous)‖UTF8(events_hash))；GENESIS 种子。文档仅一套算法（§10.5）。

### 5.5 备份 / 恢复（MANUAL — 未自动执行）

以下需文件系统集成与运行时 Server，本轮**未**自动执行，如实标 MANUAL，不写成自动化 PASS：
- generation 创建 / hash 校验 / pointer 原子切换 / 切换失败保持旧 generation / Windows current.json rename / JSONL 全段恢复 / assets 恢复 / startupRecovery 成功。

协议已在正文 §21 完整定义（含 POSIX mv 与 NTFS rename 原子性、cut point、外部 manifest 权威）。

### 5.6 命令 fencing / SSE / CSRF / asset 授权（MANUAL — 未自动执行）

需运行时 utilityProcess Server：lease_generation fencing、不可逆点接管、CORRUPTION_DETECTED、SSE epoch resync、CSRF 三层、app://asset 授权链。协议与不变量已在 §10/§11/§14/§15/§19 定义，端到端验收待集成环境，标 PARTIAL。

---

## 6. DDL 清单三工件一致性比对（问题 #4，AUTO — 一致）

从 v2.2 正文机械抽取，与 coverage matrix §2、本报告逐项 diff：

| 类别 | 正文 | coverage matrix §2 | 迁移 SQL（已执行） | 一致 |
|------|------|-------------------|------------------|------|
| CREATE TABLE | 19 | 19 | 19 | ✓（diff 无差异） |
| ALTER ADD COLUMN | 13 | 13 | 13 | ✓ |
| CREATE INDEX | 24 | 24 | 24 | ✓ |
| CREATE TRIGGER | 12 | 12 | 12 | ✓ |
| DROP TRIGGER | 4 | 4 | 4 | ✓ |
| DROP INDEX | 2 | 2 | 2 | ✓ |

`diff` 命令对正文与迁移 SQL 的 CREATE TABLE / ALTER / TRIGGER / INDEX 名称集合逐项比对，输出 "TABLES MATCH / ALTERS MATCH / TRIGGERS MATCH / INDEXES MATCH"，无差异。v2.1 validation report 中"assessment_session 加 business_session_id/assignment_id、training_session 加 business_session_id/assignment_id"的编造条目在 v2.2 已消除——v2.2 assessment_session 实际增量列为 delivery_phase/event_sequence_version/observation_template_id/business_session_id，training_session 仅 business_session_id，与正文 §7.3 完全一致。

---

## 7. 禁止词检查（结构级，非仅计数）

| 禁止词/模式 | 出现 | 状态 |
|-------------|------|------|
| `student_user_id` | 0 | PASS |
| `ws_ticket` | 0 | PASS |
| "继承 v2.1" | 0 | PASS |
| "同旧版本" / "参见 v2.0/v2.0.1/v2.1"（作为实施引用） | 0 | PASS（仅 §0.2 作 SUPERSEDED 声明列名） |
| "未修改部分继续有效" / "其余不变" / "见旧文档" | 0 | PASS |
| "后续补充" / "略" / "MVP 阶段暂不处理" / "MVP 后续再补" | 0 | PASS |
| 学生 Kiosk 使用/订阅 SSE（正向） | 0 | PASS（仅"不订阅/不使用"否定形式） |
| `FINALIZED → OBSERVATION`（作为允许） | 0 | PASS（仅作为禁止项出现） |
| assessment/training session 新增 VOIDED 终态 | 0 | PASS（VOIDED 仅安全事件状态机） |
| 通用 `INSERT OR REPLACE` 领域投影 | 0 | PASS（仅作为"禁止"出现，§10.1/§22.4） |
| localStorage 作为线下评分唯一草稿来源 | 0 | PASS（§18 服务端 offline_score_draft） |
| app://asset 无授权访问 | 0 | PASS（§19 强制授权链） |
| 固定全局 `org_default` | 0（作长期标识） | PASS（仅作"禁止"出现，§3.2） |
| 两套冲突 batch_hash 算法 | 0 | PASS（唯一算法 §10.5） |
| T+5ms/T+20ms/T+100ms 时延承诺 | 0 | PASS（§12.2 已删除） |

## 8. 必需词检查

LEARNING(5), stream_epoch(2), request_hash(8), lease_generation(15), worker_id(7), previous_batch_hash(8), events_hash(11), batch_hash(19), segment_id(9), processed_event(11), READY_TO_FINALIZE(20), CORRUPTION_DETECTED(5), replaces_grant_id(6), identity_confirmation_method(5), CSRF(6), DPAPI(1), VACUUM INTO(3), BrowserWindow.webContents.send(4) — **全部 ≥1，无缺失**。

---

## 9. 未关闭 / PARTIAL 问题（如实保留）

**13 条必关闭问题：全部 CLOSED**（设计 + DDL/合同 + 不变量层面）。其中 #5/#12 的 DDL 与合同已闭合，端到端运行时验收待集成环境。

**coverage matrix 35 个设计领域：CLOSED 24 / PARTIAL 11。** PARTIAL 均因端到端验收依赖运行时 utilityProcess Server 或文件系统集成（fencing 崩溃恢复、SSE/CSRF、备份恢复、asset 授权链运行时执行），本轮只做文档 + SQL/算法级自动验证。这些项**不缺正文设计和数据合同**，仅缺自动化端到端证据，故如实标 PARTIAL，不虚报全 CLOSED。

**已知遗留（非本轮范围）：** v2.2 为目标架构合同；当前代码尚为单进程 + 单事件同步双写，三段式协议/多设备表/learning/asset 授权/offline_score_draft 的实际编码属后续正式迭代，本轮只交付文档与迁移合同，不改代码/schema。

---

## 10. 结论

- v2.2 正文自包含、可独立实施；增量 DDL 在真实 SQLite 3.50.6 执行通过（foreign_key_check 空 + integrity_check ok）。
- 触发器行为 29/29、Grant/Draft 唯一性 4/4、JSONL hash 8/8 全部真实 PASS。
- 三工件 DDL 清单机械比对一致；禁止词 0 命中；必需词全覆盖。
- 13 条必关闭问题在设计与数据合同层面全部 CLOSED；11 个领域的运行时/集成级端到端验收如实标 PARTIAL。
