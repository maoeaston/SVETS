# 基础能力题库与 42+8 当前合同入口

**状态：** 活跃导航入口  
**日期：** 2026-07-22  
**范围：** `BASE_ABILITY` 96 道 DRAFT 候选题、42+8 测评供给、素材/renderer/线下教具准备与激活门禁

## 普通结论

基础能力 96 道题已经有当前候选池，也已经能从数量上支撑 42 道线上计分题 + 8 道线下实操题 + 1 道观察项。但它现在仍只是“候选内容”，不是可正式施测的题库。

当前机器门禁以 `doc/features/base-ability-42plus8-activation-gate-v1.json` 为准：96 道全部是 `DRAFT`，0 道 `ACTIVE`；96 道评分规则仍为 `NO_SCORE`；0 道绑定媒体资产，0 道绑定线下工具资产。因此不能激活、不能写运行库为正式题、不能把结果解释成已验证的标准化诊断量表。

## 当前只读入口

| 文件 | 作用 |
|---|---|
| `doc/specs/MVP_PRD_v1.0.9-authoritative.md` | 唯一产品合同，规定 BASE_ABILITY 42+8、满分 100、`ABILITY_SCORE` 和禁止混题 |
| `doc/reference/通用基础能力正式测评候选题库_v0.2-软件优先版.xlsx` | 96 道基础能力候选题唯一来源 |
| `doc/features/question-bank-import-base-ability-v02.sql` | 当前 96 道候选题导入 SQL；状态为 DRAFT，评分为 NO_SCORE |
| `doc/features/base-ability-42plus8-activation-gate-v1.json` | 当前 42+8 供给与激活阻断机器门禁 |
| `doc/features/base-ability-42plus8-activation-gate-v1.schema.json` | 门禁 JSON 结构合同 |
| `scripts/seed-base-ability-v02.mjs` | 从 v0.2 xlsx 生成当前导入 SQL 的一次性工具 |
| `scripts/build-base-ability-42plus8-gate.mjs` | 重建/检查基础能力 42+8 机器门禁 |
| `doc/features/question-bank-launch-gate.md` | 运行库 ACTIVE 门禁说明；只统计 BASE_ABILITY，线上题含 SOFTWARE_TASK |
| `doc/features/base-ability-42plus8-evaluation-memo.md` | 分数解释与试测定位备忘录；不是激活授权 |

## 当前机器事实

| 项目 | 当前值 |
|---|---:|
| 候选题总数 | 96 |
| DRAFT | 96 |
| ACTIVE | 0 |
| 线上候选题 | 87 |
| 线下实操候选题 | 8 |
| 观察项 | 1 |
| `NO_SCORE` 占位 | 96 |
| 媒体资产绑定 | 0 |
| 工具资产绑定 | 0 |

题型分布：

| 题型 | 数量 |
|---|---:|
| `SOFTWARE_TASK` | 50 |
| `SINGLE_CHOICE` | 21 |
| `DRAG` | 17 |
| `OFFLINE_OPERATION` | 8 |

模块供给：

| 模块 | 线上候选 | 线下候选 | 观察项 |
|---|---:|---:|---:|
| `FINE_MOTOR` | 9 | 7 | 0 |
| `COGNITION` | 20 | 0 | 0 |
| `RULE_EXECUTION` | 16 | 0 | 0 |
| `EMOTION_REGULATION` | 13 | 0 | 1 |
| `BASIC_SOCIAL` | 14 | 0 | 0 |
| `SAFETY_OPERATION` | 15 | 1 | 0 |

## 准备顺序

1. 先运行 `npm run contract:base-ability:gate:check`，确认 96 题候选池和 42+8 供给没有漂移。
2. 先补线上题答案键与 scoring rule，再考虑从 `NO_SCORE` 过渡到正式计分。
3. 为 `DRAG` 和 `SOFTWARE_TASK` 补 renderer、交互资源和可访问性检查。
4. 为 8 道 `OFFLINE_OPERATION` 补标准教具、布置/复位说明、0/1/2 行为锚点和教师评分说明。
5. 完成专业审核与课堂试测证据后，才允许讨论从 DRAFT 转 ACTIVE。
6. `BASE_ABILITY` 和 `JOB_SPECIFIC` 必须保持隔离：基础能力只生成 `ABILITY_SCORE`，专业岗位只生成 `JOB_SKILL_SCORE`。

## 历史文件边界

- `doc/reference/通用基础能力评估题库.xlsx` 是旧版来源，已归档，不得重新作为输入。
- `doc/features/archive/legacy-data/question-bank-import-base-ability.sql` 是旧版 SQL 产物，不得执行。
- `doc/features/archive/historical-design/question-bank-image-plan.md` 是早期基础能力出图方案，只作历史参考；当前素材和资源入库仍以 `doc/assets/asset-manifest.json` 及当前门禁为准。
- `base-ability-42plus8-evaluation-memo.md` 只说明试测定位、分数解释风险和专业评审要求，不授予激活权限。

## 禁止动作

- 不把 96 道候选题批量改成 `ACTIVE`。
- 不从旧 xlsx 或旧 SQL 重新生成基础能力题库。
- 不让 `JOB_SPECIFIC` 进入基础能力 42+8、`ABILITY_SCORE` 或基础能力完成率。
- 不把 `OFFLINE_ABILITY` 评分计入 `OPERATION_PASS_RATE`。
- 不把当前 `NO_SCORE` 候选题包装成正式测评题。
