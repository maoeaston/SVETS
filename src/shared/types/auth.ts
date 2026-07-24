export type AuthRole = 'STUDENT' | 'TEACHER' | 'ADMIN'

export interface LoginParams {
  username: string
  password: string
}

export interface AuthSessionSnapshot {
  success: true
  authSessionId: string
  userId: string
  role: AuthRole
  displayName: string
  expiresAt: string
}

export interface LoginError {
  success: false
  errorCode: 'INVALID_CREDENTIALS' | 'ACCOUNT_DISABLED' | 'SYSTEM_ERROR'
}

export interface CurrentSessionError {
  success: false
  errorCode:
    | 'AUTH_REQUIRED'
    | 'ACCOUNT_DISABLED'
    | 'SESSION_EXPIRED'
    | 'SESSION_REVOKED'
    | 'SYSTEM_ERROR'
}

export interface LogoutSuccess {
  success: true
}

export interface LogoutError {
  success: false
  errorCode: 'SYSTEM_ERROR'
}

export interface ListAccountsParams {
  callerUserId: string
  callerRole: string
}

export interface AccountSummary {
  userId: string
  username: string
  role: AuthRole
  displayName: string
  status: 'ACTIVE' | 'DISABLED' | 'ARCHIVED'
  createdAt: string
  updatedAt: string
}

export type ListAccountsResult =
  | { success: true; accounts: AccountSummary[] }
  | { success: false; errorCode: 'FORBIDDEN' }

export interface CreateTeacherAccountParams {
  callerUserId: string
  callerRole: string
  username: string
  password: string
  displayName: string
}

export type CreateTeacherAccountResult =
  | { success: true; account: AccountSummary }
  | {
      success: false
      errorCode: 'FORBIDDEN' | 'VALIDATION_ERROR' | 'USERNAME_TAKEN' | 'SYSTEM_ERROR'
    }

export interface SetTeacherAccountStatusParams {
  callerUserId: string
  callerRole: string
  teacherUserId: string
  status: 'ACTIVE' | 'DISABLED'
}

export type SetTeacherAccountStatusResult =
  | { success: true; account: AccountSummary; revokedSessionCount: number }
  | { success: false; errorCode: 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION_ERROR' | 'SYSTEM_ERROR' }

export type LoginResult = AuthSessionSnapshot | LoginError
export type CurrentSessionResult = AuthSessionSnapshot | CurrentSessionError
export type LogoutResult = LogoutSuccess | LogoutError
