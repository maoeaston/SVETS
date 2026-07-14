> **⚠️ 文档状态：SUPERSEDED（已废止）**
> 本文档已被 `architecture-plan-b-multi-device-v2.2-authoritative-baseline.md`（v2.2 唯一权威基线）取代，不再作为实施依据。
> 实施人员只阅读：当前正式 Schema（`src/main/db/schema.sql`）+ 当前正式 PRD（`MVP_PRD_v1.0.9-*.md`）+ v2.2 三份工件。

# 方案 B 多设备架构 v2.1 — 唯一权威实施基线（已废止）

> **文档状态：** SUPERSEDED（原 AUTHORITATIVE BASELINE，已被 v2.2 取代）  
> **生效日期：** 2026-07-14  
> **正式 Schema 基线：** `src/main/db/schema.sql` v0.1.12-job-skill-assessment-mvp-closure  
> **正式 PRD 基线：** `doc/specs/MVP_PRD_v1.0.9-job-skill-assessment-mvp-closure.md`  
> **技术栈：** Electron 33+ / Vue 3 / TypeScript 5 / SQLite 3.45+ (WAL) / better-sqlite3  
> **范围：** 局域网多设备架构（学生触摸一体机 + 教师平板浏览器 + 未来学生自主 Web 门户）

## 废止声明

以下文档均为 **SUPERSEDED** 历史文档，不再作为实施依据：

- v1.0 方案 B 初稿
- architecture-review-plan-b-multi-device-v1.1.md
- architecture-review-plan-b-multi-device-v1.2-consistency-closure.md
- architecture-plan-b-multi-device-v2.0-authoritative-baseline.md
- architecture-plan-b-multi-device-v2.0.1-schema-alignment.md

**实施人员只需阅读本文 v2.1 + 正式 Schema (`src/main/db/schema.sql`) + 正式 PRD (`doc/specs/MVP_PRD_v1.0.9-job-skill-assessment-mvp-closure.md`)。**

---

## 目录

1. [拓扑与部署模式](#一拓扑与部署模式)
2. [进程与模块边界](#二进程与模块边界)
3. [身份与会话模型](#三身份与会话模型)
4. [Assessment、Training、Learning 三类业务会话](#四assessmenttraininglearning-三类业务会话)
5. [Assignment 与 Grant](#五assignment-与-grant)
6. [对正式 Schema 的完整增量设计](#六对正式-schema-的完整增量设计)
7. [delivery_phase 完整状态机](#七delivery_phase-完整状态机)
8. [JSONL–SQLite 事件溯源与恢复协议](#八jsonlsqlite-事件溯源与恢复协议)
9. [command_log 与 fencing](#九command_log-与-fencing)
10. [安全事件](#十安全事件)
11. [REST、SSE 与 IPC](#十一restsse-与-ipc)
12. [Web 安全](#十二web-安全)
13. [HTTPS、证书与配对](#十三https证书与配对)
14. [学生可见性和发布控制](#十四学生可见性和发布控制)
15. [视频和学习资源服务](#十五视频和学习资源服务)
16. [Finalization、纠错和报告版本](#十六finalization纠错和报告版本)
17. [备份恢复](#十七备份恢复)
18. [闭环验收矩阵](#十八闭环验收矩阵)

---

## 一、拓扑与部署模式

### 1.1 完整拓扑图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│          Local Application Server (Electron utilityProcess)                    │
│                                                                               │
│  ┌──────────────────┐  ┌───────────────┐  ┌───────────────────────────────┐ │
│  │ HTTPS + SSE      │  │ Command Bus   │  │ Event Store                   │ │
│  │ (Fastify)        │──│ + Auth Gate   │──│ JSONL (领域事实来源)           │ │
│  │ Port :7443       │  │ + CSRF Guard  │  │ + SQLite Projector            │ │
│  └────────┬─────────┘  └───────────────┘  └───────────────────────────────┘ │
│           │                   ▲                                               │
│           │                   │ MessagePortMain                               │
└───────────┼───────────────────┼───────────────────────────────────────────────┘
            │                   │
      ┌─────┴──────┐     ┌─────┴───────────────────────────────┐
      │  Teacher   │     │  Electron Main Process                │
      │  Tablet    │     │  ┌─────────────────────────────────┐ │
      │  Browser   │     │  │ Window Manager + Kiosk           │ │
      │  (HTTPS)   │     │  │ Cert Manager (Node CA)           │ │
      └────────────┘     │  │ mDNS Advertiser                  │ │
                          │  │ utilityProcess Lifecycle          │ │
      ┌────────────┐     │  └──────────────┬──────────────────┘ │
      │  Future    │     │                 │ IPC (contextBridge) │
      │  Student   │     │  ┌──────────────┴──────────────────┐ │
      │  Web Portal│     │  │ Student Renderer                 │ │
      │  (HTTPS)   │     │  │ (Vue 3 SPA, Kiosk mode)          │ │
      └────────────┘     │  └─────────────────────────────────┘ │
                          └─────────────────────────────────────────┘
```

### 1.2 客户端类型与通信边界

| 客户端 | 运行环境 | 通信方式 | 认证方式 |
|--------|----------|----------|----------|
| **学生 Kiosk Renderer** | Electron BrowserWindow | IPC / MessagePort（不使用网络 SSE） | contextBridge 凭证传递 |
| **教师 Web** | 平板浏览器 | HTTPS REST + SSE | HttpOnly Cookie |
| **未来学生自主 Web 门户** | 学生自有设备浏览器 | HTTPS REST + SSE | HttpOnly Cookie（独立频道白名单） |

### 1.3 部署组件

| 组件 | 存储位置 | 职责 |
|------|----------|------|
| SQLite DB | `{userData}/data/xc-career-guide.db` | 领域投影 + 运维状态 |
| action_log.jsonl | `{userData}/data/action_log.jsonl` | 领域事实唯一来源 |
| JSONL 归档段 | `{userData}/data/segments/` | 已轮转的历史事件段 |
| segment_index.json | `{userData}/data/segment_index.json` | 段元数据索引 |
| Asset Storage | `{userData}/assets/` | 视频、图片、音频等大型二进制资源 |
| Node CA + Leaf Cert | `{userData}/certs/` | ECDSA P-256 自签名 CA + 服务端叶子证书 |
| Node Config | `{userData}/config/node.json` | 节点标识、组织绑定、mDNS 配置 |
| Teacher Static SPA | bundled in app | 教师 Web 界面静态文件 |

### 1.4 mDNS 服务发现

- 服务类型：`_xccareer._tcp.local`
- 实例名：`{node_name}._xccareer._tcp.local`
- TXT 记录：`port=7443`, `fingerprint={ca_fingerprint_short}`, `version={app_version}`
- 教师平板通过 mDNS 自动发现局域网内的学生一体机

### 1.5 演进路径

```
Phase 1 (当前): utilityProcess 内嵌于 Electron，单节点
Phase 2 (学校服务器): 抽出为独立 Node 服务，多节点同步
Phase 3 (中央平台): Node 服务 + PostgreSQL + 云部署，跨校区数据汇聚
```

---

## 二、进程与模块边界

### 2.1 四进程架构

| 进程 | 运行位置 | 职责 | 约束 |
|------|----------|------|------|
| **Electron Main** | 主进程 | 窗口管理、Kiosk 强制、utilityProcess 生命周期、证书管理、mDNS 广播 | 不承载业务领域逻辑 |
| **Local Application Server** | utilityProcess | HTTPS 监听、认证、Command Bus、Domain Layer、SQLite、JSONL、资源服务 | 不 import Electron API |
| **Student Renderer** | BrowserWindow | Vue SPA 学生界面 | 不直接访问 SQLite，不连接网络端口 |
| **Teacher Web** | 教师平板浏览器 | 独立 Vue SPA（Server 静态托管） | 仅通过 HTTPS REST + SSE 通信 |

### 2.2 通信路径

```
Student Renderer ──contextBridge IPC──▶ Electron Main ──MessagePortMain──▶ Local Server
Teacher Browser  ──HTTPS REST + SSE──▶ Local Server (Fastify :7443)
Electron Main   ──BrowserWindow.webContents.send()──▶ Student Renderer
```

**严格约束：**
- Student Renderer 通过 `contextBridge` 暴露的 IPC API（`ipcRenderer.invoke`）与 Main 通信
- Main 通过 `MessagePortMain`（utilityProcess 创建时传入）转发给 Server
- Main 通过 `BrowserWindow.webContents.send()` 向 Student Renderer 推送事件（不使用 SSE / WebSocket）
- Teacher 通过 Cookie 认证的 HTTPS REST + SSE 与 Server 通信
- Student Renderer 禁止直接连接 HTTPS 端口
- 不使用 WebSocket

### 2.3 模块边界规则

1. **Electron Main 不承载业务领域逻辑**：Main 只负责窗口、Kiosk、进程生命周期和系统能力
2. **Local Server 不 import Electron API**：Server 是纯 Node.js 进程，未来可独立部署
3. **Renderer 不直接访问 SQLite**：所有数据通过 IPC Handler 获取
4. **HTTP 和 IPC 汇入同一 Application Service / Command Bus**：教师 HTTP 请求和学生 IPC 请求统一进入 Command Bus
5. **唯一 SQLite 写入口**：只有 Local Server 内的 Event Writer + Projector 写 SQLite
6. **Event Writer 单写者**：任何时刻最多一个 in-flight batch
7. **native addon 打包约束**：`src/main/` 内引用本仓库模块必须使用静态 `import`，不用 `createRequire` 或动态路径

### 2.4 utilityProcess 选择理由

| 方案 | 结论 | 理由 |
|------|------|------|
| 同进程 | ❌ | Main 崩溃 = 全崩；同步 DB 调用阻塞事件循环 |
| Worker Thread | ⚠️ | better-sqlite3 在 Electron 打包中 native addon 加载不稳定 |
| **utilityProcess** | ✅ | 崩溃隔离、独立 V8、native addon 正常加载、Main 可自动重启 |
| 独立 Node 子进程 | Phase 2 | 需打包 Node runtime，体积大 |

### 2.5 utilityProcess 崩溃与重启

1. Main 监听 utilityProcess `exit` 事件
2. 如果非正常退出（code ≠ 0）：等待 2 秒后重启
3. 重启后 Server 执行 `startupRecovery()`（见 §8.7）
4. 重启期间 Student Renderer 显示 "系统恢复中" 蒙层
5. 连续 3 次崩溃（5 分钟内）：进入安全模式，仅允许数据导出

---

## 三、身份与会话模型

### 3.1 实体层级关系

```
organization (学校/中心)
  └── node (一体机节点/服务器节点)
       └── device (物理设备)
            └── device_runtime_session (设备运行实例)
                 └── auth_session (用户认证会话)
                      └── delegated_access_grant (教师代理授权)
                           └── business_session (业务会话容器)
                                ├── assessment_session (测评)
                                ├── training_session (训练)
                                └── learning_session (学习)
                                     └── business_session_assignment (设备分配)
```

### 3.2 organization

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| organization_id | TEXT | PK | 组织唯一标识 |
| name | TEXT | NOT NULL | 组织名称 |
| type | TEXT | NOT NULL, CHECK IN ('SCHOOL','CENTER','DISTRICT') | 组织类型 |
| status | TEXT | NOT NULL, DEFAULT 'ACTIVE' | 组织状态 |
| created_at | TEXT | NOT NULL, DEFAULT datetime('now') | 创建时间 |

Phase 1 默认单组织；Phase 2 支持多组织。

### 3.3 node

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| node_id | TEXT | PK | 节点唯一标识 |
| organization_id | TEXT | NOT NULL, FK → organization | 所属组织 |
| node_name | TEXT | NOT NULL | 节点名称（mDNS 实例名来源） |
| node_type | TEXT | NOT NULL, DEFAULT 'ELECTRON_KIOSK', CHECK IN ('ELECTRON_KIOSK','STANDALONE_SERVER','CLOUD') | 节点类型 |
| installed_at | TEXT | NOT NULL, DEFAULT datetime('now') | 安装时间 |
| app_version | TEXT | | 应用版本 |
| schema_version | TEXT | | Schema 版本 |
| status | TEXT | NOT NULL, DEFAULT 'ACTIVE', CHECK IN ('ACTIVE','DISABLED','DECOMMISSIONED') | 节点状态 |
| created_at | TEXT | NOT NULL, DEFAULT datetime('now') | 创建时间 |
| updated_at | TEXT | NOT NULL, DEFAULT datetime('now') | 更新时间 |

### 3.4 device

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| device_id | TEXT | PK | 设备唯一标识 |
| node_id | TEXT | NOT NULL, FK → node | 所属节点 |
| device_name | TEXT | NOT NULL | 设备名称 |
| device_role | TEXT | NOT NULL, CHECK IN ('STUDENT_WORKSTATION','TEACHER_TABLET','ADMIN_TERMINAL','HYBRID') | 设备角色 |
| credential_hash | TEXT | | 设备凭证哈希（用于设备级认证） |
| trust_state | TEXT | NOT NULL, DEFAULT 'PENDING', CHECK IN ('PENDING','TRUSTED','REVOKED') | 信任状态 |
| is_kiosk_enabled | INTEGER | NOT NULL, DEFAULT 0, CHECK IN (0,1) | 是否启用 Kiosk 模式 |
| allows_self_login | INTEGER | NOT NULL, DEFAULT 1, CHECK IN (0,1) | 是否允许自主登录 |
| capabilities_json | TEXT | CHECK json_valid | 设备能力声明 |
| last_heartbeat_at | TEXT | | 最后心跳时间 |
| status | TEXT | NOT NULL, DEFAULT 'ACTIVE', CHECK IN ('ACTIVE','DISABLED','DECOMMISSIONED') | 设备状态 |
| created_at | TEXT | NOT NULL, DEFAULT datetime('now') | 创建时间 |
| updated_at | TEXT | NOT NULL, DEFAULT datetime('now') | 更新时间 |

**信任状态机：** `PENDING → TRUSTED → REVOKED`

### 3.5 device_runtime_session

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| device_runtime_session_id | TEXT | PK | 运行实例唯一标识 |
| device_id | TEXT | NOT NULL, FK → device | 所属设备 |
| started_at | TEXT | NOT NULL, DEFAULT datetime('now') | 启动时间 |
| last_heartbeat_at | TEXT | NOT NULL, DEFAULT datetime('now') | 最后心跳 |
| ended_at | TEXT | | 结束时间 |
| end_reason | TEXT | CHECK IN (NULL,'HEARTBEAT_TIMEOUT','GRACEFUL_SHUTDOWN','ADMIN_TERMINATED','REPLACED') | 结束原因 |
| client_version | TEXT | | 客户端版本 |
| status | TEXT | NOT NULL, DEFAULT 'ACTIVE', CHECK IN ('ACTIVE','ENDED') | 状态 |
| created_at | TEXT | NOT NULL, DEFAULT datetime('now') | 创建时间 |

**关键规则：**
- 每台设备最多一个 ACTIVE runtime session（通过唯一索引约束）
- 短暂断网（< 2 分钟心跳超时）不创建新 runtime session
- 新 runtime session 仅在以下情况创建：进程重启、设备重启、教师显式结束、设备替换

### 3.6 user_account（已存在于 v0.1.12，不修改）

保留原表结构。角色：STUDENT / TEACHER / ADMIN。

### 3.7 student_profile（已存在于 v0.1.12）

保留原表结构。新增一列用于可选关联用户账号：

```sql
ALTER TABLE student_profile ADD COLUMN user_id TEXT
  REFERENCES user_account(user_id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_student_profile_user_id
  ON student_profile(user_id) WHERE user_id IS NOT NULL;
```

**身份统一规则：**
- 所有业务聚合（assessment_session, training_session, safety_incident 等）使用 `student_id` FK → `student_profile`
- 登录认证使用 `user_id` FK → `user_account`
- `student_profile.user_id` 可选关联，允许无账号的学生档案存在（教师代为建档场景）
- 禁止使用 student + user 拼接标识符（如旧文档中的混合 FK）
- 多设备新增表统一 FK 到 `student_profile(student_id)`

### 3.8 auth_session

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| auth_session_id | TEXT | PK | 认证会话标识 |
| user_id | TEXT | NOT NULL, FK → user_account | 用户标识 |
| device_runtime_session_id | TEXT | FK → device_runtime_session | 设备运行实例（教师平板可为 NULL） |
| auth_method | TEXT | NOT NULL, CHECK IN ('PASSWORD','DELEGATED','PIN','DEVICE_KEY') | 认证方式 |
| granted_by | TEXT | FK → user_account | 授权人（DELEGATED 方式时填写） |
| capabilities_json | TEXT | NOT NULL, DEFAULT '[]', CHECK json_valid | 权限能力列表 |
| token_hash | TEXT | NOT NULL, UNIQUE | 会话令牌哈希 |
| refresh_token_hash | TEXT | UNIQUE | 刷新令牌哈希 |
| issued_at | TEXT | NOT NULL, DEFAULT datetime('now') | 签发时间 |
| expires_at | TEXT | NOT NULL | 过期时间 |
| last_activity_at | TEXT | NOT NULL, DEFAULT datetime('now') | 最后活动时间 |
| status | TEXT | NOT NULL, DEFAULT 'ACTIVE', CHECK IN ('ACTIVE','EXPIRED','REVOKED') | 状态 |
| revoke_reason | TEXT | | 撤销原因 |
| created_at | TEXT | NOT NULL, DEFAULT datetime('now') | 创建时间 |
| updated_at | TEXT | NOT NULL, DEFAULT datetime('now') | 更新时间 |

**状态机：** `ACTIVE → EXPIRED | REVOKED`

### 3.9 delegated_access_grant

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| grant_id | TEXT | PK | 授权标识 |
| teacher_auth_session_id | TEXT | NOT NULL, FK → auth_session | 教师会话 |
| teacher_user_id | TEXT | NOT NULL, FK → user_account | 教师用户 |
| student_id | TEXT | NOT NULL, FK → student_profile | 被授权学生 |
| device_id | TEXT | NOT NULL, FK → device | 目标设备 |
| device_runtime_session_id | TEXT | NOT NULL, FK → device_runtime_session | 设备运行实例 |
| capabilities_json | TEXT | NOT NULL, CHECK json_valid | 授予的能力 |
| identity_confirmation_method | TEXT | CHECK IN (NULL,'PIN','TEACHER_ATTESTATION','PHOTO_MATCH','NONE_REQUIRED') | 身份确认方式 |
| confirmed_by | TEXT | FK → user_account | 确认人 |
| confirmation_evidence | TEXT | CHECK json_valid | 确认证据 JSON |
| student_pin_verified | INTEGER | DEFAULT 0, CHECK IN (0,1) | PIN 已验证 |
| teacher_attested | INTEGER | DEFAULT 0, CHECK IN (0,1) | 教师已证实 |
| confirmed_at | TEXT | | 确认时间 |
| status | TEXT | NOT NULL, DEFAULT 'ACTIVE', CHECK IN ('ACTIVE','RELEASED','EXPIRED','REVOKED') | 状态 |
| replaces_grant_id | TEXT | FK → delegated_access_grant | 替换的旧授权 |
| granted_at | TEXT | NOT NULL, DEFAULT datetime('now') | 授权时间 |
| released_at | TEXT | | 释放时间 |
| release_reason | TEXT | | 释放原因 |
| expires_at | TEXT | NOT NULL | 过期时间 |
| created_at | TEXT | NOT NULL, DEFAULT datetime('now') | 创建时间 |
| updated_at | TEXT | NOT NULL, DEFAULT datetime('now') | 更新时间 |

**状态机：** `ACTIVE → RELEASED | EXPIRED | REVOKED`

**关键约束：**
- 一个学生在一台设备上最多一个 ACTIVE grant（唯一索引）
- Grant 按业务会话授予，不是长期授权
- 设备重启后旧 Grant 过期，创建新 Grant（通过 replaces_grant_id 链接）

---

## 四、Assessment、Training、Learning 三类业务会话

### 4.1 business_session（业务会话容器）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| business_session_id | TEXT | PK | 业务会话标识 |
| session_type | TEXT | NOT NULL, CHECK IN ('ASSESSMENT','TRAINING','LEARNING') | 会话类型 |
| student_id | TEXT | NOT NULL, FK → student_profile | 学生标识 |
| created_by | TEXT | NOT NULL, FK → user_account | 创建者 |
| created_at | TEXT | NOT NULL, DEFAULT datetime('now') | 创建时间 |
| updated_at | TEXT | NOT NULL, DEFAULT datetime('now') | 更新时间 |

**无 status 列。** 业务会话的权威状态位于子表：
- ASSESSMENT → `assessment_session.status`
- TRAINING → `training_session.status`
- LEARNING → `learning_session.status`

查询业务会话状态使用 JOIN：
```sql
SELECT bs.business_session_id, bs.session_type,
  COALESCE(a.status, t.status, l.status) AS derived_status
FROM business_session bs
LEFT JOIN assessment_session a ON a.session_id = bs.business_session_id
LEFT JOIN training_session t ON t.training_session_id = bs.business_session_id
LEFT JOIN learning_session l ON l.learning_session_id = bs.business_session_id
WHERE bs.student_id = ?;
```

### 4.2 assessment_session（已存在于 v0.1.12，增量扩展）

保留 v0.1.12 全部 30+ 字段、所有索引和所有触发器不修改。新增字段见 §6。

**状态机（v0.1.12 权威）：**
```
开放态: INIT → ACTIVE → EMOTION_INTERRUPTED → ACTIVE (恢复)
                     → SUSPENDED_REVIEW_REQUIRED → ACTIVE (恢复)
                     → OFFLINE_PENDING (线上完成)
终态: COMPLETED | ABORTED | REDLINE_HALTED
```
- 终态不可转出（触发器 `trg_assessment_session_no_terminal_status_change` 强制）
- 红线可从任一开放态进入 REDLINE_HALTED（触发器 `trg_assessment_session_explicit_redline_paths`）
- REDLINE_HALTED 要求 `level_result = 'LEVEL_FAIL_BY_SAFETY'`（触发器强制）

### 4.3 training_session（已存在于 v0.1.12，不修改）

保留 v0.1.12 全部字段、索引和触发器。

**状态机（v0.1.12 权威）：**
```
开放态: INIT → ACTIVE → EMOTION_INTERRUPTED → ACTIVE
                     → SUSPENDED_REVIEW_REQUIRED → ACTIVE
终态: COMPLETED | ABORTED | REDLINE_HALTED
```
- 终态保护触发器 `trg_training_session_no_terminal_status_change`
- 红线路径触发器 `trg_training_session_explicit_redline_paths`

### 4.4 learning_session（新增）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| learning_session_id | TEXT | PK | 学习会话标识（与 business_session_id 相同） |
| business_session_id | TEXT | NOT NULL, UNIQUE, FK → business_session | 父业务会话 |
| student_id | TEXT | NOT NULL, FK → student_profile | 学生标识 |
| job_code | TEXT | NOT NULL | 岗位代码 |
| task_code | TEXT | NOT NULL | 任务代码 |
| learning_type | TEXT | NOT NULL, CHECK IN ('VIDEO_COURSE','MATERIAL_READING','MIXED') | 学习类型 |
| status | TEXT | NOT NULL, DEFAULT 'INIT', CHECK IN ('INIT','ACTIVE','PAUSED','COMPLETED','ABANDONED') | 状态 |
| total_item_count | INTEGER | NOT NULL, DEFAULT 0, CHECK (>= 0) | 总学习项数 |
| completed_item_count | INTEGER | NOT NULL, DEFAULT 0, CHECK (>= 0) | 已完成项数 |
| total_duration_sec | INTEGER | NOT NULL, DEFAULT 0, CHECK (>= 0) | 累计学习时长(秒) |
| last_item_id | TEXT | | 最后学习的项目标识 |
| last_position_sec | INTEGER | CHECK (IS NULL OR >= 0) | 最后播放位置(秒) |
| started_at | TEXT | | 开始时间 |
| completed_at | TEXT | | 完成时间 |
| created_by | TEXT | NOT NULL, FK → user_account | 创建者 |
| created_at | TEXT | NOT NULL, DEFAULT datetime('now') | 创建时间 |
| updated_at | TEXT | NOT NULL, DEFAULT datetime('now') | 更新时间 |

**状态机：**
```
INIT → ACTIVE → PAUSED → ACTIVE (恢复)
                       → COMPLETED
             → COMPLETED
             → ABANDONED
```
- COMPLETED 和 ABANDONED 为终态
- 无安全红线影响（学习会话不涉及评分和操作安全）

**学习进度表 learning_progress（新增）：**

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| progress_id | TEXT | PK | 进度记录标识 |
| learning_session_id | TEXT | NOT NULL, FK → learning_session | 所属学习会话 |
| item_type | TEXT | NOT NULL, CHECK IN ('VIDEO','DOCUMENT','INTERACTIVE') | 项目类型 |
| item_id | TEXT | NOT NULL | 项目标识（关联 asset_resource） |
| item_order | INTEGER | NOT NULL, CHECK (>= 1) | 项目顺序 |
| status | TEXT | NOT NULL, DEFAULT 'NOT_STARTED', CHECK IN ('NOT_STARTED','IN_PROGRESS','COMPLETED','SKIPPED') | 项目状态 |
| duration_sec | INTEGER | NOT NULL, DEFAULT 0, CHECK (>= 0) | 学习时长 |
| position_sec | INTEGER | CHECK (IS NULL OR >= 0) | 当前播放位置 |
| completed_at | TEXT | | 完成时间 |
| created_at | TEXT | NOT NULL, DEFAULT datetime('now') | 创建时间 |
| updated_at | TEXT | NOT NULL, DEFAULT datetime('now') | 更新时间 |

**约束：** UNIQUE (learning_session_id, item_order)

### 4.5 三类会话与安全事件的关系

| 会话类型 | 安全事件影响 | 红线终态 | 安全结果 |
|----------|-------------|----------|----------|
| assessment_session | 批量 halt 所有开放会话 | REDLINE_HALTED | LEVEL_FAIL_BY_SAFETY |
| training_session | 批量 halt 所有开放会话 | REDLINE_HALTED | 不生成训练结果 |
| learning_session | 不受影响 | 无 | 无 |

安全事件绑定范围：同一 `student_id` + `job_code` + `task_code` 下的所有开放 assessment 和 training 会话。

### 4.6 唯一权威状态位置

| 状态 | 权威位置 | 查询路径 |
|------|----------|----------|
| assessment 业务状态 | `assessment_session.status` | 直接查询 |
| assessment 交互阶段 | `assessment_session.delivery_phase` | 直接查询（辅助投影） |
| training 业务状态 | `training_session.status` | 直接查询 |
| learning 业务状态 | `learning_session.status` | 直接查询 |
| 设备在线状态 | 内存（心跳计时器） | 不持久化，仅运行时 |

---

## 五、Assignment 与 Grant

### 5.1 business_session_assignment

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| assignment_id | TEXT | PK | 分配标识 |
| business_session_id | TEXT | NOT NULL, FK → business_session | 业务会话 |
| student_id | TEXT | NOT NULL, FK → student_profile | 学生标识 |
| device_id | TEXT | NOT NULL, FK → device | 目标设备 |
| grant_id | TEXT | NOT NULL, FK → delegated_access_grant | 关联授权 |
| assigned_by | TEXT | NOT NULL, FK → user_account | 分配人 |
| assigned_at | TEXT | NOT NULL, DEFAULT datetime('now') | 分配时间 |
| student_confirmed_at | TEXT | | 学生确认时间 |
| released_at | TEXT | | 释放时间 |
| release_reason | TEXT | CHECK IN (NULL,'COMPLETED','TEACHER_RELEASED','DEVICE_OFFLINE','REPLACED','ADMIN_REVOKED') | 释放原因 |
| replaces_assignment_id | TEXT | FK → business_session_assignment | 替换的旧分配 |
| version | INTEGER | NOT NULL, DEFAULT 1 | 乐观锁版本 |
| status | TEXT | NOT NULL, DEFAULT 'PENDING_CONFIRM', CHECK IN ('PENDING_CONFIRM','ACTIVE','RELEASED','VOID') | 状态 |
| created_at | TEXT | NOT NULL, DEFAULT datetime('now') | 创建时间 |
| updated_at | TEXT | NOT NULL, DEFAULT datetime('now') | 更新时间 |

**状态机：** `PENDING_CONFIRM → ACTIVE → RELEASED | VOID`

### 5.2 FK 方向：单向（Assignment → Grant）

- `business_session_assignment.grant_id` FK → `delegated_access_grant.grant_id`
- Grant 不反向引用 Assignment
- 一个 Grant 可对应多个 Assignment（例如设备重启后重建 Assignment，Grant 替换为新 Grant）
- INSERT 顺序：先创建 Grant，再创建 Assignment

### 5.3 Grant 语义

| 属性 | 决策 |
|------|------|
| 授权粒度 | 按业务会话授予（非长期设备授权） |
| capabilities | 按会话类型授予（ASSESS/TRAIN/LEARN） |
| 身份确认 | 首次分配必须确认；crash restart < 2分钟可复用确认 |
| Grant 撤销影响 | 所有关联 ACTIVE Assignment 变为 VOID |
| 设备重启 | 旧 Grant → EXPIRED，创建新 Grant（replaces_grant_id 链接） |
| Assignment 完成 | Grant → RELEASED |
| 过期 | 默认 4 小时过期，教师可提前释放 |

### 5.4 一致性约束

| 约束 | 实施层 |
|------|--------|
| `assignment.student_id = grant.student_id` | App + CHECK |
| `assignment.device_id = grant.device_id` | App + CHECK |
| 一个业务会话最多一个 ACTIVE/PENDING_CONFIRM Assignment | 唯一索引 |
| 一台设备最多一个 ACTIVE/PENDING_CONFIRM Assignment | 唯一索引 |
| 一个学生+设备最多一个 ACTIVE Grant | 唯一索引 |
| Grant ACTIVE iff 存在非终态 Assignment 引用它 | App 层事务保证 |

```sql
CREATE UNIQUE INDEX ux_assignment_one_active_per_session
  ON business_session_assignment(business_session_id)
  WHERE status IN ('PENDING_CONFIRM', 'ACTIVE');

CREATE UNIQUE INDEX ux_assignment_one_active_per_device
  ON business_session_assignment(device_id)
  WHERE status IN ('PENDING_CONFIRM', 'ACTIVE');

CREATE UNIQUE INDEX ux_grant_one_active_per_student_device
  ON delegated_access_grant(student_id, device_id) WHERE status = 'ACTIVE';
```

### 5.5 Grant Rebind 协议（设备重启/断网恢复）

1. 设备发送 reconnect POST：携带新 `device_runtime_session_id` + 已知 `assignment_id`
2. Server 查找 ACTIVE assignment：
   - 找到 → 检查关联 Grant 的 `device_runtime_session_id` 是否匹配
   - 不匹配 → 旧 Grant 标记 EXPIRED，创建新 Grant（`replaces_grant_id` = 旧 grant_id）
3. 判断是否需要身份重新确认：
   - crash restart < 2 分钟 → 无需重新确认（`identity_confirmation_method = 'NONE_REQUIRED'`）
   - graceful shutdown / reboot / replacement → 需要重新确认
4. 发射 `GRANT_REBOUND` 事件；通过 SSE 通知教师

### 5.6 身份确认记录

每个 Grant 携带完整身份确认审计字段：
- `identity_confirmation_method`：PIN / TEACHER_ATTESTATION / PHOTO_MATCH / NONE_REQUIRED
- `confirmed_by`：确认人 user_id
- `confirmation_evidence`：JSON 证据（PIN hash / 照片对比结果 / 证实声明）
- `student_pin_verified`：PIN 是否通过
- `teacher_attested`：教师是否证实
- `confirmed_at`：确认时间

---

## 六、对正式 Schema 的完整增量设计

### 6.1 正式 Schema 中保留的表和字段（不修改）

以下表保持 v0.1.12 原样，包括所有列、索引和触发器：

| 表名 | 行范围 | 触发器数 |
|------|--------|---------|
| schema_migration | 45-70 | 0 |
| user_account | 76-90 | 0 |
| student_profile | 91-105 | 0 |
| strategy_config | 111-152 | 1 (版本冻结) |
| asset_resource | 154-185 | 0 |
| question_bank | 187-260 | 2 (语义冻结) |
| domain_event_projection | 262-298 | 0 |
| assessment_session | 305-395 | 8 (终态保护 + 策略一致性 + 红线路径) |
| assessment_session_question | 397-445 | 2 (INSERT 验证) |
| answer_record | 447-490 | 1 (跨表验证) |
| offline_score_record | 492-560 | 0 |
| training_session | 562-637 | 6 (终态保护 + 策略一致性 + 红线路径) |
| training_step_record | 639-673 | 0 |
| safety_incident | 675-737 | 10 (生命周期 + 核心事实冻结 + 批量 halt) |
| safety_incident_binding | 748-773 | 0 |
| result_record | 780-862 | 4 (安全覆盖 + 红线来源守卫) |
| task_report | 868-902 | 4 (安全终止报告 + 导出审核守卫) |
| snapshot_meta | 904-930 | 0 |
| error_code_registry | 932-950 | 0 |
| error_event_log | 952-997 | 0 |

**总计：48 个触发器全部保留，不修改。**

### 6.2 现有表需要新增的列

```sql
-- 1. student_profile: 可选关联用户账号
ALTER TABLE student_profile ADD COLUMN user_id TEXT
  REFERENCES user_account(user_id) ON DELETE SET NULL;

-- 2. assessment_session: 多设备交互阶段投影
ALTER TABLE assessment_session ADD COLUMN delivery_phase TEXT DEFAULT 'PREPARED'
  CHECK (delivery_phase IS NULL OR delivery_phase IN (
    'PREPARED','ASSIGNED','STUDENT_CONFIRMED','ONLINE_IN_PROGRESS',
    'ONLINE_COMPLETED','OFFLINE_SCORING','OBSERVATION',
    'READY_TO_FINALIZE','FINALIZED'));

-- 3. assessment_session: 乐观锁版本
ALTER TABLE assessment_session ADD COLUMN event_sequence_version INTEGER DEFAULT 0
  CHECK (event_sequence_version IS NULL OR event_sequence_version >= 0);

-- 4. assessment_session: 观察模板引用
ALTER TABLE assessment_session ADD COLUMN observation_template_id TEXT;

-- 5. safety_incident: 来源设备追踪
ALTER TABLE safety_incident ADD COLUMN source_device_id TEXT REFERENCES device(device_id);
ALTER TABLE safety_incident ADD COLUMN source_node_id TEXT REFERENCES node(node_id);
ALTER TABLE safety_incident ADD COLUMN command_id TEXT;

-- 6. result_record: 发布控制（§14.2）
ALTER TABLE result_record ADD COLUMN publication_status TEXT
  NOT NULL DEFAULT 'DRAFT'
  CHECK (publication_status IN ('DRAFT','PUBLISHED','WITHDRAWN'));
ALTER TABLE result_record ADD COLUMN student_visible INTEGER
  NOT NULL DEFAULT 0 CHECK (student_visible IN (0,1));
ALTER TABLE result_record ADD COLUMN published_at TEXT;
ALTER TABLE result_record ADD COLUMN published_by TEXT REFERENCES user_account(user_id);

-- 7. task_report: 可见性范围（§14.4）
ALTER TABLE task_report ADD COLUMN visibility_scope TEXT
  NOT NULL DEFAULT 'TEACHER_ONLY'
  CHECK (visibility_scope IN ('TEACHER_ONLY','STUDENT_VISIBLE','PUBLIC'));
```

### 6.3 所有新增表的完整 DDL

```sql
-- ============================================================
-- 多设备架构新增表 DDL (v2.1)
-- 迁移基线: schema v0.1.12-job-skill-assessment-mvp-closure
-- ============================================================

-- T1: organization
CREATE TABLE IF NOT EXISTS organization (
  organization_id    TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  type               TEXT NOT NULL DEFAULT 'SCHOOL'
                      CHECK (type IN ('SCHOOL','CENTER','DISTRICT')),
  status             TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO organization (organization_id, name)
  VALUES ('org_default', '默认学校');

-- T2: node
CREATE TABLE IF NOT EXISTS node (
  node_id            TEXT PRIMARY KEY,
  organization_id    TEXT NOT NULL REFERENCES organization(organization_id),
  node_name          TEXT NOT NULL,
  node_type          TEXT NOT NULL DEFAULT 'ELECTRON_KIOSK'
                      CHECK (node_type IN ('ELECTRON_KIOSK','STANDALONE_SERVER','CLOUD')),
  installed_at       TEXT NOT NULL DEFAULT (datetime('now')),
  app_version        TEXT,
  schema_version     TEXT,
  status             TEXT NOT NULL DEFAULT 'ACTIVE'
                      CHECK (status IN ('ACTIVE','DISABLED','DECOMMISSIONED')),
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

-- T3: device
CREATE TABLE IF NOT EXISTS device (
  device_id          TEXT PRIMARY KEY,
  node_id            TEXT NOT NULL REFERENCES node(node_id),
  device_name        TEXT NOT NULL,
  device_role        TEXT NOT NULL
                      CHECK (device_role IN ('STUDENT_WORKSTATION','TEACHER_TABLET',
                                             'ADMIN_TERMINAL','HYBRID')),
  credential_hash    TEXT,
  trust_state        TEXT NOT NULL DEFAULT 'PENDING'
                      CHECK (trust_state IN ('PENDING','TRUSTED','REVOKED')),
  is_kiosk_enabled   INTEGER NOT NULL DEFAULT 0 CHECK (is_kiosk_enabled IN (0,1)),
  allows_self_login  INTEGER NOT NULL DEFAULT 1 CHECK (allows_self_login IN (0,1)),
  capabilities_json  TEXT CHECK (capabilities_json IS NULL OR json_valid(capabilities_json)),
  last_heartbeat_at  TEXT,
  status             TEXT NOT NULL DEFAULT 'ACTIVE'
                      CHECK (status IN ('ACTIVE','DISABLED','DECOMMISSIONED')),
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

-- T4: device_runtime_session
CREATE TABLE IF NOT EXISTS device_runtime_session (
  device_runtime_session_id TEXT PRIMARY KEY,
  device_id                 TEXT NOT NULL REFERENCES device(device_id),
  started_at                TEXT NOT NULL DEFAULT (datetime('now')),
  last_heartbeat_at         TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at                  TEXT,
  end_reason                TEXT CHECK (end_reason IS NULL OR end_reason IN (
    'HEARTBEAT_TIMEOUT','GRACEFUL_SHUTDOWN','ADMIN_TERMINATED','REPLACED')),
  client_version            TEXT,
  status                    TEXT NOT NULL DEFAULT 'ACTIVE'
                             CHECK (status IN ('ACTIVE','ENDED')),
  created_at                TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_device_one_active_runtime
  ON device_runtime_session(device_id) WHERE status = 'ACTIVE';

-- T5: auth_session
CREATE TABLE IF NOT EXISTS auth_session (
  auth_session_id           TEXT PRIMARY KEY,
  user_id                   TEXT NOT NULL REFERENCES user_account(user_id),
  device_runtime_session_id TEXT REFERENCES device_runtime_session(device_runtime_session_id),
  auth_method               TEXT NOT NULL CHECK (auth_method IN (
    'PASSWORD','DELEGATED','PIN','DEVICE_KEY')),
  granted_by                TEXT REFERENCES user_account(user_id),
  capabilities_json         TEXT NOT NULL DEFAULT '[]'
                             CHECK (json_valid(capabilities_json)),
  token_hash                TEXT NOT NULL UNIQUE,
  refresh_token_hash        TEXT UNIQUE,
  issued_at                 TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at                TEXT NOT NULL,
  last_activity_at          TEXT NOT NULL DEFAULT (datetime('now')),
  status                    TEXT NOT NULL DEFAULT 'ACTIVE'
                             CHECK (status IN ('ACTIVE','EXPIRED','REVOKED')),
  revoke_reason             TEXT,
  created_at                TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_auth_session_user_status
  ON auth_session(user_id, status);
CREATE INDEX IF NOT EXISTS idx_auth_session_token
  ON auth_session(token_hash);

-- T6: delegated_access_grant
CREATE TABLE IF NOT EXISTS delegated_access_grant (
  grant_id                  TEXT PRIMARY KEY,
  teacher_auth_session_id   TEXT NOT NULL REFERENCES auth_session(auth_session_id),
  teacher_user_id           TEXT NOT NULL REFERENCES user_account(user_id),
  student_id                TEXT NOT NULL REFERENCES student_profile(student_id),
  device_id                 TEXT NOT NULL REFERENCES device(device_id),
  device_runtime_session_id TEXT NOT NULL
    REFERENCES device_runtime_session(device_runtime_session_id),
  capabilities_json         TEXT NOT NULL CHECK (json_valid(capabilities_json)),
  identity_confirmation_method TEXT CHECK (identity_confirmation_method IS NULL OR
    identity_confirmation_method IN ('PIN','TEACHER_ATTESTATION','PHOTO_MATCH','NONE_REQUIRED')),
  confirmed_by              TEXT REFERENCES user_account(user_id),
  confirmation_evidence     TEXT CHECK (confirmation_evidence IS NULL
                             OR json_valid(confirmation_evidence)),
  student_pin_verified      INTEGER DEFAULT 0 CHECK (student_pin_verified IN (0,1)),
  teacher_attested          INTEGER DEFAULT 0 CHECK (teacher_attested IN (0,1)),
  confirmed_at              TEXT,
  status                    TEXT NOT NULL DEFAULT 'ACTIVE'
                             CHECK (status IN ('ACTIVE','RELEASED','EXPIRED','REVOKED')),
  replaces_grant_id         TEXT REFERENCES delegated_access_grant(grant_id),
  granted_at                TEXT NOT NULL DEFAULT (datetime('now')),
  released_at               TEXT,
  release_reason            TEXT,
  expires_at                TEXT NOT NULL,
  created_at                TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_grant_one_active_per_student_device
  ON delegated_access_grant(student_id, device_id) WHERE status = 'ACTIVE';

-- T7: business_session
CREATE TABLE IF NOT EXISTS business_session (
  business_session_id TEXT PRIMARY KEY,
  session_type        TEXT NOT NULL CHECK (session_type IN ('ASSESSMENT','TRAINING','LEARNING')),
  student_id          TEXT NOT NULL REFERENCES student_profile(student_id),
  created_by          TEXT NOT NULL REFERENCES user_account(user_id),
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_business_session_student
  ON business_session(student_id, session_type);

-- T8: business_session_assignment
CREATE TABLE IF NOT EXISTS business_session_assignment (
  assignment_id       TEXT PRIMARY KEY,
  business_session_id TEXT NOT NULL REFERENCES business_session(business_session_id),
  student_id          TEXT NOT NULL REFERENCES student_profile(student_id),
  device_id           TEXT NOT NULL REFERENCES device(device_id),
  grant_id            TEXT NOT NULL REFERENCES delegated_access_grant(grant_id),
  assigned_by         TEXT NOT NULL REFERENCES user_account(user_id),
  assigned_at         TEXT NOT NULL DEFAULT (datetime('now')),
  student_confirmed_at TEXT,
  released_at         TEXT,
  release_reason      TEXT CHECK (release_reason IS NULL OR release_reason IN (
    'COMPLETED','TEACHER_RELEASED','DEVICE_OFFLINE','REPLACED','ADMIN_REVOKED')),
  replaces_assignment_id TEXT REFERENCES business_session_assignment(assignment_id),
  version             INTEGER NOT NULL DEFAULT 1,
  status              TEXT NOT NULL DEFAULT 'PENDING_CONFIRM'
                       CHECK (status IN ('PENDING_CONFIRM','ACTIVE','RELEASED','VOID')),
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_assignment_one_active_per_session
  ON business_session_assignment(business_session_id)
  WHERE status IN ('PENDING_CONFIRM','ACTIVE');

CREATE UNIQUE INDEX IF NOT EXISTS ux_assignment_one_active_per_device
  ON business_session_assignment(device_id)
  WHERE status IN ('PENDING_CONFIRM','ACTIVE');

-- T9: learning_session
CREATE TABLE IF NOT EXISTS learning_session (
  learning_session_id TEXT PRIMARY KEY,
  business_session_id TEXT NOT NULL UNIQUE REFERENCES business_session(business_session_id),
  student_id          TEXT NOT NULL REFERENCES student_profile(student_id),
  job_code            TEXT NOT NULL,
  task_code           TEXT NOT NULL,
  learning_type       TEXT NOT NULL CHECK (learning_type IN ('VIDEO_COURSE','MATERIAL_READING','MIXED')),
  status              TEXT NOT NULL DEFAULT 'INIT'
                       CHECK (status IN ('INIT','ACTIVE','PAUSED','COMPLETED','ABANDONED')),
  total_item_count    INTEGER NOT NULL DEFAULT 0 CHECK (total_item_count >= 0),
  completed_item_count INTEGER NOT NULL DEFAULT 0 CHECK (completed_item_count >= 0),
  total_duration_sec  INTEGER NOT NULL DEFAULT 0 CHECK (total_duration_sec >= 0),
  last_item_id        TEXT,
  last_position_sec   INTEGER CHECK (last_position_sec IS NULL OR last_position_sec >= 0),
  started_at          TEXT,
  completed_at        TEXT,
  created_by          TEXT NOT NULL REFERENCES user_account(user_id),
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (completed_item_count <= total_item_count)
);

CREATE INDEX IF NOT EXISTS idx_learning_session_student_status
  ON learning_session(student_id, status);

-- T10: learning_progress
CREATE TABLE IF NOT EXISTS learning_progress (
  progress_id         TEXT PRIMARY KEY,
  learning_session_id TEXT NOT NULL REFERENCES learning_session(learning_session_id),
  item_type           TEXT NOT NULL CHECK (item_type IN ('VIDEO','DOCUMENT','INTERACTIVE')),
  item_id             TEXT NOT NULL,
  item_order          INTEGER NOT NULL CHECK (item_order >= 1),
  status              TEXT NOT NULL DEFAULT 'NOT_STARTED'
                       CHECK (status IN ('NOT_STARTED','IN_PROGRESS','COMPLETED','SKIPPED')),
  duration_sec        INTEGER NOT NULL DEFAULT 0 CHECK (duration_sec >= 0),
  position_sec        INTEGER CHECK (position_sec IS NULL OR position_sec >= 0),
  completed_at        TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (learning_session_id, item_order)
);

-- T11: command_log (全新，v0.1.12 中不存在)
CREATE TABLE IF NOT EXISTS command_log (
  command_id          TEXT PRIMARY KEY,
  idempotency_key     TEXT NOT NULL,
  client_instance_id  TEXT NOT NULL,
  command_type        TEXT NOT NULL,
  actor_id            TEXT NOT NULL,
  device_id           TEXT,
  auth_session_id     TEXT,
  request_hash        TEXT NOT NULL,
  event_batch_id      TEXT,
  status              TEXT NOT NULL DEFAULT 'PENDING'
                       CHECK (status IN ('PENDING','PROCESSING','SUCCEEDED','FAILED')),
  result_json         TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  error_code          TEXT,
  error_message       TEXT,
  lease_owner         TEXT,
  lease_generation    INTEGER NOT NULL DEFAULT 0,
  lease_expires_at    TEXT,
  worker_id           TEXT,
  attempt_count       INTEGER NOT NULL DEFAULT 0,
  last_attempt_at     TEXT,
  max_attempts        INTEGER NOT NULL DEFAULT 3,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at        TEXT,
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_command_idempotency
  ON command_log(client_instance_id, idempotency_key);

-- T12: applied_event_batch
CREATE TABLE IF NOT EXISTS applied_event_batch (
  batch_id            TEXT PRIMARY KEY,
  batch_sequence      INTEGER NOT NULL UNIQUE,
  segment_id          TEXT NOT NULL,
  command_id          TEXT,
  event_count         INTEGER NOT NULL,
  batch_hash          TEXT NOT NULL,
  jsonl_offset_start  INTEGER NOT NULL,
  jsonl_offset_end    INTEGER NOT NULL,
  batch_status        TEXT NOT NULL DEFAULT 'APPLIED'
                       CHECK (batch_status IN ('APPLIED','CONFIRMED')),
  applied_at          TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at        TEXT
);

-- T13: processed_event
CREATE TABLE IF NOT EXISTS processed_event (
  event_id            TEXT PRIMARY KEY,
  batch_id            TEXT NOT NULL REFERENCES applied_event_batch(batch_id),
  event_type          TEXT NOT NULL,
  aggregate_type      TEXT NOT NULL,
  aggregate_id        TEXT NOT NULL,
  processed_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_processed_event_batch
  ON processed_event(batch_id);

-- T14: projector_cursor
CREATE TABLE IF NOT EXISTS projector_cursor (
  projector_name      TEXT PRIMARY KEY,
  last_batch_id       TEXT NOT NULL,
  last_batch_sequence INTEGER NOT NULL,
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- T15: backup_manifest
CREATE TABLE IF NOT EXISTS backup_manifest (
  manifest_id         TEXT PRIMARY KEY,
  backup_status       TEXT NOT NULL DEFAULT 'PREPARING'
                       CHECK (backup_status IN ('PREPARING','COMPLETED','FAILED','CORRUPTED')),
  schema_version      TEXT NOT NULL,
  app_version         TEXT NOT NULL,
  node_id             TEXT NOT NULL,
  cut_batch_sequence  INTEGER NOT NULL,
  cut_segment_id      TEXT NOT NULL,
  cut_segment_byte_offset INTEGER NOT NULL,
  cut_at              TEXT NOT NULL,
  database_sha256     TEXT,
  database_size_bytes INTEGER,
  segments_json       TEXT CHECK (segments_json IS NULL OR json_valid(segments_json)),
  assets_manifest_sha256 TEXT,
  started_at          TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at        TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- T16: session_invalidation_record
CREATE TABLE IF NOT EXISTS session_invalidation_record (
  invalidation_id     TEXT PRIMARY KEY,
  session_id          TEXT NOT NULL,
  session_type        TEXT NOT NULL CHECK (session_type IN ('ASSESSMENT','TRAINING')),
  reason              TEXT NOT NULL CHECK (reason IN (
    'INTEGRITY_VIOLATION','PROCEDURE_ERROR','EQUIPMENT_FAILURE','ADMIN_OVERRIDE')),
  evidence_json       TEXT CHECK (evidence_json IS NULL OR json_valid(evidence_json)),
  invalidated_by      TEXT NOT NULL REFERENCES user_account(user_id),
  invalidated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  notes               TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_invalidation_per_session
  ON session_invalidation_record(session_id);

-- T17: correction_record
CREATE TABLE IF NOT EXISTS correction_record (
  correction_id       TEXT PRIMARY KEY,
  target_type         TEXT NOT NULL CHECK (target_type IN (
    'OFFLINE_SCORE','RESULT','REPORT')),
  target_id           TEXT NOT NULL,
  original_value_json TEXT NOT NULL CHECK (json_valid(original_value_json)),
  corrected_value_json TEXT NOT NULL CHECK (json_valid(corrected_value_json)),
  reason              TEXT NOT NULL,
  corrected_by        TEXT NOT NULL REFERENCES user_account(user_id),
  corrected_at        TEXT NOT NULL DEFAULT (datetime('now')),
  correction_event_id TEXT NOT NULL REFERENCES domain_event_projection(event_id)
);

CREATE INDEX IF NOT EXISTS idx_correction_record_target
  ON correction_record(target_type, target_id);
```

### 6.4 新索引

```sql
-- student_profile
CREATE UNIQUE INDEX IF NOT EXISTS ux_student_profile_user_id
  ON student_profile(user_id) WHERE user_id IS NOT NULL;

-- assessment_session (delivery_phase)
CREATE INDEX IF NOT EXISTS idx_assessment_session_delivery_phase
  ON assessment_session(delivery_phase) WHERE delivery_phase IS NOT NULL;
```

### 6.5 新触发器

见 §7（delivery_phase 完整状态机触发器）。

### 6.6 不修改的原有触发器清单（48 个）

全部保留，包括：
- 终态保护：trg_assessment_session_no_terminal_status_change, trg_training_session_no_terminal_status_change
- 红线路径：trg_assessment_session_explicit_redline_paths, trg_training_session_explicit_redline_paths
- 安全事件批量 halt：trg_safety_incident_bind_open_assessments, trg_safety_incident_bind_open_trainings
- 安全事件核心事实冻结：trg_safety_incident_core_facts_immutable_after_confirmed
- 策略一致性：trg_assessment_session_strategy_config_match_insert/update
- 其余全部保留（完整清单见 schema.sql 行 999-1791）

### 6.7 SQLite 迁移顺序

```
1. CREATE TABLE organization (+ 默认种子)
2. CREATE TABLE node
3. CREATE TABLE device
4. CREATE TABLE device_runtime_session (+ 唯一索引)
5. CREATE TABLE auth_session (+ 索引)
6. CREATE TABLE delegated_access_grant (+ 唯一索引)
7. CREATE TABLE business_session (+ 索引)
8. CREATE TABLE business_session_assignment (+ 唯一索引 ×2)
9. ALTER TABLE student_profile ADD COLUMN user_id (+ 唯一索引)
10. ALTER TABLE assessment_session ADD COLUMN delivery_phase
11. ALTER TABLE assessment_session ADD COLUMN event_sequence_version
12. ALTER TABLE assessment_session ADD COLUMN observation_template_id
13. CREATE INDEX idx_assessment_session_delivery_phase
14. CREATE TRIGGER trg_assessment_delivery_phase_forward_only (§7)
15. ALTER TABLE safety_incident ADD COLUMN source_device_id
16. ALTER TABLE safety_incident ADD COLUMN source_node_id
17. ALTER TABLE safety_incident ADD COLUMN command_id
18. CREATE TABLE learning_session (+ 索引)
19. CREATE TABLE learning_progress
20. CREATE TABLE command_log (+ 唯一索引)
21. CREATE TABLE applied_event_batch
22. CREATE TABLE processed_event (+ 索引)
23. CREATE TABLE projector_cursor
24. CREATE TABLE backup_manifest
25. CREATE TABLE session_invalidation_record (+ 唯一索引)
26. CREATE TABLE correction_record (+ 索引)
27. ALTER TABLE result_record ADD COLUMN publication_status/student_visible/published_at/published_by
28. ALTER TABLE task_report ADD COLUMN visibility_scope
29. INSERT schema_migration (multi_device_v2.1)
30. PRAGMA foreign_key_check
31. PRAGMA integrity_check
```

### 6.8 旧数据回填规则

| 表/列 | 回填策略 |
|--------|----------|
| `assessment_session.delivery_phase` | 现有 COMPLETED/ABORTED/REDLINE_HALTED → 'FINALIZED'；OFFLINE_PENDING → 'OFFLINE_SCORING'；其余开放态 → 'PREPARED' |
| `assessment_session.event_sequence_version` | 默认 0 |
| `student_profile.user_id` | NULL（不自动关联） |
| `safety_incident.source_device_id/source_node_id/command_id` | NULL |
| `business_session` | 为每个已有 assessment_session 和 training_session 创建对应 business_session |

**回填 SQL：**
```sql
-- delivery_phase 回填
UPDATE assessment_session SET delivery_phase = 'FINALIZED'
  WHERE status IN ('COMPLETED','ABORTED','REDLINE_HALTED');
UPDATE assessment_session SET delivery_phase = 'OFFLINE_SCORING'
  WHERE status = 'OFFLINE_PENDING';
UPDATE assessment_session SET delivery_phase = 'PREPARED'
  WHERE status IN ('INIT','ACTIVE','EMOTION_INTERRUPTED','SUSPENDED_REVIEW_REQUIRED')
    AND delivery_phase IS NULL;

-- business_session 回填
INSERT INTO business_session (business_session_id, session_type, student_id, created_by, created_at)
  SELECT session_id, 'ASSESSMENT', student_id, created_by, created_at
  FROM assessment_session
  WHERE session_id NOT IN (SELECT business_session_id FROM business_session);

INSERT INTO business_session (business_session_id, session_type, student_id, created_by, created_at)
  SELECT training_session_id, 'TRAINING', student_id, created_by, created_at
  FROM training_session
  WHERE training_session_id NOT IN (SELECT business_session_id FROM business_session);
```

### 6.9 回滚方案

迁移失败时回滚步骤：
1. 删除新增表（DROP TABLE IF EXISTS，逆序）
2. 删除新增索引（DROP INDEX IF EXISTS）
3. 删除新增触发器（DROP TRIGGER IF EXISTS）
4. 新增列无法在 SQLite 中直接 DROP COLUMN（3.35.0+ 支持），需要 recreate table 或保留为 NULL

### 6.10 外键和完整性检查

迁移完成后必须执行：
```sql
PRAGMA foreign_key_check;  -- 确认所有 FK 引用有效
PRAGMA integrity_check;    -- 确认数据库结构完整
```

### 6.11 不需要的表及理由

| 表名 | 是否需要 | 理由 |
|------|----------|------|
| pairing_challenge | 不需要 | 配对通过 HTTP :7070 指纹比对完成，无需持久化挑战 |
| report_version | 不需要 | 使用 correction_record + task_report.status=SUPERSEDED 实现版本管理 |
| offline_score_draft | 仅运行时 | 教师评分草稿保存在客户端 localStorage，提交时原子写入 |

---

## 七、delivery_phase 完整状态机

### 7.1 完整枚举

```
PREPARED → ASSIGNED → STUDENT_CONFIRMED → ONLINE_IN_PROGRESS
  → ONLINE_COMPLETED → OFFLINE_SCORING → OBSERVATION → READY_TO_FINALIZE → FINALIZED
                                        ↘ READY_TO_FINALIZE (跳过 OBSERVATION)
```

### 7.2 所有合法迁移

| 当前 phase | 允许的下一个 phase |
|-----------|-------------------|
| PREPARED | ASSIGNED |
| ASSIGNED | STUDENT_CONFIRMED |
| STUDENT_CONFIRMED | ONLINE_IN_PROGRESS |
| ONLINE_IN_PROGRESS | ONLINE_COMPLETED |
| ONLINE_COMPLETED | OFFLINE_SCORING |
| OFFLINE_SCORING | OBSERVATION, READY_TO_FINALIZE |
| OBSERVATION | READY_TO_FINALIZE |
| READY_TO_FINALIZE | FINALIZED |
| FINALIZED | （终态，不可迁移） |

跳过 OBSERVATION 条件：`observation_template_id IS NULL`

### 7.3 所有非法跳转（禁止）

- PREPARED → 除 ASSIGNED 外任何值
- ASSIGNED → 除 STUDENT_CONFIRMED 外任何值
- STUDENT_CONFIRMED → 除 ONLINE_IN_PROGRESS 外任何值
- ONLINE_IN_PROGRESS → 除 ONLINE_COMPLETED 外任何值
- ONLINE_COMPLETED → 除 OFFLINE_SCORING 外任何值
- OFFLINE_SCORING → 除 OBSERVATION/READY_TO_FINALIZE 外任何值
- OBSERVATION → 除 READY_TO_FINALIZE 外任何值
- READY_TO_FINALIZE → 除 FINALIZED 外任何值
- FINALIZED → 任何值（终态不可变）
- 任何回退（序号倒退）

### 7.4 完整触发器（覆盖全部状态迁移）

```sql
CREATE TRIGGER IF NOT EXISTS trg_assessment_delivery_phase_forward_only
BEFORE UPDATE OF delivery_phase ON assessment_session
FOR EACH ROW
WHEN OLD.delivery_phase IS NOT NULL AND NEW.delivery_phase IS NOT NULL
  AND OLD.delivery_phase <> NEW.delivery_phase
BEGIN
  SELECT CASE
    -- 终态不可变
    WHEN OLD.delivery_phase = 'FINALIZED' THEN
      RAISE(ABORT, 'delivery_phase FINALIZED is terminal')
    -- READY_TO_FINALIZE 只能到 FINALIZED
    WHEN OLD.delivery_phase = 'READY_TO_FINALIZE' AND NEW.delivery_phase <> 'FINALIZED' THEN
      RAISE(ABORT, 'READY_TO_FINALIZE can only advance to FINALIZED')
    -- OBSERVATION 只能到 READY_TO_FINALIZE
    WHEN OLD.delivery_phase = 'OBSERVATION' AND NEW.delivery_phase <> 'READY_TO_FINALIZE' THEN
      RAISE(ABORT, 'OBSERVATION can only advance to READY_TO_FINALIZE')
    -- OFFLINE_SCORING 只能到 OBSERVATION 或 READY_TO_FINALIZE
    WHEN OLD.delivery_phase = 'OFFLINE_SCORING'
      AND NEW.delivery_phase NOT IN ('OBSERVATION','READY_TO_FINALIZE') THEN
      RAISE(ABORT, 'OFFLINE_SCORING can only advance to OBSERVATION or READY_TO_FINALIZE')
    -- ONLINE_COMPLETED 只能到 OFFLINE_SCORING
    WHEN OLD.delivery_phase = 'ONLINE_COMPLETED' AND NEW.delivery_phase <> 'OFFLINE_SCORING' THEN
      RAISE(ABORT, 'ONLINE_COMPLETED can only advance to OFFLINE_SCORING')
    -- ONLINE_IN_PROGRESS 只能到 ONLINE_COMPLETED
    WHEN OLD.delivery_phase = 'ONLINE_IN_PROGRESS' AND NEW.delivery_phase <> 'ONLINE_COMPLETED' THEN
      RAISE(ABORT, 'ONLINE_IN_PROGRESS can only advance to ONLINE_COMPLETED')
    -- STUDENT_CONFIRMED 只能到 ONLINE_IN_PROGRESS
    WHEN OLD.delivery_phase = 'STUDENT_CONFIRMED' AND NEW.delivery_phase <> 'ONLINE_IN_PROGRESS' THEN
      RAISE(ABORT, 'STUDENT_CONFIRMED can only advance to ONLINE_IN_PROGRESS')
    -- ASSIGNED 只能到 STUDENT_CONFIRMED
    WHEN OLD.delivery_phase = 'ASSIGNED' AND NEW.delivery_phase <> 'STUDENT_CONFIRMED' THEN
      RAISE(ABORT, 'ASSIGNED can only advance to STUDENT_CONFIRMED')
    -- PREPARED 只能到 ASSIGNED
    WHEN OLD.delivery_phase = 'PREPARED' AND NEW.delivery_phase <> 'ASSIGNED' THEN
      RAISE(ABORT, 'PREPARED can only advance to ASSIGNED')
  END;
END;
```

### 7.5 与 assessment_session.status 的映射

| delivery_phase | 对应的 session status |
|---------------|---------------------|
| PREPARED | INIT |
| ASSIGNED | INIT (已分配但未确认) |
| STUDENT_CONFIRMED | INIT (已确认身份) |
| ONLINE_IN_PROGRESS | ACTIVE |
| ONLINE_COMPLETED | ACTIVE / OFFLINE_PENDING |
| OFFLINE_SCORING | OFFLINE_PENDING |
| OBSERVATION | OFFLINE_PENDING |
| READY_TO_FINALIZE | OFFLINE_PENDING |
| FINALIZED | COMPLETED |

**注意：** `status` 是权威业务状态（含 EMOTION_INTERRUPTED 等中间态），`delivery_phase` 是多设备交互阶段的辅助投影。两者独立更新，但受业务规则约束（例如 status=REDLINE_HALTED 时 delivery_phase 冻结在当前值）。

### 7.6 REDLINE_HALTED 和 ABORTED 处理

- 当 `status` 变为 REDLINE_HALTED 或 ABORTED 时，`delivery_phase` 保持当前值不变（不设为 FINALIZED）
- REDLINE_HALTED / ABORTED 不等于正常 FINALIZED
- 查询历史数据时，必须区分：
  - `delivery_phase = 'FINALIZED' AND status = 'COMPLETED'` → 正常完成
  - `status IN ('REDLINE_HALTED','ABORTED')` → 异常终止（delivery_phase 冻结在中断点）

### 7.7 旧数据回填规则

```sql
-- 已正常完成的：FINALIZED
UPDATE assessment_session SET delivery_phase = 'FINALIZED'
  WHERE status = 'COMPLETED' AND delivery_phase IS NULL;
-- 异常终止的：保留中断点（无法确定，默认 PREPARED）
UPDATE assessment_session SET delivery_phase = 'PREPARED'
  WHERE status IN ('REDLINE_HALTED','ABORTED') AND delivery_phase IS NULL;
-- 正在进行线下评分的
UPDATE assessment_session SET delivery_phase = 'OFFLINE_SCORING'
  WHERE status = 'OFFLINE_PENDING' AND delivery_phase IS NULL;
-- 其余开放态
UPDATE assessment_session SET delivery_phase = 'PREPARED'
  WHERE delivery_phase IS NULL;
```

---

## 八、JSONL–SQLite 事件溯源与恢复协议

### 8.1 核心原则

- **JSONL 是领域事实来源**：action_log.jsonl 只追加、不修改、不删除
- **SQLite 是领域投影**：可从 JSONL 重建的表属于"可重建"类
- **Event Writer 单写者**：任何时刻最多一个 in-flight batch
- **禁止通用 UPSERT 作为领域投影策略**：投影必须精确匹配事件语义

### 8.2 表分类

| 类别 | 说明 | 恢复方式 | 表 |
|------|------|----------|-----|
| **领域事实投影（可重建）** | 由 JSONL 事件驱动生成 | 从 JSONL 重放重建 | assessment_session, training_session, learning_session, answer_record, offline_score_record, result_record, task_report, safety_incident, safety_incident_binding, training_step_record, domain_event_projection, learning_progress |
| **运维/基础设施（不可重建）** | 独立于领域事件存在 | 必须备份 | user_account, student_profile, strategy_config, question_bank, asset_resource, error_code_registry, error_event_log, snapshot_meta, schema_migration, organization, node, device |
| **事件溯源引导（自重建）** | 重放过程中自动重建 | JSONL 重放期间重建 | applied_event_batch, processed_event, projector_cursor, command_log |
| **仅运行时** | 不持久化或重启后重置 | 无需恢复 | device_runtime_session (ACTIVE 部分), auth_session (ACTIVE 部分) |

### 8.3 JSONL 格式

每行一个 JSON 对象，三种记录类型：

**BATCH_PREPARED:**
```json
{
  "type": "BATCH_PREPARED",
  "batch_id": "batch_xxx",
  "batch_sequence": 42,
  "segment_id": "seg_001",
  "event_count": 3,
  "batch_hash": "sha256:...",
  "command_id": "cmd_yyy",
  "timestamp": "2026-07-14T08:00:00.000Z"
}
```

**EVENT:**
```json
{
  "type": "EVENT",
  "batch_id": "batch_xxx",
  "event_id": "evt_zzz",
  "aggregate_type": "ASSESSMENT_SESSION",
  "aggregate_id": "session_abc",
  "event_type": "AnswerSubmitted",
  "event_sequence": 5,
  "payload": { ... },
  "checksum": "sha256:...",
  "actor_id": "user_001",
  "timestamp": "2026-07-14T08:00:00.100Z"
}
```

**BATCH_COMMITTED:**
```json
{
  "type": "BATCH_COMMITTED",
  "batch_id": "batch_xxx",
  "batch_sequence": 42,
  "timestamp": "2026-07-14T08:00:00.200Z"
}
```

### 8.4 三阶段写入协议

**Phase 1: PREPARE**
1. 获取单写者互斥锁
2. 分配 `batch_sequence`（全局单调递增）
3. 生成 `batch_id`（UUID v4）
4. 序列化所有事件
5. 计算 `batch_hash`（SHA-256 of serialized events）
6. 写入 JSONL：BATCH_PREPARED + 所有 EVENT 记录
7. `fsync` 确保持久化
8. 记录 `jsonl_offset_start` 和 `jsonl_offset_end`

**Phase 2: APPLY（SQLite BEGIN IMMEDIATE）**
1. INSERT INTO `applied_event_batch`（batch_status = 'APPLIED'）
2. 对每个事件：
   - 检查 `processed_event` 是否已存在（幂等保护）
   - INSERT INTO `processed_event`
   - 执行对应 projector（更新领域投影表）
3. UPDATE `projector_cursor`
4. COMMIT

**Phase 3: CONFIRM**
1. 写入 JSONL BATCH_COMMITTED 记录
2. `fsync`
3. UPDATE `applied_event_batch` SET `batch_status = 'CONFIRMED'`, `confirmed_at = now()`
4. 释放互斥锁

### 8.5 Segment 轮转

- 活跃段大小超过 10 MB 或 10000 batches 时轮转
- 轮转步骤：关闭当前段 → 创建新 `segment_id` → 更新 `segment_index.json`
- 归档段永久保留（不删除），可压缩存储
- `segment_index.json` 记录每个段的元数据：
  ```json
  {
    "segments": [
      {
        "segment_id": "seg_001",
        "file_path": "segments/seg_001.jsonl",
        "first_batch_sequence": 1,
        "last_batch_sequence": 500,
        "byte_size": 10485760,
        "sha256": "...",
        "created_at": "...",
        "sealed_at": "..."
      }
    ]
  }
  ```

### 8.6 Hash Chain 防篡改

- 每个 batch 的 `batch_hash` = SHA-256(previous_batch_hash + serialized_events)
- 第一个 batch 的 previous_batch_hash = 固定种子 "GENESIS"
- 段边界处的 hash 连续性由 segment_index 中的 `last_batch_hash` 保证
- CORRUPTION_DETECTED 状态：hash 验证失败时 Server 进入只读模式，拒绝新写入

### 8.7 启动恢复协议 (startupRecovery)

**Phase 1: 隔离不完整尾部**
1. 读取 JSONL 活跃段尾部
2. 检查最后一个 BATCH_PREPARED 是否完整（event_count 匹配）
3. 不完整 → 截断到最后一个完整 BATCH_PREPARED 或 BATCH_COMMITTED 边界

**Phase 2: 校验 APPLIED 未 CONFIRMED**
1. 查询 SQLite 中 `batch_status = 'APPLIED'` 的批次
2. 在 JSONL 中查找对应的 BATCH_PREPARED
3. 验证 event_count 和 batch_hash 一致
4. 一致 → 写入 BATCH_COMMITTED，设为 CONFIRMED
5. 不一致 → 进入 CORRUPTION_DETECTED

**Phase 3: 重放 PREPARED 未 APPLIED**
1. 在 JSONL 中查找有 BATCH_PREPARED 但无 BATCH_COMMITTED 且 SQLite 中无记录的批次
2. 对每个此类批次：执行 Phase 2（APPLY）

**Phase 4: 推进 cursor + 恢复 command_log**
1. 对齐 `projector_cursor` 到最新 CONFIRMED batch
2. 查找 `command_log` 中 status = 'PROCESSING' 的命令
3. 如果其 `event_batch_id` 对应的 batch 已 CONFIRMED → 设为 SUCCEEDED
4. 如果 batch 不存在 → 重置为 PENDING（允许重试）

### 8.8 CORRUPTION_DETECTED 行为

1. Server 设置全局标志 `corruptionDetected = true`
2. 拒绝所有写入命令（返回 503 + error_code: CORRUPTION_DETECTED）
3. 允许读取操作继续
4. 通过 SSE 和 IPC 通知所有已连接客户端
5. 需要人工介入（恢复备份或手动修复 JSONL）

### 8.9 日志归档策略

- 归档段永久保留（不自动删除）
- 磁盘空间超过阈值（默认 80%）时发出告警，不自动清理
- 可验证基线快照：定期 snapshot 后，可将快照前的 JSONL 归档到外部存储
- 归档后的段仍保留 hash chain 入口点以便验证

---

## 九、command_log 与 fencing

### 9.1 command_log 字段语义

| 字段 | 职责 |
|------|------|
| `idempotency_key` | 客户端生成的幂等键 |
| `client_instance_id` | 客户端实例标识（浏览器 tab / Electron 窗口） |
| `request_hash` | SHA-256(command_type + 规范化参数)，用于检测重放但参数不同的请求 |
| `event_batch_id` | 预分配的事件批次 ID（命令注册时生成） |
| `lease_owner` | 当前持有租约的 worker 标识 |
| `lease_generation` | fencing token（单调递增） |
| `worker_id` | 执行命令的 worker 实例标识 |
| `lease_expires_at` | 租约过期时间 |
| `attempt_count` | 累计尝试次数 |

### 9.2 幂等处理协议（7 步）

```
1. 接收命令，计算 request_hash = SHA-256(command_type + normalized_params)
2. INSERT OR IGNORE INTO command_log (status='PENDING', lease_generation=0)
3. SELECT * FROM command_log WHERE client_instance_id=? AND idempotency_key=?
4. 根据 status 分支：
   - SUCCEEDED → 直接返回 result_json（幂等响应）
   - FAILED → 如果 attempt_count < max_attempts 且 request_hash 匹配 → 转 step 5
   - PROCESSING → 检查 lease_expires_at：
     - 未过期 → 返回 409 CONFLICT（其他 worker 在处理）
     - 已过期 → 转 step 5（接管）
   - PENDING → 转 step 5
5. 获取租约：
   UPDATE command_log
   SET status='PROCESSING', lease_owner=?, worker_id=?,
       lease_generation=lease_generation+1, lease_expires_at=now()+30s,
       attempt_count=attempt_count+1, last_attempt_at=now()
   WHERE command_id=? AND lease_generation=?  -- fencing: 旧 generation 无法更新
6. 执行领域逻辑 + 写入事件批次（JSONL PREPARE → SQLite APPLY）
7. 提交结果：
   UPDATE command_log
   SET status='SUCCEEDED', result_json=?, completed_at=now()
   WHERE command_id=? AND lease_owner=? AND lease_generation=?
   -- 如果 WHERE 不匹配（lease 被接管）→ 不提交，让新 owner 完成
```

### 9.3 不可逆点定义

> **一旦完整 BATCH_PREPARED 已 fsync 到 JSONL，新 worker 不得重新执行 Domain Handler，只能接管同一批次的 APPLY、CONFIRM 和结果恢复。**

- BATCH_PREPARED fsync 完成 = 不可逆点 (Point of No Return)
- 新 worker 检测到已有 BATCH_PREPARED → 跳过 Domain Handler → 直接执行 APPLY + CONFIRM
- 保证事件不重复生成

### 9.4 租约续约

- 长时间命令可主动续约：UPDATE lease_expires_at = now() + 30s WHERE lease_generation = current
- 续约失败（generation 不匹配）→ 当前 worker 立即放弃
- 默认租约 30 秒，续约间隔 10 秒

### 9.5 崩溃窗口矩阵

| 崩溃时机 | JSONL 状态 | SQLite 状态 | 恢复动作 |
|----------|-----------|-------------|----------|
| step 5 后、step 6 前 | 无 batch | command PROCESSING | 租约过期后新 worker 重新执行 |
| JSONL 写入中途 | 不完整 BATCH_PREPARED | command PROCESSING | 截断不完整字节；重置 command 为 PENDING |
| BATCH_PREPARED fsync 后、APPLY 前 | 完整 BATCH_PREPARED | command PROCESSING，无 applied_event_batch | 新 worker 接管：跳过 Domain Handler，执行 APPLY + CONFIRM |
| APPLY 事务中途 | 完整 BATCH_PREPARED | 事务回滚（SQLite 自动） | 同上：重放 APPLY |
| APPLY COMMIT 后、CONFIRM 前 | BATCH_PREPARED（无 COMMITTED） | applied_event_batch APPLIED | startupRecovery Phase 2：写 COMMITTED，设 CONFIRMED |
| CONFIRM 后、result 更新前 | BATCH_COMMITTED | CONFIRMED，command 仍 PROCESSING | startupRecovery Phase 4：从 batch 恢复 result_json |
| result 更新后 | BATCH_COMMITTED | CONFIRMED + SUCCEEDED | 无需恢复 |

### 9.6 核心不变量

1. `(client_instance_id, idempotency_key)` 全局唯一（ux_command_idempotency 索引）
2. 同一 command_id 的 lease_generation 只增不减
3. 一旦 BATCH_PREPARED fsync，任何 worker 都不得重新执行 Domain Handler
4. lease_expires_at 过期的 PROCESSING 命令可被任何 worker 接管
5. status = SUCCEEDED 后，result_json 不可变
6. event_batch_id 在 command 注册时预分配，batch 创建时使用该 ID

---

## 十、安全事件

### 10.1 权威实现基线

以 `src/main/db/schema.sql` v0.1.12 中的实际触发器为准。

**安全事件批量 halt 由 SQLite AFTER INSERT 触发器执行：**
- `trg_safety_incident_bind_open_assessments`：INSERT safety_incident 时，自动将同 student_id + task_code 的所有开放 assessment_session 设为 REDLINE_HALTED，同时创建 safety_incident_binding 记录
- `trg_safety_incident_bind_open_trainings`：同理，处理开放 training_session

**分工：**
| 层 | 职责 |
|----|------|
| SQLite AFTER INSERT 触发器 | 批量 halt 所有开放会话 + 创建 binding |
| 应用层 Event Writer | 生成 SafetyIncidentCreated 事件 → INSERT safety_incident（触发 trigger） |
| 应用层 Projector | 读取 trigger 结果 → 生成后续事件（RedlineTriggered）→ 更新相关投影字段 |
| 领域触发器（非 AFTER INSERT） | 强制约束：终态不可变、核心事实冻结、状态迁移合法性 |

### 10.2 SafetyIncidentCreated 完整时序

```
T+0ms   教师/管理员发起 POST /api/v1/safety-incidents (或 IPC triggerRedline)
T+5ms   Auth Gate 验证 TEACHER/ADMIN 角色
T+10ms  Command Bus 注册命令（idempotency_key 检查）
T+15ms  Domain Handler 构造 SafetyIncidentCreated payload
T+20ms  Event Writer: JSONL BATCH_PREPARED (包含 SafetyIncidentCreated 事件)
T+25ms  Event Writer: fsync
T+30ms  SQLite BEGIN IMMEDIATE
T+35ms  INSERT INTO safety_incident (status='PENDING_DETAIL')
T+40ms  [自动] trg_safety_incident_bind_open_assessments 触发：
          - 找到所有 status IN (开放态) 且 student_id=X AND task_code=Y 的 assessment_session
          - UPDATE 每个为 REDLINE_HALTED + level_result='LEVEL_FAIL_BY_SAFETY'
          - INSERT safety_incident_binding 记录
T+45ms  [自动] trg_safety_incident_bind_open_trainings 触发：
          - 同理处理 training_session
T+50ms  INSERT INTO processed_event
T+55ms  应用层：为每个被 halt 的会话生成 RedlineTriggered 投影更新
T+60ms  INSERT INTO result_record (LEVEL_FAIL_BY_SAFETY, safety_overridden=1)
T+65ms  UPDATE projector_cursor
T+70ms  COMMIT
T+75ms  JSONL BATCH_COMMITTED + fsync
T+80ms  UPDATE command_log status='SUCCEEDED'
T+85ms  NotificationBus: SSE 推送给教师平板
T+90ms  NotificationBus: IPC 推送给学生 Renderer
T+100ms HTTP 201 响应
```

### 10.3 安全事件状态机

```
PENDING_DETAIL → CONFIRMED → RESOLVED
                           → VOIDED (仅安全事件可 VOIDED，会话不可)
```

**状态迁移权限：**
| 迁移 | 要求 |
|------|------|
| PENDING_DETAIL → CONFIRMED | confirmed_by 必须为 ACTIVE TEACHER |
| CONFIRMED → RESOLVED | resolved_by 必须为 ACTIVE ADMIN；resolved_at 必须填写 |
| CONFIRMED → VOIDED | resolved_by 必须为 ACTIVE ADMIN；void_reason 必须填写 |
| PENDING_DETAIL → VOIDED | resolved_by 必须为 ACTIVE ADMIN |

### 10.4 关键不变量

1. **无开放会话也可创建**：安全事件不依赖已有会话存在
2. **按 student_id + job_code + task_code 独立聚合**：不同 task_code 的安全事件互不影响
3. **同时熔断所有相关开放 assessment_session**：触发器自动执行
4. **同时熔断所有相关开放 training_session**：触发器自动执行
5. **每个受影响会话只产生一次 binding**：UNIQUE(incident_id, aggregate_type, aggregate_id)
6. **LEVEL_FAIL_BY_SAFETY**：安全终止的结果强制覆盖所有基于分数的等级
7. **普通报告阻断**：REDLINE_HALTED 会话只能生成 SAFETY_TERMINATION_REPORT
8. **CONFIRMED 后核心事实冻结**：student_id, job_code, task_code, trigger_event_id, reason_code, context_phase, description, triggered_by, confirmed_by, occurred_at 不可修改
9. **void_reason**：FALSE_TRIGGER / DUPLICATE_RECORD / NON_SAFETY_EVENT / FACTUAL_CORRECTION
10. **replacement_incident_id**：FACTUAL_CORRECTION 或 DUPLICATE_RECORD 时必须指向替代事件
11. **REDLINE_HALTED 不可逆**：终态保护触发器确保

### 10.5 安全事件与会话 binding 验收

| 验收用例 | 预期行为 |
|----------|----------|
| 无开放会话时创建安全事件 | 成功创建，binding 数 = 0 |
| assessment + training 同时开放 | 两个会话同时 halt，各产生一个 binding |
| 已有 REDLINE_HALTED 的会话 | 不重复 halt，不产生新 binding |
| CONFIRMED 后修改 reason_code | 触发器阻止，RAISE ABORT |
| VOIDED 安全事件 | 不影响已 REDLINE_HALTED 的会话（终态不可逆） |
| 新建会话时有未解决安全事件 | 触发器阻止 INSERT（BLOCKED_BY_SAFETY_INCIDENT） |

---

## 十一、REST、SSE 与 IPC

### 11.1 通信方式分配

| 客户端 | 协议 | 认证 | 推送 |
|--------|------|------|------|
| Teacher Web | HTTPS REST + SSE | HttpOnly Cookie | SSE |
| Student Kiosk | IPC / MessagePort | contextBridge 凭证 | `BrowserWindow.webContents.send()` |
| Future Student Web Portal | HTTPS REST + SSE | HttpOnly Cookie | SSE（独立频道白名单） |

**严格边界：**
- Student Kiosk Renderer 不订阅网络 SSE
- 不使用 WebSocket
- 不存在 WebSocket ticket 机制

### 11.2 SSE 合同

**事件 ID 格式：** `<stream_epoch>:<sequence>`

- `stream_epoch`：Server 每次启动（含崩溃重启）递增的纪元号
- `sequence`：纪元内单调递增的事件序号

**重连协议：**
1. EventSource 自动重连，携带 `Last-Event-ID: <epoch>:<seq>`
2. Server 检查 epoch 是否匹配当前 epoch：
   - 匹配 → 从 ring buffer 中 seq 之后的事件开始推送
   - 不匹配（Server 已重启）→ 发送 `event: resync_required`
3. 客户端收到 `resync_required` → 全量 REST 查询刷新状态

**频道授权：**
- 教师 SSE 频道：根据 auth_session.capabilities_json 过滤可见事件
- 教师可见范围：自己负责的学生 + 自己发起的测评
- 未来学生 Web 门户频道白名单：仅允许接收自身 session 状态变更和已发布的结果/报告

### 11.3 REST API 基本规范

- Base path: `/api/v1/`
- 认证：Cookie-based（教师/管理员），IPC 内部凭证（学生）
- 写操作必须携带：`X-Idempotency-Key`, `X-Client-Instance-Id`, `X-CSRF-Token`
- 响应格式：`{ "ok": true, "data": {...} }` 或 `{ "ok": false, "error": { "code": "...", "message": "..." } }`
- 时间格式：ISO 8601 UTC
- 分页：`?page=1&size=20`，响应含 `pagination: { total, page, size, pages }`

### 11.4 主要 API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /auth/login | 教师/管理员登录 |
| POST | /auth/refresh | 刷新 access token |
| POST | /auth/logout | 登出（撤销 auth_session） |
| GET | /students | 学生列表 |
| GET | /students/:id | 学生详情 |
| POST | /sessions/assessment | 创建测评会话 |
| POST | /sessions/training | 创建训练会话 |
| POST | /sessions/learning | 创建学习会话 |
| GET | /sessions | 会话列表（按类型/状态过滤） |
| POST | /sessions/:id/assign | 分配会话到设备 |
| POST | /sessions/:id/start | 启动会话 |
| POST | /sessions/:id/offline-scores | 提交线下评分 |
| POST | /sessions/:id/observations | 记录教师观察 |
| POST | /safety-incidents | 创建安全事件 |
| PUT | /safety-incidents/:id/confirm | 确认安全事件 |
| PUT | /safety-incidents/:id/resolve | 解决/撤销安全事件 |
| GET | /results | 结果列表 |
| GET | /reports | 报告列表 |
| GET | /reports/:id | 报告详情 |
| POST | /devices/:id/reconnect | 设备重连 / Grant Rebind |
| GET | /sse/teacher | 教师 SSE 流 |
| GET | /sse/student-portal | 未来学生门户 SSE 流 |
| GET | /pair/fingerprint | 配对指纹（HTTP :7070） |
| GET | /pair/ca.crt | CA 证书下载（HTTP :7070） |

### 11.5 IPC API 对照

学生 Kiosk 的 IPC 通道映射到同一 Command Bus：

| IPC 通道 | 等效 REST | 说明 |
|----------|-----------|------|
| assessment:createSession | POST /sessions/assessment | 教师发起（IPC 中教师先登录） |
| assessment:startSession | POST /sessions/:id/start | 学生确认开始 |
| assessment:submitAnswer | POST /sessions/:id/answers | 学生提交答案 |
| assessment:triggerRedline | POST /safety-incidents | 教师触发红线 |
| training:createSession | POST /sessions/training | 教师发起 |
| training:startStep | POST /sessions/:id/steps/:step/start | 学生操作 |

IPC 和 HTTP 请求统一进入 Command Bus，共享同一套领域逻辑和 idempotency 保证。

### 11.6 Main → Renderer 推送

Student Renderer 接收服务端推送的方式：

```typescript
// Electron Main 进程
serverPort.on('message', (event) => {
  const { channel, payload } = event.data;
  mainWindow.webContents.send(channel, payload);
});

// Student Renderer (preload)
contextBridge.exposeInMainWorld('api', {
  onPush: (channel: string, callback: Function) => {
    ipcRenderer.on(channel, (_event, payload) => callback(payload));
  }
});
```

推送频道：
- `session:status-changed` — 会话状态变更
- `session:assigned` — 新会话分配到本设备
- `safety:redline-triggered` — 安全红线触发
- `system:recovery-started` — 系统恢复中
- `system:recovery-completed` — 系统恢复完成

---

## 十二、Web 安全

### 12.1 Cookie 策略

| Cookie | 属性 | 有效期 | 用途 |
|--------|------|--------|------|
| `session` | HttpOnly, Secure, SameSite=Strict | 1h | 主认证令牌 |
| `refresh_token` | HttpOnly, Secure, SameSite=Strict, Path=/api/v1/auth/refresh | 7d | 令牌续约 |
| `csrf_token` | Secure, SameSite=Strict（非 HttpOnly，JS 可读） | 与 session 同步 | CSRF 防护 |
| `device_credential` | HttpOnly, Secure, SameSite=Strict | 1yr | 设备级长期凭证 |

### 12.2 CSRF 三层防护

1. **CSRF Token Double-Submit**：客户端从 `csrf_token` cookie 读取值，在写请求中通过 `X-CSRF-Token` 头发送
2. **Origin/Referer 校验**：服务端验证 `Origin` 头匹配期望源；Origin 缺失时降级检查 `Referer`
3. **SameSite=Strict**：浏览器层面阻止跨站请求携带 cookie

### 12.3 Electron 安全

| 配置项 | 值 | 说明 |
|--------|-----|------|
| contextIsolation | true | 隔离 preload 和 renderer 上下文 |
| nodeIntegration | false | 禁止 renderer 直接使用 Node API |
| sandbox | true | 启用沙箱（限制 renderer 系统调用） |
| webSecurity | true | 启用同源策略 |

### 12.4 CSP（Content Security Policy）

Student Renderer CSP：
```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' app://asset/;
media-src 'self' app://asset/;
connect-src 'self';
frame-src 'none';
```

Teacher Web CSP（由 Fastify 响应头设置）：
```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' https:;
media-src 'self' https:;
connect-src 'self';
frame-src 'none';
```

### 12.5 其他安全措施

| 措施 | 实现 |
|------|------|
| 请求限流 | Fastify rate-limit：全局 100 req/min/IP，login 5 req/min/IP |
| 审计日志 | 所有认证、授权、安全事件操作写入 error_event_log |
| 学生答案隔离 | 评分规则和正确答案不返回给学生端 API |
| CORS | 不作为认证手段；同源部署优先（Teacher SPA 由同一 Server 托管） |
| 输入验证 | 所有 JSON body 通过 schema 验证后才进入 Command Bus |

---

## 十三、HTTPS、证书与配对

### 13.1 证书体系

| 证书 | 算法 | 有效期 | 用途 |
|------|------|--------|------|
| Node Root CA | ECDSA P-256, self-signed | 5 年 | 信任锚点 |
| Server Leaf | ECDSA P-256, CA-signed | 90 天 | Fastify HTTPS 服务端证书 |

- 无 CRL/OCSP（LAN 场景不需要）
- CA 吊销 = 重新生成 CA + 全量重新配对

### 13.2 SAN（Subject Alternative Names）

优先级：
1. 稳定 mDNS hostname（如 `xccareer-node01.local`）
2. 可选具体 IP 地址（如 `192.168.1.100`）

IP 变化时自动重签叶子证书（CA 不变 → 已信任的设备无需重新安装 CA）。

### 13.3 私钥保护

| 平台 | 保护方式 |
|------|----------|
| Windows | DPAPI 加密 + 文件 ACL（仅 SYSTEM + 安装用户） |
| macOS | Keychain Access（kSecAttrAccessible: kSecAttrAccessibleAfterFirstUnlock） |
| Linux | 文件权限 0600 + 运行用户专属 |

### 13.4 CA 备份和轮换

- CA 私钥包含在全量备份中（加密存储）
- CA 轮换：生成新 CA → 双 CA 并行期（旧 CA 继续验证，新 CA 开始签发）→ 所有设备完成重信任 → 移除旧 CA
- MDM/机构 CA：支持通过 MDM profile 推送信任（iOS/Android/Windows）
- 未来原生客户端：支持 certificate pinning（客户端内嵌 CA 指纹）

### 13.5 首次安装流程（带外信任建立）

```
┌───────────────┐                    ┌──────────────────┐
│  教师平板      │                    │  学生一体机屏幕   │
│  浏览器       │                    │  显示配对引导     │
└───────┬───────┘                    └────────┬─────────┘
        │                                      │
        │  1. 教师看到一体机屏幕上的             │
        │     IP + 端口 + CA 指纹                │
        │                                      │
        │  2. 教师在浏览器访问                   │
        │     http://<ip>:7070/api/v1/pair/fingerprint
        │─────────────────────────────────────▶│
        │                                      │
        │  3. 返回 CA fingerprint JSON          │
        │◀─────────────────────────────────────│
        │                                      │
        │  4. 教师核对屏幕指纹与返回指纹         │
        │                                      │
        │  5. 匹配后，教师手动安装 CA 证书       │
        │     （从 http://:7070 下载 ca.crt）   │
        │                                      │
        │  6. 所有后续业务流量走 HTTPS :7443     │
        │─────────────────────────────────────▶│
        └───────────────────────────────────────┘
```

**关键约束：**
- HTTP :7070 仅临时提供 `ca.crt` 和指纹，自动超时关闭（5 分钟）
- HTTP :7070 不传输任何业务数据
- 所有业务数据仅走 HTTPS :7443
- 浏览器不能自动安装系统 CA（需人工操作）
- 配对模式由教师在一体机上手动触发

### 13.6 证书自动续约

- Server 启动时检查叶子证书剩余有效期
- 剩余 < 30 天 → 自动用 CA 签发新叶子证书
- Fastify 热重载 TLS context（无需重启）
- 通过 SSE 通知已连接的教师设备

### 13.7 端口职责划分

| 端口 | 协议 | 用途 | 暴露时机 |
|------|------|------|----------|
| :7443 | HTTPS | 所有业务 API + SSE + Teacher SPA | 始终 |
| :7070 | HTTP | 仅 CA 指纹 + ca.crt 下载 | 仅配对模式期间（5 分钟） |

---

## 十四、学生可见性和发布控制

### 14.1 核心原则

- 教师内部观察数据 ≠ 学生可见反馈
- 学生不可见：评分规则、正确答案、评分锚点、安全事件详情、未发布报告
- 学生仅可见：已发布的报告、自己的最终等级结果、已完成的学习进度

### 14.2 publication_status 模型

| 字段 | 位于 | 说明 |
|------|------|------|
| publication_status | result_record (新增列) | 'DRAFT' / 'PUBLISHED' / 'WITHDRAWN' |
| student_visible | result_record (新增列) | 计算字段：publication_status='PUBLISHED' AND NOT invalidated |
| published_at | result_record (新增列) | 发布时间 |
| published_by | result_record (新增列) | 发布人 |

```sql
ALTER TABLE result_record ADD COLUMN publication_status TEXT
  NOT NULL DEFAULT 'DRAFT'
  CHECK (publication_status IN ('DRAFT','PUBLISHED','WITHDRAWN'));
ALTER TABLE result_record ADD COLUMN student_visible INTEGER
  NOT NULL DEFAULT 0 CHECK (student_visible IN (0,1));
ALTER TABLE result_record ADD COLUMN published_at TEXT;
ALTER TABLE result_record ADD COLUMN published_by TEXT REFERENCES user_account(user_id);
```

### 14.3 可见性规则

| 数据 | 学生 Kiosk 可见 | 教师可见 | 条件 |
|------|----------------|----------|------|
| 自己的会话列表 | ✓ | ✓ | 仅显示自己的 |
| 会话当前状态 | ✓ | ✓ | — |
| 正在进行的题目内容 | ✓ | ✓ | 不含正确答案和评分规则 |
| 正确答案 / scoring_rule_json | ✗ | ✓ | — |
| 评分锚点 / rubric | ✗ | ✓ | — |
| 线下评分详情 | ✗ | ✓ | — |
| 教师观察原始记录 | ✗ | ✓ | — |
| 最终结果（已发布） | ✓ | ✓ | publication_status = 'PUBLISHED' |
| 最终结果（未发布） | ✗ | ✓ | — |
| 报告（已发布） | ✓ | ✓ | 需要教师审核发布 |
| 报告（未发布） | ✗ | ✓ | — |
| 安全事件详情 | ✗ | ✓ | 学生仅知道"测评已终止" |
| 学习进度 | ✓ | ✓ | — |
| 被 invalidation 的会话 | ✗ | ✓ | 不作为有效历史结果展示给学生 |

### 14.4 visibility_scope

```sql
ALTER TABLE task_report ADD COLUMN visibility_scope TEXT
  NOT NULL DEFAULT 'TEACHER_ONLY'
  CHECK (visibility_scope IN ('TEACHER_ONLY','STUDENT_VISIBLE','PUBLIC'));
```

- `TEACHER_ONLY`：仅教师/管理员可见（默认）
- `STUDENT_VISIBLE`：教师发布后学生可见
- `PUBLIC`：未来扩展（家长/机构可见）

### 14.5 SSE 频道过滤

教师 SSE 推送所有相关事件。Student Web Portal SSE（未来）仅推送白名单事件：
- `session.status_changed`（仅自己的会话）
- `result.published`（仅自己的结果）
- `report.published`（仅自己的报告）
- `learning.progress_updated`（仅自己的学习进度）

---

## 十五、视频和学习资源服务

### 15.1 asset_resource 模型（已存在于 v0.1.12，不修改）

保留原表。关键字段：`asset_id`, `asset_type`, `asset_role`, `app_uri`, `local_path`, `file_hash`, `file_size_bytes`, `duration_ms`, `status`。

### 15.2 资源访问方式

| 客户端 | 访问方式 | 认证 |
|--------|----------|------|
| Student Renderer | `app://asset/{asset_id}` 协议（Electron protocol handler） | 无需（renderer 内部协议） |
| Teacher Web | `GET /api/v1/assets/{asset_id}` | Cookie 认证 |
| Future Student Portal | `GET /api/v1/assets/{asset_id}` | Cookie 认证 + 权限检查 |

### 15.3 HTTP Range 和 ETag 支持

教师 Web / 未来学生门户通过 HTTPS 访问大型资源时：
- 支持 `Range` 请求头（视频断点续传）
- 返回 `ETag`（基于 file_hash）和 `Last-Modified`
- 支持 `If-None-Match` 条件请求（304 缓存）
- 缩略图：`GET /api/v1/assets/{asset_id}/thumbnail`

### 15.4 资源完整性

- 大型二进制文件不存入 SQLite（存储在 `{userData}/assets/` 目录）
- `asset_resource.file_hash` = SHA-256 of file content
- 启动时可选完整性校验：遍历 ACTIVE 资源验证 hash
- 校验失败 → 更新 status = 'CORRUPTED' + 写入 error_event_log

### 15.5 离线资源包

- 学习视频和素材以资源包形式预装在设备上
- 资源包 manifest：JSON 文件列出所有 asset_id + expected hash + 相对路径
- 安装时逐一验证 hash → 注册到 asset_resource 表
- 资源版本冻结：已被 ACTIVE question/learning_session 引用的资源不可删除或替换

### 15.6 学习任务与视频进度

通过 `learning_session` + `learning_progress` 表跟踪：
- 视频播放位置：`learning_progress.position_sec`
- 视频完成判定：`position_sec >= duration * 0.9`（90% 进度视为完成）
- 断点续播：恢复 learning_session 时读取 `last_position_sec`
- 学习时长统计：`learning_progress.duration_sec` 累计

### 15.7 资源服务约束

- 不将大型二进制存入 SQLite BLOB
- 不使用 CDN（局域网场景）
- 不使用流媒体协议（HLS/DASH）——直接 HTTP Range 即可满足局域网带宽
- 视频编码推荐 H.264 Baseline Profile（兼容一体机硬件解码）

---

## 十六、Finalization、纠错和报告版本

### 16.1 delivery_phase 与 Finalization 映射

| 阶段 | 触发条件 | 动作 |
|------|----------|------|
| OFFLINE_SCORING | 线上作答完成 → 教师开始线下评分 | 教师逐题提交 offline_score_record |
| OBSERVATION | 所有线下评分完成 + observation_template_id IS NOT NULL | 教师记录行为观察 |
| READY_TO_FINALIZE | 所有评分和观察完成 | 自动触发 CalculateResult |
| FINALIZED | CalculateResult 成功完成 | 生成 result_record + task_report |

### 16.2 CalculateResult 流程

1. 验证所有线下评分已提交且状态为 VALID
2. 计算原始分、归一化分、模块分
3. 调用 level-judge 确定等级（含安全覆盖检查）
4. INSERT result_record（publication_status = 'DRAFT'）
5. 生成报告 INSERT task_report（visibility_scope = 'TEACHER_ONLY'）
6. UPDATE assessment_session.status = 'COMPLETED'
7. UPDATE assessment_session.delivery_phase = 'FINALIZED'
8. COMMIT

### 16.3 FINALIZED 不可回退

- delivery_phase = 'FINALIZED' 后触发器阻止任何变更
- status = 'COMPLETED' 后终态保护触发器阻止变更
- 需要纠正错误时，使用 correction_record（不修改原始数据）

### 16.4 不新增 VOIDED session 终态

- assessment_session.status 终态仅限 COMPLETED / ABORTED / REDLINE_HALTED（v0.1.12 定义）
- 需要作废会话时使用 `session_invalidation_record`：
  - 记录作废原因和证据
  - 原始 session 状态保持不变（历史不可篡改）
  - 查询有效结果时排除已 invalidated 的会话

### 16.5 correction_record 使用场景

| 目标类型 | 场景 | 流程 |
|----------|------|------|
| OFFLINE_SCORE | 教师评分录入错误 | 将原 offline_score_record 标记 SUPERSEDED → INSERT 新记录 → INSERT correction_record → 重新 CalculateResult |
| RESULT | 系统计算错误 | 将原 result_record.is_current = 0 → INSERT 新 result_record → INSERT correction_record |
| REPORT | 报告内容错误 | 将原 task_report.status = 'SUPERSEDED' → INSERT 新 task_report → INSERT correction_record |

### 16.6 result supersession

- `result_record.is_current`：一个 source_aggregate_id + result_type 最多一个 is_current=1（唯一索引保证）
- 纠正时：旧记录 is_current=0，新记录 is_current=1
- 原始事实永久保留：旧记录不删除，仅标记非当前

### 16.7 报告版本管理

- 通过 task_report.status 管理版本：GENERATED → LOCKED → EXPORTED → SUPERSEDED
- 纠正后新报告的 status = 'GENERATED'，旧报告 status = 'SUPERSEDED'
- 报告发布：LOCKED 状态 + visibility_scope = 'STUDENT_VISIBLE' → 学生可见
- EXPORTED 需要 placement_review_by（人工确认后方可导出）

---

## 十七、备份恢复

### 17.1 备份方法

- 数据库：`VACUUM INTO` 或 SQLite Online Backup API（保证一致性快照）
- 备份期间所有写入暂停（BACKUP_FREEZE 模式）

### 17.2 备份包含内容

| 组件 | 说明 |
|------|------|
| SQLite DB | 通过 VACUUM INTO 创建的一致性副本 |
| 所有 JSONL 段 | 活跃段（截断到 cut point）+ 所有归档段 |
| segment_index.json | 段元数据索引 |
| Hash chain 数据 | 内嵌于 segment_index 的 last_batch_hash |
| Asset manifest | asset_resource 表的导出（JSON 格式） |
| 资源文件 | assets/ 目录下所有文件 |
| 节点配置 | config/node.json |
| CA 和叶子证书 | certs/ 目录（加密存储） |
| 运维表数据 | 内嵌于 SQLite DB 中 |
| 外部 manifest | backup-manifest.json（元数据 + 所有文件 SHA-256） |

### 17.3 备份协议（12 步）

```
1.  进入 BACKUP_FREEZE 模式（新命令排队等待）
2.  等待所有 in-flight batch 完成（CONFIRMED）
3.  冻结所有写入（心跳、session cleanup 也暂停）
4.  记录 cut point：
    - cut_batch_sequence = 最后 CONFIRMED 的 batch_sequence
    - cut_segment_id = 当前活跃段 ID
    - cut_segment_byte_offset = 当前活跃段字节位置
5.  VACUUM INTO staging/db.sqlite
6.  复制 JSONL：归档段完整复制，活跃段截断到 cut_segment_byte_offset
7.  复制 segment_index.json
8.  复制 asset-manifest.json + assets/
9.  复制 certs/（加密）+ config/
10. 计算所有文件 SHA-256，写入 backup-manifest.json
11. UPDATE backup_manifest 表（backup_status='COMPLETED'）
12. 退出 BACKUP_FREEZE 模式（释放排队的命令）
```

### 17.4 恢复协议（6 步）

```
1.  解析 backup-manifest.json，验证 schema 版本兼容性 + 所有文件 SHA-256
2.  复制到 staging 目录，对 DB 执行 PRAGMA integrity_check
3.  完整性检查：
    - projector_cursor 与 applied_event_batch 一致
    - JSONL 文件大小与 segment_index 记录匹配
    - Hash chain 从第一段到最后一段验证通过
    - Asset manifest 与 assets/ 文件匹配
4.  原子切换：
    a. 停止 Local Application Server
    b. 将当前数据目录重命名为 pre-restore-{timestamp}/
    c. 将 staging 目录重命名为正式数据目录
    d. 更新 pointer（见 17.6）
5.  重启 Server，执行 startupRecovery()
6.  恢复失败（任何步骤出错）→ 还原 pre-restore 目录 → 重启
```

### 17.5 Generation 目录结构

```
{userData}/
├── generations/
│   ├── gen-001/          # 历史 generation（恢复源）
│   │   ├── db.sqlite
│   │   ├── action_log.jsonl
│   │   ├── segments/
│   │   ├── segment_index.json
│   │   ├── assets/
│   │   ├── certs/
│   │   ├── config/
│   │   └── backup-manifest.json
│   ├── gen-002/          # 当前 generation
│   │   └── ...
│   └── staging/          # 恢复准备区（临时）
│       └── ...
├── current -> gen-002    # POSIX symlink
├── current.json          # Windows：{"generation": "gen-002", "switched_at": "..."}
└── backups/              # 备份输出目录
    └── backup-2026-07-14T08-00-00.tar.gz
```

### 17.6 Pointer 原子切换

**POSIX (Linux/macOS):**
```bash
ln -sf gen-002 current.tmp && mv current.tmp current
```
- `mv` 是 POSIX 原子操作（同一文件系统内）
- 切换失败 → current 仍指向旧 generation

**Windows:**
```json
// current.json（原子写入：先写 .tmp → rename 覆盖）
{"generation": "gen-002", "switched_at": "2026-07-14T08:00:00.000Z"}
```
- `rename` 在 NTFS 上是原子的（同一卷内）
- 先写入 `current.json.tmp` → `rename current.json.tmp current.json`

**禁止：**
- 不得先让 current 指向 staging，再移动 staging（会造成悬空指针）
- 不得逐个替换多个正式文件来声称原子恢复
- 不得只备份单个 action_log.jsonl
- 不得按 mtime 混合新旧资源

### 17.7 永久事件归档

- JSONL 段永不删除（即使已归档到外部存储也保留本地副本）
- 磁盘空间告警阈值：80%
- 告警不触发自动清理，需人工决策（移动到外部存储或扩容）

### 17.8 备份/恢复验收

| 验收用例 | 预期行为 |
|----------|----------|
| 正常备份 + 恢复 | generation 完整创建；hash 校验通过；JSONL 全段恢复；资源恢复；pointer 原子切换 |
| 恢复失败（hash 不匹配） | 保持旧 generation 不变；报告具体哪个文件 hash 失败 |
| Windows current.json 原子替换 | rename 成功 = 切换完成；rename 失败 = 旧 json 有效 |
| 从备份恢复后 startupRecovery | 正常完成：APPLIED→CONFIRMED, cursor 对齐 |
| 备份期间意外关机 | staging 不完整；下次启动忽略 staging 或清理 |

---

## 十八、闭环验收矩阵

### 18.1 Schema 和迁移

| # | 验收用例 | 正文章节 | DDL 位置 | 状态不变量 | 状态 |
|---|----------|----------|----------|-----------|------|
| M-01 | 从 v0.1.12 执行增量迁移，所有新表创建成功 | §6.7 | §6.3 | PRAGMA foreign_key_check 通过 | CLOSED |
| M-02 | 原有 48 个触发器全部保留且行为不变 | §6.6 | 不修改 | 终态保护仍有效 | CLOSED |
| M-03 | strategy_config 引用一致性仍有效 | §6.1 | 不修改 | 触发器验证 strategy_id+version 存在 | CLOSED |
| M-04 | 安全事件核心事实冻结仍有效 | §10.4 | 不修改 | CONFIRMED 后不可改核心字段 | CLOSED |
| M-05 | 报告保护仍有效（FULL_REPORT 需审核才能 EXPORTED） | §16.7 | 不修改 | 触发器 trg_task_report_placement_review_export | CLOSED |
| M-06 | delivery_phase 回填后 PRAGMA integrity_check 通过 | §6.8 | §7.7 | 所有值在 CHECK 枚举内 | CLOSED |
| M-07 | business_session 回填后 FK 检查通过 | §6.8 | §6.3 | student_id 引用存在 | CLOSED |

### 18.2 设备、授权和会话

| # | 验收用例 | 正文章节 | DDL 位置 | 状态不变量 | 状态 |
|---|----------|----------|----------|-----------|------|
| D-01 | 一台设备最多一个 ACTIVE runtime session | §3.5 | §6.3 T4 | ux_device_one_active_runtime | CLOSED |
| D-02 | 一台设备最多一个 ACTIVE Assignment | §5.4 | §6.3 T8 | ux_assignment_one_active_per_device | CLOSED |
| D-03 | 一个业务会话最多一个有效 Assignment | §5.4 | §6.3 T8 | ux_assignment_one_active_per_session | CLOSED |
| D-04 | Grant/Assignment/student/device/runtime 一致 | §5.4 | §5.1/§3.9 | App 层 + FK 约束 | CLOSED |
| D-05 | 设备重启后新 Grant 替代旧 Grant | §5.5 | §3.9 | replaces_grant_id 链接 | CLOSED |
| D-06 | 短暂断网不创建新 runtime | §3.5 | — | App 层心跳超时 2 分钟 | CLOSED |
| D-07 | 身份确认审计完整 | §5.6 | §3.9 | 6 个身份确认字段 | CLOSED |
| D-08 | LEARNING 会话可创建和恢复 | §4.4 | §6.3 T9/T10 | learning_session + learning_progress DDL | CLOSED |

### 18.3 JSONL 与命令

| # | 验收用例 | 正文章节 | DDL 位置 | 状态不变量 | 状态 |
|---|----------|----------|----------|-----------|------|
| J-01 | PREPARED 后旧 worker 失去租约 | §9.2 step 5 | §6.3 T11 | lease_generation 比较 | CLOSED |
| J-02 | 新 worker 只能接管同一 batch（不重新执行 Domain Handler） | §9.3 | — | BATCH_PREPARED fsync = PNR | CLOSED |
| J-03 | Hash 错误进入 CORRUPTION_DETECTED | §8.8 | — | 全局只读模式 | CLOSED |
| J-04 | APPLIED 未 CONFIRMED 可恢复 | §8.7 Phase 2 | §6.3 T12 | batch_status 状态机 | CLOSED |
| J-05 | PREPARED 未 APPLIED 可重放 | §8.7 Phase 3 | — | 幂等投影（processed_event 检查） | CLOSED |
| J-06 | 重复 event_id 不重复投影 | §8.4 Phase 2 | §6.3 T13 | processed_event PK 检查 | CLOSED |
| J-07 | Segment 轮转后仍可恢复 | §8.5 | §8.7 | segment_index 完整性 | CLOSED |
| J-08 | Command result 可恢复 | §8.7 Phase 4 | §6.3 T11 | event_batch_id → batch → result_json | CLOSED |

### 18.4 安全事件

| # | 验收用例 | 正文章节 | DDL 位置 | 状态不变量 | 状态 |
|---|----------|----------|----------|-----------|------|
| S-01 | 无开放会话可创建 | §10.4 #1 | 不修改 | 无 WHERE 阻止 INSERT | CLOSED |
| S-02 | assessment + training 同时开放时同时 halt | §10.2 T+40~45ms | 不修改 | 两个 AFTER INSERT 触发器 | CLOSED |
| S-03 | 每个会话只有一个 binding | §10.4 #5 | 不修改 | UNIQUE(incident_id, aggregate_type, aggregate_id) | CLOSED |
| S-04 | 每个会话只有一个当前安全结果 | §10.4 #6 | 不修改 | ux_result_record_one_current_per_source_type | CLOSED |
| S-05 | REDLINE_HALTED 不可逆 | §10.4 #11 | 不修改 | trg_assessment_session_no_terminal_status_change | CLOSED |
| S-06 | 普通报告被阻断，仅允许安全终止报告 | §10.4 #7 | 不修改 | trg_task_report_safety_termination | CLOSED |
| S-07 | VOID/RESOLVE 权限正确 | §10.3 | 不修改 | 触发器验证 ADMIN 角色 | CLOSED |

### 18.5 Web 和证书

| # | 验收用例 | 正文章节 | DDL 位置 | 状态不变量 | 状态 |
|---|----------|----------|----------|-----------|------|
| W-01 | CSRF token 三层防护 | §12.2 | — | 请求无 X-CSRF-Token → 403 | CLOSED |
| W-02 | Origin/Referer 校验 | §12.2 | — | 不匹配 → 403 | CLOSED |
| W-03 | SSE epoch 重启恢复 | §11.2 | — | epoch 不匹配 → resync_required | CLOSED |
| W-04 | 学生 Kiosk 不使用网络 SSE | §11.1 | — | Renderer 只用 IPC | CLOSED |
| W-05 | HTTP :7070 不暴露业务接口 | §13.7 | — | 仅 fingerprint + ca.crt | CLOSED |
| W-06 | HTTPS :7443 拒绝未认证请求 | §12.1 | — | 无有效 Cookie → 401 | CLOSED |
| W-07 | CA 安装人工验收（Windows/iPadOS/Android） | §13.5 | — | 带外指纹核对 | CLOSED |

### 18.6 备份恢复

| # | 验收用例 | 正文章节 | DDL 位置 | 状态不变量 | 状态 |
|---|----------|----------|----------|-----------|------|
| B-01 | Generation 完整创建 | §17.3 | §6.3 T15 | 所有组件 SHA-256 校验 | CLOSED |
| B-02 | Hash 校验 | §17.4 step 1 | — | 任一文件不匹配 → 中止恢复 | CLOSED |
| B-03 | JSONL 全段恢复 | §17.2 | — | 归档段 + 活跃段截断 | CLOSED |
| B-04 | 资源恢复 | §17.2 | — | asset manifest 完整 | CLOSED |
| B-05 | Pointer 原子切换 | §17.6 | — | symlink mv 或 rename 原子性 | CLOSED |
| B-06 | 恢复失败保持旧 generation | §17.4 step 6 | — | pre-restore 目录还原 | CLOSED |
| B-07 | Windows current.json 原子替换 | §17.6 | — | rename 语义 | CLOSED |
| B-08 | 从备份恢复后 startupRecovery 正常 | §17.4 step 5 | — | APPLIED→CONFIRMED, cursor 对齐 | CLOSED |

---

**文档结束**
