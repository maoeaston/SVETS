# 旧数据与脚本隔离区

这里的 TSV、SQL 和 Python 文件均已退出当前流程，只用于审计旧题库与资产接入记录。

- 不得执行 SQL。
- 不得运行 `gen-base-ability-import-v01.py`。
- 不得导入 TSV。
- 不得将其中的资产状态、题目 ID 或路径复制到当前 Manifest。

当前 BASE_ABILITY 来源和导入入口为 `doc/reference/通用基础能力正式测评候选题库_v0.2-软件优先版.xlsx` 与 `scripts/seed-base-ability-v02.mjs`。
