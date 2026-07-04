const MODULE_MAP = {
  精细动作能力: 'FINE_MOTOR',
  认知理解能力: 'COGNITION',
  规则执行能力: 'RULE_EXECUTION',
  情绪调节能力: 'EMOTION_REGULATION',
  基础社交能力: 'BASIC_SOCIAL',
  安全操作能力: 'SAFETY_OPERATION'
}

const QUESTION_TYPE_MAP = {
  判断题: 'TRUE_FALSE',
  单项选择题: 'SINGLE_CHOICE',
  拖拽题: 'DRAG',
  实物操作题: 'OFFLINE_OPERATION',
  实操题: 'OFFLINE_OPERATION'
}

const DIFFICULTY_MAP = {
  低级: 1,
  中级: 3,
  高级: 5
}

const TYPE_ABBR_MAP = {
  TRUE_FALSE: 'TF',
  SINGLE_CHOICE: 'SC',
  DRAG: 'DRAG',
  OFFLINE_OPERATION: 'OFFLINE'
}

const ABILITY_TAG_MAP = {
  精细动作: 'FINE_MOTOR',
  精细动作能力: 'FINE_MOTOR',
  认知理解: 'COGNITION',
  认知理解能力: 'COGNITION',
  规则执行: 'RULE_EXECUTION',
  规则执行能力: 'RULE_EXECUTION',
  情绪调节: 'EMOTION_REGULATION',
  情绪调节能力: 'EMOTION_REGULATION',
  基础社交: 'BASIC_SOCIAL',
  基础社交能力: 'BASIC_SOCIAL',
  安全操作: 'SAFETY_OPERATION',
  安全操作能力: 'SAFETY_OPERATION'
}

function sqlStr(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

function getRequiredField(row, key, sourceRow) {
  const value = row[key]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`[question-bank-source-seed] source row ${sourceRow} missing required column: ${key}`)
  }
  return value.trim()
}

function normalizeOptionalText(value) {
  if (typeof value !== 'string') {
    return ''
  }
  return value.trim()
}

function splitAbilityTokens(value) {
  return value
    .split(/[，、,/\s]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
}

function resolveAbilityTags(value, fallbackModuleType, sourceRow) {
  const tokens = splitAbilityTokens(value)
  const tags = []
  const seen = new Set()

  for (const token of tokens) {
    const tag = ABILITY_TAG_MAP[token]
    if (!tag) {
      throw new Error(`[question-bank-source-seed] source row ${sourceRow} unknown ability tag: ${token}`)
    }
    if (!seen.has(tag)) {
      seen.add(tag)
      tags.push(tag)
    }
  }

  if (tags.length === 0) {
    tags.push(fallbackModuleType)
  }

  return tags
}

function appendReviewNote(note, scoringText) {
  const parts = ['[DRAFT_REVIEW_REQUIRED] 源 CSV 导入占位，需人工补齐答案/结构后再审核激活']
  if (note) {
    parts.push(note)
  }
  if (scoringText) {
    parts.push(`原始计分规则：${scoringText}`)
  }
  return parts.join('；')
}

function buildSourceMeta(ctx, sourceRow) {
  return {
    import_batch_id: ctx.importBatchId,
    source_file: ctx.sourceFile,
    source_row: sourceRow,
    imported_at: ctx.importedAt,
    imported_by: ctx.importedBy
  }
}

function buildDraftContentJson({ questionType, prompt, assessmentPoint, mediaBrief, abilityTags, note, source }) {
  const base = {
    question_type: questionType,
    prompt,
    assessment_point: assessmentPoint,
    ability_tags: abilityTags,
    source
  }

  if (mediaBrief) {
    base.media_brief = mediaBrief
  }
  if (note) {
    base.note = note
  }

  if (questionType === 'TRUE_FALSE') {
    return {
      ...base,
      expected_answer: false
    }
  }

  if (questionType === 'SINGLE_CHOICE') {
    return {
      ...base,
      options: [
        { key: 'A', text: '待人工补充选项 A' },
        { key: 'B', text: '待人工补充选项 B' }
      ],
      expected_answer: 'A'
    }
  }

  if (questionType === 'DRAG') {
    return {
      ...base,
      drag_items: [{ item_id: 'draft_item_01', label: '待人工补充拖拽项' }],
      drop_zones: [{ zone_id: 'draft_zone_01', label: '待人工补充放置区', accepts: ['draft_item_01'] }],
      scoring_mode: 'ALL_OR_NOTHING'
    }
  }

  return {
    ...base,
    offline_tool_brief: mediaBrief || '待人工补充教具说明',
    rubric_criteria: [
      {
        criterion_id: 'criterion_01',
        description: '待人工补充评分维度'
      }
    ]
  }
}

function buildDraftScoringRule(questionType) {
  if (questionType === 'TRUE_FALSE' || questionType === 'SINGLE_CHOICE') {
    return {
      scoring_type: 'EXACT_MATCH',
      max_score: 2,
      correct_score: 2,
      incorrect_score: 0
    }
  }

  if (questionType === 'DRAG') {
    return {
      scoring_type: 'DRAG_PARTIAL',
      max_score: 2,
      all_correct_score: 2,
      partial_correct_score: 0,
      incorrect_score: 0
    }
  }

  return {
    scoring_type: 'OFFLINE_RUBRIC',
    max_score: 2,
    criteria: [
      {
        criterion_id: 'criterion_01',
        description_0: '待人工补充 0 分标准',
        description_1: '待人工补充 1 分标准',
        description_2: '待人工补充 2 分标准'
      }
    ],
    score_labels: {
      '0': '不达标',
      '1': '需改进/需辅助',
      '2': '达标'
    }
  }
}

function nextQuestionId(moduleType, questionType, counters) {
  const counterKey = `${moduleType}::${questionType}`
  const next = (counters.get(counterKey) ?? 0) + 1
  counters.set(counterKey, next)
  return `Q_BASE_${moduleType}_${TYPE_ABBR_MAP[questionType]}_${String(next).padStart(3, '0')}`
}

export function parseCsv(text) {
  const rows = []
  let currentRow = []
  let currentField = ''
  let inQuotes = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]

    if (char === '"') {
      if (inQuotes && text[index + 1] === '"') {
        currentField += '"'
        index += 1
        continue
      }

      inQuotes = !inQuotes
      continue
    }

    if (char === ',' && !inQuotes) {
      currentRow.push(currentField)
      currentField = ''
      continue
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && text[index + 1] === '\n') {
        index += 1
      }

      currentRow.push(currentField)
      rows.push(currentRow)
      currentRow = []
      currentField = ''
      continue
    }

    currentField += char
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField)
    rows.push(currentRow)
  }

  const [headerRow, ...dataRows] = rows

  if (!headerRow) {
    return []
  }

  return dataRows
    .filter((row) => row.some((field) => field !== ''))
    .map((row) =>
      headerRow.reduce((record, header, index) => {
        record[header] = row[index] ?? ''
        return record
      }, {})
    )
}

export function mapSourceRow(row, ctx) {
  const sourceRow = ctx.sourceRow
  const moduleLabel = getRequiredField(row, '模块标题', sourceRow)
  const questionTypeLabel = getRequiredField(row, '题型标题', sourceRow)
  const difficultyLabel = getRequiredField(row, '考察难度', sourceRow)

  const moduleType = MODULE_MAP[moduleLabel]
  if (!moduleType) {
    throw new Error(`[question-bank-source-seed] source row ${sourceRow} unknown module: ${moduleLabel}`)
  }

  const questionType = QUESTION_TYPE_MAP[questionTypeLabel]
  if (!questionType) {
    throw new Error(`[question-bank-source-seed] source row ${sourceRow} unknown question type: ${questionTypeLabel}`)
  }

  const difficultyLevel = DIFFICULTY_MAP[difficultyLabel]
  if (!difficultyLevel) {
    throw new Error(`[question-bank-source-seed] source row ${sourceRow} unknown difficulty: ${difficultyLabel}`)
  }

  const prompt = getRequiredField(row, '题目', sourceRow)
  const assessmentPoint = getRequiredField(row, '考察点', sourceRow)
  const mediaBrief = normalizeOptionalText(row.素材内容描述)
  const abilityTags = resolveAbilityTags(
    normalizeOptionalText(row.能力维度标签),
    moduleType,
    sourceRow
  )
  const note = appendReviewNote(
    normalizeOptionalText(row.备注),
    normalizeOptionalText(row.计分规则)
  )
  const source = buildSourceMeta(ctx, sourceRow)
  const questionId = nextQuestionId(moduleType, questionType, ctx.counters)

  return {
    question_id: questionId,
    job_code: ctx.jobCode,
    module_type: moduleType,
    question_type: questionType,
    difficulty_level: difficultyLevel,
    content_json: buildDraftContentJson({
      questionType,
      prompt,
      assessmentPoint,
      mediaBrief,
      abilityTags,
      note,
      source
    }),
    scoring_rule_json: buildDraftScoringRule(questionType),
    media_asset_id: null,
    tool_asset_ids_json: null,
    safety_sensitive: 0,
    sensory_tags_json: null,
    status: 'DRAFT',
    version: 1
  }
}

export function buildQuestionBankDraftUpsertSql(rows) {
  const valueTuples = rows.map((row) => `  (
    ${sqlStr(row.question_id)},
    ${sqlStr(row.job_code)},
    ${sqlStr(row.module_type)},
    ${sqlStr(row.question_type)},
    ${row.difficulty_level},
    ${sqlStr(JSON.stringify(row.content_json))},
    ${sqlStr(JSON.stringify(row.scoring_rule_json))},
    NULL,
    NULL,
    ${row.safety_sensitive},
    NULL,
    ${sqlStr(row.status)},
    ${row.version}
  )`)

  return `INSERT INTO question_bank (
  question_id,
  job_code,
  module_type,
  question_type,
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

export function summarizeQuestionRows(rows) {
  const summary = {
    total: rows.length,
    byModule: {},
    byType: {}
  }

  for (const row of rows) {
    summary.byModule[row.module_type] = (summary.byModule[row.module_type] ?? 0) + 1
    summary.byType[row.question_type] = (summary.byType[row.question_type] ?? 0) + 1
  }

  return summary
}
