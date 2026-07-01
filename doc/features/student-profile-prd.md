## 功能名称

学生档案管理（教师创建 / 编辑 / 归档学生档案，含学生登录账号开通）

文件名：`student-profile-prd.md`
PRD 版本：v1.0.0
创建日期：2026-07-01
对应主 PRD：炫灿-职途向导系统 MVP PRD v1.0.4
对应 schema：`xc-career-guide-mvp-schema-v0.1.7-consistency-guard`
状态：待审查

---

## 解决的问题

登录功能已落地（commit 4344b9f + fb70618），教师可登录进入 `/teacher`，但 TeacherLayout 仍是占位页，无任何学生数据。

PRD §4.1 主流程的第 1 步是「教师创建学生档案」，是后续发起测评、分配训练、生成报告的前置依赖。当前 `student_profile` 表为空，`user_account` 仅有种子脚本创建的 3 个测试账号，且两表无任何关联——学生即使有档案也无法登录。

本功能打通「教师建档 → 学生可登录」链路，使系统从「教师能登录」推进到「教师能管理学生、学生能登录」。

---

## 用户角色

| 角色 | 在本功能中的能力 |
|---|---|
| `TEACHER` | 创建学生档案、编辑档案（含感官画像）、归档档案、查看学生列表与详情 |
| `ADMIN` | 拥有 TEACHER 全部能力（MVP 阶段共用教师端入口）|
| `STUDENT` | 不可访问本功能任何 IPC（仅作为档案的被管理对象）|

---

## 核心使用场景（流程步骤）

### 场景 A：教师新建学生档案

1. 教师登录后进入 `/teacher/students`（学生列表页）
2. 点击「新建学生」，进入 `/teacher/students/new`
3. 填写表单：
   - **登录信息**：用户名（必填，全局唯一）、初始密码（必填，需二次输入确认）
   - **基本信息**：学生姓名（必填）、性别（选填）、出生日期（选填）、监护人联系方式（选填）
   - **感官画像**（选填）：噪音 / 光线 / 触觉 / 人群密度敏感度（各 LOW/MEDIUM/HIGH）、需回避场景标签、备注
4. 点击「保存」，渲染进程将 `form` 展开为普通对象后调用 `window.api.student.create(...)`
5. 主进程 `student:create` handler：
   - 校验调用者角色（callerRole ∈ {TEACHER, ADMIN}）
   - 生成一个 UUID，**同时作为 `student_profile.student_id` 和 `user_account.user_id`**
   - 校验 username 全局唯一（捕获 schema UNIQUE 约束）
   - 校验 `sensory_profile_json` 结构（按 JSON 字段规范 §8）
   - 事务内执行：
     - INSERT `user_account`（user_id=UUID, role='STUDENT', password_hash=哈希后密码, status='ACTIVE'）
     - INSERT `student_profile`（student_id=同 UUID, status='ACTIVE'）
   - 事务提交后写 `error_event_log`（error_category='SYSTEM', severity='INFO', related_aggregate_type='STUDENT_PROFILE', related_aggregate_id=student_id, context_json 含 callerUserId）满足 §14.3 审计。**注：** schema 的 `error_category` CHECK 枚举不含 'STUDENT_PROFILE'（仅 IPC/DB/AOL/RECOVERY/ASSET/FSM/SCORING/REPORT/AUTH/SYSTEM），用 'SYSTEM' 承载主数据审计；关联通过 `related_aggregate_type` + `related_aggregate_id` 字段实现。
6. 返回 `{ success: true, studentId }`，渲染进程跳转到 `/teacher/students/:id`

### 场景 B：教师编辑学生档案

1. 在学生列表点击某学生，进入 `/teacher/students/:id`（详情/编辑页）
2. 修改可编辑字段（见「功能范围」），点击「保存」
3. 渲染进程调用 `window.api.student.update({ studentId, callerUserId, callerRole, patch: { ...form.value } })`
4. 主进程 `student:update` handler：
   - 校验目标档案 `status != 'ARCHIVED'`（归档档案不可编辑）
   - 校验 `sensory_profile_json` 结构（若包含该字段）
   - UPDATE `student_profile` 对应字段 + `updated_at = datetime('now')`
   - 写 `error_event_log`（error_category='SYSTEM', severity='INFO', related_aggregate_type='STUDENT_PROFILE', related_aggregate_id=student_id, context_json 含 callerUserId 与变更字段）

### 场景 C：教师编辑感官画像（§17.1 验收项）

场景 B 的子集。感官画像是 `student_profile.sensory_profile_json` 字段，在详情页内有独立分区编辑。保存时整体替换该 JSON 字段，走同一 `student:update` handler。

### 场景 D：教师归档学生档案

1. 在学生详情页点击「归档」（需二次确认，§15.5）
2. 渲染进程调用 `window.api.student.archive({ studentId, callerUserId, callerRole })`
3. 主进程 `student:archive` handler：
   - 事务内：
     - UPDATE `student_profile` SET status='ARCHIVED'
     - UPDATE `user_account` SET status='DISABLED'（阻止该学生登录；用 user_id = student_id 定位）
   - 写 `error_event_log`（error_category='SYSTEM', severity='INFO', related_aggregate_type='STUDENT_PROFILE', related_aggregate_id=student_id, context_json 含 callerUserId）
4. 返回成功，列表中该学生标记为「已归档」

---

## 功能范围

### 本次做

**IPC handler（`src/main/ipc/handlers/student.ts`）**

- `student:list` — 分页/搜索查询学生列表：默认只返回 `status='ACTIVE'`，支持参数 `includeArchived=true` 同时返回已归档；按姓名模糊搜索；按 `created_at` 倒序，每页 20 条
- `student:get` — 查询单个学生详情（含 sensory_profile_json 解析）
- `student:create` — 事务创建 user_account + student_profile（同 UUID）
- `student:update` — 编辑 student_profile 字段（不含 username / password）
- `student:archive` — 归档（student_profile.status → ARCHIVED + user_account.status → DISABLED）

**类型与桥接**

- `src/shared/types/ipc-api.ts` — 新增 `student` section 类型声明（StudentRow / CreateStudentParams / UpdateStudentParams / StudentResult 等）
- `src/preload/index.ts` — 暴露 `window.api.student.{list, get, create, update, archive}` 白名单

**渲染进程**

- `src/renderer/src/views/teacher/StudentListView.vue` — 学生列表（新建按钮、搜索、状态标签）
- `src/renderer/src/views/teacher/StudentFormView.vue` — 新建 + 编辑共用表单（路由 `/teacher/students/new` 与 `/teacher/students/:id` 复用，按 `:id` 是否存在区分模式）
- 路由注册为 `/teacher` 的 children
- Pinia `useAuthStore` 已有 `userId` / `role`，作为 IPC 调用的 caller 身份来源

**校验**

- `sensory_profile_json` 写入前按 JSON 字段规范 §8 校验（枚举值、avoid_tags 为字符串数组）
- username 唯一性由 schema UNIQUE 约束保证，handler 捕获并转为友好错误

**审计**

- 复用 `error_event_log` 表（与 auth handler 审计模式一致），error_category='SYSTEM'（schema CHECK 枚举不含 'STUDENT_PROFILE'，详见风险点），severity='INFO'，related_aggregate_type='STUDENT_PROFILE'，related_aggregate_id=student_id，context_json 记录 callerUserId。create/update/archive 各写一条

### 本次不做

- **学生自助注册**：账号由教师创建，学生不可自行注册
- **username 修改**：创建后锁定，MVP 不提供修改入口（避免登录链路复杂化）
- **密码修改 / 重置 / 找回**：与登录功能 PRD 一致，MVP 不做。教师建档时设置的初始密码即最终密码；如需修改，后续版本再开放
- **学生档案物理删除**：PRD §14.4 禁止，只允许归档（status → ARCHIVED）
- **归档恢复（unarchive）**：MVP 不提供。归档为单向操作，status=ARCHIVED 后不可回到 ACTIVE（避免「已归档→恢复」与历史审计混淆；如确需重新启用，由教师新建档案）
- **学生自助查看/编辑自己的档案**：学生端档案查看是另一功能（PRD §2.3「学生个人基础档案查看」），不在本 PRD 范围
- **批量导入学生**：MVP 单机本地，教师逐个建档可接受
- **感官画像影响题目筛选的实际组卷逻辑**：本功能只负责存储感官画像；「感官画像 → 题目筛选」属于测评发起功能（§10），不在本 PRD
- **档案字段的历史版本/修订追踪**：student_profile 非事件溯源聚合，仅覆盖当前态 + 审计日志，不做 revision（与 answer_record / offline_score_record 的 revision 机制不同）
- **student_profile 写入 domain_event_projection**：档案是主数据，不是领域聚合状态变更，审计需求由 error_event_log 满足（与 auth 登录的决策一致）

---

## 边界条件和异常处理

| 场景 | 处理 |
|---|---|
| username 已存在 | schema UNIQUE 约束 ABORT，handler 捕获，返回 `errorCode: 'USERNAME_TAKEN'`，前端提示「用户名已被占用」 |
| 必填字段缺失（姓名 / username / 密码） | 前端 `required` 阻断；后端二次校验返回 `errorCode: 'VALIDATION_ERROR'` |
| `sensory_profile_json` 结构非法（枚举值越界、avoid_tags 非数组） | handler 校验失败，返回 `errorCode: 'INVALID_SENSORY_PROFILE'`，不写入 |
| callerRole = STUDENT 调用任意 student:* handler | 返回 `errorCode: 'FORBIDDEN'`，不执行 |
| callerRole 缺失，或**调用者本人**（callerUserId 对应的 user_account）status != ACTIVE | 返回 `errorCode: 'FORBIDDEN'`（明确：校验的是调用者账号状态，不是目标学生） |
| 编辑目标档案 status = ARCHIVED | 返回 `errorCode: 'ARCHIVED'`，提示「已归档档案不可编辑」（MVP 不提供恢复入口） |
| 出生日期是未来日期 | handler 校验 `birth_date <= 当前日期`，否则返回 `errorCode: 'VALIDATION_ERROR'` |
| guardian_contact 格式 | **MVP 不做格式校验**（schema 仅 TEXT，无约束），非空即接受；格式校验留给后续版本 |
| username 大小写敏感性 | SQLite 默认 TEXT 比较大小写敏感，`Alice` 与 `alice` 视为不同用户。MVP 接受原样存储，**不**强制 lowercase（避免引入额外规范化逻辑） |
| sensory_profile_json 为 null vs `{}` | 约定：`null` = 未填写感官画像（默认值）；`{}` 不使用。前端清空所有敏感度时传 `null`，不传 `{}`。handler 校验：null 通过，非 null 对象按 §8 校验 |
| 归档目标档案 status 已是 ARCHIVED | 幂等：直接返回成功（不重复写审计） |
| 归档时该学生存在开放 assessment/training session | **允许归档**（status 变更不删除已有数据）；开放 session 不受影响继续存在。但归档后该学生不可发起新 session——此校验由后续测评/训练发起功能负责，不在本 PRD |
| 归档后该学生尝试登录 | user_account.status=DISABLED，登录 handler 返回 `ACCOUNT_DISABLED`（已有逻辑）|
| 事务中 user_account INSERT 成功但 student_profile INSERT 失败 | better-sqlite3 事务回滚，两边都不写入，返回系统错误 |
| DB 未初始化 | `getDatabase()` 抛出，handler 捕获返回 `errorCode: 'SYSTEM_ERROR'` |
| IPC 异常 | 主进程 try/catch，写 error_event_log（severity=ERROR），返回 `SYSTEM_ERROR` |
| 学生列表为空 | 前端展示空状态引导（「点击新建学生开始」）|
| `form.value`（Vue Proxy）直接传入 IPC | **必须展开为普通对象**再传（`{ ...form.value }` 或显式构造），否则无法通过 contextBridge 序列化 |

---

## 与现有功能的接口关系

| 资源 | 关系 |
|---|---|
| `student_profile` 表 | 本功能的核心读写对象 |
| `user_account` 表 | create/archive 时写入；**约定 `user_account.user_id === student_profile.student_id`（同 UUID）**作为两表的隐式关联（schema 无 FK，应用层维护）|
| `error_event_log` 表 | create/update/archive 写 INFO 审计；系统异常写 ERROR |
| `error_code_registry` 表 | handler 启动时 `INSERT OR IGNORE` 补充本功能错误码（error_category='SYSTEM'，不改 schema.sql；详见风险点）|
| `src/main/db/connection.ts` | `getDatabase()` 由 handler 调用 |
| `src/main/utils/password.ts` | `hashPassword()` 用于 create 时哈希初始密码（复用现有 pbkdf2 实现）|
| `src/main/ipc/index.ts` | import `./handlers/student` 完成注册 |
| Pinia `useAuthStore` | 提供 `userId` / `role` 作为 IPC 的 caller 身份参数 |
| 全局路由守卫 | 已保护 `/teacher/*`，未登录自动跳 `/login`（无需改动）|
| 后续测评发起功能 | 依赖本功能产出的 `student_id`；且需校验 `student_profile.status = ACTIVE` 才允许发起新 session |
| 后续学生端「个人档案查看」功能 | 只读引用 `student_profile`，按 student_id（= 登录 user_id）查询自己 |

---

## 成功验收标准

| # | 场景 | 预期结果 |
|---|---|---|
| 1 | 教师填写完整表单创建学生 | user_account + student_profile 均写入，跳转详情页，列表可见 |
| 2 | 创建时 username 已存在 | 提示「用户名已被占用」，不写入任何表 |
| 3 | 创建后用该学生账号登录（初始密码） | 登录成功，跳转 `/student` |
| 4 | 必填字段为空提交 | 前端阻断；绕过前端则后端返回 VALIDATION_ERROR |
| 5 | sensory_profile_json 枚举值越界 | 返回 INVALID_SENSORY_PROFILE，不写入 |
| 6 | 教师编辑档案基本信息（姓名/性别/出生日期） | 字段更新，updated_at 刷新，审计日志写入 |
| 7 | 教师编辑感官画像（§17.1 验收项） | sensory_profile_json 整体替换，校验通过 |
| 8 | STUDENT 角色调用 student:create | 返回 FORBIDDEN |
| 9 | 编辑 status=ARCHIVED 的档案 | 返回 ARCHIVED 错误 |
| 10 | 教师归档学生 | student_profile.status=ARCHIVED + user_account.status=DISABLED，二次确认 |
| 11 | 归档后该学生尝试登录 | 返回 ACCOUNT_DISABLED |
| 12 | 学生列表按姓名搜索 | 仅返回匹配项 |
| 13 | 学生列表分页 | 默认按创建时间倒序，每页 20 条 |
| 13b | 学生列表默认过滤 | 仅返回 ACTIVE；includeArchived=true 时包含 ARCHIVED |
| 14 | 出生日期为未来日期 | 返回 VALIDATION_ERROR |
| 15 | 每次操作写 error_event_log | create/update/archive 各一条 INFO，error_category='SYSTEM'，related_aggregate_type='STUDENT_PROFILE'，含 student_id + callerUserId |
| 16 | 类型检查 | `npm run typecheck` 通过 |
| 17 | 构建 | `npm run build` 通过 |

---

## 风险点

**[!] user_account ↔ student_profile 关联依赖应用层约定（无 schema FK）**

schema v0.1.7 冻结基线中，两表无 FK 互通。本 PRD 采用「同 UUID 复用」约定（`user_id === student_id`）建立隐式关联。这意味着：
- 关联完整性由应用层（student.ts handler）保证，不由 DB 强制
- 任何绕过 handler 直接写 DB 的代码（如未来的批量导入脚本）必须遵守此约定
- 若未来 schema 升级允许加 FK，应将此约定上升为 DB 约束

**[!] schema 无 `created_by` 列 vs PRD §5.1「创建人」必填（已知偏差）**

schema `student_profile` 无 `created_by` 列，且 v0.1.7 为冻结基线。本 PRD 采用「审计日志方案」：在 `error_event_log` 写 INFO 记录操作人 callerUserId，满足 §14.3「创建/修改学生档案可追溯」要求。**但这不等于 PRD §5.1「创建人」必填字段的字面满足**——§5.1 列「创建人」为档案必填字段，暗示表内应持久化创建人。当前方案是**已知偏差**：审计可追溯 ≠ 表内有 created_by 列。后续 schema 升级（如 v0.2.0）应补 `created_by TEXT` 列正式满足 §5.1。MVP 阶段以「操作可追溯」为接受标准，标记为待补。

**[!] error_event_log.error_category 无 'STUDENT_PROFILE' 枚举**

schema 的 `error_event_log.error_category` 与 `error_code_registry.error_category` CHECK 枚举仅允许 IPC/DB/AOL/RECOVERY/ASSET/FSM/SCORING/REPORT/AUTH/SYSTEM。本功能审计写入用 error_category='SYSTEM'（最接近「主数据维护」语义），并通过 `related_aggregate_type='STUDENT_PROFILE'` + `related_aggregate_id=student_id` 建立关联。若后续需要专属审计分类，应在 schema 升级时扩展枚举。

**student_profile.status 的 INACTIVE 状态**

schema CHECK 允许 `ACTIVE / INACTIVE / ARCHIVED`，本 PRD 只使用 `ACTIVE → ARCHIVED` 流转。`INACTIVE` 为 schema 预留态（可用于「停用但未归档」），MVP 不使用、不提供切换入口。

**[!] caller 身份校验为应用层防御（非安全强）**

当前无 session token，caller 身份（callerUserId / callerRole）由渲染进程从 Pinia auth store 读取后随 IPC 参数传入主进程。主进程 handler 校验 callerRole，但无法防御「伪造 callerRole 的恶意渲染进程」。这与登录功能 PRD 记录的风险一致（「路由守卫为前端防御，不能替代主进程 IPC handler 的身份校验」）。MVP 单机本地、无网络攻击面，此方案可接受；后续如引入多端，需改为基于 token 的会话鉴权。

**初始密码安全**

教师建档时设置初始密码，明文经 IPC 传入主进程后立即 pbkdf2 哈希，不落盘明文。但初始密码可能被教师遗忘（MVP 不做密码重置），需在创建成功页提示教师记录。这是 MVP 已知限制，文档化即可。

**归档与开放 session 的交互**

归档不阻断已有开放 session（PRD 未要求）。归档仅阻止「新 session 发起」与「学生登录」。当测评/训练发起功能实现时，必须校验 `student_profile.status = ACTIVE`。本 PRD 不实现该校验，但记录为后续功能的依赖约束。
