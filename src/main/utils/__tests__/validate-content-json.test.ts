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
