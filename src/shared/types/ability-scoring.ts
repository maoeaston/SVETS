// BASE_ABILITY 线下评分共享类型。
// 对应 F6-3：教师/管理员提交 OFFLINE_ABILITY 分数，写 OFFLINE_SCORE_SUBMITTED 事件。

export type AbilityScoringErrorCode =
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'SESSION_NOT_OFFLINE_PENDING'
  | 'ALREADY_SCORED'
  | 'BLOCKED_BY_SAFETY_INCIDENT'
  | 'ASSESSMENT_SYSTEM_ERROR'

export interface AbilityOfflineScoreItem {
  questionId: string
  score: 0 | 1 | 2
  scoringRubricJson: string
  observationNote?: string | null
  toolChecklistConfirmed?: boolean
}

export interface SubmitOfflineAbilityScoresParams {
  callerUserId: string
  callerRole: string
  sessionId: string
  scores: AbilityOfflineScoreItem[]
}

export interface SubmitOfflineAbilityScoresSuccess {
  success: true
  itemsScored: number
  totalScored: number
  totalRequired: number
  isComplete: boolean
}

export type SubmitOfflineAbilityScoresResult =
  | SubmitOfflineAbilityScoresSuccess
  | { success: false; errorCode: AbilityScoringErrorCode }

export interface GetOfflineAbilityScoresParams {
  callerUserId: string
  callerRole: string
  sessionId: string
}

export interface AbilityOfflineScoreView {
  questionId: string
  score: 0 | 1 | 2
  scoringRubricJson: string
  observationNote: string | null
  toolChecklistConfirmed: boolean
  scoredAt: string
}

export interface GetOfflineAbilityScoresSuccess {
  success: true
  items: AbilityOfflineScoreView[]
  totalScored: number
  totalRequired: number
  isComplete: boolean
}

export type GetOfflineAbilityScoresResult =
  | GetOfflineAbilityScoresSuccess
  | { success: false; errorCode: AbilityScoringErrorCode }
