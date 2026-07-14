#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import initSqlJs from 'sql.js'
import { fileURLToPath } from 'node:url'
import { buildActivateEligibleSql, reviewQuestionBankRows } from './lib/question-bank-review-gate.mjs'
import { resolveDefaultDbPath } from './lib/database-path.mjs'

let sqlPromise

function ensureSqlJs() {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({
      locateFile: (file) => join(process.cwd(), 'node_modules', 'sql.js', 'dist', file)
    })
  }

  return sqlPromise
}

function parseArgs(argv) {
  const args = {
    activate: false,
    batchId: null,
    dbPath: null,
    reportPath: null
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--activate') {
      args.activate = true
      continue
    }
    if (token === '--batch') {
      args.batchId = argv[++i]
      continue
    }
    if (token === '--db') {
      args.dbPath = argv[++i]
      continue
    }
    if (token === '--report') {
      args.reportPath = argv[++i]
      continue
    }
    throw new Error(`[question-bank-review] unknown arg: ${token}`)
  }

  return args
}

function loadPackageName(projectRoot) {
  const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf-8'))
  return pkg.name
}

function queryAll(db, sql) {
  const stmt = db.prepare(sql)
  const rows = []

  try {
    while (stmt.step()) {
      rows.push(stmt.getAsObject())
    }
  } finally {
    stmt.free()
  }

  return rows
}

function extractImportBatchId(contentJsonText) {
  try {
    const content = JSON.parse(contentJsonText)
    return typeof content?.source?.import_batch_id === 'string' ? content.source.import_batch_id : null
  } catch {
    return null
  }
}

function loadDraftQuestionRows(db, batchId) {
  const rows = queryAll(
    db,
    `SELECT question_id, module_type, question_type, status, media_asset_id, tool_asset_ids_json, content_json, scoring_rule_json
     FROM question_bank
     WHERE status = 'DRAFT'
     ORDER BY question_id`
  )

  if (!batchId) {
    return rows
  }

  return rows.filter((row) => extractImportBatchId(row.content_json) === batchId)
}

function loadAssetsById(db) {
  const rows = queryAll(
    db,
    `SELECT asset_id, status
     FROM asset_resource`
  )

  return Object.fromEntries(rows.map((row) => [row.asset_id, row]))
}

function persistDatabase(db, dbPath) {
  writeFileSync(dbPath, Buffer.from(db.export()))
}

export async function runQuestionBankReviewCli(
  argv,
  io = { stdout: (line) => console.log(line), stderr: (line) => console.error(line) }
) {
  const projectRoot = fileURLToPath(new URL('..', import.meta.url))
  const appName = loadPackageName(projectRoot)
  const args = parseArgs(argv)
  const dbPath =
    args.dbPath ??
    resolveDefaultDbPath({
      platform: process.platform,
      homeDir: homedir(),
      appName
    })
  const reportPath = args.reportPath ?? join(projectRoot, 'doc', 'features', 'question-bank-review-report.json')

  if (!existsSync(dbPath)) {
    throw new Error(`DB file not found: ${dbPath}`)
  }

  const SQL = await ensureSqlJs()
  const db = new SQL.Database(readFileSync(dbPath))

  try {
    const questionRows = loadDraftQuestionRows(db, args.batchId)
    const report = reviewQuestionBankRows(questionRows, {
      assetsById: loadAssetsById(db)
    })

    writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf-8')
    io.stdout(
      `[question-bank-review] checked ${report.checked} DRAFT questions; eligible ${report.eligible}; blocked ${report.blocked}`
    )
    io.stdout(`[question-bank-review] report written to ${reportPath}`)

    if (!args.activate) {
      io.stdout('[question-bank-review] dry run only; DB unchanged')
      return { dbPath, reportPath, report, activated: 0 }
    }

    db.exec(buildActivateEligibleSql(report.items))
    persistDatabase(db, dbPath)
    io.stdout(`[question-bank-review] activated ${report.eligible} questions`)

    return { dbPath, reportPath, report, activated: report.eligible }
  } finally {
    db.close()
  }
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url)

if (isDirectRun) {
  runQuestionBankReviewCli(process.argv.slice(2)).catch((error) => {
    console.error(`[question-bank-review] ${error.message}`)
    process.exit(1)
  })
}
