// 渲染进程可调用的 IPC API 接口声明
// 每个功能模块在 src/main/ipc/handlers/ 中实现，此处同步声明类型

import type {
  LoginParams,
  LoginResult,
  CurrentSessionResult,
  LogoutResult,
  ListAccountsParams,
  ListAccountsResult,
  CreateTeacherAccountParams,
  CreateTeacherAccountResult,
  SetTeacherAccountStatusParams,
  SetTeacherAccountStatusResult
} from './auth'
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
  ListSessionsParams,
  ListSessionsResult,
  SubmitAnswerParams,
  SubmitAnswerResult,
  StartSessionParams,
  StartSessionResult,
  ListMySessionsParams,
  ListMySessionsResult,
  EmotionInterruptParams,
  EmotionInterruptResult,
  EmotionResumeParams,
  EmotionResumeResult,
  PauseSittingParams,
  PauseSittingResult,
  StartNextSittingParams,
  StartNextSittingResult,
  RecordEmotionCollapseParams,
  RecordEmotionCollapseResult,
  AbortSessionParams,
  AbortSessionResult,
  TriggerRedlineParams,
  TriggerRedlineResult,
  CalculateResultParams,
  CalculateResultResult
} from './assessment'
import type {
  ConfirmSafetyIncidentParams,
  ResolveSafetyIncidentParams,
  VoidSafetyIncidentParams,
  ReplaceSafetyIncidentParams,
  SafetyIncidentMutationResult,
  ListSafetyIncidentsParams,
  ListSafetyIncidentsResult,
  GetSafetyIncidentParams,
  GetSafetyIncidentResult
} from './safety-incident'
import type {
  CreateTrainingSessionParams,
  CreateTrainingSessionResult,
  ListTrainingSessionsParams,
  ListTrainingSessionsResult,
  GetTrainingSessionParams,
  GetTrainingSessionResult,
  TrainingStepActionParams,
  TrainingStepActionResult,
  ListMyTrainingSessionsParams,
  ListMyTrainingSessionsResult
} from './training'
import type {
  TrustedCallerParams,
  GetWorkspaceOverviewResult,
  ListExceptionsParams,
  ListExceptionsResult,
  GetExceptionParams,
  GetExceptionResult
} from './foundation'
import type {
  SubmitOfflineAbilityScoresParams,
  SubmitOfflineAbilityScoresResult,
  GetOfflineAbilityScoresParams,
  GetOfflineAbilityScoresResult
} from './ability-scoring'
import type {
  SubmitOperationScoresParams,
  SubmitOperationScoresResult,
  GetOperationScoresParams,
  GetOperationScoresResult
} from './operation-scoring'
import type {
  SubmitJobSkillOfflineScoresParams,
  SubmitJobSkillOfflineScoresResult,
  GetJobSkillOfflineScoresParams,
  GetJobSkillOfflineScoresResult,
  GetSessionScoringQuestionsParams,
  GetSessionScoringQuestionsResult
} from './job-skill-scoring'
import type {
  RecordTeacherObservationParams,
  RecordTeacherObservationResult,
  GetTeacherObservationsParams,
  GetTeacherObservationsResult
} from './teacher-observation'
import type {
  CreateAssignmentParams,
  CreateAssignmentResult,
  ConfirmStudentAssignmentParams,
  ConfirmStudentAssignmentResult,
  StartAssignedAssessmentParams,
  StartAssignedAssessmentResult,
  RebindAssignmentParams,
  RebindAssignmentResult,
  ReleaseAssignmentParams,
  ReleaseAssignmentResult
} from './assignment'
import type {
  GetCurrentResultParams,
  GetCurrentResult,
  ListCurrentByStudentParams,
  ListCurrentByStudentResult
} from './results'

export interface IpcApi {
  auth: {
    login: (params: LoginParams) => Promise<LoginResult>
    getCurrentSession: () => Promise<CurrentSessionResult>
    logout: () => Promise<LogoutResult>
    listAccounts: (params: ListAccountsParams) => Promise<ListAccountsResult>
    createTeacherAccount: (params: CreateTeacherAccountParams) => Promise<CreateTeacherAccountResult>
    setTeacherAccountStatus: (params: SetTeacherAccountStatusParams) => Promise<SetTeacherAccountStatusResult>
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
    listSessions: (params: ListSessionsParams) => Promise<ListSessionsResult>
    submitAnswer: (params: SubmitAnswerParams) => Promise<SubmitAnswerResult>
    startSession: (params: StartSessionParams) => Promise<StartSessionResult>
    listMySessions: (params: ListMySessionsParams) => Promise<ListMySessionsResult>
    emotionInterrupt: (
      params: EmotionInterruptParams
    ) => Promise<EmotionInterruptResult>
    emotionResume: (params: EmotionResumeParams) => Promise<EmotionResumeResult>
    pauseSitting: (params: PauseSittingParams) => Promise<PauseSittingResult>
    startNextSitting: (params: StartNextSittingParams) => Promise<StartNextSittingResult>
    recordEmotionCollapse: (params: RecordEmotionCollapseParams) => Promise<RecordEmotionCollapseResult>
    abortSession: (params: AbortSessionParams) => Promise<AbortSessionResult>
    triggerRedline: (params: TriggerRedlineParams) => Promise<TriggerRedlineResult>
    calculateResult: (
      params: CalculateResultParams
    ) => Promise<CalculateResultResult>
    submitOfflineAbilityScores: (
      params: SubmitOfflineAbilityScoresParams
    ) => Promise<SubmitOfflineAbilityScoresResult>
    getOfflineAbilityScores: (
      params: GetOfflineAbilityScoresParams
    ) => Promise<GetOfflineAbilityScoresResult>
    submitOperationScores: (params: SubmitOperationScoresParams) => Promise<SubmitOperationScoresResult>
    getOperationScores: (params: GetOperationScoresParams) => Promise<GetOperationScoresResult>
    submitJobSkillOfflineScores: (
      params: SubmitJobSkillOfflineScoresParams
    ) => Promise<SubmitJobSkillOfflineScoresResult>
    getJobSkillOfflineScores: (
      params: GetJobSkillOfflineScoresParams
    ) => Promise<GetJobSkillOfflineScoresResult>
    getSessionScoringQuestions: (
      params: GetSessionScoringQuestionsParams
    ) => Promise<GetSessionScoringQuestionsResult>
    recordTeacherObservation: (
      params: RecordTeacherObservationParams
    ) => Promise<RecordTeacherObservationResult>
    getTeacherObservations: (
      params: GetTeacherObservationsParams
    ) => Promise<GetTeacherObservationsResult>
  }
  safety: {
    list: (params: ListSafetyIncidentsParams) => Promise<ListSafetyIncidentsResult>
    get: (params: GetSafetyIncidentParams) => Promise<GetSafetyIncidentResult>
    confirm: (params: ConfirmSafetyIncidentParams) => Promise<SafetyIncidentMutationResult>
    resolve: (params: ResolveSafetyIncidentParams) => Promise<SafetyIncidentMutationResult>
    void: (params: VoidSafetyIncidentParams) => Promise<SafetyIncidentMutationResult>
    replaceForFactualCorrection: (params: ReplaceSafetyIncidentParams) => Promise<SafetyIncidentMutationResult>
  }
  assignment: {
    create: (params: CreateAssignmentParams) => Promise<CreateAssignmentResult>
    confirmStudent: (
      params: ConfirmStudentAssignmentParams
    ) => Promise<ConfirmStudentAssignmentResult>
    startAssessment: (
      params: StartAssignedAssessmentParams
    ) => Promise<StartAssignedAssessmentResult>
    rebind: (params: RebindAssignmentParams) => Promise<RebindAssignmentResult>
    release: (params: ReleaseAssignmentParams) => Promise<ReleaseAssignmentResult>
  }
  training: {
    createSession: (params: CreateTrainingSessionParams) => Promise<CreateTrainingSessionResult>
    listSessions: (params: ListTrainingSessionsParams) => Promise<ListTrainingSessionsResult>
    listMySessions: (params: ListMyTrainingSessionsParams) => Promise<ListMyTrainingSessionsResult>
    getSession: (params: GetTrainingSessionParams) => Promise<GetTrainingSessionResult>
    startStep: (params: TrainingStepActionParams) => Promise<TrainingStepActionResult>
    completeStep: (params: TrainingStepActionParams) => Promise<TrainingStepActionResult>
    skipStep: (params: TrainingStepActionParams) => Promise<TrainingStepActionResult>
    failStep: (params: TrainingStepActionParams) => Promise<TrainingStepActionResult>
    retryStep: (params: TrainingStepActionParams) => Promise<TrainingStepActionResult>
  }
  foundation: {
    getOverview: (params: TrustedCallerParams) => Promise<GetWorkspaceOverviewResult>
    listExceptions: (params: ListExceptionsParams) => Promise<ListExceptionsResult>
    getException: (params: GetExceptionParams) => Promise<GetExceptionResult>
  }
  results: {
    getCurrent: (params: GetCurrentResultParams) => Promise<GetCurrentResult>
    listCurrentByStudent: (
      params: ListCurrentByStudentParams
    ) => Promise<ListCurrentByStudentResult>
  }
}
