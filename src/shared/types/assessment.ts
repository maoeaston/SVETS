// 测评会话（assessment_session）管理的 IPC 类型契约。
// 复用 event-payloads.ts 的 AnswerPayloadDetail 作为答题输入，不重复定义。
// 对应 schema assessment_session / assessment_session_question / answer_record 表。
// handler 在 Step 6b/7/8 逐步实现，本文件仅为纯类型声明 + preload 白名单接线。

import type { AbilityTag } from './json-schemas'
import type { AnswerPayloadDetail } from './event-payloads'

export type { AnswerPayloadDetail }

// 对应 schema assessment_session.status CHECK 枚举
export type SessionStatus =
  | 'INIT'
  | 'ACTIVE'
  | 'EMOTION_INTERRUPTED'
  | 'SUSPENDED_REVIEW_REQUIRED'
  | 'OFFLINE_PENDING'
  | 'COMPLETED'
  | 'REDLINE_HALTED'
  | 'ABORTED'

// assessment 仅接受 BASELINE_ASSESSMENT / MOCK_EXAM（TRAINING_PRACTICE 走训练功能）
export type AssessmentStrategyType = 'BASELINE_ASSESSMENT' | 'MOCK_EXAM'

// 统一错误码（所有 assessment:* 失败路径共用）
// 业务校验码（FORBIDDEN / NOT_FOUND / SESSION_* / QUESTION_* / BLOCKED_* / VALIDATION_ERROR）
// 不 seed、不写审计；ERROR 级码（ASSESSMENT_* / ANSWER_* / EMOTION_* / REDLINE_* / QUESTION_BANK_*）
// 由 Step 6b seedAssessmentErrorCodes 写入并在异常时审计。两者在此统一为返回联合。
export type AssessmentErrorCode =
  | 'FORBIDDEN'
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'SESSION_ALREADY_OPEN'
  | 'SESSION_NOT_ACTIVE'
  | 'SESSION_PAUSED'
  | 'SESSION_HALTED'
  | 'QUESTION_NOT_IN_SESSION'
  | 'ALREADY_ANSWERED'
  | 'BLOCKED_BY_SAFETY_INCIDENT'
  | 'QUESTION_BANK_INSUFFICIENT'
  | 'ASSESSMENT_SYSTEM_ERROR'
  | 'ASSESSMENT_FSM_VIOLATION'
  | 'ANSWER_PERSIST_FAILED'
  | 'EMOTION_TRANSITION_FAILED'
  | 'REDLINE_TRIGGER_SYSTEM_ERROR'

export interface AssessmentOpError {
  success: false
  errorCode: AssessmentErrorCode
}

// assessment_session_question 的渲染视图（createSession 返回 ONLINE 题，getSession 可返回全量）
export interface SessionQuestionView {
  questionId: string
  questionOrder: number
  questionPhase: 'ONLINE' | 'OFFLINE'
  moduleType: AbilityTag
  questionType: 'TRUE_FALSE' | 'SINGLE_CHOICE' | 'DRAG'
}

// assessment_session 的投影视图（getSession 返回）
export interface SessionDetail {
  sessionId: string
  studentId: string
  strategyId: string
  strategyType: AssessmentStrategyType
  strategyVersion: number
  jobCode: string
  taskCode: string
  status: SessionStatus
  onlineQuestionCount: number
  offlineQuestionCount: number
  onlineCompletedCount: number
  currentQuestionId: string | null
  pauseCount: number
  pauseStartedAt: string | null
  lastInterruptionReason: string | null
  redlineIncidentId: string | null
  levelResult: string | null
  startedAt: string | null
  completedAt: string | null
  createdAt: string
}

// --- createSession（TEACHER）---
export interface CreateSessionParams {
  callerUserId: string
  callerRole: string
  studentId: string
  strategyId: string
  strategyVersion: number
}

export interface CreateSessionSuccess {
  success: true
  sessionId: string
  // 仅返回 ONLINE 题（学生立即可答）；OFFLINE 题由线下评分流程处理
  questions: SessionQuestionView[]
}

// --- getSession ---
export interface GetSessionParams {
  callerUserId: string
  callerRole: string
  sessionId: string
}

export interface GetSessionSuccess {
  success: true
  session: SessionDetail
}

// --- submitAnswer（STUDENT）---
// answerPayload 复用 event-payloads AnswerPayloadDetail：renderer → main → event payload
// 结构 1:1，无需映射层（impl.md Step 7 文本描述的 selected_option/slots 字段名与
// event-payloads.ts 不一致，以 event-payloads.ts 为准，Step 7 实现 handler 时同步文档）
export interface SubmitAnswerParams {
  callerUserId: string
  callerRole: string
  sessionId: string
  questionId: string
  answerPayload: AnswerPayloadDetail
}

export interface SubmitAnswerSuccess {
  success: true
  answerId: string
  isCorrect: boolean
  score: 0 | 1 | 2
}

// --- emotionInterrupt（STUDENT 触发，含自动检测）---
export interface EmotionInterruptParams {
  callerUserId: string
  callerRole: string
  sessionId: string
  currentQuestionOrder?: number | null
  reason?: string | null
}

// --- emotionResume（TEACHER 恢复，impl.md Step 7）---
export interface EmotionResumeParams {
  callerUserId: string
  callerRole: string
  sessionId: string
  resumeFromQuestionOrder?: number | null
}

// --- abortSession（TEACHER）---
export interface AbortSessionParams {
  callerUserId: string
  callerRole: string
  sessionId: string
  reason?: string | null
}

// --- triggerRedline（TEACHER）---
export interface TriggerRedlineParams {
  callerUserId: string
  callerRole: string
  sessionId: string
  reasonCode: string
  contextPhase: string
}

export interface TriggerRedlineSuccess {
  success: true
  incidentId: string
  sessionId: string
}

// --- calculateResult（TEACHER，会话完成后等级判定）---
export interface CalculateResultParams {
  callerUserId: string
  callerRole: string
  sessionId: string
}

export interface CalculateResultSuccess {
  success: true
  resultId: string
  levelResult: string
  normalizedScore: number
}

// --- Result（discriminated union，与 student.ts / strategy.ts 同模式）---
export type CreateSessionResult = CreateSessionSuccess | AssessmentOpError
export type GetSessionResult = GetSessionSuccess | AssessmentOpError
export type SubmitAnswerResult = SubmitAnswerSuccess | AssessmentOpError
export type EmotionInterruptResult = { success: true } | AssessmentOpError
export type EmotionResumeResult = { success: true } | AssessmentOpError
export type AbortSessionResult = { success: true } | AssessmentOpError
export type TriggerRedlineResult = TriggerRedlineSuccess | AssessmentOpError
export type CalculateResultResult = CalculateResultSuccess | AssessmentOpError
