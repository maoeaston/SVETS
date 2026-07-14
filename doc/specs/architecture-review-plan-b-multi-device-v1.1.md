> **⚠️ 文档状态：SUPERSEDED（已废止）**
> 本文档已被 `architecture-plan-b-multi-device-v2.2-authoritative-baseline.md`（v2.2 唯一权威基线）取代，不再作为实施依据。
> 实施人员只阅读：当前正式 Schema（`src/main/db/schema.sql`）+ 当前正式 PRD（`MVP_PRD_v1.0.9-*.md`）+ v2.2 三份工件。

# 方案 B 架构审查报告 v1.1：Electron 内嵌本地服务 + 教师平板浏览器 + 学生触摸一体机

> **修订说明：** 本文在 v1.0 基础上逐项关闭交叉评审提出的 18 条架构问题。  
> 原则：保留方案 B 总体方向，不推翻双端设计，不退回单机切换。  
> 变更标记：`[v1.1]` 表示修订或新增内容。

---

## 变更日志

| 编号 | 审查问题 | 关闭位置 | 级别 |
|------|----------|----------|------|
| 1 | JSONL-SQLite 可恢复一致性 | §七 | P0 |
| 2 | 安全事件独立聚合 | §十二 | P0 |
| 3 | HTTPS/证书/信任 | §二十-A | P0 |
| 4 | WebSocket token 安全 | §八 | P0 |
| 5 | 身份/设备/授权/分配/会话概念分离 | §四 | P0 |
| 6 | 业务状态与连接状态分离 | §十一 | P1 |
| 7 | 独立 business_session_assignment | §四-C | P0 |
| 8 | Schema 约束缺口 | §五 | P1 |
| 9 | command_log 幂等模型重构 | §五.4 | P1 |
| 10 | 重复命令收敛 | §七-REST | P1 |
| 11 | 线下评分草稿+确认 | §七-REST | P1 |
| 12 | 多学校/多班级预留 | §十四 | P2 |
| 13 | 学生可见性控制 | §九 | P1 |
| 14 | 备份恢复合同 | §十五 | P1 |
| 15 | 局域网发现与配对 | §二十-B | P1 |
| 16 | CORS 不作为认证 | §二十-C | P1 |
| 17 | 教师端实时通信重评估 | §八 | P1 |
| 18 | better-sqlite3 事实修正 | §二 | P2 |

---

## 一、推荐拓扑图 [v1.1 修订]

```
┌──────────────────────────────────────────────────────────────────┐
│              Local Application Server (utilityProcess)             │
│  ┌───────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ HTTPS + SSE   │  │ Command Bus  │  │  Event Store (JSONL) │  │
│  │  (Fastify)    │──│ + Auth Gate  │──│  + SQLite Projector  │  │
│  └───────┬───────┘  └──────────────┘  └──────────────────────┘  │
│          │               ▲                                        │
│          │               │ MessagePort                            │
└──────────┼───────────────┼────────────────────────────────────────┘
           │               │
     ┌─────┴──────┐  ┌────┴──────────────────────┐
     │  Teacher   │  │  Electron Main             │
     │  Tablet    │  │  (Window + Kiosk            │
     │  Browser   │  │   + Process Lifecycle)      │
     │  (HTTPS)   │  │        │                    │
     └────────────┘  │  ┌─────┴──────────┐        │
                     │  │ Student Renderer │        │
                     │  │ (Vue SPA, IPC)   │        │
                     │  └──────────────────┘        │
                     └──────────────────────────────┘
```

**v1.1 拓扑变更：**
- HTTP → HTTPS（第一阶段即启用自签名证书）
- WebSocket → SSE（教师端实时推送，详见 §八 重评估）
- 学生端仍走 IPC MessagePort，不经过网络

---

## 二、进程边界与模块边界 [v1.1 修订]

### 推荐方案：utilityProcess 托管 Local Server

| 层 | 运行位置 | 职责 | 通信 |
|---|---|---|---|
| **Electron Main** | 主进程 | 窗口管理、Kiosk 强制、utilityProcess 生命周期、证书管理、mDNS 广播 | MessagePort → Server |
| **Local Application Server** | utilityProcess | HTTPS 监听、认证、Command Bus、Domain Layer、SQLite、JSONL、资源服务 | MessagePort ← Main; HTTPS ← Teacher |
| **Student Renderer** | BrowserWindow | Vue SPA 学生界面 | IPC → Main → MessagePort → Server |
| **Teacher Web** | 教师平板浏览器 | 独立 Vue SPA（由 Server 静态托管）| HTTPS REST + SSE → Server |

### 为什么选 utilityProcess [v1.1 事实修正：关闭审查 #18]

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| **同进程** | 零 IPC 开销 | Main 崩溃 = 全崩；同步 DB 调用阻塞 Main 事件循环影响窗口响应 | ❌ |
| **Worker Thread** | 共享内存、低开销 | better-sqlite3 *技术上支持* Worker Thread，但 Electron 打包中 native addon 的 Worker 加载路径复杂且不稳定 | ⚠️ 不推荐 |
| **utilityProcess** | Electron 原生子进程、独立 V8 实例、native addon 正常加载、**崩溃隔离**（Server 崩不影响 Main/Renderer）、Main 可监管生命周期并自动重启、**未来可直接抽为独立 Node 服务** | MessagePort 序列化开销（局域网场景可忽略） | ✅ 推荐 |
| **独立 Node 子进程** | 完全解耦 | 需打包 Node runtime、增加体积、Electron 监管复杂 | Phase 2 演进目标 |

> **[v1.1] 修正：** v1.0 错误声称 "better-sqlite3 不支持 Worker Thread"。实际上 better-sqlite3 可以在 Worker Thread 中运行（只要 native binding 路径正确）。选择 utilityProcess 的真实理由是：崩溃隔离、生命周期管理简单、Main 进程不阻塞、与 Phase 2 独立服务化路径对齐。

### 未来演进路径（不变）

```
Phase 1 (当前): utilityProcess 内嵌于 Electron
Phase 2 (学校服务器): 抽出为独立 Node 服务
Phase 3 (中央平台): Node 服务 + PostgreSQL + 云部署
```

---

## 三、数据流（保留，无变更）

### 学生答题流程
```
Student Renderer
  → ipcRenderer.invoke('cmd:submitAnswer', {sessionId, questionId, payload})
  → Electron Main (IPC Bridge)
  → MessagePort.postMessage → utilityProcess
  → Server: AuthGate.resolveCallerFromIPC(deviceSessionId)
  → Server: CommandBus.dispatch('SubmitAnswer', {actorId, sessionId, questionId, payload})
  → Domain: validate + score
  → Infra: ConsistencyProtocol.writeEventBatch(...)
  → Server: NotificationBus.emit(...)
  → SSE push to Teacher (if subscribed)
  → Response → MessagePort → IPC → Renderer
```

### 教师线下评分流程
```
Teacher Browser
  → fetch('POST /api/v1/session-assignments/:assignmentId/offline-scores', {scores, draft:false})
  → Server: AuthGate.verifySessionCookie() + assertRole(TEACHER)
  → Server: CommandBus.dispatch('FinalizeOfflineScores', {actorId, assignmentId, scores})
  → Domain: validate + calculate
  → Infra: ConsistencyProtocol.writeEventBatch(...)
  → SSE push to Student (via IPC bridge notification)
  → HTTP 200 response
```

---

## 四、身份、设备、授权、分配与业务会话关系模型 [v1.1 全面重构：关闭 #5, #7]

### 四-A：概念分离定义

| 概念 | 定义 | 生命周期 | 存储 |
|---|---|---|---|
| **Device Credential** | 设备的长期信任凭证（配对时建立） | 设备注销前永久 | `device.credential_hash` |
| **Device Runtime Session** | 设备一次开机到关机的活跃期 | 开机→关机/心跳超时 | `device_runtime_session` |
| **User Auth Session** | 用户一次认证的会话 | 登录→登出/过期/撤销 | `auth_session` |
| **Delegated Access Grant** | 教师代学生创建的受限访问授权 | 教师授权→释放/超时 | `delegated_access_grant` |
| **Business Session Assignment** | 业务会话到设备+学生的分配关系 | 分配→释放/完成/撤销 | `business_session_assignment` |
| **Assessment Session** | 测评业务会话（状态机） | INIT→终态 | `assessment_session` |
| **Training Session** | 训练业务会话（状态机） | INIT→终态 | `training_session` |

### 四-B：关系图

```
┌─ Organization/School ───────────────────────────────────────────────────────┐
│  organization_id (UUID), node_id (globally unique)                           │
│                                                                              │
│  ┌─ Device ────────────────┐        ┌─ User Account ─────────────────────┐ │
│  │ device_id (UUID)         │        │ user_id (UUID)                     │ │
│  │ credential_hash          │        │ role: STUDENT | TEACHER | ADMIN    │ │
│  │ trust_state              │        │ organization_id FK                 │ │
│  └──────────┬───────────────┘        └────────────────┬──────────────────┘ │
│             │                                          │                     │
│  ┌──────────┴────────────────┐        ┌───────────────┴────────────────┐   │
│  │ Device Runtime Session     │        │ User Auth Session              │   │
│  │ device_runtime_session_id  │        │ auth_session_id                │   │
│  │ device_id FK               │        │ user_id FK                     │   │
│  │ started_at, ended_at       │◄──────►│ device_runtime_session_id FK   │   │
│  │ status: ACTIVE|ENDED       │        │ auth_method: PASSWORD |        │   │
│  │ ── UNIQUE: one ACTIVE ──   │        │   DELEGATED | PIN | DEVICE_KEY │   │
│  └────────────────────────────┘        │ status: ACTIVE|EXPIRED|REVOKED │   │
│                                         └───────────────┬────────────────┘   │
│                                                         │                    │
│  ┌──────────────────────────────────────────────────────┼──────────────────┐ │
│  │ Delegated Access Grant (教师→学生受限授权)            │                  │ │
│  │ grant_id                                             │                  │ │
│  │ teacher_auth_session_id FK ──────────────────────────┘                  │ │
│  │ student_user_id FK                                                      │ │
│  │ device_runtime_session_id FK (学生设备)                                 │ │
│  │ capabilities_json                                                       │ │
│  │ status: ACTIVE | RELEASED | EXPIRED                                     │ │
│  └──────────────────────────────────────────────────────┬──────────────────┘ │
│                                                         │                    │
│  ┌──────────────────────────────────────────────────────┼──────────────────┐ │
│  │ Business Session Assignment                          │                  │ │
│  │ assignment_id (UUID)                                 │                  │ │
│  │ business_session_type: ASSESSMENT | TRAINING         │                  │ │
│  │ business_session_id FK                               │                  │ │
│  │ student_user_id FK                                   │                  │ │
│  │ device_id FK                                         │                  │ │
│  │ delegated_access_grant_id FK (nullable)              │                  │ │
│  │ assigned_by FK (teacher user_id)                     │                  │ │
│  │ assigned_at                                          │                  │ │
│  │ student_confirmed_at (nullable)                      │                  │ │
│  │ released_at (nullable)                               │                  │ │
│  │ release_reason                                       │                  │ │
│  │ replaced_by_assignment_id (nullable)                 │                  │ │
│  │ version (并发控制)                                   │                  │ │
│  │ status: PENDING_CONFIRM | ACTIVE | RELEASED | VOID   │                  │ │
│  └──────────────────────────────────────────────────────┘──────────────────┘ │
│                                                                              │
│  ┌─ Assessment Session ───────────┐  ┌─ Training Session ────────────────┐ │
│  │ (业务状态机，不含分配字段)      │  │ (同构)                            │ │
│  │ status: 权威业务状态            │  │                                   │ │
│  │ event_sequence_version          │  │                                   │ │
│  └─────────────────────────────────┘  └───────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 四-C：Business Session Assignment 详细设计 [关闭 #7]

```sql
-- 见 §五 完整 DDL
```

**关键规则：**
1. assessment_session / training_session 表本身**不再**包含 `assigned_device_id` 或 `assigned_auth_session_id`
2. 分配关系通过独立的 `business_session_assignment` 表管理
3. 一个业务会话同一时刻最多一个 ACTIVE 分配（UNIQUE 约束）
4. 一个设备同一时刻最多一个 ACTIVE 学生分配（UNIQUE 约束）
5. 分配历史完整保留（released_at + release_reason）
6. 教师换设备 = 释放旧分配 + 创建新分配（replaced_by_assignment_id 链接）

### 四-D：Kiosk 启动流程 [关闭 #5 中 Kiosk 问题]

**v1.1 修正：** Kiosk 外壳启动时尚未确定学生身份，因此不创建任何用户级 auth_session。

```
1. Electron 启动 → 创建 device_runtime_session（仅设备层面）
2. 设备连接 Server → 使用 device credential 认证 → 获得 device_session_token
3. Kiosk 界面显示"等待教师分配"（无用户身份）
4. 教师在平板发起 POST /session-assignments → 指定学生+设备+业务会话
5. Server 创建 delegated_access_grant + business_session_assignment
6. Server 通过 IPC 通知学生端设备"有新分配"
7. 学生端显示身份确认界面（PIN/头像/确认按钮）
8. 学生确认 → Server 更新 assignment.student_confirmed_at
9. 业务会话进入 ACTIVE 阶段
```

---

## 五、Schema 草案 [v1.1 全面修订：关闭 #8, #9]

### 5.0 全局约束规范 [关闭 #8]

**所有表统一遵守：**
- 布尔字段：`INTEGER NOT NULL DEFAULT 0 CHECK (col IN (0, 1))`
- JSON 字段：`TEXT CHECK (col IS NULL OR json_valid(col))`
- updated_at：由应用层在每次 UPDATE 时显式 SET；不依赖 trigger（SQLite trigger 在 WAL 模式下有性能影响）
- online_status 类瞬态字段：仅存于内存 Map，数据库只存 `last_heartbeat_at`（启动时根据超时阈值推算状态）

### 5.1 `device` — 设备注册 [v1.1 修订]

```sql
CREATE TABLE device (
  device_id           TEXT PRIMARY KEY,
  device_name         TEXT NOT NULL,
  device_role         TEXT NOT NULL CHECK (device_role IN (
    'STUDENT_WORKSTATION', 'TEACHER_TABLET', 'ADMIN_TERMINAL', 'HYBRID')),
  organization_id     TEXT NOT NULL DEFAULT '__default__',
  node_id             TEXT NOT NULL,  -- 全局唯一，安装时生成 UUID
  credential_hash     TEXT,           -- PBKDF2-SHA512 of device pairing secret
  trust_state         TEXT NOT NULL DEFAULT 'PENDING' CHECK (trust_state IN (
    'PENDING', 'TRUSTED', 'REVOKED')),
  is_kiosk_enabled    INTEGER NOT NULL DEFAULT 0 CHECK (is_kiosk_enabled IN (0, 1)),
  allows_self_login   INTEGER NOT NULL DEFAULT 1 CHECK (allows_self_login IN (0, 1)),
  capabilities_json   TEXT CHECK (capabilities_json IS NULL OR json_valid(capabilities_json)),
  last_heartbeat_at   TEXT,
  status              TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN (
    'ACTIVE', 'DISABLED', 'DECOMMISSIONED')),
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
-- [v1.1] 去除 online_status 列；在线状态由内存管理
-- [v1.1] node_id 不再默认 'local'，安装时生成 UUID
-- [v1.1] 去除 assigned_student_id（分配关系走 business_session_assignment）
```

### 5.2 `device_runtime_session` — 设备运行时会话 [v1.1 重命名+约束]

```sql
CREATE TABLE device_runtime_session (
  device_runtime_session_id  TEXT PRIMARY KEY,
  device_id                  TEXT NOT NULL REFERENCES device(device_id),
  started_at                 TEXT NOT NULL DEFAULT (datetime('now')),
  last_heartbeat_at          TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at                   TEXT,
  end_reason                 TEXT CHECK (end_reason IS NULL OR end_reason IN (
    'HEARTBEAT_TIMEOUT', 'GRACEFUL_SHUTDOWN', 'ADMIN_TERMINATED', 'REPLACED')),
  client_version             TEXT,
  status                     TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN (
    'ACTIVE', 'ENDED')),
  created_at                 TEXT NOT NULL DEFAULT (datetime('now'))
);

-- [v1.1 关闭 #8] 一台设备最多一个 ACTIVE runtime session
CREATE UNIQUE INDEX ux_device_one_active_runtime
  ON device_runtime_session(device_id) WHERE status = 'ACTIVE';
```

### 5.3 `auth_session` — 用户认证会话 [v1.1 修订]

```sql
CREATE TABLE auth_session (
  auth_session_id            TEXT PRIMARY KEY,
  user_id                    TEXT NOT NULL REFERENCES user_account(user_id),
  device_runtime_session_id  TEXT REFERENCES device_runtime_session(device_runtime_session_id),
  auth_method                TEXT NOT NULL CHECK (auth_method IN (
    'PASSWORD', 'DELEGATED', 'PIN', 'DEVICE_KEY')),
  granted_by                 TEXT REFERENCES user_account(user_id),
  capabilities_json          TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(capabilities_json)),
  token_hash                 TEXT NOT NULL UNIQUE,
  refresh_token_hash         TEXT UNIQUE,
  issued_at                  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at                 TEXT NOT NULL,
  last_activity_at           TEXT NOT NULL DEFAULT (datetime('now')),
  status                     TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN (
    'ACTIVE', 'EXPIRED', 'REVOKED')),
  revoke_reason              TEXT,
  created_at                 TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                 TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_auth_session_user_status ON auth_session(user_id, status);
CREATE INDEX idx_auth_session_token ON auth_session(token_hash);
```

### 5.4 `delegated_access_grant` — 教师代授权 [v1.1 新增：关闭 #5]

```sql
CREATE TABLE delegated_access_grant (
  grant_id                   TEXT PRIMARY KEY,
  teacher_auth_session_id    TEXT NOT NULL REFERENCES auth_session(auth_session_id),
  teacher_user_id            TEXT NOT NULL REFERENCES user_account(user_id),
  student_user_id            TEXT NOT NULL REFERENCES user_account(user_id),
  device_runtime_session_id  TEXT NOT NULL REFERENCES device_runtime_session(device_runtime_session_id),
  capabilities_json          TEXT NOT NULL CHECK (json_valid(capabilities_json)),
  status                     TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN (
    'ACTIVE', 'RELEASED', 'EXPIRED', 'REVOKED')),
  granted_at                 TEXT NOT NULL DEFAULT (datetime('now')),
  released_at                TEXT,
  release_reason             TEXT,
  expires_at                 TEXT NOT NULL,
  created_at                 TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                 TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 一个设备运行时会话同一时刻最多一个 ACTIVE grant
CREATE UNIQUE INDEX ux_grant_one_active_per_device_runtime
  ON delegated_access_grant(device_runtime_session_id) WHERE status = 'ACTIVE';
```

### 5.5 `business_session_assignment` — 业务会话分配 [v1.1 新增：关闭 #7]

```sql
CREATE TABLE business_session_assignment (
  assignment_id              TEXT PRIMARY KEY,
  business_session_type      TEXT NOT NULL CHECK (business_session_type IN (
    'ASSESSMENT', 'TRAINING', 'LEARNING')),
  business_session_id        TEXT NOT NULL,
  student_user_id            TEXT NOT NULL REFERENCES user_account(user_id),
  device_id                  TEXT NOT NULL REFERENCES device(device_id),
  delegated_access_grant_id  TEXT REFERENCES delegated_access_grant(grant_id),
  assigned_by                TEXT NOT NULL REFERENCES user_account(user_id),
  assigned_at                TEXT NOT NULL DEFAULT (datetime('now')),
  student_confirmed_at       TEXT,
  released_at                TEXT,
  release_reason             TEXT CHECK (release_reason IS NULL OR release_reason IN (
    'COMPLETED', 'TEACHER_RELEASED', 'DEVICE_OFFLINE', 'REPLACED', 'ADMIN_REVOKED')),
  replaced_by_assignment_id  TEXT REFERENCES business_session_assignment(assignment_id),
  version                    INTEGER NOT NULL DEFAULT 1,
  status                     TEXT NOT NULL DEFAULT 'PENDING_CONFIRM' CHECK (status IN (
    'PENDING_CONFIRM', 'ACTIVE', 'RELEASED', 'VOID')),
  created_at                 TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                 TEXT NOT NULL DEFAULT (datetime('now'))
);

-- [v1.1 关闭 #8] 一个业务会话最多一个有效分配
CREATE UNIQUE INDEX ux_assignment_one_active_per_session
  ON business_session_assignment(business_session_type, business_session_id)
  WHERE status IN ('PENDING_CONFIRM', 'ACTIVE');

-- [v1.1 关闭 #8] 一个设备最多一个有效学生分配
CREATE UNIQUE INDEX ux_assignment_one_active_per_device
  ON business_session_assignment(device_id)
  WHERE status IN ('PENDING_CONFIRM', 'ACTIVE');
```

### 5.6 `command_log` — 幂等命令追踪 [v1.1 重构：关闭 #9]

```sql
CREATE TABLE command_log (
  command_id          TEXT PRIMARY KEY,
  idempotency_key    TEXT NOT NULL,
  client_instance_id TEXT NOT NULL,      -- 客户端实例标识（区分同一用户多设备）
  command_type       TEXT NOT NULL,
  actor_id           TEXT NOT NULL,
  device_id          TEXT,
  auth_session_id    TEXT,
  request_hash       TEXT NOT NULL,      -- SHA-256 of canonical payload
  status             TEXT NOT NULL DEFAULT 'PROCESSING' CHECK (status IN (
    'PROCESSING', 'SUCCEEDED', 'FAILED')),
  event_batch_id     TEXT,               -- 关联的事件批次 ID
  result_json        TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  error_code         TEXT,
  error_message      TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at       TEXT,
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 幂等键唯一：同一 client_instance + idempotency_key 只允许一条
CREATE UNIQUE INDEX ux_command_idempotency
  ON command_log(client_instance_id, idempotency_key);

-- 并发控制：PROCESSING 状态的同一 idempotency_key 只允许一个执行者
-- 利用 UNIQUE INDEX 在 INSERT 时自动保证
```

**幂等处理逻辑 [关闭 #9]：**

```
1. 收到命令 → 计算 request_hash
2. 查询 command_log WHERE client_instance_id = ? AND idempotency_key = ?
3. 若存在且 status = 'SUCCEEDED':
   a. 验证 request_hash 匹配 → 返回原 result_json（幂等重放）
   b. request_hash 不匹配 → 返回 409 CONFLICT
4. 若存在且 status = 'PROCESSING':
   a. 检查 created_at 是否超时（30s） → 超时则标记 FAILED，重新执行
   b. 未超时 → 返回 409 "command in progress"
5. 若存在且 status = 'FAILED' → 允许重试，INSERT 新记录（新 command_id）
6. 若不存在 → INSERT (status=PROCESSING) → 执行命令 → UPDATE (SUCCEEDED/FAILED)
```

### 5.7 `applied_event_batch` — 事件批次投影追踪 [v1.1 新增：关闭 #1]

```sql
CREATE TABLE applied_event_batch (
  batch_id           TEXT PRIMARY KEY,
  batch_sequence     INTEGER NOT NULL UNIQUE,  -- 单调递增全局序号
  event_count        INTEGER NOT NULL,
  jsonl_offset_start INTEGER NOT NULL,         -- JSONL 文件字节偏移起始
  jsonl_offset_end   INTEGER NOT NULL,         -- JSONL 文件字节偏移结束
  batch_status       TEXT NOT NULL CHECK (batch_status IN ('COMMITTED')),
  applied_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 5.8 `projector_cursor` — 投影器游标 [v1.1 新增：关闭 #1]

```sql
CREATE TABLE projector_cursor (
  projector_name     TEXT PRIMARY KEY,         -- 'main', 'safety', 'reporting'...
  last_batch_id      TEXT NOT NULL,
  last_batch_sequence INTEGER NOT NULL,
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 5.9 assessment_session / training_session 修改

```sql
-- [v1.1] 不再在业务会话表上增加 assigned_device_id / assigned_auth_session_id
-- 分配关系通过 business_session_assignment 管理
-- 仅保留以下新增字段：
ALTER TABLE assessment_session ADD COLUMN delivery_phase TEXT NOT NULL DEFAULT 'PREPARED'
  CHECK (delivery_phase IN (
    'PREPARED', 'ASSIGNED', 'STUDENT_CONFIRMED', 'ONLINE_IN_PROGRESS',
    'ONLINE_COMPLETED', 'OFFLINE_SCORING', 'OBSERVATION', 'FINALIZED'));
ALTER TABLE assessment_session ADD COLUMN event_sequence_version INTEGER NOT NULL DEFAULT 0;
```

---

## 六、数据库唯一约束与状态不变量清单 [v1.1 新增：关闭 #8]

| 约束 | 实现方式 | 强制层 |
|------|----------|--------|
| 一台设备最多一个 ACTIVE device_runtime_session | `ux_device_one_active_runtime` partial unique index | DB |
| 一个设备最多一个有效学生分配 | `ux_assignment_one_active_per_device` partial unique index | DB |
| 一个业务会话最多一个有效分配 | `ux_assignment_one_active_per_session` partial unique index | DB |
| 一个 client_instance + idempotency_key 唯一 | `ux_command_idempotency` unique index | DB |
| JSON 字段合法性 | `CHECK (col IS NULL OR json_valid(col))` | DB |
| 布尔字段 0/1 | `CHECK (col IN (0, 1))` | DB |
| 状态枚举值 | `CHECK (col IN (...))` | DB |
| updated_at 更新 | 应用层 `SET updated_at = datetime('now')` 在每个 UPDATE 语句中 | App |
| online_status 不落盘 | 内存 Map `deviceOnlineState: Map<deviceId, {status, lastHeartbeat}>` | App |
| 终态不可逆 | Domain Layer 状态机 `assertTransition()` 拒绝非法迁移 | App |
| event_sequence_version 乐观锁 | `WHERE event_sequence_version = ? ... SET event_sequence_version = ? + 1` | App+DB |

---

## 七、JSONL 与 SQLite 可恢复一致性协议 [v1.1 全新：关闭 #1]

### 七-A：问题陈述

JSONL 文件写入和 SQLite 事务是两个独立的持久化操作，无法置于同一原子事务中。需要设计崩溃安全的写入协议，确保：
- 不丢事件（JSONL 已写但 SQLite 未投影 → 启动时重放）
- 不重复投影（幂等性保证）
- 所有崩溃窗口都有恢复路径

### 七-B：事件批次写入协议

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Event Batch Write Protocol                         │
│                                                                      │
│  Step 1: PREPARE                                                     │
│  ┌─────────────────────────────────────────────────────────┐        │
│  │ a. 生成 event_batch_id (UUID)                           │        │
│  │ b. 将事件序列化为 JSONL 行                              │        │
│  │ c. 写入 JSONL: 先写 PREPARED 标记行，再写事件行         │        │
│  │ d. fsync JSONL 文件                                     │        │
│  └─────────────────────────────────────────────────────────┘        │
│                                                                      │
│  Step 2: APPLY (SQLite 事务)                                         │
│  ┌─────────────────────────────────────────────────────────┐        │
│  │ BEGIN IMMEDIATE;                                        │        │
│  │ a. INSERT INTO applied_event_batch (batch_id, ...)      │        │
│  │ b. 对每个事件执行投影：INSERT/UPDATE 业务表             │        │
│  │ c. UPDATE projector_cursor SET last_batch_id = ?        │        │
│  │ COMMIT;                                                 │        │
│  └─────────────────────────────────────────────────────────┘        │
│                                                                      │
│  Step 3: CONFIRM                                                     │
│  ┌─────────────────────────────────────────────────────────┐        │
│  │ a. 写入 JSONL: COMMITTED 标记行 (含 batch_id)           │        │
│  │ b. fsync JSONL 文件                                     │        │
│  └─────────────────────────────────────────────────────────┘        │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 七-C：JSONL 行格式

```jsonl
{"type":"BATCH_PREPARED","batch_id":"abc-123","batch_seq":42,"event_count":3,"ts":"..."}
{"type":"EVENT","batch_id":"abc-123","seq_in_batch":1,"event_type":"ANSWER_SUBMITTED","payload":{...}}
{"type":"EVENT","batch_id":"abc-123","seq_in_batch":2,"event_type":"SCORE_CALCULATED","payload":{...}}
{"type":"EVENT","batch_id":"abc-123","seq_in_batch":3,"event_type":"STATUS_CHANGED","payload":{...}}
{"type":"BATCH_COMMITTED","batch_id":"abc-123","batch_seq":42,"ts":"..."}
```

### 七-D：崩溃窗口分析与恢复

| 崩溃时机 | JSONL 状态 | SQLite 状态 | 恢复动作 |
|----------|-----------|-------------|----------|
| Step 1 写入 PREPARED 前 | 无痕迹 | 无痕迹 | 无需恢复，事件丢失（命令未确认，客户端会重试） |
| Step 1 写入事件行中途 | 部分行 + 无 PREPARED 完整标记 | 无 | 截断 JSONL 到上一个 COMMITTED 标记后；客户端重试 |
| Step 1 fsync 后、Step 2 前 | PREPARED + 事件行完整 | 无 applied_event_batch | 启动恢复：重放该 batch |
| Step 2 事务中途崩溃 | PREPARED + 事件行完整 | 事务回滚（SQLite WAL 自动） | 启动恢复：重放该 batch |
| Step 2 COMMIT 后、Step 3 前 | PREPARED 但无 COMMITTED | applied_event_batch 存在 | 启动恢复：检测到 batch 已 applied → 补写 COMMITTED 标记 |
| Step 3 写入中途 | 部分 COMMITTED 标记 | applied_event_batch 存在 | 启动恢复：同上，重写 COMMITTED 标记 |

### 七-E：启动恢复流程

```typescript
async function startupRecovery(jsonlPath: string, db: Database): Promise<void> {
  // 1. 读取 projector_cursor 获取 last_batch_sequence
  const cursor = db.prepare('SELECT last_batch_sequence FROM projector_cursor WHERE projector_name = ?')
    .get('main');

  // 2. 扫描 JSONL 从 cursor 位置之后的所有 BATCH_PREPARED
  const pendingBatches = scanPendingBatches(jsonlPath, cursor?.last_batch_sequence ?? 0);

  for (const batch of pendingBatches) {
    // 3. 检查 applied_event_batch 是否已有该 batch
    const applied = db.prepare('SELECT 1 FROM applied_event_batch WHERE batch_id = ?')
      .get(batch.batch_id);

    if (applied) {
      // SQLite 已提交但 JSONL 未写 COMMITTED → 补写
      appendCommittedMarker(jsonlPath, batch.batch_id, batch.batch_seq);
    } else {
      // JSONL 已写但 SQLite 未提交 → 重放
      replayBatch(db, batch);
      appendCommittedMarker(jsonlPath, batch.batch_id, batch.batch_seq);
    }
  }

  // 4. 截断 JSONL 中不完整的尾部行（无 PREPARED 标记的孤立行）
  truncateIncompleteTrailingLines(jsonlPath);
}
```

### 七-F：重放幂等保证

投影器的所有写操作必须是幂等的：
- INSERT 使用 `INSERT OR IGNORE` 或 `INSERT OR REPLACE`（基于事件唯一 ID）
- UPDATE 使用 `WHERE event_sequence_version = expected`（拒绝重复应用）
- 每个事件携带 `event_id` (UUID)，投影器检查是否已处理

```sql
-- 示例：幂等投影
INSERT OR IGNORE INTO assessment_answer (
  answer_id, session_id, question_id, ...
) VALUES (?, ?, ?, ...);
-- answer_id = event_id，重复 INSERT 无效果
```

---

## 八、实时通信方案 [v1.1 重评估：关闭 #4, #17]

### 八-A：协议选择重评估 [关闭 #17]

| 方案 | 教师端 | 学生端 | 优缺点 |
|------|--------|--------|--------|
| A: REST + SSE | HTTPS POST 写 + SSE 读 | IPC（不经网络） | 教师写操作已通过 REST 完成；SSE 天然支持 HTTPS、Cookie 认证、自动重连；单向推送足够 |
| B: REST + WebSocket | HTTPS POST 写 + WS 双向 | IPC | WebSocket 连接建立后可双向，但教师端无实时上行需求（观察录入是 REST POST） |
| C: IPC + 教师 SSE | MessagePort（学生） | SSE（教师） | 最小网络暴露面 |

**v1.1 决策：选择方案 A（HTTPS REST + SSE）**

理由：
1. 教师端所有写操作（评分、观察、红线）已通过 REST POST 完成
2. 教师端只需接收服务端推送（进度、状态变更、通知）→ SSE 足够
3. SSE 基于 HTTPS，天然支持同源 Cookie 认证（关闭 #4）
4. SSE 内建自动重连（`EventSource` API），无需手写重连逻辑
5. 不需要自定义二进制帧协议或 ping/pong
6. 学生端走 IPC MessagePort，不涉及网络认证问题

### 八-B：SSE 认证方案 [关闭 #4]

**v1.1 修正：** 不再在 URL 查询参数中传递 token。

```
教师登录流程：
1. POST /api/v1/auth/login → 响应 Set-Cookie: session=<signed_cookie>; HttpOnly; Secure; SameSite=Strict; Path=/
2. 后续所有 REST 请求自动携带 Cookie
3. SSE 连接: new EventSource('/api/v1/events/stream') → Cookie 自动发送
4. Server 验证 Cookie 中的 session → 确定用户身份和权限 → 决定可订阅的频道
```

**关键安全属性：**
- Token 不出现在 URL、查询参数、Referer 或日志中
- HttpOnly 防止 XSS 窃取
- SameSite=Strict 防止 CSRF
- Secure 强制 HTTPS 传输

### 八-C：SSE 频道与服务端授权 [关闭 #4 订阅授权]

**客户端不能自由订阅任意频道。** 服务端在 SSE 连接建立时根据用户身份自动确定可接收的事件范围：

```typescript
function resolveSSEChannels(authSession: AuthSession): string[] {
  if (authSession.role === 'TEACHER') {
    // 教师自动订阅：所有其管辖学生的 active session + 所有设备状态
    return [
      ...getActiveSessionChannels(authSession.user_id),
      'devices:status'
    ];
  }
  // ADMIN 订阅全部
  if (authSession.role === 'ADMIN') {
    return ['*'];
  }
  // 学生不使用 SSE（走 IPC）
  return [];
}
```

### 八-D：SSE 事件格式

```
event: session.progress_updated
id: 42
data: {"session_id":"abc","progress":{"answered":5,"total":18},"timestamp":"..."}

event: session.status_changed
id: 43
data: {"session_id":"abc","old_status":"ACTIVE","new_status":"OFFLINE_PENDING"}

event: device.online
id: 44
data: {"device_id":"dev-001","device_name":"一体机-A01"}
```

### 八-E：断线重连与状态补偿

SSE 内建 `Last-Event-ID` 重连机制：
1. 客户端断线后 `EventSource` 自动重连，发送 `Last-Event-ID: 43`
2. 服务端从内存环形缓冲区（容量 500 条/5 分钟）查找 id > 43 的事件补发
3. 若 ID 超出缓冲区范围，服务端发送特殊事件 `event: resync_required`
4. 客户端收到 `resync_required` 后，通过 REST 全量查询当前状态

### 八-F：学生端实时通知路径

学生 Renderer 不使用 SSE/WebSocket，通过 IPC 接收通知：

```
Server NotificationBus → MessagePort → Electron Main → ipcMain.emit → Renderer
```

Electron Main 注册 MessagePort 监听，收到服务端通知后转发给对应 BrowserWindow。

---

## 九、权限与可见性控制 [v1.1 修订：关闭 #13]

### 九-A：角色-操作权限（保留原表，无变更）

（同 v1.0 §九 角色-操作权限矩阵）

### 九-B：学生可见性控制 [v1.1 新增：关闭 #13]

**原则：** 学生查看本人历史记录 ≠ 看到全部内部资料。

#### 报告/结果可见性字段

```sql
-- 在 result_record 上增加发布控制
ALTER TABLE result_record ADD COLUMN publication_status TEXT NOT NULL DEFAULT 'INTERNAL'
  CHECK (publication_status IN ('INTERNAL', 'PUBLISHED', 'RETRACTED'));
ALTER TABLE result_record ADD COLUMN student_visible INTEGER NOT NULL DEFAULT 0
  CHECK (student_visible IN (0, 1));
ALTER TABLE result_record ADD COLUMN published_at TEXT;
ALTER TABLE result_record ADD COLUMN published_by TEXT REFERENCES user_account(user_id);
```

#### 教师观察与学生反馈分离

| 数据类型 | 存储位置 | 学生可见 | 说明 |
|----------|----------|----------|------|
| 教师观察原始记录 | `observation_record.content_json` | ❌ | 教师内部笔记，含专业判断 |
| 学生可见反馈 | `student_feedback` 新表 | ✅ | 教师主动发布的、面向学生的简化版反馈 |
| 评分锚点 | `scoring_rule_json` | ❌ | 永不暴露 |
| 最终得分 | `result_record` | 条件✅ | 仅 `student_visible = 1` 时 |
| 报告 | `result_record.report_content_json` | 条件✅ | 仅 `publication_status = 'PUBLISHED'` 时 |

#### visibility_scope 设计

```sql
CREATE TABLE student_feedback (
  feedback_id        TEXT PRIMARY KEY,
  session_id         TEXT NOT NULL,
  student_user_id    TEXT NOT NULL REFERENCES user_account(user_id),
  visibility_scope   TEXT NOT NULL DEFAULT 'STUDENT_SELF' CHECK (visibility_scope IN (
    'STUDENT_SELF', 'GUARDIAN', 'PUBLIC')),
  content_json       TEXT NOT NULL CHECK (json_valid(content_json)),
  published_by       TEXT NOT NULL REFERENCES user_account(user_id),
  published_at       TEXT NOT NULL DEFAULT (datetime('now')),
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
```

#### API 层强制过滤

```typescript
// GET /assessments/:id/result 或 GET /students/:id/history
if (caller.role === 'STUDENT') {
  results = results.filter(r =>
    r.student_visible === 1 &&
    r.publication_status === 'PUBLISHED'
  );
  // 剥除 internal_notes, observation_details, scoring_rules
}
```

### 九-C：学生端绝不可获得的信息（保留）

- `expected_answer` / `correct_answer`
- `scoring_rule_json` 评分细节
- 教师评分锚点描述
- 教师内部观察原始记录
- 其他学生的任何信息
- 安全事件管理操作
- `publication_status = 'INTERNAL'` 的报告

---

## 十、完整状态机 [保留，微调]

### assessment_session.status（权威业务状态）

```
                         ┌───── REDLINE_HALTED (从任何开放状态)
                         │
[*] ──→ INIT ──→ ACTIVE ──→ EMOTION_INTERRUPTED ──→ ACTIVE
              │         │
              │         ├──→ OFFLINE_PENDING ──→ COMPLETED
              │         │
              │         ├──→ COMPLETED (无离线题时直接完成)
              │         │
              │         └──→ ABORTED
              │
              └──→ ABORTED
              └──→ REDLINE_HALTED
```

**[v1.1 关闭 #6] 移除 SUSPENDED_REVIEW_REQUIRED 状态。** Token 到期、Wi-Fi 断开、平板刷新或 Electron 重启不影响业务状态。详见 §十一。

### delivery_phase（交互阶段投影）

```
PREPARED → ASSIGNED → STUDENT_CONFIRMED → ONLINE_IN_PROGRESS
  → ONLINE_COMPLETED → OFFLINE_SCORING → OBSERVATION → FINALIZED
```

**关键区分（保留）：**
- `status` 是事件驱动的权威业务状态
- `delivery_phase` 是交互阶段投影，辅助 UI 渲染
- 两者独立演进，不存在从属关系

---

## 十一、状态分离与恢复矩阵 [v1.1 全面重写：关闭 #6]

### 十一-A：五层状态分离

| 层 | 含义 | 存储 | 受断线影响 | 影响业务状态 |
|---|---|---|---|---|
| **业务状态** (assessment_session.status) | 测评流程进展 | SQLite | ❌ 不受 | — |
| **设备连接状态** | 设备是否在线 | 内存 Map | ✅ 直接反映 | ❌ 不影响 |
| **身份认证状态** (auth_session.status) | 用户是否有有效凭证 | SQLite | 间接（token 过期） | ❌ 不影响 |
| **分配状态** (business_session_assignment.status) | 会话是否绑定到设备 | SQLite | ❌ 不受 | ❌ 不影响 |
| **交互阶段投影** (delivery_phase) | 当前 UI 应展示什么 | SQLite (projection) | ❌ 不受 | ❌ 不影响 |

### 十一-B：断线场景恢复矩阵 [关闭 #6]

| 场景 | 设备连接状态 | 认证状态 | 分配状态 | 业务状态 | 恢复动作 |
|------|-------------|----------|----------|----------|----------|
| Wi-Fi 断开 5s | OFFLINE | 不变 | 不变 | **不变** | 设备重连后恢复推送 |
| Wi-Fi 断开 5min | OFFLINE→STALE | 不变 | 不变 | **不变** | 同上 |
| Token 过期 | 不变 | EXPIRED | 不变 | **不变** | 客户端 refresh token 或重新登录 |
| 平板浏览器刷新 | 短暂断开→重连 | 不变（Cookie 持久） | 不变 | **不变** | SSE 重连 + REST 状态同步 |
| Electron 重启 | ENDED→新 ACTIVE | 旧 session ENDED | 不变 | **不变** | 新 device_runtime_session；若有 active assignment 则恢复显示 |
| 教师关闭平板 | OFFLINE | 不变 | 不变 | **不变** | 学生可继续答题；教师重连后看到最新进度 |
| 换一台学生设备 | 旧设备 ENDED | — | 教师释放旧分配+新分配 | **不变** | POST /session-assignments (新分配) |
| 教师中途换平板 | 新设备连接 | 重新登录 | — | **不变** | 教师在新设备登录后看到同样的管理界面 |

**核心原则：任何连接层或认证层的变化，都不会自动改变业务层状态。**

业务状态只能由显式的领域命令（Domain Command）改变：
- `AbortSession` — 教师主动终止
- `TriggerRedline` — 安全红线
- `EmotionInterrupt` — 情绪中断

### 十一-C：设备离线对分配的影响

设备离线**不自动释放分配**，但教师界面显示设备状态：

```
设备状态: ONLINE → 绿色指示灯
设备状态: STALE (>30s 无心跳) → 黄色警告
设备状态: OFFLINE (>5min) → 红色，教师可选择：
  a. 等待设备恢复
  b. 手动释放分配并重新分配到其他设备
```

教师释放分配是显式操作 `POST /session-assignments/:id/release`，而非自动触发。

---

## 十二、安全事件独立聚合与端到端时序 [v1.1 全面重写：关闭 #2]

### 十二-A：安全事件独立聚合模型

**v1.1 修正：** 安全事件是独立的一等聚合根（Aggregate Root），不依赖任何 assessment_session 或 training_session 才能创建。

```sql
CREATE TABLE safety_incident (
  incident_id           TEXT PRIMARY KEY,
  student_user_id       TEXT NOT NULL REFERENCES user_account(user_id),
  job_code              TEXT NOT NULL,
  task_code             TEXT NOT NULL,
  -- 触发上下文（不是 FK 约束，可以为 NULL）
  triggering_session_id TEXT,         -- 触发时正在进行的会话（可为空）
  triggering_session_type TEXT,       -- ASSESSMENT | TRAINING | NULL
  -- 事件详情
  reason_code           TEXT NOT NULL,
  context_phase         TEXT,
  description           TEXT,
  triggered_by          TEXT NOT NULL REFERENCES user_account(user_id),
  -- 状态
  status                TEXT NOT NULL DEFAULT 'PENDING_DETAIL' CHECK (status IN (
    'PENDING_DETAIL', 'CONFIRMED', 'RESOLVED', 'VOIDED')),
  confirmed_at          TEXT,
  confirmed_by          TEXT REFERENCES user_account(user_id),
  resolved_at           TEXT,
  resolved_by           TEXT REFERENCES user_account(user_id),
  void_reason           TEXT,
  voided_by             TEXT REFERENCES user_account(user_id),
  replacement_incident_id TEXT REFERENCES safety_incident(incident_id),
  -- 冻结控制
  core_facts_frozen     INTEGER NOT NULL DEFAULT 0 CHECK (core_facts_frozen IN (0, 1)),
  frozen_at             TEXT,
  -- 时间
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 聚合查询索引：按 student + job + task
CREATE INDEX idx_safety_incident_aggregate
  ON safety_incident(student_user_id, job_code, task_code);
```

### 十二-B：safety_incident_binding（绑定受影响会话）

```sql
CREATE TABLE safety_incident_binding (
  binding_id            TEXT PRIMARY KEY,
  incident_id           TEXT NOT NULL REFERENCES safety_incident(incident_id),
  bound_session_type    TEXT NOT NULL CHECK (bound_session_type IN ('ASSESSMENT', 'TRAINING')),
  bound_session_id      TEXT NOT NULL,
  halt_applied_at       TEXT NOT NULL DEFAULT (datetime('now')),
  previous_status       TEXT NOT NULL,  -- 绑定前的会话状态
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX ux_binding_session
  ON safety_incident_binding(bound_session_type, bound_session_id, incident_id);
```

### 十二-C：支持的场景 [关闭 #2 全部条目]

| 场景 | 支持方式 |
|------|----------|
| 无开放会话时创建 safety_incident | ✅ triggering_session_id 可为 NULL |
| 按 student_id + job_code + task_code 聚合 | ✅ `idx_safety_incident_aggregate` 索引 |
| 同时熔断开放的 assessment 和 training session | ✅ 查询所有 ACTIVE 会话并批量绑定 |
| 分别生成 safety_incident_binding | ✅ 每个受影响会话一条 binding 记录 |
| 两类会话均进入 REDLINE_HALTED | ✅ 事务内批量 UPDATE status |
| LEVEL_FAIL_BY_SAFETY | ✅ 绑定时自动生成 result_record |
| 普通报告阻断 | ✅ 检查 binding 表，存在则 report_type = SAFETY_TERMINATION_REPORT |
| CONFIRMED 后核心事实冻结 | ✅ `core_facts_frozen = 1`，应用层拒绝修改 reason_code/description |
| void_reason 和 replacement_incident_id | ✅ VOIDED 状态 + 指向替代事件 |

### 十二-D：安全红线端到端时序（修订版）

```
T+0ms   教师在平板点击 "触发安全红线"
        ├─ POST /api/v1/safety-incidents
        │  Body: {student_user_id, job_code, task_code, reason_code, description}
        │  Headers: Cookie: session=<signed>; X-Idempotency-Key: "redline-{...}"
        │
T+50ms  Server 收到请求
        ├─ AuthGate: verify session cookie + assertRole(TEACHER)
        ├─ CommandBus: dispatch CreateSafetyIncident
        │
T+60ms  Domain Layer (ConsistencyProtocol — JSONL + SQLite 事务):
        ├─ 1. 创建 safety_incident (PENDING_DETAIL)
        ├─ 2. 查询该学生+岗位+任务下所有开放会话:
        │     SELECT * FROM assessment_session
        │       WHERE student_id=X AND job_code=Y AND task_code=Z
        │       AND status IN ('INIT','ACTIVE','EMOTION_INTERRUPTED','OFFLINE_PENDING')
        │     UNION
        │     SELECT * FROM training_session
        │       WHERE student_id=X AND job_code=Y AND task_code=Z
        │       AND status IN ('INIT','ACTIVE')
        ├─ 3. 对每个匹配会话:
        │     a. INSERT safety_incident_binding
        │     b. UPDATE session SET status = 'REDLINE_HALTED'
        │     c. INSERT result_record (level_result='LEVEL_FAIL_BY_SAFETY')
        ├─ 4. 写入 event batch (JSONL + SQLite apply)
        ├─ 5. INSERT command_log (SUCCEEDED)
        │
T+100ms 事务提交成功
        ├─ NotificationBus.emit:
        │   → SSE channel (教师): {event: "safety_incident.created", ...}
        │   → IPC → Renderer (学生设备): {type: "redline_halted", incident_id}
        │
T+120ms Student Renderer 收到 IPC 通知
        ├─ 立即切换到 REDLINE_HALTED 界面
        ├─ 禁止所有交互
        │
T+150ms HTTP 201 返回教师平板
        ├─ 教师看到确认："安全红线已触发，已终止 N 个进行中会话"
        │
T+∞     后续操作：
        ├─ 教师确认事实: POST /safety-incidents/:id/confirm
        │   → core_facts_frozen = 1
        ├─ 管理员解决: POST /safety-incidents/:id/resolve
        ├─ 管理员作废: POST /safety-incidents/:id/void
        │   → 必须提供 void_reason
        │   → 可选提供 replacement_incident_id
```

---

## 十三、REST API 合同 [v1.1 修订：关闭 #10, #11]

### 十三-A：基础约定

- 基础路径: `/api/v1/`
- 认证: `Cookie: session=<signed_httponly_cookie>`（教师/管理员 Web 端）; IPC 内部凭证（学生端）
- 请求体: JSON, `Content-Type: application/json`
- 幂等: 所有写操作需 `X-Idempotency-Key` + `X-Client-Instance-Id` header
- 响应格式: `{ "ok": true, "data": {...} }` 或 `{ "ok": false, "error": { "code": "...", "message": "..." } }`

### 十三-B：统一会话分配命令 [关闭 #10]

**v1.1 修正：** 收敛 `/devices/:id/assign-student`、`/assessments/:id/assign`、`/auth/assisted-session` 为一个原子命令：

```
POST /api/v1/session-assignments
```

**请求体：**
```json
{
  "student_user_id": "stu-001",
  "device_id": "dev-001",
  "business_session_type": "ASSESSMENT",
  "business_session_id": "sess-001",
  "require_student_confirmation": true
}
```

**原子执行（单 SQLite 事务）：**
1. 验证学生存在且状态正常
2. 验证设备存在、TRUSTED、当前有 ACTIVE runtime session
3. 验证业务会话存在且处于可分配状态
4. 验证设备当前无其他 ACTIVE 分配（唯一约束）
5. 验证业务会话当前无其他 ACTIVE 分配（唯一约束）
6. 创建 `delegated_access_grant`（教师→学生受限授权）
7. 创建 `business_session_assignment`（status=PENDING_CONFIRM）
8. 写入事件批次
9. 通知学生设备（IPC）: "请确认身份"

**响应：**
```json
{
  "ok": true,
  "data": {
    "assignment_id": "asgn-001",
    "grant_id": "grant-001",
    "status": "PENDING_CONFIRM",
    "awaiting": "student_confirmation"
  }
}
```

### 十三-C：学生确认

```
POST /api/v1/session-assignments/:assignmentId/confirm
```
（通过 IPC 从学生端发出，Server 验证设备凭证）

### 十三-D：释放分配

```
POST /api/v1/session-assignments/:assignmentId/release
Body: { "reason": "TEACHER_RELEASED" }
```

### 十三-E：线下评分草稿与确认 [关闭 #11]

**v1.1 修正：** 线下评分支持逐项草稿保存、自动保存和最终确认。结果计算由 FinalizeAssessment 内部触发，不作为公开接口。

```
-- 保存草稿（可反复调用，幂等覆盖）
PUT /api/v1/assessments/:sessionId/offline-scores/draft
Body: {
  "scores": [
    {"question_id": "q1", "score_value": 3, "note": "..."},
    {"question_id": "q2", "score_value": null}  // 尚未评分
  ]
}
Response: { "ok": true, "data": { "saved_count": 2, "pending_count": 4 } }

-- 获取当前草稿
GET /api/v1/assessments/:sessionId/offline-scores/draft

-- 最终确认提交（不可逆）
POST /api/v1/assessments/:sessionId/offline-scores/finalize
Body: {
  "scores": [...],  // 完整的全部评分
  "version": 3      // 乐观锁版本号，防止并发覆盖
}
Response: {
  "ok": true,
  "data": {
    "result_record_id": "...",
    "level_result": "LEVEL_PASS",
    "report_generated": true
  }
}
```

**finalize 内部执行顺序：**
1. 验证所有必填题目已评分
2. 验证 version 匹配（乐观锁）
3. 写入最终评分事件
4. **内部**调用 CalculateResult（不暴露为公开 API）
5. 生成 result_record
6. 更新 delivery_phase = FINALIZED
7. 若有观察记录模板，更新 delivery_phase = OBSERVATION（等待教师补充观察后再 finalize）

### 十三-F：安全事件 API（修订）

| Method | Path | 说明 |
|---|---|---|
| POST | `/safety-incidents` | 创建安全事件（不依赖 session） |
| GET | `/safety-incidents` | 列出（支持 filter: student, job_code, status） |
| GET | `/safety-incidents/:id` | 详情 |
| POST | `/safety-incidents/:id/confirm` | 确认事实 → 冻结核心字段 |
| POST | `/safety-incidents/:id/resolve` | 解决 |
| POST | `/safety-incidents/:id/void` | 作废（需 void_reason） |

### 十三-G：其余 REST API（保留原设计，去除已收敛的端点）

| Method | Path | 说明 |
|---|---|---|
| POST | `/auth/login` | Cookie-based 登录 |
| POST | `/auth/refresh` | 刷新（如需 token 续期） |
| POST | `/auth/logout` | 撤销 session cookie |
| POST | `/devices/pair` | 设备配对 |
| GET | `/devices` | 列出设备 |
| PATCH | `/devices/:id` | 更新设备配置 |
| POST | `/devices/:id/heartbeat` | 心跳 |
| GET | `/students` | 列出学生 |
| POST | `/assessments` | 创建测评会话 |
| GET | `/assessments` | 列出 |
| GET | `/assessments/:id` | 详情 |
| POST | `/assessments/:id/start` | 启动（学生确认后） |
| POST | `/assessments/:id/answers` | 提交答案（学生端 IPC） |
| POST | `/assessments/:id/emotion-interrupt` | 情绪中断 |
| POST | `/assessments/:id/emotion-resume` | 恢复 |
| POST | `/assessments/:id/abort` | 终止 |
| POST | `/assessments/:id/observations` | 教师观察 |
| GET | `/assessments/:id/report` | 获取报告 |
| GET | `/assets/:id` | 资源文件（Range 支持） |
| GET | `/health` | 健康检查 |
| GET | `/events/stream` | SSE 事件流 |

**已删除的端点（收敛到 /session-assignments）：**
- ~~`POST /devices/:id/assign-student`~~
- ~~`POST /assessments/:id/assign`~~
- ~~`POST /auth/assisted-session`~~
- ~~`POST /assessments/:id/calculate-result`~~（改为 finalize 内部触发）

---

## 十四、多学校/多班级预留 [v1.1 修订：关闭 #12]

### 十四-A：数据模型预留

```sql
-- Phase 1 即创建，但只有一条默认记录
CREATE TABLE organization (
  organization_id    TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  type               TEXT NOT NULL DEFAULT 'SCHOOL' CHECK (type IN ('SCHOOL', 'CENTER', 'DISTRICT')),
  status             TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 安装时自动插入
INSERT INTO organization (organization_id, name) VALUES ('__default__', '默认学校');
```

**node_id 全局唯一方案 [关闭 #12]：**

```typescript
// 安装时生成，写入配置文件，不再使用 'local'
const nodeId = `node_${crypto.randomUUID()}`;
// 存储到: {userData}/config/node-identity.json
// { "node_id": "node_abc...", "organization_id": "__default__", "installed_at": "..." }
```

### 十四-B：用户与组织关系（预留）

```sql
-- Phase 2 启用，Phase 1 所有用户属于 __default__ organization
CREATE TABLE user_membership (
  membership_id      TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL REFERENCES user_account(user_id),
  organization_id    TEXT NOT NULL REFERENCES organization(organization_id),
  role_in_org        TEXT NOT NULL CHECK (role_in_org IN ('MEMBER', 'ADMIN')),
  status             TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 教师-学生权限范围（Phase 2）
CREATE TABLE teacher_student_scope (
  scope_id           TEXT PRIMARY KEY,
  teacher_user_id    TEXT NOT NULL REFERENCES user_account(user_id),
  student_user_id    TEXT NOT NULL REFERENCES user_account(user_id),
  scope_type         TEXT NOT NULL CHECK (scope_type IN ('DIRECT', 'CLASS', 'GRADE')),
  granted_at         TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at         TEXT,
  status             TEXT NOT NULL DEFAULT 'ACTIVE'
);
```

### 十四-C：Phase 1 简化策略

- `organization_id` 字段存在但所有记录值为 `'__default__'`
- `node_id` 安装时生成全局唯一 UUID，不使用 `'local'`
- `user_membership` 和 `teacher_student_scope` 表 Phase 1 创建但不在 UI 中暴露
- 教师默认可见同 organization 下所有学生（Phase 1 等同于全部）

---

## 十五、备份、恢复、日志分段与资源完整性 [v1.1 全新：关闭 #14]

### 十五-A：备份范围

一次完整备份批次包含：
1. SQLite 数据库快照
2. JSONL 事件日志（分段归档）
3. 资源文件目录（assets/）
4. 备份清单（manifest）

### 十五-B：备份实施方案

```typescript
interface BackupBatch {
  batch_id: string;              // UUID
  created_at: string;            // ISO datetime
  schema_version: string;        // 当前 DB schema 版本
  app_version: string;
  node_id: string;

  database: {
    method: 'VACUUM_INTO';       // SQLite VACUUM INTO 'backup.db'
    file: string;                // 相对路径
    sha256: string;
    size_bytes: number;
  };

  event_log: {
    segments: Array<{
      file: string;              // action_log_001.jsonl, action_log_002.jsonl...
      batch_seq_start: number;
      batch_seq_end: number;
      sha256: string;
      size_bytes: number;
    }>;
  };

  assets: {
    manifest_sha256: string;     // asset-manifest.json 的 hash
    included_assets: number;     // 本次备份包含的资源数
    total_size_bytes: number;
  };
}
```

### 十五-C：SQLite 备份方法

使用 `VACUUM INTO`（SQLite 3.27+）而非 Online Backup API，因为：
- 原子性：产生一个完整的独立数据库文件
- 不需要持锁等待（在 WAL 模式下几乎零阻塞）
- 输出文件是紧凑的（相当于自动 VACUUM）

```typescript
function backupDatabase(db: Database, targetPath: string): void {
  db.exec(`VACUUM INTO '${targetPath}'`);
}
```

### 十五-D：JSONL 日志分段与轮转

```
规则：
- 主日志文件: action_log.jsonl（当前活跃）
- 分段阈值: 10MB 或 10000 个 batch（先到者触发轮转）
- 轮转动作:
  1. 重命名 action_log.jsonl → action_log_{batch_seq_start}_{batch_seq_end}.jsonl
  2. 创建新的 action_log.jsonl
  3. 更新 segment_index.json
- 归档: 已轮转的段文件可压缩（gzip）移入 archive/ 目录
- 保留策略: 最近 30 天 + 至少最近 3 个段保持在线
```

```json
// segment_index.json
{
  "active_segment": "action_log.jsonl",
  "segments": [
    {"file": "action_log_1_500.jsonl.gz", "batch_seq_start": 1, "batch_seq_end": 500, "sha256": "..."},
    {"file": "action_log_501_1000.jsonl.gz", "batch_seq_start": 501, "batch_seq_end": 1000, "sha256": "..."},
    {"file": "action_log.jsonl", "batch_seq_start": 1001, "batch_seq_end": null, "sha256": null}
  ]
}
```

### 十五-E：恢复流程

```
1. 验证 manifest:
   a. 解析 backup-manifest.json
   b. 验证 schema_version 兼容性
   c. 验证所有文件 sha256

2. 恢复数据库:
   a. 停止 Server（utilityProcess）
   b. 备份当前 DB 为 xc-career-guide.db.pre-restore
   c. 复制 backup.db → xc-career-guide.db
   d. 执行 PRAGMA integrity_check
   e. 若完整性检查失败 → 回滚（恢复 .pre-restore）

3. 恢复事件日志:
   a. 备份当前 JSONL 文件
   b. 复制所有段文件
   c. 更新 segment_index.json
   d. 验证最后一个段的 batch_seq 与 DB 中 applied_event_batch 一致

4. 恢复资源文件:
   a. 校验 asset-manifest.json
   b. 逐个复制并验证 sha256
   c. 不覆盖比备份更新的文件（除非用户强制）

5. 启动恢复:
   a. 重启 Server
   b. startupRecovery() 检查 JSONL 与 SQLite 一致性
   c. 验证 projector_cursor 正确
```

### 十五-F：恢复失败回滚

```typescript
async function restoreWithRollback(backupPath: string): Promise<RestoreResult> {
  const rollbackFiles: Array<{original: string, backup: string}> = [];

  try {
    // 每个步骤前备份原文件
    rollbackFiles.push({original: dbPath, backup: `${dbPath}.pre-restore`});
    fs.copyFileSync(dbPath, `${dbPath}.pre-restore`);

    // ... 执行恢复 ...

    // 验证
    const integrityOk = db.pragma('integrity_check')[0].integrity_check === 'ok';
    if (!integrityOk) throw new Error('DB integrity check failed');

    return { success: true };
  } catch (err) {
    // 回滚所有已修改文件
    for (const {original, backup} of rollbackFiles) {
      if (fs.existsSync(backup)) {
        fs.copyFileSync(backup, original);
      }
    }
    return { success: false, error: err.message };
  }
}
```

---

## 十六、HTTPS、配对、Token、Cookie、WebSocket/SSE 安全方案 [v1.1 全新：关闭 #3, #4, #15, #16]

### 16.1 第一阶段即实施 HTTPS

**决策：Phase 1 起强制 HTTPS，不允许明文 HTTP 传输密码、Token 或学生资料。**

#### 证书签发方案

```
┌─────────────────────────────────────────────────────────┐
│  Electron Main Process (CA Manager)                      │
│                                                          │
│  首次启动:                                               │
│  1. 生成 Ed25519 根密钥对                                │
│  2. 签发自签名 CA 证书 (CN=XC-Career-Local-CA)           │
│  3. 签发服务器证书 (SAN: localhost, 192.168.*.*, *.local)│
│  4. 存储: {userData}/certs/                              │
│     ├── ca.key (chmod 600)                              │
│     ├── ca.crt                                          │
│     ├── server.key (chmod 600)                          │
│     └── server.crt                                      │
└─────────────────────────────────────────────────────────┘
```

#### 教师平板信任安装

```
配对流程:
1. 教师扫描一体机显示的配对 QR
2. QR 指向 HTTPS URL: https://<ip>:9620/pair?challenge=<one-time-32byte-hex>
3. 浏览器提示证书不受信任 → 页面引导下载 ca.crt
4. 教师在 iPad/Android 设置中安装 CA 证书
5. 后续访问 https://<ip>:9620 不再警告
```

#### 证书轮换

| 触发条件 | 动作 |
|---|---|
| 服务器证书即将过期（< 30 天） | 自动重签，Fastify 热重载 TLS context |
| IP 地址变更 | 重签服务器证书（更新 SAN），通知已配对设备 |
| CA 证书过期（5 年） | 重新生成 CA + 服务器证书，要求设备重新配对 |
| 设备更换 | 新设备走完整配对流程，旧设备信任无需撤销（证书仍有效） |

#### Fastify TLS 配置

```typescript
const server = Fastify({
  https: {
    key: fs.readFileSync(path.join(certsDir, 'server.key')),
    cert: fs.readFileSync(path.join(certsDir, 'server.crt')),
  }
});
```

### 16.2 局域网发现与配对 [关闭 #15]

#### DNS-SD 与 .local 分离处理

| 机制 | 用途 | 实现 | 降级 |
|---|---|---|---|
| DNS-SD (mDNS) | 服务发现：找到局域网中的 XC-Career 服务 | `@homebridge/ciao` 或 `bonjour-service` 广播 `_xc-career._https._tcp` | 手动输入 IP |
| `.local` 主机名 | 友好访问地址 | 系统 mDNS responder 自动处理 | 直接用 IP |

**多台服务器命名冲突处理：**
- 服务名格式：`XC-Career-<school_short_name>-<4hex>`
- mDNS 库自动处理命名冲突（RFC 6762 probing）
- 教师端显示完整列表时展示 school_name + device_name 区分

**校园网屏蔽组播/客户端隔离处理：**
1. 首选：DNS-SD 自动发现
2. 降级 1：一体机屏幕显示配对二维码（含 IP:Port）
3. 降级 2：教师手动输入 `https://<ip>:9620`
4. 降级 3：IT 管理员配置静态 DNS 记录

#### 配对协议（替代 xc-pair:// 自定义协议）

**v1.0 使用 HTTPS 配对 URL，不依赖未注册自定义协议。**

```
配对流程：
1. 教师在一体机管理界面点击"添加教师设备"
2. 一体机生成:
   - challenge: crypto.randomBytes(32).toString('hex')
   - 有效期: 5 分钟
   - 使用次数限制: 1
3. 显示 QR Code 内容: https://<ip>:9620/api/v1/pairing/accept?c=<challenge>
4. 教师平板扫描 QR → 浏览器打开 URL
5. Server 验证:
   - challenge 存在且未过期且未使用
   - 立即标记 challenge 为已使用（一次性）
   - 不在日志中记录 challenge 值（仅记录 hash）
6. 返回配对成功页 + Set-Cookie (device_credential)
7. 后续: 设备凭证用于认证（见 16.3）
```

**安全约束：**
- challenge 使用后立即失效（DB 标记 `used_at`）
- challenge 值不出现在 access log、error log 或 Referer header
- QR 页面设置 `Referrer-Policy: no-referrer`
- 配对 URL 走 HTTPS，challenge 不会在网络中明文传输

### 16.3 CORS 不是认证机制 [关闭 #16]

**设计原则：**
- 教师浏览器访问同源部署的 teacher-web（由 Fastify static 托管），不涉及跨域
- CORS 仅作为防御层，防止恶意第三方网站发起请求
- 设备信任通过配对凭证建立，不通过 CORS origin 判断

```typescript
// CORS 配置：防御性而非认证性
server.register(cors, {
  origin: (origin, cb) => {
    // 同源请求 (origin === undefined) 始终允许
    if (!origin) return cb(null, true);
    // 仅允许已知 origin（开发环境 + 配对设备记录的 origin）
    if (allowedOrigins.has(origin)) return cb(null, true);
    cb(new Error('CORS rejected'), false);
  },
  credentials: true,
});
```

### 16.4 WebSocket 认证 [关闭 #4]

**禁止在 URL 查询参数传递长期 access token。**

#### 方案：一次性短期 ws_ticket + 连接后限时认证

```
WebSocket 连接流程：
1. 客户端先 POST /api/v1/auth/ws-ticket
   - 请求 Header: Authorization: Bearer <access_token>
   - 响应: { ticket: "<one-time-uuid>", expires_in: 30 }

2. 客户端连接 wss://<host>:9620/ws?ticket=<one-time-ticket>
   - Server 验证 ticket: 存在、未使用、未过期
   - 立即标记 ticket 为已使用
   - 从 ticket 关联的 auth_session 获取身份和权限

3. 连接建立后，基于 auth_session 的 capabilities 授权订阅
```

#### 订阅频道服务端授权

```typescript
// 客户端不能自由订阅任意频道
interface SubscribeRequest {
  type: 'subscribe';
  channels: string[];
}

// 服务端验证逻辑
function authorizeSubscription(authSession: AuthSession, channel: string): boolean {
  const [prefix, id] = channel.split(':');
  switch (prefix) {
    case 'session':
      // 教师：可订阅自己管辖范围内的会话
      // 学生：只能订阅自己被分配的会话
      return canAccessSession(authSession, id);
    case 'device':
      if (id === '*') return authSession.role === 'TEACHER' || authSession.role === 'ADMIN';
      return authSession.device_id === id;
    default:
      return false;
  }
}
```

### 16.5 Token 与 Cookie 策略

| 客户端类型 | 认证载体 | 存储 | 续期 |
|---|---|---|---|
| 教师浏览器 | HttpOnly Secure SameSite=Strict Cookie | 浏览器自动管理 | refresh_token Cookie |
| 学生 Renderer | IPC 内存传递（不持久化） | Pinia store (内存) | 由 Server 自动续期 |
| 设备凭证 | device_credential Cookie (长期) | 浏览器 | 配对时设定，1年有效 |

```typescript
// 教师登录成功后设置 Cookie
reply.setCookie('access_token', token, {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: '/',
  maxAge: 3600, // 1 hour
});
reply.setCookie('refresh_token', refreshToken, {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: '/api/v1/auth/refresh',
  maxAge: 86400 * 7, // 7 days
});
```

---

## 十七、对现有文档/代码的精确差异清单 [v1.1 修订]

### 17.1 Schema 变更 (`src/main/db/schema.sql`)

| 操作 | 表名 | 内容 | 关闭审查项 |
|---|---|---|---|
| ADD TABLE | `device` | 设备注册（§五） | #8 |
| ADD TABLE | `device_runtime_session` | 设备运行时会话 | #5, #8 |
| ADD TABLE | `user_auth_session` | 用户认证会话 | #5 |
| ADD TABLE | `delegated_access_grant` | 受限授权 | #5 |
| ADD TABLE | `business_session_assignment` | 业务会话分配 | #7 |
| ADD TABLE | `command_log` | 幂等命令（重构版） | #9 |
| ADD TABLE | `ws_ticket` | WebSocket 一次性票据 | #4 |
| ADD TABLE | `pairing_challenge` | 配对 challenge | #15 |
| ADD TABLE | `backup_manifest` | 备份清单 | #14 |
| ADD TABLE | `event_batch` | 事件批次跟踪 | #1 |
| ADD TABLE | `projector_cursor` | 投影游标 | #1 |
| ADD TABLE | `organization` | 组织（预留） | #12 |
| ADD TABLE | `user_membership` | 组织成员关系 | #12 |
| ADD TABLE | `class_group` / `class_membership` | 班级 | #12 |
| ADD COLUMN | `assessment_session` | `delivery_phase`, `event_sequence_version` | #5, #6 |
| ADD COLUMN | `safety_incident` | 无变更，确认独立性 | #2 |
| ADD COLUMN | `result_record` | `publication_status`, `student_visible`, `published_at`, `published_by` | #13 |
| REMOVE COLUMN | `assessment_session` | 不加 `assigned_device_id`, `assigned_auth_session_id`（改用 assignment 表） | #7 |

### 17.2 TypeScript 类型变更

| 文件 | 变更 |
|---|---|
| `src/shared/types/event-payloads.ts` | ActionLogEntry 新增 `device_id?`, `node_id`, `command_id?`, `event_batch_id` |
| 新文件 `src/server/types/api.ts` | REST API 请求/响应类型 |
| 新文件 `src/server/types/ws.ts` | WebSocket/SSE 消息类型 |
| 新文件 `src/shared/types/device.ts` | Device, DeviceRuntimeSession |
| 新文件 `src/shared/types/auth.ts` | UserAuthSession, DelegatedAccessGrant |
| 新文件 `src/shared/types/assignment.ts` | BusinessSessionAssignment |
| 新文件 `src/shared/types/organization.ts` | Organization, UserMembership (预留) |

### 17.3 目录结构变更

```
src/
├── main/          (瘦化：窗口 + utilityProcess 启动 + IPC Bridge)
│   ├── index.ts
│   ├── ipc-bridge.ts
│   ├── kiosk.ts
│   └── cert-manager.ts   (TLS 证书生命周期)
├── server/        (Local Application Server，不 import electron)
│   ├── index.ts   (Fastify HTTPS + 生命周期)
│   ├── auth/      (Token, Cookie, ws-ticket, device-credential)
│   ├── routes/    (REST 路由)
│   ├── realtime/  (SSE for teacher, MessagePort for student)
│   ├── domain/    (← 从 src/main/domain/ 迁移)
│   ├── db/        (← 从 src/main/db/ 迁移)
│   ├── infra/     (EventWriter, Projector, BackupManager)
│   └── pairing/   (配对流程、challenge 管理)
├── renderer/      (Student Vue SPA)
├── teacher-web/   (Teacher Vue SPA，由 Server 静态托管)
├── preload/       (仅暴露 IPC Bridge)
└── shared/        (共享类型)
```

### 17.4 PRD 变更建议

- PRD §2（系统架构）：更新为 HTTPS Local Server + 双端架构
- PRD §3（用户角色）：补充设备身份、受限授权概念
- PRD §4（登录与认证）：重写为 token+cookie auth + 多种会话模式
- 新增章节：设备管理、配对流程、安全事件独立聚合、备份恢复合同

### 17.5 事件合同变更

新增事件类型:
- `DEVICE_REGISTERED`, `DEVICE_RUNTIME_SESSION_STARTED`, `DEVICE_RUNTIME_SESSION_ENDED`
- `USER_AUTH_SESSION_CREATED`, `USER_AUTH_SESSION_REVOKED`
- `DELEGATED_ACCESS_GRANTED`, `DELEGATED_ACCESS_REVOKED`
- `BUSINESS_SESSION_ASSIGNED`, `BUSINESS_SESSION_RELEASED`, `STUDENT_CONFIRMED_ASSIGNMENT`
- `OFFLINE_SCORE_DRAFT_SAVED`, `OFFLINE_SCORES_FINALIZED`
- `SAFETY_INCIDENT_CREATED_STANDALONE` (无开放会话时)

---

## 十八、自动化测试与回归验收清单 [v1.1 修订]

### 单元测试

| 模块 | 覆盖要求 |
|---|---|
| Domain Layer (reducers, level-judge, paper-generator) | 现有测试迁移后全通过 |
| JSONL-SQLite 一致性协议 | PREPARED→COMMITTED 正常路径；崩溃恢复（JSONL 已写/未写 × SQLite 已提交/未提交）|
| Auth Token + Cookie 服务 | 签发/验证/过期/撤销/刷新/HttpOnly 属性 |
| ws_ticket 服务 | 签发/使用/过期/重复使用拒绝 |
| AuthGate 中间件 | Cookie 模式 + Bearer 模式 + 无认证 + 错误角色 |
| 幂等检查 | 重复 key 返回原结果 / 不同 payload 返回冲突 / PROCESSING 状态并发拒绝 |
| 乐观锁 | 并发写入返回 CONFLICT |
| Capability 校验 | 受限授权只能执行已授权操作 |
| 安全事件独立聚合 | 无会话时创建 / 按 student+job+task 聚合 / 双熔断 |
| 可见性控制 | DRAFT 不可见 / PUBLISHED 学生可见 / 内部字段剥除 |
| 备份恢复 | 正常备份 / 恢复校验 / 恢复失败回滚 |
| 证书管理 | 首次生成 / 到期轮换 / IP 变更重签 |

### 集成测试

| 场景 | 验收标准 |
|---|---|
| 教师 HTTPS 创建会话 | 返回 sessionId，DB 中 status=INIT |
| 学生 IPC 提交答案 | 通过 IPC Bridge → Server → SQLite 完整路径 |
| 教师 HTTPS 线下评分草稿 | draft 保存成功，可多次更新 |
| 教师 HTTPS 确认评分 | FinalizeAssessment 触发，result_record 生成 |
| 安全红线 HTTPS 触发 | 批量 halt assessment + training，SSE 通知发出 |
| 无会话安全事件 | 直接创建 safety_incident，无 binding |
| 断线重连 | SSE Last-Event-ID 补发未确认事件 |
| 幂等重试 | 同一 idempotency_key 不产生重复事件 |
| JSONL-SQLite 崩溃恢复 | kill -9 后重启，数据一致 |
| 配对流程 | challenge 一次性 + HTTPS + 证书安装引导 |
| 分配流程 | 原子创建 + 学生确认 + 并发版本 |

### E2E 验收流程

```
1. 启动 Electron (HTTPS Server in utilityProcess)
2. 一体机显示配对 QR → 教师扫码 → 安装证书 → 配对成功
3. 教师 HTTPS 登录 → Cookie 设置 → 看到设备在线
4. 教师创建测评 → POST /session-assignments → 学生设备收到通知
5. 学生端显示身份确认 → 确认 → assignment.student_confirmed_at 更新
6. 学生答 18 道线上题 → 进度通过 SSE 实时推送到教师
7. 线上完成 → 学生端提示"等待教师评分"
8. 教师提交草稿评分 → 保存 → 继续修改 → 最终确认
9. FinalizeAssessment 执行 → 结果计算 → 报告生成
10. 教师发布报告 → publication_status = PUBLISHED
11. 学生查看报告 → 只看到 student_visible 内容
12. 验证：HTTPS 加密、事件日志完整、无正确答案泄露、备份可恢复
```

### 安全验收

| 检查项 | 方法 |
|---|---|
| 所有传输 HTTPS 加密 | 抓包确认无明文 HTTP 流量 |
| Cookie HttpOnly + Secure + SameSite | 浏览器 DevTools 验证属性 |
| WebSocket 不在 URL 泄露 token | 检查连接 URL 仅含 one-time ticket |
| ws_ticket 一次性 | 同一 ticket 二次连接被拒绝 |
| 学生端无法获取正确答案 | 抓包验证 response 不含 expected_answer |
| 未认证请求被拒绝 | curl 无 Cookie/Token → 401 |
| 过期 token 被拒绝 | 手动构造过期 token → 401 |
| 跨角色访问被拒绝 | 学生 token 访问教师端点 → 403 |
| 配对 challenge 一次性 | 重复使用 challenge URL → 拒绝 |
| 配对密钥不在日志中 | grep access.log 确认无 challenge 明文 |
| DRAFT 报告学生不可见 | 学生 token 请求未发布报告 → 404 |
| 安全红线不可逆 | REDLINE_HALTED 后尝试恢复 → 拒绝 |

---

## 十九、P0/P1/P2 问题闭环矩阵

| # | 审查意见摘要 | 优先级 | 关闭章节 | 状态 |
|---|---|---|---|---|
| 1 | JSONL-SQLite 可恢复一致性协议 | P0 | §七 | ✅ 已关闭 |
| 2 | 安全事件独立聚合、双熔断 | P0 | §十二 | ✅ 已关闭 |
| 3 | 第一阶段强制 HTTPS + 证书方案 | P0 | §十六.1 | ✅ 已关闭 |
| 4 | WebSocket 不传长期 token + 频道授权 | P0 | §十六.4 | ✅ 已关闭 |
| 5 | 概念分离（6 层） | P0 | §四 | ✅ 已关闭 |
| 6 | 业务状态与连接/认证/分配状态分离 | P0 | §十一 | ✅ 已关闭 |
| 7 | 独立 business_session_assignment 模型 | P0 | §四.3, §五 | ✅ 已关闭 |
| 8 | Schema 约束缺口（唯一/CHECK/json_valid） | P1 | §五, §六 | ✅ 已关闭 |
| 9 | command_log 幂等模型重构 | P1 | §五.6 | ✅ 已关闭 |
| 10 | 收敛重复分配命令 | P1 | §十三.3 | ✅ 已关闭 |
| 11 | 线下评分草稿保存 + 内部计算 | P1 | §十三.4 | ✅ 已关闭 |
| 12 | 多学校/多班级预留 | P1 | §十四 | ✅ 已关闭 |
| 13 | 学生可见性与发布控制 | P1 | §九.2 | ✅ 已关闭 |
| 14 | 备份恢复合同 | P1 | §十五 | ✅ 已关闭 |
| 15 | 局域网发现与配对修订 | P1 | §十六.2 | ✅ 已关闭 |
| 16 | CORS 不是认证机制 | P1 | §十六.3 | ✅ 已关闭 |
| 17 | 教师端实时通信重评估（SSE vs WS） | P2 | §八 | ✅ 已关闭 |
| 18 | better-sqlite3 Worker Thread 事实修正 | P2 | §二 | ✅ 已关闭 |

---

## 二十、分阶段实施顺序 [v1.1 调整]

### 阶段 0：基础设施（Server 骨架 + HTTPS + IPC Bridge）

| 步骤 | 内容 | 关闭项 |
|---|---|---|
| 0.1 | 安装 fastify + TLS 相关依赖 | — |
| 0.2 | 创建 `src/server/` 目录结构 | — |
| 0.3 | cert-manager: 首次启动生成 CA + 服务器证书 | #3 |
| 0.4 | 迁移 domain/ + db/ → server/ | — |
| 0.5 | IPC Bridge (MessagePort) | — |
| 0.6 | utilityProcess 启动 HTTPS Server | #18 |
| 0.7 | JSONL-SQLite 一致性协议实现 | #1 |
| 0.8 | electron-vite 构建配置适配 | — |

### 阶段 1：认证体系 + 设备 + 分配

| 步骤 | 内容 | 关闭项 |
|---|---|---|
| 1.1 | Schema migration v0.2.0 | #5, #7, #8, #9, #12 |
| 1.2 | Token + Cookie 服务 | #3, #4 |
| 1.3 | AuthGate 中间件 | — |
| 1.4 | 设备注册 + 配对 API | #15, #16 |
| 1.5 | ws_ticket 签发 | #4 |
| 1.6 | business_session_assignment 统一入口 | #7, #10 |
| 1.7 | 安全事件独立聚合重构 | #2 |
| 1.8 | command_log 幂等中间件 | #9 |

### 阶段 2：教师 Web + 实时通信

| 步骤 | 内容 | 关闭项 |
|---|---|---|
| 2.1 | teacher-web Vite 项目初始化 | — |
| 2.2 | REST API 路由 | #10, #11 |
| 2.3 | SSE 实时推送 (教师端) | #17 |
| 2.4 | 线下评分草稿 + 确认流程 | #11 |
| 2.5 | 可见性与发布控制 | #13 |
| 2.6 | 备份恢复实现 | #14 |

### 阶段 3：学生端 Kiosk + 状态分离

| 步骤 | 内容 | 关闭项 |
|---|---|---|
| 3.1 | Kiosk 窗口配置 | — |
| 3.2 | 受限授权 + 学生确认流程 | #5 |
| 3.3 | 状态分离（5 层独立管理） | #6 |
| 3.4 | delivery_phase 投影 + UI 联动 | #6 |
| 3.5 | 断线恢复矩阵实现 | #6 |

---

*文档结束。所有 18 条审查意见已在对应章节关闭。*
