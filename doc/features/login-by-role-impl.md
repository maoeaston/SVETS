## 实现目标

打通用户名密码登录的完整链路：主进程鉴权 → IPC → Pinia store → 路由守卫，使 TEACHER / STUDENT / ADMIN 三种角色均可登录并跳转到对应端布局。

---

## 前置条件

- `user_account` 表已存在（schema v0.1.7-consistency-guard ✅）
- `error_event_log` + `error_code_registry` 表已存在（schema ✅）
- `src/main/db/connection.ts` 已实现 `getDatabase()` / `initDatabase()` ✅
- `src/preload/index.ts` 骨架已存在（当前 `api = {}`）✅
- `src/renderer/src/views/LoginView.vue` 骨架已存在（含 TODO 注释）✅
- `src/renderer/src/router/index.ts` 含 `/login` / `/teacher` / `/student` 路由 ✅
- `better-sqlite3`、`uuid`、`pinia`、`vue-router` 已安装 ✅

---

## 实现步骤

### Step 1：密码哈希工具函数

**改动文件：**
- `src/main/utils/password.ts`（新建）

**核心逻辑：**

```typescript
// pbkdf2:sha512:<iterations>:<salt_hex>:<hash_hex>
import { randomBytes, pbkdf2Sync, timingSafeEqual } from 'crypto'

const ITERATIONS = 100_000
const KEY_LEN    = 64
const DIGEST     = 'sha512'

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = pbkdf2Sync(password, salt, ITERATIONS, KEY_LEN, DIGEST).toString('hex')
  return `pbkdf2:${DIGEST}:${ITERATIONS}:${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(':')
  if (parts.length !== 5 || parts[0] !== 'pbkdf2') return false
  const [, digest, iterStr, salt, expectedHash] = parts
  const iters = parseInt(iterStr, 10)
  if (isNaN(iters) || iters <= 0) return false
  const actual = pbkdf2Sync(password, salt, iters, KEY_LEN, digest).toString('hex')
  // timingSafeEqual 要求两个 Buffer 等长，长度不同时抛出 → catch 返回 false
  try {
    return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expectedHash, 'hex'))
  } catch {
    return false
  }
}
```

**测试用例：**
- 单元测试（`src/main/utils/__tests__/password.test.ts`）：
  - `hashPassword('abc')` 返回 `pbkdf2:sha512:...` 格式字符串
  - `verifyPassword('abc', hashPassword('abc'))` → `true`
  - `verifyPassword('wrong', hashPassword('abc'))` → `false`
  - 格式损坏的 stored 字符串 → `false`（不抛异常）
  - `expectedHash` 与 `actual` 长度不同时 `timingSafeEqual` 会抛，需 catch → `false`

**commit message 建议：**
`feat(auth): add pbkdf2 password hash/verify utility`

---

### Step 2：auth:login IPC handler

**改动文件：**
- `src/main/ipc/handlers/auth.ts`（新建）
- `src/main/ipc/index.ts`（添加 import）

**核心逻辑：**

```typescript
// handlers/auth.ts
import { ipcMain } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import { getDatabase } from '../../db/connection'
import { verifyPassword } from '../../utils/password'

// 每次进程启动时确保 AUTH 审计错误码存在（不修改 schema.sql）
function seedAuthErrorCodes(): void {
  const db = getDatabase()
  db.prepare(`INSERT OR IGNORE INTO error_code_registry
    (error_code, error_category, severity, priority_level, title, default_message, is_blocking)
    VALUES ('AUTH_LOGIN_SUCCESS', 'AUTH', 'INFO', 'P3',
            '登录成功', '用户登录成功。', NULL, 0)`).run()
  db.prepare(`INSERT OR IGNORE INTO error_code_registry
    (error_code, error_category, severity, priority_level, title, default_message, is_blocking)
    VALUES ('AUTH_LOGIN_FAILED', 'AUTH', 'WARN', 'P3',
            '登录失败', '用户名或密码错误，或账号已停用。', NULL, 0)`).run()
}

export function registerAuthHandlers(): void {
  seedAuthErrorCodes()

  ipcMain.handle('auth:login', (_event, params: { username: string; password: string }) => {
    const db = getDatabase()

    const row = db.prepare(
      `SELECT user_id, password_hash, role, display_name, status
       FROM user_account WHERE username = ?`
    ).get(params.username) as {
      user_id: string; password_hash: string
      role: string; display_name: string; status: string
    } | undefined

    // 账号不存在或密码错误：统一错误，不区分
    if (!row || !verifyPassword(params.password, row.password_hash)) {
      logAuth(db, 'AUTH_LOGIN_FAILED',
        `Login failed for username: ${params.username}`)
      return { success: false as const, errorCode: 'INVALID_CREDENTIALS' }
    }

    if (row.status !== 'ACTIVE') {
      logAuth(db, 'AUTH_LOGIN_FAILED',
        `Login rejected: account ${row.user_id} status=${row.status}`)
      return { success: false as const, errorCode: 'ACCOUNT_DISABLED' }
    }

    logAuth(db, 'AUTH_LOGIN_SUCCESS',
      `User ${row.user_id} (${row.role}) logged in`)

    return {
      success: true as const,
      userId: row.user_id,
      role: row.role as 'STUDENT' | 'TEACHER' | 'ADMIN',
      displayName: row.display_name
    }
  })
}

function logAuth(db: ReturnType<typeof getDatabase>, code: string, msg: string): void {
  try {
    db.prepare(`INSERT INTO error_event_log
      (error_event_id, error_code, severity, error_category, message, created_at)
      VALUES (?, ?, (SELECT severity FROM error_code_registry WHERE error_code = ?),
              'AUTH', ?, datetime('now'))`
    ).run(uuidv4(), code, code, msg)
  } catch {
    // 审计写入失败不影响登录流程
    console.error('[Auth] Failed to write audit log')
  }
}
```

```typescript
// ipc/index.ts
import { registerAuthHandlers } from './handlers/auth'

registerAuthHandlers()

export {}
```

**测试用例：**
- 集成测试（需真实 SQLite，`src/main/ipc/handlers/__tests__/auth.test.ts`）：
  - 插入一个 ACTIVE TEACHER 账号（hashPassword） → login → `{ success: true, role: 'TEACHER' }`
  - 错误密码 → `{ success: false, errorCode: 'INVALID_CREDENTIALS' }`
  - 用户名不存在 → `{ success: false, errorCode: 'INVALID_CREDENTIALS' }`
  - DISABLED 账号 → `{ success: false, errorCode: 'ACCOUNT_DISABLED' }`
  - 成功登录后 `error_event_log` 有 AUTH_LOGIN_SUCCESS 记录

**commit message 建议：**
`feat(auth): add auth:login IPC handler with pbkdf2 verification and audit log`

---

### Step 3：Preload 暴露 + 类型声明

**改动文件：**
- `src/preload/index.ts`（修改 `api` 对象）
- `src/shared/types/ipc-api.ts`（添加 `auth` section）

**核心逻辑：**

```typescript
// ipc-api.ts
export interface LoginResult {
  success: true
  userId: string
  role: 'STUDENT' | 'TEACHER' | 'ADMIN'
  displayName: string
}

export interface LoginError {
  success: false
  errorCode: 'INVALID_CREDENTIALS' | 'ACCOUNT_DISABLED' | 'SYSTEM_ERROR'
}

export interface IpcApi {
  auth: {
    login: (params: { username: string; password: string }) => Promise<LoginResult | LoginError>
  }
}
```

```typescript
// preload/index.ts  (api 对象)
import { ipcRenderer } from 'electron'

const api = {
  auth: {
    login: (params: { username: string; password: string }) =>
      ipcRenderer.invoke('auth:login', params)
  }
}
```

**测试用例：**
- 单元测试：类型兼容性检查（TypeScript 编译即验证）
- 手工验收：`window.api.auth` 在 DevTools Console 中可见

**commit message 建议：**
`feat(auth): expose auth.login in preload and declare IpcApi types`

---

### Step 4：Pinia auth store

**改动文件：**
- `src/renderer/src/stores/auth.ts`（新建）

**核心逻辑：**

```typescript
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useAuthStore = defineStore('auth', () => {
  const userId      = ref<string | null>(null)
  const role        = ref<'STUDENT' | 'TEACHER' | 'ADMIN' | null>(null)
  const displayName = ref<string | null>(null)

  const isLoggedIn  = computed(() => userId.value !== null)

  function setUser(data: { userId: string; role: 'STUDENT' | 'TEACHER' | 'ADMIN'; displayName: string }): void {
    userId.value      = data.userId
    role.value        = data.role
    displayName.value = data.displayName
  }

  function clear(): void {
    userId.value      = null
    role.value        = null
    displayName.value = null
  }

  return { userId, role, displayName, isLoggedIn, setUser, clear }
})
```

设计说明：
- 不使用 `localStorage` 持久化，关闭应用 = 自动登出（有意设计）
- 不在 store 中调用 IPC，数据由 `LoginView` 注入（视图层负责 IPC，store 只存状态）

**测试用例：**
- 单元测试（`src/renderer/src/stores/__tests__/auth.test.ts`）：
  - 初始状态 `isLoggedIn = false`
  - `setUser(...)` 后 `isLoggedIn = true`，各字段正确
  - `clear()` 后恢复初始状态

**commit message 建议：**
`feat(auth): add useAuthStore Pinia store`

---

### Step 5：路由守卫 + LoginView 接入 IPC

**改动文件：**
- `src/renderer/src/router/index.ts`（添加全局守卫）
- `src/renderer/src/views/LoginView.vue`（接入 IPC，替换 TODO）

**核心逻辑：**

```typescript
// router/index.ts — 在 createRouter(...) 之后添加

router.beforeEach((to, _from) => {
  const authStore = useAuthStore()
  const protectedPrefixes = ['/teacher', '/student']
  const needsAuth = protectedPrefixes.some(p => to.path.startsWith(p))

  if (needsAuth && !authStore.isLoggedIn) {
    return { path: '/login' }
  }
})

export default router
```

注意：`useAuthStore()` 必须在 Pinia 实例创建后调用（`beforeEach` 回调内调用，不是模块顶层）。`main.ts` 中 `app.use(createPinia())` 在 `app.use(router)` 之前 ✅，时序正确。

```typescript
// LoginView.vue — handleLogin 替换
async function handleLogin(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const result = await window.api.auth.login(form.value)
    if (!result.success) {
      error.value = result.errorCode === 'ACCOUNT_DISABLED'
        ? '账号已停用，请联系管理员'
        : '用户名或密码错误'
      return
    }
    authStore.setUser(result)
    if (result.role === 'STUDENT') {
      await router.push('/student')
    } else {
      // TEACHER 和 ADMIN 均进入教师端
      await router.push('/teacher')
    }
  } catch {
    error.value = '系统异常，请重试'
  } finally {
    loading.value = false
  }
}
```

**测试用例：**
- 手工验收（无法自动化 Electron IPC）：
  - 未登录访问 `/#/teacher` → 重定向到 `/#/login`
  - 未登录访问 `/#/student` → 重定向到 `/#/login`
  - TEACHER 登录 → 跳转 `/teacher`，TeacherLayout 渲染
  - STUDENT 登录 → 跳转 `/student`，StudentLayout 渲染
  - 错误密码 → 显示「用户名或密码错误」
  - DISABLED → 显示「账号已停用」

**commit message 建议：**
`feat(auth): wire LoginView to IPC and add router navigation guard`

---

### Step 6：开发种子账号脚本

**改动文件：**
- `scripts/seed-dev-accounts.ts`（新建）

**核心逻辑：**

独立脚本，直接操作 SQLite（绕过 Electron IPC，仅用于开发环境初始化）。

```typescript
// scripts/seed-dev-accounts.ts
// 用法：npx ts-node --require tsconfig-paths/register scripts/seed-dev-accounts.ts
import Database from 'better-sqlite3'
import { join } from 'path'
import { homedir } from 'os'
import { v4 as uuidv4 } from 'uuid'
import { hashPassword } from '../src/main/utils/password'

// 开发环境 userData 路径（Windows）
const dataDir = join(homedir(), 'AppData', 'Roaming', 'xc-career-guide', 'data')
const db = new Database(join(dataDir, 'xc-career-guide.db'))

const accounts = [
  { username: 'admin',   password: 'Admin@123',   role: 'ADMIN',   displayName: '系统管理员' },
  { username: 'teacher', password: 'Teacher@123', role: 'TEACHER', displayName: '测试教师' },
  { username: 'student', password: 'Student@123', role: 'STUDENT', displayName: '测试学生' },
]

const stmt = db.prepare(`
  INSERT OR IGNORE INTO user_account
    (user_id, username, password_hash, role, display_name, status)
  VALUES (?, ?, ?, ?, ?, 'ACTIVE')
`)

for (const acc of accounts) {
  stmt.run(uuidv4(), acc.username, hashPassword(acc.password), acc.role, acc.displayName)
  console.log(`[seed] ${acc.role}: ${acc.username} / ${acc.password}`)
}

db.close()
console.log('[seed] Done.')
```

**测试用例：**
- 手工验收：运行脚本后，用 admin / teacher / student 账号均可登录

**commit message 建议：**
`chore(dev): add seed-dev-accounts script for local testing`

---

## 回归验收清单

- [ ] `npm run typecheck` 通过
- [ ] `npm run build` 通过
- [ ] `npx vitest run` 通过（password 工具单元测试 + auth store 单元测试）
- [ ] 手工冒烟：
  - 运行 `seed-dev-accounts.ts` 初始化开发账号
  - 启动应用，访问 `/#/teacher` 被重定向到 `/#/login`
  - 用 `teacher / Teacher@123` 登录 → 跳转 `/teacher`
  - 用 `student / Student@123` 登录 → 跳转 `/student`
  - 用 `admin / Admin@123` 登录 → 跳转 `/teacher`
  - 错误密码 → 显示错误提示，按钮恢复可点击
  - 查询 `error_event_log` 有 `AUTH_LOGIN_SUCCESS` 记录
