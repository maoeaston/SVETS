import type { SafetyContextPhase, SafetyReasonCode } from './safety'

export type SafetyIncidentErrorCode =
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'INVALID_STATE'
  | 'SAFETY_SYSTEM_ERROR'

export type SafetyIncidentStatus = 'PENDING_DETAIL' | 'CONFIRMED' | 'RESOLVED' | 'VOIDED'

export type SafetyIncidentOpError = { success: false; errorCode: SafetyIncidentErrorCode }

export interface ConfirmSafetyIncidentParams {
  callerUserId: string
  callerRole: string
  incidentId: string
  reasonCode: SafetyReasonCode
  contextPhase: SafetyContextPhase
  description: string
}

export interface ResolveSafetyIncidentParams {
  callerUserId: string
  callerRole: string
  incidentId: string
  resolutionNotes: string
  followUpRequired: boolean
}

export interface VoidSafetyIncidentParams {
  callerUserId: string
  callerRole: string
  incidentId: string
  voidReason: 'FALSE_TRIGGER' | 'DUPLICATE_RECORD' | 'NON_SAFETY_EVENT'
  voidNotes?: string | null
  replacementIncidentId?: string | null
}

export interface ReplaceSafetyIncidentParams {
  callerUserId: string
  callerRole: string
  incidentId: string
  reasonCode: SafetyReasonCode
  contextPhase: SafetyContextPhase
  description: string
  correctionReason: string
}

export type SafetyIncidentMutationResult = { success: true; incidentId: string } | SafetyIncidentOpError

export interface ListSafetyIncidentsParams {
  callerUserId: string
  callerRole: string
  status?: SafetyIncidentStatus
  limit?: number
  offset?: number
}

export interface GetSafetyIncidentParams {
  callerUserId: string
  callerRole: string
  incidentId: string
}

export interface SafetyIncidentView {
  incidentId: string
  studentId: string
  studentName: string
  jobCode: string
  taskCode: string
  status: SafetyIncidentStatus
  reasonCode: SafetyReasonCode
  contextPhase: SafetyContextPhase
  description: string | null
  occurredAt: string
  triggeredBy: string
  triggeredByName: string
  confirmedBy: string | null
  confirmedByName: string | null
  resolvedBy: string | null
  resolvedByName: string | null
  resolvedAt: string | null
  voidReason: 'FALSE_TRIGGER' | 'DUPLICATE_RECORD' | 'NON_SAFETY_EVENT' | 'FACTUAL_CORRECTION' | null
  replacementIncidentId: string | null
  requiresReviewBeforeNextSession: boolean
  bindingCount: number
  createdAt: string
  updatedAt: string
}

export type ListSafetyIncidentsResult =
  | { success: true; items: SafetyIncidentView[]; total: number }
  | SafetyIncidentOpError

export type GetSafetyIncidentResult =
  | { success: true; incident: SafetyIncidentView }
  | SafetyIncidentOpError
