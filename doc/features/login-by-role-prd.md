## 功能名称

用户名密码登录（按角色跳转教师端 / 学生端）

文件名：`login-by-role-prd.md`  
PRD 版本：v1.0.9 authoritative 对齐说明
创建日期：2026-07-01  
对应主 PRD：`doc/specs/MVP_PRD_v1.0.9-authoritative.md`
状态：`CURRENT_WITH_F2_SESSION_BASELINE_2026-07-22`

---

## 当前实现说明（2026-07-22）

本页保留最初“用户名密码登录”功能的业务意图，但当前权威实现已经进入 F2 登录会话收口阶段，和最初版本相比有 4 个关键变化：

1. 登录成功后不仅返回用户展示信息，还会在主进程创建一条 PASSWORD `auth_session`。
2. 新增 `auth:getCurrentSession` 和 `auth:logout`，页面刷新时先向主进程恢复可信会话，整应用完全退出后仍需重新登录。
3. 路由守卫改为读取路由元数据角色声明；前端只负责页面体验，主进程继续承担最终权限判定。
4. `student:*` IPC 包装层已经改为从会话解析真实 TEACHER / ADMIN 身份，不再信任渲染进程单独上传的 `callerUserId/callerRole`。
5. 管理员账号维护现提供 `auth:listAccounts`、`auth:createTeacherAccount` 与 `auth:setTeacherAccountStatus`；只允许管理 TEACHER，停用会立即撤销有效会话，重新启用不会恢复旧会话，所有响应都不暴露密码哈希或会话令牌。

## 解决的问题

系统当前有登录页 UI 骨架（`LoginView.vue`），但 IPC 鉴权逻辑未实现，任何用户无法进入教师端或学生端。本功能打通登录链路，使系统从「可启动」变为「可使用」。

---

## 用户角色

| 角色 | 登录后跳转 |
|---|---|
| `TEACHER` | `/teacher` |
| `STUDENT` | `/student` |
| `ADMIN` | `/admin`（仍复用教师端布局，但使用独立管理路由入口）|

---

## 核心使用场景（流程步骤）

1. 用户打开应用，Vue Router 自动重定向到 `/login`
2. 输入用户名和密码，点击「登录」
3. 渲染进程通过 `window.api.auth.login({ username, password })` 发起 IPC 调用
4. 主进程查询 `user_account`：
   - 验证 username 存在
   - 验证 `status = 'ACTIVE'`
   - 验证 `password_hash` 与输入密码匹配（`crypto.pbkdf2Sync`）
5. 验证通过：
   - 写入 `error_event_log`（category: `AUTH`, severity: `INFO`）
   - 创建一条 PASSWORD `auth_session`
   - 仅返回公开会话摘要 `{ authSessionId, userId, role, displayName, expiresAt }`
6. 渲染进程写入 Pinia `useAuthStore`，按角色跳转：
   - `TEACHER` → `/teacher`
   - `ADMIN` → `/admin`
   - `STUDENT` → `/student`
7. 页面刷新时，Vue Router 首次守卫调用 `auth:getCurrentSession`；若主进程仍持有有效绑定会话，则自动恢复用户状态
8. 用户点击“退出”时，调用 `auth:logout` 撤销当前绑定会话并返回 `/login`
9. 验证失败：返回错误码，`LoginView` 展示友好提示

---

## 功能范围

### 本次做

- `src/main/ipc/handlers/auth.ts`：注册 `auth:login` / `auth:getCurrentSession` / `auth:logout`
- `src/main/ipc/handlers/auth.ts`：额外注册 ADMIN-only 的 `auth:listAccounts` / `auth:createTeacherAccount` / `auth:setTeacherAccountStatus`
- `src/main/utils/auth-session.ts`：管理 PASSWORD `auth_session`、会话绑定、撤销和恢复
- `src/preload/index.ts`：暴露 `window.api.auth.login/getCurrentSession/logout`
- `src/shared/types/ipc-api.ts`：添加 `auth` section 类型声明
- `src/renderer/src/stores/auth.ts`：Pinia `useAuthStore`（存 `authSessionId` / `userId` / `role` / `displayName` / `expiresAt`，不持久化到 localStorage）
- `src/renderer/src/views/LoginView.vue`：接入 IPC，替换 TODO 注释
- `src/renderer/src/router/index.ts`：添加全局 navigation guard，先恢复可信会话，再按路由元数据控制访问
- 密码哈希：使用 Node.js 内置 `crypto.pbkdf2Sync`（无额外依赖，Electron 兼容）
- `student:*` IPC 包装层：优先从可信会话解析 TEACHER / ADMIN 身份

### 本次不做

- 学生自助注册、ADMIN 账号创建与角色提升（教师账号由管理员创建；学生账号仍由学生档案流程创建）
- 记住密码 / 自动登录
- 密码修改 / 忘记密码
- JWT / 浏览器本地存储式 token 持久化（会话只保留在主进程；完整退出应用后需重新登录）
- 登录事件写入 `domain_event_projection`（登录不是领域状态变更，不属于 aggregate 事件；审计需求通过 `error_event_log` 满足）
- 多因素认证
- 登录频率限制（单机本地，无网络攻击面）
- 其余 assessment / training / strategy / assignment 管理型 IPC 的会话收口（继续在 F2 后续子步推进）

---

## 边界条件和异常处理

| 场景 | 处理 |
|---|---|
| 用户名不存在 | 返回统一错误「用户名或密码错误」，不泄露是哪个字段错 |
| 密码错误 | 同上，统一错误 |
| 账号 `status = 'DISABLED'` | 提示「账号已停用，请联系管理员」 |
| 账号 `status = 'ARCHIVED'` | 同上，提示「账号已停用，请联系管理员」 |
| 用户名 / 密码为空 | 前端 `required` 阻断，不发 IPC |
| IPC 调用异常（DB 错误、超时等） | 主进程捕获，写入 `error_event_log`（`IPC_WRITE_TIMEOUT` 或 `DB` 类），返回系统错误；前端提示「系统异常，请重试」 |
| DB 未初始化 | `getDatabase()` 抛出，IPC 捕获并返回系统异常 |
| 登录成功后点浏览器返回键 | 全局路由守卫阻止已登录用户回到 `/login`（redirect 到对应端首页）|
| 页面刷新 | 主进程若仍持有有效绑定会话，则自动恢复 |
| 关闭应用后重新打开 | 主进程会话绑定消失，用户需重新登录 |

---

## 与现有功能的接口关系

| 资源 | 关系 |
|---|---|
| `user_account` 表 | 登录读取；管理员可读取、创建、停用和重新启用教师账号 |
| `auth_session` 表 | 登录写入 PASSWORD 会话；刷新恢复和退出按 token_hash 校验 / 撤销 |
| `error_event_log` | 成功登录写 INFO，系统异常写 ERROR/CRITICAL |
| `src/main/db/connection.ts` | `getDatabase()` 由 auth handler 调用 |
| `src/main/ipc/index.ts` | 在此 import `./handlers/auth` 完成注册 |
| Pinia `useAuthStore` | 其他功能模块通过此 store 获取当前用户展示信息；真实权限仍由主进程会话决定 |
| 全局路由守卫 | 在 `router/index.ts` 的 `beforeEach` 中实现，先恢复会话，再保护 `/teacher` / `/admin` / `/student` |

---

## 成功验收标准

| # | 场景 | 预期结果 |
|---|---|---|
| 1 | TEACHER 账号登录 | 跳转 `/teacher`，TeacherLayout 正常渲染 |
| 2 | STUDENT 账号登录 | 跳转 `/student`，StudentLayout 正常渲染 |
| 3 | ADMIN 账号登录 | 跳转 `/admin` |
| 4 | 错误密码 | LoginView 显示「用户名或密码错误」，不崩溃 |
| 5 | DISABLED 账号 | 显示「账号已停用，请联系管理员」 |
| 6 | ARCHIVED 账号 | 同上 |
| 7 | 未登录直接访问 `/teacher` | 重定向到 `/login` |
| 8 | 未登录直接访问 `/student` | 重定向到 `/login` |
| 9 | 页面刷新后 | 有效会话可自动恢复到对应端 |
| 10 | 退出后 | 会话被撤销，再恢复返回无会话 |
| 11 | 登录成功后 Pinia auth store | 含 `authSessionId` / `userId` / `role` / `displayName` / `expiresAt` |
| 12 | 伪造 `callerUserId/callerRole` 调 student IPC | 以主进程会话身份为准，不越权 |
| 13 | 成功登录写 error_event_log | 有一条 category=AUTH, severity=INFO 的记录 |
| 14 | 类型检查 | `npm run typecheck` 通过 |
| 15 | 构建 | `npm run build` 通过 |

---

## 风险点

**[!] 密码哈希算法选择**  
schema 只定义 `password_hash` 字段，未规定算法。本功能选用 `crypto.pbkdf2Sync`（Node.js 内置，无额外依赖，Electron 打包无 native addon 兼容问题）。哈希格式建议：`pbkdf2:sha512:<iterations>:<salt_hex>:<hash_hex>`，存储在 `password_hash` 中。种子数据脚本必须使用相同格式生成初始账号。若后续需替换算法，需编写账号迁移脚本并重新哈希。

**[!] F2 仍在进行中**
当前只有 `student:*` 包装层已切到可信 `auth_session` 身份；assessment / training / strategy / assignment 等入口仍需继续按同一模式收口。

---

## 附：密码哈希格式规范（供实现参考）

```
password_hash 字段格式：
pbkdf2:sha512:<iterations>:<salt_hex>:<hash_hex>

示例：
pbkdf2:sha512:100000:a1b2c3d4...(16字节hex):<64字节hex>

验证逻辑：
1. 拆分字段获取 salt 和 iterations
2. 对输入密码执行 crypto.pbkdf2Sync(password, salt, iterations, 64, 'sha512')
3. timingSafeEqual 比较 hash
```
