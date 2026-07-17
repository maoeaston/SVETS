import { describe, expect, it } from 'vitest'
import {
  mapImportRow,
  cleanAbilityTags,
  cleanNote,
  isOrderingDrag,
  migrateDragScoringRule,
  migrateRubricScoringRule,
  isObservationItem,
  buildDryRunReport
} from '../lib/question-bank-import.mjs'

function makeRawRow(over = {}) {
  return {
    question_id: 'M1_SC_001',
    job_code: 'supermarket_stocking',
    module_type: 'RULE_EXECUTION',
    question_type: 'SINGLE_CHOICE',
    difficulty_level: 2,
    content_json: JSON.stringify({
      question_type: 'SINGLE_CHOICE',
      prompt: '题干',
      assessment_point: 'RULE_EXECUTION',
      ability_tags: ['0'],
      note: 'ACTIVE',
      options: [
        { key: 'A', text: '选项A' },
        { key: 'B', text: '选项B' }
      ],
      expected_answer: 'A'
    }),
    scoring_rule_json: { scoring_type: 'EXACT_MATCH', max_score: 2, correct_score: 2, incorrect_score: 0 },
    media_asset_id: null,
    tool_asset_ids_json: null,
    safety_sensitive: 0,
    sensory_tags_json: null,
    status: 'ACTIVE',
    version: 1,
    ...over
  }
}

describe('question-bank-import job_code 映射', () => {
  it('supermarket_stocking → SUPERMARKET_SHELVER', () => {
    const mapped = mapImportRow(makeRawRow())
    expect(mapped.job_code).toBe('SUPERMARKET_SHELVER')
  })

  it('未知 job_code 报错 IMP_E003', () => {
    expect(() => mapImportRow(makeRawRow({ job_code: 'unknown_job' }))).toThrow(/IMP_E003/)
  })
})

describe('question-bank-import module_type → job_module_code 映射', () => {
  it.each([
    ['RULE_EXECUTION', 'M1'],
    ['FINE_MOTOR', 'M2'],
    ['COGNITION', 'M3'],
    ['EMOTION_REGULATION', 'M4'],
    ['SAFETY_OPERATION', 'M5'],
    ['BASIC_SOCIAL', 'M6']
  ])('%s → %s，module_type 置 NULL', (oldModule, expectedJobModule) => {
    const mapped = mapImportRow(makeRawRow({ module_type: oldModule }))
    expect(mapped.job_module_code).toBe(expectedJobModule)
    expect(mapped.module_type).toBeNull()
    expect(mapped.bank_domain).toBe('JOB_SPECIFIC')
  })

  it('未知旧 module_type 报错 IMP_E003', () => {
    expect(() => mapImportRow(makeRawRow({ module_type: 'UNKNOWN_MODULE' }))).toThrow(/IMP_E003/)
  })
})

describe('ability_tags 清洗', () => {
  it('["0"] → []，标记 cleaned', () => {
    expect(cleanAbilityTags(['0'])).toEqual({ tags: [], cleaned: true })
  })

  it('["1"] → []，标记 cleaned', () => {
    expect(cleanAbilityTags(['1'])).toEqual({ tags: [], cleaned: true })
  })

  it('合法值原样保留，不标记 cleaned', () => {
    expect(cleanAbilityTags(['RULE_EXECUTION', 'FINE_MOTOR'])).toEqual({
      tags: ['RULE_EXECUTION', 'FINE_MOTOR'],
      cleaned: false
    })
  })

  it('端到端：mapImportRow 输出的 content_json.ability_tags 已清洗并按 module_type 回填', () => {
    // 源 ability_tags=["0"] 先清洗为 []，再按行 module_type（RULE_EXECUTION）回填，
    // 保证上线门禁要求的“非空且含本题基础能力构念”。
    const mapped = mapImportRow(makeRawRow())
    expect(mapped.content_json.ability_tags).toEqual(['RULE_EXECUTION'])
    expect(mapped.cleaning_log).toContain('ability_tags_cleaned')
  })
})

describe('note 状态值清洗', () => {
  it('note 精确等于 ACTIVE → 丢弃', () => {
    expect(cleanNote('ACTIVE')).toEqual({ note: null, cleaned: true })
  })

  it('note 含有效信息 → 保留', () => {
    expect(cleanNote('记录完成时长')).toEqual({ note: '记录完成时长', cleaned: false })
  })

  it('note 为空 → 不清洗', () => {
    expect(cleanNote(null)).toEqual({ note: null, cleaned: false })
  })
})

describe('DRAG_PARTIAL → ORDER_MATCH / MAPPING_MATCH 判定', () => {
  it('zones 标签含"第N步" → ORDER_MATCH，correct_order 按步骤号排序', () => {
    const dropZones = [
      { zone_id: 'z2', label: '第2步', accepts: ['i2'] },
      { zone_id: 'z1', label: '第1步', accepts: ['i1'] },
      { zone_id: 'z3', label: '第3步', accepts: ['i3'] }
    ]
    expect(isOrderingDrag(dropZones)).toBe(true)
    const rule = migrateDragScoringRule([], dropZones)
    expect(rule.scoring_type).toBe('ORDER_MATCH')
    expect(rule.correct_order).toEqual(['i1', 'i2', 'i3'])
    expect(rule.partial_credit).toBe(false)
  })

  it('zones 标签为品类名 → MAPPING_MATCH，correct_mapping 从 accepts 推导', () => {
    const dropZones = [
      { zone_id: 'z1', label: '零食区', accepts: ['i1', 'i4'] },
      { zone_id: 'z2', label: '饮品区', accepts: ['i2'] }
    ]
    expect(isOrderingDrag(dropZones)).toBe(false)
    const rule = migrateDragScoringRule([], dropZones)
    expect(rule.scoring_type).toBe('MAPPING_MATCH')
    expect(rule.correct_mapping).toEqual({ i1: 'z1', i4: 'z1', i2: 'z2' })
    expect(rule.partial_credit).toBe(false)
  })

  it('端到端：DRAG 题通过 mapImportRow 正确迁移', () => {
    const mapped = mapImportRow(
      makeRawRow({
        question_id: 'M1_DG_001',
        question_type: 'DRAG',
        content_json: JSON.stringify({
          question_type: 'DRAG',
          prompt: '排序题',
          assessment_point: 'RULE_EXECUTION',
          ability_tags: ['0'],
          drag_items: [{ item_id: 'i1', label: 'a' }, { item_id: 'i2', label: 'b' }],
          drop_zones: [
            { zone_id: 'z1', label: '第1步', accepts: ['i1'] },
            { zone_id: 'z2', label: '第2步', accepts: ['i2'] }
          ]
        }),
        scoring_rule_json: {
          scoring_type: 'DRAG_PARTIAL',
          max_score: 2,
          all_correct_score: 2,
          partial_correct_score: 0,
          incorrect_score: 0
        }
      })
    )
    expect(mapped.scoring_rule_json.scoring_type).toBe('ORDER_MATCH')
    expect(mapped.cleaning_log).toContain('drag_partial_to_order_match')
  })
})

describe('RUBRIC_BASED → OFFLINE_RUBRIC / NO_SCORE 判定', () => {
  it('非观察项 → OFFLINE_RUBRIC，保留三档描述', () => {
    const rule = migrateRubricScoringRule(
      { scoring_type: 'RUBRIC_BASED', max_score: 2, score_0_description: 'a', score_1_description: 'b', score_2_description: 'c' },
      false
    )
    expect(rule.scoring_type).toBe('OFFLINE_RUBRIC')
    expect(rule.criteria[0]).toMatchObject({ score_0: 'a', score_1: 'b', score_2: 'c' })
    expect(rule.rubric_anchor_status).toBe('PENDING')
  })

  it('观察项 → NO_SCORE', () => {
    const rule = migrateRubricScoringRule({ scoring_type: 'RUBRIC_BASED', max_score: 2 }, true)
    expect(rule).toEqual({ scoring_type: 'NO_SCORE' })
  })

  it('观察项识别：question_id 含 _OB_', () => {
    expect(isObservationItem('M1_OB_048', '任意题干')).toBe(true)
  })

  it('观察项识别：question_id 不含 _OB_ 但 prompt 含"嵌入式观察"（M5_OP_048/M5_OP_055 模式）', () => {
    expect(isObservationItem('M5_OP_048', '（嵌入式观察）评估员碰倒水瓶')).toBe(true)
  })

  it('非观察项：普通 OFFLINE_OPERATION 不误判', () => {
    expect(isObservationItem('M1_OP_033', '把5件商品摆到货架中层')).toBe(false)
  })

  it('端到端：观察项 item_usage=OBSERVATION_ONLY + scoring_type=NO_SCORE', () => {
    const mapped = mapImportRow(
      makeRawRow({
        question_id: 'M1_OB_048',
        question_type: 'OFFLINE_OPERATION',
        content_json: JSON.stringify({
          question_type: 'OFFLINE_OPERATION',
          prompt: '（嵌入式观察）评估员整理材料时碰倒水瓶',
          assessment_point: '嵌入式观察-自发应对',
          ability_tags: ['BASIC_SOCIAL'],
          offline_tool_brief: '水瓶',
          rubric_criteria: [{ criterion_id: 'obs', description: '不计分' }]
        }),
        scoring_rule_json: { scoring_type: 'RUBRIC_BASED', max_score: 2 }
      })
    )
    expect(mapped.item_usage).toBe('OBSERVATION_ONLY')
    expect(mapped.scoring_rule_json).toEqual({ scoring_type: 'NO_SCORE' })
    expect(mapped.content_json.review.answer_key_status).toBe('NOT_REQUIRED')
  })
})

describe('M1_TF_015 答案键已修正（H1，2026-07-09 人工确认）', () => {
  it('answer_key_status=CORRECTED + cleaning_log 含 answer_key_corrected + correct_answer=true', () => {
    const mapped = mapImportRow(
      makeRawRow({
        question_id: 'M1_TF_015',
        question_type: 'TRUE_FALSE',
        content_json: JSON.stringify({
          question_type: 'TRUE_FALSE',
          prompt: '图中理货员的做法对吗？',
          assessment_point: '摆放规范R1正向',
          ability_tags: ['RULE_EXECUTION'],
          media_brief: '视频：理货员将商品正面朝外逐一摆正对齐',
          expected_answer: false
        }),
        scoring_rule_json: { scoring_type: 'EXACT_MATCH', max_score: 2, correct_score: 2, incorrect_score: 0 }
      })
    )
    expect(mapped.content_json.review.answer_key_status).toBe('CORRECTED')
    expect(mapped.content_json.review.answer_key_review_note).toMatch(/已人工确认/)
    expect(mapped.cleaning_log).toContain('answer_key_corrected')
    expect(mapped.cleaning_log).not.toContain('answer_key_suspicious')
    // 答案已修正为 true
    expect(mapped.scoring_rule_json.correct_answer).toBe(true)
    // 同时验证 C10：TF + 视频 media_brief → IMAGE_CARD + VIDEO_TO_IMAGE_CARD 降级标记
    expect(mapped.content_json.presentation.type).toBe('IMAGE_CARD')
    expect(mapped.content_json.presentation.transformation).toBe('VIDEO_TO_IMAGE_CARD')
  })

  it('其他 TF 题不受影响，无 answer_key_corrected 标记', () => {
    const mapped = mapImportRow(
      makeRawRow({
        question_id: 'M1_TF_099',
        question_type: 'TRUE_FALSE',
        content_json: JSON.stringify({
          question_type: 'TRUE_FALSE',
          prompt: '题干',
          assessment_point: 'x',
          ability_tags: ['0'],
          expected_answer: true
        }),
        scoring_rule_json: { scoring_type: 'EXACT_MATCH', max_score: 2, correct_score: 2, incorrect_score: 0 }
      })
    )
    expect(mapped.cleaning_log).not.toContain('answer_key_corrected')
    expect(mapped.cleaning_log).not.toContain('answer_key_suspicious')
  })
})

describe('H6 ID 重命名（M5_OP_048→M5_OB_048，M5_OP_055→M5_OB_055）', () => {
  const makeObsRow = (questionId) =>
    makeRawRow({
      question_id: questionId,
      question_type: 'OFFLINE_OPERATION',
      content_json: JSON.stringify({
        question_type: 'OFFLINE_OPERATION',
        prompt: '（嵌入式观察）测试场景',
        assessment_point: 'x',
        ability_tags: ['BASIC_SOCIAL']
      }),
      scoring_rule_json: { scoring_type: 'RUBRIC_BASED', max_score: 2 }
    })

  it('M5_OP_048 重导后 question_id=M5_OB_048', () => {
    const mapped = mapImportRow(makeObsRow('M5_OP_048'))
    expect(mapped.question_id).toBe('M5_OB_048')
    expect(mapped.item_usage).toBe('OBSERVATION_ONLY')
  })

  it('M5_OP_055 重导后 question_id=M5_OB_055', () => {
    const mapped = mapImportRow(makeObsRow('M5_OP_055'))
    expect(mapped.question_id).toBe('M5_OB_055')
    expect(mapped.item_usage).toBe('OBSERVATION_ONLY')
  })

  it('其他 _OP_ 题不受影响', () => {
    const mapped = mapImportRow(makeRawRow({ question_id: 'M5_OP_040' }))
    expect(mapped.question_id).toBe('M5_OP_040')
  })
})

describe('域隔离与 status 强制规则', () => {
  it('全部导入行 status=DRAFT，与源 status 无关', () => {
    const activeSource = mapImportRow(makeRawRow({ status: 'ACTIVE' }))
    const draftSource = mapImportRow(makeRawRow({ status: 'DRAFT' }))
    expect(activeSource.status).toBe('DRAFT')
    expect(draftSource.status).toBe('DRAFT')
  })

  it('bank_domain=JOB_SPECIFIC 且 module_type=NULL 且 job_module_code 非空', () => {
    const mapped = mapImportRow(makeRawRow())
    expect(mapped.bank_domain).toBe('JOB_SPECIFIC')
    expect(mapped.module_type).toBeNull()
    expect(mapped.job_module_code).not.toBeNull()
  })

  it('未知 question_type 报错 IMP_E002', () => {
    expect(() => mapImportRow(makeRawRow({ question_type: 'UNKNOWN_TYPE' }))).toThrow(/IMP_E002/)
  })
})

describe('buildDryRunReport 域隔离验证', () => {
  it('全部行合规时 domain_isolation.pass = true', () => {
    const rows = [mapImportRow(makeRawRow())]
    const report = buildDryRunReport(rows)
    expect(report.domain_isolation.pass).toBe(true)
    expect(report.domain_isolation.module_type_should_be_null_violations).toBe(0)
  })
})
