# 岗位题库阶段四统一激活门禁接线台账 v1

- 生成时间：2026-07-22T15:00:00+08:00
- 机器权威：`doc/features/job-skill-shelver-phase4-activation-gate-v1.json`
- 当前状态：`BLOCKED_ASSET_DELIVERY_AND_PILOT_GATE`

## 普通结论

145 道定点复审题与11道淘汰原题的替代题均已通过对应人工审核，阶段四已完成合同接线。298 道来源题均已编译为当前版本 DRAFT；替代题只获得DRAFT编译资格，未获得激活权限。当前仍不能激活题目或创建岗位测评，因为 Pilot 独立门禁尚未通过，且 270 项资产仍未完成批准和文件校验。

## 集合核对

- 来源题：298
- 当前保留 DRAFT：298
- 淘汰原题替代题审核通过：11
- V6 定点复审通过：145
- 无语义变化保留 V2：66
- Pilot 独立门禁待完成：24

## 资产与运行权限

- 资产总数：270
- 已批准：0
- 未完成：270
- 可编译 DRAFT seed：true
- 可生成激活 SQL：false
- 可激活：false
- 可创建 session：false
- 本轮运行数据库保持不变：true

## 当前阻断项

- PILOT_GATE_PENDING：Pilot 24题的独立激活门禁尚未通过。（24）
- ASSET_DELIVERY_INCOMPLETE：270项资产尚未全部批准并校验文件。（270）

> 本 Markdown 仅由机器门禁 JSON 确定性生成，用于阅读和留档；JSON 是权威。
