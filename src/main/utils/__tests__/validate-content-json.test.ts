import { describe, expect, it } from 'vitest'
import { validateContentJson } from '../validate-content-json'

const baseFields = {
  prompt: '图中同学的理货方式是否正确？',
  assessment_point: '货架正面朝外识别',
  ability_tags: ['COGNITION']
} as const

describe('validateContentJson — TRUE_FALSE variants', () => {
  it('runtime-answer 宽松模式允许缺失 base 字段，但仍校验 variants', () => {
    const r = validateContentJson(
      {
        question_type: 'TRUE_FALSE',
        expected_answer: true,
        variants: [
          {
            variant_id: 'jdg_ms02_facing_correct_v001',
            media_asset_id: 'asset_img_jdg_ms02_facing_correct_v001',
            media_brief: '货架正面朝外，对齐整齐',
            expected_answer: true
          }
        ]
      },
      { allowMissingBaseFields: true }
    )

    expect(r).toEqual({ ok: true })
  })

  it('expected_answer + variants 同时合法 → 通过', () => {
    const r = validateContentJson({
      ...baseFields,
      question_type: 'TRUE_FALSE',
      expected_answer: true,
      variants: [
        {
          variant_id: 'jdg_ms02_facing_correct_v001',
          media_asset_id: 'asset_img_jdg_ms02_facing_correct_v001',
          media_brief: '货架正面朝外，对齐整齐',
          expected_answer: true
        },
        {
          variant_id: 'jdg_ms02_facing_wrong_v001',
          media_asset_id: 'asset_img_jdg_ms02_facing_wrong_v001',
          media_brief: '货架歪斜，未正面朝外',
          expected_answer: false
        }
      ]
    }).ok

    expect(r).toBe(true)
  })

  it('variants 缺 media_asset_id → 失败', () => {
    const r = validateContentJson({
      ...baseFields,
      question_type: 'TRUE_FALSE',
      expected_answer: true,
      variants: [
        {
          variant_id: 'bad_variant',
          media_brief: '缺资源 ID',
          expected_answer: true
        }
      ]
    })

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/variants\[0\].*media_asset_id/i)
  })

  it('variants expected_answer 非 boolean → 失败', () => {
    const r = validateContentJson({
      ...baseFields,
      question_type: 'TRUE_FALSE',
      expected_answer: true,
      variants: [
        {
          variant_id: 'bad_variant',
          media_asset_id: 'asset_img_jdg_ms02_facing_correct_v001',
          media_brief: 'expected_answer 非布尔',
          expected_answer: 'true'
        }
      ]
    })

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/variants\[0\].*expected_answer/i)
  })
})

describe('validateContentJson — SINGLE_CHOICE', () => {
  it('options[].key 重复 → 失败', () => {
    const r = validateContentJson({
      ...baseFields,
      question_type: 'SINGLE_CHOICE',
      options: [
        { key: 'A', text: '放在正确货架' },
        { key: 'A', text: '放在通道中央' }
      ],
      expected_answer: 'A'
    })

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/options\[1\]\.key/i)
  })

  it("expected_answer='D' 但无 D 选项 → 失败", () => {
    const r = validateContentJson({
      ...baseFields,
      question_type: 'SINGLE_CHOICE',
      options: [
        { key: 'A', text: '放在正确货架' },
        { key: 'B', text: '放在通道中央' },
        { key: 'C', text: '先放到地上' }
      ],
      expected_answer: 'D'
    })

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/expected_answer/i)
  })
})

describe('validateContentJson — DRAG', () => {
  it('drag_items[].item_id 重复 → 失败', () => {
    const r = validateContentJson({
      ...baseFields,
      question_type: 'DRAG',
      drag_items: [
        { item_id: 'milk', label: '牛奶' },
        { item_id: 'milk', label: '第二瓶牛奶' }
      ],
      drop_zones: [
        { zone_id: 'cold_shelf', label: '冷藏货架', accepts: ['milk'] }
      ],
      scoring_mode: 'ALL_OR_NOTHING'
    })

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/drag_items\[1\]\.item_id/i)
  })

  it('drop_zones[].accepts 引用不存在 item → 失败', () => {
    const r = validateContentJson({
      ...baseFields,
      question_type: 'DRAG',
      drag_items: [
        { item_id: 'milk', label: '牛奶' },
        { item_id: 'bread', label: '面包' }
      ],
      drop_zones: [
        { zone_id: 'cold_shelf', label: '冷藏货架', accepts: ['milk', 'egg'] }
      ],
      scoring_mode: 'ALL_OR_NOTHING'
    })

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/accepts/i)
  })
})

describe('validateContentJson — source', () => {
  it('source 缺 imported_by → 失败', () => {
    const r = validateContentJson({
      ...baseFields,
      question_type: 'TRUE_FALSE',
      expected_answer: true,
      source: {
        import_batch_id: 'batch_001',
        source_file: 'question-bank.csv',
        source_row: 12,
        imported_at: '2026-07-04T00:00:00.000Z'
      }
    })

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/source\.imported_by/i)
  })

  it('source.source_row=0 → 失败', () => {
    const r = validateContentJson({
      ...baseFields,
      question_type: 'TRUE_FALSE',
      expected_answer: true,
      source: {
        import_batch_id: 'batch_001',
        source_file: 'question-bank.csv',
        source_row: 0,
        imported_at: '2026-07-04T00:00:00.000Z',
        imported_by: 'admin'
      }
    })

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/source_row/i)
  })
})

describe('validateContentJson — OFFLINE_OPERATION', () => {
  it('接受交付锁生成的 offline_setup 引用', () => {
    const r = validateContentJson({
      ...baseFields,
      question_type: 'OFFLINE_OPERATION',
      offline_tool_brief: '货架、商品、标签',
      rubric_criteria: [{ criterion_id: 'facing', description: '商品正面朝外' }],
      offline_setup: {
        setup_id: 'setup_m1_op_043_v2',
        item_ids: ['shelf_three_tier'],
        asset_ids: ['asset_delivery_answer_image_m1_op_043']
      }
    })

    expect(r).toEqual({ ok: true })
  })

  it('拒绝空 item_ids 或重复 asset_ids', () => {
    const r = validateContentJson({
      ...baseFields,
      question_type: 'OFFLINE_OPERATION',
      offline_tool_brief: '货架、商品、标签',
      rubric_criteria: [{ criterion_id: 'facing', description: '商品正面朝外' }],
      offline_setup: {
        setup_id: 'setup_m1_op_043_v2',
        item_ids: [],
        asset_ids: ['asset_a', 'asset_a']
      }
    })

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/offline_setup/i)
  })

  it('rubric_criteria=[] → 失败', () => {
    const r = validateContentJson({
      ...baseFields,
      question_type: 'OFFLINE_OPERATION',
      offline_tool_brief: '货架、商品、标签',
      rubric_criteria: []
    })

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/rubric_criteria/i)
  })

  it('rubric_criteria[].criterion_id 重复 → 失败', () => {
    const r = validateContentJson({
      ...baseFields,
      question_type: 'OFFLINE_OPERATION',
      offline_tool_brief: '货架、商品、标签',
      rubric_criteria: [
        { criterion_id: 'facing', description: '商品正面朝外' },
        { criterion_id: 'facing', description: '商品摆放整齐' }
      ]
    })

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/criterion_id/i)
  })
})
