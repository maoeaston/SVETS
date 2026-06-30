# /vibe-feature — 新功能启动（上下文工程 + PRD）

用于在正式编码前，为一个新功能建立清晰的上下文和 PRD。

## 触发时机

用户描述了一个新需求或新功能，但尚未形成正式 PRD，或 PRD 不够完整。

## 执行步骤

### Step 1：读取项目上下文（不跳过）

按顺序读取以下文件，理解当前工程状态：

1. `AGENTS.md` — 架构原则、禁止清单、关键约束
2. `doc/炫灿-职途向导系统_MVP_PRD_v1.0.4.md` — 主 PRD，确认本次需求是否已在范围内
3. `doc/xc-career-guide-mvp-schema-v0.1.7-consistency-guard.sql` — 当前数据模型
4. 根据需求内容，按需读取：
   - `doc/xc-career-guide-json-field-schema-v1.0.0.md`
   - `doc/xc-career-guide-event-payload-schema-v1.0.0.md`
   - 相关的 `src/` 文件

### Step 2：分析影响范围

回答以下问题：

- 需要新增或修改哪些数据库表/字段？
- 需要新增哪些领域事件（EventType）？
- 需要新增哪些 IPC handler？
- 需要新增哪些 Vue 路由和视图？
- 是否涉及安全红线逻辑或 FSM 状态迁移？（[!] 高风险，需特别标注）
- 是否影响已有的 `strategy_config` 或 `result_record` 投影？

### Step 3：Writer 编写 Mini-PRD

生成一份结构化 Mini-PRD，包含：

```markdown
## 功能名称
## 解决的问题
## 用户角色（STUDENT / TEACHER / ADMIN）
## 核心使用场景（流程步骤）
## 功能范围（本次做什么 / 不做什么）
## 边界条件和异常处理
## 与现有功能的接口关系
## 成功验收标准
## 风险点（[!] 标注高风险项）
```

### Step 4：Reviewer 审查（subagent）

启动 Reviewer subagent，提供 Mini-PRD 全文，要求它：

- 检查是否与 PRD v1.0.4 的约束冲突（特别是 §2 MVP 范围、§6 并发约束、§7 结果体系）
- 检查是否遗漏边界条件（空数据、重复操作、并发会话、红线触发中）
- 检查安全相关内容是否符合两级权限模型
- 提出具体修改意见，不只说"有问题"

### Step 5：迭代

根据 Reviewer 意见修改 Mini-PRD，若修改较大则再次调用 Reviewer，直到无重大遗漏。

### Step 6：输出

- 将最终 Mini-PRD 保存到 `doc/features/<feature-name>-prd.md`
- 告知用户可以运行 `/vibe-impl` 进入下一步
