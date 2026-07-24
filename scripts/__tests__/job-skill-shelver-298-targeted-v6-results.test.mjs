import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { hashRecord } from '../lib/job-skill-contract-hash.mjs'

const root = resolve(import.meta.dirname, '../..')
const feature = (name) => resolve(root, `doc/features/${name}`)
const script = resolve(root, 'scripts/ingest-job-skill-shelver-298-targeted-v6-results.mjs')
const paths = {
  content: feature('job-skill-shelver-298-targeted-v6-content-rereview-result-chen-xiaoqing-2026-07-20.json'),
  candidates: feature('job-skill-shelver-298-question-revision-candidates-v6.json'),
  pending: feature('job-skill-shelver-298-targeted-v6-rereview-gate-v1.json'),
  previous: feature('job-skill-shelver-298-targeted-v5-rereview-merged-gate-v1.json'),
  schema: feature('job-skill-shelver-298-targeted-v6-content-rereview-result-v1.schema.json'),
  merged: feature('job-skill-shelver-298-targeted-v6-rereview-merged-gate-v1.json'),
  ledger: feature('job-skill-shelver-298-targeted-v6-rereview-ledger-v1.md'),
  delivery: feature('job-skill-shelver-question-delivery-lock-v1.json'),
  sql: feature('question-bank-import.sql')
}
const sourceInputs = [paths.candidates, paths.pending, paths.previous, paths.schema, paths.content]
const expectedIds = ['M2_OP_031_V6', 'M2_OP_038_V6', 'M2_OP_041_V6', 'M5_DG_034_V6']
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
  const tempRoot = mkdtempSync(resolve(tmpdir(), 'svets-v6-results-'))
  const tempFeature = resolve(tempRoot, 'doc/features')
  mkdirSync(tempFeature, { recursive: true })
  for (const path of sourceInputs) copyFileSync(path, resolve(tempFeature, basename(path)))
  return { tempRoot, tempFeature }
}

describe('job skill shelver targeted V6 review result intake', () => {
  it('preserves the reviewer export byte-for-byte', () => {
    expect(statSync(paths.content).size).toBe(1864)
    expect(sha256(paths.content)).toBe('1595eee1bb27847d72126c7b52e10b32838a54f93db4caaa6d2f826b59d375d5')
  })

  it('accepts only the exact four-question content result and reconciles its summary', () => {
    const content = readJson(paths.content)
    expect(content).toMatchObject({
      schema_version: 'job-skill-shelver-298-targeted-v6-content-rereview-result-v1',
      package_id: 'job-skill-shelver-298-targeted-v6-content-rereview-packet-v1',
      candidate_set_hash: 'sha256:2c0f5d1a32414c8ad323f19ba72aba2e418f75e9b94bf1f1f61b150a525f211c',
      reviewer: '陈晓青',
      submitted_at: '2026-07-20T10:47:08.396Z',
      summary: { total: 4, pass: 4, return_for_revision: 0 }
    })
    expect(content.questions.map((question) => question.question_id)).toEqual(expectedIds)
    expect(new Set(content.questions.map((question) => question.question_id).map(stripVersion)).size).toBe(4)
    expect(content.questions.every((question) => question.conclusion === 'PASS')).toBe(true)
  })

  it('merges all 145 questions as passed while retaining 141 references', () => {
    const merged = readJson(paths.merged)
    expect(merged).toMatchObject({
      status: 'PASSED',
      validation: {
        schema_identity_submitted_at_scope_hash_summary: 'PASSED',
        preserved_passed_reference_count: 141,
        scope_anomalies: []
      },
      summary: {
        total: 145,
        passed: 145,
        passed_references: 141,
        passed_v6: 4,
        return_for_revision: 0,
        pending: 0,
        content: { total: 4, passed: 4, return_for_revision: 0 }
      },
      authority: {
        releaseable: true,
        phase_4_allowed: true,
        phase_4_executed: false,
        runtime_database_unchanged: true,
        activation_sql_generated: false,
        delivery_lock_unchanged: true,
        next_revision_required: 0
      }
    })
    expect(merged.questions).toHaveLength(145)
    expect(new Set(merged.questions.map((question) => stripVersion(question.question_id))).size).toBe(145)
    expect(merged.questions.filter((question) => question.status === 'PASSED_REFERENCE')).toHaveLength(141)
    expect(merged.questions.filter((question) => question.status === 'PASSED').map((question) => question.question_id)).toEqual(expectedIds)
    expect(merged.questions.filter((question) => question.status === 'RETURN_FOR_REVISION')).toHaveLength(0)
  })

  it('retains review evidence, version chains and recalculable record hashes for every question', () => {
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
      expect(question.failed_review_tracks).toEqual([])
      expect(question.next_question_id).toBeNull()
      if (question.status === 'PASSED_REFERENCE') {
        const source = previousById.get(question.question_id)
        expect(question.source_result.merged_record_hash).toBe(source.merged_record_hash)
        expect(question.review_results).toEqual(source.review_results)
      } else {
        expect(question.required_review_tracks).toEqual(['CONTENT'])
        expect(question.review_results.content).toMatchObject({ status: 'PASS', review_note: '' })
        expect(question.review_results.safety_technical).toEqual({ status: 'NOT_REQUIRED' })
      }
    }
  })

  it('checks deterministically without changing the reviewer export, delivery lock, SQL or generated records', () => {
    const watched = [paths.content, paths.merged, paths.ledger, paths.delivery, paths.sql]
    const before = Object.fromEntries(watched.map((path) => [path, sha256(path)]))
    const result = runScript(['--check'])
    if (result.status !== 0) throw result.error ?? new Error(result.stderr.toString())
    for (const path of watched) expect(sha256(path)).toBe(before[path])
  })

  it.each([
    ['reviewer result byte or summary drift', paths.content, (value) => { value.summary.pass = 3 }],
    ['duplicate or missing review question', paths.content, (value) => { value.questions[3] = value.questions[0] }],
    ['wrong previous_question_id', paths.content, (value) => { value.questions[0].previous_question_id = 'M2_OP_031_V4' }],
    ['semantic hash drift', paths.candidates, (value) => { value.questions[0].new_semantic_hash = `sha256:${'0'.repeat(64)}` }],
    ['candidate record hash drift', paths.candidates, (value) => { value.questions[0].candidate_record_hash = `sha256:${'1'.repeat(64)}` }],
    ['wrong version chain', paths.previous, (value) => { value.questions.find((question) => question.question_id === 'M2_OP_031_V5').next_question_id = 'M2_OP_031_V7' }],
    ['pending gate semantic drift', paths.pending, (value) => { value.questions.find((question) => question.question_id === 'M2_OP_031_V6').semantic_hash = `sha256:${'2'.repeat(64)}` }]
  ])('fails closed for %s', (_label, sourcePath, mutate) => {
    const { tempRoot, tempFeature } = tempFixture()
    const tempPath = resolve(tempFeature, basename(sourcePath))
    const value = readJson(tempPath)
    mutate(value)
    writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`)
    const result = runScript([], { env: { SVETS_V6_RESULTS_ROOT: tempRoot } })
    expect(result.status).not.toBe(0)
  })
})
