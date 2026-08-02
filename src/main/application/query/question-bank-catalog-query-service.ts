import type { DBAdapter } from '../../db/interface'
import type {
  QuestionBankCatalogDomain,
  QuestionBankCatalogItem,
  QuestionBankCatalogParams,
  QuestionBankCatalogResult,
  QuestionBankCatalogStatus,
  QuestionBankCatalogType
} from '../../../shared/types/question-bank-catalog'

interface QuestionRow {
  question_id: string
  job_code: string
  bank_domain: QuestionBankCatalogDomain
  module_code: string
  question_type: QuestionBankCatalogType
  item_usage: 'SCORED_ITEM' | 'OBSERVATION_ONLY'
  difficulty_level: number
  content_json: string
  scoring_rule_json: string
  media_asset_id: string | null
  tool_asset_ids_json: string | null
  safety_sensitive: number
  status: QuestionBankCatalogStatus
  version: number
}

const DOMAINS = new Set<QuestionBankCatalogDomain>(['BASE_ABILITY', 'JOB_SPECIFIC'])
const STATUSES = new Set<QuestionBankCatalogStatus>(['ACTIVE', 'DRAFT', 'DISABLED', 'ARCHIVED'])
const TYPES = new Set<QuestionBankCatalogType>([
  'TRUE_FALSE', 'SINGLE_CHOICE', 'DRAG', 'SOFTWARE_TASK', 'OFFLINE_OPERATION'
])
const MODULES = new Set([
  'M1', 'M2', 'M3', 'M4', 'M5', 'M6',
  'FINE_MOTOR', 'COGNITION', 'RULE_EXECUTION',
  'EMOTION_REGULATION', 'BASIC_SOCIAL', 'SAFETY_OPERATION'
])

function recordJson(value: string): { value: Record<string, unknown> | null; error: boolean } {
  try {
    const parsed: unknown = JSON.parse(value)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { value: parsed as Record<string, unknown>, error: false }
    }
  } catch {
    // Returned as an explicit per-row parse error; one damaged row does not hide the catalog.
  }
  return { value: null, error: true }
}

function stringArrayJson(value: string | null): readonly string[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string') ? parsed : []
  } catch {
    return []
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`)
}

function validate(params: QuestionBankCatalogParams): boolean {
  if (params.domain !== undefined && !DOMAINS.has(params.domain)) return false
  if (params.status !== undefined && !STATUSES.has(params.status)) return false
  if (params.questionType !== undefined && !TYPES.has(params.questionType)) return false
  if (params.moduleCode !== undefined && !MODULES.has(params.moduleCode)) return false
  if (params.keyword !== undefined && (typeof params.keyword !== 'string' || params.keyword.length > 100)) return false
  if (params.page !== undefined && (!Number.isSafeInteger(params.page) || params.page < 1)) return false
  if (params.pageSize !== undefined && (!Number.isSafeInteger(params.pageSize) || params.pageSize < 1 || params.pageSize > 100)) return false
  return true
}

export function listQuestionBankCatalog(
  db: DBAdapter,
  params: QuestionBankCatalogParams
): QuestionBankCatalogResult {
  if (!validate(params)) return { success: false, errorCode: 'VALIDATION_ERROR' }
  const domain = params.domain ?? 'JOB_SPECIFIC'
  const page = params.page ?? 1
  const pageSize = params.pageSize ?? 24
  const conditions = ['bank_domain = ?']
  const values: unknown[] = [domain]
  if (params.moduleCode) {
    conditions.push('COALESCE(job_module_code, module_type) = ?')
    values.push(params.moduleCode)
  }
  if (params.questionType) {
    conditions.push('question_type = ?')
    values.push(params.questionType)
  }
  if (params.status) {
    conditions.push('status = ?')
    values.push(params.status)
  }
  const keyword = params.keyword?.trim()
  if (keyword) {
    conditions.push(`(question_id LIKE ? ESCAPE '\\' OR content_json LIKE ? ESCAPE '\\')`)
    const pattern = `%${escapeLike(keyword)}%`
    values.push(pattern, pattern)
  }
  const where = conditions.join(' AND ')

  try {
    const total = (db.prepare(
      `SELECT COUNT(*) AS count FROM question_bank WHERE ${where}`
    ).get(...values) as { count: number }).count
    const rows = db.prepare(
      `SELECT question_id, job_code, bank_domain,
              COALESCE(job_module_code, module_type) AS module_code,
              question_type, item_usage, difficulty_level,
              content_json, scoring_rule_json, media_asset_id,
              tool_asset_ids_json, safety_sensitive, status, version
         FROM question_bank
        WHERE ${where}
        ORDER BY COALESCE(job_module_code, module_type), question_id
        LIMIT ? OFFSET ?`
    ).all(...values, pageSize, (page - 1) * pageSize) as unknown as QuestionRow[]
    const items: QuestionBankCatalogItem[] = rows.map((row) => {
      const content = recordJson(row.content_json)
      const scoringRule = recordJson(row.scoring_rule_json)
      return {
        questionId: row.question_id,
        jobCode: row.job_code,
        domain: row.bank_domain,
        moduleCode: row.module_code,
        questionType: row.question_type,
        itemUsage: row.item_usage,
        difficultyLevel: row.difficulty_level,
        content: content.value,
        scoringRule: scoringRule.value,
        contentParseError: content.error,
        scoringRuleParseError: scoringRule.error,
        mediaAssetId: row.media_asset_id,
        toolAssetIds: stringArrayJson(row.tool_asset_ids_json),
        safetySensitive: row.safety_sensitive === 1,
        status: row.status,
        version: row.version
      }
    })
    return { success: true, total, page, pageSize, items }
  } catch {
    return { success: false, errorCode: 'SYSTEM_ERROR' }
  }
}
