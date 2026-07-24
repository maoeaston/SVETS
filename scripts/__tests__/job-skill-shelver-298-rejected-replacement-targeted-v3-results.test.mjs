import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { hashRecord } from '../lib/job-skill-contract-hash.mjs'

const root = resolve(import.meta.dirname, '../..')
const feature = (name) => resolve(root, 'doc/features', name)
const script = resolve(root, 'scripts/ingest-job-skill-shelver-298-rejected-replacement-targeted-v3-results.mjs')
const paths = {
  candidates: feature('job-skill-shelver-298-rejected-replacement-targeted-candidates-v3.json'),
  pending: feature('job-skill-shelver-298-rejected-replacement-targeted-v3-review-gate-v1.json'),
  contentSchema: feature('job-skill-shelver-298-rejected-replacement-targeted-v3-content-rereview-result-v1.schema.json'),
  safetySchema: feature('job-skill-shelver-298-rejected-replacement-targeted-v3-safety-technical-rereview-result-v1.schema.json'),
  content: feature('job-skill-shelver-298-rejected-replacement-targeted-v3-content-rereview-result-chen-xiaoqing-2026-07-22.json'),
  safety: feature('job-skill-shelver-298-rejected-replacement-targeted-v3-safety-technical-rereview-result-he-dong-2026-07-22.json'),
  merged: feature('job-skill-shelver-298-rejected-replacement-targeted-v3-rereview-merged-gate-v1.json'),
  ledger: feature('job-skill-shelver-298-rejected-replacement-targeted-v3-rereview-ledger-v1.md'),
  runtimeAuthority: feature('job-skill-shelver-runtime-authority-v1.json'),
  delivery: feature('job-skill-shelver-question-delivery-lock-v1.json'),
  sql: feature('question-bank-import.sql')
}
const sourceInputs = [paths.candidates, paths.pending, paths.contentSchema, paths.safetySchema, paths.content, paths.safety]
const generatedOutputs = [paths.merged, paths.ledger]
const contentIds = [
  'M1_OB_048_V3', 'M1_OP_042_V3', 'M3_OP_056_V3', 'M4_OP_045_V3',
  'M4_OP_046_V3', 'M4_OP_048_V3', 'M5_OP_048_V3', 'M5_OP_055_V3'
]
const safetyIds = [
  'M1_OB_048_V3', 'M1_OP_042_V3', 'M4_OP_045_V3', 'M4_OP_046_V3',
  'M4_OP_047_V3', 'M4_OP_048_V3', 'M5_OP_048_V3'
]
const passedV3Ids = ['M1_OB_048_V3', 'M4_OP_047_V3', 'M5_OP_055_V3']
const returnedV3Ids = ['M1_OP_042_V3', 'M3_OP_056_V3', 'M4_OP_045_V3', 'M4_OP_046_V3', 'M4_OP_048_V3', 'M5_OP_048_V3']
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
  const tempRoot = mkdtempSync(resolve(tmpdir(), 'svets-rejected-replacement-v3-results-'))
  const tempFeature = resolve(tempRoot, 'doc/features')
  mkdirSync(tempFeature, { recursive: true })
  for (const path of [...sourceInputs, ...generatedOutputs]) copyFileSync(path, resolve(tempFeature, basename(path)))
  return { tempRoot, tempFeature }
}

describe('job skill shelver rejected replacement targeted V3 result intake', () => {
  it('preserves both reviewer exports byte-for-byte', () => {
    expect(statSync(paths.content).size).toBe(12664)
    expect(statSync(paths.safety).size).toBe(5676)
    expect(sha256(paths.content)).toBe('70dd799fdc5071245b4b08e2e6a2540c79d92b95a68124fb39449039b1e69e92')
    expect(sha256(paths.safety)).toBe('40d2cc0cbb07cc67f02f87a47f27505fb83f85a322274373ff28e89426051923')
  })

  it('locks each result to its exact targeted route and no activation authority', () => {
    const content = readJson(paths.content)
    const safety = readJson(paths.safety)
    expect(content).toMatchObject({
      reviewer: { name: '陈晓青', track: 'CONTENT_REREVIEW' },
      submitted_at: '2026-07-22T03:23:51.422Z',
      summary: { total: 8, pass: 2, return_for_revision: 6 },
      authority: { activation_authority_granted: false, can_activate_questions: false }
    })
    expect(safety).toMatchObject({
      reviewer: { name: '赫东', track: 'SAFETY_TECHNICAL_REREVIEW' },
      submitted_at: '2026-07-22T03:21:55.761115Z',
      summary: { total: 7, pass: 7, return_for_revision: 0 },
      authority: { activation_authority_granted: false, can_activate_questions: false }
    })
    expect(content.questions.map((question) => question.question_id)).toEqual(contentIds)
    expect(safety.questions.map((question) => question.question_id)).toEqual(safetyIds)
    expect(content.questions.every((question) => question.activation_authority === 'NONE')).toBe(true)
    expect(safety.questions.every((question) => question.activation_authority === 'NONE')).toBe(true)
  })

  it('merges three V3 passes, six content returns and five cumulative passes', () => {
    const merged = readJson(paths.merged)
    expect(merged).toMatchObject({
      status: 'COMPLETED_WITH_RETURNS_NO_ACTIVATION_AUTHORITY',
      validation: {
        schema_identity_submitted_at_scope_hash_summary: 'PASSED',
        carried_forward_pass_hashes: 'PASSED',
        effective_status_policy: 'FAIL_CLOSED_IF_ANY_TRACK_SUBFIELD_RETURNS',
        source_internal_consistency: 'PASSED',
        source_consistency_anomalies: [],
        scope_anomalies: []
      },
      summary: {
        v3_total: 9,
        v3_passed_review_only_no_activation_authority: 3,
        v3_return_for_revision: 6,
        v3_pending: 0,
        content_v3: { total: 8, passed: 2, return_for_revision: 6 },
        safety_technical_v3: { total: 7, passed: 7, return_for_revision: 0 },
        v3_returns_by_failed_tracks: { CONTENT: 6 },
        cumulative_replacement_review: { total: 11, passed_review_only_no_activation_authority: 5, return_for_revision: 6 }
      }
    })
    expect(merged.questions.filter((question) => question.status === 'PASSED_REVIEW_ONLY_NO_ACTIVATION_AUTHORITY').map((question) => question.question_id)).toEqual(passedV3Ids)
    expect(merged.questions.filter((question) => question.status === 'RETURN_FOR_REVISION').map((question) => question.question_id)).toEqual(returnedV3Ids)
    expect(merged.cumulative_passed_references.map((question) => question.question_id)).toEqual([
      'M4_OP_043_V2', 'M4_OP_044_V2', ...passedV3Ids
    ])
  })

  it('retains track sources, hashes and V4 pointers only for actual returns', () => {
    const merged = readJson(paths.merged)
    for (const question of merged.questions) {
      const { merged_record_hash: mergedRecordHash, ...body } = question
      expect(hashRecord(body)).toBe(mergedRecordHash)
      expect(question.activation_authority).toBe('NONE')
      expect(question.original_v1_remains_rejected).toBe(true)
      expect(question.previous_v2_not_activated).toBe(true)
      expect(question.supersedes_original).toBe(false)
      expect(question.review_results.content.status).toBeTypeOf('string')
      expect(question.review_results.safety_technical.status).toBeTypeOf('string')
      if (returnedV3Ids.includes(question.question_id)) {
        expect(question.failed_review_tracks).toEqual(['CONTENT'])
        expect(question.next_question_id).toBe(question.question_id.replace(/_V3$/, '_V4'))
      } else {
        expect(question.failed_review_tracks).toEqual([])
        expect(question.next_question_id).toBeNull()
      }
    }
    expect(merged.questions.find((question) => question.question_id === 'M3_OP_056_V3').review_results.safety_technical.source).toBe('CARRIED_FROM_V2_REVIEW')
    expect(merged.questions.find((question) => question.question_id === 'M4_OP_047_V3').review_results.content.source).toBe('CARRIED_FROM_V2_REVIEW')
    expect(merged.questions.find((question) => question.question_id === 'M5_OP_055_V3').review_results.safety_technical.source).toBe('CARRIED_FROM_V2_REVIEW')
  })

  it('never changes current authority, delivery lock, runtime database contract or activation SQL', () => {
    expect(readJson(paths.merged).authority).toEqual({
      activation_authority_granted: false,
      can_activate_questions: false,
      candidate_set_ready_for_separate_authority_amendment: false,
      authority_amendment_executed: false,
      existing_287_unchanged: true,
      rejected_originals_11_unchanged: true,
      runtime_database_unchanged: true,
      activation_sql_generated: false,
      delivery_lock_unchanged: true,
      next_revision_required: 6
    })
  })

  it('checks deterministically without changing originals or authority artifacts', () => {
    const watched = [paths.content, paths.safety, paths.merged, paths.ledger, paths.runtimeAuthority, paths.delivery, paths.sql]
    const before = Object.fromEntries(watched.map((path) => [path, sha256(path)]))
    const result = runScript(['--check'])
    if (result.status !== 0) throw new Error(`${result.stdout}\n${result.stderr}`)
    for (const path of watched) expect(sha256(path)).toBe(before[path])
  })

  it.each([
    ['reviewer export bytes', paths.content, (value) => { value.summary.pass = 3 }],
    ['duplicate route question', paths.safety, (value) => { value.questions[1] = value.questions[0] }],
    ['candidate semantic hash', paths.candidates, (value) => { value.questions[0].new_semantic_hash = `sha256:${'0'.repeat(64)}` }],
    ['activation authority', paths.safety, (value) => { value.authority.activation_authority_granted = true }],
    ['top-level/subfield inconsistency', paths.content, (value) => { value.questions[0].conclusion = 'RETURN_FOR_REVISION' }]
  ])('fails closed for %s drift', (_label, sourcePath, mutate) => {
    const { tempRoot, tempFeature } = tempFixture()
    const tempPath = resolve(tempFeature, basename(sourcePath))
    const value = readJson(tempPath)
    mutate(value)
    writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`)
    const result = runScript([], { env: { SVETS_REJECTED_REPLACEMENT_V3_RESULTS_ROOT: tempRoot } })
    expect(result.status).not.toBe(0)
  })
})
