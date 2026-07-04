# 题库源 CSV 模板

用于 `scripts/seed-question-bank-source.mjs` 的最小列模板：

```csv
模块标题,题型标题,考察点,题目,素材内容描述,能力维度标签,考察难度,计分规则,备注
认知理解能力,单项选择题,货架识别,请选择正确货架,货架全景图,"认知理解，规则执行",中级,答案为 B,需要人工复核
规则执行能力,判断题,异常处理规则,看到破损纸箱时应先报告老师。,破损纸箱场景,规则执行,低级,正确,
安全操作能力,实操题,安全开箱操作,请完成安全开箱并摆放商品,安全刀+纸箱+货架,"安全操作，精细动作",高级,教师按 0/1/2 打分,需补充教具资源
```

约束：

- 列名必须与模板完全一致。
- 编码使用 UTF-8。
- 允许字段中包含逗号、双引号和换行，但必须使用 CSV 标准双引号转义。
- `模块标题`、`题型标题`、`考察难度` 必须使用实现文档中定义的枚举中文名。
- 当前导入脚本会把行写为 `DRAFT`，并在 `content_json.note` 中写入复核标记；不得绕过后续审核门禁直接激活。

常用命令：

```bash
node scripts/seed-question-bank-source.mjs --csv /abs/path/question-bank.csv --dry-run
node scripts/seed-question-bank-source.mjs --csv /abs/path/question-bank.csv --out /tmp/question-bank-source.sql
node scripts/seed-question-bank-source.mjs --csv /abs/path/question-bank.csv --db /abs/path/xc-career-guide.db
```
