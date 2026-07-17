function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseJsonField(value, fieldName, reasons) {
  try {
    return JSON.parse(value)
  } catch {
    reasons.push(`${fieldName} is not valid JSON`)
    return null
  }
}

function validateSource(source, reasons) {
  if (!isRecord(source)) {
    reasons.push('content_json.source must exist')
    return
  }

  for (const key of ['import_batch_id', 'source_file', 'imported_at', 'imported_by']) {
    if (typeof source[key] !== 'string' || source[key].length === 0) {
      reasons.push(`content_json.source.${key} must be a non-empty string`)
    }
  }

  if (typeof source.source_row !== 'number' || !Number.isInteger(source.source_row) || source.source_row <= 0) {
    reasons.push('content_json.source.source_row must be a positive integer')
  }
}

/**
 * 读交互配置：v1.2 结构把 options/items/zones 存在 content.interaction.config（运行时权威路径），
 * 顶层字段为测试兼容 fallback（与 assessment.ts 读取顺序一致）。
 */
function interactionConfig(content) {
  return isRecord(content.interaction) && isRecord(content.interaction.config)
    ? content.interaction.config
    : {}
}

function validateAbilityTags(content, moduleType, reasons) {
  if (!Array.isArray(content.ability_tags) || content.ability_tags.length === 0) {
    reasons.push('content_json.ability_tags must be a non-empty array')
    return
  }

  // module_type 列为 null 时（JOB_SPECIFIC 域，模块归属在 job_module_code），
  // ability_tags 承载基础能力构念，不要求含 null；仅 BASE_ABILITY（module_type 非空）校验包含关系。
  if (moduleType != null && !content.ability_tags.includes(moduleType)) {
    reasons.push(`content_json.ability_tags must include module_type ${moduleType}`)
  }
}

function validateQuestionType(content, questionType, reasons) {
  if (content.question_type !== questionType) {
    reasons.push(`content_json.question_type must equal question_bank.question_type (${questionType})`)
  }
}

function validateScoringRule(scoringRule, questionType, itemUsage, reasons) {
  if (!isRecord(scoringRule)) {
    reasons.push('scoring_rule_json must be an object')
    return
  }

  // 观察项（OBSERVATION_ONLY）不计分：scoring_type 必须为 NO_SCORE（与转换器一致），跳过题型评分校验。
  if (itemUsage === 'OBSERVATION_ONLY') {
    if (scoringRule.scoring_type !== 'NO_SCORE') {
      reasons.push('OBSERVATION_ONLY scoring_type must be NO_SCORE')
    }
    return
  }

  if (questionType === 'TRUE_FALSE' || questionType === 'SINGLE_CHOICE') {
    if (scoringRule.scoring_type !== 'EXACT_MATCH') reasons.push('scoring_type must be EXACT_MATCH')
    if (scoringRule.max_score !== 2) reasons.push('max_score must be 2 for EXACT_MATCH')
    if (scoringRule.correct_score !== 2) reasons.push('correct_score must be 2 for EXACT_MATCH')
    if (scoringRule.incorrect_score !== 0) reasons.push('incorrect_score must be 0 for EXACT_MATCH')
    return
  }

  if (questionType === 'DRAG') {
    // v1.2 DRAG：ORDERING→ORDER_MATCH（correct_order），DRAG_DROP→MAPPING_MATCH（correct_mapping）。
    if (scoringRule.scoring_type === 'ORDER_MATCH') {
      if (!Array.isArray(scoringRule.correct_order) || scoringRule.correct_order.length === 0) {
        reasons.push('correct_order must be a non-empty array for ORDER_MATCH')
      }
    } else if (scoringRule.scoring_type === 'MAPPING_MATCH') {
      if (!isRecord(scoringRule.correct_mapping) || Object.keys(scoringRule.correct_mapping).length === 0) {
        reasons.push('correct_mapping must be a non-empty object for MAPPING_MATCH')
      }
    } else {
      reasons.push('scoring_type must be ORDER_MATCH or MAPPING_MATCH for DRAG')
    }
    if (scoringRule.max_score !== 2) reasons.push('max_score must be 2 for DRAG')
    return
  }

  if (scoringRule.scoring_type !== 'OFFLINE_RUBRIC') reasons.push('scoring_type must be OFFLINE_RUBRIC')
  if (scoringRule.max_score !== 2) reasons.push('max_score must be 2 for OFFLINE_RUBRIC')
  if (!isRecord(scoringRule.score_labels)) {
    reasons.push('score_labels must be an object for OFFLINE_RUBRIC')
  } else {
    for (const label of ['0', '1', '2']) {
      if (typeof scoringRule.score_labels[label] !== 'string' || scoringRule.score_labels[label].length === 0) {
        reasons.push(`score_labels.${label} must be a non-empty string`)
      }
    }
  }
  if (!Array.isArray(scoringRule.criteria) || scoringRule.criteria.length === 0) {
    reasons.push('criteria must be a non-empty array for OFFLINE_RUBRIC')
  }
}

function validateTrueFalseContent(content, scoringRule, reasons) {
  // 正确答案读 scoring_rule_json.correct_answer（运行时权威），顶层 expected_answer 为测试兼容 fallback
  const expected = isRecord(scoringRule) && scoringRule.correct_answer != null
    ? scoringRule.correct_answer
    : content.expected_answer
  if (typeof expected !== 'boolean') {
    reasons.push('TRUE_FALSE correct_answer must be boolean')
  }
  if (content.variants != null) {
    if (!Array.isArray(content.variants)) {
      reasons.push('TRUE_FALSE variants must be an array or null')
      return
    }
    for (const [index, variant] of content.variants.entries()) {
      if (!isRecord(variant)) {
        reasons.push(`variants[${index}] must be an object`)
        continue
      }
      if (typeof variant.expected_answer !== 'boolean') {
        reasons.push(`variants[${index}].expected_answer must be boolean`)
      }
    }
  }
}

function validateSingleChoiceContent(content, scoringRule, reasons) {
  // options 读 interaction.config（运行时权威），顶层为测试兼容 fallback
  const cfg = interactionConfig(content)
  const options = Array.isArray(cfg.options)
    ? cfg.options
    : Array.isArray(content.options)
      ? content.options
      : null
  if (!options || options.length < 2) {
    reasons.push('SINGLE_CHOICE options must have at least 2 items')
    return
  }

  const keys = new Set()
  for (const [index, option] of options.entries()) {
    if (!isRecord(option)) {
      reasons.push(`options[${index}] must be an object`)
      continue
    }
    if (typeof option.key !== 'string' || option.key.length === 0) {
      reasons.push(`options[${index}].key must be a non-empty string`)
      continue
    }
    if (keys.has(option.key)) {
      reasons.push(`options[${index}].key must be unique`)
    }
    keys.add(option.key)
  }

  // 正确答案读 scoring_rule_json.correct_answer（运行时权威），顶层 expected_answer 为测试兼容 fallback
  const expected = isRecord(scoringRule) && scoringRule.correct_answer != null
    ? scoringRule.correct_answer
    : content.expected_answer
  if (typeof expected !== 'string' || !keys.has(expected)) {
    reasons.push('SINGLE_CHOICE correct_answer must match options[].key')
  }
}

function validateDragContent(content, reasons) {
  // items/zones 读 interaction.config（运行时权威），顶层为测试兼容 fallback。
  // v1.2 两种 DRAG 交互：ORDERING（仅 items，正确顺序在 scoring_rule.correct_order）
  // 与 DRAG_DROP（items + zones，正确映射在 zone.accepts）。
  const cfg = interactionConfig(content)
  const items = Array.isArray(cfg.items)
    ? cfg.items
    : Array.isArray(content.drag_items)
      ? content.drag_items
      : null
  if (!items) {
    reasons.push('DRAG items must be an array')
    return
  }
  const itemIds = new Set()
  for (const [index, item] of items.entries()) {
    if (!isRecord(item)) {
      reasons.push(`items[${index}] must be an object`)
      continue
    }
    if (typeof item.item_id !== 'string' || item.item_id.length === 0) {
      reasons.push(`items[${index}].item_id must be a non-empty string`)
      continue
    }
    if (itemIds.has(item.item_id)) {
      reasons.push(`items[${index}].item_id must be unique`)
    }
    itemIds.add(item.item_id)
  }

  const zones = Array.isArray(cfg.zones)
    ? cfg.zones
    : Array.isArray(content.drop_zones)
      ? content.drop_zones
      : null
  const isOrdering = isRecord(content.interaction) && content.interaction.type === 'ORDERING'
  if (!isOrdering) {
    // DRAG_DROP：必须有 zones 且每个 zone.accepts 引用已知 item
    if (!zones) {
      reasons.push('DRAG_DROP zones must be an array')
      return
    }
    for (const [zoneIndex, zone] of zones.entries()) {
      if (!isRecord(zone)) {
        reasons.push(`zones[${zoneIndex}] must be an object`)
        continue
      }
      if (!Array.isArray(zone.accepts) || zone.accepts.length === 0) {
        reasons.push(`zones[${zoneIndex}].accepts must be a non-empty array`)
        continue
      }
      for (const accepted of zone.accepts) {
        if (!itemIds.has(accepted)) {
          reasons.push(`zones[${zoneIndex}].accepts contains unknown item_id ${accepted}`)
        }
      }
    }
  }
}

function validateOfflineContent(content, reasons) {
  if (typeof content.offline_tool_brief !== 'string' || content.offline_tool_brief.length === 0) {
    reasons.push('OFFLINE_OPERATION offline_tool_brief is required')
  }
  if (!Array.isArray(content.rubric_criteria) || content.rubric_criteria.length === 0) {
    reasons.push('OFFLINE_OPERATION rubric_criteria must be a non-empty array')
  }
}

function collectAssetIds(question, content) {
  const ids = []

  if (question.media_asset_id) {
    ids.push(question.media_asset_id)
  }

  if (Array.isArray(content.variants)) {
    for (const variant of content.variants) {
      if (variant?.media_asset_id) ids.push(variant.media_asset_id)
    }
  }

  // options/items 优先读 interaction.config（v1.2 权威），顶层为测试兼容 fallback
  const cfg = interactionConfig(content)
  const optionList = Array.isArray(cfg.options) ? cfg.options : content.options
  if (Array.isArray(optionList)) {
    for (const option of optionList) {
      if (option?.image_asset_id) ids.push(option.image_asset_id)
    }
  }

  const itemList = Array.isArray(cfg.items) ? cfg.items : content.drag_items
  if (Array.isArray(itemList)) {
    for (const item of itemList) {
      if (item?.image_asset_id) ids.push(item.image_asset_id)
    }
  }

  let toolAssetIds = []
  if (question.tool_asset_ids_json) {
    try {
      toolAssetIds = JSON.parse(question.tool_asset_ids_json)
    } catch {
      toolAssetIds = []
    }
  }
  if (Array.isArray(toolAssetIds)) {
    ids.push(...toolAssetIds.filter(Boolean))
  }

  return ids
}

function validateAssets(assetIds, assetsById, reasons) {
  for (const assetId of assetIds) {
    const asset = assetsById[assetId]
    if (!asset) {
      reasons.push(`asset reference not found: ${assetId}`)
      continue
    }
    if (asset.status !== 'ACTIVE') {
      reasons.push(`asset ${assetId} status must be ACTIVE, got ${asset.status}`)
    }
  }
}

function validateOnlineRubricText(content, questionType, reasons) {
  if (questionType === 'OFFLINE_OPERATION') {
    return
  }
  const text = typeof content.note === 'string' ? content.note : ''
  for (const banned of ['经提示', '犹豫', '提示后']) {
    if (text.includes(banned)) {
      reasons.push(`online rubric text must not contain ${banned}`)
    }
  }
}

function validateDraftMarker(content, reasons) {
  if (typeof content.note === 'string' && content.note.includes('[DRAFT_REVIEW_REQUIRED]')) {
    reasons.push('content_json.note still contains [DRAFT_REVIEW_REQUIRED]')
  }
}

function reviewSingleQuestion(question, assetsById) {
  const reasons = []
  const content = parseJsonField(question.content_json, 'content_json', reasons)
  const scoringRule = parseJsonField(question.scoring_rule_json, 'scoring_rule_json', reasons)

  if (content) {
    validateQuestionType(content, question.question_type, reasons)
    validateSource(content.source, reasons)
    validateAbilityTags(content, question.module_type, reasons)
    validateDraftMarker(content, reasons)
    validateOnlineRubricText(content, question.question_type, reasons)

    if (question.question_type === 'TRUE_FALSE') {
      validateTrueFalseContent(content, scoringRule, reasons)
    } else if (question.question_type === 'SINGLE_CHOICE') {
      validateSingleChoiceContent(content, scoringRule, reasons)
    } else if (question.question_type === 'DRAG') {
      validateDragContent(content, reasons)
    } else if (question.question_type === 'OFFLINE_OPERATION') {
      validateOfflineContent(content, reasons)
    }

    validateAssets(collectAssetIds(question, content), assetsById, reasons)
  }

  if (scoringRule) {
    validateScoringRule(scoringRule, question.question_type, question.item_usage, reasons)
  }

  return {
    question_id: question.question_id,
    status: reasons.length === 0 ? 'ELIGIBLE' : 'BLOCKED',
    reasons
  }
}

export function reviewQuestionBankRows(questionRows, { assetsById = {} } = {}) {
  const items = questionRows.map((question) => reviewSingleQuestion(question, assetsById))
  const eligible = items.filter((item) => item.status === 'ELIGIBLE').length

  return {
    checked: items.length,
    eligible,
    blocked: items.length - eligible,
    items
  }
}

export function buildActivateEligibleSql(items) {
  const eligibleIds = items.filter((item) => item.status === 'ELIGIBLE').map((item) => item.question_id)

  if (eligibleIds.length === 0) {
    return '-- No eligible DRAFT questions to activate.'
  }

  const quotedIds = eligibleIds.map((questionId) => `'${String(questionId).replace(/'/g, "''")}'`)

  return `UPDATE question_bank SET status = 'ACTIVE', updated_at = datetime('now')
WHERE status = 'DRAFT'
  AND question_id IN (${quotedIds.join(', ')});`
}
