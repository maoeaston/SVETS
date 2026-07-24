import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import vm from 'node:vm'

import { describe, expect, it } from 'vitest'

import { questionSemanticHash } from '../lib/job-skill-contract-hash.mjs'

const root = resolve(import.meta.dirname, '../..')
const feature = (name, base = root) => resolve(base, `doc/features/${name}`)
const script = resolve(root, 'scripts/build-job-skill-shelver-298-targeted-v5.mjs')
const sourceNames = [
  'job-skill-shelver-298-question-revision-candidates-v4.json',
  'job-skill-shelver-298-targeted-v4-rereview-merged-gate-v1.json',
  'job-skill-shelver-298-v5-editorial-input.json'
]
const outputNames = [
  'job-skill-shelver-298-question-revision-candidates-v5.json',
  'job-skill-shelver-298-targeted-v5-content-rereview-packet-chen-xiaoqing-v1.html',
  'job-skill-shelver-298-targeted-v5-safety-technical-rereview-packet-he-dong-v1.html',
  'job-skill-shelver-298-targeted-v5-content-rereview-result-v1.schema.json',
  'job-skill-shelver-298-targeted-v5-safety-technical-rereview-result-v1.schema.json',
  'job-skill-shelver-298-targeted-v5-rereview-gate-v1.json'
]
const expectedV5Ids = ['M1_OP_037_V5', 'M1_OP_038_V5', 'M2_OP_031_V5', 'M2_OP_038_V5', 'M2_OP_041_V5', 'M5_DG_034_V5']
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')

function makeWorkspace(mutator) {
  const base = mkdtempSync(resolve(tmpdir(), 'svets-v5-'))
  mkdirSync(resolve(base, 'doc/features'), { recursive: true })
  for (const name of sourceNames) cpSync(feature(name), feature(name, base))
  if (mutator) {
    const inputPath = feature(sourceNames[2], base)
    const input = readJson(inputPath)
    mutator(input)
    writeFileSync(inputPath, `${JSON.stringify(input, null, 2)}\n`)
  }
  return base
}

function run(base, ...args) {
  return spawnSync(process.execPath, [script, `--root=${base}`, ...args], { cwd: root, encoding: 'utf8' })
}

function packageData(path) {
  const html = readFileSync(path, 'utf8')
  const match = html.match(/<script id="package-data" type="application\/json">([\s\S]*?)<\/script>/)
  if (!match) throw new Error('package data missing')
  return JSON.parse(match[1])
}

describe('job skill shelver targeted V5 failed-track contract', () => {
  it('builds exactly six V5 candidates and carries 139 passed references unchanged', () => {
    const base = makeWorkspace()
    const result = run(base)
    expect(result.status, result.stderr).toBe(0)
    const candidates = readJson(feature(outputNames[0], base))
    expect(candidates.summary).toEqual({
      source_total: 145,
      passed_reference_total: 139,
      v5_total: 6,
      content_rereview_total: 5,
      safety_technical_rereview_total: 2,
      by_type: { DRAG: 1, OFFLINE_OPERATION: 5 }
    })
    expect(candidates.questions.map((question) => question.question_id)).toEqual(expectedV5Ids)
    expect(candidates.passed_question_references).toHaveLength(139)
    expect(candidates.questions.every((question) => question.question_version === 5 && question.previous_question_id === question.question_id.replace(/_V5$/, '_V4'))).toBe(true)
    expect(candidates.questions.every((question) => questionSemanticHash(question.proposed_question) === question.new_semantic_hash && question.new_semantic_hash !== question.old_semantic_hash)).toBe(true)
    expect(readJson(feature(outputNames[5], base))).toMatchObject({ status: 'PENDING_FAILED_TRACK_REREVIEW', releaseable: false, summary: { total: 145, passed_references: 139, pending_v5: 6 } })
  })

  it('preserves all six structured editorial dimensions on every candidate', () => {
    const base = makeWorkspace()
    expect(run(base).status).toBe(0)
    const candidates = readJson(feature(outputNames[0], base))
    const fields = ['scenario_facts', 'answer', 'permissions', 'exception_branches', 'scoring_thresholds', 'safety_actions']
    for (const question of candidates.questions) expect(Object.keys(question.structured_edit)).toEqual(fields)
  })

  it('closes each concrete V4 return without widening the source set', () => {
    const base = makeWorkspace()
    expect(run(base).status).toBe(0)
    const byId = new Map(readJson(feature(outputNames[0], base)).questions.map((question) => [question.question_id, question]))
    expect(JSON.stringify(byId.get('M1_OP_037_V5').proposed_question)).not.toContain('同一SKU连续成面')
    expect(byId.get('M1_OP_038_V5').proposed_question.content.rubric_criteria).toHaveLength(6)
    expect(byId.get('M1_OP_038_V5').proposed_question.safety_stop_conditions).toContain('未确认层板干燥即复位商品')
    for (const id of ['M2_OP_031_V5', 'M2_OP_038_V5', 'M2_OP_041_V5']) {
      expect(byId.get(id).proposed_question.scoring_rule.score_0_description).not.toMatch(/干扰品|把过期|把异常/)
    }
    expect(byId.get('M5_DG_034_V5').proposed_question.content.prompt).toContain('无反应且无正常呼吸')
    expect(byId.get('M5_DG_034_V5').proposed_question.safety_stop_conditions).toContain('有反应或有正常呼吸')
  })

  it('builds self-contained review packets for failed tracks only', () => {
    const base = makeWorkspace()
    expect(run(base).status).toBe(0)
    const contentPath = feature(outputNames[1], base)
    const safetyPath = feature(outputNames[2], base)
    expect(packageData(contentPath).questions.map((question) => question.question_id)).toEqual(['M1_OP_038_V5', 'M2_OP_031_V5', 'M2_OP_038_V5', 'M2_OP_041_V5', 'M5_DG_034_V5'])
    expect(packageData(safetyPath).questions.map((question) => question.question_id)).toEqual(['M1_OP_037_V5', 'M1_OP_038_V5'])
    for (const path of [contentPath, safetyPath]) {
      const html = readFileSync(path, 'utf8')
      expect(html).not.toMatch(/<script[^>]+src=/)
      expect(html).not.toMatch(/<link[^>]+href=/)
      expect(html).toContain('localStorage')
      const scripts = [...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)]
      expect(() => new vm.Script(scripts.at(-1)[1])).not.toThrow()
    }
    expect(readJson(feature(outputNames[3], base)).properties.questions.minItems).toBe(5)
    expect(readJson(feature(outputNames[4], base)).properties.questions.maxItems).toBe(2)
  })

  it.each([
    ['coverage', (input) => input.questions.pop(), /exactly 6|exactly the six/],
    ['failed tracks', (input) => { input.questions[0].failed_review_tracks = ['CONTENT'] }, /failed review tracks/],
    ['scenario facts', (input) => { input.questions[0].scenario_facts = [] }, /requires scenario facts/],
    ['answer', (input) => { input.questions[0].answer.expected_outcome = '' }, /answer contract/],
    ['permissions', (input) => { input.questions[0].permissions = [] }, /permission boundaries/],
    ['exception branches', (input) => { input.questions[0].exception_branches = [] }, /exception branches/],
    ['scoring thresholds', (input) => { delete input.questions[0].scoring_thresholds.score_2 }, /score 0\/1\/2 thresholds/],
    ['safety actions', (input) => { input.questions[0].safety_actions = [] }, /safety actions/],
    ['unchanged semantics', (input) => { input.questions[2].updates = {} }, /semantic hash must change/],
    ['dry-before-restock redline', (input) => { input.questions[1].updates.safety_stop_conditions = '发现未知液体时停止并上报。' }, /wet restocking a stop condition/]
  ])('rejects invalid %s input before writing outputs', (_name, mutator, expected) => {
    const base = makeWorkspace(mutator)
    const result = run(base)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(expected)
    expect(outputNames.every((name) => !existsSync(feature(name, base)))).toBe(true)
  })

  it('is deterministic in check mode and does not touch delivery lock, SQL, or V4 sources', () => {
    const base = makeWorkspace()
    const watched = [...sourceNames, 'job-skill-shelver-question-delivery-lock-v1.json', 'question-bank-import.sql']
    for (const name of watched.slice(3)) cpSync(feature(name), feature(name, base))
    const before = Object.fromEntries(watched.map((name) => [name, sha256(feature(name, base))]))
    expect(run(base).status).toBe(0)
    const outputsBefore = Object.fromEntries(outputNames.map((name) => [name, sha256(feature(name, base))]))
    expect(run(base, '--check').status).toBe(0)
    expect(Object.fromEntries(outputNames.map((name) => [name, sha256(feature(name, base))]))).toEqual(outputsBefore)
    expect(Object.fromEntries(watched.map((name) => [name, sha256(feature(name, base))]))).toEqual(before)
  })
})
