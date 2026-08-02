import type {
  QuestionBankCatalogItem,
  QuestionBankCatalogStatus,
  QuestionBankCatalogType
} from '@shared/types/question-bank-catalog'

export const QUESTION_TYPE_LABELS: Record<QuestionBankCatalogType, string> = {
  TRUE_FALSE: '判断题',
  SINGLE_CHOICE: '单选题',
  DRAG: '拖拽题',
  SOFTWARE_TASK: '软件任务',
  OFFLINE_OPERATION: '线下实操'
}

export const QUESTION_STATUS_LABELS: Record<QuestionBankCatalogStatus, string> = {
  ACTIVE: '可演示',
  DRAFT: '待评审',
  DISABLED: '已停用',
  ARCHIVED: '已归档'
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export function textValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(textValue).join('；')
  return JSON.stringify(value, null, 2)
}

export function questionPrompt(item: QuestionBankCatalogItem): string {
  return typeof item.content?.prompt === 'string' ? item.content.prompt : '题干数据无法读取'
}

export function contentField(item: QuestionBankCatalogItem, ...keys: string[]): string {
  for (const key of keys) {
    const value = item.content?.[key]
    if (value !== undefined && value !== null && value !== '') return textValue(value)
  }
  return '—'
}

export function interactionOptions(item: QuestionBankCatalogItem): Array<{ key: string; text: string }> {
  const interaction = record(item.content?.interaction)
  const config = record(interaction?.config)
  const options = config?.options
  if (!Array.isArray(options)) return []
  return options.flatMap((value, index) => {
    const option = record(value)
    if (!option || typeof option.text !== 'string') return []
    const key = typeof option.key === 'string' ? option.key : String(index + 1)
    return [{ key, text: option.text }]
  })
}

export function interactionItems(item: QuestionBankCatalogItem): Array<{ key: string; text: string }> {
  const interaction = record(item.content?.interaction)
  const config = record(interaction?.config)
  const values = Array.isArray(config?.items) ? config.items : []
  return values.flatMap((value, index) => {
    const entry = record(value)
    const label = entry?.label ?? entry?.text
    if (typeof label !== 'string') return []
    const key = typeof entry?.item_id === 'string' ? entry.item_id : String(index + 1)
    return [{ key, text: label }]
  })
}

export function rubricCriteria(item: QuestionBankCatalogItem): Array<{ key: string; text: string }> {
  const values = Array.isArray(item.content?.rubric_criteria) ? item.content.rubric_criteria : []
  return values.flatMap((value, index) => {
    const criterion = record(value)
    if (!criterion || typeof criterion.description !== 'string') return []
    const key = typeof criterion.criterion_id === 'string' ? criterion.criterion_id : String(index + 1)
    return [{ key, text: criterion.description }]
  })
}

export function scoringEntries(item: QuestionBankCatalogItem): Array<{ key: string; value: string }> {
  if (!item.scoringRule) return []
  return Object.entries(item.scoringRule).map(([key, value]) => ({ key, value: textValue(value) }))
}
