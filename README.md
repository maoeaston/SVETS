# 炫灿-职途向导系统 MVP

面向特殊教育职业转衔场景的**本地化桌面端**训练工具。

帮助教师为孤独症、心智障碍及其他特殊需要青少年，完成从线上能力测评、结构化训练到线下实操评分的完整教学闭环，并生成可追溯的任务报告。

---

## 当前状态

| 阶段 | 状态 |
|---|---|
| PRD v1.0.4 | ✅ 已冻结 |
| Schema v0.1.7 | ✅ 已冻结 |
| JSON 字段规范 | ✅ 已完成 |
| 事件载荷规范 | ✅ 已完成 |
| Electron 脚手架 | ✅ 已就绪（typecheck + build 通过）|
| 功能开发 | 🚧 进行中（下一步：登录 + 学生档案）|
| 教学素材 | ⏳ 待制作（视频、步骤卡）|
| 题库审核 | ⏳ 待完成（CSV 已导入为 DRAFT）|

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
| `doc/炫灿-职途向导系统_MVP_PRD_v1.0.4.md` | 产品需求文档（功能范围、验收标准、状态机） |
| `doc/xc-career-guide-mvp-schema-v0.1.7-consistency-guard.sql` | 完整 SQLite schema（20 张表 + 50+ 触发器） |
| `doc/xc-career-guide-json-field-schema-v1.0.0.md` | 各 JSON TEXT 字段的结构定义 |
| `doc/xc-career-guide-event-payload-schema-v1.0.0.md` | 26 个领域事件的载荷格式 + action_log.jsonl 规范 |

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

- `ABILITY_SCORE` — 线上测评得分 / 百分制
- `TRAINING_COMPLETION` — 四步训练完成率
- `OPERATION_PASS_RATE` — 线下实操达标率（0/1/2 评分）

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
