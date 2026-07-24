import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')
const feature = (name) => resolve(root, `doc/features/${name}`)
const paths = {
  content: feature('job-skill-shelver-298-targeted-v4-content-rereview-result-chen-xiaoqing-2026-07-20.json'),
  safety: feature('job-skill-shelver-298-targeted-v4-safety-technical-rereview-result-he-dong-2026-07-20.json'),
  candidates: feature('job-skill-shelver-298-question-revision-candidates-v4.json'),
  merged: feature('job-skill-shelver-298-targeted-v4-rereview-merged-gate-v1.json'),
  ledger: feature('job-skill-shelver-298-targeted-v4-rereview-ledger-v1.md'),
  delivery: feature('job-skill-shelver-question-delivery-lock-v1.json'),
  sql: feature('question-bank-import.sql')
}
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')

describe('job skill shelver targeted V4 review result intake', () => {
  it('preserves both reviewer exports byte-for-byte', () => {
    expect(statSync(paths.content).size).toBe(52749)
    expect(statSync(paths.safety).size).toBe(45089)
    expect(sha256(paths.content)).toBe('420289fbf3481415322f46a006613e79421fa8b0c485dfb241d7a2176a9c6409')
    expect(sha256(paths.safety)).toBe('8b2d1c5c03ee98eba9e09e57ec58aa90112738690c520663267e89b9f45583b3')
  })

  it('reconciles both required review sets without gaps, duplicates, or hash drift', () => {
    const candidates = readJson(paths.candidates)
    const content = readJson(paths.content)
    const safety = readJson(paths.safety)
    const expectedContent = candidates.questions.filter((question) => question.required_review_tracks.includes('CONTENT'))
    const expectedSafety = candidates.questions.filter((question) => question.required_review_tracks.includes('SAFETY_TECHNICAL'))

    expect(content).toMatchObject({ reviewer: '陈晓青', summary: { total: 140, pass: 135, return_for_revision: 5 } })
    expect(safety).toMatchObject({ reviewer: '赫东', summary: { total: 120, pass: 118, return_for_revision: 2 } })
    expect(content.questions).toHaveLength(expectedContent.length)
    expect(safety.questions).toHaveLength(expectedSafety.length)
    expect(new Set(content.questions.map((question) => question.question_id)).size).toBe(140)
    expect(new Set(safety.questions.map((question) => question.question_id)).size).toBe(120)
    expect(new Set(content.questions.map((question) => question.question_id))).toEqual(new Set(expectedContent.map((question) => question.question_id)))
    expect(new Set(safety.questions.map((question) => question.question_id))).toEqual(new Set(expectedSafety.map((question) => question.question_id)))
    expect(content.candidate_set_hash).toBe(candidates.candidate_set_hash)
    expect(safety.candidate_set_hash).toBe(candidates.candidate_set_hash)
  })

  it('merges 4 passed V3 references and scopes V5 to only the 6 failed questions', () => {
    const merged = readJson(paths.merged)
    expect(merged).toMatchObject({
      status: 'COMPLETED_WITH_RETURNS',
      validation: {
        schema_identity_scope_hash_summary: 'PASSED',
        video_rule_behavior_answer_contract: { status: 'PASSED', checked: 12, conflicts: [] },
        scope_anomalies: []
      },
      summary: {
        total: 145, passed: 139, passed_v3_references: 4, passed_v4: 135,
        return_for_revision: 6, blocked_contract_conflict: 0, pending: 0,
        returns_by_question_type: { DRAG: 1, OFFLINE_OPERATION: 5 },
        returns_by_failed_tracks: { CONTENT: 4, 'CONTENT+SAFETY_TECHNICAL': 1, SAFETY_TECHNICAL: 1 },
        v5_by_next_review_tracks: { CONTENT: 4, 'CONTENT+SAFETY_TECHNICAL': 1, SAFETY_TECHNICAL: 1 }
      },
      authority: { releaseable: false, phase_4_allowed: false, v5_required: 6 }
    })

    const returned = merged.questions.filter((question) => question.status === 'RETURN_FOR_REVISION')
    expect(returned.map((question) => question.question_id)).toEqual([
      'M1_OP_037_V4', 'M1_OP_038_V4', 'M2_OP_031_V4',
      'M2_OP_038_V4', 'M2_OP_041_V4', 'M5_DG_034_V4'
    ])
    expect(returned.map((question) => question.next_question_id)).toEqual([
      'M1_OP_037_V5', 'M1_OP_038_V5', 'M2_OP_031_V5',
      'M2_OP_038_V5', 'M2_OP_041_V5', 'M5_DG_034_V5'
    ])
    expect(merged.questions.filter((question) => question.status === 'PASSED_V3_REFERENCE')).toHaveLength(4)
    expect(merged.questions.filter((question) => question.video_contract_check.status === 'PASS')).toHaveLength(12)
    expect(merged.questions.every((question) => question.contract_conflict === null && question.scope_anomaly === null)).toBe(true)
  })

  it('checks deterministically without changing reviewer exports, delivery lock, or runtime SQL', () => {
    const watched = [paths.content, paths.safety, paths.merged, paths.ledger, paths.delivery, paths.sql]
    const before = Object.fromEntries(watched.map((path) => [path, sha256(path)]))
    const result = spawnSync(process.execPath, [resolve(root, 'scripts/ingest-job-skill-shelver-298-targeted-v4-results.mjs'), '--check'], { cwd: root })
    if (result.status !== 0) throw result.error ?? new Error(result.stderr.toString())
    for (const path of watched) expect(sha256(path)).toBe(before[path])
  })
})
