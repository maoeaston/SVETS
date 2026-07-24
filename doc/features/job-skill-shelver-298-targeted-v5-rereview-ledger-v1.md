# 超市理货员298题定点V5复审接收台账

**状态：** COMPLETED_WITH_RETURNS  
**候选集：** `sha256:55b761ed6cf8b62460a79006d10ec37fa25a41702ab61b25fd26f185b8c403a7`  
**结论：** 完整145道题中，141道通过、4道退回复修；4道仍需定点复修，阶段四继续关闭。

## 原件接收

| 审核范围 | 原始路径 | 仓库固化路径 | 字节数 | SHA-256 |
|---|---|---|---:|---|
| 陈晓青：内容 | `E:\Downloads\job-skill-shelver-298-targeted-v5-content-rereview-packet-v1-result.json` | `doc/features/job-skill-shelver-298-targeted-v5-content-rereview-result-chen-xiaoqing-2026-07-20.json` | 4769 | `sha256:4577c7b88712dcd21ab7352651c5edb7f19e5cf9ce3fd01aa8e491768a25eab0` |
| 赫东：安全与技术 | `E:\Downloads\job-skill-shelver-298-targeted-v5-safety-technical-rereview-packet-v1-result.json` | `doc/features/job-skill-shelver-298-targeted-v5-safety-technical-rereview-result-he-dong-2026-07-20.json` | 1167 | `sha256:27ccf836619c5f3008adf83fef32cc7e83ee8bf5b0551eedfb328134c80904aa` |

接收时已对原始附件与仓库固化文件执行逐字节比较；脚本同时固定字节数和SHA-256，后续任何字节变化都会使检查失败。审核JSON是权威原件，本台账仅由合并JSON的同一确定性输入生成。

## 校验结果

- 两份结果的Schema版本、审核包ID、候选集hash、审核人和submitted_at均精确匹配。
- 内容结果精确覆盖5道，安全技术结果精确覆盖2道；无重复、漏题或越界题。
- 6道V5的版本链、previous_question_id、语义hash、候选记录hash均与候选集一致。
- 两份汇总均可由逐题结论复算；139道既有通过题仍以V4合并结果hash引用，没有复制候选、升版或重新审核。
- 完整145道题逐题保留来源结果、审核意见、版本链、候选hash、语义hash、失败轨道、下一版题号和本次合并记录hash。

## 审核汇总

| 审核范围 | 应审 | 通过 | 退回复修 |
|---|---:|---:|---:|
| 陈晓青：内容 | 5 | 1 | 4 |
| 赫东：安全与技术 | 2 | 2 | 0 |

## 合并处置

- 139道既有通过引用继续有效；6道V5中2道通过，因此完整145题中共141道通过。
- 仍退回4道：`M2_OP_031_V5`、`M2_OP_038_V5`、`M2_OP_041_V5`、`M5_DG_034_V5`。
- 只为实际退回题保留失败轨道和下一版题号；没有扩大复修或复审范围，也没有作废其他通过题。
- `releaseable=false`、`phase_4_allowed=false`；本轮未写运行库、未生成激活SQL，阶段二交付锁与所有历史题目保持不变。
