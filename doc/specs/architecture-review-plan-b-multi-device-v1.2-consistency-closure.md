> **⚠️ 文档状态：SUPERSEDED（已废止）**
> 本文档已被 `architecture-plan-b-multi-device-v2.2-authoritative-baseline.md`（v2.2 唯一权威基线）取代，不再作为实施依据。
> 实施人员只阅读：当前正式 Schema（`src/main/db/schema.sql`）+ 当前正式 PRD（`MVP_PRD_v1.0.9-*.md`）+ v2.2 三份工件。

# 方案 B 架构一致性闭环修订稿 v1.2

> **基线：** v1.1 (commit a4eeee9)  
> **修订目标：** 关闭 v1.1 中识别出的 10 个跨领域一致性缺口，不改变总体架构方向。  
> **约束：** 纯文档修订，不产生代码变更。保留 v1.1 中所有正确设计，仅修补缺口。

---

## 修订总览

| # | 领域 | v1.1 缺口 | v1.2 修订摘要 |
|---|------|-----------|--------------|
| 一 | JSONL–SQLite 恢复协议 | `batch_status` 仅 `COMMITTED` 一个值，与 JSONL 层 `BATCH_COMMITTED` 标记含义混淆；恢复流程未明确不完整 JSONL 行的定义 | 引入 `APPLIED` 状态；明确恢复流程中"不完整行"的字节级判定规则 |
| 二 | command_log 幂等模型 | FAILED 后允许 INSERT 新记录违背唯一约束设计意图 | 单条记录原地重试；增加 `lease_owner`/`lease_expires_at`/`attempt_count`/`last_attempt_at` |
| 三 | safety_incident 继承 | v1.1 §十二重写了安全事件聚合但未明确与 schema v0.1.7 既有触发器的关系 | 声明继承关系，不重定义表结构 |
| 四 | HTTPS 信任启动 | 通配符 SAN、信任循环、混用算法 | 删除通配符 SAN；3 种部署模式；统一 ECDSA P-256 |
| 五 | grant rebinding | `delegated_access_grant` 在设备离线重连后如何重新绑定未定义 | 定义 rebind 协议与约束 |
| 六 | SSE/WebSocket 清理 | v1.1 §八已决策 SSE，但 §十六仍有 `ws_ticket` 残留定义 | 删除所有 WebSocket 残留 |
| 七 | Schema 一致性 | `delivery_phase` 枚举含 `OBSERVATION` 但 v1.1 §十一叫 `OBSERVATION_REQUIRED` | 对齐枚举值命名 |
| 八 | 离线评分阶段强制 | `delivery_phase` 允许 FINALIZED→OBSERVATION 倒退 | 声明单向不可逆 + 状态机校验 |
| 九 | 备份一致性 | 备份恢复缺少对 JSONL–SQLite 偏移同步的校验 | 增加 `backup_cut_batch_sequence`；定义 write barrier 和恢复原子性校验 |
| 十 | 文档实现错误 | 术语/伪代码/SQL 中的散落笔误 | 勘误表 |

---

## 一、JSONL–SQLite 恢复协议重设计

### 一-A：v1.1 缺口分析

v1.1 §七 定义 `applied_event_batch.batch_status` 的 CHECK 约束为 `IN ('COMMITTED')`——只有一个合法值。这导致：

1. **语义重叠：** JSONL 层的 `BATCH_COMMITTED` 标记行和 SQLite 中 `batch_status = 'COMMITTED'` 指代同一动作的不同视角，但在恢复流程中需要区分"SQLite 已投影但 JSONL 尚未写入确认标记"的中间状态。
2. **缺少 APPLYING 窗口表示：** Step 2（SQLite 事务）完成后、Step 3（JSONL COMMITTED 标记）写入前，SQLite 中的 batch 记录已存在但 JSONL 层尚无对应确认，此时 `batch_status` 应表达"已应用"而非"已确认"。
3. **不完整行的判定：** v1.1 伪代码 `truncateIncompleteTrailingLines` 未定义"不完整"的字节级规则。

### 一-B：修订后的 `applied_event_batch` 表

```sql
CREATE TABLE applied_event_batch (
  batch_id           TEXT PRIMARY KEY,
  batch_sequence     INTEGER NOT NULL UNIQUE,
  event_count        INTEGER NOT NULL,
  jsonl_offset_start INTEGER NOT NULL,
  jsonl_offset_end   INTEGER NOT NULL,
  batch_status       TEXT NOT NULL DEFAULT 'APPLIED'
    CHECK (batch_status IN ('APPLIED', 'CONFIRMED')),
  applied_at         TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at       TEXT  -- JSONL COMMITTED 标记写入完成的时间戳
);
```

**状态含义：**

| batch_status | 语义 | 何时设置 |
|---|---|---|
| `APPLIED` | SQLite 事务已 COMMIT，投影数据已持久化 | Step 2 的 COMMIT 内 INSERT |
| `CONFIRMED` | JSONL 已写入 `BATCH_COMMITTED` 标记并 fsync | Step 3 完成后 UPDATE |

### 一-C：修订后的写入协议

```
Step 1: PREPARE（不变）
  a. 生成 event_batch_id (UUID)
  b. 序列化事件为 JSONL 行
  c. 写入 JSONL: BATCH_PREPARED 标记行 + 事件行
  d. fsync JSONL 文件

Step 2: APPLY（SQLite 事务）
  BEGIN IMMEDIATE;
    INSERT INTO applied_event_batch (
      batch_id, batch_sequence, event_count,
      jsonl_offset_start, jsonl_offset_end, batch_status
    ) VALUES (?, ?, ?, ?, ?, 'APPLIED');
    -- 投影各事件到业务表（幂等操作）
    UPDATE projector_cursor
      SET last_batch_id = ?, last_batch_sequence = ?, updated_at = datetime('now')
      WHERE projector_name = 'main';
  COMMIT;

Step 3: CONFIRM
  a. 写入 JSONL: BATCH_COMMITTED 标记行
  b. fsync JSONL 文件
  c. UPDATE applied_event_batch
       SET batch_status = 'CONFIRMED', confirmed_at = datetime('now')
       WHERE batch_id = ?;
```

### 一-D：修订后的启动恢复流程

```typescript
async function startupRecovery(jsonlPath: string, db: Database): Promise<void> {
  // 1. 查找所有 APPLIED 但未 CONFIRMED 的 batch（SQLite 已提交，JSONL 标记缺失）
  const unconfirmedBatches = db.prepare(
    `SELECT batch_id, batch_sequence FROM applied_event_batch
     WHERE batch_status = 'APPLIED' ORDER BY batch_sequence`
  ).all();

  for (const batch of unconfirmedBatches) {
    // 补写 JSONL COMMITTED 标记
    appendCommittedMarker(jsonlPath, batch.batch_id, batch.batch_sequence);
    db.prepare(
      `UPDATE applied_event_batch
       SET batch_status = 'CONFIRMED', confirmed_at = datetime('now')
       WHERE batch_id = ?`
    ).run(batch.batch_id);
  }

  // 2. 从 JSONL 扫描 PREPARED 但在 applied_event_batch 中不存在的 batch
  const lastConfirmedSeq = db.prepare(
    `SELECT last_batch_sequence FROM projector_cursor WHERE projector_name = 'main'`
  ).get()?.last_batch_sequence ?? 0;

  const pendingBatches = scanPreparedBatches(jsonlPath, lastConfirmedSeq);

  for (const batch of pendingBatches) {
    const exists = db.prepare(
      `SELECT 1 FROM applied_event_batch WHERE batch_id = ?`
    ).get(batch.batch_id);

    if (!exists) {
      // JSONL 已写但 SQLite 未提交 → 重放
      replayBatch(db, batch);
    }
    // 补写 CONFIRMED 标记
    appendCommittedMarker(jsonlPath, batch.batch_id, batch.batch_sequence);
    db.prepare(
      `UPDATE applied_event_batch
       SET batch_status = 'CONFIRMED', confirmed_at = datetime('now')
       WHERE batch_id = ?`
    ).run(batch.batch_id);
  }

  // 3. 截断 JSONL 不完整尾部
  truncateIncompleteTrailingBytes(jsonlPath);
}
```

### 一-E：不完整 JSONL 行的字节级判定规则

**定义：** 从文件末尾向前扫描，找到最后一个 `\n` (0x0A) 字符。该 `\n` 之后的所有字节构成"不完整尾部"。

**判定流程：**

1. 若尾部为空（文件以 `\n` 结束）→ 文件完整，无需截断
2. 若尾部非空：
   a. 尝试将尾部解析为 JSON → 解析失败则截断到最后一个 `\n`
   b. 解析成功但 `type` 非 `BATCH_COMMITTED` 且无对应 `BATCH_PREPARED` 在前 → 截断
   c. 解析成功且属于一个完整的 prepared batch → 保留（该行有效）

**截断策略：** 用 `ftruncate` 将文件大小设置为最后一个合法 `\n` 的偏移量 + 1。不做原地覆写，不移动数据。

### 一-F：v1.1→v1.2 差异摘要

| 变更点 | v1.1 | v1.2 |
|--------|------|------|
| `applied_event_batch.batch_status` 枚举 | `('COMMITTED')` | `('APPLIED', 'CONFIRMED')` |
| 恢复流程起点 | 扫描 JSONL 中 PREPARED 标记 | 先处理 SQLite 中 APPLIED 未 CONFIRMED 的记录，再扫描 JSONL |
| 不完整行定义 | 未定义 | 字节级规则：最后一个 `\n` 之后的内容 |
| Step 3 后续 | 仅写 JSONL | 写 JSONL + UPDATE SQLite batch_status |
| `confirmed_at` 列 | 不存在 | 新增，记录 Step 3 完成时间 |

---

## 二、command_log 幂等模型修订

### 二-A：v1.1 缺口分析

v1.1 §5.6 第 5 步规定：`status = 'FAILED'` 时"允许重试，INSERT 新记录（新 command_id）"。这与唯一约束 `ux_command_idempotency ON (client_instance_id, idempotency_key)` 直接矛盾——INSERT 新记录需要不同的 idempotency_key，但换 key 就不再是同一命令的重试。

实质：v1.1 设计意图是"同一 idempotency_key 只有一条记录"，但处理逻辑允许 FAILED 后绕过该约束。

### 二-B：修订后的 `command_log` 表

```sql
CREATE TABLE command_log (
  command_id          TEXT PRIMARY KEY,
  idempotency_key    TEXT NOT NULL,
  client_instance_id TEXT NOT NULL,
  command_type       TEXT NOT NULL,
  actor_id           TEXT NOT NULL,
  device_id          TEXT,
  auth_session_id    TEXT,
  request_hash       TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN (
    'PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED')),
  event_batch_id     TEXT,
  result_json        TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  error_code         TEXT,
  error_message      TEXT,
  lease_owner        TEXT,
  lease_expires_at   TEXT,
  attempt_count      INTEGER NOT NULL DEFAULT 0,
  last_attempt_at    TEXT,
  max_attempts       INTEGER NOT NULL DEFAULT 3,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at       TEXT,
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX ux_command_idempotency
  ON command_log(client_instance_id, idempotency_key);
```

### 二-C：修订后的幂等处理逻辑

```
1. 收到命令 → 计算 request_hash

2. INSERT OR IGNORE INTO command_log (
     command_id, client_instance_id, idempotency_key,
     command_type, actor_id, request_hash, status
   ) VALUES (new_uuid, ?, ?, ?, ?, ?, 'PENDING');

3. SELECT * FROM command_log
   WHERE client_instance_id = ? AND idempotency_key = ?;

4. 根据 status 分支：

   SUCCEEDED:
     a. request_hash 匹配 → 返回原 result_json（幂等重放）
     b. 不匹配 → 409 CONFLICT

   PROCESSING:
     a. lease_expires_at < now() → 租约过期，转 FAILED，进入重试路径
     b. 租约有效 → 202 "command in progress"

   FAILED:
     a. attempt_count >= max_attempts → 429 "max retries exceeded"
     b. request_hash 匹配 → 原地重试（Step 5）
     c. 不匹配 → 409 CONFLICT

   PENDING:
     → Step 5（首次执行）

5. 获取租约：
   UPDATE command_log SET
     status = 'PROCESSING',
     lease_owner = ?,
     lease_expires_at = datetime('now', '+30 seconds'),
     attempt_count = attempt_count + 1,
     last_attempt_at = datetime('now'),
     updated_at = datetime('now')
   WHERE command_id = ?
     AND status IN ('PENDING', 'FAILED')
     AND (lease_expires_at IS NULL OR lease_expires_at < datetime('now'));
   -- 受影响行数 = 0 → 并发竞争失败，返回 409

6. 执行命令 → 更新结果：
   成功：UPDATE SET status='SUCCEEDED', result_json=?, event_batch_id=?, completed_at=now()
   失败：UPDATE SET status='FAILED', error_code=?, error_message=?, lease_owner=NULL
```

### 二-D：关键不变量

| 不变量 | 保证方式 |
|--------|----------|
| 同一 (client_instance_id, idempotency_key) 永远只有一条记录 | UNIQUE INDEX + INSERT OR IGNORE |
| FAILED 后重试不产生新记录 | 原地 UPDATE FAILED→PROCESSING |
| 同一时刻只有一个执行者 | `lease_owner` + `lease_expires_at` + WHERE 条件 |
| 超时释放 | `lease_expires_at < now()` 触发重试 |
| 有限重试 | `attempt_count >= max_attempts` 时拒绝 |

### 二-E：v1.1→v1.2 差异摘要

| 变更点 | v1.1 | v1.2 |
|--------|------|------|
| FAILED 后重试方式 | INSERT 新记录（新 command_id） | 原地 UPDATE 同一记录 |
| 初始 status | `PROCESSING` | `PENDING`（注册与执行分离） |
| 并发控制 | 仅靠 UNIQUE INDEX INSERT 失败 | 租约机制（lease_owner + expires） |
| 超时判定 | 检查 `created_at` | 显式 `lease_expires_at` |
| 重试上限 | 无 | `max_attempts` 默认 3 |
| 新增列 | — | `lease_owner`, `lease_expires_at`, `attempt_count`, `last_attempt_at`, `max_attempts` |

---

## 三、safety_incident 继承声明

### 三-A：v1.1 缺口分析

v1.1 §十二重写了安全事件独立聚合的架构描述，但未明确说明 `safety_incident` 表与 schema v0.1.7 中既有触发器的关系，导致读者无法判断 v1.1 的 §十二 是否要求修改表结构或触发器。

### 三-B：v1.2 声明

**v1.2 不修改 `safety_incident` 表结构，不修改 schema v0.1.7 中的任何触发器。**

v0.1.7 中的 `safety_incident` 触发器设计已满足 v1.1 §十二 的独立聚合要求：
- 触发器在事务内原子地将安全事件写入 `safety_incident` 表
- 该表不经过 projector，不依赖 JSONL 恢复路径
- 安全事件具有独立的持久化通道，与业务事件批次隔离

v1.2 §十二 的所有内容直接继承 v1.1 §十二，无变更。

---

## 四、HTTPS 信任启动重设计

### 四-A：v1.1 缺口分析

v1.1 §十六-A（第 1351 行附近）中证书 SAN 列表包含 `192.168.*.*`——通配符在 IP 地址 SAN 中无效（X.509 §4.2.1.6 规定 IP 地址 SAN 必须是字面 IP，不支持通配符匹配）。此外存在信任循环：首次配对时教师平板需要信任服务器证书，但获取证书需要先建立 HTTPS 连接。

### 四-B：修订后的证书 SAN 规则

```
# 证书 SAN 字段（v1.2）
# 删除: 192.168.*.*（无效通配符 IP SAN）
# 删除: *.local（通配符不用于局域网 mDNS 场景）

有效 SAN 条目：
  DNS:localhost
  IP:127.0.0.1
  IP:<服务器实际局域网 IP>    ← 安装/配对时确定，写入证书

密钥算法：统一 ECDSA P-256（secp256r1）
  - 废弃 RSA 2048（v1.1 中未明确算法，部分示例用 RSA）
  - P-256 生成速度快、证书体积小、TLS 握手耗时低
```

### 四-C：三种部署模式与信任启动

| 模式 | 场景 | 信任建立方式 |
|------|------|-------------|
| **单机模式** | 仅学生一体机 | 自签名证书 → Electron 内嵌 CA 证书，硬编码 PIN |
| **局域网配对模式** | 教师平板 + 学生一体机 | 带外配对：服务端生成证书指纹（SHA-256），在教师平板上通过二维码或手动输入确认 |
| **机构服务器模式** | 独立 Node 服务 | 由机构 CA 签发，教师平板信任机构 CA |

### 四-D：局域网配对的信任循环解决方案

**问题：** 教师平板首次访问 HTTPS 时，浏览器拒绝未知自签名证书。

**解决方案：** 配对走 HTTP 短暂端口，仅用于交换证书指纹，不传输业务数据：

```
配对流程（局域网配对模式）：
1. 服务端在 :7070 (HTTP) 临时暴露配对端点，仅响应 GET /api/v1/pair/fingerprint
   返回: { fingerprint: "<SHA-256-hex>", server_ip: "192.168.x.x", https_port: 7443 }
   该端点在配对完成后（或 5 分钟超时后）关闭

2. 教师平板访问 http://<ip>:7070/api/v1/pair/fingerprint（HTTP，无敏感数据）
   在配对 UI 中展示指纹，教师与学生一体机屏幕上显示的指纹比对确认

3. 教师平板调用原生 API（或引导用户）将该证书的 SHA-256 指纹加入信任列表
   此后所有请求走 HTTPS :7443

4. :7070 端口关闭，不再接受任何连接
```

### 四-E：v1.1→v1.2 差异摘要

| 变更点 | v1.1 | v1.2 |
|--------|------|------|
| IP SAN 通配符 | `192.168.*.*`（无效） | 实际局域网 IP 字面量 |
| `*.local` SAN | 存在 | 删除 |
| 密钥算法 | 未明确（部分示例 RSA） | 统一 ECDSA P-256 |
| 信任循环处理 | 未解决 | 带外 HTTP :7070 配对端点（仅传指纹）|
| 配对端点生命周期 | 未定义 | 配对完成或 5 分钟后关闭 |

---

## 五、delegated_access_grant Rebinding 协议

### 五-A：v1.1 缺口分析

v1.1 §5.4 定义了 `delegated_access_grant` 表，但未定义学生设备离线重连后如何处理已有的 ACTIVE grant：原 `device_runtime_session` 结束后新建了一个，grant 的 `device_runtime_session_id` 仍指向已 ENDED 的旧会话。

### 五-B：Rebind 触发条件

以下情形需要 rebind：
1. 学生一体机网络中断后重新上线（新 `device_runtime_session` 创建）
2. 学生一体机重启（新 `device_runtime_session` 创建）
3. 教师平板重新登录（新 `auth_session` + 新 `delegated_access_grant`）

### 五-C：Rebind 协议

```
设备重连时的 grant rebind：

前提：新 device_runtime_session_id = new_drs
      原 grant 状态 = ACTIVE，且 grant.expires_at > now()

1. 查找当前 ACTIVE grant:
   SELECT * FROM delegated_access_grant
   WHERE student_user_id = ?
     AND status = 'ACTIVE'
     AND expires_at > datetime('now');

2. 若找到（grant 未过期）：
   UPDATE delegated_access_grant
   SET device_runtime_session_id = new_drs,
       updated_at = datetime('now')
   WHERE grant_id = ?
     AND status = 'ACTIVE';

3. 若未找到（grant 已过期或不存在）：
   → 通知教师端重新授权（SSE 事件 device.reconnected）

4. Rebind 成功后，更新 business_session_assignment:
   -- assignment 不变，因为它绑定 device_id 而非 device_runtime_session_id
```

### 五-D：约束

- Rebind 仅允许在 grant 未过期时进行
- 同一 `device_runtime_session_id` 最多绑定一个 ACTIVE grant（由 `ux_grant_one_active_per_device_runtime` 保证）
- Rebind 不创建新记录，原地修改 `device_runtime_session_id`
- Rebind 操作由 Server 在收到设备重连心跳时自动触发，不需要教师手动操作

---

## 六、SSE/WebSocket 残留清理

### 六-A：v1.1 残留清单

v1.1 §八已决策使用 SSE，但以下位置仍保留 WebSocket 内容：

| 位置 | 残留内容 |
|------|----------|
| §十六-D（16.4）| `ws_ticket` 签发/验证协议全节 |
| §十七变更清单 | `ADD TABLE ws_ticket` 条目 |
| §十七变更清单 | `新文件 src/server/types/ws.ts` 条目 |
| §十八测试清单 | `ws_ticket 服务` 测试用例 |
| §十八测试清单 | `WebSocket 不在 URL 泄露 token` 测试用例 |

### 六-B：v1.2 删除内容

以下内容在 v1.2 中**不实现，不测试，不保留**：

```
删除:
  - ws_ticket 表定义
  - §16.4 整节（WebSocket 认证方案）
  - src/server/types/ws.ts
  - 所有 ws_ticket 相关测试用例
  - §十七变更清单中 WebSocket 相关条目

保留:
  - §八（SSE 认证、频道、断线重连）完整保留
  - Cookie-based 认证用于 SSE 连接（不受影响）
```

### 六-C：修订后的 §十七 变更清单（WebSocket 条目）

| v1.1 原条目 | v1.2 状态 |
|-------------|-----------|
| `ADD TABLE ws_ticket` | **删除** |
| `新文件 src/server/types/ws.ts` | **删除**（SSE 类型定义直接内联或放 `src/server/types/sse.ts`） |

---

## 七、delivery_phase 枚举命名对齐

### 七-A：v1.1 不一致

v1.1 §5.9 的 Schema CHECK 约束中枚举值为 `OBSERVATION`：

```sql
CHECK (delivery_phase IN (
  'PREPARED', 'ASSIGNED', 'STUDENT_CONFIRMED', 'ONLINE_IN_PROGRESS',
  'ONLINE_COMPLETED', 'OFFLINE_SCORING', 'OBSERVATION', 'FINALIZED'))
```

v1.1 §十一 状态机图中标注为 `OBSERVATION_REQUIRED`（描述性文字）但流程图用 `OBSERVATION`。两处描述不完全统一，造成实现时歧义。

### 七-B：v1.2 决策

**统一使用 `OBSERVATION` 作为枚举值**（以 Schema CHECK 约束为准）。

`OBSERVATION_REQUIRED` 仅作为该状态的中文语义说明（即"需要教师补充观察记录"），不是枚举字面量。

完整枚举值（不变）：

```
'PREPARED' → 'ASSIGNED' → 'STUDENT_CONFIRMED' → 'ONLINE_IN_PROGRESS'
→ 'ONLINE_COMPLETED' → 'OFFLINE_SCORING' → 'OBSERVATION' → 'FINALIZED'
```

所有文档、代码、测试中统一使用上述字面量。

---

## 八、delivery_phase 单向不可逆强制

### 八-A：v1.1 缺口

v1.1 §十三（REST API）第 1079-1080 行存在以下逻辑：

```
6. 更新 delivery_phase = FINALIZED
7. 若有观察记录模板，更新 delivery_phase = OBSERVATION（等待教师补充观察后再 finalize）
```

第 7 步将已达到 `FINALIZED` 的会话倒退到 `OBSERVATION`——这违反 §十一 状态分离矩阵中"终态不可逆"的不变量。

### 八-B：修订后的状态机规则

```
合法迁移（严格单向）：
PREPARED → ASSIGNED
ASSIGNED → STUDENT_CONFIRMED
STUDENT_CONFIRMED → ONLINE_IN_PROGRESS
ONLINE_IN_PROGRESS → ONLINE_COMPLETED
ONLINE_COMPLETED → OFFLINE_SCORING
OFFLINE_SCORING → OBSERVATION    （有观察模板时）
OFFLINE_SCORING → FINALIZED      （无观察模板时直接结束）
OBSERVATION → FINALIZED

禁止的迁移（v1.2 明确声明）：
FINALIZED → 任何状态   ← 终态，不可逆
OBSERVATION → OFFLINE_SCORING ← 不允许回退到评分阶段
```

### 八-C：修订后的离线评分提交逻辑

v1.1 §十三 中导致倒退的逻辑修改为：

```
评分提交流程（v1.2）：

1. 验证 delivery_phase = 'OFFLINE_SCORING'（非此状态 → 409）
2. 写入评分数据
3. 判断是否有观察记录模板（observation_template_id IS NOT NULL）：
   - 有 → 迁移 delivery_phase: OFFLINE_SCORING → OBSERVATION
   - 无 → 迁移 delivery_phase: OFFLINE_SCORING → FINALIZED
4. 生成相应事件（OFFLINE_SCORES_FINALIZED 或 OBSERVATION_REQUIRED）
5. 不存在"先 FINALIZED 后退回 OBSERVATION"的路径
```

### 八-D：Domain Layer 实现约束

```typescript
const VALID_TRANSITIONS: Record<string, string[]> = {
  'PREPARED':            ['ASSIGNED'],
  'ASSIGNED':            ['STUDENT_CONFIRMED'],
  'STUDENT_CONFIRMED':   ['ONLINE_IN_PROGRESS'],
  'ONLINE_IN_PROGRESS':  ['ONLINE_COMPLETED'],
  'ONLINE_COMPLETED':    ['OFFLINE_SCORING'],
  'OFFLINE_SCORING':     ['OBSERVATION', 'FINALIZED'],
  'OBSERVATION':         ['FINALIZED'],
  'FINALIZED':           [],  // 终态，空列表
};

function assertDeliveryPhaseTransition(from: string, to: string): void {
  const allowed = VALID_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new InvalidStateTransitionError(
      `delivery_phase: ${from} → ${to} is not permitted`
    );
  }
}
```

---

## 九、备份一致性修订

### 九-A：v1.1 缺口分析

v1.1 §十五 定义了备份与恢复流程，但未解决备份时 JSONL 文件字节偏移与 SQLite `applied_event_batch` 记录之间的同步问题：若备份发生在 Step 2（SQLite COMMIT）之后、Step 3（JSONL COMMITTED 标记）之前，恢复时 JSONL 文件可能缺少对应的确认标记，而 SQLite 中已有 batch 记录，导致恢复流程进入歧义状态。

### 九-B：新增 `backup_cut_batch_sequence`

备份元数据表新增字段：

```sql
-- 追加到 v1.1 §十五 定义的 backup_manifest 表
ALTER TABLE backup_manifest ADD COLUMN
  cut_batch_sequence   INTEGER;  -- 备份时 projector_cursor.last_batch_sequence 的快照值
ALTER TABLE backup_manifest ADD COLUMN
  cut_jsonl_byte_offset INTEGER; -- 备份时 JSONL 文件的字节大小（fsync 后）
ALTER TABLE backup_manifest ADD COLUMN
  cut_at               TEXT;     -- 备份切割时间戳
```

### 九-C：备份流程的 Write Barrier

```
备份流程（v1.2）：

1. 暂停新的 event batch 写入（通知 Command Bus 进入 BACKUP_FREEZE 模式）
   最长等待 5 秒，超时则备份失败

2. 等待所有 in-flight batch 完成（status = 'CONFIRMED' 或 'FAILED'）
   轮询 applied_event_batch WHERE status = 'APPLIED' 直到为空（或 10 秒超时）

3. 记录 write barrier 时间点：
   cur_seq = SELECT last_batch_sequence FROM projector_cursor WHERE projector_name = 'main'
   cur_offset = stat(jsonl_file).size

4. 执行 SQLite 备份（使用 backup API 或 cp WAL-checkpointed file）

5. 复制 JSONL 文件（截取到 cur_offset 字节，不包含 barrier 后的内容）

6. 更新 backup_manifest:
   INSERT INTO backup_manifest (
     ..., cut_batch_sequence, cut_jsonl_byte_offset, cut_at
   ) VALUES (..., cur_seq, cur_offset, datetime('now'))

7. 恢复 Command Bus（退出 BACKUP_FREEZE 模式）
```

### 九-D：恢复原子性校验

恢复时的一致性验证：

```
恢复校验流程：

1. 读取 backup_manifest.cut_batch_sequence = N
2. 验证恢复后 SQLite 中：
   SELECT last_batch_sequence FROM projector_cursor WHERE projector_name = 'main' = N
   → 不等 → 数据不一致，恢复失败

3. 验证 JSONL 文件长度 = cut_jsonl_byte_offset（或更大，超出部分在重放中处理）

4. 运行 startupRecovery()（§一-D），处理 barrier 之后可能的部分批次
```

---

## 十、勘误表

以下为 v1.1 中散落的笔误，v1.2 统一修正。

| 位置 | v1.1 原文 | v1.2 修正 | 类型 |
|------|-----------|-----------|------|
| §五.7 applied_event_batch CHECK | `IN ('COMMITTED')` | `IN ('APPLIED', 'CONFIRMED')` | Schema 变更（§一-B） |
| §五.6 幂等逻辑第 5 步 | "INSERT 新记录（新 command_id）" | 原地 UPDATE（§二-C） | 逻辑错误 |
| §十六-A SAN | `192.168.*.*`, `*.local` | 删除通配符（§四-B） | 协议错误 |
| §十六-D 整节 | ws_ticket 协议 | 删除（§六-B） | 已废弃 |
| §十七 变更清单 | `ADD TABLE ws_ticket` | 删除（§六-C） | 已废弃 |
| §十三 离线评分步骤 7 | `delivery_phase = OBSERVATION`（从 FINALIZED 回退） | 删除（§八-C） | 状态机违规 |
| §十一 状态机描述 | `OBSERVATION_REQUIRED`（部分描述性文字） | `OBSERVATION`（§七-B） | 命名不一致 |
| §七-E 启动恢复 | `appendCommittedMarker` 仅写 JSONL | 写 JSONL + UPDATE `batch_status='CONFIRMED'`（§一-D） | 遗漏 SQLite 更新 |

---

## 附：本文与 v1.1 的关系

本文 (v1.2) 是 v1.1 的一致性修订补丁，不替换 v1.1：

- v1.1 中未被本文涉及的所有章节（§一至§六、§八至§十一、§十二、§十三、§十四、§十八至§二十）直接继承，无变更
- 当 v1.1 与 v1.2 内容冲突时，以 v1.2 为准
- v1.2 不引入新的架构概念，仅修补 v1.1 的内部不一致
