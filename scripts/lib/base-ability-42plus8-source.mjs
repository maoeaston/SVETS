import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import initSqlJs from 'sql.js'

export const MODULE_TYPES = [
  'FINE_MOTOR',
  'COGNITION',
  'RULE_EXECUTION',
  'EMOTION_REGULATION',
  'BASIC_SOCIAL',
  'SAFETY_OPERATION'
]

export const ONLINE_QUESTION_TYPES = ['TRUE_FALSE', 'SINGLE_CHOICE', 'DRAG', 'SOFTWARE_TASK']

const MODULE_MAP = {
  '精细动作能力': 'FINE_MOTOR',
  '认知理解能力': 'COGNITION',
  '规则执行能力': 'RULE_EXECUTION',
  '情绪调节能力': 'EMOTION_REGULATION',
  '基础社交能力': 'BASIC_SOCIAL',
  '安全操作能力': 'SAFETY_OPERATION'
}

const DIFFICULTY_MAP = { '基础': 1, '中等': 2, '较高': 3 }
const DRAG_KEYWORDS = ['拖拽', '拖放', '拖']

let sqlPromise

function ensureSqlJs(projectRoot) {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({
      locateFile: (file) => join(projectRoot, 'node_modules', 'sql.js', 'dist', file)
    })
  }
  return sqlPromise
}

function createQuestionBankTable(db) {
  db.run(`CREATE TABLE question_bank (
    question_id TEXT PRIMARY KEY,
    job_code TEXT,
    bank_domain TEXT,
    module_type TEXT,
    job_module_code TEXT,
    question_type TEXT,
    item_usage TEXT,
    difficulty_level INTEGER,
    content_json TEXT,
    scoring_rule_json TEXT,
    media_asset_id TEXT,
    tool_asset_ids_json TEXT,
    safety_sensitive INTEGER,
    sensory_tags_json TEXT,
    status TEXT,
    version INTEGER,
    updated_at TEXT
  )`)
}

function queryRows(db) {
  const stmt = db.prepare(`SELECT
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
    FROM question_bank
    ORDER BY question_id`)
  const rows = []
  try {
    while (stmt.step()) rows.push(stmt.getAsObject())
  } finally {
    stmt.free()
  }
  return rows
}

function unescapeXml(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function parseWorkbookRows(xlsxPath) {
  const tempRoot = mkdtempSync(join(tmpdir(), 'svets-base-ability-xlsx-'))
  try {
    execFileSync('unzip', ['-q', xlsxPath, '-d', tempRoot])
    const sharedStrings = []
    const sharedStringsPath = join(tempRoot, 'xl', 'sharedStrings.xml')
    if (existsSync(sharedStringsPath)) {
      const xml = readFileSync(sharedStringsPath, 'utf8')
      for (const match of xml.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)) {
        sharedStrings.push(unescapeXml(match[1]))
      }
    }

    const sheetXml = readFileSync(join(tempRoot, 'xl', 'worksheets', 'sheet2.xml'), 'utf8')
    const rows = []
    for (const rowMatch of sheetXml.matchAll(/<(?:x:)?row\b[^>]*>([\s\S]*?)<\/(?:x:)?row>/g)) {
      const cells = []
      for (const cellMatch of rowMatch[1].matchAll(/<(?:x:)?c\b([^>]*)>([\s\S]*?)<\/(?:x:)?c>/g)) {
        const valueMatch = cellMatch[2].match(/<(?:x:)?v>([^<]*)<\/(?:x:)?v>/)
        const value = valueMatch ? valueMatch[1] : ''
        cells.push(/t="s"/.test(cellMatch[1]) ? (sharedStrings[Number.parseInt(value, 10)] ?? '') : value)
      }
      rows.push(cells)
    }
    return rows
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
}

function deriveQuestionType(presentationWay, interactionType) {
  const isDrag = DRAG_KEYWORDS.some((keyword) => interactionType.includes(keyword))
  if (presentationWay === '实物操作') return 'OFFLINE_OPERATION'
  if (['屏幕图片', '屏幕场景', '屏幕分支情境'].includes(presentationWay)) {
    return isDrag ? 'DRAG' : 'SINGLE_CHOICE'
  }
  if (['屏幕任务', '屏幕多点触控', '屏幕模拟'].includes(presentationWay)) {
    return isDrag ? 'DRAG' : 'SOFTWARE_TASK'
  }
  return 'SOFTWARE_TASK'
}

function workbookRecord(cells, sourceRow) {
  const [
    questionId,
    moduleLabel,
    subDimension,
    presentationWay,
    interactionLabel,
    digitalizationLevel,
    difficultyLabel,
    targetConstruct,
    prompt,
    materials,
    standardInstruction,
    correctResponse,
    scoringPoints,
    allowedSupport,
    terminationCondition,
    systemLogIndicators,
    evidenceType,
    validityBoundary,
    sourceTrace,
    adjustment,
    professionalReviewRequired,
    candidateStatus,
    notes
  ] = cells
  const moduleType = MODULE_MAP[moduleLabel]
  if (!questionId?.startsWith('GA-') || !moduleType) {
    throw new Error(`[base-ability-source] workbook row ${sourceRow} has an invalid question ID or module`)
  }
  const questionType = deriveQuestionType(presentationWay, interactionLabel)
  return {
    question_id: questionId,
    job_code: 'SUPERMARKET_SHELVER',
    bank_domain: 'BASE_ABILITY',
    module_type: moduleType,
    job_module_code: null,
    question_type: questionType,
    item_usage: presentationWay === '系统嵌入观察' ? 'OBSERVATION_ONLY' : 'SCORED_ITEM',
    difficulty_level: DIFFICULTY_MAP[difficultyLabel] ?? 1,
    safety_sensitive: moduleType === 'SAFETY_OPERATION' ? 1 : 0,
    status: 'DRAFT',
    version: 1,
    source_row: sourceRow,
    source: {
      source_file: 'doc/reference/通用基础能力正式测评候选题库_v0.2-软件优先版.xlsx',
      source_sheet: 'sheet2',
      source_row: sourceRow,
      source_trace: sourceTrace
    },
    raw: {
      sub_dimension: subDimension,
      presentation_way: presentationWay,
      interaction_label: interactionLabel,
      digitalization_level: digitalizationLevel,
      target_construct: targetConstruct,
      prompt,
      materials,
      standard_instruction: standardInstruction,
      correct_response: correctResponse,
      scoring_points: scoringPoints,
      allowed_support: allowedSupport,
      termination_condition: terminationCondition,
      system_log_indicators: systemLogIndicators,
      evidence_type: evidenceType,
      validity_boundary: validityBoundary,
      adjustment,
      professional_review_required: professionalReviewRequired,
      candidate_status: candidateStatus,
      notes
    }
  }
}

export function fileSha256(projectRoot, relativePath) {
  return `sha256:${createHash('sha256').update(readFileSync(join(projectRoot, relativePath))).digest('hex')}`
}

export async function loadBaseAbilityRowsFromSql(projectRoot) {
  const sqlPath = join(projectRoot, 'doc', 'features', 'question-bank-import-base-ability-v02.sql')
  const SQL = await ensureSqlJs(projectRoot)
  const db = new SQL.Database()
  try {
    createQuestionBankTable(db)
    db.run(readFileSync(sqlPath, 'utf8'))
    return queryRows(db)
  } finally {
    db.close()
  }
}

export async function loadBaseAbilityCandidates(projectRoot) {
  const sqlRows = await loadBaseAbilityRowsFromSql(projectRoot)
  return sqlRows.map((row) => {
    const content = JSON.parse(row.content_json)
    const source = {
      source_file: content.source?.source_file ?? '通用基础能力正式测评候选题库_v0.2-软件优先版.xlsx',
      source_sheet: 'sheet2',
      source_row: row.question_id,
      source_trace: content.source?.source_trace ?? null,
      import_batch_id: content.source?.import_batch_id ?? 'batch_base_ability_v02'
    }
    return {
      question_id: row.question_id,
      job_code: row.job_code,
      bank_domain: row.bank_domain,
      module_type: row.module_type,
      job_module_code: row.job_module_code,
      question_type: row.question_type,
      item_usage: row.item_usage,
      difficulty_level: row.difficulty_level,
      safety_sensitive: row.safety_sensitive,
      status: row.status,
      version: row.version,
      source,
      raw: {
        sub_dimension: content.sub_dimension,
        presentation_way: content.presentation_way,
        interaction_label: content.interaction_type,
        digitalization_level: null,
        target_construct: content.assessment_point,
        prompt: content.prompt,
        materials: content.materials,
        standard_instruction: content.standard_instruction,
        correct_response: content.correct_response,
        scoring_points: content.scoring_points,
        allowed_support: content.allowed_support,
        termination_condition: content.termination_condition,
        system_log_indicators: content.system_log_indicators,
        evidence_type: content.evidence_type,
        validity_boundary: content.validity_boundary,
        adjustment: null,
        professional_review_required: null,
        candidate_status: null,
        notes: content.notes ?? null
      }
    }
  }).sort((left, right) => left.question_id.localeCompare(right.question_id))
}

export function loadBaseAbilityRowsFromWorkbook(projectRoot) {
  const sourcePath = join(projectRoot, 'doc', 'reference', '通用基础能力正式测评候选题库_v0.2-软件优先版.xlsx')
  if (!existsSync(sourcePath)) throw new Error(`[base-ability-source] workbook not found: ${sourcePath}`)
  return parseWorkbookRows(sourcePath)
    .map((cells, index) => ({ cells, sourceRow: index + 1 }))
    .filter(({ cells }) => cells[0]?.startsWith('GA-'))
    .map(({ cells, sourceRow }) => workbookRecord(cells, sourceRow))
    .sort((left, right) => left.question_id.localeCompare(right.question_id))
}

export async function assertWorkbookMatchesSql(projectRoot) {
  const workbookRows = loadBaseAbilityRowsFromWorkbook(projectRoot)
  const sqlRows = await loadBaseAbilityRowsFromSql(projectRoot)
  if (workbookRows.length !== sqlRows.length) {
    throw new Error(`[base-ability-source] workbook/SQL count mismatch: ${workbookRows.length}/${sqlRows.length}`)
  }

  const sqlById = new Map(sqlRows.map((row) => [row.question_id, row]))
  const checkedFields = [
    'sub_dimension',
    'presentation_way',
    'interaction_type',
    'materials',
    'standard_instruction',
    'correct_response',
    'scoring_points',
    'allowed_support',
    'termination_condition',
    'system_log_indicators',
    'evidence_type',
    'validity_boundary'
  ]

  for (const workbookRow of workbookRows) {
    const sqlRow = sqlById.get(workbookRow.question_id)
    if (!sqlRow) throw new Error(`[base-ability-source] ${workbookRow.question_id} is absent from derived SQL`)
    for (const field of ['job_code', 'bank_domain', 'module_type', 'job_module_code', 'question_type', 'item_usage', 'difficulty_level', 'status']) {
      if (sqlRow[field] !== workbookRow[field]) {
        throw new Error(`[base-ability-source] ${workbookRow.question_id}.${field} mismatches workbook`)
      }
    }
    const content = JSON.parse(sqlRow.content_json)
    const sqlValues = {
      sub_dimension: content.sub_dimension,
      presentation_way: content.presentation_way,
      interaction_type: content.interaction_type,
      materials: content.materials,
      standard_instruction: content.standard_instruction,
      correct_response: content.correct_response,
      scoring_points: content.scoring_points,
      allowed_support: content.allowed_support,
      termination_condition: content.termination_condition,
      system_log_indicators: content.system_log_indicators,
      evidence_type: content.evidence_type,
      validity_boundary: content.validity_boundary
    }
    const workbookValues = {
      ...workbookRow.raw,
      interaction_type: workbookRow.raw.interaction_label
    }
    for (const field of checkedFields) {
      if (sqlValues[field] !== workbookValues[field]) {
        throw new Error(`[base-ability-source] ${workbookRow.question_id}.${field} mismatches derived SQL`)
      }
    }
    if (content.source?.source_trace !== workbookRow.source.source_trace) {
      throw new Error(`[base-ability-source] ${workbookRow.question_id}.source_trace mismatches derived SQL`)
    }
  }
  return { workbookRows, sqlRows }
}
