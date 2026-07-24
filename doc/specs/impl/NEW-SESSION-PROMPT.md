# 新会话启动 Prompt（当前模板）

> 当前以 Pilot R0 基础底座开发为主线推进；跨会话进度一律以 `.continue-here.md` 为准。`impl/` 目录主体是历史实施记录，不再把“待实现”状态复制到新会话。

---开始复制---

你正在维护 **SVETS（炫灿-职途向导系统）**，技术栈为 Electron + Vue3 + TypeScript + SQLite。

请按顺序读取：

1. `AGENTS.md`
2. `doc/会话启动.md`
3. `.continue-here.md`，并分别复述 `Project Direction`、`Current Milestone`、`Next Action` 和 `Milestone Queue`
4. `.continue-here.md` 的 `Relevant Files`（把它们当成当前任务真正必读文件集）
5. `doc/specs/MVP_PRD_v1.0.9-authoritative.md`（仅在任务涉及产品范围、结果、题库、评分、报告或验收时读取相关章节）
6. `src/main/db/schema.sql`（仅在任务涉及数据库、状态机或约束时读取）
7. 当前任务对应的 `doc/features/*-prd.md` 与 `*-impl.md`

当前工程事实：

- 产品合同：PRD v1.0.9 consolidated authoritative baseline
- 项目方向：Pilot R0 是阶段收口，不是项目终点；后续目标是 Full Product 1.0，AI 自动评分和 AI 岗位推荐是 1.0 必选能力
- 权威边界：`doc/specs/FULL_PRODUCT_PRD_v2.0-draft.md` 仍是待修订草案，`doc/features/full-product-1.0-planning-review-2026-07-18.md` 仅是审查快照；不得把两者静默当成已批准产品合同
- schema：v0.1.15-multi-device-m3-grant-assignment
- 多设备 M2 已落地 business_session 父记录、assessment delivery_phase / event_sequence_version / observation_template_id、assessment/training business_session_id 和 D2-D6/D8 约束；M3 已落地本地 Grant/Assignment 最小闭环、D1、D9-D11 和 assignment:* IPC；learning_session、M5 command_log/REST/SSE、自动 JSONL 冷启动重放仍未落地
- v0.1.12 的 JOB_SKILL_ASSESSMENT、bank_domain、TEACHER_OBSERVATION、JOB_SKILL_SCORE 已落地
- 历史 PRD 差异版和 `doc/specs/impl/` 中的“待实现”描述只用于追溯，不代表当前代码状态

本次任务：

<!-- 在这里写清具体目标、范围和验收标准。 -->

不得把本次原子任务误写成整个项目的终点；任务完成时必须保留 `.continue-here.md` 中的项目总目标和后续里程碑。

修改前先核对当前代码和 Git 状态；发现 PRD、schema 与实现不一致时标记 `[!]`，不要按历史目标文档覆盖当前实现。

---结束复制---
