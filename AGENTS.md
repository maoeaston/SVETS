# 炫灿-职途向导系统 MVP

**工程基线：** schema v0.1.17-multi-device-m4-safety-rekey（ACCEPTED_STEP_2A） | PRD v1.0.9 authoritative
**技术栈：** Electron + Vue3 + TypeScript + SQLite  
**MVP 范围：** 一岗位（超市理货员）| 一任务（拆箱与上架）| 两条测评路径（BASE_ABILITY / JOB_SKILL）| 一闭环（测评→训练→评分→报告）

---

## 文件结构

- 主进程：`src/main/` — `db/`（schema + connection）| `domain/`（event-writer 等领域服务）| `ipc/handlers/`
- 渲染进程：`src/renderer/src/` — `views/` | `stores/`（Pinia）| `router/`
- 共享类型：`src/shared/types/` — `event-payloads.ts` | `json-schemas.ts` | `ipc-api.ts`
- 设计文档：`doc/specs/` — PRD | JSON 字段规范 | 事件规范 | 题库架构说明 | `doc/features/` — 功能 Mini-PRD + 实现文档 | `doc/reference/` — 原始素材
- 当前唯一产品合同：`doc/specs/MVP_PRD_v1.0.9-authoritative.md`；v1.0.6～v1.0.9 差异版只用于历史追溯

---

## Do NOT introduce

- ORM 库（TypeORM / Sequelize / Prisma）: 事件溯源架构不适合 ORM
- 前端状态持久化库（vuex-persistedstate 等）: 状态必须从主进程 IPC 同步
- CSV 解析库（papaparse / csv-parser）: 题库导入是一次性工具
- Markdown 渲染库（用于报告）: 报告用 `report_content_json` 直接渲染

## 优先使用

- better-sqlite3（同步 SQLite 驱动，主进程专用）
- uuid（事件 ID 生成）
- Vue Router / Pinia / Electron IPC

### Electron 主进程打包约束

`src/main/` 内引用本仓库本地模块时必须使用静态 `import`；不要用 `createRequire`、动态 `require()` 或动态路径加载本地 TS 模块。

### 运行库数据运维

命令行初始化或修复 `xc-career-guide.db` 时，若 `better-sqlite3` 出现 ABI 不一致，优先使用 `sqlite3` CLI 执行 schema.sql；不要为一次性运维改依赖版本。

### 文档索引同步

新增、移动、重命名或归档 `doc/` 下的文档后，运行 `npm run docs:index:update` 更新 `doc/index.md` 的自动清单，再运行 `npm run docs:index:check`。自动清单标记区块不得手工编辑；阅读顺序和权威性说明仍由 `doc/index.md` 的人工导航部分维护。

### 人工审核产物

面向教师、职教专家等非技术审核人的逐题审核包，默认使用自包含 HTML 作为填写入口，提供自动保存、必填校验和提交导出。JSON 是机器可读的权威审核结果，Markdown 只作为由 JSON 生成的人类可读留档。审核页提交不得直接激活题目、修改策略或覆盖历史 manifest。

## Vibe Coding 工作流

本项目同时使用 Claude Code 和 Codex。

### 唯一工作流正文

- `vibe-coding-skills-v2/commands/vibe-feature.md`
- `vibe-coding-skills-v2/commands/vibe-impl.md`
- `vibe-coding-skills-v2/commands/vibe-review.md`
- `vibe-coding-skills-v2/commands/vibe-accept.md`

Claude Code 的 `.claude/commands/` 和 Codex 的 `.agents/skills/` 仅作为运行适配入口，不是工作流正文的第二事实来源。

### 共享约束

- 当前权威基线：`doc/specs/baseline.yaml`
- 项目不变量：`doc/specs/project-invariants.md`
- 工作流协议：`doc/ai/vibe-workflow-contract.md`

执行任何 Vibe Coding 工作流前，必须读取上述当前文件。

不得根据文件名猜测当前权威 PRD、Schema 或数据合同。
不得在多个 Skill 中复制项目不变量全文。
不得把未实际执行的检查声明为通过。

### 工作流选择

- 新功能定义、范围和 Mini-PRD：`vibe-feature`
- PRD 转步骤化实现计划：`vibe-impl`
- PRD、计划、代码或 diff 独立审查：`vibe-review`
- 实现步骤或合并前验收：`vibe-accept`

---

## 验收标准

参考 PRD §17，每项功能有明确的输入、预期输出和验证方式。实现前先确认对应标准。

---

## 沟通规则

- 中文回复（除代码注释和变量命名）
- 面向用户解释业务进展时，先用普通话说明“现在做到哪、为什么退回、下一步做什么”，再补文件名或技术细节；避免只用 hash、门禁、合同、DRAFT 等专业词。
- 不奉承，不同意时给具体理由
- 不知道的技术事实要验证，不编造
- 完成前必须确认：类型检查、linter、相关测试通过
- 涉及文档增删或移动时，必须确认 `npm run docs:index:check` 通过
- 修改代码前先说明影响范围
- 发现 PRD / Schema 不一致时，标记 [!] 并说明冲突点
