import type { ReportScope, ReportType, ResultType } from './json-schemas'

export type ReportLifecycleStatus =
  | 'GENERATED'
  | 'EXPORTED'
  | 'LOCKED'
  | 'SUPERSEDED'
  | 'ARCHIVED'
  | 'FAILED'

export type ReportContractValidationStatus = 'VALID' | 'REPAIR_REQUIRED'

export type ReportGenerationReason =
  | 'NORMAL'
  | 'CONTRACT_REPAIR'
  | 'FACTUAL_CORRECTION'
  | 'DUPLICATE_MERGE'

export type TaskClosureStatus = 'CONFIRMED' | 'SUPERSEDED'

export type ReportErrorCode =
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'TASK_CLOSURE_INVALID'
  | 'STALE_REPORT_SOURCE'
  | 'REPORT_GENERATION_FAILED'
  | 'REPORT_EXPORT_FAILED'
  | 'REPORT_STATE_CONFLICT'
  | 'REPORT_CONTRACT_INVALID'
  | 'REPORT_SYSTEM_ERROR'

export interface ReportsCallerParams {
  callerUserId: string
  callerRole: string
}

export interface ReportListFilters {
  studentId?: string
  reportScope?: ReportScope
  reportType?: ReportType
  status?: ReportLifecycleStatus
  generatedFrom?: string
  generatedTo?: string
  limit?: number
  offset?: number
}

export interface ListReportsParams extends ReportsCallerParams, ReportListFilters {}

export interface ReportListItem {
  reportId: string
  studentId: string
  studentDisplayName: string
  reportTitle: string
  reportScope: ReportScope
  reportType: ReportType
  status: ReportLifecycleStatus
  contractValidationStatus: ReportContractValidationStatus
  reportSchemaVersion: string
  reportRevision: number
  generatedAt: string
  canExport: boolean
}

export interface ListReportsResult {
  success: true
  items: ReportListItem[]
  total: number
}

export interface GetReportParams extends ReportsCallerParams {
  reportId: string
}

export interface ReportLifecycleMetadata {
  status: ReportLifecycleStatus
  contractValidationStatus: ReportContractValidationStatus
  reportRevision: number
  lineageKey: string
  contentHash: string
  placementReviewBy: string | null
  placementReviewAt: string | null
  lockedBy: string | null
  lockedAt: string | null
  lastExportedAt: string | null
  capabilities: ReportLifecycleCapabilities
}

export type ReportPresentationSensitivity = 'PUBLIC' | 'TEACHER_INTERNAL' | 'PAGE_ONLY'

export type ReportPresentationExportPolicy = 'EXPORT_ALLOWED' | 'PAGE_ONLY' | 'EXCLUDED'

export interface ReportPresentationField {
  fieldId: string
  label: string
  value: string | number | boolean | null
  sensitivity: ReportPresentationSensitivity
  exportPolicy: ReportPresentationExportPolicy
}

export interface ReportPresentationSection {
  sectionId: string
  title: string
  fields: ReportPresentationField[]
}

export interface ReportPresentationDocument {
  documentId: string
  reportScope: ReportScope
  reportType: ReportType
  generatedAt: string | null
  sections: ReportPresentationSection[]
}

export interface ReportLifecycleCapabilities {
  canConfirmPlacementReview: boolean
  canLock: boolean
  canExport: boolean
  placementAdviceEnabled: boolean
}

export interface ReportDetail {
  reportId: string
  studentId: string
  reportTitle: string
  reportScope: ReportScope
  reportType: ReportType
  presentation: ReportPresentationDocument | null
  contractErrors: Array<{ path: string; code: string }>
  lifecycle: ReportLifecycleMetadata
}

export interface GetReportResult {
  success: true
  report: ReportDetail
}

export interface ReportCandidateBaseResult {
  resultId: string
  resultType: Extract<ResultType, 'ABILITY_SCORE' | 'TRAINING_COMPLETION' | 'OPERATION_PASS_RATE'>
  sourceAggregateId: string
  generatedAt: string
}

export type ReportGenerationCandidate =
  | {
      kind: 'BASE_RESULTS'
      studentId: string
      jobCode: string
      taskCode: string
      results: [ReportCandidateBaseResult, ReportCandidateBaseResult, ReportCandidateBaseResult]
    }
  | {
      kind: 'BASE_CLOSURE'
      taskClosureId: string
      studentId: string
      jobCode: string
      taskCode: string
      cycleNo: number
      closureRevision: number
    }
  | {
      kind: 'JOB_SKILL'
      resultId: string
      studentId: string
      sourceAggregateId: string
      repairOfReportId: string | null
    }
  | {
      kind: 'SAFETY_WAITING_CONFIRMATION'
      incidentId: string
      studentId: string
    }
  | {
      kind: 'SAFETY'
      incidentId: string
      studentId: string
      retryable: boolean
    }

export interface ListReportGenerationCandidatesParams extends ReportsCallerParams {
  studentId?: string
  limit?: number
  offset?: number
}

export interface ListReportGenerationCandidatesResult {
  success: true
  items: ReportGenerationCandidate[]
  total: number
}

export interface ConfirmTaskClosureParams extends ReportsCallerParams {
  resultIds: [string, string, string]
}

export interface ReplaceTaskClosureParams extends ReportsCallerParams {
  taskClosureId: string
  resultIds: [string, string, string]
  correctionReason: string
}

export interface TaskClosureView {
  taskClosureId: string
  studentId: string
  jobCode: string
  taskCode: string
  cycleNo: number
  closureRevision: number
  status: TaskClosureStatus
  isCycleHead: boolean
  resultIds: [string, string, string]
}

export interface TaskClosureMutationResult {
  success: true
  taskClosure: TaskClosureView
}

export type GenerateReportParams =
  | (ReportsCallerParams & {
      reportScope: 'BASE_ABILITY'
      taskClosureId: string
      resultId?: never
      incidentId?: never
    })
  | (ReportsCallerParams & {
      reportScope: 'JOB_SKILL'
      resultId: string
      taskClosureId?: never
      incidentId?: never
    })
  | (ReportsCallerParams & {
      reportScope: 'SAFETY'
      incidentId: string
      taskClosureId?: never
      resultId?: never
    })

export interface GenerateReportResult {
  success: true
  reportId: string
  generated: boolean
}

export interface ConfirmPlacementReviewParams extends ReportsCallerParams {
  reportId: string
}

export interface LockReportParams extends ReportsCallerParams {
  reportId: string
  lockReason?: string | null
}

export interface ExportReportParams extends ReportsCallerParams {
  reportId: string
}

export interface ExportReportSuccessResult {
  success: true
  canceled: false
  reportId: string
  status: ReportLifecycleStatus
  exportPath: string
  fileAssetId: string
  fileHash: string
  fileSizeBytes: number
}

export interface ExportReportCanceledResult {
  success: true
  canceled: true
}

export type ExportReportResult = ExportReportSuccessResult | ExportReportCanceledResult

export interface ReportLifecycleMutationResult {
  success: true
  reportId: string
  status: ReportLifecycleStatus
}

export type ReportsResult<T> = T | { success: false; errorCode: ReportErrorCode }
