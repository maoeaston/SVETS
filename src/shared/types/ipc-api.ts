// 渲染进程可调用的 IPC API 接口声明
// 每个功能模块在 src/main/ipc/handlers/ 中实现，此处同步声明类型

import type {
  CreateStudentParams,
  CreateStudentResult,
  UpdateStudentParams,
  UpdateStudentResult,
  ArchiveStudentResult,
  GetStudentResult,
  StudentListParams,
  StudentListResult
} from './student'
import type {
  StrategyListParams,
  StrategyListResult,
  GetStrategyResult,
  ListStrategyVersionsResult,
  CreateStrategyVersionParams,
  CreateStrategyVersionResult,
  UpdateStrategyParams,
  UpdateStrategyResult,
  SetStrategyActiveParams,
  SetStrategyActiveResult
} from './strategy'
import type {
  CreateSessionParams,
  CreateSessionResult,
  GetSessionParams,
  GetSessionResult,
  SubmitAnswerParams,
  SubmitAnswerResult,
  EmotionInterruptParams,
  EmotionInterruptResult,
  EmotionResumeParams,
  EmotionResumeResult,
  AbortSessionParams,
  AbortSessionResult,
  TriggerRedlineParams,
  TriggerRedlineResult,
  CalculateResultParams,
  CalculateResultResult
} from './assessment'

export interface LoginSuccess {
  success: true
  userId: string
  role: 'STUDENT' | 'TEACHER' | 'ADMIN'
  displayName: string
}

export interface LoginError {
  success: false
  errorCode: 'INVALID_CREDENTIALS' | 'ACCOUNT_DISABLED' | 'SYSTEM_ERROR'
}

export type LoginResult = LoginSuccess | LoginError

export interface IpcApi {
  auth: {
    login: (params: { username: string; password: string }) => Promise<LoginResult>
  }
  student: {
    list: (params: StudentListParams) => Promise<StudentListResult>
    get: (params: {
      callerUserId: string
      callerRole: string
      studentId: string
    }) => Promise<GetStudentResult>
    create: (params: CreateStudentParams) => Promise<CreateStudentResult>
    update: (params: UpdateStudentParams) => Promise<UpdateStudentResult>
    archive: (params: {
      callerUserId: string
      callerRole: string
      studentId: string
    }) => Promise<ArchiveStudentResult>
  }
  strategy: {
    list: (params: StrategyListParams) => Promise<StrategyListResult>
    get: (params: {
      callerUserId: string
      callerRole: string
      strategyId: string
      version: number
    }) => Promise<GetStrategyResult>
    listVersions: (params: {
      callerUserId: string
      callerRole: string
      strategyId: string
    }) => Promise<ListStrategyVersionsResult>
    createVersion: (
      params: CreateStrategyVersionParams
    ) => Promise<CreateStrategyVersionResult>
    update: (params: UpdateStrategyParams) => Promise<UpdateStrategyResult>
    setActive: (params: SetStrategyActiveParams) => Promise<SetStrategyActiveResult>
  }
  assessment: {
    createSession: (params: CreateSessionParams) => Promise<CreateSessionResult>
    getSession: (params: GetSessionParams) => Promise<GetSessionResult>
    submitAnswer: (params: SubmitAnswerParams) => Promise<SubmitAnswerResult>
    emotionInterrupt: (
      params: EmotionInterruptParams
    ) => Promise<EmotionInterruptResult>
    emotionResume: (params: EmotionResumeParams) => Promise<EmotionResumeResult>
    abortSession: (params: AbortSessionParams) => Promise<AbortSessionResult>
    triggerRedline: (params: TriggerRedlineParams) => Promise<TriggerRedlineResult>
    calculateResult: (
      params: CalculateResultParams
    ) => Promise<CalculateResultResult>
  }
}
