# 新会话启动 Prompt（学校演示体验收口）

> 跨会话进度以 `.continue-here.md` 为准。本 Prompt 只承接下一条报告展示层原子动作，不把它扩大成整轮产品交付。

---开始复制---

你正在维护 **SVETS（炫灿-职途向导系统）**，技术栈为 Electron + Vue3 + TypeScript + SQLite。

请先按顺序读取：

1. `AGENTS.md`
2. `doc/会话启动.md`
3. `.continue-here.md`，复述 `Project Direction`、`Current Milestone`、`Next Action` 和 `Milestone Queue`
4. `doc/specs/baseline.yaml`、`doc/specs/project-invariants.md`、`doc/ai/vibe-workflow-contract.md`
5. `doc/features/school-demo-first-online-activation-prd.md` 与 `doc/features/school-demo-first-online-activation-impl.md`
6. 下一动作直接涉及的报告展示文件和测试

当前已确认事实：

- 学校演示闭环已通过临时数据库和 Electron E2E：在线激活 → 教师查看 JOB_SKILL 题库 → 学生完成 18 道线上题 → 教师完成 6 道线下评分 → 生成有效报告。
- 题库数量为 JOB_SPECIFIC 全部 298 道、当前使用 24 道、待审核 274 道；preview registry 仍为 `INSTALLING`，不需要 promotion 才能进行学校演示。
- 当前 Schema 基线为 `v0.1.19-job-skill-preview-contract-v1`；默认数据库没有访问或写入，不能把隔离临时库证据解释成生产 `READY`。
- 机器枚举和报告 JSON 是稳定合同。`SUPERMARKET_SHELVER`、`LEVEL_COMPETENT` 等值必须保留在主进程、事件和持久化数据中；本次只改 renderer/shared presentation 的用户可见中文。

本次唯一原子动作：

1. 检查 `src/shared/report-presentation.ts`、`src/renderer/src/components/report/report-page-state.ts`、报告 store/view 及相关测试，列出学校用户可见的岗位、能力等级、报告状态、版本/修订和合同校验词。
2. 将这些展示词映射为清楚的中文，例如“超市理货员”“达到要求/需要加强/未达标”“内容校验”“报告版本”；不要修改底层枚举、Schema、`report_content_json`、事件载荷或历史复现语义。
3. 保持报告列表、详情、导出和异常状态的语义一致；为新增映射补定向测试。
4. 运行 `npm run typecheck`、`npm run lint`、相关报告测试和 `npm run build`；如修改 `doc/`，再运行 `npm run docs:index:check`。

约束：

- 不访问、初始化、promotion 或修改默认数据库。
- 不激活题目、不改策略、不覆盖题库审核结果，不把 24 道误写成题库总量。
- 不把 `PREVIEW_CONTRACT_V1` 的隔离 parity/native harness 写成全局 `READY`。
- 发现 PRD、Schema、代码或报告快照不一致时标记 `[!]` 并停止扩大范围。
- 完成当前原子动作后更新 `.continue-here.md`，写明实际验证结果和下一条原子动作；不要顺手实现题库入口、学生页或高级设置。

---结束复制---
