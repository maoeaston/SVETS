// 学生档案管理的 IPC 类型契约。
// sensory_profile 复用 json-schemas.ts 的 SensoryProfileJson，不重复定义。

import type { SensoryProfileJson } from './json-schemas'

export type { SensoryProfileJson }

// 对应 schema student_profile / user_account 的 CHECK 枚举
export type StudentGender = 'MALE' | 'FEMALE' | 'OTHER' | 'UNKNOWN'
export type StudentStatus = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED'
export type CallerRole = 'TEACHER' | 'ADMIN' | 'STUDENT'

// 统一错误码（所有 student:* 失败路径共用）
export type StudentErrorCode =
  | 'FORBIDDEN'
  | 'VALIDATION_ERROR'
  | 'USERNAME_TAKEN'
  | 'INVALID_SENSORY_PROFILE'
  | 'ARCHIVED'
  | 'NOT_FOUND'
  | 'SYSTEM_ERROR'

// --- list ---
export interface StudentListParams {
  callerUserId: string
  callerRole: string
  search?: string
  includeArchived?: boolean
  page?: number
}

export interface StudentSummary {
  studentId: string
  studentName: string
  status: StudentStatus
  gender: StudentGender | null
  createdAt: string
  updatedAt: string
}

// --- get ---
export interface StudentDetail extends StudentSummary {
  birthDate: string | null
  guardianContact: string | null
  sensoryProfile: SensoryProfileJson | null
  username: string // 来自 user_account（同 UUID 关联）
}

// --- create ---
export interface CreateStudentParams {
  callerUserId: string
  callerRole: string
  username: string
  password: string
  studentName: string
  gender?: StudentGender
  birthDate?: string
  guardianContact?: string
  sensoryProfile?: SensoryProfileJson | null
}

// --- update（patch；只允许白名单字段）---
export interface UpdateStudentParams {
  callerUserId: string
  callerRole: string
  studentId: string
  patch: {
    studentName?: string
    gender?: StudentGender
    birthDate?: string
    guardianContact?: string
    sensoryProfile?: SensoryProfileJson | null
  }
}

// --- Result（discriminated union，与 auth LoginResult 同模式）---
export interface StudentCreateSuccess {
  success: true
  studentId: string
}
export interface StudentOpError {
  success: false
  errorCode: StudentErrorCode
}
export interface StudentGetSuccess {
  success: true
  student: StudentDetail
}
export interface StudentListSuccess {
  success: true
  items: StudentSummary[]
  page: number
}

export type CreateStudentResult = StudentCreateSuccess | StudentOpError
export type UpdateStudentResult = StudentOpError | { success: true }
export type ArchiveStudentResult = StudentOpError | { success: true }
export type GetStudentResult = StudentGetSuccess | StudentOpError
export type StudentListResult = StudentListSuccess | StudentOpError
