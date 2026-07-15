# 新会话启动 Prompt（当前模板）

> v0.1.10 → v0.1.12 的 T1-T12 已完成。`impl/` 目录主体是历史实施记录，不再把“待实现”状态复制到新会话。

---开始复制---

你正在维护 **SVETS（炫灿-职途向导系统）**，技术栈为 Electron + Vue3 + TypeScript + SQLite。

请按顺序读取：

1. `AGENTS.md`
2. `.continue-here.md`
3. `doc/specs/MVP_PRD_v1.0.9-authoritative.md`（仅在任务涉及产品范围、结果、题库、评分、报告或验收时读取相关章节）
4. `src/main/db/schema.sql`（仅在任务涉及数据库、状态机或约束时读取）
5. 当前任务对应的 `doc/features/*-prd.md` 与 `*-impl.md`

当前工程事实：

- 产品合同：PRD v1.0.9 consolidated authoritative baseline
- schema：v0.1.14-multi-device-m2-session-foundation
- 多设备 M2 已落地 business_session 父记录、assessment delivery_phase / event_sequence_version / observation_template_id、assessment/training business_session_id 和 D2-D6/D8 约束；Grant/Assignment、learning_session、自动 JSONL 冷启动重放仍未落地
- v0.1.12 的 JOB_SKILL_ASSESSMENT、bank_domain、TEACHER_OBSERVATION、JOB_SKILL_SCORE 已落地
- 历史 PRD 差异版和 `doc/specs/impl/` 中的“待实现”描述只用于追溯，不代表当前代码状态

本次任务：

<!-- 在这里写清具体目标、范围和验收标准。 -->

修改前先核对当前代码和 Git 状态；发现 PRD、schema 与实现不一致时标记 `[!]`，不要按历史目标文档覆盖当前实现。

---结束复制---
