# 炫灿-职途向导系统 MVP

**工程基线：** schema v0.1.7-consistency-guard | PRD v1.0.4  
**技术栈：** Electron + Vue3 + TypeScript + SQLite  
**MVP 范围：** 一岗位（超市理货员）| 一任务（拆箱与上架）| 一闭环（测评→训练→评分→报告）

---

## 架构原则

### 事件溯源 + SQLite 投影
- `action_log.jsonl` 是唯一事实来源，只追加、不修改
- SQLite 是查询投影，可删除重建
- 所有状态变更必须先写事件、再更新投影
- 冷启动时从 JSONL 回放事件重建 SQLite

### 单一策略配置源
- `strategy_config` 表是组卷、评分、红线规则的唯一定义
- `version` 字段不可变，修改即新增版本
- 会话创建时锁定 `strategy_id` + `version`，运行中不得切换

### 安全红线优先级
- `LEVEL_FAIL_BY_SAFETY` 覆盖所有基于分数的等级判定
- 红线触发后，会话立即进入 `REDLINE_HALTED` 终态，不可恢复
- 触发器在数据库层强制执行，应用层不得绕过

---

## 文件结构

- 主进程：`src/main/` — `db/`（schema + connection）| `domain/`（event-writer 等领域服务）| `ipc/handlers/`
- 渲染进程：`src/renderer/src/` — `views/` | `stores/`（Pinia）| `router/`
- 共享类型：`src/shared/types/` — `event-payloads.ts` | `json-schemas.ts` | `ipc-api.ts`
- 设计文档：`doc/` — PRD | schema SQL | JSON 字段规范 | 事件规范 | 功能 Mini-PRD（`doc/features/`）
- Skill 命令：`.claude/commands/` — `vibe-feature.md` | `vibe-impl.md` | `vibe-review.md` | `vibe-accept.md`

---

## 关键约束

### JSON 字段必须验证
- 写入任何 JSON TEXT 字段前，必须按 `doc/xc-career-guide-json-field-schema-v1.0.0.md` 验证结构
- `content_json` 的 `question_type` 必须与 `question_bank.question_type` 一致
- `scoring_policy_json` 的 `pass_threshold > improve_threshold` 必须满足
- 所有 `asset_id` 引用必须存在于 `asset_resource` 且 `status = 'ACTIVE'`

### 事件写入顺序（不可颠倒）
1. 生成 payload
2. 计算 checksum: `SHA-256(JSON.stringify(payload))`
3. 分配 event_id (UUID v4) 和 event_sequence (aggregate 内递增)
4. 追加写入 `action_log.jsonl`（文件锁）
5. 写入 `domain_event_projection`
6. 调用 reducer 更新投影表

### 状态机强制路径
- `assessment_session.status`:
  - `INIT` → `ACTIVE` → `COMPLETED` / `ABORTED` / `REDLINE_HALTED`
  - `EMOTION_INTERRUPTED` 可从 `ACTIVE` 进入，恢复后回到 `ACTIVE`
  - 终态（`COMPLETED` / `ABORTED` / `REDLINE_HALTED`）不可转出
- 触发器在 DB 层阻止非法迁移，应用层不应尝试绕过

### 结果分离展示（不可合并）
- `ABILITY_SCORE` - 能力测评分（百分制 + 等级）
- `TRAINING_COMPLETION` - 训练完成度（完成率百分比）
- `OPERATION_PASS_RATE` - 实操达标率（各维度 0/1/2 分）
- 三者独立计算、独立展示，禁止合成"总分"

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

---

## 测试策略

### 单元测试（Vitest）
- 事件 checksum 计算
- JSON Schema 验证函数
- 组卷算法（策略 → 题目列表）
- 评分计算逻辑

### 集成测试
- 完整事件写入 → 投影 → 回放流程
- 红线触发 → 批量熔断 → 状态验证
- 报告生成 → 导出 → 锁定

### 端到端测试（手工验收）
- 教师创建测评 → 学生答题 → 线下评分 → 报告查看
- 情绪中断 → 恢复 → 继续答题
- 安全红线触发 → 会话强制终止 → 安全事件记录

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

## 编码规范

- 实现前先明确假设；有多种合理解读时，列出选项，不要静默选择
- 写解决问题所需的最少代码，不做投机性功能、不为一次性代码建抽象
- 只改任务要求改的地方；不"顺手优化"相邻代码、注释或格式
- 沿用文件中已有的风格，即使你会选择不同的写法
- 发现不相关的死代码或 bug，指出但不私自修复
- 重命名函数、类型、变量时，分别搜索：直接引用、类型层引用、字符串字面量、动态导入、re-export、测试文件，一次 grep 不够

## Git 规范

- 提交信息使用语义化前缀（feat / fix / refactor / chore / docs / test）
- 禁止使用 `--no-verify` 绕过 pre-commit hook，除非用户明确要求
- 禁止直接推送到 main 分支，始终推送到功能分支

## Secrets 规范

- 禁止在代码中硬编码 API key、token、密码或连接字符串
- 提交前扫描暂存内容是否含有凭证；发现即停止并提醒
- Secrets 存放在 `.env` 文件中，`.env` 必须在 `.gitignore` 内

## 自我改进

- 当用户纠正、反驳、表达不满，或本次任务暴露可复用教训时，完成任务后提出一条精简规则更新建议
- 先判断作用域：全局（适用所有项目）、项目（仅本仓库）或不沉淀（一次性）；说明判断理由
- 提出 diff，等用户确认后再改；提案前先检索 AGENTS.md 中是否已有覆盖此规则的条目
- 单次会话建议超过 2 条规则时，停下来问是否在过度修正
- AGENTS.md 超过 200 行时，提出删除或合并建议，而不是只追加

---

## 开发流程

每个新功能按以下步骤推进，不跳过 PRD 和实现文档直接写代码：

1. `/vibe-feature` — 读取项目上下文，Writer 生成 Mini-PRD，Reviewer subagent 审查，存入 `doc/features/`
2. `/vibe-impl` — 将 PRD 拆成步骤化实现文档，每步对应一个 commit，含测试设计
3. 逐步实现 — 按实现文档执行，每步完成后运行 `/vibe-accept`（typecheck + build + vitest）
4. 推送功能分支 — 所有步骤验收通过后推送，禁止直接推 main

高风险改动（FSM 路径 / safety_incident / schema 变更）额外运行 `/vibe-review` 进行双 AI 审查。
