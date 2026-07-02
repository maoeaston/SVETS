// 策略配置（strategy_config）管理的 IPC 类型契约。
// questionPolicy / scoringPolicy 复用 json-schemas.ts 的 JSON 字段类型，不重复定义。
// 对应 schema strategy_config 表 + AGENTS.md「单一策略配置源」原则。

import type { QuestionPolicyJson, ScoringPolicyJson } from './json-schemas'

export type { QuestionPolicyJson, ScoringPolicyJson }

// 对应 schema strategy_config.strategy_type CHECK 枚举
export type StrategyType = 'BASELINE_ASSESSMENT' | 'MOCK_EXAM' | 'TRAINING_PRACTICE'

// 统一错误码（所有 strategy:* 失败路径共用）
export type StrategyErrorCode =
  | 'FORBIDDEN'
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'DUPLICATE_STRATEGY_ID'
  | 'DUPLICATE_VERSION'
  | 'DUPLICATE_JOB_STRATEGY'
  | 'STRATEGY_TYPE_MISMATCH'
  | 'JOB_CODE_MISMATCH'
  | 'QUESTION_RATIO_MISMATCH'
  | 'INVALID_QUESTION_POLICY'
  | 'INVALID_SCORING_POLICY'
  | 'REFERENCED_IMMUTABLE'
  | 'SYSTEM_ERROR'

export interface StrategyOpError {
  success: false
  errorCode: StrategyErrorCode
}

// --- list ---
export interface StrategyListParams {
  callerUserId: string
  callerRole: string
  strategyType?: StrategyType
  jobCode?: string
  isActive?: boolean
  includeInactive?: boolean
  page?: number
}

export interface StrategySummary {
  strategyId: string
  strategyType: StrategyType
  jobCode: string
  strategyName: string
  version: number
  isActive: boolean
  competentThreshold: number
  conditionalThreshold: number
  moduleVetoThreshold: number
  emotionCollapseThreshold: number
  onlineQuestionCount: number
  offlineQuestionCount: number
  maxScore: number
  createdAt: string
  updatedAt: string
}

export interface StrategyListSuccess {
  success: true
  items: StrategySummary[]
  page: number
}

// --- get / listVersions ---
export interface StrategyDetail extends StrategySummary {
  questionPolicy: QuestionPolicyJson
  scoringPolicy: ScoringPolicyJson
  supportsRedlineHalt: boolean
  allowsEmotionInterrupt: boolean
  requiresOfflineScoring: boolean
}

export interface StrategyGetSuccess {
  success: true
  strategy: StrategyDetail
}

export interface StrategyListVersionsSuccess {
  success: true
  items: StrategySummary[]
  familyStrategyId: string
  familyStrategyType: StrategyType
  familyJobCode: string
}

// --- createVersion（新建族 + 新增版本共用）---
export interface StrategyInput {
  strategyId: string
  strategyType: StrategyType
  jobCode: string
  strategyName: string
  onlineQuestionCount: number
  offlineQuestionCount: number
  maxScore: number
  competentThreshold: number
  conditionalThreshold: number
  moduleVetoThreshold: number
  emotionCollapseThreshold: number
  questionPolicy: QuestionPolicyJson
  scoringPolicy: ScoringPolicyJson
  supportsRedlineHalt: boolean
  allowsEmotionInterrupt: boolean
  requiresOfflineScoring: boolean
  version: number
  isActive: boolean
}

export interface CreateStrategyVersionParams {
  callerUserId: string
  callerRole: string
  strategy: StrategyInput
}

// --- update（patch；只允许白名单字段）---
export interface UpdateStrategyParams {
  callerUserId: string
  callerRole: string
  strategyId: string
  version: number
  patch: {
    strategyName?: string
    onlineQuestionCount?: number
    offlineQuestionCount?: number
    maxScore?: number
    competentThreshold?: number
    conditionalThreshold?: number
    moduleVetoThreshold?: number
    emotionCollapseThreshold?: number
    questionPolicy?: QuestionPolicyJson
    scoringPolicy?: ScoringPolicyJson
    supportsRedlineHalt?: boolean
    allowsEmotionInterrupt?: boolean
    requiresOfflineScoring?: boolean
  }
}

// --- setActive ---
export interface SetStrategyActiveParams {
  callerUserId: string
  callerRole: string
  strategyId: string
  version: number
  isActive: boolean
}

// --- Result（discriminated union，与 student.ts 同模式）---
export type StrategyListResult = StrategyListSuccess | StrategyOpError
export type GetStrategyResult = StrategyGetSuccess | StrategyOpError
export type ListStrategyVersionsResult = StrategyListVersionsSuccess | StrategyOpError
export type CreateStrategyVersionResult = { success: true } | StrategyOpError
export type UpdateStrategyResult = { success: true } | StrategyOpError
export type SetStrategyActiveResult = { success: true } | StrategyOpError
