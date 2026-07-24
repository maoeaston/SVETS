import type { AuthRole } from './auth'

export type ExceptionPriority = 'P0' | 'P1' | 'P2' | 'P3'
export type ExceptionSeverity = 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL'
export type ExceptionCategory =
  | 'IPC'
  | 'DB'
  | 'AOL'
  | 'RECOVERY'
  | 'ASSET'
  | 'FSM'
  | 'SCORING'
  | 'REPORT'
  | 'AUTH'
  | 'SYSTEM'
export type RecoveryStatus =
  | 'UNRESOLVED'
  | 'AUTO_RECOVERED'
  | 'MANUAL_REVIEW_REQUIRED'
  | 'RESOLVED'
  | 'IGNORED'

export type FoundationErrorCode =
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'FOUNDATION_SYSTEM_ERROR'

export interface TrustedCallerParams {
  callerUserId: string
  callerRole: string
}

export interface WorkspaceOverview {
  role: Extract<AuthRole, 'TEACHER' | 'ADMIN'>
  activeStudentCount: number
  openAssessmentCount: number
  openTrainingCount: number
  pendingSafetyCount: number
  reportCount: number
  unresolvedExceptionCount: number
  teacherAccountCount: number
  activeStrategyCount: number
  assetIssueCount: number
  unverifiedAssetCount: number
  snapshotCount: number
  lastSnapshotAt: string | null
}

export type GetWorkspaceOverviewResult =
  | { success: true; overview: WorkspaceOverview }
  | { success: false; errorCode: FoundationErrorCode }

export interface ListExceptionsParams extends TrustedCallerParams {
  priorityLevel?: ExceptionPriority
  category?: ExceptionCategory
  recoveryStatus?: RecoveryStatus
  limit?: number
  offset?: number
}

export interface ExceptionListItem {
  errorEventId: string
  errorCode: string
  title: string
  message: string
  severity: ExceptionSeverity
  priorityLevel: ExceptionPriority
  category: ExceptionCategory
  isBlocking: boolean
  recoveryStatus: RecoveryStatus
  recoveryHint: string | null
  relatedAggregateType: string | null
  relatedAggregateId: string | null
  createdAt: string
  resolvedAt: string | null
}

export interface ExceptionPriorityCounts {
  P0: number
  P1: number
  P2: number
  P3: number
}

export type ListExceptionsResult =
  | {
      success: true
      items: ExceptionListItem[]
      total: number
      priorityCounts: ExceptionPriorityCounts
    }
  | { success: false; errorCode: FoundationErrorCode }

export interface GetExceptionParams extends TrustedCallerParams {
  errorEventId: string
}

export interface ExceptionDetail extends ExceptionListItem {
  defaultMessage: string
  recoveryAction: string | null
  relatedEventId: string | null
  context: Record<string, unknown> | null
  stackTrace: string | null
}

export type GetExceptionResult =
  | { success: true; exception: ExceptionDetail }
  | { success: false; errorCode: FoundationErrorCode }
