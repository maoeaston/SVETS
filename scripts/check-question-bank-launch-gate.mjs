#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import initSqlJs from 'sql.js'
import { fileURLToPath } from 'node:url'
import { checkQuestionBankLaunchGate } from './lib/question-bank-launch-gate.mjs'
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
    dbPath: null,
    jobCode: 'SUPERMARKET_SHELVER',
    reportPath: null
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--db') {
      args.dbPath = argv[++i]
      continue
    }
    if (token === '--job') {
      args.jobCode = argv[++i]
      continue
    }
    if (token === '--report') {
      args.reportPath = argv[++i]
      continue
    }
    throw new Error(`[question-bank-launch-gate] unknown arg: ${token}`)
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

function loadQuestionBankRows(db, jobCode) {
  const escapedJobCode = String(jobCode).replace(/'/g, "''")
  return queryAll(
    db,
    `SELECT question_id, job_code, module_type, question_type, status, content_json
     FROM question_bank
     WHERE job_code = '${escapedJobCode}'
     ORDER BY question_id`
  )
}

function formatIssues(issues) {
  if (issues.length === 0) {
    return ['[question-bank-launch-gate] PASS']
  }

  return issues.map((issue) => {
    if (issue.code === 'ONLINE_MODULE_INSUFFICIENT') {
      return `[question-bank-launch-gate] FAIL ${issue.moduleType} online ACTIVE ${issue.actual}/${issue.required} (missing ${issue.missing})`
    }
    if (issue.code === 'OFFLINE_OPERATION_INSUFFICIENT') {
      return `[question-bank-launch-gate] FAIL OFFLINE_OPERATION ACTIVE ${issue.actual}/${issue.required} (missing ${issue.missing})`
    }
    if (issue.code === 'OFFLINE_ABILITY_TAGS_REQUIRED') {
      return `[question-bank-launch-gate] FAIL ${issue.questionId} missing content_json.ability_tags`
    }
    if (issue.code === 'OFFLINE_CONTENT_JSON_INVALID') {
      return `[question-bank-launch-gate] FAIL ${issue.questionId} content_json invalid: ${issue.reason}`
    }
    return `[question-bank-launch-gate] FAIL ${JSON.stringify(issue)}`
  })
}

export async function runQuestionBankLaunchGateCli(
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
  const reportPath = args.reportPath ?? join(projectRoot, 'doc', 'features', 'question-bank-launch-gate-report.json')

  if (!existsSync(dbPath)) {
    throw new Error(`DB file not found: ${dbPath}`)
  }

  const SQL = await ensureSqlJs()
  const db = new SQL.Database(readFileSync(dbPath))

  try {
    const rows = loadQuestionBankRows(db, args.jobCode)
    const report = checkQuestionBankLaunchGate(rows, {
      jobCode: args.jobCode
    })

    writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf-8')
    io.stdout(
      `[question-bank-launch-gate] checked ${report.summary.totalRows} rows for ${args.jobCode}; offline ACTIVE ${report.summary.offlineActive}`
    )
    for (const line of formatIssues(report.issues)) {
      if (report.passed) {
        io.stdout(line)
      } else {
        io.stderr(line)
      }
    }
    io.stdout(`[question-bank-launch-gate] report written to ${reportPath}`)

    return {
      dbPath,
      reportPath,
      report,
      exitCode: report.passed ? 0 : 1
    }
  } finally {
    db.close()
  }
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url)

if (isDirectRun) {
  runQuestionBankLaunchGateCli(process.argv.slice(2))
    .then(({ exitCode }) => {
      if (exitCode !== 0) {
        process.exit(exitCode)
      }
    })
    .catch((error) => {
      console.error(`[question-bank-launch-gate] ${error.message}`)
      process.exit(1)
    })
}
