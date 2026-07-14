# 方案 B 多设备架构 v2.2 — 唯一权威实施基线

> **文档状态：** AUTHORITATIVE BASELINE — 唯一权威来源
> **生效日期：** 2026-07-14
> **正式 Schema 基线：** `src/main/db/schema.sql` v0.1.12-job-skill-assessment-mvp-closure（实测 20 表 / 48 触发器 / 73 索引）
> **正式 PRD 基线：** `doc/specs/MVP_PRD_v1.0.9-job-skill-assessment-mvp-closure.md`
> **技术栈：** Electron 33+ / Vue 3 / TypeScript 5 / SQLite 3.45+ (WAL) / better-sqlite3
> **范围：** 局域网多设备架构（学生触摸一体机 + 教师平板浏览器 + 未来学生自主 Web 门户）

## 0. 文档治理和基线声明

### 0.1 唯一权威声明

本文档是"炫灿·职途向导系统"方案 B 多设备架构的**唯一权威来源、自包含文档**。实施人员只需阅读以下三类文件即可实施：

1. 当前正式 Schema：`src/main/db/schema.sql`（v0.1.12-job-skill-assessment-mvp-closure）
2. 当前正式 PRD：`doc/specs/MVP_PRD_v1.0.9-job-skill-assessment-mvp-closure.md`
3. 本文档 v2.2

本文档不依赖任何旧架构文档；所有有效设计均已完整写入本文正文。

### 0.2 废止声明（SUPERSEDED）

以下文档在 v2.2 审查通过后全部标记为 `SUPERSEDED`，不再作为实施依据：

- `PRD_v1.0.6.md`（架构方案早期稿，非本系列）
- v1.0 方案 B 初稿
- `architecture-review-plan-b-multi-device-v1.1.md`
- `architecture-review-plan-b-multi-device-v1.2-consistency-closure.md`
- `architecture-plan-b-multi-device-v2.0-authoritative-baseline.md`
- `architecture-plan-b-multi-device-v2.0.1-schema-alignment.md`
- `architecture-plan-b-multi-device-v2.1-authoritative-baseline.md`（及其 coverage-matrix、validation-report）

系统中只存在一份具有 `AUTHORITATIVE BASELINE` 状态的多设备架构文档，即 v2.2。

### 0.3 本轮修订范围约束

本轮只修改/新增 v2.2 三份架构文档，**不修改**正式 Schema、业务代码、TypeScript 类型、测试代码、构建配置或依赖；不安装依赖；不自动执行正式迁移；不提交 Git commit（除非用户另行明确要求）。所有增量 DDL 是**迁移合同**，实施人员据此在后续正式迭代中修改 `schema.sql`。

### 0.4 正式实现事实 vs v2.2 目标合同

v2.2 严格区分"当前 v0.1.12 真实实现"与"v2.2 目标合同"。以下差异需要正式 Schema 迁移，**当前实现尚未满足**，不得声称现有代码/触发器已达成：

| 领域 | v0.1.12 真实实现 | v2.2 目标合同 |
|------|-----------------|--------------|
| 安全事件聚合键 | `student_id + task_code`（48 个触发器中 6 处 WHERE 实测，不含 job_code） | `student_id + job_code + task_code`（§13 迁移合同替换触发器） |
| 事件写入 | 单事件同步双写（`event-writer.ts` `writeEvent()`：appendFileSync 一行 JSONL + 同函数 INSERT `domain_event_projection`），随后调 reducer 写业务投影表，全包在 `db.transaction()` | 三段式 BATCH_PREPARED→APPLY→CONFIRM + hash chain + command_log fencing（§11、§12） |
| JSONL 结构 | 单文件 `action_log.jsonl`，`ActionLogEntry` 无 batch/segment/hash 字段 | segment 轮转 + segment_index + hash chain（§11） |
| 冷启动恢复 | 未实现（`initDatabase()` 只执行 schema + seed，不回读 JSONL） | startupRecovery 四阶段 + CORRUPTION_DETECTED（§11） |
| 线下评分草稿 | 仅 Vue 组件内存（`reactive`），提交才落 `offline_score_record` | 服务端 `offline_score_draft` 表（§18） |
| 多设备表 | 全部不存在（organization/node/device/… 仅在文档） | 19 张新表（§8） |
| 学习/视频 | 完全不存在 | learning_session + learning_progress（§6、§19） |
| Renderer 数据访问 | 已符合：纯 IPC（contextBridge + ipcRenderer.invoke），零 SQLite、零网络 | 保持不变，增加 asset 授权链（§19） |

### 0.5 不可推翻的架构方向

- 学生触摸一体机运行 Electron；教师通过同一局域网平板浏览器访问。
- Electron Main 负责窗口、Kiosk、utilityProcess 生命周期、证书和系统能力。
- Local Application Server 运行在 Electron `utilityProcess`。
- 教师端使用 HTTPS REST + SSE；学生 Kiosk Renderer 使用 IPC / MessagePort，不直接访问网络 API。
- 未来学生自主 Web 门户可用 HTTPS REST + SSE，但与学生 Kiosk 明确分离。
- SQLite 只允许 Local Application Server 单点访问；JSONL 保存领域事实，SQLite 保存领域投影和运行状态。
- HTTP 和 IPC 命令必须汇入同一 Application Service / Command Bus。
- 学生需要长期正式账户能力；支持测评、训练、学习、视频观看和历史记录。
- 不以"留待后续版本"为由删除长期核心能力（测评、训练、学习、视频、历史记录）。

---

## 目录

1. [完整拓扑与部署模式](#一完整拓扑与部署模式)
2. [进程和模块边界](#二进程和模块边界)
3. [organization/node/device/runtime/auth 身份模型](#三organizationnodedeviceruntimeauth-身份模型)
4. [student_profile / user_account 关系](#四student_profile--user_account-关系)
5. [Assessment、Training、Learning 三类会话](#五assessmenttraininglearning-三类会话)
6. [Assignment 与 Grant](#六assignment-与-grant)
7. [对正式 Schema 的完整增量设计](#七对正式-schema-的完整增量设计)
8. [完整迁移顺序和回滚](#八完整迁移顺序和回滚)
9. [delivery_phase 状态机](#九delivery_phase-状态机)
10. [JSONL–SQLite 事件协议](#十jsonlsqlite-事件协议)
11. [command_log 与 fencing](#十一command_log-与-fencing)
12. [安全事件](#十二安全事件)
13. [安全事件聚合键迁移合同](#十三安全事件聚合键迁移合同)
14. [REST/SSE/IPC 合同](#十四restsseipc-合同)
15. [Web 安全](#十五web-安全)
16. [HTTPS/CA/配对](#十六httpsca配对)
17. [学生可见性和 publication](#十七学生可见性和-publication)
18. [offline score draft / finalize](#十八offline-score-draft--finalize)
19. [asset / resource authorization](#十九asset--resource-authorization)
20. [Finalization、correction、report version](#二十finalizationcorrectionreport-version)
21. [backup / restore](#二十一backup--restore)
22. [状态不变量](#二十二状态不变量)
23. [自动化和人工验收矩阵](#二十三自动化和人工验收矩阵)

---

## 一、完整拓扑与部署模式

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

学生 Kiosk Renderer 绝不订阅网络 SSE，绝不直连 HTTPS 端口。系统不使用 WebSocket，不存在 WebSocket ticket 机制。

### 1.3 部署组件

| 组件 | 存储位置 | 职责 |
|------|----------|------|
| SQLite DB | `{userData}/data/xc-career-guide.db` | 领域投影 + 运维状态 |
| action_log.jsonl | `{userData}/data/action_log.jsonl`（活跃段） | 领域事实唯一来源 |
| JSONL 归档段 | `{userData}/data/segments/` | 已轮转的历史事件段 |
| segment_index.json | `{userData}/data/segment_index.json` | 段元数据索引 + hash chain 入口 |
| Asset Storage | `{userData}/assets/` | 视频、图片、音频等大型二进制资源 |
| Node CA + Leaf Cert | `{userData}/certs/` | ECDSA P-256 自签名 CA + 服务端叶子证书 |
| Node Config | `{userData}/config/node.json` | 节点标识、组织绑定、mDNS 配置 |
| Teacher Static SPA | bundled in app | 教师 Web 界面静态文件 |

### 1.4 mDNS 服务发现

- 服务类型：`_xccareer._tcp.local`
- 实例名：`{node_name}._xccareer._tcp.local`
- TXT 记录：`port=7443`, `fingerprint={ca_fingerprint_short}`, `version={app_version}`
- 教师平板通过 mDNS 自动发现局域网内的学生一体机。

### 1.5 演进路径

```
Phase 1 (当前): utilityProcess 内嵌于 Electron，单节点
Phase 2 (学校服务器): 抽出为独立 Node 服务，多节点同步
Phase 3 (中央平台): Node 服务 + PostgreSQL + 云部署，跨校区数据汇聚
```

organization/node/device 三层为 Phase 2/3 的多节点同步预留身份锚点，Phase 1 单节点单组织即可运行。

---

## 二、进程和模块边界

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
- Student Renderer 通过 `contextBridge` 暴露的 IPC API（`ipcRenderer.invoke`）与 Main 通信。当前实现已符合：`src/preload/index.ts` `contextBridge.exposeInMainWorld('api', api)`，每个方法为 `ipcRenderer.invoke('<channel>', params)`。
- Main 通过 `MessagePortMain`（utilityProcess 创建时传入）转发给 Server。
- Main 通过 `BrowserWindow.webContents.send()` 向 Student Renderer 推送事件（不使用 SSE / WebSocket）。
- Teacher 通过 Cookie 认证的 HTTPS REST + SSE 与 Server 通信。
- Student Renderer 禁止直接连接 HTTPS 端口。当前实现已符合：`src/renderer` 无 fetch/EventSource/WebSocket，CSP `connect-src 'self' app:`。

### 2.3 模块边界规则

1. **Electron Main 不承载业务领域逻辑**：只负责窗口、Kiosk、进程生命周期和系统能力。
2. **Local Server 不 import Electron API**：纯 Node.js 进程，未来可独立部署。
3. **Renderer 不直接访问 SQLite**：所有数据通过 IPC Handler 获取（当前实现已符合，`src/renderer` 零 better-sqlite3 引用）。
4. **HTTP 和 IPC 汇入同一 Command Bus**：教师 HTTP 请求和学生 IPC 请求统一进入 Command Bus，共享领域逻辑和幂等保证。
5. **唯一 SQLite 写入口**：只有 Local Server 内的 Event Writer + Projector 写 SQLite。
6. **Event Writer 单写者**：任何时刻最多一个 in-flight batch。
7. **native addon 打包约束**：`src/main/` 内引用本仓库模块必须使用静态 `import`，不用 `createRequire`、动态 `require()` 或动态路径加载本地 TS 模块。

### 2.4 当前实现的进程形态与目标形态差异

当前实现（v0.1.12）为**单进程 Electron Main + better-sqlite3 同步调用**：`initDatabase()`（`src/main/db/connection.ts`）直接 `new Database(dbPath)`，IPC handlers 在 Main 进程内直接读写数据库；`event-writer.ts` `writeEvent()` 同步双写 JSONL + `domain_event_projection`，随后调 reducer 写业务投影表。尚无 utilityProcess、HTTPS Server、Command Bus、MessagePort。

v2.2 目标形态为上述四进程架构。演进理由：

| 方案 | 结论 | 理由 |
|------|------|------|
| 同进程（当前） | Phase 1 可接受 | 单机单用户可用；但 Main 崩溃 = 全崩，同步 DB 调用阻塞事件循环，无法支撑多设备并发 |
| Worker Thread | ⚠️ | better-sqlite3 在 Electron 打包中 native addon 加载不稳定 |
| **utilityProcess** | ✅ 目标 | 崩溃隔离、独立 V8、native addon 正常加载、Main 可自动重启 |
| 独立 Node 子进程 | Phase 2 | 需打包 Node runtime，体积大 |

### 2.5 utilityProcess 崩溃与重启

1. Main 监听 utilityProcess `exit` 事件。
2. 非正常退出（code ≠ 0）：等待 2 秒后重启。
3. 重启后 Server 执行 `startupRecovery()`（见 §11.7）。
4. 重启期间 Student Renderer 显示"系统恢复中"蒙层（IPC 推送 `system:recovery-started`）。
5. 连续 3 次崩溃（5 分钟内）：进入安全模式，仅允许数据导出。

---

## 三、organization/node/device/runtime/auth 身份模型

### 3.1 实体层级关系

```
organization (学校/中心)
  └── node (一体机节点/服务器节点)
       └── device (物理设备)
            └── device_runtime_session (设备运行实例)
                 └── auth_session (用户认证会话)
                      └── delegated_access_grant (教师代理授权，绑定单个 business_session)
                           └── business_session_assignment (设备分配)

business_session (业务会话容器)
  ├── assessment_session (测评，business_session_id UNIQUE FK)
  ├── training_session (训练，business_session_id UNIQUE FK)
  └── learning_session (学习，business_session_id PK/FK)
```

Grant 通过 `business_session_id` 直接锚定业务会话（见 §6），不再是"学生+设备"长期通行证。

### 3.2 organization

安装时生成 UUID 作为 `organization_id`，在 seed 阶段写入；**禁止**使用固定全局字符串 `org_default` 作为长期同步标识（否则多节点汇聚时 ID 冲突）。

| 字段 | 类型 | 约束 |
|------|------|------|
| organization_id | TEXT | PK（安装时生成 UUID v4） |
| name | TEXT | NOT NULL |
| type | TEXT | NOT NULL DEFAULT 'SCHOOL' CHECK IN ('SCHOOL','CENTER','DISTRICT') |
| status | TEXT | NOT NULL DEFAULT 'ACTIVE' CHECK IN ('ACTIVE','DISABLED','ARCHIVED') |
| created_at | TEXT | NOT NULL DEFAULT datetime('now') |
| updated_at | TEXT | NOT NULL DEFAULT datetime('now') |

seed 示例（安装脚本执行，非固定值）：
```sql
-- 安装时由应用生成 UUID，例如 organization_id = '3f2b…（uuid v4）'
INSERT INTO organization (organization_id, name) VALUES (:generated_uuid, :school_name);
INSERT INTO node (node_id, organization_id, node_name) VALUES (:node_uuid, :generated_uuid, :node_name);
```

### 3.3 node

| 字段 | 类型 | 约束 |
|------|------|------|
| node_id | TEXT | PK |
| organization_id | TEXT | NOT NULL FK → organization |
| node_name | TEXT | NOT NULL（mDNS 实例名来源） |
| node_type | TEXT | NOT NULL DEFAULT 'ELECTRON_KIOSK' CHECK IN ('ELECTRON_KIOSK','STANDALONE_SERVER','CLOUD') |
| installed_at | TEXT | NOT NULL DEFAULT datetime('now') |
| app_version | TEXT | |
| schema_version | TEXT | |
| status | TEXT | NOT NULL DEFAULT 'ACTIVE' CHECK IN ('ACTIVE','DISABLED','DECOMMISSIONED') |
| created_at / updated_at | TEXT | NOT NULL DEFAULT datetime('now') |

### 3.4 device

| 字段 | 类型 | 约束 |
|------|------|------|
| device_id | TEXT | PK |
| node_id | TEXT | NOT NULL FK → node |
| device_name | TEXT | NOT NULL |
| device_role | TEXT | NOT NULL CHECK IN ('STUDENT_WORKSTATION','TEACHER_TABLET','ADMIN_TERMINAL','HYBRID') |
| credential_hash | TEXT | 设备级认证凭证哈希 |
| trust_state | TEXT | NOT NULL DEFAULT 'PENDING' CHECK IN ('PENDING','TRUSTED','REVOKED') |
| is_kiosk_enabled | INTEGER | NOT NULL DEFAULT 0 CHECK IN (0,1) |
| allows_self_login | INTEGER | NOT NULL DEFAULT 1 CHECK IN (0,1) |
| capabilities_json | TEXT | CHECK json_valid |
| last_heartbeat_at | TEXT | |
| status | TEXT | NOT NULL DEFAULT 'ACTIVE' CHECK IN ('ACTIVE','DISABLED','DECOMMISSIONED') |
| created_at / updated_at | TEXT | NOT NULL DEFAULT datetime('now') |

**信任状态机：** `PENDING → TRUSTED → REVOKED`

### 3.5 device_runtime_session

| 字段 | 类型 | 约束 |
|------|------|------|
| device_runtime_session_id | TEXT | PK |
| device_id | TEXT | NOT NULL FK → device |
| started_at | TEXT | NOT NULL DEFAULT datetime('now') |
| last_heartbeat_at | TEXT | NOT NULL DEFAULT datetime('now') |
| ended_at | TEXT | |
| end_reason | TEXT | CHECK IN (NULL,'HEARTBEAT_TIMEOUT','GRACEFUL_SHUTDOWN','ADMIN_TERMINATED','REPLACED') |
| client_version | TEXT | |
| status | TEXT | NOT NULL DEFAULT 'ACTIVE' CHECK IN ('ACTIVE','ENDED') |
| created_at | TEXT | NOT NULL DEFAULT datetime('now') |

**关键规则：**
- 每台设备最多一个 ACTIVE runtime session（唯一索引 `ux_device_one_active_runtime`）。
- 短暂断网（< 2 分钟心跳超时）不创建新 runtime session。
- 新 runtime session 仅在以下情况创建：进程重启、设备重启、教师显式结束、设备替换。

### 3.6 auth_session

| 字段 | 类型 | 约束 |
|------|------|------|
| auth_session_id | TEXT | PK |
| user_id | TEXT | NOT NULL FK → user_account |
| device_runtime_session_id | TEXT | FK → device_runtime_session（教师平板可为 NULL） |
| auth_method | TEXT | NOT NULL CHECK IN ('PASSWORD','DELEGATED','PIN','DEVICE_KEY') |
| granted_by | TEXT | FK → user_account（DELEGATED 时填写） |
| capabilities_json | TEXT | NOT NULL DEFAULT '[]' CHECK json_valid |
| token_hash | TEXT | NOT NULL UNIQUE |
| refresh_token_hash | TEXT | UNIQUE |
| issued_at | TEXT | NOT NULL DEFAULT datetime('now') |
| expires_at | TEXT | NOT NULL |
| last_activity_at | TEXT | NOT NULL DEFAULT datetime('now') |
| status | TEXT | NOT NULL DEFAULT 'ACTIVE' CHECK IN ('ACTIVE','EXPIRED','REVOKED') |
| revoke_reason | TEXT | |
| created_at / updated_at | TEXT | NOT NULL DEFAULT datetime('now') |

**状态机：** `ACTIVE → EXPIRED | REVOKED`

当前实现（v0.1.12）只有 `user_account` + `auth:login` IPC 通道（密码哈希校验），无 auth_session 表；v2.2 新增此表以支撑多设备令牌会话。

---

## 四、student_profile / user_account 关系

### 4.1 现状

正式 Schema 中 `user_account`（user_id PK, username, password_hash, role, display_name, status）与 `student_profile`（student_id PK, student_name, …）**分离，无 FK 关联**。所有业务聚合（assessment_session、training_session、safety_incident 等）使用 `student_id` FK → `student_profile`。

### 4.2 v2.2 增量：可选关联

新增 `student_profile.user_id`（nullable FK → user_account），支持学生长期正式账户能力，同时允许无账号的学生档案存在（教师代为建档场景）：

```sql
ALTER TABLE student_profile ADD COLUMN user_id TEXT
  REFERENCES user_account(user_id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_student_profile_user_id
  ON student_profile(user_id) WHERE user_id IS NOT NULL;
```

### 4.3 身份统一规则

- 所有业务聚合使用 `student_id` FK → `student_profile`。
- 登录认证使用 `user_id` FK → `user_account`。
- `student_profile.user_id` 可选关联，一个 user_account 最多关联一个 student_profile（部分唯一索引）。
- 禁止使用 student 与 user 拼接的混合标识符列（登录标识用 user_id，业务标识用 student_id，二者分列）。
- 多设备新增表统一 FK 到 `student_profile(student_id)`（涉及学生）或 `user_account(user_id)`（涉及登录者）。

---

## 五、Assessment、Training、Learning 三类会话

### 5.1 business_session（业务会话容器）

| 字段 | 类型 | 约束 |
|------|------|------|
| business_session_id | TEXT | PK |
| session_type | TEXT | NOT NULL CHECK IN ('ASSESSMENT','TRAINING','LEARNING') |
| student_id | TEXT | NOT NULL FK → student_profile |
| job_code | TEXT | NOT NULL |
| task_code | TEXT | NOT NULL CHECK length(trim)>0 |
| created_by | TEXT | NOT NULL FK → user_account |
| created_at / updated_at | TEXT | NOT NULL DEFAULT datetime('now') |

**无 status 列。** 业务会话的权威状态位于子表：
- ASSESSMENT → `assessment_session.status`
- TRAINING → `training_session.status`
- LEARNING → `learning_session.status`

`business_session` 携带 `job_code + task_code`，是安全事件聚合键 `student_id + job_code + task_code`（§13）在容器层的一致来源。

查询派生状态：
```sql
SELECT bs.business_session_id, bs.session_type,
  COALESCE(a.status, t.status, l.status) AS derived_status
FROM business_session bs
LEFT JOIN assessment_session a ON a.business_session_id = bs.business_session_id
LEFT JOIN training_session   t ON t.business_session_id = bs.business_session_id
LEFT JOIN learning_session   l ON l.business_session_id = bs.business_session_id
WHERE bs.student_id = ?;
```

### 5.2 数据库级父子一致性（问题 #3 关闭）

不依赖"ID 约定"，通过 FK + 触发器强制：

- `assessment_session.business_session_id` UNIQUE FK → business_session
- `training_session.business_session_id` UNIQUE FK → business_session
- `learning_session.business_session_id` PK/FK → business_session

一致性触发器（§7.5 完整 DDL，§8 迁移顺序）保证：
- business_session.session_type 与子表类型一致（ASSESSMENT↔assessment_session，禁止 ASSESSMENT 父表绑 training_session）。
- business_session.student_id 与子表.student_id 一致。
- 一个 business_session 只能对应一个正确类型的子会话（UNIQUE 索引）。
- 不允许孤立子会话绑定错误类型/学生的父会话。

### 5.3 assessment_session（正式已有表，增量扩展）

保留 v0.1.12 全部字段、所有索引、所有触发器不修改（终态保护、策略一致性、红线路径等）。新增列见 §7.2。

**状态机（v0.1.12 权威）：**
```
开放态: INIT → ACTIVE → EMOTION_INTERRUPTED → ACTIVE (恢复)
                     → SUSPENDED_REVIEW_REQUIRED → ACTIVE (恢复)
                     → OFFLINE_PENDING (线上完成)
终态: COMPLETED | ABORTED | REDLINE_HALTED
```
- 终态不可转出（触发器 `trg_assessment_session_no_terminal_status_change`）。
- 红线可从任一开放态进入 REDLINE_HALTED（触发器 `trg_assessment_session_explicit_redline_paths`）。
- REDLINE_HALTED 要求 `level_result = 'LEVEL_FAIL_BY_SAFETY'`（触发器强制）。
- 终态枚举**不新增 VOIDED**；作废走 `session_invalidation_record`（§20）。

### 5.4 training_session（正式已有表，增量扩展）

保留 v0.1.12 全部字段、索引和触发器。新增列见 §7.2（仅 business_session_id）。

**状态机（v0.1.12 权威）：**
```
开放态: INIT → ACTIVE → EMOTION_INTERRUPTED → ACTIVE
                     → SUSPENDED_REVIEW_REQUIRED → ACTIVE
终态: COMPLETED | ABORTED | REDLINE_HALTED
```
- 终态保护触发器 `trg_training_session_no_terminal_status_change`。
- 红线路径触发器 `trg_training_session_explicit_redline_paths`。
- 终态枚举**不新增 VOIDED**。

### 5.5 learning_session（新增，长期核心能力）

当前实现完全不存在学习/视频模型；v2.2 新增此表支撑视频学习、素材阅读、学习进度和历史记录。**learning_session 只用 `business_session_id` 作 PK+FK，不保留第二个可漂移的独立 ID。**

| 字段 | 类型 | 约束 |
|------|------|------|
| business_session_id | TEXT | PK, FK → business_session（唯一标识，无独立 learning_session_id） |
| student_id | TEXT | NOT NULL FK → student_profile |
| job_code | TEXT | NOT NULL |
| task_code | TEXT | NOT NULL CHECK length(trim)>0 |
| learning_type | TEXT | NOT NULL CHECK IN ('VIDEO_COURSE','MATERIAL_READING','MIXED') |
| status | TEXT | NOT NULL DEFAULT 'INIT' CHECK IN ('INIT','ACTIVE','PAUSED','COMPLETED','ABANDONED') |
| total_item_count | INTEGER | NOT NULL DEFAULT 0 CHECK >= 0 |
| completed_item_count | INTEGER | NOT NULL DEFAULT 0 CHECK >= 0 |
| total_duration_sec | INTEGER | NOT NULL DEFAULT 0 CHECK >= 0 |
| last_item_id | TEXT | 最后学习项目（断点续播） |
| last_position_sec | INTEGER | CHECK IS NULL OR >= 0 |
| started_at / completed_at | TEXT | |
| created_by | TEXT | NOT NULL FK → user_account |
| created_at / updated_at | TEXT | NOT NULL DEFAULT datetime('now') |
| （表级 CHECK） | | completed_item_count <= total_item_count |

**状态机：**
```
INIT → ACTIVE → PAUSED → ACTIVE (恢复)
                       → COMPLETED
             → COMPLETED
             → ABANDONED
```
- COMPLETED 和 ABANDONED 为终态。
- 学习会话不涉及评分和操作安全，不受安全红线影响。

### 5.6 learning_progress（新增）

| 字段 | 类型 | 约束 |
|------|------|------|
| progress_id | TEXT | PK |
| business_session_id | TEXT | NOT NULL FK → learning_session(business_session_id) |
| item_type | TEXT | NOT NULL CHECK IN ('VIDEO','DOCUMENT','INTERACTIVE') |
| item_id | TEXT | NOT NULL（关联 asset_resource） |
| item_order | INTEGER | NOT NULL CHECK >= 1 |
| status | TEXT | NOT NULL DEFAULT 'NOT_STARTED' CHECK IN ('NOT_STARTED','IN_PROGRESS','COMPLETED','SKIPPED') |
| duration_sec | INTEGER | NOT NULL DEFAULT 0 CHECK >= 0 |
| position_sec | INTEGER | CHECK IS NULL OR >= 0 |
| completed_at | TEXT | |
| created_at / updated_at | TEXT | NOT NULL DEFAULT datetime('now') |
| （唯一约束） | | UNIQUE (business_session_id, item_order) |

视频完成判定：`position_sec >= duration_ms/1000 * 0.9`（90% 进度视为完成）。断点续播读 `learning_session.last_position_sec`。

### 5.7 三类会话与安全事件的关系

| 会话类型 | 安全事件影响 | 红线终态 | 安全结果 |
|----------|-------------|----------|----------|
| assessment_session | 批量 halt 所有开放会话 | REDLINE_HALTED | LEVEL_FAIL_BY_SAFETY |
| training_session | 批量 halt 所有开放会话 | REDLINE_HALTED | 不生成训练结果 |
| learning_session | 不受影响 | 无 | 无 |

安全事件绑定范围：同一 `student_id + job_code + task_code` 下的所有开放 assessment 和 training 会话（§13）。

### 5.8 唯一权威状态位置

| 状态 | 权威位置 | 查询路径 |
|------|----------|----------|
| assessment 业务状态 | `assessment_session.status` | 直接查询 |
| assessment 交互阶段 | `assessment_session.delivery_phase` | 直接查询（辅助投影，§9） |
| training 业务状态 | `training_session.status` | 直接查询 |
| learning 业务状态 | `learning_session.status` | 直接查询 |
| 设备在线状态 | 内存（心跳计时器） | 不持久化，仅运行时 |

---

## 六、Assignment 与 Grant

### 6.1 Grant 语义（问题 #2 关闭）

Grant 采用可审计、最小权限、**按业务会话授权**的模型：

- 每个 Grant 绑定一个 `business_session_id`（FK）。
- Grant 不是学生+设备长期通行证；一个 Grant 不得跨不同业务会话复用。
- 一个有效（ACTIVE）Grant 最多对应一个当前 Assignment。
- `capabilities_json` 按该业务会话授予（ASSESS / TRAIN / LEARN 能力子集）。
- Grant 撤销只影响对应业务会话的 Assignment。
- Assignment 完成后 Grant 释放（RELEASED）。
- 设备重启后旧 Grant 过期（EXPIRED），创建新 Grant；新 Grant 用 `replaces_grant_id` 记录替代关系。

### 6.2 delegated_access_grant

| 字段 | 类型 | 约束 |
|------|------|------|
| grant_id | TEXT | PK |
| business_session_id | TEXT | NOT NULL FK → business_session |
| teacher_auth_session_id | TEXT | NOT NULL FK → auth_session |
| teacher_user_id | TEXT | NOT NULL FK → user_account |
| student_id | TEXT | NOT NULL FK → student_profile |
| device_id | TEXT | NOT NULL FK → device |
| device_runtime_session_id | TEXT | NOT NULL FK → device_runtime_session |
| capabilities_json | TEXT | NOT NULL CHECK json_valid |
| identity_confirmation_method | TEXT | CHECK IN (NULL,'PIN','TEACHER_ATTESTATION','PHOTO_MATCH','NONE_REQUIRED') |
| confirmed_by | TEXT | FK → user_account |
| confirmation_evidence | TEXT | CHECK json_valid |
| student_pin_verified | INTEGER | NOT NULL DEFAULT 0 CHECK IN (0,1) |
| teacher_attested | INTEGER | NOT NULL DEFAULT 0 CHECK IN (0,1) |
| confirmed_at | TEXT | |
| status | TEXT | NOT NULL DEFAULT 'ACTIVE' CHECK IN ('ACTIVE','RELEASED','EXPIRED','REVOKED') |
| replaces_grant_id | TEXT | FK → delegated_access_grant，CHECK <> grant_id |
| granted_at | TEXT | NOT NULL DEFAULT datetime('now') |
| released_at / release_reason | TEXT | |
| expires_at | TEXT | NOT NULL（默认 4 小时） |
| created_at / updated_at | TEXT | NOT NULL DEFAULT datetime('now') |

**状态机：** `ACTIVE → RELEASED | EXPIRED | REVOKED`

**唯一约束：**
```sql
-- 每个业务会话最多一个 ACTIVE grant
CREATE UNIQUE INDEX ux_grant_one_active_per_business_session
  ON delegated_access_grant(business_session_id) WHERE status = 'ACTIVE';
```

### 6.3 business_session_assignment

| 字段 | 类型 | 约束 |
|------|------|------|
| assignment_id | TEXT | PK |
| business_session_id | TEXT | NOT NULL FK → business_session |
| student_id | TEXT | NOT NULL FK → student_profile |
| device_id | TEXT | NOT NULL FK → device |
| grant_id | TEXT | NOT NULL FK → delegated_access_grant |
| assigned_by | TEXT | NOT NULL FK → user_account |
| assigned_at | TEXT | NOT NULL DEFAULT datetime('now') |
| student_confirmed_at | TEXT | |
| released_at | TEXT | |
| release_reason | TEXT | CHECK IN (NULL,'COMPLETED','TEACHER_RELEASED','DEVICE_OFFLINE','REPLACED','ADMIN_REVOKED') |
| replaces_assignment_id | TEXT | FK → business_session_assignment |
| version | INTEGER | NOT NULL DEFAULT 1 CHECK >= 1（乐观锁） |
| status | TEXT | NOT NULL DEFAULT 'PENDING_CONFIRM' CHECK IN ('PENDING_CONFIRM','ACTIVE','RELEASED','VOID') |
| created_at / updated_at | TEXT | NOT NULL DEFAULT datetime('now') |

**状态机：** `PENDING_CONFIRM → ACTIVE → RELEASED | VOID`

**唯一约束：**
```sql
-- 一个 grant 最多一个非终态 assignment（问题 #2: UNIQUE assignment.grant_id 活跃约束）
CREATE UNIQUE INDEX ux_assignment_one_active_per_grant
  ON business_session_assignment(grant_id) WHERE status IN ('PENDING_CONFIRM','ACTIVE');
-- 一个业务会话最多一个非终态 assignment
CREATE UNIQUE INDEX ux_assignment_one_active_per_session
  ON business_session_assignment(business_session_id) WHERE status IN ('PENDING_CONFIRM','ACTIVE');
-- 一台设备最多一个非终态 assignment
CREATE UNIQUE INDEX ux_assignment_one_active_per_device
  ON business_session_assignment(device_id) WHERE status IN ('PENDING_CONFIRM','ACTIVE');
```

### 6.4 FK 方向：单向（Assignment → Grant）

- `business_session_assignment.grant_id` FK → `delegated_access_grant.grant_id`。
- Grant 不反向引用 Assignment（无循环 FK）。
- INSERT 顺序：先创建 business_session → Grant → Assignment。

### 6.5 一致性约束（问题 #13.2：删除冗余漂移，用触发器强制）

`assignment` 与 `grant` 中重复保存的 student_id / device_id / business_session_id 通过**触发器**强制一致（SQLite CHECK 不能跨表查询，因此不写"App + CHECK"而不给 trigger）：

```sql
-- assignment.student_id / device_id / business_session_id 必须与其 grant 完全一致
-- 触发器 trg_assignment_grant_consistency_insert / _update（§7.5 完整 DDL）
```

| 约束 | 实施层 |
|------|--------|
| assignment.student_id/device_id/business_session_id = grant 对应字段 | 触发器 trg_assignment_grant_consistency_insert/update（跨表） |
| assignment.assigned_by = grant.teacher_user_id 或 ACTIVE ADMIN | 同上触发器（ADMIN 代分配例外） |
| 活动（PENDING_CONFIRM/ACTIVE）Assignment 不得引用非 ACTIVE Grant | 触发器 trg_assignment_active_requires_active_grant_insert/update（写入侧构造式强制） |
| Grant 自身 student/device-runtime/teacher-auth 一致且 auth ACTIVE 未过期 | 触发器 trg_grant_self_consistency_insert/update |
| 一个业务会话最多一个非终态 Assignment | 唯一索引 ux_assignment_one_active_per_session |
| 一台设备最多一个非终态 Assignment | 唯一索引 ux_assignment_one_active_per_device |
| 一个 Grant 最多一个非终态 Assignment | 唯一索引 ux_assignment_one_active_per_grant |
| 一个业务会话最多一个 ACTIVE Grant | 唯一索引 ux_grant_one_active_per_business_session |

**Grant 自身一致性（问题 #2，DDL 见 §7.5 D9）：** Grant 写入时触发器强制：
- `Grant.student_id = business_session.student_id`（经 business_session_id）；
- `Grant.device_runtime_session_id` 对应 runtime 的 `device_id = Grant.device_id`；
- `Grant.teacher_auth_session_id` 对应 auth 的 `user_id = Grant.teacher_user_id`，且该 auth_session `status='ACTIVE'` 且 `expires_at > now()`。

**"活动 Assignment 不得引用非 ACTIVE Grant"** 由写入侧构造式强制（§7.5 D11）：任何将 assignment 置为 PENDING_CONFIRM/ACTIVE 或改指 grant_id 的 INSERT/UPDATE，都要求目标 grant `status='ACTIVE'`，否则 RAISE(ABORT)。因此该不变量在任何已提交状态都成立，且无法被写出违例。不设"grant 去激活前必须无活动 assignment"的对称硬触发器——它会与"每业务会话最多一个 ACTIVE grant"死锁，令 in-place rebind 无法在单事务完成。

### 6.6 Grant Rebind 协议（设备重启/断网恢复，单事务）

Rebind 必须在**一个事务**内完成，顺序为 expire-old → create-new → repoint-assignment（该顺序避开"两个 ACTIVE grant"唯一索引冲突，且提交前修复瞬态）：

1. 设备发送 reconnect POST：携带新 `device_runtime_session_id` + 已知 `assignment_id`。
2. Server 查找非终态 assignment，检查关联 Grant 的 `device_runtime_session_id` 是否匹配；不匹配则进入 rebind。
3. 判断是否需要身份重新确认：
   - crash restart < 2 分钟 → 无需（`identity_confirmation_method = 'NONE_REQUIRED'`）；
   - graceful shutdown / reboot / replacement → 需要重新确认。
4. 单事务执行：

```sql
BEGIN;
-- (a) 旧 Grant → EXPIRED
UPDATE delegated_access_grant SET status='EXPIRED', released_at=datetime('now') WHERE grant_id=:old_grant;
-- (b) 创建新 Grant（绑定同一 business_session_id，replaces_grant_id 链接）
INSERT INTO delegated_access_grant (grant_id, business_session_id, teacher_auth_session_id, teacher_user_id,
  student_id, device_id, device_runtime_session_id, capabilities_json, expires_at, replaces_grant_id,
  identity_confirmation_method)
VALUES (:new_grant, :bs, :auth, :teacher, :student, :device, :new_runtime, :caps, :exp, :old_grant, :method);
-- (c) 当前 Assignment 改指新 Grant + version+1
UPDATE business_session_assignment
SET grant_id=:new_grant, version=version+1,
    status = CASE WHEN :need_reconfirm THEN 'PENDING_CONFIRM' ELSE status END,
    student_confirmed_at = CASE WHEN :need_reconfirm THEN NULL ELSE student_confirmed_at END,
    updated_at=datetime('now')
WHERE assignment_id=:assignment;
COMMIT;
```
   - 需要重新确认时：Assignment 改为 `PENDING_CONFIRM` 并清空 `student_confirmed_at`。
   - 不需要重新确认时：保持 `ACTIVE`。
5. 写 `GRANT_REBOUND` 事件（进入领域事件流）；提交后通过 SSE 通知教师。

**验收（§23.4 G-04~G-06）：** rebind 后 assignment.grant_id 指向新 grant、version+1、旧 grant EXPIRED 且 replaces 链接正确、活动 assignment 引用的 grant 为 ACTIVE；改指到非 ACTIVE grant 被拒。

### 6.7 身份确认审计字段

每个 Grant 携带完整身份确认审计：`identity_confirmation_method`、`confirmed_by`、`confirmation_evidence`（JSON）、`student_pin_verified`、`teacher_attested`、`confirmed_at`。首次分配必须确认；crash restart < 2 分钟可复用确认（NONE_REQUIRED）。

---

## 七、对正式 Schema 的完整增量设计

以下全部 DDL 已在真实 SQLite 3.50.6 上，先加载 `src/main/db/schema.sql` 再执行本增量，`PRAGMA foreign_key_check` 与 `PRAGMA integrity_check` 均通过（见 validation report）。

### 7.1 正式 Schema 保留的表（不修改，不重定义）

以下已有正式业务表保持 v0.1.12 原样，包括所有列、索引、触发器——只通过增量列、索引、触发器或触发器替换扩展，**不重新 CREATE**：

`schema_migration, user_account, student_profile, strategy_config, asset_resource, question_bank, domain_event_projection, assessment_session, assessment_session_question, answer_record, offline_score_record, training_session, training_step_record, safety_incident, safety_incident_binding, result_record, task_report, snapshot_meta, error_code_registry, error_event_log`

v0.1.12 的 48 个触发器中，**44 个原样保留、4 个替换**（§13 安全聚合键迁移先 DROP 再 CREATE 加入 job_code：trg_safety_incident_bind_open_assessments、trg_safety_incident_bind_open_trainings、trg_assessment_session_block_unresolved_safety_incident、trg_training_session_block_unresolved_safety_incident），并替换 2 个开放会话唯一索引。本增量另**新增 18 个触发器**（§7.5），迁移后触发器总数 48→66（实测 sqlite_master 加载）。

### 7.2 新增表完整 DDL（19 张）

新增表按 FK 依赖顺序：organization → node → device → device_runtime_session → auth_session → business_session → delegated_access_grant → business_session_assignment → learning_session → learning_progress → command_log → applied_event_batch → processed_event → projector_cursor → backup_manifest → session_invalidation_record → correction_record → offline_score_draft → pairing_challenge。

```sql
-- T1: organization（安装时生成 UUID，禁止固定 org_default）
CREATE TABLE IF NOT EXISTS organization (
  organization_id  TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  type             TEXT NOT NULL DEFAULT 'SCHOOL'
                    CHECK (type IN ('SCHOOL','CENTER','DISTRICT')),
  status           TEXT NOT NULL DEFAULT 'ACTIVE'
                    CHECK (status IN ('ACTIVE','DISABLED','ARCHIVED')),
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- T2: node
CREATE TABLE IF NOT EXISTS node (
  node_id          TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL REFERENCES organization(organization_id),
  node_name        TEXT NOT NULL,
  node_type        TEXT NOT NULL DEFAULT 'ELECTRON_KIOSK'
                    CHECK (node_type IN ('ELECTRON_KIOSK','STANDALONE_SERVER','CLOUD')),
  installed_at     TEXT NOT NULL DEFAULT (datetime('now')),
  app_version      TEXT,
  schema_version   TEXT,
  status           TEXT NOT NULL DEFAULT 'ACTIVE'
                    CHECK (status IN ('ACTIVE','DISABLED','DECOMMISSIONED')),
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
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
CREATE INDEX IF NOT EXISTS idx_auth_session_user_status ON auth_session(user_id, status);
CREATE INDEX IF NOT EXISTS idx_auth_session_token ON auth_session(token_hash);
```

```sql
-- T6: business_session（先于 grant/assignment/子会话，供 FK 引用）
CREATE TABLE IF NOT EXISTS business_session (
  business_session_id TEXT PRIMARY KEY,
  session_type        TEXT NOT NULL CHECK (session_type IN ('ASSESSMENT','TRAINING','LEARNING')),
  student_id          TEXT NOT NULL REFERENCES student_profile(student_id),
  job_code            TEXT NOT NULL,
  task_code           TEXT NOT NULL CHECK (length(trim(task_code)) > 0),
  created_by          TEXT NOT NULL REFERENCES user_account(user_id),
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_business_session_student
  ON business_session(student_id, session_type);
CREATE INDEX IF NOT EXISTS idx_business_session_student_job_task
  ON business_session(student_id, job_code, task_code);

-- T7: delegated_access_grant（按业务会话授予）
CREATE TABLE IF NOT EXISTS delegated_access_grant (
  grant_id                  TEXT PRIMARY KEY,
  business_session_id       TEXT NOT NULL REFERENCES business_session(business_session_id),
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
  student_pin_verified      INTEGER NOT NULL DEFAULT 0 CHECK (student_pin_verified IN (0,1)),
  teacher_attested          INTEGER NOT NULL DEFAULT 0 CHECK (teacher_attested IN (0,1)),
  confirmed_at              TEXT,
  status                    TEXT NOT NULL DEFAULT 'ACTIVE'
                             CHECK (status IN ('ACTIVE','RELEASED','EXPIRED','REVOKED')),
  replaces_grant_id         TEXT REFERENCES delegated_access_grant(grant_id),
  granted_at                TEXT NOT NULL DEFAULT (datetime('now')),
  released_at               TEXT,
  release_reason            TEXT,
  expires_at                TEXT NOT NULL,
  created_at                TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (replaces_grant_id IS NULL OR replaces_grant_id <> grant_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_grant_one_active_per_business_session
  ON delegated_access_grant(business_session_id) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_grant_student_device_status
  ON delegated_access_grant(student_id, device_id, status);

-- T8: business_session_assignment（单向 FK → grant）
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
  version             INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  status              TEXT NOT NULL DEFAULT 'PENDING_CONFIRM'
                       CHECK (status IN ('PENDING_CONFIRM','ACTIVE','RELEASED','VOID')),
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_assignment_one_active_per_grant
  ON business_session_assignment(grant_id) WHERE status IN ('PENDING_CONFIRM','ACTIVE');
CREATE UNIQUE INDEX IF NOT EXISTS ux_assignment_one_active_per_session
  ON business_session_assignment(business_session_id) WHERE status IN ('PENDING_CONFIRM','ACTIVE');
CREATE UNIQUE INDEX IF NOT EXISTS ux_assignment_one_active_per_device
  ON business_session_assignment(device_id) WHERE status IN ('PENDING_CONFIRM','ACTIVE');

-- T9: learning_session（business_session_id 作 PK+FK，无第二漂移 ID）
CREATE TABLE IF NOT EXISTS learning_session (
  business_session_id TEXT PRIMARY KEY REFERENCES business_session(business_session_id),
  student_id          TEXT NOT NULL REFERENCES student_profile(student_id),
  job_code            TEXT NOT NULL,
  task_code           TEXT NOT NULL CHECK (length(trim(task_code)) > 0),
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
  business_session_id TEXT NOT NULL REFERENCES learning_session(business_session_id),
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
  UNIQUE (business_session_id, item_order)
);
```

```sql
-- T11: command_log（混合基础设施表，恢复分类见 §11.9）
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
  current_lease_generation INTEGER NOT NULL DEFAULT 0,  -- 可变：命令当前 fencing 代次
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

-- T12: applied_event_batch（含 fencing 与 hash chain 字段）
CREATE TABLE IF NOT EXISTS applied_event_batch (
  batch_id            TEXT PRIMARY KEY,
  batch_sequence      INTEGER NOT NULL UNIQUE,
  segment_id          TEXT NOT NULL,
  command_id          TEXT,
  event_count         INTEGER NOT NULL CHECK (event_count >= 1),
  previous_batch_hash TEXT NOT NULL,
  events_hash         TEXT NOT NULL,
  batch_hash          TEXT NOT NULL,
  prepared_lease_generation INTEGER NOT NULL DEFAULT 0,  -- 不可变：PREPARE 时的 fencing 代次快照
  worker_id           TEXT,
  jsonl_offset_start  INTEGER NOT NULL,
  jsonl_offset_end    INTEGER NOT NULL,
  batch_status        TEXT NOT NULL DEFAULT 'APPLIED'
                       CHECK (batch_status IN ('APPLIED','CONFIRMED')),
  applied_at          TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_applied_event_batch_segment
  ON applied_event_batch(segment_id, batch_sequence);

-- T13: processed_event（幂等投影保护）
CREATE TABLE IF NOT EXISTS processed_event (
  event_id            TEXT PRIMARY KEY,
  batch_id            TEXT NOT NULL REFERENCES applied_event_batch(batch_id),
  event_type          TEXT NOT NULL,
  aggregate_type      TEXT NOT NULL,
  aggregate_id        TEXT NOT NULL,
  processed_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_processed_event_batch ON processed_event(batch_id);

-- T14: projector_cursor
CREATE TABLE IF NOT EXISTS projector_cursor (
  projector_name      TEXT PRIMARY KEY,
  last_batch_id       TEXT NOT NULL,
  last_batch_sequence INTEGER NOT NULL,
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- T15: backup_manifest（本机备份任务历史；外部 backup-manifest.json 是恢复包权威清单，§21）
CREATE TABLE IF NOT EXISTS backup_manifest (
  manifest_id         TEXT PRIMARY KEY,
  backup_status       TEXT NOT NULL DEFAULT 'PREPARING'
                       CHECK (backup_status IN ('PREPARING','COMPLETED','FAILED','CORRUPTED')),
  schema_version      TEXT NOT NULL,
  app_version         TEXT NOT NULL,
  node_id             TEXT NOT NULL REFERENCES node(node_id),
  cut_batch_sequence  INTEGER NOT NULL,
  cut_segment_id      TEXT NOT NULL,
  cut_segment_byte_offset INTEGER NOT NULL,
  cut_at              TEXT NOT NULL,
  database_sha256     TEXT,
  database_size_bytes INTEGER,
  segments_json       TEXT CHECK (segments_json IS NULL OR json_valid(segments_json)),
  assets_manifest_sha256 TEXT,
  external_manifest_path TEXT,
  started_at          TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at        TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- T16: session_invalidation_record（FK → business_session，避免多态裸 session_id）
CREATE TABLE IF NOT EXISTS session_invalidation_record (
  invalidation_id     TEXT PRIMARY KEY,
  business_session_id TEXT NOT NULL REFERENCES business_session(business_session_id),
  reason              TEXT NOT NULL CHECK (reason IN (
    'INTEGRITY_VIOLATION','PROCEDURE_ERROR','EQUIPMENT_FAILURE','ADMIN_OVERRIDE')),
  evidence_json       TEXT CHECK (evidence_json IS NULL OR json_valid(evidence_json)),
  invalidated_by      TEXT NOT NULL REFERENCES user_account(user_id),
  invalidated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  invalidation_event_id TEXT REFERENCES domain_event_projection(event_id),
  notes               TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_invalidation_per_business_session
  ON session_invalidation_record(business_session_id);

-- T17: correction_record（保留原始事实，不改终态 session）
CREATE TABLE IF NOT EXISTS correction_record (
  correction_id       TEXT PRIMARY KEY,
  target_type         TEXT NOT NULL CHECK (target_type IN ('OFFLINE_SCORE','RESULT','REPORT')),
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

-- T18: offline_score_draft（问题 #11：服务端草稿持久化；不重定义 offline_score_record）
CREATE TABLE IF NOT EXISTS offline_score_draft (
  draft_id            TEXT PRIMARY KEY,
  business_session_id TEXT NOT NULL REFERENCES business_session(business_session_id),
  question_id         TEXT REFERENCES question_bank(question_id),
  item_id             TEXT,
  score_scope         TEXT NOT NULL DEFAULT 'JOB_SKILL'
                       CHECK (score_scope IN ('OFFLINE_ABILITY','JOB_SKILL','TASK_OPERATION','TEACHER_OBSERVATION')),
  score_value         INTEGER CHECK (score_value IS NULL OR score_value IN (0,1,2)),
  note                TEXT,
  observation_payload_json TEXT CHECK (observation_payload_json IS NULL OR json_valid(observation_payload_json)),
  version             INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  status              TEXT NOT NULL DEFAULT 'OPEN'
                       CHECK (status IN ('OPEN','SUBMITTED','DISCARDED')),
  updated_by          TEXT NOT NULL REFERENCES user_account(user_id),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((question_id IS NOT NULL) <> (item_id IS NOT NULL))  -- 问题 #7: 恰好一个非空（XOR）
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_offline_score_draft_open_item
  ON offline_score_draft(business_session_id, score_scope, COALESCE(question_id, item_id))
  WHERE status = 'OPEN';

-- T19: pairing_challenge（带外配对挑战审计）
CREATE TABLE IF NOT EXISTS pairing_challenge (
  challenge_id        TEXT PRIMARY KEY,
  node_id             TEXT NOT NULL REFERENCES node(node_id),
  ca_fingerprint      TEXT NOT NULL,
  challenge_nonce     TEXT NOT NULL,
  issued_at           TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at          TEXT NOT NULL,
  consumed_at         TEXT,
  status              TEXT NOT NULL DEFAULT 'ISSUED'
                       CHECK (status IN ('ISSUED','CONSUMED','EXPIRED')),
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 7.2.1 pairing_challenge 采用说明

v2.0/v2.1 曾判定"配对无需持久化挑战"。v2.2 采用轻量 `pairing_challenge` 表持久化带外配对挑战（nonce + CA 指纹 + 过期），用于审计"何时向哪台设备下发过 CA 指纹、是否被消费"，避免重放。它不承载业务数据，与 §16 的 HTTP :7070 配对流程配合。

### 7.3 现有表增量列（ALTER TABLE，共 13 列）

```sql
-- B1. student_profile: 可选关联用户账号
ALTER TABLE student_profile ADD COLUMN user_id TEXT
  REFERENCES user_account(user_id) ON DELETE SET NULL;

-- B2. assessment_session: delivery_phase 初始允许 NULL（问题 #1：不直接 DEFAULT PREPARED）
ALTER TABLE assessment_session ADD COLUMN delivery_phase TEXT
  CHECK (delivery_phase IS NULL OR delivery_phase IN (
    'PREPARED','ASSIGNED','STUDENT_CONFIRMED','ONLINE_IN_PROGRESS',
    'ONLINE_COMPLETED','OFFLINE_SCORING','OBSERVATION',
    'READY_TO_FINALIZE','FINALIZED'));

-- B3. assessment_session: 乐观锁版本 + 观察模板引用 + business_session 链接
ALTER TABLE assessment_session ADD COLUMN event_sequence_version INTEGER DEFAULT 0
  CHECK (event_sequence_version IS NULL OR event_sequence_version >= 0);
ALTER TABLE assessment_session ADD COLUMN observation_template_id TEXT;
ALTER TABLE assessment_session ADD COLUMN business_session_id TEXT
  REFERENCES business_session(business_session_id);

-- B4. training_session: business_session 链接
ALTER TABLE training_session ADD COLUMN business_session_id TEXT
  REFERENCES business_session(business_session_id);

-- B5. safety_incident: 来源设备追踪
ALTER TABLE safety_incident ADD COLUMN source_device_id TEXT REFERENCES device(device_id);
ALTER TABLE safety_incident ADD COLUMN source_node_id TEXT REFERENCES node(node_id);
ALTER TABLE safety_incident ADD COLUMN command_id TEXT;

-- B6. result_record: 发布控制（问题 #10：不持久化 student_visible，查询派生 §17）
ALTER TABLE result_record ADD COLUMN publication_status TEXT
  NOT NULL DEFAULT 'DRAFT'
  CHECK (publication_status IN ('DRAFT','PUBLISHED','WITHDRAWN'));
ALTER TABLE result_record ADD COLUMN published_at TEXT;
ALTER TABLE result_record ADD COLUMN published_by TEXT REFERENCES user_account(user_id);
-- 问题 #5: 稳定 business_session_id，供 invalidation 可见性显式映射（不再比较 source_aggregate_id）
ALTER TABLE result_record ADD COLUMN business_session_id TEXT REFERENCES business_session(business_session_id);

-- B7. task_report: 可见性范围
ALTER TABLE task_report ADD COLUMN visibility_scope TEXT
  NOT NULL DEFAULT 'TEACHER_ONLY'
  CHECK (visibility_scope IN ('TEACHER_ONLY','STUDENT_VISIBLE','PUBLIC'));
```

> result_record 现共 4 个新增列：publication_status、published_at、published_by、business_session_id（唯一迁移点，本节一次性给出）。

> **注意（result_record / task_report 唯一迁移点）：** 上述 result_record 和 task_report 的 ALTER TABLE 只在本节（§7.3）出现一次可执行 SQL。§17（可见性语义）只解释语义，不重复 SQL。

### 7.4 现有表增量列的部分唯一索引

```sql
CREATE UNIQUE INDEX IF NOT EXISTS ux_student_profile_user_id
  ON student_profile(user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_assessment_business_session
  ON assessment_session(business_session_id) WHERE business_session_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_training_business_session
  ON training_session(business_session_id) WHERE business_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_assessment_session_delivery_phase
  ON assessment_session(delivery_phase) WHERE delivery_phase IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_result_record_business_session
  ON result_record(business_session_id);
```

### 7.5 新增触发器（18 个）

分三组：delivery_phase 守卫（D1–D4，5 个：forward_only + insert_prepared + frozen_on_abnormal + finalized_completed_consistency insert/update）、父子一致性（D5–D8，7 个：assessment/training/learning 各 insert+update + business_session_key_immutable）、Grant 自一致性与 assignment（D9–D11，6 个：grant_self insert/update + assignment_grant insert/update + assignment_active_requires_active_grant insert/update）。安全聚合键 4 个替换触发器见 §13。

**D1 delivery_phase 前向状态机**（完整 DDL 见 §9.4）。

**D2–D4 delivery_phase 守卫（问题 #6）：**

```sql
-- D2. 新会话 INSERT 只能从 PREPARED 开始（NULL 仅限迁移遗留，运行时 INSERT 不产生 NULL）
CREATE TRIGGER IF NOT EXISTS trg_assessment_delivery_phase_insert_prepared
BEFORE INSERT ON assessment_session
FOR EACH ROW WHEN NEW.delivery_phase IS NOT NULL AND NEW.delivery_phase <> 'PREPARED'
BEGIN SELECT RAISE(ABORT, 'new assessment_session delivery_phase must start at PREPARED'); END;

-- D3. REDLINE_HALTED/ABORTED 的 delivery_phase 不可事后修改
CREATE TRIGGER IF NOT EXISTS trg_assessment_delivery_phase_frozen_on_abnormal
BEFORE UPDATE OF delivery_phase ON assessment_session
FOR EACH ROW
WHEN OLD.status IN ('REDLINE_HALTED','ABORTED')
  AND ((OLD.delivery_phase IS NULL) <> (NEW.delivery_phase IS NULL) OR OLD.delivery_phase <> NEW.delivery_phase)
BEGIN SELECT RAISE(ABORT, 'delivery_phase of REDLINE_HALTED/ABORTED session is frozen'); END;

-- D4. FINALIZED ↔ COMPLETED 双向对应（INSERT + UPDATE）
CREATE TRIGGER IF NOT EXISTS trg_assessment_finalized_completed_consistency_insert
BEFORE INSERT ON assessment_session
FOR EACH ROW
WHEN (NEW.delivery_phase='FINALIZED' AND NEW.status<>'COMPLETED')
  OR (NEW.status='COMPLETED' AND NEW.delivery_phase IS NOT NULL AND NEW.delivery_phase<>'FINALIZED')
BEGIN SELECT RAISE(ABORT, 'FINALIZED must correspond to COMPLETED and vice versa'); END;

CREATE TRIGGER IF NOT EXISTS trg_assessment_finalized_completed_consistency_update
BEFORE UPDATE OF delivery_phase, status ON assessment_session
FOR EACH ROW
WHEN (NEW.delivery_phase='FINALIZED' AND NEW.status<>'COMPLETED')
  OR (NEW.status='COMPLETED' AND NEW.delivery_phase IS NOT NULL AND NEW.delivery_phase<>'FINALIZED')
BEGIN SELECT RAISE(ABORT, 'FINALIZED must correspond to COMPLETED and vice versa'); END;
```

> **CalculateResult 单条 UPDATE 要求：** 因 D4 双向对应，FINALIZE 时必须在同一条 UPDATE 中同时写 `status='COMPLETED'` 与 `delivery_phase='FINALIZED'`（不可拆两步，否则中间态违反 D4）。见 §20.1。

**D5–D8 父子一致性（问题 #3，四字段匹配 + NOT NULL + 父表不可变 + learning UPDATE）：**

```sql
-- D5. assessment：business_session_id NOT NULL + 四字段（type/student/job/task）匹配
CREATE TRIGGER IF NOT EXISTS trg_assessment_business_session_consistency_insert
BEFORE INSERT ON assessment_session
FOR EACH ROW
WHEN NEW.business_session_id IS NULL
  OR NOT EXISTS (SELECT 1 FROM business_session bs WHERE bs.business_session_id=NEW.business_session_id
    AND bs.session_type='ASSESSMENT' AND bs.student_id=NEW.student_id AND bs.job_code=NEW.job_code AND bs.task_code=NEW.task_code)
BEGIN SELECT RAISE(ABORT, 'assessment_session requires business_session_id matching ASSESSMENT type, student_id, job_code, task_code'); END;

CREATE TRIGGER IF NOT EXISTS trg_assessment_business_session_consistency_update
BEFORE UPDATE OF business_session_id, student_id, job_code, task_code ON assessment_session
FOR EACH ROW
WHEN NEW.business_session_id IS NULL
  OR NOT EXISTS (SELECT 1 FROM business_session bs WHERE bs.business_session_id=NEW.business_session_id
    AND bs.session_type='ASSESSMENT' AND bs.student_id=NEW.student_id AND bs.job_code=NEW.job_code AND bs.task_code=NEW.task_code)
BEGIN SELECT RAISE(ABORT, 'assessment_session requires business_session_id matching ASSESSMENT type, student_id, job_code, task_code'); END;

-- D6. training：同构（INSERT + UPDATE）
CREATE TRIGGER IF NOT EXISTS trg_training_business_session_consistency_insert
BEFORE INSERT ON training_session
FOR EACH ROW
WHEN NEW.business_session_id IS NULL
  OR NOT EXISTS (SELECT 1 FROM business_session bs WHERE bs.business_session_id=NEW.business_session_id
    AND bs.session_type='TRAINING' AND bs.student_id=NEW.student_id AND bs.job_code=NEW.job_code AND bs.task_code=NEW.task_code)
BEGIN SELECT RAISE(ABORT, 'training_session requires business_session_id matching TRAINING type, student_id, job_code, task_code'); END;

CREATE TRIGGER IF NOT EXISTS trg_training_business_session_consistency_update
BEFORE UPDATE OF business_session_id, student_id, job_code, task_code ON training_session
FOR EACH ROW
WHEN NEW.business_session_id IS NULL
  OR NOT EXISTS (SELECT 1 FROM business_session bs WHERE bs.business_session_id=NEW.business_session_id
    AND bs.session_type='TRAINING' AND bs.student_id=NEW.student_id AND bs.job_code=NEW.job_code AND bs.task_code=NEW.task_code)
BEGIN SELECT RAISE(ABORT, 'training_session requires business_session_id matching TRAINING type, student_id, job_code, task_code'); END;

-- D7. learning：INSERT + UPDATE 一致性
CREATE TRIGGER IF NOT EXISTS trg_learning_business_session_consistency_insert
BEFORE INSERT ON learning_session
FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM business_session bs WHERE bs.business_session_id=NEW.business_session_id
    AND bs.session_type='LEARNING' AND bs.student_id=NEW.student_id AND bs.job_code=NEW.job_code AND bs.task_code=NEW.task_code)
BEGIN SELECT RAISE(ABORT, 'learning_session requires business_session_id matching LEARNING type, student_id, job_code, task_code'); END;

CREATE TRIGGER IF NOT EXISTS trg_learning_business_session_consistency_update
BEFORE UPDATE OF business_session_id, student_id, job_code, task_code ON learning_session
FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM business_session bs WHERE bs.business_session_id=NEW.business_session_id
    AND bs.session_type='LEARNING' AND bs.student_id=NEW.student_id AND bs.job_code=NEW.job_code AND bs.task_code=NEW.task_code)
BEGIN SELECT RAISE(ABORT, 'learning_session requires business_session_id matching LEARNING type, student_id, job_code, task_code'); END;

-- D8. business_session 父表关键字段不可变（session_type/student_id/job_code/task_code）
CREATE TRIGGER IF NOT EXISTS trg_business_session_key_immutable
BEFORE UPDATE OF session_type, student_id, job_code, task_code ON business_session
FOR EACH ROW
WHEN OLD.session_type<>NEW.session_type OR OLD.student_id<>NEW.student_id
  OR OLD.job_code<>NEW.job_code OR OLD.task_code<>NEW.task_code
BEGIN SELECT RAISE(ABORT, 'business_session key fields (session_type/student_id/job_code/task_code) are immutable'); END;
```

**D9–D11 Grant 自一致性 + assignment（问题 #2）：**

```sql
-- D9. Grant 自一致性（INSERT + UPDATE）
CREATE TRIGGER IF NOT EXISTS trg_grant_self_consistency_insert
BEFORE INSERT ON delegated_access_grant
FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM business_session bs WHERE bs.business_session_id=NEW.business_session_id AND bs.student_id=NEW.student_id)
  OR NOT EXISTS (SELECT 1 FROM device_runtime_session drs WHERE drs.device_runtime_session_id=NEW.device_runtime_session_id AND drs.device_id=NEW.device_id)
  OR NOT EXISTS (SELECT 1 FROM auth_session au WHERE au.auth_session_id=NEW.teacher_auth_session_id AND au.user_id=NEW.teacher_user_id AND au.status='ACTIVE' AND au.expires_at > datetime('now'))
BEGIN SELECT RAISE(ABORT, 'grant self-consistency: student/business_session, device/runtime, teacher/auth must match and auth ACTIVE unexpired'); END;

CREATE TRIGGER IF NOT EXISTS trg_grant_self_consistency_update
BEFORE UPDATE OF business_session_id, student_id, device_id, device_runtime_session_id, teacher_auth_session_id, teacher_user_id ON delegated_access_grant
FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM business_session bs WHERE bs.business_session_id=NEW.business_session_id AND bs.student_id=NEW.student_id)
  OR NOT EXISTS (SELECT 1 FROM device_runtime_session drs WHERE drs.device_runtime_session_id=NEW.device_runtime_session_id AND drs.device_id=NEW.device_id)
  OR NOT EXISTS (SELECT 1 FROM auth_session au WHERE au.auth_session_id=NEW.teacher_auth_session_id AND au.user_id=NEW.teacher_user_id AND au.status='ACTIVE' AND au.expires_at > datetime('now'))
BEGIN SELECT RAISE(ABORT, 'grant self-consistency violation on update'); END;

-- D10. assignment ↔ grant 一致 + assigned_by 为 grant 教师或 ACTIVE ADMIN
CREATE TRIGGER IF NOT EXISTS trg_assignment_grant_consistency_insert
BEFORE INSERT ON business_session_assignment
FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM delegated_access_grant g WHERE g.grant_id=NEW.grant_id
    AND g.student_id=NEW.student_id AND g.device_id=NEW.device_id AND g.business_session_id=NEW.business_session_id)
  OR NOT (NEW.assigned_by=(SELECT teacher_user_id FROM delegated_access_grant WHERE grant_id=NEW.grant_id)
    OR EXISTS (SELECT 1 FROM user_account u WHERE u.user_id=NEW.assigned_by AND u.role='ADMIN' AND u.status='ACTIVE'))
BEGIN SELECT RAISE(ABORT, 'assignment must match grant (student/device/business_session) and assigned_by must be grant teacher or ACTIVE ADMIN'); END;

CREATE TRIGGER IF NOT EXISTS trg_assignment_grant_consistency_update
BEFORE UPDATE OF grant_id, student_id, device_id, business_session_id, assigned_by ON business_session_assignment
FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM delegated_access_grant g WHERE g.grant_id=NEW.grant_id
    AND g.student_id=NEW.student_id AND g.device_id=NEW.device_id AND g.business_session_id=NEW.business_session_id)
  OR NOT (NEW.assigned_by=(SELECT teacher_user_id FROM delegated_access_grant WHERE grant_id=NEW.grant_id)
    OR EXISTS (SELECT 1 FROM user_account u WHERE u.user_id=NEW.assigned_by AND u.role='ADMIN' AND u.status='ACTIVE'))
BEGIN SELECT RAISE(ABORT, 'assignment-grant consistency violation on update'); END;

-- D11. 活动 Assignment 不得引用非 ACTIVE Grant（写入侧构造式强制，问题 #1 验收）
CREATE TRIGGER IF NOT EXISTS trg_assignment_active_requires_active_grant_insert
BEFORE INSERT ON business_session_assignment
FOR EACH ROW
WHEN NEW.status IN ('PENDING_CONFIRM','ACTIVE')
  AND NOT EXISTS (SELECT 1 FROM delegated_access_grant g WHERE g.grant_id=NEW.grant_id AND g.status='ACTIVE')
BEGIN SELECT RAISE(ABORT, 'active assignment must reference an ACTIVE grant'); END;

CREATE TRIGGER IF NOT EXISTS trg_assignment_active_requires_active_grant_update
BEFORE UPDATE OF status, grant_id ON business_session_assignment
FOR EACH ROW
WHEN NEW.status IN ('PENDING_CONFIRM','ACTIVE')
  AND NOT EXISTS (SELECT 1 FROM delegated_access_grant g WHERE g.grant_id=NEW.grant_id AND g.status='ACTIVE')
BEGIN SELECT RAISE(ABORT, 'active assignment must reference an ACTIVE grant'); END;
```

> 不设"grant 去激活前必须无活动 assignment"的对称触发器（见 §6.5 说明）：它与 ux_grant_one_active_per_business_session 死锁，阻断 §6.6 in-place rebind。不变量由 D11 写入侧保证。

delivery_phase 前向状态机触发器见 §9.4。父子一致性与 assignment-grant 一致性触发器：

```sql
-- E1/E2/E3. business_session ↔ 子会话类型 + student_id 一致（问题 #3）
CREATE TRIGGER IF NOT EXISTS trg_assessment_business_session_consistency_insert
BEFORE INSERT ON assessment_session
FOR EACH ROW
WHEN NEW.business_session_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM business_session bs
    WHERE bs.business_session_id = NEW.business_session_id
      AND bs.session_type = 'ASSESSMENT' AND bs.student_id = NEW.student_id)
BEGIN
  SELECT RAISE(ABORT, 'assessment_session.business_session_id must be ASSESSMENT type with matching student_id');
END;

CREATE TRIGGER IF NOT EXISTS trg_assessment_business_session_consistency_update
BEFORE UPDATE OF business_session_id, student_id ON assessment_session
FOR EACH ROW
WHEN NEW.business_session_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM business_session bs
    WHERE bs.business_session_id = NEW.business_session_id
      AND bs.session_type = 'ASSESSMENT' AND bs.student_id = NEW.student_id)
BEGIN
  SELECT RAISE(ABORT, 'assessment_session.business_session_id must be ASSESSMENT type with matching student_id');
END;

CREATE TRIGGER IF NOT EXISTS trg_training_business_session_consistency_insert
BEFORE INSERT ON training_session
FOR EACH ROW
WHEN NEW.business_session_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM business_session bs
    WHERE bs.business_session_id = NEW.business_session_id
      AND bs.session_type = 'TRAINING' AND bs.student_id = NEW.student_id)
BEGIN
  SELECT RAISE(ABORT, 'training_session.business_session_id must be TRAINING type with matching student_id');
END;

CREATE TRIGGER IF NOT EXISTS trg_training_business_session_consistency_update
BEFORE UPDATE OF business_session_id, student_id ON training_session
FOR EACH ROW
WHEN NEW.business_session_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM business_session bs
    WHERE bs.business_session_id = NEW.business_session_id
      AND bs.session_type = 'TRAINING' AND bs.student_id = NEW.student_id)
BEGIN
  SELECT RAISE(ABORT, 'training_session.business_session_id must be TRAINING type with matching student_id');
END;

CREATE TRIGGER IF NOT EXISTS trg_learning_business_session_consistency_insert
BEFORE INSERT ON learning_session
FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM business_session bs
    WHERE bs.business_session_id = NEW.business_session_id
      AND bs.session_type = 'LEARNING' AND bs.student_id = NEW.student_id)
BEGIN
  SELECT RAISE(ABORT, 'learning_session.business_session_id must be LEARNING type with matching student_id');
END;

-- E4. assignment.student_id/device_id/business_session_id 必须与 grant 一致（问题 #13.2）
CREATE TRIGGER IF NOT EXISTS trg_assignment_grant_consistency_insert
BEFORE INSERT ON business_session_assignment
FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM delegated_access_grant g
    WHERE g.grant_id = NEW.grant_id AND g.student_id = NEW.student_id
      AND g.device_id = NEW.device_id AND g.business_session_id = NEW.business_session_id)
BEGIN
  SELECT RAISE(ABORT, 'assignment student_id/device_id/business_session_id must match its grant');
END;

CREATE TRIGGER IF NOT EXISTS trg_assignment_grant_consistency_update
BEFORE UPDATE OF grant_id, student_id, device_id, business_session_id ON business_session_assignment
FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM delegated_access_grant g
    WHERE g.grant_id = NEW.grant_id AND g.student_id = NEW.student_id
      AND g.device_id = NEW.device_id AND g.business_session_id = NEW.business_session_id)
BEGIN
  SELECT RAISE(ABORT, 'assignment student_id/device_id/business_session_id must match its grant');
END;
```

安全聚合键迁移触发器（DROP + CREATE 4 个 + 2 索引替换）见 §13。

---

## 八、完整迁移顺序和回滚

### 8.1 迁移顺序（严格按依赖 + 问题 #1 的 delivery_phase 顺序）

```
── 阶段 A：新增表（按 FK 依赖顺序）──
1.  CREATE TABLE organization
2.  CREATE TABLE node
3.  CREATE TABLE device
4.  CREATE TABLE device_runtime_session (+ ux_device_one_active_runtime)
5.  CREATE TABLE auth_session (+ 2 索引)
6.  CREATE TABLE business_session (+ 2 索引)
7.  CREATE TABLE delegated_access_grant (+ ux_grant_one_active_per_business_session + idx)
8.  CREATE TABLE business_session_assignment (+ 3 唯一索引)
9.  CREATE TABLE learning_session (+ idx)
10. CREATE TABLE learning_progress
11. CREATE TABLE command_log (+ ux_command_idempotency)
12. CREATE TABLE applied_event_batch (+ idx)
13. CREATE TABLE processed_event (+ idx)
14. CREATE TABLE projector_cursor
15. CREATE TABLE backup_manifest
16. CREATE TABLE session_invalidation_record (+ ux_invalidation_per_business_session)
17. CREATE TABLE correction_record (+ idx)
18. CREATE TABLE offline_score_draft (+ ux_offline_score_draft_open_item)
19. CREATE TABLE pairing_challenge

── 阶段 B：现有表增量列（delivery_phase 初始允许 NULL）──
20. ALTER student_profile ADD user_id (+ ux_student_profile_user_id)
21. ALTER assessment_session ADD delivery_phase（无 DEFAULT，允许 NULL）
22. ALTER assessment_session ADD event_sequence_version
23. ALTER assessment_session ADD observation_template_id
24. ALTER assessment_session ADD business_session_id (+ ux_assessment_business_session)
25. ALTER training_session ADD business_session_id (+ ux_training_business_session)
26. ALTER safety_incident ADD source_device_id / source_node_id / command_id
27. ALTER result_record ADD publication_status / published_at / published_by
28. ALTER task_report ADD visibility_scope
29. CREATE INDEX idx_assessment_session_delivery_phase

── 阶段 C：回填（在建前向触发器 + 安全键替换之前）──
30. business_session 回填（为每个 assessment/training 建父会话）
31. 回填 assessment_session.business_session_id / training_session.business_session_id
32. 回填 result_record.business_session_id（= source_aggregate_id，源子会话映射）
33. delivery_phase 回填（COMPLETED→FINALIZED；OFFLINE_PENDING→OFFLINE_SCORING；
    开放态→PREPARED；REDLINE_HALTED/ABORTED 保持 NULL）
34. 校验回填结果（见 §8.3）

── 阶段 D：新增触发器（回填后，共 18 个，§7.5）──
35. D1 trg_assessment_delivery_phase_forward_only（§9.4）
36. D2–D4 delivery_phase 守卫（insert_prepared / frozen_on_abnormal / finalized_completed_consistency ×2）
37. D5–D8 父子一致性（assessment/training/learning 各 insert+update + business_session key immutable）
38. D9–D11 grant 自一致性 + assignment-grant 一致性 + 活动 assignment 需 ACTIVE grant

── 阶段 E：安全聚合键迁移（问题 #8，§13）──
36. DROP + CREATE trg_safety_incident_bind_open_assessments（加 job_code）
37. DROP + CREATE trg_safety_incident_bind_open_trainings（加 job_code）
38. DROP + CREATE trg_assessment_session_block_unresolved_safety_incident（加 job_code）
39. DROP + CREATE trg_training_session_block_unresolved_safety_incident（加 job_code）
40. CREATE INDEX idx_safety_incident_student_job_task_status
41. DROP + CREATE ux_assessment_one_open_session_per_student_job_task_strategy（加 job_code）
42. DROP + CREATE ux_training_one_open_session_per_student_job_task（加 job_code）

── 阶段 F：收尾 ──
43. INSERT schema_migration ('2026-07-14_multi_device_v2_2', '0.1.12+multi-device-v2.2', …)
44. PRAGMA foreign_key_check
45. PRAGMA integrity_check
```

### 8.2 delivery_phase 迁移为何必须"先 NULL 再回填再建触发器"（问题 #1）

若像 v2.1 那样直接 `ADD COLUMN delivery_phase DEFAULT 'PREPARED'`，所有旧行（含 COMPLETED / REDLINE_HALTED / ABORTED）会先被写成 `PREPARED`，随后又受前向触发器限制无法推进到正确终态，且异常终止记录被错误标为可推进。v2.2 顺序：

1. 新增 `delivery_phase`，初始允许 NULL（无 DEFAULT）。
2. 回填旧数据（分状态精确赋值）。
3. 校验回填结果。
4. 创建完整前向状态触发器。
5. 新记录由应用层在 INSERT 时显式写入 `delivery_phase = 'PREPARED'`（应用层约定，见 §9.6），不依赖列 DEFAULT。

### 8.3 回填 SQL（已验证）

```sql
-- C1. business_session 回填（assessment_session/training_session 无 created_at 列，用 updated_at 近似）
INSERT INTO business_session (business_session_id, session_type, student_id, job_code, task_code, created_by, created_at)
  SELECT session_id, 'ASSESSMENT', student_id, job_code, task_code, created_by, updated_at
  FROM assessment_session
  WHERE session_id NOT IN (SELECT business_session_id FROM business_session);
INSERT INTO business_session (business_session_id, session_type, student_id, job_code, task_code, created_by, created_at)
  SELECT training_session_id, 'TRAINING', student_id, job_code, task_code, created_by, updated_at
  FROM training_session
  WHERE training_session_id NOT IN (SELECT business_session_id FROM business_session);

-- C2. business_session_id 自引用回填
UPDATE assessment_session SET business_session_id = session_id WHERE business_session_id IS NULL;
UPDATE training_session   SET business_session_id = training_session_id WHERE business_session_id IS NULL;

-- C3. delivery_phase 回填（问题 #1：只有正常 COMPLETED→FINALIZED；异常终止保持 NULL 不伪造）
UPDATE assessment_session SET delivery_phase = 'FINALIZED'
  WHERE status = 'COMPLETED' AND delivery_phase IS NULL;
UPDATE assessment_session SET delivery_phase = 'OFFLINE_SCORING'
  WHERE status = 'OFFLINE_PENDING' AND delivery_phase IS NULL;
UPDATE assessment_session SET delivery_phase = 'PREPARED'
  WHERE status IN ('INIT','ACTIVE','EMOTION_INTERRUPTED','SUSPENDED_REVIEW_REQUIRED')
    AND delivery_phase IS NULL;
-- REDLINE_HALTED / ABORTED: 保持 NULL。优先由事件日志重建中断前阶段；
-- 无法重建时保留 NULL 作为重建标记，绝不伪造 FINALIZED。
```

**回填校验（阶段 33）：**
```sql
-- 断言：无 COMPLETED 行残留 NULL
SELECT count(*) FROM assessment_session WHERE status='COMPLETED' AND delivery_phase IS NULL; -- 期望 0
-- 断言：无 REDLINE_HALTED/ABORTED 行被误写 FINALIZED
SELECT count(*) FROM assessment_session
  WHERE status IN ('REDLINE_HALTED','ABORTED') AND delivery_phase = 'FINALIZED';             -- 期望 0
-- 断言：所有子会话已有 business_session_id
SELECT count(*) FROM assessment_session WHERE business_session_id IS NULL;                    -- 期望 0
SELECT count(*) FROM training_session WHERE business_session_id IS NULL;                      -- 期望 0
```

### 8.4 REDLINE_HALTED / ABORTED 异常终止的事件日志重建

对异常终止的历史记录，优先根据 `domain_event_projection` / JSONL 事件序列恢复终止前的最后一个已知 delivery_phase：
- 若事件序列存在 `AnswerSubmitted`（线上进行中）→ 可推断 `ONLINE_IN_PROGRESS`。
- 若存在 `OFFLINE_SCORE_SUBMITTED` → 可推断 `OFFLINE_SCORING`。
- 无法确定时保留 NULL（重建标记），不伪造正常完成阶段。

### 8.5 回滚方案（顺序：先解现有表新增 FK 列 → 再删新增父表 → 最后恢复旧安全触发器/索引）

回滚顺序经临时库 forward→rollback→FK/integrity 实测通过（回到 base 20 表/48 触发器/73 索引）。关键：**必须先移除现有表上的新增 FK 列，再删除被引用的新增父表**，否则 DROP TABLE 会因悬空 FK 失败。

```
R1. DROP TRIGGER（本迁移在现有表上新增的 18 个触发器）
R2. DROP INDEX（现有表上的新增索引：ux_student_profile_user_id / ux_assessment_business_session /
    ux_training_business_session / idx_assessment_session_delivery_phase / idx_result_record_business_session）
R3. ALTER TABLE DROP COLUMN（先解现有表新增 FK 列，逆序）：
    result_record.business_session_id / published_by / published_at / publication_status；
    task_report.visibility_scope；
    safety_incident.command_id / source_node_id / source_device_id；
    assessment_session.business_session_id / observation_template_id / event_sequence_version / delivery_phase；
    training_session.business_session_id；student_profile.user_id
R4. DROP TABLE（19 张新表，逆 FK 依赖顺序：pairing_challenge → offline_score_draft → correction_record →
    session_invalidation_record → backup_manifest → projector_cursor → processed_event → applied_event_batch →
    command_log → learning_progress → learning_session → business_session_assignment → delegated_access_grant →
    business_session → auth_session → device_runtime_session → device → node → organization）
R5. 恢复 v0.1.12 安全触发器与唯一索引到 student_id+task_code 原定义：
    DROP 4 个 job_code 版触发器 + idx_safety_incident_student_job_task_status +
    ux_assessment_one_open_session_per_student_job_task_strategy + ux_training_one_open_session_per_student_job_task；
    CREATE 4 个 task_code 版触发器 + ux_assessment_one_open_session_per_student_task_strategy +
    ux_training_one_open_session_per_student_task；
    DELETE schema_migration WHERE migration_id='2026-07-14_multi_device_v2_2'
R6. PRAGMA foreign_key_check（空）+ PRAGMA integrity_check（ok）
```

SQLite 3.35.0+ 支持 `ALTER TABLE DROP COLUMN`（本环境 3.50.6）；若目标版本不支持，R3 改用 recreate-table 迁移。

### 8.6 迁移后强制检查

```sql
PRAGMA foreign_key_check;  -- 所有 FK 引用有效（期望空结果）
PRAGMA integrity_check;    -- 数据库结构完整（期望 'ok'）
```

### 8.7 表采用/不采用说明

§七"必须逐项核查"的清单在 v2.2 的处置：

| 表名 | 是否采用 | 说明 |
|------|----------|------|
| organization / node / device / device_runtime_session / auth_session | 采用 | §7.2 T1-T5 |
| delegated_access_grant / business_session / business_session_assignment | 采用 | §7.2 T6-T8 |
| learning_session / learning_progress | 采用 | §7.2 T9-T10 |
| offline_score_draft | 采用 | §7.2 T18，问题 #11 |
| command_log / applied_event_batch / processed_event / projector_cursor | 采用 | §7.2 T11-T14 |
| backup_manifest / session_invalidation_record / correction_record | 采用 | §7.2 T15-T17 |
| report_version 或等价结构 | **不单独建表** | 用 correction_record + task_report.status（GENERATED→SUPERSEDED）实现报告版本，见 §20 |
| pairing_challenge | 采用 | §7.2 T19，配对挑战审计 |

---

## 九、delivery_phase 状态机

### 9.1 完整枚举与拓扑

```
PREPARED → ASSIGNED → STUDENT_CONFIRMED → ONLINE_IN_PROGRESS
  → ONLINE_COMPLETED → OFFLINE_SCORING → OBSERVATION → READY_TO_FINALIZE → FINALIZED
                                        ↘ READY_TO_FINALIZE (observation_template_id IS NULL 时跳过 OBSERVATION)
```

### 9.2 所有合法迁移

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

跳过 OBSERVATION 条件：`observation_template_id IS NULL`（`OFFLINE_SCORING → READY_TO_FINALIZE`）。

### 9.3 所有非法跳转（触发器阻止）

- PREPARED → 除 ASSIGNED 外任何值（含 PREPARED → FINALIZED）
- ASSIGNED → 除 STUDENT_CONFIRMED 外任何值（含 ASSIGNED → OBSERVATION）
- STUDENT_CONFIRMED → 除 ONLINE_IN_PROGRESS 外任何值（含 STUDENT_CONFIRMED → PREPARED 回退）
- ONLINE_IN_PROGRESS → 除 ONLINE_COMPLETED 外任何值（含 ONLINE_IN_PROGRESS → READY_TO_FINALIZE）
- ONLINE_COMPLETED → 除 OFFLINE_SCORING 外任何值
- OFFLINE_SCORING → 除 OBSERVATION / READY_TO_FINALIZE 外任何值
- OBSERVATION → 除 READY_TO_FINALIZE 外任何值（禁止 OBSERVATION → FINALIZED）
- READY_TO_FINALIZE → 除 FINALIZED 外任何值
- FINALIZED → 任何值（终态不可变，禁止 FINALIZED → OBSERVATION）
- 任何序号回退

### 9.4 完整前向触发器（覆盖全部状态迁移，已验证）

```sql
CREATE TRIGGER IF NOT EXISTS trg_assessment_delivery_phase_forward_only
BEFORE UPDATE OF delivery_phase ON assessment_session
FOR EACH ROW
WHEN OLD.delivery_phase IS NOT NULL AND NEW.delivery_phase IS NOT NULL
  AND OLD.delivery_phase <> NEW.delivery_phase
BEGIN
  SELECT CASE
    WHEN OLD.delivery_phase = 'FINALIZED' THEN
      RAISE(ABORT, 'delivery_phase FINALIZED is terminal')
    WHEN OLD.delivery_phase = 'READY_TO_FINALIZE' AND NEW.delivery_phase <> 'FINALIZED' THEN
      RAISE(ABORT, 'READY_TO_FINALIZE can only advance to FINALIZED')
    WHEN OLD.delivery_phase = 'OBSERVATION' AND NEW.delivery_phase <> 'READY_TO_FINALIZE' THEN
      RAISE(ABORT, 'OBSERVATION can only advance to READY_TO_FINALIZE')
    WHEN OLD.delivery_phase = 'OFFLINE_SCORING'
      AND NEW.delivery_phase NOT IN ('OBSERVATION','READY_TO_FINALIZE') THEN
      RAISE(ABORT, 'OFFLINE_SCORING can only advance to OBSERVATION or READY_TO_FINALIZE')
    WHEN OLD.delivery_phase = 'ONLINE_COMPLETED' AND NEW.delivery_phase <> 'OFFLINE_SCORING' THEN
      RAISE(ABORT, 'ONLINE_COMPLETED can only advance to OFFLINE_SCORING')
    WHEN OLD.delivery_phase = 'ONLINE_IN_PROGRESS' AND NEW.delivery_phase <> 'ONLINE_COMPLETED' THEN
      RAISE(ABORT, 'ONLINE_IN_PROGRESS can only advance to ONLINE_COMPLETED')
    WHEN OLD.delivery_phase = 'STUDENT_CONFIRMED' AND NEW.delivery_phase <> 'ONLINE_IN_PROGRESS' THEN
      RAISE(ABORT, 'STUDENT_CONFIRMED can only advance to ONLINE_IN_PROGRESS')
    WHEN OLD.delivery_phase = 'ASSIGNED' AND NEW.delivery_phase <> 'STUDENT_CONFIRMED' THEN
      RAISE(ABORT, 'ASSIGNED can only advance to STUDENT_CONFIRMED')
    WHEN OLD.delivery_phase = 'PREPARED' AND NEW.delivery_phase <> 'ASSIGNED' THEN
      RAISE(ABORT, 'PREPARED can only advance to ASSIGNED')
  END;
END;
```

### 9.4.1 补充守卫（问题 #6，DDL 见 §7.5 D2–D4，已验证）

除前向状态机外，delivery_phase 另受三组守卫约束：

1. **INSERT 只能从 PREPARED 开始**（D2）：新会话 `delivery_phase` 若非空必须为 PREPARED；NULL 仅出现在迁移遗留的异常终止记录，运行时 INSERT 不产生 NULL。
2. **异常终止后冻结**（D3）：`status IN ('REDLINE_HALTED','ABORTED')` 的行，`delivery_phase` 不可再被修改（含 NULL↔非NULL）。
3. **FINALIZED ↔ COMPLETED 双向对应**（D4）：`delivery_phase='FINALIZED'` ⟺ `status='COMPLETED'`。迁移遗留的异常终止记录 `delivery_phase=NULL` 是唯一例外（其 status 非 COMPLETED，不触发对应约束）。

负向用例（§23.2 P-05~P-08，已验证 RAISE ABORT）：
- `INSERT delivery_phase='FINALIZED'`（且非 COMPLETED）→ 被拒；
- `INSERT status='COMPLETED' + delivery_phase='PREPARED'` → 被拒；
- `UPDATE delivery_phase='FINALIZED'` 但 status≠COMPLETED（NULL→FINALIZED、ACTIVE+FINALIZED）→ 被拒；
- ABORTED 后改 delivery_phase → 被拒。

### 9.5 与 assessment_session.status 的映射

| delivery_phase | 对应 session status |
|---------------|---------------------|
| PREPARED | INIT |
| ASSIGNED | INIT（已分配未确认） |
| STUDENT_CONFIRMED | INIT（已确认身份） |
| ONLINE_IN_PROGRESS | ACTIVE |
| ONLINE_COMPLETED | ACTIVE / OFFLINE_PENDING |
| OFFLINE_SCORING | OFFLINE_PENDING |
| OBSERVATION | OFFLINE_PENDING |
| READY_TO_FINALIZE | OFFLINE_PENDING |
| FINALIZED | COMPLETED |

`status` 是权威业务状态（含 EMOTION_INTERRUPTED 等中间态），`delivery_phase` 是多设备交互阶段的辅助投影。两者独立更新，受业务规则约束。

### 9.6 REDLINE_HALTED / ABORTED 与新记录初始化

- `status` 变为 REDLINE_HALTED 或 ABORTED 时，`delivery_phase` 保持当前值不变（不设为 FINALIZED）。REDLINE_HALTED / ABORTED ≠ 正常 FINALIZED。
- 查询历史必须区分：`delivery_phase='FINALIZED' AND status='COMPLETED'` → 正常完成；`status IN ('REDLINE_HALTED','ABORTED')` → 异常终止（delivery_phase 冻结在中断点或 NULL）。
- 新记录由应用层在 INSERT 时显式写 `delivery_phase='PREPARED'`（列本身无 DEFAULT，避免旧数据被误填，见 §8.2）。

### 9.7 delivery_phase 与 Finalization 映射

| 阶段 | 触发条件 | 动作 |
|------|----------|------|
| OFFLINE_SCORING | 线上作答完成 → 教师开始线下评分 | 教师逐题提交（先落 offline_score_draft，见 §18） |
| OBSERVATION | 所有线下评分完成 + observation_template_id IS NOT NULL | 教师记录行为观察 |
| READY_TO_FINALIZE | 所有评分和观察完成 | 触发 CalculateResult |
| FINALIZED | CalculateResult 成功 | 生成 result_record + task_report，同步 status=COMPLETED |

---

## 十、JSONL–SQLite 事件协议

### 10.1 核心原则

- **JSONL 是领域事实来源**：action_log.jsonl 只追加、不修改、不删除。
- **SQLite 是领域投影**：可从 JSONL 重建的表属于"可重建"类。
- **Event Writer 单写者**：任何时刻最多一个 in-flight batch。
- **禁止通用 UPSERT / `INSERT OR REPLACE` 作为领域投影策略**：投影必须精确匹配事件语义。

### 10.2 当前实现与目标协议差异

当前实现（`src/main/domain/event-writer.ts`）为**单事件同步双写**：`writeEvent()` appendFileSync 一行 JSONL + 同函数 INSERT `domain_event_projection`，调用方随后调 reducer（`applyAssessmentEvent` 等）写业务投影表，全包在 `db.transaction()`。`ActionLogEntry` 类型无 batch/segment/hash 字段；无冷启动重放。

v2.2 目标协议为下述**三段式 batch 协议 + hash chain + segment 轮转 + startupRecovery**。此为 Phase 2 演进目标，实施时替换 event-writer，本轮不改代码。

### 10.3 表分类（恢复方式）

| 类别 | 恢复方式 | 表 |
|------|----------|-----|
| **领域事实投影（可重建）** | 从 JSONL 重放重建 | assessment_session, training_session, learning_session, answer_record, offline_score_record, result_record, task_report, safety_incident, safety_incident_binding, training_step_record, domain_event_projection, learning_progress |
| **运维/基础设施（不可重建）** | 必须备份 | user_account, student_profile, strategy_config, question_bank, asset_resource, error_code_registry, error_event_log, snapshot_meta, schema_migration, organization, node, device, offline_score_draft |
| **事件溯源引导（自重建）** | JSONL 重放期间重建 | applied_event_batch, processed_event, projector_cursor；command_log 部分可重建（§11.9） |
| **仅运行时** | 无需恢复 | device_runtime_session (ACTIVE 部分), auth_session (ACTIVE 部分), pairing_challenge |

### 10.4 JSONL 记录类型

**BATCH_PREPARED**（完整 fencing 字段，问题 #5）：
```json
{
  "type": "BATCH_PREPARED",
  "batch_id": "batch_xxx",
  "batch_sequence": 42,
  "segment_id": "seg_001",
  "command_id": "cmd_yyy",
  "request_hash": "sha256:...",
  "prepared_lease_generation": 3,
  "worker_id": "worker_01",
  "event_count": 3,
  "previous_batch_hash": "sha256:...",
  "events_hash": "sha256:...",
  "batch_hash": "sha256:...",
  "timestamp": "2026-07-14T08:00:00.000Z"
}
```

**EVENT：**
```json
{
  "type": "EVENT",
  "batch_id": "batch_xxx",
  "event_id": "evt_zzz",
  "aggregate_type": "ASSESSMENT_SESSION",
  "aggregate_id": "session_abc",
  "event_type": "AnswerSubmitted",
  "event_sequence": 5,
  "payload": { },
  "checksum": "sha256:...",
  "actor_id": "user_001",
  "timestamp": "2026-07-14T08:00:00.100Z"
}
```

**BATCH_COMMITTED：**
```json
{ "type": "BATCH_COMMITTED", "batch_id": "batch_xxx", "batch_sequence": 42, "timestamp": "2026-07-14T08:00:00.200Z" }
```

### 10.5 唯一 JSONL hash 算法（问题 #6，已验证）

文档只存在**一套** batch_hash 定义。精确规范：

- **编码**：UTF-8。
- **JSON 规范化（canonical serialization）**：递归按对象 key 升序排序；无多余空白；数字/布尔/null 用 JSON 标准字面量；数组保持原序。
- **换行**：LF（`\n`）。
- **字段顺序**：由 canonical 排序确定，与源对象 key 顺序无关。
- **末尾 LF**：`events_hash` 的输入中，**每条事件的 canonical JSON 后都追加一个 LF**（含最后一条）。

```
event_bytes =
  canonical_json(EVENT_1) + LF +
  canonical_json(EVENT_2) + LF +
  ...
  canonical_json(EVENT_n) + LF        # 每条含末尾 LF

events_hash = SHA-256( UTF8(event_bytes) )                              # 64 hex

batch_hash  = SHA-256( UTF8(previous_batch_hash) || UTF8(events_hash) )  # 拼接两个十六进制字符串的 UTF-8 字节
```

- 第一个 batch 的 `previous_batch_hash` = 固定种子字符串 `"GENESIS"`。
- 三处必须记录一致的 `previous_batch_hash` / `events_hash` / `batch_hash`：JSONL 的 `BATCH_PREPARED`、SQLite 的 `applied_event_batch`、`segment_index.json` 的段边界。

参考实现（validation report 已执行 8 项测试全通过）：
```js
function canonicalJson(v){ if(v===null||typeof v!=='object')return JSON.stringify(v);
  if(Array.isArray(v))return '['+v.map(canonicalJson).join(',')+']';
  const k=Object.keys(v).sort(); return '{'+k.map(x=>JSON.stringify(x)+':'+canonicalJson(v[x])).join(',')+'}'; }
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const eventsHash = evs => sha256(Buffer.from(evs.map(e=>canonicalJson(e)+'\n').join(''),'utf-8'));
const batchHash  = (prev,eh) => sha256(Buffer.concat([Buffer.from(prev,'utf-8'),Buffer.from(eh,'utf-8')]));
```

### 10.6 Segment 轮转与 segment_index

- 活跃段大小超过 10 MB 或 10000 batches 时轮转：关闭当前段 → 创建新 `segment_id` → 更新 `segment_index.json`。
- 归档段永久保留（不删除）。
- `segment_index.json` 每段至少包含：`segment_id`、sequence range（first/last_batch_sequence）、`first_batch_hash`、`last_batch_hash`、`previous_segment_hash`、`segment_file_hash`（整段文件 SHA-256）。

```json
{
  "segments": [{
    "segment_id": "seg_001",
    "file_path": "segments/seg_001.jsonl",
    "first_batch_sequence": 1,
    "last_batch_sequence": 500,
    "first_batch_hash": "sha256:...",
    "last_batch_hash": "sha256:...",
    "previous_segment_hash": "GENESIS",
    "segment_file_hash": "sha256:...",
    "byte_size": 10485760,
    "sealed_at": "..."
  }]
}
```

### 10.7 三阶段写入协议

**Phase 1 PREPARE：** 获取单写者锁 → 分配 batch_sequence（全局单调递增）→ 生成 batch_id → 序列化事件 → 计算 events_hash / batch_hash（§10.5）→ 写 JSONL（BATCH_PREPARED + 所有 EVENT）→ `fsync` → 记录 jsonl_offset_start/end。

**Phase 2 APPLY（SQLite BEGIN IMMEDIATE）：** INSERT applied_event_batch（batch_status='APPLIED'，含 previous_batch_hash/events_hash/batch_hash/prepared_lease_generation/worker_id）→ 逐事件检查 processed_event（幂等）→ INSERT processed_event → 执行 projector 更新领域投影 → UPDATE projector_cursor → COMMIT。

**Phase 3 CONFIRM：** 写 JSONL BATCH_COMMITTED → `fsync` → UPDATE applied_event_batch SET batch_status='CONFIRMED', confirmed_at → 释放锁。

### 10.8 startupRecovery（四阶段）

**Phase 1 隔离不完整尾部：** 读活跃段尾部，检查最后 BATCH_PREPARED 是否完整（event_count 匹配 + batch_hash 可复算）；不完整则截断到最后一个完整 BATCH_PREPARED 或 BATCH_COMMITTED 边界。

**Phase 2 校验 APPLIED 未 CONFIRMED：** 查 SQLite `batch_status='APPLIED'` 批次 → 在 JSONL 找对应 BATCH_PREPARED → 验证 event_count + batch_hash 一致 → 一致则写 BATCH_COMMITTED 设 CONFIRMED；不一致进入 CORRUPTION_DETECTED。

**Phase 3 重放 PREPARED 未 APPLIED：** 找有 BATCH_PREPARED、无 BATCH_COMMITTED 且 SQLite 无记录的批次 → 执行 Phase 2 APPLY。

**Phase 4 推进 cursor + 恢复 command_log：** 对齐 projector_cursor 到最新 CONFIRMED batch；command_log 恢复见 §11.9。

### 10.9 CORRUPTION_DETECTED

hash 验证失败 → 设全局 `corruptionDetected=true` → 拒绝所有写入命令（503 + error_code CORRUPTION_DETECTED）→ 允许读 → 通过 SSE + IPC 通知所有客户端 → 需人工介入（恢复备份或修复 JSONL）。

### 10.10 日志归档

归档段永久保留（不自动删除）；磁盘超阈值（默认 80%）发告警不自动清理；归档段保留 hash chain 入口点以便验证。

---

## 十一、command_log 与 fencing

### 11.1 字段语义

| 字段 | 职责 |
|------|------|
| idempotency_key | 客户端生成的幂等键 |
| client_instance_id | 客户端实例标识（浏览器 tab / Electron 窗口） |
| request_hash | SHA-256(command_type + 规范化参数)，检测参数不同的重放 |
| event_batch_id | 预分配的事件批次 ID（命令注册时生成） |
| lease_owner | 当前持有租约的 worker 标识 |
| current_lease_generation | 命令**当前** fencing token（可变，单调递增；租约每次被接管 +1） |
| worker_id | 执行命令的 worker 实例标识 |
| lease_expires_at | 租约过期时间 |
| attempt_count | 累计尝试次数 |

**两个 generation 的区分（问题 #4）：**

| 字段 | 位置 | 可变性 | 语义 |
|------|------|--------|------|
| `command_log.current_lease_generation` | command_log | 可变，每次接管 +1 | 命令当前 fencing 代次 |
| `applied_event_batch.prepared_lease_generation` | applied_event_batch | **不可变** | PREPARE 那一刻的 fencing 代次快照，随 batch 永久固定 |

接管后 `prepared_lease_generation < current_lease_generation` 是**正常**的：旧 worker 在 PREPARE 后失去租约（generation 已被新 worker +1），新 worker 接管时看到 batch 的 prepared_generation 小于当前 generation，据此判定"batch 由更早的租约预留"，跳过 Domain Handler 直接接管 APPLY/CONFIRM。

### 11.2 幂等处理协议（7 步，问题 #4：租约获取用单条原子 UPDATE 避免 SELECT→UPDATE 竞争）

```
1. 计算 request_hash = SHA-256(command_type + normalized_params)
2. INSERT OR IGNORE INTO command_log (status='PENDING', current_lease_generation=0)
3. SELECT * WHERE client_instance_id=? AND idempotency_key=?
4. 按 status 分支：
   - SUCCEEDED → 直接返回 result_json（幂等响应）
   - FAILED    → attempt_count < max_attempts 且 request_hash 严格相等 → step 5
   - PROCESSING→ lease 未过期 → 409 CONFLICT；已过期 → step 5（接管）
   - PENDING   → step 5
5. 获取租约（单条原子 UPDATE，状态+过期校验都在同一 WHERE，避免 SELECT→UPDATE 竞争）：
   UPDATE command_log
     SET status='PROCESSING', lease_owner=:me, worker_id=:me,
         current_lease_generation = current_lease_generation + 1,
         lease_expires_at = datetime('now','+30 seconds'),
         attempt_count = attempt_count + 1, last_attempt_at = datetime('now')
   WHERE command_id = :cmd
     AND current_lease_generation = :seen_generation   -- fencing：旧 generation 无法更新
     AND status IN ('PENDING','FAILED','PROCESSING')
     AND (status <> 'PROCESSING' OR lease_expires_at <= datetime('now'));  -- 仅未过期 PROCESSING 拒绝
   -- 受影响行数 = 1 → 抢到租约；= 0 → 已被他人接管/未过期，放弃
6. 执行领域逻辑 + 写事件批次（JSONL PREPARE 时把当前 generation 快照为 batch.prepared_lease_generation
   → SQLite APPLY → CONFIRM）
7. 提交结果（同样用当前 generation 做 fencing）：
   UPDATE command_log SET status='SUCCEEDED', result_json=?, completed_at=datetime('now')
   WHERE command_id=? AND lease_owner=:me AND current_lease_generation=:my_generation
   -- WHERE 不匹配（租约已被接管）→ 不提交，让新 owner 完成
```

### 11.3 不可逆点（Point of No Return，问题 #5）

> **一旦完整 BATCH_PREPARED 已写入并 fsync 到 JSONL，该命令进入不可重新执行点。新 worker 不得重新运行 Domain Handler，只能接管同一预留 batch 的 APPLY、CONFIRM 和 command result 恢复。**

- 完整 BATCH_PREPARED 必须包含全部 fencing 字段（§10.4）：batch_id、batch_sequence、segment_id、command_id、request_hash、prepared_lease_generation、worker_id、event_count、previous_batch_hash、events_hash、batch_hash、timestamp。
- 新 worker 检测到已有 BATCH_PREPARED → 跳过 Domain Handler → 直接 APPLY + CONFIRM。

**恢复时必须验证（command_id / batch_id / request_hash 严格相等；generation 允许 prepared < current）：**
```
JSONL.command_id            == command_log.command_id                （严格相等）
JSONL.batch_id              == command_log.event_batch_id            （严格相等）
JSONL.request_hash          == command_log.request_hash              （严格相等）
JSONL.prepared_lease_generation <= command_log.current_lease_generation
    （接管后 prepared < current 属正常；prepared > current 视为不一致 → CORRUPTION_DETECTED）
```
三项严格相等中任一不符 → CORRUPTION_DETECTED；generation 关系违反（prepared > current）→ CORRUPTION_DETECTED。

### 11.4 租约续约

- 长命令主动续约：`UPDATE lease_expires_at = datetime('now','+30 seconds') WHERE command_id=? AND lease_owner=:me AND current_lease_generation=:my_generation`。
- 续约失败（generation 不匹配或行数=0）→ 当前 worker 立即放弃。
- 默认租约 30 秒，续约间隔 10 秒。

### 11.5 崩溃窗口矩阵

| 崩溃时机 | JSONL 状态 | SQLite 状态 | 恢复动作 |
|----------|-----------|-------------|----------|
| step 5 后、step 6 前 | 无 batch | command PROCESSING | 租约过期后新 worker 重新执行 Domain Handler |
| JSONL 写入中途 | 不完整 BATCH_PREPARED | command PROCESSING | 截断不完整字节；重置 command 为 PENDING |
| BATCH_PREPARED fsync 后、APPLY 前 | 完整 BATCH_PREPARED | 无 applied_event_batch | 新 worker 接管：跳过 Domain Handler，APPLY + CONFIRM（不可逆点后） |
| APPLY 事务中途 | 完整 BATCH_PREPARED | 事务回滚（SQLite 自动） | 重放 APPLY |
| APPLY COMMIT 后、CONFIRM 前 | BATCH_PREPARED（无 COMMITTED） | applied_event_batch APPLIED | startupRecovery Phase 2：写 COMMITTED，设 CONFIRMED |
| CONFIRM 后、result 更新前 | BATCH_COMMITTED | CONFIRMED，command PROCESSING | startupRecovery Phase 4：从 batch 恢复 result_json |
| result 更新后 | BATCH_COMMITTED | CONFIRMED + SUCCEEDED | 无需恢复 |

### 11.6 核心不变量

1. `(client_instance_id, idempotency_key)` 全局唯一（ux_command_idempotency）。
2. 同一 command_id 的 current_lease_generation 只增不减；batch 的 prepared_lease_generation 一经写入不可变。
3. 一旦 BATCH_PREPARED fsync，任何 worker 不得重新执行 Domain Handler。
4. lease_expires_at 过期的 PROCESSING 命令可被任何 worker 接管。
5. status=SUCCEEDED 后 result_json 不可变。
6. event_batch_id 在命令注册时预分配，batch 创建时使用该 ID。

### 11.7 startupRecovery 与 command_log 的衔接

startupRecovery Phase 4：查 `command_log` 中 status='PROCESSING' 的命令；若其 event_batch_id 对应 batch 已 CONFIRMED → 从 batch 恢复 result_json 并设 SUCCEEDED；若 batch 不存在（未过不可逆点）→ 重置为 PENDING（允许重试）。

### 11.8 command_log 是混合基础设施表（不是完整领域投影表）

command_log 不属于"可从当前 JSONL 完整自动重建"的表。它是混合基础设施表：一部分可从 JSONL 恢复，一部分必须从 SQLite 备份恢复。

### 11.9 command_log 恢复分类（问题 #7）

**可从 JSONL 恢复的部分：**
- command_id（BATCH_PREPARED.command_id）
- event_batch_id（= BATCH_PREPARED.batch_id）
- request_hash（BATCH_PREPARED.request_hash）
- batch 是否 PREPARED / APPLIED / CONFIRMED（JSONL + applied_event_batch）
- 领域结果是否已投影（processed_event / 投影表）

**必须从 SQLite 备份恢复的部分（JSONL 中不存在）：**
- idempotency_key
- client_instance_id
- lease_owner
- lease_expires_at
- attempt_count
- result_json（HTTP 响应体）
- error_message / error_code
- HTTP 响应相关信息（status、completed_at）

因此：不得声称完整 command_log 可由当前 JSONL 自动重建；崩溃恢复时，JSONL 可恢复命令的领域侧事实与执行进度，但幂等键、租约、结果体等基础设施字段依赖 SQLite 备份。

---

## 十二、安全事件

### 12.1 权威实现基线

以 `src/main/db/schema.sql` v0.1.12 的实际触发器为基线，安全事件批量 halt 由 **SQLite AFTER INSERT 触发器**确定性执行：

- `trg_safety_incident_bind_open_assessments`：INSERT safety_incident 时，自动将同聚合键的所有开放 assessment_session 设为 REDLINE_HALTED + level_result='LEVEL_FAIL_BY_SAFETY' + report_type='SAFETY_TERMINATION_REPORT'，并创建 safety_incident_binding。
- `trg_safety_incident_bind_open_trainings`：同理处理开放 training_session。

**分工：**
| 层 | 职责 |
|----|------|
| SQLite AFTER INSERT 触发器 | 批量 halt 所有开放会话 + 创建 binding + 写安全结果字段 |
| 应用层 Event Writer | 生成 SafetyIncidentCreated 事件 → INSERT safety_incident（触发 trigger） |
| 领域触发器（非 AFTER INSERT） | 强制约束：终态不可变、核心事实冻结、状态迁移合法性、role 校验 |

### 12.2 SafetyIncidentCreated 是唯一权威命令事件（问题 #9）

保留 `SafetyIncidentCreated`（对应 REDLINE_TRIGGERED 事件类型）作为唯一权威命令事件。由于正式 Schema 的 trigger 会确定性完成 assessment halt、training halt、binding、safety result，这些副作用视为**该事件的确定性 SQLite 投影**。

**禁止**在 APPLY 阶段再生成未进入原 BATCH_PREPARED 的领域事件：
- 不生成独立的 `AssessmentRedlineHalted`
- 不生成独立的 `TrainingRedlineHalted`
- 不生成独立的 `RedlineTriggered`（作为 halt 的追加领域事件）

提交后可以发送：SSE 通知、IPC 通知、非领域持久化通知、或不参与状态投影的审计结果。这些不进入 JSONL 领域事件流。

本文档不含任何 `T+5ms` / `T+20ms` / `T+100ms` 之类无依据时延承诺。安全事件的顺序由"BATCH_PREPARED → APPLY（trigger 确定性执行）→ CONFIRM → 提交后通知"这一因果次序保证，不承诺绝对毫秒时延。

### 12.3 SafetyIncidentCreated 因果时序（无时延承诺）

```
教师/管理员发起 POST /api/v1/safety-incidents（或 IPC triggerRedline）
→ Auth Gate 验证 TEACHER/ADMIN 角色
→ Command Bus 注册命令（idempotency 检查）
→ Domain Handler 构造 SafetyIncidentCreated payload
→ Event Writer: JSONL BATCH_PREPARED（含 SafetyIncidentCreated）+ fsync（不可逆点）
→ SQLite BEGIN IMMEDIATE
   → INSERT safety_incident (status='PENDING_DETAIL')
   → [自动] trg_safety_incident_bind_open_assessments：
       halt 同 student_id+job_code+task_code 的所有开放 assessment + 写 binding
   → [自动] trg_safety_incident_bind_open_trainings：同理处理 training
   → INSERT processed_event
   → UPDATE projector_cursor
   → COMMIT
→ JSONL BATCH_COMMITTED + fsync
→ UPDATE command_log status='SUCCEEDED'
→ 提交后通知：SSE 推送教师平板；IPC 推送学生 Renderer（非领域事件）
→ HTTP 201 响应
```

### 12.4 安全事件状态机

```
PENDING_DETAIL → CONFIRMED → RESOLVED
                           → VOIDED
PENDING_DETAIL → VOIDED
```
（VOIDED 仅用于安全事件状态机；assessment/training session 终态不含 VOIDED。）

| 迁移 | 要求 |
|------|------|
| PENDING_DETAIL → CONFIRMED | confirmed_by 必须为 ACTIVE TEACHER |
| CONFIRMED → RESOLVED | resolved_by 必须为 ACTIVE ADMIN；resolved_at 必填 |
| CONFIRMED / PENDING_DETAIL → VOIDED | resolved_by 必须为 ACTIVE ADMIN；void_reason 必填 |

### 12.5 关键不变量

1. **无开放会话也可创建**：安全事件不依赖已有会话（触发器无 WHERE 阻止 INSERT）。
2. **按 student_id + job_code + task_code 独立聚合**（§13 目标合同）。
3. **同时熔断所有相关开放 assessment**：AFTER INSERT 触发器。
4. **同时熔断所有相关开放 training**：AFTER INSERT 触发器。
5. **每个受影响会话只产生一个 binding**：UNIQUE(incident_id, aggregate_type, aggregate_id) + INSERT OR IGNORE。
6. **每个 assessment 只有一个当前安全结果**：ux_result_record_one_current_per_source_type。
7. **REDLINE_HALTED 不可逆**：trg_assessment_session_no_terminal_status_change / trg_training_session_no_terminal_status_change。
8. **普通报告被阻断，只能生成 SAFETY_TERMINATION_REPORT**：trg_task_report_safety_termination_*。
9. **CONFIRMED 后核心事实冻结**：trg_safety_incident_core_facts_immutable_after_confirmed（student_id/job_code/task_code/trigger_event_id/reason_code/context_phase/description/triggered_by/confirmed_by/occurred_at 不可改）。
10. **LEVEL_FAIL_BY_SAFETY** 覆盖所有基于分数的等级。

---

## 十三、安全事件聚合键迁移合同

### 13.1 现实与目标

| | 聚合/查询/熔断匹配键 |
|---|---|
| **v0.1.12 真实实现** | `student_id + task_code`（48 触发器中 6 处 WHERE 实测，`safety_incident` 有 job_code 列但触发器不使用；`task_code` 无全局 UNIQUE 约束） |
| **v2.2 目标合同** | `student_id + job_code + task_code` |

**必须迁移的理由：**
1. `task_code` 无全局唯一约束（仅 `length(trim)>0`）。
2. 当前只有 `SUPERMARKET_SHELVER` 一个 job_code，跨岗位误匹配暂未暴露。
3. 后续增加岗位后，不同岗位可能复用 task_code。
4. `safety_incident` 已有 job_code 列，必须参与聚合、阻断新会话和批量熔断。
5. 否则一个岗位的安全事件会错误熔断另一岗位下相同 task_code 的 assessment/training。

这是需要正式 Schema 迁移的差异；**不得声称现有触发器已满足 job_code 聚合**。本轮只写迁移合同和触发器替换方案，不修改正式 `schema.sql`。

### 13.2 迁移合同（DROP + CREATE，已验证）

必须替换 v0.1.12 的 4 个触发器 + 2 个开放会话唯一索引，并新增查询索引：

```sql
-- F0. 删除 v0.1.12 基于 student_id+task_code 的旧触发器
DROP TRIGGER IF EXISTS trg_safety_incident_bind_open_assessments;
DROP TRIGGER IF EXISTS trg_safety_incident_bind_open_trainings;
DROP TRIGGER IF EXISTS trg_assessment_session_block_unresolved_safety_incident;
DROP TRIGGER IF EXISTS trg_training_session_block_unresolved_safety_incident;

-- F1. 批量熔断开放 assessment（加入 job_code）
CREATE TRIGGER trg_safety_incident_bind_open_assessments
AFTER INSERT ON safety_incident
FOR EACH ROW
WHEN NEW.status IN ('PENDING_DETAIL', 'CONFIRMED')
BEGIN
  INSERT OR IGNORE INTO safety_incident_binding (
    binding_id, incident_id, aggregate_type, aggregate_id,
    pre_status, post_status, halt_event_id, created_at)
  SELECT NEW.incident_id || ':ASSESSMENT_SESSION:' || s.session_id,
    NEW.incident_id, 'ASSESSMENT_SESSION', s.session_id,
    s.status, 'REDLINE_HALTED', NEW.trigger_event_id, datetime('now')
  FROM assessment_session s
  WHERE s.student_id = NEW.student_id AND s.job_code = NEW.job_code AND s.task_code = NEW.task_code
    AND s.status IN ('INIT','ACTIVE','EMOTION_INTERRUPTED','SUSPENDED_REVIEW_REQUIRED','OFFLINE_PENDING');

  UPDATE assessment_session
  SET status = 'REDLINE_HALTED', redline_incident_id = NEW.incident_id,
      level_result = 'LEVEL_FAIL_BY_SAFETY', report_type = 'SAFETY_TERMINATION_REPORT',
      completed_at = COALESCE(completed_at, datetime('now')), updated_at = datetime('now'),
      last_status_event_id = NEW.trigger_event_id, last_applied_event_id = NEW.trigger_event_id
  WHERE student_id = NEW.student_id AND job_code = NEW.job_code AND task_code = NEW.task_code
    AND status IN ('INIT','ACTIVE','EMOTION_INTERRUPTED','SUSPENDED_REVIEW_REQUIRED','OFFLINE_PENDING');
END;

-- F2. 批量熔断开放 training（加入 job_code）
CREATE TRIGGER trg_safety_incident_bind_open_trainings
AFTER INSERT ON safety_incident
FOR EACH ROW
WHEN NEW.status IN ('PENDING_DETAIL', 'CONFIRMED')
BEGIN
  INSERT OR IGNORE INTO safety_incident_binding (
    binding_id, incident_id, aggregate_type, aggregate_id,
    pre_status, post_status, halt_event_id, created_at)
  SELECT NEW.incident_id || ':TRAINING_SESSION:' || t.training_session_id,
    NEW.incident_id, 'TRAINING_SESSION', t.training_session_id,
    t.status, 'REDLINE_HALTED', NEW.trigger_event_id, datetime('now')
  FROM training_session t
  WHERE t.student_id = NEW.student_id AND t.job_code = NEW.job_code AND t.task_code = NEW.task_code
    AND t.status IN ('INIT','ACTIVE','EMOTION_INTERRUPTED','SUSPENDED_REVIEW_REQUIRED');

  UPDATE training_session
  SET status = 'REDLINE_HALTED', redline_incident_id = NEW.incident_id,
      completed_at = COALESCE(completed_at, datetime('now')), updated_at = datetime('now'),
      last_status_event_id = NEW.trigger_event_id, last_applied_event_id = NEW.trigger_event_id
  WHERE student_id = NEW.student_id AND job_code = NEW.job_code AND task_code = NEW.task_code
    AND status IN ('INIT','ACTIVE','EMOTION_INTERRUPTED','SUSPENDED_REVIEW_REQUIRED');
END;

-- F3. 未解决安全事件阻断新 assessment（加入 job_code）
CREATE TRIGGER trg_assessment_session_block_unresolved_safety_incident
BEFORE INSERT ON assessment_session
FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM safety_incident si
  WHERE si.student_id = NEW.student_id AND si.job_code = NEW.job_code AND si.task_code = NEW.task_code
    AND si.requires_review_before_next_session = 1 AND si.status IN ('PENDING_DETAIL','CONFIRMED'))
BEGIN
  SELECT RAISE(ABORT, 'unresolved safety incident blocks new assessment_session');
END;

-- F4. 未解决安全事件阻断新 training（加入 job_code）
CREATE TRIGGER trg_training_session_block_unresolved_safety_incident
BEFORE INSERT ON training_session
FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM safety_incident si
  WHERE si.student_id = NEW.student_id AND si.job_code = NEW.job_code AND si.task_code = NEW.task_code
    AND si.requires_review_before_next_session = 1 AND si.status IN ('PENDING_DETAIL','CONFIRMED'))
BEGIN
  SELECT RAISE(ABORT, 'unresolved safety incident blocks new training_session');
END;

-- F5. safety_incident 查询索引（加入 job_code）
CREATE INDEX IF NOT EXISTS idx_safety_incident_student_job_task_status
  ON safety_incident(student_id, job_code, task_code, status, requires_review_before_next_session);

-- F6. 开放会话唯一性守卫也必须 job-scoped（否则同 student+task_code 跨 job 无法并存）
DROP INDEX IF EXISTS ux_assessment_one_open_session_per_student_task_strategy;
CREATE UNIQUE INDEX IF NOT EXISTS ux_assessment_one_open_session_per_student_job_task_strategy
  ON assessment_session(student_id, job_code, task_code, strategy_type)
  WHERE status IN ('INIT','ACTIVE','EMOTION_INTERRUPTED','SUSPENDED_REVIEW_REQUIRED','OFFLINE_PENDING');
DROP INDEX IF EXISTS ux_training_one_open_session_per_student_task;
CREATE UNIQUE INDEX IF NOT EXISTS ux_training_one_open_session_per_student_job_task
  ON training_session(student_id, job_code, task_code)
  WHERE status IN ('INIT','ACTIVE','EMOTION_INTERRUPTED','SUSPENDED_REVIEW_REQUIRED');
```

`safety_incident_binding` 唯一性不变量保持不变：`UNIQUE(incident_id, aggregate_type, aggregate_id)`（v0.1.12 原表约束，不修改），配合 `INSERT OR IGNORE` 保证每会话每事件只一条 binding。

### 13.3 迁移后必须验证（已在临时库执行，见 validation report）

- 同一 student、同一 task_code、**不同 job_code** 的两个开放会话不互相误熔断。
- 同一 student、同一 job_code、同一 task_code 的 assessment 和 training 同时熔断。
- 无开放会话时仍可创建 safety_incident（binding=0）。
- 每个受影响会话只创建一条 binding。
- 每个 assessment 只产生一个当前安全结果（ux_result_record_one_current_per_source_type）。
- 未 RESOLVED/VOIDED 的事件只阻断相同 student_id + job_code + task_code 的新会话。

### 13.4 task_code 全局唯一性说明

`task_code` 当前无全局 UNIQUE 约束，v2.2 也**不**为其新增全局 UNIQUE（会与"一岗多任务、跨岗复用任务码"业务冲突）。正确性由聚合键三元组 `student_id + job_code + task_code` 保证。business_session、assessment_session、training_session、safety_incident 均携带 job_code + task_code，聚合口径一致。

---

## 十四、REST/SSE/IPC 合同

### 14.1 通信方式分配

| 客户端 | 协议 | 认证 | 推送 |
|--------|------|------|------|
| Teacher Web | HTTPS REST + SSE | HttpOnly Cookie | SSE |
| Student Kiosk | IPC / MessagePort | contextBridge 凭证 | `BrowserWindow.webContents.send()` |
| Future Student Web Portal | HTTPS REST + SSE | HttpOnly Cookie | SSE（独立频道白名单） |

**严格边界：** Student Kiosk Renderer 不订阅网络 SSE；不使用 WebSocket；不存在 WebSocket ticket 机制。

### 14.2 SSE 合同

**事件 ID 格式：** `<stream_epoch>:<sequence>`
- `stream_epoch`：Server 每次启动（含崩溃重启）递增的纪元号。
- `sequence`：纪元内单调递增的事件序号。

**重连协议：**
1. EventSource 自动重连，携带 `Last-Event-ID: <epoch>:<seq>`。
2. Server 检查 epoch：匹配 → 从 ring buffer 中 seq 之后推送；不匹配（Server 已重启）→ 发送 `event: resync_required`。
3. 客户端收 `resync_required` → 全量 REST 查询刷新。

**频道授权：** 教师 SSE 按 auth_session.capabilities_json 过滤（自己负责的学生 + 自己发起的测评）；学生 Web 门户频道白名单仅接收自身 session 状态变更和已发布结果/报告。

### 14.3 REST 基本规范

- Base path：`/api/v1/`。
- 认证：Cookie（教师/管理员），IPC 内部凭证（学生）。
- 写操作必须携带：`X-Idempotency-Key`、`X-Client-Instance-Id`、`X-CSRF-Token`。
- 响应：`{ "ok": true, "data": {...} }` 或 `{ "ok": false, "error": { "code": "...", "message": "..." } }`。
- 时间 ISO 8601 UTC；分页 `?page=1&size=20`。

### 14.4 主要 API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /auth/login | 教师/管理员登录 |
| POST | /auth/refresh / /auth/logout | 令牌续约 / 登出 |
| GET | /students, /students/:id | 学生列表/详情 |
| POST | /sessions/assessment, /sessions/training, /sessions/learning | 创建会话（先建 business_session） |
| GET | /sessions | 会话列表（按类型/状态过滤） |
| POST | /sessions/:id/assign | 分配会话到设备（建 Grant + Assignment） |
| POST | /sessions/:id/start | 启动会话 |
| POST | /sessions/:id/offline-scores/draft | 逐项保存线下评分草稿（§18） |
| POST | /sessions/:id/offline-scores/submit | finalize 提交线下评分 |
| POST | /sessions/:id/observations | 记录教师观察 |
| POST | /safety-incidents | 创建安全事件 |
| PUT | /safety-incidents/:id/confirm, /resolve | 确认 / 解决/撤销 |
| GET | /results, /reports, /reports/:id | 结果/报告 |
| GET | /assets/:id | 资源访问（授权检查，§19） |
| POST | /devices/:id/reconnect | 设备重连 / Grant Rebind |
| GET | /sse/teacher, /sse/student-portal | SSE 流 |
| GET | /pair/fingerprint, /pair/ca.crt | 配对指纹 / CA 下载（HTTP :7070） |

### 14.5 IPC API 对照（当前实现已注册通道）

学生 Kiosk 与教师本地操作的 IPC 通道映射到同一 Command Bus。当前实现已注册（`src/main/ipc/`）：

| IPC 通道 | 等效 REST | 说明 |
|----------|-----------|------|
| auth:login | POST /auth/login | 登录 |
| student:create/get/list/update/archive | /students* | 学生档案 |
| strategy:list/get/listVersions/createVersion/update/setActive | — | 策略管理 |
| assessment:createSession/startSession/submitAnswer/emotionInterrupt/emotionResume/abortSession/triggerRedline/calculateResult/getSession/listSessions/listMySessions | /sessions/* + /safety-incidents | 测评全链路 |
| assessment:submitOperationScores/getOperationScores | /sessions/:id/offline-scores* | TASK_OPERATION 评分 |
| assessment:submitJobSkillOfflineScores/getJobSkillOfflineScores/getSessionScoringQuestions | /sessions/:id/offline-scores* | JOB_SKILL 评分 |
| assessment:recordTeacherObservation/getTeacherObservations | /sessions/:id/observations | 教师观察 |

v2.2 新增（Phase 2）：learning:*、assign/reconnect、offline-scores/draft 等通道随目标形态实现。IPC 和 HTTP 统一进入 Command Bus，共享领域逻辑和 idempotency。

### 14.6 Main → Renderer 推送

```typescript
// Electron Main
serverPort.on('message', (event) => {
  const { channel, payload } = event.data;
  mainWindow.webContents.send(channel, payload);
});
// preload
contextBridge.exposeInMainWorld('api', {
  onPush: (channel, cb) => ipcRenderer.on(channel, (_e, payload) => cb(payload))
});
```
推送频道：`session:status-changed`、`session:assigned`、`safety:redline-triggered`、`system:recovery-started`、`system:recovery-completed`。Student Renderer 通过 `BrowserWindow.webContents.send()` 接收，绝不使用 SSE / WebSocket。

---

## 十五、Web 安全

### 15.1 Cookie 策略

| Cookie | 属性 | 有效期 | 用途 |
|--------|------|--------|------|
| session | HttpOnly, Secure, SameSite=Strict | 1h | 主认证令牌 |
| refresh_token | HttpOnly, Secure, SameSite=Strict, Path=/api/v1/auth/refresh | 7d | 令牌续约 |
| csrf_token | Secure, SameSite=Strict（非 HttpOnly，JS 可读） | 与 session 同步 | CSRF 防护 |
| device_credential | HttpOnly, Secure, SameSite=Strict | 1yr | 设备级长期凭证 |

### 15.2 CSRF 三层防护

1. **Double-Submit**：客户端从 `csrf_token` cookie 读值，写请求经 `X-CSRF-Token` 头发送；服务端比对。缺失 → 403。
2. **Origin/Referer 校验**：验证 Origin 匹配期望源；缺失降级检查 Referer；不匹配 → 403。
3. **SameSite=Strict**：浏览器层阻止跨站携带 cookie。

### 15.3 Electron 安全

| 配置 | 值 |
|------|-----|
| contextIsolation | true |
| nodeIntegration | false |
| sandbox | true |
| webSecurity | true |

### 15.4 CSP

Student Renderer（当前实现 `src/renderer/index.html` 已含 `connect-src 'self' app:`）：
```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' app://asset/; media-src 'self' app://asset/;
connect-src 'self'; frame-src 'none';
```
Teacher Web（Fastify 响应头）：
```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' https:; media-src 'self' https:; connect-src 'self'; frame-src 'none';
```

### 15.5 其他措施

请求限流（全局 100 req/min/IP，login 5 req/min/IP）；审计日志写 error_event_log；学生答案隔离（评分规则/正确答案不返回学生端 API）；同源部署优先；所有 JSON body 经 schema 验证后进入 Command Bus。

---

## 十六、HTTPS/CA/配对

### 16.1 证书体系

| 证书 | 算法 | 有效期 | 用途 |
|------|------|--------|------|
| Node Root CA | ECDSA P-256, self-signed | 5 年 | 信任锚点 |
| Server Leaf | ECDSA P-256, CA-signed | 90 天 | Fastify HTTPS 服务端证书 |

无 CRL/OCSP（LAN 不需要）；CA 吊销 = 重新生成 CA + 全量重新配对。

### 16.2 SAN 优先级

1. 稳定 mDNS hostname（`xccareer-node01.local`）。
2. 可选具体 IP（`192.168.1.100`）。

IP 变化自动重签叶子证书（CA 不变 → 已信任设备无需重装 CA）。

### 16.3 私钥保护

| 平台 | 保护方式 |
|------|----------|
| Windows | DPAPI 加密 + 文件 ACL（仅 SYSTEM + 安装用户） |
| macOS | Keychain（kSecAttrAccessibleAfterFirstUnlock） |
| Linux | 文件权限 0600 + 运行用户专属 |

### 16.4 CA 备份和轮换

CA 私钥含在全量备份中（加密）；CA 轮换：生成新 CA → 双 CA 并行期 → 所有设备重信任 → 移除旧 CA；支持 MDM profile 推送信任；未来原生客户端支持 certificate pinning。

### 16.5 首次安装（带外信任建立）

```
教师平板浏览器                          学生一体机屏幕
     │  1. 屏幕显示 IP + 端口 + CA 指纹        │
     │  2. 浏览器访问 http://<ip>:7070/api/v1/pair/fingerprint
     │─────────────────────────────────────▶│
     │  3. 返回 CA fingerprint JSON（对应 pairing_challenge）
     │◀─────────────────────────────────────│
     │  4. 教师核对屏幕指纹与返回指纹          │
     │  5. 匹配后手动安装 CA 证书（下载 ca.crt）
     │  6. 后续业务流量走 HTTPS :7443          │
     │─────────────────────────────────────▶│
```

`pairing_challenge` 表持久化每次下发的指纹挑战（nonce + 过期 + 消费状态）以供审计和防重放。

**关键约束：** HTTP :7070 仅临时提供 ca.crt 和指纹，5 分钟自动超时关闭；不传输任何业务数据；所有业务数据仅走 HTTPS :7443；浏览器不能自动安装系统 CA（需人工）；配对模式由教师在一体机手动触发。

### 16.6 证书自动续约

Server 启动检查叶子证书剩余有效期；< 30 天自动用 CA 签发新叶子证书；Fastify 热重载 TLS context（无需重启）；SSE 通知已连接教师。

### 16.7 端口职责

| 端口 | 协议 | 用途 | 暴露时机 |
|------|------|------|----------|
| :7443 | HTTPS | 所有业务 API + SSE + Teacher SPA | 始终 |
| :7070 | HTTP | 仅 CA 指纹 + ca.crt 下载 | 仅配对模式（5 分钟） |

---

## 十七、学生可见性和 publication

### 17.1 核心原则

- 教师内部观察数据 ≠ 学生可见反馈。
- 学生不可见：评分规则、正确答案（expected_answer）、评分锚点（scoring_rule）、安全事件详情、未发布报告、教师观察原始记录。
- 学生仅可见：已发布的报告、自己的最终等级结果、已完成的学习进度。

### 17.2 publication 模型（问题 #10：删除持久化 student_visible，查询派生）

避免 `publication_status=DRAFT AND student_visible=1` 或 `WITHDRAWN AND student_visible=1` 的漂移，v2.2 **删除持久化 `student_visible` 列**，改为查询时派生。result_record 新增列（DDL 唯一出现在 §7.3）：

| 字段 | 说明 |
|------|------|
| publication_status | 'DRAFT' / 'PUBLISHED' / 'WITHDRAWN'，NOT NULL DEFAULT 'DRAFT' |
| published_at | 发布时间 |
| published_by | 发布人 FK → user_account |
| business_session_id | 稳定映射父会话（问题 #5），供 invalidation 判定 |

**派生可见性（不持久化，问题 #5：经稳定 business_session_id，不比较 source_aggregate_id）：**

`result_record.source_aggregate_id` 指向 assessment_session / training_session 的主键，与 `session_invalidation_record.business_session_id` 不在同一命名空间，不能直接比较。v2.2 给 result_record 增列稳定 `business_session_id`（回填时由源子会话映射），可见性查询经此列判定：

```sql
-- 首选：经 result_record.business_session_id 稳定映射
SELECT r.*,
  CASE WHEN r.publication_status = 'PUBLISHED'
        AND r.published_at IS NOT NULL
        AND r.published_by IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM session_invalidation_record iv
              WHERE iv.business_session_id = r.business_session_id)
       THEN 1 ELSE 0 END AS student_visible
FROM result_record r;
```

等价的子表显式映射（当 result_record.business_session_id 尚未回填的历史行）：
```sql
-- 经 assessment/training 子表显式映射到 business_session_id
... NOT EXISTS (
  SELECT 1 FROM session_invalidation_record iv
  JOIN assessment_session a ON a.business_session_id = iv.business_session_id
  WHERE r.source_aggregate_type='ASSESSMENT_SESSION' AND a.session_id = r.source_aggregate_id
  UNION ALL
  SELECT 1 FROM session_invalidation_record iv
  JOIN training_session t ON t.business_session_id = iv.business_session_id
  WHERE r.source_aggregate_type='TRAINING_SESSION' AND t.training_session_id = r.source_aggregate_id
) ...
```

规则：
- PUBLISHED 要求 published_at 和 published_by 均非空。
- WITHDRAWN 不可见。
- invalidated session（session_invalidation_record 存在）不可见。
- 教师内部观察永不直接展示给学生。
- 正确答案、expected_answer、评分锚点、scoring_rule 不可见。
- task_report 只在正式发布后（visibility_scope='STUDENT_VISIBLE' 且 status 已锁定）对学生可见。

> v2.2 不保留持久化 student_visible，因此不需要"保证同步"的额外触发器；可见性单一真相来自 publication_status + published_* + invalidation 派生，杜绝双写漂移。

### 17.3 可见性规则表

| 数据 | 学生 Kiosk | 教师 | 条件 |
|------|-----------|------|------|
| 自己的会话列表/状态 | ✓ | ✓ | 仅自己的 |
| 题目内容 | ✓ | ✓ | 不含正确答案和评分规则 |
| 正确答案 / scoring_rule_json / rubric | ✗ | ✓ | — |
| 线下评分详情 / 教师观察原始记录 | ✗ | ✓ | — |
| 最终结果 | 派生 PUBLISHED 才可见 | ✓ | §17.2 派生条件 |
| 报告 | 发布后可见 | ✓ | visibility_scope='STUDENT_VISIBLE' |
| 安全事件详情 | ✗ | ✓ | 学生仅知"测评已终止" |
| 学习进度 | ✓ | ✓ | — |
| 被 invalidation 的会话 | ✗ | ✓ | 不作有效历史结果展示 |

### 17.4 visibility_scope（task_report）

`task_report.visibility_scope`（DDL 唯一出现在 §7.3）：`TEACHER_ONLY`（默认）/ `STUDENT_VISIBLE`（发布后学生可见）/ `PUBLIC`（未来家长/机构）。

### 17.5 SSE 频道过滤

教师 SSE 推送所有相关事件；未来学生 Web 门户 SSE 仅推送白名单：`session.status_changed`（自己）、`result.published`（自己）、`report.published`（自己）、`learning.progress_updated`（自己）。

---

## 十八、offline score draft / finalize

### 18.1 问题 #11：服务端持久化草稿

当前实现教师评分草稿仅存 Vue 组件内存（`reactive`），提交才落 offline_score_record；这不满足换平板/刷新恢复/多教师交接。v2.2 **不用浏览器 localStorage，也不重定义已有 offline_score_record**，而是新增服务端 `offline_score_draft` 表（DDL 见 §7.2 T18）承载草稿。

> **决策说明：** 采用新增 `offline_score_draft` 表而非给 `offline_score_record` 增加 DRAFT 态。理由：`offline_score_record` 是 v0.1.12 正式业务表（VALID/SUPERSEDED/VOID 三态 + 多个 scope-specific CHECK + 唯一索引），增加 DRAFT 会重定义已有正式表的 CHECK 与唯一索引语义，风险高且违反"不重定义已有正式业务表"。独立草稿表与正式记录解耦，finalize 时才写正式记录。

### 18.2 offline_score_draft 字段与不变量

关键列（§7.2 T18）：`draft_id`、`business_session_id`、`question_id`/`item_id`、`score_scope`、`score_value`（0/1/2 或 NULL）、`note`、`observation_payload_json`、`version`（乐观锁）、`status`（OPEN/SUBMITTED/DISCARDED）、`updated_by`、`updated_at`。

唯一约束：每个会话每个评分项最多一条 OPEN 草稿：
```sql
CREATE UNIQUE INDEX ux_offline_score_draft_open_item
  ON offline_score_draft(business_session_id, score_scope, COALESCE(question_id, item_id))
  WHERE status = 'OPEN';
```

### 18.3 草稿生命周期与能力

| 能力 | 实现 |
|------|------|
| 逐项自动保存 | 每次打分 PUT `/sessions/:id/offline-scores/draft`，UPSERT 到 OPEN 草稿 |
| 乐观锁 | `version` 列；提交时 `WHERE version=?`，冲突返回最新值 |
| 换平板恢复 | 草稿在服务端；换设备重新拉取 OPEN 草稿 |
| 浏览器刷新恢复 | 同上，服务端持久化 |
| 多教师交接 | updated_by 记录最后修改者；OPEN 草稿全局可见给授权教师 |
| 最终提交（批次化） | POST `/submit`：单条命令 → **一个 BATCH_PREPARED 含全部 OFFLINE_SCORE_SUBMITTED 事件** → APPLY（逐事件投影 offline_score_record）→ CONFIRM → 草稿批量置 SUBMITTED（见下） |
| finalize 后不可直接修改 | offline_score_record 提交后 session 转只读；delivery_phase 推进 |
| 纠错 | 走 correction_record（§20），不直接改已提交记录 |

**问题 #7 批次化 finalize：** finalize 不再"逐项 writeEvent"（那会产生多个单事件 batch、破坏 hash chain 连续性并使原子性碎片化）。而是把该会话所有 OPEN 草稿聚为**一次批次**：一个 `BATCH_PREPARED`（含 N 个 `OFFLINE_SCORE_SUBMITTED` EVENT）→ 一次 APPLY 事务内逐事件投影 `offline_score_record` + 批量将对应草稿置 `SUBMITTED` → 一次 CONFIRM。整批要么全成功要么全回滚，与 §10.7 三段式一致。

### 18.4 与 delivery_phase 衔接

`OFFLINE_SCORING` 阶段：教师逐题写 offline_score_draft（OPEN）。所有评分项完成并 submit → 草稿转 SUBMITTED + 落 offline_score_record → delivery_phase 进 OBSERVATION（若有观察模板）或 READY_TO_FINALIZE。

---

## 十九、asset / resource authorization

### 19.1 问题 #12：Student Renderer 资源访问必须授权

学生 Kiosk 使用 `app://asset/{asset_id}` 协议访问资源，**不是"无需认证"**。Electron protocol handler 必须在返回资源前执行完整授权链校验：

```
当前 device
→ ACTIVE device_runtime_session（该设备唯一活跃运行实例）
→ ACTIVE Grant（绑定当前 business_session）
→ 非终态 Assignment（该 device + business_session）
→ 当前 business_session
→ session asset allowlist（该会话授权的 asset_id 集合）
→ 请求的 asset_id ∈ allowlist
```

任一环节不满足 → protocol handler 返回拒绝（不返回字节）。

### 19.2 学生不得读取

- 未分配题目的资源。
- 其他学生的资源。
- expected answer / 评分素材。
- 未授权学习视频。
- 其他业务会话的资源。

### 19.3 会话资源白名单来源

- 测评/训练：会话创建时从 assessment_session_question / training_step_record 引用的 question_bank.media_asset_id、tool_asset_ids_json 计算允许的 asset_id 集合。
- 学习：learning_progress.item_id 引用的 asset_resource。
- 白名单在 Grant 授权范围内生效；Grant 释放后白名单失效。

### 19.4 Teacher Web / 未来 Student Web 的 asset API

`GET /api/v1/assets/{asset_id}` 必须执行同等授权（Cookie 认证 + 权限检查 + 会话白名单）：
- 支持 `Range`（视频断点续传）、`ETag`（基于 file_hash）、`If-None-Match`（304）。
- 缩略图：`GET /api/v1/assets/{asset_id}/thumbnail`。
- 教师可见范围内的资源才返回；未来学生门户仅返回自身授权会话的资源。

### 19.5 asset_resource 模型与完整性（已存在于 v0.1.12，不修改）

保留原表。大型二进制存 `{userData}/assets/`，不入 SQLite BLOB；`file_hash` = SHA-256；启动可选完整性校验（ACTIVE 资源验证 hash，失败置 status='CORRUPTED' + 写 error_event_log）。不使用 CDN / 流媒体协议（局域网 HTTP Range 足够）；视频推荐 H.264 Baseline Profile。

### 19.6 离线资源包

学习视频/素材以资源包预装；manifest 列出 asset_id + expected hash + 相对路径；安装时逐一验证 hash 注册到 asset_resource；已被 ACTIVE question/learning_session 引用的资源冻结（不可删除/替换）。

---

## 二十、Finalization、correction、report version

### 20.1 CalculateResult 流程

1. 验证所有线下评分已提交且状态 VALID（offline_score_draft 已 SUBMITTED，offline_score_record 已落）。
2. 计算原始分、归一化分、模块分。
3. 调 level-judge 定等级（含安全覆盖检查）。
4. INSERT result_record（publication_status='DRAFT'，business_session_id = 源会话父容器）。
5. 生成报告 INSERT task_report（visibility_scope='TEACHER_ONLY'）。
6. **单条 UPDATE 同时**置 `status='COMPLETED'` 与 `delivery_phase='FINALIZED'`：
   ```sql
   UPDATE assessment_session SET status='COMPLETED', delivery_phase='FINALIZED', completed_at=datetime('now')
   WHERE session_id=:sid;
   ```
   必须合并为一条 UPDATE——因 D4（FINALIZED↔COMPLETED 双向对应，§7.5）：若拆两步，任一中间态（COMPLETED+READY_TO_FINALIZE 或 OFFLINE_PENDING+FINALIZED）都违反 D4 被拒。前向触发器允许 READY_TO_FINALIZE→FINALIZED，终态保护触发器对 OLD.status 非终态（OFFLINE_PENDING）放行。
7. COMMIT。

### 20.2 FINALIZED 不可回退

- delivery_phase='FINALIZED' 后前向触发器阻止任何变更。
- status='COMPLETED' 后终态保护触发器阻止变更。
- 纠正错误用 correction_record（不修改原始数据）。

### 20.3 不新增 VOIDED session 终态；作废走 invalidation

- assessment_session / training_session 终态仅 COMPLETED / ABORTED / REDLINE_HALTED（v0.1.12），**不新增 VOIDED**。
- 作废会话用 `session_invalidation_record`（FK → business_session，问题 #13.3）：记录作废原因和证据，原始 session 状态不变（历史不可篡改），查询有效结果时排除已 invalidated 的会话（§17.2 派生条件）。

### 20.4 correction_record 使用场景（保留原始事实，问题 #13.5）

| 目标 | 流程 |
|------|------|
| OFFLINE_SCORE | 原 offline_score_record 标 SUPERSEDED → INSERT 新记录 → INSERT correction_record → 重新 CalculateResult |
| RESULT | 原 result_record.is_current=0 → INSERT 新 result_record（is_current=1） → INSERT correction_record |
| REPORT | 原 task_report.status='SUPERSEDED' → INSERT 新 task_report → INSERT correction_record |

所有纠错保留原始事实，不修改终态 session。

### 20.5 result supersession

`result_record.is_current`：一个 source_aggregate_id + result_type 最多一个 is_current=1（ux_result_record_one_current_per_source_type）；纠正时旧记录置 0，新记录置 1；原始记录永久保留。

### 20.6 报告版本管理（不单独建 report_version 表）

通过 `task_report.status` 管理版本：GENERATED → LOCKED → EXPORTED → SUPERSEDED；纠正后新报告 status='GENERATED'，旧报告 status='SUPERSEDED'；报告发布 = LOCKED + visibility_scope='STUDENT_VISIBLE'；EXPORTED 需 placement_review_by（触发器 trg_task_report_placement_review_export_* 强制人工确认）。report_version 语义由 correction_record + task_report.status 承载，不新增专表。

---

## 二十一、backup / restore

### 21.1 备份方法

数据库：`VACUUM INTO` 或 SQLite Online Backup API（一致性快照）；备份期间写入暂停（BACKUP_FREEZE 模式）。

### 21.2 备份事实来源（问题 #13.4）

| 事实来源 | 权威范围 | 关联 |
|----------|----------|------|
| 外部 `backup-manifest.json` | 可恢复备份包的权威清单（元数据 + 所有文件 SHA-256） | 通过 manifest_id |
| SQLite `backup_manifest` 表 | 本机备份任务历史（PREPARING/COMPLETED/FAILED/CORRUPTED） | `external_manifest_path` 指向外部 manifest |

恢复时以**外部 backup-manifest.json** 为准（自包含于备份包）；SQLite backup_manifest 只是本机任务台账。

### 21.3 备份包含内容

SQLite DB（VACUUM INTO 副本）、所有 JSONL 段（活跃段截断到 cut point + 归档段）、segment_index.json（含 hash chain）、asset manifest + assets/、config/node.json、certs/（加密）、运维表数据（内嵌 DB）、外部 backup-manifest.json（元数据 + 全文件 SHA-256）。

### 21.4 备份协议

```
1. 进入 BACKUP_FREEZE（新命令排队）
2. 等所有 in-flight batch CONFIRMED
3. 冻结所有写入（心跳、cleanup 暂停）
4. 记录 cut point：cut_batch_sequence / cut_segment_id / cut_segment_byte_offset
5. VACUUM INTO staging/db.sqlite
6. 复制 JSONL（归档段完整 + 活跃段截断到 cut_segment_byte_offset）
7. 复制 segment_index.json
8. 复制 asset-manifest.json + assets/
9. 复制 certs/（加密）+ config/
10. 计算所有文件 SHA-256 写入 backup-manifest.json
11. UPDATE backup_manifest (backup_status='COMPLETED', external_manifest_path=…)
12. 退出 BACKUP_FREEZE
```

### 21.5 恢复协议

```
1. 解析 backup-manifest.json，验证 schema 版本兼容 + 所有文件 SHA-256
2. 复制到 staging，对 DB 执行 PRAGMA integrity_check
3. 完整性检查：projector_cursor 与 applied_event_batch 一致；JSONL 大小与 segment_index 匹配；
   hash chain 从第一段到最后一段验证通过；asset manifest 与 assets/ 匹配
4. 原子切换（见 §21.7）
5. 重启 Server，执行 startupRecovery()
6. 任一步失败 → 还原 pre-restore 目录 → 重启
```

### 21.6 Generation 目录结构

```
{userData}/
├── generations/
│   ├── gen-001/  (历史 generation：db.sqlite, action_log.jsonl, segments/, segment_index.json,
│   │             assets/, certs/, config/, backup-manifest.json)
│   ├── gen-002/  (当前 generation)
│   └── staging/  (恢复准备区，临时)
├── current -> generations/gen-002   # POSIX symlink（指向 generations/gen-N，不是根目录 gen-N）
├── current.json                     # Windows: {"generation":"gen-002","switched_at":"..."}
└── backups/
```

### 21.7 Pointer 原子切换（问题 #9：POSIX 指向 generations/gen-N）

**POSIX：** `current` symlink 必须指向 `generations/gen-N`（相对根 `{userData}` 的实际存在路径），不能指向根目录下不存在的 `gen-N`：
```bash
# 在 {userData} 下：target 为 generations/gen-002（真实存在）
ln -sfn generations/gen-002 current.tmp && mv -T current.tmp current
```
（`mv -T` 同文件系统原子替换 symlink；失败则 current 仍指旧 generation。读取时 `readlink current` 得 `generations/gen-002`。）

**Windows：** 先写 `current.json.tmp` → `rename current.json.tmp current.json`（NTFS 同卷 rename 原子；失败则旧 json 有效）。`generation` 字段值 `gen-002` 由读取方拼为 `generations/gen-002`。

**禁止：** 先让 current 指向 staging 再移动 staging（悬空指针）；逐个替换多个正式文件冒充原子恢复；只备份单个 action_log.jsonl；按 mtime 混合新旧资源。

### 21.8 备份/恢复验收（部分为人工验收，见 validation report §5）

正常备份+恢复；恢复失败（hash 不匹配）保持旧 generation；JSONL 全段恢复；资源恢复；pointer 原子切换；Windows current.json 原子替换；从备份恢复后 startupRecovery 正常；备份期间意外关机 staging 不完整（下次启动忽略/清理）。

---

## 二十二、状态不变量

### 22.1 会话与阶段

1. assessment/training 终态仅 COMPLETED/ABORTED/REDLINE_HALTED，不可转出，不新增 VOIDED。
2. delivery_phase 只前向推进，FINALIZED 终态不可变，禁止 FINALIZED→OBSERVATION，禁止 OBSERVATION→FINALIZED。
3. REDLINE_HALTED/ABORTED 的 delivery_phase 不伪造 FINALIZED。
4. learning_session 终态 COMPLETED/ABANDONED，不受安全红线影响。

### 22.2 身份与授权

5. 每台设备最多一个 ACTIVE device_runtime_session。
6. 每个 business_session 最多一个 ACTIVE Grant。
7. 每个 Grant 最多一个非终态 Assignment；每个 business_session/device 最多一个非终态 Assignment。
8. assignment 的 student_id/device_id/business_session_id 必须与其 grant 一致；assigned_by = grant 教师或 ACTIVE ADMIN（触发器 D10）。
9. Grant 绑定单个 business_session，不跨会话复用；设备重启新 Grant 用 replaces_grant_id 链接。
9a. Grant 自身一致：student=business_session.student、runtime.device=grant.device、auth.user=grant.teacher 且 auth ACTIVE 未过期（D9）。
9b. 活动（PENDING_CONFIRM/ACTIVE）Assignment 不得引用非 ACTIVE Grant（D11，写入侧构造式强制）。
9c. Grant Rebind 在单事务内 expire-old→create-new→repoint，assignment.version+1；需重确认则改 PENDING_CONFIRM 并清空 student_confirmed_at（§6.6）。

### 22.3 父子一致性

10. assessment/training/learning 的 business_session_id 非空且必须指向 session_type、student_id、job_code、task_code 四字段全匹配的 business_session（D5~D7，INSERT+UPDATE）。
11. 一个 business_session 最多一个正确类型子会话（UNIQUE 部分索引）。
11a. business_session 关键字段（session_type/student_id/job_code/task_code）不可事后修改（D8）。

### 22.4 事件溯源与命令

12. JSONL 只追加；SQLite 投影可从 JSONL 重建（分类见 §10.3）。
13. 唯一 batch_hash 算法（§10.5）；BATCH_PREPARED/applied_event_batch/segment_index 三处 hash 一致。
14. `(client_instance_id, idempotency_key)` 全局唯一；current_lease_generation 只增不减；prepared_lease_generation 不可变。
15. BATCH_PREPARED fsync 后为不可逆点，禁止重新执行 Domain Handler。
16. 禁止通用 INSERT OR REPLACE 作为领域投影策略。
17. command_log 是混合表：领域进度可从 JSONL 恢复，幂等键/租约/result_json 需 SQLite 备份。

### 22.5 安全事件

18. 聚合键 student_id+job_code+task_code（目标合同）；无开放会话也可创建。
19. 同键 assessment+training 同时熔断；每会话每事件一条 binding。
20. REDLINE_HALTED 不可逆；只能生成 SAFETY_TERMINATION_REPORT；SafetyIncidentCreated 为唯一权威命令事件，halt 是其确定性投影，不追加未 PREPARE 的领域事件。

### 22.6 可见性与纠错

21. student_visible 为查询派生（PUBLISHED + published_* + 未 invalidated），不持久化。
22. 正确答案/scoring_rule/评分锚点/教师观察原始记录/安全详情对学生不可见。
23. correction_record / result supersession / report SUPERSEDED 保留原始事实，不改终态 session。
24. 线下评分草稿服务端持久化（offline_score_draft），非 localStorage、非仅内存。

### 22.7 资源

25. app://asset 访问必须经 device→runtime→grant→assignment→session→allowlist→asset_id 授权链。
26. organization_id 安装生成 UUID，禁止固定 org_default。

---

## 二十三、自动化和人工验收矩阵

验收编号供 coverage matrix 与 validation report 引用。`AUTO` = 已在临时 SQLite/Node 真实执行；`MANUAL` = 需人工/集成环境验收。

### 23.1 Schema 与迁移（AUTO）

| # | 用例 | 章节 | 验证方式 |
|---|------|------|----------|
| M-01 | schema.sql + v2.2 增量加载无 SQL 错误 | §7,§8 | AUTO: sqlite3 加载 |
| M-02 | 迁移后 PRAGMA foreign_key_check 空结果 | §8.6 | AUTO |
| M-03 | 迁移后 PRAGMA integrity_check = ok | §8.6 | AUTO |
| M-04 | 原有 46 触发器保留，仅 4 安全触发器替换 | §7.1,§13 | AUTO: sqlite_master 计数 |
| M-05 | 表数 20→39，索引/触发器计数符合预期 | §7 | AUTO |

### 23.2 delivery_phase（AUTO）

| # | 用例 | 章节 |
|---|------|------|
| P-01 | 全部合法迁移（PREPARED→…→FINALIZED，8 步）成功 | §9.2,§9.4 |
| P-02 | 全部非法跳转被阻止（PREPARED→FINALIZED、ASSIGNED→OBSERVATION、回退、FINALIZED→任何） | §9.3 |
| P-03 | COMPLETED 回填 FINALIZED | §8.3 |
| P-04 | REDLINE_HALTED/ABORTED 保持 NULL（不伪造 FINALIZED） | §8.3 |
| P-05 | INSERT delivery_phase=FINALIZED（非 COMPLETED）被拒；INSERT COMPLETED+PREPARED 被拒 | §9.4.1,§7.5 D2/D4 |
| P-06 | UPDATE 到 FINALIZED 但 status≠COMPLETED（NULL→FINALIZED、ACTIVE+FINALIZED）被拒 | §9.4.1,§7.5 D4 |
| P-07 | 单条 UPDATE status=COMPLETED+delivery_phase=FINALIZED 成功 | §20.1,§7.5 D4 |
| P-08 | ABORTED 后修改 delivery_phase 被拒（冻结） | §9.4.1,§7.5 D3 |

### 23.3 安全事件聚合键（AUTO）

| # | 用例 | 章节 |
|---|------|------|
| S-01 | 同 student+task_code 不同 job_code 不互相误熔断 | §13.3 |
| S-02 | 同 student+job_code+task_code 的 assessment+training 同时熔断 | §13.3 |
| S-03 | 无开放会话可创建 incident（binding=0） | §12.5 #1 |
| S-04 | 每会话每事件仅一条 binding | §12.5 #5 |
| S-05 | REDLINE_HALTED 不可逆 | §12.5 #7 |
| S-06 | 未解决安全事件只阻断同三元键的新会话 | §13.2 F3/F4 |

### 23.4 父子一致性与授权（AUTO）

| # | 用例 | 章节 |
|---|------|------|
| C-01 | NULL 父会话被拒（NOT NULL） | §7.5 D5 |
| C-02 | job_code 错配被拒 | §7.5 D5 |
| C-03 | task_code 错配被拒 | §7.5 D5 |
| C-04 | 四字段一致可插入 | §7.5 D5 |
| C-05 | 父表关键字段事后修改被拒 | §7.5 D8 |
| C-06 | learning_session UPDATE 错配 student 被拒 | §7.5 D7 |
| G-01 | 每 business_session 最多一个 ACTIVE grant | §6.2 |
| G-02 | 每 grant 最多一个非终态 assignment | §6.3 |
| G-03 | assignment-grant 一致性 + assigned_by 非教师非ADMIN 被拒 | §6.5,§7.5 D10 |
| G-04 | rebind 单事务成功（expire旧→建新→改指） | §6.6 |
| G-05 | rebind 后 assignment 指向新 grant、version+1 | §6.6 |
| G-06 | rebind 后旧 grant EXPIRED + replaces_grant_id 链接 | §6.6 |
| G-07 | 活动 assignment 改指到非 ACTIVE grant 被拒（D11） | §7.5 D11 |
| G-08 | grant runtime.device≠grant.device 被拒 | §7.5 D9 |
| G-09 | grant student≠business_session.student 被拒 | §7.5 D9 |
| G-10 | grant teacher_user≠auth.user 被拒 | §7.5 D9 |
| G-11 | grant teacher auth 已过期被拒 | §7.5 D9 |
| D-01 | offline_score_draft 每项最多一条 OPEN | §18.2 |
| D-02 | offline_score_draft question_id/item_id XOR（都空/都非空被拒） | §7.2 T18 |
| W-09 | invalidation 后经 business_session_id 派生可见=0；未 invalidate=1 | §17.2 |

### 23.5 JSONL 算法（AUTO）

| # | 用例 | 章节 |
|---|------|------|
| J-01 | canonical 序列化与 key 顺序无关 | §10.5 |
| J-02 | events_hash 确定性 + 64 hex | §10.5 |
| J-03 | batch_hash 从 GENESIS 链式 | §10.5 |
| J-04 | 篡改事件字段 → events_hash 改变 | §10.5 |
| J-05 | 篡改 previous_batch_hash → batch_hash 改变 | §10.5 |
| J-06 | 末尾 LF 策略固定（与无末尾 LF 不同） | §10.5 |

### 23.6 命令与恢复（MANUAL，需运行时 Server）

| # | 用例 | 章节 |
|---|------|------|
| J-07 | PREPARED 后旧 worker 失去租约（current_lease_generation +1） | §11.2 |
| J-14 | 接管后 prepared_lease_generation < current_lease_generation 属正常；prepared>current → CORRUPTION | §11.3 | MANUAL |
| J-08 | 不可逆点后新 worker 只接管 APPLY/CONFIRM | §11.3 |
| J-09 | APPLIED 未 CONFIRMED 可恢复 | §10.8 P2 |
| J-10 | PREPARED 未 APPLIED 可重放（processed_event 幂等） | §10.8 P3 |
| J-11 | Segment 轮转后可恢复 | §10.6 |
| J-12 | hash mismatch → CORRUPTION_DETECTED | §10.9 |
| J-13 | command result 可恢复 / 或重置 PENDING | §11.7,§11.9 |

### 23.7 Web / 证书（MANUAL）

| # | 用例 | 章节 |
|---|------|------|
| W-01 | CSRF 三层防护（无 X-CSRF-Token → 403） | §15.2 |
| W-02 | Origin/Referer 校验 | §15.2 |
| W-03 | SSE epoch 重启 → resync_required | §14.2 |
| W-04 | 学生 Kiosk 不使用网络 SSE（当前实现已符合） | §14.1 |
| W-05 | HTTP :7070 仅 fingerprint + ca.crt，5 分钟超时 | §16.7 |
| W-06 | HTTPS :7443 拒绝未认证 | §15.1 |
| W-07 | CA 安装带外指纹核对（Windows/iPadOS/Android） | §16.5 |
| W-08 | app://asset 授权链拒绝越权访问 | §19.1 |

### 23.8 备份恢复（MANUAL，需文件系统集成）

| # | 用例 | 章节 |
|---|------|------|
| B-01 | Generation 完整创建 + SHA-256 校验 | §21.4 |
| B-02 | 恢复失败（hash 不匹配）保持旧 generation | §21.5 |
| B-03 | JSONL 全段恢复（归档 + 活跃段截断） | §21.3 |
| B-04 | 资源恢复（asset manifest 完整） | §21.3 |
| B-05 | Pointer 原子切换（POSIX mv / Windows rename） | §21.7 |
| B-06 | 从备份恢复后 startupRecovery 正常 | §21.5 |
| B-07 | 外部 manifest 与 backup_manifest 表通过 manifest_id 关联 | §21.2 |

---

**文档结束** — v2.2 AUTHORITATIVE BASELINE

