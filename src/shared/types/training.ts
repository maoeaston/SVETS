// 训练功能共享类型
// 关联实现文档：doc/features/training-impl.md Step 2

export type TrainingSessionStatus =
  | 'INIT'
  | 'ACTIVE'
  | 'SUSPENDED_REVIEW_REQUIRED'
  | 'COMPLETED'
  | 'REDLINE_HALTED'
  | 'ABORTED'

export type TrainingStepStatus =
  | 'NOT_STARTED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'SKIPPED'
  | 'FAILED'

export type TrainingStepType = 'WATCH' | 'LEARN' | 'PRACTICE' | 'DO'

export type TrainingModuleType =
  | 'FINE_MOTOR'
  | 'COGNITION'
  | 'RULE_EXECUTION'
  | 'EMOTION_REGULATION'
  | 'BASIC_SOCIAL'
  | 'SAFETY_OPERATION'

export type TrainingErrorCode =
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'SESSION_ALREADY_OPEN'
  | 'SESSION_NOT_ACTIVE'
  | 'SESSION_HALTED'
  | 'STEP_NOT_FOUND'
  | 'STEP_INVALID_TRANSITION'
  | 'STEP_PREREQUISITE_NOT_MET'
  | 'BLOCKED_BY_SAFETY_INCIDENT'
  | 'DUPLICATE_TRAINING_SESSION'
  | 'UNRESOLVED_SAFETY_INCIDENT'
  | 'TRAINING_SYSTEM_ERROR'

// --- createSession ---
export interface CreateTrainingSessionParams {
  callerUserId: string
  callerRole: string
  studentId: string
  strategyId: string
  strategyVersion: number
  moduleType: TrainingModuleType
  taskCode: string
}

export interface CreateTrainingSessionSuccess {
  success: true
  trainingSessionId: string
  businessSessionId?: string
  status: TrainingSessionStatus
}

export type CreateTrainingSessionResult =
  | CreateTrainingSessionSuccess
  | { success: false; errorCode: TrainingErrorCode }

// --- listSessions ---
export interface ListTrainingSessionsParams {
  callerUserId: string
  callerRole: string
  studentId?: string
  status?: TrainingSessionStatus
  limit?: number
  offset?: number
}

export interface TrainingSessionListItem {
  trainingSessionId: string
  businessSessionId?: string
  studentId: string
  moduleType: string | null
  status: TrainingSessionStatus
  totalStepCount: number
  completedStepCount: number
  completionRate: number | null
  createdBy: string
  startedAt: string | null
  completedAt: string | null
}

export interface ListTrainingSessionsSuccess {
  success: true
  sessions: TrainingSessionListItem[]
  total: number
}

export type ListTrainingSessionsResult =
  | ListTrainingSessionsSuccess
  | { success: false; errorCode: TrainingErrorCode }

// --- getSession ---
export interface GetTrainingSessionParams {
  callerUserId: string
  callerRole: string
  trainingSessionId: string
}

export interface TrainingStepView {
  stepRecordId: string
  stepCode: string
  stepName: string
  stepOrder: number
  stepType: TrainingStepType
  status: TrainingStepStatus
  attemptCount: number
  startedAt: string | null
  completedAt: string | null
}

export interface TrainingSessionDetail {
  trainingSessionId: string
  businessSessionId?: string
  studentId: string
  strategyId: string
  strategyVersion: number
  moduleType: string | null
  status: TrainingSessionStatus
  totalStepCount: number
  completedStepCount: number
  completionRate: number | null
  steps: TrainingStepView[]
  createdBy: string
  startedAt: string | null
  completedAt: string | null
}

export interface GetTrainingSessionSuccess {
  success: true
  session: TrainingSessionDetail
}

export type GetTrainingSessionResult =
  | GetTrainingSessionSuccess
  | { success: false; errorCode: TrainingErrorCode }

// --- step actions (start / complete / skip / fail / retry) ---
export interface TrainingStepActionParams {
  callerUserId: string
  callerRole: string
  trainingSessionId: string
  stepRecordId: string
}

export interface TrainingStepActionSuccess {
  success: true
  stepRecordId: string
  newStatus: TrainingStepStatus
  sessionCompleted?: boolean
}

export type TrainingStepActionResult =
  | TrainingStepActionSuccess
  | { success: false; errorCode: TrainingErrorCode }
