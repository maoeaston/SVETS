# 炫灿-职途向导系统 MVP

面向特殊教育职业转衔场景的**本地化桌面端**训练工具。

帮助教师为孤独症、心智障碍及其他特殊需要青少年，完成从线上能力测评、结构化训练到线下实操评分的完整教学闭环，并生成可追溯的任务报告。

---

## 当前状态

| 阶段 | 状态 |
|---|---|
| PRD v1.0.9-job-skill-assessment-mvp-closure | ✅ 当前基线 |
| Schema v0.1.12-job-skill-assessment-mvp-closure | ✅ 当前基线 |
| JSON 字段规范 | ✅ 已完成 |
| 事件载荷规范 | ✅ 已完成 |
| Electron 脚手架 | ✅ 已就绪（typecheck + build 通过）|
| 功能开发 | 🚧 进行中（已完成登录、学生档案、策略配置、测评核心闭环、DRAG题拖拽渲染组件）|
| 教学素材 | 🚧 进行中（图片资产链路已接入，视频、步骤卡待制作）|
| 题库审核 | 🚧 进行中（BASE_ABILITY 96题来自 v0.2 xlsx 已导入 DRAFT；JOB_SPECIFIC 298题已导入 DRAFT；待试测后升为 ACTIVE）|

---

## 技术栈

- **桌面框架**：Electron 41 + electron-vite 5
- **前端**：Vue 3 + TypeScript + Vue Router + Pinia
- **数据库**：SQLite（better-sqlite3，WAL 模式）
- **架构**：轻量事件溯源 — `action_log.jsonl` 为事实来源，SQLite 为查询投影

---

## MVP 范围

- 岗位：超市理货员
- 任务：拆箱与上架
- 用户角色：学生 / 教师 / 管理员
- 核心流程：测评 → 四步训练（看学练做）→ 线下实操评分 → 三类结果 → 任务报告
- 平台：Windows 10 / 11，最低分辨率 1366×768，离线运行

---

## 快速开始

**环境要求：** Node.js 20+，npm 10+

```bash
# 安装依赖（国内用镜像）
npm install --registry https://registry.npmmirror.com

# 开发模式（主进程热重载 + 渲染进程 HMR）
npm run dev

# 类型检查
npm run typecheck

# 构建生产包
npm run build

# 运行单元测试
npm test
```

### 开发账号与题库初始化

首次运行或重建数据库后，按以下顺序运行种子脚本：

```bash
# 1. 开发账号（admin / teacher / student）
node scripts/seed-dev-accounts.mjs

# 2. 图片资产（asset_resource）
node scripts/seed-question-bank-image-assets.mjs

# 3. BASE_ABILITY 96题（来自 v0.2 xlsx，权威来源）
node scripts/seed-base-ability-v02.mjs

# 4. JOB_SPECIFIC 298题
sqlite3 ~/.config/xc-career-guide/data/xc-career-guide.db < doc/features/question-bank-import.sql

# 5. DRAG 题（2条，BASE_ABILITY FINE_MOTOR）
node scripts/seed-question-bank-image-drag-questions.mjs
```

> **注：** `doc/reference/通用基础能力评估题库.xlsx`（旧版）和 `doc/features/question-bank-import-base-ability.sql`（旧版产物）已归档，**不要使用**。BASE_ABILITY 唯一权威来源是 `doc/reference/通用基础能力正式测评候选题库_v0.2-软件优先版.xlsx`。

| 用户名 | 密码 | 角色 |
|---|---|---|
| `admin` | `Admin@123` | ADMIN（系统管理员）|
| `teacher` | `Teacher@123` | TEACHER（教师）|
| `student` | `Student@123` | STUDENT（学生）|

---

## 项目结构

```
SVETS/
├── src/
│   ├── main/               # Electron 主进程
│   │   ├── db/             # SQLite 连接 + schema.sql
│   │   ├── domain/         # 领域服务（event-writer 等）
│   │   └── ipc/            # IPC handler 注册入口
│   ├── preload/            # contextBridge 安全桥
│   ├── renderer/           # Vue3 渲染进程
│   │   └── src/
│   │       ├── views/      # 页面组件（Login / Teacher / Student）
│   │       ├── stores/     # Pinia 状态
│   │       └── router/     # 路由配置
│   └── shared/
│       └── types/          # 主进程与渲染进程共享的 TypeScript 类型
├── doc/                    # 所有设计文档（见下方）
├── .claude/commands/       # AI 开发工作流 skill（/vibe-*）
├── AGENTS.md               # AI 助手工作规范（技术约束、开发流程）
└── CLAUDE.md               # 指向 AGENTS.md（@AGENTS.md）
```

---

## 设计文档

| 文档 | 说明 |
|---|---|
| `doc/specs/MVP_PRD_v1.0.9-job-skill-assessment-mvp-closure.md` | 当前产品需求文档（功能范围、验收标准） |
| `src/main/db/schema.sql` | 当前 SQLite schema（表、触发器、状态机、投影约束） |
| `doc/specs/xc-career-guide-json-field-schema-v1.0.0.md` | 各 JSON TEXT 字段的结构定义 |
| `doc/specs/xc-career-guide-event-payload-schema-v1.0.0.md` | 领域事件载荷格式 + action_log.jsonl 规范 |
| `doc/specs/题库分层架构说明.md` | 四层题库设计与 question_role 字段规划 |
| `doc/index.md` | 文档入口索引，说明不同任务应先读哪些文档 |

---

## 核心架构说明

### 事件溯源

所有业务状态变更通过写入 `data/action_log.jsonl` 推进，SQLite 是可重建的查询投影。

```
用户操作
  → 主进程领域服务
  → 写 action_log.jsonl（事实来源，只追加）
  → 写 domain_event_projection（投影）
  → reducer 更新业务表（assessment_session 等）
```

### 安全红线

安全事件（`safety_incident`）是学生+任务级独立聚合，触发后批量熔断同一学生同一任务下所有开放会话，直到管理员完成处理。

### 三类结果（独立计算，不合并）

- `ABILITY_SCORE` — 基础能力测评分（线上 42 题 0/2 自动判分 + 线下 8 题 0/1/2 教师评分）
- `TRAINING_COMPLETION` — 四步训练完成率
- `OPERATION_PASS_RATE` — 拆箱上架任务实操达标率（独立于基础能力线下 8 题）

---

## 开发工作流

本项目采用 Vibe Coding 八步流程，每个新功能必须先生成 PRD 和实现文档再编码。

```
/vibe-feature  <需求描述>   # 上下文分析 + 生成 Mini-PRD
/vibe-impl     <prd路径>    # PRD → 步骤化实现文档 + 测试设计
/vibe-review   <文件路径>   # Reviewer 角色审查
/vibe-accept                # 合并前验收清单
```

详见 `AGENTS.md`（AI 工作规范）和 `.claude/commands/`（skill 定义）。

---

## 仓库

**GitHub：** https://github.com/maoeaston/SVETS
