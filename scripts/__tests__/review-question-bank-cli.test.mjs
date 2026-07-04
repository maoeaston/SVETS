import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import initSqlJs from 'sql.js'
import { describe, expect, it } from 'vitest'

let sqlPromise

function getSqlJs() {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({
      locateFile: (file) => join(process.cwd(), 'node_modules', 'sql.js', 'dist', file)
    })
  }
  return sqlPromise
}

function buildTrueFalseRow(overrides = {}) {
  return {
    question_id: 'Q_BASE_SAFETY_OPERATION_TF_001',
    module_type: 'SAFETY_OPERATION',
    question_type: 'TRUE_FALSE',
    status: 'DRAFT',
    media_asset_id: 'asset_img_safety_001',
    tool_asset_ids_json: null,
    content_json: JSON.stringify({
      question_type: 'TRUE_FALSE',
      prompt: '图中的开箱动作是否安全？',
      expected_answer: true,
      assessment_point: '安全开箱动作识别',
      ability_tags: ['SAFETY_OPERATION'],
      source: {
        import_batch_id: 'batch_20260704_001',
        source_file: '通用基础能力评估题库.xlsx',
        source_row: 12,
        imported_at: '2026-07-04T01:00:00.000Z',
        imported_by: 'codex'
      }
    }),
    scoring_rule_json: JSON.stringify({
      scoring_type: 'EXACT_MATCH',
      max_score: 2,
      correct_score: 2,
      incorrect_score: 0
    }),
    ...overrides
  }
}

async function createTempDb() {
  const SQL = await getSqlJs()
  const dir = mkdtempSync(join(tmpdir(), 'question-bank-review-'))
  const dbPath = join(dir, 'xc-career-guide.db')
  const db = new SQL.Database()

  db.exec(`
    CREATE TABLE asset_resource (
      asset_id TEXT PRIMARY KEY,
      status TEXT NOT NULL
    );

    CREATE TABLE question_bank (
      question_id TEXT PRIMARY KEY,
      module_type TEXT NOT NULL,
      question_type TEXT NOT NULL,
      status TEXT NOT NULL,
      media_asset_id TEXT,
      tool_asset_ids_json TEXT,
      content_json TEXT NOT NULL,
      scoring_rule_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)

  return { dir, dbPath, db }
}

function seedReviewRows(db) {
  db.run(`INSERT INTO asset_resource (asset_id, status) VALUES (?, ?)`, ['asset_img_safety_001', 'ACTIVE'])

  const insertQuestionSql = `
    INSERT INTO question_bank (
      question_id,
      module_type,
      question_type,
      status,
      media_asset_id,
      tool_asset_ids_json,
      content_json,
      scoring_rule_json
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?
    )
  `

  const insertQuestion = (row) =>
    db.run(insertQuestionSql, [
      row.question_id,
      row.module_type,
      row.question_type,
      row.status,
      row.media_asset_id,
      row.tool_asset_ids_json,
      row.content_json,
      row.scoring_rule_json
    ])

  insertQuestion(buildTrueFalseRow())
  insertQuestion(
    buildTrueFalseRow({
      question_id: 'Q_BASE_SAFETY_OPERATION_TF_002',
      media_asset_id: 'asset_missing_001'
    })
  )
  insertQuestion(
    buildTrueFalseRow({
      question_id: 'Q_BASE_SAFETY_OPERATION_TF_003',
      content_json: JSON.stringify({
        question_type: 'TRUE_FALSE',
        prompt: '另一批次题目',
        expected_answer: false,
        assessment_point: '安全开箱动作识别',
        ability_tags: ['SAFETY_OPERATION'],
        source: {
          import_batch_id: 'batch_20260704_999',
          source_file: '通用基础能力评估题库.xlsx',
          source_row: 18,
          imported_at: '2026-07-04T01:00:00.000Z',
          imported_by: 'codex'
        }
      })
    })
  )
}

function persistDb(db, dbPath) {
  writeFileSync(dbPath, Buffer.from(db.export()))
}

async function readStatuses(dbPath) {
  const SQL = await getSqlJs()
  const db = new SQL.Database(readFileSync(dbPath))
  const result = db.exec(`SELECT question_id, status FROM question_bank ORDER BY question_id`)
  db.close()

  return result[0].values.map(([question_id, status]) => ({
    question_id,
    status
  }))
}

async function loadCliModule() {
  return import(new URL('../review-question-bank.mjs', import.meta.url))
}

function createRecorder() {
  const lines = []
  return {
    lines,
    stdout(message) {
      lines.push(String(message))
    },
    stderr(message) {
      lines.push(String(message))
    }
  }
}

describe('review-question-bank CLI', () => {
  it('按 batch 生成审核报告且默认不改 DB', async () => {
    const { db, dbPath, dir } = await createTempDb()
    seedReviewRows(db)
    persistDb(db, dbPath)
    db.close()
    const reportPath = join(dir, 'report.json')
    const recorder = createRecorder()
    const { runQuestionBankReviewCli } = await loadCliModule()

    await runQuestionBankReviewCli(
      ['--db', dbPath, '--batch', 'batch_20260704_001', '--report', reportPath],
      recorder
    )
    const report = JSON.parse(readFileSync(reportPath, 'utf-8'))

    expect(recorder.lines.join('\n')).toMatch(/checked 2 DRAFT questions/i)
    expect(report).toMatchObject({
      checked: 2,
      eligible: 1,
      blocked: 1
    })
    expect(report.items.map((item) => item.question_id)).toEqual([
      'Q_BASE_SAFETY_OPERATION_TF_001',
      'Q_BASE_SAFETY_OPERATION_TF_002'
    ])

    const statuses = await readStatuses(dbPath)

    expect(statuses).toEqual([
      { question_id: 'Q_BASE_SAFETY_OPERATION_TF_001', status: 'DRAFT' },
      { question_id: 'Q_BASE_SAFETY_OPERATION_TF_002', status: 'DRAFT' },
      { question_id: 'Q_BASE_SAFETY_OPERATION_TF_003', status: 'DRAFT' }
    ])
  })

  it('--activate 只激活指定 batch 的合格 DRAFT 题', async () => {
    const { db, dbPath, dir } = await createTempDb()
    seedReviewRows(db)
    persistDb(db, dbPath)
    db.close()
    const reportPath = join(dir, 'report-activate.json')
    const recorder = createRecorder()
    const { runQuestionBankReviewCli } = await loadCliModule()

    await runQuestionBankReviewCli(
      ['--db', dbPath, '--batch', 'batch_20260704_001', '--activate', '--report', reportPath],
      recorder
    )
    const report = JSON.parse(readFileSync(reportPath, 'utf-8'))

    expect(recorder.lines.join('\n')).toMatch(/activated 1 questions/i)
    expect(report).toMatchObject({
      checked: 2,
      eligible: 1,
      blocked: 1
    })

    const statuses = await readStatuses(dbPath)

    expect(statuses).toEqual([
      { question_id: 'Q_BASE_SAFETY_OPERATION_TF_001', status: 'ACTIVE' },
      { question_id: 'Q_BASE_SAFETY_OPERATION_TF_002', status: 'DRAFT' },
      { question_id: 'Q_BASE_SAFETY_OPERATION_TF_003', status: 'DRAFT' }
    ])
  })
})
