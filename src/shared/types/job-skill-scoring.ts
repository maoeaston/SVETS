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
  /** 评分锚点版本，当前按 questionId@questionVersion 固定。 */
  anchorVersion?: string
  /** 教师在界面选择分数时实际命中的完整行为锚点。 */
  selectedAnchor?: string
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
  anchorVersion: string | null
  selectedAnchor: string | null
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

// ---------------------------------------------------------------------------
// getSessionScoringQuestions（纯读：前端组卷显示用）
// ---------------------------------------------------------------------------

export interface GetSessionScoringQuestionsParams {
  callerUserId: string
  callerRole: string
  sessionId: string
}

export interface SessionScoringQuestion {
  questionId: string
  jobModuleCode: string
  questionVersion: number
  questionType: string
  prompt: string
  toolBrief: string | null
  rubricCriteria: Array<{ criterionId: string; description: string }>
  scoreAnchors: { '0': string; '1': string; '2': string } | null
  safetyStopConditions: string | null
  anchorVersion: string
  /** 仅 TEACHER/ADMIN 返回；学生端主进程固定返回 null。 */
  sealedAdminConfig: Record<string, unknown> | null
}

export type GetSessionScoringQuestionsResult =
  | {
      success: true
      offlineQuestions: SessionScoringQuestion[]
      observationQuestions: SessionScoringQuestion[]
    }
  | { success: false; errorCode: JobSkillScoringErrorCode }
