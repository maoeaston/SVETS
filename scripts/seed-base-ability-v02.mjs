#!/usr/bin/env node
/**
 * 从 doc/reference/通用基础能力正式测评候选题库_v0.2-软件优先版.xlsx sheet2
 * 导入 96 条 BASE_ABILITY 题到 question_bank。
 *
 * 用法：
 *   node scripts/seed-base-ability-v02.mjs --dry-run
 *   node scripts/seed-base-ability-v02.mjs
 *   node scripts/seed-base-ability-v02.mjs --db /abs/path/to/xc-career-guide.db
 *   node scripts/seed-base-ability-v02.mjs --out /tmp/base-ability-v02.sql
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import * as fs from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

// ---- arg parsing ----
function parseArgs(argv) {
  const args = { dryRun: false, dbPath: null, outPath: null }
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]
    if (t === '--dry-run') { args.dryRun = true; continue }
    if (t === '--db')  { args.dbPath  = argv[++i]; continue }
    if (t === '--out') { args.outPath = argv[++i]; continue }
    throw new Error(`[base-ability-v02] unknown arg: ${t}`)
  }
  return args
}

// ---- xlsx parser (no deps, pure stdlib) ----
function parseXlsx(xlsxPath) {
  const tmpDir = `/tmp/xlsx-parse-${Date.now()}`
  fs.mkdirSync(tmpDir, { recursive: true })
  execFileSync('unzip', ['-q', xlsxPath, '-d', tmpDir])

  const ss = []
  const ssPath = join(tmpDir, 'xl', 'sharedStrings.xml')
  if (existsSync(ssPath)) {
    const xml = readFileSync(ssPath, 'utf-8')
    for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)) {
      ss.push(m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"))
    }
  }

  function readSheet(idx) {
    const xml = readFileSync(join(tmpDir, 'xl', 'worksheets', `sheet${idx}.xml`), 'utf-8')
    const rows = []
    // support both prefixed (x:row) and unprefixed (row) elements
    for (const rowMatch of xml.matchAll(/<(?:x:)?row\b[^>]*>([\s\S]*?)<\/(?:x:)?row>/g)) {
      const cells = []
      for (const cMatch of rowMatch[1].matchAll(/<(?:x:)?c\b([^>]*)>([\s\S]*?)<\/(?:x:)?c>/g)) {
        const attr = cMatch[1]; const inner = cMatch[2]
        const vMatch = inner.match(/<(?:x:)?v>([^<]*)<\/(?:x:)?v>/)
        const val = vMatch ? vMatch[1] : ''
        // t="str" means inline string; t="s" means shared string index
        if (/t="s"/.test(attr)) {
          cells.push(ss[parseInt(val)] ?? '')
        } else {
          cells.push(val)
        }
      }
      rows.push(cells)
    }
    return rows
  }

  function cleanup() { execFileSync('rm', ['-rf', tmpDir]) }

  return { readSheet, cleanup }
}

// ---- mappings ----
const MODULE_MAP = {
  '精细动作能力': 'FINE_MOTOR',
  '认知理解能力': 'COGNITION',
  '规则执行能力': 'RULE_EXECUTION',
  '情绪调节能力': 'EMOTION_REGULATION',
  '基础社交能力': 'BASIC_SOCIAL',
  '安全操作能力': 'SAFETY_OPERATION',
}

const DIFFICULTY_MAP = { '基础': 1, '中等': 2, '较高': 3 }

// 含拖拽交互类型的关键字
const DRAG_KEYWORDS = ['拖拽', '拖放', '拖']

function deriveQuestionType(presentationWay, interactionType) {
  const isDrag = DRAG_KEYWORDS.some(k => interactionType.includes(k))
  switch (presentationWay) {
    case '实物操作': return 'OFFLINE_OPERATION'
    case '屏幕图片':
    case '屏幕场景':
    case '屏幕分支情境':
      return isDrag ? 'DRAG' : 'SINGLE_CHOICE'
    case '屏幕任务':
    case '屏幕多点触控':
    case '屏幕模拟':
      return isDrag ? 'DRAG' : 'SOFTWARE_TASK'
    default:
      // 屏幕互动/屏幕音频互动/屏幕虚拟互动/屏幕自我报告/屏幕自我表达/屏幕引导/系统嵌入观察
      return 'SOFTWARE_TASK'
  }
}

function deriveItemUsage(presentationWay) {
  return presentationWay === '系统嵌入观察' ? 'OBSERVATION_ONLY' : 'SCORED_ITEM'
}

// ---- SQL helpers ----
function sqlStr(v) {
  if (v === null || v === undefined) return 'NULL'
  return `'${String(v).replace(/'/g, "''")}'`
}

// ---- main ----
const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf-8'))
const args = parseArgs(process.argv.slice(2))

const dbPath = args.dbPath ?? join(homedir(), '.config', pkg.name, 'data', `${pkg.name}.db`)
const outPath = args.outPath ?? join(projectRoot, 'doc', 'features', 'question-bank-import-base-ability-v02.sql')
const xlsxPath = join(projectRoot, 'doc', 'reference', '通用基础能力正式测评候选题库_v0.2-软件优先版.xlsx')

if (!existsSync(xlsxPath)) {
  console.error(`[base-ability-v02] xlsx not found: ${xlsxPath}`)
  process.exit(1)
}

const { readSheet, cleanup } = parseXlsx(xlsxPath)
const rows = readSheet(2)
cleanup()
// sheet2: row1=title, row2=note, row3=empty, row4=header, row5+=data
// filter by first cell starting with 'GA-'
const dataRows = rows.filter(r => r[0] && r[0].startsWith('GA-'))

const importedAt = new Date().toISOString()
const importBatchId = 'batch_base_ability_v02'

const inserts = []
const warnings = []

for (const r of dataRows) {
  const [
    questionId,   // 0 题目ID
    moduleLabel,  // 1 模块
    subDim,       // 2 子维度
    presentWay,   // 3 呈现方式
    interType,    // 4 交互类型
    _digitalLevel,// 5 数字化等级
    diffLabel,    // 6 预期难度
    construct,    // 7 目标构念
    task,         // 8 测评任务
    materials,    // 9 软件界面/标准材料
    instruction,  // 10 标准施测指令
    correctResp,  // 11 达标行为/正确反应
    scoringPoints,// 12 核心评分点
    support,      // 13 允许的标准支持
    termination,  // 14 终止/安全条件
    sysLog,       // 15 系统记录指标
    evidenceType, // 16 证据类型
    validity,     // 17 效度边界
    sourceTrace,  // 18 来源追溯
    adjustment,   // 19 调整方式
    needsReview,  // 20 需专业确认
    status,       // 21 候选状态
    notes,        // 22 备注
  ] = r

  const moduleType = MODULE_MAP[moduleLabel]
  if (!moduleType) {
    warnings.push(`[WARN] ${questionId}: unknown module "${moduleLabel}", skipping`)
    continue
  }

  const questionType = deriveQuestionType(presentWay, interType)
  const itemUsage = deriveItemUsage(presentWay)
  const difficultyLevel = DIFFICULTY_MAP[diffLabel] ?? 1
  const safetySensitive = moduleLabel === '安全操作能力' ? 1 : 0

  const contentJson = JSON.stringify({
    schema_version: 'question-content-v1.2',
    question_type: questionType,
    prompt: task,
    assessment_point: construct,
    sub_dimension: subDim,
    presentation_way: presentWay,
    interaction_type: interType,
    materials,
    standard_instruction: instruction,
    correct_response: correctResp,
    scoring_points: scoringPoints,
    allowed_support: support,
    termination_condition: termination,
    system_log_indicators: sysLog,
    evidence_type: evidenceType,
    validity_boundary: validity,
    source: {
      import_batch_id: importBatchId,
      source_file: '通用基础能力正式测评候选题库_v0.2-软件优先版.xlsx',
      source_trace: sourceTrace,
      imported_at: importedAt,
      imported_by: 'seed-base-ability-v02',
    },
    notes: notes || undefined,
  })

  // DRAFT — 全量候选状态，待试测后升为 ACTIVE
  const scoringRuleJson = JSON.stringify({ scoring_type: 'NO_SCORE', scoring_mode: 'NONE' })

  inserts.push(
    `INSERT INTO question_bank(` +
    `question_id,job_code,bank_domain,module_type,job_module_code,question_type,item_usage,` +
    `difficulty_level,content_json,scoring_rule_json,media_asset_id,tool_asset_ids_json,` +
    `safety_sensitive,sensory_tags_json,status,version` +
    `) VALUES(` +
    `${sqlStr(questionId)},${sqlStr('SUPERMARKET_SHELVER')},${sqlStr('BASE_ABILITY')},` +
    `${sqlStr(moduleType)},NULL,${sqlStr(questionType)},${sqlStr(itemUsage)},` +
    `${difficultyLevel},${sqlStr(contentJson)},${sqlStr(scoringRuleJson)},` +
    `NULL,NULL,${safetySensitive},NULL,'DRAFT',1` +
    `) ON CONFLICT(question_id) DO UPDATE SET` +
    ` module_type=excluded.module_type,question_type=excluded.question_type,` +
    ` item_usage=excluded.item_usage,difficulty_level=excluded.difficulty_level,` +
    ` content_json=excluded.content_json,scoring_rule_json=excluded.scoring_rule_json,` +
    ` safety_sensitive=excluded.safety_sensitive,status=excluded.status,` +
    ` updated_at=datetime('now');`
  )
}

const preamble = [
  `-- Generated by scripts/seed-base-ability-v02.mjs`,
  `-- Source: 通用基础能力正式测评候选题库_v0.2-软件优先版.xlsx sheet2`,
  `-- Generated at: ${importedAt}`,
  `-- Replaces old BASE_ABILITY data from 通用基础能力评估题库.xlsx (旧版已废弃)`,
  `-- Step 1: delete stale BASE_ABILITY rows (from old xlsx + old drag seed)`,
  `DELETE FROM question_bank WHERE bank_domain='BASE_ABILITY';`,
]

const sql = [...preamble, 'BEGIN;', ...inserts, 'COMMIT;'].join('\n')

writeFileSync(outPath, sql + '\n', 'utf-8')

if (warnings.length) warnings.forEach(w => console.warn(w))
console.log(`[base-ability-v02] ${inserts.length} questions mapped, SQL written to ${outPath}`)

if (args.dryRun) {
  console.log(`[base-ability-v02] dry run only; target DB would be: ${dbPath}`)
  process.exit(0)
}

if (!existsSync(dbPath)) {
  console.error(`[base-ability-v02] DB not found: ${dbPath}`)
  process.exit(1)
}

execFileSync('sqlite3', [dbPath], { input: sql, stdio: ['pipe', 'inherit', 'inherit'] })
console.log(`[base-ability-v02] imported into ${dbPath}`)

const verifySql = `SELECT bank_domain, module_type, count(*) as n FROM question_bank WHERE bank_domain='BASE_ABILITY' GROUP BY module_type ORDER BY module_type;`
const out = execFileSync('sqlite3', [dbPath, verifySql], { encoding: 'utf-8' })
console.log(out.trimEnd())
