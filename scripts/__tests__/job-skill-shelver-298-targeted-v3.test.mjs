import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'

import { describe, expect, it } from 'vitest'

import { questionSemanticHash } from '../lib/job-skill-contract-hash.mjs'

const root = resolve(import.meta.dirname, '../..')
const feature = (name) => resolve(root, `doc/features/${name}`)
const paths = {
  patches: feature('job-skill-shelver-298-revision-patches-v2.json'),
  candidates: feature('job-skill-shelver-298-question-revision-candidates-v3.json'),
  contentHtml: feature('job-skill-shelver-298-targeted-v3-content-rereview-packet-chen-xiaoqing-v1.html'),
  safetyHtml: feature('job-skill-shelver-298-targeted-v3-safety-technical-rereview-packet-he-dong-v1.html'),
  contentSchema: feature('job-skill-shelver-298-targeted-v3-content-rereview-result-v1.schema.json'),
  safetySchema: feature('job-skill-shelver-298-targeted-v3-safety-technical-rereview-result-v1.schema.json'),
  gate: feature('job-skill-shelver-298-targeted-v3-rereview-gate-v1.json'),
  delivery: feature('job-skill-shelver-question-delivery-lock-v1.json'),
  sql: resolve(root, 'doc/features/question-bank-import.sql')
}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const sha256 = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`

function packageData(path) {
  const html = readFileSync(path, 'utf8')
  const match = html.match(/<script id="package-data" type="application\/json">([\s\S]*?)<\/script>/)
  if (!match) throw new Error(`${path} package data missing`)
  return JSON.parse(match[1])
}

describe('job skill shelver targeted V3 contract', () => {
  it('splits 211 returns into 145 semantic V3 revisions and 66 preserved V2 questions', () => {
    const patches = readJson(paths.patches)
    const candidates = readJson(paths.candidates)

    expect(patches.summary).toMatchObject({
      returned_total: 211,
      semantic_patch_total: 145,
      preserved_v2_without_semantic_change_total: 66,
      by_type: { SINGLE_CHOICE: 34, TRUE_FALSE: 12, DRAG: 16, OFFLINE_OPERATION: 83 },
      review_routing: { content: 144, safety_technical: 135 }
    })
    expect(patches.preserved_v2_without_semantic_change).toHaveLength(66)
    expect(patches.patches).toHaveLength(145)
    expect(candidates.questions).toHaveLength(145)
    expect(candidates.questions.filter((question) => question.question_type === 'OFFLINE_OPERATION')).toHaveLength(83)
  })

  it('never creates V3 for delivery-only video/image changes', () => {
    const patches = readJson(paths.patches)
    const candidates = readJson(paths.candidates)
    const preserved = new Set(patches.preserved_v2_without_semantic_change.map((item) => item.question_id))
    const previousIds = new Set(candidates.questions.map((item) => item.previous_question_id))

    expect([...preserved].filter((id) => id.includes('_TF_'))).toHaveLength(56)
    expect([...preserved].filter((id) => id.includes('_DG_'))).toHaveLength(6)
    expect([...preserved].filter((id) => id.includes('_SC_'))).toHaveLength(4)
    expect([...preserved].every((id) => !previousIds.has(id))).toBe(true)
    expect(preserved).toContain('M1_SC_014_V2')
    expect(preserved).toContain('M2_DG_025_V2')
  })

  it('requires every patch to change an explicit semantic field and semantic hash', () => {
    const patches = readJson(paths.patches)
    const candidates = readJson(paths.candidates)
    const forbidden = /(media_asset_id|tool_asset_ids|offline_setup|asset_id|source_path|file_hash)/

    for (const patch of patches.patches) {
      expect(patch.operations.length).toBeGreaterThan(0)
      expect(patch.operations.every((operation) => operation.op === 'replace')).toBe(true)
      expect(patch.operations.every((operation) => !forbidden.test(operation.path))).toBe(true)
    }
    for (const question of candidates.questions) {
      expect(question.question_id).toMatch(/_V3$/)
      expect(question.previous_question_id).toMatch(/_V2$/)
      expect(question.new_semantic_hash).not.toBe(question.old_semantic_hash)
      expect(questionSemanticHash(question.proposed_question)).toBe(question.new_semantic_hash)
      const content = question.proposed_question.content
      if (question.question_type === 'SINGLE_CHOICE') {
        const correct = content.options.find((option) => option.key === content.expected_answer)
        expect(correct.text).not.toMatch(/通过。V2|退回复修/)
      }
      if (question.question_type === 'DRAG') {
        expect(content.drag_items.find((item) => item.item_id === 'i_correct').label).not.toMatch(/缺少|无法稳定|退回复修/)
      }
      if (question.question_type === 'OFFLINE_OPERATION') {
        expect(content.rubric_criteria.map((criterion) => criterion.description).join(' ')).not.toMatch(/tool_asset_ids|\bV2\b|rubric/i)
      }
    }
  })

  it('excludes delivery metadata from the explicit semantic hash', () => {
    const question = structuredClone(readJson(paths.candidates).questions[0].proposed_question)
    const before = questionSemanticHash(question)
    question.media_asset_id = 'asset_changed_without_semantic_effect'
    question.tool_asset_ids = ['asset_tool_changed']
    question.content.media_asset_id = 'asset_nested_changed'
    question.content.offline_setup = { setup_id: 'setup_changed', item_ids: ['item_changed'], asset_ids: ['asset_changed'] }
    expect(questionSemanticHash(question)).toBe(before)

    question.content.prompt += '语义变化'
    expect(questionSemanticHash(question)).not.toBe(before)
  })

  it('builds self-contained reviewer HTML and pending JSON-only result contracts', () => {
    const content = packageData(paths.contentHtml)
    const safety = packageData(paths.safetyHtml)
    expect(content.questions).toHaveLength(144)
    expect(safety.questions).toHaveLength(135)
    expect(content.questions.some((question) => question.question_id === 'M5_DG_037_V3')).toBe(false)
    expect(safety.questions.some((question) => question.question_id === 'M5_DG_037_V3')).toBe(true)

    for (const path of [paths.contentHtml, paths.safetyHtml]) {
      const html = readFileSync(path, 'utf8')
      expect(html).not.toMatch(/<script[^>]+src=/)
      expect(html).not.toMatch(/<link[^>]+href=/)
      const scripts = [...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)]
      expect(() => new vm.Script(scripts.at(-1)[1])).not.toThrow()
    }

    expect(readJson(paths.contentSchema).properties.questions.minItems).toBe(144)
    expect(readJson(paths.safetySchema).properties.questions.maxItems).toBe(135)
    expect(readJson(paths.gate)).toMatchObject({ status: 'PENDING_REVIEW', releaseable: false, summary: { total: 145, pending: 145 } })
  })

  it('rebuilds deterministically without touching delivery lock or runtime SQL', () => {
    const watched = [paths.patches, paths.candidates, paths.contentHtml, paths.safetyHtml, paths.gate, paths.delivery, paths.sql]
    const before = Object.fromEntries(watched.map((path) => [path, sha256(readFileSync(path))]))
    const result = spawnSync(process.execPath, [resolve(root, 'scripts/build-job-skill-shelver-298-targeted-v3.mjs'), '--check'], { cwd: root })
    if (result.status !== 0) throw result.error ?? new Error(result.stderr.toString())
    for (const path of watched) expect(sha256(readFileSync(path))).toBe(before[path])
  })
})
