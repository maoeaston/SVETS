> **⚠️ 文档状态：SUPERSEDED（已废止）**
> 本文档已被 `architecture-plan-b-multi-device-v2.2-authoritative-baseline.md`（v2.2 唯一权威基线）取代，不再作为实施依据。
> 实施人员只阅读：当前正式 Schema（`src/main/db/schema.sql`）+ 当前正式 PRD（`MVP_PRD_v1.0.9-authoritative.md`）+ v2.2 三份工件。

# 方案 B 多设备架构 v2.0 — 权威实施基线（已废止）

> **文档状态：** SUPERSEDED（原 AUTHORITATIVE BASELINE，已被 v2.2 取代）  
> **生效日期：** 2026-07-14  
> **废止声明：** v1.0、v1.1 (a4eeee9)、v1.2 一致性闭环修订稿均为历史文档，不再作为实施依据。所有实施工作以本文 v2.0 为唯一权威来源。  
> **技术栈：** Electron 33+ / Vue 3 / TypeScript 5 / SQLite 3.45+ (WAL) / better-sqlite3  
> **范围：** 局域网多设备架构（学生触摸一体机 + 教师平板浏览器）

---

## 目录

1. [拓扑与进程边界](#一拓扑与进程边界)
2. [身份、会话与授权关系模型](#二身份会话与授权关系模型)
3. [正式数据模型（完整 DDL）](#三正式数据模型)
4. [JSONL–SQLite 事件溯源与恢复协议](#四jsonlsqlite-事件溯源与恢复协议)
5. [command_log 与事件批次联合恢复](#五command_log-与事件批次联合恢复)
6. [安全事件双熔断时序](#六安全事件双熔断时序)
7. [HTTPS 部署与信任方案](#七https-部署与信任方案)
8. [Grant 重绑定与身份确认](#八grant-重绑定与身份确认)
9. [SSE、CSRF 与权限合同](#九ssecsfr-与权限合同)
10. [离线评分与最终完成](#十离线评分与最终完成)
11. [备份恢复合同](#十一备份恢复合同)
12. [REST API 与事件合同](#十二rest-api-与事件合同)
13. [状态不变量与数据库约束](#十三状态不变量与数据库约束)
14. [P0/P1/P2 闭环矩阵](#十四p0p1p2-闭环矩阵)
15. [自动化验收用例](#十五自动化验收用例)

---

## 一、拓扑与进程边界

### 1.1 完整拓扑图

```
┌──────────────────────────────────────────────────────────────────────────┐
│            Local Application Server (Electron utilityProcess)              │
│                                                                           │
│  ┌───────────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │ HTTPS + SSE       │  │ Command Bus  │  │  Event Store             │  │
│  │ (Fastify)         │──│ + Auth Gate  │──│  JSONL (事实来源)         │  │
│  │ Port :7443        │  │ + CSRF Guard │  │  + SQLite Projector      │  │
│  └─────────┬─────────┘  └──────────────┘  └──────────────────────────┘  │
│            │                  ▲                                           │
│            │                  │ MessagePortMain                           │
└────────────┼──────────────────┼──────────────────────────────────────────┘
             │                  │
       ┌─────┴──────┐    ┌─────┴──────────────────────────┐
       │  Teacher   │    │  Electron Main Process           │
       │  Tablet    │    │  ┌──────────────────────────┐   │
       │  Browser   │    │  │ Window Manager + Kiosk    │   │
       │  (HTTPS)   │    │  │ Cert Manager (Node CA)    │   │
       └────────────┘    │  │ mDNS Advertiser           │   │
                         │  │ utilityProcess Lifecycle   │   │
                         │  └────────────┬─────────────┘   │
                         │               │ IPC (contextBridge) │
                         │  ┌────────────┴─────────────┐   │
                         │  │ Student Renderer          │   │
                         │  │ (Vue 3 SPA, Kiosk mode)   │   │
                         │  └──────────────────────────┘   │
                         └─────────────────────────────────┘
```

### 1.2 进程边界与通信

| 进程 | 运行位置 | 职责 | 通信方式 |
|------|----------|------|----------|
| **Electron Main** | 主进程 | 窗口管理、Kiosk 强制、utilityProcess 生命周期、证书管理、mDNS 广播 | MessagePortMain ↔ Server |
| **Local Application Server** | utilityProcess | HTTPS 监听、认证、Command Bus、Domain Layer、SQLite、JSONL、资源服务 | MessagePortMain ← Main; HTTPS ← Teacher |
| **Student Renderer** | BrowserWindow | Vue SPA 学生界面 | contextBridge IPC → Main → MessagePortMain → Server |
| **Teacher Web** | 教师平板浏览器 | 独立 Vue SPA（Server 静态托管）| HTTPS REST + SSE → Server |

**通信约束：**
- Student Renderer → Main：通过 `contextBridge` 暴露的 IPC API（`ipcRenderer.invoke`）
- Main → Server：通过 `MessagePortMain`（utilityProcess 创建时传入）
- Main → Student Renderer：通过 `BrowserWindow.webContents.send()` 或 `MessagePortMain`（不使用 SSE/WebSocket）
- Teacher → Server：HTTPS REST + SSE（Cookie 认证）
- 禁止 Student Renderer 直接连接 HTTPS 端口

### 1.3 选择 utilityProcess 的理由

| 方案 | 结论 | 理由 |
|------|------|------|
| 同进程 | ❌ | Main 崩溃 = 全崩；同步 DB 调用阻塞事件循环 |
| Worker Thread | ⚠️ | better-sqlite3 技术上支持但 Electron 打包中 native addon 加载路径不稳定 |
| **utilityProcess** | ✅ | 崩溃隔离、独立 V8、native addon 正常、Main 可自动重启、Phase 2 可直接抽为独立 Node 服务 |
| 独立 Node 子进程 | Phase 2 | 需打包 Node runtime，体积大 |

### 1.4 演进路径

```
Phase 1 (当前): utilityProcess 内嵌于 Electron
Phase 2 (学校服务器): 抽出为独立 Node 服务
Phase 3 (中央平台): Node 服务 + PostgreSQL + 云部署
```

---

## 二、身份、会话与授权关系模型

### 2.1 概念分离定义

| 概念 | 定义 | 生命周期 | 存储 |
|------|------|----------|------|
| **Node** | 一个物理或逻辑部署实例 | 安装→卸载 | `node` 表 |
| **Device** | 接入节点的设备 | 注册→停用 | `device` 表 |
| **Device Runtime Session** | 设备一次进程启动到停止 | 进程启动→进程退出/心跳超时/设备重启 | `device_runtime_session` |
| **User Auth Session** | 用户一次认证 | 登录→登出/过期/撤销 | `auth_session` |
| **Delegated Access Grant** | 教师代学生创建的受限授权 | 教师授权→释放/过期/撤销 | `delegated_access_grant` |
| **Business Session** | 通用业务会话父实体 | 创建→终态 | `business_session` |
| **Business Session Assignment** | 业务会话到设备+学生的分配 | 分配→释放/完成 | `business_session_assignment` |
| **Assessment/Training/Learning Session** | 具体业务会话子类型 | 一对一绑定 business_session | 各自专表 |

**关键约束：短暂网络断开不创建新 device_runtime_session。** 只有以下情形才创建新 runtime session：
- 进程重启（Electron 退出后重新启动）
- 设备重启（操作系统重启）
- 教师明确结束当前设备会话
- 设备替换（物理更换）

### 2.2 关系图

```
┌─ Node ─────────────────────────────────────────────────────────────────────┐
│  node_id (UUID, 安装时生成)                                                 │
│  organization_id FK → organization                                          │
│                                                                             │
│  ┌─ Device ─────────────────────┐     ┌─ User Account ──────────────────┐ │
│  │ device_id (UUID)              │     │ user_id (UUID)                   │ │
│  │ node_id FK → node             │     │ role: STUDENT|TEACHER|ADMIN      │ │
│  │ credential_hash               │     │ organization_id FK               │ │
│  │ trust_state                   │     └────────────────┬────────────────┘ │
│  └──────────┬────────────────────┘                      │                   │
│             │                                           │                   │
│  ┌──────────┴──────────────────┐     ┌─────────────────┴────────────────┐ │
│  │ Device Runtime Session       │     │ User Auth Session                 │ │
│  │ device_runtime_session_id    │◄───►│ auth_session_id                   │ │
│  │ device_id FK                 │     │ user_id FK                        │ │
│  │ status: ACTIVE|ENDED         │     │ device_runtime_session_id FK      │ │
│  │ (唯一: 一设备一ACTIVE)       │     │ status: ACTIVE|EXPIRED|REVOKED    │ │
│  └──────────────────────────────┘     └─────────────────┬────────────────┘ │
│                                                          │                  │
│  ┌───────────────────────────────────────────────────────┼────────────────┐ │
│  │ Delegated Access Grant                                │                │ │
│  │ grant_id                                              │                │ │
│  │ teacher_auth_session_id FK ───────────────────────────┘                │ │
│  │ student_user_id FK                                                     │ │
│  │ assignment_id FK → business_session_assignment                          │ │
│  │ status: ACTIVE|RELEASED|EXPIRED|REVOKED                                │ │
│  │ replaces_grant_id (nullable) — 前任 grant                              │ │
│  │ identity_confirmation_method                                           │ │
│  │ confirmed_by / confirmed_at                                            │ │
│  └───────────────────────────────────────────────────────┬────────────────┘ │
│                                                          │                  │
│  ┌─ Business Session ────────────────────────────────────┼────────────────┐ │
│  │ business_session_id (UUID)                            │                │ │
│  │ session_type: ASSESSMENT|TRAINING|LEARNING            │                │ │
│  │ status: …                                            │                │ │
│  └──────────┬────────────────────────────────────────────┘────────────────┘ │
│             │ 1:1                                                            │
│  ┌──────────┴───────────────┐  ┌──────────────────────────────────────────┐ │
│  │ assessment_session        │  │ training_session / learning_session       │ │
│  │ business_session_id FK    │  │ business_session_id FK                    │ │
│  └───────────────────────────┘  └──────────────────────────────────────────┘ │
│                                                                              │
│  ┌─ Business Session Assignment ─────────────────────────────────────────┐  │
│  │ assignment_id (UUID)                                                   │  │
│  │ business_session_id FK → business_session                              │  │
│  │ student_user_id FK                                                     │  │
│  │ device_id FK                                                           │  │
│  │ grant_id FK → delegated_access_grant                                   │  │
│  │ replaces_assignment_id (nullable) — 前任 assignment                    │  │
│  │ status: PENDING_CONFIRM|ACTIVE|RELEASED|VOID                           │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 2.3 Assignment 与 Grant 联合不变量

| 不变量 | 强制层 |
|--------|--------|
| assignment.student_user_id = grant.student_user_id | App + CHECK trigger |
| assignment.device_id 对应的 active runtime session = grant 绑定的 runtime session | App |
| grant.teacher_user_id = assignment.assigned_by | App |
| grant.status = ACTIVE ⟺ assignment.status ∈ {PENDING_CONFIRM, ACTIVE} | App 双向同步 |
| grant 释放时 assignment 必须同步释放或已释放 | App 事务内 |
| assignment 释放时 grant 必须同步释放或已释放 | App 事务内 |

---

## 三、正式数据模型

### 3.1 `node` — 部署节点 [NEW]

```sql
CREATE TABLE node (
  node_id             TEXT PRIMARY KEY,  -- UUID, 安装时生成
  organization_id     TEXT NOT NULL REFERENCES organization(organization_id),
  node_name           TEXT NOT NULL,
  node_type           TEXT NOT NULL DEFAULT 'ELECTRON_KIOSK' CHECK (node_type IN (
    'ELECTRON_KIOSK', 'STANDALONE_SERVER', 'CLOUD')),
  installed_at        TEXT NOT NULL DEFAULT (datetime('now')),
  app_version         TEXT,
  schema_version      TEXT,
  status              TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN (
    'ACTIVE', 'DISABLED', 'DECOMMISSIONED')),
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 3.2 `organization` — 组织

```sql
CREATE TABLE organization (
  organization_id    TEXT PRIMARY KEY,  -- UUID (真正全局唯一)
  name               TEXT NOT NULL,
  type               TEXT NOT NULL DEFAULT 'SCHOOL' CHECK (type IN (
    'SCHOOL', 'CENTER', 'DISTRICT')),
  status             TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO organization (organization_id, name) VALUES
  ('org_' || lower(hex(randomblob(12))), '默认学校');
```

### 3.3 `device` — 设备注册

```sql
CREATE TABLE device (
  device_id           TEXT PRIMARY KEY,
  node_id             TEXT NOT NULL REFERENCES node(node_id),
  device_name         TEXT NOT NULL,
  device_role         TEXT NOT NULL CHECK (device_role IN (
    'STUDENT_WORKSTATION', 'TEACHER_TABLET', 'ADMIN_TERMINAL', 'HYBRID')),
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
```

### 3.4 `device_runtime_session` — 设备运行时会话

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

CREATE UNIQUE INDEX ux_device_one_active_runtime
  ON device_runtime_session(device_id) WHERE status = 'ACTIVE';
```

### 3.5 `auth_session` — 用户认证会话

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

### 3.6 `delegated_access_grant` — 教师代授权

```sql
CREATE TABLE delegated_access_grant (
  grant_id                   TEXT PRIMARY KEY,
  teacher_auth_session_id    TEXT NOT NULL REFERENCES auth_session(auth_session_id),
  teacher_user_id            TEXT NOT NULL REFERENCES user_account(user_id),
  student_user_id            TEXT NOT NULL REFERENCES user_account(user_id),
  assignment_id              TEXT NOT NULL REFERENCES business_session_assignment(assignment_id),
  device_runtime_session_id  TEXT NOT NULL REFERENCES device_runtime_session(device_runtime_session_id),
  capabilities_json          TEXT NOT NULL CHECK (json_valid(capabilities_json)),
  -- 身份确认
  identity_confirmation_method TEXT CHECK (identity_confirmation_method IS NULL OR
    identity_confirmation_method IN ('PIN', 'TEACHER_ATTESTATION', 'PHOTO_MATCH', 'NONE_REQUIRED')),
  confirmed_by               TEXT REFERENCES user_account(user_id),
  confirmation_evidence      TEXT CHECK (confirmation_evidence IS NULL OR json_valid(confirmation_evidence)),
  student_pin_verified       INTEGER DEFAULT 0 CHECK (student_pin_verified IN (0, 1)),
  teacher_attested           INTEGER DEFAULT 0 CHECK (teacher_attested IN (0, 1)),
  confirmed_at               TEXT,
  -- 状态
  status                     TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN (
    'ACTIVE', 'RELEASED', 'EXPIRED', 'REVOKED')),
  replaces_grant_id          TEXT REFERENCES delegated_access_grant(grant_id),
  granted_at                 TEXT NOT NULL DEFAULT (datetime('now')),
  released_at                TEXT,
  release_reason             TEXT,
  expires_at                 TEXT NOT NULL,
  created_at                 TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                 TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX ux_grant_one_active_per_assignment
  ON delegated_access_grant(assignment_id) WHERE status = 'ACTIVE';
```

### 3.7 `business_session` — 通用业务会话父表 [NEW]

```sql
CREATE TABLE business_session (
  business_session_id    TEXT PRIMARY KEY,
  session_type           TEXT NOT NULL CHECK (session_type IN (
    'ASSESSMENT', 'TRAINING', 'LEARNING')),
  student_user_id        TEXT NOT NULL REFERENCES user_account(user_id),
  created_by             TEXT NOT NULL REFERENCES user_account(user_id),
  status                 TEXT NOT NULL DEFAULT 'INIT',
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_business_session_student ON business_session(student_user_id, session_type);
```

### 3.8 `business_session_assignment` — 业务会话分配

```sql
CREATE TABLE business_session_assignment (
  assignment_id              TEXT PRIMARY KEY,
  business_session_id        TEXT NOT NULL REFERENCES business_session(business_session_id),
  student_user_id            TEXT NOT NULL REFERENCES user_account(user_id),
  device_id                  TEXT NOT NULL REFERENCES device(device_id),
  assigned_by                TEXT NOT NULL REFERENCES user_account(user_id),
  assigned_at                TEXT NOT NULL DEFAULT (datetime('now')),
  student_confirmed_at       TEXT,
  released_at                TEXT,
  release_reason             TEXT CHECK (release_reason IS NULL OR release_reason IN (
    'COMPLETED', 'TEACHER_RELEASED', 'DEVICE_OFFLINE', 'REPLACED', 'ADMIN_REVOKED')),
  replaces_assignment_id     TEXT REFERENCES business_session_assignment(assignment_id),
  version                    INTEGER NOT NULL DEFAULT 1,
  status                     TEXT NOT NULL DEFAULT 'PENDING_CONFIRM' CHECK (status IN (
    'PENDING_CONFIRM', 'ACTIVE', 'RELEASED', 'VOID')),
  created_at                 TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                 TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX ux_assignment_one_active_per_session
  ON business_session_assignment(business_session_id)
  WHERE status IN ('PENDING_CONFIRM', 'ACTIVE');

CREATE UNIQUE INDEX ux_assignment_one_active_per_device
  ON business_session_assignment(device_id)
  WHERE status IN ('PENDING_CONFIRM', 'ACTIVE');
```

### 3.9 `assessment_session` — 测评业务会话

```sql
CREATE TABLE assessment_session (
  assessment_session_id  TEXT PRIMARY KEY,
  business_session_id    TEXT NOT NULL UNIQUE REFERENCES business_session(business_session_id),
  -- 业务字段（PRD 定义）
  job_code               TEXT NOT NULL,
  task_code              TEXT NOT NULL,
  paper_id               TEXT NOT NULL,
  -- 状态
  status                 TEXT NOT NULL DEFAULT 'INIT' CHECK (status IN (
    'INIT', 'ACTIVE', 'EMOTION_INTERRUPTED', 'OFFLINE_PENDING',
    'COMPLETED', 'ABORTED', 'REDLINE_HALTED')),
  delivery_phase         TEXT NOT NULL DEFAULT 'PREPARED' CHECK (delivery_phase IN (
    'PREPARED', 'ASSIGNED', 'STUDENT_CONFIRMED', 'ONLINE_IN_PROGRESS',
    'ONLINE_COMPLETED', 'OFFLINE_SCORING', 'OBSERVATION',
    'READY_TO_FINALIZE', 'FINALIZED')),
  event_sequence_version INTEGER NOT NULL DEFAULT 0,
  observation_template_id TEXT,
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 3.10 `command_log` — 幂等命令追踪

```sql
CREATE TABLE command_log (
  command_id          TEXT PRIMARY KEY,
  idempotency_key    TEXT NOT NULL,
  client_instance_id TEXT NOT NULL,
  command_type       TEXT NOT NULL,
  actor_id           TEXT NOT NULL,
  device_id          TEXT,
  auth_session_id    TEXT,
  request_hash       TEXT NOT NULL,      -- SHA-256 of canonical payload
  event_batch_id     TEXT,               -- 预留的事件批次 ID（命令创建时分配）
  status             TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN (
    'PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED')),
  result_json        TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  error_code         TEXT,
  error_message      TEXT,
  -- 租约
  lease_owner        TEXT,
  lease_generation   INTEGER NOT NULL DEFAULT 0,  -- fencing token
  lease_expires_at   TEXT,
  -- 重试
  attempt_count      INTEGER NOT NULL DEFAULT 0,
  last_attempt_at    TEXT,
  max_attempts       INTEGER NOT NULL DEFAULT 3,
  -- 时间
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at       TEXT,
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX ux_command_idempotency
  ON command_log(client_instance_id, idempotency_key);
```

### 3.11 `applied_event_batch` — 事件批次投影追踪

```sql
CREATE TABLE applied_event_batch (
  batch_id           TEXT PRIMARY KEY,
  batch_sequence     INTEGER NOT NULL UNIQUE,
  segment_id         TEXT NOT NULL,       -- 所属 JSONL 段文件标识
  command_id         TEXT,                -- 触发此 batch 的命令（nullable，系统 batch 无命令）
  event_count        INTEGER NOT NULL,
  batch_hash         TEXT NOT NULL,       -- SHA-256(所有事件行拼接)
  jsonl_offset_start INTEGER NOT NULL,
  jsonl_offset_end   INTEGER NOT NULL,
  batch_status       TEXT NOT NULL DEFAULT 'APPLIED' CHECK (batch_status IN (
    'APPLIED', 'CONFIRMED')),
  applied_at         TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at       TEXT
);
```

### 3.12 `processed_event` — 事件幂等追踪 [NEW]

```sql
CREATE TABLE processed_event (
  event_id           TEXT PRIMARY KEY,
  batch_id           TEXT NOT NULL REFERENCES applied_event_batch(batch_id),
  event_type         TEXT NOT NULL,
  processed_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 3.13 `projector_cursor` — 投影器游标

```sql
CREATE TABLE projector_cursor (
  projector_name     TEXT PRIMARY KEY,
  last_batch_id      TEXT NOT NULL,
  last_batch_sequence INTEGER NOT NULL,
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 3.14 `safety_incident` — 继承 schema v0.1.7

**v2.0 声明：保留正式 schema v0.1.7 中 `safety_incident` 表的完整 DDL、状态机和数据库触发器，不重新定义。**

v1.1 §十二中重新编写的 `safety_incident` DDL 被废止。正式表结构以 `src/main/db/schema.sql` 中 v0.1.7 版本为准，v2.0 仅新增以下列：

```sql
ALTER TABLE safety_incident ADD COLUMN source_device_id TEXT REFERENCES device(device_id);
ALTER TABLE safety_incident ADD COLUMN source_node_id TEXT REFERENCES node(node_id);
ALTER TABLE safety_incident ADD COLUMN command_id TEXT;
```

既有触发器（assessment 熔断 + training 熔断）保留不变。

### 3.15 `backup_manifest` — 备份清单

```sql
CREATE TABLE backup_manifest (
  manifest_id         TEXT PRIMARY KEY,
  backup_status       TEXT NOT NULL DEFAULT 'PREPARING' CHECK (backup_status IN (
    'PREPARING', 'COMPLETED', 'FAILED', 'CORRUPTED')),
  schema_version      TEXT NOT NULL,
  app_version         TEXT NOT NULL,
  node_id             TEXT NOT NULL,
  -- write barrier 快照
  cut_batch_sequence  INTEGER NOT NULL,
  cut_segment_id      TEXT NOT NULL,
  cut_segment_byte_offset INTEGER NOT NULL,
  cut_at              TEXT NOT NULL,
  -- 文件信息
  database_sha256     TEXT,
  database_size_bytes INTEGER,
  segments_json       TEXT CHECK (segments_json IS NULL OR json_valid(segments_json)),
  assets_manifest_sha256 TEXT,
  -- 时间
  started_at          TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at        TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
```

---

## 四、JSONL–SQLite 事件溯源与恢复协议

### 4.1 核心约束

1. **单写者 (Single Writer)：** 同一时刻最多一个 in-flight batch。Event Writer 持有写入互斥锁，不允许并发写入。
2. **JSONL 是事实来源：** SQLite 是 JSONL 的投影。任何 SQLite 数据均可从 JSONL 重建。
3. **batch_sequence 单调递增：** 由 Event Writer 在内存中维护，崩溃恢复时从 `projector_cursor.last_batch_sequence + 1` 恢复。
4. **永久归档：** JSONL 事件不可删除。旧段文件可压缩归档但必须保留且可验证。

### 4.2 JSONL 行格式

```jsonl
{"type":"BATCH_PREPARED","batch_id":"uuid","batch_sequence":42,"segment_id":"seg_001","event_count":3,"batch_hash":"sha256hex","command_id":"cmd_uuid","ts":"ISO8601"}
{"type":"EVENT","batch_id":"uuid","seq_in_batch":1,"event_id":"evt_uuid","event_type":"ANSWER_SUBMITTED","payload":{...}}
{"type":"EVENT","batch_id":"uuid","seq_in_batch":2,"event_id":"evt_uuid","event_type":"SCORE_CALCULATED","payload":{...}}
{"type":"EVENT","batch_id":"uuid","seq_in_batch":3,"event_id":"evt_uuid","event_type":"STATUS_CHANGED","payload":{...}}
{"type":"BATCH_COMMITTED","batch_id":"uuid","batch_sequence":42,"ts":"ISO8601"}
```

**BATCH_PREPARED 必须包含的字段：**
- `batch_id` — UUID
- `batch_sequence` — 全局单调序号
- `segment_id` — 所属段文件标识
- `event_count` — 本批事件数
- `batch_hash` — SHA-256(所有 EVENT 行 JSON 拼接，以 `\n` 分隔)
- `command_id` — 触发此批次的命令 ID（系统 batch 可为 null）

### 4.3 写入协议（三阶段）

```
Step 1: PREPARE
  a. 获取写入互斥锁（单写者保证）
  b. 分配 batch_sequence = last_confirmed_sequence + 1
  c. 生成 batch_id (UUID)
  d. 序列化所有事件为 EVENT 行
  e. 计算 batch_hash = SHA-256(EVENT 行拼接)
  f. 写入 JSONL: BATCH_PREPARED 标记行 + 所有 EVENT 行
  g. fsync JSONL 文件
  h. 记录 jsonl_offset_start 和 jsonl_offset_end

Step 2: APPLY (SQLite BEGIN IMMEDIATE)
  a. INSERT INTO applied_event_batch (
       batch_id, batch_sequence, segment_id, command_id,
       event_count, batch_hash, jsonl_offset_start, jsonl_offset_end,
       batch_status
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'APPLIED');
  b. 对每个事件执行投影：
     - 检查 processed_event 是否已有该 event_id → 有则 SKIP
     - INSERT INTO processed_event (event_id, batch_id, event_type)
     - 执行业务表投影（INSERT OR IGNORE / UPDATE WHERE version = expected）
  c. UPDATE projector_cursor SET
       last_batch_id = ?, last_batch_sequence = ?, updated_at = datetime('now')
     WHERE projector_name = 'main';
  d. COMMIT;

Step 3: CONFIRM
  a. 写入 JSONL: BATCH_COMMITTED 标记行
  b. fsync JSONL 文件
  c. UPDATE applied_event_batch SET
       batch_status = 'CONFIRMED', confirmed_at = datetime('now')
     WHERE batch_id = ?;
  d. 释放写入互斥锁
```

### 4.4 投影幂等规则

**禁止通用 `INSERT OR REPLACE`。** 每类投影操作必须选择合适的幂等策略：

| 操作类型 | 策略 | 适用场景 |
|----------|------|----------|
| 新实体创建 | `INSERT OR IGNORE` + 检查 `changes() = 0` 判断是否重复 | answer, result_record |
| 状态更新 | `UPDATE WHERE event_sequence_version = expected` | session status, delivery_phase |
| 累加计数 | `INSERT OR IGNORE` 到 processed_event 后再 UPDATE | progress counters |
| 覆盖型写入（草稿） | `INSERT ON CONFLICT(key) DO UPDATE SET ... WHERE version < new_version` | offline_score_draft |

### 4.5 batch_sequence 管理

**分配规则：**
- 初始值：系统首次启动时 `projector_cursor.last_batch_sequence = 0`
- 分配：Event Writer 在 Step 1b 读取 `projector_cursor.last_batch_sequence + 1`
- 崩溃恢复后：从 SQLite `projector_cursor` 读取，确保不跳号

**日志轮转规则：**
- 轮转阈值：10 MB 或 10000 batch（先到者触发）
- 轮转操作：
  1. 当前活跃段重命名为 `action_log_{segment_id}_{seq_start}_{seq_end}.jsonl`
  2. 创建新活跃段 `action_log.jsonl`，分配新 segment_id
  3. 更新 `segment_index.json`
- 不可删除：归档段可 gzip 压缩移入 `archive/`，但不得删除

### 4.6 不完整尾部的字节级判定

**定义：** 从文件末尾向前扫描，找到最后一个 `\n` (0x0A)。该 `\n` 之后的所有字节为"不完整尾部"。

**判定流程：**
1. 尾部为空（文件以 `\n` 结束）→ 完整，无需处理
2. 尾部非空：
   - 尝试 JSON.parse → 失败 → 截断到最后一个 `\n` 位置 + 1
   - 解析成功但 `type` 为 `BATCH_COMMITTED` → 保留（部分写入的 COMMITTED 标记也有效）
   - 解析成功且为孤立 EVENT 或 BATCH_PREPARED 但无完整事件序列 → 隔离到 `corrupted/` 目录
3. 截断方法：`ftruncate(fd, last_newline_offset + 1)`

### 4.7 启动恢复算法

```typescript
function startupRecovery(jsonlPath: string, db: Database): void {
  // Phase 1: 校验并隔离不完整尾部
  const truncated = truncateIncompleteTrailingBytes(jsonlPath);
  if (truncated.bytes > 0) {
    writeCorruptionLog(truncated);
  }

  // Phase 2: 查找 APPLIED 未 CONFIRMED 的 batch
  const unconfirmedBatches = db.prepare(`
    SELECT batch_id, batch_sequence, segment_id, batch_hash, event_count
    FROM applied_event_batch
    WHERE batch_status = 'APPLIED'
    ORDER BY batch_sequence
  `).all();

  for (const batch of unconfirmedBatches) {
    // 验证 JSONL 中 PREPARED 和全部事件是否完整且 hash 正确
    const verification = verifyBatchInJsonl(jsonlPath, batch);

    if (verification.status === 'COMPLETE_AND_VALID') {
      // JSONL 完整且 hash 匹配 → 补写 COMMITTED 标记（幂等）
      appendCommittedMarkerIdempotent(jsonlPath, batch);
      db.prepare(`UPDATE applied_event_batch
        SET batch_status = 'CONFIRMED', confirmed_at = datetime('now')
        WHERE batch_id = ? AND batch_status = 'APPLIED'`
      ).run(batch.batch_id);
    } else if (verification.status === 'COMMITTED_ALREADY_EXISTS') {
      // COMMITTED 标记已存在 → 仅更新 SQLite
      db.prepare(`UPDATE applied_event_batch
        SET batch_status = 'CONFIRMED', confirmed_at = datetime('now')
        WHERE batch_id = ? AND batch_status = 'APPLIED'`
      ).run(batch.batch_id);
    } else {
      // JSONL 缺失或 hash 错误 → CORRUPTION_DETECTED
      enterCorruptionDetectedState(batch, verification);
      // 不自动追加 COMMITTED，不继续处理后续 batch
      return;
    }
  }

  // Phase 3: 重放 PREPARED 但未 APPLIED 的 batch
  const lastSeq = db.prepare(
    `SELECT last_batch_sequence FROM projector_cursor WHERE projector_name = 'main'`
  ).get()?.last_batch_sequence ?? 0;

  const preparedBatches = scanPreparedNotApplied(jsonlPath, lastSeq);

  for (const batch of preparedBatches) {
    // 校验 event_count 和 batch_hash
    if (!validateBatchIntegrity(batch)) {
      enterCorruptionDetectedState(batch, { status: 'HASH_MISMATCH' });
      return;
    }

    const exists = db.prepare(
      `SELECT 1 FROM applied_event_batch WHERE batch_id = ?`
    ).get(batch.batch_id);

    if (!exists) {
      // 重放
      replayBatch(db, batch);
    }

    // 补写 COMMITTED（幂等）
    appendCommittedMarkerIdempotent(jsonlPath, batch);
    db.prepare(`UPDATE applied_event_batch
      SET batch_status = 'CONFIRMED', confirmed_at = datetime('now')
      WHERE batch_id = ?`
    ).run(batch.batch_id);
  }

  // Phase 4: 推进 cursor（如有变化）
  reconcileProjectorCursor(db);
}
```

### 4.8 appendCommittedMarker 幂等保证

```typescript
function appendCommittedMarkerIdempotent(jsonlPath: string, batch: BatchInfo): void {
  // 检查文件中是否已有该 batch 的 COMMITTED 标记
  if (hasCommittedMarker(jsonlPath, batch.batch_id)) {
    return; // 幂等：已有则不重复追加
  }
  const marker = JSON.stringify({
    type: 'BATCH_COMMITTED',
    batch_id: batch.batch_id,
    batch_sequence: batch.batch_sequence,
    ts: new Date().toISOString()
  });
  fs.appendFileSync(jsonlPath, marker + '\n');
  fs.fsyncSync(fs.openSync(jsonlPath, 'r'));
}
```

### 4.9 CORRUPTION_DETECTED 状态

当 JSONL 缺失、hash 不匹配或结构损坏时：
1. 写入 `{dataDir}/corruption_detected.json`（含 batch_id、错误类型、时间戳）
2. Server 进入只读模式（拒绝新命令，允许读取已有数据）
3. 通知 Main 进程显示错误界面
4. **不得自动追加 COMMITTED 标记**
5. 需要管理员手动介入（恢复备份或手动修复）

### 4.10 日志段 hash 链 [NEW]

```json
// segment_index.json
{
  "active_segment_id": "seg_003",
  "active_segment_file": "action_log.jsonl",
  "segments": [
    {
      "segment_id": "seg_001",
      "file": "action_log_seg_001_1_500.jsonl.gz",
      "batch_seq_start": 1,
      "batch_seq_end": 500,
      "sha256": "...",
      "prev_segment_hash": null,
      "size_bytes": 1048576
    },
    {
      "segment_id": "seg_002",
      "file": "action_log_seg_002_501_1000.jsonl.gz",
      "batch_seq_start": 501,
      "batch_seq_end": 1000,
      "sha256": "...",
      "prev_segment_hash": "<seg_001.sha256>",
      "size_bytes": 1048576
    },
    {
      "segment_id": "seg_003",
      "file": "action_log.jsonl",
      "batch_seq_start": 1001,
      "batch_seq_end": null,
      "sha256": null,
      "prev_segment_hash": "<seg_002.sha256>",
      "size_bytes": null
    }
  ]
}
```

每个归档段的 `sha256` 包含完整文件内容哈希。`prev_segment_hash` 形成链式引用，任何段的篡改都会导致链断裂。

---

## 五、command_log 与事件批次联合恢复

### 5.1 命令与批次的绑定关系

命令创建时预分配 `event_batch_id`：

```
命令注册时：
1. command_id = uuid()
2. event_batch_id = uuid()  ← 预留，写入 command_log.event_batch_id
3. 后续 Event Writer 使用此 event_batch_id 作为 batch_id
```

事件批次 BATCH_PREPARED 中包含 `command_id`，形成双向引用：
- `command_log.event_batch_id` → 指向 batch
- `applied_event_batch.command_id` → 指向 command

### 5.2 幂等处理逻辑（含 fencing token）

```
1. 收到命令 → 计算 request_hash

2. INSERT OR IGNORE INTO command_log (
     command_id, client_instance_id, idempotency_key,
     command_type, actor_id, request_hash, event_batch_id, status
   ) VALUES (new_uuid, ?, ?, ?, ?, ?, pre_allocated_batch_id, 'PENDING');

3. SELECT * FROM command_log
   WHERE client_instance_id = ? AND idempotency_key = ?;

4. 根据 status 分支：

   SUCCEEDED:
     a. request_hash 匹配 → 返回原 result_json（幂等重放）
     b. 不匹配 → 409 CONFLICT

   PROCESSING:
     a. lease_expires_at < now() → 租约过期，检查恢复路径（§5.4）
     b. 租约有效 → 202 "command in progress"

   FAILED:
     a. attempt_count >= max_attempts → 429 "max retries exceeded"
     b. request_hash 匹配 → 原地重试（Step 5）
     c. 不匹配 → 409 CONFLICT

   PENDING:
     → Step 5（首次执行）

5. 获取租约（含 fencing token）：
   UPDATE command_log SET
     status = 'PROCESSING',
     lease_owner = <worker_id>,
     lease_generation = lease_generation + 1,
     lease_expires_at = datetime('now', '+30 seconds'),
     attempt_count = attempt_count + 1,
     last_attempt_at = datetime('now'),
     updated_at = datetime('now')
   WHERE command_id = ?
     AND status IN ('PENDING', 'FAILED')
     AND (lease_expires_at IS NULL OR lease_expires_at < datetime('now'));
   -- changes() = 0 → 并发竞争失败，返回 409

   保存 my_generation = 当前 lease_generation

6. 执行命令 + 写入事件批次

7. 提交结果（必须验证 fencing token）：
   UPDATE command_log SET
     status = 'SUCCEEDED',
     result_json = ?,
     completed_at = datetime('now'),
     lease_owner = NULL,
     updated_at = datetime('now')
   WHERE command_id = ?
     AND lease_owner = <worker_id>
     AND lease_generation = my_generation;
   -- changes() = 0 → 租约已被抢占，放弃结果

   失败时：
   UPDATE command_log SET
     status = 'FAILED',
     error_code = ?,
     error_message = ?,
     lease_owner = NULL,
     updated_at = datetime('now')
   WHERE command_id = ?
     AND lease_owner = <worker_id>
     AND lease_generation = my_generation;
```

### 5.3 租约续期

长时间命令（如报告生成）可续期租约：

```typescript
function renewLease(commandId: string, workerId: string, generation: number): boolean {
  const result = db.prepare(`
    UPDATE command_log SET
      lease_expires_at = datetime('now', '+30 seconds'),
      updated_at = datetime('now')
    WHERE command_id = ?
      AND lease_owner = ?
      AND lease_generation = ?
      AND status = 'PROCESSING'
  `).run(commandId, workerId, generation);
  return result.changes > 0;
}
```

续期失败（`changes = 0`）意味着租约被抢占，执行者必须立即停止。

### 5.4 租约超时后的恢复决策矩阵

当租约超时后新请求到达：

| event_batch PREPARED | event_batch APPLIED | command result_json | 恢复动作 |
|---------------------|--------------------|--------------------|----------|
| ❌ 不存在 | — | — | 重新执行命令（Step 5） |
| ✅ 存在 | ❌ 未 APPLIED | — | 重放 batch → APPLY → CONFIRM → 标记 SUCCEEDED |
| ✅ 存在 | ✅ APPLIED | ❌ 无 result | 补写 CONFIRM → 从投影结果构造 result_json → 标记 SUCCEEDED |
| ✅ 存在 | ✅ CONFIRMED | ✅ 有 result | 直接返回 result_json（幂等重放） |

```typescript
function recoverTimedOutCommand(cmd: CommandLog): RecoveryAction {
  const batchId = cmd.event_batch_id;

  // 检查 JSONL 中是否有 PREPARED
  const prepared = findPreparedInJsonl(batchId);
  if (!prepared) {
    return { action: 'RETRY', reason: 'no_batch_prepared' };
  }

  // 检查 SQLite 中是否有 APPLIED
  const applied = db.prepare(
    `SELECT batch_status FROM applied_event_batch WHERE batch_id = ?`
  ).get(batchId);

  if (!applied) {
    return { action: 'REPLAY_BATCH', batch: prepared };
  }

  if (applied.batch_status === 'APPLIED') {
    return { action: 'CONFIRM_AND_COMPLETE', batch: prepared };
  }

  // CONFIRMED — 命令实际已成功，只是未标记
  return { action: 'MARK_SUCCEEDED', batch: prepared };
}
```

### 5.5 旧执行者失去租约后的行为

**核心规则：失去租约的执行者不得继续提交结果。**

实现方式：
1. 所有结果提交 UPDATE 包含 `WHERE lease_owner = ? AND lease_generation = ?`
2. `changes() = 0` 意味着租约已被抢占 → 立即丢弃本地结果
3. Event Writer 在 Step 2 (APPLY) 前也检查 lease 有效性

```typescript
function assertLeaseValid(commandId: string, workerId: string, generation: number): void {
  const cmd = db.prepare(`
    SELECT lease_owner, lease_generation, status FROM command_log WHERE command_id = ?
  `).get(commandId);

  if (cmd.lease_owner !== workerId || cmd.lease_generation !== generation) {
    throw new LeaseExpiredError(commandId);
  }
  if (cmd.status !== 'PROCESSING') {
    throw new CommandNoLongerProcessingError(commandId);
  }
}
```

### 5.6 崩溃窗口联合恢复矩阵

| 崩溃时机 | command_log.status | JSONL | applied_event_batch | 恢复动作 |
|----------|-------------------|-------|--------------------|----|
| Step 5 后、Step 1a 前 | PROCESSING | 无 | 无 | 租约超时 → 重新执行 |
| Step 1g (fsync) 后、Step 2 前 | PROCESSING | PREPARED+EVENTS 完整 | 无 | 租约超时 → 检测到 PREPARED → 重放 |
| Step 2 中途 | PROCESSING | PREPARED+EVENTS 完整 | 无 (事务回滚) | 租约超时 → 同上 |
| Step 2 COMMIT 后、Step 3a 前 | PROCESSING | PREPARED+EVENTS | APPLIED | 租约超时 → 检测到 APPLIED → 补写 CONFIRM |
| Step 3c 后、Step 7 前 | PROCESSING | COMMITTED | CONFIRMED | 租约超时 → 检测到 CONFIRMED → 标记 SUCCEEDED |
| Step 7 前崩溃 | PROCESSING | COMMITTED | CONFIRMED | 同上 |
| Step 7 UPDATE 中 | PROCESSING 或 SUCCEEDED | COMMITTED | CONFIRMED | 下次查询时判断 batch 已 CONFIRMED → 标记 SUCCEEDED |

---

## 六、安全事件双熔断时序

### 6.1 设计原则

**废止 v1.1 中"安全事件不经过 projector、拥有独立持久化通道"的表述。**

正确流程：安全事件走标准事件溯源路径（JSONL → SQLite 投影），既有 schema v0.1.7 触发器在投影事务内执行双熔断。

### 6.2 CreateSafetyIncident 完整时序

```
T+0ms   教师点击 "触发安全红线"
        POST /api/v1/safety-incidents
        Body: {student_user_id, job_code, task_code, reason_code, description}
        Headers: Cookie: session=<signed>; X-Idempotency-Key: "redline-{uuid}"

T+10ms  Server: AuthGate.verifySessionCookie() + assertRole(TEACHER)

T+20ms  CommandBus.dispatch('CreateSafetyIncident', {...})
        → 注册 command_log (status=PENDING, event_batch_id=预分配)
        → 获取租约 (status=PROCESSING)

T+30ms  Domain Layer 执行：
        1. 验证学生存在、岗位/任务有效
        2. 生成事件序列：
           - SafetyIncidentCreated {incident_id, student_user_id, job_code, task_code,
             reason_code, description, source_device_id, source_node_id, command_id}
           - (对每个匹配的开放 assessment) AssessmentRedlineHalted {session_id, incident_id}
           - (对每个匹配的开放 training) TrainingRedlineHalted {session_id, incident_id}

T+40ms  Event Writer Step 1: PREPARE
        → 写入 JSONL: BATCH_PREPARED + 所有事件行
        → fsync

T+60ms  Event Writer Step 2: APPLY (SQLite BEGIN IMMEDIATE)
        a. INSERT applied_event_batch
        b. 投影 SafetyIncidentCreated:
           → INSERT INTO safety_incident (
               incident_id, student_user_id, job_code, task_code,
               reason_code, description, source_device_id, source_node_id, command_id,
               triggered_by, status, created_at, updated_at
             ) VALUES (...)
           → 既有触发器自动执行：
             ┌─ assessment 熔断触发器:
             │  UPDATE assessment_session SET status = 'REDLINE_HALTED'
             │  WHERE student_id = NEW.student_user_id
             │    AND job_code = NEW.job_code AND task_code = NEW.task_code
             │    AND status IN ('INIT','ACTIVE','EMOTION_INTERRUPTED','OFFLINE_PENDING');
             │  INSERT INTO safety_incident_binding (...)
             │  INSERT INTO result_record (level_result='LEVEL_FAIL_BY_SAFETY', ...)
             │
             └─ training 熔断触发器:
                UPDATE training_session SET status = 'REDLINE_HALTED'
                WHERE student_id = NEW.student_user_id
                  AND job_code = NEW.job_code AND task_code = NEW.task_code
                  AND status IN ('INIT','ACTIVE');
                INSERT INTO safety_incident_binding (...)
        c. INSERT processed_event (for each event)
        d. UPDATE projector_cursor
        e. COMMIT  ← 一切在同一事务内完成

T+80ms  Event Writer Step 3: CONFIRM
        → JSONL BATCH_COMMITTED
        → UPDATE applied_event_batch SET batch_status='CONFIRMED'

T+90ms  UPDATE command_log SET status='SUCCEEDED', result_json='{...}'

T+100ms NotificationBus.emit:
        → SSE → Teacher: {event: "safety_incident.created", ...}
        → BrowserWindow.webContents.send → Student Renderer: {type: "redline_halted"}

T+120ms Student Renderer 切换到 REDLINE_HALTED 界面，禁止所有交互

T+150ms HTTP 201 返回教师平板
```

### 6.3 safety_incident 状态机

```
PENDING_DETAIL → CONFIRMED → RESOLVED
                          ↘ VOIDED (需 void_reason + 可选 replacement_incident_id)
```

- `CONFIRMED`: core_facts_frozen = 1，不可修改 reason_code/description
- `RESOLVED`: 管理员标记处理完毕
- `VOIDED`: 事实判定错误时作废

### 6.4 核心事实冻结与权限

- CONFIRMED 后 `core_facts_frozen = 1`，应用层拒绝修改以下字段：
  `reason_code`, `description`, `student_user_id`, `job_code`, `task_code`
- 新增的 `source_device_id`, `source_node_id`, `command_id` 为来源上下文，不影响核心事实冻结逻辑
- 触发器执行的熔断操作不可人工回退（REDLINE_HALTED 是终态）

---

## 七、HTTPS 部署与信任方案

### 7.1 证书体系设计

**节点 CA + 短期叶子证书模型：**

```
Node Root CA (自签名, ECDSA P-256, 5 年有效)
  │
  └── Server Leaf Certificate (ECDSA P-256, 90 天有效)
        SAN: DNS:<node-name>.local, IP:<当前局域网 IP>
```

### 7.2 密钥存储与保护

| 平台 | CA 私钥保护方案 | 位置 |
|------|----------------|------|
| **Windows** | DPAPI 加密 + 受限 ACL (仅 SYSTEM + 当前用户) | `%LOCALAPPDATA%/xc-career/certs/ca.key.dpapi` |
| **Linux** | chmod 600 + 仅属主可读 | `~/.local/share/xc-career/certs/ca.key` |
| **macOS** | Keychain Access (kSecAttrAccessibleAfterFirstUnlock) | System Keychain |

**CA 私钥长期保存规则：**
- CA 私钥在节点生命周期内保留，用于签发新叶子证书
- 备份：CA 私钥包含在加密备份中（备份本身受密码保护）
- 轮换：CA 过期（5 年）或主动轮换时，生成新 CA，所有已配对设备需重新安装新 CA
- 撤销：无 CRL/OCSP（局域网场景不适用）；撤销通过重新生成 CA + 全量重配对实现

### 7.3 SAN 策略

**优先使用稳定 mDNS 主机名，IP SAN 作为可选补充：**

```
必选 SAN:
  DNS:localhost
  DNS:<node-name>.local         ← 稳定，IP 变化不影响

可选 SAN (IP 固定时添加):
  IP:127.0.0.1
  IP:<当前局域网 IP>            ← 仅当 IP 已知且稳定时

禁止:
  IP:192.168.*.*                ← 无效通配符
  DNS:*.local                   ← 无效通配符
```

### 7.4 IP 变化与叶子证书重签

```
IP 变化检测:
1. Server 启动时检查当前 IP 与证书 SAN 中的 IP 是否匹配
2. 不匹配时自动触发叶子证书重签:
   a. 用 CA 私钥签发新叶子证书（新 IP 加入 SAN）
   b. Fastify 热重载 TLS context (server.server.setSecureContext({key, cert}))
   c. 通知已配对设备（SSE 事件 server.cert_rotated）
3. 教师平板收到通知后下次连接使用新证书（CA 不变则无需重新信任）
4. 若 CA 未变，浏览器信任不受影响（同一 CA 签发）
```

### 7.5 三种部署模式与信任建立

| 模式 | 场景 | 信任建立方式 |
|------|------|-------------|
| **学校 MDM/机构 CA** | 学校 IT 统一管理 | IT 通过 MDM 推送节点 CA 证书到所有教师设备 |
| **手工安装本地 CA** | 无 MDM 的小规模部署 | 教师手工下载 ca.crt → 在系统设置中安装并启用信任（iOS: 设置→通用→描述文件; Android: 设置→安全→安装证书; Windows: certmgr.msc） |
| **未来教师原生客户端** | 专用 App | 证书固定 (certificate pinning)，App 内嵌 CA 公钥 |

### 7.6 带外配对端点（HTTP :7070）

**用途：仅用于指纹核对，不能自动建立浏览器信任。**

```
配对流程:
1. 一体机屏幕显示配对引导（含服务地址和 CA 指纹）
2. Server 在 :7070 (HTTP) 临时暴露:
   GET /api/v1/pair/fingerprint
   返回: {
     "ca_fingerprint_sha256": "<hex>",
     "server_ip": "192.168.x.x",
     "https_port": 7443,
     "node_name": "<name>.local",
     "ca_download_url": "https://<ip>:7443/api/v1/pair/ca.crt"
   }
3. 教师平板访问 http://<ip>:7070/api/v1/pair/fingerprint
   比对屏幕上显示的指纹与返回值是否一致
4. 确认后：
   a. 教师手动访问 ca_download_url 下载 ca.crt
   b. 在系统设置中安装并信任该 CA
   c. 安装完成后所有 HTTPS 请求正常（证书由已信任的 CA 签发）
5. :7070 端口在配对完成或 5 分钟超时后关闭

注意: HTTP 端点不传输任何敏感数据，不能宣称它自动建立浏览器信任。
浏览器信任只能通过上述三种模式中的一种建立。
```

### 7.7 证书轮换时间线

| 事件 | 触发 | 动作 | 对教师端影响 |
|------|------|------|-------------|
| 叶子证书 < 30 天到期 | 定时检查 | 自动重签（CA 不变） | 无感知 |
| IP 地址变化 | 启动时检查 | 叶子重签 | 无感知（CA 不变） |
| CA 证书 < 60 天到期 | 定时检查 | 生成新 CA + 新叶子 | 需重新安装 CA |
| 管理员主动轮换 | 手动触发 | 同上 | 需重新安装 CA |

---

## 八、Grant 重绑定与身份确认

### 8.1 设计原则

1. **短暂网络断开不创建新 device_runtime_session**（§2.1 约束）
2. **不得原地修改旧 grant 的 device_runtime_session_id**
3. 旧 grant 标记 EXPIRED/REVOKED → 创建新 grant（保存 `replaces_grant_id`）
4. 通过 active assignment 精确定位 grant（不按 student_user_id 模糊查询）

### 8.2 Rebind 触发条件与 runtime session 创建规则

| 事件 | 创建新 runtime session? | 需要 grant rebind? |
|------|------------------------|-------------------|
| 网络断开 < 心跳超时（默认 60s） | ❌ 否 | ❌ 否 |
| 网络断开 > 心跳超时 | ❌ 否（恢复时发送 reconnect 心跳） | ❌ 否 |
| 进程重启（Electron 退出并重启） | ✅ 是 | ✅ 是 |
| 设备重启 | ✅ 是 | ✅ 是 |
| 教师明确结束设备会话 | ✅ 是 | ✅ 是 |
| 设备替换 | ✅ 是（新设备） | ✅ 是（新设备新 grant） |

### 8.3 Rebind 协议

```
前提：
  - 设备重启后创建了新 device_runtime_session (new_drs)
  - 设备上有 active assignment（通过设备本地持久化的 assignment_id 恢复）

Rebind 流程:

1. 设备发送重连请求:
   POST /api/v1/devices/:deviceId/reconnect
   Body: { device_runtime_session_id: new_drs, assignment_id: known_assignment_id }

2. Server 定位当前 active assignment:
   SELECT a.*, g.grant_id, g.status as grant_status
   FROM business_session_assignment a
   LEFT JOIN delegated_access_grant g ON g.assignment_id = a.assignment_id AND g.status = 'ACTIVE'
   WHERE a.assignment_id = ? AND a.device_id = ? AND a.status = 'ACTIVE';

3. 若 assignment 存在且 ACTIVE:
   a. 标记旧 grant 为 EXPIRED:
      UPDATE delegated_access_grant SET
        status = 'EXPIRED', released_at = datetime('now'),
        release_reason = 'DEVICE_RESTARTED', updated_at = datetime('now')
      WHERE grant_id = ? AND status = 'ACTIVE';

   b. 创建新 grant:
      INSERT INTO delegated_access_grant (
        grant_id, teacher_auth_session_id, teacher_user_id, student_user_id,
        assignment_id, device_runtime_session_id, capabilities_json,
        replaces_grant_id, status, expires_at, ...
      ) VALUES (new_uuid, <teacher_session>, ..., new_drs, ..., old_grant_id, 'ACTIVE', ...);

   c. 判断是否需要身份重新确认（§8.4）

   d. 生成领域事件 GRANT_REBOUND:
      {grant_id: new, replaces_grant_id: old, device_runtime_session_id: new_drs,
       identity_reconfirmation_required: true/false}

4. 若 assignment 不存在或已释放:
   → 通知教师端（SSE: device.reconnected_no_assignment）
   → 设备显示"等待教师分配"
```

### 8.4 身份重新确认规则

| 重启场景 | 需要学生重新确认身份? | 确认方式 |
|----------|---------------------|----------|
| 进程崩溃重启（< 2 分钟内） | ❌ 否 | 静默恢复 |
| 进程正常退出后重启 | ✅ 是 | PIN 或教师确认 |
| 设备重启 | ✅ 是 | PIN 或教师确认 |
| 设备替换 | ✅ 是 | 完整重新分配流程 |

**判定逻辑：**

```typescript
function requiresIdentityReconfirmation(
  oldDrs: DeviceRuntimeSession,
  newDrs: DeviceRuntimeSession
): boolean {
  if (oldDrs.end_reason === 'HEARTBEAT_TIMEOUT') {
    // 心跳超时不一定是重启（可能是网络问题）
    // 检查时间差：< 2 分钟视为快速恢复
    const gap = Date.parse(newDrs.started_at) - Date.parse(oldDrs.ended_at!);
    return gap > 2 * 60 * 1000;
  }
  // GRACEFUL_SHUTDOWN 或 REPLACED 都需要重新确认
  return true;
}
```

### 8.5 Grant DDL 中的身份确认字段

```sql
-- 已在 §3.6 delegated_access_grant 表中定义：
-- identity_confirmation_method: 'PIN' | 'TEACHER_ATTESTATION' | 'PHOTO_MATCH' | 'NONE_REQUIRED'
-- confirmed_by: 确认操作的执行者（教师或系统）
-- confirmation_evidence: JSON（PIN hash / 教师 attestation 时间戳等）
-- student_pin_verified: 0|1
-- teacher_attested: 0|1
-- confirmed_at: ISO timestamp
```

身份确认完成后更新：
```sql
UPDATE delegated_access_grant SET
  identity_confirmation_method = ?,
  confirmed_by = ?,
  confirmation_evidence = ?,
  student_pin_verified = ?,
  teacher_attested = ?,
  confirmed_at = datetime('now'),
  updated_at = datetime('now')
WHERE grant_id = ? AND status = 'ACTIVE';
```

---

## 九、SSE、CSRF 与权限合同

### 9.1 协议选择

| 客户端 | 协议 | 理由 |
|--------|------|------|
| 教师平板浏览器 → Server | HTTPS REST + SSE | 写操作走 REST POST；读推送走 SSE |
| Student Renderer → Main → Server | IPC (contextBridge + MessagePortMain) | 不经网络 |
| Main → Student Renderer | `BrowserWindow.webContents.send()` | 直接进程内推送 |

**WebSocket 完全删除。** 本文档中不存在 ws_ticket、WebSocket 连接、WebSocket 认证相关内容。

### 9.2 SSE 认证与 stream_epoch

```typescript
// SSE 连接建立
// GET /api/v1/events/stream
// Cookie: session=<signed_httponly_cookie>

// Server 验证 Cookie → 确定身份 → 分配 stream

// SSE event id 格式: <stream_epoch>:<sequence>
// stream_epoch = server 启动时生成的 UUID 前 8 位
// 用途: 客户端 Last-Event-ID 中的 epoch 不匹配时强制 resync

interface SSEEventId {
  epoch: string;   // 8 hex chars, server 重启时变化
  seq: number;     // 单调递增
}

// 格式化: "a1b2c3d4:42"
```

**断线重连：**
1. `EventSource` 自动重连，发送 `Last-Event-ID: <epoch>:<seq>`
2. Server 检查 epoch 是否匹配当前实例:
   - 匹配 → 从环形缓冲区补发 seq 之后的事件
   - 不匹配（server 重启过）→ 发送 `event: resync_required`
3. 客户端收到 `resync_required` → REST 全量查询刷新状态

### 9.3 SSE 频道与授权

```typescript
function resolveSSEChannels(authSession: AuthSession): string[] {
  if (authSession.role === 'TEACHER') {
    return [
      ...getActiveSessionChannels(authSession.user_id),
      'devices:status',
      'system:alerts'
    ];
  }
  if (authSession.role === 'ADMIN') {
    return ['*'];
  }
  // STUDENT 不使用 SSE（走 IPC）
  return [];
}
```

### 9.4 CSRF 防护

**Cookie 写接口三层防护：**

| 层 | 机制 | 实现 |
|----|------|------|
| 1 (主防线) | CSRF Token | 双提交 Cookie 模式：登录时 Set-Cookie `csrf_token`（non-HttpOnly），每个写请求 Header `X-CSRF-Token` 必须匹配 |
| 2 (辅助) | Origin/Referer 校验 | 验证 Origin header 与已知 origin 列表匹配；无 Origin 时检查 Referer |
| 3 (辅助) | SameSite=Strict | Cookie 属性，作为纵深防御而非唯一防线 |

```typescript
// CSRF 中间件
server.addHook('preHandler', async (request, reply) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
    // Layer 1: CSRF Token
    const cookieToken = request.cookies.csrf_token;
    const headerToken = request.headers['x-csrf-token'];
    if (!cookieToken || cookieToken !== headerToken) {
      throw { statusCode: 403, code: 'CSRF_VALIDATION_FAILED' };
    }

    // Layer 2: Origin 校验
    const origin = request.headers.origin;
    const referer = request.headers.referer;
    if (origin && !allowedOrigins.has(origin)) {
      throw { statusCode: 403, code: 'ORIGIN_NOT_ALLOWED' };
    }
    if (!origin && referer) {
      const refOrigin = new URL(referer).origin;
      if (!allowedOrigins.has(refOrigin)) {
        throw { statusCode: 403, code: 'REFERER_NOT_ALLOWED' };
      }
    }
  }
});
```

### 9.5 Cookie 策略

| 客户端类型 | 认证载体 | Cookie 属性 |
|-----------|---------|-------------|
| 教师浏览器 session | `session` Cookie | HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=3600 |
| 教师浏览器 refresh | `refresh_token` Cookie | HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth/refresh; Max-Age=604800 |
| CSRF token | `csrf_token` Cookie | Secure; SameSite=Strict; Path=/ (非 HttpOnly，JS 可读) |
| 设备凭证 | `device_credential` Cookie | HttpOnly; Secure; SameSite=Strict; Max-Age=31536000 |

### 9.6 Main → Renderer 推送修正

**禁止在 Electron 内部使用 SSE/WebSocket 向 Renderer 推送。**

正确方式：

```typescript
// 在 Main 进程中，收到 Server 通过 MessagePort 发来的通知后：
function pushToStudentRenderer(win: BrowserWindow, channel: string, data: any): void {
  if (!win.isDestroyed()) {
    win.webContents.send(channel, data);
  }
}

// Student Renderer (preload.ts 暴露):
contextBridge.exposeInMainWorld('electronAPI', {
  onNotification: (callback: (data: any) => void) => {
    ipcRenderer.on('server:notification', (_event, data) => callback(data));
  }
});
```

---

## 十、离线评分与最终完成

### 10.1 delivery_phase 单向状态机

```
PREPARED → ASSIGNED → STUDENT_CONFIRMED → ONLINE_IN_PROGRESS
  → ONLINE_COMPLETED → OFFLINE_SCORING → OBSERVATION → READY_TO_FINALIZE → FINALIZED
                                       ↘ READY_TO_FINALIZE (无观察模板时跳过)
                                                          ↘ FINALIZED
```

**合法迁移表：**

```typescript
const DELIVERY_PHASE_TRANSITIONS: Record<string, string[]> = {
  'PREPARED':            ['ASSIGNED'],
  'ASSIGNED':            ['STUDENT_CONFIRMED'],
  'STUDENT_CONFIRMED':   ['ONLINE_IN_PROGRESS'],
  'ONLINE_IN_PROGRESS':  ['ONLINE_COMPLETED'],
  'ONLINE_COMPLETED':    ['OFFLINE_SCORING'],
  'OFFLINE_SCORING':     ['OBSERVATION', 'READY_TO_FINALIZE'],
  'OBSERVATION':         ['READY_TO_FINALIZE'],
  'READY_TO_FINALIZE':   ['FINALIZED'],
  'FINALIZED':           [],  // 终态
};
```

**严格单向：任何反向迁移（如 FINALIZED→OBSERVATION）在 Domain Layer 中抛出 InvalidStateTransitionError。**

### 10.2 各阶段职责

| delivery_phase | 谁触发 | 发生什么 | 下一步条件 |
|---------------|--------|----------|-----------|
| PREPARED | 系统 | 会话创建完成 | 教师分配到设备 |
| ASSIGNED | 教师 | assignment 创建 | 学生确认身份 |
| STUDENT_CONFIRMED | 学生 | 身份确认完成 | 开始作答 |
| ONLINE_IN_PROGRESS | 系统 | 学生开始答题 | 所有在线题完成 |
| ONLINE_COMPLETED | 系统 | 在线部分完成 | 教师开始评分 |
| OFFLINE_SCORING | 系统 | 等待教师评分 | 教师提交 finalize |
| OBSERVATION | 系统 | 等待教师补充观察 | 教师提交观察完成 |
| READY_TO_FINALIZE | 系统 | 所有输入就绪 | 系统计算结果 |
| FINALIZED | 系统 | 结果计算+报告生成完成 | 终态 |

### 10.3 离线评分提交流程

```
教师操作流程：

1. 保存草稿（可反复调用）:
   PUT /api/v1/assessments/:sessionId/offline-scores/draft
   → 验证 delivery_phase = 'OFFLINE_SCORING'
   → INSERT OR REPLACE offline_score_draft (幂等覆盖)

2. 最终确认提交（不可逆）:
   POST /api/v1/assessments/:sessionId/offline-scores/finalize
   → 验证 delivery_phase = 'OFFLINE_SCORING'
   → 验证所有必填题目已评分
   → 验证 version 匹配（乐观锁）
   → 写入最终评分事件
   → 判断 observation_template_id:
     - IS NOT NULL → 迁移 OFFLINE_SCORING → OBSERVATION
     - IS NULL → 迁移 OFFLINE_SCORING → READY_TO_FINALIZE

3. 提交观察记录（若需要）:
   POST /api/v1/assessments/:sessionId/observations/finalize
   → 验证 delivery_phase = 'OBSERVATION'
   → 写入观察记录事件
   → 迁移 OBSERVATION → READY_TO_FINALIZE

4. 系统自动完成:
   READY_TO_FINALIZE 状态触发内部 CalculateResult:
   → 计算等级判定
   → 生成 result_record
   → 生成报告 (report_content_json)
   → 迁移 READY_TO_FINALIZE → FINALIZED
   → 同步更新 assessment_session.status = 'COMPLETED'
```

### 10.4 FINALIZED 与 assessment_session.COMPLETED 的映射

| delivery_phase | assessment_session.status | 含义 |
|---------------|--------------------------|------|
| FINALIZED | COMPLETED | 正常完成 |
| 任何阶段 | REDLINE_HALTED | 安全熔断（delivery_phase 冻结在当时值）|
| 任何阶段 | ABORTED | 教师主动终止（delivery_phase 冻结）|

### 10.5 观察是否必填

由 `assessment_session.observation_template_id` 决定：
- `IS NOT NULL` → 观察阶段必须经过，不可跳过
- `IS NULL` → 无观察模板，OFFLINE_SCORING 直接到 READY_TO_FINALIZE

### 10.6 Finalization 后受控纠错

**FINALIZED 是终态，不可回退。** 纠错方式：

1. **评分错误：** 创建新的 correction_record（审计追踪），不修改原 result_record
2. **报告错误：** 生成新版本报告（result_record.report_version + 1），保留历史版本
3. **事实错误：** 如果测评本身无效，由管理员将 assessment_session.status 迁移到 `VOIDED`（独立终态，不经过 delivery_phase）

```sql
-- 可选新增：纠错支持
ALTER TABLE assessment_session ADD COLUMN status CHECK (status IN (
  'INIT', 'ACTIVE', 'EMOTION_INTERRUPTED', 'OFFLINE_PENDING',
  'COMPLETED', 'ABORTED', 'REDLINE_HALTED', 'VOIDED'));
```

---

## 十一、备份恢复合同

### 11.1 备份方法

**唯一正式方案：SQLite Online Backup API 或 `VACUUM INTO`。**

删除"复制 WAL checkpoint 后数据库文件"的方案。`VACUUM INTO` 产生原子的、紧凑的独立数据库文件。

```typescript
function backupDatabase(db: Database, targetPath: string): void {
  db.exec(`VACUUM INTO '${targetPath}'`);
}
```

### 11.2 备份范围（单一恢复批次）

一次备份必须包含以下全部组件作为一个整体：

| 组件 | 文件 | 说明 |
|------|------|------|
| SQLite 数据库 | `backup.db` | VACUUM INTO 产出 |
| JSONL 事件日志 | `segments/*.jsonl` | 截止到 cut_segment_byte_offset |
| segment_index | `segment_index.json` | 段索引 |
| asset-manifest | `asset-manifest.json` | 资源清单 |
| 资源目录 | `assets/*` | 实际资源文件 |
| 备份清单 | `backup-manifest.json` | 外部 manifest 文件 |

### 11.3 Write Barrier 流程

```
备份流程:

1. 通知 Command Bus 进入 BACKUP_FREEZE 模式
   → 新命令排队等待，不执行
   → 最长等待 5 秒；超时则备份失败

2. 等待所有 in-flight batch 完成:
   轮询: SELECT COUNT(*) FROM applied_event_batch WHERE batch_status = 'APPLIED'
   → 结果 = 0 或 10 秒超时（超时则备份失败）

3. Write Barrier 还必须覆盖：
   - offline_score_draft 写入（暂停自动保存）
   - heartbeat 更新（允许继续但不影响一致性）
   - auth_session 到期清理（暂停）
   → 所有可能修改备份范围内数据的写入都被 freeze

4. 记录 cut point:
   cut_batch_sequence = SELECT last_batch_sequence FROM projector_cursor WHERE projector_name = 'main'
   cut_segment_id = 当前活跃段 segment_id
   cut_segment_byte_offset = stat(active_jsonl).size  ← fsync 后读取
   cut_at = datetime('now')

5. 执行 SQLite 备份:
   VACUUM INTO '<staging_dir>/backup.db'

6. 复制 JSONL:
   所有归档段完整复制
   活跃段截取到 cut_segment_byte_offset（严格等于，不接受"等于或大于"）

7. 复制 segment_index.json（更新活跃段 size 为 cut_segment_byte_offset）

8. 复制 asset-manifest.json + 所有引用的资源文件

9. 计算所有文件 SHA-256

10. 写入外部 backup-manifest.json:
    {
      manifest_id, backup_status: "COMPLETED",
      schema_version, app_version, node_id,
      cut_batch_sequence, cut_segment_id, cut_segment_byte_offset, cut_at,
      database: { file, sha256, size_bytes },
      segments: [ { file, sha256, batch_seq_start, batch_seq_end, size_bytes } ],
      assets: { manifest_sha256, file_count, total_size_bytes },
      created_at
    }

11. 更新 SQLite backup_manifest 表 (backup_status = 'COMPLETED')

12. 退出 BACKUP_FREEZE 模式 → Command Bus 恢复处理
```

### 11.4 恢复流程（Staging → 切换）

```
恢复流程:

1. 解析 backup-manifest.json
   → 验证 schema_version 兼容性
   → 验证所有文件 SHA-256

2. 恢复到 staging 目录 (<dataDir>/restore_staging/):
   a. 复制 backup.db → staging/xc-career-guide.db
   b. 执行 PRAGMA integrity_check → 失败则恢复中止
   c. 复制所有 JSONL 段 → staging/event_log/
   d. 复制 segment_index.json → staging/
   e. 复制 asset-manifest.json + 资源文件 → staging/assets/

3. 完整性校验:
   a. 验证 staging DB 中 projector_cursor.last_batch_sequence = cut_batch_sequence
   b. 验证活跃段文件大小 = cut_segment_byte_offset
   c. 验证段 hash 链完整（每段 prev_segment_hash 匹配前段 sha256）
   d. 验证 asset-manifest 中引用的所有文件存在且 hash 正确

4. 整体切换（原子性保证）:
   a. 停止 Server (utilityProcess)
   b. 备份当前数据到 <dataDir>/pre-restore-<timestamp>/
   c. 将 staging/ 下所有文件移动到正式位置
   d. 删除 staging/

5. 启动恢复:
   a. 重启 Server
   b. startupRecovery() 运行（§4.7）
   c. 验证 projector_cursor 正确
   d. 系统进入正常模式

6. 失败回滚:
   任何步骤失败 → 从 pre-restore 目录恢复原始文件
```

### 11.5 JSONL 永久归档策略

**JSONL 是事实来源，禁止简单删除旧事件。**

| 策略 | 说明 |
|------|------|
| 归档压缩 | 旧段 gzip 压缩移入 `archive/` 目录 |
| 保留策略 | 最近 30 天 + 至少最近 3 段保持在线（未压缩） |
| 验证基线快照 | 每次备份的 segment_index.json 是一个可验证基线 |
| 永久保留 | 所有段（含归档）永不删除；空间不足时报警，不自动清理 |
| hash 链验证 | 任何时候可通过 segment_index.json 中的 hash 链验证所有段完整性 |

### 11.6 backup_manifest 生命周期

| backup_status | 含义 | 转换 |
|---------------|------|------|
| PREPARING | backup_freeze 已生效，正在执行备份 | → COMPLETED 或 → FAILED |
| COMPLETED | 备份成功完成 | 终态 |
| FAILED | 备份过程中出错 | 终态（可删除对应文件） |
| CORRUPTED | 事后校验发现文件损坏 | 终态（标记不可恢复） |

---

## 十二、REST API 与事件合同

### 12.1 基础约定

- 基础路径: `/api/v1/`
- 认证: `Cookie: session=<signed_httponly_cookie>` (教师/管理员) | IPC 凭证 (学生)
- 写操作必选 Header: `X-Idempotency-Key`, `X-Client-Instance-Id`, `X-CSRF-Token`
- 响应格式: `{ "ok": true, "data": {...} }` | `{ "ok": false, "error": { "code": "...", "message": "..." } }`
- 所有 datetime 使用 ISO 8601 UTC

### 12.2 核心 API 端点

| Method | Path | 说明 | 角色 |
|--------|------|------|------|
| POST | `/auth/login` | Cookie-based 登录 | ALL |
| POST | `/auth/refresh` | 刷新 session | ALL |
| POST | `/auth/logout` | 撤销 session | ALL |
| POST | `/devices/pair` | 设备配对 | ADMIN |
| GET | `/devices` | 列出设备 | TEACHER+ |
| POST | `/devices/:id/heartbeat` | 心跳 | DEVICE |
| POST | `/devices/:id/reconnect` | 设备重连 + grant rebind | DEVICE |
| GET | `/students` | 列出学生 | TEACHER+ |
| POST | `/session-assignments` | 统一分配命令 | TEACHER |
| POST | `/session-assignments/:id/confirm` | 学生确认 | STUDENT |
| POST | `/session-assignments/:id/release` | 释放分配 | TEACHER |
| POST | `/assessments` | 创建测评会话 | TEACHER |
| GET | `/assessments` | 列出测评 | TEACHER+ |
| GET | `/assessments/:id` | 测评详情 | TEACHER+ |
| POST | `/assessments/:id/start` | 启动测评 | STUDENT |
| POST | `/assessments/:id/answers` | 提交答案 | STUDENT |
| POST | `/assessments/:id/emotion-interrupt` | 情绪中断 | TEACHER |
| POST | `/assessments/:id/emotion-resume` | 恢复 | TEACHER |
| POST | `/assessments/:id/abort` | 终止 | TEACHER |
| PUT | `/assessments/:id/offline-scores/draft` | 保存评分草稿 | TEACHER |
| GET | `/assessments/:id/offline-scores/draft` | 获取草稿 | TEACHER |
| POST | `/assessments/:id/offline-scores/finalize` | 确认评分 | TEACHER |
| POST | `/assessments/:id/observations/finalize` | 确认观察 | TEACHER |
| GET | `/assessments/:id/report` | 获取报告 | TEACHER+STUDENT(条件) |
| POST | `/safety-incidents` | 创建安全事件 | TEACHER |
| GET | `/safety-incidents` | 列出 | TEACHER+ |
| POST | `/safety-incidents/:id/confirm` | 确认事实 | TEACHER |
| POST | `/safety-incidents/:id/resolve` | 解决 | ADMIN |
| POST | `/safety-incidents/:id/void` | 作废 | ADMIN |
| GET | `/events/stream` | SSE 事件流 | TEACHER+ |
| GET | `/assets/:id` | 资源文件 (Range) | ALL |
| GET | `/health` | 健康检查 | ALL |
| POST | `/backups` | 触发备份 | ADMIN |
| GET | `/backups` | 列出备份 | ADMIN |
| POST | `/backups/:id/restore` | 恢复 | ADMIN |

### 12.3 统一分配命令详细合同

```
POST /api/v1/session-assignments
Body: {
  "student_user_id": "stu-001",
  "device_id": "dev-001",
  "business_session_id": "sess-001",
  "require_student_confirmation": true
}

原子执行（单 SQLite 事务内）：
1. 验证学生存在且状态正常
2. 验证设备 TRUSTED + 当前有 ACTIVE runtime session
3. 验证 business_session 存在且处于可分配状态
4. 验证设备当前无其他 ACTIVE 分配（唯一约束）
5. 验证业务会话当前无其他 ACTIVE 分配（唯一约束）
6. 创建 business_session_assignment (PENDING_CONFIRM)
7. 创建 delegated_access_grant (ACTIVE, 绑定 assignment)
8. 写入事件批次 (BUSINESS_SESSION_ASSIGNED)
9. 通知学生设备 (BrowserWindow.webContents.send)

Response 201:
{
  "ok": true,
  "data": {
    "assignment_id": "asgn-001",
    "grant_id": "grant-001",
    "status": "PENDING_CONFIRM"
  }
}
```

### 12.4 事件类型合同

| 事件类型 | 触发场景 | payload 关键字段 |
|----------|---------|-----------------|
| DEVICE_REGISTERED | 设备首次配对 | device_id, node_id |
| DEVICE_RUNTIME_SESSION_STARTED | 设备进程启动 | device_id, drs_id |
| DEVICE_RUNTIME_SESSION_ENDED | 设备进程退出/超时 | drs_id, end_reason |
| AUTH_SESSION_CREATED | 用户登录 | user_id, auth_method |
| AUTH_SESSION_REVOKED | 用户登出/撤销 | auth_session_id, reason |
| GRANT_CREATED | 教师授权 | grant_id, student_user_id, assignment_id |
| GRANT_RELEASED | 授权释放 | grant_id, reason |
| GRANT_REBOUND | 设备重启后重绑定 | new_grant_id, replaces_grant_id |
| BUSINESS_SESSION_ASSIGNED | 分配 | assignment_id, business_session_id |
| BUSINESS_SESSION_RELEASED | 释放 | assignment_id, reason |
| STUDENT_CONFIRMED_ASSIGNMENT | 学生确认身份 | assignment_id |
| ANSWER_SUBMITTED | 学生提交答案 | session_id, question_id |
| SCORE_CALCULATED | 在线评分 | session_id, question_id, score |
| OFFLINE_SCORE_DRAFT_SAVED | 草稿保存 | session_id |
| OFFLINE_SCORES_FINALIZED | 评分确认 | session_id |
| OBSERVATION_SUBMITTED | 观察记录 | session_id |
| RESULT_CALCULATED | 结果计算 | session_id, level_result |
| REPORT_GENERATED | 报告生成 | session_id, result_record_id |
| SAFETY_INCIDENT_CREATED | 安全事件 | incident_id, student_user_id |
| ASSESSMENT_REDLINE_HALTED | 测评熔断 | session_id, incident_id |
| TRAINING_REDLINE_HALTED | 训练熔断 | session_id, incident_id |
| DELIVERY_PHASE_CHANGED | 阶段迁移 | session_id, from, to |
| EMOTION_INTERRUPTED | 情绪中断 | session_id |
| EMOTION_RESUMED | 情绪恢复 | session_id |
| SESSION_ABORTED | 终止 | session_id, reason |

---

## 十三、状态不变量与数据库约束

### 13.1 数据库层强制约束

| 约束 | 实现 | 表 |
|------|------|---|
| 一设备一 ACTIVE runtime session | `ux_device_one_active_runtime` partial unique | device_runtime_session |
| 一设备一 ACTIVE 学生分配 | `ux_assignment_one_active_per_device` partial unique | business_session_assignment |
| 一业务会话一 ACTIVE 分配 | `ux_assignment_one_active_per_session` partial unique | business_session_assignment |
| 一 assignment 一 ACTIVE grant | `ux_grant_one_active_per_assignment` partial unique | delegated_access_grant |
| 幂等键唯一 | `ux_command_idempotency` unique | command_log |
| batch_sequence 唯一 | `UNIQUE` on batch_sequence | applied_event_batch |
| event_id 唯一 | `PRIMARY KEY` | processed_event |
| JSON 合法性 | `CHECK (col IS NULL OR json_valid(col))` | 所有 JSON 列 |
| 布尔字段 | `CHECK (col IN (0, 1))` | 所有 INTEGER 布尔列 |
| 状态枚举 | `CHECK (col IN (...))` | 所有 status/phase 列 |
| business_session 1:1 子类型 | `UNIQUE` on business_session_id | assessment_session |

### 13.2 应用层强制不变量

| 不变量 | 实现方式 |
|--------|----------|
| delivery_phase 单向不可逆 | `assertDeliveryPhaseTransition()` 检查 VALID_TRANSITIONS |
| assessment_session.status 终态不可逆 | `assertStatusTransition()` 拒绝 COMPLETED/ABORTED/REDLINE_HALTED 出迁移 |
| event_sequence_version 乐观锁 | `WHERE esv = expected ... SET esv = expected + 1` |
| 单写者 batch 互斥 | Event Writer 持有内存 mutex |
| 投影幂等 | processed_event 检查 + INSERT OR IGNORE |
| 核心事实冻结 | `if (incident.core_facts_frozen) reject()` |
| grant-assignment 一致性 | 事务内同步状态 |
| JSONL 不可删除 | 归档操作只压缩不删除 |
| updated_at 更新 | 每个 UPDATE 语句显式 SET |
| online_status 不落盘 | 内存 Map，不写入数据库 |

### 13.3 数据流完整性

| 数据流 | 来源 → 目标 | 验证方式 |
|--------|-------------|----------|
| 事件写入 | Command → JSONL → SQLite | batch_hash 校验 |
| 投影一致性 | projector_cursor 与 applied_event_batch 匹配 | 启动恢复验证 |
| 备份一致性 | cut_batch_sequence 与 DB/JSONL 一致 | 恢复校验步骤 |
| 段链完整性 | 每段 prev_segment_hash 引用前段 | segment_index 验证 |

---

## 十四、P0/P1/P2 闭环矩阵

### 14.1 本文关闭状态

| # | 领域 | 优先级 | 状态 | 关闭依据 |
|---|------|--------|------|----------|
| 1 | JSONL–SQLite 恢复协议 | P0 | CLOSED | §4 完整算法 + batch_hash + processed_event + CORRUPTION_DETECTED |
| 2 | command_log 联合恢复 | P0 | CLOSED | §5 fencing token + 恢复矩阵 + 6 崩溃窗口 |
| 3 | 安全事件双熔断 | P0 | CLOSED | §6 标准事件路径 + 触发器时序 |
| 4 | HTTPS 信任方案 | P0 | CLOSED | §7 Node CA + 短期叶子 + 3 模式 + IP 重签 + 密钥保护 |
| 5 | Grant 重绑定 | P0 | CLOSED | §8 新 grant + replaces_grant_id + 身份确认规则 |
| 6 | SSE/WebSocket 清理 | P0 | CLOSED | §9 WebSocket 完全删除 + stream_epoch + CSRF |
| 7 | 正式数据模型 | P0 | CLOSED | §3 node 表 + business_session 父表 + 完整 DDL |
| 8 | 离线评分单向流程 | P1 | CLOSED | §10 READY_TO_FINALIZE 阶段 + 纠错方式 |
| 9 | 备份恢复 | P1 | CLOSED | §11 VACUUM INTO + staging + hash 链 + 永久归档 |
| 10 | delivery_phase 枚举对齐 | P1 | CLOSED | §10.1 统一枚举 + OBSERVATION (非 OBSERVATION_REQUIRED) |
| 11 | 状态不变量 | P1 | CLOSED | §13 完整约束表 |
| 12 | REST API + 事件合同 | P1 | CLOSED | §12 完整端点表 + 事件类型表 |

### 14.2 PARTIAL 项（需后续补充）

| # | 领域 | 缺失内容 | 补充方式 |
|---|------|----------|----------|
| — | 多学校/多班级 | Phase 2 才实现，本文仅预留 organization/node | 单独 PRD |
| — | 学生可见性控制 | v1.1 中设计合理，本文继承不重复 | 继承 v1.1 §9 设计 |
| — | 训练/学习会话状态机 | 与 assessment 同构但未独立定义 | 后续文档补充 |

---

## 十五、自动化验收用例

### 15.1 JSONL–SQLite 恢复协议验收

| ID | 用例 | 前置条件 | 执行步骤 | 预期结果 |
|----|------|----------|----------|----------|
| R-01 | 正常写入完整路径 | 系统正常运行 | 提交命令 → 观察 JSONL + SQLite | JSONL 有 PREPARED + EVENTS + COMMITTED; SQLite batch_status = CONFIRMED |
| R-02 | Step 1 后崩溃恢复 | kill -9 在 fsync 后、APPLY 前 | 重启 → startupRecovery | 自动重放 batch; 最终 CONFIRMED |
| R-03 | Step 2 后崩溃恢复 | kill -9 在 COMMIT 后、CONFIRM 前 | 重启 → startupRecovery | 检测 APPLIED → 补写 COMMITTED; batch_status = CONFIRMED |
| R-04 | hash 不匹配检测 | 手动篡改 JSONL 中一行 | 重启 → startupRecovery | 进入 CORRUPTION_DETECTED; 不写 COMMITTED; 系统只读 |
| R-05 | 不完整尾部截断 | 写入半行后 kill -9 | 重启 → startupRecovery | 截断到最后完整 `\n`; 无数据损坏 |
| R-06 | 单写者互斥 | 并发发起两个命令 | 第二个等待第一个完成 | 不出现并发写入; batch_sequence 连续 |
| R-07 | 幂等投影 | 同一 batch 重放两次 | 手动调用 replayBatch 两次 | processed_event 防重; 业务表数据不变 |
| R-08 | COMMITTED 幂等追加 | 对已有 COMMITTED 的 batch 再次 append | 调用 appendCommittedMarkerIdempotent | 文件不变; 无重复行 |
| R-09 | 段 hash 链验证 | 篡改某归档段内容 | 运行 verifySegmentChain() | 返回 CHAIN_BROKEN 错误; 指出损坏段 |

### 15.2 command_log 联合恢复验收

| ID | 用例 | 前置条件 | 执行步骤 | 预期结果 |
|----|------|----------|----------|----------|
| C-01 | 正常幂等重放 | 命令已 SUCCEEDED | 重发相同 idempotency_key + 相同 payload | 200 + 原 result_json |
| C-02 | payload 冲突 | 命令已 SUCCEEDED | 重发相同 key + 不同 payload | 409 CONFLICT |
| C-03 | 租约获取 | 命令 PENDING | 执行获取租约 | status=PROCESSING; lease_generation++ |
| C-04 | 租约竞争 | 命令 PROCESSING + 租约有效 | 另一 worker 尝试获取 | changes()=0; 返回 202 |
| C-05 | 租约超时恢复 | 命令 PROCESSING + 租约过期 + batch 已 CONFIRMED | 新请求到达 | 标记 SUCCEEDED; 返回结果 |
| C-06 | 租约超时重新执行 | 命令 PROCESSING + 租约过期 + 无 batch | 新请求到达 | 重新执行命令 |
| C-07 | fencing token 拒绝旧执行者 | 旧 worker 持有过期 generation | 旧 worker 尝试提交结果 | changes()=0; 结果被丢弃 |
| C-08 | 最大重试上限 | attempt_count = max_attempts | 新请求到达 | 429 Too Many Requests |

### 15.3 安全事件双熔断验收

| ID | 用例 | 前置条件 | 执行步骤 | 预期结果 |
|----|------|----------|----------|----------|
| S-01 | 双熔断 | 学生有 ACTIVE assessment + ACTIVE training | POST /safety-incidents | 两个会话均 REDLINE_HALTED; binding 记录存在 |
| S-02 | 无会话熔断 | 学生无开放会话 | POST /safety-incidents | safety_incident 创建; 无 binding |
| S-03 | 事件走标准路径 | — | 检查 JSONL | SafetyIncidentCreated 事件在 JSONL 中存在 |
| S-04 | 核心事实冻结 | incident CONFIRMED | PATCH reason_code | 403 + core_facts_frozen |
| S-05 | REDLINE_HALTED 不可逆 | session REDLINE_HALTED | 尝试恢复到 ACTIVE | InvalidStateTransitionError |

### 15.4 HTTPS 信任方案验收

| ID | 用例 | 前置条件 | 执行步骤 | 预期结果 |
|----|------|----------|----------|----------|
| H-01 | CA + 叶子证书生成 | 首次启动 | 检查 certs 目录 | ca.key + ca.crt + server.key + server.crt 存在; 算法 ECDSA P-256 |
| H-02 | SAN 正确 | 证书已生成 | openssl x509 -text | 包含 DNS:localhost + DNS:<name>.local; 无通配符 |
| H-03 | IP 变化重签 | 修改网络 IP | 重启 Server | 新证书 SAN 含新 IP; CA 不变 |
| H-04 | 密钥保护 | Windows | 检查 ca.key 文件 | DPAPI 加密或受限 ACL |
| H-05 | 配对端点生命周期 | 触发配对 | 等待 5 分钟 | :7070 端口自动关闭 |
| H-06 | 无明文 HTTP 数据传输 | 抓包 | 检查除 :7070 外所有流量 | 全部 TLS 加密 |

### 15.5 Grant 重绑定验收

| ID | 用例 | 前置条件 | 执行步骤 | 预期结果 |
|----|------|----------|----------|----------|
| G-01 | 进程重启 rebind | 设备有 ACTIVE assignment | kill 进程 → 重启 → POST /reconnect | 旧 grant EXPIRED; 新 grant ACTIVE; GRANT_REBOUND 事件 |
| G-02 | 短暂断网不 rebind | 设备在线 | 断网 30s → 恢复 | 无新 runtime session; grant 不变 |
| G-03 | 身份重新确认 | 进程正常退出后重启 | rebind | identity_reconfirmation_required = true |
| G-04 | 快速恢复免确认 | 心跳超时 < 2 分钟内恢复 | rebind | identity_reconfirmation_required = false |
| G-05 | 无 assignment 时 reconnect | 设备无 active assignment | POST /reconnect | 返回"等待分配"; SSE 通知教师 |

### 15.6 SSE 与 CSRF 验收

| ID | 用例 | 前置条件 | 执行步骤 | 预期结果 |
|----|------|----------|----------|----------|
| E-01 | CSRF token 校验 | 教师已登录 | POST 写操作无 X-CSRF-Token | 403 CSRF_VALIDATION_FAILED |
| E-02 | Origin 校验 | 恶意 origin | 发送非法 Origin header | 403 ORIGIN_NOT_ALLOWED |
| E-03 | SSE stream_epoch resync | Server 重启 | 客户端 Last-Event-ID 含旧 epoch | 收到 resync_required 事件 |
| E-04 | SSE 补发 | 断线 5 秒 | 重连 Last-Event-ID | 补发缺失事件 |
| E-05 | Student 不使用 SSE | Student 尝试连接 /events/stream | GET 请求 | 403 或空频道 |
| E-06 | Main→Renderer 推送 | Server 发出通知 | 检查 Renderer 接收 | 通过 webContents.send 收到 |

### 15.7 离线评分与备份验收

| ID | 用例 | 前置条件 | 执行步骤 | 预期结果 |
|----|------|----------|----------|----------|
| F-01 | 评分→观察→完成 | 有观察模板 | finalize 评分 → finalize 观察 | OFFLINE_SCORING→OBSERVATION→READY_TO_FINALIZE→FINALIZED |
| F-02 | 评分→直接完成 | 无观察模板 | finalize 评分 | OFFLINE_SCORING→READY_TO_FINALIZE→FINALIZED |
| F-03 | FINALIZED 不可逆 | delivery_phase=FINALIZED | 尝试回退 | InvalidStateTransitionError |
| B-01 | 完整备份恢复 | 系统正常运行 | 备份 → 删除数据 → 恢复 | 数据完全一致 |
| B-02 | write barrier 覆盖 | 备份中有 in-flight batch | 等待 freeze | batch 完成后才开始备份 |
| B-03 | JSONL 严格截取 | — | 检查备份 JSONL 大小 | = cut_segment_byte_offset (精确) |
| B-04 | staging 校验失败回滚 | 篡改备份文件 | 尝试恢复 | integrity_check 失败; 恢复中止; 原数据不变 |

---

## 附录 A：目录结构

```
src/
├── main/              (瘦化：窗口 + utilityProcess 启动 + IPC Bridge)
│   ├── index.ts
│   ├── ipc-bridge.ts
│   ├── kiosk.ts
│   └── cert-manager.ts
├── server/            (Local Application Server，不 import electron)
│   ├── index.ts       (Fastify HTTPS + 生命周期)
│   ├── auth/          (Cookie, CSRF, device-credential)
│   ├── routes/        (REST 路由)
│   ├── realtime/      (SSE for teacher, MessagePort for student)
│   ├── domain/        (Command handlers, state machines)
│   ├── db/            (SQLite, schema, migrations)
│   ├── infra/         (EventWriter, Projector, BackupManager)
│   └── pairing/       (配对流程、challenge 管理)
├── renderer/          (Student Vue SPA)
├── teacher-web/       (Teacher Vue SPA，Server 静态托管)
├── preload/           (contextBridge 仅暴露 IPC API)
└── shared/            (共享类型)
```

---

## 附录 B：数据流图

### 学生答题流程

```
Student Renderer
  → contextBridge.invoke('cmd:submitAnswer', {...})
  → Electron Main (IPC Bridge)
  → MessagePortMain.postMessage → utilityProcess
  → Server: AuthGate.resolveCallerFromIPC(deviceSessionId)
  → Server: CommandBus.dispatch('SubmitAnswer', {...})
  → Domain: validate + score
  → Infra: EventWriter.writeBatch(...)  [§4.3 三阶段]
  → UPDATE command_log SET status='SUCCEEDED'
  → NotificationBus.emit
  → SSE → Teacher (if subscribed)
  → BrowserWindow.webContents.send → Student Renderer (result)
```

### 教师线下评分流程

```
Teacher Browser
  → fetch('POST /api/v1/assessments/:id/offline-scores/finalize', {...})
  → Server: Cookie + CSRF 验证
  → Server: CommandBus.dispatch('FinalizeOfflineScores', {...})
  → Domain: validate + calculate
  → Infra: EventWriter.writeBatch(...)
  → delivery_phase: OFFLINE_SCORING → OBSERVATION|READY_TO_FINALIZE
  → (if READY_TO_FINALIZE) → auto CalculateResult → FINALIZED
  → SSE → Teacher: finalization_complete
  → BrowserWindow.webContents.send → Student Renderer: session_completed
```

---

## 附录 C：历史文档废止清单

| 文档 | 版本 | 状态 | 说明 |
|------|------|------|------|
| architecture-review-plan-b-multi-device.md | v1.0 | SUPERSEDED | 初始审查报告 |
| architecture-review-plan-b-multi-device-v1.1.md | v1.1 | SUPERSEDED | 18 条交叉评审修订 |
| architecture-review-plan-b-multi-device-v1.2-consistency-closure.md | v1.2 | SUPERSEDED | 10 领域一致性补丁 |

**以上文档仅供历史追溯，不作为实施依据。所有实施工作以本文 v2.0 为唯一权威来源。**

---

*文档结束。*
