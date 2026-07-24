import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import vm from 'node:vm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { hashRecord, questionSemanticHash } from '../lib/job-skill-contract-hash.mjs'

const root = resolve(import.meta.dirname, '../..')
const script = resolve(root, 'scripts/build-job-skill-shelver-298-rejected-replacements-v2.mjs')
const inputs = [
  'doc/reference/专业岗位能力测评题库-M1-M6-数据库导出-298条.json',
  'doc/features/job-skill-shelver-298-rejected-11-reconsideration-cases-v1.json',
  'doc/features/job-skill-shelver-298-disposition-authority-v1.json',
  'doc/features/job-skill-shelver-298-rejected-11-content-reconsideration-result-chen-xiaoqing-2026-07-21.json'
]
const outputs = [
  'doc/features/job-skill-shelver-298-rejected-replacement-candidates-v2.json',
  'doc/features/job-skill-shelver-298-rejected-replacement-candidates-v2.md',
  'doc/features/job-skill-shelver-298-rejected-replacement-review-gate-v1.json',
  'doc/features/job-skill-shelver-298-rejected-replacement-content-confirmation-packet-chen-xiaoqing-v1.html',
  'doc/features/job-skill-shelver-298-rejected-replacement-safety-technical-review-packet-he-dong-v1.html',
  'doc/features/job-skill-shelver-298-rejected-replacement-content-confirmation-result-v1.schema.json',
  'doc/features/job-skill-shelver-298-rejected-replacement-safety-technical-review-result-v1.schema.json'
]
const expectedSourceIds = ['M1_OB_048', 'M1_OP_042', 'M3_OP_056', 'M4_OP_043', 'M4_OP_044', 'M4_OP_045', 'M4_OP_046', 'M4_OP_047', 'M4_OP_048', 'M5_OP_048', 'M5_OP_055']
let tempRoot

function copy(relative) {
  const target = resolve(tempRoot, relative)
  mkdirSync(dirname(target), { recursive: true })
  cpSync(resolve(root, relative), target)
}
function json(relative) { return JSON.parse(readFileSync(resolve(tempRoot, relative), 'utf8')) }
function run(args = ['--check']) {
  return spawnSync(process.execPath, [script, `--root=${tempRoot}`, ...args], { cwd: root, encoding: 'utf8' })
}
function embeddedPackage(relative) {
  const html = readFileSync(resolve(tempRoot, relative), 'utf8')
  const match = html.match(/<script id="package-data" type="application\/json">([\s\S]*?)<\/script>/)
  if (!match) throw new Error(`${relative} package data missing`)
  return JSON.parse(match[1])
}
function inlineScriptsCompile(relative) {
  const html = readFileSync(resolve(tempRoot, relative), 'utf8')
  expect(html).not.toMatch(/<script[^>]+src=/)
  expect(html).not.toMatch(/<link[^>]+href=/)
  const scripts = [...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)]
  expect(scripts).toHaveLength(2)
  expect(() => new vm.Script(scripts[1][1], { filename: `${relative}-inline.js` })).not.toThrow()
}

beforeEach(() => {
  tempRoot = mkdtempSync(resolve(tmpdir(), 'svets-rejected-replacements-v2-'))
  for (const relative of [...inputs, ...outputs]) copy(relative)
})
afterEach(() => rmSync(tempRoot, { recursive: true, force: true }))

describe('job skill shelver rejected replacement V2 candidates', () => {
  it('preserves 11 historical V2 candidates while the current authority records their approved replacement versions', () => {
    const candidates = json(outputs[0])
    const authority = json(inputs[2])
    expect(candidates.questions.map((item) => item.source_question_id)).toEqual(expectedSourceIds)
    expect(candidates.questions.map((item) => item.question_id)).toEqual(expectedSourceIds.map((id) => `${id}_V2`))
    expect(candidates.summary).toMatchObject({ current_retained_unchanged: 287, rejected_originals_unchanged: 11, replacement_v2_pending: 11 })
    for (const id of expectedSourceIds) {
      expect(authority.questions.find((item) => item.source_question_id === id)).toMatchObject({
        disposition: 'REPLACEMENT_REVIEW_PASSED_PENDING_ACTIVATION',
        activation_authority: 'NONE'
      })
    }
  })

  it('binds semantic and candidate hashes and keeps every candidate pending two-track review', () => {
    const candidates = json(outputs[0])
    const { candidate_set_hash: actualSetHash, ...setBody } = candidates
    expect(actualSetHash).toBe(hashRecord(setBody))
    for (const item of candidates.questions) {
      const { candidate_record_hash: actualRecordHash, ...recordBody } = item
      expect(actualRecordHash).toBe(hashRecord(recordBody))
      expect(item.new_semantic_hash).toBe(questionSemanticHash(item.proposed_question))
      expect(item.new_semantic_hash).not.toBe(item.old_semantic_hash)
      expect(item.required_review_tracks).toEqual(['CONTENT', 'SAFETY_TECHNICAL'])
      expect(item.activation_authority).toBe('NONE')
      expect(item.proposed_question.content.rubric_criteria.length).toBeGreaterThan(0)
    }
  })

  it('builds two self-contained reviewer packets that only include the 11 new V2 candidates', () => {
    const contentPacket = embeddedPackage(outputs[3])
    const safetyPacket = embeddedPackage(outputs[4])
    const expectedV2Ids = expectedSourceIds.map((id) => `${id}_V2`)

    expect(contentPacket.package_id).toBe('job-skill-shelver-298-rejected-replacement-content-confirmation-packet-chen-xiaoqing-v1')
    expect(safetyPacket.package_id).toBe('job-skill-shelver-298-rejected-replacement-safety-technical-review-packet-he-dong-v1')
    expect(contentPacket.reviewer).toEqual({ name: '陈晓青', track: 'CONTENT_CONFIRMATION', role: '内容确认' })
    expect(safetyPacket.reviewer).toEqual({ name: '赫东', track: 'SAFETY_TECHNICAL_REVIEW', role: '安全与技术审核' })
    expect(contentPacket.questions.map((item) => item.question_id)).toEqual(expectedV2Ids)
    expect(safetyPacket.questions.map((item) => item.question_id)).toEqual(expectedV2Ids)
    expect(contentPacket.questions.map((item) => item.previous_question_id)).toEqual(expectedSourceIds)
    expect(safetyPacket.questions.map((item) => item.previous_question_id)).toEqual(expectedSourceIds)
    expect(contentPacket.questions.every((item) => item.activation_authority === 'NONE')).toBe(true)
    expect(safetyPacket.questions.every((item) => item.activation_authority === 'NONE')).toBe(true)
    expect(contentPacket.authority).toMatchObject({ activation_authority_granted: false, can_activate_questions: false, runtime_database_change_allowed: false, activation_sql_generated: false })
    expect(safetyPacket.authority).toMatchObject(contentPacket.authority)
    inlineScriptsCompile(outputs[3])
    inlineScriptsCompile(outputs[4])
    const safetyHtml = readFileSync(resolve(tempRoot, outputs[4]), 'utf8')
    expect(safetyHtml).toContain("['safety_conclusion','technical_conclusion','renderer_feasibility','data_contract_integrity'].some")
  })

  it('locks exported result schemas to JSON-only review outcomes without activation authority', () => {
    const contentSchema = json(outputs[5])
    const safetySchema = json(outputs[6])

    expect(contentSchema.properties.schema_version.const).toBe('job-skill-shelver-298-rejected-replacement-content-confirmation-result-v1')
    expect(safetySchema.properties.schema_version.const).toBe('job-skill-shelver-298-rejected-replacement-safety-technical-review-result-v1')
    expect(contentSchema.properties.questions.minItems).toBe(11)
    expect(safetySchema.properties.questions.maxItems).toBe(11)
    expect(contentSchema.properties.questions.items.properties.activation_authority.const).toBe('NONE')
    expect(safetySchema.properties.authority.properties.activation_authority_granted.const).toBe(false)
    expect(contentSchema.properties.authority.properties.can_activate_questions.const).toBe(false)
  })

  it('preserves Chen Xiaoqing result identity, exact bytes, and all redesign decisions', () => {
    const candidates = json(outputs[0])
    const result = json(inputs[3])
    expect(candidates.reviewer_result_original).toEqual({ bytes: 18396, sha256: 'sha256:8260b89205a6893569aeff45954cdffdeaa5463d5cad49be95e1514fbbe0ac9e', reviewer: '陈晓青', submitted_at: '2026-07-21T02:05:47.787746Z' })
    expect(result.questions.every((item) => item.decision === 'RETURN_FOR_REDESIGN')).toBe(true)
    expect(result.summary).toEqual({ total: 11, pass_as_is: 0, return_for_redesign: 11, confirm_rejected: 0 })
  })

  it('fails closed when the reviewer original bytes change', () => {
    const path = resolve(tempRoot, inputs[3])
    writeFileSync(path, `${readFileSync(path, 'utf8')} `)
    const result = run([])
    expect(result.status).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toContain('byte count changed')
  })

  it('fails closed when a generated candidate artifact drifts', () => {
    const path = resolve(tempRoot, outputs[0])
    const value = JSON.parse(readFileSync(path, 'utf8'))
    value.questions[0].proposed_question.content.prompt = 'tampered'
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
    const result = run()
    expect(result.status).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toContain('generated artifact drift')
  })
})
