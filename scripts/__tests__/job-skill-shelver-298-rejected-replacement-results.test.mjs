import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { hashRecord } from '../lib/job-skill-contract-hash.mjs'

const root = resolve(import.meta.dirname, '../..')
const feature = (name) => resolve(root, 'doc/features', name)
const script = resolve(root, 'scripts/ingest-job-skill-shelver-298-rejected-replacement-results.mjs')
const paths = {
  candidates: feature('job-skill-shelver-298-rejected-replacement-candidates-v2.json'),
  pending: feature('job-skill-shelver-298-rejected-replacement-review-gate-v1.json'),
  contentSchema: feature('job-skill-shelver-298-rejected-replacement-content-confirmation-result-v1.schema.json'),
  safetySchema: feature('job-skill-shelver-298-rejected-replacement-safety-technical-review-result-v1.schema.json'),
  content: feature('job-skill-shelver-298-rejected-replacement-content-confirmation-result-chen-xiaoqing-2026-07-22.json'),
  safety: feature('job-skill-shelver-298-rejected-replacement-safety-technical-review-result-he-dong-2026-07-22.json'),
  merged: feature('job-skill-shelver-298-rejected-replacement-review-merged-gate-v1.json'),
  ledger: feature('job-skill-shelver-298-rejected-replacement-review-ledger-v1.md'),
  runtimeAuthority: feature('job-skill-shelver-runtime-authority-v1.json'),
  delivery: feature('job-skill-shelver-question-delivery-lock-v1.json'),
  sql: feature('question-bank-import.sql')
}
const sourceInputs = [paths.candidates, paths.pending, paths.contentSchema, paths.safetySchema, paths.content, paths.safety]
const generatedOutputs = [paths.merged, paths.ledger]
const expectedIds = [
  'M1_OB_048_V2', 'M1_OP_042_V2', 'M3_OP_056_V2', 'M4_OP_043_V2',
  'M4_OP_044_V2', 'M4_OP_045_V2', 'M4_OP_046_V2', 'M4_OP_047_V2',
  'M4_OP_048_V2', 'M5_OP_048_V2', 'M5_OP_055_V2'
]
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
  const tempRoot = mkdtempSync(resolve(tmpdir(), 'svets-rejected-replacement-results-'))
  const tempFeature = resolve(tempRoot, 'doc/features')
  mkdirSync(tempFeature, { recursive: true })
  for (const path of [...sourceInputs, ...generatedOutputs]) copyFileSync(path, resolve(tempFeature, basename(path)))
  return { tempRoot, tempFeature }
}

describe('job skill shelver rejected replacement review result intake', () => {
  it('preserves both reviewer exports byte-for-byte', () => {
    expect(statSync(paths.content).size).toBe(15635)
    expect(statSync(paths.safety).size).toBe(14101)
    expect(sha256(paths.content)).toBe('c1ee9285ee6dec38bc52d487ed4d7391d581c02ee9caf9a3c3a85bdb6bce4e6e')
    expect(sha256(paths.safety)).toBe('755837f746e55ba580f9d20b7fd9ea129cc29277f068e8d399d114bad715aabe')
  })

  it('locks both results to the exact 11-question candidate set and no activation authority', () => {
    const content = readJson(paths.content)
    const safety = readJson(paths.safety)
    expect(content).toMatchObject({
      reviewer: { name: '陈晓青', track: 'CONTENT_CONFIRMATION' },
      submitted_at: '2026-07-22T02:03:21.072Z',
      summary: { total: 11, pass: 3, return_for_revision: 8 },
      authority: { activation_authority_granted: false, can_activate_questions: false }
    })
    expect(safety).toMatchObject({
      reviewer: { name: '赫东', track: 'SAFETY_TECHNICAL_REVIEW' },
      submitted_at: '2026-07-22T02:01:26.248616Z',
      summary: { total: 11, pass: 7, return_for_revision: 4 },
      authority: { activation_authority_granted: false, can_activate_questions: false }
    })
    for (const result of [content, safety]) {
      expect(result.questions.map((question) => question.question_id)).toEqual(expectedIds)
      expect(new Set(result.questions.map((question) => question.question_id)).size).toBe(11)
      expect(result.questions.every((question) => question.activation_authority === 'NONE')).toBe(true)
    }
  })

  it('fails closed on three safety export inconsistencies and merges only two passes', () => {
    const merged = readJson(paths.merged)
    expect(merged).toMatchObject({
      status: 'COMPLETED_WITH_RETURNS_NO_ACTIVATION_AUTHORITY',
      validation: {
        schema_identity_submitted_at_scope_hash_summary: 'PASSED',
        safety_technical_effective_status_policy: 'FAIL_CLOSED_IF_ANY_SAFETY_OR_TECHNICAL_SUBFIELD_RETURNS',
        source_internal_consistency: 'PASSED_WITH_FAIL_CLOSED_NORMALIZATION',
        scope_anomalies: []
      },
      summary: {
        total: 11,
        passed_review_only_no_activation_authority: 2,
        return_for_revision: 9,
        pending: 0,
        content: { total: 11, passed: 3, return_for_revision: 8 },
        safety_technical_source_declared: { total: 11, passed: 7, return_for_revision: 4 },
        safety_technical_effective: { total: 11, passed: 4, return_for_revision: 7 },
        returns_by_failed_tracks: { CONTENT: 2, 'CONTENT+SAFETY_TECHNICAL': 6, SAFETY_TECHNICAL: 1 }
      }
    })
    expect(merged.validation.source_consistency_anomalies.map((item) => item.question_id)).toEqual([
      'M1_OP_042_V2', 'M4_OP_045_V2', 'M4_OP_046_V2'
    ])
    expect(merged.questions.filter((question) => question.status === 'PASSED_REVIEW_ONLY_NO_ACTIVATION_AUTHORITY').map((question) => question.question_id)).toEqual([
      'M4_OP_043_V2', 'M4_OP_044_V2'
    ])
    expect(merged.questions.filter((question) => question.status === 'RETURN_FOR_REVISION')).toHaveLength(9)
  })

  it('retains per-track detail, hashes and V3 pointers only for actual returns', () => {
    const merged = readJson(paths.merged)
    for (const question of merged.questions) {
      const { merged_record_hash: mergedRecordHash, ...body } = question
      expect(hashRecord(body)).toBe(mergedRecordHash)
      expect(question.activation_authority).toBe('NONE')
      expect(question.original_v1_remains_rejected).toBe(true)
      expect(question.supersedes_original).toBe(false)
      expect(question.review_results.content.review_fields).toBeTypeOf('object')
      expect(question.review_results.safety_technical.review_fields).toBeTypeOf('object')
      if (question.status === 'RETURN_FOR_REVISION') {
        expect(question.next_question_id).toBe(question.question_id.replace(/_V2$/, '_V3'))
        expect(question.failed_review_tracks.length).toBeGreaterThan(0)
      } else {
        expect(question.next_question_id).toBeNull()
        expect(question.failed_review_tracks).toEqual([])
      }
    }
  })

  it('never changes current authority, delivery lock, runtime database contract or activation SQL', () => {
    const merged = readJson(paths.merged)
    expect(merged.authority).toEqual({
      activation_authority_granted: false,
      can_activate_questions: false,
      candidate_set_ready_for_separate_authority_amendment: false,
      authority_amendment_executed: false,
      existing_287_unchanged: true,
      rejected_originals_11_unchanged: true,
      runtime_database_unchanged: true,
      activation_sql_generated: false,
      delivery_lock_unchanged: true,
      next_revision_required: 9
    })
  })

  it('checks deterministically without changing reviewer originals or authority artifacts', () => {
    const watched = [paths.content, paths.safety, paths.merged, paths.ledger, paths.runtimeAuthority, paths.delivery, paths.sql]
    const before = Object.fromEntries(watched.map((path) => [path, sha256(path)]))
    const result = runScript(['--check'])
    if (result.status !== 0) throw new Error(`${result.stdout}\n${result.stderr}`)
    for (const path of watched) expect(sha256(path)).toBe(before[path])
  })

  it.each([
    ['reviewer export bytes', paths.content, (value) => { value.summary.pass = 4 }],
    ['duplicate review question', paths.safety, (value) => { value.questions[1] = value.questions[0] }],
    ['candidate semantic hash', paths.candidates, (value) => { value.questions[0].new_semantic_hash = `sha256:${'0'.repeat(64)}` }],
    ['activation authority', paths.safety, (value) => { value.authority.activation_authority_granted = true }]
  ])('fails closed for %s drift', (_label, sourcePath, mutate) => {
    const { tempRoot, tempFeature } = tempFixture()
    const tempPath = resolve(tempFeature, basename(sourcePath))
    const value = readJson(tempPath)
    mutate(value)
    writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`)
    const result = runScript([], { env: { SVETS_REJECTED_REPLACEMENT_RESULTS_ROOT: tempRoot } })
    expect(result.status).not.toBe(0)
  })
})
