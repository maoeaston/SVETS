export type QuestionBankCatalogDomain = 'BASE_ABILITY' | 'JOB_SPECIFIC'
export type QuestionBankCatalogStatus = 'ACTIVE' | 'DRAFT' | 'DISABLED' | 'ARCHIVED'
export type QuestionBankCatalogType =
  | 'TRUE_FALSE'
  | 'SINGLE_CHOICE'
  | 'DRAG'
  | 'SOFTWARE_TASK'
  | 'OFFLINE_OPERATION'

export interface QuestionBankCatalogParams {
  domain?: QuestionBankCatalogDomain
  moduleCode?: string
  questionType?: QuestionBankCatalogType
  status?: QuestionBankCatalogStatus
  keyword?: string
  page?: number
  pageSize?: number
}

export interface QuestionBankCatalogItem {
  questionId: string
  jobCode: string
  domain: QuestionBankCatalogDomain
  moduleCode: string
  questionType: QuestionBankCatalogType
  itemUsage: 'SCORED_ITEM' | 'OBSERVATION_ONLY'
  difficultyLevel: number
  content: Record<string, unknown> | null
  scoringRule: Record<string, unknown> | null
  contentParseError: boolean
  scoringRuleParseError: boolean
  mediaAssetId: string | null
  toolAssetIds: readonly string[]
  safetySensitive: boolean
  status: QuestionBankCatalogStatus
  version: number
}

export type QuestionBankCatalogResult =
  | {
      success: true
      total: number
      page: number
      pageSize: number
      items: readonly QuestionBankCatalogItem[]
    }
  | { success: false; errorCode: 'FORBIDDEN' | 'VALIDATION_ERROR' | 'SYSTEM_ERROR' }
