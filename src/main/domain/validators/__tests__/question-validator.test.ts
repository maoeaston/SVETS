import { describe, it, expect } from 'vitest'
import { validateQuestionContract } from '../question-validator'
import type { ValidateQuestionContractInput, ScoringRuleOffline } from '../../../../shared/types/json-schemas'

type ContentJson = ValidateQuestionContractInput['contentJson']
type ScoringRuleJson = ValidateQuestionContractInput['scoringRuleJson']

// ──────────────────────────────────────────────────────────
// Minimal valid fixture factory
// ──────────────────────────────────────────────────────────
function makeInput(over: Partial<ValidateQuestionContractInput> = {}): ValidateQuestionContractInput {
  return {
    questionRow: {
      question_id: 'q1',
      question_type: 'TRUE_FALSE',
      bank_domain: 'BASE_ABILITY',
      module_type: 'FINE_MOTOR',
      job_module_code: null,
      item_usage: 'SCORED_ITEM',
      status: 'ACTIVE',
      safety_sensitive: false,
      job_code: 'SUPERMARKET_SHELVER',
      difficulty_level: 1,
      media_asset_id: null,
    },
    contentJson: {
      question_type: 'TRUE_FALSE',
      prompt: 'test',
      assessment_point: 'test',
      ability_tags: ['FINE_MOTOR'],
      presentation: { presentation_type: 'TEXT_ONLY', prompt: 'test', standard_instruction: 'test' },
      interaction: { interaction_type: 'BINARY_SELECT', config: {} },
      expected_evidence: { primary_evidence_type: 'DIRECT_PERFORMANCE', observable_indicators: [], validity_boundary: '' },
      support_policy: { allowed_prompt_levels: [], allowed_accommodations: [] },
      termination_policy: { allow_pause_on_distress: false, technical_failure_is_not_zero: false },
      review: { answer_key_status: 'VERIFIED', answer_key_reviewed_by: null, answer_key_reviewed_at: null, answer_key_review_note: null },
    } as unknown as ContentJson,
    scoringRuleJson: {
      schema_version: 'scoring-rule-v1.1',
      scoring_type: 'EXACT_MATCH',
      scoring_mode: 'AUTOMATIC',
      expected_answer: true,
      pass_score: 2,
      fail_score: 0,
      scoring_engine_version: '1.0',
    },
    assetRegistry: {
      exists: () => true,
      isActive: () => true,
      hashMatch: () => true,
    },
    rendererRegistry: {
      isRegistered: () => true,
      isEnabled: () => true,
    },
    ...over,
  }
}

// ──────────────────────────────────────────────────────────
// Helper: assert exactly this error code is present
// ──────────────────────────────────────────────────────────
function hasError(result: ReturnType<typeof validateQuestionContract>, code: string): boolean {
  return result.errors.some(e => e.code === code)
}
function hasWarning(result: ReturnType<typeof validateQuestionContract>, code: string): boolean {
  return result.warnings.some(w => w.code === code)
}

// ──────────────────────────────────────────────────────────
// 规则 1: bank_domain 与 module_type/job_module_code 域配对
// ──────────────────────────────────────────────────────────
describe('规则1 DOMAIN_PAIR', () => {
  it('DOMAIN_PAIR_001: BASE_ABILITY 题缺 module_type', () => {
    const r = validateQuestionContract(makeInput({
      questionRow: { ...makeInput().questionRow, bank_domain: 'BASE_ABILITY', module_type: null },
    }))
    expect(hasError(r, 'DOMAIN_PAIR_001')).toBe(true)
  })

  it('DOMAIN_PAIR_002: BASE_ABILITY 题有非 null job_module_code', () => {
    const r = validateQuestionContract(makeInput({
      questionRow: { ...makeInput().questionRow, bank_domain: 'BASE_ABILITY', job_module_code: 'M1' },
    }))
    expect(hasError(r, 'DOMAIN_PAIR_002')).toBe(true)
  })

  it('DOMAIN_PAIR_003: JOB_SPECIFIC 题有非 null module_type', () => {
    const r = validateQuestionContract(makeInput({
      questionRow: { ...makeInput().questionRow, bank_domain: 'JOB_SPECIFIC', module_type: 'FINE_MOTOR', job_module_code: 'M1' },
      contentJson: { ...makeInput().contentJson, ability_tags: [] } as unknown as ContentJson,
    }))
    expect(hasError(r, 'DOMAIN_PAIR_003')).toBe(true)
  })

  it('DOMAIN_PAIR_004: JOB_SPECIFIC 题缺 job_module_code', () => {
    const r = validateQuestionContract(makeInput({
      questionRow: { ...makeInput().questionRow, bank_domain: 'JOB_SPECIFIC', module_type: null, job_module_code: null },
      contentJson: { ...makeInput().contentJson, ability_tags: [] } as unknown as ContentJson,
    }))
    expect(hasError(r, 'DOMAIN_PAIR_004')).toBe(true)
  })
})

// ──────────────────────────────────────────────────────────
// 规则 2: strategy_type 与 bank_domain 绑定
// ──────────────────────────────────────────────────────────
describe('规则2 STRATEGY_DOMAIN', () => {
  it('STRATEGY_DOMAIN_001: BASELINE_ASSESSMENT 选了 JOB_SPECIFIC 题', () => {
    const r = validateQuestionContract(makeInput({
      questionRow: { ...makeInput().questionRow, bank_domain: 'JOB_SPECIFIC', module_type: null, job_module_code: 'M1' },
      contentJson: { ...makeInput().contentJson, ability_tags: [] } as unknown as ContentJson,
      strategyType: 'BASELINE_ASSESSMENT',
    }))
    expect(hasError(r, 'STRATEGY_DOMAIN_001')).toBe(true)
  })

  it('STRATEGY_DOMAIN_002: JOB_SKILL_ASSESSMENT 选了 BASE_ABILITY 题', () => {
    const r = validateQuestionContract(makeInput({
      strategyType: 'JOB_SKILL_ASSESSMENT',
    }))
    expect(hasError(r, 'STRATEGY_DOMAIN_002')).toBe(true)
  })
})

// ──────────────────────────────────────────────────────────
// 规则 3: item_usage 与 interaction_type
// ──────────────────────────────────────────────────────────
describe('规则3 USAGE_INTERACTION', () => {
  it('USAGE_INTERACTION_001: OBSERVATION_ONLY 但 interaction_type 不是观察类型', () => {
    const r = validateQuestionContract(makeInput({
      questionRow: { ...makeInput().questionRow, item_usage: 'OBSERVATION_ONLY' },
      scoringRuleJson: { schema_version: 'scoring-rule-v1.1', scoring_type: 'NO_SCORE', scoring_mode: 'NONE', scoring_engine_version: '1.0' },
    }))
    // interaction_type is BINARY_SELECT which is not an observation type
    expect(hasError(r, 'USAGE_INTERACTION_001')).toBe(true)
  })

  it('USAGE_INTERACTION_002: interaction_type=TEACHER_OBSERVATION 但 item_usage=SCORED_ITEM', () => {
    const r = validateQuestionContract(makeInput({
      contentJson: {
        ...makeInput().contentJson,
        interaction: { interaction_type: 'TEACHER_OBSERVATION', config: {} },
      } as unknown as ContentJson,
    }))
    expect(hasError(r, 'USAGE_INTERACTION_002')).toBe(true)
  })
})

// ──────────────────────────────────────────────────────────
// 规则 4: item_usage 与 scoring_type
// ──────────────────────────────────────────────────────────
describe('规则4 USAGE_SCORING', () => {
  it('USAGE_SCORING_001: OBSERVATION_ONLY 但 scoring_type 不是 NO_SCORE', () => {
    const r = validateQuestionContract(makeInput({
      questionRow: { ...makeInput().questionRow, item_usage: 'OBSERVATION_ONLY' },
      // scoring_type is EXACT_MATCH
    }))
    expect(hasError(r, 'USAGE_SCORING_001')).toBe(true)
  })

  it('USAGE_SCORING_002: scoring_type=NO_SCORE 但 item_usage=SCORED_ITEM', () => {
    const r = validateQuestionContract(makeInput({
      scoringRuleJson: { schema_version: 'scoring-rule-v1.1', scoring_type: 'NO_SCORE', scoring_mode: 'NONE', scoring_engine_version: '1.0' },
    }))
    expect(hasError(r, 'USAGE_SCORING_002')).toBe(true)
  })
})

// ──────────────────────────────────────────────────────────
// 规则 5: question_type 与 content_json.question_type 一致
// ──────────────────────────────────────────────────────────
describe('规则5 TYPE_MATCH', () => {
  it('TYPE_MATCH_001: content_json.question_type 与 questionRow 不一致', () => {
    const r = validateQuestionContract(makeInput({
      contentJson: {
        ...makeInput().contentJson,
        question_type: 'SINGLE_CHOICE',
      } as unknown as ContentJson,
    }))
    expect(hasError(r, 'TYPE_MATCH_001')).toBe(true)
  })
})

// ──────────────────────────────────────────────────────────
// 规则 7: presentation_type 与资产 role
// ──────────────────────────────────────────────────────────
describe('规则7 ASSET_ROLE', () => {
  it('ASSET_ROLE_001: VIDEO_SCENE 没有 required SCENE_VIDEO 资产', () => {
    const r = validateQuestionContract(makeInput({
      contentJson: {
        ...makeInput().contentJson,
        presentation: {
          presentation_type: 'VIDEO_SCENE',
          prompt: 'test',
          standard_instruction: 'test',
          assets: [], // no SCENE_VIDEO asset
        },
      } as unknown as ContentJson,
    }))
    expect(hasError(r, 'ASSET_ROLE_001')).toBe(true)
  })

  it('ASSET_ROLE_001: VIDEO_SCENE 资产 required=false 也不满足', () => {
    const r = validateQuestionContract(makeInput({
      contentJson: {
        ...makeInput().contentJson,
        presentation: {
          presentation_type: 'VIDEO_SCENE',
          prompt: 'test',
          standard_instruction: 'test',
          assets: [{ asset_key: 'v1', asset_id: 'a1', role: 'SCENE_VIDEO', required: false, alt_text: '' }],
        },
      } as unknown as ContentJson,
    }))
    expect(hasError(r, 'ASSET_ROLE_001')).toBe(true)
  })
})

// ──────────────────────────────────────────────────────────
// 规则 8: VIDEO_TO_IMAGE_CARD 降级必须有审核
// ──────────────────────────────────────────────────────────
describe('规则8 DEGRADE', () => {
  it('DEGRADE_001: VIDEO_TO_IMAGE_CARD 降级无专业审核', () => {
    const r = validateQuestionContract(makeInput({
      contentJson: {
        ...makeInput().contentJson,
        source: { import_batch_id: 'b1', source_file: 'f', source_row: 1, imported_at: '', imported_by: '', transformation: 'VIDEO_TO_IMAGE_CARD' },
        // no professional_review
      } as unknown as ContentJson,
    }))
    expect(hasError(r, 'DEGRADE_001')).toBe(true)
  })

  it('DEGRADE_001: VIDEO_TO_IMAGE_CARD 降级 professional_review.status=PENDING', () => {
    const r = validateQuestionContract(makeInput({
      contentJson: {
        ...makeInput().contentJson,
        source: { import_batch_id: 'b1', source_file: 'f', source_row: 1, imported_at: '', imported_by: '', transformation: 'VIDEO_TO_IMAGE_CARD' },
        professional_review: { required: true, review_type: null, status: 'PENDING', reviewed_by: null, reviewed_at: null },
      } as unknown as ContentJson,
    }))
    expect(hasError(r, 'DEGRADE_001')).toBe(true)
  })
})

// ──────────────────────────────────────────────────────────
// 规则 9: answer_key_status（自动评分题须 VERIFIED/CORRECTED）
// ──────────────────────────────────────────────────────────
describe('规则9 ANSWER_KEY', () => {
  it('ANSWER_KEY_001: TRUE_FALSE 题 answer_key_status=PENDING', () => {
    const r = validateQuestionContract(makeInput({
      contentJson: {
        ...makeInput().contentJson,
        review: { answer_key_status: 'PENDING', answer_key_reviewed_by: null, answer_key_reviewed_at: null, answer_key_review_note: null },
      } as unknown as ContentJson,
    }))
    expect(hasError(r, 'ANSWER_KEY_001')).toBe(true)
  })

  it('ANSWER_KEY_001: TRUE_FALSE 题 review 字段缺失', () => {
    const r = validateQuestionContract(makeInput({
      contentJson: {
        ...makeInput().contentJson,
        review: undefined,
      } as unknown as ContentJson,
    }))
    expect(hasError(r, 'ANSWER_KEY_001')).toBe(true)
  })
})

// ──────────────────────────────────────────────────────────
// 规则 10: OFFLINE_RUBRIC 三档行为锚点校验
// ──────────────────────────────────────────────────────────
describe('规则10 RUBRIC', () => {
  const offlineRow = {
    ...makeInput().questionRow,
    question_type: 'OFFLINE_OPERATION' as const,
  }
  const offlineContent = {
    ...makeInput().contentJson,
    question_type: 'OFFLINE_OPERATION',
    offline_tool_brief: 'test',
    rubric_criteria: [],
  } as unknown as ContentJson
  const offlineScoring: ScoringRuleOffline = {
    schema_version: 'scoring-rule-v1.1',
    scoring_type: 'OFFLINE_RUBRIC',
    scoring_mode: 'TEACHER',
    max_score: 2 as const,
    criteria: [{
      criterion_id: 'c1',
      description_0: '',       // empty — triggers RUBRIC_001
      description_1: '部分操作正确',
      description_2: '全部操作正确',
    }],
    score_labels: { '0': '未达标', '1': '部分达标', '2': '达标' },
    scoring_engine_version: '1.0',
  }

  it('RUBRIC_001: 三档锚点之一为空字符串', () => {
    const r = validateQuestionContract(makeInput({
      questionRow: offlineRow,
      contentJson: offlineContent,
      scoringRuleJson: offlineScoring,
    }))
    expect(hasError(r, 'RUBRIC_001')).toBe(true)
  })

  it('RUBRIC_002: 三档锚点使用通用模板"未完成"', () => {
    const r = validateQuestionContract(makeInput({
      questionRow: offlineRow,
      contentJson: offlineContent,
      scoringRuleJson: {
        ...offlineScoring,
        criteria: [{
          criterion_id: 'c1',
          description_0: '未完成',     // generic template
          description_1: '部分操作正确',
          description_2: '全部操作正确',
        }],
      },
    }))
    expect(hasError(r, 'RUBRIC_002')).toBe(true)
  })
})

// ──────────────────────────────────────────────────────────
// 规则 11: professional_review（安全/角色扮演/嵌入观察题）
// ──────────────────────────────────────────────────────────
describe('规则11 PROF_REVIEW', () => {
  it('PROF_REVIEW_001: safety_sensitive=true 但没有 professional_review', () => {
    const r = validateQuestionContract(makeInput({
      questionRow: { ...makeInput().questionRow, safety_sensitive: true },
    }))
    expect(hasWarning(r, 'PROF_REVIEW_001')).toBe(true)
  })

  it('PROF_REVIEW_002: professional_review.required=true 但 status 非 APPROVED', () => {
    const r = validateQuestionContract(makeInput({
      questionRow: { ...makeInput().questionRow, safety_sensitive: true },
      contentJson: {
        ...makeInput().contentJson,
        professional_review: { required: true, review_type: null, status: 'PENDING', reviewed_by: null, reviewed_at: null },
      } as unknown as ContentJson,
    }))
    expect(hasError(r, 'PROF_REVIEW_002')).toBe(true)
  })
})

// ──────────────────────────────────────────────────────────
// 规则 12: renderer registry 已注册且启用
// ──────────────────────────────────────────────────────────
describe('规则12 RENDERER', () => {
  it('RENDERER_001: interaction_type 未在 registry 注册', () => {
    const r = validateQuestionContract(makeInput({
      rendererRegistry: { isRegistered: () => false, isEnabled: () => false },
    }))
    expect(hasError(r, 'RENDERER_001')).toBe(true)
  })

  it('RENDERER_002: interaction_type 已注册但未启用', () => {
    const r = validateQuestionContract(makeInput({
      rendererRegistry: { isRegistered: () => true, isEnabled: () => false },
    }))
    expect(hasError(r, 'RENDERER_002')).toBe(true)
  })
})

// ──────────────────────────────────────────────────────────
// 规则 13: required assets 存在、ACTIVE、hash 一致
// ──────────────────────────────────────────────────────────
describe('规则13 ASSET', () => {
  const contentWithAsset = {
    ...makeInput().contentJson,
    presentation: {
      presentation_type: 'IMAGE_CARD',
      prompt: 'test',
      standard_instruction: 'test',
      assets: [{ asset_key: 'img1', asset_id: 'asset-001', role: 'PRIMARY_STIMULUS', required: true, alt_text: 'img' }],
    },
  } as unknown as ContentJson

  it('ASSET_001: required asset 不存在', () => {
    const r = validateQuestionContract(makeInput({
      contentJson: contentWithAsset,
      assetRegistry: { exists: () => false, isActive: () => false, hashMatch: () => false },
    }))
    expect(hasError(r, 'ASSET_001')).toBe(true)
  })

  it('ASSET_002: required asset 存在但非 ACTIVE', () => {
    const r = validateQuestionContract(makeInput({
      contentJson: contentWithAsset,
      assetRegistry: { exists: () => true, isActive: () => false, hashMatch: () => true },
    }))
    expect(hasError(r, 'ASSET_002')).toBe(true)
  })

  it('ASSET_003: required asset 存在且 ACTIVE 但 hash 不一致', () => {
    const r = validateQuestionContract(makeInput({
      contentJson: contentWithAsset,
      assetRegistry: { exists: () => true, isActive: () => true, hashMatch: () => false },
    }))
    expect(hasError(r, 'ASSET_003')).toBe(true)
  })

  it('ASSET_004: media_asset_id 不存在', () => {
    const r = validateQuestionContract(makeInput({
      questionRow: { ...makeInput().questionRow, media_asset_id: 'missing-asset' },
      assetRegistry: { exists: () => false, isActive: () => false, hashMatch: () => false },
    }))
    expect(hasError(r, 'ASSET_004')).toBe(true)
  })

  it('ASSET_005: media_asset_id 存在但非 ACTIVE', () => {
    const r = validateQuestionContract(makeInput({
      questionRow: { ...makeInput().questionRow, media_asset_id: 'inactive-asset' },
      assetRegistry: { exists: () => true, isActive: () => false, hashMatch: () => true },
    }))
    expect(hasError(r, 'ASSET_005')).toBe(true)
  })

  it('ASSET_006: script/sealed/offline setup/tool 引用任一缺失即失败', () => {
    const r = validateQuestionContract(makeInput({
      questionRow: { ...makeInput().questionRow, tool_asset_ids_json: ['asset-tool'] },
      contentJson: {
        ...makeInput().contentJson,
        administration: {
          script_asset_id: 'asset-script',
          sealed_config_asset_id: 'asset-sealed'
        },
        offline_setup: { setup_id: 'setup-1', item_ids: [], asset_ids: ['asset-setup'] }
      } as unknown as ContentJson,
      assetRegistry: {
        exists: (id) => id !== 'asset-sealed',
        isActive: () => true,
        hashMatch: () => true
      }
    }))
    expect(hasError(r, 'ASSET_006')).toBe(true)
    expect(r.errors.find((error) => error.code === 'ASSET_006')?.message).toContain('asset-sealed')
  })
})

// ──────────────────────────────────────────────────────────
// 规则 14: ability_tags 合法性
// ──────────────────────────────────────────────────────────
describe('规则14 TAGS', () => {
  it('TAGS_001: 非法 ability_tag 值', () => {
    const r = validateQuestionContract(makeInput({
      contentJson: {
        ...makeInput().contentJson,
        ability_tags: ['INVALID_TAG'],
      } as unknown as ContentJson,
    }))
    expect(hasError(r, 'TAGS_001')).toBe(true)
  })

  it('TAGS_002: BASE_ABILITY 题 ability_tags 为空数组', () => {
    const r = validateQuestionContract(makeInput({
      contentJson: {
        ...makeInput().contentJson,
        ability_tags: [],
      } as unknown as ContentJson,
    }))
    expect(hasError(r, 'TAGS_002')).toBe(true)
  })
})

// ──────────────────────────────────────────────────────────
// 规则 15: 题目状态必须为 ACTIVE
// ──────────────────────────────────────────────────────────
describe('规则15 STATUS', () => {
  it('STATUS_001: 题目状态为 DRAFT', () => {
    const r = validateQuestionContract(makeInput({
      questionRow: { ...makeInput().questionRow, status: 'DRAFT' },
    }))
    expect(hasError(r, 'STATUS_001')).toBe(true)
  })

  it('STATUS_001: 题目状态为 ARCHIVED', () => {
    const r = validateQuestionContract(makeInput({
      questionRow: { ...makeInput().questionRow, status: 'ARCHIVED' },
    }))
    expect(hasError(r, 'STATUS_001')).toBe(true)
  })
})

// ──────────────────────────────────────────────────────────
// 补充规则: scoring_type 与 question_type 对应
// ──────────────────────────────────────────────────────────
describe('补充规则 SCORING_TYPE', () => {
  it('SCORING_TYPE_001: TRUE_FALSE 使用 SET_MATCH', () => {
    const r = validateQuestionContract(makeInput({
      scoringRuleJson: {
        schema_version: 'scoring-rule-v1.1',
        scoring_type: 'SET_MATCH',
        scoring_mode: 'AUTOMATIC',
        criteria_logic: 'ALL',
        expected_set: ['A'],
        pass_score: 2,
        fail_score: 0,
        scoring_engine_version: '1.0',
      },
    }))
    expect(hasError(r, 'SCORING_TYPE_001')).toBe(true)
  })
})

// ──────────────────────────────────────────────────────────
// 补充规则: 废止类型 RUBRIC_BASED / DRAG_PARTIAL
// ──────────────────────────────────────────────────────────
describe('补充规则 LEGACY', () => {
  it('LEGACY_001: scoring_type=RUBRIC_BASED', () => {
    const r = validateQuestionContract(makeInput({
      scoringRuleJson: { scoring_type: 'RUBRIC_BASED' } as unknown as ScoringRuleJson,
    }))
    expect(hasError(r, 'LEGACY_001')).toBe(true)
  })

  it('LEGACY_002: scoring_type=DRAG_PARTIAL', () => {
    const r = validateQuestionContract(makeInput({
      scoringRuleJson: { scoring_type: 'DRAG_PARTIAL' } as unknown as ScoringRuleJson,
    }))
    expect(hasError(r, 'LEGACY_002')).toBe(true)
  })
})

// ──────────────────────────────────────────────────────────
// 补充规则: pass_score/fail_score 固定值
// ──────────────────────────────────────────────────────────
describe('补充规则 SCORE_VALUE', () => {
  it('SCORE_VALUE_001: pass_score 不为 2', () => {
    const r = validateQuestionContract(makeInput({
      scoringRuleJson: {
        schema_version: 'scoring-rule-v1.1',
        scoring_type: 'EXACT_MATCH',
        scoring_mode: 'AUTOMATIC',
        expected_answer: true,
        pass_score: 1 as unknown as 2,
        fail_score: 0,
        scoring_engine_version: '1.0',
      },
    }))
    expect(hasError(r, 'SCORE_VALUE_001')).toBe(true)
  })

  it('SCORE_VALUE_002: fail_score 不为 0', () => {
    const r = validateQuestionContract(makeInput({
      scoringRuleJson: {
        schema_version: 'scoring-rule-v1.1',
        scoring_type: 'EXACT_MATCH',
        scoring_mode: 'AUTOMATIC',
        expected_answer: true,
        pass_score: 2,
        fail_score: 1 as unknown as 0,
        scoring_engine_version: '1.0',
      },
    }))
    expect(hasError(r, 'SCORE_VALUE_002')).toBe(true)
  })
})

// ──────────────────────────────────────────────────────────
// 补充规则: note 字段
// ──────────────────────────────────────────────────────────
describe('补充规则 NOTE', () => {
  it('NOTE_001: note 疑似存储状态值', () => {
    const r = validateQuestionContract(makeInput({
      contentJson: { ...makeInput().contentJson, note: 'ACTIVE' } as unknown as ContentJson,
    }))
    expect(hasWarning(r, 'NOTE_001')).toBe(true)
  })
})

// ──────────────────────────────────────────────────────────
// Happy path: 完整合法输入应通过校验
// ──────────────────────────────────────────────────────────
describe('happy path', () => {
  it('完整合法的 TRUE_FALSE 题通过校验', () => {
    const r = validateQuestionContract(makeInput())
    expect(r.valid).toBe(true)
    expect(r.errors).toHaveLength(0)
  })
})
