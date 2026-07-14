# 视觉资产验收记录

每个审核批次保存一份 JSON，路径回填到 Manifest 对应资产的 `qa_record_paths`。
技术门可由脚本签署；视觉、职业、特教和测评门必须由人类签署。
批次文件遵循同目录 `review.schema.json`。

只有以下条件同时成立时，资产才可改为 `approved`：

- 所有 `required: true` 的验收门均为 `passed`
- `rights.commercial_use_cleared` 为 `true`
- `source_path`、`runtime_path` 和 `file_hash` 已填写且文件校验通过
