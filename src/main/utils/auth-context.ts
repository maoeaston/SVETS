// 调用者身份校验（软校验）。
// 应用层防御：当前无 session token，caller 身份由渲染进程从 Pinia auth store 读取后
// 随 IPC 参数传入。主进程校验 callerRole 枚举 + caller 的 user_account 存在且 ACTIVE
// 且 role 与传入值一致。无法防御「伪造 callerRole 的恶意渲染进程」（PRD 风险点已记录）。
// 接收 DBAdapter 而非具体实现，便于单元测试注入 MemoryAdapter，完全不触碰原生模块。

import type { DBAdapter } from '../db/interface'

type CallerRole = 'TEACHER' | 'ADMIN' | 'STUDENT'

interface CallerRow {
  user_id: string
  role: string
  status: string
}

export type CallerCheckOk = { ok: true; row: CallerRow }
export type CallerCheckErr = { ok: false; errorCode: 'FORBIDDEN' }
export type CallerCheck = CallerCheckOk | CallerCheckErr

/**
 * 校验 IPC 调用者身份。
 * - callerRole 必须为 TEACHER 或 ADMIN（STUDENT 不可调用管理类 handler）
 * - callerUserId 必须为字符串，且对应 user_account 存在
 * - 该账号 status 必须为 ACTIVE，role 必须与传入 callerRole 一致
 */
export function assertCaller(
  db: DBAdapter,
  callerUserId: unknown,
  callerRole: unknown
): CallerCheck {
  if (callerRole !== 'TEACHER' && callerRole !== 'ADMIN') {
    return { ok: false, errorCode: 'FORBIDDEN' }
  }
  if (typeof callerUserId !== 'string' || callerUserId.length === 0) {
    return { ok: false, errorCode: 'FORBIDDEN' }
  }
  const row = db
    .prepare('SELECT user_id, role, status FROM user_account WHERE user_id = ?')
    .get(callerUserId) as CallerRow | undefined
  if (!row || row.status !== 'ACTIVE' || row.role !== (callerRole as CallerRole)) {
    return { ok: false, errorCode: 'FORBIDDEN' }
  }
  return { ok: true, row }
}
