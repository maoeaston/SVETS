# 超市理货员298题定点V4复审接收台账

**状态：** COMPLETED_WITH_RETURNS  
**候选集：** `sha256:309a399aed46d0a7f5ca257c74a30312bd3a2931f53e5c03422739602c8c0d5a`  
**结论：** 145道定点修订题中，139道已通过，6道退回复修；阶段四继续关闭。

## 原件接收

| 审核范围 | 原始路径 | 仓库固化路径 | 字节数 | SHA-256 |
|---|---|---|---:|---|
| 陈晓青：内容 | `E:\Downloads\job-skill-shelver-298-targeted-v4-content-rereview-packet-v1-result.json` | `doc/features/job-skill-shelver-298-targeted-v4-content-rereview-result-chen-xiaoqing-2026-07-20.json` | 52749 | `sha256:420289fbf3481415322f46a006613e79421fa8b0c485dfb241d7a2176a9c6409` |
| 赫东：安全与技术 | `E:\Downloads\job-skill-shelver-298-targeted-v4-safety-technical-rereview-packet-v1-result.json` | `doc/features/job-skill-shelver-298-targeted-v4-safety-technical-rereview-result-he-dong-2026-07-20.json` | 45089 | `sha256:8b2d1c5c03ee98eba9e09e57ec58aa90112738690c520663267e89b9f45583b3` |

两份仓库文件与用户提供的下载文件逐字节一致；合并产物不覆盖审核人原件。

## 校验结果

- 两份结果的 Schema版本、审核包ID、审核人、提交时间、候选集hash均通过校验。
- 陈晓青140题、赫东120题的集合无重复、无漏题、无越界题；版本链、逐题语义hash和候选记录hash均与V4候选一致。
- 两份顶层汇总均可由逐题结果复算。
- 12道视频判断题的题干规则、视频行为和预设答案再次校验通过，没有新增合同冲突。
- 退回意见均为题意、评分或安全边界问题；纯素材生产、asset/setup ID、工具编号、文件路径或hash范围异常为0项。

## 审核汇总

| 审核范围 | 应审 | 通过 | 退回复修 |
|---|---:|---:|---:|
| 陈晓青：内容 | 140 | 135 | 5 |
| 赫东：安全与技术 | 120 | 118 | 2 |

## 合并处置

- 4道已通过V3引用继续有效；V4有135道通过，因此完整145题中共139道通过。
- 退回的唯一题目共6道：`M1_OP_037_V4`、`M1_OP_038_V4`、`M2_OP_031_V4`、`M2_OP_038_V4`、`M2_OP_041_V4`、`M5_DG_034_V4`。
- 仅内容退回：4道；仅安全技术退回：1道；双轨均退回：1道。
- 下一步只为上述6道创建V5，并只送失败轨道；其余139道不重复修订或复审。
- `releaseable=false`、`phase_4_allowed=false`；未写运行库，未生成激活SQL，阶段二交付锁未修改。
