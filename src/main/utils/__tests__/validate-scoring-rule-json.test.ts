import { describe, expect, it } from 'vitest'
import { validateScoringRuleJson } from '../validate-scoring-rule-json'

describe('validateScoringRuleJson — EXACT_MATCH', () => {
  it('合法 EXACT_MATCH → 通过', () => {
    const r = validateScoringRuleJson(
      {
        scoring_type: 'EXACT_MATCH',
        max_score: 2,
        correct_score: 2,
        incorrect_score: 0
      },
      'TRUE_FALSE'
    )

    expect(r).toEqual({ ok: true })
  })

  it('correct_score=1 → 失败', () => {
    const r = validateScoringRuleJson(
      {
        scoring_type: 'EXACT_MATCH',
        max_score: 2,
        correct_score: 1,
        incorrect_score: 0
      },
      'SINGLE_CHOICE'
    )

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/correct_score/i)
  })
})

describe('validateScoringRuleJson — DRAG_PARTIAL', () => {
  it('partial_correct_score=1 → 失败', () => {
    const r = validateScoringRuleJson(
      {
        scoring_type: 'DRAG_PARTIAL',
        max_score: 2,
        all_correct_score: 2,
        partial_correct_score: 1,
        incorrect_score: 0
      },
      'DRAG'
    )

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/partial_correct_score/i)
  })
})

describe('validateScoringRuleJson — OFFLINE_RUBRIC', () => {
  it('三档 label + criteria 合法 → 通过', () => {
    const r = validateScoringRuleJson(
      {
        scoring_type: 'OFFLINE_RUBRIC',
        max_score: 2,
        score_labels: { '0': '未达标', '1': '部分达标', '2': '达标' },
        criteria: [
          {
            criterion_id: 'shelf_facing',
            description_0: '未完成',
            description_1: '部分完成',
            description_2: '独立完成'
          }
        ]
      },
      'OFFLINE_OPERATION'
    )

    expect(r).toEqual({ ok: true })
  })

  it('criteria=[] → 失败', () => {
    const r = validateScoringRuleJson(
      {
        scoring_type: 'OFFLINE_RUBRIC',
        max_score: 2,
        score_labels: { '0': '未达标', '1': '部分达标', '2': '达标' },
        criteria: []
      },
      'OFFLINE_OPERATION'
    )

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/criteria/i)
  })

  it('criteria[].criterion_id 重复 → 失败', () => {
    const r = validateScoringRuleJson(
      {
        scoring_type: 'OFFLINE_RUBRIC',
        max_score: 2,
        score_labels: { '0': '未达标', '1': '部分达标', '2': '达标' },
        criteria: [
          {
            criterion_id: 'shelf_facing',
            description_0: '未完成',
            description_1: '部分完成',
            description_2: '独立完成'
          },
          {
            criterion_id: 'shelf_facing',
            description_0: '未完成',
            description_1: '部分完成',
            description_2: '独立完成'
          }
        ]
      },
      'OFFLINE_OPERATION'
    )

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/criterion_id/i)
  })
})
