# 编码任务 T1：共享类型升级

## 给 Agent 的启动 Prompt

---

你正在开发 **SVETS（炫灿-职途向导系统）**，一个 Electron + Vue3 + TypeScript + SQLite 的职业能力测评 App。

## 当前代码真实状态

- schema 版本：`v0.1.10-scoring-closure`
- PRD 版本：`v1.0.6`（已实现的功能是基础能力测评 42+8 题）
- **专业岗位测评（JOB_SKILL_ASSESSMENT）代码中完全没有**，是本次要新增的

## 本次任务

**T1：升级共享类型文件** `src/shared/types/json-schemas.ts`

目标：把现有的 165 行类型文件扩展为支持 v1.0.9 目标状态的完整类型定义。

## 必读文档（按顺序）

1. `AGENTS.md` — 工程约束和 Do NOT introduce 清单
2. `src/shared/types/json-schemas.ts` — 当前 165 行现状（先读再改）
3. `doc/specs/impl/02-json-contracts-and-types.md` — 目标类型定义（完整方案）
4. `doc/specs/impl/00-START-HERE.md` — §1.2 说明了当前类型的已知局限

## 具体步骤

按 `doc/specs/impl/07-implementation-task-book.md` §T1 执行：

1. 新增枚举：`StrategyType`（+JOB_SKILL_ASSESSMENT）、`ResultType`（+JOB_SKILL_SCORE）、`QuestionPhase`、`BankDomain`、`JobModuleCode`（M1-M6）、`ItemUsage`、`AnswerKeyStatus`、`PostDisclosureStatus`
2. 修改 `ContentJsonBase`：`ability_tags` 允许空数组；**删除 `expected_answer`**（正确答案迁入 scoring_rule_json）
3. 新增 `ScoringRuleOrderMatch`、`ScoringRuleMappingMatch`、`ScoringRuleNoScore`；标注 `ScoringRuleDrag` 废弃
4. 新增 `QuestionPolicyJobSkillFixedSet`（v1.2 FIXED_SET 结构）
5. 新增 `TeacherObservationPayload`、`JobSkillResultPayload`、`ContentJsonReview`
6. 新增 `validateQuestionContract()` 函数签名（实现在 T3）

## 完成标准

- `npx tsc --noEmit` 无报错
- 逐项核对 `doc/specs/impl/02-json-contracts-and-types.md` 附录 E 9 项差异全部落地
- 不修改任何现有 runtime 代码（只改类型声明）

## 工程约束

- 不引入 ORM、CSV 解析库、Markdown 渲染库（见 AGENTS.md）
- 不修改已有类型的行为（新增不破坏现有代码）
- 有不确定的技术事实，明确说不确定，不编造

