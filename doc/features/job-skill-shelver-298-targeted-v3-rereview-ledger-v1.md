# 超市理货员298题定点V3复审接收台账

**状态：** COMPLETED_WITH_RETURNS_AND_CONTRACT_CONFLICTS  
**候选集：** `sha256:709df136bcbfe6c64dbc9b63d9cdeccc8a2e3925def1158ee6c73cb7db627c4b`  
**结论：** 145道V3中，4道通过，137道审核退回，4道发现合同冲突；阶段四继续关闭。

## 审核结果

| 审核范围 | 应审 | 通过 | 退回复修 |
|---|---:|---:|---:|
| 陈晓青：内容 | 144 | 8 | 136 |
| 赫东：安全与技术 | 135 | 19 | 116 |

## 合并处置

- 双轨或所需单轨均通过且合同一致：4道，保留V3，不再重复复审。
- 仅内容退回：21道。
- 仅安全技术退回：1道。
- 两轨均退回：115道。
- 合同冲突阻断：4道（`M3_TF_030_V3`、`M3_TF_033_V3`、`M3_TF_034_V3`、`M4_TF_022_V3`）；这些题的规则、视频行为与预设答案不一致，V4补走内容和安全技术双轨。
- 需要创建V4：141道；普通退回题只送退回轨道，合同冲突题补齐双轨。
- 通过题：`M6_SC_001_V3`、`M6_SC_002_V3`、`M6_SC_004_V3`、`M6_SC_010_V3`。

## 原件

- `doc/features/job-skill-shelver-298-targeted-v3-content-rereview-result-chen-xiaoqing-v2.json`，SHA-256：`sha256:9f0d6d1a2693c31a699817afc46a4098db51015bb42b8842d85417653346a850`
- `doc/features/job-skill-shelver-298-targeted-v3-safety-technical-rereview-result-he-dong-type-scoped-v2.json`，SHA-256：`sha256:84ad8a0fb79e6b634b0a3549136208bc21bf8fdae4acadbf70686b89efdfa986`

陈晓青原件采用类型范围扩展格式，没有直接套用旧v1导出Schema。接收器保留原件并按候选题ID、版本链、题型和 `candidate_record_hash` 校验；没有伪造缺失的提交时间。
