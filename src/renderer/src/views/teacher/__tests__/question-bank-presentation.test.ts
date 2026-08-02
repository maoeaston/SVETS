import { describe, expect, it } from 'vitest'
import type { QuestionBankCatalogItem } from '@shared/types/question-bank-catalog'
import {
  QUESTION_STATUS_LABELS,
  interactionOptions,
  questionPrompt,
  rubricCriteria,
  scoringEntries
} from '../question-bank-presentation'

const item: QuestionBankCatalogItem = {
  questionId: 'M1_SC_001',
  jobCode: 'SUPERMARKET_SHELVER',
  domain: 'JOB_SPECIFIC',
  moduleCode: 'M1',
  questionType: 'SINGLE_CHOICE',
  itemUsage: 'SCORED_ITEM',
  difficultyLevel: 1,
  content: {
    prompt: '正确做法是？',
    interaction: {
      config: { options: [{ key: 'A', text: '正面朝外' }, { key: 'B', text: '标签朝下' }] }
    },
    rubric_criteria: [{ criterion_id: 'r1', description: '摆放稳定' }]
  },
  scoringRule: { scoring_type: 'SINGLE_SELECT', correct_answer: 'A', max_score: 2 },
  contentParseError: false,
  scoringRuleParseError: false,
  mediaAssetId: null,
  toolAssetIds: [],
  safetySensitive: false,
  status: 'ACTIVE',
  version: 1
}

describe('question bank presentation', () => {
  it('turns structured content into teacher-readable sections', () => {
    expect(questionPrompt(item)).toBe('正确做法是？')
    expect(interactionOptions(item)).toEqual([
      { key: 'A', text: '正面朝外' },
      { key: 'B', text: '标签朝下' }
    ])
    expect(rubricCriteria(item)).toEqual([{ key: 'r1', text: '摆放稳定' }])
    expect(scoringEntries(item)).toContainEqual({ key: 'correct_answer', value: 'A' })
  })

  it('uses the approved catalog status wording', () => {
    expect(QUESTION_STATUS_LABELS.ACTIVE).toBe('可演示')
    expect(QUESTION_STATUS_LABELS.DRAFT).toBe('待评审')
  })
})
