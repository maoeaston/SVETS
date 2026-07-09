# 炫灿-职途向导系统 MVP

**工程基线：** schema v0.1.10-scoring-closure | PRD v1.0.6  
**技术栈：** Electron + Vue3 + TypeScript + SQLite  
**MVP 范围：** 一岗位（超市理货员）| 一任务（拆箱与上架）| 一闭环（测评→训练→评分→报告）

---

## 文件结构

- 主进程：`src/main/` — `db/`（schema + connection）| `domain/`（event-writer 等领域服务）| `ipc/handlers/`
- 渲染进程：`src/renderer/src/` — `views/` | `stores/`（Pinia）| `router/`
- 共享类型：`src/shared/types/` — `event-payloads.ts` | `json-schemas.ts` | `ipc-api.ts`
- 设计文档：`doc/specs/` — PRD | JSON 字段规范 | 事件规范 | 题库架构说明 | `doc/features/` — 功能 Mini-PRD + 实现文档 | `doc/reference/` — 原始素材 | `doc/archive/` — 已归档历史文档
- Skill 命令：`.claude/commands/` — `vibe-feature.md` | `vibe-impl.md` | `vibe-review.md` | `vibe-accept.md`

---

## Do NOT introduce

- ORM 库（TypeORM / Sequelize / Prisma）: 事件溯源架构不适合 ORM，手写 SQL + 触发器更可控
- 前端状态持久化库（vuex-persistedstate 等）: 状态必须从主进程 IPC 同步，前端不持有权威状态
- CSV 解析库（papaparse / csv-parser）: 题库导入是一次性工具，手写解析足够
- Markdown 渲染库（用于报告）: 报告有 `report_content_json` 结构化存储，直接渲染 JSON

---

## 优先使用

- ✅ **better-sqlite3**（同步 SQLite 驱动，主进程专用）
- ✅ **uuid**（事件 ID 生成）
- ✅ **Vue Router**（渲染进程路由）
- ✅ **Pinia**（渲染进程状态管理）
- ✅ **Electron IPC**（主进程 ↔ 渲染进程通信）

### Electron 主进程打包约束
- `src/main/` 内引用本仓库本地模块时必须使用静态 `import`；不要用 `createRequire`、字符串动态 `require()` 或动态路径加载本地 TS 模块，避免 electron-vite 打包后在 `out/main/index.js` 残留无法解析的相对路径。

### 运行库数据运维
- 命令行初始化或修复 `xc-career-guide.db` 时，若普通 Node 环境加载 `better-sqlite3` 出现 ABI 不一致，优先使用 `sqlite3` CLI 执行 `src/main/db/schema.sql` 和导入 SQL；不要为一次性数据运维重装依赖或改项目依赖版本。

---

## 验收标准（17 项功能）

参考 PRD §17，每项功能有明确的输入、预期输出和验证方式。实现任何功能前，先确认对应的验收标准。

---

## 沟通规则

- 用中文回复（除非代码注释和变量命名）
- 说话直接，不奉承。不写"您说得非常对！"之类的开场白
- 不同意时给具体理由；只是直觉的，明确说"这是直觉，未经验证"
- 不知道的技术事实（env var、CLI 参数、API、模型名、包版本）要验证或明确说不知道，不编造
- 任务完成前必须确认：类型检查、linter、相关测试通过；如果项目尚未配置，明确说明，不能假装完成
- 修改代码前先说明影响范围（文件数、是否触及核心状态机）
- 发现 PRD / Schema 不一致时，标记为 [!] 并说明冲突点
- 建议技术方案时，列出至少一个备选方案和权衡

---

## 开发流程

不跳过 PRD 和实现文档直接写代码。

### 标准新功能路径

1. `waza think`（可选）— 有架构方案取舍或"要不要做"时先运行；输出确定方向后再进下一步
2. `/vibe-feature` — 加载 SVETS 上下文，生成 Mini-PRD + 领域 Reviewer 审查，存入 `doc/features/`
3. `/vibe-impl` — PRD → 步骤化实现文档，每步对应一个 commit，含测试设计
4. 逐步实现 — 按 impl.md 执行；每步完成后运行 `/vibe-accept`（typecheck + build + vitest + 领域专项）
5. 推送 — `/vibe-accept` 全通过后运行 `waza check`（ship mode）执行 git 操作；squash merge 到 main

高风险改动（FSM 路径 / safety_incident / schema 变更）在步骤 4 后额外运行 `/vibe-review`。

### 子模型分工（节省 token）

机械性实现步骤（按 impl.md 直接编码、补 type、加路由、写样板 IPC handler）优先用 `model: "haiku"` 子 agent 执行；架构判断、PRD 对齐检查、红线逻辑审计、FSM 路径评审留主循环（Sonnet/Opus）。

判断依据：**纯机械 → haiku；需要约束上下文或跨文件判断 → 主循环。**

**子 agent 产出验证**：子 agent 结束后先用 `git status --porcelain` 核实实际文件变更，再采信任何文字汇报。`tool_uses` 数字明显偏高（>50）且无实际产出时，说明可能陷入重试循环，应切换策略由主循环直接执行，而非重新委托。

### 任务书与工程约束冲突处理

执行 `doc/specs/impl/07-implementation-task-book.md` 或其他设计文档中的任务前，先对照 AGENTS.md + `.claude/rules/` 扫描是否存在更具体的工程约束覆盖该路径（典型案例：任务书写 TS 文件，但 AGENTS.md 明确规定一次性数据运维用 sqlite3 CLI）。发现冲突时用 AskUserQuestion 列方案让用户选，不要默认服从任务书字面写法。

### 实现中遇到问题

| 情况 | 使用 | 规则 |
|------|------|------|
| bug / 回归 | `waza hunt` | 没有一句话根因不动代码；三次假设失败强制 handoff |
| 渲染进程 UI | `waza design` | 方向锁定 + 截图迭代，不猜测视觉效果 |
| 外部文档/研究 | `waza read` / `waza learn` | — |
| AI 配置/文档腐烂 | `waza health` | 每隔数个功能迭代跑一次 |
