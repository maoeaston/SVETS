// assessment Pinia store：封装 11 个 IPC（createSession / getSession / listSessions /
// submitAnswer / startSession / listMySessions / emotionInterrupt / emotionResume /
// abortSession / triggerRedline / calculateResult）。
//
// 设计要点：
// - 学生答题路径 actions（startSession / submitAnswer / emotionInterrupt）成功后**自动
//   loadSession 刷新** currentSession + currentQuestion，避免 view 层手动串联中间态。
// - 教师操作 actions（createSession / abortSession / triggerRedline / emotionResume /
//   calculateResult）不刷新 currentSession（教师视图多 session 切换，由调用方决定刷新策略）。
// - 错误码原样返回，让 view 层决定 UI 响应（弹错提示、跳转等）。
// - 系统级异常（IPC reject）转 'ASSESSMENT_SYSTEM_ERROR' 兜底。

import { defineStore } from 'pinia'
import { ref } from 'vue'
import type {
  SessionDetail,
  SessionQuestionContent,
  SessionListItem,
  SessionQuestionView,
  CreateSessionParams,
  CreateSessionResult,
  SubmitAnswerParams,
  SubmitAnswerResult,
  StartSessionParams,
  StartSessionResult,
  ListMySessionsParams,
  ListSessionsParams,
  ListSessionsResult,
  EmotionInterruptParams,
  EmotionResumeParams,
  AbortSessionParams,
  TriggerRedlineParams,
  TriggerRedlineResult,
  CalculateResultParams,
  CalculateResultResult,
  AssessmentErrorCode,
  AnswerPayloadDetail
} from '@shared/types/assessment'

export const useAssessmentStore = defineStore('assessment', () => {
  const currentSession = ref<SessionDetail | null>(null)
  const currentQuestion = ref<SessionQuestionContent | null>(null)
  const sessionList = ref<SessionListItem[]>([])
  const loading = ref(false)
  const errorMsg = ref('')

  /** 错误码 → 中文消息（view 层简化展示；不枚举所有码，未匹配用通用文案）。 */
  function mapError(code: AssessmentErrorCode | string): string {
    const map: Record<string, string> = {
      FORBIDDEN: '无权限',
      NOT_FOUND: '测评不存在',
      SESSION_ALREADY_OPEN: '该学生已有进行中的同类型测评',
      SESSION_NOT_ACTIVE: '测评已结束',
      SESSION_PAUSED: '测评已暂停（情绪中断中）',
      SESSION_HALTED: '测评已被红线终止',
      QUESTION_NOT_IN_SESSION: '题目不属于当前测评',
      ALREADY_ANSWERED: '该题已作答',
      BLOCKED_BY_SAFETY_INCIDENT: '存在未解决的安全事件，无法开始新测评',
      VALIDATION_ERROR: '输入数据有误',
      ASSESSMENT_SYSTEM_ERROR: '系统异常，请重试',
      ASSESSMENT_FSM_VIOLATION: '状态机异常',
      QUESTION_BANK_INSUFFICIENT: '题库不足，请联系运营',
      ANSWER_PERSIST_FAILED: '答题保存失败',
      EMOTION_TRANSITION_FAILED: '情绪状态切换失败',
      REDLINE_TRIGGER_SYSTEM_ERROR: '红线触发异常'
    }
    return map[code] ?? '操作失败'
  }

  /**
   * 加载 session + 当前题目。STUDENT 调自己的、TEACHER/ADMIN 调任意。
   * 成功 → 更新 currentSession + currentQuestion；失败 → 设置 errorMsg + 清空。
   */
  async function loadSession(
    callerUserId: string,
    callerRole: string,
    sessionId: string
  ): Promise<{ ok: true } | { ok: false; errorCode: AssessmentErrorCode }> {
    loading.value = true
    errorMsg.value = ''
    try {
      const res = await window.api.assessment.getSession({ callerUserId, callerRole, sessionId })
      if (!res.success) {
        errorMsg.value = mapError(res.errorCode)
        currentSession.value = null
        currentQuestion.value = null
        return { ok: false, errorCode: res.errorCode }
      }
      currentSession.value = res.session
      currentQuestion.value = res.currentQuestion
      return { ok: true }
    } catch {
      errorMsg.value = '系统异常'
      currentSession.value = null
      currentQuestion.value = null
      return { ok: false, errorCode: 'ASSESSMENT_SYSTEM_ERROR' }
    } finally {
      loading.value = false
    }
  }

  /**
   * 学生首次点"开始答题"。成功后**自动 loadSession 刷新**（让 currentQuestion 立即就绪）。
   * 幂等：若已开始（current_question_id 已设），IPC 直接返回现有指针，store 仍刷新。
   */
  async function startSession(
    callerUserId: string,
    callerRole: string,
    sessionId: string
  ): Promise<{ ok: true } | { ok: false; errorCode: AssessmentErrorCode }> {
    errorMsg.value = ''
    try {
      const res = await window.api.assessment.startSession({ callerUserId, callerRole, sessionId })
      if (!res.success) {
        errorMsg.value = mapError(res.errorCode)
        return { ok: false, errorCode: res.errorCode }
      }
      // 自动刷新：让 currentQuestion 立即就绪。
      // [!] 刷新失败必须 propagate：写路径已成功（DB 已更新 current_question_id），
      // 但若 loadSession 失败（如 IPC transient），currentSession/currentQuestion 被清空，
      // 此时返回 ok:true 会让 view 误判状态不一致。让调用方拿到 errorCode 自行重试。
      const refresh = await loadSession(callerUserId, callerRole, sessionId)
      if (!refresh.ok) {
        return { ok: false, errorCode: refresh.errorCode }
      }
      return { ok: true }
    } catch {
      errorMsg.value = '系统异常'
      return { ok: false, errorCode: 'ASSESSMENT_SYSTEM_ERROR' }
    }
  }

  /**
   * 学生提交答案。成功后**自动 loadSession 刷新**（currentQuestion 推进到下一题）。
   * 失败 → 设置 errorMsg；不刷新 currentSession（保持当前题目可见，便于学生重试）。
   */
  async function submitAnswer(
    callerUserId: string,
    callerRole: string,
    sessionId: string,
    questionId: string,
    answerPayload: AnswerPayloadDetail
  ): Promise<{ ok: true; isCorrect: boolean; score: 0 | 2 } | { ok: false; errorCode: AssessmentErrorCode }> {
    errorMsg.value = ''
    const params: SubmitAnswerParams = { callerUserId, callerRole, sessionId, questionId, answerPayload }
    try {
      const res = await window.api.assessment.submitAnswer(params)
      if (!res.success) {
        errorMsg.value = mapError(res.errorCode)
        return { ok: false, errorCode: res.errorCode }
      }
      // 自动刷新：currentQuestion 推进。
      // [!] 刷新失败必须 propagate：reducer 已推进 current_question_id（DB 已写），
      // 若 loadSession 失败导致 currentQuestion 仍指向已答题目，用户重新提交会得到
      // ALREADY_ANSWERED 死循环。让调用方拿到 errorCode 自行刷新页面恢复。
      const refresh = await loadSession(callerUserId, callerRole, sessionId)
      if (!refresh.ok) {
        return { ok: false, errorCode: refresh.errorCode }
      }
      return { ok: true, isCorrect: res.isCorrect, score: res.score }
    } catch {
      errorMsg.value = '系统异常'
      return { ok: false, errorCode: 'ASSESSMENT_SYSTEM_ERROR' }
    }
  }

  /**
   * 学生触发情绪中断。成功后**自动 loadSession 刷新**（status 变 EMOTION_INTERRUPTED）。
   */
  async function emotionInterrupt(
    callerUserId: string,
    callerRole: string,
    sessionId: string,
    reason?: string | null,
    currentQuestionOrder?: number | null
  ): Promise<{ ok: true } | { ok: false; errorCode: AssessmentErrorCode }> {
    errorMsg.value = ''
    const params: EmotionInterruptParams = {
      callerUserId,
      callerRole,
      sessionId,
      reason: reason ?? null,
      currentQuestionOrder: currentQuestionOrder ?? null
    }
    try {
      const res = await window.api.assessment.emotionInterrupt(params)
      if (!res.success) {
        errorMsg.value = mapError(res.errorCode)
        return { ok: false, errorCode: res.errorCode }
      }
      const refresh = await loadSession(callerUserId, callerRole, sessionId)
      if (!refresh.ok) {
        return { ok: false, errorCode: refresh.errorCode }
      }
      return { ok: true }
    } catch {
      errorMsg.value = '系统异常'
      return { ok: false, errorCode: 'ASSESSMENT_SYSTEM_ERROR' }
    }
  }

  /**
   * 学生自查列表（STUDENT 视角）。成功 → 更新 sessionList。
   */
  async function loadMySessions(
    callerUserId: string,
    callerRole: string
  ): Promise<{ ok: true } | { ok: false; errorCode: AssessmentErrorCode }> {
    loading.value = true
    errorMsg.value = ''
    const params: ListMySessionsParams = { callerUserId, callerRole }
    try {
      const res = await window.api.assessment.listMySessions(params)
      if (!res.success) {
        errorMsg.value = mapError(res.errorCode)
        sessionList.value = []
        return { ok: false, errorCode: res.errorCode }
      }
      sessionList.value = res.items
      return { ok: true }
    } catch {
      errorMsg.value = '系统异常'
      sessionList.value = []
      return { ok: false, errorCode: 'ASSESSMENT_SYSTEM_ERROR' }
    } finally {
      loading.value = false
    }
  }

  /**
   * 教师查全部/按学生筛（TEACHER/ADMIN 视角）。成功 → 更新 sessionList。
   */
  async function loadTeacherSessions(
    callerUserId: string,
    callerRole: string,
    studentId?: string
  ): Promise<{ ok: true } | { ok: false; errorCode: AssessmentErrorCode }> {
    loading.value = true
    errorMsg.value = ''
    const params: ListSessionsParams = { callerUserId, callerRole, studentId }
    try {
      const res = await window.api.assessment.listSessions(params)
      if (!res.success) {
        errorMsg.value = mapError(res.errorCode)
        sessionList.value = []
        return { ok: false, errorCode: res.errorCode }
      }
      sessionList.value = res.items
      return { ok: true }
    } catch {
      errorMsg.value = '系统异常'
      sessionList.value = []
      return { ok: false, errorCode: 'ASSESSMENT_SYSTEM_ERROR' }
    } finally {
      loading.value = false
    }
  }

  // --- 教师操作 actions（不刷新 currentSession；成功后调用方决定后续动作）---

  async function createSession(
    params: CreateSessionParams
  ): Promise<CreateSessionResult> {
    try {
      return await window.api.assessment.createSession(params)
    } catch {
      return { success: false, errorCode: 'ASSESSMENT_SYSTEM_ERROR' }
    }
  }

  async function abortSession(
    params: AbortSessionParams
  ): Promise<{ ok: true } | { ok: false; errorCode: AssessmentErrorCode }> {
    try {
      const res = await window.api.assessment.abortSession(params)
      if (!res.success) {
        errorMsg.value = mapError(res.errorCode)
        return { ok: false, errorCode: res.errorCode }
      }
      return { ok: true }
    } catch {
      errorMsg.value = '系统异常'
      return { ok: false, errorCode: 'ASSESSMENT_SYSTEM_ERROR' }
    }
  }

  async function triggerRedline(
    params: TriggerRedlineParams
  ): Promise<TriggerRedlineResult> {
    try {
      return await window.api.assessment.triggerRedline(params)
    } catch {
      return { success: false, errorCode: 'REDLINE_TRIGGER_SYSTEM_ERROR' }
    }
  }

  async function emotionResume(
    params: EmotionResumeParams
  ): Promise<{ ok: true } | { ok: false; errorCode: AssessmentErrorCode }> {
    try {
      const res = await window.api.assessment.emotionResume(params)
      if (!res.success) {
        errorMsg.value = mapError(res.errorCode)
        return { ok: false, errorCode: res.errorCode }
      }
      return { ok: true }
    } catch {
      errorMsg.value = '系统异常'
      return { ok: false, errorCode: 'ASSESSMENT_SYSTEM_ERROR' }
    }
  }

  async function calculateResult(
    params: CalculateResultParams
  ): Promise<CalculateResultResult> {
    try {
      return await window.api.assessment.calculateResult(params)
    } catch {
      return { success: false, errorCode: 'ASSESSMENT_SYSTEM_ERROR' }
    }
  }

  /** 清空 currentSession/currentQuestion（路由离开时调用）。 */
  function clearCurrent(): void {
    currentSession.value = null
    currentQuestion.value = null
    errorMsg.value = ''
  }

  return {
    currentSession,
    currentQuestion,
    sessionList,
    loading,
    errorMsg,
    loadSession,
    startSession,
    submitAnswer,
    emotionInterrupt,
    loadMySessions,
    loadTeacherSessions,
    createSession,
    abortSession,
    triggerRedline,
    emotionResume,
    calculateResult,
    clearCurrent,
    mapError
  }
})

// 重导类型供 view 层使用
export type {
  SessionDetail,
  SessionQuestionContent,
  SessionListItem,
  SessionQuestionView
}
