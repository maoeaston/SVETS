# 超市理货员 Pilot 当前题目门禁追溯入口

- 当前状态：`CURRENT_PILOT_CANDIDATE`，尚未授权激活
- 当前策略候选：`strategy_job_skill_shelver_v1@3-pilot-r2`
- Pilot 24 题门禁机器输入：`job-skill-shelver-pilot-revision-candidates-v3.json`
- 全量 298 题素材生产入口：`job-skill-shelver-current-contracts.md` → `job-skill-shelver-runtime-authority-v1.json` → `doc/assets/asset-manifest.json`
- 激活门禁：`job-skill-shelver-pilot-activation-manifest-v3.json`
- 修订依据：`job-skill-shelver-pilot-13-question-revision-and-renderer-fix-v1.0.md`

本文件只保留 Pilot 24 题独立门禁追溯价值。制作 298 题图片、视频、教具卡、脚本或 Prompt 时，必须先读取 `job-skill-shelver-current-contracts.md` 和 `doc/assets/asset-manifest.json`；不得从本文件、原始298题导出、旧审核包、旧审核结论或 v1/v2 manifest 直接复制为全量素材生产输入。

## 本轮替代关系

| 历史候选 | 当前候选 | 原因 |
|---|---|---|
| `M2_SC_003` | `M2_SC_003_V2` | 刀具风险优先级与选项重写 |
| `M2_SC_005_V2` | `M2_SC_005_V3` | 固定模拟工作日及双批次日期重写 |
| `M5_SC_001` | `M5_SC_001_V2` | 补齐水渍守护、隔离、复检闭环 |
| `M5_SC_002` | `M5_SC_002_V2` | 补齐疏离、封控及禁止自行处置 |
| `M5_SC_009` | `M5_SC_009_V2` | 补齐碎玻璃区域控制、工具、容器与复检 |
| `M6_SC_003` | `M6_SC_003_V2` | 以包装储存条件限定低温酸奶 |
| `M6_SC_009` | `M6_SC_009_V2` | 加入条码或商品编码联合核对 |

6道离线实操题仍使用 `M1_OP_033_V2`、`M2_OP_027_V2`、`M3_OP_043_V2`、`M4_OP_029_V2`、`M5_OP_039_V2`、`M6_OP_035_V2`。本轮只修复渲染器，其题目版本与候选 hash 保持不变。

## 历史文件边界

- `doc/features/archive/job-skill-shelver-pilot-r0-v1-v2/`：集中保存 v1/v2 manifest、候选集、审核包和陈晓青/赫东在2026-07-19提交的历史审核证据；只对其中绑定的 candidate hash 有效，不得覆盖或作为新生产输入。
- `doc/reference/专业岗位能力测评题库-M1-M6-数据库导出-298条.json`：原始来源数据，不是当前 Pilot 生产合同。
- `doc/reference/question-bank-viewer.html`：同时展示当前 Pilot 候选和原始394题来源视图；仅用于浏览和追溯，不替代当前 298 题素材合同入口。

当前 v3 仍为 `PENDING`。7道在线新候选需要重新完成内容、安全和技术复审；6道离线题需要完成真实 Electron 渲染见证和技术复审。上述门禁完成前不得写入 ACTIVE 运行种子或生成激活 SQL。
