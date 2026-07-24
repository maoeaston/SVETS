# 题库上线门禁脚本

Step 5 交付 `ACTIVE` 题量上线门禁，目标是在 5.4 真实组卷前先阻断题库不足或线下题配置不完整的情况。

## 用法

```bash
node scripts/check-question-bank-launch-gate.mjs --db /abs/path/xc-career-guide.db
node scripts/check-question-bank-launch-gate.mjs --db /abs/path/xc-career-guide.db --job SUPERMARKET_SHELVER
node scripts/check-question-bank-launch-gate.mjs --db /abs/path/xc-career-guide.db --bank BASE_ABILITY
```

默认检查 `job_code='SUPERMARKET_SHELVER'` 且 `bank_domain='BASE_ABILITY'`。

## 门禁规则

- `TRUE_FALSE / SINGLE_CHOICE / DRAG / SOFTWARE_TASK` 视为线上题。
- 只统计 `bank_domain='BASE_ABILITY'` 的题；JOB_SPECIFIC 不得进入基础能力上线门禁。
- 6 个 `module_type` 各自的 `ACTIVE` 线上题必须 `>= 7`。
- 全库 `ACTIVE` 的 `OFFLINE_OPERATION` 必须 `>= 8`。
- 每道 `ACTIVE OFFLINE_OPERATION` 的 `content_json.ability_tags` 必须为非空数组。
- `DRAFT`、`DISABLED`、`ARCHIVED` 不计入 `ACTIVE` 门禁。

## 输出

- 生成 `doc/features/question-bank-launch-gate-report.json`，可通过 `--report` 覆盖。
- 成功时退出码 `0`。
- 任一门禁失败时退出码 `1`，并输出缺口明细。
