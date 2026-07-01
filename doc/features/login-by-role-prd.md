## 功能名称

用户名密码登录（按角色跳转教师端 / 学生端）

文件名：`login-by-role-prd.md`  
PRD 版本：v1.0.0  
创建日期：2026-07-01  
对应主 PRD：炫灿-职途向导系统 MVP PRD v1.0.4  
状态：已通过审查

---

## 解决的问题

系统当前有登录页 UI 骨架（`LoginView.vue`），但 IPC 鉴权逻辑未实现，任何用户无法进入教师端或学生端。本功能打通登录链路，使系统从「可启动」变为「可使用」。

---

## 用户角色

| 角色 | 登录后跳转 |
|---|---|
| `TEACHER` | `/teacher` |
| `STUDENT` | `/student` |
| `ADMIN` | `/teacher`（MVP 阶段，管理功能集成在教师端，不单独建 admin 路由）|

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
   - 写入 `error_event_log`（category: `AUTH`, severity: `INFO`，记录 userId + role，满足 PRD §14.3 审计要求）
   - 返回 `{ userId, role, displayName }`
6. 渲染进程写入 Pinia `useAuthStore`，按角色跳转：
   - `TEACHER` / `ADMIN` → `/teacher`
   - `STUDENT` → `/student`
7. 验证失败：返回错误码，`LoginView` 展示友好提示

---

## 功能范围

### 本次做

- `src/main/ipc/handlers/auth.ts`：注册 `auth:login` IPC handler
- `src/preload/index.ts`：暴露 `window.api.auth.login`
- `src/shared/types/ipc-api.ts`：添加 `auth` section 类型声明
- `src/renderer/src/stores/auth.ts`：Pinia `useAuthStore`（存 `userId` / `role` / `displayName`，不持久化到 localStorage）
- `src/renderer/src/views/LoginView.vue`：接入 IPC，替换 TODO 注释
- `src/renderer/src/router/index.ts`：添加全局 navigation guard，未登录访问 `/teacher` 或 `/student` 重定向到 `/login`
- 密码哈希：使用 Node.js 内置 `crypto.pbkdf2Sync`（无额外依赖，Electron 兼容）
- 初始种子账号脚本（或文档）：提供 ADMIN / TEACHER / STUDENT 各一个测试账号，哈希格式与 handler 一致

### 本次不做

- 注册功能（账号由管理员在 DB 层维护）
- 记住密码 / 自动登录
- 密码修改 / 忘记密码
- JWT / session token 持久化（MVP 单机本地，进程内 Pinia state 足够；关闭应用 = 自动登出，此为有意设计）
- ADMIN 独立 UI 路由（ADMIN 进入 `/teacher` 共用教师端布局）
- 登录事件写入 `domain_event_projection`（登录不是领域状态变更，不属于 aggregate 事件；审计需求通过 `error_event_log` 满足）
- 多因素认证
- 登录频率限制（单机本地，无网络攻击面）
- 已登录用户直接访问 `/login` 时的重定向（MVP 可接受）

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
| 关闭应用后重新打开 | Pinia state 清空，用户需重新登录（有意设计，无需提示）|

---

## 与现有功能的接口关系

| 资源 | 关系 |
|---|---|
| `user_account` 表 | 只读查询，不写入 |
| `error_event_log` | 成功登录写 INFO，系统异常写 ERROR/CRITICAL |
| `src/main/db/connection.ts` | `getDatabase()` 由 auth handler 调用 |
| `src/main/ipc/index.ts` | 在此 import `./handlers/auth` 完成注册 |
| Pinia `useAuthStore` | 其他功能模块（教师端、学生端）通过此 store 获取当前用户身份，不重复查 DB |
| 全局路由守卫 | 在 `router/index.ts` 的 `beforeEach` 中实现，保护 `/teacher` 和 `/student` 前缀下所有路由（包括未来添加的 children）|

---

## 成功验收标准

| # | 场景 | 预期结果 |
|---|---|---|
| 1 | TEACHER 账号登录 | 跳转 `/teacher`，TeacherLayout 正常渲染 |
| 2 | STUDENT 账号登录 | 跳转 `/student`，StudentLayout 正常渲染 |
| 3 | ADMIN 账号登录 | 跳转 `/teacher` |
| 4 | 错误密码 | LoginView 显示「用户名或密码错误」，不崩溃 |
| 5 | DISABLED 账号 | 显示「账号已停用，请联系管理员」 |
| 6 | ARCHIVED 账号 | 同上 |
| 7 | 未登录直接访问 `/teacher` | 重定向到 `/login` |
| 8 | 未登录直接访问 `/student` | 重定向到 `/login` |
| 9 | 登录成功后 Pinia auth store | 含 `userId` / `role` / `displayName` |
| 10 | 成功登录写 error_event_log | 有一条 category=AUTH, severity=INFO 的记录 |
| 11 | 类型检查 | `npm run typecheck` 通过 |
| 12 | 构建 | `npm run build` 通过 |

---

## 风险点

**[!] 密码哈希算法选择**  
schema 只定义 `password_hash` 字段，未规定算法。本功能选用 `crypto.pbkdf2Sync`（Node.js 内置，无额外依赖，Electron 打包无 native addon 兼容问题）。哈希格式建议：`pbkdf2:sha512:<iterations>:<salt_hex>:<hash_hex>`，存储在 `password_hash` 中。种子数据脚本必须使用相同格式生成初始账号。若后续需替换算法，需编写账号迁移脚本并重新哈希。

**[!] ADMIN 无独立路由**  
ADMIN 登录后进入 `/teacher`，TeacherLayout 需根据 `role` 显示 / 隐藏管理功能入口。此决策在本功能 PRD 锁定，TeacherLayout 后续实现时必须从 `useAuthStore` 读取 `role`。

**低风险：路由守卫为前端防御**  
渲染进程路由守卫是 UI 层防御，不能替代主进程 IPC handler 的身份校验。MVP 阶段各 IPC handler 尚未实现 caller role 校验，后续功能开发时需在各 handler 中补充（不在本 PRD 范围内）。

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
