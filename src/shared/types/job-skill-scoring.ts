// JOB_SKILL 线下评分（T7）共享类型
// 对应 doc/specs/impl/07-implementation-task-book.md §T7
// 模式参考 operation-scoring.ts：纯函数 handler + IPC 薄包装，教师批量提交 6 道
// OFFLINE_OPERATION 线下题的 0/1/2 分，写入 offline_score_record（score_scope=JOB_SKILL）。

// ---------------------------------------------------------------------------
// 错误码
// ---------------------------------------------------------------------------

export type JobSkillScoringErrorCode =
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'SESSION_NOT_OFFLINE_PENDING'
  | 'ALREADY_SCORED'
  | 'BLOCKED_BY_SAFETY_INCIDENT'
  | 'ASSESSMENT_SYSTEM_ERROR'

// ---------------------------------------------------------------------------
// submitJobSkillOfflineScores（TEACHER）
// ---------------------------------------------------------------------------

export interface JobSkillOfflineScoreItem {
  questionId: string
  score: 0 | 1 | 2
  observationNote?: string
}

export interface SubmitJobSkillOfflineScoresParams {
  callerUserId: string
  callerRole: string
  sessionId: string
  scores: JobSkillOfflineScoreItem[]
}

export interface SubmitJobSkillOfflineScoresSuccess {
  success: true
  itemsScored: number
}

export type SubmitJobSkillOfflineScoresResult =
  | SubmitJobSkillOfflineScoresSuccess
  | { success: false; errorCode: JobSkillScoringErrorCode }

// ---------------------------------------------------------------------------
// getJobSkillOfflineScores（纯读）
// ---------------------------------------------------------------------------

export interface GetJobSkillOfflineScoresParams {
  callerUserId: string
  callerRole: string
  sessionId: string
}

export interface JobSkillOfflineScoreView {
  questionId: string
  score: 0 | 1 | 2
  observationNote: string | null
  scoredAt: string
}

export interface GetJobSkillOfflineScoresSuccess {
  success: true
  items: JobSkillOfflineScoreView[]
}

export type GetJobSkillOfflineScoresResult =
  | GetJobSkillOfflineScoresSuccess
  | { success: false; errorCode: JobSkillScoringErrorCode }
