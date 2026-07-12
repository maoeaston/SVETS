# 炫灿-职途向导系统 MVP

**工程基线：** schema v0.1.12-job-skill-assessment-mvp-closure | PRD v1.0.9  
**技术栈：** Electron + Vue3 + TypeScript + SQLite  
**MVP 范围：** 一岗位（超市理货员）| 一任务（拆箱与上架）| 一闭环（测评→训练→评分→报告）

---

## 文件结构

- 主进程：`src/main/` — `db/`（schema + connection）| `domain/`（event-writer 等领域服务）| `ipc/handlers/`
- 渲染进程：`src/renderer/src/` — `views/` | `stores/`（Pinia）| `router/`
- 共享类型：`src/shared/types/` — `event-payloads.ts` | `json-schemas.ts` | `ipc-api.ts`
- 设计文档：`doc/specs/` — PRD | JSON 字段规范 | 事件规范 | 题库架构说明 | `doc/features/` — 功能 Mini-PRD + 实现文档 | `doc/reference/` — 原始素材

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

---

## 验收标准

参考 PRD §17，每项功能有明确的输入、预期输出和验证方式。实现前先确认对应标准。

---

## 沟通规则

- 中文回复（除代码注释和变量命名）
- 不奉承，不同意时给具体理由
- 不知道的技术事实要验证，不编造
- 完成前必须确认：类型检查、linter、相关测试通过
- 修改代码前先说明影响范围
- 发现 PRD / Schema 不一致时，标记 [!] 并说明冲突点
