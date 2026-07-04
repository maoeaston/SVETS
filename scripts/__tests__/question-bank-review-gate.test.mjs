import { describe, expect, it } from 'vitest'
import { buildActivateEligibleSql, reviewQuestionBankRows } from '../lib/question-bank-review-gate.mjs'

function buildTrueFalseRow(overrides = {}) {
  return {
    question_id: 'Q_BASE_SAFETY_OPERATION_TF_001',
    module_type: 'SAFETY_OPERATION',
    question_type: 'TRUE_FALSE',
    status: 'DRAFT',
    media_asset_id: 'asset_img_safety_001',
    tool_asset_ids_json: null,
    content_json: JSON.stringify({
      question_type: 'TRUE_FALSE',
      prompt: '图中的开箱动作是否安全？',
      expected_answer: true,
      assessment_point: '安全开箱动作识别',
      ability_tags: ['SAFETY_OPERATION'],
      media_brief: '正确开箱示意图',
      source: {
        import_batch_id: 'batch_20260704_001',
        source_file: '通用基础能力评估题库.xlsx',
        source_row: 12,
        imported_at: '2026-07-04T01:00:00.000Z',
        imported_by: 'codex'
      }
    }),
    scoring_rule_json: JSON.stringify({
      scoring_type: 'EXACT_MATCH',
      max_score: 2,
      correct_score: 2,
      incorrect_score: 0
    }),
    ...overrides
  }
}

const ACTIVE_ASSETS = {
  asset_img_safety_001: { asset_id: 'asset_img_safety_001', status: 'ACTIVE' }
}

describe('question-bank review gate', () => {
  it('合格 TRUE_FALSE 题通过审核', () => {
    const report = reviewQuestionBankRows([buildTrueFalseRow()], {
      assetsById: ACTIVE_ASSETS
    })

    expect(report.checked).toBe(1)
    expect(report.eligible).toBe(1)
    expect(report.blocked).toBe(0)
    expect(report.items[0]).toMatchObject({
      question_id: 'Q_BASE_SAFETY_OPERATION_TF_001',
      status: 'ELIGIBLE'
    })
  })

  it('content_json.question_type 与行字段不一致时失败', () => {
    const report = reviewQuestionBankRows(
      [
        buildTrueFalseRow({
          content_json: JSON.stringify({
            question_type: 'SINGLE_CHOICE',
            prompt: '图中的开箱动作是否安全？',
            options: [
              { key: 'A', text: '安全' },
              { key: 'B', text: '不安全' }
            ],
            expected_answer: 'A',
            assessment_point: '安全开箱动作识别',
            ability_tags: ['SAFETY_OPERATION'],
            source: {
              import_batch_id: 'batch_20260704_001',
              source_file: '通用基础能力评估题库.xlsx',
              source_row: 12,
              imported_at: '2026-07-04T01:00:00.000Z',
              imported_by: 'codex'
            }
          })
        })
      ],
      { assetsById: ACTIVE_ASSETS }
    )

    expect(report.items[0].status).toBe('BLOCKED')
    expect(report.items[0].reasons.join('\n')).toMatch(/question_type/i)
  })

  it('DRAG partial_correct_score=1 时失败', () => {
    const report = reviewQuestionBankRows(
      [
        buildTrueFalseRow({
          question_id: 'Q_BASE_FINE_MOTOR_DRAG_001',
          module_type: 'FINE_MOTOR',
          question_type: 'DRAG',
          content_json: JSON.stringify({
            question_type: 'DRAG',
            prompt: '将商品拖到正确位置',
            assessment_point: '货架分类认知',
            ability_tags: ['FINE_MOTOR'],
            drag_items: [{ item_id: 'item_1', label: '牛奶', image_asset_id: 'asset_img_safety_001' }],
            drop_zones: [{ zone_id: 'zone_1', label: '冷藏区', accepts: ['item_1'] }],
            scoring_mode: 'ALL_OR_NOTHING',
            source: {
              import_batch_id: 'batch_20260704_001',
              source_file: '通用基础能力评估题库.xlsx',
              source_row: 30,
              imported_at: '2026-07-04T01:00:00.000Z',
              imported_by: 'codex'
            }
          }),
          scoring_rule_json: JSON.stringify({
            scoring_type: 'DRAG_PARTIAL',
            max_score: 2,
            all_correct_score: 2,
            partial_correct_score: 1,
            incorrect_score: 0
          })
        })
      ],
      { assetsById: ACTIVE_ASSETS }
    )

    expect(report.items[0].status).toBe('BLOCKED')
    expect(report.items[0].reasons.join('\n')).toMatch(/partial_correct_score/i)
  })

  it('引用不存在 asset 时失败', () => {
    const report = reviewQuestionBankRows(
      [buildTrueFalseRow({ media_asset_id: 'asset_missing_001' })],
      { assetsById: ACTIVE_ASSETS }
    )

    expect(report.items[0].status).toBe('BLOCKED')
    expect(report.items[0].reasons.join('\n')).toMatch(/asset_missing_001/i)
  })

  it('引用 DEPRECATED asset 时失败', () => {
    const report = reviewQuestionBankRows([buildTrueFalseRow()], {
      assetsById: {
        asset_img_safety_001: { asset_id: 'asset_img_safety_001', status: 'DEPRECATED' }
      }
    })

    expect(report.items[0].status).toBe('BLOCKED')
    expect(report.items[0].reasons.join('\n')).toMatch(/DEPRECATED/i)
  })

  it('线上 rubric 含经提示时失败', () => {
    const report = reviewQuestionBankRows(
      [
        buildTrueFalseRow({
          content_json: JSON.stringify({
            question_type: 'TRUE_FALSE',
            prompt: '图中的开箱动作是否安全？',
            expected_answer: true,
            assessment_point: '安全开箱动作识别',
            ability_tags: ['SAFETY_OPERATION'],
            note: '原始计分规则：经提示后可以完成',
            source: {
              import_batch_id: 'batch_20260704_001',
              source_file: '通用基础能力评估题库.xlsx',
              source_row: 12,
              imported_at: '2026-07-04T01:00:00.000Z',
              imported_by: 'codex'
            }
          })
        })
      ],
      { assetsById: ACTIVE_ASSETS }
    )

    expect(report.items[0].status).toBe('BLOCKED')
    expect(report.items[0].reasons.join('\n')).toMatch(/经提示/i)
  })

  it('Step 3 的 DRAFT 占位标记必须被拦下', () => {
    const report = reviewQuestionBankRows(
      [
        buildTrueFalseRow({
          content_json: JSON.stringify({
            question_type: 'TRUE_FALSE',
            prompt: '图中的开箱动作是否安全？',
            expected_answer: false,
            assessment_point: '安全开箱动作识别',
            ability_tags: ['SAFETY_OPERATION'],
            note: '[DRAFT_REVIEW_REQUIRED] 源 CSV 导入占位，需人工补齐答案/结构后再审核激活',
            source: {
              import_batch_id: 'batch_20260704_001',
              source_file: '通用基础能力评估题库.xlsx',
              source_row: 12,
              imported_at: '2026-07-04T01:00:00.000Z',
              imported_by: 'codex'
            }
          })
        })
      ],
      { assetsById: ACTIVE_ASSETS }
    )

    expect(report.items[0].status).toBe('BLOCKED')
    expect(report.items[0].reasons.join('\n')).toMatch(/DRAFT_REVIEW_REQUIRED/)
  })

  it('activate SQL 只包含合格题', () => {
    const report = reviewQuestionBankRows(
      [
        buildTrueFalseRow(),
        buildTrueFalseRow({
          question_id: 'Q_BASE_SAFETY_OPERATION_TF_002',
          media_asset_id: 'asset_missing_001'
        })
      ],
      { assetsById: ACTIVE_ASSETS }
    )

    const sql = buildActivateEligibleSql(report.items)

    expect(sql).toContain('UPDATE question_bank SET status = \'ACTIVE\'')
    expect(sql).toContain('Q_BASE_SAFETY_OPERATION_TF_001')
    expect(sql).not.toContain('Q_BASE_SAFETY_OPERATION_TF_002')
  })
})
