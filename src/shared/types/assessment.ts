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

// assessment 仅接受 BASELINE_ASSESSMENT / MOCK_EXAM / JOB_SKILL_ASSESSMENT
export type AssessmentStrategyType = 'BASELINE_ASSESSMENT' | 'MOCK_EXAM' | 'JOB_SKILL_ASSESSMENT'

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
// [!] taskCode 是 Step 6a 遗漏：schema assessment_session.task_code NOT NULL，
// PRD §17 要求 TEACHER 传 task（MVP 单任务"拆箱与上架"）。Step 6b 补上。
// jobCode 不在参数中——从 strategy_config.job_code 派生（岗位属策略属性，非调用者选择）。
export interface CreateSessionParams {
  callerUserId: string
  callerRole: string
  studentId: string
  strategyId: string
  strategyVersion: number
  taskCode: string
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

// 当前题目正文（脱敏后）。expected_answer / is_correct 由主进程剥离，
// 渲染层不可见。题型分支字段（options / dragItems / variants）按 questionType 出现。
export interface SessionQuestionContent {
  questionId: string
  questionOrder: number
  questionPhase: 'ONLINE' | 'OFFLINE'
  moduleType: AbilityTag
  questionType: 'TRUE_FALSE' | 'SINGLE_CHOICE' | 'DRAG'
  prompt: string
  assessmentPoint: string
  // SINGLE_CHOICE 选项（已脱敏，无 is_correct）
  options?: { key: string; text: string; imageAssetId?: string | null }[]
  // DRAG 拖拽配置
  dragItems?: { itemId: string; label: string; imageAssetId?: string | null }[]
  dropZones?: { zoneId: string; label: string }[]
  scoringMode?: 'ALL_OR_NOTHING' | 'PARTIAL_CREDIT'
  // question_bank.media_asset_id（题目主图）
  mediaAssetId?: string | null
  mediaBrief?: string | null
  // TRUE_FALSE variants（图片变体，已脱敏，无 expected_answer）
  variants?: { variantId: string; mediaAssetId: string | null; mediaBrief: string }[]
}

export interface GetSessionSuccess {
  success: true
  session: SessionDetail
  // currentQuestionId 非空时返回脱敏后的题目正文；解析失败或 currentQuestionId 为空 → null
  currentQuestion: SessionQuestionContent | null
}

// --- listSessions（教师端列表：返回全部非终态 session）---
export interface ListSessionsParams {
  callerUserId: string
  callerRole: string
  // 可选筛选；不传 = 全部学生（TEACHER/ADMIN 视角）
  studentId?: string
}

export interface SessionListItem {
  sessionId: string
  studentId: string
  studentName: string
  strategyId: string
  strategyType: AssessmentStrategyType
  strategyVersion: number
  jobCode: string
  taskCode: string
  status: SessionStatus
  onlineQuestionCount: number
  onlineCompletedCount: number
  currentQuestionId: string | null
  pauseCount: number
  redlineIncidentId: string | null
  lastInterruptionReason: string | null
  createdAt: string
  startedAt: string | null
}

export interface ListSessionsSuccess {
  success: true
  items: SessionListItem[]
}

// --- listMySessions（STUDENT 视角：返回自己的非终态 session）---
// 复用 SessionListItem + OPEN_SESSION_STATUSES 过滤（与 listSessions 一致）。
// 学生端入口：登录后查看自己可继续的 session 列表。
export interface ListMySessionsParams {
  callerUserId: string
  callerRole: string
}

export interface ListMySessionsSuccess {
  success: true
  items: SessionListItem[]
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
  score: 0 | 2
}

// --- startSession（STUDENT）---
// 学生首次进入 session（current_question_id=null）点"开始答题"。
// 写 SESSION_FIRST_QUESTION_ACTIVATED 事件 + reducer 推进 current_question_id。
// 幂等：current_question_id 已非 NULL → 直接返回现有指针，不写事件。
// status 必须 ACTIVE；其他态映射错误码（SESSION_PAUSED / SESSION_HALTED / SESSION_NOT_ACTIVE）。
export interface StartSessionParams {
  callerUserId: string
  callerRole: string
  sessionId: string
}

export interface StartSessionSuccess {
  success: true
  firstQuestionId: string
  firstQuestionOrder: number
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
export type ListSessionsResult = ListSessionsSuccess | AssessmentOpError
export type SubmitAnswerResult = SubmitAnswerSuccess | AssessmentOpError
export type StartSessionResult = StartSessionSuccess | AssessmentOpError
export type ListMySessionsResult = ListMySessionsSuccess | AssessmentOpError
export type EmotionInterruptResult = { success: true } | AssessmentOpError
export type EmotionResumeResult = { success: true } | AssessmentOpError
export type AbortSessionResult = { success: true } | AssessmentOpError
export type TriggerRedlineResult = TriggerRedlineSuccess | AssessmentOpError
export type CalculateResultResult = CalculateResultSuccess | AssessmentOpError
