# 学生档案管理 — 实现文档

对应 PRD：`doc/features/student-profile-prd.md`
分支：`feat/student-profile`
创建日期：2026-07-01
状态：v1.1（已过 Reviewer，修订 severity bug / build 顺序 / 测试盲区）

---

## 实现目标（一句话）

教师可在教师端创建、查看、编辑、归档学生档案（同时开通学生登录账号），学生凭初始密码可登录学生端。

## 前置条件

- 已落地：登录功能（`auth:login` handler、`useAuthStore`、全局路由守卫）——commit 4344b9f + fb70618
- 已存在表：`user_account`、`student_profile`、`error_event_log`、`error_code_registry`（schema v0.1.7）
- 已存在工具：`src/main/utils/password.ts`（hashPassword / verifyPassword）、`src/main/db/connection.ts`（getDatabase）
- TeacherLayout 当前为占位页，本功能将其改造为带导航 + router-view 的布局

## 关键设计决策（贯穿所有步骤）

1. **同 UUID 复用**：`student:create` 时生成一个 UUID，同时写入 `user_account.user_id` 和 `student_profile.student_id`，作为两表隐式关联（schema 无 FK，应用层维护）
2. **caller 身份**：每个 handler 接收 `{ callerUserId, callerRole, ... }`，校验 callerRole ∈ {TEACHER, ADMIN} 且 caller 的 user_account.status = ACTIVE 且 role 与 callerRole 一致。这是软校验（无 token），MVP 可接受（PRD 风险点已记录）
3. **审计写 error_event_log**：error_category='SYSTEM'（枚举不含 STUDENT_PROFILE），related_aggregate_type='STUDENT_PROFILE'，related_aggregate_id=student_id。**recovery_status 不显式写**（用 schema 默认 'UNRESOLVED'）——审计 INFO 不是「已解决异常」，写 RESOLVED 会污染运维查询
4. **sensory_profile_json 校验**：手写纯函数校验（接口小，不引入 ajv），null 通过，非 null 按 JSON 字段规范 §8 校验
5. **事务**：create 用 better-sqlite3 `db.transaction()` 包裹 user_account + student_profile 双写，任一失败整体回滚
6. **测试用依赖注入而非全局 mock**：`registerStudentHandlers(getDb = getDatabase)` 接收可选 db-getter，测试传入内存 DB，生产用默认值。比 `vi.mock` 更稳健（见风险与注意事项）
7. **Vue Proxy 序列化**：渲染进程所有 IPC 调用前必须 `{ ...form.value }` 展开为普通对象

---

## 实现步骤（每步对应一个 commit）

### Step 1：sensory_profile 校验函数 + 共享类型 + 单元测试

**改动文件：**
- `src/shared/types/student.ts`（新建）：所有学生相关类型的**唯一定义源**——`SensoryProfile`、`CreateStudentParams`、`UpdateStudentParams`、`StudentListParams`、`StudentSummary`、`StudentDetail`、各 Result 类型（discriminated union）。`ipc-api.ts` 的 `IpcApi.student` 从此处 import
- `src/main/utils/validate-sensory-profile.ts`（新建）：`validateSensoryProfile(input: unknown): { ok: true } | { ok: false; reason: string }` 纯函数
- `src/main/utils/__tests__/validate-sensory-profile.test.ts`（新建）：单元测试

**核心逻辑（validate-sensory-profile.ts）：**

```ts
const SENSITIVITY_LEVELS = ['LOW', 'MEDIUM', 'HIGH'] as const

export function validateSensoryProfile(input: unknown): { ok: true } | { ok: false; reason: string } {
  if (input == null) return { ok: true }              // null/undefined = 未填写，通过
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, reason: 'sensory_profile must be an object or null' }
  }
  const obj = input as Record<string, unknown>
  for (const key of ['noise_sensitivity','light_sensitivity','tactile_sensitivity','crowd_density_sensitivity']) {
    const v = obj[key]
    if (v != null && !SENSITIVITY_LEVELS.includes(v as any)) {
      return { ok: false, reason: `${key} must be LOW/MEDIUM/HIGH or null` }
    }
  }
  if (obj.avoid_tags != null) {
    if (!Array.isArray(obj.avoid_tags) || obj.avoid_tags.some(t => typeof t !== 'string')) {
      return { ok: false, reason: 'avoid_tags must be string[]' }
    }
  }
  if (obj.notes != null && typeof obj.notes !== 'string') {
    return { ok: false, reason: 'notes must be string' }
  }
  return { ok: true }
}
```

**测试用例：**
- null / undefined → ok
- `{}` → ok（后端容错；前端约定不发 {}）
- 完整合法对象 → ok
- `noise_sensitivity: 'EXTREME'` → fail
- 各敏感度字段值为 null → ok
- `avoid_tags: 'NOISY'`（非数组）→ fail
- `avoid_tags: [1, 2]`（元素非 string）→ fail
- `notes: 123` → fail
- 数组作为 input → fail

**commit message：** `feat(student): add sensory_profile validator and shared types`

---

### Step 2：IPC 类型 + preload 白名单 + caller 校验 + 测试 DB helper

**改动文件：**
- `src/shared/types/ipc-api.ts`（编辑）：`IpcApi` 新增 `student` section，类型从 `./student` import（不在本文件重复定义）
- `src/preload/index.ts`（编辑）：api.student 暴露 5 个 ipcRenderer.invoke
- `src/main/utils/auth-context.ts`（新建）：`assertCaller(db, callerUserId, callerRole)` 纯函数（接收 db 参数，不调 getDatabase，便于测试）
- `src/main/db/test-helpers.ts`（新建）：`createTestDb()` + `seedCaller()` 供所有 handler 测试复用
- `src/main/utils/__tests__/auth-context.test.ts`（新建）：caller 校验单元测试

> 本步 5 个文件，未超限。把 test-helpers 前移到本步，使 auth-context 可立即测试，且 Step 3 更聚焦。

**核心逻辑（auth-context.ts）：**

```ts
import type { Database } from 'better-sqlite3'
type CallerRole = 'TEACHER' | 'ADMIN' | 'STUDENT'

export type CallerCheck =
  | { ok: true; row: { user_id: string; role: string; status: string } }
  | { ok: false; errorCode: 'FORBIDDEN' }

export function assertCaller(db: Database.Database, callerUserId: unknown, callerRole: unknown): CallerCheck {
  if (callerRole !== 'TEACHER' && callerRole !== 'ADMIN') return { ok: false, errorCode: 'FORBIDDEN' }
  if (typeof callerUserId !== 'string') return { ok: false, errorCode: 'FORBIDDEN' }
  const row = db.prepare('SELECT user_id, role, status FROM user_account WHERE user_id = ?').get(callerUserId) as
    { user_id: string; role: string; status: string } | undefined
  if (!row || row.status !== 'ACTIVE' || row.role !== callerRole) return { ok: false, errorCode: 'FORBIDDEN' }
  return { ok: true, row }
}
```

**test-helpers.ts：**

```ts
import Database from 'better-sqlite3'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { hashPassword } from '../utils/password'
import { v4 as uuidv4 } from 'uuid'

export function createTestDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  // vitest 从项目根运行，process.cwd() 稳定（不依赖 __dirname / ESM）
  const schemaPath = resolve(process.cwd(), 'doc/xc-career-guide-mvp-schema-v0.1.7-consistency-guard.sql')
  db.exec(readFileSync(schemaPath, 'utf-8'))
  return db
}

export function seedCaller(db: Database.Database, role: 'TEACHER' | 'ADMIN' = 'TEACHER'): string {
  const userId = uuidv4()
  db.prepare(`INSERT INTO user_account (user_id, username, password_hash, role, display_name, status)
              VALUES (?, ?, ?, ?, ?, 'ACTIVE')`)
    .run(userId, `caller_${role.toLowerCase()}_${userId.slice(0,8)}`, hashPassword('x'), role, '测试调用者')
  return userId
}
```

**ipc-api.ts 新增（从 student.ts import）：**

```ts
import type { CreateStudentResult, UpdateStudentResult, StudentListResult,
  GetStudentResult, ArchiveStudentResult, StudentListParams } from './student'

export interface IpcApi {
  auth: { ... }  // 已有
  student: {
    list: (params: StudentListParams) => Promise<StudentListResult>
    get: (params: { callerUserId: string; callerRole: string; studentId: string }) => Promise<GetStudentResult>
    create: (params: CreateStudentParams) => Promise<CreateStudentResult>
    update: (params: UpdateStudentParams) => Promise<UpdateStudentResult>
    archive: (params: { callerUserId: string; callerRole: string; studentId: string }) => Promise<ArchiveStudentResult>
  }
}
```

**auth-context 测试用例：**
- callerRole = STUDENT → FORBIDDEN
- callerRole 缺失 / 非法值 → FORBIDDEN
- callerUserId 非字符串 → FORBIDDEN
- caller 不存在 → FORBIDDEN
- caller 存在但 status=DISABLED → FORBIDDEN
- caller 存在但 role 与传入 callerRole 不符（如传入 TEACHER 实为 ADMIN）→ FORBIDDEN
- caller 合法（ACTIVE + 角色匹配）→ ok，返回 row

**commit message：** `feat(student): add IPC types, preload whitelist, caller auth, test db helper`

---

### Step 3：handler — create（含事务、审计、error_code 种子）

**改动文件：**
- `src/main/ipc/handlers/student.ts`（新建）：`registerStudentHandlers(getDb = getDatabase)`，含 `seedStudentErrorCodes` + `logStudentEvent` 辅助 + `student:create`
- `src/main/ipc/index.ts`（编辑）：`registerStudentHandlers()`（用默认 getDatabase）
- `src/main/ipc/handlers/__tests__/student-create.test.ts`（新建）：create 集成测试

**核心逻辑（student.ts）：**

```ts
import { ipcMain } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import type { Database } from 'better-sqlite3'
import { getDatabase } from '../../db/connection'
import { hashPassword } from '../../utils/password'
import { validateSensoryProfile } from '../../utils/validate-sensory-profile'
import { assertCaller } from '../../utils/auth-context'

function todayISO(): string { return new Date().toISOString().slice(0, 10) }

function seedStudentErrorCodes(db: Database.Database): void {
  // error_category 必须 'SYSTEM'（CHECK 枚举不含 STUDENT_PROFILE）
  const codes = [
    ['STUDENT_PROFILE_CREATED', 'INFO', 'P3', '学生档案创建', '教师创建学生档案', 0],
    ['STUDENT_PROFILE_UPDATED', 'INFO', 'P3', '学生档案修改', '教师修改学生档案', 0],
    ['STUDENT_PROFILE_ARCHIVED', 'INFO', 'P3', '学生档案归档', '教师归档学生档案', 0],
    ['STUDENT_PROFILE_SYSTEM_ERROR', 'ERROR', 'P1', '学生档案系统异常', '学生档案操作异常', 1]
  ]
  const stmt = db.prepare(`INSERT OR IGNORE INTO error_code_registry
    (error_code, error_category, severity, priority_level, title, default_message, is_blocking)
    VALUES (?, 'SYSTEM', ?, ?, ?, ?, ?)`)
  for (const c of codes) stmt.run(...c)
}

// [!] 注意占位符顺序：error_code, severity 分别传 code, severity（曾误传 code 给 severity 触发 CHECK 失败）
function logStudentEvent(
  db: Database.Database,
  code: string,
  severity: 'INFO' | 'ERROR',
  studentId: string,
  callerUserId: string,
  context: Record<string, unknown>
): void {
  db.prepare(`
    INSERT INTO error_event_log
      (error_event_id, error_code, severity, error_category,
       related_aggregate_type, related_aggregate_id, message, context_json, recovery_status, created_at)
    VALUES (?, ?, ?, 'SYSTEM', 'STUDENT_PROFILE', ?, ?, ?, ?, datetime('now'))`)
    //                  ① error_code=code  ② severity=severity
    .run(uuidv4(), code, severity, studentId,
         `${code} student=${studentId} by=${callerUserId}`,
         JSON.stringify({ callerUserId, ...context }),
         severity === 'INFO' ? 'IGNORED' : 'UNRESOLVED')
  // INFO 审计非异常，标 IGNORED（schema 枚举语义：「无需处理」），不污染 ERROR 异常查询
}

export function registerStudentHandlers(getDb: () => Database.Database = getDatabase): void {
  const db = getDb()
  seedStudentErrorCodes(db)  // 注册时一次性 seed，不放到首次 create

  ipcMain.handle('student:create', (_e, params) => {
    const db = getDb()
    const caller = assertCaller(db, params.callerUserId, params.callerRole)
    if (!caller.ok) return { success: false, errorCode: 'FORBIDDEN' }

    if (!params.username || !params.password || !params.studentName) {
      return { success: false, errorCode: 'VALIDATION_ERROR' }
    }
    if (params.birthDate && params.birthDate > todayISO()) {
      return { success: false, errorCode: 'VALIDATION_ERROR' }
    }
    const sp = validateSensoryProfile(params.sensoryProfile)
    if (!sp.ok) return { success: false, errorCode: 'INVALID_SENSORY_PROFILE' }

    const studentId = uuidv4()
    const sensoryJson = params.sensoryProfile ? JSON.stringify(params.sensoryProfile) : null
    const tx = db.transaction(() => {
      db.prepare(`INSERT INTO user_account (user_id, username, password_hash, role, display_name, status)
                  VALUES (?, ?, ?, 'STUDENT', ?, 'ACTIVE')`)
        .run(studentId, params.username, hashPassword(params.password), params.studentName)
      db.prepare(`INSERT INTO student_profile (student_id, student_name, gender, birth_date, guardian_contact, sensory_profile_json, status)
                  VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')`)
        .run(studentId, params.studentName, params.gender ?? null, params.birthDate ?? null,
             params.guardianContact ?? null, sensoryJson)
    })
    try {
      tx()
    } catch (err) {
      if (String(err).includes('UNIQUE')) return { success: false, errorCode: 'USERNAME_TAKEN' }
      logStudentEvent(db, 'STUDENT_PROFILE_SYSTEM_ERROR', 'ERROR', studentId, caller.row.user_id, { error: String(err) })
      return { success: false, errorCode: 'SYSTEM_ERROR' }
    }
    logStudentEvent(db, 'STUDENT_PROFILE_CREATED', 'INFO', studentId, caller.row.user_id, { username: params.username })
    return { success: true, studentId }
  })
}
```

**测试用例（student-create.test.ts，DI 注入 testDb，无需 vi.mock）：**

```ts
// beforeEach: db = createTestDb(); callerId = seedCaller(db); registerStudentHandlers(() => db)
// 用 ipcRenderer.invoke 不可行（无 Electron），改为直接 import handler 工厂：
// 导出未注册 ipcMain 的纯函数版本，或测试内构造一个调用入口。
// 简化：测试文件 import registerStudentHandlers 后，用一个 helper 直接调内部 create 逻辑。
// （实现时建议把 create 的核心抽成纯函数 createStudentCore(db, params)，handler 薄包装，测试直接调 core）
```

- 正常创建 → success + studentId；user_account(STUDENT) + student_profile 各 1 条；**user_id === student_id（断言同 UUID）**
- 必填缺失 → VALIDATION_ERROR
- 出生日期未来 → VALIDATION_ERROR
- sensoryProfile 枚举越界 → INVALID_SENSORY_PROFILE
- username 重复 → USERNAME_TAKEN（user_account 计数不变）
- callerRole=STUDENT → FORBIDDEN
- caller 不存在 → FORBIDDEN
- caller 存在但 DISABLED → FORBIDDEN
- caller 存在但 role 不符 → FORBIDDEN
- 密码哈希格式正确（verifyPassword(initialPwd, row.password_hash) === true）
- **审计断言**：error_event_log 有 1 条，断言 `error_category='SYSTEM'`、`severity='INFO'`、`related_aggregate_type='STUDENT_PROFILE'`、`related_aggregate_id=studentId`、`context_json` 解析后 callerUserId 正确
- **事务回滚**：包装 db 让 student_profile 的 INSERT 抛错（如临时用 sinon-style stub，或 monkey-patch db.prepare 第二次返回 throw），断言 user_account 计数为 0（回滚成功）

**commit message：** `feat(student): implement student:create handler with transaction and audit`

---

### Step 4：handler — get + list

**改动文件：**
- `src/main/ipc/handlers/student.ts`（编辑）：新增 `student:get`、`student:list`
- `src/main/ipc/handlers/__tests__/student-read.test.ts`（新建）：get/list 测试

**核心逻辑：**

```ts
// get：JOIN user_account 取 username；解析 sensory_profile_json（null → null，非 null → JSON.parse）
ipcMain.handle('student:get', (_e, { callerUserId, callerRole, studentId }) => {
  const db = getDb()
  const caller = assertCaller(db, callerUserId, callerRole)
  if (!caller.ok) return { success: false, errorCode: 'FORBIDDEN' }
  const row = db.prepare(`
    SELECT sp.student_id, sp.student_name, sp.gender, sp.birth_date, sp.guardian_contact,
           sp.sensory_profile_json, sp.status, sp.created_at, sp.updated_at, ua.username
    FROM student_profile sp JOIN user_account ua ON ua.user_id = sp.student_id
    WHERE sp.student_id = ?`).get(studentId)
  if (!row) return { success: false, errorCode: 'NOT_FOUND' }
  return { success: true, student: { ...mapRow(row), sensoryProfile: row.sensory_profile_json ? JSON.parse(row.sensory_profile_json) : null } }
})

// list：默认只 ACTIVE；includeArchived 加 ARCHIVED；按 created_at DESC；每页 20；page 防御（<1 → 1）
ipcMain.handle('student:list', (_e, { callerUserId, callerRole, search, includeArchived, page }) => {
  const db = getDb()
  const caller = assertCaller(db, callerUserId, callerRole)
  if (!caller.ok) return { success: false, errorCode: 'FORBIDDEN' }
  const statuses = includeArchived ? ['ACTIVE','ARCHIVED'] : ['ACTIVE']
  const safePage = Math.max(1, page ?? 1)
  const offset = (safePage - 1) * 20
  const rows = search
    ? db.prepare(`SELECT ... WHERE status IN (${statuses.map(()=>'?').join(',')}) AND student_name LIKE ? ORDER BY created_at DESC LIMIT 20 OFFSET ?`)
        .all(...statuses, `%${search}%`, offset)   // 注：search 不转义 %/_，MVP 接受
    : db.prepare(`SELECT ... WHERE status IN (${statuses.map(()=>'?').join(',')}) ORDER BY created_at DESC LIMIT 20 OFFSET ?`)
        .all(...statuses, offset)
  return { success: true, items: rows.map(mapSummary), page: safePage }
})
```

**测试用例：**
- get 存在 → 完整 detail，sensoryProfile 解析为对象（或 null）
- get 不存在 → NOT_FOUND
- get ARCHIVED → 仍能查到（get 不过滤 status）
- STUDENT caller → FORBIDDEN
- list 空库 → items=[]
- list 插入 3 条 → 3 条，按 created_at DESC
- list search 命中 → 只返回匹配
- list includeArchived=true → 含 ARCHIVED
- list 插入 25 条，page=2 → 5 条
- **list page=3（超出）→ items=[]（不报错）**
- **list page=0 / page=-1 → 当作 page=1**
- **list page 未传 → 默认 page=1**

**commit message：** `feat(student): implement student:get and student:list handlers`

---

### Step 5：handler — update + archive

**改动文件：**
- `src/main/ipc/handlers/student.ts`（编辑）：新增 `student:update`、`student:archive`
- `src/main/ipc/handlers/__tests__/student-mutate.test.ts`（新建）：update/archive 测试

**核心逻辑（update —— 字段白名单严格）：**

```ts
// 白名单：只允许这些 key 进入 UPDATE，绝不把 patch 的任意 key 拼进 SQL
const UPDATE_FIELDS = {
  studentName: 'student_name',
  gender: 'gender',
  birthDate: 'birth_date',
  guardianContact: 'guardian_contact',
  sensoryProfile: 'sensory_profile_json'   // 序列化为 JSON 字符串
} as const
type UpdateKey = keyof typeof UPDATE_FIELDS

ipcMain.handle('student:update', (_e, { callerUserId, callerRole, studentId, patch }) => {
  const db = getDb()
  const caller = assertCaller(db, callerUserId, callerRole)
  if (!caller.ok) return { success: false, errorCode: 'FORBIDDEN' }
  const target = db.prepare('SELECT status FROM student_profile WHERE student_id = ?').get(studentId)
  if (!target) return { success: false, errorCode: 'NOT_FOUND' }
  if (target.status === 'ARCHIVED') return { success: false, errorCode: 'ARCHIVED' }

  const applied: string[] = []
  for (const key of Object.keys(patch ?? {}) as UpdateKey[]) {
    if (!(key in UPDATE_FIELDS)) continue          // 非白名单 key 静默忽略（如 username/password）
    let value = patch[key]
    if (key === 'sensoryProfile') {
      const sp = validateSensoryProfile(value)
      if (!sp.ok) return { success: false, errorCode: 'INVALID_SENSORY_PROFILE' }
      value = value ? JSON.stringify(value) : null   // null → DB null；{} 不会到这里（validate ok 但前端约定不发）
    }
    if (key === 'birthDate' && value && value > todayISO()) {
      return { success: false, errorCode: 'VALIDATION_ERROR' }
    }
    db.prepare(`UPDATE student_profile SET ${UPDATE_FIELDS[key]} = ?, updated_at = datetime('now') WHERE student_id = ?`)
      .run(value, studentId)
    applied.push(key)
  }
  if (applied.length) {
    logStudentEvent(db, 'STUDENT_PROFILE_UPDATED', 'INFO', studentId, caller.row.user_id, { fields: applied })
  }
  return { success: true }
})
```

**核心逻辑（archive —— 加 role 锁防改错账号）：**

```ts
ipcMain.handle('student:archive', (_e, { callerUserId, callerRole, studentId }) => {
  const db = getDb()
  const caller = assertCaller(db, callerUserId, callerRole)
  if (!caller.ok) return { success: false, errorCode: 'FORBIDDEN' }
  const target = db.prepare('SELECT status FROM student_profile WHERE student_id = ?').get(studentId)
  if (!target) return { success: false, errorCode: 'NOT_FOUND' }
  if (target.status === 'ARCHIVED') return { success: true }   // 幂等，不写审计

  const tx = db.transaction(() => {
    db.prepare(`UPDATE student_profile SET status='ARCHIVED', updated_at=datetime('now') WHERE student_id=?`).run(studentId)
    // [!] role='STUDENT' 锁：防止 student_id 与 user_id 不一致时改错账号
    db.prepare(`UPDATE user_account SET status='DISABLED', updated_at=datetime('now') WHERE user_id=? AND role='STUDENT'`).run(studentId)
  })
  tx()
  logStudentEvent(db, 'STUDENT_PROFILE_ARCHIVED', 'INFO', studentId, caller.row.user_id, {})
  return { success: true }
})
```

**测试用例：**
- update 基本字段 → DB 更新，updated_at 刷新
- update sensoryProfile → JSON 替换
- update sensoryProfile=null → 字段设 null
- update sensoryProfile 非法 → INVALID_SENSORY_PROFILE
- update birthDate 未来 → VALIDATION_ERROR
- update 含禁止字段（patch.username / patch.password）→ 静默忽略，只更新白名单字段
- update 目标 ARCHIVED → errorCode ARCHIVED
- update 不存在 → NOT_FOUND
- update 空 patch（无白名单字段）→ success，不写审计
- archive ACTIVE → student_profile.status=ARCHIVED + user_account.status=DISABLED
- archive 已 ARCHIVED → 幂等 success，**审计计数不变**（断言 error_event_log 条数）
- archive 后该 student 的 user_account.role 仍为 STUDENT（role 锁只改 status）
- **archive 后用初始密码登录 → ACCOUNT_DISABLED**（必测，覆盖 PRD 验收项 11；通过直接调 auth:login handler 或验证 user_account.status）
- STUDENT caller → FORBIDDEN
- 审计断言：update/archive 各写 1 条 INFO，字段全断言（error_category / related_aggregate_type / severity）

**commit message：** `feat(student): implement student:update and student:archive handlers`

---

### Step 6：渲染 — 列表页 + TeacherLayout 改造 + 路由 + 表单占位

**改动文件：**
- `src/renderer/src/views/teacher/TeacherLayout.vue`（编辑）：占位页 → 侧栏导航（「学生列表」「新建学生」）+ `<RouterView />`；展示 auth.displayName
- `src/renderer/src/views/teacher/StudentListView.vue`（新建）：搜索 + 新建按钮 + 表格 + 状态标签 + 分页
- `src/renderer/src/views/teacher/StudentFormView.vue`（**新建占位**）：仅一个 `<h2>学生表单（待实现）</h2>`，**保证 Step 6 路由的动态 import 在 typecheck/build 时不报错**
- `src/renderer/src/router/index.ts`（编辑）：`/teacher` 增 children

> 本步 4 文件。StudentFormView 在 Step 7 填充真实表单。**这样保证 Step 6 commit 后 typecheck + build 通过**（路由静态分析需找到该模块）。

**路由（router/index.ts）：**

```ts
{ path: '/teacher', component: () => import('../views/teacher/TeacherLayout.vue'), children: [
  { path: '', redirect: '/teacher/students' },
  { path: 'students', component: () => import('../views/teacher/StudentListView.vue') },
  { path: 'students/new', component: () => import('../views/teacher/StudentFormView.vue') },
  { path: 'students/:id', component: () => import('../views/teacher/StudentFormView.vue') }
]}
```

**StudentListView 关键点：**

```ts
const res = await window.api.student.list({
  callerUserId: auth.userId!,    // 登录后必有
  callerRole: auth.role!,
  search: search.value || undefined
})
// 注意：不直接传 form.value（本处无表单对象，参数均为原始值，无需展开）
```

**测试用例（手工验收点）：**
- 登录教师端 → 自动跳 /teacher/students，显示列表或空状态
- 搜索框输入 → 触发 list（防抖 300ms）
- 点「新建学生」→ 跳 /teacher/students/new，显示 Step 6 占位（Step 7 替换为表单）
- 状态标签正确（ACTIVE / ARCHIVED）
- **Step 6 commit 前 typecheck + build 必须通过**

**commit message：** `feat(student): add student list view, teacher layout, routes with form placeholder`

---

### Step 7：渲染 — 新建/编辑表单页（替换占位）

**改动文件：**
- `src/renderer/src/views/teacher/StudentFormView.vue`（编辑：替换占位）：新建 + 编辑共用，按 `route.params.id` 区分模式。**不抽 composable**（逻辑简单，内联）

**核心逻辑：**

```vue
<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const isEdit = computed(() => !!route.params.id)
const submitting = ref(false)
const errorMsg = ref('')

const form = reactive({
  username: '', password: '', confirmPassword: '',
  studentName: '', gender: '' as '' | 'MALE' | 'FEMALE' | 'OTHER' | 'UNKNOWN',
  birthDate: '', guardianContact: '',
  sp: {
    noise: '' as '' | 'LOW' | 'MEDIUM' | 'HIGH',
    light: '' as '' | 'LOW' | 'MEDIUM' | 'HIGH',
    tactile: '' as '' | 'LOW' | 'MEDIUM' | 'HIGH',
    crowd: '' as '' | 'LOW' | 'MEDIUM' | 'HIGH',
    avoidTags: [] as string[],
    notes: ''
  }
})

onMounted(async () => {
  if (!isEdit.value) return
  const res = await window.api.student.get({ callerUserId: auth.userId!, callerRole: auth.role!, studentId: route.params.id as string })
  if (!res.success) { errorMsg.value = '加载失败'; return }
  form.studentName = res.student.studentName
  // ...回填其他字段；sensoryProfile → form.sp
})

function buildSensoryPayload() {
  const { noise, light, tactile, crowd, avoidTags, notes } = form.sp
  if (!noise && !light && !tactile && !crowd && !avoidTags.length && !notes) return null
  return {
    noise_sensitivity: noise || null,
    light_sensitivity: light || null,
    tactile_sensitivity: tactile || null,
    crowd_density_sensitivity: crowd || null,
    avoid_tags: avoidTags,
    notes: notes || undefined
  }
}

async function submit() {
  errorMsg.value = ''
  if (!isEdit.value && form.password !== form.confirmPassword) { errorMsg.value = '两次密码不一致'; return }
  // [!] 构造普通对象——Vue reactive proxy 不能直接经 IPC 序列化
  const base = {
    studentName: form.studentName,
    gender: form.gender || undefined,
    birthDate: form.birthDate || undefined,
    guardianContact: form.guardianContact || undefined,
    sensoryProfile: buildSensoryPayload()
  }
  submitting.value = true
  try {
    if (isEdit.value) {
      const res = await window.api.student.update({
        callerUserId: auth.userId!, callerRole: auth.role!,
        studentId: route.params.id as string, patch: { ...base }
      })
      if (!res.success) { errorMsg.value = mapError(res.errorCode); return }
    } else {
      const res = await window.api.student.create({
        callerUserId: auth.userId!, callerRole: auth.role!,
        username: form.username, password: form.password, ...base
      })
      if (!res.success) { errorMsg.value = mapError(res.errorCode); return }
    }
    router.push('/teacher/students')
  } finally { submitting.value = false }
}

function mapError(code: string): string {
  return ({
    USERNAME_TAKEN: '用户名已被占用',
    VALIDATION_ERROR: '请检查必填字段或日期',
    INVALID_SENSORY_PROFILE: '感官画像数据非法',
    ARCHIVED: '已归档档案不可编辑',
    FORBIDDEN: '无权限'
  } as Record<string, string>)[code] ?? '操作失败'
}
</script>
```

**关键点：**
- 编辑模式不渲染 username/password 字段（锁定）
- `patch: { ...base }` 展开为普通对象
- 感官画像全空 → null（不发 `{}`）
- 二次确认归档在列表页或详情页触发（modal 确认）

**测试用例（手工 E2E 冒烟，用 webapp-testing skill 或手动）：**
1. 教师登录 → 列表空状态 → 点新建
2. 填完整表单 → 保存 → 跳回列表，出现 1 条 ACTIVE
3. 列表点击该学生 → 编辑页字段回填正确
4. 修改感官画像 → 保存 → 重新进入验证持久化
5. 重复 username → 提示「用户名已被占用」
6. 必填留空 → 前端阻断
7. 归档（二次确认）→ 列表状态变 ARCHIVED
8. **归档前用该学生初始密码登录 → 成功进入 /student**（验收项 3）
9. **归档后用该学生账号登录 → ACCOUNT_DISABLED**（验收项 11）

**commit message：** `feat(student): implement student create/edit form view`

---

## 回归验收清单

每个 Step commit 前都应跑 typecheck（避免问题累积），最终全量：

- [ ] `npm run typecheck` 通过
- [ ] `npm run build` 通过
- [ ] `npm run test`（vitest）全部通过
- [ ] 手工冒烟：教师建档 → 学生登录 → 编辑档案 → 归档（E2E 9 步）
- [ ] error_event_log 中 create/update/archive 各有 INFO 记录，error_category='SYSTEM'，related_aggregate_type='STUDENT_PROFILE'
- [ ] `npm run lint` 无错误

---

## 项目约束检查（Writer 自检）

- [x] **事件写入顺序**：本功能不写 domain_event_projection / action_log.jsonl（student_profile 是主数据，非事件溯源聚合；审计走 error_event_log，与 auth 一致）。不涉及 JSONL append → projection → reducer 顺序。
- [x] **新 EventType**：无。PRD §8.7 事件列表不含档案事件，本功能不新增领域事件。
- [x] **新 IPC 通道在 preload 白名单**：Step 2 显式声明 student.list/get/create/update/archive。
- [x] **无硬编码题量/阈值**：本功能不涉及组卷/评分，无需读 strategy_config。
- [x] **FSM 状态迁移**：本功能不触及 session FSM。student_profile.status 用 ACTIVE→ARCHIVED（schema CHECK 允许，非 session 状态机）。
- [x] **安全红线相关逻辑**：[!] 本功能**不涉及**安全红线。归档不熔断会话（PRD 已明确）。
- [x] **JSON 字段写入前校验**：sensory_profile_json 在 create/update 前由 validateSensoryProfile 校验。
- [x] **Vue Proxy 序列化**：Step 7 表单提交显式 `{ ...base }` 展开。
- [x] **无禁止库**：未引入 ORM / vuex-persist / csv 解析 / markdown 渲染。
- [x] **不创建不必要文件**：去掉了 useStudentForm composable（逻辑简单，内联）。

---

## 风险与注意事项

**[!] logStudentEvent 的 severity 占位符（已在 v1.1 修正）**  
历史教训：`.run(uuidv4(), code, code, ...)` 曾误把 `code` 同时传给 error_code 和 severity，触发 CHECK 约束（severity 只允许 INFO/WARN/ERROR/CRITICAL）导致审计写入 ABORT，create handler 必走 catch 返回 SYSTEM_ERROR。正确顺序：`.run(uuidv4(), code, severity, ...)`。实现时务必核对占位符顺序。

**[!] recovery_status 语义**  
审计 INFO 行用 `recovery_status='IGNORED'`（schema 枚举「无需处理」），不写 'RESOLVED'（那是「异常已解决」，会污染 ERROR 异常查询）。系统异常 ERROR 行用 'UNRESOLVED'。

**[!] Step 6 build 顺序**  
StudentFormView 必须在 Step 6 以占位文件存在，否则路由的动态 import 在 vue-tsc typecheck 时报模块缺失。Step 7 填充真实内容。

**[!] 测试用依赖注入而非 vi.mock**  
`registerStudentHandlers(getDb = getDatabase)` 接收可选 db-getter。测试 `registerStudentHandlers(() => testDb)`，生产 `registerStudentHandlers()`。避免 `vi.mock('../../db/connection')` 的 hoisting 复杂性和多文件隔离坑。`vi.hoisted` 虽可行但更脆弱。

**[!] test-db schema 路径**  
createTestDb 用 `resolve(process.cwd(), 'doc/...sql')`，不依赖 `__dirname`（vitest ESM 下 __dirname 可能未定义）。vitest 默认从项目根运行，process.cwd() 稳定。若 schema 文件名含版本号，升级 schema 时需同步此路径。

**[!] archive 的 role 锁**  
`UPDATE user_account ... WHERE user_id=? AND role='STUDENT'`：若 student_id 与 user_id 因任何原因不一致（脏数据、并发违规），此条件防止改错非 STUDENT 账号。若更新 0 行（无匹配 STUDENT），事务仍提交（student_profile 已改 ARCHIVED）——这是已知边界，可接受（约定破坏时数据已不一致）。

**[!] username 大小写**  
SQLite 默认大小写敏感，`Alice` 与 `alice` 视为不同。PRD 接受此行为，不做 lowercase 归一化。search 的 LIKE 同样大小写敏感（SQLite LIKE 默认对 ASCII 不区分大小写——注意这与 = 的行为不同，文档化此差异）。

**[!] caller 身份软校验**  
assertCaller 是应用层校验，无法防御伪造 callerRole 的恶意渲染进程。PRD 风险点已记录，MVP 单机本地可接受。

**[!] update SQL 字段白名单**  
UPDATE 语句的字段名来自固定的 `UPDATE_FIELDS` 常量，**绝不**把 `patch` 的 key 直接拼入 SQL（注入风险）。非白名单 key 静默忽略。

**[!] 搜索通配符**  
list 的 `LIKE %${search}%` 不转义 `%` / `_`。MVP 接受（搜索词含这些字符会作为通配符），文档化即可。
