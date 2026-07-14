# 炫灿-职途向导系统 MVP

面向特殊教育职业转衔场景的**本地化桌面端**训练工具。

帮助教师为孤独症、心智障碍及其他特殊需要青少年，完成从线上能力测评、结构化训练到线下实操评分的完整教学闭环，并生成可追溯的任务报告。

---

## 当前状态

| 阶段 | 状态 |
|---|---|
| PRD v1.0.9 consolidated authoritative baseline | ✅ 当前唯一产品合同 |
| Schema v0.1.13-multi-device-m1-identity | ✅ 当前工程基线（MVP 功能合同由 v0.1.12 承载） |
| JSON 字段规范 | ✅ 已完成 |
| 事件载荷规范 | ✅ 已完成 |
| Electron 脚手架 | ✅ 已就绪（typecheck + build 通过）|
| 功能开发 | 🚧 进行中（已完成登录、学生档案、策略配置、基础能力测评、专业岗位固定卷/评分/观察/结果/报告核心链路、DRAG 渲染）|
| 教学素材 | 🚧 进行中（237 条视觉资产合同已落地，当前 0 条 approved；待先制作 R1-R6）|
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
- 核心流程：基础能力或专业岗位测评 → 四步训练（看学练做）→ 线下实操评分 → 四类独立结果投影 → 对应报告
- 平台：Windows 10 / 11，最低分辨率 1366×768，离线运行

---

## 快速开始

**环境要求：** Node.js 20+，npm 10+，sqlite3 CLI

```bash
# 安装依赖（国内用镜像）
npm install --registry https://registry.npmmirror.com

# 首次在一台开发机上建立统一开发库（执行前关闭 Electron）
npm run db:sync -- --reset

# 验证 schema、账号、394 条题库与 approved 资产投影
npm run db:verify

# 开发模式（主进程热重载 + 渲染进程 HMR）
npm run dev

# 类型检查
npm run typecheck

# 构建生产包
npm run build

# 运行单元测试
npm test
```

### 多开发机数据库同步

SQLite 运行库位于 Electron `userData`，不在 Git 仓库内。A/B/C 三台机器轮流开发时，统一使用以下流程：

```bash
# 每次换机或拉取代码后；执行期间必须关闭 Electron
git pull
npm run db:sync
npm run db:verify
npm run dev
```

`db:sync` 幂等同步当前 schema、共享开发账号、BASE_ABILITY 96 题、JOB_SPECIFIC 298 题，以及 Manifest 中已 `approved` 的资产。当前开发库无需保留业务数据时，首次在每台机器执行 `npm run db:sync -- --reset`；命令会先在 `data/backups/pre-reset.*` 中保存 SQLite 一致性快照和现有 `action_log.jsonl`，再重建本地运行数据。

> 不要用 Git、OneDrive 或 Syncthing 同步正在使用的 `.db` / `-wal` / `-shm` 文件。`--reset` 会清除当前运行库和 action log，只能在 Electron 已关闭且确认无需保留本地业务数据时使用。完整 SOP 见 `doc/features/local-database-sync-sop.md`。

> **题库来源：** `doc/reference/通用基础能力评估题库.xlsx`（旧版）和 `doc/features/archive/legacy-data/question-bank-import-base-ability.sql`（旧版产物）已归档，**不要使用**。BASE_ABILITY 唯一权威来源是 `doc/reference/通用基础能力正式测评候选题库_v0.2-软件优先版.xlsx`。
>
> 视觉资产以 `doc/reference/visual-asset-master-plan.md` 为风格基线、`doc/assets/asset-manifest.json` 为机器合同。`db:sync` 只会把 `lifecycle_status='approved'` 且通过文件、版权和验收门校验的资产写成 `ACTIVE`；当前 237 条资产均为 `planned`，所以 approved 投影数为 0。

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
| `doc/specs/MVP_PRD_v1.0.9-authoritative.md` | 当前唯一产品需求合同（完整功能范围、数据合同、验收标准） |
| `src/main/db/schema.sql` | 当前 SQLite schema（表、触发器、状态机、投影约束） |
| `doc/specs/xc-career-guide-json-field-schema-v1.0.0.md` | 各 JSON TEXT 字段的结构定义 |
| `doc/specs/xc-career-guide-event-payload-schema-v1.0.0.md` | 领域事件载荷格式 + action_log.jsonl 规范 |
| `doc/specs/题库分层架构说明.md` | 四层题库设计与 question_role 字段规划 |
| `doc/reference/visual-asset-master-plan.md` | 视觉风格、资产范围、生产与审核规则唯一规划基线 |
| `doc/assets/asset-manifest.json` | 231 个交付项 + 6 个参考资产的机器执行合同 |
| `doc/features/visual-asset-video-production-sop.md` | Seedance 视频生产、抽选和验收 SOP |
| `doc/features/visual-asset-prompt-compilation-session-guide.md` | 逐资产 Prompt 编译的新会话启动与复核模板 |
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
