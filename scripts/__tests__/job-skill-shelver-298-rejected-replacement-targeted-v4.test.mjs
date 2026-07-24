import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import vm from 'node:vm'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { hashRecord, questionSemanticHash } from '../lib/job-skill-contract-hash.mjs'

const root = resolve(import.meta.dirname, '../..')
const script = resolve(root, 'scripts/build-job-skill-shelver-298-rejected-replacement-targeted-v4.mjs')
const inputs = [
  'doc/features/job-skill-shelver-298-rejected-replacement-targeted-candidates-v3.json',
  'doc/features/job-skill-shelver-298-rejected-replacement-targeted-v3-rereview-merged-gate-v1.json'
]
const outputs = [
  'doc/features/job-skill-shelver-298-rejected-replacement-targeted-candidates-v4.json',
  'doc/features/job-skill-shelver-298-rejected-replacement-targeted-candidates-v4.md',
  'doc/features/job-skill-shelver-298-rejected-replacement-targeted-v4-content-rereview-gate-v1.json',
  'doc/features/job-skill-shelver-298-rejected-replacement-targeted-v4-content-rereview-packet-chen-xiaoqing-v1.html',
  'doc/features/job-skill-shelver-298-rejected-replacement-targeted-v4-content-rereview-result-v1.schema.json'
]
const returnedV3Ids = ['M1_OP_042_V3', 'M3_OP_056_V3', 'M4_OP_045_V3', 'M4_OP_046_V3', 'M4_OP_048_V3', 'M5_OP_048_V3']
const v4Ids = returnedV3Ids.map((id) => id.replace(/_V3$/, '_V4'))
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

beforeEach(() => {
  tempRoot = mkdtempSync(resolve(tmpdir(), 'svets-rejected-replacement-v4-'))
  for (const relative of inputs) copy(relative)
  const built = run([])
  if (built.status !== 0) throw new Error(`${built.stdout}\n${built.stderr}`)
})
afterEach(() => rmSync(tempRoot, { recursive: true, force: true }))

describe('job skill shelver rejected replacement targeted V4 candidates', () => {
  it('creates V4 only for the six content-returned V3 questions', () => {
    const candidates = json(outputs[0])
    expect(candidates.questions.map((item) => item.previous_question_id)).toEqual(returnedV3Ids)
    expect(candidates.questions.map((item) => item.question_id)).toEqual(v4Ids)
    expect(candidates.summary).toMatchObject({
      cumulative_passed_references_unchanged: 5,
      v3_returned_for_content_revision: 6,
      v4_candidates: 6,
      content_rereview_required: 6,
      safety_technical_rereview_required: 0
    })
    expect(candidates.cumulative_passed_references.map((item) => item.question_id)).toEqual([
      'M4_OP_043_V2', 'M4_OP_044_V2', 'M1_OB_048_V3', 'M4_OP_047_V3', 'M5_OP_055_V3'
    ])
  })

  it('binds hashes, routes only content, and carries every safety pass by source hash', () => {
    const candidates = json(outputs[0])
    const merged = json(inputs[1])
    const { candidate_set_hash: setHash, ...setBody } = candidates
    expect(hashRecord(setBody)).toBe(setHash)
    for (const item of candidates.questions) {
      const { candidate_record_hash: recordHash, ...recordBody } = item
      const source = merged.questions.find((question) => question.question_id === item.previous_question_id)
      expect(hashRecord(recordBody)).toBe(recordHash)
      expect(questionSemanticHash(item.proposed_question)).toBe(item.new_semantic_hash)
      expect(item.new_semantic_hash).not.toBe(item.old_semantic_hash)
      expect(item.required_review_tracks).toEqual(['CONTENT'])
      expect(item.proposed_question.content.professional_review).toEqual({ required: true, status: 'PENDING', tracks: ['CONTENT'] })
      expect(item.revision_trace.carried_forward_review_passes).toEqual([{
        track: 'SAFETY_TECHNICAL',
        status: 'PASS',
        source_record_hash: source.review_results.safety_technical.source_record_hash
      }])
      expect(item.activation_authority).toBe('NONE')
    }
  })

  it('applies all six content-review corrections without broadening scope', () => {
    const byId = new Map(json(outputs[0]).questions.map((item) => [item.question_id, item]))

    const fifo = byId.get('M1_OP_042_V4').proposed_question.scoring_rule
    expect(fifo.score_1_description).toContain('同一SKU的新旧两件均已摆放')
    expect(fifo.score_1_description).toContain('遗漏最终复查')
    expect(fifo.score_0_description).toContain('未达到1分最低条件')

    const expiry = byId.get('M3_OP_056_V4').proposed_question.scoring_rule
    expect(expiry.score_1_description).toContain('至少6件')
    expect(expiry.score_1_description).toContain('至少1件正确前置')
    expect(expiry.score_0_description).toContain('未达到1分最低条件')
    expect(expiry.score_0_description).toContain('最早到期2件均未正确前置')

    const wrongArea = byId.get('M4_OP_045_V4').proposed_question.scoring_rule
    expect(wrongArea.score_1_description).toContain('正确归位但遗漏最终复查')
    expect(wrongArea.score_0_description).toContain('未达到1分最低条件')

    const barcode = byId.get('M4_OP_046_V4')
    expect(barcode.proposed_question.content.prompt).toContain('有且仅有1件商品的条码与补货清单不符')
    expect(barcode.proposed_question.content.prompt).not.toContain('规格或条码')
    expect(barcode.proposed_question.content.offline_tool_brief).toContain('固定条码不符标签')
    expect(barcode.proposed_question.scoring_rule.score_1_description).toContain('停止其上架')
    expect(barcode.proposed_question.scoring_rule.score_1_description).not.toContain('隔离')
    expect(barcode.proposed_question.scoring_rule.score_0_description).toContain('未达到1分最低条件')

    const interruption = byId.get('M4_OP_048_V4').proposed_question.scoring_rule
    expect(interruption.score_1_description).toContain('9件合格品和1件仿真异常品均处置正确')
    expect(interruption.score_1_description).toContain('遗漏最终复查')

    const aisle = byId.get('M5_OP_048_V4').proposed_question
    expect(aisle.content.rubric_criteria[2].description).toContain('目视检查并向评估员口头确认')
    expect(aisle.scoring_rule.score_0_description).toContain('任一关键安全动作缺失')
    expect(aisle.scoring_rule.score_0_description).toContain('未达到1分最低条件')
    expect(aisle.scoring_rule.score_1_description).toContain('0次提示')
    expect(aisle.scoring_rule.score_1_description).toContain('恰好1件分类错误')
  })

  it('builds only Chen Xiaoqing self-contained content rereview HTML with JSON export', () => {
    const pkg = embeddedPackage(outputs[3])
    expect(pkg.questions.map((item) => item.question_id)).toEqual(v4Ids)
    expect(pkg.reviewer).toEqual({ name: '陈晓青', track: 'CONTENT_REREVIEW', role: '内容定点复审' })
    expect(pkg.questions.every((item) => item.activation_authority === 'NONE')).toBe(true)
    expect(pkg.questions.every((item) => item.required_review_tracks.join(',') === 'CONTENT')).toBe(true)
    expect(pkg.authority).toMatchObject({ activation_authority_granted: false, can_activate_questions: false, runtime_database_change_allowed: false, activation_sql_generated: false })

    const html = readFileSync(resolve(tempRoot, outputs[3]), 'utf8')
    expect(html).not.toMatch(/<script[^>]+src=/)
    expect(html).not.toMatch(/<link[^>]+href=/)
    const scripts = [...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)]
    expect(scripts).toHaveLength(2)
    expect(() => new vm.Script(scripts[1][1], { filename: 'v4-content-packet-inline.js' })).not.toThrow()
    expect(html).toContain("some(name=>review_fields[name]==='RETURN_FOR_REVISION')")
    expect(html).toContain("activation_authority:'NONE'")
    expect(existsSync(resolve(tempRoot, 'doc/features/job-skill-shelver-298-rejected-replacement-targeted-v4-safety-technical-rereview-packet-he-dong-v1.html'))).toBe(false)
  })

  it('locks the result schema to six V4 questions and no activation authority', () => {
    const schema = json(outputs[4])
    expect(schema.properties.questions.minItems).toBe(6)
    expect(schema.properties.questions.maxItems).toBe(6)
    expect(schema.properties.questions.items.properties.question_id.enum).toEqual(v4Ids)
    expect(schema.properties.questions.items.properties.previous_question_id.pattern).toBe('^M[1-6]_[A-Z]+_\\d+_V3$')
    expect(schema.properties.questions.items.properties.activation_authority.const).toBe('NONE')
    expect(schema.properties.authority.properties.activation_authority_granted.const).toBe(false)
    expect(schema.properties.authority.properties.can_activate_questions.const).toBe(false)
  })

  it('keeps the V4 gate pending, content-only, and authority-free', () => {
    const gate = json(outputs[2])
    const { gate_hash: gateHash, ...gateBody } = gate
    expect(hashRecord(gateBody)).toBe(gateHash)
    expect(gate.status).toBe('PENDING_TARGETED_V4_CONTENT_REREVIEW_NO_ACTIVATION_AUTHORITY')
    expect(gate.review_routing.content).toEqual(v4Ids)
    expect(gate.review_routing.safety_technical).toEqual([])
    expect(gate.review_routing.carried_forward_safety_technical_passes).toHaveLength(6)
    expect(gate.summary).toEqual({ total_v4: 6, pending_v4: 6, content_pending: 6, safety_technical_pending: 0, cumulative_passed_reference_only: 5 })
    expect(gate.boundaries).toMatchObject({ activation_authority_granted: false, can_activate_questions: false, existing_287_unchanged: true, runtime_database_unchanged: true, activation_sql_not_generated: true })
  })

  it('checks deterministically and fails closed on output drift', () => {
    const check = run()
    if (check.status !== 0) throw new Error(`${check.stdout}\n${check.stderr}`)

    const outputPath = resolve(tempRoot, outputs[0])
    const output = JSON.parse(readFileSync(outputPath, 'utf8'))
    output.questions[0].activation_authority = 'GRANTED'
    writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`)
    const drift = run()
    expect(drift.status).not.toBe(0)
    expect(`${drift.stdout}${drift.stderr}`).toContain('generated artifact drift')
  })
})
