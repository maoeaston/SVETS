import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import vm from 'node:vm'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { hashRecord, questionSemanticHash } from '../lib/job-skill-contract-hash.mjs'

const root = resolve(import.meta.dirname, '../..')
const script = resolve(root, 'scripts/build-job-skill-shelver-298-rejected-replacement-targeted-v3.mjs')
const inputs = [
  'doc/features/job-skill-shelver-298-rejected-replacement-candidates-v2.json',
  'doc/features/job-skill-shelver-298-rejected-replacement-review-merged-gate-v1.json',
  'doc/features/job-skill-shelver-298-rejected-replacement-content-confirmation-result-chen-xiaoqing-2026-07-22.json',
  'doc/features/job-skill-shelver-298-rejected-replacement-safety-technical-review-result-he-dong-2026-07-22.json'
]
const outputs = [
  'doc/features/job-skill-shelver-298-rejected-replacement-targeted-candidates-v3.json',
  'doc/features/job-skill-shelver-298-rejected-replacement-targeted-candidates-v3.md',
  'doc/features/job-skill-shelver-298-rejected-replacement-targeted-v3-review-gate-v1.json',
  'doc/features/job-skill-shelver-298-rejected-replacement-targeted-v3-content-rereview-packet-chen-xiaoqing-v1.html',
  'doc/features/job-skill-shelver-298-rejected-replacement-targeted-v3-safety-technical-rereview-packet-he-dong-v1.html',
  'doc/features/job-skill-shelver-298-rejected-replacement-targeted-v3-content-rereview-result-v1.schema.json',
  'doc/features/job-skill-shelver-298-rejected-replacement-targeted-v3-safety-technical-rereview-result-v1.schema.json'
]
const returnedV2Ids = [
  'M1_OB_048_V2', 'M1_OP_042_V2', 'M3_OP_056_V2', 'M4_OP_045_V2', 'M4_OP_046_V2',
  'M4_OP_047_V2', 'M4_OP_048_V2', 'M5_OP_048_V2', 'M5_OP_055_V2'
]
const contentV3Ids = returnedV2Ids.filter((id) => id !== 'M4_OP_047_V2').map((id) => id.replace(/_V2$/, '_V3'))
const safetyV3Ids = returnedV2Ids.filter((id) => !['M3_OP_056_V2', 'M5_OP_055_V2'].includes(id)).map((id) => id.replace(/_V2$/, '_V3'))
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
  tempRoot = mkdtempSync(resolve(tmpdir(), 'svets-rejected-replacement-v3-'))
  for (const relative of [...inputs, ...outputs]) copy(relative)
})
afterEach(() => rmSync(tempRoot, { recursive: true, force: true }))

describe('job skill shelver rejected replacement targeted V3 candidates', () => {
  it('creates V3 only for the nine returned V2 questions and preserves two passed V2 references', () => {
    const candidates = json(outputs[0])
    expect(candidates.questions.map((item) => item.previous_question_id)).toEqual(returnedV2Ids)
    expect(candidates.questions.map((item) => item.question_id)).toEqual(returnedV2Ids.map((id) => id.replace(/_V2$/, '_V3')))
    expect(candidates.passed_v2_references.map((item) => item.question_id)).toEqual(['M4_OP_043_V2', 'M4_OP_044_V2'])
    expect(candidates.summary).toMatchObject({ v3_candidates: 9, content_rereview_required: 8, safety_technical_rereview_required: 7 })
    expect(candidates.passed_v2_references.every((item) => item.activation_authority === 'NONE')).toBe(true)
  })

  it('binds candidate and semantic hashes and routes only failed review tracks', () => {
    const candidates = json(outputs[0])
    const merged = json(inputs[1])
    const { candidate_set_hash: setHash, ...setBody } = candidates
    expect(hashRecord(setBody)).toBe(setHash)
    for (const item of candidates.questions) {
      const { candidate_record_hash: recordHash, ...recordBody } = item
      expect(hashRecord(recordBody)).toBe(recordHash)
      expect(questionSemanticHash(item.proposed_question)).toBe(item.new_semantic_hash)
      expect(item.new_semantic_hash).not.toBe(item.old_semantic_hash)
      expect(item.required_review_tracks).toEqual(merged.questions.find((review) => review.question_id === item.previous_question_id).failed_review_tracks)
      expect(item.proposed_question.content.professional_review).toEqual({ required: true, status: 'PENDING', tracks: item.required_review_tracks })
      expect(item.activation_authority).toBe('NONE')
      expect(item.replacement_relationship).toEqual({ rejected_original_remains_rejected: true, previous_v2_not_activated: true, supersedes_original: false })
    }
  })

  it('applies every reviewer-requested targeted correction', () => {
    const byId = new Map(json(outputs[0]).questions.map((item) => [item.question_id, item]))
    expect(byId.get('M1_OB_048_V3').proposed_question.content).toMatchObject({
      assessment_point: '不明液体发现、隔离、上报与恢复条件确认',
      ability_tags: ['SAFETY_OPERATION', 'RULE_EXECUTION']
    })
    expect(byId.get('M1_OB_048_V3').proposed_question.scoring_rule.score_0_description).toContain('任一关键安全动作缺失')

    const fifo = byId.get('M1_OP_042_V3')
    expect(fifo.proposed_question.content.offline_tool_brief).toContain('1件旧批次和1件新批次')
    expect(fifo.proposed_question.content.offline_tool_brief).toContain('唯一答案卡')
    expect(fifo.proposed_question.safety_sensitive).toBe(false)

    const expiry = byId.get('M3_OP_056_V3')
    expect(expiry.proposed_question.content.prompt).toContain('8行核验记录表')
    expect(expiry.revision_trace.carried_forward_review_passes.map((item) => item.track)).toEqual(['SAFETY_TECHNICAL'])

    expect(byId.get('M4_OP_045_V3').proposed_question.scoring_rule.score_1_description).not.toContain('问题暂存位')
    expect(byId.get('M4_OP_046_V3').proposed_question.content.prompt).toContain('有且仅有1件的规格或条码与清单不符')

    const batch = byId.get('M4_OP_047_V3')
    expect(batch.proposed_question.content.offline_tool_brief).toContain('YYYY-MM-DD')
    expect(batch.proposed_question.content.offline_tool_brief).toContain('4位纯数字批次号')
    expect(batch.proposed_question.safety_sensitive).toBe(true)
    expect(batch.revision_trace.carried_forward_review_passes.map((item) => item.track)).toEqual(['CONTENT'])

    const interruption = byId.get('M4_OP_048_V3')
    expect(interruption.proposed_question.content.prompt).toContain('9件为合格补货品，1件为条码与任务单不符')
    expect(interruption.proposed_question.safety_stop_conditions).toContain('真实泄漏')

    const aisle = byId.get('M5_OP_048_V3')
    expect(aisle.proposed_question.content.ability_tags).toEqual(['SAFETY_OPERATION', 'RULE_EXECUTION'])
    expect(aisle.proposed_question.scoring_rule.score_1_description).toContain('4件散落物全部移出通道')
    expect(aisle.proposed_question.scoring_rule.score_0_description).toContain('未被路障完全隔离')

    const clarification = byId.get('M5_OP_055_V3')
    expect(clarification.proposed_question.content.prompt).toContain('确认后本题结束，不开始补货')
    expect(clarification.proposed_question.content.offline_tool_brief).toContain('至少提供6瓶500毫升无糖茶')
    expect(clarification.proposed_question.content.rubric_criteria).toHaveLength(5)
  })

  it('builds self-contained JSON-export reviewer packets with exact targeted scopes', () => {
    const content = embeddedPackage(outputs[3])
    const safety = embeddedPackage(outputs[4])
    expect(content.questions.map((item) => item.question_id)).toEqual(contentV3Ids)
    expect(safety.questions.map((item) => item.question_id)).toEqual(safetyV3Ids)
    expect(content.reviewer).toEqual({ name: '陈晓青', track: 'CONTENT_REREVIEW', role: '内容定点复审' })
    expect(safety.reviewer).toEqual({ name: '赫东', track: 'SAFETY_TECHNICAL_REREVIEW', role: '安全与技术定点复审' })
    expect(content.questions.every((item) => item.activation_authority === 'NONE')).toBe(true)
    expect(safety.questions.every((item) => item.activation_authority === 'NONE')).toBe(true)
    expect(content.authority).toMatchObject({ activation_authority_granted: false, can_activate_questions: false, runtime_database_change_allowed: false, activation_sql_generated: false })
    expect(safety.authority).toMatchObject(content.authority)
    inlineScriptsCompile(outputs[3])
    inlineScriptsCompile(outputs[4])
    for (const relative of [outputs[3], outputs[4]]) {
      const html = readFileSync(resolve(tempRoot, relative), 'utf8')
      expect(html).toContain("some(name=>review_fields[name]==='RETURN_FOR_REVISION')")
      expect(html).toContain("activation_authority:'NONE'")
    }
  })

  it('locks result schemas to exact scope and no activation authority', () => {
    const content = json(outputs[5])
    const safety = json(outputs[6])
    expect(content.properties.questions.minItems).toBe(8)
    expect(safety.properties.questions.maxItems).toBe(7)
    expect(content.properties.questions.items.properties.question_id.enum).toEqual(contentV3Ids)
    expect(safety.properties.questions.items.properties.question_id.enum).toEqual(safetyV3Ids)
    expect(content.properties.questions.items.properties.activation_authority.const).toBe('NONE')
    expect(safety.properties.authority.properties.activation_authority_granted.const).toBe(false)
    expect(safety.properties.authority.properties.can_activate_questions.const).toBe(false)
  })

  it('keeps the pending gate fail-closed and authority-free', () => {
    const gate = json(outputs[2])
    const { gate_hash: gateHash, ...gateBody } = gate
    expect(hashRecord(gateBody)).toBe(gateHash)
    expect(gate.status).toBe('PENDING_TARGETED_V3_REREVIEW_NO_ACTIVATION_AUTHORITY')
    expect(gate.summary).toEqual({ total_v3: 9, pending_v3: 9, content_pending: 8, safety_technical_pending: 7, passed_v2_reference_only: 2 })
    expect(gate.boundaries).toMatchObject({ activation_authority_granted: false, can_activate_questions: false, existing_287_unchanged: true, runtime_database_unchanged: true, activation_sql_not_generated: true })
  })

  it('checks deterministically and fails closed on source or output drift', () => {
    const check = run()
    if (check.status !== 0) throw new Error(`${check.stdout}\n${check.stderr}`)

    const sourcePath = resolve(tempRoot, inputs[1])
    const source = JSON.parse(readFileSync(sourcePath, 'utf8'))
    source.questions.find((item) => item.question_id === 'M4_OP_047_V2').failed_review_tracks = ['CONTENT']
    writeFileSync(sourcePath, `${JSON.stringify(source, null, 2)}\n`)
    expect(run([]).status).not.toBe(0)

    copy(inputs[1])
    const outputPath = resolve(tempRoot, outputs[0])
    const output = JSON.parse(readFileSync(outputPath, 'utf8'))
    output.questions[0].activation_authority = 'GRANTED'
    writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`)
    const drift = run()
    expect(drift.status).not.toBe(0)
    expect(`${drift.stdout}${drift.stderr}`).toContain('generated artifact drift')
  })
})
