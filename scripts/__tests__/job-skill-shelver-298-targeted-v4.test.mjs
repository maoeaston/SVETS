import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import vm from 'node:vm'

import { describe, expect, it } from 'vitest'

import { questionSemanticHash } from '../lib/job-skill-contract-hash.mjs'

const root = resolve(import.meta.dirname, '../..')
const feature = (name, base = root) => resolve(base, `doc/features/${name}`)
const script = resolve(root, 'scripts/build-job-skill-shelver-298-targeted-v4.mjs')
const sourceNames = [
  'job-skill-shelver-298-question-revision-candidates-v3.json',
  'job-skill-shelver-298-targeted-v3-rereview-merged-gate-v1.json'
]
const outputNames = [
  'job-skill-shelver-298-question-revision-candidates-v4.json',
  'job-skill-shelver-298-targeted-v4-content-rereview-packet-chen-xiaoqing-v1.html',
  'job-skill-shelver-298-targeted-v4-safety-technical-rereview-packet-he-dong-v1.html',
  'job-skill-shelver-298-targeted-v4-content-rereview-result-v1.schema.json',
  'job-skill-shelver-298-targeted-v4-safety-technical-rereview-result-v1.schema.json',
  'job-skill-shelver-298-targeted-v4-rereview-gate-v1.json'
]
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')

function cleanQuestion(candidate, index) {
  const question = structuredClone(candidate.proposed_question)
  const content = question.content
  content.prompt = `第${index + 1}题：请根据门店现场信息完成判断或操作。`
  if (candidate.question_type === 'SINGLE_CHOICE') {
    content.options = [{ key: 'A', text: '按标签和授权流程处理' }, { key: 'B', text: '未经核对直接处理' }, { key: 'C', text: '跳过记录继续作业' }]
    content.expected_answer = 'A'
  } else if (candidate.question_type === 'TRUE_FALSE') {
    content.expected_answer = index % 2 === 0
    content.media_brief = `视频展示第${index + 1}题的完整现场行为和结果。`
  } else if (candidate.question_type === 'DRAG') {
    content.drag_items = [{ item_id: 'i1', label: '核对商品标签后归位' }, { item_id: 'i2', label: '未核对标签直接归位' }]
    content.drop_zones = [{ zone_id: 'z1', label: '规范操作', accepts: ['i1'] }, { zone_id: 'z2', label: '不规范操作', accepts: ['i2'] }]
  } else {
    content.rubric_criteria = [{ criterion_id: 'r1', description: '完成对象核对' }, { criterion_id: 'r2', description: '完成结果记录' }]
    question.scoring_rule.score_0_description = '0分：未完成最低任务，或累计接受2次及以上提示。'
    question.scoring_rule.score_1_description = '1分：完成最低部分任务，或者恰好1次非指向性提示后完成。'
    question.scoring_rule.score_2_description = '2分：独立完成全部任务且0次提示。'
  }
  if (question.safety_sensitive) question.safety_stop_conditions = '出现人身、商品或设备风险时立即停止操作，隔离现场并上报负责人。'
  return question
}

function makeWorkspace(mutator) {
  const base = mkdtempSync(resolve(tmpdir(), 'svets-v4-'))
  mkdirSync(resolve(base, 'doc/features'), { recursive: true })
  for (const name of sourceNames) {
    const target = feature(name, base)
    cpSync(feature(name), target, { recursive: false })
  }
  const candidates = readJson(feature(sourceNames[0], base))
  const gate = readJson(feature(sourceNames[1], base))
  const byId = new Map(candidates.questions.map((question) => [question.question_id, question]))
  const sections = { ONLINE: [], DRAG: [], OFFLINE_OPERATION: [] }
  gate.questions.filter((item) => item.status !== 'PASSED').forEach((item, index) => {
    const previous = byId.get(item.question_id)
    const record = {
      question_id: item.next_question_id,
      previous_question_id: item.question_id,
      source_question_id: previous.source_question_id,
      question_type: previous.question_type,
      required_review_tracks: item.next_review_tracks,
      revision_rationale: `第${index + 1}题定点修订说明`,
      proposed_question: cleanQuestion(previous, index)
    }
    const section = previous.question_type === 'DRAG' ? 'DRAG' : previous.question_type === 'OFFLINE_OPERATION' ? 'OFFLINE_OPERATION' : 'ONLINE'
    sections[section].push(record)
  })
  mutator?.(sections, { candidates, gate })
  for (const [section, questions] of Object.entries(sections)) {
    const slug = section === 'OFFLINE_OPERATION' ? 'offline' : section.toLowerCase()
    writeFileSync(feature(`job-skill-shelver-298-v4-${slug}-editorial-input.json`, base), `${JSON.stringify({ schema_version: 'job-skill-shelver-298-v4-editorial-input-v1', section, questions }, null, 2)}\n`)
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

describe('job skill shelver targeted V4 contract', () => {
  it('builds exactly 141 V4 candidates and preserves four passed V3 references', () => {
    const base = makeWorkspace()
    const result = run(base)
    expect(result.status, result.stderr).toBe(0)
    const candidates = readJson(feature(outputNames[0], base))
    expect(candidates.summary).toMatchObject({ v4_total: 141, passed_v3_reference_total: 4, content_rereview_total: 140, safety_technical_rereview_total: 120, by_type: { SINGLE_CHOICE: 30, TRUE_FALSE: 12, DRAG: 16, OFFLINE_OPERATION: 83 } })
    expect(candidates.questions).toHaveLength(141)
    expect(candidates.passed_v3_references).toHaveLength(4)
    expect(candidates.passed_v3_references.every((question) => question.question_id.endsWith('_V3'))).toBe(true)
    expect(candidates.questions.every((question) => question.question_id.endsWith('_V4') && question.previous_question_id.endsWith('_V3'))).toBe(true)
    expect(candidates.questions.every((question) => question.new_semantic_hash !== question.old_semantic_hash && questionSemanticHash(question.proposed_question) === question.new_semantic_hash)).toBe(true)
    expect(readJson(feature(outputNames[5], base))).toMatchObject({ status: 'PENDING_REVIEW', releaseable: false, summary: { total: 145, pending_v4: 141, passed_v3_references: 4 } })
  })

  it('builds self-contained track-scoped HTML with JSON export and strict result schemas', () => {
    const base = makeWorkspace()
    expect(run(base).status).toBe(0)
    const contentPath = feature(outputNames[1], base)
    const safetyPath = feature(outputNames[2], base)
    expect(packageData(contentPath).questions).toHaveLength(140)
    expect(packageData(safetyPath).questions).toHaveLength(120)
    for (const path of [contentPath, safetyPath]) {
      const html = readFileSync(path, 'utf8')
      expect(html).not.toMatch(/<script[^>]+src=/)
      expect(html).not.toMatch(/<link[^>]+href=/)
      expect(html).toContain('localStorage')
      expect(html).toContain('JSON.stringify')
      const scripts = [...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)]
      expect(() => new vm.Script(scripts.at(-1)[1])).not.toThrow()
    }
    expect(readJson(feature(outputNames[3], base)).properties.questions.minItems).toBe(140)
    expect(readJson(feature(outputNames[4], base)).properties.questions.maxItems).toBe(120)
  })

  it.each([
    ['coverage', (sections) => sections.DRAG.pop(), /exactly 141|exactly cover/],
    ['version chain', (sections) => { sections.DRAG[0].previous_question_id = 'M1_DG_999_V3' }, /unknown V3 predecessor|exactly cover/],
    ['review tracks', (sections) => { sections.DRAG[0].required_review_tracks = ['CONTENT'] }, /required_review_tracks/],
    ['forbidden wording', (sections) => { sections.DRAG[0].proposed_question.content.prompt = '沿用原题审核意见' }, /forbidden reviewer\/meta wording/],
    ['unchanged semantics', (sections, sources) => { sections.DRAG[0].proposed_question = sources.candidates.questions.find((question) => question.question_id === sections.DRAG[0].previous_question_id).proposed_question }, /semantic hash must change/],
    ['single-choice answer', (sections) => { const question = sections.ONLINE.find((item) => item.question_type === 'SINGLE_CHOICE'); question.proposed_question.content.options[1].key = 'A' }, /option keys must be unique/],
    ['true-false video', (sections) => { const question = sections.ONLINE.find((item) => item.question_type === 'TRUE_FALSE'); question.proposed_question.content.media_brief = '' }, /video description/],
    ['drag mapping', (sections) => { sections.DRAG[0].proposed_question.content.drop_zones[1].accepts.push('i1') }, /map to exactly one zone/],
    ['offline rubric', (sections) => { sections.OFFLINE_OPERATION[0].proposed_question.content.rubric_criteria[1].criterion_id = 'r1' }, /rubric criterion IDs must be unique/],
    ['offline prompt threshold', (sections) => { sections.OFFLINE_OPERATION[0].proposed_question.scoring_rule.score_2_description = '2分：全部完成。' }, /score 2 must state an explicit prompt threshold/],
    ['safety stop', (sections) => { const question = Object.values(sections).flat().find((item) => item.proposed_question.safety_sensitive); question.proposed_question.safety_stop_conditions = '' }, /requires stop conditions/]
  ])('rejects invalid %s input before writing outputs', (_name, mutator, expected) => {
    const base = makeWorkspace(mutator)
    const result = run(base)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(expected)
    expect(outputNames.every((name) => !existsSync(feature(name, base)))).toBe(true)
  })

  it('is deterministic in check mode and does not touch delivery or SQL files', () => {
    const base = makeWorkspace()
    const watched = ['job-skill-shelver-question-delivery-lock-v1.json', 'question-bank-import.sql']
    for (const name of watched) cpSync(feature(name), feature(name, base))
    const before = Object.fromEntries(watched.map((name) => [name, sha256(feature(name, base))]))
    expect(run(base).status).toBe(0)
    const outputBefore = Object.fromEntries(outputNames.map((name) => [name, sha256(feature(name, base))]))
    expect(run(base, '--check').status).toBe(0)
    expect(Object.fromEntries(outputNames.map((name) => [name, sha256(feature(name, base))]))).toEqual(outputBefore)
    expect(Object.fromEntries(watched.map((name) => [name, sha256(feature(name, base))]))).toEqual(before)
  })
})
