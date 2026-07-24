import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { hashRecord } from '../lib/job-skill-contract-hash.mjs'

const root = resolve(import.meta.dirname, '../..')
const feature = (name) => resolve(root, `doc/features/${name}`)
const script = resolve(root, 'scripts/ingest-job-skill-shelver-298-targeted-v5-results.mjs')
const paths = {
  content: feature('job-skill-shelver-298-targeted-v5-content-rereview-result-chen-xiaoqing-2026-07-20.json'),
  safety: feature('job-skill-shelver-298-targeted-v5-safety-technical-rereview-result-he-dong-2026-07-20.json'),
  candidates: feature('job-skill-shelver-298-question-revision-candidates-v5.json'),
  pending: feature('job-skill-shelver-298-targeted-v5-rereview-gate-v1.json'),
  previous: feature('job-skill-shelver-298-targeted-v4-rereview-merged-gate-v1.json'),
  contentSchema: feature('job-skill-shelver-298-targeted-v5-content-rereview-result-v1.schema.json'),
  safetySchema: feature('job-skill-shelver-298-targeted-v5-safety-technical-rereview-result-v1.schema.json'),
  merged: feature('job-skill-shelver-298-targeted-v5-rereview-merged-gate-v1.json'),
  ledger: feature('job-skill-shelver-298-targeted-v5-rereview-ledger-v1.md'),
  delivery: feature('job-skill-shelver-question-delivery-lock-v1.json'),
  sql: feature('question-bank-import.sql')
}
const sourceInputs = [
  paths.candidates, paths.pending, paths.previous, paths.contentSchema,
  paths.safetySchema, paths.content, paths.safety
]
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
const stripVersion = (questionId) => questionId.replace(/_V\d+$/, '')

function runScript(args = [], options = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    env: { ...process.env, ...options.env }
  })
}

function tempFixture() {
  const tempRoot = mkdtempSync(resolve(tmpdir(), 'svets-v5-results-'))
  const tempFeature = resolve(tempRoot, 'doc/features')
  mkdirSync(tempFeature, { recursive: true })
  for (const path of sourceInputs) copyFileSync(path, resolve(tempFeature, basename(path)))
  return { tempRoot, tempFeature }
}

describe('job skill shelver targeted V5 review result intake', () => {
  it('preserves both reviewer exports byte-for-byte', () => {
    expect(statSync(paths.content).size).toBe(4769)
    expect(statSync(paths.safety).size).toBe(1167)
    expect(sha256(paths.content)).toBe('4577c7b88712dcd21ab7352651c5edb7f19e5cf9ce3fd01aa8e491768a25eab0')
    expect(sha256(paths.safety)).toBe('27ccf836619c5f3008adf83fef32cc7e83ee8bf5b0551eedfb328134c80904aa')
  })

  it('accepts only the exact failed-track sets and reconciles reviewer summaries', () => {
    const content = readJson(paths.content)
    const safety = readJson(paths.safety)
    expect(content).toMatchObject({
      schema_version: 'job-skill-shelver-298-targeted-v5-content-rereview-result-v1',
      package_id: 'job-skill-shelver-298-targeted-v5-content-rereview-packet-v1',
      reviewer: '陈晓青', submitted_at: '2026-07-20T10:06:56.006Z',
      summary: { total: 5, pass: 1, return_for_revision: 4 }
    })
    expect(safety).toMatchObject({
      schema_version: 'job-skill-shelver-298-targeted-v5-safety-technical-rereview-result-v1',
      package_id: 'job-skill-shelver-298-targeted-v5-safety-technical-rereview-packet-v1',
      reviewer: '赫东', submitted_at: '2026-07-20T10:07:50.985Z',
      summary: { total: 2, pass: 2, return_for_revision: 0 }
    })
    expect(content.questions.map((question) => question.question_id)).toEqual([
      'M1_OP_038_V5', 'M2_OP_031_V5', 'M2_OP_038_V5', 'M2_OP_041_V5', 'M5_DG_034_V5'
    ])
    expect(safety.questions.map((question) => question.question_id)).toEqual(['M1_OP_037_V5', 'M1_OP_038_V5'])
    expect(new Set(content.questions.map((question) => question.question_id)).size).toBe(5)
    expect(new Set(safety.questions.map((question) => question.question_id)).size).toBe(2)
  })

  it('merges all 145 questions while retaining 139 passed references', () => {
    const merged = readJson(paths.merged)
    expect(merged).toMatchObject({
      status: 'COMPLETED_WITH_RETURNS',
      validation: {
        schema_identity_submitted_at_scope_hash_summary: 'PASSED',
        preserved_passed_reference_count: 139,
        scope_anomalies: []
      },
      summary: {
        total: 145, passed: 141, passed_references: 139, passed_v5: 2,
        return_for_revision: 4, pending: 0,
        content: { total: 5, passed: 1, return_for_revision: 4 },
        safety_technical: { total: 2, passed: 2, return_for_revision: 0 },
        returns_by_question_type: { DRAG: 1, OFFLINE_OPERATION: 3 },
        returns_by_failed_tracks: { CONTENT: 4 }
      },
      authority: {
        releaseable: false, phase_4_allowed: false, phase_4_executed: false,
        runtime_database_unchanged: true, activation_sql_generated: false,
        delivery_lock_unchanged: true, next_revision_required: 4
      }
    })
    expect(merged.questions).toHaveLength(145)
    expect(new Set(merged.questions.map((question) => stripVersion(question.question_id))).size).toBe(145)
    expect(merged.questions.filter((question) => question.status === 'PASSED_REFERENCE')).toHaveLength(139)
    expect(merged.questions.filter((question) => question.status === 'PASSED').map((question) => question.question_id)).toEqual([
      'M1_OP_037_V5', 'M1_OP_038_V5'
    ])
    expect(merged.questions.filter((question) => question.status === 'RETURN_FOR_REVISION').map((question) => question.question_id)).toEqual([
      'M2_OP_031_V5', 'M2_OP_038_V5', 'M2_OP_041_V5', 'M5_DG_034_V5'
    ])
  })

  it('requires both tracks for M1_OP_038 and keeps next versions only for actual returns', () => {
    const merged = readJson(paths.merged)
    const byId = new Map(merged.questions.map((question) => [question.question_id, question]))
    expect(byId.get('M1_OP_038_V5')).toMatchObject({
      required_review_tracks: ['CONTENT', 'SAFETY_TECHNICAL'],
      review_results: { content: { status: 'PASS' }, safety_technical: { status: 'PASS' } },
      status: 'PASSED', failed_review_tracks: [], next_question_id: null
    })
    expect(byId.get('M1_OP_037_V5')).toMatchObject({
      required_review_tracks: ['SAFETY_TECHNICAL'],
      review_results: { content: { status: 'NOT_REQUIRED' }, safety_technical: { status: 'PASS' } },
      status: 'PASSED', failed_review_tracks: [], next_question_id: null
    })
    for (const question of merged.questions.filter((item) => item.status === 'RETURN_FOR_REVISION')) {
      expect(question.failed_review_tracks).toEqual(['CONTENT'])
      expect(question.next_question_id).toBe(question.question_id.replace(/_V5$/, '_V6'))
    }
  })

  it('retains source results, review notes, version and all record hashes per question', () => {
    const merged = readJson(paths.merged)
    const previous = readJson(paths.previous)
    const previousById = new Map(previous.questions.map((question) => [question.question_id, question]))
    for (const question of merged.questions) {
      const { merged_record_hash: mergedRecordHash, ...recordBody } = question
      expect(hashRecord(recordBody)).toBe(mergedRecordHash)
      expect(question.source_result).toMatchObject({ gate_path: expect.any(String), gate_hash: previous.gate_hash, merged_record_hash: expect.any(String), status: expect.any(String) })
      expect(question.version_chain.current_question_id).toBe(question.question_id)
      expect(question.candidate_record_hash).toMatch(/^sha256:[a-f0-9]{64}$/)
      expect(question.semantic_hash).toMatch(/^sha256:[a-f0-9]{64}$/)
      expect(question.review_results).toBeTypeOf('object')
      expect(question.failed_review_tracks).toBeInstanceOf(Array)
      expect(Object.hasOwn(question, 'next_question_id')).toBe(true)
      if (question.status === 'PASSED_REFERENCE') {
        const source = previousById.get(question.question_id)
        expect(question.source_result.merged_record_hash).toBe(source.merged_record_hash)
        expect(question.review_results).toEqual(source.review_results)
      }
    }
  })

  it('checks deterministically without changing reviewer exports, delivery lock, SQL or generated records', () => {
    const watched = [paths.content, paths.safety, paths.merged, paths.ledger, paths.delivery, paths.sql]
    const before = Object.fromEntries(watched.map((path) => [path, sha256(path)]))
    const result = runScript(['--check'])
    if (result.status !== 0) throw result.error ?? new Error(result.stderr.toString())
    for (const path of watched) expect(sha256(path)).toBe(before[path])
  })

  it.each([
    ['reviewer result byte or summary drift', paths.content, (value) => { value.summary.pass = 5 }],
    ['duplicate or missing review question', paths.safety, (value) => { value.questions[1] = value.questions[0] }],
    ['wrong previous_question_id', paths.content, (value) => { value.questions[0].previous_question_id = 'M1_OP_037_V4' }],
    ['semantic hash drift', paths.candidates, (value) => { value.questions[0].new_semantic_hash = `sha256:${'0'.repeat(64)}` }],
    ['candidate record hash drift', paths.candidates, (value) => { value.questions[0].candidate_record_hash = `sha256:${'1'.repeat(64)}` }],
    ['wrong version chain', paths.previous, (value) => { value.questions.find((question) => question.question_id === 'M1_OP_037_V4').next_question_id = 'M1_OP_037_V6' }]
  ])('fails closed for %s', (_label, sourcePath, mutate) => {
    const { tempRoot, tempFeature } = tempFixture()
    const tempPath = resolve(tempFeature, basename(sourcePath))
    const value = readJson(tempPath)
    mutate(value)
    writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`)
    const result = runScript([], { env: { SVETS_V5_RESULTS_ROOT: tempRoot } })
    expect(result.status).not.toBe(0)
  })
})
