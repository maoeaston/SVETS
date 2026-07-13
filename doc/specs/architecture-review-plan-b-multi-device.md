# 方案 B 架构审查报告：Electron 内嵌本地服务 + 教师平板浏览器 + 学生触摸一体机

## Context

当前"炫灿-职途向导系统"是单机 Electron 桌面应用，教师和学生必须在同一台机器上切换账号完成测评→评分→报告流程。这严重破坏了特教场景下的自然工作流（教师需要观察学生、学生需要专注操作）。

方案 B 将系统拆为：学生在触摸一体机答题，教师在平板浏览器操作，共享同一本地服务和 SQLite 数据库。本报告面向长期产品演进，不以"MVP 最小改动"为首要目标。

---

## 一、推荐拓扑图

```
┌─────────────────────────────────────────────────────────────┐
│                    Local Application Server                   │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ HTTP/WS API │  │ Command Bus  │  │ Event Store (JSONL)│  │
│  │  (Fastify)  │──│ + Auth Gate  │──│ + SQLite Projector │  │
│  └──────┬──────┘  └──────────────┘  └───────────────────┘  │
│         │              ▲                                     │
│         │              │ IPC Bridge                          │
└─────────┼──────────────┼───────────────────────────────────┘
          │              │
    ┌─────┴─────┐  ┌────┴─────────────────┐
    │  Teacher   │  │  Electron Main       │
    │  Tablet    │  │  (Window + Kiosk     │
    │  Browser   │  │   + Process Mgmt)    │
    │            │  │       │              │
    └────────────┘  │  ┌────┴────────┐     │
                    │  │  Student    │     │
                    │  │  Renderer   │     │
                    │  │  (Vue SPA)  │     │
                    │  └─────────────┘     │
                    └──────────────────────┘
```

**关键拓扑决策：**
- Local Application Server 是唯一业务入口
- Student Renderer 通过 IPC → IPC Bridge → Command Bus 访问业务
- Teacher Browser 通过 HTTP/WS → Command Bus 访问业务
- 两条路径汇入同一 Command Bus，保证行为一致
- SQLite 只有 Local Application Server 进程可访问

---

## 二、进程边界与模块边界

### 推荐方案：utilityProcess 托管 Local Server

| 层 | 运行位置 | 职责 | 通信 |
|---|---|---|---|
| **Electron Main** | 主进程 | 窗口管理、Kiosk 强制、utilityProcess 生命周期、系统能力（截屏、升级、mDNS 广播）| MessagePort → Server |
| **Local Application Server** | utilityProcess | HTTP/WS 监听、认证、Command Bus、Domain Layer、SQLite、JSONL、资源服务 | MessagePort ← Main; HTTP ← Teacher |
| **Student Renderer** | BrowserWindow | Vue SPA 学生界面 | IPC → Main → MessagePort → Server |
| **Teacher Web** | 教师平板浏览器 | 独立 Vue SPA（由 Server 静态托管）| HTTP/WS → Server |

### 为什么选 utilityProcess 而非同进程/Worker/子进程

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| **同进程**（Main 内直接起 Fastify）| 零 IPC 开销、最简单 | Main 崩溃 = 服务崩溃 = 窗口崩溃；better-sqlite3 同步调用阻塞 Main 事件循环影响窗口响应 | ❌ 不推荐 |
| **Worker Thread** | 共享内存、低开销 | better-sqlite3 不支持 Worker（native addon 限制）| ❌ 不可行 |
| **utilityProcess** | Electron 原生、独立 V8、可用 native addon、Main 监管其生命周期、崩溃隔离 | IPC 需 MessagePort 序列化 | ✅ 推荐 |
| **独立 Node 子进程** | 完全解耦、可独立部署 | 需要单独打包 Node runtime、Electron 监管更复杂、打包体积大 | ⚠️ 未来演进目标，当前过重 |

### 未来演进路径

```
Phase 1 (当前): utilityProcess 内嵌于 Electron
Phase 2 (学校服务器): 抽出为独立 Node 服务，Electron 仅为客户端壳
Phase 3 (中央平台): Node 服务 + PostgreSQL + 云部署，本地节点变为边缘同步点
```

Server 模块设计为 `src/server/` 独立目录，不 import 任何 Electron API，确保可独立运行。

---

## 三、数据流

### 学生答题流程
```
Student Renderer
  → ipcRenderer.invoke('assessment:submitAnswer', {callerToken, sessionId, questionId, payload})
  → Electron Main (IPC Bridge)
  → MessagePort.postMessage → utilityProcess
  → Server: AuthGate.verifyToken(callerToken)
  → Server: CommandBus.dispatch('SubmitAnswer', {actorId, sessionId, questionId, payload})
  → Domain: StateMachine.assertTransition(session.status, 'ANSWER_SUBMITTED')
  → Domain: ScoringEngine.score(question, payload)
  → Infra: EventWriter.write(action_log.jsonl)
  → Infra: EventProjector.apply(SQLite)
  → Server: NotificationBus.emit('session:progress', {sessionId, progress})
  → WS push to Teacher Browser (if subscribed)
  → Response → MessagePort → IPC → Renderer
```

### 教师线下评分流程
```
Teacher Browser
  → fetch('POST /api/v1/assessment/{sessionId}/offline-scores', {token, scores})
  → Server: AuthGate.verifyToken(token) + assertRole(TEACHER)
  → Server: CommandBus.dispatch('SubmitOfflineScores', {actorId, sessionId, scores})
  → Domain: StateMachine.assertStatus(session.status, 'OFFLINE_PENDING')
  → Domain: validate scores against offline questions
  → Infra: EventWriter.write(action_log.jsonl)
  → Infra: EventProjector.apply(SQLite)
  → Server: NotificationBus.emit('session:status', {sessionId, newStatus})
  → WS push to Student Renderer (if still connected)
  → HTTP 200 response to Teacher Browser
```

---

## 四、身份、账户、设备与业务会话关系模型

### 对象定义与层次

```
┌─ School/Node ─────────────────────────────────────────────────┐
│                                                                │
│  ┌─ Device ──────────┐     ┌─ User Account ───────────────┐  │
│  │ device_id (UUID)   │     │ user_id (UUID)               │  │
│  │ device_name        │     │ role: STUDENT|TEACHER|ADMIN   │  │
│  │ device_role        │     │ ← student_profile (1:1)      │  │
│  │ pairing_secret     │     └──────────────────────────────┘  │
│  │ trust_state        │                                       │
│  │ capabilities_json  │                                       │
│  └────────┬───────────┘                                       │
│           │                                                    │
│  ┌────────┴─────────────────────────────────────────────────┐ │
│  │ Device Session (device_session)                           │ │
│  │ - device_session_id (UUID)                                │ │
│  │ - device_id FK                                            │ │
│  │ - started_at, last_heartbeat_at, ended_at                 │ │
│  │ - status: ACTIVE | EXPIRED | TERMINATED                   │ │
│  └────────┬─────────────────────────────────────────────────┘ │
│           │                                                    │
│  ┌────────┴─────────────────────────────────────────────────┐ │
│  │ Auth Session (auth_session)                               │ │
│  │ - auth_session_id (UUID)                                  │ │
│  │ - user_id FK                                              │ │
│  │ - device_session_id FK                                    │ │
│  │ - session_mode: FULL_LOGIN | TEACHER_ASSISTED |           │ │
│  │                 FIXED_WORKSTATION | KIOSK_RESTRICTED      │ │
│  │ - granted_by (teacher user_id, NULL for self-login)       │ │
│  │ - capabilities_json (scope限定)                           │ │
│  │ - token_hash                                              │ │
│  │ - expires_at                                              │ │
│  │ - status: ACTIVE | EXPIRED | REVOKED                     │ │
│  └────────┬─────────────────────────────────────────────────┘ │
│           │                                                    │
│  ┌────────┴─────────────────────────────────────────────────┐ │
│  │ Business Session (assessment_session / training_session)  │ │
│  │ - 已有结构不变                                            │ │
│  │ - 新增: assigned_device_id, assigned_auth_session_id      │ │
│  └──────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────┘
```

### 会话模式与 Capability Scope

| 模式 | 发起方 | 身份确认 | Capabilities |
|---|---|---|---|
| **FULL_LOGIN** | 学生自主 | 用户名+密码 | 全部学生权限 |
| **TEACHER_ASSISTED** | 教师发起 | 学生确认（PIN/头像/教师现场确认） | 仅当前业务会话相关权限 |
| **FIXED_WORKSTATION** | 管理员预配 | 设备绑定+学生 PIN | 当前设备已分配任务 |
| **KIOSK_RESTRICTED** | 系统自动 | 设备登录后固定 | 仅答题+查看当前任务 |

### Capability 定义（capability_json 字段值）

```typescript
type SessionCapability =
  | 'assessment:view_current'      // 查看当前测评题目和进度
  | 'assessment:submit_answer'     // 提交当前答案
  | 'assessment:emotion_interrupt' // 触发情绪中断
  | 'training:view_current'        // 查看当前训练步骤
  | 'training:execute_step'        // 执行训练步骤
  | 'learning:view_task'           // 查看学习任务
  | 'learning:play_video'          // 播放已授权视频
  | 'history:view_own'             // 查看本人历史记录
  | 'history:view_teacher_notes'   // 查看教师评语
  | 'profile:view_own'             // 查看本人档案
  | 'profile:manage'               // 管理学生档案（仅 FULL_LOGIN）
```

### 并发约束（硬规则）

1. 一台设备同时只有一个有效的 auth_session（学生侧）
2. 一个学生同时只有一个 ACTIVE 的 assessment_session（per task+strategy_type）
3. 教师可同时监管多个设备上的多个学生会话
4. 同一 assessment_session 不可同时分配到两台设备
5. 设备 auth_session 过期/撤销后，业务会话进入 SUSPENDED_REVIEW_REQUIRED

---

## 五、需要新增或修改的表

### 新增表

#### 5.1 `device` — 设备注册

```sql
CREATE TABLE device (
  device_id          TEXT PRIMARY KEY,              -- UUID v4
  device_name        TEXT NOT NULL,                 -- 人类可读名称 "一体机-A01"
  device_role        TEXT NOT NULL CHECK (device_role IN ('STUDENT_WORKSTATION', 'TEACHER_TABLET', 'ADMIN_TERMINAL', 'HYBRID')),
  node_id            TEXT NOT NULL DEFAULT 'local', -- 所属节点（未来多校）
  pairing_secret_hash TEXT,                         -- 配对凭证 hash
  trust_state        TEXT NOT NULL DEFAULT 'PENDING' CHECK (trust_state IN ('PENDING', 'TRUSTED', 'REVOKED')),
  is_kiosk_enabled   INTEGER NOT NULL DEFAULT 0,
  allows_self_login  INTEGER NOT NULL DEFAULT 1,
  capabilities_json  TEXT,                          -- {"video":true,"camera":false,"touch":true}
  last_heartbeat_at  TEXT,
  online_status      TEXT NOT NULL DEFAULT 'OFFLINE' CHECK (online_status IN ('ONLINE', 'OFFLINE', 'STALE')),
  assigned_student_id TEXT,                         -- FK -> student_profile (固定工作站模式)
  status             TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED', 'DECOMMISSIONED')),
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
```

#### 5.2 `device_session` — 设备在线会话

```sql
CREATE TABLE device_session (
  device_session_id  TEXT PRIMARY KEY,
  device_id          TEXT NOT NULL REFERENCES device(device_id),
  started_at         TEXT NOT NULL DEFAULT (datetime('now')),
  last_heartbeat_at  TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at           TEXT,
  end_reason         TEXT CHECK (end_reason IN ('HEARTBEAT_TIMEOUT', 'GRACEFUL_SHUTDOWN', 'ADMIN_TERMINATED', 'REPLACED')),
  client_version     TEXT,
  status             TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'EXPIRED', 'TERMINATED')),
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_device_session_device_status ON device_session(device_id, status);
```

#### 5.3 `auth_session` — 认证会话（替代当前无 token 模式）

```sql
CREATE TABLE auth_session (
  auth_session_id    TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL REFERENCES user_account(user_id),
  device_session_id  TEXT REFERENCES device_session(device_session_id),
  session_mode       TEXT NOT NULL CHECK (session_mode IN ('FULL_LOGIN', 'TEACHER_ASSISTED', 'FIXED_WORKSTATION', 'KIOSK_RESTRICTED')),
  granted_by         TEXT REFERENCES user_account(user_id), -- NULL for self-login
  capabilities_json  TEXT NOT NULL DEFAULT '[]',
  token_hash         TEXT NOT NULL UNIQUE,
  refresh_token_hash TEXT UNIQUE,
  issued_at          TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at         TEXT NOT NULL,
  last_activity_at   TEXT NOT NULL DEFAULT (datetime('now')),
  status             TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'EXPIRED', 'REVOKED')),
  revoke_reason      TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_auth_session_user_status ON auth_session(user_id, status);
CREATE INDEX idx_auth_session_token ON auth_session(token_hash);
CREATE UNIQUE INDEX ux_auth_session_one_active_per_device
  ON auth_session(device_session_id) WHERE status = 'ACTIVE' AND session_mode != 'FULL_LOGIN';
```

#### 5.4 `command_log` — 幂等命令追踪

```sql
CREATE TABLE command_log (
  command_id         TEXT PRIMARY KEY,              -- 客户端生成 UUID
  idempotency_key   TEXT NOT NULL UNIQUE,           -- 客户端幂等键
  command_type       TEXT NOT NULL,
  actor_id           TEXT NOT NULL,
  device_id          TEXT,
  auth_session_id    TEXT,
  payload_hash       TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'ACCEPTED' CHECK (status IN ('ACCEPTED', 'REJECTED', 'DUPLICATE')),
  result_event_id    TEXT,                          -- 产生的事件 ID
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_command_log_idempotency ON command_log(idempotency_key);
```

### 修改现有表

#### assessment_session 新增字段

```sql
ALTER TABLE assessment_session ADD COLUMN assigned_device_id TEXT REFERENCES device(device_id);
ALTER TABLE assessment_session ADD COLUMN assigned_auth_session_id TEXT REFERENCES auth_session(auth_session_id);
ALTER TABLE assessment_session ADD COLUMN delivery_phase TEXT NOT NULL DEFAULT 'PREPARED'
  CHECK (delivery_phase IN ('PREPARED', 'ASSIGNED', 'STUDENT_CONFIRMED', 'ONLINE_IN_PROGRESS', 'ONLINE_COMPLETED', 'OFFLINE_SCORING', 'OBSERVATION', 'FINALIZED'));
ALTER TABLE assessment_session ADD COLUMN event_sequence_version INTEGER NOT NULL DEFAULT 0; -- 乐观并发版本
```

#### ActionLogEntry 新增字段

```typescript
interface ActionLogEntry {
  // ...existing fields...
  device_id?: string       // 事件来源设备
  node_id: string          // 默认 'local'，未来多节点
  command_id?: string      // 触发此事件的命令 ID（幂等追踪）
}
```

---

## 六、不建议进入数据库的字段

| 字段 | 应放位置 | 原因 |
|---|---|---|
| 教师评分锚点文本 | question_bank.scoring_rule_json (已有) | 不暴露给学生端 |
| 实时在线状态 | 内存 + WS 推送 | 高频变化，不适合持久化 |
| 当前 WebSocket 连接 ID | Server 内存 Map | 连接生命周期 << 会话生命周期 |
| 题目渲染后的 HTML | Renderer 本地缓存 | 表现层关注点 |
| 教师观察实时位置/滚动 | WS 临时消息 | 纯 UI 状态 |
| 设备 IP 地址 | device_session metadata 或 event payload | 频繁变化，仅用于诊断 |
| 断线重连计数 | event payload 的 context | 运行时统计，不参与业务逻辑 |
| 客户端本地时间戳 | event payload 的 client_timestamp | 不可信，仅辅助诊断 |

**应进入 event payload 但不独立建列的字段：**
- `client_event_id`（客户端生成的事件关联 ID）
- `client_timestamp`（客户端时钟，不作为权威时间）
- `device_ip`（来源 IP，诊断用）
- `user_agent`（教师浏览器类型）
- `offline_queue_position`（断线期间的队列位置）

---

## 七、REST API 草案

### 基础约定

- 基础路径: `/api/v1/`
- 认证: `Authorization: Bearer <token>` (auth_session 签发的 JWT 或 opaque token)
- 请求体: JSON, `Content-Type: application/json`
- 幂等: 所有写操作需 `X-Idempotency-Key` header
- 版本: `X-API-Version: 1` header
- 响应格式: `{ "ok": true, "data": {...} }` 或 `{ "ok": false, "error": { "code": "...", "message": "..." } }`

### 认证

| Method | Path | 说明 |
|---|---|---|
| POST | `/auth/login` | 用户名+密码登录，返回 access_token + refresh_token |
| POST | `/auth/refresh` | 刷新 token |
| POST | `/auth/logout` | 撤销当前 session |
| POST | `/auth/device-pair` | 设备首次配对（pairing_secret）|
| POST | `/auth/assisted-session` | 教师为学生创建受限会话 |
| POST | `/auth/confirm-identity` | 学生确认身份（PIN/头像选择）|

### 设备管理

| Method | Path | 说明 |
|---|---|---|
| POST | `/devices` | 注册新设备 |
| GET | `/devices` | 列出所有设备 |
| PATCH | `/devices/:deviceId` | 更新设备信息/状态 |
| POST | `/devices/:deviceId/heartbeat` | 心跳上报 |
| POST | `/devices/:deviceId/assign-student` | 分配学生到工作站 |

### 学生管理

| Method | Path | 说明 |
|---|---|---|
| GET | `/students` | 列出学生（支持分页、搜索）|
| GET | `/students/:id` | 获取学生详情 |
| POST | `/students` | 创建学生 |
| PATCH | `/students/:id` | 更新学生 |
| POST | `/students/:id/archive` | 归档学生 |

### 测评会话

| Method | Path | 说明 |
|---|---|---|
| POST | `/assessments` | 创建测评会话 |
| GET | `/assessments` | 列出会话（支持 filter: student, status, strategy）|
| GET | `/assessments/:sessionId` | 获取会话详情（含进度、当前题目等）|
| POST | `/assessments/:sessionId/start` | 启动会话（学生）|
| POST | `/assessments/:sessionId/assign` | 分配到设备（教师）|
| GET | `/assessments/:sessionId/current-question` | 获取当前题目（学生，不含答案）|
| POST | `/assessments/:sessionId/answers` | 提交答案（学生）|
| POST | `/assessments/:sessionId/emotion-interrupt` | 情绪中断（学生/教师）|
| POST | `/assessments/:sessionId/emotion-resume` | 恢复（教师）|
| POST | `/assessments/:sessionId/abort` | 终止（教师）|
| POST | `/assessments/:sessionId/redline` | 触发安全红线（教师）|
| GET | `/assessments/:sessionId/offline-questions` | 获取线下题目+评分锚点（教师）|
| POST | `/assessments/:sessionId/offline-scores` | 提交线下评分（教师）|
| GET | `/assessments/:sessionId/offline-scores` | 获取已提交的线下评分 |
| POST | `/assessments/:sessionId/observations` | 记录教师观察（教师）|
| GET | `/assessments/:sessionId/observations` | 获取观察记录 |
| POST | `/assessments/:sessionId/calculate-result` | 计算最终结果（教师/系统）|
| GET | `/assessments/:sessionId/result` | 获取结果 |
| GET | `/assessments/:sessionId/report` | 获取报告 |

### 安全事件

| Method | Path | 说明 |
|---|---|---|
| GET | `/safety-incidents` | 列出安全事件 |
| GET | `/safety-incidents/:id` | 获取详情 |
| POST | `/safety-incidents/:id/confirm` | 确认事实（教师）|
| POST | `/safety-incidents/:id/resolve` | 解决（管理员）|
| POST | `/safety-incidents/:id/void` | 作废（管理员）|

### 策略配置

| Method | Path | 说明 |
|---|---|---|
| GET | `/strategies` | 列出策略 |
| GET | `/strategies/:id/versions` | 列出版本 |

### 资源服务

| Method | Path | 说明 |
|---|---|---|
| GET | `/assets/:assetId` | 获取资源文件（支持 Range header）|
| GET | `/assets/:assetId/meta` | 获取资源元数据 |

### 系统

| Method | Path | 说明 |
|---|---|---|
| GET | `/health` | 健康检查 |
| GET | `/version` | 版本信息（server, api, schema, app）|

---

## 八、WebSocket/SSE 事件草案

### 协议选择：WebSocket

SSE 是单向的，教师端需要双向（如实时观察录入反馈）。选择 WebSocket，通过 `@fastify/websocket` 集成。

### 连接建立

```
ws://host:port/ws?token=<access_token>&device_id=<device_id>&subscribe=session:abc123,device:*
```

### 服务端推送事件格式

```typescript
interface WSServerMessage {
  type: 'event' | 'ack' | 'error' | 'ping'
  seq: number                    // 服务端单调递增序号
  timestamp: string              // ISO datetime
  channel: string                // e.g. "session:abc123", "device:dev001"
  event_type: string             // e.g. "progress_updated", "status_changed"
  payload: Record<string, unknown>
}
```

### 客户端命令格式

```typescript
interface WSClientMessage {
  type: 'subscribe' | 'unsubscribe' | 'ack' | 'pong'
  channels?: string[]
  last_seq?: number              // 重连时的最后确认序号
}
```

### 核心事件通道

| 通道 | 事件 | 接收方 | 说明 |
|---|---|---|---|
| `session:{id}` | `progress_updated` | Teacher | 学生答题进度变化 |
| `session:{id}` | `status_changed` | Both | 会话状态迁移 |
| `session:{id}` | `answer_submitted` | Teacher | 学生提交了答案（不含正确答案）|
| `session:{id}` | `offline_score_submitted` | Student | 教师提交了线下评分 |
| `session:{id}` | `redline_halted` | Student | 安全红线触发，立即停止 |
| `session:{id}` | `emotion_interrupted` | Teacher | 学生触发情绪中断 |
| `session:{id}` | `emotion_resumed` | Student | 教师恢复了会话 |
| `device:{id}` | `session_assigned` | Student Device | 教师分配了新任务 |
| `device:{id}` | `heartbeat_ack` | Device | 心跳确认 |
| `device:{id}` | `identity_confirm_required` | Student Device | 需要学生确认身份 |
| `device:*` | `device_online` | Teacher | 设备上线通知 |
| `device:*` | `device_offline` | Teacher | 设备离线通知 |

### 重连与状态补偿

1. 客户端断线后重连，携带 `last_seq`
2. 服务端检查 `last_seq`，补发所有 seq > last_seq 的事件（从内存环形缓冲区）
3. 若 `last_seq` 已超出缓冲区范围，返回 `error: {code: 'SEQ_EXPIRED'}`
4. 客户端收到 `SEQ_EXPIRED` 后，必须重新查询 REST API 获取最新状态
5. 环形缓冲区容量：1000 条事件 或 5 分钟（取先到者）

---

## 九、权限与 Capability 矩阵

### 角色-操作权限

| 操作 | STUDENT | TEACHER | ADMIN |
|---|---|---|---|
| 登录 | ✅ | ✅ | ✅ |
| 查看自己的会话 | ✅ | — | — |
| 开始答题 | ✅(受限) | — | — |
| 提交答案 | ✅(受限) | — | — |
| 触发情绪中断 | ✅ | ✅ | ✅ |
| 创建测评会话 | — | ✅ | ✅ |
| 分配会话到设备 | — | ✅ | ✅ |
| 查看所有会话 | — | ✅ | ✅ |
| 线下评分 | — | ✅ | ✅ |
| 记录观察 | — | ✅ | ✅ |
| 恢复情绪中断 | — | ✅ | ✅ |
| 终止会话 | — | ✅ | ✅ |
| 触发安全红线 | — | ✅ | ✅ |
| 确认安全事件 | — | ✅ | ✅ |
| 解决/作废安全事件 | — | — | ✅ |
| 管理学生档案 | — | ✅ | ✅ |
| 管理设备 | — | — | ✅ |
| 管理策略配置 | — | — | ✅ |

### Session Capability 约束（TEACHER_ASSISTED 模式下学生端）

| Capability | 含义 | 授予时机 |
|---|---|---|
| `assessment:view_current` | 看到当前题目 | 分配测评时 |
| `assessment:submit_answer` | 提交答案 | 分配测评时 |
| `assessment:emotion_interrupt` | 触发中断 | 始终 |
| `training:view_current` | 看训练步骤 | 分配训练时 |
| `training:execute_step` | 执行训练 | 分配训练时 |
| `learning:play_video` | 播放视频 | 分配学习任务时 |
| `history:view_own` | 看历史 | 仅 FULL_LOGIN |
| `profile:manage` | 改档案 | 仅 FULL_LOGIN |

### 学生端绝不可获得的信息

- `expected_answer` / `correct_answer`（正确答案）
- `scoring_rule_json` 的评分细节
- 教师评分锚点描述
- 其他学生的任何信息
- 安全事件的管理操作

---

## 十、完整状态机

### assessment_session.status（权威业务状态，不变）

```
                         ┌───── REDLINE_HALTED (从任何开放状态)
                         │
[*] ──→ INIT ──→ ACTIVE ──→ EMOTION_INTERRUPTED ──→ ACTIVE
              │         │                              │
              │         ├──→ SUSPENDED_REVIEW_REQUIRED ─┘
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

### delivery_phase（交互阶段投影，新增）

```
PREPARED → ASSIGNED → STUDENT_CONFIRMED → ONLINE_IN_PROGRESS
  → ONLINE_COMPLETED → OFFLINE_SCORING → OBSERVATION → FINALIZED
```

**关键区分：**
- `status` 是事件驱动的权威业务状态，只有 domain event 可以改变
- `delivery_phase` 是交互阶段的投影，描述"当前在做什么"，辅助 UI 渲染
- `status = ACTIVE` 时，`delivery_phase` 可以是 ASSIGNED / STUDENT_CONFIRMED / ONLINE_IN_PROGRESS
- `status = OFFLINE_PENDING` 时，`delivery_phase` 可以是 OFFLINE_SCORING / OBSERVATION
- `status` 进入终态后，`delivery_phase` 自动设为 FINALIZED

### 非法状态迁移（必须拒绝）

| 当前状态 | 禁止迁移到 | 原因 |
|---|---|---|
| COMPLETED | 任何 | 终态不可逆 |
| REDLINE_HALTED | 任何 | 终态不可逆 |
| ABORTED | 任何 | 终态不可逆 |
| INIT | OFFLINE_PENDING | 未开始不可能完成线上 |
| INIT | COMPLETED | 未开始不可能完成 |
| OFFLINE_PENDING | ACTIVE | 线上已结束不可回退 |
| OFFLINE_PENDING | EMOTION_INTERRUPTED | 线下评分由教师执行，不适用情绪中断 |
| EMOTION_INTERRUPTED | COMPLETED | 必须先恢复到 ACTIVE |
| SUSPENDED_REVIEW_REQUIRED | COMPLETED | 必须先恢复到 ACTIVE |

---

## 十一、断线/重启/重复提交恢复矩阵

| 场景 | 检测方式 | 恢复策略 |
|---|---|---|
| **学生端网络断线** | WS 心跳超时 (10s) | 客户端本地缓存当前题目继续展示；重连后检查 last_seq 补发事件 |
| **学生端页面刷新** | 新 WS 连接 + 同一 auth_session | 重新 GET /assessments/:id 恢复状态；WS 重订阅 |
| **Electron 重启** | 设备重启 → 新 device_session | 旧 device_session 标记 EXPIRED；auth_session 若未过期可复用（需重新验证） |
| **教师平板断线** | WS 心跳超时 | 重连后 last_seq 补发；REST 查询获取最新状态 |
| **教师浏览器刷新** | 新 WS + 同一 token | 完整状态重建 via REST |
| **重复答案提交** | command_log.idempotency_key 去重 | 返回 `{ok: true, duplicate: true, original_event_id: "..."}` |
| **重复评分提交** | command_log.idempotency_key 去重 | 同上 |
| **Server 进程崩溃** | Electron Main 监测 utilityProcess exit | 自动重启 Server；SQLite WAL 自动恢复；JSONL 完整性由 OS fsync 保证 |
| **Server 重启后 WS 丢失** | 所有客户端 WS 断开 | 客户端自动重连 → SEQ_EXPIRED → REST 全量恢复 |
| **设备替换（硬件故障）** | 管理员注册新设备，迁移 assigned_device_id | 新设备获得新 device_id；auth_session 需重新建立 |
| **教师中途换平板** | 新设备登录同一教师账号 | 旧 auth_session 自动过期（同用户只保留最新 session per device role） |
| **并发写入冲突** | event_sequence_version 乐观锁 | 写入时 WHERE event_sequence_version = expected；失败返回 CONFLICT，客户端重试 |

### 幂等保证机制

```typescript
// 客户端发送
POST /assessments/:id/answers
Headers: {
  X-Idempotency-Key: "answer-{sessionId}-{questionId}-{attempt}"
  X-Command-Id: "<uuid>"
}

// 服务端处理
1. 查 command_log WHERE idempotency_key = ?
2. 若存在且 status = 'ACCEPTED' → 返回原结果（幂等重放）
3. 若不存在 → 执行命令 → 写 command_log → 返回结果
4. 若存在且 payload_hash 不同 → 返回 409 CONFLICT
```

---

## 十二、安全红线端到端时序

```
T+0ms   教师在平板点击 "触发安全红线"
        ├─ POST /assessments/:id/redline {reasonCode, contextPhase, description}
        │  Headers: X-Idempotency-Key: "redline-{sessionId}-{timestamp}"
        │
T+50ms  Server 收到请求
        ├─ AuthGate: verify teacher token + role
        ├─ CommandBus: dispatch RedlineTrigger
        │
T+60ms  Domain Layer (单 SQLite 事务内):
        ├─ 1. writeEvent(SAFETY_INCIDENT_CREATED) → action_log.jsonl
        ├─ 2. INSERT safety_incident (PENDING_DETAIL)
        ├─ 3. DB trigger: trg_safety_incident_bind_open_assessments
        │     → UPDATE assessment_session SET status='REDLINE_HALTED'
        │       WHERE student_id=X AND task_code=Y AND status IN (open states)
        │     → INSERT safety_incident_binding for each
        ├─ 4. writeEvent(REDLINE_TRIGGERED) per affected session
        ├─ 5. INSERT result_record (LEVEL_FAIL_BY_SAFETY) per affected session
        ├─ 6. UPDATE assessment_session SET level_result, redline_incident_id
        ├─ 7. INSERT command_log
        │
T+100ms 事务提交成功
        ├─ NotificationBus.emit:
        │   → WS channel "session:{id}": {type: "redline_halted", incident_id}
        │   → WS channel "device:{student_device}": {type: "redline_halted"}
        │
T+120ms Student Renderer 收到 WS 事件
        ├─ 立即切换到 REDLINE_HALTED 界面（⚠ 测评已被安全红线终止）
        ├─ 禁止所有交互（答题、导航）
        │
T+150ms HTTP 200 返回教师平板
        ├─ 教师看到确认："安全红线已触发，已终止 N 个进行中会话"
        │
T+∞     后续：
        ├─ 教师确认事件详情: POST /safety-incidents/:id/confirm
        ├─ 管理员解决/作废: POST /safety-incidents/:id/resolve 或 /void
```

### 安全红线对双端架构的影响审查

| 现有规则 | 方案 B 是否兼容 | 说明 |
|---|---|---|
| 批量绑定开放会话 | ✅ | DB trigger 在 Server 事务内执行，不受端影响 |
| REDLINE_HALTED 不可逆 | ✅ | 状态机在 Server Domain Layer 强制 |
| LEVEL_FAIL_BY_SAFETY 自动生成 | ✅ | 在同一事务内完成 |
| 阻断普通报告 | ✅ | report_type = SAFETY_TERMINATION_REPORT |
| 通知学生端停止 | ✅ via WS | 推送 redline_halted 事件；学生端收到后冻结 |
| void_reason + replacement 规则 | ✅ | REST API 暴露对应端点，权限限制为 ADMIN |
| requires_review_before_next_session | ✅ | 创建新会话时 Server 检查 |

**结论：方案 B 不会破坏现有安全事件生命周期。** 所有安全逻辑在 Server Domain Layer 内完成，双端只是命令入口和通知出口。

---

## 十三、视频资源服务设计

### 存储架构

```
{userData}/data/
├── xc-career-guide.db          (SQLite 数据库)
├── action_log.jsonl            (事件日志)
└── assets/
    ├── images/                 (题目图片、选项图)
    ├── videos/                 (教学视频、示范操作)
    ├── audio/                  (语音提示)
    └── manifests/
        └── asset-manifest.json (资源清单)
```

### 资源服务 REST 端点

```
GET /assets/:assetId
  - 返回文件流
  - 支持 Range header（视频断点播放）
  - 设置 Cache-Control: private, max-age=86400
  - 验证 auth_session 有效 + 资源访问权限

GET /assets/:assetId/meta
  - 返回 {assetId, mimeType, fileSize, duration, width, height, hash}

GET /assets/:assetId/thumbnail
  - 返回缩略图（若有）
```

### 资源访问权限

学生只能访问：
1. 当前 assessment_session 关联题目的 media_asset_id
2. 当前 training_session 关联步骤的 media_asset_id
3. 当前已授权学习任务的视频 asset_id
4. 学生 auth_session 的 capabilities 中包含 `learning:play_video`

验证路径：
```
请求 GET /assets/:assetId
→ AuthGate: verify token
→ AssetAccessGuard:
  1. asset_resource 存在且 status=ACTIVE
  2. 若请求者是 STUDENT:
     a. 查 assessment_session_question WHERE media_asset_id = :assetId
        AND session_id IN (学生当前 ACTIVE/OFFLINE_PENDING 会话)
     b. 或查 training_step_record WHERE media_asset_id = :assetId
        AND training_session_id IN (学生当前 ACTIVE 训练)
     c. 或查 authorized_learning_assets (未来表)
  3. 若请求者是 TEACHER/ADMIN: 允许访问所有 ACTIVE 资源
```

### 视频播放特性

- **Range 请求**: 使用 Node.js `fs.createReadStream(path, {start, end})`
- **断点续播**: 客户端记录 currentTime，重连后 seek 恢复
- **完整性检查**: 首次访问验证 file_hash vs asset_resource.file_hash
- **离线资源包**: 未来支持将策略关联的所有资源打包为 `.xcpack` 文件
- **资源版本**: asset_resource.updated_at + file_hash 组合作为 ETag

### 未来同步扩展点

```typescript
interface AssetSyncAdapter {
  pullManifest(nodeId: string): Promise<AssetManifestDiff>
  downloadAsset(assetId: string, targetPath: string): Promise<void>
  verifyIntegrity(assetId: string, expectedHash: string): Promise<boolean>
}
```

---

## 十四、未来多终端与中央同步演进路径

### Phase 1：单节点多设备（当前方案 B）

```
[Student Device A] ─┐
[Student Device B] ─┼─── LAN ───→ [Local Server (Electron utilityProcess)]
[Teacher Tablet]  ──┘              └─→ SQLite + action_log.jsonl
```

- node_id = 'local' (固定)
- 所有 ID 已是 UUID（全局唯一）
- action_log 含 device_id + node_id 字段（未来可追溯来源）

### Phase 2：学校本地服务器

```
[Student Devices] ──┐
[Teacher Tablets] ──┼─── LAN ───→ [School Server (独立 Node 进程)]
                    │              ├─→ SQLite (或 PostgreSQL)
                    │              └─→ action_log.jsonl
                    │
[Admin PC] ─────────┘
```

- Local Server 模块从 Electron 解耦为独立可运行的 Node 服务
- Electron 客户端退化为纯前端壳（不再嵌入 Server）
- 配置文件指定 Server 地址
- 可选迁移到 PostgreSQL（action_log 仍为 JSONL 或改为 PG 表）

### Phase 3：中央平台 + 边缘节点

```
[School A Server] ──┐
[School B Server] ──┼─── WAN ───→ [Central Platform]
[School C Server] ──┘              ├─→ PostgreSQL
                                   ├─→ S3 (assets)
                                   └─→ 统一报告/分析
```

### 当前需要提前埋入的设计

| 设计点 | 当前做法 | 是否需要改动 |
|---|---|---|
| 全局唯一 ID | UUID v4 ✅ | 不需要 |
| node_id | 不存在 | ✅ ActionLogEntry 加 `node_id: 'local'` 默认值 |
| device_id | 不存在 | ✅ 本次新增 device 表 |
| created_at/updated_at | 所有表已有 ✅ | 不需要 |
| event_sequence 单调性 | per aggregate ✅ | 不需要 |
| 幂等键 | 不存在 | ✅ 本次新增 command_log |
| 乐观并发版本 | 不存在 | ✅ assessment_session 加 event_sequence_version |
| outbox | 不存在 | ❌ Phase 2 再加（当前无同步目标）|
| sync_state | 不存在 | ❌ Phase 2 再加 |
| 冲突解决策略 | N/A | ❌ 单节点无冲突 |

### 不做的事（避免过度设计）

- 不引入 CRDT 或向量时钟
- 不建立 outbox/inbox 消息队列
- 不实现跨节点事件复制
- 不引入分布式事务协调
- 不把 SQLite 换成 PostgreSQL（Phase 1 维持）

---

## 十五、对现有文档/代码的精确差异建议

### 15.1 Schema 变更 (`src/main/db/schema.sql`)

| 操作 | 位置 | 内容 |
|---|---|---|
| ADD TABLE | 末尾 | `device`（见第五节）|
| ADD TABLE | 末尾 | `device_session`（见第五节）|
| ADD TABLE | 末尾 | `auth_session`（见第五节）|
| ADD TABLE | 末尾 | `command_log`（见第五节）|
| ADD COLUMN | assessment_session | `assigned_device_id`, `assigned_auth_session_id`, `delivery_phase`, `event_sequence_version` |
| ADD COLUMN | training_session | `assigned_device_id`, `assigned_auth_session_id`, `event_sequence_version` |
| MODIFY | schema_migration | 插入新版本记录 `v0.2.0-multi-device` |

### 15.2 TypeScript 类型变更

| 文件 | 变更 |
|---|---|
| `src/shared/types/ipc-api.ts` | IPC API 不再直接暴露给 Renderer；改为 Server 内部调用 |
| `src/shared/types/event-payloads.ts` | ActionLogEntry 新增 `device_id?`, `node_id`, `command_id?` |
| 新文件 `src/server/types/api.ts` | REST API 请求/响应类型 |
| 新文件 `src/server/types/ws.ts` | WebSocket 消息类型 |
| 新文件 `src/shared/types/capabilities.ts` | SessionCapability 枚举 |
| 新文件 `src/shared/types/device.ts` | Device, DeviceSession 接口 |
| 新文件 `src/shared/types/auth-session.ts` | AuthSession 接口 |

### 15.3 目录结构变更

```
src/
├── main/          (Electron 主进程 — 瘦化)
│   ├── index.ts   (窗口 + utilityProcess 启动)
│   ├── ipc-bridge.ts  (Renderer IPC → MessagePort → Server)
│   └── kiosk.ts   (Kiosk 模式管理)
├── server/        (Local Application Server — 新增，不 import electron)
│   ├── index.ts   (入口：Fastify + WS + 生命周期)
│   ├── auth/      (认证中间件、token 管理)
│   ├── routes/    (REST 路由，调用 domain)
│   ├── ws/        (WebSocket 管理、通道订阅)
│   ├── domain/    (← 从 src/main/domain/ 迁移)
│   ├── db/        (← 从 src/main/db/ 迁移)
│   └── infra/     (资源服务、备份、健康检查)
├── renderer/      (Student Vue SPA — 改为通过 IPC Bridge 访问)
├── teacher-web/   (Teacher Vue SPA — 新增，独立 Vite 构建)
├── preload/       (简化：只暴露 IPC Bridge)
└── shared/        (共享类型 — 保持)
```

### 15.4 PRD 变更建议

- PRD §2（系统架构）：更新为 Local Server + 双端架构
- PRD §3（用户角色）：补充设备身份、受限会话概念
- PRD §4（登录与认证）：重写为 token-based auth + 多种会话模式
- 新增 PRD 章节：设备管理、教师分配流程、断线恢复

### 15.5 事件合同变更

- 新增事件类型: `DEVICE_REGISTERED`, `DEVICE_SESSION_STARTED`, `DEVICE_SESSION_ENDED`, `AUTH_SESSION_CREATED`, `AUTH_SESSION_REVOKED`, `SESSION_ASSIGNED_TO_DEVICE`, `STUDENT_IDENTITY_CONFIRMED`
- ActionLogEntry 扩展字段: `device_id`, `node_id`, `command_id`
- 保持向后兼容: 新字段可选，旧事件回放时缺失字段用默认值

---

## 十六、分阶段实施顺序

### 阶段 0：基础设施准备（阻断项，必须先完成）

**目标：** 建立 Server 模块骨架，使现有功能通过新架构运行

| 步骤 | 内容 | 交付物 | 验收 |
|---|---|---|---|
| 0.1 | 安装 fastify + @fastify/websocket + @fastify/cors + @fastify/static | package.json | 依赖可安装 |
| 0.2 | 创建 `src/server/` 目录结构 | 目录 + index.ts 入口 | TypeScript 编译通过 |
| 0.3 | 迁移 `src/main/domain/` → `src/server/domain/` | 纯 move + import 路径修正 | 现有测试全部通过 |
| 0.4 | 迁移 `src/main/db/` → `src/server/db/` | 纯 move + import 路径修正 | 现有测试全部通过 |
| 0.5 | 实现 IPC Bridge（Main 通过 MessagePort 调用 Server）| ipc-bridge.ts | Renderer 功能不变 |
| 0.6 | Electron Main 通过 utilityProcess 启动 Server | main/index.ts 改造 | `npm run dev` 仍能正常启动 |
| 0.7 | electron-vite 构建配置适配 Server 模块 | electron.vite.config.ts | build 成功 |

**验收标准：** 现有全部功能通过 IPC Bridge 正常工作，333 个测试全部通过，手动 E2E 验证答题流程不变。

### 阶段 1：认证与设备体系

| 步骤 | 内容 | 交付物 |
|---|---|---|
| 1.1 | Schema migration: 新增 device/device_session/auth_session/command_log 表 | schema.sql v0.2.0 |
| 1.2 | Token 服务（签发/验证/刷新/撤销）| src/server/auth/ |
| 1.3 | auth:login 改造为返回 token（兼容现有 IPC 调用）| auth handler |
| 1.4 | AuthGate 中间件（验证 HTTP Bearer token）| fastify hook |
| 1.5 | 设备注册 + 配对 API | /api/v1/devices |
| 1.6 | 心跳 + 在线状态管理 | 心跳 API + 超时检测 |
| 1.7 | Renderer auth store 适配 token 模式 | stores/auth.ts |

### 阶段 2：教师 Web 面板（核心交互）

| 步骤 | 内容 | 交付物 |
|---|---|---|
| 2.1 | REST API 路由注册（复用现有 handler 纯函数）| src/server/routes/ |
| 2.2 | teacher-web Vite 项目初始化 | src/teacher-web/ |
| 2.3 | 教师登录页 | login view |
| 2.4 | 学生列表 + 测评列表 | list views |
| 2.5 | 创建测评 + 分配到设备 | create + assign views |
| 2.6 | 线下评分界面 | scoring view |
| 2.7 | 教师观察录入 | observation view |
| 2.8 | Server 静态托管 teacher-web 构建产物 | fastify/static |

### 阶段 3：WebSocket 实时通信

| 步骤 | 内容 | 交付物 |
|---|---|---|
| 3.1 | WebSocket 服务端：连接管理、通道订阅 | src/server/ws/ |
| 3.2 | NotificationBus：事件产生后推送到订阅者 | notification-bus.ts |
| 3.3 | 教师端实时进度更新 | teacher-web WS client |
| 3.4 | 学生端接收评分/红线通知 | renderer WS via IPC Bridge |
| 3.5 | 重连 + last_seq 补发机制 | ws handler |
| 3.6 | 安全红线实时通知端到端 | E2E test |

### 阶段 4：学生端 Kiosk 模式

| 步骤 | 内容 | 交付物 |
|---|---|---|
| 4.1 | Kiosk 窗口配置（全屏、无框、alwaysOnTop）| kiosk.ts |
| 4.2 | 受限会话创建（教师助力模式）| assisted-session API |
| 4.3 | 学生身份确认 UI（PIN/头像/确认按钮）| confirm view |
| 4.4 | 设备分配流程 UI（教师平板选学生→选设备→确认）| assign workflow |
| 4.5 | delivery_phase 投影 + UI 状态联动 | phase 管理 |

### 阶段 5：幂等性与断线恢复

| 步骤 | 内容 | 交付物 |
|---|---|---|
| 5.1 | command_log 写入 + 幂等检查中间件 | idempotency.ts |
| 5.2 | event_sequence_version 乐观锁 | concurrency guard |
| 5.3 | WS 重连状态补偿 | reconnect handler |
| 5.4 | 设备离线 → 在线恢复流程测试 | integration tests |

### 阶段 6：局域网发现与安全加固

| 步骤 | 内容 | 交付物 |
|---|---|---|
| 6.1 | mDNS 服务发布（Bonjour/Avahi）| mdns-publisher.ts |
| 6.2 | 配对二维码生成（含 IP + port + one-time secret）| pairing-qr.ts |
| 6.3 | CORS 白名单 + 请求限流 | fastify plugins |
| 6.4 | 审计日志（登录/评分/红线操作全记录）| audit logger |
| 6.5 | CSP 头 + contextIsolation 确认 | security headers |

---

## 十七、自动化测试与验收清单

### 单元测试（现有测试迁移 + 新增）

| 模块 | 覆盖要求 |
|---|---|
| Domain Layer (reducers, level-judge, paper-generator) | 现有 333 测试迁移后全通过 |
| Auth Token 服务 | 签发/验证/过期/撤销/刷新 |
| AuthGate 中间件 | 合法 token/过期 token/无 token/错误角色 |
| 幂等检查 | 重复 key 返回原结果/不同 payload 返回冲突 |
| 乐观锁 | 并发写入返回 CONFLICT |
| Capability 校验 | 受限会话只能执行已授权操作 |

### 集成测试

| 场景 | 验收标准 |
|---|---|
| 教师 HTTP 创建会话 | 返回 sessionId，DB 中 status=INIT |
| 学生 IPC 提交答案 | 通过 IPC Bridge → Server → SQLite 完整路径 |
| 教师 HTTP 线下评分 | status 迁移到 COMPLETED，result_record 生成 |
| 安全红线 HTTP 触发 | 批量 halt + WS 通知发出 |
| 断线重连 | last_seq 补发未确认事件 |
| 幂等重试 | 同一 idempotency_key 不产生重复事件 |

### E2E 验收流程（手动 + Playwright）

```
1. 启动 Electron (Kiosk mode) + 教师打开浏览器
2. 教师登录 → 看到设备在线
3. 教师创建测评 → 选学生 → 分配到设备
4. 学生端显示身份确认 → 确认
5. 学生答 18 道线上题 → 进度实时推送到教师平板
6. 线上完成 → 学生端提示"等待教师评分"
7. 学生执行线下实操 → 教师在平板上看到题目+锚点
8. 教师提交 6 道线下评分
9. 教师录入观察记录
10. 系统自动计算结果 → 生成报告
11. 验证：报告内容正确、事件日志完整、无正确答案泄露
```

### 安全验收

| 检查项 | 方法 |
|---|---|
| 学生端无法获取正确答案 | 抓包 HTTP/WS 验证 response 不含 expected_answer |
| 未认证请求被拒绝 | curl 无 token 访问 API → 401 |
| 过期 token 被拒绝 | 手动构造过期 token → 401 |
| 跨角色访问被拒绝 | 学生 token 访问教师端点 → 403 |
| CORS 限制有效 | 非白名单 origin 请求被拒绝 |
| 安全红线不可逆 | REDLINE_HALTED 后尝试恢复 → 拒绝 |

---

## 十八、技术选型：Fastify

### 选择理由

| 维度 | Fastify | Express | node:http |
|---|---|---|---|
| TypeScript | 一等公民（泛型路由、类型安全 schema） | @types 外挂，类型覆盖不完整 | 无类型辅助 |
| JSON Schema 验证 | 内置 Ajv（项目已使用 Ajv） | 需手动集成 | 需手动实现 |
| 性能 | ~2x Express | 基准 | 最快但需手写一切 |
| WebSocket | @fastify/websocket（官方插件）| ws + 手动集成 | ws + 手动集成 |
| 静态文件 | @fastify/static | express.static | 手动实现 |
| CORS | @fastify/cors | cors 中间件 | 手动实现 |
| 插件生态 | 丰富、类型安全 | 最丰富但质量不齐 | 无 |
| 安全维护 | 活跃、CVE 响应快 | 活跃 | N/A |
| 与 better-sqlite3 | 兼容（同步调用在 Fastify 异步框架内需注意）| 同 | 同 |

### 注意事项

- better-sqlite3 是同步 API，在 Fastify 的异步 handler 中直接调用会阻塞事件循环
- 但由于运行在 utilityProcess 中且是局域网低并发场景（< 10 并发连接），可接受
- 未来高并发场景（Phase 2/3）再考虑 worker pool 或迁移到异步驱动

---

## 十九、现有设计冲突与阻断项

| # | 当前位置 | 当前设计 | 风险 | 推荐改法 | 阻断级别 |
|---|---|---|---|---|---|
| 1 | `src/main/ipc/handlers/*.ts` | IPC handler 直接 import getDatabase() | Server 迁移后 getDatabase 依赖 Electron app 路径 | 抽象 DB 获取为注入参数，handler 纯函数已就绪 | ⚠️ 阶段 0 解决 |
| 2 | `src/main/domain/event-writer.ts` | 使用 `app.getPath('userData')` 获取 JSONL 路径 | utilityProcess 中无 electron app 模块 | 路径通过启动参数注入 | ⚠️ 阶段 0 解决 |
| 3 | `src/renderer/src/stores/auth.ts` | 内存态无 token | 无法用于 HTTP 认证 | 改为存储 token，IPC 调用携带 token | ⚠️ 阶段 1 解决 |
| 4 | `src/main/utils/auth-context.ts` | callerRole 由 renderer 传入（可伪造）| 安全风险 | Token 验证后由 Server 解析角色 | ⚠️ 阶段 1 解决 |
| 5 | Preload | 暴露全部 IPC API 给 renderer | 学生端可调用教师端点 | Preload 只暴露 Bridge；权限由 Server 验证 | ⚠️ 阶段 0 解决 |
| 6 | assessment_session | 无 delivery_phase | UI 状态与业务状态混用 | 新增 delivery_phase 投影字段 | ⚡ 阶段 1 解决（不阻断阶段 0）|
| 7 | ActionLogEntry | 无 node_id / device_id | 未来无法追溯事件来源设备 | 扩展接口，默认值兼容旧事件 | ⚡ 阶段 1 解决 |
| 8 | 无幂等控制 | command_log 不存在 | 断线重试可能产生重复事件 | 新增 command_log + 幂等中间件 | ⚡ 阶段 5 解决 |

**阶段 0 必须先解决 #1, #2, #5**，否则 Server 模块无法独立运行。其余可按阶段顺序推进。

---

## 二十、局域网发现与安全

### 发现机制（推荐组合）

1. **mDNS (Bonjour)**: Server 启动后广播 `_xc-career._tcp.local`，教师平板浏览器通过 `http://xc-career.local:9620` 直接访问
2. **配对二维码**: 一体机屏幕显示 QR code，内容为 `xc-pair://192.168.1.100:9620?secret=<one-time-token>`，教师扫码完成首次信任建立
3. **固定端口**: 默认 9620（可配置），避免随机端口导致防火墙问题

### 安全边界

| 层 | 措施 |
|---|---|
| 传输 | Phase 1: HTTP（局域网内）；Phase 2: 自签名 TLS（一体机作为 CA）|
| 认证 | 每次请求验证 Bearer token；token 有有效期 |
| 设备信任 | 首次配对后 device.trust_state = TRUSTED；未配对设备无法获取 token |
| CORS | 白名单: 配对设备的 origin（`http://xc-career.local:9620`）|
| 限流 | 每 IP 60 req/min（防暴力破解）|
| 审计 | 所有认证事件 + 高危操作写入 error_event_log |
| Renderer 隔离 | contextIsolation: true, nodeIntegration: false, sandbox: true (Phase 1 从 false 改为 true) |
| 答案保护 | GET /current-question 响应中剥除 scoring_rule_json、expected_answer 等敏感字段 |

### 不做的事

- 不实现公网穿透（Ngrok/Cloudflare Tunnel）
- 不实现 Let's Encrypt 证书（无公网域名）
- 不将"同一局域网"等同于"可信"







