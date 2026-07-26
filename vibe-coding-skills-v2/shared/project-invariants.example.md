# Project Invariants

> 该文件示例迁移自现有 Vibe Skills 中反复出现的项目专属约束。正式使用前，应由项目负责人依据当前权威 PRD、Schema 和代码核对。

## 使用规则

- 每条不变量使用稳定 ID；修改语义时新增版本说明，不复用旧 ID 表达不同含义。
- Skill、PRD、实现文档、Review 和 Accept 只引用 ID，不复制维护完整文本。
- 能通过 Schema、类型、lint、测试或 CI 强制的，应同步建立自动门禁。

## 事件与投影

### INV-EVT-001 领域状态必须由事件推进

`assessment_session`、`training_session` 等受控状态不得由 UI、IPC handler 或普通 repository 直接修改，必须通过批准的领域事件和投影链推进。

### INV-EVT-002 事件持久化顺序唯一

事件写入顺序必须与当前权威架构定义完全一致。建议在正式文件中写明唯一术语，例如：

```text
action_log.jsonl append → domain_event_projection persist → reducer/projector update
```

若代码中的 reducer 与 projector 不是同一概念，必须拆成独立步骤并说明事务与失败恢复语义。

### INV-EVT-003 新事件必须完成全链登记

新增 EventType 时，必须同步完成 payload type、序列化校验、持久化、reducer/projector、回放兼容和测试登记。

## 安全红线与权限

### INV-SAFE-001 先熔断后归因

检测到满足红线条件的事实时，必须先阻断受影响会话和后续操作，再进入原因补充、确认、作废或解除流程。

### INV-SAFE-002 红线不得通过直接改会话状态实现

`REDLINE_HALTED` 必须由安全事件触发链产生，并关联有效安全事件，不得直接 UPDATE 会话状态伪造红线结果。

### INV-SAFE-003 未解决安全事件阻断新会话

同一学生、任务范围内仍存在未解决或未作废的安全事件时，不得创建受规则约束的新会话。

### INV-AUTH-001 两级权限边界

教师与管理员的安全事件权限必须符合当前权威权限矩阵。教师不得执行仅限管理员的 `RESOLVED`、`VOIDED` 或等价终结操作。

## 结果体系

### INV-RES-001 三类结果不得混算

以下结果保持独立计算、独立存储和独立解释：

- `ABILITY_SCORE`
- `TRAINING_COMPLETION`
- `OPERATION_PASS_RATE`

不得合并为单一总分，除非权威 PRD 新增明确、经批准的独立综合指标及其解释规则。

### INV-RES-002 安全优先级高于普通评分

当 `safety_overridden = 1` 或满足等价安全覆盖条件时，结果等级必须使用安全失败语义，不得被普通分数覆盖。

## Strategy 配置

### INV-STR-001 会话引用必须匹配同一配置版本

会话引用的 `strategy_id`、`strategy_type`、`job_code`、`strategy_version` 必须共同匹配 `strategy_config` 中同一行。

### INV-STR-002 已被引用配置的语义不可漂移

被会话引用的配置版本不得原地修改会影响历史复现的语义字段。

## IPC 与运行边界

### INV-IPC-001 新 IPC 必须完成白名单登记

所有新 IPC 通道必须在 preload 暴露层和 shared type 中显式登记，并进行权限、参数校验和错误映射。

### INV-IPC-002 Renderer 不得直接访问 Node

渲染进程不得绕过 preload 使用 `require()`、Node API、文件系统或数据库连接。

## 数据质量

### INV-DATA-001 JSON TEXT 写入前必须校验

写入数据库 JSON TEXT 字段前，必须按当前数据合同完成结构和语义校验。

### INV-DATA-002 不得硬编码策略数据

题量、阈值、比例及其他策略性参数必须来自批准的配置或数据合同，不得散落硬编码于 UI 或领域逻辑。

## 自动化落地建议

| 不变量 | 建议强制机制 |
|---|---|
| INV-EVT-001 | repository API 限制 + 静态扫描 + 集成测试 |
| INV-EVT-002 | 故障注入测试 + 回放测试 |
| INV-SAFE-001～003 | Schema trigger + 状态机测试 |
| INV-RES-001 | 类型分离 + 报告快照测试 |
| INV-STR-001 | FK/trigger + integration test |
| INV-IPC-001～002 | preload type + lint + IPC contract test |
| INV-DATA-001 | schema validator + property test |
