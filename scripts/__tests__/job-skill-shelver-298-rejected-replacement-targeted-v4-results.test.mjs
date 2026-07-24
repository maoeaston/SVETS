import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { hashRecord } from '../lib/job-skill-contract-hash.mjs'

const root = resolve(import.meta.dirname, '../..')
const feature = (name) => resolve(root, 'doc/features', name)
const script = resolve(root, 'scripts/ingest-job-skill-shelver-298-rejected-replacement-targeted-v4-results.mjs')
const paths = {
  candidates: feature('job-skill-shelver-298-rejected-replacement-targeted-candidates-v4.json'),
  pending: feature('job-skill-shelver-298-rejected-replacement-targeted-v4-content-rereview-gate-v1.json'),
  schema: feature('job-skill-shelver-298-rejected-replacement-targeted-v4-content-rereview-result-v1.schema.json'),
  content: feature('job-skill-shelver-298-rejected-replacement-targeted-v4-content-rereview-result-chen-xiaoqing-2026-07-22.json'),
  merged: feature('job-skill-shelver-298-rejected-replacement-targeted-v4-rereview-merged-gate-v1.json'),
  ledger: feature('job-skill-shelver-298-rejected-replacement-targeted-v4-rereview-ledger-v1.md'),
  runtimeAuthority: feature('job-skill-shelver-runtime-authority-v1.json'),
  delivery: feature('job-skill-shelver-question-delivery-lock-v1.json'),
  sql: feature('question-bank-import.sql')
}
const sourceInputs = [paths.candidates, paths.pending, paths.schema, paths.content]
const generatedOutputs = [paths.merged, paths.ledger]
const v4Ids = ['M1_OP_042_V4', 'M3_OP_056_V4', 'M4_OP_045_V4', 'M4_OP_046_V4', 'M4_OP_048_V4', 'M5_OP_048_V4']
const priorPassIds = ['M4_OP_043_V2', 'M4_OP_044_V2', 'M1_OB_048_V3', 'M4_OP_047_V3', 'M5_OP_055_V3']
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')

function runScript(args = [], options = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    env: { ...process.env, ...options.env },
    encoding: 'utf8'
  })
}

function tempFixture() {
  const tempRoot = mkdtempSync(resolve(tmpdir(), 'svets-rejected-replacement-v4-results-'))
  const tempFeature = resolve(tempRoot, 'doc/features')
  mkdirSync(tempFeature, { recursive: true })
  for (const path of [...sourceInputs, ...generatedOutputs]) copyFileSync(path, resolve(tempFeature, basename(path)))
  return { tempRoot, tempFeature }
}

describe('job skill shelver rejected replacement targeted V4 result intake', () => {
  it('preserves Chen Xiaoqing reviewer export byte-for-byte', () => {
    expect(statSync(paths.content).size).toBe(4902)
    expect(sha256(paths.content)).toBe('2347aa2e61ab73e69b43ff32ea28fb0aedfa9f07ac80364fe84ab32e1e0ead5c')
  })

  it('locks the export to the exact content route and no activation authority', () => {
    const content = readJson(paths.content)
    expect(content).toMatchObject({
      reviewer: { name: '陈晓青', track: 'CONTENT_REREVIEW', role: '内容定点复审' },
      submitted_at: '2026-07-22T06:25:13.691Z',
      summary: { total: 6, pass: 6, return_for_revision: 0 },
      authority: { activation_authority_granted: false, can_activate_questions: false, runtime_database_change_allowed: false, activation_sql_generated: false }
    })
    expect(content.questions.map((question) => question.question_id)).toEqual(v4Ids)
    expect(content.questions.every((question) => question.activation_authority === 'NONE')).toBe(true)
    expect(content.questions.every((question) => question.conclusion === 'PASS')).toBe(true)
    expect(content.questions.every((question) => Object.values(question.review_fields).every((value) => ['PASS', '通过', '无'].includes(value)))).toBe(true)
  })

  it('merges six V4 passes with five prior references into eleven passed replacements', () => {
    const merged = readJson(paths.merged)
    const { gate_hash: gateHash, ...gateBody } = merged
    expect(hashRecord(gateBody)).toBe(gateHash)
    expect(merged.status).toBe('PASSED_REVIEW_ONLY_NO_ACTIVATION_AUTHORITY')
    expect(merged.summary).toEqual({
      v4_total: 6,
      v4_passed_review_only_no_activation_authority: 6,
      v4_return_for_revision: 0,
      v4_pending: 0,
      content_v4: { total: 6, passed: 6, return_for_revision: 0 },
      safety_technical_v4: { total: 6, passed_carried_forward: 6, return_for_revision: 0 },
      cumulative_replacement_review: { total: 11, passed_review_only_no_activation_authority: 11, return_for_revision: 0 }
    })
    expect(merged.questions.map((question) => question.question_id)).toEqual(v4Ids)
    expect(merged.questions.every((question) => question.status === 'PASSED_REVIEW_ONLY_NO_ACTIVATION_AUTHORITY')).toBe(true)
    expect(merged.cumulative_passed_references.map((question) => question.question_id)).toEqual([...priorPassIds, ...v4Ids])
  })

  it('retains content and carried safety sources with bound hashes', () => {
    const merged = readJson(paths.merged)
    const candidates = new Map(readJson(paths.candidates).questions.map((question) => [question.question_id, question]))
    for (const question of merged.questions) {
      const { merged_record_hash: recordHash, ...recordBody } = question
      const candidate = candidates.get(question.question_id)
      expect(hashRecord(recordBody)).toBe(recordHash)
      expect(question.candidate_record_hash).toBe(candidate.candidate_record_hash)
      expect(question.semantic_hash).toBe(candidate.new_semantic_hash)
      expect(question.review_results.content).toMatchObject({ status: 'PASS', source: 'V4_RESULT' })
      expect(question.review_results.safety_technical).toEqual({
        status: 'PASS',
        source: 'CARRIED_FROM_PRIOR_REVIEW',
        source_record_hash: candidate.revision_trace.carried_forward_review_passes[0].source_record_hash
      })
      expect(question.failed_review_tracks).toEqual([])
      expect(question.next_question_id).toBeNull()
      expect(question.activation_authority).toBe('NONE')
    }
  })

  it('marks eligibility for a separate authority amendment without executing one', () => {
    expect(readJson(paths.merged).authority).toEqual({
      activation_authority_granted: false,
      can_activate_questions: false,
      candidate_set_ready_for_separate_authority_amendment: true,
      separate_authority_amendment_required: true,
      authority_amendment_executed: false,
      existing_287_unchanged: true,
      rejected_originals_11_unchanged: true,
      runtime_database_unchanged: true,
      activation_sql_generated: false,
      delivery_lock_unchanged: true,
      next_revision_required: 0
    })
  })

  it('checks deterministically without changing originals or authority artifacts', () => {
    const watched = [paths.content, paths.merged, paths.ledger, paths.runtimeAuthority, paths.delivery, paths.sql]
    const before = Object.fromEntries(watched.map((path) => [path, sha256(path)]))
    const result = runScript(['--check'])
    if (result.status !== 0) throw new Error(`${result.stdout}\n${result.stderr}`)
    for (const path of watched) expect(sha256(path)).toBe(before[path])
  })

  it.each([
    ['reviewer export bytes', paths.content, (value) => { value.summary.pass = 5 }],
    ['duplicate route question', paths.content, (value) => { value.questions[1] = value.questions[0] }],
    ['candidate semantic hash', paths.candidates, (value) => { value.questions[0].new_semantic_hash = `sha256:${'0'.repeat(64)}` }],
    ['activation authority', paths.content, (value) => { value.authority.activation_authority_granted = true }],
    ['top-level/subfield inconsistency', paths.content, (value) => { value.questions[0].review_fields.rubric_observability = 'RETURN_FOR_REVISION' }]
  ])('fails closed for %s drift', (_label, sourcePath, mutate) => {
    const { tempRoot, tempFeature } = tempFixture()
    const tempPath = resolve(tempFeature, basename(sourcePath))
    const value = readJson(tempPath)
    mutate(value)
    writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`)
    const result = runScript([], { env: { SVETS_REJECTED_REPLACEMENT_V4_RESULTS_ROOT: tempRoot } })
    expect(result.status).not.toBe(0)
  })
})
