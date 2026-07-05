---
description: 事件溯源架构原则、状态机约束、安全红线、JSON 字段验证规则
globs: src/main/**/*.ts, src/shared/**/*.ts
alwaysApply: false
---

## 架构原则

### 事件溯源 + SQLite 投影
- `action_log.jsonl` 是唯一事实来源，只追加、不修改
- SQLite 是查询投影，可删除重建
- 所有状态变更必须先写事件、再更新投影
- 冷启动时从 JSONL 回放事件重建 SQLite

### 单一策略配置源
- `strategy_config` 表是组卷、评分、红线规则的唯一定义
- `version` 字段不可变，修改即新增版本
- 会话创建时锁定 `strategy_id` + `version`，运行中不得切换

### 安全红线优先级
- `LEVEL_FAIL_BY_SAFETY` 覆盖所有基于分数的等级判定
- 红线触发后，会话立即进入 `REDLINE_HALTED` 终态，不可恢复
- 触发器在数据库层强制执行，应用层不得绕过

## 关键约束

### JSON 字段必须验证
- 写入任何 JSON TEXT 字段前，必须按 `doc/specs/xc-career-guide-json-field-schema-v1.0.0.md` 验证结构
- 新增 JSON 结构字段时，必须同时补共享类型、运行时校验器和至少一个消费路径测试，三者缺一不可
- `content_json` 的 `question_type` 必须与 `question_bank.question_type` 一致
- `strategy_config` 的 `competent_threshold > conditional_threshold` 必须满足
- 所有 `asset_id` 引用必须存在于 `asset_resource` 且 `status = 'ACTIVE'`

### 事件写入顺序（不可颠倒）
1. 生成 payload
2. 计算 checksum: `SHA-256(JSON.stringify(payload))`
3. 分配 event_id (UUID v4) 和 event_sequence (aggregate 内递增)
4. 追加写入 `action_log.jsonl`（文件锁）
5. 写入 `domain_event_projection`
6. 调用 reducer 更新投影表

### 状态机强制路径
- `assessment_session.status`:
  - 开放态包括 `INIT` / `ACTIVE` / `EMOTION_INTERRUPTED` / `SUSPENDED_REVIEW_REQUIRED` / `OFFLINE_PENDING`
  - `EMOTION_INTERRUPTED` 可从 `ACTIVE` 进入，恢复后回到 `ACTIVE`
  - `SUSPENDED_REVIEW_REQUIRED` 是坐次间歇 / 待复核开放态，可回 `ACTIVE` 或终止
  - `OFFLINE_PENDING` 是线上完成后等待基础能力线下 8 题评分的开放态
  - 终态（`COMPLETED` / `ABORTED` / `REDLINE_HALTED`）不可转出
  - 红线可从任一开放态进入 `REDLINE_HALTED`
- 触发器在 DB 层阻止非法迁移，应用层不应尝试绕过

### 结果分离展示（不可合并）
- `ABILITY_SCORE` - 能力测评分（百分制 + 等级）
- `TRAINING_COMPLETION` - 训练完成度（完成率百分比）
- `OPERATION_PASS_RATE` - 实操达标率（各维度 0/1/2 分）
- 三者独立计算、独立展示，禁止合成"总分"

### 字段/枚举变更的下游全仓扫描
- 修改 `strategy_config` 字段名、`level_result` 枚举值、schema 版本号或 PRD 版本号后，必须对每个旧 token 执行 `grep -rn` 跨 `src/` + `doc/`
- 每个命中点逐一判定：需更新 / 历史性引用（patch notes、迁移说明、决策记录——应保留）
- 不能只改"显然的几份文档"；事件 payload 规范、共享类型定义、AGENTS.md 工程基线都在扫描范围内
