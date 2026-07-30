import {
  archiveStudent,
  createStudent,
  updateStudent
} from '../../application/services/student-service'
import {
  getStudentQuery,
  listStudentsQuery
} from '../../application/query/student-query-service'
import { getDatabase } from '../../db/connection'
import type { DBAdapter } from '../../db/interface'
import { SqliteAdapter } from '../../db/sqlite-adapter'
import { resolveBoundAuthSessionSnapshot } from '../../utils/auth-session'
import type { AuthRole } from '../../../shared/types/auth'
import type {
  CreateStudentParams,
  StudentListParams,
  UpdateStudentParams
} from '../../../shared/types/student'
import type { LegacyIpcHandlerRegistrar } from '../legacy-handler-collector'

export {
  archiveStudent,
  createStudent,
  getStudent,
  listStudents,
  seedStudentErrorCodes,
  updateStudent
} from '../../application/services/student-service'

type StudentCallerParams = {
  callerUserId: string
  callerRole: string
}

export function resolveTrustedStudentCaller<T extends StudentCallerParams>(
  db: DBAdapter,
  senderId: number,
  params: T
): { ok: true; params: T } | { ok: false; errorCode: 'FORBIDDEN' } {
  const session = resolveBoundAuthSessionSnapshot(db, senderId)
  if (!session.success || (session.role !== 'TEACHER' && session.role !== 'ADMIN')) {
    return { ok: false, errorCode: 'FORBIDDEN' }
  }
  return {
    ok: true,
    params: {
      ...params,
      callerUserId: session.userId,
      callerRole: session.role as AuthRole
    }
  }
}

function defaultGetDb(): DBAdapter {
  return new SqliteAdapter(getDatabase())
}

export function registerStudentHandlers(
  registrar: LegacyIpcHandlerRegistrar,
  getDb: () => DBAdapter = defaultGetDb
): void {
  registrar.handle('student:create', (event, params: CreateStudentParams) => {
    const db = getDb()
    const trusted = resolveTrustedStudentCaller(db, event.sender.id, params)
    if (!trusted.ok) return { success: false as const, errorCode: 'FORBIDDEN' as const }
    return createStudent(db, trusted.params)
  })
  registrar.handle(
    'student:get',
    (event, params: { callerUserId: string; callerRole: string; studentId: string }) => {
      const db = getDb()
      const trusted = resolveTrustedStudentCaller(db, event.sender.id, params)
      if (!trusted.ok) return { success: false as const, errorCode: 'FORBIDDEN' as const }
      return getStudentQuery(db, trusted.params)
    }
  )
  registrar.handle('student:list', (event, params: StudentListParams) => {
    const db = getDb()
    const trusted = resolveTrustedStudentCaller(db, event.sender.id, params)
    if (!trusted.ok) return { success: false as const, errorCode: 'FORBIDDEN' as const }
    return listStudentsQuery(db, trusted.params)
  })
  registrar.handle('student:update', (event, params: UpdateStudentParams) => {
    const db = getDb()
    const trusted = resolveTrustedStudentCaller(db, event.sender.id, params)
    if (!trusted.ok) return { success: false as const, errorCode: 'FORBIDDEN' as const }
    return updateStudent(db, trusted.params)
  })
  registrar.handle(
    'student:archive',
    (event, params: { callerUserId: string; callerRole: string; studentId: string }) => {
      const db = getDb()
      const trusted = resolveTrustedStudentCaller(db, event.sender.id, params)
      if (!trusted.ok) return { success: false as const, errorCode: 'FORBIDDEN' as const }
      return archiveStudent(db, trusted.params)
    }
  )
}
