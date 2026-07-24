# 超市理货员题库与素材当前合同入口

**状态：** 活跃导航入口  
**日期：** 2026-07-22  
**范围：** JOB_SKILL 298 道 DRAFT 题、270 项素材准备合同、线下工具包与 Pilot 激活门禁  

## 普通结论

现在题库已经整理成 298 道当前版本，但还只是“可导入草稿”。素材侧也已经整理成 270 项生产清单，但全部还没生成、没审核、没批准。后续做图片、视频、脚本和线下教具时，从本文件列出的当前合同读取，不再从旧审核包或旧 Pilot 文档直接开工。

当前机器事实以 `doc/assets/asset-manifest.json` v0.5.0 为准：270 项全部 `planned`，0 项 `approved`；147 项已绑定题号，且 `question_ids` 与 `current_question_ids` 已同步；213 项绑定 Prompt 模板，但 213 项 `prompt_text` 仍为空。

## 当前只读入口

| 文件 | 作用 |
|---|---|
| `doc/specs/MVP_PRD_v1.0.9-authoritative.md` | 唯一产品合同，判断功能边界和验收口径时先读 |
| `doc/features/job-skill-shelver-runtime-authority-v1.json` | 298 道当前题号、版本和 DRAFT 状态的机器权威 |
| `doc/features/job-skill-shelver-phase4-activation-gate-v1.json` | 当前激活门禁：Pilot 未过、270 项资产未批准，所以不能激活 |
| `doc/assets/asset-manifest.json` | 270 项视觉、音频、脚本和工具卡生产合同 |
| `doc/assets/asset-manifest.schema.json` | manifest v0.5.0 结构和题号绑定规则 |
| `doc/features/job-skill-shelver-question-delivery-lock-v1.json` | 181 道需要素材/工具/脚本/视频答案支撑的交付锁 |
| `doc/assets/offline-toolkit-manifest-v1.json` | 100 道线下实操题的材料布置、复位和资产依赖 |

## 素材准备顺序

1. 先读 `doc/assets/asset-manifest.json`，以 `question_ids` 追溯来源题号，以 `current_question_ids` 绑定当前运行时题号。
2. 先做 R1-R6 核心参考资产，再做 A-G 与 DELIVERY 资产。
3. Prompt 只按 `doc/assets/prompt-templates/` 和 manifest 字段编译，不从旧 Prompt、旧批次 JSON 或旧 HTML 审核包复制。
4. 生成图片、视频或脚本前必须运行 `npm run asset:validate`，确认仍是 `total=270, planned=270, approved=0` 或符合当批真实进展。
5. 资产批准只解除资产门禁；不等于题目激活，不等于 Pilot 门禁通过，不等于写入运行数据库。

## 历史文件边界

- `doc/features/job-skill-shelver-298-*` 的大量 JSON/HTML/MD 是审核链、复审链和生成器输入。日常素材生产不要主动阅读，只有重建 298 权威、复盘审核意见或修生成器时才下钻。
- `doc/features/job-skill-shelver-pilot-current-question-authority.md` 只保留 Pilot 24 题门禁追溯价值，不再作为 298 题素材生产唯一入口。
- `doc/features/archive/` 中的旧图片方案、旧 SQL、旧 Prompt 和 Pilot R0/v1/v2 文件只读追溯，不得执行或复制到新生产批次。
- `doc/reference/专业岗位能力测评题库-M1-M6-数据库导出-298条.json` 是来源池，不是当前可激活题库，也不是素材生产入口。

## 禁止动作

- 不把 DRAFT 题改成 ACTIVE。
- 不修改策略或历史 manifest 来绕过门禁。
- 不把未批准资产写入 `asset_resource`。
- 不从 archive 或旧审核包直接生成图片、视频或导入 SQL。
- 不删除 298 审核链文件，除非同步更新所有生成器、测试和 hash 追溯。
