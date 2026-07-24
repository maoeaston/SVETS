import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import initSqlJs from 'sql.js'

const MODULE_TYPES = [
  'FINE_MOTOR',
  'COGNITION',
  'RULE_EXECUTION',
  'EMOTION_REGULATION',
  'BASIC_SOCIAL',
  'SAFETY_OPERATION'
]

const ONLINE_QUESTION_TYPES = ['TRUE_FALSE', 'SINGLE_CHOICE', 'DRAG', 'SOFTWARE_TASK']
const EXPECTED_TOTAL = 96
const EXPECTED_ONLINE_CANDIDATES = 87
const EXPECTED_OFFLINE_CANDIDATES = 8
const EXPECTED_OBSERVATION_ONLY = 1
const REQUIRED_ONLINE_PER_MODULE = 7
const GENERATED_AT = '2026-07-22T17:30:00+08:00'

let sqlPromise

function ensureSqlJs(projectRoot) {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({
      locateFile: (file) => join(projectRoot, 'node_modules', 'sql.js', 'dist', file)
    })
  }
  return sqlPromise
}

function fileSha256(projectRoot, relativePath) {
  const path = join(projectRoot, relativePath)
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`
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

function safeJson(value) {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function increment(object, key) {
  object[key] = (object[key] ?? 0) + 1
}

function emptyModuleSummary() {
  return Object.fromEntries(
    MODULE_TYPES.map((moduleType) => [
      moduleType,
      {
        total: 0,
        online_candidates: 0,
        offline_candidates: 0,
        observation_only: 0,
        active_online: 0,
        active_offline: 0
      }
    ])
  )
}

function gate(gate_id, status, details) {
  return { gate_id, status, details }
}

export async function buildBaseAbilityGate(projectRoot) {
  const rows = await loadBaseAbilityRowsFromSql(projectRoot)
  const modules = emptyModuleSummary()
  const questionTypeCounts = {}
  const statusCounts = {}
  const issues = []

  for (const row of rows) {
    increment(questionTypeCounts, row.question_type)
    increment(statusCounts, row.status)
    if (modules[row.module_type]) modules[row.module_type].total += 1

    if (row.item_usage === 'OBSERVATION_ONLY') {
      if (modules[row.module_type]) modules[row.module_type].observation_only += 1
      continue
    }

    if (row.item_usage !== 'SCORED_ITEM') continue

    if (ONLINE_QUESTION_TYPES.includes(row.question_type)) {
      if (modules[row.module_type]) {
        modules[row.module_type].online_candidates += 1
        if (row.status === 'ACTIVE') modules[row.module_type].active_online += 1
      }
      continue
    }

    if (row.question_type === 'OFFLINE_OPERATION' && modules[row.module_type]) {
      modules[row.module_type].offline_candidates += 1
      if (row.status === 'ACTIVE') modules[row.module_type].active_offline += 1
    }
  }

  const onlineCandidateTotal = Object.values(modules).reduce((sum, item) => sum + item.online_candidates, 0)
  const offlineCandidateTotal = Object.values(modules).reduce((sum, item) => sum + item.offline_candidates, 0)
  const observationOnlyTotal = Object.values(modules).reduce((sum, item) => sum + item.observation_only, 0)
  const activeTotal = rows.filter((row) => row.status === 'ACTIVE').length
  const draftTotal = rows.filter((row) => row.status === 'DRAFT').length
  const noScoreTotal = rows.filter((row) => {
    const scoring = safeJson(row.scoring_rule_json)
    return scoring?.scoring_type === 'NO_SCORE' && scoring?.scoring_mode === 'NONE'
  }).length
  const mediaBoundTotal = rows.filter((row) => row.media_asset_id).length
  const toolBoundTotal = rows.filter((row) => row.tool_asset_ids_json).length

  for (const row of rows) {
    if (row.bank_domain !== 'BASE_ABILITY') issues.push(`${row.question_id}: bank_domain must be BASE_ABILITY`)
    if (row.job_module_code !== null) issues.push(`${row.question_id}: job_module_code must be NULL`)
    if (!MODULE_TYPES.includes(row.module_type)) issues.push(`${row.question_id}: invalid module_type ${row.module_type}`)
  }
  for (const [moduleType, summary] of Object.entries(modules)) {
    if (summary.online_candidates < REQUIRED_ONLINE_PER_MODULE) {
      issues.push(`${moduleType}: online candidates ${summary.online_candidates}/${REQUIRED_ONLINE_PER_MODULE}`)
    }
  }

  const candidateSupplyPassed =
    rows.length === EXPECTED_TOTAL
    && onlineCandidateTotal === EXPECTED_ONLINE_CANDIDATES
    && offlineCandidateTotal === EXPECTED_OFFLINE_CANDIDATES
    && observationOnlyTotal === EXPECTED_OBSERVATION_ONLY
    && issues.length === 0

  const sourcePath = 'doc/reference/通用基础能力正式测评候选题库_v0.2-软件优先版.xlsx'
  const importSqlPath = 'doc/features/question-bank-import-base-ability-v02.sql'
  const gates = [
    gate('source_and_import_contract', candidateSupplyPassed ? 'PASSED' : 'FAILED', {
      expected_total: EXPECTED_TOTAL,
      actual_total: rows.length,
      import_sql_path: importSqlPath,
      source_path: sourcePath
    }),
    gate('bank_domain_isolation', issues.length === 0 ? 'PASSED' : 'FAILED', {
      required_bank_domain: 'BASE_ABILITY',
      issues
    }),
    gate('candidate_supply_42plus8', candidateSupplyPassed ? 'PASSED' : 'FAILED', {
      required_online_total: 42,
      online_candidate_total: onlineCandidateTotal,
      required_offline_total: EXPECTED_OFFLINE_CANDIDATES,
      offline_candidate_total: offlineCandidateTotal,
      observation_only_total: observationOnlyTotal,
      required_online_per_module: REQUIRED_ONLINE_PER_MODULE
    }),
    gate('active_question_status', activeTotal >= 50 ? 'PASSED' : 'BLOCKED', {
      active_total: activeTotal,
      draft_total: draftTotal,
      rule: '96 条候选题当前保持 DRAFT；未完成审核、素材、评分和试测前不得批量 ACTIVE'
    }),
    gate('scoring_contract', noScoreTotal === 0 ? 'PASSED' : 'BLOCKED', {
      no_score_total: noScoreTotal,
      rule: '当前 SQL 仍为 NO_SCORE 占位；正式施测前需补线上答案键和线下 0/1/2 评分锚点'
    }),
    gate('renderer_asset_material_gate', 'PENDING', {
      media_asset_bound_total: mediaBoundTotal,
      tool_asset_bound_total: toolBoundTotal,
      rule: 'DRAG / SOFTWARE_TASK 需要 renderer 或交互资源；8 道 OFFLINE_OPERATION 需要标准教具和教师评分说明'
    }),
    gate('professional_review_gate', 'PENDING', {
      rule: '需要专业人员确认构念、权重、线下评分锚点、安全与感官适配'
    }),
    gate('classroom_trial_gate', 'PENDING', {
      rule: '基础能力结果当前定位为教学诊断试测；正式解释阈值前需要课堂试测证据'
    })
  ]

  return {
    '$schema': './base-ability-42plus8-activation-gate-v1.schema.json',
    schema_version: 'base-ability-42plus8-activation-gate-v1',
    gate_id: 'base-ability-42plus8-activation-gate-2026-07-22',
    status: 'BLOCKED_DRAFT_REVIEW_RENDERER_MATERIAL_AND_TRIAL_GATE',
    generated_at: GENERATED_AT,
    authority: {
      product_contract_path: 'doc/specs/MVP_PRD_v1.0.9-authoritative.md',
      source_path: sourcePath,
      source_sha256: existsSync(join(projectRoot, sourcePath)) ? fileSha256(projectRoot, sourcePath) : null,
      import_sql_path: importSqlPath,
      import_sql_sha256: fileSha256(projectRoot, importSqlPath),
      content_pack_path: 'scripts/config/database-content-pack.json'
    },
    summary: {
      source_question_total: rows.length,
      draft_total: draftTotal,
      active_total: activeTotal,
      online_candidate_total: onlineCandidateTotal,
      offline_candidate_total: offlineCandidateTotal,
      observation_only_total: observationOnlyTotal,
      no_score_total: noScoreTotal,
      media_asset_bound_total: mediaBoundTotal,
      tool_asset_bound_total: toolBoundTotal,
      question_type_counts: Object.fromEntries(Object.entries(questionTypeCounts).sort()),
      status_counts: Object.fromEntries(Object.entries(statusCounts).sort()),
      modules
    },
    gates,
    activation_authority_granted: false,
    activation_policy:
      '本文件只证明 96 条候选池和 42+8 供给关系；不得激活题目、不得写运行数据库、不得把结果解释为已验证标准化诊断量表。'
  }
}

export function serializeBaseAbilityGate(gateDocument) {
  return `${JSON.stringify(gateDocument, null, 2)}\n`
}

export async function writeOrCheckBaseAbilityGate(projectRoot, { check = false } = {}) {
  const outputPath = join(projectRoot, 'doc', 'features', 'base-ability-42plus8-activation-gate-v1.json')
  const document = await buildBaseAbilityGate(projectRoot)
  const content = serializeBaseAbilityGate(document)
  if (check) {
    const current = existsSync(outputPath) ? readFileSync(outputPath, 'utf8') : null
    return {
      ok: current === content,
      outputPath,
      document
    }
  }
  writeFileSync(outputPath, content, 'utf8')
  return {
    ok: true,
    outputPath,
    document
  }
}
