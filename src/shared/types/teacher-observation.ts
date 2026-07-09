// T8: TEACHER_OBSERVATION 运行时 IPC 参数/结果类型
// handler: src/main/ipc/handlers/observation.ts

import type { TeacherObservationPayload } from './json-schemas'

// ---------------------------------------------------------------------------
// recordTeacherObservation
// ---------------------------------------------------------------------------

export interface RecordTeacherObservationParams {
  callerUserId: string
  callerRole: string
  sessionId: string
  questionId: string
  observationPayload: TeacherObservationPayload
}

export type TeacherObservationErrorCode =
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'SESSION_WRONG_STRATEGY'
  | 'SESSION_TERMINATED'
  | 'QUESTION_NOT_OBSERVATION'
  | 'INVALID_BEHAVIOR_CODE'
  | 'ALREADY_RECORDED'
  | 'ASSESSMENT_SYSTEM_ERROR'

export type RecordTeacherObservationResult =
  | { success: true; offlineScoreId: string }
  | { success: false; errorCode: TeacherObservationErrorCode }

// ---------------------------------------------------------------------------
// getTeacherObservations
// ---------------------------------------------------------------------------

export interface GetTeacherObservationsParams {
  callerUserId: string
  callerRole: string
  sessionId: string
}

export interface TeacherObservationRecord {
  questionId: string
  offlineScoreId: string
  observationPayload: TeacherObservationPayload
  recordedAt: string
}

export type GetTeacherObservationsResult =
  | { success: true; records: TeacherObservationRecord[] }
  | { success: false; errorCode: 'FORBIDDEN' | 'NOT_FOUND' | 'ASSESSMENT_SYSTEM_ERROR' }
