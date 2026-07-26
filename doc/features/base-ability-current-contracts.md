# 基础能力题库与 42+8 当前合同入口

**状态：** 活跃导航入口  
**日期：** 2026-07-26
**范围：** `BASE_ABILITY` 96 道 DRAFT 候选题、42+8 测评供给、素材/renderer/线下教具准备与激活门禁

## 普通结论

基础能力 96 道题已经有当前候选池，也已经能从数量上支撑 42 道线上计分题 + 8 道线下实操题 + 1 道观察项。但它现在仍只是“候选内容”，不是可正式施测的题库。

当前机器门禁以 `doc/features/base-ability-42plus8-activation-gate-v1.json` 为准：96 道全部是 `DRAFT`，0 道 `ACTIVE`；96 道评分规则仍为 `NO_SCORE`；0 道绑定媒体资产，0 道绑定线下工具资产。因此不能激活、不能写运行库为正式题、不能把结果解释成已验证的标准化诊断量表。

产品负责人已选择方案 A 作为后续状态顺序：选定 50 题先完成内容、专业和技术门禁，再经独立 Pilot 激活批准成为 `ACTIVE`，之后才执行真实课堂试测；课堂试测证据只门禁正式解释与发布。当前机器事实尚未达到第一步，因此本节的 0 ACTIVE 结论不变。

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

## 已批准的状态顺序（方案 A）

```text
DRAFT 内容/专业/技术准备
→ READY_FOR_PILOT_ACTIVATION_REVIEW
→ 独立 Pilot 激活批准
→ 仅获批 42+8 题成为 ACTIVE（PILOT_ONLY）
→ 学校协议与完整授权链通过
→ 真实课堂试测
→ 试测证据接受
→ 正式解释/发布评审与新策略版本
```

- Pilot 激活批准人由产品负责人书面指定，且不得参与该版本内容制作、代码实现、门禁生成或激活执行；执行激活的 `ADMIN` 不能自授批准。
- `ACTIVE` 在此只表示题目可以由匹配批准文件、`pilot_mode = true` 的冻结策略用于受控 Pilot，不表示已经形成标准化量表、正式诊断或就业安置依据。
- 真实课堂试测必须另有学校批准协议、适用知情同意、匿名化/本地敏感数据规则和 `business_session → device grant → assignment → student confirmation → start` 完整授权链。
- 课堂证据接受前，Pilot 结果只能用于教学诊断、训练支持和证据收集；`placement_advice` 保持禁用。正式解释或发布仍需产品与专业团队另行批准，并创建新策略版本。
- 试测后若需修改已 ACTIVE 题的内容、答案、评分、资产或教具语义，先将旧题 `DISABLED / ARCHIVED`，再以新 `question_id` 重走审核与 Pilot 激活；不得退回 DRAFT 原地修改。

[!] 当前 `base-ability-42plus8-activation-gate-v1.json` 仍是 2026-07-22 的单阶段现状快照，其中把课堂试测写入总激活阻断文案。其 96/87/8/1、DRAFT/ACTIVE、素材和评分统计仍是当前机器事实，但该旧文案不再定义状态顺序；Q1 实现必须按方案 A 升级为分阶段门禁后，才可执行任何真实激活。

## 准备顺序

1. 先运行 `npm run contract:base-ability:gate:check`，确认 96 题候选池和 42+8 供给没有漂移。
2. 先补线上题答案键与 scoring rule，再考虑从 `NO_SCORE` 过渡到正式计分。
3. 为 `DRAG` 和 `SOFTWARE_TASK` 补 renderer、交互资源和可访问性检查。
4. 为 8 道 `OFFLINE_OPERATION` 补标准教具、布置/复位说明、0/1/2 行为锚点和教师评分说明。
5. 完成适用的内容/测评、安全/康复、特教/无障碍审核和合成身份技术演练，门禁只可进入 `READY_FOR_PILOT_ACTIVATION_REVIEW`。
6. 取得绑定选定 50 题、策略版本和关键 hash 的独立 Pilot 激活批准后，由 `ADMIN` 执行受控激活；只允许所选 42+8 题转 ACTIVE，其余 46 题继续 DRAFT。
7. 题目进入 `PILOT_ACTIVE` 后，再完成学校协议、适用知情同意和多设备授权链，执行真实课堂试测。
8. 课堂试测证据经接受后，才允许讨论正式阈值解释、报告用语、对外发布或 placement advice，并以新策略版本落地。
9. `BASE_ABILITY` 和 `JOB_SPECIFIC` 必须保持隔离：基础能力只生成 `ABILITY_SCORE`，专业岗位只生成 `JOB_SKILL_SCORE`。

## 历史文件边界

- `doc/reference/通用基础能力评估题库.xlsx` 是旧版来源，已归档，不得重新作为输入。
- `doc/features/archive/legacy-data/question-bank-import-base-ability.sql` 是旧版 SQL 产物，不得执行。
- `doc/features/archive/historical-design/question-bank-image-plan.md` 是早期基础能力出图方案，只作历史参考；当前素材和资源入库仍以 `doc/assets/asset-manifest.json` 及当前门禁为准。
- `base-ability-42plus8-evaluation-memo.md` 说明方案 A 的试测定位、分数解释风险和专业评审要求，但不构成具体版本的 Pilot 激活批准文件。

## 禁止动作

- 不把 96 道候选题批量改成 `ACTIVE`。
- 不在独立批准缺失、过期或 hash 不匹配时激活选定 50 题，也不让执行激活的 `ADMIN` 自授批准。
- 不把 `ACTIVE`、专业审核通过或课堂试测完成中的任一单项自动解释为正式发布。
- 不从旧 xlsx 或旧 SQL 重新生成基础能力题库。
- 不让 `JOB_SPECIFIC` 进入基础能力 42+8、`ABILITY_SCORE` 或基础能力完成率。
- 不把 `OFFLINE_ABILITY` 评分计入 `OPERATION_PASS_RATE`。
- 不把当前 `NO_SCORE` 候选题包装成正式测评题。
