# 232道语义变化候选复审结果接收留档

**生成时间：** 2026-07-20T00:00:00+08:00  
**候选集：** `job-skill-shelver-298-question-revision-candidates-v1`  
**候选集 hash：** `sha256:00563070a0d60909c0fe879b7f8a2f88e609828cf9ea5590a4bed95608a3fdc3`  
**候选集文件 hash：** `sha256:070d0f18a3e2d7ad7446626a7c5d4cd8019f6013842f32b28b920387a2f6a588`

## 原件

- 陈晓青：`doc/features/job-skill-shelver-298-semantic-change-content-rereview-result-chen-xiaoqing-2026-07-20.md`（sha256:e13475a46993091cf5c4680bebaf2e7e14994289ee7084b7f485873a5fdee37c）
- 赫东：`doc/features/job-skill-shelver-298-semantic-change-safety-technical-rereview-result-he-dong-2026-07-20.md`（sha256:7dc23963b4a78cde4241ae45a242359ebc39d58b84fbb6b18aa1f39e7234abf4）

## 接收校验

- 覆盖题数：232 / 232
- 新题目 ID、原题目 ID、题型、原始记录 hash、`candidate_record_hash` 与候选集逐题一致
- 审核人身份与审核日期：陈晓青 / 赫东，2026-07-20
- 候选记录 hash 已按候选 JSON 规范化重算，无漂移
- 两份结果均为 Markdown 原件，已固化为 JSON；Markdown 不作为机器权威结果

## 陈晓青内容复审汇总

| 题型 | 总数 | 通过 | 退回复修 |
|---|---:|---:|---:|
| SINGLE_CHOICE | 56 | 18 | 38 |
| TRUE_FALSE | 68 | 0 | 68 |
| DRAG | 25 | 4 | 21 |
| OFFLINE_OPERATION | 83 | 0 | 83 |

## 赫东安全与技术复审汇总

| 题型 | 总数 | 通过 | 退回复修 |
|---|---:|---:|---:|
| SINGLE_CHOICE | 56 | 19 | 37 |
| TRUE_FALSE | 68 | 0 | 68 |
| DRAG | 25 | 3 | 22 |
| OFFLINE_OPERATION | 83 | 0 | 83 |

## 合并门禁

| 题型 | 总数 | 两方均通过 | 退回复修 |
|---|---:|---:|---:|
| SINGLE_CHOICE | 56 | 18 | 38 |
| TRUE_FALSE | 68 | 0 | 68 |
| DRAG | 25 | 3 | 22 |
| OFFLINE_OPERATION | 83 | 0 | 83 |

**合并结论：** 21 题两方均通过，211 题继续退回复修。所有 232 题仍不得激活；退回题保持 `DRAFT`，通过题也只能进入下一步候选处理，不能直接写运行库或生成激活 SQL。
