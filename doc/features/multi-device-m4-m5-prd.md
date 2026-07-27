# 多设备 M4/M5 推进 PRD

状态：顺序已确认；各子阶段仍须独立 R3 工作流
日期：2026-07-27
上游架构：`doc/specs/architecture-plan-b-multi-device-v2.2-authoritative-baseline.md`  
当前基线：schema v0.1.16-report-framework；M1-M3、F4、F6、F7 已进入当前 migration 链
目标：在扩展全量产品功能前，完成安全聚合、可靠事件基础设施和 Local Server 架构换轨。

## 1. 为什么 M4/M5 必须前置

继续在当前 Electron Main 内直接增加试卷、完整学习、AI 和教师 Web，会扩大后续 Command Bus 与 utilityProcess 迁移面。M4/M5 应先使用现有 MVP 小闭环完成换轨验证，再复制到新增业务域。

执行顺序固定为：

```text
Q1 Step 1 42+8 DRAFT authority
  -> Step 2A / M4 Safety Re-key
  -> Step 2B / M5A Command Bus Boundary
  -> Step 2C / M5B Event Batch + startupRecovery
  -> Q1 Step 3-10
  -> R0 Release Gate
  -> M5C utilityProcess Local Server
  -> M5D Teacher Web Transport + Security
```

M4 和每个 M5 子阶段独立 migration、独立验收、独立 commit，不合并为一次大爆炸式改造。

这样排序的原因是：先稳定最终安全聚合身份，再让全部写命令进入统一边界，最后只把这套最终边界接入 batch coordinator。若先做 batch，M4 和 M5A 会迫使安全 handler 与 writer 接线重复迁移；若把 M4 与 batch 合并，则 Schema、安全状态机、日志 durability 和 recovery 同时变化，故障面过大。

## 2. M4 Safety Re-key

M4 的当前详细范围、迁移边界和验收标准以 `doc/features/multi-device-m4-safety-rekey-prd.md` 为准。本节保留路线图摘要，不替代独立 Mini-PRD。

### 2.1 目标

把安全事件、开放会话唯一性和新会话阻断从：

```text
student_id + task_code
```

升级为：

```text
student_id + job_code + task_code
```

同一学生、同一 task_code、不同岗位之间不得互相误熔断；同一三元键下的 assessment 与 training 必须继续同时熔断。

### 2.2 合同前置

`[!]` 当前 `MVP_PRD_v1.0.9-authoritative.md` §11.6 仍声明两元归属，当前 schema 也仍执行两元语义。M4 不是单纯技术修复，而是产品归属语义升级。

M4 编码前必须：

1. 修改新的全量产品权威合同，明确三元聚合键。
2. 不回写冻结的 MVP 历史合同；在 MVP PRD 中增加“后续版本覆盖”说明即可。
3. 确认同名 `task_code` 跨岗位可合法复用。

`[!]` v2.2 §13.2 的迁移 SQL 只显式替换 4 个批量熔断/新会话阻断触发器，但当前 schema 还有 6 个两元归属守卫：

- 4 个 assessment/training `redline_incident_id` 同学生同任务守卫。
- 2 个 replacement incident 同学生同任务守卫。

这 6 个守卫若不加入 `job_code`，三元聚合语义仍不闭合。M4 必须先修订 v2.2 权威架构正文和覆盖矩阵，再实施 10 个触发器的完整替换。

### 2.3 Schema 和 migration

必须同步处理：

- 替换 4 个安全触发器。
- 替换 4 个 assessment/training redline incident 同归属守卫。
- 替换 2 个 replacement incident 同归属守卫。
- 替换 assessment/training 两个开放会话唯一索引。
- 增加 `job_code` 相关查询索引。
- 更新 safety incident replacement/factual correction 的同聚合校验。
- 更新 REDLINE_HALTED incident 匹配校验。
- 更新 migration 结构断言，不能只按对象名判断成功。

migration 必须：

- 在任何 DDL 前配套备份数据库和 JSONL。
- 同一事务 DROP 旧对象、CREATE 新对象、验证历史数据和写 ledger。
- 对无法确定 job_code 的历史 incident fail closed，不猜测或静默填默认值。
- 通过 `foreign_key_check`、`integrity_check` 和触发器行为测试后才提交。

### 2.4 运行代码

- 所有安全事件查询显式带 `job_code`。
- 创建、确认、解决、作废和事实修正 API 都校验三元键。
- 新 session 阻断查询使用三元键。
- 报告、异常中心和统计按三元键聚合。
- 不允许 UI 自行补默认 job_code。

### 2.5 M4 验收

| # | 场景 | 预期 |
|---|---|---|
| M4-01 | 同 student/task，不同 job | 仅目标 job 会话被熔断 |
| M4-02 | 同三元键 assessment + training | 两者均 REDLINE_HALTED，binding 各一条 |
| M4-03 | 同三元键存在未解决 incident | 新 assessment/training 均被阻断 |
| M4-04 | 不同 job 存在未解决 incident | 不阻断目标 job 新会话 |
| M4-05 | FACTUAL_CORRECTION 指向不同 job | 触发器拒绝 |
| M4-05A | REDLINE_HALTED session 绑定不同 job incident | 触发器拒绝 |
| M4-06 | 旧库迁移 | 行数、主键、状态、binding 不丢失 |
| M4-07 | 故障注入 | 整个 migration 回滚到完整 v0.1.16-report-framework |
| M4-08 | 既有业务回归 | 测评、训练、评分、报告、M3 assignment 全通过 |

## 3. M5A Command Bus Boundary

### 3.1 目标

先在当前进程内建立统一 Application Service / Command Bus，不立即搬进 utilityProcess。HTTP 和 IPC 的业务入口最终都调用同一命令处理器。

### 3.2 范围

- 定义 command envelope：command_id、command_type、actor、target、payload、request_hash、created_at。
- handler 只负责传输层鉴权、解析和错误映射。
- 领域命令负责事务、事件生成和投影更新。
- 为现有 assessment、training、assignment、安全事件、评分和报告建立命令映射。
- 保持当前 IPC 输入输出兼容。
- 为未来 AI 评分、AI 推荐保留独立命令类型，但本阶段不实现 AI 业务。

### 3.3 非范围

- 不增加 REST/SSE。
- 不启动 utilityProcess。
- 不改变现有 JSONL 物理格式。
- 不在此阶段引入网络框架依赖。

### 3.4 验收

- 同 command_id + 同 request_hash 重试返回同一结果，不重复写事件。
- 同 command_id + 不同 request_hash 被拒绝。
- IPC 回归响应结构不变。
- UI 无法绕过 Command Bus 直接写 session 状态。
- 所有写命令都有明确的 actor、聚合根和错误码。

## 4. M5B Event Batch 与 startupRecovery

### 4.1 目标

将当前单事件同步双写升级为 v2.2 三阶段协议：

```text
BATCH_PREPARED -> APPLY -> BATCH_COMMITTED
```

并实现冷启动恢复、hash chain、幂等投影和损坏隔离。

### 4.2 数据结构

- `command_log`
- `applied_event_batch`
- `processed_event`
- `projector_cursor`
- JSONL segment 与 `segment_index.json`

事件 payload 继续按 schema_version 向后兼容。旧单行事件迁移或导入必须有明确适配器，不允许直接丢弃。

### 4.3 写入协议

1. PREPARE：分配 sequence 和 batch，写入完整事件与 hash，fsync。
2. APPLY：SQLite `BEGIN IMMEDIATE`，写 batch、幂等记录和业务投影。
3. CONFIRM：写 `BATCH_COMMITTED`，fsync，更新 batch 状态。

不可在 APPLY 阶段临时生成未进入 PREPARE 的新领域事件。

### 4.4 startupRecovery

- 隔离或截断不完整尾部。
- 完成 APPLIED 未 CONFIRMED 的确认。
- 重放 PREPARED 未 APPLIED 的批次。
- 推进 projector cursor，并恢复未完成 command。
- hash、sequence 或 batch 事实冲突时进入 `CORRUPTION_DETECTED`，不猜测修复。

### 4.5 验收

- PREPARE、APPLY、CONFIRM 每个崩溃窗口都有故障注入测试。
- 同一事件重复重放只投影一次。
- SQLite 空库可从有效事件重建核心业务投影。
- 篡改 payload、previous hash 或 segment index 能被识别。
- 恢复失败时进入只读安全模式，允许审计导出。
- 旧 Pilot 事件能够迁移或通过兼容读取恢复。

## 5. M5C utilityProcess Local Server

### 5.1 目标

把领域服务、SQLite、Event Writer 和 Projector 从 Electron Main 移入 Local Application Server。Main 只保留窗口、Kiosk、进程生命周期、证书和系统能力。

### 5.2 迁移顺序

1. 在同进程 Command Bus 上完成全部回归。
2. 抽取不依赖 Electron API 的领域模块。
3. 建立 MessagePortMain 传输适配器。
4. utilityProcess 启动后执行 startupRecovery，再接受命令。
5. Main 异常退出或 Server 重启期间，Renderer 进入恢复蒙层。
6. 连续崩溃达到阈值时进入只读安全模式。

### 5.3 约束

- `src/main/` 本地模块继续使用静态 import。
- Local Server 不 import Electron API。
- 只有 Local Server 可打开 SQLite 写连接。
- Student Renderer 不连接网络端口。
- native addon 打包和 ABI 必须在生产构建、安装包和真实 Electron 中验证。

### 5.4 验收

- Main、Server、Renderer 进程边界可观测。
- Server 崩溃后自动重启并恢复确定状态。
- 重启期间不能重复提交命令或产生双写者。
- 现有学生端和教师本地流程功能不回退。
- 打包产物能加载 better-sqlite3，无 ABI 漂移。

## 6. M5D Teacher Web 与安全传输

### 6.1 目标

交付单校单节点的真实局域网教师平板入口。

### 6.2 范围

- Teacher Web 静态 SPA。
- HTTPS REST 命令和查询。
- SSE 只用于教师端增量通知。
- HttpOnly Cookie、CSRF token、Origin/Referer 校验。
- Node CA、叶子证书、指纹核对和配对流程。
- mDNS 服务发现。
- asset API 授权。
- Grant/Assignment/rebind/release 教师操作入口。

### 6.3 验收

- 未认证、无 CSRF、错误 Origin 的写请求被拒绝。
- 学生 Kiosk 不使用 SSE 或 HTTPS 业务接口。
- 教师只能读取授权学生、session 和资源。
- Server epoch 改变后 SSE 客户端执行完整 resync。
- 证书更新、设备重启和 runtime rebind 不丢失业务 session。
- 断网时学生 Kiosk 核心流程继续运行；教师端显示明确离线状态。

## 7. 与 AI 1.0 的关系

M4/M5 不直接实现模型调用，但必须为 AI 提供可靠边界：

- AI 请求作为 Command Bus 中的可审计命令。
- 大型音视频证据通过授权资源服务访问，不塞入事件 payload 或 SQLite base64。
- AI 结果先写独立 evaluation 记录，再由教师确认命令进入正式评分或推荐。
- 模型调用失败不会破坏原 assessment/training 状态机。
- 模型和提示版本属于冻结配置，历史 session 可追溯。

## 8. 发布与回滚原则

- 每个子阶段使用独立 schema/app 版本和 migration 记录。
- 不提供自动 down migration；降级使用迁移前 DB + JSONL 配套备份。
- schema、migration、handler、reducer、共享类型和测试必须同版本交付。
- 未通过真实 SQLite、故障注入和 Electron 冒烟的阶段不得进入下一阶段。
- M5C 前必须证明 M5A/M5B 在当前进程内稳定，避免同时调试业务边界、事件协议和进程通信。

## 9. 下一步原子任务

1. 独立审查 `doc/features/multi-device-m4-safety-rekey-prd.md`，关闭全部 P0/P1。
2. 基于当前 v0.1.16-report-framework 和真实 migration/handler 清单重新生成 M4 实现计划；2026-07-18 的 v0.1.15 任务书只作历史影响面参考，不得直接用于编码。
3. M4 实现计划独立审查通过后，实施并验收 Step 2A。
4. Step 2A 验收 `PASS` 后才启动 Step 2B M5A Command Bus 的独立工作流。
5. Step 2B 验收 `PASS` 后，按最终 mutation boundary 重基线并复审 Step 2C batch runtime PRD，再进入实现。
