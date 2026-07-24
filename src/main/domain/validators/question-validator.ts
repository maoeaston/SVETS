import type {
  ValidateQuestionContractInput,
  ValidationResult,
  ValidationError,
  ValidationWarning,
  QuestionType,
  AbilityTag,
  ScoringRuleOffline
} from '../../../shared/types/json-schemas'

/**
 * 统一跨层 validator — 导入、审核门禁、session 创建三处复用
 * 实现 doc/specs/impl/02-json-contracts-and-types.md §10 的完整规则清单
 */
export function validateQuestionContract(input: ValidateQuestionContractInput): ValidationResult {
  const errors: ValidationError[] = []
  const warnings: ValidationWarning[] = []
  const { questionRow: q, contentJson: c, scoringRuleJson: s, assetRegistry, rendererRegistry, strategyType } = input

  const collectNestedAssetIds = (value: unknown, key = ''): string[] => {
    if (typeof value === 'string' && (key === 'asset_id' || key.endsWith('_asset_id'))) return [value]
    if (Array.isArray(value)) {
      if (key === 'asset_ids' || key.endsWith('_asset_ids')) {
        return value.filter((item): item is string => typeof item === 'string')
      }
      return value.flatMap((item) => collectNestedAssetIds(item))
    }
    if (value && typeof value === 'object') {
      return Object.entries(value as Record<string, unknown>)
        .flatMap(([childKey, child]) => collectNestedAssetIds(child, childKey))
    }
    return []
  }

  // ══════════════════════════════════════════════
  // 规则 1: bank_domain 与 module_type/job_module_code 域配对
  // ══════════════════════════════════════════════
  if (q.bank_domain === 'BASE_ABILITY') {
    if (q.module_type === null)
      errors.push({ code: 'DOMAIN_PAIR_001', field: 'module_type', message: 'BASE_ABILITY 题必须有 module_type' })
    if (q.job_module_code !== null)
      errors.push({ code: 'DOMAIN_PAIR_002', field: 'job_module_code', message: 'BASE_ABILITY 题的 job_module_code 必须为 NULL' })
  }
  if (q.bank_domain === 'JOB_SPECIFIC') {
    if (q.module_type !== null)
      errors.push({ code: 'DOMAIN_PAIR_003', field: 'module_type', message: 'JOB_SPECIFIC 题的 module_type 必须为 NULL' })
    if (q.job_module_code === null)
      errors.push({ code: 'DOMAIN_PAIR_004', field: 'job_module_code', message: 'JOB_SPECIFIC 题必须有 job_module_code' })
  }

  // ══════════════════════════════════════════════
  // 规则 2: strategy_type 与 bank_domain 绑定
  // ══════════════════════════════════════════════
  if (strategyType) {
    if (strategyType === 'BASELINE_ASSESSMENT' || strategyType === 'MOCK_EXAM') {
      if (q.bank_domain !== 'BASE_ABILITY')
        errors.push({ code: 'STRATEGY_DOMAIN_001', field: 'bank_domain',
          message: `${strategyType} 只能选择 BASE_ABILITY 题` })
    }
    if (strategyType === 'JOB_SKILL_ASSESSMENT') {
      if (q.bank_domain !== 'JOB_SPECIFIC')
        errors.push({ code: 'STRATEGY_DOMAIN_002', field: 'bank_domain',
          message: 'JOB_SKILL_ASSESSMENT 只能选择 JOB_SPECIFIC 题' })
    }
  }

  // ══════════════════════════════════════════════
  // 规则 3: item_usage 与 interaction_type
  // ══════════════════════════════════════════════
  const interactionType = c.interaction?.interaction_type
  if (q.item_usage === 'OBSERVATION_ONLY') {
    if (interactionType !== 'TEACHER_OBSERVATION' && interactionType !== 'SYSTEM_DERIVED_OBSERVATION')
      errors.push({ code: 'USAGE_INTERACTION_001', field: 'interaction_type',
        message: 'OBSERVATION_ONLY 的 interaction_type 必须为 TEACHER_OBSERVATION 或 SYSTEM_DERIVED_OBSERVATION' })
  }
  if (interactionType === 'TEACHER_OBSERVATION' || interactionType === 'SYSTEM_DERIVED_OBSERVATION') {
    if (q.item_usage !== 'OBSERVATION_ONLY')
      errors.push({ code: 'USAGE_INTERACTION_002', field: 'item_usage',
        message: 'TEACHER_OBSERVATION/SYSTEM_DERIVED_OBSERVATION 的 item_usage 必须为 OBSERVATION_ONLY' })
  }

  // ══════════════════════════════════════════════
  // 规则 4: item_usage 与 scoring_type
  // ══════════════════════════════════════════════
  if (q.item_usage === 'OBSERVATION_ONLY' && s.scoring_type !== 'NO_SCORE')
    errors.push({ code: 'USAGE_SCORING_001', field: 'scoring_type',
      message: 'OBSERVATION_ONLY 的 scoring_type 必须为 NO_SCORE' })
  if (s.scoring_type === 'NO_SCORE' && q.item_usage !== 'OBSERVATION_ONLY')
    errors.push({ code: 'USAGE_SCORING_002', field: 'item_usage',
      message: 'NO_SCORE 的 item_usage 必须为 OBSERVATION_ONLY' })

  // ══════════════════════════════════════════════
  // 规则 5: question_type 与 content_json.question_type 一致
  // ══════════════════════════════════════════════
  if (c.question_type !== q.question_type)
    errors.push({ code: 'TYPE_MATCH_001', field: 'content_json.question_type',
      message: `content_json.question_type(${c.question_type}) 与 question_bank.question_type(${q.question_type}) 不一致` })

  // ══════════════════════════════════════════════
  // 规则 6: question_phase 与题型关系（组卷/session 入口调用）
  // ══════════════════════════════════════════════
  // 此规则由 session question 创建时校验，见 assessment_session_question 触发器
  // OFFLINE_OPERATION → phase=OFFLINE; OBSERVATION_ONLY → phase=OBSERVATION; 其余 → phase=ONLINE

  // ══════════════════════════════════════════════
  // 规则 7: presentation_type 与资产 role
  // ══════════════════════════════════════════════
  const presType = c.presentation?.presentation_type
  if (presType === 'VIDEO_SCENE') {
    const hasSceneVideo = c.presentation?.assets?.some(
      a => a.role === 'SCENE_VIDEO' && a.required === true
    )
    if (!hasSceneVideo)
      errors.push({ code: 'ASSET_ROLE_001', field: 'presentation.assets',
        message: 'VIDEO_SCENE 必须绑定至少一个 required=true 的 SCENE_VIDEO 资产' })
  }

  // ══════════════════════════════════════════════
  // 规则 8: VIDEO_TO_IMAGE_CARD 降级必须有审核
  // ══════════════════════════════════════════════
  if (c.source?.transformation === 'VIDEO_TO_IMAGE_CARD') {
    if (!c.professional_review || c.professional_review.status !== 'APPROVED')
      errors.push({ code: 'DEGRADE_001', field: 'professional_review',
        message: 'VIDEO_TO_IMAGE_CARD 降级必须经专业审核 APPROVED' })
  }

  // ══════════════════════════════════════════════
  // 规则 9: answer_key_status（自动评分题须 VERIFIED/CORRECTED）
  // ══════════════════════════════════════════════
  const autoScoredTypes: QuestionType[] = ['TRUE_FALSE', 'SINGLE_CHOICE', 'DRAG', 'SOFTWARE_TASK']
  if (autoScoredTypes.includes(q.question_type)) {
    const keyStatus = c.review?.answer_key_status
    if (keyStatus !== 'VERIFIED' && keyStatus !== 'CORRECTED')
      errors.push({ code: 'ANSWER_KEY_001', field: 'review.answer_key_status',
        message: `自动评分题(${q.question_type})答案键状态必须为 VERIFIED 或 CORRECTED，当前: ${keyStatus}` })
  }

  // ══════════════════════════════════════════════
  // 规则 10: OFFLINE_RUBRIC 三档行为锚点校验
  // ══════════════════════════════════════════════
  if (s.scoring_type === 'OFFLINE_RUBRIC') {
    const GENERIC_TEMPLATES = [
      '未完成', '未能完成', '部分完成', '完全达标', '达标', '完成'
    ]
    for (const criterion of (s as ScoringRuleOffline).criteria) {
      for (const field of ['description_0', 'description_1', 'description_2'] as const) {
        const text = criterion[field]?.trim()
        if (!text)
          errors.push({ code: 'RUBRIC_001', field: `scoring_rule_json.criteria.${criterion.criterion_id}.${field}`,
            message: '三档行为锚点不得为空' })
        else if (GENERIC_TEMPLATES.some(t => text === t))
          errors.push({ code: 'RUBRIC_002', field: `scoring_rule_json.criteria.${criterion.criterion_id}.${field}`,
            message: `禁止使用通用模板锚点: "${text}"` })
      }
    }
  }

  // ══════════════════════════════════════════════
  // 规则 11: professional_review（安全/角色扮演/嵌入观察题）
  // ══════════════════════════════════════════════
  const needsProfReview = q.safety_sensitive
    || interactionType === 'TEACHER_OBSERVATION'
    || c.administration?.variant_type === 'ROLE_PLAY'
  if (needsProfReview) {
    if (!c.professional_review || !c.professional_review.required)
      warnings.push({ code: 'PROF_REVIEW_001', field: 'professional_review',
        message: '安全/角色扮演/嵌入观察题建议标记 professional_review.required=true' })
    if (c.professional_review?.required && c.professional_review.status !== 'APPROVED')
      errors.push({ code: 'PROF_REVIEW_002', field: 'professional_review.status',
        message: '需专业审核的题目必须为 APPROVED 才可 ACTIVE' })
  }

  // ══════════════════════════════════════════════
  // 规则 12: renderer registry 已注册且启用
  // ══════════════════════════════════════════════
  if (interactionType && interactionType !== 'OFFLINE_RUBRIC'
      && interactionType !== 'TEACHER_OBSERVATION'
      && interactionType !== 'SYSTEM_DERIVED_OBSERVATION') {
    if (!rendererRegistry.isRegistered(interactionType))
      errors.push({ code: 'RENDERER_001', field: 'interaction_type',
        message: `interaction_type "${interactionType}" 未在 renderer registry 注册` })
    else if (!rendererRegistry.isEnabled(interactionType))
      errors.push({ code: 'RENDERER_002', field: 'interaction_type',
        message: `interaction_type "${interactionType}" 在 renderer registry 中未启用` })
  }

  // ══════════════════════════════════════════════
  // 规则 13: required assets 存在、ACTIVE、hash 一致
  // ══════════════════════════════════════════════
  const requiredAssets = (c.presentation?.assets ?? []).filter(a => a.required)
  for (const asset of requiredAssets) {
    if (!assetRegistry.exists(asset.asset_id))
      errors.push({ code: 'ASSET_001', field: `presentation.assets[${asset.asset_key}]`,
        message: `asset_id "${asset.asset_id}" 不存在` })
    else if (!assetRegistry.isActive(asset.asset_id))
      errors.push({ code: 'ASSET_002', field: `presentation.assets[${asset.asset_key}]`,
        message: `asset_id "${asset.asset_id}" 状态非 ACTIVE` })
    else if (!assetRegistry.hashMatch(asset.asset_id))
      errors.push({ code: 'ASSET_003', field: `presentation.assets[${asset.asset_key}]`,
        message: `asset_id "${asset.asset_id}" hash 不一致` })
  }
  // media_asset_id（主素材）
  if (q.media_asset_id) {
    if (!assetRegistry.exists(q.media_asset_id))
      errors.push({ code: 'ASSET_004', field: 'media_asset_id',
        message: `media_asset_id "${q.media_asset_id}" 不存在` })
    else if (!assetRegistry.isActive(q.media_asset_id))
      errors.push({ code: 'ASSET_005', field: 'media_asset_id',
        message: `media_asset_id "${q.media_asset_id}" 状态非 ACTIVE` })
  }
  const allReferencedAssets = new Set([
    ...(q.tool_asset_ids_json ?? []),
    ...collectNestedAssetIds(c)
  ])
  if (q.media_asset_id) allReferencedAssets.add(q.media_asset_id)
  for (const assetId of allReferencedAssets) {
    if (!assetRegistry.exists(assetId))
      errors.push({ code: 'ASSET_006', field: 'asset_references',
        message: `引用资产 "${assetId}" 不存在` })
    else if (!assetRegistry.isActive(assetId))
      errors.push({ code: 'ASSET_007', field: 'asset_references',
        message: `引用资产 "${assetId}" 状态非 ACTIVE` })
    else if (!assetRegistry.hashMatch(assetId))
      errors.push({ code: 'ASSET_008', field: 'asset_references',
        message: `引用资产 "${assetId}" hash 不一致` })
  }

  // ══════════════════════════════════════════════
  // 规则 14: ability_tags 合法性
  // ══════════════════════════════════════════════
  const VALID_TAGS: AbilityTag[] = ['FINE_MOTOR','COGNITION','RULE_EXECUTION','EMOTION_REGULATION','BASIC_SOCIAL','SAFETY_OPERATION']
  const tags = c.ability_tags ?? []
  for (const tag of tags) {
    if (!VALID_TAGS.includes(tag as AbilityTag))
      errors.push({ code: 'TAGS_001', field: 'ability_tags',
        message: `非法 ability_tag: "${tag}"` })
  }
  if (q.bank_domain === 'BASE_ABILITY' && tags.length === 0)
    errors.push({ code: 'TAGS_002', field: 'ability_tags',
      message: 'BASE_ABILITY 题的 ability_tags 至少需要 1 个值' })
  // JOB_SPECIFIC 允许空数组，但不允许非法值（上面循环已拦截）

  // ══════════════════════════════════════════════
  // 规则 15: 固定示范卷校验（全部 ACTIVE + 以上全部）
  // ══════════════════════════════════════════════
  if (q.status !== 'ACTIVE')
    errors.push({ code: 'STATUS_001', field: 'status',
      message: `题目状态必须为 ACTIVE，当前: ${q.status}` })

  // ══════════════════════════════════════════════
  // 补充规则: scoring_type 与 question_type 对应
  // ══════════════════════════════════════════════
  const VALID_SCORING_MAP: Record<string, string[]> = {
    'TRUE_FALSE':       ['EXACT_MATCH'],
    'SINGLE_CHOICE':    ['EXACT_MATCH'],
    'DRAG':             ['MAPPING_MATCH', 'ORDER_MATCH'],
    'SOFTWARE_TASK':    ['SET_MATCH', 'METRIC_THRESHOLD', 'EVENT_RULE'],
    'OFFLINE_OPERATION':['OFFLINE_RUBRIC'],
  }
  if (q.item_usage === 'SCORED_ITEM') {
    const allowed = VALID_SCORING_MAP[q.question_type] ?? []
    if (!allowed.includes(s.scoring_type))
      errors.push({ code: 'SCORING_TYPE_001', field: 'scoring_rule_json.scoring_type',
        message: `question_type "${q.question_type}" 不允许 scoring_type "${s.scoring_type}"，允许: ${allowed.join('/')}` })
  }

  // ══════════════════════════════════════════════
  // 补充规则: note 不得存储状态值
  // ══════════════════════════════════════════════
  const STATUS_PATTERNS = /^(ACTIVE|DRAFT|ARCHIVED|DISABLED)$/i
  if (c.note && STATUS_PATTERNS.test(c.note.trim()))
    warnings.push({ code: 'NOTE_001', field: 'note',
      message: `note 字段疑似存储状态值: "${c.note}"` })

  // ══════════════════════════════════════════════
  // 补充规则: RUBRIC_BASED / DRAG_PARTIAL 禁止入库
  // ══════════════════════════════════════════════
  const runtimeScoring = s as unknown as Record<string, unknown>
  if (runtimeScoring.scoring_type === 'RUBRIC_BASED')
    errors.push({ code: 'LEGACY_001', field: 'scoring_type',
      message: 'RUBRIC_BASED 已废止，须迁移为 OFFLINE_RUBRIC' })
  if (runtimeScoring.scoring_type === 'DRAG_PARTIAL')
    errors.push({ code: 'LEGACY_002', field: 'scoring_type',
      message: 'DRAG_PARTIAL 已废止，须迁移为 ORDER_MATCH 或 MAPPING_MATCH' })

  // ══════════════════════════════════════════════
  // 补充规则: 线上 pass_score 固定 2, fail_score 固定 0
  // ══════════════════════════════════════════════
  if (s.scoring_type !== 'OFFLINE_RUBRIC' && s.scoring_type !== 'NO_SCORE') {
    if (runtimeScoring.pass_score !== 2)
      errors.push({ code: 'SCORE_VALUE_001', field: 'pass_score', message: '线上 pass_score 必须为 2' })
    if (runtimeScoring.fail_score !== 0)
      errors.push({ code: 'SCORE_VALUE_002', field: 'fail_score', message: '线上 fail_score 必须为 0' })
  }

  return { valid: errors.length === 0, errors, warnings }
}
