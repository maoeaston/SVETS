// 专业岗位题库（298条）v0.1.10 → v0.1.12 清洗与重导逻辑。
// 依据：doc/specs/impl/04-question-bank-import-cleaning-spec.md
// 一次性数据运维脚本，纯 JS 生成 SQL，不引入 CSV/ORM 依赖（AGENTS.md 约束）。

const JOB_CODE_MAP = {
  supermarket_stocking: 'SUPERMARKET_SHELVER'
}

// 旧 module_type（基础能力枚举）→ 新 job_module_code（M1-M6）
const MODULE_TO_JOB_MODULE = {
  RULE_EXECUTION: 'M1',
  FINE_MOTOR: 'M2',
  COGNITION: 'M3',
  EMOTION_REGULATION: 'M4',
  SAFETY_OPERATION: 'M5',
  BASIC_SOCIAL: 'M6'
}

const VALID_ABILITY_TAGS = new Set([
  'FINE_MOTOR',
  'COGNITION',
  'RULE_EXECUTION',
  'EMOTION_REGULATION',
  'BASIC_SOCIAL',
  'SAFETY_OPERATION'
])

// 3 条已知嵌入式观察项（PRD v1.0.9 §5.3.13 沿用原 ID，不改名）
const KNOWN_OBSERVATION_IDS = new Set(['M1_OB_048', 'M5_OP_048', 'M5_OP_055'])

// M1_TF_015：审查报告 v2 §D4 标记的疑似答案键错误（正向组孤例 false）
const SUSPICIOUS_ANSWER_KEY_IDS = new Set(['M1_TF_015'])

// H6（2026-07-09 人工确认）：M5_OP_048/M5_OP_055 重导时重命名为 M5_OB_048/M5_OB_055
const ID_RENAME_MAP = {
  M5_OP_048: 'M5_OB_048',
  M5_OP_055: 'M5_OB_055'
}

// H1（2026-07-09 人工确认）：M1_TF_015 答案键错误，正确答案为 true
const CORRECTED_ANSWER_KEYS = {
  M1_TF_015: true
}

function sqlStr(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

function sqlNullableStr(value) {
  return value == null ? 'NULL' : sqlStr(value)
}

/** §5.3 is_ordering_drag：zones 标签含"第"和"步" → 排序题 */
export function isOrderingDrag(dropZones) {
  return (dropZones ?? []).some((z) => z.label && z.label.includes('第') && z.label.includes('步'))
}

/** §5.3 extract_549_ref：从 source_ref 提取"原题N"中的 N（可为数字或字母组合，如"A组1"） */
export function extract549Ref(sourceRef) {
  if (!sourceRef) return null
  const m = /原题\s*([^\s，,]+)/.exec(sourceRef)
  return m ? m[1] : null
}

/** §5.3 determine_variant_type：从 note/source_ref 推断 administration.variant_type */
export function determineVariantType(note, sourceRef) {
  const text = `${note ?? ''} ${sourceRef ?? ''}`
  if (text.includes('中断')) return 'INTERRUPTION'
  if (text.includes('干扰') || text.includes('背景音')) return 'DISTRACTION'
  if (text.includes('预埋') || text.includes('差错')) return 'PLANTED_ERROR'
  if (text.includes('限时')) return 'TIME_LIMITED'
  if (text.includes('警觉') || text.includes('衰减')) return 'VIGILANCE'
  if (text.includes('角色扮演') || text.includes('角色')) return 'ROLE_PLAY'
  return 'STANDARD'
}

/** 是否为嵌入式观察项：已知 ID 列表，或 question_id 含 _OB_，或 prompt 含"嵌入式观察" */
export function isObservationItem(questionId, prompt) {
  if (KNOWN_OBSERVATION_IDS.has(questionId)) return true
  if (questionId.includes('_OB_')) return true
  if (prompt && prompt.includes('嵌入式观察')) return true
  return false
}

/** §3.2 ability_tags 清洗：["0"]/["1"] → []；合法值原样保留；非法值丢弃并记录警告 */
export function cleanAbilityTags(rawTags) {
  const tags = Array.isArray(rawTags) ? rawTags : []
  if (tags.length === 1 && (tags[0] === '0' || tags[0] === '1')) {
    return { tags: [], cleaned: true }
  }
  const cleaned = tags.filter((t) => VALID_ABILITY_TAGS.has(t))
  return { tags: cleaned, cleaned: cleaned.length !== tags.length }
}

/** §5.1 C3：note 精确等于状态值（ACTIVE/DRAFT/ARCHIVED/DISABLED）→ 丢弃 */
const STATUS_ONLY_PATTERN = /^(ACTIVE|DRAFT|ARCHIVED|DISABLED)$/i

export function cleanNote(rawNote) {
  if (!rawNote) return { note: null, cleaned: false }
  const trimmed = rawNote.trim()
  if (STATUS_ONLY_PATTERN.test(trimmed)) {
    return { note: null, cleaned: true }
  }
  return { note: trimmed, cleaned: false }
}

// ═══════════════════════════════════════════════════════
// §4 scoring_rule_json 重构
// ═══════════════════════════════════════════════════════

/**
 * §4.1 EXACT_MATCH 升级：不变结构 + 新增 correct_answer（从旧 content_json.expected_answer 迁入）。
 */
export function buildExactMatchScoringRule(expectedAnswer) {
  return {
    scoring_type: 'EXACT_MATCH',
    max_score: 2,
    correct_score: 2,
    incorrect_score: 0,
    correct_answer: expectedAnswer
  }
}

/**
 * §4.2 DRAG_PARTIAL → ORDER_MATCH（排序）或 MAPPING_MATCH（分类）。
 * 排序题从 drop_zones（按 label 中的步骤号排序）推导 correct_order；
 * 分类题从 drop_zones.accepts 推导 correct_mapping（item_id → zone_id）。
 */
export function migrateDragScoringRule(dragItems, dropZones) {
  if (isOrderingDrag(dropZones)) {
    const sortedZones = [...dropZones].sort((a, b) => {
      const na = Number.parseInt(/\d+/.exec(a.label)?.[0] ?? '0', 10)
      const nb = Number.parseInt(/\d+/.exec(b.label)?.[0] ?? '0', 10)
      return na - nb
    })
    const correctOrder = sortedZones.flatMap((z) => z.accepts ?? [])
    return {
      scoring_type: 'ORDER_MATCH',
      max_score: 2,
      correct_order: correctOrder,
      all_correct_score: 2,
      partial_credit: false
    }
  }

  const correctMapping = {}
  for (const zone of dropZones ?? []) {
    for (const itemId of zone.accepts ?? []) {
      correctMapping[itemId] = zone.zone_id
    }
  }
  return {
    scoring_type: 'MAPPING_MATCH',
    max_score: 2,
    correct_mapping: correctMapping,
    all_correct_score: 2,
    partial_credit: false
  }
}

/**
 * §4.3 RUBRIC_BASED → OFFLINE_RUBRIC（实操）或 NO_SCORE（观察，D1 规则）。
 * criteria 从旧 score_N_description 三字段迁移为 {criterion_id, description, score_0, score_1, score_2}。
 * 旧库 97 条实操共享同一套通用锚点文案（"未能完成/部分完成/完全达标"），
 * 迁移时原样保留但标记 rubric_anchor_status=PENDING（D2），不阻塞 DRAFT 导入。
 */
export function migrateRubricScoringRule(oldScoringRule, isObservation) {
  if (isObservation) {
    return { scoring_type: 'NO_SCORE' }
  }
  return {
    scoring_type: 'OFFLINE_RUBRIC',
    max_score: 2,
    criteria: [
      {
        criterion_id: 'r1',
        description: '综合操作达标度',
        score_0: oldScoringRule.score_0_description ?? '未能完成',
        score_1: oldScoringRule.score_1_description ?? '部分完成',
        score_2: oldScoringRule.score_2_description ?? '完全达标'
      }
    ],
    rubric_anchor_status: 'PENDING'
  }
}

/** 按旧 scoring_type 分流到对应迁移函数。抛错时抛出 IMP_E005（scoring_rule_json 解析/迁移失败）。 */
export function migrateScoringRule({ oldScoringRule, questionType, dragItems, dropZones, expectedAnswer, isObservation }) {
  const oldType = oldScoringRule?.scoring_type
  if (oldType === 'EXACT_MATCH') {
    return buildExactMatchScoringRule(expectedAnswer)
  }
  if (oldType === 'DRAG_PARTIAL') {
    return migrateDragScoringRule(dragItems, dropZones)
  }
  if (oldType === 'RUBRIC_BASED') {
    return migrateRubricScoringRule(oldScoringRule, isObservation)
  }
  throw new Error(`[IMP_E005] unknown legacy scoring_type "${oldType}" for question_type ${questionType}`)
}

// ═══════════════════════════════════════════════════════
// §3 content_json 重构
// ═══════════════════════════════════════════════════════

/** §3.4 review 块：全部初始化为 PENDING；观察项为 NOT_REQUIRED（不涉及答案键概念）。 */
function buildReviewBlock(isObservation) {
  return {
    answer_key_status: isObservation ? 'NOT_REQUIRED' : 'PENDING',
    answer_key_reviewed_by: null,
    answer_key_reviewed_at: null,
    answer_key_review_note: null
  }
}

/** §3.4 source 块：保留导入溯源 + 解析 549 池原题号 + 旧 job_code/question_id 追溯。 */
function buildSourceBlock({ oldSource, legacyQuestionId, transformation }) {
  const sourceRef = oldSource?.source_ref ?? null
  return {
    import_batch_id: 'batch_reimport_v012',
    source_file: '专业岗位能力测评题库-M1-M6-数据库导出-298条.json',
    source_ref: sourceRef,
    origin_refs: sourceRef ? [sourceRef] : [],
    source_ref_549: extract549Ref(sourceRef),
    transformation: transformation ?? null,
    legacy_job_code: 'supermarket_stocking',
    legacy_question_id: legacyQuestionId
  }
}

/** SINGLE_CHOICE：§3.3 重构为 SINGLE_SELECT 交互 + options 迁入 interaction.config。 */
function buildSingleChoiceContent(base, oldContent) {
  return {
    ...base,
    interaction: { type: 'SINGLE_SELECT', config: { options: oldContent.options ?? [] } },
    presentation: { type: base.media_brief ? 'IMAGE_CARD' : 'TEXT_ONLY', media_brief: base.media_brief ?? null, assets: [] },
    expected_evidence: { type: 'SITUATIONAL_JUDGMENT' },
    support_policy: { max_prompt_level: 'P1', accommodations_allowed: [] },
    log_metrics: ['first_selection_latency_ms', 'change_count']
  }
}

/** TRUE_FALSE：§3.3 + C10 — media_brief 含"视频"时降级为 IMAGE_CARD 并标记 transformation。 */
function buildTrueFalseContent(base, oldContent, isVideoTransformed) {
  return {
    ...base,
    interaction: { type: 'BINARY_SELECT', config: {} },
    presentation: {
      type: 'IMAGE_CARD',
      media_brief: base.media_brief ?? null,
      assets: [],
      ...(isVideoTransformed ? { transformation: 'VIDEO_TO_IMAGE_CARD' } : {})
    },
    expected_evidence: { type: 'SITUATIONAL_JUDGMENT' },
    support_policy: { max_prompt_level: 'P1', accommodations_allowed: [] },
    log_metrics: ['first_selection_latency_ms'],
    variants: oldContent.variants ?? null
  }
}

/** DRAG：§3.3 排序题 → ORDERING 交互；分类题 → DRAG_DROP 交互。 */
function buildDragContent(base, oldContent, ordering) {
  const interactionType = ordering ? 'ORDERING' : 'DRAG_DROP'
  const config = ordering
    ? { items: oldContent.drag_items ?? [], correct_order: null } // correct_order 由 scoring_rule_json 承载唯一事实源
    : { items: oldContent.drag_items ?? [], zones: oldContent.drop_zones ?? [] }
  return {
    ...base,
    interaction: { type: interactionType, config },
    presentation: { type: base.media_brief ? 'IMAGE_CARD' : 'TEXT_ONLY', media_brief: base.media_brief ?? null, assets: [] },
    expected_evidence: { type: 'DIRECT_PERFORMANCE' },
    support_policy: { max_prompt_level: 'P1', accommodations_allowed: [] },
    log_metrics: ['completion_duration_ms', 'attempt_count']
  }
}

/** OFFLINE_OPERATION：§3.3 实操题 → OFFLINE_RUBRIC 交互；观察项 → TEACHER_OBSERVATION 交互。 */
function buildOfflineOperationContent(base, oldContent, isObservation, variantType) {
  return {
    ...base,
    interaction: { type: isObservation ? 'TEACHER_OBSERVATION' : 'OFFLINE_RUBRIC', config: {} },
    presentation: { type: 'OFFLINE_MATERIALS', media_brief: base.media_brief ?? null, assets: [] },
    offline_tool_brief: oldContent.offline_tool_brief ?? '',
    rubric_criteria: oldContent.rubric_criteria ?? [],
    administration: { variant_type: variantType },
    expected_evidence: { type: isObservation ? 'EMBEDDED_OBSERVATION' : 'DIRECT_PERFORMANCE' },
    termination_policy: { allow_pause: true }
  }
}

/**
 * 单条 content_json 重构入口。返回 { contentJson, cleaningLog }。
 * cleaningLog 记录本条命中的清洗规则（供 dry-run §6.2 汇总统计）。
 */
export function rebuildContentJson(oldContent, { questionId, isObservation }) {
  const cleaningLog = []

  const { tags: abilityTags, cleaned: tagsCleaned } = cleanAbilityTags(oldContent.ability_tags)
  if (tagsCleaned) cleaningLog.push('ability_tags_cleaned')

  const { note, cleaned: noteCleaned } = cleanNote(oldContent.note)
  if (noteCleaned) cleaningLog.push('note_status_cleaned')

  let mediaBrief = oldContent.media_brief ?? null
  if (mediaBrief && mediaBrief.startsWith('，')) {
    mediaBrief = mediaBrief.slice(1)
    cleaningLog.push('media_brief_prefix_fixed')
  }

  const sourceRef = oldContent.source?.source_ref ?? ''
  const isVideoTransformed = questionId && oldContent.question_type === 'TRUE_FALSE' && (mediaBrief ?? '').includes('视频')
  const variantType = determineVariantType(note, sourceRef)
  if (variantType !== 'STANDARD') cleaningLog.push(`variant_type_${variantType}`)

  const base = {
    schema_version: 'question-content-v1.2',
    question_type: oldContent.question_type,
    prompt: oldContent.prompt,
    target_construct: oldContent.assessment_point ?? null,
    ability_tags: abilityTags,
    media_brief: mediaBrief,
    ...(note ? { note } : {}),
    review: buildReviewBlock(isObservation),
    source: buildSourceBlock({
      oldSource: oldContent.source,
      legacyQuestionId: questionId,
      transformation: isVideoTransformed ? 'VIDEO_TO_IMAGE_CARD' : null
    })
  }

  let contentJson
  if (oldContent.question_type === 'SINGLE_CHOICE') {
    contentJson = buildSingleChoiceContent(base, oldContent)
  } else if (oldContent.question_type === 'TRUE_FALSE') {
    contentJson = buildTrueFalseContent(base, oldContent, isVideoTransformed)
    if (isVideoTransformed) cleaningLog.push('video_to_image_card')
  } else if (oldContent.question_type === 'DRAG') {
    const ordering = isOrderingDrag(oldContent.drop_zones)
    contentJson = buildDragContent(base, oldContent, ordering)
    cleaningLog.push(ordering ? 'drag_partial_to_order_match' : 'drag_partial_to_mapping_match')
  } else if (oldContent.question_type === 'OFFLINE_OPERATION') {
    contentJson = buildOfflineOperationContent(base, oldContent, isObservation, variantType)
    cleaningLog.push(isObservation ? 'rubric_based_to_no_score' : 'rubric_based_to_offline_rubric')
  } else {
    throw new Error(`[IMP_E002] unknown question_type "${oldContent.question_type}" for ${questionId}`)
  }

  if (questionId && SUSPICIOUS_ANSWER_KEY_IDS.has(questionId)) {
    contentJson.review.answer_key_status = 'CORRECTED'
    contentJson.review.answer_key_review_note = '[已人工确认] 正向组答案应为 true，旧库导入取反错误，已改正 — 2026-07-09'
    cleaningLog.push('answer_key_corrected')
  }

  return { contentJson, cleaningLog }
}

// ═══════════════════════════════════════════════════════
// §2 顶层字段映射 + 单条完整转换入口
// ═══════════════════════════════════════════════════════

/**
 * 将旧库一行（298条.json 的原始记录）转换为 v0.1.12 question_bank 行 + 清洗日志。
 * 抛错时抛出 IMP_E001~E006（§8），调用方应终止整体导入。
 */
export function mapImportRow(rawRow) {
  const questionId = rawRow.question_id
  if (!questionId) {
    throw new Error('[IMP_E001] question row missing question_id')
  }

  const jobCode = JOB_CODE_MAP[rawRow.job_code]
  if (!jobCode) {
    throw new Error(`[IMP_E003] unknown job_code "${rawRow.job_code}" for ${questionId}`)
  }

  const jobModuleCode = MODULE_TO_JOB_MODULE[rawRow.module_type]
  if (!jobModuleCode) {
    throw new Error(`[IMP_E003] unknown legacy module_type "${rawRow.module_type}" for ${questionId} (job_module_code mapping failed)`)
  }

  let oldContent
  try {
    oldContent = typeof rawRow.content_json === 'string' ? JSON.parse(rawRow.content_json) : rawRow.content_json
  } catch (err) {
    throw new Error(`[IMP_E004] content_json parse failed for ${questionId}: ${err.message}`)
  }

  let oldScoringRule
  try {
    oldScoringRule =
      typeof rawRow.scoring_rule_json === 'string' ? JSON.parse(rawRow.scoring_rule_json) : rawRow.scoring_rule_json
  } catch (err) {
    throw new Error(`[IMP_E005] scoring_rule_json parse failed for ${questionId}: ${err.message}`)
  }

  const questionType = rawRow.question_type
  if (!['TRUE_FALSE', 'SINGLE_CHOICE', 'DRAG', 'OFFLINE_OPERATION'].includes(questionType)) {
    throw new Error(`[IMP_E002] question_type "${questionType}" not in legal enum for ${questionId}`)
  }

  const isObservation = isObservationItem(questionId, oldContent.prompt)
  const itemUsage = isObservation ? 'OBSERVATION_ONLY' : 'SCORED_ITEM'

  const { contentJson, cleaningLog } = rebuildContentJson(oldContent, { questionId, isObservation })

  const correctedExpectedAnswer = Object.prototype.hasOwnProperty.call(CORRECTED_ANSWER_KEYS, questionId)
    ? CORRECTED_ANSWER_KEYS[questionId]
    : oldContent.expected_answer
  const scoringRuleJson = migrateScoringRule({
    oldScoringRule,
    questionType,
    dragItems: oldContent.drag_items,
    dropZones: oldContent.drop_zones,
    expectedAnswer: correctedExpectedAnswer,
    isObservation
  })

  return {
    question_id: ID_RENAME_MAP[questionId] ?? questionId,
    job_code: jobCode,
    bank_domain: 'JOB_SPECIFIC',
    module_type: null,
    job_module_code: jobModuleCode,
    question_type: questionType,
    item_usage: itemUsage,
    difficulty_level: rawRow.difficulty_level,
    content_json: contentJson,
    scoring_rule_json: scoringRuleJson,
    media_asset_id: null,
    tool_asset_ids_json: null,
    safety_sensitive: rawRow.safety_sensitive ? 1 : 0,
    sensory_tags_json: rawRow.sensory_tags_json ?? null,
    status: 'DRAFT',
    version: 1,
    cleaning_log: cleaningLog,
    // dry-run §6.4 用：SINGLE_CHOICE 正确答案位置分布
    _scAnswerKey: questionType === 'SINGLE_CHOICE' ? oldContent.expected_answer : null,
    _oldModuleType: rawRow.module_type
  }
}

// ═══════════════════════════════════════════════════════
// SQL 生成
// ═══════════════════════════════════════════════════════

export function buildQuestionBankImportSql(rows) {
  const valueTuples = rows.map(
    (row) => `  (
    ${sqlStr(row.question_id)},
    ${sqlStr(row.job_code)},
    ${sqlStr(row.bank_domain)},
    NULL,
    ${sqlStr(row.job_module_code)},
    ${sqlStr(row.question_type)},
    ${sqlStr(row.item_usage)},
    ${row.difficulty_level},
    ${sqlStr(JSON.stringify(row.content_json))},
    ${sqlStr(JSON.stringify(row.scoring_rule_json))},
    NULL,
    NULL,
    ${row.safety_sensitive},
    ${sqlNullableStr(row.sensory_tags_json)},
    ${sqlStr(row.status)},
    ${row.version}
  )`
  )

  return `INSERT INTO question_bank (
  question_id,
  job_code,
  bank_domain,
  module_type,
  job_module_code,
  question_type,
  item_usage,
  difficulty_level,
  content_json,
  scoring_rule_json,
  media_asset_id,
  tool_asset_ids_json,
  safety_sensitive,
  sensory_tags_json,
  status,
  version
) VALUES
${valueTuples.join(',\n')}
ON CONFLICT(question_id) DO UPDATE SET
  job_code = excluded.job_code,
  bank_domain = excluded.bank_domain,
  module_type = excluded.module_type,
  job_module_code = excluded.job_module_code,
  question_type = excluded.question_type,
  item_usage = excluded.item_usage,
  difficulty_level = excluded.difficulty_level,
  content_json = excluded.content_json,
  scoring_rule_json = excluded.scoring_rule_json,
  media_asset_id = excluded.media_asset_id,
  tool_asset_ids_json = excluded.tool_asset_ids_json,
  safety_sensitive = excluded.safety_sensitive,
  sensory_tags_json = excluded.sensory_tags_json,
  status = excluded.status,
  version = excluded.version,
  updated_at = datetime('now');`
}

/** 每条对应一个 QUESTION_IMPORTED 事件 INSERT（domain_event_projection 投影）。 */
export function buildQuestionImportedEventsSql(rows, { importBatchId, importedAt, actorId }) {
  const statements = rows.map((row) => {
    const eventId = `evt_import_${row.question_id}_${importBatchId}`
    const payload = JSON.stringify({
      question_id: row.question_id,
      job_code: row.job_code,
      bank_domain: row.bank_domain,
      job_module_code: row.job_module_code,
      question_type: row.question_type,
      item_usage: row.item_usage,
      import_batch_id: importBatchId
    })
    return `INSERT INTO domain_event_projection (
  event_id, aggregate_type, aggregate_id, event_type, event_sequence,
  payload_json, checksum, source_log_path, schema_version, created_at
) VALUES (
  ${sqlStr(eventId)}, 'QUESTION_BANK', ${sqlStr(row.question_id)}, 'QUESTION_IMPORTED', 1,
  ${sqlStr(payload)}, ${sqlStr('sha256-placeholder')}, ${sqlStr('action_log.jsonl')}, 1, ${sqlStr(importedAt)}
);`
  })
  return statements.join('\n')
}

// ═══════════════════════════════════════════════════════
// §6 dry-run 报告
// ═══════════════════════════════════════════════════════

/** §6.1 模块（job_module_code）× 题型 对账矩阵。观察项计入其 question_type 的物理列（§10 [!]1）。 */
function buildReconciliationMatrix(rows) {
  const matrix = {}
  const typeOrder = ['SINGLE_CHOICE', 'TRUE_FALSE', 'DRAG', 'OFFLINE_OPERATION']
  for (const row of rows) {
    const m = row.job_module_code
    matrix[m] ??= { SINGLE_CHOICE: 0, TRUE_FALSE: 0, DRAG: 0, OFFLINE_OPERATION: 0, OBSERVATION: 0, total: 0 }
    if (row.item_usage === 'OBSERVATION_ONLY') {
      matrix[m].OBSERVATION += 1
    }
    matrix[m][row.question_type] += 1
    matrix[m].total += 1
  }
  const grandTotal = rows.length
  return { matrix, typeOrder, grandTotal }
}

/** §6.2 数据质量报告：汇总各条 cleaning_log 命中次数。 */
function buildDataQualityReport(rows) {
  const counts = {}
  for (const row of rows) {
    for (const key of row.cleaning_log) {
      counts[key] = (counts[key] ?? 0) + 1
    }
  }
  return counts
}

/** §6.3 素材缺口清单：media_brief 有值但 media_asset_id 为 NULL（全部 298 条原值皆 NULL）。 */
function buildAssetGapReport(rows) {
  let withBriefNoAsset = 0
  for (const row of rows) {
    if (row.content_json.media_brief) withBriefNoAsset += 1
  }
  return { with_media_brief_no_asset: withBriefNoAsset, total: rows.length }
}

/** §6.4 SC 答案位置分布。 */
function buildScAnswerDistribution(rows) {
  const dist = {}
  let total = 0
  for (const row of rows) {
    if (row.question_type !== 'SINGLE_CHOICE') continue
    const key = row._scAnswerKey ?? '(unknown)'
    dist[key] = (dist[key] ?? 0) + 1
    total += 1
  }
  return { distribution: dist, total }
}

/** §6.5 rubric 锚点缺口：OFFLINE_RUBRIC 全部标记 rubric_anchor_status=PENDING（本轮重导不补写锚点）。 */
function buildRubricGapReport(rows) {
  let pending = 0
  let total = 0
  for (const row of rows) {
    if (row.scoring_rule_json.scoring_type !== 'OFFLINE_RUBRIC') continue
    total += 1
    if (row.scoring_rule_json.rubric_anchor_status === 'PENDING') pending += 1
  }
  return { pending, total }
}

/** §6.6 域隔离验证：JOB_SPECIFIC 题必须 module_type=NULL 且 job_module_code 非空。 */
function buildDomainIsolationReport(rows) {
  const moduleTypeViolations = rows.filter((r) => r.module_type !== null).length
  const jobModuleMissing = rows.filter((r) => !r.job_module_code).length
  return {
    module_type_should_be_null_violations: moduleTypeViolations,
    job_module_code_missing_violations: jobModuleMissing,
    pass: moduleTypeViolations === 0 && jobModuleMissing === 0
  }
}

/** 构造完整 dry-run 报告对象（供 CLI 输出为 JSON）。 */
export function buildDryRunReport(rows) {
  const { matrix, typeOrder, grandTotal } = buildReconciliationMatrix(rows)
  return {
    total_rows: rows.length,
    reconciliation_matrix: matrix,
    reconciliation_type_order: typeOrder,
    reconciliation_grand_total: grandTotal,
    data_quality: buildDataQualityReport(rows),
    asset_gap: buildAssetGapReport(rows),
    sc_answer_distribution: buildScAnswerDistribution(rows),
    rubric_gap: buildRubricGapReport(rows),
    domain_isolation: buildDomainIsolationReport(rows),
    observation_items: rows.filter((r) => r.item_usage === 'OBSERVATION_ONLY').map((r) => r.question_id),
    answer_key_suspicious: rows.filter((r) => r.cleaning_log.includes('answer_key_suspicious')).map((r) => r.question_id)
  }
}
