import type { AbilityTag, ResultType, StrategyType } from './json-schemas'

export type ResultSourceAggregateType = 'ASSESSMENT_SESSION' | 'TRAINING_SESSION'

export type ResultsErrorCode =
  | 'FORBIDDEN'
  | 'VALIDATION_ERROR'
  | 'RESULTS_SYSTEM_ERROR'

export interface ResultsCallerParams {
  callerUserId: string
  callerRole: string
}

export interface ResultFilters {
  studentId?: string
  resultType?: ResultType
  sourceAggregateType?: ResultSourceAggregateType
  sourceAggregateId?: string
}

export interface GetCurrentResultParams extends ResultsCallerParams {
  studentId?: string
  resultType: ResultType
  sourceAggregateType: ResultSourceAggregateType
  sourceAggregateId: string
}

export interface ListCurrentByStudentParams extends ResultsCallerParams, ResultFilters {}

export interface CurrentResultRecord {
  resultId: string
  studentId: string
  resultType: ResultType
  sourceAggregateType: ResultSourceAggregateType
  sourceAggregateId: string
  strategyId: string | null
  strategyType: StrategyType | null
  jobCode: string
  moduleType: AbilityTag | null
  rawScore: number | null
  maxScore: number | null
  normalizedScore: number
  completionRatio: number | null
  levelResult: string | null
  safetyOverridden: boolean
  redlineIncidentId: string | null
  resultPayload: unknown | null
  generatedEventId: string
  snapshotId: string | null
  generatedAt: string
}

export interface GetCurrentResultSuccess {
  success: true
  result: CurrentResultRecord | null
}

export interface ListCurrentByStudentSuccess {
  success: true
  results: CurrentResultRecord[]
  total: number
}

export type GetCurrentResult =
  | GetCurrentResultSuccess
  | { success: false; errorCode: ResultsErrorCode }

export type ListCurrentByStudentResult =
  | ListCurrentByStudentSuccess
  | { success: false; errorCode: ResultsErrorCode }
