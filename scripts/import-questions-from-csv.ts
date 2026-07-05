#!/usr/bin/env tsx
/**
 * 题库 CSV 导入脚本
 * 用法: tsx scripts/import-questions-from-csv.ts <csv-file-path>
 *
 * CSV 格式：
 * question_id,job_code,module_type,topic_module,question_type,difficulty_level,
 * prompt,opt_a,opt_b,opt_c,correct_answer,drag_items_json,drop_zones_json,
 * offline_tool_brief,rubric_json,media_brief,assessment_point,ability_tags,
 * safety_sensitive,source_ref,notes,status
 */

import fs from 'fs'
import path from 'path'
import Database from 'better-sqlite3'

interface CSVRow {
  question_id: string
  job_code: string
  module_type: string
  topic_module: string
  question_type: string
  difficulty_level: string
  prompt: string
  opt_a: string
  opt_b: string
  opt_c: string
  correct_answer: string
  drag_items_json: string
  drop_zones_json: string
  offline_tool_brief: string
  rubric_json: string
  media_brief: string
  assessment_point: string
  ability_tags: string
  safety_sensitive: string
  source_ref: string
  notes: string
  status: string
}

function parseCSV(filePath: string): CSVRow[] {
  const content = fs.readFileSync(filePath, 'utf-8')
  const lines = content.trim().split('\n')
  const header = lines[0].split(',')

  return lines.slice(1).map(line => {
    // 简单 CSV 解析（不处理引号内逗号，实际使用需要更健壮的解析）
    const values = line.split(',')
    const row: any = {}
    header.forEach((key, i) => {
      row[key.trim()] = values[i]?.trim() || ''
    })
    return row as CSVRow
  })
}

function buildContentJson(row: CSVRow): string {
  const base = {
    prompt: row.prompt,
    assessment_point: row.assessment_point,
    ability_tags: row.ability_tags.split('|').filter(Boolean),
    media_brief: row.media_brief || undefined,
    note: row.notes || undefined,
    source: row.source_ref ? {
      import_batch_id: 'batch_20260704_001',
      source_file: 'questions_v3.csv',
      source_row: parseInt(row.source_ref.replace(/[^\d]/g, '')),
      imported_at: new Date().toISOString(),
      imported_by: 'system_import'
    } : undefined
  }

  switch (row.question_type) {
    case 'SINGLE_CHOICE': {
      const options = []
      if (row.opt_a) options.push({ key: 'A', text: row.opt_a })
      if (row.opt_b) options.push({ key: 'B', text: row.opt_b })
      if (row.opt_c) options.push({ key: 'C', text: row.opt_c })

      return JSON.stringify({
        question_type: 'SINGLE_CHOICE',
        ...base,
        options,
        expected_answer: row.correct_answer
      })
    }

    case 'TRUE_FALSE': {
      return JSON.stringify({
        question_type: 'TRUE_FALSE',
        ...base,
        expected_answer: row.correct_answer === 'TRUE' || row.correct_answer === '✓'
      })
    }

    case 'DRAG': {
      const dragItems = row.drag_items_json ? JSON.parse(row.drag_items_json) : []
      const dropZones = row.drop_zones_json ? JSON.parse(row.drop_zones_json) : []

      return JSON.stringify({
        question_type: 'DRAG',
        ...base,
        drag_items: dragItems,
        drop_zones: dropZones,
        scoring_mode: 'PARTIAL_CREDIT'
      })
    }

    case 'OFFLINE_OPERATION': {
      const rubric = row.rubric_json ? JSON.parse(row.rubric_json) : []

      return JSON.stringify({
        question_type: 'OFFLINE_OPERATION',
        ...base,
        offline_tool_brief: row.offline_tool_brief,
        rubric_criteria: rubric
      })
    }

    default:
      throw new Error(`Unknown question_type: ${row.question_type}`)
  }
}

function buildScoringRuleJson(questionType: string): string {
  switch (questionType) {
    case 'SINGLE_CHOICE':
    case 'TRUE_FALSE':
      return JSON.stringify({
        scoring_type: 'EXACT_MATCH',
        max_score: 2,
        correct_score: 2,
        incorrect_score: 0
      })

    case 'DRAG':
      return JSON.stringify({
        scoring_type: 'DRAG_PARTIAL',
        max_score: 2,
        all_correct_score: 2,
        partial_correct_score: 0,
        incorrect_score: 0
      })

    case 'OFFLINE_OPERATION':
      return JSON.stringify({
        scoring_type: 'RUBRIC_BASED',
        max_score: 2,
        score_0_description: '未能完成',
        score_1_description: '部分完成',
        score_2_description: '完全达标'
      })

    default:
      throw new Error(`Unknown question_type: ${questionType}`)
  }
}

function main() {
  const csvPath = process.argv[2]
  if (!csvPath) {
    console.error('Usage: tsx scripts/import-questions-from-csv.ts <csv-file-path>')
    process.exit(1)
  }

  const dbPath = path.join(__dirname, '../xc-career-guide.db')
  const db = new Database(dbPath)

  console.log(`Parsing CSV: ${csvPath}`)
  const rows = parseCSV(csvPath)
  console.log(`Found ${rows.length} rows`)

  const insertStmt = db.prepare(`
    INSERT INTO question_bank (
      question_id, job_code, module_type, question_type, difficulty_level,
      content_json, scoring_rule_json, safety_sensitive, status, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `)

  let imported = 0
  let skipped = 0

  for (const row of rows) {
    try {
      const contentJson = buildContentJson(row)
      const scoringRuleJson = buildScoringRuleJson(row.question_type)
      const safetySensitive = row.safety_sensitive === '1' ? 1 : 0
      const status = row.status || 'ACTIVE'

      insertStmt.run(
        row.question_id,
        row.job_code,
        row.module_type,
        row.question_type,
        parseInt(row.difficulty_level),
        contentJson,
        scoringRuleJson,
        safetySensitive,
        status
      )

      imported++
      console.log(`✓ ${row.question_id}`)
    } catch (err: any) {
      console.error(`✗ ${row.question_id}: ${err.message}`)
      skipped++
    }
  }

  db.close()
  console.log(`\nImport complete: ${imported} imported, ${skipped} skipped`)
}

main()
