// M3 Grant/Assignment IPC 类型契约。
// handler 与 reducer 在后续 Step M3-5/M3-6 接入；本文件只定义渲染进程可见 API。

export type AssignmentActorRole = 'STUDENT' | 'TEACHER' | 'ADMIN'

export type AssignmentDeliveryPhase =
  | 'PREPARED'
  | 'ASSIGNED'
  | 'STUDENT_CONFIRMED'
  | 'ONLINE_IN_PROGRESS'
  | 'ONLINE_COMPLETED'
  | 'OFFLINE_SCORING'
  | 'OBSERVATION'
  | 'READY_TO_FINALIZE'
  | 'FINALIZED'

export type AssignmentConfirmationMethod =
  | 'PIN'
  | 'TEACHER_ATTESTATION'
  | 'PHOTO_MATCH'
  | 'NONE_REQUIRED'

// M3 首版只允许这两种成功路径；PIN / PHOTO_MATCH 保留为 schema 枚举，不开放成功业务路径。
export type SupportedAssignmentConfirmationMethod =
  | 'TEACHER_ATTESTATION'
  | 'NONE_REQUIRED'

export type AssignmentGrantStatus = 'ACTIVE' | 'RELEASED' | 'EXPIRED' | 'REVOKED'
export type AssignmentGrantTerminalStatus = Exclude<AssignmentGrantStatus, 'ACTIVE'>

export type BusinessSessionAssignmentStatus =
  | 'PENDING_CONFIRM'
  | 'ACTIVE'
  | 'RELEASED'
  | 'VOID'

export type AssignmentReleaseReason =
  | 'COMPLETED'
  | 'TEACHER_RELEASED'
  | 'DEVICE_OFFLINE'
  | 'REPLACED'
  | 'ADMIN_REVOKED'

export type AssignmentCapability = string
export type AssignmentConfirmationEvidence = Record<string, unknown>

export type AssignmentErrorCode =
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'ASSIGNMENT_REQUIRED'
  | 'STUDENT_CONFIRMATION_REQUIRED'
  | 'ASSIGNMENT_NOT_ACTIVE'
  | 'DEVICE_RUNTIME_NOT_ACTIVE'
  | 'GRANT_AUTH_INVALID'
  | 'UNSUPPORTED_CONFIRMATION_METHOD'
  | 'ASSIGNMENT_CONFLICT'
  | 'ASSIGNMENT_SYSTEM_ERROR'

export interface AssignmentOpError {
  success: false
  errorCode: AssignmentErrorCode
}

export interface AssignmentView {
  assignmentId: string
  businessSessionId: string
  sessionId: string
  studentId: string
  deviceId: string
  grantId: string
  status: BusinessSessionAssignmentStatus
  assignedBy: string
  assignedAt: string
  studentConfirmedAt: string | null
  releasedAt: string | null
  releaseReason: AssignmentReleaseReason | null
  version: number
  deliveryPhase: AssignmentDeliveryPhase
}

export interface CreateAssignmentParams {
  callerUserId: string
  callerRole: AssignmentActorRole
  businessSessionId: string
  // 为空时 handler 可使用本地 runtime/auth 引导；显式传入时必须校验 ACTIVE。
  deviceRuntimeSessionId?: string
  capabilities?: AssignmentCapability[]
  confirmationMethod?: SupportedAssignmentConfirmationMethod
}

export interface CreateAssignmentSuccess {
  success: true
  grantId: string
  assignmentId: string
  businessSessionId: string
  sessionId: string
  studentId: string
  deviceId: string
  deviceRuntimeSessionId: string
  deliveryPhase: 'ASSIGNED'
  assignmentStatus: 'PENDING_CONFIRM'
  grantStatus: 'ACTIVE'
  expiresAt: string
}

export type CreateAssignmentResult = CreateAssignmentSuccess | AssignmentOpError

export interface ConfirmStudentAssignmentParams {
  callerUserId: string
  callerRole: AssignmentActorRole
  assignmentId: string
  confirmationMethod: SupportedAssignmentConfirmationMethod
  confirmationEvidence?: AssignmentConfirmationEvidence | null
}

export interface ConfirmStudentAssignmentSuccess {
  success: true
  assignmentId: string
  businessSessionId: string
  sessionId: string
  studentId: string
  deliveryPhase: 'STUDENT_CONFIRMED'
  assignmentStatus: 'ACTIVE'
  confirmedAt: string
}

export type ConfirmStudentAssignmentResult =
  | ConfirmStudentAssignmentSuccess
  | AssignmentOpError

export interface StartAssignedAssessmentParams {
  callerUserId: string
  callerRole: AssignmentActorRole
  assignmentId: string
}

export interface StartAssignedAssessmentSuccess {
  success: true
  sessionId: string
  assignmentId: string
  deliveryPhase: 'ONLINE_IN_PROGRESS'
  firstQuestionId: string
  firstQuestionOrder: number
}

export type StartAssignedAssessmentResult =
  | StartAssignedAssessmentSuccess
  | AssignmentOpError

export interface RebindAssignmentParams {
  callerUserId: string
  callerRole: AssignmentActorRole
  assignmentId: string
  // 为空时 handler 可使用本地 runtime/auth 引导；显式传入时必须校验 ACTIVE。
  newDeviceRuntimeSessionId?: string
  requireReconfirmation: boolean
  confirmationMethod?: SupportedAssignmentConfirmationMethod
  capabilities?: AssignmentCapability[]
}

export interface RebindAssignmentSuccess {
  success: true
  assignmentId: string
  businessSessionId: string
  sessionId: string
  oldGrantId: string
  newGrantId: string
  version: number
  assignmentStatus: 'PENDING_CONFIRM' | 'ACTIVE'
  deliveryPhase: AssignmentDeliveryPhase
  requiresStudentConfirmation: boolean
}

export type RebindAssignmentResult = RebindAssignmentSuccess | AssignmentOpError

export interface ReleaseAssignmentParams {
  callerUserId: string
  callerRole: AssignmentActorRole
  assignmentId: string
  releaseReason: AssignmentReleaseReason
  grantStatus?: AssignmentGrantTerminalStatus
}

export interface ReleaseAssignmentSuccess {
  success: true
  assignmentId: string
  businessSessionId: string
  sessionId: string
  grantId: string
  assignmentStatus: 'RELEASED'
  grantStatus: AssignmentGrantTerminalStatus
  releasedAt: string
}

export type ReleaseAssignmentResult = ReleaseAssignmentSuccess | AssignmentOpError
