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
const script = resolve(root, 'scripts/build-job-skill-shelver-298-targeted-v6.mjs')
const sourceNames = [
  'job-skill-shelver-298-question-revision-candidates-v5.json',
  'job-skill-shelver-298-targeted-v5-rereview-merged-gate-v1.json',
  'job-skill-shelver-298-v6-editorial-input.json'
]
const outputNames = [
  'job-skill-shelver-298-question-revision-candidates-v6.json',
  'job-skill-shelver-298-targeted-v6-content-rereview-packet-chen-xiaoqing-v1.html',
  'job-skill-shelver-298-targeted-v6-content-rereview-result-v1.schema.json',
  'job-skill-shelver-298-targeted-v6-rereview-gate-v1.json'
]
const expectedV6Ids = ['M2_OP_031_V6', 'M2_OP_038_V6', 'M2_OP_041_V6', 'M5_DG_034_V6']
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')

function makeWorkspace(mutator) {
  const base = mkdtempSync(resolve(tmpdir(), 'svets-v6-'))
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

describe('job skill shelver targeted V6 content rereview contract', () => {
  it('builds exactly four V6 candidates and carries 141 passed references unchanged', () => {
    const base = makeWorkspace()
    const result = run(base)
    expect(result.status, result.stderr).toBe(0)
    const candidates = readJson(feature(outputNames[0], base))
    const sourceGate = readJson(feature(sourceNames[1], base))
    expect(candidates.summary).toEqual({
      source_total: 145,
      passed_reference_total: 141,
      v6_total: 4,
      content_rereview_total: 4,
      safety_technical_rereview_total: 0,
      by_type: { DRAG: 1, OFFLINE_OPERATION: 3 }
    })
    expect(candidates.questions.map((question) => question.question_id)).toEqual(expectedV6Ids)
    expect(candidates.questions.every((question) => question.question_version === 6 && question.previous_question_id === question.question_id.replace(/_V6$/, '_V5'))).toBe(true)
    expect(candidates.questions.every((question) => question.required_review_tracks.join() === 'CONTENT')).toBe(true)
    expect(candidates.questions.every((question) => questionSemanticHash(question.proposed_question) === question.new_semantic_hash && question.new_semantic_hash !== question.old_semantic_hash)).toBe(true)

    const sourcePassed = sourceGate.questions.filter((question) => question.status !== 'RETURN_FOR_REVISION')
    expect(candidates.passed_question_references).toEqual(sourcePassed.map((question) => ({
      question_id: question.question_id,
      question_version: question.question_version,
      semantic_hash: question.semantic_hash,
      candidate_record_hash: question.candidate_record_hash,
      merged_record_hash: question.merged_record_hash,
      status: 'PASSED_REFERENCE'
    })).sort((left, right) => left.question_id.localeCompare(right.question_id)))
    expect(readJson(feature(outputNames[3], base))).toMatchObject({ status: 'PENDING_FAILED_TRACK_REREVIEW', releaseable: false, summary: { total: 145, passed_references: 141, pending_v6: 4 } })
  })

  it('removes assessment setup failures from learner scores and requires reset/retest', () => {
    const base = makeWorkspace()
    expect(run(base).status).toBe(0)
    const byId = new Map(readJson(feature(outputNames[0], base)).questions.map((question) => [question.question_id, question]))
    for (const id of ['M2_OP_031_V6', 'M2_OP_038_V6', 'M2_OP_041_V6']) {
      const question = byId.get(id)
      expect(question.proposed_question.scoring_rule.score_0_description).not.toMatch(/现场.*(?:设置|不符合)|设置不是|未按固定脚本/)
      expect(question.structured_edit.scoring_thresholds.score_0).not.toContain('设置异常')
      expect(question.structured_edit.exception_branches[0].action).toMatch(/施测无效/)
      expect(question.structured_edit.exception_branches[0].action).toMatch(/复位.*重测/)
    }
  })

  it('makes the emergency drag task start at discovery and keeps one complete four-step order', () => {
    const base = makeWorkspace()
    expect(run(base).status).toBe(0)
    const question = readJson(feature(outputNames[0], base)).questions.find((record) => record.question_id === 'M5_DG_034_V6')
    expect(question.proposed_question.content.prompt).toContain('发现一名顾客倒地')
    expect(question.proposed_question.content.prompt).not.toContain('现场安全后')
    expect(question.proposed_question.content.prompt).not.toContain('确认其无反应且无正常呼吸')
    expect(question.proposed_question.content.drag_items).toHaveLength(4)
    expect(question.proposed_question.content.drop_zones).toHaveLength(4)
    expect(question.proposed_question.content.drag_items[0].label).toContain('确认现场')
    expect(question.proposed_question.content.drag_items[1].label).toContain('确认无反应且无正常呼吸')
  })

  it('builds one self-contained four-question content review packet', () => {
    const base = makeWorkspace()
    expect(run(base).status).toBe(0)
    const htmlPath = feature(outputNames[1], base)
    expect(packageData(htmlPath).questions.map((question) => question.question_id)).toEqual(expectedV6Ids)
    const html = readFileSync(htmlPath, 'utf8')
    expect(html).not.toMatch(/<script[^>]+src=/)
    expect(html).not.toMatch(/<link[^>]+href=/)
    expect(html).toContain('localStorage')
    const scripts = [...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)]
    expect(() => new vm.Script(scripts.at(-1)[1])).not.toThrow()
    expect(readJson(feature(outputNames[2], base)).properties.questions.minItems).toBe(4)
  })

  it.each([
    ['coverage', (input) => input.questions.pop(), /exactly 4|exactly the four/],
    ['failed tracks', (input) => { input.questions[0].failed_review_tracks = ['SAFETY_TECHNICAL'] }, /failed review tracks/],
    ['previous ID', (input) => { input.questions[0].previous_question_id = 'M2_OP_031_V4' }, /previous_question_id|exactly the four/],
    ['unchanged semantics', (input) => { input.questions[0].updates = {} }, /semantic hash must change/],
    ['setup failure remains scored', (input) => { input.questions[0].updates.scoring_rule.score_0_description += '，或现场设置错误。' }, /setup failures outside learner scores/],
    ['duplicated emergency premise', (input) => { input.questions[3].updates.content.prompt = '现场安全后，确认其无反应且无正常呼吸，请排序。' }, /start from discovery/]
  ])('rejects invalid %s input before writing outputs', (_name, mutator, expected) => {
    const base = makeWorkspace(mutator)
    const result = run(base)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(expected)
    expect(outputNames.every((name) => !existsSync(feature(name, base)))).toBe(true)
  })

  it('is deterministic in check mode and does not touch delivery lock, SQL, or V5 sources', () => {
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
