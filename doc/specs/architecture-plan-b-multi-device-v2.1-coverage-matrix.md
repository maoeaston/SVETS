> **⚠️ 文档状态：SUPERSEDED（已废止）**
> 本文档已被 `architecture-plan-b-multi-device-v2.2-authoritative-baseline.md`（v2.2 唯一权威基线）取代，不再作为实施依据。
> 实施人员只阅读：当前正式 Schema（`src/main/db/schema.sql`）+ 当前正式 PRD（`MVP_PRD_v1.0.9-*.md`）+ v2.2 三份工件。

# 方案 B 多设备架构 v2.1 — 覆盖矩阵

> **配套文档：** architecture-plan-b-multi-device-v2.1-authoritative-baseline.md  
> **生成日期：** 2026-07-14

---

## 合并决策矩阵

| # | 设计领域 | 当前正式实现 (v0.1.12) | v2.0 设计 | v2.0.1 修订 | v2.1 最终决策 | 最终章节 | DDL 位置 | 验收用例 | 状态 |
|---|----------|----------------------|-----------|-------------|--------------|----------|----------|----------|------|
| 1 | organization | 不存在 | CREATE TABLE (含 type/status) | 未提及（继承 v2.0） | 保留，新增 | §3.2 | §6.3 T1 | M-01 | CLOSED |
| 2 | node | 不存在 | CREATE TABLE (含 node_type/status) | 未提及 | 保留，新增 | §3.3 | §6.3 T2 | M-01 | CLOSED |
| 3 | device | 不存在 | CREATE TABLE (含 trust_state/capabilities) | 简化版（无 credential/trust） | 采用 v2.0 完整版 | §3.4 | §6.3 T3 | M-01 | CLOSED |
| 4 | device_runtime_session | 不存在 | CREATE TABLE (含 heartbeat/end_reason) | 未提供 DDL（遗漏） | 保留 v2.0 版，Grant rebind 依赖它 | §3.5 | §6.3 T4 | D-01 | CLOSED |
| 5 | auth_session | 不存在 | CREATE TABLE (含 token/refresh/capabilities) | 简化版（少字段） | 采用 v2.0 完整版 | §3.8 | §6.3 T5 | M-01 | CLOSED |
| 6 | delegated_access_grant | 不存在 | CREATE TABLE (含 assignment_id FK 循环) | 修正：移除 assignment_id，改用 student_id FK | 采用 v2.0.1 修正方向 + v2.0 身份确认字段 + device_runtime_session_id | §3.9 | §6.3 T6 | D-04/D-05 | CLOSED |
| 7 | business_session | 不存在 | CREATE TABLE (含 status 列, LEARNING 类型) | 修正：移除 status，仅 ASSESSMENT/TRAINING | 移除 status（正确）+ 恢复 LEARNING 类型 | §4.1 | §6.3 T7 | D-08 | CLOSED |
| 8 | assessment_session | 完整表 (30+字段, 8 触发器) | 重新定义简化版（错误） | 修正：ALTER TABLE 增量 | 增量 ALTER TABLE（3 列）+ 1 触发器 | §4.2, §7 | §6.2, §7.4 | M-02/M-06 | CLOSED |
| 9 | training_session | 完整表 (20+字段, 6 触发器) | 未重新定义 | 未修改 | 保留原样 | §4.3 | — | M-02 | CLOSED |
| 10 | learning_session | 不存在 | 仅提及名称（无 DDL） | 未提及（LEARNING 被删除） | 新增完整 DDL | §4.4 | §6.3 T9/T10 | D-08 | CLOSED |
| 11 | business_session_assignment | 不存在 | CREATE TABLE (含 release_reason/replaces) | 修正：grant_id FK（单向） | 采用 v2.0.1 FK 方向 + v2.0 完整字段 | §5.1 | §6.3 T8 | D-02/D-03 | CLOSED |
| 12 | command_log | 不存在 | CREATE TABLE 完整 | ALTER TABLE 4 列（错误：基表不存在） | 以 v2.0 CREATE TABLE 为基础，合入 v2.0.1 字段 | §9.1 | §6.3 T11 | J-01/J-08 | CLOSED |
| 13 | applied_event_batch | 不存在 | CREATE TABLE (含 segment_id/command_id/batch_hash) | 简化版（少 segment_id/command_id/batch_hash） | 采用 v2.0 完整版 | §8.4 | §6.3 T12 | J-04/J-05 | CLOSED |
| 14 | processed_event | 不存在 | CREATE TABLE (event_id PK + batch FK) | 未提供 DDL（遗漏） | 保留 v2.0 版 + 新增 aggregate 字段 | §8.4 | §6.3 T13 | J-06 | CLOSED |
| 15 | projector_cursor | 不存在 | CREATE TABLE (含 last_batch_id/sequence) | 简化版（少 last_batch_id） | 采用 v2.0 完整版 | §8.4 | §6.3 T14 | J-04 | CLOSED |
| 16 | backup_manifest | 不存在 | CREATE TABLE (含 cut point/segments/assets) | 未提供 DDL（遗漏） | 保留 v2.0 版 | §17.3 | §6.3 T15 | B-01 | CLOSED |
| 17 | session_invalidation_record | 不存在 | 未提及 | CREATE TABLE (替代 VOIDED) | 采用 v2.0.1 版 + 新增 session_type | §16.4 | §6.3 T16 | M-01 | CLOSED |
| 18 | correction_record | 不存在 | 提及名称（无 DDL） | 未提供 DDL | 新增完整 DDL | §16.5 | §6.3 T17 | M-01 | CLOSED |
| 19 | student_profile ↔ user_account | 分离（无 FK） | student_user_id FK → user_account | 修正：student_profile.user_id nullable FK | 采用 v2.0.1 方案 | §3.7 | §6.2 #1 | M-01 | CLOSED |
| 20 | JSONL segment/index/hash chain | 代码中仅单文件 action_log.jsonl | 完整协议（segment/index/hash） | 分类表（rebuildable vs not） | 合并 v2.0 协议 + v2.0.1 分类 | §8.5/§8.6 | — | J-07 | CLOSED |
| 21 | CA / leaf certificate | 不存在 | 完整方案（ECDSA/mDNS/SAN） | 修正：HTTP 7070 bootstrap | 合并 v2.0 证书体系 + v2.0.1 端口修正 | §13 | — | W-05/W-07 | CLOSED |
| 22 | SSE / IPC / REST | 代码中仅 IPC | 完整方案（SSE+REST+IPC） | 内联可见性规则 | 合并 v2.0 协议 + v2.0.1 可见性 | §11 | — | W-03/W-04 | CLOSED |
| 23 | student visibility/publication | 不存在 | 提及（defer to v1.1） | 内联规则（§10） | 完整内联 + 新增 DDL 列 | §14 | §14.2 | W-04 | CLOSED |
| 24 | asset/resource service | asset_resource 表存在 | 提及资源服务 | 未详细定义 | 完整定义访问方式和约束 | §15 | — | B-04 | CLOSED |
| 25 | safety incident | 完整表 + 10 触发器 | 描述触发器行为（正确） | 错误声称只有投影器执行 halt | 以 schema 为准：AFTER INSERT 触发器执行 | §10 | 不修改 | S-01~S-07 | CLOSED |
| 26 | report versioning/correction | task_report 表存在 | 提及 correction（无 DDL） | 未详细定义 | 完整定义 correction_record + supersession | §16 | §6.3 T17 | M-05 | CLOSED |
| 27 | backup/restore generation pointer | 不存在 | VACUUM INTO + 备份协议 | 版本化目录 + 原子切换 | 合并：v2.0 协议 + v2.0.1 目录结构 | §17 | — | B-01~B-08 | CLOSED |
| 28 | delivery_phase 状态机 | 不存在 | 完整枚举 + 部分触发器 | 触发器仅覆盖后半段 | 完整触发器覆盖全部迁移 | §7 | §7.4 | M-06 | CLOSED |

---

## 统计

- **总计 28 个设计领域**
- **CLOSED: 28**
- **PARTIAL: 0**
- **全部具备：正文设计 + DDL/数据合同 + 状态不变量 + 验收用例**
