# 新会话启动 Prompt（通用模板）

使用方法：在新会话开始时，把下方"---开始复制---"到"---结束复制---"之间的内容粘贴给 Agent。
根据当前要执行的任务，在末尾补充具体的任务编号（T1-T12）。

---开始复制---

## 项目背景

你正在开发 **SVETS（炫灿-职途向导系统）**，一个 Electron + Vue3 + TypeScript + SQLite 的职业能力测评 App。

工程基线请读 `AGENTS.md`。

## 当前代码状态（重要：不要假设）

| 项 | 已实现 | 代码文件 |
|---|---|---|
| 基础能力测评（42+8 题，BASELINE_ASSESSMENT） | ✅ | src/main/, src/renderer/ |
| 训练任务（TRAINING_PRACTICE） | ✅ | 同上 |
| 实操评分（OFFLINE_ABILITY）、安全红线 | ✅ | 同上 |
| schema v0.1.10 | ✅ | src/main/db/schema.sql |
| **专业岗位测评（JOB_SKILL_ASSESSMENT）** | ❌ 完全没有 | — |
| **题库域隔离（bank_domain 字段）** | ❌ 字段不存在 | — |
| **TEACHER_OBSERVATION、JOB_SKILL_SCORE** | ❌ 枚举不存在 | — |

目标：把代码从 v0.1.10 + PRD v1.0.6 升级到 v0.1.12 + PRD v1.0.9。

## 实施文档位置

所有设计文档在 `doc/specs/impl/`（本次新产出，不是历史文档）：

- `00-START-HERE.md` — 现状快照 + 前置检查 + 常见陷阱
- `00-implementation-overview.md` — 整体目标和范围边界
- `01-schema-v0.1.12-design.md` + `01-schema-v0.1.12.sql` — schema 设计
- `02-json-contracts-and-types.md` — TypeScript 类型合同
- `03-job-skill-demo-paper-spec.md` — 固定示范卷（含真实题目 ID）
- `04-question-bank-import-cleaning-spec.md` — 导入清洗规格
- `05-state-machine-and-events.md` — 状态机与事件
- `06-acceptance-test-plan.md` — 验收测试用例（120 条）
- `07-implementation-task-book.md` — 任务书（T1-T12，含依赖关系）

## 开始前必须做的两件事

1. **读 `doc/specs/impl/00-START-HERE.md`**（5分钟，避免踩常见坑）
2. **读当前任务对应的 impl/ 文档**（见下方任务编号）

## 本次要执行的任务

<!-- 在这里填写任务编号，例如：T1 / T2 / T4 等 -->
<!-- 任务详细说明在 doc/specs/impl/07-implementation-task-book.md -->

**任务：[在此填写 T?]**

请先读 `doc/specs/impl/00-START-HERE.md`，确认前置条件，然后说明你的实施计划再开始编码。

---结束复制---

---

## 使用示例

### 开始 T1（类型升级）时：
在最后一行改为：
```
任务：T1 — 升级 src/shared/types/json-schemas.ts
对应文档：doc/specs/impl/02-json-contracts-and-types.md
```

### 开始 T2（schema 重建）时：
```
任务：T2 — 产出 src/main/db/schema.sql v0.1.12
对应文档：doc/specs/impl/01-schema-v0.1.12-design.md + 01-schema-v0.1.12.sql（SQL 草案已有）
前置任务：T1 必须已完成（类型已稳定）
```

### 开始 T4（导入脚本）时：
```
任务：T4 — 实现 question-importer.ts，先跑 dry-run
对应文档：doc/specs/impl/04-question-bank-import-cleaning-spec.md
数据源：doc/reference/专业岗位能力测评题库-M1-M6-数据库导出-298条.json
前置任务：T2（schema 已部署）、T3（validator 已实现）
注意：298 条题目全部应导出为 DRAFT，不得直接 ACTIVE
```

