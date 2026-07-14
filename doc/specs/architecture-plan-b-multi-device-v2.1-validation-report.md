# 方案 B 多设备架构 v2.1 — 验证报告

> **配套文档：** architecture-plan-b-multi-device-v2.1-authoritative-baseline.md  
> **验证日期：** 2026-07-14

---

## 1. 实际读取的仓库文件

| 文件 | 读取确认 | 用途 |
|------|----------|------|
| `src/main/db/schema.sql` | 已全文读取 | Schema 基线（v0.1.12-job-skill-assessment-mvp-closure） |
| `doc/specs/architecture-plan-b-multi-device-v2.0-authoritative-baseline.md` | 已全文读取 | v2.0 输入 |
| `doc/specs/architecture-plan-b-multi-device-v2.0.1-schema-alignment.md` | 已全文读取 | v2.0.1 输入 |
| `doc/specs/MVP_PRD_v1.0.9-job-skill-assessment-mvp-closure.md` | 已全文读取 | PRD 基线 |
| `doc/specs/2.1.md` | 已全文读取 | 任务规范 |

---

## 2. 当前 Schema 和 PRD 版本

| 工件 | 版本 | 路径 |
|------|------|------|
| Schema | v0.1.12-job-skill-assessment-mvp-closure | `src/main/db/schema.sql` |
| PRD | v1.0.9 | `doc/specs/MVP_PRD_v1.0.9-job-skill-assessment-mvp-closure.md` |

---

## 3. 必需表名搜索结果

所有 18 张必需表名在 v2.1 文档中均有出现（总计 291 次匹配）。

| 表名 | 出现 | 状态 |
|------|------|------|
| organization | ✓ | §3.2, §6.3 |
| node | ✓ | §3.3, §6.3 |
| device | ✓ | §3.4, §6.3 |
| device_runtime_session | ✓ | §3.5, §6.3 |
| auth_session | ✓ | §3.8, §6.3 |
| delegated_access_grant | ✓ | §3.9, §6.3 |
| business_session | ✓ | §4.1, §6.3 |
| assessment_session | ✓ | §4.2, §6.2, §7 |
| training_session | ✓ | §4.3 |
| learning_session | ✓ | §4.4, §6.3 |
| business_session_assignment | ✓ | §5.1, §6.3 |
| command_log | ✓ | §9.1, §6.3 |
| applied_event_batch | ✓ | §8.4, §6.3 |
| processed_event | ✓ | §8.4, §6.3 |
| projector_cursor | ✓ | §8.4, §6.3 |
| backup_manifest | ✓ | §17.3, §6.3 |
| session_invalidation_record | ✓ | §16.4, §6.3 |
| correction_record | ✓ | §16.5, §6.3 |

---

## 4. 必需关键词搜索结果

| 关键词 | 出现次数 | 状态 |
|--------|----------|------|
| LEARNING | 4 | ✓ |
| stream_epoch | 2 | ✓ |
| request_hash | 4 | ✓ |
| lease_generation | 9 | ✓ |
| worker_id | 3 | ✓ |
| segment_id | 6 | ✓ |
| batch_hash | 8 | ✓ |
| processed_event | 11 | ✓ |
| READY_TO_FINALIZE | 20 | ✓ |
| CORRUPTION_DETECTED | 5 | ✓ |
| replaces_grant_id | 6 | ✓ |
| identity_confirmation_method | 5 | ✓ |
| publication_status | 7 | ✓ |
| student_visible | 3 | ✓ |
| VACUUM INTO | 3 | ✓ |
| DPAPI | 1 | ✓ |
| CSRF | 6 | ✓ |
| BrowserWindow.webContents.send | 3 | ✓ |

---

## 5. 禁止词搜索结果

| 禁止词/模式 | 出现次数 | 状态 |
|-------------|----------|------|
| `student_user_id` | 0 | ✓ PASS |
| `ws_ticket` | 0 | ✓ PASS |
| "继承 v2.0" | 0 | ✓ PASS |
| "同 v2.0.1" | 0 | ✓ PASS |
| "见旧文档" | 0 | ✓ PASS |
| "其余不变" | 0 | ✓ PASS |
| "MVP 后续再补" | 0 | ✓ PASS |
| 学生 Kiosk 订阅 SSE | 0（仅否定形式） | ✓ PASS |
| `FINALIZED → OBSERVATION` | 0 | ✓ PASS |
| session 状态 `VOIDED` | 0（VOIDED 仅用于安全事件状态机） | ✓ PASS |
| `INSERT OR REPLACE` 作为通用投影策略 | 0 | ✓ PASS |

---

## 6. Schema 增量完整性核对

### 6.1 现有表增量（ALTER TABLE）

| 现有表 | 新增列 | v2.1 位置 |
|--------|--------|-----------|
| student_profile | user_id (FK → user_account) | §6.2 #1 |
| assessment_session | delivery_phase, business_session_id, assignment_id | §6.2 #2 |
| training_session | business_session_id, assignment_id | §6.2 #3 |

### 6.2 新增表（CREATE TABLE）

| # | 表名 | 对应 v2.0 | v2.0.1 修订 | v2.1 DDL 位置 |
|---|------|-----------|-------------|---------------|
| T1 | organization | ✓ | — | §6.3 |
| T2 | node | ✓ | — | §6.3 |
| T3 | device | ✓ | 简化（已恢复完整） | §6.3 |
| T4 | device_runtime_session | ✓ | 遗漏（已恢复） | §6.3 |
| T5 | auth_session | ✓ | 简化（已恢复完整） | §6.3 |
| T6 | delegated_access_grant | ✓ | 修正 FK + 身份确认 | §6.3 |
| T7 | business_session | ✓ | 修正 CHECK（已恢复 LEARNING） | §6.3 |
| T8 | business_session_assignment | ✓ | 修正 FK 方向 | §6.3 |
| T9 | learning_session | 遗漏 DDL | 未提及 | §6.3 |
| T10 | learning_progress | 遗漏 DDL | 未提及 | §6.3 |
| T11 | command_log | ✓ | 错误 ALTER（已修正为 CREATE） | §6.3 |
| T12 | applied_event_batch | ✓ | 简化（已恢复完整） | §6.3 |
| T13 | processed_event | ✓ | 遗漏（已恢复） | §6.3 |
| T14 | projector_cursor | ✓ | 简化（已恢复完整） | §6.3 |
| T15 | backup_manifest | ✓ | 遗漏（已恢复） | §6.3 |
| T16 | session_invalidation_record | — | ✓（替代 VOIDED） | §6.3 |
| T17 | correction_record | — | 提及无 DDL | §6.3 |

---

## 7. v2.0 / v2.0.1 遗漏恢复情况

| v2.0.1 遗漏/错误 | 恢复状态 | v2.1 处理 |
|------------------|----------|-----------|
| LEARNING 类型被删除 | ✓ 已恢复 | business_session CHECK 含 LEARNING |
| device_runtime_session 表遗漏 | ✓ 已恢复 | 完整 CREATE TABLE |
| processed_event 表遗漏 | ✓ 已恢复 | 完整 CREATE TABLE |
| backup_manifest 表遗漏 | ✓ 已恢复 | 完整 CREATE TABLE |
| command_log 错误用 ALTER 而非 CREATE | ✓ 已修正 | 完整 CREATE TABLE |
| device 简化（丢失 trust/credential） | ✓ 已恢复 | 含 trust_state/credential_fingerprint |
| auth_session 简化 | ✓ 已恢复 | 含 refresh_token/capabilities_json |
| applied_event_batch 简化 | ✓ 已恢复 | 含 segment_id/command_id/batch_hash |
| projector_cursor 简化 | ✓ 已恢复 | 含 last_batch_id |
| delivery_phase 触发器仅覆盖后半段 | ✓ 已修正 | 完整覆盖全部迁移 |
| 安全事件错误声称仅投影器执行 | ✓ 已修正 | 明确 AFTER INSERT 触发器 |
| Grant 循环 FK（assignment_id） | ✓ 已修正 | 单向 FK: Assignment → Grant |

---

## 8. 未关闭问题

**无。** 所有 28 个设计领域均为 CLOSED 状态。

---

## 9. 文档完整性统计

| 指标 | 数值 |
|------|------|
| v2.1 总行数 | ~2181 |
| 章节数 | 18 + 附录 |
| 新增表 DDL | 17 |
| ALTER TABLE | 3 组 |
| 触发器定义 | 2（delivery_phase 完整 + batch-halt 不修改声明） |
| 验收用例 | 35+ |
| 覆盖矩阵领域 | 28 |
| CLOSED | 28/28 |
| PARTIAL | 0/28 |
