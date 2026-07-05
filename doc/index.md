# SVETS 文档索引

给**新会话 agent** 的最小导航入口。回答 3 个问题：
1. 现在该先读什么
2. 某类任务对应哪份文档
3. 什么时候需要继续下钻

使用原则：先读"当前任务必需"的最小集合。会话恢复优先看 `.continue-here.md` 和会话模板。需要改实现时再下钻 feature 文档；需要核对数据结构时再下钻 schema 系列。

---

## 1. 目录结构概览

```
doc/
├── index.md              ← 本文件
├── 会话启动.md            ← 编码会话开场检查清单
├── 会话结束.md            ← 编码会话收尾交接清单
├── specs/                ← 活跃工程规范（高频引用）
├── features/             ← 功能 Mini-PRD + 实现文档
├── reference/            ← 原始素材（agents 不主动读）
└── archive/              ← 已归档（历史参考，不作为当前入口）
```

---

## 2. specs/ — 活跃工程规范

| 文件 | 用途 | 何时读 |
|------|------|--------|
| `specs/PRD_v1.0.6.md` | MVP 产品说明、功能范围、结果模型、验收基线 | 判断功能边界、确认验收口径 |
| `specs/xc-career-guide-json-field-schema-v1.0.0.md` | 所有 JSON TEXT 字段结构规范 | 写或校验 `content_json`、`scoring_policy_json` 等 |
| `specs/xc-career-guide-event-payload-schema-v1.0.0.md` | 事件载荷与 JSONL 信封规范 | 涉及 `action_log.jsonl`、事件写入、回放 |
| `specs/题库分层架构说明.md` | 四层题库（MASTER/变式/泛化/结业）设计与 `question_role` 字段规划 | 题库新增、组卷策略、结业逻辑设计 |
| `specs/分数解释手册+施测者操作手册.md` | 评分等级解释与施测操作规程 | 评分展示、报告输出、施测流程核对 |

**数据库 schema 基线在代码库中：**
- `src/main/db/schema.sql` — 当前权威 schema，改表结构、触发器、状态机时必读

---

## 3. 编码会话阅读顺序

### 最小顺序

1. `AGENTS.md`
2. `.continue-here.md`
3. `doc/会话启动.md`
4. 当前任务对应的 `doc/features/*-prd.md`
5. 当前任务对应的 `doc/features/*-impl.md`
6. 如涉及结构约束，再补读：
   - `src/main/db/schema.sql`
   - `doc/specs/xc-career-guide-json-field-schema-v1.0.0.md`
   - `doc/specs/xc-career-guide-event-payload-schema-v1.0.0.md`
7. 如涉及产品范围或验收口径，再补读：
   - `doc/specs/PRD_v1.0.6.md`

### 什么时候停在最小集合

- 只是继续上个会话的单一步骤
- `.continue-here.md` 已明确下一步唯一原子动作
- 当前只改某个已拆好的 feature 步骤

### 什么时候必须继续下钻

| 任务类型 | 必读文档 |
|----------|----------|
| 改状态机、红线、事件顺序 | `schema.sql` + `event-payload-schema` |
| 写或校验 JSON 字段 | `json-field-schema` |
| 改功能边界、结果口径、验收标准 | 主 PRD |
| 改题库、组卷逻辑 | `specs/题库分层架构说明.md` |
| 实现某具体功能 | 对应 `features/*-prd.md` + `*-impl.md` |

---

## 4. features/ — 功能文档速查

### 活跃业务功能

| 功能 | PRD | 实现文档 |
|------|-----|---------|
| 按角色登录 | `login-by-role-prd.md` | `login-by-role-impl.md` |
| 学生档案管理 | `student-profile-prd.md` | `student-profile-impl.md` |
| 策略配置管理 | `strategy-config-prd.md` | `strategy-config-impl.md` |
| 题库与资源 | `question-bank-resources-prd.md` | `question-bank-resources-impl.md` |
| 测评流程 | `assessment-prd.md` | `assessment-impl.md` |

### 图片资产文档（仍活跃）

- `question-bank-image-plan.md` — 图片资产总方案
- `question-bank-image-batch-pilot-acceptance.md` — 试跑验收标准
- `question-bank-image-asset-linking-draft.md` — 图片接入应用草案
- `question-bank-image-asset-resource-seed-draft.md` — asset_resource seed 模板
- `question-bank-image-integration-checklist.md` — 编码 agent 执行清单
- `question-bank-image-continue-here-template.md` — 图片会话交接模板
- `question-bank-source-csv-template.md` — 题库导入 CSV 模板
- `question-bank-launch-gate.md` — 上线门禁检查

> JSON/TSV/SQL 工作数据文件已移至 `features/archive/`，不作为 agent 主动阅读入口。

---

## 5. reference/ — 原始素材

agents 不需要主动读，仅在需要核对源数据时查阅：

- `通用基础能力评估题库.xlsx` — Q_BASE_* 题来源
- `专业岗位能力测评题库2026.7.3_终稿.pdf` — M1–M6 题来源（298题终稿）
- `超市素材需求清单更新版.md` — 图片资产需求
- `chatgpt建议.md` — 题库分层设计输入建议（已被 `specs/题库分层架构说明.md` 吸收）
- 其余 PDF — 背景研究文献，不影响编码实现

---

## 6. 快速决策表

| 当前情况 | 先读这里 |
|----------|----------|
| 继续编码会话 | `会话启动.md` → `.continue-here.md` → feature impl |
| 新功能开发 | `AGENTS.md` → 主 PRD → `/vibe-feature` |
| 改数据库/状态机 | `src/main/db/schema.sql` |
| 改事件写入/回放 | `specs/xc-career-guide-event-payload-schema-v1.0.0.md` |
| 改 JSON 字段 | `specs/xc-career-guide-json-field-schema-v1.0.0.md` |
| 题库/组卷相关 | `specs/题库分层架构说明.md` |
| 功能范围判断 | `specs/PRD_v1.0.6.md` |
